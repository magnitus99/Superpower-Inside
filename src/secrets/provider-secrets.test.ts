import type { App } from 'obsidian';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {
    contentEl = document.createElement('div');
    open(): void {}
    close(): void {}
  },
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import { DEFAULT_SETTINGS, type ProviderProfileConfig, type SuperpowerInsideSettings } from '../settings';
import { createAppWithSecretStorage, createFakeSecretStorage } from '../test/secret-storage';
import {
  hydrateProviderApiKeys,
  migrateProviderKeysToKeychain,
  neutralizeProviderSecrets,
  persistProviderApiKeys,
  providerKeyState,
  settingsForPersistence,
} from './provider-secrets';
import { appLogger, normalizeLoggerConfig } from '../utils/logger';

beforeAll(() => {
  appLogger.configure(normalizeLoggerConfig({ minLevel: 'fatal', mirrorToConsole: false }));
});

function testSettings(overrides: Partial<SuperpowerInsideSettings> = {}): SuperpowerInsideSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function profile(overrides: Partial<ProviderProfileConfig> = {}): ProviderProfileConfig {
  return {
    id: 'profile-1',
    name: 'Profile',
    strategy: 'openai',
    apiKey: '',
    enabled: true,
    models: [],
    ...overrides,
  };
}

describe('설정 저장 사본', () => {
  it('키 원문만 지우고 비밀값 이름은 남기며 원본은 건드리지 않는다', () => {
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-live-secret', relayApiKey: 'relay-secret' },
      customOpenAIProviders: [
        {
          id: 'custom-1',
          name: 'Custom',
          apiKey: 'custom-secret',
          apiKeySecret: 'superpower-inside-custom-1',
          models: [],
          enabled: true,
        },
      ],
      providerProfiles: [
        profile({ apiKey: 'profile-secret', apiKeySecret: 'superpower-inside-profile-1' }),
      ],
    });

    const persisted = settingsForPersistence(settings);

    expect(persisted.openai.apiKey).toBe('');
    expect(persisted.openai.apiKeySecret).toBeUndefined();
    expect(persisted.openai.relayApiKey).toBeUndefined();
    expect(persisted.customOpenAIProviders[0]).toMatchObject({
      apiKey: '',
      apiKeySecret: 'superpower-inside-custom-1',
    });
    expect(persisted.providerProfiles[0]).toMatchObject({
      apiKey: '',
      apiKeySecret: 'superpower-inside-profile-1',
    });
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain('custom-secret');
    expect(serialized).not.toContain('profile-secret');
    expect(serialized).not.toContain('relay-secret');
    expect(settings.openai).toMatchObject({ apiKey: 'sk-live-secret', relayApiKey: 'relay-secret' });
  });
});

describe('보안 저장소 이관', () => {
  it('평문 키를 옮기고 비밀값 이름을 설정에 남긴다', () => {
    const storage = createFakeSecretStorage();
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-live' },
    });

    const result = migrateProviderKeysToKeychain(createAppWithSecretStorage(storage), settings);

    expect(result).toEqual({ changed: true, migrated: 1 });
    expect(storage.getSecret('superpower-inside-openai')).toBe('sk-live');
    expect(settings.openai.apiKeySecret).toBe('superpower-inside-openai');
  });

  it('이미 값이 있는 비밀값은 덮어쓰지 않고 평문만 정리한다', () => {
    const storage = createFakeSecretStorage({ 'superpower-inside-openai': 'sk-newer' });
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-stale', apiKeySecret: 'superpower-inside-openai' },
    });

    const result = migrateProviderKeysToKeychain(createAppWithSecretStorage(storage), settings);

    expect(result).toEqual({ changed: true, migrated: 0 });
    expect(storage.getSecret('superpower-inside-openai')).toBe('sk-newer');
  });

  it('보안 저장소 쓰기가 실패하면 평문을 유지해 키를 잃지 않는다', () => {
    const storage = createFakeSecretStorage();
    vi.spyOn(storage, 'setSecret').mockImplementation(() => {
      throw new Error('denied');
    });
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-live' },
    });

    const result = migrateProviderKeysToKeychain(createAppWithSecretStorage(storage), settings);

    expect(result).toEqual({ changed: false, migrated: 0 });
    expect(storage.getSecret('superpower-inside-openai')).toBeNull();
    expect(settings.openai.apiKey).toBe('sk-live');
  });

  it('보안 저장소를 쓸 수 없는 환경에서는 이관도 하이드레이션도 하지 않는다', () => {
    const app = {} as App;
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-live' },
    });

    expect(migrateProviderKeysToKeychain(app, settings)).toEqual({ changed: false, migrated: 0 });
    expect(persistProviderApiKeys(app, settings)).toBe(0);
    hydrateProviderApiKeys(app, settings);

    expect(settings.openai.apiKey).toBe('sk-live');
  });
});

