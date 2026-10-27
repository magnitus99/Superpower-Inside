---
id: vault-evidence
type: module-design
status: draft
title: 볼트 근거 심사와 답변 계약
parent: superpower-architecture
references: [superpower-goals, chat-contract, search-quality, product-philosophy]
---

# 볼트 근거 심사와 답변 계약

## 책임과 의도

공통 검색 입력에서 후보를 수집하고 원문을 검증해 답변용 dossier와 출처를 만든다. 기본 조사는 모델이 검색 도구를 자발적으로 고를 때까지 기다리지 않는다. LLM 후속 검색·읽기·연결 탐색은 엔진이 발견한 단서를 깊게 조사하는 수단이며 기본 발견·집계를 대체하지 않는다. 품질·대조의 상세 정본은 `search-quality`를 따른다.

엔진의 일치 인벤토리는 문서 수·근거 구간 수·발생 횟수와 구문 일치 문서를 표현한다. 순위나 채택 근거 수와 다르다. 직접 인용은 엔진 구문 판정으로만 서술하며 열거 질문에서는 확인된 문서를 예산을 이유로 생략하지 않는 것이 요구 계약이다.

## 근거 자격과 실패 경계

채팅에 채택할 문서는 현재 본문을 다시 읽고 revision·파일 content hash를 확인하며 같은 청킹 규칙의 구절·절대 행을 Rust로 검증하는 것이 요구 계약이다. mtime:size나 hash 하나만으로 색인 사본을 verified로 승격하지 않으며 재검증 실패는 해당 근거·answerPlan을 제외한 incomplete로 처리한다. 아래 현재 차이를 함께 적용한다. 색인 후보, 인벤토리, 저장된 주소와 현재 원문 검증 출처를 구분한다. 읽기 전후 stat 검사는 파일 변경을 감지하는 보호 장치이며 그 자체가 quote 검증은 아니다.

필터 제외·검증 실패·예산 밖·미검토·미색인·읽기 실패를 자료 부재나 모델의 관련성 판단으로 바꾸지 않는다. 하드 제외 자료는 후보·점수·집계의 세계 밖에 두고 검색 결과에서 그 존재를 노출하지 않는 것이 정책이다. 검색 내 미검토 자료와 하드 제외를 혼동하지 않는다.

indexing·engine-unavailable·no-evidence·evidence-only를 구분하고 반환된 한계와 검증 출처를 유지한다. answerPlan 형식 실패는 같은 제공자의 같은 모델로 한 번만 교정하며 다시 실패하거나 answerPlan을 계산할 수 없으면 그 답변 시도를 검증된 evidence-only로 끝낸다. 외부 결과나 관련성 판단만으로 실패한 인용을 verified로 승격하지 않는다. 후속 조사에도 현재 정책·원문 검증·실행 취소 경계를 적용한다.

## 전달·비교·후속 조사 요구

기본 documentScope all에서 접근 가능한 전체 색인의 lexical 후보를 BM25로 평가한다. hybrid 후보는 순위 prior이며 검토 세계를 제한하지 않는다. 후보 초기화 불가·빈 후보·일부 facet 실패여도 전체 lexical 평가와 원문 검증 후보 구성을 계속한다. 기본 발견·집계·구문 판정·구간 주소는 모델 도구 왕복 없이 엔진 한 번·색인 한 순회에서 확보하는 것이 목표다.

인벤토리는 점수·후보 컷에 쓰지 않고 수치를 그대로 전달한다. 비교는 Rust facet 계획과 후보 queryIndex 귀속을 사용하며 supported facet의 주장과 양쪽 supported 근거가 있는 종합만 허용한다. missing facet을 supported로 바꾸거나 근거 없는 직접 비교를 만들지 않는다. 주변 맥락·조건·예외·상충 근거를 보존하고 확인 사실과 문서 전제에 근거한 추론을 구분한다.

