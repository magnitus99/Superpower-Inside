# Superpower Inside

Superpower Inside is a desktop AI copilot for knowledge work. It adds LLM chat, retrieval-augmented context, MCP tool calls, and source-aware answers to your local vault workflow.

This plugin is **desktop-only**. It uses MCP stdio servers, local Ollama support, and desktop runtime path handling, so mobile clients are not supported.

## Features

- **Sidebar AI chat**: chat with OpenAI, Claude, Ollama, OpenRouter, or a custom OpenAI-compatible provider.
- **RAG over vault notes**: index Markdown notes and attach relevant context to model requests.
- **MCP stdio tools**: connect local Model Context Protocol servers for external tools and workflows.
- **Search through MCP**: web search is available when you configure a search-capable MCP server.
- **Source cards**: review and insert citations from retrieved notes and attached context.
- **AI directives**: run editor commands such as `>AI: summarize this section`.

## Install

### Community plugin directory

1. Open Settings → Community plugins.
2. Search for `Superpower Inside`.
3. Install and enable the plugin.
4. Open the plugin settings and configure your provider keys.

### BRAT beta install

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Choose "Add Beta plugin".
3. Enter `magnitus99/Superpower-Inside`.

### Manual install

1. Download the latest release from [GitHub Releases](https://github.com/magnitus99/Superpower-Inside/releases).
2. Copy `manifest.json`, `main.js`, and `styles.css` into `.obsidian/plugins/superpower-inside/`.
3. Reload community plugins and enable Superpower Inside.

## Security and data access

- API keys are stored in the plugin `data.json` file in plain text by the host app. Do not share or sync that file to untrusted locations.
- Chat messages, selected notes, retrieved RAG chunks, tool arguments, and tool results may be sent to the configured LLM, embedding provider, or MCP server.
- RAG features enumerate Markdown files in the vault to build and refresh the index.
- Citation actions and copy buttons write text to the system clipboard.
- MCP stdio launches local commands that you configure. Only add MCP servers you trust.
- Local Ollama and local MCP servers can run on your machine, but provider settings may still send data over the network.

## Configuration

| Setting | Description |
| --- | --- |
| LLM Provider | OpenAI, Claude, Ollama, OpenRouter, or a custom OpenAI-compatible endpoint |
| API Key | Key for the selected provider |
| Base URL | Custom endpoint for local or compatible providers |
| RAG status | Index status, stale documents, and update controls |
| RAG exclude paths | Folders or files excluded from indexing |
| MCP servers | stdio MCP server definitions |
| Chat save folder | Vault folder where chat sessions are stored |

## Usage

### Open chat

- Click the ribbon chat icon.
- Or run Command Palette → `Open AI Chat`.

### Run an AI directive

Write a directive in the editor:

```markdown
>AI: summarize this paragraph in three bullet points
```

Then run Command Palette → `Execute AI Directive`.

### Reindex vault notes

Run Command Palette → `Reindex Vault for RAG`.

The RAG settings panel shows index status and documents that need updates. When automatic updates are enabled, the plugin indexes only missing or modified documents.

## 한국어 안내

Superpower Inside는 데스크톱 지식 작업을 위한 AI 보조 플러그인입니다. 사이드바 채팅, RAG, MCP 도구 호출, 출처 기반 답변을 로컬 볼트 작업 흐름에 통합합니다.

이 플러그인은 **데스크톱 전용**입니다. MCP stdio, 로컬 Ollama, 데스크톱 런타임 경로 처리를 사용하므로 모바일 클라이언트는 지원하지 않습니다.

### 주요 기능

- **사이드바 AI 채팅**: OpenAI, Claude, Ollama, OpenRouter, 커스텀 OpenAI-compatible provider와 대화합니다.
- **RAG 검색**: 볼트의 Markdown 문서를 인덱싱하고 관련 컨텍스트를 모델 요청에 첨부합니다.
- **MCP stdio 도구**: 로컬 MCP 서버를 연결해 외부 도구와 워크플로를 실행합니다.
- **MCP 기반 검색**: 검색 MCP 서버를 구성하면 웹 검색 결과를 컨텍스트로 사용할 수 있습니다.
- **출처 카드**: 검색된 노트와 첨부 컨텍스트의 출처를 확인하고 삽입합니다.

### 보안과 데이터 접근

- API 키는 플러그인 `data.json`에 평문으로 저장됩니다. 신뢰하지 않는 위치로 공유하거나 동기화하지 마세요.
- 채팅 메시지, 선택된 노트, RAG 청크, 도구 호출 인자와 결과는 설정한 LLM, 임베딩 provider, MCP 서버로 전송될 수 있습니다.
- RAG 기능은 인덱스 생성과 갱신을 위해 볼트의 Markdown 파일 목록을 열람합니다.
- 출처 복사와 메시지 복사 기능은 시스템 클립보드에 텍스트를 씁니다.
- MCP stdio는 사용자가 설정한 로컬 명령을 실행합니다. 신뢰하는 MCP 서버만 추가하세요.

## Development

```fish
npm install
npm run dev
npm run review
npm run build
npm run lint
npm run typecheck
npm run test
```

See [docs/DEV_SETUP.md](docs/DEV_SETUP.md) for local development setup.

## License

MIT
