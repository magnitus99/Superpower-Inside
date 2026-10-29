import { requestUrl, type RequestUrlParam } from 'obsidian';
import type { ProviderProfileConfig } from '../settings';
import { normalizeProviderQuotaRust } from '../rag/rust-core';
import { chatGPTOAuth } from './chatgpt-oauth';
import { googleGeminiOAuth } from './google-gemini-oauth';
import {
  buildOpenCodeSessionHeaders,
  normalizeOpenCodeBaseUrl,
  OPENCODE_GO_BASE_URL,
  OPENCODE_DEFAULT_BASE_URL,
} from './provider-api-format';
import type { ProviderQuotaSnapshot } from './provider-quota-types';

export type ProviderQuotaUnavailableReason =
  | 'authentication'
  | 'permission'
  | 'rate-limited'
  | 'network'
  | 'invalid-response'
  | 'not-exposed'
  | 'endpoint'
  | 'timeout';
export type ProviderQuotaResult =
  | { status: 'ready'; snapshot: ProviderQuotaSnapshot; retryAfterMs?: number }
  | { status: 'unavailable'; reason: ProviderQuotaUnavailableReason; retryAfterMs?: number }
  | { status: 'unsupported' | 'not-applicable' | 'disabled' };

class QuotaRequestError extends Error {
  constructor(
    readonly reason: ProviderQuotaUnavailableReason,
    readonly retryAfterMs?: number,
    readonly retryAuthentication = false,
  ) {
    super(reason);
  }
}

/** 조회 대기시간만 해석하며 응답 본문과 인증 자료는 오류에 보관하지 않습니다. */
function retryDelay(headers: Record<string, string>): number | undefined {
  const raw = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  if (!raw?.trim()) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

async function requestQuota(request: RequestUrlParam): Promise<unknown> {
  const response = await requestUrl({ ...request, throw: false });
  if (response.status < 200 || response.status >= 300) {
    const reason =
      response.status === 401
        ? 'authentication'
        : response.status === 403
          ? 'permission'
          : response.status === 429
            ? 'rate-limited'
            : 'network';
    throw new QuotaRequestError(
      reason,
      response.status === 429 ? retryDelay(response.headers ?? {}) : undefined,
      response.status === 401,
    );
  }
  return response.json as unknown;
}

function failure(error: unknown): ProviderQuotaResult & { status: 'unavailable' } {
  if (!(error instanceof QuotaRequestError)) return { status: 'unavailable', reason: 'network' };
  return {
    status: 'unavailable',
    reason: error.reason,
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
  };
}

async function quotaCredentials<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new QuotaRequestError('authentication');
  }
}

