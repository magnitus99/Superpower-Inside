# GraphRAG·온톨로지 신뢰성 및 채팅 체감 개선 설계

**상태:** 승인됨

**작성일:** 2026-07-11

**대상:** Rust/WASM GraphRAG 코어, Graph 추출·저장·질의 계층, RAG 런타임, 채팅 출처 UI

## 1. 목표

GraphRAG와 내장 온톨로지가 무료 또는 구조화 출력 품질이 일정하지 않은 LLM에서도 안전하게 지식 그래프를 생성하고, 일반 채팅의 응답 지연을 늘리지 않으면서 실제 근거 선택과 답변 맥락을 보강하도록 만든다.

사용자는 GraphRAG의 내부 유지보수 상태를 계속 관리하지 않는다. 플러그인은 가능한 작업을 조용히 진행하고, 자동 복구할 수 없는 경우에만 한 문장의 상태와 하나의 다음 행동을 제공한다.

## 2. 현재 상태 감사

### 2.1 구현되어 있는 부분

- Rust/WASM이 온톨로지 스키마와 relation domain/range를 검증한다.
- Rust/WASM이 LLM Graph payload 정규화, 엔티티 일치 점수, merge 판정, relation endpoint index 계획, community detection, local evidence scoring, graph query plan 정규화를 담당한다.
- TypeScript는 Obsidian·IndexedDB·provider·DOM 경계와 Rust plan 결과 매핑을 담당한다.
- Graph evidence, entity, relation, claim, community, rejected fact, extraction cache, pending merge 저장소가 존재한다.
- Graph 후보는 일반 vector/BM25/ANN/structural 후보와 하나의 retrieval pipeline에서 합쳐진다.
- 채팅 출처 표면은 GraphRAG 내부 용어 대신 검증된 근거와 관계 보강 의미를 표시할 수 있는 타입을 이미 보유한다.

### 2.2 확인된 결함

1. 현재 `auto` graph query는 최대 2초인 LLM planner를 호출하지만 Graph candidate provider deadline은 180ms다. 따라서 LLM 응답이 정상이어도 Graph 후보가 먼저 timeout 될 수 있다.
2. candidate provider의 AbortSignal이 Graph query와 provider chat까지 전달되지 않아 timeout 뒤에도 불필요한 LLM 호출이 계속될 수 있다.
3. 무료 LLM 실응답은 엔티티에 `id: E1`, `label: 바오로`를 주고 relation endpoint에는 `E1`을 사용하는 형태였다. Rust parser는 `label`을 엔티티 이름으로 복구하지만 endpoint ID를 그 이름으로 다시 연결하지 않는다. 결과적으로 엔티티와 claim 일부는 저장되고 relation은 거부된다.
4. 일부 fact가 정상인 payload는 relation이나 claim 연결이 손실돼도 extraction cache가 완료 상태로 기록될 수 있다.
5. `graphRagAutoSyncIntervalMin`은 설정 UI와 저장값만 있고 실제 주기 스케줄러에 연결되지 않는다.
6. `ontologyEnabled`는 설정 타입·기본값·마이그레이션 외에는 런타임 의미가 없다.
7. pending entity merge는 저장되고 개수는 표시되지만 적용·거부·재평가 경로가 없다.
8. 테스트 볼트에서는 Graph evidence가 존재하지만 모든 후보 파일이 stale인 상태가 확인됐다. 현재 제한량과 트리거 방식으로는 자동 수렴이 보장되지 않는다.
9. BM25 로드 지연이 전체 RAG 초기화 경로를 오래 점유해 Graph runner와 query engine 준비 시점을 불필요하게 늦출 수 있다.
10. local Graph retrieval은 관련 원문 근거를 고르는 데 기여할 수 있지만, 채팅 표면에서는 Graph가 실제로 기여했는지 명확히 구분되지 않아 사용자가 체감하기 어렵다.

## 3. 설계 원칙

### 3.1 Rust/WASM 결정 경계

다음 결정적 로직은 Rust/WASM이 소유한다.

- LLM Graph payload shape 복구와 reference 정규화
- raw entity reference에서 canonical entity name으로의 연결
- relation·claim reference 유효성 및 extraction 품질 판정
- deterministic graph query mode·depth·evidence-first 판정
- entity merge 후보 판정과 pending merge 처리 계획
- Graph contribution 요약에 필요한 구조화된 plan

TypeScript는 다음만 담당한다.

