# RAG 작업 중심 설정 UI 설계

## 결정

RAG 탭의 기존 대시보드·설정 카드·배너·중첩 접이식 패널을 부분 보정하지 않고 작업 중심 화면으로 전면 재구성한다. 일반 RAG와 GraphRAG는 하나의 디자인 언어를 사용하며, 사용자가 지금 판단하거나 실행해야 하는 일부터 보여준다.

이번 변경은 프론트엔드와 Obsidian host integration 경계에 한정한다. 검색, 랭킹, 인덱싱 계획, GraphRAG 추출·저장·질의 계산을 담당하는 Rust/WASM 코어와 런타임 데이터 계약은 변경하지 않는다.

## 목표

- 화면을 연 뒤 3초 안에 현재 검색 준비 상태와 필요한 다음 행동을 파악할 수 있다.
- 일상 작업, 설정, 고급 진단, 파괴적 복구를 시각적·구조적으로 분리한다.
- 상태, 설정 행, 안내, 작업, 접이식 영역에 하나의 공통 디자인 언어를 적용한다.
- 일반 RAG와 GraphRAG가 별도 제품처럼 보이지 않고 하나의 검색 준비 흐름으로 읽힌다.
- 향후 Providers, Chat, MCP, Advanced 화면도 같은 원칙으로 점진적으로 전환할 수 있는 재사용 가능한 기준을 남긴다.

## 비목표

- Rust/WASM API, 인덱스 형식, RAG 또는 GraphRAG 알고리즘을 변경하지 않는다.
- 설정 스키마나 저장된 사용자 값을 마이그레이션하지 않는다.
- 새로운 유지보수 옵션이나 수동 작업을 추가하지 않는다.
- 모든 설정 탭을 이번 변경에서 동시에 다시 만들지 않는다.
- README를 변경 이력이나 디자인 시스템 문서로 만들지 않는다.

## 정보 구조

RAG 탭은 아래 순서의 네 영역으로 구성한다.

1. **검색 준비 상태**
   - 일반 검색과 GraphRAG 보강 상태를 한 표면에서 요약한다.
   - 사용자가 해야 할 행동이 없으면 상태와 짧은 근거만 보여준다.
   - 행동이 필요하면 가장 작은 다음 행동 하나만 primary action으로 보여준다.
   - 인덱싱 중단처럼 현재 작업과 직접 관련된 보조 행동만 함께 노출한다.
2. **검색 기반 설정**
   - 임베딩 모델과 인덱싱 제외 범위를 같은 설정 행 체계로 보여준다.
   - Ternlight 개인정보·로컬 실행 안내는 별도 홍보 배너가 아니라 선택한 모델의 맥락 안내 행으로 표현한다.
3. **GraphRAG 보강**
   - 기본 화면에는 상태, 핵심 수치, 데이터 전송 여부, 펼치기 행동만 보여준다.
   - 세부 설정과 운영 작업은 하나의 disclosure 안에서 점진적으로 공개한다.
   - 비활성화 원인은 영역 상단에서 한 번 설명하고 각 작업마다 반복하지 않는다.
4. **진단 및 복구**
   - 성능 튜닝, 통계, 파일 형식, stale 문서 목록, 전체 재인덱싱, 데이터 초기화를 일상 흐름에서 분리한다.
   - 파괴적 작업은 마지막 위험 구역에 두고 확인 모달 계약을 유지한다.

## 공통 디자인 언어

### 표면 계층

- 탭 배경 위에는 최상위 `section` 표면만 카드로 표현한다.
- section 안의 설정과 작업은 평평한 `row`로 표현하고 카드 속 카드 구조를 만들지 않는다.
- row 사이의 구분은 배경색 변화가 아니라 공통 구분선과 간격을 사용한다.
- 상태 강조가 필요한 경우에만 의미 색상을 사용한다. 일반 컨테이너에는 성공·경고 색을 칠하지 않는다.

### 공통 치수

- 최상위 section은 하나의 border radius, border, background, padding 값을 공유한다.
- section 사이 간격, row 세로 padding, 제목과 설명 사이 간격을 공통 CSS custom property로 정의한다.
- 버튼 높이와 아이콘 크기를 통일하고, 전체 폭 버튼은 명확한 단일 primary action에만 사용한다.
- 좁은 폭에서는 row의 설명과 control을 수직으로 재배치하며 텍스트와 버튼이 겹치지 않아야 한다.

