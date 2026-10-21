import { describe, expect, it, vi } from 'vitest';
import type {
  IndexedVaultCorpus,
  IndexedVaultSearchOptions,
  IndexedVaultSearchResult,
} from '../agent/indexed-vault-review';
import { createIndexedSearchPort, toSearchResponse } from './engine-adapter';

function fixtureResult(): IndexedVaultSearchResult {
  const coverage = {
    requestedPaths: [],
    plannedPaths: [],
    unreviewedPaths: [],
    documentScope: 'all' as const,
    status: 'incomplete' as const,
    reviewedDocuments: 2,
    unreviewedDocuments: 1,
    notIndexedDocuments: 3,
  };
  return {
    plan: {
      queryTokens: [
        {
          text: 'quartz',
          position: 0,
          field: 'content',
          kind: 'term',
          negated: false,
          phraseIndex: null,
        },
      ],
      phrases: [{ tokens: ['cooling', 'cycle'], negated: false, field: 'content' }],
      evidence: [],
      order: ['source-1'],
      diagnostics: {
        candidateDepth: 4,
        candidateDocuments: 6,
        candidateChunks: 9,
        selectedDocuments: 2,
        selectedChunks: 3,
        truncated: true,
        droppedDocuments: { budget: 1, belowThreshold: 2, filtered: 3 },
        unmatchedTerms: ['titanium'],
        missingCandidatePaths: 1,
        zeroHitReason: null,
      },
      coverage,
      budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262144, usedChars: 1024 },
    },
    evidence: [
      {
        sourceId: 'source-1',
        path: 'Synthetic/Relevant.md',
        revision: 'rev-1',
        startLine: 3,
        endLine: 4,
        quote: 'Quartz restarts after cooling cycles.',
        contextBefore: '',
        contextAfter: '',
        score: 3.5,
        rank: 1,
        signal: 'phrase',
        phraseMatches: 1,
        proximityScore: 0.5,
        fieldScore: 1,
        fieldMatches: [],
        exactSignals: ['numeric'],
        negatedNearby: false,
        highlights: [{ start: 0, end: 6 }],
        duplicateOf: null,
      },
    ],
    rejected: [],
    coverage,
    scannedDocuments: 6,
    scannedPaths: 6,
  };
}

const corpus: IndexedVaultCorpus = {
  getEntriesByFilePaths: () => Promise.resolve([]),
  getFileIndexRecords: () => Promise.resolve([]),
};

