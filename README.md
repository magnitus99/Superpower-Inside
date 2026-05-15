# Super Obsidian by AI

> Obsidian에 LLM, RAG, MCP, 인터넷 검색, 사이드바 채팅을 통합한 올인원 AI 플러그인입니다.

## 기능

- **사이드바 AI 채팅** — Obsidian 우측 사이드바에서 바로 LLM과 대화
- **RAG (Vault 검색)** — 볼트 내 문서를 임베딩하여 AI가 컨텍스트를 참조하도록 지원
- **MCP 통합** — Model Context Protocol 서버(stdio/SSE) 연결로 외부 도구 사용
- **인터넷 검색** — 웹 검색 결과를 AI 컨텍스트에 주입
- **다중 LLM 지원** — OpenAI, Claude, Ollama(로컬/클라우드), OpenRouter
- **AI 지시어** — 에디터에서 `>AI: 요약해줘` 같은 지시어로 문서 생성/편집

## 설치

### Obsidian 커뮤니티 플러그인 (권장)

1. Obsidian 설정 → 커뮤니티 플러그인 → 검색: `Super Obsidian by AI`
2. 설치 → 활성화
3. 설정 탭에서 API 키 입력

### BRAT (베타 테스트)

1. [BRAT](https://github.com/TfTHacker/obsidian42-brat) 플러그인 설치
2. "Add Beta plugin" → `magnitus99/Super-Obsidian-by-AI`

### 수동 설치

1. [Releases](https://github.com/magnitus99/Super-Obsidian-by-AI/releases)에서 최신 버전 다운로드
2. `.obsidian/plugins/super-obsidian-by-ai/` 폴더에 `manifest.json`, `main.js`, `styles.css` 복사
3. Obsidian에서 플러그인 활성화

## 설정

플러그인 설정 탭에서 다음을 구성합니다:

| 설정 | 설명 |
|------|------|
| **LLM Provider** | OpenAI / Claude / Ollama / OpenRouter 선택 |
| **API Key** | 선택한 provider의 API 키 |
| **Base URL** | 커스텀 엔드포인트 (Ollama 등) |
| **RAG 상태/업데이트** | 인덱스 상태, 업데이트 필요 문서, 자동 업데이트 간격 |
| **RAG 제외 경로** | 인덱싱에서 제외할 폴더/파일 패턴 |
| **MCP 서버** | stdio/SSE transport로 MCP 서버 등록 |
| **채팅 저장 폴더** | 대화를 저장할 볼트 내 폴더 경로 |

> ⚠️ **보안 경고**: API 키는 Obsidian의 `data.json`에 평문으로 저장됩니다. 볼트를 공유하거나 동기화할 때 주의하세요.

## 사용법

### 사이드바 채팅 열기

- 리본 아이콘 (💬) 클릭
- 또는 Command Palette (`Cmd+P`) → `Open AI Chat`

### AI 지시어 (에디터 내)

에디터에 다음과 같이 작성한 뒤 명령어 실행:

```markdown
>AI: 이 문단을 3줄로 요약해줘
```

Command Palette → `Execute AI Directive`

### 볼트 인덱싱

Command Palette → `Reindex Vault for RAG`

설정 → RAG 탭에서 현재 인덱스 상태와 업데이트가 필요한 문서를 확인할 수 있습니다. `필요 문서 업데이트`는 아직 인덱싱되지 않았거나 마지막 인덱싱 이후 수정된 문서만 처리합니다.

자동 업데이트를 켜면 설정한 간격마다 필요한 문서만 인덱싱합니다. 업데이트할 문서가 없을 때는 별도 알림을 띄우지 않습니다.

## 개발

```bash
npm install
npm run dev      # esbuild watch 모드
npm run build    # production 빌드
npm run lint     # ESLint
npm run typecheck # TypeScript 검사
```

자세한 개발 환경 설정은 [docs/DEV_SETUP.md](docs/DEV_SETUP.md)를 참조하세요.

## 라이선스

MIT
