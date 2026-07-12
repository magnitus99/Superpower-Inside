# AGENTS.md — Superpower-Inside

**Generated:** 2026-05-14
**Commit:** b02790e
**Branch:** feat/chat-research-copilot

> Obsidian 플러그인. LLM, RAG, MCP 도구 호출, 인터넷 검색 도구, 사이드바 채팅, 채팅 세션 저장, 출처/컨텍스트 첨부를 통합한다.
> TypeScript strict 모드, esbuild CJS 번들, Obsidian DOM API 기반 UI.
> JS/TS는 UI와 Obsidian host boundary를 담당하는 프론트엔드/wrapper다. 실질 기능의 결정적 로직은 Rust/WASM 코어가 담당한다.

## PRODUCT PHILOSOPHY

- 0번째 제품 철학은 "2000-2010년대 스티브잡스 시절 애플 감성, 사용자가 신경쓰지 않아도 정말 알아서 다 되는 편안함, 사용자가 신경 쓰지 않아도 괜찮은 롤스로이스 감성"이다.
- 모든 기능은 조용히 유능하고, 고급스럽고, 마찰이 적어야 한다. 내부 복잡도, fragile settings, maintenance state를 사용자가 계속 관리하게 만들지 않는다.
- RAG, GraphRAG, MCP, provider 설정 같은 고급 기능도 전문가용 계기판이 아니라 정제된 럭셔리 컨트롤 표면처럼 느껴져야 한다.
- 자동화는 기본적으로 믿을 수 있어야 하며, 사용자가 행동해야 할 때만 이유와 다음 행동을 명확하게 보여준다.
- 멀티 플랫폼/멀티 에이전트 개발에서도 이 철학을 우선 적용한다. 플랫폼 제약 때문에 완전히 자동화할 수 없을 때만 사용자가 눌러야 하는 단계와 남은 리스크를 짧고 구체적으로 남긴다.
- 작업자는 이 철학을 취향 문구가 아니라 설계 gate로 적용한다. 기능이 아래 기준을 통과하지 못하면 구현을 시작하지 말고 UX/범위/자동화 방식을 먼저 바꾼다.
- 설정을 추가하기 전에 자동 감지, 안전한 기본값, 기존 설정 재사용, 점진적 공개로 해결할 수 있는지 확인한다. 새 설정은 사용자가 의미 있는 선택을 해야 하고 기본값으로는 안전하게 작동해야 할 때만 추가한다.
- 상태 UI를 추가하기 전에 사용자가 해야 할 행동이 있는지 확인한다. 행동이 없으면 조용한 로그/진단으로 충분하다. 행동이 있으면 상태 설명은 한 문장, primary action은 하나, 보조 action은 필요한 경우에만 둔다.
- RAG/GraphRAG/index/cache/ontology/provider/MCP 같은 내부 용어는 사용자가 판단해야 할 때만 노출한다. 일반 흐름에서는 "준비 중", "출처 확인", "다시 시도", "연결 필요"처럼 작업 언어로 표현한다.
- 복구 기능은 숨기지 않되 일상 workflow의 중심으로 만들지 않는다. reindex, reset, migrate, rebuild, retry는 기본 사용법이 아니라 문제 해결과 진단의 마지막 수단이어야 한다.
- README와 개발 문서는 이 철학을 반복 설명하는 문서가 아니라, 각 작업자가 어떤 구현 결정을 해야 하는지 지시해야 한다. 표어만 있고 구체적인 판단 기준이 없으면 문서 품질 미달이다.

## TASK-CENTERED UI DESIGN CONTRACT

- RAG 설정 화면의 작업 중심 디자인을 향후 모든 사용자 화면의 기준으로 삼는다. 새 화면과 큰 UI 변경은 이 계약을 즉시 적용하고, 기존 Providers, Chat, MCP, Advanced 화면은 관련 작업이 생길 때 같은 계약으로 점진적으로 전환한다.
- 화면의 최상위 정보 순서는 `현재 상태 → 사용자가 해야 할 가장 작은 행동 → 핵심 설정 → 고급 진단과 복구`다. 사용자가 3초 안에 현재 할 일을 읽을 수 없으면 정보 구조를 다시 설계한다.
- 탭 배경 위에는 최상위 section만 카드 표면으로 표현한다. section 안의 설정, 상태, 작업은 평평한 row와 구분선을 사용하며 카드 속 카드, 배너 속 카드, 이유 없는 배경색 중첩을 만들지 않는다.
- section, row, notice, status, action, disclosure는 화면마다 새 스타일을 만들지 않고 공통 의미 토큰과 컴포넌트 계약을 재사용한다. 색상과 테마는 Obsidian theme variable에 매핑하고 raw color를 디자인 기준으로 만들지 않는다.
- 한 section에는 primary action을 최대 하나만 둔다. secondary action은 현재 상태를 이해하거나 되돌리는 데 필요할 때만 노출하고, recovery/destructive action은 마지막 disclosure와 확인 gate 안에 둔다.
- 상태는 `label + state + supporting detail`로 표현하고 색상만으로 의미를 전달하지 않는다. 같은 disabled reason을 여러 버튼 아래 반복하지 말고 영역 단위로 한 번 설명한다.
- disclosure는 button, `aria-expanded`, `aria-controls`, Obsidian icon을 사용한다. 텍스트 삼각형, 클릭 가능한 일반 div, 상태를 알 수 없는 접힘 UI를 만들지 않는다.
- 좁은 폭에서는 설명과 control을 수직으로 재배치하고 긴 경로, 모델명, 오류가 overflow 없이 줄바꿈되어야 한다. `focus-visible`, dark/light theme 대비, reduced-motion도 같은 디자인 계약에 포함한다.
- TS/JS는 DOM 구성, Obsidian host event, 기존 action callback 연결만 담당한다. 화면 재구성만으로 Rust/WASM 핵심 계산을 옮기거나 복제하지 않는다. 새 상태 판정·랭킹·선택 정책이 필요할 때만 Rust/WASM 경계를 별도로 설계한다.
- UI 변경 완료는 구조 테스트, i18n, community review gate와 실제 Obsidian 스크린샷을 모두 요구한다. 스크린샷에서는 상단 상태, 펼침/접힘, 빈 상태, 오류, disabled, 진행 중, 좁은 폭을 확인한다.

## NON-NEGOTIABLE QUALITY BAR

