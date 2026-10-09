import type { ChatMessage, ToolDefinition } from '../llm/providers';
import { planAgenticToolTurnRust, type RustAgenticToolTurnPlan } from '../rag/rust-core';
import type { ContextAttachment, ToolCallRecord } from './types';

export interface AgenticToolTurnOptions {
  question: string;
  contextAttachments: readonly ContextAttachment[];
  explicitToolServerCount: number;
  explicitToolServerNames?: readonly string[];
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
    explicitToolServerNames: options.explicitToolServerNames ?? [],
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
          ...(toolCall.serverName ? { serverName: toolCall.serverName } : {}),
        },
      ];
    }),
    phase: options.phase,
    round: options.round,
    maxRounds: options.maxRounds,
  });
}

/**
 * Rust 정책이 특정 후속 도구를 요구할 때 provider에 보이는 catalog를 그 도구로 좁힙니다.
 * 정책 출력과 실제 catalog가 어긋난 경우에는 전체 catalog를 보존해 복구 가능성을 남깁니다.
 */
export function selectAgenticToolDefinitions(
  definitions: readonly ToolDefinition[],
  requiredToolNames: readonly string[] | undefined,
  requiredExternalServerNames: readonly string[] | undefined = undefined,
): ToolDefinition[] {
  if (!requiredToolNames || requiredToolNames.length === 0) return [...definitions];
  const required = new Set(requiredToolNames);
  const availableNames = new Set(
    definitions.map((definition) => definition.function.name),
  );
  if ([...required].some((name) => !availableNames.has(name))) {
    return [...definitions];
  }
  const requiredServers = new Set(requiredExternalServerNames ?? []);
  if (requiredServers.size > 0) {
    const matchedServers = new Set<string>();
    const selected = definitions.filter((definition) => {
      if (!required.has(definition.function.name)) return false;
      const serverName = [...requiredServers].find((candidate) =>
        definition.function.description.startsWith(mcpServerDescriptionPrefix(candidate)),
      );
      if (serverName) {
        matchedServers.add(serverName);
        return true;
      }
      return !definition.function.description.startsWith('MCP server "');
    });
    if ([...requiredServers].some((serverName) => !matchedServers.has(serverName))) {
      return [...definitions];
    }
    return selected.length > 0 ? selected : [...definitions];
  }
  const selected = definitions.filter((definition) => required.has(definition.function.name));
  return selected.length > 0 ? selected : [...definitions];
}

function mcpServerDescriptionPrefix(serverName: string): string {
  return `MCP server "${serverName}".`;
}

/** 매 도구 라운드마다 최신 사용자 목표를 provider 대화의 마지막에 다시 고정합니다. */
export function appendAgenticCheckpoint(
  messages: readonly ChatMessage[],
  checkpoint: string,
): ChatMessage[] {
  if (!checkpoint.trim()) return [...messages];
  return [...messages, { role: 'user', content: checkpoint }];
}
