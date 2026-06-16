import { t } from '../i18n';
import type { ProviderCapabilitySnapshot } from '../llm/provider-capabilities';

export interface ProviderWaitInput {
  providerLabel: string;
  model: string;
  elapsedMs: number;
  capability: ProviderCapabilitySnapshot;
}

export interface ProviderWaitStatus {
  headline: string;
  detail: string;
  elapsedLabel: string;
  mode: 'streaming' | 'buffered';
  abortAccuracy: ProviderCapabilitySnapshot['abort'];
}

export function createProviderWaitStatus(input: ProviderWaitInput): ProviderWaitStatus {
  return {
    headline: t('providerWaitBufferedHeadline', {
      provider: input.providerLabel,
      model: input.model,
    }),
    detail: input.capability.streaming ? '' : t('providerWaitBufferedDetail'),
    elapsedLabel: formatElapsed(input.elapsedMs),
    mode: input.capability.streaming ? 'streaming' : 'buffered',
    abortAccuracy: input.capability.abort,
  };
}

function formatElapsed(elapsedMs: number): string {
  return t('providerWaitElapsedSeconds', {
    seconds: Math.max(0, elapsedMs / 1000).toFixed(1),
  });
}
