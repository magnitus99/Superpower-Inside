import { describe, expect, it } from 'vitest';
import { createSyntheticCorpus, SEARCH_EVAL_CATEGORIES } from './search-eval/corpus.mjs';
import {
  aggregateRows,
  evaluateQuery,
  latencySummary,
  quantile,
  summarizeSearchEvaluation,
} from './search-eval/metrics.mjs';

describe('합성 검색 평가 코퍼스', () => {
  it('같은 시드·분할은 완전히 같고, 다른 시드는 다른 문서를 만든다', () => {
    const first = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
    const second = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
    const otherSeed = createSyntheticCorpus({ scale: 'ci', split: 'dev', seed: 7 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(otherSeed)).not.toBe(JSON.stringify(first));
    // 문서 수는 스케일 계약이고, 청크·본문량은 생성기 집계에 남는다.
    expect(first.stats.documentCount).toBe(240);
    expect(first.stats.chunkCount).toBeGreaterThan(200);
    expect(first.stats.bodyBytes).toBeGreaterThan(10_000);
  });

  it('dev와 held-out은 문서 경로·질의가 겹치지 않는다', () => {
    const dev = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
    const heldout = createSyntheticCorpus({ scale: 'ci', split: 'heldout' });
    const devPaths = new Set(dev.documents.map((document) => document.path));
    expect(heldout.documents.every((document) => !devPaths.has(document.path))).toBe(true);
    const devQueries = new Set(dev.queries.map((query) => query.text));
    expect(heldout.queries.every((query) => !devQueries.has(query.text))).toBe(true);
  });

  it('모든 범주에 질의가 있고 골드(구절 line range)가 문서 안에 있다', () => {
    const corpus = createSyntheticCorpus({ scale: 'ci', split: 'heldout' });
    for (const category of SEARCH_EVAL_CATEGORIES)
      expect(corpus.stats.categoryCounts[category]).toBeGreaterThan(0);
    const byPath = new Map(corpus.documents.map((document) => [document.path, document]));
    for (const query of corpus.queries) {
      for (const path of query.goldPaths) expect(byPath.has(path)).toBe(true);
      for (const passage of query.goldPassages) {
        const document = byPath.get(passage.path);
        expect(passage.startLine).toBeGreaterThanOrEqual(1);
        expect(passage.endLine).toBeGreaterThanOrEqual(passage.startLine);
        expect(passage.endLine).toBeLessThanOrEqual(document.text.split('\n').length);
      }
    }
  });

  it('문서/구절/상충쌍 3단 골드와 no-answer 계약을 지킨다', () => {
    const corpus = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
    const byPath = new Map(corpus.documents.map((document) => [document.path, document]));
    const conflicts = corpus.queries.filter((query) => query.category === 'conflict-pair');
    for (const query of conflicts) {
      expect(query.conflictPair).toBe(true);
      expect(new Set(query.goldPaths).size).toBe(2);
      const values = query.goldPaths.map((path) => byPath.get(path).text);
      expect(values[0]).not.toBe(values[1]);
    }
    const duplicates = corpus.queries.filter((query) => query.category === 'duplicates');
    for (const query of duplicates) expect(new Set(query.goldPaths).size).toBe(2);
    const multiHop = corpus.queries.filter((query) => query.category === 'multi-hop');
    for (const query of multiHop) expect(new Set(query.goldPaths).size).toBe(2);
    const noAnswer = corpus.queries.filter((query) => query.category === 'no-answer');
    expect(noAnswer.length).toBeGreaterThan(0);
    for (const query of noAnswer) {
      expect(query.expectNoAnswer).toBe(true);
      expect(query.goldPaths).toEqual([]);
      // 정답 없는 질의 토큰은 코퍼스 본문 어디에도 없어야 한다.
      const probes = query.text.split(' ').filter((token) => token.length > 3);
      for (const document of corpus.documents)
        for (const probe of probes) expect(document.text.includes(probe)).toBe(false);
    }
  });

  it('field-title·field-path 질의 토큰은 본문에 없다', () => {
    const corpus = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
    const byPath = new Map(corpus.documents.map((document) => [document.path, document]));
    for (const query of corpus.queries.filter((item) => item.category === 'field-title')) {
      const document = byPath.get(query.goldPaths[0]);
      const titleToken = document.path.split('/').at(-1).replace(/\.md$/, '');
      expect(document.chunks.every((chunk) => !chunk.text.includes(titleToken))).toBe(true);
    }
    for (const query of corpus.queries.filter((item) => item.category === 'field-path')) {
      const document = byPath.get(query.goldPaths[0]);
      const folderToken = document.path.split('/')[0];
      expect(document.text.includes(folderToken)).toBe(false);
    }
  });
});

describe('검색 평가 지표', () => {
  const query = {
    id: 'synthetic-query',
    category: 'conflict-pair',
    goldPaths: ['a.md', 'b.md'],
    goldPassages: [
      { path: 'a.md', startLine: 3, endLine: 3 },
      { path: 'b.md', startLine: 2, endLine: 2 },
    ],
    forbiddenPaths: ['x.md'],
    multiGold: true,
    conflictPair: true,
    expectNoAnswer: false,
  };

  it('문서·구절·상충쌍·금지 문서 지표를 계산한다', () => {
    const row = evaluateQuery(
      query,
      [
        { path: 'x.md', startLine: 1, endLine: 1, score: 9 },
        { path: 'a.md', startLine: 2, endLine: 4, score: 8 },
        { path: 'a.md', startLine: 2, endLine: 4, score: 7 },
        { path: 'b.md', startLine: 5, endLine: 6, score: 6 },
      ],
      8,
    );
    // 경로 중복은 순위에서 한 번만 세므로 두 정답 문서가 모두 상위에 있다.
    expect(row.documentRecall).toBe(1);
    expect(row.reciprocalRank).toBeCloseTo(0.5, 10);
    expect(row.passageHitRatio).toBeCloseTo(0.5, 10);
    expect(row.multiGoldCovered).toBe(true);
    expect(row.conflictPairCovered).toBe(true);
    expect(row.forbiddenTop1).toBe(true);
  });

  it('같은 경로 반복으로 순위 점수를 올리지 못한다', () => {
    const row = evaluateQuery(
      { ...query, goldPaths: ['a.md'], goldPassages: [], forbiddenPaths: [], multiGold: false, conflictPair: false },
      [
        { path: 'a.md', startLine: 1, endLine: 1, score: 3 },
        { path: 'a.md', startLine: 1, endLine: 1, score: 2 },
      ],
      8,
    );
    expect(row.reciprocalRank).toBe(1);
    expect(row.ndcg10).toBe(1);
  });

  it('정답 없는 질의는 빈 결과만 통과로 센다', () => {
    const noAnswer = {
      id: 'q',
      category: 'no-answer',
      goldPaths: [],
      goldPassages: [],
      forbiddenPaths: [],
      multiGold: false,
      conflictPair: false,
      expectNoAnswer: true,
    };
    expect(evaluateQuery(noAnswer, [], 8).noAnswerPass).toBe(true);
    expect(evaluateQuery(noAnswer, [{ path: 'other.md', score: 1 }], 8).noAnswerPass).toBe(false);
  });

  it('요약은 범주별·전체 평균을 내고 결측 지표를 무시한다', () => {
    const queries = [
      { ...query, id: 'q1', category: 'conflict-pair' },
      {
        id: 'q2',
        category: 'no-answer',
        goldPaths: [],
        goldPassages: [],
        forbiddenPaths: [],
        multiGold: false,
        conflictPair: false,
        expectNoAnswer: true,
      },
    ];
    const results = new Map([
      ['q1', [{ path: 'a.md', startLine: 3, endLine: 3, score: 5 }]],
      ['q2', []],
    ]);
    const summary = summarizeSearchEvaluation(queries, results, { k: 8 });
    expect(summary.overall.queryCount).toBe(2);
    expect(summary.overall.noAnswerAccuracy).toBe(1);
    expect(summary.byCategory['no-answer'].documentRecall).toBeNull();
    expect(summary.byCategory['conflict-pair'].conflictPairCoverage).toBe(0);
  });

  it('지연 통계는 p50·p95·최대값을 낸다', () => {
    expect(latencySummary([1, 2, 3, 4, 5])).toEqual({
      count: 5,
      meanMs: 3,
      p50Ms: 3,
      p95Ms: 5,
      maxMs: 5,
    });
    expect(quantile([], 0.5)).toBeNull();
    expect(aggregateRows([]).documentRecall).toBeNull();
  });
});
