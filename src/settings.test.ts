import { connectTestChatGPT } from './test/chatgpt';
import { chatGPTOAuth } from './llm/chatgpt-oauth';
import { DEBUG_TRACE_BUILD_ENABLED } from './debug/build-flags';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modalPromptMocks = vi.hoisted(() => ({
  confirmWithModal: vi.fn(() => Promise.resolve(true)),
  promptWithModal: vi.fn(),
}));

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

vi.mock('./utils/modal-prompts', () => modalPromptMocks);

import {
  buildEmbeddingModelOptions,
  resolveProviderReadiness,
  selectInitialEmbeddingModel,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  normalizeRagPerformanceTuningMode,
  resolveRagPerformanceSettings,
  shouldRequireProviderApiKey,
  shouldShowProviderApiKey,
} from './rag/settings-display';
import {
  buildSettingsTabs,
  buildEmbeddingModels,
  buildEmbeddingProviderOptions,
  buildMcpJsonEditorValue,
  standardToInternal,
  buildChatModelOptions,
  buildEmbeddingProfileModelOptions,
  buildProviderModelRef,
  DEFAULT_SETTINGS,
  getCustomOpenAIProviderDisplayName,
  getProviderProfileDisplayName,
  migrateLegacyProviderProfiles,
  normalizeChatDebugTraceSettings,
  normalizeChatSaveFolder,
  parseProviderModelRef,
  resetProviderProfileVerification,
  resolveProviderProfileTone,
  resolveProviderProfileState,
  getProviderStrategyLabels,
  resolveUsableProviderModelRef,
  SuperpowerInsideSettingTab,
  upsertProviderProfileModel,
} from './settings';
import { CONTEXT7_MCP_SERVER_NAME, shouldShowPluginAwareContext7Warning } from './mcp/context7';
import { setLanguage, t } from './i18n';
import { validateMcpJson } from './utils/mcp-json';
import { resolveSettingsLoadData } from './settings-storage';
import { migrateStoredMcpServersRust } from './rag/rust-core';

describe('프로바이더 모델 제거', () => {
  const setup = () => {
    const profile = {
      id: 'sample',
      name: 'Sample',
      strategy: 'openAI' as const,
      enabled: true,
      apiKey: '',
      models: [
        {
          id: 'chat-sample',
          kind: 'general' as const,
          verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
        },
        {
          id: 'embedding-sample',
          kind: 'embedding' as const,
          verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
        },
      ],
    };
    const plugin = {
      settings: { ...structuredClone(DEFAULT_SETTINGS), providerProfiles: [profile] },
      saveSettings: vi.fn().mockResolvedValue({ success: true }),
      refreshBus: { emit: vi.fn() },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const state = tab as unknown as {
      removeProviderProfileModel(
        target: typeof profile,
        modelId: string,
        button: HTMLButtonElement,
      ): Promise<void>;
      refreshProvidersTab(profileId: string): void;
    };
    const refresh = vi.spyOn(state, 'refreshProvidersTab').mockImplementation(() => {});
    const button = { disabled: false } as HTMLButtonElement;
    modalPromptMocks.confirmWithModal.mockResolvedValue(true);
    return { profile, plugin, state, refresh, button };
  };

  it.each(['chat-sample', 'embedding-sample'])(
    '확인 후 %s만 제거하고 저장·모델 목록을 갱신한다',
    async (modelId) => {
      const { profile, plugin, state, refresh, button } = setup();
      await state.removeProviderProfileModel(profile, modelId, button);
      expect(profile.models.map((model) => model.id)).toEqual(
        modelId === 'chat-sample' ? ['embedding-sample'] : ['chat-sample'],
      );
      expect(plugin.saveSettings).toHaveBeenCalledWith({ reinitRag: true, reinitMcp: false });
      expect(plugin.refreshBus.emit).toHaveBeenCalledWith('models', { status: 'success' });
      expect(refresh).toHaveBeenCalledWith(profile.id);
      expect(button.disabled).toBe(false);
    },
  );

  it('확인을 취소하면 모델과 저장 상태를 보존한다', async () => {
    const { profile, plugin, state, button } = setup();
    const previousModels = profile.models;
    modalPromptMocks.confirmWithModal.mockResolvedValueOnce(false);
    await state.removeProviderProfileModel(profile, 'chat-sample', button);
    expect(profile.models).toBe(previousModels);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.refreshBus.emit).not.toHaveBeenCalled();
  });

  it.each(['result', 'throw'])(
    '저장 실패(%s) 시 모델을 복원하고 성공 갱신을 하지 않는다',
    async (failure) => {
      const { profile, plugin, state, button } = setup();
      const previousModels = profile.models;
      if (failure === 'result') plugin.saveSettings.mockResolvedValueOnce({ success: false });
      else plugin.saveSettings.mockRejectedValueOnce(new Error('save failed'));
      await state.removeProviderProfileModel(profile, 'chat-sample', button);
      expect(profile.models).toBe(previousModels);
      expect(plugin.refreshBus.emit).not.toHaveBeenCalled();
      expect(button.disabled).toBe(false);
    },
  );
});

it('모델 한도는 설정 마이그레이션과 검증 갱신에서 보존한다', () => {
  const profile = {
    id: 'limits',
    name: 'Limits',
    strategy: 'openRouter' as const,
    enabled: true,
    apiKey: '',
    models: [
      {
        id: 'selected',
        kind: 'general' as const,
        contextLength: 128000,
        maxInputTokens: 120000,
        maxOutputTokens: 4096,
        verification: { chatStatus: 'success' as const, embeddingStatus: 'unknown' as const },
      },
    ],
  };
  const settings = migrateLegacyProviderProfiles({
    ...structuredClone(DEFAULT_SETTINGS),
    providerProfiles: [profile],
  });
  const model = settings.providerProfiles.find((item) => item.id === 'limits')!.models[0];
  expect(model).toMatchObject({
    contextLength: 128000,
    maxInputTokens: 120000,
    maxOutputTokens: 4096,
  });
  expect(
    upsertProviderProfileModel([model], {
      id: model.id,
      kind: 'general',
      verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
    })[0].contextLength,
  ).toBe(128000);
});

afterEach(() => {
  vi.useRealTimers();
  modalPromptMocks.confirmWithModal.mockClear();
  modalPromptMocks.promptWithModal.mockClear();
  setLanguage('ko');
});

