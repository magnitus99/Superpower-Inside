import Dexie from 'dexie';

export type GraphPropertyValue = string | number | boolean;
export type GraphClaimStance = 'supports' | 'opposes' | 'neutral' | 'interprets';

export interface GraphEntityRecord {
  id: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  typeId: string;
  canonicalName: string;
  aliases: string[];
  description: string;
  properties: Record<string, GraphPropertyValue>;
  confidence: number;
  evidenceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GraphRelationRecord {
  id: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  relationTypeId: string;
  sourceEntityId: string;
  targetEntityId: string;
  description: string;
  properties: Record<string, GraphPropertyValue>;
  confidence: number;
  evidenceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GraphClaimRecord {
  id: string;
  claimTypeId: string;
  text: string;
  entityIds: string[];
  relationIds: string[];
  stance?: GraphClaimStance;
  confidence: number;
  evidenceIds: string[];
  updatedAt: number;
}

export interface GraphEvidenceRecord {
  id: string;
  filePath: string;
  entryId: string;
  startLine: number;
  endLine?: number;
  quote: string;
  contentHash: string;
  extractionModelKey: string;
  updatedAt: number;
}

export interface GraphCommunityRecord {
  id: string;
  ontologySchemaId: string;
  title: string;
  entityIds: string[];
  relationIds: string[];
  claimIds: string[];
  summary: string;
  summaryVector: number[];
  level: number;
  parentCommunityId?: string;
  updatedAt: number;
}

export interface GraphRejectedFactRecord {
  id: string;
  filePath: string;
  entryId: string;
  reason: string;
  rawFact: unknown;
  updatedAt: number;
}

export interface GraphExtractionCacheRecord {
  entryId: string;
  contentHash: string;
  extractionModelKey: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  updatedAt: number;
}

export interface PendingEntityMergeRecord {
  id: string;
  ontologySchemaId: string;
  existingEntityId: string;
  candidateEntityId: string;
  mergeScore: number;
  reason: string;
  updatedAt: number;
}

export interface GraphPruneResult {
  evidence: number;
  entities: number;
  relations: number;
  claims: number;
  communities: number;
  extractionCache: number;
  rejectedFacts: number;
  pendingEntityMerges: number;
}

export interface KnowledgeGraphStore {
  isExtractionCached(input: Omit<GraphExtractionCacheRecord, 'updatedAt'>): Promise<boolean>;
  markExtractionCached(record: GraphExtractionCacheRecord): Promise<void>;
  getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]>;
  getEntities(limit?: number, offset?: number): Promise<GraphEntityRecord[]>;
  getRelations(limit?: number, offset?: number): Promise<GraphRelationRecord[]>;
  getClaims(limit?: number, offset?: number): Promise<GraphClaimRecord[]>;
  getEvidence(limit?: number, offset?: number): Promise<GraphEvidenceRecord[]>;
  getCommunities(limit?: number, offset?: number): Promise<GraphCommunityRecord[]>;
  addEvidence(record: GraphEvidenceRecord): Promise<void>;
  upsertEntity(record: GraphEntityRecord): Promise<void>;
  addPendingEntityMerge(record: PendingEntityMergeRecord): Promise<void>;
  addRelation(record: GraphRelationRecord): Promise<void>;
  addClaim(record: GraphClaimRecord): Promise<void>;
  addCommunity(record: GraphCommunityRecord): Promise<void>;
  addRejectedFact(record: GraphRejectedFactRecord): Promise<void>;
  getRejectedFacts(): Promise<GraphRejectedFactRecord[]>;
  getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]>;
  removeEvidenceByFilePaths(filePaths: readonly string[]): Promise<number>;
  removeExtractionCacheByEntryIds(entryIds: readonly string[]): Promise<number>;
  removeRejectedFactsByFilePaths(filePaths: readonly string[]): Promise<number>;
  pruneByFilePaths(filePaths: readonly string[]): Promise<GraphPruneResult>;
  replaceCommunities(
    ontologySchemaId: string,
    records: readonly GraphCommunityRecord[],
  ): Promise<void>;
}

