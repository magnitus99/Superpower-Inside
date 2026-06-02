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
});
