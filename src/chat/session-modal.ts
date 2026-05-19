import type { App, Vault } from 'obsidian';
import { t } from '../i18n';
import { RefreshAction } from '../utils/refresh-action';
import { deleteChat, listChatMetasAsync, renameChat } from './persistence';
import type { ChatSessionMeta } from './types';

const SESSION_MODAL_STYLE_ID = 'superpower-inside-session-modal-styles';

/** 날짜를 기준으로 세션을 그룹핑하기 위한 키 */
type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekStart = new Date(today.getTime() - today.getDay() * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekStart) return 'thisWeek';
  if (date >= monthStart) return 'thisMonth';
  return 'older';
}

function getGroupLabel(group: DateGroup): string {
  switch (group) {
    case 'today':
      return t('chatGroupToday');
    case 'yesterday':
      return t('chatGroupYesterday');
    case 'thisWeek':
      return t('chatGroupThisWeek');
    case 'thisMonth':
      return t('chatGroupThisMonth');
    case 'older':
      return t('chatGroupOlder');
  }
}

export function openSessionHistoryModal(
  containerEl: HTMLElement,
  app: App,
  vault: Vault,
  saveFolder: string,
  onLoadSession: (filePath: string) => void,
  currentSessionPath?: string | null,
): void {
  const activeVault = app.vault;
  void vault;
  ensureSessionModalStyles(containerEl.ownerDocument);

  const overlay = containerEl.createDiv({ cls: 'superpower-inside-session-overlay' });
  const modal = overlay.createDiv({ cls: 'superpower-inside-session-modal' });

  // 제목 표시줄
  const titleBar = modal.createDiv({ cls: 'superpower-inside-session-modal-title' });
  titleBar.createEl('h2', { text: t('chatHistory') });

  const titleActions = titleBar.createDiv({ cls: 'superpower-inside-session-title-actions' });
  const refreshBtn = titleActions.createEl('button', {
    cls: 'superpower-inside-session-refresh-btn',
    text: t('refresh'),
    attr: { type: 'button' },
  });
  // RefreshAction으로 세션 목록 새로고침 관리
  const sessionRefreshAction = new RefreshAction({
    action: async (_signal) => {
      void _signal;
      allMetas = await listChatMetasAsync(activeVault, saveFolder);
      if (!isClosed) filterAndRender();
      return { status: 'success' };
    },
    loadingText: t('refreshing'),
    spinnerClass: 'spinning',
    errorNotice: '세션 목록을 불러오지 못했습니다.',
    successNotice: false,
  });
  sessionRefreshAction.attach(refreshBtn);
  const closeBtn = titleActions.createEl('button', {
    cls: 'superpower-inside-session-close-btn',
    text: '×',
    attr: { type: 'button', 'aria-label': t('cancel') },
  });

  // 검색 입력
  const searchContainer = modal.createDiv({ cls: 'superpower-inside-session-search-container' });
  const searchInput = searchContainer.createEl('input', {
    cls: 'superpower-inside-session-search-input',
    attr: {
      type: 'text',
      placeholder: t('chatSearchPlaceholder'),
      'aria-label': t('chatSearchPlaceholder'),
    },
  });
  const searchClear = searchContainer.createEl('button', {
    cls: 'superpower-inside-session-search-clear',
    text: '×',
    attr: { type: 'button', 'aria-label': t('cancel') },
  });
  searchClear.style.display = 'none';

  // 목록
  const listEl = modal.createDiv({ cls: 'superpower-inside-session-modal-list' });
  const footerEl = modal.createDiv({ cls: 'superpower-inside-session-footer' });
  const countEl = footerEl.createSpan({ cls: 'superpower-inside-session-count' });

  let deleteConfirmPath: string | null = null;
  let allMetas: ChatSessionMeta[] = [];
  let searchQuery = '';
  let isClosed = false;

  const close = (): void => {
    isClosed = true;
    sessionRefreshAction.detach();
    overlay.remove();
  };

  const renderLoading = (): void => {
    listEl.empty();
    listEl.createDiv({ cls: 'superpower-inside-session-empty', text: t('mcpRefreshing') });
    countEl.setText('');
  };

  const renderEmpty = (isSearch: boolean): void => {
    listEl.empty();
    listEl.createDiv({
      cls: 'superpower-inside-session-empty',
      text: isSearch ? t('chatNoSearchResults') : t('chatNoSavedSessions'),
    });
    countEl.setText('');
  };

  const renderError = (): void => {
    listEl.empty();
    listEl.createDiv({ cls: 'superpower-inside-session-empty', text: t('error') });
    countEl.setText('');
  };

  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return t('timestampJustNow');
    if (diffMin < 60) return t('timestampMinutesAgo', { count: diffMin });
    if (diffHour < 24) return t('timestampHoursAgo', { count: diffHour });
    if (diffDay < 7) return t('timestampDaysAgo', { count: diffDay });
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const renderMetas = (metas: ChatSessionMeta[]): void => {
    listEl.empty();
    deleteConfirmPath = null;

    if (metas.length === 0) {
      renderEmpty(searchQuery.length > 0);
      return;
    }

    countEl.setText(t('chatSessionCount', { count: metas.length }));

    // 날짜별 그룹핑
    const groups = new Map<DateGroup, ChatSessionMeta[]>();
    const groupOrder: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];

    for (const meta of metas) {
      const effectiveDate = meta.updated ?? meta.created;
      const group = getDateGroup(effectiveDate);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(meta);
    }

    for (const groupKey of groupOrder) {
      const groupMetas = groups.get(groupKey);
      if (!groupMetas || groupMetas.length === 0) continue;

      const groupHeader = listEl.createDiv({ cls: 'superpower-inside-session-group-header' });
      groupHeader.createSpan({
        cls: 'superpower-inside-session-group-label',
        text: getGroupLabel(groupKey),
      });
      groupHeader.createSpan({
        cls: 'superpower-inside-session-group-count',
        text: String(groupMetas.length),
      });

      for (const meta of groupMetas) {
        const isCurrentSession = meta.filePath === currentSessionPath;
        const itemEl = listEl.createDiv({
          cls: `superpower-inside-session-item${isCurrentSession ? ' is-active' : ''}`,
        });

        const infoEl = itemEl.createDiv({ cls: 'superpower-inside-session-item-info' });
        const titleRow = infoEl.createDiv({ cls: 'superpower-inside-session-item-title-row' });
        titleRow.createSpan({ cls: 'superpower-inside-session-item-title', text: meta.title });

        if (isCurrentSession) {
          titleRow.createSpan({
            cls: 'superpower-inside-session-current-badge',
            text: t('chatCurrentSession'),
          });
        }

        if (meta.provider || meta.model) {
          const metaLine = infoEl.createDiv({ cls: 'superpower-inside-session-item-meta' });
          const parts: string[] = [];
          if (meta.provider) parts.push(meta.provider);
          if (meta.model) parts.push(meta.model);
          metaLine.createSpan({ text: parts.join(' · ') });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({ text: `${meta.messageCount}${t('chatMessageUnit')}` });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({ text: formatRelativeTime(meta.updated ?? meta.created) });
        } else {
          const metaLine = infoEl.createDiv({ cls: 'superpower-inside-session-item-meta' });
          metaLine.createSpan({ text: `${meta.messageCount}${t('chatMessageUnit')}` });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({ text: formatRelativeTime(meta.updated ?? meta.created) });
        }

        if (meta.preview) {
          infoEl.createDiv({ cls: 'superpower-inside-session-item-preview', text: meta.preview });
        }

        const actionsEl = itemEl.createDiv({ cls: 'superpower-inside-session-item-actions' });
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
    }
  };

  const startRename = (meta: ChatSessionMeta, itemEl: HTMLElement): void => {
    const infoEl = itemEl.querySelector<HTMLElement>('.superpower-inside-session-item-info');
    if (!infoEl) return;

    infoEl.empty();
    const inputEl = infoEl.createEl('input', {
      cls: 'superpower-inside-session-title-input',
      value: meta.title,
      attr: { 'aria-label': t('chatSessionTitle') },
    });
    const editActions = infoEl.createDiv({ cls: 'superpower-inside-session-inline-actions' });
    const saveBtn = editActions.createEl('button', { text: t('save'), attr: { type: 'button' } });
    const cancelBtn = editActions.createEl('button', {
      text: t('cancel'),
      attr: { type: 'button' },
    });

    const save = async (): Promise<void> => {
      const nextTitle = inputEl.value.trim();
      if (!nextTitle || nextTitle === meta.title) {
        const freshMetas = await listChatMetasAsync(activeVault, saveFolder);
        if (!isClosed) renderMetas(freshMetas);
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

  const filterAndRender = (): void => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      renderMetas(allMetas);
      return;
    }
    const filtered = allMetas.filter(
      (m) =>
        m.title.toLowerCase().includes(query) ||
        (m.preview && m.preview.toLowerCase().includes(query)) ||
        (m.provider && m.provider.toLowerCase().includes(query)) ||
        (m.model && m.model.toLowerCase().includes(query)),
    );
    renderMetas(filtered);
  };

  const loadMetas = async (): Promise<void> => {
    deleteConfirmPath = null;
    renderLoading();
    try {
      allMetas = await listChatMetasAsync(activeVault, saveFolder);
      if (isClosed) return;
      filterAndRender();
    } catch {
      if (!isClosed) renderError();
    }
  };

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClear.style.display = searchQuery ? 'flex' : 'none';
    filterAndRender();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    filterAndRender();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });

  closeBtn.addEventListener('click', close);
  // RefreshAction이 attach에서 click 이벤트 처리
  // 초기 로드는 직접 실행
  void loadMetas();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  // Escape 키 전역 핸들러
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
    }
  };
  containerEl.ownerDocument.addEventListener('keydown', handleKeyDown);

  // 정리 시 이벤트 리스너 제거
  const cleanup = (): void => {
    containerEl.ownerDocument.removeEventListener('keydown', handleKeyDown);
  };
  overlay.addEventListener('remove', cleanup);

  void loadMetas();
}

