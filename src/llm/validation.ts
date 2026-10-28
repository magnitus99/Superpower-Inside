import { requestUrl } from 'obsidian';
import { t } from '../i18n';
import type {
  CustomOpenAIProviderConfig,
  EmbeddingProviderKey,
  ProviderApiFormat,
  ProviderConfig,
  ProviderStrategyKey,
} from '../settings';
import {
  buildOpenCodeEndpoint,
  buildOpenCodeModelsUrl,
  buildOpenCodeSessionHeaders,
  buildProviderApiEndpoint,
  inferProviderApiFormatFromBaseUrl,
  isLocalOllamaBaseUrl,
  normalizeGeminiApiRoot,
  normalizeOpenCodeBaseUrl,
  normalizeProviderApiFormat,
  normalizeProviderApiRoot,
} from './provider-api-format';
import { TernlightEmbeddingProvider, EmbeddingGemmaProvider } from './embedding';
import type { TernlightRuntimeOptions } from './ternlight-runtime';
import type { ProviderKey } from './providers';
import { planProviderModelDetailsRust } from '../rag/rust-core';
import { googleGeminiOAuth } from './google-gemini-oauth';
import { createGeminiApiKeyProvider, createGeminiOAuthProvider } from './gemini-provider';

export interface ProviderModelInfo {
  maxInputTokens?: number;
  id: string;
  name?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  apiFormat?: ProviderApiFormat;
  supportedApiFormats?: ProviderApiFormat[];
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

export type ProviderValidationKey =
  | ProviderKey
  | 'customOpenAI'
  | 'openAIChatGPT'
  | 'opencode'
  | 'gemini';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434';
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro',
  'gemini-3-flash',
];

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
      throw new Error(t('validationUnknownProvider'));
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

export async function fetchOllamaModelInfo(
  key: 'ollama' | 'ollamaCloud',
  config: ProviderConfig | CustomOpenAIProviderConfig,
  model: string,
): Promise<ProviderModelInfo | undefined> {
  const baseUrl = normalizeOllamaBaseUrl(config.baseUrl?.trim() || getFixedProviderBaseUrl(key));
  const response = await requestUrl({
    url: `${baseUrl}/api/show`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(!isLocalOllamaBaseUrl(baseUrl) ? buildBearerHeaders(config.apiKey) : {}),
    },
    body: JSON.stringify({ model }),
    throw: false,
  });
  if (response.status >= 400) return undefined;
  return planProviderModelDetailsRust('ollama', {
    ...(response.json as Record<string, unknown>),
    id: model,
  })?.[0];
}

/** 목록의 페이지 수와 무관하게 선택한 Claude 모델 자체의 한도를 조회한다. */
export async function fetchAnthropicModelInfo(
  config: ProviderConfig | CustomOpenAIProviderConfig,
  model: string,
): Promise<ProviderModelInfo | undefined> {
  const baseUrl = config.baseUrl?.trim()
    ? normalizeProviderApiRoot(config.baseUrl)
    : ANTHROPIC_BASE_URL;
  const response = await requestUrl({
    url: `${baseUrl}/models/${encodeURIComponent(model)}`,
    method: 'GET',
    headers: { 'x-api-key': config.apiKey.trim(), 'anthropic-version': '2023-06-01' },
    throw: false,
  });
  if (response.status >= 400) return undefined;
  return planProviderModelDetailsRust('claude', { data: [response.json] })?.find(
    (detail) => detail.id === model,
  );
}

