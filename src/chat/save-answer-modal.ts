import { Modal, Notice, type App } from 'obsidian';
import { t } from '../i18n';
import { saveAnswerNote } from './persistence';
import type { ChatMessageWithMeta } from './types';

/** 저장 위치는 이번 작업에만 적용하고 실패 시 입력과 답변을 보존합니다. */
export class SaveAnswerModal extends Modal {
  constructor(
    app: App,
    private readonly message: ChatMessageWithMeta,
    private readonly folder: string,
    private readonly title: string,
    private readonly returnFocus: HTMLButtonElement,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t('messageNewNoteAction'));
    const root = this.contentEl;
    root.addClass('superpower-inside-save-answer');
    root.createDiv({ text: t('answerNoteSaveDetail') });
    const form = root.createEl('form');
    const nameLabel = form.createEl('label', { text: t('answerNoteName') });
    const name = nameLabel.createEl('input', { type: 'text', attr: { required: '' } });
    name.value = this.title;
    const folderLabel = form.createEl('label', { text: t('answerNoteFolder') });
    const folder = folderLabel.createEl('select');
    folder.createEl('option', { text: t('answerNoteVaultRoot'), value: '' });
    for (const item of this.app.vault.getAllFolders()) {
      if (item.isRoot()) continue;
      folder.createEl('option', { text: item.path, value: item.path });
    }
    if (this.folder && !this.app.vault.getAbstractFileByPath(this.folder)) {
      folder.createEl('option', { text: this.folder, value: this.folder });
    }
    folder.value = this.folder;
    const status = form.createDiv({ attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = form.createDiv({ cls: 'superpower-inside-save-answer-actions' });
    const cancel = actions.createEl('button', { text: t('cancel'), attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', {
      text: t('answerNoteSaveAction'),
      cls: 'mod-cta',
      attr: { type: 'submit' },
    });
    let saving = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      saving = true;
      name.disabled = folder.disabled = save.disabled = cancel.disabled = true;
      save.setText(t('answerNoteSaving'));
      void saveAnswerNote(this.app.vault, this.message, folder.value, name.value)
        .then((file) => {
          if (!root.isConnected) {
            new Notice(t('savedAsNewNoteNotice', { path: file.path }));
            return;
          }
          cancel.disabled = false;
          status.setText(t('savedAsNewNoteNotice', { path: file.path }));
          save.setText(t('answerNoteSaved'));
          const open = actions.createEl('button', {
            text: t('answerNoteOpen'),
            attr: { type: 'button' },
          });
          open.addEventListener('click', () => {
            void this.app.workspace
              .getLeaf(false)
              .openFile(file)
              .then(() => this.close())
              .catch((error: unknown) => {
                status.setText(
                  t('sourceOpenFailedNotice', {
                    message: error instanceof Error ? error.message : String(error),
                  }),
                );
              });
          });
          cancel.setText(t('closeLabel'));
          open.focus();
        })
        .catch((error: unknown) => {
          if (!root.isConnected) {
            new Notice(
              t('savedAsNewNoteFailedNotice', {
                message: error instanceof Error ? error.message : String(error),
              }),
            );
            return;
          }
          saving = false;
          name.disabled = folder.disabled = save.disabled = cancel.disabled = false;
          save.setText(t('answerNoteSaveAction'));
          status.setText(
            t('savedAsNewNoteFailedNotice', {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          save.focus();
        });
    });
    name.focus();
    name.select();
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.returnFocus.isConnected) this.returnFocus.focus({ preventScroll: true });
  }
}