- 수익화 관련 기능은 보류한다. 플러그인은 완전 무료/오픈소스로 유지한다.
- 사용자는 모든 코드에 대해 매우 엄격한 검사를 요구한다. 작은 변경도 lint, typecheck, test, security, build, review gate 중 해당되는 검증을 피하지 않는다.
- 실패한 검사 결과를 우회하지 않으며, 동일한 실패를 다시 실행/재현하고 원인을 분석한 뒤 수정한다. 모든 게이트 통과가 작업 완료 조건이다.
- 실패하는 검증을 우회하지 않는다. `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, clippy allow, 무근거 fallback, generated 파일 수동 수정으로 통과시키지 않는다.
- 새 기능/버그 수정/리팩터링은 기본적으로 테스트를 먼저 추가하거나 기존 테스트 계약을 확장한다. 순수 함수로 분리 가능한 로직은 Vitest 또는 Rust unit test로 고정한다.
- 검증 결과를 말할 때는 실제 실행한 명령과 exit 0 근거가 있어야 한다. 추측으로 “될 것”이라고 말하지 않는다.
- 코드 변경 후 기본 순서는 `npm run security:full` → `npm run build` → `npm run review -- --tag <manifest-version> --built`다.  
  검증이 통과되지 않으면 다음 단계로 진행하지 않는다.
- Rust/WASM 변경은 반드시 `npm run security:full`를 통과해야 한다. 이 게이트는 `rustfmt`, `clippy -D warnings`, Rust tests, wasm target build, `cargo-deny`, `cargo-audit`, `cargo-vet`, `cargo-geiger`, npm audit, generated WASM 최신성 검사를 포함한다.
- UI/DOM/CSS 변경은 Obsidian community review 규칙까지 검증한다. 런타임 TS에서 inline style, `innerHTML`, heading direct create 같은 review error 패턴을 만들지 않는다.

## UI/UX VISUAL REVIEW BAR

- UI/UX 검수는 반드시 비주얼로 한다. 사람은 화면을 그림으로 이해하지, 절대로 문자 설명만으로 이해하지 않는다.
- UI/UX 검수는 반드시 비주얼로 한다. 코드 diff, DOM 구조, 테스트 이름, 텍스트 설명은 실제 화면을 대체하지 못한다.
- UI/UX 검수는 반드시 비주얼로 한다. 스크린샷 없이 “괜찮다”, “정돈됐다”, “브랜드 톤에 맞다”, “여백이 좋다”고 말하지 않는다.
- UI/DOM/CSS/레이아웃/카피 배치/상태 표시/모션/접근성 표시를 건드렸다면, 반드시 실제 실행 화면의 스크린샷을 직접 찍어서 본다. Obsidian 실행 화면이나 해당 UI를 재현하는 시뮬레이션/브라우저 화면을 열어 스크린샷으로 확인한다.
- UI/DOM/CSS/레이아웃/카피 배치/상태 표시/모션/접근성 표시를 건드린 작업은 가능한 한 커밋 전에 화면 검수를 끝낸다. 릴리즈 절차 자체는 스크린샷 검수를 필수 게이트로 두지 않는다.
- 작업자는 스크린샷을 보고 판단해야 한다. 사람은 UI를 문자로 이해하지 않는다. 버튼, 카드, 간격, 컬러, 폰트 크기, 상태 배지, 빈 상태, 오류 상태, focus ring, hover/active 상태는 실제 픽셀로 봐야 한다.
- UI/UX에도 기준이 있다. 검수 시 최소한 브랜드 톤, 정보 위계, 정보의 여백, 밀도, 정렬, 대비, 가독성, 좁은 sidebar에서의 줄바꿈, 긴 텍스트 overflow, 아이콘/버튼 의미, 상태 변화의 명확성, 모션과 reduced-motion 처리를 스크린샷 기준으로 확인한다.
- 스크린샷 없는 UI/UX 완료 보고는 금지한다. 자동 테스트와 review gate가 통과해도, 실제 화면을 보지 않았다면 UI/UX 검수는 끝난 것이 아니다.
- 스크린샷 없는 UI/UX 완료 보고는 금지한다. “테스트 통과”는 동작 검증이고, “화면을 봤다”는 경험 검증이다. 둘은 서로 대체되지 않는다.
- 스크린샷을 찍을 수 없는 환경이면 그 사실을 명시하고, UI/UX 작업을 완료로 주장하지 않는다. 이 경우 남은 검수 항목과 필요한 실행 화면을 구체적으로 남긴다.
- Obsidian 네이티브 앱에서는 `computer-use`로 마우스 클릭이나 타이핑을 시도하지 않는다. 이 환경의 Obsidian 앱 마우스 조작은 신뢰할 수 없으므로, 앱 조작 대신 코드/파일/빌드/로그 상태를 확인하고 사용자가 직접 눌러야 하는 단계는 명시한다.

## README AND GITHUB RELEASE POLICY

- 커밋 로그 기반 릴리즈 노트, 업데이트 로그, changelog, `release-notes-<버전>.md` 파일을 작성하지 않는다. 릴리즈마다 항목별 변경 내역을 따로 나열하는 문서는 금지한다.
- 릴리즈마다 `README.md`를 먼저 검토하고, 사용자에게 의미 있는 새 기능이나 제품 가치가 있으면 README의 기존 기능 설명, 사용 흐름, 설정 안내에 자연스럽게 통합해 업데이트한다.
- README는 업데이트 로그처럼 쓰지 않는다. “이번 버전에서 무엇이 바뀌었다”가 아니라 “현재 플러그인이 무엇을 할 수 있고 어떻게 쓰는지”가 한 번에 읽히도록 어울려서 적는다.
- 단순 버그 수정, 내부 알고리즘 조정, 리팩터링, 성능 미세 조정처럼 README 전체 설명에 녹일 만한 사용자 가치가 없으면 README에 적지 않는다.
- GitHub Release 본문에는 그 릴리즈에서 사용자에게 의미 있는 업데이트 내역을 직접 붙여 넣는다. 단, 이 내용은 repo 문서로 커밋하지 말고 작업자가 임시로 기억하거나 채팅에 작성한 뒤 GitHub Release 본문에 복붙한다.
- GitHub Release 본문도 커밋 로그 나열이 아니라 사용자 관점의 요약으로 쓴다. README에 적을 가치가 없는 단순 버그 수정, 내부 알고리즘 조정, 리팩터링은 GitHub Release 본문에도 적지 않는다.

## JS/TS ROLE BOUNDARY

- JS/TS는 프론트엔드와 host integration wrapper다. 허용 범위는 Obsidian API, DOM 렌더링, plugin lifecycle, settings UI, vault adapter I/O, provider fetch/stream transport, MCP stdio transport, IndexedDB/Dexie adapter, WASM bridge 입출력 매핑이다.
- 모든 실질 기능의 결정적 로직은 Rust/WASM을 기본 구현 위치로 삼는다. 예: 파싱, 정규화, 검증, 랭킹, scoring, 선택, diff/plan 계산, schema/domain 판정, 검색/그래프 계산.
- RAG 해시/토큰화/청킹/BM25, vector score/top-k, GraphRAG ranking/community/entity scoring, 대용량 metadata diff/validation 같은 순수 계산은 Rust/WASM에만 둔다.
- 새 기능을 TS에 추가해야 한다면 TS는 UI/host I/O/wrapper만 맡기고, 기능 정책과 계산은 먼저 Rust/WASM API로 설계한다.
- 새 순수 계산 로직을 TS에 추가하지 않는다. TS에 남길 수 있는 이유는 host API, DOM, 네트워크 transport, 저장소 I/O, Rust bridge 입출력 매핑처럼 명확해야 한다.
- Rust 코어는 deterministic input/output만 다룬다. Obsidian API, DOM, API key, process, 파일 I/O를 직접 소유하지 않는다.
- TS는 WASM 초기화 실패나 wire-format 검증 실패를 순수 계산으로 복구하지 않는다. wrapper는 빈 결과, 0점, 비활성 상태, 오류 전파 중 기존 호출 계약에 맞는 형태만 반환한다.
- JS는 UI/호스트 경계만 담당하고, 상태 계산/벡터 계산/그룹 분석/스코어링 같은 성능 경로는 Rust/WASM으로 처리한다.

## STRUCTURE

```
.
├── main.ts                       # Plugin 진입점(onload/onunload), provider/RAG/MCP 조립 — 533줄
├── manifest.json                 # Obsidian plugin metadata (id: superpower-inside)
├── styles.css                    # 플러그인 전용 CSS, superpower-inside- 프리픽스 — 2533줄
├── src/
│   ├── settings.ts               # 설정 타입 + PluginSettingTab UI — 1590줄
│   ├── i18n.ts                   # 한국어/영어 다국어 문자열 — 790줄
│   ├── llm/                      # Provider, 스트리밍, 도구 호출 delta, 임베딩
│   ├── rag/                      # 청킹, 벡터 저장소, RAG 쿼리
│   ├── chat/                     # ItemView 채팅 UI, 저장, 멘션/컨텍스트, 세션 모달
│   ├── mcp/                      # MCP stdio client/registry
│   └── utils/                    # vault adapter JSON IO, 플러그인 탐지, MCP JSON 검증
├── scripts/                      # Windows PowerShell, macOS fish 개발 진입점 + Rust/WASM helper
├── docs/                         # 개발/제출 문서
├── crates/rag-wasm/              # Rust/WASM RAG 계산 코어
├── Cargo.toml                    # Rust workspace, strict lint 기준
├── deny.toml                     # cargo-deny 보안/라이선스/소스 정책
├── rust-toolchain.toml           # Rust 1.96.0 + wasm32-unknown-unknown 고정
├── simulations/                  # chat-sim.html UI 시뮬레이션(미추적/배포 제외 성격)
├── esbuild.config.mjs            # main.ts → main.js 번들, format:cjs, target:es2022
├── eslint.config.mjs             # flat config + typescript-eslint/recommended-type-checked
├── tsconfig.json                 # strict, noUnused*, noImplicit*, isolatedModules
└── .github/workflows/release.yml # GitHub Release workflow
```

## WHERE TO LOOK

| Task                     | Location                                             | Notes                                                                     |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 플러그인 생명주기/명령어 | `main.ts`                                            | `open-ai-chat`, `reindex-vault`, `execute-ai-directive`, RAG 이벤트 훅    |
| 설정 타입/설정 UI        | `src/settings.ts`                                    | Provider/RAG/MCP/Chat 설정 탭. 저장 시 provider/RAG/MCP 재초기화          |
| LLM Provider 변경        | `src/llm/providers.ts` + `src/settings.ts`           | `createProvider`, `PROVIDER_KEYS`, `PROVIDER_LABELS`, 기본 설정 동시 확인 |
| 임베딩 변경              | `src/llm/embedding.ts`                               | OpenAI-compatible/Ollama 임베딩 + Dexie 캐시 래퍼                         |
| LLM/임베딩 연결 테스트   | `src/llm/validation.ts`                              | 설정 UI의 연결 검증과 연결됨                                              |
| RAG 청킹/인덱싱          | `src/rag/indexer.ts`                                 | `chunkMarkdown`, `VaultIndexer`, 파일 modify/delete/rename 이벤트         |
| RAG 저장소/파일 필터     | `src/rag/store.ts` + `src/utils/vault.ts`            | vector JSON 저장소, Rust/WASM exclude path matching, vault file filtering |
| RAG retrieval pipeline   | `src/rag/retrieval-pipeline.ts`                      | exact/ANN/BM25/structural 후보 wrapper, Rust/WASM 후보 계산/병합          |
| RAG 질의/컨텍스트        | `src/rag/query.ts` + `src/chat/context.ts`           | 유사도 검색 결과가 채팅 system prompt와 출처 카드로 들어감                |
| 채팅 UI                  | `src/chat/view.ts`                                   | 3141줄. DOM, 스트리밍, 도구 호출, 출처, 세션 상태가 집중됨                |
| 채팅 저장/로드           | `src/chat/persistence.ts`                            | 프론트매터 + HTML 주석 기반 Markdown 직렬화, 레거시 로드 지원             |
| 채팅 참조 확장           | `src/chat/context-expansion.ts`                      | Rust/WASM link extraction, Obsidian metadata/vault resolve                |
| 멘션 처리                | `src/chat/mention-parser.ts` + `src/chat/context.ts` | Rust/WASM mention candidate extraction, TS resolver classification        |
| 멘션 테스트              | `src/chat/mention-parser.test.ts`                    | 현재 유일한 Vitest 테스트                                                 |
| 세션 히스토리 모달       | `src/chat/session-modal.ts`                          | `FuzzySuggestModal`, 채팅 메타 로드                                       |
| MCP 연결/도구 호출       | `src/mcp/client.ts` + `src/mcp/registry.ts`          | stdio 전용. `mcpPath`/env PATH 처리                                       |
| MCP JSON 편집            | `src/utils/mcp-json.ts`                              | 표준 `mcpServers` JSON 검증/포맷                                          |
| 활성 플러그인 탐지       | `src/utils/obsidian-compat.ts`                       | 비공식 Obsidian API 접근이므로 try/catch 유지                             |
| GraphRAG 저장소          | `src/graph/store.ts`                                 | Dexie/Memory mutation, Rust/WASM pruning index plan                       |
| GraphRAG community 감지  | `src/graph/community-detector.ts`                    | Rust/WASM edge aggregation과 community detection, TS record mapping       |
| GraphRAG entity resolve  | `src/graph/entity-resolver.ts`                       | Rust/WASM entity name normalization과 merge score, TS store orchestration |
| Rust/WASM RAG 코어       | `crates/rag-wasm/`                                   | 성능 민감 순수 계산. JS는 UI/host I/O, Rust는 결정적 계산 담당            |
| Rust/WASM JS bridge      | `src/rag/rust-core.ts` + `generated/rag-wasm/`       | embedded WASM init, hash/tokenize/vector/query scoring bridge             |
| Rust 보안 게이트         | `scripts/check-rust-security.fish` + `deny.toml`     | fmt, clippy, test, wasm build, deny, audit, vet, geiger                   |

## CODE MAP

| Symbol                                                                          | Type      | Location                          | Role                                                                |
| ------------------------------------------------------------------------------- | --------- | --------------------------------- | ------------------------------------------------------------------- |
| `SuperpowerInsidePlugin`                                                        | class     | `main.ts`                         | Plugin 진입점, 설정 migration, provider/RAG/MCP 초기화              |
| `SuperpowerInsideSettings`                                                      | interface | `src/settings.ts`                 | 전체 설정 스키마                                                    |
| `DEFAULT_SETTINGS`                                                              | const     | `src/settings.ts`                 | Provider/RAG/MCP/Chat 기본값                                        |
| `SuperpowerInsideSettingTab`                                                    | class     | `src/settings.ts`                 | 설정 UI와 debounced save                                            |
| `createProvider`                                                                | function  | `src/llm/providers.ts`            | ProviderKey → LLMProvider 팩토리                                    |
| `OpenAICompatibleProvider`                                                      | class     | `src/llm/providers.ts`            | OpenAI/OpenRouter 공통 스트리밍/도구 호출 처리                      |
| `ClaudeProvider`                                                                | class     | `src/llm/providers.ts`            | Anthropic Claude Provider                                           |
| `OllamaProvider`                                                                | class     | `src/llm/providers.ts`            | Ollama Local/Cloud Provider                                         |
| `CachedEmbeddingProvider`                                                       | class     | `src/llm/embedding.ts`            | 메모리 + IndexedDB(Dexie) 임베딩 캐시                               |
| `chunkMarkdown`                                                                 | function  | `src/rag/indexer.ts`              | 헤딩/코드블록 경계 존중 Markdown 청킹                               |
| `VaultIndexer`                                                                  | class     | `src/rag/indexer.ts`              | 전체/증분/파일별 인덱싱                                             |
| `JsonFileVectorStore`                                                           | class     | `src/rag/store.ts`                | vault.adapter 기반 JSON 벡터 저장소                                 |
| `RAGQueryEngine`                                                                | class     | `src/rag/query.ts`                | 임베딩 → 코사인 유사도 → 컨텍스트                                   |
| `ChatView`                                                                      | class     | `src/chat/view.ts`                | 사이드바 채팅 ItemView, 스트리밍, MCP 도구, 출처 UI                 |
| `buildChatContext`                                                              | function  | `src/chat/context.ts`             | 자동 RAG + 파일/폴더/MCP 멘션 컨텍스트 생성                         |
| `parseMentionCandidatesRust`                                                    | function  | `src/rag/rust-core.ts`            | 채팅 raw mention 후보 추출 Rust bridge                              |
| `parseMentions`                                                                 | function  | `src/chat/mention-parser.ts`      | Rust 우선 mention 후보 추출과 TS resolver 분류                      |
| `plan_chat_context_mentions_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 context mention type index와 auto-RAG policy plan 계산         |
| `planChatContextMentionsRust`                                                   | function  | `src/rag/rust-core.ts`            | TS parsed mention type snapshot과 Rust context mention plan bridge  |
| `saveChat` / `loadChat` / `listChats`                                           | function  | `src/chat/persistence.ts`         | 채팅 세션 Markdown 저장/복원과 Rust folder plan 기반 목록 조회      |
| `MCPClientManager`                                                              | class     | `src/mcp/client.ts`               | MCP SDK Client + stdio transport                                    |
| `MCPRegistry`                                                                   | class     | `src/mcp/registry.ts`             | MCP 서버 설정/클라이언트/연결 상태 관리                             |
| `plan_mcp_server_candidates_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | MCP connected preferred/remaining server candidate plan 계산        |
| `planMcpServerCandidatesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS MCP registry snapshot과 Rust server candidate bridge             |
| `is_mcp_tool_name_available`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | MCP tool name 목록의 exact match 판정                               |
| `isMcpToolAvailableRust`                                                        | function  | `src/rag/rust-core.ts`            | TS tool list snapshot과 Rust tool name matching bridge              |
| `plan_rag_file_content_probe_indices_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 file content probe 필요 index plan 계산                    |
| `planRagFileContentProbeIndicesRust`                                            | function  | `src/rag/rust-core.ts`            | TS vault file metadata snapshot과 Rust probe index bridge           |
| `plan_rag_file_indexability_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 file indexability와 file type summary input plan 계산      |
| `planRagFileIndexabilityRust`                                                   | function  | `src/rag/rust-core.ts`            | TS text probe snapshot과 Rust RAG file eligibility bridge           |
| `plan_graph_rag_run_file_selection_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG indexing run candidate/selected file path plan 계산        |
| `planGraphRagRunFileSelectionRust`                                              | function  | `src/rag/rust-core.ts`            | TS vector store path snapshot과 Rust GraphRAG run selection bridge  |
| `plan_graph_rag_unsupported_prune_paths_json`                                   | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG unsupported evidence/rejected fact prune path plan 계산    |
| `planGraphRagUnsupportedPrunePathsRust`                                         | function  | `src/rag/rust-core.ts`            | TS Graph store processable snapshot과 Rust unsupported prune bridge |
| `plan_graph_rag_status_file_snapshot_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status candidate file record/indexed path count plan 계산  |
| `planGraphRagStatusFileSnapshotRust`                                            | function  | `src/rag/rust-core.ts`            | TS vector store path snapshot과 Rust GraphRAG status file bridge    |
| `plan_graph_rag_status_entry_snapshot_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status vector entry snapshot index plan 계산               |
| `planGraphRagStatusEntrySnapshotRust`                                           | function  | `src/rag/rust-core.ts`            | TS vector entry path snapshot과 Rust GraphRAG status entry bridge   |
| `create_content_hash`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | TypeScript `createContentHash()`와 같은 UTF-16 FNV-1a               |
| `tokenize`                                                                      | function  | `crates/rag-wasm/src/lib.rs`      | TypeScript BM25 토크나이저와 같은 검색 토큰 생성                    |
| `token_frequencies_json`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | BM25 문서 term frequency JSON 생성                                  |
| `bm25TermFrequenciesRust`                                                       | function  | `src/rag/rust-core.ts`            | BM25 문서 frequency bridge                                          |
| `plan_bm25_index_add_document_json`                                             | function  | `crates/rag-wasm/src/lib.rs`      | BM25 inverted index 문서 추가/교체 plan 계산                        |
| `planBm25IndexAddDocumentRust`                                                  | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust add/replace plan bridge               |
| `plan_bm25_index_remove_document_json` / `plan_bm25_index_remove_source_json`   | function  | `crates/rag-wasm/src/lib.rs`      | BM25 document/source 제거와 통계 재계산                             |
| `planBm25IndexRemoveDocumentRust` / `planBm25IndexRemoveSourceRust`             | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust removal plan bridge                   |
| `plan_bm25_search_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | BM25 raw query token dedupe, posting scan, doc score 계산           |
| `planBm25SearchRust`                                                            | function  | `src/rag/rust-core.ts`            | TS BM25 index snapshot과 Rust search score bridge                   |
| `count_keyword_matches`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | query 토큰과 텍스트 간 substring 매칭 수를 Rust에서 계산            |
| `countKeywordMatchesRust`                                                       | function  | `src/rag/rust-core.ts`            | RAG 조회에서 keyword-matching score를 WASM으로 산출                 |
| `bm25_score_pairs`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | BM25 posting list의 doc index/score 계산                            |
| `scoreBm25Rust`                                                                 | function  | `src/rag/rust-core.ts`            | TS BM25 posting 배열과 Rust score pair bridge                       |
| `rank_top_k_pairs`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | flattened vector matrix의 top-k index/score 계산                    |
| `rankTopKPairsRust`                                                             | function  | `src/rag/rust-core.ts`            | TS entry 배열과 Rust row index/score bridge                         |
| `assign_vector_clusters`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | ANN vector row를 nearest centroid index로 배정                      |
| `assignVectorClustersRust`                                                      | function  | `src/rag/rust-core.ts`            | IVF index build의 cluster assignment Rust bridge                    |
| `recompute_centroids`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | ANN cluster assignment 기반 centroid matrix 재계산                  |
| `recomputeCentroidsRust`                                                        | function  | `src/rag/rust-core.ts`            | IVF index build의 centroid recompute Rust bridge                    |
| `build_initial_centroids`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | ANN cluster 수 결정과 초기 centroid matrix 선택                     |
| `buildInitialCentroidsRust`                                                     | function  | `src/rag/rust-core.ts`            | TS vector matrix와 Rust 초기 centroid build bridge                  |
| `recall_at_k`                                                                   | function  | `crates/rag-wasm/src/lib.rs`      | ANN recall@k metric 계산                                            |
| `calculateRecallAtKRust`                                                        | function  | `src/rag/rust-core.ts`            | TS id 목록과 Rust recall@k bridge                                   |
| `IvfVectorCandidateProvider`                                                    | class     | `src/rag/retrieval-pipeline.ts`   | ANN 후보 조회, Rust 우선 centroid probe/build 계산                  |
| `rankGlobalCommunitiesWithRust`                                                 | function  | `src/graph/query-engine.ts`       | GraphRAG community summary vector top-k Rust bridge 사용            |
| `rrf_score_or_nan`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG retrieval source rank fusion score 계산                         |
| `calculateRrfScoreRust`                                                         | function  | `src/rag/rust-core.ts`            | TS source rank map과 Rust RRF bridge                                |
| `hybrid_score_or_nan`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | RAG hybrid result score 계산                                        |
| `calculateHybridScoreRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query score input과 Rust hybrid score bridge                     |
| `analyze_retrieval_sources`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG retrieval source prior/evidence/rank/flag 계산                  |
| `analyzeRetrievalSourcesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS source score/rank map과 Rust source analysis bridge              |
| `plan_query_result_score_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | RAG query result score row JSON plan 계산                           |
| `planQueryResultScoreRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query candidate snapshot과 Rust score row bridge                 |
| `is_relevant_result`                                                            | function  | `crates/rag-wasm/src/lib.rs`      | RAG 최종 context 후보 relevance 판단                                |
| `isRelevantResultRust`                                                          | function  | `src/rag/rust-core.ts`            | TS query result와 Rust relevance gate bridge                        |
| `select_relevant_result_indices`                                                | function  | `crates/rag-wasm/src/lib.rs`      | RAG 후보 정렬/relative threshold/source-aware relevance window 계산 |
| `selectRelevantResultIndicesRust`                                               | function  | `src/rag/rust-core.ts`            | TS query 후보 배열과 Rust relevance window selection bridge         |
| `plan_graph_query_response_json`                                                | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM planner raw 응답을 query plan으로 정규화               |
| `planGraphQueryResponseRust`                                                    | function  | `src/rag/rust-core.ts`            | TS provider 응답과 Rust GraphRAG planner response bridge            |
| `plan_graph_query_execution_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG query mode/evidence-first 실행 action plan 계산            |
| `planGraphQueryExecutionRust`                                                   | function  | `src/rag/rust-core.ts`            | TS query engine mode와 Rust execution action bridge                 |
| `plan_graph_schema_relation_indices_json`                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG relation schema id matching index plan 계산                |
| `planGraphSchemaRelationIndicesRust`                                            | function  | `src/rag/rust-core.ts`            | TS relation snapshot과 Rust schema relation index bridge            |
| `plan_graph_schema_community_indices_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community schema id matching index plan 계산               |
| `planGraphSchemaCommunityIndicesRust`                                           | function  | `src/rag/rust-core.ts`            | TS community snapshot과 Rust schema community index bridge          |
| `plan_graph_community_replacement_delete_ids_json`                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community replacement 삭제 id plan 계산                    |
| `planGraphCommunityReplacementDeleteIdsRust`                                    | function  | `src/rag/rust-core.ts`            | TS community replacement snapshot과 Rust 삭제 id bridge             |
| `plan_claim_evidence_scores_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG claim confidence를 evidence score plan으로 변환            |
| `planClaimEvidenceScoresRust`                                                   | function  | `src/rag/rust-core.ts`            | TS claim snapshot과 Rust claim evidence score bridge                |
| `plan_evidence_candidate_order_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence score 중복 병합과 candidate order 계산            |
| `planEvidenceCandidateOrderRust`                                                | function  | `src/rag/rust-core.ts`            | TS evidence score 목록과 Rust candidate order plan bridge           |
| `plan_file_index_records_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | vector metadata의 file index record grouping/complete 판정 계산     |
| `planFileIndexRecordsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS vector metadata snapshot과 Rust file index record plan bridge    |
| `plan_vector_store_add_json`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore add overwrite/append source index plan 계산             |
| `planVectorStoreAddRust`                                                        | function  | `src/rag/rust-core.ts`            | TS VectorEntry id snapshot과 Rust add mutation plan bridge          |
| `plan_vector_store_replace_file_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file replacement source index/removed count 계산        |
| `planVectorStoreReplaceFileRust`                                                | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust replacement mutation plan bridge       |
| `plan_vector_store_remove_file_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file removal source index/removed count 계산            |
| `planVectorStoreRemoveFileRust`                                                 | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust removal mutation plan bridge           |
| `plan_vector_store_stats_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore stats와 indexed file path 정렬 계산                     |
| `planVectorStoreStatsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS VectorEntry file path snapshot과 Rust stats plan bridge          |
| `plan_vector_store_lookup_by_file_paths_json` / `plan_vector_store_lookup_by_ids_json` | function  | `crates/rag-wasm/src/lib.rs`      | VectorStore file path/id lookup index plan 계산                     |
| `planVectorStoreLookupByFilePathsRust` / `planVectorStoreLookupByIdsRust`       | function  | `src/rag/rust-core.ts`            | TS VectorEntry snapshot과 Rust lookup index plan bridge             |
| `plan_merged_retrieval_candidates` / `plan_merged_retrieval_candidates_by_entry_id` | function  | `crates/rag-wasm/src/lib.rs`      | RAG/GraphRAG 후보 entry/source score/rank 병합 plan 계산            |
| `planMergedRetrievalCandidatesRust` / `planMergedRetrievalCandidatesByEntryIdRust` | function  | `src/rag/rust-core.ts`            | TS 후보 배열과 Rust merge plan bridge                               |
| `plan_bm25_hit_lookup_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | BM25 hit score 정렬/lookup 제한 plan 계산                           |
| `planBm25HitLookupRust`                                                         | function  | `src/rag/rust-core.ts`            | TS BM25 score map과 Rust hit lookup plan bridge                     |
| `plan_bm25_source_lookups_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | BM25 stale doc id source path lookup plan 계산                      |
| `planBm25SourceLookupsRust`                                                     | function  | `src/rag/rust-core.ts`            | TS found entry id 목록과 Rust source lookup plan bridge             |
| `plan_bm25_candidate_resolution_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | BM25 id/path 조회 entry를 최종 candidate index로 해석                |
| `planBm25CandidateResolutionRust`                                               | function  | `src/rag/rust-core.ts`            | TS VectorStore lookup 결과와 Rust BM25 candidate plan bridge        |
| `plan_structural_linked_paths_json`                                             | function  | `crates/rag-wasm/src/lib.rs`      | Structural retrieval link/backlink target path plan 계산            |
| `planStructuralLinkedPathsRust`                                                 | function  | `src/rag/rust-core.ts`            | TS metadata edge 목록과 Rust structural path plan bridge            |
| `plan_structural_heading_neighbors_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | Structural retrieval heading range neighbor entry index 계산        |
| `planStructuralHeadingNeighborsRust`                                            | function  | `src/rag/rust-core.ts`            | TS heading/cache snapshot과 Rust structural neighbor plan bridge    |
| `plan_rerank_messages_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG LLM reranker message content와 truncated candidate JSON plan 계산 |
| `planRerankMessagesRust`                                                        | function  | `src/rag/rust-core.ts`            | TS reranker candidate snapshot과 Rust message plan bridge           |
| `plan_rerank_response_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG LLM reranker raw 응답 JSON 추출과 ranked id 필터링              |
| `planRerankResponseRust`                                                        | function  | `src/rag/rust-core.ts`            | TS provider 응답과 Rust rerank response plan bridge                 |
| `plan_rerank_result_order_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | RAG reranker ranked id를 최종 result index 순서로 변환              |
| `planRerankResultOrderRust`                                                     | function  | `src/rag/rust-core.ts`            | TS result id 목록과 Rust rerank order plan bridge                   |
| `select_diverse_indices`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | RAG MMR diversity selection index 계산                              |
| `selectDiverseIndicesRust`                                                      | function  | `src/rag/rust-core.ts`            | TS query 후보와 Rust MMR selection bridge                           |
| `plan_diverse_result_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG result source/heading string key와 MMR index plan 계산          |
| `planDiverseResultIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS QueryResult snapshot과 Rust diversity index plan bridge          |
| `aggregate_graph_edges_flat`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG relation edge confidence를 무방향 endpoint pair별로 집계   |
| `aggregateGraphEdgesRust`                                                       | function  | `src/rag/rust-core.ts`            | TS entity id index 배열과 Rust edge aggregation bridge              |
| `plan_graph_edge_records_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity/relation snapshot을 edge record plan으로 변환       |
| `planGraphEdgeRecordsRust`                                                      | function  | `src/rag/rust-core.ts`            | TS graph record snapshot과 Rust edge record planner bridge          |
| `buildEdges`                                                                    | function  | `src/graph/community-detector.ts` | GraphRAG record snapshot을 Rust edge record plan으로 연결           |
| `prune_graph_indexes_json`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG store pruning 삭제/업데이트/유지 참조 위치 plan 계산       |
| `planGraphPruneRust`                                                            | function  | `src/rag/rust-core.ts`            | TS graph snapshot과 Rust pruning/reference plan bridge              |
| `IndexedDbKnowledgeGraphStore`                                                  | class     | `src/graph/store.ts`              | Dexie graph persistence, Rust plan 적용 후 bulk mutation            |
| `InMemoryKnowledgeGraphStore`                                                   | class     | `src/graph/store.ts`              | 테스트/런타임 memory graph store, Rust plan 적용 후 Map mutation    |
| `extract_vault_links_json`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | Obsidian wikilink/Markdown link target 추출 JSON 생성               |
| `extractVaultLinksRust`                                                         | function  | `src/rag/rust-core.ts`            | 채팅 참조 확장의 Rust link extraction bridge                        |
| `plan_vault_link_candidates_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | vault link resolve 후보 path와 basename 대체키 계산                 |
| `planVaultLinkCandidatesRust`                                                   | function  | `src/rag/rust-core.ts`            | TS source/raw target과 Rust vault link candidate plan bridge        |
| `plan_vault_link_fallback_index_json`                                           | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 참조 확장 basename 대체 index plan                             |
| `planVaultLinkFallbackIndexRust`                                                | function  | `src/rag/rust-core.ts`            | TS markdown basename snapshot과 Rust vault link basename 대체 bridge |
| `plan_folder_mention_file_indices_json`                                         | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 folder mention file index와 partial plan                       |
| `planFolderMentionFilesRust`                                                    | function  | `src/rag/rust-core.ts`            | TS markdown file path snapshot과 Rust folder mention bridge         |
| `plan_rag_file_type_summary_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | RAG 파일 타입 요약 count/order/추천 제외 plan 계산                  |
| `planRagFileTypeSummaryRust`                                                    | function  | `src/rag/rust-core.ts`            | TS vault file snapshot과 Rust file type summary plan bridge         |
| `plan_rag_status_json`                                                          | function  | `crates/rag-wasm/src/lib.rs`      | RAG index status 분류/count/update row 정렬 plan 계산               |
| `planRagStatusRust`                                                             | function  | `src/rag/rust-core.ts`            | TS file/index record snapshot과 Rust status summary bridge          |
| `plan_index_pending_files_json`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | RAG pending indexing file index/skip count plan 계산                |
| `planIndexPendingFilesRust`                                                     | function  | `src/rag/rust-core.ts`            | TS file/update path snapshot과 Rust pending selection bridge        |
| `plan_graph_rag_status_file_snapshot_json` / `plan_graph_rag_status_entry_snapshot_json` / `plan_graph_rag_status_entry_lookups_json` / `plan_graph_rag_status_json` | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG status file/entry snapshot, lookup, stale/partial/ready plan 계산 |
| `planGraphRagStatusFileSnapshotRust` / `planGraphRagStatusEntrySnapshotRust` / `planGraphRagStatusEntryLookupsRust` / `planGraphRagStatusRust` | function  | `src/rag/rust-core.ts`            | TS graph/vector store snapshot과 Rust GraphRAG status bridge        |
| `plan_graph_entity_merge_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity upsert merge field plan 계산                        |
| `planGraphEntityMergeRust`                                                      | function  | `src/rag/rust-core.ts`            | TS GraphEntityRecord field snapshot과 Rust merge plan bridge        |
| `is_graph_extraction_cache_hit_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction cache key hit 판정                              |
| `isGraphExtractionCacheHitRust`                                                 | function  | `src/rag/rust-core.ts`            | TS cache key snapshot과 Rust cache hit bridge                       |
| `plan_graph_deletion_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | Graph store record key deletion index plan 계산                     |
| `planGraphDeletionIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS store record key snapshot과 Rust deletion index bridge           |
| `plan_graph_evidence_candidate_lookup_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence score/evidence/file-path lookup plan 계산         |
| `planGraphEvidenceCandidateLookupRust`                                          | function  | `src/rag/rust-core.ts`            | TS evidence score/record snapshot과 Rust candidate lookup bridge    |
| `plan_graph_evidence_entry_candidates_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG evidence entry compatibility/dedupe/limit plan 계산        |
| `planGraphEvidenceEntryCandidatesRust`                                          | function  | `src/rag/rust-core.ts`            | TS candidate entry snapshot과 Rust entry candidate bridge           |
| `plan_graph_mention_context_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity mention context index와 표시 line plan 계산         |
| `planGraphMentionContextRust`                                                   | function  | `src/rag/rust-core.ts`            | TS entity/relation snapshot과 Rust context line selection bridge    |
| `plan_graph_claim_entity_ids_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction claim entity name/id lookup plan 계산           |
| `planGraphClaimEntityIdsRust`                                                   | function  | `src/rag/rust-core.ts`            | TS extracted claim entity names와 Rust entity id lookup bridge      |
| `plan_graph_relation_endpoint_indices_json`                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction relation source/target endpoint index plan 계산 |
| `planGraphRelationEndpointIndicesRust`                                          | function  | `src/rag/rust-core.ts`            | TS extracted relation source/target snapshot과 Rust endpoint bridge |
| `plan_graph_extraction_type_validation_json`                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction entity/claim type membership plan 계산          |
| `planGraphExtractionTypeValidationRust`                                         | function  | `src/rag/rust-core.ts`            | TS extracted type id와 Rust schema membership validation bridge     |
| `plan_graph_community_summary_groups_json`                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community summarizer entity/relation/claim grouping 계산   |
| `planGraphCommunitySummaryGroupsRust`                                           | function  | `src/rag/rust-core.ts`            | TS community assignment snapshot과 Rust summary grouping bridge     |
| `plan_graph_rag_markdown_file_paths_json`                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG markdown file path filtering plan 계산                     |
| `planGraphRagMarkdownFilePathsRust`                                             | function  | `src/rag/rust-core.ts`            | TS file path snapshot과 Rust GraphRAG markdown filtering bridge     |
| `plan_reference_file_indices_json`                                              | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 참조 확장 대상 self-skip/dedupe index plan 계산                |
| `planReferenceFileIndicesRust`                                                  | function  | `src/rag/rust-core.ts`            | TS resolved reference path snapshot과 Rust reference selection bridge |
| `plan_source_references_json`                                                   | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 답변 출처 참조와 vault path alias plan 계산                    |
| `planSourceReferencesRust`                                                      | function  | `src/rag/rust-core.ts`            | TS 답변 문자열과 Rust source reference plan bridge                  |
| `plan_source_validation_inputs_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | 출처 검증 verified citation과 alias probe 입력 plan 계산            |
| `planSourceValidationInputsRust`                                                | function  | `src/rag/rust-core.ts`            | TS citation snapshot과 Rust source validation input bridge          |
| `plan_source_validation_warnings_json`                                          | function  | `crates/rag-wasm/src/lib.rs`      | 출처 참조/검증 citation/존재 alias를 warning key plan으로 계산      |
| `planSourceValidationWarningsRust`                                              | function  | `src/rag/rust-core.ts`            | TS reference/citation snapshot과 Rust source warning plan bridge    |
| `plan_assistant_response_classification_json`                                   | function  | `crates/rag-wasm/src/lib.rs`      | assistant 답변/질문 분류와 선택지/질문 leak plan 계산               |
| `planAssistantResponseClassificationRust`                                       | function  | `src/rag/rust-core.ts`            | TS assistant response snapshot과 Rust classification bridge         |
| `plan_chat_messages_json`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | 저장된 chat message block meta/content/reasoning parse plan 계산    |
| `planChatMessagesRust`                                                          | function  | `src/rag/rust-core.ts`            | TS markdown body와 Rust chat message parse plan bridge              |
| `plan_chat_meta_json`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | 저장된 chat list metadata title/date/count/preview plan 계산        |
| `planChatMetaRust`                                                              | function  | `src/rag/rust-core.ts`            | TS markdown content와 Rust chat metadata plan bridge                |
| `plan_chat_save_metadata_json`                                                  | function  | `crates/rag-wasm/src/lib.rs`      | 저장할 chat title/created/source/provider/summary plan 계산         |
| `planChatSaveMetadataRust`                                                      | function  | `src/rag/rust-core.ts`            | TS message snapshot과 Rust chat save metadata bridge                |
| `plan_context_sources_json`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | RAG context citation/block/source id/rejected count plan 계산       |
| `planContextSourcesRust`                                                        | function  | `src/rag/rust-core.ts`            | TS query result/verification snapshot과 Rust context source bridge  |
| `plan_context_budget_append_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | 채팅 context budget append와 Unicode-safe truncation plan 계산      |
| `planContextBudgetAppendRust`                                                   | function  | `src/rag/rust-core.ts`            | TS context block text와 Rust budget append plan bridge              |
| `plan_context_graph_verification_json`                                          | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG virtual source verification plan 계산                      |
| `planContextGraphVerificationRust`                                              | function  | `src/rag/rust-core.ts`            | TS source path와 Rust GraphRAG verification bridge                  |
| `create_context_preview`                                                        | function  | `crates/rag-wasm/src/lib.rs`      | context citation preview whitespace 정규화와 220자 제한 계산        |
| `createContextPreviewRust`                                                      | function  | `src/rag/rust-core.ts`            | TS text와 Rust context preview bridge                               |
| `extractVaultLinks`                                                             | function  | `src/chat/context-expansion.ts`   | Rust vault link extraction wrapper                                  |
| `is_excluded_path`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | RAG exclude path pattern matching                                   |
| `isExcludedPathRust`                                                            | function  | `src/rag/rust-core.ts`            | Rust exclude path matcher bridge                                    |
| `isExcludedPath`                                                                | function  | `src/utils/vault.ts`              | Rust vault exclude path matching wrapper                            |
| `normalize_entity_name`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity 이름 정규화                                         |
| `normalize_graph_name`                                                          | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction 이름 정규화                                     |
| `normalize_graph_confidence_or_default`                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction confidence clamp/default 계산                   |
| `sanitize_graph_id_part` / `create_graph_id`                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG extraction record ID part 정규화와 ID 생성                 |
| `normalizeGraphNameRust` / `normalizeGraphConfidenceRust` / `createGraphIdRust` | function  | `src/rag/rust-core.ts`            | Graph extraction 정규화 Rust bridge                                 |
| `extract_json_object_text`                                                      | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM 응답에서 JSON object 텍스트 추출                       |
| `extractJsonObjectRust`                                                         | function  | `src/rag/rust-core.ts`            | Graph extraction JSON object extraction bridge                      |
| `normalize_extracted_graph_payload_json`                                        | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM 추출 JSON payload schema 정규화                        |
| `normalizeExtractedGraphPayloadRust`                                            | function  | `src/rag/rust-core.ts`            | Graph extraction payload normalization bridge                       |
| `parse_extracted_graph_payload_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG LLM raw 응답 parse, schema 정규화, reject 판정             |
| `parseExtractedGraphPayloadRust`                                                | function  | `src/rag/rust-core.ts`            | Graph extraction raw response parse plan bridge                     |
| `validate_ontology_relation`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | Ontology relation type/source/target domain-range 검증              |
| `validateOntologyRelationRust`                                                  | function  | `src/rag/rust-core.ts`            | Ontology relation validation bridge                                 |
| `score_entity_match_or_nan`                                                     | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity merge score 계산                                    |
| `create_entity_id`                                                              | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity id 생성                                             |
| `plan_entity_resolution_json`                                                   | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG entity resolution status/best match JSON plan 계산         |
| `scoreEntityMatchRust`                                                          | function  | `src/rag/rust-core.ts`            | TS entity resolver와 Rust merge score bridge                        |
| `createEntityIdRust` / `planEntityResolutionRust`                               | function  | `src/rag/rust-core.ts`            | TS entity resolver와 Rust id/resolution plan bridge                 |
| `EntityResolver`                                                                | class     | `src/graph/entity-resolver.ts`    | GraphRAG entity score snapshot, Rust resolution plan, pending merge 저장 |
| `find_mentioned_entity_matches`                                                 | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG 질문 entity mention index/score 계산                       |
| `findMentionedEntityMatchesRust`                                                | function  | `src/rag/rust-core.ts`            | TS entity record와 Rust mention match bridge                        |
| `plan_graph_query_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG deterministic query plan JSON 생성                         |
| `planGraphQueryRust`                                                            | function  | `src/rag/rust-core.ts`            | TS query planner와 Rust deterministic planner bridge                |
| `detect_communities_flat`                                                       | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG community assignment와 modularity 계산                     |
| `detectCommunitiesRust`                                                         | function  | `src/rag/rust-core.ts`            | numeric graph edge 배열과 Rust community detection bridge           |
| `detect_communities_from_edges_json`                                            | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG string edge snapshot의 community assignment JSON plan 계산 |
| `detectCommunitiesFromEdgesRust`                                                | function  | `src/rag/rust-core.ts`            | TS CommunityEdge snapshot과 Rust community detection bridge         |
| `detectCommunities`                                                             | function  | `src/graph/community-detector.ts` | GraphRAG edge 문자열 매핑과 Rust 우선 community detection           |
| `score_local_evidence_pairs`                                                    | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG local/evidence-first traversal evidence score 계산         |
| `scoreLocalEvidenceRust`                                                        | function  | `src/rag/rust-core.ts`            | numeric entity/relation/claim graph와 Rust evidence score bridge    |
| `plan_local_evidence_scores_json`                                               | function  | `crates/rag-wasm/src/lib.rs`      | GraphRAG record snapshot의 local evidence score/id plan 계산        |
| `planLocalEvidenceScoresRust`                                                   | function  | `src/rag/rust-core.ts`            | TS GraphRAG record snapshot과 Rust local evidence score bridge      |
| `chunk_markdown_json`                                                           | function  | `crates/rag-wasm/src/lib.rs`      | Markdown RAG chunk를 JSON으로 생성                                  |
| `chunkMarkdownRust`                                                             | function  | `src/rag/rust-core.ts`            | 내장 WASM Markdown chunk bridge                                     |
| `chunk_plain_text_json`                                                         | function  | `crates/rag-wasm/src/lib.rs`      | plain text/code RAG chunk를 JSON으로 생성                           |
| `chunkPlainTextRust`                                                            | function  | `src/rag/rust-core.ts`            | 내장 WASM plain text/code chunk bridge                              |

