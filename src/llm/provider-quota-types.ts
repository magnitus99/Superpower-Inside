/** 제공자가 실제 반환한 잔여 한도 창입니다. 기간을 요금제에서 추측하지 않습니다. */
export interface QuotaWindow {
  id: string;
  remainingPercent: number;
  durationSeconds?: number;
  period?: 'session' | 'week' | 'month';
  resetsAt?: string;
  modelId?: string;
}

/** 구매·할당 크레딧의 확인된 잔액 또는 명시적 무제한입니다. */
export interface QuotaCredits {
  remaining?: number;
  unit: 'USD' | 'credits';
  unlimited?: boolean;
}

/** 제공자별 응답을 정규화한 공통 wire 형식입니다. */
export interface ProviderQuotaSnapshot {
  windows: QuotaWindow[];
  credits: QuotaCredits[];
}

/** 최소 잔여 창과 확인된 크레딧입니다. 크레딧은 구독 창과 독립입니다. */
export interface ProviderQuotaSummary {
  window?: QuotaWindow;
  duration?: { value: number; unit: 'second' | 'minute' | 'hour' | 'day' | 'week' };
  credits: QuotaCredits[];
}
