import { Setting } from 'obsidian';
import { t } from '../i18n';
import { runActionWithFeedback } from '../utils/action-feedback';
import { confirmWithModal } from '../utils/modal-prompts';
import type { App } from 'obsidian';
import type { RetiredArtifactService, RetiredArtifactSnapshot } from './retired-artifacts';

export function buildRetiredArtifactSettings(
  containerEl: HTMLElement,
  app: App,
  service: RetiredArtifactService,
): void {
  const row = new Setting(containerEl).setName(t('retiredArtifactsTitle'));
  const status = row.descEl;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setText(t('retiredArtifactsScanning'));
  let snapshot: RetiredArtifactSnapshot | null = null;
  row.addButton((button) => {
    button.setButtonText(t('retiredArtifactsReview')).setDisabled(true);
    const scan = async (): Promise<void> => {
      snapshot = null;
      button.setDisabled(true);
      try {
        const current = await service.scan();
        if (!containerEl.isConnected) return;
        snapshot = current;
        status.setText(
          current.hasArtifacts
            ? t('retiredArtifactsSize', { size: current.capacity })
            : t('retiredArtifactsEmpty'),
        );
        button.setButtonText(t('retiredArtifactsReview')).setDisabled(!current.hasArtifacts);
      } catch {
        if (!containerEl.isConnected) return;
        status.setText(t('retiredArtifactsScanFailed'));
        button.setButtonText(t('retiredArtifactsRetry')).setDisabled(false);
      }
    };
    button.onClick(async () => {
      if (!snapshot) {
        status.setText(t('retiredArtifactsScanning'));
        await scan();
        return;
      }
      const approved = snapshot;
      const result = await runActionWithFeedback({
        button,
        loadingText: t('retiredArtifactsReview'),
        spinnerClass: '',
        action: async () => {
          const confirmed = await confirmWithModal(
            app,
            t('retiredArtifactsConfirm', { size: approved.capacity }),
            {
              confirmText: t('retiredArtifactsDelete'),
              cancelText: t('retiredArtifactsKeep'),
              ctaClass: 'mod-warning',
            },
          );
          if (!confirmed) return { status: 'noop', notice: false };
          button.setButtonText(t('retiredArtifactsRunning'));
          status.setText(t('retiredArtifactsRunning'));
          let cleaned: Awaited<ReturnType<RetiredArtifactService['cleanup']>>;
          try {
            cleaned = await service.cleanup(approved);
          } catch {
            return { status: 'error', detail: t('retiredArtifactsPartial') };
          }
          if (cleaned.failed > 0)
            return { status: 'partial', detail: t('retiredArtifactsPartial') };
          if (cleaned.changed) return { status: 'partial', detail: t('retiredArtifactsChanged') };
          return { status: 'success', detail: t('retiredArtifactsDone') };
        },
      });
      if (result.status !== 'noop') {
        await scan();
        if (containerEl.isConnected && result.status !== 'success' && snapshot) {
          status.setText(
            `${result.detail ?? t('retiredArtifactsPartial')} ${t('retiredArtifactsSize', { size: snapshot.capacity })}`,
          );
        }
      }
      if (containerEl.isConnected) button.buttonEl.focus();
    });
    void scan();
  });
}
