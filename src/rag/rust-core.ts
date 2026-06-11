import {
  aggregate_graph_edges_flat,
  assign_vector_clusters,
  bm25_score_pairs,
  chunk_markdown_json,
  chunk_plain_text_json,
  core_version,
  count_keyword_matches,
  cosine_similarity_or_nan,
  create_content_hash,
  detect_communities_flat,
  extract_vault_links_json,
  hybrid_score_or_nan,
  initSync,
  is_excluded_path,
  normalize_entity_name,
  parse_mention_candidates_json,
  prune_graph_indexes_json,
  rank_top_k_pairs,
  recompute_centroids,
  rrf_score_or_nan,
  score_entity_match_or_nan,
  select_diverse_indices,
  score_local_evidence_pairs,
  token_frequencies_json,
  tokenize_json,
} from '../../generated/rag-wasm/rag_wasm.js';
import type { Chunk } from './indexer';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

export interface RustVectorScore {
  index: number;
  score: number;
}

export interface RustBm25Posting {
  docIndex: number;
  termFrequency: number;
  docLength: number;
}

export interface RustBm25Term {
  postings: readonly RustBm25Posting[];
}

export interface RustBm25TermFrequencies {
  totalTokens: number;
  frequencies: Record<string, number>;
}

export interface RustHybridScoreInput {
  combinedBase: number;
  rrfScore: number;
  sourcePrior: number;
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
  retrievalSources: readonly string[];
}

export interface RustDiverseCandidate {
  score: number;
  vector: readonly number[];
  sourceKey: number;
  headingKey: number;
}

export interface RustCommunityDetectionResult {
  assignments: number[];
  communityIds: number[];
  modularity: number;
}

export interface RustGraphEdge {
  sourceIndex: number;
  targetIndex: number;
  weight: number;
}

export interface RustLocalEvidenceInput {
  entityCount: number;
  matchEntityIndices: readonly number[];
  matchScores: readonly number[];
  matchEvidenceOffsets: readonly number[];
  matchEvidenceIndices: readonly number[];
  relationSourceIndices: readonly number[];
  relationTargetIndices: readonly number[];
  relationConfidences: readonly number[];
  relationEvidenceOffsets: readonly number[];
  relationEvidenceIndices: readonly number[];
  claimEntityOffsets: readonly number[];
  claimEntityIndices: readonly number[];
  claimConfidences: readonly number[];
  claimEvidenceOffsets: readonly number[];
  claimEvidenceIndices: readonly number[];
  evidenceCount: number;
  traversalDepth: number;
}

export interface RustEntityMatchInput {
  candidateNames: readonly string[];
  existingNames: readonly string[];
  candidateDescription: string;
  existingDescription: string;
  candidateEvidenceIds: readonly string[];
  existingEvidenceIds: readonly string[];
  sameType: boolean;
  embeddingScore: number;
}

export interface RustMentionCandidate {
  raw: string;
  name: string;
}

export interface RustGraphPruneInput {
  filePaths: readonly string[];
  evidenceFilePaths: readonly string[];
  evidenceEntryIds: readonly string[];
  entitySchemaIds: readonly string[];
  entityEvidenceIndices: readonly (readonly number[])[];
  relationSchemaIds: readonly string[];
  relationSourceEntityIndices: readonly number[];
  relationTargetEntityIndices: readonly number[];
  relationEvidenceIndices: readonly (readonly number[])[];
  claimEntityIndices: readonly (readonly number[])[];
  claimRelationIndices: readonly (readonly number[])[];
  claimEvidenceIndices: readonly (readonly number[])[];
  communitySchemaIds: readonly string[];
  communityEntityIndices: readonly (readonly number[])[];
  communityRelationIndices: readonly (readonly number[])[];
  communityClaimIndices: readonly (readonly number[])[];
  rejectedFactFilePaths: readonly string[];
  rejectedFactEntryIds: readonly string[];
  extractionCacheEntryIds: readonly string[];
  pendingMergeExistingEntityIndices: readonly number[];
  pendingMergeCandidateEntityIndices: readonly number[];
}

export interface RustGraphPrunePlan {
  deletedEvidenceIndices: number[];
  deletedEntityIndices: number[];
  updatedEntityIndices: number[];
  deletedRelationIndices: number[];
  updatedRelationIndices: number[];
  deletedClaimIndices: number[];
  updatedClaimIndices: number[];
  deletedCommunityIndices: number[];
  deletedRejectedFactIndices: number[];
  deletedExtractionCacheIndices: number[];
  deletedPendingMergeIndices: number[];
}

export const RUST_GRAPH_PRUNE_UNKNOWN_INDEX = 0xffffffff;

let initialized = false;
let unavailable = false;

export function isRustCoreAvailable(): boolean {
  return ensureRustCore();
}