describe('RAG 설정 표시 헬퍼', () => {
  it('모델 옵션은 custom provider 내부 id 대신 사용자가 정한 이름을 표시한다', () => {
    const options = buildChatModelOptions(
      {
        ...DEFAULT_SETTINGS,
        customOpenAIProviders: [
          {
            id: 'custom-1',
            name: 'Onyx Provider',
            apiKey: 'key',
            baseUrl: 'https://example.com/v1',
            models: ['auto'],
            enabled: true,
            useRequestUrl: true,
          },
        ],
      },
      { currentModel: 'customOpenAI:custom-1:auto', includeEmpty: true },
    );

    expect(options).toContainEqual({
      value: 'customOpenAI:custom-1:auto',
      label: 'Onyx Provider / auto',
    });
    expect(options.map((option) => option.label).join('\n')).not.toContain('custom-1');
  });

  it('ChatGPT OAuth는 기기 로그인으로 준비 상태를 판정하고 기존 설정 값을 보존한다', () => {
    connectTestChatGPT('subscription');
    const settings = migrateLegacyProviderProfiles({
      ...structuredClone(DEFAULT_SETTINGS),
      providerProfiles: [
        {
          id: 'subscription',
          name: 'My ChatGPT',
          strategy: 'openAIChatGPT',
          enabled: true,
          apiKey: 'preserved-api-key',
          relayApiKey: 'relay-key',
          baseUrl: 'http://127.0.0.1:8317/v1',
          models: [
            {
              id: 'selected-model',
              kind: 'general',
              verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
            },
          ],
        },
      ],
    });
    const profile = settings.providerProfiles.find((item) => item.id === 'subscription');
    expect(profile).toMatchObject({
      strategy: 'openAIChatGPT',
      apiKey: 'preserved-api-key',
      relayApiKey: 'relay-key',
    });
    if (!profile) throw new Error('프로필이 없습니다');
    expect(resolveProviderProfileState(profile)).toMatchObject({
      tone: 'ready',
      chatUsable: true,
      embeddingSupported: false,
    });
    profile.apiKey = '';
    profile.relayApiKey = '';
    expect(resolveProviderProfileTone(profile)).toBe('ready');
    profile.baseUrl = '';
    expect(resolveProviderProfileTone(profile)).toBe('ready');
    chatGPTOAuth.disconnect(profile.id);
    expect(resolveProviderProfileTone(profile)).toBe('needs-key');
    expect(getProviderStrategyLabels().openai).toBe('OpenAI API');
    expect(getProviderStrategyLabels().openAIChatGPT).toContain('OAuth');
    setLanguage('en');
    expect(getProviderStrategyLabels().openAIChatGPT).toBe('OpenAI ChatGPT (OAuth)');
  });
  it('provider profile model refs preserve provider id and colon-containing model ids', () => {
    const value = buildProviderModelRef('local-ollama', 'qwen3:8b-q8_0');

    expect(value).toBe('profile:local-ollama:qwen3:8b-q8_0');
    expect(parseProviderModelRef(value)).toEqual({
      kind: 'profile',
      profileId: 'local-ollama',
      modelId: 'qwen3:8b-q8_0',
    });
    expect(parseProviderModelRef('openai:gpt-4o-mini')).toEqual({
      kind: 'legacy',
      providerKey: 'openai',
      modelId: 'gpt-4o-mini',
    });
    expect(parseProviderModelRef('customOpenAI:local:auto')).toEqual({
      kind: 'legacy-custom-openai',
      providerId: 'local',
      modelId: 'auto',
    });
  });

  it('provider profile model classification is exclusive and embedding wins conflicts', () => {
    const models = upsertProviderProfileModel(
      upsertProviderProfileModel([], {
        id: 'qwen3',
        kind: 'general',
        verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
      }),
      {
        id: 'qwen3',
        kind: 'embedding',
        verification: { chatStatus: 'success', embeddingStatus: 'success' },
      },
    );

    expect(models).toEqual([
      {
        id: 'qwen3',
        kind: 'embedding',
        verification: { chatStatus: 'success', embeddingStatus: 'success' },
      },
    ]);
  });

  it('model selectors split general chat models from embedding models', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      providerProfiles: [
        {
          id: 'local',
          name: 'Local',
          strategy: 'ollama' as const,
          apiKey: '',
          baseUrl: 'http://localhost:11434',
          enabled: true,
          models: [
            {
              id: 'llama3.1',
              kind: 'general' as const,
              verification: { chatStatus: 'success' as const, embeddingStatus: 'unknown' as const },
            },
            {
              id: 'qwen3-embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'success' as const },
            },
          ],
        },
      ],
    };

    expect(
      buildChatModelOptions(settings, {
        currentModel: '',
      }).map((option) => option.value),
    ).toEqual(['profile:local:llama3.1']);
    expect(
      buildEmbeddingProfileModelOptions(settings, {
        currentModel: '',
      }).map((option) => option.value),
    ).toEqual(['profile:local:qwen3-embed']);
  });

  it('프로바이더 프로필 상태는 설정 완료와 연결 확인을 구분한다', () => {
    const baseProfile = {
      id: 'custom',
      name: 'Custom',
      strategy: 'openAICompatible' as const,
      apiKey: '',
      baseUrl: 'https://example.com/v1',
      enabled: true,
      models: [
        {
          id: 'auto',
          kind: 'general' as const,
          verification: {
            chatStatus: 'unknown' as const,
            embeddingStatus: 'unknown' as const,
          },
        },
      ],
    };

    expect(resolveProviderProfileTone(baseProfile)).toBe('configured');
    expect(resolveProviderProfileTone({ ...baseProfile, baseUrl: '' })).toBe('needs-url');
    expect(
      resolveProviderProfileTone({
        ...baseProfile,
        models: [
          {
            ...baseProfile.models[0],
            verification: { chatStatus: 'failed', embeddingStatus: 'unknown' },
          },
        ],
      }),
    ).toBe('failed');
    expect(
      resolveProviderProfileTone({
        ...baseProfile,
        models: [
          {
            ...baseProfile.models[0],
            verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
          },
        ],
      }),
    ).toBe('ready');
  });

  it('지원하지 않는 strategy의 embedding-only 모델은 준비된 연결로 집계하지 않는다', () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      providerProfiles: [
        {
          id: 'claude-embedding',
          name: 'Claude embedding',
          strategy: 'claude' as const,
          apiKey: 'test-key',
          enabled: true,
          models: [
            {
              id: 'unsupported-embed',
              kind: 'embedding' as const,
              verification: {
                chatStatus: 'unknown' as const,
                embeddingStatus: 'success' as const,
              },
            },
          ],
        },
      ],
    };

    expect(resolveProviderProfileTone(settings.providerProfiles[0])).toBe('needs-models');
    expect(buildEmbeddingProfileModelOptions(settings, { currentModel: '' })).toEqual([]);
  });

  it('프로바이더 연결 정보가 바뀌면 저장된 모델 검증 결과를 초기화한다', () => {
    const profile = {
      id: 'custom',
      name: 'Custom',
      strategy: 'openAICompatible' as const,
      apiKey: 'old-key',
      baseUrl: 'https://old.example.com/v1',
      enabled: true,
      models: [
        {
          id: 'auto',
          kind: 'general' as const,
          verification: {
            chatStatus: 'success' as const,
            embeddingStatus: 'failed' as const,
            lastCheckedAt: 123,
            lastError: 'old failure',
          },
        },
      ],
    };

    resetProviderProfileVerification(profile);

    expect(profile.models[0]?.verification).toEqual({
      chatStatus: 'unknown',
      embeddingStatus: 'unknown',
    });
  });

  it('필수 연결 정보가 없는 프로필은 채팅 모델 선택지에서 제외한다', () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      providerProfiles: [
        {
          id: 'missing-key',
          name: 'Missing key',
          strategy: 'openRouter' as const,
          apiKey: '',
          enabled: true,
          models: [
            {
              id: 'remote',
              kind: 'general' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
            },
          ],
        },
        {
          id: 'missing-url',
          name: 'Missing URL',
          strategy: 'openAICompatible' as const,
          apiKey: '',
          baseUrl: '',
          enabled: true,
          models: [
            {
              id: 'auto',
              kind: 'general' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
            },
          ],
        },
        {
          id: 'usable',
          name: 'Usable',
          strategy: 'openAICompatible' as const,
          apiKey: '',
          baseUrl: 'https://example.com/v1',
          enabled: true,
          models: [
            {
              id: 'auto',
              kind: 'general' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
            },
          ],
        },
      ],
    };

    expect(buildChatModelOptions(settings, { currentModel: '' })).toEqual([
      { value: 'profile:usable:auto', label: 'Usable / auto' },
    ]);
  });

  it('RAG 실행용 임베딩 모델도 연결 정보, 검증 실패, strategy 지원을 함께 점검한다', () => {
    const settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      providerProfiles: [
        {
          id: 'missing-url',
          name: 'Missing URL',
          strategy: 'openAICompatible' as const,
          apiKey: '',
          baseUrl: '',
          enabled: true,
          models: [
            {
              id: 'embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
            },
          ],
        },
        {
          id: 'failed',
          name: 'Failed',
          strategy: 'openAICompatible' as const,
          apiKey: '',
          baseUrl: 'https://failed.example.com/v1',
          enabled: true,
          models: [
            {
              id: 'embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'failed' as const },
            },
          ],
        },
        {
          id: 'unsupported',
          name: 'Unsupported',
          strategy: 'claude' as const,
          apiKey: 'test-key',
          enabled: true,
          models: [
            {
              id: 'embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'success' as const },
            },
          ],
        },
        {
          id: 'usable',
          name: 'Usable',
          strategy: 'openAICompatible' as const,
          apiKey: '',
          baseUrl: 'https://usable.example.com/v1',
          enabled: true,
          models: [
            {
              id: 'embed',
              kind: 'embedding' as const,
              verification: { chatStatus: 'unknown' as const, embeddingStatus: 'unknown' as const },
            },
          ],
        },
      ],
    };

    expect(
      resolveUsableProviderModelRef(settings, 'profile:missing-url:embed', 'embedding'),
    ).toBeNull();
    expect(resolveUsableProviderModelRef(settings, 'profile:failed:embed', 'embedding')).toBeNull();
    expect(
      resolveUsableProviderModelRef(settings, 'profile:unsupported:embed', 'embedding'),
    ).toBeNull();
    expect(
      resolveUsableProviderModelRef(settings, 'profile:usable:embed', 'embedding'),
    ).toMatchObject({ modelId: 'embed', profile: { id: 'usable' } });
  });

  it('untouched default RAG settings create the built-in Ternlight embedding profile', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      providerProfiles: [],
    });

    const ternlight = migrated.providerProfiles.find((profile) => profile.id === 'ternlight');
    const ternlightModel = ternlight?.models.find((model) => model.id === 'ternlight-base');

    expect(ternlight).toMatchObject({
      id: 'ternlight',
      name: 'Ternlight',
      strategy: 'ternlight',
      enabled: true,
    });
    expect(ternlightModel).toMatchObject({
      id: 'ternlight-base',
      kind: 'embedding',
      verification: { embeddingStatus: 'success' },
    });
    expect(migrated.rag.embeddingModelRef).toBe('profile:ternlight:ternlight-base');
  });

  it('기존 Ternlight 프로필의 채팅 모델은 마이그레이션에서 제거한다', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      providerProfiles: [
        {
          id: 'legacy-ternlight',
          name: 'Ternlight',
          strategy: 'ternlight',
          apiKey: '',
          enabled: true,
          models: [
            {
              id: 'legacy-chat-model',
              kind: 'general',
              verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
            },
          ],
        },
      ],
    });

    expect(
      migrated.providerProfiles.find((profile) => profile.strategy === 'ternlight')?.models,
    ).toEqual([
      expect.objectContaining({ id: 'ternlight-base', kind: 'embedding' }),
      expect.objectContaining({ id: 'embeddinggemma-300m', kind: 'embedding' }),
    ]);
    expect(buildChatModelOptions(migrated, { currentModel: '' })).toEqual([]);
  });

  it('추가 기본 모델의 선택과 검증 기록을 마이그레이션 후에도 유지한다', () => {
    const initial = migrateLegacyProviderProfiles({ ...DEFAULT_SETTINGS, providerProfiles: [] });
    initial.rag = {
      ...initial.rag,
      embeddingModel: 'embeddinggemma-300m',
      embeddingModelRef: 'profile:ternlight:embeddinggemma-300m',
    };
    const gemma = initial.providerProfiles
      .find((profile) => profile.strategy === 'ternlight')
      ?.models.find((model) => model.id === 'embeddinggemma-300m');
    if (!gemma) throw new Error('모델이 없습니다.');
    gemma.verification = { chatStatus: 'unknown', embeddingStatus: 'failed', lastError: 'offline' };
    const migrated = migrateLegacyProviderProfiles(initial);
    expect(migrated.rag.embeddingModelRef).toBe('profile:ternlight:embeddinggemma-300m');
    expect(
      migrated.providerProfiles.find((profile) => profile.strategy === 'ternlight')?.models[1]
        .verification,
    ).toEqual(gemma.verification);
    expect(resolveRagPerformanceSettings('ternlight', 'embeddinggemma-300m')).toMatchObject({
      enabled: true,
      maxEmbeddingBatchSize: 4,
    });
  });

  it('저장된 자동 프로바이더 이름은 현재 언어로 표시하고 사용자 이름은 보존한다', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      providerProfiles: [
        {
          id: 'auto-name',
          name: '새 프로바이더',
          strategy: 'openAICompatible',
          apiKey: '',
          enabled: false,
          models: [],
        },
        {
          id: 'custom-name',
          name: '서울 연구 서버',
          strategy: 'openAICompatible',
          apiKey: '',
          enabled: false,
          models: [],
        },
      ],
    });

    setLanguage('en');

    expect(migrated.providerProfiles[0]?.name).toBe('');
    expect(getProviderProfileDisplayName(migrated.providerProfiles[0])).toBe('New provider');
    expect(getProviderProfileDisplayName(migrated.providerProfiles[1])).toBe('서울 연구 서버');
  });

  it('비어 있는 사용자 지정 OpenAI 이름도 현재 언어로 표시한다', () => {
    setLanguage('en');
    expect(getCustomOpenAIProviderDisplayName({ name: '' })).toBe('Custom OpenAI-compatible');

    setLanguage('ko');
    expect(getCustomOpenAIProviderDisplayName({ name: '' })).toBe('사용자 지정 OpenAI 호환');
  });

  it('기존 프로바이더 프로필이 있어도 Ternlight 옵션을 추가하고 현재 임베딩 선택은 보존한다', () => {
    const openAiRef = 'profile:openai:text-embedding-3-small';
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      providerProfiles: [
        {
          id: 'openai',
          name: 'OpenAI',
          strategy: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com',
          enabled: true,
          models: [
            {
              id: 'text-embedding-3-small',
              kind: 'embedding',
              verification: { chatStatus: 'unknown', embeddingStatus: 'success' },
            },
          ],
        },
      ],
      rag: {
        ...DEFAULT_SETTINGS.rag,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingModelRef: openAiRef,
      },
    });

    expect(migrated.providerProfiles).toContainEqual(
      expect.objectContaining({
        id: 'ternlight',
        strategy: 'ternlight',
        enabled: true,
        models: [
          expect.objectContaining({
            id: 'ternlight-base',
            kind: 'embedding',
          }),
          expect.objectContaining({ id: 'embeddinggemma-300m', kind: 'embedding' }),
        ],
      }),
    );
    expect(migrated.rag.embeddingModelRef).toBe(openAiRef);
  });

  it('legacy provider settings migrate to profiles and embedding classification wins default chat conflicts', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...DEFAULT_SETTINGS,
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        enabled: true,
        models: ['gpt-4o-mini', 'text-embedding-3-small'],
      },
      chat: {
        ...DEFAULT_SETTINGS.chat,
        defaultModel: 'openai:text-embedding-3-small',
      },
      rag: {
        ...DEFAULT_SETTINGS.rag,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    });

    expect(migrated.providerProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'openai',
          name: 'OpenAI',
          strategy: 'openai',
          models: [
            expect.objectContaining({ id: 'gpt-4o-mini', kind: 'general' }),
            expect.objectContaining({ id: 'text-embedding-3-small', kind: 'embedding' }),
          ],
        }),
        expect.objectContaining({ id: 'ternlight', strategy: 'ternlight' }),
      ]),
    );
    expect(migrated.chat.defaultModel).toBe('');
    expect(migrated.rag.embeddingModelRef).toBe('profile:openai:text-embedding-3-small');
  });

  it('built-in과 custom provider ID가 충돌해도 custom 모델을 올바른 프로필로 마이그레이션한다', () => {
    const migrated = migrateLegacyProviderProfiles({
      ...structuredClone(DEFAULT_SETTINGS),
      openai: {
        apiKey: 'built-in-key',
        baseUrl: 'https://api.openai.com',
        enabled: true,
        models: ['shared-model'],
      },
      customOpenAIProviders: [
        {
          id: 'openai',
          name: 'Private Gateway',
          apiKey: '',
          baseUrl: 'https://private.example.com/v1',
          enabled: true,
          models: ['shared-model'],
        },
      ],
      chat: {
        ...structuredClone(DEFAULT_SETTINGS.chat),
        defaultModel: 'customOpenAI:openai:shared-model',
      },
    });

    expect(migrated.chat.defaultModel).toBe('profile:custom-openai:shared-model');
    expect(
      migrated.providerProfiles.find((profile) => profile.id === 'custom-openai'),
    ).toMatchObject({
      strategy: 'openAICompatible',
      baseUrl: 'https://private.example.com/v1',
    });
  });

  it('설정 탭 라벨은 현재 언어로 매번 다시 계산한다', () => {
    setLanguage('ko');
    expect(buildSettingsTabs().find((tab) => tab.id === 'providers')?.label).toBe('AI 연결');

    setLanguage('en');
    expect(buildSettingsTabs().find((tab) => tab.id === 'providers')?.label).toBe('AI connections');
    expect(buildSettingsTabs().find((tab) => tab.id === 'chat')?.label).toBe('Chat');
    expect(buildSettingsTabs().map((tab) => tab.id)).toEqual([
      'general',
      'providers',
      'rag',
      'chat',
      'mcp',
    ]);
  });

  it('채팅 저장 폴더 제외 설명에 현재 폴더를 표시한다', () => {
    expect(getChatFolderExcludeDescription('CustomChats')).toContain('현재 제외 대상: CustomChats');
    expect(getChatFolderExcludeDescription('')).toContain('현재 제외 대상: 미설정');
  });

  it('Ollama Local만 API Key 입력을 숨긴다', () => {
    expect(shouldShowProviderApiKey('ollama')).toBe(false);
    expect(shouldShowProviderApiKey('ollamaCloud')).toBe(true);
    expect(shouldShowProviderApiKey('openai')).toBe(true);
    expect(shouldShowProviderApiKey('customOpenAI')).toBe(true);
    expect(shouldRequireProviderApiKey('customOpenAI')).toBe(false);
  });

  it('Provider readiness는 API 키보다 실제 검증 성공을 우선한다', () => {
    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
        validation: {
          authenticated: true,
          serverReachable: true,
        },
      }).tone,
    ).toBe('ready');

    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
        validation: {
          authenticated: false,
          serverReachable: true,
        },
      }).tone,
    ).toBe('ready');

    expect(
      resolveProviderReadiness({
        enabled: true,
        modelCount: 1,
        apiKeyRequired: true,
        hasApiKey: false,
      }).tone,
    ).toBe('needs-key');
  });

  it('RAG 임베딩 모델 옵션은 preset, provider 모델, 현재 선택 모델을 보존해 병합한다', () => {
    const options = buildEmbeddingModelOptions(
      [
        {
          id: 'text-embedding-3-small',
          name: 'OpenAI Small',
          dimensions: 1536,
          description: 'preset',
        },
      ],
      ['text-embedding-3-small', 'custom-embedding'],
      'legacy-selected',
    );

    expect(options.map((option) => option.id)).toEqual([
      'text-embedding-3-small',
      'custom-embedding',
      'legacy-selected',
    ]);
    expect(options.find((option) => option.id === 'text-embedding-3-small')?.source).toBe('preset');
    expect(options.find((option) => option.id === 'custom-embedding')?.source).toBe('provider');
    expect(options.find((option) => option.id === 'legacy-selected')?.label).toContain(
      '현재 선택됨',
    );
  });

  it('RAG 임베딩 모델 옵션은 embedding 검증 성공 모델을 먼저 표시하고 chat-only 모델을 확정하지 않는다', () => {
    const options = buildEmbeddingModelOptions(
      [],
      ['chat-only-model', 'embedding-model', 'unknown-model'],
      'chat-only-model',
      {
        'chat-only-model': { chatStatus: 'success', embeddingStatus: 'unknown' },
        'embedding-model': { chatStatus: 'unknown', embeddingStatus: 'success' },
      },
    );

    expect(options.map((option) => option.id)).toEqual([
      'embedding-model',
      'chat-only-model',
      'unknown-model',
    ]);
    expect(options.find((option) => option.id === 'embedding-model')?.embeddingStatus).toBe(
      'success',
    );
    expect(options.find((option) => option.id === 'chat-only-model')?.embeddingStatus).toBe(
      'unknown',
    );
  });

  it('Ollama Local로 전환할 때 embedding 검증 성공 모델이 없으면 preset 모델을 자동 선택하지 않는다', () => {
    const options = buildEmbeddingModelOptions(
      [
        {
          id: 'legacy-hardcoded-embedding',
          name: 'legacy-hardcoded-embedding',
          dimensions: 384,
          description: 'preset',
        },
      ],
      ['llama3.1'],
      '',
    );

    expect(selectInitialEmbeddingModel(options)).toBe('');
  });

  it('Ollama Local 임베딩 모델은 하드코딩 preset을 제공하지 않는다', () => {
    expect(buildEmbeddingModels().ollama).toEqual([]);
  });

  it('Ternlight 임베딩은 플러그인 내장 로컬 provider와 기본 모델로 제공한다', () => {
    const models = buildEmbeddingModels();
    const providerOptions = buildEmbeddingProviderOptions([]);

    expect(providerOptions).toContainEqual({ value: 'ternlight', label: '기본 로컬 모델' });
    expect(models.ternlight.map((model) => model.id)).toEqual([
      'ternlight-base',
      'embeddinggemma-300m',
    ]);
    expect(models.ternlight[1].dimensions).toBe(768);
    expect(models.ternlight[0]).toMatchObject({
      name: '@ternlight/base',
      dimensions: 384,
    });
    expect(DEFAULT_SETTINGS.rag.embeddingProvider).toBe('ternlight');
    expect(DEFAULT_SETTINGS.rag.embeddingModel).toBe('ternlight-base');
    expect(DEFAULT_SETTINGS.ollama.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.ollama.models).not.toContain('ternlight-base');
  });

  it('RAG 임베딩 프로바이더 옵션에는 활성화된 custom OpenAI-compatible provider를 포함한다', () => {
    const options = buildEmbeddingProviderOptions([
      {
        id: 'local',
        name: 'Local Embeddings',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        models: ['custom-embedding'],
        enabled: true,
        useRequestUrl: true,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        apiKey: '',
        baseUrl: 'http://localhost:5678/v1',
        models: [],
        enabled: false,
      },
    ]);

    expect(options).toContainEqual({ value: 'customOpenAI:local', label: 'Local Embeddings' });
    expect(options.some((option) => option.value === 'customOpenAI:disabled')).toBe(false);
  });

  it('채팅 저장 폴더 값은 레거시 이름이어도 저장된 값을 그대로 보존한다', () => {
    expect(normalizeChatSaveFolder('SuperObsidianByAI')).toBe('SuperObsidianByAI');
    expect(normalizeChatSaveFolder('SuperObsidianByAIChats')).toBe('SuperObsidianByAIChats');
    expect(normalizeChatSaveFolder('SuperpowerInside')).toBe('SuperpowerInside');
    expect(normalizeChatSaveFolder('CustomChats')).toBe('CustomChats');
    expect(normalizeChatSaveFolder(undefined)).toBeNull();
  });

  it('기본 RAG 제외 경로에는 채팅 저장 폴더명을 하드코딩하지 않는다', () => {
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInsideChats');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperpowerInside');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAI');
    expect(DEFAULT_SETTINGS.rag.excludePaths).not.toContain('SuperObsidianByAIChats');
  });

  it('신규 설치 기본 RAG 설정은 성능 보호를 켠다', () => {
    expect(DEFAULT_SETTINGS.rag.performanceTuningMode).toBe('auto');
    expect(DEFAULT_SETTINGS.rag.performanceGuardEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.rag.maxEmbeddingBatchSize).toBe(32);
    expect(DEFAULT_SETTINGS.rag.indexingYieldMs).toBe(25);
    expect(DEFAULT_SETTINGS.rag.slowEventLoopThresholdMs).toBe(150);
    expect(DEFAULT_SETTINGS.rag.slowBatchThresholdMs).toBe(3000);
  });

  it('내장 Ternlight는 페이싱 없이, 원격 프로바이더는 배치 제한과 함께 인덱싱한다', () => {
    expect(resolveRagPerformanceSettings('ternlight')).toEqual({ enabled: false });

    expect(resolveRagPerformanceSettings('openai')).toEqual({
      enabled: true,
      maxEmbeddingBatchSize: 32,
      indexingYieldMs: 0,
      slowEventLoopThresholdMs: 24,
      slowBatchThresholdMs: 1500,
    });

    expect(resolveRagPerformanceSettings('ollama')).toEqual({
      enabled: true,
      maxEmbeddingBatchSize: 1,
      indexingYieldMs: 0,
      slowEventLoopThresholdMs: 24,
      slowBatchThresholdMs: 1500,
    });
  });

  it('저장된 성능 튜닝 모드는 migration에서 auto/custom으로 정규화한다', () => {
    expect(normalizeRagPerformanceTuningMode('custom')).toBe('custom');
    expect(normalizeRagPerformanceTuningMode('auto')).toBe('auto');
    expect(normalizeRagPerformanceTuningMode(undefined)).toBe('auto');
    expect(normalizeRagPerformanceTuningMode('legacy')).toBe('auto');
  });

  it('RAG 인덱싱 제어 버튼 비활성 사유를 계산한다', () => {
    expect(
      getRagIndexingControlState({
        hasIndexer: false,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardMode: null,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toContain('초기화되지');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: true,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardMode: null,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toBe('인덱싱이 이미 실행 중입니다.');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 1,
        guardMode: 'paused',
        guardRemainingPauseMs: 12_400,
      }).updatePending.reason,
    ).toBe('성능 보호 대기 중입니다. 약 13초 후 다시 시도할 수 있습니다.');

    expect(
      getRagIndexingControlState({
        hasIndexer: true,
        isIndexing: false,
        totalDocuments: 1,
        updateRequiredCount: 0,
        guardMode: null,
        guardRemainingPauseMs: null,
      }).updatePending.reason,
    ).toBe('업데이트가 필요한 문서가 없습니다.');
  });

  it('전체 재인덱싱은 업데이트 대상이 없어도 전체 문서가 있으면 활성화한다', () => {
    const state = getRagIndexingControlState({
      hasIndexer: true,
      isIndexing: false,
      totalDocuments: 10,
      updateRequiredCount: 0,
      guardMode: null,
      guardRemainingPauseMs: null,
    });

    expect(state.updatePending.disabled).toBe(true);
    expect(state.reindexAll.disabled).toBe(false);
    expect(state.reindexAll.reason).toBeNull();
  });

  it('keeps recovery available when a paused guard has no usable deadline', () => {
    const state = getRagIndexingControlState({
      hasIndexer: true,
      isIndexing: true,
      totalDocuments: 10,
      updateRequiredCount: 1,
      guardMode: 'paused',
      guardRemainingPauseMs: null,
    });

    expect(state.resume.disabled).toBe(false);
    expect(state.cancel.disabled).toBe(false);
  });

  it('RAG 상태 계산은 런타임이 없으면 명시 초기화를 먼저 시도한다', async () => {
    const file = {
      path: 'note.md',
      name: 'note.md',
      basename: 'note',
      extension: 'md',
      stat: { ctime: 1, mtime: 1, size: 12 },
    };
    const vectorStore = {
      getFileIndexRecords: vi.fn(() => Promise.resolve([])),
    };
    const plugin = {
      app: {
        vault: {
          configDir: '.obsidian',
          getFiles: vi.fn(() => [file]),
          cachedRead: vi.fn(() => Promise.resolve('문서 내용')),
        },
      },
      settings: {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          excludePaths: [],
          excludeExts: [],
          excludeChatFolder: false,
        },
      },
      eventDrivenRagStats: null,
      vectorStore: null as typeof vectorStore | null,
      getRagRuntimeState: vi.fn(() => ({
        ragStatus: plugin.eventDrivenRagStats,
        vectorStore: plugin.vectorStore,
        embeddingProvider: null,
        ragIndexingScheduler: null,
        ragIndexingStatus: null,
        hasIndexer: plugin.vectorStore !== null,
        nextAutoUpdateAt: null,
        lastAutoUpdateSkippedReason: null,
        lastAutoUpdateResult: null,
        lastInitError: null,
        lastInitSkippedReason: null,
      })),
      ensureRagRuntimeInitialized: vi.fn(() => {
        plugin.vectorStore = vectorStore;
        return Promise.resolve(true);
      }),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    const status = await (
      tab as unknown as {
        getRagStatus(): Promise<{ totalDocuments: number } | null>;
      }
    ).getRagStatus();

    expect(plugin.ensureRagRuntimeInitialized).toHaveBeenCalledOnce();
    expect(status?.totalDocuments).toBe(1);
  });

  it('일반 설정 자동 저장은 RAG 런타임을 재초기화하지 않는다', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const saveSettingsLight = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: false,
      },
      saveSettings,
      saveSettingsLight,
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: false, reinitMcp: false });
    expect(saveSettingsLight).not.toHaveBeenCalled();
  });

  it('RAG 설정 자동 저장은 명시된 경우에만 RAG 런타임을 재초기화한다', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: false,
      },
      saveSettings,
      saveSettingsLight: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave({ reinitRag: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: true, reinitMcp: false });
  });

  it('여러 자동 저장 요청은 RAG 재초기화 요구를 보존해 한 번으로 병합한다', async () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn().mockResolvedValue({ success: true });
    const plugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        autoSaveEnabled: true,
        autoSaveDebounceMs: 1000,
      },
      saveSettings,
      saveSettingsLight: vi.fn().mockResolvedValue(undefined),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    tab.debouncedSave();
    tab.debouncedSave({ reinitRag: true });
    await vi.runAllTimersAsync();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ reinitRag: true, reinitMcp: false });
  });

  it('설정 자동 저장 기본 debounce는 1초다', () => {
    expect(DEFAULT_SETTINGS.autoSaveDebounceMs).toBe(1000);
  });

  it('실패 결과를 저장 성공으로 처리하지 않고 재시도할 요구를 보존한다', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ success: false });
    const tab = new SuperpowerInsideSettingTab(
      {} as never,
      {
        settings: { ...DEFAULT_SETTINGS, autoSaveEnabled: false },
        saveSettings,
      } as never,
    );
    tab.debouncedSave({ reinitRag: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = tab as unknown as {
      saveState: string;
      pendingSaveOptions: { reinitRag: boolean };
      saveSettingsWithFeedback(options: { reinitRag: boolean; reinitMcp: boolean }): Promise<void>;
    };
    expect(state.saveState).toBe('error');
    expect(state.pendingSaveOptions.reinitRag).toBe(true);
    saveSettings.mockResolvedValue({ success: true });
    await state.saveSettingsWithFeedback({ reinitRag: true, reinitMcp: false });
    expect(state.saveState).toBe('saved');
  });

  it('동시에 요청한 저장은 앞선 저장이 끝난 뒤 순서대로 수행한다', async () => {
    let finishFirst: (() => void) | undefined;
    const first = new Promise<{ success: boolean }>((resolve) => {
      finishFirst = () => resolve({ success: true });
    });
    const saveSettings = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ success: true });
    const tab = new SuperpowerInsideSettingTab(
      {} as never,
      { settings: { ...DEFAULT_SETTINGS, autoSaveEnabled: false }, saveSettings } as never,
    );
    tab.debouncedSave();
    tab.debouncedSave({ reinitRag: true });
    await Promise.resolve();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    finishFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings.mock.calls[1][0]).toEqual({ reinitRag: true, reinitMcp: false });
  });


  it('채팅 추적 설정은 없으면 빌드 종류를 따르고 값이 있으면 그대로 따른다', () => {
    expect(normalizeChatDebugTraceSettings(undefined)).toEqual({
      enabled: DEBUG_TRACE_BUILD_ENABLED,
    });
    expect(DEFAULT_SETTINGS.chatDebugTrace.enabled).toBe(DEBUG_TRACE_BUILD_ENABLED);
    expect(normalizeChatDebugTraceSettings({ enabled: false })).toEqual({ enabled: false });
    expect(normalizeChatDebugTraceSettings({ enabled: 'true' })).toEqual({
      enabled: DEBUG_TRACE_BUILD_ENABLED,
    });
  });

  it('기본 MCP 설정은 Context7 서버를 포함한다', () => {
    expect(DEFAULT_SETTINGS.mcpIncludeWslPath).toBe(false);
    expect(DEFAULT_SETTINGS.mcpServers).toContainEqual({
      name: CONTEXT7_MCP_SERVER_NAME,
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
  });

  it('MCP JSON 편집기 초기값은 Context7 기본 서버를 포함한다', () => {
    const parsed = JSON.parse(buildMcpJsonEditorValue(DEFAULT_SETTINGS.mcpServers)) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };

    expect(parsed.mcpServers.context7).toEqual({
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
  });

  it('사용자가 지정한 Context7 MCP 설정은 JSON 편집기 값에서 보존된다', () => {
    const parsed = JSON.parse(
      buildMcpJsonEditorValue([
        {
          name: 'context7',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7-key'],
          env: { CONTEXT7_API_KEY: 'ctx7-env-key' },
        },
      ]),
    ) as {
      mcpServers: Record<
        string,
        { command: string; args?: string[]; env?: Record<string, string> }
      >;
    };

    expect(parsed.mcpServers.context7?.args).toEqual([
      '-y',
      '@upstash/context7-mcp',
      '--api-key',
      'ctx7-key',
    ]);
    expect(parsed.mcpServers.context7?.env).toEqual({ CONTEXT7_API_KEY: 'ctx7-env-key' });
  });

  it('명시적으로 빈 MCP 서버 목록을 저장한 경우 JSON 편집기 값도 빈 객체로 유지한다', () => {
    expect(buildMcpJsonEditorValue([])).toBe(JSON.stringify({ mcpServers: {} }, null, 2));
  });

  it('Claude Desktop의 로컬 JSON과 원격 서버를 함께 저장·복원하고 선택한 접속 방식을 유지한다', () => {
    const config = {
      mcpServers: {
        local: {
          command: '/synthetic/path with spaces/node',
          args: ['server.js', '한글 경로'],
          env: { SYNTHETIC_OPTION: 'value' },
        },
        explicit: { command: 'node', transport: 'stdio' as const },
        remote: {
          url: 'https://example.com/mcp',
          transport: 'http' as const,
          authTokenSecret: 'mcp-synthetic',
        },
        legacy: { url: 'http://127.0.0.1:8080/sse', transport: 'sse' as const },
      },
    };
    expect(validateMcpJson(JSON.stringify(config))).toEqual({ valid: true, data: config });
    const servers = standardToInternal(config);
    const stored: unknown = JSON.parse(JSON.stringify({ mcpServers: servers }));
    const loaded = resolveSettingsLoadData(null, stored);
    const migrated = migrateStoredMcpServersRust(loaded.raw.mcpServers);
    expect(migrated).toEqual(
      servers.map((server) =>
        Object.fromEntries(Object.entries(server).filter(([, value]) => value !== undefined)),
      ),
    );
    expect(migrateStoredMcpServersRust(migrated)).toEqual(migrated);
    expect(JSON.parse(buildMcpJsonEditorValue(migrated ?? []))).toEqual(config);
  });

  it.each(['__proto__', 'constructor', 'toString', '한글 서버 이름'])(
    '서버 이름 %s를 JSON 왕복 중 잃지 않는다',
    (name) => {
      const config = { mcpServers: Object.fromEntries([[name, { command: 'node' }]]) };
      expect(validateMcpJson(JSON.stringify(config)).valid).toBe(true);
      const servers = standardToInternal(config);
      expect(JSON.parse(buildMcpJsonEditorValue(servers))).toEqual(config);
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    },
  );

  it('원격 MCP JSON은 URL·연결 방식·비밀값 이름만 보존한다', () => {
    const servers = [
      {
        name: 'remote',
        command: '',
        url: 'https://example.com/mcp',
        transport: 'sse' as const,
        authTokenSecret: 'mcp-synthetic',
      },
    ];
    expect(JSON.parse(buildMcpJsonEditorValue(servers))).toEqual({
      mcpServers: {
        remote: {
          url: 'https://example.com/mcp',
          transport: 'sse',
          authTokenSecret: 'mcp-synthetic',
        },
      },
    });
  });

  it('플러그인 인식 생성이 켜졌고 Context7가 없거나 연결되지 않았을 때 경고한다', () => {
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: true,
        servers: DEFAULT_SETTINGS.mcpServers,
        connected: false,
      }),
    ).toBe(true);
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: true,
        servers: [],
      }),
    ).toBe(true);
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: true,
        servers: DEFAULT_SETTINGS.mcpServers,
      }),
    ).toBe(false);
    expect(
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: false,
        servers: [],
      }),
    ).toBe(false);
  });

  it('MCP 기본 정책은 멘션 없이 자동 실행하고 멘션은 제안으로만 다룬다', () => {
    expect(DEFAULT_SETTINGS.chat.mcpToolExecutionPolicy).toBe('always-auto');
    expect(DEFAULT_SETTINGS.chat.mcpMentionOnly).toBe(false);
    for (const mode of ['always-manual', 'mentioned-auto', 'always-auto']) {
      const { raw } = resolveSettingsLoadData({ chat: { mcpToolExecutionPolicy: mode } }, null);
      expect({ ...DEFAULT_SETTINGS.chat, ...(raw.chat as object) }.mcpToolExecutionPolicy).toBe(
        mode,
      );
    }
    for (const mentionOnly of [true, false]) {
      const { raw } = resolveSettingsLoadData({ chat: { mcpMentionOnly: mentionOnly } }, null);
      expect({ ...DEFAULT_SETTINGS.chat, ...(raw.chat as object) }.mcpMentionOnly).toBe(
        mentionOnly,
      );
    }
  });

  it('MCP 멘션 전용 설명은 제안 기본값과 제한 동작을 안내한다', () => {
    setLanguage('ko');
    expect(t('mcpMentionOnly')).toContain('멘션한 MCP 서버만');
    expect(t('mcpMentionOnlyDesc')).toContain('제안');

    setLanguage('en');
    expect(t('mcpMentionOnly')).toContain('mentioned MCP servers only');
    expect(t('mcpMentionOnlyDesc')).toContain('suggests a server');

    setLanguage('ko');
  });

  it('MCP 툴 실행 정책 설명은 기본 자동 실행과 승인·결과 전달 범위를 안내한다', () => {
    setLanguage('ko');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('멘션 없이');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('위험한 툴은 승인');
    expect(t('mcpToolExecutionPolicyDesc')).toContain(
      '최종 답변 생성을 위해 LLM provider로 다시 전달',
    );

    setLanguage('en');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('without mentions');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('risky tools require approval');
    expect(t('mcpToolExecutionPolicyDesc')).toContain('sent back to the LLM provider');

    setLanguage('ko');
  });
});

