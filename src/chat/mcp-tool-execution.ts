import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import type { MCPServerConfig } from '../settings';
import { t } from '../i18n';
import {
  createToolExecutionPolicy,
  normalizeToolResult,
  shouldAutoExecuteToolCall,
} from './mcp-tools';
import type { ToolCallRecord, ToolExecutionPolicy } from './types';

export interface MCPToolClientLike {
  listTools(): Promise<
    { name: string; description?: string; inputSchema?: Record<string, unknown> }[]
  >;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface MCPRegistryLike {
  getConnectionStatus(name: string): MCPServerConnectionStatus;
  getEnabledServers(): Pick<MCPServerConfig, 'name'>[];
  getClient(name: string): MCPToolClientLike | undefined;
}

export interface ExecuteMcpToolCallsOptions {
  registry: MCPRegistryLike | null;
  toolCalls: ToolCallRecord[];
  preferredServerNames: string[];
  onUpdate?: (toolCalls: ToolCallRecord[]) => void;
}

export async function prepareToolCallsForExecution(
  toolCalls: ToolCallRecord[],
  registry: MCPRegistryLike | null,
  mentionedServerNames: string[],
  mode: ToolExecutionPolicy['mode'],
): Promise<ToolCallRecord[]> {
  const policy = createToolExecutionPolicy(mode);
  const prepared: ToolCallRecord[] = [];
  for (const toolCall of toolCalls) {
    const next = { ...toolCall };
    if (next.status !== 'running') {
      prepared.push(next);
      continue;
    }
    if (!next.serverName) {
      const serverName = await findServerForTool(registry, next.name, mentionedServerNames);
      if (serverName) next.serverName = serverName;
    }
    next.approved = shouldAutoExecuteToolCall(next, policy, mentionedServerNames);
    prepared.push(next);
  }
  return prepared;
}

export async function executeMcpToolCalls(
  options: ExecuteMcpToolCallsOptions,
): Promise<ToolCallRecord[]> {
  const updatedToolCalls = options.toolCalls.map((toolCall) => ({ ...toolCall }));
  options.onUpdate?.(updatedToolCalls);

  for (const toolCall of updatedToolCalls) {
    if (toolCall.approved === false) {
      continue;
    }

    const serverName = await findServerForTool(
      options.registry,
      toolCall.name,
      options.preferredServerNames,
    );
    if (!serverName) {
      toolCall.status = 'error';
      toolCall.result = t('mcpToolNotFoundInConnectedServers', { tool: toolCall.name });
      options.onUpdate?.(updatedToolCalls);
      continue;
    }

    const client = options.registry?.getClient(serverName);
    if (!client) {
      toolCall.status = 'error';
      toolCall.result = t('mcpServerNotConnected', { server: serverName });
      options.onUpdate?.(updatedToolCalls);
      continue;
    }

    toolCall.serverName = serverName;

    try {
      const result = await client.callTool(toolCall.name, parseToolArguments(toolCall.arguments));
      assertMcpContentIsNotEmpty(toolCall.name, result);
      const isErrorResult =
        typeof result === 'object' &&
        result !== null &&
        'isError' in result &&
        result.isError === true;
      const normalized = normalizeToolResult(result);
      assertNonEmptyToolResult(toolCall.name, normalized.displayText, normalized.modelText);
      toolCall.result = normalized.displayText;
      toolCall.resultSummary = normalized.displayText;
      toolCall.normalizedResult = normalized.modelText;
      toolCall.status = isErrorResult ? 'error' : 'success';
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      toolCall.result = t('mcpToolErrorPrefix', { message: normalizeToolError(rawMsg) });
      toolCall.status = 'error';
    }

    options.onUpdate?.(updatedToolCalls);
  }

  options.onUpdate?.(updatedToolCalls);
  return updatedToolCalls;
}

export async function findServerForTool(
  registry: MCPRegistryLike | null,
  toolName: string,
  preferredServerNames: string[],
): Promise<string | null> {
  if (!registry) return null;

  const preferred = preferredServerNames.filter(
    (serverName) => registry.getConnectionStatus(serverName) === 'connected',
  );
  const fallback = registry
    .getEnabledServers()
    .map((server) => server.name)
    .filter(
      (serverName) =>
        registry.getConnectionStatus(serverName) === 'connected' && !preferred.includes(serverName),
    );

  for (const serverName of [...preferred, ...fallback]) {
    const client = registry.getClient(serverName);
    if (!client) continue;
    try {
      const tools = await client.listTools();
      if (tools.some((tool) => tool.name === toolName)) {
        return serverName;
      }
    } catch {
      // 연결이 불안정한 서버는 다음 후보로 넘어갑니다.
    }
  }

  return null;
}

export function parseToolArguments(argumentsText: string): Record<string, unknown> {
  const trimmed = argumentsText.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { input: parsed };
  } catch {
    return { input: argumentsText };
  }
}

function assertNonEmptyToolResult(toolName: string, displayText: string, modelText: string): void {
  if (displayText.trim().length === 0 || modelText.trim().length === 0) {
    throw new Error(t('mcpToolEmptyResult', { tool: toolName }));
  }
}

function assertMcpContentIsNotEmpty(toolName: string, result: unknown): void {
  if (!isRecord(result) || !Array.isArray(result.content)) return;
  const hasContent = result.content.some((item) => {
    if (!isRecord(item)) return false;
    if (item.type === 'text') {
      return typeof item.text === 'string' && item.text.trim().length > 0;
    }
    return Object.keys(item).length > 0;
  });
  if (!hasContent) {
    throw new Error(t('mcpToolEmptyResult', { tool: toolName }));
  }
}

function normalizeToolError(rawMsg: string): string {
  if (rawMsg.includes('Input validation error')) {
    const match = rawMsg.match(/does not match '(.+?)'/);
    if (match) {
      return t('mcpValidationPattern', { pattern: match[1] });
    }
    const fieldMatch = rawMsg.match(/'([^']+)'/);
    if (fieldMatch) {
      return t('mcpValidationField', { field: fieldMatch[1] });
    }
    return t('mcpValidationGeneric');
  }
  return rawMsg;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
