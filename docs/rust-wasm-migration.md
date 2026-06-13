# Rust/WASM 코어 전환 계획

## 결정

- 프로젝트는 무료 오픈소스 플러그인을 기본 전제로 유지한다. 기능 잠금, 유료 API 중계, 사용자 데이터 기반 수익화는 목표로 두지 않는다.
- JavaScript/TypeScript는 Obsidian UI, DOM, 플러그인 생명주기, vault I/O, provider 네트워크 transport, MCP stdio transport, WASM bridge wrapper만 담당한다.
- 실질 기능의 결정적 로직은 Rust/WASM으로 옮긴다. 새 기능은 먼저 Rust/WASM API와 wire format을 설계한 뒤 TS/JS wrapper를 붙인다.

## 운영 원칙

- JS/TS는 UI/호스트 경계와 Rust bridge wrapper만 유지한다. 아래 영역은 TS에 남길 수 있다.
  - Obsidian API 호출, 노트 I/O, MCP 프로세스 실행, provider 네트워크 요청/응답 파싱
  - 사용자 설정 읽기/저장, 모델 목록/설정 검증, 에러 노출, 공지문.
- 새 실질 기능은 Rust/WASM 구현 없이는 추가하지 않는다. 임시 JS 계산 경로를 만들지 않는다.
- Rust 이전은 `rust-core` 경계로 들어가는 wire format을 먼저 정하고, 테스트 가능한 순수 계산을 `crates/rag-wasm`에서 먼저 고정한 뒤 TS는 조립, ID 매핑, I/O만 수행한다.
- JS/TS에서 순수 계산 로직이 발견되면 유지하지 않고 Rust/WASM 이전 대상으로 즉시 정리한다.

## Rust로 옮길 대상

1. RAG 콘텐츠 해시, 토큰화, 청킹, BM25 인덱스 생성
2. 벡터 검색 전처리, cosine/dot-product score 계산, top-k 선택
3. GraphRAG 노드/엣지 정규화, ranking, community/layout용 계산
4. 대용량 채팅/출처 metadata 직렬화 검증과 diff 계산
5. 설정/프로필 JSON schema 검증 중 순수 계산으로 분리 가능한 부분

## JavaScript에 남길 대상

1. Obsidian API 접근: `vault`, `metadataCache`, `workspace`, `PluginSettingTab`
2. DOM 렌더링, Notice, Modal, ItemView, CSS class 토글
3. LLM provider fetch/stream 파싱과 API key 보관 경계
4. MCP process/stdin/stdout 관리
5. IndexedDB/Dexie, vault adapter 파일 읽기/쓰기처럼 host 권한이 필요한 I/O

## 현재 첫 slice

- `crates/rag-wasm`를 추가했다.
- UTF-16 FNV-1a 해시를 Rust에 구현했다.
- BM25 토크나이저의 ASCII compound/camel-case, 한국어+숫자 n-gram 동작을 Rust에 구현했다.
- Rust 단위 테스트가 검색 계약을 고정한다.

## 현재 두 번째 slice

- `wasm-bindgen` web glue와 `.wasm` bytes를 생성해 `main.js`에 포함하는 빌드 경로를 추가했다.
- `src/rag/rust-core.ts`가 embedded WASM을 `initSync(bytes)`로 초기화하고 결과를 검증한다.
- `createContentHash()`, BM25 `tokenize()`, RAG vector top-k scoring, query cosine scoring은 Rust/WASM 단독 계산 경로를 사용한다. TS wrapper는 Rust 결과가 없으면 빈 결과나 `null`을 호출 계약에 맞게 전달한다.
- `npm run build`와 `npm run dev`는 `npm run wasm:build`를 먼저 실행한다.
- `npm run rust:security`는 generated WASM glue/base64 파일이 최신인지 검사한다.

## 현재 세 번째 slice

- Markdown RAG chunking을 Rust/WASM에 추가했다.
- `chunkMarkdown()`은 Rust/WASM 단독 청킹 경로를 사용한다. TS wrapper는 Rust 결과가 없으면 빈 청크 배열을 반환한다.

## 현재 네 번째 slice

- plain text/code RAG chunking을 Rust/WASM에 추가했다.
- `chunkPlainText()`는 Rust/WASM 단독 청킹 경로를 사용한다. TS wrapper는 Rust 결과가 없으면 빈 청크 배열을 반환한다.
- RAG chunking 계열 중 파일 확장자 분기와 vault I/O는 TypeScript에 남고, 실제 chunk 계산은 Rust/WASM 경로를 먼저 탄다.

## 현재 다섯 번째 slice

- BM25 검색 scoring을 Rust/WASM에 추가했다.
- `JsonFileBM25Index.search()`는 JSON 저장 구조와 vault persistence를 유지하면서 posting list를 typed array로 변환하고, IDF/TF score 누적 계산은 Rust/WASM에만 맡긴다.
- Rust/WASM 결과가 없으면 검색 score map은 비어 있다.
- BM25 인덱스 파일 생성/삭제/rename 흐름은 과거 churn 방지 계약 때문에 TypeScript vault I/O 경계에 그대로 둔다.

## 현재 여섯 번째 slice

- BM25 문서 term frequency 계산을 Rust/WASM에 추가했다.
- `JsonFileBM25Index.addDocument()`는 텍스트에서 token frequency map과 총 token 수를 Rust/WASM으로만 만든다.
- inverted index 객체 mutation, doc source bookkeeping, 평균 문서 길이 갱신, vault persistence는 TypeScript 경계에 남긴다.
- Rust/WASM 결과가 없으면 해당 문서 추가를 건너뛴다.

## 현재 일곱 번째 slice

- RAG query ranking의 RRF score와 hybrid result score 계산을 Rust/WASM에 추가했다.
- `RAGQueryEngine.query()`는 후보의 source rank fusion과 graph/evidence-aware hybrid score를 Rust/WASM으로만 만든다.
- source 문자열 분류와 후보 객체 조립, threshold/filter, reranker provider 호출은 TypeScript 경계에 남긴다. reranker 응답 JSON 추출/허용 id 필터링/최종 순서 plan은 Rust/WASM이 담당한다.
- Rust/WASM score가 없으면 해당 후보 score는 0으로 축소된다.

## 현재 여덟 번째 slice

- RAG query result의 MMR diversity selection을 Rust/WASM에 추가했다.
- `selectDiverseResults()`는 topK 후보 index 선택을 Rust/WASM에 맡기고, 반환 index를 `QueryResult` 객체에 다시 매핑한다.
- `sourcePath`와 heading 문자열을 숫자 key로 바꾸는 작업, 후보 객체 조립은 TypeScript 경계에 남긴다.
- Rust/WASM index 결과가 없으면 diverse selection 결과는 비어 있다.

## 현재 아홉 번째 slice

- GraphRAG community detection의 반복 assignment 계산과 modularity 계산을 Rust/WASM에 추가했다.
- `detectCommunities()`는 entity id를 안정적으로 정렬해 numeric node index로 매핑하고, edge index/weight 배열을 Rust/WASM에 넘긴다.
- entity/relation record 접근, relation confidence를 edge로 합치는 `buildEdges()`, community summarizer/LLM 호출, graph store persistence는 TypeScript 경계에 남긴다.
- Rust/WASM assignment 결과가 없으면 community 결과는 비어 있다.

## 현재 열 번째 slice

- GraphRAG local/evidence-first retrieval의 evidence score traversal을 Rust/WASM에 추가했다.
- `collectLocalEvidenceScores()`는 mentioned entity, relation, claim, evidence id를 numeric index 배열로 바꾼 뒤 Rust/WASM에 먼저 맡긴다.
- entity/relation/claim/evidence record 조회, ontology filtering, ID 문자열 매핑, vector store 후보 조립과 compatibility filter는 TypeScript 경계에 남긴다.
- Rust/WASM evidence score 결과가 없으면 local evidence 결과는 비어 있다.

## 현재 열한 번째 slice

- GraphRAG global community summary ranking을 기존 Rust/WASM vector top-k bridge에 연결했다.
- `queryGlobal()`은 schema filtering과 community 객체 조립은 TypeScript에서 유지하고, summary vector cosine ranking과 topK 선택은 `rankTopKPairsRust()`를 우선 사용한다.
- Rust/WASM ranking 결과가 없으면 global community 후보는 비어 있다.

## 현재 열두 번째 slice

- GraphRAG relation edge aggregation을 Rust/WASM에 추가했다.
- `buildEdges()`는 entity/relation record 접근, unknown endpoint filtering, lexicographic entity id mapping은 TypeScript에서 유지하고, 무방향 endpoint pair별 confidence 합산은 `aggregateGraphEdgesRust()`를 우선 사용한다.
- Rust/WASM에는 numeric source/target/confidence 배열만 넘긴다. Rust는 `[sourceIndex, targetIndex, weight]` flat triple을 첫 출현 순서대로 반환한다.
- Rust/WASM edge triple 결과가 없으면 edge 목록은 비어 있다.

## 현재 열세 번째 slice

- 채팅 context expansion의 vault link extraction을 Rust/WASM에 추가했다.
- `extractVaultLinks()`는 Obsidian host I/O 없이 content 문자열만 파싱하므로 `extractVaultLinksRust()`를 우선 사용한다.
- Rust/WASM은 wikilink, embed wikilink, Markdown link target 추출, alias/heading/block 제거, percent decoding, 외부 URL 제외, case-insensitive dedupe를 담당한다.
- `expandReferencedVaultFiles()`의 `TFile` resolve, `metadataCache`, `vault.cachedRead`, warning 생성은 TypeScript 경계에 남긴다.
- Rust/WASM link 결과가 없으면 참조 링크 목록은 비어 있다.

## 현재 열네 번째 slice

- RAG vault file filtering의 exclude path matching을 Rust/WASM에 추가했다.
- `isExcludedPath()`는 path normalization, folder segment matching, `**/`/`/**`, glob-like `*`, extension shorthand matching을 `isExcludedPathRust()`에 먼저 맡긴다.
- `getRagCandidateFiles()`, `getRagFileTypeSummary()`, `getMarkdownFilesFiltered()`는 Obsidian `Vault` file enumeration과 text-readability check를 TypeScript에 유지하고, path/pattern matching만 Rust/WASM 경로를 우선 사용한다.
- Rust/WASM matcher 결과가 없으면 제외되지 않은 것으로 처리한다.

## 현재 열다섯 번째 slice

