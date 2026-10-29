import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfileConfig } from '../settings';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  chatCredentials: vi.fn(),
  geminiCredentials: vi.fn(),
}));
vi.mock('obsidian', () => ({ requestUrl: mocks.request }));
const authState = vi.hoisted(() => ({ connected: true, revision: 0 }));
vi.mock('./chatgpt-oauth', () => ({
  chatGPTOAuth: {
    credentials: mocks.chatCredentials,
    isConnected: () => authState.connected,
    getRevision: () => authState.revision,
  },
}));
vi.mock('./google-gemini-oauth', () => ({
  googleGeminiOAuth: {
    credentials: mocks.geminiCredentials,
    isConnected: () => authState.connected,
    getRevision: () => authState.revision,
  },
}));
import { fetchProviderQuota, getProviderQuotaIdentity } from './provider-quota-api';

function profile(
  strategy: ProviderProfileConfig['strategy'],
  baseUrl?: string,
): ProviderProfileConfig {
  return {
    id: 'synthetic',
    name: strategy,
    strategy,
    baseUrl,
    apiKey: 'synthetic-key',
    enabled: true,
    models: [],
  };
}
function response(json: unknown, status = 200, headers: Record<string, string> = {}) {
  return { status, json, headers };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatCredentials.mockResolvedValue({
    accessToken: 'synthetic-token',
    accountId: 'synthetic-account',
  });
  mocks.geminiCredentials.mockResolvedValue({
    accessToken: 'synthetic-token',
    projectId: 'synthetic-project',
  });
});

