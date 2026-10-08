/* tslint:disable */

/**
 * JS wrapper가 재사용할 수 있는 BM25 runtime index.
 */
export class Bm25RuntimeIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * document 하나를 runtime index에 추가하거나 교체한다.
     */
    add_document(doc_id: string, text: string, source_path: string, tokenizer_version: number): void;
    /**
     * bounded JSON 문서 batch를 한 번의 bridge 호출로 검증하고 추가한다.
     */
    add_documents_json(documents_json: string, tokenizer_version: number, known_unique: boolean): number;
    /**
     * 중복이 없다고 보장된 document 하나를 runtime index에 추가한다.
     */
    add_new_document(doc_id: string, text: string, source_path: string, tokenizer_version: number): void;
    /**
     * legacy 또는 compact JSON payload에서 runtime index를 만든다.
     */
    static from_json(payload: string, fallback_tokenizer_version: number): Bm25RuntimeIndex;
    /**
     * document가 하나 이상 있는지 반환한다.
     */
    is_ready(): boolean;
    /**
     * tokenizer contract version이 최신인지 반환한다.
     */
    is_tokenizer_current(tokenizer_version: number): boolean;
    /**
     * 빈 BM25 runtime index를 만든다.
     */
    constructor(tokenizer_version: number);
    /**
     * document 하나를 runtime index에서 제거한다.
     */
    remove_document(doc_id: string, tokenizer_version: number): void;
    /**
     * source path에 속한 document들을 runtime index에서 제거한다.
     */
    remove_source(source_path: string, tokenizer_version: number): void;
    /**
     * query score 목록을 JSON 문자열로 반환한다.
     */
    search_json(query: string): string;
    /**
     * 상위 query score 목록만 JSON 문자열로 반환한다.
     */
    search_top_json(query: string, limit: number): string;
    /**
     * doc id에 대응되는 source path를 반환한다. 없으면 빈 문자열이다.
     */
    source_path_for_doc(doc_id: string): string;
    /**
     * compact v3 JSON payload로 직렬화한다.
     */
    to_json(): string;
    /**
     * tokenizer contract version을 반환한다.
     */
    tokenizer_version(): number;
    /**
     * indexed document 수를 반환한다.
     */
    total_docs(): number;
}

/**
 * JS wrapper가 재사용할 수 있는 IVF ANN runtime index.
 */
export class IvfRuntimeIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * cluster count를 반환한다.
     */
    cluster_count(): number;
    /**
     * vector dimension을 반환한다.
     */
    dimensions(): number;
    /**
     * flattened row-major vector matrix로 IVF runtime index를 만든다.
     */
    constructor(vectors: Float32Array, dimensions: number, requested_cluster_count: number, iterations: number);
    /**
     * centroid probe와 candidate scoring을 Rust 내부에서 수행해 top-k row index/score pair를 반환한다.
     */
    query(query: Float32Array, top_k: number, probe_count: number): Float64Array;
    /**
     * original row count를 반환한다.
     */
    row_count(): number;
}

/**
 * JS wrapper가 재사용할 수 있는 normalized vector runtime index.
 */
export class VectorRuntimeIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * vector dimension을 반환한다.
     */
    dimensions(): number;
    /**
     * flattened row-major vector matrix로 runtime index를 만든다.
     */
    constructor(vectors: Float32Array, dimensions: number);
    /**
     * 모든 valid row에서 top-k row index/score pair를 반환한다.
     */
    rank_top_k(query: Float32Array, top_k: number): Float64Array;
    /**
     * 지정된 row index 후보 안에서 top-k row index/score pair를 반환한다.
     */
    rank_top_k_filtered(query: Float32Array, row_indices: Uint32Array, top_k: number): Float64Array;
    /**
     * original row count를 반환한다.
     */
    row_count(): number;
}

/**
 * retrieval source score/rank를 source-aware RAG relevance 계산 입력으로 요약한다.
 */
export function analyze_retrieval_sources(source_codes: Uint8Array, source_scores: Float64Array, source_ranks: Float64Array): Float64Array;

/**
 * flattened vector matrix의 각 row를 가장 가까운 centroid index로 배정한다.
 */
export function assign_vector_clusters(vectors: Float64Array, centroids: Float64Array, dimensions: number): Float64Array;

/**
 * flattened posting list에서 `BM25` doc index와 score 쌍을 계산한다.
 */
export function bm25_score_pairs(term_offsets: Uint32Array, doc_indices: Uint32Array, term_frequencies: Float64Array, doc_lengths: Float64Array, total_docs: number, avg_doc_length: number): Float64Array;

/**
 * flattened vector matrix에서 `IVF ANN` 초기 centroid matrix를 계산한다.
 */
export function build_initial_centroids(vectors: Float64Array, dimensions: number, requested_cluster_count: number): Float64Array;

/**
 * Markdown을 heading/code block/paragraph 경계 기준으로 chunk JSON으로 만든다.
 */
export function chunk_markdown_json(content: string, max_chunk_size: number, overlap_chars: number): string;

/**
 * 일반 텍스트와 코드 파일을 줄/빈 줄 경계 기준으로 chunk JSON으로 만든다.
 */
export function chunk_plain_text_json(content: string, max_chunk_size: number, overlap_chars: number): string;

/**
 * MCP 에러 메시지를 분류해 TS i18n 렌더링에 필요한 키 계약을 만든다.
 */
export function classify_mcp_tool_error_json(raw_msg: string): string;

/**
 * 후보 reason 목록을 인덱스 순서로 중복 제거해 반환한다.
 */
export function collect_candidate_reasons(candidate_reasons_json: string, candidate_indexes_json: string): string;

/**
 * `TypeScript` 호스트에 노출할 `Rust` 코어 버전을 반환한다.
 */
export function core_version(): string;

/**
 * `WASM` 호출용 cosine similarity. invalid vector는 `NaN`으로 반환한다.
 */
export function cosine_similarity_or_nan(left: Float64Array, right: Float64Array): number;