### 제목과 문구

- section 제목은 사용자의 작업 언어로 쓴다.
- 내부 용어는 사용자가 값을 선택하거나 진단해야 할 때만 설명에 둔다.
- 상태 문장은 한 문장으로 제한하고, 행동이 필요한 이유와 결과를 함께 전달한다.
- 동일한 비활성화 이유를 여러 작업 카드 아래 반복하지 않는다.

### 상태와 행동

- 상태는 `label + state + supporting detail`의 동일한 행 구조를 사용한다.
- primary action은 한 영역에 최대 하나다.
- secondary action은 현재 상태를 이해하거나 되돌리는 데 필요한 경우에만 둔다.
- recovery와 destructive action은 primary action과 같은 시각적 무게를 갖지 않는다.
- 로딩, 진행 중, 성공, 주의, 오류는 색상만으로 구분하지 않고 텍스트와 아이콘을 함께 사용한다.

### Disclosure

- GraphRAG 세부 운영과 진단 영역은 같은 disclosure 컴포넌트를 사용한다.
- 텍스트 삼각형 대신 Obsidian 아이콘을 사용한다.
- header는 button, `aria-expanded`, `aria-controls`를 제공한다.
- 접힌 상태에서도 현재 상태와 사용자가 펼쳐야 하는 이유를 알 수 있어야 한다.

## 프론트엔드 구성

`src/settings.ts`의 기존 런타임 호출은 유지하고 DOM 구성 helper만 재정리한다.

- RAG section, row, status, notice, disclosure, action row를 만드는 작은 DOM helper를 추가한다.
- helper는 Obsidian DOM 생성과 표시만 담당하며 상태 판정이나 검색 정책을 계산하지 않는다.
- 기존 `updateRagStats`, `updateRagControlStates`, GraphRAG refresh bus 구독과 버튼 action callback을 새 DOM 참조에 다시 연결한다.
- 전체 탭을 다시 그리는 대신 기존 부분 업데이트 계약을 유지한다.
- runtime이 없거나 오래된 async 결과가 돌아오면 기존 revision·guard 계약에 따라 최신 화면만 갱신한다.

## 상태별 표현

### 준비 완료

- 상태와 최신 문서 수를 조용히 표시한다.
- 수동 새로고침이나 재인덱싱을 primary action으로 노출하지 않는다.

### 설정 필요

- 원인을 한 문장으로 설명한다.
- 임베딩 선택 또는 provider 확인처럼 가장 가까운 복구 행동 하나를 제공한다.

### 업데이트 필요

- stale 문서 수와 자동 처리 여부를 표시한다.
- 자동 처리가 꺼졌거나 실패했을 때만 업데이트 행동을 primary로 제공한다.

### 진행 중

- 현재 단계와 진행 정보를 한 상태 행에 갱신한다.
- 중단 행동은 secondary로 제공한다.
- 진행 중인 상태 때문에 사용할 수 없는 다른 작업은 숨기거나 영역 단위 안내로 설명한다.

### 부분 성공·오류

- 실패 범위와 다음 행동을 한 문장으로 표시한다.
- 실패만 재시도처럼 손실이 가장 적은 행동을 우선한다.
- 상세 오류 코드와 파일 목록은 진단 영역에서 확인한다.

### 비어 있음

- 빈 통계 카드나 0 값 격자를 만들지 않는다.
- 아직 데이터가 없는 이유와 데이터가 생기는 조건을 짧게 설명한다.

## 접근성과 반응형

- 모든 disclosure와 action은 키보드로 도달하고 실행할 수 있어야 한다.
- `focus-visible` 상태가 Obsidian 테마에서 식별 가능해야 한다.
- 상태 갱신은 적절한 `role=status` 또는 `aria-live=polite` 영역을 사용하되 같은 내용을 중복 낭독하지 않는다.
- 아이콘 단독 버튼에는 접근 가능한 이름을 제공한다.
- 의미 색상의 텍스트 대비와 비활성 설명의 가독성을 실제 dark/light theme에서 확인한다.
- 설정 modal의 좁은 폭에서 control이 설명 아래로 이동하고 긴 경로·모델명·오류 문구가 overflow 없이 줄바꿈되어야 한다.
- 동작 전환에는 reduced-motion 선호를 존중한다. 새 장식 모션은 추가하지 않는다.

