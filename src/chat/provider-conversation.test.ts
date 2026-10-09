import { describe, expect, it } from 'vitest';
import { buildProviderConversation } from './provider-conversation';
import type { ChatMessageWithMeta } from './types';

describe('저장 채팅의 provider 대화 이력', () => {
  it('일반 메시지의 순서와 reasoning을 보존한다', () => {
    const messages = buildProviderConversation(
      [
        createMessage({ role: 'system', content: '근거를 확인하세요.' }),
        createMessage({ role: 'user', content: 'Alpha를 찾아줘.' }),
        createMessage({
          role: 'assistant',
          content: '확인했습니다.',
          reasoning: '짧은 추론',
        }),
      ],
      'native',
    );

    expect(messages).toEqual([
      { role: 'system', content: '근거를 확인하세요.' },
      { role: 'user', content: 'Alpha를 찾아줘.' },
      { role: 'assistant', content: '확인했습니다.', reasoning: '짧은 추론' },
    ]);
  });

  it('완료된 native tool 기록을 결과와 최종 답변까지 완전한 이력으로 만든다', () => {
    const messages = buildProviderConversation(
      [
        createMessage({ role: 'user', content: 'Alpha를 찾아줘.' }),
        createMessage({
          role: 'assistant',
          content: 'Alpha.md에서 근거를 확인했습니다.',
          toolCalls: [
            {
              id: 'search-1',
              name: 'search_notes',
              arguments: '{"query":"Alpha"}',
              status: 'success',
              normalizedResult: '{"hits":["Alpha.md"]}',
            },
          ],
        }),
      ],
      'native',
    );

    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(messages[1]?.toolCalls?.[0]?.id).toBe('search-1');
    expect(messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'search-1',
      content: '{"hits":["Alpha.md"]}',
    });
    expect(messages[3]).toEqual({
      role: 'assistant',
      content: 'Alpha.md에서 근거를 확인했습니다.',
    });
  });

  it('compatibility 이력에는 tool role과 toolCalls 필드가 전혀 없다', () => {
    const messages = buildProviderConversation(
      [
        createMessage({ role: 'user', content: 'Alpha를 찾아줘.' }),
        createMessage({
          role: 'assistant',
          content: 'Alpha.md에서 근거를 확인했습니다.',
          toolCalls: [
            {
              id: 'search-1',
              name: 'search_notes',
              arguments: '{"query":"Alpha"}',
              status: 'success',
              normalizedResult: '{"hits":["Alpha.md"]}',
            },
          ],
        }),
      ],
      'compatibility',
    );

    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages.every((message) => message.role !== 'tool')).toBe(true);
    expect(messages.every((message) => !Object.hasOwn(message, 'toolCalls'))).toBe(true);
    expect(messages[3]?.content).toBe('Alpha.md에서 근거를 확인했습니다.');
  });

  it('미완료 호출과 독립 tool 메시지는 provider 이력에서 orphan 필드를 만들지 않는다', () => {
    const messages = buildProviderConversation(
      [
        createMessage({
          role: 'assistant',
          content: '사용자 승인을 기다립니다.',
          toolCalls: [
            {
              id: 'pending-1',
              name: 'write_remote',
              arguments: '{}',
              status: 'running',
            },
          ],
        }),
        createMessage({
          role: 'tool',
          content: '짝을 확인할 수 없는 레거시 결과',
          toolCalls: [
            {
              id: 'orphan-1',
              name: 'legacy_tool',
              arguments: '{}',
              status: 'success',
              normalizedResult: 'legacy',
            },
          ],
        }),
      ],
      'native',
    );

    expect(messages).toEqual([{ role: 'assistant', content: '사용자 승인을 기다립니다.' }]);
  });
});

function createMessage(
  overrides: Partial<ChatMessageWithMeta> & Pick<ChatMessageWithMeta, 'role' | 'content'>,
): ChatMessageWithMeta {
  return {
    id: crypto.randomUUID(),
    timestamp: 1,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    status: 'complete',
    ...overrides,
  };
}
