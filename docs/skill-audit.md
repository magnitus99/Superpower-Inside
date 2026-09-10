# 저장소 스킬 검토

**현재 구성: 저장소 스킬 4개 유지.** 사용자 승인에 따라 관련성이 낮은 7개 스킬과 그 참고 파일을 제거했습니다.

2026-09-10에 `src/`, `crates/`, `scripts/` 전역에서 관련 기술과 기능을 검색하고, 해당 구현·테스트·스킬 본문을 읽어 판단했습니다. 모든 소스 파일을 정독한 코드 감사나 사용 빈도 통계는 아닙니다. 기준은 스킬이 현재 구현에 주는 추가 가치입니다. 미래에 사용할 가능성만으로 유지 권고를 하지 않습니다.

## 제거한 스킬 — 7개

| 스킬 | 판단 근거 |
| --- | --- |
| `rust-async-patterns` | Tokio 비동기 런타임·서버 I/O 중심입니다. 실제 Rust는 WASM 계산 코어이며 [crate 의존성](../crates/rag-wasm/Cargo.toml)에 Tokio가 없습니다. [계산 구현](../crates/rag-wasm/src/lib.rs)의 벡터 랭킹·청킹·커뮤니티 계산에 이 런타임 지침을 유지할 이유가 없습니다. |
| `architecture-patterns` | 서버·ORM·마이크로서비스·DDD 중심입니다. 현재 [TS 호스트 어댑터](../src/agent/obsidian-native-vault-port.ts), [WASM 연결부](../src/rag/rust-core.ts), Rust 계산 경계에 대한 구체적 규칙은 이미 AGENTS.md에 있습니다. 일반 서버 계층 예시보다 기존 경계와 호출부를 읽는 것이 정확합니다. |
| `obsidian-bases` | Bases 필터·수식·뷰를 저작하는 스킬입니다. 실제 `Base.base` 출현은 [GraphRAG 선별·제외 회귀 테스트](../src/graph/indexing-runner.test.ts)와 [Rust 경계 테스트](../src/rag/rust-core.test.ts) 등에 있습니다. 파일을 선별하거나 텍스트로 취급하는 것과 Bases 수식·뷰를 저작하는 것은 다릅니다. 현재 저작 기능은 확인되지 않았습니다. |
| `json-canvas` | JSON Canvas 노드·엣지·그룹 파일 저작 스킬입니다. [그래프 파일 선별](../src/graph/file-paths.ts)과 [테스트](../src/graph/file-paths.test.ts)는 Markdown 범위를 다룹니다. [응답 레이아웃](../src/chat/assistant-response-layout.ts)의 `canvas`는 DOM 컨테이너 이름이며 JSON Canvas 기능이 아닙니다. |
| `defuddle` | 웹페이지를 Markdown으로 정제하는 별도 CLI 절차입니다. 소스·스크립트·의존성 검색에서 Defuddle 연결은 없으며, 현재 개발의 API 확인은 Context7·공식 문서로 처리합니다. 저장소에 상시 둘 추가 가치가 낮습니다. |
| `e2e-testing-patterns` | 실제 [제품 여정 테스트](../src/e2e/product-journeys.test.ts)는 Vitest·Dexie·가짜 볼트로 리서치와 도구 왕복을 검증합니다. [live MCP 테스트](../src/mcp/live-mcp.test.ts)의 Playwright는 연결 대상 서버 이름입니다. 이 스킬의 Playwright/Cypress 러너·Page Object 중심 절차는 현재 테스트 구현과 맞지 않습니다. 검증 명령과 시각 검수 계약은 AGENTS.md에 이미 있습니다. |
| `typescript-advanced-types` | TS 타입 검증은 중요하지만, 이 스킬은 범용 제네릭·유틸리티 타입 문법 안내가 대부분입니다. 실제 [인덱스 연결부](../src/utils/rust-index-plan.ts)의 `selectByRustIndices<T>`와 [채팅 타입](../src/chat/types.ts)은 기존 계약·strict 검사로 검토할 수 있습니다. 스킬의 `any` 예제와 production 타입체크 생략 조언은 이 저장소 규칙에도 맞지 않아 상시 유지할 이득이 낮습니다. |

