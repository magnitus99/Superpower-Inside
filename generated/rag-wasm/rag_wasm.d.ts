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
 * `GraphRAG` relation edge를 무방향 endpoint pair 기준으로 집계한다.
 */
export function aggregate_graph_edges_flat(source_indices: Uint32Array, target_indices: Uint32Array, confidences: Float64Array, node_count: number): Float64Array;

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
 * `GraphRAG` entity id를 기존 resolver 규칙으로 만든다.
 */
export function create_entity_id(ontology_schema_id: string, type_id: string, canonical_name: string): string;

/**
 * 벡터 entry snapshot 배열 fingerprint를 생성한다.
 */
export function create_entries_fingerprint(entry_ids_json: string, content_hashes_json: string, indexed_ats_json: string, vector_lengths_json: string): string;

/**
 * `GraphRAG` record id를 기존 extraction ID 규칙으로 만든다.
 */
export function create_graph_id(parts: string): string;

/**
 * Creates a collision-resistant deterministic key for one namespaced `IndexedDB` record.
 */
export function create_indexed_db_record_key(namespace: string, value: string): string;

/**
 * `GraphRAG` community detection의 node assignment와 modularity를 계산한다.
 */
export function detect_communities_flat(source_indices: Uint32Array, target_indices: Uint32Array, weights: Float64Array, node_count: number, max_iterations: number): Float64Array;

/**
 * `GraphRAG` string edge snapshot에서 community assignment JSON plan을 만든다.
 */
export function detect_communities_from_edges_json(edges_json: string, max_iterations: number): string;

/**
 * `GraphRAG` string edge snapshot에서 연결성 refinement를 포함한 계층 community plan을 만든다.
 */
export function detect_leiden_hierarchy_from_edges_json(edges_json: string, max_iterations: number, max_levels: number): string;

/**
 * `GraphRAG` LLM 응답에서 JSON object 텍스트를 추출한다. 실패하면 빈 문자열을 반환한다.
 */
export function extract_json_object_text(raw_response: string): string;

/**
 * `delta` 객체의 구조화 reasoning 필드를 추출한다.
 */
export function extract_structured_reasoning(delta_json: string): string;

/**
 * vault 내부 참조 링크를 추출하고 `JSON` 문자열로 반환한다.
 */
export function extract_vault_links_json(content: string): string;

/**
 * 질문과 entity name 목록에서 언급된 `GraphRAG` entity index/score 쌍을 찾는다.
 */
export function find_mentioned_entity_matches(question: string, ontology_schema_id: string, entity_schema_ids: string, canonical_names: string, aliases_by_entity: string, entity_hints: string): Float64Array;

/**
 * MCP JSON 설정을 검증 가능한 JSON 문자열로 다시 포맷한다.
 */
export function format_mcp_json(mcp_json_text: string): string;

/**
 * MCP 연결 상태를 계산한다.
 */
export function get_mcp_connection_state_rust(total_count: number, connected_count: number, failed_count: number, is_connecting: boolean): string;

/**
 * 현재 Graph extraction parser/normalizer wire contract version을 반환한다.
 */
export function graph_extraction_contract_version(): number;

/**
 * RAG hybrid score를 계산한다.
 */
export function hybrid_score_or_nan(combined_base: number, rrf_score: number, source_prior: number, source_evidence_score: number, best_evidence_rank: number, source_codes: Uint8Array): number;

/**
 * 파일 경로 확장자가 제외 대상 목록에 있으면 `true`를 반환한다.
 */
export function is_excluded_ext_json(file_path: string, extension_keys_json: string): boolean;

/**
 * vault path가 제외 pattern 목록에 매칭되는지 확인한다.
 */
export function is_excluded_path(file_path: string, patterns: string): boolean;

/**
 * `GraphRAG` extraction cache snapshot이 요청 key와 일치하는지 판정한다.
 */
