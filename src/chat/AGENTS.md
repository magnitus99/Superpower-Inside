# src/chat/ — 사이드바 채팅 UI

사이드바 `ItemView` 기반 채팅 인터페이스. 메시지 렌더링, 스트리밍, MCP 상태, 멘션 자동완성, 세션 관리 등 모든 채팅 UI 로직 포함.

## STRUCTURE

```
src/chat/
├── view.ts           # ChatView (ItemView) — 2812줄, 분할 권장
├── persistence.ts     # 채팅 → 마크다운 파일 저장/불러오기
├── session-modal.ts   # 세션 히스토리 모달 (인라인 CSS 250줄 포함)
├── commands.ts        # 에디터 내 AI 지시어 (parseDirective, executeDirective)
├── markdown.ts        # Obsidian 마크다운 렌더링 + 코드블록 강조
└── types.ts           # ChatMessageStatus, ChatSession, SessionState 등 타입
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 채팅 UI 수정 | `view.ts` | ItemView 확장. DOM 직접 조작. 분할 권장(2812줄) |
| 메시지 저장/불러오기 | `persistence.ts` | 프론트매터 + HTML 주석 직렬화. 레거시 포맷 호환 |
| 세션 목록 UI | `session-modal.ts` | FuzzySuggestModal. 인라인 CSS 존재 |
| AI 지시어 추가 | `commands.ts` | `parseDirective` → `executeDirective` 파이프라인 |
| 마크다운 렌더링 | `markdown.ts` | `renderMarkdownToElement`, `enhanceCodeBlocks` |
| 채팅 타입 정의 | `types.ts` | `ChatMessageWithMeta`, `ChatSession`, `AutoSaveConfig` |

## CODE MAP

| Symbol | Type | Role |
|--------|------|------|
| `ChatView` | class | 사이드바 채팅 ItemView. 40+ 필드, 50+ 메서드 |
| `CHAT_VIEW_TYPE` | const | `'super-obsidian-chat'` 뷰 타입 식별자 |
| `executeDirective` | function | 에디터 AI 지시어 실행 |
| `parseDirective` | function | `>AI: ...` 지시어 파싱 |
| `saveChat` | function | ChatSession → 마크다운 파일 저장 |
| `loadChat` | function | 마크다운 파일 → ChatSession 역직렬화 |
| `openSessionHistoryModal` | function | 세션 히스토리 모달 열기 |
| `renderMarkdownToElement` | function | Obsidian 마크다운 렌더링 래핑 |

## CONVENTIONS

- `ChatView`의 `addMessage` / `updateMessage`가 DOM 조작 핵심. 수정 시 스크롤/스트리백 경합 주의
- `ChatMessage` 타입은 `src/llm/providers.ts`에 정의. `persistence.ts`에서 re-export
- 세션 파일은 마크다운 포맷으로 vault에 저장 (프론트매터 + HTML 주석)

## ANTI-PATTERNS (THIS MODULE)

| 금지 | 이유 |
|------|------|
| `ChatView`에 새 기능 직접 추가 | 2812줄 이미 과대. 반드시 별도 함수/파일로 추출 후 임포트 |
| DOM 조작 시 `innerHTML` 직접 할당 | XSS 위험. `createEl` / `createSpan` Obsidian API 사용 |
| `ChatMessage` 타입을 이 모듈에서 재정의 | `src/llm/providers.ts`에서 임포트 |