- GraphRAG entity resolver의 이름 정규화와 merge score 계산을 Rust/WASM에 추가했다.
- `normalizeEntityName()`은 `normalizeEntityNameRust()` 결과만 사용한다.
- `scoreEntityMatch()`는 canonical/alias/description/evidence/type/embedding score를 Rust/WASM에 넘겨 exact alias match, token overlap, alias containment, description Jaccard, shared evidence, semantic boost 계산을 `scoreEntityMatchRust()`에 먼저 맡긴다.
- embedding provider 호출, ontology schema filtering, best match 선택, pending merge 저장은 TypeScript 경계에 남긴다.
- Rust/WASM score 결과가 없으면 merge score는 0이다.

## 현재 열여섯 번째 slice

- 채팅 mention 후보 추출을 Rust/WASM에 추가했다.
- `parseMentions()`는 raw mention 후보 추출과 case-insensitive dedupe를 `parseMentionCandidatesRust()`에 먼저 맡긴 뒤, server/file/folder/entity 판정만 TypeScript `MentionResolver`에서 수행한다.
- Rust/WASM은 `@[path with spaces.md]`, `@server`, `@file.md`, `@entity:name` 후보 추출과 bracket-first/word-second 순서를 기존 TypeScript regex 계약과 같게 보존한다.
- Obsidian `Vault` file/folder resolve, MCP server lookup, KnowledgeGraph entity lookup은 host state 접근이므로 TypeScript 경계에 남긴다.
- Rust/WASM mention 후보 결과가 없으면 mention 목록은 비어 있다.

## 현재 열일곱 번째 slice

- ANN vector retrieval의 IVF index build 계산을 Rust/WASM에 추가했다.
- `assignClusters()`는 entry vector row와 centroid matrix를 `assignVectorClustersRust()`에 넘겨 nearest centroid assignment를 먼저 계산한다.
- `recomputeCentroids()`는 cluster별 vector 평균과 empty cluster의 previous centroid 보존을 `recomputeCentroidsRust()`에 먼저 맡긴다.
- `IvfVectorIndex.query()`는 centroid probe ranking도 기존 `rankTopKPairsRust()`를 사용한다.
- `VectorEntry` 객체 보관, vector store I/O, provider timeout/diagnostic, candidate object assembly는 TypeScript 경계에 남긴다.
- Rust/WASM assignment/recompute/probe 결과가 없으면 ANN 후보는 비어 있다.

## 현재 열여덟 번째 slice

- GraphRAG store pruning diff 계산을 Rust/WASM에 추가했다.
- `pruneByFilePaths()`는 graph snapshot을 numeric index/wire string 입력으로 바꾼 뒤 `planGraphPruneRust()`를 우선 호출한다.
- Rust/WASM은 삭제할 evidence/entity/relation/claim/community/rejected fact/extraction cache/pending merge index와 업데이트할 entity/relation/claim index를 계산한다.
- `IndexedDbKnowledgeGraphStore`와 `InMemoryKnowledgeGraphStore`의 Dexie/Map mutation, record copy, ID 문자열 필터링 적용은 TypeScript 경계에 남긴다.
- Rust/WASM pruning plan 결과가 없으면 pruning diff는 0건으로 처리한다.

## 현재 열아홉 번째 slice

- RAG query의 retrieval source 분석과 최종 relevance 판단을 Rust/WASM에 추가했다.
- `analyzeRetrievalSourcesRust()`는 provider별 source score/rank map을 numeric source code 배열로 바꿔 Rust에 넘기고, source prior, evidence score, best evidence rank, graph/structural evidence flag를 받는다.
- `isRelevantResultRust()`는 combined score, vector score, BM25 score, keyword match, threshold, BM25 활성 여부, graph/evidence source 정보를 Rust에 넘겨 최종 context 후보 유지 여부를 판단한다.
- `RAGQueryEngine.query()`는 후보 객체 조립, embedding provider 호출, retrieval provider orchestration, reranker 호출만 TypeScript 경계에 유지한다.
- Rust/WASM relevance 결과가 없으면 해당 후보는 최종 context 후보에서 제외된다.

## 현재 스무 번째 slice

- ANN vector retrieval의 초기 IVF centroid 선택을 Rust/WASM에 추가했다.
- `buildInitialCentroidsRust()`는 TS vector matrix를 flattened WASM 입력으로 바꾸고, Rust의 `build_initial_centroids()`가 실제 cluster 수 결정과 균등 간격 centroid 샘플링을 담당한다.
- `IvfVectorIndex.build()`는 vector entry 객체 보관, abort signal 확인, index object 조립만 TypeScript 경계에 유지한다.
- Rust/WASM 초기 centroid 결과가 없으면 ANN index는 비어 있는 index가 되고 후보를 반환하지 않는다.

## 현재 스물한 번째 slice

- GraphRAG query의 entity mention matching을 Rust/WASM에 추가했다.
- `findMentionedEntityMatchesRust()`는 entity schema/canonical name/alias/hint를 wire string으로 바꾸고, Rust의 `find_mentioned_entity_matches()`가 질문 정규화, planner hint match, 한국어 조사 경계 처리, 짧은 이름 오탐 방지, score 정렬을 담당한다.
- `GraphRagQueryEngine`은 graph store에서 entity record를 읽고 Rust가 반환한 index/score를 `GraphEntityRecord`로 다시 연결하는 wrapper 역할만 한다.
- Rust/WASM mention match 결과가 없으면 local GraphRAG 후보는 생성되지 않는다.

## 현재 스물두 번째 slice

- GraphRAG deterministic query planner를 Rust/WASM에 추가했다.
- `planGraphQueryRust()`는 질문 문자열을 Rust의 `plan_graph_query_json()`에 넘기고, Rust가 source-seeking/thematic/relational/comparative/factual/ordinary-rag query mode와 Latin entity hint를 계산한다.
- LLM planner 호출과 timeout은 네트워크/provider I/O 경계라 TypeScript에 유지한다. provider 응답 JSON 추출과 plan field 정규화는 후속 slice에서 Rust/WASM으로 이동했다.
- Rust/WASM planner 결과가 없으면 deterministic planner는 `ordinary-rag`/`none` 계획을 반환한다.

## 현재 스물세 번째 slice

- RAG query의 최종 후보 정렬, best score 기준 relative threshold, graph/structural source-aware relevance window 선택을 Rust/WASM에 추가했다.
- `selectRelevantResultIndicesRust()`는 `QueryResult` 후보의 score/vector/BM25/keyword/source evidence 값을 typed array와 source code offset 배열로 바꿔 Rust의 `select_relevant_result_indices()`에 넘긴다.
- `RAGQueryEngine.query()`는 embedding provider 호출, retrieval pipeline orchestration, 후보 객체 조립, reranker 호출만 TypeScript 경계에 유지한다.
- Rust/WASM relevance window 결과가 없으면 최종 context 후보는 비어 있다.

## 현재 스물네 번째 slice

- retrieval pipeline의 provider 후보 병합 plan을 Rust/WASM에 추가했다.
- `planMergedRetrievalCandidatesRust()`는 후보의 entry index, source code, source score, rank를 typed array로 바꾸고, Rust의 `plan_merged_retrieval_candidates()`가 entry 첫 등장 순서, source 첫 등장 순서, 같은 source의 score/rank merge, candidate index group을 계산한다.
- `RagRetrievalPipeline`은 provider 실행, timeout/diagnostic, `VectorEntry` 객체 연결, reason 문자열 dedupe만 TypeScript 경계에 유지한다.
- Rust/WASM merge plan 결과가 없으면 retrieval 후보 병합 결과는 비어 있다.

## 현재 스물다섯 번째 slice

- ANN recall@k metric 계산을 Rust/WASM에 추가했다.
- `calculateRecallAtKRust()`는 exact/approximate string id 목록을 numeric index 배열로 포장하고, Rust의 `recall_at_k()`가 exact top-k unique set, approximate top-k hit count, denominator 계산을 담당한다.
- `calculateRecallAtK()`는 TypeScript에서 metric 공식을 갖지 않고 Rust 결과를 반환하는 wrapper로 축소됐다.
- Rust/WASM recall 결과가 없으면 recall은 0으로 처리한다.

## 현재 스물여섯 번째 slice

- GraphRAG extraction record 정규화 계산을 Rust/WASM에 추가했다.
- `normalizeGraphNameRust()`, `normalizeGraphConfidenceRust()`, `createGraphIdRust()`는 이름 정규화, confidence clamp/default, record ID sanitizer/join을 Rust의 `normalize_graph_name()`, `normalize_graph_confidence_or_default()`, `create_graph_id()`에 위임한다.
- `GraphExtractionIndexer`는 LLM JSON 파싱, ontology validation, store mutation, evidence/rejected fact object assembly만 TypeScript 경계에 유지한다.
- Rust/WASM 정규화 결과가 없으면 name/id는 빈 문자열, confidence는 기존 기본값 `0.5`로 축소된다.

## 현재 스물일곱 번째 slice

- GraphRAG extraction의 LLM 응답 JSON object extraction을 Rust/WASM에 추가했다.
- `extractJsonObjectRust()`는 raw provider 응답 문자열을 Rust의 `extract_json_object_text()`에 넘기고, Rust가 bare JSON, `json` fenced block, 앞뒤 설명이 붙은 inline JSON object 절단을 담당한다.
- 이후 parse-plan slice에서 runtime parse 경로는 raw provider 응답 전체를 Rust/WASM에 넘기도록 합쳐졌다.
- Rust/WASM extraction 결과가 없으면 invalid-json reject 경로로 간다.

## 현재 스물여덟 번째 slice

- GraphRAG extraction payload schema normalization을 Rust/WASM에 추가했다.
- `normalizeExtractedGraphPayloadRust()`는 추출된 JSON object 문자열을 Rust의 `normalize_extracted_graph_payload_json()`에 넘기고, Rust가 `entities`/`relations`/`claims` array 또는 keyed object, top-level inferred entity, 대체 필드명, string trim, string-array coercion, claim entity dedupe, `rawFactCount` 계산을 담당한다.
- `normalizeExtractedGraphPayloadRust()`는 단독 bridge 검증용으로 남고, runtime `parseExtractedGraphPayload()`는 다음 slice의 raw response parse plan을 사용한다.
- JSON parser는 수동 문자열 파서가 아니라 `serde_json` + `preserve_order`를 사용한다. keyed object 입력에서 기존 JavaScript insertion order 계약을 유지하기 위해 `indexmap` 계열 transitive dependency를 cargo-vet exemption과 함께 명시했다.
- Rust/WASM normalization 결과가 없으면 schema-shape-mismatch reject 경로로 간다.

