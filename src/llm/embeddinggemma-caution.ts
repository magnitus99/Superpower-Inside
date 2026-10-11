import type { App } from 'obsidian';
import { t } from '../i18n';
import { subscribeEmbeddingGemmaStatus } from './embeddinggemma-status';

export function buildEmbeddingGemmaCaution(container: HTMLElement, app: App): () => void {
  const caution = container.createDiv({
    cls: 'superpower-inside-local-model-caution',
    attr: { role: 'status', 'aria-live': 'polite' },
  });
  return subscribeEmbeddingGemmaStatus(app, (state) => {
    caution.hidden = !state;
    caution.setText(
      state
        ? t('localModelCpuCaution') + (state.fallbackReason ? ` ${t('localModelCpuFallback')}` : '')
        : '',
    );
  });
}
