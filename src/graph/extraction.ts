import type { LLMProvider } from '../llm/providers';
import { t } from '../i18n';
import { type OntologySchema, validateOntologyRelation } from '../ontology/schema';
import type { GraphRagIndexingCounterPatch, GraphRagIndexingPhase } from './indexing-progress';
import {
  createGraphIdRust,
  normalizeGraphConfidenceRust,
  normalizeGraphNameRust,
  planGraphClaimEntityIdsRust,
  planGraphExtractionTypeValidationRust,
  planGraphRelationEndpointIndicesRust,
  parseExtractedGraphPayloadRust,
  type RustExtractedGraphClaim as ExtractedClaim,
  type RustExtractedGraphEntity as ExtractedEntity,
  type RustExtractedGraphPayload as ExtractedGraphPayload,
  type RustExtractedGraphPayloadParseResult,
  type RustExtractedGraphRelation as ExtractedRelation,
  type RustGraphClaimEntityLookupRecord,
  type RustGraphRelationEndpointInput,
  type RustGraphRelationEndpointLookupRecord,
  type RustGraphRelationEndpointPlan,
} from '../rag/rust-core';
import { EntityResolver, type EntityResolverOptions } from './entity-resolver';
import { createGraphEntityLabels } from './entity-labels';
import {
  type GraphClaimRecord,
  type GraphEntityRecord,
  type GraphEvidenceRecord,
  type GraphRejectedFactRecord,
  type GraphRelationRecord,
  type KnowledgeGraphStore,
} from './store';

export interface GraphExtractionIndexerOptions {
  provider: LLMProvider;
  store: KnowledgeGraphStore;
  entityResolverOptions?: EntityResolverOptions;
}

export interface GraphExtractionChunkInput {
  chunkText: string;
  filePath: string;
  entryId: string;
  startLine: number;
  endLine?: number;
  contentHash: string;
  extractionModelKey: string;
  ontologySchema: OntologySchema;
  signal?: AbortSignal;
  onPhase?: (phase: GraphRagIndexingPhase) => void;
  onProgress?: (patch: GraphRagIndexingCounterPatch) => void;
}

type GraphPayloadParseResult =
  | RustExtractedGraphPayloadParseResult
  | { ok: false; reason: 'extraction-error'; rawFact: unknown };

export class GraphExtractionIndexer {
  private provider: LLMProvider;
  private store: KnowledgeGraphStore;
  private entityResolver: EntityResolver;

  constructor(options: GraphExtractionIndexerOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.entityResolver = new EntityResolver(options.store, {
      autoMergeThreshold: options.entityResolverOptions?.autoMergeThreshold ?? 0.88,
      pendingMergeThreshold: options.entityResolverOptions?.pendingMergeThreshold ?? 0.72,
      embeddingProvider: options.entityResolverOptions?.embeddingProvider,
    });
  }

  async extractChunk(input: GraphExtractionChunkInput): Promise<void> {
    throwIfGraphExtractionAborted(input.signal);
    const cacheKey = {
      entryId: input.entryId,
      contentHash: input.contentHash,
      extractionModelKey: input.extractionModelKey,
      ontologySchemaId: input.ontologySchema.id,
      ontologyVersion: input.ontologySchema.version,
    };
    input.onPhase?.('checking-cache');
    if (await this.store.isExtractionCached(cacheKey)) return;
    throwIfGraphExtractionAborted(input.signal);

    const evidence = createEvidence(input);
    await this.store.addEvidence(evidence);
    input.onProgress?.({ storedEvidence: 1 });
    throwIfGraphExtractionAborted(input.signal);

    input.onPhase?.('api-waiting');
    const rawResponse = await this.provider.chat(
      [
        { role: 'system', content: buildExtractionSystemPrompt(input.ontologySchema) },
        { role: 'user', content: buildExtractionUserPrompt(input) },
      ],
      0,
      undefined,
      { signal: input.signal },
    );
    throwIfGraphExtractionAborted(input.signal);
    input.onPhase?.('api-response-received');
    input.onPhase?.('api-response-normalizing');
    const parsed = parseExtractedGraphPayload(rawResponse);
    input.onPhase?.('storing-results');
    if (!parsed.ok) {
      await this.reject(input, parsed.reason, parsed.rawFact);
      return;
    }

    await this.storeAcceptedFacts(input, evidence, parsed.payload);
    await this.store.markExtractionCached({ ...cacheKey, updatedAt: Date.now() });
    input.onProgress?.({ cachedChunks: 1 });
  }

