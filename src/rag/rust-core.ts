import {
  core_version,
  cosine_similarity_or_nan,
  create_content_hash,
  initSync,
  rank_top_k_pairs,
  tokenize_json,
} from '../../generated/rag-wasm/rag_wasm.js';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

export interface RustVectorScore {
  index: number;
  score: number;
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
