import type { OntologySchema } from '../ontology/schema';
import type { LLMProvider } from '../llm/providers';
import type {
  CandidateProvider,
  RagRetrievalRequest,
  RetrievalCandidate,
  RetrievalCandidateSource,
} from '../rag/retrieval-pipeline';
import type { VectorEntry, VectorStore } from '../rag/store';
import { rankTopKPairsRust, scoreLocalEvidenceRust } from '../rag/rust-core';
import { normalizeEntityName } from './entity-resolver';
import type {
  GraphClaimRecord,
  GraphCommunityRecord,
  GraphEntityRecord,
  GraphEvidenceRecord,
  GraphRelationRecord,
  KnowledgeGraphStore,
} from './store';

export type GraphQueryType =
  | 'factual'
  | 'relational'
  | 'thematic'
  | 'comparative'
  | 'source-seeking'
  | 'ordinary-rag';

export interface GraphQueryPlan {
  type: GraphQueryType;
  queryMode: GraphRagQueryMode | 'none';
  traversalDepth: number;
  evidenceFirst: boolean;
  entityHints: string[];
}

export type GraphRagQueryMode = 'auto' | 'local' | 'global' | 'hybrid';

export interface GraphRagQueryEngineOptions {
  queryMode?: GraphRagQueryMode;
  queryPlanner?: GraphQueryPlanner;
}

export interface GraphQueryPlanner {
  plan(question: string, ontologySchema: OntologySchema): Promise<GraphQueryPlan>;
}

interface EntityMatch {
  entity: GraphEntityRecord;
  score: number;
}

interface EvidenceScore {
  evidenceId: string;
  score: number;
}

export class GraphRagQueryEngine {
  private readonly queryMode: GraphRagQueryMode;
  private readonly queryPlanner: GraphQueryPlanner | undefined;

  constructor(
    private readonly graphStore: KnowledgeGraphStore,
    private readonly vectorStore: VectorStore,
    private readonly ontologySchema: OntologySchema,
    options: GraphRagQueryEngineOptions = {},
  ) {
    this.queryMode = options.queryMode ?? 'auto';
    this.queryPlanner = options.queryPlanner;
  }

  async query(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const plan = this.queryMode === 'global' ? undefined : await this.planQuery(request.question);
    if (this.queryMode === 'local') {
      return this.queryLocal(request, plan);
    }
    if (this.queryMode === 'global') {
      return this.queryGlobal(request);
    }
    if (this.queryMode === 'hybrid') {
      return mergeCandidates(
        await this.queryLocal(request, plan),
        await this.queryGlobal(request),
        request.candidateLimit,
      );
    }

    const autoPlan = plan ?? planGraphQuery(request.question);
    if (autoPlan.queryMode === 'none') {
      return [];
    }
    if (autoPlan.queryMode === 'hybrid') {
      return mergeCandidates(
        await this.queryLocal(request, autoPlan),
        await this.queryGlobal(request),
        request.candidateLimit,
      );
    }
    if (autoPlan.queryMode === 'global') {
      return this.queryGlobal(request);
    }
    if (autoPlan.evidenceFirst) {
      return this.queryEvidenceFirst(request, autoPlan);
    }
    return this.queryLocal(request, autoPlan);
  }

  private async planQuery(question: string): Promise<GraphQueryPlan> {
    if (!this.queryPlanner) return planGraphQuery(question);
    try {
      return await this.queryPlanner.plan(question, this.ontologySchema);
    } catch {
      return planGraphQuery(question);
    }
  }

  private async queryLocal(
    request: RagRetrievalRequest,
    plan?: GraphQueryPlan,
  ): Promise<RetrievalCandidate[]> {
    const entities = await this.graphStore.getEntities();
    const mentionedMatches = findMentionedEntityMatches(
      request.question,
      entities,
      this.ontologySchema.id,
      plan?.entityHints ?? [],
    );
    if (mentionedMatches.length === 0) return [];

    const [relations, claims] = await Promise.all([
      this.graphStore.getRelations(),
      this.graphStore.getClaims(),
    ]);
    const evidenceScores = collectLocalEvidenceScores(
      mentionedMatches,
      relations.filter((relation) => relation.ontologySchemaId === this.ontologySchema.id),
      claims,
      plan?.traversalDepth ?? 1,
    );
    return this.evidenceScoresToCandidates(
      evidenceScores,
      'graph-local',
      'local-entity-neighborhood',
      request.candidateLimit,
      request.isEntryCompatible,
    );
  }

