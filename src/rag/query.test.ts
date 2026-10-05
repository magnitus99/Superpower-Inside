import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter, TFile } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import { IndexedDbBM25Index } from './bm25';
import { RAGQueryEngine } from './query';
import { MemoryVectorStore, type VectorEntry } from './store';

const bm25DbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...bm25DbNames].map((name) => Dexie.delete(name)));
  bm25DbNames.clear();
});

describe('RAGQueryEngine', () => {
  it('구조 그래프 후보는 벡터 근거가 약하면 seed 벡터 후보를 앞지르지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('seed.md', [0.8, 0.6], 'seed text'),
      createEntry('linked.md', [0, 1], 'linked text'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      structuralGraphEnabled: true,
      structuralMetadataContext: createMetadataContext({
        resolvedLinks: {
          'seed.md': { 'linked.md': 1 },
        },
      }),
    });

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual([
      'seed.md',
      'linked.md',
    ]);
  });

  it('BM25 문서와 공통 원문의 revision이 다르면 이전 키워드 점수를 새 본문에 붙이지 않는다', async () => {
    const latest = createEntry('source.txt', [], '최신 원문');
    const sourceStore = new MemoryVectorStore();
    await sourceStore.add([latest]);
    const bm25 = await createBm25([]);
    bm25.addCorpusDocument({
      id: latest.id,
      sourcePath: latest.metadata.filePath,
      text: 'oldterm 이전 근거',
      sourceMtime: 1000,
      sourceSize: latest.metadata.sourceSize,
      contentHash: 'old',
    });
    const engine = new RAGQueryEngine(null, null, bm25, 1, 0, { corpusStore: sourceStore });
    expect(await engine.query('oldterm', 5, 0)).toEqual([]);
  });
  it('같은 청크 ID의 오래된 벡터를 제거해도 최신 BM25 근거는 병합에서 살아남는다', async () => {
    const latest = createEntry('source.txt', [], 'freshterm 최신 근거');
    const stale = {
      ...latest,
      vector: [1, 0],
      metadata: { ...latest.metadata, contentHash: 'old', text: '이전 근거' },
    };
    const vectors = new MemoryVectorStore();
    await vectors.add([stale]);
    const bm25 = await createBm25([]);
    bm25.addCorpusDocument({
      id: latest.id,
      sourcePath: latest.metadata.filePath,
      text: latest.metadata.text,
      startLine: 0,
      endLine: 0,
      sourceMtime: 1000,
      sourceSize: latest.metadata.sourceSize,
      contentHash: 'hash',
    });
    const sourceStore = new MemoryVectorStore();
    await sourceStore.add([latest]);
    const engine = new RAGQueryEngine(
      vectors,
      { embed: () => Promise.resolve([1, 0]), embedBatch: () => Promise.resolve([]) },
      bm25,
      0.3,
      0,
      { corpusStore: sourceStore },
    );
    const results = await engine.query('freshterm', 5, 0);
    expect(results[0]?.entry.metadata.text).toBe(latest.metadata.text);
    expect(results[0]?.retrievalSources).toEqual(['bm25']);
  });
  it('BM25 후보도 현재 검색 대상 목록에 속한 파일만 반환한다', async () => {
    const bm25 = await createBm25([
      ['visible.md', 'specialterm'],
      ['excluded.md', 'specialterm'],
    ]);
    const engine = new RAGQueryEngine(null, null, bm25, 1, 0, {
      getCandidatePaths: () => Promise.resolve(new Set(['visible.md'])),
    });
    expect((await engine.query('specialterm', 5)).map((result) => result.sourcePath)).toEqual([
      'visible.md',
    ]);
  });
  it('임베딩과 벡터 저장소 없이 BM25 corpus만으로 결과를 반환한다', async () => {
    const bm25 = await createBm25([['notes/customer.md::0', '핵심 고객 문제와 해결 전략']]);
    await bm25.persist();
    const engine = new RAGQueryEngine(null, null, bm25, 1, 0);

    const results = await engine.query('고객 문제', 5, 0);

    expect(results).toEqual([
      expect.objectContaining({
        sourcePath: 'notes/customer.md::0',
        vectorScore: 0,
      }),
    ]);
    expect(results[0]?.bm25Score).toBeGreaterThan(0);
    expect(results[0]?.entry.metadata.text).toContain('고객 문제');
  });

  it('질의 임베딩이 실패해도 BM25로 계속 검색하고 fallback diagnostic을 남긴다', async () => {
    const store = new MemoryVectorStore();
    await store.add([createEntry('keyword.md', [1, 0], '특수 키워드가 있는 원문')]);
    const bm25 = await createBm25([['keyword.md', '특수 키워드가 있는 원문']]);
    const engine = new RAGQueryEngine(
      store,
      {
        embed: () => Promise.reject(new Error('embedding unavailable')),
        embedBatch: () => Promise.reject(new Error('embedding unavailable')),
      },
      bm25,
      1,
      0,
    );

    const results = await engine.query('특수 키워드', 5, 0);

    expect(results.map((result) => result.sourcePath)).toEqual(['keyword.md']);
    expect(engine.getLastRetrievalDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'query-embedding',
          source: 'embedding',
          status: 'error',
          skippedReason: 'query-embedding-failed',
        }),
        expect.objectContaining({
          providerId: 'exact-vector',
          status: 'skipped',
          skippedReason: 'query-embedding-unavailable',
        }),
        expect.objectContaining({ providerId: 'bm25', status: 'ok' }),
      ]),
    );
  });

  it('loaded BM25도 현재 Vault metadata coverage가 빠지면 partial로 판정한다', async () => {
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    bm25.addCorpusDocument({
      id: 'notes/indexed.md::0',
      text: '인덱스된 고객 근거',
      sourcePath: 'notes/indexed.md',
      startLine: 0,
      endLine: 0,
      sourceMtime: 10,
      sourceSize: 20,
      contentHash: 'current-hash',
      indexedAt: 30,
    });
    await bm25.persist();
    const engine = new RAGQueryEngine(null, null, bm25, 1, 0);

    await expect(
      engine.getIndexReadiness([
        { path: 'notes/indexed.md', mtime: 10, size: 20 },
        { path: 'notes/new.md', mtime: 40, size: 50 },
      ]),
    ).resolves.toMatchObject({
      readiness: 'partial',
    });
  });

  it.each([
    { contentHash: 'current-hash', readiness: 'ready' },
    { contentHash: undefined, readiness: 'stale' },
  ])(
    'BM25 해시 $contentHash의 준비 상태를 $readiness로 판정한다',
    async ({ contentHash, readiness }) => {
      const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
      await bm25.load();
      bm25.addCorpusDocument({
        id: 'notes/indexed.md::0',
        text: '인덱스된 고객 근거',
        sourcePath: 'notes/indexed.md',
        startLine: 0,
        endLine: 0,
        sourceMtime: 10,
        sourceSize: 20,
        contentHash,
        indexedAt: 30,
      });
      await bm25.persist();
      const engine = new RAGQueryEngine(null, null, bm25, 1, 0);

      await expect(
        engine.getIndexReadiness([{ path: 'notes/indexed.md', mtime: 10, size: 20 }]),
      ).resolves.toMatchObject({
        readiness,
      });
    },
  );

  it('folder scope가 있으면 해당 경로의 후보만 검색한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('archive/overview.md', [1, 0], '지난 프로젝트 개요'),
      createEntry('aurora/migration.txt', [0.8, 0.2], 'Aurora migration plan'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('오로라 마이그레이션 계획', 5, 0, ['aurora']);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual([
      'aurora/migration.txt',
    ]);
  });

  it('현재 검색 점수와 다양성 선택으로 topK를 결정하고 반복 질의의 순서를 보존한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '선교 여행에 대한 일반 설명'),
      createEntry('direct.md', [0.98, 0.2], 'Paul과 Barnabas 관계에 대한 직접 근거'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);
    const results = await engine.query('Paul과 Barnabas 관계', 1);
    expect(results.map((result) => result.sourcePath)).toEqual(['semantic.md']);
    expect(await engine.query('Paul과 Barnabas 관계', 1)).toEqual(results);
  });

  it('벡터 상위 후보 밖의 BM25 전용 후보도 최종 후보에 포함한다', async () => {
    const store = new MemoryVectorStore();
    const entries = Array.from({ length: 12 }, (_, index) =>
      createEntry(`semantic-${index}.md`, [1, 0], '일반 문서 내용'),
    );
    entries.push(createEntry('keyword.md', [0.2, 0.98], 'specialterm 정확한 키워드 문서'));
    await store.add(entries);
    const bm25 = await createBm25([
      ['keyword.md', 'specialterm 정확한 키워드 문서'],
      ...entries.slice(0, 12).map((entry) => [entry.metadata.filePath, '일반 문서 내용'] as const),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('keyword.md');
    expect(results[0]?.bm25Score).toBeGreaterThan(0);
  });

  it('BM25는 OpenRouter 문서를 open router처럼 띄어 쓴 질의로도 끌어올린다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '일반 설정 문서'),
      createEntry('api.md', [0, 1], 'OpenRouter API access key'),
    ]);
    const bm25 = await createBm25([
      ['semantic.md', '일반 설정 문서'],
      ['api.md', 'OpenRouter API access key'],
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.6, 0.5);

    const results = await engine.query('open router api', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('api.md');
    expect(results[0]?.bm25Score).toBeGreaterThan(0);
  });

  it('파일 단위 BM25 보정만 받은 무관 청크는 통과시키지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('mixed.md', [0.2, 0.98], 'specialterm 관련 청크'),
      createEntry('mixed.md', [0.2, 0.98], '전혀 다른 청크', 20),
    ]);
    const bm25 = await createBm25([['mixed.md', 'specialterm 관련 청크 전혀 다른 청크']]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 5);

    expect(results.map((result) => result.entry.metadata.startLine)).toEqual([0]);
  });

  it('최고점 대비 점수 차이가 큰 낮은 관련도 후보를 제외한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('best.md', [1, 0], '질문과 가까운 문서'),
      createEntry('weak.md', [0.7, 0.714], '약한 관련 문서'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual(['best.md']);
  });

  it('BM25 후보 병합 시 전체 벡터를 읽지 않고 해당 파일 entries만 가져온다', async () => {
    const store = new PathLookupStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '일반 문서 내용'),
      createEntry('keyword.md', [0.2, 0.98], 'specialterm 정확한 키워드 문서'),
    ]);
    const bm25 = await createBm25([
      ['keyword.md', 'specialterm 정확한 키워드 문서'],
      ['semantic.md', '일반 문서 내용'],
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('keyword.md');
    expect(store.getEntriesCalls).toBe(0);
    expect(store.requestedPaths).toEqual([['keyword.md']]);
  });

  it('ANN이 활성화되면 RAGQueryEngine은 ANN provider diagnostic을 기록한다', async () => {
    const store = new MemoryVectorStore();
    await store.add(
      Array.from({ length: 12 }, (_, index) =>
        createEntry(`entry-${index}.md`, index === 0 ? [1, 0] : [0, 1], '문서'),
      ),
    );
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      annEnabled: true,
      annClusterCount: 2,
      annProbeCount: 1,
      annMinEntryCount: 10,
    });

    await engine.query('질문', 1);

    expect(engine.getLastRetrievalDiagnostics()).toEqual([
      expect.objectContaining({
        providerId: 'ivf-vector',
        source: 'ann',
        status: 'ok',
      }),
    ]);
  });

  it('구조 그래프가 활성화되면 RAGQueryEngine은 structural provider diagnostic을 기록한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('seed.md', [1, 0], 'seed text'),
      createEntry('linked.md', [0, 1], 'linked text'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      structuralGraphEnabled: true,
      structuralMetadataContext: createMetadataContext({
        resolvedLinks: {
          'seed.md': { 'linked.md': 1 },
        },
      }),
    });

    await engine.query('질문', 2);

    expect(engine.getLastRetrievalDiagnostics()).toEqual([
      expect.objectContaining({
        providerId: 'exact-vector',
        source: 'vector',
        status: 'ok',
      }),
      expect.objectContaining({
        providerId: 'structural-graph',
        source: 'structural',
        status: 'ok',
      }),
    ]);
  });

  it('현재 embedding model과 맞지 않는 stale 후보가 retrieval pool을 독점하지 않는다', async () => {
    const store = new MemoryVectorStore();
    const freshEntry = createEntry('fresh.md', [0.9, 0.1], '현재 모델 벡터');
    freshEntry.metadata.embeddingModel = 'text-embedding-3-large';
    await store.add([
      ...Array.from({ length: 20 }, (_, index) =>
        createEntry(`stale-${index}.md`, [1, 0], '오래된 모델 벡터'),
      ),
      freshEntry,
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      embeddingModel: 'text-embedding-3-large',
    });

    const results = await engine.query('질문', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('fresh.md');
  });

  it('같은 model과 dimension이어도 현재 embedding provider와 다른 후보를 제외한다', async () => {
    const store = new MemoryVectorStore();
    const stale = createEntry('stale-provider.md', [1, 0], '이전 공급자 벡터');
    stale.metadata.embeddingProvider = 'legacy-provider';
    const fresh = createEntry('fresh-provider.md', [0.9, 0.1], '현재 공급자 벡터');
    fresh.metadata.embeddingProvider = 'current-provider';
    await store.add([stale, fresh]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      embeddingProvider: 'current-provider',
      embeddingModel: 'text-embedding-3-small',
    });

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual(['fresh-provider.md']);
    await expect(
      engine.getIndexReadiness([
        { path: 'stale-provider.md', mtime: 1000, size: '이전 공급자 벡터'.length },
        { path: 'fresh-provider.md', mtime: 1000, size: '현재 공급자 벡터'.length },
      ]),
    ).resolves.toMatchObject({ readiness: 'stale' });
  });

  it('MMR 다양성 선택으로 같은 파일의 유사 청크가 topK를 독점하지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('same.md', [1, 0], '같은 파일 첫 청크', 1),
      createEntry('same.md', [0.999, 0.001], '같은 파일 둘째 청크', 10),
      createEntry('other.md', [0.96, 0.28], '다른 파일 관련 청크', 1),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual([
      'same.md',
      'other.md',
    ]);
  });

  it('벡터 차원이 맞지 않는 오래된 후보는 NaN 점수 없이 제외한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('stale.md', [1], '오래된 차원 벡터'),
      createEntry('fresh.md', [0.9, 0.1], '현재 차원 벡터'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual(['fresh.md']);
    expect(results.every((result) => Number.isFinite(result.score))).toBe(true);
    expect(results.every((result) => Number.isFinite(result.vectorScore))).toBe(true);
  });
});

function createEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: () => Promise.resolve(vector),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => vector)),
  };
}

function createEntry(path: string, vector: number[], text: string, startLine = 0): VectorEntry {
  return {
    id: `${path}::${startLine}`,
    vector,
    metadata: {
      filePath: path,
      startLine,
      endLine: startLine,
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      contentHash: 'hash',
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<IndexedDbBM25Index> {
  const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
  await bm25.load();
  for (const [path, text] of documents) {
    bm25.addDocument(path, text);
  }
  return bm25;
}

function createBm25DbName(): string {
  const dbName = `SuperpowerInsideQueryBM25Test-${crypto.randomUUID()}`;
  bm25DbNames.add(dbName);
  return dbName;
}

function createAdapter(): DataAdapter {
  return {
    exists: () => Promise.resolve(false),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
}

class PathLookupStore extends MemoryVectorStore {
  getEntriesCalls = 0;
  requestedPaths: string[][] = [];

  override getEntries(): Promise<VectorEntry[]> {
    this.getEntriesCalls++;
    return super.getEntries();
  }

  override async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    this.requestedPaths.push([...filePaths].sort());
    const allowed = new Set(filePaths);
    return (await super.getEntries()).filter((entry) => allowed.has(entry.metadata.filePath));
  }
}

function createMetadataContext(input: { resolvedLinks?: Record<string, Record<string, number>> }) {
  const files = new Map<string, TFile>();
  const getFile = (path: string): TFile => {
    const existing = files.get(path);
    if (existing) return existing;
    const file = { path } as TFile;
    files.set(path, file);
    return file;
  };

  return {
    resolvedLinks: input.resolvedLinks ?? {},
    getFileByPath: (path: string) => getFile(path),
    getFileCache: () => null,
    getFirstLinkpathDest: (linkpath: string) => getFile(linkpath),
  };
}