- provider 요청과 AbortSignal 전달
- Rust plan과 IndexedDB record 사이 매핑
- 스케줄러 등록과 Obsidian lifecycle 연결
- 로그·상태 이벤트·Notice·DOM 렌더링

### 3.2 채팅 hot path에서 LLM 제거

일반 채팅 retrieval은 외부 Graph query planner를 기다리지 않는다. `auto` 모드는 Rust의 deterministic planner로 즉시 계획한다. 추출 모델은 background graph construction과 community summary에만 사용한다.

이 원칙으로 다음을 보장한다.

- 무료 LLM의 지연이나 routing 변화가 채팅 Graph retrieval을 timeout시키지 않는다.
- candidate provider deadline과 내부 연산 시간이 일치한다.
- Graph retrieval 실패가 vector/BM25/ANN/structural retrieval을 막지 않는다.

### 3.3 부분 성공은 보존하고 손실은 관찰 가능하게 한다

Graph payload 전체가 완벽하지 않아도 검증된 fact는 저장한다. 다만 누락된 relation·claim reference를 조용히 폐기하고 extraction을 완료로 기록하지 않는다.

Rust parse 결과는 다음 정보를 포함한다.

- 정규화된 entities, relations, claims
- raw fact 수와 accepted fact 수
- 복구된 reference 수
- 거부된 fact와 reason
- 결과 품질 상태: `complete`, `partial`, `unusable`

`unusable`만 최대 1회 repair 요청 대상이 된다. `partial`은 검증된 fact를 저장하고 rejected fact를 함께 기록한다. 동일 chunk에 대한 무한 재시도는 금지한다.

## 4. 구성 요소 설계

### 4.1 Rust Graph payload normalizer

`normalize_extracted_graph_payload`는 payload 전체를 한 번에 해석한다.

1. 각 raw entity에서 canonical name을 `name → canonicalName → label → id` 순서로 선택한다.
2. raw `id`, canonical name, label, alias를 reference lookup에 등록한다.
3. 동일 reference가 여러 entity에 매핑되면 ambiguous로 판정하고 자동 연결하지 않는다.
4. relation의 source·target과 claim의 entity reference를 lookup으로 canonical name에 연결한다.
5. 이미 canonical name인 endpoint도 같은 lookup 경로를 통과한다.
6. unknown·ambiguous reference는 fact 단위 rejection으로 반환한다.
7. entity type, relation type, claim type, domain/range 검증은 기존 strict ontology 계약을 유지한다.

무료 LLM의 흔한 변형은 복구하지만, 없는 엔티티·관계·번역 alias를 새로 발명하지 않는다.

### 4.2 Extraction orchestrator

`GraphExtractionIndexer`는 Rust parse 품질 plan을 따른다.

- `complete`: 검증 fact 저장 후 cache 완료 기록
- `partial`: 검증 fact와 rejection을 저장하고, 해당 extraction의 품질을 cache record에 남김
- `unusable`: 동일 요청을 더 엄격한 repair prompt로 한 번 재시도하고, 다시 실패하면 rejection 저장
- abort: 어떤 retry나 cache 완료도 기록하지 않고 즉시 전파

repair prompt는 원문 전체를 다시 설명하게 하지 않고, 직전 raw 응답과 허용 스키마를 주어 JSON contract만 고치게 한다. provider별 새 설정은 추가하지 않는다.

기존 손상된 추출을 다시 계산할 수 있도록 extraction contract version을 cache freshness 판정에 포함한다. 온톨로지 의미 버전과 parser 구현 버전은 분리한다.

### 4.3 Deterministic Graph query planner

Rust planner는 질문의 언어와 관계없이 다음 신호를 사용한다.

- 출처·근거 요청: evidence-first local
- 비교·관계·영향·원인·연결 질문: local 또는 hybrid, depth 1~2
- 주제·전체 경향·공통점 질문: global 또는 hybrid
- 일반 질문 또는 graph entity 단서 없음: ordinary RAG 또는 local fallback

entity hint는 저장된 entity label과 alias를 Rust에서 매칭한다. LLM query planner 클래스는 chat hot path에서 제거한다. 필요하면 향후 offline evaluation 도구로만 유지할 수 있지만 런타임 필수 의존성이 되어서는 안 된다.

Graph candidate provider는 AbortSignal을 query engine과 store lookup에 전달한다. deadline은 실제 IndexedDB lookup과 Rust scoring 측정값을 기준으로 정하되, 외부 네트워크 호출을 포함하지 않는다.