class KnowledgeGraphDB extends Dexie {
  graphEntities!: Dexie.Table<GraphEntityRecord, string>;
  graphRelations!: Dexie.Table<GraphRelationRecord, string>;
  graphClaims!: Dexie.Table<GraphClaimRecord, string>;
  graphEvidence!: Dexie.Table<GraphEvidenceRecord, string>;
  graphCommunities!: Dexie.Table<GraphCommunityRecord, string>;
  graphRejectedFacts!: Dexie.Table<GraphRejectedFactRecord, string>;
  graphExtractionCache!: Dexie.Table<GraphExtractionCacheRecord, string>;
  graphPendingEntityMerges!: Dexie.Table<PendingEntityMergeRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      graphEntities: 'id, ontologySchemaId, typeId, canonicalName, updatedAt',
      graphRelations:
        'id, ontologySchemaId, relationTypeId, sourceEntityId, targetEntityId, updatedAt',
      graphClaims: 'id, claimTypeId, updatedAt',
      graphEvidence: 'id, filePath, entryId, contentHash, updatedAt',
      graphCommunities: 'id, ontologySchemaId, level, parentCommunityId, updatedAt',
      graphRejectedFacts: 'id, filePath, entryId, reason, updatedAt',
      graphExtractionCache:
        'entryId, contentHash, extractionModelKey, ontologySchemaId, ontologyVersion, updatedAt',
      graphPendingEntityMerges:
        'id, ontologySchemaId, existingEntityId, candidateEntityId, updatedAt',
    });
  }
}

/** Dexie/IndexedDB 기반 production knowledge graph 저장소 */
export class IndexedDbKnowledgeGraphStore implements KnowledgeGraphStore {
  private db: KnowledgeGraphDB;

  constructor(dbName = 'SuperpowerInsideKnowledgeGraphStore') {
    this.db = new KnowledgeGraphDB(dbName);
  }

  async isExtractionCached(input: Omit<GraphExtractionCacheRecord, 'updatedAt'>): Promise<boolean> {
    const cached = await this.db.graphExtractionCache.get(input.entryId);
    return (
      cached?.contentHash === input.contentHash &&
      cached.extractionModelKey === input.extractionModelKey &&
      cached.ontologySchemaId === input.ontologySchemaId &&
      cached.ontologyVersion === input.ontologyVersion
    );
  }

  async markExtractionCached(record: GraphExtractionCacheRecord): Promise<void> {
    await this.db.graphExtractionCache.put({ ...record });
  }