  private async queryEvidenceFirst(
    request: RagRetrievalRequest,
    plan?: GraphQueryPlan,
  ): Promise<RetrievalCandidate[]> {
    const entities = await this.graphStore.getEntities();
    const mentionedMatches = findMentionedEntityMatches(
      request.question,
      entities,
      this.ontologySchema.id,
      plan?.entityHints ?? [],
    );
    const mentionedIds = new Set(mentionedMatches.map((match) => match.entity.id));
    const claims = await this.graphStore.getClaims();
    const relations = await this.graphStore.getRelations();
    const evidenceScores =
      mentionedIds.size > 0
        ? collectLocalEvidenceScores(
            mentionedMatches,
            relations.filter((relation) => relation.ontologySchemaId === this.ontologySchema.id),
            claims,
            1,
          )
        : claims.flatMap((claim) =>
            claim.evidenceIds.map((evidenceId) => ({
              evidenceId,
              score: clampScore(claim.confidence * 0.75),
            })),
          );
    return this.evidenceScoresToCandidates(
      evidenceScores,
      'evidence',
      'evidence-first',
      request.candidateLimit,
      request.isEntryCompatible,
    );
  }

  private async queryGlobal(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const schemaCommunities = (await this.graphStore.getCommunities())
      .filter((community) => community.ontologySchemaId === this.ontologySchema.id);
    const communities = rankGlobalCommunitiesWithRust(
      schemaCommunities,
      request.queryVector,
      request.candidateLimit,
    ) ?? schemaCommunities
      .map((community) => ({
        community,
        score: cosineSimilarity(request.queryVector, community.summaryVector),
      }))
      .filter(
        (candidate): candidate is { community: GraphCommunityRecord; score: number } =>
          candidate.score !== null,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, request.candidateLimit);

    return communities.map(({ community, score }) => ({
      entry: communityToVectorEntry(community),
      source: 'graph-global',
      sourceScore: score,
      reason: 'community-summary',
    }));
  }

  private async evidenceScoresToCandidates(
    evidenceScores: readonly EvidenceScore[],
    source: RetrievalCandidateSource,
    reason: string,
    candidateLimit: number,
    isEntryCompatible?: (entry: VectorEntry) => boolean,
  ): Promise<RetrievalCandidate[]> {
    const evidenceById = new Map(
      (await this.graphStore.getEvidence()).map((evidence) => [evidence.id, evidence]),
    );
    const scoreByEvidenceId = mergeEvidenceScores(evidenceScores);
    const evidenceRecords = [...scoreByEvidenceId.keys()]
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is GraphEvidenceRecord => evidence !== undefined)
      .sort((a, b) => (scoreByEvidenceId.get(b.id) ?? 0) - (scoreByEvidenceId.get(a.id) ?? 0));
    if (evidenceRecords.length === 0) return [];

    const paths = [...new Set(evidenceRecords.map((evidence) => evidence.filePath))];
    const entriesById = new Map(
      (await this.vectorStore.getEntriesByFilePaths(paths)).map((entry) => [entry.id, entry]),
    );
    return evidenceRecords
      .map((evidence) => ({
        evidence,
        entry: entriesById.get(evidence.entryId),
      }))
      .filter(
        (item): item is { evidence: GraphEvidenceRecord; entry: VectorEntry } =>
          item.entry !== undefined && (isEntryCompatible?.(item.entry) ?? true),
      )
      .filter(
        (item, index, items) =>
          items.findIndex((candidate) => candidate.entry.id === item.entry.id) === index,
      )
      .slice(0, candidateLimit)
      .map(({ evidence, entry }) => ({
        entry,
        source,
        sourceScore: scoreByEvidenceId.get(evidence.id) ?? 0,
        reason,
      }));
  }
}