describe('색인 검색 포트 어댑터', () => {
  it('엔진 결과를 화면 계약으로 옮기며 순위와 진단을 보존한다', () => {
    const response = toSearchResponse(fixtureResult());

    expect(response.evidence[0]?.sourceId).toBe('source-1');
    expect(response.evidence[0]?.rank).toBe(1);
    expect(response.evidence[0]?.signal).toBe('phrase');
    expect(response.queryTokens[0]?.text).toBe('quartz');
    expect(response.phrases[0]?.tokens).toEqual(['cooling', 'cycle']);
    expect(response.diagnostics.truncated).toBe(true);
    expect(response.diagnostics.droppedDocuments.filtered).toBe(3);
    expect(response.coverage.documentScope).toBe('all');
    expect(response.coverage.unreviewedDocuments).toBe(1);
  });

  it('질의·필터·색인 경로를 엔진에 그대로 전달한다', async () => {
    const calls: IndexedVaultSearchOptions[] = [];
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        revisionReader: () => Promise.resolve('rev-1'),
      },
      (options) => {
        calls.push(options);
        return Promise.resolve(fixtureResult());
      },
    );

    const controller = new AbortController();
    const response = await port({
      query: 'quartz cooling',
      filters: { extensions: ['md'], modifiedAfter: 1 },
      signal: controller.signal,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.question).toBe('quartz cooling');
    expect(calls[0]?.indexedPaths).toEqual(['Synthetic/Relevant.md']);
    expect(calls[0]?.documentScope).toBe('all');
    expect(calls[0]?.filters).toEqual({ extensions: ['md'], modifiedAfter: 1 });
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(response?.evidence).toHaveLength(1);
  });

  it('reviewPaths를 검토 경로로 쓰고 exhaustiveReview를 엔진에 전달한다', async () => {
    const calls: IndexedVaultSearchOptions[] = [];
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Full.md', 'Synthetic/Review.md']),
        reviewPaths: ['Synthetic/Review.md'],
        exhaustiveReview: true,
        inventory: { indexedCount: 5403, unreviewedCount: 0, notIndexedCount: 0 },
        revisionReader: () => Promise.resolve('rev-1'),
      },
      (options) => {
        calls.push(options);
        return Promise.resolve(fixtureResult());
      },
    );

    await port({ query: 'quartz' });

    expect(calls[0]?.indexedPaths).toEqual(['Synthetic/Review.md']);
    expect(calls[0]?.exhaustiveReview).toBe(true);
    expect(calls[0]?.inventory?.indexedCount).toBe(5403);
  });

  it('필터 검색은 후보 subset 대신 전체 색인을 검토 경로로 사용한다', async () => {
    const calls: IndexedVaultSearchOptions[] = [];
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () =>
          Promise.resolve(['Synthetic/Full-A.md', 'Synthetic/Full-B.md', 'Synthetic/Review.md']),
        reviewPaths: ['Synthetic/Review.md'],
        exhaustiveReview: true,
        inventory: { indexedCount: 3, unreviewedCount: 0, notIndexedCount: 0 },
        revisionReader: () => Promise.resolve('rev-1'),
      },
      (options) => {
        calls.push(options);
        return Promise.resolve(fixtureResult());
      },
    );

    await port({ query: 'quartz', filters: { extensions: ['md'] } });

    expect(calls[0]?.indexedPaths).toEqual([
      'Synthetic/Full-A.md',
      'Synthetic/Full-B.md',
      'Synthetic/Review.md',
    ]);
    expect(calls[0]?.exhaustiveReview).toBe(false);
  });

  it('verifyCurrentSource false는 검색 화면에서 전체 원문 재추출을 생략한다', async () => {
    const sourceReader = vi.fn(() =>
      Promise.resolve({ revision: 'rev-1', text: '현재 원문' }),
    );
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        revisionReader: () => Promise.resolve('rev-1'),
        sourceReader,
        verifyCurrentSource: false,
      },
      () => Promise.resolve(fixtureResult()),
    );

    const response = await port({ query: 'quartz' });

    expect(sourceReader).not.toHaveBeenCalled();
    expect(response?.evidence.length).toBeGreaterThan(0);
    expect(response?.staleDocuments).toBe(0);
  });

  it('엔진이 null을 돌려주면 화면도 null을 받는다', async () => {
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve([]),
        revisionReader: () => Promise.resolve('rev-1'),
      },
      () => Promise.resolve(null),
    );

    await expect(port({ query: 'quartz' })).resolves.toBeNull();
  });

  it('indexing 상태는 빈 no-candidate 대신 all 범위 pending 상태를 반환한다', async () => {
    const search = vi.fn(() => Promise.resolve(fixtureResult()));
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        candidatesState: 'indexing',
        inventory: { indexedCount: 1, unreviewedCount: 1, notIndexedCount: 0 },
        revisionReader: () => Promise.resolve('rev-1'),
      },
      search,
    );

    const response = await port({ query: 'quartz' });

    expect(search).not.toHaveBeenCalled();
    expect(response).not.toBeNull();
    expect(response?.evidence).toEqual([]);
    expect(response?.diagnostics.zeroHitReason).toBe('indexing');
    expect(response?.coverage).toMatchObject({
      documentScope: 'all',
      status: 'incomplete',
      reviewedDocuments: 0,
      unreviewedDocuments: 1,
    });
  });

  it.each(['initializing', 'unavailable'] as const)(
    '%s 후보 상태에서도 all lexical 검토를 계속한다',
    async (candidatesState) => {
      const search = vi.fn<
        (options: IndexedVaultSearchOptions) => Promise<IndexedVaultSearchResult>
      >();
      search.mockResolvedValue(fixtureResult());
      const port = createIndexedSearchPort(
        {
          corpus,
          getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
          candidatesState,
          inventory: { indexedCount: 1, unreviewedCount: 1, notIndexedCount: 0 },
          revisionReader: () => Promise.resolve('rev-1'),
        },
        search,
      );

      const response = await port({ query: 'quartz' });

      expect(search).toHaveBeenCalledOnce();
      expect(search.mock.calls[0]?.[0].documentScope).toBe('all');
      expect(response).not.toBeNull();
      expect(response?.evidence).toHaveLength(1);
      expect(response?.coverage.documentScope).toBe('all');
    },
  );

  it('현재 원문 리비전과 어긋난 구절은 결과에서 제외하고 coverage를 미완료로 낮춘다', async () => {
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        revisionReader: () => Promise.resolve('rev-2'),
      },
      () => Promise.resolve(fixtureResult()),
    );

    const response = await port({ query: 'quartz' });
    expect(response?.evidence).toEqual([]);
    expect(response?.staleDocuments).toBe(1);
    expect(response?.diagnostics.selectedDocuments).toBe(0);
    expect(response?.coverage.status).toBe('incomplete');
  });

  it('현재 원문 구절과 절대 행이 어긋나면 검색 화면에서도 제외한다', async () => {
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        revisionReader: () => Promise.resolve('rev-1'),
        sourceReader: () =>
          Promise.resolve({ revision: 'rev-1', text: '다른 현재 원문' }),
      },
      () => Promise.resolve(fixtureResult()),
    );

    const response = await port({ query: 'quartz' });
    expect(response?.evidence).toEqual([]);
    expect(response?.staleDocuments).toBe(1);
    expect(response?.diagnostics.selectedDocuments).toBe(0);
    expect(response?.coverage.status).toBe('incomplete');
  });

  it('현재 원문 구절과 절대 행이 맞으면 검색 화면 결과를 유지한다', async () => {
    const result = fixtureResult();
    const evidence = result.evidence[0];
    if (!evidence) throw new Error('fixture evidence missing');
    const matchingResult = {
      ...result,
      evidence: [{ ...evidence, endLine: 3 }],
    };
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        revisionReader: () => Promise.resolve('rev-1'),
        sourceReader: () =>
          Promise.resolve({
            revision: 'rev-1',
            text: '첫 줄\n둘째 줄\nQuartz restarts after cooling cycles.\n넷째 줄',
          }),
      },
      () => Promise.resolve(matchingResult),
    );

    const response = await port({ query: 'quartz' });
    expect(response?.evidence).toHaveLength(1);
    expect(response?.staleDocuments).toBe(0);
    expect(response?.coverage.status).toBe('incomplete');
  });

  it('리비전 reader가 없으면 색인 사본을 결과로 내보내지 않는다', async () => {
    const port = createIndexedSearchPort(
      { corpus, getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']) },
      () => Promise.resolve(fixtureResult()),
    );

    await expect(port({ query: 'quartz' })).resolves.toBeNull();
  });
});