  async getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]> {
    return (await this.db.graphExtractionCache.toArray()).map((record) => ({ ...record }));
  }

  async addEvidence(record: GraphEvidenceRecord): Promise<void> {
    await this.db.graphEvidence.put({ ...record });
  }

  async upsertEntity(record: GraphEntityRecord): Promise<void> {
    await this.db.transaction('rw', this.db.graphEntities, async () => {
      const existing = await this.db.graphEntities.get(record.id);
      await this.db.graphEntities.put(existing ? mergeEntity(existing, record) : copyEntity(record));
    });
  }

  async addPendingEntityMerge(record: PendingEntityMergeRecord): Promise<void> {
    await this.db.graphPendingEntityMerges.put({ ...record });
  }

  async addRelation(record: GraphRelationRecord): Promise<void> {
    await this.db.graphRelations.put(copyRelation(record));
  }

  async addClaim(record: GraphClaimRecord): Promise<void> {
    await this.db.graphClaims.put(copyClaim(record));
  }

  async addCommunity(record: GraphCommunityRecord): Promise<void> {
    await this.db.graphCommunities.put(copyCommunity(record));
  }

  async replaceCommunities(
    ontologySchemaId: string,
    records: readonly GraphCommunityRecord[],
  ): Promise<void> {
    await this.db.transaction('rw', this.db.graphCommunities, async () => {
      const existing = await this.db.graphCommunities
        .where('ontologySchemaId')
        .equals(ontologySchemaId)
        .toArray();
      if (existing.length > 0) {
        await this.db.graphCommunities.bulkDelete(existing.map((record) => record.id));
      }
      if (records.length > 0) {
        await this.db.graphCommunities.bulkPut(records.map(copyCommunity));
      }
    });
  }

  async addRejectedFact(record: GraphRejectedFactRecord): Promise<void> {
    await this.db.graphRejectedFacts.put({ ...record });
  }

  async getEvidence(limit?: number, offset?: number): Promise<GraphEvidenceRecord[]> {
    let collection = this.db.graphEvidence.toCollection();
    if (offset !== undefined) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);
    return (await collection.toArray()).map((record) => ({ ...record }));
  }

  async getEntities(limit?: number, offset?: number): Promise<GraphEntityRecord[]> {
    let collection = this.db.graphEntities.toCollection();
    if (offset !== undefined) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);
    return (await collection.toArray()).map(copyEntity);
  }

  async getRelations(limit?: number, offset?: number): Promise<GraphRelationRecord[]> {
    let collection = this.db.graphRelations.toCollection();
    if (offset !== undefined) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);
    return (await collection.toArray()).map(copyRelation);
  }

  async getClaims(limit?: number, offset?: number): Promise<GraphClaimRecord[]> {
    let collection = this.db.graphClaims.toCollection();
    if (offset !== undefined) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);
    return (await collection.toArray()).map(copyClaim);
  }

  async getCommunities(limit?: number, offset?: number): Promise<GraphCommunityRecord[]> {
    let collection = this.db.graphCommunities.toCollection();
    if (offset !== undefined) collection = collection.offset(offset);
    if (limit !== undefined) collection = collection.limit(limit);
    return (await collection.toArray()).map(copyCommunity);
  }

  async getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return (await this.db.graphRejectedFacts.toArray()).map((record) => ({ ...record }));
  }

  async getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return (await this.db.graphPendingEntityMerges.toArray()).map((record) => ({ ...record }));
  }

  async removeEvidenceByFilePaths(filePaths: readonly string[]): Promise<number> {
    const pathSet = new Set(filePaths);
    const evidence = await this.db.graphEvidence.toArray();
    const toDelete = evidence.filter((e) => pathSet.has(e.filePath));
    if (toDelete.length === 0) return 0;
    await this.db.graphEvidence.bulkDelete(toDelete.map((e) => e.id));
    return toDelete.length;
  }

  async removeExtractionCacheByEntryIds(entryIds: readonly string[]): Promise<number> {
    const idSet = new Set(entryIds);
    const cache = await this.db.graphExtractionCache.toArray();
    const toDelete = cache.filter((c) => idSet.has(c.entryId));
    if (toDelete.length === 0) return 0;
    await this.db.graphExtractionCache.bulkDelete(toDelete.map((c) => c.entryId));
    return toDelete.length;
  }

  async removeRejectedFactsByFilePaths(filePaths: readonly string[]): Promise<number> {
    const pathSet = new Set(filePaths);
    const facts = await this.db.graphRejectedFacts.toArray();
    const toDelete = facts.filter((f) => pathSet.has(f.filePath));
    if (toDelete.length === 0) return 0;
    await this.db.graphRejectedFacts.bulkDelete(toDelete.map((f) => f.id));
    return toDelete.length;
  }

  async pruneByFilePaths(filePaths: readonly string[]): Promise<GraphPruneResult> {
    if (filePaths.length === 0) return emptyPruneResult();

    return this.db.transaction(
      'rw',
      [
        this.db.graphEvidence,
        this.db.graphEntities,
        this.db.graphRelations,
        this.db.graphClaims,
        this.db.graphCommunities,
        this.db.graphRejectedFacts,
        this.db.graphExtractionCache,
        this.db.graphPendingEntityMerges,
      ],
      async () => {
        const snapshot = createPrunedGraphSnapshot(filePaths, {
          evidence: await this.db.graphEvidence.toArray(),
          entities: await this.db.graphEntities.toArray(),
          relations: await this.db.graphRelations.toArray(),
          claims: await this.db.graphClaims.toArray(),
          communities: await this.db.graphCommunities.toArray(),
          rejectedFacts: await this.db.graphRejectedFacts.toArray(),
          extractionCache: await this.db.graphExtractionCache.toArray(),
          pendingEntityMerges: await this.db.graphPendingEntityMerges.toArray(),
        });

        if (snapshot.deletedEvidenceIds.length > 0) {
          await this.db.graphEvidence.bulkDelete(snapshot.deletedEvidenceIds);
        }
        if (snapshot.deletedEntityIds.length > 0) {
          await this.db.graphEntities.bulkDelete(snapshot.deletedEntityIds);
        }
        if (snapshot.updatedEntities.length > 0) {
          await this.db.graphEntities.bulkPut(snapshot.updatedEntities.map(copyEntity));
        }
        if (snapshot.deletedRelationIds.length > 0) {
          await this.db.graphRelations.bulkDelete(snapshot.deletedRelationIds);
        }
        if (snapshot.updatedRelations.length > 0) {
          await this.db.graphRelations.bulkPut(snapshot.updatedRelations.map(copyRelation));
        }
        if (snapshot.deletedClaimIds.length > 0) {
          await this.db.graphClaims.bulkDelete(snapshot.deletedClaimIds);
        }
        if (snapshot.updatedClaims.length > 0) {
          await this.db.graphClaims.bulkPut(snapshot.updatedClaims.map(copyClaim));
        }
        if (snapshot.deletedCommunityIds.length > 0) {
          await this.db.graphCommunities.bulkDelete(snapshot.deletedCommunityIds);
        }
        if (snapshot.deletedRejectedFactIds.length > 0) {
          await this.db.graphRejectedFacts.bulkDelete(snapshot.deletedRejectedFactIds);
        }
        if (snapshot.deletedExtractionCacheEntryIds.length > 0) {
          await this.db.graphExtractionCache.bulkDelete(snapshot.deletedExtractionCacheEntryIds);
        }
        if (snapshot.deletedPendingMergeIds.length > 0) {
          await this.db.graphPendingEntityMerges.bulkDelete(snapshot.deletedPendingMergeIds);
        }
        return snapshot.result;
      },
    );
  }
}