## DEVELOPMENT WORKFLOW

Windows:

```powershell
.\scripts\setup-dev.ps1
npm run dev
.\scripts\launch-obsidian-debug.ps1
```

macOS:

```fish
./scripts/setup-dev.fish
npm run dev
./scripts/launch-obsidian-debug.fish
```

검증 순서:

```fish
npm run security:full
npm run build
npm run review -- --tag <manifest-version> --built
```

현재 `npm run test`는 `vitest run` 이후 `npm run check:i18n`을 실행한다. 코드 변경이 순수 함수로 분리 가능하면 Vitest 테스트를 추가한다. Obsidian 런타임 의존 UI/RAG/MCP 흐름은 실제 실행 환경에서 수동 QA가 필요하다.

Obsidian 커뮤니티 리뷰에 걸리는 DOM/CSS 정적 오류는 로컬 ESLint만으로 잡히지 않을 수 있다. UI/DOM/CSS를 수정하면 반드시 `src/obsidian-community-review.test.ts`와 `npm run review -- --tag <manifest-version> --built`를 통과시킨다.

## RUST/WASM MIGRATION

- 기본 방향은 JS/TS를 Obsidian UI, DOM, 플러그인 생명주기, vault I/O, provider 네트워크 transport, MCP stdio transport, WASM wrapper 경계에만 남기는 것이다.
- 실질 기능의 결정적 로직은 Rust/WASM으로 옮긴다. RAG 해시/토큰화/청킹/BM25, vector score/top-k, GraphRAG ranking/layout 계산, 대용량 metadata diff/검증, schema/domain 판정이 우선 대상이다.
- Rust 코어는 deterministic input/output 계약을 가져야 하며, Obsidian API, DOM, API key, process, 파일 I/O를 직접 소유하지 않는다.
- 실시간성은 snapshot id/revision id로 보장한다. UI는 최신 revision만 반영하고, 오래된 Rust worker 결과는 폐기한다.
- Rust 변경은 `npm run security:full`를 통과해야 한다. 이 명령은 `rustfmt`, `clippy`, test, `wasm32-unknown-unknown` build, `cargo-deny`, `cargo-audit`, `cargo-vet`, `cargo-geiger`, npm audit, generated WASM 최신성 검사를 실행한다.
- `npm run build`와 `npm run dev`는 반드시 `npm run wasm:build`를 먼저 실행한다. generated glue/base64를 손으로 고치지 않는다.
- Rust/WASM 경계의 현재 계약은 이 문서와 `docs/README_FOR_DEV.md`를 기준으로 삼는다. 완료된 전환 일지나 단계별 작업 로그를 새 source of truth로 되살리지 않는다.

