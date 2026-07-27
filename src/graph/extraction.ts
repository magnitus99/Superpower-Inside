import type { LLMProvider } from '../llm/providers';
import type { KnowledgeGraphContract } from './knowledge-contract';
import type { GraphRagIndexingCounterPatch, GraphRagIndexingPhase } from './indexing-progress';
import {
  createGraphIdRust,
  graphExtractionContractVersionRust,
  normalizeGraphConfidenceRust,
  normalizeGraphNameRust,
  normalizeGraphSourceSpansRust,
  planGraphClaimEntityIdsRust,
  planGraphRelationEndpointIndicesRust,
  parseExtractedGraphPayloadRust,
  planGraphExtractionFailureRust,
  planGraphExtractionChildUnitsRust,
  type RustExtractedGraphClaim as ExtractedClaim,
  type RustExtractedGraphEntity as ExtractedEntity,
  type RustExtractedGraphPayload as ExtractedGraphPayload,
  type RustExtractedGraphPayloadParseResult,
  type RustExtractedGraphRelation as ExtractedRelation,
  type RustGraphClaimEntityLookupRecord,
  type RustGraphRelationEndpointInput,
  type RustGraphRelationEndpointLookupRecord,
  type RustGraphRelationEndpointPlan,
  type RustGraphExtractionFailurePlan,
} from '../rag/rust-core';
import { EntityResolver, type EntityResolverOptions } from './entity-resolver';
import { createGraphEntityLabels } from './entity-labels';
import {
  type GraphClaimRecord,
  type GraphEntityRecord,
  type GraphEvidenceRecord,
  type GraphExtractionJobRecord,
  type GraphFactProvenance,
  type GraphRejectedFactRecord,
  type GraphRelationRecord,
  type KnowledgeGraphStore,
  type PendingEntityMergeRecord,
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
  knowledgeContract: KnowledgeGraphContract;
  signal?: AbortSignal;
  ignoreRetryWait?: boolean;
  splitDepth?: number;
  onPhase?: (phase: GraphRagIndexingPhase) => void;
  onProgress?: (patch: GraphRagIndexingCounterPatch) => void;
}

export class GraphExtractionDeferredError extends Error {
  constructor(readonly nextAttemptAt: number) {
    super('Graph extraction retry is deferred.');
    this.name = 'GraphExtractionDeferredError';
  }
}

export function isGraphExtractionDeferredError(
  error: unknown,
): error is GraphExtractionDeferredError {
  return error instanceof GraphExtractionDeferredError;
}

type GraphPayloadParseResult =
  | RustExtractedGraphPayloadParseResult
  | { ok: false; reason: 'extraction-error'; rawFact: unknown };

interface AcceptedGraphFacts {
  entities: GraphEntityRecord[];
  relations: GraphRelationRecord[];
  claims: GraphClaimRecord[];
  rejectedFacts: GraphRejectedFactRecord[];
  pendingEntityMerges: PendingEntityMergeRecord[];
}

export class GraphExtractionIndexer {
  private static readonly LEASE_DURATION_MS = 120_000;
  private provider: LLMProvider;
  private store: KnowledgeGraphStore;
  private entityResolver: EntityResolver;
  private readonly workerId = crypto.randomUUID();

  constructor(options: GraphExtractionIndexerOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.entityResolver = new EntityResolver(options.store, {
      autoMergeThreshold: options.entityResolverOptions?.autoMergeThreshold ?? 0.88,
      pendingMergeThreshold: options.entityResolverOptions?.pendingMergeThreshold ?? 0.72,
      embeddingProvider: options.entityResolverOptions?.embeddingProvider,
      persistPendingMerge: false,
    });
  }

  getProviderEpochId(extractionModelKey: string, contractVersion: number): string {
    return createGraphProviderEpochId(this.provider, extractionModelKey, contractVersion);
  }

