import {
  NATIVE_VAULT_TOOL_LABEL,
  type NativeVaultToolRuntimeLike,
} from '../agent/native-vault-tool';
import { t } from '../i18n';
import type { ChatMessage, LLMProvider, ToolDefinition } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import { planEvidenceCollectionRust, type RustEvidenceCollectionPlan } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import { executeAssistantToolCalls } from './tool-execution';
import { planAgenticToolTurn } from './tool-orchestration';
import { sanitizeNonExecutingToolTurn } from './tool-protocol';
import type { ContextAttachment, SourceValidationWarning, ToolCallRecord } from './types';

export interface EvidenceCollectionResult {
  toolCalls: ToolCallRecord[];
  checkpoint: string;
  plan: RustEvidenceCollectionPlan;
}

interface EvidenceCollectionOptions {
  question: string;
  scopes: readonly string[];
  nativeTool: NativeVaultToolRuntimeLike;
  createId: () => string;
  signal?: AbortSignal;
  onUpdate?: (calls: ToolCallRecord[]) => void;
}

/** 같은 질문에 대해 모델과 독립적인 읽기 전용 검색·문맥 확인 절차를 수행합니다. */
export async function collectVaultEvidence(
  options: EvidenceCollectionOptions,
): Promise<EvidenceCollectionResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timerHost = globalThis.window ?? globalThis;
  const timer = timerHost.setTimeout(cancel, 120_000);
  try {
    return await runEvidenceCollection(options, controller.signal);
  } finally {
    timerHost.clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

/** 전체 I/O·시간 상한 안에서 Rust가 제시한 다음 행동만 수행합니다. */
async function runEvidenceCollection(
  options: EvidenceCollectionOptions,
  signal: AbortSignal,
): Promise<EvidenceCollectionResult> {
  const toolCalls: ToolCallRecord[] = [];
  // Rust의 계획 상한과 별개로 잘못된 wire 결과가 I/O를 무한 반복하지 않게 합니다.
  for (let step = 0; step <= 51; step++) {
    if (options.signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
    const plan = planEvidenceCollectionRust({
      question: options.question,
      scopes: options.scopes,
      budgetExpired: signal.aborted,
      toolCalls: toolCalls.map((call) => ({
        name: call.name,
        arguments: call.arguments,
        status: call.status === 'success' ? 'success' : 'error',
        result: call.normalizedResult,
      })),
    });
    if (!plan) throw new Error(t('nativeVaultPlanUnavailable'));
    if (plan.done) {
      appLogger.debug('Evidence collection completed.', {
        source: 'chat.evidence-collection',
        data: {
          calls: toolCalls.length,
          reason: plan.reason,
          coverage: plan.coverage,
          sources: plan.verifiedSources,
        },
      });
      return {
        toolCalls,
        plan,
        checkpoint: t('llmEvidenceCollectionCheckpoint', {
          reason: plan.reason,
          sources: plan.verifiedSources,
          reads: plan.contextReads,
          coverage: plan.coverage,
          gaps: JSON.stringify(plan.unresolved),
        }),
      };
    }
    if (!plan.nextCall || toolCalls.length >= 48 || step === 51)
      throw new Error(t('nativeVaultPlanUnavailable'));
    const call: ToolCallRecord = {
      id: options.createId(),
      name: plan.nextCall.name,
      arguments: plan.nextCall.arguments,
      status: 'running',
      approved: true,
      executionKind: 'native',
      serverName: NATIVE_VAULT_TOOL_LABEL,
    };
    const execution = executeAssistantToolCalls({
      toolCalls: [call],
      nativeTool: options.nativeTool,
      registry: null,
      preferredServerNames: [],
      signal,
      onUpdate: (current) => {
        if (!signal.aborted) options.onUpdate?.([...toolCalls, ...current]);
      },
    });
    try {
      toolCalls.push(...(await awaitEvidenceOperation(execution, signal)));
    } catch (error) {
      if (!signal.aborted || options.signal?.aborted) throw error;
      toolCalls.push({ ...call, status: 'error', result: t('cancelledLabel') });
      options.onUpdate?.(toolCalls);
    }
  }
  throw new Error(t('nativeVaultPlanUnavailable'));
}

/** best-effort abort 연산도 늦은 완료가 다음 계획을 실행하지 못하게 합니다. */
function awaitEvidenceOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException(t('cancelledLabel'), 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 확보한 출처를 빠뜨린 답변은 같은 모델로 한 번만 교정하고 남은 한계를 표시합니다. */
export async function finalizeEvidenceAnswer(options: {
  question: string;
  content: string;
  reasoning: string;
  contextAttachments: readonly ContextAttachment[];
  toolDefinitions: readonly ToolDefinition[];
  toolCalls: readonly ToolCallRecord[];
  messages: readonly ChatMessage[];
  provider: Pick<LLMProvider, 'streamChat' | 'contextBudget'>;
  signal?: AbortSignal;
}): Promise<{ content: string; reasoning: string; warnings: SourceValidationWarning[] }> {
  const review = (answer: string) =>
    planAgenticToolTurn({
      question: options.question,
      answer,
      contextAttachments: options.contextAttachments,
      explicitToolServerCount: 0,
      toolDefinitions: options.toolDefinitions,
      toolCalls: options.toolCalls,
      phase: 'after-tools',
      round: 0,
      maxRounds: 10,
    });
  const original = { content: options.content, reasoning: options.reasoning, warnings: [] };
  const initial = review(options.content);
  if (!initial) throw new Error(t('nativeVaultPlanUnavailable'));
  if (!initial.answerNeedsRepair) return original;
  let content = '';
  let reasoning = '';
  try {
    const messages = prepareProviderRequest(
      [
        ...options.messages,
        { role: 'assistant', content: options.content },
        { role: 'user', content: t('llmEvidenceAnswerRepair') },
      ],
      undefined,
      options.provider.contextBudget?.inputBytes,
    ).messages;
    await options.provider.streamChat(
      messages,
      (chunk) => {
        if (options.signal?.aborted) return;
        content += chunk.content ?? '';
        reasoning += chunk.reasoning ?? '';
      },
      0.2,
      undefined,
      { signal: options.signal, toolChoice: 'none' },
    );
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
      throw error;
    appLogger.warn('Evidence citation repair failed.', {
      source: 'chat.evidence-collection',
      error,
    });
  }
  if (options.signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
  const sanitized = sanitizeNonExecutingToolTurn(content, reasoning);
  const repaired = sanitized.visibleContent.trim()
    ? {
        content: sanitized.visibleContent,
        reasoning: sanitized.visibleReasoning || options.reasoning,
      }
    : original;
  const warnings: SourceValidationWarning[] = review(repaired.content)?.answerNeedsRepair
    ? [
        {
          id: 'evidence-citation-coverage',
          kind: 'unverified-source',
          label: options.question,
          detail: t('evidenceAnswerReviewWarning'),
        },
      ]
    : [];
  return { ...repaired, warnings };
}
