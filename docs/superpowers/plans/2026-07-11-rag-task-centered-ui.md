# RAG 작업 중심 설정 UI 구현 계획

## 성공 기준

- RAG 탭은 준비 상태, 검색 기반 설정, GraphRAG 보강, 진단 및 복구 순서로 읽힌다.
- 최상위 section 외에는 카드 컨테이너를 중첩하지 않는다.
- 현재 상태와 필요한 primary action이 하나의 운영 표면에 있다.
- GraphRAG 작업은 평평한 action row를 사용하고 비활성화 이유를 반복하지 않는다.
- 기존 RAG/GraphRAG 콜백, refresh bus, 설정 저장과 Rust/WASM 계약을 유지한다.
- 관련 개발 문서가 공통 디자인 언어를 향후 화면의 기준으로 설명한다.
- 전체 품질 게이트와 실제 Obsidian 스크린샷 검수를 통과한다.

## 작업 순서

1. `src/settings-redesign.test.ts`에 새 정보 구조, 공통 helper, 중첩 카드 제거, disclosure 접근성 계약을 먼저 추가한다.
2. `src/settings.ts`에 RAG section·row·disclosure·action DOM helper를 추가하고 `buildRAGTab`의 네 영역을 재구성한다.
3. 기존 상태 갱신과 작업 callback을 새 DOM 참조에 연결하고 GraphRAG의 반복 disabled reason을 영역 단위 안내로 통합한다.
4. `src/i18n.ts`의 한국어·영어 제목과 안내 문구를 작업 언어로 정리한다.
5. `styles.css`에 Obsidian theme variable 기반 의미 토큰과 공통 RAG 컴포넌트를 정의하고 사용하지 않는 중첩 카드 스타일을 제거한다.
6. `AGENTS.md`, `docs/README_FOR_DEV.md`, `docs/DEV_SETUP.md`에 공통 디자인 기준과 검수 계약을 반영한다. README는 현재 사용자 흐름과 달라지는 내용이 있는지 검토하고 불필요한 변경은 하지 않는다.
7. lint, typecheck, 관련 Vitest, 전체 `security:full`, build, Obsidian review gate를 순서대로 통과시킨다.
8. `.test-vault`에서 플러그인을 reload하고 오류·console을 확인한 뒤 실제 RAG 탭의 상단, 기반 설정, GraphRAG 접힘/펼침, 진단/복구, 좁은 폭을 스크린샷으로 검수한다.
9. 검수에서 발견한 시각 회귀를 수정하고 동일 게이트와 화면 검수를 다시 실행한다.

## 변경 파일

- `src/settings-redesign.test.ts`
- `src/settings.ts`
- `src/i18n.ts`
- `styles.css`
- `AGENTS.md`
- `docs/README_FOR_DEV.md`
- `docs/DEV_SETUP.md`
- 필요 시 새 UI 계약을 직접 검증하는 추가 테스트 파일

## 변경하지 않는 파일

- `crates/rag-wasm/**`
- `generated/rag-wasm/**`
- RAG/GraphRAG 저장소와 검색 알고리즘 구현
- `.test-vault/**` 런타임 데이터
