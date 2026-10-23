import { describe, expect, it } from 'vitest';
import {
  classifyIndexedSearchConfidence,
  selectAlternativeInterpretations,
  summarizeIndexedConfidence,
} from './confidence';

describe('classifyIndexedSearchConfidence', () => {
  it('근거가 없으면 낮음으로 본다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 0,
        topScore: 0,
        secondScore: 0,
        distinctPathCount: 0,
      }),
    ).toBe('low');
  });

  it('근거가 여러 문서에 걸쳐 있고 1위가 앞서면 높음으로 본다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 6,
        topScore: 12.5,
        secondScore: 6.0,
        distinctPathCount: 4,
      }),
    ).toBe('high');
  });

  it('2위가 최고점의 60% 이상이면 해석이 갈릴 수 있어 중간으로 낮춘다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 6,
        topScore: 10,
        secondScore: 6,
        distinctPathCount: 4,
      }),
    ).toBe('medium');
  });

  it('1위 우위가 있어도 근거가 한 문서뿐이면 중간이다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 3,
        topScore: 10,
        secondScore: 1,
        distinctPathCount: 1,
      }),
    ).toBe('medium');
  });

  it('해석이 갈리는 동시에 근거도 얇으면 낮음이다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 1,
        topScore: 10,
        secondScore: 9,
        distinctPathCount: 1,
      }),
    ).toBe('low');
  });

  it('최고점이 없으면 다른 신호와 무관하게 낮음이다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 4,
        topScore: 0,
        secondScore: 0,
        distinctPathCount: 3,
      }),
    ).toBe('low');
  });

  it('점수가 유한하지 않으면 낮음이다', () => {
    expect(
      classifyIndexedSearchConfidence({
        evidenceCount: 3,
        topScore: Number.NaN,
        secondScore: 1,
        distinctPathCount: 2,
      }),
    ).toBe('low');
  });
});

describe('selectAlternativeInterpretations', () => {
  it('점수 순서를 유지하며 중복 경로를 한 번만 고른다', () => {
    expect(
      selectAlternativeInterpretations(['a.md', 'a.md', 'b.md', 'c.md'], 2),
    ).toEqual(['a.md', 'b.md']);
  });

  it('요청 개수가 0이면 빈 목록이다', () => {
    expect(selectAlternativeInterpretations(['a.md', 'b.md'], 0)).toEqual([]);
  });
});

describe('summarizeIndexedConfidence', () => {
  it('한 문서의 구절이 여러 개여도 문서 최고점으로 묶어 판정한다', () => {
    const summary = summarizeIndexedConfidence([
      { path: 'A.md', score: 5 },
      { path: 'A.md', score: 4.9 },
      { path: 'B.md', score: 4.8 },
    ]);

    expect(summary.confidence).toBe('medium');
    expect(summary.alternatives).toEqual(['A.md', 'B.md']);
  });

  it('확신도가 높으면 다른 해석 후보를 남기지 않는다', () => {
    const summary = summarizeIndexedConfidence([
      { path: 'A.md', score: 9 },
      { path: 'B.md', score: 3 },
      { path: 'C.md', score: 1 },
    ]);

    expect(summary.confidence).toBe('high');
    expect(summary.alternatives).toEqual([]);
  });
});
