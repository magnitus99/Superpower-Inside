# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superpower Inside 설정 화면의 모든 탭을 하나의 정갈한 정보형 디자인 언어로 통일하고, Overview 탭의 지나치게 압축된 카드/행 레이아웃을 읽기 좋은 대시보드로 완전히 재설계한다.

**Architecture:** 설정 저장, Provider 연결, RAG 상태 계산, MCP JSON 저장/검증, Prompt Library 동작은 그대로 둔다. `src/settings.ts`에서는 DOM을 공통 shell/panel/section/action 구조로 재배치하고, `styles.css`에서는 설정 화면 전용 디자인 시스템을 정의해 모든 탭이 같은 시각 언어를 공유하게 한다.

**Tech Stack:** TypeScript strict, Obsidian `Setting` API와 DOM API, CSS, Vitest, ESLint, esbuild CJS 번들.

---

## 0. Non-Negotiable Requirements

- 모든 탭은 같은 디자인 언어를 사용해야 한다.
- Overview는 현재처럼 “정보가 많은 정갈한 대시보드” 역할을 유지해야 한다.
- Overview 카드가 116px 수준으로 찌그러지거나 한국어가 세로로 쪼개지는 상태는 제거해야 한다.
- 각 탭의 기능은 유지해야 한다.
- API key 저장, Provider 모델 검색, RAG 인덱싱, MCP JSON lint/autosave, Prompt Library 열기, toggles/dropdowns/text inputs의 기존 저장 흐름을 깨면 안 된다.
- 설정 화면 전체는 Obsidian 설정 모달 안에서 보아야 하므로 과도한 hero/landing page 스타일을 만들지 않는다.
- 카드 안에 카드가 겹쳐 보이면 안 된다. 단, “provider card 안 model list”처럼 실제 도구 하위 표면은 허용한다.
- 버튼/토글/textarea/select/input 텍스트가 좁은 폭에서 겹치거나 잘려 보이면 안 된다.
- 검증 순서는 프로젝트 지침대로 `lint -> typecheck -> test -> build`다.
- 최종 완료 판단은 실제 Obsidian `.test-vault` 설정 화면 확인 후에만 한다.

## 1. Current Problem Map

### `src/settings.ts`

- `display()`가 제목, 보안 경고, 탭, 탭 패널을 직접 만든다.
- `buildGeneralTab()`은 Overview dashboard와 기본 설정을 만들지만 기본 설정은 `superpower-inside-overview-basics` 아래 bare `Setting` 목록이다.
- `renderOverviewMetrics()`는 5개 metric button을 만든다. 현재 CSS의 `minmax(116px, 1fr)` 때문에 card가 과도하게 좁아진다.
- `renderOverviewSection()`은 Provider/MCP/RAG/Chat status row를 만들지만 `grid-template-columns: minmax(72px, 1fr) auto auto`라 좁은 폭에서 정보가 압착된다.
- `buildProvidersTab()`은 Provider card를 순서대로 쌓는다. `superpower-inside-settings-section`과 `superpower-inside-provider-card`가 혼합되어 있고, Overview와 같은 패널 언어가 아니다.
- `buildRAGTab()`은 RAG 상태/컨트롤/임베딩/제외/고급/GraphRAG를 쌓는다. 자체 `superpower-inside-rag-section` 스타일은 있지만 Overview와 다른 밀도와 card grammar를 쓴다.
- `buildChatTab()`은 대부분 bare `new Setting(containerEl)`이다. 스크린샷상 카드형 탭들과 가장 이질적이다.
- `buildMCPTab()`은 자체 collapse header, divider, status box, editor가 있다. 기능은 좋지만 탭 디자인 언어가 별도다.
- `buildAdvancedTab()`은 bare `Setting` + help/warning이라 화면이 빈약하고 다른 탭과 분리되어 보인다.

### `styles.css`