export function is_graph_extraction_cache_hit_json(cached_json: string, input_json: string): string;

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
 * RAG 제외 가능한 확장자인지 확인한다.
 */
export function is_recommendable_exclude_extension_json(extension: string): boolean;

/**
 * RAG 후보가 최종 context 후보로 유지될 만큼 관련 있는지 판단한다.
 */
export function is_relevant_result(config: Float64Array, source_codes: Uint8Array): boolean;

/**
 * 두 entity id 쌍이 순서와 무관하게 같은 대상을 가리키는지 판정한다.
 */
export function is_same_graph_entity_pair(first_left: string, first_right: string, second_left: string, second_right: string): boolean;

/**
 * `GraphRAG` entity 이름을 비교 가능한 형태로 정규화한다.
 */
export function normalize_entity_name(name: string): string;

/**
 * 확장자 문자열을 RAG 제외 설정 계약에 맞게 정규화한다.
 */
export function normalize_exclude_extension_json(extension: string): string;

/**
 * `GraphRAG` LLM 추출 JSON payload를 저장 가능한 graph fact payload로 정규화한다.
 */
export function normalize_extracted_graph_payload_json(json_text: string): string;

/**
 * `GraphRAG` extraction confidence를 `[0, 1]` 범위로 정규화한다.
 */
export function normalize_graph_confidence_or_default(confidence: number): number;

/**
 * `GraphRAG` extraction 이름을 비교 가능한 형태로 정규화한다.
 */
export function normalize_graph_name(name: string): string;

/**
 * fact evidence span을 source 길이 안의 안정적인 pair로 정규화한다.
 */
export function normalize_graph_source_spans_flat(starts: Uint32Array, ends: Uint32Array, content_length: number): Uint32Array;

/**
 * MCP tool 실행 결과에서 표시/모델 텍스트 추출 계약을 계산한다.
 */
export function normalize_mcp_tool_result_json(result_json: string): string;

/**
 * 구조화 reasoning과 태그 reasoning을 병합해 content/reasoning을 만들고 JSON으로 반환한다.
 */
export function normalize_reasoning_chunk_json(content: string, reasoning: string): string;

/**
 * `GraphRAG` LLM raw 응답을 graph extraction parse 결과로 변환한다.
 */
export function parse_extracted_graph_payload_json(raw_response: string): string;

/**
 * MCP tool 실행 인자 문자열을 TypeScript 호스트 경계 계약으로 정규화한다.
 */
export function parse_mcp_tool_arguments_json(arguments_text: string): string;

/**
 * 채팅 입력의 raw mention 후보를 추출하고 `JSON` 문자열로 반환한다.
 */
export function parse_mention_candidates_json(content: string): string;

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
 * 저장된 chat session markdown body에서 current-format message plan을 만든다.
 */
export function plan_chat_messages_json(body: string, now_timestamp: number, now_iso: string, decode_failure_label: string): string;

/**
 * 저장된 chat session markdown에서 list metadata plan을 만든다.
 */
export function plan_chat_meta_json(content: string, fallback_title: string, fallback_created_iso: string): string;

/**
 * 저장할 chat session metadata plan을 만든다.
 */
export function plan_chat_save_metadata_json(messages_json: string, existing_created: string, option_title: string, now_iso: string): string;

/**
 * claim record snapshot에서 evidence score JSON plan을 만든다.
 */
export function plan_claim_evidence_scores_json(claims_json: string): string;

/**
 * Context budget append 결과를 Rust에서 계산한다.
 */
export function plan_context_budget_append_json(remaining_chars: number, text: string): string;

/**
 * `GraphRAG` virtual source verification plan을 만든다.
 */
export function plan_context_graph_verification_json(file_path: string, unsupported_detail: string): string;

/**
 * RAG context source citation/block/source id plan을 만든다.
 */
export function plan_context_sources_json(results_json: string, verifications_json: string, first_index: number, prefix: string): string;

