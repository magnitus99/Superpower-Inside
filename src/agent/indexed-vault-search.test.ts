import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planIndexedEvidenceRust, verifyIndexedEvidenceRust } from '../rag/rust-core';
import { searchIndexedVault, type IndexedVaultCorpus } from './indexed-vault-review';
import { buildSourceDocuments } from '../rag/source-document';
import { toDocumentEntry } from '../rag/document-corpus-store';
import { createIndexedSearchPort } from '../search/engine-adapter';
import type { TFile } from 'obsidian';

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    planIndexedEvidenceRust: vi.fn(actual.planIndexedEvidenceRust),
    verifyIndexedEvidenceRust: vi.fn(actual.verifyIndexedEvidenceRust),
  };
});

const RELEVANT = 'Synthetic/Relevant.md';
const OTHER = 'Synthetic/Other.md';

function planFor(input: {
  documents: readonly { path: string; text: string; startLine?: number; revision?: string }[];
}) {
  const document =
    input.documents.find((item) => item.text.includes('cooling cycles')) ?? input.documents.at(-1);
  if (!document) return planOfRows([], []);
  const sourceId = document.path + '#L3-L4';
  return {
    queryTokens: [],
    phrases: [],
    order: [sourceId],
    evidence: [
      {
        sourceId,
        path: document.path,
        revision: document.revision ?? null,
        startLine: document.startLine ?? 1,
        endLine: (document.startLine ?? 1) + 1,
        quote: 'two cooling cycles',
        contextBefore: '',
        contextAfter: '',
        score: 1,
        rank: 1,
        signal: 'lexical',
        phraseMatches: 1,
        proximityScore: 1,
        fieldScore: 1,
        exactSignals: [],
        fieldMatches: [],
        negatedNearby: false,
        highlights: [],
        duplicateOf: null,
      },
    ],
    diagnostics: {
      candidateDepth: input.documents.length,
      candidateDocuments: input.documents.length,
      selectedDocuments: 1,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: input.documents.length - 1, filtered: 0 },
      zeroHitReason: null,
      unmatchedTerms: [],
      candidateChunks: input.documents.length,
      selectedChunks: 1,
      missingCandidatePaths: 0,
    },
    coverage: {
      status: 'supported',
      reviewedDocuments: input.documents.length,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262144, usedChars: 64 },
  };
}

function rowFor(path: string, score: number, quote: string, startLine = 1) {
  return {
    sourceId: `${path}#L${startLine}-L${startLine}`,
    path,
    revision: '1:10',
    startLine,
    endLine: startLine,
    quote,
    contextBefore: '',
    contextAfter: '',
    score,
    rank: 1,
    signal: 'lexical',
    phraseMatches: 1,
    proximityScore: 1,
    fieldScore: 1,
    exactSignals: [],
    fieldMatches: [],
    negatedNearby: false,
    highlights: [],
    duplicateOf: null,
  };
}

function planOfRows(
  documents: readonly { path: string }[],
  rows: readonly ReturnType<typeof rowFor>[],
) {
  return {
    queryTokens: [],
    phrases: [],
    order: rows.map((row) => row.sourceId),
    evidence: rows,
    diagnostics: {
      candidateDepth: documents.length,
      candidateDocuments: documents.length,
      selectedDocuments: new Set(rows.map((row) => row.path)).size,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
      zeroHitReason: null,
      unmatchedTerms: [],
      candidateChunks: documents.length,
      selectedChunks: rows.length,
      missingCandidatePaths: 0,
    },
    coverage: {
      status: 'supported' as const,
      reviewedDocuments: documents.length,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262144, usedChars: rows.length },
  };
}

function fixtureCorpus(): { corpus: IndexedVaultCorpus; requested: string[] } {
  const requested: string[] = [];
  const records = [
    {
      filePath: 'Synthetic/Relevant.md',
      contentHash: 'hash-relevant',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
    {
      filePath: 'Synthetic/Other.md',
      contentHash: 'hash-other',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
  ];
  const entries = [
    {
      id: 'entry',
      vector: [],
      metadata: {
        filePath: 'Synthetic/Relevant.md',
        startLine: 3,
        endLine: 4,
        text: 'Quartz restarts only after two cooling cycles.',
        contentHash: 'hash-relevant',
      },
    },
    {
      id: 'entry',
      vector: [],
      metadata: {
        filePath: 'Synthetic/Other.md',
        startLine: 1,
        endLine: 1,
        text: 'Delivery schedule for the northern region.',
        contentHash: 'hash-other',
      },
    },
  ];
  const corpus: IndexedVaultCorpus = {
    getEntriesByFilePaths: (paths) => {
      requested.push(...paths);
      return Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath)));
    },
    getFileIndexRecords: () => Promise.resolve(records),
  };
  return { corpus, requested };
}

