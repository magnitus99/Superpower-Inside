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
  it('활성 탭 패널은 공통 flex 레이아웃을 사용한다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-settings-tab-content\.is-active\s*\{[\s\S]*display:\s*flex/,
    );
    expect(styles).toContain('.superpower-inside-settings-panel');
    expect(styles).toMatch(
      /\.superpower-inside-settings-tabs\s*\{[\s\S]*flex-wrap:\s*wrap/,
    );
    expect(styles).toMatch(
      /\.superpower-inside-settings-tab\s*\{[\s\S]*flex:\s*0\s+0\s+auto/,
    );
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

    expect(methodSource).toContain("createSettingsDisclosure(");
    expect(methodSource).toContain("'general-auto-save-details'");
    expect(methodSource).toContain("'general-diagnostics'");
    expect(methodSource).toContain("'general-danger-zone'");
    expect(methodSource).toContain('pluginDataResetWarning');
    expect(methodSource).toContain('handlePluginDataReset(button)');
  });

  it('General 상태는 refresh bus 이벤트에서 전체 탭 대신 상태 section만 갱신한다', () => {
    const renderStart = settingsSource.indexOf('private renderSettingsView(): void');
    const renderEnd = settingsSource.indexOf('\n  private unregisterRefreshBusSubscriptions', renderStart);
    const renderSource = settingsSource.slice(renderStart, renderEnd);
    const refreshStart = settingsSource.indexOf('private refreshGeneralStatusSection(): void');
    const refreshEnd = settingsSource.indexOf('\n  private repopulateDefaultModelDropdown', refreshStart);
    const refreshSource = settingsSource.slice(refreshStart, refreshEnd);

    expect(renderSource).toContain("bus.on('rag'");
    expect(renderSource).toContain("bus.on('models'");
    expect(renderSource).toContain("bus.on('mcp'");
    expect(renderSource).toContain("bus.on('graph-data'");
    expect(renderSource.match(/this\.refreshGeneralStatusSection\(\)/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
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
      'buildGraphRagSection',
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

  it('GraphRAG 작업은 중첩 카드와 반복 disabled reason 대신 평평한 action row를 사용한다', () => {
    const renderStart = settingsSource.indexOf('private renderGraphRagActions(');
    const renderEnd = settingsSource.indexOf('\n  private async handleGraphRagAction', renderStart);
    const renderSource = settingsSource.slice(renderStart, renderEnd);

    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(renderSource).toContain('createGraphRagActionRow');
    expect(renderSource).not.toContain('createGraphRagActionCard');
    expect(renderSource).not.toContain('superpower-inside-rag-action-card');
    expect(renderSource).not.toContain('superpower-inside-rag-action-disabled-reason');
    expect(styles).toContain('.superpower-inside-rag-action-row');
    expect(styles).not.toContain('.superpower-inside-rag-action-row.is-primary');
    expect(styles).not.toContain('.superpower-inside-rag-action-card');
    expect(styles).not.toContain('.superpower-inside-rag-action-disabled-reason');
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

  it('Providers 탭은 간결한 연결 요약과 세로 카드 목록으로 빠르게 훑을 수 있다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfilesTab(');
    const methodEnd = settingsSource.indexOf('\n  private buildProviderProfileCard', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-provider-summary-bar');
    expect(methodSource).toContain('superpower-inside-provider-grid');
    expect(methodSource).toContain("t('providerSummaryLine'");
    expect(methodSource).toContain('this.expandedProviderProfileId = id');

    expect(styles).toContain('.superpower-inside-provider-summary-bar');
    expect(styles).toContain('.superpower-inside-provider-grid');
  });

  it('Providers 탭은 동시에 하나의 카드만 펼쳐 설정 밀도를 낮춘다', () => {
    const cardStart = settingsSource.indexOf('private buildProviderProfileCard(');
    const cardEnd = settingsSource.indexOf('\n  private getProviderProfileTone', cardStart);
    const cardSource = settingsSource.slice(cardStart, cardEnd);
    const refreshStart = settingsSource.indexOf('private refreshProviderProfileExpansion(');
    const refreshEnd = settingsSource.indexOf(
      '\n  private buildProviderStrategySelector',
      refreshStart,
    );
    const refreshSource = settingsSource.slice(refreshStart, refreshEnd);

    expect(cardSource).toContain(
      'this.expandedProviderProfileId === profile.id ? null : profile.id',
    );
    expect(cardSource).toContain('this.refreshProviderProfileExpansion(containerEl)');
    expect(refreshSource).toContain('key === this.expandedProviderProfileId');
    expect(refreshSource).toContain("setAttribute('aria-expanded', String(expanded))");
  });

  it('Provider 모델 관리는 수동 추가 composer와 원격 가져오기 액션을 분리한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileModelSection');
    const methodEnd = settingsSource.indexOf(
      '\n  private openProviderModelImportModal',
      methodStart,
    );
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-provider-model-section-header');
    expect(methodSource).toContain('superpower-inside-provider-model-toolbar');
    expect(methodSource).toContain('superpower-inside-provider-model-sync-btn');
    expect(methodSource).toContain('superpower-inside-provider-model-add-row');
    expect(methodSource).toContain('superpower-inside-provider-model-add-input');
    expect(methodSource).toContain('superpower-inside-provider-model-add-btn');
    expect(methodSource).toContain('addButton.disabled = !input.value.trim()');
    expect(methodSource).toContain("input.addEventListener('input'");
    expect(methodSource).toContain("input.addEventListener('keydown'");

    const controlsStart = methodSource.indexOf('superpower-inside-provider-model-add-row');
    const listStart = methodSource.indexOf('superpower-inside-settings-model-list');
    const composerSource = methodSource.slice(controlsStart, listStart);

    expect(composerSource).not.toContain('fetchProviderModelsForStrategy');
    expect(styles).toContain('.superpower-inside-provider-model-section-header');
    expect(styles).toContain('.superpower-inside-provider-model-toolbar');
    expect(styles).toContain('.superpower-inside-provider-model-add-row');
    expect(styles).toContain('.superpower-inside-provider-model-add-btn:disabled');
  });

  it('Provider 카드는 상태와 모델 수를 요약하고 민감한 키를 기본 마스킹한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileCard(');
    const methodEnd = settingsSource.indexOf('\n  private getProviderProfileTone', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-provider-shell');
    expect(methodSource).toContain('superpower-inside-provider-hero');
    expect(methodSource).toContain('superpower-inside-provider-status-token');
    expect(methodSource).toContain("t('providerModelCountLine'");
    expect(methodSource).toContain("text.inputEl.type = 'password'");
    expect(methodSource).toContain("setTooltip(t('providerApiKeyShow'))");
    expect(methodSource).toContain("profile.strategy !== 'ternlight'");
    expect(methodSource).toContain('aria-expanded');
    expect(methodSource).toContain('aria-controls');

    expect(styles).toContain('.superpower-inside-provider-status-token.is-ready');
    expect(styles).toContain('.superpower-inside-provider-status-token.is-needs-key');
    expect(styles).toContain('.superpower-inside-provider-status-token.is-needs-models');
  });

  it('Provider 카드는 중간 폭에서 2열 빈 칸을 만들지 않는 full-width 목록으로 배치한다', () => {
    const gridRule = styles.match(/\.superpower-inside-provider-grid\s*\{(?<body>[\s\S]*?)\n\}/);

    expect(gridRule?.groups?.body).toContain('display: flex');
    expect(gridRule?.groups?.body).toContain('flex-direction: column');
    expect(gridRule?.groups?.body).not.toContain('auto-fit');
    expect(gridRule?.groups?.body).not.toContain('repeat(2');
    expect(gridRule?.groups?.body).not.toContain('minmax(280px, 1fr)');
    expect(styles).not.toMatch(
      /@media[\s\S]*\.superpower-inside-provider-grid\s*,[\s\S]*grid-template-columns:\s*1fr/,
    );
  });

  it('Provider 카드 기본 레이아웃은 Obsidian 설정 모달의 좁은 content 폭에서도 눌리지 않는다', () => {
    const heroRule = styles.match(/\.superpower-inside-provider-hero\s*\{(?<body>[\s\S]*?)\n\}/);
    const bodyRule = styles.match(
      /(?:^|\n)\.superpower-inside-provider-body\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const summaryRule = styles.match(
      /\.superpower-inside-provider-summary-bar\s*\{(?<body>[\s\S]*?)\n\}/,
    );

    expect(heroRule?.groups?.body).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(heroRule?.groups?.body).toContain('min-height: 78px');
    expect(heroRule?.groups?.body).not.toContain('auto minmax(0, 1fr) auto auto auto');
    expect(bodyRule?.groups?.body).toContain('grid-template-columns: 1fr');
    expect(bodyRule?.groups?.body).not.toContain('minmax(220px, 0.8fr) minmax(320px, 1.2fr)');
    expect(bodyRule?.groups?.body).toContain('grid-template-areas:');
    expect(bodyRule?.groups?.body).toMatch(/['"]quick['"]/);
    expect(bodyRule?.groups?.body).toMatch(/['"]actions['"]/);
    expect(bodyRule?.groups?.body).toMatch(/['"]models['"]/);
    expect(summaryRule?.groups?.body).toContain('display: flex');
    expect(summaryRule?.groups?.body).toContain('justify-content: space-between');
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

  it('Provider 접힘 카드는 펼침 카드와 다른 2줄 compact header로 잘림을 피한다', () => {
    const collapsedHeroRule = styles.match(
      /\.superpower-inside-provider-card\.is-collapsed \.superpower-inside-provider-hero\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const collapsedIconRule = styles.match(
      /\.superpower-inside-provider-card\.is-collapsed \.superpower-inside-provider-brand-icon\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const collapsedStatusRule = styles.match(
      /\.superpower-inside-provider-card\.is-collapsed \.superpower-inside-provider-status-token\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const collapsedPreviewRule = styles.match(
      /\.superpower-inside-provider-card\.is-collapsed \.superpower-inside-provider-model-preview\s*\{(?<body>[\s\S]*?)\n\}/,
    );

    expect(collapsedHeroRule?.groups?.body).toContain('grid-template-areas:');
    expect(collapsedHeroRule?.groups?.body).toMatch(/['"]icon copy status chevron['"]/);
    expect(collapsedHeroRule?.groups?.body).toMatch(/['"]icon copy preview chevron['"]/);
    expect(collapsedHeroRule?.groups?.body).toContain(
      'grid-template-columns: auto minmax(0, 1fr) auto auto',
    );
    expect(collapsedHeroRule?.groups?.body).toContain(
      'grid-template-rows: minmax(22px, auto) minmax(22px, auto)',
    );
    expect(collapsedHeroRule?.groups?.body).toContain('align-content: center');
    expect(collapsedHeroRule?.groups?.body).toContain('min-height: 72px');
    expect(collapsedIconRule?.groups?.body).toContain('grid-area: icon');
    expect(collapsedStatusRule?.groups?.body).toContain('grid-area: status');
    expect(collapsedStatusRule?.groups?.body).toContain('min-height: 22px');
    expect(collapsedStatusRule?.groups?.body).toContain('align-self: center');
    expect(collapsedPreviewRule?.groups?.body).toContain('grid-area: preview');
    expect(collapsedPreviewRule?.groups?.body).toContain('justify-content: flex-end');
    expect(collapsedPreviewRule?.groups?.body).toContain('flex-wrap: nowrap');
    expect(collapsedPreviewRule?.groups?.body).toContain('overflow: hidden');
  });

  it('Provider 펼침 영역은 중첩 카드보다 정돈된 설정 surface로 보인다', () => {
    const expandedHeroRule = styles.match(
      /\.superpower-inside-provider-card\.is-expanded \.superpower-inside-provider-hero\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const bodyRule = styles.match(
      /(?:^|\n)\.superpower-inside-provider-body\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const quickFactRule = styles.match(
      /\.superpower-inside-provider-quick-fact\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const sectionRule = styles.match(
      /\.superpower-inside-provider-connection-panel,\n\.superpower-inside-provider-model-shell\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const expandedPreviewRule = styles.match(
      /\.superpower-inside-provider-card\.is-expanded \.superpower-inside-provider-model-preview\s*\{(?<body>[\s\S]*?)\n\}/,
    );

    expect(expandedHeroRule?.groups?.body).toContain('background: var(--background-secondary)');
    expect(expandedHeroRule?.groups?.body).toContain('border-bottom: 1px solid');
    expect(expandedPreviewRule?.groups?.body).toContain('display: none');
    expect(bodyRule?.groups?.body).toContain('gap: 0');
    expect(bodyRule?.groups?.body).toContain('background: var(--background-primary)');
    expect(quickFactRule?.groups?.body).toContain('border: 0');
    expect(quickFactRule?.groups?.body).toContain('background: transparent');
    expect(sectionRule?.groups?.body).toContain('border: 0');
    expect(sectionRule?.groups?.body).toContain('background: transparent');
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
