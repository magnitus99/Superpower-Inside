import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../settings';
import {
  fetchProviderModels,
  normalizeOpenAICompatibleBaseUrl,
  testProviderConnection,
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

  it('Anthropic을 제외한 OpenAI 모델 검색에는 저장된 API 키를 사용한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { data: [{ id: 'gpt-4o-mini' }] },
      text: '',
    });

    const result = await fetchProviderModels('openai', baseConfig);

    expect(result.valid).toBe(true);
    expect(result.models).toEqual(['gpt-4o-mini']);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/models',
        headers: { Authorization: 'Bearer stored-key' },
      }),
    );
  });

  it('Anthropic 모델 검색에는 저장된 API 키를 자동으로 붙이지 않는다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 401,
      json: {},
      text: 'missing api key',
    });

    const result = await fetchProviderModels('claude', baseConfig);

    expect(result.valid).toBe(false);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.anthropic.com/v1/models',
        headers: { 'anthropic-version': '2023-06-01' },
      }),
    );
  });

  it('OpenRouter 모델 목록에서 텍스트 출력 모델과 메타데이터를 파싱한다', async () => {
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
        ],
      },
      text: '',
    });

    const result = await fetchProviderModels('openRouter', baseConfig);

    expect(result.models).toEqual(['openai/gpt-4o']);
    expect(result.modelDetails).toEqual([
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128000 },
    ]);
    expect(requestUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://openrouter.ai/api/v1/models',
        headers: { Authorization: 'Bearer stored-key' },
      }),
    );
  });

  it('Ollama 태그 목록을 모델 ID 목록으로 변환한다', async () => {
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
        headers: { Authorization: 'Bearer stored-key' },
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
      }),
    );
  });

  it('연결 테스트는 모델 검색과 분리되어 chat completions endpoint를 호출한다', async () => {
    requestUrlMock.mockResolvedValueOnce({
      status: 200,
      json: { choices: [{ message: { content: '' } }] },
      text: '',
    });

    const result = await testProviderConnection(
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
      }),
    );
  });
});
