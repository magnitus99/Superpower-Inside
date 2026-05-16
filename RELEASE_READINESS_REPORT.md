# Superpower Inside 1.0.0 출시 준비 보고서

## 요약

- 전체 판정: **1.0.0 출시 준비 완료**
- 프로젝트명, 플러그인 ID, 패키지명, 문서, 기본 채팅 폴더, 내부 prefix를 `Superpower Inside` / `superpower-inside` 기준으로 정리했다.
- 모바일 지원은 제외하고 `isDesktopOnly: true`로 전환했다.
- Obsidian 커뮤니티 제출 차단 항목이었던 금지 ID, lockfile 누락, LICENSE 누락, 릴리스 CI 테스트 누락을 정리했다.

## 주요 변경

- 제품 식별자:
  - `manifest.json`: `id=superpower-inside`, `name=Superpower Inside`, `version=1.0.0`, `isDesktopOnly=true`
  - `package.json`: `name=superpower-inside`, `version=1.0.0`
  - `versions.json`: `1.0.0` 추가
- 저장 경로와 내부 키:
  - 기본 채팅 저장 폴더: `SuperpowerInsideChats`
  - RAG 저장 파일: `.superpower-inside/vectors.json`, `.superpower-inside/bm25-index.json`
  - IndexedDB: `SuperpowerInsideEmbeddingCache`, `SuperpowerInsideVectorStore`
  - CSS/view/event/comment prefix: `superpower-inside-*`
- 호환성:
  - 기존 `SuperObsidianByAI`, `SuperObsidianByAIChats` 기본 설정값은 새 채팅 폴더로 자동 마이그레이션한다.
  - 기존 `super-obsidian-*` 채팅 저장 comment marker는 계속 읽을 수 있다.
  - 기존 데이터 파일과 IndexedDB는 자동 이동하지 않는다.
- 릴리스 준비:
  - `LICENSE` 추가
  - `package-lock.json` 추적 가능 상태로 전환
  - release workflow에 테스트와 `versions.json` 버전 확인 추가
  - `scripts/bump-version.fish`가 `versions.json`, `package-lock.json`, `styles.css`를 함께 처리하도록 보완
  - main 직접 push를 막고 현재 작업 브랜치 push로 변경

## 확인한 이슈 처리

- Obsidian plugin ID의 `obsidian` 포함 문제를 `superpower-inside`로 해결했다.
- README의 MCP 설명을 stdio 중심으로 정정했다.
- 인터넷 검색은 내장 검색이 아니라 검색 MCP 서버 구성 시 가능한 기능으로 설명했다.
- README에 API 키 평문 저장, 외부 LLM/임베딩/MCP로 전송될 수 있는 데이터 범위를 추가했다.
- RAG 초기화 후 파일 이벤트가 등록되도록 `initRAG()` 생명주기를 정리했다.
- RAG 재초기화 시 기존 이벤트를 해제하고 새 이벤트를 등록한다.
- production `console.log`를 제거했다.

## 검증

- `npm run lint`: 통과
- `npm run typecheck`: 통과
- `npm run test`: 16 files passed, 1 skipped / 84 tests passed, 1 skipped
- `npm run build`: 통과
- 임시 clean worktree 복사본에서 `npm ci --dry-run`: 통과

## 남은 수동 QA

- `.test-vault`에서 플러그인 로드 확인
- 설정 탭 열기 확인
- 채팅 뷰 열기 확인
- `SuperpowerInsideChats` 폴더에 채팅 저장 확인
- RAG 재인덱싱 명령 확인
- MCP 설정 화면과 reconnect 확인
