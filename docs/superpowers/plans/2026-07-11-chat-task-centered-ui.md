# Chat 작업 중심 설정 UI 구현 계획

## 성공 기준

- Chat 탭이 현재 동작, 응답 기본값, 대화 저장, 도구 사용 순서로 읽힌다.
- 프리셋·초기화, 저장 지연, 도구 재시도는 disclosure 안에 있다.
- General/RAG와 동일한 범용 설정 helper와 반응형 토큰을 사용한다.
- 기존 Chat 설정 값과 callback을 보존하고 전체 품질·비주얼 게이트를 통과한다.

## 작업 순서

1. `src/settings-redesign.test.ts`에 Chat 정보 구조, disclosure, 공통 helper 계약을 먼저 추가한다.
2. `buildChatTab`을 공통 workspace와 네 개의 section으로 재구성한다.
3. 현재 활성 프롬프트, 자동 저장, 도구 정책을 status row로 요약한다.
4. prompt library, textarea, preset, reset callback을 응답 기본값 section과 disclosure에 연결한다.
5. 저장 폴더·자동 저장을 기본 행에, 저장 지연을 disclosure에 배치한다.
6. MCP 실행 정책을 기본 행에, 재시도를 disclosure에 배치하고 항상 자동 실행 warning을 반영한다.
7. 한국어·영어 Chat 문구와 공통 반응형 CSS를 정리한다.
8. 관련 테스트 후 lint, typecheck, `security:full`, build, review gate를 실행한다.
9. `.test-vault` 실제 Obsidian에서 일반/좁은 폭, light/dark, disclosure와 정책 상태를 스크린샷으로 검수한다.

## 변경 범위

- `src/settings.ts`
- `src/settings-redesign.test.ts`
- `src/i18n.ts`
- `styles.css`
- `docs/README_FOR_DEV.md`
- `docs/DEV_SETUP.md`

설정 스키마, chat runtime, prompt library modal, Rust/WASM 코어, `.test-vault` 데이터는 변경하지 않는다.
