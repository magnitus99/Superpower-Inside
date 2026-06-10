# AGENTS.md — Superpower-Inside

**Generated:** 2026-05-14
**Commit:** b02790e
**Branch:** feat/chat-research-copilot

> Obsidian 플러그인. LLM, RAG, MCP 도구 호출, 인터넷 검색 도구, 사이드바 채팅, 채팅 세션 저장, 출처/컨텍스트 첨부를 통합한다.
> TypeScript strict 모드, esbuild CJS 번들, Obsidian DOM API 기반 UI.

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
├── scripts/                      # fish 스크립트(setup-dev, launch-obsidian-debug, bump-version)
├── docs/                         # 개발/제출 문서
├── simulations/                  # chat-sim.html UI 시뮬레이션(미추적/배포 제외 성격)
├── .test-vault/                  # 실제 개발용 Obsidian 테스트 볼트(.gitignore 대상)
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
| RAG 저장소               | `src/rag/store.ts`                                   | `JsonFileVectorStore`는 `.superpower-inside/vectors.json` 사용            |
| RAG 질의/컨텍스트        | `src/rag/query.ts` + `src/chat/context.ts`           | 유사도 검색 결과가 채팅 system prompt와 출처 카드로 들어감                |
| 채팅 UI                  | `src/chat/view.ts`                                   | 3141줄. DOM, 스트리밍, 도구 호출, 출처, 세션 상태가 집중됨                |
| 채팅 저장/로드           | `src/chat/persistence.ts`                            | 프론트매터 + HTML 주석 기반 Markdown 직렬화, 레거시 로드 지원             |
| 멘션 처리                | `src/chat/mention-parser.ts` + `src/chat/context.ts` | `@server`, `@file.md`, `@[path with spaces.md]`, 폴더 멘션                |
| 멘션 테스트              | `src/chat/mention-parser.test.ts`                    | 현재 유일한 Vitest 테스트                                                 |
| 세션 히스토리 모달       | `src/chat/session-modal.ts`                          | `FuzzySuggestModal`, 채팅 메타 로드                                       |
| MCP 연결/도구 호출       | `src/mcp/client.ts` + `src/mcp/registry.ts`          | stdio 전용. `mcpPath`/env PATH 처리                                       |
| MCP JSON 편집            | `src/utils/mcp-json.ts`                              | 표준 `mcpServers` JSON 검증/포맷                                          |
| 활성 플러그인 탐지       | `src/utils/obsidian-compat.ts`                       | 비공식 Obsidian API 접근이므로 try/catch 유지                             |
| 개발 볼트/QA             | `.test-vault/`                                       | 실제 Obsidian 실행, RAG 벡터, 저장된 채팅 세션 확인                       |

## CODE MAP

| Symbol                       | Type      | Location                     | Role                                                   |
| ---------------------------- | --------- | ---------------------------- | ------------------------------------------------------ |
| `SuperpowerInsidePlugin`     | class     | `main.ts`                    | Plugin 진입점, 설정 migration, provider/RAG/MCP 초기화 |
| `SuperpowerInsideSettings`   | interface | `src/settings.ts`            | 전체 설정 스키마                                       |
| `DEFAULT_SETTINGS`           | const     | `src/settings.ts`            | Provider/RAG/MCP/Chat 기본값                           |
| `SuperpowerInsideSettingTab` | class     | `src/settings.ts`            | 설정 UI와 debounced save                               |
| `createProvider`             | function  | `src/llm/providers.ts`       | ProviderKey → LLMProvider 팩토리                       |
| `OpenAICompatibleProvider`   | class     | `src/llm/providers.ts`       | OpenAI/OpenRouter 공통 스트리밍/도구 호출 처리         |
| `ClaudeProvider`             | class     | `src/llm/providers.ts`       | Anthropic Claude Provider                              |
| `OllamaProvider`             | class     | `src/llm/providers.ts`       | Ollama Local/Cloud Provider                            |
| `CachedEmbeddingProvider`    | class     | `src/llm/embedding.ts`       | 메모리 + IndexedDB(Dexie) 임베딩 캐시                  |
| `chunkMarkdown`              | function  | `src/rag/indexer.ts`         | 헤딩/코드블록 경계 존중 Markdown 청킹                  |
| `VaultIndexer`               | class     | `src/rag/indexer.ts`         | 전체/증분/파일별 인덱싱                                |
| `JsonFileVectorStore`        | class     | `src/rag/store.ts`           | vault.adapter 기반 JSON 벡터 저장소                    |
| `RAGQueryEngine`             | class     | `src/rag/query.ts`           | 임베딩 → 코사인 유사도 → 컨텍스트                      |
| `ChatView`                   | class     | `src/chat/view.ts`           | 사이드바 채팅 ItemView, 스트리밍, MCP 도구, 출처 UI    |
| `buildChatContext`           | function  | `src/chat/context.ts`        | 자동 RAG + 파일/폴더/MCP 멘션 컨텍스트 생성            |
| `parseMentions`              | function  | `src/chat/mention-parser.ts` | `@...` 멘션 파싱과 중복 제거                           |
| `saveChat` / `loadChat`      | function  | `src/chat/persistence.ts`    | 채팅 세션 Markdown 저장/복원                           |
| `MCPClientManager`           | class     | `src/mcp/client.ts`          | MCP SDK Client + stdio transport                       |
| `MCPRegistry`                | class     | `src/mcp/registry.ts`        | MCP 서버 설정/클라이언트/연결 상태 관리                |

