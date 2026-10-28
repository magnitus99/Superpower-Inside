import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { QueryResult, RAGQueryEngine, RAGQueryOptions } from '../rag/query';
import { planIndexedEvidenceRust, type IndexedSearchPlan } from '../rag/rust-core';
import type { IndexedSearchCorpus } from './indexed-search-deps';
import {
  collectIndexedSearchSource,
  createVaultRevisionReader,
  createVaultSourceReader,
} from './indexed-search-deps';

vi.mock('obsidian', () => ({
  TFile: class TFile {},
}));

const planIndexedSearchQueries = vi.hoisted(() => vi.fn());
type QueryCall = (
  question: string,
  topK?: number,
  minScore?: number,
  prefixes?: readonly string[],
  options?: RAGQueryOptions,
) => Promise<QueryResult[]>;

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return { ...actual, planIndexedSearchQueriesRust: planIndexedSearchQueries };
});

beforeEach(() => {
  planIndexedSearchQueries.mockReset();
  planIndexedSearchQueries.mockReturnValue(null);
});

function corpus(): IndexedSearchCorpus {
  return {
    getEntriesByFilePaths: () => Promise.resolve([]),
    getFileIndexRecords: () => Promise.resolve([]),
    getIndexedFilePaths: () => Promise.resolve(['Synthetic/Alpha.md', 'Synthetic/Beta.md']),
  };
}

function singlePlan(query: string): IndexedSearchPlan {
  return {
    mode: 'single',
    facets: [{ id: 'question', kind: 'question', query, queryIndex: 0, terms: [] }],
  };
}

function app(stats: Record<string, { mtime: number; size: number }>): App {
  return {
    vault: {
      adapter: {
        stat: (path: string) => Promise.resolve(stats[path] ?? null),
      },
    },
  } as unknown as App;
}

function sourceFile(path: string, mtime: number, size: number): TFile {
  const name = path.split('/').at(-1) ?? path;
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    path,
    name,
    basename: name.replace(/\.md$/u, ''),
    extension: 'md',
    stat: { ctime: 1, mtime, size },
  });
}

function sourceApp(file: TFile | null, text: string): App {
  return {
    vault: {
      getAbstractFileByPath: () => file,
      cachedRead: () => Promise.resolve(text),
      adapter: {
        stat: () => Promise.resolve(file ? { mtime: file.stat.mtime, size: file.stat.size } : null),
      },
    },
  } as unknown as App;
}

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    entry: {
      id: 'entry-1',
      vector: [],
      metadata: {
        filePath: 'Synthetic/Alpha.md',
        startLine: 4,
        endLine: 6,
        text: '합성 본문',
      },
    },
    score: 3,
    vectorScore: 0.8,
    bm25Score: 2.4,
    combinedScore: 3.2,
    sourcePath: 'Synthetic/Alpha.md',
    chunkRange: { startLine: 4, endLine: 6 },
    keywordMatches: 2,
    ...overrides,
  };
}

function engine(results: QueryResult[]): RAGQueryEngine {
  return {
    queryBm25Exhaustive: () => Promise.resolve([]),
    query: (
      question: string,
      topK?: number,
      minScore?: number,
      prefixes?: unknown,
      options?: unknown,
    ) => {
      void question;
      void topK;
      void minScore;
      void prefixes;
      void options;
      return Promise.resolve(results);
    },
  } as unknown as RAGQueryEngine;
}