function ensureSessionModalStyles(documentRef: Document): void {
  if (documentRef.getElementById(SESSION_MODAL_STYLE_ID)) return;

  const styleEl = documentRef.createElement('style');
  styleEl.id = SESSION_MODAL_STYLE_ID;
  styleEl.textContent = `
.superpower-inside-session-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--layer-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--size-4-6);
  background: rgba(var(--mono-rgb-0), 0.62);
}

.superpower-inside-session-modal {
  width: min(620px, 100%);
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  background: var(--background-primary);
  color: var(--text-normal);
  box-shadow: var(--shadow-l);
  overflow: hidden;
}

.superpower-inside-session-modal-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-3);
  padding: var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);
}

.superpower-inside-session-modal-title h2 {
  margin: 0;
  font-size: var(--font-ui-large);
}

.superpower-inside-session-title-actions,
.superpower-inside-session-item-actions,
.superpower-inside-session-inline-actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
}

/* 검색 바 */
.superpower-inside-session-search-container {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}

.superpower-inside-session-search-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}

.superpower-inside-session-search-input:focus {
  border-color: var(--interactive-accent);
}

.superpower-inside-session-search-input::placeholder {
  color: var(--text-faint);
}

.superpower-inside-session-search-clear {
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
}

.superpower-inside-session-search-clear:hover {
  background: var(--background-modifier-error);
  color: var(--text-on-accent);
}

/* 목록 */
.superpower-inside-session-modal-list {
  overflow-y: auto;
  padding: 0;
  flex: 1;
}

/* 날짜 그룹 헤더 */
.superpower-inside-session-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 4px;
  font-size: var(--font-ui-smaller);
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
  background: var(--background-primary);
  z-index: 1;
  border-bottom: 1px solid var(--background-modifier-border);
}

.superpower-inside-session-group-label {
  font-weight: 700;
}

.superpower-inside-session-group-count {
  font-weight: 400;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

/* 세션 항목 */
.superpower-inside-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-3);
  padding: 10px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
  transition: background 0.15s ease;
}

.superpower-inside-session-item:hover {
  background: var(--background-modifier-hover);
}

.superpower-inside-session-item.is-active {
  background: var(--background-modifier-success);
  border-left: 3px solid var(--interactive-accent);
}

.superpower-inside-session-item-info {
  min-width: 0;
  flex: 1;
}

.superpower-inside-session-item-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.superpower-inside-session-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}

.superpower-inside-session-current-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.superpower-inside-session-item-meta {
  display: flex;
  align-items: center;
  gap: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  margin-top: 2px;
  flex-wrap: wrap;
}

.superpower-inside-session-item-preview {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.superpower-inside-session-empty {
  padding: var(--size-4-8);
  color: var(--text-muted);
  text-align: center;
}

.superpower-inside-session-refresh-btn,
.superpower-inside-session-close-btn,
.superpower-inside-session-item-actions button {
  color: var(--text-normal);
}

.superpower-inside-session-item-actions button.is-confirming {
  background: var(--background-modifier-error);
  color: var(--text-on-accent);
}

.superpower-inside-session-title-input {
  width: 100%;
  margin-bottom: var(--size-2-2);
}

/* 하단 카운트 */
.superpower-inside-session-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 6px 16px;
  border-top: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}

.superpower-inside-session-count {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}
`;
  documentRef.head.appendChild(styleEl);
}