## 현재 스물아홉 번째 slice

- GraphRAG extraction raw response parse plan을 Rust/WASM에 추가했다.
- `parseExtractedGraphPayloadRust()`는 provider raw 응답 문자열을 Rust의 `parse_extracted_graph_payload_json()`에 넘기고, Rust가 JSON object extraction, `serde_json` parse, payload schema normalization, raw 후보가 있지만 유효 fact가 0개인 경우의 `schema-shape-mismatch` 판정까지 담당한다.
- TypeScript `parseExtractedGraphPayload()`는 Rust parse result를 graph store 경계에 연결하고, WASM bridge 장애만 `extraction-error` rejected fact로 남기는 wrapper 역할만 한다.
- invalid JSON은 raw provider 응답 문자열을 `rawFact`로 보존하고, schema shape mismatch는 parsed JSON object를 `rawFact`로 보존해 rejected facts UI의 디버깅 정보를 유지한다.

## 현재 서른 번째 slice

- Ontology relation domain/range validation을 Rust/WASM에 추가했다.
- `validateOntologyRelationRust()`는 schema의 entity type id 목록, relation type id 목록, source/target type row를 wire format으로 포장해 Rust의 `validate_ontology_relation()`에 넘긴다.
- Rust가 relation type lookup, source/target entity type 존재 여부, `any` wildcard, domain/range mismatch reason을 판정한다.
- TypeScript `validateOntologyRelation()`은 public schema API를 유지하되 Rust validation result를 반환하는 wrapper 역할만 한다. bridge 장애는 fail-closed로 `unknown-relation-type`을 반환한다.

## 현재 서른한 번째 slice

- BM25 provider hit lookup, stale document id repair, final candidate resolution plan을 Rust/WASM에 추가했다.
- `planBm25HitLookupRust()`는 BM25 score map을 score 순서로 제한하고 lookup doc id 목록과 top-hit max score를 계산한다.
- `planBm25SourceLookupsRust()`는 id lookup에서 발견되지 않은 hit만 source file path lookup 대상으로 dedupe한다.
- `planBm25CandidateResolutionRust()`는 id lookup entry와 file-path lookup entry의 compatibility boolean을 받아 최종 candidate entry index와 source score를 계산한다.
- `BM25CandidateProvider`는 `JsonFileBM25Index.search()` 호출, `VectorStore` id/path 조회, Rust plan index를 `VectorEntry`로 복원하는 wrapper 역할만 한다.
- stale BM25 doc id가 남아 있어도 source file path의 현재 vector entry로 복구한다. Rust/WASM plan 결과가 없으면 BM25 후보는 비어 있다.

## 현재 서른두 번째 slice

- structural retrieval의 linked path plan과 heading-neighbor entry selection을 Rust/WASM에 추가했다.
- `planStructuralLinkedPathsRust()`는 seed file path 목록과 resolved/cache link edge 목록을 받아 outgoing link, backlink, cache-resolved target path를 순서 보존 dedupe로 계산한다.
- `planStructuralHeadingNeighborsRust()`는 seed entry, 같은 파일 entry, Obsidian heading cache row를 받아 heading level 기반 range, seed heading label gate, compatible flag, seed id 제외를 계산하고 최종 entry index를 반환한다.
- `StructuralGraphCandidateProvider`는 Obsidian metadata/cache link resolution, `VectorStore` file-path lookup, Rust plan index를 `VectorEntry`로 복원하는 wrapper 역할만 한다.
- Rust/WASM structural plan 결과가 없으면 해당 structural 후보는 비어 있다.

## 현재 서른세 번째 slice

- RAG LLM reranker의 raw 응답 JSON 추출, 허용 id 필터링, 중복 제거, 최종 result order plan을 Rust/WASM에 추가했다.
- `planRerankResponseRust()`는 provider raw 응답과 candidate id 목록을 Rust의 `plan_rerank_response_json()`에 넘기고, Rust가 bare JSON/fenced JSON/inline JSON object extraction, `rankedIds` string 필터링, 허용 id gate, 순서 보존 dedupe를 담당한다.
- `planRerankResultOrderRust()`는 전체 result id와 ranked id를 Rust의 `plan_rerank_result_order_json()`에 넘기고, Rust가 ranked id 우선 순서와 나머지 후보의 원래 순서 append를 index plan으로 계산한다.
- `LLMRAGResultReranker`는 prompt 구성, provider 호출, timeout/abort만 TypeScript 경계에 유지하고 Rust parse plan을 반환하는 wrapper 역할만 한다.
- `RAGQueryEngine.rerankResults()`는 Rust order index를 `QueryResult` 객체로 복원하는 wrapper 역할만 한다. Rust/WASM order plan 결과가 없으면 기존 순서를 유지한다.

## 현재 서른네 번째 slice

- GraphRAG LLM query planner의 raw 응답 JSON 추출, field validation/default, traversal depth 정규화, entity hint 필터링, invalid response fallback plan을 Rust/WASM에 추가했다.
- `planGraphQueryResponseRust()`는 provider raw 응답과 fallback question을 Rust의 `plan_graph_query_response_json()`에 넘기고, Rust가 bare JSON/fenced JSON/inline JSON object extraction과 `type`/`queryMode`/`traversalDepth`/`evidenceFirst`/`entityHints` 정규화를 담당한다.
- invalid provider 응답은 Rust의 deterministic `plan_graph_query_json()` fallback을 사용해 기존 질문 기반 planner 계약을 유지한다.
- `LLMGraphQueryPlanner`는 prompt 구성, provider 호출, timeout만 TypeScript 경계에 유지하고 Rust plan을 `GraphQueryPlan` 객체로 연결하는 wrapper 역할만 한다.
- 런타임 `GraphRAG` 코드에는 `parsePlannerResponse()`/`parseJsonObject()` TypeScript helper를 두지 않는다.

## 현재 서른다섯 번째 slice

- GraphRAG evidence-first 경로에서 entity mention이 없을 때 claim confidence를 evidence score로 바꾸고, evidence score를 max-score/first-seen tie 순서로 병합/정렬하는 plan을 Rust/WASM에 추가했다.
- `planClaimEvidenceScoresRust()`는 claim confidence와 evidence id 목록을 Rust의 `plan_claim_evidence_scores_json()`에 넘기고, Rust가 `confidence * 0.75` 계산, `[0, 1]` clamp, 빈 evidence id 제거를 담당한다.
- `planEvidenceCandidateOrderRust()`는 raw evidence score 목록과 store에 존재하는 evidence id 목록을 Rust의 `plan_evidence_candidate_order_json()`에 넘기고, Rust가 unavailable evidence 제거, 같은 evidence id의 max score 병합, score desc와 first-seen tie order를 계산한다.
- `GraphRagQueryEngine.queryEvidenceFirst()`는 Graph store claim/evidence 조회와 VectorStore entry 연결만 TypeScript 경계에 유지한다.
- 런타임 `GraphRAG` 코드에는 mention 없는 evidence-first용 `claim.evidenceIds.map(...)` 점수 계산과 `mergeEvidenceScores()` TypeScript helper를 두지 않는다.

## 현재 서른여섯 번째 slice

- GraphRAG hybrid query의 local/global 후보 병합을 기존 Rust/WASM retrieval merge plan으로 연결했다.
- `mergeGraphCandidatesWithRust()`는 후보 entry id를 numeric index로 포장하고 `planMergedRetrievalCandidatesRust()`에 넘긴 뒤, Rust가 계산한 first-candidate index 순서만 `RetrievalCandidate` 객체로 복원한다.
- local evidence와 global community가 같은 entry id를 가리키면 Rust plan의 첫 등장 후보를 유지하고, `candidateLimit` 적용은 Rust plan 순서를 기준으로 한다.
- `GraphRagQueryEngine`에는 `function mergeCandidates` 형태의 TypeScript dedupe loop를 두지 않는다.

## 현재 서른일곱 번째 slice

- VectorStore file index record grouping과 complete metadata 판정을 Rust/WASM에 추가했다.
- `planFileIndexRecordsRust()`는 vector entry metadata snapshot을 Rust의 `plan_file_index_records_json()`에 넘기고, Rust가 file path 첫 등장 순서 grouping, vector count, complete metadata 여부, complete일 때 첫 entry metadata 복사, IndexedDB rebuild용 entry-level updated max 계산을 담당한다.
- `IndexedDbVectorStore`, `JsonFileVectorStore`, `MemoryVectorStore`는 store I/O와 `VectorEntry` 복사만 TypeScript 경계에 유지하고, file index record 생성 판단은 Rust plan 결과를 복원한다.
- 런타임 `VectorStore` 코드에는 `createFileIndexRecordsFromEntries()`/`createFileIndexRecord()` TypeScript metadata 계산 helper를 두지 않는다.

## 현재 서른여덟 번째 slice

- 채팅 참조 확장의 vault link resolve 후보 path 생성과 basename 대체키 계산을 Rust/WASM에 추가했다.
- `planVaultLinkCandidatesRust()`는 source file path와 raw link target을 Rust의 `plan_vault_link_candidates_json()`에 넘기고, Rust가 `.`/`..` path segment 정규화, Markdown 확장자 보강, source folder 기준 상대 경로 candidate, basename 대체키를 계산한다.
- `expandReferencedVaultFiles()`는 Obsidian `metadataCache`, `vault.getAbstractFileByPath`, `vault.cachedRead`, warning 생성만 TypeScript 경계에 유지한다.
- 런타임 `context-expansion.ts`에는 `createPathCandidates()`/`normalizeVaultPath()`/`ensureMarkdownExtension()`/`stripMarkdownExtension()` TypeScript helper를 두지 않는다.

## 현재 서른아홉 번째 slice

- RAG 파일 타입 요약의 확장자 key 정규화, target/recommendation count 집계, protected document extension 제외, 정렬, total 계산을 Rust/WASM에 추가했다.
- `planRagFileTypeSummaryRust()`는 TS가 vault 순회와 `cachedRead` 기반 indexable 판단을 마친 file snapshot을 Rust의 `plan_rag_file_type_summary_json()`에 넘긴다.
- Rust는 file path/extension에서 extension key를 만들고, `(none)` label은 TS가 넘긴 i18n 문자열을 사용하며, count 내림차순과 no-extension 우선 tie rule을 적용한다.
- `getRagFileTypeSummary()`는 Obsidian vault I/O, exclude path/ext 적용, indexable 판단, reason 문자열 선택만 TypeScript 경계에 유지한다.
- 런타임 `utils/vault.ts`에는 `toSortedFileTypeCounts()`/`getExtensionLabel()` TypeScript summary 정렬 helper를 두지 않는다.