describe('보안 저장소 하이드레이션', () => {
  it('이 기기 값이 있으면 채우고, 없으면 없는 상태로 둔다', () => {
    const storage = createFakeSecretStorage({ 'superpower-inside-profile-1': 'sk-on-device' });
    const settings = testSettings({
      providerProfiles: [
        profile({ apiKeySecret: 'superpower-inside-profile-1' }),
        profile({ id: 'profile-2', apiKeySecret: 'superpower-inside-profile-2' }),
        profile({ id: 'profile-3', apiKey: 'leftover-plaintext' }),
      ],
    });

    hydrateProviderApiKeys(createAppWithSecretStorage(storage), settings);

    expect(settings.providerProfiles[0]?.apiKey).toBe('sk-on-device');
    expect(providerKeyState(settings.providerProfiles[0])).toBe('present');
    expect(settings.providerProfiles[1]?.apiKey).toBe('');
    expect(providerKeyState(settings.providerProfiles[1])).toBe('missing-on-device');
    expect(providerKeyState(settings.providerProfiles[2])).toBe('unset');
  });

  it('이름이 충돌하면 다른 비밀값 이름을 배정한다', () => {
    const storage = createFakeSecretStorage({ 'superpower-inside-profile-1': 'sk-existing' });
    const settings = testSettings({
      providerProfiles: [profile({ apiKey: 'sk-new' })],
    });

    persistProviderApiKeys(createAppWithSecretStorage(storage), settings);

    expect(settings.providerProfiles[0]?.apiKeySecret).toBe('superpower-inside-profile-1-2');
    expect(storage.getSecret('superpower-inside-profile-1-2')).toBe('sk-new');
    expect(storage.getSecret('superpower-inside-profile-1')).toBe('sk-existing');
  });

  it('쓸 수 없는 이름은 규칙에 맞는 이름으로 다시 배정한다', () => {
    const storage = createFakeSecretStorage();
    const settings = testSettings({
      providerProfiles: [profile({ apiKey: 'sk-new', apiKeySecret: 'Bad_Name' })],
    });

    persistProviderApiKeys(createAppWithSecretStorage(storage), settings);

    expect(settings.providerProfiles[0]?.apiKeySecret).toBe('superpower-inside-profile-1');
    expect(storage.getSecret('superpower-inside-profile-1')).toBe('sk-new');
  });

  it('키를 지우면 보안 저장소 값도 비우고 설정하지 않은 항목은 만들지 않는다', () => {
    const storage = createFakeSecretStorage({ 'superpower-inside-openai': 'sk-old' });
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: '', apiKeySecret: 'superpower-inside-openai' },
    });

    persistProviderApiKeys(createAppWithSecretStorage(storage), settings);

    expect(storage.getSecret('superpower-inside-openai')).toBe('');
    expect([...storage.values.keys()]).toEqual(['superpower-inside-openai']);
  });

  it('저장본을 다시 읽어도 보안 저장소에서 키를 복원한다', () => {
    const storage = createFakeSecretStorage();
    const app = createAppWithSecretStorage(storage);
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKey: 'sk-live' },
      providerProfiles: [profile({ apiKey: 'sk-profile' })],
    });

    expect(migrateProviderKeysToKeychain(app, settings)).toEqual({ changed: true, migrated: 2 });
    persistProviderApiKeys(app, settings);
    const persisted = settingsForPersistence(settings);

    const reloaded = structuredClone(persisted);
    hydrateProviderApiKeys(app, reloaded);

    expect(reloaded.openai.apiKey).toBe('sk-live');
    expect(reloaded.providerProfiles[0]?.apiKey).toBe('sk-profile');
    expect(JSON.stringify(persisted)).not.toContain('sk-live');
    expect(JSON.stringify(persisted)).not.toContain('sk-profile');
  });
});

describe('리셋', () => {
  it('이 플러그인이 만든 항목만 비우고 다른 플러그인 값은 남긴다', () => {
    const storage = createFakeSecretStorage({
      'superpower-inside-openai': 'sk-a',
      'other-plugin-key': 'sk-b',
    });
    const settings = testSettings({
      openai: { ...DEFAULT_SETTINGS.openai, apiKeySecret: 'superpower-inside-openai' },
    });

    expect(neutralizeProviderSecrets(createAppWithSecretStorage(storage), settings)).toBe(1);
    expect(storage.getSecret('superpower-inside-openai')).toBe('');
    expect(storage.getSecret('other-plugin-key')).toBe('sk-b');
  });
});
