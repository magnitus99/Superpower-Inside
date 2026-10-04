# Superpower Inside

[![Obsidian](https://img.shields.io/badge/Obsidian-desktop%20only-7c3aed)](https://obsidian.md/plugins?id=superpower-inside)
[![license](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)
[![price](https://img.shields.io/badge/price-free%20%26%20open%20source-0f766e)](LICENSE)

> **Your vault is full of answers. Stop hunting note by note.**

Superpower Inside turns your Obsidian vault into an AI research partner. Ask one question, and it searches across your notes, reads the right parts, connects the dots, and answers with sources you can open and verify.

**[Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=superpower-inside)** · **[Download the latest release](https://github.com/magnitus99/Superpower-Inside/releases/latest)** · **[한국어로 읽기](#한국어)**

| Ask the vault, not the file tree | Check the evidence | Bring your own AI |
| --- | --- | --- |
| Research can span eligible notes across your vault. The answer states coverage limits. | Inspect available sources, open the original, and check whether it supports the claim. | Connect OpenAI, Claude, Ollama, OpenRouter, or an OpenAI-compatible endpoint. |

> [!IMPORTANT]
> Superpower Inside is **desktop-only**, free, and open source. The plugin has no paid tier or account requirement. Your chosen AI provider may require an account and charge for usage.

---

## How it works

```
Ask naturally → It searches your vault → It reads and connects the evidence → It answers with sources
```

Inspect the answer, available sources, and work log. Research is bounded by file eligibility, tool limits, and the evidence that could be verified.

## Why you'll love it

**🔍 Ask anything, not just what you remember**

Searching for a keyword finds files that contain that word. Superpower Inside understands what you're *asking*—themes, changes, contradictions, summaries—across your entire vault. You don't need to know where the answer lives. Just ask.

**📎 Inspect the sources behind vault claims**

The Sources tab lists notes and retrieved ranges. Open the original, copy the link, or insert the evidence into your active note. General knowledge and proposed content may have no vault source; inspect support before relying on a claim.

**🧭 It sees connections you might miss**

Keyword search, semantic search, and chat tools use the same supported text files, including Markdown, plain text, and code. Retrieved passages are checked against the current source before they become answer evidence. Optional GraphRAG and ontology extraction are off by default. When enabled, they connect people, concepts, and claims from those same files. File search and source reading remain available while the graph is being built.

JSON keys, CSV headers and records, and code block boundaries stay attached to the shared passages. When a file changes, graph extraction reuses unchanged passages and updates their source locations. The vault statistics tool reports each file's source, keyword, embedding, and graph readiness separately.

**🏠 Built-in search runs locally**

The built-in embedding model and search indexes run on your machine. The model asset may be downloaded once. Chat, graph extraction, summaries, and optional remote embeddings can send content to the providers you select. Use local providers when these tasks must stay on your device.

**✋ You're always in control**

Stop any research run mid-stream. See what was searched, what was found, and what wasn't covered. When something goes wrong, you get a clear next step—not a wall of technical errors.

**🧹 A calm interface, not a mess of logs**

Final answer, work log, and sources stay separated. You see the conclusion first, the evidence when you want it, and nothing you don't need.

## Try it the moment you install

```
Summarize the core themes in my vault, with sources for each claim.

Find decisions that changed between my planning notes and final meeting minutes.

Find recurring claims in @[Research] whose supporting evidence is missing from the checked notes. Distinguish missing evidence from false claims.

Review @[Projects/Launch]. List blockers, evidence, owners, and next actions in a table. Mark missing owners as unknown.
```

## Focus your question when it matters

| Type this | What it does |
| --- | --- |
| `@note.md` | Pin a specific note to the conversation. |
| `@[folder/path]` | Scope the research to one folder. |
| `@server` | Bring in a connected external tool for this question. |

Use file and folder mentions to focus vault research. Mentioning only an external server skips automatic vault search for that turn; add a file or folder mention when you also need vault evidence.

## Ask for a usable result

State the result you need, the relevant notes, and the format or boundary that matters. A short question is enough for a simple task. For example:

```text
Compare the launch decisions in @[Projects/Launch] for a project lead.
Use a table with decision, before, after, and source. Keep recorded dates unchanged.
Separate inferred reasons from recorded reasons and flag unverified coverage.
```

Refine the answer with a follow-up such as “Keep the evidence, shorten the background, and put next actions first.” Keep recurring preferences in the prompt library and task-specific requirements in the chat message. The chat prompt library supports a global default and a prompt for the current session. Generated prompts use a bounded embedding-index summary with sample passages, sent to the selected generation model; review the generated body before applying it.

These examples follow the [official ChatGPT prompting guide](https://learn.chatgpt.com/docs/prompting). For GPT-6.1 Sol, consult the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and check provider availability and tool compatibility. Choosing a prompt does not change the configured model or reasoning setting.

GPT-6.1 Sol requires the Responses API for OpenAI tool calling. The plugin’s current direct OpenAI connection uses Chat Completions, so native tool research with that model requires a provider implementation update. Prompt changes alone do not establish compatibility.

## Get started in three steps

1. Open **Settings → Community plugins** in Obsidian and search for **Superpower Inside**.
2. Install, enable, and connect the AI model you prefer.
3. Open the sidebar and ask your vault something you've been wondering about.

Smart keyword search and read-only vault tools work immediately—no extra setup required. The built-in private search model is selected by default for meaning-based search. Advanced indexing runs quietly in the background and only surfaces when it needs your attention.

#### Manual install

1. Download the [latest GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest).
2. Copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/superpower-inside/`.
3. Reload community plugins and enable **Superpower Inside**.

<details>
<summary><strong>Privacy, security, and honest limits</strong></summary>

- Settings and API keys are stored unencrypted in this device's Obsidian local plugin storage and plugin `data.json`. They can be included in vault sync and local backups.
- Chat messages, selected notes, retrieved passages, and tool results may be sent to the AI model or connected tools you configure.
- Whole-vault research inventories and screens eligible files locally. Only bounded evidence from locally selected files is sent to your chosen AI model, and coverage or transfer limits are stated in the answer.
- The built-in vault tools are read-only. They can search, verify retrieved passages against current files, follow note links, read bounded ranges, list files, and report statistics—but they cannot create, modify, move, or delete files.
- Search indexes are stored locally in Obsidian's browser storage for this vault.
- Connected external tools launch local commands you configure. Trusted tools run automatically; risky ones stay behind your approval. Only add tools you trust.
- If the built-in search model file is missing, the plugin downloads the matching release asset once, verifies its integrity, and then reuses it offline. No note content is included in that download request.
- Desktop-only features mean mobile Obsidian is not supported.

</details>

---

## 한국어

> **답은 이미 볼트 안에 있습니다. 이제 노트를 하나씩 뒤지는 대신, 볼트 전체에 질문하세요.**

Superpower Inside는 볼트 전체를 AI 리서치 파트너로 바꿉니다. 질문 하나만 던지면 관련 노트를 검색하고, 필요한 부분을 읽고, 흩어진 단서를 연결한 뒤, 바로 열어서 확인할 수 있는 출처와 함께 답합니다.

**[커뮤니티 플러그인에서 설치](https://obsidian.md/plugins?id=superpower-inside)** · **[최신 릴리스 다운로드](https://github.com/magnitus99/Superpower-Inside/releases/latest)**

| 파일 트리가 아니라 볼트에 질문하세요 | 답변의 근거를 확인하세요 | 원하는 AI를 연결하세요 |
| --- | --- | --- |
| 볼트의 조사 대상 노트를 함께 찾고 답변에서 확인 범위와 한계를 확인합니다. | 제공된 출처를 열어 원문이 주장을 뒷받침하는지 검증하세요. | OpenAI, Claude, Ollama, OpenRouter 또는 OpenAI 호환 서버를 연결하세요. |

> [!IMPORTANT]
> **데스크톱 전용**, 무료, 오픈소스입니다. 플러그인 자체에는 유료 등급이나 계정 가입이 없습니다. 선택한 AI 제공자는 계정과 별도 사용 요금을 요구할 수 있습니다.

---

### 작동 방식

```
자연어로 질문 → 볼트를 검색 → 근거를 읽고 연결 → 출처와 함께 답변
```

답변, 제공된 출처와 작업 기록을 확인하고 재사용하세요. 조사 범위는 대상 파일, 도구 한도와 검증 가능한 근거에 따라 제한됩니다.

### 이런 점이 달라집니다

**🔍 기억하고 있어야만 찾을 수 있는 게 아니라, 궁금한 걸 그냥 물어보세요**

키워드 검색은 그 단어가 들어간 파일만 찾아줍니다. Superpower Inside는 주제, 변화, 모순, 요약처럼 *질문 자체*를 이해하고 볼트 전체에서 답을 찾습니다. 어디에 근거가 있는지 미리 알 필요가 없습니다.

**📎 볼트 기반 주장의 출처를 확인하세요**

출처 탭은 노트와 검색된 구간을 목록으로 보여줍니다. 원문 열기, 링크 복사, 활성 노트 삽입으로 이어집니다. 일반 지식과 새로 작성한 제안에는 볼트 출처가 없을 수 있으므로 주장의 근거를 확인하세요.

**🧭 놓치기 쉬운 연결을 보여줍니다**

키워드·의미 검색과 채팅 도구는 같은 지원 텍스트 파일을 사용합니다. Markdown, 일반 텍스트, 코드 등에서 찾은 구간은 현재 원문을 확인한 뒤 답변 근거로 사용합니다. 선택적인 GraphRAG와 ontology는 기본으로 꺼져 있습니다. 켜면 같은 파일에서 인물·개념·주장의 관계를 연결하며, 그래프 구축 여부와 관계없이 파일 검색과 원문 읽기를 사용할 수 있습니다.

JSON 키, CSV 헤더·레코드, 코드 블록 경계도 공통 검색 구간에 보존합니다. 파일을 수정하면 변경 없는 구간의 그래프 추출 결과는 재사용하고 원문 위치를 갱신합니다. 볼트 통계 도구에서는 파일별 원문·키워드·임베딩·그래프 처리 상태를 구분해 확인할 수 있습니다.

**🏠 내장 검색은 기기 안에서 실행됩니다**

내장 임베딩 모델과 검색 인덱스는 기기 안에서 실행됩니다. 모델 파일은 최초에 내려받을 수 있습니다. 채팅, 그래프 추출, 요약과 선택적인 원격 임베딩은 설정한 제공자에게 내용을 전송할 수 있습니다. 이 작업도 기기 안에서 처리하려면 로컬 제공자를 사용하세요.

**✋ 언제든 중단하고, 언제든 확인하세요**

조사 중이라면 실행 중간에 멈출 수 있습니다. 무엇을 검색했고, 무엇을 찾았고, 무엇을 커버하지 못했는지 답변에 명확히 보여줍니다. 문제가 생기면 기술적 오류 대신 다음 행동을 먼저 보여줍니다.

**🧹 로그 더미가 아니라 정돈된 화면**

최종 답변, 작업 기록, 출처가 분리되어 보입니다. 결론을 먼저, 근거는 원할 때, 불필요한 건 보지 않아도 됩니다.

### 설치 후 가장 먼저 던져볼 질문

```
이 볼트의 핵심 주제를 정리하고, 가장 강한 근거마다 출처를 달아줘.

기획 노트와 최종 회의록 사이에서 바뀐 의사결정을 찾아줘.

@[Research]에서 반복되는 주장 중 확인한 노트에 근거가 없는 것을 찾아줘. 근거 부족과 틀린 주장을 구분해줘.

@[Projects/Launch]의 장애 요인, 근거, 담당자와 다음 행동을 표로 정리해줘. 담당자가 없으면 미확인으로 표시해줘.
```

### 정확한 범위를 지정하고 싶을 때

| 이렇게 쓰면 | 이렇게 작동합니다 |
| --- | --- |
| `@note.md` | 특정 노트를 대화에 고정합니다. |
| `@[folder/path]` | 조사 범위를 한 폴더로 좁힙니다. |
| `@server` | 이 질문에 연결된 외부 도구를 가져옵니다. |

파일·폴더 멘션으로 볼트 조사에 초점을 맞출 수 있습니다. 외부 서버만 멘션하면 그 턴의 볼트 자동 검색을 건너뜁니다. 볼트 근거도 필요하면 파일이나 폴더를 함께 멘션하세요.

### 바로 쓸 수 있는 답변 요청하기

필요한 결과, 관련 노트와 중요한 형식·경계를 알려주세요. 간단한 작업에는 짧은 질문이면 충분합니다.

```text
@[Projects/Launch]의 출시 결정을 프로젝트 담당자가 볼 수 있게 비교해줘.
결정, 이전, 이후, 출처를 표로 쓰고 기록된 날짜는 바꾸지 마.
이유가 기록된 경우와 추론한 경우를 구분하고 확인하지 못한 범위를 밝혀줘.
```

답변을 본 뒤 “근거는 유지하고 배경을 줄여줘. 다음 행동을 먼저 써줘”처럼 후속 요청으로 다듬으세요. 반복되는 선호는 프롬프트 보관함에, 이번 작업에만 필요한 요구는 채팅 메시지에 둡니다. 채팅의 프롬프트 보관함에서 전역 기본값과 현재 세션의 프롬프트를 적용할 수 있습니다. 프롬프트 생성은 대표 구간을 포함한 제한된 임베딩 인덱스 요약을 선택한 생성 모델에 전송합니다. 생성된 본문을 검토한 뒤 적용하세요.

예시는 [ChatGPT 공식 프롬프팅 가이드](https://learn.chatgpt.com/docs/prompting)를 따릅니다. GPT-6.1 Sol을 사용할 때는 [공식 모델 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol)와 제공자의 모델·도구 지원을 확인하세요. 프롬프트를 선택해도 설정한 모델과 추론 강도는 바뀌지 않습니다.

GPT-6.1 Sol의 OpenAI 도구 호출은 Responses API가 필요합니다. 현재 플러그인의 직접 OpenAI 연결은 Chat Completions를 사용하므로, 이 모델의 네이티브 도구 조사는 provider 구현 변경이 필요합니다. 프롬프트 수정만으로 호환성이 확보되지는 않습니다.

### 세 단계면 시작됩니다

1. Obsidian **설정 → 커뮤니티 플러그인**에서 **Superpower Inside**를 검색합니다.
2. 설치하고 활성화한 뒤 원하는 AI 모델을 연결합니다.
3. 사이드바를 열고 볼트에 대해 궁금했던 질문을 던집니다.

키워드 검색과 읽기 전용 볼트 도구는 추가 설정 없이 바로 작동합니다. 내장 비공개 검색 모델이 기본으로 선택되어 의미 기반 검색도 즉시 사용할 수 있습니다. 고급 인덱싱은 조용히 백그라운드에서 진행되고, 정말 필요할 때만 알려줍니다.

#### 수동 설치

1. [최신 GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest)를 내려받습니다.
2. `main.js`, `manifest.json`, `styles.css`를 `.obsidian/plugins/superpower-inside/`에 복사합니다.
3. 커뮤니티 플러그인을 다시 불러온 뒤 **Superpower Inside**를 활성화합니다.

<details>
<summary><strong>개인정보, 보안, 솔직한 한계</strong></summary>

- 설정과 API 키는 암호화되지 않은 값으로 이 기기의 Obsidian 로컬 플러그인 저장소와 플러그인 `data.json`에 보관됩니다. 볼트 동기화와 로컬 백업에 포함될 수 있습니다.
- 채팅 메시지, 선택한 노트, 검색된 구간, 도구 결과는 사용자가 설정한 AI 모델이나 연결된 도구로 전송될 수 있습니다.
- 볼트 전체 리서치는 대상 파일 목록과 선별을 로컬에서 수행합니다. 로컬에서 고른 파일의 제한된 근거만 설정한 AI 모델로 전송하며, 확인 범위나 전송 한계는 답변에 표시합니다.
- 내장 볼트 도구는 읽기 전용입니다. 검색, 현재 파일에 대한 검증, 노트 연결 확인, 제한된 범위 읽기, 파일 목록, 통계 보고는 하지만 파일을 생성·수정·이동·삭제할 수 없습니다.
- 검색 인덱스는 해당 볼트의 Obsidian 브라우저 저장소에 로컬로 보관됩니다.
- 연결된 외부 도구는 사용자가 설정한 로컬 명령을 실행합니다. 신뢰한 도구는 자동 실행되고, 위험한 도구는 승인 뒤에 실행됩니다. 신뢰하는 도구만 추가하세요.
- 내장 검색 모델 파일이 없으면 같은 버전의 릴리스 자산을 한 번 내려받아 무결성을 검증한 뒤 오프라인으로 재사용합니다. 이 다운로드 요청에는 노트 내용이 포함되지 않습니다.
- 데스크톱 전용 기능을 사용하므로 모바일 Obsidian은 지원하지 않습니다.

</details>

---

## License

[MIT](LICENSE)

[Third-party notices](THIRD_PARTY_NOTICES.md)