describe('색인 엔진 근거 선별', () => {
  it('raw corpus 필드와 1 기반 줄을 실제 엔진의 구절·태그 필터로 연결한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const file = {
      path: RELEVANT,
      basename: 'Relevant',
      extension: 'md',
      stat: { mtime: 1, size: 80 },
    } as TFile;
    const documents = buildSourceDocuments(
      file,
      '# Intro\nNo match\n\n# Cooling\nQuartz cooling cycles',
      { chunkSize: 1000, overlap: 0 },
      [],
      {
        frontmatter: { title: 'Thermal Guide', tags: ['thermal'] },
      },
    );
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: () => Promise.resolve(documents.map(toDocumentEntry)),
      getFileIndexRecords: () =>
        Promise.resolve([
          {
            filePath: RELEVANT,
            contentHash: documents[0]?.contentHash,
            sourceMtime: 1,
            sourceSize: 80,
            vectorCount: documents.length,
            updated: 1,
          },
        ]),
    };
    const options = {
      question: '"Quartz cooling cycles"',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus,
      filters: { tags: ['thermal'] },
    };
    const result = await searchIndexedVault(options);
    expect(result?.evidence).toHaveLength(1);
    expect(result?.evidence[0]).toMatchObject({
      startLine: 4,
      endLine: 5,
      revision: '1:80',
      quote: '# Cooling\nQuartz cooling cycles',
    });
    expect(result?.rejected).toEqual([]);
    const input = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0];
    expect(input?.documents[1]).toMatchObject({
      title: 'Thermal Guide',
      headings: ['Cooling'],
      tags: ['thermal'],
      startLine: 4,
      text: '# Cooling\nQuartz cooling cycles',
    });
    expect(
      (await searchIndexedVault({ ...options, filters: { tags: ['absent'] } }))?.evidence,
    ).toEqual([]);
  });

  it.each(
    [
      'missing-record',
      'oversize',
      'partial',
      'hash-mismatch',
      'metadata-mismatch',
      'read-failure',
    ].flatMap((failure) =>
      (['all', 'candidates'] as const).map((documentScope) => ({ failure, documentScope })),
    ),
  )(
    '$documentScope의 $failure 후보는 지원 근거가 있어도 미검토 coverage를 유지한다',
    async ({ failure, documentScope }) => {
      const { corpus } = fixtureCorpus();
      const failing: IndexedVaultCorpus = {
        getFileIndexRecords: async () =>
          (await corpus.getFileIndexRecords()).flatMap((record) => {
            if (record.filePath !== OTHER) return [record];
            if (failure === 'missing-record') return [];
            return [{ ...record, vectorCount: failure === 'partial' ? 2 : 1 }];
          }),
        getEntriesByFilePaths: async (paths) => {
          if (failure === 'read-failure') throw new Error('synthetic read failure');
          return (await corpus.getEntriesByFilePaths(paths)).map((entry) =>
            entry.metadata.filePath !== OTHER
              ? entry
              : {
                  ...entry,
                  metadata: {
                    ...entry.metadata,
                    text:
                      failure === 'oversize' ? 'x'.repeat(3 * 1024 * 1024) : entry.metadata.text,
                    contentHash:
                      failure === 'hash-mismatch' ? 'wrong-hash' : entry.metadata.contentHash,
                    sourceMtime: failure === 'metadata-mismatch' ? 2 : undefined,
                  },
                },
          );
        },
      };
      const result = await searchIndexedVault({
        question: 'Quartz cooling cycles',
        indexedPaths: [RELEVANT, OTHER],
        scopes: [],
        corpus: failing,
        documentScope,
        candidates: [
          { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
          { path: OTHER, score: 1, source: 'bm25', rank: 2 },
        ],
      });
      expect(result?.coverage.status).toBe('incomplete');
      expect(result?.coverage.unreviewedDocuments).toBeGreaterThanOrEqual(1);
      expect(result?.coverage.requestedPaths).toEqual([RELEVANT, OTHER]);
      expect(result?.coverage.unreviewedPaths).toContain(OTHER);
      if (failure === 'missing-record' || failure === 'oversize') {
        expect(result?.coverage.plannedPaths).toEqual([RELEVANT]);
      }
    },
  );

  it.each(['all', 'candidates'] as const)(
    '%s에서 한 파일의 일부 청크만 payload에 들어가도 미검토를 유지한다',
    async (documentScope) => {
      const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
      vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
      vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
      const corpus: IndexedVaultCorpus = {
        getEntriesByFilePaths: () =>
          Promise.resolve([
            {
              id: 'valid',
              vector: [],
              metadata: {
                filePath: RELEVANT,
                text: 'Quartz cooling cycles',
                startLine: 1,
                contentHash: 'hash',
              },
            },
            {
              id: 'oversize',
              vector: [],
              metadata: {
                filePath: RELEVANT,
                text: 'x'.repeat(2 * 1024 * 1024 + 1),
                startLine: 1,
                contentHash: 'hash',
              },
            },
          ]),
        getFileIndexRecords: () =>
          Promise.resolve([
            {
              filePath: RELEVANT,
              contentHash: 'hash',
              sourceMtime: 1,
              sourceSize: 10,
              vectorCount: 2,
              updated: 1,
            },
          ]),
      };
      const result = await searchIndexedVault({
        question: 'Quartz cooling cycles',
        indexedPaths: [RELEVANT],
        scopes: [],
        corpus,
        documentScope,
        candidates: [{ path: RELEVANT, score: 1, source: 'bm25', rank: 1 }],
      });
      expect(result?.evidence).toHaveLength(1);
      expect(result?.coverage).toMatchObject({
        status: 'incomplete',
        reviewedDocuments: 0,
        unreviewedDocuments: 1,
        plannedPaths: [RELEVANT],
        unreviewedPaths: [RELEVANT],
      });
    },
  );

  it('JSON 이스케이프가 커져도 payload 분할은 청크를 누락하지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockClear();
    const entries = Array.from({ length: 5 }, (_, index) => ({
      id: `chunk-${index}`,
      vector: [],
      metadata: {
        filePath: RELEVANT,
        text: '\\'.repeat(900_000),
        startLine: index,
        contentHash: 'hash',
      },
    }));
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: () => Promise.resolve(entries),
      getFileIndexRecords: () =>
        Promise.resolve([
          {
            filePath: RELEVANT,
            contentHash: 'hash',
            sourceMtime: 1,
            sourceSize: 10,
            vectorCount: entries.length,
            updated: 1,
          },
        ]),
    };
    const result = await searchIndexedVault({
      question: 'Quartz',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus,
    });
    const calls = vi.mocked(planIndexedEvidenceRust).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.flatMap(([input]) => input.documents)).toHaveLength(entries.length);
    expect(
      calls.every(
        ([input]) => new TextEncoder().encode(JSON.stringify(input)).byteLength < 8 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(result?.coverage.unreviewedPaths).toEqual([]);
  });

  it('전체 색인이 커도 정상 후보만 읽으면 후보 coverage는 supported이며 전역 미색인 수는 보존한다', async () => {
    const { corpus, requested } = fixtureCorpus();
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      documentScope: 'candidates',
      candidates: [{ path: RELEVANT, score: 1, source: 'bm25', rank: 1 }],
      inventory: { indexedCount: 5403, unreviewedCount: 0, notIndexedCount: 2 },
    });
    expect(requested).toEqual([RELEVANT]);
    expect(result?.coverage).toMatchObject({
      status: 'supported',
      reviewedDocuments: 1,
      unreviewedDocuments: 0,
      notIndexedDocuments: 2,
    });
  });
  it('all의 요청 밖 색인과 파일 기록 누락은 서로 다른 미검토 문서로 집계한다', async () => {
    const { corpus } = fixtureCorpus();
    const partial: IndexedVaultCorpus = {
      getEntriesByFilePaths: (paths) => corpus.getEntriesByFilePaths(paths),
      getFileIndexRecords: async () =>
        (await corpus.getFileIndexRecords()).filter((record) => record.filePath === RELEVANT),
    };
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus: partial,
      inventory: { indexedCount: 3, unreviewedCount: 0, notIndexedCount: 0 },
    });
    expect(result?.coverage).toMatchObject({
      reviewedDocuments: 1,
      unreviewedDocuments: 2,
      status: 'incomplete',
    });
  });

  it('exhaustiveReview는 5,403개 전체를 검토 완료로 유지하고 review subset 실패만 미검토로 센다', async () => {
    const reviewPaths = Array.from(
      { length: 100 },
      (_, index) => `Synthetic/Exhaustive-${String(index).padStart(3, '0')}.md`,
    );
    const records = reviewPaths.map((filePath) => ({
      filePath,
      contentHash: `hash-${filePath}`,
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    }));
    const entries = reviewPaths.map((filePath) => ({
      id: `entry-${filePath}`,
      vector: [],
      metadata: {
        filePath,
        startLine: 1,
        endLine: 1,
        text: filePath.endsWith('000.md')
          ? 'Quartz restarts after two cooling cycles.'
          : `Synthetic indexed body ${filePath}`,
        contentHash: `hash-${filePath}`,
      },
    }));
    const exhaustiveCorpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: (paths) =>
        Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
      getFileIndexRecords: () => Promise.resolve(records),
    };
    const inventory = { indexedCount: 5403, unreviewedCount: 0, notIndexedCount: 0 };

    const complete = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: reviewPaths,
      scopes: [],
      corpus: exhaustiveCorpus,
      inventory,
      exhaustiveReview: true,
    });
    expect(complete?.coverage).toMatchObject({
      status: 'supported',
      reviewedDocuments: 5403,
      unreviewedDocuments: 0,
      unreviewedPaths: [],
    });

    const missingPath = reviewPaths.at(-1);
    if (!missingPath) throw new Error('synthetic review path missing');
    const partial = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: reviewPaths,
      scopes: [],
      corpus: {
        ...exhaustiveCorpus,
        getFileIndexRecords: () =>
          Promise.resolve(records.filter((record) => record.filePath !== missingPath)),
      },
      inventory,
      exhaustiveReview: true,
    });
    expect(partial?.coverage).toMatchObject({
      status: 'incomplete',
      reviewedDocuments: 5402,
      unreviewedDocuments: 1,
      unreviewedPaths: [missingPath],
    });
  });
  beforeEach(() => {
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) => planFor(input) as never);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation((input) => ({
      statuses: input.evidence.map((item) => ({
        sourceId: item.sourceId,
        path: item.path,
        status: 'verified',
        exists: true,
        lineMatches: true,
        offsetMatches: null,
        revisionState: 'match',
        scopeState: 'in-scope',
        reviewState: 'reviewed',
        duplicateOf: null,
      })),
    }));
  });

  it('질문 구절이 있는 문서만 검증된 근거로 채택한다', async () => {
    const { corpus } = fixtureCorpus();
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: ['Synthetic/Relevant.md', 'Synthetic/Other.md'],
      scopes: [],
      corpus,
    });
    expect(result).not.toBeNull();
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.evidence.every((item) => item.path === RELEVANT)).toBe(true);
    expect(result?.evidence[0]?.quote).toContain('cooling cycles');
    expect(result?.rejected.some((item) => item.path === 'Synthetic/Other.md')).toBe(false);
    expect(['supported', 'incomplete', 'budget-exhausted']).toContain(result?.coverage.status);
    expect(result?.scannedDocuments).toBe(2);
    expect(result?.scannedPaths).toBe(2);
  });

  it('원문 리비전(mtime:size)이 없는 색인 기록은 엔진 입력에서 제외한다', async () => {
    const { corpus } = fixtureCorpus();
    const withoutRevision: IndexedVaultCorpus = {
      getEntriesByFilePaths: (paths) => corpus.getEntriesByFilePaths(paths),
      getFileIndexRecords: () =>
        Promise.resolve([
          { filePath: RELEVANT, contentHash: 'hash-relevant', vectorCount: 1, updated: 1 },
        ]),
    };
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: withoutRevision,
    });
    expect(result?.evidence).toEqual([]);
    expect(result?.coverage).toMatchObject({ status: 'incomplete', unreviewedDocuments: 1 });
  });

  it('hybrid 후보와 inventory를 전달하고 기본 all 모드는 전체 경로를 조회한다', async () => {
    const { corpus, requested } = fixtureCorpus();
    const captured: unknown[] = [];
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) => {
      captured.push(input);
      return planFor(input) as never;
    });
    const candidate = {
      path: RELEVANT,
      startLine: 3,
      endLine: 4,
      score: 0.9,
      source: 'vector' as const,
      rank: 1,
    };
    const searchResult = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      candidates: [candidate],
      inventory: { indexedCount: 2, unreviewedCount: 0, notIndexedCount: 1 },
    });
    const input = captured[0] as {
      candidates?: unknown[];
      inventory?: { indexedCount: number; unreviewedCount: number; notIndexedCount: number };
    };
    expect(input.candidates).toEqual([candidate]);
    expect(input.inventory).toEqual({ indexedCount: 2, unreviewedCount: 0, notIndexedCount: 1 });
    expect(requested).toEqual([RELEVANT, OTHER]);
    expect(searchResult?.coverage.documentScope).toBe('all');
    expect(searchResult?.scannedPaths).toBe(2);
  });

  it('후보가 일부여도 공통어를 전체 색인에서 평가해 후보 밖 근거를 선택한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const paths = Array.from(
      { length: 66 },
      (_, index) => `Synthetic/Common-${String(index + 1).padStart(2, '0')}.md`,
    );
    const reviewPaths = paths.slice(0, 64);
    const targetPath = reviewPaths[2];
    if (!targetPath) throw new Error('synthetic target path missing');
    const candidatePaths = paths.slice(0, 2);
    const records = paths.map((filePath) => ({
      filePath,
      contentHash: `hash-${filePath}`,
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    }));
    const entries = paths.map((filePath) => ({
      id: `entry-${filePath}`,
      vector: [],
      metadata: {
        filePath,
        ...(filePath === targetPath ? { heading: 'sharedterm' } : {}),
        startLine: 1,
        endLine: 1,
        text:
          filePath === targetPath
            ? Array.from({ length: 64 }, () => 'sharedterm').join(' ')
            : `sharedterm synthetic document ${filePath}`,
        contentHash: `hash-${filePath}`,
      },
    }));
    const requested: string[] = [];
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: (requestedPaths) => {
        requested.push(...requestedPaths);
        return Promise.resolve(
          entries.filter((entry) => requestedPaths.includes(entry.metadata.filePath)),
        );
      },
      getFileIndexRecords: () => Promise.resolve(records),
    };
    const port = createIndexedSearchPort(
      {
        corpus,
        getIndexedPaths: () => Promise.resolve(paths),
        reviewPaths,
        exhaustiveReview: true,
        inventory: { indexedCount: 5403, unreviewedCount: 0, notIndexedCount: 0 },
        candidates: reviewPaths.map((path, index) => ({
          path,
          score: 1,
          source: 'bm25' as const,
          rank: index + 1,
        })),
        candidatesState: 'ready',
        revisionReader: () => Promise.resolve('1:10'),
      },
      searchIndexedVault,
    );

    const response = await port({ query: 'sharedterm' });
    const selectedPaths = new Set(response?.evidence.map((item) => item.path) ?? []);
    expect(requested).toEqual(reviewPaths);
    expect(response?.coverage.documentScope).toBe('all');
    expect(response?.coverage.reviewedDocuments).toBe(5403);
    expect(selectedPaths.has(targetPath)).toBe(true);
    expect([...selectedPaths].some((path) => !candidatePaths.includes(path))).toBe(true);
  });

  it('candidates 모드는 후보 경로만 조회하면서 후보 신호와 coverage 범위를 보존한다', async () => {
    const { corpus, requested } = fixtureCorpus();
    const candidate = {
      path: OTHER,
      startLine: 1,
      endLine: 1,
      score: 0.7,
      source: 'bm25' as const,
      rank: 1,
    };
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      candidates: [candidate, candidate, { ...candidate, path: 'Synthetic/Missing.md', rank: 2 }],
      documentScope: 'candidates',
      inventory: { indexedCount: 2, unreviewedCount: 0, notIndexedCount: 0 },
    });

    expect(requested).toEqual([OTHER]);
    expect(result?.scannedPaths).toBe(1);
    expect(result?.coverage).toMatchObject({
      documentScope: 'candidates',
      reviewedDocuments: 1,
      unreviewedDocuments: 1,
      status: 'incomplete',
    });
    const input = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0];
    expect(input?.candidates).toEqual([
      candidate,
      candidate,
      { ...candidate, path: 'Synthetic/Missing.md', rank: 2 },
    ]);
  });

  it('candidates 모드에서 후보가 없으면 corpus를 읽지 않고 정상적인 빈 결과를 반환한다', async () => {
    const getEntriesByFilePaths = vi.fn(() => Promise.resolve([]));
    const getFileIndexRecords = vi.fn(() => Promise.resolve([]));
    const corpus: IndexedVaultCorpus = { getEntriesByFilePaths, getFileIndexRecords };
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);

    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      candidates: [],
      documentScope: 'candidates',
      inventory: { indexedCount: 5403, unreviewedCount: 0, notIndexedCount: 2 },
    });

    expect(getEntriesByFilePaths).not.toHaveBeenCalled();
    expect(getFileIndexRecords).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.evidence).toEqual([]);
    expect(result?.scannedPaths).toBe(0);
    expect(result?.coverage).toMatchObject({
      documentScope: 'candidates',
      status: 'supported',
      reviewedDocuments: 0,
      unreviewedDocuments: 0,
      notIndexedDocuments: 2,
    });
  });

  it('candidates 모드도 엔진이 검증한 전역 근거 순서를 그대로 반환한다', async () => {
    const { corpus } = fixtureCorpus();
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) =>
      planOfRows(
        input.documents,
        input.documents.map((document) =>
          rowFor(
            document.path,
            document.path === OTHER ? 2 : 1,
            `Quartz cooling cycles ${document.path}`,
          ),
        ),
      ),
    );
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      candidates: [
        { path: RELEVANT, score: 2, source: 'vector', rank: 1 },
        { path: OTHER, score: 1, source: 'bm25', rank: 2 },
      ],
      documentScope: 'candidates',
    });

    expect(result?.evidence.map((item) => item.path)).toEqual([OTHER, RELEVANT]);
    expect(result?.plan.order).toEqual(result?.evidence.map((item) => item.sourceId));
    expect(result?.evidence.map((item) => item.rank)).toEqual([1, 2]);
  });

  it('청크 메타데이터가 빠진 색인 경로는 inventory 미검토로 집계한다', async () => {
    const { corpus } = fixtureCorpus();
    const partial: IndexedVaultCorpus = {
      getFileIndexRecords: () => corpus.getFileIndexRecords(),
      getEntriesByFilePaths: (paths) =>
        corpus
          .getEntriesByFilePaths(paths)
          .then((entries) =>
            entries.map((entry) =>
              entry.metadata.filePath === OTHER
                ? { ...entry, metadata: { ...entry.metadata, contentHash: undefined } }
                : entry,
            ),
          ),
    };
    const captured: unknown[] = [];
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) => {
      captured.push(input);
      return planFor(input) as never;
    });
    const searchResult = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus: partial,
    });
    const input = captured[0] as {
      inventory?: { indexedCount: number; unreviewedCount: number };
    };
    expect(input.inventory?.indexedCount).toBe(2);
    expect(input.inventory?.unreviewedCount).toBe(1);
    expect(searchResult?.scannedPaths).toBe(1);
  });

  it('Rust 입력 상한을 넘는 색인 청크는 배치로 나눠 계획하고 문서 수는 unique path로 집계한다', async () => {
    const records = [
      {
        filePath: 'Synthetic/A.md',
        contentHash: 'a',
        sourceMtime: 1,
        sourceSize: 10,
        vectorCount: 2049,
        updated: 1,
      },
      {
        filePath: 'Synthetic/B.md',
        contentHash: 'b',
        sourceMtime: 1,
        sourceSize: 10,
        vectorCount: 2048,
        updated: 1,
      },
    ];
    const entries = Array.from({ length: 4097 }, (_, index) => ({
      id: 'chunk-' + index,
      vector: [],
      metadata: {
        filePath: index % 2 === 0 ? 'Synthetic/A.md' : 'Synthetic/B.md',
        startLine: index + 1,
        endLine: index + 1,
        text: 'Quartz cooling cycles ' + index,
        contentHash: index % 2 === 0 ? 'a' : 'b',
      },
    }));
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: () => Promise.resolve(entries),
      getFileIndexRecords: () => Promise.resolve(records),
    };
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: ['Synthetic/A.md', 'Synthetic/B.md'],
      scopes: [],
      corpus,
    });
    const calls = vi.mocked(planIndexedEvidenceRust).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every(([input]) => input.documents.length <= 4096)).toBe(true);
    expect(result?.scannedDocuments).toBe(2);
    expect(result?.scannedPaths).toBe(2);
    expect(result?.plan.diagnostics.candidateDocuments).toBeLessThanOrEqual(2);
    expect(result?.plan.diagnostics.selectedDocuments).toBeLessThanOrEqual(2);
  });

  it('배치 내 문서 순서가 달라도 엔진 전역 병합 순위·표시가 같다', async () => {
    const paths = Array.from(
      { length: 257 },
      (_, index) => `Synthetic/File-${String(index + 1).padStart(3, '0')}.md`,
    );
    const scoreOf = new Map(paths.map((path, index) => [path, index + 1]));
    const records = paths.map((filePath) => ({
      filePath,
      contentHash: `hash-${filePath}`,
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    }));
    const entries = paths.map((filePath) => ({
      id: `entry-${filePath}`,
      vector: [],
      metadata: {
        filePath,
        heading: 'Synthetic Section',
        startLine: 1,
        endLine: 1,
        text: `Quartz cooling cycles ${filePath}`,
        sourceMtime: 1,
        contentHash: `hash-${filePath}`,
      },
    }));
    vi.mocked(planIndexedEvidenceRust).mockClear();
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) =>
      planOfRows(
        input.documents,
        input.documents.map((document) =>
          rowFor(
            document.path,
            scoreOf.get(document.path) ?? 0,
            `Quartz cooling cycles ${document.path}`,
          ),
        ),
      ),
    );
    const collect = async (entryOrder: readonly string[]) => {
      const corpus: IndexedVaultCorpus = {
        getEntriesByFilePaths: (requested) =>
          Promise.resolve(
            entryOrder.flatMap((path) =>
              requested.includes(path)
                ? entries.filter((entry) => entry.metadata.filePath === path)
                : [],
            ),
          ),
        getFileIndexRecords: () => Promise.resolve(records),
      };
      return searchIndexedVault({
        question: 'Quartz cooling cycles',
        indexedPaths: paths,
        scopes: [],
        corpus,
        inventory: { indexedCount: paths.length, unreviewedCount: 0, notIndexedCount: 0 },
      });
    };
    const forward = await collect(paths);
    const reversed = await collect([...paths].reverse());
    const forwardIds = forward?.evidence.map((item) => item.sourceId) ?? [];
    // 전역 상위 24개만 엔진이 고르며 배치 순서는 결과에 남지 않습니다.
    expect(forwardIds).toHaveLength(24);
    expect(forwardIds).toEqual(reversed?.evidence.map((item) => item.sourceId) ?? []);
    expect(forwardIds[0]).toBe(`${paths.at(-1)}#L1-L1`);
    expect(forward?.evidence.map((item) => item.rank)).toEqual(
      forwardIds.map((_, index) => index + 1),
    );
    expect(forward?.plan.diagnostics.selectedChunks).toBe(24);
    expect(forward?.plan.diagnostics.selectedDocuments).toBe(24);
    expect(forward?.plan.diagnostics.truncated).toBe(true);
    expect(forward?.plan.diagnostics.droppedDocuments.budget).toBe(233);
    expect(forward?.coverage.status).toBe('budget-exhausted');
    expect(forward?.coverage).toEqual(reversed?.coverage);
    expect(forward?.rejected.filter((item) => item.status === 'unreviewed')).toHaveLength(233);
    expect(reversed?.rejected.filter((item) => item.status === 'unreviewed')).toHaveLength(233);
    expect(forward?.rejected.every((item) => item.status !== 'out-of-scope')).toBe(true);
    // path 배치가 나뉘어도 코퍼스 메타데이터가 plan 입력 문서마다 유지됩니다.
    const documents = vi
      .mocked(planIndexedEvidenceRust)
      .mock.calls.flatMap(([input]) => [...input.documents]);
    expect(documents).toHaveLength(paths.length * 2);
    // ms epoch mtime은 u64 타임스탬프 계약으로 문서마다 엔진에 전달됩니다.
    expect(documents.every((document) => document.modifiedAt === 1)).toBe(true);
    expect(
      documents.every((document) => {
        if (!('headings' in document)) return false;
        const headings: unknown = document.headings;
        return (
          Array.isArray(headings) && headings.length === 1 && headings[0] === 'Synthetic Section'
        );
      }),
    ).toBe(true);
  });

  it('전역 문자 예산으로 제외된 근거는 out-of-scope가 아니라 미검토·예산 소진으로 남는다', async () => {
    const { corpus } = fixtureCorpus();
    const quotes = new Map([
      [RELEVANT, 'Quartz cooling cycles alpha'],
      [OTHER, 'Quartz cooling cycles beta'],
    ]);
    vi.mocked(planIndexedEvidenceRust).mockImplementation((input) =>
      planOfRows(
        input.documents,
        input.documents.map((document) =>
          rowFor(
            document.path,
            document.path === RELEVANT ? 10 : 5,
            quotes.get(document.path) ?? '',
          ),
        ),
      ),
    );
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT, OTHER],
      scopes: [],
      corpus,
      budget: { maxChars: 30 },
    });
    expect(result?.evidence.map((item) => item.path)).toEqual([RELEVANT]);
    expect(result?.plan.diagnostics.truncated).toBe(true);
    expect(result?.plan.diagnostics.droppedDocuments.budget).toBe(1);
    expect(result?.plan.budget).toEqual({
      maxDocuments: 64,
      maxPassages: 24,
      maxChars: 30,
      usedChars: 27,
    });
    expect(result?.coverage.status).toBe('budget-exhausted');
    expect(
      result?.rejected.filter((item) => item.status === 'unreviewed').map((item) => item.path),
    ).toEqual([OTHER]);
    expect(result?.rejected.every((item) => item.status !== 'out-of-scope')).toBe(true);
  });

  it('코퍼스 청크 헤딩을 plan 입력 필드로 전달한다', async () => {
    const sourceMtime = 1_700_000_000_000;
    const records = [
      {
        filePath: RELEVANT,
        contentHash: 'hash-relevant',
        sourceMtime,
        sourceSize: 10,
        vectorCount: 1,
        updated: 1,
      },
    ];
    const entries = [
      {
        id: 'chunk-relevant',
        vector: [],
        metadata: {
          filePath: RELEVANT,
          heading: 'Synthetic Section',
          startLine: 3,
          endLine: 4,
          text: 'Quartz restarts only after two cooling cycles.',
          sourceMtime,
          sourceSize: 10,
          contentHash: 'hash-relevant',
        },
      },
    ];
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: (paths) =>
        Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
      getFileIndexRecords: () => Promise.resolve(records),
    };
    const result = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus,
    });
    expect(result).not.toBeNull();
    const input = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0];
    expect(input?.documents).toHaveLength(1);
    expect(input?.documents[0]).toMatchObject({
      path: RELEVANT,
      revision: `${sourceMtime}:10`,
      indexed: true,
      reviewState: 'reviewed',
      text: 'Quartz restarts only after two cooling cycles.',
      startLine: 3,
      headings: ['Synthetic Section'],
    });
    // ms epoch mtime은 엔진 u64 타임스탬프 계약으로 문서에 전달됩니다.
    expect(input?.documents[0]?.modifiedAt).toBe(sourceMtime);
  });

  it('청크 헤딩이 실제 엔진 점수에 반영된다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    const sourceMtime = 1_700_000_000_000;
    const records = [
      {
        filePath: RELEVANT,
        contentHash: 'hash-relevant',
        sourceMtime,
        sourceSize: 10,
        vectorCount: 1,
        updated: 1,
      },
    ];
    const entry = (heading?: string) => ({
      id: 'chunk-relevant',
      vector: [],
      metadata: {
        filePath: RELEVANT,
        heading,
        startLine: 1,
        endLine: 1,
        text: 'Quartz restarts only after two cooling cycles.',
        sourceMtime,
        sourceSize: 10,
        contentHash: 'hash-relevant',
      },
    });
    const run = async (heading?: string) => {
      const corpus: IndexedVaultCorpus = {
        getEntriesByFilePaths: () => Promise.resolve([entry(heading)]),
        getFileIndexRecords: () => Promise.resolve(records),
      };
      return searchIndexedVault({
        question: 'Quartz cooling cycles',
        indexedPaths: [RELEVANT],
        scopes: [],
        corpus,
      });
    };
    const withHeading = await run('Quartz cooling cycles');
    const withoutHeading = await run();
    expect(withHeading?.evidence).toHaveLength(1);
    expect(withHeading?.evidence[0]?.score).toBeGreaterThan(
      withoutHeading?.evidence[0]?.score ?? Number.POSITIVE_INFINITY,
    );
  });

  it('코퍼스에 없는 메타데이터는 plan 입력에 키를 만들지 않는다', async () => {
    const { corpus } = fixtureCorpus();
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus,
    });
    const document = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0].documents[0];
    expect(document).toBeDefined();
    for (const key of ['modifiedAt', 'headings', 'title', 'tags', 'codeBlocks']) {
      expect(document !== undefined && key in document).toBe(false);
    }
  });

  it('색인 기록이 없는 경로는 엔진 입력에서 제외한다', async () => {
    const { corpus, requested } = fixtureCorpus();
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: ['Synthetic/Relevant.md', 'Synthetic/Unindexed.md'],
      scopes: [],
      corpus,
    });
    expect(requested).toEqual(['Synthetic/Relevant.md']);
  });
});
