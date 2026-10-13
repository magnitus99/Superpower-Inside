import type {
  ArtifactRecord,
  RetiredArtifactContext,
  RetiredArtifactPlan,
} from '../storage/retired-artifacts';
import type { GeneratedArtifactRecord } from '../storage/generated-artifacts';
import {
  update_generated_artifact_registry_json,
  plan_retired_artifacts_json,
  plan_session_title_json,
  plan_plugin_aware_indices_json,
  select_plugin_context7_library_id,
  plan_native_vault_source_citation_indices_json,
  plan_source_metadata_json,
  is_scoped_vault_research_intent,
  plan_model_context_json,
  plan_provider_model_details_json,
  embedding_gemma_inputs_json,
  local_model_range_matches,
  plan_chatgpt_json,
  plan_chat_evidence_json,
  plan_chat_request_json,
  plan_tool_result_summary_json,
  plan_vault_query_expansion_json,
  plan_chat_unique_result_indices_json,
  plan_source_chunks_json,
  plan_source_chunk_import_indices_json,
  extract_source_text_json,
  is_extractable_source_extension,
  plan_source_processing_json,
  find_reusable_prompt,
  is_local_settings_provider,
  is_valid_settings_folder,
  parse_settings_number,
  Bm25RuntimeIndex,
  chunk_markdown_json,
  collect_candidate_reasons as collect_candidate_reasons_json,
  chunk_plain_text_json,
  source_revision_matches,
  count_keyword_matches,
  create_context_preview,
  cosine_similarity_or_nan,
  create_content_hash,
  create_indexed_db_record_key,
  extract_structured_reasoning,
  extract_vault_links_json,
  initSync,
  IvfRuntimeIndex,
  is_protected_rag_document_extension_json,
  count_files_by_extensions_json,
  is_excluded_path,
  is_excluded_ext_json,
  is_rag_frontmatter_excluded_json,
  is_recommendable_exclude_extension_json,
  is_mcp_tool_name_available,
  is_whole_vault_research_intent,
  parse_mcp_tool_arguments_json,
  normalize_mcp_tool_result_json,
  is_mcp_tool_result_empty_json,
  classify_mcp_tool_error_json,
  normalize_exclude_extension_json,
  normalize_reasoning_chunk_json,
  normalize_vault_link_target_json,
  parse_mention_candidates_json,
  plan_tag_mentions_json,
  plan_agentic_tool_turn_json,
  plan_folder_lexical_evidence_indices_json,
  plan_implicit_folder_query_paths_json,
  plan_assistant_response_classification_json,
  split_reasoning_tags_json,
  strip_compatibility_tool_calls,
  plan_chat_context_mentions_json,
  plan_compatibility_tool_calls_json,
  plan_mcp_server_candidates_json,
  plan_native_vault_lexical_hit_json,
  plan_native_vault_lexical_batch_json,
  plan_native_vault_filtered_indices_json,
  plan_native_vault_link_paths_json,
  plan_native_vault_list_json,
  plan_native_vault_read_range_json,
  plan_native_vault_search_rrf_json,
  plan_native_vault_stats_json,
  plan_native_tool_compatibility_fallback_json,
  plan_native_vault_tool_request_json,
  plan_bm25_candidate_resolution_json,
  plan_bm25_hit_lookup_json,
  plan_bm25_source_lookups_json,
  plan_chat_meta_json,
  plan_chat_messages_json,
  plan_chat_save_metadata_json,
  plan_context_budget_append_json,
  plan_context_sources_json,
  plan_diverse_result_indices_json,
  plan_index_pending_files_json,
  plan_evidence_candidate_order_json,
  plan_empty_file_index_record_json,
  plan_file_index_records_json,
  plan_indexed_db_bounded_cleanup_json,
  plan_indexed_db_bounded_retention_json,
  plan_indexed_db_storage_layout_json,
  plan_inactive_indexed_db_cleanup_json,
  plan_plugin_owned_file_maintenance_json,
  plan_stale_index_source_paths_json,
  plan_folder_mention_file_indices_json,
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
  plan_provider_profile_state_json,
  plan_provider_verification_reset_json,
  plan_chat_model_state_json,
  plan_rag_status_json,
  plan_reference_file_indices_json,
  plan_rerank_messages_json,
  plan_rerank_response_json,
  plan_rerank_result_order_json,
  plan_research_summary_batches_json,
  plan_tool_result_source_references_json,
  plan_research_citation_indices_json,
  plan_research_request_failure_json,
  plan_research_candidate_selection_json,
  plan_research_provider_ledger_transition_json,
  plan_research_provider_request_budget_json,
  derive_native_tool_coverage_receipt_json,
  derive_research_coverage_receipt_json,
  plan_research_answer_contract_json,
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
  format_mcp_connection_error,
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
  rank_top_k_pairs,
  recall_at_k,
  select_relevant_result_indices,
  tokenize_json,
  VectorRuntimeIndex,
} from '../../generated/rag-wasm/rag_wasm.js';
import type { Chunk } from './indexer';
import type { SourceProcessingInput, SourceProcessingSummary } from './source-processing';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

const RUST_RECALL_UNKNOWN_INDEX = 0xffffffff;

export interface RustVectorScore {
  index: number;
  score: number;
}

export interface RustNativeVaultFilters {
  modifiedAfter?: number;
  modifiedBefore?: number;
  tags?: string[];
  properties?: Record<string, string | number | boolean>;
}

export interface RustNativeVaultLexicalCandidate {
  passages?: SourcePassage[];
  metadata?: SourceDocumentMetadata;
  path: string;
  score: number;
  startLine: number;
  endLine: number;
  preview: string;
}

export interface SourcePassage {
  startLine: number;
  endLine: number;
  content: string;
}

export function planNativeVaultSourceCitationIndicesRust(
  hits: readonly unknown[],
  citations: readonly unknown[],
): number[] | null {
  if (!ensureRustCore()) return null;
  try {
    return JSON.parse(
      plan_native_vault_source_citation_indices_json(
        JSON.stringify(hits),
        JSON.stringify(citations),
      ),
    ) as number[];
  } catch {
    return null;
  }
}
export interface SourceDocumentMetadata {
  evidence: SourcePassage[];
  entries: Array<{
    field: string;
    value: string;
    line: number;
    origin: 'header' | 'body' | 'byline';
    status: 'known' | 'unknown';
  }>;
  dateStatus: 'known' | 'unknown' | 'conflict';
  header: SourcePassage | null;
}
export function planSourceMetadataRust(content: string): SourceDocumentMetadata | null {
  if (!ensureRustCore()) return null;
  try {
    return JSON.parse(plan_source_metadata_json(content)) as SourceDocumentMetadata;
  } catch {
    return null;
  }
}

export interface RustNativeVaultLexicalState {
  streams: RustNativeVaultLexicalCandidate[][];
  totalHits: number;
  scannedFiles: number;
  unreadableFiles: number;
}

export type RustNativeVaultToolRequest =
  | {
      action: 'search';
      query: string;
      queries?: string[];
      path: string;
      limit: number;
      match: 'all' | 'any' | 'phrase';
      mode?: 'auto' | 'exact' | 'word';
      field?: 'both' | 'content' | 'path';
      filters?: RustNativeVaultFilters;
    }
  | {
      action: 'read';
      path: string;
      startLine: number;
      startOffset?: number;
      endLine: number | null;
    }
  | {
      action: 'related';
      path: string;
      startLine: number;
      endLine: number | null;
      limit: number;
    }
  | {
      action: 'list';
      path: string;
      cursor: number;
      limit: number;
      filters?: RustNativeVaultFilters;
    }
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

export interface RustNativeVaultLexicalHitPlan {
  startLine: number;
  endLine: number;
  preview: string;
  status: 'candidate' | 'verified';
}

export interface RustToolResultSourceReference {
  filePath: string;
  status: 'candidate' | 'verified';
  requiresRead: true;
  line?: number;
  endLine?: number;
}

export interface RustNativeVaultStatsPlan {
  fileCount: number;
  totalBytes: number;
}

export interface RustNativeVaultSearchRrfCandidateInput {
  entryId: string;
  queryIndex: number;
  rank: number;
}

export interface RustNativeVaultSearchRrfHitPlan {
  candidateIndexes: number[];
  representativeCandidateIndex: number;
  matchedQueryIndices: number[];
  rrfScore: number;
}

export interface RustNativeVaultSearchRrfPlan {
  hits: RustNativeVaultSearchRrfHitPlan[];
  totalEntries: number;
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
  hasStructuralEvidence: boolean;
  hasStrongStructuralEvidence: boolean;
  combinedScore: number;
  selectionReason: RustSourceSelectionReason;
}

export type RustSourceSelectionReason =
  | 'strong-structural-evidence'
  | 'structural-evidence'
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

export interface RustRelevantResultCandidate {
  score: number;
  vectorScore: number;
  bm25Score: number;
  keywordMatches: number;
  retrievalSources: readonly string[];
  sourceEvidenceScore: number;
  bestEvidenceRank?: number;
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

export interface RustEvidenceScore {
  evidenceId: string;
  score: number;
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
    corpus: string;
  };
  cleanupLegacyNames: string[];
  legacyNames: string[];
}

export interface RustSourceRevision {
  filePath: string;
  sourceMtime: number;
  sourceSize: number;
  contentHash: string;
}

