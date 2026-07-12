import { beforeEach, describe, expect, it, vi } from 'vitest';

const rankTopKPairsRustMock = vi.hoisted(() => vi.fn());
const planGraphQueryExecutionRustMock = vi.hoisted(() => vi.fn());

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    rankTopKPairsRust: rankTopKPairsRustMock,
    planGraphQueryExecutionRust: planGraphQueryExecutionRustMock,
  };
});

import { buildDefaultOntologySchema } from '../ontology/schema';
import { MemoryVectorStore } from '../rag/store';
import { GraphRagQueryEngine } from './query-engine';
import {
  InMemoryKnowledgeGraphStore,
  type GraphClaimRecord,
  type GraphCommunityRecord,
  type GraphEntityRecord,
  type GraphRelationRecord,
  type GraphEvidenceRecord,
} from './store';
import type { VectorEntry } from '../rag/store';

describe('GraphRagQueryEngine Rust bridge usage', () => {
  beforeEach(() => {
    rankTopKPairsRustMock.mockReset();
    planGraphQueryExecutionRustMock.mockReset();
    planGraphQueryExecutionRustMock.mockReturnValue(null);
  });

  it('planGraphQueryExecutionRust가 null이어도 global 모드는 global 경로로 동작한다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addCommunity(createCommunity('community::first', [1, 0]));
    await graphStore.addCommunity(createCommunity('community::second', [0, 1]));
    planGraphQueryExecutionRustMock.mockReturnValueOnce(null);
    rankTopKPairsRustMock.mockReturnValue([
      { index: 0, score: 0.9 },
      { index: 1, score: 0.4 },
    ]);

    const engine = new GraphRagQueryEngine(
      graphStore,
      new MemoryVectorStore(),
      buildDefaultOntologySchema(),
      { queryMode: 'global' },
    );

    const candidates = await engine.query({
      question: 'global fallback',
      queryVector: [1, 0],
      candidateLimit: 2,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual([
      'graph-global',
      'graph-global',
    ]);
    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([
      'community::first',
      'community::second',
    ]);
    expect(candidates[1]?.sourceScore).toBe(0.4);
    expect(planGraphQueryExecutionRustMock).toHaveBeenCalledWith('global', 'none', false);
  });

  it('auto 모드에서 Rust 실행 플래너가 실패해도 deterministic local 계획을 존중한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    planGraphQueryExecutionRustMock.mockReturnValueOnce(null);

    const engine = new GraphRagQueryEngine(graphStore, vectorStore, buildDefaultOntologySchema());

    const candidates = await engine.query({
      question: 'Paul과 Barnabas 관계를 보여줘',
      queryVector: [1, 0],
      candidateLimit: 3,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(['graph-local']);
    expect(candidates[0]?.entry.metadata.filePath).toBe('Acts.md');
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
      buildDefaultOntologySchema(),
      { queryMode: 'global' },
    );

    const candidates = await engine.query({
      question: 'community summary',
      queryVector: [1, 0],
      candidateLimit: 2,
    });

    expect(rankTopKPairsRustMock).toHaveBeenCalledWith(
      [1, 0],
      [
        [1, 0],
        [0, 1],
      ],
      2,
    );
    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([
      'community::second',
      'community::first',
    ]);
    expect(candidates.map((candidate) => candidate.sourceScore)).toEqual([0.93, 0.12]);
  });

  it('invalid community index는 건너뛰고 유효 index만 사용한다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addCommunity(createCommunity('community::first', [1, 0]));
    await graphStore.addCommunity(createCommunity('community::second', [0, 1]));
    rankTopKPairsRustMock.mockReturnValue([
      { index: -1, score: 0.93 },
      { index: 0, score: 0.12 },
      { index: 99, score: 0.4 },
    ]);
    const engine = new GraphRagQueryEngine(
      graphStore,
      new MemoryVectorStore(),
      buildDefaultOntologySchema(),
      { queryMode: 'global' },
    );

    const candidates = await engine.query({
      question: 'community summary',
      queryVector: [1, 0],
      candidateLimit: 3,
    });

    expect(candidates.map((candidate) => candidate.entry.id)).toEqual(['community::first']);
    expect(candidates[0]?.sourceScore).toBe(0.12);
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

async function createGraphFixture(): Promise<{
  graphStore: InMemoryKnowledgeGraphStore;
  vectorStore: MemoryVectorStore;
}> {
  const graphStore = new InMemoryKnowledgeGraphStore();
  const vectorStore = new MemoryVectorStore();
  const evidence: GraphEvidenceRecord = {
    id: 'evidence::acts',
    filePath: 'Acts.md',
    entryId: 'Acts.md::1::0',
    startLine: 1,
    endLine: 4,
    quote: 'Paul and Barnabas traveled together.',
    contentHash: 'hash',
    extractionModelKey: 'openai:gpt-4o-mini',
    updatedAt: 1,
  };
  await graphStore.addEvidence(evidence);
  await graphStore.upsertEntity(createEntity('Paul', ['Saul', '바울'], [evidence.id]));
  await graphStore.upsertEntity(createEntity('Barnabas', ['바나바'], [evidence.id]));
  await graphStore.addRelation(createRelation(evidence.id));
  await graphStore.addClaim(createClaim(evidence.id));
  await vectorStore.add([createVectorEntry('Acts.md::1::0', 'Acts.md')]);
  return { graphStore, vectorStore };
}

function createEntity(name: string, aliases: string[], evidenceIds: string[]): GraphEntityRecord {
  return {
    id: `entity::general::person::${name.toLowerCase()}`,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'person',
    canonicalName: name,
    aliases,
    description: '',
    properties: {},
    confidence: 0.9,
    evidenceIds,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createRelation(evidenceId: string): GraphRelationRecord {
  return {
    id: 'relation::paul-barnabas',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId: 'collaborated_with',
    sourceEntityId: 'entity::general::person::paul',
    targetEntityId: 'entity::general::person::barnabas',
    description: 'Paul and Barnabas traveled together.',
    properties: {},
    confidence: 0.85,
    evidenceIds: [evidenceId],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createClaim(evidenceId: string): GraphClaimRecord {
  return {
    id: 'claim::paul-barnabas',
    claimTypeId: 'factual_claim',
    text: 'Paul and Barnabas traveled together.',
    entityIds: ['entity::general::person::paul', 'entity::general::person::barnabas'],
    relationIds: ['relation::paul-barnabas'],
    stance: 'neutral',
    confidence: 0.8,
    evidenceIds: [evidenceId],
    updatedAt: 1,
  };
}

function createVectorEntry(id: string, filePath: string): VectorEntry {
  return {
    id,
    vector: [1, 0],
    metadata: {
      filePath,
      startLine: 1,
      endLine: 4,
      text: 'Paul and Barnabas traveled together.',
    },
  };
}