## TEST VAULT

`.test-vault/`는 저장소 내부 개발용 Obsidian 볼트이며 `.gitignore` 대상이다. 새 에이전트는 이 폴더를 샘플 fixture로만 보지 말고, 실제 QA 상태와 런타임 산출물을 담는 작업 공간으로 취급한다.

| Path                                              | Meaning                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `.test-vault/.obsidian/plugins/superpower-inside` | 저장소 루트로 향하는 심링크. 복사본이 아니어야 `npm run dev` 결과가 즉시 반영됨 |
| `.test-vault/.obsidian/plugins/hot-reload/`       | `pjeby/hot-reload` 클론. `main.js` 변경 시 플러그인 자동 리로드                 |
| `.test-vault/.obsidian/community-plugins.json`    | `superpower-inside`, `hot-reload` 활성화 상태                                   |
| `.test-vault/.obsidian/workspace.json`            | Obsidian UI 상태. 개인/일시 상태라 커밋 대상 아님                               |
| `.test-vault/.superpower-inside/vectors.json`     | RAG JSON 벡터 저장소. 현재 약 1410개 entry, 23MB 수준                           |
| `.test-vault/SuperpowerInsideChats/`              | 저장된 채팅 세션 Markdown. `saveChat`/`loadChat` 포맷 실물 확인용               |
| `.test-vault/catholic bible/`                     | RAG 인덱싱 대용량 한국어 Markdown corpus. 약 110개 이상의 장/입문 파일          |
| `.test-vault/Base.base`                           | Obsidian Bases 기능 확인용 파일                                                 |
| `.test-vault/test.md`, `Welcome.md`               | 간단한 문서 요약/링크/멘션 QA용                                                 |

`.test-vault/SuperpowerInsideChats/*.md`는 두 종류의 포맷이 섞여 있다. 2026-05-10 파일들은 이전 저장 포맷에 가깝고, 2026-05-14 파일들은 `tags`, `pinned`, `sourceCount`, `summary`, `contextAttachments`, `citations` 등 최신 메타가 포함된다. `persistence.ts` 수정 시 두 계열을 모두 열 수 있어야 한다.

`.test-vault/.superpower-inside/vectors.json`은 실제 임베딩 배열을 포함하므로 크고 민감할 수 있다. RAG 저장소/청킹 변경 QA에는 유용하지만, 일반 코드 변경에서 diff에 올리지 않는다. 재인덱싱 테스트를 하면 이 파일과 채팅 세션 파일이 바뀔 수 있으니 작업 전후 `git status --short`로 범위를 확인한다.

## DEVELOPMENT WORKFLOW

```fish
# 1회성 개발 볼트/심링크/hot-reload 준비
./scripts/setup-dev.fish

# 터미널 1: esbuild watch
npm run dev

# 터미널 2: Obsidian 디버그 모드로 .test-vault 열기
./scripts/launch-obsidian-debug.fish
```

검증 순서:

```fish
npm run lint
npm run typecheck
npm run test
npm run check:i18n
npm run build
npm run review -- --tag <manifest-version> --built
```