  private async storeAcceptedFacts(
    input: GraphExtractionChunkInput,
    evidence: GraphEvidenceRecord,
    payload: ExtractedGraphPayload,
  ): Promise<void> {
    const now = Date.now();
    const entityRecords: GraphEntityRecord[] = [];
    const claimEntityLookupRecords: RustGraphClaimEntityLookupRecord[] = [];
    const relationEndpointLookupRecords: RustGraphRelationEndpointLookupRecord[] = [];
    const typeValidationPlan = planGraphExtractionTypeValidationRust(
      payload.entities.map((entity) => entity.typeId),
      payload.claims.map((claim) => claim.claimTypeId),
      input.ontologySchema.entityTypes.map((entityType) => entityType.id),
      input.ontologySchema.claimTypes.map((claimType) => claimType.id),
    );

    for (const [entityPayloadIndex, entity] of payload.entities.entries()) {
      if (typeValidationPlan?.entityTypeKnown[entityPayloadIndex] !== true) {
        await this.reject(input, 'unknown-entity-type', entity);
        continue;
      }
      const labels = createGraphEntityLabels({
        canonicalName: entity.name,
        aliases: entity.aliases ?? [],
        confidence: normalizeConfidence(entity.confidence),
        evidenceId: evidence.id,
        source: 'llm-extraction',
      });
      const resolution = await this.entityResolver.resolve({
        ontologySchema: input.ontologySchema,
        typeId: entity.typeId,
        canonicalName: entity.name,
        aliases: entity.aliases ?? [],
        labels,
        description: entity.description ?? '',
        evidenceIds: [evidence.id],
      });
      const record = createEntityRecord(input, evidence.id, entity, labels, resolution.entityId, now);
      const entityIndex = entityRecords.length;
      entityRecords.push(record);
      claimEntityLookupRecords.push({ name: entity.name, entityId: record.id });
      relationEndpointLookupRecords.push({ name: entity.name, entityIndex });
      for (const alias of entity.aliases ?? []) {
        claimEntityLookupRecords.push({ name: alias, entityId: record.id });
        relationEndpointLookupRecords.push({ name: alias, entityIndex });
      }
      await this.store.upsertEntity(record);
      input.onProgress?.({ storedEntities: 1 });
    }

    const relationEndpointPlan =
      planGraphRelationEndpointIndicesRust(
        payload.relations.map(
          (relation): RustGraphRelationEndpointInput => ({
            source: relation.source,
            target: relation.target,
          }),
        ),
        relationEndpointLookupRecords,
        entityRecords.length,
      ) ??
      planGraphRelationEndpointIndicesFallback(payload.relations, relationEndpointLookupRecords, entityRecords.length);

    const relationIdsByKey = new Map<string, string>();
    for (const [relationIndex, relation] of payload.relations.entries()) {
      const endpointPair = relationEndpointPlan?.pairs[relationIndex] ?? null;
      if (endpointPair === null) {
        await this.reject(input, 'unknown-relation-entity', relation);
        continue;
      }
      const sourceEntityIndex = endpointPair.sourceEntityIndex;
      const targetEntityIndex = endpointPair.targetEntityIndex;
      if (
        !Number.isInteger(sourceEntityIndex) ||
        !Number.isInteger(targetEntityIndex) ||
        sourceEntityIndex < 0 ||
        targetEntityIndex < 0 ||
        sourceEntityIndex >= entityRecords.length ||
        targetEntityIndex >= entityRecords.length
      ) {
        await this.reject(input, 'unknown-relation-entity', relation);
        continue;
      }
      const source = entityRecords[sourceEntityIndex];
      const target = entityRecords[targetEntityIndex];
      if (!source || !target) {
        await this.reject(input, 'unknown-relation-entity', relation);
        continue;
      }

      const validation = validateOntologyRelation(input.ontologySchema, {
        relationTypeId: relation.relationTypeId,
        sourceTypeId: source.typeId,
        targetTypeId: target.typeId,
      });
      if (!validation.valid) {
        await this.reject(input, validation.reason, relation);
        continue;
      }

      const record = createRelationRecord(input, evidence.id, relation, source.id, target.id, now);
      relationIdsByKey.set(
        `${normalizeName(relation.source)}\u0000${normalizeName(relation.target)}`,
        record.id,
      );
      await this.store.addRelation(record);
      input.onProgress?.({ storedRelations: 1 });
    }

    for (const [claimIndex, claim] of payload.claims.entries()) {
      if (typeValidationPlan?.claimTypeKnown[claimIndex] !== true) {
        await this.reject(input, 'unknown-claim-type', claim);
        continue;
      }
      const entityIds =
        planGraphClaimEntityIdsRust(claim.entityNames ?? [], claimEntityLookupRecords) ?? [];
      const record = createClaimRecord(
        evidence.id,
        claim,
        entityIds,
        [...relationIdsByKey.values()],
        now,
      );
      await this.store.addClaim(record);
      input.onProgress?.({ storedClaims: 1 });
    }
  }

