import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const styles = readFileSync(resolve(root, 'styles.css'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'src/settings.ts'), 'utf8');
const mainSource = readFileSync(resolve(root, 'main.ts'), 'utf8');
const logViewSource = readFileSync(resolve(root, 'src/logs/view.ts'), 'utf8');

describe('설정 화면 리디자인 구조', () => {
  it('Overview metric grid는 좁은 116px 카드로 압축되지 않는다', () => {
    expect(styles).not.toContain('minmax(116px, 1fr)');
    expect(styles).toMatch(
      /\.superpower-inside-overview-metrics\s*\{[\s\S]*minmax\(220px,\s*1fr\)/,
    );
  });

  it('활성 탭 패널은 공통 flex 레이아웃을 사용한다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-settings-tab-content\.is-active\s*\{[\s\S]*display:\s*flex/,
    );
    expect(styles).toContain('.superpower-inside-settings-panel');
  });

  it('settings.ts는 공통 설정 패널 helper와 tab panels wrapper를 제공한다', () => {
    expect(settingsSource).toContain('createSettingsPanel(');
    expect(settingsSource).toContain('superpower-inside-settings-tab-panels');
  });

  it('Overview 탭 맨 아래에 전체 플러그인 데이터 초기화 위험 구역을 배치한다', () => {
    const methodStart = settingsSource.indexOf('private buildGeneralTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildOverviewRuntimeState', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);
    const basicsIndex = methodSource.indexOf('superpower-inside-overview-basics');
    const resetIndex = methodSource.indexOf('buildPluginDataResetSection');

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(basicsIndex).toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeGreaterThan(basicsIndex);
    expect(settingsSource).toContain('resetPluginData(): Promise<void>');
    expect(settingsSource).toContain('pluginDataResetWarning');
    expect(styles).toContain('.superpower-inside-overview-danger-zone');
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

  it('RAG 탭은 운영 대시보드 흐름으로 핵심 섹션을 배치한다', () => {
    const methodStart = settingsSource.indexOf('private buildRAGTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildRagAdvancedSection', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);
    const expectedOrder = [
      'buildRagStatusPanel',
      'buildControlsSection',
      'buildEmbeddingProviderSection',
      'buildExcludeOptionsSection',
      'buildGraphRagOperationsSection',
      'buildRagAdvancedSection',
    ];

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-rag-dashboard');
    expect(methodSource).toContain('superpower-inside-rag-settings-stack');

    const positions = expectedOrder.map((name) => methodSource.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('RAG 인덱싱 제어는 실행 버튼과 위험 작업을 시각적으로 분리한다', () => {
    const methodStart = settingsSource.indexOf('private buildControlsSection');
    const methodEnd = settingsSource.indexOf('\n  private updateRagControlStates', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-rag-controls-panel');
    expect(methodSource).toContain('superpower-inside-rag-controls-group');
    expect(methodSource).toContain('is-danger');
    expect(styles).toContain('.superpower-inside-rag-controls-panel');
    expect(styles).toContain('.superpower-inside-rag-dashboard');
  });

  it('Providers 탭은 상단 상태 대시보드와 카드 그리드로 빠르게 훑을 수 있다', () => {
    const methodStart = settingsSource.indexOf('private buildProvidersTab(containerEl: HTMLElement)');
    const methodEnd = settingsSource.indexOf('\n  private buildRAGTab', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-providers-command-center');
    expect(methodSource).toContain('superpower-inside-provider-summary-grid');
    expect(methodSource).toContain('superpower-inside-provider-grid');
    expect(methodSource).toContain('getProviderVisualState');
    expect(methodSource).toContain('setAllProviderCardsExpanded');

    expect(styles).toContain('.superpower-inside-providers-command-center');
    expect(styles).toContain('.superpower-inside-provider-summary-grid');
    expect(styles).toContain('.superpower-inside-provider-grid');
  });

  it('Provider 카드는 상태 토큰, 모델 프리뷰, 액션 레일을 같은 화면에서 보여준다', () => {
    const methodStart = settingsSource.indexOf('private buildProviderSettings');
    const methodEnd = settingsSource.indexOf('\n  private getInitialProviderModels', methodStart);
    const methodSource = settingsSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).toContain('superpower-inside-provider-shell');
    expect(methodSource).toContain('superpower-inside-provider-hero');
    expect(methodSource).toContain('superpower-inside-provider-status-token');
    expect(methodSource).toContain('superpower-inside-provider-model-preview');
    expect(methodSource).toContain('superpower-inside-provider-action-rail');
    expect(methodSource).toContain('superpower-inside-provider-model-shell');
    expect(methodSource).toContain('aria-expanded');

    expect(styles).toContain('.superpower-inside-provider-status-token.is-ready');
    expect(styles).toContain('.superpower-inside-provider-status-token.is-needs-key');
    expect(styles).toContain('.superpower-inside-provider-status-token.is-needs-models');
    expect(styles).toContain('.superpower-inside-provider-action-rail');
    expect(styles).toContain('.superpower-inside-provider-model-shell');
  });

  it('Provider 카드는 중간 폭에서 2열 빈 칸을 만들지 않는 full-width 목록으로 배치한다', () => {
    const gridRule = styles.match(
      /\.superpower-inside-provider-grid\s*\{(?<body>[\s\S]*?)\n\}/,
    );

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
    const heroRule = styles.match(
      /\.superpower-inside-provider-hero\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const bodyRule = styles.match(
      /(?:^|\n)\.superpower-inside-provider-body\s*\{(?<body>[\s\S]*?)\n\}/,
    );
    const summaryRule = styles.match(
      /\.superpower-inside-provider-summary-grid\s*\{(?<body>[\s\S]*?)\n\}/,
    );

    expect(heroRule?.groups?.body).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(heroRule?.groups?.body).toContain('min-height: 78px');
    expect(heroRule?.groups?.body).not.toContain('auto minmax(0, 1fr) auto auto auto');
    expect(bodyRule?.groups?.body).toContain('grid-template-columns: 1fr');
    expect(bodyRule?.groups?.body).not.toContain('minmax(220px, 0.8fr) minmax(320px, 1.2fr)');
    expect(bodyRule?.groups?.body).toContain('grid-template-areas:');
    expect(bodyRule?.groups?.body).toContain('"quick"');
    expect(bodyRule?.groups?.body).toContain('"actions"');
    expect(bodyRule?.groups?.body).toContain('"models"');
    expect(summaryRule?.groups?.body).toContain('repeat(auto-fit, minmax(260px, 1fr))');
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
    expect(collapsedHeroRule?.groups?.body).toContain('"icon copy status chevron"');
    expect(collapsedHeroRule?.groups?.body).toContain('"icon copy preview chevron"');
    expect(collapsedHeroRule?.groups?.body).toContain('grid-template-columns: auto minmax(0, 1fr) auto auto');
    expect(collapsedHeroRule?.groups?.body).toContain('grid-template-rows: minmax(22px, auto) minmax(22px, auto)');
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

  it('통합 로그는 설정 탭이 아니라 별도 Obsidian view/page로 열린다', () => {
    expect(settingsSource).not.toContain("| 'logs'");
    expect(settingsSource).not.toContain("id: 'logs'");
    expect(settingsSource).not.toContain('buildLogsTab(');
    expect(settingsSource).not.toContain("switchTab('logs')");
    expect(settingsSource).not.toContain('loggingDebugPanelTitle');
    expect(settingsSource).not.toContain('openLogView');

    expect(mainSource).toContain('LOG_VIEW_TYPE');
    expect(mainSource).toContain('LogView');
    expect(mainSource).toContain('registerView(LOG_VIEW_TYPE');
    expect(mainSource).toContain("addRibbonIcon('scroll-text'");
    expect(mainSource).toContain("id: 'open-log-view'");

    expect(logViewSource).toContain('extends ItemView');
    expect(logViewSource).toContain('saveSettingsLight');
    expect(logViewSource).toContain('loggingMinLevel');
  });

  it('통합 로그는 사이드바 leaf가 아니라 root workspace tab으로 연다', () => {
    const methodStart = mainSource.indexOf('openLogView(): void');
    const methodEnd = mainSource.indexOf('\n  }\n}', methodStart);
    const methodSource = mainSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodSource).not.toContain('getRightLeaf');
    expect(methodSource).not.toContain('getLeftLeaf');
    expect(methodSource).toContain("getLeaf('tab')");
    expect(methodSource).toContain('LOG_VIEW_TYPE');
    expect(methodSource).toContain('revealLeaf');
  });

  it('로그 레벨별 색상 클래스가 CSS에 정의되어 있다', () => {
    for (const level of ['trace', 'debug', 'info', 'notice', 'warn', 'error', 'fatal']) {
      expect(styles).toContain(`.superpower-inside-log-entry--${level}`);
    }
  });
});
