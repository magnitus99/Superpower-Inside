import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const styles = readFileSync(resolve(root, 'styles.css'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'src/settings.ts'), 'utf8');

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

  it('General 탭에서 통합 로그 페이지로 이동하는 디버깅 옵션을 제공한다', () => {
    expect(settingsSource).toContain(
      "type SettingsTabId = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced' | 'logs'",
    );
    expect(settingsSource).toContain("id: 'logs'");
    expect(settingsSource).toContain('buildLogsTab(');
    expect(settingsSource).toContain('openLogsPageFromGeneral(');
  });

  it('로그 레벨별 색상 클래스가 CSS에 정의되어 있다', () => {
    for (const level of ['trace', 'debug', 'info', 'notice', 'warn', 'error', 'fatal']) {
      expect(styles).toContain(`.superpower-inside-log-entry--${level}`);
    }
  });
});
