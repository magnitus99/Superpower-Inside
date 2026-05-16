import { App, Modal } from 'obsidian';

export class EditMessageModal extends Modal {
  private originalContent: string;
  private onSave: (editedText: string) => void;

  constructor(app: App, originalContent: string, onSave: (editedText: string) => void) {
    super(app);
    this.originalContent = originalContent;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('superpower-inside-edit-modal');
    contentEl.createEl('h3', { text: '메시지 수정' });

    const textarea = contentEl.createEl('textarea', {
      attr: {
        rows: '6',
        style: 'width: 100%; box-sizing: border-box; resize: vertical;',
      },
    });
    textarea.value = this.originalContent;
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.submit(textarea);
      }
    });

    const btnRow = contentEl.createDiv({
      cls: 'superpower-inside-edit-modal-buttons',
    });

    const cancelBtn = btnRow.createEl('button', {
      text: '취소',
      cls: 'mod-cta',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', {
      text: '전송',
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => this.submit(textarea));

    textarea.focus();
    textarea.setSelectionRange(this.originalContent.length, this.originalContent.length);
  }

  private submit(textarea: HTMLTextAreaElement): void {
    const trimmed = textarea.value.trim();
    if (!trimmed) return;
    this.onSave(trimmed);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