/**
 * 파일 확장자 목록 기준 카운트를 계산한다.
 */
export function count_files_by_extensions_json(file_extensions_json: string, extension_keys_json: string): string;

/**
 * query token 목록과 텍스트에서 substring 매칭 수를 계산한다.
 */
export function count_keyword_matches(query_tokens: string, text: string): number;

/**
 * 현재 `TypeScript` 경로와 같은 32비트 `FNV-1a` 콘텐츠 해시를 만든다.
 */
export function create_content_hash(content: string): string;

/**
 * context source preview를 만든다.
 */
export function create_context_preview(text: string): string;

/**
 * 벡터 entry snapshot 배열 fingerprint를 생성한다.
 */
export function create_entries_fingerprint(entry_ids_json: string, content_hashes_json: string, indexed_ats_json: string, vector_lengths_json: string): string;

/**
 * Creates a collision-resistant deterministic key for one namespaced `IndexedDB` record.
 */
export function create_indexed_db_record_key(namespace: string, value: string): string;

/**
 * Derives a conservative coverage receipt from successful native-vault tool result payloads.
 *
 * Only an untruncated search that scanned without unreadable files can support a scoped exact
 * negative claim. Native tool results never prove that every inventory document was read.
 */
export function derive_native_tool_coverage_receipt_json(results_json: string): string;

/**
 * Derives auditable whole-vault and selected-evidence coverage booleans.
 *
 * Invalid JSON returns an empty string. Semantic inconsistencies produce a receipt with reason
 * codes and conservative `false` decisions.
 */
export function derive_research_coverage_receipt_json(input_json: string): string;

/**
 * 검색 질의와 문서에 공식 `EmbeddingGemma` 접두사를 적용한다.
 */
export function embedding_gemma_inputs_json(texts_json: string, kind: string): string | undefined;

/**
 * `delta` 객체의 구조화 reasoning 필드를 추출한다.
 */
export function extract_structured_reasoning(delta_json: string): string;

/**
 * vault 내부 참조 링크를 추출하고 `JSON` 문자열로 반환한다.
 */
export function extract_vault_links_json(content: string): string;

/**
 * 같은 본문의 기존 프롬프트 위치를 반환해 항목 중복을 방지합니다.
 */
export function find_reusable_prompt(entries_json: string, content: string): number;

/**
 * MCP 시작 오류와 stderr를 합치고 환경 변수 값을 숨긴 뒤 표시 길이를 제한한다.
 */
export function format_mcp_connection_error(message: string, stderr: string, secrets_json: string): string;

/**
 * MCP JSON 설정을 검증 가능한 JSON 문자열로 다시 포맷한다.
 */
export function format_mcp_json(mcp_json_text: string): string;

/**
 * MCP 연결 상태를 계산한다.
 */
export function get_mcp_connection_state_rust(total_count: number, connected_count: number, failed_count: number, is_connecting: boolean): string;

/**
 * 파일 경로 확장자가 제외 대상 목록에 있으면 `true`를 반환한다.
 */
export function is_excluded_ext_json(file_path: string, extension_keys_json: string): boolean;

/**
 * vault path가 제외 pattern 목록에 매칭되는지 확인한다.
 */
export function is_excluded_path(file_path: string, patterns: string): boolean;

/**
 * 연결의 실제 주소가 로컬 처리 대상인지 판정합니다.
 */
export function is_local_settings_provider(strategy: string, base_url: string): boolean;

/**
 * MCP tool 목록에 요청 tool name이 있는지 Rust에서 판정한다.
 */
export function is_mcp_tool_name_available(tool_name: string, tool_names_json: string): boolean;

/**
 * MCP tool 결과가 빈 응답으로 간주되는지 계산한다.
 */
export function is_mcp_tool_result_empty_json(result_json: string, display_text: string, model_text: string): boolean;

/**
 * Markdown 문서 확장자 제외를 막는지 확인한다.
 */
export function is_protected_rag_document_extension_json(extension: string): boolean;

/**
 * 최상위 YAML 속성이 있으면 false 외에는 제외한다.
 */
export function is_rag_frontmatter_excluded_json(frontmatter_json: string): boolean;

/**
 * RAG 제외 가능한 확장자인지 확인한다.
 */
export function is_recommendable_exclude_extension_json(extension: string): boolean;

/**
 * RAG 후보가 최종 context 후보로 유지될 만큼 관련 있는지 판단한다.
 */
export function is_relevant_result(config: Float64Array, source_codes: Uint8Array): boolean;

/**
 * 명시 폴더의 개념 비교와 종합은 인용문 한 곳을 찾는 요청과 구분한다.
 */
export function is_scoped_vault_research_intent(question: string): boolean;

/**
 * 새 대화 저장 폴더가 볼트 안의 상대 경로인지 확인합니다.
 */
export function is_valid_settings_folder(input: string): boolean;

/**
 * Detects explicit requests that require whole-vault coverage instead of top-k retrieval.
 */
export function is_whole_vault_research_intent(question: string): boolean;

/**
 * 다운로드 응답의 HTTP 상태, 구간과 길이가 요청과 일치하는지 검사한다.
 */
export function local_model_range_matches(start: number, end: number, total: number, status: number, length: number, content_range: string): boolean;

/**
 * 확장자 문자열을 RAG 제외 설정 계약에 맞게 정규화한다.
 */
export function normalize_exclude_extension_json(extension: string): string;

/**
 * MCP tool 실행 결과에서 표시/모델 텍스트 추출 계약을 계산한다.
 */
export function normalize_mcp_tool_result_json(result_json: string): string;

/**
 * 구조화 reasoning과 태그 reasoning을 병합해 content/reasoning을 만들고 JSON으로 반환한다.
 */
export function normalize_reasoning_chunk_json(content: string, reasoning: string): string;

/**
 * MCP tool 실행 인자 문자열을 TypeScript 호스트 경계 계약으로 정규화한다.
 */
