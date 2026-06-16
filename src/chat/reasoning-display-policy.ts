import { t } from '../i18n';

export type ReasoningDisplayPolicy =
  | 'hidden'
  | 'summary-only'
  | 'provider-raw-expanded'
  | 'provider-raw-collapsed';

export interface ReasoningDisplayInput {
  hasReasoning: boolean;
  providerSupportsReasoning: boolean;
  source: 'provider' | 'think-tag' | 'none';
  isStreaming: boolean;
}

export interface ReasoningDisplayPlan {
  policy: ReasoningDisplayPolicy;
  shouldRender: boolean;
  autoOpen: boolean;
  label: string;
}

export function resolveReasoningDisplay(input: ReasoningDisplayInput): ReasoningDisplayPlan {
  if (!input.hasReasoning || input.source === 'none') {
    return {
      policy: 'hidden',
      shouldRender: false,
      autoOpen: false,
      label: '',
    };
  }

  if (input.providerSupportsReasoning && input.source === 'provider') {
    return {
      policy: input.isStreaming ? 'provider-raw-expanded' : 'provider-raw-collapsed',
      shouldRender: true,
      autoOpen: input.isStreaming,
      label: t('reasoningProvidedLabel'),
    };
  }

  return {
    policy: 'summary-only',
    shouldRender: true,
    autoOpen: false,
    label: t('reasoningProvidedLabel'),
  };
}
