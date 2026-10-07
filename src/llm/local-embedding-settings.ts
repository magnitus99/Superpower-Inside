import { Notice, Setting } from 'obsidian';
import { t } from '../i18n';
import { confirmWithModal } from '../utils/modal-prompts';
import {
  getLocalEmbeddingModels,
  type LocalEmbeddingModelId,
  type LocalModelState,
} from './local-embedding-models';
import type { TernlightRuntimeOptions } from './ternlight-runtime';

const MODEL_ROWS = [
  { id: 'ternlight-base', name: 'Ternlight', detail: 'localModelTernlightDetail' },
  { id: 'embeddinggemma-300m', name: 'EmbeddingGemma 300M', detail: 'localModelGemmaDetail' },
] as const;

export function buildLocalEmbeddingModelSettings(
  container: HTMLElement,
  options: TernlightRuntimeOptions,
  actions: { remove(id: LocalEmbeddingModelId): Promise<void> },
): () => void {
  const models = getLocalEmbeddingModels(options);
  const group = container.createDiv({ cls: 'superpower-inside-local-models' });
  new Setting(group).setName(t('localModelsTitle')).setDesc(t('localModelsDetail')).setHeading();
  const disposers: (() => void)[] = [];
  for (const model of MODEL_ROWS) {
    const setting = new Setting(group).setName(model.name).setDesc(t(model.detail));
    setting.settingEl.addClass('superpower-inside-local-model-row');
    setting.settingEl.dataset.modelId = model.id;
    const status = setting.infoEl.createDiv({
      cls: 'superpower-inside-local-model-status',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    const progress = setting.infoEl.createEl('progress', {
      cls: 'superpower-inside-local-model-progress',
      attr: { 'aria-label': model.name },
    });
    const amount = setting.infoEl.createDiv({
      cls: 'superpower-inside-local-model-amount',
      attr: { 'aria-hidden': 'true' },
    });
    const download = setting.controlEl.createEl('button', {
      text: t('localModelDownload'),
      attr: { type: 'button' },
    });
    const cancel = setting.controlEl.createEl('button', {
      text: t('localModelCancel'),
      attr: { type: 'button' },
    });
    const remove = setting.controlEl.createEl('button', {
      text: t('localModelDelete'),
      cls: 'mod-warning',
      attr: { type: 'button' },
    });
    let confirming = false;
    let lastPhase: LocalModelState['phase'] | undefined;
    const render = (state: LocalModelState): void => {
      const focusedControl = group.ownerDocument.activeElement;
      const busy = ['checking', 'downloading', 'verifying', 'cancelling'].includes(state.phase);
      const phaseLabel = {
        missing: 'localModelMissing',
        checking: 'localModelChecking',
        downloading: 'localModelDownloading',
        cancelling: 'localModelCancelling',
        verifying: 'localModelVerifying',
        ready: 'localModelReady',
        error: 'localModelError',
        deleting: 'localModelDeleting',
      } as const;
      if (lastPhase !== state.phase) {
        status.setText(t(phaseLabel[state.phase]));
        lastPhase = state.phase;
      }
      status.toggleClass('superpower-inside-local-model-error', state.phase === 'error');
      progress.hidden = !busy;
      progress.max = state.totalBytes;
      progress.value = state.completedBytes;
      progress.setAttribute(
        'aria-valuetext',
        t('localModelProgress', {
          model: model.name,
          completed: (state.completedBytes / 1_000_000).toFixed(1),
          total: (state.totalBytes / 1_000_000).toFixed(1),
        }),
      );
      progress.title = progress.getAttribute('aria-valuetext') ?? '';
      amount.hidden = !busy;
      amount.setText(progress.title);
      download.hidden = busy || state.phase === 'ready' || state.phase === 'deleting';
      download.setText(t(state.phase === 'error' ? 'localModelRetry' : 'localModelDownload'));
      download.setAttribute('aria-label', `${model.name}: ${download.textContent ?? ''}`);
      download.disabled = confirming;
      cancel.hidden = !busy;
      cancel.disabled = state.phase === 'cancelling';
      cancel.setAttribute('aria-label', `${model.name}: ${t('localModelCancel')}`);
      remove.hidden = !state.hasFiles && state.phase !== 'ready';
      remove.disabled = confirming || busy || state.phase === 'deleting';
      remove.setAttribute('aria-label', `${model.name}: ${t('localModelDelete')}`);
      const controls = [download, cancel, remove];
      if (controls.some((control) => control === focusedControl && control.hidden))
        controls.find((control) => !control.hidden && !control.disabled)?.focus();
    };
    disposers.push(models.subscribe(model.id, render));
    void models.refresh(model.id).catch(() => {
      status.setText(t('localModelError'));
    });
    download.addEventListener('click', () => {
      void models.prepare(model.id).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          new Notice(t('localModelError'));
      });
    });
    cancel.addEventListener('click', () => models.cancel(model.id));
    remove.addEventListener('click', () => {
      if (confirming) return;
      confirming = true;
      render(models.state(model.id));
      void (async () => {
        try {
          if (
            !(await confirmWithModal(
              options.app,
              t('localModelDeleteConfirm', { model: model.name }),
              { confirmText: t('localModelDelete'), ctaClass: 'mod-warning' },
            ))
          )
            return;
          await actions.remove(model.id);
          new Notice(t('localModelDeleteDone', { model: model.name }));
        } catch {
          new Notice(t('localModelError'));
        } finally {
          confirming = false;
          render(models.state(model.id));
          if (group.isConnected && group.ownerDocument.activeElement === group.ownerDocument.body)
            [download, cancel, remove]
              .find((control) => !control.hidden && !control.disabled)
              ?.focus();
        }
      })();
    });
  }
  return () => {
    for (const dispose of disposers) dispose();
  };
}