- 설정 탭 스타일은 파일 초반에 있고, Provider 개선 스타일은 파일 후반에 추가되어 있다.
- Overview의 압축 원인:
  - `.superpower-inside-overview-metrics { grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); }`
  - `.superpower-inside-overview-metric-detail { white-space: nowrap; text-overflow: ellipsis; }`
  - `.superpower-inside-overview-matrix { minmax(260px, 1fr); }`는 나쁘지 않지만 모달 폭에 따라 2열 내부 row가 좁아진다.
  - `.superpower-inside-overview-status-row`가 3열 + detail 구조라 값/배지/라벨이 작은 폭에서 밀린다.
- MCP/RAG/Provider 각각 radius, padding, background, divider 방식이 다르다.

## 2. Target Design Language

### Common Shell

- 설정 화면 root:
  - class: `superpower-inside-settings-root`
  - 역할: 설정 화면 전체 최대 폭, 탭 간격, typography 기준.
- 제목 영역:
  - 기존 `h2` 유지.
  - `h2` 주변 margin을 CSS에서 안정화한다.
- 보안 경고:
  - class는 기존 `superpower-inside-settings-warning` 유지.
  - 스타일은 단순 orange text에서 alert panel로 변경한다.
  - 색상은 Obsidian theme 변수만 사용한다.

### Common Tab Content

- tab panels wrapper:
  - class: `superpower-inside-settings-tab-panels`
- each tab panel:
  - 기존 `superpower-inside-settings-tab-content` 유지.
  - active 시 `display: flex; flex-direction: column; gap: 12px;`로 바꾼다.
- 각 탭의 큰 영역:
  - class: `superpower-inside-settings-panel`
  - 역할: 반복되는 카드/섹션 컨테이너.
  - radius: 8px 이하.
  - padding: 14px 정도.
  - border: `1px solid var(--background-modifier-border)`
  - background: `var(--background-primary)`
- panel header:
  - class: `superpower-inside-settings-panel-header`
  - flex row, 제목/메타/액션 정렬.
- panel title:
  - class: `superpower-inside-settings-panel-title`
- panel desc/meta:
  - class: `superpower-inside-settings-panel-desc`, `superpower-inside-settings-panel-meta`

### Common Status UI

- status card:
  - class: `superpower-inside-settings-status-card`
  - Overview metric, RAG summary card 등에 사용.
- status row:
  - class: `superpower-inside-settings-status-row`
  - Provider/MCP rows에 공통 grammar로 재사용 가능.
- badge:
  - class: `superpower-inside-settings-badge`
  - tone modifier: `is-success`, `is-warning`, `is-danger`, `is-neutral`
- tone border:
  - `is-success/is-warning/is-danger`는 left border 3px.

### Common Controls

- action row:
  - class: `superpower-inside-settings-action-row`
  - 버튼들이 하단 오른쪽이나 자연스러운 줄바꿈으로 배치된다.
- chip row:
  - class: `superpower-inside-settings-chip-row`
  - Chat preset, Provider small controls 등에 사용.
- editor:
  - class: `superpower-inside-settings-editor`
  - JSON/PATH/prompt textarea의 공통 폭, border, radius, font, resize 기준.

## 3. Detailed File Responsibilities

### `src/settings.ts`

Keep:

- `TABS`
- `switchTab()`
- `refreshGeneralTab()`
- `repopulateDefaultModelDropdown()`
- provider/RAG/MCP save logic
- prompt preset creation logic
- JSON lint/autosave logic

Add private helpers inside `SuperpowerInsideSettingTab`:

```ts
private createSettingsPanel(
  containerEl: HTMLElement,
  title: string,
  options: { description?: string; meta?: string; className?: string } = {},
): HTMLElement {
  const panel = containerEl.createDiv({
    cls: `superpower-inside-settings-panel${options.className ? ` ${options.className}` : ''}`,
  });
  const header = panel.createDiv({ cls: 'superpower-inside-settings-panel-header' });
  const titleGroup = header.createDiv({ cls: 'superpower-inside-settings-panel-title-group' });
  titleGroup.createDiv({ cls: 'superpower-inside-settings-panel-title', text: title });
  if (options.description) {
    titleGroup.createDiv({
      cls: 'superpower-inside-settings-panel-desc',
      text: options.description,
    });
  }
  if (options.meta) {
    header.createDiv({ cls: 'superpower-inside-settings-panel-meta', text: options.meta });
  }
  return panel;
}
```