## VERSIONING AND RELEASES

- 플러그인 버전은 SemVer `x.y.z` 형식을 사용하고, `manifest.json`, `package.json`, `versions.json`을 항상 함께 갱신한다.
- `versions.json`은 플러그인 버전을 키로, 해당 버전의 최소 Obsidian 버전을 값으로 기록한다. 예: `"1.0.0": "0.15.0"`.
- Obsidian 커뮤니티 제출/배포는 `manifest.json.version`과 **완전히 같은 이름의 GitHub Release 태그**를 찾는다. `manifest.json.version`이 `1.0.0`이면 태그도 반드시 `1.0.0`이어야 하며, `v1.0.0`만 만들면 커뮤니티 제출 화면에서 릴리스를 찾지 못한다.
- GitHub Release에는 `manifest.json`, `main.js`, `styles.css` 세 asset이 포함되어야 한다. `main.js`는 `npm run build` 결과물이어야 한다.
- 릴리스 전 검증은 `npm ci`, `npm run security:full`, `npm run build` 순서로 확인한다. CI와 동일한 npm 계열에서 `package-lock.json`이 `package.json`과 동기화되어야 한다.
- 릴리스 전후에는 `npm run review -- --tag <version> --built`를 실행해 release asset 기준 Obsidian review gate를 통과시킨다.
- 릴리스 절차에는 별도 비주얼 체크나 스크린샷 확인 단계를 넣지 않는다. 릴리스 검증은 `security:full`, `build`, Obsidian review gate, GitHub Release asset 확인으로 끝낸다.
- `package-lock.json`은 추적 대상이다. 의존성 변경이나 npm CI 실패를 수정할 때는 lockfile을 함께 갱신하고 커밋한다.
- Obsidian 플러그인 스토어 출시와 업데이트는 별도 릴리스 브랜치나 PR 브랜치를 만들지 않고 `main` 브랜치에서 직접 준비한다.
- 커뮤니티 제출 시스템은 기본 브랜치의 `manifest.json`과 동일 버전 GitHub Release 태그를 기준으로 삼는다. 따라서 릴리스 버전 변경은 `main`에 커밋하고, 버전명과 완전히 같은 태그만 생성해 관리한다.
- 릴리즈 준비 시 `release-notes-*.md`나 업데이트 로그 문서를 만들지 않는다. 사용자에게 의미 있는 새 기능이 있으면 `README.md`의 현재 기능 설명에 통합하고, 릴리즈별 업데이트 요약은 repo에 커밋하지 말고 GitHub Release 본문에 직접 붙여 넣는다.
- 출시 이력과 업데이트 관리는 브랜치가 아니라 태그로만 추적한다. 예: `1.0.0`, `1.0.1`, `1.1.0`.
- 같은 버전을 재출시할 때는 새 버전으로 올리지 말고 해당 버전 태그를 새 커밋으로 이동한다. 순서: `main` 푸시 → `git tag -f <version>` → `git push --force origin <version>` → Release workflow 완료 대기 → `gh release view <version> --json assets,tagName,targetCommitish,url`로 asset 3개 확인.
- Release workflow가 tag push로 실행 중이거나 실행될 예정이면 같은 태그에 대해 수동 `gh release create`를 먼저 실행하지 않는다. workflow가 기존 asset을 지우고 다시 올리는 중 실패하면 `main.js` 누락 릴리즈가 생길 수 있다.
- 릴리즈 완료 후 `gh release view <version> --json assets`에서 `manifest.json`, `main.js`, `styles.css`가 모두 있고, 가능하면 `gh attestation verify main.js --repo magnitus99/Superpower-Inside`, `gh attestation verify styles.css --repo magnitus99/Superpower-Inside`, `gh attestation verify manifest.json --repo magnitus99/Superpower-Inside`까지 확인한다.

