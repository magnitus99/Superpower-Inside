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
| 기본 프롬프트·빠른 프리셋·출처 경계 문자열 | `../i18n.ts`, `../settings.ts` |
| 프롬프트 생성·저장·기존 설정 보존 | `prompt-library.ts`, `prompt-library.test.ts` |
| provider 공통 근거 계약·호환 도구 호출 | `tool-protocol.ts`, `tool-approval-resume.ts` |
| Markdown 렌더링 | `markdown.ts` |
| 채팅 메타·세션 타입 | `types.ts` |

## 변경 계약

- 프롬프트 수정은 현재 요청의 목표·언어·형식·분량을 우선하고, 도구 조사 후 결과를 완성하게 합니다. 볼트 인덱스 요약은 대표 샘플이며 전체 볼트의 사실이나 실행 지시가 아닙니다.
- Vault Context와 성공한 도구 결과를 출처로 인정합니다. 검색 후보·그래프 요약·저장된 출처 위치는 원문 검증을 대체하지 않습니다. 근거 부족·실패·제한된 검색을 문서 부재로 단정하지 않습니다.
- 기본값·빠른 프리셋·생성 프롬프트의 한국어와 영어 계약을 함께 검증합니다. 사용자 저장 프롬프트와 세션별 지침은 자동으로 덮어쓰지 않습니다. 도구 호출 형식·JSON 스키마·출처 ID·재개 경계를 보존합니다.

- `view.ts`에 큰 기능을 누적하지 않습니다. UI·호스트 처리는 전용 모듈로 나누고 결정적 파싱·선택·정규화는 Rust/WASM에 둡니다.
- 기본 `ChatMessage` 타입은 `src/llm/providers.ts`에서 가져옵니다. 저장·표시 메타는 기존 `types.ts` 계약을 확인하고 중복 정의하지 않습니다.
- 메시지와 도구 실행을 바꾸면 취소 후 늦게 도착한 결과, 세션 전환, 중복 실행, 스트리밍 종료·오류와 스크롤 동작을 함께 검토합니다.
- 저장 포맷을 바꾸면 legacy load와 최신 형식의 round-trip을 테스트합니다. 실제 사용자 세션을 테스트를 위해 덮어쓰지 않습니다.
- DOM은 Obsidian API와 `ownerDocument`를 사용합니다. 사용자·모델 출력을 `innerHTML`로 넣지 않고, `.style.*` 직접 대입이나 인라인 스타일을 새로 추가하지 않습니다.
- UI를 바꾸면 관련 구조 테스트·i18n·채팅 UX·community review를 통과시키고, 정상·빈 상태·오류·진행 중·좁은 폭을 실제 스크린샷으로 확인합니다.