function rankGlobalCommunitiesWithRust(
  communities: readonly GraphCommunityRecord[],
  queryVector: readonly number[],
  candidateLimit: number,
): Array<{ community: GraphCommunityRecord; score: number }> | null {
  const rustScores = rankTopKPairsRust(
    queryVector,
    communities.map((community) => community.summaryVector),
    candidateLimit,
  );
  if (rustScores === null) return null;

  const ranked: Array<{ community: GraphCommunityRecord; score: number }> = [];
  for (const result of rustScores) {
    const community = communities[result.index];
    if (!community) return null;
    ranked.push({ community, score: result.score });
  }
  return ranked;
}

function collectLocalEvidenceScores(
  mentionedMatches: readonly EntityMatch[],
  relations: readonly GraphRelationRecord[],
  claims: readonly GraphClaimRecord[],
  traversalDepth: number,
): EvidenceScore[] {
  const rustScores = collectLocalEvidenceScoresWithRust(
    mentionedMatches,
    relations,
    claims,
    traversalDepth,
  );
  if (rustScores !== null) return rustScores;

  const maxDepth = Math.max(0, Math.floor(traversalDepth));
  const entityScores = new Map<string, number>();
  const entityDistances = new Map<string, number>();
  let frontier = new Set<string>();
  const evidenceScores: EvidenceScore[] = [];

  for (const match of mentionedMatches) {
    const entityScore = clampScore(match.score * match.entity.confidence);
    entityScores.set(
      match.entity.id,
      Math.max(entityScores.get(match.entity.id) ?? 0, entityScore),
    );
    entityDistances.set(match.entity.id, 0);
    frontier.add(match.entity.id);
    for (const evidenceId of match.entity.evidenceIds) {
      evidenceScores.push({
        evidenceId,
        score: clampScore(0.55 + entityScore * 0.35),
      });
    }
  }

  addClaimEvidenceScores(claims, entityScores, entityDistances, evidenceScores);

  for (let depth = 1; depth <= maxDepth && frontier.size > 0; depth++) {
    const nextFrontier = new Set<string>();
    for (const relation of relations) {
      const sourceScore = entityScores.get(relation.sourceEntityId) ?? 0;
      const targetScore = entityScores.get(relation.targetEntityId) ?? 0;
      const touchesFrontier =
        frontier.has(relation.sourceEntityId) || frontier.has(relation.targetEntityId);
      if (!touchesFrontier || (sourceScore === 0 && targetScore === 0)) continue;

      const bestEndpointScore = Math.max(sourceScore, targetScore);
      const distanceFactor = 1 / (1 + (depth - 1) * 0.45);
      const relationScore = clampScore(bestEndpointScore * relation.confidence * distanceFactor);
      for (const evidenceId of relation.evidenceIds) {
        evidenceScores.push({ evidenceId, score: relationScore });
      }

      for (const entityId of [relation.sourceEntityId, relation.targetEntityId]) {
        if (entityScores.has(entityId)) continue;
        entityScores.set(entityId, clampScore(relationScore * 0.82));
        entityDistances.set(entityId, depth);
        nextFrontier.add(entityId);
      }
    }
    frontier = nextFrontier;
    addClaimEvidenceScores(claims, entityScores, entityDistances, evidenceScores);
  }

  return evidenceScores.sort((a, b) => b.score - a.score);
}

