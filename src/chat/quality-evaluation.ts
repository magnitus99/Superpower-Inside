import type { ToolDefinition } from '../llm/providers';
import { planAgenticToolTurn } from './tool-orchestration';
import type { ContextAttachment, SourceCitation, ToolCallRecord } from './types';

/** 실제 모델 호출 없이 저장된 채팅 trace에서 계산할 수 있는 최소 품질 지표입니다. */
export interface ToolTraceQualityInput {
  question: string;
  answer: string;
  toolCalls: readonly ToolCallRecord[];
  citations?: readonly SourceCitation[];
  contextAttachments?: readonly ContextAttachment[];
  toolDefinitions?: readonly ToolDefinition[];
  maxToolRounds?: number;
}

export interface ToolTraceQuality {
  totalCalls: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  toolSuccessRate: number;
  verifiedSources: number;
  candidateSearches: number;
  verifiedReads: number;
  answerCitationCount: number;
  verifiedAnswerCitationCount: number;
  embeddingBackedAnswerCitations: number;
  lexicalOnlyAnswerCitations: number;
  hybridAnswerCitations: number;
  requiresEvidence: boolean;
  answerGrounded: boolean;
  nextAction: string;
}

/**
 * 코드 계약이 보장한 trace 상태와 최종 답변의 근거 연결을 함께 측정합니다.
 * 모델의 문장 품질 자체를 대신 판단하지 않으며, 회귀 비교에 사용할 관측값만 반환합니다.
 */
export function evaluateToolTrace(input: ToolTraceQualityInput): ToolTraceQuality {
  const completedCalls = input.toolCalls.filter(
    (toolCall) => toolCall.status === 'success' || toolCall.status === 'error',
  );
  const successfulCalls = completedCalls.filter((toolCall) => toolCall.status === 'success').length;
  const failedCalls = completedCalls.length - successfulCalls;
  const citations = input.citations ?? [];
  const verifiedAnswerCitationCount = citations.filter(
    (citation) => citation.status === 'verified',
  ).length;
  const embeddingBackedAnswerCitations = citations.filter((citation) =>
    ['keyword-vector', 'vector', 'hybrid'].includes(citation.selectionReason ?? ''),
  ).length;
  const lexicalOnlyAnswerCitations = citations.filter(
    (citation) => citation.selectionReason === 'keyword',
  ).length;
  const hybridAnswerCitations = citations.filter((citation) =>
    ['keyword-vector', 'hybrid'].includes(citation.selectionReason ?? ''),
  ).length;
  const maxToolRounds = Math.max(1, Math.trunc(input.maxToolRounds ?? 10));
  const plan = planAgenticToolTurn({
    question: input.question,
    contextAttachments: input.contextAttachments ?? [],
    explicitToolServerCount: 0,
    toolDefinitions: input.toolDefinitions ?? [],
    toolCalls: input.toolCalls,
    phase: 'after-tools',
    round: Math.min(maxToolRounds, Math.max(1, maxToolRounds - 1)),
    maxRounds: maxToolRounds,
  });
  const ledger = plan?.ledger;
  const requiresEvidence = plan?.requiresEvidence ?? false;
  const verifiedSources = Math.max(ledger?.verifiedSources ?? 0, verifiedAnswerCitationCount);
  const answerGrounded =
    input.answer.trim().length > 0 &&
    (!requiresEvidence || verifiedSources > 0 || verifiedAnswerCitationCount > 0);

  return {
    totalCalls: input.toolCalls.length,
    completedCalls: completedCalls.length,
    successfulCalls,
    failedCalls,
    toolSuccessRate: completedCalls.length > 0 ? successfulCalls / completedCalls.length : 1,
    verifiedSources,
    candidateSearches: ledger?.candidateSearches ?? 0,
    verifiedReads: ledger?.verifiedReads ?? 0,
    answerCitationCount: citations.length,
    verifiedAnswerCitationCount,
    embeddingBackedAnswerCitations,
    lexicalOnlyAnswerCitations,
    hybridAnswerCitations,
    requiresEvidence,
    answerGrounded,
    nextAction: plan?.nextAction ?? 'unknown',
  };
}
