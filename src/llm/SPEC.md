---
id: provider-boundary
type: module-design
status: draft
title: 모델 제공자와 자격증명 경계
parent: superpower-architecture
---

# 모델 제공자와 자격증명 경계

## 책임

제공자별 인증·메시지·스트림·도구 호출·임베딩 입출력을 공통 계약에 연결한다. 기본 메시지·ChatOptions 계약은 `providers.ts`가 소유한다. 제공자의 유창함이나 호출 성공이 볼트 출처의 자격 또는 답변 충실도를 증명하지 않는다.

연결 경로는 API 키 외에 ChatGPT·Gemini 로그인(`chatgpt-oauth.ts`·`google-gemini-oauth.ts`), 프로파일·사용자 정의 OpenAI 호환 제공자(`provider-resolution.ts`)를 포함한다. 엔드포인트에서 wire 형식을 추론하는 경로(`provider-api-format.ts`), 제공자별 capability·도구 왕복 상한(`provider-capabilities.ts`), 로컬 임베딩 모델 파일의 준비·삭제(`local-embedding-models.ts`)도 이 경계가 소유하며, 모델 파일의 생성물 수명은 `artifact-storage`가 맡는다.

사용자가 선택한 제공자·모델·추론 설정을 유지한다. 요청 실패나 근거 부족을 이유로 다른 모델·유료 경로로 조용히 전환하지 않는다. 재시도·기능 지원·buffered 응답·실제 abort 가능성은 제공자별로 구분하며 best-effort 취소를 원격 실행 중단 보장으로 표현하지 않는다.

## 한도·크레딧 조회

`provider-quota-api.ts`는 현재 연결의 기존 인증으로 읽기 전용 한도 조회를 조율하고, `provider-quota-service.ts`는 메모리 캐시와 하나의 전역 갱신 수명을 소유한다. `provider-quota-display.ts`는 공통 요약·번역으로 설정 연결명과 채팅의 선택 모델 옆 표시를 조립한다. 두 화면은 연결 ID의 공통 캐시만 읽고 별도 요청·타이머를 만들지 않는다. 연결 목록 아래 공통 간격 입력은 빈 목록에서도 보이며 가벼운 설정 저장으로 적용해 RAG·MCP를 재초기화하지 않는다. `quotaCheckIntervalSeconds`는 기본 30초이며 정상 입력의 기본값·10…3,600초 정수 제한과 응답 정규화·최소 창 선택은 `deterministic-core`에 위임한다. 요금제 이름으로 한도의 존재·기간·총량을 만들지 않는다. 잔여율이 같으면 실제 알려진 짧은 기간을 우선하며, 기간 미제공을 임의의 시간으로 보완하지 않는다.

조회 경로는 ChatGPT 로그인 `/backend-api/wham/usage`, Gemini 로그인 `v1internal:retrieveUserQuota`와 `:loadCodeAssist`, OpenCode Go `/zen/go/v1/usage`, Ollama Cloud `/api/balance`, OpenRouter `/api/v1/credits`다. OpenRouter는 구독 창이나 키의 지출 상한이 아니라 계정 크레딧만 취급한다. 공개 조회가 없는 OpenAI API·Claude API·Gemini API 키·OpenCode Console 잔액은 조회 불가이며, 사용자 지정 엔드포인트는 조회 미지원, 로컬 실행은 원격 한도 비대상이다. 공식 전략이라도 사용자 지정 URL의 키를 공식 서버에 전송하지 않는다. 내부 로그인·Go 조회 경로의 가용성은 제공자 변경에 따라 달라질 수 있다.

조회 실패·미제공·무제한·0·100%는 별개다. 조회 상태는 모델 실행 가능 여부를 변경하지 않으며, 과거 잔액을 현재 성공처럼 재사용하지 않는다. OAuth 갱신 실패는 인증 상태로 분류한다. 갱신 이벤트는 연결 ID를 전달하는 무효화 알림이고 화면은 해당 ID의 공통 캐시를 읽는다. 요청 중복을 막고 `Retry-After`를 우선하며, timeout 다음 주기는 새 쿼리 세대로 재시도한다. 이전 쿼리의 결과·finally와 연결 변경·삭제·언로드 뒤 결과는 현재 상태를 갱신하지 않는다. WASM 정규화 실패는 기존 저장 간격을 기본값으로 덮어쓰지 않고 로드·저장을 오류로 닫으며, 이미 실행 중인 타이머는 보존한다.