Notes:

- Use Korean text in visible descriptions.
- Do not introduce `innerHTML` except existing MCP refresh SVG unless refactoring that button.
- The helper returns panel body as the panel itself for simple use. If later header/body split is needed, add `createSettingsPanelBody()` only when necessary.
- Keep helper in the class near `buildGeneralTab()` so it is easy to find.

### `styles.css`

Add or replace settings section near the existing `/* Settings Tab */` block.

Required selectors:

```css
.superpower-inside-settings-root { ... }
.superpower-inside-settings-root h2 { ... }
.superpower-inside-settings-warning { ... }
.superpower-inside-settings-tab-panels { ... }
.superpower-inside-settings-tab-content.is-active { ... }
.superpower-inside-settings-panel { ... }
.superpower-inside-settings-panel-header { ... }
.superpower-inside-settings-panel-title-group { ... }
.superpower-inside-settings-panel-title { ... }
.superpower-inside-settings-panel-desc { ... }
.superpower-inside-settings-panel-meta { ... }
.superpower-inside-settings-badge { ... }
.superpower-inside-settings-action-row { ... }
.superpower-inside-settings-chip-row { ... }
.superpower-inside-settings-editor { ... }
```

Do not remove unrelated chat runtime styles. Only settings-screen selectors are in scope.

## 4. Implementation Tasks

### Task 1: Root Shell And Shared Panel Helper

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: In `display()`, add root class before creating content.

Expected code:

```ts
containerEl.addClass('superpower-inside-settings-root');
```

Place it before `containerEl.createEl('h2', ...)`.

- [ ] Step 2: Give tab content wrapper a class.

Change:

```ts
const tabContentContainer = containerEl.createDiv();
```

To:

```ts
const tabContentContainer = containerEl.createDiv({
  cls: 'superpower-inside-settings-tab-panels',
});
```

- [ ] Step 3: Add `createSettingsPanel()` helper.

Use the helper code from section 3. Keep the function private. Place it before `buildGeneralTab()` or immediately after `refreshRagTab()`.

- [ ] Step 4: Replace CSS shell styles.

Add/adjust:

```css
.superpower-inside-settings-root {
  max-width: 860px;
  margin: 0 auto;
  padding-bottom: 24px;
}

.superpower-inside-settings-root h2 {
  margin: 0 0 10px;
  font-size: var(--font-ui-large);
  line-height: 1.35;
}

.superpower-inside-settings-warning {
  color: var(--text-warning);
  font-size: var(--font-ui-smaller);
  line-height: 1.45;
  margin: 0 0 12px;
  padding: 9px 11px;
  border: 1px solid rgba(var(--color-orange-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--color-orange-rgb), 0.08);
}

.superpower-inside-settings-tab-panels {
  min-width: 0;
}

.superpower-inside-settings-tab-content.is-active {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.superpower-inside-settings-panel {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-primary);
}

.superpower-inside-settings-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.superpower-inside-settings-panel-title {
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: 700;
  line-height: 1.3;
}

.superpower-inside-settings-panel-desc,
.superpower-inside-settings-panel-meta {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  line-height: 1.45;
}
```

- [ ] Step 5: Run `npm run typecheck`.

Expected: no type errors from helper insertion.

If typecheck fails because helper template string has class spacing issue, fix helper only.

### Task 2: Overview Card Compression Fix

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: In `buildGeneralTab()`, replace bare basics section with common panel.

Change:

```ts
const basics = containerEl.createDiv({ cls: 'superpower-inside-overview-basics' });
basics.createDiv({ cls: 'superpower-inside-overview-section-title', text: '기본 설정' });
```

