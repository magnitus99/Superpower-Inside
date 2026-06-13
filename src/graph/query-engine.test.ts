import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { MemoryVectorStore, type VectorEntry } from '../rag/store';
import {
  GraphRagCandidateProvider,
  GraphRagQueryEngine,
  LLMGraphQueryPlanner,
  planGraphQuery,
} from './query-engine';
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

  it('엔티티 언급이 없는 evidence-first 질문은 claim confidence 기반 Rust evidence plan으로 정렬한다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    const vectorStore = new MemoryVectorStore();
    await graphStore.addEvidence({
      id: 'evidence::low',
      filePath: 'low.md',
      entryId: 'low.md::0',
      startLine: 0,
      endLine: 0,
      quote: 'Low confidence evidence.',
      contentHash: 'hash-low',
      extractionModelKey: 'model',
      updatedAt: 1,
    });
    await graphStore.addEvidence({
      id: 'evidence::high',
      filePath: 'high.md',
      entryId: 'high.md::0',
      startLine: 0,
      endLine: 0,
      quote: 'High confidence evidence.',
      contentHash: 'hash-high',
      extractionModelKey: 'model',
      updatedAt: 1,
    });
    await graphStore.addClaim(createClaimWithEvidence('claim::low', 'evidence::low', 0.4));
    await graphStore.addClaim(createClaimWithEvidence('claim::high', 'evidence::high', 0.95));
    await vectorStore.add([
      createVectorEntry('low.md::0', 'low.md'),
      createVectorEntry('high.md::0', 'high.md'),
    ]);
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: '근거를 보여줘',
      queryVector: [1, 0],
      candidateLimit: 2,
    });

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual([
      'high.md',
      'low.md',
    ]);
    expect(candidates.map((candidate) => candidate.source)).toEqual(['evidence', 'evidence']);
    expect(candidates[0]?.sourceScore).toBeCloseTo(0.95 * 0.75);
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

  it('hybrid 후보 병합은 Rust plan 기준으로 중복 entry를 제거하고 limit을 적용한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    await graphStore.addCommunity({
      id: 'Acts.md::1::0',
      ontologySchemaId: 'default',
      title: 'Duplicate evidence summary',
      entityIds: ['entity::general::person::paul'],
      relationIds: [],
      claimIds: [],
      summary: 'Paul and Barnabas missionary conflict',
      summaryVector: [1, 0],
      level: 0,
      updatedAt: 1,
    });
    await graphStore.addCommunity({
      id: 'community::theme',
      ontologySchemaId: 'default',
      title: 'Mission theme',
      entityIds: ['entity::general::person::paul'],
      relationIds: [],
      claimIds: [],
      summary: 'A second community summary',
      summaryVector: [0.9, 0.1],
      level: 0,
      updatedAt: 1,
    });
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryMode: 'hybrid',
    });

    const candidates = await engine.query({
      question: 'Paul과 Barnabas 관계와 핵심 주제를 같이 보여줘',
      queryVector: [1, 0],
      candidateLimit: 2,
    });

    expect(candidates.map((candidate) => candidate.entry.id)).toEqual([
      'Acts.md::1::0',
      'community::theme',
    ]);
    expect(candidates.map((candidate) => candidate.source)).toEqual([
      'graph-local',
      'graph-global',
    ]);
  });

  it('auto mode의 comparative 질문은 local evidence와 global summary를 함께 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixtureWithCommunity();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: 'Paul과 Barnabas의 차이를 비교해줘',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(
      expect.arrayContaining(['graph-local', 'graph-global']),
    );
  });

  it('한국어 alias와 planner entity hint로 local evidence 후보를 찾는다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryPlanner: {
        plan: () =>
          Promise.resolve({
            type: 'relational',
            queryMode: 'local',
            traversalDepth: 1,
            evidenceFirst: false,
            entityHints: ['바울', '바나바'],
          }),
      },
    });

    const candidates = await engine.query({
      question: '바울과 바나바는 어떤 관계야?',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates[0]?.entry.metadata.filePath).toBe('Acts.md');
    expect(candidates[0]?.sourceScore).toBeGreaterThan(0.7);
  });

  it('짧은 이름은 단어 경계 없이 부분 문자열로 오탐하지 않는다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    const vectorStore = new MemoryVectorStore();
    await graphStore.addEvidence({
      id: 'evidence::short',
      filePath: 'short.md',
      entryId: 'short.md::0',
      startLine: 0,
      endLine: 0,
      quote: 'A is mentioned.',
      contentHash: 'hash',
      extractionModelKey: 'model',
      updatedAt: 1,
    });
    await graphStore.upsertEntity(createEntity('A', [], ['evidence::short']));
    await vectorStore.add([createVectorEntry('short.md::0', 'short.md')]);
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA);

    const candidates = await engine.query({
      question: 'Apostle에 대해 알려줘',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates).toEqual([]);
  });

  it('traversalDepth 2이면 직접 언급 엔티티의 이웃 relation evidence까지 반환한다', async () => {
    const { graphStore, vectorStore } = await createGraphFixture();
    const secondEvidence: GraphEvidenceRecord = {
      id: 'evidence::mark',
      filePath: 'Mark.md',
      entryId: 'Mark.md::0',
      startLine: 0,
      endLine: 0,
      quote: 'Barnabas worked with Mark.',
      contentHash: 'hash-mark',
      extractionModelKey: 'model',
      updatedAt: 1,
    };
    await graphStore.addEvidence(secondEvidence);
    await graphStore.upsertEntity(createEntity('Mark', [], [secondEvidence.id]));
    await graphStore.addRelation({
      id: 'relation::barnabas-mark',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      relationTypeId: 'collaborated_with',
      sourceEntityId: 'entity::general::person::barnabas',
      targetEntityId: 'entity::general::person::mark',
      description: 'Barnabas worked with Mark.',
      properties: {},
      confidence: 0.8,
      evidenceIds: [secondEvidence.id],
      createdAt: 1,
      updatedAt: 1,
    });
    await vectorStore.add([createVectorEntry('Mark.md::0', 'Mark.md')]);
    const engine = new GraphRagQueryEngine(graphStore, vectorStore, DEFAULT_ONTOLOGY_SCHEMA, {
      queryPlanner: {
        plan: () =>
          Promise.resolve({
            type: 'relational',
            queryMode: 'local',
            traversalDepth: 2,
            evidenceFirst: false,
            entityHints: ['Paul'],
          }),
      },
    });

    const candidates = await engine.query({
      question: 'Paul과 관련된 관계를 넓게 보여줘',
      queryVector: [1, 0],
      candidateLimit: 5,
    });

    expect(candidates.map((candidate) => candidate.entry.metadata.filePath)).toEqual(
      expect.arrayContaining(['Acts.md', 'Mark.md']),
    );
    expect(candidates.find((candidate) => candidate.entry.metadata.filePath === 'Acts.md')?.sourceScore)
      .toBeGreaterThan(candidates.find((candidate) => candidate.entry.metadata.filePath === 'Mark.md')?.sourceScore ?? 0);
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

describe('LLMGraphQueryPlanner', () => {
  it('LLM planner 응답의 JSON 추출, 필드 정규화, fallback은 Rust bridge를 따른다', async () => {
    const planner = new LLMGraphQueryPlanner(
      createPlannerProvider(
        '응답입니다.\n```json\n{"type":"relational","queryMode":"hybrid","traversalDepth":2.8,"evidenceFirst":true,"entityHints":["Paul",3," ","Barnabas"]}\n```',
      ),
    );

    await expect(planner.plan('평범한 질문', DEFAULT_ONTOLOGY_SCHEMA)).resolves.toEqual({
      type: 'relational',
      queryMode: 'hybrid',
      traversalDepth: 2,
      evidenceFirst: true,
      entityHints: ['Paul', 'Barnabas'],
    });

    const fallbackPlanner = new LLMGraphQueryPlanner(createPlannerProvider('not-json'));

    await expect(
      fallbackPlanner.plan('근거가 어디에 있어?', DEFAULT_ONTOLOGY_SCHEMA),
    ).resolves.toEqual(
      expect.objectContaining({
        type: 'source-seeking',
        queryMode: 'local',
        evidenceFirst: true,
      }),
    );
  });
});

describe('planGraphQuery', () => {
  it('질문 유형과 graph 탐색 전략을 함께 계획한다', () => {
    expect(planGraphQuery('근거가 어디에 있어?')).toEqual(
      expect.objectContaining({
        type: 'source-seeking',
        queryMode: 'local',
        evidenceFirst: true,
      }),
    );
    expect(planGraphQuery('반복되는 핵심 주제는?')).toEqual(
      expect.objectContaining({
        type: 'thematic',
        queryMode: 'global',
      }),
    );
    expect(planGraphQuery('A와 관련된 관계는?')).toEqual(
      expect.objectContaining({
        type: 'relational',
        queryMode: 'local',
        traversalDepth: 2,
      }),
    );
    expect(planGraphQuery('Paul과 Barnabas의 차이를 비교해줘')).toEqual(
      expect.objectContaining({
        type: 'comparative',
        queryMode: 'hybrid',
        traversalDepth: 2,
        entityHints: ['Paul', 'Barnabas'],
      }),
    );
    expect(planGraphQuery('평범한 질문')).toEqual(
      expect.objectContaining({
        type: 'ordinary-rag',
        queryMode: 'none',
      }),
    );
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
  await graphStore.upsertEntity(createEntity('Paul', ['Saul', '바울'], [evidence.id]));
  await graphStore.upsertEntity(createEntity('Barnabas', ['바나바'], [evidence.id]));
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

function createClaimWithEvidence(
  id: string,
  evidenceId: string,
  confidence: number,
): GraphClaimRecord {
  return {
    id,
    claimTypeId: 'factual_claim',
    text: `Claim ${id}`,
    entityIds: [],
    relationIds: [],
    stance: 'neutral',
    confidence,
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

function createPlannerProvider(response: string): LLMProvider {
  return {
    chat: () => Promise.resolve(response),
    streamChat: () => Promise.resolve(),
  };
}
