import { App, Modal } from 'obsidian';
import { t } from '../i18n';

interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  ctaClass?: string;
}

interface PromptOptions extends ConfirmOptions {
  initialValue?: string;
  placeholder?: string;
}

class ConfirmPromptModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly options: ConfirmOptions,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('superpower-inside-confirm-modal');
    contentEl.createDiv({
      cls: 'superpower-inside-confirm-modal-message',
      text: this.message,
    });
    const buttons = contentEl.createDiv({ cls: 'superpower-inside-confirm-modal-buttons' });
    const cancelBtn = buttons.createEl('button', {
      text: this.options.cancelText ?? t('cancel'),
      attr: { type: 'button' },
    });
    cancelBtn.addEventListener('click', () => this.finish(false));
    const confirmBtn = buttons.createEl('button', {
      text: this.options.confirmText ?? t('confirmLabel'),
      cls: this.options.ctaClass ?? 'mod-cta',
      attr: { type: 'button' },
    });
    confirmBtn.addEventListener('click', () => this.finish(true));
    confirmBtn.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}

class TextPromptModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly options: PromptOptions,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('superpower-inside-text-prompt-modal');
    contentEl.createDiv({
      cls: 'superpower-inside-text-prompt-modal-message',
      text: this.message,
    });
    const input = contentEl.createEl('input', {
      type: 'text',
      cls: 'superpower-inside-text-prompt-modal-input',
      placeholder: this.options.placeholder,
    });
    input.value = this.options.initialValue ?? '';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.finish(input.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.finish(null);
      }
    });
    const buttons = contentEl.createDiv({ cls: 'superpower-inside-text-prompt-modal-buttons' });
    const cancelBtn = buttons.createEl('button', {
      text: this.options.cancelText ?? t('cancel'),
      attr: { type: 'button' },
    });
    cancelBtn.addEventListener('click', () => this.finish(null));
    const confirmBtn = buttons.createEl('button', {
      text: this.options.confirmText ?? t('chatSearchButton'),
      cls: this.options.ctaClass ?? 'mod-cta',
      attr: { type: 'button' },
    });
    confirmBtn.addEventListener('click', () => this.finish(input.value));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }

  private finish(value: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}

export function confirmWithModal(
  app: App,
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmPromptModal(app, message, options, resolve).open();
  });
}

export function promptWithModal(
  app: App,
  message: string,
  options: PromptOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    new TextPromptModal(app, message, options, resolve).open();
  });
}
