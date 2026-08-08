import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  requestUrl: vi.fn(),
}));

import {
  DEFAULT_SETTINGS,
  migrateLegacyProviderProfiles,
  type SuperpowerInsideSettings,
} from '../settings';
import { buildStoredChatModelRef, createChatProviderForModel } from './provider-resolution';

describe('채팅 provider 실행 연결', () => {
  it('Rust가 허용한 canonical 모델만 transport로 연결한다', () => {
    const settings = createCanonicalSettings();

    expect(createChatProviderForModel(settings, 'profile:remote:working')).toMatchObject({
      providerKey: 'profile:remote',
      providerLabel: 'Remote',
      model: 'working',
    });
    expect(createChatProviderForModel(settings, 'profile:remote:failed')).toBeNull();
  });

  it('canonical 프로필이 있어도 저장된 legacy alias를 같은 모델로 복원한다', () => {
    const resolved = createChatProviderForModel(
      createCanonicalSettings(),
      'customOpenAI:remote:working',
    );

    expect(resolved).toMatchObject({
      providerKey: 'profile:remote',
      providerLabel: 'Remote',
      model: 'working',
    });
  });

  it('필수 endpoint가 사라지면 이전 선택도 실행하지 않는다', () => {
    const settings = createCanonicalSettings();
    const profile = settings.providerProfiles[0];
    if (!profile) throw new Error('test profile missing');
    profile.baseUrl = '';

    expect(createChatProviderForModel(settings, 'profile:remote:working')).toBeNull();
  });

  it('legacy 모델도 같은 Rust 사용 가능성 gate를 거친다', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providerProfiles = [];
    settings.openai = {
      enabled: true,
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-test'],
    };

    expect(createChatProviderForModel(settings, 'openai:gpt-test')).toBeNull();
    settings.openai.apiKey = 'test-key';
    expect(createChatProviderForModel(settings, 'openai:gpt-test')).toMatchObject({
      providerKey: 'openai',
      model: 'gpt-test',
    });
  });

  it('built-in ID와 충돌한 legacy custom ref를 private gateway 프로필로 연결한다', () => {
    const settings = migrateLegacyProviderProfiles({
      ...structuredClone(DEFAULT_SETTINGS),
      openai: {
        enabled: true,
        apiKey: 'built-in-key',
        baseUrl: 'https://api.openai.com',
        models: ['shared-model'],
      },
      customOpenAIProviders: [
        {
          id: 'openai',
          name: 'Private Gateway',
          enabled: true,
          apiKey: '',
          baseUrl: 'https://private.example.com/v1',
          models: ['shared-model'],
        },
      ],
      chat: {
        ...structuredClone(DEFAULT_SETTINGS.chat),
        defaultModel: 'customOpenAI:openai:shared-model',
      },
    });

    expect(createChatProviderForModel(settings, 'customOpenAI:openai:shared-model')).toMatchObject({
      providerKey: 'profile:custom-openai',
      providerLabel: 'Private Gateway',
      model: 'shared-model',
    });
  });

  it('저장된 provider와 model을 canonical ref로 다시 조립한다', () => {
    expect(buildStoredChatModelRef('profile:remote', 'working')).toBe('profile:remote:working');
    expect(buildStoredChatModelRef('', 'working')).toBe('');
  });
});

function createCanonicalSettings(): SuperpowerInsideSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    providerProfiles: [
      {
        id: 'remote',
        name: 'Remote',
        strategy: 'openAICompatible',
        apiKey: '',
        baseUrl: 'https://example.com/v1',
        enabled: true,
        models: [
          {
            id: 'working',
            kind: 'general',
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
          {
            id: 'failed',
            kind: 'general',
            verification: { chatStatus: 'failed', embeddingStatus: 'unknown' },
          },
        ],
      },
    ],
  };
}
