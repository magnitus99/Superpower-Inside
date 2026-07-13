import Dexie from 'dexie';
import {
  RUST_GRAPH_PRUNE_UNKNOWN_INDEX,
  graphExtractionContractVersionRust,
  isGraphExtractionCacheHitRust,
  isSameGraphEntityPairRust,
  planGraphCommunityReplacementDeleteIdsRust,
  planGraphDeletionIndicesRust,
  planGraphEntityMergeRust,
  planGraphPruneRust,
  rewriteGraphEntityReferencesRust,
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

export interface GraphSourceSpan {
  start: number;
  end: number;
}

export interface GraphFactProvenance {
  entryId: string;
  contentHash: string;
  contractVersion: number;
  providerEpochId: string;
  rawResponseHash: string;
  observedModel?: string;
  generatedAt: number;
}

export interface GraphEntityGenerationRecord {
  providerEpochId: string;
  rawResponseHash: string;
  description: string;
  properties: Record<string, GraphPropertyValue>;
  confidence: number;
  generatedAt: number;
}

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
  provenance?: GraphFactProvenance[];
  generations?: GraphEntityGenerationRecord[];
  sourceSpans?: GraphSourceSpan[];
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
  provenance?: GraphFactProvenance[];
  sourceSpans?: GraphSourceSpan[];
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
  provenance?: GraphFactProvenance[];
  sourceSpans?: GraphSourceSpan[];
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
  extractionContractVersion?: number;
  providerEpochId?: string;
  updatedAt: number;
}

export type GraphExtractionJobState =
  | 'prepared'
  | 'leased'
  | 'response-received'
  | 'parsed'
  | 'validated'
  | 'committed'
  | 'retry-wait'
  | 'quarantined';

export interface GraphExtractionJobRecord {
  id: string;
  requestFingerprint: string;
  entryId: string;
  filePath: string;
  contentHash: string;
  contractVersion: number;
  providerKey: string;
  requestedModel: string;
  observedModel?: string;
  providerEpochId: string;
  state: GraphExtractionJobState;
  attemptCount: number;
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  rawResponseId?: string;
  lastErrorCode?: string;
  updatedAt: number;
}

export interface GraphRawResponseRecord {
  id: string;
  requestFingerprint: string;
  providerEpochId: string;
  body: string;
  bodyHash: string;
  receivedAt: number;
}

export interface GraphProviderCircuitRecord {
  providerEpochId: string;
  consecutiveFailures: number;
  state: 'closed' | 'open' | 'half-open';
  openUntil?: number;
  lastErrorCode?: string;
  updatedAt: number;
}

export interface GraphCommunitySummaryJobRecord {
  id: string;
  communityKey: string;
  memberHash: string;
  childReportHash: string;
  level: number;
  promptHash: string;
  providerEpochId: string;
  state: 'prepared' | 'response-received' | 'committed';
  rawResponseId?: string;
  updatedAt: number;
}

export interface GraphGlobalSearchJobRecord {
  id: string;
  queryHash: string;
  phase: 'map' | 'reduce';
  communityId?: string;
  providerEpochId: string;
  state: 'prepared' | 'response-received' | 'committed';
  rawResponseId?: string;
  updatedAt: number;
}