export function parse_mcp_tool_arguments_json(arguments_text: string): string;

/**
 * 채팅 입력의 raw mention 후보를 추출하고 `JSON` 문자열로 반환한다.
 */
export function parse_mention_candidates_json(content: string): string;

/**
 * 설정의 편집 중 문자열을 검증하고 잘못된 값이면 `NaN`을 반환합니다.
 */
export function parse_settings_number(input: string, min: number, max: number, integer: boolean): number;

/**
 * Plans the next provider turn without relying on provider- or model-specific behavior.
 */
export function plan_agentic_tool_turn_json(input_json: string): string;

/**
 * assistant 응답을 일반 답변 또는 사용자 질문 plan으로 분류한다.
 */
export function plan_assistant_response_classification_json(content: string, reasoning: string): string;

/**
 * BM25 hit, id lookup entry, file-path lookup entry를 최종 candidate plan으로 해석한다.
 */
export function plan_bm25_candidate_resolution_json(hits_json: string, found_entries_json: string, path_entries_json: string, candidate_limit: number, max_score: number): string;

/**
 * BM25 score hit 목록을 score 순서로 제한하고 lookup plan을 JSON으로 반환한다.
 */
export function plan_bm25_hit_lookup_json(hits_json: string, candidate_limit: number, lookup_multiplier: number): string;

/**
 * BM25 index에 문서 하나를 추가/교체한 새 index JSON plan을 만든다.
 */
export function plan_bm25_index_add_document_json(index_json: string, doc_id: string, text: string, source_path: string, tokenizer_version: number): string;

/**
 * BM25 index에서 문서 하나를 제거한 새 index JSON plan을 만든다.
 */
export function plan_bm25_index_remove_document_json(index_json: string, doc_id: string, tokenizer_version: number): string;

/**
 * BM25 index에서 source path에 속한 문서를 제거한 새 index JSON plan을 만든다.
 */
export function plan_bm25_index_remove_source_json(index_json: string, source_path: string, tokenizer_version: number): string;

/**
 * BM25 index와 raw query에서 doc score JSON plan을 만든다.
 */
export function plan_bm25_search_json(index_json: string, query: string): string;

/**
 * BM25 hit 중 id lookup에서 발견되지 않은 source file path 목록을 JSON으로 반환한다.
 */
export function plan_bm25_source_lookups_json(hits_json: string, found_entry_ids_json: string): string;

/**
 * Chat context mention type별 index와 auto-RAG policy를 계산한다.
 */
export function plan_chat_context_mentions_json(mention_types_json: string): string;

/**
 * 현재 원문에서 질문에 맞는 완전한 Markdown 구간만 전달 근거로 선택합니다.
 */
export function plan_chat_evidence_json(input_json: string): string;

/**
 * 저장된 chat session markdown body에서 current-format message plan을 만든다.
 */
export function plan_chat_messages_json(body: string, now_timestamp: number, now_iso: string, decode_failure_label: string): string;

/**
 * 저장된 chat session markdown에서 list metadata plan을 만든다.
 */
export function plan_chat_meta_json(content: string, fallback_title: string, fallback_created_iso: string): string;

/**
 * 모든 연결에서 사용 가능한 채팅 모델을 정렬하고 저장된 기본 모델을 검증한다.
 *
 * 저장된 기본 모델이 사라졌거나 사용할 수 없으면 다른 프로바이더로 조용히
 * 전환하지 않는다. 호스트가 사용자의 명시적 선택을 받도록 빈 선택을 반환한다.
 * 잘못된 입력은 빈 문자열을 반환한다.
 */
export function plan_chat_model_state_json(providers_json: string, configured_default: string): string;

/**
 * 시스템 지침·최신 요청을 보존하며 오래된 완전한 턴만 예산에 따라 제외합니다.
 */
export function plan_chat_request_json(input_json: string): string;

/**
 * 저장할 chat session metadata plan을 만든다.
 */
export function plan_chat_save_metadata_json(messages_json: string, existing_created: string, option_title: string, now_iso: string): string;

/**
 * 검증된 첨부 구간이 완전히 포함하는 검색 후보만 제외한다.
 */
export function plan_chat_unique_result_indices_json(sources_json: string, citations_json: string): string;

/**
 * 호스트 I/O에 필요한 결정적 결과를 생성한다. 잘못된 입력은 빈 결과로 닫는다.
 */
export function plan_chatgpt_json(input_json: string): string;

/**
 * Extracts bounded JSON tool calls from the compatibility protocol.
 */
export function plan_compatibility_tool_calls_json(content: string): string;

/**
 * Context budget append 결과를 Rust에서 계산한다.
 */
export function plan_context_budget_append_json(remaining_chars: number, text: string): string;

/**
 * RAG context source citation/block/source id plan을 만든다.
 */
export function plan_context_sources_json(results_json: string, verifications_json: string, first_index: number, prefix: string): string;

/**
 * Query result 후보의 source path/heading 문자열을 포함해 MMR diversity index plan을 만든다.
 */
export function plan_diverse_result_indices_json(candidates_json: string, top_k: number): string;

/**
 * 청크가 없는 파일도 완료 상태로 유지할 file index record JSON plan을 만든다.
 */
export function plan_empty_file_index_record_json(entry_json: string, updated: number): string;

/**
 * evidence score 목록을 max-score, first-seen tie 순서로 candidate order plan으로 만든다.
 */
export function plan_evidence_candidate_order_json(scores_json: string, available_evidence_ids_json: string): string;

/**
 * vector entry metadata snapshot에서 file index record JSON plan을 만든다.
 */
export function plan_file_index_records_json(entries_json: string, updated: number): string;

/**
 * 확장 query keyword가 많이 나타나는 folder file sample index를 관련도 순으로 고른다.
 */
export function plan_folder_lexical_evidence_indices_json(query: string, samples_json: string, top_k: number, match_mode: string): string;

