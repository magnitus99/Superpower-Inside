# Chat 작업 중심 설정 UI 설계

## 결정

Chat 탭을 `현재 동작 → 응답 기본값 → 대화 저장 → 도구 사용 → 세부 조정` 순서로 재구성한다. General과 RAG에서 확정한 범용 section, status row, setting row, notice, disclosure 계약을 그대로 사용하고, 기존 채팅 설정 값과 저장 동작은 바꾸지 않는다.

사용자는 설정 화면 전체 통일을 이미 승인했으며 반복 승인 없이 진행해 달라고 명시했다. 따라서 이 문서는 현재 코드와 제품 철학을 근거로 한 구현 계약으로 사용한다.

## 검토한 접근

1. 기존 세 패널의 색과 간격만 맞추는 방식은 변경 위험은 작지만 정보 위계와 상시 노출된 프리셋·초기화 문제를 남긴다.
2. **권장안: 기존 기능을 작업 중심 section과 disclosure로 재배치한다.** 설정 스키마를 건드리지 않으면서 General/RAG와 같은 사용 흐름을 만든다.
3. 단계형 설정 마법사는 처음 설정에는 친절하지만 반복 조정이 느리고 Obsidian 설정 탭과 맞지 않는다.

2안을 적용한다.

## 목표

- 3초 안에 현재 활성 프롬프트, 저장 방식, MCP 도구 실행 방식을 파악할 수 있다.
- 자주 바꾸는 프롬프트와 저장 위치는 바로 접근하고, 지연 시간·프리셋·재시도 같은 세부 조정은 필요할 때만 펼친다.
- 한 section의 주 행동은 하나를 넘지 않고, 설정 행 안에 별도 카드 표면을 중첩하지 않는다.
- 기존 prompt library, preset 생성, reset, autosave, MCP policy와 retry 동작을 그대로 보존한다.

## 비목표

- 채팅 사이드바 UI, 메시지 저장 형식, prompt library modal 자체를 재설계하지 않는다.
- 기본 모델 선택 위치를 General에서 Chat으로 옮기지 않는다.
- 프롬프트 내용이나 MCP 실행 정책의 의미·기본값을 변경하지 않는다.
- 설정 스키마, migration, Rust/WASM 경계 또는 채팅 런타임 정책을 추가하지 않는다.

## 정보 구조

1. **현재 동작**
   - 활성 프롬프트, 자동 저장, MCP 실행 정책을 평평한 status row로 요약한다.
   - 색상만이 아니라 상태 이름과 근거 문장을 함께 표시한다.
   - 오류 판정을 새로 만들지 않고 현재 설정값만 설명한다.
2. **응답 기본값**
   - 활성 시스템 프롬프트 편집과 `프롬프트 보관함 열기`를 제공한다.
   - 보관함 열기만 primary action으로 취급한다.
   - 빠른 프리셋과 기본값 초기화는 `빠른 시작과 초기화` disclosure 안에 둔다.
3. **대화 저장**
   - 저장 폴더와 자동 저장 토글을 기본 행으로 둔다.
   - 자동 저장 지연은 `저장 세부 조정` disclosure 안에 둔다.
   - 자동 저장이 꺼져도 기존 지연값은 보존한다.
4. **도구 사용**
   - MCP 도구 실행 정책을 핵심 설정 행으로 둔다.
   - `항상 자동 실행`의 범위를 설명하는 warning notice를 정책 선택 시 표시한다.
   - 도구 미사용 감지·재시도는 `도구 세부 조정` disclosure 안에 둔다.

## 컴포넌트와 동작

- 탭 root는 `superpower-inside-settings-workspace`와 Chat 전용 class를 함께 사용한다.
- 최상위 표면은 `createSettingsSection`으로만 만들고 section 내부에는 Obsidian `Setting` 행과 구분선을 사용한다.
- 현재 동작은 `createSettingsStatusRow`를 재사용한다.
- 프리셋, 초기화, 저장 지연, 재시도는 `createSettingsDisclosure`를 재사용한다.
- prompt library modal을 닫거나 프리셋·초기화를 적용한 뒤에는 기존처럼 Chat panel만 다시 그린다.
- textarea, dropdown, toggle, debounced save, Notice callback은 기존 계약을 유지한다.

## 접근성과 반응형

- disclosure는 button, 고유 content id, `aria-expanded`, `aria-controls`, Obsidian chevron icon을 사용한다.
- prompt textarea와 긴 저장 경로는 좁은 폭에서 가로 overflow 없이 줄바꿈·축소된다.
- 프리셋 버튼은 disclosure 안에서 줄바꿈되고, 각 버튼은 설명을 title과 인접 문구로 이해할 수 있어야 한다.
- 상태는 label, state, supporting detail을 모두 제공한다.
- light/dark theme, focus-visible, reduced-motion, 520px 이하 재배치를 공통 설정 CSS 계약으로 검수한다.

## 오류 처리

- 빈 저장 폴더나 비어 있는 prompt를 새 오류로 간주하지 않고 기존 런타임 fallback을 유지한다.
- prompt library modal 오류 처리와 저장 Notice는 기존 구현을 유지한다.
- 숫자 입력은 기존 `1000–10000 ms`, 정수, `500 ms` step 검증을 유지한다.
- 정책 dropdown의 알 수 없는 값은 새 fallback으로 덮지 않고 기존 타입 계약을 유지한다.

## 테스트 계약

- Chat section 순서와 공통 workspace/section helper 사용을 구조 테스트로 고정한다.
- 기존 `createSettingsPanel` 기반 Chat 패널을 제거한다.
- 빠른 프리셋·초기화, 저장 지연, 도구 재시도가 disclosure 안에 있음을 검증한다.
- prompt library, prompt 수정, preset, reset, autosave, policy, retry callback을 보존한다.
- 항상 자동 실행 warning, 한국어·영어 i18n, 좁은 폭 CSS를 검증한다.
- lint, typecheck, Vitest, security:full, build, Obsidian review gate를 통과한다.

## 시각 검수

실제 `.test-vault` Obsidian 설정 modal에서 일반 폭과 좁은 폭, light/dark theme, 모든 disclosure의 접힘·펼침, 긴 prompt·경로, 자동 저장 on/off, 세 정책 선택, focus-visible을 스크린샷으로 확인한다. 스크린샷 검수는 코드와 전체 게이트 이후 수행한다.

## 완료 조건

- Chat이 현재 상태와 다음 조정 위치를 한눈에 설명한다.
- 프리셋·초기화·지연·재시도가 기본 흐름과 경쟁하지 않는다.
- General/RAG와 같은 section, row, status, notice, disclosure 언어를 사용한다.
- 기존 설정과 런타임 동작에 회귀가 없고 모든 자동·비주얼 검증을 통과한다.
