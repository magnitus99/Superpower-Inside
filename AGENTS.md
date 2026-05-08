# AGENTS.md — Super-Obsidian-by-AI

**Generated:** 2026-05-08
**Commit:** 6ce49e3
**Branch:** main

> Obsidian 플러그인. LLM, RAG, MCP, 인터넷 검색, 사이드바 채팅 통합.

## STRUCTURE

```
.
├── main.ts                   # Plugin 진입점 (onload/onunload)
├── manifest.json             # Obsidian plugin metadata
├── src/
│   ├── settings.ts           # PluginSettingTab + 설정 인터페이스
│   ├── llm/
│   │   ├── providers.ts      # OpenAI/Claude/Ollama/OpenRouter 공통 인터페이스
│   │   └── embedding.ts      # 임베딩 생성 + IndexedDB 캐싱 (Dexie)
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
├── esbuild.config.mjs        # esbuild 번들 설정
├── eslint.config.mjs         # ESLint + typescript-eslint/recommended-type-checked
├── tsconfig.json             # strict: true, noImplicitAny, strictNullChecks
├── package.json              # npm scripts (dev, build, lint, typecheck, format)
├── styles.css                # 플러그인 전용 CSS
└── docs/
    ├── DEV_SETUP.md          # 개발 환경 설정 (심링크 + hot-reload)
    └── README_FOR_DEV.md    # 아키텍처 개요 + 디버깅 가이드
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 새 LLM Provider 추가 | `src/llm/providers.ts` + `src/settings.ts` | 팩토리 함수 + DEFAULT_SETTINGS + UI 동시 수정 |
| RAG 저장소 백엔드 변경 | `src/rag/store.ts` | VectorStore 인터페이스 구현체 추가 |
| 채팅 UI 수정 | `src/chat/view.ts` | ItemView 확장, Obsidian DOM API 사용 |
| 에디터 AI 명령어 추가 | `src/chat/commands.ts` | executeDirective switch case 추가 |
| MCP 서버 설정 UI | `src/settings.ts` | buildMCPList() 메서드 |
| 활성 플러그인 탐지 | `src/utils/obsidian-compat.ts` | 비공식 API, try/catch 필수 |
| 빌드 설정 변경 | `esbuild.config.mjs` | external 목록 수정 시 주의 |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `SuperObsidianPlugin` | class | `main.ts:27` | Plugin 진입점, LLM/RAG/MCP 초기화 |
| `createProvider` | function | `src/llm/providers.ts:302` | ProviderKey → LLMProvider 팩토리 |
| `chunkMarkdown` | function | `src/rag/indexer.ts:18` | 마크다운 구조 존중 청킹 |
| `VaultIndexer` | class | `src/rag/indexer.ts:103` | 볼트 전체 인덱싱/증분 인덱싱 |
| `JsonFileVectorStore` | class | `src/rag/store.ts:44` | vault.adapter 기반 벡터 저장 |
| `RAGQueryEngine` | class | `src/rag/query.ts:21` | 임베딩 → 유사도 검색 → 컨텍스트 문자열 |
| `ChatView` | class | `src/chat/view.ts:7` | 사이드바 채팅 ItemView |
| `MCPClientManager` | class | `src/mcp/client.ts:18` | MCP stdio 클라이언트 |
| `MCPRegistry` | class | `src/mcp/registry.ts:4` | MCP 서버/클라이언트 레지스트리 |
| `SuperObsidianSettingTab` | class | `src/settings.ts:89` | 설정 UI (PluginSettingTab) |
| `PluginLike` | interface | `src/settings.ts:43` | main.ts ↔ settings.ts 간 느슨한 결합 |

## CONVENTIONS

- **언어**: 답변/주석은 한국어, 코드 식별자(변수명, 함수명)는 영어.
- **Shell**: fish (`and`/`or`, `set`, `if test`)
- **Node**: `npm` (Obsidian 플러그인 표준). Python/uv는 이 프로젝트에서 사용하지 않는다.
- **개발 언어**: TypeScript (엄격 모드)
- **검증 순서**: `npm run lint` → `npm run typecheck` → `npm run build`
  - 각 단계는 반드시 **0 warning, 0 error** 상태를 유지해야 한다.
  - 린트 규칙은 **Prettier + ESLint(typescript-eslint/recommended-type-checked)** 기반.
- **타입 검사**: `tsconfig.json`에 `strict: true`, `noImplicitAny: true`, `strictNullChecks: true` 등을 포함.
- **수동 QA**: 개발 빌드를 실제 Obsidian 볼트에 설치하고 채팅/인덱싱/설정 UI를 직접 확인.

## ANTI-PATTERNS (THIS PROJECT)

| 금지 패턴 | 이유 | 위치 |
|------|------|------|
| `as any`, `@ts-ignore`, `@ts-expect-error` | TS 엄격 모드 위반 | AGENTS.md:10, 158 |
| `eslint-disable`, `prettier-ignore` | 예외 처리 최소화 원칙 | AGENTS.md:157 |
| Python/uv 사용 | Obsidian 플러그인은 npm 표준 | AGENTS.md:11 |
| React/Vue/Svelte 사용 | 번들 크기 증가 + esbuild 복잡도 상승 | AGENTS.md:128 |
| 단순 `\n\n` 분할로 청킹 | RAG 품질 저하 | AGENTS.md:92 |
| Node `http` 모듈 사용 | 반드시 `fetch` 또는 `requestUrl` 사용 | AGENTS.md:116 |
| 직접 파일 시스템 접근 | `this.app.vault` API만 사용 (sandboxed 환경 대응) | AGENTS.md:166 |
| `this.app.plugins.plugins` 비공식 속성 의존 | Obsidian 업데이트로 깨질 수 있음 | AGENTS.md:148 |
| 웹 세션(쿠키) 기반 크롤링 | Obsidian 보안 정책상 미권장 | AGENTS.md:85 |
| `.env` 런타임 의존 | `process.env`는 런타임에 존재하지 않음 | AGENTS.md:164 |

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
- **MCP stdio**: Desktop-only 기능. `isDesktopOnly`를 `true`로 설정하거나, stdio 대신 SSE transport를 fallback으로 제공.
- **심링크**: 개발 시 `.test-vault/.obsidian/plugins/super-obsidian-by-ai/` → `repo/` 심링크 사용 필수.
- **Hot Reload**: `pjeby/hot-reload` 클론 후 활성화하면 `main.js` 변경 시 자동 리로드.