  async extractChunk(input: GraphExtractionChunkInput): Promise<void> {
    throwIfGraphExtractionAborted(input.signal);
    let job = await this.prepareExtractionJob(input);
    const cacheKey = {
      entryId: input.entryId,
      contentHash: input.contentHash,
      extractionModelKey: input.extractionModelKey,
      ontologySchemaId: input.knowledgeContract.id,
      ontologyVersion: input.knowledgeContract.version,
      extractionContractVersion: graphExtractionContractVersionRust(),
      providerEpochId: job.providerEpochId,
    };
    input.onPhase?.('checking-cache');
    if (await this.store.isExtractionCached(cacheKey)) return;
    throwIfGraphExtractionAborted(input.signal);

    if (
      job.state === 'retry-wait' &&
      input.ignoreRetryWait !== true &&
      job.nextAttemptAt !== undefined &&
      job.nextAttemptAt > Date.now()
    ) {
      throw new GraphExtractionDeferredError(job.nextAttemptAt);
    }
    if (
      job.state === 'quarantined' &&
      job.rawResponseId === undefined &&
      input.ignoreRetryWait !== true
    ) {
      throw new GraphExtractionDeferredError(Number.POSITIVE_INFINITY);
    }
    const cachedRawResponse = job.rawResponseId
      ? await this.store.getRawResponse(job.rawResponseId)
      : undefined;

    let rawResponse = cachedRawResponse?.body;
    if (rawResponse === undefined) {
      const circuit = await this.store.getProviderCircuit(job.providerEpochId);
      if (
        circuit?.state === 'open' &&
        input.ignoreRetryWait !== true &&
        (circuit.openUntil ?? 0) > Date.now()
      ) {
        throw new GraphExtractionDeferredError(circuit.openUntil ?? Date.now());
      }
      if (
        circuit?.state === 'open' &&
        (circuit.openUntil ?? 0) <= Date.now()
      ) {
        await this.store.putProviderCircuit({
          ...circuit,
          state: 'half-open',
          updatedAt: Date.now(),
        });
      }
      const leasedAt = Date.now();
      job = {
        ...job,
        state: 'leased',
        attemptCount: job.attemptCount + 1,
        leaseOwner: this.workerId,
        leaseExpiresAt: leasedAt + GraphExtractionIndexer.LEASE_DURATION_MS,
        updatedAt: leasedAt,
      };
      await this.store.putExtractionJob(job);
      try {
        rawResponse = await this.requestExtraction(input);
        const observedModel = this.provider.getObservedModel?.()?.trim();
        if (observedModel) {
          job = { ...job, observedModel };
        }
        await this.store.putProviderCircuit({
          providerEpochId: job.providerEpochId,
          consecutiveFailures: 0,
          state: 'closed',
          updatedAt: Date.now(),
        });
      } catch (error) {
        const failurePlan = await this.persistInterruptedRequest(job, error);
        if (
          failurePlan?.code === 'context-overflow' &&
          (await this.extractOverflowChildren(input))
        ) {
          const committedAt = Date.now();
          await this.store.markExtractionCached({ ...cacheKey, updatedAt: committedAt });
          await this.store.putExtractionJob({
            ...job,
            state: 'committed',
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            updatedAt: committedAt,
          });
          input.onProgress?.({ cachedChunks: 1 });
          return;
        }
        throw error;
      }
    }
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
          { role: 'system', content: buildExtractionRepairSystemPrompt(input.knowledgeContract) },
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
      const rejectedEvidence = createEvidence(input, job.providerEpochId);
      await this.store.addEvidence(rejectedEvidence);
      input.onProgress?.({ storedEvidence: 1 });
      await this.reject(input, parsed.reason, parsed.rawFact);
      await this.store.putExtractionJob({ ...job, state: 'quarantined', updatedAt: Date.now() });
      return;
    }

