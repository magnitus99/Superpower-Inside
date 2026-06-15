import type { OntologySchema } from '../ontology/schema';
import type { LLMProvider } from '../llm/providers';
import {
  mergeRetrievalCandidateGroupsByEntryId,
} from '../rag/retrieval-pipeline';
import type {
  CandidateProvider,
  RagRetrievalRequest,
  RetrievalCandidate,
  RetrievalCandidateSource,
} from '../rag/retrieval-pipeline';
import type { VectorEntry, VectorStore } from '../rag/store';
import {
  findMentionedEntityMatchesRust,
  planClaimEvidenceScoresRust,
  planEvidenceCandidateOrderRust,
  planGraphEvidenceCandidateLookupRust,
  planGraphEvidenceEntryCandidatesRust,
  planGraphQueryExecutionActionRust,
  planGraphQueryExecutionRust,
  planGraphQueryRust,
  planGraphQueryResponseRust,
  planGraphSchemaCommunityIndicesRust,
  planGraphSchemaRelationIndicesRust,
  planLocalEvidenceScoresRust,
  rankTopKPairsRust,
  type RustGraphQueryExecutionAction,
  type RustGraphQueryPlan,
} from '../rag/rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';
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
    const autoPlan = this.queryMode === 'auto' ? await this.planQuery(request.question) : undefined;
    const plannedMode = this.queryMode === 'auto' ? (autoPlan?.queryMode ?? 'none') : 'none';
    const executionPlan = planGraphQueryExecutionRust(
      this.queryMode,
      plannedMode,
      autoPlan?.evidenceFirst ?? false,
    );
    const resolvedAction = planGraphQueryExecutionActionRust(
      executionPlan,
      this.queryMode,
      plannedMode,
      autoPlan?.evidenceFirst ?? false,
    );

    if (!resolvedAction) return [];

    return this.executeQueryAction(resolvedAction, request, autoPlan);
  }

  private async executeQueryAction(
    action: RustGraphQueryExecutionAction,
    request: RagRetrievalRequest,
    plan: GraphQueryPlan | undefined,
  ): Promise<RetrievalCandidate[]> {
    switch (action) {
      case 'none':
        return [];
      case 'local':
        return this.queryLocal(request, plan);
      case 'global':
        return this.queryGlobal(request);
      case 'hybrid':
        return mergeGraphCandidatesWithRust(
          await this.queryLocal(request, plan),
          await this.queryGlobal(request),
          request.candidateLimit,
        );
      case 'evidence-first':
        return this.queryEvidenceFirst(request, plan);
    }
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
      selectSchemaRelations(relations, this.ontologySchema.id),
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
            selectSchemaRelations(relations, this.ontologySchema.id),
            claims,
            1,
          )
        : collectClaimEvidenceScores(claims);
    return this.evidenceScoresToCandidates(
      evidenceScores,
      'evidence',
      'evidence-first',
      request.candidateLimit,
      request.isEntryCompatible,
    );
  }

  private async queryGlobal(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const schemaCommunities = selectSchemaCommunities(
      await this.graphStore.getCommunities(),
      this.ontologySchema.id,
    );
    const communities = rankGlobalCommunitiesWithRust(
      schemaCommunities,
      request.queryVector,
      request.candidateLimit,
    );

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
    if (candidateLimit <= 0) return [];
    const evidence = await this.graphStore.getEvidence();
    const orderedEvidenceScores = planEvidenceCandidateOrderRust(
      evidenceScores,
      evidence.map((record) => record.id),
    );
    if (!orderedEvidenceScores || orderedEvidenceScores.length === 0) return [];
    const lookupPlan = planGraphEvidenceCandidateLookupRust(
      orderedEvidenceScores,
      evidence.map((record) => ({ id: record.id, filePath: record.filePath })),
    );
    if (!lookupPlan || lookupPlan.scoreIndices.length === 0 || lookupPlan.filePaths.length === 0) {
      return [];
    }

    const evidenceRecords: Array<{ evidence: GraphEvidenceRecord; score: number }> = [];
    const evidenceCandidateCount = Math.min(
      lookupPlan.evidenceIndices.length,
      lookupPlan.scoreIndices.length,
      orderedEvidenceScores.length,
    );
    for (let index = 0; index < evidenceCandidateCount; index++) {
      const evidenceIndex = lookupPlan.evidenceIndices[index];
      const scoreIndex = lookupPlan.scoreIndices[index];

      if (!Number.isInteger(evidenceIndex) || !Number.isInteger(scoreIndex)) {
        continue;
      }
      if (evidenceIndex < 0 || evidenceIndex >= evidence.length) {
        continue;
      }
      if (scoreIndex < 0 || scoreIndex >= orderedEvidenceScores.length) {
        continue;
      }

      const evidenceRecord = evidence[evidenceIndex];
      const score = orderedEvidenceScores[scoreIndex];
      if (evidenceRecord === undefined || score === undefined) {
        continue;
      }
      evidenceRecords.push({ evidence: evidenceRecord, score: score.score });
    }
    if (evidenceRecords.length === 0) return [];

    const entries = await this.vectorStore.getEntriesByFilePaths(lookupPlan.filePaths);
    const entryPlan = planGraphEvidenceEntryCandidatesRust(
      evidenceRecords.map((record) => record.evidence.entryId),
      entries.map((entry) => ({
        id: entry.id,
        compatible: isEntryCompatible?.(entry) ?? true,
      })),
      candidateLimit,
    );
    if (!entryPlan || entryPlan.candidateIndices.length === 0 || entryPlan.entryIndices.length === 0) {
      return [];
    }

    const candidates: RetrievalCandidate[] = [];
    const evidenceEntryCandidateCount = Math.min(
      entryPlan.candidateIndices.length,
      entryPlan.entryIndices.length,
      evidenceRecords.length,
      entries.length,
    );
    for (let index = 0; index < evidenceEntryCandidateCount; index++) {
      const evidenceRecordIndex = entryPlan.candidateIndices[index];
      const entryIndex = entryPlan.entryIndices[index];

      if (!Number.isInteger(evidenceRecordIndex) || !Number.isInteger(entryIndex)) {
        continue;
      }
      if (evidenceRecordIndex < 0 || evidenceRecordIndex >= evidenceRecords.length) {
        continue;
      }
      if (entryIndex < 0 || entryIndex >= entries.length) {
        continue;
      }

      const evidenceRecord = evidenceRecords[evidenceRecordIndex];
      const entry = entries[entryIndex];
      if (evidenceRecord === undefined || entry === undefined) {
        continue;
      }
      candidates.push({
        entry,
        source,
        sourceScore: evidenceRecord.score,
        reason,
      });
    }
    return candidates;
  }
}