### 4.4 Graph contribution과 채팅 컨텍스트

Graph가 선택한 원문 entry에는 구조화된 contribution metadata를 붙인다.

- graph source 종류: local relation, global community, evidence-first
- 선택 이유
- 관련 entity·relation 수
- 원문 evidence ID

채팅 context composer는 원문 인용을 그대로 유지하고, 검증된 Graph contribution만 짧은 context note로 추가한다. Graph가 반환한 관계가 원문 evidence와 연결되지 않으면 답변 맥락에 넣지 않는다.

사용자 표면은 다음처럼 표현한다.

- 출처 행: `관계 근거로 보강됨`
- attachment detail: `연결된 근거 N개 포함`
- global community: `여러 문서의 공통 주제로 보강됨`

일반 화면에서 `GraphRAG`, ontology schema ID, traversal depth 같은 내부 용어를 노출하지 않는다. Graph 탐색기와 진단 복구 영역에서는 기술 세부 정보를 볼 수 있다.

### 4.5 실제 자동 동기화

플러그인 lifecycle에 Graph auto-sync scheduler를 등록한다.

- 설정된 interval마다 상태를 계산한다.
- GraphRAG가 활성화되고 provider·embedding·store가 준비됐으며 다른 indexing이 없을 때만 실행한다.
- 한 tick에서 `graphRagMaxFilesPerRun`을 넘지 않는다.
- 이전 tick 실패 시 bounded exponential backoff를 적용한다.
- vault 변경 debounce와 주기 scheduler가 동시에 실행돼도 single-flight gate가 하나의 run만 허용한다.
- 정상 background 진행은 Notice를 띄우지 않고 상태 이벤트와 진단 로그만 갱신한다.
- 사용자 행동이 필요한 반복 실패만 RAG 상태 영역에서 primary action 하나로 표시한다.

BM25 초기화는 independent optional capability로 취급한다. BM25 timeout 또는 rebuild 실패 뒤에도 vector store, Graph runner, RAG query engine 준비를 완료한다.

### 4.6 온톨로지 런타임 계약

현재 제품은 사용자 정의 ontology editor를 제공하지 않는다. 따라서 이번 범위에서는 내장 ontology 하나를 명시적인 제품 계약으로 유지한다.

- GraphRAG 활성화는 내장 ontology 사용을 의미한다.
- 작동하지 않는 `ontologyEnabled` 설정은 제거하고 legacy 값은 무시한다.
- `ontologyProfileId`처럼 구현되지 않은 비공식 저장값은 런타임 선택으로 해석하지 않는다.
- schema version은 entity·relation·claim 의미가 바뀔 때만 증가시킨다.
- extraction contract version은 parser·normalizer 호환성이 바뀔 때 별도로 증가시킨다.

사용자 정의 ontology나 도메인별 schema profile은 이번 신뢰성 수정에 포함하지 않는다. 향후 추가하더라도 자동 감지와 안전한 기본값 없이 새 필수 설정을 만들지 않는다.

### 4.7 Pending merge 수명주기

pending merge를 영구 누적 상태로 두지 않는다.

- 동일 candidate pair는 하나의 pending record로 dedupe한다.
- 새 evidence가 추가되면 Rust가 pair를 재평가한다.
- exact label·alias와 동일 type처럼 결정적 조건이 충족되면 자동 병합한다.
- semantic similarity만 높은 cross-language pair는 자동 병합하지 않는다.
- 자동 병합은 entity뿐 아니라 relation endpoint, claim entity ID, community entity ID, evidence와 remaining pending records를 Rust plan에 따라 원자적으로 갱신한다.
- 여전히 모호한 항목만 Graph 탐색기의 접힌 복구 영역에 표시한다.
- 사용자는 `병합` 또는 `별개로 유지` 중 하나를 선택할 수 있으며, destructive bulk action은 제공하지 않는다.

## 5. 오류 처리

- provider timeout·rate limit·invalid JSON은 file/chunk failure로 기록하되 일반 RAG를 비활성화하지 않는다.
- AbortError는 failure나 rejected fact로 계산하지 않는다.
- WASM wire-format 실패는 TypeScript에서 Graph 계산으로 재구현하지 않는다. 안전한 빈 결과 또는 오류 전파 계약을 사용한다.
- graph query timeout은 retrieval diagnostic에 남기고 다른 candidate provider 결과를 그대로 사용한다.
- stale Graph data가 현재 ontology schema와 호환되는 경우 supporting evidence로 사용할 수 있다. extraction contract가 호환되지 않는 data는 query에서 제외한다.
- background sync 반복 실패는 backoff하며 동일 Notice를 반복하지 않는다.