describe('RAG indexing ETA settings label', () => {
  it('formats running RAG indexing ETA in the settings status label', () => {
    setLanguage('en');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          queuedFiles: 0,
          lastResult: null,
          progress: {
            event: 'batch-complete',
            startedAtMs: 0,
            nowMs: 10000,
            totalFiles: 10,
            completedFiles: 3,
            currentFilePath: 'c.md',
            currentFileIndex: 2,
            currentFileTotalChunks: 1,
            currentFileEmbeddedChunks: 0,
            totalEstimatedChunks: 10,
            completedEstimatedChunks: 3,
            currentFileEstimatedChunks: 1,
            totalPlannedChunks: 0,
            completedPlannedChunks: 0,
            currentFilePlannedChunks: 0,
            planningComplete: false,
            indexed: 3,
            vectors: 20,
            skipped: 0,
            completedBatchDurationsMs: [500],
            completedBatchChunkCounts: [1],
            completedFileDurationsMs: [2000, 3000, 2500],
            completedFileChunkCounts: [1, 1, 1],
            completedFileEstimatedChunkCounts: [1, 1, 1],
            completedFileActualChunkCounts: [1, 1, 1],
            completedFileOverheadDurationsMs: [],
            historicalMsPerChunk: null,
            historicalChunkEstimateRatio: null,
            historicalVariance: null,
            eta: {
              totalFiles: 10,
              completedFiles: 3,
              currentFileProgress: 0,
              progressRatio: 0.3,
              elapsedMs: 10000,
              remainingMs: 17500,
              estimatedCompletionMs: 27500,
              confidence: 'medium',
              basis: 'calibrated-estimate',
              lowerRemainingMs: 14000,
              upperRemainingMs: 21000,
              confidenceReason: 'calibrated-estimate',
              etaConfidenceReason: 'calibrated-estimate',
            },
          },
        },
      })),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    expect((tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel()).toBe(
      'Indexing: Full reindex · current file 0/1 chunks - 3/10 files · 10s elapsed, ETA about 18s',
    );
  });

  it('keeps low-confidence RAG indexing ETA in calculating state', () => {
    setLanguage('en');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          queuedFiles: 0,
          lastResult: null,
          progress: {
            event: 'batch-complete',
            startedAtMs: 0,
            nowMs: 5000,
            totalFiles: 4,
            completedFiles: 0,
            currentFileTotalChunks: 1,
            currentFileEmbeddedChunks: 1,
            totalEstimatedChunks: 100,
            completedEstimatedChunks: 0,
            currentFileEstimatedChunks: 1,
            totalPlannedChunks: 0,
            completedPlannedChunks: 0,
            currentFilePlannedChunks: 0,
            planningComplete: false,
            indexed: 0,
            vectors: 0,
            skipped: 0,
            completedBatchDurationsMs: [1000],
            completedBatchChunkCounts: [1],
            completedFileDurationsMs: [],
            completedFileChunkCounts: [],
            completedFileEstimatedChunkCounts: [],
            completedFileActualChunkCounts: [],
            completedFileOverheadDurationsMs: [],
            historicalMsPerChunk: null,
            historicalChunkEstimateRatio: null,
            historicalVariance: null,
            eta: {
              totalFiles: 4,
              completedFiles: 0,
              currentFileProgress: 1,
              progressRatio: 0.01,
              elapsedMs: 5000,
              remainingMs: 99000,
              estimatedCompletionMs: 104000,
              confidence: 'low',
              basis: 'batch-rate',
              lowerRemainingMs: 0,
              upperRemainingMs: 198000,
              confidenceReason: 'batch-rate-only',
              etaConfidenceReason: 'batch-rate-only',
            },
          },
        },
      })),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    expect((tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel()).toBe(
      'Indexing: Full reindex · current file 1/1 chunks - 0/4 files · 5s elapsed, calculating ETA',
    );
  });

  it('경과 시간을 표시하고 스냅샷 시계가 움직이면 라벨이 매초 갱신된다', () => {
    setLanguage('ko');
    const status = {
      running: true,
      phase: 'all',
      queuedFiles: 0,
      lastResult: null,
      progress: {
        event: 'batch-complete',
        startedAtMs: 0,
        nowMs: 90_000,
        totalFiles: 1,
        completedFiles: 0,
        currentFileTotalChunks: 1,
        currentFileEmbeddedChunks: 0,
        totalEstimatedChunks: 1,
        completedEstimatedChunks: 0,
        currentFileEstimatedChunks: 1,
        totalPlannedChunks: 0,
        completedPlannedChunks: 0,
        currentFilePlannedChunks: 0,
        planningComplete: false,
        indexed: 0,
        vectors: 0,
        skipped: 0,
        completedBatchDurationsMs: [],
        completedBatchChunkCounts: [],
        completedFileDurationsMs: [],
        completedFileChunkCounts: [],
        completedFileEstimatedChunkCounts: [],
        completedFileActualChunkCounts: [],
        completedFileOverheadDurationsMs: [],
        historicalMsPerChunk: null,
        historicalChunkEstimateRatio: null,
        historicalVariance: null,
        eta: null,
      },
    };
    const plugin = { getRagRuntimeState: vi.fn(() => ({ ragIndexingStatus: status })) };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const label = () =>
      (tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel();

    expect(label()).toBe(
      '인덱싱 중: 전체 재인덱싱 · 현재 파일 0/1 청크 - 0/1개 파일 · 1m 30s 경과, ETA 계산 중',
    );
    status.progress.nowMs = 91_000;
    expect(label()).toBe(
      '인덱싱 중: 전체 재인덱싱 · 현재 파일 0/1 청크 - 0/1개 파일 · 1m 31s 경과, ETA 계산 중',
    );
  });

  it('progress가 없어도 startedAt 기준 경과를 표시하고 없으면 기존 문구로 돌아간다', () => {
    vi.useFakeTimers();
    setLanguage('ko');
    const status: {
      running: boolean;
      phase: string;
      startedAt: number | null;
      queuedFiles: number;
      lastResult: null;
      progress: null;
    } = {
      running: true,
      phase: 'pending',
      startedAt: performance.now(),
      queuedFiles: 0,
      lastResult: null,
      progress: null,
    };
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({ ragIndexingStatus: status })),
      isRagIndexing: () => true,
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const label = () =>
      (tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel();

    expect(label()).toBe('인덱싱 중: 필요 문서 업데이트, 대기 0개 · 0s 경과');
    vi.advanceTimersByTime(90_000);
    expect(label()).toBe('인덱싱 중: 필요 문서 업데이트, 대기 0개 · 1m 30s 경과');

    status.startedAt = null;
    expect(label()).toBe(t('settingsAuto079', { v0: '필요 문서 업데이트', v1: 0 }));
    vi.useRealTimers();
  });
});

