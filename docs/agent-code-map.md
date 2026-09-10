# 코드 탐색 참고표

필요한 기능만 검색해서 읽습니다. 아래 표는 코드 탐색의 출발점이며, 심볼의 존재·시그니처·현재 동작은 실제 소스와 테스트로 확인합니다. 새로운 심볼을 매번 루트 AGENTS.md에 나열하지 않습니다. 표의 경로는 저장소 루트 기준입니다.

## STRUCTURE

```
.
├── main.ts                       # Plugin 진입점, provider/RAG/GraphRAG/agent/MCP 조립
├── manifest.json                 # Obsidian plugin metadata (id: superpower-inside)
├── styles.css                    # 플러그인 전용 CSS, superpower-inside- 프리픽스
├── src/
│   ├── settings.ts               # 설정 타입 + PluginSettingTab UI
│   ├── i18n.ts                   # 한국어/영어 다국어 문자열
│   ├── agent/                    # 네이티브 읽기 전용 볼트 도구 + 전체 볼트 리서치
│   ├── llm/                      # Provider, 스트리밍, 도구 호출 delta, 임베딩
│   ├── rag/                      # 청킹, BM25/vector worker, 저장소, hybrid retrieval
│   ├── chat/                     # 채팅 UI, 도구 실행, run 제어, 저장, 출처
│   ├── mcp/                      # MCP stdio client/registry
│   └── utils/                    # vault adapter JSON IO, 플러그인 탐지, MCP JSON 검증
├── scripts/                      # Windows PowerShell, macOS fish 개발 진입점 + Rust/WASM helper
├── docs/                         # 개발/제출 문서
├── crates/rag-wasm/              # Rust/WASM RAG 계산 코어
├── Cargo.toml                    # Rust workspace, strict lint 기준
├── deny.toml                     # cargo-deny 보안/라이선스/소스 정책
├── rust-toolchain.toml           # Rust 1.96.0 + wasm32-unknown-unknown 고정
├── simulations/                  # chat-sim.html UI 시뮬레이션(미추적/배포 제외 성격)
├── esbuild.config.mjs            # main.ts → main.js 번들, format:cjs, target:es2022
├── eslint.config.mjs             # flat config + typescript-eslint/recommended-type-checked
├── tsconfig.json                 # strict, noUnused*, noImplicit*, isolatedModules
└── .github/workflows/release.yml # GitHub Release workflow
```

## WHERE TO LOOK

| Task                     | Location                                             | Notes                                                                     |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 플러그인 생명주기/명령어 | `main.ts`                                            | `open-ai-chat`, `reindex-vault`, `execute-ai-directive`, RAG 이벤트 훅    |
| 설정 타입/설정 UI        | `src/settings.ts`                                    | Provider/RAG/MCP/Chat 설정 탭. 저장 시 provider/RAG/MCP 재초기화          |
| LLM Provider 변경        | `src/llm/providers.ts` + `src/settings.ts`           | `createProvider`, `PROVIDER_KEYS`, `PROVIDER_LABELS`, 기본 설정 동시 확인 |
| 임베딩 변경              | `src/llm/embedding.ts`                               | OpenAI-compatible/Ollama 임베딩 + Dexie 캐시 래퍼                         |
| LLM/임베딩 연결 테스트   | `src/llm/validation.ts`                              | 설정 UI의 연결 검증과 연결됨                                              |
| 네이티브 볼트 도구       | `src/agent/native-vault-tool.ts` + `src/agent/obsidian-native-vault-port.ts` | 읽기 전용 검색·읽기·목록·링크·통계와 모델 도구 결과 변환 |
| 전체 볼트 리서치         | `src/agent/research-agent.ts`                        | 로컬 screening, 제한된 근거 전송, reduce/synthesis, coverage 보고         |
| RAG 청킹/인덱싱          | `src/rag/indexer.ts`                                 | `chunkMarkdown`, `VaultIndexer`, 파일 modify/delete/rename 이벤트         |
| RAG 저장소/파일 필터     | `src/rag/store.ts` + `src/utils/vault.ts`            | vector JSON 저장소, Rust/WASM exclude path matching, vault file filtering |
| RAG retrieval pipeline   | `src/rag/retrieval-pipeline.ts`                      | exact/ANN/BM25/structural 후보 wrapper, Rust/WASM 후보 계산/병합          |
| RAG 질의/컨텍스트        | `src/rag/query.ts` + `src/chat/context.ts`           | 유사도 검색 결과가 채팅 system prompt와 출처 카드로 들어감                |
| 채팅 UI                  | `src/chat/view.ts`                                   | DOM, 스트리밍, 진행 상태, 출처, 세션 UI                                   |
| 채팅 도구 실행           | `src/chat/tool-execution.ts`                         | 네이티브/MCP 도구 반복 실행과 결과 resume                                 |
| 채팅 run 제어            | `src/chat/run-ownership.ts` + `src/chat/session-recovery.ts` | 전체 run 취소 소유권과 중단 세션 복구                        |
| 채팅 저장/로드           | `src/chat/persistence.ts`                            | 프론트매터 + HTML 주석 기반 Markdown 직렬화, 레거시 로드 지원             |
| 채팅 참조 확장           | `src/chat/context-expansion.ts`                      | Rust/WASM link extraction, Obsidian metadata/vault resolve                |
| 멘션 처리                | `src/chat/mention-parser.ts` + `src/chat/context.ts` | Rust/WASM mention candidate extraction, TS resolver classification        |
| 멘션 테스트              | `src/chat/mention-parser.test.ts`                    | 공백 경로, 중복 제거, 파일/폴더/MCP 분류 계약                             |
| 세션 히스토리 모달       | `src/chat/session-modal.ts`                          | `FuzzySuggestModal`, 채팅 메타 로드                                       |
| MCP 연결/도구 호출       | `src/mcp/client.ts` + `src/mcp/registry.ts`          | stdio 전용. `mcpPath`/env PATH 처리                                       |
| MCP JSON 편집            | `src/utils/mcp-json.ts`                              | 표준 `mcpServers` JSON 검증/포맷                                          |
| 활성 플러그인 탐지       | `src/utils/obsidian-compat.ts`                       | 비공식 Obsidian API 접근이므로 try/catch 유지                             |
| GraphRAG 저장소          | `src/graph/store.ts`                                 | Dexie/Memory mutation, Rust/WASM pruning index plan                       |
| GraphRAG community 감지  | `src/graph/community-detector.ts`                    | Rust/WASM edge aggregation과 community detection, TS record mapping       |
| GraphRAG entity resolve  | `src/graph/entity-resolver.ts`                       | Rust/WASM entity name normalization과 merge score, TS store orchestration |
| Rust/WASM RAG 코어       | `crates/rag-wasm/`                                   | 성능 민감 순수 계산. JS는 UI/host I/O, Rust는 결정적 계산 담당            |
| Rust/WASM JS bridge      | `src/rag/rust-core.ts` + `generated/rag-wasm/`       | embedded WASM init, hash/tokenize/vector/query scoring bridge             |
| Rust 보안 게이트         | `scripts/check-rust-security.fish` + `deny.toml`     | fmt, clippy, test, wasm build, deny, audit, vet, geiger                   |