function collectLocalEvidenceScoresWithRust(
  mentionedMatches: readonly EntityMatch[],
  relations: readonly GraphRelationRecord[],
  claims: readonly GraphClaimRecord[],
  traversalDepth: number,
): EvidenceScore[] | null {
  const entityIds: string[] = [];
  const entityIndexById = new Map<string, number>();
  const evidenceIds: string[] = [];
  const evidenceIndexById = new Map<string, number>();

  const matchEntityIndices: number[] = [];
  const matchScores: number[] = [];
  const matchEvidenceOffsets: number[] = [0];
  const matchEvidenceIndices: number[] = [];
  for (const match of mentionedMatches) {
    matchEntityIndices.push(getOrCreateIndex(entityIndexById, entityIds, match.entity.id));
    matchScores.push(clampScore(match.score * match.entity.confidence));
    pushEvidenceIndices(match.entity.evidenceIds, evidenceIndexById, evidenceIds, matchEvidenceIndices);
    matchEvidenceOffsets.push(matchEvidenceIndices.length);
  }

  const relationSourceIndices: number[] = [];
  const relationTargetIndices: number[] = [];
  const relationConfidences: number[] = [];
  const relationEvidenceOffsets: number[] = [0];
  const relationEvidenceIndices: number[] = [];
  for (const relation of relations) {
    relationSourceIndices.push(getOrCreateIndex(entityIndexById, entityIds, relation.sourceEntityId));
    relationTargetIndices.push(getOrCreateIndex(entityIndexById, entityIds, relation.targetEntityId));
    relationConfidences.push(relation.confidence);
    pushEvidenceIndices(relation.evidenceIds, evidenceIndexById, evidenceIds, relationEvidenceIndices);
    relationEvidenceOffsets.push(relationEvidenceIndices.length);
  }

  const claimEntityOffsets: number[] = [0];
  const claimEntityIndices: number[] = [];
  const claimConfidences: number[] = [];
  const claimEvidenceOffsets: number[] = [0];
  const claimEvidenceIndices: number[] = [];
  for (const claim of claims) {
    claimConfidences.push(claim.confidence);
    for (const entityId of claim.entityIds) {
      claimEntityIndices.push(getOrCreateIndex(entityIndexById, entityIds, entityId));
    }
    claimEntityOffsets.push(claimEntityIndices.length);
    pushEvidenceIndices(claim.evidenceIds, evidenceIndexById, evidenceIds, claimEvidenceIndices);
    claimEvidenceOffsets.push(claimEvidenceIndices.length);
  }

  const rustScores = scoreLocalEvidenceRust({
    entityCount: entityIds.length,
    matchEntityIndices,
    matchScores,
    matchEvidenceOffsets,
    matchEvidenceIndices,
    relationSourceIndices,
    relationTargetIndices,
    relationConfidences,
    relationEvidenceOffsets,
    relationEvidenceIndices,
    claimEntityOffsets,
    claimEntityIndices,
    claimConfidences,
    claimEvidenceOffsets,
    claimEvidenceIndices,
    evidenceCount: evidenceIds.length,
    traversalDepth,
  });
  if (rustScores === null) return null;

  const scores: EvidenceScore[] = [];
  for (const rustScore of rustScores) {
    const evidenceId = evidenceIds[rustScore.index];
    if (evidenceId === undefined) return null;
    scores.push({ evidenceId, score: rustScore.score });
  }
  return scores;
}

function getOrCreateIndex(
  indexes: Map<string, number>,
  values: string[],
  value: string,
): number {
  const existing = indexes.get(value);
  if (existing !== undefined) return existing;
  const nextIndex = values.length;
  indexes.set(value, nextIndex);
  values.push(value);
  return nextIndex;
}

function pushEvidenceIndices(
  evidenceIds: readonly string[],
  evidenceIndexById: Map<string, number>,
  indexedEvidenceIds: string[],
  output: number[],
): void {
  for (const evidenceId of evidenceIds) {
    output.push(getOrCreateIndex(evidenceIndexById, indexedEvidenceIds, evidenceId));
  }
}

function addClaimEvidenceScores(
  claims: readonly GraphClaimRecord[],
  entityScores: ReadonlyMap<string, number>,
  entityDistances: ReadonlyMap<string, number>,
  evidenceScores: EvidenceScore[],
): void {
  for (const claim of claims) {
    const matchedEntityScores = claim.entityIds
      .map((entityId) => ({
        score: entityScores.get(entityId) ?? 0,
        distance: entityDistances.get(entityId) ?? 0,
      }))
      .filter((match) => match.score > 0);
    if (matchedEntityScores.length === 0) continue;

    const best = matchedEntityScores.reduce((currentBest, match) =>
      match.score > currentBest.score ? match : currentBest,
    );
    const distanceFactor = 1 / (1 + best.distance * 0.35);
    const claimScore = clampScore(best.score * claim.confidence * distanceFactor);
    for (const evidenceId of claim.evidenceIds) {
      evidenceScores.push({ evidenceId, score: claimScore });
    }
  }
}