quote-missing·position-mismatch·revision-mismatch·out-of-scope는 엔진 검증 사유로 제외하며 모델의 관련성 판단으로 표현하지 않는다. engine-unavailable·indexing은 반환 content·검증 citations로 종료하고 엔진 실패를 우회하는 모델 도구 루프로 대체하지 않는다. no-evidence·evidence-only도 한계를 보존하며 evidence-only 표시 본문을 JSON으로 재해석하지 않는다.

단서 기반 읽기 전용 search/read/list/links/related와 전체 열거에도 현재 접근·제외·필터·revision·원문 검증·취소를 적용한다. 후속 근거가 없으면 원래 제한 상태를 유지하며 추가 조사 허용이 교정 한도를 없애거나 검증 실패 답변을 게시할 권한은 아니다. 실제 최종 답변의 의미 충실도는 형식 검증과 별개다.

발견·검증·판정의 기본 주체는 결정적 검색 엔진이다. LLM은 엔진이 확보한 근거를 해석·종합하며 후보 선별자나 근거 검증자로 대체되지 않는다. 도구 호출은 엔진의 기본 결과가 부족할 때 조사를 깊게 하는 수단이며 기본 발견·검증을 대신하는 경로가 아니다.

확신도가 낮은 후보를 잘라 버리지 않는다. 확신도와 대안 해석을 함께 제시하고 확신이 높은 근거를 먼저 보여 주며, 확인한 범위와 의도한 자료가 다를 수 있음을 사용자가 확인할 수 있게 한다. 맥락이 다르다는 이유로 전부 제외하는 것과 확인을 요청하는 것은 다른 결과다.

## 현재 구현과 목표의 차이

- `src/search/indexed-search-deps.ts`는 exhaustive lexical 후보와 discovery 단서를 보유하면서 원문 심사 경로를 최대 96개로 선택한다. 따라서 전체 lexical 평가를 전체 현재 원문 검토 완료로 해석할 수 없다. `indexed-vault-review.ts`의 `exhaustiveReview` coverage 표현 역시 이 두 의미가 분리돼 있음을 보장하지 못한다.
- 기본 생성에는 인벤토리 총계가 전달되지만 문서별 검증 열거는 후속 `enumerate` 경로다. 임의 열거 질문의 무누락을 기본 생성만으로 보장하지 않는다. 관련 근거는 `indexed-vault-followup.ts`, `indexed-vault-enumeration.ts`와 `indexed-vault-review.test.ts`다.
- 채팅 검증은 현재 본문을 사용하지만 정상 경로에서 색인 파일 content hash와 현재 hash를 직접 비교하는 게이트는 확인되지 않았다. 이 명세의 hash 확인 요구를 이미 충족했다고 간주하지 않는다. 검색 화면은 `verifyCurrentSource: false`이므로 같은 검증 보장이 아니다.
- 기본 발견·집계·주소를 엔진 한 번·색인 한 순회에서 얻는 것이 목표다. 현재는 facet별 검색·집계와 배치별 WASM 계획이 있으며, `src/chat/query-variants.ts`의 제공자 호출은 로컬 질의 계획만 허용한 기존 계약과 다르다. 이번 편입에서 동작이나 정책을 변경하지 않는다.

구현 중심은 `indexed-vault-review.ts`의 `searchIndexedVault`·`reviewIndexedVault`다. `research-agent.ts`의 존재를 현재 주 실행 경로의 증거로 쓰지 않는다. 회귀 근거는 `indexed-vault-review.test.ts`, `indexed-vault-search.test.ts`, `indexed-vault-followup.test.ts`, `src/search/indexed-search-deps.test.ts`, `src/search/engine-adapter.test.ts`다. 로컬 회귀 계약과 실제 답변·전체 recall 검증은 별개이며, 이번 편입에서는 실제 답변·전체 recall을 재측정하지 않았다. 달성 상태와 종료 판정은 [검색 품질 스펙](../../search-quality.md)의 검증 상태 절이 소유한다.
