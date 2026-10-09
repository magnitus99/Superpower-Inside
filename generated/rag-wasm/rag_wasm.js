/* @ts-self-types="./rag_wasm.d.ts" */

/**
 * JS wrapper가 재사용할 수 있는 BM25 runtime index.
 */
export class Bm25RuntimeIndex {
    static __wrap(ptr) {
        const obj = Object.create(Bm25RuntimeIndex.prototype);
        obj.__wbg_ptr = ptr;
        Bm25RuntimeIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Bm25RuntimeIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bm25runtimeindex_free(ptr, 0);
    }
    /**
     * document 하나를 runtime index에 추가하거나 교체한다.
     * @param {string} doc_id
     * @param {string} text
     * @param {string} source_path
     * @param {number} tokenizer_version
     */
    add_document(doc_id, text, source_path, tokenizer_version) {
        const ptr0 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        wasm.bm25runtimeindex_add_document(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, tokenizer_version);
    }
    /**
     * bounded JSON 문서 batch를 한 번의 bridge 호출로 검증하고 추가한다.
     * @param {string} documents_json
     * @param {number} tokenizer_version
     * @param {boolean} known_unique
     * @returns {number}
     */
    add_documents_json(documents_json, tokenizer_version, known_unique) {
        const ptr0 = passStringToWasm0(documents_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bm25runtimeindex_add_documents_json(this.__wbg_ptr, ptr0, len0, tokenizer_version, known_unique);
        return ret >>> 0;
    }
    /**
     * 중복이 없다고 보장된 document 하나를 runtime index에 추가한다.
     * @param {string} doc_id
     * @param {string} text
     * @param {string} source_path
     * @param {number} tokenizer_version
     */
    add_new_document(doc_id, text, source_path, tokenizer_version) {
        const ptr0 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        wasm.bm25runtimeindex_add_new_document(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, tokenizer_version);
    }
    /**
     * legacy 또는 compact JSON payload에서 runtime index를 만든다.
     * @param {string} payload
     * @param {number} fallback_tokenizer_version
     * @returns {Bm25RuntimeIndex}
     */
    static from_json(payload, fallback_tokenizer_version) {
        const ptr0 = passStringToWasm0(payload, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bm25runtimeindex_from_json(ptr0, len0, fallback_tokenizer_version);
        return Bm25RuntimeIndex.__wrap(ret);
    }
    /**
     * document가 하나 이상 있는지 반환한다.
     * @returns {boolean}
     */
    is_ready() {
        const ret = wasm.bm25runtimeindex_is_ready(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * tokenizer contract version이 최신인지 반환한다.
     * @param {number} tokenizer_version
     * @returns {boolean}
     */
    is_tokenizer_current(tokenizer_version) {
        const ret = wasm.bm25runtimeindex_is_tokenizer_current(this.__wbg_ptr, tokenizer_version);
        return ret !== 0;
    }
    /**
     * 빈 BM25 runtime index를 만든다.
     * @param {number} tokenizer_version
     */
    constructor(tokenizer_version) {
        const ret = wasm.bm25runtimeindex_new(tokenizer_version);
        this.__wbg_ptr = ret;
        Bm25RuntimeIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * document 하나를 runtime index에서 제거한다.
     * @param {string} doc_id
     * @param {number} tokenizer_version
     */
    remove_document(doc_id, tokenizer_version) {
        const ptr0 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.bm25runtimeindex_remove_document(this.__wbg_ptr, ptr0, len0, tokenizer_version);
    }
    /**
     * source path에 속한 document들을 runtime index에서 제거한다.
     * @param {string} source_path
     * @param {number} tokenizer_version
     */
    remove_source(source_path, tokenizer_version) {
        const ptr0 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.bm25runtimeindex_remove_source(this.__wbg_ptr, ptr0, len0, tokenizer_version);
    }
    /**
     * query score 목록을 JSON 문자열로 반환한다.
     * @param {string} query
     * @returns {string}
     */
    search_json(query) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.bm25runtimeindex_search_json(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * 상위 query score 목록만 JSON 문자열로 반환한다.
     * @param {string} query
     * @param {number} limit
     * @returns {string}
     */
    search_top_json(query, limit) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.bm25runtimeindex_search_top_json(this.__wbg_ptr, ptr0, len0, limit);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * doc id에 대응되는 source path를 반환한다. 없으면 빈 문자열이다.
     * @param {string} doc_id
     * @returns {string}
     */
    source_path_for_doc(doc_id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.bm25runtimeindex_source_path_for_doc(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * compact v3 JSON payload로 직렬화한다.
     * @returns {string}
     */
    to_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.bm25runtimeindex_to_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * tokenizer contract version을 반환한다.
     * @returns {number}
     */
    tokenizer_version() {
        const ret = wasm.bm25runtimeindex_tokenizer_version(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * indexed document 수를 반환한다.
     * @returns {number}
     */
    total_docs() {
        const ret = wasm.bm25runtimeindex_total_docs(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Bm25RuntimeIndex.prototype[Symbol.dispose] = Bm25RuntimeIndex.prototype.free;

/**
 * JS wrapper가 재사용할 수 있는 IVF ANN runtime index.
 */
export class IvfRuntimeIndex {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IvfRuntimeIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ivfruntimeindex_free(ptr, 0);
    }
    /**
     * cluster count를 반환한다.
     * @returns {number}
     */
    cluster_count() {
        const ret = wasm.ivfruntimeindex_cluster_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * vector dimension을 반환한다.
     * @returns {number}
     */
    dimensions() {
        const ret = wasm.ivfruntimeindex_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * flattened row-major vector matrix로 IVF runtime index를 만든다.
     * @param {Float32Array} vectors
     * @param {number} dimensions
     * @param {number} requested_cluster_count
     * @param {number} iterations
     */
    constructor(vectors, dimensions, requested_cluster_count, iterations) {
        const ptr0 = passArrayF32ToWasm0(vectors, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ivfruntimeindex_new(ptr0, len0, dimensions, requested_cluster_count, iterations);
        this.__wbg_ptr = ret;
        IvfRuntimeIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * centroid probe와 candidate scoring을 Rust 내부에서 수행해 top-k row index/score pair를 반환한다.
     * @param {Float32Array} query
     * @param {number} top_k
     * @param {number} probe_count
     * @returns {Float64Array}
     */
    query(query, top_k, probe_count) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ivfruntimeindex_query(this.__wbg_ptr, ptr0, len0, top_k, probe_count);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * original row count를 반환한다.
     * @returns {number}
     */
    row_count() {
        const ret = wasm.ivfruntimeindex_row_count(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) IvfRuntimeIndex.prototype[Symbol.dispose] = IvfRuntimeIndex.prototype.free;

/**
 * JS wrapper가 재사용할 수 있는 normalized vector runtime index.
 */
export class VectorRuntimeIndex {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VectorRuntimeIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vectorruntimeindex_free(ptr, 0);
    }
    /**
     * vector dimension을 반환한다.
     * @returns {number}
     */
    dimensions() {
        const ret = wasm.vectorruntimeindex_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * flattened row-major vector matrix로 runtime index를 만든다.
     * @param {Float32Array} vectors
     * @param {number} dimensions
     */
    constructor(vectors, dimensions) {
        const ptr0 = passArrayF32ToWasm0(vectors, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorruntimeindex_new(ptr0, len0, dimensions);
        this.__wbg_ptr = ret;
        VectorRuntimeIndexFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 모든 valid row에서 top-k row index/score pair를 반환한다.
     * @param {Float32Array} query
     * @param {number} top_k
     * @returns {Float64Array}
     */
    rank_top_k(query, top_k) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorruntimeindex_rank_top_k(this.__wbg_ptr, ptr0, len0, top_k);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * 지정된 row index 후보 안에서 top-k row index/score pair를 반환한다.
     * @param {Float32Array} query
     * @param {Uint32Array} row_indices
     * @param {number} top_k
     * @returns {Float64Array}
     */
    rank_top_k_filtered(query, row_indices, top_k) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(row_indices, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vectorruntimeindex_rank_top_k_filtered(this.__wbg_ptr, ptr0, len0, ptr1, len1, top_k);
        var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v3;
    }
    /**
     * original row count를 반환한다.
     * @returns {number}
     */
    row_count() {
        const ret = wasm.vectorruntimeindex_row_count(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) VectorRuntimeIndex.prototype[Symbol.dispose] = VectorRuntimeIndex.prototype.free;

/**
 * retrieval source score/rank를 source-aware RAG relevance 계산 입력으로 요약한다.
 * @param {Uint8Array} source_codes
 * @param {Float64Array} source_scores
 * @param {Float64Array} source_ranks
 * @returns {Float64Array}
 */
export function analyze_retrieval_sources(source_codes, source_scores, source_ranks) {
    const ptr0 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(source_scores, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(source_ranks, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.analyze_retrieval_sources(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * flattened vector matrix의 각 row를 가장 가까운 centroid index로 배정한다.
 * @param {Float64Array} vectors
 * @param {Float64Array} centroids
 * @param {number} dimensions
 * @returns {Float64Array}
 */
export function assign_vector_clusters(vectors, centroids, dimensions) {
    const ptr0 = passArrayF64ToWasm0(vectors, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(centroids, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.assign_vector_clusters(ptr0, len0, ptr1, len1, dimensions);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * flattened posting list에서 `BM25` doc index와 score 쌍을 계산한다.
 * @param {Uint32Array} term_offsets
 * @param {Uint32Array} doc_indices
 * @param {Float64Array} term_frequencies
 * @param {Float64Array} doc_lengths
 * @param {number} total_docs
 * @param {number} avg_doc_length
 * @returns {Float64Array}
 */
export function bm25_score_pairs(term_offsets, doc_indices, term_frequencies, doc_lengths, total_docs, avg_doc_length) {
    const ptr0 = passArray32ToWasm0(term_offsets, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(doc_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(term_frequencies, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(doc_lengths, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.bm25_score_pairs(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, total_docs, avg_doc_length);
    var v5 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v5;
}

/**
 * flattened vector matrix에서 `IVF ANN` 초기 centroid matrix를 계산한다.
 * @param {Float64Array} vectors
 * @param {number} dimensions
 * @param {number} requested_cluster_count
 * @returns {Float64Array}
 */
export function build_initial_centroids(vectors, dimensions, requested_cluster_count) {
    const ptr0 = passArrayF64ToWasm0(vectors, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.build_initial_centroids(ptr0, len0, dimensions, requested_cluster_count);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * Markdown을 heading/code block/paragraph 경계 기준으로 chunk JSON으로 만든다.
 * @param {string} content
 * @param {number} max_chunk_size
 * @param {number} overlap_chars
 * @returns {string}
 */
export function chunk_markdown_json(content, max_chunk_size, overlap_chars) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chunk_markdown_json(ptr0, len0, max_chunk_size, overlap_chars);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 일반 텍스트와 코드 파일을 줄/빈 줄 경계 기준으로 chunk JSON으로 만든다.
 * @param {string} content
 * @param {number} max_chunk_size
 * @param {number} overlap_chars
 * @returns {string}
 */
export function chunk_plain_text_json(content, max_chunk_size, overlap_chars) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.chunk_plain_text_json(ptr0, len0, max_chunk_size, overlap_chars);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * MCP 에러 메시지를 분류해 TS i18n 렌더링에 필요한 키 계약을 만든다.
 * @param {string} raw_msg
 * @returns {string}
 */
export function classify_mcp_tool_error_json(raw_msg) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw_msg, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.classify_mcp_tool_error_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 후보 reason 목록을 인덱스 순서로 중복 제거해 반환한다.
 * @param {string} candidate_reasons_json
 * @param {string} candidate_indexes_json
 * @returns {string}
 */
export function collect_candidate_reasons(candidate_reasons_json, candidate_indexes_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(candidate_reasons_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidate_indexes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.collect_candidate_reasons(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `TypeScript` 호스트에 노출할 `Rust` 코어 버전을 반환한다.
 * @returns {string}
 */
export function core_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.core_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * `WASM` 호출용 cosine similarity. invalid vector는 `NaN`으로 반환한다.
 * @param {Float64Array} left
 * @param {Float64Array} right
 * @returns {number}
 */
export function cosine_similarity_or_nan(left, right) {
    const ptr0 = passArrayF64ToWasm0(left, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(right, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cosine_similarity_or_nan(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * 파일 확장자 목록 기준 카운트를 계산한다.
 * @param {string} file_extensions_json
 * @param {string} extension_keys_json
 * @returns {string}
 */
export function count_files_by_extensions_json(file_extensions_json, extension_keys_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_extensions_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(extension_keys_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.count_files_by_extensions_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * query token 목록과 텍스트에서 substring 매칭 수를 계산한다.
 * @param {string} query_tokens
 * @param {string} text
 * @returns {number}
 */
export function count_keyword_matches(query_tokens, text) {
    const ptr0 = passStringToWasm0(query_tokens, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.count_keyword_matches(ptr0, len0, ptr1, len1);
    return ret >>> 0;
}

/**
 * 현재 `TypeScript` 경로와 같은 32비트 `FNV-1a` 콘텐츠 해시를 만든다.
 * @param {string} content
 * @returns {string}
 */
export function create_content_hash(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.create_content_hash(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * context source preview를 만든다.
 * @param {string} text
 * @returns {string}
 */
export function create_context_preview(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.create_context_preview(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 벡터 entry snapshot 배열 fingerprint를 생성한다.
 * @param {string} entry_ids_json
 * @param {string} content_hashes_json
 * @param {string} indexed_ats_json
 * @param {string} vector_lengths_json
 * @returns {string}
 */
export function create_entries_fingerprint(entry_ids_json, content_hashes_json, indexed_ats_json, vector_lengths_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(content_hashes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(indexed_ats_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(vector_lengths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.create_entries_fingerprint(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Creates a collision-resistant deterministic key for one namespaced `IndexedDB` record.
 * @param {string} namespace
 * @param {string} value
 * @returns {string}
 */
export function create_indexed_db_record_key(namespace, value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.create_indexed_db_record_key(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Derives a conservative coverage receipt from successful native-vault tool result payloads.
 *
 * Only an untruncated search that scanned without unreadable files can support a scoped exact
 * negative claim. Native tool results never prove that every inventory document was read.
 * @param {string} results_json
 * @returns {string}
 */
export function derive_native_tool_coverage_receipt_json(results_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(results_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.derive_native_tool_coverage_receipt_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Derives auditable whole-vault and selected-evidence coverage booleans.
 *
 * Invalid JSON returns an empty string. Semantic inconsistencies produce a receipt with reason
 * codes and conservative `false` decisions.
 * @param {string} input_json
 * @returns {string}
 */
export function derive_research_coverage_receipt_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.derive_research_coverage_receipt_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 검색 질의와 문서에 공식 `EmbeddingGemma` 접두사를 적용한다.
 * @param {string} texts_json
 * @param {string} kind
 * @returns {string | undefined}
 */
export function embedding_gemma_inputs_json(texts_json, kind) {
    const ptr0 = passStringToWasm0(texts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.embedding_gemma_inputs_json(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * `delta` 객체의 구조화 reasoning 필드를 추출한다.
 * @param {string} delta_json
 * @returns {string}
 */
export function extract_structured_reasoning(delta_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(delta_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_structured_reasoning(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * vault 내부 참조 링크를 추출하고 `JSON` 문자열로 반환한다.
 * @param {string} content
 * @returns {string}
 */
export function extract_vault_links_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_vault_links_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 같은 본문의 기존 프롬프트 위치를 반환해 항목 중복을 방지합니다.
 * @param {string} entries_json
 * @param {string} content
 * @returns {number}
 */
export function find_reusable_prompt(entries_json, content) {
    const ptr0 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.find_reusable_prompt(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * MCP 시작 오류와 stderr를 합치고 환경 변수 값을 숨긴 뒤 표시 길이를 제한한다.
 * @param {string} message
 * @param {string} stderr
 * @param {string} secrets_json
 * @returns {string}
 */
export function format_mcp_connection_error(message, stderr, secrets_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(stderr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(secrets_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.format_mcp_connection_error(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * MCP JSON 설정을 검증 가능한 JSON 문자열로 다시 포맷한다.
 * @param {string} mcp_json_text
 * @returns {string}
 */
export function format_mcp_json(mcp_json_text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(mcp_json_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.format_mcp_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * MCP 연결 상태를 계산한다.
 * @param {number} total_count
 * @param {number} connected_count
 * @param {number} failed_count
 * @param {boolean} is_connecting
 * @returns {string}
 */
export function get_mcp_connection_state_rust(total_count, connected_count, failed_count, is_connecting) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.get_mcp_connection_state_rust(total_count, connected_count, failed_count, is_connecting);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * 파일 경로 확장자가 제외 대상 목록에 있으면 `true`를 반환한다.
 * @param {string} file_path
 * @param {string} extension_keys_json
 * @returns {boolean}
 */
export function is_excluded_ext_json(file_path, extension_keys_json) {
    const ptr0 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(extension_keys_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_excluded_ext_json(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * vault path가 제외 pattern 목록에 매칭되는지 확인한다.
 * @param {string} file_path
 * @param {string} patterns
 * @returns {boolean}
 */
export function is_excluded_path(file_path, patterns) {
    const ptr0 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(patterns, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_excluded_path(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * 연결의 실제 주소가 로컬 처리 대상인지 판정합니다.
 * @param {string} strategy
 * @param {string} base_url
 * @returns {boolean}
 */
export function is_local_settings_provider(strategy, base_url) {
    const ptr0 = passStringToWasm0(strategy, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_local_settings_provider(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * MCP tool 목록에 요청 tool name이 있는지 Rust에서 판정한다.
 * @param {string} tool_name
 * @param {string} tool_names_json
 * @returns {boolean}
 */
export function is_mcp_tool_name_available(tool_name, tool_names_json) {
    const ptr0 = passStringToWasm0(tool_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(tool_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_mcp_tool_name_available(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * MCP tool 결과가 빈 응답으로 간주되는지 계산한다.
 * @param {string} result_json
 * @param {string} display_text
 * @param {string} model_text
 * @returns {boolean}
 */
export function is_mcp_tool_result_empty_json(result_json, display_text, model_text) {
    const ptr0 = passStringToWasm0(result_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(display_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(model_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.is_mcp_tool_result_empty_json(ptr0, len0, ptr1, len1, ptr2, len2);
    return ret !== 0;
}

/**
 * Markdown 문서 확장자 제외를 막는지 확인한다.
 * @param {string} extension
 * @returns {boolean}
 */
export function is_protected_rag_document_extension_json(extension) {
    const ptr0 = passStringToWasm0(extension, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_protected_rag_document_extension_json(ptr0, len0);
    return ret !== 0;
}

/**
 * 최상위 YAML 속성이 있으면 false 외에는 제외한다.
 * @param {string} frontmatter_json
 * @returns {boolean}
 */
export function is_rag_frontmatter_excluded_json(frontmatter_json) {
    const ptr0 = passStringToWasm0(frontmatter_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_rag_frontmatter_excluded_json(ptr0, len0);
    return ret !== 0;
}

/**
 * RAG 제외 가능한 확장자인지 확인한다.
 * @param {string} extension
 * @returns {boolean}
 */
export function is_recommendable_exclude_extension_json(extension) {
    const ptr0 = passStringToWasm0(extension, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_recommendable_exclude_extension_json(ptr0, len0);
    return ret !== 0;
}

/**
 * RAG 후보가 최종 context 후보로 유지될 만큼 관련 있는지 판단한다.
 * @param {Float64Array} config
 * @param {Uint8Array} source_codes
 * @returns {boolean}
 */
export function is_relevant_result(config, source_codes) {
    const ptr0 = passArrayF64ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_relevant_result(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * 명시 폴더의 개념 비교와 종합은 인용문 한 곳을 찾는 요청과 구분한다.
 * @param {string} question
 * @returns {boolean}
 */
export function is_scoped_vault_research_intent(question) {
    const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_scoped_vault_research_intent(ptr0, len0);
    return ret !== 0;
}

/**
 * 새 대화 저장 폴더가 볼트 안의 상대 경로인지 확인합니다.
 * @param {string} input
 * @returns {boolean}
 */
export function is_valid_settings_folder(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_valid_settings_folder(ptr0, len0);
    return ret !== 0;
}

/**
 * Detects explicit requests that require whole-vault coverage instead of top-k retrieval.
 * @param {string} question
 * @returns {boolean}
 */
export function is_whole_vault_research_intent(question) {
    const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_whole_vault_research_intent(ptr0, len0);
    return ret !== 0;
}

/**
 * 다운로드 응답의 HTTP 상태, 구간과 길이가 요청과 일치하는지 검사한다.
 * @param {number} start
 * @param {number} end
 * @param {number} total
 * @param {number} status
 * @param {number} length
 * @param {string} content_range
 * @returns {boolean}
 */
export function local_model_range_matches(start, end, total, status, length, content_range) {
    const ptr0 = passStringToWasm0(content_range, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.local_model_range_matches(start, end, total, status, length, ptr0, len0);
    return ret !== 0;
}

/**
 * 확장자 문자열을 RAG 제외 설정 계약에 맞게 정규화한다.
 * @param {string} extension
 * @returns {string}
 */
export function normalize_exclude_extension_json(extension) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(extension, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_exclude_extension_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * MCP tool 실행 결과에서 표시/모델 텍스트 추출 계약을 계산한다.
 * @param {string} result_json
 * @returns {string}
 */
export function normalize_mcp_tool_result_json(result_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(result_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_mcp_tool_result_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 구조화 reasoning과 태그 reasoning을 병합해 content/reasoning을 만들고 JSON으로 반환한다.
 * @param {string} content
 * @param {string} reasoning
 * @returns {string}
 */
export function normalize_reasoning_chunk_json(content, reasoning) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(reasoning, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_reasoning_chunk_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * MCP tool 실행 인자 문자열을 TypeScript 호스트 경계 계약으로 정규화한다.
 * @param {string} arguments_text
 * @returns {string}
 */
export function parse_mcp_tool_arguments_json(arguments_text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(arguments_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_mcp_tool_arguments_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 채팅 입력의 raw mention 후보를 추출하고 `JSON` 문자열로 반환한다.
 * @param {string} content
 * @returns {string}
 */
export function parse_mention_candidates_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_mention_candidates_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 설정의 편집 중 문자열을 검증하고 잘못된 값이면 `NaN`을 반환합니다.
 * @param {string} input
 * @param {number} min
 * @param {number} max
 * @param {boolean} integer
 * @returns {number}
 */
export function parse_settings_number(input, min, max, integer) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parse_settings_number(ptr0, len0, min, max, integer);
    return ret;
}

/**
 * Plans the next provider turn without relying on provider- or model-specific behavior.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_agentic_tool_turn_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_agentic_tool_turn_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * assistant 응답을 일반 답변 또는 사용자 질문 plan으로 분류한다.
 * @param {string} content
 * @param {string} reasoning
 * @returns {string}
 */
export function plan_assistant_response_classification_json(content, reasoning) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(reasoning, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_assistant_response_classification_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * BM25 hit, id lookup entry, file-path lookup entry를 최종 candidate plan으로 해석한다.
 * @param {string} hits_json
 * @param {string} found_entries_json
 * @param {string} path_entries_json
 * @param {number} candidate_limit
 * @param {number} max_score
 * @returns {string}
 */
export function plan_bm25_candidate_resolution_json(hits_json, found_entries_json, path_entries_json, candidate_limit, max_score) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(hits_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(found_entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(path_entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_candidate_resolution_json(ptr0, len0, ptr1, len1, ptr2, len2, candidate_limit, max_score);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * BM25 score hit 목록을 score 순서로 제한하고 lookup plan을 JSON으로 반환한다.
 * @param {string} hits_json
 * @param {number} candidate_limit
 * @param {number} lookup_multiplier
 * @returns {string}
 */
export function plan_bm25_hit_lookup_json(hits_json, candidate_limit, lookup_multiplier) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(hits_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_hit_lookup_json(ptr0, len0, candidate_limit, lookup_multiplier);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * BM25 index에 문서 하나를 추가/교체한 새 index JSON plan을 만든다.
 * @param {string} index_json
 * @param {string} doc_id
 * @param {string} text
 * @param {string} source_path
 * @param {number} tokenizer_version
 * @returns {string}
 */
export function plan_bm25_index_add_document_json(index_json, doc_id, text, source_path, tokenizer_version) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(index_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_index_add_document_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, tokenizer_version);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * BM25 index에서 문서 하나를 제거한 새 index JSON plan을 만든다.
 * @param {string} index_json
 * @param {string} doc_id
 * @param {number} tokenizer_version
 * @returns {string}
 */
export function plan_bm25_index_remove_document_json(index_json, doc_id, tokenizer_version) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(index_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(doc_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_index_remove_document_json(ptr0, len0, ptr1, len1, tokenizer_version);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * BM25 index에서 source path에 속한 문서를 제거한 새 index JSON plan을 만든다.
 * @param {string} index_json
 * @param {string} source_path
 * @param {number} tokenizer_version
 * @returns {string}
 */
export function plan_bm25_index_remove_source_json(index_json, source_path, tokenizer_version) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(index_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_index_remove_source_json(ptr0, len0, ptr1, len1, tokenizer_version);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * BM25 index와 raw query에서 doc score JSON plan을 만든다.
 * @param {string} index_json
 * @param {string} query
 * @returns {string}
 */
export function plan_bm25_search_json(index_json, query) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(index_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_search_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * BM25 hit 중 id lookup에서 발견되지 않은 source file path 목록을 JSON으로 반환한다.
 * @param {string} hits_json
 * @param {string} found_entry_ids_json
 * @returns {string}
 */
export function plan_bm25_source_lookups_json(hits_json, found_entry_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(hits_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(found_entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_bm25_source_lookups_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Chat context mention type별 index와 auto-RAG policy를 계산한다.
 * @param {string} mention_types_json
 * @returns {string}
 */
export function plan_chat_context_mentions_json(mention_types_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(mention_types_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_context_mentions_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 현재 원문에서 질문에 맞는 완전한 Markdown 구간만 전달 근거로 선택합니다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_chat_evidence_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_evidence_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 저장된 chat session markdown body에서 current-format message plan을 만든다.
 * @param {string} body
 * @param {number} now_timestamp
 * @param {string} now_iso
 * @param {string} decode_failure_label
 * @returns {string}
 */
export function plan_chat_messages_json(body, now_timestamp, now_iso, decode_failure_label) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(now_iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(decode_failure_label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_messages_json(ptr0, len0, now_timestamp, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 저장된 chat session markdown에서 list metadata plan을 만든다.
 * @param {string} content
 * @param {string} fallback_title
 * @param {string} fallback_created_iso
 * @returns {string}
 */
export function plan_chat_meta_json(content, fallback_title, fallback_created_iso) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(fallback_title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(fallback_created_iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_meta_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 모든 연결에서 사용 가능한 채팅 모델을 정렬하고 저장된 기본 모델을 검증한다.
 *
 * 저장된 기본 모델이 사라졌거나 사용할 수 없으면 다른 프로바이더로 조용히
 * 전환하지 않는다. 호스트가 사용자의 명시적 선택을 받도록 빈 선택을 반환한다.
 * 잘못된 입력은 빈 문자열을 반환한다.
 * @param {string} providers_json
 * @param {string} configured_default
 * @returns {string}
 */
export function plan_chat_model_state_json(providers_json, configured_default) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(providers_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(configured_default, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_model_state_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 시스템 지침·최신 요청을 보존하며 오래된 완전한 턴만 예산에 따라 제외합니다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_chat_request_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_request_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 저장할 chat session metadata plan을 만든다.
 * @param {string} messages_json
 * @param {string} existing_created
 * @param {string} option_title
 * @param {string} now_iso
 * @returns {string}
 */
export function plan_chat_save_metadata_json(messages_json, existing_created, option_title, now_iso) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(existing_created, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(option_title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(now_iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_save_metadata_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * 검증된 첨부 구간이 완전히 포함하는 검색 후보만 제외한다.
 * @param {string} sources_json
 * @param {string} citations_json
 * @returns {string}
 */
export function plan_chat_unique_result_indices_json(sources_json, citations_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sources_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(citations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chat_unique_result_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 호스트 I/O에 필요한 결정적 결과를 생성한다. 잘못된 입력은 빈 결과로 닫는다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_chatgpt_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_chatgpt_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Extracts bounded JSON tool calls from the compatibility protocol.
 * @param {string} content
 * @returns {string}
 */
export function plan_compatibility_tool_calls_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_compatibility_tool_calls_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Context budget append 결과를 Rust에서 계산한다.
 * @param {number} remaining_chars
 * @param {string} text
 * @returns {string}
 */
export function plan_context_budget_append_json(remaining_chars, text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_context_budget_append_json(remaining_chars, ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * RAG context source citation/block/source id plan을 만든다.
 * @param {string} results_json
 * @param {string} verifications_json
 * @param {number} first_index
 * @param {string} prefix
 * @returns {string}
 */
export function plan_context_sources_json(results_json, verifications_json, first_index, prefix) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(results_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(verifications_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(prefix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_context_sources_json(ptr0, len0, ptr1, len1, first_index, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Query result 후보의 source path/heading 문자열을 포함해 MMR diversity index plan을 만든다.
 * @param {string} candidates_json
 * @param {number} top_k
 * @returns {string}
 */
export function plan_diverse_result_indices_json(candidates_json, top_k) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(candidates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_diverse_result_indices_json(ptr0, len0, top_k);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 청크가 없는 파일도 완료 상태로 유지할 file index record JSON plan을 만든다.
 * @param {string} entry_json
 * @param {number} updated
 * @returns {string}
 */
export function plan_empty_file_index_record_json(entry_json, updated) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(entry_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_empty_file_index_record_json(ptr0, len0, updated);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * evidence score 목록을 max-score, first-seen tie 순서로 candidate order plan으로 만든다.
 * @param {string} scores_json
 * @param {string} available_evidence_ids_json
 * @returns {string}
 */
export function plan_evidence_candidate_order_json(scores_json, available_evidence_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(scores_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(available_evidence_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_evidence_candidate_order_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector entry metadata snapshot에서 file index record JSON plan을 만든다.
 * @param {string} entries_json
 * @param {number} updated
 * @returns {string}
 */
export function plan_file_index_records_json(entries_json, updated) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_file_index_records_json(ptr0, len0, updated);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 확장 query keyword가 많이 나타나는 folder file sample index를 관련도 순으로 고른다.
 * @param {string} query
 * @param {string} samples_json
 * @param {number} top_k
 * @param {string} match_mode
 * @returns {string}
 */
export function plan_folder_lexical_evidence_indices_json(query, samples_json, top_k, match_mode) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(samples_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(match_mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_folder_lexical_evidence_indices_json(ptr0, len0, ptr1, len1, top_k, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * folder mention에 포함할 markdown file index와 partial 여부를 `JSON` 문자열로 반환한다.
 * @param {string} folder_path
 * @param {string} file_paths_json
 * @param {number} max_files
 * @returns {string}
 */
export function plan_folder_mention_file_indices_json(folder_path, file_paths_json, max_files) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(folder_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_folder_mention_file_indices_json(ptr0, len0, ptr1, len1, max_files);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 자연어 질문에서 직접 또는 한글 로마자 표기와 가까운 vault folder path를 고른다.
 * @param {string} question
 * @param {string} folder_paths_json
 * @returns {string}
 */
export function plan_implicit_folder_query_paths_json(question, folder_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_implicit_folder_query_paths_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Tracks plugin-owned databases across vaults and retires generations unseen past a grace age.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_inactive_indexed_db_cleanup_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_inactive_indexed_db_cleanup_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * indexPending이 처리할 file index와 skip count plan을 만든다.
 * @param {string} file_paths_json
 * @param {string} update_paths_json
 * @returns {string}
 */
export function plan_index_pending_files_json(file_paths_json, update_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(update_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_index_pending_files_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Selects a bounded page of inactive databases owned by the current vault.
 * @param {string} database_names_json
 * @param {string} active_names_json
 * @param {string} owned_vault_prefixes_json
 * @param {string} legacy_names_json
 * @param {number} max_deletions
 * @returns {string}
 */
export function plan_indexed_db_bounded_cleanup_json(database_names_json, active_names_json, owned_vault_prefixes_json, legacy_names_json, max_deletions) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(database_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(active_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(owned_vault_prefixes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(legacy_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_indexed_db_bounded_cleanup_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, max_deletions);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Plans one oldest-first bounded cache retention batch from a paged access snapshot.
 * @param {string} oldest_records_json
 * @param {number} total_record_count
 * @param {number} max_records
 * @param {number} now
 * @param {number} max_age_ms
 * @param {number} max_deletions
 * @returns {string}
 */
export function plan_indexed_db_bounded_retention_json(oldest_records_json, total_record_count, max_records, now, max_age_ms, max_deletions) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(oldest_records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_indexed_db_bounded_retention_json(ptr0, len0, total_record_count, max_records, now, max_age_ms, max_deletions);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Builds database names isolated by vault, storage contract, and embedding generation.
 *
 * `index_namespace`가 비어 있으면 기존 세대를 유지한다. 값이 있으면 청킹 계약이 바뀐 것이므로
 * 공통 원문·vector·BM25를 새 세대로 옮기고 임베딩 캐시는 재사용합니다.
 * @param {string} plugin_id
 * @param {string} vault_identity
 * @param {string} legacy_vault_name
 * @param {string} embedding_namespace
 * @param {string} index_namespace
 * @returns {string}
 */
export function plan_indexed_db_storage_layout_json(plugin_id, vault_identity, legacy_vault_name, embedding_namespace, index_namespace) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(plugin_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(vault_identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(legacy_vault_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(embedding_namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(index_namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.plan_indexed_db_storage_layout_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}

/**
 * MCP server 후보 순서를 Rust에서 계산한다.
 * @param {string} preferred_server_names_json
 * @param {string} enabled_server_names_json
 * @param {string} connection_statuses_json
 * @returns {string}
 */
export function plan_mcp_server_candidates_json(preferred_server_names_json, enabled_server_names_json, connection_statuses_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(preferred_server_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(enabled_server_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(connection_statuses_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_mcp_server_candidates_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * retrieval provider 후보를 entry별로 병합할 numeric plan을 계산한다.
 * @param {Uint32Array} entry_indices
 * @param {Uint8Array} source_codes
 * @param {Float64Array} source_scores
 * @param {Float64Array} source_ranks
 * @returns {Float64Array}
 */
export function plan_merged_retrieval_candidates(entry_indices, source_codes, source_scores, source_ranks) {
    const ptr0 = passArray32ToWasm0(entry_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(source_scores, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(source_ranks, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.plan_merged_retrieval_candidates(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var v5 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v5;
}

/**
 * retrieval provider 후보를 `entry id`별로 병합할 numeric plan을 계산한다.
 * @param {string} entry_ids_json
 * @param {Uint8Array} source_codes
 * @param {Float64Array} source_scores
 * @param {Float64Array} source_ranks
 * @returns {Float64Array}
 */
export function plan_merged_retrieval_candidates_by_entry_id(entry_ids_json, source_codes, source_scores, source_ranks) {
    const ptr0 = passStringToWasm0(entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(source_scores, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(source_ranks, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.plan_merged_retrieval_candidates_by_entry_id(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var v5 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v5;
}

/**
 * 토크나이저가 공개되지 않은 모델은 UTF-8 바이트를 보수적인 입력 토큰 상한으로 사용한다.
 * @param {string} metadata
 * @returns {string}
 */
export function plan_model_context_json(metadata) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(metadata, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_model_context_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Plans whether one failed native-tool request may retry with the text compatibility protocol.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_native_tool_compatibility_fallback_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_tool_compatibility_fallback_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Obsidian이 제공한 메타데이터에서 모든 조건이 일치하는 파일 index를 선택한다.
 * @param {string} files_json
 * @param {string} filters_json
 * @returns {string}
 */
export function plan_native_vault_filtered_indices_json(files_json, filters_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filters_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_filtered_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 이전 상위 후보와 최대 8개 본문을 결합한다. 본문은 다음 묶음으로 넘기지 않는다.
 * @param {string} request_json
 * @param {string} samples_json
 * @param {string} previous_json
 * @returns {string}
 */
export function plan_native_vault_lexical_batch_json(request_json, samples_json, previous_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(request_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(samples_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(previous_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_lexical_batch_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 파일 단위 lexical 일치 결과에서 가장 관련 있는 실제 행과 검증 상태를 반환한다.
 * @param {string} query
 * @param {string} content
 * @param {string} match_mode
 * @returns {string}
 */
export function plan_native_vault_lexical_hit_json(query, content, match_mode) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(match_mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_lexical_hit_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 구조 링크 그래프 한쪽의 경로를 정렬하고 중복 제거한 뒤 상한을 적용한다.
 * @param {string} paths_json
 * @param {number} limit
 * @returns {string}
 */
export function plan_native_vault_link_paths_json(paths_json, limit) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_link_paths_json(ptr0, len0, limit);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 정확한 파일 또는 폴더 prefix 범위의 허용 경로를 안정된 한 페이지로 선택한다.
 * @param {string} file_paths_json
 * @param {string} path_prefix
 * @param {number} cursor
 * @param {number} limit
 * @returns {string}
 */
export function plan_native_vault_list_json(file_paths_json, path_prefix, cursor, limit) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(path_prefix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_list_json(ptr0, len0, ptr1, len1, cursor, limit);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 1부터 시작하는 포함 범위 읽기를 문서 길이와 호출별 줄 예산에 맞게 제한한다.
 * @param {number} total_lines
 * @param {number} start_line
 * @param {number | null | undefined} end_line
 * @param {number} max_lines
 * @returns {string}
 */
export function plan_native_vault_read_range_json(total_lines, start_line, end_line, max_lines) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.plan_native_vault_read_range_json(total_lines, start_line, isLikeNone(end_line) ? Number.MAX_SAFE_INTEGER : (end_line) >>> 0, max_lines);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * 여러 검색 변형의 후보를 문서별 reciprocal rank fusion 결과로 결합한다.
 * @param {string} candidates_json
 * @param {number} query_count
 * @param {number} limit
 * @returns {string}
 */
export function plan_native_vault_search_rrf_json(candidates_json, query_count, limit) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(candidates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_search_rrf_json(ptr0, len0, query_count, limit);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 잘림 후 남아 있는 검색 구간·메타데이터만 출처로 남기고 중복 ID는 검증된 값을 우선한다.
 * @param {string} hits
 * @param {string} citations
 * @returns {string}
 */
export function plan_native_vault_source_citation_indices_json(hits, citations) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(hits, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(citations, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_source_citation_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 읽기 전용 볼트 통계 응답을 위해 Markdown 파일 크기를 집계한다.
 * @param {string} file_sizes_json
 * @returns {string}
 */
export function plan_native_vault_stats_json(file_sizes_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(file_sizes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_stats_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 내장 읽기 전용 볼트 도구에 대한 모델 생성 요청 하나를 검증한다.
 * @param {string} arguments_json
 * @returns {string}
 */
export function plan_native_vault_tool_request_json(arguments_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(arguments_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_native_vault_tool_request_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 현재 요청에 관련된 인덱스를 반환하며 네 번째 항목으로 조회 상한 초과를 알린다.
 * @param {string} prompt
 * @param {string} previous_json
 * @param {string} plugins_json
 * @returns {string}
 */
export function plan_plugin_aware_indices_json(prompt, previous_json, plugins_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(previous_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(plugins_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_plugin_aware_indices_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Plans bounded cleanup for files whose names prove that this plugin owns them.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_plugin_owned_file_maintenance_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_plugin_owned_file_maintenance_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Vault prompt 생성용 summary를 `JSON` 계획 형태로 계산한다.
 * @param {string} entries_json
 * @returns {string}
 */
export function plan_prompt_library_summary_json(entries_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_prompt_library_summary_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 모델 이름으로 한도를 추측하지 않는다. 없는 정보는 호스트에 생략해서 반환한다.
 * @param {string} provider
 * @param {string} payload
 * @returns {string}
 */
export function plan_provider_model_details_json(provider, payload) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(provider, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(payload, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_provider_model_details_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 프로바이더 한 개의 표시 상태와 기능별 사용 가능 여부를 계산한다.
 *
 * 잘못된 입력은 빈 문자열을 반환해 호스트가 실패 닫힘으로 처리하도록 한다.
 * @param {string} provider_json
 * @returns {string}
 */
export function plan_provider_profile_state_json(provider_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(provider_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_provider_profile_state_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 연결 정보 변경 후 저장된 모델 검증 상태를 안전한 미확인 상태로 되돌린다.
 *
 * 입력 상태가 wire contract를 벗어나면 빈 문자열을 반환한다.
 * @param {string} models_json
 * @returns {string}
 */
export function plan_provider_verification_reset_json(models_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(models_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_provider_verification_reset_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * RAG query result score row를 `JSON` plan으로 계산한다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_query_result_score_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_query_result_score_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Selects the files eligible for quiet recovery and one bounded smallest/oldest-first batch.
 * @param {string} files_json
 * @returns {string}
 */
export function plan_rag_automatic_recovery_batch_json(files_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_automatic_recovery_batch_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Plans automatic recovery from a canonical snapshot of eligible vault files.
 *
 * Invalid payloads return an empty string so the host wrapper can fail closed without
 * reimplementing policy in TypeScript.
 * @param {string} files_json
 * @param {string} completed_fingerprint
 * @param {number} attempt
 * @param {number} pending_document_count
 * @returns {string}
 */
export function plan_rag_automatic_recovery_json(files_json, completed_fingerprint, attempt, pending_document_count) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(completed_fingerprint, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_automatic_recovery_json(ptr0, len0, ptr1, len1, attempt, pending_document_count);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RAG 후보 파일 판정 전에 host content read가 필요한 file index를 계산한다.
 * @param {string} files_json
 * @param {string} exclude_paths_json
 * @param {string} exclude_exts_json
 * @returns {string}
 */
export function plan_rag_file_content_probe_indices_json(files_json, exclude_paths_json, exclude_exts_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(exclude_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(exclude_exts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_file_content_probe_indices_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * RAG 후보 file index와 file type summary 입력 row를 함께 계산한다.
 * @param {string} files_json
 * @param {string} exclude_paths_json
 * @param {string} exclude_exts_json
 * @param {string} text_probes_json
 * @returns {string}
 */
export function plan_rag_file_indexability_json(files_json, exclude_paths_json, exclude_exts_json, text_probes_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(exclude_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(exclude_exts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(text_probes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_file_indexability_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * RAG file type summary의 집계/정렬 plan을 `JSON` 문자열로 만든다.
 * @param {string} files_json
 * @param {string} no_extension_label
 * @returns {string}
 */
export function plan_rag_file_type_summary_json(files_json, no_extension_label) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(files_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(no_extension_label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_file_type_summary_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RAG 인덱싱의 예상 남은 시간을 계산합니다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_rag_indexing_eta_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_indexing_eta_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Plans one performance-guard state transition from deterministic JSON input.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_rag_performance_guard_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_performance_guard_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * RAG index status summary와 update 대상 document plan을 만든다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_rag_status_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_status_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Applies the storage health gate before reconciliation or generation deletion.
 * @param {string} health_json
 * @returns {string}
 */
export function plan_rag_storage_health_json(health_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(health_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rag_storage_health_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 참조 확장 대상으로 사용할 resolved file path index를 계산한다.
 * @param {string} source_path
 * @param {string} file_paths_json
 * @returns {string}
 */
export function plan_reference_file_indices_json(source_path, file_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_reference_file_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Plans blocked tool calls after canonicalizing JSON argument object key order.
 * @param {string} history_json
 * @param {string} candidates_json
 * @param {number} max_repeats
 * @param {number} max_native_search_calls
 * @returns {string}
 */
export function plan_repeated_tool_call_indices_json(history_json, candidates_json, max_repeats, max_native_search_calls) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(history_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_repeated_tool_call_indices_json(ptr0, len0, ptr1, len1, max_repeats, max_native_search_calls);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * LLM reranker provider에 넘길 system/user message content를 JSON으로 계획한다.
 * @param {string} question
 * @param {string} candidates_json
 * @param {number} max_text_chars
 * @returns {string}
 */
export function plan_rerank_messages_json(question, candidates_json, max_text_chars) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rerank_messages_json(ptr0, len0, ptr1, len1, max_text_chars);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * LLM reranker raw 응답에서 허용된 ranked id 목록만 JSON으로 반환한다.
 * @param {string} raw_response
 * @param {string} allowed_ids_json
 * @returns {string}
 */
export function plan_rerank_response_json(raw_response, allowed_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(raw_response, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(allowed_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rerank_response_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RAG reranker ranked id 목록을 전체 result index 순서 plan으로 변환한다.
 * @param {string} result_ids_json
 * @param {string} ranked_ids_json
 * @returns {string}
 */
export function plan_rerank_result_order_json(result_ids_json, ranked_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(result_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(ranked_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_rerank_result_order_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Validates answer-wide coverage claims against a derived coverage receipt.
 *
 * The returned action is `repair` when the answer claims unverified whole-file reading or an
 * insufficiently scoped negative conclusion.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_research_answer_contract_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_answer_contract_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Plans a bounded, stable local candidate selection from questions and inventory evidence.
 *
 * Invalid JSON or mismatched path/sample arrays return an empty string.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_research_candidate_selection_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_candidate_selection_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Selects citations explicitly referenced by the final answer, or a bounded evidence fallback.
 * @param {string} content
 * @param {string} citation_ids_json
 * @param {string} citation_paths_json
 * @param {number} fallback_limit
 * @returns {string}
 */
export function plan_research_citation_indices_json(content, citation_ids_json, citation_paths_json, fallback_limit) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(citation_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(citation_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_citation_indices_json(ptr0, len0, ptr1, len1, ptr2, len2, fallback_limit);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Advances the global provider-attempt or retry-wait ledger while reserving future logical calls.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_research_provider_ledger_transition_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_provider_ledger_transition_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Plans one hard logical provider-request ceiling without changing evidence-batch semantics.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_research_provider_request_budget_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_provider_request_budget_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Classifies a provider failure and returns a bounded retry plan for research requests.
 * @param {string} message
 * @param {number} status
 * @param {number} failed_attempt
 * @param {number} retry_after_ms
 * @returns {string}
 */
export function plan_research_request_failure_json(message, status, failed_attempt, retry_after_ms) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_request_failure_json(ptr0, len0, status, failed_attempt, retry_after_ms);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Groups summary items into stable bounded reduce batches without dropping any item.
 * @param {string} item_sizes_json
 * @param {number} max_items
 * @param {number} max_chars
 * @returns {string}
 */
export function plan_research_summary_batches_json(item_sizes_json, max_items, max_chars) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(item_sizes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_research_summary_batches_json(ptr0, len0, max_items, max_chars);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 완료된 대화의 제한된 요약 입력과 한 줄 제목을 반환합니다.
 * @param {string} messages_json
 * @param {string} generated_title
 * @returns {string}
 */
export function plan_session_title_json(messages_json, generated_title) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(generated_title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_session_title_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 현재 내용 기반 청크 ID와 일치하는 저장 벡터의 이관 인덱스를 반환합니다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_source_chunk_import_indices_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_chunk_import_indices_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 파일 형식별 원문 경계와 내용 기반 청크 ID를 반환합니다.
 * @param {string} path
 * @param {string} extension
 * @param {string} content
 * @param {number} max_size
 * @param {number} overlap
 * @returns {string}
 */
export function plan_source_chunks_json(path, extension, content, max_size, overlap) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(extension, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_chunks_json(ptr0, len0, ptr1, len1, ptr2, len2, max_size, overlap);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 제목·날짜·저자·유형의 원문 행과 날짜 충돌 상태를 반환한다.
 * @param {string} content
 * @returns {string}
 */
export function plan_source_metadata_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_metadata_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 공통 원문·BM25·임베딩의 준비 상태를 파일별로 반환합니다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_source_processing_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_processing_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * assistant 답변에서 출처 참조와 path alias plan을 `JSON` 문자열로 만든다.
 * @param {string} content
 * @returns {string}
 */
export function plan_source_references_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_references_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * source validation에 필요한 verified citation과 vault alias probe 입력을 `JSON` 문자열로 만든다.
 * @param {string} references_json
 * @param {string} citation_ids_json
 * @param {string} citation_paths_json
 * @param {string} citation_statuses_json
 * @returns {string}
 */
export function plan_source_validation_inputs_json(references_json, citation_ids_json, citation_paths_json, citation_statuses_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(references_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(citation_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(citation_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(citation_statuses_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_validation_inputs_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * 출처 참조 plan과 host boundary 검증 결과를 warning key plan으로 합친다.
 * @param {string} references_json
 * @param {string} verified_citation_ids_json
 * @param {string} verified_paths_json
 * @param {string} existing_aliases_json
 * @returns {string}
 */
export function plan_source_validation_warnings_json(references_json, verified_citation_ids_json, verified_paths_json, existing_aliases_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(references_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(verified_citation_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(verified_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(existing_aliases_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_source_validation_warnings_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Plans a bounded set difference between persisted source paths and current vault paths.
 * @param {string} indexed_paths_json
 * @param {string} valid_paths_json
 * @param {number} max_deletions
 * @returns {string}
 */
export function plan_stale_index_source_paths_json(indexed_paths_json, valid_paths_json, max_deletions) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(indexed_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(valid_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_stale_index_source_paths_json(ptr0, len0, ptr1, len1, max_deletions);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * structural retrieval에서 같은 heading 주변 entry index plan을 JSON으로 반환한다.
 * @param {string} seeds_json
 * @param {string} entries_json
 * @param {string} headings_json
 * @returns {string}
 */
export function plan_structural_heading_neighbors_json(seeds_json, entries_json, headings_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(seeds_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(headings_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_structural_heading_neighbors_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * structural retrieval에서 link/backlink target path plan을 JSON으로 반환한다.
 * @param {string} seed_paths_json
 * @param {string} edges_json
 * @returns {string}
 */
export function plan_structural_linked_paths_json(seed_paths_json, edges_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(seed_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(edges_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_structural_linked_paths_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 호스트 메타데이터로 자동완성과 정확한 태그·하위 태그 파일 범위를 계산한다.
 * @param {string} file_tags_json
 * @param {string} query
 * @param {number} max_files
 * @returns {string}
 */
export function plan_tag_mentions_json(file_tags_json, query, max_files) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_tags_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_tag_mentions_json(ptr0, len0, ptr1, len1, max_files);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * citation 배열에서 본문을 제외한 bounded source reference JSON 배열만 만든다.
 * @param {string} citations_json
 * @returns {string}
 */
export function plan_tool_result_source_references_json(citations_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(citations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_tool_result_source_references_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 오래된 도구 결과는 출처·범위·오류와 질문에 맞는 원문 구간을 보존해 축약한다.
 * @param {string} content
 * @param {string} question
 * @param {number} max_bytes
 * @returns {string}
 */
export function plan_tool_result_summary_json(content, question, max_bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_tool_result_summary_json(ptr0, len0, ptr1, len1, max_bytes);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vault link target의 path candidate와 basename fallback을 `JSON` 문자열로 반환한다.
 * @param {string} source_path
 * @param {string} raw_target
 * @returns {string}
 */
export function plan_vault_link_candidates_json(source_path, raw_target) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(source_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(raw_target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vault_link_candidates_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vault link basename fallback으로 선택할 markdown file index를 `JSON` 문자열로 반환한다.
 * @param {string} fallback_basename
 * @param {string} basenames_json
 * @returns {string}
 */
export function plan_vault_link_fallback_index_json(fallback_basename, basenames_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(fallback_basename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(basenames_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vault_link_fallback_index_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * 모델이 제안한 검색어는 제한된 데이터로만 사용하며 원문 질문을 대체하지 않는다.
 * @param {string} question
 * @param {string} response
 * @returns {string}
 */
export function plan_vault_query_expansion_json(question, response) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(response, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vault_query_expansion_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Plans stale file-index paths from a bounded host page.
 * @param {string} records_json
 * @param {string} embedding_provider
 * @param {string} embedding_model
 * @param {number} max_deletions
 * @returns {string}
 */
export function plan_vector_file_index_batch_json(records_json, embedding_provider, embedding_model, max_deletions) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(embedding_provider, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(embedding_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_file_index_batch_json(ptr0, len0, ptr1, len1, ptr2, len2, max_deletions);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Plans stale vector ids from a bounded metadata-only host page.
 * @param {string} records_json
 * @param {string} embedding_provider
 * @param {string} embedding_model
 * @param {number} expected_dimension
 * @param {number} max_deletions
 * @returns {string}
 */
export function plan_vector_record_batch_json(records_json, embedding_provider, embedding_model, expected_dimension, max_deletions) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(embedding_provider, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(embedding_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_record_batch_json(ptr0, len0, ptr1, len1, ptr2, len2, expected_dimension, max_deletions);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * 파일 경계에 맞는 벡터 검색 범위의 인덱스를 선택한다.
 * @param {string} paths_json
 * @param {string} prefixes_json
 * @returns {string}
 */
export function plan_vector_scope_indices_json(paths_json, prefixes_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(prefixes_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_scope_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store add mutation plan을 `JSON` 문자열로 만든다.
 * @param {string} existing_ids_json
 * @param {string} incoming_ids_json
 * @returns {string}
 */
export function plan_vector_store_add_json(existing_ids_json, incoming_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(incoming_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_add_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store file-path lookup index plan을 `JSON` 문자열로 만든다.
 * @param {string} entry_file_paths_json
 * @param {string} requested_file_paths_json
 * @returns {string}
 */
export function plan_vector_store_lookup_by_file_paths_json(entry_file_paths_json, requested_file_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(entry_file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(requested_file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_lookup_by_file_paths_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store id lookup index plan을 `JSON` 문자열로 만든다.
 * @param {string} entry_ids_json
 * @param {string} requested_ids_json
 * @returns {string}
 */
export function plan_vector_store_lookup_by_ids_json(entry_ids_json, requested_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(requested_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_lookup_by_ids_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store file removal mutation plan을 `JSON` 문자열로 만든다.
 * @param {string} existing_file_paths_json
 * @param {string} file_path
 * @returns {string}
 */
export function plan_vector_store_remove_file_json(existing_file_paths_json, file_path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing_file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_remove_file_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store file replacement mutation plan을 `JSON` 문자열로 만든다.
 * @param {string} existing_file_paths_json
 * @param {string} file_path
 * @param {number} incoming_count
 * @returns {string}
 */
export function plan_vector_store_replace_file_json(existing_file_paths_json, file_path, incoming_count) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing_file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_replace_file_json(ptr0, len0, ptr1, len1, incoming_count);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * vector store stats와 indexed file path plan을 `JSON` 문자열로 만든다.
 * @param {string} file_paths_json
 * @param {number} now
 * @returns {string}
 */
export function plan_vector_store_stats_json(file_paths_json, now) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_vector_store_stats_json(ptr0, len0, now);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Returns the Rust-owned delay for a recovery attempt, or zero when the session is exhausted.
 * @param {number} attempt
 * @returns {number}
 */
export function rag_automatic_recovery_delay_ms(attempt) {
    const ret = wasm.rag_automatic_recovery_delay_ms(attempt);
    return ret >>> 0;
}

/**
 * flattened vector matrix에서 top-k row index와 score 쌍을 반환한다.
 * @param {Float64Array} query
 * @param {Float64Array} vectors
 * @param {number} dimensions
 * @param {number} top_k
 * @returns {Float64Array}
 */
export function rank_top_k_pairs(query, vectors, dimensions, top_k) {
    const ptr0 = passArrayF64ToWasm0(query, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(vectors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rank_top_k_pairs(ptr0, len0, ptr1, len1, dimensions, top_k);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * exact top-k와 approximate top-k index 목록으로 recall@k를 계산한다.
 * @param {Uint32Array} exact_indices
 * @param {Uint32Array} approximate_indices
 * @param {number} top_k
 * @returns {number}
 */
export function recall_at_k(exact_indices, approximate_indices, top_k) {
    const ptr0 = passArray32ToWasm0(exact_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(approximate_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.recall_at_k(ptr0, len0, ptr1, len1, top_k);
    return ret;
}

/**
 * flattened vector matrix와 cluster assignment로 centroid matrix를 다시 계산한다.
 * @param {Float64Array} vectors
 * @param {Uint32Array} assignments
 * @param {Float64Array} previous_centroids
 * @param {number} dimensions
 * @returns {Float64Array}
 */
export function recompute_centroids(vectors, assignments, previous_centroids, dimensions) {
    const ptr0 = passArrayF64ToWasm0(vectors, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(assignments, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(previous_centroids, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.recompute_centroids(ptr0, len0, ptr1, len1, ptr2, len2, dimensions);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * retrieval source rank map에서 RRF score를 계산한다.
 * @param {Uint8Array} source_codes
 * @param {Float64Array} ranks
 * @param {number} bm25_weight
 * @returns {number}
 */
export function rrf_score_or_nan(source_codes, ranks, bm25_weight) {
    const ptr0 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(ranks, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rrf_score_or_nan(ptr0, len0, ptr1, len1, bm25_weight);
    return ret;
}

/**
 * Query result 후보에서 기존 `TypeScript` MMR diversity selection과 같은 index를 고른다.
 * @param {Float64Array} scores
 * @param {Float64Array} vectors
 * @param {number} dimensions
 * @param {Uint32Array} source_keys
 * @param {Uint32Array} heading_keys
 * @param {number} top_k
 * @returns {Float64Array}
 */
export function select_diverse_indices(scores, vectors, dimensions, source_keys, heading_keys, top_k) {
    const ptr0 = passArrayF64ToWasm0(scores, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(vectors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(source_keys, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray32ToWasm0(heading_keys, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.select_diverse_indices(ptr0, len0, ptr1, len1, dimensions, ptr2, len2, ptr3, len3, top_k);
    var v5 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v5;
}

/**
 * Context7 검색에서 이름이 일치하는 단일 문서 ID만 선택한다.
 * 동명이거나 모호한 후보는 임의로 첫 결과를 선택하지 않는다.
 * @param {string} plugin_json
 * @param {string} result_json
 * @returns {string}
 */
export function select_plugin_context7_library_id(plugin_json, result_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(plugin_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(result_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.select_plugin_context7_library_id(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RAG 후보 score 목록에서 최종 relevance gate를 통과한 원본 result index를 score 내림차순으로 반환한다.
 * @param {Float64Array} config
 * @param {Uint32Array} source_offsets
 * @param {Uint8Array} source_codes
 * @param {Float64Array} result_values
 * @returns {Float64Array}
 */
export function select_relevant_result_indices(config, source_offsets, source_codes, result_values) {
    const ptr0 = passArrayF64ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(source_offsets, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(result_values, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.select_relevant_result_indices(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var v5 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v5;
}

/**
 * MCP 경로 힌트가 필요한지 판정한다.
 * @param {string} command
 * @param {string} error_message
 * @returns {boolean}
 */
export function should_append_mcp_path_hint_rust(command, error_message) {
    const ptr0 = passStringToWasm0(command, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(error_message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.should_append_mcp_path_hint_rust(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * Context7를 암묵적으로 제공할 만큼 programming intent가 분명한지 판정한다.
 * @param {string} prompt
 * @returns {boolean}
 */
export function should_offer_context7_for_prompt(prompt) {
    const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.should_offer_context7_for_prompt(ptr0, len0);
    return ret !== 0;
}

/**
 * 비동기 처리 결과가 현재 원문 revision에 속하는지 판정합니다.
 * @param {string} expected_path
 * @param {string} current_path
 * @param {string} expected_hash
 * @param {string} current_hash
 * @param {Float64Array} revision_numbers
 * @returns {boolean}
 */
export function source_revision_matches(expected_path, current_path, expected_hash, current_hash, revision_numbers) {
    const ptr0 = passStringToWasm0(expected_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(current_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(expected_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(current_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArrayF64ToWasm0(revision_numbers, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.source_revision_matches(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    return ret !== 0;
}

/**
 * `<think>`류 태그를 reasoning/content로 분할한다.
 * @param {string} content
 * @returns {string}
 */
export function split_reasoning_tags_json(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.split_reasoning_tags_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Removes only complete compatibility tool-call blocks from visible answer text.
 * @param {string} content
 * @returns {string}
 */
export function strip_compatibility_tool_calls(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.strip_compatibility_tool_calls(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 텍스트의 `BM25` term frequency map을 `JSON` 문자열로 반환한다.
 * @param {string} text
 * @returns {string}
 */
export function token_frequencies_json(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.token_frequencies_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
 * @param {string} text
 * @returns {string}
 */
export function tokenize_json(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tokenize_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * RAG 제외 확장자 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
 * @param {string} input
 * @param {string} existing_exts_json
 * @returns {string}
 */
export function validate_exclude_extension_input_json(input, existing_exts_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(existing_exts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.validate_exclude_extension_input_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RAG 제외 경로 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
 * `path-missing` 경고는 host(상태 검사 필요)에서 처리한다.
 * @param {string} input
 * @param {string} existing_paths_json
 * @returns {string}
 */
export function validate_exclude_path_input_json(input, existing_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(existing_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.validate_exclude_path_input_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * MCP stdio server 설정 JSON을 스키마 기반으로 검증한다.
 * @param {string} mcp_json_text
 * @returns {string}
 */
export function validate_mcp_json(mcp_json_text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(mcp_json_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validate_mcp_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rag_wasm_bg.js": import0,
    };
}

const Bm25RuntimeIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bm25runtimeindex_free(ptr, 1));
const IvfRuntimeIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ivfruntimeindex_free(ptr, 1));
const VectorRuntimeIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vectorruntimeindex_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        throw new Error('Embedded WASM requires initSync(bytes).');
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
