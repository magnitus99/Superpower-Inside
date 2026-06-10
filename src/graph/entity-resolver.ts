import type { EmbeddingProvider } from '../llm/embedding';
import type { OntologySchema } from '../ontology/schema';
import {
  cosineSimilarityRust,
  normalizeEntityNameRust,
  scoreEntityMatchRust,
  type RustEntityMatchInput,
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
    const compatibleEntities = entities.filter(
      (entity) =>
        entity.ontologySchemaId === input.ontologySchema.id && entity.typeId === input.typeId,
    );

    let bestMatch: { entity: GraphEntityRecord; score: number } | null = null;
    for (const entity of compatibleEntities) {
      const score = await scoreEntityMatch(entity, input, this.options.embeddingProvider);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { entity, score };
      }
    }

    if (bestMatch && bestMatch.score >= this.options.autoMergeThreshold) {
      return {
        status: 'auto-merge',
        entityId: bestMatch.entity.id,
        matchedEntityId: bestMatch.entity.id,
        mergeScore: bestMatch.score,
      };
    }

    if (bestMatch && bestMatch.score >= this.options.pendingMergeThreshold) {
      await this.store.addPendingEntityMerge(
        createPendingMergeRecord(input.ontologySchema.id, bestMatch.entity.id, candidateId, bestMatch.score),
      );
      return {
        status: 'pending-merge',
        entityId: candidateId,
        matchedEntityId: bestMatch.entity.id,
        mergeScore: bestMatch.score,
      };
    }

    return {
      status: 'new',
      entityId: candidateId,
      mergeScore: bestMatch?.score ?? 0,
      matchedEntityId: bestMatch?.entity.id,
    };
  }
}

export function normalizeEntityName(name: string): string {
  const rustResult = normalizeEntityNameRust(name);
  if (rustResult !== null) return rustResult;
  return normalizeEntityNameWithTypeScript(name);
}

function normalizeEntityNameWithTypeScript(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_/\\|()[\]{}"'「」『』【】《》.,;:!?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function createEntityId(
  ontologySchemaId: string,
  typeId: string,
  canonicalName: string,
): string {
  return `entity::${ontologySchemaId}::${typeId}::${normalizeEntityName(canonicalName).replaceAll(' ', '-')}`;
}

async function scoreEntityMatch(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingProvider?: EmbeddingProvider,
): Promise<number> {
  const rustInput = createRustEntityMatchInput(entity, input, 0);
  const rustScoreWithoutEmbedding = scoreEntityMatchRust(rustInput);
  if (rustScoreWithoutEmbedding === 1 || !embeddingProvider) {
    if (rustScoreWithoutEmbedding !== null) return rustScoreWithoutEmbedding;
  }

  const embeddingScore = await embeddingSimilarityScore(entity, input, embeddingProvider);
  const rustScore = scoreEntityMatchRust({
    ...rustInput,
    embeddingScore,
  });
  if (rustScore !== null) return rustScore;

  return scoreEntityMatchWithTypeScript(entity, input, embeddingScore);
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

function scoreEntityMatchWithTypeScript(
  entity: GraphEntityRecord,
  input: EntityResolutionInput,
  embeddingScore: number,
): number {
  const candidateNames = new Set([
    normalizeEntityNameWithTypeScript(input.canonicalName),
    ...input.aliases.map(normalizeEntityNameWithTypeScript),
  ]);
  const existingNames = new Set([
    normalizeEntityNameWithTypeScript(entity.canonicalName),
    ...entity.aliases.map(normalizeEntityNameWithTypeScript),
  ]);

  const hasExactNameOrAlias = hasIntersection(candidateNames, existingNames);
  if (hasExactNameOrAlias) return 1;

  const nameScore = maxNameSimilarity(candidateNames, existingNames);
  const aliasScore = maxAliasContainmentScore(candidateNames, existingNames);
  const descriptionScore = jaccardTokenScore(
    `${entity.canonicalName} ${entity.description}`,
    `${input.canonicalName} ${input.description}`,
  );
  const evidenceScore = sharedEvidenceScore(entity.evidenceIds, input.evidenceIds ?? []);
  const ontologyTypeScore = entity.typeId === input.typeId ? 1 : 0;
  const semanticScore = Math.max(descriptionScore, embeddingScore);

  const weightedScore = clampScore(
    0.42 * nameScore +
      0.18 * aliasScore +
      0.22 * semanticScore +
      0.18 * evidenceScore +
      0.08 * ontologyTypeScore,
  );
  const semanticBoost =
    ontologyTypeScore === 1 && embeddingScore >= 0.92 && descriptionScore >= 0.5 ? 0.74 : 0;
  return Math.max(weightedScore, semanticBoost);
}

function maxNameSimilarity(left: Set<string>, right: Set<string>): number {
  let best = 0;
  for (const leftName of left) {
    for (const rightName of right) {
      best = Math.max(best, nameSimilarity(leftName, rightName));
    }
  }
  return best;
}

function nameSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = removeWeakNameTokens(tokenize(left));
  const rightTokens = removeWeakNameTokens(tokenize(right));
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const intersection = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const overlap = intersection / Math.min(leftTokens.length, rightTokens.length);
  return Math.max(jaccardTokenScore(left, right), overlap);
}

function maxAliasContainmentScore(left: Set<string>, right: Set<string>): number {
  let best = 0;
  for (const leftName of left) {
    for (const rightName of right) {
      best = Math.max(best, containmentScore(leftName, rightName));
    }
  }
  return best;
}

function containmentScore(left: string, right: string): number {
  if (!left || !right || left === right) return left === right ? 1 : 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (!longer.includes(shorter)) return 0;
  return Math.max(0.72, shorter.length / longer.length);
}

function sharedEvidenceScore(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.some((evidenceId) => rightSet.has(evidenceId)) ? 1 : 0;
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
    return cosineSimilarity(left, right);
  } catch {
    return 0;
  }
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const rustScore = cosineSimilarityRust(left, right);
  if (rustScore !== null) return rustScore;
  return cosineSimilarityWithTypeScript(left, right);
}

function cosineSimilarityWithTypeScript(left: readonly number[], right: readonly number[]): number {
  const dimensions = Math.min(left.length, right.length);
  if (dimensions === 0) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < dimensions; index++) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    normLeft += leftValue * leftValue;
    normRight += rightValue * rightValue;
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

function removeWeakNameTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !/^(the|of|a|an)$/iu.test(token));
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function jaccardTokenScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function tokenize(text: string): string[] {
  return normalizeEntityName(text).split(' ').filter(Boolean);
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function createPendingMergeRecord(
  ontologySchemaId: string,
  existingEntityId: string,
  candidateEntityId: string,
  mergeScore: number,
): PendingEntityMergeRecord {
  return {
    id: `pending-entity-merge::${existingEntityId}::${candidateEntityId}`,
    ontologySchemaId,
    existingEntityId,
    candidateEntityId,
    mergeScore,
    reason: 'threshold',
    updatedAt: Date.now(),
  };
}