async function oauthQuota(
  profile: ProviderProfileConfig,
  method: 'usage' | 'retrieveUserQuota' | 'loadCodeAssist',
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (method === 'usage') {
        if (!chatGPTOAuth.isConnected(profile.id)) throw new QuotaRequestError('authentication');
        const auth = await quotaCredentials(() =>
          chatGPTOAuth.credentials(profile.id, attempt === 1),
        );
        return await requestQuota({
          url: 'https://chatgpt.com/backend-api/wham/usage',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'ChatGPT-Account-Id': auth.accountId,
            Accept: 'application/json',
            originator: 'superpower-inside',
          },
        });
      }
      if (!googleGeminiOAuth.isConnected(profile.id)) throw new QuotaRequestError('authentication');
      const auth = await quotaCredentials(() =>
        googleGeminiOAuth.credentials(profile.id, attempt === 1),
      );
      const body =
        method === 'retrieveUserQuota'
          ? { project: auth.projectId }
          : {
              metadata: {
                ideType: 'IDE_UNSPECIFIED',
                platform: 'PLATFORM_UNSPECIFIED',
                pluginType: 'GEMINI',
              },
            };
      return await requestQuota({
        url: `https://cloudcode-pa.googleapis.com/v1internal:${method}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof QuotaRequestError && error.retryAuthentication && attempt === 0)
        continue;
      throw error;
    }
  }
  throw new QuotaRequestError('authentication');
}

function officialEndpoint(
  profile: ProviderProfileConfig,
  origin: string,
  paths: readonly string[],
): boolean {
  if (!profile.baseUrl?.trim()) return true;
  try {
    const url = new URL(profile.baseUrl);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      paths.includes(url.pathname.replace(/\/+$/, ''))
    );
  } catch {
    return false;
  }
}

/** 요금제 이름 대신 현재 인증·연결 세대만 추적합니다. 이 값은 메모리에만 머뭅니다. */
export function getProviderQuotaIdentity(profile: ProviderProfileConfig): string {
  const auth =
    profile.strategy === 'openAIChatGPT'
      ? chatGPTOAuth
      : profile.strategy === 'gemini' && profile.geminiAuthMode === 'oauth'
        ? googleGeminiOAuth
        : undefined;
  return JSON.stringify([
    profile.strategy,
    profile.baseUrl,
    profile.apiKey,
    profile.enabled,
    profile.geminiAuthMode,
    auth?.isConnected(profile.id),
    auth?.getRevision(profile.id),
  ]);
}

/** 모델 실행이나 결제 설정을 변경하지 않는 읽기 전용 조회입니다. */
export async function fetchProviderQuota(
  profile: ProviderProfileConfig,
): Promise<ProviderQuotaResult> {
  if (!profile.enabled) return { status: 'disabled' };
  if (profile.strategy === 'openAICompatible') return { status: 'unsupported' };
  if (profile.strategy === 'ternlight') return { status: 'not-applicable' };
  if (profile.strategy === 'ollama' && !profile.baseUrl?.startsWith('https://ollama.com'))
    return { status: 'not-applicable' };
  try {
    let format: Parameters<typeof normalizeProviderQuotaRust>[0];
    let payload: unknown;
    let retryAfterMs: number | undefined;
    if (profile.strategy === 'openAIChatGPT') {
      format = 'chatgpt';
      payload = await oauthQuota(profile, 'usage');
    } else if (profile.strategy === 'gemini' && profile.geminiAuthMode === 'oauth') {
      format = 'gemini';
      const [quota, creditInfo] = await Promise.allSettled([
        oauthQuota(profile, 'retrieveUserQuota'),
        oauthQuota(profile, 'loadCodeAssist'),
      ]);
      if (quota.status === 'rejected' && creditInfo.status === 'rejected') {
        const quotaFailure = failure(quota.reason);
        const creditFailure = failure(creditInfo.reason);
        const delay = Math.max(quotaFailure.retryAfterMs ?? 0, creditFailure.retryAfterMs ?? 0);
        return delay > 0
          ? { status: 'unavailable', reason: 'rate-limited', retryAfterMs: delay }
          : quotaFailure;
      }
      for (const result of [quota, creditInfo]) {
        if (result.status === 'rejected') {
          const delay = failure(result.reason).retryAfterMs;
          if (delay !== undefined) retryAfterMs = Math.max(retryAfterMs ?? 0, delay);
        }
      }
      payload = {
        ...(quota.status === 'fulfilled' ? { quota: quota.value } : {}),
        ...(creditInfo.status === 'fulfilled' ? { creditInfo: creditInfo.value } : {}),
      };
    } else {
      let url: string;
      let extraHeaders: Record<string, string> = {};
      if (profile.strategy === 'openRouter') {
        if (!officialEndpoint(profile, 'https://openrouter.ai', ['', '/api', '/api/v1']))
          return { status: 'unavailable', reason: 'endpoint' };
        format = 'openrouter';
        url = 'https://openrouter.ai/api/v1/credits';
      } else if (profile.strategy === 'ollamaCloud' || profile.strategy === 'ollama') {
        if (!officialEndpoint(profile, 'https://ollama.com', ['', '/api', '/v1']))
          return { status: 'unavailable', reason: 'endpoint' };
        format = 'ollama-cloud';
        url = 'https://ollama.com/api/balance';
      } else if (profile.strategy === 'opencode') {
        const base = normalizeOpenCodeBaseUrl(profile.baseUrl);
        if (base !== OPENCODE_DEFAULT_BASE_URL && base !== OPENCODE_GO_BASE_URL)
          return { status: 'unavailable', reason: 'endpoint' };
        if (base !== OPENCODE_GO_BASE_URL) return { status: 'unavailable', reason: 'not-exposed' };
        format = 'opencode-go';
        url = 'https://opencode.ai/zen/go/v1/usage';
        extraHeaders = {
          ...buildOpenCodeSessionHeaders(profile.id),
          'User-Agent': 'superpower-inside',
        };
      } else {
        return { status: 'unavailable', reason: 'not-exposed' };
      }
      if (!profile.apiKey.trim()) return { status: 'unavailable', reason: 'authentication' };
      payload = await requestQuota({
        url,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          Accept: 'application/json',
          ...extraHeaders,
        },
      });
    }
    const snapshot = normalizeProviderQuotaRust(format, payload);
    return snapshot && (snapshot.windows.length > 0 || snapshot.credits.length > 0)
      ? { status: 'ready', snapshot, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
      : {
          status: 'unavailable',
          reason: 'invalid-response',
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        };
  } catch (error) {
    return failure(error);
  }
}