  private async reject(
    input: GraphExtractionChunkInput,
    reason: string,
    rawFact: unknown,
  ): Promise<void> {
    const record: GraphRejectedFactRecord = {
      id: createId('rejected', input.entryId, reason, JSON.stringify(rawFact)),
      filePath: input.filePath,
      entryId: input.entryId,
      reason,
      rawFact,
      updatedAt: Date.now(),
    };
    await this.store.addRejectedFact(record);
    input.onProgress?.({ storedRejectedFacts: 1 });
  }
}

function parseExtractedGraphPayload(rawResponse: string): GraphPayloadParseResult {
  return (
    parseExtractedGraphPayloadRust(rawResponse) ?? {
      ok: false,
      reason: 'extraction-error',
      rawFact: rawResponse,
    }
  );
}

function planGraphRelationEndpointIndicesFallback(
  relations: readonly ExtractedRelation[],
  lookupRecords: readonly RustGraphRelationEndpointLookupRecord[],
  entityCount: number,
): RustGraphRelationEndpointPlan | null {
  if (!Number.isSafeInteger(entityCount) || entityCount < 0) {
    return null;
  }

  const entityIndexByName = new Map<string, number>();
  for (const record of lookupRecords) {
    if (
      !Number.isSafeInteger(record.entityIndex) ||
      record.entityIndex < 0 ||
      record.entityIndex >= entityCount
    ) {
      continue;
    }

    const normalizedName = normalizeName(record.name);
    if (normalizedName.length === 0) continue;
    if (entityIndexByName.has(normalizedName)) continue;
    entityIndexByName.set(normalizedName, record.entityIndex);
  }

  const pairs = relations.map((relation) => {
    const sourceName = normalizeName(relation.source);
    const targetName = normalizeName(relation.target);
    const sourceEntityIndex = entityIndexByName.get(sourceName);
    const targetEntityIndex = entityIndexByName.get(targetName);
    if (sourceEntityIndex === undefined || targetEntityIndex === undefined) {
      return null;
    }

    return {
      sourceEntityIndex,
      targetEntityIndex,
    };
  });

  return { pairs };
}

function buildExtractionSystemPrompt(schema: OntologySchema): string {
  const entityTypes = schema.entityTypes.map((entityType) => entityType.id).join(', ');
  const relationTypes = schema.relationTypes.map((relationType) => relationType.id).join(', ');
  const claimTypes = schema.claimTypes.map((claimType) => claimType.id).join(', ');
  const relationConstraints = schema.relationTypes
    .map(
      (relationType) =>
        `${relationType.id}: sourceTypeIds=${relationType.sourceTypeIds.join('|')}; targetTypeIds=${relationType.targetTypeIds.join('|')}`,
    )
    .join('\n');
  return [
    'Extract ontology-guided graph facts as JSON only.',
    `Ontology schema: ${schema.id}@${schema.version}`,
    `Entity types: ${entityTypes}`,
    `Relation types: ${relationTypes}`,
    `Claim types: ${claimTypes}`,
    'Relation domain/range constraints:',
    relationConstraints,
    'Return exactly one JSON object with this shape:',
    '{"entities":[{"name":"string","typeId":"person|organization|place|work|concept|event|argument|evidence","description":"string","aliases":["string"],"confidence":0.0}],"relations":[{"source":"entity name","target":"entity name","relationTypeId":"authored|mentions|supports|opposes|collaborated_with|causes|influences|part_of|located_in|interprets","description":"string","confidence":0.0}],"claims":[{"text":"string","claimTypeId":"factual_claim|interpretive_claim|evaluative_claim","entityNames":["entity name"],"stance":"supports|opposes|neutral|interprets","confidence":0.0}]}',
    'Use entities, relations, claims as arrays even when empty.',
    'Use typeId, relationTypeId, claimTypeId exactly. Do not use type, relation, claim_type, subject, object, or keyed objects.',
    'Put explicit same-entity names from other languages into aliases only when the source text or existing ontology context supports them.',
    'Do not invent translated aliases just to make the graph multilingual.',
    t('ontologyRelationEndpointExactMatchInstruction'),
    t('ontologyRelationEndpointGenericRoleInstruction'),
    t('ontologyRelationDomainRangeFallbackInstruction'),
    schema.extractionGuidelines,
  ].join('\n');
}