/**
 * folder mention에 포함할 markdown file index와 partial 여부를 `JSON` 문자열로 반환한다.
 */
export function plan_folder_mention_file_indices_json(folder_path: string, file_paths_json: string, max_files: number): string;

/**
 * 자연어 질문에서 직접 또는 한글 로마자 표기와 가까운 vault folder path를 고른다.
 */
export function plan_implicit_folder_query_paths_json(question: string, folder_paths_json: string): string;

/**
 * Tracks plugin-owned databases across vaults and retires generations unseen past a grace age.
 */
export function plan_inactive_indexed_db_cleanup_json(input_json: string): string;

/**
 * indexPending이 처리할 file index와 skip count plan을 만든다.
 */
export function plan_index_pending_files_json(file_paths_json: string, update_paths_json: string): string;

/**
 * Selects a bounded page of inactive databases owned by the current vault.
 */
export function plan_indexed_db_bounded_cleanup_json(database_names_json: string, active_names_json: string, owned_vault_prefixes_json: string, legacy_names_json: string, max_deletions: number): string;

/**
 * Plans one oldest-first bounded cache retention batch from a paged access snapshot.
 */
export function plan_indexed_db_bounded_retention_json(oldest_records_json: string, total_record_count: number, max_records: number, now: number, max_age_ms: number, max_deletions: number): string;

/**
 * Builds database names isolated by vault, storage contract, and embedding generation.
 *
 * `index_namespace`가 비어 있으면 기존 세대를 유지한다. 값이 있으면 청킹 계약이 바뀐 것이므로
 * 공통 원문·vector·BM25를 새 세대로 옮기고 임베딩 캐시는 재사용합니다.
 */
export function plan_indexed_db_storage_layout_json(plugin_id: string, vault_identity: string, legacy_vault_name: string, embedding_namespace: string, index_namespace: string): string;

/**
 * MCP server 후보 순서를 Rust에서 계산한다.
 */
export function plan_mcp_server_candidates_json(preferred_server_names_json: string, enabled_server_names_json: string, connection_statuses_json: string): string;

/**
 * retrieval provider 후보를 entry별로 병합할 numeric plan을 계산한다.
 */
export function plan_merged_retrieval_candidates(entry_indices: Uint32Array, source_codes: Uint8Array, source_scores: Float64Array, source_ranks: Float64Array): Float64Array;

/**
 * retrieval provider 후보를 `entry id`별로 병합할 numeric plan을 계산한다.
 */
export function plan_merged_retrieval_candidates_by_entry_id(entry_ids_json: string, source_codes: Uint8Array, source_scores: Float64Array, source_ranks: Float64Array): Float64Array;

/**
 * 토크나이저가 공개되지 않은 모델은 UTF-8 바이트를 보수적인 입력 토큰 상한으로 사용한다.
 */
export function plan_model_context_json(metadata: string): string;

/**
 * Plans whether one failed native-tool request may retry with the text compatibility protocol.
 */
export function plan_native_tool_compatibility_fallback_json(input_json: string): string;

/**
 * Obsidian이 제공한 메타데이터에서 모든 조건이 일치하는 파일 index를 선택한다.
 */
export function plan_native_vault_filtered_indices_json(files_json: string, filters_json: string): string;

/**
 * 이전 상위 후보와 최대 8개 본문을 결합한다. 본문은 다음 묶음으로 넘기지 않는다.
 */
export function plan_native_vault_lexical_batch_json(request_json: string, samples_json: string, previous_json: string): string;

/**
 * 파일 단위 lexical 일치 결과에서 가장 관련 있는 실제 행과 검증 상태를 반환한다.
 */
export function plan_native_vault_lexical_hit_json(query: string, content: string, match_mode: string): string;

/**
 * 구조 링크 그래프 한쪽의 경로를 정렬하고 중복 제거한 뒤 상한을 적용한다.
 */
export function plan_native_vault_link_paths_json(paths_json: string, limit: number): string;

/**
 * 정확한 파일 또는 폴더 prefix 범위의 허용 경로를 안정된 한 페이지로 선택한다.
 */
export function plan_native_vault_list_json(file_paths_json: string, path_prefix: string, cursor: number, limit: number): string;

/**
 * 1부터 시작하는 포함 범위 읽기를 문서 길이와 호출별 줄 예산에 맞게 제한한다.
 */
export function plan_native_vault_read_range_json(total_lines: number, start_line: number, end_line: number | null | undefined, max_lines: number): string;

/**
 * 여러 검색 변형의 후보를 문서별 reciprocal rank fusion 결과로 결합한다.
 */
export function plan_native_vault_search_rrf_json(candidates_json: string, query_count: number, limit: number): string;

/**
 * 잘림 후 남아 있는 검색 구간·메타데이터만 출처로 남기고 중복 ID는 검증된 값을 우선한다.
 */
export function plan_native_vault_source_citation_indices_json(hits: string, citations: string): string;

/**
 * 읽기 전용 볼트 통계 응답을 위해 Markdown 파일 크기를 집계한다.
 */
export function plan_native_vault_stats_json(file_sizes_json: string): string;

/**
 * 내장 읽기 전용 볼트 도구에 대한 모델 생성 요청 하나를 검증한다.
 */
export function plan_native_vault_tool_request_json(arguments_json: string): string;

/**
 * 현재 요청에 관련된 인덱스를 반환하며 네 번째 항목으로 조회 상한 초과를 알린다.
 */
export function plan_plugin_aware_indices_json(prompt: string, previous_json: string, plugins_json: string): string;

/**
 * Plans bounded cleanup for files whose names prove that this plugin owns them.
 */
export function plan_plugin_owned_file_maintenance_json(input_json: string): string;

/**
 * Vault prompt 생성용 summary를 `JSON` 계획 형태로 계산한다.
 */
export function plan_prompt_library_summary_json(entries_json: string): string;

/**
 * 모델 이름으로 한도를 추측하지 않는다. 없는 정보는 호스트에 생략해서 반환한다.
 */
