import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import type { ProviderProfileConfig } from '../settings';
import { getProviderQuotaDisplay, renderProviderQuota } from './provider-quota-display';

const profile: ProviderProfileConfig = {
  id: 'sample',
  name: 'Sample',
  strategy: 'openAIChatGPT',
  apiKey: '',
  enabled: true,
  models: [],
};
afterEach(() => setLanguage('ko'));

describe('공통 한도 표시', () => {
  it('실제 최소 잔여 창과 실제 기간을 함께 표시한다', () => {
    setLanguage('ko');
    const result = getProviderQuotaDisplay(profile, {
      status: 'ready',
      snapshot: {
        windows: [
          { id: 'long', remainingPercent: 50, durationSeconds: 18000 },
          { id: 'short', remainingPercent: 2, durationSeconds: 604800 },
        ],
        credits: [],
      },
    });
    expect(result.text).toBe('1주 · 2% 남음');
  });
  it('시간과 기간 미제공을 요금제에서 추정하지 않는다', () => {
    const snapshot = {
      credits: [],
      windows: [{ id: 'rolling', remainingPercent: 40, durationSeconds: 18000 }],
    };
    expect(getProviderQuotaDisplay(profile, { status: 'ready', snapshot }).text).toBe(
      '5시간 · 40% 남음',
    );
    expect(
      getProviderQuotaDisplay(profile, {
        status: 'ready',
        snapshot: { ...snapshot, windows: [{ id: 'unknown', remainingPercent: 40 }] },
      }).text,
    ).toBe('기간 미제공 · 40% 남음');
  });
  it('OpenRouter는 잔여 크레딧만 표시한다', () => {
    expect(
      getProviderQuotaDisplay(
        { ...profile, strategy: 'openRouter' },
        { status: 'ready', snapshot: { windows: [], credits: [{ unit: 'USD', remaining: 12.4 }] } },
      ).text,
    ).toBe('크레딧 $12.40 남음');
  });
  it('0과 명시적 무제한을 조회 불가와 구분한다', () => {
    expect(
      getProviderQuotaDisplay(profile, {
        status: 'ready',
        snapshot: {
          windows: [{ id: 'zero', remainingPercent: 0, period: 'week' }],
          credits: [{ unit: 'credits', remaining: 0 }],
        },
      }).text,
    ).toBe('1주 · 0% 남음 · 크레딧 0 남음');
    expect(
      getProviderQuotaDisplay(profile, {
        status: 'ready',
        snapshot: { windows: [], credits: [{ unit: 'credits', unlimited: true }] },
      }).text,
    ).toBe('크레딧 무제한');
  });
  it('조회 불가·대기·미지원·비활성을 정직하게 표시한다', () => {
    expect(getProviderQuotaDisplay(profile, undefined).text).toBe('한도 조회 중…');
    expect(
      getProviderQuotaDisplay(profile, { status: 'unavailable', reason: 'permission' }).text,
    ).toBe('한도를 조회할 수 없습니다');
    expect(
      getProviderQuotaDisplay(profile, { status: 'unavailable', reason: 'authentication' })
        .description,
    ).toContain('다시 로그인');
    expect(
      getProviderQuotaDisplay({ ...profile, strategy: 'openAICompatible' }, undefined).text,
    ).toContain('자동 조회 미지원');
    expect(
      getProviderQuotaDisplay(profile, { status: 'unavailable', reason: 'endpoint' }).text,
    ).toContain('자동 조회 미지원');
    expect(getProviderQuotaDisplay({ ...profile, enabled: false }, undefined).text).toBe(
      '연결 비활성',
    );
  });
  it('잔액 존재만으로 크레딧 사용 중을 단정하지 않는다', () => {
    const result = getProviderQuotaDisplay(profile, {
      status: 'ready',
      snapshot: {
        windows: [{ id: 'zero', remainingPercent: 0 }],
        credits: [{ unit: 'USD', remaining: 5 }],
      },
    });
    expect(result.text).not.toContain('사용 중');
    expect(result.text).not.toContain('비용');
  });
  it('영어 UI도 같은 한도와 잔액을 표시한다', () => {
    setLanguage('en');
    expect(
      getProviderQuotaDisplay(profile, {
        status: 'ready',
        snapshot: { windows: [{ id: 'week', period: 'week', remainingPercent: 2 }], credits: [] },
      }).text,
    ).toBe('1 week · 2% left');
  });
  it('표시 갱신은 내용이 바뀔 때만 DOM을 쓰며 상태와 설명을 함께 유지한다', () => {
    const attrs = new Map<string, string>();
    let writes = 0;
    const element = {
      textContent: '',
      dataset: {},
      setText(text: string) {
        this.textContent = text;
        writes++;
      },
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    renderProviderQuota(element as unknown as HTMLElement, profile, undefined);
    renderProviderQuota(element as unknown as HTMLElement, profile, undefined);
    expect(writes).toBe(1);
    expect(attrs.get('title')).toBeTruthy();
    expect(element.dataset).toMatchObject({ quotaStatus: 'loading' });
  });
});