To:

```ts
const basics = this.createSettingsPanel(containerEl, '기본 설정', {
  description: '언어, 설정 저장 방식, 기본 채팅 모델을 조정합니다.',
  className: 'superpower-inside-overview-basics',
});
```

- [ ] Step 2: Make Overview metric grid wider and less cramped.

Change CSS:

```css
.superpower-inside-overview-metrics {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
```

- [ ] Step 3: Make metric card breathe.

Change CSS:

```css
.superpower-inside-overview-metric {
  min-height: 104px;
  padding: 11px;
  gap: 5px 8px;
}
```

- [ ] Step 4: Allow detail text to wrap.

Change CSS:

```css
.superpower-inside-overview-metric-detail {
  display: -webkit-box;
  overflow: hidden;
  white-space: normal;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
```

- [ ] Step 5: Stabilize Overview matrix.

Change CSS:

```css
.superpower-inside-overview-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 760px) {
  .superpower-inside-overview-matrix {
    grid-template-columns: 1fr;
  }
}
```

- [ ] Step 6: Fix status row compression.

Change CSS:

```css
.superpower-inside-overview-status-row,
.superpower-inside-overview-action-row {
  grid-template-columns: minmax(130px, 1fr) auto;
  padding: 8px 9px;
  gap: 5px 8px;
}

.superpower-inside-overview-status-value {
  grid-column: 1 / -1;
  justify-self: start;
}

.superpower-inside-overview-status-detail {
  grid-column: 1 / -1;
  white-space: normal;
  overflow-wrap: anywhere;
}
```

- [ ] Step 7: Confirm no explicit CSS keeps Overview detail in one-line ellipsis.

Run:

```fish
rg -n "overview.*nowrap|overview.*ellipsis|overview-metrics|minmax\\(116px" styles.css
```

Expected: no `minmax(116px` result; any `nowrap` should only be labels/badges, not details.

### Task 3: Providers Tab Full Redesign Into Shared Panels

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: Add tab intro panel to `buildProvidersTab()`.

At top of `buildProvidersTab(containerEl)`, add:

```ts
this.createSettingsPanel(containerEl, '프로바이더', {
  description:
    '채팅과 명령어 실행에 사용할 LLM provider를 관리합니다. 활성화, 모델 선택, 연결 검증을 provider별로 확인합니다.',
  meta: `${CHAT_PROVIDER_KEYS.length + this.plugin.settings.customOpenAIProviders.length}개 구성`,
  className: 'superpower-inside-settings-intro-panel',
});
```

Note: If this creates a panel with only text and feels too heavy in the UI, keep it as a compact intro panel using CSS. Do not remove it until Obsidian screenshot says it is worse.

- [ ] Step 2: Change provider card class composition.

Current:

```ts
cls: 'superpower-inside-settings-section superpower-inside-provider-card',
```

Change to:

```ts
cls: 'superpower-inside-settings-panel superpower-inside-provider-card',
```

- [ ] Step 3: Keep provider title row, selected count, toggles, API key, custom provider fields unchanged.

No save logic changes.

- [ ] Step 4: Style provider card to match panel grammar.

Update CSS:

```css
.superpower-inside-provider-card {
  margin-top: 0;
}

.superpower-inside-provider-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.superpower-inside-provider-selected-count {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
}

.superpower-inside-provider-model-controls {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin: 10px 0 8px;
}
```

- [ ] Step 5: Make model list stable.

Update:

```css
.superpower-inside-settings-model-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
}

.superpower-inside-settings-model-item {
  min-height: 30px;
  padding: 6px 9px;
}
```

- [ ] Step 6: Verify provider model search still filters and checkboxes still save manually in Obsidian later.

### Task 4: RAG Tab Alignment Without Breaking Status Updates

**Files:**

- Modify: `styles.css`
- Optional Modify: `src/settings.ts`

- [ ] Step 1: Do not rewrite RAG status update methods in this task.