export function plan_provider_model_details_json(provider: string, payload: string): string;

/**
 * 프로바이더 한 개의 표시 상태와 기능별 사용 가능 여부를 계산한다.
 *
 * 잘못된 입력은 빈 문자열을 반환해 호스트가 실패 닫힘으로 처리하도록 한다.
 */
export function plan_provider_profile_state_json(provider_json: string): string;

/**
 * 연결 정보 변경 후 저장된 모델 검증 상태를 안전한 미확인 상태로 되돌린다.
 *
 * 입력 상태가 wire contract를 벗어나면 빈 문자열을 반환한다.
 */
export function plan_provider_verification_reset_json(models_json: string): string;

/**
 * RAG query result score row를 `JSON` plan으로 계산한다.
 */
export function plan_query_result_score_json(input_json: string): string;

/**
 * Selects the files eligible for quiet recovery and one bounded smallest/oldest-first batch.
 */
export function plan_rag_automatic_recovery_batch_json(files_json: string): string;

/**
 * Plans automatic recovery from a canonical snapshot of eligible vault files.
 *
 * Invalid payloads return an empty string so the host wrapper can fail closed without
 * reimplementing policy in TypeScript.
 */
export function plan_rag_automatic_recovery_json(files_json: string, completed_fingerprint: string, attempt: number, pending_document_count: number): string;

/**
 * RAG 후보 파일 판정 전에 host content read가 필요한 file index를 계산한다.
 */
export function plan_rag_file_content_probe_indices_json(files_json: string, exclude_paths_json: string, exclude_exts_json: string): string;

/**
 * RAG 후보 file index와 file type summary 입력 row를 함께 계산한다.
 */
export function plan_rag_file_indexability_json(files_json: string, exclude_paths_json: string, exclude_exts_json: string, text_probes_json: string): string;

/**
 * RAG file type summary의 집계/정렬 plan을 `JSON` 문자열로 만든다.
 */
export function plan_rag_file_type_summary_json(files_json: string, no_extension_label: string): string;

/**
 * RAG 인덱싱의 예상 남은 시간을 계산합니다.
 */
export function plan_rag_indexing_eta_json(input_json: string): string;

/**
 * Plans one performance-guard state transition from deterministic JSON input.
 */
export function plan_rag_performance_guard_json(input_json: string): string;

/**
 * RAG index status summary와 update 대상 document plan을 만든다.
 */
export function plan_rag_status_json(input_json: string): string;

/**
 * Applies the storage health gate before reconciliation or generation deletion.
 */
export function plan_rag_storage_health_json(health_json: string): string;

/**
 * 참조 확장 대상으로 사용할 resolved file path index를 계산한다.
 */
export function plan_reference_file_indices_json(source_path: string, file_paths_json: string): string;

/**
 * Plans blocked tool calls after canonicalizing JSON argument object key order.
 */
export function plan_repeated_tool_call_indices_json(history_json: string, candidates_json: string, max_repeats: number, max_native_search_calls: number): string;

/**
 * LLM reranker provider에 넘길 system/user message content를 JSON으로 계획한다.
 */
export function plan_rerank_messages_json(question: string, candidates_json: string, max_text_chars: number): string;

/**
 * LLM reranker raw 응답에서 허용된 ranked id 목록만 JSON으로 반환한다.
 */
export function plan_rerank_response_json(raw_response: string, allowed_ids_json: string): string;

/**
 * RAG reranker ranked id 목록을 전체 result index 순서 plan으로 변환한다.
 */
export function plan_rerank_result_order_json(result_ids_json: string, ranked_ids_json: string): string;

/**
 * Validates answer-wide coverage claims against a derived coverage receipt.
 *
 * The returned action is `repair` when the answer claims unverified whole-file reading or an
 * insufficiently scoped negative conclusion.
 */
export function plan_research_answer_contract_json(input_json: string): string;

/**
 * Plans a bounded, stable local candidate selection from questions and inventory evidence.
 *
 * Invalid JSON or mismatched path/sample arrays return an empty string.
 */
export function plan_research_candidate_selection_json(input_json: string): string;

/**
 * Selects citations explicitly referenced by the final answer, or a bounded evidence fallback.
 */
export function plan_research_citation_indices_json(content: string, citation_ids_json: string, citation_paths_json: string, fallback_limit: number): string;

/**
 * Advances the global provider-attempt or retry-wait ledger while reserving future logical calls.
 */
export function plan_research_provider_ledger_transition_json(input_json: string): string;

/**
 * Plans one hard logical provider-request ceiling without changing evidence-batch semantics.
 */
export function plan_research_provider_request_budget_json(input_json: string): string;

/**
 * Classifies a provider failure and returns a bounded retry plan for research requests.
 */
export function plan_research_request_failure_json(message: string, status: number, failed_attempt: number, retry_after_ms: number): string;

/**
 * Groups summary items into stable bounded reduce batches without dropping any item.
 */
export function plan_research_summary_batches_json(item_sizes_json: string, max_items: number, max_chars: number): string;

/**
 * 현재 내용 기반 청크 ID와 일치하는 저장 벡터의 이관 인덱스를 반환합니다.
 */
export function plan_source_chunk_import_indices_json(input_json: string): string;

/**
 * 파일 형식별 원문 경계와 내용 기반 청크 ID를 반환합니다.
 */
export function plan_source_chunks_json(path: string, extension: string, content: string, max_size: number, overlap: number): string;

/**
 * 제목·날짜·저자·유형의 원문 행과 날짜 충돌 상태를 반환한다.
 */
export function plan_source_metadata_json(content: string): string;

/**
 * 공통 원문·BM25·임베딩의 준비 상태를 파일별로 반환합니다.
 */
export function plan_source_processing_json(input_json: string): string;

/**
 * assistant 답변에서 출처 참조와 path alias plan을 `JSON` 문자열로 만든다.
 */
export function plan_source_references_json(content: string): string;