export function isSourceRevisionCurrentRust(
  expected: RustSourceRevision,
  current: RustSourceRevision,
): boolean {
  if (!ensureRustCore()) return false;
  return source_revision_matches(
    expected.filePath,
    current.filePath,
    expected.contentHash,
    current.contentHash,
    new Float64Array([
      expected.sourceMtime,
      current.sourceMtime,
      expected.sourceSize,
      current.sourceSize,
    ]),
  );
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

export type RustProviderProfileTone =
  | 'ready'
  | 'configured'
  | 'needs-key'
  | 'needs-url'
  | 'needs-models'
  | 'failed'
  | 'disabled';

export interface RustProviderModelStateInput {
  value: string;
  label: string;
  kind: 'general' | 'embedding';
  verificationStatus: 'success' | 'failed' | 'unknown';
}

export interface RustProviderStateInput {
  strategy: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrlConfigured: boolean;
  models: RustProviderModelStateInput[];
}

export interface RustProviderProfileStatePlan {
  tone: RustProviderProfileTone;
  chatSupported: boolean;
  embeddingSupported: boolean;
  chatUsable: boolean;
  embeddingUsable: boolean;
  chatModelValues: string[];
  embeddingModelValues: string[];
}

export interface RustProviderVerificationState {
  chatStatus: 'success' | 'failed' | 'unknown';
  embeddingStatus: 'success' | 'failed' | 'unknown';
}

export interface RustProviderVerificationReset {
  chatStatus: 'unknown';
  embeddingStatus: 'unknown';
}

export interface RustChatModelStatePlan {
  options: Array<{ value: string; label: string }>;
  selectedModel: string;
  enabledProviderCount: number;
  availableModelCount: number;
}

export interface RustRagFileEligibilityInput {
  filePath: string;
  fileName: string;
  extension: string;
  size: number;
  frontmatter?: unknown;
  frontmatterUnreadable?: boolean;
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
  errorRetryAt?: string;
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

export interface RustChatEvidencePlan extends RustContextSourcePlan {
  complete: boolean;
  actualChars: number;
}

export interface RustChatRequestPlan {
  indices: number[];
  usedBytes: number;
  summary?: string;
}

export interface ModelContextBudget {
  maxInputTokens?: number;
  sharedContextTokens?: number;
  outputSource?: 'provider' | 'fallback';
  nativeOutput?: boolean;
  contextTokens: number;
  outputTokens: number;
  marginTokens: number;
  inputBytes: number;
  evidenceChars: number;
  researchFileChars: number;
  researchProviderBudget: { maxSelectedItems: number; batchSize: number; maxBatches: number };
  source: 'provider' | 'fallback';
  counting: 'utf8-upper-bound';
}

export function isScopedVaultResearchIntentRust(question: string): boolean | null {
  if (!ensureRustCore()) return null;
  try {
    return is_scoped_vault_research_intent(question);
  } catch {
    return null;
  }
}

export function planModelContextRust(metadata: unknown): ModelContextBudget | null {
  if (!ensureRustCore()) return null;
  try {
    return JSON.parse(plan_model_context_json(JSON.stringify(metadata))) as ModelContextBudget;
  } catch {
    return null;
  }
}

export function planProviderModelDetailsRust(
  provider: string,
  payload: unknown,
): Array<{
  id: string;
  name?: string;
  contextLength?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}> | null {
  if (!ensureRustCore()) return null;
  try {
    return JSON.parse(
      plan_provider_model_details_json(provider, JSON.stringify(payload)),
    ) as Array<{
      id: string;
      name?: string;
      contextLength?: number;
      maxInputTokens?: number;
      maxOutputTokens?: number;
    }>;
  } catch {
    return null;
  }
}

export function planChatUniqueResultIndicesRust(
  sources: readonly RustContextSourceInput[],
  citations: readonly unknown[],
): number[] | null {
  if (!ensureRustCore()) return null;
  try {
    const indices: unknown = JSON.parse(
      plan_chat_unique_result_indices_json(JSON.stringify(sources), JSON.stringify(citations)),
    );
    return Array.isArray(indices) &&
      indices.every((index) => isValidNonNegativeInteger(index) && index < sources.length)
      ? indices
      : null;
  } catch {
    return null;
  }
}

export function planToolResultSummaryRust(
  content: string,
  question: string,
  maxBytes: number,
): string | null {
  if (!ensureRustCore()) return null;
  try {
    return plan_tool_result_summary_json(content, question, maxBytes) || null;
  } catch {
    return null;
  }
}

export function planVaultQueryExpansionRust(
  question: string,
  response = '',
): { needsTranslation: boolean; query: string; variants: string[] } | null {
  if (!ensureRustCore()) return null;
  try {
    const plan: unknown = JSON.parse(plan_vault_query_expansion_json(question, response));
    if (
      !isStringRecordValueMap(plan) ||
      typeof plan.needsTranslation !== 'boolean' ||
      typeof plan.query !== 'string'
    )
      return null;
    return {
      needsTranslation: plan.needsTranslation,
      query: plan.query,
      variants: plan.variants as string[],
    };
  } catch {
    return null;
  }
}

/** 원문 구간 선택과 전송 예산 계산은 Rust의 결정적 계약을 사용합니다. */
export function planChatEvidenceRust(input: {
  question: string;
  source: RustContextSourceInput;
  sourceId: string;
  label: string;
  maxChars: number;
  remainingSources?: number;
  nativeSourceIds?: boolean;
}): RustChatEvidencePlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_chat_evidence_json(JSON.stringify(input)));
    if (!isContextSourcePlan(parsed)) return null;
    const plan = parsed as RustContextSourcePlan & Partial<RustChatEvidencePlan>;
    return typeof plan.complete === 'boolean' && isValidNonNegativeInteger(plan.actualChars)
      ? { ...parsed, complete: plan.complete, actualChars: plan.actualChars }
      : null;
  } catch {
    return null;
  }
}

/** 완전한 턴을 선택하며 시스템 지침과 최신 요청은 잘라내지 않습니다. */
export function planChatRequestRust(input: {
  messages: readonly unknown[];
  reservedBytes: number;
  maxBytes: number;
}): RustChatRequestPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_chat_request_json(JSON.stringify(input)));
    if (!parsed || typeof parsed !== 'object') return null;
    const plan = parsed as Partial<RustChatRequestPlan>;
    return Array.isArray(plan.indices) &&
      plan.indices.every(
        (index) => isValidNonNegativeInteger(index) && index < input.messages.length,
      ) &&
      isValidNonNegativeInteger(plan.usedBytes) &&
      (plan.summary === undefined || typeof plan.summary === 'string') &&
      plan.usedBytes <= input.maxBytes
      ? {
          indices: plan.indices,
          usedBytes: plan.usedBytes,
          ...(plan.summary === undefined ? {} : { summary: plan.summary }),
        }
      : null;
  } catch {
    return null;
  }
}

export interface RustChatContextMentionPlan {
  fileIndices: number[];
  folderIndices: number[];
  tagIndices: number[];
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

export interface RustMentionedEntityInput {
  canonicalName: string;
  aliases: readonly string[];
}

export interface RustMentionCandidate {
  raw: string;
  name: string;
  workspace?: 'current' | 'tabs';
  tag?: string;
  /** Obsidian `[[...]]` 링크 후보는 host가 실제 경로를 해석합니다. */
  link?: true;
}

export interface RustTagMentionPlan {
  tags: string[];
  fileIndices: number[];
  matchedCount: number;
}

export function planTagMentionsRust(
  fileTags: readonly (readonly string[])[],
  query: string,
  maxFiles = fileTags.length,
): RustTagMentionPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_tag_mentions_json(
        JSON.stringify(fileTags),
        query,
        normalizeNonNegativeInteger(maxFiles),
      ),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const plan = parsed as Partial<RustTagMentionPlan>;
    if (
      !Array.isArray(plan.tags) ||
      !plan.tags.every(isStringValue) ||
      !isBoundedIndexArray(plan.fileIndices, fileTags.length) ||
      !Number.isInteger(plan.matchedCount) ||
      typeof plan.matchedCount !== 'number' ||
      plan.matchedCount < plan.fileIndices.length ||
      plan.matchedCount > fileTags.length
    )
      return null;
    return plan as RustTagMentionPlan;
  } catch {
    return null;
  }
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

let initialized = false;
let unavailable = false;

export type RustMcpConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'partial-error'
  | 'error';

export function parseSettingsNumberRust(
  input: string,
  min: number,
  max: number,
  integer = true,
): number | null {
  if (!ensureRustCore()) return null;
  const value = parse_settings_number(input, min, max, integer);
  return Number.isFinite(value) ? value : null;
}

export function findReusablePromptRust(
  entries: readonly { content: string }[],
  content: string,
): number | null {
  if (!ensureRustCore()) return null;
  const index = find_reusable_prompt(JSON.stringify(entries), content);
  return index;
}

export function isLocalSettingsProviderRust(strategy: string, baseUrl = ''): boolean | null {
  if (!ensureRustCore()) return null;
  return is_local_settings_provider(strategy, baseUrl);
}

export function isValidSettingsFolderRust(input: string): boolean | null {
  if (!ensureRustCore()) return null;
  return is_valid_settings_folder(input);
}

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

export function shouldAppendMcpPathHintRust(command: string, errorMessage: string): boolean | null {
  if (!ensureRustCore()) return null;
  return should_append_mcp_path_hint_rust(command, errorMessage);
}

