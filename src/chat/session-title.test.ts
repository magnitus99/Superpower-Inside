import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import type { ChatMessageWithMeta, SessionState } from './types';
import { summarizeSessionTitle } from './session-title';

function setup() {
  const session: SessionState = { filePath: null, title: '임시 제목', isDirty: false };
  const messages: ChatMessageWithMeta[] = [
    {
      id: 'u',
      role: 'user',
      content: '합성 계획을 비교해줘',
      status: 'complete',
      timestamp: 0,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'a',
      role: 'assistant',
      content: '두 계획의 일정과 비용을 비교했습니다.',
      status: 'complete',
      stopReason: 'complete',
      turnStage: 'complete',
      timestamp: 0,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue('"계획별 일정과 비용 비교"');
  const controller = new AbortController();
  return { session, messages, chat, controller };
}

describe('응답 완료 후 세션 제목 요약', () => {
  it('질문과 답변을 함께 요약하고 기존 대화는 수정하지 않는다', async () => {
    const { session, messages, chat, controller } = setup();
    const original = structuredClone(messages);
    expect(
      await summarizeSessionTitle(session, messages, { chat }, controller.signal, () => true),
    ).toBe(true);
    expect(session).toMatchObject({ title: '계획별 일정과 비용 비교', isDirty: true });
    const request = chat.mock.calls[0];
    expect(JSON.parse(request[0][1].content)).toEqual(
      messages.map(({ role, content }) => ({ role, content })),
    );
    expect(request[2]).toBeUndefined();
    expect(request[3]).toEqual({ signal: controller.signal });
    expect(messages).toEqual(original);
  });

  it.each(['cancelled', 'error', 'tool-failed'] as const)(
    '%s 응답에는 요약 요청을 보내지 않는다',
    async (reason) => {
      const { session, messages, chat, controller } = setup();
      messages[1].stopReason = reason;
      expect(
        await summarizeSessionTitle(session, messages, { chat }, controller.signal, () => true),
      ).toBe(false);
      expect(chat).not.toHaveBeenCalled();
      expect(session.title).toBe('임시 제목');
    },
  );

  it.each(['전환', '취소', '이름 변경'])(
    '요약 요청 중 %s 이후의 결과는 반영하지 않는다',
    async (action) => {
      const { session, messages, chat, controller } = setup();
      let current = true;
      let resolve = (_title: string): void => {};
      chat.mockImplementation(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      const pending = summarizeSessionTitle(
        session,
        messages,
        { chat },
        controller.signal,
        () => current,
      );
      if (action === '전환') current = false;
      if (action === '취소') controller.abort();
      if (action === '이름 변경') session.title = '직접 지정한 제목';
      resolve('늦게 도착한 요약');
      expect(await pending).toBe(false);
      expect(session.title).toBe(action === '이름 변경' ? '직접 지정한 제목' : '임시 제목');
      expect(session.isDirty).toBe(false);
    },
  );

  it('빈 결과와 provider 실패는 기존 제목을 보존한다', async () => {
    const { session, messages, chat, controller } = setup();
    chat.mockResolvedValueOnce('  \n ');
    expect(
      await summarizeSessionTitle(session, messages, { chat }, controller.signal, () => true),
    ).toBe(false);
    chat.mockRejectedValueOnce(new Error('합성 네트워크 오류'));
    await expect(
      summarizeSessionTitle(session, messages, { chat }, controller.signal, () => true),
    ).rejects.toThrow('합성 네트워크 오류');
    expect(session.title).toBe('임시 제목');
  });
});