    const committedAt = Date.now();
    const evidence = createEvidence(input, job.providerEpochId);
    const provenance = createFactProvenance(input, job, rawResponse, committedAt);
    const facts = await this.buildAcceptedFacts(input, evidence, parsed.payload, provenance);
    throwIfGraphExtractionAborted(input.signal);
    await this.store.commitExtraction({
      evidence,
      ...facts,
      cache: { ...cacheKey, updatedAt: committedAt },
      job: { ...job, state: 'committed', updatedAt: committedAt },
    });
    input.onProgress?.({
      storedEvidence: 1,
      storedEntities: facts.entities.length,
      storedRelations: facts.relations.length,
      storedClaims: facts.claims.length,
      storedRejectedFacts: facts.rejectedFacts.length,
    });
    input.onProgress?.({ cachedChunks: 1 });
  }

  private async prepareExtractionJob(
    input: GraphExtractionChunkInput,
  ): Promise<GraphExtractionJobRecord> {
    const contractVersion = graphExtractionContractVersionRust();
    const providerEpochId = this.getProviderEpochId(input.extractionModelKey, contractVersion);
    const requestFingerprint = createId(
      'graph-extraction-request',
      input.entryId,
      input.contentHash,
      input.extractionModelKey,
      providerEpochId,
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
      providerEpochId,
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
        { role: 'system', content: buildExtractionSystemPrompt(input.knowledgeContract) },
        { role: 'user', content: buildExtractionUserPrompt(input) },
      ],
      0,
      undefined,
      { signal: input.signal },
    );
  }

  private async persistInterruptedRequest(
    job: GraphExtractionJobRecord,
    error: unknown,
  ): Promise<RustGraphExtractionFailurePlan | null> {
    if (isAbortError(error)) {
      await this.store.putExtractionJob(createAbortedJob(job));
      return null;
    }
    const now = Date.now();
    const existingCircuit = await this.store.getProviderCircuit(job.providerEpochId);
    const consecutiveFailures = (existingCircuit?.consecutiveFailures ?? 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    const plan = planGraphExtractionFailureRust({
      message,
      status: getProviderHttpErrorField(error, 'status'),
      attemptCount: job.attemptCount,
      consecutiveFailures,
      now,
      retryAfterMs: getProviderHttpErrorField(error, 'retryAfterMs'),
    });
    if (!plan) throw new Error('Graph extraction failure policy is unavailable.');
    await this.store.putProviderCircuit({
      providerEpochId: job.providerEpochId,
      consecutiveFailures,
      state: plan.opensCircuit ? 'open' : 'closed',
      openUntil: plan.opensCircuit ? plan.nextAttemptAt : undefined,
      lastErrorCode: plan.code,
      updatedAt: now,
    });
    await this.store.putExtractionJob({
      ...job,
      state: plan.retryable ? 'retry-wait' : 'quarantined',
      nextAttemptAt: plan.retryable ? plan.nextAttemptAt : undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: plan.code,
      updatedAt: now,
    });
    return plan;
  }

  private async extractOverflowChildren(input: GraphExtractionChunkInput): Promise<boolean> {
    const splitDepth = input.splitDepth ?? 0;
    const children = planGraphExtractionChildUnitsRust(input.chunkText, splitDepth);
    if (!children || children.length < 2) return false;
    for (const [index, child] of children.entries()) {
      const childStartLine = input.startLine + child.metadata.startLine;
      const childEndLine = input.startLine + child.metadata.endLine;
      await this.extractChunk({
        ...input,
        chunkText: child.text,
        entryId: `${input.entryId}::overflow::${splitDepth + 1}::${index}`,
        startLine: childStartLine,
        endLine: childEndLine,
        contentHash: createId(
          'graph-overflow-child',
          input.contentHash,
          String(splitDepth + 1),
          String(index),
          child.text,
        ),
        splitDepth: splitDepth + 1,
        ignoreRetryWait: false,
      });
    }
    return true;
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
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      rawResponseId,
      updatedAt: Date.now(),
    };
    await this.store.putExtractionJob(nextJob);
    return nextJob;
  }

  private async buildAcceptedFacts(
    input: GraphExtractionChunkInput,
    evidence: GraphEvidenceRecord,
    payload: ExtractedGraphPayload,
    provenance: GraphFactProvenance,
  ): Promise<AcceptedGraphFacts> {
    const now = Date.now();
    const entityRecords: GraphEntityRecord[] = [];
    const relationRecords: GraphRelationRecord[] = [];
    const claimRecords: GraphClaimRecord[] = [];
    const rejectedFacts: GraphRejectedFactRecord[] = [];
    const pendingEntityMerges: PendingEntityMergeRecord[] = [];
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
        knowledgeContract: input.knowledgeContract,
        typeId: entity.typeId,
        canonicalName: entity.name,
        aliases: entity.aliases ?? [],
        labels,
        description: entity.description ?? '',
        evidenceIds: [evidence.id],
      });
      const record = createEntityRecord(input, evidence.id, entity, labels, resolution.entityId, now);
      record.provenance = [{ ...provenance }];
      record.sourceSpans = requireSourceSpans(entity.evidenceSpans, input.chunkText.length);
      record.generations = [{
        providerEpochId: provenance.providerEpochId,
        rawResponseHash: provenance.rawResponseHash,
        description: record.description,
        properties: { ...record.properties },
        confidence: record.confidence,
        generatedAt: provenance.generatedAt,
      }];
      if (resolution.pendingMerge) pendingEntityMerges.push(resolution.pendingMerge);
      const entityIndex = entityRecords.length;
      entityRecords.push(record);
      claimEntityLookupRecords.push({ name: entity.name, entityId: record.id });
      relationEndpointLookupRecords.push({ name: entity.name, entityIndex });
      for (const alias of entity.aliases ?? []) {
        claimEntityLookupRecords.push({ name: alias, entityId: record.id });
        relationEndpointLookupRecords.push({ name: alias, entityIndex });
      }
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
        rejectedFacts.push(createRejectedFact(input, 'unknown-relation-entity', relation));
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
        rejectedFacts.push(createRejectedFact(input, 'unknown-relation-entity', relation));
        continue;
      }
      const source = entityRecords[sourceEntityIndex];
      const target = entityRecords[targetEntityIndex];
      if (!source || !target) {
        rejectedFacts.push(createRejectedFact(input, 'unknown-relation-entity', relation));
        continue;
      }

      const record = createRelationRecord(input, evidence.id, relation, source.id, target.id, now);
      record.provenance = [{ ...provenance }];
      record.sourceSpans = requireSourceSpans(relation.evidenceSpans, input.chunkText.length);
      if (relation.id) relationIdsByLocalRef.set(relation.id, record.id);
      relationRecords.push(record);
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
      record.provenance = [{ ...provenance }];
      record.sourceSpans = requireSourceSpans(claim.evidenceSpans, input.chunkText.length);
      claimRecords.push(record);
    }
    return {
      entities: entityRecords,
      relations: relationRecords,
      claims: claimRecords,
      rejectedFacts,
      pendingEntityMerges,
    };
  }

  private async reject(
    input: GraphExtractionChunkInput,
    reason: string,
    rawFact: unknown,
  ): Promise<void> {
    const record = createRejectedFact(input, reason, rawFact);
    await this.store.addRejectedFact(record);
    input.onProgress?.({ storedRejectedFacts: 1 });
  }
}

