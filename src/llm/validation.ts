import { requestUrl } from 'obsidian';
import { t } from '../i18n';
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

export interface ProviderConnectionValidator {
  fetchModels(): Promise<ValidationResult>;
  validateConnection(): Promise<ValidationResult>;
  testGeneration(modelId: string): Promise<ValidationResult>;
}

export interface EmbeddingConnectionValidator {
  validateConnection(modelId: string): Promise<ValidationResult>;
  testEmbedding(modelId: string): Promise<ValidationResult>;
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

function classifyHttpError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) {
    return t('apiKeyUnauthorizedError', { status });
  }
  if (status === 404) {
    return t('endpointOrModelNotFoundError', { status });
  }
  if (status >= 500) {
    return t('serverStatusError', { status });
  }
  return t('apiStatusError', { status, body: bodyText });
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
    return t('connectionFailedNoServer');
  }
  return msg;
}

function buildBearerHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

function getResponseText(text: unknown): string {
  return typeof text === 'string' ? text : String(text);
}

function withCustomProviderHint(error: string): string {
  return t('customProviderBaseUrlHint', { error });
}

interface OpenAIModelRecord {
  id: string;
  name?: string;
}

interface AnthropicModelRecord {
  id: string;
  display_name?: string;
}

interface OpenRouterModelRecord extends OpenAIModelRecord {
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

class OpenAICompatibleValidator implements ProviderConnectionValidator {
  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    private readonly baseUrl: string,
    private readonly isOpenRouter = false,
    private readonly isCustom = false,
  ) {}

