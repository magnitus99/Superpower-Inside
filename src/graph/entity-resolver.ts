import type { OntologySchema } from '../ontology/schema';
import type {
  GraphEntityRecord,
  KnowledgeGraphStore,
  PendingEntityMergeRecord,
} from './store';

export interface EntityResolverOptions {
  autoMergeThreshold: number;
  pendingMergeThreshold: number;
}

export interface EntityResolutionInput {
  ontologySchema: OntologySchema;
  typeId: string;
  canonicalName: string;
  aliases: string[];
  description: string;
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
      const score = scoreEntityMatch(entity, input);
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

function scoreEntityMatch(entity: GraphEntityRecord, input: EntityResolutionInput): number {
  const candidateNames = new Set([
    normalizeEntityName(input.canonicalName),
    ...input.aliases.map(normalizeEntityName),
  ]);
  const existingNames = new Set([
    normalizeEntityName(entity.canonicalName),
    ...entity.aliases.map(normalizeEntityName),
  ]);

  const hasExactNameOrAlias = hasIntersection(candidateNames, existingNames);
  if (hasExactNameOrAlias) return 1;

  const nameScore = maxNameSimilarity(candidateNames, existingNames);
  const aliasScore = 0;
  const descriptionScore = jaccardTokenScore(
    `${entity.canonicalName} ${entity.description}`,
    `${input.canonicalName} ${input.description}`,
  );
  const ontologyTypeScore = entity.typeId === input.typeId ? 1 : 0;
  const coOccurrenceScore = ontologyTypeScore === 1 ? 0.5 : 0;

  return (
    0.35 * nameScore +
    0.25 * aliasScore +
    0.2 * descriptionScore +
    0.1 * ontologyTypeScore +
    0.1 * coOccurrenceScore
  );
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
  return jaccardTokenScore(left, right);
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
