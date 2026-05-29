import { describe, expect, it } from 'vitest';
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
import { JsonFileBM25Index } from './bm25';
import { MemoryVectorStore, type VectorEntry } from './store';
import type { DataAdapter, TFile } from 'obsidian';

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

  it('provider timeout은 전체 retrieval 실패로 전파하지 않고 diagnostic에 기록한다', async () => {
    const slowProvider: CandidateProvider = {
      id: 'slow-provider',
      source: 'vector',
      deadlineMs: 5,
      getCandidates: () => new Promise<RetrievalCandidate[]>(() => undefined),
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

  it('calculateRecallAtK는 exact 상위 후보 대비 ANN recall을 계산한다', () => {
    const recall = calculateRecallAtK(['a', 'b', 'c'], ['c', 'x', 'a'], 3);

    expect(recall).toBeCloseTo(2 / 3);
  });

  it('BM25CandidateProvider는 전체 entries를 읽지 않고 filePath lookup만 사용한다', async () => {
    const store = new PathLookupStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '일반 문서'),
      createEntry('keyword.md', [0, 1], 'specialterm 문서'),
    ]);
    const bm25 = await createBm25([
      ['semantic.md', '일반 문서'],
      ['keyword.md', 'specialterm 문서'],
    ]);
    const provider = new BM25CandidateProvider(store, bm25);

    const candidates = await provider.getCandidates({
      ...createRequest([1, 0], 5),
      question: 'specialterm',
    });

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual([
      'keyword.md',
    ]);
    expect(store.getEntriesCalls).toBe(0);
    expect(store.requestedPaths).toEqual([['keyword.md']]);
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
  documents: readonly (readonly [string, string])[],
): Promise<JsonFileBM25Index> {
  const bm25 = new JsonFileBM25Index(createAdapter());
  await bm25.load();
  for (const [path, text] of documents) {
    bm25.addDocument(path, text);
  }
  return bm25;
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
