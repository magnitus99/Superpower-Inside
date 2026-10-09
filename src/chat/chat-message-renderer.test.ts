import { describe, expect, it } from 'vitest';
import {
  createChatMessageMetaItems,
  createChatMessageTechnicalSummary,
  formatChatMessageTimestamp,
} from './chat-message-renderer';
import type { ChatMessageWithMeta } from './types';

const baseMessage: ChatMessageWithMeta = {
  id: 'msg-1',
  role: 'assistant',
  content: '답변',
  timestamp: 1_700_000_000_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'streaming',
};

describe('ChatMessageRenderer meta contract', () => {
  it('AI 메시지는 역할/짧은 시각/상태만 표시하고 기술 정보는 별도로 보존한다', () => {
    const referenceDate = new Date('2026-01-01T00:30:00.000Z');
    const items = createChatMessageMetaItems(
      {
        ...baseMessage,
        providerLabel: 'OpenAI',
        model: 'gpt-test',
        providerCapability: {
          providerKey: 'openai',
          model: 'gpt-test',
          streaming: false,
          transport: 'request-url-buffered',
          toolCalling: true,
          reasoning: true,
          abort: 'best-effort',
          fileReference: true,
          maxToolRounds: 10,
          knownLimitations: [],
        },
        turnStage: 'running-tools',
      },
      referenceDate,
    );

    expect(items.map((item) => [item.kind, item.className, item.text])).toEqual([
      ['role', 'superpower-inside-chat-role', 'Superpower Inside'],
      [
        'timestamp',
        'superpower-inside-chat-timestamp',
        formatChatMessageTimestamp(baseMessage.createdAt, referenceDate),
      ],
      ['status', 'superpower-inside-chat-message-status streaming', '툴 실행'],
    ]);
    expect(
      createChatMessageTechnicalSummary({
        ...baseMessage,
        providerLabel: 'OpenAI',
        model: 'gpt-test',
        providerCapability: {
          providerKey: 'openai',
          model: 'gpt-test',
          streaming: false,
          transport: 'request-url-buffered',
          toolCalling: true,
          reasoning: true,
          abort: 'best-effort',
          fileReference: true,
          maxToolRounds: 10,
          knownLimitations: [],
        },
      }),
    ).toBe('OpenAI / gpt-test · buffered');
  });

  it('사용자 완료 메시지는 역할과 완료 상태를 숨기고 시각만 표시한다', () => {
    const referenceDate = new Date('2026-01-01T00:30:00.000Z');
    const items = createChatMessageMetaItems(
      {
        ...baseMessage,
        role: 'user',
        status: 'complete',
      },
      referenceDate,
    );

    expect(items).toEqual([
      {
        kind: 'timestamp',
        className: 'superpower-inside-chat-timestamp',
        text: formatChatMessageTimestamp(baseMessage.createdAt, referenceDate),
      },
    ]);
  });

  it('AI 완료 상태는 텍스트와 semantic icon을 렌더링할 수 있도록 status kind를 유지한다', () => {
    const statusItem = createChatMessageMetaItems(
      {
        ...baseMessage,
        status: 'complete',
        turnStage: 'complete',
      },
      new Date('2026-01-01T00:30:00.000Z'),
    ).find((item) => item.kind === 'status');

    expect(statusItem).toEqual({
      kind: 'status',
      className: 'superpower-inside-chat-message-status complete',
      text: '완료',
      title: undefined,
    });
  });

  it('turn stage가 없으면 message status 라벨과 오류 title을 사용한다', () => {
    const items = createChatMessageMetaItems({
      ...baseMessage,
      status: 'error',
      errorMessage: 'provider failed',
    });

    expect(items.at(-1)).toEqual({
      kind: 'status',
      className: 'superpower-inside-chat-message-status error',
      text: '오류',
      title: 'provider failed',
    });
  });

  it('분류된 오류는 원본 진단 대신 간결한 사용자 메시지를 title로 사용한다', () => {
    const items = createChatMessageMetaItems({
      ...baseMessage,
      content: '현재 연결의 요청 한도에 도달했습니다.',
      status: 'error',
      errorKind: 'rate-limit',
      errorMessage: '429 upstream provider detail',
    });

    expect(items.at(-1)?.title).toBe('현재 연결의 요청 한도에 도달했습니다.');
  });

  it('custom provider/model/capability를 기술 요약으로 계산한다', () => {
    const technicalSummary = createChatMessageTechnicalSummary({
      ...baseMessage,
      providerCapability: {
        providerKey: 'customOpenAI',
        model: 'custom',
        streaming: false,
        transport: 'request-url-buffered',
        toolCalling: false,
        reasoning: false,
        abort: 'best-effort',
        fileReference: true,
        maxToolRounds: 0,
        knownLimitations: ['tool-calling-disabled'],
      },
    });

    expect(technicalSummary).toBe('customOpenAI / custom · buffered · tools off');
  });

  it('기술 정보가 없으면 기술 요약을 만들지 않는다', () => {
    expect(createChatMessageTechnicalSummary(baseMessage)).toBeUndefined();
  });

  it('같은 날의 timestamp는 날짜 없이 짧은 시각만 표시한다', () => {
    const value = '2026-07-28T12:34:00.000Z';
    const referenceDate = new Date('2026-07-28T13:05:00.000Z');

    expect(formatChatMessageTimestamp(value, referenceDate)).toBe(
      new Intl.DateTimeFormat('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value)),
    );
  });

  it('다른 날의 timestamp는 날짜와 시각을 함께 표시한다', () => {
    const value = '2026-07-25T12:34:00.000Z';
    const referenceDate = new Date('2026-07-28T13:05:00.000Z');

    expect(formatChatMessageTimestamp(value, referenceDate)).toBe(
      new Intl.DateTimeFormat('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value)),
    );
  });

  it('다른 해의 timestamp는 연도를 포함한다', () => {
    const value = '2025-07-25T12:34:00.000Z';
    const referenceDate = new Date('2026-07-28T13:05:00.000Z');

    expect(formatChatMessageTimestamp(value, referenceDate)).toBe(
      new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value)),
    );
  });

  it('timestamp가 유효하지 않으면 원문 값을 유지한다', () => {
    expect(formatChatMessageTimestamp('not-a-date', new Date())).toBe('not-a-date');
  });
});