class RagOverviewTestElement {
  readonly children: RagOverviewTestElement[] = [];
  readonly attrs: Record<string, string> = {};
  textContent = '';
  hidden = false;
  setTextCalls = 0;
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => {
      for (const name of names) this.classes.add(name);
    },
    remove: (...names: string[]): void => {
      for (const name of names) this.classes.delete(name);
    },
    contains: (name: string): boolean => this.classes.has(name),
  };

  constructor(cls = '') {
    this.classList.add(...cls.split(' ').filter(Boolean));
  }

  setText(value: string): void {
    this.setTextCalls += 1;
    this.textContent = value;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  createEl(
    _tagName: string,
    options: { cls?: string; text?: string } = {},
  ): RagOverviewTestElement {
    const child = new RagOverviewTestElement(options.cls);
    child.textContent = options.text ?? '';
    this.children.push(child);
    return child;
  }

  empty(): void {
    this.children.splice(0);
    this.textContent = '';
  }

  insertBefore(
    node: RagOverviewTestElement,
    reference: RagOverviewTestElement,
  ): RagOverviewTestElement {
    this.children.splice(this.children.indexOf(reference), 0, node);
    return node;
  }

  querySelector(selector: string): RagOverviewTestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): RagOverviewTestElement[] {
    const matches: RagOverviewTestElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  private matches(selector: string): boolean {
    return selector.startsWith('.') && this.classes.has(selector.slice(1));
  }
}

