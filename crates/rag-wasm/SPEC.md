---
id: deterministic-core
type: module-design
status: draft
title: 결정적 계산과 WASM 계약
parent: superpower-architecture
references: [vault-evidence, superpower-architecture]
---

# 결정적 계산과 WASM 계약

## 책임과 의도

검색·토큰화·정규화·청킹·랭킹·근거 구절 검증·집계와 결정적 계획을 입력에 대한 계산으로 수행한다. DOM·파일·네트워크·프로세스·자격증명 I/O를 소유하지 않는다. 선택 모델이나 볼트의 특정 문서·질의·정답을 계산 규칙으로 하드코딩하지 않는다.

TypeScript와의 경계는 `src/rag/rust-core.ts`의 입출력 매핑이며 WASM wire 형식·범위·타입 검증을 유지한다. 기본 발견·집계의 실행 횟수 목표와 현 구현의 차이는 `vault-evidence`가 소유한다.

공식 제공자의 한도 응답 정규화·최소 잔여 창 선택·소진 판정과 전역 조회 간격의 정상 입력 기본값·범위 제한은 `provider_quota.rs`의 `plan_provider_quota_json`이 소유한다. 창은 실제 응답에 존재하는 가변 목록이며 요금제 이름에 따른 고정 창·미제공의 0/100% 대체를 만들지 않는다. 요약의 표시 기간 단위도 반환된 초가 정확히 나누어지는 주·일·시간·분만 계산하며, 실제 초가 없으면 기간 길이를 만들지 않는다. 제공자 인증·endpoint·주기 수명과 결제 정책의 소유자는 `provider-boundary`다.

## 실패·생성물 경계

요구 계약은 WASM 초기화·wire 실패를 TypeScript 계산으로 대신하지 않고 기존 오류·빈 결과·비활성 상태로 드러내는 것이다. indexed-evidence wrapper는 실패 시 null을 반환한다.

현재 차이: `rankTopKPairsRust`는 WASM 초기화 실패 시 TypeScript cosine·정렬로 대체하지 않고 null을 반환하며, `src/rag/store.ts`의 호출부는 이를 빈 결과로 처리한다(`src/rag/rust-core-unavailable.test.ts`). 이번 보강으로 검색 선택·다양성 계획, 벡터 저장소 add·replace·remove·stats·lookup 계획, RAG 상태 계산, pending 파일 계획의 TypeScript 계산 fallback도 제거했다. 각 계획은 WASM 실패 시 null을 반환하고, 저장소 쓰기 계획 실패는 쓰기를 중단하며 조회·통계는 빈 결과로 닫는다. `planNativeToolCompatibilityFallbackRust`·`planVaultLinkFallbackIndexRust`는 이름과 달리 Rust wire wrapper이며 TypeScript 계산 대체가 아니다. 이 명세가 나열하던 TS 계산 fallback은 제거됐다.

다만 `src/utils/rag-exclude-validation.ts`의 제외 경로·확장자 검증·정규화와 `src/chat/mcp-tools.ts`의 MCP 도구 인자 파싱·결과 정규화·빈 결과 판정(`parseToolArguments`·`normalizeToolResult`·`isMcpToolResultEmpty`)은 Rust를 먼저 사용하면서 실패 시 TypeScript 계산으로 닫는 경로가 남아 있다. 이 두 경로는 위 실패 계약과 아직 일치하지 않으므로, WASM을 사용할 수 없을 때 설정 검증과 도구 실행이 TS 결과로 계속 동작한다. 제거 전까지 이 차이를 완료로 해석하지 않는다. 같은 파일의 `classifyMcpToolError`는 Rust 분류가 실패하면 원문을 그대로 반환할 뿐 분류 계산을 TS로 재구현하지 않으므로 이 목록에서 제외한다. 검색·agent 리팩터링으로 TS 호출자가 사라진 wire export 10개는 glue에 남아 있으나, 이들의 입출력 매핑·타입 검증은 현재 대상이 아니다.

한도 정규화·요약·간격 wrapper는 WASM 초기화·wire 검증 실패에서 null을 반환한다. 호스트는 간격의 null을 기본 30초로 재계산해 사용자 설정에 저장하지 않는다. 로드·저장은 오류로 닫고, 이미 적용된 간격과 타이머를 보존한다. 정상적인 미설정 입력의 기본 30초와 정수 제한은 Rust의 성공 결과로만 얻는다.

WASM glue·base64는 수동 편집하지 않고 `npm run wasm:build`로 같은 소스 상태에서 생성한다. build/dev의 선행 WASM 빌드와 저장 형식의 legacy load·round-trip을 유지한다. PDF worker의 추출·페이지 매핑 예외는 `superpower-architecture`를 따른다.

## 구현·검증 근거

`src/lib.rs`, `src/indexed_evidence.rs`의 계획·검증 JSON 진입점과 TS wrapper가 주요 근거다. 회귀 근거는 Rust 모듈 내 테스트 및 `src/rag/rust-core.test.ts`다. 로컬 회귀 검사는 실제 앱 성능·답변 검증을 대신하지 않는다. 한도 코어의 단위 테스트와 `src/llm/provider-quota-core.test.ts`는 합성 응답·손상 wire·초기화 실패를 검증한다. 해당 소스·glue·base64와 이를 포함한 worker 생성물은 `npm run wasm:build`로 함께 갱신한다. 실제 제공자·계정·과금 상태와 성능은 이 회귀의 검증 범위가 아니다.
