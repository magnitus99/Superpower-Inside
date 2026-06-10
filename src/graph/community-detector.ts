import type { GraphEntityRecord, GraphRelationRecord } from './store';
import { aggregateGraphEdgesRust, detectCommunitiesRust } from '../rag/rust-core';

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
  return buildEdgesWithTypeScript(entities, relations);
}

function buildEdgesWithTypeScript(
  entities: readonly GraphEntityRecord[],
  relations: readonly GraphRelationRecord[],
): CommunityEdge[] {
  const entityIds = new Set(entities.map((e) => e.id));
  const edgeMap = new Map<string, CommunityEdge>();

  for (const relation of relations) {
    if (!entityIds.has(relation.sourceEntityId) || !entityIds.has(relation.targetEntityId))
      continue;
    const [a, b] = [relation.sourceEntityId, relation.targetEntityId].sort();
    const key = `${a}\0${b}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.weight += relation.confidence;
    } else {
      edgeMap.set(key, { source: a, target: b, weight: relation.confidence });
    }
  }

  return [...edgeMap.values()];
}

function buildEdgesWithRust(
  entities: readonly GraphEntityRecord[],
  relations: readonly GraphRelationRecord[],
): CommunityEdge[] | null {
  if (entities.length === 0 || relations.length === 0) return [];

  const entityIds = [...new Set(entities.map((entity) => entity.id))].sort();
  const entityIndexById = new Map(entityIds.map((id, index) => [id, index]));
  const sourceIndices: number[] = [];
  const targetIndices: number[] = [];
  const confidences: number[] = [];

  for (const relation of relations) {
    const sourceIndex = entityIndexById.get(relation.sourceEntityId);
    const targetIndex = entityIndexById.get(relation.targetEntityId);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    sourceIndices.push(sourceIndex);
    targetIndices.push(targetIndex);
    confidences.push(relation.confidence);
  }

  if (sourceIndices.length === 0) return [];

  const rustEdges = aggregateGraphEdgesRust(
    sourceIndices,
    targetIndices,
    confidences,
    entityIds.length,
  );
  if (rustEdges === null) return null;

  const edges: CommunityEdge[] = [];
  for (const edge of rustEdges) {
    const source = entityIds[edge.sourceIndex];
    const target = entityIds[edge.targetIndex];
    if (source === undefined || target === undefined) return null;
    edges.push({ source, target, weight: edge.weight });
  }
  return edges;
}

function extractUniqueEntityIds(edges: CommunityEdge[]): string[] {
  const set = new Set<string>();
  for (const edge of edges) {
    set.add(edge.source);
    set.add(edge.target);
  }
  return [...set].sort();
}

function buildAdjacency(
  nodeCount: number,
  edges: CommunityEdge[],
  idToIndex: Map<string, number>,
): {
  adjacency: Map<number, number>[];
  degrees: number[];
  totalWeight: number;
} {
  const adjacency = Array.from(
    { length: nodeCount },
    (): Map<number, number> => new Map<number, number>(),
  );
  const degrees = Array.from({ length: nodeCount }, (): number => 0);
  let totalWeight = 0;

  for (const edge of edges) {
    const si = idToIndex.get(edge.source);
    const ti = idToIndex.get(edge.target);
    if (si === undefined || ti === undefined) continue;

    adjacency[si].set(ti, (adjacency[si].get(ti) ?? 0) + edge.weight);
    adjacency[ti].set(si, (adjacency[ti].get(si) ?? 0) + edge.weight);
    degrees[si] += edge.weight;
    degrees[ti] += edge.weight;
    totalWeight += edge.weight * 2;
  }

  return { adjacency, degrees, totalWeight };
}

function calculateModularity(
  nodeCount: number,
  adjacency: Map<number, number>[],
  degrees: number[],
  communityAssignment: Map<number, number>,
  totalWeight: number,
): number {
  if (totalWeight === 0) return 0;
  let q = 0;
  for (let i = 0; i < nodeCount; i++) {
    const ci = communityAssignment.get(i) ?? i;
    for (const [j, weight] of adjacency[i]) {
      const cj = communityAssignment.get(j) ?? j;
      if (ci === cj) {
        q += weight - (degrees[i] * degrees[j]) / totalWeight;
      }
    }
  }
  return q / totalWeight;
}

function remapCommunityIds(
  nodeCount: number,
  rawAssignment: Map<number, number>,
): Map<number, number> {
  const uniqueIds = [...new Set(rawAssignment.values())].sort();
  const idMap = new Map(uniqueIds.map((id, idx) => [id, idx]));
  const result = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    const cid = rawAssignment.get(i) ?? i;
    result.set(i, idMap.get(cid) ?? 0);
  }
  return result;
}

export function detectCommunities(
  edges: CommunityEdge[],
  maxIterations = 20,
): CommunityDetectionResult {
  const uniqueIds = extractUniqueEntityIds(edges);
  if (uniqueIds.length === 0) {
    return { communities: new Map(), communityIds: [], modularity: 0 };
  }

  const rustResult = detectCommunitiesWithRust(edges, uniqueIds, maxIterations);
  if (rustResult !== null) return rustResult;

  const nodeCount = uniqueIds.length;
  const idToIndex = new Map(uniqueIds.map((id, i) => [id, i]));
  const indexToId = new Map(uniqueIds.map((id, i) => [i, id]));

  const { adjacency, degrees, totalWeight } = buildAdjacency(nodeCount, edges, idToIndex);
  if (totalWeight === 0) {
    return { communities: new Map(), communityIds: [], modularity: 0 };
  }

  const communityOfNode = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    communityOfNode.set(i, i);
  }

  const communityDegrees = new Map<number, number>();
  for (let i = 0; i < nodeCount; i++) {
    const c = communityOfNode.get(i)!;
    communityDegrees.set(c, (communityDegrees.get(c) ?? 0) + degrees[i]);
  }

  const invTotalWeight = 1 / totalWeight;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < nodeCount; i++) {
      const currentCommunity = communityOfNode.get(i)!;
      const degree = degrees[i];

      const neighborCommunities = new Map<number, number>();
      for (const [neighbor, weight] of adjacency[i]) {
        const nc = communityOfNode.get(neighbor)!;
        neighborCommunities.set(nc, (neighborCommunities.get(nc) ?? 0) + weight);
      }

      if (neighborCommunities.size === 0) continue;

      let bestCommunity = currentCommunity;
      let bestDelta = 0;
      const currentCommunityDegree = communityDegrees.get(currentCommunity) ?? 0;

      for (const [candidate, edgeWeightToCommunity] of neighborCommunities) {
        if (candidate === currentCommunity) continue;
        const candidateDegree = communityDegrees.get(candidate) ?? 0;
        const delta =
          (edgeWeightToCommunity - (neighborCommunities.get(currentCommunity) ?? 0)) *
            invTotalWeight +
          (currentCommunityDegree - candidateDegree) * degree * invTotalWeight * invTotalWeight;

        if (delta > bestDelta) {
          bestDelta = delta;
          bestCommunity = candidate;
        }
      }

      if (bestCommunity !== currentCommunity) {
        communityOfNode.set(i, bestCommunity);
        communityDegrees.set(
          currentCommunity,
          (communityDegrees.get(currentCommunity) ?? 0) - degree,
        );
        communityDegrees.set(bestCommunity, (communityDegrees.get(bestCommunity) ?? 0) + degree);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const remapped = remapCommunityIds(nodeCount, communityOfNode);
  const finalAssignment = new Map<string, number>();
  for (let i = 0; i < nodeCount; i++) {
    const entityId = indexToId.get(i)!;
    finalAssignment.set(entityId, remapped.get(i) ?? 0);
  }
  const communityIds = [...new Set(remapped.values())].sort();
  const modularity = calculateModularity(nodeCount, adjacency, degrees, remapped, totalWeight);

  return { communities: finalAssignment, communityIds, modularity };
}

function detectCommunitiesWithRust(
  edges: readonly CommunityEdge[],
  uniqueIds: readonly string[],
  maxIterations: number,
): CommunityDetectionResult | null {
  const idToIndex = new Map(uniqueIds.map((id, index) => [id, index]));
  const sourceIndices: number[] = [];
  const targetIndices: number[] = [];
  const weights: number[] = [];

  for (const edge of edges) {
    const sourceIndex = idToIndex.get(edge.source);
    const targetIndex = idToIndex.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    sourceIndices.push(sourceIndex);
    targetIndices.push(targetIndex);
    weights.push(edge.weight);
  }

  const rustResult = detectCommunitiesRust(
    uniqueIds.length,
    sourceIndices,
    targetIndices,
    weights,
    maxIterations,
  );
  if (rustResult === null || rustResult.assignments.length !== uniqueIds.length) return null;

  const communities = new Map<string, number>();
  for (let index = 0; index < uniqueIds.length; index++) {
    const entityId = uniqueIds[index];
    const communityId = rustResult.assignments[index];
    if (entityId === undefined || communityId === undefined) return null;
    communities.set(entityId, communityId);
  }

  return {
    communities,
    communityIds: rustResult.communityIds,
    modularity: rustResult.modularity,
  };
}
