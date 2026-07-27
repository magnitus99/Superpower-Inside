# 재개 가능한 GraphRAG 추출 및 지식 계약 설계

**상태:** 승인됨

**작성일:** 2026-07-13

**대상:** Rust/WASM GraphRAG 코어, Graph 추출 작업 수명주기, IndexedDB 저장소, provider 실행 제어

**대체 관계:** 이 문서는 `2026-07-11-graphrag-ontology-reliability-design.md`의 엄격한 내장 온톨로지 유지 정책을 대체한다. 기존 문서에서 이미 구현된 ID reference 복구, deterministic query planning, stale sync, pending merge 수명주기 개선은 유지하되 새 추출 계약에 맞춰 재검증한다.

## 1. 목표

GraphRAG 색인이 무료 또는 세션 안정성이 낮은 LLM에서도 중복 없이 결국 수렴하게 한다. 앱, provider 세션, 네트워크 요청이 어느 단계에서 끊겨도 이미 받은 응답과 검증된 결과를 잃지 않고 재개한다.

고정 도메인 온톨로지는 제거한다. 대신 모든 entity, relation, claim이 원문 evidence와 유효한 local reference를 갖도록 하는 범용 `KnowledgeGraphContract`를 강화한다. Rust/WASM은 추출 이후의 모든 결정적 계산을 담당하고, TypeScript는 provider transport, Obsidian lifecycle, IndexedDB transaction만 담당한다.

## 2. 결정 사항

### 2.1 동시성

- Graph extraction provider 요청의 기본 동시성은 1이다.
- 무료 또는 capability가 확인되지 않은 provider는 동시성 1을 유지한다.
- 이번 범위에서는 자동 동시성 증가를 구현하지 않는다. 관측 지표가 축적된 뒤 별도 설계로 다룬다.
- 429, timeout, connection reset은 provider 단위 circuit breaker와 bounded backoff를 적용한다.
- 동시성은 사용자 설정으로 노출하지 않는다.

### 2.2 Rust/WASM 경계

Rust/WASM이 소유한다.

- extraction payload parsing과 구조 복구
- response-local entity/relation/claim reference 검증
- 이름과 relation label 정규화
- deterministic fact ID와 request fingerprint 입력 계획
- entity resolution, fact dedupe, conflict/reconciliation plan
- context 예산에 따른 Markdown extraction unit 분할 계획
- graph diff, community detection, 계층 계획, ranking

TypeScript가 소유한다.

- provider 요청과 AbortSignal
- durable job scheduler와 lease heartbeat
- raw response write-ahead 저장
- IndexedDB transaction
- Obsidian lifecycle, 상태 이벤트, 진단 로그

대형 Rust/WASM 계산은 메인 렌더러 스레드가 아니라 전용 Web Worker에서 실행한다. 첫 구현은 단일 Worker이며 shared-memory WASM threads는 범위에서 제외한다.

### 2.3 온톨로지 제거와 지식 계약 유지

다음을 제거한다.

- 고정 relation whitelist의 hard rejection
- 모든 vault에 동일 domain/range를 적용하는 정책
- 사용되지 않는 `symmetric`, `transitive`, `inverseRelationTypeId`, property ontology 계약
- `OntologySchema`와 ontology version이 extraction cache를 지배하는 구조
- 일반 사용자 화면의 ontology 용어

다음을 유지하거나 강화한다.

- 범용 entity type 힌트: `person`, `organization`, `place`, `document`, `event`, `concept`, `other`
- 원문 relation label과 별도 normalized relation label
- entity, relation, claim의 response-local ID
- 모든 fact의 evidence reference와 source span
- unknown relation 보존
- 존재하지 않거나 ambiguous한 reference 거부
- extraction contract version과 provenance

타입과 normalized relation은 검색과 표시를 돕는 힌트이며 진실의 최종 권위가 아니다. 최종 권위는 원문 evidence다.

## 3. 데이터 모델

### 3.1 Extraction job

IndexedDB에 durable job을 저장한다.