export class InMemoryKnowledgeGraphStore implements KnowledgeGraphStore {
  private evidence = new Map<string, GraphEvidenceRecord>();
  private entities = new Map<string, GraphEntityRecord>();
  private relations = new Map<string, GraphRelationRecord>();
  private claims = new Map<string, GraphClaimRecord>();
  private communities = new Map<string, GraphCommunityRecord>();
  private rejectedFacts = new Map<string, GraphRejectedFactRecord>();
  private extractionCache = new Map<string, GraphExtractionCacheRecord>();
  private pendingEntityMerges = new Map<string, PendingEntityMergeRecord>();

  isExtractionCached(input: Omit<GraphExtractionCacheRecord, 'updatedAt'>): Promise<boolean> {
    const cached = this.extractionCache.get(input.entryId);
    return Promise.resolve(
      cached?.contentHash === input.contentHash &&
        cached.extractionModelKey === input.extractionModelKey &&
        cached.ontologySchemaId === input.ontologySchemaId &&
        cached.ontologyVersion === input.ontologyVersion,
    );
  }

  markExtractionCached(record: GraphExtractionCacheRecord): Promise<void> {
    this.extractionCache.set(record.entryId, { ...record });
    return Promise.resolve();
  }

  getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]> {
    return Promise.resolve([...this.extractionCache.values()].map((record) => ({ ...record })));
  }

  addEvidence(record: GraphEvidenceRecord): Promise<void> {
    this.evidence.set(record.id, { ...record });
    return Promise.resolve();
  }

  upsertEntity(record: GraphEntityRecord): Promise<void> {
    const existing = this.entities.get(record.id);
    this.entities.set(record.id, existing ? mergeEntity(existing, record) : copyEntity(record));
    return Promise.resolve();
  }

  addPendingEntityMerge(record: PendingEntityMergeRecord): Promise<void> {
    this.pendingEntityMerges.set(record.id, { ...record });
    return Promise.resolve();
  }

  addRelation(record: GraphRelationRecord): Promise<void> {
    this.relations.set(record.id, copyRelation(record));
    return Promise.resolve();
  }

  addClaim(record: GraphClaimRecord): Promise<void> {
    this.claims.set(record.id, copyClaim(record));
    return Promise.resolve();
  }

  addCommunity(record: GraphCommunityRecord): Promise<void> {
    this.communities.set(record.id, copyCommunity(record));
    return Promise.resolve();
  }

  replaceCommunities(
    ontologySchemaId: string,
    records: readonly GraphCommunityRecord[],
  ): Promise<void> {
    for (const [id, community] of this.communities) {
      if (community.ontologySchemaId === ontologySchemaId) {
        this.communities.delete(id);
      }
    }
    for (const record of records) {
      this.communities.set(record.id, copyCommunity(record));
    }
    return Promise.resolve();
  }

  addRejectedFact(record: GraphRejectedFactRecord): Promise<void> {
    this.rejectedFacts.set(record.id, { ...record });
    return Promise.resolve();
  }

  getEvidence(limit?: number, offset?: number): Promise<GraphEvidenceRecord[]> {
    const all = [...this.evidence.values()];
    return Promise.resolve(
      all.slice(offset ?? 0, limit !== undefined ? (offset ?? 0) + limit : undefined),
    );
  }

  getEntities(limit?: number, offset?: number): Promise<GraphEntityRecord[]> {
    const all = [...this.entities.values()].map(copyEntity);
    return Promise.resolve(
      all.slice(offset ?? 0, limit !== undefined ? (offset ?? 0) + limit : undefined),
    );
  }

  getRelations(limit?: number, offset?: number): Promise<GraphRelationRecord[]> {
    const all = [...this.relations.values()].map(copyRelation);
    return Promise.resolve(
      all.slice(offset ?? 0, limit !== undefined ? (offset ?? 0) + limit : undefined),
    );
  }

  getClaims(limit?: number, offset?: number): Promise<GraphClaimRecord[]> {
    const all = [...this.claims.values()].map(copyClaim);
    return Promise.resolve(
      all.slice(offset ?? 0, limit !== undefined ? (offset ?? 0) + limit : undefined),
    );
  }

  getCommunities(limit?: number, offset?: number): Promise<GraphCommunityRecord[]> {
    const all = [...this.communities.values()].map(copyCommunity);
    return Promise.resolve(
      all.slice(offset ?? 0, limit !== undefined ? (offset ?? 0) + limit : undefined),
    );
  }

  getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return Promise.resolve([...this.rejectedFacts.values()]);
  }

  getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return Promise.resolve([...this.pendingEntityMerges.values()]);
  }

  removeEvidenceByFilePaths(filePaths: readonly string[]): Promise<number> {
    const pathSet = new Set(filePaths);
    let count = 0;
    for (const [id, evidence] of this.evidence) {
      if (pathSet.has(evidence.filePath)) {
        this.evidence.delete(id);
        count++;
      }
    }
    return Promise.resolve(count);
  }

  removeExtractionCacheByEntryIds(entryIds: readonly string[]): Promise<number> {
    const idSet = new Set(entryIds);
    let count = 0;
    for (const id of idSet) {
      if (this.extractionCache.delete(id)) count++;
    }
    return Promise.resolve(count);
  }

  removeRejectedFactsByFilePaths(filePaths: readonly string[]): Promise<number> {
    const pathSet = new Set(filePaths);
    let count = 0;
    for (const [id, fact] of this.rejectedFacts) {
      if (pathSet.has(fact.filePath)) {
        this.rejectedFacts.delete(id);
        count++;
      }
    }
    return Promise.resolve(count);
  }

  pruneByFilePaths(filePaths: readonly string[]): Promise<GraphPruneResult> {
    if (filePaths.length === 0) return Promise.resolve(emptyPruneResult());
    const snapshot = createPrunedGraphSnapshot(filePaths, {
      evidence: [...this.evidence.values()],
      entities: [...this.entities.values()],
      relations: [...this.relations.values()],
      claims: [...this.claims.values()],
      communities: [...this.communities.values()],
      rejectedFacts: [...this.rejectedFacts.values()],
      extractionCache: [...this.extractionCache.values()],
      pendingEntityMerges: [...this.pendingEntityMerges.values()],
    });

    for (const id of snapshot.deletedEvidenceIds) this.evidence.delete(id);
    for (const id of snapshot.deletedEntityIds) this.entities.delete(id);
    for (const record of snapshot.updatedEntities) this.entities.set(record.id, copyEntity(record));
    for (const id of snapshot.deletedRelationIds) this.relations.delete(id);
    for (const record of snapshot.updatedRelations) this.relations.set(record.id, copyRelation(record));
    for (const id of snapshot.deletedClaimIds) this.claims.delete(id);
    for (const record of snapshot.updatedClaims) this.claims.set(record.id, copyClaim(record));
    for (const id of snapshot.deletedCommunityIds) this.communities.delete(id);
    for (const id of snapshot.deletedRejectedFactIds) this.rejectedFacts.delete(id);
    for (const id of snapshot.deletedExtractionCacheEntryIds) this.extractionCache.delete(id);
    for (const id of snapshot.deletedPendingMergeIds) this.pendingEntityMerges.delete(id);

    return Promise.resolve(snapshot.result);
  }
}

