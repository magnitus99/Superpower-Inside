import { describe, expect, it } from 'vitest';
import { createSyntheticCorpus, SEARCH_EVAL_CATEGORIES } from './search-eval/corpus.mjs';
import {
  aggregateRows,
  benchmarkGate,
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

describe('평가 원장 회귀', () => {
  const lowScores = [
    ['minScore 미달', 0.5],
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
  ];
  const goldQuery = {
    id: 'hard-exclusion', category: 'synthetic', goldPaths: ['a'],
    goldPassages: [{ path: 'a', startLine: 9, endLine: 9 }], hardExcludedPaths: ['x'],
  };
  const goldResult = { path: 'a', startLine: 9, endLine: 9, score: 2 };
  const noUpdate = { supported: false };

  it.each(lowScores)('%s 제외 결과는 minScore 미달·rank > k여도 게이트를 실패시킨다', (_label, score) => {
    const options = { k: 1, minScore: 1 };
    const allowed = summarizeSearchEvaluation([goldQuery], new Map([
      [goldQuery.id, [goldResult, { path: 'allowed-low', score }]],
    ]), options);
    const leaked = summarizeSearchEvaluation([goldQuery], new Map([
      [goldQuery.id, [goldResult, { path: 'x', score }]],
    ]), options);
    expect(allowed.rows[0].hardExclusionLeakage).toBe(false);
    expect(benchmarkGate(allowed, noUpdate, true)).toBe(true);
    expect(leaked.overall).toEqual(allowed.overall);
    expect(leaked.rows[0]).toEqual({ ...allowed.rows[0], hardExclusionLeakage: true });
    expect(benchmarkGate(leaked, noUpdate, true)).toBe(false);
  });

  it.each(lowScores)('%s 제외 결과는 cutoff 후 no-answer 성공으로 숨길 수 없다', (_label, score) => {
    const noAnswer = { id: 'empty', category: 'no-answer', goldPaths: [], expectNoAnswer: true, hardExcludedPaths: ['x'] };
    const summary = summarizeSearchEvaluation([goldQuery, noAnswer], new Map([
      [goldQuery.id, [goldResult]], [noAnswer.id, [{ path: 'x', score }]],
    ]), { k: 1, minScore: 1 });
    expect(summary.rows[1].resultCount).toBe(0);
    expect(summary.rows[1].noAnswerPass).toBe(true);
    expect(summary.overall.noAnswerAccuracy).toBe(1);
    expect(summary.rows[1].hardExclusionLeakage).toBe(true);
    expect(benchmarkGate(summary, noUpdate, true)).toBe(false);
  });

  it('summary 기본 cutoff 0도 음수·NaN hard 제외 누출을 숨기지 않는다', () => {
    for (const score of [-1, Number.NaN]) {
      const summary = summarizeSearchEvaluation([goldQuery], new Map([
        [goldQuery.id, [goldResult, { path: 'x', score }]],
      ]));
      expect(summary.minScore).toBe(0);
      expect(summary.rows[0].resultCount).toBe(1);
      expect(summary.rows[0].hardExclusionLeakage).toBe(true);
      expect(benchmarkGate(summary, noUpdate, true)).toBe(false);
    }
  });

  it.each(lowScores)('%s 직접 평가는 기본적으로 점수를 거르지 않는다', (_label, score) => {
    const row = evaluateQuery(goldQuery, [goldResult, { path: 'x', score }]);
    expect(row.resultCount).toBe(2);
    expect(row.hardExclusionLeakage).toBe(true);
    expect(evaluateQuery(goldQuery, [goldResult, { path: 'x', score }], 1).hardExclusionLeakage).toBe(true);
  });

  it('허용 자료의 score cutoff와 문서·구절·상충쌍·no-answer 순위 의미를 보존한다', () => {
    const query = {
      ...goldQuery, goldPaths: ['a', 'b'], multiGold: true, conflictPair: true,
      goldPassages: [...goldQuery.goldPassages, { path: 'b', startLine: 2, endLine: 2 }],
      forbiddenPaths: ['allowed-low'], forbiddenPassages: [{ path: 'allowed-low', startLine: 1, endLine: 1 }],
    };
    const noAnswer = { id: 'empty', category: 'no-answer', goldPaths: [], expectNoAnswer: true };
    const queries = [query, noAnswer];
    const raw = [
      { path: 'allowed-low', startLine: 1, endLine: 1, score: 0.5 },
      goldResult,
      { path: 'b', startLine: 2, endLine: 2, score: 0.5 },
      { path: 'a', startLine: 1, endLine: 1 },
    ];
    const low = [{ path: 'allowed-low', score: 0.5 }, { path: 'nan', score: Number.NaN }];
    const summary = summarizeSearchEvaluation(queries, new Map([[query.id, raw], [noAnswer.id, low]]), { k: 1, minScore: 1 });
    const expectedRows = [evaluateQuery(query, [goldResult, raw[3]], 1), evaluateQuery(noAnswer, [], 1)];
    expect(summary.rows).toEqual(expectedRows);
    expect(summary.overall).toEqual(aggregateRows(expectedRows));
    expect(summary.rows[0]).toMatchObject({
      resultCount: 1, documentRecall: 0.5, precision: 1, reciprocalRank: 1,
      passageHitRatio: 0.5, passageAllHit: false, multiGoldCovered: false,
      conflictPairCovered: false, forbiddenTop1: false, distractorLeakage: false,
      hardExclusionLeakage: false,
    });
    expect(summary.rows[1].noAnswerPass).toBe(true);
    const unfiltered = summarizeSearchEvaluation(queries, new Map([[query.id, raw], [noAnswer.id, low]]), { k: 1 });
    expect(unfiltered.rows[0].forbiddenTop1).toBe(true);
    expect(unfiltered.rows[0].documentRecall).toBe(0);
    expect(unfiltered.rows[1].noAnswerPass).toBe(false);
  });

  it('뒤쪽 같은 문서의 정답 구절과 rank 2 hard 제외 누출을 잃지 않는다', () => {
    const row = evaluateQuery({ goldPaths: ['a'], goldPassages: [{ path: 'a', startLine: 9, endLine: 9 }], hardExcludedPaths: ['x'] }, [
      { path: 'a', startLine: 1, endLine: 1 }, { path: 'a', startLine: 9, endLine: 9 }, { path: 'x', startLine: 1, endLine: 1 },
    ]);
    expect(row.passageAllHit).toBe(true);
    expect(row.hardExclusionLeakage).toBe(true);
  });
  it('문서의 금지 chunk 원장을 관련성 distractor로 연결한다', () => {
    const corpus = createSyntheticCorpus({ scale: 'ci' });
    const documents = corpus.documents.filter((doc) => doc.forbiddenChunkIndexes.length);
    expect(documents.length).toBeGreaterThan(0);
    for (const doc of documents) expect(corpus.queries.some((q) => q.forbiddenPaths.includes(doc.path))).toBe(true);
  });
});

it('벤치 CLI 게이트도 필수 사례·갱신·안정성 실패를 평균으로 상쇄하지 않는다', async () => {
  const { benchmarkGate } = await import('./search-eval/metrics.mjs');
  const summary = { overall: { documentRecall: 1, mrr: 1, ndcg10: 1, passageHitRatio: 1 }, rows: [{ documentRecall: 1, noAnswerPass: null, multiGoldCovered: true, conflictPairCovered: true }] };
  const update = { supported: true, changedRetrievable: true, addedRetrievable: true, removedAbsent: true };
  expect(benchmarkGate(summary, update, true)).toBe(true);
  expect(benchmarkGate({ ...summary, rows: [...summary.rows, { documentRecall: 0 }] }, update, true)).toBe(false);
  expect(benchmarkGate({ ...summary, rows: [{ ...summary.rows[0], passageAllHit: false }] }, update, true)).toBe(false);
  for (const field of ['noAnswerPass', 'multiGoldCovered', 'conflictPairCovered'])
    expect(benchmarkGate({ ...summary, rows: [{ ...summary.rows[0], [field]: false }] }, update, true)).toBe(false);
  expect(benchmarkGate({ ...summary, rows: [{ ...summary.rows[0], hardExclusionLeakage: true }] }, update, true)).toBe(false);
  expect(benchmarkGate(summary, { ...update, removedAbsent: false }, true)).toBe(false);
  expect(benchmarkGate(summary, update, false)).toBe(false);
});