/**
 * Query result 후보의 source path/heading 문자열을 포함해 MMR diversity index plan을 만든다.
 */
export function plan_diverse_result_indices_json(candidates_json: string, top_k: number): string;

/**
 * `GraphRAG` entity resolution 후보 점수에서 최종 merge plan을 계산한다.
 */
export function plan_entity_resolution_json(input_json: string): string;

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
export function plan_folder_lexical_evidence_indices_json(query: string, samples_json: string, top_k: number): string;

/**
 * folder mention에 포함할 markdown file index와 partial 여부를 `JSON` 문자열로 반환한다.
 */
export function plan_folder_mention_file_indices_json(folder_path: string, file_paths_json: string, max_files: number): string;

/**
 * Graph extraction claim entity name을 entity id 목록으로 해석한다.
 */
export function plan_graph_claim_entity_ids_json(entity_names_json: string, lookup_records_json: string): string;

/**
 * `GraphRAG` community replacement에서 삭제할 기존 community id plan을 계산한다.
 */
export function plan_graph_community_replacement_delete_ids_json(communities_json: string, ontology_schema_id: string): string;

/**
 * Graph community summarizer의 entity/relation/claim grouping index plan을 계산한다.
 */
export function plan_graph_community_summary_groups_json(assignments_json: string, entity_ids_json: string, relations_json: string, claims_json: string, community_ids_json: string): string;

/**
 * RAG vector indexing progress snapshot에서 ETA plan JSON을 만든다.
 */
export function plan_graph_deletion_indices_json(record_keys_json: string, requested_keys_json: string): string;

/**
 * `GraphRAG` entity/relation string snapshot에서 relation edge record JSON plan을 만든다.
 */
export function plan_graph_edge_records_json(entity_ids_json: string, relation_source_ids_json: string, relation_target_ids_json: string, confidences_json: string): string;

/**
 * `GraphRAG` entity upsert merge field plan을 만든다.
 */
export function plan_graph_entity_merge_json(existing_json: string, next_json: string): string;

/**
 * ordered evidence score와 evidence snapshot에서 후보 lookup plan을 만든다.
 */
export function plan_graph_evidence_candidate_lookup_json(scores_json: string, evidence_json: string): string;

/**
 * Graph evidence candidate를 최종 vector entry candidate로 해석한다.
 */
export function plan_graph_evidence_entry_candidates_json(candidate_entry_ids_json: string, entries_json: string, candidate_limit: number): string;

/**
 * context overflow가 난 extraction unit을 더 작은 Markdown 경계 child unit으로 나눈다.
 */
export function plan_graph_extraction_child_units_json(content: string, split_depth: number): string;

/**
 * Graph extraction provider 실패의 재시도 및 회로 차단 정책을 계산한다.
 */
export function plan_graph_extraction_failure_json(message: string, status: number, attempt_count: number, consecutive_failures: number, now_ms: number, retry_after_ms: number): string;

/**
 * `GraphRAG` mention context에서 표시할 entity/relation index plan을 만든다.
 */
export function plan_graph_mention_context_json(mention_names_json: string, entities_json: string, relations_json: string): string;

/**
 * `GraphRAG` query mode와 planner 결과에서 실행 action을 계산한다.
 */
export function plan_graph_query_execution_json(configured_mode: string, planned_mode: string, evidence_first: boolean): string;

/**
 * deterministic `GraphRAG` query plan을 `JSON` 문자열로 반환한다.
 */
export function plan_graph_query_json(question: string): string;

/**
 * `GraphRAG` LLM planner raw 응답을 graph query plan JSON으로 변환한다.
 */
export function plan_graph_query_response_json(raw_response: string, fallback_question: string): string;

/**
 * `GraphRAG`가 처리할 markdown file path 목록을 입력 순서대로 계산한다.
 */
export function plan_graph_rag_markdown_file_paths_json(file_paths_json: string): string;