```ts
interface GraphExtractionJobRecord {
  id: string;
  requestFingerprint: string;
  entryId: string;
  filePath: string;
  contentHash: string;
  contractVersion: number;
  providerKey: string;
  requestedModel: string;
  observedModel?: string;
  providerEpochId: string;
  state:
    | 'prepared'
    | 'leased'
    | 'response-received'
    | 'parsed'
    | 'validated'
    | 'committed'
    | 'retry-wait'
    | 'quarantined';
  attemptCount: number;
  nextAttemptAt?: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  rawResponseId?: string;
  lastErrorCode?: string;
  updatedAt: number;
}
```

앱 시작 시 만료된 `leased` job은 `prepared`로 회수한다. `AbortError`는 시도 실패로 계산하지 않고 lease만 해제한다.

### 3.2 Raw response

LLM 응답은 parsing 전에 영구 저장한다.

```ts
interface GraphRawResponseRecord {
  id: string;
  requestFingerprint: string;
  providerEpochId: string;
  body: string;
  bodyHash: string;
  receivedAt: number;
}
```

동일 fingerprint와 동일 body hash는 dedupe한다. parsing, validation 또는 commit 중 앱이 종료돼도 provider를 다시 호출하지 않는다.

### 3.3 Knowledge graph contract

추출 응답은 response-local ID를 사용한다.

```json
{
  "entities": [
    {
      "id": "e1",
      "name": "Example",
      "type": "concept",
      "aliases": [],
      "description": "...",
      "evidenceSpans": [{ "start": 0, "end": 7 }]
    }
  ],
  "relations": [
    {
      "id": "r1",
      "sourceRef": "e1",
      "targetRef": "e2",
      "label": "depends on",
      "description": "...",
      "evidenceSpans": [{ "start": 10, "end": 30 }]
    }
  ],
  "claims": [
    {
      "id": "c1",
      "text": "...",
      "entityRefs": ["e1", "e2"],
      "relationRefs": ["r1"],
      "evidenceSpans": [{ "start": 10, "end": 30 }]
    }
  ]
}
```

Rust는 local ID 존재 여부, 중복 ID, span 범위, claim-relation endpoint 일관성을 검증한다. 한 claim에 같은 청크의 모든 relation을 연결하는 기존 동작은 금지한다.

기존 name 기반 payload는 한 contract version 동안 호환 parser로 수용하되 새 cache 결과는 local-ID 계약으로만 생성한다.

### 3.4 Provenance와 generation

각 fact는 다음 provenance를 가진다.

- entry ID와 content hash
- evidence ID와 source span
- extraction contract version
- provider epoch ID
- 실제 관측 model ID
- raw response hash
- 생성 시각

provider의 실제 모델이나 관측 capability가 바뀌면 새 epoch를 만든다. 다른 epoch의 결과를 자동 overwrite하지 않고 Rust reconciliation plan으로 합치거나 conflict 상태로 보존한다.

## 4. 작업 흐름

```text
VectorEntry 변경
  → prepared job 원자적 생성
  → provider circuit breaker 확인
  → lease 획득
  → 동시성 1로 요청
  → raw response write-ahead 저장
  → Rust parse
  → Rust reference/span validation
  → 하나의 transaction으로 evidence/facts/cache commit
  → committed
```

context overflow는 재시도하지 않고 Rust가 생성한 Markdown 경계 분할 plan으로 child job을 만든다. child ID는 parent ID와 범위에서 결정적으로 생성한다.

잘린 응답은 다음 순서로 처리한다.

1. Rust가 code fence와 앞뒤 잡음을 제거한다.
2. 완전한 fact record만 부분 복구한다.
3. 구조가 잘린 경우 더 작은 child job으로 원문을 재추출한다.
4. repair 요청은 짧고 복구 가능한 응답에 한해 최대 한 번 허용한다.
5. 반복 실패는 `quarantined`로 남기며 일반 RAG를 막지 않는다.

## 5. 오류와 재시도 정책

- 429: `Retry-After` 우선, 없으면 exponential backoff와 jitter
- timeout, connection reset, 502/503/504: bounded retry
- 401/403: retry 금지, provider circuit open
- context overflow: child job 분할
- invalid/truncated payload: 부분 복구 또는 더 작은 단위 재추출
- deterministic contract violation: fact 단위 rejection, 네트워크 retry 금지
- AbortError 또는 앱 종료: failure count 증가 없이 lease 회수

