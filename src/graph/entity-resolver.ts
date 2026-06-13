import type { EmbeddingProvider } from '../llm/embedding';
import type { OntologySchema } from '../ontology/schema';
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

export interface EntityResolverOptions {
  autoMergeThreshold: number;
  pendingMergeThreshold: number;
  embeddingProvider?: EmbeddingProvider;
}

export interface EntityResolutionInput {
  ontologySchema: OntologySchema;
  typeId: string;
  canonicalName: string;
  aliases: string[];
  description: string;
  evidenceIds?: string[];
}

export type EntityResolutionStatus = 'new' | 'auto-merge' | 'pending-merge';

export interface EntityResolutionResult {
  status: EntityResolutionStatus;
  entityId: string;
  mergeScore: number;
  matchedEntityId?: string;
}

export class EntityResolver {
  constructor(
    private readonly store: KnowledgeGraphStore,
    private readonly options: EntityResolverOptions,
  ) {}

  async resolve(input: EntityResolutionInput): Promise<EntityResolutionResult> {
    const candidateId = createEntityId(input.ontologySchema.id, input.typeId, input.canonicalName);
    const entities = await this.store.getEntities();
    const candidates = await createScoredResolutionCandidates(
      entities,
      input,
      this.options.embeddingProvider,
    );
    const resolutionPlan = planEntityResolutionRust({
      ontologySchemaId: input.ontologySchema.id,
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
      await this.store.addPendingEntityMerge(
        createPendingMergeRecord(
          input.ontologySchema.id,
          safePlan.matchedEntityId,
          candidateId,
          safePlan.mergeScore,
        ),
      );
      return safePlan;
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
): Promise<RustEntityResolutionCandidate[]> {
  const candidates: RustEntityResolutionCandidate[] = [];
  for (const entity of entities) {
    const score =
      entity.ontologySchemaId === input.ontologySchema.id && entity.typeId === input.typeId
        ? await scoreEntityMatch(entity, input, embeddingProvider)
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
): Promise<number> {
  const rustInput = createRustEntityMatchInput(entity, input, 0);
  const rustScoreWithoutEmbedding = scoreEntityMatchRust(rustInput);
  if (rustScoreWithoutEmbedding === 1 || !embeddingProvider) {
    return rustScoreWithoutEmbedding ?? 0;
  }

  const embeddingScore = await embeddingSimilarityScore(entity, input, embeddingProvider);
  const rustScore = scoreEntityMatchRust({
    ...rustInput,
    embeddingScore,
  });
  return rustScore ?? 0;
}

function createRustEntityMatchInput(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingScore: number,
): RustEntityMatchInput {
  return {
    candidateNames: [input.canonicalName, ...input.aliases],
    existingNames: [entity.canonicalName, ...entity.aliases],
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
      `${entity.canonicalName}\n${entity.description}`.trim(),
      `${input.canonicalName}\n${input.description}`.trim(),
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
