# AGENTS.md — Super-Obsidian-by-AI

**Generated:** 2026-05-09
**Commit:** (current)
**Branch:** main

> Obsidian 플러그인. LLM, RAG, MCP, 사이드바 채팅 통합.

## STRUCTURE

```
.
├── main.ts                   # Plugin 진입점 (onload/onunload)
├── manifest.json             # Obsidian plugin metadata
├── src/
│   ├── settings.ts           # PluginSettingTab + 설정 인터페이스
│   ├── i18n.ts               # UI 문구/언어 설정 공용 모듈
│   ├── llm/
│   │   ├── providers.ts      # OpenAI/Claude/Ollama/OpenRouter 공통 인터페이스
│   │   ├── embedding.ts      # 임베딩 생성 + IndexedDB 캐싱 (Dexie)
│   │   └── validation.ts     # LLM/임베딩 연결 검증
│   ├── rag/
│   │   ├── indexer.ts        # 마크다운 헤딩/코드블록 존중 청킹 + 인덱싱
│   │   ├── store.ts          # 벡터 저장소 (JSON 파일 + 인메모리 fallback)
│   │   └── query.ts          # 코사인 유사도 기반 RAG 쿼리
│   ├── chat/
│   │   ├── view.ts           # 사이드바 ChatView (WorkspaceLeaf)
│   │   ├── persistence.ts    # 채팅 → 마크다운 파일 저장/불러오기
│   │   └── commands.ts       # 에디터 내 AI 지시어 처리
│   ├── mcp/
│   │   ├── client.ts         # MCP SDK Client (stdio transport)
│   │   └── registry.ts       # MCP 서버 목록/설정 관리
│   └── utils/
│       ├── vault.ts          # 파일 필터 + vault adapter JSON IO
│       └── obsidian-compat.ts # 활성 플러그인 탐지 (비공식 API)
├── esbuild.config.mjs        # esbuild 번들 설정 (main.ts → main.js)
├── eslint.config.mjs         # ESLint + typescript-eslint/recommended-type-checked
├── .prettierrc.json          # Prettier 설정 (semi, singleQuote, trailingComma: all)
├── tsconfig.json             # strict: true, noImplicitAny, strictNullChecks
├── package.json              # npm scripts (dev, build, lint, typecheck, format)
├── styles.css                # 플러그인 전용 CSS
├── scripts/
│   ├── setup-dev.fish        # 테스트 볼트 + 심링크 초기화
│   ├── launch-obsidian-debug.fish # Obsidian 디버그 실행
│   └── bump-version.fish     # 릴리스 버전 증가
├── docs/
│   ├── DEV_SETUP.md          # 개발 환경 설정 (심링크 + hot-reload)
│   ├── README_FOR_DEV.md     # 아키텍처 개요 + 디버깅 가이드
│   └── OBSIDIAN_COMMUNITY_SUBMISSION.md # 커뮤니티 플러그인 제출 체크리스트
└── .github/workflows/release.yml # 태그 푸시 시 린트/타입체크/빌드/릴리스
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| LLM Provider 변경 | `src/llm/providers.ts` + `src/settings.ts` | 팩토리 함수 + 설정 UI 동시 확인 |
| 임베딩 캐시/백엔드 변경 | `src/llm/embedding.ts` | Dexie 기반 IndexedDB 캐시 |
| RAG 저장소 백엔드 변경 | `src/rag/store.ts` | VectorStore 인터페이스 구현체 확인 |
| 청킹 로직 수정 | `src/rag/indexer.ts` | 헤딩/코드블록 경계 존중 규칙 |
| 채팅 UI 수정 | `src/chat/view.ts` | ItemView 확장, Obsidian DOM API |
| 에디터 AI 명령어 | `src/chat/commands.ts` | `executeDirective` switch case |
| MCP 연결/설정 | `src/mcp/client.ts` + `src/mcp/registry.ts` | stdio transport, JSON 편집 |
| 활성 플러그인 탐지 | `src/utils/obsidian-compat.ts` | 비공식 API, try/catch 필수 |
| 다국어 문자열 추가 | `src/i18n.ts` | 언어 키-값 맵 |
| 빌드 설정 변경 | `esbuild.config.mjs` | external 목록 수정 시 주의 |
| 릴리스 워크플로우 | `.github/workflows/release.yml` | 태그 기반 릴리스 |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `SuperObsidianPlugin` | class | `main.ts` | Plugin 진입점, provider/RAG/MCP 초기화 및 조립 |
| `PluginLike` | interface | `src/settings.ts` | `main.ts` ↔ `settings.ts` 간 느슨한 결합 |
| `SuperObsidianSettingTab` | class | `src/settings.ts` | 설정 UI (PluginSettingTab), debouncedSave |
| `DEFAULT_SETTINGS` | const | `src/settings.ts` | 기본 설정값 |
| `createProvider` | function | `src/llm/providers.ts` | ProviderKey → LLMProvider 팩토리 |
| `OpenAICompatibleProvider` | class | `src/llm/providers.ts` | OpenAI/OpenRouter 호환 공통 클래스 |
| `CachedEmbeddingProvider` | class | `src/llm/embedding.ts` | 메모리 + IndexedDB 이중 캐시 |
| `validateProviderApi` | function | `src/llm/validation.ts` | LLM 연결 테스트 |
| `chunkMarkdown` | function | `src/rag/indexer.ts` | 마크다운 구조 존중 청킹 |
| `VaultIndexer` | class | `src/rag/indexer.ts` | 볼트 전체/증분 인덱싱 |
| `JsonFileVectorStore` | class | `src/rag/store.ts` | vault.adapter 기반 JSON 저장 |
| `MemoryVectorStore` | class | `src/rag/store.ts` | 인메모리 fallback |
| `RAGQueryEngine` | class | `src/rag/query.ts` | 임베딩 → 유사도 검색 → 컨텍스트 |
| `ChatView` | class | `src/chat/view.ts` | 사이드바 채팅 ItemView, 스트리밍 응답 |
| `CHAT_VIEW_TYPE` | const | `src/chat/view.ts` | 뷰 타입 식별자 |
| `executeDirective` | function | `src/chat/commands.ts` | 에디터 AI 지시어 실행 |
| `MCPClientManager` | class | `src/mcp/client.ts` | MCP stdio 클라이언트 래퍼 |
| `MCPRegistry` | class | `src/mcp/registry.ts` | MCP 서버/클라이언트 레지스트리 |
| `getMarkdownFilesFiltered` | function | `src/utils/vault.ts` | 볼트 파일 필터링 |
| `getActivePluginIds` | function | `src/utils/obsidian-compat.ts` | 비공식 API로 활성 플러그인 탐지 |

## CONVENTIONS

- **언어**: 답변/주석은 한국어, 코드 식별자(변수명, 함수명)는 영어.
- **Shell**: fish (`and`/`or`, `set`, `if test`)
- **Node**: `npm` (Obsidian 플러그인 표준). Python/uv는 이 프로젝트에서 사용하지 않는다.
- **개발 언어**: TypeScript (엄격 모드)
- **검증 순서**: `npm run lint` → `npm run typecheck` → `npm run build`
  - 각 단계는 반드시 **0 warning, 0 error** 상태를 유지해야 한다.
  - 린트 규칙은 **Prettier + ESLint(typescript-eslint/recommended-type-checked)** 기반.
- **타입 검사**: `tsconfig.json`에 `strict: true`, `noImplicitAny: true`, `strictNullChecks: true` 등을 포함.
- **포맷**: Prettier — `semi: true`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: all`, `printWidth: 100`, `endOfLine: lf`.
- **수동 QA**: 개발 빌드를 실제 Obsidian 볼트에 설치하고 채팅/인덱싱/설정 UI를 직접 확인.
- **import/export**: 대부분 named import/export + `import type` 적극 사용. `main.ts`만 `export default`.
- **네이밍**: 클래스는 `SuperObsidian*`(PascalCase), 상수는 `DEFAULT_SETTINGS`, `CHAT_VIEW_TYPE` 등 대문자 스네이크, 플러그인/뷰 식별자는 kebab-case.