describe('RAG indexing preparation label', () => {
  it('사전 단계 라벨은 준비 상태와 경과를 보여준다', () => {
    vi.useFakeTimers();
    setLanguage('ko');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragIndexingStatus: {
          running: true,
          phase: 'preparing',
          startedAt: performance.now(),
          queuedFiles: 2,
          lastResult: null,
          progress: null,
        },
      })),
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);

    expect((tab as unknown as { getIndexingStatusLabel(): string }).getIndexingStatusLabel()).toBe(
      '인덱싱 중: 준비, 대기 2개 · 0s 경과',
    );
    vi.useRealTimers();
  });

  it('사전 단계에는 공유 준비 상태와 중립 tone으로 detail을 갱신한다', () => {
    vi.useFakeTimers();
    setLanguage('ko');
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragStatus: null,
        ragIndexingStatus: {
          running: true,
          phase: 'preparing',
          startedAt: performance.now(),
          queuedFiles: 0,
          lastResult: null,
          progress: null,
        },
      })),
      isRagIndexing: () => true,
      getRetrievalReadiness: () => 'preparing',
      getRagPerformanceGuardState: () => null,
      settings: { rag: { autoUpdateEnabled: false } },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const grid = new RagOverviewTestElement();
    const copy = grid.createEl('div', { cls: 'superpower-inside-rag-overview-copy' });
    const status = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-status is-warning',
    });
    const detail = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-detail',
    });
    Object.assign(tab as unknown as Record<string, unknown>, {
      ragStatusGrid: grid,
      ragStatusTimestamp: new RagOverviewTestElement(),
    });

    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();

    const progress = grid.querySelector('.superpower-inside-rag-overview-progress');
    expect(status.textContent).toBe(t('chatReadinessRagIndexing'));
    expect(detail.textContent).toBe(t('chatReadinessRagIndexingDetail'));
    expect(status.classList.contains('is-warning')).toBe(false);
    expect(status.classList.contains('is-neutral')).toBe(false);
    expect(progress?.hidden).toBe(true);
    expect(status.attrs).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    vi.useRealTimers();
  });
});

