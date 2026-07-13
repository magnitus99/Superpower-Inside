import type { KnowledgeGraphContract } from './knowledge-contract';
import type { LLMProvider, ChatMessage } from '../llm/providers';
import {
  mergeRetrievalCandidateGroupsByEntryId,
} from '../rag/retrieval-pipeline';
import type {
  CandidateProvider,
  RagRetrievalRequest,
  RetrievalCandidate,
  RetrievalCandidateSource,
  RetrievalProviderReadiness,
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
  planLocalEvidenceScoresRust,
  rankTopKPairsRust,
  createGraphIdRust,
  type RustGraphQueryExecutionAction,
  type RustGraphQueryPlan,
} from '../rag/rust-core';
import type {
  GraphClaimRecord,
  GraphCommunityRecord,
  GraphEntityRecord,
  GraphEvidenceRecord,
  GraphRelationRecord,
  KnowledgeGraphStore,
} from './store';
import { getEntitySearchAliases } from './entity-labels';
import { createGraphProviderEpochId } from './extraction';

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
  globalSearchDepth: 'fast' | 'deep';
  entityHints: string[];
}

export type GraphRagQueryMode = 'auto' | 'local' | 'global' | 'hybrid';

export interface GraphRagQueryEngineOptions {
  queryMode?: GraphRagQueryMode;
  provider?: LLMProvider;
}

interface EntityMatch {
  entity: GraphEntityRecord;
  score: number;
}

interface EvidenceScore {
  evidenceId: string;
  score: number;
}

interface LocalGraphNeighborhood {
  relations: GraphRelationRecord[];
  claims: GraphClaimRecord[];
}

export class GraphRagQueryEngine {
  private readonly queryMode: GraphRagQueryMode;
  private readonly provider: LLMProvider | undefined;

  constructor(
    private readonly graphStore: KnowledgeGraphStore,
    private readonly vectorStore: VectorStore,
    private readonly knowledgeContract: KnowledgeGraphContract,
    options: GraphRagQueryEngineOptions = {},
  ) {
    this.queryMode = options.queryMode ?? 'auto';
    this.provider = options.provider;
  }

  async query(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfGraphQueryAborted(signal);
    const autoPlan = this.queryMode === 'auto' ? planGraphQuery(request.question) : undefined;
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

    throwIfGraphQueryAborted(signal);
    return this.executeQueryAction(resolvedAction, request, autoPlan, signal);
  }

  private async executeQueryAction(
    action: RustGraphQueryExecutionAction,
    request: RagRetrievalRequest,
    plan: GraphQueryPlan | undefined,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    switch (action) {
      case 'none':
        return [];
      case 'local':
        return this.queryLocal(request, plan, signal);
      case 'global':
        return this.queryGlobal(request, plan, signal);
      case 'hybrid':
        return mergeGraphCandidatesWithRust(
          await this.queryLocal(request, plan, signal),
          await this.queryGlobal(request, plan, signal),
          request.candidateLimit,
        );
      case 'evidence-first':
        return this.queryEvidenceFirst(request, plan, signal);
    }
  }

