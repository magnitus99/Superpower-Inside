import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BM25CandidateProvider,
  ExactVectorCandidateProvider,
  IvfVectorCandidateProvider,
  RagRetrievalPipeline,
  StructuralGraphCandidateProvider,
  calculateRecallAtK,
  type CandidateProvider,
  type RagRetrievalRequest,
  type RetrievalCandidate,
} from './retrieval-pipeline';
import { IndexedDbBM25Index } from './bm25';
import { MemoryVectorStore, type VectorEntry } from './store';
import type { DataAdapter, TFile } from 'obsidian';

const dbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
});

describe('RagRetrievalPipeline', () => {
  it('ExactVectorCandidateProvider는 저장소의 벡터 후보를 공통 후보 계약으로 반환한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('best.md', [1, 0], '가장 가까운 문서'),
      createEntry('weak.md', [0.7, 0.714], '덜 가까운 문서'),
    ]);
    const provider = new ExactVectorCandidateProvider(store);

    const candidates = await provider.getCandidates(createRequest([1, 0], 1));

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual(['best.md']);
    expect(candidates[0]?.source).toBe('vector');
  });

  it('ExactVectorCandidateProvider는 embedding 필터가 있어도 전체 entries를 복사하지 않는다', async () => {
    const best = createEntry('best.md', [1, 0], '가장 가까운 문서');
    const store = new SearchOnlyStore([best]);
    const provider = new ExactVectorCandidateProvider(store);

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 1),
      vectorFilter: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        dimension: 2,
      },
      isEntryCompatible: () => true,
    });

    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([best.id]);
    expect(store.searchCalls).toEqual([
      expect.objectContaining({
        topK: 1,
        filter: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          dimension: 2,
        },
      }),
    ]);
    expect(store.getEntriesCalls).toBe(0);
  });

  it('provider timeout은 전체 retrieval 실패로 전파하지 않고 diagnostic에 기록한다', async () => {
    const signals: AbortSignal[] = [];
    const slowProvider: CandidateProvider = {
      id: 'slow-provider',
      source: 'vector',
      deadlineMs: 5,
      getCandidates: (_request, signal) =>
        new Promise<RetrievalCandidate[]>((resolve) => {
          if (signal) signals.push(signal);
          setTimeout(() => resolve([]), 30);
        }),
    };
    const pipeline = new RagRetrievalPipeline([slowProvider]);

    const result = await pipeline.retrieve(createRequest([1, 0], 5));

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        providerId: 'slow-provider',
        source: 'vector',
        status: 'timeout',
      }),
    ]);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('provider별 후보 순위를 병합 결과에 보존한다', async () => {
    const shared = createEntry('shared.md', [1, 0], '공통 후보');
    const vectorProvider: CandidateProvider = {
      id: 'vector-test',
      source: 'vector',
      deadlineMs: 300,
      getCandidates: () =>
        Promise.resolve([
          { entry: createEntry('first.md', [1, 0], '1순위 후보'), source: 'vector' },
          { entry: shared, source: 'vector' },
        ]),
    };
    const bm25Provider: CandidateProvider = {
      id: 'bm25-test',
      source: 'bm25',
      deadlineMs: 300,
      getCandidates: () => Promise.resolve([{ entry: shared, source: 'bm25' }]),
    };
    const pipeline = new RagRetrievalPipeline([vectorProvider, bm25Provider]);

    const result = await pipeline.retrieve(createRequest([1, 0], 5));

    const sharedCandidate = result.candidates.find((candidate) => candidate.entry.id === shared.id);
    expect(sharedCandidate?.sourceRanks).toEqual({
      vector: 2,
      bm25: 1,
    });
  });

  it('IvfVectorCandidateProvider는 작은 저장소에서 exact vector source를 유지한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('best.md', [1, 0], '가장 가까운 문서'),
      createEntry('weak.md', [0.7, 0.714], '덜 가까운 문서'),
    ]);
    const provider = new IvfVectorCandidateProvider(store, {
      minEntryCount: 500,
      clusterCount: 0,
      probeCount: 4,
    });

    const candidates = await provider.getCandidates(createRequest([1, 0], 1));

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual(['best.md']);
    expect(candidates[0]?.source).toBe('vector');
  });

  it('IvfVectorCandidateProvider는 큰 저장소에서 ANN 후보를 반환한다', async () => {
    const store = new MemoryVectorStore();
    await store.add(
      Array.from({ length: 12 }, (_, index) =>
        createEntry(`entry-${index}.md`, index === 0 ? [1, 0] : [0, 1], '문서'),
      ),
    );
    const provider = new IvfVectorCandidateProvider(store, {
      minEntryCount: 10,
      clusterCount: 2,
      probeCount: 1,
    });

    const candidates = await provider.getCandidates(createRequest([1, 0], 3));

    expect(candidates[0]?.entry.metadata.filePath).toBe('entry-0.md');
    expect(candidates.every((candidate) => candidate.source === 'ann')).toBe(true);
    expect(provider.getState()).toEqual(
      expect.objectContaining({
        mode: 'ann',
        entryCount: 12,
        clusterCount: 2,
      }),
    );
  });

  it('IvfVectorCandidateProvider는 같은 엔트리 개수로 교체된 저장소를 stale ANN 캐시로 조회하지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add(
      Array.from({ length: 12 }, (_, index) =>
        createEntry(`entry-${index}.md`, index === 0 ? [1, 0] : [0, 1], `old-${index}`),
      ),
    );
    const provider = new IvfVectorCandidateProvider(store, {
      minEntryCount: 10,
      clusterCount: 2,
      probeCount: 1,
    });

    await provider.getCandidates(createRequest([1, 0], 1));
    await store.replaceFileEntries('entry-0.md', [createEntry('entry-0.md', [0, 1], 'new-0')]);
    await store.replaceFileEntries('entry-1.md', [createEntry('entry-1.md', [1, 0], 'new-1')]);

    const candidates = await provider.getCandidates(createRequest([1, 0], 1));

    expect(candidates[0]?.entry.id).toBe('entry-1.md::1');
  });

  it('IvfVectorCandidateProvider는 ANN 후보도 저장소 search API로 조회한다', async () => {
    const best = createEntry('best.md', [1, 0], '가장 가까운 문서');
    const store = new SearchOnlyStore([best]);
    const provider = new IvfVectorCandidateProvider(store, {
      minEntryCount: 1,
      clusterCount: 2,
      probeCount: 1,
    });

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 1),
      vectorFilter: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        dimension: 2,
      },
      isEntryCompatible: () => true,
    });

    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([best.id]);
    expect(candidates[0]?.source).toBe('ann');
    expect(store.searchCalls).toEqual([
      expect.objectContaining({
        mode: 'ann',
        topK: 1,
        annMinEntryCount: 1,
        annClusterCount: 2,
        annProbeCount: 1,
      }),
    ]);
    expect(store.getEntriesCalls).toBe(0);
  });

  it('calculateRecallAtK는 exact 상위 후보 대비 ANN recall을 계산한다', () => {
    const recall = calculateRecallAtK(['a', 'b', 'c'], ['c', 'x', 'a'], 3);

    expect(recall).toBeCloseTo(2 / 3);
  });

  it('BM25CandidateProvider는 전체 entries를 읽지 않고 entry id lookup만 사용한다', async () => {
    const store = new PathLookupStore();
    const semantic = createEntry('semantic.md', [1, 0], '일반 문서');
    const keyword = createEntry('keyword.md', [0, 1], 'specialterm 문서');
    const unrelatedSameFile = createEntry('keyword.md', [0.2, 0.8], '다른 청크', 10);
    await store.add([semantic, keyword, unrelatedSameFile]);
    const bm25 = await createBm25([
      [semantic.id, semantic.metadata.text, semantic.metadata.filePath],
      [keyword.id, keyword.metadata.text, keyword.metadata.filePath],
      [unrelatedSameFile.id, unrelatedSameFile.metadata.text, unrelatedSameFile.metadata.filePath],
    ]);
    const provider = new BM25CandidateProvider(store, bm25);

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 5),
      question: 'specialterm',
    });

    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([keyword.id]);
    expect(store.getEntriesCalls).toBe(0);
    expect(store.requestedPaths).toEqual([]);
    expect(store.requestedIds).toEqual([[keyword.id]]);
  });

  it('BM25CandidateProvider는 BM25 hit를 lookup 예산만큼만 WASM에서 가져온다', async () => {
    const store = new PathLookupStore();
    const entries = Array.from({ length: 12 }, (_, index) =>
      createEntry(`keyword-${index}.md`, [0, 1], `specialterm 문서 ${index}`),
    );
    await store.add(entries);
    const bm25 = await createBm25(
      entries.map((entry) => [entry.id, entry.metadata.text, entry.metadata.filePath]),
    );
    const searchTopSpy = vi.spyOn(bm25, 'searchTop');
    const provider = new BM25CandidateProvider(store, bm25);

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 2),
      question: 'specialterm',
    });

    expect(searchTopSpy).toHaveBeenCalledWith('specialterm', 8);
    expect(candidates).toHaveLength(2);
  });

  it('BM25CandidateProvider는 stale doc id를 source file path로 복구한다', async () => {
    const store = new PathLookupStore();
    const currentEntry = createEntry('keyword.md', [0, 1], 'renamed specialterm 문서', 42);
    await store.add([currentEntry]);
    const bm25 = await createBm25([
      ['stale-keyword-chunk', 'specialterm specialterm', currentEntry.metadata.filePath],
    ]);
    const provider = new BM25CandidateProvider(store, bm25);

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 5),
      question: 'specialterm',
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        entry: currentEntry,
        source: 'bm25',
        sourceScore: 1,
        reason: 'keyword-match',
      }),
    ]);
    expect(store.getEntriesCalls).toBe(0);
    expect(store.requestedIds).toEqual([['stale-keyword-chunk']]);
    expect(store.requestedPaths).toEqual([[currentEntry.metadata.filePath]]);
  });

  it('StructuralGraphCandidateProvider는 seed 파일의 링크와 백링크 파일 후보를 추가한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('seed.md', [1, 0], 'seed text'),
      createEntry('linked.md', [0, 1], 'linked text'),
      createEntry('backlink.md', [0, 1], 'backlink text'),
    ]);
    const provider = new StructuralGraphCandidateProvider(
      store,
      createMetadataContext({
        resolvedLinks: {
          'seed.md': { 'linked.md': 1 },
          'backlink.md': { 'seed.md': 1 },
        },
      }),
    );

    const candidates = await provider.getCandidates(createRequest([1, 0], 10));

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath).sort()).toEqual([
      'backlink.md',
      'linked.md',
    ]);
    expect(candidates.every((candidate) => candidate.source === 'structural')).toBe(true);
  });

  it('StructuralGraphCandidateProvider는 같은 heading 주변 chunk 후보를 추가한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('seed.md', [1, 0], 'seed text', 12, 'Main'),
      createEntry('seed.md', [0, 1], 'same heading text', 18, 'Main'),
      createEntry('seed.md', [0, 1], 'other heading text', 40, 'Other'),
    ]);
    const provider = new StructuralGraphCandidateProvider(
      store,
      createMetadataContext({
        fileCaches: {
          'seed.md': {
            headings: [
              {
                heading: 'Main',
                level: 2,
                position: { start: { line: 10, col: 0, offset: 0 }, end: { line: 10, col: 0, offset: 0 } },
              },
            ],
          },
        },
      }),
    );

    const candidates = await provider.getCandidates(createRequest([1, 0], 10));

    expect(candidates.map((candidate) => candidate.entry.metadata.text)).toEqual([
      'same heading text',
    ]);
  });
});

