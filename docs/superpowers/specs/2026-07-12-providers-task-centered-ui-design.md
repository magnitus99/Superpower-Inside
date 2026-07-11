# Providers 작업 중심 설정 UI 전면 설계

## 결정

Providers 탭의 기존 command center, summary bar, hero card, quick fact, model shell 전용 디자인을 제거하고 설정 전역의 공통 작업 중심 언어로 전면 교체한다. 화면은 `현재 상태 → 연결 목록 → 연결 설정 → 모델 관리 → 위험 작업` 순서로 읽히며, provider는 동시에 하나만 펼친다.

사용자는 Providers 탭의 미흡한 부분을 공통 디자인 언어로 완전히 바꾸도록 승인했다. 추가 승인 없이 이 문서를 구현 계약으로 사용한다.

## 검토한 접근

1. 기존 카드의 색·간격만 정리하면 구현 위험은 작지만 중첩 표면과 전용 시각 문법이 남는다.
2. provider 편집을 modal로 옮기면 목록은 간결하지만 여러 provider를 비교·조정하는 흐름이 느려진다.
3. **권장안: 평평한 disclosure 목록으로 전면 교체한다.** 전체 상태는 공통 status row, 각 provider는 공통 disclosure, 내부 설정은 구분선이 있는 setting row로 표현한다.

3안을 적용한다.

## 목표

- 3초 안에 활성 provider 수, 준비 완료 수, 설정이 필요한 provider와 다음 행동을 알 수 있다.
- provider 하나를 펼치면 연결에 필요한 최소 설정, 일반 모델, 임베딩 모델, 제거 순서가 자연스럽게 읽힌다.
- 탭 배경 위 카드 표면은 최상위 section만 사용하고 provider 내부에 카드·hero·shell을 중첩하지 않는다.
- API key, provider strategy, base URL, 모델 추가·가져오기·검증·삭제의 기존 동작을 보존한다.
- 긴 provider 이름·URL·모델 ID와 좁은 설정 폭에서 가로 overflow가 발생하지 않는다.

## 비목표

- provider 설정 스키마, migration, provider transport, validation API를 변경하지 않는다.
- 기본 모델 선택을 General 또는 RAG에서 이동하지 않는다.
- provider별 연결 마법사나 새로운 원격 모델 검색 정책을 만들지 않는다.
- Ternlight bundled embedding의 runtime·기본값 계약을 변경하지 않는다.

## 정보 구조

### 1. 현재 상태

- 전체 provider, 활성 provider, 준비 완료, 설정 필요 수를 평평한 status row로 요약한다.
- 준비가 필요한 provider가 있으면 첫 항목 하나만 primary next action으로 제공하고 해당 provider를 펼친다.
- `Provider 추가`는 이 section의 유일한 상시 primary action이다. 설정 필요 action이 있으면 추가는 secondary로 낮춘다.
- 모두 준비됐으면 유지보수 버튼 없이 짧은 완료 문장만 보여준다.

### 2. 연결 목록

- provider 하나를 공통 disclosure 한 개로 표현한다.
- 접힌 행은 이름, strategy, general/embedding 모델 수, 상태 label과 supporting detail을 보여준다.
- 동시에 하나만 펼치며 `button`, `aria-expanded`, `aria-controls`, Obsidian chevron을 사용한다.
- 빈 목록은 이유와 `Provider 추가` 한 가지 행동을 제공한다.

### 3. 펼친 provider

1. **연결 설정**
   - 활성화, 표시 이름, provider 종류, API key, base URL을 평평한 setting row로 배치한다.
   - API key는 기본 마스킹하고 접근 가능한 표시/숨김 버튼을 유지한다.
   - provider 종류 변경 시 기존 base URL 기본값 보정과 validation 초기화를 유지한다.
2. **일반 모델**
   - 원격 모델 가져오기를 section의 주 행동으로 두고, 수동 모델 추가 composer와 현재 모델 목록을 같은 흐름에 둔다.
   - 모델 행은 capability 상태, 최근 오류, 검증, 삭제를 한 줄에서 제공한다.
