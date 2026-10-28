import { describe, expect, it, vi } from 'vitest';
import { needsCrossLanguageSearch, requestQueryVariants, splitLongQuestion } from './query-variants';

function fakeProvider(reply: string) {
  const chat = vi.fn(() => Promise.resolve(reply));
  return { chat };
}

describe('교차 언어 검색 구문', () => {
  it('비 ASCII 알파벳이 있는 질문만 다른 언어 검색 대상으로 봅니다', () => {
    expect(needsCrossLanguageSearch('보고서 51호')).toBe(true);
    expect(needsCrossLanguageSearch('Forgiveness and the Immortal Eyes')).toBe(false);
    expect(needsCrossLanguageSearch('Report 51 — 보고서')).toBe(true);
  });

  it('ASCII 질문에는 provider를 부르지 않습니다', async () => {
    const provider = fakeProvider('["보고서 51호"]');
    await expect(requestQueryVariants(provider, 'Report 51', 'prompt')).resolves.toEqual([]);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('provider 응답을 정규화·중복 제거합니다', async () => {
    const provider = fakeProvider('["Report  51", "report 51", "The quarterly summary"]');
    const variants = await requestQueryVariants(provider, '보고서 51호의 요약', 'prompt');
    expect(variants).toEqual(['Report 51', 'The quarterly summary']);
  });

  it('Rust 확장기 상한을 넘는 응답은 버립니다', async () => {
    const provider = fakeProvider('["a", "b", "c", "d"]');
    await expect(requestQueryVariants(provider, '보고서 51호', 'prompt')).resolves.toEqual([]);
  });

  it('provider 실패나 형식 오류는 검색 실패가 아니라 확장 없음입니다', async () => {
    const failing = { chat: vi.fn(async () => Promise.reject(new Error('offline'))) };
    await expect(requestQueryVariants(failing, '보고서 51호', 'prompt')).resolves.toEqual([]);
    const malformed = fakeProvider('설명 없이 그냥 문장입니다.');
    await expect(requestQueryVariants(malformed, '보고서 51호', 'prompt')).resolves.toEqual([]);
  });
});

describe('긴 질문 분해', () => {
  it('상한 이하 질문은 그대로 한 조각입니다', () => {
    expect(splitLongQuestion('보고서 51호의 의미')).toEqual(['보고서 51호의 의미']);
  });

  it('문장 경계에서 나누고 모든 조각을 상한 이하로 유지합니다', () => {
    const question = `${'가'.repeat(200)}. ${'나'.repeat(200)}. ${'다'.repeat(200)}.`;
    const parts = splitLongQuestion(question, 320);
    expect(parts.length).toBe(3);
    expect(parts.every((part) => part.length <= 320)).toBe(true);
    expect(parts.join(' ')).toContain('가');
    expect(parts.join(' ')).toContain('다');
  });

  it('한 문장이 상한보다 길면 단어 경계에서 나눕니다', () => {
    const question = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
    const parts = splitLongQuestion(question, 60);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 60)).toBe(true);
  });
});
