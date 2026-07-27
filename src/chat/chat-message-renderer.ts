import { t } from '../i18n';
import type { ChatTurnStage } from './turn-state';
import type { ChatMessageStatus, ChatMessageWithMeta } from './types';

export type ChatMessageMetaKind = 'role' | 'timestamp' | 'model' | 'capability' | 'status';

export interface ChatMessageMetaItem {
  kind: ChatMessageMetaKind;
  className: string;
  text: string;
  title?: string;
}

export function createChatMessageMetaItems(msg: ChatMessageWithMeta): ChatMessageMetaItem[] {
  const items: ChatMessageMetaItem[] = [
    {
      kind: 'role',
      className: 'superpower-inside-chat-role',
      text: getRoleLabel(msg.role),
    },
    {
      kind: 'timestamp',
      className: 'superpower-inside-chat-timestamp',
      text: formatChatMessageTimestamp(msg.createdAt),
    },
  ];

  if (msg.providerLabel || msg.model) {
    items.push({
      kind: 'model',
      className: 'superpower-inside-chat-model-meta',
      text: [msg.providerLabel, msg.model].filter(Boolean).join(' / '),
    });
  }

  if (msg.providerCapability) {
    items.push({
      kind: 'capability',
      className: 'superpower-inside-chat-capability-meta',
      text: getProviderCapabilityLabel(msg.providerCapability),
    });
  }

  const statusText = msg.turnStage
    ? getTurnStageLabel(msg.turnStage)
    : getMessageStatusLabel(msg.status);
  items.push({
    kind: 'status',
    className: `superpower-inside-chat-message-status ${msg.status}`,
    text: statusText,
    title: msg.errorKind ? msg.content : msg.errorMessage,
  });

  return items;
}

export function formatChatMessageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return t('messageUser');
    case 'assistant':
      return t('messageAssistant');
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
