import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  getVaultResearchPhaseLabel,
  isScopedVaultResearchRequest,
  isWholeVaultResearchRequest,
} from './research-agent';

describe('볼트 연구 의도와 진행 라벨', () => {
  beforeEach(() => {
    setLanguage('ko');
  });

  it('내부 phase 이름을 사용자 작업 언어로 표시한다', () => {
    expect(getVaultResearchPhaseLabel('inventory')).toBe('문서 확인');
    expect(getVaultResearchPhaseLabel('map')).toBe('문서 읽기');
    expect(getVaultResearchPhaseLabel('reduce')).toBe('내용 종합');
    setLanguage('en');
    expect(getVaultResearchPhaseLabel('map')).toBe('Reading documents');
  });

  it('명시적인 볼트 전체 요약과 전수 조사를 research workflow로 분류한다', () => {
    expect(isWholeVaultResearchRequest('이 옵시디언 볼트를 요약해줘')).toBe(true);
    expect(
      isWholeVaultResearchRequest('볼트 내에서 genesis와 관련된 모든 것들을 조사하면 되지 않아?'),
    ).toBe(true);
    expect(isWholeVaultResearchRequest('Alpha 노트의 고객 문제는 뭐야?')).toBe(false);
  });

  it.each([
    {
      synthesis: '@[fixtures] 센서와 배선 점검 결과를 비교해줘',
      quote: '@[fixtures] 센서 관련 인용 구절을 찾아줘',
    },
    {
      synthesis: '@[fixtures] summarize the maintenance records',
      quote: '@[fixtures] find a quotation about the relay',
    },
  ])('폴더 종합과 좁은 인용문 검색을 구분한다: $synthesis', ({ synthesis, quote }) => {
    expect(isScopedVaultResearchRequest(synthesis)).toBe(true);
    expect(isScopedVaultResearchRequest(quote)).toBe(false);
  });
});
