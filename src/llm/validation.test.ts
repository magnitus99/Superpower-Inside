import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import type { ProviderConfig } from '../settings';
import type { TernlightRuntimeOptions } from './ternlight-runtime';
import {
  fetchProviderModels,
  fetchProviderModelsForStrategy,
  normalizeOpenAICompatibleBaseUrl,
  testEmbeddingGeneration,
  testEmbeddingGenerationForStrategy,
  testProviderGeneration,
  validateEmbeddingConnection,
  validateProviderConnection,
} from './validation';

const requestUrlMock = vi.hoisted(() => vi.fn());
const ternlightEmbedMock = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({
  requestUrl: requestUrlMock,
}));

vi.mock('./embedding', () => ({
  TernlightEmbeddingProvider: class {
    embed = ternlightEmbedMock;
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

    const result = await testEmbeddingGeneration(
      'customOpenAI:local',
      'custom-embedding',
      {
        ...baseConfig,
        id: 'local',
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
      },
    );

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

    await testEmbeddingGeneration(
      'customOpenAI:local',
      'custom-embedding',
      {
        ...baseConfig,
        id: 'local',
        name: 'Local',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
      },
    );

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