  private async queryLocal(
    request: RagRetrievalRequest,
    plan?: GraphQueryPlan,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfGraphQueryAborted(signal);
    const entities = await this.graphStore.getEntities();
    throwIfGraphQueryAborted(signal);
    const mentionedMatches = findMentionedEntityMatches(
      request.question,
      entities,
      this.knowledgeContract.id,
      plan?.entityHints ?? [],
    );
    if (mentionedMatches.length === 0) return [];

    const { relations, claims } = await this.loadLocalGraphNeighborhood(
      mentionedMatches,
      plan?.traversalDepth ?? 1,
    );
    const evidenceScores = collectLocalEvidenceScores(
      mentionedMatches,
      relations,
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
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfGraphQueryAborted(signal);
    const entities = await this.graphStore.getEntities();
    throwIfGraphQueryAborted(signal);
    const mentionedMatches = findMentionedEntityMatches(
      request.question,
      entities,
      this.knowledgeContract.id,
      plan?.entityHints ?? [],
    );
    const mentionedIds = new Set(mentionedMatches.map((match) => match.entity.id));
    const evidenceScores =
      mentionedIds.size > 0
        ? collectLocalEvidenceScoresFromNeighborhood(
            await this.loadLocalGraphNeighborhood(mentionedMatches, 1),
            mentionedMatches,
            1,
          )
        : collectClaimEvidenceScores(await this.graphStore.getClaims());
    return this.evidenceScoresToCandidates(
      evidenceScores,
      'evidence',
      'evidence-first',
      request.candidateLimit,
      request.isEntryCompatible,
    );
  }

  private async queryGlobal(
    request: RagRetrievalRequest,
    plan?: GraphQueryPlan,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    throwIfGraphQueryAborted(signal);
    const schemaCommunities = await this.graphStore.getCommunitiesBySchema(this.knowledgeContract.id);
    throwIfGraphQueryAborted(signal);
    const communities = rankGlobalCommunitiesWithRust(
      schemaCommunities,
      request.queryVector,
      request.candidateLimit,
    );

    const fastCandidates = communities.map(({ community, score }) => ({
      entry: communityToVectorEntry(community),
      source: 'graph-global' as const,
      sourceScore: score,
      reason: 'community-summary',
    }));
    if (
      !this.provider ||
      this.queryMode !== 'auto' ||
      plan?.globalSearchDepth !== 'deep'
    ) {
      return fastCandidates;
    }
    try {
      const deepCandidate = await this.queryGlobalDeep(
        request,
        schemaCommunities,
        this.provider,
        signal,
      );
      return deepCandidate ? [deepCandidate] : fastCandidates;
    } catch (error) {
      if (isAbortError(error)) throw error;
      return fastCandidates;
    }
  }

  private async queryGlobalDeep(
    request: RagRetrievalRequest,
    communities: readonly GraphCommunityRecord[],
    provider: LLMProvider,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate | null> {
    const leafCommunities = communities.some((community) => community.level === 0)
      ? communities.filter((community) => community.level === 0)
      : [...communities];
    if (leafCommunities.length === 0) return null;
    const queryHash = requireGraphQueryId(['global-query', request.question]);
    const providerEpochId = createGraphProviderEpochId(
      provider,
      provider.capability.model,
      1,
    );
    const mapReports: string[] = [];
    for (const community of [...leafCommunities].sort((left, right) => left.id.localeCompare(right.id))) {
      throwIfGraphQueryAborted(signal);
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: 'Extract only findings from this community report that directly help answer the question. Return concise Korean prose. If irrelevant, return IRRELEVANT.',
        },
        {
          role: 'user',
          content: `Question: ${request.question}\n\nCommunity report:\n${community.summary}`,
        },
      ];
      const report = await this.runDurableGlobalPhase({
        queryHash,
        phase: 'map',
        communityId: community.id,
        providerEpochId,
        messages,
        provider,
        signal,
      });
      if (report.trim() !== '' && report.trim() !== 'IRRELEVANT') mapReports.push(report.trim());
    }
    if (mapReports.length === 0) return null;
    const reduced = await this.runDurableGlobalPhase({
      queryHash,
      phase: 'reduce',
      providerEpochId,
      messages: [
        {
          role: 'system',
          content: 'Synthesize the mapped community findings into one evidence-grounded Korean answer. Preserve uncertainty and do not invent facts.',
        },
        {
          role: 'user',
          content: `Question: ${request.question}\n\nMapped findings:\n${mapReports.map((report, index) => `[${index + 1}] ${report}`).join('\n')}`,
        },
      ],
      provider,
      signal,
    });
    const id = requireGraphQueryId(['global-reduce-result', queryHash, providerEpochId]);
    return {
      entry: {
        id,
        vector: [...request.queryVector],
        metadata: {
          filePath: `graph://global/${id}`,
          heading: 'GraphRAG global synthesis',
          startLine: 1,
          endLine: 1,
          text: reduced,
        },
      },
      source: 'graph-global',
      sourceScore: 1,
      reason: 'community-map-reduce',
    };
  }

