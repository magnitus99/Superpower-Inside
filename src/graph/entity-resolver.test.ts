import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { EntityResolver, normalizeEntityName } from './entity-resolver';
import { InMemoryKnowledgeGraphStore, type GraphEntityRecord } from './store';

describe('EntityResolver', () => {
  it('canonical name을 비교 가능한 형태로 정규화한다', () => {
    expect(normalizeEntityName('  Saul / Paul  ')).toBe('saul paul');
  });

  it('기존 entity alias와 exact match되면 자동 merge 대상으로 resolve한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({ canonicalName: 'Paul', aliases: ['Saul'] }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.88,
      pendingMergeThreshold: 0.72,
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'person',
      canonicalName: 'Saul',
      aliases: [],
      description: 'Apostle',
    });

    expect(result.status).toBe('auto-merge');
    expect(result.entityId).toBe('entity::default::person::paul');
    expect(result.mergeScore).toBeGreaterThanOrEqual(0.88);
  });

  it('type이 다르면 이름이 같아도 자동 merge하지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({ canonicalName: 'Jordan', typeId: 'person' }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.88,
      pendingMergeThreshold: 0.72,
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'place',
      canonicalName: 'Jordan',
      aliases: [],
      description: 'A place',
    });

    expect(result.status).toBe('new');
    expect(result.entityId).toBe('entity::default::place::jordan');
  });

  it('merge score가 pending threshold 이상이면 pending merge로 저장한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({ canonicalName: 'Paul the Apostle', aliases: [] }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.95,
      pendingMergeThreshold: 0.5,
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'person',
      canonicalName: 'Paul Apostle',
      aliases: [],
      description: 'Apostle',
    });

    expect(result.status).toBe('pending-merge');
    expect(result.entityId).toBe('entity::default::person::paul-apostle');
    expect(await store.getPendingEntityMerges()).toEqual([
      expect.objectContaining({
        existingEntityId: 'entity::default::person::paul-the-apostle',
        candidateEntityId: 'entity::default::person::paul-apostle',
      }),
    ]);
  });

  it('alias 부분 일치와 설명 토큰으로 중복 가능성이 높은 entity를 pending merge로 남긴다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({
      canonicalName: 'Paul',
      aliases: ['Saul'],
      description: 'Apostle missionary',
    }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.88,
      pendingMergeThreshold: 0.5,
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'person',
      canonicalName: 'Saul of Tarsus',
      aliases: [],
      description: 'Apostle Paul missionary',
    });

    expect(result.status).toBe('pending-merge');
    expect(result.matchedEntityId).toBe('entity::default::person::paul');
  });

  it('공통 evidence가 있으면 이름 순서가 다른 entity를 더 강한 병합 후보로 본다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({
      canonicalName: 'Paul the Apostle',
      evidenceIds: ['evidence::acts'],
    }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.88,
      pendingMergeThreshold: 0.72,
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'person',
      canonicalName: 'Apostle Paul',
      aliases: [],
      description: '',
      evidenceIds: ['evidence::acts'],
    });

    expect(result.status).toBe('pending-merge');
    expect(result.mergeScore).toBeGreaterThanOrEqual(0.72);
  });

  it('선택적 임베딩 유사도가 높으면 의미상 가까운 entity를 pending merge로 남긴다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity({
      canonicalName: 'Grace',
      typeId: 'concept',
      description: 'divine favor and mercy',
    }));
    const resolver = new EntityResolver(store, {
      autoMergeThreshold: 0.92,
      pendingMergeThreshold: 0.72,
      embeddingProvider: createEmbeddingProvider(),
    });

    const result = await resolver.resolve({
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
      typeId: 'concept',
      canonicalName: 'Divine Mercy',
      aliases: [],
      description: 'divine favor and mercy',
    });

    expect(result.status).toBe('pending-merge');
    expect(result.matchedEntityId).toBe('entity::default::concept::grace');
  });
});

function createEntity(input: {
  canonicalName: string;
  typeId?: string;
  aliases?: string[];
  description?: string;
  evidenceIds?: string[];
}): GraphEntityRecord {
  const typeId = input.typeId ?? 'person';
  return {
    id: `entity::default::${typeId}::${normalizeEntityName(input.canonicalName).replaceAll(' ', '-')}`,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId,
    canonicalName: input.canonicalName,
    aliases: input.aliases ?? [],
    description: input.description ?? '',
    properties: {},
    confidence: 0.8,
    evidenceIds: input.evidenceIds ?? [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: (text: string) => Promise.resolve(text.includes('Grace') || text.includes('Mercy') ? [1, 0] : [0, 1]),
    embedBatch: (texts: string[]) =>
      Promise.resolve(texts.map((text) => (text.includes('Grace') || text.includes('Mercy') ? [1, 0] : [0, 1]))),
  };
}