## 6. 테스트 전략

### 6.1 Rust unit tests

- `id + label` entity와 ID endpoint relation을 canonical name으로 연결한다.
- claim의 ID 배열과 subject/object 변형을 entity name으로 연결한다.
- ambiguous ID·label은 자동 연결하지 않는다.
- partial payload가 accepted/rejected count와 reason을 보존한다.
- deterministic query planner가 factual·relational·thematic·comparative·source-seeking·ordinary 질문을 올바른 mode로 분류한다.
- extraction contract version mismatch가 stale 판정을 만든다.
- pending merge 재평가와 graph-wide merge plan이 모든 참조를 일관되게 갱신한다.

### 6.2 TypeScript tests

- 실제 무료 LLM 응답 fixture가 relation과 claim을 정상 저장한다.
- unusable 응답만 한 번 repair되고 abort 시 retry하지 않는다.
- `auto` query가 provider chat을 호출하지 않는다.
- Graph candidate provider가 deadline 안에 local/global 후보를 반환하고 AbortSignal을 전파한다.
- auto-sync scheduler가 interval, single-flight, batch limit, backoff를 지킨다.
- BM25 timeout 뒤에도 Graph runner와 RAG engine이 준비된다.
- Graph contribution이 검증된 원문 출처와 함께 chat context에 포함된다.
- pending merge 수동 결정이 store 전체 reference를 일관되게 갱신한다.

### 6.3 회귀 및 통합 검증

- 기존 Graph·ontology·RAG·chat 테스트를 모두 유지한다.
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run rag:perf-gate`
- `npm run security:full`
- `npm run build`
- `npm run review -- --tag <manifest-version> --built`

Rust/WASM 변경이 있으므로 `security:full`의 rustfmt, clippy, Rust tests, wasm build, cargo-deny, cargo-audit, cargo-vet, cargo-geiger와 generated WASM 최신성 검사를 모두 통과해야 한다.

## 7. 실제 화면 검수

UI 변경은 코드와 gate 검증 뒤 마지막에 확인한다.

필수 화면:

- 일반 relational 질문에서 관계 근거가 포함된 출처 상태
- thematic 질문에서 여러 문서 공통 주제 출처
- Graph 기여가 없는 일반 RAG 응답
- background sync 진행·부분 실패·재시도 대기 상태
- pending merge 복구 disclosure의 빈 상태와 항목 상태
- 좁은 sidebar에서 긴 파일명·entity명·오류 메시지 줄바꿈
- light/dark theme, focus-visible, disabled, 진행 중 상태

실제 Obsidian 앱 조작은 사용자가 수행하며, 작업자는 `.test-vault` 상태·로그·코드 또는 재현 가능한 브라우저 시뮬레이션을 이용해 스크린샷을 직접 확인한다. 실제 화면을 확인하지 못하면 UI/UX 완료를 주장하지 않는다.

## 8. 완료 조건

다음 조건을 모두 만족해야 완료다.

1. 무료 LLM의 ID-reference Graph payload가 relation·claim 연결을 보존한다.
2. 채팅 `auto` Graph query가 외부 LLM planner 없이 deadline 안에 실행된다.
3. Graph가 선택한 관계·community 근거가 검증된 출처와 함께 채팅 컨텍스트와 출처 UI에 반영된다.
4. 자동 동기화 interval이 실제 동작하고, 중복 실행과 반복 오류 알림을 만들지 않는다.
5. BM25 실패가 Graph와 일반 RAG 준비를 막지 않는다.
6. 내장 ontology와 extraction contract version의 역할이 분리되고 dead setting이 제거된다.
7. pending merge가 자동 재평가 또는 사용자 결정으로 수렴할 수 있다.
8. 모든 필수 품질 게이트가 실제 exit 0으로 통과한다.
9. UI 변경분의 실제 스크린샷 검수가 완료된다.

## 9. 범위 제외

- 사용자 정의 ontology editor
- 여러 ontology profile을 선택하는 설정
- 외부 graph database 또는 server dependency
- GraphRAG 전용 유료 기능
- 채팅 hot path의 새 외부 LLM 호출
- 기존 vector/BM25/ANN/structural retrieval의 전면 교체