provider circuit은 `closed`, `open`, `half-open` 상태를 가진다. `half-open`에서는 probe job 하나만 허용한다. 정상 사용자는 이 상태를 관리하지 않으며, 장시간 자동 복구되지 않을 때만 연결 확인 action 하나를 본다.

## 6. GraphRAG 확장 경계

durable extraction 기반이 완성된 뒤 다음 순서로 원조 GraphRAG 기능을 확장한다.

1. Rust Leiden 계층 community plan
2. community별 durable summary job
3. child report를 입력으로 하는 bottom-up report
4. 기존 embedding top-k 기반 fast global search 유지
5. resumable map job과 reduce job 기반 deep global search
6. retrieval probe 기반 deterministic router
7. DRIFT는 별도 설계

community report도 member hash, child report hash, level, prompt hash, provider epoch를 cache key로 사용한다. 한 community 실패가 전체 hierarchy 재생성을 유발하지 않는다.

## 7. 마이그레이션

- 기존 graph record와 extraction cache는 즉시 파괴하지 않는다.
- 새 contract version 적용 후 stale로 판정된 entry만 재추출한다.
- 기존 ontology schema ID/version 필드는 읽기 호환 기간 동안 유지하되 새 decision logic에서는 사용하지 않는다.
- 기존 relation과 claim은 evidence가 유효하면 legacy generation으로 조회 가능하다.
- claim의 relation reference가 신뢰할 수 없는 legacy record는 relation 기반 설명에 사용하지 않고 재추출 대상으로 표시한다.
- migration은 vault 원문이나 기존 vector index를 변경하지 않는다.

## 8. 테스트 전략

### 8.1 Rust

- local ID reference와 evidence span을 검증한다.
- 존재하지 않거나 ambiguous한 reference를 fact 단위로 거부한다.
- claim에는 선언된 `relationRefs`만 연결한다.
- 동일 fact 입력이 동일 ID와 reconciliation plan을 만든다.
- provider epoch 간 동일·충돌 fact를 구분한다.
- context overflow child split이 Markdown 경계와 원문 범위를 보존한다.
- Leiden hierarchy와 community cache key가 결정적이다.

### 8.2 TypeScript

- 기본 extraction 동시성이 1을 넘지 않는다.
- 앱 재시작 시 만료 lease를 회수한다.
- raw response 저장 후 parse 실패가 provider 재호출을 만들지 않는다.
- 429, timeout, auth, context overflow가 서로 다른 정책을 따른다.
- AbortError가 failure count를 증가시키지 않는다.
- graph facts와 완료 cache가 하나의 transaction으로 commit된다.
- legacy name-based payload를 호환 기간 동안 읽는다.
- Graph 실패가 vector/BM25/ANN/structural retrieval을 막지 않는다.

### 8.3 게이트

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run rag:perf-gate`
- `npm run security:full`
- `npm run build`
- `npm run review -- --tag <manifest-version> --built`

Rust/WASM 변경은 rustfmt, clippy `-D warnings`, Rust tests, wasm build, cargo-deny, cargo-audit, cargo-vet, cargo-geiger와 generated WASM 최신성 검사를 모두 통과해야 한다.

## 9. 완료 조건

1. extraction provider 요청은 기본 동시성 1로 실행된다.
2. 앱 종료와 provider 세션 단절 뒤 미완료 job이 중복 fact 없이 재개된다.
3. raw response가 parsing 전에 저장되어 이미 받은 응답을 재사용한다.
4. claim은 명시한 relation reference만 보존하며 같은 청크의 모든 relation을 공유하지 않는다.
5. 고정 relation/domain ontology가 extraction hard gate에서 제거된다.
6. 모든 accepted fact는 유효한 evidence와 provenance를 가진다.
7. provider 변경과 충돌 사실을 overwrite하지 않고 generation별로 보존한다.
8. Graph 실패가 기본 RAG와 채팅을 차단하지 않는다.
9. 무거운 Rust/WASM graph 계산이 전용 Worker에서 실행된다.
10. 전체 품질 게이트가 실제 exit 0으로 통과한다.

## 10. 범위 제외

- 사용자 정의 ontology editor
- OWL/RDF 호환 reasoner
- shared-memory WASM threads
- 사용자가 조절하는 extraction concurrency 설정
- 첫 구현에서의 자동 concurrency 증가
- DRIFT search
- 외부 graph database
