import type { ChatMessageWithMeta } from './types';

export interface RegenerationDraft {
  text: string;
  previousUserId: string;
  variantOf: string;
  branchRoot: string;
}

export interface VariantComparisonRow {
  id: string;
  providerText: string;
  citationCount: number;
  sourceWarningCount: number;
  toolCallCount: number;
  stopReason: string;
  contextAttachmentCount: number;
  active: boolean;
}

export function selectPreviousUserQuestions(
  messages: readonly ChatMessageWithMeta[],
  beforeUserMessageId?: string,
): string[] {
  const boundaryIndex = beforeUserMessageId
    ? messages.findIndex((message) => message.id === beforeUserMessageId && message.role === 'user')
    : messages.length;
  if (boundaryIndex < 0) return [];

  const previousUser = [...messages.slice(0, boundaryIndex)]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim().length > 0);
  return previousUser ? [previousUser.content.trim()] : [];
}

export function createRegenerationDraft(
  messages: readonly ChatMessageWithMeta[],
  assistantMessageId: string,
): RegenerationDraft | null {
  const index = messages.findIndex((message) => message.id === assistantMessageId);
  if (index <= 0) return null;
  const previousUser = [...messages.slice(0, index)]
    .reverse()
    .find((message) => message.role === 'user');
  if (!previousUser) return null;
  return {
    text: previousUser.content,
    previousUserId: previousUser.id,
    variantOf: assistantMessageId,
    branchRoot: previousUser.branchRoot ?? previousUser.id,
  };
}

export function createVariantComparisonRows(
  messages: readonly ChatMessageWithMeta[],
  activeMessageId: string,
): VariantComparisonRow[] {
  const active = messages.find((message) => message.id === activeMessageId);
  if (!active || active.role !== 'assistant') return [];
  const rootId = active.variantOf ?? active.id;
  const variants = messages.filter(
    (message) =>
      message.role === 'assistant' && (message.id === rootId || message.variantOf === rootId),
  );
  if (variants.length < 2) return [];
  return variants.map((message) => ({
    id: message.id,
    providerText: [message.providerLabel, message.model].filter(Boolean).join(' / ') || '-',
    citationCount: message.citations?.length ?? 0,
    sourceWarningCount: message.sourceWarnings?.length ?? 0,
    toolCallCount: message.toolCalls?.length ?? 0,
    stopReason: message.stopReason ?? '-',
    contextAttachmentCount: message.contextAttachments?.length ?? 0,
    active: message.id === activeMessageId,
  }));
}

export function markMessageRegenerated(
  message: ChatMessageWithMeta,
  at = new Date().toISOString(),
): ChatMessageWithMeta {
  return {
    ...message,
    updatedAt: at,
    actionHistory: [
      ...(message.actionHistory ?? []),
      {
        id: `action-${at}`,
        action: 'regenerate',
        at,
      },
    ],
  };
}