## 현재 마흔 번째 slice

- 채팅 답변 출처 검증의 wikilink/Markdown link/source id 추출, vault path alias 생성, warning key dedupe를 Rust/WASM에 추가했다.
- `planSourceReferencesRust()`는 assistant 답변 문자열을 Rust의 `plan_source_references_json()`에 넘기고, Rust가 `[[...]]`, `[label](target.md#heading)`, `Source rag-1` 형태를 reference plan으로 만든다.
- `planSourceValidationInputsRust()`는 citation id/path/status snapshot과 reference plan을 Rust의 `plan_source_validation_inputs_json()`에 넘기고, Rust가 verified citation id/path와 vault alias probe 후보를 만든다.
- `planSourceValidationWarningsRust()`는 reference plan, verified citation id/path, TS host resolver가 확인한 existing alias 목록을 Rust의 `plan_source_validation_warnings_json()`에 넘기고, Rust가 missing-link/unverified-source warning key와 label을 계산한다.
- `validateAnswerSources()`는 Obsidian vault 존재 확인과 i18n detail 문자열 부착만 TypeScript 경계에 유지한다.
- 런타임 `source-validation.ts`에는 `extractSourceReferences()`/`pathAliases()`/`addWarning()` TypeScript parsing/dedupe helper와 verified citation filter/alias 수집 helper를 두지 않는다.

## 현재 마흔한 번째 slice

- assistant 응답의 답변/질문 분류, 선택지 추출, prompt 추출, reasoning leak 질문 추출, structured answer gate를 Rust/WASM에 추가했다.
- `planAssistantResponseClassificationRust()`는 content/reasoning snapshot을 Rust의 `plan_assistant_response_classification_json()`에 넘기고, Rust가 answer/question classification JSON을 만든다.
- Rust는 단일/다중 선택 신호, bullet/number/alphabet choice marker, follow-up suggestion 제외, Markdown heading/table/code answer gate를 계산한다.
- `classifyAssistantResponse()`는 Rust plan을 호출하고 결과 객체를 반환하는 wrapper 역할만 한다.
- 런타임 `assistant-response-classifier.ts`에는 `detectQuestion()`/`extractChoices()`/`extractPrompt()`/`extractLastQuestionBlock()` TypeScript parsing helper를 두지 않는다.

## 현재 마흔두 번째 slice

- 저장된 current-format 채팅 세션 로드의 message comment scan, message meta JSON 기본값 처리, named block 추출, base64 decode, 빈 content의 reasoning 대체를 Rust/WASM에 추가했다.
- `planChatMessagesRust()`는 Markdown body, 현재 timestamp/ISO 문자열, decode 실패 label을 Rust의 `plan_chat_messages_json()`에 넘기고, Rust가 `ChatMessageWithMeta`로 복원 가능한 message plan을 만든다.
- Rust는 `superpower-inside`와 기존 `super-obsidian` message comment prefix를 모두 읽고, role/status union 검증, provider/model/source/citation/tool/question meta 보존을 담당한다.
- `loadChat()`은 Obsidian `Vault.cachedRead`, frontmatter/session fallback, legacy section loader만 TypeScript 경계에 유지하고, current-format message parsing은 Rust plan 결과를 typed object로 연결한다.
- 런타임 `persistence.ts`에는 `parseMarkdownMessages()`/`parseMessageMeta()`/`extractNamedBlock()`/`decodeTextBlock()` TypeScript current-format parser helper를 두지 않는다.

## 현재 마흔세 번째 slice

- 저장된 채팅 세션 목록 metadata의 frontmatter scalar parse, millisecond timestamp ISO 정규화, current-format message count, 첫 user message preview 계산을 Rust/WASM에 추가했다.
- `planChatMetaRust()`는 전체 Markdown content, 파일 basename, 파일 mtime을 Rust의 `plan_chat_meta_json()`에 넘기고, Rust가 `ChatSessionMeta`로 연결 가능한 metadata plan을 만든다.
- Rust는 title/created/updated/provider/model/messages 값을 정규화하고, `plan_chat_messages_json()`과 같은 current-format block parser를 재사용해 preview와 count를 계산한다.
- `listChatMetasAsync()`는 Obsidian `Vault.cachedRead`, 파일 목록 순회, 실패 시 파일 stat 기반 최소 metadata 연결만 TypeScript 경계에 유지한다.
- 런타임 `persistence.ts`에는 `extractPreview()`/`countMarkdownMessages()`/`parseInteger()` TypeScript metadata parser helper를 두지 않는다.

## 현재 마흔네 번째 slice

- 채팅 세션 저장 metadata의 title 생성, created timestamp 정규화, citation source count 합산, 마지막 provider/model 선택, summary 선택/절단을 Rust/WASM에 추가했다.
- `planChatSaveMetadataRust()`는 message snapshot, 기존 created 값, optional title, now ISO를 Rust의 `plan_chat_save_metadata_json()`에 넘기고, Rust가 저장 frontmatter/table에 연결할 metadata plan을 만든다.
- Rust는 첫 user message title, 마지막 complete assistant summary, source citation count, provider label/key 우선순위를 계산한다.
- `saveChat()`은 Obsidian `Vault.cachedRead`/`modify`/`create`, frontmatter 문자열 조립, Markdown table/body 직렬화만 TypeScript 경계에 유지한다.
- 런타임 `persistence.ts`에는 `deriveTitle()`/`deriveSummary()` TypeScript metadata helper를 두지 않는다.

## 현재 마흔다섯 번째 slice

- RAG context build의 source citation 생성, preview 정규화, verified source block 생성, source id/rejected count 집계를 Rust/WASM에 추가했다.
- `planContextSourcesRust()`는 RAG query result metadata snapshot과 TS host verification 결과를 Rust의 `plan_context_sources_json()`에 넘기고, Rust가 citation/block/source id plan을 만든다.
- `planContextGraphVerificationRust()`는 `graph://community/` virtual source를 vault 파일 검증 없이 verified community source로 판정하고, 알 수 없는 `graph://` source는 missing plan으로 만든다.
- `createContextPreviewRust()`는 파일/폴더/참조/Graph citation preview의 whitespace 정규화와 220자 제한을 Rust에서 계산한다.
- `buildChatContext()`는 Obsidian vault existence/hash/line 검증, i18n detail 문자열, Rust budget append 결과 적용, attachment object 연결만 TypeScript 경계에 유지한다.
- 런타임 `context.ts`에는 `createCitation()`/`createPreview()`/`isGraphVirtualSource()`/`verifyGraphQueryResult()` TypeScript source planning helper를 두지 않는다.

## 현재 마흔여섯 번째 slice

- VectorStore add/replace/remove mutation, stats/indexed path 계산, file path/id lookup index plan을 Rust/WASM에 추가했다.
- `planVectorStoreAddRust()`는 기존 entry id snapshot과 incoming id snapshot을 Rust의 `plan_vector_store_add_json()`에 넘기고, Rust가 overwrite/append source index plan을 만든다.
- `planVectorStoreReplaceFileRust()`와 `planVectorStoreRemoveFileRust()`는 entry file path snapshot을 Rust에 넘기고, Rust가 유지할 existing index, 붙일 incoming index, removed count를 계산한다.
- `planVectorStoreStatsRust()`는 entry file path snapshot을 Rust의 `plan_vector_store_stats_json()`에 넘기고, Rust가 total/average/lastUpdated와 정렬된 indexed file path 목록을 계산한다.
- `planVectorStoreLookupByFilePathsRust()`와 `planVectorStoreLookupByIdsRust()`는 TS가 가진 `VectorEntry` 객체를 Rust index plan으로만 다시 연결한다.
- `JsonFileVectorStore`와 `MemoryVectorStore`는 vault/메모리 I/O, `VectorEntry` 객체 복사, Rust plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `store.ts`에는 add/replace/remove/stats/lookup을 직접 계산하는 `Set`/`Map` 기반 TypeScript 저장소 helper를 두지 않는다.

## 현재 마흔일곱 번째 slice

- BM25 inverted index의 document add/replace, document/source removal, raw query search score 계산을 Rust/WASM에 추가했다.
- `planBm25IndexAddDocumentRust()`는 현재 BM25 index JSON snapshot, doc id, text, source path를 Rust의 `plan_bm25_index_add_document_json()`에 넘기고, Rust가 tokenizer 실행, term frequency 계산, 기존 doc 제거, posting/doc length/source/stat 재계산을 담당한다.
- `planBm25IndexRemoveDocumentRust()`와 `planBm25IndexRemoveSourceRust()`는 Rust의 `plan_bm25_index_remove_document_json()`/`plan_bm25_index_remove_source_json()`으로 posting cleanup, 빈 term 제거, doc length/source/stat 재계산을 처리한다.
- `planBm25SearchRust()`는 Rust의 `plan_bm25_search_json()`으로 raw query token dedupe, posting scan, BM25 score 계산을 수행하고 doc id/score list만 TypeScript에 반환한다.
- `JsonFileBM25Index`는 vault JSON load/persist, batch flush, `Map<string, number>` 반환 shape 연결만 TypeScript 경계에 유지한다.
- 런타임 `bm25.ts`에는 inverted index mutation, source doc id filter, doc length reduce, query token dedupe, posting score assembly를 직접 수행하는 TypeScript 계산을 두지 않는다.

## 현재 마흔여덟 번째 slice

- RAG index status의 document 상태 분류, summary count, total vector 합산, update-required row 정렬을 Rust/WASM에 추가했다.
- `planRagStatusRust()`는 included vault file snapshot, file index record snapshot, 현재 embedding provider/model, i18n reason label을 Rust의 `plan_rag_status_json()`에 넘긴다.
- Rust는 missing/legacy/stale/embedding-changed 우선순위, legacy metadata 판정, excluded document count, update row sort order를 계산한다.
- `calculateRagStatus()`는 Obsidian vault 파일 수집, VectorStore record 조회, AbortSignal 확인, `lastCalculatedAt` timestamp 부착만 TypeScript 경계에 유지한다.
- 런타임 `status.ts`에는 recordsByPath `Map`, status별 counter loop, totalVectors reduce, `getFileIndexState()`/`statusSortOrder()` TypeScript 계산 helper를 두지 않는다.

