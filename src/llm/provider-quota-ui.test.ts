import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const field = vi.hoisted(() => ({
  value: '',
  input: { type: '', min: '', max: '', step: '', setAttribute: vi.fn() },
  change: undefined as ((value: string) => void) | undefined,
}));
vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addText(callback: (text: unknown) => void) {
      const text = {
        inputEl: field.input,
        setValue(value: string) {
          field.value = value;
          return text;
        },
        onChange(callback: (value: string) => void) {
          field.change = callback;
          return text;
        },
      };
      callback(text);
      return this;
    }
  },
}));
import { DEFAULT_SETTINGS, SuperpowerInsideSettingTab } from '../settings';

describe('한도 화면 연결 회귀', () => {
  it('설정 입력란은 기본 30초를 보이며 정수 범위만 가벼운 저장으로 연결한다', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const tab = new SuperpowerInsideSettingTab({} as never, { settings } as never);
    const target = tab as unknown as {
      buildProviderQuotaSection(container: HTMLElement): void;
      createSettingsSection(): { body: object };
      showNumericInputValidation(): void;
      debouncedSave(): void;
    };
    vi.spyOn(target, 'createSettingsSection').mockReturnValue({ body: {} });
    vi.spyOn(target, 'showNumericInputValidation').mockImplementation(() => {});
    const save = vi.spyOn(target, 'debouncedSave').mockImplementation(() => {});
    target.buildProviderQuotaSection({} as HTMLElement);
    expect(field.value).toBe('30');
    expect(field.input).toMatchObject({ type: 'number', min: '10', max: '3600', step: '1' });
    for (const value of ['', '9', '3601', '12.5']) field.change?.(value);
    expect(settings.quotaCheckIntervalSeconds).toBe(30);
    expect(save).not.toHaveBeenCalled();
    field.change?.('60');
    expect(settings.quotaCheckIntervalSeconds).toBe(60);
    expect(save).toHaveBeenCalledWith();
  });
  it('설정과 채팅 양쪽에서 공통 캐시·renderer·갱신을 실제로 참조한다', () => {
    const settings = readFileSync(new URL('../settings.ts', import.meta.url), 'utf8');
    const chat = readFileSync(new URL('../chat/view.ts', import.meta.url), 'utf8');
    expect(settings).toContain('this.buildProviderQuotaSection(workspace)');
    expect(settings).toContain('this.registerQuotaRefreshEvents()');
    expect(settings).toContain("this.plugin.refreshBus.on('quota'");
    expect(settings).toContain(
      'renderProviderQuota(quota, profile, this.plugin.providerQuota?.get(profile.id))',
    );
    expect(chat).toContain("this.plugin.refreshBus.on('quota', () => this.renderModelQuota())");
    expect(chat).toContain('this.modelQuotaEl = toolbar.createSpan');
    expect(chat).toContain('this.renderModelQuota();');
    expect(chat).toContain('this.plugin.providerQuota?.get(resolved.profile.id)');
  });
});
