import { describe, expect, it } from 'vitest';

import {
  assignVectorClustersRust,
  calculateHybridScoreRust,
  calculateRrfScoreRust,
  createContentHashRust,
  chunkMarkdownRust,
  chunkPlainTextRust,
  aggregateGraphEdgesRust,
  bm25TermFrequenciesRust,
  detectCommunitiesRust,
  extractVaultLinksRust,
  isExcludedPathRust,
  isRustCoreAvailable,
  normalizeEntityNameRust,
  parseMentionCandidatesRust,
  rankTopKPairsRust,
  recomputeCentroidsRust,
  scoreEntityMatchRust,
  scoreBm25Rust,
  selectDiverseIndicesRust,
  scoreLocalEvidenceRust,
  tokenizeRust,
} from './rust-core';

describe('Rust WASM RAG core bridge', () => {
  it('loads embedded WASM bytes synchronously', () => {
    expect(isRustCoreAvailable()).toBe(true);
  });

  it('preserves content hash and tokenizer contracts through WASM', () => {
    expect(createContentHashRust('hello')).toBe('4f9f2cab');
    expect(createContentHashRust('요고49 포인트 페이백')).toBe('d30c670d');

    const tokens = tokenizeRust('OpenRouter freeLLMApi 요고49 포인트 페이백');
    expect(tokens).not.toBeNull();
    expect(tokens).toContain('openrouter');
    expect(tokens).toContain('free');
    expect(tokens).toContain('llm');
    expect(tokens).toContain('요고49');
    expect(tokens).toContain('포인트');
  });

  it('returns BM25 term frequencies from Rust tokenizer output', () => {
    const frequencies = bm25TermFrequenciesRust('OpenRouter OpenRouter freeLLMApi');

    expect(frequencies).toEqual({
      totalTokens: 10,
      frequencies: {
        openrouter: 2,
        open: 2,
        router: 2,
        freellmapi: 1,
        free: 1,
        llm: 1,
        api: 1,
      },
    });
  });

  it('returns original vector row indexes and scores for top-k ranking', () => {
    const scores = rankTopKPairsRust(
      [1, 0],
      [
        [0, 1],
        [1, 0],
        [0.6, 0.8],
        [0, 0],
      ],
      3,
    );

    expect(scores).not.toBeNull();
    expect(scores).toEqual([
      { index: 1, score: 1 },
      { index: 2, score: 0.6 },
      { index: 0, score: 0 },
    ]);
  });

  it('assigns ANN vectors to nearest centroids through Rust', () => {
    const assignments = assignVectorClustersRust(
      [
        [1, 0],
        [0, 1],
        [0.8, 0.2],
        [0, 0],
      ],
      [
        [1, 0],
        [0, 1],
      ],
    );

    expect(assignments).toEqual([0, 1, 0, 0]);
  });

  it('recomputes ANN centroids through Rust while preserving empty clusters', () => {
    const centroids = recomputeCentroidsRust(
      [
        [1, 0],
        [0.5, 0.5],
        [0, 1],
      ],
      [0, 0, 2],
      [
        [9, 9],
        [8, 8],
        [7, 7],
      ],
    );

    expect(centroids).toEqual([
      [0.75, 0.25],
      [8, 8],
      [0, 1],
    ]);
  });

  it('returns BM25 document scores from flat posting data', () => {
    const scores = scoreBm25Rust(
      [
        {
          postings: [
            { docIndex: 0, termFrequency: 2, docLength: 3 },
            { docIndex: 1, termFrequency: 1, docLength: 4 },
          ],
        },
        {
          postings: [{ docIndex: 0, termFrequency: 1, docLength: 3 }],
        },
      ],
      2,
      3.5,
    );

    const firstTermIdf = Math.log((2 - 2 + 0.5) / (2 + 0.5) + 1);
    const secondTermIdf = Math.log((2 - 1 + 0.5) / (1 + 0.5) + 1);
    const bm25 = (idf: number, tf: number, docLength: number) =>
      idf * ((tf * (1.2 + 1)) / (tf + 1.2 * (1 - 0.75 + 0.75 * (docLength / 3.5))));

    expect(scores).not.toBeNull();
    expect(scores?.map((score) => score.index)).toEqual([0, 1]);
    expect(scores?.[0]?.score).toBeCloseTo(bm25(firstTermIdf, 2, 3) + bm25(secondTermIdf, 1, 3));
    expect(scores?.[1]?.score).toBeCloseTo(bm25(firstTermIdf, 1, 4));
  });

  it('returns RRF scores with retrieval source weights', () => {
    const score = calculateRrfScoreRust(
      {
        vector: 1,
        bm25: 3,
        structural: 2,
      },
      0.3,
    );

    const weighted = 0.7 * (1 / (60 + 1)) + 0.3 * (1 / (60 + 3)) + 0.12 * (1 / (60 + 2));
    const total = 0.7 * (1 / (60 + 1)) + 0.3 * (1 / (60 + 1)) + 0.12 * (1 / (60 + 1));

    expect(score).toBeCloseTo(weighted / total);
  });

  it('returns evidence-aware hybrid scores for strong graph sources', () => {
    const score = calculateHybridScoreRust({
      combinedBase: 0.2,
      rrfScore: 0.5,
      sourcePrior: 0.1,
      sourceEvidenceScore: 0.8,
      bestEvidenceRank: 3,
      retrievalSources: ['graph-local'],
    });

    expect(score).toBeCloseTo(0.58 + 0.8 * 0.25 + 0.5 * 0.08);
  });

  it('returns MMR diverse indexes with same-file penalties', () => {
    const indexes = selectDiverseIndicesRust(
      [
        { score: 1, vector: [1, 0], sourceKey: 1, headingKey: 1 },
        { score: 0.99, vector: [0.999, 0.001], sourceKey: 1, headingKey: 1 },
        { score: 0.96, vector: [0.96, 0.28], sourceKey: 2, headingKey: 0 },
      ],
      2,
    );

    expect(indexes).toEqual([0, 2]);
  });

  it('returns graph community assignments and modularity from numeric edges', () => {
    const result = detectCommunitiesRust(4, [0, 2, 1], [1, 3, 2], [1, 1, 0.1], 20);

    expect(result).not.toBeNull();
    expect(result?.assignments).toEqual([0, 0, 1, 1]);
    expect(result?.communityIds).toEqual([0, 1]);
    expect(result?.modularity).toBeGreaterThan(0);
  });

  it('aggregates GraphRAG relation edges by unordered endpoint pair', () => {
    const edges = aggregateGraphEdgesRust([2, 1, 2, 0], [1, 2, 0, 3], [0.4, 0.6, 0.2, 0.9], 4);

    expect(edges).toEqual([
      { sourceIndex: 1, targetIndex: 2, weight: 1 },
      { sourceIndex: 0, targetIndex: 2, weight: 0.2 },
      { sourceIndex: 0, targetIndex: 3, weight: 0.9 },
    ]);
  });

  it('extracts vault links through Rust with normalization and dedupe', () => {
    const links = extractVaultLinksRust(
      [
        '[[제품 개념 정리]]',
        '![[Monithub%EC%9D%98%20%EA%B0%80%EC%B9%98.md#핵심]]',
        '[[제품 개념 정리|alias]]',
        '[기획](../제품%20개념%20정리.md)',
        '[외부](https://example.com)',
      ].join('\n'),
    );

    expect(links).toEqual(['제품 개념 정리', 'Monithub의 가치.md', '../제품 개념 정리.md']);
  });

  it('matches vault exclude path patterns through Rust', () => {
    expect(isExcludedPathRust('Archive/old.txt', ['archive'])).toBe(true);
    expect(isExcludedPathRust('foo/.git/config', ['**/.git'])).toBe(true);
    expect(isExcludedPathRust('.git/config', ['.git/**'])).toBe(true);
    expect(isExcludedPathRust('Projects/drafts/note.md', ['**/drafts'])).toBe(true);
    expect(isExcludedPathRust('src/main.test.ts', ['src/*.test.ts'])).toBe(true);
    expect(isExcludedPathRust('notes/today.md', ['png', 'jpg'])).toBe(false);
    expect(isExcludedPathRust('images/logo.PNG', ['png'])).toBe(true);
  });

  it('scores GraphRAG entity name matches through Rust', () => {
    expect(normalizeEntityNameRust('  Saul / Paul【Apostle】  ')).toBe('saul paul apostle');

    const exactScore = scoreEntityMatchRust({
      candidateNames: ['Saul'],
      existingNames: ['Paul', 'Saul'],
      candidateDescription: 'Apostle',
      existingDescription: 'Paul Apostle',
      candidateEvidenceIds: [],
      existingEvidenceIds: [],
      sameType: true,
      embeddingScore: 0,
    });

    expect(exactScore).toBe(1);

    const partialScore = scoreEntityMatchRust({
      candidateNames: ['Apostle Paul'],
      existingNames: ['Paul the Apostle'],
      candidateDescription: 'Apostle missionary',
      existingDescription: 'Paul missionary',
      candidateEvidenceIds: ['evidence::acts'],
      existingEvidenceIds: ['evidence::acts'],
      sameType: true,
      embeddingScore: 0,
    });

    expect(partialScore).not.toBeNull();
    expect(partialScore).toBeGreaterThanOrEqual(0.72);
    expect(partialScore).toBeLessThan(1);
  });

  it('extracts chat mention candidates through Rust', () => {
    const candidates = parseMentionCandidatesRust(
      '@browser @[Project Plan.md] @[Project Plan.md] @[entity: Paul] @Notes/today.md @missing',
    );

    expect(candidates).toEqual([
      { raw: '@[Project Plan.md]', name: 'Project Plan.md' },
      { raw: '@[entity: Paul]', name: 'entity: Paul' },
      { raw: '@browser', name: 'browser' },
      { raw: '@Notes/today.md', name: 'Notes/today.md' },
      { raw: '@missing', name: 'missing' },
    ]);
  });

  it('returns GraphRAG local evidence scores from numeric graph inputs', () => {
    const scores = scoreLocalEvidenceRust({
      entityCount: 3,
      matchEntityIndices: [0],
      matchScores: [0.9],
      matchEvidenceOffsets: [0, 1],
      matchEvidenceIndices: [0],
      relationSourceIndices: [0, 1],
      relationTargetIndices: [1, 2],
      relationConfidences: [0.8, 0.7],
      relationEvidenceOffsets: [0, 1, 2],
      relationEvidenceIndices: [1, 2],
      claimEntityOffsets: [0, 1, 2],
      claimEntityIndices: [0, 1],
      claimConfidences: [0.6, 0.5],
      claimEvidenceOffsets: [0, 1, 2],
      claimEvidenceIndices: [3, 4],
      evidenceCount: 5,
      traversalDepth: 2,
    });

    expect(scores).not.toBeNull();
    expect(scores?.map((score) => score.index)).toEqual([0, 1, 3, 3, 3, 1, 2, 4, 4]);
    expect(scores?.[0]?.score).toBeCloseTo(0.865);
    expect(scores?.[1]?.score).toBeCloseTo(0.72);
    expect(scores?.[2]?.score).toBeCloseTo(0.54);
    expect(scores?.[3]?.score).toBeCloseTo(0.54);
    expect(scores?.[4]?.score).toBeCloseTo(0.54);
    expect(scores?.[5]?.score).toBeCloseTo((0.9 * 0.8) / 1.45);
    expect(scores?.[6]?.score).toBeCloseTo((0.72 * 0.82 * 0.7) / 1.45);
    expect(scores?.[7]?.score).toBeCloseTo((0.72 * 0.82 * 0.5) / 1.35);
    expect(scores?.[8]?.score).toBeCloseTo((0.72 * 0.82 * 0.5) / 1.35);
  });

  it('returns markdown chunks with heading and line metadata', () => {
    const chunks = chunkMarkdownRust(
      ['# First', 'alpha', '', 'beta', '# Second', '```', 'const value = 1;', '```'].join('\n'),
      100,
      0,
    );

    expect(chunks).toEqual([
      {
        text: '# First\nalpha\n\nbeta',
        metadata: {
          filePath: '',
          heading: 'First',
          startLine: 0,
          endLine: 3,
        },
      },
      {
        text: '# Second\n```\nconst value = 1;\n```',
        metadata: {
          filePath: '',
          heading: 'Second',
          startLine: 4,
          endLine: 7,
        },
      },
    ]);
  });

  it('returns plain text chunks with blank-line split metadata', () => {
    const chunks = chunkPlainTextRust(['alpha', '', 'beta beta'].join('\n'), 12, 0);

    expect(chunks).toEqual([
      {
        text: 'alpha',
        metadata: {
          filePath: '',
          startLine: 0,
          endLine: 1,
        },
      },
      {
        text: 'beta beta',
        metadata: {
          filePath: '',
          startLine: 2,
          endLine: 2,
        },
      },
    ]);
  });
});