Reason: `ragStatusGrid`, `ragStatusAction`, `ragStatusDetails`, `ragStatusTimestamp` are stored as DOM references. Rebuilding this flow is high risk and not needed for design language.

- [ ] Step 2: Make all RAG sections visually match shared panel.

Update CSS:

```css
.superpower-inside-rag-section,
.superpower-inside-rag-advanced {
  min-width: 0;
  margin: 0;
  padding: 14px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-primary);
}

.superpower-inside-rag-section-title {
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 10px;
}
```

- [ ] Step 3: Fix RAG status card width.

Update:

```css
.superpower-inside-rag-status-grid {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.superpower-inside-rag-status-item {
  padding: 11px;
  border-radius: 8px;
  background: var(--background-secondary);
}

.superpower-inside-rag-status-value {
  line-height: 1.35;
  overflow-wrap: anywhere;
}
```

- [ ] Step 4: Make RAG controls consistent.

Update:

```css
.superpower-inside-rag-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.superpower-inside-rag-controls button {
  border-radius: 6px;
}
```

- [ ] Step 5: Verify by screenshot that RAG status no longer looks like four tall cramped boxes.

### Task 5: Chat Tab Structural Redesign

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: Replace bare settings with panels in `buildChatTab()`.

Create these panels at the start:

```ts
const storagePanel = this.createSettingsPanel(containerEl, '저장', {
  description: '채팅 세션 저장 위치와 자동 저장 방식을 관리합니다.',
});
const promptPanel = this.createSettingsPanel(containerEl, '시스템 프롬프트', {
  description: '전역 기본 프롬프트와 빠른 프리셋을 관리합니다.',
});
const toolPanel = this.createSettingsPanel(containerEl, 'MCP 도구 실행', {
  description: '멘션한 MCP 서버와 도구 호출 재시도 정책을 조정합니다.',
});
```

- [ ] Step 2: Move chat save folder `new Setting` into `storagePanel`.

Change:

```ts
new Setting(containerEl)
```

To:

```ts
new Setting(storagePanel)
```

For `chatSaveFolder`.

- [ ] Step 3: Move system prompt `new Setting` into `promptPanel`.

For `systemPrompt`.

- [ ] Step 4: Move prompt preset rows into `promptPanel`.

Change:

```ts
const presetRow = containerEl.createDiv({ cls: 'superpower-inside-chat-presets' });
```

To:

```ts
const presetRow = promptPanel.createDiv({ cls: 'superpower-inside-chat-presets' });
```

And reset row likewise.

- [ ] Step 5: Move MCP tool execution policy and enforce retry into `toolPanel`.

Use `new Setting(toolPanel)` for:

- `mcpToolExecutionPolicy`
- `enforceMcpTools`

- [ ] Step 6: Move auto save toggle and delay into `storagePanel`.

Use `new Setting(storagePanel)` for:

- `chatAutoSave`
- `chatAutoSaveDelay`

- [ ] Step 7: Style Chat textarea and preset row.

Add CSS:

```css
.superpower-inside-settings-panel textarea {
  width: 100%;
}

.superpower-inside-chat-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 10px 0 0;
}

.superpower-inside-mcp-preset-btn {
  border-radius: 6px;
  background: var(--background-secondary);
}
```

- [ ] Step 8: Verify prompt library button still opens modal and preset click still saves active prompt.

### Task 6: MCP Tab Structural Redesign

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: Replace root `mcpSection` with a tab body using panels.

Current:

```ts
const mcpSection = containerEl.createDiv();
```

Change to:

```ts
const mcpSection = containerEl.createDiv({ cls: 'superpower-inside-mcp-tab' });
const statusPanel = this.createSettingsPanel(mcpSection, '연결 상태', {
  description: '활성 MCP 서버의 연결 상태를 확인하고 재연결합니다.',
});
const pathPanel = this.createSettingsPanel(mcpSection, t('mcpPathTitle'), {
  description: t('mcpPathDesc'),
});
const editorPanel = this.createSettingsPanel(mcpSection, t('mcpJsonEditor'), {
  description: '표준 mcpServers JSON으로 서버를 편집합니다. 유효한 JSON은 자동 저장됩니다.',
});
```

