# Superpower Inside

[![version](https://img.shields.io/badge/version-2.1.4-2563eb)](https://github.com/magnitus99/Superpower-Inside/releases/latest)
[![Obsidian](https://img.shields.io/badge/Obsidian-desktop%20only-7c3aed)](https://obsidian.md/plugins?id=superpower-inside)
[![license](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)
[![price](https://img.shields.io/badge/price-free%20%26%20open%20source-0f766e)](LICENSE)

> **Your vault is full of answers. Stop hunting note by note.**

Superpower Inside turns your Obsidian vault into an AI research partner. Ask one question, and it searches across your notes, reads the right parts, connects the dots, and answers with sources you can open and verify.

**[Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=superpower-inside)** · **[Download the latest release](https://github.com/magnitus99/Superpower-Inside/releases/latest)** · **[한국어로 읽기](#한국어)**

| Ask the vault, not the file tree | Every answer shows its sources | Bring your own AI |
| --- | --- | --- |
| One question covers your entire vault—not just the file you happened to open. | See exactly which notes were used, jump to the original, and verify before you trust. | OpenAI, Claude, Ollama, or your own local model—it works with what you already use. |

> [!IMPORTANT]
> Superpower Inside is **desktop-only**, completely free, and open source. No premium tier, no feature paywall, no account required.

---

## How it works

```
Ask naturally → It searches your vault → It reads and connects the evidence → It answers with sources
```

One question. A complete research trail you can inspect, copy, or reuse.

## Why you'll love it

**🔍 Ask anything, not just what you remember**

Searching for a keyword finds files that contain that word. Superpower Inside understands what you're *asking*—themes, changes, contradictions, summaries—across your entire vault. You don't need to know where the answer lives. Just ask.

**📎 Every answer comes with receipts**

Source cards show which notes were used, down to the exact lines. Open the original, copy the link, or insert the evidence directly into your active note. You never have to take the AI's word for it.

**🧭 It sees connections you might miss**

Beyond keyword and meaning-based search, it follows the relationships between your notes—the people, concepts, and recurring themes that link scattered thoughts into one picture.

**🏠 Your notes stay on your device**

The built-in search model runs entirely on your machine. No API key, no network call, no data leaving your device for the search itself. Connect any AI model you trust for the conversation—OpenAI, Claude, Ollama, OpenRouter, or your own local endpoint.

**✋ You're always in control**

Stop any research run mid-stream. See what was searched, what was found, and what wasn't covered. When something goes wrong, you get a clear next step—not a wall of technical errors.

**🧹 A calm interface, not a mess of logs**

Final answer, work log, and sources stay separated. You see the conclusion first, the evidence when you want it, and nothing you don't need.

## Try it the moment you install

```
Summarize the core themes in my vault, with sources for each claim.

Find decisions that changed between my planning notes and final meeting minutes.

What have I been repeating without evidence?

Review @[Projects/Launch] and tell me what's blocked, why, and who owns it.
```

## Focus your question when it matters

| Type this | What it does |
| --- | --- |
| `@note.md` | Pin a specific note to the conversation. |
| `@[folder/path]` | Scope the research to one folder. |
| `@server` | Bring in a connected external tool for this question. |

You don't need to mention files every time. The default search finds relevant evidence on its own—use mentions when you want to lock the scope exactly.

## Get started in three steps

1. Open **Settings → Community plugins** in Obsidian and search for **Superpower Inside**.
2. Install, enable, and connect the AI model you prefer.
3. Open the sidebar and ask your vault something you've been wondering about.

Smart keyword search and read-only vault tools work immediately—no extra setup required. The built-in private search model is selected by default for meaning-based search. Advanced indexing runs quietly in the background and only surfaces when it needs your attention.

#### Manual install

1. Download the [latest GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest).
2. Copy the release files into `.obsidian/plugins/superpower-inside/`.
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

| 파일 트리가 아니라 볼트에 질문하세요 | 모든 답변에 출처가 따라옵니다 | 원하는 AI를 그대로 연결하세요 |
| --- | --- | --- |
| 열어놓은 파일 하나가 아니라 볼트 전체를 한 번의 질문으로 조사합니다. | 어떤 노트가 근거였는지 확인하고, 원문으로 바로 이동한 뒤, 믿기 전에 검증하세요. | OpenAI, Claude, Ollama, 또는 로컬 모델—이미 쓰는 것을 그대로 연결하세요. |

> [!IMPORTANT]
> **데스크톱 전용**, 완전 무료, 오픈소스입니다. 유료 등급도, 기능 잠금도, 계정 가입도 없습니다.

---

### 작동 방식

```
자연어로 질문 → 볼트를 검색 → 근거를 읽고 연결 → 출처와 함께 답변
```

질문 한 번. 열어보고, 복사하고, 다시 쓸 수 있는 완전한 조사 기록.

### 이런 점이 달라집니다

**🔍 기억하고 있어야만 찾을 수 있는 게 아니라, 궁금한 걸 그냥 물어보세요**

키워드 검색은 그 단어가 들어간 파일만 찾아줍니다. Superpower Inside는 주제, 변화, 모순, 요약처럼 *질문 자체*를 이해하고 볼트 전체에서 답을 찾습니다. 어디에 근거가 있는지 미리 알 필요가 없습니다.

**📎 모든 답변에 근거가 따라옵니다**

출처 카드가 어떤 노트의 어느 줄을 근거로 썼는지 보여줍니다. 원문 열기, 링크 복사, 활성 노트 삽입까지 한 번에 이어집니다. AI가 말한 걸 그냥 믿을 필요가 없습니다.

**🧭 놓치기 쉬운 연결을 보여줍니다**

단어 매칭과 의미 기반 검색을 넘어서, 노트 사이의 관계—인물, 개념, 반복 주제—를 따라 흩어진 생각을 하나의 그림으로 연결합니다.

**🏠 노트는 기기 안에 남습니다**

내장 검색 모델은 전적으로 기기 안에서 실행됩니다. API 키도, 네트워크 요청도, 검색 자체가 기기를 떠나지 않습니다. 대화에는 원하는 AI 모델을 연결하세요—OpenAI, Claude, Ollama, OpenRouter, 또는 로컬 모델.

**✋ 언제든 중단하고, 언제든 확인하세요**

조사 중이라면 실행 중간에 멈출 수 있습니다. 무엇을 검색했고, 무엇을 찾았고, 무엇을 커버하지 못했는지 답변에 명확히 보여줍니다. 문제가 생기면 기술적 오류 대신 다음 행동을 먼저 보여줍니다.

**🧹 로그 더미가 아니라 정돈된 화면**

최종 답변, 작업 기록, 출처가 분리되어 보입니다. 결론을 먼저, 근거는 원할 때, 불필요한 건 보지 않아도 됩니다.

### 설치 후 가장 먼저 던져볼 질문

```
이 볼트의 핵심 주제를 정리하고, 가장 강한 근거마다 출처를 달아줘.

기획 노트와 최종 회의록 사이에서 바뀐 의사결정을 찾아줘.

내가 반복해서 주장하지만 아직 근거를 남기지 않은 내용을 찾아줘.

@[Projects/Launch]를 검토하고 무엇이, 누구 때문에, 왜 막혀 있는지 정리해줘.
```

### 정확한 범위를 지정하고 싶을 때

| 이렇게 쓰면 | 이렇게 작동합니다 |
| --- | --- |
| `@note.md` | 특정 노트를 대화에 고정합니다. |
| `@[folder/path]` | 조사 범위를 한 폴더로 좁힙니다. |
| `@server` | 이 질문에 연결된 외부 도구를 가져옵니다. |

매번 파일을 멘션할 필요는 없습니다. 기본 검색이 관련 근거를 자동으로 찾고, 멘션은 범위를 정확히 고정하고 싶을 때 사용합니다.

### 세 단계면 시작됩니다

1. Obsidian **설정 → 커뮤니티 플러그인**에서 **Superpower Inside**를 검색합니다.
2. 설치하고 활성화한 뒤 원하는 AI 모델을 연결합니다.
3. 사이드바를 열고 볼트에 대해 궁금했던 질문을 던집니다.

키워드 검색과 읽기 전용 볼트 도구는 추가 설정 없이 바로 작동합니다. 내장 비공개 검색 모델이 기본으로 선택되어 의미 기반 검색도 즉시 사용할 수 있습니다. 고급 인덱싱은 조용히 백그라운드에서 진행되고, 정말 필요할 때만 알려줍니다.

#### 수동 설치

1. [최신 GitHub Release](https://github.com/magnitus99/Superpower-Inside/releases/latest)를 내려받습니다.
2. 릴리스 파일을 `.obsidian/plugins/superpower-inside/`에 복사합니다.
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
