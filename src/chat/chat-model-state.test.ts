import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));

import { DEFAULT_SETTINGS, type SuperpowerInsideSettings } from '../settings';
import { resolveChatModelState } from './chat-model-state';

describe('채팅 모델 표시 상태', () => {
  it('임베딩 전용 프로필은 채팅 프로바이더 수에서 제외한다', () => {
    const state = resolveChatModelState(createSettings('profile:ternlight:ternlight-base'));

    expect(state.enabledProviderCount).toBe(1);
    expect(state.availableModelCount).toBe(1);
    expect(state.selectedModel).toBe('');
  });

  it('삭제되거나 비활성화된 기본 모델을 다른 프로바이더로 조용히 바꾸지 않는다', () => {
    const state = resolveChatModelState(createSettings('profile:missing:offline'));

    expect(state.options.map((option) => option.value)).toEqual(['profile:chat:auto']);
    expect(state.selectedModel).toBe('');
  });

  it('저장된 기본 모델이 사용 가능하면 그대로 선택한다', () => {
    const state = resolveChatModelState(createSettings('profile:chat:auto'));

    expect(state.selectedModel).toBe('profile:chat:auto');
  });

  it('필수 endpoint가 없는 프로필을 provider와 모델 수에서 함께 제외한다', () => {
    const settings = createSettings('profile:chat:auto');
    const chatProfile = settings.providerProfiles.find((profile) => profile.id === 'chat');
    if (!chatProfile) throw new Error('test profile missing');
    chatProfile.baseUrl = '';

    expect(resolveChatModelState(settings)).toEqual({
      options: [],
      selectedModel: '',
      enabledProviderCount: 0,
      availableModelCount: 0,
    });
  });
});

function createSettings(defaultModel: string): SuperpowerInsideSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    chat: { ...structuredClone(DEFAULT_SETTINGS.chat), defaultModel },
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
        id: 'chat',
        name: 'Chat',
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
    ],
  };
}