현재 `npm run test`는 `vitest run` 이후 `npm run check:i18n`을 실행한다. 코드 변경이 순수 함수로 분리 가능하면 Vitest 테스트를 추가한다. Obsidian 런타임 의존 UI/RAG/MCP 흐름은 `.test-vault`에서 수동 QA가 필요하다.

Obsidian 커뮤니티 리뷰에 걸리는 DOM/CSS 정적 오류는 로컬 ESLint만으로 잡히지 않을 수 있다. UI/DOM/CSS를 수정하면 반드시 `src/obsidian-community-review.test.ts`와 `npm run review -- --tag <manifest-version> --built`를 통과시킨다.

## VERSIONING AND RELEASES

- 플러그인 버전은 SemVer `x.y.z` 형식을 사용하고, `manifest.json`, `package.json`, `versions.json`을 항상 함께 갱신한다.
- `versions.json`은 플러그인 버전을 키로, 해당 버전의 최소 Obsidian 버전을 값으로 기록한다. 예: `"1.0.0": "0.15.0"`.
- Obsidian 커뮤니티 제출/배포는 `manifest.json.version`과 **완전히 같은 이름의 GitHub Release 태그**를 찾는다. `manifest.json.version`이 `1.0.0`이면 태그도 반드시 `1.0.0`이어야 하며, `v1.0.0`만 만들면 커뮤니티 제출 화면에서 릴리스를 찾지 못한다.
- GitHub Release에는 `manifest.json`, `main.js`, `styles.css` 세 asset이 포함되어야 한다. `main.js`는 `npm run build` 결과물이어야 한다.
- 릴리스 전 검증은 `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` 순서로 확인한다. CI와 동일한 npm 계열에서 `package-lock.json`이 `package.json`과 동기화되어야 한다.
- 릴리스 전후에는 `npm run review -- --tag <version> --built`를 실행해 release asset 기준 Obsidian review gate를 통과시킨다.
- `package-lock.json`은 추적 대상이다. 의존성 변경이나 npm CI 실패를 수정할 때는 lockfile을 함께 갱신하고 커밋한다.
- Obsidian 플러그인 스토어 출시와 업데이트는 별도 릴리스 브랜치나 PR 브랜치를 만들지 않고 `main` 브랜치에서 직접 준비한다.
- 커뮤니티 제출 시스템은 기본 브랜치의 `manifest.json`과 동일 버전 GitHub Release 태그를 기준으로 삼는다. 따라서 릴리스 버전 변경은 `main`에 커밋하고, 버전명과 완전히 같은 태그만 생성해 관리한다.
- 출시 이력과 업데이트 관리는 브랜치가 아니라 태그로만 추적한다. 예: `1.0.0`, `1.0.1`, `1.1.0`.
- 같은 버전을 재출시할 때는 새 버전으로 올리지 말고 해당 버전 태그를 새 커밋으로 이동한다. 순서: `main` 푸시 → `git tag -f <version>` → `git push --force origin <version>` → Release workflow 완료 대기 → `gh release view <version> --json assets,tagName,targetCommitish,url`로 asset 3개 확인.
- Release workflow가 tag push로 실행 중이거나 실행될 예정이면 같은 태그에 대해 수동 `gh release create`를 먼저 실행하지 않는다. workflow가 기존 asset을 지우고 다시 올리는 중 실패하면 `main.js` 누락 릴리즈가 생길 수 있다.
- 릴리즈 완료 후 `gh release view <version> --json assets`에서 `manifest.json`, `main.js`, `styles.css`가 모두 있고, 가능하면 `gh attestation verify main.js --repo magnitus99/Superpower-Inside`, `gh attestation verify styles.css --repo magnitus99/Superpower-Inside`, `gh attestation verify manifest.json --repo magnitus99/Superpower-Inside`까지 확인한다.

## CONVENTIONS