function mergeEvidenceScores(scores: readonly EvidenceScore[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const score of scores) {
    if (!score.evidenceId) continue;
    merged.set(score.evidenceId, Math.max(merged.get(score.evidenceId) ?? 0, score.score));
  }
  return merged;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function mergeCandidates(
  first: readonly RetrievalCandidate[],
  second: readonly RetrievalCandidate[],
  candidateLimit: number,
): RetrievalCandidate[] {
  const seen = new Set<string>();
  const merged: RetrievalCandidate[] = [];
  for (const candidate of [...first, ...second]) {
    if (seen.has(candidate.entry.id)) continue;
    seen.add(candidate.entry.id);
    merged.push(candidate);
    if (merged.length >= candidateLimit) break;
  }
  return merged;
}

export class GraphRagCandidateProvider implements CandidateProvider {
  readonly id = 'graph-rag';
  readonly source = 'graph-local';

  constructor(
    private readonly engine: GraphRagQueryEngine,
    readonly deadlineMs = 180,
  ) {}

  getCandidates(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    return this.engine.query(request);
  }
}

export class LLMGraphQueryPlanner implements GraphQueryPlanner {
  constructor(
    private readonly provider: LLMProvider,
    private readonly timeoutMs = 2000,
  ) {}

  async plan(question: string, ontologySchema: OntologySchema): Promise<GraphQueryPlan> {
    const response = await withTimeout(
      this.provider.chat(
        [
          {
            role: 'system',
            content:
              'Plan a GraphRAG query. Return JSON only with type, queryMode, traversalDepth, evidenceFirst, entityHints. queryMode must be local, global, hybrid, or none.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              question,
              ontologyEntityTypes: ontologySchema.entityTypes.map((type) => type.id),
              ontologyRelationTypes: ontologySchema.relationTypes.map((type) => type.id),
            }),
          },
        ],
        0,
      ),
      this.timeoutMs,
    );
    return normalizeGraphQueryPlan(parsePlannerResponse(response) ?? planGraphQuery(question));
  }
}

export function planGraphQuery(question: string): GraphQueryPlan {
  const normalized = question.toLowerCase();
  if (/(근거|출처|어디|source|evidence)/iu.test(normalized)) {
    return createGraphQueryPlan('source-seeking', {
      queryMode: 'local',
      evidenceFirst: true,
      traversalDepth: 1,
      entityHints: extractEntityHints(question),
    });
  }
  if (/(반복|핵심 주제|전체|주제|theme|thematic|community)/iu.test(normalized)) {
    return createGraphQueryPlan('thematic', {
      queryMode: 'global',
      traversalDepth: 1,
      entityHints: extractEntityHints(question),
    });
  }
  if (/(관계|관련|연결|대립|협력|relation|related)/iu.test(normalized)) {
    return createGraphQueryPlan('relational', {
      queryMode: 'local',
      traversalDepth: 2,
      entityHints: extractEntityHints(question),
    });
  }
  if (/(차이|비교|compare|difference)/iu.test(normalized)) {
    return createGraphQueryPlan('comparative', {
      queryMode: 'hybrid',
      traversalDepth: 2,
      entityHints: extractEntityHints(question),
    });
  }
  if (/(누구|무엇|어떤|who|what)/iu.test(normalized)) {
    return createGraphQueryPlan('factual', {
      queryMode: 'local',
      traversalDepth: 1,
      entityHints: extractEntityHints(question),
    });
  }
  return createGraphQueryPlan('ordinary-rag', {
    queryMode: 'none',
    traversalDepth: 0,
    entityHints: extractEntityHints(question),
  });
}

