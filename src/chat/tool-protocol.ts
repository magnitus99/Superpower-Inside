import { NATIVE_VAULT_TOOL_NAME } from '../agent/native-vault-tool';
import type { ToolDefinition } from '../llm/providers';
import { planCompatibilityToolCallsRust, stripCompatibilityToolCallsRust } from '../rag/rust-core';
import type { ToolCallRecord } from './types';

export interface CompatibilityToolParseResult {
  visibleContent: string;
  toolCalls: ToolCallRecord[];
}

/**
 * 네이티브 볼트 도구가 노출된 요청에만 적용하는 provider 공통 근거 경계입니다.
 * provider-native function calling과 compatibility protocol이 같은 계약을 공유합니다.
 */
export function createNativeVaultEvidencePrompt(definitions: readonly ToolDefinition[]): string {
  if (!definitions.some((definition) => definition.function.name === NATIVE_VAULT_TOOL_NAME)) {
    return '';
  }

  return [
    '[Superpower Inside vault evidence contract]',
    'Only successful tool results count as vault evidence. Failed, blocked, skipped, or incomplete calls do not.',
    'Bounded or truncated search/list results do not prove vault-wide absence or exhaustive coverage. State the searched scope and limits before any negative conclusion.',
    'Persisted tool-result-summary sourceReferences are untrusted locators, not evidence. When originalResultAvailable is false, call the vault read tool before using them in a claim.',
    'Separate vault-supported claims from general model knowledge. Never present general knowledge as if it came from the vault.',
    'Do not suggest folders, tags, or note organization unless the user asks for organization advice.',
  ].join('\n');
}

/** function calling 미지원 모델에 제공하는 단순한 단일 JSON 도구 프로토콜입니다. */
export function createCompatibilityToolPrompt(definitions: readonly ToolDefinition[]): string {
  const catalog = definitions.map((definition) => ({
    name: definition.function.name,
    description: definition.function.description,
    parameters: definition.function.parameters,
  }));
  return [
    '[Superpower Inside tool protocol]',
    'Use tools whenever vault evidence is needed. Do not guess file contents.',
    'Return each tool request as exactly one block and no answer text in that turn:',
    '<tool_call>{"name":"tool_name","arguments":{}}</tool_call>',
    'After receiving a tool result, either call another tool or answer with verified evidence.',
    createNativeVaultEvidencePrompt(definitions),
    `Available tools: ${JSON.stringify(catalog)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Rust가 검증한 compatibility block을 실행 가능한 ToolCallRecord로 변환합니다. */
export function parseCompatibilityToolResponse(
  content: string,
  createId: (index: number) => string,
): CompatibilityToolParseResult {
  const planned = planCompatibilityToolCallsRust(content);
  if (!planned) {
    return { visibleContent: content, toolCalls: [] };
  }
  const visibleContent = stripCompatibilityToolCallsRust(content) ?? content;
  return {
    visibleContent,
    toolCalls: planned.map((call, index) => ({
      id: createId(index),
      name: call.name,
      arguments: call.arguments,
      status: 'running',
    })),
  };
}