- 답변과 코드 주석은 한국어로 작성한다. 변수명/함수명/타입명 등 코드 식별자는 영어를 사용한다.
- 모든 사용자 표시 텍스트, UI 레이블, 버튼, placeholder, Notice, 상태/오류 메시지, 기본 프롬프트, 도구 설명은 반드시 `src/i18n.ts`에 한국어와 영어를 모두 준비하고 `t()`로 호출한다.
- `src/i18n.ts` 외 런타임 TypeScript 파일에 한국어 문자열/템플릿 리터럴을 직접 두지 않는다. 예외는 테스트/문서가 아닌 이상 만들지 않는다.
- i18n 변경 후에는 `npm run check:i18n`으로 한국어 문자열이 `src/i18n.ts` 밖에 남지 않았고 영어 번역 객체에 한국어가 섞이지 않았는지 확인한다.
- 터미널 스크립트와 예시는 fish 문법을 사용한다. `export`, `&&`, `||`, `if [` 대신 `set`, `and`, `or`, `if test`를 사용한다.
- 이 프로젝트는 Node/npm 기반 Obsidian 플러그인이다. Python/uv는 별도 지시가 없으면 사용하지 않는다.
- Obsidian 파일 접근은 `this.app.vault`, `vault.adapter`, `cachedRead`, `modify`, `create`를 우선한다. 런타임 코드에서 직접 `fs` 접근을 늘리지 않는다.
- 대부분 named import/export와 `import type`을 사용한다. 하위 디렉터리 barrel 파일은 없다.
- DOM은 Obsidian `createEl`, `createDiv`, `createSpan` 계열을 우선한다. 사용자/모델 출력에 `innerHTML` 직접 할당하지 않는다.
- Obsidian 커뮤니티 정적 리뷰 Error를 피하기 위해 런타임 TypeScript에서 `.style.*`, `innerHTML`/`outerHTML` 대입, `createEl('h1'..'h6')`, `attr: { style: ... }`를 사용하지 않는다. 표시/숨김은 CSS class, 동적 수치는 `setCssProps`, 아이콘은 `setIcon`, heading UI는 설정 화면에서는 `new Setting(containerEl).setName(...).setHeading()`, 그 외 화면에서는 heading class가 붙은 `createDiv`를 사용한다.
- UI 표시 텍스트 줄바꿈이 필요하면 HTML 문자열을 만들지 말고 text node와 `br`를 조합한다. 문서 객체가 필요하면 전역 `document` 대신 `container.ownerDocument`나 Obsidian API를 우선한다.
- 설정 탭의 범위값 입력에는 슬라이더를 사용하지 않는다. 숫자 텍스트 입력(`addText` + `inputEl.type = 'number'`)으로 범위와 step을 지정한다.
- Provider 추가 시 `PROVIDER_KEYS`, `PROVIDER_LABELS`, `DEFAULT_SETTINGS`, 설정 UI, `createProvider`, validation 경로를 함께 확인한다.
- RAG 설정의 `vectorStoreType`에는 `indexeddb` 옵션이 보이지만 현재 `main.ts`는 항상 `JsonFileVectorStore('.superpower-inside/vectors.json')`를 생성한다. UI 옵션과 실제 구현 차이를 수정 없이 전제하지 않는다.
- `manifest.json`은 `isDesktopOnly: true`다. 이 플러그인은 MCP stdio, 로컬 Ollama 등 데스크톱 중심 기능을 전제로 하며 모바일 지원을 목표로 하지 않는다.

## LOGGING

- 런타임 진단 로그는 `src/utils/logger.ts`의 통합 로거를 사용한다. 새 `console.*` 호출을 추가하지 않는다.
- 로그 source는 기능 경계를 드러내는 점 표기법을 쓴다. 예: `rag.indexer`, `rag.auto`, `graph.indexing`, `embedding.openai`, `mcp`, `chat.context`.
- 레벨 의미를 지킨다: `trace`는 반복 배치/세부 루프, `debug`는 상태 전환과 스케줄링, `info`는 작업 시작, `notice`는 사용자에게 의미 있는 성공, `warn`은 복구 가능한 문제, `error`는 실패, `fatal`은 플러그인 핵심 흐름 중단이다.
- API 키, Authorization 헤더, 토큰, 쿠키, 세션, 비밀번호, credential 원문은 로그에 넣지 않는다. 컨텍스트 객체를 넘길 때도 endpoint/model/status/count/path 중심으로 남긴다.
- API 429, 재시도, backoff, abort/cancel, fallback endpoint, indexing skip 사유는 반드시 로그에 남긴다.
- 설정 화면의 General -> Debugging -> 통합 로그 페이지에서 확인 가능한 로그를 우선하고, 콘솔 출력은 `mirrorToConsole` 옵션에 종속시킨다.

## ANTI-PATTERNS

