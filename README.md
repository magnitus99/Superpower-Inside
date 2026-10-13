# Superpower Inside

[English](#english) | [한국어](#한국어)

[![Obsidian](https://img.shields.io/badge/Obsidian-desktop%20only-7c3aed)](https://obsidian.md/plugins?id=superpower-inside)
[![license](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)
[![price](https://img.shields.io/badge/price-free%20%26%20open%20source-0f766e)](LICENSE)

## English

> **Your next draft starts with what you already know.**

You saved the article. Took the meeting notes. Collected the references. When it's time to write or make a decision, those pieces are still scattered across your vault.

Superpower Inside brings AI research and writing into Obsidian. Ask a question, bring in the notes and documents that matter, and work toward an answer with sources you can open and check.

**Find the decision. Compare the evidence. Write from your own material.**

**[Install in Obsidian](https://obsidian.md/plugins?id=superpower-inside)** · **[Download the latest release](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

Free and open source. Desktop Obsidian **1.11.4 or later**. The plugin has no subscription or signup; your AI provider's account requirements, fees, and usage limits still apply. [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

### From “I wrote that somewhere” to something you can use

| When you need to… | Ask your vault to… |
| --- | --- |
| Pick up a project after a break | Find recorded decisions, open questions, and next actions. |
| Make sense of conflicting research | Compare claims and point to the passages behind them. |
| Start a draft | Build an outline from your reading notes and open documents. |
| Study what you've collected | Explain a topic or make revision questions from selected material. |

You choose the question and review the result. Built-in vault tools read your material; they do not rewrite your notes on their own.

### Bring the right material into the conversation

Use the links you already know. Type `[[` in chat to choose a file or folder, including supported documents such as PDFs. Paste `[[...]]` or `![[...]]` references, or use `@` to bring in your current workspace. The composer previews references and flags missing or unreadable files before you send.

| Reference | What it brings in |
| --- | --- |
| `[[Reading/Article.pdf]]` | A specific document. |
| `[[Projects/Launch/]]` | A folder as the research scope. |
| `@current` | Your active note. |
| `@tabs` | Files open in Obsidian tabs. |
| `@note.md` or `@[Projects/Launch]` | A file or folder. |
| `@#research` | Notes with that tag, including nested tags. |
| `@server` | A connected external tool server. |

> Compare the proposal in [[Projects/Launch/Proposal.pdf]] with the decisions in [[Projects/Launch/]]. What changed, and what still needs a decision? Cite the sources.

No filename in mind? Ask it to search. Keyword and meaning-based retrieval help find relevant passages, while vault tools can read more context and follow note links. Folder and tag references keep the task focused.

### Use the documents beside your notes

Your research doesn't have to be all Markdown. Read and compare text from **PDF, EPUB, DOCX, ODT, PPTX, XLSX, and HWPX**, alongside plain text, code, JSON, and CSV.

PDFs use their text layer when available. Pages that need text recognition can use **local Korean and English OCR**, with page progress shown during extraction. Extracted PDF passages retain page labels so you can return to the relevant part of the document.

OCR quality depends on the scan. Password-protected, oversized, damaged, or low-confidence documents can fail extraction. Standalone images and audio need a text version first.

### Check the answer where it came from

Open a source, copy its link, or insert a cited passage into your active note. Available source locations include file paths, headings, lines, and PDF page labels.

- Inspect the source panel and work log beneath the answer.
- See which passages were checked against the current file and which need review.
- Check research coverage and context limits, including references left out of the model's input.

Source links make claims easier to check. They do not guarantee correctness or mean every file was read.

### Keep working after the first answer

Turn a comparison into an outline, or ask for the unresolved questions behind a summary. Prompt presets cover research, study, meetings, writing, reflection, and technical work. Save recurring instructions in the prompt library and apply them globally or to one conversation.

Need a different direction? **Edit and resend a question** to continue from that point, replacing the later conversation. **Regenerate an answer** and move between its saved versions. When the result is ready, copy it, insert it into your active note, or save it as a new note using the message actions.

### Choose your AI and where your data goes

Connect **ChatGPT browser sign-in, OpenAI API, Claude, Ollama, Ollama Cloud, OpenRouter, or an OpenAI-compatible endpoint**. Test a model and select it in chat. ChatGPT sign-in uses the Codex backend; model access and usage limits depend on your account.

For local meaning-based search, choose **Ternlight** for short English notes or **EmbeddingGemma 300M** for multilingual material. Prepare the model files in settings and let indexing finish. Changing the embedding model rebuilds the index. Keyword search and built-in vault tools can be used without an embedding index.

**Local search and local PDF OCR run on your device.** Remote chat and optional remote embeddings can send material to the provider you choose. If chat content must also stay on your machine, use a local chat provider and check any external tools you enable.

API keys and ChatGPT credentials are held in **Obsidian's secret storage on this device**, separately from vault-synced plugin settings. Set them up on each device where you use the plugin.

### Reach beyond the vault when the task calls for it

Connect **local MCP tools** for outside information and workflows. Trusted tools can run automatically; tools that require approval wait for you. Mentioning only an external server skips automatic vault search for that turn. Add a vault reference when you want both.

Writing a query or template for another Obsidian plugin? Enable **Answers informed by installed plugins**, connect **Context7 MCP**, and name an active plugin in your question. Its documentation can inform the answer. Check your installed version, settings, and execution results separately.

### Start with one real question

1. Install and enable **Superpower Inside** in Obsidian's **Community plugins**.
2. Add an AI connection in settings, test a model, and select it in chat.
3. Open the chat sidebar, choose a note or document, and ask for a result you need.

> **Project:** “Use @current to list the decisions and unresolved questions. Show the evidence for each.”
>
> **Research:** “Compare the arguments in @#research. Where do the sources agree, and where do they disagree?”
>
> **Writing:** “Turn @tabs into an outline for a short article. Cite the notes behind each section.”

The examples above are illustrative. Use your own files, folders, and tags.

<details>
<summary><strong>Connection and installation details</strong></summary>

- **ChatGPT:** add an **OpenAI ChatGPT (OAuth)** connection and choose **Sign in with ChatGPT**. Finish browser sign-in, fetch or add an available model, and run its generation test. Embeddings use a separate connection, such as a built-in local model.
- **API key:** choose **OpenAI API** for an OpenAI API key, or the matching provider for another service.
- **Manual installation:** download all shipped runtime assets from the [latest GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest) into `.obsidian/plugins/superpower-inside/`, then reload and enable the plugin. In addition to `main.js`, `manifest.json`, and `styles.css`, include the shipped WASM and worker/runtime files; document extraction and local embeddings need them.
- **MCP:** open **External tools → Server setup → Advanced JSON editor**. Use a top-level `mcpServers` object with named entries containing `command`, optional `args`, and optional string-valued `env`. Local stdio servers are supported; remote HTTP/SSE configurations are not. Applying the editor replaces the server list, so preserve existing entries.

</details>

<details>
<summary><strong>Data controls and practical limits</strong></summary>

- Exclude a note with `superpower-inside-exclude: true` in top-level YAML or the document exclusion command. Path exclusions and sensitive-file safeguards also apply. Extension exclusions govern search and indexing; explicitly referencing a supported file can still read it, subject to the other safeguards and size limits.
- Search indexes and the PDF OCR cache remain in this vault's local browser storage. Chat messages, selected passages, and tool results may be sent to the providers or tools you configure.
- Meaning-based search requires ready model files and an index. Document extraction reads text; it does not promise to preserve the original layout, every table, or every visual.
- AI can miss evidence or make mistakes. General knowledge and new drafts may have no vault source. Review important claims against the originals.
- Responses are buffered rather than displayed token by token. Stopping a run may not cancel inference already running at the provider.
- Mobile Obsidian is not supported.

</details>

**You already have the material. [Bring your next question to it.](https://obsidian.md/plugins?id=superpower-inside)**

---

## 한국어

> **다음 글의 시작은, 이미 쌓아 둔 기록 안에 있습니다.**

읽을 자료를 저장하고, 회의 내용을 적고, 참고 문헌을 모았습니다. 그런데 글을 쓰거나 결정을 내려야 할 때면 필요한 내용은 여전히 볼트 여기저기에 흩어져 있습니다.

Superpower Inside는 Obsidian 안에서 노트를 찾아 읽고, 비교하고, 글로 만드는 AI 플러그인입니다. 질문에 필요한 노트와 문서를 연결하고, 답변의 근거를 원문에서 직접 확인하며 다음 작업을 이어가세요.

**지난 결정을 찾고. 근거를 비교하고. 내 자료로 글을 쓰세요.**

**[Obsidian에서 설치](https://obsidian.md/plugins?id=superpower-inside)** · **[최신 릴리스 다운로드](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

무료·오픈소스이며, **Obsidian 1.11.4 이상 데스크톱 버전**에서 사용할 수 있습니다. 플러그인 구독료나 회원가입은 없으며, 선택한 AI 제공자의 계정·요금·사용 한도는 별도입니다. [MIT 라이선스](LICENSE) · [서드파티 고지](THIRD_PARTY_NOTICES.md).

### “어딘가에 적었는데”에서, 바로 쓸 수 있는 결과물로

| 이런 순간에 | 볼트에 이렇게 물어보세요 |
| --- | --- |
| 한동안 멈춘 프로젝트를 다시 맡았을 때 | 기록된 결정·미해결 질문·다음 행동을 찾아줘. |
| 자료마다 주장과 결론이 다를 때 | 주장을 비교하고 각각의 근거 구간을 보여줘. |
| 초안을 어디서 시작할지 막막할 때 | 독서 노트와 열린 문서로 개요를 만들어줘. |
| 모아 둔 자료로 공부하고 싶을 때 | 선택한 자료로 개념을 설명하거나 복습 질문을 만들어줘. |

질문을 고르고 결과를 검토하는 사람은 사용자입니다. 내장 볼트 도구는 자료를 읽으며, 스스로 노트를 고쳐 쓰지 않습니다.

### 필요한 자료를 대화에 바로 연결하세요

익숙한 링크 문법을 그대로 쓰세요. 채팅에서 `[[`를 입력하면 PDF 등 지원 문서를 포함한 파일·폴더를 선택할 수 있습니다. `[[...]]`·`![[...]]` 참조를 붙여 넣거나, `@`로 현재 작업을 가져오세요. 입력창은 참조를 미리 보여주고, 없거나 읽을 수 없는 파일을 전송 전에 표시합니다.

| 참조 | 가져오는 자료 |
| --- | --- |
| `[[Reading/Article.pdf]]` | 지정한 문서 하나. |
| `[[Projects/Launch/]]` | 조사 범위로 지정한 폴더. |
| `@current` | 현재 활성 노트. |
| `@tabs` | Obsidian 탭에 열린 파일. |
| `@note.md` 또는 `@[Projects/Launch]` | 지정한 파일이나 폴더. |
| `@#research` | 해당 태그와 하위 태그가 붙은 노트. |
| `@server` | 연결한 외부 도구 서버. |

> [[Projects/Launch/Proposal.pdf]]의 제안과 [[Projects/Launch/]]에 기록된 결정을 비교해줘. 무엇이 바뀌었고, 어떤 결정이 아직 필요해? 출처도 달아줘.

파일명이 생각나지 않아도 질문하세요. 키워드·의미 검색으로 관련 구간을 찾고, 볼트 도구로 앞뒤 내용을 읽거나 노트 링크를 따라갈 수 있습니다. 폴더·태그를 지정하면 원하는 범위에 집중할 수 있습니다.

### 노트 옆에 모아 둔 문서도 활용하세요

자료를 모두 Markdown으로 옮길 필요는 없습니다. **PDF·EPUB·DOCX·ODT·PPTX·XLSX·HWPX**의 본문을 읽고, 일반 텍스트·코드·JSON·CSV와 함께 비교할 수 있습니다.

PDF는 텍스트가 있으면 그 본문을 읽습니다. 문자 인식이 필요한 페이지에는 **기기 안에서 실행하는 한국어·영어 OCR**을 사용할 수 있으며, 추출 중에는 페이지 진행 상황이 표시됩니다. 추출한 PDF 구간에는 페이지 라벨이 남아 문서의 해당 부분으로 돌아가 확인할 수 있습니다.

OCR 품질은 스캔 상태에 따라 달라집니다. 암호화·크기 초과·손상·낮은 인식 신뢰도 등의 이유로 본문 추출이 실패할 수 있습니다. 별도 이미지 파일과 음성은 먼저 텍스트로 준비하세요.

### 답변이 나온 자리에 돌아가 확인하세요

답변을 읽다가 근거가 궁금해지면 출처를 여세요. 링크를 복사하거나, 출처 구간을 활성 노트에 삽입할 수도 있습니다. 자료에 따라 파일 경로·제목·줄 위치·PDF 페이지 라벨을 확인할 수 있습니다.

- 답변 아래의 출처 패널과 작업 기록을 펼쳐보세요.
- 현재 파일과 대조한 구간과 추가 확인이 필요한 자료를 구분하세요.
- 조사 범위와 컨텍스트 한도, 모델 입력에서 빠진 참조를 확인하세요.

출처 링크는 주장을 확인하는 데 도움을 줍니다. 답변의 정확성을 보장하거나 모든 파일을 읽었다는 뜻은 아닙니다.

### 첫 답변에서 다음 작업으로 이어가세요

비교 결과로 글의 개요를 만들고, 요약에서 빠진 질문을 찾아보세요. 연구·학습·회의·글쓰기·회고·기술 작업용 프롬프트 프리셋을 사용할 수 있습니다. 반복하는 요구는 프롬프트 보관함에 저장해 전체 기본값이나 대화 하나에 적용하세요.

방향을 바꾸고 싶다면 **질문을 수정해 다시 보내세요.** 해당 지점 이후의 대화를 교체하고 이어갑니다. **답변을 다시 생성한 뒤 저장된 버전 사이를 이동**할 수도 있습니다. 결과가 준비되면 메시지 메뉴에서 복사하거나, 활성 노트에 삽입하거나, 새 노트로 저장하세요.

### AI와 데이터가 오갈 곳을 선택하세요

**ChatGPT 브라우저 로그인·OpenAI API·Claude·Ollama·Ollama Cloud·OpenRouter·OpenAI 호환 서버**를 연결할 수 있습니다. 모델을 테스트하고 채팅에서 선택하세요. ChatGPT 로그인은 Codex 서버를 사용하며, 모델 접근 권한과 사용 한도는 계정에 따라 달라집니다.

로컬 의미 검색에는 짧은 영어 노트용 **Ternlight**, 다국어 자료용 **EmbeddingGemma 300M**을 선택할 수 있습니다. 설정에서 모델 파일을 준비하고 인덱싱을 마치세요. 임베딩 모델을 바꾸면 인덱스를 다시 만듭니다. 키워드 검색과 내장 볼트 도구는 임베딩 인덱스 없이 사용할 수 있습니다.

**로컬 검색과 PDF OCR은 내 기기에서 실행됩니다.** 원격 채팅과 선택한 원격 임베딩은 자료를 제공자에게 보낼 수 있습니다. 채팅 내용도 기기 안에 두려면 로컬 채팅 제공자를 사용하고, 활성화한 외부 도구도 확인하세요.

API 키와 ChatGPT 자격 증명은 볼트와 동기화되는 플러그인 설정과 분리해 **이 기기의 Obsidian 보안 저장소**에 보관합니다. 플러그인을 사용하는 기기마다 설정하세요.

### 노트 밖의 정보가 필요할 때는 도구를 연결하세요

**로컬 MCP 도구**로 외부 정보와 작업 흐름을 연결할 수 있습니다. 신뢰한 도구는 자동 실행할 수 있고, 승인이 필요한 도구는 기다립니다. 외부 서버만 멘션하면 그 질문의 볼트 자동 검색을 건너뜁니다. 볼트 근거도 필요하면 노트 등의 참조를 함께 넣으세요.

다른 Obsidian 플러그인의 쿼리나 템플릿을 작성하나요? **설치된 플러그인에 맞춘 답변**을 켜고 **Context7 MCP**를 연결한 뒤, 질문에 활성 플러그인 이름을 적으세요. 해당 문서를 답변에 활용할 수 있습니다. 설치 버전·내 설정·실행 결과는 별도로 확인하세요.

### 지금 필요한 질문 하나로 시작하세요

1. Obsidian **커뮤니티 플러그인**에서 **Superpower Inside**를 설치하고 활성화하세요.
2. 설정에서 AI를 연결하고 모델을 테스트한 뒤 채팅에서 선택하세요.
3. 채팅 사이드바를 열고 노트나 문서를 골라 필요한 결과를 요청하세요.

> **프로젝트:** “@current의 결정과 미해결 질문을 정리해줘. 항목마다 근거를 보여줘.”
>
> **연구:** “@#research의 논거를 비교해줘. 자료들이 어디서 동의하고 어디서 갈려?”
>
> **글쓰기:** “@tabs로 짧은 글의 개요를 만들어줘. 각 절의 근거 노트를 달아줘.”

위 예시는 사용법을 보여주기 위한 가상 예시입니다. 내 볼트의 파일·폴더·태그로 바꿔 사용하세요.

<details>
<summary><strong>연결·설치 세부 안내</strong></summary>

- **ChatGPT:** **OpenAI ChatGPT (OAuth)** 연결을 추가하고 **ChatGPT로 로그인**을 누르세요. 브라우저 로그인을 마친 뒤 사용 가능한 모델을 가져오거나 추가하고 생성 테스트를 실행하세요. 임베딩에는 내장 로컬 모델 등 별도 연결을 사용합니다.
- **API 키:** OpenAI API 키는 **OpenAI API**를, 다른 서비스의 키는 해당 제공자를 선택하세요.
- **수동 설치:** [최신 GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest)의 런타임 자산 전체를 `.obsidian/plugins/superpower-inside/`에 넣은 뒤 플러그인을 다시 불러와 활성화하세요. `main.js`·`manifest.json`·`styles.css` 외에 배포된 WASM·worker·런타임 파일도 필요합니다. 문서 추출과 로컬 임베딩에서 사용합니다.
- **MCP:** **외부 도구 → 서버 설정 → 고급 JSON 편집**에서 최상위 `mcpServers` 안에 서버별 `command`, 선택 항목 `args`, 문자열 값의 `env`를 넣으세요. 로컬 stdio 서버를 지원하며 원격 HTTP/SSE 설정은 지원하지 않습니다. 적용하면 서버 목록 전체가 교체되므로 기존 항목을 유지하세요.

</details>

<details>
<summary><strong>데이터 제어와 사용 한계</strong></summary>

- 노트 맨 위 YAML에 `superpower-inside-exclude: true`를 넣거나 문서 제외 명령을 사용하세요. 경로 제외와 민감 파일 보호도 적용됩니다. 확장자 제외는 검색·인덱싱에 적용되며, 지원 파일을 직접 참조하면 다른 보호 규칙과 크기 제한을 지키는 범위에서 읽을 수 있습니다.
- 검색 인덱스와 PDF OCR 캐시는 해당 볼트의 로컬 브라우저 저장소에 남습니다. 채팅 메시지·선택한 구간·도구 결과는 설정한 제공자나 도구로 전송될 수 있습니다.
- 의미 검색은 모델 파일과 인덱스가 준비되어야 합니다. 문서 추출은 본문 텍스트를 읽으며, 원래 배치·모든 표·모든 시각 자료의 보존을 보장하지 않습니다.
- AI는 근거를 놓치거나 틀릴 수 있습니다. 일반 지식과 새 초안에는 볼트 출처가 없을 수 있습니다. 중요한 주장은 원문과 대조하세요.
- 응답은 토큰별 실시간 표시가 아니라 모아서 수신합니다. 중단해도 제공자에서 이미 실행 중인 추론은 계속될 수 있습니다.
- 모바일 Obsidian은 지원하지 않습니다.

</details>

**자료는 이미 쌓여 있습니다. [오늘 필요한 질문을 던져보세요.](https://obsidian.md/plugins?id=superpower-inside)**