3. **임베딩 모델**
   - 일반 모델과 같은 row 계약을 쓰되 원격 가져오기 행동은 현재 기능 범위대로 노출하지 않는다.
4. **위험 작업**
   - provider 제거는 마지막 danger disclosure 안에 격리하고 확인 gate를 추가한다.

## 상태와 행동

- 기존 `ready`, `needs-key`, `needs-models`, `disabled` 판정을 그대로 사용한다.
- 상태는 색상만 쓰지 않고 label, state, supporting detail을 함께 표시한다.
- 연결에 필요한 API key나 모델이 없으면 펼친 provider 상단에 공통 warning notice를 한 번만 표시한다.
- provider 추가는 새 profile을 생성하고 해당 disclosure를 자동으로 펼친다.
- 모델 가져오기·검증은 기존 `runActionWithFeedback`의 loading/success/error 계약을 유지한다.
- 제거는 다른 설정 탭의 위험 작업처럼 설명을 펼친 뒤 확인 modal을 통과해야 실행한다.

## 컴포넌트 경계

- root는 `superpower-inside-settings-workspace superpower-inside-provider-workspace`를 사용한다.
- 최상위 영역은 `createSettingsSection`으로만 만든다.
- 전체 요약은 `createSettingsStatusRow`, next action은 `createSettingsActionRow`, 경고는 `createSettingsNotice`를 사용한다.
- provider 접힘은 `createSettingsDisclosure`의 공통 ARIA·icon 계약을 확장하고, 별도 hero card 체계를 만들지 않는다.
- 모델 관리에는 기존 callback을 유지하되 표면 class를 공통 row 중심으로 바꾼다.

## 접근성과 반응형

- provider disclosure와 model action은 모두 실제 button을 사용한다.
- 아이콘 단독 검증·삭제 버튼은 `aria-label`과 tooltip을 유지한다.
- 520px 이하에서 설정 label과 control, 모델 ID와 actions가 수직으로 재배치된다.
- URL, 모델 ID, validation error는 `overflow-wrap: anywhere`로 줄바꿈된다.
- focus-visible, dark/light 대비, reduced-motion을 공통 설정 계약으로 검수한다.

## 테스트 계약

- Providers 순서가 현재 상태와 연결 목록인지 고정한다.
- 기존 summary bar, provider shell, hero, quick fact, model shell class가 새 profile 경로에서 제거됨을 검증한다.
- 첫 attention만 primary action이고 provider 추가·자동 펼침이 유지됨을 검증한다.
- 한 번에 하나의 provider disclosure만 펼쳐지고 ARIA가 일치함을 검증한다.
- 연결 설정, 일반 모델, 임베딩 모델, 위험 작업 순서를 검증한다.
- API key 마스킹, strategy 변경, model fetch/add/verify/remove callback과 저장 계약을 유지한다.
- provider 제거 확인 gate, i18n, 좁은 폭 CSS를 검증한다.
- lint, typecheck, Vitest, security:full, build, Obsidian review gate를 통과한다.

## 시각 검수

코드와 전체 게이트 이후 `.test-vault`의 실제 Obsidian에서 다음을 스크린샷으로 확인한다.

- 모든 provider 접힘, ready provider 펼침
- API key 필요, 모델 필요, disabled 상태
- 일반/임베딩 모델 없음과 긴 모델 목록
- 모델 가져오기·검증의 idle/loading/error 표현
- danger disclosure와 제거 확인 modal
- 일반 폭·좁은 폭, light/dark, 긴 이름·URL·오류, focus-visible

## 완료 조건

- Providers가 General, RAG, Chat, MCP, Advanced와 같은 section·row·status·notice·disclosure 언어를 사용한다.
- 카드 속 카드와 전용 dashboard/hero 표면이 제거된다.
- 현재 상태와 다음 행동, 연결, 모델, 위험 작업의 위계가 3초 안에 읽힌다.
- 기존 provider 설정·검증·저장 기능에 회귀가 없고 모든 자동·비주얼 검증을 통과한다.
