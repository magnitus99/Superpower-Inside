import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider, ChatMessage } from '../llm/providers';
import {
  createGraphIdRust,
  planGraphCommunitySummaryGroupsRust,
  planGraphCommunitySummaryGroupsFallback,
  type RustGraphCommunityAssignmentInput,
  type RustGraphCommunitySummaryClaimInput,
  type RustGraphCommunitySummaryGroupsPlan,
  type RustGraphCommunitySummaryRelationInput,
} from '../rag/rust-core';
import type {
  GraphCommunityRecord,
  GraphEntityRecord,
  GraphRelationRecord,
  GraphClaimRecord,
  KnowledgeGraphStore,
} from './store';
import { selectByRustIndices } from '../utils/rust-index-plan';

export interface CommunitySummarizerOptions {
  provider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  store: KnowledgeGraphStore;
  ontologySchemaId: string;
}

function formatEntitySummary(entity: GraphEntityRecord): string {
  const parts = [entity.canonicalName];
  if (entity.aliases.length > 0) {
    parts.push(`(${entity.aliases.join(', ')})`);
  }
  if (entity.description) {
    parts.push(`: ${entity.description}`);
  }
  return parts.join(' ');
}

function formatRelationSummary(
  relation: GraphRelationRecord,
  sourceLabel: string,
  targetLabel: string,
): string {
  return `${sourceLabel} --[${relation.relationTypeId}]--> ${targetLabel}${relation.description ? `: ${relation.description}` : ''}`;
}

function formatClaimSummary(claim: GraphClaimRecord, entityMap: Map<string, GraphEntityRecord>): string {
  const entityNames = claim.entityIds
    .map((id) => entityMap.get(id)?.canonicalName ?? id)
    .join(', ');
  return `[${claim.claimTypeId}] ${entityNames}: ${claim.text}`;
}

function requireCommunitySummaryGroups(
  communityAssignment: ReadonlyMap<string, number>,
  entities: readonly GraphEntityRecord[],
  relations: readonly GraphRelationRecord[],
  claims: readonly GraphClaimRecord[],
  communityIds: readonly number[],
): RustGraphCommunitySummaryGroupsPlan {
  const plan = planGraphCommunitySummaryGroupsRust(
    [...communityAssignment].map(
      ([entityId, communityId]): RustGraphCommunityAssignmentInput => ({
        entityId,
        communityId,
      }),
    ),
    entities.map((entity) => entity.id),
    relations.map(
      (relation): RustGraphCommunitySummaryRelationInput => ({
        sourceEntityId: relation.sourceEntityId,
        targetEntityId: relation.targetEntityId,
      }),
    ),
    claims.map(
      (claim): RustGraphCommunitySummaryClaimInput => ({
        entityIds: claim.entityIds,
      }),
    ),
    communityIds,
  );
  if (plan === null) {
    return planGraphCommunitySummaryGroupsFallback(
      [...communityAssignment].map(
        ([entityId, communityId]): RustGraphCommunityAssignmentInput => ({
          entityId,
          communityId,
        }),
      ),
      entities.map((entity) => entity.id),
      relations.map(
        (relation): RustGraphCommunitySummaryRelationInput => ({
          sourceEntityId: relation.sourceEntityId,
          targetEntityId: relation.targetEntityId,
        }),
      ),
      claims.map(
        (claim): RustGraphCommunitySummaryClaimInput => ({
          entityIds: claim.entityIds,
        }),
      ),
      communityIds,
    );
  }
  return plan;
}

function selectByIndex<T>(items: readonly T[], indices: readonly number[]): T[] {
  return selectByRustIndices(items, indices, { dedupe: true });
}

export class CommunitySummarizer {
  private provider: LLMProvider;
  private embeddingProvider: EmbeddingProvider;
  private store: KnowledgeGraphStore;
  private ontologySchemaId: string;

  constructor(options: CommunitySummarizerOptions) {
    this.provider = options.provider;
    this.embeddingProvider = options.embeddingProvider;
    this.store = options.store;
    this.ontologySchemaId = options.ontologySchemaId;
  }