- [ ] Step 2: Move PATH collapse header/content into `pathPanel`.

Create `pathHeader` from `pathPanel`, not `mcpSection`.

- [ ] Step 3: Remove duplicate standalone `pathDesc`.

Because `pathPanel` description now contains `t('mcpPathDesc')`.

- [ ] Step 4: Move MCP status into `statusPanel`.

Change:

```ts
const statusSection = mcpSection.createDiv({ cls: 'superpower-inside-mcp-status' });
```

To:

```ts
const statusSection = statusPanel.createDiv({ cls: 'superpower-inside-mcp-status' });
```

- [ ] Step 5: Move JSON editor into `editorPanel`.

Use `editorPanel` for:

- lint status
- `jsonTextArea`
- manual save `new Setting(...)`

Change final manual save:

```ts
new Setting(mcpSection).addButton(...)
```

To:

```ts
new Setting(editorPanel).addButton(...)
```

- [ ] Step 6: Remove visual dividers.

Do not create `superpower-inside-mcp-section-divider` after panel split. The panels themselves create separation.

- [ ] Step 7: Style MCP tab.

Add/update:

```css
.superpower-inside-mcp-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.superpower-inside-mcp-status {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.superpower-inside-mcp-status-item {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 7px 0;
}

.superpower-inside-mcp-json-editor {
  min-height: 260px;
  border-radius: 8px;
  background: var(--background-secondary);
}
```

- [ ] Step 8: Verify MCP reconnect button still works and JSON lint/autosave still updates status.

### Task 7: Advanced Tab Redesign

**Files:**

- Modify: `src/settings.ts`
- Modify: `styles.css`

- [ ] Step 1: Wrap advanced content in a panel.

In `buildAdvancedTab()`:

```ts
const pluginAwarePanel = this.createSettingsPanel(containerEl, '플러그인 인식 생성', {
  description: '활성 플러그인 정보를 LLM 프롬프트에 포함해 Obsidian 문법 호환성을 높입니다.',
});
```

- [ ] Step 2: Move existing Setting into `pluginAwarePanel`.

Change:

```ts
new Setting(containerEl)
```

To:

```ts
new Setting(pluginAwarePanel)
```

- [ ] Step 3: Move help and warning into the same panel.

Change `containerEl.createDiv(...)` calls after the Setting to `pluginAwarePanel.createDiv(...)`.

- [ ] Step 4: Keep `shouldShowPluginAwareContext7Warning()` logic unchanged.

### Task 8: CSS Cleanup Pass

**Files:**

- Modify: `styles.css`

- [ ] Step 1: Search for duplicate/contradictory selectors.

Run:

```fish
rg -n "superpower-inside-settings-warning|superpower-inside-overview-metrics|superpower-inside-mcp-status \\{|superpower-inside-mcp-preset-btn|superpower-inside-rag-section \\{" styles.css
```

- [ ] Step 2: Keep the later rule only if it intentionally overrides an earlier broad rule.

- [ ] Step 3: Remove accidental duplicate declarations.

Known existing duplicate:

```css
.superpower-inside-overview-metric-label {
  color: var(--text-muted);
  color: var(--text-muted);
}
```

Remove one line.

- [ ] Step 4: Ensure no `letter-spacing: -...` is introduced.

Run:

```fish
rg -n "letter-spacing:\\s*-" styles.css
```

Expected: no results.

### Task 9: Static Verification

**Files:**

- No intentional source edits unless verification finds a bug.

- [ ] Run lint:

```fish
npm run lint
```

Expected: exit 0.

- [ ] Run typecheck:

```fish
npm run typecheck
```

Expected: exit 0.

- [ ] Run tests:

```fish
npm run test
```

Expected: exit 0.

- [ ] Run production build:

```fish
npm run build
```