| 금지 패턴                                  | 이유                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `as any`, `@ts-ignore`, `@ts-expect-error` | TS strict와 ESLint 정책 위반                                                                     |
| `eslint-disable`, `prettier-ignore`        | 예외를 만들기보다 타입/구조를 바로잡을 것                                                        |
| `ChatView`에 큰 기능을 계속 누적           | 이미 3141줄. 가능하면 `context.ts`, `persistence.ts`, 새 helper로 분리                           |
| 새 `console.*` 직접 호출                   | 통합 로그 페이지에서 보이지 않아 런타임 진단이 분산된다. `appLogger` 또는 `plugin.logger`를 사용 |
| 런타임 TS에서 `.style.*` 직접 대입          | Obsidian 커뮤니티 리뷰의 `obsidianmd/no-static-styles-assignment` Error. CSS class 또는 `setCssProps` 사용 |
| `innerHTML` / `outerHTML` 대입              | Obsidian 커뮤니티 리뷰 Error 및 XSS 위험. text node, `createSpan`, Markdown renderer 사용        |
| `createEl('h1'..'h6')` 직접 생성            | 설정 UI 일관성 리뷰 Error. 설정 화면은 `Setting(...).setHeading()`, 일반 화면은 heading class `createDiv` 사용 |
| `attr: { style: ... }` inline style         | Obsidian 커뮤니티 리뷰 Error. `styles.css` class로 이동                                           |
| 단순 `\n\n` 청킹                           | RAG 품질 저하. `chunkMarkdown()` 경계 규칙 유지                                                  |
| 런타임 `.env`/`process.env` 의존           | Obsidian 브라우저 런타임에 보장되지 않음. MCP PATH 처리 예외만 신중히 다룸                       |
| 웹 세션/쿠키 기반 크롤링                   | Obsidian 보안/배포 정책상 부적합                                                                 |
| `.test-vault` 산출물 무심코 커밋           | 채팅, 벡터, workspace, API 관련 상태가 섞일 수 있음                                              |
| `package-lock.json` 없이 의존성 변경       | CI는 `npm ci`를 사용하므로 `package.json`과 lockfile 불일치가 바로 릴리스 실패로 이어진다        |
| `src/llm/providers.ts.bak` 유지            | 백업 파일 성격. 정리 작업 시 삭제 후보                                                           |

## COMMANDS

```fish
npm run dev        # esbuild watch, 개발 중 main.js 자동 재빌드
npm run lint       # ESLint: src/, main.ts
npm run typecheck  # tsc --noEmit
npm run test       # Vitest
npm run check:i18n # 런타임 한글 문자열이 src/i18n.ts 밖에 남았는지 검사
npm run build      # production 번들(minify, no sourcemap)
npm run format     # Prettier --write src/ main.ts
```

```fish
./scripts/setup-dev.fish             # .test-vault 생성, 플러그인 심링크, hot-reload 설치
./scripts/launch-obsidian-debug.fish # macOS Obsidian 디버그 실행, remote debugging port 9222
./scripts/bump-version.fish patch    # main에서 manifest/package/versions 버전, build, commit, tag, push
```

## NOTES

- API 키는 Obsidian 플러그인 `data.json`에 평문 저장된다. 공유/동기화/로그 출력 시 항상 민감 정보로 취급한다.
- `data.json`, `main.js`, `.test-vault/`, `.sisyphus/`는 현재 `.gitignore` 대상이다. `package-lock.json`은 추적 대상이다.
- `main.ts loadSettings()`는 provider 모델 배열, Ollama URL, chat `defaultModel`, RAG auto-update, MCP stdio 설정 migration을 수행한다.
- `saveSettings()`는 provider 재초기화, RAG 재초기화, MCP 재연결을 유발한다. 설정 UI 변경은 런타임 부작용까지 확인한다.
- MCP 설정은 표준 `mcpServers` JSON으로 가져오고 내부 `MCPServerConfig[]`로 변환한다. HTTP/SSE 레거시 서버는 migration에서 제거된다.
- 채팅 컨텍스트는 자동 RAG 결과를 항상 먼저 시도하고, 질문 내 멘션(`@server`, `@file`, `@[folder/path]`)을 추가 컨텍스트로 붙인다.
- 출처 카드는 파일 열기, Obsidian 링크 복사, 활성 노트에 출처 삽입 동작을 가진다.
- `simulations/chat-sim.html`과 `sim-*.png`는 현재 작업트리에 미추적 산출물로 보인다. UI 회귀 확인 자료로 쓸 수 있지만 배포 산출물은 아니다.