export function formatMcpConnectionErrorRust(
  message: string,
  stderr: string,
  env: Record<string, string> | undefined,
): string | null {
  if (!ensureRustCore()) return null;
  try {
    return (
      format_mcp_connection_error(message, stderr, JSON.stringify(Object.values(env ?? {}))) || null
    );
  } catch {
    return null;
  }
}

export function createContentHashRust(content: string): string | null {
  if (!ensureRustCore()) return null;
  return create_content_hash(content);
}

export function embeddingGemmaInputsRust(
  texts: string[],
  kind: 'query' | 'document',
): string[] | null {
  if (!ensureRustCore()) return null;
  const result = embedding_gemma_inputs_json(JSON.stringify(texts), kind);
  if (!result) return null;
  const parsed: unknown = JSON.parse(result);
  return Array.isArray(parsed) && parsed.every((text): text is string => typeof text === 'string')
    ? parsed
    : null;
}

export function localModelRangeMatchesRust(
  start: number,
  end: number,
  total: number,
  status: number,
  length: number,
  contentRange: string,
): boolean {
  return (
    ensureRustCore() && local_model_range_matches(start, end, total, status, length, contentRange)
  );
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
  indexNamespace = '',
): RustIndexedDbStorageLayout | null {
  if (
    ![pluginId, vaultIdentity, legacyVaultName, embeddingNamespace].every(
      (value) => isStringValue(value) && value.trim().length > 0,
    ) ||
    !isStringValue(indexNamespace) ||
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
      indexNamespace,
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

export function planRetiredArtifactsRust(
  context: RetiredArtifactContext,
  records: readonly ArtifactRecord[],
  approval?: { records: readonly ArtifactRecord[]; revision: number },
): RetiredArtifactPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_retired_artifacts_json(JSON.stringify({ context, records, approval })),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const plan = parsed as Partial<RetiredArtifactPlan>;
    if (
      !Number.isSafeInteger(plan.bytes) ||
      !Number.isSafeInteger(plan.revision) ||
      typeof plan.capacity !== 'string' ||
      typeof plan.changed !== 'boolean' ||
      !Array.isArray(plan.records)
    )
      return null;
    if (
      !plan.records.every((record: unknown) => {
        if (!record || typeof record !== 'object') return false;
        const item = record as Partial<ArtifactRecord>;
        return (
          (item.kind === 'file' || item.kind === 'database') &&
          typeof item.id === 'string' &&
          Number.isSafeInteger(item.bytes) &&
          typeof item.modified === 'number' &&
          Number.isFinite(item.modified) &&
          item.modified >= 0
        );
      })
    )
      return null;
    return { ...plan, hasArtifacts: plan.records.length > 0 } as RetiredArtifactPlan;
  } catch {
    return null;
  }
}

export function updateGeneratedArtifactRegistryRust(
  records: unknown,
  change: GeneratedArtifactRecord | undefined,
  roots: readonly string[],
  remove: boolean,
): GeneratedArtifactRecord[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      update_generated_artifact_registry_json(
        JSON.stringify(records),
        change ? JSON.stringify(change) : '',
        JSON.stringify(roots),
        remove,
      ),
    );
    if (
      !Array.isArray(parsed) ||
      !parsed.every((value: unknown) => {
        if (!value || typeof value !== 'object') return false;
        const record = value as Partial<GeneratedArtifactRecord>;
        return (
          (record.kind === 'file' || record.kind === 'database') &&
          typeof record.id === 'string' &&
          typeof record.featureId === 'string' &&
          typeof record.stamp === 'string' &&
          typeof record.formatVersion === 'number' &&
          Number.isFinite(record.formatVersion)
        );
      })
    )
      return null;
    return parsed as GeneratedArtifactRecord[];
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

export function planRagStatusFallback(input: RustRagStatusInput): RustRagStatusPlan {
  const recordByPath = new Map<string, RustRagStatusRecordInput>();
  for (const record of input.records) {
    recordByPath.set(record.filePath, record);
  }

  let healthyDocuments = 0;
  let missingDocuments = 0;
  let staleDocuments = 0;
  let unknownDocuments = 0;
  let totalVectors = 0;
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
        totalVectors += record?.vectorCount ?? 0;
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
    totalVectors,
    updateRequiredDocuments,
  };
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