## 현재 마흔아홉 번째 slice

- `VaultIndexer.indexPending()`의 pending 대상 file 선택과 skipped count 계산을 Rust/WASM에 추가했다.
- `planIndexPendingFilesRust()`는 candidate file path snapshot과 status update-required path snapshot을 Rust의 `plan_index_pending_files_json()`에 넘긴다.
- Rust는 update path membership set을 만들고 candidate file 순서에 맞는 file index 목록과 skip count를 계산한다.
- `indexPending()`은 Obsidian candidate file 수집, `calculateRagStatus()` 호출, 반환된 file index의 `TFile`에 대한 실제 indexing I/O만 TypeScript 경계에 유지한다.
- 런타임 `indexer.ts`에는 pending 대상 선정을 위한 `filesByPath` Map이나 `updatePaths` Set 계산을 두지 않는다.

## 현재 쉰 번째 slice

- GraphRAG index status의 entry lookup dedupe, disabled/schema-error/building/not-built/ready/partial/stale 판정, stale file path 계산을 Rust/WASM에 추가했다.
- `planGraphRagStatusEntryLookupsRust()`는 evidence entry id와 extraction cache entry id snapshot을 Rust의 `plan_graph_rag_status_entry_lookups_json()`에 넘기고, Rust가 evidence 우선 dedupe lookup 순서를 만든다.
- `planGraphRagStatusRust()`는 file index record, evidence, rejected fact path, pending merge count, extraction cache, vector entry snapshot을 Rust의 `plan_graph_rag_status_json()`에 넘긴다.
- Rust는 processable/removed evidence, missing cache entry, content hash/model/schema/version drift, file vector count 대비 fresh cache 부족 여부를 stale file path로 계산한다.
- `calculateGraphRagStatus()`는 Obsidian/vector/graph store 조회, processable path predicate 호출, Rust plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/status.ts`에는 status 판정을 위한 `Map`/`Set` 기반 cache/entry/stale/fresh-count 계산 helper를 두지 않는다.

## 현재 쉰한 번째 slice

- GraphRAG entity upsert merge의 alias/evidence 순서 보존 dedupe, description 우선순위, confidence max, updated timestamp 선택을 Rust/WASM에 추가했다.
- `planGraphEntityMergeRust()`는 기존 entity field snapshot과 incoming entity field snapshot을 Rust의 `plan_graph_entity_merge_json()`에 넘긴다.
- Rust는 existing aliases/evidence를 먼저 보존하고 incoming 값에서 아직 없는 항목만 뒤에 붙이며, next description이 비어 있으면 existing description을 유지한다.
- `IndexedDbKnowledgeGraphStore.upsertEntity()`와 `InMemoryKnowledgeGraphStore.upsertEntity()`는 저장소 transaction/Map mutation, record copy, Rust plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/store.ts`에는 entity merge를 위한 `new Set([...existing, ...next])`나 `Math.max(existing.confidence, next.confidence)` 계산을 두지 않는다.

## 현재 쉰두 번째 slice

- GraphRAG extraction cache hit 판정의 entry id/content hash/model/schema/version equality를 Rust/WASM에 추가했다.
- `isGraphExtractionCacheHitRust()`는 store에서 조회한 cached key snapshot 또는 `null`과 현재 extraction key snapshot을 Rust의 `is_graph_extraction_cache_hit_json()`에 넘긴다.
- Rust는 cached record가 없으면 `false`, malformed wire payload는 bridge 실패, key field가 모두 일치하면 `true`로 판정한다.
- `IndexedDbKnowledgeGraphStore.isExtractionCached()`와 `InMemoryKnowledgeGraphStore.isExtractionCached()`는 DB/Map 조회와 Rust boolean plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/store.ts`에는 extraction cache hit 판정을 위한 `cached?.contentHash === input.contentHash` 같은 field equality 계산을 두지 않는다.

## 현재 쉰세 번째 slice

- Graph store의 단일 목적 삭제 대상 선택을 record key 기반 Rust/WASM index plan으로 통합했다.
- `planGraphDeletionIndicesRust()`는 record key snapshot과 requested key snapshot을 Rust의 `plan_graph_deletion_indices_json()`에 넘긴다.
- Rust는 requested key set membership을 계산하고, 원래 record 순서를 유지한 삭제 index 목록을 반환한다.
- `removeEvidenceByFilePaths()`, `removeExtractionCacheByEntryIds()`, `removeRejectedFactsByFilePaths()`는 Dexie/Map record 조회, Rust index plan 적용, 실제 삭제 mutation만 TypeScript 경계에 유지한다.
- 런타임 `graph/store.ts`에는 이 세 삭제 메서드를 위한 `new Set(filePaths)`, `new Set(entryIds)`, `filter(...Set.has...)` 계산을 두지 않는다.

## 현재 쉰네 번째 slice

- Graph store prune snapshot 적용에서 updated entity/relation/claim의 남은 reference id 선택을 Rust/WASM plan으로 확장했다.
- `planGraphPruneRust()`는 `prune_graph_indexes_json()`의 삭제/업데이트 index plan과 함께 updated record별 유지 reference 위치 배열을 반환한다.
- Rust는 삭제 evidence/entity/relation bool vector를 기준으로 각 record 내부 id 배열에서 보존할 위치를 원래 순서대로 계산한다.
- `createPrunedGraphSnapshotFromRustPlan()`은 snapshot 조회, record copy, Rust reference-position plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/store.ts`에는 prune 적용을 위한 `removedEvidenceIds`/`deletedEntityIdSet`/`deletedRelationIdSet` 또는 claim/reference `filter(...Set.has...)` 계산을 두지 않는다.

## 현재 쉰다섯 번째 slice

- GraphRAG evidence score 후보 변환의 score/evidence lookup과 file path dedupe를 Rust/WASM plan으로 옮겼다.
- `planGraphEvidenceCandidateLookupRust()`는 ordered evidence score와 evidence record snapshot을 Rust의 `plan_graph_evidence_candidate_lookup_json()`에 넘긴다.
- Rust는 존재하는 evidence만 score 순서대로 선택하고, score index/evidence index/file path lookup 목록을 원래 순서와 first-seen dedupe 규칙으로 반환한다.
- `GraphRagQueryEngine.evidenceScoresToCandidates()`는 graph store/vector store I/O, Rust plan 적용, entry compatibility callback만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 evidence 후보 변환을 위한 `evidenceById` Map이나 `new Set(evidenceRecords.map(...filePath))` 계산을 두지 않는다.

## 현재 쉰여섯 번째 slice

- GraphRAG evidence 후보를 최종 vector entry candidate로 바꾸는 missing-entry 제거, compatibility 적용, entry id dedupe, limit 적용을 Rust/WASM plan으로 옮겼다.
- `planGraphEvidenceEntryCandidatesRust()`는 evidence candidate entry id 순서, vector entry id/compatibility snapshot, candidate limit을 Rust의 `plan_graph_evidence_entry_candidates_json()`에 넘긴다.
- Rust는 vector entry lookup 결과의 first-seen index를 만들고, compatible한 entry만 중복 없이 limit까지 선택한다.
- `GraphRagQueryEngine.evidenceScoresToCandidates()`는 vector store I/O, compatibility callback 평가, Rust entry candidate plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 evidence candidate selection을 위한 `entriesById` Map이나 `findIndex(...entry.id...)` dedupe 계산을 두지 않는다.

## 현재 쉰일곱 번째 slice

- GraphRAG query 실행 mode 선택과 auto plan의 `none`/`hybrid`/`global`/`evidence-first` action 판정을 Rust/WASM plan으로 옮겼다.
- `planGraphQueryExecutionRust()`는 configured query mode, planner query mode, evidence-first flag를 Rust의 `plan_graph_query_execution_json()`에 넘긴다.
- Rust는 fixed mode에서 planner 필요 여부와 실행 action을 계산하고, auto mode에서 planner 결과를 action으로 정규화한다.
- `GraphRagQueryEngine.query()`는 planner 호출 여부 확인, provider/graph/vector store I/O, Rust action 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 `this.queryMode === ...`, `autoPlan.queryMode === ...`, `autoPlan.evidenceFirst` 기반 실행 정책 분기를 두지 않는다.

## 현재 쉰여덟 번째 slice

- RAG/GraphRAG retrieval candidate merge의 entry id first-seen grouping을 Rust/WASM plan으로 옮겼다.
- `planMergedRetrievalCandidatesByEntryIdRust()`는 candidate entry id/source/score/rank snapshot을 Rust의 `plan_merged_retrieval_candidates_by_entry_id()`에 넘긴다.
- Rust는 entry id를 first-seen numeric index로 매핑한 뒤 기존 source merge plan을 재사용해 representative/source/candidate index를 계산한다.
- `retrieval-pipeline.ts`와 `graph/query-engine.ts`는 candidate 객체에서 host field를 추출하고 Rust merge plan을 적용하는 일만 TypeScript 경계에 유지한다.
- 런타임 RAG/GraphRAG merge path에는 `entryIndexById` Map이나 `getOrCreateEntryIndex()` helper를 두지 않는다.

## 현재 쉰아홉 번째 slice

- GraphRAG local/evidence-first query에서 relation ontology schema filtering을 Rust/WASM index plan으로 옮겼다.
- `planGraphSchemaRelationIndicesRust()`는 relation ontology schema id snapshot과 target schema id를 Rust의 `plan_graph_schema_relation_indices_json()`에 넘긴다.
- Rust는 matching relation index 목록을 원래 relation 순서대로 계산한다.
- `GraphRagQueryEngine`은 graph store I/O, relation field snapshot 추출, Rust index plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 `relations.filter((relation) => relation.ontologySchemaId === this.ontologySchema.id)` 계산을 두지 않는다.

## 현재 예순 번째 slice

- GraphRAG global query에서 community ontology schema filtering을 Rust/WASM index plan으로 옮겼다.
- `planGraphSchemaCommunityIndicesRust()`는 community ontology schema id snapshot과 target schema id를 Rust의 `plan_graph_schema_community_indices_json()`에 넘긴다.
- Rust는 matching community index 목록을 원래 community 순서대로 계산한다.
- `GraphRagQueryEngine.queryGlobal()`은 graph store I/O, community field snapshot 추출, Rust index plan 적용만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 `(community) => community.ontologySchemaId === this.ontologySchema.id` 기반 filtering 계산을 두지 않는다.

