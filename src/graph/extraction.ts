import type { LLMProvider } from '../llm/providers';
import { t } from '../i18n';
import type { OntologySchema } from '../ontology/schema';
import type { GraphRagIndexingCounterPatch, GraphRagIndexingPhase } from './indexing-progress';
import {
  createGraphIdRust,
  graphExtractionContractVersionRust,
  normalizeGraphConfidenceRust,
  normalizeGraphNameRust,
  planGraphClaimEntityIdsRust,
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
  type GraphExtractionJobRecord,
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
      extractionContractVersion: graphExtractionContractVersionRust(),
    };
    input.onPhase?.('checking-cache');
    if (await this.store.isExtractionCached(cacheKey)) return;
    throwIfGraphExtractionAborted(input.signal);

    let job = await this.prepareExtractionJob(input);
    const cachedRawResponse = job.rawResponseId
      ? await this.store.getRawResponse(job.rawResponseId)
      : undefined;

    const evidence = createEvidence(input);
    await this.store.addEvidence(evidence);
    input.onProgress?.({ storedEvidence: 1 });
    throwIfGraphExtractionAborted(input.signal);

    const rawResponse = cachedRawResponse?.body ?? (await this.requestExtraction(input));
    throwIfGraphExtractionAborted(input.signal);
    if (!cachedRawResponse) {
      job = await this.storeRawResponse(job, rawResponse);
    }
    input.onPhase?.('api-response-received');
    input.onPhase?.('api-response-normalizing');
    let parsed = parseExtractedGraphPayload(rawResponse);
    if (!parsed.ok) {
      throwIfGraphExtractionAborted(input.signal);
      input.onPhase?.('api-waiting');
      const repairedResponse = await this.provider.chat(
        [
          { role: 'system', content: buildExtractionRepairSystemPrompt(input.ontologySchema) },
          { role: 'user', content: rawResponse },
        ],
        0,
        undefined,
        { signal: input.signal },
      );
      throwIfGraphExtractionAborted(input.signal);
      job = await this.storeRawResponse(job, repairedResponse);
      input.onPhase?.('api-response-received');
      input.onPhase?.('api-response-normalizing');
      parsed = parseExtractedGraphPayload(repairedResponse);
    }
    input.onPhase?.('storing-results');
    if (!parsed.ok) {
      await this.reject(input, parsed.reason, parsed.rawFact);
      await this.store.putExtractionJob({ ...job, state: 'quarantined', updatedAt: Date.now() });
      return;
    }

    await this.store.putExtractionJob({ ...job, state: 'validated', updatedAt: Date.now() });
    await this.storeAcceptedFacts(input, evidence, parsed.payload);
    await this.store.markExtractionCached({ ...cacheKey, updatedAt: Date.now() });
    await this.store.putExtractionJob({ ...job, state: 'committed', updatedAt: Date.now() });
    input.onProgress?.({ cachedChunks: 1 });
  }

  private async prepareExtractionJob(
    input: GraphExtractionChunkInput,
  ): Promise<GraphExtractionJobRecord> {
    const contractVersion = graphExtractionContractVersionRust();
    const requestFingerprint = createId(
      'graph-extraction-request',
      input.entryId,
      input.contentHash,
      input.extractionModelKey,
      String(contractVersion),
    );
    const id = createId('graph-extraction-job', requestFingerprint);
    const existing = await this.store.getExtractionJob(id);
    if (existing) return existing;

    const [providerKey = 'unknown', requestedModel = input.extractionModelKey] =
      input.extractionModelKey.split(':', 2);
    const job: GraphExtractionJobRecord = {
      id,
      requestFingerprint,
      entryId: input.entryId,
      filePath: input.filePath,
      contentHash: input.contentHash,
      contractVersion,
      providerKey,
      requestedModel,
      providerEpochId: createId(
        'graph-provider-epoch',
        input.extractionModelKey,
        String(contractVersion),
      ),
      state: 'prepared',
      attemptCount: 0,
      updatedAt: Date.now(),
    };
    await this.store.putExtractionJob(job);
    return job;
  }

  private requestExtraction(input: GraphExtractionChunkInput): Promise<string> {
    input.onPhase?.('api-waiting');
    return this.provider.chat(
      [
        { role: 'system', content: buildExtractionSystemPrompt(input.ontologySchema) },
        { role: 'user', content: buildExtractionUserPrompt(input) },
      ],
      0,
      undefined,
      { signal: input.signal },
    );
  }

  private async storeRawResponse(
    job: GraphExtractionJobRecord,
    body: string,
  ): Promise<GraphExtractionJobRecord> {
    const bodyHash = createId('graph-raw-response-body', body);
    const rawResponseId = createId('graph-raw-response', job.requestFingerprint, bodyHash);
    await this.store.putRawResponse({
      id: rawResponseId,
      requestFingerprint: job.requestFingerprint,
      providerEpochId: job.providerEpochId,
      body,
      bodyHash,
      receivedAt: Date.now(),
    });
    const nextJob: GraphExtractionJobRecord = {
      ...job,
      state: 'response-received',
      attemptCount: job.attemptCount + 1,
      rawResponseId,
      updatedAt: Date.now(),
    };
    await this.store.putExtractionJob(nextJob);
    return nextJob;
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

    for (const entity of payload.entities) {
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

    const relationIdsByLocalRef = new Map<string, string>();
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

      const record = createRelationRecord(input, evidence.id, relation, source.id, target.id, now);
      if (relation.id) relationIdsByLocalRef.set(relation.id, record.id);
      await this.store.addRelation(record);
      input.onProgress?.({ storedRelations: 1 });
    }

    for (const claim of payload.claims) {
      const entityIds =
        planGraphClaimEntityIdsRust(claim.entityNames ?? [], claimEntityLookupRecords) ?? [];
      const record = createClaimRecord(
        evidence.id,
        claim,
        entityIds,
        (claim.relationRefs ?? [])
          .map((reference) => relationIdsByLocalRef.get(reference))
          .filter((id): id is string => id !== undefined),
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

function buildExtractionRepairSystemPrompt(schema: OntologySchema): string {
  return [
    'Repair the previous graph extraction response into one valid JSON object only.',
    'Do not add facts, translations, entities, relations, or claims that are absent from the previous response.',
    buildExtractionSystemPrompt(schema),
  ].join('\n');
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
  return [
    'Extract evidence-grounded knowledge graph facts as JSON only.',
    `Suggested entity type hints: ${entityTypes}, other. Use other when none fit.`,
    'Use concise snake_case relationTypeId values that preserve the source meaning. Unknown relations are allowed.',
    'Return exactly one JSON object with this shape:',
    '{"entities":[{"id":"e1","name":"string","typeId":"person|organization|place|document|event|concept|other","description":"string","aliases":["string"],"confidence":0.0}],"relations":[{"id":"r1","sourceRef":"e1","targetRef":"e2","relationTypeId":"snake_case_label","description":"string","confidence":0.0}],"claims":[{"id":"c1","text":"string","claimTypeId":"factual_claim|interpretive_claim|evaluative_claim","entityRefs":["e1"],"relationRefs":["r1"],"stance":"supports|opposes|neutral|interprets","confidence":0.0}]}',
    'Use entities, relations, claims as arrays even when empty.',
    'Every entity, relation, and claim must have a unique response-local id.',
    'Relations must use sourceRef and targetRef. Claims must reference only directly relevant entity and relation ids.',
    'Do not attach unrelated relations from the same text to a claim.',
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
