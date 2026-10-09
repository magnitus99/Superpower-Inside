import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const styles = readFileSync(resolve(root, 'styles.css'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'src/settings.ts'), 'utf8');
const mainSource = readFileSync(resolve(root, 'main.ts'), 'utf8');
const diagnosticsViewSource = readFileSync(resolve(root, 'src/diagnostics/view.ts'), 'utf8');
const logViewPath = resolve(root, 'src/logs/view.ts');

describe('설정 화면 리디자인 구조', () => {
  it('채팅·임베딩 모델 제거 버튼을 저장과 확인을 수행하는 동작에 연결한다', () => {
    const start = settingsSource.indexOf('private buildProviderProfileModelSection(');
    const end = settingsSource.indexOf('private openProviderModelImportModal(', start);
    const source = settingsSource.slice(start, end);
    expect(source).toContain("removeButton.addEventListener('click'");
    expect(source).toContain('this.removeProviderProfileModel(profile, model.id, removeButton)');
  });
  it('YAML 제외 영역에서 토글 명령의 현재 핫키와 기본 설정 화면 진입을 제공한다', () => {
    const start = settingsSource.indexOf('private buildFrontmatterExclusions(');
    const end = settingsSource.indexOf('private buildIndexingOptionsSection(', start);
    const source = settingsSource.slice(start, end);
    expect(source).toContain('getDocumentExclusionHotkeyLabel');
    expect(source).toContain('openDocumentExclusionHotkeys');
    expect(source).toContain("t('documentExclusionHotkeyUnset')");
    expect(source).toContain("t('documentExclusionHotkeyUnavailable')");
    expect(source).not.toContain('saveSettings(');
    expect(mainSource).toContain('id: TOGGLE_DOCUMENT_EXCLUSION_COMMAND_ID');
    expect(mainSource).toContain('toggleDocumentExclusion(this.app, file)');
    expect(mainSource).toContain("if (!file || file.extension !== 'md') return false;");
    const commandStart = mainSource.indexOf('id: TOGGLE_DOCUMENT_EXCLUSION_COMMAND_ID');
    const commandEnd = mainSource.indexOf("id: 'open-ai-chat'", commandStart);
    expect(mainSource.slice(commandStart, commandEnd)).not.toContain('hotkeys:');
  });
  it('YAML 제외 문서 목록은 읽기 전용이고 문서 변경 시 새로고침한다', () => {
    const start = settingsSource.indexOf('private buildFrontmatterExclusions(');
    const end = settingsSource.indexOf('private buildIndexingOptionsSection(', start);
    const source = settingsSource.slice(start, end);
    expect(source).toContain('getFrontmatterExcludedFiles');
    expect(source).toContain("'aria-live': 'polite'");
    expect(source).not.toContain('removeButton');
    expect(source).not.toContain('.modify(');
    for (const event of ['create', 'modify', 'delete', 'rename'])
      expect(source).toContain(`this.app.vault.on('${event}', render)`);
    expect(source).toContain('this.app.vault.offref(ref)');
    expect(settingsSource).toContain('this.frontmatterExclusionRenderer?.()');
  });
  it('공통 섹션 제목은 Obsidian heading을 쓰고 저장 상태는 화면 제목 옆에 둔다', () => {
    const start = settingsSource.indexOf('private createSettingsSection(');
    const end = settingsSource.indexOf('private createSettingsStatusRow(', start);
    const section = settingsSource.slice(start, end);
    expect(section).toContain('new Setting(header)');
    expect(section).toContain('.setHeading()');
    expect(section).toContain("setAttribute('aria-level', '3')");
    expect(section).not.toContain('copy.createDiv(');
    expect(settingsSource).toContain('this.saveStateEl = heading.controlEl.createDiv(');
  });

  it('수평 탭은 Obsidian 기본 버튼의 그림자와 둥근 테두리를 제거한다', () => {
    expect(
      /\.superpower-inside-settings-root \.superpower-inside-settings-tab\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none/s.test(
        styles,
      ),
    ).toBe(true);
  });

  it('모델 검사 시각과 오류는 전체 행에 배치하고 좁은 폭의 행동은 다음 줄로 옮긴다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-provider-profile-model-section \.superpower-inside-settings-model-item\s*\{[^}]*flex-shrink:\s*0/s,
    );
    expect(styles).toMatch(
      /\.superpower-inside-provider-profile-model-section \.superpower-inside-provider-model-checked,\s*\.superpower-inside-provider-profile-model-section \.superpower-inside-settings-input-feedback\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/s,
    );
    expect(styles).toMatch(
      /@container superpower-inside-settings \(max-width: 520px\)\s*\{\s*\.superpower-inside-provider-profile-model-section \.superpower-inside-settings-model-item\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
    );
    expect(styles).toMatch(
      /@container superpower-inside-settings \(max-width: 520px\)\s*\{[^]*?\.superpower-inside-provider-profile-model-section \.superpower-inside-provider-model-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
  });
  it('ChatGPT는 브라우저 로그인 행을 제공하고 API 키와 중계 URL 입력을 숨긴다', () => {
    const start = settingsSource.indexOf(
      "if (profile.strategy === 'openAIChatGPT') {",
      settingsSource.indexOf('private buildProviderConnectionSettings('),
    );
    const end = settingsSource.indexOf('if (shouldShowProviderApiKey(', start);
    const source = settingsSource.slice(start, end);
    expect(source).toContain('buildChatGPTLoginSettings(group, profile.id');
    expect(source).toContain('return;');
    const login = readFileSync(resolve(root, 'src/llm/chatgpt-login-ui.ts'), 'utf8');
    expect(login).toContain('await chatGPTOAuth.startLogin(profileId)');
    expect(login).toContain('await login.completed');
    expect(login).toContain("'aria-live': 'polite'");
  });
  it('설정과 검색은 조밀한 행과 명확한 섹션 간격을 같은 토큰으로 사용한다', () => {
    expect(styles).toMatch(/--superpower-inside-section-gap:\s*24px/);
    expect(styles).toMatch(/--superpower-inside-section-padding:\s*16px/);
    expect(styles).toMatch(/--superpower-inside-row-padding:\s*8px/);
    expect(styles).toMatch(/--superpower-inside-surface-radius:\s*8px/);
    for (const prefix of ['settings', 'rag']) {
      expect(styles).toContain(
        `--superpower-inside-${prefix}-section-gap: var(--superpower-inside-section-gap)`,
      );
      expect(styles).toContain(
        `--superpower-inside-${prefix}-radius: var(--superpower-inside-surface-radius)`,
      );
    }
  });

  it('섹션은 제목과 간격으로 구분하고 상태 요약에만 경계 하나를 둔다', () => {
    expect(
      /\.superpower-inside-settings-section-header\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent/s.test(
        styles,
      ),
    ).toBe(true);
    for (const prefix of ['settings', 'rag']) {
      expect(
        new RegExp(`\\.superpower-inside-${prefix}-section-body\\s*\\{[^}]*padding:\\s*0;`).test(
          styles,
        ),
      ).toBe(true);
      expect(styles).toMatch(
        new RegExp(
          `\\.superpower-inside-${prefix}-section\\s*\\{[^}]*border:\\s*0;[^}]*background:\\s*transparent`,
        ),
      );
    }
    expect(
      /\.superpower-inside-rag-group-title\s*\{[^}]*margin-bottom:\s*var\(--superpower-inside-rag-row-padding\)/.test(
        styles,
      ),
    ).toBe(true);
  });

  it('수평 탭은 글자를 줄이지 않고 바 안에서만 스크롤하며 선택을 드러낸다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-settings-tabs\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;[^}]*border:\s*0/s,
    );
    expect(settingsSource).toContain(
      "button.scrollIntoView({ block: 'nearest', inline: 'nearest' })",
    );
    expect(styles).not.toMatch(
      /\.superpower-inside-chat-assistant-response-tab\s*\{[^}]*font-size:\s*11px/s,
    );
  });

  it('동일 그룹 내부 행과 펼침 영역은 중복 선을 만들지 않는다', () => {
    for (const selector of [
      '.superpower-inside-settings-section-body > .setting-item',
      '.superpower-inside-settings-row',
      '.superpower-inside-settings-disclosure',
      '.superpower-inside-settings-disclosure-content > .setting-item',
      '.superpower-inside-local-models .setting-item.superpower-inside-local-model-row',
    ]) {
      const start = styles.indexOf(`${selector} {`);
      const rule = styles.slice(start, styles.indexOf('}', start));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(rule).not.toMatch(/border-(?:top|bottom):\s*1px/);
    }
  });

  it('긴 복구 행동은 네이티브 버튼 높이와 줄바꿈 제한을 해당 영역에서 해제한다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-settings-primary-action\s*\{[^}]*height:\s*auto;[^}]*white-space:\s*normal/s,
    );
    expect(styles).toMatch(
      /\.superpower-inside-rag-controls-group button\s*\{[^}]*height:\s*auto;[^}]*white-space:\s*normal/s,
    );
  });

  it('연결 행은 설명이 남은 폭을 채워 이름 길이와 무관하게 상태와 화살표를 정렬한다', () => {
    expect(
      /\.superpower-inside-settings-disclosure-copy\s*\{[^}]*flex:\s*1;[^}]*min-width:\s*0;/.test(
        styles,
      ),
    ).toBe(true);
    expect(
      /\.superpower-inside-provider-disclosure-status\s*\{[^}]*flex:\s*0 0 auto;/.test(styles),
    ).toBe(true);
  });

  it('설정 루트가 폭을 제공해 탭과 저장 상태에도 좁은 폭 규칙이 적용된다', () => {
    expect(
      /\.superpower-inside-settings-root\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*superpower-inside-settings/s.test(
        styles,
      ),
    ).toBe(true);
    expect(styles).toContain('flex: 0 1 260px;');
    expect(styles).toContain('flex: 0 1 auto;');
  });

  it('다섯 탭의 현재 상태는 공통 요약 영역으로 표시한다', () => {
    expect(settingsSource.match(/superpower-inside-settings-status-section/g)).toHaveLength(5);
    expect(styles).toMatch(
      /\.superpower-inside-settings-section\.superpower-inside-settings-status-section\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px/s,
    );
  });

  it('임베딩 연결이 없으면 상태 제목과 이유를 구분해 안내를 중복하지 않는다', () => {
    const start = settingsSource.indexOf('private buildEmbeddingProviderSection(');
    const end = settingsSource.indexOf(
      'this.disposeLocalModelSettings',
      settingsSource.indexOf('const localNote', start),
    );
    const source = settingsSource.slice(start, end);
    expect(source.match(/t\('ragIndexerSelectEmbeddingModel'\)/g)).toHaveLength(1);
    expect(source).toContain("t('ragOverviewUnavailable')");
    expect(source).toContain("selectedProvider ? 'shield-check' : 'circle-alert'");
  });

  it('임베딩 안내와 모델 파일은 공통 접힘 안에 두고 적용과 취소는 앞에 둔다', () => {
    const start = settingsSource.indexOf('private buildEmbeddingProviderSection(');
    const end = settingsSource.indexOf('const rag = this.plugin.settings.rag;', start);
    const source = settingsSource.slice(start, end);
    const details = source.indexOf('const modelDetails = this.createRagDisclosure(');
    expect(details).toBeGreaterThan(source.indexOf('const cancelBtn'));
    expect(source).toContain("'embedding-model-details'");
    expect(source).toContain("t('localModelsTitle')");
    expect(source).toContain(
      'const noteContainer = selectedProvider ? modelDetails.content : section;',
    );
    expect(source).toContain('noteContainer.createDiv(');
    expect(source).toMatch(/buildLocalEmbeddingModelSettings\(\s*modelDetails.content,/);
    const localSource = readFileSync(resolve(root, 'src/llm/local-embedding-settings.ts'), 'utf8');
    expect(localSource).not.toContain('.setHeading()');
    expect(localSource).toContain("text: t('localModelsDetail')");
  });

  it('기본 모델 파일은 카드 대신 평평한 행으로 표시하고 적용 버튼은 내용 폭을 따른다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-local-models \.setting-item\.superpower-inside-local-model-row\s*\{[^}]*margin:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s,
    );
    expect(styles).toMatch(
      /\.superpower-inside-rag-controls\.superpower-inside-embedding-pending-actions button\s*\{[^}]*flex:\s*0 1 auto;[^}]*min-width:\s*0/s,
    );
  });

  it('검색 품질은 기본값을 표시하고 세 항목만 초기화한다', () => {
    const start = settingsSource.indexOf('private buildSearchQualitySection(');
    const end = settingsSource.indexOf('private buildChatTab(', start);
    const section = settingsSource.slice(start, end);
    expect(section.match(/t\('searchQualityDefault'/g)).toHaveLength(3);
    expect(section).toContain('Object.assign(this.plugin.settings.rag, DEFAULT_SEARCH_QUALITY)');
    expect(section).toContain('this.debouncedRagSave()');
    expect(section).toContain('this.buildSearchQualitySection(containerEl)');
  });
  it('청크 크기 변경은 인덱스 세대를 바꾸므로 RAG 런타임 재초기화로 저장한다', () => {
    const start = settingsSource.indexOf('private buildIndexingOptionsSection(');
    const end = settingsSource.indexOf('private buildSearchQualitySection(', start);
    const section = settingsSource.slice(start, end);
    const handlerStart = section.indexOf('this.plugin.settings.rag.chunkSize = num');
    const handler = section.slice(handlerStart, handlerStart + 200);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('this.debouncedRagSave()');
  });
  it('검색 대상 형식은 제외 설정 바로 다음에 표시하고 규칙 변경 시 갱신한다', () => {
    const start = settingsSource.indexOf('private buildRagFoundationSection(');
    const end = settingsSource.indexOf('private buildFileTypeScopeSection(', start);
    const foundation = settingsSource.slice(start, end);
    expect(foundation).toMatch(/buildExcludeOptionsSection[\s\S]*buildTargetFileTypesSection/);
    expect(settingsSource).toContain('currentRevision !== revision');
    expect(settingsSource).toContain('this.fileScopeRenderer?.()');
    expect(settingsSource).not.toContain("path.includes('*')");
    expect(settingsSource).toContain('isExcludedPathRust(file.path, [path]) === true');
  });
  it('활성 탭 패널은 공통 flex 레이아웃을 사용한다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-settings-tab-content\.is-active\s*\{[\s\S]*display:\s*flex/,
    );
    expect(styles).toMatch(/\.superpower-inside-settings-tabs\s*\{[\s\S]*flex-wrap:\s*wrap/);
    expect(styles).toMatch(/\.superpower-inside-settings-tab\s*\{[\s\S]*flex:\s*0\s+0\s+auto/);
    expect(styles).toMatch(
      /\.superpower-inside-settings-status-detail,[\s\S]*white-space:\s*normal/,
    );
    expect(styles).toMatch(
      /\.superpower-inside-settings-disclosure-button\s*\{[\s\S]*white-space:\s*normal/,
    );
  });

  it('settings.ts는 범용 설정 section과 disclosure helper를 제공한다', () => {
    expect(settingsSource).toContain('private createSettingsSection(');
    expect(settingsSource).toContain('private createSettingsStatusRow(');
    expect(settingsSource).toContain('private createSettingsDisclosure(');
    expect(settingsSource).toContain('superpower-inside-settings-tab-panels');
    expect(settingsSource).toContain("'aria-expanded': 'false'");
    expect(settingsSource).toContain("'aria-controls': contentId");
    expect(settingsSource).toContain("setIcon(icon, 'chevron-right')");
  });

  it('General 탭은 상태, 기본 설정, 진단, 고급 및 복구 순서로 읽힌다', () => {
    const methodStart = settingsSource.indexOf('private buildGeneralTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildGeneralStatusSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);
    const expectedOrder = [
      'buildGeneralStatusSection',
      'buildGeneralBasicsSection',
      'buildAgentDiagnosticsSection',
      'buildGeneralAdvancedSection',
    ];

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-settings-workspace');
    const positions = expectedOrder.map((name) => methodSource.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('General 탭은 metric dashboard와 수동 새로고침을 제거한다', () => {
    const methodStart = settingsSource.indexOf('private buildGeneralTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildGeneralStatusSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).not.toContain('renderOverviewMetrics');
    expect(methodSource).not.toContain('superpower-inside-overview-metrics');
    expect(methodSource).not.toContain('superpower-inside-overview-refresh');
    expect(styles).not.toContain('.superpower-inside-overview-metrics');
  });

  it('General 상태는 첫 attention만 primary action으로 표시한다', () => {
    const methodStart = settingsSource.indexOf('private renderGeneralStatus(');
    const methodEnd = settingsSource.indexOf('\n  private buildGeneralBasicsSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('const primaryAttention = snapshot.attentionItems[0]');
    expect(methodSource).toContain('createSettingsActionRow');
    expect(methodSource).not.toContain('for (const item of snapshot.attentionItems)');
    expect(settingsSource).toContain('options.value !== options.statusLabel');
  });

  it('General의 세부 설정, 진단, 전체 초기화는 disclosure로 점진 공개한다', () => {
    const methodStart = settingsSource.indexOf('private buildGeneralBasicsSection');
    const methodEnd = settingsSource.indexOf('\n  private handlePluginDataReset', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('createSettingsDisclosure(');
    expect(methodSource).toContain("'general-auto-save-details'");
    expect(methodSource).toContain("'general-diagnostics'");
    expect(methodSource).toContain("'general-danger-zone'");
    expect(methodSource).toContain('pluginDataResetWarning');
    expect(methodSource).toContain('handlePluginDataReset(button)');
  });

  it('General 상태는 refresh bus 이벤트에서 전체 탭 대신 상태 section만 갱신한다', () => {
    const renderStart = settingsSource.indexOf('private renderSettingsView(): void');
    const renderEnd = settingsSource.indexOf(
      '\n  private unregisterRefreshBusSubscriptions',
      renderStart,
    );
    const renderSource = settingsSource.slice(renderStart, renderEnd);
    const refreshStart = settingsSource.indexOf('private refreshGeneralStatusSection(): void');
    const refreshEnd = settingsSource.indexOf(
      '\n  private repopulateDefaultModelDropdown',
      refreshStart,
    );
    const refreshSource = settingsSource.slice(refreshStart, refreshEnd);

    expect(renderSource).toContain("bus.on('rag'");
    expect(renderSource).toContain("bus.on('models'");
    expect(renderSource).toContain("bus.on('mcp'");
    for (const domain of ['rag', 'models', 'mcp']) {
      const start = renderSource.indexOf(`bus.on('${domain}'`);
      const next = renderSource.indexOf('bus.on(', start + 1);
      const callback = renderSource.slice(start, next < 0 ? undefined : next);
      expect(callback).toContain('this.refreshGeneralStatusSection()');
    }
    expect(refreshSource).toContain('this.generalStatusBody');
    expect(refreshSource).toContain('statusBody.isConnected');
    expect(refreshSource).not.toContain('this.buildGeneralTab');
  });

  it('Chat 탭은 현재 동작, 응답 기본값, 저장, 도구 사용 순서로 읽힌다', () => {
    const methodStart = settingsSource.indexOf('private buildChatTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildChatStatusSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);
    const expectedOrder = [
      'buildChatStatusSection',
      'buildChatPromptSection',
      'buildChatStorageSection',
      'buildChatToolsSection',
    ];

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-settings-workspace');
    expect(methodSource).toContain('superpower-inside-chat-settings-workspace');
    expect(methodSource).not.toContain('createSettingsPanel');
    const positions = expectedOrder.map((name) => methodSource.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('Chat의 프리셋, 저장 지연, 도구 재시도는 공통 disclosure로 점진 공개한다', () => {
    const methodStart = settingsSource.indexOf('private buildChatStatusSection');
    const methodEnd = settingsSource.indexOf('\n  private buildMCPTab', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('createSettingsStatusRow');
    expect(methodSource).toContain("'chat-prompt-shortcuts'");
    expect(methodSource).toContain("'chat-storage-details'");
    expect(methodSource).toContain("'chat-tool-details'");
    expect(methodSource).toContain('createSettingsNotice');
    expect(methodSource).toContain("value === 'always-auto'");
    expect(methodSource).toContain('openPromptLibraryModal');
    expect(methodSource).toContain('autoSaveDebounceMs');
    expect(methodSource).toContain('enforceMcpTools');
  });

  it('Chat 현재 동작은 저장된 기본 모델이 실제 사용 가능한지 점검한다', () => {
    const methodStart = settingsSource.indexOf('private buildChatStatusSection');
    const methodEnd = settingsSource.indexOf('\n  private buildChatPromptSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('resolveChatModelPlan');
    expect(methodSource).toContain('modelPlan.selectedModel');
    expect(methodSource).toContain('this.plugin.settings.chat.defaultModel');
    expect(methodSource).toContain("t('defaultModel')");
    expect(methodSource).toContain("t('chatReadinessModelMissingDetail')");
    expect(methodSource).not.toContain("t('chatStatusModelFallbackDetail')");
  });

  it('빠른 시작은 이름으로 미리보기를 펼치고 적용 행동과 초기화 영역을 구분한다', () => {
    const start = settingsSource.indexOf('private buildChatPromptSection(');
    const end = settingsSource.indexOf('\n  private applyChatPromptPreset(', start);
    const source = settingsSource.slice(start, end);

    expect(source).toContain('getChatPromptPresets().entries()');
    expect(styles).toMatch(
      /\.superpower-inside-settings-workspace button\.superpower-inside-settings-disclosure-button\s*\{[^}]*height:\s*auto;/s,
    );
    expect(source).toContain("className: 'superpower-inside-chat-preset-row'");
    expect(source).toContain("t('settingsPresetPreview') + ': ' + preset.label");
    expect(source).toContain('preview.content.before(button)');
    expect(source).not.toContain('superpower-inside-chat-preset-copy');
    expect(source).toContain("'chat-prompt-reset'");
    expect(source).toContain('new Setting(reset.content)');
    expect(source).toContain("confirmWithModal(this.app, t('settingsResetPromptConfirm'))");
    expect(styles).toMatch(
      /\.superpower-inside-chat-preset-row\s*>\s*\.superpower-inside-settings-disclosure-content\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(styles).toMatch(
      /\.superpower-inside-settings-prompt-preview\s*\{[^}]*padding:[^}]*line-height:/s,
    );
  });

  it('MCP 탭은 현재 연결, 서버 설정, 실행 환경 순서의 공통 section을 사용한다', () => {
    const methodStart = settingsSource.indexOf('private buildMCPTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildDetailedMcpError', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-settings-workspace');
    expect(methodSource).toContain('superpower-inside-mcp-settings-workspace');
    expect(methodSource).not.toContain('createSettingsPanel');
    expect(methodSource).toContain("'mcp-environment-details'");
    expect(methodSource).not.toContain('superpower-inside-mcp-collapsible-header');
    expect(methodSource).not.toContain("text: '▶'");
    const positions = [
      "t('mcpStatusSectionTitle')",
      "t('mcpServersSectionTitle')",
      "t('mcpEnvironmentSectionTitle')",
    ].map((text) => methodSource.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('MCP 연결 상태와 서버별 오류는 공통 status row와 하나의 재연결 행동을 사용한다', () => {
    const methodStart = settingsSource.indexOf('private renderMCPStatus(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private unregisterMcpStatusEvent', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('createSettingsStatusRow');
    expect(methodSource).toContain('new RefreshAction');
    expect(methodSource).toContain("setButtonText(t('mcpReconnect'))");
    expect(methodSource).not.toContain('superpower-inside-mcp-status-box');
    expect(methodSource).not.toContain('superpower-inside-mcp-status-dot');
  });

  it('Advanced 탭은 플러그인 인식 상태와 한계를 공통 status와 notice로 표현한다', () => {
    const methodStart = settingsSource.indexOf(
      'private buildAdvancedTab(containerEl: HTMLElement)',
    );
    const methodEnd = settingsSource.indexOf('\n  private buildProviderProfilesTab', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('superpower-inside-settings-workspace');
    expect(methodSource).toContain('superpower-inside-advanced-settings-workspace');
    expect(methodSource).toContain('createSettingsSection');
    expect(methodSource).toContain('createSettingsStatusRow');
    expect(methodSource.match(/createSettingsNotice/g)?.length).toBeGreaterThanOrEqual(2);
    expect(methodSource).toContain('shouldShowPluginAwareContext7Warning');
    expect(methodSource).not.toContain('createSettingsPanel');
    expect(methodSource).not.toContain('superpower-inside-settings-help');
    expect(methodSource).not.toContain('superpower-inside-settings-warning');
  });

  it('RAG 인덱스 통계는 비동기 상태 계산 이후 grid를 비워 중복 카드를 만들지 않는다', () => {
    const renderStatsStart = settingsSource.indexOf('private async renderStats(');
    const getStatusIndex = settingsSource.indexOf(
      'const status = await this.getRagStatus();',
      renderStatsStart,
    );
    const emptyIndex = settingsSource.indexOf('gridEl.empty();', renderStatsStart);

    expect(renderStatsStart).toBeGreaterThanOrEqual(0);
    expect(getStatusIndex).toBeGreaterThan(renderStatsStart);
    expect(emptyIndex).toBeGreaterThan(getStatusIndex);
  });

  it('RAG 탭은 작업 중심 흐름으로 네 개의 공통 섹션을 배치한다', () => {
    const methodStart = settingsSource.indexOf('private buildRAGTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildRagAdvancedSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);
    const expectedOrder = [
      'buildRagStatusPanel',
      'buildRagFoundationSection',
      'buildRagAdvancedSection',
    ];

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-rag-workspace');
    expect(methodSource).not.toContain('superpower-inside-rag-dashboard');
    expect(methodSource).not.toContain('superpower-inside-rag-settings-stack');

    const positions = expectedOrder.map((name) => methodSource.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('RAG 탭은 공통 section, group, disclosure helper로 디자인 언어를 통일한다', () => {
    const methodStart = settingsSource.indexOf('private buildRAGTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildRagAdvancedSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).not.toContain("createEl('details'");
    expect(settingsSource).toContain('private createRagSection(');
    expect(settingsSource).toContain('private createRagGroup(');
    expect(settingsSource).toContain('private createRagDisclosure(');
    expect(settingsSource).toContain('return this.createSettingsSection(');
    expect(settingsSource).toContain('return this.createSettingsDisclosure(');
    expect(settingsSource).toContain("'aria-expanded': 'false'");
    expect(settingsSource).toContain("'aria-controls': contentId");
    expect(settingsSource).toContain("setIcon(icon, 'chevron-right')");
    expect(styles).toContain('--superpower-inside-rag-section-gap');
    expect(styles).toContain('.superpower-inside-rag-section');
    expect(styles).toContain('.superpower-inside-rag-row');
    expect(styles).toContain('.superpower-inside-rag-disclosure');
    expect(styles).toContain('.superpower-inside-settings-section');
    expect(styles).toContain('.superpower-inside-settings-row');
    expect(styles).toContain('.superpower-inside-settings-disclosure');
    expect(styles).toContain('container-type: inline-size');
    expect(styles).toContain('@container superpower-inside-rag');
  });

  it('RAG 인덱싱 상태와 필요한 행동은 하나의 운영 섹션에 배치한다', () => {
    const statusStart = settingsSource.indexOf('private buildRagStatusPanel');
    const statusEnd = settingsSource.indexOf('\n  private createRagStatusItem', statusStart);
    const statusSource = settingsSource.slice(statusStart, statusEnd);
    const methodStart = settingsSource.indexOf('private buildControlsSection');
    const methodEnd = settingsSource.indexOf('\n  private updateRagControlStates', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(statusSource).toContain('buildControlsSection(section.body)');
    expect(methodSource).not.toContain('superpower-inside-rag-section');
    expect(methodSource).toContain('superpower-inside-rag-primary-actions');
    expect(methodSource).toContain('superpower-inside-rag-controls-group');
    expect(methodSource).toContain('createRagDisclosure');
    expect(methodSource).toContain('is-danger');
    expect(styles).toContain('.superpower-inside-rag-primary-actions');
    expect(styles).toContain('.superpower-inside-rag-controls-group button[hidden]');
  });

  it('RAG 런타임을 만들 수 없을 때 빈 카드 대신 원인과 한 가지 복구 행동을 표시한다', () => {
    const methodStart = settingsSource.indexOf('private renderRagUnavailableState(');
    const methodEnd = settingsSource.indexOf('\n  private renderRagStatusSummary', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain("t('ragOverviewUnavailable')");
    expect(methodSource).toContain("t('ragOverviewFixEmbedding')");
    expect(methodSource).toContain("t('ragOverviewCheckProvider')");
    expect(methodSource).toContain('resolveProviderModelRef(');
    expect(methodSource).toContain("this.switchTab('providers')");
    expect(methodSource).toContain('superpower-inside-rag-embedding-panel');
  });

  it('RAG 비동기 상태 결과는 현재 연결된 설정 DOM에만 반영한다', () => {
    const methodStart = settingsSource.indexOf('updateRagStats(indexingDetail?: string): void');
    const methodEnd = settingsSource.indexOf('\n  private renderRagUnavailableState', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('const isCurrentView = (): boolean =>');
    expect(methodSource).toContain('timestampEl.isConnected');
    expect(methodSource).toContain('if (!isCurrentView()) return;');
    expect(settingsSource).toContain('private resetRagDomReferences(): void');
  });

  it('RAG 인덱싱 진행 이벤트는 IndexedDB 통계를 다시 읽지 않고 상태 텍스트만 갱신한다', () => {
    const subscriptionStart = settingsSource.indexOf("bus.on('rag', (result) => {");
    const subscriptionEnd = settingsSource.indexOf('\n        }),', subscriptionStart);
    const subscriptionSource = settingsSource.slice(subscriptionStart, subscriptionEnd);
    const methodStart = settingsSource.indexOf('private updateRagIndexingProgress(');
    const methodEnd = settingsSource.indexOf('\n  updateRagStats(', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(subscriptionStart).toBeGreaterThanOrEqual(0);
    expect(subscriptionSource).toContain('this.plugin.isRagIndexing()');
    expect(subscriptionSource).toContain('this.updateRagIndexingProgress(result.detail)');
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('.superpower-inside-rag-overview-status');
    expect(methodSource).not.toContain('this.getRagStatus()');
    expect(methodSource).not.toContain('this.updateRagStatsSection()');
    expect(methodSource).not.toContain('this.updateRagUpdateList()');
  });

  it('Providers 탭은 현재 상태와 연결 목록 순서로 공통 workspace를 사용한다', () => {
    const methodStart = settingsSource.indexOf(
      'private buildProvidersTab(containerEl: HTMLElement)',
    );
    const methodEnd = settingsSource.indexOf('\n  private buildRAGTab', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-settings-workspace');
    expect(methodSource).toContain('superpower-inside-provider-workspace');
    expect(methodSource).toContain('buildProviderStatusSection');
    expect(methodSource).toContain('buildProviderConnectionsSection');
    expect(methodSource.indexOf('buildProviderStatusSection')).toBeLessThan(
      methodSource.indexOf('buildProviderConnectionsSection'),
    );
  });

  it('Providers 상태는 첫 attention만 primary action으로 표시하고 추가 행동을 유지한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderStatusSection(');
    const methodEnd = settingsSource.indexOf(
      '\n  private buildProviderConnectionsSection',
      methodStart,
    );
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('createSettingsSection');
    expect(methodSource).toContain('createSettingsStatusRow');
    expect(methodSource).toContain('createSettingsActionRow');
    expect(methodSource).toContain('const firstAttention = profiles.find');
    expect(methodSource).toContain('createProviderProfile');
    expect(methodSource).not.toContain('superpower-inside-provider-summary-bar');
  });

  it('Provider 목록은 공통 disclosure로 동시에 하나만 펼친다', () => {
    const cardStart = settingsSource.indexOf('private buildProviderProfileDisclosure(');
    const cardEnd = settingsSource.indexOf('\n  private getProviderProfileStatusLabel', cardStart);
    const cardSource = settingsSource.slice(cardStart, cardEnd);

    expect(cardSource).toContain('createSettingsDisclosure');
    expect(cardSource).toContain(
      'this.expandedProviderProfileId === profile.id ? null : profile.id',
    );
    expect(cardSource).toContain('this.refreshProviderProfileDisclosures(containerEl)');
    expect(cardSource).toContain("'aria-expanded'");
    expect(cardSource).not.toContain('superpower-inside-provider-shell');
    expect(cardSource).not.toContain('superpower-inside-provider-hero');
  });

  it('Provider 모델 관리는 수동 추가 composer와 원격 가져오기 액션을 분리한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileModelSection');
    const methodEnd = settingsSource.indexOf(
      '\n  private openProviderModelImportModal',
      methodStart,
    );
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-provider-model-group');
    expect(methodSource).toContain('superpower-inside-provider-model-group-header');
    expect(methodSource).toContain('superpower-inside-provider-model-fetch-btn');
    expect(methodSource).toContain('superpower-inside-provider-model-add-row');
    expect(methodSource).toContain('superpower-inside-provider-model-add-input');
    expect(methodSource).toContain('superpower-inside-provider-model-add-btn');
    expect(methodSource).toContain('addButton.disabled = !input.value.trim()');
    expect(methodSource).toContain('getProviderConnectionSetupWarning(profile)');
    expect(methodSource).toContain("input.addEventListener('input'");
    expect(methodSource).toContain("input.addEventListener('keydown'");

    const controlsStart = methodSource.indexOf('superpower-inside-provider-model-add-row');
    const listStart = methodSource.indexOf('superpower-inside-settings-model-list');
    const composerSource = methodSource.slice(controlsStart, listStart);

    expect(composerSource).not.toContain('fetchProviderModelsForStrategy');
    expect(styles).toContain('.superpower-inside-provider-model-group');
    expect(styles).toContain('.superpower-inside-provider-model-group-header');
    expect(styles).toContain('.superpower-inside-provider-model-add-row');
    expect(styles).toContain('.superpower-inside-provider-model-add-btn:disabled');
  });

  it('Provider 모델 가져오기는 체크박스 포커스를 유지하고 제목을 접근 가능하게 제공한다', () => {
    const modalStart = settingsSource.indexOf('class ProviderModelImportModal extends Modal');
    const modalEnd = settingsSource.indexOf(
      '\nexport class SuperpowerInsideSettingTab',
      modalStart,
    );
    const modalSource = settingsSource.slice(modalStart, modalEnd);
    const changeStart = modalSource.indexOf("checkbox.addEventListener('change'");
    const changeEnd = modalSource.indexOf('\n      const copy =', changeStart);
    const changeSource = modalSource.slice(changeStart, changeEnd);

    expect(modalStart).toBeGreaterThanOrEqual(0);
    expect(modalSource).toContain("this.setTitle(t('providerImportModelsTitle'))");
    expect(modalSource).toContain('private refreshSelectionSummary(');
    expect(modalSource).toContain("'aria-live': 'polite'");
    expect(modalSource).toContain("'aria-atomic': 'true'");
    expect(changeStart).toBeGreaterThanOrEqual(0);
    expect(changeSource).toContain('this.refreshSelectionSummary(filtered.length)');
    expect(changeSource).not.toContain('this.renderList()');
  });

  it('Provider disclosure는 연결, 모델, 위험 작업 순서와 API key 마스킹을 유지한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileDisclosure(');
    const methodEnd = settingsSource.indexOf(
      '\n  private getProviderProfileStatusLabel',
      methodStart,
    );
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('buildProviderConnectionSettings');
    expect(methodSource).toContain('buildProviderProfileModelSection');
    expect(methodSource).toContain("'provider-danger'");
    expect(methodSource).toContain("t('providerModelCountLine'");
    expect(methodSource).toContain("text.inputEl.type = 'password'");
    expect(methodSource).toContain("const showLabel = t('providerApiKeyShow')");
    expect(methodSource).toContain('setTooltip(showLabel)');
    expect(settingsSource).toContain("confirmWithModal(this.app, t('providerRemoveConfirm'");
    expect(styles).toContain('.superpower-inside-provider-profile-content');
    expect(styles).toContain('@container superpower-inside-settings (max-width: 520px)');
  });

  it('Provider 연결 입력은 DOM 전체를 교체하지 않고 상태 표현만 갱신한다', () => {
    const connectionStart = settingsSource.indexOf('private buildProviderConnectionSettings(');
    const connectionEnd = settingsSource.indexOf(
      '\n  private renderProviderProfileAttention',
      connectionStart,
    );
    const connectionSource = settingsSource.slice(connectionStart, connectionEnd);
    const refreshStart = settingsSource.indexOf('private refreshProviderProfilePresentation(');
    const refreshEnd = settingsSource.indexOf(
      '\n  private invalidateProviderProfileVerification',
      refreshStart,
    );
    const refreshSource = settingsSource.slice(refreshStart, refreshEnd);

    expect(connectionStart).toBeGreaterThanOrEqual(0);
    expect(connectionSource).toContain('refreshProviderProfilePresentation');
    expect(connectionSource).not.toContain("addEventListener('blur'");
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(refreshSource).toContain('superpower-inside-provider-disclosure-status');
    expect(refreshSource).toContain('superpower-inside-provider-profile-attention');
    expect(refreshSource).toContain('refreshProviderStatusSection');
    expect(refreshSource).toContain('status.dataset.providerTone !== tone');
    expect(refreshSource).toContain('attention.dataset.providerTone !== tone');
    expect(refreshSource).not.toContain('refreshProvidersTab');
    expect(refreshSource).not.toContain('renderSettingsView');
    expect(settingsSource).not.toContain('scheduleProviderTabRefresh');
  });

  it('Provider 모델 변경 알림은 저장 성공 이후에만 발행한다', () => {
    const saveStart = settingsSource.indexOf('private saveSettingsWithFeedback(');
    const saveEnd = settingsSource.indexOf('\n  hide(): void', saveStart);
    const saveSource = settingsSource.slice(saveStart, saveEnd);
    const importStart = settingsSource.indexOf('private openProviderModelImportModal(');
    const importEnd = settingsSource.indexOf(
      '\n  private async verifyProviderProfileModel',
      importStart,
    );
    const importSource = settingsSource.slice(importStart, importEnd);

    expect(saveStart).toBeGreaterThanOrEqual(0);
    expect(saveSource.indexOf('await this.plugin.saveSettings(options)')).toBeLessThan(
      saveSource.indexOf('this.notifyProviderModelsChanged()'),
    );
    expect(saveSource.indexOf('this.notifyProviderModelsChanged()')).toBeLessThan(
      saveSource.indexOf('} catch'),
    );
    expect(saveSource).not.toContain('finally');
    expect(settingsSource).toContain('private debouncedProviderSave(reinitRag = true)');
    expect(settingsSource).toContain('this.debouncedSave({ reinitRag })');
    expect(importStart).toBeGreaterThanOrEqual(0);
    expect(importSource).toContain('onSubmit: async (modelIds) =>');
    expect(importSource).toContain(
      'await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false })',
    );
    expect(importSource).toContain('profile.models = previousModels');
    expect(
      importSource.indexOf('await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false })'),
    ).toBeLessThan(importSource.indexOf('this.notifyProviderModelsChanged()'));
    expect(settingsSource).toContain('onSubmit: (modelIds: string[]) => Promise<boolean>');
    const verifyStart = settingsSource.indexOf('private async verifyProviderProfileModel(');
    const verifyEnd = settingsSource.indexOf(
      '\n  private getProfileApiKeyVisibilityKey',
      verifyStart,
    );
    const verifySource = settingsSource.slice(verifyStart, verifyEnd);
    expect(verifySource).toContain('const persistVerification = async');
    expect(verifySource).toContain('getProviderConnectionSetupWarning(profile)');
    expect(verifySource).toContain('profileState.embeddingSupported');
    expect(verifySource).toContain(
      'await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false })',
    );
    expect(verifySource).toContain('profile.models = previousModels');

    const subscriptionStart = settingsSource.indexOf("bus.on('models', () => {");
    const subscriptionEnd = settingsSource.indexOf('\n        }),', subscriptionStart);
    const subscriptionSource = settingsSource.slice(subscriptionStart, subscriptionEnd);
    const repopulateStart = settingsSource.indexOf('private repopulateDefaultModelDropdown()');
    const repopulateEnd = settingsSource.indexOf(
      '\n  private createSettingsSection',
      repopulateStart,
    );
    const repopulateSource = settingsSource.slice(repopulateStart, repopulateEnd);
    expect(subscriptionSource).toContain('this.repopulateDefaultModelDropdown()');
    expect(repopulateSource).not.toContain("refreshBus.emit('models'");
  });

  it('RAG 상태 경고도 실제 임베딩 실행과 같은 usable provider 경계를 사용한다', () => {
    const methodStart = settingsSource.indexOf('private getRagSetupWarning(): string | null');
    const methodEnd = settingsSource.indexOf('\n  private diagnoseRAGInitFailure', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('resolveProviderProfileState');
    expect(methodSource).toContain('resolveUsableProviderModelRef');
    expect(methodSource).toContain("profileState.tone === 'needs-url'");
    expect(methodSource).toContain("profileState.tone === 'failed'");
  });

  it('펼친 Provider는 선택 헤더와 연결된 상세 문맥을 시각적으로 구분한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileDisclosure(');
    const methodEnd = settingsSource.indexOf(
      '\n  private getProviderProfileStatusLabel',
      methodStart,
    );
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('superpower-inside-provider-detail-context');
    expect(methodSource).toContain('superpower-inside-provider-detail-context-icon');
    expect(methodSource).toContain("t('providerDetailContextLabel')");
    expect(styles).toMatch(
      /\.superpower-inside-provider-disclosure\.is-open\s*>\s*\.superpower-inside-settings-disclosure-button/,
    );
    expect(styles).toMatch(
      /\.superpower-inside-provider-profile-content\s*\{[^}]*background:\s*transparent/s,
    );
    expect(styles).toContain('.superpower-inside-provider-detail-context');
    expect(styles).toMatch(
      /@container superpower-inside-settings \(max-width: 520px\)[\s\S]*\.superpower-inside-provider-profile-content/,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.superpower-inside-provider-disclosure/,
    );
  });

  it('설정 탭은 키보드 이동과 tab/tabpanel 관계를 제공한다', () => {
    expect(settingsSource).toContain("tabBar.setAttribute('role', 'tablist')");
    expect(settingsSource).toContain("role: 'tab'");
    expect(settingsSource).toContain("'aria-controls': panelId");
    expect(settingsSource).toContain("role: 'tabpanel'");
    expect(settingsSource).toContain(
      "'aria-labelledby': `superpower-inside-settings-tab-${tab.id}`",
    );
    expect(settingsSource).toContain("event.key === 'ArrowRight'");
    expect(settingsSource).toContain("event.key === 'ArrowLeft'");
    expect(settingsSource).toContain("event.key === 'Home'");
    expect(settingsSource).toContain("event.key === 'End'");
  });

  it('integrated logs are owned by Agent Diagnostics instead of a standalone Obsidian view', () => {
    expect(settingsSource).not.toContain("| 'logs'");
    expect(settingsSource).not.toContain("id: 'logs'");
    expect(settingsSource).not.toContain('buildLogsTab(');
    expect(settingsSource).not.toContain("switchTab('logs')");
    expect(settingsSource).not.toContain('loggingDebugPanelTitle');
    expect(settingsSource).not.toContain('openLogView');

    expect(existsSync(logViewPath)).toBe(false);
    expect(mainSource).not.toContain('LOG_VIEW_TYPE');
    expect(mainSource).not.toContain('LogView');
    expect(mainSource).not.toContain('registerView(LOG_VIEW_TYPE');
    expect(mainSource).not.toContain("addRibbonIcon('scroll-text'");
    expect(mainSource).not.toContain("id: 'open-log-view'");
    expect(mainSource).not.toContain('openLogView');

    expect(diagnosticsViewSource).toContain('saveSettingsLight');
    expect(diagnosticsViewSource).toContain('loggingMinLevel');
    expect(diagnosticsViewSource).toContain('loggingCopyVisible');
    expect(diagnosticsViewSource).toContain('loggingFilterSource');
  });

  it('Agent Diagnostics still opens as a readable root workspace tab', () => {
    const methodStart = mainSource.indexOf('openAgentDiagnosticsView(): void');
    const methodEnd = mainSource.indexOf('\n  private clearMcpRetryTimers', methodStart);
    const methodSource = mainSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).not.toContain('getRightLeaf');
    expect(methodSource).not.toContain('getLeftLeaf');
    expect(methodSource).toContain('createRootWorkspaceTabLeaf');
    expect(methodSource).toContain('AGENT_DIAGNOSTICS_VIEW_TYPE');
    expect(methodSource).toContain('revealLeaf');
  });

  it('로그 레벨별 색상 클래스가 CSS에 정의되어 있다', () => {
    for (const level of ['trace', 'debug', 'info', 'notice', 'warn', 'error', 'fatal']) {
      expect(styles).toContain(`.superpower-inside-log-entry--${level}`);
    }
  });
});