## 현재 예순한 번째 slice

- InMemory Graph store의 `replaceCommunities()`에서 기존 community 삭제 id 선택을 Rust/WASM plan으로 옮겼다.
- `planGraphCommunityReplacementDeleteIdsRust()`는 기존 community id/schema snapshot과 target schema id를 Rust의 `plan_graph_community_replacement_delete_ids_json()`에 넘긴다.
- Rust는 target schema에 속한 기존 community id를 원래 insertion snapshot 순서대로 계산한다.
- `InMemoryKnowledgeGraphStore.replaceCommunities()`는 Map snapshot 추출, Rust delete id plan 적용, 실제 Map mutation만 TypeScript 경계에 유지한다.
- IndexedDB 구현의 `.where('ontologySchemaId').equals(...)`는 host storage index query이므로 유지하고, 런타임 `graph/store.ts`에는 community schema equality loop를 두지 않는다.

## 현재 예순두 번째 slice

- GraphRAG local evidence score의 record snapshot 정규화, entity/evidence id first-seen indexing, offset 계산, score/id mapping을 Rust/WASM plan으로 옮겼다.
- `planLocalEvidenceScoresRust()`는 mentioned entity match, relation, claim snapshot과 traversal depth를 Rust의 `plan_local_evidence_scores_json()`에 넘긴다.
- Rust는 graph record snapshot을 numeric local evidence input으로 변환하고 기존 `score_local_evidence()` scoring kernel을 재사용해 evidence id/score JSON plan을 만든다.
- `GraphRagQueryEngine.collectLocalEvidenceScoresWithRust()`는 graph store에서 받은 record field 추출과 Rust plan 호출만 TypeScript 경계에 유지한다.
- 런타임 `graph/query-engine.ts`에는 local evidence scoring용 `getOrCreateIndex()`, `pushEvidenceIndices()`, `clampScore()` helper를 두지 않는다.

## 현재 예순세 번째 slice

- RAG 최종 result diversity selection의 source path/heading string keying을 Rust/WASM plan으로 옮겼다.
- `planDiverseResultIndicesRust()`는 QueryResult score/vector/source path/heading snapshot과 topK를 Rust의 `plan_diverse_result_indices_json()`에 넘긴다.
- Rust는 source path와 heading을 first-seen numeric key로 변환하고 기존 `select_diverse_index_plan()` MMR selector를 재사용한다.
- `RAGQueryEngine.selectDiverseResults()`는 QueryResult field snapshot 추출, Rust index plan 적용, 실제 result 배열 복원만 TypeScript 경계에 유지한다.
- 런타임 `rag/query.ts`에는 diversity selection용 `getOrCreateNumericKey()` helper를 두지 않는다.

## 현재 예순네 번째 slice

- GraphRAG community detection의 string edge entity id keying, numeric graph conversion, assignment-to-entity-id mapping을 Rust/WASM plan으로 옮겼다.
- `detectCommunitiesFromEdgesRust()`는 `CommunityEdge` source/target/weight snapshot과 max iteration을 Rust의 `detect_communities_from_edges_json()`에 넘긴다.
- Rust는 entity id를 정렬된 unique id 순서로 numeric index에 매핑하고 기존 community detection kernel을 재사용한 뒤 entity id별 community assignment JSON plan을 만든다.
- `detectCommunities()`는 Rust assignment plan을 `Map<string, number>`로 복원하는 wrapper 역할만 한다.
- 런타임 `graph/community-detector.ts`에는 detection용 `extractUniqueEntityIds()`와 `detectCommunitiesWithRust()` helper를 두지 않는다.

## 현재 예순다섯 번째 slice

- GraphRAG entity resolver의 entity id 생성, compatible 후보 판정, best match 선택, auto/pending/new threshold 결정을 Rust/WASM plan으로 옮겼다.
- `createEntityId()`는 Rust의 `create_entity_id()` 결과만 사용하고, `EntityResolver.resolve()`는 scored entity snapshot을 `planEntityResolutionRust()`에 넘긴다.
- Rust는 ontology schema/type이 맞는 후보만 대상으로 기존 first-best tie 계약을 유지하며 최종 `status`, `entityId`, `mergeScore`, `matchedEntityId`를 계산한다.
- `EntityResolver`는 graph store I/O, embedding provider 호출, pending merge store mutation만 TypeScript 경계에 유지한다.
- 런타임 `graph/entity-resolver.ts`에는 `compatibleEntities` filter나 `bestMatch` selection loop를 두지 않는다.

## 현재 예순여섯 번째 slice

- RAG query result score row의 BM25/vector base blend, source rank fusion, source prior/evidence summary, graph evidence floor/cap 결정을 Rust/WASM plan으로 묶었다.
- `RAGQueryEngine.query()`는 cosine score와 retrieval candidate snapshot을 `planQueryResultScoreRust()`에 넘기고 Rust의 `plan_query_result_score_json()` 결과를 `QueryResult` field에 매핑한다.
- Rust는 source score/rank map과 retrieval source 문자열을 직접 source code로 해석하고 기존 `analyze_retrieval_sources()`, `rrf_score_or_nan()`, `hybrid_score_or_nan()` kernel을 재사용한다.
- embedding provider 호출, retrieval provider orchestration, candidate object assembly, reranker provider 호출은 TypeScript 경계에 유지한다.
- 런타임 `rag/query.ts`에는 query result score row용 `combinedBase`, `sourceAnalysis`, `rrfScore`, `calculateHybridScore()` 조립을 두지 않는다.

## 현재 예순일곱 번째 slice

- RAG LLM reranker의 system/user message content 생성, candidate index 부여, text truncation, JSON user payload serialization을 Rust/WASM plan으로 옮겼다.
- `LLMRAGResultReranker.rerank()`는 result 후보 snapshot을 `planRerankMessagesRust()`에 넘기고 Rust의 `plan_rerank_messages_json()` 결과만 provider chat message로 매핑한다.
- Rust는 후보 순서대로 index를 부여하고, 후보 text를 configured max chars로 trim/truncate한 뒤 reranker prompt와 user JSON payload를 결정적으로 생성한다.
- provider 호출, timeout/abort 처리, raw reranker 응답 parsing/order 적용 bridge는 TypeScript 경계에 유지한다.
- 런타임 `rag/query.ts`에는 reranker message 생성을 위한 `buildRerankMessages()`나 `truncateForRerank()` 계산을 두지 않는다.

## 현재 예순여덟 번째 slice

- 채팅 GraphRAG entity mention context의 entity canonical/alias match와 relation endpoint selection을 Rust/WASM index plan으로 옮겼다.
- `appendGraphEntityContext()`는 graph store entity/relation snapshot을 `planGraphMentionContextRust()`에 넘기고 Rust의 `plan_graph_mention_context_json()` 결과 index와 context line plan을 사용한다.
- Rust는 mention name을 lower-case set으로 정규화하고, canonical/alias match entity index와 matched entity에 연결된 relation index를 원래 graph snapshot 순서대로 계산한다.
- Graph store I/O, mention resolver의 host snapshot preload, context block/citation/attachment 렌더링은 TypeScript 경계에 유지한다.
- 런타임 `chat/context.ts`에는 entity mention context selection용 `mentionedNames`, `matchedEntities`, `matchedRelations`, `entityById` 계산을 두지 않는다.

## 현재 예순아홉 번째 slice

- GraphRAG extraction에서 claim `entityNames`를 graph entity id 목록으로 해석하는 normalization/lookup 계산을 Rust/WASM plan으로 옮겼다.
- `GraphExtractionIndexer.storeAcceptedFacts()`는 accepted entity/alias lookup snapshot을 `planGraphClaimEntityIdsRust()`에 넘기고 Rust의 `plan_graph_claim_entity_ids_json()` 결과를 claim record에 매핑한다.
- Rust는 extracted claim entity names와 accepted entity canonical/alias rows를 기존 graph name normalization으로 비교하고, claim 입력 순서대로 존재하는 entity id만 반환한다.
- LLM provider 호출, entity resolver, ontology validation, graph store mutation은 TypeScript 경계에 유지한다.
- 런타임 `graph/extraction.ts`에는 claim entity id 계산용 `claim.entityNames.map(...entitiesByName.get...)` lookup을 두지 않는다.

## 현재 일흔 번째 slice

- GraphRAG extraction에서 relation `source`/`target` entity endpoint lookup을 Rust/WASM index plan으로 옮겼다.
- `GraphExtractionIndexer.storeAcceptedFacts()`는 extracted relation source/target snapshot과 accepted entity/alias index rows를 `planGraphRelationEndpointIndicesRust()`에 넘기고 Rust의 `plan_graph_relation_endpoint_indices_json()` 결과를 relation record에 매핑한다.
- Rust는 relation 입력 순서를 보존하면서 기존 graph name normalization으로 source/target entity index pair 또는 `null`을 반환한다.
- TypeScript는 Rust가 돌려준 index로 accepted `GraphEntityRecord`만 복원하고, `null`은 기존 `unknown-relation-entity` reject 경로로 처리한다.
- 런타임 `graph/extraction.ts`에는 relation source/target 계산용 `entitiesByName.get(normalizeName(relation.source|target))` lookup을 두지 않는다.

## 현재 일흔한 번째 slice

- GraphRAG extraction에서 entity/claim type id의 ontology schema membership 검증을 Rust/WASM plan으로 옮겼다.
- `GraphExtractionIndexer.storeAcceptedFacts()`는 extracted entity type id, claim type id, schema entity/claim type id snapshot을 `planGraphExtractionTypeValidationRust()`에 넘긴다.
- Rust의 `plan_graph_extraction_type_validation_json()`은 입력 순서대로 `entityTypeKnown`/`claimTypeKnown` boolean plan을 반환한다.
- TypeScript는 boolean plan의 index만 보고 기존 `unknown-entity-type`/`unknown-claim-type` reject 경로를 유지하며, schema membership `.some()` 계산은 하지 않는다.
- 런타임 `graph/extraction.ts`에는 `isKnownEntityType()`/`isKnownClaimType()` helper와 `schema.entityTypes.some()`/`schema.claimTypes.some()` membership 계산을 두지 않는다.

## 현재 일흔두 번째 slice