export function getRustCoreVersion(): string | null {
  if (!ensureRustCore()) return null;
  return core_version();
}

export function createContentHashRust(content: string): string | null {
  if (!ensureRustCore()) return null;
  return create_content_hash(content);
}

export function tokenizeRust(text: string): string[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(tokenize_json(text));
    if (
      !Array.isArray(parsed) ||
      !parsed.every((token): token is string => typeof token === 'string')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function bm25TermFrequenciesRust(text: string): RustBm25TermFrequencies | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(token_frequencies_json(text));
    if (!isBm25TermFrequencies(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function countKeywordMatchesRust(
  queryTokens: readonly string[],
  text: string,
): number | null {
  if (!ensureRustCore()) return null;
  if (queryTokens.length === 0) return 0;
  try {
    const packedTokens = queryTokens.join('\u{1f}');
    return count_keyword_matches(packedTokens, text);
  } catch {
    return null;
  }
}

export function cosineSimilarityRust(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (!ensureRustCore()) return null;
  const score = cosine_similarity_or_nan(new Float64Array(left), new Float64Array(right));
  return Number.isFinite(score) ? score : null;
}

export function rankTopKPairsRust(
  query: readonly number[],
  vectors: readonly (readonly number[])[],
  topK: number,
): RustVectorScore[] | null {
  if (topK <= 0) return [];
  if (query.length === 0) return [];
  if (!ensureRustCore()) return null;

  const compatibleRows: number[] = [];
  const flatValues: number[] = [];
  for (let index = 0; index < vectors.length; index++) {
    const vector = vectors[index];
    if (!vector || vector.length !== query.length) continue;
    compatibleRows.push(index);
    flatValues.push(...vector);
  }

  if (compatibleRows.length === 0) return [];

  const pairs = rank_top_k_pairs(
    new Float64Array(query),
    new Float64Array(flatValues),
    query.length,
    topK,
  );
  return decodeRankPairs(pairs, compatibleRows);
}

export function assignVectorClustersRust(
  vectors: readonly (readonly number[])[],
  centroids: readonly (readonly number[])[],
): number[] | null {
  if (vectors.length === 0) return [];
  const matrix = encodeCompatibleVectorMatrix(vectors, centroids);
  if (matrix === null) return null;
  if (!ensureRustCore()) return null;

  const assignments = assign_vector_clusters(
    matrix.flatVectors,
    matrix.flatCentroids,
    matrix.dimension,
  );
  const decoded = decodeIndexArray(assignments, centroids.length);
  if (decoded === null || decoded.length !== vectors.length) return null;
  return decoded;
}

export function recomputeCentroidsRust(
  vectors: readonly (readonly number[])[],
  assignments: readonly number[],
  previousCentroids: readonly (readonly number[])[],
): number[][] | null {
  if (previousCentroids.length === 0) return [];
  if (vectors.length !== assignments.length) return null;
  const matrix = encodeCompatibleVectorMatrix(vectors, previousCentroids);
  if (matrix === null) return null;
  if (!isValidUint32Array(assignments, previousCentroids.length)) return null;
  if (!ensureRustCore()) return null;

  const values = recompute_centroids(
    matrix.flatVectors,
    new Uint32Array(assignments),
    matrix.flatCentroids,
    matrix.dimension,
  );
  return decodeVectorMatrix(values, previousCentroids.length, matrix.dimension);
}

export function scoreBm25Rust(
  terms: readonly RustBm25Term[],
  totalDocs: number,
  avgDocLength: number,
): RustVectorScore[] | null {
  if (terms.length === 0 || totalDocs <= 0) return [];
  if (!Number.isFinite(avgDocLength) || avgDocLength <= 0) return [];
  if (!ensureRustCore()) return null;

  const termOffsets: number[] = [0];
  const docIndices: number[] = [];
  const termFrequencies: number[] = [];
  const docLengths: number[] = [];

  for (const term of terms) {
    for (const posting of term.postings) {
      if (!isValidBm25Posting(posting)) continue;
      docIndices.push(posting.docIndex);
      termFrequencies.push(posting.termFrequency);
      docLengths[posting.docIndex] = posting.docLength;
    }
    termOffsets.push(docIndices.length);
  }

  if (docIndices.length === 0) return [];

  for (let index = 0; index < docLengths.length; index++) {
    if (!Number.isFinite(docLengths[index]) || docLengths[index] <= 0) {
      docLengths[index] = 1;
    }
  }

  const pairs = bm25_score_pairs(
    new Uint32Array(termOffsets),
    new Uint32Array(docIndices),
    new Float64Array(termFrequencies),
    new Float64Array(docLengths),
    normalizeNonNegativeInteger(totalDocs),
    avgDocLength,
  );
  return decodeIndexScorePairs(pairs);
}

export function calculateRrfScoreRust(
  sourceRanks: Partial<Record<string, number>>,
  bm25Weight: number,
): number | null {
  const sourceCodes: number[] = [];
  const ranks: number[] = [];
  for (const [source, rank] of Object.entries(sourceRanks)) {
    if (typeof rank !== 'number' || rank < 1) continue;
    sourceCodes.push(sourceToCode(source));
    ranks.push(rank);
  }
  if (sourceCodes.length === 0) return 0;
  if (!ensureRustCore()) return null;

  const score = rrf_score_or_nan(new Uint8Array(sourceCodes), new Float64Array(ranks), bm25Weight);
  return Number.isFinite(score) ? score : null;
}

export function calculateHybridScoreRust(input: RustHybridScoreInput): number | null {
  if (!ensureRustCore()) return null;
  const sourceCodes = input.retrievalSources.map(sourceToCode);
  const score = hybrid_score_or_nan(
    input.combinedBase,
    input.rrfScore,
    input.sourcePrior,
    input.sourceEvidenceScore,
    input.bestEvidenceRank ?? Number.NaN,
    new Uint8Array(sourceCodes),
  );
  return Number.isFinite(score) ? score : null;
}

export function selectDiverseIndicesRust(
  candidates: readonly RustDiverseCandidate[],
  topK: number,
): number[] | null {
  if (topK <= 0) return [];
  if (candidates.length === 0) return [];
  if (candidates.length <= topK) return candidates.map((_, index) => index);
  if (!ensureRustCore()) return null;

  const dimension = candidates[0]?.vector.length ?? 0;
  if (dimension <= 0) return null;

  const scores = new Float64Array(candidates.length);
  const flatVectors = new Float64Array(candidates.length * dimension);
  const sourceKeys = new Uint32Array(candidates.length);
  const headingKeys = new Uint32Array(candidates.length);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate || !isValidUint32(candidate.sourceKey) || !isValidUint32(candidate.headingKey)) {
      return null;
    }
    if (!Number.isFinite(candidate.score) || candidate.vector.length !== dimension) {
      return null;
    }
    scores[index] = candidate.score;
    sourceKeys[index] = candidate.sourceKey;
    headingKeys[index] = candidate.headingKey;
    for (let vectorIndex = 0; vectorIndex < dimension; vectorIndex++) {
      const value = candidate.vector[vectorIndex];
      if (!Number.isFinite(value)) return null;
      flatVectors[index * dimension + vectorIndex] = value;
    }
  }

  const indexes = select_diverse_indices(
    scores,
    flatVectors,
    dimension,
    sourceKeys,
    headingKeys,
    normalizeNonNegativeInteger(topK),
  );
  return decodeIndexArray(indexes, candidates.length);
}

export function detectCommunitiesRust(
  nodeCount: number,
  sourceIndices: readonly number[],
  targetIndices: readonly number[],
  weights: readonly number[],
  maxIterations: number,
): RustCommunityDetectionResult | null {
  if (nodeCount <= 0) {
    return { assignments: [], communityIds: [], modularity: 0 };
  }
  if (
    sourceIndices.length !== targetIndices.length ||
    sourceIndices.length !== weights.length ||
    !Number.isSafeInteger(nodeCount)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  const normalizedNodeCount = normalizePositiveInteger(nodeCount);
  const normalizedSourceIndices = new Uint32Array(sourceIndices.length);
  const normalizedTargetIndices = new Uint32Array(targetIndices.length);
  const normalizedWeights = new Float64Array(weights.length);

  for (let index = 0; index < sourceIndices.length; index++) {
    const sourceIndex = sourceIndices[index];
    const targetIndex = targetIndices[index];
    const weight = weights[index];
    if (
      !isValidUint32(sourceIndex) ||
      !isValidUint32(targetIndex) ||
      sourceIndex >= normalizedNodeCount ||
      targetIndex >= normalizedNodeCount ||
      !Number.isFinite(weight)
    ) {
      return null;
    }
    normalizedSourceIndices[index] = sourceIndex;
    normalizedTargetIndices[index] = targetIndex;
    normalizedWeights[index] = weight;
  }

  const values = detect_communities_flat(
    normalizedSourceIndices,
    normalizedTargetIndices,
    normalizedWeights,
    normalizedNodeCount,
    normalizeNonNegativeInteger(maxIterations),
  );
  if (values.length !== normalizedNodeCount + 1) return null;
  const modularity = values[0];
  if (!Number.isFinite(modularity)) return null;
  const assignments = decodeIndexArray(values.slice(1), normalizedNodeCount);
  if (assignments === null || assignments.length !== normalizedNodeCount) return null;
  return {
    assignments,
    communityIds: [...new Set(assignments)].sort((left, right) => left - right),
    modularity,
  };
}

export function aggregateGraphEdgesRust(
  sourceIndices: readonly number[],
  targetIndices: readonly number[],
  confidences: readonly number[],
  nodeCount: number,
): RustGraphEdge[] | null {
  if (nodeCount <= 0) return [];
  if (
    sourceIndices.length !== targetIndices.length ||
    sourceIndices.length !== confidences.length ||
    !Number.isSafeInteger(nodeCount)
  ) {
    return null;
  }
  if (sourceIndices.length === 0) return [];
  if (!ensureRustCore()) return null;

  const normalizedNodeCount = normalizePositiveInteger(nodeCount);
  const normalizedSourceIndices = new Uint32Array(sourceIndices.length);
  const normalizedTargetIndices = new Uint32Array(targetIndices.length);
  const normalizedConfidences = new Float64Array(confidences.length);

  for (let index = 0; index < sourceIndices.length; index++) {
    const sourceIndex = sourceIndices[index];
    const targetIndex = targetIndices[index];
    const confidence = confidences[index];
    if (
      !isValidUint32(sourceIndex) ||
      !isValidUint32(targetIndex) ||
      sourceIndex >= normalizedNodeCount ||
      targetIndex >= normalizedNodeCount ||
      !Number.isFinite(confidence)
    ) {
      return null;
    }
    normalizedSourceIndices[index] = sourceIndex;
    normalizedTargetIndices[index] = targetIndex;
    normalizedConfidences[index] = confidence;
  }

  const values = aggregate_graph_edges_flat(
    normalizedSourceIndices,
    normalizedTargetIndices,
    normalizedConfidences,
    normalizedNodeCount,
  );
  return decodeGraphEdgeTriples(values, normalizedNodeCount);
}

export function planGraphPruneRust(input: RustGraphPruneInput): RustGraphPrunePlan | null {
  if (!isValidGraphPruneInput(input)) return null;
  if (!ensureRustCore()) return null;

  const entityEvidence = encodeNestedUint32Arrays(input.entityEvidenceIndices);
  const relationEvidence = encodeNestedUint32Arrays(input.relationEvidenceIndices);
  const claimEntity = encodeNestedUint32Arrays(input.claimEntityIndices);
  const claimRelation = encodeNestedUint32Arrays(input.claimRelationIndices);
  const claimEvidence = encodeNestedUint32Arrays(input.claimEvidenceIndices);
  const communityEntity = encodeNestedUint32Arrays(input.communityEntityIndices);
  const communityRelation = encodeNestedUint32Arrays(input.communityRelationIndices);
  const communityClaim = encodeNestedUint32Arrays(input.communityClaimIndices);
  if (
    entityEvidence === null ||
    relationEvidence === null ||
    claimEntity === null ||
    claimRelation === null ||
    claimEvidence === null ||
    communityEntity === null ||
    communityRelation === null ||
    communityClaim === null
  ) {
    return null;
  }

  const config = new Uint32Array([
    input.filePaths.length,
    input.evidenceFilePaths.length,
    input.entitySchemaIds.length,
    entityEvidence.flat.length,
    input.relationSchemaIds.length,
    relationEvidence.flat.length,
    input.claimEvidenceIndices.length,
    claimEntity.flat.length,
    claimRelation.flat.length,
    claimEvidence.flat.length,
    input.communitySchemaIds.length,
    communityEntity.flat.length,
    communityRelation.flat.length,
    communityClaim.flat.length,
    input.rejectedFactFilePaths.length,
    input.extractionCacheEntryIds.length,
    input.pendingMergeExistingEntityIndices.length,
  ]);
  const indices = new Uint32Array([
    ...entityEvidence.offsets,
    ...entityEvidence.flat,
    ...input.relationSourceEntityIndices,
    ...input.relationTargetEntityIndices,
    ...relationEvidence.offsets,
    ...relationEvidence.flat,
    ...claimEntity.offsets,
    ...claimEntity.flat,
    ...claimRelation.offsets,
    ...claimRelation.flat,
    ...claimEvidence.offsets,
    ...claimEvidence.flat,
    ...communityEntity.offsets,
    ...communityEntity.flat,
    ...communityRelation.offsets,
    ...communityRelation.flat,
    ...communityClaim.offsets,
    ...communityClaim.flat,
    ...input.pendingMergeExistingEntityIndices,
    ...input.pendingMergeCandidateEntityIndices,
  ]);
  const wireValues = [
    input.filePaths,
    input.evidenceFilePaths,
    input.evidenceEntryIds,
    input.entitySchemaIds,
    input.relationSchemaIds,
    input.communitySchemaIds,
    input.rejectedFactFilePaths,
    input.rejectedFactEntryIds,
    input.extractionCacheEntryIds,
  ]
    .map((section) => section.join('\0'))
    .join('\u{1f}');

  try {
    const raw = prune_graph_indexes_json(config, indices, wireValues);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphPrunePlan(parsed, input)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function scoreLocalEvidenceRust(input: RustLocalEvidenceInput): RustVectorScore[] | null {
  if (input.entityCount <= 0 || input.evidenceCount <= 0) return [];
  if (!ensureRustCore()) return null;
  if (!isValidLocalEvidenceInput(input)) return null;

  const config = new Uint32Array([
    normalizeNonNegativeInteger(input.entityCount),
    normalizeNonNegativeInteger(input.evidenceCount),
    normalizeNonNegativeInteger(input.traversalDepth),
    input.matchEntityIndices.length,
    input.matchEvidenceIndices.length,
    input.relationSourceIndices.length,
    input.relationEvidenceIndices.length,
    input.claimConfidences.length,
    input.claimEntityIndices.length,
    input.claimEvidenceIndices.length,
  ]);
  const indices = new Uint32Array([
    ...input.matchEntityIndices,
    ...input.matchEvidenceOffsets,
    ...input.matchEvidenceIndices,
    ...input.relationSourceIndices,
    ...input.relationTargetIndices,
    ...input.relationEvidenceOffsets,
    ...input.relationEvidenceIndices,
    ...input.claimEntityOffsets,
    ...input.claimEntityIndices,
    ...input.claimEvidenceOffsets,
    ...input.claimEvidenceIndices,
  ]);
  const values = new Float64Array([
    ...input.matchScores,
    ...input.relationConfidences,
    ...input.claimConfidences,
  ]);

  const pairs = score_local_evidence_pairs(config, indices, values);
  return decodeBoundedIndexScorePairs(pairs, input.evidenceCount);
}

export function chunkMarkdownRust(
  content: string,
  maxChunkSize: number,
  overlapChars = 0,
): Chunk[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      chunk_markdown_json(
        content,
        normalizePositiveInteger(maxChunkSize),
        normalizeNonNegativeInteger(overlapChars),
      ),
    );
    if (!isChunkArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function chunkPlainTextRust(
  content: string,
  maxChunkSize: number,
  overlapChars = 0,
): Chunk[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      chunk_plain_text_json(
        content,
        normalizePositiveInteger(maxChunkSize),
        normalizeNonNegativeInteger(overlapChars),
      ),
    );
    if (!isChunkArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractVaultLinksRust(content: string): string[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(extract_vault_links_json(content));
    if (
      !Array.isArray(parsed) ||
      !parsed.every((link): link is string => typeof link === 'string')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseMentionCandidatesRust(content: string): RustMentionCandidate[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(parse_mention_candidates_json(content));
    if (!Array.isArray(parsed) || !parsed.every(isMentionCandidate)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isExcludedPathRust(filePath: string, patterns: readonly string[]): boolean | null {
  if (!ensureRustCore()) return null;
  return is_excluded_path(filePath, patterns.join('\0'));
}

export function normalizeEntityNameRust(name: string): string | null {
  if (!ensureRustCore()) return null;
  return normalize_entity_name(name);
}

export function scoreEntityMatchRust(input: RustEntityMatchInput): number | null {
  if (!ensureRustCore()) return null;
  if (!input.candidateNames.every(isStringValue) || !input.existingNames.every(isStringValue)) {
    return null;
  }
  if (
    !input.candidateEvidenceIds.every(isStringValue) ||
    !input.existingEvidenceIds.every(isStringValue)
  ) {
    return null;
  }
  if (!Number.isFinite(input.embeddingScore)) return null;

  const score = score_entity_match_or_nan(
    input.candidateNames.join('\0'),
    input.existingNames.join('\0'),
    `${input.existingDescription}\u{1f}${input.candidateDescription}`,
    `${input.existingEvidenceIds.join('\0')}\u{1f}${input.candidateEvidenceIds.join('\0')}`,
    input.sameType,
    input.embeddingScore,
  );
  return Number.isFinite(score) ? score : null;
}

function ensureRustCore(): boolean {
  if (initialized) return true;
  if (unavailable) return false;

  try {
    initSync(decodeBase64ToBytes(RAG_WASM_BASE64));
    initialized = true;
    return true;
  } catch {
    unavailable = true;
    return false;
  }
}

function decodeRankPairs(
  pairs: Float64Array,
  compatibleRows: readonly number[],
): RustVectorScore[] {
  const scores: RustVectorScore[] = [];
  for (let offset = 0; offset + 1 < pairs.length; offset += 2) {
    const localIndex = pairs[offset];
    const score = pairs[offset + 1];
    if (!Number.isInteger(localIndex) || !Number.isFinite(score)) continue;
    const originalIndex = compatibleRows[localIndex];
    if (originalIndex === undefined) continue;
    scores.push({ index: originalIndex, score });
  }
  return scores;
}

function decodeIndexScorePairs(pairs: Float64Array): RustVectorScore[] {
  const scores: RustVectorScore[] = [];
  for (let offset = 0; offset + 1 < pairs.length; offset += 2) {
    const index = pairs[offset];
    const score = pairs[offset + 1];
    if (!Number.isSafeInteger(index) || !Number.isFinite(score)) continue;
    scores.push({ index, score });
  }
  return scores;
}

function decodeBoundedIndexScorePairs(
  pairs: Float64Array,
  maxExclusive: number,
): RustVectorScore[] | null {
  if (pairs.length % 2 !== 0) return null;
  const scores: RustVectorScore[] = [];
  for (let offset = 0; offset + 1 < pairs.length; offset += 2) {
    const index = pairs[offset];
    const score = pairs[offset + 1];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= maxExclusive ||
      !Number.isFinite(score)
    ) {
      return null;
    }
    scores.push({ index, score });
  }
  return scores;
}

function decodeGraphEdgeTriples(
  values: Float64Array,
  maxExclusive: number,
): RustGraphEdge[] | null {
  if (values.length % 3 !== 0) return null;
  const edges: RustGraphEdge[] = [];
  for (let offset = 0; offset + 2 < values.length; offset += 3) {
    const sourceIndex = values[offset];
    const targetIndex = values[offset + 1];
    const weight = values[offset + 2];
    if (
      !Number.isSafeInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= maxExclusive ||
      !Number.isSafeInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= maxExclusive ||
      !Number.isFinite(weight)
    ) {
      return null;
    }
    edges.push({ sourceIndex, targetIndex, weight });
  }
  return edges;
}

function decodeIndexArray(values: Float64Array, maxExclusive: number): number[] | null {
  const indexes: number[] = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= maxExclusive) return null;
    indexes.push(value);
  }
  return indexes;
}

interface EncodedVectorMatrixPair {
  flatVectors: Float64Array;
  flatCentroids: Float64Array;
  dimension: number;
}

function encodeCompatibleVectorMatrix(
  vectors: readonly (readonly number[])[],
  centroids: readonly (readonly number[])[],
): EncodedVectorMatrixPair | null {
  const dimension = vectors[0]?.length ?? centroids[0]?.length ?? 0;
  if (dimension <= 0 || centroids.length === 0) return null;

  const flatVectors = encodeVectorMatrix(vectors, dimension);
  const flatCentroids = encodeVectorMatrix(centroids, dimension);
  if (flatVectors === null || flatCentroids === null) return null;
  return {
    flatVectors,
    flatCentroids,
    dimension,
  };
}

function encodeVectorMatrix(
  vectors: readonly (readonly number[])[],
  dimension: number,
): Float64Array | null {
  const values = new Float64Array(vectors.length * dimension);
  for (let rowIndex = 0; rowIndex < vectors.length; rowIndex++) {
    const vector = vectors[rowIndex];
    if (!vector || vector.length !== dimension) return null;
    for (let dimensionIndex = 0; dimensionIndex < dimension; dimensionIndex++) {
      const value = vector[dimensionIndex];
      if (!Number.isFinite(value)) return null;
      values[rowIndex * dimension + dimensionIndex] = value;
    }
  }
  return values;
}

function decodeVectorMatrix(
  values: Float64Array,
  rowCount: number,
  dimension: number,
): number[][] | null {
  if (dimension <= 0 || values.length !== rowCount * dimension) return null;
  const rows: number[][] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row: number[] = [];
    for (let dimensionIndex = 0; dimensionIndex < dimension; dimensionIndex++) {
      const value = values[rowIndex * dimension + dimensionIndex];
      if (!Number.isFinite(value)) return null;
      row.push(value);
    }
    rows.push(row);
  }
  return rows;
}

interface EncodedNestedUint32Arrays {
  offsets: number[];
  flat: number[];
}

function encodeNestedUint32Arrays(
  rows: readonly (readonly number[])[],
): EncodedNestedUint32Arrays | null {
  const offsets = [0];
  const flat: number[] = [];
  for (const row of rows) {
    for (const value of row) {
      if (!isValidUint32(value)) return null;
      flat.push(value);
    }
    if (!isValidUint32(flat.length)) return null;
    offsets.push(flat.length);
  }
  return { offsets, flat };
}

function isValidGraphPruneInput(input: RustGraphPruneInput): boolean {
  const evidenceCount = input.evidenceFilePaths.length;
  const entityCount = input.entitySchemaIds.length;
  const relationCount = input.relationSchemaIds.length;
  const claimCount = input.claimEvidenceIndices.length;
  const communityCount = input.communitySchemaIds.length;
  const rejectedFactCount = input.rejectedFactFilePaths.length;
  const pendingMergeCount = input.pendingMergeExistingEntityIndices.length;

  return (
    isDelimiterSafeStringArray(input.filePaths) &&
    isDelimiterSafeStringArray(input.evidenceFilePaths) &&
    isDelimiterSafeStringArray(input.evidenceEntryIds) &&
    isDelimiterSafeStringArray(input.entitySchemaIds) &&
    isDelimiterSafeStringArray(input.relationSchemaIds) &&
    isDelimiterSafeStringArray(input.communitySchemaIds) &&
    isDelimiterSafeStringArray(input.rejectedFactFilePaths) &&
    isDelimiterSafeStringArray(input.rejectedFactEntryIds) &&
    isDelimiterSafeStringArray(input.extractionCacheEntryIds) &&
    input.evidenceEntryIds.length === evidenceCount &&
    input.entityEvidenceIndices.length === entityCount &&
    input.relationSourceEntityIndices.length === relationCount &&
    input.relationTargetEntityIndices.length === relationCount &&
    input.relationEvidenceIndices.length === relationCount &&
    input.claimEntityIndices.length === claimCount &&
    input.claimRelationIndices.length === claimCount &&
    input.communityEntityIndices.length === communityCount &&
    input.communityRelationIndices.length === communityCount &&
    input.communityClaimIndices.length === communityCount &&
    input.rejectedFactEntryIds.length === rejectedFactCount &&
    input.pendingMergeCandidateEntityIndices.length === pendingMergeCount &&
    input.entityEvidenceIndices.every((row) => isValidGraphPruneIndexArray(row, evidenceCount)) &&
    input.relationSourceEntityIndices.every((index) =>
      isValidGraphPruneIndex(index, entityCount),
    ) &&
    input.relationTargetEntityIndices.every((index) =>
      isValidGraphPruneIndex(index, entityCount),
    ) &&
    input.relationEvidenceIndices.every((row) =>
      isValidGraphPruneIndexArray(row, evidenceCount),
    ) &&
    input.claimEntityIndices.every((row) => isValidGraphPruneIndexArray(row, entityCount)) &&
    input.claimRelationIndices.every((row) => isValidGraphPruneIndexArray(row, relationCount)) &&
    input.claimEvidenceIndices.every((row) => isValidGraphPruneIndexArray(row, evidenceCount)) &&
    input.communityEntityIndices.every((row) => isValidGraphPruneIndexArray(row, entityCount)) &&
    input.communityRelationIndices.every((row) =>
      isValidGraphPruneIndexArray(row, relationCount),
    ) &&
    input.communityClaimIndices.every((row) => isValidGraphPruneIndexArray(row, claimCount)) &&
    input.pendingMergeExistingEntityIndices.every((index) =>
      isValidGraphPruneIndex(index, entityCount),
    ) &&
    input.pendingMergeCandidateEntityIndices.every((index) =>
      isValidGraphPruneIndex(index, entityCount),
    )
  );
}

function isDelimiterSafeStringArray(values: readonly string[]): boolean {
  return values.every(
    (value) =>
      typeof value === 'string' && !value.includes('\0') && !value.includes('\u{1f}'),
  );
}

function isValidGraphPruneIndexArray(values: readonly number[], maxExclusive: number): boolean {
  return values.every((value) => isValidGraphPruneIndex(value, maxExclusive));
}

function isValidGraphPruneIndex(value: number, maxExclusive: number): boolean {
  return (
    value === RUST_GRAPH_PRUNE_UNKNOWN_INDEX ||
    (Number.isSafeInteger(value) && value >= 0 && value < maxExclusive)
  );
}

function isGraphPrunePlan(value: unknown, input: RustGraphPruneInput): value is RustGraphPrunePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphPrunePlan>;
  return (
    isBoundedIndexArray(plan.deletedEvidenceIndices, input.evidenceFilePaths.length) &&
    isBoundedIndexArray(plan.deletedEntityIndices, input.entitySchemaIds.length) &&
    isBoundedIndexArray(plan.updatedEntityIndices, input.entitySchemaIds.length) &&
    isBoundedIndexArray(plan.deletedRelationIndices, input.relationSchemaIds.length) &&
    isBoundedIndexArray(plan.updatedRelationIndices, input.relationSchemaIds.length) &&
    isBoundedIndexArray(plan.deletedClaimIndices, input.claimEvidenceIndices.length) &&
    isBoundedIndexArray(plan.updatedClaimIndices, input.claimEvidenceIndices.length) &&
    isBoundedIndexArray(plan.deletedCommunityIndices, input.communitySchemaIds.length) &&
    isBoundedIndexArray(plan.deletedRejectedFactIndices, input.rejectedFactFilePaths.length) &&
    isBoundedIndexArray(plan.deletedExtractionCacheIndices, input.extractionCacheEntryIds.length) &&
    isBoundedIndexArray(
      plan.deletedPendingMergeIndices,
      input.pendingMergeExistingEntityIndices.length,
    )
  );
}

function isBoundedIndexArray(value: unknown, maxExclusive: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (index) => Number.isSafeInteger(index) && index >= 0 && index < maxExclusive,
    )
  );
}

function isValidBm25Posting(posting: RustBm25Posting): boolean {
  return (
    Number.isSafeInteger(posting.docIndex) &&
    posting.docIndex >= 0 &&
    Number.isFinite(posting.termFrequency) &&
    posting.termFrequency > 0 &&
    Number.isFinite(posting.docLength) &&
    posting.docLength > 0
  );
}

function isValidUint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isStringValue(value: unknown): value is string {
  return typeof value === 'string';
}

function isMentionCandidate(value: unknown): value is RustMentionCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustMentionCandidate>;
  return typeof candidate.raw === 'string' && typeof candidate.name === 'string';
}

function isValidLocalEvidenceInput(input: RustLocalEvidenceInput): boolean {
  return (
    Number.isSafeInteger(input.entityCount) &&
    Number.isSafeInteger(input.evidenceCount) &&
    Number.isFinite(input.traversalDepth) &&
    input.matchEntityIndices.length === input.matchScores.length &&
    input.matchEvidenceOffsets.length === input.matchEntityIndices.length + 1 &&
    input.relationSourceIndices.length === input.relationTargetIndices.length &&
    input.relationSourceIndices.length === input.relationConfidences.length &&
    input.relationEvidenceOffsets.length === input.relationSourceIndices.length + 1 &&
    input.claimEntityOffsets.length === input.claimConfidences.length + 1 &&
    input.claimEvidenceOffsets.length === input.claimConfidences.length + 1 &&
    isValidUint32Array(input.matchEntityIndices, input.entityCount) &&
    isValidUint32Array(input.matchEvidenceOffsets) &&
    isValidUint32Array(input.matchEvidenceIndices, input.evidenceCount) &&
    isValidUint32Array(input.relationSourceIndices, input.entityCount) &&
    isValidUint32Array(input.relationTargetIndices, input.entityCount) &&
    isValidUint32Array(input.relationEvidenceOffsets) &&
    isValidUint32Array(input.relationEvidenceIndices, input.evidenceCount) &&
    isValidUint32Array(input.claimEntityOffsets) &&
    isValidUint32Array(input.claimEntityIndices, input.entityCount) &&
    isValidUint32Array(input.claimEvidenceOffsets) &&
    isValidUint32Array(input.claimEvidenceIndices, input.evidenceCount) &&
    input.matchScores.every(Number.isFinite) &&
    input.relationConfidences.every(Number.isFinite) &&
    input.claimConfidences.every(Number.isFinite) &&
    areValidOffsets(input.matchEvidenceOffsets, input.matchEvidenceIndices.length) &&
    areValidOffsets(input.relationEvidenceOffsets, input.relationEvidenceIndices.length) &&
    areValidOffsets(input.claimEntityOffsets, input.claimEntityIndices.length) &&
    areValidOffsets(input.claimEvidenceOffsets, input.claimEvidenceIndices.length)
  );
}

function isValidUint32Array(values: readonly number[], maxExclusive?: number): boolean {
  return values.every(
    (value) => isValidUint32(value) && (maxExclusive === undefined || value < maxExclusive),
  );
}

function areValidOffsets(offsets: readonly number[], flatLength: number): boolean {
  if (offsets.length === 0 || offsets[0] !== 0) return false;
  let previous = 0;
  for (const offset of offsets) {
    if (!isValidUint32(offset) || offset < previous || offset > flatLength) return false;
    previous = offset;
  }
  return previous === flatLength;
}

function isBm25TermFrequencies(value: unknown): value is RustBm25TermFrequencies {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustBm25TermFrequencies>;
  const totalTokens = candidate.totalTokens;
  if (typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) {
    return false;
  }
  if (!candidate.frequencies || typeof candidate.frequencies !== 'object') return false;
  return Object.entries(candidate.frequencies).every(
    ([token, count]) => token.length > 0 && Number.isSafeInteger(count) && count > 0,
  );
}

function sourceToCode(source: string): number {
  if (source === 'bm25') return 1;
  if (source === 'vector' || source === 'ann') return 2;
  if (source === 'graph-local' || source === 'graph-global' || source === 'evidence') return 3;
  if (source === 'structural') return 4;
  return 0;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isChunkArray(value: unknown): value is Chunk[] {
  return Array.isArray(value) && value.every(isChunk);
}

function isChunk(value: unknown): value is Chunk {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Chunk>;
  return (
    typeof candidate.text === 'string' &&
    !!candidate.metadata &&
    typeof candidate.metadata === 'object' &&
    typeof candidate.metadata.filePath === 'string' &&
    Number.isSafeInteger(candidate.metadata.startLine) &&
    Number.isSafeInteger(candidate.metadata.endLine) &&
    (candidate.metadata.heading === undefined || typeof candidate.metadata.heading === 'string')
  );
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return Uint8Array.from(Buffer.from(base64, 'base64'));
}
