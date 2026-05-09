import type { App, Vault } from 'obsidian';
import { t } from '../i18n';
import { deleteChat, listChatMetasAsync, renameChat } from './persistence';
import type { ChatSessionMeta } from './types';

const SESSION_MODAL_STYLE_ID = 'super-obsidian-session-modal-styles';

export function openSessionHistoryModal(
  containerEl: HTMLElement,
  app: App,
  vault: Vault,
  saveFolder: string,
  onLoadSession: (filePath: string) => void,
): void {
  const activeVault = app.vault;
  void vault;
  ensureSessionModalStyles(containerEl.ownerDocument);

  const overlay = containerEl.createDiv({ cls: 'super-obsidian-session-overlay' });
  const modal = overlay.createDiv({ cls: 'super-obsidian-session-modal' });
  const titleBar = modal.createDiv({ cls: 'super-obsidian-session-modal-title' });
  titleBar.createEl('h2', { text: t('chatHistory') });

  const titleActions = titleBar.createDiv({ cls: 'super-obsidian-session-title-actions' });
  const refreshBtn = titleActions.createEl('button', {
    cls: 'super-obsidian-session-refresh-btn',
    text: t('refresh'),
    attr: { type: 'button' },
  });
  const closeBtn = titleActions.createEl('button', {
    cls: 'super-obsidian-session-close-btn',
    text: '×',
    attr: { type: 'button', 'aria-label': t('cancel') },
  });

  const listEl = modal.createDiv({ cls: 'super-obsidian-session-modal-list' });
  let deleteConfirmPath: string | null = null;
  let isClosed = false;

  const close = (): void => {
    isClosed = true;
    overlay.remove();
  };

  const renderLoading = (): void => {
    listEl.empty();
    listEl.createDiv({ cls: 'super-obsidian-session-empty', text: t('mcpRefreshing') });
  };

  const renderEmpty = (): void => {
    listEl.empty();
    listEl.createDiv({ cls: 'super-obsidian-session-empty', text: t('chatNoSavedSessions') });
  };

  const renderError = (): void => {
    listEl.empty();
    listEl.createDiv({ cls: 'super-obsidian-session-empty', text: t('error') });
  };

  const loadMetas = async (): Promise<void> => {
    deleteConfirmPath = null;
    renderLoading();
    refreshBtn.disabled = true;

    try {
      const metas = await listChatMetasAsync(activeVault, saveFolder);
      if (isClosed) return;
      renderMetas(metas);
    } catch {
      if (!isClosed) renderError();
    } finally {
      if (!isClosed) refreshBtn.disabled = false;
    }
  };

  const startRename = (meta: ChatSessionMeta, itemEl: HTMLElement): void => {
    const infoEl = itemEl.querySelector<HTMLElement>('.super-obsidian-session-item-info');
    if (!infoEl) return;

    infoEl.empty();
    const inputEl = infoEl.createEl('input', {
      cls: 'super-obsidian-session-title-input',
      value: meta.title,
      attr: { 'aria-label': t('chatSessionTitle') },
    });
    const editActions = infoEl.createDiv({ cls: 'super-obsidian-session-inline-actions' });
    const saveBtn = editActions.createEl('button', { text: t('save'), attr: { type: 'button' } });
    const cancelBtn = editActions.createEl('button', { text: t('cancel'), attr: { type: 'button' } });

    const save = async (): Promise<void> => {
      const nextTitle = inputEl.value.trim();
      if (!nextTitle || nextTitle === meta.title) {
        renderMetas(await listChatMetasAsync(activeVault, saveFolder));
        return;
      }
      saveBtn.disabled = true;
      await renameChat(activeVault, meta.filePath, nextTitle);
      await loadMetas();
    };

    saveBtn.addEventListener('click', () => void save());
    cancelBtn.addEventListener('click', () => void loadMetas());
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void save();
      if (event.key === 'Escape') void loadMetas();
    });
    inputEl.focus();
    inputEl.select();
  };

  const renderMetas = (metas: ChatSessionMeta[]): void => {
    listEl.empty();
    if (metas.length === 0) {
      renderEmpty();
      return;
    }

    for (const meta of metas) {
      const itemEl = listEl.createDiv({ cls: 'super-obsidian-session-item' });
      const infoEl = itemEl.createDiv({ cls: 'super-obsidian-session-item-info' });
      infoEl.createDiv({ cls: 'super-obsidian-session-item-title', text: meta.title });
      infoEl.createDiv({ cls: 'super-obsidian-session-item-date', text: formatSessionDate(meta.created) });
      infoEl.createDiv({
        cls: 'super-obsidian-session-item-count',
        text: meta.messageCount.toLocaleString(),
      });

      const actionsEl = itemEl.createDiv({ cls: 'super-obsidian-session-item-actions' });
      const renameBtn = actionsEl.createEl('button', {
        text: '📝',
        attr: { type: 'button', 'aria-label': t('chatRenameSession') },
      });
      const deleteBtn = actionsEl.createEl('button', {
        text: '🗑️',
        attr: { type: 'button', 'aria-label': t('chatDeleteSession') },
      });

      itemEl.addEventListener('click', () => {
        onLoadSession(meta.filePath);
        close();
      });
      renameBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteConfirmPath = null;
        startRename(meta, itemEl);
      });
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (deleteConfirmPath !== meta.filePath) {
          deleteConfirmPath = meta.filePath;
          deleteBtn.addClass('is-confirming');
          deleteBtn.setText(t('chatDeleteConfirm'));
          return;
        }

        deleteBtn.disabled = true;
        void deleteChat(activeVault, meta.filePath).then(loadMetas, () => {
          deleteBtn.disabled = false;
          deleteConfirmPath = null;
        });
      });
    }
  };

  closeBtn.addEventListener('click', close);
  refreshBtn.addEventListener('click', () => void loadMetas());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  void loadMetas();
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function ensureSessionModalStyles(documentRef: Document): void {
  if (documentRef.getElementById(SESSION_MODAL_STYLE_ID)) return;

  const styleEl = documentRef.createElement('style');
  styleEl.id = SESSION_MODAL_STYLE_ID;
  styleEl.textContent = `
.super-obsidian-session-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--layer-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--size-4-6);
  background: rgba(var(--mono-rgb-0), 0.62);
}

.super-obsidian-session-modal {
  width: min(560px, 100%);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  background: var(--background-primary);
  color: var(--text-normal);
  box-shadow: var(--shadow-l);
  overflow: hidden;
}

.super-obsidian-session-modal-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-3);
  padding: var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);
}

.super-obsidian-session-modal-title h2 {
  margin: 0;
  font-size: var(--font-ui-large);
}

.super-obsidian-session-title-actions,
.super-obsidian-session-item-actions,
.super-obsidian-session-inline-actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
}

.super-obsidian-session-modal-list {
  overflow-y: auto;
  padding: var(--size-2-3);
}

.super-obsidian-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-3);
  padding: var(--size-4-3);
  border-radius: var(--radius-m);
  cursor: pointer;
}

.super-obsidian-session-item:hover {
  background: var(--background-modifier-hover);
}

.super-obsidian-session-item-info {
  min-width: 0;
  flex: 1;
}

.super-obsidian-session-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-semibold);
}

.super-obsidian-session-item-date,
.super-obsidian-session-item-count {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.super-obsidian-session-empty {
  padding: var(--size-4-8);
  color: var(--text-muted);
  text-align: center;
}

.super-obsidian-session-refresh-btn,
.super-obsidian-session-close-btn,
.super-obsidian-session-item-actions button,
.super-obsidian-session-inline-actions button {
  color: var(--text-normal);
}

.super-obsidian-session-item-actions button.is-confirming {
  background: var(--background-modifier-error);
  color: var(--text-on-accent);
}

.super-obsidian-session-title-input {
  width: 100%;
  margin-bottom: var(--size-2-2);
}
`;
  documentRef.head.appendChild(styleEl);
}
