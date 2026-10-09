import { Setting, type ButtonComponent } from 'obsidian';
import { t } from '../i18n';
import { chatGPTOAuth } from './chatgpt-oauth';

/** 설정의 기존 행 구성으로 브라우저 로그인과 연결 상태를 표시한다. */
export function buildChatGPTLoginSettings(
  hostEl: HTMLElement,
  profileId: string,
  onChanged: () => Promise<void>,
): void {
  const containerEl = hostEl.createDiv({ cls: 'superpower-inside-chatgpt-login' });
  const row = new Setting(containerEl).setName(t('providerChatGPTLabel'));
  const status = containerEl.createDiv({
    cls: 'setting-item-description',
    attr: { role: 'status', 'aria-live': 'polite' },
  });
  const link = containerEl.createEl('a', {
    cls: 'superpower-inside-chatgpt-auth-link is-hidden',
    text: t('chatGPTOAuthOpenBrowser'),
    attr: { target: '_blank', rel: 'noopener noreferrer' },
  });
  let cancelLogin: (() => void) | undefined;
  let actionButton: ButtonComponent;
  let cancelButton: ButtonComponent;
  const update = (): void => {
    const connected = chatGPTOAuth.isConnected(profileId);
    row.setDesc(connected ? t('chatGPTOAuthConnected') : t('chatGPTOAuthDisconnected'));
    const actionLabel = connected ? t('chatGPTOAuthDisconnect') : t('chatGPTOAuthSignIn');
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
    if (chatGPTOAuth.isConnected(profileId)) {
      chatGPTOAuth.disconnect(profileId);
      update();
      await onChanged();
      return;
    }
    actionButton.setDisabled(true);
    try {
      const login = await chatGPTOAuth.startLogin(profileId);
      cancelLogin = () => login.cancel();
      link.href = login.url;
      update();
      status.setText(t('chatGPTOAuthPending'));
      // 콜백 수신기 준비 후에만 기본 브라우저를 연다. 실패하면 표시된 링크로 다시 연다.
      containerEl.ownerDocument.defaultView?.open(login.url, '_blank', 'noopener,noreferrer');
      await login.completed;
      status.setText(t('chatGPTOAuthConnected'));
      await onChanged();
    } catch (error) {
      status.setText(error instanceof Error ? error.message : t('chatGPTOAuthFailed'));
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
      button.setButtonText(t('chatGPTOAuthCancel')).onClick(() => cancelLogin?.());
    });
  update();
}
