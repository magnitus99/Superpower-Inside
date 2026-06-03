import type { LLMProvider } from '../llm/providers';
import { type OntologySchema, validateOntologyRelation } from '../ontology/schema';
import { EntityResolver, normalizeEntityName, type EntityResolverOptions } from './entity-resolver';
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
  signal?: AbortSignal;
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

type GraphPayloadParseResult =
  | { ok: true; payload: ExtractedGraphPayload }
  | { ok: false; reason: 'invalid-json' | 'schema-shape-mismatch'; rawFact: unknown };

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
    if (await this.store.isExtractionCached(cacheKey)) return;
    throwIfGraphExtractionAborted(input.signal);

    const evidence = createEvidence(input);
    await this.store.addEvidence(evidence);
    throwIfGraphExtractionAborted(input.signal);

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
    const parsed = parseExtractedGraphPayload(rawResponse);
    if (!parsed.ok) {
      await this.reject(input, parsed.reason, parsed.rawFact);
      return;
    }

    await this.storeAcceptedFacts(input, evidence, parsed.payload);
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
      relationIdsByKey.set(
        `${normalizeName(relation.source)}\u0000${normalizeName(relation.target)}`,
        record.id,
      );
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
      const record = createClaimRecord(
        evidence.id,
        claim,
        entityIds,
        [...relationIdsByKey.values()],
        now,
      );
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

function parseExtractedGraphPayload(rawResponse: string): GraphPayloadParseResult {
  const jsonText = extractJsonObject(rawResponse);
  if (!jsonText) return { ok: false, reason: 'invalid-json', rawFact: rawResponse };
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const normalized = normalizeExtractedGraphPayload(parsed);
    if (!normalized) {
      return { ok: false, reason: 'schema-shape-mismatch', rawFact: parsed };
    }

    const { payload, rawFactCount } = normalized;
    const { entities, relations, claims } = payload;
    const validFactCount = entities.length + relations.length + claims.length;
    if (rawFactCount > 0 && validFactCount === 0) {
      return { ok: false, reason: 'schema-shape-mismatch', rawFact: parsed };
    }
    return {
      ok: true,
      payload: {
        entities,
        relations,
        claims,
      },
    };
  } catch {
    return { ok: false, reason: 'invalid-json', rawFact: rawResponse };
  }
}

function normalizeExtractedGraphPayload(
  value: unknown,
): { payload: ExtractedGraphPayload; rawFactCount: number } | null {
  if (!isRecord(value)) return null;

  const entityItems = collectEntityItems(value);
  const relationItems = collectRecordItems(value.relations);
  const claimItems = collectRecordItems(value.claims);
  const hasKnownShape =
    'entities' in value ||
    'relations' in value ||
    'claims' in value ||
    entityItems.inferredFromTopLevel;

  if (!hasKnownShape) return null;

  const entities = entityItems.items
    .map((item) => normalizeExtractedEntity(item.value, item.fallbackName))
    .filter((entity): entity is ExtractedEntity => entity !== null);
  const relations = relationItems
    .map((item) => normalizeExtractedRelation(item.value))
    .filter((relation): relation is ExtractedRelation => relation !== null);
  const claims = claimItems
    .map((item) => normalizeExtractedClaim(item.value))
    .filter((claim): claim is ExtractedClaim => claim !== null);

  return {
    payload: { entities, relations, claims },
    rawFactCount: entityItems.items.length + relationItems.length + claimItems.length,
  };
}

function collectEntityItems(payload: Record<string, unknown>): {
  items: { value: unknown; fallbackName?: string }[];
  inferredFromTopLevel: boolean;
} {
  if ('entities' in payload) {
    return { items: collectRecordItems(payload.entities), inferredFromTopLevel: false };
  }

  const items = Object.entries(payload)
    .filter(
      ([, value]) =>
        isRecord(value) &&
        getStringField(value, ['typeId', 'type_id', 'entityTypeId', 'entity_type', 'type']) !==
          undefined,
    )
    .map(([key, value]) => ({ value, fallbackName: key }));
  return { items, inferredFromTopLevel: items.length > 0 };
}