/**
 * source validation에 필요한 verified citation과 vault alias probe 입력을 `JSON` 문자열로 만든다.
 */
export function plan_source_validation_inputs_json(references_json: string, citation_ids_json: string, citation_paths_json: string, citation_statuses_json: string): string;

/**
 * 출처 참조 plan과 host boundary 검증 결과를 warning key plan으로 합친다.
 */
export function plan_source_validation_warnings_json(references_json: string, verified_citation_ids_json: string, verified_paths_json: string, existing_aliases_json: string): string;

/**
 * Plans a bounded set difference between persisted source paths and current vault paths.
 */
export function plan_stale_index_source_paths_json(indexed_paths_json: string, valid_paths_json: string, max_deletions: number): string;

/**
 * structural retrieval에서 같은 heading 주변 entry index plan을 JSON으로 반환한다.
 */
export function plan_structural_heading_neighbors_json(seeds_json: string, entries_json: string, headings_json: string): string;

/**
 * structural retrieval에서 link/backlink target path plan을 JSON으로 반환한다.
 */
export function plan_structural_linked_paths_json(seed_paths_json: string, edges_json: string): string;

/**
 * 호스트 메타데이터로 자동완성과 정확한 태그·하위 태그 파일 범위를 계산한다.
 */
export function plan_tag_mentions_json(file_tags_json: string, query: string, max_files: number): string;

/**
 * citation 배열에서 본문을 제외한 bounded source reference JSON 배열만 만든다.
 */
export function plan_tool_result_source_references_json(citations_json: string): string;

/**
 * 오래된 도구 결과는 출처·범위·오류와 질문에 맞는 원문 구간을 보존해 축약한다.
 */
export function plan_tool_result_summary_json(content: string, question: string, max_bytes: number): string;

/**
 * vault link target의 path candidate와 basename fallback을 `JSON` 문자열로 반환한다.
 */
export function plan_vault_link_candidates_json(source_path: string, raw_target: string): string;

/**
 * vault link basename fallback으로 선택할 markdown file index를 `JSON` 문자열로 반환한다.
 */
export function plan_vault_link_fallback_index_json(fallback_basename: string, basenames_json: string): string;

/**
 * 모델이 제안한 검색어는 제한된 데이터로만 사용하며 원문 질문을 대체하지 않는다.
 */
export function plan_vault_query_expansion_json(question: string, response: string): string;

/**
 * Plans stale file-index paths from a bounded host page.
 */
export function plan_vector_file_index_batch_json(records_json: string, embedding_provider: string, embedding_model: string, max_deletions: number): string;

/**
 * Plans stale vector ids from a bounded metadata-only host page.
 */
export function plan_vector_record_batch_json(records_json: string, embedding_provider: string, embedding_model: string, expected_dimension: number, max_deletions: number): string;

/**
 * 파일 경계에 맞는 벡터 검색 범위의 인덱스를 선택한다.
 */
export function plan_vector_scope_indices_json(paths_json: string, prefixes_json: string): string;

/**
 * vector store add mutation plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_add_json(existing_ids_json: string, incoming_ids_json: string): string;

/**
 * vector store file-path lookup index plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_lookup_by_file_paths_json(entry_file_paths_json: string, requested_file_paths_json: string): string;

/**
 * vector store id lookup index plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_lookup_by_ids_json(entry_ids_json: string, requested_ids_json: string): string;

/**
 * vector store file removal mutation plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_remove_file_json(existing_file_paths_json: string, file_path: string): string;

/**
 * vector store file replacement mutation plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_replace_file_json(existing_file_paths_json: string, file_path: string, incoming_count: number): string;

/**
 * vector store stats와 indexed file path plan을 `JSON` 문자열로 만든다.
 */
export function plan_vector_store_stats_json(file_paths_json: string, now: number): string;

/**
 * Returns the Rust-owned delay for a recovery attempt, or zero when the session is exhausted.
 */
export function rag_automatic_recovery_delay_ms(attempt: number): number;

/**
 * flattened vector matrix에서 top-k row index와 score 쌍을 반환한다.
 */
export function rank_top_k_pairs(query: Float64Array, vectors: Float64Array, dimensions: number, top_k: number): Float64Array;

/**
 * exact top-k와 approximate top-k index 목록으로 recall@k를 계산한다.
 */
export function recall_at_k(exact_indices: Uint32Array, approximate_indices: Uint32Array, top_k: number): number;

/**
 * flattened vector matrix와 cluster assignment로 centroid matrix를 다시 계산한다.
 */
export function recompute_centroids(vectors: Float64Array, assignments: Uint32Array, previous_centroids: Float64Array, dimensions: number): Float64Array;

/**
 * retrieval source rank map에서 RRF score를 계산한다.
 */
export function rrf_score_or_nan(source_codes: Uint8Array, ranks: Float64Array, bm25_weight: number): number;

/**
 * Query result 후보에서 기존 `TypeScript` MMR diversity selection과 같은 index를 고른다.
 */
export function select_diverse_indices(scores: Float64Array, vectors: Float64Array, dimensions: number, source_keys: Uint32Array, heading_keys: Uint32Array, top_k: number): Float64Array;

/**
 * Context7 검색에서 이름이 일치하는 단일 문서 ID만 선택한다.
 * 동명이거나 모호한 후보는 임의로 첫 결과를 선택하지 않는다.
 */
export function select_plugin_context7_library_id(plugin_json: string, result_json: string): string;

/**
 * RAG 후보 score 목록에서 최종 relevance gate를 통과한 원본 result index를 score 내림차순으로 반환한다.
 */
export function select_relevant_result_indices(config: Float64Array, source_offsets: Uint32Array, source_codes: Uint8Array, result_values: Float64Array): Float64Array;

/**
 * MCP 경로 힌트가 필요한지 판정한다.
 */
export function should_append_mcp_path_hint_rust(command: string, error_message: string): boolean;

/**
 * Context7를 암묵적으로 제공할 만큼 programming intent가 분명한지 판정한다.
 */
