# AGENTS.md — Superpower-Inside

> Obsidian 플러그인. LLM, RAG, MCP 도구 호출, 인터넷 검색 도구, 사이드바 채팅, 채팅 세션 저장, 출처/컨텍스트 첨부를 통합한다.
> TypeScript strict 모드, esbuild CJS 번들, Obsidian DOM API 기반 UI.
> JS/TS는 UI와 Obsidian host boundary를 담당하는 프론트엔드/wrapper다. 실질 기능의 결정적 로직은 Rust/WASM 코어가 담당한다.

## 작업 시작과 Codex 사용

- 모든 답변·설명·주석은 한국어, 코드 식별자는 영어로 작성합니다. macOS 터미널은 fish를 명시해 실행합니다.
- 모델과 추론 강도는 사용자가 선택합니다. 저장소 설정이나 지침으로 특정 모델·강도를 지정하지 않습니다. 모델에 관계없이 같은 검증 기준을 적용하며, 작업 흐름은 [docs/codex-development.md](docs/codex-development.md)를 참고합니다.
- 먼저 `git status --short --branch`로 기존 변경을 확인하고, 사용자의 목적·완료 조건·관련 코드·테스트를 좁혀 읽습니다. 사용자 변경과 볼트·설정·키를 보존합니다.
- 파일에 명시된 사실과 현재 코드가 다르면 코드를 확인해 지침을 고칩니다. 줄 수·커밋 번호·거대한 심볼 목록을 시작 지침에 추가하지 않습니다.
- 복잡한 변경은 짧은 계획과 회귀 테스트부터 시작합니다. 독립적인 읽기는 묶고, 의존하는 변경과 검증은 순서대로 수행합니다.
- 라이브러리 API는 Context7에서 확인하고, 없으면 공식 문서·설치된 타입/소스를 확인합니다. 브라우저는 Codex 내부 브라우저 → Chrome → 최후 수단 Playwright 순서입니다.
- 스킬은 이름이 요청됐거나 실제 작업에 필요한 것만 읽습니다. 전체 목록·참고문서를 선제적으로 읽지 않습니다. 저장소 스킬은 Rust 품질·Obsidian CLI·Obsidian Markdown·디자인 시스템 4개를 유지합니다. [스킬 구성과 선정 근거](docs/skill-audit.md)를 참고합니다.
- 완료 보고에는 변경 결과, 실제 실행한 검증과 종료 상태, 남은 문제를 씁니다.

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

- UI/DOM/CSS/레이아웃/카피 배치/상태/모션/접근성 표시를 바꾸면 실제 Obsidian 또는 충실한 시뮬레이션의 스크린샷을 직접 찍고 봅니다. 코드·DOM·테스트만으로 화면 검수를 대신하지 않습니다.
- 브랜드 톤, 위계, 여백, 밀도, 정렬, 대비, 가독성, 좁은 폭·긴 텍스트 줄바꿈, 아이콘·버튼 의미, focus/hover/active, 상태 변화, reduced-motion을 확인합니다. 상단 상태와 펼침/접힘, 빈 상태, 오류, disabled, 진행 중 화면을 포함합니다.
- 화면 검수는 가능한 한 커밋 전에 끝냅니다. 릴리스 자체에 별도 스크린샷 단계를 추가하지 않습니다.
- 스크린샷 없는 UI/UX 완료 보고는 금지합니다. 촬영이 불가능하면 미완료 검수 항목과 필요한 실행 화면을 구체적으로 남깁니다.
- Obsidian 네이티브 앱에서는 computer-use로 마우스 클릭·타이핑을 하지 않습니다. CLI·코드·파일·빌드·로그로 확인하고 사용자가 직접 눌러야 하는 단계만 명시합니다.

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

## 코드 탐색

- 진입점은 `main.ts`, UI 설정은 `src/settings.ts`, 계산은 `crates/rag-wasm/`, WASM 경계는 `src/rag/rust-core.ts`입니다.
- 작업 영역을 먼저 좁히고 `rg --files`, `rg -n`으로 구현과 테스트를 함께 찾습니다.
- 파일·심볼의 상세 참고표는 [docs/agent-code-map.md](docs/agent-code-map.md)에서 해당 기능만 읽습니다.
- `src/chat/` 수정 전에는 [src/chat/AGENTS.md](src/chat/AGENTS.md)를 읽습니다.

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
and npm run build
and npm run review -- --tag (node -p "require('./manifest.json').version") --built
```

현재 `npm run test`는 `vitest run` → `npm run check:i18n` → `npm run chat:ux-gate`를 순서대로 실행한다. 코드 변경이 순수 함수로 분리 가능하면 Vitest 테스트를 추가한다. Obsidian 런타임 의존 UI/RAG/MCP 흐름은 실제 실행 환경에서 수동 QA가 필요하다.

Obsidian 커뮤니티 리뷰에 걸리는 DOM/CSS 정적 오류는 로컬 ESLint만으로 잡히지 않을 수 있다. UI/DOM/CSS를 수정하면 반드시 `src/obsidian-community-review.test.ts`와 `npm run review -- --tag <manifest-version> --built`를 통과시킨다.

## RUST/WASM MIGRATION

- 기본 방향은 JS/TS를 Obsidian UI, DOM, 플러그인 생명주기, vault I/O, provider 네트워크 transport, MCP stdio transport, WASM wrapper 경계에만 남기는 것이다.
- 실질 기능의 결정적 로직은 Rust/WASM으로 옮긴다. RAG 해시/토큰화/청킹/BM25, vector score/top-k, GraphRAG ranking/layout 계산, 대용량 metadata diff/검증, schema/domain 판정이 우선 대상이다.
- Rust 코어는 deterministic input/output 계약을 가져야 하며, Obsidian API, DOM, API key, process, 파일 I/O를 직접 소유하지 않는다.
- 실시간성은 snapshot id/revision id로 보장한다. UI는 최신 revision만 반영하고, 오래된 Rust worker 결과는 폐기한다.
- Rust 변경은 `npm run security:full`를 통과해야 한다. 이 명령은 `rustfmt`, `clippy`, test, `wasm32-unknown-unknown` build, `cargo-deny`, `cargo-audit`, `cargo-vet`, `cargo-geiger`, npm audit, generated WASM 최신성 검사를 실행한다.
- `npm run build`와 `npm run dev`는 반드시 `npm run wasm:build`를 먼저 실행한다. generated glue/base64를 손으로 고치지 않는다.
- Rust/WASM 경계의 현재 계약은 이 문서와 `docs/README_FOR_DEV.md`를 기준으로 삼는다. 완료된 전환 일지나 단계별 작업 로그를 새 source of truth로 되살리지 않는다.

## 릴리스

릴리스·버전·태그·배포 작업 전에는 [docs/agent-release.md](docs/agent-release.md)를 반드시 읽습니다. 사용자 요청 없이 커밋·푸시·릴리스를 실행하지 않습니다.

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

## 추가 금지 사항

- `prettier-ignore`로 구조 문제를 숨기지 않습니다.
- 런타임 `.env`/`process.env` 의존을 추가하지 않습니다. MCP PATH 처리의 기존 예외만 유지합니다.
- 웹 세션·쿠키 기반 크롤링을 추가하지 않습니다.
- 단순 줄바꿈 기준으로 기존 Markdown 청킹 계약을 대체하지 않습니다.
- 의존성을 바꾸면 `package-lock.json`도 함께 갱신합니다.

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