export interface GraphExtractionCommit {
  evidence: GraphEvidenceRecord;
  entities: readonly GraphEntityRecord[];
  relations: readonly GraphRelationRecord[];
  claims: readonly GraphClaimRecord[];
  rejectedFacts: readonly GraphRejectedFactRecord[];
  pendingEntityMerges: readonly PendingEntityMergeRecord[];
  cache: GraphExtractionCacheRecord;
  job: GraphExtractionJobRecord;
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

export type PendingEntityMergeDecision = 'merge' | 'separate';

const KEPT_SEPARATE_REASON = 'kept-separate';

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
  putExtractionJob(record: GraphExtractionJobRecord): Promise<void>;
  getExtractionJob(id: string): Promise<GraphExtractionJobRecord | undefined>;
  getExtractionJobs(): Promise<GraphExtractionJobRecord[]>;
  recoverExpiredExtractionJobs(now: number): Promise<number>;
  putRawResponse(record: GraphRawResponseRecord): Promise<void>;
  getRawResponse(id: string): Promise<GraphRawResponseRecord | undefined>;
  getRawResponses(): Promise<GraphRawResponseRecord[]>;
  putProviderCircuit(record: GraphProviderCircuitRecord): Promise<void>;
  getProviderCircuit(providerEpochId: string): Promise<GraphProviderCircuitRecord | undefined>;
  putCommunitySummaryJob(record: GraphCommunitySummaryJobRecord): Promise<void>;
  getCommunitySummaryJob(id: string): Promise<GraphCommunitySummaryJobRecord | undefined>;
  putGlobalSearchJob(record: GraphGlobalSearchJobRecord): Promise<void>;
  getGlobalSearchJob(id: string): Promise<GraphGlobalSearchJobRecord | undefined>;
  commitExtraction(commit: GraphExtractionCommit): Promise<void>;
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
  resolvePendingEntityMerge(
    id: string,
    decision: PendingEntityMergeDecision,
  ): Promise<boolean>;
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
  graphExtractionJobs!: Dexie.Table<GraphExtractionJobRecord, string>;
  graphRawResponses!: Dexie.Table<GraphRawResponseRecord, string>;
  graphProviderCircuits!: Dexie.Table<GraphProviderCircuitRecord, string>;
  graphCommunitySummaryJobs!: Dexie.Table<GraphCommunitySummaryJobRecord, string>;
  graphGlobalSearchJobs!: Dexie.Table<GraphGlobalSearchJobRecord, string>;

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
    this.version(3).stores({
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
      graphExtractionJobs:
        'id, requestFingerprint, entryId, filePath, state, nextAttemptAt, leaseExpiresAt, updatedAt',
      graphRawResponses: 'id, requestFingerprint, providerEpochId, bodyHash, receivedAt',
    });
    this.version(4).stores({
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
      graphExtractionJobs:
        'id, requestFingerprint, entryId, filePath, state, nextAttemptAt, leaseExpiresAt, updatedAt',
      graphRawResponses: 'id, requestFingerprint, providerEpochId, bodyHash, receivedAt',
      graphProviderCircuits: 'providerEpochId, state, openUntil, updatedAt',
    });
    this.version(5).stores({
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
      graphExtractionJobs:
        'id, requestFingerprint, entryId, filePath, state, nextAttemptAt, leaseExpiresAt, updatedAt',
      graphRawResponses: 'id, requestFingerprint, providerEpochId, bodyHash, receivedAt',
      graphProviderCircuits: 'providerEpochId, state, openUntil, updatedAt',
      graphCommunitySummaryJobs:
        'id, communityKey, level, providerEpochId, state, updatedAt',
    });
    this.version(6).stores({
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
      graphExtractionJobs:
        'id, requestFingerprint, entryId, filePath, state, nextAttemptAt, leaseExpiresAt, updatedAt',
      graphRawResponses: 'id, requestFingerprint, providerEpochId, bodyHash, receivedAt',
      graphProviderCircuits: 'providerEpochId, state, openUntil, updatedAt',
      graphCommunitySummaryJobs:
        'id, communityKey, level, providerEpochId, state, updatedAt',
      graphGlobalSearchJobs: 'id, queryHash, phase, communityId, providerEpochId, state, updatedAt',
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
    if (
      input.providerEpochId !== undefined &&
      cached?.providerEpochId !== undefined &&
      cached.providerEpochId !== input.providerEpochId
    ) {
      return false;
    }
    return requireGraphExtractionCacheHit(cached, withCurrentExtractionContract(input));
  }

  async markExtractionCached(record: GraphExtractionCacheRecord): Promise<void> {
    await this.db.graphExtractionCache.put(withCurrentExtractionContract(record));
  }

  async getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]> {
    return (await this.db.graphExtractionCache.toArray()).map((record) => ({ ...record }));
  }

  async putExtractionJob(record: GraphExtractionJobRecord): Promise<void> {
    await this.db.graphExtractionJobs.put(copyExtractionJob(record));
  }

  async getExtractionJob(id: string): Promise<GraphExtractionJobRecord | undefined> {
    const record = await this.db.graphExtractionJobs.get(id);
    return record ? copyExtractionJob(record) : undefined;
  }

