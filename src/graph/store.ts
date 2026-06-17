import Dexie from 'dexie';
import {
  RUST_GRAPH_PRUNE_UNKNOWN_INDEX,
  isGraphExtractionCacheHitRust,
  planGraphCommunityReplacementDeleteIdsRust,
  planGraphDeletionIndicesRust,
  planGraphEntityMergeRust,
  planGraphPruneRust,
  type RustGraphExtractionCacheKey,
  type RustGraphEntityMergeInput,
  type RustGraphPruneInput,
  type RustGraphPrunePlan,
} from '../rag/rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';
import {
  copyGraphEntityLabels,
  mergeGraphEntityLabels,
  type GraphEntityLabelRecord,
} from './entity-labels';

export type GraphPropertyValue = string | number | boolean;
export type GraphClaimStance = 'supports' | 'opposes' | 'neutral' | 'interprets';

export interface GraphEntityRecord {
  id: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  typeId: string;
  canonicalName: string;
  aliases: string[];
  labels?: GraphEntityLabelRecord[];
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
  getEvidenceByIds(ids: readonly string[]): Promise<GraphEvidenceRecord[]>;
  getRelationsForEntityIds(
    entityIds: readonly string[],
    ontologySchemaId?: string,
  ): Promise<GraphRelationRecord[]>;
  getClaimsForEntityIds(entityIds: readonly string[]): Promise<GraphClaimRecord[]>;
  getCommunitiesBySchema(ontologySchemaId: string): Promise<GraphCommunityRecord[]>;
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
  clear(): Promise<void>;
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
    this.version(2).stores({
      graphEntities: 'id, ontologySchemaId, typeId, canonicalName, updatedAt',
      graphRelations:
        'id, ontologySchemaId, relationTypeId, sourceEntityId, targetEntityId, updatedAt',
      graphClaims: 'id, claimTypeId, *entityIds, updatedAt',
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
    return requireGraphExtractionCacheHit(cached, input);
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

  async getEvidenceByIds(ids: readonly string[]): Promise<GraphEvidenceRecord[]> {
    if (ids.length === 0) return [];
    const records = await this.db.graphEvidence.bulkGet([...new Set(ids)]);
    return records
      .filter((record): record is GraphEvidenceRecord => record !== undefined)
      .map((record) => ({ ...record }));
  }

  async getRelationsForEntityIds(
    entityIds: readonly string[],
    ontologySchemaId?: string,
  ): Promise<GraphRelationRecord[]> {
    const uniqueIds = [...new Set(entityIds)];
    if (uniqueIds.length === 0) return [];
    const [sourceMatches, targetMatches] = await Promise.all([
      this.db.graphRelations.where('sourceEntityId').anyOf(uniqueIds).toArray(),
      this.db.graphRelations.where('targetEntityId').anyOf(uniqueIds).toArray(),
    ]);
    return uniqueById([...sourceMatches, ...targetMatches])
      .filter((record) => !ontologySchemaId || record.ontologySchemaId === ontologySchemaId)
      .map(copyRelation);
  }

  async getClaimsForEntityIds(entityIds: readonly string[]): Promise<GraphClaimRecord[]> {
    const uniqueIds = [...new Set(entityIds)];
    if (uniqueIds.length === 0) return [];
    return (await this.db.graphClaims.where('entityIds').anyOf(uniqueIds).toArray()).map(copyClaim);
  }

  async getCommunitiesBySchema(ontologySchemaId: string): Promise<GraphCommunityRecord[]> {
    return (await this.db.graphCommunities.where('ontologySchemaId').equals(ontologySchemaId).toArray()).map(
      copyCommunity,
    );
  }

  async getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return (await this.db.graphRejectedFacts.toArray()).map((record) => ({ ...record }));
  }

  async getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return (await this.db.graphPendingEntityMerges.toArray()).map((record) => ({ ...record }));
  }

  async removeEvidenceByFilePaths(filePaths: readonly string[]): Promise<number> {
    const evidence = await this.db.graphEvidence.toArray();
    const toDelete = selectGraphRecordsForDeletion(
      evidence,
      evidence.map((record) => record.filePath),
      filePaths,
    );
    if (toDelete.length === 0) return 0;
    await this.db.graphEvidence.bulkDelete(toDelete.map((record) => record.id));
    return toDelete.length;
  }

