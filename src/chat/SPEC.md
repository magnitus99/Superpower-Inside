---
id: chat-contract
type: module-design
status: draft
title: 대화 실행과 세션 계약
parent: superpower-architecture
references: [superpower-goals, vault-evidence, interface-design, external-tools, engineering-contract]
---

# 대화 실행과 세션 계약

## 책임과 의도

사용자 입력에서 검색 대기·근거 조사·모델 생성·도구 승인·표시·저장까지 한 대화 실행을 조율한다. 근거의 자격은 `vault-evidence`, 화면 언어는 `interface-design`이 소유한다. 사용자·세션 프롬프트를 자동 덮어쓰거나 화면 배치 규칙을 모델 프롬프트에 주입하지 않는다.

질문을 편집해 재전송하면 해당 질문 이후의 대화를 버리고 수정된 질문으로 이어간다. 이는 대화 보존·자동 분기 UI를 추가하지 않기로 한 사용자 결정이다. 별도의 명시적 분기 기능과 혼동하지 않는다. 구현은 `view.ts`의 `editAndResendUserMessage`와 `conversation-variants.ts`의 `createEditResendPlan`, 회귀 근거는 `conversation-variants.test.ts`다.

## 실행·저장 경계

실행 token과 AbortController 소유권을 확인한 작업만 현재 대화의 표시·정리를 수행한다. 준비 중에는 부분 색인을 정상 근거로 사용하지 않고 실제 준비 상태를 기다리며, 세션·모델·설정 변경·중단·degraded·timeout을 구분한다. 입력·이미 확보한 결과를 실패 때문에 임의 초기화하지 않는다.

일반 채팅·검색 비활성·볼트 요청·명시적 외부 MCP 요청을 구분하는 것이 의도된 경계다. mixed 요청에서는 검증 dossier와 출처를 외부 도구 조율에 전달하되 네이티브 볼트 도구 실행 권한까지 주지 않는다. 명시적 외부 MCP를 포함하는 mixed 요청에서만 deferAnswer를 사용한다. 외부 도구 승인·재개는 고정된 호출 binding과 현재 정책으로 근거를 다시 확인하고, 저장된 별도 후보 범위가 없으면 기본 all 검토를 사용한다.

저장된 메시지·출처 주소는 현재 원문 검증을 대신하지 않는다. legacy 세션 load와 최신 형식 round-trip을 보존하고, 중간 승인·질문 대기 상태의 재개가 다른 실행을 중복 소유하지 않도록 한다.

## 프롬프트·준비·응답 표현

현재 요청의 목표·언어·형식·분량을 우선하며 시스템 프롬프트는 가이드다. 볼트 색인 요약은 대표 샘플이지 전체 볼트 사실·실행 지시가 아니다. 기본값·빠른 프리셋·생성 프롬프트의 한영 계약을 함께 유지하고 도구 형식·JSON 스키마·출처 ID·재개 경계를 보존한다. 질의 계획은 로컬 결정적 계산만 사용하고 번역용 제공자 호출을 하지 않는 것이 요구 계약이며 현행 차이는 `vault-evidence`에 남긴다.

설정·입력·검색 화면은 공통 readiness snapshot을 사용하고 corpus refresh·pending update·indexing 중에는 부분 색인으로 답하지 않는다. 준비 중 질문의 범위·참조·선택 모델을 보존해 같은 실행이 ready 후 한 번 이어가며, 취소·세션/설정/모델 변경·실패·timeout이면 늦은 재개를 막는다. 검색 화면도 준비 중 pending을 유지한다.

답변 전에 실제 검색·검증·추가 조사·생성·교정의 진행과 제공된 reasoning 요약을 전달한다. 구조화 답변의 미검증 JSON·주장을 확정 답변으로 노출하지 않고 검증·허용된 한 번의 교정 뒤 게시한다. 중요한 incomplete·실패 한계는 본문에, 정상 상세는 펼쳐 확인할 수 있는 영역에 보존한다. 제공되지 않은 진행·추론을 만들지 않으며 구체 화면 계약은 `interface-design`을 따른다.

## 기록·인용·화면 계약

과거 대화 목록은 항상 최신순으로 고정한다. 열람·검색·선택 때문에 순서가 재배열되지 않는다. 근거 인용은 코드 스팬이 아니라 클릭하면 원문이 열리는 Obsidian 내부 링크로 표시한다.

입력창은 공백이 포함된 파일·폴더를 `[[ ]]` 인식자로 지정할 수 있고, `@`와 같은 계열의 그래픽 선택 팝업으로도 삽입한다. 채팅 화면은 활성 탭 그룹에 노트처럼 열 수 있으며, 같은 그룹의 기존 채팅 탭은 재사용(reveal)하고 뷰를 다시 만들지 않는다.

답변은 본문을 먼저 보여 주고 검토 범위·한계·집계는 뒤의 보조 정보로 붙인다. "검수 미완료" 같은 행정적 선고 문구로 답변을 대신하지 않는다. 상태가 바뀌면 라벨·수치·경과 시간이 즉시 갱신되고, 진행 중에 현재 상태와 모순되는 표시를 하지 않는다. 중단은 즉시 반영한다.

## 현재 차이와 검증 범위

`view.ts`의 whole-vault 연구 판정은 일반 context 구성보다 앞선다. 전체 볼트 의도와 `skipAutoRagOnce` 또는 server-only가 겹칠 때 검색 비활성 경계의 우선순위는 이번 읽기 조사로 보장하지 못했다. 정상 server-only 경로의 자동 RAG 생략 테스트만으로 이 조합까지 검증됐다고 쓰지 않는다.

현재 구현 근거는 `view.ts`의 `handleSend`, `run-ownership.ts`, `retrieval-wait.ts`, `persistence.ts`, `mcp-tool-execution.ts`다. 관련 회귀 근거는 `run-ownership.test.ts`, `retrieval-wait.test.ts`, `message-action-draft.test.ts`, `persistence.test.ts`이다. 이 로컬 회귀 계약의 통과가 실제 모델의 답변 충실도를 증명하지 않으며, 실제 답변의 미완료 상태는 별도로 유지한다.