- GraphRAG community summarizer의 community별 entity/relation/claim grouping을 Rust/WASM index plan으로 옮겼다.
- `CommunitySummarizer.summarizeCommunities()`는 community assignment, entity id snapshot, relation endpoint snapshot, claim entity id snapshot, community id 목록을 `planGraphCommunitySummaryGroupsRust()`에 넘긴다.
- Rust의 `plan_graph_community_summary_groups_json()`은 community id 순서대로 entity index, same-community relation index, first-matched-entity claim index를 반환한다.
- TypeScript는 Rust index plan으로 record를 복원하고, LLM summary 생성, embedding 호출, `GraphCommunityRecord` 조립만 담당한다.
- 런타임 `graph/community-summarizer.ts`에는 summarizer grouping용 `groupedEntities`/`communityRelations`/`communityClaims` Map 계산을 두지 않는다.

## 현재 일흔세 번째 slice

- GraphRAG file path eligibility 중 markdown extension filtering을 Rust/WASM plan으로 옮겼다.
- `filterGraphRagMarkdownFilePaths()`와 `isGraphRagMarkdownFilePath()`는 file path snapshot을 `planGraphRagMarkdownFilePathsRust()`에 넘기고 Rust의 `plan_graph_rag_markdown_file_paths_json()` 결과를 사용한다.
- Rust는 기존 `toLowerCase().endsWith('.md')` 계약과 같이 대소문자 구분 없이 `.md` suffix를 판정하고 입력 순서를 보존한다.
- TypeScript에는 host predicate 적용만 남기고, 사용자/설정 기반 processable callback은 Rust가 직접 소유하지 않는다.
- 런타임 `graph/file-paths.ts`에는 GraphRAG markdown 판정용 `filePath.toLowerCase().endsWith('.md')` 계산을 두지 않는다.

## 현재 일흔네 번째 slice

- 채팅 reference expansion에서 resolved reference file의 self-skip/dedupe selection을 Rust/WASM index plan으로 옮겼다.
- `expandReferencedVaultFiles()`는 Obsidian metadata/vault resolve 결과의 file path snapshot을 `planReferenceFileIndicesRust()`에 넘기고 Rust의 `plan_reference_file_indices_json()` 결과 index만 읽기 대상으로 복원한다.
- Rust는 source file path와 resolved file path 목록을 비교해 source 자신을 제외하고, 첫 등장 file path만 선택하며 입력 순서를 보존한다.
- TypeScript에는 vault link extraction/path candidate bridge, Obsidian metadata/vault lookup, `cachedRead()`, warning text 생성만 남긴다.
- 런타임 `chat/context-expansion.ts`에는 reference 중복 제거용 `references.some(reference.file.path === file.path)` 계산을 두지 않는다.

## 현재 일흔다섯 번째 slice

- 채팅 reference expansion의 vault link basename fallback 선택을 Rust/WASM index plan으로 옮겼다.
- `resolveVaultLink()`는 Obsidian metadata/path 후보 조회가 실패한 뒤 markdown file basename snapshot을 `planVaultLinkFallbackIndexRust()`에 넘기고 Rust의 `plan_vault_link_fallback_index_json()` 결과 index만 `TFile`로 복원한다.
- Rust는 기존 `Array.find(file.basename === fallbackBasename)` 계약과 같이 첫 번째 basename match index를 반환하고, match가 없으면 `null` index plan을 반환한다.
- TypeScript에는 `getMarkdownFiles()` host snapshot 생성과 index 복원만 남기며, basename match 선택 계산은 하지 않는다.
- 런타임 `chat/context-expansion.ts`에는 vault link basename 대체 선택용 `.find(file.basename === plan.fallbackBasename)` 로직을 두지 않는다.

## 현재 일흔여섯 번째 slice

- 채팅 folder mention의 markdown file 선택과 partial 판정을 Rust/WASM index plan으로 옮겼다.
- `appendFolderMention()`은 Obsidian folder 존재 확인 뒤 markdown file path snapshot과 `maxFolderFiles`를 `planFolderMentionFilesRust()`에 넘기고 Rust의 `plan_folder_mention_file_indices_json()` 결과 index만 `TFile`로 복원한다.
- Rust는 기존 `file.path.startsWith(folderPath + '/')` 계약과 같이 folder 내부 markdown file만 입력 순서대로 고르고, 제한 개수를 넘는 내부 파일이 있으면 `partial: true`를 반환한다.
- TypeScript에는 `getMarkdownFiles()` host snapshot, `cachedRead()`, citation/attachment 조립만 남긴다.
- 런타임 `chat/context.ts`에는 folder mention용 `file.path.startsWith(\`${path}/\`)` filter/count 계산을 두지 않는다.

## 현재 일흔일곱 번째 slice

- 채팅 persistence의 저장된 세션 파일 listing도 Rust/WASM folder index plan을 재사용하도록 바꿨다.
- `listChats()`는 chat 저장 폴더와 markdown file path snapshot을 `planFolderMentionFilesRust()`에 넘기고, Rust가 반환한 index만 `TFile`로 복원한다.
- Rust는 folder mention slice와 같은 `folderPath + '/'` prefix 계약을 사용하므로 `Chats-extra` 같은 sibling prefix는 제외하고, `Chats/Nested/*.md` 같은 내부 파일은 포함한다.
- TypeScript에는 `getMarkdownFiles()` host snapshot과 `TFile` 복원만 남기며, 저장 목록 folder prefix filter는 하지 않는다.
- 런타임 `chat/persistence.ts`에는 `file.path.startsWith(folder + '/')` filter 계산을 두지 않는다.

## 현재 일흔여덟 번째 slice

- GraphRAG community detector의 relation edge record 전처리를 Rust/WASM plan으로 옮겼다.
- `buildEdgesWithRust()`는 entity id snapshot, relation source/target id snapshot, confidence snapshot을 `planGraphEdgeRecordsRust()`에 넘기고 Rust의 `plan_graph_edge_records_json()` 결과를 그대로 사용한다.
- Rust는 entity id dedupe/sort, endpoint id lookup, 누락 endpoint relation skip, 무방향 endpoint pair confidence 합산을 계산한다.
- TypeScript에는 graph store record에서 string/number snapshot을 만드는 wrapper 역할만 남긴다.
- 런타임 `graph/community-detector.ts`에는 community edge 생성용 `new Set(entities.map(...)).sort()`와 `new Map(entityIds.map(...))` lookup 계산을 두지 않는다.

## 현재 일흔아홉 번째 slice

- 채팅 source validation의 verified citation 선택과 vault alias probe 후보 계산을 Rust/WASM input plan으로 옮겼다.
- `validateAnswerSources()`는 reference plan과 citation id/path/status snapshot을 `planSourceValidationInputsRust()`에 넘기고, Rust의 `plan_source_validation_inputs_json()` 결과만 사용한다.
- Rust는 `status === "verified"` citation의 id/path 목록과 source-id가 아닌 reference alias 후보를 입력 순서대로 만든다.
- TypeScript에는 Obsidian vault resolver의 `exists(alias)` host boundary 호출과 i18n detail 문자열 부착만 남긴다.
- 런타임 `chat/source-validation.ts`에는 citation `status === "verified"` filter와 `collectExistingAliases()` alias traversal helper를 두지 않는다.

## 현재 여든 번째 slice

- 채팅 context budget append의 text truncation, remaining char 계산, complete/appended 판정을 Rust/WASM plan으로 옮겼다.
- `createContextBudget().append()`는 현재 remaining char와 block text를 `planContextBudgetAppendRust()`에 넘기고, Rust의 `plan_context_budget_append_json()` 결과만 적용한다.
- Rust는 UTF-16 unit budget을 계산하되 Unicode scalar boundary를 보존해서 surrogate pair 중간을 잘라 깨진 문자를 만들지 않는다.
- TypeScript에는 appended block 보관, citation object 보존, remaining value 적용만 남긴다.
- 런타임 `chat/context-budget.ts`에는 `block.text.length > remainingChars`, `block.text.slice(0, remainingChars)`, `remainingChars -= text.length` 계산을 두지 않는다.

## 현재 여든한 번째 slice

- 채팅 context build의 mention type grouping과 auto-RAG 실행 policy를 Rust/WASM plan으로 옮겼다.
- `buildChatContext()`는 parsed mention type snapshot을 `planChatContextMentionsRust()`에 넘기고, Rust의 `plan_chat_context_mentions_json()`이 만든 file/folder/entity/server index plan만 순회한다.
- `shouldUseAutoRagForMentions()`도 같은 Rust plan의 `useAutoRag` 값을 사용한다.
- Rust는 server-only mention이면 auto-RAG를 끄고, file/folder mention이 같이 있거나 server mention이 없으면 auto-RAG를 유지한다.
- 런타임 `chat/context.ts`와 `chat/mention-parser.ts`에는 mention type별 `.filter()`/`.some()` grouping과 vault/server policy 계산을 두지 않는다.

## 현재 여든두 번째 slice

- GraphRAG entity mention context block의 표시 line 생성과 relation endpoint label 해석을 Rust/WASM plan으로 옮겼다.
- `appendGraphEntityContext()`는 entity id/name/alias/type/description과 relation endpoint/type/description snapshot을 `planGraphMentionContextRust()`에 넘기고, Rust가 반환한 `contextLines`를 그대로 context block에 붙인다.
- Rust는 matched entity 최대 10개, matched relation 최대 15개, entity/related relation heading, alias 표시, description truncation, source/target canonical name lookup을 계산한다.
- TypeScript에는 graph store snapshot 수집, index로 citation 대상 entity 복원, attachment/citation object 조립만 남긴다.
- 런타임 `chat/context.ts`에는 Graph context line용 `entities.find(...)`, `matchedRelations.slice(0, 15)`, description `.slice(...)` 계산을 두지 않는다.

## 현재 여든세 번째 slice

- MCP tool 실행의 connected preferred/remaining server candidate ordering과 tool name exact matching을 Rust/WASM plan으로 옮겼다.
- `findServerForTool()`는 registry status/enabled server/tool name snapshot만 만들고 `planMcpServerCandidatesRust()`와 `isMcpToolAvailableRust()` 결과를 따른다.
- Rust는 connected preferred server를 순서 보존 dedupe로 먼저 고르고, connected enabled remaining server를 중복 없이 뒤에 붙인다.
- TypeScript에는 registry/client host I/O, `listTools()`, `callTool()`, i18n 오류 문자열만 남긴다.
- 런타임 `chat/mcp-tool-execution.ts`에는 `preferredServerNames.filter(...)`, `!preferred.includes(serverName)`, `tools.some(tool.name === toolName)` 계산을 두지 않는다.