function rankGlobalCommunitiesWithRust(
  communities: readonly GraphCommunityRecord[],
  queryVector: readonly number[],
  candidateLimit: number,
): Array<{ community: GraphCommunityRecord; score: number }> {
  const rustScores = rankTopKPairsRust(
    queryVector,
    communities.map((community) => community.summaryVector),
    candidateLimit,
  );
  if (rustScores === null) return [];

  const ranked: Array<{ community: GraphCommunityRecord; score: number }> = [];
  for (const result of rustScores) {
    const communityIndex = result.index;
    if (!Number.isInteger(communityIndex) || communityIndex < 0 || communityIndex >= communities.length) {
      continue;
    }
    const community = communities[communityIndex];
    if (!community) {
      continue;
    }
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
  if (rustScores !== null) {
    return rustScores;
  }
  return [];
}

function collectClaimEvidenceScores(claims: readonly GraphClaimRecord[]): EvidenceScore[] {
  const claimScores = planClaimEvidenceScoresRust(
    claims.map((claim) => ({
      confidence: claim.confidence,
      evidenceIds: claim.evidenceIds,
    })),
  );
  if (claimScores !== null) return claimScores;

  return [];
}

function collectLocalEvidenceScoresWithRust(
  mentionedMatches: readonly EntityMatch[],
  relations: readonly GraphRelationRecord[],
  claims: readonly GraphClaimRecord[],
  traversalDepth: number,
): EvidenceScore[] | null {
  return planLocalEvidenceScoresRust({
    matches: mentionedMatches.map((entityMatch) => ({
      entityId: entityMatch.entity.id,
      entityConfidence: entityMatch.entity.confidence,
      matchScore: entityMatch.score,
      evidenceIds: entityMatch.entity.evidenceIds,
    })),
    relations: relations.map((relation) => ({
      sourceEntityId: relation.sourceEntityId,
      targetEntityId: relation.targetEntityId,
      confidence: relation.confidence,
      evidenceIds: relation.evidenceIds,
    })),
    claims: claims.map((claim) => ({
      entityIds: claim.entityIds,
      confidence: claim.confidence,
      evidenceIds: claim.evidenceIds,
    })),
    traversalDepth,
  });
}

function mergeGraphCandidatesWithRust(
  first: readonly RetrievalCandidate[],
  second: readonly RetrievalCandidate[],
  candidateLimit: number,
): RetrievalCandidate[] {
  if (candidateLimit <= 0) return [];
  const candidates = [...first, ...second];
  if (candidates.length === 0) return [];

  const plan = mergeRetrievalCandidateGroupsByEntryId(candidates);
  if (plan.length === 0) return [];

  const selected: RetrievalCandidate[] = [];
  for (const group of plan) {
    if (selected.length >= candidateLimit) break;
    const candidate = candidates[group.firstCandidateIndex];
    if (!candidate) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
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
    return graphQueryPlanFromRust(planGraphQueryResponseRust(response, question)) ?? planGraphQuery(question);
  }
}

export function planGraphQuery(question: string): GraphQueryPlan {
  const plan = graphQueryPlanFromRust(planGraphQueryRust(question));
  if (!plan) {
    return createGraphQueryPlan('ordinary-rag', {
      queryMode: 'none',
      traversalDepth: 0,
      entityHints: [],
    });
  }

  return plan;
}

function findMentionedEntityMatches(
  question: string,
  entities: readonly GraphEntityRecord[],
  ontologySchemaId: string,
  entityHints: readonly string[],
): EntityMatch[] {
  const rustMatches = findMentionedEntityMatchesRust(
    question,
    entities.map((entity) => ({
      ontologySchemaId: entity.ontologySchemaId,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases,
    })),
    ontologySchemaId,
    entityHints,
  );
  if (rustMatches === null) return [];

  const matches: EntityMatch[] = [];
  for (const rustMatch of rustMatches) {
    const matchIndex = rustMatch.index;
    if (!Number.isInteger(matchIndex) || matchIndex < 0 || matchIndex >= entities.length) {
      continue;
    }
    const entity = entities[matchIndex];
    if (!entity) {
      continue;
    }
    matches.push({ entity, score: rustMatch.score });
  }
  return matches;
}

function selectSchemaRelations(
  relations: readonly GraphRelationRecord[],
  ontologySchemaId: string,
): GraphRelationRecord[] {
  const relationIndices = planGraphSchemaRelationIndicesRust(
    relations.map((relation) => relation.ontologySchemaId),
    ontologySchemaId,
  );
  return selectRecordsByRustIndices(relations, relationIndices);
}

function selectSchemaCommunities(
  communities: readonly GraphCommunityRecord[],
  ontologySchemaId: string,
): GraphCommunityRecord[] {
  const communityIndices = planGraphSchemaCommunityIndicesRust(
    communities.map((community) => community.ontologySchemaId),
    ontologySchemaId,
  );
  return selectRecordsByRustIndices(communities, communityIndices);
}

function selectRecordsByRustIndices<T>(records: readonly T[], indices: readonly number[] | null): T[] {
  if (indices === null) return [];
  return selectByRustIndices(records, indices, { dedupe: true });
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

function graphQueryPlanFromRust(rustPlan: RustGraphQueryPlan | null): GraphQueryPlan | null {
  if (!rustPlan) return null;
  if (!isGraphQueryType(rustPlan.type) || !isGraphQueryExecutionMode(rustPlan.queryMode)) {
    return null;
  }
  return {
    type: rustPlan.type,
    queryMode: rustPlan.queryMode,
    traversalDepth: rustPlan.traversalDepth,
    evidenceFirst: rustPlan.evidenceFirst,
    entityHints: [...rustPlan.entityHints],
  };
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('GraphRAG query planning timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId);
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