describe('RAG indexing progress panel', () => {
  it('중단과 재시작 전환은 통계 조회나 패널 연결을 기다리지 않고 모든 제어를 갱신한다', () => {
    let running = true;
    const plugin = {
      getRagRuntimeState: () => ({
        hasIndexer: true,
        ragStatus: { totalDocuments: 5, updateRequiredDocuments: [{}] },
      }),
      isRagIndexing: () => running,
      getRetrievalReadiness: () => (running ? 'preparing' : 'ready'),
      getRagPerformanceGuardState: () => null,
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const button = () => ({ disabled: false, hidden: false, title: '' });
    const buttons = {
      updatePendingButton: button(),
      reindexAllButton: button(),
      cancelIndexingButton: button(),
      resumeIndexingButton: button(),
      resetIndexButton: button(),
    };
    Object.assign(tab, buttons);
    for (const isRunning of [true, false, true, false]) {
      running = isRunning;
      (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();
      expect(buttons.reindexAllButton.disabled).toBe(running);
      expect(buttons.resetIndexButton.disabled).toBe(running);
      expect(buttons.cancelIndexingButton.hidden).toBe(!running);
      tab.updateRagStats();
      expect(buttons.updatePendingButton.disabled).toBe(running);
      expect(buttons.reindexAllButton.disabled).toBe(running);
      expect(buttons.resetIndexButton.disabled).toBe(running);
      expect(buttons.cancelIndexingButton.hidden).toBe(!running);
      expect(buttons.resumeIndexingButton.hidden).toBe(true);
    }
  });

  it.each(['ko', 'en'] as const)('계획 진행은 완료 파일과 구분해 표시한다 (%s)', (language) => {
    setLanguage(language);
    const plugin = {
      getRagRuntimeState: () => ({
        hasIndexer: true,
        ragStatus: null,
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          progress: {
            event: 'plan',
            totalFiles: 9,
            completedFiles: 0,
            currentFileIndex: 3,
            startedAtMs: 0,
            nowMs: 2000,
          },
        },
      }),
      isRagIndexing: () => true,
      getRetrievalReadiness: () => 'preparing',
      getRagPerformanceGuardState: () => null,
      settings: { rag: { autoUpdateEnabled: false } },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const grid = new RagOverviewTestElement();
    const copy = grid.createEl('div', { cls: 'superpower-inside-rag-overview-copy' });
    const status = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-status',
    });
    const detail = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-detail',
    });
    Object.assign(tab, {
      ragStatusGrid: grid,
    });
    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();
    const progress = grid.querySelector('.superpower-inside-rag-overview-progress');
    if (!progress) throw new Error('progress list not rendered');

    expect(status.textContent).toBe(t('chatReadinessRagIndexing'));
    expect(status.textContent).not.toMatch(/\d/u);
    expect(detail.hidden).toBe(true);
    expect(progress.hidden).toBe(false);
    expect(
      progress.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-label')?.textContent,
      ),
    ).toEqual(
      language === 'ko'
        ? ['파일', '현재 파일', '경과', '남은 시간']
        : ['Files', 'Current file', 'Elapsed', 'Remaining'],
    );
    expect(
      progress.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-value')?.textContent,
      ),
    ).toEqual(
      language === 'ko'
        ? ['0 / 9', '파일 4 / 9', '2s', '계산 중']
        : ['0 / 9', 'File 4 / 9', '2s', 'Calculating'],
    );
    expect(progress.attrs).not.toHaveProperty('role');
    for (const item of progress.children) expect(item.attrs).not.toHaveProperty('aria-live');
  });

  it.each(['ko', 'en'] as const)('PDF 페이지 진행을 현재 파일 행에서 보존한다 (%s)', (language) => {
    setLanguage(language);
    const plugin = {
      getRagRuntimeState: () => ({
        ragStatus: null,
        ragIndexingStatus: {
          running: true,
          phase: 'file',
          progress: {
            event: 'file-chunks',
            startedAtMs: 0,
            nowMs: 61000,
            totalFiles: 3,
            completedFiles: 1,
            currentFileIndex: 1,
            currentFileTotalChunks: 4,
            currentFileEmbeddedChunks: 2,
            sourcePage: 1234,
            sourcePageCount: 4567,
            eta: null,
          },
        },
      }),
      isRagIndexing: () => true,
      getRetrievalReadiness: () => 'preparing',
      getRagPerformanceGuardState: () => null,
      settings: { rag: { autoUpdateEnabled: false } },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const grid = new RagOverviewTestElement();
    const copy = grid.createEl('div', { cls: 'superpower-inside-rag-overview-copy' });
    copy.createEl('div', { cls: 'superpower-inside-rag-overview-status' });
    copy.createEl('div', { cls: 'superpower-inside-rag-overview-detail' });
    Object.assign(tab, { ragStatusGrid: grid });

    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();

    const progress = copy.querySelector('.superpower-inside-rag-overview-progress');
    if (!progress) throw new Error('progress list not rendered');
    expect(
      progress.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-label')?.textContent,
      ),
    ).toEqual(
      language === 'ko' ? ['파일', 'PDF', '경과', '남은 시간'] : ['Files', 'PDF', 'Elapsed', 'Remaining'],
    );
    expect(
      progress.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-value')?.textContent,
      ),
    ).toEqual(
      language === 'ko'
        ? ['1 / 3', '1,234 / 4,567 페이지', '1m 1s', '계산 중']
        : ['1 / 3', '1,234 / 4,567 pages', '1m 1s', 'Calculating'],
    );
  });

  it('통계 copy wrapper가 없으면 루트에 상태 DOM을 만들지 않는다', () => {
    setLanguage('ko');
    const plugin = {
      getRagRuntimeState: () => ({
        ragStatus: null,
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          progress: {
            event: 'batch-complete',
            startedAtMs: 0,
            nowMs: 1000,
            totalFiles: 3,
            completedFiles: 1,
            currentFileTotalChunks: 0,
            currentFileEmbeddedChunks: 0,
            eta: null,
          },
        },
      }),
      isRagIndexing: () => true,
      getRetrievalReadiness: () => 'preparing',
      getRagPerformanceGuardState: () => null,
      settings: { rag: { autoUpdateEnabled: false } },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const grid = new RagOverviewTestElement();
    const timestamp = new RagOverviewTestElement();
    Object.assign(tab, { ragStatusGrid: grid, ragStatusTimestamp: timestamp });

    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();

    expect(grid.children).toEqual([]);
    expect(timestamp.textContent).toContain('인덱싱 중: 전체 재인덱싱');
  });

  it('진행 중에는 짧은 헤드라인과 고정 메트릭 행만 같은 실행 스냅샷으로 갱신한다', () => {
    setLanguage('en');
    const progress = {
      event: 'batch-complete' as const,
      startedAtMs: 0,
      nowMs: 10000,
      totalFiles: 10,
      completedFiles: 3,
      currentFileIndex: 5,
      currentFileTotalChunks: 15,
      currentFileEmbeddedChunks: 6,
      eta: { remainingMs: 18000, confidence: 'medium' as 'medium' | 'high' },
    };
    const plugin = {
      getRagRuntimeState: vi.fn(() => ({
        ragStatus: null,
        hasIndexer: true,
        lastAutoUpdateSkippedReason: null,
        ragIndexingStatus: {
          running: true,
          phase: 'all',
          queuedFiles: 0,
          lastResult: null,
          progress,
        },
      })),
      getRagStatus: vi.fn(),
      isRagIndexing: () => true,
      getRetrievalReadiness: () => 'preparing',
      getRagPerformanceGuardState: () => null,
      settings: { rag: { autoUpdateEnabled: false } },
    };
    const tab = new SuperpowerInsideSettingTab({} as never, plugin as never);
    const grid = new RagOverviewTestElement();
    const copy = grid.createEl('div', { cls: 'superpower-inside-rag-overview-copy' });
    const status = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-status',
    });
    const detail = copy.createEl('div', {
      cls: 'superpower-inside-rag-overview-detail',
    });
    const action = new RagOverviewTestElement();
    const timestamp = new RagOverviewTestElement();
    Object.assign(tab as unknown as Record<string, unknown>, {
      ragStatusGrid: grid,
      ragStatusAction: action,
      ragStatusTimestamp: timestamp,
    });

    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();

    const progressEl = grid.querySelector('.superpower-inside-rag-overview-progress');
    if (!progressEl) throw new Error('progress list not rendered');
    const progressItems = [...progressEl.children];
    expect(status.textContent).toBe(t('chatReadinessRagIndexing'));
    expect(status.setTextCalls).toBe(1);
    expect(status.attrs).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    expect(detail.hidden).toBe(true);
    expect(
      progressEl.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-value')?.textContent,
      ),
    ).toEqual(['3 / 10', '6 / 15 chunks', '10s', 'About 18s']);

    progress.nowMs = 11000;
    progress.completedFiles = 4;
    progress.currentFileEmbeddedChunks = 7;
    progress.eta.confidence = 'high';
    (tab as unknown as { updateRagIndexingProgress(): void }).updateRagIndexingProgress();

    expect(action.textContent).toBe(t('settingsAuto130'));
    expect(status.textContent).toBe(t('chatReadinessRagIndexing'));
    expect(status.setTextCalls).toBe(1);
    expect(progressEl.children).toEqual(progressItems);
    expect(
      progressEl.children.map(
        (item) => item.querySelector('.superpower-inside-rag-overview-progress-value')?.textContent,
      ),
    ).toEqual(['4 / 10', '7 / 15 chunks', '11s', '18s']);
    expect(timestamp.textContent).toContain('4/10');
    expect(plugin.getRagStatus).not.toHaveBeenCalled();
  });
});
