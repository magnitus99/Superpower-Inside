import { describe, expect, it } from 'vitest';
import { expandVaultSearchQueryLocally } from './vault-query-expansion';

describe('expandVaultSearchQueryLocally', () => {
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
