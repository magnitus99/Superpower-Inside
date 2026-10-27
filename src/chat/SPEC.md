---
id: chat-contract
type: module-design
status: draft
title: 대화 실행과 세션 계약
parent: superpower-architecture
references: [superpower-goals, vault-evidence, interface-design, external-tools]
---

# 대화 실행과 세션 계약

## 책임과 의도

사용자 입력에서 검색 대기·근거 조사·모델 생성·도구 승인·표시·저장까지 한 대화 실행을 조율한다. 근거의 자격은 `vault-evidence`, 화면 언어는 `interface-design`이 소유한다. 사용자·세션 프롬프트를 자동 덮어쓰거나 화면 배치 규칙을 모델 프롬프트에 주입하지 않는다.

질문을 편집해 재전송하면 해당 질문 이후의 대화를 버리고 수정된 질문으로 이어간다. 이는 대화 보존·자동 분기 UI를 추가하지 않기로 한 사용자 결정이다. 별도의 명시적 분기 기능과 혼동하지 않는다. 구현은 `view.ts`의 `editAndResendUserMessage`와 `conversation-variants.ts`의 `createEditResendPlan`, 회귀 근거는 `conversation-variants.test.ts`다.

## 실행·저장 경계

실행 token과 AbortController 소유권을 확인한 작업만 현재 대화의 표시·정리를 수행한다. 준비 중에는 부분 색인을 정상 근거로 사용하지 않고 실제 준비 상태를 기다리며, 세션·모델·설정 변경·중단·degraded·timeout을 구분한다. 입력·이미 확보한 결과를 실패 때문에 임의 초기화하지 않는다.

일반 채팅·검색 비활성·볼트 요청·명시적 외부 MCP 요청을 구분하는 것이 의도된 경계다. mixed 요청에서는 검증 dossier와 출처를 외부 도구 조율에 전달하되 네이티브 볼트 도구 실행 권한까지 주지 않는다. 외부 도구 승인·재개는 고정된 호출 binding과 현재 정책을 다시 확인한다.

저장된 메시지·출처 주소는 현재 원문 검증을 대신하지 않는다. legacy 세션 load와 최신 형식 round-trip을 보존하고, 중간 승인·질문 대기 상태의 재개가 다른 실행을 중복 소유하지 않도록 한다.

## 현재 차이와 검증 범위

`view.ts`의 whole-vault 연구 판정은 일반 context 구성보다 앞선다. 전체 볼트 의도와 `skipAutoRagOnce` 또는 server-only가 겹칠 때 검색 비활성 경계의 우선순위는 이번 읽기 조사로 보장하지 못했다. 정상 server-only 경로의 자동 RAG 생략 테스트만으로 이 조합까지 검증됐다고 쓰지 않는다.

현재 구현 근거는 `view.ts`의 `handleSend`, `run-ownership.ts`, `retrieval-wait.ts`, `persistence.ts`, `mcp-tool-execution.ts`다. 관련 회귀 근거는 `run-ownership.test.ts`, `retrieval-wait.test.ts`, `message-action-draft.test.ts`, `persistence.test.ts`이다. 이 로컬 회귀 계약의 통과가 실제 모델의 답변 충실도를 증명하지 않으며, 실제 답변의 미완료 상태는 별도로 유지한다.
