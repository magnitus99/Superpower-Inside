# 채팅 출처 기반 답변과 자동 문서 참조 구현 계획

## 성공 기준

- 채팅 진입과 전송이 기존 IndexedDB RAG를 자동 준비한다.
- MCP 없이 전역 검색과 자연어 폴더 힌트 검색이 검증된 citation을 만든다.
- `.txt`를 포함한 RAG indexable 파일이 명시 폴더 멘션에서도 일관되게 사용된다.
- tool call과 reasoning 질문 오분류가 더 이상 대화를 중단하지 않는다.
- 빈 상태와 readiness가 현재 할 일과 자동 문서 참조를 짧게 설명한다.

## 작업 순서

1. 시작 성능을 유지하면서 채팅 진입·전송에서 RAG 초기화를 보장하는 실패 테스트를 추가한다.
2. 명시 폴더 멘션의 RAG file type 일치 테스트와 자연어 폴더 힌트 Rust 테스트를 추가한다.
3. vector store path prefix 필터와 scoped RAG query 테스트를 추가한다.
4. Context7 의도 gate와 tool-call 우선 응답 분류 테스트를 추가한다.
5. 온디맨드 RAG 준비, background pending indexing, 전역+scoped context 결합을 구현한다.
6. 빈 상태, compact readiness, 조용한 MCP 정상 상태, Obsidian icon을 구현하고 i18n·CSS 테스트를 추가한다.
7. 관련 Vitest와 Rust unit test를 먼저 통과시킨다.
8. lint → typecheck → test → security:full → build → manifest tag review gate를 순서대로 통과시킨다.
9. 재현 가능한 Obsidian 개발 환경에서 플러그인을 reload하고 실제 질문으로 citation과 응답 흐름을 확인한다.
10. 일반 폭·좁은 폭, 빈 상태·준비 중·관련 노트 있음·관련 노트 없음·오류 상태를 스크린샷으로 검수하고 발견된 문제를 수정한다.

## 변경 범위

- `main.ts`, `main.test.ts`
- `src/chat/context.ts`, `src/chat/context.test.ts`
- `src/chat/view.ts`와 채팅 UI 구조 테스트
- `src/chat/plugin-aware-context7.ts`와 테스트
- `src/rag/query.ts`, `src/rag/store.ts`와 테스트
- `src/rag/rust-core.ts`, `src/rag/rust-core.test.ts`
- `crates/rag-wasm/src/lib.rs`
- `src/i18n.ts`, `styles.css`
- generated WASM과 `main.js`는 검증 build 결과로 갱신한다.
