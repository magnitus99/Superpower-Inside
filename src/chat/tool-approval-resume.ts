import type { ToolDefinition } from '../llm/providers';
import { withDataBoundaryProviderUsage } from './context-composer';
import { selectPreviousUserQuestions } from './conversation-variants';
import { selectProviderReinjectableToolCalls } from './tool-execution';
import { createCompatibilityToolPrompt, createNativeVaultEvidencePrompt } from './tool-protocol';
import type { ChatMessageWithMeta, DataBoundarySnapshot, ToolCallRecord } from './types';

export interface ToolApprovalQuestionContext {
  currentQuestion: string;
  previousUserQuestions: string[];
}

export interface ToolApprovalResumePlan {
  systemPrompt: string | null;
  providerToolDefinitions: ToolDefinition[];
  reinjectedToolResultCount: number;
  dataBoundarySnapshot?: DataBoundarySnapshot;
}

export function resolveToolApprovalQuestionContext(
  messages: readonly ChatMessageWithMeta[],
  assistantMessageId: string,
  fallbackQuestion: string,
): ToolApprovalQuestionContext {
  const messageIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const currentUserMessage = [...messages.slice(0, Math.max(0, messageIndex))]
    .reverse()
    .find((message) => message.role === 'user');
  return {
    currentQuestion: currentUserMessage?.content ?? fallbackQuestion,
    previousUserQuestions: currentUserMessage
      ? selectPreviousUserQuestions(messages, currentUserMessage.id)
      : [],
  };
}

export function createToolApprovalResumePlan(input: {
  promptSystemPrompt: string | null;
  toolDefinitions: readonly ToolDefinition[];
  providerSupportsToolCalling: boolean;
  toolCalls: readonly ToolCallRecord[];
  dataBoundarySnapshot?: DataBoundarySnapshot;
}): ToolApprovalResumePlan {
  const toolPrompt = input.providerSupportsToolCalling
    ? createNativeVaultEvidencePrompt(input.toolDefinitions)
    : createCompatibilityToolPrompt(input.toolDefinitions);
  const systemPrompt =
    [input.promptSystemPrompt, toolPrompt]
      .filter((part): part is string => Boolean(part))
      .join('\n\n') || null;
  const reinjectedToolResultCount = selectProviderReinjectableToolCalls(input.toolCalls).length;
  return {
    systemPrompt,
    providerToolDefinitions: input.providerSupportsToolCalling ? [...input.toolDefinitions] : [],
    reinjectedToolResultCount,
    dataBoundarySnapshot: input.dataBoundarySnapshot
      ? withDataBoundaryProviderUsage(input.dataBoundarySnapshot, {
          toolResultCount: reinjectedToolResultCount,
        })
      : undefined,
  };
}