## 유지하는 스킬 — 4개

| 스킬 | 실제로 필요한 지점 | 적용 범위 |
| --- | --- | --- |
| [rust-best-practices](../.agents/skills/rust-best-practices/SKILL.md) | [Rust 코어](../crates/rag-wasm/src/lib.rs)의 `rank_top_k_pairs`, `detect_communities_flat`, `chunk_markdown_json` 등 실제 계산에서 메모리 복사·빌림·할당·오류 처리를 검토할 때 유용합니다. | Rust 변경 때 관련 장만 읽습니다. lint 예외 등 저장소와 충돌하는 일반 권고는 적용하지 않습니다. |
| [obsidian-cli](../.agents/skills/obsidian-cli/SKILL.md) | 네이티브 플러그인을 재로드하고 오류·DOM·화면을 확인하는 구체적인 실행 절차를 제공합니다. [개발 볼트 준비](../scripts/setup-dev.fish)와 실제 앱 검수 흐름에 연결됩니다. | 실제 설치 CLI의 `obsidian help`로 명령을 확인하고 테스트 볼트를 명시합니다. |
| [obsidian-markdown](../.agents/skills/obsidian-markdown/SKILL.md) | [참조 확장 테스트](../src/chat/context-expansion.test.ts)는 위키링크·임베드·상대 경로를, [저장 테스트](../src/chat/persistence.test.ts)는 이전 세션 복원·메타데이터 왕복을 검증합니다. Obsidian 고유 문법이 제품 동작 계약입니다. | 링크·임베드·저장 형식·청킹 작업에서 사용합니다. 일반 개발 문서 편집에는 필요 없습니다. |
| [design-system-patterns](../.agents/skills/design-system-patterns/SKILL.md) | [styles.css](../styles.css)에 Obsidian 테마로 연결된 의미 토큰, 설정 section·row, focus와 motion 규칙이 실제로 있습니다. 여러 화면의 일관성을 정비할 때 사용할 대상이 명확합니다. | 의미 토큰·테마·접근성 원칙만 사용합니다. React provider·Figma 파이프라인·독자 팔레트를 도입하는 근거로 삼지 않습니다. |

스킬 제거는 해당 분야의 검증을 없애는 변경이 아닙니다. 타입 검사·통합 테스트·시각 검수는 기존 필수 게이트로 계속 수행합니다. 스킬 폴더만으로 없어지는 제품 기능도 없습니다.

## 전역·플러그인 스킬은 별도 범위

현재 세션에는 이 저장소 밖에서 제공되는 스킬도 있습니다. 아래는 **이 저장소에서의 필요성**이며 사용자의 다른 프로젝트까지 고려한 전역 삭제 권고는 아닙니다.

| 그룹 | 이 저장소에서의 판단 |
| --- | --- |
| `openai-docs`, `git-commit-split` | Codex 설정 확인 또는 논리적 커밋 분할을 요청받았을 때 유용 |
| `skill-creator`, `skill-installer`, `plugin-creator`, `plugin-management` | 스킬·플러그인을 실제로 관리할 때만 필요 |
| `product-design:*`, `visualize:visualize`, `imagegen`, `creative-production:*` | UI 검수·시각 설계·이미지 제작을 요청받았을 때 조건부로 필요 |
| `data-analytics:*`, `sales:index`, `deep-research-work:deep-research` | 일반 플러그인 구현에는 관련성이 낮음. 분석·영업·심층 조사 작업에서만 선택 |
| `google-drive:*`, `documents:documents`, `pdf:pdf`, `presentations:Presentations`, `spreadsheets:Spreadsheets` | 일반 코드 작업에는 관련성이 낮음. 해당 외부 파일·문서를 다루는 작업에서만 선택 |

연결 도구 중 Angular CLI는 현재 Obsidian DOM/esbuild 구조와 직접 관련이 적습니다. GitHub와 CodeGraph는 각각 원격 저장소 작업과 코드 탐색에 유용할 수 있습니다. 스킬과 MCP는 다른 구성 요소이므로 스킬 폴더를 지워도 관련 도구 연결이 자동으로 제거되는 것은 아닙니다. 도구·플러그인 연결 역시 이번 작업에서 변경하지 않았습니다.
