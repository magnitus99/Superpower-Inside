import { describe, expect, it } from 'vitest';
import type { ChatMessageWithMeta } from './types';
import {
  prepareLoadedSessionMessages,
  recoverInterruptedSessionMessages,
} from './session-recovery';

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

  it('실행 직전 저장된 승인 도구는 재시작 시 한 번만 취소 상태로 복구되어 재실행되지 않는다', () => {
    const source = [
      {
        id: 'approved-running',
        role: 'assistant',
        content: '도구 실행 중',
        timestamp: 1,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        status: 'streaming',
        turnStage: 'running-tools',
        toolCalls: [
          {
            id: 'mutation',
            name: 'write_remote_resource',
            arguments: '{"path":"target"}',
            status: 'running',
            approved: true,
          },
        ],
      },
    ] satisfies ChatMessageWithMeta[];

    const recovered = recoverInterruptedSessionMessages(source, '중단됨');
    const recoveredAgain = recoverInterruptedSessionMessages(recovered, '중단됨');

    expect(recovered[0]).toMatchObject({
      status: 'complete',
      turnStage: 'cancelled',
      stopReason: 'cancelled',
      toolCalls: [
        {
          id: 'mutation',
          status: 'error',
          approved: true,
          result: '중단됨',
          resultSummary: '중단됨',
        },
      ],
    });
    expect(recoveredAgain).toEqual(recovered);
    expect(recoveredAgain[0]?.toolCalls?.some((toolCall) => toolCall.status === 'running')).toBe(
      false,
    );
  });

  it('로드 정규화가 재시도 시각·질문·원본·compact 도구 재개 메타를 보존한다', () => {
    const source = [
      {
        id: 'approval',
        role: 'assistant',
        content: '승인 필요',
        timestamp: 1,
        createdAt: '2026-07-23T00:00:00.000Z',
        updatedAt: '2026-07-23T00:00:00.000Z',
        status: 'complete',
        errorKind: 'rate-limit',
        errorMessage: 'redacted diagnostics',
        errorRetryAt: '2026-07-23T00:01:00.000Z',
        originalContent: '원래 답변',
        assistantQuestion: {
          prompt: '범위를 골라주세요.',
          choices: [{ id: 'one', label: '현재 범위' }],
          selectionMode: 'single',
          allowFreeText: true,
          source: 'answer',
        },
        toolCalls: [
          {
            id: 'stored',
            name: 'superpower_inside',
            arguments: '{}',
            resultSummary: '검색 결과 3개',
            resumePayloadSource: 'resultSummary',
            status: 'success',
          },
        ],
      },
    ] satisfies ChatMessageWithMeta[];

    const [loaded] = prepareLoadedSessionMessages(source, {
      cancelledText: '중단됨',
      now: '2026-07-23T01:00:00.000Z',
      createId: () => 'generated',
    });

    expect(loaded).toMatchObject({
      id: 'approval',
      errorRetryAt: '2026-07-23T00:01:00.000Z',
      originalContent: '원래 답변',
      assistantQuestion: { prompt: '범위를 골라주세요.' },
      toolCalls: [
        {
          resultSummary: '검색 결과 3개',
          resumePayloadSource: 'resultSummary',
        },
      ],
    });
  });
});