interface GraphStoreSnapshot {
  evidence: GraphEvidenceRecord[];
  entities: GraphEntityRecord[];
  relations: GraphRelationRecord[];
  claims: GraphClaimRecord[];
  communities: GraphCommunityRecord[];
  rejectedFacts: GraphRejectedFactRecord[];
  extractionCache: GraphExtractionCacheRecord[];
  pendingEntityMerges: PendingEntityMergeRecord[];
}

interface PrunedGraphSnapshot {
  result: GraphPruneResult;
  deletedEvidenceIds: string[];
  deletedEntityIds: string[];
  updatedEntities: GraphEntityRecord[];
  deletedRelationIds: string[];
  updatedRelations: GraphRelationRecord[];
  deletedClaimIds: string[];
  updatedClaims: GraphClaimRecord[];
  deletedCommunityIds: string[];
  deletedRejectedFactIds: string[];
  deletedExtractionCacheEntryIds: string[];
  deletedPendingMergeIds: string[];
}

function createPrunedGraphSnapshot(
  filePaths: readonly string[],
  snapshot: GraphStoreSnapshot,
): PrunedGraphSnapshot {
  const pathSet = new Set(filePaths);
  const removedEvidence = snapshot.evidence.filter((record) => pathSet.has(record.filePath));
  const removedEvidenceIds = new Set(removedEvidence.map((record) => record.id));
  const removedEntryIds = new Set(removedEvidence.map((record) => record.entryId));
  const affectedSchemaIds = new Set<string>();

  const deletedEntityIds: string[] = [];
  const updatedEntities: GraphEntityRecord[] = [];
  for (const entity of snapshot.entities) {
    const evidenceIds = withoutRemovedEvidence(entity.evidenceIds, removedEvidenceIds);
    if (evidenceIds.length !== entity.evidenceIds.length) {
      affectedSchemaIds.add(entity.ontologySchemaId);
      if (evidenceIds.length === 0) {
        deletedEntityIds.push(entity.id);
      } else {
        updatedEntities.push({ ...copyEntity(entity), evidenceIds });
      }
    }
  }
  const deletedEntityIdSet = new Set(deletedEntityIds);

  const deletedRelationIds: string[] = [];
  const updatedRelations: GraphRelationRecord[] = [];
  for (const relation of snapshot.relations) {
    const evidenceIds = withoutRemovedEvidence(relation.evidenceIds, removedEvidenceIds);
    const hasDeletedEndpoint =
      deletedEntityIdSet.has(relation.sourceEntityId) ||
      deletedEntityIdSet.has(relation.targetEntityId);
    if (evidenceIds.length !== relation.evidenceIds.length || hasDeletedEndpoint) {
      affectedSchemaIds.add(relation.ontologySchemaId);
      if (evidenceIds.length === 0 || hasDeletedEndpoint) {
        deletedRelationIds.push(relation.id);
      } else {
        updatedRelations.push({ ...copyRelation(relation), evidenceIds });
      }
    }
  }
  const deletedRelationIdSet = new Set(deletedRelationIds);

  const deletedClaimIds: string[] = [];
  const updatedClaims: GraphClaimRecord[] = [];
  for (const claim of snapshot.claims) {
    const evidenceIds = withoutRemovedEvidence(claim.evidenceIds, removedEvidenceIds);
    const entityIds = claim.entityIds.filter((id) => !deletedEntityIdSet.has(id));
    const relationIds = claim.relationIds.filter((id) => !deletedRelationIdSet.has(id));
    const changed =
      evidenceIds.length !== claim.evidenceIds.length ||
      entityIds.length !== claim.entityIds.length ||
      relationIds.length !== claim.relationIds.length;
    if (!changed) continue;
    if (evidenceIds.length === 0) {
      deletedClaimIds.push(claim.id);
    } else {
      updatedClaims.push({ ...copyClaim(claim), entityIds, relationIds, evidenceIds });
    }
  }
  const deletedClaimIdSet = new Set(deletedClaimIds);

  const deletedCommunityIds = snapshot.communities
    .filter(
      (community) =>
        affectedSchemaIds.has(community.ontologySchemaId) ||
        community.entityIds.some((id) => deletedEntityIdSet.has(id)) ||
        community.relationIds.some((id) => deletedRelationIdSet.has(id)) ||
        community.claimIds.some((id) => deletedClaimIdSet.has(id)),
    )
    .map((community) => community.id);

  const deletedRejectedFactIds = snapshot.rejectedFacts
    .filter((record) => pathSet.has(record.filePath))
    .map((record) => {
      removedEntryIds.add(record.entryId);
      return record.id;
    });

  const deletedExtractionCacheEntryIds = snapshot.extractionCache
    .filter((record) => shouldRemoveCacheRecord(record, pathSet, removedEntryIds))
    .map((record) => record.entryId);

  const deletedPendingMergeIds = snapshot.pendingEntityMerges
    .filter(
      (record) =>
        deletedEntityIdSet.has(record.existingEntityId) ||
        deletedEntityIdSet.has(record.candidateEntityId),
    )
    .map((record) => record.id);

  return {
    result: {
      evidence: removedEvidence.length,
      entities: deletedEntityIds.length,
      relations: deletedRelationIds.length,
      claims: deletedClaimIds.length,
      communities: deletedCommunityIds.length,
      extractionCache: deletedExtractionCacheEntryIds.length,
      rejectedFacts: deletedRejectedFactIds.length,
      pendingEntityMerges: deletedPendingMergeIds.length,
    },
    deletedEvidenceIds: [...removedEvidenceIds],
    deletedEntityIds,
    updatedEntities,
    deletedRelationIds,
    updatedRelations,
    deletedClaimIds,
    updatedClaims,
    deletedCommunityIds,
    deletedRejectedFactIds,
    deletedExtractionCacheEntryIds,
    deletedPendingMergeIds,
  };
}

