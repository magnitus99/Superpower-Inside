import type { EmbeddingProvider } from '../llm/embedding';
import type { KnowledgeGraphContract } from './knowledge-contract';
import {
  cosineSimilarityRust,
  createEntityIdRust,
  createPendingEntityMergeIdRust,
  createEntityIdFallback,
  normalizeEntityNameRust,
  planEntityResolutionRust,
  scoreEntityMatchRust,
  type RustEntityMatchInput,
  type RustEntityResolutionCandidate,
} from '../rag/rust-core';
import type {
  GraphEntityRecord,
  KnowledgeGraphStore,
  PendingEntityMergeRecord,
} from './store';
import {
  getEntityLabelValues,
  hasCrossLanguageGraphEntityLabelPair,
  hasExactGraphEntityLabelMatch,
  type GraphEntityLabelRecord,
} from './entity-labels';

export interface EntityResolverOptions {
  autoMergeThreshold: number;
  pendingMergeThreshold: number;
  embeddingProvider?: EmbeddingProvider;
  persistPendingMerge?: boolean;
}

export interface EntityResolutionInput {
  knowledgeContract: KnowledgeGraphContract;
  typeId: string;
  canonicalName: string;
  aliases: string[];
  labels?: GraphEntityLabelRecord[];
  description: string;
  evidenceIds?: string[];
}

export type EntityResolutionStatus = 'new' | 'auto-merge' | 'pending-merge';

export interface EntityResolutionResult {
  status: EntityResolutionStatus;
  entityId: string;
  mergeScore: number;
  matchedEntityId?: string;
  pendingMerge?: PendingEntityMergeRecord;
}

export class EntityResolver {
  constructor(
    private readonly store: KnowledgeGraphStore,
    private readonly options: EntityResolverOptions,
  ) {}

  async resolve(input: EntityResolutionInput): Promise<EntityResolutionResult> {
    const candidateId = createEntityId(input.knowledgeContract.id, input.typeId, input.canonicalName);
    const entities = await this.store.getEntities();
    const candidates = await createScoredResolutionCandidates(
      entities,
      input,
      this.options.embeddingProvider,
      this.options.autoMergeThreshold,
    );
    const resolutionPlan = planEntityResolutionRust({
      ontologySchemaId: input.knowledgeContract.id,
      typeId: input.typeId,
      candidateEntityId: candidateId,
      autoMergeThreshold: this.options.autoMergeThreshold,
      pendingMergeThreshold: this.options.pendingMergeThreshold,
      candidates,
    });
    const safePlan: EntityResolutionResult = resolutionPlan ?? {
      status: 'new',
      entityId: candidateId,
      mergeScore: 0,
      matchedEntityId: undefined,
    };
    if (safePlan.status === 'pending-merge' && safePlan.matchedEntityId) {
      const pendingMerge = createPendingMergeRecord(
        input.knowledgeContract.id,
        safePlan.matchedEntityId,
        candidateId,
        safePlan.mergeScore,
      );
      if (this.options.persistPendingMerge !== false) {
        await this.store.addPendingEntityMerge(pendingMerge);
      }
      return {
        ...safePlan,
        pendingMerge,
      };
    }

    return safePlan;
  }
}

export function normalizeEntityName(name: string): string {
  const rustResult = normalizeEntityNameRust(name);
  return rustResult ?? '';
}

export function createEntityId(
  ontologySchemaId: string,
  typeId: string,
  canonicalName: string,
): string {
  const rustResult = createEntityIdRust(ontologySchemaId, typeId, canonicalName);
  if (rustResult !== null) {
    const parts = rustResult.split('::');
    if (parts.length >= 4 && parts[0] === 'entity') {
      return rustResult;
    }
  }
  return createEntityIdFallback(ontologySchemaId, typeId, canonicalName);
}