function createRequest(queryVector: number[], candidateLimit: number): RagRetrievalRequest {
  return {
    question: '질문',
    queryVector,
    candidateLimit,
  };
}

function createEntry(
  path: string,
  vector: number[],
  text: string,
  startLine = 1,
  heading?: string,
): VectorEntry {
  return {
    id: `${path}::${startLine}`,
    vector,
    metadata: {
      filePath: path,
      heading,
      startLine,
      endLine: startLine,
      text,
    },
  };
}

async function createBm25(
  documents: readonly (readonly [string, string] | readonly [string, string, string])[],
): Promise<IndexedDbBM25Index> {
  const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
  await bm25.load();
  const writableBm25 = bm25 as unknown as {
    addDocument(docId: string, text: string, filePath?: string): void;
  };
  for (const [id, text, filePath] of documents) {
    writableBm25.addDocument(id, text, filePath);
  }
  return bm25;
}

function createDbName(): string {
  const dbName = `SuperpowerInsideRetrievalBM25Test-${crypto.randomUUID()}`;
  dbNames.add(dbName);
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
  requestedIds: string[][] = [];

  override getEntries(): Promise<VectorEntry[]> {
    this.getEntriesCalls++;
    return super.getEntries();
  }

  override async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    this.requestedPaths.push([...filePaths].sort());
    const allowed = new Set(filePaths);
    return (await super.getEntries()).filter((entry) => allowed.has(entry.metadata.filePath));
  }

  override async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    this.requestedIds.push([...ids].sort());
    const allowed = new Set(ids);
    return (await super.getEntries()).filter((entry) => allowed.has(entry.id));
  }
}

