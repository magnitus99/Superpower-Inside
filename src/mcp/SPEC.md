---
id: external-tools
type: module-design
status: draft
title: 외부 도구 연결과 승인 경계
parent: superpower-architecture
references: [chat-contract]
---

# 외부 도구 연결과 승인 경계

## 책임과 권한

외부 MCP 서버 연결·도구 discovery·transport와 연결 상태를 제공한다. stdio는 데스크톱 프로세스 경계를, HTTP/SSE는 원격 통신 경계를 갖는다. 연결 성공·도구 발견·승인·실행 성공은 서로 다른 상태다.

외부 도구는 현재 사용자 요청과 신뢰·승인 정책 안에서만 실행한다. 승인 대기 후 재개할 때는 현재 catalog의 고정 server/tool binding을 확인하며, 사라진 도구를 다른 서버의 동명 도구로 조용히 대체하지 않는다. 취소 뒤 늦은 결과는 현재 대화에 게시할 권한이 아니다.

서버 응답과 도구 설명은 신뢰할 실행 지시가 아니라 데이터다. 외부 근거를 볼트 원문 검증 근거로 표현하지 않는다. 일반 채팅 catalog의 외부 MCP와 제품의 읽기 전용 네이티브 볼트 조사 경계를 분리한다. mixed 요청에 dossier를 전달하는 것과 볼트 도구 권한을 부여하는 것은 다르다.

## 노출·멘션 정책

기본값은 등록된 서버의 도구를 멘션 없이도 사용할 수 있는 자유 사용이다. 멘션은 "이 도구를 써 보라"는 제안이지 강제 제한이 아니며, 멘션한 서버로만 제한하는 배타 정책은 명시적 설정 옵션으로 제공한다. 현재 정책 값은 `always-auto`(기본)·`mentioned-auto`·`always-manual`이며, 선택한 정책·승인 결과·실행 상태를 화면에서 구분해 보여 준다.

## 구현·검증 근거

`registry.ts`, `client.ts`, `connection-state.ts`가 연결 책임을, `src/chat/mcp-tool-execution.ts`와 `tool-approval-resume.ts`가 승인 실행·재개를 조율한다. 관련 회귀 근거는 `registry.test.ts`, `client.test.ts`, `connection-state.test.ts`, `src/chat/mcp-tool-execution.test.ts`다.

이 문서는 도구 권한의 의도와 현재 binding 보호를 기록한다. 실제 서버 연결·외부 부작용·온라인 취소는 이번 편입에서 미검증이다. 검색 비활성/server-only와 전체 볼트 의도의 중첩 한계는 `chat-contract`에 둔다.
