import { beforeEach, describe, expect, it, vi } from 'vitest';

const rankTopKPairsRustMock = vi.hoisted(() => vi.fn());

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    rankTopKPairsRust: rankTopKPairsRustMock,
  };
});

import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { MemoryVectorStore } from '../rag/store';
import { GraphRagQueryEngine } from './query-engine';
import { InMemoryKnowledgeGraphStore, type GraphCommunityRecord } from './store';

describe('GraphRagQueryEngine Rust bridge usage', () => {
  beforeEach(() => {
    rankTopKPairsRustMock.mockReset();
  });

  it('global community summary ranking follows Rust top-k results', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addCommunity(createCommunity('community::first', [1, 0]));
    await graphStore.addCommunity(createCommunity('community::second', [0, 1]));
    rankTopKPairsRustMock.mockReturnValue([
      { index: 1, score: 0.93 },
      { index: 0, score: 0.12 },
    ]);
    const engine = new GraphRagQueryEngine(
      graphStore,
      new MemoryVectorStore(),
      DEFAULT_ONTOLOGY_SCHEMA,
      { queryMode: 'global' },
    );

    const candidates = await engine.query({
      question: 'community summary',
      queryVector: [1, 0],
      candidateLimit: 2,
    });

    expect(rankTopKPairsRustMock).toHaveBeenCalledWith([1, 0], [[1, 0], [0, 1]], 2);
    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([
      'community::second',
      'community::first',
    ]);
    expect(candidates.map((candidate) => candidate.sourceScore)).toEqual([0.93, 0.12]);
  });
});

function createCommunity(id: string, summaryVector: number[]): GraphCommunityRecord {
  return {
    id,
    ontologySchemaId: 'default',
    title: id,
    entityIds: [],
    relationIds: [],
    claimIds: [],
    summary: id,
    summaryVector,
    level: 0,
    updatedAt: 1,
  };
}
