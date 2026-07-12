# GraphRAG·온톨로지 신뢰성 구현 계획

> **상태:** 폐기됨 — `../specs/2026-07-13-resumable-graphrag-extraction-design.md`의 고정 온톨로지 제거 및 durable extraction 방향으로 대체한다.

## 성공 기준

- 무료 LLM의 ID-reference payload가 Rust/WASM에서 entity·relation·claim 연결을 보존한다.
- 채팅 `auto` Graph query는 외부 LLM planner 없이 결정론적으로 실행되고 provider deadline 안에 끝난다.
- Graph가 선택한 관계·community 근거가 검증된 출처와 함께 채팅 컨텍스트와 출처 표면에 반영된다.
- Graph 자동 동기화 interval, single-flight, batch limit, backoff가 실제 runtime에 연결된다.
- BM25 실패가 Graph runner와 일반 RAG 준비를 막지 않는다.
- 내장 ontology와 extraction contract version의 역할이 분리되고 dead setting이 제거된다.
- pending merge가 자동 재평가 또는 사용자 결정으로 수렴한다.
- 전체 품질 게이트와 실제 화면 검수를 통과한다.

## 작업 순서

1. Rust와 TS 테스트에 무료 LLM ID-reference fixture, partial parse 품질, deterministic query plan, extraction contract freshness 계약을 먼저 추가한다.
2. Rust Graph payload normalizer를 payload-wide reference lookup과 fact별 rejection plan으로 확장하고 TS bridge 타입을 갱신한다.
3. extraction cache와 status에 extraction contract version·품질을 반영하고 unusable 응답의 단일 repair retry를 구현한다.
4. `auto` Graph query의 LLM planner 의존성을 제거하고 Rust deterministic planner, AbortSignal, realistic deadline을 연결한다.
5. Graph contribution metadata를 retrieval result와 chat context/source presentation에 전달한다.
6. Graph auto-sync scheduler를 실제 interval, single-flight, bounded backoff로 구현하고 background Notice 반복을 제거한다.
7. BM25 optional initialization 경계를 분리해 timeout 뒤에도 Graph runner와 RAG engine이 준비되도록 고정한다.
8. `ontologyEnabled` dead contract를 제거하고 ontology schema version과 extraction contract version을 분리한다.
9. Rust graph-wide entity merge plan과 store transaction을 추가하고 pending pair 재평가 및 Graph explorer의 보수적 수동 결정을 구현한다.
10. 관련 단위·통합 테스트를 통과시킨 뒤 lint, typecheck, test, performance, security, build, review gate를 순서대로 실행한다.
11. UI 변경분을 `.test-vault` 또는 재현 가능한 브라우저 시뮬레이션에서 일반·좁은 폭·오류·진행·복구 상태로 스크린샷 검수한다.

## 주요 변경 범위

- `crates/rag-wasm/src/lib.rs`
- `src/rag/rust-core.ts`
- `src/ontology/schema.ts`
- `src/graph/extraction.ts`
- `src/graph/store.ts`
- `src/graph/entity-resolver.ts`
- `src/graph/query-engine.ts`
- `src/graph/indexing-runner.ts`
- `src/graph/status.ts`
- `src/graph/view.ts`
- `src/rag/query.ts`
- `src/rag/retrieval-pipeline.ts`
- `src/chat/context.ts`
- `src/chat/source-panel.ts`
- `main.ts`
- `src/settings.ts`
- `src/i18n.ts`
- `styles.css`
- 관련 Rust·Vitest 테스트와 개발 문서

## 구현 경계

- 새 사용자 정의 ontology editor나 외부 graph database를 추가하지 않는다.
- Graph 판단·정규화·merge policy는 Rust/WASM에 둔다.
- TypeScript는 Obsidian lifecycle, provider transport, IndexedDB transaction, DOM 렌더링만 담당한다.
- Graph 실패는 vector/BM25/ANN/structural retrieval과 일반 채팅을 차단하지 않는다.
- 복구 UI는 Graph 탐색기의 마지막 disclosure에만 두고 일상 흐름에 노출하지 않는다.
