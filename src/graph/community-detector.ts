import { detectCommunitiesFromEdgesRust, planGraphEdgeRecordsRust } from '../rag/rust-core';
import type { GraphEntityRecord, GraphRelationRecord } from './store';

export interface CommunityEdge {
  source: string;
  target: string;
  weight: number;
}

export interface CommunityDetectionResult {
  communities: Map<string, number>;
  communityIds: number[];
  modularity: number;
}

export function buildEdges(
  entities: readonly GraphEntityRecord[],
  relations: readonly GraphRelationRecord[],
): CommunityEdge[] {
  const rustEdges = buildEdgesWithRust(entities, relations);
  if (rustEdges !== null) return rustEdges;
  return [];
}

function buildEdgesWithRust(
  entities: readonly GraphEntityRecord[],
  relations: readonly GraphRelationRecord[],
): CommunityEdge[] | null {
  if (entities.length === 0 || relations.length === 0) return [];

  return planGraphEdgeRecordsRust(
    entities.map((entity) => entity.id),
    relations.map((relation) => relation.sourceEntityId),
    relations.map((relation) => relation.targetEntityId),
    relations.map((relation) => relation.confidence),
  );
}

export function detectCommunities(
  edges: CommunityEdge[],
  maxIterations = 20,
): CommunityDetectionResult {
  const rustResult = detectCommunitiesFromEdgesRust(edges, maxIterations);
  if (rustResult === null) return { communities: new Map(), communityIds: [], modularity: 0 };
  const communities = new Map<string, number>();
  for (const assignment of rustResult.assignmentsById) {
    communities.set(assignment.entityId, assignment.communityId);
  }

  return {
    communities,
    communityIds: rustResult.communityIds,
    modularity: rustResult.modularity,
  };
}