## CONVENTIONS

- 답변과 코드 주석은 한국어로 작성한다. 변수명/함수명/타입명 등 코드 식별자는 영어를 사용한다.
- 모든 사용자 표시 텍스트, UI 레이블, 버튼, placeholder, Notice, 상태/오류 메시지, 기본 프롬프트, 도구 설명은 반드시 `src/i18n.ts`에 한국어와 영어를 모두 준비하고 `t()`로 호출한다.
- `src/i18n.ts` 외 런타임 TypeScript 파일에 한국어 문자열/템플릿 리터럴을 직접 두지 않는다. 예외는 테스트/문서가 아닌 이상 만들지 않는다.
- i18n 변경 후에는 `npm run check:i18n`으로 한국어 문자열이 `src/i18n.ts` 밖에 남지 않았고 영어 번역 객체에 한국어가 섞이지 않았는지 확인한다.
- 로컬 개발 명령과 문서는 실행 플랫폼을 명시한다. Windows 절차는 PowerShell, macOS 절차는 fish를 사용하며, Rust/WASM 보조 스크립트는 npm script 또는 `scripts/run-fish.mjs`를 통해 실행한다.
- 이 프로젝트는 Node/npm 기반 Obsidian 플러그인이다. Python/uv는 별도 지시가 없으면 사용하지 않는다.
- Obsidian 파일 접근은 `this.app.vault`, `vault.adapter`, `cachedRead`, `modify`, `create`를 우선한다. 런타임 코드에서 직접 `fs` 접근을 늘리지 않는다.
- 대부분 named import/export와 `import type`을 사용한다. 하위 디렉터리 barrel 파일은 없다.
- DOM은 Obsidian `createEl`, `createDiv`, `createSpan` 계열을 우선한다. 사용자/모델 출력에 `innerHTML` 직접 할당하지 않는다.
- Obsidian 커뮤니티 정적 리뷰 Error를 피하기 위해 런타임 TypeScript에서 `.style.*`, `innerHTML`/`outerHTML` 대입, `createEl('h1'..'h6')`, `attr: { style: ... }`를 사용하지 않는다. 표시/숨김은 CSS class, 동적 수치는 `setCssProps`, 아이콘은 `setIcon`, heading UI는 설정 화면에서는 `new Setting(containerEl).setName(...).setHeading()`, 그 외 화면에서는 heading class가 붙은 `createDiv`를 사용한다.
- UI 표시 텍스트 줄바꿈이 필요하면 HTML 문자열을 만들지 말고 text node와 `br`를 조합한다. 문서 객체가 필요하면 전역 `document` 대신 `container.ownerDocument`나 Obsidian API를 우선한다.
- Obsidian popout window 호환성을 위해 런타임 DOM 생성은 `container.ownerDocument`를 우선하고, 전역 문서가 정말 필요할 때만 Obsidian의 `activeDocument`를 사용한다. `document.createElement`, `document.createTextNode`, `document.createTreeWalker`를 새로 쓰지 않는다.
- DOM 타입 narrowing은 cross-window 안전한 `node.instanceOf(...)` 또는 `src/utils/dom.ts`의 `isDomInstance(...)`를 사용한다. `instanceof HTMLElement`, `instanceof HTMLDetailsElement`, `instanceof HTMLButtonElement`를 새로 쓰지 않는다.
- 네트워크 요청은 Obsidian `requestUrl`을 사용한다. 런타임 provider/validation 코드에서 browser `fetch`를 새로 쓰지 않는다. `requestUrl` 기반 응답은 buffered이므로 capability도 `request-url-buffered`와 `best-effort` abort로 솔직하게 표시한다.
- 사용자 확인/텍스트 입력은 `src/utils/modal-prompts.ts`의 `confirmWithModal`/`promptWithModal`을 사용한다. `confirm()`/`prompt()`/`window.confirm()`/`window.prompt()`는 새로 쓰지 않는다.
- Markdown 렌더링은 `MarkdownRenderer.render(app, markdown, el, sourcePath, component)`를 사용한다. deprecated 렌더링 API를 다시 쓰지 않는다.
- 설정 탭 내부 refresh는 private render helper를 호출하고, 내부 이벤트 핸들러에서 `this.display()`를 직접 재호출하지 않는다.
- 설정 탭의 범위값 입력에는 슬라이더를 사용하지 않는다. 숫자 텍스트 입력(`addText` + `inputEl.type = 'number'`)으로 범위와 step을 지정한다.
- Provider 추가 시 `PROVIDER_KEYS`, `PROVIDER_LABELS`, `DEFAULT_SETTINGS`, 설정 UI, `createProvider`, validation 경로를 함께 확인한다.
- RAG 설정의 `vectorStoreType`에는 `indexeddb` 옵션이 보이지만 현재 `main.ts`는 항상 `JsonFileVectorStore('.superpower-inside/vectors.json')`를 생성한다. UI 옵션과 실제 구현 차이를 수정 없이 전제하지 않는다.
- `manifest.json`은 `isDesktopOnly: true`다. 이 플러그인은 MCP stdio, 로컬 Ollama 등 데스크톱 중심 기능을 전제로 하며 모바일 지원을 목표로 하지 않는다.

