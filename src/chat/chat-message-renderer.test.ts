import { describe, expect, it } from 'vitest';
import { createChatMessageMetaItems, formatChatMessageTimestamp } from './chat-message-renderer';
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
  it('role/timestamp/model/capability/turn stage 메타를 순서대로 계산한다', () => {
    const items = createChatMessageMetaItems({
      ...baseMessage,
      providerLabel: 'OpenAI',
      model: 'gpt-test',
      providerCapability: {
        providerKey: 'openai',
        model: 'gpt-test',
        streaming: true,
        transport: 'fetch-sse',
        toolCalling: true,
        reasoning: true,
        abort: 'native',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: [],
      },
      turnStage: 'running-tools',
    });

    expect(items.map((item) => [item.kind, item.className, item.text])).toEqual([
      ['role', 'superpower-inside-chat-role', 'AI'],
      ['timestamp', 'superpower-inside-chat-timestamp', expect.any(String)],
      ['model', 'superpower-inside-chat-model-meta', 'OpenAI / gpt-test'],
      ['capability', 'superpower-inside-chat-capability-meta', 'streaming · reasoning'],
      ['status', 'superpower-inside-chat-message-status streaming', '툴 실행'],
    ]);
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

  it('custom buffered/no-tools capability 라벨을 계산한다', () => {
    const items = createChatMessageMetaItems({
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

    expect(items.find((item) => item.kind === 'capability')?.text).toBe('buffered · tools off');
  });

  it('timestamp가 유효하지 않으면 원문 값을 유지한다', () => {
    expect(formatChatMessageTimestamp('not-a-date')).toBe('not-a-date');
  });
});