function buildExtractionUserPrompt(input: GraphExtractionChunkInput): string {
  return [
    `File: ${input.filePath}`,
    `Entry: ${input.entryId}`,
    `Lines: ${input.startLine}-${input.endLine ?? input.startLine}`,
    '',
    input.chunkText,
  ].join('\n');
}

function createEvidence(input: GraphExtractionChunkInput): GraphEvidenceRecord {
  return {
    id: createId('evidence', input.entryId, input.contentHash),
    filePath: input.filePath,
    entryId: input.entryId,
    startLine: input.startLine,
    endLine: input.endLine,
    quote: input.chunkText,
    contentHash: input.contentHash,
    extractionModelKey: input.extractionModelKey,
    updatedAt: Date.now(),
  };
}

function createEntityRecord(
  input: GraphExtractionChunkInput,
  evidenceId: string,
  entity: ExtractedEntity,
  labels: GraphEntityRecord['labels'],
  entityId: string,
  now: number,
): GraphEntityRecord {
  return {
    id: entityId,
    ontologySchemaId: input.ontologySchema.id,
    ontologyVersion: input.ontologySchema.version,
    typeId: entity.typeId,
    canonicalName: entity.name.trim(),
    aliases: (entity.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
    labels,
    description: entity.description?.trim() ?? '',
    properties: {},
    confidence: normalizeConfidence(entity.confidence),
    evidenceIds: [evidenceId],
    createdAt: now,
    updatedAt: now,
  };
}

function createRelationRecord(
  input: GraphExtractionChunkInput,
  evidenceId: string,
  relation: ExtractedRelation,
  sourceEntityId: string,
  targetEntityId: string,
  now: number,
): GraphRelationRecord {
  return {
    id: createId(
      'relation',
      input.ontologySchema.id,
      relation.relationTypeId,
      sourceEntityId,
      targetEntityId,
      evidenceId,
    ),
    ontologySchemaId: input.ontologySchema.id,
    ontologyVersion: input.ontologySchema.version,
    relationTypeId: relation.relationTypeId,
    sourceEntityId,
    targetEntityId,
    description: relation.description?.trim() ?? '',
    properties: {},
    confidence: normalizeConfidence(relation.confidence),
    evidenceIds: [evidenceId],
    createdAt: now,
    updatedAt: now,
  };
}

function createClaimRecord(
  evidenceId: string,
  claim: ExtractedClaim,
  entityIds: string[],
  relationIds: string[],
  now: number,
): GraphClaimRecord {
  return {
    id: createId('claim', claim.claimTypeId, normalizeName(claim.text), evidenceId),
    claimTypeId: claim.claimTypeId,
    text: claim.text.trim(),
    entityIds,
    relationIds,
    stance: claim.stance,
    confidence: normalizeConfidence(claim.confidence),
    evidenceIds: [evidenceId],
    updatedAt: now,
  };
}

function throwIfGraphExtractionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('GraphRAG extraction cancelled', 'AbortError');
  }
}

function normalizeName(name: string): string {
  return normalizeGraphNameRust(name) ?? '';
}

function normalizeConfidence(confidence: unknown): number {
  return normalizeGraphConfidenceRust(confidence) ?? 0.5;
}

function createId(...parts: string[]): string {
  return createGraphIdRust(parts) ?? '';
}
