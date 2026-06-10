import {
  bm25_score_pairs,
  chunk_markdown_json,
  chunk_plain_text_json,
  core_version,
  cosine_similarity_or_nan,
  create_content_hash,
  initSync,
  rank_top_k_pairs,
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
