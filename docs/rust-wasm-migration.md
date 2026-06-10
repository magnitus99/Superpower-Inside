# Rust/WASM 코어 전환 계획

## 결정

- 프로젝트는 무료 오픈소스 플러그인을 기본 전제로 유지한다. 기능 잠금, 유료 API 중계, 사용자 데이터 기반 수익화는 목표로 두지 않는다.
- JavaScript/TypeScript는 Obsidian UI, DOM, 플러그인 생명주기, vault I/O, provider 네트워크 호출, MCP stdio 연결만 담당한다.
- 성능과 결정성이 중요한 계산 코어는 Rust/WASM으로 옮긴다. 새 성능 기능은 먼저 Rust 구현 가능성을 검토한다.

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
- 기존 TypeScript `createContentHash()`와 같은 UTF-16 FNV-1a 해시를 Rust에 구현했다.
- 기존 BM25 토크나이저의 ASCII compound/camel-case, 한국어+숫자 n-gram 동작을 Rust에 구현했다.
- Rust 단위 테스트가 TypeScript 계약을 고정한다.

## 현재 두 번째 slice

- `wasm-bindgen` web glue와 `.wasm` bytes를 생성해 `main.js`에 포함하는 빌드 경로를 추가했다.
- `src/rag/rust-core.ts`가 embedded WASM을 `initSync(bytes)`로 초기화한다.
- `createContentHash()`, BM25 `tokenize()`, RAG vector top-k scoring, query cosine scoring은 Rust/WASM을 우선 사용하고, 초기화 실패 시 기존 TypeScript 구현으로 fallback한다.
- `npm run build`는 `npm run wasm:build`를 먼저 실행한다.
- `npm run rust:security`는 generated WASM glue/base64 파일이 최신인지 검사한다.

## 현재 세 번째 slice

- Markdown RAG chunking을 Rust/WASM에 추가했다.
- `chunkMarkdown()`은 Rust/WASM을 우선 사용하고, 초기화 또는 JSON 검증 실패 시 기존 TypeScript 구현으로 fallback한다.

## 현재 네 번째 slice

- plain text/code RAG chunking을 Rust/WASM에 추가했다.
- `chunkPlainText()`는 Rust/WASM을 우선 사용하고, 초기화 또는 JSON 검증 실패 시 기존 TypeScript 구현으로 fallback한다.
- RAG chunking 계열 중 파일 확장자 분기와 vault I/O는 TypeScript에 남고, 실제 chunk 계산은 Rust/WASM 경로를 먼저 탄다.

## 현재 다섯 번째 slice

- BM25 검색 scoring을 Rust/WASM에 추가했다.
- `JsonFileBM25Index.search()`는 기존 JSON 저장 구조와 vault persistence를 유지하면서 posting list를 typed array로 변환하고, IDF/TF score 누적 계산은 Rust/WASM을 우선 사용한다.
- Rust/WASM 초기화 실패 시 기존 TypeScript BM25 scoring 구현으로 fallback한다.
- BM25 인덱스 파일 생성/삭제/rename 흐름은 과거 churn 방지 계약 때문에 TypeScript vault I/O 경계에 그대로 둔다.

## 현재 여섯 번째 slice

- BM25 문서 term frequency 계산을 Rust/WASM에 추가했다.
- `JsonFileBM25Index.addDocument()`는 텍스트에서 token frequency map과 총 token 수를 만들 때 Rust/WASM을 우선 사용한다.
- inverted index 객체 mutation, doc source bookkeeping, 평균 문서 길이 갱신, vault persistence는 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 JSON 검증 실패 시 기존 TypeScript frequency 계산으로 fallback한다.

## 현재 일곱 번째 slice

- RAG query ranking의 RRF score와 hybrid result score 계산을 Rust/WASM에 추가했다.
- `RAGQueryEngine.query()`는 후보의 source rank fusion과 graph/evidence-aware hybrid score를 만들 때 Rust/WASM을 우선 사용한다.
- source 문자열 분류와 후보 객체 조립, threshold/filter, reranker/LLM 호출은 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 score 검증 실패 시 기존 TypeScript ranking 수식으로 fallback한다.

## 현재 여덟 번째 slice

