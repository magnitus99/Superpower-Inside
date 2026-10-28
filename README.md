# Superpower Inside

Bring a question to the notes and documents you already keep in Obsidian. Superpower Inside helps you find relevant material, understand it with sources, and carry the result into your next piece of work.

[English](#english) | [한국어](#한국어)

[![Obsidian](https://img.shields.io/badge/Obsidian-desktop%20only-7c3aed)](https://obsidian.md/plugins?id=superpower-inside)
[![license](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

![Superpower Inside — From your material to your next step](media/superpower-inside-community-thumbnail.png)

## English

### From your material to your next step

Pick up a project, compare research, or start a draft. Ask for what you need without remembering every filename. Superpower Inside finds relevant passages, connects the sources to the answer, and lets you continue the work in the same conversation.

**[Install in Obsidian](https://obsidian.md/plugins?id=superpower-inside)** · **[Download the latest release](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

Free and open source for **desktop Obsidian 1.11.4 or later**. No plugin subscription or plugin account is required. Your chosen AI provider may require an account and charge for usage or impose limits. [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

https://github.com/user-attachments/assets/b737eff2-d3e1-40a3-8c54-eaf0e714751c

### Start with the result you need

1. Install and enable **Superpower Inside** in Obsidian's **Community plugins**.
2. Add an AI connection in the plugin settings, test a model, and select it in chat.
3. Open the chat sidebar and describe what you need. Include a source if you want to focus on it.

| Your task | A starting question |
| --- | --- |
| Return to a project | What decisions have we recorded, and what remains unresolved? Show the sources. |
| Compare research | Where do these sources agree or disagree, and what evidence supports each claim? |
| Write from your reading | Use @tabs to outline an article. Link the material behind each section. |
| Study a topic | Explain the ideas in @current, then make questions I can use to review them. |

### Let the conversation connect the material

Keyword and meaning-based search help find relevant passages. Built-in vault tools can read surrounding text and follow note links, so you can ask a follow-up without copying each passage into chat yourself. These tools read your vault; saving or inserting a result is an action you choose.

When vault search is active, indexed documents in the allowed scope are reviewed before an answer is generated. Search ranks determine the reading order; they do not remove the remaining indexed documents. Each passage receives an acceptance or rejection decision, and accepted quotations are checked against the original text. The answer cites those sources. If review cannot finish, the plugin reports the failure instead of filling the answer with general knowledge.

Name a file, folder, or tag when scope matters. Type `[[` to choose one, paste an existing link, or use `@` to bring in your workspace. Before you send, the input checks for missing or unreadable references.

<details>
<summary><strong>Ways to reference your material</strong></summary>

| Reference | What it brings in |
| --- | --- |
| `[[Reading/Article.pdf]]` | A specific supported document. |
| `[[Projects/Launch/]]` | A folder as the research scope. |
| `@current` | Your active note. |
| `@tabs` | Files open in Obsidian tabs. |
| `@note.md` or `@[Projects/Launch]` | A file or folder. |
| `@#research` | Notes with that tag, including nested tags. |
| `@server` | A connected external tool server. |

</details>

Your material can include **PDF, EPUB, DOCX, ODT, PPTX, XLSX, and HWPX**, alongside Markdown, plain text, code, JSON, and CSV. You do not have to turn each document into a note before using its text.

Large XLSX spreadsheets are read in the background, one file at a time. If a document exceeds the processing budget or cannot be read completely, you see an error and its partial text is not used.

PDFs use their text layer when available. For scans, on-device OCR reads Korean and English; citations keep page labels so you can open the original.

Extraction keeps document text, not the full layout, tables, or visuals. Scan quality matters. Encrypted, oversized, damaged, or low-confidence documents can fail; convert standalone images or audio to text first.

### Check a source when it matters

Open a citation to check the source. It may point to a path, heading, line, or PDF page. Copy the link or insert the cited passage into your note.

Expand the source panel or work log to see checked passages, sources needing review, and material left out by processing limits. AI can miss evidence or make mistakes; check important claims against the originals.

### Carry the result into the next task

Turn a comparison into an outline, or a project summary into next steps, with a follow-up question.

Copy a useful answer or save it to a note. Edit and resend a question to replace the later conversation. You can also regenerate responses or switch between saved versions.

For recurring work, use presets for research, study, meetings, writing, reflection, and technical tasks. Save your own instructions in the prompt library and apply them as a global default or to one conversation.

### Choose the connection that fits your work

Connect **ChatGPT browser sign-in, Google Gemini, OpenCode, Claude, Ollama, OpenRouter, an OpenAI API key, or a custom endpoint**, then pick a model. ChatGPT sign-in is the default; OpenAI API keys are marked legacy. OpenCode and custom endpoints can serve models over the Responses, Chat Completions, Anthropic Messages, or native Gemini API, and each model is routed to a format it supports. Google Gemini supports a Google account sign-in or a Google AI Studio API key. ChatGPT browser sign-in and Gemini Google account sign-in use their subscription endpoints; other connections let you change the API root for a proxy or compatible server. Ollama uses its native API; change the endpoint URL to use a local server or Ollama Cloud. Access and limits depend on your account.

Search and chat have separate data choices. **Local search and PDF OCR run on your device.** Remote chat and remote embeddings can send material to the chosen provider. To keep chat content on your device too, use a local chat provider and check the external tools you enable.

API keys and ChatGPT credentials are stored in **Obsidian's secret storage on this device**, separately from vault-synced plugin settings. Configure credentials on each device where you use the plugin.

<details>
<summary><strong>Local search and data controls</strong></summary>

- **Meaning-based search:** choose Ternlight for short English notes or EmbeddingGemma 300M for multilingual material. Prepare the model files in settings and let indexing finish. Changing the embedding model rebuilds the index. Keyword search and built-in vault tools are available without an embedding index.
- **Local storage:** search indexes and the PDF OCR cache stay in the vault's local browser storage. Indexed-vault review evaluates the allowed index on this device, re-checks the selected passages against the current files within a bounded review budget, and sends the verified evidence excerpts and review counts to the selected chat provider instead of the full text of every allowed document. A large collection takes more time and provider usage. Chat messages, referenced passages, and tool results may also be sent to configured providers or tools.
- **Exclusions:** use `superpower-inside-exclude: true` in a note's top-level YAML or the document exclusion command. Path exclusions and sensitive-file safeguards also apply. Extension exclusions affect search and indexing; a direct reference can still read a supported file within the other safeguards and size limits.
- **Responses and stopping:** indexed-vault answers appear after review and source checks finish. Other chat answers can stream. Stopping a run closes the active connection; the provider may continue inference after disconnection.
- **Answer coverage:** review covers indexed documents in the allowed scope, including passages the model rejects as unrelated. Excluded and unindexed files are outside that review. Checking quotations and source identifiers does not guarantee that the model interpreted the evidence correctly.

</details>

<details>
<summary><strong>Connection and manual installation</strong></summary>

- **ChatGPT:** choose **ChatGPT — browser OAuth** (the default), then **Sign in with ChatGPT**. Finish browser sign-in, fetch or add an available model, and run its generation test. Use a separate embedding connection, such as a built-in local model, for meaning-based search.
- **Google Gemini:** choose **Google Gemini**, then use a Google AI Studio API key or **Google account sign-in**. Google account sign-in uses Cloud Code Assist and may require a linked Google Cloud project.
- **OpenCode:** choose **OpenCode** and enter your Console API key. The default endpoint is `https://opencode.ai/inference`; for the Go plan use `https://opencode.ai/inference/go`. Pick a default API format if you want, but imported models can use their own supported format.
- **Ollama:** choose **Ollama** and set the endpoint to `http://localhost:11434` or `https://ollama.com`. Remote endpoints need an API key.
- **API keys:** **OpenAI API** is the legacy Chat Completions connection. For Command Code or another gateway, choose **Custom endpoint**, enter its API root, and select the API format.
- **Manual installation:** put all runtime files from the [latest release](https://github.com/magnitus99/Superpower-Inside/releases/latest) in `.obsidian/plugins/superpower-inside/`, then reload and enable the plugin. Keep `THIRD_PARTY_NOTICES.md` with them. Missing PDF processing files are downloaded automatically when needed, which requires internet access.

</details>

<details>
<summary><strong>External tools and other Obsidian plugins</strong></summary>

Need outside information or tools? Connect an **MCP** server. Trusted tools can run automatically; others may wait for approval. Mentioning an external server alone skips vault search. Add a vault reference to search both.

In **External tools → Server setup → Advanced JSON editor**, put entries under `mcpServers`. Local stdio uses Claude Desktop's `command`, optional `args`, and string `env` fields. Remote servers use `url` and `transport: "http"` or `"sse"`; Claude Desktop configures its remote servers through connectors. Store bearer tokens in Obsidian Secret Storage and reference the name with `authTokenSecret`. Applying the editor replaces the list, so keep entries you still need.

For queries or templates involving another Obsidian plugin, enable **Answers informed by installed plugins**, connect **Context7 MCP**, and name an active plugin in your question. Its documentation can inform the answer. Check your installed version, settings, and execution results separately.

</details>

---

## 한국어

### 내 자료에서, 다음 작업으로

멈췄던 프로젝트를 이어 가거나, 연구 자료를 비교하거나, 글의 초안을 시작하세요. 파일명을 모두 기억하지 않아도 필요한 결과를 이야기하면 됩니다. Superpower Inside는 Obsidian에서 관련 구간을 찾고 답변에 근거를 연결하며, 같은 대화에서 다음 작업을 이어 가도록 돕는 AI 플러그인입니다.

**[Obsidian에서 설치](https://obsidian.md/plugins?id=superpower-inside)** · **[최신 릴리스 다운로드](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

**Obsidian 1.11.4 이상 데스크톱 버전**에서 사용하는 무료·오픈소스 플러그인입니다. 플러그인 구독료나 별도 플러그인 계정은 필요하지 않습니다. 선택한 AI 제공자의 계정·요금·사용 한도는 별도입니다. [MIT 라이선스](LICENSE) · [서드파티 고지](THIRD_PARTY_NOTICES.md).

https://github.com/user-attachments/assets/c73dac24-3e09-4ec2-9c82-1d71b8d182a6

### 필요한 결과로 시작하세요

1. Obsidian **커뮤니티 플러그인**에서 **Superpower Inside**를 설치하고 활성화하세요.
2. 플러그인 설정에서 AI를 연결하고 모델을 테스트한 뒤 채팅에서 선택하세요.
3. 채팅 사이드바를 열고 필요한 결과를 이야기하세요. 특정 자료에 집중하려면 참조를 함께 넣으세요.

| 하려는 작업 | 시작할 질문 |
| --- | --- |
| 멈췄던 프로젝트에 복귀하기 | 기록된 결정과 아직 해결하지 못한 질문을 정리해줘. 근거도 보여줘. |
| 연구 자료 비교하기 | 자료들이 어디서 동의하고 어디서 갈려? 각 주장을 뒷받침하는 근거를 보여줘. |
| 읽은 자료로 글쓰기 | @tabs로 글의 개요를 만들어줘. 각 절에 활용한 자료를 연결해줘. |
| 모아 둔 자료로 공부하기 | @current의 개념을 설명하고, 복습할 질문을 만들어줘. |

### 자료를 연결하는 일은 대화 안에서

키워드·의미 검색으로 관련 구간을 찾고, 내장 볼트 도구로 앞뒤 내용을 읽거나 노트 링크를 따라갈 수 있습니다. 구간마다 직접 복사해 붙이지 않고 후속 질문을 이어 가세요. 내장 도구는 볼트를 읽으며, 결과를 저장하거나 삽입하는 작업은 사용자가 선택합니다.

볼트 검색이 활성화된 질문은 허용 범위의 색인 문서를 검토한 뒤 답변합니다. 검색 순위는 먼저 읽을 순서에만 쓰며, 나머지 색인 문서를 검토에서 제외하지 않습니다. 각 원문 구간을 채택하거나 제외한 이유를 판단하고, 채택한 인용은 원문과 대조합니다. 답변에는 해당 출처를 연결합니다. 검토를 끝내지 못하면 일반 지식으로 답을 채우지 않고 실패를 알립니다.

범위가 중요하면 파일·폴더·태그를 지정하세요. `[[`를 입력해 참조를 고르거나 기존 링크를 붙여 넣어도 됩니다. `@`는 현재 작업을 가져옵니다. 전송 전에 입력창에서 참조를 확인하세요.

<details>
<summary><strong>자료를 참조하는 방법</strong></summary>

| 참조 | 가져오는 자료 |
| --- | --- |
| `[[Reading/Article.pdf]]` | 지정한 지원 문서 하나. |
| `[[Projects/Launch/]]` | 조사 범위로 지정한 폴더. |
| `@current` | 현재 활성 노트. |
| `@tabs` | Obsidian 탭에 열린 파일. |
| `@note.md` 또는 `@[Projects/Launch]` | 지정한 파일이나 폴더. |
| `@#research` | 해당 태그와 하위 태그가 붙은 노트. |
| `@server` | 연결한 외부 도구 서버. |

</details>

Markdown뿐 아니라 **PDF·EPUB·DOCX·ODT·PPTX·XLSX·HWPX**, 일반 텍스트·코드·JSON·CSV도 활용할 수 있습니다. 문서마다 노트로 옮기지 않아도 본문을 읽어 비교할 수 있습니다.

큰 XLSX 문서는 백그라운드에서 한 파일씩 읽습니다. 처리 예산을 초과하거나 문서 전체를 읽지 못하면 오류를 표시하고 일부 본문을 사용하지 않습니다.

PDF 본문이 있으면 그것을 사용합니다. 스캔은 내 기기에서 한국어·영어 OCR로 읽습니다. 근거에 페이지가 표시되므로 원문을 찾을 수 있습니다.

문서 추출은 텍스트 중심입니다. 표·배치·이미지를 그대로 보존하지 않습니다. OCR은 스캔 상태에 따라 달라집니다. 암호화되거나 손상된 파일, 크기 제한을 넘는 파일은 실패할 수 있습니다. 이미지나 음성은 먼저 텍스트로 준비하세요.

### 확인이 필요한 순간에, 근거로 돌아가세요

출처 패널에서 원문을 확인하세요. 파일 경로·제목·줄 또는 페이지를 가리킬 수 있습니다. 링크를 복사하거나 근거 구간을 노트에 넣으세요.

출처 패널이나 작업 기록을 펼치면 확인된 구간, 검토가 필요한 자료, 처리 한도로 빠진 자료를 볼 수 있습니다. AI는 근거를 놓치거나 틀릴 수 있으므로 중요한 주장은 원문과 대조하세요.

### 나온 결과를 다음 작업에 쓰세요

후속 질문으로 비교 결과를 개요로 만들거나, 프로젝트 요약에서 다음 행동을 정리해 보세요.

답변을 복사하거나 노트에 저장하세요. 질문을 다시 보내면 그 뒤의 대화를 바꿀 수 있습니다. 답변 재생성과 저장한 버전 사이의 이동도 가능합니다.

반복하는 작업에는 연구·학습·회의·글쓰기·회고·기술 작업용 프리셋을 사용하세요. 자주 쓰는 요구는 프롬프트 보관함에 저장해 전체 기본값이나 대화 하나에 적용할 수 있습니다.

### 내 작업에 맞는 연결을 선택하세요

**ChatGPT 브라우저 로그인·Google Gemini·OpenCode·Claude·Ollama·OpenRouter·OpenAI API 키·사용자 지정 엔드포인트**를 연결하고 모델을 선택하세요. ChatGPT 브라우저 로그인이 기본이며, OpenAI API 키는 레거시로 표시됩니다. OpenCode와 사용자 지정 엔드포인트는 Responses·Chat Completions·Anthropic Messages·Gemini 네이티브 형식을 지원하고 모델별로 지원 형식을 자동 선택합니다. Google Gemini는 Google 계정 로그인 또는 Google AI Studio API 키를 지원합니다. ChatGPT 브라우저 로그인과 Gemini Google 계정 로그인은 구독 endpoint를 사용하고, 나머지 연결은 프록시나 호환 서버를 위해 API 루트를 바꿀 수 있습니다. Ollama는 네이티브 API를 사용하며 endpoint를 바꿔 로컬 서버나 Ollama Cloud에 연결할 수 있습니다. 모델 접근 권한과 사용 한도는 계정에 따라 다릅니다.

검색과 채팅의 데이터 처리 위치는 각각 선택합니다. **로컬 검색과 PDF OCR은 내 기기에서 실행됩니다.** 원격 채팅과 원격 임베딩은 선택한 제공자에게 자료를 보낼 수 있습니다. 채팅 내용도 기기 안에 두려면 로컬 채팅 제공자를 사용하고, 활성화한 외부 도구도 확인하세요.

API 키와 ChatGPT 자격 증명은 볼트와 동기화되는 플러그인 설정과 분리해 **이 기기의 Obsidian 보안 저장소**에 보관합니다. 사용하는 기기마다 자격 증명을 설정하세요.

<details>
<summary><strong>로컬 검색과 데이터 제어</strong></summary>

- **의미 검색:** 짧은 영어 노트에는 Ternlight, 다국어 자료에는 EmbeddingGemma 300M을 선택할 수 있습니다. 설정에서 모델 파일을 준비하고 인덱싱을 마치세요. 임베딩 모델을 바꾸면 인덱스를 다시 만듭니다. 키워드 검색과 내장 볼트 도구는 임베딩 인덱스 없이 사용할 수 있습니다.
- **로컬 저장:** 검색 인덱스와 PDF OCR 캐시는 해당 볼트의 로컬 브라우저 저장소에 남습니다. 색인 볼트 검토는 이 기기에서 허용된 색인 범위를 평가하고, 선택된 구절을 검토 예산 안에서 현재 원문과 다시 대조한 뒤 검증된 근거 발췌와 검토 집계를 선택한 채팅 제공자에게 보냅니다. 허용된 모든 문서의 전체 본문을 보내지는 않습니다. 자료가 많으면 시간과 제공자 사용량이 늘어납니다. 채팅 메시지·참조 구간·도구 결과도 설정한 제공자나 도구로 전송될 수 있습니다.
- **자료 제외:** 노트 맨 위 YAML에 `superpower-inside-exclude: true`를 넣거나 문서 제외 명령을 사용하세요. 경로 제외와 민감 파일 보호도 적용됩니다. 확장자 제외는 검색·인덱싱에 적용되며, 지원 파일을 직접 참조하면 다른 보호 규칙과 크기 제한 안에서 읽을 수 있습니다.
- **응답과 중단:** 색인 볼트 답변은 검토와 출처 검사가 끝난 뒤 표시합니다. 다른 채팅 답변은 스트리밍될 수 있습니다. 중단하면 진행 중인 연결을 닫지만, 제공자의 추론은 연결 종료 후에도 계속될 수 있습니다.
- **답변 범위:** 허용 범위의 색인 문서를 검토하며, 모델이 관련 없다고 제외한 구간도 검토에 포함됩니다. 제외한 파일과 색인하지 않은 파일은 검토 범위 밖입니다. 인용 구절과 출처가 존재해도 모델이 근거를 올바르게 해석했다는 보장은 없습니다.

</details>

<details>
<summary><strong>연결과 수동 설치</strong></summary>

- **ChatGPT:** 기본값인 **ChatGPT — 브라우저 OAuth**를 선택하고 **ChatGPT로 로그인**을 누르세요. 브라우저 로그인을 마친 뒤 사용 가능한 모델을 가져오거나 추가하고 생성 테스트를 실행하세요. 의미 검색에는 내장 로컬 모델 등 별도 임베딩 연결을 사용합니다.
- **Google Gemini:** **Google Gemini**를 선택한 뒤 Google AI Studio API 키 또는 **Google 계정 로그인**을 사용하세요. Google 계정 로그인은 Cloud Code Assist를 사용하며 연결된 Google Cloud 프로젝트가 필요할 수 있습니다.
- **OpenCode:** **OpenCode**를 선택하고 Console API 키를 입력하세요. 기본 endpoint는 `https://opencode.ai/inference`이며, Go 플랜은 `https://opencode.ai/inference/go`를 사용합니다. 기본 API 형식을 고를 수 있지만, 가져온 모델은 지원하는 형식을 자동으로 사용합니다.
- **Ollama:** **Ollama**를 선택하고 endpoint를 `http://localhost:11434` 또는 `https://ollama.com`으로 설정하세요. 원격 endpoint에는 API 키가 필요합니다.
- **API 키:** **OpenAI API**는 레거시 Chat Completions 연결입니다. Command Code 같은 게이트웨이는 **사용자 지정 엔드포인트**를 선택하고 API 루트와 API 형식을 입력하세요.
- **수동 설치:** [최신 릴리스](https://github.com/magnitus99/Superpower-Inside/releases/latest)의 런타임 파일 전체를 `.obsidian/plugins/superpower-inside/`에 넣고 플러그인을 다시 불러와 활성화하세요. `THIRD_PARTY_NOTICES.md`도 함께 보관하세요. PDF 처리 파일이 없으면 필요할 때 자동으로 내려받으며, 이때 인터넷 연결이 필요합니다.

</details>

<details>
<summary><strong>외부 도구와 다른 Obsidian 플러그인</strong></summary>

볼트 밖의 정보나 도구가 필요하세요? **MCP** 서버를 연결하세요. 신뢰한 도구는 자동 실행할 수 있고, 다른 도구는 승인을 기다릴 수 있습니다. 외부 서버 이름만 언급하면 볼트 검색을 건너뜁니다. 둘 다 찾으려면 볼트 참조도 넣으세요.

**외부 도구 → 서버 설정 → 고급 JSON 편집**의 `mcpServers` 아래에 서버를 적으세요. 로컬 stdio는 Claude Desktop처럼 `command`, 선택 항목 `args`, 문자열 `env`를 사용합니다. 원격 Streamable HTTP와 SSE에는 `url`과 `transport`를 지정하세요. Claude Desktop에서는 원격 서버를 커넥터로 설정합니다. Bearer 토큰은 Obsidian 보안 저장소에 넣고 `authTokenSecret`으로 이름을 참조하세요. 적용하면 목록이 바뀌니 계속 쓸 항목도 남겨 두세요.

다른 Obsidian 플러그인의 쿼리나 템플릿을 작성하려면 **설치된 플러그인에 맞춘 답변**을 켜고 **Context7 MCP**를 연결한 뒤 질문에 활성 플러그인 이름을 적으세요. 해당 문서를 답변에 활용할 수 있습니다. 설치 버전·내 설정·실행 결과는 별도로 확인하세요.

</details>