class SearchOnlyStore extends MemoryVectorStore {
  getEntriesCalls = 0;
  searchCalls: unknown[] = [];

  constructor(private readonly searchEntries: VectorEntry[]) {
    super();
  }

  override getEntries(): Promise<VectorEntry[]> {
    this.getEntriesCalls++;
    throw new Error('getEntries must not be used for vector candidate search');
  }

  override getStats(): Promise<{
    totalEntries: number;
    totalFiles: number;
    totalVectors: number;
    averageVectorsPerFile: number;
    lastUpdated: number | null;
  }> {
    return Promise.resolve({
      totalEntries: this.searchEntries.length,
      totalFiles: new Set(this.searchEntries.map((entry) => entry.metadata.filePath)).size,
      totalVectors: this.searchEntries.length,
      averageVectorsPerFile: this.searchEntries.length,
      lastUpdated: 1,
    });
  }

  search(request: unknown): Promise<Array<{ entry: VectorEntry; score: number; mode: 'exact' | 'ann' }>> {
    this.searchCalls.push(request);
    return Promise.resolve(
      this.searchEntries.map((entry) => ({
        entry,
        score: 1,
        mode: isRecord(request) && request.mode === 'ann' ? 'ann' : 'exact',
      })),
    );
  }
}

interface TestMetadataContextInput {
  resolvedLinks?: Record<string, Record<string, number>>;
  fileCaches?: Record<string, { headings?: Array<{ heading: string; level: number; position: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } } }>; links?: Array<{ link: string; original: string; position: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } } }> }>;
}

function createMetadataContext(input: TestMetadataContextInput) {
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
    getFileCache: (file: TFile) => input.fileCaches?.[file.path] ?? null,
    getFirstLinkpathDest: (linkpath: string) => getFile(linkpath),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
