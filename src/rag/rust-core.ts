import {
  bm25_score_pairs,
  chunk_markdown_json,
  chunk_plain_text_json,
  core_version,
  cosine_similarity_or_nan,
  create_content_hash,
  detect_communities_flat,
  hybrid_score_or_nan,
  initSync,
  rank_top_k_pairs,
  rrf_score_or_nan,
  select_diverse_indices,
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
    if (!Array.isArray(parsed) || !parsed.every((token): token is string => typeof token === 'string')) {
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

function decodeRankPairs(pairs: Float64Array, compatibleRows: readonly number[]): RustVectorScore[] {
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

function decodeIndexArray(values: Float64Array, maxExclusive: number): number[] | null {
  const indexes: number[] = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= maxExclusive) return null;
    indexes.push(value);
  }
  return indexes;
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

function isBm25TermFrequencies(value: unknown): value is RustBm25TermFrequencies {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustBm25TermFrequencies>;
  const totalTokens = candidate.totalTokens;
  if (typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) {
    return false;
  }
  if (!candidate.frequencies || typeof candidate.frequencies !== 'object') return false;
  return Object.entries(candidate.frequencies).every(
    ([token, count]) =>
      token.length > 0 &&
      Number.isSafeInteger(count) &&
      count > 0,
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
