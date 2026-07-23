import {
  aggregate_graph_edges_flat,
  analyze_retrieval_sources,
  assign_vector_clusters,
  Bm25RuntimeIndex,
  bm25_score_pairs,
  build_initial_centroids,
  chunk_markdown_json,
  collect_candidate_reasons as collect_candidate_reasons_json,
  chunk_plain_text_json,
  core_version,
  count_keyword_matches,
  create_entity_id,
  create_context_preview,
  cosine_similarity_or_nan,
  create_graph_id,
  create_content_hash,
  create_indexed_db_record_key,
  create_entries_fingerprint as create_entries_fingerprint_json,
  detect_communities_from_edges_json,
  detect_leiden_hierarchy_from_edges_json,
  detect_communities_flat,
  extract_json_object_text,
  extract_structured_reasoning,
  extract_vault_links_json,
  graph_extraction_contract_version,
  plan_graph_extraction_failure_json,
  plan_graph_extraction_child_units_json,
  find_mentioned_entity_matches,
  hybrid_score_or_nan,
  initSync,
  IvfRuntimeIndex,
  is_graph_extraction_cache_hit_json,
  is_same_graph_entity_pair,
  is_protected_rag_document_extension_json,
  count_files_by_extensions_json,
  is_excluded_path,
  is_excluded_ext_json,
  is_recommendable_exclude_extension_json,
  is_mcp_tool_name_available,
  is_whole_vault_research_intent,
  parse_mcp_tool_arguments_json,
  normalize_mcp_tool_result_json,
  is_mcp_tool_result_empty_json,
  classify_mcp_tool_error_json,
  normalize_exclude_extension_json,
  is_relevant_result,
  normalize_entity_name,
  normalize_extracted_graph_payload_json,
  normalize_reasoning_chunk_json,
  normalize_graph_confidence_or_default,
  normalize_graph_source_spans_flat,
  normalize_graph_name,
  parse_extracted_graph_payload_json,
  parse_mention_candidates_json,
  plan_folder_lexical_evidence_indices_json,
  plan_implicit_folder_query_paths_json,
  plan_assistant_response_classification_json,
  split_reasoning_tags_json,
  strip_compatibility_tool_calls,
  plan_chat_context_mentions_json,
  plan_compatibility_tool_calls_json,
  plan_mcp_server_candidates_json,
  plan_native_vault_link_paths_json,
  plan_native_vault_list_json,
  plan_native_vault_read_range_json,
  plan_native_vault_stats_json,
  plan_native_vault_tool_request_json,
  plan_bm25_candidate_resolution_json,
  plan_bm25_hit_lookup_json,
  plan_bm25_index_add_document_json,
  plan_bm25_index_remove_document_json,
  plan_bm25_index_remove_source_json,
  plan_bm25_search_json,
  plan_bm25_source_lookups_json,
  plan_chat_meta_json,
  plan_chat_messages_json,
  plan_chat_save_metadata_json,
  plan_context_budget_append_json,
  plan_context_graph_verification_json,
  plan_context_sources_json,
  plan_diverse_result_indices_json,
  plan_entity_resolution_json,
  plan_index_pending_files_json,
  plan_claim_evidence_scores_json,
  plan_evidence_candidate_order_json,
  plan_empty_file_index_record_json,
  plan_local_evidence_scores_json,
  plan_file_index_records_json,
  plan_indexed_db_bounded_cleanup_json,
  plan_indexed_db_bounded_retention_json,
  plan_indexed_db_storage_layout_json,
  plan_graph_storage_maintenance_json,
  plan_inactive_indexed_db_cleanup_json,
  plan_plugin_owned_file_maintenance_json,
  plan_stale_index_source_paths_json,
  plan_folder_mention_file_indices_json,
  plan_graph_community_replacement_delete_ids_json,
  plan_graph_community_summary_groups_json,
  plan_graph_claim_entity_ids_json,
  plan_graph_deletion_indices_json,
  plan_graph_edge_records_json,
  plan_graph_entity_merge_json,
  rewrite_graph_entity_references_json,
  plan_graph_evidence_candidate_lookup_json,
  plan_graph_evidence_entry_candidates_json,
  plan_graph_mention_context_json,
  plan_graph_query_execution_json,
  plan_graph_query_json,
  plan_graph_rag_status_entry_lookups_json,
  plan_graph_rag_status_entry_snapshot_json,
  plan_graph_rag_status_file_snapshot_json,
  plan_graph_rag_markdown_file_paths_json,
  plan_graph_rag_run_file_selection_json,
  plan_graph_rag_status_json,
  should_rebuild_graph_runtime_for_graph_status,
  plan_graph_rag_unsupported_prune_paths_json,
  plan_graph_query_response_json,
  plan_graph_relation_endpoint_indices_json,
  plan_graph_schema_community_indices_json,
  plan_graph_schema_relation_indices_json,
  plan_merged_retrieval_candidates,
  plan_merged_retrieval_candidates_by_entry_id,
  plan_query_result_score_json,
  plan_rag_file_content_probe_indices_json,
  plan_rag_file_indexability_json,
  plan_rag_file_type_summary_json,
  plan_rag_indexing_eta_json,
  plan_rag_performance_guard_json,
  plan_rag_automatic_recovery_batch_json,
  plan_rag_automatic_recovery_json,
  plan_rag_storage_health_json,
  rag_automatic_recovery_delay_ms,
  plan_prompt_library_summary_json,
  plan_rag_status_json,
  plan_reference_file_indices_json,
  plan_rerank_messages_json,
  plan_rerank_response_json,
  plan_rerank_result_order_json,
  plan_research_summary_batches_json,
  plan_research_citation_indices_json,
  plan_research_request_failure_json,
  plan_repeated_tool_call_indices_json,
  format_mcp_json,
  validate_exclude_extension_input_json,
  validate_exclude_path_input_json,
  validate_mcp_json,
  plan_source_references_json,
  plan_source_validation_inputs_json,
  plan_source_validation_warnings_json,
  get_mcp_connection_state_rust,
  should_append_mcp_path_hint_rust,
  should_offer_context7_for_prompt,
  plan_structural_heading_neighbors_json,
  plan_structural_linked_paths_json,
  plan_vector_store_add_json,
  plan_vector_file_index_batch_json,
  plan_vector_record_batch_json,
  plan_vector_store_lookup_by_file_paths_json,
  plan_vector_store_lookup_by_ids_json,
  plan_vector_store_remove_file_json,
  plan_vector_store_replace_file_json,
  plan_vector_store_stats_json,
  plan_vault_link_candidates_json,
  plan_vault_link_fallback_index_json,
  prune_graph_indexes_json,
  rank_top_k_pairs,
  recall_at_k,
  recompute_centroids,
  rrf_score_or_nan,
  sanitize_graph_id_part,
  score_entity_match_or_nan,
  select_diverse_indices,
  select_relevant_result_indices,
  score_local_evidence_pairs,
  token_frequencies_json,
  tokenize_json,
  VectorRuntimeIndex,
} from '../../generated/rag-wasm/rag_wasm.js';
import type { Chunk } from './indexer';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

const RUST_RECALL_UNKNOWN_INDEX = 0xffffffff;

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

export type RustNativeVaultToolRequest =
  | {
      action: 'search';
      query: string;
      path: string;
      limit: number;
      match: 'all' | 'any' | 'phrase';
    }
  | { action: 'read'; path: string; startLine: number; endLine: number | null }
  | { action: 'list'; path: string; cursor: number; limit: number }
  | {
      action: 'links';
      path: string;
      direction: 'incoming' | 'outgoing' | 'both';
      limit: number;
    }
  | { action: 'stats' };

export type RustNativeVaultToolRequestPlan =
  | { ok: true; request: RustNativeVaultToolRequest }
  | { ok: false; error: { code: string } };

export interface RustNativeVaultListPlan {
  paths: string[];
  nextCursor: number | null;
  total: number;
}

export interface RustNativeVaultReadRangePlan {
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface RustNativeVaultStatsPlan {
  fileCount: number;
  totalBytes: number;
}

export interface RustHybridScoreInput {
  combinedBase: number;
  rrfScore: number;
  sourcePrior: number;
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
  retrievalSources: readonly string[];
}

export interface RustRetrievalSourceAnalysis {
  sourcePrior: number;
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
  hasGraphOrStructuralEvidence: boolean;
  hasStrongGraphOrStructuralEvidence: boolean;
}

export interface RustQueryResultScoreInput {
  cosineScore: number;
  bm25Score: number;
  bm25Weight: number;
  hasBm25: boolean;
  sourceScores: Partial<Record<string, number>>;
  sourceRanks: Partial<Record<string, number>>;
  retrievalSources: readonly string[];
}

export interface RustQueryResultScorePlan {
  combinedBase: number;
  rrfScore: number;
  sourcePrior: number;
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
  hasGraphOrStructuralEvidence: boolean;
  hasStrongGraphOrStructuralEvidence: boolean;
  combinedScore: number;
  selectionReason: RustSourceSelectionReason;
}

export type RustSourceSelectionReason =
  | 'strong-graph-evidence'
  | 'graph-structural-evidence'
  | 'keyword-vector'
  | 'keyword'
  | 'vector'
  | 'hybrid';

export interface RustRerankMessageCandidate {
  id: string;
  sourcePath: string;
  heading: string;
  text: string;
}

export interface RustRerankMessagesPlan {
  systemContent: string;
  userContent: string;
}

export type RustRerankStatus =
  | 'applied'
  | 'empty-rank-plan'
  | 'invalid-json'
  | 'skipped-empty-allowed-ids';

export interface RustRerankResponsePlan {
  rankedIds: string[];
  rerankStatus: RustRerankStatus;
}

export interface RustRelevantResultInput {
  combinedScore: number;
  vectorScore: number;
  bm25Score: number;
  keywordMatches: number;
  threshold: number;
  hasBm25: boolean;
  retrievalSources: readonly string[];
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
}

export interface RustRelevantResultCandidate {
  score: number;
  vectorScore: number;
  bm25Score: number;
  keywordMatches: number;
  retrievalSources: readonly string[];
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
}

export interface RustRetrievalCandidateMergeInput {
  entryIndex: number;
  source: string;
  sourceScore?: number;
  rank?: number;
}

export interface RustRetrievalCandidateMergeByEntryIdInput {
  entryId: string;
  source: string;
  sourceScore?: number;
  rank?: number;
}

export interface RustMergedRetrievalSource {
  source: string;
  sourceScore?: number;
  rank?: number;
}

export interface RustMergedRetrievalCandidatePlan {
  entryIndex: number;
  firstCandidateIndex: number;
  candidateIndexes: number[];
  sources: RustMergedRetrievalSource[];
}

export interface RustBm25Hit {
  docId: string;
  sourcePath: string;
  score: number;
}

export interface RustBm25HitLookupPlan {
  hits: RustBm25Hit[];
  lookupDocIds: string[];
  maxScore: number;
}

export interface RustBm25EntryInput {
  id: string;
  filePath: string;
  compatible: boolean;
}

export interface RustBm25CandidateResolutionInput {
  hits: readonly RustBm25Hit[];
  foundEntries: readonly RustBm25EntryInput[];
  pathEntries: readonly RustBm25EntryInput[];
  candidateLimit: number;
  maxScore: number;
}

export interface RustBm25CandidatePlan {
  entrySet: 'found' | 'path';
  entryIndex: number;
  sourceScore: number;
}

export interface RustBm25IndexData {
  tokenizerVersion: number;
  inverted: Record<string, Record<string, number>>;
  docLengths: Record<string, number>;
  docSources: Record<string, string>;
  totalDocs: number;
  avgDocLength: number;
}

export interface RustBm25SearchScore {
  docId: string;
  score: number;
}

export class RustBm25RuntimeIndex {
  private constructor(private readonly inner: Bm25RuntimeIndex) {}

  static fromJson(payload: string, tokenizerVersion: number): RustBm25RuntimeIndex | null {
    if (!isStringValue(payload) || !isValidNonNegativeInteger(tokenizerVersion)) return null;
    if (!ensureRustCore()) return null;
    try {
      return new RustBm25RuntimeIndex(Bm25RuntimeIndex.from_json(payload, tokenizerVersion));
    } catch {
      return null;
    }
  }

