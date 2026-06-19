import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../settings';
import {
  fetchProviderModels,
  normalizeOpenAICompatibleBaseUrl,
  testEmbeddingGeneration,
  testProviderGeneration,
  validateEmbeddingConnection,
  validateProviderConnection,
} from './validation';

const requestUrlMock = vi.hoisted(() => vi.fn());

vi.mock('obsidian', () => ({
  requestUrl: requestUrlMock,
}));

const baseConfig: ProviderConfig = {
  apiKey: 'stored-key',
  models: [],
  enabled: true,
};

describe('provider validation', () => {
  beforeEach(() => {
    requestUrlMock.mockReset();
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