- RAG query result의 MMR diversity selection을 Rust/WASM에 추가했다.
- `selectDiverseResults()`는 topK 후보 index 선택을 Rust/WASM에 먼저 맡기고, 반환 index를 기존 `QueryResult` 객체에 다시 매핑한다.
- `sourcePath`와 heading 문자열을 숫자 key로 바꾸는 작업, 후보 객체 조립, fallback selection loop는 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 typed array/index 검증 실패 시 기존 TypeScript MMR 루프를 그대로 사용한다.

## 현재 아홉 번째 slice

- GraphRAG community detection의 반복 assignment 계산과 modularity 계산을 Rust/WASM에 추가했다.
- `detectCommunities()`는 entity id를 안정적으로 정렬해 numeric node index로 매핑하고, edge index/weight 배열을 Rust/WASM에 넘긴다.
- entity/relation record 접근, relation confidence를 edge로 합치는 `buildEdges()`, community summarizer/LLM 호출, graph store persistence는 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 index/modularity 검증 실패 시 기존 TypeScript community detection 루프를 그대로 사용한다.

## 현재 열 번째 slice

- GraphRAG local/evidence-first retrieval의 evidence score traversal을 Rust/WASM에 추가했다.
- `collectLocalEvidenceScores()`는 mentioned entity, relation, claim, evidence id를 numeric index 배열로 바꾼 뒤 Rust/WASM에 먼저 맡긴다.
- entity/relation/claim/evidence record 조회, ontology filtering, ID 문자열 매핑, vector store 후보 조립과 compatibility filter는 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 wire-format/index 검증 실패 시 기존 TypeScript evidence scoring 루프를 그대로 사용한다.

## 현재 열한 번째 slice

- GraphRAG global community summary ranking을 기존 Rust/WASM vector top-k bridge에 연결했다.
- `queryGlobal()`은 schema filtering과 community 객체 조립은 TypeScript에서 유지하고, summary vector cosine ranking과 topK 선택은 `rankTopKPairsRust()`를 우선 사용한다.
- Rust/WASM 초기화 또는 ranking index 검증 실패 시 기존 TypeScript cosine/sort 경로를 그대로 사용한다.

## 현재 열두 번째 slice

- GraphRAG relation edge aggregation을 Rust/WASM에 추가했다.
- `buildEdges()`는 entity/relation record 접근, unknown endpoint filtering, lexicographic entity id mapping은 TypeScript에서 유지하고, 무방향 endpoint pair별 confidence 합산은 `aggregateGraphEdgesRust()`를 우선 사용한다.
- Rust/WASM에는 numeric source/target/confidence 배열만 넘긴다. Rust는 `[sourceIndex, targetIndex, weight]` flat triple을 첫 출현 순서대로 반환한다.
- Rust/WASM 초기화 또는 triple/index 검증 실패 시 기존 TypeScript `Map` 기반 aggregation 루프를 그대로 사용한다.

## 현재 열세 번째 slice

- 채팅 context expansion의 vault link extraction을 Rust/WASM에 추가했다.
- `extractVaultLinks()`는 Obsidian host I/O 없이 content 문자열만 파싱하므로 `extractVaultLinksRust()`를 우선 사용한다.
- Rust/WASM은 wikilink, embed wikilink, Markdown link target 추출, alias/heading/block 제거, percent decoding, 외부 URL 제외, case-insensitive dedupe를 담당한다.
- `expandReferencedVaultFiles()`의 `TFile` resolve, `metadataCache`, `vault.cachedRead`, warning 생성은 TypeScript 경계에 남긴다.
- Rust/WASM 초기화 또는 JSON 검증 실패 시 기존 TypeScript parser를 그대로 사용한다.

## 현재 열네 번째 slice

- RAG vault file filtering의 exclude path matching을 Rust/WASM에 추가했다.
- `isExcludedPath()`는 path normalization, folder segment matching, `**/`/`/**`, glob-like `*`, extension shorthand matching을 `isExcludedPathRust()`에 먼저 맡긴다.
- `getRagCandidateFiles()`, `getRagFileTypeSummary()`, `getMarkdownFilesFiltered()`는 Obsidian `Vault` file enumeration과 text-readability check를 TypeScript에 유지하고, path/pattern matching만 Rust/WASM 경로를 우선 사용한다.
- Rust/WASM 초기화 실패 시 기존 TypeScript matcher를 그대로 사용한다.

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
