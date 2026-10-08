import { connectTestChatGPT, completedChatGPTResponse } from '../test/chatgpt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import type { ProviderConfig } from '../settings';
import type { TernlightRuntimeOptions } from './ternlight-runtime';
import {
  fetchProviderModels,
  fetchProviderModelsForStrategy,
  fetchOllamaModelInfo,
  fetchAnthropicModelInfo,
  normalizeOpenAICompatibleBaseUrl,
  testEmbeddingGeneration,
  testEmbeddingGenerationForStrategy,
  testProviderGeneration,
  testProviderGenerationForStrategy,
  validateEmbeddingConnection,
  validateProviderConnection,
} from './validation';

const requestUrlMock = vi.hoisted(() => vi.fn());
const ternlightEmbedMock = vi.hoisted(() => vi.fn());
const gemmaMocks = vi.hoisted(() => ({ embed: vi.fn(), close: vi.fn() }));

vi.mock('obsidian', () => ({
  requestUrl: requestUrlMock,
}));

vi.mock('./embedding', () => ({
  TernlightEmbeddingProvider: class {
    embed = ternlightEmbedMock;
  },
  EmbeddingGemmaProvider: class {
    embed = gemmaMocks.embed;
    close = gemmaMocks.close;
  },
}));

const baseConfig: ProviderConfig = {
  apiKey: 'stored-key',
  models: [],
  enabled: true,
};
const ternlightRuntime = {
  app: {} as TernlightRuntimeOptions['app'],
  pluginId: 'test-plugin',
  pluginVersion: 'test-version',
} satisfies TernlightRuntimeOptions;