  static empty(tokenizerVersion: number): RustBm25RuntimeIndex | null {
    if (!isValidNonNegativeInteger(tokenizerVersion)) return null;
    if (!ensureRustCore()) return null;
    try {
      return new RustBm25RuntimeIndex(new Bm25RuntimeIndex(tokenizerVersion));
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.inner.free();
  }

  addDocument(docId: string, text: string, sourcePath: string, tokenizerVersion: number): void {
    this.inner.add_document(docId, text, sourcePath, tokenizerVersion);
  }

  addNewDocument(docId: string, text: string, sourcePath: string, tokenizerVersion: number): void {
    this.inner.add_new_document(docId, text, sourcePath, tokenizerVersion);
  }

  removeDocument(docId: string, tokenizerVersion: number): void {
    this.inner.remove_document(docId, tokenizerVersion);
  }

  removeSource(sourcePath: string, tokenizerVersion: number): void {
    this.inner.remove_source(sourcePath, tokenizerVersion);
  }

  search(query: string): RustBm25SearchScore[] | null {
    try {
      const raw = this.inner.search_json(query);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isBm25SearchScore)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  searchTop(query: string, limit: number): RustBm25SearchScore[] | null {
    try {
      const raw = this.inner.search_top_json(query, limit);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isBm25SearchScore)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  sourcePathForDoc(docId: string): string | undefined {
    const value = this.inner.source_path_for_doc(docId);
    return value.length > 0 ? value : undefined;
  }

  isReady(): boolean {
    return this.inner.is_ready();
  }

  isTokenizerCurrent(tokenizerVersion: number): boolean {
    return this.inner.is_tokenizer_current(tokenizerVersion);
  }

  totalDocs(): number {
    return this.inner.total_docs();
  }

  toJson(): string {
    return this.inner.to_json();
  }
}

export class RustVectorRuntimeIndex {
  private constructor(
    private readonly inner: VectorRuntimeIndex,
    readonly rowCount: number,
    readonly dimensions: number,
  ) {}

  static build(vectors: readonly (readonly number[])[]): RustVectorRuntimeIndex | null {
    if (vectors.length === 0) return null;
    const dimension = vectors[0]?.length ?? 0;
    if (dimension <= 0) return null;
    const flatVectors = encodeVectorMatrixF32(vectors, dimension);
    if (flatVectors === null) return null;
    if (!ensureRustCore()) return null;
    try {
      const inner = new VectorRuntimeIndex(flatVectors, dimension);
      if (inner.row_count() !== vectors.length || inner.dimensions() !== dimension) {
        inner.free();
        return null;
      }
      return new RustVectorRuntimeIndex(inner, vectors.length, dimension);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.inner.free();
  }

  rankTopK(query: readonly number[], topK: number): RustVectorScore[] | null {
    if (topK <= 0) return [];
    if (query.length !== this.dimensions || !isFiniteVector(query)) return null;
    const queryValues = new Float32Array(query);
    const pairs = this.inner.rank_top_k(queryValues, normalizeNonNegativeInteger(topK));
    return decodeBoundedIndexScorePairs(pairs, this.rowCount);
  }

  rankTopKFiltered(
    query: readonly number[],
    rowIndices: readonly number[],
    topK: number,
  ): RustVectorScore[] | null {
    if (topK <= 0) return [];
    if (query.length !== this.dimensions || !isFiniteVector(query)) return null;
    if (!isValidUint32Array(rowIndices, this.rowCount)) return null;
    const queryValues = new Float32Array(query);
    const pairs = this.inner.rank_top_k_filtered(
      queryValues,
      new Uint32Array(rowIndices),
      normalizeNonNegativeInteger(topK),
    );
    return decodeBoundedIndexScorePairs(pairs, this.rowCount);
  }
}

export class RustIvfRuntimeIndex {
  private constructor(
    private readonly inner: IvfRuntimeIndex,
    readonly rowCount: number,
    readonly dimensions: number,
    readonly clusterCount: number,
  ) {}

  static build(
    vectors: readonly (readonly number[])[],
    requestedClusterCount: number,
    iterations: number,
  ): RustIvfRuntimeIndex | null {
    if (vectors.length === 0) return null;
    const dimension = vectors[0]?.length ?? 0;
    if (dimension <= 0) return null;
    const flatVectors = encodeVectorMatrixF32(vectors, dimension);
    if (flatVectors === null) return null;
    if (!ensureRustCore()) return null;
    try {
      const inner = new IvfRuntimeIndex(
        flatVectors,
        dimension,
        normalizeNonNegativeInteger(requestedClusterCount),
        normalizeNonNegativeInteger(iterations),
      );
      if (inner.row_count() !== vectors.length || inner.dimensions() !== dimension) {
        inner.free();
        return null;
      }
      return new RustIvfRuntimeIndex(inner, vectors.length, dimension, inner.cluster_count());
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.inner.free();
  }

  query(query: readonly number[], topK: number, probeCount: number): RustVectorScore[] | null {
    if (topK <= 0) return [];
    if (query.length !== this.dimensions || !isFiniteVector(query)) return null;
    const pairs = this.inner.query(
      new Float32Array(query),
      normalizeNonNegativeInteger(topK),
      normalizeNonNegativeInteger(probeCount),
    );
    return decodeBoundedIndexScorePairs(pairs, this.rowCount);
  }
}

export interface RustClaimEvidenceInput {
  confidence: number;
  evidenceIds: readonly string[];
}

export interface RustEvidenceScore {
  evidenceId: string;
  score: number;
}

export interface RustLocalEvidenceMatchInput {
  entityId: string;
  entityConfidence: number;
  matchScore: number;
  evidenceIds: readonly string[];
}

export interface RustLocalEvidenceRelationInput {
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  evidenceIds: readonly string[];
}

export interface RustLocalEvidenceClaimInput {
  entityIds: readonly string[];
  confidence: number;
  evidenceIds: readonly string[];
}

export interface RustLocalEvidencePlanInput {
  matches: readonly RustLocalEvidenceMatchInput[];
  relations: readonly RustLocalEvidenceRelationInput[];
  claims: readonly RustLocalEvidenceClaimInput[];
  traversalDepth: number;
}

export interface RustGraphCommunityReplacementRecord {
  id: string;
  ontologySchemaId: string;
}

export interface RustGraphEvidenceLookupRecord {
  id: string;
  filePath: string;
}

export interface RustGraphEvidenceCandidateLookupPlan {
  scoreIndices: number[];
  evidenceIndices: number[];
  filePaths: string[];
}

export interface RustGraphEvidenceEntryRecord {
  id: string;
  compatible: boolean;
}

export interface RustGraphEvidenceEntryCandidatePlan {
  candidateIndices: number[];
  entryIndices: number[];
}

export interface RustGraphMentionEntityInput {
  id: string;
  canonicalName: string;
  aliases: readonly string[];
  typeId?: string;
  description?: string;
}

export interface RustGraphMentionRelationInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationTypeId?: string;
  description?: string;
}

export interface RustGraphMentionContextPlan {
  matchedEntityIndices: number[];
  matchedRelationIndices: number[];
  contextLines: string[];
}

export interface RustGraphClaimEntityLookupRecord {
  name: string;
  entityId: string;
}

export interface RustGraphRelationEndpointInput {
  source: string;
  target: string;
}

export interface RustGraphRelationEndpointLookupRecord {
  name: string;
  entityIndex: number;
}

export interface RustGraphRelationEndpointPair {
  sourceEntityIndex: number;
  targetEntityIndex: number;
}

export interface RustGraphRelationEndpointPlan {
  pairs: Array<RustGraphRelationEndpointPair | null>;
}

export interface RustGraphCommunityAssignmentInput {
  entityId: string;
  communityId: number;
}

export interface RustGraphCommunitySummaryRelationInput {
  sourceEntityId: string;
  targetEntityId: string;
}

export interface RustGraphCommunitySummaryClaimInput {
  entityIds: readonly string[];
}

export interface RustGraphCommunitySummaryGroup {
  entityIndices: number[];
  relationIndices: number[];
  claimIndices: number[];
}

export interface RustGraphCommunitySummaryGroupsPlan {
  groups: RustGraphCommunitySummaryGroup[];
}

export interface RustFileIndexEntryInput {
  filePath: string;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
  endLine?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  updated?: number;
}

export interface RustFileIndexRecordPlan {
  filePath: string;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  hasCompleteMetadata: boolean;
  vectorCount: number;
  updated: number;
}

export type RustVectorStoreSourceKind = 'existing' | 'incoming';

export interface RustVectorStoreSourcePlan {
  source: RustVectorStoreSourceKind;
  index: number;
}

export interface RustVectorStoreMutationPlan {
  sources: RustVectorStoreSourcePlan[];
  removedCount: number;
  changed: boolean;
}

export interface RustVectorStoreStatsPlan {
  totalEntries: number;
  totalFiles: number;
  totalVectors: number;
  averageVectorsPerFile: number;
  lastUpdated: number | null;
  indexedFilePaths: string[];
}

export interface RustIndexedDbStorageLayout {
  contractVersion: number;
  currentVaultPrefix: string;
  ownedVaultPrefixes: string[];
  active: {
    vector: string;
    embeddingCache: string;
    bm25: string;
    graph: string;
  };
  cleanupLegacyNames: string[];
  legacyNames: string[];
}

export interface RustIndexedDbBoundedCleanupPlan {
  deleteNames: string[];
  remainingDeleteCount: number;
}

export interface RustIndexedDbBoundedRetentionPlan {
  deleteIds: string[];
  remainingWork: boolean;
  remainingRecordCount: number;
}

export interface RustStaleIndexSourcePathsPlan {
  deletePaths: string[];
  remainingDeleteCount: number;
}

export interface RustInactiveIndexedDbRecord {
  key: string;
  firstSeen: number;
  lastSeen: number | null;
}

export interface RustInactiveIndexedDbCleanupInput {
  databaseNames: readonly string[];
  activeNames: readonly string[];
  currentVaultPrefixes: readonly string[];
  currentLegacyNames: readonly string[];
  pluginId: string;
  records: readonly RustInactiveIndexedDbRecord[];
  now: number;
  maxInactiveAgeMs: number;
  maxDeletions: number;
}

export interface RustInactiveIndexedDbCleanupPlan {
  records: RustInactiveIndexedDbRecord[];
  deleteNames: string[];
  remainingDeleteCount: number;
}

export interface RustGraphStorageRecord {
  id: string;
  state?: string;
  filePath?: string;
  rawResponseId?: string;
  leaseExpiresAt?: number;
  openUntil?: number;
  updatedAt?: number;
  receivedAt?: number;
}

export interface RustGraphStorageMaintenanceInput {
  validFilePaths: readonly string[];
  graphFilePaths: readonly string[];
  extractionJobs: readonly RustGraphStorageRecord[];
  rawResponses: readonly RustGraphStorageRecord[];
  communitySummaryJobs: readonly RustGraphStorageRecord[];
  globalSearchJobs: readonly RustGraphStorageRecord[];
  providerCircuits: readonly RustGraphStorageRecord[];
  now: number;
  maxAgeMs: number;
  maxExtractionJobs: number;
  maxRawResponses: number;
  maxCommunitySummaryJobs: number;
  maxGlobalSearchJobs: number;
  maxProviderCircuits: number;
  maxDeletions: number;
}

export interface RustGraphStorageMaintenancePlan {
  deleteFilePaths: string[];
  deleteExtractionJobIds: string[];
  deleteRawResponseIds: string[];
  deleteCommunitySummaryJobIds: string[];
  deleteGlobalSearchJobIds: string[];
  deleteProviderCircuitIds: string[];
  remainingWork: boolean;
}

export interface RustPluginOwnedFileRecord {
  path: string;
  mtime: number;
  size: number;
}

export interface RustPluginOwnedFileMaintenanceInput {
  records: readonly RustPluginOwnedFileRecord[];
  pluginDirectory: string;
  legacyDataDirectory: string;
  eventLogPath: string;
  now: number;
  staleTempAgeMs: number;
  maxEventLogBytes: number;
  allowLegacyCleanup: boolean;
  maxDeletions: number;
}

export interface RustPluginOwnedFileMaintenancePlan {
  deletePaths: string[];
  remainingDeleteCount: number;
  rotateEventLogPath: string | null;
}

export interface RustVectorFileIndexBatchInput {
  filePath: string;
  isEligible: boolean;
  hasCompleteMetadata: boolean;
  embeddingProvider?: string;
  embeddingModel?: string;
}

export interface RustVectorRecordBatchInput {
  id: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  dimension: number;
  fileIndexExists: boolean;
  metadataComplete: boolean;
  contentHash?: string;
  fileContentHash?: string;
  updated: number;
  fileUpdated?: number;
}

export interface RustRagStorageHealthInput {
  coverageChecked: boolean;
  pendingDocumentCount: number;
  embeddingContractMatches: boolean;
  completionFingerprintMatches: boolean;
  activeStoreQueryable: boolean;
  reconciliationComplete: boolean;
}

export interface RustRagStorageHealthPlan {
  canReconcile: boolean;
  canDeleteStaleGenerations: boolean;
}

export interface RustRagAutomaticRecoveryFileInput {
  path: string;
  mtime: number;
  size: number;
}

export interface RustRagAutomaticRecoveryPlan {
  fingerprint: string;
  requiresRecovery: boolean;
  shouldRecordCompletion: boolean;
  retryAllowed: boolean;
  retryDelayMs: number;
  fileCount: number;
}

export interface RustRagAutomaticRecoveryBatchPlan {
  eligibleIndices: number[];
  batchIndices: number[];
  selectedSourceBytes: number;
}

export type RustRagPerformanceGuardMode = 'normal' | 'throttled' | 'paused';
export type RustRagPerformanceGuardReasonKind = 'batch' | 'event-loop' | 'resumed';
export type RustRagPerformanceGuardEventKind =
  | 'initialize'
  | 'batch_sample'
  | 'event_loop_sample'
  | 'timer_tick'
  | 'force_resume'
  | 'reset';

export interface RustRagPerformanceGuardConfig {
  enabled: boolean;
  initialBatchSize: number;
  initialYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
}

export interface RustRagPerformanceGuardPolicyState {
  mode: RustRagPerformanceGuardMode;
  currentBatchSize: number;
  currentYieldMs: number;
  slowBatchSamples: number;
  slowEventLoopSamples: number;
  healthyBatchSamples: number;
  healthyEventLoopSamples: number;
  reasonKind: RustRagPerformanceGuardReasonKind | null;
  reasonMs: number | null;
  pauseUntilMs: number | null;
  lastSlowKind: RustRagPerformanceGuardReasonKind | null;
  lastSlowMs: number | null;
}

export interface RustRagPerformanceGuardInput {
  config: RustRagPerformanceGuardConfig;
  state: RustRagPerformanceGuardPolicyState | null;
  event: {
    kind: RustRagPerformanceGuardEventKind;
    durationMs?: number;
    batchSize?: number;
  };
  nowMs: number;
}

export interface RustIndexedDbRetentionRecord {
  id: string;
  updated: number;
}

export type RustRagDocumentStatus = 'healthy' | 'missing' | 'stale' | 'unknown';

export interface RustRagStatusFileInput {
  path: string;
  mtime: number;
  size: number;
}

export interface RustRagStatusRecordInput {
  filePath: string;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  hasCompleteMetadata?: boolean;
  vectorCount: number;
}

export interface RustRagStatusReasonLabels {
  missing: string;
  legacy: string;
  staleFile: string;
  embeddingChanged: string;
}

export interface RustRagStatusInput {
  includedFiles: readonly RustRagStatusFileInput[];
  records: readonly RustRagStatusRecordInput[];
  totalVaultFiles: number;
  embeddingProvider: string;
  embeddingModel: string;
  reasons: RustRagStatusReasonLabels;
}

export interface RustRagDocumentUpdatePlan {
  path: string;
  status: Exclude<RustRagDocumentStatus, 'healthy'>;
  reason: string;
  mtime: number;
  size: number;
}

export interface RustRagStatusPlan {
  totalDocuments: number;
  healthyDocuments: number;
  missingDocuments: number;
  staleDocuments: number;
  unknownDocuments: number;
  excludedDocuments: number;
  totalVectors: number;
  updateRequiredDocuments: RustRagDocumentUpdatePlan[];
}

export interface RustIndexPendingPlan {
  fileIndices: number[];
  skipped: number;
}

export type RustRagIndexingEtaConfidence = 'calculating' | 'low' | 'medium' | 'high' | 'complete';
export type RustRagIndexingEtaBasis =
  | 'planned-chunks'
  | 'calibrated-estimate'
  | 'batch-rate'
  | 'elapsed-rate';

export interface RustRagIndexingEtaInput {
  nowMs: number;
  startedAtMs: number;
  totalFiles: number;
  completedFiles: number;
  currentFileTotalChunks: number;
  currentFileEmbeddedChunks: number;
  totalEstimatedChunks: number;
  completedEstimatedChunks: number;
  currentFileEstimatedChunks: number;
  totalPlannedChunks: number;
  completedPlannedChunks: number;
  planningComplete: boolean;
  completedBatchDurationsMs: readonly number[];
  completedBatchChunkCounts: readonly number[];
  completedFileDurationsMs: readonly number[];
  completedFileChunkCounts: readonly number[];
  completedFileEstimatedChunkCounts: readonly number[];
  completedFileActualChunkCounts: readonly number[];
  completedFileOverheadDurationsMs: readonly number[];
  historicalMsPerChunk: number | null;
  historicalChunkEstimateRatio: number | null;
  historicalVariance: number | null;
}

export interface RustRagIndexingEtaPlan {
  totalFiles: number;
  completedFiles: number;
  currentFileProgress: number;
  progressRatio: number;
  elapsedMs: number;
  remainingMs: number | null;
  estimatedCompletionMs: number | null;
  confidence: RustRagIndexingEtaConfidence;
  basis: RustRagIndexingEtaBasis;
  lowerRemainingMs: number | null;
  upperRemainingMs: number | null;
  confidenceReason: string;
  etaConfidenceReason: string;
}

export type RustGraphRagIndexState =
  | 'disabled'
  | 'not-built'
  | 'building'
  | 'ready'
  | 'partial'
  | 'stale';

export interface RustGraphRagStatusFileRecordInput {
  filePath: string;
  vectorCount: number;
}

export interface RustGraphRagStatusFileSnapshotRecordInput extends RustGraphRagStatusFileRecordInput {
  processable: boolean;
}

export interface RustGraphRagStatusFileSnapshotPlan {
  fileRecordIndices: number[];
  totalCandidateFiles: number;
}

export interface RustGraphRagStatusEvidenceInput {
  filePath: string;
  entryId: string;
  contentHash: string;
  extractionModelKey: string;
  processable: boolean;
}

export interface RustGraphRagStatusCacheInput {
  entryId: string;
  contentHash: string;
  extractionModelKey: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  extractionContractVersion: number;
}

export interface RustGraphRagStatusEntryInput {
  id: string;
  filePath: string;
  contentHash?: string;
  text: string;
}

export interface RustGraphRagStatusEntrySnapshotInput {
  id: string;
  filePath: string;
  processable: boolean;
}

export interface RustGraphRagStatusEntrySnapshotPlan {
  entryIndices: number[];
}

export interface RustGraphRagStatusInput {
  graphRagEnabled: boolean;
  isRunning: boolean;
  totalCandidateFiles: number;
  graphRagMaxFilesPerRun: number;
  graphRagModel: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  extractionContractVersion: number;
  fileRecords: readonly RustGraphRagStatusFileRecordInput[];
  evidence: readonly RustGraphRagStatusEvidenceInput[];
  rejectedFactFilePaths: readonly string[];
  pendingMergeCount: number;
  cacheRecords: readonly RustGraphRagStatusCacheInput[];
  entries: readonly RustGraphRagStatusEntryInput[];
}

export interface RustGraphRagStatusPlan {
  state: RustGraphRagIndexState;
  totalCandidateFiles: number;
  graphEvidenceCount: number;
  rejectedFactCount: number;
  failedFileCount: number;
  pendingMergeCount: number;
  staleFileCount: number;
  staleFilePaths: string[];
  maxFilesPerRun: number;
}

export type RustGraphRagRunFileSelectionMode = 'failed' | 'stale' | 'full';

export interface RustGraphRagRunFilePathInput {
  filePath: string;
  processable: boolean;
}

export interface RustGraphRagRunFileSelectionInput {
  mode: RustGraphRagRunFileSelectionMode;
  failedFilePaths: readonly string[];
  staleFilePaths: readonly string[];
  recordFilePaths: readonly RustGraphRagRunFilePathInput[];
  indexedFilePaths: readonly RustGraphRagRunFilePathInput[];
  maxFilesPerRun: number;
}

export interface RustGraphRagRunFileSelectionPlan {
  candidateFilePaths: string[];
  selectedFilePaths: string[];
}

export interface RustRagFileTypeInput {
  filePath: string;
  extension?: string;
  indexable: boolean;
  recommendationReason?: string;
}

export interface RustRagFileTypeCount {
  extension: string;
  label: string;
  count: number;
}

export interface RustRagExcludeRecommendation extends RustRagFileTypeCount {
  reason: string;
}

export interface RustRagFileTypeSummary {
  targetTypes: RustRagFileTypeCount[];
  excludeRecommendations: RustRagExcludeRecommendation[];
  totalTargetFiles: number;
}

export interface RustPromptLibrarySummaryCount {
  label: string;
  count: number;
}

export interface RustPromptLibrarySummarySample {
  filePath: string;
  heading: string;
  preview: string;
}

export interface RustPromptLibrarySummary {
  totalChunks: number;
  topFolders: RustPromptLibrarySummaryCount[];
  topFiles: RustPromptLibrarySummaryCount[];
  topHeadings: RustPromptLibrarySummaryCount[];
  samples: RustPromptLibrarySummarySample[];
}

export interface RustPromptLibrarySummaryInput {
  filePath: string;
  heading: string;
  text: string;
}

export interface RustRagFileEligibilityInput {
  filePath: string;
  fileName: string;
  extension: string;
  size: number;
}

export interface RustRagFileTextProbeInput {
  index: number;
  readable: boolean;
  sample: string;
}

export interface RustRagFileIndexabilityPlan {
  candidateIndices: number[];
  summaryInputs: RustRagFileTypeInput[];
}

export interface RustSourceReferencePlan {
  label: string;
  target: string;
  kind: 'wikilink' | 'markdown-link' | 'source-id';
  aliases: string[];
}

export interface RustSourceValidationWarningPlan {
  id: string;
  label: string;
  kind: 'missing-link' | 'unverified-source';
}

export interface RustSourceValidationInputPlan {
  verifiedCitationIds: string[];
  verifiedPaths: string[];
  aliasCandidates: string[];
}

export interface RustAssistantChoicePlan {
  id: string;
  label: string;
}

export interface RustReasoningChunk {
  content: string;
  reasoning?: string;
}

export interface RustAssistantQuestionPlan {
  prompt: string;
  choices: RustAssistantChoicePlan[];
  selectionMode: 'single' | 'multiple';
  allowFreeText: boolean;
  source: 'answer' | 'reasoning-leak';
}

export type RustAssistantResponseClassification =
  | {
      type: 'answer';
      content: string;
      reasoning: string;
    }
  | {
      type: 'question';
      content: string;
      reasoning: string;
      question: RustAssistantQuestionPlan;
      originalContent: string;
    };

export interface RustChatMessagePlan {
  id: string;
  schemaVersion?: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  providerKey?: string;
  providerLabel?: string;
  model?: string;
  errorMessage?: string;
  reasoning?: string;
  toolCalls?: unknown[];
  citations?: unknown[];
  sourceWarnings?: unknown[];
  contextAttachments?: unknown[];
  assistantQuestion?: unknown;
  branchOf?: string;
  branchRoot?: string;
  variantOf?: string;
  stopReason?: string;
  providerCapability?: unknown;
  turnStage?: string;
  toolRound?: number;
  toolRoundLogs?: unknown[];
  contextBudgetSnapshot?: unknown;
  dataBoundarySnapshot?: unknown;
  errorKind?: string;
  actionHistory?: unknown[];
}

export interface RustChatMetaPlan {
  title: string;
  created: string;
  updated?: string;
  messageCount: number;
  preview?: string;
  provider?: string;
  model?: string;
}

export interface RustChatSaveMetadataPlan {
  title: string;
  created: string;
  sourceCount: number;
  provider?: string;
  model?: string;
  summary?: string;
}

export type RustContextSourceStatus =
  | 'candidate'
  | 'verified'
  | 'missing'
  | 'stale'
  | 'low-relevance';

export type RustContextGraphType = 'entity' | 'relation' | 'community';

export interface RustContextSourceInput {
  filePath: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
  text: string;
  score?: number;
  vectorScore?: number;
  bm25Score?: number;
  selectionReason?: RustSourceSelectionReason;
}

export interface RustContextSourceVerification {
  status: RustContextSourceStatus;
  detail?: string;
  graphType?: RustContextGraphType;
}

export interface RustContextCitationPlan {
  id: string;
  filePath: string;
  heading?: string;
  line?: number;
  endLine?: number;
  score?: number;
  vectorScore?: number;
  bm25Score?: number;
  status: RustContextSourceStatus;
  detail?: string;
  preview: string;
  previewTruncated: boolean;
  selectionReason?: RustSourceSelectionReason;
  graphType?: RustContextGraphType;
}

export interface RustContextSourceBlockPlan {
  sourceId: string;
  text: string;
}

export interface RustContextSourcePlan {
  citations: RustContextCitationPlan[];
  blocks: RustContextSourceBlockPlan[];
  sourceIds: string[];
  rejectedCount: number;
}

export interface RustContextBudgetAppendPlan {
  text: string;
  remainingChars: number;
  complete: boolean;
  appended: boolean;
}

export interface RustChatContextMentionPlan {
  fileIndices: number[];
  folderIndices: number[];
  entityIndices: number[];
  serverIndices: number[];
  useAutoRag: boolean;
  autoRagReason: RustAutoRagReason;
}

export type RustAutoRagReason =
  | 'no-mentions'
  | 'server-only'
  | 'server-and-vault'
  | 'vault-mention'
  | 'implicit'
  | 'disabled';

export interface RustContextGraphVerificationPlan {
  isGraphSource: boolean;
  verification: RustContextSourceVerification | null;
}

export interface RustVaultLinkCandidatePlan {
  candidates: string[];
  fallbackBasename: string;
}

export interface RustFolderMentionFilePlan {
  indices: number[];
  partial: boolean;
  matchedCount: number;
  limitReason: RustFolderLimitReason;
}

export type RustFolderLimitReason = 'complete' | 'max-files';

export type RustExcludeValidationLevel = 'error' | 'warning';

export type RustExcludeValidationCode =
  | 'empty'
  | 'trimmed'
  | 'duplicate'
  | 'comma'
  | 'path-backslash'
  | 'path-leading-slash'
  | 'path-missing'
  | 'extension-leading-dot'
  | 'extension-invalid'
  | 'extension-protected-document';

export interface RustExcludeValidationIssue {
  level: RustExcludeValidationLevel;
  code: RustExcludeValidationCode;
}

export interface RustExcludeValidationResult {
  normalized: string;
  issues: RustExcludeValidationIssue[];
  valid: boolean;
}

export interface RustStructuralLinkEdge {
  sourcePath: string;
  targetPath: string;
}

export interface RustStructuralHeadingSeed {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  heading?: string;
}

export interface RustStructuralEntryInput {
  id: string;
  filePath: string;
  startLine: number;
  heading?: string;
  compatible: boolean;
}

export interface RustStructuralHeadingInput {
  filePath: string;
  startLine: number;
  level: number;
}

export interface RustStructuralHeadingNeighborInput {
  seeds: readonly RustStructuralHeadingSeed[];
  entries: readonly RustStructuralEntryInput[];
  headings: readonly RustStructuralHeadingInput[];
}

export interface RustDiverseCandidate {
  score: number;
  vector: readonly number[];
  sourceKey: number;
  headingKey: number;
}

export interface RustDiverseResultCandidate {
  score: number;
  vector: readonly number[];
  sourcePath: string;
  heading?: string;
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

export interface RustCommunityEdgeRecord {
  source: string;
  target: string;
  weight: number;
}

export interface RustCommunityAssignmentById {
  entityId: string;
  communityId: number;
}

export interface RustCommunityDetectionByIdResult {
  assignmentsById: RustCommunityAssignmentById[];
  communityIds: number[];
  modularity: number;
}

export interface RustCommunityHierarchyLevel extends RustCommunityDetectionByIdResult {
  level: number;
}

export interface RustCommunityHierarchyResult {
  levels: RustCommunityHierarchyLevel[];
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

export type RustEntityResolutionStatus = 'new' | 'auto-merge' | 'pending-merge';

export interface RustEntityResolutionCandidate {
  entityId: string;
  ontologySchemaId: string;
  typeId: string;
  score: number;
}

export interface RustEntityResolutionInput {
  ontologySchemaId: string;
  typeId: string;
  candidateEntityId: string;
  autoMergeThreshold: number;
  pendingMergeThreshold: number;
  candidates: readonly RustEntityResolutionCandidate[];
}

export interface RustEntityResolutionPlan {
  status: RustEntityResolutionStatus;
  entityId: string;
  mergeScore: number;
  matchedEntityId?: string;
}

export interface RustGraphEntityMergeInput {
  aliases: readonly string[];
  description: string;
  confidence: number;
  evidenceIds: readonly string[];
  updatedAt: number;
}

export interface RustGraphEntityMergePlan {
  aliases: string[];
  description: string;
  confidence: number;
  evidenceIds: string[];
  updatedAt: number;
}

export interface RustGraphExtractionCacheKey {
  entryId: string;
  contentHash: string;
  extractionModelKey: string;
  ontologySchemaId: string;
  ontologyVersion: number;
  extractionContractVersion: number;
}

export interface RustMentionedEntityInput {
  ontologySchemaId: string;
  canonicalName: string;
  aliases: readonly string[];
}

export interface RustMentionCandidate {
  raw: string;
  name: string;
}

export interface RustGraphQueryPlan {
  type: string;
  queryMode: string;
  traversalDepth: number;
  evidenceFirst: boolean;
  globalSearchDepth: 'fast' | 'deep';
  entityHints: string[];
}

export type RustGraphQueryExecutionAction =
  | 'none'
  | 'local'
  | 'global'
  | 'hybrid'
  | 'evidence-first';

export interface RustGraphQueryExecutionPlan {
  action: RustGraphQueryExecutionAction;
  requiresPlanner: boolean;
}

export interface RustMcpJsonValidationResult {
  valid: boolean;
  data?: unknown;
  errorCode?: string;
  serverName?: string;
  message?: string;
}

export interface RustMcpToolNormalizedResult {
  displayText: string;
  modelText: string;
}

export type RustMcpToolErrorKind =
  | 'validation-pattern'
  | 'validation-field'
  | 'validation-required'
  | 'validation-generic'
  | 'validation-schema-failed'
  | 'raw';

export interface RustMcpToolErrorInfo {
  kind: RustMcpToolErrorKind;
  pattern?: string;
  field?: string;
  message?: string;
}

export interface RustExtractedGraphPayloadResult {
  payload: RustExtractedGraphPayload;
  rawFactCount: number;
}

export type RustExtractedGraphPayloadParseFailureReason = 'invalid-json' | 'schema-shape-mismatch';

export type RustExtractedGraphPayloadParseResult =
  | { ok: true; payload: RustExtractedGraphPayload }
  | { ok: false; reason: RustExtractedGraphPayloadParseFailureReason; rawFact: unknown };

export interface RustExtractedGraphPayload {
  entities: RustExtractedGraphEntity[];
  relations: RustExtractedGraphRelation[];
  claims: RustExtractedGraphClaim[];
}

export interface RustExtractedGraphEntity {
  name: string;
  typeId: string;
  description?: string;
  aliases?: string[];
  confidence?: number;
  evidenceSpans?: RustGraphSourceSpan[];
}

export interface RustGraphSourceSpan {
  start: number;
  end: number;
}

export interface RustExtractedGraphRelation {
  id?: string;
  source: string;
  target: string;
  relationTypeId: string;
  description?: string;
  confidence?: number;
  evidenceSpans?: RustGraphSourceSpan[];
}

export interface RustExtractedGraphClaim {
  id?: string;
  text: string;
  claimTypeId: string;
  entityNames?: string[];
  relationRefs?: string[];
  stance?: 'supports' | 'opposes' | 'neutral' | 'interprets';
  confidence?: number;
  evidenceSpans?: RustGraphSourceSpan[];
}

export function normalizeGraphSourceSpansRust(
  spans: readonly RustGraphSourceSpan[] | undefined,
  contentLength: number,
): RustGraphSourceSpan[] | null {
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || !ensureRustCore()) return null;
  const starts = new Uint32Array(spans?.length ?? 0);
  const ends = new Uint32Array(spans?.length ?? 0);
  for (const [index, span] of (spans ?? []).entries()) {
    if (!isValidUint32(span.start) || !isValidUint32(span.end)) return null;
    starts[index] = span.start;
    ends[index] = span.end;
  }
  const output = normalize_graph_source_spans_flat(starts, ends, contentLength);
  if (output.length % 2 !== 0) return null;
  const normalized: RustGraphSourceSpan[] = [];
  for (let index = 0; index < output.length; index += 2) {
    const start = output[index];
    const end = output[index + 1];
    if (start === undefined || end === undefined || start >= end || end > contentLength)
      return null;
    normalized.push({ start, end });
  }
  return normalized;
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
  updatedEntityEvidenceIndices: number[][];
  deletedRelationIndices: number[];
  updatedRelationIndices: number[];
  updatedRelationEvidenceIndices: number[][];
  deletedClaimIndices: number[];
  updatedClaimIndices: number[];
  updatedClaimEntityIndices: number[][];
  updatedClaimRelationIndices: number[][];
  updatedClaimEvidenceIndices: number[][];
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
  if (!ensureRustCore()) {
    return null;
  }
  return core_version();
}

export type RustMcpConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'partial-error'
  | 'error';

export function getMcpConnectionStateRust(
  totalCount: number,
  connectedCount: number,
  failedCount: number,
  isConnecting: boolean,
): RustMcpConnectionState | null {
  if (!ensureRustCore()) {
    return null;
  }
  const state = get_mcp_connection_state_rust(
    totalCount,
    connectedCount,
    failedCount,
    isConnecting,
  );
  return isRustMcpConnectionState(state) ? state : null;
}

export function shouldRebuildGraphRuntimeForGraphStatusRust(
  graphRagEnabled: boolean,
  graphRagModel: string,
  previousStatusState: string,
  nextStatusState: string,
  graphProviderAttached: boolean,
): boolean | null {
  if (!ensureRustCore()) {
    return null;
  }
  return should_rebuild_graph_runtime_for_graph_status(
    graphRagEnabled,
    graphRagModel,
    previousStatusState,
    nextStatusState,
    graphProviderAttached,
  );
}

export function shouldAppendMcpPathHintRust(command: string, errorMessage: string): boolean | null {
  if (!ensureRustCore()) return null;
  return should_append_mcp_path_hint_rust(command, errorMessage);
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

export function createEntriesFingerprintRust(
  entries: {
    id: string;
    vector: readonly number[];
    metadata: {
      indexedAt?: number;
      contentHash?: string;
    };
  }[],
): string | null {
  if (!ensureRustCore()) return null;
  if (
    !entries.every(
      (entry) =>
        isStringValue(entry.id) &&
        Number.isSafeInteger(entry.metadata.indexedAt ?? 0) &&
        (entry.metadata.indexedAt ?? 0) >= 0,
    )
  ) {
    return null;
  }

  return create_entries_fingerprint_json(
    JSON.stringify(entries.map((entry) => entry.id)),
    JSON.stringify(entries.map((entry) => entry.metadata.contentHash ?? '')),
    JSON.stringify(entries.map((entry) => entry.metadata.indexedAt ?? 0)),
    JSON.stringify(entries.map((entry) => entry.vector.length)),
  );
}

export function collectCandidateReasonsRust(
  candidates: readonly (string | null | undefined)[],
  candidateIndexes: readonly number[],
): string[] | null {
  if (!ensureRustCore()) return null;
  if (
    !candidates.every(
      (reason) => reason === undefined || reason === null || isStringValue(reason),
    ) ||
    !candidateIndexes.every((index) => Number.isSafeInteger(index) && index >= 0)
  ) {
    return null;
  }

  const plan = collect_candidate_reasons_json(
    JSON.stringify(candidates.map((reason) => reason ?? '')),
    JSON.stringify(candidateIndexes),
  );
  if (!plan) return [];
  try {
    const parsed: unknown = JSON.parse(plan);
    return Array.isArray(parsed) && parsed.every(isStringValue) ? parsed : null;
  } catch {
    return null;
  }
}

export function createContextPreviewRust(text: string): string | null {
  if (!isStringValue(text)) return null;
  if (!ensureRustCore()) return null;
  return create_context_preview(text);
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
  if (!isFiniteVector(query)) return [];

  const fallbackLimit = Math.max(0, Math.floor(topK));
  if (fallbackLimit === 0) return [];

  const compatibleRows: number[] = [];
  const flatValues: number[] = [];
  for (let index = 0; index < vectors.length; index++) {
    const vector = vectors[index];
    if (!vector || vector.length !== query.length || !isFiniteVector(vector)) continue;
    compatibleRows.push(index);
    flatValues.push(...vector);
  }

  if (compatibleRows.length === 0) return [];

  if (!ensureRustCore()) {
    return rankTopKPairsFallback(query, vectors, compatibleRows, fallbackLimit);
  }

  const pairs = rank_top_k_pairs(
    new Float64Array(query),
    new Float64Array(flatValues),
    query.length,
    fallbackLimit,
  );
  return decodeRankPairs(pairs, compatibleRows);
}

function rankTopKPairsFallback(
  query: readonly number[],
  vectors: readonly (readonly number[])[],
  compatibleRows: readonly number[],
  topK: number,
): RustVectorScore[] {
  if (!Number.isFinite(topK) || topK <= 0) return [];

  const queryNormSq = squaredNorm(query);
  if (!Number.isFinite(queryNormSq) || queryNormSq <= 0) return [];

  const scored: RustVectorScore[] = [];
  for (const localIndex of compatibleRows) {
    const vector = vectors[localIndex];
    if (!vector) continue;
    const score = cosineSimilarityFallback(query, vector, queryNormSq);
    if (score === null) continue;
    scored.push({ index: localIndex, score });
  }

  if (scored.length === 0) return [];

  scored.sort((left, right) => {
    if (left.score === right.score) {
      return left.index - right.index;
    }
    return right.score - left.score;
  });

  if (scored.length <= topK) return scored;
  scored.length = topK;
  return scored;
}

function cosineSimilarityFallback(
  left: readonly number[],
  right: readonly number[],
  leftNormSq: number,
): number | null {
  let dot = 0;
  let rightNormSq = 0;

  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return null;
    }
    dot += leftValue * rightValue;
    rightNormSq += rightValue * rightValue;
  }

  if (!Number.isFinite(dot) || !Number.isFinite(rightNormSq) || rightNormSq <= 0) {
    return null;
  }

  const denominator = Math.sqrt(leftNormSq * rightNormSq);
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  const score = dot / denominator;
  return Number.isFinite(score) ? score : null;
}

function squaredNorm(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return Number.NaN;
    total += value * value;
  }
  return total;
}

function isFiniteVector(values: readonly number[]): boolean {
  for (const value of values) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

export function calculateRecallAtKRust(
  exactIds: readonly string[],
  approximateIds: readonly string[],
  topK: number,
): number | null {
  if (!Number.isFinite(topK)) return null;
  const limit = Math.max(0, Math.floor(topK));
  if (limit === 0) return 0;
  if (!exactIds.every(isStringValue) || !approximateIds.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  const exactIndexById = new Map<string, number>();
  for (const id of exactIds.slice(0, limit)) {
    if (!exactIndexById.has(id)) {
      exactIndexById.set(id, exactIndexById.size);
    }
  }
  const exactIndices = new Uint32Array(exactIndexById.size);
  for (let index = 0; index < exactIndices.length; index++) {
    exactIndices[index] = index;
  }
  const approximateTopK = approximateIds.slice(0, limit);
  const approximateIndices = new Uint32Array(approximateTopK.length);
  for (let index = 0; index < approximateTopK.length; index++) {
    approximateIndices[index] =
      exactIndexById.get(approximateTopK[index] ?? '') ?? RUST_RECALL_UNKNOWN_INDEX;
  }

  const score = recall_at_k(exactIndices, approximateIndices, limit);
  return Number.isFinite(score) ? score : null;
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

export function buildInitialCentroidsRust(
  vectors: readonly (readonly number[])[],
  requestedClusterCount: number,
): number[][] | null {
  if (vectors.length === 0) return [];
  const dimension = vectors[0]?.length ?? 0;
  if (dimension <= 0) return null;
  const flatVectors = encodeVectorMatrix(vectors, dimension);
  if (flatVectors === null) return null;
  if (!ensureRustCore()) return null;

  const values = build_initial_centroids(
    flatVectors,
    dimension,
    normalizeNonNegativeInteger(requestedClusterCount),
  );
  if (values.length % dimension !== 0) return null;
  return decodeVectorMatrix(values, values.length / dimension, dimension);
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

export function analyzeRetrievalSourcesRust(
  sourceScores: Partial<Record<string, number>>,
  sourceRanks: Partial<Record<string, number>>,
): RustRetrievalSourceAnalysis | null {
  const sourceNames = [...new Set([...Object.keys(sourceScores), ...Object.keys(sourceRanks)])];
  if (sourceNames.length === 0) {
    return {
      sourcePrior: 0,
      sourceEvidenceScore: 0,
      hasGraphOrStructuralEvidence: false,
      hasStrongGraphOrStructuralEvidence: false,
    };
  }
  if (!ensureRustCore()) return null;

  const sourceCodes = new Uint8Array(sourceNames.map(sourceToCode));
  const scores = new Float64Array(
    sourceNames.map((source) => {
      const score = sourceScores[source];
      return typeof score === 'number' ? score : Number.NaN;
    }),
  );
  const ranks = new Float64Array(
    sourceNames.map((source) => {
      const rank = sourceRanks[source];
      return typeof rank === 'number' ? rank : Number.NaN;
    }),
  );

  const values = analyze_retrieval_sources(sourceCodes, scores, ranks);
  if (values.length !== 5) {
    return null;
  }
  const sourcePrior = values[0] ?? 0;
  const sourceEvidenceScore = values[1] ?? 0;
  const bestEvidenceRank = values[2];
  const graphFlag = values[3] ?? 0;
  const strongFlag = values[4] ?? 0;
  if (
    !Number.isFinite(sourcePrior) ||
    !Number.isFinite(sourceEvidenceScore) ||
    (!Number.isFinite(bestEvidenceRank) && !Number.isNaN(bestEvidenceRank)) ||
    !Number.isFinite(graphFlag) ||
    !Number.isFinite(strongFlag)
  ) {
    return null;
  }
  return {
    sourcePrior,
    sourceEvidenceScore,
    bestEvidenceRank: Number.isFinite(bestEvidenceRank) ? bestEvidenceRank : undefined,
    hasGraphOrStructuralEvidence: graphFlag === 1,
    hasStrongGraphOrStructuralEvidence: strongFlag === 1,
  };
}

export function planQueryResultScoreRust(
  input: RustQueryResultScoreInput,
): RustQueryResultScorePlan | null {
  if (
    !Number.isFinite(input.cosineScore) ||
    !Number.isFinite(input.bm25Score) ||
    !Number.isFinite(input.bm25Weight) ||
    typeof input.hasBm25 !== 'boolean' ||
    !isFiniteMetricRecord(input.sourceScores) ||
    !isFiniteMetricRecord(input.sourceRanks) ||
    !input.retrievalSources.every(isStringValue)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;
  const rawPlan = plan_query_result_score_json(JSON.stringify(input));
  if (rawPlan.length === 0) return null;
  const parsed = JSON.parse(rawPlan) as unknown;
  return normalizeQueryResultScorePlan(parsed);
}

export function isRelevantResultRust(input: RustRelevantResultInput): boolean | null {
  if (!ensureRustCore()) return null;
  const keywordMatches = normalizeNonNegativeInteger(input.keywordMatches);
  return is_relevant_result(
    new Float64Array([
      input.combinedScore,
      input.vectorScore,
      input.bm25Score,
      keywordMatches,
      input.threshold,
      input.hasBm25 ? 1 : 0,
      input.sourceEvidenceScore,
      input.bestEvidenceRank ?? Number.NaN,
    ]),
    new Uint8Array(input.retrievalSources.map(sourceToCode)),
  );
}

export function selectRelevantResultIndicesRust(
  candidates: readonly RustRelevantResultCandidate[],
  threshold: number,
  hasBm25: boolean,
): number[] | null {
  if (candidates.length === 0) return [];
  if (!Number.isFinite(threshold)) return null;
  if (!candidates.every(isValidRelevantResultCandidate)) return null;
  if (!ensureRustCore()) {
    return selectRelevantResultIndicesFallback(candidates, threshold, hasBm25);
  }

  const sourceOffsets = [0];
  const sourceCodes: number[] = [];
  const resultValues = new Float64Array(candidates.length * 6);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const offset = index * 6;
    resultValues[offset] = candidate.score;
    resultValues[offset + 1] = candidate.vectorScore;
    resultValues[offset + 2] = candidate.bm25Score;
    resultValues[offset + 3] = normalizeNonNegativeInteger(candidate.keywordMatches);
    resultValues[offset + 4] = candidate.sourceEvidenceScore;
    resultValues[offset + 5] = candidate.bestEvidenceRank ?? Number.NaN;
    sourceCodes.push(...candidate.retrievalSources.map(sourceToCode));
    sourceOffsets.push(sourceCodes.length);
  }

  return (
    decodeIndexArray(
      select_relevant_result_indices(
        new Float64Array([threshold, hasBm25 ? 1 : 0]),
        new Uint32Array(sourceOffsets),
        new Uint8Array(sourceCodes),
        resultValues,
      ),
      candidates.length,
    ) ?? selectRelevantResultIndicesFallback(candidates, threshold, hasBm25)
  );
}

function selectRelevantResultIndicesFallback(
  candidates: readonly RustRelevantResultCandidate[],
  threshold: number,
  hasBm25: boolean,
): number[] {
  const scored = candidates.map((candidate, index) => {
    const hasSignal = hasBm25 ? Number.isFinite(candidate.bm25Score) : true;
    const qualifies = candidate.score >= threshold || candidate.vectorScore >= threshold;
    return {
      index,
      qualifies,
      score: Number.isFinite(candidate.score) ? candidate.score : candidate.vectorScore,
      hasSignal,
    };
  });

  return scored
    .filter((item) => item.qualifies && item.hasSignal)
    .sort((left, right) => {
      if (left.score === right.score) return left.index - right.index;
      return right.score - left.score;
    })
    .map((entry) => entry.index);
}

export function planMergedRetrievalCandidatesRust(
  candidates: readonly RustRetrievalCandidateMergeInput[],
): RustMergedRetrievalCandidatePlan[] | null {
  if (candidates.length === 0) return [];
  if (!ensureRustCore()) return null;

  const entryIndices = new Uint32Array(candidates.length);
  const sourceCodes = new Uint8Array(candidates.length);
  const sourceScores = new Float64Array(candidates.length);
  const ranks = new Float64Array(candidates.length);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate || !isValidRetrievalCandidateMergeInput(candidate)) return null;
    entryIndices[index] = candidate.entryIndex;
    sourceCodes[index] = sourceToCode(candidate.source);
    sourceScores[index] = candidate.sourceScore ?? Number.NaN;
    ranks[index] = candidate.rank ?? Number.NaN;
  }

  return decodeMergedRetrievalCandidatePlan(
    plan_merged_retrieval_candidates(entryIndices, sourceCodes, sourceScores, ranks),
    candidates.length,
  );
}

export function planMergedRetrievalCandidatesByEntryIdRust(
  candidates: readonly RustRetrievalCandidateMergeByEntryIdInput[],
): RustMergedRetrievalCandidatePlan[] | null {
  if (candidates.length === 0) return [];
  if (!ensureRustCore()) return null;

  const entryIds: string[] = [];
  const sourceCodes = new Uint8Array(candidates.length);
  const sourceScores = new Float64Array(candidates.length);
  const ranks = new Float64Array(candidates.length);

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate || !isValidRetrievalCandidateMergeByEntryIdInput(candidate)) return null;
    entryIds.push(candidate.entryId);
    sourceCodes[index] = sourceToCode(candidate.source);
    sourceScores[index] = candidate.sourceScore ?? Number.NaN;
    ranks[index] = candidate.rank ?? Number.NaN;
  }

  return decodeMergedRetrievalCandidatePlan(
    plan_merged_retrieval_candidates_by_entry_id(
      JSON.stringify(entryIds),
      sourceCodes,
      sourceScores,
      ranks,
    ),
    candidates.length,
  );
}

export function planBm25IndexAddDocumentRust(
  index: RustBm25IndexData | null,
  docId: string,
  text: string,
  sourcePath: string,
  tokenizerVersion: number,
): RustBm25IndexData | null {
  if (
    !isBm25IndexData(index) ||
    !isStringValue(docId) ||
    !isStringValue(text) ||
    !isStringValue(sourcePath) ||
    !isValidNonNegativeInteger(tokenizerVersion)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_index_add_document_json(
      JSON.stringify(index),
      docId,
      text,
      sourcePath,
      tokenizerVersion,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBm25IndexData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25IndexRemoveDocumentRust(
  index: RustBm25IndexData | null,
  docId: string,
  tokenizerVersion: number,
): RustBm25IndexData | null {
  if (
    !isBm25IndexData(index) ||
    !isStringValue(docId) ||
    !isValidNonNegativeInteger(tokenizerVersion)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_index_remove_document_json(
      JSON.stringify(index),
      docId,
      tokenizerVersion,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBm25IndexData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25IndexRemoveSourceRust(
  index: RustBm25IndexData | null,
  sourcePath: string,
  tokenizerVersion: number,
): RustBm25IndexData | null {
  if (
    !isBm25IndexData(index) ||
    !isStringValue(sourcePath) ||
    !isValidNonNegativeInteger(tokenizerVersion)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_index_remove_source_json(
      JSON.stringify(index),
      sourcePath,
      tokenizerVersion,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBm25IndexData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25SearchRust(
  index: RustBm25IndexData | null,
  query: string,
): RustBm25SearchScore[] | null {
  if (!isBm25IndexData(index) || !isStringValue(query)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_search_json(JSON.stringify(index), query);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isBm25SearchScore)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25HitLookupRust(
  hits: readonly RustBm25Hit[],
  candidateLimit: number,
  lookupMultiplier: number,
): RustBm25HitLookupPlan | null {
  if (candidateLimit <= 0) return { hits: [], lookupDocIds: [], maxScore: 1 };
  if (!hits.every(isValidBm25Hit)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_hit_lookup_json(
      JSON.stringify(hits),
      normalizePositiveInteger(candidateLimit),
      normalizePositiveInteger(lookupMultiplier),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBm25HitLookupPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25SourceLookupsRust(
  hits: readonly RustBm25Hit[],
  foundEntryIds: readonly string[],
): string[] | null {
  if (!hits.every(isValidBm25Hit) || !foundEntryIds.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_source_lookups_json(JSON.stringify(hits), JSON.stringify(foundEntryIds));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planBm25CandidateResolutionRust(
  input: RustBm25CandidateResolutionInput,
): RustBm25CandidatePlan[] | null {
  if (
    input.candidateLimit < 0 ||
    !Number.isFinite(input.maxScore) ||
    !input.hits.every(isValidBm25Hit) ||
    !input.foundEntries.every(isValidBm25EntryInput) ||
    !input.pathEntries.every(isValidBm25EntryInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_bm25_candidate_resolution_json(
      JSON.stringify(input.hits),
      JSON.stringify(input.foundEntries),
      JSON.stringify(input.pathEntries),
      normalizeNonNegativeInteger(input.candidateLimit),
      input.maxScore,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isBm25CandidatePlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planClaimEvidenceScoresRust(
  claims: readonly RustClaimEvidenceInput[],
): RustEvidenceScore[] | null {
  if (
    !claims.every(
      (claim) => Number.isFinite(claim.confidence) && claim.evidenceIds.every(isStringValue),
    )
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_claim_evidence_scores_json(JSON.stringify(claims));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isEvidenceScore)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planLocalEvidenceScoresRust(
  input: RustLocalEvidencePlanInput,
): RustEvidenceScore[] | null {
  if (!isLocalEvidencePlanInput(input)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_local_evidence_scores_json(
      JSON.stringify(input.matches),
      JSON.stringify(input.relations),
      JSON.stringify(input.claims),
      normalizeNonNegativeInteger(input.traversalDepth),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isEvidenceScore)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planEvidenceCandidateOrderRust(
  scores: readonly RustEvidenceScore[],
  availableEvidenceIds: readonly string[],
): RustEvidenceScore[] | null {
  if (!scores.every(isEvidenceScore) || !availableEvidenceIds.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_evidence_candidate_order_json(
      JSON.stringify(scores),
      JSON.stringify(availableEvidenceIds),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isEvidenceScore)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphEvidenceCandidateLookupRust(
  scores: readonly RustEvidenceScore[],
  evidence: readonly RustGraphEvidenceLookupRecord[],
): RustGraphEvidenceCandidateLookupPlan | null {
  if (!scores.every(isEvidenceScore) || !evidence.every(isGraphEvidenceLookupRecord)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_evidence_candidate_lookup_json(
      JSON.stringify(scores),
      JSON.stringify(evidence),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphEvidenceCandidateLookupPlan(parsed, scores.length, evidence.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphEvidenceEntryCandidatesRust(
  candidateEntryIds: readonly string[],
  entries: readonly RustGraphEvidenceEntryRecord[],
  candidateLimit: number,
): RustGraphEvidenceEntryCandidatePlan | null {
  if (
    !candidateEntryIds.every(isStringValue) ||
    !entries.every(isGraphEvidenceEntryRecord) ||
    !Number.isFinite(candidateLimit)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_evidence_entry_candidates_json(
      JSON.stringify(candidateEntryIds),
      JSON.stringify(entries),
      normalizeNonNegativeInteger(candidateLimit),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphEvidenceEntryCandidatePlan(parsed, candidateEntryIds.length, entries.length)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphMentionContextRust(
  mentionNames: readonly string[],
  entities: readonly RustGraphMentionEntityInput[],
  relations: readonly RustGraphMentionRelationInput[],
): RustGraphMentionContextPlan | null {
  if (
    !mentionNames.every(isStringValue) ||
    !entities.every(isGraphMentionEntityInput) ||
    !relations.every(isGraphMentionRelationInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_mention_context_json(
      JSON.stringify(mentionNames),
      JSON.stringify(entities),
      JSON.stringify(relations),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphMentionContextPlan(parsed, entities.length, relations.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphClaimEntityIdsRust(
  entityNames: readonly string[],
  lookupRecords: readonly RustGraphClaimEntityLookupRecord[],
): string[] | null {
  if (!entityNames.every(isStringValue) || !lookupRecords.every(isGraphClaimEntityLookupRecord)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_claim_entity_ids_json(
      JSON.stringify(entityNames),
      JSON.stringify(lookupRecords),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphRelationEndpointIndicesRust(
  relations: readonly RustGraphRelationEndpointInput[],
  lookupRecords: readonly RustGraphRelationEndpointLookupRecord[],
  entityCount: number,
): RustGraphRelationEndpointPlan | null {
  if (
    !Number.isSafeInteger(entityCount) ||
    entityCount < 0 ||
    !relations.every(isGraphRelationEndpointInput) ||
    !lookupRecords.every((record) => isGraphRelationEndpointLookupRecord(record, entityCount))
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_relation_endpoint_indices_json(
      JSON.stringify(relations),
      JSON.stringify(lookupRecords),
      entityCount,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphRelationEndpointPlan(parsed, relations.length, entityCount)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphCommunitySummaryGroupsRust(
  assignments: readonly RustGraphCommunityAssignmentInput[],
  entityIds: readonly string[],
  relations: readonly RustGraphCommunitySummaryRelationInput[],
  claims: readonly RustGraphCommunitySummaryClaimInput[],
  communityIds: readonly number[],
): RustGraphCommunitySummaryGroupsPlan | null {
  if (
    !assignments.every(isGraphCommunityAssignmentInput) ||
    !entityIds.every(isStringValue) ||
    !relations.every(isGraphCommunitySummaryRelationInput) ||
    !claims.every(isGraphCommunitySummaryClaimInput) ||
    !communityIds.every(isValidNonNegativeInteger)
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return planGraphCommunitySummaryGroupsFallback(
      assignments,
      entityIds,
      relations,
      claims,
      communityIds,
    );
  }

  try {
    const raw = plan_graph_community_summary_groups_json(
      JSON.stringify(assignments),
      JSON.stringify(entityIds),
      JSON.stringify(relations),
      JSON.stringify(claims),
      JSON.stringify(communityIds),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isGraphCommunitySummaryGroupsPlan(
        parsed,
        entityIds.length,
        relations.length,
        claims.length,
        communityIds.length,
      )
    ) {
      return planGraphCommunitySummaryGroupsFallback(
        assignments,
        entityIds,
        relations,
        claims,
        communityIds,
      );
    }
    return parsed;
  } catch {
    return planGraphCommunitySummaryGroupsFallback(
      assignments,
      entityIds,
      relations,
      claims,
      communityIds,
    );
  }
}

export function planGraphCommunitySummaryGroupsFallback(
  assignments: readonly RustGraphCommunityAssignmentInput[],
  entityIds: readonly string[],
  relations: readonly RustGraphCommunitySummaryRelationInput[],
  claims: readonly RustGraphCommunitySummaryClaimInput[],
  communityIds: readonly number[],
): RustGraphCommunitySummaryGroupsPlan {
  const groups: RustGraphCommunitySummaryGroup[] = communityIds.map(() => ({
    entityIndices: [],
    relationIndices: [],
    claimIndices: [],
  }));

  const groupIndexByCommunityId = new Map<number, number>();
  for (let index = 0; index < communityIds.length; index++) {
    groupIndexByCommunityId.set(communityIds[index], index);
  }

  const entityIndexById = new Map<string, number>();
  for (let index = 0; index < entityIds.length; index++) {
    entityIndexById.set(entityIds[index], index);
  }

  const communityIdByEntityId = new Map<string, number>();
  for (const assignment of assignments) {
    const communityIndex = groupIndexByCommunityId.get(assignment.communityId);
    const entityIndex = entityIndexById.get(assignment.entityId);
    if (communityIndex === undefined || entityIndex === undefined) {
      continue;
    }
    groups[communityIndex]?.entityIndices.push(entityIndex);
    if (!communityIdByEntityId.has(assignment.entityId)) {
      communityIdByEntityId.set(assignment.entityId, assignment.communityId);
    }
  }

  for (let index = 0; index < relations.length; index++) {
    const relation = relations[index];
    if (!relation) {
      continue;
    }
    const sourceCommunityId = communityIdByEntityId.get(relation.sourceEntityId);
    const targetCommunityId = communityIdByEntityId.get(relation.targetEntityId);
    if (sourceCommunityId === undefined || targetCommunityId === undefined) {
      continue;
    }
    if (sourceCommunityId !== targetCommunityId) {
      continue;
    }
    const groupIndex = groupIndexByCommunityId.get(sourceCommunityId);
    if (groupIndex === undefined) continue;
    groups[groupIndex]?.relationIndices.push(index);
  }

  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index];
    if (!claim) {
      continue;
    }
    for (const entityId of claim.entityIds) {
      const communityId = communityIdByEntityId.get(entityId);
      if (communityId === undefined) {
        continue;
      }
      const groupIndex = groupIndexByCommunityId.get(communityId);
      if (groupIndex === undefined) {
        continue;
      }
      groups[groupIndex]?.claimIndices.push(index);
      break;
    }
  }

  return {
    groups,
  };
}

export function planFileIndexRecordsRust(
  entries: readonly RustFileIndexEntryInput[],
  updated: number,
): RustFileIndexRecordPlan[] | null {
  if (!Number.isFinite(updated) || !entries.every(isValidFileIndexEntryInput)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_file_index_records_json(JSON.stringify(entries), updated);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isFileIndexRecordPlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planEmptyFileIndexRecordRust(
  entry: RustFileIndexEntryInput,
  updated: number,
): RustFileIndexRecordPlan | null {
  const { sourceMtime, sourceSize, contentHash, indexedAt, embeddingProvider, embeddingModel } =
    entry;
  if (
    !Number.isFinite(updated) ||
    !isValidFileIndexEntryInput(entry) ||
    sourceMtime === undefined ||
    sourceSize === undefined ||
    contentHash === undefined ||
    indexedAt === undefined ||
    embeddingProvider === undefined ||
    embeddingModel === undefined
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_empty_file_index_record_json(
      JSON.stringify([
        {
          filePath: entry.filePath,
          sourceMtime,
          sourceSize,
          contentHash,
          indexedAt,
          embeddingProvider,
          embeddingModel,
        },
      ]),
      updated,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    const records: readonly unknown[] = Array.isArray(parsed) ? (parsed as readonly unknown[]) : [];
    const record: unknown = records[0];
    return isFileIndexRecordPlan(record) ? record : null;
  } catch {
    return null;
  }
}

export function planIndexedDbStorageLayoutRust(
  pluginId: string,
  vaultIdentity: string,
  legacyVaultName: string,
  embeddingNamespace: string,
): RustIndexedDbStorageLayout | null {
  if (
    ![pluginId, vaultIdentity, legacyVaultName, embeddingNamespace].every(
      (value) => isStringValue(value) && value.trim().length > 0,
    ) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_indexed_db_storage_layout_json(
      pluginId,
      vaultIdentity,
      legacyVaultName,
      embeddingNamespace,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isIndexedDbStorageLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planRagAutomaticRecoveryRust(
  files: readonly RustRagAutomaticRecoveryFileInput[],
  completedFingerprint: string,
  attempt: number,
  pendingDocumentCount = 0,
): RustRagAutomaticRecoveryPlan | null {
  if (
    !files.every(isRagAutomaticRecoveryFileInput) ||
    !isStringValue(completedFingerprint) ||
    !isValidNonNegativeInteger(attempt) ||
    !isValidNonNegativeInteger(pendingDocumentCount) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_rag_automatic_recovery_json(
      JSON.stringify(files),
      completedFingerprint,
      attempt,
      pendingDocumentCount,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRagAutomaticRecoveryPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planRagAutomaticRecoveryBatchRust(
  files: readonly RustRagAutomaticRecoveryFileInput[],
): RustRagAutomaticRecoveryBatchPlan | null {
  if (!files.every(isRagAutomaticRecoveryFileInput) || !ensureRustCore()) return null;
  try {
    const raw = plan_rag_automatic_recovery_batch_json(JSON.stringify(files));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRagAutomaticRecoveryBatchPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planRagStorageHealthRust(
  input: RustRagStorageHealthInput,
): RustRagStorageHealthPlan | null {
  if (!isRagStorageHealthInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_rag_storage_health_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRagStorageHealthPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function ragAutomaticRecoveryDelayMsRust(attempt: number): number | null {
  if (!isValidNonNegativeInteger(attempt) || !ensureRustCore()) return null;
  try {
    const delayMs = rag_automatic_recovery_delay_ms(attempt);
    return isValidNonNegativeInteger(delayMs) ? delayMs : null;
  } catch {
    return null;
  }
}

export function planRagPerformanceGuardRust(
  input: RustRagPerformanceGuardInput,
): RustRagPerformanceGuardPolicyState | null {
  if (!isRagPerformanceGuardInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_rag_performance_guard_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRagPerformanceGuardPolicyState(parsed, input.config) ? parsed : null;
  } catch {
    return null;
  }
}

export function createIndexedDbRecordKeyRust(namespace: string, value: string): string | null {
  if (!isStringValue(namespace) || namespace.trim().length === 0 || !ensureRustCore()) {
    return null;
  }
  try {
    const key = create_indexed_db_record_key(namespace, value);
    return /^[a-f0-9]{32}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function planIndexedDbBoundedCleanupRust(
  databaseNames: readonly string[],
  activeNames: readonly string[],
  ownedVaultPrefixes: readonly string[],
  legacyNames: readonly string[],
  maxDeletions: number,
): RustIndexedDbBoundedCleanupPlan | null {
  if (
    !databaseNames.every(isStringValue) ||
    !activeNames.every(isStringValue) ||
    !ownedVaultPrefixes.every((value) => isStringValue(value) && value.length > 0) ||
    !legacyNames.every(isStringValue) ||
    !isValidNonNegativeInteger(maxDeletions) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_indexed_db_bounded_cleanup_json(
      JSON.stringify(databaseNames),
      JSON.stringify(activeNames),
      JSON.stringify(ownedVaultPrefixes),
      JSON.stringify(legacyNames),
      maxDeletions,
    );
    const parsed: unknown = JSON.parse(raw);
    return isIndexedDbBoundedCleanupPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planIndexedDbBoundedRetentionRust(
  records: readonly RustIndexedDbRetentionRecord[],
  totalRecordCount: number,
  maxRecords: number,
  now: number,
  maxAgeMs: number,
  maxDeletions: number,
): RustIndexedDbBoundedRetentionPlan | null {
  if (
    !records.every(isIndexedDbRetentionRecord) ||
    ![totalRecordCount, maxRecords, maxDeletions].every(isValidNonNegativeInteger) ||
    !Number.isFinite(now) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0 ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_indexed_db_bounded_retention_json(
      JSON.stringify(records),
      totalRecordCount,
      maxRecords,
      now,
      maxAgeMs,
      maxDeletions,
    );
    const parsed: unknown = JSON.parse(raw);
    return isIndexedDbBoundedRetentionPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planStaleIndexSourcePathsRust(
  indexedPaths: readonly string[],
  validPaths: readonly string[],
  maxDeletions: number,
): RustStaleIndexSourcePathsPlan | null {
  if (
    !indexedPaths.every((path) => isStringValue(path) && path.length > 0) ||
    !validPaths.every((path) => isStringValue(path) && path.length > 0) ||
    !isValidNonNegativeInteger(maxDeletions) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_stale_index_source_paths_json(
      JSON.stringify(indexedPaths),
      JSON.stringify(validPaths),
      maxDeletions,
    );
    const parsed: unknown = JSON.parse(raw);
    return isStaleIndexSourcePathsPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planInactiveIndexedDbCleanupRust(
  input: RustInactiveIndexedDbCleanupInput,
): RustInactiveIndexedDbCleanupPlan | null {
  if (!isInactiveIndexedDbCleanupInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_inactive_indexed_db_cleanup_json(JSON.stringify(input));
    const parsed: unknown = JSON.parse(raw);
    return isInactiveIndexedDbCleanupPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planGraphStorageMaintenanceRust(
  input: RustGraphStorageMaintenanceInput,
): RustGraphStorageMaintenancePlan | null {
  if (!isGraphStorageMaintenanceInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_graph_storage_maintenance_json(JSON.stringify(input));
    const parsed: unknown = JSON.parse(raw);
    return isGraphStorageMaintenancePlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planPluginOwnedFileMaintenanceRust(
  input: RustPluginOwnedFileMaintenanceInput,
): RustPluginOwnedFileMaintenancePlan | null {
  if (!isPluginOwnedFileMaintenanceInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_plugin_owned_file_maintenance_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPluginOwnedFileMaintenancePlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planVectorFileIndexBatchRust(
  records: readonly RustVectorFileIndexBatchInput[],
  embeddingProvider: string,
  embeddingModel: string,
  maxDeletions: number,
): string[] | null {
  if (
    !records.every(isVectorFileIndexBatchInput) ||
    ![embeddingProvider, embeddingModel].every((value) => value.trim().length > 0) ||
    !isValidNonNegativeInteger(maxDeletions) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_vector_file_index_batch_json(
        JSON.stringify(records),
        embeddingProvider,
        embeddingModel,
        maxDeletions,
      ),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const paths = (parsed as { deleteFilePaths?: unknown }).deleteFilePaths;
    return Array.isArray(paths) && paths.every(isStringValue) ? paths : null;
  } catch {
    return null;
  }
}

export function planVectorRecordBatchRust(
  records: readonly RustVectorRecordBatchInput[],
  embeddingProvider: string,
  embeddingModel: string,
  expectedDimension: number,
  maxDeletions: number,
): string[] | null {
  if (
    !records.every(isVectorRecordBatchInput) ||
    ![embeddingProvider, embeddingModel].every((value) => value.trim().length > 0) ||
    !isValidNonNegativeInteger(expectedDimension) ||
    expectedDimension === 0 ||
    !isValidNonNegativeInteger(maxDeletions) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_vector_record_batch_json(
        JSON.stringify(records),
        embeddingProvider,
        embeddingModel,
        expectedDimension,
        maxDeletions,
      ),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const ids = (parsed as { deleteIds?: unknown }).deleteIds;
    return Array.isArray(ids) && ids.every(isStringValue) ? ids : null;
  } catch {
    return null;
  }
}

export function planVectorStoreAddRust(
  existingIds: readonly string[],
  incomingIds: readonly string[],
): RustVectorStoreMutationPlan | null {
  if (!existingIds.every(isStringValue) || !incomingIds.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planVectorStoreAddFallback(existingIds, incomingIds);
  }

  try {
    const raw = plan_vector_store_add_json(
      JSON.stringify(existingIds),
      JSON.stringify(incomingIds),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreMutationPlan(parsed)) return null;
    return parsed;
  } catch {
    return planVectorStoreAddFallback(existingIds, incomingIds);
  }
}

export function planVectorStoreReplaceFileRust(
  existingFilePaths: readonly string[],
  filePath: string,
  incomingCount: number,
): RustVectorStoreMutationPlan | null {
  if (
    !existingFilePaths.every(isStringValue) ||
    !isStringValue(filePath) ||
    !Number.isSafeInteger(incomingCount) ||
    incomingCount < 0
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return planVectorStoreReplaceFileFallback(existingFilePaths, filePath, incomingCount);
  }

  try {
    const raw = plan_vector_store_replace_file_json(
      JSON.stringify(existingFilePaths),
      filePath,
      incomingCount,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreMutationPlan(parsed)) return null;
    return parsed;
  } catch {
    return planVectorStoreReplaceFileFallback(existingFilePaths, filePath, incomingCount);
  }
}

export function planVectorStoreRemoveFileRust(
  existingFilePaths: readonly string[],
  filePath: string,
): RustVectorStoreMutationPlan | null {
  if (!existingFilePaths.every(isStringValue) || !isStringValue(filePath)) return null;
  if (!ensureRustCore()) {
    return planVectorStoreRemoveFileFallback(existingFilePaths, filePath);
  }

  try {
    const raw = plan_vector_store_remove_file_json(JSON.stringify(existingFilePaths), filePath);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreMutationPlan(parsed)) return null;
    return parsed;
  } catch {
    return planVectorStoreRemoveFileFallback(existingFilePaths, filePath);
  }
}

export function planVectorStoreStatsRust(
  filePaths: readonly string[],
  now: number,
): RustVectorStoreStatsPlan | null {
  if (!filePaths.every(isStringValue) || !Number.isFinite(now)) return null;
  if (!ensureRustCore()) {
    return planVectorStoreStatsFallback(filePaths, now);
  }

  try {
    const raw = plan_vector_store_stats_json(JSON.stringify(filePaths), now);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreStatsPlan(parsed)) return null;
    return parsed;
  } catch {
    return planVectorStoreStatsFallback(filePaths, now);
  }
}

export function planVectorStoreLookupByFilePathsRust(
  entryFilePaths: readonly string[],
  requestedFilePaths: readonly string[],
): number[] | null {
  if (!entryFilePaths.every(isStringValue) || !requestedFilePaths.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planVectorStoreLookupByFilePathsFallback(entryFilePaths, requestedFilePaths);
  }

  try {
    const raw = plan_vector_store_lookup_by_file_paths_json(
      JSON.stringify(entryFilePaths),
      JSON.stringify(requestedFilePaths),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreIndexPlan(parsed, entryFilePaths.length)) return null;
    return parsed;
  } catch {
    return planVectorStoreLookupByFilePathsFallback(entryFilePaths, requestedFilePaths);
  }
}

export function planVectorStoreLookupByIdsRust(
  entryIds: readonly string[],
  requestedIds: readonly string[],
): number[] | null {
  if (!entryIds.every(isStringValue) || !requestedIds.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planVectorStoreLookupByIdsFallback(entryIds, requestedIds);
  }

  try {
    const raw = plan_vector_store_lookup_by_ids_json(
      JSON.stringify(entryIds),
      JSON.stringify(requestedIds),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isVectorStoreIndexPlan(parsed, entryIds.length)) return null;
    return parsed;
  } catch {
    return planVectorStoreLookupByIdsFallback(entryIds, requestedIds);
  }
}

function planVectorStoreAddFallback(
  existingIds: readonly string[],
  incomingIds: readonly string[],
): RustVectorStoreMutationPlan {
  const latestIncomingIndexById = new Map<string, number>();
  for (let index = 0; index < incomingIds.length; index++) {
    latestIncomingIndexById.set(incomingIds[index], index);
  }

  const existingIdSet = new Set(existingIds);
  const usedIncomingIndices = new Set<number>();
  const sources: RustVectorStoreSourcePlan[] = existingIds.map((_, index) => ({
    source: 'existing',
    index,
  }));

  for (let index = 0; index < existingIds.length; index++) {
    const path = existingIds[index];
    const incomingIndex = latestIncomingIndexById.get(path);
    if (incomingIndex === undefined) continue;
    usedIncomingIndices.add(incomingIndex);
    sources[index] = {
      source: 'incoming',
      index: incomingIndex,
    };
  }

  for (let index = 0; index < incomingIds.length; index++) {
    const path = incomingIds[index];
    const isLatestForId = latestIncomingIndexById.get(path) === index;
    if (!isLatestForId || existingIdSet.has(path)) continue;
    usedIncomingIndices.add(index);
    sources.push({
      source: 'incoming',
      index,
    });
  }

  return {
    sources,
    removedCount: 0,
    changed: usedIncomingIndices.size > 0,
  };
}

function planVectorStoreReplaceFileFallback(
  existingFilePaths: readonly string[],
  filePath: string,
  incomingCount: number,
): RustVectorStoreMutationPlan {
  const sources: RustVectorStoreSourcePlan[] = [];
  let incomingIndex = 0;
  let removedCount = 0;

  for (let index = 0; index < existingFilePaths.length; index++) {
    const path = existingFilePaths[index];
    if (path === filePath) {
      removedCount += 1;
      if (incomingIndex < incomingCount) {
        sources.push({ source: 'incoming', index: incomingIndex++ });
      }
    } else {
      sources.push({ source: 'existing', index });
    }
  }

  while (incomingIndex < incomingCount) {
    sources.push({ source: 'incoming', index: incomingIndex++ });
  }

  return {
    sources,
    removedCount,
    changed: removedCount > 0 || incomingCount > 0,
  };
}

function planVectorStoreRemoveFileFallback(
  existingFilePaths: readonly string[],
  filePath: string,
): RustVectorStoreMutationPlan {
  const sources: RustVectorStoreSourcePlan[] = [];
  let removedCount = 0;

  for (let index = 0; index < existingFilePaths.length; index++) {
    const path = existingFilePaths[index];
    if (path === filePath) {
      removedCount += 1;
    } else {
      sources.push({ source: 'existing', index });
    }
  }

  return {
    sources,
    removedCount,
    changed: removedCount > 0,
  };
}

function planVectorStoreLookupByFilePathsFallback(
  entryFilePaths: readonly string[],
  requestedFilePaths: readonly string[],
): number[] {
  const requested = new Set(requestedFilePaths);
  const indexes: number[] = [];
  for (let index = 0; index < entryFilePaths.length; index++) {
    const path = entryFilePaths[index];
    if (path !== undefined && requested.has(path)) {
      indexes.push(index);
    }
  }
  return indexes;
}

function planVectorStoreLookupByIdsFallback(
  entryIds: readonly string[],
  requestedIds: readonly string[],
): number[] {
  const locationById = new Map<string, number>();
  for (let index = 0; index < entryIds.length; index++) {
    const entryId = entryIds[index];
    if (!locationById.has(entryId)) {
      locationById.set(entryId, index);
    }
  }

  const indexes: number[] = [];
  for (const requestedId of requestedIds) {
    const found = locationById.get(requestedId);
    if (found !== undefined) {
      indexes.push(found);
    }
  }

  return indexes;
}

function planVectorStoreStatsFallback(
  filePaths: readonly string[],
  now: number,
): RustVectorStoreStatsPlan {
  const fileSet = new Set(filePaths);
  const indexedFilePaths = [...fileSet];
  indexedFilePaths.sort();

  return {
    totalEntries: filePaths.length,
    totalFiles: fileSet.size,
    totalVectors: filePaths.length,
    averageVectorsPerFile: fileSet.size > 0 ? filePaths.length / fileSet.size : 0,
    lastUpdated: fileSet.size > 0 ? now : null,
    indexedFilePaths,
  };
}

function normalizeEntityNameFallback(name: string): string {
  let normalized = '';
  let lastWasSpace = true;
  for (const character of name.trim().toLowerCase()) {
    if (isEntityNameSeparatorFallback(character) || /\s/.test(character)) {
      if (!lastWasSpace) {
        normalized += ' ';
        lastWasSpace = true;
      }
      continue;
    }
    normalized += character;
    lastWasSpace = false;
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function isEntityNameSeparatorFallback(character: string): boolean {
  return (
    character === '_' ||
    character === '/' ||
    character === '\\' ||
    character === '|' ||
    character === '(' ||
    character === ')' ||
    character === '[' ||
    character === ']' ||
    character === '{' ||
    character === '}' ||
    character === '"' ||
    character === "'" ||
    character === '「' ||
    character === '」' ||
    character === '『' ||
    character === '』' ||
    character === '【' ||
    character === '】' ||
    character === '《' ||
    character === '》' ||
    character === '.' ||
    character === ',' ||
    character === ';' ||
    character === ':' ||
    character === '!' ||
    character === '?'
  );
}

function normalizeGraphNameFallback(name: string): string {
  return normalizeEntityNameFallback(name);
}

export function createEntityIdFallback(
  ontologySchemaId: string,
  typeId: string,
  canonicalName: string,
): string {
  return `entity::${sanitizeGraphIdPartFallback(ontologySchemaId)}::${sanitizeGraphIdPartFallback(typeId)}::${sanitizeGraphIdPartFallback(
    normalizeEntityNameFallback(canonicalName).replace(/ /g, '-'),
  )}`;
}

function sanitizeGraphIdPartFallback(part: string): string {
  let sanitized = '';
  let lastWasReplacement = false;
  for (const character of part.trim().toLowerCase()) {
    if (isGraphIdPartCharacterFallback(character)) {
      sanitized += character;
      lastWasReplacement = false;
    } else if (!lastWasReplacement) {
      sanitized += '-';
      lastWasReplacement = true;
    }
  }
  return sanitized;
}

function isGraphIdPartCharacterFallback(character: string): boolean {
  if (character.length === 0) return false;
  const code = character.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    character === '_' ||
    character === '.' ||
    character === ':' ||
    character === '-' ||
    (code >= 0xac00 && code <= 0xd7a3)
  );
}

function planEntityResolutionFallback(input: RustEntityResolutionInput): RustEntityResolutionPlan {
  let topCandidate: RustEntityResolutionCandidate | null = null;
  for (const candidate of input.candidates) {
    if (
      candidate.ontologySchemaId !== input.ontologySchemaId ||
      candidate.typeId !== input.typeId
    ) {
      continue;
    }
    if (!topCandidate || candidate.score > topCandidate.score) {
      topCandidate = candidate;
    }
  }

  if (!topCandidate) {
    return {
      status: 'new',
      entityId: input.candidateEntityId,
      mergeScore: 0,
      matchedEntityId: undefined,
    };
  }

  if (topCandidate.score >= input.autoMergeThreshold) {
    return {
      status: 'auto-merge',
      entityId: topCandidate.entityId,
      mergeScore: topCandidate.score,
      matchedEntityId: topCandidate.entityId,
    };
  }

  if (topCandidate.score >= input.pendingMergeThreshold) {
    return {
      status: 'pending-merge',
      entityId: input.candidateEntityId,
      mergeScore: topCandidate.score,
      matchedEntityId: topCandidate.entityId,
    };
  }

  return {
    status: 'new',
    entityId: input.candidateEntityId,
    mergeScore: topCandidate.score,
    matchedEntityId: topCandidate.entityId,
  };
}

function isRagDocumentStatusOrder(status: RustRagDocumentStatus): number {
  switch (status) {
    case 'missing':
      return 0;
    case 'stale':
      return 1;
    case 'unknown':
      return 2;
    default:
      return 3;
  }
}

function isLegacyRagRecordFallback(record: RustRagStatusRecordInput): boolean {
  return (
    record.hasCompleteMetadata !== true ||
    record.sourceMtime === undefined ||
    record.sourceSize === undefined ||
    record.contentHash === undefined ||
    record.indexedAt === undefined ||
    record.embeddingProvider === undefined ||
    record.embeddingModel === undefined
  );
}

function ragFileIndexStateFallback(
  file: RustRagStatusFileInput,
  record: RustRagStatusRecordInput | undefined,
  reasons: RustRagStatusReasonLabels,
  inputEmbeddingProvider: string,
  inputEmbeddingModel: string,
): { status: RustRagDocumentStatus; reason: string } {
  if (!record) {
    return { status: 'missing', reason: reasons.missing };
  }
  if (isLegacyRagRecordFallback(record)) {
    return { status: 'unknown', reason: reasons.legacy };
  }
  if (record.sourceMtime !== file.mtime || record.sourceSize !== file.size) {
    return { status: 'stale', reason: reasons.staleFile };
  }
  if (
    record.embeddingProvider !== inputEmbeddingProvider ||
    record.embeddingModel !== inputEmbeddingModel
  ) {
    return { status: 'stale', reason: reasons.embeddingChanged };
  }

  return { status: 'healthy', reason: '' };
}

function normalizeGraphRagMaxFilesPerRunFallback(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  return Math.max(1, Number.isFinite(floored) ? floored : 1);
}

export function planRagStatusFallback(input: RustRagStatusInput): RustRagStatusPlan {
  const recordByPath = new Map<string, RustRagStatusRecordInput>();
  for (const record of input.records) {
    recordByPath.set(record.filePath, record);
  }

  let healthyDocuments = 0;
  let missingDocuments = 0;
  let staleDocuments = 0;
  let unknownDocuments = 0;
  const updateRequiredDocuments: RustRagDocumentUpdatePlan[] = [];

  for (const file of input.includedFiles) {
    const record = recordByPath.get(file.path);
    const { status, reason } = ragFileIndexStateFallback(
      file,
      record,
      input.reasons,
      input.embeddingProvider,
      input.embeddingModel,
    );
    switch (status) {
      case 'healthy':
        healthyDocuments += 1;
        break;
      case 'missing':
        missingDocuments += 1;
        updateRequiredDocuments.push({
          path: file.path,
          status,
          reason,
          mtime: file.mtime,
          size: file.size,
        });
        break;
      case 'stale':
        staleDocuments += 1;
        updateRequiredDocuments.push({
          path: file.path,
          status,
          reason,
          mtime: file.mtime,
          size: file.size,
        });
        break;
      case 'unknown':
        unknownDocuments += 1;
        updateRequiredDocuments.push({
          path: file.path,
          status,
          reason,
          mtime: file.mtime,
          size: file.size,
        });
        break;
    }
  }

  updateRequiredDocuments.sort((left, right) => {
    const leftOrder = isRagDocumentStatusOrder(left.status);
    const rightOrder = isRagDocumentStatusOrder(right.status);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.path.localeCompare(right.path);
  });

  return {
    totalDocuments: input.includedFiles.length,
    healthyDocuments,
    missingDocuments,
    staleDocuments,
    unknownDocuments,
    excludedDocuments: input.totalVaultFiles - input.includedFiles.length,
    totalVectors: input.records.reduce(
      (sum, record) => sum + (Number.isFinite(record.vectorCount) ? record.vectorCount : 0),
      0,
    ),
    updateRequiredDocuments,
  };
}

export function planGraphRagStatusEntryLookupsFallback(
  evidenceEntryIds: readonly string[],
  cacheEntryIds: readonly string[],
): string[] {
  const seen = new Set<string>();
  const entryIds: string[] = [];
  for (const entryId of evidenceEntryIds) {
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    entryIds.push(entryId);
  }
  for (const entryId of cacheEntryIds) {
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    entryIds.push(entryId);
  }
  return entryIds;
}

function isGraphRagMarkdownFilePathFallback(filePath: string): boolean {
  const markdownPaths = planGraphRagMarkdownFilePathsRust([filePath]);
  return markdownPaths?.[0] === filePath;
}

function sortedUniqueGraphRagMarkdownPathsFallback(filePaths: readonly string[]): string[] {
  return planGraphRagMarkdownFilePathsRust(filePaths) ?? [];
}

export function planGraphRagStatusFileSnapshotFallback(
  fileRecords: readonly RustGraphRagStatusFileSnapshotRecordInput[],
  indexedFilePaths: readonly RustGraphRagRunFilePathInput[],
): RustGraphRagStatusFileSnapshotPlan {
  const seenRecordPaths = new Set<string>();
  const fileRecordIndices: number[] = [];
  for (let index = 0; index < fileRecords.length; index++) {
    const record = fileRecords[index];
    if (
      record.vectorCount === 0 ||
      !record.processable ||
      !isGraphRagMarkdownFilePathFallback(record.filePath)
    ) {
      continue;
    }
    if (!seenRecordPaths.has(record.filePath)) {
      seenRecordPaths.add(record.filePath);
      fileRecordIndices.push(index);
    }
  }

  if (fileRecordIndices.length > 0) {
    return {
      fileRecordIndices,
      totalCandidateFiles: fileRecordIndices.length,
    };
  }

  return {
    fileRecordIndices,
    totalCandidateFiles: sortedUniqueGraphRagMarkdownPathsFallback(
      indexedFilePaths.filter((row) => row.processable).map((row) => row.filePath),
    ).length,
  };
}

export function planGraphRagStatusEntrySnapshotFallback(
  entries: readonly RustGraphRagStatusEntrySnapshotInput[],
): RustGraphRagStatusEntrySnapshotPlan {
  const seenEntryIds = new Set<string>();
  const entryIndices: number[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry.processable || !isGraphRagMarkdownFilePathFallback(entry.filePath)) {
      continue;
    }
    if (!seenEntryIds.has(entry.id)) {
      seenEntryIds.add(entry.id);
      entryIndices.push(index);
    }
  }
  return { entryIndices };
}

function countUniqueValuesFallback(values: readonly string[]): number {
  const unique = new Set<string>(values);
  return unique.size;
}

function resolveEntryContentHashFallback(entry: RustGraphRagStatusEntryInput): string {
  if (entry.contentHash !== undefined) {
    return entry.contentHash;
  }
  const rustHash = createContentHashRust(entry.text);
  if (rustHash !== null) {
    return rustHash;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < entry.text.length; index++) {
    hash ^= entry.text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function filePathForMissingGraphEntryFallback(
  entryId: string,
  evidence: readonly RustGraphRagStatusEvidenceInput[],
): string {
  for (const record of evidence) {
    if (record.entryId === entryId) {
      return record.filePath;
    }
  }
  const firstSegment = entryId.split('::')[0];
  return firstSegment || entryId;
}

function collectFreshGraphRagCacheCountsFallback(
  input: RustGraphRagStatusInput,
  cacheByEntryId: Map<string, RustGraphRagStatusCacheInput>,
  staleFilePathSet: Set<string>,
): Map<string, number> {
  const freshCountsByFilePath = new Map<string, number>();
  for (const entry of input.entries) {
    const cache = cacheByEntryId.get(entry.id);
    if (!cache) {
      staleFilePathSet.add(filePathForMissingGraphEntryFallback(entry.id, input.evidence));
      continue;
    }
    const contentHash = resolveEntryContentHashFallback(entry);
    if (
      cache.contentHash !== contentHash ||
      cache.extractionModelKey !== input.graphRagModel ||
      cache.ontologySchemaId !== input.ontologySchemaId ||
      cache.ontologyVersion !== input.ontologyVersion
    ) {
      staleFilePathSet.add(entry.filePath);
      continue;
    }
    const next = freshCountsByFilePath.get(entry.filePath) ?? 0;
    freshCountsByFilePath.set(entry.filePath, next + 1);
  }
  return freshCountsByFilePath;
}

function collectGraphRagStaleFilesFallback(input: RustGraphRagStatusInput): string[] {
  const vectorFilePaths = new Set<string>();
  for (const record of input.fileRecords) {
    vectorFilePaths.add(record.filePath);
  }

  const cacheByEntryId = new Map<string, RustGraphRagStatusCacheInput>();
  for (const record of input.cacheRecords) {
    cacheByEntryId.set(record.entryId, record);
  }

  const entriesById = new Map<string, RustGraphRagStatusEntryInput>();
  for (const entry of input.entries) {
    entriesById.set(entry.id, entry);
  }

  const staleFilePathSet = new Set<string>();

  for (const evidence of input.evidence) {
    if (!evidence.processable || !vectorFilePaths.has(evidence.filePath)) {
      staleFilePathSet.add(evidence.filePath);
    }
  }

  for (const cache of input.cacheRecords) {
    if (!entriesById.has(cache.entryId)) {
      staleFilePathSet.add(filePathForMissingGraphEntryFallback(cache.entryId, input.evidence));
    }
  }

  for (const evidence of input.evidence) {
    const entry = entriesById.get(evidence.entryId);
    if (!entry) {
      staleFilePathSet.add(evidence.filePath);
      continue;
    }
    const contentHash = resolveEntryContentHashFallback(entry);
    if (
      evidence.contentHash !== contentHash ||
      evidence.extractionModelKey !== input.graphRagModel
    ) {
      staleFilePathSet.add(evidence.filePath);
    }
  }

  const freshCacheCountByFilePath = collectFreshGraphRagCacheCountsFallback(
    input,
    cacheByEntryId,
    staleFilePathSet,
  );
  for (const record of input.fileRecords) {
    const freshCacheCount = freshCacheCountByFilePath.get(record.filePath) ?? 0;
    if (freshCacheCount < record.vectorCount) {
      staleFilePathSet.add(record.filePath);
    }
  }

  return [...staleFilePathSet].sort((left, right) => left.localeCompare(right));
}

function determineGraphRagStatusStateFallback(
  staleFilePaths: readonly string[],
  failedFileCount: number,
): RustGraphRagIndexState {
  return staleFilePaths.length === 0 ? (failedFileCount > 0 ? 'partial' : 'ready') : 'stale';
}

function emptyGraphRagStatusFallback(
  state: RustGraphRagIndexState,
  totalCandidateFiles: number,
  maxFilesPerRun: number,
): RustGraphRagStatusPlan {
  return {
    state,
    totalCandidateFiles,
    graphEvidenceCount: 0,
    rejectedFactCount: 0,
    failedFileCount: 0,
    pendingMergeCount: 0,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun,
  };
}

function buildingGraphRagStatusFallback(
  input: RustGraphRagStatusInput,
  failedFileCount: number,
  maxFilesPerRun: number,
): RustGraphRagStatusPlan {
  return {
    state: 'building',
    totalCandidateFiles: input.totalCandidateFiles,
    graphEvidenceCount: input.evidence.length,
    rejectedFactCount: input.rejectedFactFilePaths.length,
    failedFileCount,
    pendingMergeCount: input.pendingMergeCount,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun,
  };
}

export function planGraphRagStatusFallback(input: RustGraphRagStatusInput): RustGraphRagStatusPlan {
  const maxFilesPerRun = normalizeGraphRagMaxFilesPerRunFallback(input.graphRagMaxFilesPerRun);
  if (!input.graphRagEnabled) {
    return emptyGraphRagStatusFallback('disabled', input.totalCandidateFiles, maxFilesPerRun);
  }
  const failedFileCount = countUniqueValuesFallback(input.rejectedFactFilePaths);
  if (input.isRunning) {
    return buildingGraphRagStatusFallback(input, failedFileCount, maxFilesPerRun);
  }
  if (input.evidence.length === 0) {
    return {
      state: 'not-built',
      totalCandidateFiles: input.totalCandidateFiles,
      graphEvidenceCount: 0,
      rejectedFactCount: input.rejectedFactFilePaths.length,
      failedFileCount,
      pendingMergeCount: 0,
      staleFileCount: 0,
      staleFilePaths: [],
      maxFilesPerRun,
    };
  }

  const staleFilePaths = collectGraphRagStaleFilesFallback(input);
  const state = determineGraphRagStatusStateFallback(staleFilePaths, failedFileCount);

  return {
    state,
    totalCandidateFiles: input.totalCandidateFiles,
    graphEvidenceCount: input.evidence.length,
    rejectedFactCount: input.rejectedFactFilePaths.length,
    failedFileCount,
    pendingMergeCount: input.pendingMergeCount,
    staleFileCount: staleFilePaths.length,
    staleFilePaths,
    maxFilesPerRun,
  };
}

function mergeOrderedStringsFallback(left: readonly string[], right: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of left) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  for (const value of right) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

export function planGraphEntityMergeFallback(
  existingRecord: RustGraphEntityMergeInput,
  nextRecord: RustGraphEntityMergeInput,
): RustGraphEntityMergePlan {
  return {
    aliases: mergeOrderedStringsFallback(existingRecord.aliases, nextRecord.aliases),
    description:
      nextRecord.description.length === 0 ? existingRecord.description : nextRecord.description,
    confidence: Math.max(existingRecord.confidence, nextRecord.confidence),
    evidenceIds: mergeOrderedStringsFallback(existingRecord.evidenceIds, nextRecord.evidenceIds),
    updatedAt: nextRecord.updatedAt,
  };
}

export function rewriteGraphEntityReferencesFallback(
  references: readonly string[],
  candidateEntityId: string,
  existingEntityId: string,
  deduplicate: boolean,
): string[] {
  const rewritten = references.map((reference) =>
    reference === candidateEntityId ? existingEntityId : reference,
  );
  return deduplicate ? [...new Set(rewritten)] : rewritten;
}

export function isGraphExtractionCacheHitFallback(
  cachedRecord: RustGraphExtractionCacheKey | null,
  input: RustGraphExtractionCacheKey,
): boolean {
  if (cachedRecord === null) {
    return false;
  }
  return (
    cachedRecord.entryId === input.entryId &&
    cachedRecord.contentHash === input.contentHash &&
    cachedRecord.extractionModelKey === input.extractionModelKey &&
    cachedRecord.ontologySchemaId === input.ontologySchemaId &&
    cachedRecord.ontologyVersion === input.ontologyVersion &&
    cachedRecord.extractionContractVersion === input.extractionContractVersion
  );
}

export function planRagStatusRust(input: RustRagStatusInput): RustRagStatusPlan | null {
  if (
    !input.includedFiles.every(isValidRagStatusFileInput) ||
    !input.records.every(isValidRagStatusRecordInput) ||
    !isValidNonNegativeInteger(input.totalVaultFiles) ||
    !isStringValue(input.embeddingProvider) ||
    !isStringValue(input.embeddingModel) ||
    !isValidRagStatusReasonLabels(input.reasons)
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return planRagStatusFallback(input);
  }

  try {
    const raw = plan_rag_status_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRagStatusPlan(parsed)) return null;
    return parsed;
  } catch {
    return planRagStatusFallback(input);
  }
}

export function planIndexPendingFilesRust(
  filePaths: readonly string[],
  updatePaths: readonly string[],
): RustIndexPendingPlan | null {
  if (!filePaths.every(isStringValue) || !updatePaths.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planIndexPendingFilesFallback(filePaths, updatePaths);
  }

  try {
    const raw = plan_index_pending_files_json(
      JSON.stringify(filePaths),
      JSON.stringify(updatePaths),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isIndexPendingPlan(parsed, filePaths.length)) return null;
    return parsed;
  } catch {
    return planIndexPendingFilesFallback(filePaths, updatePaths);
  }
}

export function planIndexPendingFilesFallback(
  filePaths: readonly string[],
  updatePaths: readonly string[],
): RustIndexPendingPlan {
  const updatePathSet = new Set(updatePaths);
  const fileIndices: number[] = [];
  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    if (updatePathSet.has(filePath)) {
      fileIndices.push(index);
    }
  }
  return {
    fileIndices,
    skipped: Math.max(filePaths.length - fileIndices.length, 0),
  };
}

export function planRagIndexingEtaRust(
  input: RustRagIndexingEtaInput,
): RustRagIndexingEtaPlan | null {
  if (!isValidRagIndexingEtaInput(input)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rag_indexing_eta_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRagIndexingEtaPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphDeletionIndicesRust(
  recordKeys: readonly string[],
  requestedKeys: readonly string[],
): number[] | null {
  if (!recordKeys.every(isStringValue) || !requestedKeys.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planGraphDeletionIndicesFallback(recordKeys, requestedKeys);
  }

  try {
    const raw = plan_graph_deletion_indices_json(
      JSON.stringify(recordKeys),
      JSON.stringify(requestedKeys),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBoundedIndexArray(parsed, recordKeys.length)) return null;
    return parsed;
  } catch {
    return planGraphDeletionIndicesFallback(recordKeys, requestedKeys);
  }
}

function planGraphDeletionIndicesFallback(
  recordKeys: readonly string[],
  requestedKeys: readonly string[],
): number[] {
  if (recordKeys.length === 0 || requestedKeys.length === 0) return [];
  const requested = new Set(requestedKeys);
  const deletionIndices: number[] = [];
  for (let index = 0; index < recordKeys.length; index++) {
    if (requested.has(recordKeys[index])) {
      deletionIndices.push(index);
    }
  }
  return deletionIndices;
}

export function planGraphRagStatusEntryLookupsRust(
  evidenceEntryIds: readonly string[],
  cacheEntryIds: readonly string[],
): string[] | null {
  if (!evidenceEntryIds.every(isStringValue) || !cacheEntryIds.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return planGraphRagStatusEntryLookupsFallback(evidenceEntryIds, cacheEntryIds);
  }

  try {
    const raw = plan_graph_rag_status_entry_lookups_json(
      JSON.stringify(evidenceEntryIds),
      JSON.stringify(cacheEntryIds),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return planGraphRagStatusEntryLookupsFallback(evidenceEntryIds, cacheEntryIds);
  }
}

export function planGraphRagMarkdownFilePathsRust(filePaths: readonly string[]): string[] | null {
  if (!filePaths.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_rag_markdown_file_paths_json(JSON.stringify(filePaths));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphRagStatusFileSnapshotRust(
  fileRecords: readonly RustGraphRagStatusFileSnapshotRecordInput[],
  indexedFilePaths: readonly RustGraphRagRunFilePathInput[],
): RustGraphRagStatusFileSnapshotPlan | null {
  if (
    !fileRecords.every(isValidGraphRagStatusFileSnapshotRecordInput) ||
    !indexedFilePaths.every(isValidGraphRagRunFilePathInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return planGraphRagStatusFileSnapshotFallback(fileRecords, indexedFilePaths);
  }

  try {
    const raw = plan_graph_rag_status_file_snapshot_json(
      JSON.stringify(fileRecords),
      JSON.stringify(indexedFilePaths),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphRagStatusFileSnapshotPlan(parsed, fileRecords.length)) return null;
    return parsed;
  } catch {
    return planGraphRagStatusFileSnapshotFallback(fileRecords, indexedFilePaths);
  }
}

export function planGraphRagStatusEntrySnapshotRust(
  entries: readonly RustGraphRagStatusEntrySnapshotInput[],
): RustGraphRagStatusEntrySnapshotPlan | null {
  if (!entries.every(isValidGraphRagStatusEntrySnapshotInput)) return null;
  if (!ensureRustCore()) {
    return planGraphRagStatusEntrySnapshotFallback(entries);
  }

  try {
    const raw = plan_graph_rag_status_entry_snapshot_json(JSON.stringify(entries));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphRagStatusEntrySnapshotPlan(parsed, entries.length)) return null;
    return parsed;
  } catch {
    return planGraphRagStatusEntrySnapshotFallback(entries);
  }
}

export function planGraphRagRunFileSelectionRust(
  input: RustGraphRagRunFileSelectionInput,
): RustGraphRagRunFileSelectionPlan | null {
  if (!isValidGraphRagRunFileSelectionInput(input)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_rag_run_file_selection_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphRagRunFileSelectionPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphRagUnsupportedPrunePathsRust(
  evidence: readonly RustGraphRagRunFilePathInput[],
  rejectedFacts: readonly RustGraphRagRunFilePathInput[],
): string[] | null {
  if (
    !evidence.every(isValidGraphRagRunFilePathInput) ||
    !rejectedFacts.every(isValidGraphRagRunFilePathInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_rag_unsupported_prune_paths_json(
      JSON.stringify(evidence),
      JSON.stringify(rejectedFacts),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphRagStatusRust(
  input: RustGraphRagStatusInput,
): RustGraphRagStatusPlan | null {
  if (!isValidGraphRagStatusInput(input)) return null;
  if (!ensureRustCore()) return planGraphRagStatusFallback(input);

  try {
    const raw = plan_graph_rag_status_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphRagStatusPlan(parsed)) return null;
    return parsed;
  } catch {
    return planGraphRagStatusFallback(input);
  }
}

export function planGraphEntityMergeRust(
  existing: RustGraphEntityMergeInput,
  next: RustGraphEntityMergeInput,
): RustGraphEntityMergePlan | null {
  if (!isValidGraphEntityMergeInput(existing) || !isValidGraphEntityMergeInput(next)) return null;
  if (!ensureRustCore()) {
    return planGraphEntityMergeFallback(existing, next);
  }

  try {
    const raw = plan_graph_entity_merge_json(JSON.stringify(existing), JSON.stringify(next));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphEntityMergePlan(parsed)) return null;
    return parsed;
  } catch {
    return planGraphEntityMergeFallback(existing, next);
  }
}

export function rewriteGraphEntityReferencesRust(
  references: readonly string[],
  candidateEntityId: string,
  existingEntityId: string,
  deduplicate: boolean,
): string[] | null {
  if (
    !references.every(isStringValue) ||
    candidateEntityId.length === 0 ||
    existingEntityId.length === 0
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return rewriteGraphEntityReferencesFallback(
      references,
      candidateEntityId,
      existingEntityId,
      deduplicate,
    );
  }

  try {
    const raw = rewrite_graph_entity_references_json(
      JSON.stringify(references),
      candidateEntityId,
      existingEntityId,
      deduplicate,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isStringValue) ? parsed : null;
  } catch {
    return rewriteGraphEntityReferencesFallback(
      references,
      candidateEntityId,
      existingEntityId,
      deduplicate,
    );
  }
}

export function isSameGraphEntityPairRust(
  firstLeft: string,
  firstRight: string,
  secondLeft: string,
  secondRight: string,
): boolean {
  if (!ensureRustCore()) {
    return (
      (firstLeft === secondLeft && firstRight === secondRight) ||
      (firstLeft === secondRight && firstRight === secondLeft)
    );
  }
  return is_same_graph_entity_pair(firstLeft, firstRight, secondLeft, secondRight);
}

export function isGraphExtractionCacheHitRust(
  cached: RustGraphExtractionCacheKey | null,
  input: RustGraphExtractionCacheKey,
): boolean | null {
  if (cached !== null && !isValidGraphExtractionCacheKey(cached)) return null;
  if (!isValidGraphExtractionCacheKey(input)) return null;
  if (!ensureRustCore()) return isGraphExtractionCacheHitFallback(cached, input);

  try {
    const raw = is_graph_extraction_cache_hit_json(JSON.stringify(cached), JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : null;
  } catch {
    return isGraphExtractionCacheHitFallback(cached, input);
  }
}

export function graphExtractionContractVersionRust(): number {
  if (!ensureRustCore()) return 1;
  try {
    const version = graph_extraction_contract_version();
    return isValidNonNegativeInteger(version) ? version : 1;
  } catch {
    return 1;
  }
}

export interface RustGraphExtractionFailurePlan {
  code: string;
  retryable: boolean;
  opensCircuit: boolean;
  nextAttemptAt: number;
}

export function planGraphExtractionFailureRust(input: {
  message: string;
  status?: number;
  attemptCount: number;
  consecutiveFailures: number;
  now: number;
  retryAfterMs?: number;
}): RustGraphExtractionFailurePlan | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_graph_extraction_failure_json(
      input.message,
      input.status ?? 0,
      input.attemptCount,
      input.consecutiveFailures,
      input.now,
      input.retryAfterMs ?? Number.NaN,
    );
    const value: unknown = JSON.parse(raw);
    if (!isStringRecordValueMap(value)) return null;
    if (
      !isStringValue(value.code) ||
      typeof value.retryable !== 'boolean' ||
      typeof value.opensCircuit !== 'boolean' ||
      typeof value.nextAttemptAt !== 'number' ||
      !Number.isFinite(value.nextAttemptAt)
    ) {
      return null;
    }
    return {
      code: value.code,
      retryable: value.retryable,
      opensCircuit: value.opensCircuit,
      nextAttemptAt: value.nextAttemptAt,
    };
  } catch {
    return null;
  }
}

export function planRagFileTypeSummaryRust(
  files: readonly RustRagFileTypeInput[],
  noExtensionLabel: string,
): RustRagFileTypeSummary | null {
  if (!isStringValue(noExtensionLabel) || !files.every(isValidRagFileTypeInput)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rag_file_type_summary_json(JSON.stringify(files), noExtensionLabel);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRagFileTypeSummary(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planPromptLibrarySummaryRust(
  entries: readonly RustPromptLibrarySummaryInput[],
): RustPromptLibrarySummary | null {
  if (!entries.every(isValidPromptLibrarySummaryInput)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_prompt_library_summary_json(JSON.stringify(entries));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPromptLibrarySummary(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planRagFileContentProbeIndicesRust(
  files: readonly RustRagFileEligibilityInput[],
  excludePaths: readonly string[],
  excludeExts: readonly string[],
): number[] | null {
  if (
    !files.every(isValidRagFileEligibilityInput) ||
    !excludePaths.every(isStringValue) ||
    !excludeExts.every(isStringValue)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rag_file_content_probe_indices_json(
      JSON.stringify(files),
      JSON.stringify(excludePaths),
      JSON.stringify(excludeExts),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isNonNegativeIntegerArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planRagFileIndexabilityRust(
  files: readonly RustRagFileEligibilityInput[],
  excludePaths: readonly string[],
  excludeExts: readonly string[],
  textProbes: readonly RustRagFileTextProbeInput[],
): RustRagFileIndexabilityPlan | null {
  if (
    !files.every(isValidRagFileEligibilityInput) ||
    !excludePaths.every(isStringValue) ||
    !excludeExts.every(isStringValue) ||
    !textProbes.every(isValidRagFileTextProbeInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rag_file_indexability_json(
      JSON.stringify(files),
      JSON.stringify(excludePaths),
      JSON.stringify(excludeExts),
      JSON.stringify(textProbes),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRagFileIndexabilityPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planSourceReferencesRust(content: string): RustSourceReferencePlan[] | null {
  if (!isStringValue(content)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_source_references_json(content);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isSourceReferencePlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planSourceValidationInputsRust(
  references: readonly RustSourceReferencePlan[],
  citationIds: readonly string[],
  citationPaths: readonly string[],
  citationStatuses: readonly string[],
): RustSourceValidationInputPlan | null {
  if (
    !references.every(isSourceReferencePlan) ||
    !citationIds.every(isStringValue) ||
    !citationPaths.every(isStringValue) ||
    !citationStatuses.every(isStringValue)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_source_validation_inputs_json(
      JSON.stringify(references),
      JSON.stringify(citationIds),
      JSON.stringify(citationPaths),
      JSON.stringify(citationStatuses),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSourceValidationInputPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planSourceValidationWarningsRust(
  references: readonly RustSourceReferencePlan[],
  verifiedCitationIds: readonly string[],
  verifiedPaths: readonly string[],
  existingAliases: readonly string[],
): RustSourceValidationWarningPlan[] | null {
  if (
    !references.every(isSourceReferencePlan) ||
    !verifiedCitationIds.every(isStringValue) ||
    !verifiedPaths.every(isStringValue) ||
    !existingAliases.every(isStringValue)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_source_validation_warnings_json(
      JSON.stringify(references),
      JSON.stringify(verifiedCitationIds),
      JSON.stringify(verifiedPaths),
      JSON.stringify(existingAliases),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isSourceValidationWarningPlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planAssistantResponseClassificationRust(input: {
  content: string;
  reasoning: string;
}): RustAssistantResponseClassification | null {
  if (!isStringValue(input.content) || !isStringValue(input.reasoning)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_assistant_response_classification_json(input.content, input.reasoning);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isAssistantResponseClassification(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractStructuredReasoningRust(delta: Record<string, unknown>): string | null {
  if (!isStringRecordValueMap(delta)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = extract_structured_reasoning(JSON.stringify(delta));
    return raw.length === 0 ? null : raw;
  } catch {
    return null;
  }
}

export function splitReasoningTagsRust(content: string): RustReasoningChunk | null {
  if (!isStringValue(content)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = split_reasoning_tags_json(content);
    if (raw.length === 0) {
      return { content: '' };
    }
    const parsed: unknown = JSON.parse(raw);
    return isRustReasoningChunk(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeReasoningChunkRust(input: {
  content?: string;
  reasoning?: string;
}): RustReasoningChunk | null {
  if (
    !isStringValue(input.content) ||
    (input.reasoning !== undefined && !isStringValue(input.reasoning))
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = normalize_reasoning_chunk_json(input.content, input.reasoning ?? '');
    if (raw.length === 0) {
      return { content: '' };
    }
    const parsed: unknown = JSON.parse(raw);
    return isRustReasoningChunk(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planChatMessagesRust(
  body: string,
  nowTimestamp: number,
  nowIso: string,
  decodeFailureLabel: string,
): RustChatMessagePlan[] | null {
  if (
    !isStringValue(body) ||
    !Number.isFinite(nowTimestamp) ||
    !isStringValue(nowIso) ||
    !isStringValue(decodeFailureLabel)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_chat_messages_json(body, nowTimestamp, nowIso, decodeFailureLabel);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isChatMessagePlan)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planChatMetaRust(
  content: string,
  fallbackTitle: string,
  fallbackMtime: number,
): RustChatMetaPlan | null {
  if (!isStringValue(content) || !isStringValue(fallbackTitle) || !Number.isFinite(fallbackMtime)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_chat_meta_json(content, fallbackTitle, new Date(fallbackMtime).toISOString());
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isChatMetaPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planChatSaveMetadataRust(
  messages: readonly unknown[],
  existingCreated: string | undefined,
  optionTitle: string | undefined,
  nowIso: string,
): RustChatSaveMetadataPlan | null {
  if (!Array.isArray(messages) || !isStringValue(nowIso)) return null;
  if (existingCreated !== undefined && !isStringValue(existingCreated)) return null;
  if (optionTitle !== undefined && !isStringValue(optionTitle)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_chat_save_metadata_json(
      JSON.stringify(messages),
      existingCreated ?? '',
      optionTitle ?? '',
      nowIso,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isChatSaveMetadataPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planContextSourcesRust(
  results: readonly RustContextSourceInput[],
  verifications: readonly RustContextSourceVerification[],
  firstIndex: number,
  prefix: string,
): RustContextSourcePlan | null {
  if (
    !results.every(isValidContextSourceInput) ||
    !verifications.every(isContextSourceVerification) ||
    !Number.isInteger(firstIndex) ||
    firstIndex < 0 ||
    !isStringValue(prefix)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_context_sources_json(
      JSON.stringify(results),
      JSON.stringify(verifications),
      firstIndex,
      prefix,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isContextSourcePlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planContextBudgetAppendRust(
  remainingChars: number,
  text: string,
): RustContextBudgetAppendPlan | null {
  if (!Number.isSafeInteger(remainingChars) || remainingChars < 0 || !isStringValue(text)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_context_budget_append_json(remainingChars, text);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isContextBudgetAppendPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planChatContextMentionsRust(
  mentionTypes: readonly string[],
): RustChatContextMentionPlan | null {
  if (!mentionTypes.every(isChatContextMentionType)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_chat_context_mentions_json(JSON.stringify(mentionTypes));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isChatContextMentionPlan(parsed, mentionTypes.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planMcpServerCandidatesRust(
  preferredServerNames: readonly string[],
  enabledServerNames: readonly string[],
  connectionStatuses: Record<string, string>,
): string[] | null {
  if (
    !preferredServerNames.every(isStringValue) ||
    !enabledServerNames.every(isStringValue) ||
    !isStringStringRecord(connectionStatuses)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_mcp_server_candidates_json(
      JSON.stringify(preferredServerNames),
      JSON.stringify(enabledServerNames),
      JSON.stringify(connectionStatuses),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isMcpToolAvailableRust(
  toolName: string,
  toolNames: readonly string[],
): boolean | null {
  if (!isStringValue(toolName) || !toolNames.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    return is_mcp_tool_name_available(toolName, JSON.stringify(toolNames));
  } catch {
    return null;
  }
}

export function parseMcpToolArgumentsRust(argumentsText: string): Record<string, unknown> | null {
  if (!isStringValue(argumentsText)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = parse_mcp_tool_arguments_json(argumentsText);
    const parsed: unknown = JSON.parse(raw);
    return isStringRecordValueMap(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeVaultToolRequestRust(
  argumentsText: string,
): RustNativeVaultToolRequestPlan | null {
  if (!isStringValue(argumentsText) || !ensureRustCore()) return null;

  try {
    const raw = plan_native_vault_tool_request_json(argumentsText);
    const parsed: unknown = JSON.parse(raw);
    return isNativeVaultToolRequestPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeVaultListRust(
  filePaths: readonly string[],
  pathPrefix: string,
  cursor: number,
  limit: number,
): RustNativeVaultListPlan | null {
  if (!filePaths.every(isStringValue) || !ensureRustCore()) return null;
  try {
    const raw = plan_native_vault_list_json(
      JSON.stringify(filePaths),
      pathPrefix,
      normalizeNonNegativeInteger(cursor),
      normalizeNonNegativeInteger(limit),
    );
    const parsed: unknown = JSON.parse(raw);
    return isNativeVaultListPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeVaultReadRangeRust(
  totalLines: number,
  startLine: number,
  endLine: number | null,
  maxLines: number,
): RustNativeVaultReadRangePlan | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_native_vault_read_range_json(
      normalizeNonNegativeInteger(totalLines),
      normalizeNonNegativeInteger(startLine),
      endLine === null ? undefined : normalizeNonNegativeInteger(endLine),
      normalizeNonNegativeInteger(maxLines),
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isNativeVaultReadRangePlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeVaultLinkPathsRust(
  paths: readonly string[],
  limit: number,
): string[] | null {
  if (!paths.every(isStringValue) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_native_vault_link_paths_json(JSON.stringify(paths), normalizeNonNegativeInteger(limit)),
    );
    return Array.isArray(parsed) && parsed.every(isStringValue) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeVaultStatsRust(
  fileSizes: readonly number[],
): RustNativeVaultStatsPlan | null {
  if (!fileSizes.every(isNonNegativeSafeInteger) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_native_vault_stats_json(JSON.stringify(fileSizes)));
    return isNativeVaultStatsPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isWholeVaultResearchIntentRust(question: string): boolean | null {
  if (!isStringValue(question) || !ensureRustCore()) return null;
  try {
    return is_whole_vault_research_intent(question);
  } catch {
    return null;
  }
}

export function planResearchSummaryBatchesRust(
  itemSizes: readonly number[],
  maxItems: number,
  maxChars: number,
): number[][] | null {
  if (
    !itemSizes.every(isNonNegativeSafeInteger) ||
    !isNonNegativeSafeInteger(maxItems) ||
    !isNonNegativeSafeInteger(maxChars) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_research_summary_batches_json(JSON.stringify(itemSizes), maxItems, maxChars),
    );
    return Array.isArray(parsed) &&
      parsed.every((batch) => Array.isArray(batch) && batch.every(isNonNegativeSafeInteger))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function planResearchCitationIndicesRust(
  content: string,
  citationIds: readonly string[],
  citationPaths: readonly string[],
  fallbackLimit: number,
): number[] | null {
  if (
    !isStringValue(content) ||
    !citationIds.every(isStringValue) ||
    !citationPaths.every(isStringValue) ||
    citationPaths.length !== citationIds.length ||
    !isNonNegativeSafeInteger(fallbackLimit) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_research_citation_indices_json(
        content,
        JSON.stringify(citationIds),
        JSON.stringify(citationPaths),
        fallbackLimit,
      ),
    );
    return Array.isArray(parsed) && parsed.every(isNonNegativeSafeInteger) ? parsed : null;
  } catch {
    return null;
  }
}

export interface RustResearchRequestFailurePlan {
  code: string;
  retryable: boolean;
  retryDelayMs: number;
}

export interface RustToolCallSignatureInput {
  name: string;
  arguments: string;
}

export interface RustCompatibilityToolCall {
  name: string;
  arguments: string;
}

export function planCompatibilityToolCallsRust(
  content: string,
): RustCompatibilityToolCall[] | null {
  if (!isStringValue(content) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_compatibility_tool_calls_json(content));
    return Array.isArray(parsed) && parsed.every(isRustToolCallSignatureInput) ? parsed : null;
  } catch {
    return null;
  }
}

export function stripCompatibilityToolCallsRust(content: string): string | null {
  if (!isStringValue(content) || !ensureRustCore()) return null;
  try {
    return strip_compatibility_tool_calls(content);
  } catch {
    return null;
  }
}

function isRustToolCallSignatureInput(value: unknown): value is RustToolCallSignatureInput {
  return (
    isStringRecordValueMap(value) && isStringValue(value.name) && isStringValue(value.arguments)
  );
}

export function planRepeatedToolCallIndicesRust(
  history: readonly RustToolCallSignatureInput[],
  candidates: readonly RustToolCallSignatureInput[],
  maxRepeats: number,
  maxNativeSearchCalls: number,
): number[] | null {
  if (
    !history.every(isRustToolCallSignatureInput) ||
    !candidates.every(isRustToolCallSignatureInput) ||
    !isNonNegativeSafeInteger(maxRepeats) ||
    !isNonNegativeSafeInteger(maxNativeSearchCalls) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_repeated_tool_call_indices_json(
        JSON.stringify(history),
        JSON.stringify(candidates),
        maxRepeats,
        maxNativeSearchCalls,
      ),
    );
    return Array.isArray(parsed) && parsed.every(isNonNegativeSafeInteger) ? parsed : null;
  } catch {
    return null;
  }
}

export function planResearchRequestFailureRust(input: {
  message: string;
  status?: number;
  failedAttempt: number;
  retryAfterMs?: number;
}): RustResearchRequestFailurePlan | null {
  if (
    !isStringValue(input.message) ||
    !isNonNegativeSafeInteger(input.failedAttempt) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_research_request_failure_json(
        input.message,
        input.status ?? 0,
        input.failedAttempt,
        input.retryAfterMs ?? Number.NaN,
      ),
    );
    if (
      !isStringRecordValueMap(parsed) ||
      !isStringValue(parsed.code) ||
      typeof parsed.retryable !== 'boolean' ||
      !isNonNegativeSafeInteger(parsed.retryDelayMs)
    ) {
      return null;
    }
    return {
      code: parsed.code,
      retryable: parsed.retryable,
      retryDelayMs: parsed.retryDelayMs,
    };
  } catch {
    return null;
  }
}

export function normalizeMcpToolResultRust(result: unknown): RustMcpToolNormalizedResult | null {
  if (!ensureRustCore()) return null;

  try {
    const raw = normalize_mcp_tool_result_json(JSON.stringify(result));
    const parsed: unknown = JSON.parse(raw);
    if (!isRustMcpToolNormalizedResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isMcpToolResultEmptyRust(
  result: unknown,
  normalizedResult: RustMcpToolNormalizedResult,
): boolean | null {
  if (!isRustMcpToolNormalizedResult(normalizedResult)) return null;
  if (!ensureRustCore()) return null;

  try {
    return is_mcp_tool_result_empty_json(
      JSON.stringify(result),
      normalizedResult.displayText,
      normalizedResult.modelText,
    );
  } catch {
    return null;
  }
}

export function classifyMcpToolErrorRust(rawMsg: string): RustMcpToolErrorInfo | null {
  if (!isStringValue(rawMsg)) return null;
  if (!ensureRustCore()) return null;

  try {
    const parsed: unknown = JSON.parse(classify_mcp_tool_error_json(rawMsg));
    if (!isRustMcpToolErrorInfo(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planContextGraphVerificationRust(
  filePath: string,
  unsupportedDetail: string,
): RustContextGraphVerificationPlan | null {
  if (!isStringValue(filePath) || !isStringValue(unsupportedDetail)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_context_graph_verification_json(filePath, unsupportedDetail);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isContextGraphVerificationPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planStructuralLinkedPathsRust(
  seedPaths: readonly string[],
  edges: readonly RustStructuralLinkEdge[],
): string[] | null {
  if (!seedPaths.every(isStringValue) || !edges.every(isValidStructuralLinkEdge)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_structural_linked_paths_json(JSON.stringify(seedPaths), JSON.stringify(edges));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planStructuralHeadingNeighborsRust(
  input: RustStructuralHeadingNeighborInput,
): number[] | null {
  if (
    !input.seeds.every(isValidStructuralHeadingSeed) ||
    !input.entries.every(isValidStructuralEntryInput) ||
    !input.headings.every(isValidStructuralHeadingInput)
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_structural_heading_neighbors_json(
      JSON.stringify(input.seeds),
      JSON.stringify(input.entries),
      JSON.stringify(input.headings),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isValidNonNegativeInteger)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planRerankResponseRust(
  rawResponse: string,
  allowedIds: readonly string[],
): string[] | null {
  return planRerankResponseWithStatusRust(rawResponse, allowedIds)?.rankedIds ?? null;
}

export function planRerankResponseWithStatusRust(
  rawResponse: string,
  allowedIds: readonly string[],
): RustRerankResponsePlan | null {
  if (!allowedIds.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rerank_response_json(rawResponse, JSON.stringify(allowedIds));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRerankResponsePlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planRerankMessagesRust(
  question: string,
  candidates: readonly RustRerankMessageCandidate[],
  maxTextChars: number,
): RustRerankMessagesPlan | null {
  if (
    !isStringValue(question) ||
    !candidates.every(isRerankMessageCandidate) ||
    !Number.isSafeInteger(maxTextChars) ||
    maxTextChars < 0
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;
  const raw = plan_rerank_messages_json(question, JSON.stringify(candidates), maxTextChars);
  if (raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRerankMessagesPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planRerankResultOrderRust(
  resultIds: readonly string[],
  rankedIds: readonly string[],
): number[] | null {
  if (!resultIds.every(isStringValue) || !rankedIds.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_rerank_result_order_json(JSON.stringify(resultIds), JSON.stringify(rankedIds));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isValidNonNegativeInteger)) return null;
    return parsed;
  } catch {
    return null;
  }
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

export function planDiverseResultIndicesRust(
  candidates: readonly RustDiverseResultCandidate[],
  topK: number,
): number[] | null {
  if (topK <= 0) return [];
  if (candidates.length === 0) return [];
  if (candidates.length <= topK) return candidates.map((_, index) => index);
  if (!candidates.every(isDiverseResultCandidate)) return null;
  if (!ensureRustCore()) return planDiverseResultIndicesFallback(candidates, topK);

  try {
    const raw = plan_diverse_result_indices_json(
      JSON.stringify(candidates),
      normalizeNonNegativeInteger(topK),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBoundedIndexArray(parsed, candidates.length)) return null;
    return parsed;
  } catch {
    return planDiverseResultIndicesFallback(candidates, topK);
  }
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

export function detectCommunitiesFromEdgesRust(
  edges: readonly RustCommunityEdgeRecord[],
  maxIterations: number,
): RustCommunityDetectionByIdResult | null {
  if (!edges.every(isCommunityEdgeRecord) || !Number.isFinite(maxIterations)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = detect_communities_from_edges_json(
      JSON.stringify(edges),
      normalizeNonNegativeInteger(maxIterations),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCommunityDetectionByIdResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function detectLeidenHierarchyFromEdgesRust(
  edges: readonly RustCommunityEdgeRecord[],
  maxIterations: number,
  maxLevels: number,
): RustCommunityHierarchyResult | null {
  if (
    !edges.every(isCommunityEdgeRecord) ||
    !Number.isFinite(maxIterations) ||
    !Number.isFinite(maxLevels) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = detect_leiden_hierarchy_from_edges_json(
      JSON.stringify(edges),
      normalizeNonNegativeInteger(maxIterations),
      normalizePositiveInteger(maxLevels),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCommunityHierarchyResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planGraphEdgeRecordsRust(
  entityIds: readonly string[],
  relationSourceIds: readonly string[],
  relationTargetIds: readonly string[],
  confidences: readonly number[],
): RustCommunityEdgeRecord[] | null {
  if (
    !entityIds.every(isStringValue) ||
    !relationSourceIds.every(isStringValue) ||
    !relationTargetIds.every(isStringValue) ||
    !confidences.every(Number.isFinite) ||
    relationSourceIds.length !== relationTargetIds.length ||
    relationSourceIds.length !== confidences.length
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_edge_records_json(
      JSON.stringify(entityIds),
      JSON.stringify(relationSourceIds),
      JSON.stringify(relationTargetIds),
      JSON.stringify(confidences),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isCommunityEdgeRecord)) return null;
    return parsed;
  } catch {
    return null;
  }
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

export function planGraphExtractionChildUnitsRust(
  content: string,
  splitDepth: number,
): Chunk[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_graph_extraction_child_units_json(content, normalizeNonNegativeInteger(splitDepth)),
    );
    return isChunkArray(parsed) ? parsed : null;
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

export function planVaultLinkCandidatesRust(
  sourcePath: string,
  rawTarget: string,
): RustVaultLinkCandidatePlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_vault_link_candidates_json(sourcePath, rawTarget));
    if (!isVaultLinkCandidatePlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planVaultLinkFallbackIndexRust(
  fallbackBasename: string,
  markdownBasenames: readonly string[],
): number | null {
  if (!isStringValue(fallbackBasename) || !markdownBasenames.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_vault_link_fallback_index_json(
      fallbackBasename,
      JSON.stringify(markdownBasenames),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const index = (parsed as { index?: unknown }).index;
    if (index === null) return null;
    if (!Number.isInteger(index) || typeof index !== 'number') return null;
    return index >= 0 && index < markdownBasenames.length ? index : null;
  } catch {
    return null;
  }
}

export function planFolderMentionFilesRust(
  folderPath: string,
  markdownFilePaths: readonly string[],
  maxFiles: number,
): RustFolderMentionFilePlan | null {
  if (!isStringValue(folderPath) || !markdownFilePaths.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_folder_mention_file_indices_json(
      folderPath,
      JSON.stringify(markdownFilePaths),
      normalizeNonNegativeInteger(maxFiles),
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isFolderMentionFilePlan(parsed, markdownFilePaths.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planReferenceFileIndicesRust(
  sourcePath: string,
  filePaths: readonly string[],
): number[] | null {
  if (!isStringValue(sourcePath) || !filePaths.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_reference_file_indices_json(sourcePath, JSON.stringify(filePaths));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBoundedIndexArray(parsed, filePaths.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractJsonObjectRust(rawResponse: string): string | null {
  if (!ensureRustCore()) return null;
  const extracted = extract_json_object_text(rawResponse);
  return extracted.length > 0 ? extracted : null;
}

export function normalizeExtractedGraphPayloadRust(
  jsonText: string,
): RustExtractedGraphPayloadResult | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = normalize_extracted_graph_payload_json(jsonText);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRustExtractedGraphPayloadResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseExtractedGraphPayloadRust(
  rawResponse: string,
): RustExtractedGraphPayloadParseResult | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = parse_extracted_graph_payload_json(rawResponse);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRustExtractedGraphPayloadParseResult(parsed)) return null;
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

export function planImplicitFolderQueryPathsRust(
  question: string,
  folderPaths: readonly string[],
): string[] | null {
  if (!folderPaths.every(isStringValue) || !ensureRustCore()) return null;
  try {
    const raw = plan_implicit_folder_query_paths_json(question, JSON.stringify(folderPaths));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isStringValue) ? parsed : null;
  } catch {
    return null;
  }
}

export function planFolderLexicalEvidenceIndicesRust(
  query: string,
  samples: readonly string[],
  topK: number,
  matchMode: 'all' | 'any' | 'phrase' = 'all',
): number[] | null {
  if (
    !samples.every(isStringValue) ||
    !Number.isSafeInteger(topK) ||
    topK < 0 ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_folder_lexical_evidence_indices_json(
      query,
      JSON.stringify(samples),
      topK,
      matchMode,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isValidNonNegativeInteger) ? parsed : null;
  } catch {
    return null;
  }
}

export function shouldOfferContext7ForPromptRust(prompt: string): boolean | null {
  if (!ensureRustCore()) return null;
  return should_offer_context7_for_prompt(prompt);
}

export function planGraphQueryRust(question: string): RustGraphQueryPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_graph_query_json(question));
    if (!isGraphQueryPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphQueryExecutionRust(
  configuredMode: string,
  plannedMode: string,
  evidenceFirst: boolean,
): RustGraphQueryExecutionPlan | null {
  if (
    !isStringValue(configuredMode) ||
    !isStringValue(plannedMode) ||
    typeof evidenceFirst !== 'boolean'
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_query_execution_json(configuredMode, plannedMode, evidenceFirst);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isGraphQueryExecutionPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphQueryExecutionActionRust(
  executionPlan: RustGraphQueryExecutionPlan | null,
  configuredMode: string,
  plannedMode: string,
  evidenceFirst: boolean,
): RustGraphQueryExecutionAction | null {
  if (executionPlan) return executionPlan.action;

  if (configuredMode === 'global') return 'global';
  if (configuredMode === 'local') return 'local';
  if (configuredMode === 'hybrid') return 'hybrid';

  if (plannedMode === 'none') return 'none';
  if (plannedMode === 'global') return 'global';
  if (plannedMode === 'hybrid') return 'hybrid';
  if (plannedMode === 'local' && evidenceFirst) return 'evidence-first';
  if (plannedMode === 'local') return 'local';

  return null;
}

export function planGraphSchemaRelationIndicesRust(
  relationSchemaIds: readonly string[],
  ontologySchemaId: string,
): number[] | null {
  return planGraphSchemaIndicesRust(
    relationSchemaIds,
    ontologySchemaId,
    plan_graph_schema_relation_indices_json,
  );
}

function planDiverseResultIndicesFallback(
  candidates: readonly RustDiverseResultCandidate[],
  topK: number,
): number[] {
  const validCount = Math.max(0, Math.floor(topK));
  if (validCount === 0 || candidates.length === 0) return [];

  return candidates
    .map((candidate, index) => ({
      index,
      score: candidate.score,
      sourcePath: candidate.sourcePath,
      heading: candidate.heading,
    }))
    .sort((left, right) => {
      if (left.score === right.score) {
        if (left.sourcePath !== right.sourcePath) {
          return left.sourcePath.localeCompare(right.sourcePath);
        }
        return (left.heading ?? '').localeCompare(right.heading ?? '');
      }
      return right.score - left.score;
    })
    .slice(0, validCount)
    .map((entry) => entry.index);
}

export function planGraphSchemaCommunityIndicesRust(
  communitySchemaIds: readonly string[],
  ontologySchemaId: string,
): number[] | null {
  return planGraphSchemaIndicesRust(
    communitySchemaIds,
    ontologySchemaId,
    plan_graph_schema_community_indices_json,
  );
}

export function planGraphCommunityReplacementDeleteIdsRust(
  communities: readonly RustGraphCommunityReplacementRecord[],
  ontologySchemaId: string,
): string[] | null {
  if (!communities.every(isGraphCommunityReplacementRecord) || !isStringValue(ontologySchemaId)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = plan_graph_community_replacement_delete_ids_json(
      JSON.stringify(communities),
      ontologySchemaId,
    );
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isStringValue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function planGraphSchemaIndicesRust(
  recordSchemaIds: readonly string[],
  ontologySchemaId: string,
  createPlanJson: (recordSchemaIdsJson: string, ontologySchemaId: string) => string,
): number[] | null {
  if (!recordSchemaIds.every(isStringValue) || !isStringValue(ontologySchemaId)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  try {
    const raw = createPlanJson(JSON.stringify(recordSchemaIds), ontologySchemaId);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isBoundedIndexArray(parsed, recordSchemaIds.length)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function planGraphQueryResponseRust(
  rawResponse: string,
  fallbackQuestion: string,
): RustGraphQueryPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_graph_query_response_json(rawResponse, fallbackQuestion),
    );
    if (!isGraphQueryPlan(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function validateMcpJsonRust(jsonText: string): RustMcpJsonValidationResult | null {
  if (!isStringValue(jsonText)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = validate_mcp_json(jsonText);
    const parsed: unknown = JSON.parse(raw);
    if (!isRustMcpJsonValidationResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatMcpJsonRust(jsonText: string): string | null {
  if (!isStringValue(jsonText)) return null;
  if (!ensureRustCore()) return null;

  try {
    const formatted = format_mcp_json(jsonText);
    return formatted.length === 0 ? null : formatted;
  } catch {
    return null;
  }
}

export function isExcludedPathRust(filePath: string, patterns: readonly string[]): boolean | null {
  if (!ensureRustCore()) return null;
  const result: unknown = is_excluded_path(filePath, patterns.join('\0'));
  return typeof result === 'boolean' ? result : null;
}

export function isExcludedExtRust(
  filePath: string,
  excludeExtensions: readonly string[],
): boolean | null {
  if (!isStringValue(filePath) || !excludeExtensions.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;
  const result: unknown = is_excluded_ext_json(filePath, JSON.stringify(excludeExtensions));
  return typeof result === 'boolean' ? result : null;
}

export function countFilesByExtensionsRust(
  fileExtensions: readonly string[],
  extensionKeys: readonly string[],
): Record<string, number> | null {
  if (!fileExtensions.every(isStringValue) || !extensionKeys.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const raw = count_files_by_extensions_json(
      JSON.stringify(fileExtensions),
      JSON.stringify(extensionKeys),
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isStringNumberRecord(parsed)) return null;
    return Object.entries(parsed).reduce(
      (acc, [key, value]) => {
        if (Number.isFinite(value)) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
  } catch {
    return null;
  }
}

export function normalizeExcludeExtensionRust(extension: string): string | null {
  if (!isStringValue(extension)) return null;
  if (!ensureRustCore()) return null;

  try {
    return normalize_exclude_extension_json(extension);
  } catch {
    return null;
  }
}

export function isProtectedRagDocumentExtensionRust(extension: string): boolean | null {
  if (!isStringValue(extension)) return null;
  if (!ensureRustCore()) return null;
  return is_protected_rag_document_extension_json(extension);
}

export function isRecommendableExcludeExtensionRust(extension: string): boolean | null {
  if (!isStringValue(extension)) return null;
  if (!ensureRustCore()) return null;
  return is_recommendable_exclude_extension_json(extension);
}

export function validateExcludePathInputRust(
  input: string,
  existingPaths: readonly string[],
): RustExcludeValidationResult | null {
  if (!isStringValue(input) || !existingPaths.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const parsed: unknown = JSON.parse(
      validate_exclude_path_input_json(input, JSON.stringify(existingPaths)),
    );
    if (!isRustExcludeValidationResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function validateExcludeExtensionInputRust(
  input: string,
  existingExtensions: readonly string[],
): RustExcludeValidationResult | null {
  if (!isStringValue(input) || !existingExtensions.every(isStringValue)) return null;
  if (!ensureRustCore()) return null;

  try {
    const parsed: unknown = JSON.parse(
      validate_exclude_extension_input_json(input, JSON.stringify(existingExtensions)),
    );
    if (!isRustExcludeValidationResult(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeEntityNameRust(name: string): string | null {
  if (!isStringValue(name)) return null;
  if (!ensureRustCore()) return normalizeEntityNameFallback(name);
  try {
    return normalize_entity_name(name);
  } catch {
    return normalizeEntityNameFallback(name);
  }
}

export function createEntityIdRust(
  ontologySchemaId: string,
  typeId: string,
  canonicalName: string,
): string | null {
  if (!isStringValue(ontologySchemaId) || !isStringValue(typeId) || !isStringValue(canonicalName)) {
    return null;
  }
  if (!ensureRustCore()) {
    return createEntityIdFallback(ontologySchemaId, typeId, canonicalName);
  }
  try {
    return create_entity_id(ontologySchemaId, typeId, canonicalName);
  } catch {
    return createEntityIdFallback(ontologySchemaId, typeId, canonicalName);
  }
}

export function normalizeGraphNameRust(name: string): string | null {
  if (!isStringValue(name)) return null;
  if (!ensureRustCore()) return normalizeGraphNameFallback(name);
  try {
    return normalize_graph_name(name);
  } catch {
    return normalizeGraphNameFallback(name);
  }
}

export function normalizeGraphConfidenceRust(confidence: unknown): number | null {
  if (!ensureRustCore()) return null;
  const score = normalize_graph_confidence_or_default(
    typeof confidence === 'number' ? confidence : Number.NaN,
  );
  return Number.isFinite(score) ? score : null;
}

export function sanitizeGraphIdPartRust(part: string): string | null {
  if (!isStringValue(part)) return null;
  if (!ensureRustCore()) return sanitizeGraphIdPartFallback(part);
  try {
    return sanitize_graph_id_part(part);
  } catch {
    return sanitizeGraphIdPartFallback(part);
  }
}

export function createGraphIdRust(parts: readonly string[]): string | null {
  if (!parts.every(isStringValue)) return null;
  if (!ensureRustCore()) {
    return parts.map(sanitizeGraphIdPartFallback).join('::');
  }
  try {
    return create_graph_id(parts.join('\0'));
  } catch {
    return parts.map(sanitizeGraphIdPartFallback).join('::');
  }
}

export function createPendingEntityMergeIdRust(
  existingEntityId: string,
  candidateEntityId: string,
): string | null {
  const normalizedExisting = existingEntityId.replace(/@+/g, '');
  const normalizedCandidate = candidateEntityId.replace(/@+/g, '');
  return createGraphIdRust([
    'pending-entity-merge',
    ...normalizedExisting.split('::').filter((segment) => segment.length > 0),
    ...normalizedCandidate.split('::').filter((segment) => segment.length > 0),
  ]);
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

export function planEntityResolutionRust(
  input: RustEntityResolutionInput,
): RustEntityResolutionPlan | null {
  if (
    !isStringValue(input.ontologySchemaId) ||
    !isStringValue(input.typeId) ||
    !isStringValue(input.candidateEntityId) ||
    !Number.isFinite(input.autoMergeThreshold) ||
    !Number.isFinite(input.pendingMergeThreshold) ||
    !input.candidates.every(isEntityResolutionCandidate)
  ) {
    return null;
  }
  if (!ensureRustCore()) {
    return planEntityResolutionFallback(input);
  }

  try {
    const rawPlan = plan_entity_resolution_json(JSON.stringify(input));
    if (rawPlan.length === 0) return null;
    const parsed = JSON.parse(rawPlan) as unknown;
    return isEntityResolutionPlan(parsed) ? parsed : null;
  } catch {
    return planEntityResolutionFallback(input);
  }
}

export function findMentionedEntityMatchesRust(
  question: string,
  entities: readonly RustMentionedEntityInput[],
  ontologySchemaId: string,
  entityHints: readonly string[],
): RustVectorScore[] | null {
  if (entities.length === 0) return [];
  if (!entities.every(isMentionedEntityInput) || !entityHints.every(isStringValue)) {
    return null;
  }
  if (!ensureRustCore()) return null;

  const pairs = find_mentioned_entity_matches(
    question,
    ontologySchemaId,
    entities.map((entity) => entity.ontologySchemaId).join('\0'),
    entities.map((entity) => entity.canonicalName).join('\0'),
    entities.map((entity) => entity.aliases.join('\0')).join('\u{1f}'),
    entityHints.join('\0'),
  );
  return decodeBoundedIndexScorePairs(pairs, entities.length);
}

function ensureRustCore(): boolean {
  if (initialized) return true;
  if (unavailable) return false;

  try {
    initSync({ module: decodeBase64ToBytes(RAG_WASM_BASE64) });
    initialized = true;
    return true;
  } catch {
    unavailable = true;
    return false;
  }
}

function isRustMcpConnectionState(value: string): value is RustMcpConnectionState {
  return (
    value === 'idle' ||
    value === 'connecting' ||
    value === 'connected' ||
    value === 'partial-error' ||
    value === 'error'
  );
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

function decodeMergedRetrievalCandidatePlan(
  values: Float64Array,
  candidateCount: number,
): RustMergedRetrievalCandidatePlan[] | null {
  const groups: RustMergedRetrievalCandidatePlan[] = [];
  let offset = 0;
  while (offset < values.length) {
    const entryIndex = values[offset++];
    const firstCandidateIndex = values[offset++];
    const sourceCount = values[offset++];
    const candidateIndexCount = values[offset++];
    if (
      !isBoundedInteger(entryIndex, candidateCount) ||
      !isBoundedInteger(firstCandidateIndex, candidateCount) ||
      !Number.isSafeInteger(sourceCount) ||
      sourceCount < 0 ||
      !Number.isSafeInteger(candidateIndexCount) ||
      candidateIndexCount <= 0
    ) {
      return null;
    }

    const sources: RustMergedRetrievalSource[] = [];
    for (let index = 0; index < sourceCount; index++) {
      const sourceCode = values[offset++];
      const sourceScore = values[offset++];
      const rank = values[offset++];
      if (!Number.isSafeInteger(sourceCode)) return null;
      const source = sourceCodeToSource(sourceCode);
      if (!source) return null;
      sources.push({
        source,
        ...(Number.isFinite(sourceScore) ? { sourceScore } : {}),
        ...(Number.isFinite(rank) ? { rank } : {}),
      });
    }

    const candidateIndexes: number[] = [];
    for (let index = 0; index < candidateIndexCount; index++) {
      const candidateIndex = values[offset++];
      if (!isBoundedInteger(candidateIndex, candidateCount)) return null;
      candidateIndexes.push(candidateIndex);
    }
    groups.push({
      entryIndex,
      firstCandidateIndex,
      candidateIndexes,
      sources,
    });
  }
  return offset === values.length ? groups : null;
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

function encodeVectorMatrixF32(
  vectors: readonly (readonly number[])[],
  dimension: number,
): Float32Array | null {
  const values = new Float32Array(vectors.length * dimension);
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
    input.relationEvidenceIndices.every((row) => isValidGraphPruneIndexArray(row, evidenceCount)) &&
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

function isDelimiterSafeString(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && !value.includes('\u{1f}');
}

function isDelimiterSafeStringArray(values: readonly string[]): boolean {
  return values.every(isDelimiterSafeString);
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
    isBoundedReferenceIndexMatrix(
      plan.updatedEntityEvidenceIndices,
      plan.updatedEntityIndices,
      input.entityEvidenceIndices,
    ) &&
    isBoundedIndexArray(plan.deletedRelationIndices, input.relationSchemaIds.length) &&
    isBoundedIndexArray(plan.updatedRelationIndices, input.relationSchemaIds.length) &&
    isBoundedReferenceIndexMatrix(
      plan.updatedRelationEvidenceIndices,
      plan.updatedRelationIndices,
      input.relationEvidenceIndices,
    ) &&
    isBoundedIndexArray(plan.deletedClaimIndices, input.claimEvidenceIndices.length) &&
    isBoundedIndexArray(plan.updatedClaimIndices, input.claimEvidenceIndices.length) &&
    isBoundedReferenceIndexMatrix(
      plan.updatedClaimEntityIndices,
      plan.updatedClaimIndices,
      input.claimEntityIndices,
    ) &&
    isBoundedReferenceIndexMatrix(
      plan.updatedClaimRelationIndices,
      plan.updatedClaimIndices,
      input.claimRelationIndices,
    ) &&
    isBoundedReferenceIndexMatrix(
      plan.updatedClaimEvidenceIndices,
      plan.updatedClaimIndices,
      input.claimEvidenceIndices,
    ) &&
    isBoundedIndexArray(plan.deletedCommunityIndices, input.communitySchemaIds.length) &&
    isBoundedIndexArray(plan.deletedRejectedFactIndices, input.rejectedFactFilePaths.length) &&
    isBoundedIndexArray(plan.deletedExtractionCacheIndices, input.extractionCacheEntryIds.length) &&
    isBoundedIndexArray(
      plan.deletedPendingMergeIndices,
      input.pendingMergeExistingEntityIndices.length,
    )
  );
}

function isBoundedReferenceIndexMatrix(
  value: unknown,
  ownerIndices: readonly number[] | undefined,
  referenceRows: readonly (readonly number[])[],
): value is number[][] {
  if (!Array.isArray(value) || ownerIndices === undefined || value.length !== ownerIndices.length) {
    return false;
  }

  return value.every((row, index) => {
    const ownerIndex = ownerIndices[index];
    if (ownerIndex === undefined) return false;
    const referenceRow = referenceRows[ownerIndex];
    return referenceRow !== undefined && isBoundedIndexArray(row, referenceRow.length);
  });
}

function isBoundedIndexArray(value: unknown, maxExclusive: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((index) => Number.isSafeInteger(index) && index >= 0 && index < maxExclusive)
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

function isBoundedInteger(value: number, maxExclusive: number): value is number {
  return Number.isSafeInteger(value) && value >= 0 && value < maxExclusive;
}

function isStringValue(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringRecordValueMap(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNativeVaultToolRequestPlan(value: unknown): value is RustNativeVaultToolRequestPlan {
  if (!isStringRecordValueMap(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) {
    return isStringRecordValueMap(value.error) && typeof value.error.code === 'string';
  }
  return isNativeVaultToolRequest(value.request);
}

function isNativeVaultToolRequest(value: unknown): value is RustNativeVaultToolRequest {
  if (!isStringRecordValueMap(value) || typeof value.action !== 'string') return false;
  if (value.action === 'stats') return true;
  if (value.action === 'search') {
    return (
      typeof value.query === 'string' &&
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.limit) &&
      (value.match === 'all' || value.match === 'any' || value.match === 'phrase')
    );
  }
  if (value.action === 'read') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.startLine) &&
      (value.endLine === null || isNonNegativeSafeInteger(value.endLine))
    );
  }
  if (value.action === 'list') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.cursor) &&
      isNonNegativeSafeInteger(value.limit)
    );
  }
  return (
    value.action === 'links' &&
    typeof value.path === 'string' &&
    (value.direction === 'incoming' ||
      value.direction === 'outgoing' ||
      value.direction === 'both') &&
    isNonNegativeSafeInteger(value.limit)
  );
}

function isNativeVaultListPlan(value: unknown): value is RustNativeVaultListPlan {
  return (
    isStringRecordValueMap(value) &&
    Array.isArray(value.paths) &&
    value.paths.every(isStringValue) &&
    (value.nextCursor === null || isNonNegativeSafeInteger(value.nextCursor)) &&
    isNonNegativeSafeInteger(value.total)
  );
}

function isNativeVaultReadRangePlan(value: unknown): value is RustNativeVaultReadRangePlan {
  return (
    isStringRecordValueMap(value) &&
    isNonNegativeSafeInteger(value.startLine) &&
    isNonNegativeSafeInteger(value.endLine) &&
    typeof value.truncated === 'boolean'
  );
}

function isNativeVaultStatsPlan(value: unknown): value is RustNativeVaultStatsPlan {
  return (
    isStringRecordValueMap(value) &&
    isNonNegativeSafeInteger(value.fileCount) &&
    isNonNegativeSafeInteger(value.totalBytes)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMentionCandidate(value: unknown): value is RustMentionCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustMentionCandidate>;
  return typeof candidate.raw === 'string' && typeof candidate.name === 'string';
}

function isMentionedEntityInput(value: RustMentionedEntityInput): boolean {
  return (
    isStringValue(value.ontologySchemaId) &&
    isStringValue(value.canonicalName) &&
    value.aliases.every(isStringValue)
  );
}

function isFiniteMetricRecord(value: unknown): value is Partial<Record<string, number>> {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).every(
    ([key, metric]) => key.length > 0 && typeof metric === 'number' && Number.isFinite(metric),
  );
}

function normalizeQueryResultScorePlan(value: unknown): RustQueryResultScorePlan | null {
  if (!value || typeof value !== 'object') return null;
  const plan = value as Partial<RustQueryResultScorePlan> & { bestEvidenceRank?: unknown };
  const {
    combinedBase,
    rrfScore,
    sourcePrior,
    sourceEvidenceScore,
    hasGraphOrStructuralEvidence,
    hasStrongGraphOrStructuralEvidence,
    combinedScore,
    selectionReason,
  } = plan;
  if (
    typeof combinedBase !== 'number' ||
    !Number.isFinite(combinedBase) ||
    typeof rrfScore !== 'number' ||
    !Number.isFinite(rrfScore) ||
    typeof sourcePrior !== 'number' ||
    !Number.isFinite(sourcePrior) ||
    typeof sourceEvidenceScore !== 'number' ||
    !Number.isFinite(sourceEvidenceScore) ||
    typeof hasGraphOrStructuralEvidence !== 'boolean' ||
    typeof hasStrongGraphOrStructuralEvidence !== 'boolean' ||
    typeof combinedScore !== 'number' ||
    !Number.isFinite(combinedScore) ||
    !isSourceSelectionReason(selectionReason)
  ) {
    return null;
  }
  if (
    plan.bestEvidenceRank !== undefined &&
    plan.bestEvidenceRank !== null &&
    !Number.isFinite(plan.bestEvidenceRank)
  ) {
    return null;
  }
  return {
    combinedBase,
    rrfScore,
    sourcePrior,
    sourceEvidenceScore,
    bestEvidenceRank: typeof plan.bestEvidenceRank === 'number' ? plan.bestEvidenceRank : undefined,
    hasGraphOrStructuralEvidence,
    hasStrongGraphOrStructuralEvidence,
    combinedScore,
    selectionReason,
  };
}

function isRerankMessageCandidate(value: RustRerankMessageCandidate): boolean {
  return (
    isStringValue(value.id) &&
    isStringValue(value.sourcePath) &&
    isStringValue(value.heading) &&
    isStringValue(value.text)
  );
}

function isRerankMessagesPlan(value: unknown): value is RustRerankMessagesPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRerankMessagesPlan>;
  return isStringValue(plan.systemContent) && isStringValue(plan.userContent);
}

function isRerankResponsePlan(value: unknown): value is RustRerankResponsePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRerankResponsePlan>;
  return (
    Array.isArray(plan.rankedIds) &&
    plan.rankedIds.every(isStringValue) &&
    isRerankStatus(plan.rerankStatus)
  );
}

function isRerankStatus(value: unknown): value is RustRerankStatus {
  return (
    value === 'applied' ||
    value === 'empty-rank-plan' ||
    value === 'invalid-json' ||
    value === 'skipped-empty-allowed-ids'
  );
}

function isSourceSelectionReason(value: unknown): value is RustSourceSelectionReason {
  return (
    value === 'strong-graph-evidence' ||
    value === 'graph-structural-evidence' ||
    value === 'keyword-vector' ||
    value === 'keyword' ||
    value === 'vector' ||
    value === 'hybrid'
  );
}

function isEntityResolutionCandidate(value: RustEntityResolutionCandidate): boolean {
  return (
    isStringValue(value.entityId) &&
    isStringValue(value.ontologySchemaId) &&
    isStringValue(value.typeId) &&
    Number.isFinite(value.score)
  );
}

function isEntityResolutionPlan(value: unknown): value is RustEntityResolutionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustEntityResolutionPlan>;
  return (
    isEntityResolutionStatus(plan.status) &&
    isStringValue(plan.entityId) &&
    Number.isFinite(plan.mergeScore) &&
    (plan.matchedEntityId === undefined || isStringValue(plan.matchedEntityId)) &&
    (plan.status === 'new' || isStringValue(plan.matchedEntityId))
  );
}

function isEntityResolutionStatus(value: unknown): value is RustEntityResolutionStatus {
  return value === 'new' || value === 'auto-merge' || value === 'pending-merge';
}

function isGraphQueryPlan(value: unknown): value is RustGraphQueryPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphQueryPlan>;
  return (
    isStringValue(plan.type) &&
    isStringValue(plan.queryMode) &&
    Number.isFinite(plan.traversalDepth) &&
    typeof plan.evidenceFirst === 'boolean' &&
    (plan.globalSearchDepth === 'fast' || plan.globalSearchDepth === 'deep') &&
    Array.isArray(plan.entityHints) &&
    plan.entityHints.every(isStringValue)
  );
}

function isGraphQueryExecutionPlan(value: unknown): value is RustGraphQueryExecutionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphQueryExecutionPlan>;
  return isGraphQueryExecutionAction(plan.action) && typeof plan.requiresPlanner === 'boolean';
}

function isGraphQueryExecutionAction(value: unknown): value is RustGraphQueryExecutionAction {
  return (
    value === 'none' ||
    value === 'local' ||
    value === 'global' ||
    value === 'hybrid' ||
    value === 'evidence-first'
  );
}

function isBm25HitLookupPlan(value: unknown): value is RustBm25HitLookupPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustBm25HitLookupPlan>;
  return (
    Array.isArray(plan.hits) &&
    plan.hits.every(isValidBm25Hit) &&
    Array.isArray(plan.lookupDocIds) &&
    plan.lookupDocIds.every(isStringValue) &&
    Number.isFinite(plan.maxScore)
  );
}

function isBm25CandidatePlan(value: unknown): value is RustBm25CandidatePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustBm25CandidatePlan>;
  const entryIndex = plan.entryIndex;
  return (
    (plan.entrySet === 'found' || plan.entrySet === 'path') &&
    typeof entryIndex === 'number' &&
    Number.isSafeInteger(entryIndex) &&
    entryIndex >= 0 &&
    Number.isFinite(plan.sourceScore)
  );
}

function isBm25IndexData(value: unknown): value is RustBm25IndexData {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<RustBm25IndexData>;
  return (
    isValidNonNegativeInteger(index.tokenizerVersion) &&
    isBm25InvertedIndex(index.inverted) &&
    isStringNumberRecord(index.docLengths) &&
    isStringStringRecord(index.docSources) &&
    isValidNonNegativeInteger(index.totalDocs) &&
    Number.isFinite(index.avgDocLength)
  );
}

function isBm25InvertedIndex(value: unknown): value is Record<string, Record<string, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isStringNumberRecord);
}

function isStringNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => Number.isFinite(item));
}

function isStringStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(isStringValue);
}

function isBm25SearchScore(value: unknown): value is RustBm25SearchScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Partial<RustBm25SearchScore>;
  return isStringValue(score.docId) && Number.isFinite(score.score);
}

function isEvidenceScore(value: unknown): value is RustEvidenceScore {
  if (!value || typeof value !== 'object') return false;
  const score = value as Partial<RustEvidenceScore>;
  return isStringValue(score.evidenceId) && Number.isFinite(score.score);
}

function isLocalEvidencePlanInput(value: unknown): value is RustLocalEvidencePlanInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<RustLocalEvidencePlanInput>;
  return (
    Array.isArray(input.matches) &&
    input.matches.every(isLocalEvidenceMatchInput) &&
    Array.isArray(input.relations) &&
    input.relations.every(isLocalEvidenceRelationInput) &&
    Array.isArray(input.claims) &&
    input.claims.every(isLocalEvidenceClaimInput) &&
    Number.isFinite(input.traversalDepth)
  );
}

function isLocalEvidenceMatchInput(value: unknown): value is RustLocalEvidenceMatchInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustLocalEvidenceMatchInput>;
  return (
    isStringValue(record.entityId) &&
    Number.isFinite(record.entityConfidence) &&
    Number.isFinite(record.matchScore) &&
    Array.isArray(record.evidenceIds) &&
    record.evidenceIds.every(isStringValue)
  );
}

function isLocalEvidenceRelationInput(value: unknown): value is RustLocalEvidenceRelationInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustLocalEvidenceRelationInput>;
  return (
    isStringValue(record.sourceEntityId) &&
    isStringValue(record.targetEntityId) &&
    Number.isFinite(record.confidence) &&
    Array.isArray(record.evidenceIds) &&
    record.evidenceIds.every(isStringValue)
  );
}

function isLocalEvidenceClaimInput(value: unknown): value is RustLocalEvidenceClaimInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustLocalEvidenceClaimInput>;
  return (
    Array.isArray(record.entityIds) &&
    record.entityIds.every(isStringValue) &&
    Number.isFinite(record.confidence) &&
    Array.isArray(record.evidenceIds) &&
    record.evidenceIds.every(isStringValue)
  );
}

function isDiverseResultCandidate(value: unknown): value is RustDiverseResultCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustDiverseResultCandidate>;
  return (
    Number.isFinite(candidate.score) &&
    Array.isArray(candidate.vector) &&
    candidate.vector.every((item) => Number.isFinite(item)) &&
    isStringValue(candidate.sourcePath) &&
    (candidate.heading === undefined || isStringValue(candidate.heading))
  );
}

function isCommunityEdgeRecord(value: unknown): value is RustCommunityEdgeRecord {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Partial<RustCommunityEdgeRecord>;
  return isStringValue(edge.source) && isStringValue(edge.target) && Number.isFinite(edge.weight);
}

function isCommunityDetectionByIdResult(value: unknown): value is RustCommunityDetectionByIdResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustCommunityDetectionByIdResult>;
  return (
    Array.isArray(result.assignmentsById) &&
    result.assignmentsById.every(isCommunityAssignmentById) &&
    Array.isArray(result.communityIds) &&
    result.communityIds.every(isValidNonNegativeInteger) &&
    Number.isFinite(result.modularity)
  );
}

function isCommunityHierarchyResult(value: unknown): value is RustCommunityHierarchyResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustCommunityHierarchyResult>;
  return Array.isArray(result.levels) && result.levels.every(isCommunityHierarchyLevel);
}

function isCommunityHierarchyLevel(value: unknown): value is RustCommunityHierarchyLevel {
  if (!isCommunityDetectionByIdResult(value)) return false;
  return isValidNonNegativeInteger((value as Partial<RustCommunityHierarchyLevel>).level);
}

function isCommunityAssignmentById(value: unknown): value is RustCommunityAssignmentById {
  if (!value || typeof value !== 'object') return false;
  const assignment = value as Partial<RustCommunityAssignmentById>;
  return isStringValue(assignment.entityId) && isValidNonNegativeInteger(assignment.communityId);
}

function isGraphEvidenceLookupRecord(value: unknown): value is RustGraphEvidenceLookupRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphEvidenceLookupRecord>;
  return isStringValue(record.id) && isStringValue(record.filePath);
}

function isGraphEvidenceCandidateLookupPlan(
  value: unknown,
  scoreCount: number,
  evidenceCount: number,
): value is RustGraphEvidenceCandidateLookupPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphEvidenceCandidateLookupPlan>;
  return (
    isBoundedIndexArray(plan.scoreIndices, scoreCount) &&
    isBoundedIndexArray(plan.evidenceIndices, evidenceCount) &&
    plan.scoreIndices.length === plan.evidenceIndices.length &&
    Array.isArray(plan.filePaths) &&
    plan.filePaths.every(isStringValue)
  );
}

function isGraphEvidenceEntryRecord(value: unknown): value is RustGraphEvidenceEntryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphEvidenceEntryRecord>;
  return isStringValue(record.id) && typeof record.compatible === 'boolean';
}

function isGraphMentionEntityInput(value: unknown): value is RustGraphMentionEntityInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphMentionEntityInput>;
  return (
    isStringValue(record.id) &&
    isStringValue(record.canonicalName) &&
    Array.isArray(record.aliases) &&
    record.aliases.every(isStringValue) &&
    (record.typeId === undefined || isStringValue(record.typeId)) &&
    (record.description === undefined || isStringValue(record.description))
  );
}

function isGraphMentionRelationInput(value: unknown): value is RustGraphMentionRelationInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphMentionRelationInput>;
  return (
    isStringValue(record.sourceEntityId) &&
    isStringValue(record.targetEntityId) &&
    (record.relationTypeId === undefined || isStringValue(record.relationTypeId)) &&
    (record.description === undefined || isStringValue(record.description))
  );
}

function isGraphClaimEntityLookupRecord(value: unknown): value is RustGraphClaimEntityLookupRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphClaimEntityLookupRecord>;
  return isStringValue(record.name) && isStringValue(record.entityId);
}

function isGraphRelationEndpointInput(value: unknown): value is RustGraphRelationEndpointInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphRelationEndpointInput>;
  return isStringValue(record.source) && isStringValue(record.target);
}

function isGraphRelationEndpointLookupRecord(
  value: unknown,
  entityCount: number,
): value is RustGraphRelationEndpointLookupRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphRelationEndpointLookupRecord>;
  return (
    isStringValue(record.name) &&
    typeof record.entityIndex === 'number' &&
    isBoundedInteger(record.entityIndex, entityCount)
  );
}

function isGraphRelationEndpointPlan(
  value: unknown,
  relationCount: number,
  entityCount: number,
): value is RustGraphRelationEndpointPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphRelationEndpointPlan>;
  return (
    Array.isArray(plan.pairs) &&
    plan.pairs.length === relationCount &&
    plan.pairs.every((pair) => {
      if (pair === null) return true;
      if (!pair || typeof pair !== 'object') return false;
      const record = pair as Partial<RustGraphRelationEndpointPair>;
      return (
        typeof record.sourceEntityIndex === 'number' &&
        typeof record.targetEntityIndex === 'number' &&
        isBoundedInteger(record.sourceEntityIndex, entityCount) &&
        isBoundedInteger(record.targetEntityIndex, entityCount)
      );
    })
  );
}

function isGraphCommunityAssignmentInput(
  value: unknown,
): value is RustGraphCommunityAssignmentInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphCommunityAssignmentInput>;
  return isStringValue(record.entityId) && isValidNonNegativeInteger(record.communityId);
}

function isGraphCommunitySummaryRelationInput(
  value: unknown,
): value is RustGraphCommunitySummaryRelationInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphCommunitySummaryRelationInput>;
  return isStringValue(record.sourceEntityId) && isStringValue(record.targetEntityId);
}

function isGraphCommunitySummaryClaimInput(
  value: unknown,
): value is RustGraphCommunitySummaryClaimInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphCommunitySummaryClaimInput>;
  return Array.isArray(record.entityIds) && record.entityIds.every(isStringValue);
}

function isGraphCommunitySummaryGroupsPlan(
  value: unknown,
  entityCount: number,
  relationCount: number,
  claimCount: number,
  communityCount: number,
): value is RustGraphCommunitySummaryGroupsPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphCommunitySummaryGroupsPlan>;
  return (
    Array.isArray(plan.groups) &&
    plan.groups.length === communityCount &&
    plan.groups.every((group) =>
      isGraphCommunitySummaryGroup(group, entityCount, relationCount, claimCount),
    )
  );
}

function isGraphCommunitySummaryGroup(
  value: unknown,
  entityCount: number,
  relationCount: number,
  claimCount: number,
): value is RustGraphCommunitySummaryGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<RustGraphCommunitySummaryGroup>;
  return (
    isBoundedIndexArray(group.entityIndices, entityCount) &&
    isBoundedIndexArray(group.relationIndices, relationCount) &&
    isBoundedIndexArray(group.claimIndices, claimCount)
  );
}

function isGraphCommunityReplacementRecord(
  value: unknown,
): value is RustGraphCommunityReplacementRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustGraphCommunityReplacementRecord>;
  return isStringValue(record.id) && isStringValue(record.ontologySchemaId);
}

function isGraphEvidenceEntryCandidatePlan(
  value: unknown,
  candidateCount: number,
  entryCount: number,
): value is RustGraphEvidenceEntryCandidatePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphEvidenceEntryCandidatePlan>;
  return (
    isBoundedIndexArray(plan.candidateIndices, candidateCount) &&
    isBoundedIndexArray(plan.entryIndices, entryCount) &&
    plan.candidateIndices.length === plan.entryIndices.length
  );
}

function isGraphMentionContextPlan(
  value: unknown,
  entityCount: number,
  relationCount: number,
): value is RustGraphMentionContextPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphMentionContextPlan>;
  return (
    isBoundedIndexArray(plan.matchedEntityIndices, entityCount) &&
    isBoundedIndexArray(plan.matchedRelationIndices, relationCount) &&
    Array.isArray(plan.contextLines) &&
    plan.contextLines.every(isStringValue)
  );
}

function isValidFileIndexEntryInput(input: RustFileIndexEntryInput): boolean {
  return (
    isStringValue(input.filePath) &&
    (input.sourceMtime === undefined || Number.isFinite(input.sourceMtime)) &&
    (input.sourceSize === undefined || Number.isFinite(input.sourceSize)) &&
    (input.contentHash === undefined || isStringValue(input.contentHash)) &&
    (input.indexedAt === undefined || Number.isFinite(input.indexedAt)) &&
    (input.endLine === undefined || Number.isFinite(input.endLine)) &&
    (input.embeddingProvider === undefined || isStringValue(input.embeddingProvider)) &&
    (input.embeddingModel === undefined || isStringValue(input.embeddingModel)) &&
    (input.updated === undefined || Number.isFinite(input.updated))
  );
}

function isFileIndexRecordPlan(value: unknown): value is RustFileIndexRecordPlan {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustFileIndexRecordPlan>;
  const vectorCount = record.vectorCount;
  return (
    isStringValue(record.filePath) &&
    (record.sourceMtime === undefined || Number.isFinite(record.sourceMtime)) &&
    (record.sourceSize === undefined || Number.isFinite(record.sourceSize)) &&
    (record.contentHash === undefined || isStringValue(record.contentHash)) &&
    (record.indexedAt === undefined || Number.isFinite(record.indexedAt)) &&
    (record.embeddingProvider === undefined || isStringValue(record.embeddingProvider)) &&
    (record.embeddingModel === undefined || isStringValue(record.embeddingModel)) &&
    typeof record.hasCompleteMetadata === 'boolean' &&
    typeof vectorCount === 'number' &&
    Number.isSafeInteger(vectorCount) &&
    vectorCount >= 0 &&
    Number.isFinite(record.updated)
  );
}

function isIndexedDbStorageLayout(value: unknown): value is RustIndexedDbStorageLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<RustIndexedDbStorageLayout>;
  const active = layout.active;
  return (
    isValidNonNegativeInteger(layout.contractVersion) &&
    isStringValue(layout.currentVaultPrefix) &&
    Array.isArray(layout.ownedVaultPrefixes) &&
    layout.ownedVaultPrefixes.every(isStringValue) &&
    !!active &&
    isStringValue(active.vector) &&
    isStringValue(active.embeddingCache) &&
    isStringValue(active.bm25) &&
    isStringValue(active.graph) &&
    Array.isArray(layout.cleanupLegacyNames) &&
    layout.cleanupLegacyNames.every(isStringValue) &&
    Array.isArray(layout.legacyNames) &&
    layout.legacyNames.every(isStringValue)
  );
}

function isRagStorageHealthInput(value: RustRagStorageHealthInput): boolean {
  return (
    typeof value.coverageChecked === 'boolean' &&
    isValidNonNegativeInteger(value.pendingDocumentCount) &&
    typeof value.embeddingContractMatches === 'boolean' &&
    typeof value.completionFingerprintMatches === 'boolean' &&
    typeof value.activeStoreQueryable === 'boolean' &&
    typeof value.reconciliationComplete === 'boolean'
  );
}

function isRagStorageHealthPlan(value: unknown): value is RustRagStorageHealthPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagStorageHealthPlan>;
  return (
    typeof plan.canReconcile === 'boolean' && typeof plan.canDeleteStaleGenerations === 'boolean'
  );
}

function isIndexedDbBoundedCleanupPlan(value: unknown): value is RustIndexedDbBoundedCleanupPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustIndexedDbBoundedCleanupPlan>;
  return (
    Array.isArray(plan.deleteNames) &&
    plan.deleteNames.every(isStringValue) &&
    isValidNonNegativeInteger(plan.remainingDeleteCount)
  );
}

function isStaleIndexSourcePathsPlan(value: unknown): value is RustStaleIndexSourcePathsPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustStaleIndexSourcePathsPlan>;
  return (
    Array.isArray(plan.deletePaths) &&
    plan.deletePaths.every(isStringValue) &&
    isValidNonNegativeInteger(plan.remainingDeleteCount)
  );
}

function isInactiveIndexedDbCleanupInput(value: RustInactiveIndexedDbCleanupInput): boolean {
  return (
    [value.databaseNames, value.activeNames, value.currentVaultPrefixes, value.currentLegacyNames]
      .flat()
      .every((name) => isStringValue(name) && name.length > 0) &&
    isStringValue(value.pluginId) &&
    value.pluginId.length > 0 &&
    value.records.every(isInactiveIndexedDbRecord) &&
    Number.isFinite(value.now) &&
    Number.isFinite(value.maxInactiveAgeMs) &&
    value.maxInactiveAgeMs >= 0 &&
    isValidNonNegativeInteger(value.maxDeletions)
  );
}

function isInactiveIndexedDbRecord(value: unknown): value is RustInactiveIndexedDbRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustInactiveIndexedDbRecord>;
  return (
    isStringValue(record.key) &&
    record.key.length > 0 &&
    Number.isFinite(record.firstSeen) &&
    (record.lastSeen === null || Number.isFinite(record.lastSeen))
  );
}

function isInactiveIndexedDbCleanupPlan(value: unknown): value is RustInactiveIndexedDbCleanupPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustInactiveIndexedDbCleanupPlan>;
  return (
    Array.isArray(plan.records) &&
    plan.records.every(isInactiveIndexedDbRecord) &&
    Array.isArray(plan.deleteNames) &&
    plan.deleteNames.every(isStringValue) &&
    isValidNonNegativeInteger(plan.remainingDeleteCount)
  );
}

function isGraphStorageMaintenanceInput(value: RustGraphStorageMaintenanceInput): boolean {
  const recordGroups = [
    value.extractionJobs,
    value.rawResponses,
    value.communitySummaryJobs,
    value.globalSearchJobs,
    value.providerCircuits,
  ];
  return (
    value.validFilePaths.every((path) => isStringValue(path) && path.length > 0) &&
    value.graphFilePaths.every((path) => isStringValue(path) && path.length > 0) &&
    recordGroups.every((records) => records.every(isGraphStorageRecord)) &&
    Number.isFinite(value.now) &&
    Number.isFinite(value.maxAgeMs) &&
    value.maxAgeMs >= 0 &&
    [
      value.maxExtractionJobs,
      value.maxRawResponses,
      value.maxCommunitySummaryJobs,
      value.maxGlobalSearchJobs,
      value.maxProviderCircuits,
      value.maxDeletions,
    ].every(isValidNonNegativeInteger)
  );
}

function isGraphStorageRecord(value: RustGraphStorageRecord): boolean {
  return (
    isStringValue(value.id) &&
    value.id.length > 0 &&
    (value.state === undefined || isStringValue(value.state)) &&
    (value.filePath === undefined ||
      (isStringValue(value.filePath) && value.filePath.length > 0)) &&
    (value.rawResponseId === undefined ||
      (isStringValue(value.rawResponseId) && value.rawResponseId.length > 0)) &&
    [value.leaseExpiresAt, value.openUntil, value.updatedAt, value.receivedAt].every(
      (timestamp) => timestamp === undefined || Number.isFinite(timestamp),
    )
  );
}

function isGraphStorageMaintenancePlan(value: unknown): value is RustGraphStorageMaintenancePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphStorageMaintenancePlan>;
  return (
    [
      plan.deleteFilePaths,
      plan.deleteExtractionJobIds,
      plan.deleteRawResponseIds,
      plan.deleteCommunitySummaryJobIds,
      plan.deleteGlobalSearchJobIds,
      plan.deleteProviderCircuitIds,
    ].every((ids) => Array.isArray(ids) && ids.every(isStringValue)) &&
    typeof plan.remainingWork === 'boolean'
  );
}

function isIndexedDbRetentionRecord(value: RustIndexedDbRetentionRecord): boolean {
  return isStringValue(value.id) && value.id.length > 0 && Number.isFinite(value.updated);
}

function isPluginOwnedFileMaintenanceInput(value: RustPluginOwnedFileMaintenanceInput): boolean {
  return (
    Array.isArray(value.records) &&
    value.records.every(isPluginOwnedFileRecord) &&
    [value.pluginDirectory, value.legacyDataDirectory, value.eventLogPath].every(
      (path) => isStringValue(path) && path.length > 0,
    ) &&
    Number.isFinite(value.now) &&
    value.now >= 0 &&
    Number.isFinite(value.staleTempAgeMs) &&
    value.staleTempAgeMs >= 0 &&
    isValidNonNegativeInteger(value.maxEventLogBytes) &&
    typeof value.allowLegacyCleanup === 'boolean' &&
    isValidNonNegativeInteger(value.maxDeletions)
  );
}

function isPluginOwnedFileRecord(value: unknown): value is RustPluginOwnedFileRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustPluginOwnedFileRecord>;
  return (
    isStringValue(record.path) &&
    record.path.length > 0 &&
    Number.isFinite(record.mtime) &&
    (record.mtime ?? -1) >= 0 &&
    isValidNonNegativeInteger(record.size)
  );
}

function isPluginOwnedFileMaintenancePlan(
  value: unknown,
): value is RustPluginOwnedFileMaintenancePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustPluginOwnedFileMaintenancePlan>;
  return (
    Array.isArray(plan.deletePaths) &&
    plan.deletePaths.every(isStringValue) &&
    isValidNonNegativeInteger(plan.remainingDeleteCount) &&
    (plan.rotateEventLogPath === null || isStringValue(plan.rotateEventLogPath))
  );
}

function isIndexedDbBoundedRetentionPlan(
  value: unknown,
): value is RustIndexedDbBoundedRetentionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustIndexedDbBoundedRetentionPlan>;
  return (
    Array.isArray(plan.deleteIds) &&
    plan.deleteIds.every(isStringValue) &&
    typeof plan.remainingWork === 'boolean' &&
    isValidNonNegativeInteger(plan.remainingRecordCount)
  );
}

function isVectorFileIndexBatchInput(value: RustVectorFileIndexBatchInput): boolean {
  return (
    isStringValue(value.filePath) &&
    value.filePath.length > 0 &&
    typeof value.isEligible === 'boolean' &&
    typeof value.hasCompleteMetadata === 'boolean' &&
    (value.embeddingProvider === undefined || isStringValue(value.embeddingProvider)) &&
    (value.embeddingModel === undefined || isStringValue(value.embeddingModel))
  );
}

function isVectorRecordBatchInput(value: RustVectorRecordBatchInput): boolean {
  return (
    isStringValue(value.id) &&
    value.id.length > 0 &&
    (value.embeddingProvider === undefined || isStringValue(value.embeddingProvider)) &&
    (value.embeddingModel === undefined || isStringValue(value.embeddingModel)) &&
    isValidNonNegativeInteger(value.dimension) &&
    typeof value.fileIndexExists === 'boolean' &&
    typeof value.metadataComplete === 'boolean' &&
    (value.contentHash === undefined || isStringValue(value.contentHash)) &&
    (value.fileContentHash === undefined || isStringValue(value.fileContentHash)) &&
    Number.isFinite(value.updated) &&
    (value.fileUpdated === undefined || Number.isFinite(value.fileUpdated))
  );
}

function isRagAutomaticRecoveryFileInput(value: RustRagAutomaticRecoveryFileInput): boolean {
  return (
    isStringValue(value.path) &&
    value.path.trim().length > 0 &&
    isValidNonNegativeInteger(value.mtime) &&
    isValidNonNegativeInteger(value.size)
  );
}

function isRagAutomaticRecoveryPlan(value: unknown): value is RustRagAutomaticRecoveryPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagAutomaticRecoveryPlan>;
  return (
    isStringValue(plan.fingerprint) &&
    /^[a-f0-9]{32}$/.test(plan.fingerprint) &&
    typeof plan.requiresRecovery === 'boolean' &&
    typeof plan.shouldRecordCompletion === 'boolean' &&
    typeof plan.retryAllowed === 'boolean' &&
    isValidNonNegativeInteger(plan.retryDelayMs) &&
    isValidNonNegativeInteger(plan.fileCount)
  );
}

function isRagAutomaticRecoveryBatchPlan(
  value: unknown,
): value is RustRagAutomaticRecoveryBatchPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagAutomaticRecoveryBatchPlan>;
  return (
    Array.isArray(plan.eligibleIndices) &&
    plan.eligibleIndices.every(isValidNonNegativeInteger) &&
    Array.isArray(plan.batchIndices) &&
    plan.batchIndices.every(isValidNonNegativeInteger) &&
    isValidNonNegativeInteger(plan.selectedSourceBytes)
  );
}

function isRagPerformanceGuardInput(input: RustRagPerformanceGuardInput): boolean {
  const { config, event } = input;
  const validEventKinds: readonly RustRagPerformanceGuardEventKind[] = [
    'initialize',
    'batch_sample',
    'event_loop_sample',
    'timer_tick',
    'force_resume',
    'reset',
  ];
  const requiresDuration = event.kind === 'batch_sample' || event.kind === 'event_loop_sample';
  const requiresBatchSize = event.kind === 'batch_sample';
  return (
    typeof config.enabled === 'boolean' &&
    isValidNonNegativeInteger(config.initialBatchSize) &&
    config.initialBatchSize > 0 &&
    isValidNonNegativeInteger(config.initialYieldMs) &&
    Number.isFinite(config.slowEventLoopThresholdMs) &&
    config.slowEventLoopThresholdMs > 0 &&
    Number.isFinite(config.slowBatchThresholdMs) &&
    config.slowBatchThresholdMs > 0 &&
    validEventKinds.includes(event.kind) &&
    (!requiresDuration ||
      (event.durationMs !== undefined &&
        Number.isFinite(event.durationMs) &&
        event.durationMs >= 0)) &&
    (!requiresBatchSize ||
      (event.batchSize !== undefined &&
        isValidNonNegativeInteger(event.batchSize) &&
        event.batchSize > 0)) &&
    Number.isFinite(input.nowMs) &&
    input.nowMs >= 0 &&
    (input.state === null || isRagPerformanceGuardPolicyState(input.state, config))
  );
}

function isRagPerformanceGuardPolicyState(
  value: unknown,
  config: RustRagPerformanceGuardConfig,
): value is RustRagPerformanceGuardPolicyState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RustRagPerformanceGuardPolicyState>;
  const validModes: readonly RustRagPerformanceGuardMode[] = ['normal', 'throttled', 'paused'];
  const validReasons: readonly RustRagPerformanceGuardReasonKind[] = [
    'batch',
    'event-loop',
    'resumed',
  ];
  const validOptionalReason = (reason: unknown): boolean =>
    reason === null || validReasons.includes(reason as RustRagPerformanceGuardReasonKind);
  const validOptionalTime = (value: unknown): boolean =>
    value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return (
    validModes.includes(state.mode as RustRagPerformanceGuardMode) &&
    isValidNonNegativeInteger(state.currentBatchSize) &&
    state.currentBatchSize > 0 &&
    state.currentBatchSize <= config.initialBatchSize &&
    isValidNonNegativeInteger(state.currentYieldMs) &&
    state.currentYieldMs <= 1_000 &&
    isValidNonNegativeInteger(state.slowBatchSamples) &&
    state.slowBatchSamples <= 2 &&
    isValidNonNegativeInteger(state.slowEventLoopSamples) &&
    state.slowEventLoopSamples <= 3 &&
    isValidNonNegativeInteger(state.healthyBatchSamples) &&
    state.healthyBatchSamples <= 2 &&
    isValidNonNegativeInteger(state.healthyEventLoopSamples) &&
    state.healthyEventLoopSamples <= 2 &&
    validOptionalReason(state.reasonKind) &&
    validOptionalTime(state.reasonMs) &&
    validOptionalTime(state.pauseUntilMs) &&
    validOptionalReason(state.lastSlowKind) &&
    validOptionalTime(state.lastSlowMs) &&
    (state.mode === 'paused'
      ? state.pauseUntilMs !== null && state.currentBatchSize === 1 && state.currentYieldMs === 250
      : state.pauseUntilMs === null)
  );
}

function isVectorStoreMutationPlan(value: unknown): value is RustVectorStoreMutationPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustVectorStoreMutationPlan>;
  return (
    Array.isArray(plan.sources) &&
    plan.sources.every(isVectorStoreSourcePlan) &&
    typeof plan.removedCount === 'number' &&
    Number.isSafeInteger(plan.removedCount) &&
    plan.removedCount >= 0 &&
    typeof plan.changed === 'boolean'
  );
}

function isVectorStoreSourcePlan(value: unknown): value is RustVectorStoreSourcePlan {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<RustVectorStoreSourcePlan>;
  return (
    (source.source === 'existing' || source.source === 'incoming') &&
    typeof source.index === 'number' &&
    Number.isSafeInteger(source.index) &&
    source.index >= 0
  );
}

function isVectorStoreStatsPlan(value: unknown): value is RustVectorStoreStatsPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustVectorStoreStatsPlan>;
  return (
    typeof plan.totalEntries === 'number' &&
    Number.isSafeInteger(plan.totalEntries) &&
    plan.totalEntries >= 0 &&
    typeof plan.totalFiles === 'number' &&
    Number.isSafeInteger(plan.totalFiles) &&
    plan.totalFiles >= 0 &&
    typeof plan.totalVectors === 'number' &&
    Number.isSafeInteger(plan.totalVectors) &&
    plan.totalVectors >= 0 &&
    Number.isFinite(plan.averageVectorsPerFile) &&
    (plan.lastUpdated === null || Number.isFinite(plan.lastUpdated)) &&
    Array.isArray(plan.indexedFilePaths) &&
    plan.indexedFilePaths.every(isStringValue)
  );
}

function isVectorStoreIndexPlan(value: unknown, maxExclusive: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (index) =>
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < maxExclusive,
    )
  );
}

function isValidRagStatusFileInput(input: RustRagStatusFileInput): boolean {
  return isStringValue(input.path) && Number.isFinite(input.mtime) && Number.isFinite(input.size);
}

function isValidRagStatusRecordInput(input: RustRagStatusRecordInput): boolean {
  return (
    isStringValue(input.filePath) &&
    (input.sourceMtime === undefined || Number.isFinite(input.sourceMtime)) &&
    (input.sourceSize === undefined || Number.isFinite(input.sourceSize)) &&
    (input.contentHash === undefined || isStringValue(input.contentHash)) &&
    (input.indexedAt === undefined || Number.isFinite(input.indexedAt)) &&
    (input.embeddingProvider === undefined || isStringValue(input.embeddingProvider)) &&
    (input.embeddingModel === undefined || isStringValue(input.embeddingModel)) &&
    (input.hasCompleteMetadata === undefined || typeof input.hasCompleteMetadata === 'boolean') &&
    isValidNonNegativeInteger(input.vectorCount)
  );
}

function isValidRagStatusReasonLabels(value: unknown): value is RustRagStatusReasonLabels {
  if (!value || typeof value !== 'object') return false;
  const labels = value as Partial<RustRagStatusReasonLabels>;
  return (
    isStringValue(labels.missing) &&
    isStringValue(labels.legacy) &&
    isStringValue(labels.staleFile) &&
    isStringValue(labels.embeddingChanged)
  );
}

function isRagStatusPlan(value: unknown): value is RustRagStatusPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagStatusPlan>;
  return (
    isValidNonNegativeInteger(plan.totalDocuments) &&
    isValidNonNegativeInteger(plan.healthyDocuments) &&
    isValidNonNegativeInteger(plan.missingDocuments) &&
    isValidNonNegativeInteger(plan.staleDocuments) &&
    isValidNonNegativeInteger(plan.unknownDocuments) &&
    isValidNonNegativeInteger(plan.excludedDocuments) &&
    isValidNonNegativeInteger(plan.totalVectors) &&
    Array.isArray(plan.updateRequiredDocuments) &&
    plan.updateRequiredDocuments.every(isRagDocumentUpdatePlan)
  );
}

function isRagDocumentUpdatePlan(value: unknown): value is RustRagDocumentUpdatePlan {
  if (!value || typeof value !== 'object') return false;
  const update = value as Partial<RustRagDocumentUpdatePlan>;
  return (
    isStringValue(update.path) &&
    (update.status === 'missing' || update.status === 'stale' || update.status === 'unknown') &&
    isStringValue(update.reason) &&
    Number.isFinite(update.mtime) &&
    Number.isFinite(update.size)
  );
}

function isIndexPendingPlan(value: unknown, fileCount: number): value is RustIndexPendingPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustIndexPendingPlan>;
  return (
    isValidNonNegativeInteger(plan.skipped) &&
    Array.isArray(plan.fileIndices) &&
    plan.fileIndices.every((index) => isValidNonNegativeInteger(index) && index < fileCount) &&
    plan.skipped + plan.fileIndices.length <= fileCount
  );
}

function isValidRagIndexingEtaInput(input: RustRagIndexingEtaInput): boolean {
  return (
    Number.isFinite(input.nowMs) &&
    Number.isFinite(input.startedAtMs) &&
    isValidNonNegativeInteger(input.totalFiles) &&
    isValidNonNegativeInteger(input.completedFiles) &&
    isValidNonNegativeInteger(input.currentFileTotalChunks) &&
    isValidNonNegativeInteger(input.currentFileEmbeddedChunks) &&
    isValidNonNegativeInteger(input.totalEstimatedChunks) &&
    isValidNonNegativeInteger(input.completedEstimatedChunks) &&
    isValidNonNegativeInteger(input.currentFileEstimatedChunks) &&
    isValidNonNegativeInteger(input.totalPlannedChunks) &&
    isValidNonNegativeInteger(input.completedPlannedChunks) &&
    typeof input.planningComplete === 'boolean' &&
    Array.isArray(input.completedBatchDurationsMs) &&
    input.completedBatchDurationsMs.every(Number.isFinite) &&
    Array.isArray(input.completedBatchChunkCounts) &&
    input.completedBatchChunkCounts.every(isValidNonNegativeInteger) &&
    Array.isArray(input.completedFileDurationsMs) &&
    input.completedFileDurationsMs.every(Number.isFinite) &&
    Array.isArray(input.completedFileChunkCounts) &&
    input.completedFileChunkCounts.every(isValidNonNegativeInteger) &&
    Array.isArray(input.completedFileEstimatedChunkCounts) &&
    input.completedFileEstimatedChunkCounts.every(isValidNonNegativeInteger) &&
    Array.isArray(input.completedFileActualChunkCounts) &&
    input.completedFileActualChunkCounts.every(isValidNonNegativeInteger) &&
    Array.isArray(input.completedFileOverheadDurationsMs) &&
    input.completedFileOverheadDurationsMs.every(Number.isFinite) &&
    isNullableFiniteNonNegativeNumber(input.historicalMsPerChunk) &&
    isNullableFiniteNonNegativeNumber(input.historicalChunkEstimateRatio) &&
    isNullableFiniteNonNegativeNumber(input.historicalVariance)
  );
}

function isRagIndexingEtaPlan(value: unknown): value is RustRagIndexingEtaPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagIndexingEtaPlan>;
  const currentFileProgress = plan.currentFileProgress;
  const progressRatio = plan.progressRatio;
  const elapsedMs = plan.elapsedMs;
  return (
    isValidNonNegativeInteger(plan.totalFiles) &&
    isValidNonNegativeInteger(plan.completedFiles) &&
    typeof currentFileProgress === 'number' &&
    Number.isFinite(currentFileProgress) &&
    currentFileProgress >= 0 &&
    currentFileProgress <= 1 &&
    typeof progressRatio === 'number' &&
    Number.isFinite(progressRatio) &&
    progressRatio >= 0 &&
    progressRatio <= 1 &&
    typeof elapsedMs === 'number' &&
    Number.isFinite(elapsedMs) &&
    elapsedMs >= 0 &&
    isNullableFiniteNonNegativeNumber(plan.remainingMs) &&
    isNullableFiniteNonNegativeNumber(plan.estimatedCompletionMs) &&
    isRagIndexingEtaConfidence(plan.confidence) &&
    isRagIndexingEtaBasis(plan.basis) &&
    isNullableFiniteNonNegativeNumber(plan.lowerRemainingMs) &&
    isNullableFiniteNonNegativeNumber(plan.upperRemainingMs) &&
    isStringValue(plan.confidenceReason) &&
    isStringValue(plan.etaConfidenceReason)
  );
}

function isNullableFiniteNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isRagIndexingEtaConfidence(value: unknown): value is RustRagIndexingEtaConfidence {
  return (
    value === 'calculating' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'complete'
  );
}

function isRagIndexingEtaBasis(value: unknown): value is RustRagIndexingEtaBasis {
  return (
    value === 'planned-chunks' ||
    value === 'calibrated-estimate' ||
    value === 'batch-rate' ||
    value === 'elapsed-rate'
  );
}

function isValidGraphRagStatusInput(input: RustGraphRagStatusInput): boolean {
  return (
    typeof input.graphRagEnabled === 'boolean' &&
    typeof input.isRunning === 'boolean' &&
    isValidNonNegativeInteger(input.totalCandidateFiles) &&
    Number.isFinite(input.graphRagMaxFilesPerRun) &&
    isStringValue(input.graphRagModel) &&
    isStringValue(input.ontologySchemaId) &&
    isValidNonNegativeInteger(input.ontologyVersion) &&
    input.fileRecords.every(isValidGraphRagStatusFileRecordInput) &&
    input.evidence.every(isValidGraphRagStatusEvidenceInput) &&
    input.rejectedFactFilePaths.every(isStringValue) &&
    isValidNonNegativeInteger(input.pendingMergeCount) &&
    input.cacheRecords.every(isValidGraphRagStatusCacheInput) &&
    input.entries.every(isValidGraphRagStatusEntryInput)
  );
}

function isValidGraphRagStatusFileRecordInput(input: RustGraphRagStatusFileRecordInput): boolean {
  return isStringValue(input.filePath) && isValidNonNegativeInteger(input.vectorCount);
}

function isValidGraphRagStatusFileSnapshotRecordInput(
  input: RustGraphRagStatusFileSnapshotRecordInput,
): boolean {
  return isValidGraphRagStatusFileRecordInput(input) && typeof input.processable === 'boolean';
}

function isValidGraphRagStatusEvidenceInput(input: RustGraphRagStatusEvidenceInput): boolean {
  return (
    isStringValue(input.filePath) &&
    isStringValue(input.entryId) &&
    isStringValue(input.contentHash) &&
    isStringValue(input.extractionModelKey) &&
    typeof input.processable === 'boolean'
  );
}

function isValidGraphRagStatusCacheInput(input: RustGraphRagStatusCacheInput): boolean {
  return (
    isStringValue(input.entryId) &&
    isStringValue(input.contentHash) &&
    isStringValue(input.extractionModelKey) &&
    isStringValue(input.ontologySchemaId) &&
    isValidNonNegativeInteger(input.ontologyVersion)
  );
}

function isValidGraphRagStatusEntryInput(input: RustGraphRagStatusEntryInput): boolean {
  return (
    isStringValue(input.id) &&
    isStringValue(input.filePath) &&
    (input.contentHash === undefined || isStringValue(input.contentHash)) &&
    isStringValue(input.text)
  );
}

function isValidGraphRagStatusEntrySnapshotInput(
  input: RustGraphRagStatusEntrySnapshotInput,
): boolean {
  return (
    isStringValue(input.id) &&
    isStringValue(input.filePath) &&
    typeof input.processable === 'boolean'
  );
}

function isGraphRagStatusFileSnapshotPlan(
  value: unknown,
  fileRecordCount: number,
): value is RustGraphRagStatusFileSnapshotPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphRagStatusFileSnapshotPlan>;
  return (
    Array.isArray(plan.fileRecordIndices) &&
    plan.fileRecordIndices.every(
      (index) => isValidNonNegativeInteger(index) && index < fileRecordCount,
    ) &&
    isValidNonNegativeInteger(plan.totalCandidateFiles)
  );
}

function isGraphRagStatusEntrySnapshotPlan(
  value: unknown,
  entryCount: number,
): value is RustGraphRagStatusEntrySnapshotPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphRagStatusEntrySnapshotPlan>;
  return (
    Array.isArray(plan.entryIndices) &&
    plan.entryIndices.every((index) => isValidNonNegativeInteger(index) && index < entryCount)
  );
}

function isGraphRagStatusPlan(value: unknown): value is RustGraphRagStatusPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphRagStatusPlan>;
  return (
    isGraphRagIndexState(plan.state) &&
    isValidNonNegativeInteger(plan.totalCandidateFiles) &&
    isValidNonNegativeInteger(plan.graphEvidenceCount) &&
    isValidNonNegativeInteger(plan.rejectedFactCount) &&
    isValidNonNegativeInteger(plan.failedFileCount) &&
    isValidNonNegativeInteger(plan.pendingMergeCount) &&
    isValidNonNegativeInteger(plan.staleFileCount) &&
    Array.isArray(plan.staleFilePaths) &&
    plan.staleFilePaths.every(isStringValue) &&
    isValidNonNegativeInteger(plan.maxFilesPerRun)
  );
}

function isValidGraphRagRunFileSelectionInput(input: RustGraphRagRunFileSelectionInput): boolean {
  return (
    (input.mode === 'failed' || input.mode === 'stale' || input.mode === 'full') &&
    input.failedFilePaths.every(isStringValue) &&
    input.staleFilePaths.every(isStringValue) &&
    input.recordFilePaths.every(isValidGraphRagRunFilePathInput) &&
    input.indexedFilePaths.every(isValidGraphRagRunFilePathInput) &&
    isValidNonNegativeInteger(input.maxFilesPerRun)
  );
}

function isValidGraphRagRunFilePathInput(input: RustGraphRagRunFilePathInput): boolean {
  return isStringValue(input.filePath) && typeof input.processable === 'boolean';
}

function isGraphRagRunFileSelectionPlan(value: unknown): value is RustGraphRagRunFileSelectionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphRagRunFileSelectionPlan>;
  return (
    Array.isArray(plan.candidateFilePaths) &&
    plan.candidateFilePaths.every(isStringValue) &&
    Array.isArray(plan.selectedFilePaths) &&
    plan.selectedFilePaths.every(isStringValue)
  );
}

function isValidGraphEntityMergeInput(input: RustGraphEntityMergeInput): boolean {
  return (
    input.aliases.every(isStringValue) &&
    isStringValue(input.description) &&
    Number.isFinite(input.confidence) &&
    input.evidenceIds.every(isStringValue) &&
    Number.isFinite(input.updatedAt)
  );
}

function isGraphEntityMergePlan(value: unknown): value is RustGraphEntityMergePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustGraphEntityMergePlan>;
  return (
    Array.isArray(plan.aliases) &&
    plan.aliases.every(isStringValue) &&
    isStringValue(plan.description) &&
    Number.isFinite(plan.confidence) &&
    Array.isArray(plan.evidenceIds) &&
    plan.evidenceIds.every(isStringValue) &&
    Number.isFinite(plan.updatedAt)
  );
}

function isValidGraphExtractionCacheKey(value: RustGraphExtractionCacheKey): boolean {
  return (
    isStringValue(value.entryId) &&
    isStringValue(value.contentHash) &&
    isStringValue(value.extractionModelKey) &&
    isStringValue(value.ontologySchemaId) &&
    isValidNonNegativeInteger(value.ontologyVersion) &&
    isValidNonNegativeInteger(value.extractionContractVersion)
  );
}

function isGraphRagIndexState(value: unknown): value is RustGraphRagIndexState {
  return (
    value === 'disabled' ||
    value === 'not-built' ||
    value === 'building' ||
    value === 'ready' ||
    value === 'partial' ||
    value === 'stale'
  );
}

function isValidRagFileTypeInput(input: RustRagFileTypeInput): boolean {
  return (
    isStringValue(input.filePath) &&
    (input.extension === undefined || isStringValue(input.extension)) &&
    typeof input.indexable === 'boolean' &&
    (input.recommendationReason === undefined || isStringValue(input.recommendationReason))
  );
}

function isValidPromptLibrarySummaryInput(input: RustPromptLibrarySummaryInput): boolean {
  return isStringValue(input.filePath) && isStringValue(input.heading) && isStringValue(input.text);
}

function isValidRagFileEligibilityInput(input: RustRagFileEligibilityInput): boolean {
  return (
    isStringValue(input.filePath) &&
    isStringValue(input.fileName) &&
    isStringValue(input.extension) &&
    isValidNonNegativeInteger(input.size)
  );
}

function isValidRagFileTextProbeInput(input: RustRagFileTextProbeInput): boolean {
  return (
    isValidNonNegativeInteger(input.index) &&
    typeof input.readable === 'boolean' &&
    isStringValue(input.sample)
  );
}

function isNonNegativeIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isValidNonNegativeInteger);
}

function isRagFileIndexabilityPlan(value: unknown): value is RustRagFileIndexabilityPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustRagFileIndexabilityPlan>;
  return (
    isNonNegativeIntegerArray(plan.candidateIndices) &&
    Array.isArray(plan.summaryInputs) &&
    plan.summaryInputs.every(isValidRagFileTypeInput)
  );
}

function isRagFileTypeSummary(value: unknown): value is RustRagFileTypeSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Partial<RustRagFileTypeSummary>;
  return (
    Array.isArray(summary.targetTypes) &&
    summary.targetTypes.every(isRagFileTypeCount) &&
    Array.isArray(summary.excludeRecommendations) &&
    summary.excludeRecommendations.every(isRagExcludeRecommendation) &&
    typeof summary.totalTargetFiles === 'number' &&
    Number.isSafeInteger(summary.totalTargetFiles) &&
    summary.totalTargetFiles >= 0
  );
}

function isPromptLibrarySummaryCount(value: unknown): value is RustPromptLibrarySummaryCount {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RustPromptLibrarySummaryCount>;
  return (
    isStringValue(row.label) &&
    typeof row.count === 'number' &&
    Number.isSafeInteger(row.count) &&
    row.count >= 0
  );
}

function isPromptLibrarySummary(value: unknown): value is RustPromptLibrarySummary {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustPromptLibrarySummary>;
  return (
    isValidNonNegativeInteger(plan.totalChunks) &&
    Array.isArray(plan.topFolders) &&
    plan.topFolders.every(isPromptLibrarySummaryCount) &&
    Array.isArray(plan.topFiles) &&
    plan.topFiles.every(isPromptLibrarySummaryCount) &&
    Array.isArray(plan.topHeadings) &&
    plan.topHeadings.every(isPromptLibrarySummaryCount) &&
    Array.isArray(plan.samples) &&
    plan.samples.every(
      (sample): sample is RustPromptLibrarySummarySample =>
        typeof sample === 'object' &&
        sample !== null &&
        isStringValue(sample.filePath) &&
        isStringValue(sample.heading) &&
        isStringValue(sample.preview),
    )
  );
}

function isRagFileTypeCount(value: unknown): value is RustRagFileTypeCount {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RustRagFileTypeCount>;
  return (
    isStringValue(row.extension) &&
    isStringValue(row.label) &&
    typeof row.count === 'number' &&
    Number.isSafeInteger(row.count) &&
    row.count >= 0
  );
}

function isRagExcludeRecommendation(value: unknown): value is RustRagExcludeRecommendation {
  if (!isRagFileTypeCount(value)) return false;
  const row = value as Partial<RustRagExcludeRecommendation>;
  return isStringValue(row.reason);
}

function isRustExcludeValidationResult(value: unknown): value is RustExcludeValidationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustExcludeValidationResult>;
  return (
    isStringValue(result.normalized) &&
    Array.isArray(result.issues) &&
    result.issues.every(isRustExcludeValidationIssue) &&
    typeof result.valid === 'boolean'
  );
}

function isRustExcludeValidationIssue(value: unknown): value is RustExcludeValidationIssue {
  if (!value || typeof value !== 'object') return false;
  const issue = value as Partial<RustExcludeValidationIssue>;
  return (
    (issue.level === 'error' || issue.level === 'warning') &&
    (issue.code === 'empty' ||
      issue.code === 'trimmed' ||
      issue.code === 'duplicate' ||
      issue.code === 'comma' ||
      issue.code === 'path-backslash' ||
      issue.code === 'path-leading-slash' ||
      issue.code === 'path-missing' ||
      issue.code === 'extension-leading-dot' ||
      issue.code === 'extension-invalid' ||
      issue.code === 'extension-protected-document')
  );
}

function isSourceReferencePlan(value: unknown): value is RustSourceReferencePlan {
  if (!value || typeof value !== 'object') return false;
  const reference = value as Partial<RustSourceReferencePlan>;
  return (
    isStringValue(reference.label) &&
    isStringValue(reference.target) &&
    (reference.kind === 'wikilink' ||
      reference.kind === 'markdown-link' ||
      reference.kind === 'source-id') &&
    Array.isArray(reference.aliases) &&
    reference.aliases.every(isStringValue)
  );
}

function isSourceValidationWarningPlan(value: unknown): value is RustSourceValidationWarningPlan {
  if (!value || typeof value !== 'object') return false;
  const warning = value as Partial<RustSourceValidationWarningPlan>;
  return (
    isStringValue(warning.id) &&
    isStringValue(warning.label) &&
    (warning.kind === 'missing-link' || warning.kind === 'unverified-source')
  );
}

function isSourceValidationInputPlan(value: unknown): value is RustSourceValidationInputPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustSourceValidationInputPlan>;
  return (
    Array.isArray(plan.verifiedCitationIds) &&
    plan.verifiedCitationIds.every(isStringValue) &&
    Array.isArray(plan.verifiedPaths) &&
    plan.verifiedPaths.every(isStringValue) &&
    Array.isArray(plan.aliasCandidates) &&
    plan.aliasCandidates.every(isStringValue)
  );
}

function isAssistantResponseClassification(
  value: unknown,
): value is RustAssistantResponseClassification {
  if (!value || typeof value !== 'object') return false;
  const classification = value as Partial<RustAssistantResponseClassification>;
  if (
    classification.type === 'answer' &&
    isStringValue(classification.content) &&
    isStringValue(classification.reasoning)
  ) {
    return true;
  }
  if (classification.type !== 'question') return false;
  return (
    isStringValue(classification.content) &&
    isStringValue(classification.reasoning) &&
    isAssistantQuestionPlan(classification.question) &&
    isStringValue(classification.originalContent)
  );
}

function isAssistantQuestionPlan(value: unknown): value is RustAssistantQuestionPlan {
  if (!value || typeof value !== 'object') return false;
  const question = value as Partial<RustAssistantQuestionPlan>;
  return (
    isStringValue(question.prompt) &&
    Array.isArray(question.choices) &&
    question.choices.every(isAssistantChoicePlan) &&
    (question.selectionMode === 'single' || question.selectionMode === 'multiple') &&
    question.allowFreeText === true &&
    (question.source === 'answer' || question.source === 'reasoning-leak')
  );
}

function isAssistantChoicePlan(value: unknown): value is RustAssistantChoicePlan {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Partial<RustAssistantChoicePlan>;
  return isStringValue(choice.id) && isStringValue(choice.label);
}

function isRustReasoningChunk(value: unknown): value is RustReasoningChunk {
  if (!value || typeof value !== 'object') return false;
  const chunk = value as Partial<RustReasoningChunk>;
  return (
    isStringValue(chunk.content) &&
    (chunk.reasoning === undefined || isStringValue(chunk.reasoning))
  );
}

function isChatMessagePlan(value: unknown): value is RustChatMessagePlan {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<RustChatMessagePlan>;
  return (
    isStringValue(message.id) &&
    (message.schemaVersion === undefined ||
      (typeof message.schemaVersion === 'number' &&
        Number.isInteger(message.schemaVersion) &&
        message.schemaVersion >= 0)) &&
    (message.role === 'system' ||
      message.role === 'user' ||
      message.role === 'assistant' ||
      message.role === 'tool') &&
    isStringValue(message.content) &&
    typeof message.timestamp === 'number' &&
    Number.isFinite(message.timestamp) &&
    isStringValue(message.createdAt) &&
    isStringValue(message.updatedAt) &&
    (message.status === 'pending' ||
      message.status === 'streaming' ||
      message.status === 'complete' ||
      message.status === 'error') &&
    (message.providerKey === undefined || isStringValue(message.providerKey)) &&
    (message.providerLabel === undefined || isStringValue(message.providerLabel)) &&
    (message.model === undefined || isStringValue(message.model)) &&
    (message.errorMessage === undefined || isStringValue(message.errorMessage)) &&
    (message.reasoning === undefined || isStringValue(message.reasoning)) &&
    (message.toolCalls === undefined || Array.isArray(message.toolCalls)) &&
    (message.citations === undefined || Array.isArray(message.citations)) &&
    (message.sourceWarnings === undefined || Array.isArray(message.sourceWarnings)) &&
    (message.contextAttachments === undefined || Array.isArray(message.contextAttachments)) &&
    (message.assistantQuestion === undefined ||
      (typeof message.assistantQuestion === 'object' && message.assistantQuestion !== null)) &&
    (message.branchOf === undefined || isStringValue(message.branchOf)) &&
    (message.branchRoot === undefined || isStringValue(message.branchRoot)) &&
    (message.variantOf === undefined || isStringValue(message.variantOf)) &&
    (message.stopReason === undefined || isStringValue(message.stopReason)) &&
    (message.providerCapability === undefined ||
      (typeof message.providerCapability === 'object' && message.providerCapability !== null)) &&
    (message.turnStage === undefined || isStringValue(message.turnStage)) &&
    (message.toolRound === undefined ||
      (typeof message.toolRound === 'number' &&
        Number.isInteger(message.toolRound) &&
        message.toolRound >= 0)) &&
    (message.toolRoundLogs === undefined || Array.isArray(message.toolRoundLogs)) &&
    (message.contextBudgetSnapshot === undefined ||
      (typeof message.contextBudgetSnapshot === 'object' &&
        message.contextBudgetSnapshot !== null)) &&
    (message.dataBoundarySnapshot === undefined ||
      (typeof message.dataBoundarySnapshot === 'object' &&
        message.dataBoundarySnapshot !== null)) &&
    (message.errorKind === undefined || isStringValue(message.errorKind)) &&
    (message.actionHistory === undefined || Array.isArray(message.actionHistory))
  );
}

function isChatMetaPlan(value: unknown): value is RustChatMetaPlan {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Partial<RustChatMetaPlan>;
  return (
    isStringValue(meta.title) &&
    isStringValue(meta.created) &&
    typeof meta.messageCount === 'number' &&
    Number.isInteger(meta.messageCount) &&
    meta.messageCount >= 0 &&
    (meta.updated === undefined || isStringValue(meta.updated)) &&
    (meta.preview === undefined || isStringValue(meta.preview)) &&
    (meta.provider === undefined || isStringValue(meta.provider)) &&
    (meta.model === undefined || isStringValue(meta.model))
  );
}

function isChatSaveMetadataPlan(value: unknown): value is RustChatSaveMetadataPlan {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Partial<RustChatSaveMetadataPlan>;
  return (
    isStringValue(metadata.title) &&
    isStringValue(metadata.created) &&
    typeof metadata.sourceCount === 'number' &&
    Number.isInteger(metadata.sourceCount) &&
    metadata.sourceCount >= 0 &&
    (metadata.provider === undefined || isStringValue(metadata.provider)) &&
    (metadata.model === undefined || isStringValue(metadata.model)) &&
    (metadata.summary === undefined || isStringValue(metadata.summary))
  );
}

function isContextSourcePlan(value: unknown): value is RustContextSourcePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustContextSourcePlan>;
  return (
    Array.isArray(plan.citations) &&
    plan.citations.every(isContextCitationPlan) &&
    Array.isArray(plan.blocks) &&
    plan.blocks.every(isContextSourceBlockPlan) &&
    Array.isArray(plan.sourceIds) &&
    plan.sourceIds.every(isStringValue) &&
    typeof plan.rejectedCount === 'number' &&
    Number.isInteger(plan.rejectedCount) &&
    plan.rejectedCount >= 0
  );
}

function isContextBudgetAppendPlan(value: unknown): value is RustContextBudgetAppendPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustContextBudgetAppendPlan>;
  return (
    isStringValue(plan.text) &&
    isValidNonNegativeInteger(plan.remainingChars) &&
    typeof plan.complete === 'boolean' &&
    typeof plan.appended === 'boolean'
  );
}

function isChatContextMentionPlan(
  value: unknown,
  mentionCount: number,
): value is RustChatContextMentionPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustChatContextMentionPlan>;
  return (
    isBoundedIndexArray(plan.fileIndices, mentionCount) &&
    isBoundedIndexArray(plan.folderIndices, mentionCount) &&
    isBoundedIndexArray(plan.entityIndices, mentionCount) &&
    isBoundedIndexArray(plan.serverIndices, mentionCount) &&
    typeof plan.useAutoRag === 'boolean' &&
    isAutoRagReason(plan.autoRagReason)
  );
}

function isChatContextMentionType(value: string): boolean {
  return value === 'file' || value === 'folder' || value === 'entity' || value === 'server';
}

function isAutoRagReason(value: unknown): value is RustAutoRagReason {
  return (
    value === 'no-mentions' ||
    value === 'server-only' ||
    value === 'server-and-vault' ||
    value === 'vault-mention' ||
    value === 'implicit' ||
    value === 'disabled'
  );
}

function isContextCitationPlan(value: unknown): value is RustContextCitationPlan {
  if (!value || typeof value !== 'object') return false;
  const citation = value as Partial<RustContextCitationPlan>;
  return (
    isStringValue(citation.id) &&
    isStringValue(citation.filePath) &&
    (citation.heading === undefined || isStringValue(citation.heading)) &&
    (citation.line === undefined || isValidNonNegativeInteger(citation.line)) &&
    (citation.endLine === undefined || isValidNonNegativeInteger(citation.endLine)) &&
    (citation.score === undefined || Number.isFinite(citation.score)) &&
    (citation.vectorScore === undefined || Number.isFinite(citation.vectorScore)) &&
    (citation.bm25Score === undefined || Number.isFinite(citation.bm25Score)) &&
    isContextSourceStatus(citation.status) &&
    (citation.detail === undefined || isStringValue(citation.detail)) &&
    isStringValue(citation.preview) &&
    typeof citation.previewTruncated === 'boolean' &&
    (citation.selectionReason === undefined || isSourceSelectionReason(citation.selectionReason)) &&
    (citation.graphType === undefined || isContextGraphType(citation.graphType))
  );
}

function isContextSourceBlockPlan(value: unknown): value is RustContextSourceBlockPlan {
  if (!value || typeof value !== 'object') return false;
  const block = value as Partial<RustContextSourceBlockPlan>;
  return isStringValue(block.sourceId) && isStringValue(block.text);
}

function isContextGraphVerificationPlan(value: unknown): value is RustContextGraphVerificationPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustContextGraphVerificationPlan>;
  return (
    typeof plan.isGraphSource === 'boolean' &&
    (plan.verification === null ||
      plan.verification === undefined ||
      isContextSourceVerification(plan.verification))
  );
}

function isValidContextSourceInput(input: RustContextSourceInput): boolean {
  return (
    input !== null &&
    typeof input === 'object' &&
    isStringValue(input.filePath) &&
    (input.heading === undefined || isStringValue(input.heading)) &&
    (input.startLine === undefined || isValidNonNegativeInteger(input.startLine)) &&
    (input.endLine === undefined || isValidNonNegativeInteger(input.endLine)) &&
    isStringValue(input.text) &&
    (input.score === undefined || Number.isFinite(input.score)) &&
    (input.vectorScore === undefined || Number.isFinite(input.vectorScore)) &&
    (input.bm25Score === undefined || Number.isFinite(input.bm25Score)) &&
    (input.selectionReason === undefined || isSourceSelectionReason(input.selectionReason))
  );
}

function isContextSourceVerification(value: unknown): value is RustContextSourceVerification {
  if (!value || typeof value !== 'object') return false;
  const verification = value as Partial<RustContextSourceVerification>;
  return (
    isContextSourceStatus(verification.status) &&
    (verification.detail === undefined || isStringValue(verification.detail)) &&
    (verification.graphType === undefined || isContextGraphType(verification.graphType))
  );
}

function isContextSourceStatus(value: unknown): value is RustContextSourceStatus {
  return (
    value === 'candidate' ||
    value === 'verified' ||
    value === 'missing' ||
    value === 'stale' ||
    value === 'low-relevance'
  );
}

function isContextGraphType(value: unknown): value is RustContextGraphType {
  return value === 'entity' || value === 'relation' || value === 'community';
}

function isVaultLinkCandidatePlan(value: unknown): value is RustVaultLinkCandidatePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustVaultLinkCandidatePlan>;
  return (
    Array.isArray(plan.candidates) &&
    plan.candidates.every(isStringValue) &&
    isStringValue(plan.fallbackBasename)
  );
}

function isFolderMentionFilePlan(
  value: unknown,
  maxExclusive: number,
): value is RustFolderMentionFilePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<RustFolderMentionFilePlan>;
  return (
    isBoundedIndexArray(plan.indices, maxExclusive) &&
    typeof plan.partial === 'boolean' &&
    isValidNonNegativeInteger(plan.matchedCount) &&
    isFolderLimitReason(plan.limitReason)
  );
}

function isFolderLimitReason(value: unknown): value is RustFolderLimitReason {
  return value === 'complete' || value === 'max-files';
}

function isValidStructuralLinkEdge(edge: RustStructuralLinkEdge): boolean {
  return (
    typeof edge.sourcePath === 'string' &&
    edge.sourcePath.length > 0 &&
    typeof edge.targetPath === 'string' &&
    edge.targetPath.length > 0
  );
}

function isValidStructuralHeadingSeed(seed: RustStructuralHeadingSeed): boolean {
  return (
    isStringValue(seed.id) &&
    seed.id.length > 0 &&
    isStringValue(seed.filePath) &&
    seed.filePath.length > 0 &&
    isValidNonNegativeInteger(seed.startLine) &&
    isValidNonNegativeInteger(seed.endLine) &&
    (seed.heading === undefined || isStringValue(seed.heading))
  );
}

function isValidStructuralEntryInput(entry: RustStructuralEntryInput): boolean {
  return (
    isStringValue(entry.id) &&
    entry.id.length > 0 &&
    isStringValue(entry.filePath) &&
    entry.filePath.length > 0 &&
    isValidNonNegativeInteger(entry.startLine) &&
    (entry.heading === undefined || isStringValue(entry.heading)) &&
    typeof entry.compatible === 'boolean'
  );
}

function isValidStructuralHeadingInput(heading: RustStructuralHeadingInput): boolean {
  return (
    isStringValue(heading.filePath) &&
    heading.filePath.length > 0 &&
    isValidNonNegativeInteger(heading.startLine) &&
    isValidNonNegativeInteger(heading.level)
  );
}

function isRustExtractedGraphPayloadResult(
  value: unknown,
): value is RustExtractedGraphPayloadResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustExtractedGraphPayloadResult>;
  const rawFactCount = result.rawFactCount;
  return (
    !!result.payload &&
    typeof result.payload === 'object' &&
    Array.isArray(result.payload.entities) &&
    Array.isArray(result.payload.relations) &&
    Array.isArray(result.payload.claims) &&
    result.payload.entities.every(isRustExtractedGraphEntity) &&
    result.payload.relations.every(isRustExtractedGraphRelation) &&
    result.payload.claims.every(isRustExtractedGraphClaim) &&
    typeof rawFactCount === 'number' &&
    Number.isSafeInteger(rawFactCount) &&
    rawFactCount >= 0
  );
}

function isRustMcpJsonValidationResult(value: unknown): value is RustMcpJsonValidationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustMcpJsonValidationResult>;
  if (typeof result.valid !== 'boolean') return false;

  if (result.valid) {
    return result.data !== undefined && typeof result.data === 'object' && result.data !== null;
  }

  if (!isStringValue(result.errorCode)) return false;
  return (
    (result.serverName === undefined || isStringValue(result.serverName)) &&
    (result.message === undefined || isStringValue(result.message))
  );
}

function isRustExtractedGraphPayloadParseResult(
  value: unknown,
): value is RustExtractedGraphPayloadParseResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustExtractedGraphPayloadParseResult>;
  if (result.ok === true) {
    return !!result.payload && isRustExtractedGraphPayload(result.payload);
  }
  if (result.ok === false) {
    return (
      (result.reason === 'invalid-json' || result.reason === 'schema-shape-mismatch') &&
      Object.prototype.hasOwnProperty.call(result, 'rawFact')
    );
  }
  return false;
}

function isRustExtractedGraphPayload(value: unknown): value is RustExtractedGraphPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<RustExtractedGraphPayload>;
  return (
    Array.isArray(payload.entities) &&
    Array.isArray(payload.relations) &&
    Array.isArray(payload.claims) &&
    payload.entities.every(isRustExtractedGraphEntity) &&
    payload.relations.every(isRustExtractedGraphRelation) &&
    payload.claims.every(isRustExtractedGraphClaim)
  );
}

function isRustMcpToolNormalizedResult(value: unknown): value is RustMcpToolNormalizedResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustMcpToolNormalizedResult>;
  return isStringValue(result.displayText) && isStringValue(result.modelText);
}

function isRustMcpToolErrorInfo(value: unknown): value is RustMcpToolErrorInfo {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RustMcpToolErrorInfo>;
  return (
    isRustMcpToolErrorKind(result.kind) &&
    (result.pattern === undefined || isStringValue(result.pattern)) &&
    (result.field === undefined || isStringValue(result.field)) &&
    (result.message === undefined || isStringValue(result.message))
  );
}

function isRustMcpToolErrorKind(value: unknown): value is RustMcpToolErrorKind {
  return (
    value === 'validation-pattern' ||
    value === 'validation-field' ||
    value === 'validation-required' ||
    value === 'validation-generic' ||
    value === 'validation-schema-failed' ||
    value === 'raw'
  );
}

function isRustExtractedGraphEntity(value: unknown): value is RustExtractedGraphEntity {
  if (!value || typeof value !== 'object') return false;
  const entity = value as Partial<RustExtractedGraphEntity>;
  return (
    isStringValue(entity.name) &&
    isStringValue(entity.typeId) &&
    (entity.description === undefined || isStringValue(entity.description)) &&
    (entity.aliases === undefined ||
      (Array.isArray(entity.aliases) && entity.aliases.every(isStringValue))) &&
    (entity.confidence === undefined || Number.isFinite(entity.confidence)) &&
    isOptionalGraphSourceSpans(entity.evidenceSpans)
  );
}

function isRustExtractedGraphRelation(value: unknown): value is RustExtractedGraphRelation {
  if (!value || typeof value !== 'object') return false;
  const relation = value as Partial<RustExtractedGraphRelation>;
  return (
    (relation.id === undefined || isStringValue(relation.id)) &&
    isStringValue(relation.source) &&
    isStringValue(relation.target) &&
    isStringValue(relation.relationTypeId) &&
    (relation.description === undefined || isStringValue(relation.description)) &&
    (relation.confidence === undefined || Number.isFinite(relation.confidence)) &&
    isOptionalGraphSourceSpans(relation.evidenceSpans)
  );
}

function isRustExtractedGraphClaim(value: unknown): value is RustExtractedGraphClaim {
  if (!value || typeof value !== 'object') return false;
  const claim = value as Partial<RustExtractedGraphClaim>;
  return (
    (claim.id === undefined || isStringValue(claim.id)) &&
    isStringValue(claim.text) &&
    isStringValue(claim.claimTypeId) &&
    (claim.entityNames === undefined ||
      (Array.isArray(claim.entityNames) && claim.entityNames.every(isStringValue))) &&
    (claim.relationRefs === undefined ||
      (Array.isArray(claim.relationRefs) && claim.relationRefs.every(isStringValue))) &&
    (claim.stance === undefined ||
      claim.stance === 'supports' ||
      claim.stance === 'opposes' ||
      claim.stance === 'neutral' ||
      claim.stance === 'interprets') &&
    (claim.confidence === undefined || Number.isFinite(claim.confidence)) &&
    isOptionalGraphSourceSpans(claim.evidenceSpans)
  );
}

function isOptionalGraphSourceSpans(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (span) =>
          typeof span === 'object' &&
          span !== null &&
          isValidNonNegativeInteger((span as Partial<RustGraphSourceSpan>).start) &&
          isValidNonNegativeInteger((span as Partial<RustGraphSourceSpan>).end),
      ))
  );
}

function isValidRelevantResultCandidate(candidate: RustRelevantResultCandidate): boolean {
  return (
    Number.isFinite(candidate.score) &&
    Number.isFinite(candidate.vectorScore) &&
    Number.isFinite(candidate.bm25Score) &&
    Number.isFinite(candidate.keywordMatches) &&
    Number.isFinite(candidate.sourceEvidenceScore) &&
    (candidate.bestEvidenceRank === undefined || Number.isFinite(candidate.bestEvidenceRank)) &&
    candidate.retrievalSources.every(isStringValue)
  );
}

function isValidRetrievalCandidateMergeInput(input: RustRetrievalCandidateMergeInput): boolean {
  return (
    isValidUint32(input.entryIndex) &&
    sourceToCode(input.source) !== 0 &&
    (input.sourceScore === undefined || Number.isFinite(input.sourceScore)) &&
    (input.rank === undefined || Number.isFinite(input.rank))
  );
}

function isValidRetrievalCandidateMergeByEntryIdInput(
  input: RustRetrievalCandidateMergeByEntryIdInput,
): boolean {
  return (
    isStringValue(input.entryId) &&
    sourceToCode(input.source) !== 0 &&
    (input.sourceScore === undefined || Number.isFinite(input.sourceScore)) &&
    (input.rank === undefined || Number.isFinite(input.rank))
  );
}

function isValidBm25Hit(hit: RustBm25Hit): boolean {
  return (
    typeof hit.docId === 'string' &&
    hit.docId.length > 0 &&
    typeof hit.sourcePath === 'string' &&
    hit.sourcePath.length > 0 &&
    Number.isFinite(hit.score)
  );
}

function isValidBm25EntryInput(entry: RustBm25EntryInput): boolean {
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.filePath === 'string' &&
    entry.filePath.length > 0 &&
    typeof entry.compatible === 'boolean'
  );
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
  if (source === 'vector') return 2;
  if (source === 'graph-local') return 3;
  if (source === 'structural') return 4;
  if (source === 'ann') return 5;
  if (source === 'graph-global') return 6;
  if (source === 'evidence') return 7;
  return 0;
}

function sourceCodeToSource(sourceCode: number): string | null {
  if (sourceCode === 1) return 'bm25';
  if (sourceCode === 2) return 'vector';
  if (sourceCode === 3) return 'graph-local';
  if (sourceCode === 4) return 'structural';
  if (sourceCode === 5) return 'ann';
  if (sourceCode === 6) return 'graph-global';
  if (sourceCode === 7) return 'evidence';
  return null;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isValidNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
