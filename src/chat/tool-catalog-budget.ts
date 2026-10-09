import type { ToolDefinition } from '../llm/providers';
import { ExplicitMcpToolDiscoveryError } from './mcp-tool-catalog';
import { getMcpToolDefinitionBinding } from './mcp-tool-wire';

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
  const definitionLimit = clampCatalogLimit(maxDefinitions, MAX_CHAT_TOOL_DEFINITIONS);
  const byteLimit = clampCatalogLimit(maxBytes, MAX_CHAT_TOOL_CATALOG_BYTES);
  const selected: ToolDefinition[] = [];
  const names = new Set<string>();
  let usedBytes = 2;

  const append = (definition: ToolDefinition): boolean => {
    const name = definition.function.name.trim();
    if (!name || names.has(name) || selected.length >= definitionLimit) return false;
    const bytes = definitionBytes(definition);
    const incrementalBytes = bytes + (selected.length > 0 ? 1 : 0);
    if (usedBytes + incrementalBytes > byteLimit) return false;
    names.add(name);
    selected.push(definition);
    usedBytes += incrementalBytes;
    return true;
  };

  requiredDefinitions.forEach((definition) => append(definition));

  const explicitDefinitionsByServer = new Map<string, ToolDefinition[]>();
  for (const definition of externalDefinitions) {
    const binding = getMcpToolDefinitionBinding(definition);
    if (!binding?.explicitlyMentioned) continue;
    const serverDefinitions = explicitDefinitionsByServer.get(binding.serverName) ?? [];
    serverDefinitions.push(definition);
    explicitDefinitionsByServer.set(binding.serverName, serverDefinitions);
  }

  for (const [serverName, definitions] of explicitDefinitionsByServer) {
    const representative = definitions
      .map((definition, index) => ({
        definition,
        index,
        bytes: definitionBytes(definition),
      }))
      .filter(
        ({ definition, bytes }) =>
          definition.function.name.trim().length > 0 &&
          !names.has(definition.function.name.trim()) &&
          usedBytes + bytes + (selected.length > 0 ? 1 : 0) <= byteLimit,
      )
      .sort((left, right) => left.bytes - right.bytes || left.index - right.index)[0]?.definition;
    if (!representative || !append(representative)) {
      throw new ExplicitMcpToolDiscoveryError(serverName, {
        cause: new Error('Explicit MCP server has no tool that fits the provider catalog budget'),
      });
    }
  }

  externalDefinitions.forEach((definition) => append(definition));
  return selected;
}

function definitionBytes(definition: ToolDefinition): number {
  try {
    return new TextEncoder().encode(JSON.stringify(definition)).byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function clampCatalogLimit(value: number, hardLimit: number): number {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? hardLimit : 0;
  return Math.max(0, Math.min(Math.floor(value), hardLimit));
}