## LOGGING

- 런타임 진단 로그는 `src/utils/logger.ts`의 통합 로거를 사용한다. 새 `console.*` 호출을 추가하지 않는다.
- 로그 source는 기능 경계를 드러내는 점 표기법을 쓴다. 예: `rag.indexer`, `rag.auto`, `graph.indexing`, `embedding.openai`, `mcp`, `chat.context`.
- 레벨 의미를 지킨다: `trace`는 반복 배치/세부 루프, `debug`는 상태 전환과 스케줄링, `info`는 작업 시작, `notice`는 사용자에게 의미 있는 성공, `warn`은 복구 가능한 문제, `error`는 실패, `fatal`은 플러그인 핵심 흐름 중단이다.
- API 키, Authorization 헤더, 토큰, 쿠키, 세션, 비밀번호, credential 원문은 로그에 넣지 않는다. 컨텍스트 객체를 넘길 때도 endpoint/model/status/count/path 중심으로 남긴다.
- API 429, 재시도, backoff, abort/cancel, fallback endpoint, indexing skip 사유는 반드시 `appLogger` 또는 `plugin.logger`에 남긴다.
- 에이전트 진단 탭에서 확인 가능한 로그를 우선하고, 콘솔 출력은 `mirrorToConsole` 옵션에만 종속시킨다.