  async removeExtractionCacheByEntryIds(entryIds: readonly string[]): Promise<number> {
    const cache = await this.db.graphExtractionCache.toArray();
    const toDelete = selectGraphRecordsForDeletion(
      cache,
      cache.map((record) => record.entryId),
      entryIds,
    );
    if (toDelete.length === 0) return 0;
    await this.db.graphExtractionCache.bulkDelete(toDelete.map((record) => record.entryId));
    return toDelete.length;
  }

  async removeRejectedFactsByFilePaths(filePaths: readonly string[]): Promise<number> {
    const facts = await this.db.graphRejectedFacts.toArray();
    const toDelete = selectGraphRecordsForDeletion(
      facts,
      facts.map((record) => record.filePath),
      filePaths,
    );
    if (toDelete.length === 0) return 0;
    await this.db.graphRejectedFacts.bulkDelete(toDelete.map((record) => record.id));
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

  async clear(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.graphEntities,
        this.db.graphRelations,
        this.db.graphClaims,
        this.db.graphEvidence,
        this.db.graphCommunities,
        this.db.graphRejectedFacts,
        this.db.graphExtractionCache,
        this.db.graphPendingEntityMerges,
      ],
      async () => {
        await Promise.all([
          this.db.graphEntities.clear(),
          this.db.graphRelations.clear(),
          this.db.graphClaims.clear(),
          this.db.graphEvidence.clear(),
          this.db.graphCommunities.clear(),
          this.db.graphRejectedFacts.clear(),
          this.db.graphExtractionCache.clear(),
          this.db.graphPendingEntityMerges.clear(),
        ]);
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
    return Promise.resolve(requireGraphExtractionCacheHit(cached, input));
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
    const deleteIds = planGraphCommunityReplacementDeleteIdsRust(
      [...this.communities.values()].map((community) => ({
        id: community.id,
        ontologySchemaId: community.ontologySchemaId,
      })),
      ontologySchemaId,
    );
    if (deleteIds === null) return Promise.resolve();

    for (const id of deleteIds) {
      this.communities.delete(id);
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

  getEvidenceByIds(ids: readonly string[]): Promise<GraphEvidenceRecord[]> {
    const selected: GraphEvidenceRecord[] = [];
    for (const id of new Set(ids)) {
      const record = this.evidence.get(id);
      if (record) selected.push({ ...record });
    }
    return Promise.resolve(selected);
  }

  getRelationsForEntityIds(
    entityIds: readonly string[],
    ontologySchemaId?: string,
  ): Promise<GraphRelationRecord[]> {
    const entityIdSet = new Set(entityIds);
    return Promise.resolve(
      [...this.relations.values()]
        .filter(
          (record) =>
            entityIdSet.has(record.sourceEntityId) || entityIdSet.has(record.targetEntityId),
        )
        .filter((record) => !ontologySchemaId || record.ontologySchemaId === ontologySchemaId)
        .map(copyRelation),
    );
  }

  getClaimsForEntityIds(entityIds: readonly string[]): Promise<GraphClaimRecord[]> {
    const entityIdSet = new Set(entityIds);
    return Promise.resolve(
      [...this.claims.values()]
        .filter((record) => record.entityIds.some((entityId) => entityIdSet.has(entityId)))
        .map(copyClaim),
    );
  }

  getCommunitiesBySchema(ontologySchemaId: string): Promise<GraphCommunityRecord[]> {
    return Promise.resolve(
      [...this.communities.values()]
        .filter((record) => record.ontologySchemaId === ontologySchemaId)
        .map(copyCommunity),
    );
  }

  getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return Promise.resolve([...this.rejectedFacts.values()]);
  }

  getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return Promise.resolve([...this.pendingEntityMerges.values()]);
  }

  removeEvidenceByFilePaths(filePaths: readonly string[]): Promise<number> {
    const evidence = [...this.evidence.values()];
    const toDelete = selectGraphRecordsForDeletion(
      evidence,
      evidence.map((record) => record.filePath),
      filePaths,
    );
    for (const record of toDelete) this.evidence.delete(record.id);
    return Promise.resolve(toDelete.length);
  }

  removeExtractionCacheByEntryIds(entryIds: readonly string[]): Promise<number> {
    const cache = [...this.extractionCache.values()];
    const toDelete = selectGraphRecordsForDeletion(
      cache,
      cache.map((record) => record.entryId),
      entryIds,
    );
    for (const record of toDelete) this.extractionCache.delete(record.entryId);
    return Promise.resolve(toDelete.length);
  }

  removeRejectedFactsByFilePaths(filePaths: readonly string[]): Promise<number> {
    const facts = [...this.rejectedFacts.values()];
    const toDelete = selectGraphRecordsForDeletion(
      facts,
      facts.map((record) => record.filePath),
      filePaths,
    );
    for (const record of toDelete) this.rejectedFacts.delete(record.id);
    return Promise.resolve(toDelete.length);
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

  clear(): Promise<void> {
    this.evidence.clear();
    this.entities.clear();
    this.relations.clear();
    this.claims.clear();
    this.communities.clear();
    this.rejectedFacts.clear();
    this.extractionCache.clear();
    this.pendingEntityMerges.clear();
    return Promise.resolve();
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

function createRustGraphPruneInput(
  filePaths: readonly string[],
  snapshot: GraphStoreSnapshot,
): RustGraphPruneInput {
  const evidenceIndexById = new Map(snapshot.evidence.map((record, index) => [record.id, index]));
  const entityIndexById = new Map(snapshot.entities.map((record, index) => [record.id, index]));
  const relationIndexById = new Map(
    snapshot.relations.map((record, index) => [record.id, index]),
  );
  const claimIndexById = new Map(snapshot.claims.map((record, index) => [record.id, index]));
  const toEvidenceIndex = (id: string): number => toRustGraphIndex(evidenceIndexById, id);
  const toEntityIndex = (id: string): number => toRustGraphIndex(entityIndexById, id);
  const toRelationIndex = (id: string): number => toRustGraphIndex(relationIndexById, id);
  const toClaimIndex = (id: string): number => toRustGraphIndex(claimIndexById, id);

  return {
    filePaths,
    evidenceFilePaths: snapshot.evidence.map((record) => record.filePath),
    evidenceEntryIds: snapshot.evidence.map((record) => record.entryId),
    entitySchemaIds: snapshot.entities.map((record) => record.ontologySchemaId),
    entityEvidenceIndices: snapshot.entities.map((record) =>
      record.evidenceIds.map(toEvidenceIndex),
    ),
    relationSchemaIds: snapshot.relations.map((record) => record.ontologySchemaId),
    relationSourceEntityIndices: snapshot.relations.map((record) =>
      toEntityIndex(record.sourceEntityId),
    ),
    relationTargetEntityIndices: snapshot.relations.map((record) =>
      toEntityIndex(record.targetEntityId),
    ),
    relationEvidenceIndices: snapshot.relations.map((record) =>
      record.evidenceIds.map(toEvidenceIndex),
    ),
    claimEntityIndices: snapshot.claims.map((record) => record.entityIds.map(toEntityIndex)),
    claimRelationIndices: snapshot.claims.map((record) =>
      record.relationIds.map(toRelationIndex),
    ),
    claimEvidenceIndices: snapshot.claims.map((record) => record.evidenceIds.map(toEvidenceIndex)),
    communitySchemaIds: snapshot.communities.map((record) => record.ontologySchemaId),
    communityEntityIndices: snapshot.communities.map((record) =>
      record.entityIds.map(toEntityIndex),
    ),
    communityRelationIndices: snapshot.communities.map((record) =>
      record.relationIds.map(toRelationIndex),
    ),
    communityClaimIndices: snapshot.communities.map((record) =>
      record.claimIds.map(toClaimIndex),
    ),
    rejectedFactFilePaths: snapshot.rejectedFacts.map((record) => record.filePath),
    rejectedFactEntryIds: snapshot.rejectedFacts.map((record) => record.entryId),
    extractionCacheEntryIds: snapshot.extractionCache.map((record) => record.entryId),
    pendingMergeExistingEntityIndices: snapshot.pendingEntityMerges.map((record) =>
      toEntityIndex(record.existingEntityId),
    ),
    pendingMergeCandidateEntityIndices: snapshot.pendingEntityMerges.map((record) =>
      toEntityIndex(record.candidateEntityId),
    ),
  };
}

function toRustGraphIndex(indexById: ReadonlyMap<string, number>, id: string): number {
  return indexById.get(id) ?? RUST_GRAPH_PRUNE_UNKNOWN_INDEX;
}

function createPrunedGraphSnapshotFromRustPlan(
  snapshot: GraphStoreSnapshot,
  plan: RustGraphPrunePlan,
): PrunedGraphSnapshot {
  const deletedEvidence = selectByIndex(snapshot.evidence, plan.deletedEvidenceIndices);
  const deletedEntities = selectByIndex(snapshot.entities, plan.deletedEntityIndices);
  const deletedEntityIds = deletedEntities.map((record) => record.id);
  const deletedRelations = selectByIndex(snapshot.relations, plan.deletedRelationIndices);
  const deletedRelationIds = deletedRelations.map((record) => record.id);
  const deletedClaims = selectByIndex(snapshot.claims, plan.deletedClaimIndices);
  const deletedClaimIds = deletedClaims.map((record) => record.id);
  const deletedCommunities = selectByIndex(snapshot.communities, plan.deletedCommunityIndices);
  const deletedRejectedFacts = selectByIndex(
    snapshot.rejectedFacts,
    plan.deletedRejectedFactIndices,
  );
  const deletedExtractionCache = selectByIndex(
    snapshot.extractionCache,
    plan.deletedExtractionCacheIndices,
  );
  const deletedPendingMerges = selectByIndex(
    snapshot.pendingEntityMerges,
    plan.deletedPendingMergeIndices,
  );
  const updatedEntities = selectByIndex(snapshot.entities, plan.updatedEntityIndices).map(
    (entity, index) => ({
      ...copyEntity(entity),
      evidenceIds: selectByIndex(
        entity.evidenceIds,
        plan.updatedEntityEvidenceIndices[index] ?? [],
      ),
    }),
  );
  const updatedRelations = selectByIndex(snapshot.relations, plan.updatedRelationIndices).map(
    (relation, index) => ({
      ...copyRelation(relation),
      evidenceIds: selectByIndex(
        relation.evidenceIds,
        plan.updatedRelationEvidenceIndices[index] ?? [],
      ),
    }),
  );
  const updatedClaims = selectByIndex(snapshot.claims, plan.updatedClaimIndices).map(
    (claim, index) => ({
      ...copyClaim(claim),
      entityIds: selectByIndex(claim.entityIds, plan.updatedClaimEntityIndices[index] ?? []),
      relationIds: selectByIndex(claim.relationIds, plan.updatedClaimRelationIndices[index] ?? []),
      evidenceIds: selectByIndex(claim.evidenceIds, plan.updatedClaimEvidenceIndices[index] ?? []),
    }),
  );

  return {
    result: {
      evidence: deletedEvidence.length,
      entities: deletedEntities.length,
      relations: deletedRelations.length,
      claims: deletedClaims.length,
      communities: deletedCommunities.length,
      extractionCache: deletedExtractionCache.length,
      rejectedFacts: deletedRejectedFacts.length,
      pendingEntityMerges: deletedPendingMerges.length,
    },
    deletedEvidenceIds: deletedEvidence.map((record) => record.id),
    deletedEntityIds,
    updatedEntities,
    deletedRelationIds,
    updatedRelations,
    deletedClaimIds,
    updatedClaims,
    deletedCommunityIds: deletedCommunities.map((record) => record.id),
    deletedRejectedFactIds: deletedRejectedFacts.map((record) => record.id),
    deletedExtractionCacheEntryIds: deletedExtractionCache.map((record) => record.entryId),
    deletedPendingMergeIds: deletedPendingMerges.map((record) => record.id),
  };
}

function selectByIndex<T>(records: readonly T[], indices: readonly number[]): T[] {
  return selectByRustIndices(records, indices, { dedupe: true });
}

function createPrunedGraphSnapshot(
  filePaths: readonly string[],
  snapshot: GraphStoreSnapshot,
): PrunedGraphSnapshot {
  const rustPlan = planGraphPruneRust(createRustGraphPruneInput(filePaths, snapshot));
  if (rustPlan !== null) {
    return createPrunedGraphSnapshotFromRustPlan(snapshot, rustPlan);
  }
  return noRustPruneResult();
}

function noRustPruneResult(): PrunedGraphSnapshot {
  return {
    result: {
      evidence: 0,
      entities: 0,
      relations: 0,
      claims: 0,
      communities: 0,
      extractionCache: 0,
      rejectedFacts: 0,
      pendingEntityMerges: 0,
    },
    deletedEvidenceIds: [],
    deletedEntityIds: [],
    updatedEntities: [],
    deletedRelationIds: [],
    updatedRelations: [],
    deletedClaimIds: [],
    updatedClaims: [],
    deletedCommunityIds: [],
    deletedRejectedFactIds: [],
    deletedExtractionCacheEntryIds: [],
    deletedPendingMergeIds: [],
  };
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

function selectGraphRecordsForDeletion<T>(
  records: readonly T[],
  recordKeys: readonly string[],
  requestedKeys: readonly string[],
): T[] {
  const indices = planGraphDeletionIndicesRust(recordKeys, requestedKeys);
  if (indices === null) {
    const requested = new Set(requestedKeys);
    const selected: T[] = [];
    const maxIndex = Math.min(records.length, recordKeys.length);
    for (let index = 0; index < maxIndex; index++) {
      if (requested.has(recordKeys[index])) {
        const record = records[index];
        if (record !== undefined) {
          selected.push(record);
        }
      }
    }
    return selected;
  }
  return selectByIndex(records, indices);
}

function uniqueById<T extends { id: string }>(records: readonly T[]): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    selected.push(record);
  }
  return selected;
}

function mergeEntity(existing: GraphEntityRecord, incoming: GraphEntityRecord): GraphEntityRecord {
  const labels = mergeGraphEntityLabels(existing.labels, incoming.labels);
  const plan = planGraphEntityMergeRust(
    toRustGraphEntityMergeInput(existing),
    toRustGraphEntityMergeInput(incoming),
  );
  if (plan === null) {
    return {
      ...existing,
      aliases: mergeOrderedStrings(existing.aliases, incoming.aliases),
      labels,
      description:
        incoming.description.length === 0 ? existing.description : incoming.description,
      confidence: Math.max(existing.confidence, incoming.confidence),
      evidenceIds: mergeOrderedStrings(existing.evidenceIds, incoming.evidenceIds),
      updatedAt: incoming.updatedAt,
    };
  }
  return {
    ...existing,
    aliases: plan.aliases,
    labels,
    description: plan.description,
    confidence: plan.confidence,
    evidenceIds: plan.evidenceIds,
    updatedAt: plan.updatedAt,
  };
}

function toRustGraphEntityMergeInput(record: GraphEntityRecord): RustGraphEntityMergeInput {
  return {
    aliases: record.aliases,
    description: record.description,
    confidence: record.confidence,
    evidenceIds: record.evidenceIds,
    updatedAt: record.updatedAt,
  };
}

function requireGraphExtractionCacheHit(
  cached: GraphExtractionCacheRecord | undefined,
  input: Omit<GraphExtractionCacheRecord, 'updatedAt'>,
): boolean {
  const hit = isGraphExtractionCacheHitRust(
    cached ? toRustGraphExtractionCacheKey(cached) : null,
    toRustGraphExtractionCacheKey(input),
  );
  if (hit === null) {
    return isGraphExtractionCacheHitFallback(cached ? toRustGraphExtractionCacheKey(cached) : null, input);
  }
  return hit;
}

function mergeOrderedStrings(left: readonly string[], right: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of left) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  for (const value of right) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

function isGraphExtractionCacheHitFallback(
  cachedRecord: RustGraphExtractionCacheKey | null,
  input: Omit<GraphExtractionCacheRecord, 'updatedAt'>,
): boolean {
  if (cachedRecord === null) {
    return false;
  }
  const inputKey = toRustGraphExtractionCacheKey(input);
  return (
    cachedRecord.entryId === inputKey.entryId &&
    cachedRecord.contentHash === inputKey.contentHash &&
    cachedRecord.extractionModelKey === inputKey.extractionModelKey &&
    cachedRecord.ontologySchemaId === inputKey.ontologySchemaId &&
    cachedRecord.ontologyVersion === inputKey.ontologyVersion
  );
}

function toRustGraphExtractionCacheKey(
  record: Omit<GraphExtractionCacheRecord, 'updatedAt'>,
): RustGraphExtractionCacheKey {
  return {
    entryId: record.entryId,
    contentHash: record.contentHash,
    extractionModelKey: record.extractionModelKey,
    ontologySchemaId: record.ontologySchemaId,
    ontologyVersion: record.ontologyVersion,
  };
}

function copyEntity(record: GraphEntityRecord): GraphEntityRecord {
  return {
    ...record,
    aliases: [...record.aliases],
    labels: copyGraphEntityLabels(record.labels),
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