describe('공식 제공자 한도 조회 어댑터', () => {
  it('자격증명·연결 변경만 식별자를 바꾸고 변경 없는 반복은 유지한다', () => {
    const base = profile('openAIChatGPT');
    const identity = getProviderQuotaIdentity(base);
    expect(getProviderQuotaIdentity({ ...base })).toBe(identity);
    for (const changed of [
      { ...base, apiKey: 'other' },
      { ...base, baseUrl: 'https://chatgpt.com' },
      { ...base, enabled: false },
      { ...base, geminiAuthMode: 'oauth' as const },
    ]) {
      expect(getProviderQuotaIdentity(changed)).not.toBe(identity);
    }
    authState.revision = 1;
    expect(getProviderQuotaIdentity(base)).not.toBe(identity);
    authState.revision = 0;
    expect(getProviderQuotaIdentity(base)).toBe(identity);
    authState.connected = false;
    expect(getProviderQuotaIdentity(base)).not.toBe(identity);
    authState.connected = true;
    expect(getProviderQuotaIdentity(base)).toBe(identity);
  });
  it('ChatGPT 실제 한도 응답과 OAuth 계정 헤더를 사용한다', async () => {
    mocks.request.mockResolvedValue(
      response({
        rate_limit: { secondary_window: { used_percent: 98, limit_window_seconds: 604800 } },
      }),
    );
    expect(await fetchProviderQuota(profile('openAIChatGPT'))).toMatchObject({
      status: 'ready',
      snapshot: { windows: [{ remainingPercent: 2, durationSeconds: 604800 }] },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://chatgpt.com/backend-api/wham/usage',
        method: 'GET',
        headers: {
          Authorization: 'Bearer synthetic-token',
          'ChatGPT-Account-Id': 'synthetic-account',
          Accept: 'application/json',
          originator: 'superpower-inside',
        },
      }),
    );
  });
  it('OAuth 401만 토큰 갱신 뒤 한 번 재시도한다', async () => {
    mocks.request
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ credits: { balance: '7', unlimited: false } }));
    expect(await fetchProviderQuota(profile('openAIChatGPT'))).toMatchObject({ status: 'ready' });
    expect(mocks.chatCredentials.mock.calls).toEqual([
      ['synthetic', false],
      ['synthetic', true],
    ]);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it.each(['openAIChatGPT', 'gemini'] as const)(
    '%s 자격증명 갱신 실패는 인증 문제로 분류하고 원문을 숨긴다',
    async (strategy) => {
      mocks.chatCredentials.mockRejectedValue(new Error('synthetic-revoked-token'));
      mocks.geminiCredentials.mockRejectedValue(new Error('synthetic-revoked-token'));
      const config = profile(strategy);
      config.geminiAuthMode = 'oauth';
      const result = await fetchProviderQuota(config);
      expect(result).toEqual({ status: 'unavailable', reason: 'authentication' });
      expect(JSON.stringify(result)).not.toContain('synthetic-revoked-token');
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it('Go 구독은 Go 한도 경로만 호출하고 공개되지 않은 잔액을 추정하지 않는다', async () => {
    mocks.request.mockResolvedValue(response({ usage: { weekly: { percent: 60 } } }));
    expect(
      await fetchProviderQuota(profile('opencode', 'https://opencode.ai/inference/go')),
    ).toMatchObject({
      status: 'ready',
      snapshot: { windows: [{ remainingPercent: 40 }], credits: [] },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://opencode.ai/zen/go/v1/usage' }),
    );
  });
  it('OpenRouter는 계정 잔액만 조회하고 키의 지출 상한을 구독제로 표시하지 않는다', async () => {
    mocks.request.mockResolvedValue(response({ data: { total_credits: 40, total_usage: 13 } }));
    expect(await fetchProviderQuota(profile('openRouter'))).toMatchObject({
      status: 'ready',
      snapshot: { windows: [], credits: [{ remaining: 27, unit: 'USD' }] },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://openrouter.ai/api/v1/credits' }),
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('OpenRouter 일반 키의 잔액 권한 부족을 0 크레딧으로 바꾸지 않는다', async () => {
    mocks.request.mockResolvedValue(response({}, 403));
    expect(await fetchProviderQuota(profile('openRouter'))).toEqual({
      status: 'unavailable',
      reason: 'permission',
    });
  });
  it('Ollama Cloud의 포함 한도와 구매 잔액을 분리한다', async () => {
    mocks.request.mockResolvedValue(
      response({
        included: { allowance_usd: 100, balance_usd: 20 },
        purchased: { balance_usd: 8 },
      }),
    );
    expect(await fetchProviderQuota(profile('ollamaCloud'))).toMatchObject({
      status: 'ready',
      snapshot: { windows: [{ remainingPercent: 20 }], credits: [{ remaining: 8, unit: 'USD' }] },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://ollama.com/api/balance' }),
    );
  });
  it('Gemini 로그인 한도는 remainingAmount 없이도 읽고 크레딧은 별도 조회한다', async () => {
    mocks.request.mockImplementation((request: { url: string }) =>
      Promise.resolve(
        response(
          request.url.endsWith(':retrieveUserQuota')
            ? { buckets: [{ modelId: 'synthetic-model', remainingFraction: 0.3 }] }
            : {
                paidTier: {
                  availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: '12' }],
                },
              },
        ),
      ),
    );
    const config = profile('gemini');
    config.geminiAuthMode = 'oauth';
    expect(await fetchProviderQuota(config)).toMatchObject({
      status: 'ready',
      snapshot: {
        windows: [{ remainingPercent: 30 }],
        credits: [{ remaining: 12, unit: 'credits' }],
      },
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
        body: JSON.stringify({ project: 'synthetic-project' }),
      }),
    );
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      }),
    );
  });
  it('Gemini 크레딧 조회만 실패해도 확보한 한도를 버리지 않는다', async () => {
    mocks.request.mockImplementation((request: { url: string }) =>
      Promise.resolve(
        request.url.endsWith(':retrieveUserQuota')
          ? response({ buckets: [{ remainingFraction: 1 }] })
          : response({}, 503),
      ),
    );
    const config = profile('gemini');
    config.geminiAuthMode = 'oauth';
    expect(await fetchProviderQuota(config)).toMatchObject({
      status: 'ready',
      snapshot: { windows: [{ remainingPercent: 100 }], credits: [] },
    });
  });
  it('Gemini 보조 조회가 함께 제한되면 가장 긴 Retry-After를 지킨다', async () => {
    mocks.request.mockImplementation((request: { url: string }) =>
      Promise.resolve(
        response({}, 429, {
          'Retry-After': request.url.endsWith(':retrieveUserQuota') ? '60' : '120',
        }),
      ),
    );
    const config = profile('gemini');
    config.geminiAuthMode = 'oauth';
    expect(await fetchProviderQuota(config)).toEqual({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 120000,
    });
  });

  it('429의 Retry-After 대기시간은 전역 주기와 별도로 전달한다', async () => {
    mocks.request.mockResolvedValue(response({}, 429, { 'retry-after': '120' }));
    expect(await fetchProviderQuota(profile('openRouter'))).toEqual({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 120000,
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it.each(['openAICompatible', 'ollama', 'ternlight'] as const)(
    '%s에는 한도 조회 네트워크를 보내지 않는다',
    async (strategy) => {
      const result = await fetchProviderQuota(profile(strategy));
      expect(result.status).toBe(
        strategy === 'openAICompatible' ? 'unsupported' : 'not-applicable',
      );
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it.each(['openai', 'claude', 'gemini', 'opencode'] as const)(
    '%s의 공개 조회 미지원은 모델 실패로 바꾸지 않는다',
    async (strategy) => {
      expect(await fetchProviderQuota(profile(strategy))).toEqual({
        status: 'unavailable',
        reason: 'not-exposed',
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it('공식 strategy라도 다른 호스트의 키를 공식 서버에 전송하지 않는다', async () => {
    expect(await fetchProviderQuota(profile('openRouter', 'https://example.invalid/api'))).toEqual({
      status: 'unavailable',
      reason: 'endpoint',
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each(['opencode', 'openRouter', 'ollamaCloud'] as const)(
    '%s 사용자 지정 주소는 동일한 미지원 사유로 구분한다',
    async (strategy) => {
      expect(await fetchProviderQuota(profile(strategy, 'https://example.invalid/api'))).toEqual({
        status: 'unavailable',
        reason: 'endpoint',
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it('성공 HTTP에 빈 데이터가 와도 한도를 만들지 않는다', async () => {
    mocks.request.mockResolvedValue(response({}));
    expect(await fetchProviderQuota(profile('openAIChatGPT'))).toEqual({
      status: 'unavailable',
      reason: 'invalid-response',
    });
  });
  it('네트워크 예외 본문의 키나 계정 데이터를 결과에 포함하지 않는다', async () => {
    mocks.request.mockRejectedValue(new Error('synthetic-secret-in-error'));
    const result = await fetchProviderQuota(profile('openRouter'));
    expect(result).toEqual({ status: 'unavailable', reason: 'network' });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });
});