## ANTI-PATTERNS

| 금지 패턴                                  | 이유                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `as any`, `@ts-ignore`, `@ts-expect-error` | TS strict와 ESLint 정책 위반                                                                                   |
| `eslint-disable`, `prettier-ignore`        | 예외를 만들기보다 타입/구조를 바로잡을 것                                                                      |
| `ChatView`에 큰 기능을 계속 누적           | 이미 3141줄. 가능하면 `context.ts`, `persistence.ts`, 새 helper로 분리                                         |
| 새 `console.*` 직접 호출                   | 에이전트 진단 탭에서 보이지 않아 런타임 진단이 분산된다. `appLogger` 또는 `plugin.logger`를 사용              |
| 런타임 TS에서 `.style.*` 직접 대입         | Obsidian 커뮤니티 리뷰의 `obsidianmd/no-static-styles-assignment` Error. CSS class 또는 `setCssProps` 사용     |
| `innerHTML` / `outerHTML` 대입             | Obsidian 커뮤니티 리뷰 Error 및 XSS 위험. text node, `createSpan`, Markdown renderer 사용                      |
| `createEl('h1'..'h6')` 직접 생성           | 설정 UI 일관성 리뷰 Error. 설정 화면은 `Setting(...).setHeading()`, 일반 화면은 heading class `createDiv` 사용 |
| `attr: { style: ... }` inline style        | Obsidian 커뮤니티 리뷰 Error. `styles.css` class로 이동                                                        |
| `document.create*` 런타임 호출             | popout window 호환성 경고. `container.ownerDocument` 또는 `activeDocument` 사용                               |
| DOM `instanceof HTMLElement` 계열          | cross-window 타입 체크 경고. `.instanceOf(...)` 또는 `isDomInstance(...)` 사용                                 |
| `fetch()` 런타임 네트워크 호출             | Obsidian 커뮤니티 리뷰 경고. `requestUrl` 사용, streaming capability는 buffered로 표시                         |
| `confirm()` / `prompt()`                   | blocking browser dialog 경고. Obsidian `Modal` 기반 helper 사용                                               |
| 단순 `\n\n` 청킹                           | RAG 품질 저하. `chunkMarkdown()` 경계 규칙 유지                                                                |
| 런타임 `.env`/`process.env` 의존           | Obsidian 브라우저 런타임에 보장되지 않음. MCP PATH 처리 예외만 신중히 다룸                                     |
| 웹 세션/쿠키 기반 크롤링                   | Obsidian 보안/배포 정책상 부적합                                                                               |
| `package-lock.json` 없이 의존성 변경       | CI는 `npm ci`를 사용하므로 `package.json`과 lockfile 불일치가 바로 릴리스 실패로 이어진다                      |
| `src/llm/providers.ts.bak` 유지            | 백업 파일 성격. 정리 작업 시 삭제 후보                                                                         |

