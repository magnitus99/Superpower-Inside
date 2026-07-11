# General 작업 중심 설정 UI 설계

## 결정

General 탭을 지표 대시보드가 아니라 설정 화면의 작업 중심 진입점으로 재구성한다. 이미 리워크된 Providers와 RAG의 표면 계층, 설정 행, 상태, 행동, disclosure 계약을 설정 전역에서 재사용할 수 있는 범용 컴포넌트로 승격하고 General에 먼저 적용한다.

이번 변경은 Obsidian 설정 DOM과 host integration 경계에 한정한다. 기존 설정 스키마, 저장 값, 상태 계산, provider/RAG/MCP 런타임, 진단 파일 형식과 초기화 동작은 변경하지 않는다.

## 목표

- 화면을 연 뒤 3초 안에 전체 준비 상태와 가장 가까운 다음 행동을 파악할 수 있다.
- 상태 확인, 기본 설정, 세부 조정, 진단, 파괴적 복구가 명확한 순서로 읽힌다.
- General, Providers, RAG가 같은 section, row, status, notice, action, disclosure 언어를 사용한다.
- 향후 Chat, MCP, Advanced 탭이 화면별 전용 카드 체계를 만들지 않고 같은 범용 helper와 토큰을 재사용할 수 있다.
- 사용자가 행동할 필요가 없는 상태는 조용히 보여주고 수동 유지보수 작업을 일상 흐름의 중심에 두지 않는다.

## 비목표

- Chat 사이드바, GraphRAG explorer, Agent Diagnostics view 같은 설정 밖의 화면은 변경하지 않는다.
- Providers, RAG, Chat, MCP, Advanced 탭의 정보 구조를 이번 사이클에서 함께 다시 만들지 않는다.
- overview snapshot의 상태 판정, attention 우선순위 또는 target tab 계산을 새로 구현하지 않는다.
- 설정 스키마, 기본값, migration, 저장 주기 또는 reset 범위를 변경하지 않는다.
- Rust/WASM API나 결정적 계산을 TypeScript로 옮기거나 복제하지 않는다.
- 새로운 수동 새로고침, 진단 또는 복구 옵션을 추가하지 않는다.

## 현재 문제

- 상단 metric 카드, attention 카드, provider/MCP matrix, RAG/chat matrix가 같은 정보를 여러 시각적 무게로 반복한다.
- General 전용 overview panel과 RAG의 공통 section/row가 서로 다른 제품처럼 보인다.
- 수동 새로고침 버튼이 자동 상태 반영보다 중요한 기본 작업처럼 노출된다.
- 언어, 자동 저장, 저장 지연, 기본 모델이 한 패널에 나열되어 핵심 선택과 세부 튜닝의 위계가 없다.
- Agent Diagnostics의 토글, view, 경로, snapshot, 로그 정리가 모두 펼쳐져 일상 설정과 유지보수가 경쟁한다.
- 전체 데이터 초기화가 별도 위험 카드로 항상 노출되어 복구 기능이 기본 흐름의 일부처럼 보인다.

## 정보 구조

General 탭은 아래 순서의 네 영역으로 구성한다.

1. **현재 상태**
   - Provider, 검색, MCP, 채팅 준비 상태를 공통 status row로 요약한다.
   - 기존 overview snapshot이 제공하는 상태, 근거, 대상 탭을 그대로 사용한다.
   - attention 항목이 있으면 기존 정렬의 첫 항목만 primary action으로 강조하고 나머지는 일반 상태 행으로 유지한다.
   - 모든 항목이 준비됐으면 성공 배너나 수동 새로고침 버튼 없이 짧은 준비 완료 문장만 보여준다.
2. **기본 설정**
   - 언어, 기본 모델, 설정 자동 저장을 평평한 설정 행으로 보여준다.
   - 현재 값을 이해하는 데 필요한 설명만 남기고 기술적인 저장 구현 설명은 세부 영역으로 옮긴다.
   - 모델이 없으면 dropdown을 비활성화하고 Providers 탭으로 이동하는 가까운 복구 행동 하나를 제공한다.
3. **진단**
   - 기본 화면에는 Agent Diagnostics 사용 여부와 짧은 상태 설명, disclosure만 보여준다.
   - 펼친 영역에서 활성화 토글, 진단 view 열기, 파일 경로, snapshot 작성, 상세 로그 정리를 제공한다.
   - 상태 확인 행동과 로그 정리 행동은 primary action과 같은 시각적 무게를 갖지 않는다.
4. **고급 및 복구**
   - 자동 저장 지연은 고급 설정 disclosure 안에 둔다.
   - 전체 데이터 초기화는 마지막 위험 disclosure 안에 격리한다.
   - 위험 disclosure를 펼치기 전에도 되돌릴 수 없는 작업이 포함됐음을 알 수 있어야 한다.
   - 기존 이중 확인과 action feedback 계약은 그대로 유지한다.