  private async runDurableGlobalPhase(input: {
    queryHash: string;
    phase: 'map' | 'reduce';
    communityId?: string;
    providerEpochId: string;
    messages: ChatMessage[];
    provider: LLMProvider;
    signal?: AbortSignal;
  }): Promise<string> {
    const promptHash = requireGraphQueryId([
      'global-prompt',
      JSON.stringify(input.messages),
    ]);
    const id = requireGraphQueryId([
      'global-job',
      input.queryHash,
      input.phase,
      input.communityId ?? 'reduce',
      input.providerEpochId,
      promptHash,
    ]);
    const existing = await this.graphStore.getGlobalSearchJob(id);
    const cached = existing?.rawResponseId
      ? await this.graphStore.getRawResponse(existing.rawResponseId)
      : undefined;
    if (cached) return cached.body;
    await this.graphStore.putGlobalSearchJob({
      id,
      queryHash: input.queryHash,
      phase: input.phase,
      communityId: input.communityId,
      providerEpochId: input.providerEpochId,
      state: 'prepared',
      updatedAt: Date.now(),
    });
    const body = await input.provider.chat(input.messages, 0, undefined, { signal: input.signal });
    const bodyHash = requireGraphQueryId(['global-body', body]);
    const rawResponseId = requireGraphQueryId(['global-response', id, bodyHash]);
    await this.graphStore.putRawResponse({
      id: rawResponseId,
      requestFingerprint: id,
      providerEpochId: input.providerEpochId,
      body,
      bodyHash,
      receivedAt: Date.now(),
    });
    await this.graphStore.putGlobalSearchJob({
      id,
      queryHash: input.queryHash,
      phase: input.phase,
      communityId: input.communityId,
      providerEpochId: input.providerEpochId,
      state: 'committed',
      rawResponseId,
      updatedAt: Date.now(),
    });
    return body;
  }

  private async evidenceScoresToCandidates(
    evidenceScores: readonly EvidenceScore[],
    source: RetrievalCandidateSource,
    reason: string,
    candidateLimit: number,
    isEntryCompatible?: (entry: VectorEntry) => boolean,
  ): Promise<RetrievalCandidate[]> {
    if (candidateLimit <= 0) return [];
    const orderedEvidenceScores = planEvidenceCandidateOrderRust(
      evidenceScores,
      evidenceScores.map((score) => score.evidenceId),
    );
    if (!orderedEvidenceScores || orderedEvidenceScores.length === 0) return [];
    const evidence = await this.graphStore.getEvidenceByIds(
      orderedEvidenceScores.map((score) => score.evidenceId),
    );
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

    const entries = await this.vectorStore.getEntriesByFilePaths([
      ...new Set(evidenceRecords.map((record) => record.evidence.filePath)),
    ]);
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

  private async loadLocalGraphNeighborhood(
    mentionedMatches: readonly EntityMatch[],
    traversalDepth: number,
  ): Promise<LocalGraphNeighborhood> {
    const maxDepth = Math.max(1, Math.floor(traversalDepth));
    const seenEntityIds = new Set(mentionedMatches.map((match) => match.entity.id));
    let frontier = [...seenEntityIds];
    const relationsById = new Map<string, GraphRelationRecord>();

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const relations = await this.graphStore.getRelationsForEntityIds(
        frontier,
        this.knowledgeContract.id,
      );
      const nextFrontier: string[] = [];
      for (const relation of relations) {
        relationsById.set(relation.id, relation);
        for (const entityId of [relation.sourceEntityId, relation.targetEntityId]) {
          if (seenEntityIds.has(entityId)) continue;
          seenEntityIds.add(entityId);
          nextFrontier.push(entityId);
        }
      }
      frontier = nextFrontier;
    }

    const claims = await this.graphStore.getClaimsForEntityIds([...seenEntityIds]);
    return {
      relations: [...relationsById.values()],
      claims,
    };
  }
}

function collectLocalEvidenceScoresFromNeighborhood(
  neighborhood: LocalGraphNeighborhood,
  mentionedMatches: readonly EntityMatch[],
  traversalDepth: number,
): EvidenceScore[] {
  return collectLocalEvidenceScores(
    mentionedMatches,
    neighborhood.relations,
    neighborhood.claims,
    traversalDepth,
  );
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
    private readonly readiness: () => RetrievalProviderReadiness,
    readonly deadlineMs = 450,
  ) {}

  getReadiness(): RetrievalProviderReadiness {
    return this.readiness();
  }

  getCandidates(
    request: RagRetrievalRequest,
    signal?: AbortSignal,
  ): Promise<RetrievalCandidate[]> {
    return this.engine.query(request, signal);
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
      aliases: getEntitySearchAliases(entity),
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

function createGraphQueryPlan(
  type: GraphQueryType,
  input: Partial<Omit<GraphQueryPlan, 'type'>>,
): GraphQueryPlan {
  return {
    type,
    queryMode: input.queryMode ?? 'local',
    traversalDepth: Math.max(0, Math.floor(input.traversalDepth ?? 1)),
    evidenceFirst: input.evidenceFirst ?? false,
    globalSearchDepth: input.globalSearchDepth ?? 'fast',
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
    globalSearchDepth: rustPlan.globalSearchDepth,
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


function throwIfGraphQueryAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('GraphRAG query cancelled', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function requireGraphQueryId(parts: readonly string[]): string {
  return createGraphIdRust(parts) ?? parts.join('::');
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