## COMMANDS

```powershell
npm run dev        # esbuild watch, 개발 중 main.js 자동 재빌드
npm run security:full # 전체 보안·정합성 게이트
npm run wasm:build # Rust/WASM glue와 embedded bytes 생성
npm run build      # Rust/WASM 빌드 후 production 번들(minify, no sourcemap)
npm run format     # Prettier --write src/ main.ts
```

## NOTES

- API 키는 Obsidian 플러그인 `data.json`에 평문 저장된다. 공유/동기화/로그 출력 시 항상 민감 정보로 취급한다.
- `data.json`, `main.js`, `.sisyphus/`는 현재 `.gitignore` 대상이다. `package-lock.json`은 추적 대상이다.
- `main.ts loadSettings()`는 provider 모델 배열, Ollama URL, chat `defaultModel`, RAG auto-update, MCP stdio 설정 migration을 수행한다.
- `saveSettings()`는 provider 재초기화, RAG 재초기화, MCP 재연결을 유발한다. 설정 UI 변경은 런타임 부작용까지 확인한다.
- MCP 설정은 표준 `mcpServers` JSON으로 가져오고 내부 `MCPServerConfig[]`로 변환한다. HTTP/SSE 레거시 서버는 migration에서 제거된다.
- 채팅 컨텍스트는 자동 RAG 결과를 항상 먼저 시도하고, 질문 내 멘션(`@server`, `@file`, `@[folder/path]`)을 추가 컨텍스트로 붙인다.
- 출처 카드는 파일 열기, Obsidian 링크 복사, 활성 노트에 출처 삽입 동작을 가진다.
- `simulations/chat-sim.html`과 `sim-*.png`는 현재 작업트리에 미추적 산출물로 보인다. UI 회귀 확인 자료로 쓸 수 있지만 배포 산출물은 아니다.
