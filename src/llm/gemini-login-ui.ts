import { Setting, type ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import { googleGeminiOAuth } from './google-gemini-oauth';

/** Gemini 설정에서 Google 계정 로그인과 연결 상태를 표시한다. */
export function buildGeminiLoginSettings(
  hostEl: HTMLElement,
  profileId: string,
  onChanged: () => Promise<void>,
): void {
  const containerEl = hostEl.createDiv({ cls: 'superpower-inside-gemini-login' });
  const row = new Setting(containerEl).setName(t('geminiAuthModeOAuth'));
  const status = containerEl.createDiv({
    cls: 'setting-item-description',
    attr: { role: 'status', 'aria-live': 'polite' },
  });
  const link = containerEl.createEl('a', {
    cls: 'superpower-inside-gemini-auth-link is-hidden',
    text: t('geminiOAuthOpenBrowser'),
    attr: { target: '_blank', rel: 'noopener noreferrer' },
  });
  let cancelLogin: (() => void) | undefined;
  let actionButton: ButtonComponent;
  let cancelButton: ButtonComponent;
  const update = (): void => {
    const connected = googleGeminiOAuth.isConnected(profileId);
    row.setDesc(connected ? t('geminiOAuthConnected') : t('geminiOAuthDisconnected'));
    const actionLabel = connected ? t('geminiOAuthDisconnect') : t('geminiOAuthSignIn');
    actionButton.setButtonText(actionLabel);
    actionButton.buttonEl.setAttribute('aria-label', actionLabel);
    actionButton.setDisabled(Boolean(cancelLogin));
    row.settingEl.setAttribute('aria-busy', String(Boolean(cancelLogin)));
    cancelButton.buttonEl.classList.toggle('is-hidden', !cancelLogin);
    link.classList.toggle('is-hidden', !cancelLogin);
    if (!cancelLogin) link.removeAttribute('href');
  };
  const run = async (): Promise<void> => {
    status.setText('');
    if (googleGeminiOAuth.isConnected(profileId)) {
      googleGeminiOAuth.disconnect(profileId);
      update();
      await onChanged();
      return;
    }
    actionButton.setDisabled(true);
    try {
      const login = await googleGeminiOAuth.startLogin(profileId);
      cancelLogin = () => login.cancel();
      link.href = login.url;
      update();
      status.setText(t('geminiOAuthPending'));
      containerEl.ownerDocument.defaultView?.open(login.url, '_blank', 'noopener,noreferrer');
      await login.completed;
      status.setText(t('geminiOAuthConnected'));
      await onChanged();
    } catch (error) {
      status.setText(error instanceof Error ? error.message : t('geminiOAuthFailed'));
    } finally {
      cancelLogin = undefined;
      update();
    }
  };
  row
    .addButton((button) => {
      actionButton = button;
      button.onClick(() => {
        void run().catch(() => status.setText(t('settingsApplyFailed')));
      });
    })
    .addButton((button) => {
      cancelButton = button;
      button.setButtonText(t('geminiOAuthCancel')).onClick(() => cancelLogin?.());
    });
  update();
}
