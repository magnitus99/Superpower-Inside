import { describe, expect, it } from 'vitest';
import { planQueryVariants, splitLongQuestion } from './query-variants';

describe('로컬 질의 변형', () => {
  it('짧은 질문은 변형 없이 원문 하나로 검색합니다', () => {
    expect(planQueryVariants('보고서 51호의 의미')).toEqual([]);
    expect(splitLongQuestion('보고서 51호의 의미')).toEqual(['보고서 51호의 의미']);
  });

  it('긴 질문은 첫 조각을 질문으로, 나머지를 변형으로 넘깁니다', () => {
    const question = `${'가'.repeat(200)}. ${'나'.repeat(200)}. ${'다'.repeat(200)}.`;
    const parts = splitLongQuestion(question, 320);
    expect(parts).toHaveLength(3);
    expect(planQueryVariants(question)).toEqual(parts.slice(1));
  });

  it('변형은 검색 계획 상한인 3개를 넘지 않습니다', () => {
    const question = Array.from({ length: 8 }, (_, index) => `문장${index}.`).join(' ');
    const variants = planQueryVariants(question);
    expect(variants.length).toBeLessThanOrEqual(3);
  });

  it('한 문장이 상한보다 길면 단어 경계에서 나누고 지정한 조각 수까지 보존합니다', () => {
    const question = Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ');
    const parts = splitLongQuestion(question, 60, 8);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 60)).toBe(true);
    expect(parts.join(' ')).toContain('word0');
    expect(parts.join(' ')).toContain('word39');
  });
});
