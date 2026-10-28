import { connectTestChatGPT } from '../test/chatgpt';
import { chatGPTOAuth } from './chatgpt-oauth';
import { describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';

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
import {
  buildStoredChatModelRef,
  createChatProviderForModel,
  prepareChatProviderForModel,
} from './provider-resolution';

describe('채팅 provider 실행 연결', () => {
  it('선택 프로필의 HTTP 모델 정보가 실제 채팅 요청의 예산과 출력 한도로 이어진다', async () => {
    const settings = createCanonicalSettings();
    vi.mocked(requestUrl)
      .mockReset()
      .mockResolvedValueOnce({
        status: 200,
        text: '',
        json: {
          data: [
            { id: 'working', context_length: 128000, max_completion_tokens: 65536 },
            { id: 'other', context_length: 128000 },
          ],
        },
      } as Awaited<ReturnType<typeof requestUrl>>)
      .mockResolvedValueOnce({
        status: 200,
        text: '',
        json: { choices: [{ message: { content: '확인한 답변' } }] },
      } as Awaited<ReturnType<typeof requestUrl>>);
    const resolved = await prepareChatProviderForModel(settings, 'profile:remote:working');
    expect(resolved?.provider.contextBudget).toMatchObject({
      contextTokens: 128000,
      outputTokens: 65536,
      source: 'provider',
    });
    expect(vi.mocked(requestUrl).mock.calls[0]?.[0]).toMatchObject({
      url: 'https://example.com/v1/models',
      method: 'GET',
    });
    expect(await resolved?.provider.chat([{ role: 'user', content: '질문' }])).toBe('확인한 답변');
    const request = vi.mocked(requestUrl).mock.calls[1]?.[0];
    expect(
      typeof request === 'object' && typeof request.body === 'string'
        ? JSON.parse(request.body)
        : {},
    ).toMatchObject({
      model: 'working',
      max_tokens: 65536,
    });
  });

  it('현재 모델 조회에 실패하면 저장된 과거 한도를 재사용하지 않고 기본값을 쓴다', async () => {
    const settings = createCanonicalSettings();
    settings.providerProfiles[0].models[0].contextLength = 128000;
    vi.mocked(requestUrl).mockReset().mockRejectedValueOnce(new Error('offline'));
    const resolved = await prepareChatProviderForModel(settings, 'profile:remote:working');
    expect(resolved?.provider.contextBudget).toMatchObject({
      contextTokens: 50000,
      source: 'fallback',
    });
  });
  it('ChatGPT canonical 모델은 OAuth 로그인 후 실행하고 임베딩 후보를 제외한다', () => {
    connectTestChatGPT('remote');
    const settings = createCanonicalSettings();
    const profile = settings.providerProfiles[0];
    if (!profile) throw new Error('테스트 프로필이 없습니다');
    profile.strategy = 'openAIChatGPT';
    profile.apiKey = '';
    profile.baseUrl = 'http://127.0.0.1:8317/v1';
    const resolved = createChatProviderForModel(settings, 'profile:remote:working');
    expect(resolved).toMatchObject({ providerKey: 'profile:remote', model: 'working' });
    expect(resolved?.provider.capability.toolCalling).toBe(true);
    profile.capabilityOverrides = { toolCalling: false };
    expect(
      createChatProviderForModel(settings, 'profile:remote:working')?.provider.capability
        .toolCalling,
    ).toBe(false);
    profile.baseUrl = '';
    expect(createChatProviderForModel(settings, 'profile:remote:working')).not.toBeNull();
    chatGPTOAuth.disconnect(profile.id);
    expect(createChatProviderForModel(settings, 'profile:remote:working')).toBeNull();
  });
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

  it('모델이 선언한 Messages 형식을 프로필 기본 Chat보다 우선한다', async () => {
    const settings = createCanonicalSettings();
    const profile = settings.providerProfiles[0];
    if (!profile) throw new Error('테스트 프로필이 없습니다');
    profile.baseUrl = 'https://api.commandcode.ai/provider/v1';
    profile.apiFormat = 'chat';
    profile.models[0].supportedApiFormats = ['messages'];
    vi.mocked(requestUrl).mockReset().mockResolvedValueOnce({
      status: 200,
      text: '',
      json: { content: [{ type: 'text', text: 'ok' }] },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const resolved = createChatProviderForModel(settings, 'profile:remote:working');
    if (!resolved) throw new Error('provider가 연결되지 않았습니다');
    await resolved.provider.chat([{ role: 'user', content: 'hello' }]);
    const request = vi.mocked(requestUrl).mock.calls.at(-1)?.[0];
    if (!request || typeof request === 'string') throw new Error('요청이 없습니다');
    expect(request.url).toBe('https://api.commandcode.ai/provider/v1/messages');
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
