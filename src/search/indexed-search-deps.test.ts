import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type { QueryResult, RAGQueryEngine } from '../rag/query';
import type { IndexedSearchPlan } from '../rag/rust-core';
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
  return Object.assign(
    Object.create(TFile.prototype) as TFile,
    {
      path,
      name,
      basename: name.replace(/\.md$/u, ''),
      extension: 'md',
      stat: { ctime: 1, mtime, size },
    },
  );
}

function sourceApp(file: TFile | null, text: string): App {
  return {
    vault: {
      getAbstractFileByPath: () => file,
      cachedRead: () => Promise.resolve(text),
      adapter: {
        stat: () =>
          Promise.resolve(file ? { mtime: file.stat.mtime, size: file.stat.size } : null),
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
        startLine: 5,
        endLine: 7,
        score: 3.2,
        source: 'vector',
        rank: 1,
      },
      {
        path: 'Synthetic/Beta.md',
        startLine: 10,
        endLine: 10,
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
    const query = vi.fn(
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
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]).toEqual([
      '계획된 점수 질의',
      64,
      undefined,
      undefined,
      { signal: undefined, fastCandidates: true },
    ]);
    expect(query.mock.calls[1]).toEqual([
      '합성 알파',
      32,
      undefined,
      undefined,
      { signal: undefined, fastCandidates: true },
    ]);
    expect(query.mock.calls[2]).toEqual([
      '합성 베타',
      32,
      undefined,
      undefined,
      { signal: undefined, fastCandidates: true },
    ]);
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
      facets: [
        { id: 'question', kind: 'question', query: '합성 질의', queryIndex: 0, terms: [] },
      ],
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

    await expect(reader(path)).resolves.toEqual({
      revision: '10:20',
      text: '합성 현재 원문',
    });
    const missingReader = createVaultSourceReader(sourceApp(null, ''));
    await expect(missingReader('Synthetic/Missing.md')).resolves.toEqual({
      revision: null,
      text: null,
    });
  });
});
