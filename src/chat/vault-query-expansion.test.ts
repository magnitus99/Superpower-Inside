import { describe, expect, it } from 'vitest';
import { expandVaultSearchPlan, expandVaultSearchQueryLocally } from './vault-query-expansion';

describe('결정적 로컬 볼트 검색 계획', () => {
  it.each(['압력 센서 교체 기록', '青い配線の点検', 'copper relay inspection'])(
    'provider 없이 질문과 로컬 계획을 보존한다: %s',
    (question) => {
      const local = expandVaultSearchQueryLocally(question);
      const expected = { query: question, variants: local === question ? [] : [local] };
      expect(expandVaultSearchPlan(question)).toEqual(expected);
      expect(expandVaultSearchPlan(question)).toEqual(expected);
    },
  );

  it('직전 질문의 필요한 개념만 결정적으로 유지한다', () => {
    const question = '센서 점검 기록';
    const previous = ['copper relay ceramic fuse'];
    const local = expandVaultSearchQueryLocally(question, previous);
    expect(local).toContain(question);
    expect(local).toContain('copper');
    expect(expandVaultSearchPlan(question, previous)).toEqual({
      query: question,
      variants: [local],
    });
  });

  it('추가 개념이 없는 질문은 바꾸지 않는다', () => {
    const question = 'How does a pressure switch work?';
    expect(expandVaultSearchQueryLocally(question)).toBe(question);
  });
});
