# 개발자 가이드 — Superpower Inside

> 이 문서는 플러그인을 디버깅하거나 새로운 기능을 추가하려는 개발자를 위한 것입니다.

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [개발 환경 구축](#2-개발-환경-구축)
3. [모듈별 디버깅 가이드](#3-모듈별-디버깅-가이드)
4. [코드 수정 → 테스트 → 릴리스 워크플로우](#4-코드-수정--테스트--릴리스-워크플로우)
5. [새로운 기능 추가하기](#5-새로운-기능-추가하기)
6. [트러블슈팅](#6-트러블슈팅)
7. [릴리스 절차](#7-릴리스-절차)

---

## 1. 아키텍처 개요

### 디렉토리 구조

```
.
├── main.ts                    # 플러그인 진입점 (onload/onunload)
├── manifest.json              # 메타데이터
├── src/
│   ├── settings.ts           # 설정 인터페이스 + PluginSettingTab
│   ├── llm/
│   │   ├── providers.ts      # LLM 공통 인터페이스 (OpenAI, Claude, Ollama, OpenRouter)
│   │   └── embedding.ts      # 임베딩 생성 + Dexie 캐싱
│   ├── rag/
│   │   ├── indexer.ts        # 마크다운 청킹 + 인덱싱
│   │   ├── store.ts          # 벡터 저장소 (JSON 파일 기반 + 인메모리)
│   │   ├── status.ts         # 문서별 RAG 인덱스 상태 계산
│   │   └── query.ts          # 유사도 검색 (코사인)
│   ├── chat/
│   │   ├── view.ts           # 사이드바 채팅 뷰 (ItemView)
│   │   ├── persistence.ts    # 채팅 저장/불러오기 (Markdown)
│   │   └── commands.ts       # 에디터 지시어 처리
│   ├── mcp/
│   │   ├── client.ts         # MCP SDK 클라이언트 (stdio)
│   │   └── registry.ts       # MCP 서버 목록 관리
│   └── utils/
│       ├── vault.ts          # 파일 필터 + JSON 읽기/쓰기
│       └── obsidian-compat.ts # 활성 플러그인 탐지 (비공식 API)
```

### 데이터 흐름

```
사용자 입력 (Chat/Editor)
    │
    ├─→ ChatView.handleSend()
    │     └─→ LLMProvider.streamChat() ←┐
    │                                     │
    ├─→ RAGQueryEngine.query() ─→ EmbeddingProvider.embed()
    │                                     │
    └─→ MCPClientManager.callTool() ←────┘
```

### 주요 의존성

| 의존성 | 용도 | Obsidian API 대체 여부 |
|---|---|---|
| `obsidian` | Plugin, WorkspaceLeaf, Vault 등 기본 API | 불가 (핵심) |
| `@modelcontextprotocol/sdk` | MCP Client (stdio transport) | 불가 |
| `dexie` | IndexedDB 캐싱 (임베딩) | `localStorage` 대체 가능하나 제한적 |

---

## 2. 개발 환경 구축

### 빠른 시작 (3단계)

```bash
# 1. 1회성 설정
./scripts/setup-dev.fish

# 2. 빌드 워치 시작
npm run dev

# 3. Obsidian 디버그 모드 실행
./scripts/launch-obsidian-debug.fish
```

### setup-dev.fish가 하는 일

| 단계 | 설명 |
|---|---|
| 테스트 볼트 생성 | `repo/.test-vault/` 생성 (`.gitignore`에 포함됨) |
| 심링크 생성 | `.test-vault/.obsidian/plugins/superpower-inside/` → `repo/` |
| hot-reload 설치 | `pjeby/hot-reload` 클론 (파일 변경 시 자동 리로드) |

### 필수 조건

- **Node.js 22+** (`node --version`)
- **npm** (`npm install` 한 번 실행)
- **macOS** (Windows는 `launch-obsidian-debug.fish` 경로 수정 필요)

---

## 3. 모듈별 디버깅 가이드

### 3.1 LLM 통합 (`src/llm/providers.ts`)

**디버깅 포인트:**
- `OpenAICompatibleProvider.streamChat()` — SSE 파싱 (`TextDecoder` + `getReader()`)
- `ClaudeProvider.chat()` — Anthropic Messages API 포맷 (`x-api-key` 헤더)
- `OllamaProvider` — 로컬 `http://localhost:11434` 호출

**DevTools에서 확인:**
```javascript
// Console → Network 탭에서 fetch 요청 확인
// 또는 플러그인 코드에 console.log 삽입:
console.log('SSE buffer:', buffer);  // providers.ts streamChat 내부
```

**VS Code 브레이크포인트:**
- `providers.ts:67` — `fetch()` 반환 직후
- `providers.ts:89` — SSE 파싱 루프 시작

**새 Provider 추가 시:**
1. `LLMProvider` 인터페이스 구현
2. `createProvider()` 팩토리에 case 추가
3. `DEFAULT_SETTINGS`에 기본 config 추가
4. `SuperpowerInsideSettingTab.buildProviderSettings()`에 UI 추가

---

### 3.2 임베딩 (`src/llm/embedding.ts`)

**디버깅 포인트:**
- `sha256Hex()` — Web Crypto API, 비동기
- `CachedEmbeddingProvider.embedBatch()` — 메모리 캐시 + IndexedDB 캐시 미스/히트

**DevTools 확인:**
```javascript
// IndexedDB 확인
(await Dexie.exists('SuperpowerInsideEmbeddingCache'))  // true/false
(await new Dexie('SuperpowerInsideEmbeddingCache').table('embeddings').count())  // 캐시 개수
```

**캐시 초기화 (테스트 시):**
```javascript
// DevTools Console
const { CachedEmbeddingProvider } = await import('./src/llm/embedding');
const p = new CachedEmbeddingProvider({ embed: async (t) => [0.1, 0.2] });
await p.clearCache();
```

---

### 3.3 RAG 엔진 (`src/rag/`)

**청킹 테스트:**
```typescript
// DevTools Console 또는 테스트 파일
import { chunkMarkdown } from './src/rag/indexer';
const chunks = chunkMarkdown('# Heading\n\nParagraph...', 500);
console.log(chunks);  // { text, metadata: { filePath, heading, startLine } }
```

**인덱싱 진행 상황 확인:**
```javascript
// VaultIndexer.indexVault()는 async이므로:
const plugin = app.plugins.plugins['superpower-inside'];
const count = await plugin.vaultIndexer?.indexVault();
console.log(`Indexed ${count} files`);
```

**문서별 RAG 상태 확인:**

`src/rag/status.ts`의 `calculateRagStatus()`가 설정 탭과 자동 업데이트의 공통 기준입니다. 대상 Markdown 파일을 벡터 저장소와 비교해 `healthy`, `missing`, `stale`, `unknown` 상태로 분류합니다.

- `missing`: 해당 파일의 벡터가 없음
- `stale`: 파일 `mtime/size` 또는 임베딩 프로바이더/모델이 저장된 벡터 메타데이터와 다름
- `unknown`: 기존 벡터에 `sourceMtime`, `sourceSize`, `embeddingProvider`, `embeddingModel`이 없어 변경 여부를 판정할 수 없음

새 벡터는 `VectorEntry.metadata`에 파일 `mtime/size`와 임베딩 설정을 함께 기록합니다. 레거시 벡터는 삭제하지 않고 RAG 탭에서 “상태 확인 필요”로 표시합니다.

**벡터 저장소 디버깅:**
```javascript
// JsonFileVectorStore의 persist()는 .superpower-inside/vectors.json에 씀
const adapter = app.vault.adapter;
const raw = await adapter.read('.superpower-inside/vectors.json');
const vectors = JSON.parse(raw);
console.log(`Total vectors: ${vectors.length}`);
```

---

### 3.4 채팅 뷰 (`src/chat/view.ts`)

**DOM 구조:**
```
.containerEl.children[1]
  └── .superpower-inside-chat-container
      ├── .superpower-inside-chat-messages   ← 메시지 버블 추가됨
      └── .superpower-inside-chat-input-area
          ├── textarea.superpower-inside-chat-input
          └── button.superpower-inside-chat-send-btn
```

**메시지 추가 확인:**
```javascript
// DevTools → Elements → .superpower-inside-chat-messages 하위 div 개수 확인
// 또는 Console:
document.querySelectorAll('.superpower-inside-chat-message').length
```

**스트리밍 확인:**
```javascript
// streamChat 콜백이 호출되는지 확인
// view.ts:141附近의 onChunk 콜백에 breakpoint 설정
```

---

### 3.5 MCP (`src/mcp/client.ts`)

**제약:** `StdioClientTransport`는 Node.js 전용 → `isDesktopOnly: true` 권장

**디버깅:**
```typescript
// MCPClientManager.connectStdio() 내부
// transport 생성 후, client.connect() 에러 확인
// client.listTools() 반환값 확인
```

**데스크톱/모바일 분기:**
```typescript
// main.ts initMCP()에서:
if (!require('child_process')) {
  // 모바일: SSE transport로 fallback
}
```

---

### 3.6 활성 플러그인 탐지 (`src/utils/obsidian-compat.ts`)

**비공식 API 주의:** `app.plugins.plugins`는 Obsidian 업데이트 시 깨질 수 있음

**테스트:**
```javascript
// DevTools Console
const { getActivePluginIds } = await import('./src/utils/obsidian-compat');
getActivePluginIds(app);  // ['dataview', 'templater', ...]
```

---

## 4. 코드 수정 → 테스트 → 릴리스 워크플로우

### 일반 수정 (UI/로직)

```bash
# 1. 코드 수정
vim src/chat/view.ts

# 2. 저장 → esbuild가 자동 재빌드 (npm run dev 실행 중이어야 함)
# main.js가 업데이트됨

# 3. hot-reload가 자동 감지 → 플러그인 리로드 (0.75초 내)

# 4. Obsidian에서 즉시 확인
```

### 타입 수정 (인터페이스 변경)

```bash
# 1. 코드 수정
vim src/settings.ts

# 2. 타입체크
npm run typecheck  # 0 error 확인 필수

# 3. 빌드
npm run build

# 4. 린트
npm run lint       # 0 error 확인 필수

# 5. Obsidian에서 확인
```

### 중요 변경 (새 모듈/의존성)

```bash
# 1. npm 의존성 추가
npm install some-package

# 2. esbuild.config.mjs에 external 추가 (필요시)
# Obsidian이 제공하는 패키지는 external로 지정

# 3. 타입체크 + 빌드 + 린트
npm run typecheck && npm run build && npm run lint

# 4. 테스트 후 커밋
```

---

## 5. 새로운 기능 추가하기

### 5.1 새 LLM Provider 추가

**파일:** `src/llm/providers.ts`

```typescript
class NewProvider implements LLMProvider {
  async chat(messages, temperature) { /* ... */ }
  async streamChat(messages, onChunk, temperature) { /* ... */ }
}
```

**연동:**
1. `createProvider()`에 case 추가
2. `settings.ts`의 `SuperpowerInsideSettings`에 필드 추가
3. `DEFAULT_SETTINGS`에 기본값 추가
4. `SuperpowerInsideSettingTab.display()`에 UI 추가

### 5.2 새 RAG 저장소 백엔드 추가

**파일:** `src/rag/store.ts`

```typescript
export class NewVectorStore implements VectorStore {
  async add(entries) { /* ... */ }
  async query(vector, topK) { /* ... */ }
  async clear() { /* ... */ }
  async persist() { /* ... */ }
}
```

**연동:** `main.ts initRAG()`에서 `JsonFileVectorStore` 대신 사용

## 6. 트러블슈팅

### 빌드 실패

| 에러 | 원인 | 해결 |
|---|---|---|
| `Cannot find module 'obsidian'` | `npm install` 미실행 | `npm install` |
| `as any is not allowed` | ESLint strict 규칙 | 타입 단언 제거, 대안 타입 정의 |
| `async method has no await` | `require-await` 규칙 | `await Promise.resolve()` 추가 또는 async 제거 |

### Obsidian에서 플러그인이 보이지 않음

```bash
# 1. 심링크 확인
ls -la .test-vault/.obsidian/plugins/superpower-inside/
# → repo/로 연결되어야 함 (복사된 디렉토리가 아님!)

# 2. main.js 존재 확인
ls -la .test-vault/.obsidian/plugins/superpower-inside/main.js

# 3. Safe Mode OFF 확인
# Obsidian → Settings → Community plugins → Safe Mode toggle

# 4. 수동 리로드
# Command Palette → "Reload app without saving"
```

### hot-reload 작동 안 함

```bash
# 1. hot-reload 플러그인 활성화 확인

# 2. .hotreload 파일 확인
touch .test-vault/.obsidian/plugins/superpower-inside/.hotreload

# 3. 파일 변경 시간 확인
stat .test-vault/.obsidian/plugins/superpower-inside/main.js
```

### VS Code 디버거 연결 실패

```bash
# 1. 포트 사용 여부 확인
lsof -i :9222

# 2. Obsidian이 디버그 모드로 실행 중인지 확인
ps aux | grep "remote-debugging-port"

# 3. launch.json 설정 확인 (port 9222, type: chrome)
cat .vscode/launch.json
```

### API 호출 실패 (CORS/Network)

```javascript
// DevTools → Network 탭에서 확인
// 또는 console.log 추가:
console.log('API response:', res.status, await res.text());
```

### IndexedDB/Dexie 문제

```javascript
// DevTools → Application → IndexedDB → SuperpowerInsideEmbeddingCache 확인
// 또는:
await Dexie.delete('SuperpowerInsideEmbeddingCache');  // 전체 삭제
```

---

## 7. 릴리스 절차

### 버전 업데이트

```bash
./scripts/bump-version.fish patch   # 또는 minor / major
```

**이 스크립트가 하는 일:**
1. `manifest.json`, `package.json`, `versions.json` 버전 동기화
2. `npm run lint && npm run typecheck && npm run build` 실행
3. git commit + tag 생성 + push

### GitHub Actions 자동 릴리스

태그 푸시 시 `.github/workflows/release.yml`이 실행:
- 버전 일치 검증 (tag == manifest == package)
- 린트/타입체크/빌드
- GitHub Release 생성 + `main.js`/`manifest.json`/`styles.css` 첨부

### 수동 릴리스 (비상시)

```bash
# 1. 버전 업데이트 (수동)
jq '.version = "0.2.0"' manifest.json > manifest.json.tmp && mv manifest.json.tmp manifest.json

# 2. 빌드
npm run build

# 3. 태그
git add manifest.json main.js styles.css
git commit -m "release 0.2.0"
git tag -a "0.2.0" -m "0.2.0"
git push origin main
git push origin "0.2.0"
```

---

## 유용한 DevTools 스니펫

```javascript
// 현재 활성 플러그인 목록
Object.keys(app.plugins.plugins);

// 현재 볼트의 마크다운 파일 수
app.vault.getMarkdownFiles().length;

// 설정 직접 접근 (주의: saveSettings() 호출해야 저장됨)
app.plugins.plugins['superpower-inside'].settings;

// 채팅 뷰 강제 열기
app.workspace.getRightLeaf(false).setViewState({ type: 'superpower-inside-chat' });

// RAG 강제 재인덱싱
const plugin = app.plugins.plugins['superpower-inside'];
await plugin.vaultIndexer?.reindexAll();

// 자동 업데이트는 업데이트 필요 문서가 0건이면 Notice 없이 종료됨
// 수동 `필요 문서 업데이트` 버튼은 0건일 때 비활성화됨

// IndexedDB 초기화
await Dexie.delete('SuperpowerInsideEmbeddingCache');
```

---

*이 문서는 `docs/DEV_SETUP.md`와 함께 읽으세요. `DEV_SETUP.md`는 환경 설정에, 이 문서는 코드 디버깅과 유지보수에 초점을 맞춥니다.*
