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
