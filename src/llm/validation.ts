import { requestUrl } from 'obsidian';
import type { CustomOpenAIProviderConfig, EmbeddingProviderKey, ProviderConfig } from '../settings';
import type { ProviderKey } from './providers';

export interface ProviderModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ValidationResult {
  valid: boolean;
  models: string[];
  error?: string;
  modelDetails?: ProviderModelInfo[];
}

export type ProviderValidationKey = ProviderKey | 'customOpenAI';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434';
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function normalizeOllamaBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url.replace(/\/+$/, '');
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.slice(0, -17);
  }
  if (url.endsWith('/models')) {
    url = url.slice(0, -7);
  }
  if (!url.endsWith('/v1')) {
    url = `${url}/v1`;
  }
  return url.replace(/\/+$/, '');
}

function getFixedProviderBaseUrl(key: ProviderKey): string {
  switch (key) {
    case 'openai':
      return OPENAI_BASE_URL;
    case 'claude':
      return ANTHROPIC_BASE_URL;
    case 'ollama':
      return OLLAMA_LOCAL_BASE_URL;
    case 'ollamaCloud':
      return OLLAMA_CLOUD_BASE_URL;
    case 'openRouter':
      return OPENROUTER_BASE_URL;
    default:
      throw new Error(`Unknown provider: ${String(key)}`);
  }
}

export async function fetchProviderModels(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  if (key === 'claude') {
    return fetchClaudeModelsWithoutStoredKey();
  }
  if (key === 'ollama' || key === 'ollamaCloud') {
    const baseUrl = getFixedProviderBaseUrl(key);
    return fetchOllamaModels(key === 'ollama' ? { ...config, apiKey: '' } : config, baseUrl);
  }
  if (key === 'openRouter') {
    return fetchOpenRouterModels(config);
  }
  if (key === 'customOpenAI') {
    if (!config.baseUrl?.trim()) {
      return { valid: false, models: [], error: 'Custom provider base URL을 입력하세요.' };
    }
    return fetchOpenAICompatibleModels(config);
  }
  if (key === 'openai') {
    return fetchOpenAIModels(config, OPENAI_BASE_URL);
  }
  return { valid: false, models: [], error: 'Unknown provider' };
}

export async function testProviderConnection(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  modelId: string,
): Promise<ValidationResult> {
  if (key === 'ollama' || key === 'ollamaCloud') {
    return testOllamaChat(
      key === 'ollama' ? { ...config, apiKey: '' } : config,
      getFixedProviderBaseUrl(key),
      modelId,
    );
  }
  if (key === 'claude') {
    return testClaudeChat(config, modelId);
  }
  if (key === 'openRouter') {
    return testOpenAICompatibleChat(config, OPENROUTER_BASE_URL, modelId);
  }
  if (key === 'customOpenAI') {
    if (!config.baseUrl?.trim()) {
      return { valid: false, models: [], error: 'Custom provider base URL을 입력하세요.' };
    }
    return testOpenAICompatibleChat(
      config,
      normalizeOpenAICompatibleBaseUrl(config.baseUrl ?? ''),
      modelId,
    );
  }
  if (key === 'openai') {
    return testOpenAICompatibleChat(config, OPENAI_BASE_URL, modelId);
  }
  return { valid: false, models: [], error: 'Unknown provider' };
}

export async function validateProviderApi(
  key: ProviderKey,
  config: ProviderConfig,
): Promise<ValidationResult> {
  return fetchProviderModels(key, config);
}

function classifyHttpError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) {
    return `API 키가 유효하지 않거나 권한이 없습니다 (${status})`;
  }
  if (status === 404) {
    return `엔드포인트 또는 모델을 찾을 수 없습니다 (${status})`;
  }
  if (status >= 500) {
    return `서버 오류가 발생했습니다 (${status})`;
  }
  return `API 오류 (${status}): ${bodyText}`;
}

function classifyFetchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('fetch failed')
  ) {
    return '연결 실패: 서버에 접근할 수 없습니다';
  }
  return msg;
}

function buildBearerHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

async function fetchOpenAIModels(
  config: ProviderConfig,
  baseUrl: string,
): Promise<ValidationResult> {
  return fetchOpenAICompatibleModels({ ...config, baseUrl });
}