function collectRecordItems(value: unknown): { value: unknown; fallbackName?: string }[] {
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item) => ({ value: item }));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, item]) => ({ value: item, fallbackName: key }));
}

function normalizeExtractedEntity(value: unknown, fallbackName?: string): ExtractedEntity | null {
  if (!isRecord(value)) return null;
  const name = getStringField(value, ['name', 'canonicalName', 'label', 'id']) ?? fallbackName;
  const typeId = getStringField(value, [
    'typeId',
    'type_id',
    'entityTypeId',
    'entity_type',
    'type',
  ]);
  if (!name || !typeId) return null;
  return {
    name,
    typeId,
    description: getStringField(value, ['description', 'desc']),
    aliases: getStringArrayField(value, ['aliases', 'alias']),
    confidence: getNumberField(value, ['confidence', 'score']),
  };
}

function normalizeExtractedRelation(value: unknown): ExtractedRelation | null {
  if (!isRecord(value)) return null;
  const source = getStringField(value, ['source', 'from', 'subject']);
  const target = getStringField(value, ['target', 'to', 'object']);
  const relationTypeId = getStringField(value, [
    'relationTypeId',
    'relation_type_id',
    'relationType',
    'relation_type',
    'typeId',
    'type',
    'relation',
  ]);
  if (!source || !target || !relationTypeId) return null;
  return {
    source,
    target,
    relationTypeId,
    description: getStringField(value, ['description', 'desc']),
    confidence: getNumberField(value, ['confidence', 'score']),
  };
}

function normalizeExtractedClaim(value: unknown): ExtractedClaim | null {
  if (!isRecord(value)) return null;
  const text = getStringField(value, ['text', 'claim', 'statement']);
  const claimTypeId = getStringField(value, [
    'claimTypeId',
    'claim_type_id',
    'claimType',
    'claim_type',
    'typeId',
    'type',
  ]);
  if (!text || !claimTypeId) return null;
  return {
    text,
    claimTypeId,
    entityNames: getClaimEntityNames(value),
    stance: getGraphClaimStance(value.stance),
    confidence: getNumberField(value, ['confidence', 'score']),
  };
}

function getClaimEntityNames(value: Record<string, unknown>): string[] | undefined {
  const direct = getStringArrayField(value, ['entityNames', 'entity_names', 'entities']);
  const names = direct ?? [];
  for (const key of ['entity', 'subject', 'source', 'object', 'target']) {
    const candidate = getStringField(value, [key]);
    if (candidate) names.push(candidate);
  }
  return names.length > 0 ? [...new Set(names)] : undefined;
}

function getStringField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return undefined;
}

function getStringArrayField(
  value: Record<string, unknown>,
  keys: readonly string[],
): string[] | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return [candidate.trim()];
    }
    if (Array.isArray(candidate)) {
      const strings = candidate
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
      if (strings.length > 0) return strings;
    }
  }
  return undefined;
}

function getNumberField(
  value: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function getGraphClaimStance(value: unknown): GraphClaimStance | undefined {
  return value === 'supports' ||
    value === 'opposes' ||
    value === 'neutral' ||
    value === 'interprets'
    ? value
    : undefined;
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
    'Return exactly one JSON object with this shape:',
    '{"entities":[{"name":"string","typeId":"person|organization|place|work|concept|event|argument|evidence","description":"string","aliases":["string"],"confidence":0.0}],"relations":[{"source":"entity name","target":"entity name","relationTypeId":"authored|mentions|supports|opposes|collaborated_with|causes|influences|part_of|located_in|interprets","description":"string","confidence":0.0}],"claims":[{"text":"string","claimTypeId":"factual_claim|interpretive_claim|evaluative_claim","entityNames":["entity name"],"stance":"supports|opposes|neutral|interprets","confidence":0.0}]}',
    'Use entities, relations, claims as arrays even when empty.',
    'Use typeId, relationTypeId, claimTypeId exactly. Do not use type, relation, claim_type, subject, object, or keyed objects.',
    'Every relation source and target must match an entity name in entities.',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function throwIfGraphExtractionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('GraphRAG extraction cancelled', 'AbortError');
  }
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
  return part
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_.:-]+/giu, '-');
}
