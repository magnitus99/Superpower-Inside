import { requestUrl } from 'obsidian';
import type { ProviderConfig } from '../settings';
import type { ProviderKey } from './providers';

export interface ValidationResult {
  valid: boolean;
  models: string[];
  error?: string;
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url.replace(/\/+$/, '');
}

function normalizeOpenRouterBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!url.endsWith('/api')) {
    url = url + '/api';
  }
  return url;
}

export async function validateProviderApi(
  key: ProviderKey,
  config: ProviderConfig,
): Promise<ValidationResult> {
  if (key === 'ollama' || key === 'ollamaCloud') {
    return validateOllama(config);
  }
  if (key === 'claude') {
    return validateClaude(config);
  }
  if (key === 'openai' || key === 'openRouter') {
    if (key === 'openRouter') {
      config = {
        ...config,
        baseUrl: normalizeOpenRouterBaseUrl(config.baseUrl ?? 'https://openrouter.ai/api'),
      };
    }
    return validateOpenAICompatible(config);
  }
  return { valid: false, models: [], error: 'Unknown provider' };
}

function classifyHttpError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) {
    return `API 키가 유효하지 않습니다 (${status})`;
  }
  if (status === 404) {
    return `URL이 잘못되었습니다. 올바른 엔드포인트를 확인하세요 (${status})`;
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
    return `연결 실패: URL이 잘못되었거나 서버에 접근할 수 없습니다`;
  }
  return msg;
}

async function validateOpenAICompatible(config: ProviderConfig): Promise<ValidationResult> {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
  try {
    const res = await requestUrl({
      url: `${baseUrl}/v1/models`,
      method: 'GET',
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { data?: Array<{ id: string }> }) ?? { data: [] };
    const models =
      data.data?.map((m) => m.id).filter((id) => !id.includes('embedding') && !id.includes('tts') && !id.includes('dall-e') && !id.includes('whisper')).sort((a, b) => a.localeCompare(b)) ?? [];
    return { valid: true, models };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function validateClaude(config: ProviderConfig): Promise<ValidationResult> {
  const baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  try {
    const res = await requestUrl({
      url: `${baseUrl}/v1/models`,
      method: 'GET',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { data?: Array<{ id: string }> }) ?? { data: [] };
    const models = (data.data?.map((m) => m.id) ?? []).sort((a, b) => a.localeCompare(b));
    return { valid: true, models };
  } catch (err) {
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}

async function validateOllama(config: ProviderConfig): Promise<ValidationResult> {
  const baseUrl = normalizeOllamaBaseUrl(config.baseUrl ?? 'http://localhost:11434');
  const targetUrl = `${baseUrl}/api/tags`;
  console.log('[SuperObsidian] Ollama validate URL:', targetUrl, 'original baseUrl:', config.baseUrl);
  try {
    const res = await requestUrl({
      url: targetUrl,
      method: 'GET',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    console.log('[SuperObsidian] Ollama validate response status:', res.status);
    if (res.status >= 400) {
      const text = typeof res.text === 'string' ? res.text : String(res.text);
      return { valid: false, models: [], error: classifyHttpError(res.status, text) };
    }
    const data = (res.json as { models?: Array<{ name: string }> }) ?? { models: [] };
    const models = (data.models?.map((m) => m.name) ?? []).sort((a, b) => a.localeCompare(b));
    return { valid: true, models };
  } catch (err) {
    console.error('[SuperObsidian] Ollama validate error:', err);
    return { valid: false, models: [], error: classifyFetchError(err) };
  }
}
