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

## 근거와 한계

공통 계약은 `providers.ts`, 비밀정보 처리는 `src/secrets/provider-secrets.ts`와 `src/secrets/provider-secrets.test.ts`가 근거다. 제공자별 메시지·스트리밍·tool call 테스트는 로컬 계약 검증이며 실제 온라인 제공자 지원·로그인 성공을 대신하지 않는다. 한도 조회의 합성 응답·가짜 타이머·설정 보존 회귀는 로컬 계약 검증이며 실제 계정의 조회 성공이나 현재 과금 상태를 대신하지 않는다. 실제 계정 온라인 호출은 이 변경의 검증에 포함하지 않는다.