## 현재 여든네 번째 slice

- RAG candidate file eligibility의 exclude path/ext, sensitive file, zero-size, known text extension/name, unknown text sample 판정을 Rust/WASM two-phase plan으로 옮겼다.
- `getRagCandidateFiles()`와 `getRagFileTypeSummary()`는 vault file metadata snapshot을 `planRagFileContentProbeIndicesRust()`에 넘겨 content read가 필요한 index만 받고, 해당 파일의 text sample만 host I/O로 읽는다.
- 최종 후보 index와 file type summary input은 `planRagFileIndexabilityRust()` 결과를 따른다.
- Rust는 `.env`/`.env.*`/`env` 확장자 민감 파일 제외, empty file 제외, known text file 즉시 포함, unknown file sample의 control-char ratio 판정을 담당한다.
- TypeScript에는 `vault.getFiles()`, `vault.cachedRead()`, i18n reason mapping, Rust index를 `TFile`로 복원하는 wrapper만 남긴다.
- 런타임 `utils/vault.ts`에는 RAG 후보 판정용 `TEXT_EXTENSIONS`, `SENSITIVE_FILE_NAMES`, `isSensitiveFile()`, `isKnownTextFileName()`, `canReadAsText()`, `isProbablyText()` helper를 두지 않는다.

## 현재 여든다섯 번째 slice

- GraphRAG indexing run의 failed/stale/full candidate selection, markdown filtering, dedupe, sort, max-files window 계산을 Rust/WASM plan으로 옮겼다.
- `GraphRagIndexingRunner.run()`은 `planGraphRagRunFileSelectionRust()`가 반환한 `candidateFilePaths`와 `selectedFilePaths`를 그대로 사용한다.
- Rust는 failed mode에서 failed file snapshot, stale mode에서 stale file snapshot, full mode에서 vector record path snapshot을 우선 사용하고 record가 없을 때 indexed path snapshot으로 넘어간다.
- TypeScript에는 vector store I/O, host processable predicate snapshot, selected file loop, extraction/community build side effect만 남긴다.
- 런타임 `graph/indexing-runner.ts`에는 GraphRAG run 후보용 `filterGraphRagMarkdownFilePaths(...).sort()`와 `candidateFilePaths.slice(0, this.maxFilesPerRun)` 계산을 두지 않는다.

## 현재 여든여섯 번째 slice

- GraphRAG run 시작 전 unsupported graph evidence/rejected fact prune 대상 path 선택을 Rust/WASM plan으로 옮겼다.
- `pruneUnsupportedGraphFiles()`는 graph store에서 evidence/rejected fact snapshot을 읽고 file path별 `isProcessable()` 결과만 Rust에 넘긴다.
- Rust는 evidence 순서 뒤 rejected fact 순서로 `processable=false` path를 first-seen dedupe해 prune 대상 목록을 만든다.
- TypeScript에는 graph store I/O, host processable predicate, `pruneByFilePaths()` side effect만 남긴다.
- 런타임 `graph/indexing-runner.ts`에는 unsupported prune용 `new Set()`/`.add(record.filePath)` 계산을 두지 않는다.

## 현재 여든일곱 번째 slice

- GraphRAG status의 candidate file record 선택과 indexed path 기반 candidate count 계산을 Rust/WASM plan으로 옮겼다.
- `calculateGraphRagStatus()`는 vector store에서 file index record/indexed path snapshot을 읽고 host predicate 결과만 wire input에 붙인다.
- Rust는 markdown path 판정, host processable gate, 중복 path 제거, vectorCount=0 record 제외, record 우선/indexed path 대체 candidate count를 결정한다.
- TypeScript에는 vector store I/O, Rust index를 `FileIndexRecord`로 복원하는 wrapper, 최종 `planGraphRagStatusRust()` 호출만 남긴다.
- 런타임 `graph/status.ts`에는 GraphRAG status 후보용 `getTotalCandidateFiles()`/`getFileIndexRecords()` TS filtering helper를 두지 않는다.

## 현재 여든여덟 번째 slice

- GraphRAG status의 vector entry snapshot 선택을 Rust/WASM plan으로 옮겼다.
- `calculateGraphRagStatus()`는 `getEntriesByIds()`로 조회한 entry snapshot과 host predicate 결과만 Rust에 넘긴다.
- Rust는 markdown path 판정, host processable gate, entry id first-seen dedupe를 적용해 status input에 포함할 vector entry index를 계산한다.
- TypeScript에는 vector store I/O, Rust index를 `VectorEntry`로 복원하는 wrapper, 최종 `planGraphRagStatusRust()` 호출만 남긴다.
- 런타임 `graph/status.ts`에는 GraphRAG status entry 후보용 `filterProcessableGraphRagEntries()`/`entries.filter(...)` 계산을 두지 않는다.

## 현재 여든아홉 번째 slice

- Ontology schema 정합성 검사를 순수 계산으로 Rust/WASM으로 이전했다.
- `validateOntologySchema()`는 schema JSON 필수필드, entity/relation type 참조, `parentTypeId`, `inverseRelationTypeId`, source/target 타입 유효성을 `validateOntologySchemaRust()`로 위임한다.
- Rust는 schema 문자열 파싱/검증 플래그 산출/오류 문자열 목록 반환을 `validate_ontology_schema_json()`에서 수행한다.
- TS는 실패 시 기존 기본값 기반 판정 또는 기존 예외 경로만 유지하고, Rust 결과를 받아 정규화된 에러 목록으로 반환하는 wrapper 역할만 남긴다.
- 런타임 오류가 생기면 `validateOntologySchema()`는 기존 계약으로 안전하게 내려간다.

## 현재 아흔 번째 slice

- MCP JSON 설정(`mcpServers`) 검증과 포맷터를 Rust/WASM 경계로 이전했다.
- `validateMcpJson()`는 우선 `validateMcpJsonRust()`를 호출해 `validate_mcp_json()` 결과의 `valid/data/errorCode/serverName/message`를 UI 계약(`valid`, `data`, `error`)으로 정규화한다.
- `formatMcpJson()`은 `formatMcpJsonRust()` 성공 시 즉시 반환하고, 실패 시 기존 동작(파싱 후 pretty format)으로 복귀한다.
- `Rust` 계약에서 `missing-mcp-servers`, `invalid-mcp-servers`, `invalid-server-value`, `server-needs-command`, `invalid-args`, `invalid-env`, `parse-error`를 명시적으로 구분해 설정 UI의 에러 메시징(`buildDetailedMcpError`)을 안정화했다.
- `buildDetailedMcpError`가 필요한 key/문구는 그대로 유지해 UI 동작은 기존 텍스트 정책을 깨지 않는다.
- MCP tool 실행 경로의 핵심 정규화를 Rust/WASM으로 이전했다.
- `parseMcpToolArgumentsRust()`는 MCP 도구 인자 문자열을 Rust에서 `{} / JSON 객체 / { input: value }` 규칙으로 정규화한다.
- `normalizeMcpToolResultRust()`와 `isMcpToolResultEmptyRust()`는 `content` 결과와 text extraction/fallback 계약을 Rust 결과로 고정한다.
- `classifyMcpToolErrorRust()`는 Input validation 에러 메시지의 패턴/필드/누락/일반 오류 유형 분류를 Rust에서 반환해 `chat` 뷰와 직접 도구 실행 모두 동일 분기 표준을 사용한다.

## 현재 아흔한 번째 slice

- 프롬프트 라이브러리 요약(상위 폴더/파일/헤딩 통계, 대표 샘플 추출, preview 정규화)을 순수 계산에서 Rust/WASM으로 이전했다.
- `summarizeVectorEntries()`는 `VectorEntry` 메타 `filePath/heading/text`를 `prompt_library_summary` wire 입력으로 변환해 `planPromptLibrarySummaryRust()`를 호출한다.
- Rust는 `folder/file/heading` 카운트, 대표 샘플 후보 수(24개), preview 압축(`compact whitespace`)까지 계산해 JSON plan을 반환한다.
- TS는 `promptSummaryTotalChunks` 라벨 조합과 텍스트 길이 truncation만 담당하는 wrapper로 축소되었고, Rust 실패 시에도 안전한 fallback 문자열만 노출한다.
- `main.js`의 wasm 바이트 갱신 경로는 기존과 동일하게 `rag_wasm_base64` 빌드 산출물을 그대로 주입한다.

## 현재 아흔여덟 번째 slice

- `src/utils/vault.ts`의 `isExcludedExt()`와 `countFilesByExtensions()` 순수 확장자 판정/카운트 계산을 Rust로 이전했다.
- `count_files_by_extensions_json()`는 입력 확장자 키를 정규화(소문자화/trim/leading-dot 제거)해 0 카운트 키를 보존한 뒤, `vault.getFiles().map(file.extension)` 기반 카운트를 계산한다.
- `is_excluded_ext_json()`은 경로 확장자 정규화와 일치 규칙을 Rust로 고정해 동일 계약을 유지한다.
- `src/rag/rust-core.ts`에 `countFilesByExtensionsRust()`, `isExcludedExtRust()` 브리지와 단위 테스트를 추가했으며, `src/utils/vault.test.ts`와 `src/rag/rust-core.test.ts`로 계약 회귀를 검증한다.
- `npm run build`의 `wasm:build` 체인은 새 export가 반영된 generated glue를 포함하도록 유지된다.

## 실시간성 개선 방향

- Rust 코어는 입력 snapshot id와 출력 revision을 명시적으로 받는다. UI는 오래된 revision 결과를 버린다.
- 파일 변경 이벤트는 즉시 UI 상태를 `pending`으로 바꾸고, Rust worker 작업은 debounced queue에서 처리한다.
- 인덱싱은 전체 재생성보다 file-level diff, chunk-level hash 비교, top-k cache invalidation을 우선한다.
- long task는 worker/WASM으로 분리해 Obsidian UI thread를 막지 않는다.
- 진행률은 `queued`, `hashing`, `chunking`, `embedding`, `indexed`, `failed` 상태로 refresh bus에 흘린다.
- 보여지는 소스 카드와 실제 RAG snapshot id를 같이 저장해 “화면에 보이는 출처”와 “모델에 들어간 컨텍스트”가 어긋나지 않게 한다.

## 검증 게이트

```fish
npm run rust:security
```

이 명령은 `rustfmt`, `clippy`, Rust test, WASM target build, `cargo-deny`, `cargo-audit`, `cargo-vet`, `cargo-geiger`를 한 번에 실행한다.