export function should_offer_context7_for_prompt(prompt: string): boolean;

/**
 * 비동기 처리 결과가 현재 원문 revision에 속하는지 판정합니다.
 */
export function source_revision_matches(expected_path: string, current_path: string, expected_hash: string, current_hash: string, revision_numbers: Float64Array): boolean;

/**
 * `<think>`류 태그를 reasoning/content로 분할한다.
 */
export function split_reasoning_tags_json(content: string): string;

/**
 * Removes only complete compatibility tool-call blocks from visible answer text.
 */
export function strip_compatibility_tool_calls(content: string): string;

/**
 * 텍스트의 `BM25` term frequency map을 `JSON` 문자열로 반환한다.
 */
export function token_frequencies_json(text: string): string;

/**
 * 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
 */
export function tokenize_json(text: string): string;

/**
 * RAG 제외 확장자 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
 */
export function validate_exclude_extension_input_json(input: string, existing_exts_json: string): string;

/**
 * RAG 제외 경로 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
 * `path-missing` 경고는 host(상태 검사 필요)에서 처리한다.
 */
export function validate_exclude_path_input_json(input: string, existing_paths_json: string): string;

/**
 * MCP stdio server 설정 JSON을 스키마 기반으로 검증한다.
 */
export function validate_mcp_json(mcp_json_text: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bm25runtimeindex_free: (a: number, b: number) => void;
    readonly __wbg_ivfruntimeindex_free: (a: number, b: number) => void;
    readonly __wbg_vectorruntimeindex_free: (a: number, b: number) => void;
    readonly analyze_retrieval_sources: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly assign_vector_clusters: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly bm25_score_pairs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly bm25runtimeindex_add_document: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly bm25runtimeindex_add_documents_json: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bm25runtimeindex_add_new_document: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly bm25runtimeindex_from_json: (a: number, b: number, c: number) => number;
    readonly bm25runtimeindex_is_ready: (a: number) => number;
    readonly bm25runtimeindex_is_tokenizer_current: (a: number, b: number) => number;
    readonly bm25runtimeindex_new: (a: number) => number;
    readonly bm25runtimeindex_remove_document: (a: number, b: number, c: number, d: number) => void;
    readonly bm25runtimeindex_remove_source: (a: number, b: number, c: number, d: number) => void;
    readonly bm25runtimeindex_search_json: (a: number, b: number, c: number) => [number, number];
    readonly bm25runtimeindex_search_top_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly bm25runtimeindex_source_path_for_doc: (a: number, b: number, c: number) => [number, number];
    readonly bm25runtimeindex_to_json: (a: number) => [number, number];
    readonly bm25runtimeindex_tokenizer_version: (a: number) => number;
    readonly bm25runtimeindex_total_docs: (a: number) => number;
    readonly build_initial_centroids: (a: number, b: number, c: number, d: number) => [number, number];
    readonly chunk_markdown_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly chunk_plain_text_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly classify_mcp_tool_error_json: (a: number, b: number) => [number, number];
    readonly collect_candidate_reasons: (a: number, b: number, c: number, d: number) => [number, number];
    readonly core_version: () => [number, number];
    readonly cosine_similarity_or_nan: (a: number, b: number, c: number, d: number) => number;
    readonly count_files_by_extensions_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly count_keyword_matches: (a: number, b: number, c: number, d: number) => number;
    readonly create_content_hash: (a: number, b: number) => [number, number];
    readonly create_context_preview: (a: number, b: number) => [number, number];
    readonly create_entries_fingerprint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly extract_structured_reasoning: (a: number, b: number) => [number, number];
    readonly extract_vault_links_json: (a: number, b: number) => [number, number];
    readonly format_mcp_connection_error: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly format_mcp_json: (a: number, b: number) => [number, number];
    readonly get_mcp_connection_state_rust: (a: number, b: number, c: number, d: number) => [number, number];
    readonly is_excluded_ext_json: (a: number, b: number, c: number, d: number) => number;
    readonly is_excluded_path: (a: number, b: number, c: number, d: number) => number;
    readonly is_mcp_tool_name_available: (a: number, b: number, c: number, d: number) => number;
    readonly is_mcp_tool_result_empty_json: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly is_protected_rag_document_extension_json: (a: number, b: number) => number;
    readonly is_rag_frontmatter_excluded_json: (a: number, b: number) => number;
    readonly is_recommendable_exclude_extension_json: (a: number, b: number) => number;
    readonly is_relevant_result: (a: number, b: number, c: number, d: number) => number;
    readonly ivfruntimeindex_cluster_count: (a: number) => number;
    readonly ivfruntimeindex_dimensions: (a: number) => number;
    readonly ivfruntimeindex_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly ivfruntimeindex_query: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly ivfruntimeindex_row_count: (a: number) => number;
    readonly normalize_exclude_extension_json: (a: number, b: number) => [number, number];
    readonly normalize_mcp_tool_result_json: (a: number, b: number) => [number, number];
    readonly normalize_reasoning_chunk_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly parse_mcp_tool_arguments_json: (a: number, b: number) => [number, number];
    readonly parse_mention_candidates_json: (a: number, b: number) => [number, number];
    readonly plan_assistant_response_classification_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_bm25_candidate_resolution_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_bm25_hit_lookup_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_bm25_index_add_document_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly plan_bm25_index_remove_document_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_bm25_index_remove_source_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_bm25_search_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_bm25_source_lookups_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_chat_context_mentions_json: (a: number, b: number) => [number, number];
    readonly plan_chat_messages_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_chat_meta_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_chat_save_metadata_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_context_budget_append_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_context_sources_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_diverse_result_indices_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_empty_file_index_record_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_evidence_candidate_order_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_file_index_records_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_folder_lexical_evidence_indices_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_folder_mention_file_indices_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_implicit_folder_query_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_index_pending_files_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_mcp_server_candidates_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_merged_retrieval_candidates: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_merged_retrieval_candidates_by_entry_id: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_prompt_library_summary_json: (a: number, b: number) => [number, number];
    readonly plan_query_result_score_json: (a: number, b: number) => [number, number];
    readonly plan_rag_file_content_probe_indices_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_rag_file_indexability_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_rag_file_type_summary_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_rag_indexing_eta_json: (a: number, b: number) => [number, number];
    readonly plan_rag_status_json: (a: number, b: number) => [number, number];
    readonly plan_reference_file_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_rerank_messages_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_rerank_response_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_rerank_result_order_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_source_references_json: (a: number, b: number) => [number, number];
    readonly plan_source_validation_inputs_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_source_validation_warnings_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_structural_heading_neighbors_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_structural_linked_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vault_link_candidates_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vault_link_fallback_index_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_scope_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_add_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_lookup_by_file_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_lookup_by_ids_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_remove_file_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_replace_file_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_vector_store_stats_json: (a: number, b: number, c: number) => [number, number];
    readonly rank_top_k_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly recall_at_k: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly recompute_centroids: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly rrf_score_or_nan: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly select_diverse_indices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly select_relevant_result_indices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly should_append_mcp_path_hint_rust: (a: number, b: number, c: number, d: number) => number;
    readonly should_offer_context7_for_prompt: (a: number, b: number) => number;
    readonly source_revision_matches: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly split_reasoning_tags_json: (a: number, b: number) => [number, number];
    readonly token_frequencies_json: (a: number, b: number) => [number, number];
    readonly tokenize_json: (a: number, b: number) => [number, number];
    readonly validate_exclude_extension_input_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly validate_exclude_path_input_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly validate_mcp_json: (a: number, b: number) => [number, number];
    readonly vectorruntimeindex_dimensions: (a: number) => number;
    readonly vectorruntimeindex_new: (a: number, b: number, c: number) => number;
    readonly vectorruntimeindex_rank_top_k: (a: number, b: number, c: number, d: number) => [number, number];
    readonly vectorruntimeindex_rank_top_k_filtered: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly vectorruntimeindex_row_count: (a: number) => number;
    readonly derive_native_tool_coverage_receipt_json: (a: number, b: number) => [number, number];
    readonly derive_research_coverage_receipt_json: (a: number, b: number) => [number, number];
    readonly embedding_gemma_inputs_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly local_model_range_matches: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly plan_research_answer_contract_json: (a: number, b: number) => [number, number];
    readonly plan_research_candidate_selection_json: (a: number, b: number) => [number, number];
    readonly plan_research_provider_ledger_transition_json: (a: number, b: number) => [number, number];
    readonly plan_research_provider_request_budget_json: (a: number, b: number) => [number, number];
    readonly find_reusable_prompt: (a: number, b: number, c: number, d: number) => number;
    readonly is_local_settings_provider: (a: number, b: number, c: number, d: number) => number;
    readonly is_valid_settings_folder: (a: number, b: number) => number;
    readonly parse_settings_number: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly plan_chat_model_state_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_chatgpt_json: (a: number, b: number) => [number, number];
    readonly plan_plugin_aware_indices_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_provider_profile_state_json: (a: number, b: number) => [number, number];
    readonly plan_provider_verification_reset_json: (a: number, b: number) => [number, number];
    readonly plan_tool_result_source_references_json: (a: number, b: number) => [number, number];
    readonly select_plugin_context7_library_id: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_agentic_tool_turn_json: (a: number, b: number) => [number, number];
    readonly plan_model_context_json: (a: number, b: number) => [number, number];
    readonly plan_provider_model_details_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_native_vault_link_paths_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_native_vault_list_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_native_vault_read_range_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_native_vault_search_rrf_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_native_vault_source_citation_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_native_vault_stats_json: (a: number, b: number) => [number, number];
    readonly plan_native_vault_tool_request_json: (a: number, b: number) => [number, number];
    readonly plan_rag_automatic_recovery_batch_json: (a: number, b: number) => [number, number];
    readonly plan_rag_automatic_recovery_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_rag_storage_health_json: (a: number, b: number) => [number, number];
    readonly plan_source_metadata_json: (a: number, b: number) => [number, number];
    readonly rag_automatic_recovery_delay_ms: (a: number) => number;
    readonly is_scoped_vault_research_intent: (a: number, b: number) => number;
    readonly is_whole_vault_research_intent: (a: number, b: number) => number;
    readonly plan_repeated_tool_call_indices_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_research_citation_indices_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_research_request_failure_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_research_summary_batches_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_chat_evidence_json: (a: number, b: number) => [number, number];
    readonly plan_chat_request_json: (a: number, b: number) => [number, number];
    readonly plan_chat_unique_result_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_source_chunk_import_indices_json: (a: number, b: number) => [number, number];
    readonly plan_source_chunks_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_tool_result_summary_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_vault_query_expansion_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_compatibility_tool_calls_json: (a: number, b: number) => [number, number];
    readonly plan_native_tool_compatibility_fallback_json: (a: number, b: number) => [number, number];
    readonly plan_native_vault_filtered_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_native_vault_lexical_batch_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_rag_performance_guard_json: (a: number, b: number) => [number, number];
    readonly plan_tag_mentions_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly strip_compatibility_tool_calls: (a: number, b: number) => [number, number];
    readonly create_indexed_db_record_key: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_inactive_indexed_db_cleanup_json: (a: number, b: number) => [number, number];
    readonly plan_indexed_db_bounded_cleanup_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly plan_indexed_db_bounded_retention_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_indexed_db_storage_layout_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly plan_native_vault_lexical_hit_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_plugin_owned_file_maintenance_json: (a: number, b: number) => [number, number];
    readonly plan_source_processing_json: (a: number, b: number) => [number, number];
    readonly plan_stale_index_source_paths_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_vector_file_index_batch_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_vector_record_batch_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
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
