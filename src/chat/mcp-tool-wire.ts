import type { ToolDefinition } from '../llm/providers';

export const MAX_PROVIDER_TOOL_NAME_LENGTH = 64;
const MAX_ALIAS_ATTEMPTS = 64;
const SERVER_SEGMENT_LENGTH = 14;
const TOOL_SEGMENT_LENGTH = 22;

export interface McpToolDefinitionBinding {
  serverName: string;
  actualToolName: string;
  providerToolName: string;
  explicitlyMentioned: boolean;
}

export type McpToolBindingAllowlist = ReadonlyMap<string, McpToolDefinitionBinding>;

const bindings = new WeakMap<ToolDefinition, McpToolDefinitionBinding>();

/** provider에 보내지 않는 host 전용 MCP binding을 정의 객체에 연결합니다. */
export function bindMcpToolDefinition(
  definition: ToolDefinition,
  binding: McpToolDefinitionBinding,
): ToolDefinition {
  bindings.set(definition, binding);
  return definition;
}

/** 카탈로그 예산 단계에서 host 전용 MCP binding을 조회합니다. */
export function getMcpToolDefinitionBinding(
  definition: ToolDefinition,
): McpToolDefinitionBinding | undefined {
  return bindings.get(definition);
}

/** 실제로 provider에 노출한 bounded 정의만 exact 실행 allowlist로 변환합니다. */
export function createMcpToolBindingAllowlist(
  definitions: readonly ToolDefinition[],
): McpToolBindingAllowlist {
  const allowlist = new Map<string, McpToolDefinitionBinding>();
  for (const definition of definitions) {
    const binding = getMcpToolDefinitionBinding(definition);
    if (binding) allowlist.set(binding.providerToolName, binding);
  }
  return allowlist;
}

/** OpenAI-compatible function name 제약을 만족하는지 확인합니다. */
export function isProviderSafeToolName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_PROVIDER_TOOL_NAME_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(name)
  );
}

/** 서버와 실제 도구 이름으로 충돌 도구의 provider-visible alias를 결정합니다. */
export function createMcpProviderToolAlias(
  serverName: string,
  actualToolName: string,
  attempt = 0,
): string {
  const server = providerSegment(serverName, 'server', SERVER_SEGMENT_LENGTH);
  const tool = providerSegment(actualToolName, 'tool', TOOL_SEGMENT_LENGTH);
  const identity = `${serverName}\u{0}${actualToolName}\u{0}${attempt}`;
  const hash = `${stableHash(identity, 0x811c9dc5)}${stableHash(identity, 0x9e3779b9)}`;
  return `mcp_${server}_${tool}_${hash}`;
}

/** 실행 시 alias가 정확한 서버·실제 이름 binding에 해당하는지 확인합니다. */
export function matchesMcpProviderToolAlias(
  providerToolName: string,
  serverName: string,
  actualToolName: string,
): boolean {
  for (let attempt = 0; attempt < MAX_ALIAS_ATTEMPTS; attempt += 1) {
    if (createMcpProviderToolAlias(serverName, actualToolName, attempt) === providerToolName) {
      return true;
    }
  }
  return false;
}

/** 충돌 회피 시도 상한 안에서 아직 사용하지 않은 deterministic alias를 선택합니다. */
export function selectAvailableMcpProviderToolAlias(
  serverName: string,
  actualToolName: string,
  unavailableNames: ReadonlySet<string>,
): string | null {
  for (let attempt = 0; attempt < MAX_ALIAS_ATTEMPTS; attempt += 1) {
    const alias = createMcpProviderToolAlias(serverName, actualToolName, attempt);
    if (!unavailableNames.has(alias)) return alias;
  }
  return null;
}

/** 기존 서버 selector prefix와 실제 도구 이름을 함께 보존합니다. */
export function createMcpToolDescription(
  serverName: string,
  actualToolName: string,
  description?: string,
): string {
  return [
    `MCP server "${serverName}".`,
    `Actual tool "${actualToolName}".`,
    description?.trim(),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function providerSegment(value: string, fallback: string, maxLength: number): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
  return normalized || fallback;
}

function stableHash(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