class OpenAICompatibleValidator implements ProviderConnectionValidator {
  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    private readonly baseUrl: string,
    private readonly format: ProviderApiFormat = 'chat',
    private readonly isOpenRouter = false,
    private readonly isCustom = false,
    private readonly modelsUrl?: string,
    private readonly endpointBuilder?: (model: string) => string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private buildMessagesHeaders(): Record<string, string> {
    const apiKey = this.config.apiKey.trim();
    return {
      'Content-Type': 'application/json',
      ...(apiKey
        ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey }
        : {}),
      'anthropic-version': '2023-06-01',
      ...this.extraHeaders,
    };
  }

  async fetchModels(): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: this.modelsUrl ?? `${this.baseUrl}/models`,
        method: 'GET',
        headers: { ...buildBearerHeaders(this.config.apiKey), ...this.extraHeaders },
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

      const modelDetails =
        planProviderModelDetailsRust(this.isOpenRouter ? 'openRouter' : 'openai', res.json) ?? [];
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
      const endpoint =
        this.endpointBuilder?.(modelId) ??
        buildProviderApiEndpoint(this.baseUrl, this.format, modelId);
      const headers =
        this.format === 'messages'
          ? this.buildMessagesHeaders()
          : {
              'Content-Type': 'application/json',
              ...buildBearerHeaders(this.config.apiKey),
              ...this.extraHeaders,
            };
      const body =
        this.format === 'messages'
          ? {
              model: modelId,
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ping' }],
            }
          : this.format === 'responses'
            ? {
                model: modelId,
                input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
                max_output_tokens: 1,
                stream: false,
              }
            : this.format === 'gemini'
              ? {
                  contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                  generationConfig: { maxOutputTokens: 1 },
                }
              : {
                  model: modelId,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1,
                  stream: false,
                };
      const res = await requestUrl({
        url: endpoint,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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

class GeminiValidator implements ProviderConnectionValidator {
  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    private readonly profileId: string,
  ) {}

  private async auth(): Promise<{ headers: Record<string, string>; projectId?: string }> {
    if (this.config.geminiAuthMode === 'oauth') {
      const credentials = await googleGeminiOAuth.credentials(this.profileId);
      return {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        projectId: credentials.projectId,
      };
    }
    return this.config.apiKey.trim()
      ? { headers: { 'x-goog-api-key': this.config.apiKey.trim() } }
      : { headers: {} };
  }

  async fetchModels(): Promise<ValidationResult> {
    try {
      const auth = await this.auth();
      const res = await requestUrl({
        url: `${normalizeGeminiApiRoot(this.config.baseUrl?.trim() || GEMINI_BASE_URL)}/models`,
        method: 'GET',
        headers: auth.headers,
        throw: false,
      });
      if (res.status >= 400) {
        return this.config.geminiAuthMode === 'oauth'
          ? {
              valid: true,
              models: GEMINI_FALLBACK_MODELS,
              modelDetails: GEMINI_FALLBACK_MODELS.map((id) => ({ id })),
            }
          : {
              valid: false,
              models: [],
              error: classifyHttpError(res.status, getResponseText(res.text)),
            };
      }
      const modelDetails = planProviderModelDetailsRust('gemini', res.json) ?? [];
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
      const provider =
        this.config.geminiAuthMode === 'oauth'
          ? createGeminiOAuthProvider(modelId, this.profileId)
          : createGeminiApiKeyProvider(modelId, this.config.apiKey, undefined, this.config.baseUrl);
      const answer = await provider.chat([{ role: 'user', content: 'ping' }], 0, undefined, {
        maxOutputTokens: 16,
      });
      return answer.trim()
        ? { valid: true, models: [modelId] }
        : { valid: false, models: [], error: t('geminiResponseInvalid') };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class AnthropicValidator implements ProviderConnectionValidator {
  constructor(
    private readonly config: ProviderConfig | CustomOpenAIProviderConfig,
    private readonly baseUrl = ANTHROPIC_BASE_URL,
  ) {}

  async fetchModels(): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/models`,
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
      const modelDetails = planProviderModelDetailsRust('claude', res.json) ?? [];
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
        url: `${this.baseUrl}/messages`,
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
      return { valid: false, models: [], error: t('validationInvalidEmbeddingResponse') };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class OllamaEmbeddingValidator implements EmbeddingConnectionValidator {
  private readonly providerValidator: OllamaValidator;
  private readonly baseUrl: string;

  constructor(private readonly config: ProviderConfig) {
    this.baseUrl = normalizeOllamaBaseUrl(config.baseUrl?.trim() || OLLAMA_LOCAL_BASE_URL);
    this.providerValidator = new OllamaValidator(
      config,
      this.baseUrl,
      !isLocalOllamaBaseUrl(this.baseUrl),
    );
  }

  async validateConnection(): Promise<ValidationResult> {
    return this.providerValidator.validateConnection();
  }

  async testEmbedding(modelId: string): Promise<ValidationResult> {
    try {
      const res = await requestUrl({
        url: `${this.baseUrl}/api/embed`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(!isLocalOllamaBaseUrl(this.baseUrl)
            ? buildBearerHeaders(this.config.apiKey)
            : {}),
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
      return { valid: false, models: [], error: t('validationInvalidEmbeddingResponse') };
    } catch (err) {
      return { valid: false, models: [], error: classifyFetchError(err) };
    }
  }
}

class TernlightEmbeddingValidator implements EmbeddingConnectionValidator {
  constructor(private readonly runtime: TernlightRuntimeOptions | undefined) {}

  async validateConnection(modelId: string): Promise<ValidationResult> {
    if (modelId !== 'ternlight-base' && modelId !== 'embeddinggemma-300m') {
      return {
        valid: false,
        models: [],
        error: t('validationTernlightUnknownModel', { model: modelId }),
      };
    }
    const result = await this.testEmbedding(modelId);
    return result.valid
      ? {
          valid: true,
          models: [modelId],
          modelDetails: [{ id: modelId }],
        }
      : result;
  }

  async testEmbedding(modelId: string): Promise<ValidationResult> {
    if (!this.runtime) {
      return { valid: false, models: [], error: t('validationTernlightUnavailable') };
    }
    try {
      const provider =
        modelId === 'embeddinggemma-300m'
          ? new EmbeddingGemmaProvider(this.runtime)
          : new TernlightEmbeddingProvider(modelId, this.runtime);
      let vector: number[];
      try {
        vector = await provider.embed('test');
      } finally {
        if (modelId === 'embeddinggemma-300m') provider.close();
      }
      return vector.length === (modelId === 'embeddinggemma-300m' ? 768 : 384)
        ? { valid: true, models: [modelId] }
        : {
            valid: false,
            models: [],
            error: t('validationEmbeddingVectorInvalid', { size: vector.length }),
          };
    } catch (err) {
      return { valid: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function createProviderValidator(
  key: ProviderValidationKey | ProviderStrategyKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): ProviderConnectionValidator | null {
  if (key === 'openAIChatGPT') {
    return {
      fetchModels: async () => {
        try {
          const { fetchChatGPTModelDetails } = await import('./chatgpt-provider');
          const modelDetails = await fetchChatGPTModelDetails(
            config.id ?? 'profile',
          );
          return {
            valid: true,
            models: modelDetails.map((model) => model.id),
            modelDetails,
          };
        } catch (error) {
          return {
            valid: false,
            models: [],
            error: error instanceof Error ? error.message : t('chatGPTOAuthFailed'),
          };
        }
      },
      validateConnection: async () => {
        return fetchProviderModels('openAIChatGPT', config);
      },
      testGeneration: async (modelId) => {
        try {
          const { ChatGPTProvider } = await import('./chatgpt-provider');
          const provider = new ChatGPTProvider(config.id ?? 'profile', modelId);
          const answer = await provider.chat([{ role: 'user', content: 'ping' }]);
          return answer.trim()
            ? { valid: true, models: [modelId] }
            : { valid: false, models: [], error: t('chatGPTResponseInvalid') };
        } catch (error) {
          return {
            valid: false,
            models: [],
            error: error instanceof Error ? error.message : t('chatGPTOAuthFailed'),
          };
        }
      },
    };
  }
  if (key === 'gemini') {
    return new GeminiValidator(config, config.id ?? 'profile');
  }
  if (key === 'claude') {
    return new AnthropicValidator(
      config,
      config.baseUrl?.trim() ? normalizeProviderApiRoot(config.baseUrl) : ANTHROPIC_BASE_URL,
    );
  }
  if (key === 'ollama' || key === 'ollamaCloud') {
    const baseUrl =
      key === 'ollamaCloud'
        ? OLLAMA_CLOUD_BASE_URL
        : config.baseUrl?.trim() || OLLAMA_LOCAL_BASE_URL;
    return new OllamaValidator(config, baseUrl, !isLocalOllamaBaseUrl(baseUrl));
  }
  if (key === 'opencode') {
    const format = normalizeProviderApiFormat(config.apiFormat) ?? 'responses';
    return new OpenAICompatibleValidator(
      config,
      normalizeOpenCodeBaseUrl(config.baseUrl),
      format,
      false,
      false,
      buildOpenCodeModelsUrl(config.baseUrl),
      (model) => buildOpenCodeEndpoint(config.baseUrl, format, model),
      buildOpenCodeSessionHeaders(config.id),
    );
  }
  if (key === 'openRouter') {
    return new OpenAICompatibleValidator(
      config,
      config.baseUrl?.trim() ? normalizeProviderApiRoot(config.baseUrl) : OPENROUTER_BASE_URL,
      'chat',
      true,
    );
  }
  if (key === 'customOpenAI' || key === 'openAICompatible') {
    if (!config.baseUrl?.trim()) {
      return null;
    }
    const format =
      normalizeProviderApiFormat(config.apiFormat) ??
      inferProviderApiFormatFromBaseUrl(config.baseUrl) ??
      'chat';
    return new OpenAICompatibleValidator(
      config,
      format === 'gemini' ? config.baseUrl : normalizeProviderApiRoot(config.baseUrl ?? ''),
      format,
      false,
      true,
    );
  }
  if (key === 'openai') {
    return new OpenAICompatibleValidator(
      config,
      config.baseUrl?.trim() ? normalizeProviderApiRoot(config.baseUrl) : OPENAI_BASE_URL,
      'chat',
    );
  }
  return null;
}

function createEmbeddingValidator(
  providerKey: EmbeddingProviderKey | ProviderStrategyKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  ternlightRuntime?: TernlightRuntimeOptions,
): EmbeddingConnectionValidator | null {
  if (providerKey === 'ollama') {
    return new OllamaEmbeddingValidator(config);
  }
  if (providerKey === 'ternlight') {
    return new TernlightEmbeddingValidator(ternlightRuntime);
  }
  if (providerKey === 'openai' || providerKey === 'openRouter') {
    const baseUrl = config.baseUrl?.trim()
      ? normalizeProviderApiRoot(config.baseUrl)
      : providerKey === 'openRouter'
        ? OPENROUTER_BASE_URL
        : OPENAI_BASE_URL;
    return new OpenAICompatibleEmbeddingValidator(config, baseUrl);
  }
  if (providerKey === 'openAICompatible') {
    if (!config.baseUrl?.trim()) {
      return null;
    }
    return new OpenAICompatibleEmbeddingValidator(
      config,
      normalizeProviderApiRoot(config.baseUrl),
    );
  }
  if (providerKey.startsWith('customOpenAI:')) {
    if (!config.baseUrl?.trim()) {
      return null;
    }
    return new OpenAICompatibleEmbeddingValidator(
      config,
      normalizeProviderApiRoot(config.baseUrl),
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
      error:
        key === 'customOpenAI' || key === 'openAIChatGPT'
          ? t('customProviderBaseUrlRequired')
          : t('validationUnknownProvider'),
    };
  }
  return validator.fetchModels();
}

export async function fetchProviderModelsForStrategy(
  key: ProviderStrategyKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
): Promise<ValidationResult> {
  if (key === 'ternlight') {
    return {
      valid: false,
      models: [],
      error: t('validationTernlightEmbeddingOnly'),
    };
  }
  return fetchProviderModels(key === 'openAICompatible' ? 'customOpenAI' : key, config);
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
      error:
        key === 'customOpenAI' || key === 'openAIChatGPT'
          ? t('customProviderBaseUrlRequired')
          : t('validationUnknownProvider'),
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
      error:
        key === 'customOpenAI' || key === 'openAIChatGPT'
          ? t('customProviderBaseUrlRequired')
          : t('validationUnknownProvider'),
    };
  }
  return validator.testGeneration(modelId);
}

export async function testProviderGenerationForStrategy(
  key: ProviderStrategyKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  modelId: string,
): Promise<ValidationResult> {
  if (key === 'ternlight') {
    return {
      valid: false,
      models: [],
      error: t('validationTernlightEmbeddingOnly'),
    };
  }
  return testProviderGeneration(key === 'openAICompatible' ? 'customOpenAI' : key, config, modelId);
}

export async function validateEmbeddingConnection(
  providerKey: EmbeddingProviderKey,
  modelId: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  ternlightRuntime?: TernlightRuntimeOptions,
): Promise<ValidationResult> {
  const validator = createEmbeddingValidator(providerKey, config, ternlightRuntime);
  if (!validator) {
    return { valid: false, models: [], error: t('validationUnknownProvider') };
  }
  return validator.validateConnection(modelId);
}

export async function testEmbeddingGeneration(
  providerKey: EmbeddingProviderKey,
  modelId: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  ternlightRuntime?: TernlightRuntimeOptions,
): Promise<ValidationResult> {
  const validator = createEmbeddingValidator(providerKey, config, ternlightRuntime);
  if (!validator) {
    return { valid: false, models: [], error: t('validationUnknownProvider') };
  }
  return validator.testEmbedding(modelId);
}

export async function testEmbeddingGenerationForStrategy(
  providerKey: ProviderStrategyKey,
  modelId: string,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  ternlightRuntime?: TernlightRuntimeOptions,
): Promise<ValidationResult> {
  const validator = createEmbeddingValidator(providerKey, config, ternlightRuntime);
  if (!validator) {
    return {
      valid: false,
      models: [],
      error: t('validationEmbeddingUnsupported'),
    };
  }
  return validator.testEmbedding(modelId);
}
