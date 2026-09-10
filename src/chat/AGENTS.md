# 채팅 모듈 작업 지침

루트 `AGENTS.md`의 Rust/WASM 경계, i18n, community review와 실제 화면 검수 기준을 함께 적용합니다. 파일 줄 수나 과거 구현 설명을 현재 계약으로 삼지 않습니다.

## 작업별 시작점

| 작업 | 파일 |
| --- | --- |
| ItemView·DOM·스크롤·스트리밍 표시 | `view.ts` |
| 컨텍스트·멘션·참조 확장 | `context.ts`, `mention-parser.ts`, `context-expansion.ts` |
| 도구 실행·취소·중단 복구 | `tool-execution.ts`, `run-ownership.ts`, `session-recovery.ts` |
| 출처 표시·검증 | `source-panel.ts`, `source-validation.ts` |
| 세션 저장·레거시 복원 | `persistence.ts`, `persistence.test.ts` |
| 세션 목록 | `session-modal.ts` |
| Markdown 렌더링 | `markdown.ts` |
| 채팅 메타·세션 타입 | `types.ts` |

## 변경 계약

- `view.ts`에 큰 기능을 누적하지 않습니다. UI·호스트 처리는 전용 모듈로 나누고 결정적 파싱·선택·정규화는 Rust/WASM에 둡니다.
- 기본 `ChatMessage` 타입은 `src/llm/providers.ts`에서 가져옵니다. 저장·표시 메타는 기존 `types.ts` 계약을 확인하고 중복 정의하지 않습니다.
- 메시지와 도구 실행을 바꾸면 취소 후 늦게 도착한 결과, 세션 전환, 중복 실행, 스트리밍 종료·오류와 스크롤 동작을 함께 검토합니다.
- 저장 포맷을 바꾸면 legacy load와 최신 형식의 round-trip을 테스트합니다. 실제 사용자 세션을 테스트를 위해 덮어쓰지 않습니다.
- DOM은 Obsidian API와 `ownerDocument`를 사용합니다. 사용자·모델 출력을 `innerHTML`로 넣지 않고, `.style.*` 직접 대입이나 인라인 스타일을 새로 추가하지 않습니다.
- UI를 바꾸면 관련 구조 테스트·i18n·채팅 UX·community review를 통과시키고, 정상·빈 상태·오류·진행 중·좁은 폭을 실제 스크린샷으로 확인합니다.
