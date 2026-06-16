import { describe, expect, it } from 'vitest';
import {
  createRegenerationDraft,
  createVariantComparisonRows,
  markMessageRegenerated,
} from './conversation-variants';
import type { ChatMessageWithMeta } from './types';

describe('conversation variant contract', () => {
  it('regenerate는 기존 assistant를 삭제하지 않고 variant draft를 만든다', () => {
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: '요약해줘' }),
      createMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: '첫 답변',
        providerLabel: 'Ollama',
        model: 'llama3.1',
      }),
    ];

    expect(createRegenerationDraft(messages, 'assistant-1')).toEqual({
      text: '요약해줘',
      previousUserId: 'user-1',
      variantOf: 'assistant-1',
      branchRoot: 'user-1',
    });
    expect(messages).toHaveLength(2);
  });

  it('variant 비교 row에는 provider/context/source/tool 차이를 포함한다', () => {
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: '요약해줘' }),
      createMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: '첫 답변',
        providerLabel: 'Ollama',
        model: 'llama3.1',
        citations: [{ id: 'rag-1', filePath: 'A.md', status: 'verified', preview: 'A' }],
      }),
      createMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: '둘째 답변',
        providerLabel: 'OpenRouter',
        model: 'openrouter/auto',
        variantOf: 'assistant-1',
        branchRoot: 'user-1',
        sourceWarnings: [
          { id: 'warn-1', label: 'Source rag-9', detail: '검증 실패', kind: 'unverified-source' },
        ],
        toolCalls: [{ id: 'call-1', name: 'search', arguments: '{}', status: 'success' }],
      }),
    ];

    expect(createVariantComparisonRows(messages, 'assistant-2')).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        providerText: 'Ollama / llama3.1',
        citationCount: 1,
        sourceWarningCount: 0,
        toolCallCount: 0,
        active: false,
      }),
      expect.objectContaining({
        id: 'assistant-2',
        providerText: 'OpenRouter / openrouter/auto',
        citationCount: 0,
        sourceWarningCount: 1,
        toolCallCount: 1,
        active: true,
      }),
    ]);
  });

  it('원본 답변에는 regenerate action history를 남긴다', () => {
    const message = createMessage({ id: 'assistant-1', role: 'assistant', content: '첫 답변' });

    expect(markMessageRegenerated(message, '2026-05-16T00:00:00.000Z')).toMatchObject({
      id: 'assistant-1',
      actionHistory: [
        {
          action: 'regenerate',
          at: '2026-05-16T00:00:00.000Z',
        },
      ],
    });
  });
});

function createMessage(overrides: Partial<ChatMessageWithMeta>): ChatMessageWithMeta {
  const now = '2026-05-16T00:00:00.000Z';
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: Date.parse(now),
    createdAt: now,
    updatedAt: now,
    status: overrides.status ?? 'complete',
    ...overrides,
  };
}
