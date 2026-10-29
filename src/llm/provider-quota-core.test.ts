import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderQuotaSnapshot, QuotaWindow } from './provider-quota-types';

const wire = vi.hoisted(() => ({
  plan: vi.fn<(input: string) => string>(),
  failInit: false,
}));

// 정상 경로는 생성된 실제 WASM을 사용하고, 손상 wire·초기화 실패만 합성합니다.
vi.mock('../../generated/rag-wasm/rag_wasm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/rag-wasm/rag_wasm.js')>();
  wire.plan.mockImplementation(actual.plan_provider_quota_json);
  return {
    ...actual,
    plan_provider_quota_json: wire.plan,
    initSync: (...args: Parameters<typeof actual.initSync>) => {
      if (wire.failInit) throw new Error('synthetic quota init failure');
      return actual.initSync(...args);
    },
  };
});

import {
  normalizeProviderQuotaRust,
  normalizeQuotaIntervalSecondsRust,
  summarizeProviderQuotaRust,
} from '../rag/rust-core';

beforeEach(() => {
  wire.plan.mockClear();
  wire.failInit = false;
});

function summary(windows: QuotaWindow[]) {
  return summarizeProviderQuotaRust({ windows, credits: [] });
}

describe('공식 quota 실제 WASM 연동 · 독립 합성 응답', () => {
  it('표시 단위 변환도 실제 반환 초를 Rust에서만 사용한다', () => {
    expect(
      summary([{ id: 'actual', remainingPercent: 40, durationSeconds: 18000 }])?.duration,
    ).toEqual({ value: 5, unit: 'hour' });
    expect(summary([{ id: 'unknown', remainingPercent: 40 }])?.duration).toBeUndefined();
  });
  it.each([
    { remaining: [10, 2, 80], expected: 'week' },
    { remaining: [100, 100, 100], expected: 'session' },
    { remaining: [100, 100, 20], expected: 'month' },
  ])('$remaining → $expected의 최소 실제 창을 선택한다', ({ remaining, expected }) => {
    expect(
      summary([
        {
          id: 'month',
          remainingPercent: remaining[2],
          durationSeconds: 2_592_000,
        },
        {
          id: 'week',
          remainingPercent: remaining[1],
          durationSeconds: 604_800,
        },
        {
          id: 'session',
          remainingPercent: remaining[0],
          durationSeconds: 18_000,
        },
      ])?.window?.id,
    ).toBe(expected);
  });

  it('반올림 전 비율·동적 소수 기간·ID 순서와 기간 미확인을 구분한다', () => {
    expect(
      summary([
        { id: 'short', remainingPercent: 2.04, durationSeconds: 10 },
        { id: 'long', remainingPercent: 2.01, durationSeconds: 20 },
      ])?.window?.id,
    ).toBe('long');
    expect(
      summary([
        { id: 'unknown', remainingPercent: 100 },
        { id: 'z', remainingPercent: 100, durationSeconds: 12.5 },
        { id: 'a', remainingPercent: 100, durationSeconds: 12.5 },
        { id: 'shortest', remainingPercent: 100, durationSeconds: 12.4 },
      ])?.window?.id,
    ).toBe('shortest');
    expect(
      summary([
        { id: 'z', remainingPercent: 100, durationSeconds: 12.5 },
        { id: 'a', remainingPercent: 100, durationSeconds: 12.5 },
      ])?.window?.id,
    ).toBe('a');
  });

  it('명시된 의미 기간은 세션·주·월 순서이고 월을 일수로 바꾸지 않는다', () => {
    expect(
      summary([
        { id: 'month', remainingPercent: 100, period: 'month' },
        { id: 'week', remainingPercent: 100, period: 'week' },
        { id: 'session', remainingPercent: 100, period: 'session' },
      ])?.window,
    ).toEqual({ id: 'session', remainingPercent: 100, period: 'session' });
  });

  it.each(['plus', 'pro', 'unknown'])('ChatGPT %s도 없는 기본 5시간 창을 만들지 않는다', (plan) => {
    expect(
      normalizeProviderQuotaRust('chatgpt', {
        plan_type: plan,
        rate_limit: {
          secondary_window: {
            used_percent: 98,
            limit_window_seconds: 604_800,
          },
        },
      }),
    ).toEqual({
      windows: [{ id: 'secondary', remainingPercent: 2, durationSeconds: 604_800 }],
      credits: [],
    });
  });

  it('ChatGPT 추가 창·초과 사용·문자열 크레딧을 보존하고 비율 문자열은 거부한다', () => {
    const snapshot = normalizeProviderQuotaRust('chatgpt', {
      rate_limit: {
        primary_window: { used_percent: '0' },
        secondary_window: { used_percent: 120 },
      },
      additional_rate_limits: [
        {
          metered_feature: 'review',
          limit_name: 'cap',
          rate_limit: {
            primary_window: { used_percent: 75, limit_window_seconds: 7200.5 },
          },
        },
      ],
      credits: { has_credits: true, balance: '12.50', unlimited: false },
    });
    expect(snapshot?.windows).toHaveLength(2);
    expect(snapshot?.windows[0]).toEqual({
      id: 'secondary',
      remainingPercent: 0,
    });
    expect(snapshot?.windows[1]).toMatchObject({
      remainingPercent: 25,
      durationSeconds: 7200.5,
    });
    expect(snapshot?.windows[1].id).toContain('review');
    expect(snapshot?.credits).toEqual([{ unit: 'credits', remaining: 12.5, unlimited: false }]);
    expect(
      normalizeProviderQuotaRust('chatgpt', { credits: { unlimited: true } })?.credits,
    ).toEqual([{ unit: 'credits', unlimited: true }]);
  });

  it('Gemini remainingAmount 없이 비율을 받고 GOOGLE_ONE_AI 문자열만 합산한다', () => {
    const snapshot = normalizeProviderQuotaRust('gemini', {
      quota: {
        buckets: [
          {
            modelId: 'synthetic-model',
            tokenType: 'INPUT',
            remainingFraction: 0.02,
            resetTime: '2030-01-01T00:00:00Z',
          },
          {
            modelId: 'synthetic-model',
            tokenType: 'OUTPUT',
            remainingFraction: 0,
          },
          { remainingFraction: '0.3' },
          { remainingFraction: -1 },
          { remainingFraction: 1.1 },
        ],
      },
      creditInfo: {
        paidTier: {
          availableCredits: [
            { creditType: 'GOOGLE_ONE_AI', creditAmount: '12' },
            { creditType: 'GOOGLE_ONE_AI', creditAmount: '3' },
            { creditType: 'OTHER', creditAmount: '999' },
            { creditType: 'GOOGLE_ONE_AI', creditAmount: '' },
          ],
        },
      },
    });
    expect(snapshot?.windows).toHaveLength(2);
    expect(snapshot?.windows[0]).toMatchObject({
      remainingPercent: 2,
      modelId: 'synthetic-model',
      resetsAt: '2030-01-01T00:00:00Z',
    });
    expect(snapshot?.windows[0]).not.toHaveProperty('durationSeconds');
    expect(snapshot?.windows[0]).not.toHaveProperty('period');
    expect(snapshot?.windows[0].id).not.toBe(snapshot?.windows[1].id);
    expect(snapshot?.credits).toEqual([{ unit: 'credits', remaining: 15 }]);
  });

  it('Go의 percent는 사용량이며 rolling의 실제 길이를 추측하지 않는다', () => {
    const snapshot = normalizeProviderQuotaRust('opencode-go', {
      usage: {
        rolling: { percent: 90, resetsAt: '2030-01-01T00:00:00Z' },
        weekly: { percent: 98 },
        monthly: { percent: 20 },
      },
    });
    expect(snapshot).toEqual({
      windows: [
        {
          id: 'rolling',
          remainingPercent: 10,
          resetsAt: '2030-01-01T00:00:00Z',
        },
        { id: 'weekly', remainingPercent: 2, period: 'week' },
        { id: 'monthly', remainingPercent: 80, period: 'month' },
      ],
      credits: [],
    });
    if (!snapshot) throw new Error('합성 스냅샷 정규화 실패');
    expect(summarizeProviderQuotaRust(snapshot)?.window?.id).toBe('weekly');
  });

  it('Ollama 월 포함량·구형 창·구매 잔액 0을 분리한다', () => {
    expect(
      normalizeProviderQuotaRust('ollama-cloud', {
        included: {
          balance_usd: 5,
          allowance_usd: 20,
          period: { from: '2030-01-01', until: '2030-02-01' },
        },
        purchased: { balance_usd: 0 },
      }),
    ).toEqual({
      windows: [
        {
          id: 'included',
          remainingPercent: 25,
          period: 'month',
          resetsAt: '2030-02-01',
        },
      ],
      credits: [{ unit: 'USD', remaining: 0 }],
    });
    expect(
      normalizeProviderQuotaRust('ollama-cloud', {
        included: { balance_usd: 0, allowance_usd: 0 },
      }),
    ).toEqual({ windows: [], credits: [] });
    expect(
      normalizeProviderQuotaRust('ollama-cloud', {
        included: {
          session: { remaining_percent: 0, resets_at: '2030-01-01T00:00:00Z' },
          weekly: { remaining_percent: 80 },
        },
      })?.windows,
    ).toEqual([
      {
        id: 'session',
        remainingPercent: 0,
        period: 'session',
        resetsAt: '2030-01-01T00:00:00Z',
      },
      { id: 'weekly', remainingPercent: 80, period: 'week' },
    ]);
  });

  it('OpenRouter는 키 한도가 아닌 계정 크레딧만 받고 구독 소진을 만들지 않는다', () => {
    const snapshot = normalizeProviderQuotaRust('openrouter', {
      data: { total_credits: 10, total_usage: 4 },
    });
    expect(snapshot).toEqual({
      windows: [],
      credits: [{ unit: 'USD', remaining: 6 }],
    });
    if (!snapshot) throw new Error('합성 스냅샷 정규화 실패');
    expect(summarizeProviderQuotaRust(snapshot)).toEqual({
      credits: [{ unit: 'USD', remaining: 6 }],
      subscriptionExhausted: false,
    });
    for (const data of [
      { limit_remaining: 20 },
      { total_credits: 10 },
      { total_credits: 1, total_usage: 2 },
    ]) {
      expect(normalizeProviderQuotaRust('openrouter', { data })).toEqual({
        windows: [],
        credits: [],
      });
    }
  });

  it('잘못된 창만 버리고 유효한 0을 보존하며 비율·크레딧의 비유한 값을 거부한다', () => {
    expect(
      normalizeProviderQuotaRust('chatgpt', {
        rate_limit: {
          primary_window: { used_percent: NaN },
          secondary_window: {
            used_percent: 100,
            limit_window_seconds: Infinity,
          },
        },
      })?.windows,
    ).toEqual([{ id: 'secondary', remainingPercent: 0 }]);
    expect(summary([{ id: 'zero', remainingPercent: 0 }])?.subscriptionExhausted).toBe(true);
    expect(summary([])).toEqual({ credits: [], subscriptionExhausted: false });
    for (const balance of ['', '-1', 'NaN', 'Infinity', null]) {
      expect(
        normalizeProviderQuotaRust('chatgpt', {
          credits: { has_credits: false, balance },
        })?.credits,
      ).toEqual([]);
    }
    expect(
      normalizeProviderQuotaRust('ollama-cloud', {
        purchased: { balance_usd: -1 },
      })?.credits,
    ).toEqual([]);
  });

  it('null·비객체 payload는 실패이고 빈 객체는 미확인 목록이다', () => {
    expect(normalizeProviderQuotaRust('chatgpt', null)).toBeNull();
    expect(normalizeProviderQuotaRust('chatgpt', [])).toBeNull();
    expect(normalizeProviderQuotaRust('chatgpt', {})).toEqual({
      windows: [],
      credits: [],
    });
    expect(
      normalizeProviderQuotaRust('chatgpt', {
        credits: { balance: BigInt(1) },
      }),
    ).toBeNull();
  });

  it.each([
    [undefined, 30],
    [null, 30],
    [NaN, 30],
    [Infinity, 30],
    ['60', 30],
    [10.5, 30],
    [0, 10],
    [-1, 10],
    [10, 10],
    [31, 31],
    [3601, 3600],
  ])('간격 %s는 Rust에서 %s초로 정규화한다', (value, expected) => {
    expect(normalizeQuotaIntervalSecondsRust(value)).toBe(expected);
  });
});