async function fetchOpenRouterModels(config: ProviderConfig): Promise<ValidationResult> {
  try {
    const res = await requestUrl({
      url: `${OPENROUTER_BASE_URL}/models`,
      method: 'GET',
      headers: buildBearerHeaders(config.apiKey),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { data?: OpenRouterModelRecord[] }) ?? {};
    const modelDetails =
      data.data
        ?.filter(isOpenRouterChatModel)
        .map((model) => ({
          id: model.id,
          name: model.name,
          contextLength: model.context_length,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
    return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

interface OpenRouterModelRecord {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

function isOpenRouterChatModel(model: OpenRouterModelRecord): boolean {
  const output = model.architecture?.output_modalities ?? [];
  const modality = model.architecture?.modality ?? '';
  if (output.length > 0) return output.includes('text');
  if (modality) return modality.includes('text');
  return true;
}

async function fetchOpenAICompatibleModels(
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl ?? OPENAI_BASE_URL);
  try {
    const res = await requestUrl({
      url: `${baseUrl}/models`,
      method: 'GET',
      headers: buildBearerHeaders(config.apiKey),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { data?: Array<{ id: string; name?: string }> }) ?? { data: [] };
    const modelDetails =
      data.data
        ?.filter((model) => isChatModelId(model.id))
        .map((model) => ({ id: model.id, name: model.name }))
        .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
    return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

function isChatModelId(id: string): boolean {
  const normalized = id.toLowerCase();
  return (
    !normalized.includes('embedding') &&
    !normalized.includes('embed') &&
    !normalized.includes('tts') &&
    !normalized.includes('dall-e') &&
    !normalized.includes('whisper')
  );
}

async function fetchClaudeModelsWithoutStoredKey(): Promise<ValidationResult> {
  try {
    const res = await requestUrl({
      url: `${ANTHROPIC_BASE_URL}/models`,
      method: 'GET',
      headers: { 'anthropic-version': '2023-06-01' },
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return {
        valid: false,
        models: [],
        error: `Anthropic 모델 검색은 저장된 API 키 자동 사용 대상에서 제외되어 있습니다. ${classifyHttpError(res.status, text)}`,
      };
    }
    const data = (res.json as { data?: Array<{ id: string; display_name?: string }> }) ?? {};
    const modelDetails =
      data.data
        ?.map((model) => ({ id: model.id, name: model.display_name }))
        .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
    return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function fetchOllamaModels(
  config: ProviderConfig,
  baseUrl: string,
): Promise<ValidationResult> {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  try {
    const res = await requestUrl({
      url: `${normalizedBaseUrl}/api/tags`,
      method: 'GET',
      headers: buildBearerHeaders(config.apiKey),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { models?: Array<{ name: string }> }) ?? { models: [] };
    const models = (data.models?.map((model) => model.name) ?? []).sort((a, b) =>
      a.localeCompare(b),
    );
    return { valid: true, models, modelDetails: models.map((id) => ({ id })) };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function testOpenAICompatibleChat(
  config: ProviderConfig | CustomOpenAIProviderConfig,
  baseUrl: string,
  modelId: string,
): Promise<ValidationResult> {
  try {
    const res = await requestUrl({
      url: `${baseUrl}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBearerHeaders(config.apiKey),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    return { valid: true, models: [modelId] };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function testClaudeChat(config: ProviderConfig, modelId: string): Promise<ValidationResult> {
  try {
    const res = await requestUrl({
      url: `${ANTHROPIC_BASE_URL}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    return { valid: true, models: [modelId] };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function testOllamaChat(
  config: ProviderConfig,
  baseUrl: string,
  modelId: string,
): Promise<ValidationResult> {
  const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  try {
    const res = await requestUrl({
      url: `${normalizedBaseUrl}/api/chat`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildBearerHeaders(config.apiKey),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        options: { num_predict: 1 },
      }),
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    return { valid: true, models: [modelId] };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

export async function validateEmbeddingConnection(
  providerKey: EmbeddingProviderKey,
  modelId: string,
  config: ProviderConfig,
): Promise<ValidationResult> {
  if (providerKey === 'other') {
    return { valid: true, models: [modelId], error: 'Custom endpoint — manual validation only' };
  }

  if (providerKey === 'ollama') {
    const baseUrl = normalizeOllamaBaseUrl(OLLAMA_LOCAL_BASE_URL);
    try {
      const res = await requestUrl({
        url: `${baseUrl}/api/embed`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: modelId, input: ['test'] }),
      });
      if (res.status >= 400) {
        const text = typeof res.text === 'string' ? res.text : String(res.text);
        return { valid: false, models: [], error: classifyHttpError(res.status, text) };
      }
      const data = (res.json as { embeddings?: unknown[] }) ?? {};
      if (Array.isArray(data.embeddings) && data.embeddings.length > 0) {
        return { valid: true, models: [modelId] };
      }
      return { valid: false, models: [], error: 'Invalid embedding response' };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }

  if (providerKey === 'openai' || providerKey === 'openRouter') {
    const baseUrl = providerKey === 'openRouter' ? OPENROUTER_BASE_URL : OPENAI_BASE_URL;
    try {
      const res = await requestUrl({
        url: `${baseUrl}/embeddings`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBearerHeaders(config.apiKey),
        },
        body: JSON.stringify({ input: 'test', model: modelId }),
      });
      if (res.status >= 400) {
        const text = typeof res.text === 'string' ? res.text : String(res.text);
        return { valid: false, models: [], error: classifyHttpError(res.status, text) };
      }
      const data = (res.json as { data?: Array<{ embedding: unknown }> }) ?? {};
      if (data.data?.[0]?.embedding) {
        return { valid: true, models: [modelId] };
      }
      return { valid: false, models: [], error: 'Invalid embedding response' };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }

  return { valid: false, models: [], error: 'Unknown embedding provider' };
}
