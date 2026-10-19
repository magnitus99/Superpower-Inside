import { describe, expect, it, vi } from 'vitest';
import type {
  IndexedVaultCorpus,
  IndexedVaultSearchOptions,
  IndexedVaultSearchResult,
} from '../agent/indexed-vault-review';
import { createIndexedSearchPort, toSearchResponse } from './engine-adapter';

function fixtureResult(): IndexedVaultSearchResult {
  const coverage = {
    documentScope: 'candidates' as const,
    status: 'incomplete' as const,
    reviewedDocuments: 2,
    unreviewedDocuments: 1,
    notIndexedDocuments: 3,
  };
  return {
    plan: {
      queryTokens: [
        { text: 'quartz', position: 0, field: 'content', kind: 'term', negated: false, phraseIndex: null },
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
    expect(response.coverage.documentScope).toBe('candidates');
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
    expect(calls[0]?.documentScope).toBe('candidates');
    expect(calls[0]?.filters).toEqual({ extensions: ['md'], modifiedAfter: 1 });
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(response?.evidence).toHaveLength(1);
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

  it('후보 단계가 초기화 중이면 빈 no-candidate 대신 initializing 상태를 반환한다', async () => {
    const search = vi.fn(() => Promise.resolve(fixtureResult()));
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']),
        candidatesState: 'initializing',
        inventory: { indexedCount: 1, unreviewedCount: 1, notIndexedCount: 0 },
        revisionReader: () => Promise.resolve('rev-1'),
      },
      search,
    );

    const response = await port({ query: 'quartz' });

    expect(search).not.toHaveBeenCalled();
    expect(response).not.toBeNull();
    expect(response?.evidence).toEqual([]);
    expect(response?.diagnostics.zeroHitReason).toBe('initializing');
    expect(response?.coverage).toMatchObject({
      documentScope: 'candidates',
      status: 'incomplete',
      reviewedDocuments: 0,
      unreviewedDocuments: 1,
    });
  });

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

  it('리비전 reader가 없으면 색인 사본을 결과로 내보내지 않는다', async () => {
    const port = createIndexedSearchPort(
      { corpus, getIndexedPaths: () => Promise.resolve(['Synthetic/Relevant.md']) },
      () => Promise.resolve(fixtureResult()),
    );

    await expect(port({ query: 'quartz' })).resolves.toBeNull();
  });
});