## ANTI-PATTERNS (THIS PROJECT)

| 금지 패턴 | 이유 |
|------|------|
| `as any`, `@ts-ignore`, `@ts-expect-error` | TS 엄격 모드 위반 |
| `eslint-disable`, `prettier-ignore` | 예외 처리 최소화 원칙 |
| Python/uv 사용 | Obsidian 플러그인은 npm 표준 |
| React/Vue/Svelte 사용 | 번들 크기 증가 + esbuild 복잡도 상승 |
| 단순 `\n\n` 분할로 청킹 | RAG 품질 저하 |
| Node `http` 모듈 사용 | 반드시 `fetch` 또는 `requestUrl` 사용 |
| 직접 파일 시스템 접근 | `this.app.vault` API만 사용 (sandboxed 환경 대응) |
| `this.app.plugins.plugins` 비공식 속성 의존 | Obsidian 업데이트로 깨질 수 있음 |
| 웹 세션(쿠키) 기반 크롤링 | Obsidian 보안 정책상 미권장 |
| `.env` 런타임 의존 | `process.env`는 런타임에 존재하지 않음 |

## COMMANDS

```bash
# 개발
npm run dev      # esbuild watch (main.js 자동 재빌드)

# 검증 (0 warning, 0 error 필수)
npm run lint       # ESLint (src/, main.ts)
npm run typecheck  # TypeScript 검사 (tsc --noEmit)
npm run build      # production 빌드 (minify, no sourcemap)

# 포맷팅
npm run format     # Prettier --write src/ main.ts

# 릴리스
npm version patch  # manifest.json, package.json, git tag 동기화
# CI: .github/workflows/release.yml (태그 푸시 시 자동 빌드/릴리스)
```

## NOTES

- **API 키 보안**: `data.json`에 평문 저장 — 키 노출 위험을 사용자에게 명시.
- **CORS**: 외부 API 호출 시 Obsidian의 브라우저 네트워크 스택을 따름. 프록시 서버가 필요할 수 있다.
- **MCP stdio**: Desktop-only 기능. stdio 대신 SSE transport를 fallback으로 제공하려면 별도 구현 필요.
- **심링크**: 개발 시 `.test-vault/.obsidian/plugins/super-obsidian-by-ai/` → `repo/` 심링크 사용 필수.
- **Hot Reload**: `pjeby/hot-reload` 클론 후 활성화하면 `main.js` 변경 시 자동 리로드.
