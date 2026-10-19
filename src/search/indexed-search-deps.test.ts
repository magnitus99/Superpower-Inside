import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import type { QueryResult, RAGQueryEngine } from '../rag/query';
import type { IndexedSearchCorpus } from './indexed-search-deps';
import { collectIndexedSearchSource, createVaultRevisionReader } from './indexed-search-deps';

function corpus(): IndexedSearchCorpus {
  return {
    getEntriesByFilePaths: () => Promise.resolve([]),
    getFileIndexRecords: () => Promise.resolve([]),
    getIndexedFilePaths: () => Promise.resolve(['Synthetic/Alpha.md', 'Synthetic/Beta.md']),
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
    query: (question: string, topK?: number, minScore?: number, prefixes?: unknown, options?: unknown) => {
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
    expect(await source?.getIndexedPaths()).toEqual([
      'Synthetic/Alpha.md',
      'Synthetic/Beta.md',
    ]);
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
    await expect(source?.revisionReader?.('Synthetic/Alpha.md')).resolves.toBe('10:20');
    await expect(source?.revisionReader?.('Synthetic/Missing.md')).resolves.toBeNull();
  });

  it('색인 저장소가 없으면 source를 만들지 않는다', async () => {
    const source = await collectIndexedSearchSource(
      { app: app({}), ragEngine: null, documentCorpus: null },
      '합성 질의',
    );
    expect(source).toBeNull();
  });

  it('후보 엔진이 초기화 중이면 source에 initializing 상태를 보존한다', async () => {
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
});