## 공통 설정 컴포넌트

RAG 전용 helper를 직접 재사용하는 대신 의미가 범용적인 설정 helper를 만든다.

- `createSettingsSection`: 최상위 카드 표면과 제목, 설명, body를 만든다.
- `createSettingsRow`: label, supporting detail, control/action slot을 가진 평평한 행을 만든다.
- `createSettingsStatusRow`: label, state, supporting detail, 선택적 target action을 만든다.
- `createSettingsNotice`: 정보, 주의, 오류를 색상과 텍스트·아이콘으로 함께 표현한다.
- `createSettingsDisclosure`: button, `aria-expanded`, `aria-controls`, Obsidian chevron icon, content를 만든다.
- `createSettingsActionRow`: 설명과 하나의 주 행동 또는 필요한 보조 행동을 배치한다.

기존 RAG helper는 범용 helper에 위임하거나 공통 class를 함께 사용한다. RAG의 상태 갱신 DOM 참조와 기능 동작은 유지하며 한 번에 모든 RAG 코드를 기계적으로 이름 변경하지 않는다. General 전용 class는 배치가 실제로 다른 경우에만 추가하고 section, row, disclosure의 기본 치수와 상태 표현은 공통 class가 소유한다.

## 상태와 행동

### 준비 완료

- 전체 준비 상태를 한 문장으로 조용히 표시한다.
- 각 영역의 상태는 label, state, supporting detail 행으로 확인할 수 있다.
- 새로고침이나 재연결 같은 유지보수 행동을 기본 primary action으로 만들지 않는다.

### 설정 필요

- 기존 attention 항목의 첫 대상을 가장 작은 다음 행동으로 제공한다.
- 나머지 문제는 같은 상태 section의 일반 행으로 보여주고 경쟁하는 primary button을 만들지 않는다.
- action은 기존 target tab으로 이동하며 General에서 해당 기능 설정을 복제하지 않는다.

### 진행 중 또는 부분 오류

- RAG/GraphRAG/MCP의 기존 runtime 상태를 supporting detail에 반영한다.
- 진행 중임을 이유로 General 전체를 disabled 처리하지 않는다.
- 상세 오류와 복구는 해당 기능 탭 또는 Agent Diagnostics view에서 확인하도록 연결한다.

### 비어 있음

- provider나 MCP server가 없을 때 0 값 metric 카드를 만들지 않는다.
- 무엇이 아직 준비되지 않았는지와 설정할 위치를 한 문장과 하나의 action으로 설명한다.

## 자동 상태 반영

- General 상단에서 수동 refresh button을 제거한다.
- 기존 `refreshBus`의 `models`, `rag`, `mcp`, `graph-data` 이벤트가 발생하면 현재 General 탭의 status section만 다시 그린다.
- 언어 dropdown, 숫자 입력, disclosure focus 같은 사용 중인 control을 보존하기 위해 전체 General 탭을 이벤트마다 다시 만들지 않는다.
- async 결과는 현재 설정 tab과 연결된 DOM인지 확인한 뒤 반영한다.
- refresh bus가 제공하지 않는 상태를 위한 새 polling loop는 추가하지 않는다.

## 기본 설정 동작

- 언어 변경의 확인 modal, 저장, reload 계약을 유지한다.
- 기본 모델 option 생성과 저장 방식은 유지한다.
- 설정 자동 저장 토글과 `saveSettingsLight()` 계약을 유지한다.
- 자동 저장 지연은 disclosure로 이동하지만 유효 범위 `0–5000 ms`와 debounced save 동작을 유지한다.
- 자동 저장이 꺼져 있어도 저장 지연값을 삭제하거나 바꾸지 않는다. disclosure 안에서 설정 의미를 설명하고 기존 값은 보존한다.

## 진단과 초기화

- Agent Diagnostics가 꺼져 있으면 status row에서 비활성 상태와 켰을 때의 효과를 설명한다.
- 진단 view, 파일 경로, snapshot, 상세 로그 정리는 disclosure 안에 둔다.
- 파일 경로는 좁은 폭에서 줄바꿈되며 code-like styling을 사용하되 raw color를 추가하지 않는다.
- 전체 데이터 초기화는 danger notice와 범위 설명을 펼친 뒤에만 button을 노출한다.
- 초기화 button은 기존 `runActionWithFeedback`, 두 번의 `confirmWithModal`, 성공 후 settings rerender를 유지한다.

## 접근성과 반응형

