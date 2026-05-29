import { describe, expect, it } from 'vitest';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { MemoryVectorStore, type VectorEntry } from '../rag/store';
import { GraphRagCandidateProvider, GraphRagQueryEngine, planGraphQuery } from './query-engine';
import {
  InMemoryKnowledgeGraphStore,
  type GraphClaimRecord,
  type GraphEntityRecord,
  type GraphEvidenceRecord,
  type GraphRelationRecord,
} from './store';

describe('GraphRagQueryEngine', () => {
  it('factual 질문은 local graph traversal로 관련 evidence 후보를 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: 'Paul과 Barnabas는 어떤 관계야?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual([
      'Acts.md',
    ]);
    expect(candidates[0]?.source).toBe('graph-local');
    expect(candidates[0]?.reason).toBe('local-entity-neighborhood');
  });

  it('근거를 묻는 질문은 evidence-first 후보를 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: 'Paul과 Barnabas 관계 근거가 어디에 있어?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates[0]?.source).toBe('evidence');
    expect(candidates[0]?.reason).toBe('evidence-first');
  });

  it('thematic 질문은 community summary vector 후보를 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    await graphStore.addCommunity({
      id: 'community::mission',
      ontologySchemaId: 'default',
      title: 'Mission conflict',
      entityIds: ['entity::general::person::paul'],
      relationIds: [],
      claimIds: [],
      summary: 'Paul and Barnabas missionary conflict',
      summaryVector: [1, 0],
      level: 0,
      updatedAt: 1,
    });
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: '반복되는 핵심 주제는?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates[0]?.source).toBe('graph-global');
    expect(candidates[0]?.entry.metadata.filePath).toBe('graph://community/community::mission');
  });

  it('query mode가 local이면 thematic 질문도 evidence 후보만 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixtureWithCommunity();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryMode: 'local',
    });

    const candidates = await engine.query({
      question: 'Paul 관련 반복되는 핵심 주제는?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates[0]?.source).toBe('graph-local');
    expect(candidates.map((candidate) => candidate.source)).not.toContain('graph-global');
  });

  it('query mode가 global이면 relational 질문도 community summary 후보만 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixtureWithCommunity();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryMode: 'global',
    });

    const candidates = await engine.query({
      question: 'Paul과 Barnabas는 어떤 관계야?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates[0]?.source).toBe('graph-global');
    expect(candidates.map((candidate) => candidate.source)).not.toContain('graph-local');
  });

  it('query mode가 hybrid이면 local evidence와 global summary를 함께 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixtureWithCommunity();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryMode: 'hybrid',
    });

    const candidates = await engine.query({
      question: 'Paul과 Barnabas 관계와 반복되는 핵심 주제는?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(
      expect.arrayContaining(['graph-local', 'graph-global']),
    );
  });
});

describe('GraphRagCandidateProvider', () => {
  it('retrieval pipeline candidate provider로 graph 후보를 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    const provider = new GraphRagCandidateProvider(
      new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA),
    );

    const candidates = await provider.getCandidates({
      question: 'Paul과 Barnabas 관계',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(provider.id).toBe('graph-rag');
    expect(candidates[0]?.source).toBe('graph-local');
  });
});

describe('planGraphQuery', () => {
  it('질문 유형을 규칙 기반으로 분류한다', () => {
    expect(planGraphQuery('근거가 어디에 있어?').type).toBe('source-seeking');
    expect(planGraphQuery('반복되는 핵심 주제는?').type).toBe('thematic');
    expect(planGraphQuery('A와 관련된 관계는?').type).toBe('relational');
    expect(planGraphQuery('평범한 질문').type).toBe('ordinary-rag');
  });
});

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
  await graphStore.upsertEntity(createEntity('Paul', ['Saul'], [evidence.id]));
  await graphStore.upsertEntity(createEntity('Barnabas', [], [evidence.id]));
  await graphStore.addRelation(createRelation(evidence.id));
  await graphStore.addClaim(createClaim(evidence.id));
  await vectorStore.add([createVectorEntry('Acts.md::1::0', 'Acts.md')]);
  return { graphStore, vectorStore };
}

async function createGraphFixtureWithCommunity(): Promise<{
  graphStore: InMemoryKnowledgeGraphStore;
  vectorStore: MemoryVectorStore;
}> {
  const fixture = await createGraphFixture();
  await fixture.graphStore.addCommunity({
    id: 'community::mission',
    ontologySchemaId: 'default',
    title: 'Mission conflict',
    entityIds: ['entity::general::person::paul'],
    relationIds: [],
    claimIds: [],
    summary: 'Paul and Barnabas missionary conflict',
    summaryVector: [1, 0],
    level: 0,
    updatedAt: 1,
  });
  return fixture;
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