## CSS 정리

- 새 공통 RAG section/row/disclosure/action 토큰을 먼저 정의한다.
- 기존 `.superpower-inside-rag-*` 규칙 중 새 구조에서 사용하지 않는 카드·배너·action-card·중첩 details 스타일을 제거한다.
- 같은 selector가 파일 여러 위치에서 서로 덮어쓰는 현재 중복을 정리한다.
- Obsidian theme variable만 사용하고 inline style, 임의 고정 색상, `innerHTML`, 직접 heading element를 추가하지 않는다.

## 테스트 계약

테스트를 먼저 갱신해 다음 구조를 고정한다.

- 탭 순서가 검색 준비 상태, 검색 기반 설정, GraphRAG 보강, 진단 및 복구 순서다.
- 일반 RAG와 GraphRAG가 공통 section/row/status/disclosure helper를 사용한다.
- status와 required action이 별도 경쟁 카드로 렌더링되지 않는다.
- GraphRAG 세부 영역에 section 카드가 중첩되지 않는다.
- 반복되는 disabled-reason 카드가 없고 영역 단위 안내를 사용한다.
- recovery와 destructive action이 기본 흐름에서 접혀 있다.
- disclosure button에 `aria-expanded`와 `aria-controls`가 있다.
- 모든 사용자 문구가 한국어·영어 i18n 계약을 충족한다.
- Obsidian community review 금지 패턴이 없다.

기능 회귀 검증은 기존 action callback, refresh bus, 상태 계산 테스트를 유지한 채 실행한다. UI 변경 후 `npm run security:full`, `npm run build`, 현재 manifest 버전의 `npm run review -- --tag <version> --built`를 통과해야 한다.

## 시각 검수

`.test-vault`의 실제 Obsidian 설정 modal에서 다음 상태를 스크린샷으로 확인한다.

- RAG 탭 상단의 준비·업데이트·진행 중 상태
- 임베딩 선택과 Ternlight 안내
- 인덱싱 제외 설정
- 접힌 GraphRAG 요약과 펼친 설정·작업 영역
- 접힌 진단 영역과 펼친 통계·복구·위험 구역
- 좁은 modal 폭, 긴 텍스트, dark theme와 가능한 경우 light theme
- hover, focus-visible, disabled, 진행 중 상태

완료 판단은 테스트 통과와 실제 픽셀 검수를 모두 요구한다.

## 문서 반영 범위

- `AGENTS.md`: 향후 모든 설정 화면에 적용할 작업 중심 디자인 gate와 공통 표면·행·상태·행동·disclosure 규칙을 추가한다.
- `docs/README_FOR_DEV.md`: 설정 UI 개발 절차에 공통 디자인 언어, 프론트엔드/Rust 경계, 상태별 검증 체크리스트를 추가한다.
- `docs/DEV_SETUP.md`: 실제 Obsidian 화면에서 수행할 시각 QA 상태와 좁은 폭·테마·접근성 확인 절차를 구체화한다.
- `README.md`: 사용자 가치나 사용 흐름이 현재 설명과 달라지는 경우에만 자연스럽게 갱신한다. 이번 작업은 기존 “상태와 최소 행동” 설명을 구현하는 변경이므로 중복 디자인 설명을 추가하지 않는다.

## 완료 조건

- RAG 탭의 모든 하위 영역이 하나의 section/row/disclosure 디자인 언어를 사용한다.
- 카드 속 카드와 반복되는 상태·비활성화 설명이 제거된다.
- 현재 상태와 필요한 다음 행동이 첫 화면에서 명확하다.
- GraphRAG와 진단·복구가 점진적으로 공개된다.
- 기존 RAG/GraphRAG 기능과 저장 계약이 유지된다.
- 관련 기존 문서가 새 디자인 계약과 일치한다.
- 테스트, 보안, 빌드, Obsidian review gate가 모두 통과한다.
- 실제 Obsidian 스크린샷 검수에서 정보 위계, 밀도, 정렬, 대비, 반응형, 상태 변화가 승인된다.
