import { describe, expect, it } from 'vitest';
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
});

function createEntity(input: {
  canonicalName: string;
  typeId?: string;
  aliases?: string[];
}): GraphEntityRecord {
  const typeId = input.typeId ?? 'person';
  return {
    id: `entity::default::${typeId}::${normalizeEntityName(input.canonicalName).replaceAll(' ', '-')}`,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId,
    canonicalName: input.canonicalName,
    aliases: input.aliases ?? [],
    description: '',
    properties: {},
    confidence: 0.8,
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
