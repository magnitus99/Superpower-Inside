import { Notice } from 'obsidian';
import { t } from '../i18n';
import type { RefreshBus, RefreshDomain } from './refresh-bus';

export type ActionFeedbackStatus = 'success' | 'partial' | 'noop' | 'error';

export interface ActionFeedbackResult {
  status: ActionFeedbackStatus;
  detail?: string;
  notice?: string | false;
  refreshDomains?: readonly RefreshDomain[];
}

interface ButtonElementLike {
  disabled?: boolean;
  textContent?: string | null;
  addClass?(cls: string): void;
  removeClass?(cls: string): void;
  setText?(text: string): void;
}

interface ButtonComponentLike {
  buttonEl?: ButtonElementLike;
  setDisabled(disabled: boolean): unknown;
  setButtonText?(text: string): unknown;
}

export type ActionFeedbackButton = ButtonElementLike | ButtonComponentLike;

export interface RunActionWithFeedbackOptions {
  action: () => ActionFeedbackResult | Promise<ActionFeedbackResult>;
  button?: ActionFeedbackButton;
  loadingText?: string;
  spinnerClass?: string;
  restoreText?: boolean;
  refreshBus?: Pick<RefreshBus, 'emit'>;
  refreshDomains?: readonly RefreshDomain[];
}

function isButtonComponent(button: ActionFeedbackButton): button is ButtonComponentLike {
  return typeof (button as ButtonComponentLike).setDisabled === 'function';
}

function getButtonElement(button: ActionFeedbackButton): ButtonElementLike {
  return isButtonComponent(button) ? (button.buttonEl ?? {}) : button;
}

function getButtonText(button: ActionFeedbackButton): string {
  return getButtonElement(button).textContent ?? '';
}

function getButtonDisabled(button: ActionFeedbackButton): boolean {
  return getButtonElement(button).disabled ?? false;
}

function setButtonDisabled(button: ActionFeedbackButton, disabled: boolean): void {
  if (isButtonComponent(button)) {
    button.setDisabled(disabled);
    return;
  }
  button.disabled = disabled;
}

function setButtonText(button: ActionFeedbackButton, text: string): void {
  if (isButtonComponent(button) && button.setButtonText) {
    button.setButtonText(text);
    return;
  }
  const element = getButtonElement(button);
  if (element.setText) {
    element.setText(text);
  } else {
    element.textContent = text;
  }
}

function toggleButtonClass(button: ActionFeedbackButton, cls: string, enabled: boolean): void {
  const element = getButtonElement(button);
  if (enabled) {
    element.addClass?.(cls);
  } else {
    element.removeClass?.(cls);
  }
}

function getNoticeMessage(result: ActionFeedbackResult): string | null {
  if (result.notice === false) return null;
  if (typeof result.notice === 'string') return result.notice;
  switch (result.status) {
    case 'success':
      return result.detail ?? t('actionCompletedNotice');
    case 'partial':
      return result.detail ?? t('actionPartialNotice');
    case 'noop':
      return result.detail ?? t('actionNoopNotice');
    case 'error':
      return t('actionFailedWithMessage', {
        message: result.detail ?? t('autoSaveUnknownError'),
      });
  }
}

function emitRefreshDomains(
  options: RunActionWithFeedbackOptions,
  result: ActionFeedbackResult,
): void {
  if (!options.refreshBus || result.status === 'error') return;
  const domains = result.refreshDomains ?? options.refreshDomains;
  if (!domains || domains.length === 0) return;
  const refreshStatus = result.status === 'noop' ? 'success' : result.status;
  for (const domain of domains) {
    options.refreshBus.emit(domain, {
      status: refreshStatus,
      detail: result.detail,
    });
  }
}

export async function runActionWithFeedback(
  options: RunActionWithFeedbackOptions,
): Promise<ActionFeedbackResult> {
  const button = options.button;
  const originalText = button ? getButtonText(button) : '';
  const originalDisabled = button ? getButtonDisabled(button) : false;
  const spinnerClass = options.spinnerClass ?? 'spinning';
  const restoreText = options.restoreText ?? true;

  if (button) {
    setButtonDisabled(button, true);
    if (spinnerClass) toggleButtonClass(button, spinnerClass, true);
    if (options.loadingText) setButtonText(button, options.loadingText);
  }

  try {
    const result = await options.action();
    const notice = getNoticeMessage(result);
    if (notice) new Notice(notice, result.status === 'error' ? 5000 : 3000);
    emitRefreshDomains(options, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: ActionFeedbackResult = { status: 'error', detail: message };
    const notice = getNoticeMessage(result);
    if (notice) new Notice(notice, 5000);
    return result;
  } finally {
    if (button) {
      setButtonDisabled(button, originalDisabled);
      if (spinnerClass) toggleButtonClass(button, spinnerClass, false);
      if (restoreText) setButtonText(button, originalText);
    }
  }
}
