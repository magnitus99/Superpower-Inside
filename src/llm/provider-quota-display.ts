import { getLanguage, t } from '../i18n';
import { summarizeProviderQuotaRust } from '../rag/rust-core';
import type { ProviderProfileConfig } from '../settings';
import type { ProviderQuotaState } from './provider-quota-service';
import type { ProviderQuotaSummary } from './provider-quota-types';

interface QuotaDisplay {
  text: string;
  description: string;
  status: 'loading' | 'ready' | 'unavailable' | 'unsupported' | 'disabled' | 'not-applicable';
}

function periodText(summary: ProviderQuotaSummary): string {
  if (summary.duration) {
    const { value, unit } = summary.duration;
    const options: Intl.NumberFormatOptions = {
      unit,
      unitDisplay: 'long',
      maximumFractionDigits: 20,
    };
    options.style = 'unit';
    return new Intl.NumberFormat(getLanguage(), options).format(value);
  }
  switch (summary.window?.period) {
    case 'session':
      return t('quotaPeriodSession');
    case 'week':
      return t('quotaPeriodWeek');
    case 'month':
      return t('quotaPeriodMonth');
    default:
      return t('quotaPeriodUnknown');
  }
}

/** 두 화면은 같은 Rust 요약과 번역을 사용하며 네트워크·타이머를 만들지 않습니다. */
export function getProviderQuotaDisplay(
  profile: ProviderProfileConfig,
  state: ProviderQuotaState | undefined,
): QuotaDisplay {
  if (
    profile.strategy === 'openAICompatible' ||
    state?.status === 'unsupported' ||
    (state?.status === 'unavailable' && state.reason === 'endpoint')
  ) {
    return {
      text: t('quotaUnsupported'),
      description: t('quotaUnsupportedDesc'),
      status: 'unsupported',
    };
  }
  if (!profile.enabled || state?.status === 'disabled')
    return { text: t('quotaDisabled'), description: t('quotaDisabled'), status: 'disabled' };
  if (profile.strategy === 'ternlight' || state?.status === 'not-applicable')
    return {
      text: t('quotaNotApplicable'),
      description: t('quotaNotApplicable'),
      status: 'not-applicable',
    };
  if (!state || state.status === 'loading')
    return { text: t('quotaLoading'), description: t('quotaLoading'), status: 'loading' };
  if (state.status === 'ready') {
    const summary = summarizeProviderQuotaRust(state.snapshot);
    if (summary) {
      const parts: string[] = [];
      if (summary.window)
        parts.push(
          t('quotaRemaining', {
            period: periodText(summary),
            remaining: new Intl.NumberFormat(getLanguage(), { maximumFractionDigits: 2 }).format(
              summary.window.remainingPercent,
            ),
          }),
        );
      for (const credit of summary.credits) {
        if (credit.unlimited === true) parts.push(t('quotaCreditsUnlimited'));
        else if (credit.remaining !== undefined)
          parts.push(
            t(credit.unit === 'USD' ? 'quotaCreditsUsd' : 'quotaCreditsCount', {
              remaining: new Intl.NumberFormat('en-US', {
                minimumFractionDigits: credit.unit === 'USD' ? 2 : 0,
                maximumFractionDigits: 2,
              }).format(credit.remaining),
            }),
          );
      }
      if (parts.length)
        return { text: parts.join(' · '), description: parts.join(' · '), status: 'ready' };
    }
  }
  return {
    text: t('quotaUnavailable'),
    description:
      state.status === 'unavailable' && state.reason === 'authentication'
        ? t('quotaAuthentication')
        : t('quotaUnavailable'),
    status: 'unavailable',
  };
}

export function renderProviderQuota(
  element: HTMLElement,
  profile: ProviderProfileConfig,
  state: ProviderQuotaState | undefined,
): void {
  const display = getProviderQuotaDisplay(profile, state);
  if (element.textContent !== display.text) element.setText(display.text);
  element.dataset.quotaStatus = display.status;
  element.setAttribute('title', display.description);
  element.setAttribute('aria-label', display.description);
}