## CODE MAP

| Symbol                                                                          | Type      | Location                          | Role                                                                |
| ------------------------------------------------------------------------------- | --------- | --------------------------------- | ------------------------------------------------------------------- |
| `SuperpowerInsidePlugin`                                                        | class     | `main.ts`                         | Plugin 진입점, 설정 migration, provider/RAG/MCP 초기화              |
| `SuperpowerInsideSettings`                                                      | interface | `src/settings.ts`                 | 전체 설정 스키마                                                    |
| `DEFAULT_SETTINGS`                                                              | const     | `src/settings.ts`                 | Provider/RAG/MCP/Chat 기본값                                        |
| `SuperpowerInsideSettingTab`                                                    | class     | `src/settings.ts`                 | 설정 UI와 debounced save                                            |
| `createProvider`                                                                | function  | `src/llm/providers.ts`            | ProviderKey → LLMProvider 팩토리                                    |
| `OpenAICompatibleProvider`                                                      | class     | `src/llm/providers.ts`            | OpenAI/OpenRouter 공통 스트리밍/도구 호출 처리                      |
| `ClaudeProvider`                                                                | class     | `src/llm/providers.ts`            | Anthropic Claude Provider                                           |
| `OllamaProvider`                                                                | class     | `src/llm/providers.ts`            | Ollama Local/Cloud Provider                                         |
| `CachedEmbeddingProvider`                                                       | class     | `src/llm/embedding.ts`            | 메모리 + IndexedDB(Dexie) 임베딩 캐시                               |
| `ObsidianNativeVaultToolPort`                                                   | class     | `src/agent/obsidian-native-vault-port.ts` | Obsidian 파일 범위를 읽기 전용 도구 계약으로 연결          |
| `NativeVaultToolRuntime`                                                        | class     | `src/agent/native-vault-tool.ts`  | Rust 요청 plan을 실행하고 모델 결과·표시 텍스트·출처로 변환          |
| `VaultResearchAgent`                                                            | class     | `src/agent/research-agent.ts`     | 전체 볼트 inventory, 로컬 선별, 제한된 근거 분석과 최종 합성          |
| `chunkMarkdown`                                                                 | function  | `src/rag/indexer.ts`              | 헤딩/코드블록 경계 존중 Markdown 청킹                               |
| `VaultIndexer`                                                                  | class     | `src/rag/indexer.ts`              | 전체/증분/파일별 인덱싱                                             |
| `JsonFileVectorStore`                                                           | class     | `src/rag/store.ts`                | vault.adapter 기반 JSON 벡터 저장소                                 |
| `RAGQueryEngine`                                                                | class     | `src/rag/query.ts`                | 임베딩 → 코사인 유사도 → 컨텍스트                                   |
| `ChatView`                                                                      | class     | `src/chat/view.ts`                | 사이드바 채팅 ItemView, 스트리밍, MCP 도구, 출처 UI                 |
| `buildChatContext`                                                              | function  | `src/chat/context.ts`             | 자동 RAG + 파일/폴더/MCP 멘션 컨텍스트 생성                         |
| `parseMentionCandidatesRust`                                                    | function  | `src/rag/rust-core.ts`            | 채팅 raw mention 후보 추출 Rust bridge                              |
| `parseMentions`                                                                 | function  | `src/chat/mention-parser.ts`      | Rust 우선 mention 후보 추출과 TS resolver 분류                      |
| `plan_chat_context_mentions_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 context mention type index와 auto-RAG policy plan 계산         |
| `planChatContextMentionsRust`                                                   | function  | `src/rag/rust-core.ts`            | TS parsed mention type snapshot과 Rust context mention plan bridge  |
| `saveChat` / `loadChat` / `listChats`                                           | function  | `src/chat/persistence.ts`         | 채팅 세션 Markdown 저장/복원과 Rust folder plan 기반 목록 조회      |
| `MCPClientManager`                                                              | class     | `src/mcp/client.ts`               | MCP SDK Client + stdio transport                                    |
| `MCPRegistry`                                                                   | class     | `src/mcp/registry.ts`             | MCP 서버 설정/클라이언트/연결 상태 관리                             |
| `plan_mcp_server_candidates_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | MCP connected preferred/remaining server candidate plan 계산        |
| `planMcpServerCandidatesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS MCP registry snapshot과 Rust server candidate bridge             |
| `is_mcp_tool_name_available`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | MCP tool name 목록의 exact match 판정                               |
| `isMcpToolAvailableRust`                                                        | function  | `src/rag/rust-core.ts`            | TS tool list snapshot과 Rust tool name matching bridge              |
| `plan_rag_file_content_probe_indices_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 file content probe 필요 index plan 계산                    |
| `planRagFileContentProbeIndicesRust`                                            | function  | `src/rag/rust-core.ts`            | TS vault file metadata snapshot과 Rust probe index bridge           |
| `plan_rag_file_indexability_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 file indexability와 file type summary input plan 계산      |
| `planRagFileIndexabilityRust`                                                   | function  | `src/rag/rust-core.ts`            | TS text probe snapshot과 Rust RAG file eligibility bridge           |
| `plan_graph_rag_run_file_selection_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG indexing run candidate/selected file path plan 계산        |
| `planGraphRagRunFileSelectionRust`                                              | function  | `src/rag/rust-core.ts`            | TS vector store path snapshot과 Rust GraphRAG run selection bridge  |
| `plan_graph_rag_unsupported_prune_paths_json`                                   | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG unsupported evidence/rejected fact prune path plan 계산    |
| `planGraphRagUnsupportedPrunePathsRust`                                         | function  | `src/rag/rust-core.ts`            | TS Graph store processable snapshot과 Rust unsupported prune bridge |
| `plan_graph_rag_status_file_snapshot_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status candidate file record/indexed path count plan 계산  |
| `planGraphRagStatusFileSnapshotRust`                                            | function  | `src/rag/rust-core.ts`            | TS vector store path snapshot과 Rust GraphRAG status file bridge    |
| `plan_graph_rag_status_entry_snapshot_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status vector entry snapshot index plan 계산               |
| `planGraphRagStatusEntrySnapshotRust`                                           | function  | `src/rag/rust-core.ts`            | TS vector entry path snapshot과 Rust GraphRAG status entry bridge   |
| `create_content_hash`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | TypeScript `createContentHash()`와 같은 UTF-16 FNV-1a               |
| `tokenize`                                                                      | function  | `crates/rag-wasm/src/lib.rs`      | TypeScript BM25 토크나이저와 같은 검색 토큰 생성                    |
| `token_frequencies_json`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | BM25 문서 term frequency JSON 생성                                  |
| `bm25TermFrequenciesRust`                                                       | function  | `src/rag/rust-core.ts`            | BM25 문서 frequency bridge                                          |
| `plan_bm25_index_add_document_json`                                             | function  | `crates/rag-wasm/src/lib.rs`      | BM25 inverted index 문서 추가/교체 plan 계산                        |
| `planBm25IndexAddDocumentRust`                                                  | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust add/replace plan bridge               |
| `plan_bm25_index_remove_document_json` / `plan_bm25_index_remove_source_json`   | function  | `crates/rag-wasm/src/lib.rs`      | BM25 document/source 제거와 통계 재계산                             |
| `planBm25IndexRemoveDocumentRust` / `planBm25IndexRemoveSourceRust`             | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust removal plan bridge                   |
| `plan_bm25_search_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | BM25 raw query token dedupe, posting scan, doc score 계산           |
| `planBm25SearchRust`                                                            | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust search score bridge                   |
| `count_keyword_matches`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | query 토큰과 텍스트 간 substring 매칭 수를 Rust에서 계산            |
| `countKeywordMatchesRust`                                                       | function  | `src/rag/rust-core.ts`            | RAG 조회에서 keyword-matching score를 WASM으로 산출                 |
| `bm25_score_pairs`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | BM25 posting list의 doc index/score 계산                            |
| `scoreBm25Rust`                                                                 | function  | `src/rag/rust-core.ts`            | TS BM25 posting 배열과 Rust score pair bridge                       |
| `rank_top_k_pairs`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | flattened vector matrix의 top-k index/score 계산                    |
| `rankTopKPairsRust`                                                             | function  | `src/rag/rust-core.ts`            | TS entry 배열과 Rust row index/score bridge                         |
| `assign_vector_clusters`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | ANN vector row를 nearest centroid index로 배정                      |
| `assignVectorClustersRust`                                                      | function  | `src/rag/rust-core.ts`            | IVF index build의 cluster assignment Rust bridge                    |
| `recompute_centroids`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | ANN cluster assignment 기반 centroid matrix 재계산                  |
| `recomputeCentroidsRust`                                                        | function  | `src/rag/rust-core.ts`            | IVF index build의 centroid recompute Rust bridge                    |
| `build_initial_centroids`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | ANN cluster 수 결정과 초기 centroid matrix 선택                     |
| `buildInitialCentroidsRust`                                                     | function  | `src/rag/rust-core.ts`            | TS vector matrix와 Rust 초기 centroid build bridge                  |
| `recall_at_k`                                                                   | function  | `crates/rag-wasm/src/lib.rs`      | ANN recall@k metric 계산                                            |
| `calculateRecallAtKRust`                                                        | function  | `src/rag/rust-core.ts`            | TS id 목록과 Rust recall@k bridge                                   |
| `IvfVectorCandidateProvider`                                                    | class     | `src/rag/retrieval-pipeline.ts`   | ANN 후보 조회, Rust 우선 centroid probe/build 계산                  |
| `rankGlobalCommunitiesWithRust`                                                 | function  | `src/graph/query-engine.ts`       | GraphRAG community summary vector top-k Rust bridge 사용            |
| `rrf_score_or_nan`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG retrieval source rank fusion score 계산                         |
| `calculateRrfScoreRust`                                                         | function  | `src/rag/rust-core.ts`            | TS source rank map과 Rust RRF bridge                                |
| `hybrid_score_or_nan`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | RAG hybrid result score 계산                                        |
| `calculateHybridScoreRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query score input과 Rust hybrid score bridge                     |
| `analyze_retrieval_sources`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG retrieval source prior/evidence/rank/flag 계산                  |
| `analyzeRetrievalSourcesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS source score/rank map과 Rust source analysis bridge              |
| `plan_query_result_score_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | RAG query result score row JSON plan 계산                           |
| `planQueryResultScoreRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query candidate snapshot과 Rust score row bridge                 |
| `is_relevant_result`                                                            | function  | `crates/rag-wasm/src/lib.rs`      | RAG 최종 context 후보 relevance 판단                                |
| `isRelevantResultRust`                                                          | function  | `src/rag/rust-core.ts`            | TS query result와 Rust relevance gate bridge                        |
| `select_relevant_result_indices`                                                | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 정렬/relative threshold/source-aware relevance window 계산 |
| `selectRelevantResultIndicesRust`                                               | function  | `src/rag/rust-core.ts`            | TS query 후보 배열과 Rust relevance window selection bridge         |
| `plan_graph_query_response_json`                                                | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM planner raw 응답을 query plan으로 정규화               |
| `planGraphQueryResponseRust`                                                    | function  | `src/rag/rust-core.ts`            | TS provider 응답과 Rust GraphRAG planner response bridge            |
| `plan_graph_query_execution_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG query mode/evidence-first 실행 action plan 계산            |
| `planGraphQueryExecutionRust`                                                   | function  | `src/rag/rust-core.ts`            | TS query engine mode와 Rust execution action bridge                 |
| `plan_graph_schema_relation_indices_json`                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG relation schema id matching index plan 계산                |
| `planGraphSchemaRelationIndicesRust`                                            | function  | `src/rag/rust-core.ts`            | TS relation snapshot과 Rust schema relation index bridge            |
| `plan_graph_schema_community_indices_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community schema id matching index plan 계산               |
| `planGraphSchemaCommunityIndicesRust`                                           | function  | `src/rag/rust-core.ts`            | TS community snapshot과 Rust schema community index bridge          |
| `plan_graph_community_replacement_delete_ids_json`                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community replacement 삭제 id plan 계산                    |
| `planGraphCommunityReplacementDeleteIdsRust`                                    | function  | `src/rag/rust-core.ts`            | TS community replacement snapshot과 Rust 삭제 id bridge             |
| `plan_claim_evidence_scores_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG claim confidence를 evidence score plan으로 변환            |
| `planClaimEvidenceScoresRust`                                                   | function  | `src/rag/rust-core.ts`            | TS claim snapshot과 Rust claim evidence score bridge                |
| `plan_evidence_candidate_order_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence score 중복 병합과 candidate order 계산            |
| `planEvidenceCandidateOrderRust`                                                | function  | `src/rag/rust-core.ts`            | TS evidence score 목록과 Rust candidate order plan bridge           |
| `plan_file_index_records_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | vector metadata의 file index record grouping/complete 판정 계산     |
| `planFileIndexRecordsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS vector metadata snapshot과 Rust file index record plan bridge    |
| `plan_vector_store_add_json`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore add overwrite/append source index plan 계산             |
| `planVectorStoreAddRust`                                                        | function  | `src/rag/rust-core.ts`            | TS VectorEntry id snapshot과 Rust add mutation plan bridge          |
| `plan_vector_store_replace_file_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file replacement source index/removed count 계산        |
| `planVectorStoreReplaceFileRust`                                                | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust replacement mutation plan bridge       |
| `plan_vector_store_remove_file_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file removal source index/removed count 계산            |
| `planVectorStoreRemoveFileRust`                                                 | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust removal mutation plan bridge           |
| `plan_vector_store_stats_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore stats와 indexed file path 정렬 계산                     |
| `planVectorStoreStatsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS VectorEntry file path snapshot과 Rust stats plan bridge          |
| `plan_vector_store_lookup_by_file_paths_json` / `plan_vector_store_lookup_by_ids_json` | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file path/id lookup index plan 계산                     |
| `planVectorStoreLookupByFilePathsRust` / `planVectorStoreLookupByIdsRust`       | function  | `src/rag/rust-core.ts`            | TS VectorEntry snapshot과 Rust lookup index plan bridge             |
| `plan_merged_retrieval_candidates` / `plan_merged_retrieval_candidates_by_entry_id` | function  | `crates/rag-wasm/src/lib.rs`      | RAG/GraphRAG 후보 entry/source score/rank 병합 plan 계산            |
| `planMergedRetrievalCandidatesRust` / `planMergedRetrievalCandidatesByEntryIdRust` | function  | `src/rag/rust-core.ts`            | TS 후보 배열과 Rust merge plan bridge                               |
| `plan_bm25_hit_lookup_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | BM25 hit score 정렬/lookup 제한 plan 계산                           |
| `planBm25HitLookupRust`                                                         | function  | `src/rag/rust-core.ts`            | TS BM25 score map과 Rust hit lookup plan bridge                     |
| `plan_bm25_source_lookups_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | BM25 stale doc id source path lookup plan 계산                      |
| `planBm25SourceLookupsRust`                                                     | function  | `src/rag/rust-core.ts`            | TS found entry id 목록과 Rust source lookup plan bridge             |
| `plan_bm25_candidate_resolution_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | BM25 id/path 조회 entry를 최종 candidate index로 해석                |
| `planBm25CandidateResolutionRust`                                               | function  | `src/rag/rust-core.ts`            | TS VectorStore lookup 결과와 Rust BM25 candidate plan bridge        |
| `plan_structural_linked_paths_json`                                             | function  | `crates/rag-wasm/src/lib.rs`      | Structural retrieval link/backlink target path plan 계산            |
| `planStructuralLinkedPathsRust`                                                 | function  | `src/rag/rust-core.ts`            | TS metadata edge 목록과 Rust structural path plan bridge            |
| `plan_structural_heading_neighbors_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | Structural retrieval heading range neighbor entry index 계산        |
| `planStructuralHeadingNeighborsRust`                                            | function  | `src/rag/rust-core.ts`            | TS heading/cache snapshot과 Rust structural neighbor plan bridge    |
| `plan_rerank_messages_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG LLM reranker message content와 truncated candidate JSON plan 계산 |
| `planRerankMessagesRust`                                                        | function  | `src/rag/rust-core.ts`            | TS reranker candidate snapshot과 Rust message plan bridge           |
| `plan_rerank_response_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG LLM reranker raw 응답 JSON 추출과 ranked id 필터링              |
| `planRerankResponseRust`                                                        | function  | `src/rag/rust-core.ts`            | TS provider 응답과 Rust rerank response plan bridge                 |
| `plan_rerank_result_order_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | RAG reranker ranked id를 최종 result index 순서로 변환              |
| `planRerankResultOrderRust`                                                     | function  | `src/rag/rust-core.ts`            | TS result id 목록과 Rust rerank order plan bridge                   |
| `select_diverse_indices`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | RAG MMR diversity selection index 계산                              |
| `selectDiverseIndicesRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query 후보와 Rust MMR selection bridge                           |
| `plan_diverse_result_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG result source/heading string key와 MMR index plan 계산          |
| `planDiverseResultIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS QueryResult snapshot과 Rust diversity index plan bridge          |
| `aggregate_graph_edges_flat`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG relation edge confidence를 무방향 endpoint pair별로 집계   |
| `aggregateGraphEdgesRust`                                                       | function  | `src/rag/rust-core.ts`            | TS entity id index 배열과 Rust edge aggregation bridge              |
| `plan_graph_edge_records_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity/relation snapshot을 edge record plan으로 변환       |
| `planGraphEdgeRecordsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS graph record snapshot과 Rust edge record planner bridge          |
| `buildEdges`                                                                    | function  | `src/graph/community-detector.ts` | GraphRAG record snapshot을 Rust edge record plan으로 연결           |
| `prune_graph_indexes_json`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG store pruning 삭제/업데이트/유지 참조 위치 plan 계산       |
| `planGraphPruneRust`                                                            | function  | `src/rag/rust-core.ts`            | TS graph snapshot과 Rust pruning/reference plan bridge              |
| `IndexedDbKnowledgeGraphStore`                                                  | class     | `src/graph/store.ts`              | Dexie graph persistence, Rust plan 적용 후 bulk mutation            |
| `InMemoryKnowledgeGraphStore`                                                   | class     | `src/graph/store.ts`              | 테스트/런타임 memory graph store, Rust plan 적용 후 Map mutation    |
| `extract_vault_links_json`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | Obsidian wikilink/Markdown link target 추출 JSON 생성               |
| `extractVaultLinksRust`                                                         | function  | `src/rag/rust-core.ts`            | 채팅 참조 확장의 Rust link extraction bridge                        |
| `plan_vault_link_candidates_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | vault link resolve 후보 path와 basename 대체키 계산                 |
| `planVaultLinkCandidatesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS source/raw target과 Rust vault link candidate plan bridge        |
| `plan_vault_link_fallback_index_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 참조 확장 basename 대체 index plan                             |
| `planVaultLinkFallbackIndexRust`                                                | function  | `src/rag/rust-core.ts`            | TS markdown basename snapshot과 Rust vault link basename 대체 bridge |
| `plan_folder_mention_file_indices_json`                                         | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 folder mention file index와 partial plan                       |
| `planFolderMentionFilesRust`                                                    | function  | `src/rag/rust-core.ts`            | TS markdown file path snapshot과 Rust folder mention bridge         |
| `plan_rag_file_type_summary_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | RAG 파일 타입 요약 count/order/추천 제외 plan 계산                  |
| `planRagFileTypeSummaryRust`                                                    | function  | `src/rag/rust-core.ts`            | TS vault file snapshot과 Rust file type summary plan bridge         |
| `plan_rag_status_json`                                                          | function  | `crates/rag-wasm/src/lib.rs`      | RAG index status 분류/count/update row 정렬 plan 계산               |
| `planRagStatusRust`                                                             | function  | `src/rag/rust-core.ts`            | TS file/index record snapshot과 Rust status summary bridge          |
| `plan_index_pending_files_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | RAG pending indexing file index/skip count plan 계산                |
| `planIndexPendingFilesRust`                                                     | function  | `src/rag/rust-core.ts`            | TS file/update path snapshot과 Rust pending selection bridge        |
| `plan_graph_rag_status_file_snapshot_json` / `plan_graph_rag_status_entry_snapshot_json` / `plan_graph_rag_status_entry_lookups_json` / `plan_graph_rag_status_json` | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status file/entry snapshot, lookup, stale/partial/ready plan 계산 |
| `planGraphRagStatusFileSnapshotRust` / `planGraphRagStatusEntrySnapshotRust` / `planGraphRagStatusEntryLookupsRust` / `planGraphRagStatusRust` | function  | `src/rag/rust-core.ts`            | TS graph/vector store snapshot과 Rust GraphRAG status bridge        |
| `plan_graph_entity_merge_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity upsert merge field plan 계산                        |
| `planGraphEntityMergeRust`                                                      | function  | `src/rag/rust-core.ts`            | TS GraphEntityRecord field snapshot과 Rust merge plan bridge        |
| `is_graph_extraction_cache_hit_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction cache key hit 판정                              |
| `isGraphExtractionCacheHitRust`                                                 | function  | `src/rag/rust-core.ts`            | TS cache key snapshot과 Rust cache hit bridge                       |
| `plan_graph_deletion_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | Graph store record key deletion index plan 계산                     |
| `planGraphDeletionIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS store record key snapshot과 Rust deletion index bridge           |
| `plan_graph_evidence_candidate_lookup_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence score/evidence/file-path lookup plan 계산         |
| `planGraphEvidenceCandidateLookupRust`                                          | function  | `src/rag/rust-core.ts`            | TS evidence score/record snapshot과 Rust candidate lookup bridge    |
| `plan_graph_evidence_entry_candidates_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence entry compatibility/dedupe/limit plan 계산        |
| `planGraphEvidenceEntryCandidatesRust`                                          | function  | `src/rag/rust-core.ts`            | TS candidate entry snapshot과 Rust entry candidate bridge           |
| `plan_graph_mention_context_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity mention context index와 표시 line plan 계산         |
| `planGraphMentionContextRust`                                                   | function  | `src/rag/rust-core.ts`            | TS entity/relation snapshot과 Rust context line selection bridge    |
| `plan_graph_claim_entity_ids_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction claim entity name/id lookup plan 계산           |
| `planGraphClaimEntityIdsRust`                                                   | function  | `src/rag/rust-core.ts`            | TS extracted claim entity names와 Rust entity id lookup bridge      |
| `plan_graph_relation_endpoint_indices_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction relation source/target endpoint index plan 계산 |
| `planGraphRelationEndpointIndicesRust`                                          | function  | `src/rag/rust-core.ts`            | TS extracted relation source/target snapshot과 Rust endpoint bridge |
| `plan_graph_extraction_type_validation_json`                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction entity/claim type membership plan 계산          |
| `planGraphExtractionTypeValidationRust`                                         | function  | `src/rag/rust-core.ts`            | TS extracted type id와 Rust schema membership validation bridge     |
| `plan_graph_community_summary_groups_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community summarizer entity/relation/claim grouping 계산   |
| `planGraphCommunitySummaryGroupsRust`                                           | function  | `src/rag/rust-core.ts`            | TS community assignment snapshot과 Rust summary grouping bridge     |
| `plan_graph_rag_markdown_file_paths_json`                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG markdown file path filtering plan 계산                     |
| `planGraphRagMarkdownFilePathsRust`                                             | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust GraphRAG markdown filtering bridge     |
| `plan_reference_file_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 참조 확장 대상 self-skip/dedupe index plan 계산                |
| `planReferenceFileIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS resolved reference path snapshot과 Rust reference selection bridge |
| `plan_source_references_json`                                                   | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 답변 출처 참조와 vault path alias plan 계산                    |
| `planSourceReferencesRust`                                                      | function  | `src/rag/rust-core.ts`            | TS 답변 문자열과 Rust source reference plan bridge                  |
| `plan_source_validation_inputs_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | 출처 검증 verified citation과 alias probe 입력 plan 계산            |
| `planSourceValidationInputsRust`                                                | function  | `src/rag/rust-core.ts`            | TS citation snapshot과 Rust source validation input bridge          |
| `plan_source_validation_warnings_json`                                          | function  | `crates/rag-wasm/src/lib.rs`      | 출처 참조/검증 citation/존재 alias를 warning key plan으로 계산      |
| `planSourceValidationWarningsRust`                                              | function  | `src/rag/rust-core.ts`            | TS reference/citation snapshot과 Rust source warning plan bridge    |
| `plan_assistant_response_classification_json`                                   | function  | `crates/rag-wasm/src/lib.rs`      | assistant 답변/질문 분류와 선택지/질문 leak plan 계산               |
| `planAssistantResponseClassificationRust`                                       | function  | `src/rag/rust-core.ts`            | TS assistant response snapshot과 Rust classification bridge         |
| `plan_chat_messages_json`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | 저장된 chat message block meta/content/reasoning parse plan 계산    |
| `planChatMessagesRust`                                                          | function  | `src/rag/rust-core.ts`            | TS markdown body와 Rust chat message parse plan bridge              |
| `plan_chat_meta_json`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | 저장된 chat list metadata title/date/count/preview plan 계산        |
| `planChatMetaRust`                                                              | function  | `src/rag/rust-core.ts`            | TS markdown content와 Rust chat metadata plan bridge                |
| `plan_chat_save_metadata_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | 저장할 chat title/created/source/provider/summary plan 계산         |
| `planChatSaveMetadataRust`                                                      | function  | `src/rag/rust-core.ts`            | TS message snapshot과 Rust chat save metadata bridge                |
| `plan_context_sources_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG context citation/block/source id/rejected count plan 계산       |
| `planContextSourcesRust`                                                        | function  | `src/rag/rust-core.ts`            | TS query result/verification snapshot과 Rust context source bridge  |
| `plan_context_budget_append_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 context budget append와 Unicode-safe truncation plan 계산      |
| `planContextBudgetAppendRust`                                                   | function  | `src/rag/rust-core.ts`            | TS context block text와 Rust budget append plan bridge              |
| `plan_context_graph_verification_json`                                          | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG virtual source verification plan 계산                      |
| `planContextGraphVerificationRust`                                              | function  | `src/rag/rust-core.ts`            | TS source path와 Rust GraphRAG verification bridge                  |
| `create_context_preview`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | context citation preview whitespace 정규화와 220자 제한 계산        |
| `createContextPreviewRust`                                                      | function  | `src/rag/rust-core.ts`            | TS text와 Rust context preview bridge                               |
| `extractVaultLinks`                                                             | function  | `src/chat/context-expansion.ts`   | Rust vault link extraction wrapper                                  |
| `is_excluded_path`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG exclude path pattern matching                                   |
| `isExcludedPathRust`                                                            | function  | `src/rag/rust-core.ts`            | Rust exclude path matcher bridge                                    |
| `isExcludedPath`                                                                | function  | `src/utils/vault.ts`              | Rust vault exclude path matching wrapper                            |
| `normalize_entity_name`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity 이름 정규화                                         |
| `normalize_graph_name`                                                          | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction 이름 정규화                                     |
| `normalize_graph_confidence_or_default`                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction confidence clamp/default 계산                   |
| `sanitize_graph_id_part` / `create_graph_id`                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction record ID part 정규화와 ID 생성                 |
| `normalizeGraphNameRust` / `normalizeGraphConfidenceRust` / `createGraphIdRust` | function  | `src/rag/rust-core.ts`            | Graph extraction 정규화 Rust bridge                                 |
| `extract_json_object_text`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM 응답에서 JSON object 텍스트 추출                       |
| `extractJsonObjectRust`                                                         | function  | `src/rag/rust-core.ts`            | Graph extraction JSON object extraction bridge                      |
| `normalize_extracted_graph_payload_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM 추출 JSON payload schema 정규화                        |
| `normalizeExtractedGraphPayloadRust`                                            | function  | `src/rag/rust-core.ts`            | Graph extraction payload normalization bridge                       |
| `parse_extracted_graph_payload_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM raw 응답 parse, schema 정규화, reject 판정             |
| `parseExtractedGraphPayloadRust`                                                | function  | `src/rag/rust-core.ts`            | Graph extraction raw response parse plan bridge                     |
| `validate_ontology_relation`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | Ontology relation type/source/target domain-range 검증              |
| `validateOntologyRelationRust`                                                  | function  | `src/rag/rust-core.ts`            | Ontology relation validation bridge                                 |
| `score_entity_match_or_nan`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity merge score 계산                                    |
| `create_entity_id`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity id 생성                                             |
| `plan_entity_resolution_json`                                                   | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity resolution status/best match JSON plan 계산         |
| `scoreEntityMatchRust`                                                          | function  | `src/rag/rust-core.ts`            | TS entity resolver와 Rust merge score bridge                        |
| `createEntityIdRust` / `planEntityResolutionRust`                               | function  | `src/rag/rust-core.ts`            | TS entity resolver와 Rust id/resolution plan bridge                 |
| `EntityResolver`                                                                | class     | `src/graph/entity-resolver.ts`    | GraphRAG entity score snapshot, Rust resolution plan, pending merge 저장 |
| `find_mentioned_entity_matches`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG 질문 entity mention index/score 계산                       |
| `findMentionedEntityMatchesRust`                                                | function  | `src/rag/rust-core.ts`            | TS entity record와 Rust mention match bridge                        |
| `plan_graph_query_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG deterministic query plan JSON 생성                         |
| `planGraphQueryRust`                                                            | function  | `src/rag/rust-core.ts`            | TS query planner와 Rust deterministic planner bridge                |
| `detect_communities_flat`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community assignment와 modularity 계산                     |
| `detectCommunitiesRust`                                                         | function  | `src/rag/rust-core.ts`            | numeric graph edge 배열과 Rust community detection bridge           |
| `detect_communities_from_edges_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG string edge snapshot의 community assignment JSON plan 계산 |
| `detectCommunitiesFromEdgesRust`                                                | function  | `src/rag/rust-core.ts`            | TS CommunityEdge snapshot과 Rust community detection bridge         |
| `detectCommunities`                                                             | function  | `src/graph/community-detector.ts` | GraphRAG edge 문자열 매핑과 Rust 우선 community detection           |
| `score_local_evidence_pairs`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG local/evidence-first traversal evidence score 계산         |
| `scoreLocalEvidenceRust`                                                        | function  | `src/rag/rust-core.ts`            | numeric entity/relation/claim graph와 Rust evidence score bridge    |
| `plan_local_evidence_scores_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG record snapshot의 local evidence score/id plan 계산        |
| `planLocalEvidenceScoresRust`                                                   | function  | `src/rag/rust-core.ts`            | TS GraphRAG record snapshot과 Rust local evidence score bridge      |
| `chunk_markdown_json`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | Markdown RAG chunk를 JSON으로 생성                                  |
| `chunkMarkdownRust`                                                             | function  | `src/rag/rust-core.ts`            | 내장 WASM Markdown chunk bridge                                     |
| `chunk_plain_text_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | plain text/code RAG chunk를 JSON으로 생성                           |
| `chunkPlainTextRust`                                                            | function  | `src/rag/rust-core.ts`            | 내장 WASM plain text/code chunk bridge                              |
