# General 작업 중심 설정 UI 구현 계획

## 성공 기준

- General 탭은 현재 상태, 기본 설정, 진단, 고급 및 복구 순서로 읽힌다.
- metric dashboard와 수동 refresh button을 제거하고 기존 overview snapshot을 평평한 status row로 표현한다.
- 첫 attention 항목만 primary action으로 노출한다.
- General과 RAG가 범용 section, row, disclosure 토큰과 helper를 공유한다.
- 자동 상태 갱신은 General status section만 다시 그려 사용 중인 control과 focus를 보존한다.
- 기존 언어 변경, 기본 모델, 자동 저장, 진단, 전체 초기화 동작을 유지한다.
- 전체 품질 게이트와 실제 Obsidian 스크린샷 검수를 통과한다.

## 작업 순서

1. `src/settings-redesign.test.ts`와 관련 설정 테스트에 General 정보 구조, 단일 primary action, disclosure, 부분 갱신 계약을 먼저 추가한다.
2. `src/settings.ts`에 범용 settings section·row·status·notice·disclosure helper를 추가하고 기존 RAG helper가 공통 구조를 재사용하도록 연결한다.
3. `buildGeneralTab`을 현재 상태, 기본 설정, 진단, 고급 및 복구 네 영역으로 재구성한다.
4. refresh bus의 models, rag, mcp, graph-data 이벤트가 General status section만 갱신하도록 DOM 참조와 guard를 추가한다.
5. 언어, 기본 모델, 자동 저장, 저장 지연, 진단, 초기화 callback을 새 구조에 연결한다.
6. `src/i18n.ts`의 한국어·영어 General 문구를 작업 언어로 정리한다.
7. `styles.css`에 범용 설정 의미 토큰과 반응형 규칙을 추가하고 General의 사용하지 않는 dashboard 규칙을 제거한다.
8. `docs/README_FOR_DEV.md`와 `docs/DEV_SETUP.md`에 범용 helper와 General 시각 QA 계약을 반영한다.
9. lint, typecheck, 관련 Vitest를 반복해 구조와 동작 회귀를 수정한다.
10. `npm run security:full`, `npm run build`, 현재 manifest 버전의 review gate를 통과시킨다.
11. `.test-vault`의 실제 Obsidian 설정 modal에서 상태, disclosure, 위험 영역, 좁은 폭, dark/light theme를 스크린샷으로 검수하고 발견한 시각 회귀를 보정한다.

## 변경 파일

- `src/settings-redesign.test.ts`
- `src/settings.ts`
- `src/i18n.ts`
- `styles.css`
- `docs/README_FOR_DEV.md`
- `docs/DEV_SETUP.md`
- 필요하면 General 부분 갱신을 직접 검증하는 추가 테스트 파일

## 변경하지 않는 파일

- `crates/rag-wasm/**`
- `generated/rag-wasm/**`
- 설정 스키마와 migration
- provider/RAG/MCP 상태 계산과 저장소 구현
- Agent Diagnostics 파일 형식과 view
- `.test-vault/**` 런타임 데이터
