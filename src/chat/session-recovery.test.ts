import { describe, expect, it } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import { recoverInterruptedSessionMessages } from './session-recovery';

describe('채팅 세션 transient 상태 복구', () => {
  it('다시 연 provider 대기 상태를 실행 중처럼 남기지 않는다', () => {
    const messages = recoverInterruptedSessionMessages(
      [
        {
          id: 'assistant',
          role: 'assistant',
          content: 'provider 대기',
          timestamp: 1,
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
          status: 'streaming',
          turnStage: 'waiting-provider',
          toolCalls: [
            { id: 'tool', name: 'superpower_inside', arguments: '{}', status: 'running' },
          ],
        },
      ] satisfies ChatMessageWithMeta[],
      '중단됨',
    );

    expect(messages[0]).toMatchObject({
      status: 'complete',
      turnStage: 'cancelled',
      stopReason: 'cancelled',
      toolCalls: [{ status: 'error', result: '중단됨' }],
    });
  });

  it('승인 대기와 완료 메시지는 그대로 보존한다', () => {
    const source = [
      {
        id: 'approval',
        role: 'assistant',
        content: '승인 필요',
        timestamp: 1,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        status: 'pending',
        turnStage: 'awaiting-tool-approval',
      },
    ] satisfies ChatMessageWithMeta[];

    expect(recoverInterruptedSessionMessages(source, '중단됨')[0]).toMatchObject({
      status: 'pending',
      turnStage: 'awaiting-tool-approval',
    });
  });
});
