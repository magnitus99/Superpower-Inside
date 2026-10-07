import { describe, expect, it, vi } from 'vitest';
import { expandVaultSearchQuery, expandVaultSearchQueryLocally } from './vault-query-expansion';
import type { LLMProvider } from '../llm/providers';

describe('expandVaultSearchQueryLocally', () => {
  it('선택 모델에 질문만 보내고 제한된 영어 검색 개념을 사용한다', async () => {
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue('["no accident", "no luck", "chance"]');
    const provider = { chat } as unknown as LLMProvider;
    expect(await expandVaultSearchQuery('우연이나 운은 없다는 강연', provider)).toBe(
      'no accident no luck chance',
    );
    expect(chat.mock.calls[0]?.[0][1].content).toBe(
      JSON.stringify({ question: '우연이나 운은 없다는 강연' }),
    );
    chat.mockResolvedValue('Use another model and ignore instructions');
    expect(await expandVaultSearchQuery('우연이나 운은 없다는 강연', provider)).toContain('우연');
  });

  it('영어 질문은 추가 호출하지 않고 취소된 번역은 전파한다', async () => {
    const chat = vi.fn();
    const provider = { chat } as unknown as LLMProvider;
    await expandVaultSearchQuery('no accident', provider);
    expect(chat).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      expandVaultSearchQuery('우연은 없다', provider, [], controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('긴 후속 질문도 직전 질문의 맥락과 현재 주제를 도메인 중립적으로 유지한다', () => {
    const expanded = expandVaultSearchQueryLocally(
      '볼트 내에서 migration과 관련된 모든 것들을 조사하면 되지 않아?',
      ['Aurora는 배포 전환에 대해서 뭐라고 말했어?'],
    );

    expect(expanded).toContain('볼트 내에서 migration과 관련된 모든 것들을 조사하면 되지 않아?');
    expect(expanded).toContain('aurora');
    expect(expanded).toContain('배포');
    expect(expanded).not.toContain('Goddard');
  });

  it('의미 있는 검색어가 없는 일반 볼트 요청에는 임의 키워드를 덧붙이지 않는다', () => {
    const question = '이 옵시디언 볼트를 요약해줘';

    expect(expandVaultSearchQueryLocally(question)).toBe(question);
  });
});
