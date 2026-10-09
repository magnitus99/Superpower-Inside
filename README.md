# Superpower Inside

[English](#english) | [한국어](#한국어)

[![Obsidian](https://img.shields.io/badge/Obsidian-desktop%20only-7c3aed)](https://obsidian.md/plugins?id=superpower-inside)
[![license](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)
[![price](https://img.shields.io/badge/price-free%20%26%20open%20source-0f766e)](LICENSE)

## English

> **You already did the reading. Put those notes to work.**

Superpower Inside brings AI research and writing into Obsidian. Ask it to find a past decision, compare your research, or turn scattered notes into a draft—with vault sources you can open and check.

- **Get the decision back.** Ask what changed, why, and where it was recorded.
- **Use what you've learned.** Pull reading notes into an outline, comparison, or study session.
- **Stay with your work.** Reference the current note, open tabs, a folder, or a tag from the chat.

The superpower is inside: your observations, your research, your decisions. Give them a question, and get something you can use next.

**[Install in Obsidian](https://obsidian.md/plugins?id=superpower-inside)** · **[Download a release](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

**Free, open source, desktop only.** The plugin has no subscription or signup; your AI provider may charge or require an account. [Third-party notices](THIRD_PARTY_NOTICES.md).

### Who is it for?

- **Already paying for ChatGPT?** Connect with browser sign-in and use models available to your account through the Codex backend. Account access and usage limits apply.
- **Researchers and students:** compare sources, examine disagreements, and make questions from your study notes.
- **Project leads and builders:** ask for decisions, blockers, recorded owners, and next actions across meeting and project notes.
- **Writers and knowledge workers:** reuse your reading, examples, and arguments without copying every note into another app.

### The vault where it earns its place

Have you ever thought, “I know I wrote that down”? Start there.

- A project with planning notes, meeting minutes, and decisions recorded over time.
- A research or reading collection with overlapping claims and different conclusions.
- A personal knowledge vault with linked ideas you want to use in your next piece of work.

Readable text, useful headings, dates, links, and tags give it more to work with. Markdown, plain text, code, JSON, and CSV are supported; scanned PDFs, images, and audio need a text version first.

### What you can do

#### 1. Ask a question across your notes

Keyword and meaning-based search help find relevant material even when you don't remember the filename. Vault tools can read passages, follow note links, and compare the evidence they find.

> Compare the original plan with the meeting decisions in @[Projects/Launch]. What changed? Show the sources and next actions.

- Narrow the task by folder or tag, or ask it to search across eligible vault files.
- Keep headings, code boundaries, JSON keys, and CSV headers with retrieved passages.
- Check the stated coverage: bounded research is not a promise that every note was read.

#### 2. Open the evidence behind the answer

Sources show file paths and available heading or line locations. Open the original, copy its link, or insert a cited passage into your active note.

- See which passages were checked against the current file and which need review.
- Inspect sources and the work log below the answer when you need them.
- See context limits and omitted references when the selected material exceeds the model's budget.

#### 3. Bring the work on your screen into chat

Type `@` and choose a reference. The composer previews references before you send.

| Reference | Use it for |
| --- | --- |
| `@current` | The active note. |
| `@tabs` | Files open in Obsidian tabs. |
| `@note.md` | One specific file. |
| `@[Projects/Launch]` | A folder's eligible files. |
| `@#research` | Notes matching an Obsidian tag, including nested tags. |
| `@server` | A connected external tool server. |

Mentioning only an external server skips automatic vault search for that turn. Add a vault reference when you want both.

#### 4. Turn notes into the result you need

Choose a prompt preset, then say what you want. Save recurring preferences in the prompt library, with a global default or a prompt for the current conversation.

- **Reading and research:** compare arguments, summarize sources, or test your recall.
- **Meetings and projects:** collect decisions, unresolved questions, and next actions.
- **Writing and reflection:** draft from your notes, review your week, or check a story's consistency.
- **Organization and technical work:** propose a map of content or investigate a problem using recorded evidence.

These are requests you can make, not automatic edits to your vault. The built-in vault tools are read-only; review drafts and proposed changes before using them.

#### 5. Choose your AI. Keep search local.

Connect ChatGPT browser sign-in, OpenAI API, Claude, Ollama, OpenRouter, or an OpenAI-compatible endpoint. Test and select the model you want; available features depend on the model and connection.

- Choose **Ternlight** for short English notes (about 10 MB), or **EmbeddingGemma 300M** for multilingual notes (about 1.27 GB). Download and manage their files in settings; switching models rebuilds the index.
- Search indexes and built-in embeddings stay on your device. Meaning-based search needs the model files and indexing to be ready.
- Chat and optional remote embeddings can send content to your selected provider. Use a local chat provider as well when that content must stay on your machine.

#### 6. Connect tools and look up plugin syntax

Add local MCP tools when a task needs information beyond your notes. Trusted tools can run automatically; tools requiring approval wait for you.

With **Answers informed by installed plugins** enabled and **Context7 MCP** connected, name an active plugin in your question to retrieve its documentation before generation. Use this for plugin-specific queries or templates; the lookup does not verify your settings, installed-version compatibility, or code execution.

### Start with one question you actually care about

1. Install and enable **Superpower Inside** in Obsidian's **Community plugins**.
2. Add an AI connection in the plugin settings, test a model, and select it in chat.
3. Open the chat sidebar and try one of these:

> **Project:** “In @[Projects/Launch], what is still blocking launch? Give me a table of evidence, recorded owners, and next actions.”
>
> **Reading:** “Compare the claims in @#research. Where do they agree, and where does the evidence differ?”
>
> **Writing:** “Use @tabs to draft an outline. Keep my arguments and cite the notes behind them.”

Keyword search and built-in vault tools do not require an embedding index. Let meaning-based indexing finish in the background while you start.

<details>
<summary><strong>ChatGPT sign-in, manual install, and external tools</strong></summary>

- **ChatGPT:** add an **OpenAI ChatGPT (OAuth)** connection and click **Sign in with ChatGPT**. Complete browser sign-in, fetch or add an available model, and run its generation test. Embeddings use a separate connection, such as a built-in local model.
- **API key:** choose **OpenAI API** instead of the ChatGPT connection.
- **Manual install:** download the plugin files from a GitHub Release into `.obsidian/plugins/superpower-inside/`, then reload and enable the plugin. Include every shipped runtime asset, not just `main.js`, `manifest.json`, and `styles.css`.
- **MCP:** open **External tools → Server setup → Advanced JSON editor**. Use a top-level `mcpServers` object with named entries containing `command`, optional `args`, and optional string-valued `env`. Local stdio servers are supported; remote HTTP/SSE configurations are not. Applying the editor replaces the configured server list, so keep existing entries.

</details>

<details>
<summary><strong>Your data and the limits to know</strong></summary>

- Exclude notes with `superpower-inside-exclude: true` in top-level YAML, or use the document exclusion command. Path and extension exclusions also apply to search, indexing, and built-in vault tools.
- Chat messages, selected passages, and tool results may go to the AI provider or tools you configure. Local search does not make remote chat private.
- API keys are stored unencrypted in local plugin settings and `data.json`; vault sync and backups may include them. ChatGPT OAuth credentials are stored separately in this device's Obsidian local storage, also unencrypted.
- Local model downloads contain no note content. Indexes stay in local browser storage for this vault.
- AI can miss evidence or make mistakes. A source link helps you check a claim; it does not guarantee the claim is correct. General knowledge and new drafts may have no vault source.
- Responses are buffered rather than shown token by token. Stopping a run may not cancel inference already running at the provider.
- Mobile Obsidian is not supported.

</details>

**Pick a question you've been putting off. [Ask your vault.](https://obsidian.md/plugins?id=superpower-inside)**

---

## 한국어

> **읽고, 적고, 저장까지 했잖아요. 이제 써먹으세요.**

Superpower Inside는 Obsidian 안에서 노트를 찾아 읽고, 비교하고, 글로 만드는 AI 플러그인입니다. 지난 결정·흩어진 연구 자료·초안에 필요한 근거를 질문으로 찾고, 볼트 출처를 열어 직접 확인하세요.

- **그때 내린 결정, 다시 찾으세요.** 무엇이 바뀌었고 어디에 기록됐는지 물어보세요.
- **읽은 만큼 써먹으세요.** 독서 노트를 개요·비교표·학습 질문으로 꺼내세요.
- **지금 하던 일을 이어가세요.** 현재 노트·열린 탭·폴더·태그를 채팅에 바로 연결하세요.

초능력은 내가 남긴 관찰, 자료, 결정 안에 있습니다. Superpower Inside는 그 기록을 다음 작업에 쓸 수 있게 꺼내줍니다.

**[Obsidian에서 설치](https://obsidian.md/plugins?id=superpower-inside)** · **[릴리스 다운로드](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

**무료·오픈소스·데스크톱 전용입니다.** 플러그인 구독료나 회원가입은 없으며, 선택한 AI 제공자의 계정·요금은 별도입니다. [서드파티 고지](THIRD_PARTY_NOTICES.md).

### 이런 분께 잘 맞습니다

- **이미 ChatGPT를 구독하는 분:** 브라우저 로그인으로 연결하고 Codex 서버를 통해 계정에서 지원하는 모델을 사용하세요. 계정별 접근 권한과 사용 한도는 적용됩니다.
- **연구자·학생:** 자료의 주장을 비교하고, 서로 다른 결론을 살펴보고, 공부한 내용으로 복습 질문을 만드세요.
- **프로젝트 담당자·개발자:** 회의록과 기획 노트에서 결정·장애 요인·기록된 담당자·다음 행동을 모으세요.
- **작가·지식 노동자:** 노트를 다른 앱에 하나씩 복사하지 않고, 읽어 둔 자료와 논거로 글을 쓰세요.

### 이런 볼트에서 먼저 써보세요

“분명 어딘가에 적었는데.” 이 말이 나오는 볼트라면 시작하기 좋습니다.

- 기획·회의록·의사결정이 시간순으로 쌓인 **프로젝트 볼트**.
- 같은 주제를 다루지만 주장과 결론이 다른 **연구·독서 볼트**.
- 서로 연결된 생각을 다음 글이나 업무에 쓰고 싶은 **개인 지식 볼트**.

읽을 수 있는 본문에 제목·날짜·링크·태그가 있으면 비교와 탐색에 도움이 됩니다.

- Markdown·일반 텍스트·코드·JSON·CSV를 지원합니다.
- 스캔 PDF·이미지·음성은 먼저 텍스트로 준비하세요.

### 기능을 이렇게 써보세요

#### 1. 노트를 넘나들며 질문하세요

파일명을 몰라도 키워드·의미 검색으로 관련 자료를 찾습니다. 볼트 도구는 필요한 구간을 읽고, 노트 링크를 따라가며, 찾은 근거를 비교할 수 있습니다.

> @[Projects/Launch]의 최초 기획과 회의 결정을 비교해줘. 무엇이 바뀌었는지 출처와 다음 행동을 함께 보여줘.

- 폴더·태그로 범위를 좁히거나, 검색 대상 볼트 파일에서 찾아달라고 요청하세요.
- 검색 구간에는 제목·코드 경계·JSON 키·CSV 헤더가 함께 보존됩니다.
- 답변의 조사 범위를 확인하세요. 제한된 조사를 모든 노트를 읽은 결과로 받아들이지는 마세요.

#### 2. 답변의 근거를 바로 여세요

출처에는 파일 경로와 확인 가능한 제목·줄 위치가 표시됩니다. 원문을 열고, 링크를 복사하고, 출처 구간을 활성 노트에 삽입할 수 있습니다.

- 현재 파일과 대조한 근거와 추가 확인이 필요한 자료를 구분해 보세요.
- 필요할 때 답변 아래의 출처와 작업 기록을 펼치세요.
- 선택한 자료가 모델 한도를 넘으면 컨텍스트 제한과 빠진 참조를 확인하세요.

#### 3. 지금 화면에 열린 작업을 가져오세요

`@`를 입력하고 참조를 고르세요. 보내기 전에 입력창에서 참조를 미리 확인할 수 있습니다.

| 참조 | 가져오는 범위 |
| --- | --- |
| `@current` | 현재 활성 노트. |
| `@tabs` | Obsidian 탭에 열린 파일. |
| `@note.md` | 지정한 파일 하나. |
| `@[Projects/Launch]` | 해당 폴더의 검색 대상 파일. |
| `@#research` | 해당 Obsidian 태그와 하위 태그가 붙은 노트. |
| `@server` | 연결한 외부 도구 서버. |

외부 서버만 멘션하면 그 질문의 볼트 자동 검색은 건너뜁니다. 볼트 근거도 필요하면 노트·폴더 등의 참조를 함께 넣으세요.

#### 4. 모아 둔 노트를 결과물로 바꾸세요

프리셋을 고르고 원하는 결과를 말하세요. 반복해서 쓰는 요구는 프롬프트 보관함에 저장하고, 전체 기본값이나 현재 대화에 적용할 수 있습니다.

- **독서·연구:** 논거 비교, 자료 요약, 이해도 점검.
- **회의·프로젝트:** 결정 정리, 미해결 질문, 다음 행동.
- **글쓰기·회고:** 노트 기반 초안, 주간 회고, 이야기 설정의 일관성 점검.
- **정리·기술 기록:** 목차 제안, 기록된 근거로 문제 조사.

내장 볼트 도구는 읽기 전용이므로, 위 작업은 AI에게 결과물이나 제안을 요청하는 방식입니다. 초안과 변경 제안은 검토한 뒤 사용하세요.

#### 5. AI는 고르고, 검색은 로컬로 쓰세요

ChatGPT 브라우저 로그인·OpenAI API·Claude·Ollama·OpenRouter·OpenAI 호환 서버를 연결하고 원하는 모델을 테스트해 선택하세요. 사용 가능한 기능은 모델과 연결 방식에 따라 다릅니다.

- 짧은 영어 노트에는 **Ternlight**(약 10 MB), 한국어 등 다국어 노트에는 **EmbeddingGemma 300M**(약 1.27 GB)을 선택하세요. 설정에서 파일을 관리할 수 있으며, 모델을 바꾸면 인덱스를 다시 만듭니다.
- 검색 인덱스와 내장 임베딩은 기기 안에 남습니다. 의미 검색은 모델 준비와 인덱싱이 끝난 뒤 사용할 수 있습니다.
- 채팅과 선택한 원격 임베딩은 제공자에게 내용을 보낼 수 있습니다. 채팅 내용도 기기 안에 두려면 로컬 채팅 제공자를 함께 사용하세요.

#### 6. 외부 도구와 플러그인 문서를 연결하세요

노트 밖의 정보가 필요하면 로컬 MCP 도구를 연결하세요. 신뢰한 도구는 자동 실행할 수 있고, 승인이 필요한 도구는 기다립니다.

**설치된 플러그인에 맞춘 답변**을 켜고 **Context7 MCP**를 연결하세요.

- 질문에 활성 플러그인 이름을 적으면 해당 문서를 먼저 조회해 전용 쿼리나 템플릿 작성에 활용합니다.
- 내 설정·설치 버전과의 호환성·코드 실행 결과는 별도로 확인해야 합니다.

### 계속 미뤄 둔 질문 하나로 시작하세요

1. Obsidian **커뮤니티 플러그인**에서 **Superpower Inside**를 설치하고 활성화하세요.
2. 플러그인 설정에서 AI를 연결하고 모델을 테스트한 뒤 채팅에서 선택하세요.
3. 채팅 사이드바를 열고 질문하세요.

> **프로젝트:** “@[Projects/Launch]에서 출시를 막는 일이 뭐야? 근거·기록된 담당자·다음 행동을 표로 정리해줘.”
>
> **독서:** “@#research의 주장을 비교해줘. 어디서 동의하고, 어떤 근거에서 갈려?”
>
> **글쓰기:** “@tabs로 글의 개요를 만들어줘. 내 논거를 유지하고 근거 노트를 달아줘.”

키워드 검색과 내장 볼트 도구에는 임베딩 인덱스가 필요하지 않습니다. 먼저 질문하고, 의미 검색용 인덱싱은 백그라운드에서 마치세요.

<details>
<summary><strong>ChatGPT 로그인·수동 설치·외부 도구 설정</strong></summary>

- **ChatGPT:** **OpenAI ChatGPT (OAuth)** 연결을 추가하고 **ChatGPT로 로그인**을 누르세요. 브라우저 로그인을 마친 뒤 사용 가능한 모델을 가져오거나 추가하고 생성 테스트를 실행하세요. 임베딩에는 내장 로컬 모델 등 별도 연결을 사용합니다.
- **API 키:** ChatGPT 연결 대신 **OpenAI API**를 선택하세요.
- **수동 설치:** GitHub Release의 플러그인 파일을 `.obsidian/plugins/superpower-inside/`에 넣고 플러그인을 다시 불러와 활성화하세요. `main.js`·`manifest.json`·`styles.css` 외에 릴리스에 포함된 런타임 자산도 모두 필요합니다.
- **MCP:** **외부 도구 → 서버 설정 → 고급 JSON 편집**에서 최상위 `mcpServers` 안에 서버별 `command`, 선택 항목 `args`, 문자열 값의 `env`를 넣으세요. 로컬 stdio 서버를 지원하며 원격 HTTP/SSE 설정은 지원하지 않습니다. 적용하면 서버 목록 전체가 교체되므로 기존 항목을 유지하세요.

</details>

<details>
<summary><strong>데이터와 사용 한계</strong></summary>

- 노트 맨 위 YAML에 `superpower-inside-exclude: true`를 넣거나 문서 제외 명령으로 검색 대상에서 빼세요. 경로·확장자 제외도 검색·인덱싱·내장 볼트 도구에 함께 적용됩니다.
- 채팅 메시지·선택한 구간·도구 결과는 설정한 AI 제공자나 도구로 전송될 수 있습니다. 검색이 로컬이어도 원격 채팅 내용은 전송됩니다.
- API 키는 로컬 플러그인 설정과 `data.json`에 암호화 없이 저장되며 볼트 동기화·백업에 포함될 수 있습니다. ChatGPT OAuth 자격 증명은 이 기기의 Obsidian 로컬 저장소에 별도로 저장되며, 역시 암호화되지 않습니다.
- 로컬 모델 다운로드에 노트 내용은 포함되지 않습니다. 인덱스는 해당 볼트의 로컬 브라우저 저장소에 남습니다.
- AI는 근거를 놓치거나 틀릴 수 있습니다. 출처는 주장을 확인하는 수단이며 정답 보장은 아닙니다. 일반 지식과 새 초안에는 볼트 출처가 없을 수 있습니다.
- 응답은 토큰별 실시간 표시가 아니라 모아서 수신합니다. 중단해도 제공자에서 이미 실행 중인 추론은 계속될 수 있습니다.
- 모바일 Obsidian은 지원하지 않습니다.

</details>

**쌓아 둔 기록에, 오늘 필요한 질문을 던지세요. [볼트에서 시작하세요.](https://obsidian.md/plugins?id=superpower-inside)**
