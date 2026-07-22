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
 * `GraphRAG` relation edge를 무방향 endpoint pair 기준으로 집계한다.
 * @param {Uint32Array} source_indices
 * @param {Uint32Array} target_indices
 * @param {Float64Array} confidences
 * @param {number} node_count
 * @returns {Float64Array}
 */
export function aggregate_graph_edges_flat(source_indices, target_indices, confidences, node_count) {
    const ptr0 = passArray32ToWasm0(source_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(target_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(confidences, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.aggregate_graph_edges_flat(ptr0, len0, ptr1, len1, ptr2, len2, node_count);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

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
 * `GraphRAG` entity id를 기존 resolver 규칙으로 만든다.
 * @param {string} ontology_schema_id
 * @param {string} type_id
 * @param {string} canonical_name
 * @returns {string}
 */
export function create_entity_id(ontology_schema_id, type_id, canonical_name) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(ontology_schema_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(type_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(canonical_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.create_entity_id(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
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
 * `GraphRAG` record id를 기존 extraction ID 규칙으로 만든다.
 * @param {string} parts
 * @returns {string}
 */
export function create_graph_id(parts) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(parts, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.create_graph_id(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
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
 * `GraphRAG` community detection의 node assignment와 modularity를 계산한다.
 * @param {Uint32Array} source_indices
 * @param {Uint32Array} target_indices
 * @param {Float64Array} weights
 * @param {number} node_count
 * @param {number} max_iterations
 * @returns {Float64Array}
 */
export function detect_communities_flat(source_indices, target_indices, weights, node_count, max_iterations) {
    const ptr0 = passArray32ToWasm0(source_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(target_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.detect_communities_flat(ptr0, len0, ptr1, len1, ptr2, len2, node_count, max_iterations);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * `GraphRAG` string edge snapshot에서 community assignment JSON plan을 만든다.
 * @param {string} edges_json
 * @param {number} max_iterations
 * @returns {string}
 */
export function detect_communities_from_edges_json(edges_json, max_iterations) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(edges_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect_communities_from_edges_json(ptr0, len0, max_iterations);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` string edge snapshot에서 연결성 refinement를 포함한 계층 community plan을 만든다.
 * @param {string} edges_json
 * @param {number} max_iterations
 * @param {number} max_levels
 * @returns {string}
 */
export function detect_leiden_hierarchy_from_edges_json(edges_json, max_iterations, max_levels) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(edges_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect_leiden_hierarchy_from_edges_json(ptr0, len0, max_iterations, max_levels);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` LLM 응답에서 JSON object 텍스트를 추출한다. 실패하면 빈 문자열을 반환한다.
 * @param {string} raw_response
 * @returns {string}
 */
export function extract_json_object_text(raw_response) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw_response, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_json_object_text(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * 질문과 entity name 목록에서 언급된 `GraphRAG` entity index/score 쌍을 찾는다.
 * @param {string} question
 * @param {string} ontology_schema_id
 * @param {string} entity_schema_ids
 * @param {string} canonical_names
 * @param {string} aliases_by_entity
 * @param {string} entity_hints
 * @returns {Float64Array}
 */
export function find_mentioned_entity_matches(question, ontology_schema_id, entity_schema_ids, canonical_names, aliases_by_entity, entity_hints) {
    const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(ontology_schema_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(entity_schema_ids, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(canonical_names, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(aliases_by_entity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passStringToWasm0(entity_hints, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len5 = WASM_VECTOR_LEN;
    const ret = wasm.find_mentioned_entity_matches(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
    var v7 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v7;
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
 * 현재 Graph extraction parser/normalizer wire contract version을 반환한다.
 * @returns {number}
 */
export function graph_extraction_contract_version() {
    const ret = wasm.graph_extraction_contract_version();
    return ret >>> 0;
}

/**
 * RAG hybrid score를 계산한다.
 * @param {number} combined_base
 * @param {number} rrf_score
 * @param {number} source_prior
 * @param {number} source_evidence_score
 * @param {number} best_evidence_rank
 * @param {Uint8Array} source_codes
 * @returns {number}
 */
export function hybrid_score_or_nan(combined_base, rrf_score, source_prior, source_evidence_score, best_evidence_rank, source_codes) {
    const ptr0 = passArray8ToWasm0(source_codes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hybrid_score_or_nan(combined_base, rrf_score, source_prior, source_evidence_score, best_evidence_rank, ptr0, len0);
    return ret;
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
 * `GraphRAG` extraction cache snapshot이 요청 key와 일치하는지 판정한다.
 * @param {string} cached_json
 * @param {string} input_json
 * @returns {string}
 */
export function is_graph_extraction_cache_hit_json(cached_json, input_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(cached_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.is_graph_extraction_cache_hit_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
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
 * 두 entity id 쌍이 순서와 무관하게 같은 대상을 가리키는지 판정한다.
 * @param {string} first_left
 * @param {string} first_right
 * @param {string} second_left
 * @param {string} second_right
 * @returns {boolean}
 */
export function is_same_graph_entity_pair(first_left, first_right, second_left, second_right) {
    const ptr0 = passStringToWasm0(first_left, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(first_right, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(second_left, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(second_right, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.is_same_graph_entity_pair(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    return ret !== 0;
}

/**
 * `GraphRAG` entity 이름을 비교 가능한 형태로 정규화한다.
 * @param {string} name
 * @returns {string}
 */
export function normalize_entity_name(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_entity_name(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * `GraphRAG` LLM 추출 JSON payload를 저장 가능한 graph fact payload로 정규화한다.
 * @param {string} json_text
 * @returns {string}
 */
export function normalize_extracted_graph_payload_json(json_text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(json_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_extracted_graph_payload_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` extraction confidence를 `[0, 1]` 범위로 정규화한다.
 * @param {number} confidence
 * @returns {number}
 */
export function normalize_graph_confidence_or_default(confidence) {
    const ret = wasm.normalize_graph_confidence_or_default(confidence);
    return ret;
}

/**
 * `GraphRAG` extraction 이름을 비교 가능한 형태로 정규화한다.
 * @param {string} name
 * @returns {string}
 */
export function normalize_graph_name(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalize_graph_name(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * fact evidence span을 source 길이 안의 안정적인 pair로 정규화한다.
 * @param {Uint32Array} starts
 * @param {Uint32Array} ends
 * @param {number} content_length
 * @returns {Uint32Array}
 */
export function normalize_graph_source_spans_flat(starts, ends, content_length) {
    const ptr0 = passArray32ToWasm0(starts, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(ends, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.normalize_graph_source_spans_flat(ptr0, len0, ptr1, len1, content_length);
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
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
 * `GraphRAG` LLM raw 응답을 graph extraction parse 결과로 변환한다.
 * @param {string} raw_response
 * @returns {string}
 */
export function parse_extracted_graph_payload_json(raw_response) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw_response, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.parse_extracted_graph_payload_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
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
 * claim record snapshot에서 evidence score JSON plan을 만든다.
 * @param {string} claims_json
 * @returns {string}
 */
export function plan_claim_evidence_scores_json(claims_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(claims_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_claim_evidence_scores_json(ptr0, len0);
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
 * `GraphRAG` virtual source verification plan을 만든다.
 * @param {string} file_path
 * @param {string} unsupported_detail
 * @returns {string}
 */
export function plan_context_graph_verification_json(file_path, unsupported_detail) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(unsupported_detail, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_context_graph_verification_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
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
 * `GraphRAG` entity resolution 후보 점수에서 최종 merge plan을 계산한다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_entity_resolution_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_entity_resolution_json(ptr0, len0);
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
 * @returns {string}
 */
export function plan_folder_lexical_evidence_indices_json(query, samples_json, top_k) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(samples_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_folder_lexical_evidence_indices_json(ptr0, len0, ptr1, len1, top_k);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
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
 * Graph extraction claim entity name을 entity id 목록으로 해석한다.
 * @param {string} entity_names_json
 * @param {string} lookup_records_json
 * @returns {string}
 */
export function plan_graph_claim_entity_ids_json(entity_names_json, lookup_records_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(entity_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lookup_records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_claim_entity_ids_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` community replacement에서 삭제할 기존 community id plan을 계산한다.
 * @param {string} communities_json
 * @param {string} ontology_schema_id
 * @returns {string}
 */
export function plan_graph_community_replacement_delete_ids_json(communities_json, ontology_schema_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(communities_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(ontology_schema_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_community_replacement_delete_ids_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Graph community summarizer의 entity/relation/claim grouping index plan을 계산한다.
 * @param {string} assignments_json
 * @param {string} entity_ids_json
 * @param {string} relations_json
 * @param {string} claims_json
 * @param {string} community_ids_json
 * @returns {string}
 */
export function plan_graph_community_summary_groups_json(assignments_json, entity_ids_json, relations_json, claims_json, community_ids_json) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(assignments_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(entity_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(relations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(claims_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(community_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_community_summary_groups_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}

/**
 * RAG vector indexing progress snapshot에서 ETA plan JSON을 만든다.
 * @param {string} record_keys_json
 * @param {string} requested_keys_json
 * @returns {string}
 */
export function plan_graph_deletion_indices_json(record_keys_json, requested_keys_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(record_keys_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(requested_keys_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_deletion_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` entity/relation string snapshot에서 relation edge record JSON plan을 만든다.
 * @param {string} entity_ids_json
 * @param {string} relation_source_ids_json
 * @param {string} relation_target_ids_json
 * @param {string} confidences_json
 * @returns {string}
 */
export function plan_graph_edge_records_json(entity_ids_json, relation_source_ids_json, relation_target_ids_json, confidences_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(entity_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relation_source_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(relation_target_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(confidences_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_edge_records_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * `GraphRAG` entity upsert merge field plan을 만든다.
 * @param {string} existing_json
 * @param {string} next_json
 * @returns {string}
 */
export function plan_graph_entity_merge_json(existing_json, next_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(next_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_entity_merge_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * ordered evidence score와 evidence snapshot에서 후보 lookup plan을 만든다.
 * @param {string} scores_json
 * @param {string} evidence_json
 * @returns {string}
 */
export function plan_graph_evidence_candidate_lookup_json(scores_json, evidence_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(scores_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(evidence_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_evidence_candidate_lookup_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Graph evidence candidate를 최종 vector entry candidate로 해석한다.
 * @param {string} candidate_entry_ids_json
 * @param {string} entries_json
 * @param {number} candidate_limit
 * @returns {string}
 */
export function plan_graph_evidence_entry_candidates_json(candidate_entry_ids_json, entries_json, candidate_limit) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(candidate_entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_evidence_entry_candidates_json(ptr0, len0, ptr1, len1, candidate_limit);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * context overflow가 난 extraction unit을 더 작은 Markdown 경계 child unit으로 나눈다.
 * @param {string} content
 * @param {number} split_depth
 * @returns {string}
 */
export function plan_graph_extraction_child_units_json(content, split_depth) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_extraction_child_units_json(ptr0, len0, split_depth);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Graph extraction provider 실패의 재시도 및 회로 차단 정책을 계산한다.
 * @param {string} message
 * @param {number} status
 * @param {number} attempt_count
 * @param {number} consecutive_failures
 * @param {number} now_ms
 * @param {number} retry_after_ms
 * @returns {string}
 */
export function plan_graph_extraction_failure_json(message, status, attempt_count, consecutive_failures, now_ms, retry_after_ms) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_extraction_failure_json(ptr0, len0, status, attempt_count, consecutive_failures, now_ms, retry_after_ms);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` mention context에서 표시할 entity/relation index plan을 만든다.
 * @param {string} mention_names_json
 * @param {string} entities_json
 * @param {string} relations_json
 * @returns {string}
 */
export function plan_graph_mention_context_json(mention_names_json, entities_json, relations_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(mention_names_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(entities_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(relations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_mention_context_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * `GraphRAG` query mode와 planner 결과에서 실행 action을 계산한다.
 * @param {string} configured_mode
 * @param {string} planned_mode
 * @param {boolean} evidence_first
 * @returns {string}
 */
export function plan_graph_query_execution_json(configured_mode, planned_mode, evidence_first) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(configured_mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(planned_mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_query_execution_json(ptr0, len0, ptr1, len1, evidence_first);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * deterministic `GraphRAG` query plan을 `JSON` 문자열로 반환한다.
 * @param {string} question
 * @returns {string}
 */
export function plan_graph_query_json(question) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_query_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` LLM planner raw 응답을 graph query plan JSON으로 변환한다.
 * @param {string} raw_response
 * @param {string} fallback_question
 * @returns {string}
 */
export function plan_graph_query_response_json(raw_response, fallback_question) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(raw_response, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(fallback_question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_query_response_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG`가 처리할 markdown file path 목록을 입력 순서대로 계산한다.
 * @param {string} file_paths_json
 * @returns {string}
 */
export function plan_graph_rag_markdown_file_paths_json(file_paths_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_markdown_file_paths_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` indexing run에서 candidate/selected file path 목록을 계산한다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_graph_rag_run_file_selection_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_run_file_selection_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` status 계산에 필요한 vector entry id lookup plan을 만든다.
 * @param {string} evidence_entry_ids_json
 * @param {string} cache_entry_ids_json
 * @returns {string}
 */
export function plan_graph_rag_status_entry_lookups_json(evidence_entry_ids_json, cache_entry_ids_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(evidence_entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(cache_entry_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_status_entry_lookups_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` status에 사용할 vector entry snapshot plan을 만든다.
 * @param {string} entries_json
 * @returns {string}
 */
export function plan_graph_rag_status_entry_snapshot_json(entries_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(entries_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_status_entry_snapshot_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` status에 사용할 candidate file snapshot plan을 만든다.
 * @param {string} file_records_json
 * @param {string} indexed_file_paths_json
 * @returns {string}
 */
export function plan_graph_rag_status_file_snapshot_json(file_records_json, indexed_file_paths_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(file_records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(indexed_file_paths_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_status_file_snapshot_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` index status summary plan을 만든다.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_graph_rag_status_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_status_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` store에서 prune할 unsupported graph file path 목록을 계산한다.
 * @param {string} evidence_json
 * @param {string} rejected_facts_json
 * @returns {string}
 */
export function plan_graph_rag_unsupported_prune_paths_json(evidence_json, rejected_facts_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(evidence_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(rejected_facts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_rag_unsupported_prune_paths_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Graph extraction relation source/target name을 accepted entity index pair로 해석한다.
 * @param {string} relations_json
 * @param {string} lookup_records_json
 * @param {number} entity_count
 * @returns {string}
 */
export function plan_graph_relation_endpoint_indices_json(relations_json, lookup_records_json, entity_count) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(relations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lookup_records_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_relation_endpoint_indices_json(ptr0, len0, ptr1, len1, entity_count);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` community schema id matching index plan을 계산한다.
 * @param {string} community_schema_ids_json
 * @param {string} ontology_schema_id
 * @returns {string}
 */
export function plan_graph_schema_community_indices_json(community_schema_ids_json, ontology_schema_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(community_schema_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(ontology_schema_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_schema_community_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `GraphRAG` relation schema id matching index plan을 계산한다.
 * @param {string} relation_schema_ids_json
 * @param {string} ontology_schema_id
 * @returns {string}
 */
export function plan_graph_schema_relation_indices_json(relation_schema_ids_json, ontology_schema_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(relation_schema_ids_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(ontology_schema_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_schema_relation_indices_json(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Plans bounded retention of rebuildable `GraphRAG` jobs, responses, and circuit state.
 * @param {string} input_json
 * @returns {string}
 */
export function plan_graph_storage_maintenance_json(input_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.plan_graph_storage_maintenance_json(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
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
 * @param {string} plugin_id
 * @param {string} vault_identity
 * @param {string} legacy_vault_name
 * @param {string} embedding_namespace
 * @returns {string}
 */
export function plan_indexed_db_storage_layout_json(plugin_id, vault_identity, legacy_vault_name, embedding_namespace) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(plugin_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(vault_identity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(legacy_vault_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(embedding_namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.plan_indexed_db_storage_layout_json(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * `GraphRAG` record snapshot에서 local evidence score `JSON` plan을 만든다.
 * @param {string} matches_json
 * @param {string} relations_json
 * @param {string} claims_json
 * @param {number} traversal_depth
 * @returns {string}
 */
export function plan_local_evidence_scores_json(matches_json, relations_json, claims_json, traversal_depth) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(matches_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(relations_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(claims_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.plan_local_evidence_scores_json(ptr0, len0, ptr1, len1, ptr2, len2, traversal_depth);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
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
 * graph store record key snapshot에서 삭제할 record index plan을 만든다.
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
 * `GraphRAG` store pruning에서 삭제/업데이트할 record index plan을 계산한다.
 * @param {Uint32Array} config
 * @param {Uint32Array} indices
 * @param {string} wire_values
 * @returns {string}
 */
export function prune_graph_indexes_json(config, indices, wire_values) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray32ToWasm0(config, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(wire_values, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.prune_graph_indexes_json(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
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
 * `GraphRAG` entity 병합 이후 참조 id를 교체하고 필요하면 순서를 보존해 중복 제거한다.
 * @param {string} references_json
 * @param {string} candidate_entity_id
 * @param {string} existing_entity_id
 * @param {boolean} deduplicate
 * @returns {string}
 */
export function rewrite_graph_entity_references_json(references_json, candidate_entity_id, existing_entity_id, deduplicate) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(references_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidate_entity_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(existing_entity_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rewrite_graph_entity_references_json(ptr0, len0, ptr1, len1, ptr2, len2, deduplicate);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
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
 * `GraphRAG` record id part를 기존 extraction ID 규칙으로 정규화한다.
 * @param {string} part
 * @returns {string}
 */
export function sanitize_graph_id_part(part) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(part, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sanitize_graph_id_part(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `GraphRAG` entity merge score를 계산한다.
 * @param {string} candidate_names
 * @param {string} existing_names
 * @param {string} descriptions
 * @param {string} evidence_ids
 * @param {boolean} same_type
 * @param {number} embedding_score
 * @returns {number}
 */
export function score_entity_match_or_nan(candidate_names, existing_names, descriptions, evidence_ids, same_type, embedding_score) {
    const ptr0 = passStringToWasm0(candidate_names, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(existing_names, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(descriptions, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(evidence_ids, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.score_entity_match_or_nan(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, same_type, embedding_score);
    return ret;
}

/**
 * `GraphRAG` local/evidence-first evidence score pair를 계산한다.
 * @param {Uint32Array} config
 * @param {Uint32Array} indices
 * @param {Float64Array} values
 * @returns {Float64Array}
 */
export function score_local_evidence_pairs(config, indices, values) {
    const ptr0 = passArray32ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.score_local_evidence_pairs(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
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
 * `GraphRAG` runtime 재구성 여부를 판정한다.
 * @param {boolean} graph_rag_enabled
 * @param {string} graph_rag_model
 * @param {string} previous_status_state
 * @param {string} next_status_state
 * @param {boolean} graph_provider_attached
 * @returns {boolean}
 */
export function should_rebuild_graph_runtime_for_graph_status(graph_rag_enabled, graph_rag_model, previous_status_state, next_status_state, graph_provider_attached) {
    const ptr0 = passStringToWasm0(graph_rag_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(previous_status_state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(next_status_state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.should_rebuild_graph_runtime_for_graph_status(graph_rag_enabled, ptr0, len0, ptr1, len1, ptr2, len2, graph_provider_attached);
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

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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
