import { describe, expect, it } from 'vitest';
import {
  createAssistantVariantGroup,
  createEditResendPlan,
  createRegenerationDraft,
  createVariantComparisonRows,
  markMessageRegenerated,
  resolveAssistantVariantRoot,
  selectActiveConversationMessages,
  selectPreviousUserQuestions,
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

  it('현재 세션 메시지에서만 직전 사용자 질문을 선택한다', () => {
    const loadedSessionMessages = [
      createMessage({ id: 'loaded-user-1', role: 'user', content: '네빌은 누구야?' }),
      createMessage({ id: 'loaded-assistant-1', role: 'assistant', content: '답변' }),
    ];

    expect(selectPreviousUserQuestions([])).toEqual([]);
    expect(selectPreviousUserQuestions(loadedSessionMessages)).toEqual(['네빌은 누구야?']);
  });

  it('재시도할 질문 자체를 제외하고 그 앞의 사용자 질문을 선택한다', () => {
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: '네빌은 누구야?' }),
      createMessage({ id: 'assistant-1', role: 'assistant', content: '답변' }),
      createMessage({ id: 'user-2', role: 'user', content: '창세기 관련 자료를 조사해줘' }),
      createMessage({ id: 'assistant-2', role: 'assistant', content: '오류' }),
    ];

    expect(selectPreviousUserQuestions(messages, 'user-2')).toEqual(['네빌은 누구야?']);
    expect(selectPreviousUserQuestions(messages, 'missing-user')).toEqual([]);
  });
});

describe('assistant variant navigation', () => {
  it('2회 이상 재생성해도 variant 루트를 끝까지 해석하고 비교 row에 모두 포함한다', () => {
    const messages = createChainedVariantConversation();

    expect(resolveAssistantVariantRoot(messages, 'assistant-3')).toBe('assistant-1');
    expect(createRegenerationDraft(messages, 'assistant-3')).toEqual({
      text: '요약해줘',
      previousUserId: 'user-1c',
      variantOf: 'assistant-1',
      branchRoot: 'user-1',
    });
    expect(createVariantComparisonRows(messages, 'assistant-3').map((row) => row.id)).toEqual([
      'assistant-1',
      'assistant-2',
      'assistant-3',
    ]);
  });

  it('표시 시퀀스는 active variant만 루트 위치에 두고 사본 질문을 숨긴다', () => {
    const messages = createChainedVariantConversation();

    expect(
      selectActiveConversationMessages(messages, new Map()).map((message) => message.id),
    ).toEqual(['user-1', 'assistant-3', 'user-2', 'assistant-4']);
  });

  it('명시 선택이 있으면 그 variant를 쓰고, 없으면 마지막 variant를 쓴다', () => {
    const messages = createChainedVariantConversation();

    expect(
      selectActiveConversationMessages(messages, new Map([['assistant-1', 'assistant-2']])).map(
        (message) => message.id,
      ),
    ).toEqual(['user-1', 'assistant-2', 'user-2', 'assistant-4']);
    expect(
      selectActiveConversationMessages(messages, new Map([['assistant-1', 'missing']])).map(
        (message) => message.id,
      ),
    ).toEqual(['user-1', 'assistant-3', 'user-2', 'assistant-4']);
  });

  it('진행 중인 마지막 사본 질문은 provider가 답할 대상으로 남긴다', () => {
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: '요약해줘' }),
      createMessage({ id: 'assistant-1', role: 'assistant', content: '첫 답변' }),
      createMessage({
        id: 'user-1b',
        role: 'user',
        content: '요약해줘',
        variantOf: 'user-1',
        branchRoot: 'user-1',
      }),
    ];

    expect(
      selectActiveConversationMessages(messages, new Map()).map((message) => message.id),
    ).toEqual(['user-1', 'assistant-1', 'user-1b']);
  });

  it('variant 그룹은 active 위치와 전체 개수를 노출한다', () => {
    const messages = createChainedVariantConversation();

    expect(createAssistantVariantGroup(messages, 'assistant-3', new Map())).toMatchObject({
      rootId: 'assistant-1',
      activeId: 'assistant-3',
      activeIndex: 2,
    });
    expect(
      createAssistantVariantGroup(
        messages,
        'assistant-3',
        new Map([['assistant-1', 'assistant-1']]),
      ),
    ).toMatchObject({
      rootId: 'assistant-1',
      activeId: 'assistant-1',
      activeIndex: 0,
    });
  });

  it('편집 후 전송은 수정 지점부터 대화를 자르고 무변경·없는 id는 null이다', () => {
    const messages = createChainedVariantConversation();

    expect(
      createEditResendPlan(messages, 'user-1', '고쳐 쓴 질문')?.map((message) => message.id),
    ).toEqual([]);
    expect(
      createEditResendPlan(messages, 'user-2', '고쳐 쓴 질문')?.map((message) => message.id),
    ).toEqual(['user-1', 'assistant-1', 'user-1b', 'assistant-2', 'user-1c', 'assistant-3']);
    expect(createEditResendPlan(messages, 'user-1', '요약해줘')).toBeNull();
    expect(createEditResendPlan(messages, 'missing-user', '고쳐 쓴 질문')).toBeNull();
    expect(createEditResendPlan(messages, 'assistant-1', '고쳐 쓴 질문')).toBeNull();
  });

  it('재생성 action history id는 같은 시각에도 겹치지 않는다', () => {
    const at = '2026-05-16T00:00:00.000Z';
    const once = markMessageRegenerated(
      createMessage({ id: 'assistant-1', role: 'assistant', content: '첫 답변' }),
      at,
    );
    const twice = markMessageRegenerated(once, at);

    expect(new Set(twice.actionHistory?.map((entry) => entry.id)).size).toBe(2);
  });
});

function createChainedVariantConversation(): ChatMessageWithMeta[] {
  return [
    createMessage({ id: 'user-1', role: 'user', content: '요약해줘' }),
    createMessage({ id: 'assistant-1', role: 'assistant', content: 'v1 답변' }),
    createMessage({
      id: 'user-1b',
      role: 'user',
      content: '요약해줘',
      variantOf: 'user-1',
      branchRoot: 'user-1',
    }),
    createMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: 'v2 답변',
      variantOf: 'assistant-1',
      branchRoot: 'user-1',
    }),
    createMessage({
      id: 'user-1c',
      role: 'user',
      content: '요약해줘',
      variantOf: 'user-1b',
      branchRoot: 'user-1',
    }),
    createMessage({
      id: 'assistant-3',
      role: 'assistant',
      content: 'v3 답변',
      variantOf: 'assistant-2',
      branchRoot: 'user-1',
    }),
    createMessage({ id: 'user-2', role: 'user', content: '이어서 물어봄' }),
    createMessage({ id: 'assistant-4', role: 'assistant', content: '이어지는 답변' }),
  ];
}

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
