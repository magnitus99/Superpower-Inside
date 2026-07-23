import {
  NATIVE_VAULT_TOOL_LABEL,
  type NativeVaultToolRuntimeLike,
} from '../agent/native-vault-tool';
import type { ToolExecutionPolicy } from './types';
import type { ToolCallRecord } from './types';
import type { SourceCitation } from './types';
import type { ChatMessage } from '../llm/providers';
import { planRepeatedToolCallIndicesRust } from '../rag/rust-core';
import { t } from '../i18n';
import {
  executeMcpToolCalls,
  prepareToolCallsForExecution,
  type MCPRegistryLike,
} from './mcp-tool-execution';

interface AssistantToolOptions {
  toolCalls: ToolCallRecord[];
  nativeTool: NativeVaultToolRuntimeLike;
  registry: MCPRegistryLike | null;
  preferredServerNames: string[];
}

export interface PrepareAssistantToolCallsOptions extends AssistantToolOptions {
  mcpMode: ToolExecutionPolicy['mode'];
}

export interface ExecuteAssistantToolCallsOptions extends AssistantToolOptions {
  onUpdate?: (toolCalls: ToolCallRecord[]) => void;
  signal?: AbortSignal;
}

export async function prepareAssistantToolCalls(
  options: PrepareAssistantToolCallsOptions,
): Promise<ToolCallRecord[]> {
  const prepared = options.toolCalls.map((toolCall) => ({ ...toolCall }));
  const mcpIndices: number[] = [];
  const mcpCalls: ToolCallRecord[] = [];

  prepared.forEach((toolCall, index) => {
    if (options.nativeTool.isNativeTool(toolCall.name)) {
      toolCall.approved = true;
      toolCall.executionKind = 'native';
      toolCall.serverName = NATIVE_VAULT_TOOL_LABEL;
      return;
    }
    mcpIndices.push(index);
    mcpCalls.push(toolCall);
  });

  const preparedMcpCalls = await prepareToolCallsForExecution(
    mcpCalls,
    options.registry,
    options.preferredServerNames,
    options.mcpMode,
  );
  preparedMcpCalls.forEach((toolCall, index) => {
    const targetIndex = mcpIndices[index];
    if (targetIndex !== undefined) prepared[targetIndex] = { ...toolCall, executionKind: 'mcp' };
  });
  return prepared;
}

export async function executeAssistantToolCalls(
  options: ExecuteAssistantToolCallsOptions,
): Promise<ToolCallRecord[]> {
  const updated = options.toolCalls.map((toolCall) => ({ ...toolCall }));
  options.onUpdate?.(updated);

  for (let index = 0; index < updated.length; index++) {
    throwIfAborted(options.signal);
    const toolCall = updated[index];
    if (!toolCall || toolCall.status !== 'running' || toolCall.approved === false) continue;

    if (options.nativeTool.isNativeTool(toolCall.name)) {
      await executeNativeToolCall(toolCall, options.nativeTool, options.signal);
      options.onUpdate?.(updated);
      continue;
    }

    const executed = await executeMcpToolCalls({
      registry: options.registry,
      toolCalls: [toolCall],
      preferredServerNames: options.preferredServerNames,
      signal: options.signal,
    });
    const result = executed[0];
    if (result) updated[index] = { ...result, executionKind: 'mcp' };
    options.onUpdate?.(updated);
  }

  options.onUpdate?.(updated);
  return updated;
}

export function collectToolCitations(
  baseCitations: readonly SourceCitation[],
  toolCalls: readonly ToolCallRecord[],
): SourceCitation[] {
  const citationsById = new Map(baseCitations.map((citation) => [citation.id, citation]));
  for (const toolCall of toolCalls) {
    for (const citation of toolCall.citations ?? []) {
      if (!citationsById.has(citation.id)) citationsById.set(citation.id, citation);
    }
  }
  return [...citationsById.values()];
}

export function markRepeatedToolCalls(
  history: readonly ToolCallRecord[],
  candidates: readonly ToolCallRecord[],
  maxRepeats = 2,
): ToolCallRecord[] {
  const completedHistory = history.filter(
    (toolCall) => toolCall.status === 'success' || toolCall.status === 'error',
  );
  const repeatedIndices = planRepeatedToolCallIndicesRust(
    completedHistory.map(({ name, arguments: toolArguments }) => ({
      name,
      arguments: toolArguments,
    })),
    candidates.map(({ name, arguments: toolArguments }) => ({
      name,
      arguments: toolArguments,
    })),
    maxRepeats,
  );
  if (!repeatedIndices) throw new Error(t('toolLoopPolicyUnavailable'));
  const repeated = new Set(repeatedIndices);
  return candidates.map((toolCall, index) =>
    repeated.has(index)
      ? {
          ...toolCall,
          status: 'error',
          result: t('repeatedToolCallBlocked'),
          resultSummary: t('repeatedToolCallBlocked'),
        }
      : { ...toolCall },
  );
}

export function appendAssistantToolRound(
  messages: readonly ChatMessage[],
  assistantContent: string,
  toolCalls: readonly ToolCallRecord[],
): ChatMessage[] {
  const completedToolCalls = toolCalls.filter(
    (toolCall) =>
      (toolCall.status === 'success' || toolCall.status === 'error') &&
      (toolCall.normalizedResult || toolCall.result),
  );
  if (completedToolCalls.length === 0) return [...messages];
  return [
    ...messages,
    {
      role: 'assistant',
      content: assistantContent,
      toolCalls: completedToolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    },
    ...completedToolCalls.map((toolCall) => ({
      role: 'tool' as const,
      content: toolCall.normalizedResult ?? toolCall.result ?? '',
      tool_call_id: toolCall.id,
      name: toolCall.name,
      tool_result_is_error: toolCall.status === 'error',
    })),
  ];
}

async function executeNativeToolCall(
  toolCall: ToolCallRecord,
  nativeTool: NativeVaultToolRuntimeLike,
  signal?: AbortSignal,
): Promise<void> {
  toolCall.executionKind = 'native';
  toolCall.serverName = NATIVE_VAULT_TOOL_LABEL;
  try {
    const result = signal
      ? await nativeTool.execute(toolCall.arguments, signal)
      : await nativeTool.execute(toolCall.arguments);
    toolCall.result = result.displayText;
    toolCall.resultSummary = result.displayText;
    toolCall.normalizedResult = result.modelText;
    toolCall.citations = [...result.citations];
    toolCall.status = 'success';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    toolCall.result = error instanceof Error ? error.message : String(error);
    toolCall.status = 'error';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
}