  async getExtractionJobs(): Promise<GraphExtractionJobRecord[]> {
    return (await this.db.graphExtractionJobs.toArray()).map(copyExtractionJob);
  }

  async recoverExpiredExtractionJobs(now: number): Promise<number> {
    return this.db.transaction('rw', this.db.graphExtractionJobs, async () => {
      const expired = await this.db.graphExtractionJobs
        .where('state')
        .equals('leased')
        .filter((record) => (record.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= now)
        .toArray();
      if (expired.length === 0) return 0;
      await this.db.graphExtractionJobs.bulkPut(
        expired.map((record) => ({
          ...record,
          state: 'prepared' as const,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        })),
      );
      return expired.length;
    });
  }

  async putRawResponse(record: GraphRawResponseRecord): Promise<void> {
    await this.db.graphRawResponses.put({ ...record });
  }

  async getRawResponse(id: string): Promise<GraphRawResponseRecord | undefined> {
    const record = await this.db.graphRawResponses.get(id);
    return record ? { ...record } : undefined;
  }

  async getRawResponses(): Promise<GraphRawResponseRecord[]> {
    return (await this.db.graphRawResponses.toArray()).map((record) => ({ ...record }));
  }

  async putProviderCircuit(record: GraphProviderCircuitRecord): Promise<void> {
    await this.db.graphProviderCircuits.put({ ...record });
  }

  async getProviderCircuit(
    providerEpochId: string,
  ): Promise<GraphProviderCircuitRecord | undefined> {
    const record = await this.db.graphProviderCircuits.get(providerEpochId);
    return record ? { ...record } : undefined;
  }

  async putCommunitySummaryJob(record: GraphCommunitySummaryJobRecord): Promise<void> {
    await this.db.graphCommunitySummaryJobs.put({ ...record });
  }

  async getCommunitySummaryJob(
    id: string,
  ): Promise<GraphCommunitySummaryJobRecord | undefined> {
    const record = await this.db.graphCommunitySummaryJobs.get(id);
    return record ? { ...record } : undefined;
  }

  async putGlobalSearchJob(record: GraphGlobalSearchJobRecord): Promise<void> {
    await this.db.graphGlobalSearchJobs.put({ ...record });
  }

  async getGlobalSearchJob(id: string): Promise<GraphGlobalSearchJobRecord | undefined> {
    const record = await this.db.graphGlobalSearchJobs.get(id);
    return record ? { ...record } : undefined;
  }

  async commitExtraction(commit: GraphExtractionCommit): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.graphEvidence,
        this.db.graphEntities,
        this.db.graphRelations,
        this.db.graphClaims,
        this.db.graphRejectedFacts,
        this.db.graphPendingEntityMerges,
        this.db.graphExtractionCache,
        this.db.graphExtractionJobs,
      ],
      async () => {
        await this.db.graphEvidence.put({ ...commit.evidence });
        for (const entity of commit.entities) {
          const existing = await this.db.graphEntities.get(entity.id);
          await this.db.graphEntities.put(
            existing ? mergeEntity(existing, entity) : copyEntity(entity),
          );
        }
        if (commit.relations.length > 0) {
          await this.db.graphRelations.bulkPut(commit.relations.map(copyRelation));
        }
        if (commit.claims.length > 0) {
          await this.db.graphClaims.bulkPut(commit.claims.map(copyClaim));
        }
        if (commit.rejectedFacts.length > 0) {
          await this.db.graphRejectedFacts.bulkPut(
            commit.rejectedFacts.map((record) => ({ ...record })),
          );
        }
        for (const pendingMerge of commit.pendingEntityMerges) {
          const decisions = await this.db.graphPendingEntityMerges.toArray();
          if (!decisions.some((decision) => isKeptSeparatePair(decision, pendingMerge))) {
            await this.db.graphPendingEntityMerges.put({ ...pendingMerge });
          }
        }
        await this.db.graphExtractionCache.put(withCurrentExtractionContract(commit.cache));
        await this.db.graphExtractionJobs.put(copyExtractionJob(commit.job));
      },
    );
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
    const existingDecisions = await this.db.graphPendingEntityMerges.toArray();
    if (existingDecisions.some((decision) => isKeptSeparatePair(decision, record))) return;
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
    return (await this.db.graphPendingEntityMerges.toArray())
      .filter((record) => record.reason !== KEPT_SEPARATE_REASON)
      .map((record) => ({ ...record }));
  }

  async resolvePendingEntityMerge(
    id: string,
    decision: PendingEntityMergeDecision,
  ): Promise<boolean> {
    return this.db.transaction(
      'rw',
      [
        this.db.graphEntities,
        this.db.graphRelations,
        this.db.graphClaims,
        this.db.graphCommunities,
        this.db.graphPendingEntityMerges,
      ],
      async () => {
        const pending = await this.db.graphPendingEntityMerges.get(id);
        if (!pending || pending.reason === KEPT_SEPARATE_REASON) return false;
        if (decision === 'separate') {
          await this.db.graphPendingEntityMerges.put({
            ...pending,
            reason: KEPT_SEPARATE_REASON,
            updatedAt: Date.now(),
          });
          return true;
        }

        const [existing, candidate] = await Promise.all([
          this.db.graphEntities.get(pending.existingEntityId),
          this.db.graphEntities.get(pending.candidateEntityId),
        ]);
        if (!existing || !candidate || existing.id === candidate.id) {
          await this.db.graphPendingEntityMerges.delete(id);
          return false;
        }

        const [relations, claims, communities, pendingMerges] = await Promise.all([
          this.db.graphRelations.toArray(),
          this.db.graphClaims.toArray(),
          this.db.graphCommunities.toArray(),
          this.db.graphPendingEntityMerges.toArray(),
        ]);
        await this.db.graphEntities.put(mergeEntity(existing, candidate));
        await this.db.graphEntities.delete(candidate.id);
        await this.db.graphRelations.bulkPut(
          relations.map((record) => rewriteRelationEntityReference(record, candidate.id, existing.id)),
        );
        await this.db.graphClaims.bulkPut(
          claims.map((record) => rewriteClaimEntityReferences(record, candidate.id, existing.id)),
        );
        await this.db.graphCommunities.bulkPut(
          communities.map((record) => rewriteCommunityEntityReferences(record, candidate.id, existing.id)),
        );
        await this.db.graphPendingEntityMerges.bulkDelete(
          pendingMerges
            .filter(
              (record) =>
                record.id === id ||
                record.existingEntityId === candidate.id ||
                record.candidateEntityId === candidate.id,
            )
            .map((record) => record.id),
        );
        return true;
      },
    );
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
        this.db.graphExtractionJobs,
        this.db.graphRawResponses,
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
        this.db.graphExtractionJobs,
        this.db.graphRawResponses,
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
          this.db.graphExtractionJobs.clear(),
          this.db.graphRawResponses.clear(),
        ]);
      },
    );
    await Promise.all([
      this.db.graphProviderCircuits.clear(),
      this.db.graphCommunitySummaryJobs.clear(),
      this.db.graphGlobalSearchJobs.clear(),
    ]);
  }

  async deleteDatabase(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.db.name);
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
  private extractionJobs = new Map<string, GraphExtractionJobRecord>();
  private rawResponses = new Map<string, GraphRawResponseRecord>();
  private providerCircuits = new Map<string, GraphProviderCircuitRecord>();
  private communitySummaryJobs = new Map<string, GraphCommunitySummaryJobRecord>();
  private globalSearchJobs = new Map<string, GraphGlobalSearchJobRecord>();

  isExtractionCached(input: Omit<GraphExtractionCacheRecord, 'updatedAt'>): Promise<boolean> {
    const cached = this.extractionCache.get(input.entryId);
    if (
      input.providerEpochId !== undefined &&
      cached?.providerEpochId !== undefined &&
      cached.providerEpochId !== input.providerEpochId
    ) {
      return Promise.resolve(false);
    }
    return Promise.resolve(
      requireGraphExtractionCacheHit(cached, withCurrentExtractionContract(input)),
    );
  }

  markExtractionCached(record: GraphExtractionCacheRecord): Promise<void> {
    this.extractionCache.set(record.entryId, withCurrentExtractionContract(record));
    return Promise.resolve();
  }

  getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]> {
    return Promise.resolve([...this.extractionCache.values()].map((record) => ({ ...record })));
  }

  putExtractionJob(record: GraphExtractionJobRecord): Promise<void> {
    this.extractionJobs.set(record.id, copyExtractionJob(record));
    return Promise.resolve();
  }

  getExtractionJob(id: string): Promise<GraphExtractionJobRecord | undefined> {
    const record = this.extractionJobs.get(id);
    return Promise.resolve(record ? copyExtractionJob(record) : undefined);
  }

  getExtractionJobs(): Promise<GraphExtractionJobRecord[]> {
    return Promise.resolve([...this.extractionJobs.values()].map(copyExtractionJob));
  }

  recoverExpiredExtractionJobs(now: number): Promise<number> {
    let recovered = 0;
    for (const [id, record] of this.extractionJobs) {
      if (record.state !== 'leased' || (record.leaseExpiresAt ?? Number.POSITIVE_INFINITY) > now) {
        continue;
      }
      this.extractionJobs.set(id, {
        ...record,
        state: 'prepared',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      recovered += 1;
    }
    return Promise.resolve(recovered);
  }

  putRawResponse(record: GraphRawResponseRecord): Promise<void> {
    this.rawResponses.set(record.id, { ...record });
    return Promise.resolve();
  }

  getRawResponse(id: string): Promise<GraphRawResponseRecord | undefined> {
    const record = this.rawResponses.get(id);
    return Promise.resolve(record ? { ...record } : undefined);
  }

  getRawResponses(): Promise<GraphRawResponseRecord[]> {
    return Promise.resolve([...this.rawResponses.values()].map((record) => ({ ...record })));
  }

  putProviderCircuit(record: GraphProviderCircuitRecord): Promise<void> {
    this.providerCircuits.set(record.providerEpochId, { ...record });
    return Promise.resolve();
  }

  getProviderCircuit(providerEpochId: string): Promise<GraphProviderCircuitRecord | undefined> {
    const record = this.providerCircuits.get(providerEpochId);
    return Promise.resolve(record ? { ...record } : undefined);
  }

  putCommunitySummaryJob(record: GraphCommunitySummaryJobRecord): Promise<void> {
    this.communitySummaryJobs.set(record.id, { ...record });
    return Promise.resolve();
  }

  getCommunitySummaryJob(id: string): Promise<GraphCommunitySummaryJobRecord | undefined> {
    const record = this.communitySummaryJobs.get(id);
    return Promise.resolve(record ? { ...record } : undefined);
  }

  putGlobalSearchJob(record: GraphGlobalSearchJobRecord): Promise<void> {
    this.globalSearchJobs.set(record.id, { ...record });
    return Promise.resolve();
  }

  getGlobalSearchJob(id: string): Promise<GraphGlobalSearchJobRecord | undefined> {
    const record = this.globalSearchJobs.get(id);
    return Promise.resolve(record ? { ...record } : undefined);
  }

  commitExtraction(commit: GraphExtractionCommit): Promise<void> {
    this.evidence.set(commit.evidence.id, { ...commit.evidence });
    for (const entity of commit.entities) {
      const existing = this.entities.get(entity.id);
      this.entities.set(entity.id, existing ? mergeEntity(existing, entity) : copyEntity(entity));
    }
    for (const relation of commit.relations) this.relations.set(relation.id, copyRelation(relation));
    for (const claim of commit.claims) this.claims.set(claim.id, copyClaim(claim));
    for (const rejectedFact of commit.rejectedFacts) {
      this.rejectedFacts.set(rejectedFact.id, { ...rejectedFact });
    }
    for (const pendingMerge of commit.pendingEntityMerges) {
      if (
        ![...this.pendingEntityMerges.values()].some((decision) =>
          isKeptSeparatePair(decision, pendingMerge),
        )
      ) {
        this.pendingEntityMerges.set(pendingMerge.id, { ...pendingMerge });
      }
    }
    this.extractionCache.set(commit.cache.entryId, withCurrentExtractionContract(commit.cache));
    this.extractionJobs.set(commit.job.id, copyExtractionJob(commit.job));
    return Promise.resolve();
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
    if (
      [...this.pendingEntityMerges.values()].some((decision) =>
        isKeptSeparatePair(decision, record),
      )
    ) {
      return Promise.resolve();
    }
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
    return Promise.resolve(
      [...this.pendingEntityMerges.values()].filter(
        (record) => record.reason !== KEPT_SEPARATE_REASON,
      ),
    );
  }

  resolvePendingEntityMerge(
    id: string,
    decision: PendingEntityMergeDecision,
  ): Promise<boolean> {
    const pending = this.pendingEntityMerges.get(id);
    if (!pending || pending.reason === KEPT_SEPARATE_REASON) return Promise.resolve(false);
    if (decision === 'separate') {
      this.pendingEntityMerges.set(id, {
        ...pending,
        reason: KEPT_SEPARATE_REASON,
        updatedAt: Date.now(),
      });
      return Promise.resolve(true);
    }

    const existing = this.entities.get(pending.existingEntityId);
    const candidate = this.entities.get(pending.candidateEntityId);
    if (!existing || !candidate || existing.id === candidate.id) {
      this.pendingEntityMerges.delete(id);
      return Promise.resolve(false);
    }

    this.entities.set(existing.id, mergeEntity(existing, candidate));
    this.entities.delete(candidate.id);
    for (const [relationId, relation] of this.relations) {
      this.relations.set(
        relationId,
        rewriteRelationEntityReference(relation, candidate.id, existing.id),
      );
    }
    for (const [claimId, claim] of this.claims) {
      this.claims.set(claimId, rewriteClaimEntityReferences(claim, candidate.id, existing.id));
    }
    for (const [communityId, community] of this.communities) {
      this.communities.set(
        communityId,
        rewriteCommunityEntityReferences(community, candidate.id, existing.id),
      );
    }
    for (const [pendingId, record] of this.pendingEntityMerges) {
      if (
        pendingId === id ||
        record.existingEntityId === candidate.id ||
        record.candidateEntityId === candidate.id
      ) {
        this.pendingEntityMerges.delete(pendingId);
      }
    }
    return Promise.resolve(true);
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
    this.extractionJobs.clear();
    this.rawResponses.clear();
    this.providerCircuits.clear();
    this.communitySummaryJobs.clear();
    this.globalSearchJobs.clear();
    return Promise.resolve();
  }
}

function copyExtractionJob(record: GraphExtractionJobRecord): GraphExtractionJobRecord {
  return { ...record };
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

function isKeptSeparatePair(
  decision: PendingEntityMergeRecord,
  candidate: PendingEntityMergeRecord,
): boolean {
  if (
    decision.reason !== KEPT_SEPARATE_REASON ||
    decision.ontologySchemaId !== candidate.ontologySchemaId
  ) {
    return false;
  }
  return (
    isSameGraphEntityPairRust(
      decision.existingEntityId,
      decision.candidateEntityId,
      candidate.existingEntityId,
      candidate.candidateEntityId,
    )
  );
}

function rewriteEntityReferences(
  references: readonly string[],
  candidateEntityId: string,
  existingEntityId: string,
  deduplicate: boolean,
): string[] {
  return (
    rewriteGraphEntityReferencesRust(
      references,
      candidateEntityId,
      existingEntityId,
      deduplicate,
    ) ?? [...references]
  );
}

function rewriteRelationEntityReference(
  record: GraphRelationRecord,
  candidateEntityId: string,
  existingEntityId: string,
): GraphRelationRecord {
  const [sourceEntityId, targetEntityId] = rewriteEntityReferences(
    [record.sourceEntityId, record.targetEntityId],
    candidateEntityId,
    existingEntityId,
    false,
  );
  return {
    ...copyRelation(record),
    sourceEntityId: sourceEntityId ?? record.sourceEntityId,
    targetEntityId: targetEntityId ?? record.targetEntityId,
  };
}

function rewriteClaimEntityReferences(
  record: GraphClaimRecord,
  candidateEntityId: string,
  existingEntityId: string,
): GraphClaimRecord {
  return {
    ...copyClaim(record),
    entityIds: rewriteEntityReferences(
      record.entityIds,
      candidateEntityId,
      existingEntityId,
      true,
    ),
  };
}

function rewriteCommunityEntityReferences(
  record: GraphCommunityRecord,
  candidateEntityId: string,
  existingEntityId: string,
): GraphCommunityRecord {
  return {
    ...copyCommunity(record),
    entityIds: rewriteEntityReferences(
      record.entityIds,
      candidateEntityId,
      existingEntityId,
      true,
    ),
  };
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
      provenance: mergeProvenance(existing.provenance, incoming.provenance),
      generations: mergeEntityGenerations(existing.generations, incoming.generations),
      sourceSpans: mergeSourceSpans(existing.sourceSpans, incoming.sourceSpans),
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
    provenance: mergeProvenance(existing.provenance, incoming.provenance),
    generations: mergeEntityGenerations(existing.generations, incoming.generations),
    sourceSpans: mergeSourceSpans(existing.sourceSpans, incoming.sourceSpans),
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

function mergeProvenance(
  left: readonly GraphFactProvenance[] | undefined,
  right: readonly GraphFactProvenance[] | undefined,
): GraphFactProvenance[] | undefined {
  if (!left && !right) return undefined;
  const merged = new Map<string, GraphFactProvenance>();
  for (const record of [...(left ?? []), ...(right ?? [])]) {
    merged.set(`${record.providerEpochId}\0${record.rawResponseHash}`, { ...record });
  }
  return [...merged.values()];
}

function mergeEntityGenerations(
  left: readonly GraphEntityGenerationRecord[] | undefined,
  right: readonly GraphEntityGenerationRecord[] | undefined,
): GraphEntityGenerationRecord[] | undefined {
  if (!left && !right) return undefined;
  const merged = new Map<string, GraphEntityGenerationRecord>();
  for (const record of [...(left ?? []), ...(right ?? [])]) {
    merged.set(`${record.providerEpochId}\0${record.rawResponseHash}`, {
      ...record,
      properties: { ...record.properties },
    });
  }
  return [...merged.values()];
}

function mergeSourceSpans(
  left: readonly GraphSourceSpan[] | undefined,
  right: readonly GraphSourceSpan[] | undefined,
): GraphSourceSpan[] | undefined {
  if (!left && !right) return undefined;
  const spans = new Map<string, GraphSourceSpan>();
  for (const span of [...(left ?? []), ...(right ?? [])]) {
    spans.set(`${span.start}:${span.end}`, { ...span });
  }
  return [...spans.values()];
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
    cachedRecord.ontologyVersion === inputKey.ontologyVersion &&
    cachedRecord.extractionContractVersion === inputKey.extractionContractVersion
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
    extractionContractVersion: record.extractionContractVersion ?? 0,
  };
}

function withCurrentExtractionContract<T extends Omit<GraphExtractionCacheRecord, 'updatedAt'>>(
  record: T,
): T & { extractionContractVersion: number } {
  return {
    ...record,
    extractionContractVersion:
      record.extractionContractVersion ?? graphExtractionContractVersionRust(),
  };
}

function copyEntity(record: GraphEntityRecord): GraphEntityRecord {
  return {
    ...record,
    aliases: [...record.aliases],
    labels: copyGraphEntityLabels(record.labels),
    properties: { ...record.properties },
    evidenceIds: [...record.evidenceIds],
    provenance: record.provenance?.map((provenance) => ({ ...provenance })),
    generations: record.generations?.map((generation) => ({
      ...generation,
      properties: { ...generation.properties },
    })),
    sourceSpans: record.sourceSpans?.map((span) => ({ ...span })),
  };
}

function copyRelation(record: GraphRelationRecord): GraphRelationRecord {
  return {
    ...record,
    properties: { ...record.properties },
    evidenceIds: [...record.evidenceIds],
    provenance: record.provenance?.map((provenance) => ({ ...provenance })),
    sourceSpans: record.sourceSpans?.map((span) => ({ ...span })),
  };
}

function copyClaim(record: GraphClaimRecord): GraphClaimRecord {
  return {
    ...record,
    entityIds: [...record.entityIds],
    relationIds: [...record.relationIds],
    evidenceIds: [...record.evidenceIds],
    provenance: record.provenance?.map((provenance) => ({ ...provenance })),
    sourceSpans: record.sourceSpans?.map((span) => ({ ...span })),
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
