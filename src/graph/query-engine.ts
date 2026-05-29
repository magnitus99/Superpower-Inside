import type { OntologySchema } from '../ontology/schema';
import type {
  CandidateProvider,
  RagRetrievalRequest,
  RetrievalCandidate,
  RetrievalCandidateSource,
} from '../rag/retrieval-pipeline';
import type { VectorEntry, VectorStore } from '../rag/store';
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
}

export type GraphRagQueryMode = 'auto' | 'local' | 'global' | 'hybrid';

export interface GraphRagQueryEngineOptions {
  queryMode?: GraphRagQueryMode;
}

export class GraphRagQueryEngine {
  private readonly queryMode: GraphRagQueryMode;

  constructor(
    private readonly graphStore: KnowledgeGraphStore,
    private readonly vectorStore: VectorStore,
    private readonly ontologySchema: OntologySchema,
    options: GraphRagQueryEngineOptions = {},
  ) {
    this.queryMode = options.queryMode ?? 'auto';
  }

  async query(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    if (this.queryMode === 'local') {
      return this.queryLocal(request);
    }
    if (this.queryMode === 'global') {
      return this.queryGlobal(request);
    }
    if (this.queryMode === 'hybrid') {
      return mergeCandidates(
        await this.queryLocal(request),
        await this.queryGlobal(request),
        request.candidateLimit,
      );
    }

    const plan = planGraphQuery(request.question);
    if (plan.type === 'thematic') {
      return this.queryGlobal(request);
    }
    if (plan.type === 'source-seeking') {
      return this.queryEvidenceFirst(request);
    }
    if (plan.type === 'ordinary-rag') {
      return [];
    }
    return this.queryLocal(request);
  }

  private async queryLocal(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const entities = await this.graphStore.getEntities();
    const mentionedEntities = findMentionedEntities(request.question, entities, this.ontologySchema.id);
    if (mentionedEntities.length === 0) return [];

    const mentionedIds = new Set(mentionedEntities.map((entity) => entity.id));
    const relations = (await this.graphStore.getRelations()).filter(
      (relation) => mentionedIds.has(relation.sourceEntityId) || mentionedIds.has(relation.targetEntityId),
    );
    const claims = (await this.graphStore.getClaims()).filter((claim) =>
      claim.entityIds.some((entityId) => mentionedIds.has(entityId)),
    );
    const evidenceIds = collectEvidenceIds([
      ...mentionedEntities,
      ...relations,
      ...claims,
    ]);
    return this.evidenceIdsToCandidates(evidenceIds, 'graph-local', 'local-entity-neighborhood', request.candidateLimit);
  }

  private async queryEvidenceFirst(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const entities = await this.graphStore.getEntities();
    const mentionedEntities = findMentionedEntities(request.question, entities, this.ontologySchema.id);
    const mentionedIds = new Set(mentionedEntities.map((entity) => entity.id));
    const claims = await this.graphStore.getClaims();
    const relations = await this.graphStore.getRelations();
    const evidenceIds =
      mentionedIds.size > 0
        ? collectEvidenceIds([
            ...claims.filter((claim) => claim.entityIds.some((entityId) => mentionedIds.has(entityId))),
            ...relations.filter(
              (relation) =>
                mentionedIds.has(relation.sourceEntityId) || mentionedIds.has(relation.targetEntityId),
            ),
          ])
        : collectEvidenceIds(claims);
    return this.evidenceIdsToCandidates(evidenceIds, 'evidence', 'evidence-first', request.candidateLimit);
  }

  private async queryGlobal(request: RagRetrievalRequest): Promise<RetrievalCandidate[]> {
    const communities = (await this.graphStore.getCommunities())
      .filter((community) => community.ontologySchemaId === this.ontologySchema.id)
      .map((community) => ({
        community,
        score: cosineSimilarity(request.queryVector, community.summaryVector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, request.candidateLimit);

    return communities.map(({ community, score }) => ({
      entry: communityToVectorEntry(community),
      source: 'graph-global',
      sourceScore: score,
      reason: 'community-summary',
    }));
  }

  private async evidenceIdsToCandidates(
    evidenceIds: readonly string[],
    source: RetrievalCandidateSource,
    reason: string,
    candidateLimit: number,
  ): Promise<RetrievalCandidate[]> {
    const evidenceById = new Map((await this.graphStore.getEvidence()).map((evidence) => [evidence.id, evidence]));
    const evidenceRecords = evidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is GraphEvidenceRecord => evidence !== undefined);
    if (evidenceRecords.length === 0) return [];

    const entryIds = new Set(evidenceRecords.map((evidence) => evidence.entryId));
    const paths = [...new Set(evidenceRecords.map((evidence) => evidence.filePath))];
    const entriesById = new Map(
      (await this.vectorStore.getEntriesByFilePaths(paths)).map((entry) => [entry.id, entry]),
    );
    return [...entryIds]
      .map((entryId) => entriesById.get(entryId))
      .filter((entry): entry is VectorEntry => entry !== undefined)
      .slice(0, candidateLimit)
      .map((entry) => ({
        entry,
        source,
        sourceScore: 1,
        reason,
      }));
  }
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

export function planGraphQuery(question: string): GraphQueryPlan {
  const normalized = question.toLowerCase();
  if (/(근거|출처|어디|source|evidence)/iu.test(normalized)) {
    return { type: 'source-seeking' };
  }
  if (/(반복|핵심 주제|전체|주제|theme|thematic|community)/iu.test(normalized)) {
    return { type: 'thematic' };
  }
  if (/(관계|관련|연결|대립|협력|relation|related)/iu.test(normalized)) {
    return { type: 'relational' };
  }
  if (/(차이|비교|compare|difference)/iu.test(normalized)) {
    return { type: 'comparative' };
  }
  if (/(누구|무엇|어떤|who|what)/iu.test(normalized)) {
    return { type: 'factual' };
  }
  return { type: 'ordinary-rag' };
}

function findMentionedEntities(
  question: string,
  entities: readonly GraphEntityRecord[],
  ontologySchemaId: string,
): GraphEntityRecord[] {
  const normalizedQuestion = normalizeEntityName(question);
  return entities.filter((entity) => {
    if (entity.ontologySchemaId !== ontologySchemaId) return false;
    const names = [entity.canonicalName, ...entity.aliases].map(normalizeEntityName);
    return names.some((name) => normalizedQuestion.includes(name));
  });
}

function collectEvidenceIds(
  records: ReadonlyArray<
    Pick<GraphEntityRecord, 'evidenceIds'> |
    Pick<GraphRelationRecord, 'evidenceIds'> |
    Pick<GraphClaimRecord, 'evidenceIds'>
  >,
): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const evidenceId of record.evidenceIds) {
      ids.add(evidenceId);
    }
  }
  return [...ids];
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

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const dimensions = Math.min(a.length, b.length);
  for (let i = 0; i < dimensions; i++) {
    const aValue = a[i] ?? 0;
    const bValue = b[i] ?? 0;
    dot += aValue * bValue;
    normA += aValue * aValue;
    normB += bValue * bValue;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}