포함 구독분·혜택 크레딧과 구매 잔액은 별개이며 대화별 비용·차감량을 계산하지 않는다. [OpenCode Go](https://opencode.ai/docs/go/)는 포함 한도 후 Console의 Extra Usage가 켜졌을 때 잔액으로 이어지고, [OpenAI API 혜택](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)·[Claude API 혜택](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)은 혜택 크레딧을 구매 크레딧보다 먼저 사용한다(2026-10-29 문서 확인). OpenAI API 조직 크레딧과 ChatGPT 로그인 크레딧을 혼동하지 않는다. 정책과 잔액만으로 실제 차감원을 단정하지 않고, 앱이 자동 충전·추가 사용·유료 경로 전환을 활성화하지 않는다. Go의 공개 응답에는 잔액·차감원이 없으므로 해당 수치를 꾸미지 않는다. [Ollama 잔액 계약](https://docs.ollama.com/api/balance.md)과 [OpenRouter 잔액 계약](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)은 실제 포함분·구매 잔액 및 조회 권한을 구분하는 근거다.

## 보안 저장 경계

API 키와 ChatGPT 자격증명의 영속화는 Obsidian SecretStorage에 한정한다. `src/secrets/provider-secrets.ts`는 런타임에서 사용 가능한 키와 저장용 설정 사본을 분리하고, 사본의 키 원문을 제거한다. `main.ts`의 `saveSettings`가 보안 저장과 설정 저장 순서를 조립한다. 키가 다른 장치에 없다는 상태와 사용자가 키를 설정하지 않은 상태를 구분한다.

일반 설정·data.json·localStorage·로그·공유 명세에 키·토큰·쿠키 원문을 기록하지 않는다. 기존 인증 자료를 문서 import 과정에서 복제하거나 정상 로그인 대신 과거 바이트로 복원하지 않는다.

## 로컬 임베딩 소유권과 우선 큐

Ternlight·Gemma provider는 자기 runtime·초기화·worker를 소유한다. 직접 호출용 legacy helper와 수명을 공유하지 않으며 닫힌 owner의 늦은 응답·실패가 새 owner를 종료하지 않는다. owner close는 단조 상태이고 worker의 치명적 종료와 요청 하나의 전송·응답·검증 실패는 구별한다. 요청별 실패를 다른 대기 소비자의 강제 종료로 확대하지 않는다.

로컬 요청은 owner 안에서 한 번에 하나만 실제 worker에 전송한다. 다음 전송은 foreground 우선, 같은 우선순위는 FIFO다. provider의 query `embed`는 기본 foreground, document `embedBatch`는 기본 background이며 명시한 priority는 cache miss까지 전달한다. 우선순위는 client 큐 정보이고 모델 입력·prefix·worker wire·캐시 namespace·벡터 내용이나 원격 제공자의 동시성을 바꾸지 않는다.

실행 중 소비자의 취소는 즉시 반환하되 물리 요청·예약은 실제 ACK·error·worker 종료까지 남는다. 전송 전 취소는 큐와 큰 입력·transfer 참조를 제거한다. `waitForIdle()`은 초기화·대기·물리 작업의 정착 경계이지 성공 인증이나 신규 admission 잠금이 아니다. 종료·모델 파일 삭제의 상위 조율은 `retrieval-index`의 runtime 경계가 맡는다. 상태 알림은 비권위 관찰자이며 예외가 계산 결과 정착·다음 dispatch·물리 drain을 막지 못한다. 진단에 raw 응답·관찰자 오류·벡터를 복제하지 않는다.

로컬 background 논리 batch는 순차 physical microdispatch로 조립하며 다음 전송 turn에서만 `deterministic-core`가 정한 행 수를 적용한다. 따라서 대기 중 추가된 foreground·실제 backend·상한 변경도 다음 전송에 반영한다. 실제 ACK로 확인한 Gemma backend는 CPU 4행·WebGPU 32행 상한에 연결하고 기존 padded-token 제한을 보존한다. 이미 실행 중인 동기 inference는 선점하지 않는다.

owner-local 표본은 실제 miss post 직전부터 해당 ACK handler 진입까지의 실제 행 수·wall duration·그 span 안에서 실행된 timer drift만 측정한다. cache hit·중복 병합·lookup·commit·큐 대기·초기화는 건강 표본이 아니다. RSS·available memory는 실제 지원 API만 읽고 미지원·오류는 null이며 heap·weights·장치 사양으로 여유를 만들지 않는다. 미계측 source 원장을 0으로 바꾸지 않으며 관측·Rust 판정이 없으면 새 최적화를 닫고 기존 baseline 요청을 유지한다. 무인자 inference-dispatch hook은 실제 성공 post 뒤에만 알리고 관찰자 예외는 격리한다. 선택적 `onInferenceSample`은 검증된 성공 miss의 `{backend, workUnits, durationMs, endedAtMs}`만 별도 frozen 객체로 전달한다. 이는 같은 monotonic clock의 실제 post→ACK wall 관측이지 논리 batch·CPU 시간·전체 pipeline 시간이 아니다. 취소·실패·초기화·cache hit·dedupe 추가 소비에는 공개 표본을 만들지 않으며 unknown/변경 backend는 생략한다. callback이나 진단 실패가 정착을 막지 않고 외부 수정이 private admission 표본을 바꾸지 않는다. 원격 경로에 새 물리 관측을 만들지 않는다. `waitForIdle()`은 ACK 사이 남은 논리 micro-operation도 포함한다. 이 연결과 합성 회귀만으로 실제 Obsidian foreground 지연·처리량·CPU/GPU 활용 향상을 주장하지 않는다.

## 근거와 한계

공통 계약은 `providers.ts`, 비밀정보 처리는 `src/secrets/provider-secrets.ts`와 `src/secrets/provider-secrets.test.ts`가 근거다. 제공자별 메시지·스트리밍·tool call 테스트는 로컬 계약 검증이며 실제 온라인 제공자 지원·로그인 성공을 대신하지 않는다. 한도 조회의 합성 응답·가짜 타이머·설정 보존 회귀는 로컬 계약 검증이며 실제 계정의 조회 성공이나 현재 과금 상태를 대신하지 않는다. 실제 계정 온라인 호출은 이 변경의 검증에 포함하지 않는다.
