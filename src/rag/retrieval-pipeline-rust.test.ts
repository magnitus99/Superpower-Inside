import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryVectorStore, type VectorEntry } from './store';
import {
  IvfVectorCandidateProvider,
  type RagRetrievalRequest,
  mergeRetrievalCandidateGroupsByEntryId,
} from './retrieval-pipeline';

const rankTopKPairsRustMock = vi.hoisted(() => vi.fn());
const planMergedRetrievalCandidatesByEntryIdRustMock = vi.hoisted(() => vi.fn());

vi.mock('./rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rust-core')>();
  return {
    ...actual,
    rankTopKPairsRust: rankTopKPairsRustMock,
    planMergedRetrievalCandidatesByEntryIdRust:
      planMergedRetrievalCandidatesByEntryIdRustMock,
  };
});

beforeEach(() => {
  rankTopKPairsRustMock.mockReset();
  planMergedRetrievalCandidatesByEntryIdRustMock.mockReset();
});

describe('IvfVectorCandidateProvider Rust bridge guard', () => {
  it('잘못된 centroid 인덱스는 건너뛰고 유효 클러스터만 검색한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('entry-0.md', [1, 0], 'seed 0'),
      createEntry('entry-1.md', [0, 1], 'seed 1'),
      createEntry('entry-2.md', [0.5, 0.5], 'seed 2'),
      createEntry('entry-3.md', [0.2, 0.8], 'seed 3'),
      createEntry('entry-4.md', [0.7, 0.3], 'seed 4'),
      createEntry('entry-5.md', [0.6, 0.4], 'seed 5'),
    ]);

    rankTopKPairsRustMock
      .mockReturnValueOnce([
        { index: -1, score: 0.99 },
        { index: 100, score: 0.85 },
        { index: 0, score: 0.70 },
      ])
      .mockReturnValueOnce([
        { index: -1, score: 0.99 },
        { index: 0, score: 0.88 },
        { index: 2, score: 0.44 },
      ]);

    const provider = new IvfVectorCandidateProvider(
      store,
      {
        minEntryCount: 6,
        clusterCount: 2,
        probeCount: 2,
      },
      500,
    );

    const request: RagRetrievalRequest = {
      question: 'query',
      queryVector: [1, 0],
      candidateLimit: 3,
    };

    const candidates = await provider.getCandidates(request);

    const paths = candidates.map((candidate) => candidate.entry.metadata.filePath);
    expect(paths).toEqual(expect.arrayContaining(['entry-0.md']));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('mergeRetrievalCandidateGroupsByEntryId는 rust 계획 실패 시 source 병합 규칙을 유지한다', () => {
    planMergedRetrievalCandidatesByEntryIdRustMock.mockReturnValueOnce(null);
    const shared = createEntry('shared.md', [1, 0], 'shared');

    const groups = mergeRetrievalCandidateGroupsByEntryId([
      { entry: shared, source: 'vector', sourceScore: 0.8, rank: 2, reason: 'v1' },
      { entry: shared, source: 'bm25', sourceScore: 0.9 },
      { entry: createEntry('other.md', [0, 1], 'other'), source: 'bm25', rank: 1 },
      { entry: shared, source: 'vector', sourceScore: 0.7, rank: 3 },
      { entry: shared, source: 'graph-local', sourceScore: 0.6, rank: 4 },
    ]);

    const sharedIndex = groups.findIndex((group) => group.sources.some((source) => source.source === 'vector'));
    const sharedGroupEntry = groups[sharedIndex];
    expect(sharedIndex).toBe(0);
    expect(sharedGroupEntry?.entryIndex).toBe(0);
    expect(sharedGroupEntry?.firstCandidateIndex).toBe(0);
    expect(sharedGroupEntry?.candidateIndexes).toEqual([0, 1, 3, 4]);
    expect(sharedGroupEntry?.sources).toHaveLength(3);

    const vectorSource = sharedGroupEntry?.sources.find((source) => source.source === 'vector');
    const bm25Source = sharedGroupEntry?.sources.find((source) => source.source === 'bm25');
    const graphLocalSource = sharedGroupEntry?.sources.find((source) => source.source === 'graph-local');
    expect(vectorSource).toEqual({ source: 'vector', sourceScore: 0.7, rank: 2 });
    expect(bm25Source).toEqual({ source: 'bm25', sourceScore: 0.9, rank: undefined });
    expect(graphLocalSource).toEqual({ source: 'graph-local', sourceScore: 0.6, rank: 4 });
    expect(groups[1]?.entryIndex).toBe(2);
    expect(groups[1]?.candidateIndexes).toEqual([2]);
    expect(groups[1]?.sources).toEqual([{ source: 'bm25', sourceScore: undefined, rank: 1 }]);
    expect(groups).toHaveLength(2);
  });
});

describe('mergeRetrievalCandidateGroupsByEntryId fallback contract', () => {
  it('rust 계획이 없을 때도 후보 병합 결과가 빈 값이 아님을 보장한다', () => {
    planMergedRetrievalCandidatesByEntryIdRustMock.mockReturnValueOnce(null);
    const shared = createEntry('shared.md', [1, 0], 'shared');

    const groups = mergeRetrievalCandidateGroupsByEntryId([
      { entry: shared, source: 'vector', sourceScore: 0.5, rank: 5 },
      { entry: shared, source: 'vector', sourceScore: 0.8, rank: 7 },
      { entry: shared, source: 'ann', sourceScore: 0.6, rank: 8 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.candidateIndexes).toEqual([0, 1, 2]);
    expect(groups[0]?.sources).toEqual([
      { source: 'vector', sourceScore: 0.8, rank: 5 },
      { source: 'ann', sourceScore: 0.6, rank: 8 },
    ]);
  });
});

function createEntry(filePath: string, vector: number[], text: string): VectorEntry {
  return {
    id: `${filePath}::0`,
    vector,
    metadata: {
      filePath,
      startLine: 0,
      endLine: 0,
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      contentHash: text,
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}