/**
 * `GraphRAG` indexing run에서 candidate/selected file path 목록을 계산한다.
 */
export function plan_graph_rag_run_file_selection_json(input_json: string): string;

/**
 * `GraphRAG` status 계산에 필요한 vector entry id lookup plan을 만든다.
 */
export function plan_graph_rag_status_entry_lookups_json(evidence_entry_ids_json: string, cache_entry_ids_json: string): string;

/**
 * `GraphRAG` status에 사용할 vector entry snapshot plan을 만든다.
 */
export function plan_graph_rag_status_entry_snapshot_json(entries_json: string): string;

/**
 * `GraphRAG` status에 사용할 candidate file snapshot plan을 만든다.
 */
export function plan_graph_rag_status_file_snapshot_json(file_records_json: string, indexed_file_paths_json: string): string;

/**
 * `GraphRAG` index status summary plan을 만든다.
 */
export function plan_graph_rag_status_json(input_json: string): string;

/**
 * `GraphRAG` store에서 prune할 unsupported graph file path 목록을 계산한다.
 */
export function plan_graph_rag_unsupported_prune_paths_json(evidence_json: string, rejected_facts_json: string): string;

/**
 * Graph extraction relation source/target name을 accepted entity index pair로 해석한다.
 */
export function plan_graph_relation_endpoint_indices_json(relations_json: string, lookup_records_json: string, entity_count: number): string;

/**
 * `GraphRAG` community schema id matching index plan을 계산한다.
 */
export function plan_graph_schema_community_indices_json(community_schema_ids_json: string, ontology_schema_id: string): string;

/**
 * `GraphRAG` relation schema id matching index plan을 계산한다.
 */
export function plan_graph_schema_relation_indices_json(relation_schema_ids_json: string, ontology_schema_id: string): string;

/**
 * 자연어 질문에서 직접 또는 한글 로마자 표기와 가까운 vault folder path를 고른다.
 */
export function plan_implicit_folder_query_paths_json(question: string, folder_paths_json: string): string;

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
 */
export function plan_indexed_db_storage_layout_json(plugin_id: string, vault_identity: string, legacy_vault_name: string, embedding_namespace: string): string;

/**
 * `GraphRAG` record snapshot에서 local evidence score `JSON` plan을 만든다.
 */
export function plan_local_evidence_scores_json(matches_json: string, relations_json: string, claims_json: string, traversal_depth: number): string;

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
 * Vault prompt 생성용 summary를 `JSON` 계획 형태로 계산한다.
 */
export function plan_prompt_library_summary_json(entries_json: string): string;

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
 * graph store record key snapshot에서 삭제할 record index plan을 만든다.
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
 * structural retrieval에서 같은 heading 주변 entry index plan을 JSON으로 반환한다.
 */
export function plan_structural_heading_neighbors_json(seeds_json: string, entries_json: string, headings_json: string): string;

/**
 * structural retrieval에서 link/backlink target path plan을 JSON으로 반환한다.
 */
export function plan_structural_linked_paths_json(seed_paths_json: string, edges_json: string): string;

/**
 * vault link target의 path candidate와 basename fallback을 `JSON` 문자열로 반환한다.
 */
export function plan_vault_link_candidates_json(source_path: string, raw_target: string): string;

/**
 * vault link basename fallback으로 선택할 markdown file index를 `JSON` 문자열로 반환한다.
 */
export function plan_vault_link_fallback_index_json(fallback_basename: string, basenames_json: string): string;

/**
 * Plans stale file-index paths from a bounded host page.
 */
export function plan_vector_file_index_batch_json(records_json: string, embedding_provider: string, embedding_model: string, max_deletions: number): string;

/**
 * Plans stale vector ids from a bounded metadata-only host page.
 */
export function plan_vector_record_batch_json(records_json: string, embedding_provider: string, embedding_model: string, expected_dimension: number, max_deletions: number): string;

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
 * `GraphRAG` store pruning에서 삭제/업데이트할 record index plan을 계산한다.
 */