Expected: exit 0 and `main.js` generated.

### Task 10: Obsidian Visual Verification

**Files:**

- No source edits unless visual verification finds a real issue.

- [ ] Ensure development bundle is current.

If build already ran after edits, use the built `main.js`. If live watch is needed:

```fish
npm run dev
```

- [ ] Use existing Obsidian `.test-vault` window or launch:

```fish
./scripts/launch-obsidian-debug.fish
```

- [ ] Open Settings -> Community plugins -> Superpower Inside.

- [ ] Inspect Overview.

Pass criteria:

- top metric cards are readable
- no Korean text is split into narrow vertical fragments
- card details can show meaningful information
- status matrix feels like same dashboard, not cramped table fragments

- [ ] Inspect Providers.

Pass criteria:

- each provider card matches Overview panel grammar
- model search, selected-only checkbox, model list, validation actions remain visible
- selected count/badges do not overlap API key fields

- [ ] Inspect RAG.

Pass criteria:

- RAG status cards are no longer tall skinny columns
- controls and advanced sections use same card surface
- GraphRAG and RAG status still update

- [ ] Inspect Chat.

Pass criteria:

- settings are grouped into clear panels
- prompt textarea does not look squeezed
- preset buttons wrap cleanly
- tool policy and autosave are not visually mixed together

- [ ] Inspect MCP.

Pass criteria:

- connection health, PATH, JSON editor are clearly separated panels
- JSON editor has stable height
- save button and lint status are visually attached to editor
- status list rows do not overlap

- [ ] Inspect Advanced.

Pass criteria:

- tab no longer feels empty/bare
- plugin-aware toggle, limitation notice, Context7 warning share panel style

- [ ] Capture screenshots for at least Overview, RAG, Chat, MCP.

Use app screenshot/browser/computer-use capability available in the current environment.

## 5. Failure Handling

- If TypeScript fails after helper insertion:
  - inspect only `src/settings.ts`
  - fix helper signature/class string
  - do not touch provider/RAG/MCP logic
- If lint flags long lines:
  - wrap strings or object literals
  - do not add `eslint-disable`
- If Obsidian UI shows nested cards:
  - remove extra `superpower-inside-settings-panel` from inner containers
  - keep only top-level tab sections as panels
- If MCP JSON autosave breaks:
  - revert only the MCP DOM move in `buildMCPTab()`
  - keep shared CSS changes
  - reapply MCP redesign in smaller steps
- If RAG live status stops updating:
  - restore original creation order for `ragStatusGrid`, `ragStatusAction`, `ragStatusDetails`, `ragStatusTimestamp`
  - keep CSS-only alignment for RAG

## 6. Completion Checklist

- [ ] `docs/superpowers/plans/2026-06-02-settings-redesign.md` exists and matches implemented scope.
- [ ] `src/settings.ts` contains shared panel helper.
- [ ] `display()` adds `superpower-inside-settings-root`.
- [ ] tab panel wrapper has `superpower-inside-settings-tab-panels`.
- [ ] Overview metric grid no longer uses `minmax(116px, 1fr)`.
- [ ] Overview detail text is not forced into one-line ellipsis.
- [ ] Chat tab uses at least storage/prompt/tool panels.
- [ ] MCP tab uses at least status/path/editor panels.
- [ ] Advanced tab uses a panel.
- [ ] Providers and RAG sections visually match the common panel style.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.
- [ ] `npm run build` passes.
- [ ] Obsidian screenshots verify all tabs share one visual language and Overview is not compressed.

## Self-Review

- Requirement coverage: the plan covers tab-wide design language, Overview compression, full redesign, and actual Obsidian verification.
- Placeholder scan: there are no unfinished placeholder markers. Each task names concrete files, selectors, and expected code movements.
- Scope control: the plan changes UI structure and CSS only. It explicitly preserves provider/RAG/MCP/chat behavior.
- Risk handling: RAG and MCP dynamic areas have rollback/fallback instructions because they keep DOM references and live event wiring.
