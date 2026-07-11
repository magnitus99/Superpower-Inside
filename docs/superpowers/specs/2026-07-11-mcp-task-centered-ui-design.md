# MCP 작업 중심 설정 UI 설계

## 결정

MCP 탭을 `현재 연결 → 서버 설정 → 실행 환경` 순서로 재구성한다. General, RAG, Chat의 범용 설정 section, status row, notice, disclosure 계약을 재사용하고, 서버 연결·재연결·JSON 검증·저장·PATH 탐지 동작은 유지한다.

사용자는 설정 화면 전체 통일을 승인했고 반복 승인을 요청하지 말라고 명시했다. 아래 결정은 현재 코드와 제품 철학을 기준으로 바로 구현한다.

## 검토한 접근

1. 기존 상태·PATH·JSON 패널의 외형만 맞추는 방식은 안전하지만 raw JSON과 실행 환경이 핵심 작업처럼 경쟁한다.
2. **권장안: 연결 상태와 서버 설정을 기본 흐름에 두고 PATH를 고급 disclosure로 격리한다.** 기존 기능을 유지하면서 사용자가 가장 먼저 연결 여부와 다음 행동을 읽게 한다.
3. 서버별 폼 편집기로 전면 교체하면 사용성은 좋아지지만 설정 스키마 편집과 validation UI를 새로 설계해야 하므로 이번 통일 범위를 넘는다.

2안을 적용한다.

## 목표

- 3초 안에 연결된 서버 수, 실패 여부, 가장 가까운 복구 행동을 알 수 있다.
- 서버 JSON 편집은 하나의 평평한 작업 영역으로 보이고 검증·저장 상태가 편집기 가까이에 표시된다.
- PATH와 WSL 같은 실행 환경 세부값은 일상 흐름과 경쟁하지 않는다.
- 기존 자동 검증·자동 저장·명시적 저장·재연결 callback과 오류 내용을 보존한다.

## 비목표

- MCP 서버 설정 스키마, stdio transport, registry, retry 정책을 변경하지 않는다.
- JSON 편집기를 서버별 form builder로 바꾸지 않는다.
- Chat의 도구 승인 정책이나 MCP 도구 실행 UI를 변경하지 않는다.
- 새 연결 판정 로직이나 Rust/WASM 계산을 추가하지 않는다.

## 정보 구조

1. **현재 연결**
   - 전체/연결/연결 중/오류 상태를 공통 status row로 표시한다.
   - 서버별 상태와 마지막 오류를 평평한 row로 나열한다.
   - 재연결만 section의 primary action으로 둔다.
   - 서버가 없으면 빈 카드 대신 서버 설정 안내와 한 가지 다음 행동을 보여준다.
2. **서버 설정**
   - 표준 `mcpServers` JSON editor, validation 상태, 저장 행동을 한 section에 둔다.
   - validation 상태는 텍스트와 tone을 함께 사용하고 editor 바로 위 또는 아래에 표시한다.
   - 유효 JSON 자동 저장은 유지하되 명시적 저장 버튼은 하나의 primary action으로 표현한다.
   - editor 내부에 별도 카드나 footer card를 만들지 않는다.
3. **실행 환경**
   - PATH, 자동 탐지, 저장, Windows WSL 포함 토글을 `실행 환경 세부 조정` disclosure 안에 둔다.
   - 기존 텍스트 삼각형과 클릭 가능한 div를 제거하고 공통 disclosure button을 사용한다.
   - 자동 탐지와 저장은 같은 disclosure 안의 보조 행동으로 둔다.

## 상태와 동작

- 기존 registry의 `connected`, `connecting`, `error`, `disconnected` 상태와 오류 문자열을 그대로 사용한다.
- refresh action은 진행 중 disabled, 성공/부분 실패 feedback과 Notice를 유지한다.
- MCP status event는 현재 연결된 status body만 다시 그리며 다른 editor 값을 지우지 않는다.
- JSON input debounce 1초, validation, format-on-blur, Tab indent, 자동 저장을 유지한다.
- PATH 자동 탐지는 desktop availability 검사와 기존 오류 도움말을 유지한다.

## 접근성과 반응형

- 모든 disclosure는 button, `aria-expanded`, `aria-controls`, Obsidian icon을 사용한다.
- 상태는 dot이나 색상만 쓰지 않고 label, state, supporting detail을 제공한다.
- JSON/PATH editor는 긴 명령·환경 변수에서 가로 overflow를 내부 editor에만 제한하고 section 자체를 밀어내지 않는다.
- 좁은 폭에서 action과 editor가 한 열로 배치되고 버튼은 의미 있는 텍스트 이름을 유지한다.
- light/dark, focus-visible, reduced-motion을 공통 계약으로 확인한다.

## 테스트 계약

- MCP section 순서와 공통 workspace/helper 사용을 구조 테스트로 고정한다.
- 기존 `createSettingsPanel`, 텍스트 삼각형, 클릭 가능한 path header를 제거한다.
- 재연결 primary action이 하나이고 서버별 상태가 공통 status row로 렌더링됨을 검증한다.
- PATH/WSL/자동 탐지/저장이 disclosure 안에 있음을 검증한다.
- JSON lint, autosave, explicit save, blur formatting, Tab indent callback을 보존한다.
- lint, typecheck, Vitest, security:full, build, review gate와 실제 Obsidian 스크린샷을 통과한다.

## 시각 검수

`.test-vault`에서 연결 완료, 부분 실패, 서버 없음, JSON 유효/오류/저장 중, PATH 접힘·펼침, 긴 명령과 오류, 일반/좁은 폭, light/dark theme를 확인한다. 코드와 전체 게이트 이후 스크린샷을 직접 검수한다.

## 완료 조건

- 연결 상태와 재연결 행동이 가장 먼저 읽힌다.
- JSON 서버 설정과 실행 환경이 명확히 분리된다.
- MCP가 General/RAG/Chat과 같은 section, row, status, notice, disclosure 언어를 사용한다.
- 기존 연결·검증·저장 동작이 유지되고 모든 자동·비주얼 검증을 통과한다.
