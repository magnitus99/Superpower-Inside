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
  type GraphExtractionJobRecord,
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

  it('InMemoryKnowledgeGraphStore가 파일 단위 graph pruning 계약을 만족한다', async () => {
    await expectGraphPruningContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 파일 단위 graph pruning 계약을 만족한다', async () => {
    await expectGraphPruningContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 entity 병합 시 graph 참조를 원자적으로 갱신한다', async () => {
    await expectPendingMergeResolutionContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 entity 병합 시 graph 참조를 원자적으로 갱신한다', async () => {
    await expectPendingMergeResolutionContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 분리 유지 결정을 기억한다', async () => {
    await expectKeepSeparateContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 분리 유지 결정을 기억한다', async () => {
    await expectKeepSeparateContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 만료된 extraction lease만 회수한다', async () => {
    await expectExpiredLeaseRecovery(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 만료된 extraction lease만 회수한다', async () => {
    await expectExpiredLeaseRecovery(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 provider 회로 상태를 보존한다', async () => {
    await expectProviderCircuitContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 provider 회로 상태를 보존한다', async () => {
    await expectProviderCircuitContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 community summary job을 보존한다', async () => {
    await expectCommunitySummaryJobContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 community summary job을 보존한다', async () => {
    await expectCommunitySummaryJobContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore가 global search job을 보존한다', async () => {
    await expectGlobalSearchJobContract(new InMemoryKnowledgeGraphStore());
  });

  it('IndexedDbKnowledgeGraphStore가 global search job을 보존한다', async () => {
    await expectGlobalSearchJobContract(createIndexedDbStore());
  });

  it('InMemoryKnowledgeGraphStore clear()는 모든 GraphRAG 테이블을 비웁니다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await fillGraphStoreForClearTest(store);

    await store.clear();

    await expectClearTables(store);
  });

  it('IndexedDbKnowledgeGraphStore clear()는 모든 GraphRAG 테이블을 비웁니다', async () => {
    const store = createIndexedDbStore();
    await fillGraphStoreForClearTest(store);

    await store.clear();

    await expectClearTables(store);
  });

  it('InMemoryKnowledgeGraphStore clear()는 비어 있는 상태에서도 예외 없이 성공합니다', async () => {
    const store = new InMemoryKnowledgeGraphStore();

    await expect(store.clear()).resolves.toBeUndefined();
    await expectClearTables(store);
  });

  it('IndexedDbKnowledgeGraphStore clear()는 비어 있는 상태에서도 예외 없이 성공합니다', async () => {
    const store = createIndexedDbStore();

    await expect(store.clear()).resolves.toBeUndefined();
    await expectClearTables(store);
  });

  it('IndexedDbKnowledgeGraphStore deleteDatabase()는 GraphRAG DB를 통째로 삭제합니다', async () => {
    const dbName = `SuperpowerInsideGraphStoreTest-${crypto.randomUUID()}`;
    dbNames.add(dbName);
    const store = new IndexedDbKnowledgeGraphStore(dbName);
    await fillGraphStoreForClearTest(store);

    await store.deleteDatabase();

    const reopened = new IndexedDbKnowledgeGraphStore(dbName);
    await expectClearTables(reopened);
  });
});

async function expectProviderCircuitContract(store: KnowledgeGraphStore): Promise<void> {
  await store.putProviderCircuit({
    providerEpochId: 'provider-epoch',
    consecutiveFailures: 3,
    state: 'open',
    openUntil: 10_000,
    lastErrorCode: 'http-429',
    updatedAt: 1_000,
  });
  await expect(store.getProviderCircuit('provider-epoch')).resolves.toEqual({
    providerEpochId: 'provider-epoch',
    consecutiveFailures: 3,
    state: 'open',
    openUntil: 10_000,
    lastErrorCode: 'http-429',
    updatedAt: 1_000,
  });
}

