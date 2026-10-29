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
});