describe('검색 의존성 factory', () => {
  it('긴 질문은 핵심 term 의미 질의로 교차언어 문서를 추가 발견한다', async () => {
    const question = '네빌 고다드가 말하는 지혜는 서로 무엇이 다르고 같은지 개념적으로 설명해줘.';
    planIndexedSearchQueries.mockReturnValue({
      mode: 'single',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: question,
          queryIndex: 0,
          terms: ['네빌', '고다드', '말하', '지혜', '서로', '무엇', '다르고', '같은지', '개념적', '설명해줘'],
        },
      ],
    } satisfies IndexedSearchPlan);
    const query = vi.fn((text: string) =>
      Promise.resolve(
        text === '네빌 고다드 지혜'
          ? [
              queryResult({
                sourcePath: 'neville/In Praise of Wisdom.txt',
                entry: {
                  id: 'praise',
                  vector: [],
                  metadata: {
                    filePath: 'neville/In Praise of Wisdom.txt',
                    startLine: 1,
                    endLine: 3,
                    text: 'synthetic',
                  },
                },
              }),
            ]
          : [],
      ),
    );
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query,
          queryBm25Exhaustive: () => Promise.resolve([]),
        } as unknown as RAGQueryEngine,
        documentCorpus: {
          ...corpus(),
          getIndexedFilePaths: () =>
            Promise.resolve([
              'Synthetic/Alpha.md',
              'Synthetic/Beta.md',
              'neville/In Praise of Wisdom.txt',
            ]),
        },
      },
      question,
    );

    expect(query.mock.calls.map(([text]) => text)).toEqual([question, '네빌 고다드 지혜']);
    expect(source?.candidates?.some((item) => item.path === 'neville/In Praise of Wisdom.txt')).toBe(
      true,
    );
  });

  it.each(['empty', 'unavailable'] as const)(
    '원래 질의 후보가 %s여도 언어 변형으로 발견한 경로와 원문 평가 힌트를 보존한다',
    async (outcome) => {
      planIndexedSearchQueries.mockImplementation(({ question }: { question: string }) =>
        singlePlan(question),
      );
      const loadQueryVariants = vi.fn(() => Promise.resolve(['lunar archive']));
      const queryBm25Exhaustive = vi.fn((query: string) =>
        Promise.resolve(
          query === 'lunar archive'
            ? [{ path: 'Synthetic/Beta.md', score: 2, rank: 1 }]
            : outcome === 'unavailable'
              ? null
              : [],
        ),
      );
      const source = await collectIndexedSearchSource(
        {
          app: app({}),
          documentCorpus: corpus(),
          ragEngine: {
            query: () => Promise.resolve([]),
            queryBm25Exhaustive,
            getCandidateReadiness: () => 'ready' as const,
          } as unknown as RAGQueryEngine,
        },
        '달 기록을 설명해줘',
        undefined,
        undefined,
        true,
        undefined,
        loadQueryVariants,
      );

      expect(loadQueryVariants).toHaveBeenCalledOnce();
      expect(queryBm25Exhaustive).toHaveBeenCalledWith('lunar archive', undefined, undefined);
      expect(source?.queryVariants).toEqual(['lunar archive']);
      expect(source?.candidates).toContainEqual({
        path: 'Synthetic/Beta.md',
        score: 2,
        source: 'bm25',
        rank: 1,
        queryIndex: 0,
      });
      expect(source?.exhaustiveReview).toBe(false);
      expect(source?.reviewPaths).toBeUndefined();
      expect(await source?.getIndexedPaths()).toEqual(['Synthetic/Alpha.md', 'Synthetic/Beta.md']);
    },
  );

  it('후보 엔진이 없으면 언어 변형으로 실패를 우회하지 않는다', async () => {
    planIndexedSearchQueries.mockImplementation(({ question }: { question: string }) =>
      singlePlan(question),
    );
    const loadQueryVariants = vi.fn(() => Promise.resolve(['lunar archive']));
    const source = await collectIndexedSearchSource(
      { app: app({}), documentCorpus: corpus(), ragEngine: null },
      '달 기록을 설명해줘',
      undefined,
      undefined,
      true,
      undefined,
      loadQueryVariants,
    );
    expect(loadQueryVariants).not.toHaveBeenCalled();
    expect(source?.queryVariants).toBeUndefined();
    expect(source?.candidates).toBeUndefined();
    expect(source?.candidatesState).toBe('initializing');
    expect(source?.exhaustiveReview).toBe(false);
    expect(source?.reviewPaths).toBeUndefined();
  });

  it.each(['indexing', 'empty-index'] as const)(
    '%s 상태에서는 언어 변형을 요청하지 않는다',
    async (status) => {
      planIndexedSearchQueries.mockReturnValue(singlePlan('synthetic'));
      const loadQueryVariants = vi.fn(() => Promise.resolve(['lunar archive']));
      await collectIndexedSearchSource(
        {
          app: app({}),
          ragEngine: null,
          documentCorpus: {
            ...corpus(),
            getIndexedFilePaths: () =>
              Promise.resolve(status === 'empty-index' ? [] : ['Synthetic/Alpha.md']),
          },
          isIndexing: () => status === 'indexing',
        },
        'synthetic',
        undefined,
        undefined,
        true,
        undefined,
        loadQueryVariants,
      );
      expect(loadQueryVariants).not.toHaveBeenCalled();
    },
  );

  it('언어 변형 요청 중 취소되면 후보를 수집하거나 결과를 반환하지 않는다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('synthetic'));
    const controller = new AbortController();
    const reason = new Error('synthetic cancellation');
    const queryBm25Exhaustive = vi.fn(() => Promise.resolve([]));
    const source = collectIndexedSearchSource(
      {
        app: app({}),
        documentCorpus: corpus(),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive,
        } as unknown as RAGQueryEngine,
      },
      'synthetic',
      controller.signal,
      undefined,
      true,
      undefined,
      () => {
        controller.abort(reason);
        return Promise.resolve(['lunar archive']);
      },
    );
    await expect(source).rejects.toBe(reason);
    expect(queryBm25Exhaustive).toHaveBeenCalledOnce();
  });

  it.each(['single', 'comparison'] as const)(
    '%s 질의의 언어 변형은 비교 facet을 만들지 않고 엔진 wire 계약을 유지한다',
    async (mode) => {
      const basePlan: IndexedSearchPlan = {
        mode,
        facets: [
          { id: 'question', kind: 'question', query: 'base', queryIndex: 0, terms: [] },
          ...(mode === 'comparison'
            ? [{ id: 'subject-1', kind: 'subject' as const, query: 'subject', queryIndex: 1, terms: [] }]
            : []),
        ],
      };
      planIndexedSearchQueries.mockImplementation(({ question }: { question: string }) =>
        question === 'base' ? basePlan : {
          mode: 'comparison',
          facets: [
            ...singlePlan(question).facets,
            { id: 'subject-1', kind: 'subject', query: question, queryIndex: 1, terms: [] },
          ],
        },
      );
      const variants = ['variant-a', 'variant-b', 'variant-c'];
      const paths = ['base', 'subject', ...variants].map((name) => `Synthetic/${name}.md`);
      const source = await collectIndexedSearchSource(
        {
          app: app({}),
          documentCorpus: { ...corpus(), getIndexedFilePaths: () => Promise.resolve(paths) },
          ragEngine: {
            query: () => Promise.resolve([]),
            queryBm25Exhaustive: (query: string) => Promise.resolve([
              { path: `Synthetic/${query}.md`, startLine: 1, endLine: 1, score: 1, rank: 1 },
            ]),
          } as unknown as RAGQueryEngine,
        },
        'base',
        undefined,
        'base',
        true,
        8_000,
        () => Promise.resolve(variants),
      );
      const candidates = source?.candidates ?? [];
      expect(source?.queryVariants).toEqual(variants);
      expect(candidates.filter((candidate) => candidate.path.includes('variant-'))).toHaveLength(3);
      expect(candidates.filter((candidate) => candidate.path.includes('variant-'))
        .every((candidate) => candidate.queryIndex === 0)).toBe(true);
      if (mode === 'comparison') {
        expect(candidates.find((candidate) => candidate.path === 'Synthetic/subject.md')?.queryIndex)
          .toBe(1);
      }
      expect(source?.searchPlan?.facets).toEqual(basePlan.facets);
      const plan = planIndexedEvidenceRust({
        question: 'base',
        candidates,
        documents: paths.map((path) => ({
          path, text: 'base subject supporting text', revision: '1:1', indexed: true,
          reviewState: 'reviewed', startLine: 1,
        })),
      });
      expect(plan).not.toBeNull();
      expect(plan?.evidence.length).toBeGreaterThan(0);
      expect(plan?.evidence.every((item) => (item.queryIndexes ?? []).every((index) => index <= 1)))
        .toBe(true);
      expect(plan?.evidence.filter((item) => item.path.includes('variant-'))
        .every((item) => (item.queryIndexes ?? []).every((index) => index === 0))).toBe(true);
    },
  );
  it('16개를 넘는 facet term도 batch 한도 안에서 한 번에 집계한다', async () => {
    const terms = Array.from({ length: 20 }, (_, index) => `term${index}`);
    planIndexedSearchQueries.mockReturnValue({
      mode: 'single',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: 'alpha query',
          queryIndex: 0,
          terms,
        },
      ],
    } satisfies IndexedSearchPlan);
    const queryBm25Batch = vi.fn(() =>
      Promise.resolve({
        matches: [[{ path: 'Synthetic/Alpha.md', score: 1, rank: 1 }]],
        inventories: terms.map((term) => ({
          totalDocuments: 1,
          totalChunks: 1,
          totalOccurrences: 1,
          documents: [
            {
              sourcePath: 'Synthetic/Alpha.md',
              occurrences: 1,
              chunks: [{ docId: term, occurrences: 1 }],
            },
          ],
        })),
      }),
    );
    const queryMatchInventory = vi.fn();
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive: () => Promise.resolve([]),
          queryBm25Batch,
          queryMatchInventory,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(queryBm25Batch).toHaveBeenCalledOnce();
    expect(queryMatchInventory).not.toHaveBeenCalled();
    expect(source?.matchInventory).toHaveLength(20);
  });

  it('batch가 null이면 facet별 검색과 term 집계 경로로 되돌아간다', async () => {
    planIndexedSearchQueries.mockReturnValue({
      mode: 'single',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: 'alpha query',
          queryIndex: 0,
          terms: ['alpha'],
        },
      ],
    } satisfies IndexedSearchPlan);
    const queryBm25Batch = vi.fn(() => Promise.resolve(null));
    const queryBm25Exhaustive = vi.fn(() =>
      Promise.resolve([{ path: 'Synthetic/Alpha.md', score: 1, rank: 1 }]),
    );
    const queryMatchInventory = vi.fn(() =>
      Promise.resolve({
        totalDocuments: 1,
        totalChunks: 1,
        totalOccurrences: 1,
        documents: [
          {
            sourcePath: 'Synthetic/Alpha.md',
            occurrences: 1,
            chunks: [{ docId: 'alpha', occurrences: 1 }],
          },
        ],
      }),
    );
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Batch,
          queryBm25Exhaustive,
          queryMatchInventory,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(queryBm25Batch).toHaveBeenCalledOnce();
    expect(queryBm25Exhaustive).toHaveBeenCalledOnce();
    expect(queryMatchInventory).toHaveBeenCalledOnce();
    expect(source?.candidates?.some((item) => item.path === 'Synthetic/Alpha.md')).toBe(true);
    expect(source?.matchInventory?.[0]?.query).toBe('alpha');
  });

  it('facet 검색과 term 집계를 한 batch 호출로 공유한다', async () => {
    planIndexedSearchQueries.mockReturnValue({
      mode: 'comparison',
      facets: [
        { id: 'subject-0', kind: 'subject', query: 'alpha query', queryIndex: 1, terms: ['alpha', 'beta'] },
        { id: 'subject-1', kind: 'subject', query: 'gamma query', queryIndex: 2, terms: ['gamma'] },
      ],
    } satisfies IndexedSearchPlan);
    const aggregate = (term: string) => ({
      totalDocuments: 1,
      totalChunks: 1,
      totalOccurrences: term === 'alpha' ? 2 : 1,
      documents: [
        {
          sourcePath: `Synthetic/${term}.md`,
          occurrences: 1,
          chunks: [{ docId: term, occurrences: 1 }],
        },
      ],
    });
    const queryBm25Batch = vi.fn(() =>
      Promise.resolve({
        matches: [
          [{ path: 'Synthetic/Alpha.md', score: 2, rank: 1 }],
          [{ path: 'Synthetic/Beta.md', score: 1, rank: 1 }],
        ],
        inventories: [aggregate('alpha'), aggregate('beta'), aggregate('gamma')],
      }),
    );
    const queryBm25Exhaustive = vi.fn(() => Promise.resolve([]));
    const queryMatchInventory = vi.fn();
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive,
          queryBm25Batch,
          queryMatchInventory,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(queryBm25Batch).toHaveBeenCalledOnce();
    expect(queryBm25Batch).toHaveBeenCalledWith(
      [{ query: 'alpha query' }, { query: 'gamma query' }],
      [
        { query: 'alpha', limit: 2 },
        { query: 'beta', limit: 2 },
        { query: 'gamma', limit: 2 },
      ],
      ['Synthetic/Alpha.md', 'Synthetic/Beta.md'],
      undefined,
    );
    expect(queryBm25Exhaustive).not.toHaveBeenCalled();
    expect(queryMatchInventory).not.toHaveBeenCalled();
    expect(source?.matchInventory?.map((item) => item.query)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(source?.candidates?.map((item) => item.path)).toEqual([
      'Synthetic/Alpha.md',
      'Synthetic/Beta.md',
    ]);
  });

  it('facet 핵심어별 색인 전체 일치 집계를 중복·상한 없이 모은다', async () => {
    planIndexedSearchQueries.mockReturnValue({
      mode: 'single',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: '합성 질의',
          queryIndex: 0,
          terms: ['alpha', 'beta', 'alpha'],
        },
        {
          id: 'subject-1',
          kind: 'subject',
          query: '합성 주제',
          queryIndex: 1,
          terms: ['gamma', 'delta'],
        },
      ],
    } satisfies IndexedSearchPlan);
    const queryMatchInventory = vi.fn((term: string) =>
      Promise.resolve({
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: term === 'alpha' ? 7 : 1,
        documents: [
          { sourcePath: `Synthetic/${term}.md`, occurrences: 5, chunks: [{ docId: 'chunk', occurrences: 5 }] },
        ],
      }),
    );

    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive: () => Promise.resolve([]),
          queryMatchInventory,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(queryMatchInventory.mock.calls.map(([term]) => term)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
    ]);
    expect(source?.matchInventory).toEqual([
      {
        query: 'alpha',
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: 7,
        documents: [{ sourcePath: 'Synthetic/alpha.md', occurrences: 5 }],
      },
      {
        query: 'beta',
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: 1,
        documents: [{ sourcePath: 'Synthetic/beta.md', occurrences: 5 }],
      },
      {
        query: 'gamma',
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: 1,
        documents: [{ sourcePath: 'Synthetic/gamma.md', occurrences: 5 }],
      },
      {
        query: 'delta',
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: 1,
        documents: [{ sourcePath: 'Synthetic/delta.md', occurrences: 5 }],
      },
    ]);
  });

  it('색인 경로·후보 신호·리비전 reader를 한 번에 모은다', async () => {
    const plan = singlePlan('합성 질의');
    planIndexedSearchQueries.mockReturnValue(plan);
    const host = {
      app: app({ 'Synthetic/Alpha.md': { mtime: 10, size: 20 } }),
      ragEngine: engine([
        queryResult({ retrievalSources: ['bm25', 'vector'] }),
        queryResult({
          sourcePath: 'Synthetic/Beta.md',
          entry: {
            id: 'entry-2',
            vector: [],
            metadata: {
              filePath: 'Synthetic/Beta.md',
              startLine: 9,
              endLine: 9,
              text: '합성 본문 2',
            },
          },
          combinedScore: 1.2,
        }),
      ]),
      documentCorpus: corpus(),
      getCandidatePaths: () =>
        Promise.resolve(['Synthetic/Alpha.md', 'Synthetic/Beta.md', 'Synthetic/Missing.md']),
    };

    const source = await collectIndexedSearchSource(host, '합성 질의');
    expect(source).not.toBeNull();
    expect(source?.inventory).toEqual({
      indexedCount: 2,
      unreviewedCount: 0,
      notIndexedCount: 1,
    });
    expect(await source?.getIndexedPaths()).toEqual(['Synthetic/Alpha.md', 'Synthetic/Beta.md']);
    expect(source?.searchPlan).toEqual({ ...plan, failedFacetIds: [] });
    expect(source?.candidates).toEqual([
      {
        path: 'Synthetic/Alpha.md',
        startLine: 4,
        endLine: 6,
        score: 3.2,
        source: 'vector',
        rank: 1,
      },
      {
        path: 'Synthetic/Beta.md',
        startLine: 9,
        endLine: 9,
        score: 1.2,
        source: 'bm25',
        rank: 2,
      },
    ]);
    expect(source?.sourceReader).toBeTypeOf('function');
    if (!source?.sourceReader) throw new Error('source reader missing');
    await expect(source.sourceReader('Synthetic/Alpha.md')).resolves.toEqual({
      revision: null,
      text: null,
    });
    await expect(source?.revisionReader?.('Synthetic/Alpha.md')).resolves.toBe('10:20');
    await expect(source?.revisionReader?.('Synthetic/Missing.md')).resolves.toBeNull();
  });

  it('100개 BM25 hit와 semantic top-k를 합집합 review 경로로 보존한다', async () => {
    const indexedPaths = Array.from(
      { length: 101 },
      (_, index) => `Synthetic/Doc-${String(index).padStart(3, '0')}.md`,
    );
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const bm25Matches = indexedPaths.slice(1).map((path, index) => ({
      path,
      score: 100 - index,
      rank: index + 1,
    }));
    const semantic = indexedPaths.slice(0, 2).map((path, index) =>
      queryResult({
        sourcePath: path,
        retrievalSources: ['vector'],
        entry: {
          id: `semantic-${index}`,
          vector: [],
          metadata: {
            filePath: path,
            startLine: 0,
            endLine: 0,
            text: '합성 semantic 본문',
          },
        },
        combinedScore: 2 - index / 10,
      }),
    );
    const query = vi.fn<QueryCall>(() => Promise.resolve(semantic));
    const queryBm25Exhaustive = vi.fn(() => Promise.resolve(bm25Matches));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: { query, queryBm25Exhaustive } as unknown as RAGQueryEngine,
        documentCorpus: {
          ...corpus(),
          getIndexedFilePaths: () => Promise.resolve(indexedPaths),
        },
      },
      '합성 질의',
    );

    const call = query.mock.calls[0];
    expect(call?.slice(0, 4)).toEqual(['합성 질의', 256, undefined, undefined]);
    expect(call?.[4]?.excludedProviderIds).toEqual(['bm25']);
    expect(call?.[4]?.signal).toBeInstanceOf(AbortSignal);
    await expect(source?.getIndexedPaths()).resolves.toEqual(indexedPaths);
    expect(source?.exhaustiveReview).toBe(true);
    expect(source?.discoveryCandidates?.some(
      (candidate) => candidate.path === indexedPaths[100] && candidate.source === 'bm25',
    )).toBe(true);
    expect(queryBm25Exhaustive).toHaveBeenCalledWith('합성 질의', undefined, undefined);
    expect(source?.reviewPaths).toHaveLength(96);
    expect(source?.reviewPaths).toContain(indexedPaths[0]);
    expect(new Set(source?.candidates?.map((candidate) => candidate.path)).size).toBe(96);
    expect(source?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: indexedPaths[0], source: 'vector' }),
        expect.objectContaining({ path: indexedPaths[1], source: 'bm25' }),
      ]),
    );
  });

  it('200개 혼합 소스 후보에서 96개 경로와 소스별 8개 슬롯을 보존한다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const bm25 = Array.from({ length: 104 }, (_, index) => ({
      path: `Synthetic/Bm25-${String(index).padStart(3, '0')}.md`,
      score: 200 - index,
      rank: 1,
    }));
    const semantic = (['vector', 'ann', 'structural'] as const).flatMap((source) =>
      Array.from({ length: 32 }, (_, index) =>
        queryResult({
          sourcePath: `Synthetic/${source}-${index}.md`,
          retrievalSources: [source],
        }),
      ),
    );
    const indexedPaths = [...bm25.map(({ path }) => path), ...semantic.map((r) => r.sourcePath)];
    const queryBm25Exhaustive = vi.fn(() => Promise.resolve(bm25));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve(semantic),
          queryBm25Exhaustive,
        } as unknown as RAGQueryEngine,
        documentCorpus: { ...corpus(), getIndexedFilePaths: () => Promise.resolve(indexedPaths) },
      },
      '합성 질의',
    );

    expect(bm25.length + semantic.length).toBe(200);
    expect(queryBm25Exhaustive).toHaveBeenCalledWith('합성 질의', undefined, undefined);
    expect(source?.reviewPaths).toHaveLength(96);
    expect(new Set(source?.reviewPaths).size).toBe(96);
    for (const candidateSource of ['bm25', 'vector', 'ann', 'structural']) {
      expect(
        source?.candidates?.filter(({ source }) => source === candidateSource).length,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it('예약 슬롯에서도 facet을 교차 선택하고 소스 간 중복 경로를 한 번만 센다', async () => {
    const plan: IndexedSearchPlan = {
      mode: 'comparison',
      facets: Array.from({ length: 3 }, (_, queryIndex) => ({
        id: `facet-${queryIndex}`,
        kind: queryIndex === 0 ? ('question' as const) : ('subject' as const),
        query: `facet-${queryIndex}`,
        queryIndex,
        terms: [],
      })),
    };
    planIndexedSearchQueries.mockReturnValue(plan);
    const paths = plan.facets.map(({ id }) =>
      Array.from({ length: 100 }, (_, index) => `Synthetic/${id}-${index}.md`),
    );
    const sharedPath = 'Synthetic/Shared.md';
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () =>
            Promise.resolve([
              queryResult({ sourcePath: sharedPath, retrievalSources: ['vector'] }),
              queryResult({
                sourcePath: sharedPath,
                retrievalSources: ['bm25', 'vector', 'ann', 'structural'],
              }),
            ]),
          queryBm25Exhaustive: (query: string) =>
            Promise.resolve([
              { path: sharedPath, rank: 1, score: 100 },
              ...(paths[plan.facets.findIndex((facet) => facet.query === query)] ?? []).map(
                (path, index) => ({ path, rank: index + 2, score: 99 - index }),
              ),
            ]),
        } as unknown as RAGQueryEngine,
        documentCorpus: {
          ...corpus(),
          getIndexedFilePaths: () => Promise.resolve([sharedPath, ...paths.flat()]),
        },
      },
      '합성 비교 질의',
    );

    expect(source?.reviewPaths).toHaveLength(96);
    expect(new Set(source?.reviewPaths).size).toBe(96);
    expect(source?.reviewPaths?.filter((path) => path === sharedPath)).toHaveLength(1);
    expect(source?.candidates?.filter(({ source }) => source === 'structural')).toHaveLength(3);
    for (const facetPaths of paths) {
      expect(
        source?.reviewPaths?.filter((path) => facetPaths.includes(path)).length,
      ).toBeGreaterThanOrEqual(31);
    }
  });

  it.each(['failure', 'empty'] as const)(
    'BM25 0건과 semantic %s는 전체 lexical 검토로 폴백한다',
    async (semanticOutcome) => {
      planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
      const source = await collectIndexedSearchSource(
        {
          app: app({}),
          ragEngine: {
            query: () =>
              semanticOutcome === 'failure'
                ? Promise.reject(new Error('synthetic semantic failure'))
                : Promise.resolve([]),
            queryBm25Exhaustive: () => Promise.resolve([]),
            getCandidateReadiness: () => 'ready' as const,
          } as unknown as RAGQueryEngine,
          documentCorpus: corpus(),
        },
        '합성 질의',
      );

      expect(source?.exhaustiveReview).toBe(false);
      expect(source?.reviewPaths).toBeUndefined();
      expect(source?.candidates).toBeUndefined();
      await expect(source?.getIndexedPaths()).resolves.toHaveLength(2);
      expect(source?.searchPlan?.failedFacetIds).toEqual([]);
    },
  );

  it.each(['error', 'timeout'] as const)(
    'semantic %s 사유를 source 진단에 보존한다',
    async (status) => {
      vi.useFakeTimers();
      try {
        planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
        const pending = collectIndexedSearchSource(
          {
            app: app({}),
            ragEngine: {
              query: () =>
                status === 'error'
                  ? Promise.reject(new Error('synthetic semantic failure'))
                  : new Promise<QueryResult[]>(() => {}),
              queryBm25Exhaustive: () => Promise.resolve([]),
            } as unknown as RAGQueryEngine,
            documentCorpus: corpus(),
          },
          '합성 질의',
        );
        await vi.advanceTimersByTimeAsync(20_000);
        const source = await pending;

        expect(source?.exhaustiveReview).toBe(false);
        expect(source?.reviewPaths).toBeUndefined();
        expect(source?.diagnostics).toEqual([
          expect.objectContaining({
            providerId: 'semantic:question',
            status,
            candidateCount: 0,
            error: status === 'error' ? 'synthetic semantic failure' : 'semantic-candidate-timeout',
          }),
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('semantic 실패는 exhaustive BM25 검토 범위를 축소하지 않는다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const queryBm25Exhaustive = vi.fn(() =>
      Promise.resolve([
        { path: 'Synthetic/Alpha.md', score: 3, rank: 1 },
        { path: 'Synthetic/Beta.md', score: 2, rank: 2 },
      ]),
    );
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.reject(new Error('synthetic semantic failure')),
          queryBm25Exhaustive,
          getCandidateReadiness: () => 'ready' as const,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(source?.exhaustiveReview).toBe(true);
    expect(source?.reviewPaths).toEqual(['Synthetic/Alpha.md', 'Synthetic/Beta.md']);
    expect(source?.candidatesState).toBe('ready');
    expect(source?.searchPlan).toEqual({
      ...singlePlan('합성 질의'),
      failedFacetIds: [],
    });
  });

  it('semantic 후보가 timeout되어도 exhaustive BM25 검토를 기다리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
      const query = vi.fn<QueryCall>(() => new Promise<QueryResult[]>(() => {}));
      const queryBm25Exhaustive = vi.fn(() =>
        Promise.resolve([{ path: 'Synthetic/Alpha.md', score: 3, rank: 1 }]),
      );
      const pending = collectIndexedSearchSource(
        {
          app: app({}),
          ragEngine: {
            query,
            queryBm25Exhaustive,
          } as unknown as RAGQueryEngine,
          documentCorpus: corpus(),
        },
        '합성 질의',
      );

      await vi.advanceTimersByTimeAsync(20_000);
      const source = await pending;

      expect(source?.exhaustiveReview).toBe(true);
      expect(source?.reviewPaths).toEqual(['Synthetic/Alpha.md']);
      expect(source?.candidates).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('candidate 수가 있어도 현재 접근 범위를 확인한 뒤 집계한다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const getCandidatePaths = vi.fn(() =>
      Promise.resolve(['Synthetic/Alpha.md', 'Synthetic/Beta.md', 'Synthetic/New.md']),
    );
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([]),
          queryBm25Exhaustive: () => Promise.resolve([]),
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
        getCandidatePaths,
        getCandidateCount: () => 5,
      },
      '합성 질의',
    );

    expect(getCandidatePaths).toHaveBeenCalledTimes(1);
    expect(source?.inventory).toEqual({
      indexedCount: 2,
      unreviewedCount: 0,
      notIndexedCount: 3,
    });
  });

  it('exhaustive BM25가 미가용이면 전체 indexedPaths fallback을 유지한다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const queryBm25Exhaustive = vi.fn(() => Promise.resolve(null));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.resolve([queryResult()]),
          queryBm25Exhaustive,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(queryBm25Exhaustive).toHaveBeenCalledWith('합성 질의', undefined, undefined);
    expect(source?.exhaustiveReview).toBe(false);
    expect(source?.reviewPaths).toBeUndefined();
    await expect(source?.getIndexedPaths()).resolves.toEqual([
      'Synthetic/Alpha.md',
      'Synthetic/Beta.md',
    ]);
  });

  it('comparison facet 후보를 queryIndex와 실패 facet 기록으로 보존한다', async () => {
    const plan = {
      mode: 'comparison',
      facets: [
        {
          id: 'question',
          kind: 'question',
          query: '계획된 점수 질의',
          queryIndex: 0,
          terms: ['합성', '점수'],
        },
        {
          id: 'subject-0',
          kind: 'subject',
          query: '합성 알파',
          queryIndex: 1,
          terms: ['합성', '알파'],
        },
        {
          id: 'subject-1',
          kind: 'subject',
          query: '합성 베타',
          queryIndex: 2,
          terms: ['합성', '베타'],
        },
      ],
    } satisfies IndexedSearchPlan;
    planIndexedSearchQueries.mockReturnValue(plan);
    const query = vi.fn<QueryCall>(
      (
        question: string,
        _topK?: number,
        _minScore?: number,
        _prefixes?: unknown,
        _options?: unknown,
      ): Promise<QueryResult[]> => {
        if (question === '계획된 점수 질의') return Promise.resolve([queryResult()]);
        if (question === '합성 알파') {
          return Promise.resolve([
            queryResult({
              sourcePath: 'Synthetic/Beta.md',
              entry: {
                id: 'entry-2',
                vector: [],
                metadata: {
                  filePath: 'Synthetic/Beta.md',
                  startLine: 9,
                  endLine: 9,
                  text: '합성 본문 2',
                },
              },
            }),
          ]);
        }
        return Promise.reject(new Error('synthetic facet failure'));
      },
    );
    const queryBm25Exhaustive = vi.fn((question: string) =>
      question === '합성 베타'
        ? Promise.reject(new Error('synthetic bm25 failure'))
        : Promise.resolve([]),
    );

    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: { query, queryBm25Exhaustive } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 점수 질의',
      undefined,
      '원래 합성 질문',
    );

    expect(planIndexedSearchQueries).toHaveBeenCalledWith({
      question: '원래 합성 질문',
      scoringQuestion: '합성 점수 질의',
      scopes: [],
    });
    expect(query).toHaveBeenCalledTimes(3);
    const expectedCalls = [
      { query: '계획된 점수 질의', limit: 256 },
      { query: '합성 알파', limit: 96 },
      { query: '합성 베타', limit: 96 },
    ] as const;
    for (const [index, expected] of expectedCalls.entries()) {
      const queryCall = query.mock.calls[index];
      expect(queryCall?.slice(0, 4)).toEqual([
        expected.query,
        expected.limit,
        undefined,
        undefined,
      ]);
      expect(queryCall?.[4]?.excludedProviderIds).toEqual(['bm25']);
      expect(queryCall?.[4]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(source?.candidates).toMatchObject([
      { path: 'Synthetic/Alpha.md', queryIndex: 0, rank: 1 },
      { path: 'Synthetic/Beta.md', queryIndex: 1, rank: 1 },
    ]);
    expect(source?.searchPlan).toEqual({ ...plan, failedFacetIds: ['subject-1'] });
  });

  it('planner 결과가 없으면 TS fallback 없이 unavailable', async () => {
    const query = vi.fn(() => Promise.resolve([queryResult({ retrievalSources: ['vector'] })]));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: { query } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 점수 질의',
      undefined,
      '원래 합성 질문',
    );

    expect(planIndexedSearchQueries).toHaveBeenCalledWith({
      question: '원래 합성 질문',
      scoringQuestion: '합성 점수 질의',
      scopes: [],
    });
    expect(query).not.toHaveBeenCalled();
    expect(source?.candidates).toBeUndefined();
    expect(source?.candidatesState).toBe('unavailable');
    expect(source?.searchPlan).toBeUndefined();
  });

  it('모든 facet query가 실패하면 기존 readiness 상태를 유지한다', async () => {
    const plan = {
      mode: 'comparison',
      facets: [
        { id: 'question', kind: 'question', query: '질의 0', queryIndex: 0, terms: [] },
        { id: 'subject-0', kind: 'subject', query: '질의 1', queryIndex: 1, terms: [] },
      ],
    } satisfies IndexedSearchPlan;
    planIndexedSearchQueries.mockReturnValue(plan);
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => Promise.reject(new Error('synthetic query failure')),
          getCandidateReadiness: () => 'initializing' as const,
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
    );

    expect(source?.candidates).toBeUndefined();
    expect(source?.candidatesState).toBe('initializing');
    expect(source?.searchPlan).toEqual({
      ...plan,
      failedFacetIds: ['question', 'subject-0'],
    });
  });

  it('facet query의 abort는 fallback 없이 즉시 전파한다', async () => {
    planIndexedSearchQueries.mockReturnValue({
      mode: 'single',
      facets: [{ id: 'question', kind: 'question', query: '합성 질의', queryIndex: 0, terms: [] }],
    } satisfies IndexedSearchPlan);
    const controller = new AbortController();
    const abortError = new Error('synthetic abort');
    const source = collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: {
          query: () => {
            controller.abort(abortError);
            return Promise.reject(abortError);
          },
        } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
      },
      '합성 질의',
      controller.signal,
    );

    await expect(source).rejects.toBe(abortError);
  });

  it('제한 범위 안 미색인은 보존하고 범위 밖 미색인은 집계하지 않는다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const source = await collectIndexedSearchSource({
      app: app({}), ragEngine: engine([]), documentCorpus: corpus(),
      getCandidatePaths: () => Promise.resolve([
        'Synthetic/Alpha.md', 'Synthetic/Beta.md', 'Synthetic/NotIndexed.md', 'Other/Hidden.md',
      ]),
      getCandidateCount: () => 4,
    }, '합성 질의', undefined, undefined, true, undefined, undefined, { scopes: ['Synthetic'] });
    expect(source?.inventory).toEqual({ indexedCount: 2, unreviewedCount: 0, notIndexedCount: 1 });
  });

  it('색인 저장소가 없으면 source를 만들지 않는다', async () => {
    const source = await collectIndexedSearchSource(
      { app: app({}), ragEngine: null, documentCorpus: null },
      '합성 질의',
    );
    expect(source).toBeNull();
  });

  it('후보 엔진이 초기화 중이면 source에 initializing 상태를 보존한다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const initializingEngine = {
      query: () => Promise.resolve([]),
      getCandidateReadiness: () => 'initializing' as const,
    } as unknown as RAGQueryEngine;

    const source = await collectIndexedSearchSource(
      { app: app({}), ragEngine: initializingEngine, documentCorpus: corpus() },
      '합성 질의',
    );

    expect(source?.candidates).toBeUndefined();
    expect(source?.candidatesState).toBe('initializing');
  });

  it('재색인 중에는 부분 색인 후보를 만들지 않고 indexing 상태를 보존한다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const query = vi.fn(() => Promise.resolve([]));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: { query } as unknown as RAGQueryEngine,
        documentCorpus: corpus(),
        isIndexing: () => true,
      },
      '합성 질의',
    );

    expect(source?.candidates).toBeUndefined();
    expect(source?.candidatesState).toBe('indexing');
    expect(query).not.toHaveBeenCalled();
  });

  it('색인 경로가 0개이고 재색인도 아니면 빈 검색을 ready로 가장하지 않는다', async () => {
    planIndexedSearchQueries.mockReturnValue(singlePlan('합성 질의'));
    const source = await collectIndexedSearchSource(
      {
        app: app({}),
        ragEngine: null,
        documentCorpus: {
          ...corpus(),
          getIndexedFilePaths: () => Promise.resolve([]),
        },
      },
      '합성 질의',
    );
    expect(source?.candidatesState).toBe('unavailable');
  });

  it('취소된 요청은 후보를 만들지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = await collectIndexedSearchSource(
      { app: app({}), ragEngine: null, documentCorpus: corpus() },
      '합성 질의',
      controller.signal,
    );
    expect(source).toBeNull();
  });

  it('리비전 reader는 vault stat의 mtime과 size를 합쳐 돌려준다', async () => {
    const reader = createVaultRevisionReader(
      app({ 'Synthetic/Alpha.md': { mtime: 1_700_000_000_000, size: 512 } }),
    );
    await expect(reader('Synthetic/Alpha.md')).resolves.toBe('1700000000000:512');
  });

  it('source reader는 실제 TFile의 현재 원문과 revision을 반환한다', async () => {
    const path = 'Synthetic/Alpha.md';
    const reader = createVaultSourceReader(sourceApp(sourceFile(path, 10, 20), '합성 현재 원문'));

    await expect(reader(path)).resolves.toMatchObject({
      revision: '10:20',
      text: '합성 현재 원문',
    });
    const missingReader = createVaultSourceReader(sourceApp(null, ''));
    await expect(missingReader('Synthetic/Missing.md')).resolves.toEqual({
      revision: null,
      text: null,
    });
  });

  it('source reader는 현재 원문을 색인 청크 설정으로 검증 구간에 담는다', async () => {
    const path = 'Synthetic/Alpha.md';
    const reader = createVaultSourceReader(
      sourceApp(sourceFile(path, 10, 20), '# Heading\nSynthetic body'),
      true,
      { chunkSize: 40, overlap: 0 },
    );

    const snapshot = await reader(path);

    expect(snapshot.chunks?.length).toBeGreaterThan(0);
    expect(snapshot.chunks?.[0]?.startLine).toBe(1);
    expect(snapshot.chunks?.[0]?.text).toContain('Synthetic body');
  });
});
