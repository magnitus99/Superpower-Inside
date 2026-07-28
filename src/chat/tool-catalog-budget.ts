import type { ToolDefinition } from '../llm/providers';

export const MAX_CHAT_TOOL_DEFINITIONS = 64;
export const MAX_CHAT_TOOL_CATALOG_BYTES = 256 * 1024;

/**
 * Provider 요청에 포함할 도구 카탈로그를 이름·UTF-8 바이트 예산 안으로 제한합니다.
 * 내장 도구는 항상 먼저 보존하고, 외부 도구는 서버가 제공한 안정적인 순서를 유지합니다.
 */
export function selectBoundedToolDefinitions(
  requiredDefinitions: readonly ToolDefinition[],
  externalDefinitions: readonly ToolDefinition[],
  maxDefinitions = MAX_CHAT_TOOL_DEFINITIONS,
  maxBytes = MAX_CHAT_TOOL_CATALOG_BYTES,
): ToolDefinition[] {
  const selected: ToolDefinition[] = [];
  const names = new Set<string>();
  let usedBytes = 0;

  const append = (definition: ToolDefinition, required: boolean): void => {
    const name = definition.function.name.trim();
    if (!name || names.has(name) || selected.length >= maxDefinitions) return;
    const bytes = definitionBytes(definition);
    if (!required && usedBytes + bytes > maxBytes) return;
    names.add(name);
    selected.push(definition);
    usedBytes += bytes;
  };

  requiredDefinitions.forEach((definition) => append(definition, true));
  externalDefinitions.forEach((definition) => append(definition, false));
  return selected;
}

function definitionBytes(definition: ToolDefinition): number {
  try {
    return new TextEncoder().encode(JSON.stringify(definition)).byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