function createAbortedJob(job: GraphExtractionJobRecord): GraphExtractionJobRecord {
  const now = Date.now();
  return {
    ...job,
    state: 'prepared',
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: now,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getProviderHttpErrorField(error: unknown, field: 'status' | 'retryAfterMs'): number | undefined {
  if (!(error instanceof Error) || !(field in error)) return undefined;
  const value = (error as Error & Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildExtractionRepairSystemPrompt(schema: KnowledgeGraphContract): string {
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

function buildExtractionSystemPrompt(schema: KnowledgeGraphContract): string {
  const entityTypes = schema.entityTypes.map((entityType) => entityType.id);
  const claimTypes = schema.claimTypes.map((claimType) => claimType.id);
  const relationTypeHints = schema.relationTypeHints
    .map((relationType) => relationType.id)
    .join(', ');
  return [
    'Extract evidence-grounded knowledge graph facts as JSON only.',
    `Suggested entity type hints: ${entityTypes.join(', ')}. Use other when none fit.`,
    `Suggested relation type hints: ${relationTypeHints}.`,
    `Use concise snake_case relationTypeId values that preserve the source meaning. ${schema.allowUnknownRelationTypes ? 'Unknown relations are allowed.' : 'Use only the suggested relation types.'}`,
    'Return exactly one JSON object with this shape:',
    `{"entities":[{"id":"e1","name":"string","typeId":"${entityTypes.join('|')}","description":"string","aliases":["string"],"confidence":0.0,"evidenceSpans":[{"start":0,"end":5}]}],"relations":[{"id":"r1","sourceRef":"e1","targetRef":"e2","relationTypeId":"snake_case_label","description":"string","confidence":0.0,"evidenceSpans":[{"start":0,"end":12}]}],"claims":[{"id":"c1","text":"string","claimTypeId":"${claimTypes.join('|')}","entityRefs":["e1"],"relationRefs":["r1"],"stance":"supports|opposes|neutral|interprets","confidence":0.0,"evidenceSpans":[{"start":0,"end":12}]}]}`,
    'Use entities, relations, claims as arrays even when empty.',
    'Every entity, relation, and claim must have a unique response-local id.',
    'evidenceSpans use zero-based UTF-16 offsets into the provided source text. Include the narrowest directly supporting span for every fact.',
    'Relations must use sourceRef and targetRef. Claims must reference only directly relevant entity and relation ids.',
    'Do not attach unrelated relations from the same text to a claim.',
    'Put explicit same-entity names from other languages into aliases only when the source text supports them.',
    'Do not invent translated aliases just to make the graph multilingual.',
    'Every sourceRef, targetRef, entityRef, and relationRef must match a response-local id.',
    'Do not use generic role words as entities unless the source explicitly names them.',
    'Preserve explicit negation, uncertainty, and temporal order.',
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

function createEvidence(
  input: GraphExtractionChunkInput,
  providerEpochId: string,
): GraphEvidenceRecord {
  return {
    id: createId('evidence', input.entryId, input.contentHash, providerEpochId),
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

function createFactProvenance(
  input: GraphExtractionChunkInput,
  job: GraphExtractionJobRecord,
  rawResponse: string,
  generatedAt: number,
): GraphFactProvenance {
  return {
    entryId: input.entryId,
    contentHash: input.contentHash,
    contractVersion: job.contractVersion,
    providerEpochId: job.providerEpochId,
    rawResponseHash: createId('graph-raw-response-body', rawResponse),
    observedModel: job.observedModel,
    generatedAt,
  };
}

function createRejectedFact(
  input: GraphExtractionChunkInput,
  reason: string,
  rawFact: unknown,
): GraphRejectedFactRecord {
  return {
    id: createId('rejected', input.entryId, reason, JSON.stringify(rawFact)),
    filePath: input.filePath,
    entryId: input.entryId,
    reason,
    rawFact,
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
    ontologySchemaId: input.knowledgeContract.id,
    ontologyVersion: input.knowledgeContract.version,
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
      input.knowledgeContract.id,
      relation.relationTypeId,
      sourceEntityId,
      targetEntityId,
      evidenceId,
    ),
    ontologySchemaId: input.knowledgeContract.id,
    ontologyVersion: input.knowledgeContract.version,
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

function requireSourceSpans(
  spans: ExtractedEntity['evidenceSpans'],
  contentLength: number,
): NonNullable<GraphEntityRecord['sourceSpans']> {
  return normalizeGraphSourceSpansRust(spans, contentLength) ?? [];
}

function createId(...parts: string[]): string {
  return createGraphIdRust(parts) ?? '';
}

export function createGraphProviderEpochId(
  provider: LLMProvider,
  extractionModelKey: string,
  contractVersion: number,
): string {
  return createId(
    'graph-provider-epoch',
    extractionModelKey,
    JSON.stringify(provider.capability),
    String(contractVersion),
  );
}