  async fetchModels(): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: buildBearerHeaders(this.config.apiKey),
        throw: false,
      });
      if (res.status >= 400) {
        const error = classifyHttpError(res.status, getResponseText(res.text));
        return {
          valid: false,
          models: [],
          error: this.isCustom ? withCustomProviderHint(error) : error,
        };
      }

      if (this.isOpenRouter) {
        const data = (res.json as { data?: OpenRouterModelRecord[] }) ?? {};
        const modelDetails =
          data.data
            ?.map((model) => ({
              id: model.id,
              name: model.name,
              contextLength: model.context_length,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
        return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
      }

      const data = (res.json as { data?: OpenAIModelRecord[] }) ?? { data: [] };
      const modelDetails =
        data.data
          ?.map((model) => ({ id: model.id, name: model.name }))
          .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
      return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }

  async validateConnection(): Promise<ValidationResult> {
    return this.fetchModels();
  }

  async testGeneration(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBearerHeaders(this.config.apiKey),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
      }
      return { valid: true, models: [modelId] };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class AnthropicValidator implements ProviderConnectionValidator {
  constructor(private readonly config: ProviderConfig | CustomOpenAIProviderConfig) {}

  async fetchModels(): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${ANTHROPIC_BASE_URL}/models`,
        method: 'GET',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
      }
      const data = (res.json as { data?: AnthropicModelRecord[] }) ?? {};
      const modelDetails =
        data.data
          ?.map((model) => ({ id: model.id, name: model.display_name }))
          .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
      return { valid: true, models: modelDetails.map((model) => model.id), modelDetails };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }

  async validateConnection(): Promise<ValidationResult> {
    return this.fetchModels();
  }

  async testGeneration(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${ANTHROPIC_BASE_URL}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
      }
      return { valid: true, models: [modelId] };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class OllamaValidator implements ProviderConnectionValidator {
  private readonly normalizedBaseUrl: string;

  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    baseUrl: string,
    private readonly usesApiKey: boolean,
  ) {
    this.normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  }

  async fetchModels(): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.normalizedBaseUrl}/api/tags`,
        method: 'GET',
        headers: this.usesApiKey ? buildBearerHeaders(this.config.apiKey) : {},
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
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

  async validateConnection(): Promise<ValidationResult> {
    return this.fetchModels();
  }

  async testGeneration(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.normalizedBaseUrl}/api/chat`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.usesApiKey ? buildBearerHeaders(this.config.apiKey) : {}),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
          options: { num_predict: 1 },
        }),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
      }
      return { valid: true, models: [modelId] };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class OpenAICompatibleEmbeddingValidator implements EmbeddingConnectionValidator {
  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    private readonly baseUrl: string,
  ) {}

  async validateConnection(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: buildBearerHeaders(this.config.apiKey),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
      }
      const data = (res.json as { data?: OpenAIModelRecord[] }) ?? { data: [] };
      const modelDetails =
        data.data
          ?.map((model) => ({ id: model.id, name: model.name }))
          .sort((a, b) => a.id.localeCompare(b.id)) ?? [];
      return {
        valid: true,
        models: modelDetails.length > 0 ? modelDetails.map((model) => model.id) : [modelId],
        modelDetails,
      };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }

  async testEmbedding(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/embeddings`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildBearerHeaders(this.config.apiKey),
        },
        body: JSON.stringify({ input: 'test', model: modelId }),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
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
}

class OllamaEmbeddingValidator implements EmbeddingConnectionValidator {
  private readonly providerValidator: OllamaValidator;

  constructor(config: ProviderConfig) {
    this.providerValidator = new OllamaValidator(config, OLLAMA_LOCAL_BASE_URL, false);
  }

  async validateConnection(): Promise<ValidationResult> {
    return this.providerValidator.validateConnection();
  }

  async testEmbedding(modelId: string): Promise<ValidationResult> {
    const baseUrl = normalizeOllamaBaseUrl(OLLAMA_LOCAL_BASE_URL);
    try {
      const res = await requestUrl({
        url: `${baseUrl}/api/embed`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: modelId, input: ['test'] }),
        throw: false,
      });
      if (res.status >= 400) {
        return {
          valid: false,
          models: [],
          error: classifyHttpError(res.status, getResponseText(res.text)),
        };
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
}

function createProviderValidator(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): ProviderConnectionValidator | null {
  if (key === 'claude') {
    return new AnthropicValidator(config);
  }
  if (key === 'ollama' || key === 'ollamaCloud') {
    return new OllamaValidator(config, getFixedProviderBaseUrl(key), key === 'ollamaCloud');
  }
  if (key === 'openRouter') {
    return new OpenAICompatibleValidator(config, OPENROUTER_BASE_URL, true);
  }
  if (key === 'customOpenAI') {
    if (!config.baseUrl?.trim()) {
      return null;
    }
    return new OpenAICompatibleValidator(
      config,
      normalizeOpenAICompatibleBaseUrl(config.baseUrl ?? ''),
      false,
      true,
    );
  }
  if (key === 'openai') {
    return new OpenAICompatibleValidator(config, OPENAI_BASE_URL);
  }
  return null;
}

function createEmbeddingValidator(
  providerKey: EmbeddingProviderKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): EmbeddingConnectionValidator | null {
  if (providerKey === 'ollama') {
    return new OllamaEmbeddingValidator(config);
  }
  if (providerKey === 'openai' || providerKey === 'openRouter') {
    const baseUrl = providerKey === 'openRouter' ? OPENROUTER_BASE_URL : OPENAI_BASE_URL;
    return new OpenAICompatibleEmbeddingValidator(config, baseUrl);
  }
  if (providerKey.startsWith('customOpenAI:')) {
    if (!config.baseUrl?.trim()) {
      return null;
    }
    return new OpenAICompatibleEmbeddingValidator(
      config,
      normalizeOpenAICompatibleBaseUrl(config.baseUrl),
    );
  }
  return null;
}

export async function fetchProviderModels(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  const validator = createProviderValidator(key, config);
  if (!validator) {
    return {
      valid: false,
      models: [],
      error: key === 'customOpenAI' ? t('customProviderBaseUrlRequired') : 'Unknown provider',
    };
  }
  return validator.fetchModels();
}

export async function validateProviderConnection(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  const validator = createProviderValidator(key, config);
  if (!validator) {
    return {
      valid: false,
      models: [],
      error: key === 'customOpenAI' ? t('customProviderBaseUrlRequired') : 'Unknown provider',
    };
  }
  return validator.validateConnection();
}

export async function testProviderGeneration(
  key: ProviderValidationKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  modelId: string,
): Promise<ValidationResult> {
  const validator = createProviderValidator(key, config);
  if (!validator) {
    return {
      valid: false,
      models: [],
      error: key === 'customOpenAI' ? t('customProviderBaseUrlRequired') : 'Unknown provider',
    };
  }
  return validator.testGeneration(modelId);
}

export async function validateProviderApi(
  key: ProviderKey,
  config: ProviderConfig,
): Promise<ValidationResult> {
  return validateProviderConnection(key, config);
}

export async function validateEmbeddingConnection(
  providerKey: EmbeddingProviderKey,
  modelId: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  const validator = createEmbeddingValidator(providerKey, config);
  if (!validator) {
    return { valid: false, models: [], error: 'Unknown embedding provider' };
  }
  return validator.validateConnection(modelId);
}

export async function testEmbeddingGeneration(
  providerKey: EmbeddingProviderKey,
  modelId: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  const validator = createEmbeddingValidator(providerKey, config);
  if (!validator) {
    return { valid: false, models: [], error: 'Unknown embedding provider' };
  }
  return validator.testEmbedding(modelId);
}
