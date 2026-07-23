import type { ToolDefinition } from '../llm/providers';
import { planCompatibilityToolCallsRust, stripCompatibilityToolCallsRust } from '../rag/rust-core';
import type { ToolCallRecord } from './types';

export interface CompatibilityToolParseResult {
  visibleContent: string;
  toolCalls: ToolCallRecord[];
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
    `Available tools: ${JSON.stringify(catalog)}`,
  ].join('\n');
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
