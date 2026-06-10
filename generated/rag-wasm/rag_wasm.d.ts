/* tslint:disable */
/* eslint-disable */

/**
 * flattened posting list에서 `BM25` doc index와 score 쌍을 계산한다.
 */
export function bm25_score_pairs(term_offsets: Uint32Array, doc_indices: Uint32Array, term_frequencies: Float64Array, doc_lengths: Float64Array, total_docs: number, avg_doc_length: number): Float64Array;

/**
 * Markdown을 heading/code block/paragraph 경계 기준으로 chunk JSON으로 만든다.
 */
export function chunk_markdown_json(content: string, max_chunk_size: number, overlap_chars: number): string;

/**
 * 일반 텍스트와 코드 파일을 줄/빈 줄 경계 기준으로 chunk JSON으로 만든다.
 */
export function chunk_plain_text_json(content: string, max_chunk_size: number, overlap_chars: number): string;

/**
 * `TypeScript` 호스트에 노출할 `Rust` 코어 버전을 반환한다.
 */
export function core_version(): string;

/**
 * `WASM` 호출용 cosine similarity. invalid vector는 `NaN`으로 반환한다.
 */
export function cosine_similarity_or_nan(left: Float64Array, right: Float64Array): number;

/**
 * 현재 `TypeScript` 경로와 같은 32비트 `FNV-1a` 콘텐츠 해시를 만든다.
 */
export function create_content_hash(content: string): string;

/**
 * `GraphRAG` community detection의 node assignment와 modularity를 계산한다.
 */
export function detect_communities_flat(source_indices: Uint32Array, target_indices: Uint32Array, weights: Float64Array, node_count: number, max_iterations: number): Float64Array;

/**
 * RAG hybrid score를 계산한다.
 */
export function hybrid_score_or_nan(combined_base: number, rrf_score: number, source_prior: number, source_evidence_score: number, best_evidence_rank: number, source_codes: Uint8Array): number;

/**
 * flattened vector matrix에서 top-k row index와 score 쌍을 반환한다.
 */
export function rank_top_k_pairs(query: Float64Array, vectors: Float64Array, dimensions: number, top_k: number): Float64Array;

/**
 * retrieval source rank map에서 RRF score를 계산한다.
 */
export function rrf_score_or_nan(source_codes: Uint8Array, ranks: Float64Array, bm25_weight: number): number;

/**
 * `GraphRAG` local/evidence-first evidence score pair를 계산한다.
 */
export function score_local_evidence_pairs(config: Uint32Array, indices: Uint32Array, values: Float64Array): Float64Array;

/**
 * Query result 후보에서 기존 `TypeScript` MMR diversity selection과 같은 index를 고른다.
 */
export function select_diverse_indices(scores: Float64Array, vectors: Float64Array, dimensions: number, source_keys: Uint32Array, heading_keys: Uint32Array, top_k: number): Float64Array;

/**
 * 텍스트의 `BM25` term frequency map을 `JSON` 문자열로 반환한다.
 */
export function token_frequencies_json(text: string): string;

/**
 * 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
 */
export function tokenize_json(text: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bm25_score_pairs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly chunk_markdown_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly chunk_plain_text_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly core_version: () => [number, number];
    readonly cosine_similarity_or_nan: (a: number, b: number, c: number, d: number) => number;
    readonly create_content_hash: (a: number, b: number) => [number, number];
    readonly detect_communities_flat: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly hybrid_score_or_nan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly rank_top_k_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly rrf_score_or_nan: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly score_local_evidence_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly select_diverse_indices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly token_frequencies_json: (a: number, b: number) => [number, number];
    readonly tokenize_json: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
