import { t } from '../i18n';
import type { ChatTurnStage } from './turn-state';
import type { ChatMessageStatus, ChatMessageWithMeta } from './types';

export type ChatMessageMetaKind = 'role' | 'timestamp' | 'status';

export interface ChatMessageMetaItem {
  kind: ChatMessageMetaKind;
  className: string;
  text: string;
  title?: string;
}

export function createChatMessageMetaItems(
  msg: ChatMessageWithMeta,
  referenceDate = new Date(),
): ChatMessageMetaItem[] {
  const items: ChatMessageMetaItem[] = [];

  if (msg.role !== 'user') {
    items.push({
      kind: 'role',
      className: 'superpower-inside-chat-role',
      text: getRoleLabel(msg.role),
    });
  }

  items.push({
    kind: 'timestamp',
    className: 'superpower-inside-chat-timestamp',
    text: formatChatMessageTimestamp(msg.createdAt, referenceDate),
  });

  const statusText = msg.turnStage
    ? getTurnStageLabel(msg.turnStage)
    : getMessageStatusLabel(msg.status);
  const isComplete = msg.turnStage ? msg.turnStage === 'complete' : msg.status === 'complete';
  if (msg.role !== 'user' || !isComplete) {
    items.push({
      kind: 'status',
      className: `superpower-inside-chat-message-status ${msg.status}`,
      text: statusText,
      title: msg.errorKind ? msg.content : msg.errorMessage,
    });
  }

  return items;
}

export function createChatMessageTechnicalSummary(msg: ChatMessageWithMeta): string | undefined {
  const provider = msg.providerLabel ?? msg.providerCapability?.providerKey;
  const model = msg.model ?? msg.providerCapability?.model;
  const providerAndModel = [provider, model]
    .filter((value): value is string => Boolean(value))
    .join(' / ');
  const capability = msg.providerCapability
    ? getProviderCapabilityLabel(msg.providerCapability)
    : undefined;
  const details = [providerAndModel, capability].filter((value) => Boolean(value));

  return details.length > 0 ? details.join(' · ') : undefined;
}

export function formatChatMessageTimestamp(value: string, referenceDate: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  if (isSameLocalDate(date, referenceDate)) {
    return new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  const includeYear =
    Number.isNaN(referenceDate.getTime()) || date.getFullYear() !== referenceDate.getFullYear();
  return new Intl.DateTimeFormat('ko-KR', {
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    !Number.isNaN(right.getTime()) &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return t('messageUser');
    case 'assistant':
      return t('assistantDisplayName');
    case 'system':
      return t('messageSystem');
    case 'tool':
      return t('messageTool');
    default:
      return role;
  }
}

function getProviderCapabilityLabel(
  capability: NonNullable<ChatMessageWithMeta['providerCapability']>,
): string {
  if (!capability.streaming && !capability.toolCalling) {
    return t('providerCapabilityBufferedNoTools');
  }
  if (!capability.streaming) {
    return t('providerCapabilityBuffered');
  }
  if (!capability.toolCalling) {
    return t('providerCapabilityNoTools');
  }
  return capability.reasoning
    ? t('providerCapabilityStreamingReasoning')
    : t('providerCapabilityStreaming');
}

function getTurnStageLabel(stage: ChatTurnStage): string {
  switch (stage) {
    case 'draft':
      return t('turnStageDraft');
    case 'building-context':
      return t('turnStageBuildingContext');
    case 'waiting-provider':
      return t('turnStageWaitingProvider');
    case 'streaming-reasoning':
      return t('turnStageStreamingReasoning');
    case 'streaming-answer':
      return t('turnStageStreamingAnswer');
    case 'planning-tools':
      return t('turnStagePlanningTools');
    case 'awaiting-tool-approval':
      return t('turnStageAwaitingToolApproval');
    case 'running-tools':
      return t('turnStageRunningTools');
    case 'finalizing-after-tools':
      return t('turnStageFinalizingAfterTools');
    case 'complete':
      return t('turnStageComplete');
    case 'cancelled':
      return t('turnStageCancelled');
    case 'error':
      return t('turnStageError');
  }
}

function getMessageStatusLabel(status: ChatMessageStatus): string {
  switch (status) {
    case 'pending':
      return t('chatStatusIdle');
    case 'streaming':
      return t('chatStatusRunning');
    case 'complete':
      return t('chatStatusDone');
    case 'error':
      return t('chatStatusError');
  }
}
