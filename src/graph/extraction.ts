import type { LLMProvider } from '../llm/providers';
import {
  type OntologySchema,
  validateOntologyRelation,
} from '../ontology/schema';
import {
  EntityResolver,
  normalizeEntityName,
  type EntityResolverOptions,
} from './entity-resolver';
import {
  type GraphClaimRecord,
  type GraphClaimStance,
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
}

interface ExtractedGraphPayload {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  claims: ExtractedClaim[];
}

interface ExtractedEntity {
  name: string;
  typeId: string;
  description?: string;
  aliases?: string[];
  confidence?: number;
}

interface ExtractedRelation {
  source: string;
  target: string;
  relationTypeId: string;
  description?: string;
  confidence?: number;
}

interface ExtractedClaim {
  text: string;
  claimTypeId: string;
  entityNames?: string[];
  stance?: GraphClaimStance;
  confidence?: number;
}

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
    const cacheKey = {
      entryId: input.entryId,
      contentHash: input.contentHash,
      extractionModelKey: input.extractionModelKey,
      ontologySchemaId: input.ontologySchema.id,
      ontologyVersion: input.ontologySchema.version,
    };
    if (await this.store.isExtractionCached(cacheKey)) return;

    const evidence = createEvidence(input);
    await this.store.addEvidence(evidence);

    const rawResponse = await this.provider.chat([
      { role: 'system', content: buildExtractionSystemPrompt(input.ontologySchema) },
      { role: 'user', content: buildExtractionUserPrompt(input) },
    ], 0);
    const payload = parseExtractedGraphPayload(rawResponse);
    if (!payload) {
      await this.reject(input, 'invalid-json', rawResponse);
      return;
    }

    await this.storeAcceptedFacts(input, evidence, payload);
    await this.store.markExtractionCached({ ...cacheKey, updatedAt: Date.now() });
  }

  private async storeAcceptedFacts(
    input: GraphExtractionChunkInput,
    evidence: GraphEvidenceRecord,
    payload: ExtractedGraphPayload,
  ): Promise<void> {
    const now = Date.now();
    const entitiesByName = new Map<string, GraphEntityRecord>();

    for (const entity of payload.entities) {
      if (!isKnownEntityType(input.ontologySchema, entity.typeId)) {
        await this.reject(input, 'unknown-entity-type', entity);
        continue;
      }
      const resolution = await this.entityResolver.resolve({
        ontologySchema: input.ontologySchema,
        typeId: entity.typeId,
        canonicalName: entity.name,
        aliases: entity.aliases ?? [],
        description: entity.description ?? '',
        evidenceIds: [evidence.id],
      });
      const record = createEntityRecord(input, evidence.id, entity, resolution.entityId, now);
      entitiesByName.set(normalizeName(entity.name), record);
      for (const alias of entity.aliases ?? []) {
        entitiesByName.set(normalizeName(alias), record);
      }
      await this.store.upsertEntity(record);
    }

    const relationIdsByKey = new Map<string, string>();
    for (const relation of payload.relations) {
      const source = entitiesByName.get(normalizeName(relation.source));
      const target = entitiesByName.get(normalizeName(relation.target));
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
      relationIdsByKey.set(`${normalizeName(relation.source)}\u0000${normalizeName(relation.target)}`, record.id);
      await this.store.addRelation(record);
    }

    for (const claim of payload.claims) {
      if (!isKnownClaimType(input.ontologySchema, claim.claimTypeId)) {
        await this.reject(input, 'unknown-claim-type', claim);
        continue;
      }
      const entityIds = (claim.entityNames ?? [])
        .map((name) => entitiesByName.get(normalizeName(name))?.id)
        .filter((id): id is string => typeof id === 'string');
      const record = createClaimRecord(evidence.id, claim, entityIds, [...relationIdsByKey.values()], now);
      await this.store.addClaim(record);
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
  }
}

function parseExtractedGraphPayload(rawResponse: string): ExtractedGraphPayload | null {
  const jsonText = extractJsonObject(rawResponse);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as Partial<ExtractedGraphPayload>;
    if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relations) || !Array.isArray(parsed.claims)) {
      return null;
    }
    return {
      entities: parsed.entities.filter(isExtractedEntity),
      relations: parsed.relations.filter(isExtractedRelation),
      claims: parsed.claims.filter(isExtractedClaim),
    };
  } catch {
    return null;
  }
}

function extractJsonObject(rawResponse: string): string | null {
  const trimmed = rawResponse.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  if (fenced?.startsWith('{') && fenced.endsWith('}')) {
    return fenced;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function buildExtractionSystemPrompt(schema: OntologySchema): string {
  const entityTypes = schema.entityTypes.map((entityType) => entityType.id).join(', ');
  const relationTypes = schema.relationTypes.map((relationType) => relationType.id).join(', ');
  const claimTypes = schema.claimTypes.map((claimType) => claimType.id).join(', ');
  return [
    'Extract ontology-guided graph facts as JSON only.',
    `Ontology schema: ${schema.id}@${schema.version}`,
    `Entity types: ${entityTypes}`,
    `Relation types: ${relationTypes}`,
    `Claim types: ${claimTypes}`,
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

function isKnownEntityType(schema: OntologySchema, typeId: string): boolean {
  return schema.entityTypes.some((entityType) => entityType.id === typeId);
}

function isKnownClaimType(schema: OntologySchema, typeId: string): boolean {
  return schema.claimTypes.some((claimType) => claimType.id === typeId);
}

function isExtractedEntity(value: unknown): value is ExtractedEntity {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.typeId === 'string' &&
    value.typeId.trim().length > 0
  );
}

function isExtractedRelation(value: unknown): value is ExtractedRelation {
  return (
    isRecord(value) &&
    typeof value.source === 'string' &&
    value.source.trim().length > 0 &&
    typeof value.target === 'string' &&
    value.target.trim().length > 0 &&
    typeof value.relationTypeId === 'string' &&
    value.relationTypeId.trim().length > 0
  );
}

function isExtractedClaim(value: unknown): value is ExtractedClaim {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    value.text.trim().length > 0 &&
    typeof value.claimTypeId === 'string' &&
    value.claimTypeId.trim().length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeName(name: string): string {
  return normalizeEntityName(name);
}

function normalizeConfidence(confidence: unknown): number {
  return typeof confidence === 'number' && Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0.5;
}

function createId(...parts: string[]): string {
  return parts.map(sanitizeIdPart).join('::');
}

function sanitizeIdPart(part: string): string {
  return part.trim().toLowerCase().replace(/[^a-z0-9가-힣_.:-]+/giu, '-');
}
