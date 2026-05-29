import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbKnowledgeGraphStore,
  InMemoryKnowledgeGraphStore,
  type GraphClaimRecord,
  type GraphCommunityRecord,
  type GraphEntityRecord,
  type GraphEvidenceRecord,
  type GraphRelationRecord,
  type KnowledgeGraphStore,
  type PendingEntityMergeRecord,
} from './store';

const dbNames = new Set<string>();

describe('KnowledgeGraphStore contract', () => {
  afterEach(async () => {
    await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
    dbNames.clear();
  });

  it('InMemoryKnowledgeGraphStore가 공통 저장소 계약을 만족한다', async () => {
    await expectKnowledgeGraphStoreContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 공통 저장소 계약을 만족한다', async () => {
    await expectKnowledgeGraphStoreContract(createIndexedDbStore());
  });
});

describe('IndexedDbKnowledgeGraphStore', () => {
  afterEach(async () => {
    await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
    dbNames.clear();
  });

  it('extraction cache는 파일 hash, 모델, ontology schema/version이 모두 같을 때만 hit 처리한다', async () => {
    const store = createIndexedDbStore();
    await store.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      updatedAt: 1000,
    });

    await expect(
      store.isExtractionCached({
        entryId: 'note.md::0',
        contentHash: 'hash-a',
        extractionModelKey: 'openai:gpt-4.1-mini',
        ontologySchemaId: 'default',
        ontologyVersion: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      store.isExtractionCached({
        entryId: 'note.md::0',
        contentHash: 'hash-b',
        extractionModelKey: 'openai:gpt-4.1-mini',
        ontologySchemaId: 'default',
        ontologyVersion: 1,
      }),
    ).resolves.toBe(false);
    await expect(
      store.isExtractionCached({
        entryId: 'note.md::0',
        contentHash: 'hash-a',
        extractionModelKey: 'openai:gpt-4.1',
        ontologySchemaId: 'default',
        ontologyVersion: 1,
      }),
    ).resolves.toBe(false);
    await expect(
      store.isExtractionCached({
        entryId: 'note.md::0',
        contentHash: 'hash-a',
        extractionModelKey: 'openai:gpt-4.1-mini',
        ontologySchemaId: 'legacy-schema',
        ontologyVersion: 1,
      }),
    ).resolves.toBe(false);
  });

  it('upsertEntity는 alias와 evidence를 보존 병합한다', async () => {
    const store = createIndexedDbStore();

    await store.upsertEntity(createEntity({ aliases: ['Paul'], evidenceIds: ['ev-1'], confidence: 0.6 }));
    await store.upsertEntity(
      createEntity({
        aliases: ['Paul', 'Apostle Paul'],
        evidenceIds: ['ev-1', 'ev-2'],
        description: 'updated',
        confidence: 0.9,
        updatedAt: 2000,
      }),
    );

    await expect(store.getEntities()).resolves.toEqual([
      expect.objectContaining({
        aliases: ['Paul', 'Apostle Paul'],
        description: 'updated',
        confidence: 0.9,
        evidenceIds: ['ev-1', 'ev-2'],
        updatedAt: 2000,
      }),
    ]);
  });
});

function createIndexedDbStore(): IndexedDbKnowledgeGraphStore {
  const dbName = `SuperpowerInsideGraphStoreTest-${crypto.randomUUID()}`;
  dbNames.add(dbName);
  return new IndexedDbKnowledgeGraphStore(dbName);
}

async function expectKnowledgeGraphStoreContract(store: KnowledgeGraphStore): Promise<void> {
  await store.addEvidence(createEvidence());
  await store.upsertEntity(createEntity());
  await store.addRelation(createRelation());
  await store.addClaim(createClaim());
  await store.addCommunity(createCommunity());
  await store.addRejectedFact({
    id: 'reject-1',
    filePath: 'note.md',
    entryId: 'note.md::0',
    reason: 'schema',
    rawFact: { bad: true },
    updatedAt: 1000,
  });
  await store.addPendingEntityMerge(createPendingMerge());

  expect(await store.getEvidence()).toEqual([createEvidence()]);
  expect(await store.getEntities()).toEqual([createEntity()]);
  expect(await store.getRelations()).toEqual([createRelation()]);
  expect(await store.getClaims()).toEqual([createClaim()]);
  expect(await store.getCommunities()).toEqual([createCommunity()]);
  expect(await store.getRejectedFacts()).toEqual([
    expect.objectContaining({ id: 'reject-1', reason: 'schema' }),
  ]);
  expect(await store.getPendingEntityMerges()).toEqual([createPendingMerge()]);

  await store.markExtractionCached({
    entryId: 'note.md::0',
    contentHash: 'hash-a',
    extractionModelKey: 'openai:gpt-4.1-mini',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    updatedAt: 1000,
  });

  await expect(
    store.isExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
    }),
  ).resolves.toBe(true);
}

function createEvidence(): GraphEvidenceRecord {
  return {
    id: 'ev-1',
    filePath: 'note.md',
    entryId: 'note.md::0',
    startLine: 1,
    endLine: 2,
    quote: 'Paul visited Corinth.',
    contentHash: 'hash-a',
    extractionModelKey: 'openai:gpt-4.1-mini',
    updatedAt: 1000,
  };
}

function createEntity(overrides: Partial<GraphEntityRecord> = {}): GraphEntityRecord {
  return {
    id: 'entity-paul',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'person',
    canonicalName: 'Paul',
    aliases: ['Paul'],
    description: 'apostle',
    properties: { era: 'first-century' },
    confidence: 0.8,
    evidenceIds: ['ev-1'],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function createRelation(): GraphRelationRecord {
  return {
    id: 'rel-1',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId: 'visited',
    sourceEntityId: 'entity-paul',
    targetEntityId: 'entity-corinth',
    description: 'visited Corinth',
    properties: {},
    confidence: 0.7,
    evidenceIds: ['ev-1'],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function createClaim(): GraphClaimRecord {
  return {
    id: 'claim-1',
    claimTypeId: 'fact',
    text: 'Paul visited Corinth.',
    entityIds: ['entity-paul'],
    relationIds: ['rel-1'],
    stance: 'supports',
    confidence: 0.7,
    evidenceIds: ['ev-1'],
    updatedAt: 1000,
  };
}

function createCommunity(): GraphCommunityRecord {
  return {
    id: 'community-1',
    ontologySchemaId: 'default',
    title: 'Paul network',
    entityIds: ['entity-paul'],
    relationIds: ['rel-1'],
    claimIds: ['claim-1'],
    summary: 'Paul related passages.',
    summaryVector: [1, 0],
    level: 0,
    updatedAt: 1000,
  };
}

function createPendingMerge(): PendingEntityMergeRecord {
  return {
    id: 'merge-1',
    ontologySchemaId: 'default',
    existingEntityId: 'entity-paul',
    candidateEntityId: 'entity-paul-2',
    mergeScore: 0.8,
    reason: 'similar alias',
    updatedAt: 1000,
  };
}
