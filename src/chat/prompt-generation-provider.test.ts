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

import { DEFAULT_SETTINGS, type SuperpowerInsideSettings } from '../settings';
import {
  buildPromptGenerationModelOptions,
  createPromptGenerationProvider,
  resolvePromptGenerationModelState,
} from './prompt-generation-provider';

describe('프롬프트 생성 모델 연결', () => {
  it('활성 프로바이더 프로필의 채팅 모델만 선택지로 노출한다', () => {
    const settings = createProfileSettings();

    expect(buildPromptGenerationModelOptions(settings)).toEqual([
      { value: 'profile:free:auto', label: 'FreeLLMAPI / auto' },
      {
        value: 'profile:openrouter:google/gemini-flash',
        label: 'OpenRouter / google/gemini-flash',
      },
      { value: 'profile:openrouter:google/gemini-pro', label: 'OpenRouter / google/gemini-pro' },
    ]);
  });

  it('프로바이더 프로필 참조로 실제 생성 요청용 프로바이더를 만든다', () => {
    const resolved = createPromptGenerationProvider(createProfileSettings(), 'profile:free:auto');

    expect(resolved?.model).toBe('auto');
    expect(typeof resolved?.provider.chat).toBe('function');
  });

  it('현재 선택이 사라졌으면 다른 프로바이더로 조용히 대체하지 않는다', () => {
    const state = resolvePromptGenerationModelState(
      createProfileSettings(),
      'profile:removed:offline',
    );

    expect(state.selectedModel).toBe('');
    expect(state.options).toHaveLength(3);
  });

  it('비활성 프로필과 임베딩 모델은 생성 모델로 사용하지 않는다', () => {
    const settings = createProfileSettings();

    expect(createPromptGenerationProvider(settings, 'profile:disabled:offline')).toBeNull();
    expect(createPromptGenerationProvider(settings, 'profile:ternlight:ternlight-base')).toBeNull();
  });

  it('필수 endpoint가 없는 프로필은 생성 provider를 만들지 않는다', () => {
    const settings = createProfileSettings();
    const freeProfile = settings.providerProfiles.find((profile) => profile.id === 'free');
    if (!freeProfile) throw new Error('test profile missing');
    freeProfile.baseUrl = '';

    expect(createPromptGenerationProvider(settings, 'profile:free:auto')).toBeNull();
  });
});

function createProfileSettings(): SuperpowerInsideSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    providerProfiles: [
      {
        id: 'ternlight',
        name: 'Ternlight',
        strategy: 'ternlight',
        apiKey: '',
        enabled: true,
        models: [
          {
            id: 'ternlight-base',
            kind: 'embedding',
            verification: { chatStatus: 'unknown', embeddingStatus: 'success' },
          },
        ],
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        strategy: 'openRouter',
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.ai/api',
        enabled: true,
        models: [
          {
            id: 'google/gemini-pro',
            kind: 'general',
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
          {
            id: 'google/gemini-flash',
            kind: 'general',
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
        ],
      },
      {
        id: 'free',
        name: 'FreeLLMAPI',
        strategy: 'openAICompatible',
        apiKey: 'test-key',
        baseUrl: 'https://example.com/v1',
        enabled: true,
        models: [
          {
            id: 'auto',
            kind: 'general',
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
        ],
      },
      {
        id: 'disabled',
        name: 'Disabled',
        strategy: 'openAICompatible',
        apiKey: 'test-key',
        baseUrl: 'https://example.com/v1',
        enabled: false,
        models: [
          {
            id: 'offline',
            kind: 'general',
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
        ],
      },
    ],
  };
}