  async summarizeCommunities(
    communityAssignment: Map<string, number>,
    communityIds: readonly number[],
    signal?: AbortSignal,
  ): Promise<GraphCommunityRecord[]> {
    const [allEntities, allRelations, allClaims] = await Promise.all([
      this.store.getEntities(),
      this.store.getRelations(),
      this.store.getClaims(),
    ]);

    const groupingPlan = requireCommunitySummaryGroups(
      communityAssignment,
      allEntities,
      allRelations,
      allClaims,
      communityIds,
    );

    const communities: GraphCommunityRecord[] = [];
    for (const [communityIndex, communityId] of communityIds.entries()) {
      if (signal?.aborted) break;

      const group = groupingPlan.groups[communityIndex];
      if (group === undefined) {
        continue;
      }
      const entities = selectByIndex(allEntities, group.entityIndices);
      const relations = selectByIndex(allRelations, group.relationIndices);
      const claims = selectByIndex(allClaims, group.claimIndices);

      if (entities.length === 0) continue;

      const title = `Community ${communityId}`;
      const entityNames = entities.map((e) => e.canonicalName).join(', ');
      const summary = await this.generateSummary(
        communityId,
        entities.slice(0, 15),
        relations.slice(0, 15),
        claims.slice(0, 10),
        signal,
      );
      if (signal?.aborted) break;

      const summaryVector = await this.embeddingProvider.embed(summary, { signal });

      const relationIds = relations.map((r) => r.id);
      const claimIds = claims.map((c) => c.id);
      const entityIds = entities.map((e) => e.id);
      const communityRecordId = createGraphIdRust([
        'community',
        this.ontologySchemaId,
        String(communityId),
        entityNames.replaceAll(' ', '-').slice(0, 80),
      ]);

      communities.push({
        id:
          communityRecordId ??
          `community::${this.ontologySchemaId}::${communityId}::${entityNames.replaceAll(' ', '-').slice(0, 80)}`,
        ontologySchemaId: this.ontologySchemaId,
        title,
        entityIds,
        relationIds,
        claimIds,
        summary,
        summaryVector,
        level: 0,
        updatedAt: Date.now(),
      });
    }

    return communities;
  }

  private async generateSummary(
    communityId: number,
    entities: GraphEntityRecord[],
    relations: GraphRelationRecord[],
    claims: GraphClaimRecord[],
    signal?: AbortSignal,
  ): Promise<string> {
    const entityMap = new Map(entities.map((e) => [e.id, e]));

    const entityLines = entities.map((e) => `  - ${formatEntitySummary(e)}`).join('\n');
    const relationLines = relations
      .map((r) => {
        const source = entityMap.get(r.sourceEntityId);
        const target = entityMap.get(r.targetEntityId);
        return `  - ${formatRelationSummary(r, source?.canonicalName ?? r.sourceEntityId, target?.canonicalName ?? r.targetEntityId)}`;
      })
      .join('\n');
    const claimLines = claims
      .map((c) => `  - ${formatClaimSummary(c, entityMap)}`)
      .join('\n');

    const prompt = [
      'You are analyzing a knowledge graph community detected from a document vault.',
      'Below are the entities, relations, and claims grouped into one community of related concepts.',
      '',
      '## Entities',
      entityLines || '  (none)',
      '',
      '## Relations',
      relationLines || '  (none)',
      '',
      '## Claims',
      claimLines || '  (none)',
      '',
      'Write a concise thematic summary (2-4 sentences in Korean) describing the main topic, key entities, and relationships found in this community. Focus on what connects these entities together thematically.',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a knowledge graph analyst. Write concise community summaries in Korean (2-4 sentences).' },
      { role: 'user', content: prompt },
    ];

    try {
      const summary = await this.provider.chat(messages, 0.3, undefined, { signal });
      return summary.trim() || `Community ${communityId}: ${entities.map((e) => e.canonicalName).join(', ')}`;
    } catch {
      if (signal?.aborted) {
        return `Community ${communityId}: ${entities.map((e) => e.canonicalName).join(', ')}`;
      }
      return `Community ${communityId}: ${entities.map((e) => e.canonicalName).join(', ')}`;
    }
  }
}