function findMentionedEntityMatches(
  question: string,
  entities: readonly GraphEntityRecord[],
  ontologySchemaId: string,
  entityHints: readonly string[],
): EntityMatch[] {
  const normalizedQuestion = normalizeEntityName(question);
  const normalizedHints = new Set(
    entityHints.map(normalizeEntityName).filter((hint) => hint.length > 0),
  );
  const matches: EntityMatch[] = [];

  for (const entity of entities) {
    if (entity.ontologySchemaId !== ontologySchemaId) continue;
    const names = [entity.canonicalName, ...entity.aliases]
      .map(normalizeEntityName)
      .filter((name) => name.length > 0);
    let bestScore = 0;
    for (const name of names) {
      if (normalizedHints.has(name)) {
        bestScore = Math.max(bestScore, 1);
      }
      if (isSafeMention(normalizedQuestion, name)) {
        bestScore = Math.max(
          bestScore,
          name === normalizeEntityName(entity.canonicalName) ? 0.94 : 0.88,
        );
      }
    }
    if (bestScore > 0) {
      matches.push({ entity, score: bestScore });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function isSafeMention(normalizedText: string, normalizedName: string): boolean {
  if (!normalizedName) return false;
  if (normalizedName.length < 2) {
    return normalizedText.split(' ').includes(normalizedName);
  }

  const escaped = escapeRegExp(normalizedName);
  const koreanParticlePattern =
    '(?:\\uC740|\\uB294|\\uC774|\\uAC00|\\uC744|\\uB97C|\\uACFC|\\uC640|\\uC758|\\uC5D0|\\uC5D0\\uC11C|\\uB85C|\\uC73C\\uB85C|\\uC5D0\\uAC8C|\\uAED8|\\uB3C4|\\uB9CC|\\uBD80\\uD130|\\uAE4C\\uC9C0)';
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}]|${koreanParticlePattern})`,
    'u',
  );
  return pattern.test(normalizedText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function createGraphQueryPlan(
  type: GraphQueryType,
  input: Partial<Omit<GraphQueryPlan, 'type'>>,
): GraphQueryPlan {
  return {
    type,
    queryMode: input.queryMode ?? 'local',
    traversalDepth: Math.max(0, Math.floor(input.traversalDepth ?? 1)),
    evidenceFirst: input.evidenceFirst ?? false,
    entityHints: input.entityHints ?? [],
  };
}

function normalizeGraphQueryPlan(input: GraphQueryPlan): GraphQueryPlan {
  const queryMode = isGraphQueryExecutionMode(input.queryMode) ? input.queryMode : 'local';
  const type = isGraphQueryType(input.type) ? input.type : 'ordinary-rag';
  return createGraphQueryPlan(type, {
    queryMode,
    traversalDepth: input.traversalDepth,
    evidenceFirst: input.evidenceFirst,
    entityHints: input.entityHints.filter((hint) => hint.trim().length > 0),
  });
}

function parsePlannerResponse(response: string): GraphQueryPlan | null {
  const parsed = parseJsonObject(response);
  if (!parsed) return null;
  return {
    type:
      typeof parsed.type === 'string' && isGraphQueryType(parsed.type)
        ? parsed.type
        : 'ordinary-rag',
    queryMode:
      typeof parsed.queryMode === 'string' && isGraphQueryExecutionMode(parsed.queryMode)
        ? parsed.queryMode
        : 'local',
    traversalDepth: typeof parsed.traversalDepth === 'number' ? parsed.traversalDepth : 1,
    evidenceFirst: parsed.evidenceFirst === true,
    entityHints: Array.isArray(parsed.entityHints)
      ? parsed.entityHints.filter((hint): hint is string => typeof hint === 'string')
      : [],
  };
}

function parseJsonObject(response: string): Record<string, unknown> | null {
  const trimmed = response.trim();
  const jsonText =
    trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : trimmed.match(/\{[\s\S]*\}/u)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isGraphQueryType(value: string): value is GraphQueryType {
  return [
    'factual',
    'relational',
    'thematic',
    'comparative',
    'source-seeking',
    'ordinary-rag',
  ].includes(value);
}

function isGraphQueryExecutionMode(value: string): value is GraphRagQueryMode | 'none' {
  return ['local', 'global', 'hybrid', 'none'].includes(value);
}

function extractEntityHints(question: string): string[] {
  const hints = new Set<string>();
  const latinNames = question.match(/\b[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*)*\b/gu) ?? [];
  for (const name of latinNames) {
    if (!isQuestionKeyword(name)) hints.add(name.trim());
  }
  return [...hints];
}

function isQuestionKeyword(value: string): boolean {
  return /^(who|what|where|source|evidence|theme|community|compare|difference)$/iu.test(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('GraphRAG query planning timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function communityToVectorEntry(community: GraphCommunityRecord): VectorEntry {
  return {
    id: community.id,
    vector: [...community.summaryVector],
    metadata: {
      filePath: `graph://community/${community.id}`,
      heading: community.title,
      startLine: 0,
      endLine: 0,
      text: community.summary,
    },
  };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    dot += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
