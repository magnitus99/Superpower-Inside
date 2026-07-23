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
