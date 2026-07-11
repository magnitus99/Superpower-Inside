# MCP 작업 중심 설정 UI 구현 계획

## 성공 기준

- MCP 탭이 현재 연결, 서버 설정, 실행 환경 순서로 읽힌다.
- 연결 상태와 서버별 오류가 평평한 status row로 표시된다.
- PATH/WSL/탐지/저장은 공통 disclosure 안에 있다.
- 기존 registry event, 재연결, JSON validation·autosave·save 동작을 보존한다.
- 전체 품질 게이트와 실제 Obsidian 비주얼 QA를 통과한다.

## 작업 순서

1. `src/settings-redesign.test.ts`에 MCP 순서, status row, disclosure, callback 보존 계약을 먼저 추가한다.
2. `buildMCPTab`을 공통 workspace와 세 section으로 분리한다.
3. `renderMCPStatus`를 공통 status/action row 기반으로 평탄화하고 기존 refresh action과 event 갱신을 연결한다.
4. JSON editor, lint 상태, autosave, explicit save를 서버 설정 section에 연결한다.
5. PATH와 WSL 설정을 공통 disclosure로 옮기고 기존 자동 탐지·저장 callback을 유지한다.
6. MCP 한국어·영어 문구와 JSON/PATH 반응형 CSS를 정리한다.
7. 관련 테스트, lint, typecheck 후 `security:full`, build, review gate를 실행한다.
8. `.test-vault` 실제 Obsidian에서 연결/오류/빈 상태, editor 상태, disclosure, 일반/좁은 폭, light/dark를 스크린샷 검수한다.

## 변경 범위

- `src/settings.ts`
- `src/settings-redesign.test.ts`
- `src/i18n.ts`
- `styles.css`
- `docs/README_FOR_DEV.md`
- `docs/DEV_SETUP.md`

MCP registry/transport, 설정 스키마, Chat 도구 정책, Rust/WASM 코어, `.test-vault` 데이터는 변경하지 않는다.
