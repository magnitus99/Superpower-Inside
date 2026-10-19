import { describe, expect, it } from 'vitest';
import { groupEvidenceByPath, type SearchEvidence } from './engine-port';

function evidence(path: string, rank: number, overrides: Partial<SearchEvidence> = {}): SearchEvidence {
  return {
    sourceId: `source-${rank}`,
    path,
    revision: 'rev-1',
    startLine: rank,
    endLine: rank,
    quote: `합성 구절 ${rank}`,
    contextBefore: '',
    contextAfter: '',
    score: 1 / rank,
    rank,
    signal: 'bm25',
    phraseMatches: 0,
    proximityScore: 0,
    fieldScore: 0,
    exactSignals: [],
    negatedNearby: false,
    duplicateOf: null,
    ...overrides,
  };
}

describe('검색 증거 그룹핑', () => {
  it('증거가 없으면 빈 목록을 돌려준다', () => {
    expect(groupEvidenceByPath([])).toEqual([]);
  });

  it('엔진 순위를 유지한 채 파일별로 묶는다', () => {
    const groups = groupEvidenceByPath([
      evidence('A.md', 1),
      evidence('B.md', 2),
      evidence('A.md', 3),
    ]);

    expect(groups.map((group) => group.path)).toEqual(['A.md', 'B.md']);
    expect(groups[0]?.evidence.map((item) => item.rank)).toEqual([1, 3]);
    expect(groups[1]?.evidence.map((item) => item.rank)).toEqual([2]);
  });

  it('중복 표시된 증거도 순서와 참조를 그대로 보존한다', () => {
    const groups = groupEvidenceByPath([
      evidence('A.md', 1, { signal: 'duplicate', duplicateOf: 'source-0' }),
    ]);

    expect(groups[0]?.evidence[0]?.duplicateOf).toBe('source-0');
  });
});