function withoutRemovedEvidence(
  evidenceIds: readonly string[],
  removedEvidenceIds: ReadonlySet<string>,
): string[] {
  return evidenceIds.filter((id) => !removedEvidenceIds.has(id));
}

function shouldRemoveCacheRecord(
  record: GraphExtractionCacheRecord,
  pathSet: ReadonlySet<string>,
  removedEntryIds: ReadonlySet<string>,
): boolean {
  if (removedEntryIds.has(record.entryId)) return true;
  for (const path of pathSet) {
    if (record.entryId === path || record.entryId.startsWith(`${path}::`)) return true;
  }
  return false;
}

function emptyPruneResult(): GraphPruneResult {
  return {
    evidence: 0,
    entities: 0,
    relations: 0,
    claims: 0,
    communities: 0,
    extractionCache: 0,
    rejectedFacts: 0,
    pendingEntityMerges: 0,
  };
}

function mergeEntity(existing: GraphEntityRecord, next: GraphEntityRecord): GraphEntityRecord {
  return {
    ...existing,
    aliases: [...new Set([...existing.aliases, ...next.aliases])],
    description: next.description || existing.description,
    confidence: Math.max(existing.confidence, next.confidence),
    evidenceIds: [...new Set([...existing.evidenceIds, ...next.evidenceIds])],
    updatedAt: next.updatedAt,
  };
}

function copyEntity(record: GraphEntityRecord): GraphEntityRecord {
  return {
    ...record,
    aliases: [...record.aliases],
    properties: { ...record.properties },
    evidenceIds: [...record.evidenceIds],
  };
}

function copyRelation(record: GraphRelationRecord): GraphRelationRecord {
  return {
    ...record,
    properties: { ...record.properties },
    evidenceIds: [...record.evidenceIds],
  };
}

function copyClaim(record: GraphClaimRecord): GraphClaimRecord {
  return {
    ...record,
    entityIds: [...record.entityIds],
    relationIds: [...record.relationIds],
    evidenceIds: [...record.evidenceIds],
  };
}

function copyCommunity(record: GraphCommunityRecord): GraphCommunityRecord {
  return {
    ...record,
    entityIds: [...record.entityIds],
    relationIds: [...record.relationIds],
    claimIds: [...record.claimIds],
    summaryVector: [...record.summaryVector],
  };
}
