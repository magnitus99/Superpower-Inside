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

## 실패·생성물 경계

요구 계약은 WASM 초기화·wire 실패를 TypeScript 계산으로 대신하지 않고 기존 오류·빈 결과·비활성 상태로 드러내는 것이다. indexed-evidence wrapper는 실패 시 null을 반환한다.

현재 차이: `rankTopKPairsRust`는 WASM 초기화 실패 시 TypeScript cosine·정렬로 대체하지 않고 null을 반환하며, `src/rag/store.ts`의 호출부는 이를 빈 결과로 처리한다(`src/rag/rust-core-unavailable.test.ts`). 이번 보강으로 검색 선택·다양성 계획, 벡터 저장소 add·replace·remove·stats·lookup 계획, RAG 상태 계산, pending 파일 계획의 TypeScript 계산 fallback도 제거했다. 각 계획은 WASM 실패 시 null을 반환하고, 저장소 쓰기 계획 실패는 쓰기를 중단하며 조회·통계는 빈 결과로 닫는다. `planNativeToolCompatibilityFallbackRust`·`planVaultLinkFallbackIndexRust`는 이름과 달리 Rust wire wrapper이며 TypeScript 계산 대체가 아니다. 이 명세가 나열하던 TS 계산 fallback은 제거됐다.

WASM glue·base64는 수동 편집하지 않고 `npm run wasm:build`로 같은 소스 상태에서 생성한다. build/dev의 선행 WASM 빌드와 저장 형식의 legacy load·round-trip을 유지한다. PDF worker의 추출·페이지 매핑 예외는 `superpower-architecture`를 따른다.

## 구현·검증 근거

`src/lib.rs`, `src/indexed_evidence.rs`의 계획·검증 JSON 진입점과 TS wrapper가 주요 근거다. 회귀 근거는 Rust 모듈 내 테스트 및 `src/rag/rust-core.test.ts`다. 로컬 회귀 검사는 실제 앱 성능·답변 검증을 대신하지 않는다. 이번 편입에서는 Rust·WASM 소스/생성물을 변경하지 않았으며 빌드·성능 측정을 수행하지 않았다.
