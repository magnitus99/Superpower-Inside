import type { App, Vault } from 'obsidian';
import { setIcon } from 'obsidian';
import { formatNumber, t } from '../i18n';
import { isDomInstance } from '../utils/dom';
import type { RefreshBus } from '../utils/refresh-bus';
import { runActionWithFeedback } from '../utils/action-feedback';
import { deleteChat, listChatMetasAsync, renameChat } from './persistence';
import type { ChatSessionMeta } from './types';
import { getPromptModalTabTarget } from './prompt-library-modal-state';

const HIDDEN_CLASS = 'superpower-inside-hidden';
let sessionModalSequence = 0;

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
  sessionsEventBus?: Pick<RefreshBus, 'emit' | 'on'>,
): void {
  const activeVault = app.vault;
  void vault;
  const doc = containerEl.ownerDocument;
  const previousFocus = doc.activeElement;
  const modalId = `superpower-inside-session-modal-${++sessionModalSequence}`;
  const overlay = containerEl.createDiv({ cls: 'superpower-inside-session-overlay' });
  const modal = overlay.createDiv({
    cls: 'superpower-inside-session-modal',
    attr: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': `${modalId}-title`,
      tabindex: '-1',
    },
  });

  // 제목 표시줄
  const titleBar = modal.createDiv({ cls: 'superpower-inside-session-modal-title' });
  titleBar.createDiv({
    cls: 'superpower-inside-session-modal-heading',
    text: t('chatHistory'),
    attr: { id: `${modalId}-title`, role: 'heading', 'aria-level': '2' },
  });

  const titleActions = titleBar.createDiv({ cls: 'superpower-inside-session-title-actions' });
  const closeBtn = titleActions.createEl('button', {
    cls: 'superpower-inside-session-close-btn',
    attr: { type: 'button', 'aria-label': t('closeLabel') },
  });
  setIcon(closeBtn, 'x');

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
  searchClear.addClass(HIDDEN_CLASS);

  // 목록
  const listEl = modal.createDiv({ cls: 'superpower-inside-session-modal-list' });
  const footerEl = modal.createDiv({ cls: 'superpower-inside-session-footer' });
  const countEl = footerEl.createSpan({ cls: 'superpower-inside-session-count' });

  let deleteConfirmPath: string | null = null;
  let allMetas: ChatSessionMeta[] = [];
  let searchQuery = '';
  let isClosed = false;
  let unsubscribeSessions = (): void => undefined;
  let focusPath: string | null = null;

  const close = (): void => {
    if (isClosed) return;
    isClosed = true;
    unsubscribeSessions();
    overlay.remove();
    if (previousFocus?.isConnected && isDomInstance(previousFocus, HTMLElement))
      previousFocus.focus();
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
    const retry = listEl.createEl('button', { text: t('retryLabel'), attr: { type: 'button' } });
    retry.addEventListener('click', () => void loadMetas());
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
    const activeRow = doc.activeElement?.closest<HTMLElement>('.superpower-inside-session-item');
    if (activeRow && listEl.contains(activeRow))
      focusPath ??= activeRow.dataset.sessionPath ?? null;
    listEl.empty();
    deleteConfirmPath = null;

    if (metas.length === 0) {
      renderEmpty(searchQuery.length > 0);
      if (focusPath) searchInput.focus();
      focusPath = null;
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
        text: formatNumber(groupMetas.length),
      });

      for (const meta of groupMetas) {
        const isCurrentSession = meta.filePath === currentSessionPath;
        const itemEl = listEl.createDiv({
          cls: `superpower-inside-session-item${isCurrentSession ? ' is-active' : ''}`,
        });
        itemEl.dataset.sessionPath = meta.filePath;

        const infoEl = itemEl.createDiv({ cls: 'superpower-inside-session-item-info' });
        const openBtn = infoEl.createEl('button', {
          cls: 'superpower-inside-session-open',
          attr: { type: 'button', ...(isCurrentSession ? { 'aria-current': 'true' } : {}) },
        });
        const titleRow = openBtn.createDiv({ cls: 'superpower-inside-session-item-title-row' });
        titleRow.createSpan({ cls: 'superpower-inside-session-item-title', text: meta.title });

        if (isCurrentSession) {
          titleRow.createSpan({
            cls: 'superpower-inside-session-current-badge',
            text: t('chatCurrentSession'),
          });
        }

        if (meta.provider || meta.model) {
          const metaLine = openBtn.createDiv({ cls: 'superpower-inside-session-item-meta' });
          const parts: string[] = [];
          if (meta.provider) parts.push(meta.provider);
          if (meta.model) parts.push(meta.model);
          metaLine.createSpan({ text: parts.join(' · ') });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({
            text: `${formatNumber(meta.messageCount)}${t('chatMessageUnit')}`,
          });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({ text: formatRelativeTime(meta.updated ?? meta.created) });
        } else {
          const metaLine = openBtn.createDiv({ cls: 'superpower-inside-session-item-meta' });
          metaLine.createSpan({
            text: `${formatNumber(meta.messageCount)}${t('chatMessageUnit')}`,
          });
          metaLine.createSpan({ text: ' · ' });
          metaLine.createSpan({ text: formatRelativeTime(meta.updated ?? meta.created) });
        }

        if (meta.preview) {
          openBtn.createDiv({ cls: 'superpower-inside-session-item-preview', text: meta.preview });
        }

        const actionsEl = itemEl.createDiv({ cls: 'superpower-inside-session-item-actions' });
        const renameBtn = actionsEl.createEl('button', {
          attr: { type: 'button', 'aria-label': t('chatRenameSession') },
        });
        const deleteBtn = actionsEl.createEl('button', {
          attr: { type: 'button', 'aria-label': t('chatDeleteSession') },
        });
        setIcon(renameBtn, 'pencil');
        setIcon(deleteBtn, 'trash-2');

        openBtn.addEventListener('click', () => {
          close();
          onLoadSession(meta.filePath);
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

          void runActionWithFeedback({
            button: deleteBtn,
            loadingText: t('mcpRefreshing'),
            refreshBus: sessionsEventBus,
            refreshDomains: ['sessions'],
            action: async () => {
              try {
                await deleteChat(app.fileManager, activeVault, meta.filePath);
                focusPath = meta.filePath;
                await loadMetas();
                return { status: 'success', detail: t('chatSessionDeletedNotice') };
              } catch (err) {
                deleteConfirmPath = null;
                const message = err instanceof Error ? err.message : String(err);
                return {
                  status: 'error',
                  detail: message,
                  notice: t('chatSessionDeleteFailedNotice', { message }),
                };
              }
            },
          });
        });
        if (focusPath === meta.filePath) openBtn.focus();
      }
    }
    if (focusPath && !metas.some((meta) => meta.filePath === focusPath)) searchInput.focus();
    focusPath = null;
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
      await runActionWithFeedback({
        button: saveBtn,
        loadingText: t('mcpRefreshing'),
        refreshBus: sessionsEventBus,
        refreshDomains: ['sessions'],
        action: async () => {
          const nextTitle = inputEl.value.trim();
          if (!nextTitle) {
            const freshMetas = await listChatMetasAsync(activeVault, saveFolder);
            if (!isClosed) {
              focusPath = meta.filePath;
              renderMetas(freshMetas);
            }
            return { status: 'noop', detail: t('chatSessionRenameEmptyNotice') };
          }
          if (nextTitle === meta.title) {
            const freshMetas = await listChatMetasAsync(activeVault, saveFolder);
            if (!isClosed) {
              focusPath = meta.filePath;
              renderMetas(freshMetas);
            }
            return { status: 'noop', detail: t('chatSessionRenameNoChangeNotice') };
          }
          try {
            await renameChat(activeVault, meta.filePath, nextTitle);
            focusPath = meta.filePath;
            await loadMetas();
            return { status: 'success', detail: t('chatSessionRenamedNotice') };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              status: 'error',
              detail: message,
              notice: t('chatSessionRenameFailedNotice', { message }),
            };
          }
        },
      });
    };

    saveBtn.addEventListener('click', () => void save());
    cancelBtn.addEventListener('click', () => {
      focusPath = meta.filePath;
      void loadMetas();
    });
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void save();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        focusPath = meta.filePath;
        void loadMetas();
      }
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
    searchClear.toggleClass(HIDDEN_CLASS, !searchQuery);
    filterAndRender();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.addClass(HIDDEN_CLASS);
    searchInput.focus();
    filterAndRender();
  });

  closeBtn.addEventListener('click', close);
  // 초기 로드
  void loadMetas();

  // sessions 이벤트 수신 시 자동 갱신
  if (sessionsEventBus?.on) {
    unsubscribeSessions = sessionsEventBus.on('sessions', () => {
      if (!isClosed) void loadMetas();
    });
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
    ).filter((control) => control.getClientRects().length > 0);
    const next = getPromptModalTabTarget(focusable, doc.activeElement, event.shiftKey);
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
  searchInput.focus();
}
