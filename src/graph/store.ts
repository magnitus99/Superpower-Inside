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

export interface KnowledgeGraphStore {
  isExtractionCached(input: Omit<GraphExtractionCacheRecord, 'updatedAt'>): Promise<boolean>;
  markExtractionCached(record: GraphExtractionCacheRecord): Promise<void>;
  getExtractionCacheRecords(): Promise<GraphExtractionCacheRecord[]>;
  getEntities(): Promise<GraphEntityRecord[]>;
  getRelations(): Promise<GraphRelationRecord[]>;
  getClaims(): Promise<GraphClaimRecord[]>;
  getEvidence(): Promise<GraphEvidenceRecord[]>;
  getCommunities(): Promise<GraphCommunityRecord[]>;
  addEvidence(record: GraphEvidenceRecord): Promise<void>;
  upsertEntity(record: GraphEntityRecord): Promise<void>;
  addPendingEntityMerge(record: PendingEntityMergeRecord): Promise<void>;
  addRelation(record: GraphRelationRecord): Promise<void>;
  addClaim(record: GraphClaimRecord): Promise<void>;
  addCommunity(record: GraphCommunityRecord): Promise<void>;
  addRejectedFact(record: GraphRejectedFactRecord): Promise<void>;
  getRejectedFacts(): Promise<GraphRejectedFactRecord[]>;
  getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]>;
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

  async addRejectedFact(record: GraphRejectedFactRecord): Promise<void> {
    await this.db.graphRejectedFacts.put({ ...record });
  }

  async getEvidence(): Promise<GraphEvidenceRecord[]> {
    return (await this.db.graphEvidence.toArray()).map((record) => ({ ...record }));
  }

  async getEntities(): Promise<GraphEntityRecord[]> {
    return (await this.db.graphEntities.toArray()).map(copyEntity);
  }

  async getRelations(): Promise<GraphRelationRecord[]> {
    return (await this.db.graphRelations.toArray()).map(copyRelation);
  }

  async getClaims(): Promise<GraphClaimRecord[]> {
    return (await this.db.graphClaims.toArray()).map(copyClaim);
  }

  async getCommunities(): Promise<GraphCommunityRecord[]> {
    return (await this.db.graphCommunities.toArray()).map(copyCommunity);
  }

  async getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return (await this.db.graphRejectedFacts.toArray()).map((record) => ({ ...record }));
  }

  async getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return (await this.db.graphPendingEntityMerges.toArray()).map((record) => ({ ...record }));
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

  addRejectedFact(record: GraphRejectedFactRecord): Promise<void> {
    this.rejectedFacts.set(record.id, { ...record });
    return Promise.resolve();
  }

  getEvidence(): Promise<GraphEvidenceRecord[]> {
    return Promise.resolve([...this.evidence.values()]);
  }

  getEntities(): Promise<GraphEntityRecord[]> {
    return Promise.resolve([...this.entities.values()].map(copyEntity));
  }

  getRelations(): Promise<GraphRelationRecord[]> {
    return Promise.resolve([...this.relations.values()].map(copyRelation));
  }

  getClaims(): Promise<GraphClaimRecord[]> {
    return Promise.resolve([...this.claims.values()].map(copyClaim));
  }

  getCommunities(): Promise<GraphCommunityRecord[]> {
    return Promise.resolve([...this.communities.values()].map(copyCommunity));
  }

  getRejectedFacts(): Promise<GraphRejectedFactRecord[]> {
    return Promise.resolve([...this.rejectedFacts.values()]);
  }

  getPendingEntityMerges(): Promise<PendingEntityMergeRecord[]> {
    return Promise.resolve([...this.pendingEntityMerges.values()]);
  }
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