export function prune_graph_indexes_json(config: Uint32Array, indices: Uint32Array, wire_values: string): string;

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
 * `GraphRAG` entity 병합 이후 참조 id를 교체하고 필요하면 순서를 보존해 중복 제거한다.
 */
export function rewrite_graph_entity_references_json(references_json: string, candidate_entity_id: string, existing_entity_id: string, deduplicate: boolean): string;

/**
 * retrieval source rank map에서 RRF score를 계산한다.
 */
export function rrf_score_or_nan(source_codes: Uint8Array, ranks: Float64Array, bm25_weight: number): number;

/**
 * `GraphRAG` record id part를 기존 extraction ID 규칙으로 정규화한다.
 */
export function sanitize_graph_id_part(part: string): string;

/**
 * `GraphRAG` entity merge score를 계산한다.
 */
export function score_entity_match_or_nan(candidate_names: string, existing_names: string, descriptions: string, evidence_ids: string, same_type: boolean, embedding_score: number): number;

/**
 * `GraphRAG` local/evidence-first evidence score pair를 계산한다.
 */
export function score_local_evidence_pairs(config: Uint32Array, indices: Uint32Array, values: Float64Array): Float64Array;

/**
 * Query result 후보에서 기존 `TypeScript` MMR diversity selection과 같은 index를 고른다.
 */
export function select_diverse_indices(scores: Float64Array, vectors: Float64Array, dimensions: number, source_keys: Uint32Array, heading_keys: Uint32Array, top_k: number): Float64Array;

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
 * `GraphRAG` runtime 재구성 여부를 판정한다.
 */
export function should_rebuild_graph_runtime_for_graph_status(graph_rag_enabled: boolean, graph_rag_model: string, previous_status_state: string, next_status_state: string, graph_provider_attached: boolean): boolean;

/**
 * `<think>`류 태그를 reasoning/content로 분할한다.
 */