/** ChatGPT 네트워크·저장 wire 결과를 Rust에서 검증하고 매핑한다. */
export function planChatGPTRust<T>(input: Record<string, unknown>): T | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_chatgpt_json(JSON.stringify(input));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function planProviderProfileStateRust(
  input: RustProviderStateInput,
): RustProviderProfileStatePlan | null {
  if (!isValidProviderStateInput(input) || !ensureRustCore()) return null;
  try {
    const raw = plan_provider_profile_state_json(JSON.stringify(input));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isProviderProfileStatePlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planProviderVerificationResetRust(
  models: readonly RustProviderVerificationState[],
): RustProviderVerificationReset[] | null {
  if (!models.every(isProviderVerificationState) || !ensureRustCore()) return null;
  try {
    const raw = plan_provider_verification_reset_json(JSON.stringify(models));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) &&
      parsed.length === models.length &&
      parsed.every(isProviderVerificationReset)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function planChatModelStateRust(
  providers: readonly RustProviderStateInput[],
  configuredDefault: string,
): RustChatModelStatePlan | null {
  if (
    !providers.every(isValidProviderStateInput) ||
    !isStringValue(configuredDefault) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const raw = plan_chat_model_state_json(JSON.stringify(providers), configuredDefault);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isChatModelStatePlan(parsed) ? parsed : null;
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

export function isRagFrontmatterExcludedRust(frontmatter: unknown): boolean | null {
  if (!ensureRustCore()) return null;
  try {
    return is_rag_frontmatter_excluded_json(JSON.stringify(frontmatter ?? null));
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

export function planSessionTitleRust(
  messages: readonly unknown[],
  generatedTitle = '',
): { conversation: import('../llm/providers').ChatMessage[]; title: string } | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_session_title_json(JSON.stringify(messages), generatedTitle),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const plan = parsed as { conversation?: unknown; title?: unknown };
    if (!Array.isArray(plan.conversation) || typeof plan.title !== 'string') return null;
    const conversation: unknown[] = plan.conversation;
    if (
      !conversation.every((message): message is import('../llm/providers').ChatMessage => {
        if (!message || typeof message !== 'object') return false;
        const item = message as { role?: unknown; content?: unknown };
        return (
          (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string'
        );
      })
    )
      return null;
    return { conversation, title: plan.title };
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

export function planNativeVaultFilteredIndicesRust(
  files: readonly {
    modifiedAt: number;
    tags: readonly string[];
    properties: Record<string, unknown>;
  }[],
  filters: RustNativeVaultFilters,
): number[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_native_vault_filtered_indices_json(JSON.stringify(files), JSON.stringify(filters)),
    );
    return Array.isArray(parsed) &&
      parsed.every((index: unknown) => isNonNegativeSafeInteger(index) && index < files.length)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function planNativeVaultLexicalBatchRust(
  request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  samples: readonly { path: string; content: string | null }[],
  previous: RustNativeVaultLexicalState | null,
): RustNativeVaultLexicalState | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_native_vault_lexical_batch_json(
        JSON.stringify(request),
        JSON.stringify(samples),
        JSON.stringify(previous),
      ),
    );
    if (
      !isStringRecordValueMap(parsed) ||
      !Array.isArray(parsed.streams) ||
      !isNonNegativeSafeInteger(parsed.totalHits) ||
      !isNonNegativeSafeInteger(parsed.scannedFiles) ||
      !isNonNegativeSafeInteger(parsed.unreadableFiles)
    )
      return null;
    const streams: RustNativeVaultLexicalCandidate[][] = [];
    for (const stream of parsed.streams) {
      if (
        !Array.isArray(stream) ||
        !stream.every(
          (candidate: unknown): candidate is RustNativeVaultLexicalCandidate =>
            isStringRecordValueMap(candidate) &&
            isStringValue(candidate.path) &&
            isStringValue(candidate.preview) &&
            isNonNegativeSafeInteger(candidate.score) &&
            isNonNegativeSafeInteger(candidate.startLine) &&
            candidate.startLine > 0 &&
            isNonNegativeSafeInteger(candidate.endLine) &&
            candidate.endLine >= candidate.startLine,
        )
      )
        return null;
      streams.push(stream);
    }
    return {
      streams,
      totalHits: parsed.totalHits,
      scannedFiles: parsed.scannedFiles,
      unreadableFiles: parsed.unreadableFiles,
    };
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

export function planNativeVaultSearchRrfRust(
  candidates: readonly RustNativeVaultSearchRrfCandidateInput[],
  queryCount: number,
  limit: number,
): RustNativeVaultSearchRrfPlan | null {
  if (
    !Number.isSafeInteger(queryCount) ||
    queryCount < 1 ||
    queryCount > 4 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    candidates.length > queryCount * 20 ||
    !candidates.every(
      (candidate) =>
        isStringValue(candidate.entryId) &&
        candidate.entryId.length > 0 &&
        Number.isSafeInteger(candidate.queryIndex) &&
        candidate.queryIndex >= 0 &&
        candidate.queryIndex < queryCount &&
        Number.isSafeInteger(candidate.rank) &&
        candidate.rank >= 1 &&
        candidate.rank <= 20,
    )
  ) {
    return null;
  }
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_native_vault_search_rrf_json(JSON.stringify(candidates), queryCount, limit);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isNativeVaultSearchRrfPlan(parsed, candidates.length, queryCount) ? parsed : null;
  } catch {
    return null;
  }
}

export interface RustResearchProviderBudgetInput {
  maxSelectedItems: number;
  batchSize: number;
  maxBatches: number;
}

export interface RustResearchCandidateSelectionInput {
  currentQuestion: string;
  previousUserQuestions: readonly string[];
  paths: readonly string[];
  samples: readonly string[];
  providerBudget?: RustResearchProviderBudgetInput;
}

export type RustResearchSelectionMode =
  | 'term-match'
  | 'bounded-inventory-sample'
  | 'empty-inventory';

export type RustResearchFacetKind = 'entity' | 'topic' | 'context';

export interface RustResearchFacet {
  kind: RustResearchFacetKind;
  terms: string[];
}

export interface RustResearchProviderBudgetPlan {
  maxSelectedItems: number;
  batchSize: number;
  maxBatches: number;
  maxTransferItems: number;
}

export interface RustResearchProviderRequestBudgetInput {
  providerBatchCount: number;
  providerBudget: RustResearchProviderBudgetPlan;
}

export interface RustResearchProviderRequestBudgetPlan {
  maxRequests: number;
  maxProviderAttempts: number;
  maxRetryWaitMs: number;
  maxMapRequests: number;
  maxReductionRequests: number;
  reservedFinalRequests: number;
  reservedRepairRequests: number;
}

export type RustResearchProviderLedgerReason = 'provider-attempt-limit' | 'retry-wait-limit';

export interface RustResearchProviderLedgerTransitionInput {
  maxProviderAttempts: number;
  maxRetryWaitMs: number;
  providerAttempts: number;
  retryWaitMs: number;
  remainingLogicalRequests: number;
  event: { kind: 'attempt'; retryDelayMs: 0 } | { kind: 'retry-wait'; retryDelayMs: number };
}

export interface RustResearchProviderLedgerTransitionPlan {
  allowed: boolean;
  providerAttempts: number;
  retryWaitMs: number;
  reason: RustResearchProviderLedgerReason | null;
}

export interface RustResearchCandidateSelectionPlan {
  inventoryCount: number;
  selectedIndices: number[];
  selectionMode: RustResearchSelectionMode;
  matchedCandidateCount: number;
  omittedCandidateCount: number;
  providerBatchCount: number;
  providerBudget: RustResearchProviderBudgetPlan;
  terms: string[];
  facets: RustResearchFacet[];
  planFingerprint: string;
}

export interface RustResearchInventorySnapshotInput {
  paths: readonly string[];
  total: number;
}

export interface RustResearchInventoryPageInput {
  cursor: number;
  paths: readonly string[];
  total: number;
  nextCursor: number | null;
}

export interface RustResearchLocalScreenInput {
  screenedIndices: readonly number[];
  selectedIndices: readonly number[];
  matchedCandidateCount: number;
  unreadableIndices: readonly number[];
  omittedIndices: readonly number[];
}

export interface RustResearchProviderTransferInput {
  transferredIndices: readonly number[];
  analyzedIndices: readonly number[];
  omittedIndices: readonly number[];
  failedIndices: readonly number[];
  omittedCandidateCount: number;
}

export interface RustResearchCoverageInput {
  inventory: RustResearchInventorySnapshotInput;
  pages: readonly RustResearchInventoryPageInput[];
  localScreen: RustResearchLocalScreenInput;
  providerTransfer: RustResearchProviderTransferInput;
}

export type RustResearchCoverageReasonCode =
  | 'invalid-inventory-path'
  | 'duplicate-inventory-path'
  | 'inventory-total-mismatch'
  | 'page-total-mismatch'
  | 'pagination-gap'
  | 'page-path-mismatch'
  | 'duplicate-page-path'
  | 'pagination-next-cursor-mismatch'
  | 'pagination-incomplete'
  | 'local-screen-incomplete'
  | 'local-screen-filtered'
  | 'local-selection-invalid'
  | 'local-screen-unreadable'
  | 'local-screen-omitted'
  | 'provider-transfer-mismatch'
  | 'provider-analysis-incomplete'
  | 'provider-budget-omitted'
  | 'provider-omitted'
  | 'provider-failed';

export interface RustResearchCoverageReceipt {
  inventoryCount: number;
  pagedCount: number;
  locallyScreenedCount: number;
  selectedEvidenceCount: number;
  providerTransferredCount: number;
  providerAnalyzedCount: number;
  providerOmittedCount: number;
  wholeVaultLocallyScreened: boolean;
  allSelectedEvidenceAnalyzed: boolean;
  allInventoryEvidenceAnalyzed: boolean;
  exactNegativeAllowed: boolean;
  reasonCodes: RustResearchCoverageReasonCode[];
  searchScopes?: RustResearchSearchScope[];
}

export interface RustResearchSearchScope {
  query: string;
  path: string;
  match: 'all' | 'any' | 'phrase';
  complete: boolean;
}

export type RustResearchAnswerViolationCode =
  | 'whole-read-claim-unverified'
  | 'broad-negative-claim'
  | 'exact-negative-coverage-incomplete';

export interface RustResearchAnswerContractInput {
  answer: string;
  language: 'ko' | 'en';
  receipt: RustResearchCoverageReceipt;
}

export interface RustResearchAnswerContractPlan {
  allowed: boolean;
  action: 'allow' | 'repair';
  violationCodes: RustResearchAnswerViolationCode[];
  safeCoverageText: string;
  safeAnswer?: string;
}

export function planResearchCandidateSelectionRust(
  input: RustResearchCandidateSelectionInput,
): RustResearchCandidateSelectionPlan | null {
  if (!isResearchCandidateSelectionInput(input) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_research_candidate_selection_json(JSON.stringify(input)),
    );
    return isResearchCandidateSelectionPlan(parsed, input.paths.length) ? parsed : null;
  } catch {
    return null;
  }
}

export function planResearchProviderRequestBudgetRust(
  input: RustResearchProviderRequestBudgetInput,
): RustResearchProviderRequestBudgetPlan | null {
  if (
    !isNonNegativeSafeInteger(input.providerBatchCount) ||
    !isResearchProviderBudgetPlan(input.providerBudget) ||
    input.providerBatchCount > input.providerBudget.maxBatches ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(
      plan_research_provider_request_budget_json(JSON.stringify(input)),
    );
    return isResearchProviderRequestBudgetPlan(parsed, input) ? parsed : null;
  } catch {
    return null;
  }
}

export function planResearchProviderLedgerTransitionRust(
  input: RustResearchProviderLedgerTransitionInput,
): RustResearchProviderLedgerTransitionPlan | null {
  if (!isResearchProviderLedgerTransitionInput(input) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_research_provider_ledger_transition_json(JSON.stringify(input)),
    );
    return isResearchProviderLedgerTransitionPlan(parsed, input) ? parsed : null;
  } catch {
    return null;
  }
}

export function deriveResearchCoverageReceiptRust(
  input: RustResearchCoverageInput,
): RustResearchCoverageReceipt | null {
  if (!isResearchCoverageInput(input) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      derive_research_coverage_receipt_json(JSON.stringify(input)),
    );
    return isResearchCoverageReceipt(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function deriveNativeToolCoverageReceiptRust(
  results: readonly string[],
): RustResearchCoverageReceipt | null {
  if (!results.every(isStringValue) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      derive_native_tool_coverage_receipt_json(JSON.stringify(results)),
    );
    return isResearchCoverageReceipt(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planResearchAnswerContractRust(
  input: RustResearchAnswerContractInput,
): RustResearchAnswerContractPlan | null {
  if (
    !isStringValue(input.answer) ||
    !isResearchAnswerLanguage(input.language) ||
    !isResearchCoverageReceipt(input.receipt) ||
    !ensureRustCore()
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(plan_research_answer_contract_json(JSON.stringify(input)));
    return isResearchAnswerContractPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isResearchAnswerLanguage(
  value: unknown,
): value is RustResearchAnswerContractInput['language'] {
  return value === 'ko' || value === 'en';
}

function isResearchCandidateSelectionInput(input: RustResearchCandidateSelectionInput): boolean {
  return (
    isStringValue(input.currentQuestion) &&
    input.previousUserQuestions.every(isStringValue) &&
    input.paths.every((path) => isStringValue(path) && path.trim().length > 0) &&
    input.samples.every(isStringValue) &&
    input.paths.length === input.samples.length &&
    (input.providerBudget === undefined || isResearchProviderBudget(input.providerBudget))
  );
}

function isResearchProviderBudget(value: unknown): value is RustResearchProviderBudgetInput {
  return (
    isStringRecordValueMap(value) &&
    isPositiveSafeInteger(value.maxSelectedItems) &&
    isPositiveSafeInteger(value.batchSize) &&
    isPositiveSafeInteger(value.maxBatches)
  );
}

function isResearchCandidateSelectionPlan(
  value: unknown,
  inventoryCount: number,
): value is RustResearchCandidateSelectionPlan {
  if (!isStringRecordValueMap(value) || !isResearchProviderBudgetPlan(value.providerBudget)) {
    return false;
  }
  const selectedIndices = value.selectedIndices;
  const terms = value.terms;
  const facets = value.facets;
  return (
    value.inventoryCount === inventoryCount &&
    isUniqueBoundedIndexArray(selectedIndices, inventoryCount) &&
    isResearchSelectionMode(value.selectionMode) &&
    isNonNegativeSafeInteger(value.matchedCandidateCount) &&
    isNonNegativeSafeInteger(value.omittedCandidateCount) &&
    value.matchedCandidateCount === selectedIndices.length + value.omittedCandidateCount &&
    selectedIndices.length <= value.providerBudget.maxTransferItems &&
    isNonNegativeSafeInteger(value.providerBatchCount) &&
    value.providerBatchCount <= value.providerBudget.maxBatches &&
    Array.isArray(terms) &&
    terms.every((term) => isStringValue(term) && term.length > 0) &&
    Array.isArray(facets) &&
    facets.every(isResearchFacet) &&
    isStringValue(value.planFingerprint) &&
    /^[0-9a-f]{8}$/u.test(value.planFingerprint)
  );
}

function isResearchProviderBudgetPlan(value: unknown): value is RustResearchProviderBudgetPlan {
  if (
    !isStringRecordValueMap(value) ||
    !isPositiveSafeInteger(value.maxSelectedItems) ||
    !isPositiveSafeInteger(value.batchSize) ||
    !isPositiveSafeInteger(value.maxBatches) ||
    !isNonNegativeSafeInteger(value.maxTransferItems)
  ) {
    return false;
  }
  const batchCapacity = value.batchSize * value.maxBatches;
  return (
    Number.isSafeInteger(batchCapacity) &&
    value.maxTransferItems <= value.maxSelectedItems &&
    value.maxTransferItems <= batchCapacity
  );
}

function isResearchProviderRequestBudgetPlan(
  value: unknown,
  input: RustResearchProviderRequestBudgetInput,
): value is RustResearchProviderRequestBudgetPlan {
  if (
    !isStringRecordValueMap(value) ||
    !isNonNegativeSafeInteger(value.maxRequests) ||
    !isNonNegativeSafeInteger(value.maxProviderAttempts) ||
    !isNonNegativeSafeInteger(value.maxRetryWaitMs) ||
    !isNonNegativeSafeInteger(value.maxMapRequests) ||
    !isNonNegativeSafeInteger(value.maxReductionRequests) ||
    !isPositiveSafeInteger(value.reservedFinalRequests) ||
    !isPositiveSafeInteger(value.reservedRepairRequests)
  ) {
    return false;
  }
  const plannedRequests =
    value.maxMapRequests +
    value.maxReductionRequests +
    value.reservedFinalRequests +
    value.reservedRepairRequests;
  return (
    Number.isSafeInteger(plannedRequests) &&
    value.maxRequests === plannedRequests &&
    value.maxProviderAttempts === value.maxRequests + 2 &&
    value.maxRetryWaitMs === 30_000 &&
    value.maxMapRequests === input.providerBatchCount &&
    value.maxMapRequests <= input.providerBudget.maxBatches &&
    value.maxReductionRequests <= value.maxMapRequests
  );
}

function isResearchProviderLedgerTransitionInput(
  value: unknown,
): value is RustResearchProviderLedgerTransitionInput {
  if (
    !isStringRecordValueMap(value) ||
    !isNonNegativeSafeInteger(value.maxProviderAttempts) ||
    !isNonNegativeSafeInteger(value.maxRetryWaitMs) ||
    !isNonNegativeSafeInteger(value.providerAttempts) ||
    !isNonNegativeSafeInteger(value.retryWaitMs) ||
    !isNonNegativeSafeInteger(value.remainingLogicalRequests) ||
    value.providerAttempts > value.maxProviderAttempts ||
    value.retryWaitMs > value.maxRetryWaitMs ||
    !isStringRecordValueMap(value.event) ||
    !isNonNegativeSafeInteger(value.event.retryDelayMs)
  ) {
    return false;
  }
  return (
    (value.event.kind === 'attempt' && value.event.retryDelayMs === 0) ||
    value.event.kind === 'retry-wait'
  );
}

function isResearchProviderLedgerTransitionPlan(
  value: unknown,
  input: RustResearchProviderLedgerTransitionInput,
): value is RustResearchProviderLedgerTransitionPlan {
  if (
    !isStringRecordValueMap(value) ||
    typeof value.allowed !== 'boolean' ||
    !isNonNegativeSafeInteger(value.providerAttempts) ||
    !isNonNegativeSafeInteger(value.retryWaitMs) ||
    !(
      value.reason === null ||
      value.reason === 'provider-attempt-limit' ||
      value.reason === 'retry-wait-limit'
    )
  ) {
    return false;
  }
  if (!value.allowed) {
    return (
      value.reason !== null &&
      value.providerAttempts === input.providerAttempts &&
      value.retryWaitMs === input.retryWaitMs
    );
  }
  if (value.reason !== null) return false;
  return input.event.kind === 'attempt'
    ? value.providerAttempts === input.providerAttempts + 1 &&
        value.retryWaitMs === input.retryWaitMs
    : value.providerAttempts === input.providerAttempts &&
        value.retryWaitMs === input.retryWaitMs + input.event.retryDelayMs;
}

function isResearchSelectionMode(value: unknown): value is RustResearchSelectionMode {
  return (
    value === 'term-match' || value === 'bounded-inventory-sample' || value === 'empty-inventory'
  );
}

function isResearchFacet(value: unknown): value is RustResearchFacet {
  return (
    isStringRecordValueMap(value) &&
    (value.kind === 'entity' || value.kind === 'topic' || value.kind === 'context') &&
    Array.isArray(value.terms) &&
    value.terms.every((term) => isStringValue(term) && term.length > 0)
  );
}

function isResearchCoverageInput(input: RustResearchCoverageInput): boolean {
  return (
    isResearchInventorySnapshotInput(input.inventory) &&
    input.pages.every(isResearchInventoryPageInput) &&
    isResearchLocalScreenInput(input.localScreen) &&
    isResearchProviderTransferInput(input.providerTransfer)
  );
}

function isResearchInventorySnapshotInput(
  value: unknown,
): value is RustResearchInventorySnapshotInput {
  return (
    isStringRecordValueMap(value) &&
    Array.isArray(value.paths) &&
    value.paths.every(isStringValue) &&
    isNonNegativeSafeInteger(value.total)
  );
}

function isResearchInventoryPageInput(value: unknown): value is RustResearchInventoryPageInput {
  return (
    isStringRecordValueMap(value) &&
    isNonNegativeSafeInteger(value.cursor) &&
    Array.isArray(value.paths) &&
    value.paths.every(isStringValue) &&
    isNonNegativeSafeInteger(value.total) &&
    (value.nextCursor === null || isNonNegativeSafeInteger(value.nextCursor))
  );
}

function isResearchLocalScreenInput(value: unknown): value is RustResearchLocalScreenInput {
  return (
    isStringRecordValueMap(value) &&
    isResearchIndexArray(value.screenedIndices) &&
    isResearchIndexArray(value.selectedIndices) &&
    isNonNegativeSafeInteger(value.matchedCandidateCount) &&
    isResearchIndexArray(value.unreadableIndices) &&
    isResearchIndexArray(value.omittedIndices)
  );
}

function isResearchProviderTransferInput(
  value: unknown,
): value is RustResearchProviderTransferInput {
  return (
    isStringRecordValueMap(value) &&
    isResearchIndexArray(value.transferredIndices) &&
    isResearchIndexArray(value.analyzedIndices) &&
    isResearchIndexArray(value.omittedIndices) &&
    isResearchIndexArray(value.failedIndices) &&
    isNonNegativeSafeInteger(value.omittedCandidateCount)
  );
}

function isResearchCoverageReceipt(value: unknown): value is RustResearchCoverageReceipt {
  if (!isStringRecordValueMap(value)) return false;
  const reasonCodes = value.reasonCodes;
  const searchScopes = value.searchScopes;
  if (
    typeof value.wholeVaultLocallyScreened !== 'boolean' ||
    typeof value.allSelectedEvidenceAnalyzed !== 'boolean' ||
    typeof value.allInventoryEvidenceAnalyzed !== 'boolean' ||
    typeof value.exactNegativeAllowed !== 'boolean'
  ) {
    return false;
  }
  if (
    searchScopes !== undefined &&
    (!Array.isArray(searchScopes) || !searchScopes.every(isResearchSearchScope))
  ) {
    return false;
  }
  const expectedExactNegative = Array.isArray(searchScopes)
    ? searchScopes.length > 0 &&
      searchScopes.every((scope) => scope.complete) &&
      value.allSelectedEvidenceAnalyzed
    : value.wholeVaultLocallyScreened && value.allSelectedEvidenceAnalyzed;
  const wholeVaultScopeValid =
    !Array.isArray(searchScopes) ||
    !value.wholeVaultLocallyScreened ||
    searchScopes.every((scope) => scope.path.length === 0);
  return (
    isNonNegativeSafeInteger(value.inventoryCount) &&
    isNonNegativeSafeInteger(value.pagedCount) &&
    isNonNegativeSafeInteger(value.locallyScreenedCount) &&
    isNonNegativeSafeInteger(value.selectedEvidenceCount) &&
    isNonNegativeSafeInteger(value.providerTransferredCount) &&
    isNonNegativeSafeInteger(value.providerAnalyzedCount) &&
    isNonNegativeSafeInteger(value.providerOmittedCount) &&
    value.exactNegativeAllowed === expectedExactNegative &&
    wholeVaultScopeValid &&
    (!value.allInventoryEvidenceAnalyzed || value.exactNegativeAllowed) &&
    Array.isArray(reasonCodes) &&
    reasonCodes.every(isResearchCoverageReasonCode) &&
    new Set(reasonCodes).size === reasonCodes.length
  );
}

function isResearchSearchScope(value: unknown): value is RustResearchSearchScope {
  return (
    isStringRecordValueMap(value) &&
    isStringValue(value.query) &&
    value.query.trim().length > 0 &&
    isStringValue(value.path) &&
    (value.match === 'all' || value.match === 'any' || value.match === 'phrase') &&
    typeof value.complete === 'boolean'
  );
}

function isResearchCoverageReasonCode(value: unknown): value is RustResearchCoverageReasonCode {
  return (
    value === 'invalid-inventory-path' ||
    value === 'duplicate-inventory-path' ||
    value === 'inventory-total-mismatch' ||
    value === 'page-total-mismatch' ||
    value === 'pagination-gap' ||
    value === 'page-path-mismatch' ||
    value === 'duplicate-page-path' ||
    value === 'pagination-next-cursor-mismatch' ||
    value === 'pagination-incomplete' ||
    value === 'local-screen-incomplete' ||
    value === 'local-screen-filtered' ||
    value === 'local-selection-invalid' ||
    value === 'local-screen-unreadable' ||
    value === 'local-screen-omitted' ||
    value === 'provider-transfer-mismatch' ||
    value === 'provider-analysis-incomplete' ||
    value === 'provider-budget-omitted' ||
    value === 'provider-omitted' ||
    value === 'provider-failed'
  );
}

function isResearchAnswerContractPlan(value: unknown): value is RustResearchAnswerContractPlan {
  if (!isStringRecordValueMap(value) || !Array.isArray(value.violationCodes)) return false;
  const allowed = value.allowed;
  const violationCodes = value.violationCodes;
  return (
    typeof allowed === 'boolean' &&
    (value.action === 'allow' || value.action === 'repair') &&
    violationCodes.every(isResearchAnswerViolationCode) &&
    new Set(violationCodes).size === violationCodes.length &&
    allowed === (value.action === 'allow' && violationCodes.length === 0) &&
    isStringValue(value.safeCoverageText) &&
    (value.safeAnswer === undefined || isStringValue(value.safeAnswer)) &&
    value.safeCoverageText.length > 0
  );
}

function isResearchAnswerViolationCode(value: unknown): value is RustResearchAnswerViolationCode {
  return (
    value === 'whole-read-claim-unverified' ||
    value === 'broad-negative-claim' ||
    value === 'exact-negative-coverage-incomplete'
  );
}

function isResearchIndexArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNonNegativeSafeInteger);
}

function isUniqueBoundedIndexArray(value: unknown, maxExclusive: number): value is number[] {
  return isBoundedIndexArray(value, maxExclusive) && new Set(value).size === value.length;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
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

export type RustToolCallBlockReason = 'duplicate-tool-call' | 'native-search-budget-exceeded';

export interface RustToolCallBlock {
  candidateIndex: number;
  reason: RustToolCallBlockReason;
}

export interface RustCompatibilityToolCall {
  name: string;
  arguments: string;
}

export type RustAgenticToolChoice = 'auto' | 'required' | 'none';

export type RustNativeEvidenceRequirement =
  | 'content'
  | 'inventory'
  | 'relations'
  | 'stats'
  | 'unknown';

export type RustAgenticNextAction =
  | 'use-tool'
  | 'verify-source'
  | 'broaden-search'
  | 'repair-tool'
  | 'answer';

export interface RustAgenticToolCallSnapshot {
  name: string;
  status: 'success' | 'error';
  arguments: string;
  result?: string;
  serverName?: string;
}

export interface RustAgenticToolTurnInput {
  question: string;
  hasAttachedEvidence: boolean;
  explicitToolServerCount: number;
  explicitToolServerNames?: readonly string[];
  availableToolNames: readonly string[];
  toolCalls: readonly RustAgenticToolCallSnapshot[];
  phase: 'initial' | 'after-tools';
  round: number;
  maxRounds: number;
}

export interface RustAgenticEvidenceLedger {
  successfulCalls: number;
  failedCalls: number;
  successfulExternalCalls: number;
  failedExternalCalls: number;
  candidateSearches: number;
  emptySearches: number;
  verifiedReads: number;
  completeReads: number;
  successfulLists: number;
  successfulLinks: number;
  successfulStats: number;
  verifiedSources: number;
}

export interface RustAgenticToolTurnPlan {
  requiresEvidence: boolean;
  nativeEvidenceRequirement: RustNativeEvidenceRequirement;
  nativeEvidenceRequirements: RustNativeEvidenceRequirement[];
  toolChoice: RustAgenticToolChoice;
  shouldRetryWithoutTools: boolean;
  nextAction: RustAgenticNextAction;
  requiredToolNames: string[];
  requiredExternalServerNames: string[];
  checkpoint: string;
  ledger: RustAgenticEvidenceLedger;
}

export interface RustNativeToolCompatibilityFallbackInput {
  status: number | null;
  message: string;
  nativeAttempted: boolean;
  compatibilityFallbackAttempted: boolean;
}

export interface RustNativeToolCompatibilityFallbackPlan {
  retryWithCompatibility: boolean;
}

export function planAgenticToolTurnRust(
  input: RustAgenticToolTurnInput,
): RustAgenticToolTurnPlan | null {
  if (!isAgenticToolTurnInput(input) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_agentic_tool_turn_json(JSON.stringify(input)));
    return isAgenticToolTurnPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planNativeToolCompatibilityFallbackRust(
  input: RustNativeToolCompatibilityFallbackInput,
): RustNativeToolCompatibilityFallbackPlan | null {
  if (!isNativeToolCompatibilityFallbackInput(input) || !ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_native_tool_compatibility_fallback_json(JSON.stringify(input)),
    );
    return isNativeToolCompatibilityFallbackPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
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

function isAgenticToolTurnInput(input: RustAgenticToolTurnInput): boolean {
  return (
    isStringValue(input.question) &&
    typeof input.hasAttachedEvidence === 'boolean' &&
    isNonNegativeSafeInteger(input.explicitToolServerCount) &&
    (input.explicitToolServerNames === undefined ||
      (input.explicitToolServerNames.length <= 64 &&
        input.explicitToolServerNames.every(
          (name) => isStringValue(name) && name.trim().length > 0,
        ))) &&
    input.availableToolNames.every((name) => isStringValue(name) && name.trim().length > 0) &&
    input.toolCalls.every(
      (call) =>
        isStringValue(call.name) &&
        call.name.trim().length > 0 &&
        (call.status === 'success' || call.status === 'error') &&
        isStringValue(call.arguments) &&
        (call.result === undefined || isStringValue(call.result)) &&
        (call.serverName === undefined ||
          (isStringValue(call.serverName) && call.serverName.trim().length > 0)),
    ) &&
    (input.phase === 'initial' || input.phase === 'after-tools') &&
    isNonNegativeSafeInteger(input.round) &&
    isPositiveSafeInteger(input.maxRounds) &&
    input.round <= input.maxRounds
  );
}

function isNativeToolCompatibilityFallbackInput(
  input: RustNativeToolCompatibilityFallbackInput,
): boolean {
  return (
    (input.status === null ||
      (isNonNegativeSafeInteger(input.status) && input.status >= 100 && input.status <= 599)) &&
    isStringValue(input.message) &&
    typeof input.nativeAttempted === 'boolean' &&
    typeof input.compatibilityFallbackAttempted === 'boolean'
  );
}

function isNativeToolCompatibilityFallbackPlan(
  value: unknown,
): value is RustNativeToolCompatibilityFallbackPlan {
  return isStringRecordValueMap(value) && typeof value.retryWithCompatibility === 'boolean';
}

function isAgenticToolTurnPlan(value: unknown): value is RustAgenticToolTurnPlan {
  if (!isStringRecordValueMap(value)) return false;
  const ledger = value.ledger;
  const primaryRequirement = value.nativeEvidenceRequirement;
  const requirements = value.nativeEvidenceRequirements;
  return (
    typeof value.requiresEvidence === 'boolean' &&
    isNativeEvidenceRequirement(primaryRequirement) &&
    Array.isArray(requirements) &&
    requirements.length <= 4 &&
    requirements.every(isNativeEvidenceRequirement) &&
    !requirements.includes('unknown') &&
    new Set(requirements).size === requirements.length &&
    ((requirements.length === 0 && primaryRequirement === 'unknown') ||
      (requirements.length > 0 && requirements[0] === primaryRequirement)) &&
    (value.toolChoice === 'auto' ||
      value.toolChoice === 'required' ||
      value.toolChoice === 'none') &&
    typeof value.shouldRetryWithoutTools === 'boolean' &&
    (value.nextAction === 'use-tool' ||
      value.nextAction === 'verify-source' ||
      value.nextAction === 'broaden-search' ||
      value.nextAction === 'repair-tool' ||
      value.nextAction === 'answer') &&
    Array.isArray(value.requiredToolNames) &&
    value.requiredToolNames.length <= 64 &&
    value.requiredToolNames.every((name) => isStringValue(name) && name.trim().length > 0) &&
    Array.isArray(value.requiredExternalServerNames) &&
    value.requiredExternalServerNames.length <= 64 &&
    value.requiredExternalServerNames.every(
      (name) => isStringValue(name) && name.trim().length > 0,
    ) &&
    isStringValue(value.checkpoint) &&
    isStringRecordValueMap(ledger) &&
    isNonNegativeSafeInteger(ledger.successfulCalls) &&
    isNonNegativeSafeInteger(ledger.failedCalls) &&
    isNonNegativeSafeInteger(ledger.successfulExternalCalls) &&
    isNonNegativeSafeInteger(ledger.failedExternalCalls) &&
    isNonNegativeSafeInteger(ledger.candidateSearches) &&
    isNonNegativeSafeInteger(ledger.emptySearches) &&
    isNonNegativeSafeInteger(ledger.verifiedReads) &&
    isNonNegativeSafeInteger(ledger.completeReads) &&
    isNonNegativeSafeInteger(ledger.successfulLists) &&
    isNonNegativeSafeInteger(ledger.successfulLinks) &&
    isNonNegativeSafeInteger(ledger.successfulStats) &&
    isNonNegativeSafeInteger(ledger.verifiedSources)
  );
}

function isNativeEvidenceRequirement(value: unknown): value is RustNativeEvidenceRequirement {
  return (
    value === 'content' ||
    value === 'inventory' ||
    value === 'relations' ||
    value === 'stats' ||
    value === 'unknown'
  );
}

function isRustToolCallSignatureInput(value: unknown): value is RustToolCallSignatureInput {
  return (
    isStringRecordValueMap(value) && isStringValue(value.name) && isStringValue(value.arguments)
  );
}

export function planToolCallBlocksRust(
  history: readonly RustToolCallSignatureInput[],
  candidates: readonly RustToolCallSignatureInput[],
  maxRepeats: number,
  maxNativeSearchCalls: number,
): RustToolCallBlock[] | null {
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
    return Array.isArray(parsed) &&
      parsed.every(
        (value) => isRustToolCallBlock(value) && value.candidateIndex < candidates.length,
      )
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isRustToolCallBlock(value: unknown): value is RustToolCallBlock {
  return (
    isStringRecordValueMap(value) &&
    isNonNegativeSafeInteger(value.candidateIndex) &&
    (value.reason === 'duplicate-tool-call' || value.reason === 'native-search-budget-exceeded')
  );
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

export interface RustSourceChunk extends Chunk {
  id: string;
  chunkHash: string;
}

export function planSourceChunkImportIndicesRust(
  entries: readonly { id: string; filePath: string; chunkHash?: string }[],
): number[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_source_chunk_import_indices_json(JSON.stringify(entries)),
    );
    return Array.isArray(parsed) &&
      parsed.every((index: unknown) => isValidNonNegativeInteger(index) && index < entries.length)
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

export function planSourceProcessingRust(
  input: SourceProcessingInput,
): SourceProcessingSummary | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(plan_source_processing_json(JSON.stringify(input)));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('files' in parsed) ||
      !Array.isArray(parsed.files) ||
      !('totalFiles' in parsed) ||
      !isValidNonNegativeInteger(parsed.totalFiles) ||
      !('chatReadyFiles' in parsed) ||
      !isValidNonNegativeInteger(parsed.chatReadyFiles) ||
      !('completeFiles' in parsed) ||
      !isValidNonNegativeInteger(parsed.completeFiles) ||
      !('truncated' in parsed) ||
      typeof parsed.truncated !== 'boolean'
    )
      return null;
    const states = new Set(['ready', 'pending', 'stale', 'failed', 'disabled']);
    for (const value of parsed.files as unknown[]) {
      if (!value || typeof value !== 'object') return null;
      const file = value as Record<string, unknown>;
      if (
        !file ||
        typeof file !== 'object' ||
        typeof file.filePath !== 'string' ||
        !['source', 'bm25', 'embedding'].every(
          (field) => typeof file[field] === 'string' && states.has(file[field]),
        ) ||
        (file.chat !== 'ready' && file.chat !== 'pending')
      )
        return null;
    }
    return parsed as SourceProcessingSummary;
  } catch {
    return null;
  }
}

export interface RustSourceTextSegment {
  label: string;
  startLine: number;
  endLine: number;
}

export interface RustSourceTextExtraction {
  ok: boolean;
  format: string;
  text: string;
  segments: RustSourceTextSegment[];
  reason: string | null;
}

/** 압축 문서 본문 추출을 지원하는 확장자인지 확인합니다. */
export function isExtractableSourceExtensionRust(extension: string): boolean | null {
  if (!ensureRustCore()) return null;
  try {
    return is_extractable_source_extension(extension.trim().replace(/^\./, '').toLowerCase());
  } catch {
    return null;
  }
}

/** 압축 문서 바이트에서 본문과 구간 경계를 추출합니다. */
export function extractSourceTextRust(
  extension: string,
  bytes: Uint8Array,
): RustSourceTextExtraction | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(extract_source_text_json(extension, bytes));
    return isRustSourceTextExtraction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRustSourceTextExtraction(value: unknown): value is RustSourceTextExtraction {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustSourceTextExtraction>;
  return (
    typeof candidate.ok === 'boolean' &&
    typeof candidate.format === 'string' &&
    typeof candidate.text === 'string' &&
    (candidate.reason === null || typeof candidate.reason === 'string') &&
    Array.isArray(candidate.segments) &&
    candidate.segments.every(isRustSourceTextSegment)
  );
}

function isRustSourceTextSegment(value: unknown): value is RustSourceTextSegment {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustSourceTextSegment>;
  return (
    typeof candidate.label === 'string' &&
    Number.isSafeInteger(candidate.startLine) &&
    Number.isSafeInteger(candidate.endLine)
  );
}

export function planSourceChunksRust(
  path: string,
  extension: string,
  content: string,
  maxChunkSize: number,
  overlapChars: number,
): RustSourceChunk[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_source_chunks_json(path, extension, content, maxChunkSize, overlapChars),
    );
    if (!isChunkArray(parsed)) return null;
    for (const chunk of parsed) {
      if (!('id' in chunk) || typeof chunk.id !== 'string') return null;
      if (!('chunkHash' in chunk) || typeof chunk.chunkHash !== 'string') return null;
    }
    return parsed as RustSourceChunk[];
  } catch {
    return null;
  }
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

export function normalizeVaultLinkTargetRust(raw: string): string | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(normalize_vault_link_target_json(raw));
    return typeof parsed === 'string' ? parsed : null;
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

export function planNativeVaultLexicalHitRust(
  query: string,
  content: string,
  matchMode: 'all' | 'any' | 'phrase',
): RustNativeVaultLexicalHitPlan | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_native_vault_lexical_hit_json(query, content, matchMode);
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return isNativeVaultLexicalHitPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function planToolResultSourceReferencesRust(
  citations: readonly unknown[],
): RustToolResultSourceReference[] | null {
  if (!ensureRustCore()) return null;
  try {
    const raw = plan_tool_result_source_references_json(JSON.stringify(citations));
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isToolResultSourceReference) ? parsed : null;
  } catch {
    return null;
  }
}

export function shouldOfferContext7ForPromptRust(prompt: string): boolean | null {
  if (!ensureRustCore()) return null;
  return should_offer_context7_for_prompt(prompt);
}

export function planPluginAwareIndicesRust(
  prompt: string,
  previousQuestions: readonly string[],
  plugins: readonly { id: string; name?: string }[],
): number[] | null {
  if (!ensureRustCore()) return null;
  try {
    const parsed: unknown = JSON.parse(
      plan_plugin_aware_indices_json(
        prompt,
        JSON.stringify(previousQuestions),
        JSON.stringify(plugins),
      ),
    );
    return Array.isArray(parsed) &&
      parsed.every(
        (index: unknown) =>
          typeof index === 'number' &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < plugins.length,
      )
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

export function selectPluginContext7LibraryIdRust(
  plugin: { id: string; name?: string },
  result: unknown,
): string | null {
  if (!ensureRustCore()) return null;
  return select_plugin_context7_library_id(JSON.stringify(plugin), JSON.stringify(result)) || null;
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

function isBoundedIndexArray(value: unknown, maxExclusive: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((index) => Number.isSafeInteger(index) && index >= 0 && index < maxExclusive)
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

function isValidProviderStateInput(input: RustProviderStateInput): boolean {
  return (
    isStringValue(input.strategy) &&
    input.strategy.trim().length > 0 &&
    typeof input.enabled === 'boolean' &&
    typeof input.apiKeyConfigured === 'boolean' &&
    typeof input.baseUrlConfigured === 'boolean' &&
    Array.isArray(input.models) &&
    input.models.every(
      (model) =>
        isStringValue(model.value) &&
        model.value.trim().length > 0 &&
        isStringValue(model.label) &&
        model.label.trim().length > 0 &&
        (model.kind === 'general' || model.kind === 'embedding') &&
        (model.verificationStatus === 'success' ||
          model.verificationStatus === 'failed' ||
          model.verificationStatus === 'unknown'),
    )
  );
}

function isProviderProfileStatePlan(value: unknown): value is RustProviderProfileStatePlan {
  if (!isStringRecordValueMap(value)) return false;
  return (
    (value.tone === 'ready' ||
      value.tone === 'configured' ||
      value.tone === 'needs-key' ||
      value.tone === 'needs-url' ||
      value.tone === 'needs-models' ||
      value.tone === 'failed' ||
      value.tone === 'disabled') &&
    typeof value.chatSupported === 'boolean' &&
    typeof value.embeddingSupported === 'boolean' &&
    typeof value.chatUsable === 'boolean' &&
    typeof value.embeddingUsable === 'boolean' &&
    Array.isArray(value.chatModelValues) &&
    value.chatModelValues.every(isStringValue) &&
    new Set(value.chatModelValues).size === value.chatModelValues.length &&
    Array.isArray(value.embeddingModelValues) &&
    value.embeddingModelValues.every(isStringValue) &&
    new Set(value.embeddingModelValues).size === value.embeddingModelValues.length
  );
}

function isProviderVerificationState(value: unknown): value is RustProviderVerificationState {
  return (
    isStringRecordValueMap(value) &&
    (value.chatStatus === 'success' ||
      value.chatStatus === 'failed' ||
      value.chatStatus === 'unknown') &&
    (value.embeddingStatus === 'success' ||
      value.embeddingStatus === 'failed' ||
      value.embeddingStatus === 'unknown')
  );
}

function isProviderVerificationReset(value: unknown): value is RustProviderVerificationReset {
  return (
    isStringRecordValueMap(value) &&
    value.chatStatus === 'unknown' &&
    value.embeddingStatus === 'unknown'
  );
}

function isChatModelStatePlan(value: unknown): value is RustChatModelStatePlan {
  if (!isStringRecordValueMap(value) || !Array.isArray(value.options)) return false;
  const optionsAreValid = value.options.every(
    (option) =>
      isStringRecordValueMap(option) &&
      isStringValue(option.value) &&
      option.value.trim().length > 0 &&
      isStringValue(option.label) &&
      option.label.trim().length > 0,
  );
  if (
    !optionsAreValid ||
    !isStringValue(value.selectedModel) ||
    !isValidNonNegativeInteger(value.enabledProviderCount) ||
    !isValidNonNegativeInteger(value.availableModelCount) ||
    value.availableModelCount !== value.options.length
  ) {
    return false;
  }
  return (
    value.selectedModel.length === 0 ||
    value.options.some(
      (option) => isStringRecordValueMap(option) && option.value === value.selectedModel,
    )
  );
}

function isNativeVaultToolRequestPlan(value: unknown): value is RustNativeVaultToolRequestPlan {
  if (!isStringRecordValueMap(value) || typeof value.ok !== 'boolean') return false;
  if (!value.ok) {
    return isStringRecordValueMap(value.error) && typeof value.error.code === 'string';
  }
  return isNativeVaultToolRequest(value.request);
}

function isNativeVaultLexicalHitPlan(value: unknown): value is RustNativeVaultLexicalHitPlan {
  if (!isStringRecordValueMap(value)) return false;
  return (
    isValidNonNegativeInteger(value.startLine) &&
    value.startLine > 0 &&
    isValidNonNegativeInteger(value.endLine) &&
    value.endLine >= value.startLine &&
    isStringValue(value.preview) &&
    (value.status === 'candidate' || value.status === 'verified')
  );
}

function isToolResultSourceReference(value: unknown): value is RustToolResultSourceReference {
  if (!isStringRecordValueMap(value)) return false;
  const hasValidLine =
    value.line === undefined || (isValidNonNegativeInteger(value.line) && value.line > 0);
  const hasValidEndLine =
    value.endLine === undefined ||
    (isValidNonNegativeInteger(value.endLine) &&
      value.endLine > 0 &&
      isValidNonNegativeInteger(value.line) &&
      value.endLine >= value.line);
  return (
    isStringValue(value.filePath) &&
    (value.status === 'candidate' || value.status === 'verified') &&
    value.requiresRead === true &&
    hasValidLine &&
    hasValidEndLine
  );
}

function isNativeVaultToolRequest(value: unknown): value is RustNativeVaultToolRequest {
  if (!isStringRecordValueMap(value) || typeof value.action !== 'string') return false;
  if (value.action === 'stats') return true;
  if (value.action === 'search') {
    const queries = value.queries;
    return (
      typeof value.query === 'string' &&
      (queries === undefined ||
        (Array.isArray(queries) &&
          queries.length >= 1 &&
          queries.length <= 4 &&
          queries.every((query) => typeof query === 'string' && query.length > 0))) &&
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.limit) &&
      (value.mode === undefined ||
        value.mode === 'auto' ||
        value.mode === 'exact' ||
        value.mode === 'word') &&
      (value.field === undefined ||
        value.field === 'both' ||
        value.field === 'content' ||
        value.field === 'path') &&
      (value.filters === undefined || isNativeVaultFilters(value.filters)) &&
      (value.match === 'all' || value.match === 'any' || value.match === 'phrase')
    );
  }
  if (value.action === 'read') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.startLine) &&
      (value.startOffset === undefined || isNonNegativeSafeInteger(value.startOffset)) &&
      (value.endLine === null || isNonNegativeSafeInteger(value.endLine))
    );
  }
  if (value.action === 'related') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.startLine) &&
      (value.endLine === null || isNonNegativeSafeInteger(value.endLine)) &&
      isNonNegativeSafeInteger(value.limit)
    );
  }
  if (value.action === 'list') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.cursor) &&
      (value.filters === undefined || isNativeVaultFilters(value.filters)) &&
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

function isNativeVaultFilters(value: unknown): value is RustNativeVaultFilters {
  if (!isStringRecordValueMap(value)) return false;
  return (
    (value.modifiedAfter === undefined || isNonNegativeSafeInteger(value.modifiedAfter)) &&
    (value.modifiedBefore === undefined || isNonNegativeSafeInteger(value.modifiedBefore)) &&
    (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every(isStringValue))) &&
    (value.properties === undefined ||
      (isStringRecordValueMap(value.properties) &&
        Object.values(value.properties).every(
          (property) =>
            typeof property === 'string' ||
            typeof property === 'boolean' ||
            (typeof property === 'number' && Number.isFinite(property)),
        )))
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

function isNativeVaultSearchRrfPlan(
  value: unknown,
  candidateCount: number,
  queryCount: number,
): value is RustNativeVaultSearchRrfPlan {
  if (
    !isStringRecordValueMap(value) ||
    !isNonNegativeSafeInteger(value.totalEntries) ||
    !Array.isArray(value.hits) ||
    value.hits.length > 20
  ) {
    return false;
  }
  return value.hits.every(
    (hit) =>
      isStringRecordValueMap(hit) &&
      isBoundedIndexArray(hit.candidateIndexes, candidateCount) &&
      hit.candidateIndexes.length > 0 &&
      isNonNegativeSafeInteger(hit.representativeCandidateIndex) &&
      hit.representativeCandidateIndex < candidateCount &&
      hit.candidateIndexes.includes(hit.representativeCandidateIndex) &&
      isBoundedIndexArray(hit.matchedQueryIndices, queryCount) &&
      hit.matchedQueryIndices.length > 0 &&
      typeof hit.rrfScore === 'number' &&
      Number.isFinite(hit.rrfScore) &&
      hit.rrfScore > 0,
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMentionCandidate(value: unknown): value is RustMentionCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RustMentionCandidate>;
  return (
    typeof candidate.raw === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.tag === undefined || typeof candidate.tag === 'string') &&
    (candidate.link === undefined || candidate.link === true) &&
    (candidate.workspace === undefined ||
      candidate.workspace === 'current' ||
      candidate.workspace === 'tabs')
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
    hasStructuralEvidence,
    hasStrongStructuralEvidence,
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
    typeof hasStructuralEvidence !== 'boolean' ||
    typeof hasStrongStructuralEvidence !== 'boolean' ||
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
    hasStructuralEvidence,
    hasStrongStructuralEvidence,
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
    value === 'strong-structural-evidence' ||
    value === 'structural-evidence' ||
    value === 'keyword-vector' ||
    value === 'keyword' ||
    value === 'vector' ||
    value === 'hybrid'
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
    isStringValue(active.corpus) &&
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
    (message.errorRetryAt === undefined || isStringValue(message.errorRetryAt)) &&
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
    isBoundedIndexArray(plan.tagIndices, mentionCount) &&
    isBoundedIndexArray(plan.serverIndices, mentionCount) &&
    typeof plan.useAutoRag === 'boolean' &&
    isAutoRagReason(plan.autoRagReason)
  );
}

function isChatContextMentionType(value: string): boolean {
  return value === 'file' || value === 'folder' || value === 'server' || value === 'tag';
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
    (citation.selectionReason === undefined || isSourceSelectionReason(citation.selectionReason))
  );
}

function isContextSourceBlockPlan(value: unknown): value is RustContextSourceBlockPlan {
  if (!value || typeof value !== 'object') return false;
  const block = value as Partial<RustContextSourceBlockPlan>;
  return isStringValue(block.sourceId) && isStringValue(block.text);
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
    (verification.detail === undefined || isStringValue(verification.detail))
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

function isValidUint32Array(values: readonly number[], maxExclusive?: number): boolean {
  return values.every(
    (value) => isValidUint32(value) && (maxExclusive === undefined || value < maxExclusive),
  );
}

function sourceToCode(source: string): number {
  if (source === 'bm25') return 1;
  if (source === 'vector') return 2;
  if (source === 'structural') return 4;
  if (source === 'ann') return 5;
  return 0;
}

function sourceCodeToSource(sourceCode: number): string | null {
  if (sourceCode === 1) return 'bm25';
  if (sourceCode === 2) return 'vector';
  if (sourceCode === 4) return 'structural';
  if (sourceCode === 5) return 'ann';
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