describe('quota wire의 엄격한 스키마와 실패 경계', () => {
  it.each([
    null,
    [],
    {},
    { windows: null, credits: [] },
    { windows: [], credits: [{ unit: 'EUR', remaining: 2 }] },
    { windows: [], credits: [{ unit: 'USD' }] },
    { windows: [], credits: [{ unit: 'credits', unlimited: false }] },
    { windows: [], credits: [{ unit: 'USD', remaining: -1 }] },
    { windows: [], credits: [{ unit: 'USD', remaining: '2' }] },
    { windows: [], credits: [{ unit: 'USD', remaining: null }] },
    { windows: [], credits: [{ unit: 'credits', unlimited: 'true' }] },
    ...[
      { id: '', remainingPercent: 10 },
      { id: 'a', remainingPercent: '10' },
      { id: 'a', remainingPercent: -1 },
      { id: 'a', remainingPercent: 101 },
      { id: 'a', remainingPercent: null },
      { id: 'a', remainingPercent: 10, durationSeconds: 0 },
      { id: 'a', remainingPercent: 10, durationSeconds: null },
      { id: 'a', remainingPercent: 10, period: 'day' },
      { id: 'a', remainingPercent: 10, resetsAt: null },
      { id: 'a', remainingPercent: 10, modelId: 3 },
    ].map((window) => ({ windows: [window], credits: [] })),
    { windows: [], credits: [], unexpected: true },
  ])('손상된 스냅샷 wire %j를 타입 단언으로 통과시키지 않는다', (result) => {
    wire.plan.mockReturnValueOnce(JSON.stringify(result));
    expect(normalizeProviderQuotaRust('chatgpt', {})).toBeNull();
  });

  it.each([
    ...[
      null,
      { value: 0, unit: 'hour' },
      { value: 2, unit: 'month' },
      { value: '2', unit: 'hour' },
      { value: 2, unit: 'hour', extra: true },
    ].map((duration) => ({ duration, credits: [], subscriptionExhausted: false })),
    { credits: [], subscriptionExhausted: 'false' },
    { window: null, credits: [], subscriptionExhausted: false },
    {
      window: { id: 'x', remainingPercent: 101 },
      credits: [],
      subscriptionExhausted: false,
    },
    { credits: [{ unit: 'USD', remaining: -1 }], subscriptionExhausted: false },
  ])('손상된 요약 wire %j도 null로 닫는다', (result) => {
    wire.plan.mockReturnValueOnce(JSON.stringify(result));
    expect(summary([])).toBeNull();
  });

  it('JSON 파싱 실패·범위 밖 간격·비유한 수치·wire 예외를 대체 계산하지 않는다', () => {
    for (const result of ['bad-json', 'null', '9', '3601', '30.5', '1e999', '"30"']) {
      wire.plan.mockReturnValueOnce(result);
      expect(normalizeQuotaIntervalSecondsRust(60)).toBeNull();
    }
    wire.plan.mockReturnValueOnce('{"windows":[{"id":"x","remainingPercent":1e999}],"credits":[]}');
    expect(normalizeProviderQuotaRust('chatgpt', {})).toBeNull();
    wire.plan.mockImplementationOnce(() => {
      throw new Error('synthetic quota wire failure');
    });
    expect(summary([])).toBeNull();
  });

  it('잘못된 공통 스냅샷 입력도 wire 이전에 거부한다', () => {
    const snapshot: ProviderQuotaSnapshot = {
      windows: [{ id: 'invalid', remainingPercent: NaN }],
      credits: [],
    };
    expect(summarizeProviderQuotaRust(snapshot)).toBeNull();
    expect(wire.plan).not.toHaveBeenCalled();
  });

  it('WASM 초기화 실패 시 정규화·선택·기본 간격의 TS fallback을 모두 금지한다', async () => {
    vi.resetModules();
    wire.failInit = true;
    const unavailable = await import('../rag/rust-core');
    expect(unavailable.normalizeProviderQuotaRust('chatgpt', {})).toBeNull();
    expect(unavailable.summarizeProviderQuotaRust({ windows: [], credits: [] })).toBeNull();
    expect(unavailable.normalizeQuotaIntervalSecondsRust(undefined)).toBeNull();
    expect(wire.plan).not.toHaveBeenCalled();
  });
});
