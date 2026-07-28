import type { ChatMessage, ToolDefinition } from '../llm/providers';
import { planAgenticToolTurnRust, type RustAgenticToolTurnPlan } from '../rag/rust-core';
import type { ContextAttachment, ToolCallRecord } from './types';

export interface AgenticToolTurnOptions {
  question: string;
  contextAttachments: readonly ContextAttachment[];
  explicitToolServerCount: number;
  toolDefinitions: readonly ToolDefinition[];
  toolCalls: readonly ToolCallRecord[];
  phase: 'initial' | 'after-tools';
  round: number;
  maxRounds: number;
}

/**
 * 현재 사용자 목표와 완료된 도구 결과를 Rust/WASM 정책 입력으로 축약합니다.
 * TS는 provider/채팅 wire record 매핑만 담당하고 다음 행동 판정은 Rust에 맡깁니다.
 */
export function planAgenticToolTurn(
  options: AgenticToolTurnOptions,
): RustAgenticToolTurnPlan | null {
  return planAgenticToolTurnRust({
    question: options.question,
    hasAttachedEvidence: options.contextAttachments.some(
      (attachment) =>
        (attachment.type === 'file' || attachment.type === 'reference') &&
        attachment.status === 'attached' &&
        (attachment.sourceIds?.length ?? 0) > 0,
    ),
    explicitToolServerCount: options.explicitToolServerCount,
    availableToolNames: options.toolDefinitions.map((definition) => definition.function.name),
    toolCalls: options.toolCalls.flatMap((toolCall) => {
      if (toolCall.status !== 'success' && toolCall.status !== 'error') return [];
      const result = [toolCall.normalizedResult, toolCall.result, toolCall.resultSummary].find(
        (candidate): candidate is string => Boolean(candidate?.trim()),
      );
      return [
        {
          name: toolCall.name,
          status: toolCall.status,
          arguments: toolCall.arguments,
          ...(result ? { result } : {}),
        },
      ];
    }),
    phase: options.phase,
    round: options.round,
    maxRounds: options.maxRounds,
  });
}

/** 매 도구 라운드마다 최신 사용자 목표를 provider 대화의 마지막에 다시 고정합니다. */
export function appendAgenticCheckpoint(
  messages: readonly ChatMessage[],
  checkpoint: string,
): ChatMessage[] {
  if (!checkpoint.trim()) return [...messages];
  return [...messages, { role: 'user', content: checkpoint }];
}