export function split_reasoning_tags_json(content: string): string;

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
    readonly aggregate_graph_edges_flat: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly analyze_retrieval_sources: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly assign_vector_clusters: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly bm25_score_pairs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly bm25runtimeindex_add_document: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
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
    readonly create_entity_id: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly create_entries_fingerprint: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly create_graph_id: (a: number, b: number) => [number, number];
    readonly detect_communities_flat: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly detect_communities_from_edges_json: (a: number, b: number, c: number) => [number, number];
    readonly detect_leiden_hierarchy_from_edges_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly extract_json_object_text: (a: number, b: number) => [number, number];
    readonly extract_structured_reasoning: (a: number, b: number) => [number, number];
    readonly extract_vault_links_json: (a: number, b: number) => [number, number];
    readonly find_mentioned_entity_matches: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly format_mcp_json: (a: number, b: number) => [number, number];
    readonly get_mcp_connection_state_rust: (a: number, b: number, c: number, d: number) => [number, number];
    readonly hybrid_score_or_nan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly is_excluded_ext_json: (a: number, b: number, c: number, d: number) => number;
    readonly is_excluded_path: (a: number, b: number, c: number, d: number) => number;
    readonly is_graph_extraction_cache_hit_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly is_mcp_tool_name_available: (a: number, b: number, c: number, d: number) => number;
    readonly is_mcp_tool_result_empty_json: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly is_protected_rag_document_extension_json: (a: number, b: number) => number;
    readonly is_recommendable_exclude_extension_json: (a: number, b: number) => number;
    readonly is_relevant_result: (a: number, b: number, c: number, d: number) => number;
    readonly is_same_graph_entity_pair: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly ivfruntimeindex_cluster_count: (a: number) => number;
    readonly ivfruntimeindex_dimensions: (a: number) => number;
    readonly ivfruntimeindex_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly ivfruntimeindex_query: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly ivfruntimeindex_row_count: (a: number) => number;
    readonly normalize_entity_name: (a: number, b: number) => [number, number];
    readonly normalize_exclude_extension_json: (a: number, b: number) => [number, number];
    readonly normalize_extracted_graph_payload_json: (a: number, b: number) => [number, number];
    readonly normalize_graph_confidence_or_default: (a: number) => number;
    readonly normalize_graph_source_spans_flat: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly normalize_mcp_tool_result_json: (a: number, b: number) => [number, number];
    readonly normalize_reasoning_chunk_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly parse_extracted_graph_payload_json: (a: number, b: number) => [number, number];
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
    readonly plan_claim_evidence_scores_json: (a: number, b: number) => [number, number];
    readonly plan_context_budget_append_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_context_graph_verification_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_context_sources_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_diverse_result_indices_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_entity_resolution_json: (a: number, b: number) => [number, number];
    readonly plan_evidence_candidate_order_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_file_index_records_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_folder_lexical_evidence_indices_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_folder_mention_file_indices_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_graph_claim_entity_ids_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_community_replacement_delete_ids_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_community_summary_groups_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly plan_graph_deletion_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_edge_records_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly plan_graph_entity_merge_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_evidence_candidate_lookup_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_evidence_entry_candidates_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_graph_extraction_child_units_json: (a: number, b: number, c: number) => [number, number];
    readonly plan_graph_extraction_failure_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_graph_mention_context_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_graph_query_execution_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_graph_query_json: (a: number, b: number) => [number, number];
    readonly plan_graph_query_response_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_rag_markdown_file_paths_json: (a: number, b: number) => [number, number];
    readonly plan_graph_rag_run_file_selection_json: (a: number, b: number) => [number, number];
    readonly plan_graph_rag_status_entry_lookups_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_rag_status_entry_snapshot_json: (a: number, b: number) => [number, number];
    readonly plan_graph_rag_status_file_snapshot_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_rag_status_json: (a: number, b: number) => [number, number];
    readonly plan_graph_rag_unsupported_prune_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_graph_relation_endpoint_indices_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_graph_schema_community_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_implicit_folder_query_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_index_pending_files_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_local_evidence_scores_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
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
    readonly plan_vector_store_add_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_lookup_by_file_paths_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_lookup_by_ids_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_remove_file_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_vector_store_replace_file_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly plan_vector_store_stats_json: (a: number, b: number, c: number) => [number, number];
    readonly prune_graph_indexes_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly rank_top_k_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly recall_at_k: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly recompute_centroids: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly rewrite_graph_entity_references_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly rrf_score_or_nan: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly sanitize_graph_id_part: (a: number, b: number) => [number, number];
    readonly score_entity_match_or_nan: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly score_local_evidence_pairs: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly select_diverse_indices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly select_relevant_result_indices: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly should_append_mcp_path_hint_rust: (a: number, b: number, c: number, d: number) => number;
    readonly should_offer_context7_for_prompt: (a: number, b: number) => number;
    readonly should_rebuild_graph_runtime_for_graph_status: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
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
    readonly normalize_graph_name: (a: number, b: number) => [number, number];
    readonly graph_extraction_contract_version: () => number;
    readonly plan_graph_schema_relation_indices_json: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_rag_automatic_recovery_batch_json: (a: number, b: number) => [number, number];
    readonly plan_rag_automatic_recovery_json: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly plan_rag_storage_health_json: (a: number, b: number) => [number, number];
    readonly rag_automatic_recovery_delay_ms: (a: number) => number;
    readonly plan_rag_performance_guard_json: (a: number, b: number) => [number, number];
    readonly create_indexed_db_record_key: (a: number, b: number, c: number, d: number) => [number, number];
    readonly plan_indexed_db_bounded_cleanup_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly plan_indexed_db_bounded_retention_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly plan_indexed_db_storage_layout_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
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