describe('provider validation', () => {
  it('Claude 상세 조회는 선택 ID와 인증 헤더를 보내고 다른 ID의 한도를 거부한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { id: 'claude-selected', max_input_tokens: 200000, max_tokens: 8192 },
    });
    expect(await fetchAnthropicModelInfo(baseConfig, 'claude-selected')).toEqual({
      id: 'claude-selected',
      contextLength: 200000,
      maxOutputTokens: 8192,
    });
    expect(requestUrlMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://api.anthropic.com/v1/models/claude-selected',
      method: 'GET',
      headers: { 'x-api-key': baseConfig.apiKey, 'anthropic-version': '2023-06-01' },
    });
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { id: 'different', max_input_tokens: 200000 },
    });
    expect(await fetchAnthropicModelInfo(baseConfig, 'claude-selected')).toBeUndefined();
    requestUrlMock.mockResolvedValueOnce({ status: 404 });
    expect(await fetchAnthropicModelInfo(baseConfig, 'missing')).toBeUndefined();
  });
  it('Ollama 선택 모델의 show API에서 모델 아키텍처 한도를 확인하고 누락은 추측하지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '',
      json: { model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 } },
    });
    expect(await fetchOllamaModelInfo('ollama', baseConfig, 'selected')).toEqual({
      id: 'selected',
      contextLength: 8192,
    });
    expect(requestUrlMock.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://localhost:11434/api/show',
      method: 'POST',
      body: JSON.stringify({ model: 'selected' }),
    });
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '',
      json: { model_info: { 'llama.context_length': 999999 } },
    });
    expect(await fetchOllamaModelInfo('ollama', baseConfig, 'selected')).toEqual({
      id: 'selected',
    });
  });
  it('공급자가 보장한 경로 한도와 출력 한도를 사용하고 문자열·음수는 배제한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '',
      json: {
        data: [
          {
            id: 'selected',
            context_length: 128000,
            top_provider: { context_length: 64000, max_completion_tokens: 2048 },
          },
          { id: 'invalid', context_length: '128000' },
        ],
      },
    });
    expect((await fetchProviderModels('openRouter', baseConfig)).modelDetails).toEqual([
      { id: 'invalid' },
      { id: 'selected', contextLength: 64000, maxOutputTokens: 2048 },
    ]);
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '',
      json: { data: [{ id: 'claude', max_input_tokens: 200000, max_tokens: 8192 }] },
    });
    expect((await fetchProviderModels('claude', baseConfig)).modelDetails?.[0]).toMatchObject({
      contextLength: 200000,
      maxOutputTokens: 8192,
    });
  });
  it('최종 output이 비어 있어도 완료된 항목의 답변으로 OAuth 모델 검사를 통과한다', async () => {
    connectTestChatGPT();
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text:
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message', content: [{ type: 'output_text', text: 'pong' }] },
        })}\n\n` + completedChatGPTResponse([]),
      json: {},
      headers: {},
    });
    expect(
      await testProviderGenerationForStrategy('openAIChatGPT', baseConfig, 'selected-model'),
    ).toMatchObject({ valid: true, models: ['selected-model'] });
  });
  it('OAuth로 모델 목록과 실제 생성 응답을 검증하고 임베딩을 제외한다', async () => {
    connectTestChatGPT();
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: '',
      json: {
        models: [
          {
            slug: 'selected-model',
            context_window: 128000,
            max_context_window: 256000,
            effective_context_window_percent: 90,
          },
        ],
      },
      headers: {},
    });
    expect(await fetchProviderModelsForStrategy('openAIChatGPT', baseConfig)).toMatchObject({
      valid: true,
      models: ['selected-model'],
      modelDetails: [{ id: 'selected-model', contextLength: 115200 }],
    });
    expect(requestUrlMock.mock.calls[0]?.[0]).toMatchObject({
      headers: { Authorization: 'Bearer oauth-access' },
    });
    const modelRequest = requestUrlMock.mock.calls[0]?.[0] as { url: string };
    expect(modelRequest.url).toContain('/codex/models?client_version=');
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      text: completedChatGPTResponse([
        { type: 'message', content: [{ type: 'output_text', text: 'OK' }] },
      ]),
      json: {},
      headers: {},
    });
    expect(
      await testProviderGenerationForStrategy('openAIChatGPT', baseConfig, 'selected-model'),
    ).toMatchObject({ valid: true });
    expect(
      await testEmbeddingGenerationForStrategy('openAIChatGPT', 'selected-model', baseConfig),
    ).toMatchObject({ valid: false });
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    requestUrlMock.mockReset();
    ternlightEmbedMock.mockReset();
    setLanguage('ko');
  });

  it('OpenAI 기본 연결 테스트는 모델 목록만 조회하고 생성 endpoint를 호출하지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'gpt-4o-mini' }] },
      text: '',
    });

    const result = await validateProviderConnection('openai', baseConfig);

    expect(result.valid).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini']);
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        headers: { Authorization: 'Bearer stored-key' },
        throw: false,
      }),
    );
  });

  it('Anthropic 모델 검증에는 저장된 API 키를 x-api-key로 붙인다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }] },
      text: '',
    });

    const result = await fetchProviderModels('claude', baseConfig);

    expect(result.valid).toBe(true);
    expect(result.models).toEqual(['claude-sonnet']);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': 'stored-key',
          'anthropic-version': '2023-06-01',
        },
        throw: false,
      }),
    );
  });

  it('OpenRouter 모델 목록에서 모든 모델과 메타데이터를 파싱한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: {
        data: [
          {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            context_length: 128000,
            architecture: { output_modalities: ['text'] },
          },
          {
            id: 'image/model',
            name: 'Image Model',
            architecture: { output_modalities: ['image'] },
          },
          {
            id: 'text-embedding-3-small',
            name: 'Embedding Model',
            architecture: { output_modalities: ['text'] },
          },
        ],
      },
      text: '',
    });

    const result = await fetchProviderModels('openRouter', baseConfig);

    expect(result.models).toEqual(['image/model', 'openai/gpt-4o', 'text-embedding-3-small']);
    expect(result.modelDetails).toEqual([
      { id: 'image/model', name: 'Image Model', contextLength: undefined },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128000 },
      { id: 'text-embedding-3-small', name: 'Embedding Model', contextLength: undefined },
    ]);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://openrouter.ai/api/v1/models',
        headers: { Authorization: 'Bearer stored-key' },
        throw: false,
      }),
    );
  });

  it('Ollama Local 태그 목록에는 저장된 API 키를 붙이지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { models: [{ name: 'llama3.1' }, { name: 'qwen3' }] },
      text: '',
    });

    const result = await fetchProviderModels('ollama', baseConfig);

    expect(result.models).toEqual(['llama3.1', 'qwen3']);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:11434/api/tags',
        headers: {},
        throw: false,
      }),
    );
  });

  it('Ollama Cloud 태그 목록에는 저장된 API 키를 유지한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { models: [{ name: 'llama3.1' }] },
      text: '',
    });

    const result = await fetchProviderModels('ollamaCloud', baseConfig);

    expect(result.models).toEqual(['llama3.1']);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://ollama.com/api/tags',
        headers: { Authorization: 'Bearer stored-key' },
        throw: false,
      }),
    );
  });

  it('Ollama Local 임베딩 연결 테스트는 태그 목록만 조회하고 임베딩을 생성하지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { models: [{ name: 'local-embedding-model' }] },
      text: '',
    });

    const result = await validateEmbeddingConnection('ollama', 'local-embedding-model', baseConfig);

    expect(result.valid).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:11434/api/tags',
        method: 'GET',
        headers: {},
        throw: false,
      }),
    );
  });

  it('Ollama Local embedding validation uses the configured Base URL', async () => {
    requestUrlMock
      .mockResolvedValueOnce({
        status: 200,
        json: { models: [{ name: 'local-embedding-model' }] },
        text: '',
      })
      .mockResolvedValueOnce({
        status: 200,
        json: { embeddings: [[0.1, 0.2]] },
        text: '',
      });
    const config = {
      ...baseConfig,
      baseUrl: 'http://127.0.0.1:11555/api',
    };

    await expect(
      validateEmbeddingConnection('ollama', 'local-embedding-model', config),
    ).resolves.toEqual(expect.objectContaining({ valid: true }));
    await expect(
      testEmbeddingGeneration('ollama', 'local-embedding-model', config),
    ).resolves.toEqual(expect.objectContaining({ valid: true }));

    expect(requestUrlMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'http://127.0.0.1:11555/api/tags',
      }),
    );
    expect(requestUrlMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'http://127.0.0.1:11555/api/embed',
      }),
    );
  });

  it('OpenAI-compatible profile strategy fetches models from the configured base URL', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'local-chat' }] },
      text: '',
    });

    const result = await fetchProviderModelsForStrategy('openAICompatible', {
      apiKey: 'local-key',
      baseUrl: 'http://localhost:1234/v1',
      models: [],
      enabled: true,
    });

    expect(result.models).toEqual(['local-chat']);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:1234/v1/models',
        headers: { Authorization: 'Bearer local-key' },
        throw: false,
      }),
    );
  });

  it('embedding validation fails before network calls for unsupported profile strategies', async () => {
    const result = await testEmbeddingGenerationForStrategy('claude', 'claude-sonnet', baseConfig);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('이 프로바이더 연결은 임베딩을 지원하지 않습니다.');
    expect(requestUrlMock).not.toHaveBeenCalled();
  });

  it('검증 오류는 현재 UI 언어에 맞춰 다시 계산한다', async () => {
    const korean = await fetchProviderModelsForStrategy('ternlight', baseConfig);

    setLanguage('en');
    const english = await fetchProviderModelsForStrategy('ternlight', baseConfig);

    expect(korean.error).toBe('Ternlight는 임베딩만 지원합니다.');
    expect(english.error).toBe('Ternlight supports embeddings only.');
  });

  it('잘못된 임베딩 응답을 현재 UI 언어로 설명한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [] },
      text: '',
    });

    const result = await testEmbeddingGeneration('openai', 'text-embedding-3-small', baseConfig);

    expect(result).toMatchObject({
      valid: false,
      error: '프로바이더가 올바르지 않은 임베딩 응답을 반환했습니다.',
    });
  });

  it('Ternlight 모델과 runtime 검증 오류를 현재 UI 언어로 설명한다', async () => {
    const unknownModel = await validateEmbeddingConnection(
      'ternlight',
      'unknown-model',
      baseConfig,
    );
    const unavailable = await testEmbeddingGenerationForStrategy(
      'ternlight',
      'ternlight-base',
      baseConfig,
    );

    expect(unknownModel.error).toBe('알 수 없는 Ternlight 모델입니다: unknown-model');
    expect(unavailable.error).toBe('Ternlight 임베딩 엔진을 사용할 수 없습니다.');
  });

  it('Ternlight 벡터 차원 오류에 실제 차원을 포함한다', async () => {
    ternlightEmbedMock.mockResolvedValueOnce([0.1, 0.2, 0.3]);

    const result = await testEmbeddingGenerationForStrategy(
      'ternlight',
      'ternlight-base',
      baseConfig,
      ternlightRuntime,
    );

    expect(result.error).toBe('Ternlight가 올바르지 않은 임베딩 벡터를 반환했습니다: 3차원');
  });

  it('EmbeddingGemma의 768차원 검증 뒤 검사용 작업자를 정리한다', async () => {
    gemmaMocks.embed.mockResolvedValueOnce(Array.from({ length: 768 }, () => 0.1));
    const result = await testEmbeddingGenerationForStrategy(
      'ternlight',
      'embeddinggemma-300m',
      baseConfig,
      ternlightRuntime,
    );
    expect(result).toMatchObject({ valid: true, models: ['embeddinggemma-300m'] });
    expect(gemmaMocks.close).toHaveBeenCalled();
  });

  it('Custom OpenAI 호환 모델 검색 URL을 /v1/models로 정규화한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'local-model' }] },
      text: '',
    });

    const result = await fetchProviderModels('customOpenAI', {
      ...baseConfig,
      id: 'local',
      name: 'Local',
      baseUrl: 'http://localhost:1234',
    });

    expect(result.models).toEqual(['local-model']);
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234')).toBe(
      'http://localhost:1234/v1',
    );
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:1234/v1/models',
        throw: false,
      }),
    );
  });

  it('최소 생성 테스트만 chat completions endpoint를 호출한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { choices: [{ message: { content: '' } }] },
      text: '',
    });

    const result = await testProviderGeneration(
      'customOpenAI',
      {
        ...baseConfig,
        id: 'local',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
      },
      'local-model',
    );

    expect(result.valid).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:1234/v1/chat/completions',
        method: 'POST',
        throw: false,
      }),
    );
  });

  it('Custom OpenAI-compatible 최소 생성 테스트는 API 키가 비어 있으면 Authorization 헤더를 생략한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { choices: [{ message: { content: 'p' } }] },
      text: '',
    });

    await testProviderGeneration(
      'customOpenAI',
      {
        ...baseConfig,
        id: 'local',
        name: 'Local',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
      },
      'local-model',
    );

    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('OpenAI 임베딩 연결 테스트는 모델 목록만 조회하고 /embeddings에 input을 보내지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-4o-mini' }] },
      text: '',
    });

    const result = await validateEmbeddingConnection(
      'openai',
      'text-embedding-3-small',
      baseConfig,
    );

    expect(result.valid).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini', 'text-embedding-3-small']);
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/models',
        method: 'GET',
        throw: false,
      }),
    );
  });

  it('Custom OpenAI-compatible 임베딩 생성 테스트는 custom base URL의 embeddings endpoint를 호출한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ embedding: [0.3, 0.4] }] },
      text: '',
    });

    const result = await testEmbeddingGeneration('customOpenAI:local', 'custom-embedding', {
      ...baseConfig,
      id: 'local',
      name: 'Local',
      baseUrl: 'http://localhost:1234/v1',
    });

    expect(result.valid).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:1234/v1/embeddings',
        method: 'POST',
        body: JSON.stringify({ input: 'test', model: 'custom-embedding' }),
        throw: false,
      }),
    );
  });

  it('Custom OpenAI-compatible 임베딩 생성 테스트는 API 키가 비어 있으면 Authorization 헤더를 생략한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ embedding: [0.3, 0.4] }] },
      text: '',
    });

    await testEmbeddingGeneration('customOpenAI:local', 'custom-embedding', {
      ...baseConfig,
      id: 'local',
      name: 'Local',
      apiKey: '',
      baseUrl: 'http://localhost:1234/v1',
    });

    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('임베딩 생성 테스트만 /embeddings endpoint를 호출한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ embedding: [0.1, 0.2] }] },
      text: '',
    });

    const result = await testEmbeddingGeneration('openai', 'text-embedding-3-small', baseConfig);

    expect(result.valid).toBe(true);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/embeddings',
        method: 'POST',
        body: JSON.stringify({ input: 'test', model: 'text-embedding-3-small' }),
        throw: false,
      }),
    );
  });

  it('401 응답은 throw 대신 분류된 오류로 반환한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 401,
      json: {},
      text: 'invalid key',
    });

    const result = await validateProviderConnection('openai', baseConfig);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('API 키가 유효하지 않거나 권한이 없습니다 (401)');
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        throw: false,
      }),
    );
  });
});