async function createScoredResolutionCandidates(
  entities: readonly GraphEntityRecord[],
  input: EntityResolutionInput,
  embeddingProvider?: EmbeddingProvider,
  autoMergeThreshold?: number,
): Promise<RustEntityResolutionCandidate[]> {
  const candidates: RustEntityResolutionCandidate[] = [];
  for (const entity of entities) {
    const score =
      entity.ontologySchemaId === input.knowledgeContract.id && entity.typeId === input.typeId
        ? await scoreEntityMatch(entity, input, embeddingProvider, autoMergeThreshold)
        : 0;
    candidates.push({
      entityId: entity.id,
      ontologySchemaId: entity.ontologySchemaId,
      typeId: entity.typeId,
      score,
    });
  }
  return candidates;
}

async function scoreEntityMatch(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingProvider?: EmbeddingProvider,
  autoMergeThreshold?: number,
): Promise<number> {
  const rustInput = createRustEntityMatchInput(entity, input, 0);
  const candidateNames = getResolutionInputLabelValues(input);
  const existingNames = getEntityLabelValues(entity);
  const exactLabelMatch = hasExactGraphEntityLabelMatch(candidateNames, existingNames);
  const rustScoreWithoutEmbedding = scoreEntityMatchRust(rustInput);
  if (rustScoreWithoutEmbedding === 1 || !embeddingProvider) {
    return rustScoreWithoutEmbedding ?? 0;
  }

  const embeddingScore = await embeddingSimilarityScore(entity, input, embeddingProvider);
  const rustScore = scoreEntityMatchRust({
    ...rustInput,
    embeddingScore,
  });
  return capCrossLanguageSemanticScore(
    rustScore ?? 0,
    exactLabelMatch,
    hasCrossLanguageGraphEntityLabelPair(candidateNames, existingNames),
    autoMergeThreshold,
  );
}

function createRustEntityMatchInput(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingScore: number,
): RustEntityMatchInput {
  return {
    candidateNames: getResolutionInputLabelValues(input),
    existingNames: getEntityLabelValues(entity),
    candidateDescription: `${input.canonicalName} ${input.description}`,
    existingDescription: `${entity.canonicalName} ${entity.description}`,
    candidateEvidenceIds: input.evidenceIds ?? [],
    existingEvidenceIds: entity.evidenceIds,
    sameType: entity.typeId === input.typeId,
    embeddingScore,
  };
}

async function embeddingSimilarityScore(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingProvider?: EmbeddingProvider,
): Promise<number> {
  if (!embeddingProvider) return 0;
  try {
    const [left, right] = await embeddingProvider.embedBatch([
      `${getEntityLabelValues(entity).join('\n')}\n${entity.description}`.trim(),
      `${getResolutionInputLabelValues(input).join('\n')}\n${input.description}`.trim(),
    ]);
    return cosineSimilarityFromRust(left, right);
  } catch {
    return 0;
  }
}

function cosineSimilarityFromRust(left: readonly number[], right: readonly number[]): number {
  const rustScore = cosineSimilarityRust(left, right);
  return rustScore ?? 0;
}

function getResolutionInputLabelValues(input: EntityResolutionInput): string[] {
  return [
    input.canonicalName,
    ...input.aliases,
    ...(input.labels ?? []).map((label) => label.value),
  ].filter((value) => value.trim().length > 0);
}

function capCrossLanguageSemanticScore(
  score: number,
  exactLabelMatch: boolean,
  hasCrossLanguagePair: boolean,
  autoMergeThreshold: number | undefined,
): number {
  if (exactLabelMatch || !hasCrossLanguagePair || autoMergeThreshold === undefined) {
    return score;
  }
  if (score < autoMergeThreshold) return score;
  return Math.max(0, autoMergeThreshold - 0.000001);
}

function createPendingMergeRecord(
  ontologySchemaId: string,
  existingEntityId: string,
  candidateEntityId: string,
  mergeScore: number,
): PendingEntityMergeRecord {
  const pendingMergeId = createPendingEntityMergeIdRust(existingEntityId, candidateEntityId);
  return {
    id: pendingMergeId ?? `pending-entity-merge::${existingEntityId}::${candidateEntityId}`,
    ontologySchemaId,
    existingEntityId,
    candidateEntityId,
    mergeScore,
    reason: 'threshold',
    updatedAt: Date.now(),
  };
}
