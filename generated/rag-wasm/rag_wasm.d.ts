/* tslint:disable */
/* eslint-disable */

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
 * flattened vector matrix에서 top-k row index와 score 쌍을 반환한다.
 */
export function rank_top_k_pairs(query: Float64Array, vectors: Float64Array, dimensions: number, top_k: number): Float64Array;

/**
 * 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
 */
export function tokenize_json(text: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly chunk_markdown_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly chunk_plain_text_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly core_version: () => [number, number];
    readonly cosine_similarity_or_nan: (a: number, b: number, c: number, d: number) => number;
    readonly create_content_hash: (a: number, b: number) => [number, number];
    readonly rank_top_k_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly tokenize_json: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
