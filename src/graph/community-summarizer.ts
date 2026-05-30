import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider, ChatMessage } from '../llm/providers';
import type {
  GraphCommunityRecord,
  GraphEntityRecord,
  GraphRelationRecord,
  GraphClaimRecord,
  KnowledgeGraphStore,
} from './store';

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

    const entityMap = new Map(allEntities.map((e) => [e.id, e]));
    const groupedEntities = new Map<number, GraphEntityRecord[]>();
    for (const [entityId, communityId] of communityAssignment) {
      const entity = entityMap.get(entityId);
      if (entity) {
        const list = groupedEntities.get(communityId) ?? [];
        list.push(entity);
        groupedEntities.set(communityId, list);
      }
    }

    const communityRelations = new Map<number, GraphRelationRecord[]>();
    const communityClaims = new Map<number, GraphClaimRecord[]>();

    for (const relation of allRelations) {
      const sourceCommunity = communityAssignment.get(relation.sourceEntityId);
      const targetCommunity = communityAssignment.get(relation.targetEntityId);
      if (sourceCommunity === undefined || targetCommunity === undefined) continue;
      if (sourceCommunity !== targetCommunity) continue;
      const list = communityRelations.get(sourceCommunity) ?? [];
      list.push(relation);
      communityRelations.set(sourceCommunity, list);
    }

    for (const claim of allClaims) {
      for (const entityId of claim.entityIds) {
        const communityId = communityAssignment.get(entityId);
        if (communityId !== undefined) {
          const list = communityClaims.get(communityId) ?? [];
          list.push(claim);
          communityClaims.set(communityId, list);
          break;
        }
      }
    }

    const communities: GraphCommunityRecord[] = [];
    for (const communityId of communityIds) {
      if (signal?.aborted) break;

      const entities = groupedEntities.get(communityId) ?? [];
      const relations = communityRelations.get(communityId) ?? [];
      const claims = communityClaims.get(communityId) ?? [];

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

      const summaryVector = await this.embeddingProvider.embed(summary);

      const relationIds = relations.map((r) => r.id);
      const claimIds = claims.map((c) => c.id);
      const entityIds = entities.map((e) => e.id);

      communities.push({
        id: `community::${this.ontologySchemaId}::${communityId}::${entityNames.replaceAll(' ', '-').slice(0, 80)}`,
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
      void signal;
      const summary = await this.provider.chat(messages, 0.3);
      return summary.trim() || `Community ${communityId}: ${entities.map((e) => e.canonicalName).join(', ')}`;
    } catch {
      return `Community ${communityId}: ${entities.map((e) => e.canonicalName).join(', ')}`;
    }
  }
}