async function expectCommunitySummaryJobContract(store: KnowledgeGraphStore): Promise<void> {
  const job = {
    id: 'summary-job',
    communityKey: 'community-key',
    memberHash: 'members',
    childReportHash: 'children',
    level: 1,
    promptHash: 'prompt',
    providerEpochId: 'provider',
    state: 'response-received' as const,
    rawResponseId: 'response',
    updatedAt: 100,
  };
  await store.putCommunitySummaryJob(job);
  await expect(store.getCommunitySummaryJob(job.id)).resolves.toEqual(job);
}

async function expectGlobalSearchJobContract(store: KnowledgeGraphStore): Promise<void> {
  const job = {
    id: 'global-job',
    queryHash: 'query',
    phase: 'map' as const,
    communityId: 'community',
    providerEpochId: 'provider',
    state: 'response-received' as const,
    rawResponseId: 'response',
    updatedAt: 100,
  };
  await store.putGlobalSearchJob(job);
  await expect(store.getGlobalSearchJob(job.id)).resolves.toEqual(job);
}

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

  it('upsertEntity는 다국어 label metadata를 순서 보존 dedupe로 병합한다', async () => {
    const store = createIndexedDbStore();

    await store.upsertEntity(
      createEntity({
        aliases: [],
        labels: [
          {
            value: 'Paul',
            language: 'en',
            kind: 'preferred',
            source: 'llm-extraction',
            confidence: 0.8,
            evidenceIds: ['ev-1'],
          },
          {
            value: '바울',
            language: 'ko',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.8,
            evidenceIds: ['ev-1'],
          },
        ],
      }),
    );
    await store.upsertEntity(
      createEntity({
        aliases: [],
        labels: [
          {
            value: '바울',
            language: 'ko',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.9,
            evidenceIds: ['ev-2'],
          },
          {
            value: 'Saul',
            language: 'en',
            kind: 'alias',
            source: 'manual',
            confidence: 1,
            evidenceIds: [],
          },
        ],
      }),
    );

    await expect(store.getEntities()).resolves.toEqual([
      expect.objectContaining({
        labels: [
          {
            value: 'Paul',
            language: 'en',
            kind: 'preferred',
            source: 'llm-extraction',
            confidence: 0.8,
            evidenceIds: ['ev-1'],
          },
          {
            value: '바울',
            language: 'ko',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.9,
            evidenceIds: ['ev-1', 'ev-2'],
          },
          {
            value: 'Saul',
            language: 'en',
            kind: 'alias',
            source: 'manual',
            confidence: 1,
            evidenceIds: [],
          },
        ],
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
  const job = createExtractionJob();
  const rawResponse = {
    id: 'raw-1',
    requestFingerprint: job.requestFingerprint,
    providerEpochId: job.providerEpochId,
    body: '{"entities":[]}',
    bodyHash: 'body-hash',
    receivedAt: 1000,
  };
  await store.putExtractionJob(job);
  await store.putRawResponse(rawResponse);
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
  expect(await store.getEvidenceByIds(['ev-1', 'missing'])).toEqual([createEvidence()]);
  expect(await store.getRelationsForEntityIds(['entity-paul'])).toEqual([createRelation()]);
  expect(await store.getRelationsForEntityIds(['entity-corinth'], 'default')).toEqual([
    createRelation(),
  ]);
  expect(await store.getClaimsForEntityIds(['entity-paul'])).toEqual([createClaim()]);
  expect(await store.getCommunitiesBySchema('default')).toEqual([createCommunity()]);
  expect(await store.getRejectedFacts()).toEqual([
    expect.objectContaining({ id: 'reject-1', reason: 'schema' }),
  ]);
  expect(await store.getPendingEntityMerges()).toEqual([createPendingMerge()]);
  expect(await store.getExtractionJob(job.id)).toEqual(job);
  expect(await store.getExtractionJobs()).toEqual([job]);
  expect(await store.getRawResponse(rawResponse.id)).toEqual(rawResponse);
  expect(await store.getRawResponses()).toEqual([rawResponse]);

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

async function expectExpiredLeaseRecovery(store: KnowledgeGraphStore): Promise<void> {
  await store.putExtractionJob(
    createExtractionJob({
      id: 'expired',
      state: 'leased',
      leaseOwner: 'worker-old',
      leaseExpiresAt: 999,
    }),
  );
  await store.putExtractionJob(
    createExtractionJob({
      id: 'active',
      state: 'leased',
      leaseOwner: 'worker-current',
      leaseExpiresAt: 2000,
    }),
  );

  await expect(store.recoverExpiredExtractionJobs(1000)).resolves.toBe(1);
  await expect(store.getExtractionJob('expired')).resolves.toEqual(
    expect.objectContaining({
      state: 'prepared',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    }),
  );
  await expect(store.getExtractionJob('active')).resolves.toEqual(
    expect.objectContaining({ state: 'leased', leaseOwner: 'worker-current' }),
  );
}

async function fillGraphStoreForClearTest(store: KnowledgeGraphStore): Promise<void> {
  await store.putExtractionJob(createExtractionJob({ id: 'job-clear' }));
  await store.putRawResponse({
    id: 'raw-clear',
    requestFingerprint: 'fingerprint-clear',
    providerEpochId: 'epoch-1',
    body: '{}',
    bodyHash: 'body-clear',
    receivedAt: 1000,
  });
  await store.addEvidence(createEvidence({ id: 'ev-clear' }));
  await store.upsertEntity(createEntity({ id: 'entity-clear', evidenceIds: ['ev-clear'] }));
  await store.addRelation(createRelation({ id: 'rel-clear', evidenceIds: ['ev-clear'] }));
  await store.addClaim(createClaim({ id: 'claim-clear', evidenceIds: ['ev-clear'] }));
  await store.addCommunity(createCommunity({ id: 'community-clear' }));
  await store.addRejectedFact({
    id: 'reject-clear',
    filePath: 'note.md',
    entryId: 'note.md::0',
    reason: 'schema',
    rawFact: { bad: true },
    updatedAt: 1000,
  });
  await store.addPendingEntityMerge({
    id: 'merge-clear',
    ontologySchemaId: 'default',
    existingEntityId: 'entity-clear',
    candidateEntityId: 'entity-other',
    mergeScore: 0.9,
    reason: 'merge test',
    updatedAt: 1000,
  });
  await store.markExtractionCached({
    entryId: 'note.md::0',
    contentHash: 'hash-clear',
    extractionModelKey: 'openai:gpt-4.1-mini',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    updatedAt: 1000,
  });
}

async function expectClearTables(store: KnowledgeGraphStore): Promise<void> {
  await expect(store.getEvidence()).resolves.toEqual([]);
  await expect(store.getEntities()).resolves.toEqual([]);
  await expect(store.getRelations()).resolves.toEqual([]);
  await expect(store.getClaims()).resolves.toEqual([]);
  await expect(store.getCommunities()).resolves.toEqual([]);
  await expect(store.getRejectedFacts()).resolves.toEqual([]);
  await expect(store.getPendingEntityMerges()).resolves.toEqual([]);
  await expect(store.getExtractionCacheRecords()).resolves.toEqual([]);
  await expect(store.getExtractionJobs()).resolves.toEqual([]);
  await expect(store.getRawResponses()).resolves.toEqual([]);
  await expect(
    store.isExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-clear',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
    }),
  ).resolves.toBe(false);
}

async function expectGraphPruningContract(store: KnowledgeGraphStore): Promise<void> {
  await store.addEvidence(createEvidence({ id: 'ev-old', filePath: 'old.md', entryId: 'old.md::0' }));
  await store.addEvidence(createEvidence({ id: 'ev-keep', filePath: 'keep.md', entryId: 'keep.md::0' }));
  await store.upsertEntity(createEntity({ id: 'entity-old', evidenceIds: ['ev-old'] }));
  await store.upsertEntity(createEntity({ id: 'entity-shared', evidenceIds: ['ev-old', 'ev-keep'] }));
  await store.upsertEntity(createEntity({ id: 'entity-keep', evidenceIds: ['ev-keep'] }));
  await store.addRelation(createRelation({ id: 'rel-old', sourceEntityId: 'entity-old', targetEntityId: 'entity-shared', evidenceIds: ['ev-old'] }));
  await store.addRelation(createRelation({ id: 'rel-shared', sourceEntityId: 'entity-shared', targetEntityId: 'entity-keep', evidenceIds: ['ev-old', 'ev-keep'] }));
  await store.addClaim(createClaim({ id: 'claim-old', entityIds: ['entity-old'], relationIds: ['rel-old'], evidenceIds: ['ev-old'] }));
  await store.addClaim(createClaim({ id: 'claim-shared', entityIds: ['entity-old', 'entity-shared', 'entity-keep'], relationIds: ['rel-old', 'rel-shared'], evidenceIds: ['ev-old', 'ev-keep'] }));
  await store.addCommunity(createCommunity({ id: 'community-old', entityIds: ['entity-old'], relationIds: ['rel-old'], claimIds: ['claim-old'] }));
  await store.addCommunity(createCommunity({ id: 'community-other-schema', ontologySchemaId: 'other' }));
  await store.addRejectedFact({ id: 'reject-old', filePath: 'old.md', entryId: 'old.md::0', reason: 'schema', rawFact: {}, updatedAt: 1000 });
  await store.addRejectedFact({ id: 'reject-keep', filePath: 'keep.md', entryId: 'keep.md::0', reason: 'schema', rawFact: {}, updatedAt: 1000 });
  await store.addPendingEntityMerge({
    id: 'merge-old',
    ontologySchemaId: 'default',
    existingEntityId: 'entity-old',
    candidateEntityId: 'entity-keep',
    mergeScore: 0.8,
    reason: 'similar alias',
    updatedAt: 1000,
  });
  await store.markExtractionCached({ entryId: 'old.md::0', contentHash: 'hash-old', extractionModelKey: 'model', ontologySchemaId: 'default', ontologyVersion: 1, updatedAt: 1000 });
  await store.markExtractionCached({ entryId: 'keep.md::0', contentHash: 'hash-keep', extractionModelKey: 'model', ontologySchemaId: 'default', ontologyVersion: 1, updatedAt: 1000 });

  const result = await store.pruneByFilePaths(['old.md']);

  expect(result).toEqual(expect.objectContaining({
    evidence: 1,
    entities: 1,
    relations: 1,
    claims: 1,
    communities: 1,
    extractionCache: 1,
    rejectedFacts: 1,
    pendingEntityMerges: 1,
  }));
  expect((await store.getEvidence()).map((record) => record.id)).toEqual(['ev-keep']);
  expect(sortPairs((await store.getEntities()).map((record) => [record.id, record.evidenceIds]))).toEqual([
    ['entity-keep', ['ev-keep']],
    ['entity-shared', ['ev-keep']],
  ]);
  expect(sortPairs((await store.getRelations()).map((record) => [record.id, record.evidenceIds]))).toEqual([
    ['rel-shared', ['ev-keep']],
  ]);
  expect(await store.getClaims()).toEqual([
    expect.objectContaining({
      id: 'claim-shared',
      entityIds: ['entity-shared', 'entity-keep'],
      relationIds: ['rel-shared'],
      evidenceIds: ['ev-keep'],
    }),
  ]);
  expect((await store.getCommunities()).map((record) => record.id)).toEqual(['community-other-schema']);
  expect((await store.getRejectedFacts()).map((record) => record.id)).toEqual(['reject-keep']);
  await expect(store.isExtractionCached({ entryId: 'old.md::0', contentHash: 'hash-old', extractionModelKey: 'model', ontologySchemaId: 'default', ontologyVersion: 1 })).resolves.toBe(false);
  await expect(store.isExtractionCached({ entryId: 'keep.md::0', contentHash: 'hash-keep', extractionModelKey: 'model', ontologySchemaId: 'default', ontologyVersion: 1 })).resolves.toBe(true);
  expect(await store.getPendingEntityMerges()).toEqual([]);

  await store.replaceCommunities('default', [createCommunity({ id: 'community-new' })]);
  expect((await store.getCommunities()).map((record) => record.id).sort()).toEqual([
    'community-new',
    'community-other-schema',
  ]);
  await store.replaceCommunities('default', []);
  expect((await store.getCommunities()).map((record) => record.id)).toEqual(['community-other-schema']);
}

async function expectPendingMergeResolutionContract(store: KnowledgeGraphStore): Promise<void> {
  await store.upsertEntity(
    createEntity({
      id: 'entity-paul',
      aliases: ['Paul'],
      evidenceIds: ['ev-1'],
      confidence: 0.7,
    }),
  );
  await store.upsertEntity(
    createEntity({
      id: 'entity-paul-2',
      canonicalName: '바오로',
      aliases: ['바오로'],
      evidenceIds: ['ev-2'],
      confidence: 0.9,
    }),
  );
  await store.addRelation(
    createRelation({ sourceEntityId: 'entity-paul-2', targetEntityId: 'entity-paul' }),
  );
  await store.addClaim(
    createClaim({ entityIds: ['entity-paul', 'entity-paul-2', 'entity-paul'] }),
  );
  await store.addCommunity(
    createCommunity({ entityIds: ['entity-paul-2', 'entity-paul'] }),
  );
  await store.addPendingEntityMerge(createPendingMerge());

  await expect(store.resolvePendingEntityMerge('merge-1', 'merge')).resolves.toBe(true);

  await expect(store.getEntities()).resolves.toEqual([
    expect.objectContaining({
      id: 'entity-paul',
      aliases: ['Paul', '바오로'],
      evidenceIds: ['ev-1', 'ev-2'],
      confidence: 0.9,
    }),
  ]);
  await expect(store.getRelations()).resolves.toEqual([
    expect.objectContaining({ sourceEntityId: 'entity-paul', targetEntityId: 'entity-paul' }),
  ]);
  await expect(store.getClaims()).resolves.toEqual([
    expect.objectContaining({ entityIds: ['entity-paul'] }),
  ]);
  await expect(store.getCommunities()).resolves.toEqual([
    expect.objectContaining({ entityIds: ['entity-paul'] }),
  ]);
  await expect(store.getPendingEntityMerges()).resolves.toEqual([]);
}

async function expectKeepSeparateContract(store: KnowledgeGraphStore): Promise<void> {
  await store.upsertEntity(createEntity({ id: 'entity-paul' }));
  await store.upsertEntity(createEntity({ id: 'entity-paul-2', canonicalName: '바오로' }));
  const pending = createPendingMerge();
  await store.addPendingEntityMerge(pending);

  await expect(store.resolvePendingEntityMerge(pending.id, 'separate')).resolves.toBe(true);
  await expect(store.getPendingEntityMerges()).resolves.toEqual([]);

  await store.addPendingEntityMerge({ ...pending, updatedAt: 2000 });
  await store.addPendingEntityMerge({
    ...pending,
    id: 'merge-reversed',
    existingEntityId: pending.candidateEntityId,
    candidateEntityId: pending.existingEntityId,
    updatedAt: 3000,
  });
  await expect(store.getPendingEntityMerges()).resolves.toEqual([]);
  await expect(store.getEntities()).resolves.toHaveLength(2);
}

function sortPairs<T>(pairs: Array<[string, T]>): Array<[string, T]> {
  return [...pairs].sort((a, b) => a[0].localeCompare(b[0]));
}

function createEvidence(overrides: Partial<GraphEvidenceRecord> = {}): GraphEvidenceRecord {
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
    ...overrides,
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

function createRelation(overrides: Partial<GraphRelationRecord> = {}): GraphRelationRecord {
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
    ...overrides,
  };
}

function createClaim(overrides: Partial<GraphClaimRecord> = {}): GraphClaimRecord {
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
    ...overrides,
  };
}

function createCommunity(overrides: Partial<GraphCommunityRecord> = {}): GraphCommunityRecord {
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
    ...overrides,
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

function createExtractionJob(
  overrides: Partial<GraphExtractionJobRecord> = {},
): GraphExtractionJobRecord {
  return {
    id: 'job-1',
    requestFingerprint: 'fingerprint-1',
    entryId: 'note.md::0',
    filePath: 'note.md',
    contentHash: 'hash-a',
    contractVersion: 1,
    providerKey: 'openai',
    requestedModel: 'gpt-4.1-mini',
    providerEpochId: 'epoch-1',
    state: 'prepared',
    attemptCount: 0,
    updatedAt: 1000,
    ...overrides,
  };
}
