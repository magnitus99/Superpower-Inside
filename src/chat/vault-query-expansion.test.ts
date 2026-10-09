import { describe, expect, it, vi } from 'vitest';
import { expandVaultSearchPlan, expandVaultSearchQueryLocally } from './vault-query-expansion';
import type { LLMProvider } from '../llm/providers';

describe('볼트 검색 질의 확장 계약', () => {
  it.each([
    { question: '압력 센서 교체 기록', variants: ['pressure sensor', 'replacement record'] },
    { question: '青い配線の点検', variants: ['blue wiring', 'wiring inspection'] },
  ])('질문을 보존하고 번역 구절을 분리한다: $question', async ({ question, variants }) => {
    const chat = vi.fn<LLMProvider['chat']>().mockResolvedValue(JSON.stringify(variants));
    const provider = { chat } as unknown as LLMProvider;
    expect(await expandVaultSearchPlan(question, provider)).toEqual({ query: question, variants });
    expect(chat.mock.calls[0]?.[0][1].content).toBe(JSON.stringify({ question }));
    chat.mockResolvedValue('invalid JSON');
    expect(await expandVaultSearchPlan(question, provider)).toEqual({
      query: question,
      variants: [],
    });
  });

  it('영문은 모델 호출을 생략하고 취소된 번역을 중단한다', async () => {
    const chat = vi.fn();
    const provider = { chat } as unknown as LLMProvider;
    expect(await expandVaultSearchPlan('copper relay inspection', provider)).toEqual({
      query: 'copper relay inspection',
      variants: [],
    });
    expect(chat).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      expandVaultSearchPlan('합성 센서 점검', provider, [], controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('모델이 없어도 현재 질문과 검색에 필요한 직전 질의어를 유지한다', async () => {
    const question = '센서 점검 기록';
    const previous = ['copper relay ceramic fuse'];
    const fallback = expandVaultSearchQueryLocally(question, previous);
    expect(fallback).toContain(question);
    expect(fallback).toContain('copper');
    expect(await expandVaultSearchPlan(question, undefined, previous)).toEqual({
      query: question,
      variants: [fallback],
    });
  });

  it('추가 개념이 없는 질문을 불필요하게 바꾸지 않는다', () => {
    const question = 'How does a pressure switch work?';
    expect(expandVaultSearchQueryLocally(question)).toBe(question);
  });
});