- status target과 disclosure는 실제 `button`을 사용한다.
- disclosure는 고유한 content id, `aria-expanded`, `aria-controls`를 제공한다.
- 아이콘 단독 action은 만들지 않으며 필요한 경우 접근 가능한 이름을 제공한다.
- status 갱신은 한 곳의 `role=status` 또는 `aria-live=polite`로 알리고 같은 상태를 중복 낭독하지 않는다.
- 좁은 설정 modal에서는 label/detail과 control/action을 수직으로 재배치한다.
- 긴 모델명, 진단 경로, 오류 문구는 `overflow-wrap`으로 줄바꿈하고 가로 스크롤을 만들지 않는다.
- keyboard focus, dark/light theme 대비, reduced-motion을 기존 설정 디자인 계약과 함께 확인한다.

## 오류 처리

- overview snapshot 생성 실패를 무근거 정상 상태로 바꾸지 않는다.
- runtime이 없거나 오류 상태면 기존 snapshot의 tone과 detail을 유지해 표시한다.
- 상태 section의 자동 갱신이 실패해도 기본 설정 control을 제거하거나 저장을 막지 않는다.
- 진단 snapshot 작성, 로그 정리, 전체 초기화의 기존 Notice와 action feedback을 유지한다.
- 모델 option이 없을 때 빈 dropdown을 활성화하지 않고 Providers 이동 행동을 제공한다.

## 테스트 계약

테스트를 먼저 갱신해 아래 구조를 고정한다.

- General 순서가 현재 상태, 기본 설정, 진단, 고급 및 복구다.
- 상단 수동 refresh button과 metric dashboard grid가 제거된다.
- General과 RAG가 범용 section, row, status, disclosure class/helper를 공유한다.
- attention의 primary action은 한 개를 넘지 않는다.
- 언어, 기본 모델, 자동 저장의 기존 callback과 저장 계약이 유지된다.
- 자동 저장 지연, 진단 상세, 전체 데이터 초기화가 disclosure 안에 있다.
- 위험 disclosure와 초기화 button의 접근성·이중 확인 계약이 유지된다.
- refresh bus 갱신은 status section만 대상으로 하고 활성 control을 포함한 전체 탭을 다시 그리지 않는다.
- 모든 새 사용자 문구가 한국어·영어 i18n 계약을 충족한다.
- runtime TypeScript에 inline style, `innerHTML`, 직접 heading element 같은 community review 금지 패턴이 없다.

기능 회귀 검증은 overview snapshot 테스트, settings migration·저장 테스트, action feedback 테스트를 유지한 채 실행한다. 구현 후 lint, typecheck, 관련 Vitest, `npm run security:full`, `npm run build`, 현재 manifest 버전의 `npm run review -- --tag <version> --built`를 순서대로 통과해야 한다.

## 시각 검수

`.test-vault`의 실제 Obsidian 설정 modal에서 다음 상태를 스크린샷으로 확인한다.

- 준비 완료 상태와 attention이 있는 상태
- 기본 설정의 일반 폭과 좁은 폭 배치
- 모델 없음과 target action
- 접힌 진단, 펼친 진단, 긴 파일 경로
- 접힌 고급 및 복구, 자동 저장 지연, 펼친 위험 영역
- 초기화 button의 idle, focus-visible, 확인 modal
- dark theme와 가능한 경우 light theme
- 긴 한국어·영어 문구의 줄바꿈과 overflow

코드·테스트 게이트가 통과해도 실제 화면을 보지 않았다면 General UI 리워크는 완료로 판단하지 않는다.

## 문서 반영 범위

- `docs/README_FOR_DEV.md`는 새 범용 설정 helper를 이후 탭의 기본 구현 계약으로 설명한다.
- `docs/DEV_SETUP.md`는 General 상태·disclosure·좁은 폭 시각 QA 항목을 추가한다.
- `AGENTS.md`의 기존 작업 중심 UI 디자인 계약은 이미 이번 결정을 포함하므로 중복 문구를 추가하지 않는다.
- `README.md`는 사용자 기능이나 설정 방법이 달라지지 않으므로 변경하지 않는다.

## 완료 조건

- General이 현재 상태, 필요한 행동, 기본 설정, 진단, 고급 및 복구 순서로 읽힌다.
- metric dashboard와 수동 refresh 중심 구조가 제거된다.
- General과 RAG가 범용 설정 컴포넌트와 의미 토큰을 공유한다.
- 일상 설정과 진단·파괴적 복구가 점진적으로 분리된다.
- 기존 설정 값, 저장, runtime 상태, 진단, 초기화 계약이 유지된다.
- 테스트, 보안, 빌드, Obsidian review gate가 모두 통과한다.
- 실제 Obsidian 스크린샷에서 정보 위계, 밀도, 정렬, 대비, 반응형, focus와 상태 변화가 승인된다.
