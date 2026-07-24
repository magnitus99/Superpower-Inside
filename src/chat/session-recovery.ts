import { normalizeLoadedChatErrorContent } from './chat-error-actions';
import type { ChatMessageWithMeta } from './types';

const ACTIVE_TURN_STAGES = new Set([
  'building-context',
  'waiting-provider',
  'streaming-reasoning',
  'streaming-answer',
  'planning-tools',
  'running-tools',
  'finalizing-after-tools',
]);

export interface LoadedSessionMessageOptions {
  cancelledText: string;
  now: string;
  createId: () => string;
}

/**
 * 저장된 메시지의 모든 알려진 메타데이터를 보존하면서 legacy 기본값과 중단 상태만 정규화합니다.
 */
export function prepareLoadedSessionMessages(
  messages: readonly ChatMessageWithMeta[],
  options: LoadedSessionMessageOptions,
): ChatMessageWithMeta[] {
  const normalized = messages.map((message) => ({
    ...message,
    id: message.id || options.createId(),
    content: normalizeLoadedChatErrorContent(
      message.content,
      message.errorKind,
      message.errorMessage,
    ),
    timestamp: message.timestamp ?? Date.parse(options.now),
    createdAt: message.createdAt || options.now,
    updatedAt: message.updatedAt || message.createdAt || options.now,
    status: message.status ?? ('complete' as const),
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
  }));
  return recoverInterruptedSessionMessages(normalized, options.cancelledText);
}

/** 앱 재시작 뒤 실제 실행 주체가 없는 transient 상태를 완료된 취소 상태로 정리합니다. */
export function recoverInterruptedSessionMessages(
  messages: readonly ChatMessageWithMeta[],
  cancelledText: string,
): ChatMessageWithMeta[] {
  return messages.map((message) => {
    const interrupted =
      message.status === 'streaming' ||
      (message.turnStage !== undefined && ACTIVE_TURN_STAGES.has(message.turnStage));
    if (!interrupted) return { ...message };
    return {
      ...message,
      content: message.content.trim() || cancelledText,
      status: 'complete',
      turnStage: 'cancelled',
      stopReason: 'cancelled',
      toolCalls: message.toolCalls?.map((toolCall) =>
        toolCall.status === 'running'
          ? { ...toolCall, status: 'error', result: cancelledText, resultSummary: cancelledText }
          : { ...toolCall },
      ),
    };
  });
}
