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

  it('Advanced 탭은 플러그인 인식 상태와 한계를 공통 status와 notice로 표현한다', () => {
    const methodStart = settingsSource.indexOf('private buildAdvancedTab(containerEl: HTMLElement)');
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

  it('GraphRAG 동시 요청 수는 1부터 10까지의 슬라이더와 숫자값으로 표시한다', () => {
    expect(settingsSource).toContain("setName(t('graphRagConcurrentRequestsLabel'))");
    expect(settingsSource).toContain('.setLimits(1, 10, 1)');
    expect(settingsSource).toContain('.setDynamicTooltip()');
    expect(settingsSource).toContain('superpower-inside-graph-concurrency-value');
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
    const methodStart = settingsSource.indexOf('private buildProvidersTab(containerEl: HTMLElement)');
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
    const methodEnd = settingsSource.indexOf('\n  private buildProviderConnectionsSection', methodStart);
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
    const cardEnd = settingsSource.indexOf('\n  private getProviderProfileTone', cardStart);
    const cardSource = settingsSource.slice(cardStart, cardEnd);

    expect(cardSource).toContain('createSettingsDisclosure');
    expect(cardSource).toContain('this.expandedProviderProfileId === profile.id ? null : profile.id');
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

  it('Provider disclosure는 연결, 모델, 위험 작업 순서와 API key 마스킹을 유지한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileDisclosure(');
    const methodEnd = settingsSource.indexOf('\n  private getProviderProfileTone', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('buildProviderConnectionSettings');
    expect(methodSource).toContain('buildProviderProfileModelSection');
    expect(methodSource).toContain("'provider-danger'");
    expect(methodSource).toContain("t('providerModelCountLine'");
    expect(methodSource).toContain("text.inputEl.type = 'password'");
    expect(methodSource).toContain("setTooltip(t('providerApiKeyShow'))");
    expect(settingsSource).toContain("confirmWithModal(this.app, t('providerRemoveConfirm'");
    expect(styles).toContain('.superpower-inside-provider-profile-content');
    expect(styles).toContain('@container superpower-inside-settings (max-width: 520px)');
  });

  it('펼친 Provider는 선택 헤더와 연결된 상세 문맥을 시각적으로 구분한다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderProfileDisclosure(');
    const methodEnd = settingsSource.indexOf('\n  private getProviderProfileTone', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodSource).toContain('superpower-inside-provider-detail-context');
    expect(methodSource).toContain('superpower-inside-provider-detail-context-icon');
    expect(methodSource).toContain("t('providerDetailContextLabel')");
    expect(styles).toMatch(
      /\.superpower-inside-provider-disclosure\.is-open\s*>\s*\.superpower-inside-settings-disclosure-button/,
    );
    expect(styles).toContain('.superpower-inside-provider-profile-content::before');
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
