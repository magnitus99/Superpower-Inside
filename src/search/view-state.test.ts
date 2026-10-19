import { describe, expect, it } from 'vitest';
import {
  countSearchResults,
  formatLineRange,
  modifiedAfterFromPreset,
  parseFilterList,
  splitHighlightedText,
} from './view-state';
import type { SearchResponse } from './engine-port';

describe('강조 구간 나누기', () => {
  it('강조가 없으면 텍스트 전체를 그대로 돌려준다', () => {
    expect(splitHighlightedText('합성 문장', [])).toEqual([
      { text: '합성 문장', highlighted: false },
    ]);
  });

  it('강조 구간 앞뒤 텍스트를 보존한다', () => {
    expect(splitHighlightedText('abcdef', [{ start: 2, end: 4 }])).toEqual([
      { text: 'ab', highlighted: false },
      { text: 'cd', highlighted: true },
      { text: 'ef', highlighted: false },
    ]);
  });

  it('정렬되지 않았거나 겹치는 구간은 강조하지 않고 원문을 그대로 둔다', () => {
    expect(
      splitHighlightedText('abcdef', [
        { start: 2, end: 5 },
        { start: 3, end: 4 },
      ]),
    ).toEqual([{ text: 'abcdef', highlighted: false }]);
  });

  it('범위를 벗어난 구간도 보정하지 않고 강조를 생략한다', () => {
    expect(splitHighlightedText('abcdef', [{ start: -1, end: 3 }])).toEqual([
      { text: 'abcdef', highlighted: false },
    ]);
  });

  it('빈 텍스트는 빈 목록을 돌려준다', () => {
    expect(splitHighlightedText('', [{ start: 0, end: 3 }])).toEqual([]);
  });
});

describe('검색 결과 집계', () => {
  it('구절 수와 서로 다른 문서 수를 센다', () => {
    const response = {
      evidence: [{ path: 'A.md' }, { path: 'A.md' }, { path: 'B.md' }],
      queryTokens: [],
      phrases: [],
      diagnostics: {
        candidateDepth: 0,
        candidateDocuments: 0,
        selectedDocuments: 0,
        truncated: false,
        droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
        unmatchedTerms: [],
        zeroHitReason: null,
      },
      coverage: {
        status: 'supported',
        reviewedDocuments: 2,
        unreviewedDocuments: 0,
        notIndexedDocuments: 0,
      },
    } as unknown as SearchResponse;

    expect(countSearchResults(response)).toEqual({ passages: 3, documents: 2 });
  });
});

describe('필터 입력 해석', () => {
  it('쉼표와 줄바꿈을 나누고 공백·중복을 제거한다', () => {
    expect(parseFilterList('Archive, Projects/Notes\nArchive,  ')).toEqual([
      'Archive',
      'Projects/Notes',
    ]);
  });

  it('수정 시점 프리셋을 하한 시각으로 바꾼다', () => {
    const now = 1_700_000_000_000;
    expect(modifiedAfterFromPreset('any', now)).toBeUndefined();
    expect(modifiedAfterFromPreset('week', now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(modifiedAfterFromPreset('알 수 없음', now)).toBeUndefined();
  });
});

describe('줄 범위 표시', () => {
  it('한 줄이면 숫자만, 여러 줄이면 범위로 표시한다', () => {
    expect(formatLineRange(12)).toBe('12');
    expect(formatLineRange(12, 12)).toBe('12');
    expect(formatLineRange(12, 18)).toBe('12–18');
  });
});
