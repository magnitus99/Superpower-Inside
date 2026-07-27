import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import type { MCPServerConfig } from '../settings';
import { t } from '../i18n';
import { isMcpToolAvailableRust, planMcpServerCandidatesRust } from '../rag/rust-core';
import {
  createToolExecutionPolicy,
  classifyMcpToolError,
  isMcpToolResultEmpty,
  normalizeToolResult,
  parseToolArguments as parseMcpToolArguments,
  shouldAutoExecuteToolCall,
} from './mcp-tools';
import type { ToolCallRecord, ToolExecutionPolicy } from './types';

export interface MCPToolClientLike {
  listTools(): Promise<
    { name: string; description?: string; inputSchema?: Record<string, unknown> }[]
  >;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
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
  signal?: AbortSignal;
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
    throwIfAborted(options.signal);
    if (toolCall.status !== 'running' || toolCall.approved === false) {
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
      const args = parseToolArguments(toolCall.arguments);
      const result = options.signal
        ? await client.callTool(toolCall.name, args, options.signal)
        : await client.callTool(toolCall.name, args);
      throwIfAborted(options.signal);
      const isErrorResult =
        typeof result === 'object' &&
        result !== null &&
        'isError' in result &&
        result.isError === true;
      const normalized = normalizeToolResult(result);
      if (isMcpToolResultEmpty(result, normalized)) {
        throw new Error(t('mcpToolEmptyResult', { tool: toolCall.name }));
      }
      toolCall.result = normalized.displayText;
      toolCall.resultSummary = normalized.displayText;
      toolCall.normalizedResult = normalized.modelText;
      toolCall.status = isErrorResult ? 'error' : 'success';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      toolCall.result = t('mcpToolErrorPrefix', { message: normalizeToolError(rawMsg) });
      toolCall.status = 'error';
    }

    options.onUpdate?.(updatedToolCalls);
  }

  options.onUpdate?.(updatedToolCalls);
  return updatedToolCalls;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
}

export async function findServerForTool(
  registry: MCPRegistryLike | null,
  toolName: string,
  preferredServerNames: string[],
): Promise<string | null> {
  if (!registry) return null;

  const enabledServerNames = registry.getEnabledServers().map((server) => server.name);
  const connectionStatuses: Record<string, string> = {};
  for (const serverName of preferredServerNames) {
    connectionStatuses[serverName] = registry.getConnectionStatus(serverName);
  }
  for (const serverName of enabledServerNames) {
    connectionStatuses[serverName] = registry.getConnectionStatus(serverName);
  }
  const candidateServerNames =
    planMcpServerCandidatesRust(preferredServerNames, enabledServerNames, connectionStatuses) ?? [];

  for (const serverName of candidateServerNames) {
    const client = registry.getClient(serverName);
    if (!client) continue;
    try {
      const tools = await client.listTools();
      if (
        isMcpToolAvailableRust(
          toolName,
          tools.map((tool) => tool.name),
        ) === true
      ) {
        return serverName;
      }
    } catch {
      // 연결이 불안정한 서버는 다음 후보로 넘어갑니다.
    }
  }

  return null;
}

export function parseToolArguments(argumentsText: string): Record<string, unknown> {
  return parseMcpToolArguments(argumentsText);
}

function normalizeToolError(rawMsg: string): string {
  return classifyMcpToolError(rawMsg);
}
