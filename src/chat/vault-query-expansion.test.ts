import { describe, expect, it } from 'vitest';
import { expandVaultSearchQueryLocally } from './vault-query-expansion';

describe('expandVaultSearchQueryLocally', () => {
  it('긴 후속 질문도 직전 질문의 핵심 엔터티와 현재 주제 별칭을 함께 유지한다', () => {
    const expanded = expandVaultSearchQueryLocally(
      '볼트 내에서 genesis와 관련된 모든 것들을 조사하면 되지 않아?',
      ['네빌은 창세기에 대해서 뭐라고 말했어?'],
    );

    expect(expanded).toContain('볼트 내에서 genesis와 관련된 모든 것들을 조사하면 되지 않아?');
    expect(expanded).toContain('네빌');
    expect(expanded).toContain('Neville');
    expect(expanded).toContain('Goddard');
    expect(expanded).toContain('창세기');
  });

  it('의미 있는 검색어가 없는 일반 볼트 요청에는 임의 키워드를 덧붙이지 않는다', () => {
    const question = '이 옵시디언 볼트를 요약해줘';

    expect(expandVaultSearchQueryLocally(question)).toBe(question);
  });
});
