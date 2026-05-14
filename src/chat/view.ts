import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, TFile } from 'obsidian';
import {
  CHAT_PROVIDER_KEYS,
  PROVIDER_LABELS,
  type PluginLike,
  type ProviderKey,
} from '../settings';
import type {
  ChatMessage,
  StreamChunk,
  ToolCallInfo,
  ToolCallDelta,
  ToolDefinition,
} from '../llm/providers';
import type { ChatMessageWithMeta, SessionState, ToolCallRecord } from './types';
import type { ContextAttachment, SourceCitation } from './types';
import { loadChat, saveChat } from './persistence';
import { openSessionHistoryModal } from './session-modal';
import {
  buildChatContext,
  createAppMentionResolver,
  parseMentions as parseContextMentions,
  type ContextBuildResult,
  type ParsedMention,
  type RagQueryLike,
} from './context';
import { t } from '../i18n';

export const CHAT_VIEW_TYPE = 'super-obsidian-chat';

interface MessageMetaInput {
  providerKey?: ChatMessageWithMeta['providerKey'];
  providerLabel?: string;
  model?: string;
  status?: ChatMessageWithMeta['status'];
  errorMessage?: string;
  citations?: SourceCitation[];
  contextAttachments?: ContextAttachment[];
  branchOf?: string;
  stopReason?: ChatMessageWithMeta['stopReason'];
}

export class ChatView extends ItemView {
  private plugin: PluginLike;
  private messages: ChatMessageWithMeta[];
  private sessionSystemPrompt: string | null;
  private isStreaming: boolean;
  private autoScroll: boolean;
  private session: SessionState;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null;

  private container: HTMLElement | null;
  private headerEl: HTMLElement | null;
  private sessionTitleEl: HTMLElement | null;
  private sessionInfoEl: HTMLElement | null;
  private messagesArea: HTMLElement | null;
  private inputArea: HTMLTextAreaElement | null;
  private sendBtn: HTMLButtonElement | null;
  private mcpBtn: HTMLButtonElement | null;
  private typingIndicator: HTMLElement | null;
  private scrollBtn: HTMLElement | null;
  private sysPromptEditor: HTMLElement | null;
  private mcpStatusBar: HTMLElement | null;
  private modelSelectEl: HTMLSelectElement | null;
  private contextPreviewEl: HTMLElement | null;
  private mentionDropdown: HTMLElement | null;
  private mentionQuery: string;
  private mentionSelectedIndex: number;
  private mentionItems: { label: string; value: string; type: 'server' | 'file' | 'folder' }[];
  private mentionStartIndex: number;
  private abortController: AbortController | null;
  private lastUserPrompt: string | null;
  private toolExecutionPolicy = { manualApproval: true };

  private messageEls: Map<string, HTMLElement>;

  /** 툴 호출 결과의 최대 저장 크기 (10KB), 초과 시 요약 저장 */
  private static readonly MAX_TOOL_RESULT_SIZE = 10_000;

  constructor(leaf: WorkspaceLeaf, plugin: PluginLike) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.sessionSystemPrompt = null;
    this.isStreaming = false;
    this.autoScroll = true;
    this.session = { filePath: null, title: '', isDirty: false };
    this.autoSaveTimer = null;
    this.messageEls = new Map();
    this.container = null;
    this.headerEl = null;
    this.sessionTitleEl = null;
    this.sessionInfoEl = null;
    this.messagesArea = null;
    this.inputArea = null;
    this.sendBtn = null;
    this.mcpBtn = null;
    this.typingIndicator = null;
    this.scrollBtn = null;
    this.sysPromptEditor = null;
    this.mcpStatusBar = null;
    this.modelSelectEl = null;
    this.contextPreviewEl = null;
    this.mentionDropdown = null;
    this.mentionQuery = '';
    this.mentionSelectedIndex = -1;
    this.mentionItems = [];
    this.mentionStartIndex = -1;
    this.abortController = null;
    this.lastUserPrompt = null;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('chatTabTitle');
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('super-obsidian-chat-container');
    this.container = root;

    this.buildHeader(root);
    this.buildMcpStatusBar(root);

    this.messagesArea = root.createDiv({ cls: 'super-obsidian-chat-messages' });
    this.messagesArea.addEventListener('scroll', () => this.handleScroll());

    this.scrollBtn = root.createDiv({ cls: 'super-obsidian-scroll-to-bottom' });
    this.scrollBtn.style.display = 'none';
    this.scrollBtn.setText(t('chatScrollToBottom'));
    this.scrollBtn.addEventListener('click', () => this.scrollToBottom());

    this.typingIndicator = this.messagesArea.createDiv({
      cls: 'super-obsidian-typing-indicator',
    });
    this.typingIndicator.style.display = 'none';
    this.typingIndicator.innerHTML = `<span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-text">${t('chatTyping')}</span>`;

    this.buildInputArea(root);
    this.registerSessionFileEvents();
  }

  async onClose(): Promise<void> {
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    this.cancelStreamingMarkdownRender();
    await this.saveCurrentSession();
  }

  private registerSessionFileEvents(): void {
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (this.isCurrentSessionPath(file.path)) {
          this.resetMissingSession(file.path);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (!this.isCurrentSessionPath(oldPath)) return;
        if (file instanceof TFile && file.extension === 'md') {
          this.session.filePath = file.path;
          this.updateHeaderTitle();
          return;
        }
        this.resetMissingSession(oldPath);
      }),
    );
  }

  private buildHeader(container: HTMLElement): void {
    this.headerEl = container.createDiv({ cls: 'super-obsidian-chat-header' });

    const titleSection = this.headerEl.createDiv({
      cls: 'super-obsidian-chat-header-title-section',
    });

    this.sessionTitleEl = titleSection.createSpan({
      cls: 'super-obsidian-chat-session-title',
      text: this.session.title || t('chatTabTitle'),
    });
    this.sessionTitleEl.addEventListener('click', () => this.promptRenameSession());

    this.sessionInfoEl = titleSection.createDiv({ cls: 'super-obsidian-chat-session-info' });
    this.updateSessionInfo();

    const actions = this.headerEl.createDiv({ cls: 'super-obsidian-chat-header-actions' });

    const newChatBtn = actions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: t('chatNewSession'),
    });
    newChatBtn.addEventListener('click', () => void this.startNewSession());

    const historyBtn = actions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: t('chatHistory'),
    });
    historyBtn.addEventListener('click', () => void this.openSessionHistoryModal());

    const sysToggle = actions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: '⚙️',
      attr: { 'aria-label': t('systemPrompt') },
    });
    sysToggle.addEventListener('click', () => this.toggleSystemPromptEditor());

    this.sysPromptEditor = container.createDiv({ cls: 'super-obsidian-system-prompt-editor' });
    this.sysPromptEditor.style.display = 'none';

    this.sysPromptEditor.createDiv({
      cls: 'super-obsidian-system-prompt-editor-label',
      text: '세션 시스템 프롬프트',
    });
    const ta = this.sysPromptEditor.createEl('textarea', {
      cls: 'super-obsidian-chat-input',
      attr: { rows: '4', placeholder: t('systemPromptPlaceholder') },
    });
    const editorActions = this.sysPromptEditor.createDiv({
      cls: 'super-obsidian-system-prompt-editor-actions',
    });
    const applyBtn = editorActions.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: '적용',
    });
    applyBtn.addEventListener('click', () => {
      this.sessionSystemPrompt = ta.value.trim() || null;
      this.updateSystemPromptBadge();
      this.sysPromptEditor!.style.display = 'none';
      new Notice('세션 시스템 프롬프트가 적용되었습니다.');
    });
    const cancelBtn = editorActions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: t('cancel'),
    });
    cancelBtn.addEventListener('click', () => {
      this.sysPromptEditor!.style.display = 'none';
    });
  }

  private toggleSystemPromptEditor(): void {
    if (!this.sysPromptEditor) return;
    const isVisible = this.sysPromptEditor.style.display !== 'none';
    this.sysPromptEditor.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      const ta = this.sysPromptEditor.querySelector('textarea') as HTMLTextAreaElement;
      if (ta) {
        ta.value = this.sessionSystemPrompt ?? this.plugin.settings.chat.systemPrompt ?? '';
      }
    }
  }

  private updateSystemPromptBadge(): void {}

  private buildMcpStatusBar(container: HTMLElement): void {
    this.mcpStatusBar = container.createDiv({ cls: 'super-obsidian-chat-mcp-status-bar' });
    this.renderMcpStatusBar();
  }

  private renderMcpStatusBar(): void {
    if (!this.mcpStatusBar) return;
    this.mcpStatusBar.empty();

    const registry = this.plugin.mcpRegistry;
    if (!registry || registry.getConnectedCount() === 0) {
      const emptyLabel = this.mcpStatusBar.createSpan({
        cls: 'super-obsidian-chat-mcp-status-label',
      });
      emptyLabel.setText(t('mcpNoActiveServers'));
      const refreshBtn = this.mcpStatusBar.createEl('button', {
        cls: 'super-obsidian-chat-mcp-refresh-btn',
        text: t('mcpRefresh'),
      });
      refreshBtn.addEventListener('click', () => void this.refreshMcpServers(refreshBtn));
      return;
    }

    const servers = registry.getEnabledServers();
    const connectedCount = registry.getConnectedCount();
    const totalCount = servers.length;

    const summary = this.mcpStatusBar.createSpan({ cls: 'super-obsidian-chat-mcp-status-label' });
    summary.setText(t('mcpActiveServers', { count: connectedCount, total: totalCount }));

    for (const server of servers) {
      const status = registry.getConnectionStatus(server.name);
      if (status !== 'connected') continue;
      const chip = this.mcpStatusBar.createSpan({
        cls: `super-obsidian-chat-mcp-server-chip ${status}`,
      });
      chip.setText(server.name);
    }

    const refreshBtn = this.mcpStatusBar.createEl('button', {
      cls: 'super-obsidian-chat-mcp-refresh-btn',
      text: t('mcpRefresh'),
    });
    refreshBtn.addEventListener('click', () => void this.refreshMcpServers(refreshBtn));
  }

  private async refreshMcpServers(btn: HTMLButtonElement): Promise<void> {
    if (btn.disabled) return;
    const originalText = btn.textContent || '';
    btn.setText(t('mcpRefreshing'));
    btn.disabled = true;
    try {
      const errors = await this.plugin.reconnectMCP();
      if (errors.length > 0) {
        new Notice(`MCP 재연결 중 ${errors.length}개 서버 실패`, 5000);
      } else {
        new Notice('MCP 서버 재연결 완료');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`MCP 재연결 실패: ${msg}`, 5000);
    } finally {
      this.renderMcpStatusBar();
      btn.setText(originalText);
      btn.disabled = false;
    }
  }

  private buildInputArea(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'super-obsidian-chat-input-wrapper' });

    const toolbar = wrapper.createDiv({ cls: 'super-obsidian-chat-input-toolbar' });

    this.modelSelectEl = toolbar.createEl('select', {
      cls: 'super-obsidian-chat-model-select',
      attr: { 'aria-label': t('modelSelector') },
    });
    this.populateModelSelect();

    const modelRefreshBtn = toolbar.createEl('button', {
      cls: 'super-obsidian-chat-model-refresh-btn',
      attr: { 'aria-label': t('refresh') },
    });
    modelRefreshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;
    modelRefreshBtn.addEventListener('click', () => {
      this.populateModelSelect();
    });

    this.mcpBtn = toolbar.createEl('button', {
      cls: 'super-obsidian-chat-toolbar-btn',
      text: t('toolbarTools'),
    });
    this.mcpBtn.addEventListener('click', () => void this.openMcpToolPicker());

    const searchBtn = toolbar.createEl('button', {
      cls: 'super-obsidian-chat-toolbar-btn',
      text: '검색',
      attr: { 'aria-label': '메시지 검색' },
    });
    searchBtn.addEventListener('click', () => this.focusMessageSearch());

    this.contextPreviewEl = wrapper.createDiv({ cls: 'super-obsidian-chat-context-preview' });
    this.renderContextPreview('');

    const inputRow = wrapper.createDiv({ cls: 'super-obsidian-chat-input-area' });
    this.inputArea = inputRow.createEl('textarea', {
      cls: 'super-obsidian-chat-input',
      attr: { placeholder: '메시지를 입력하세요...', rows: '2' },
    });
    this.inputArea.addEventListener('keydown', (e) => this.handleInputKeydown(e));
    this.inputArea.addEventListener('input', () => {
      this.autoResizeInput();
      this.handleMentionInput();
      this.renderContextPreview(this.inputArea?.value ?? '');
    });
    this.inputArea.addEventListener('blur', () => {
      setTimeout(() => this.hideMentionDropdown(), 200);
    });

    this.sendBtn = inputRow.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: t('sendButton'),
    });
    this.sendBtn.addEventListener('click', () => {
      if (this.isStreaming) {
        this.stopStreaming();
        return;
      }
      void this.handleSend();
    });
  }

  private focusMessageSearch(): void {
    const query = window.prompt('검색할 메시지 내용을 입력하세요.');
    if (!query) return;
    const lowered = query.toLowerCase();
    const match = this.messages.find((message) => message.content.toLowerCase().includes(lowered));
    if (!match) {
      new Notice('검색 결과가 없습니다.');
      return;
    }
    const el = this.messageEls.get(match.id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.addClass('super-obsidian-chat-search-hit');
    window.setTimeout(() => el.removeClass('super-obsidian-chat-search-hit'), 1800);
  }

  private renderContextPreview(text: string): void {
    if (!this.contextPreviewEl) return;
    this.contextPreviewEl.empty();
    const mentions = text.trim() ? this.parseMentions(text) : [];
    const chips = [
      { label: '자동 RAG', cls: 'rag' },
      ...mentions.map((mention) => ({
        label:
          mention.type === 'server'
            ? `MCP ${mention.name}`
            : mention.type === 'folder'
              ? `폴더 ${mention.name}`
              : `파일 ${mention.name}`,
        cls: mention.type,
      })),
    ];
    for (const chip of chips.slice(0, 8)) {
      this.contextPreviewEl.createSpan({
        cls: `super-obsidian-chat-context-chip ${chip.cls}`,
        text: chip.label,
      });
    }
  }

  private stopStreaming(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.isStreaming = false;
    if (this.typingIndicator) this.typingIndicator.style.display = 'none';
    const current = [...this.messages].reverse().find((message) => message.status === 'streaming');
    if (current) {
      this.updateMessage(
        current.id,
        current.content || '응답 생성이 중단되었습니다.',
        true,
        current.reasoning,
        current.toolCalls,
        { status: 'complete', stopReason: 'cancelled' },
      );
    }
    this.setLoading(false);
  }

  private populateModelSelect(): void {
    if (!this.modelSelectEl) return;
    this.modelSelectEl.empty();

    const allModels: { value: string; label: string }[] = [];
    for (const key of CHAT_PROVIDER_KEYS) {
      const conf = this.plugin.settings[key];
      if (!conf.enabled) continue;
      for (const model of conf.models) {
        allModels.push({ value: `${key}:${model}`, label: `${PROVIDER_LABELS[key]} — ${model}` });
      }
    }

    if (allModels.length === 0) {
      const opt = this.modelSelectEl.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      this.modelSelectEl.disabled = true;
      return;
    }

    allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    const defaultModel = this.plugin.settings.chat.defaultModel;

    for (const m of allModels) {
      const opt = this.modelSelectEl.createEl('option');
      opt.value = m.value;
      opt.text = m.label;
    }

    this.modelSelectEl.value =
      defaultModel && allModels.some((m) => m.value === defaultModel)
        ? defaultModel
        : allModels[0].value;
    this.modelSelectEl.disabled = false;
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (this.mentionDropdown && this.mentionDropdown.style.display !== 'none') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectMentionItem(this.mentionSelectedIndex + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectMentionItem(this.mentionSelectedIndex - 1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.confirmMentionSelection();
        return;
      }
      if (e.key === 'Escape') {
        this.hideMentionDropdown();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.handleSend();
    }
  }

  private handleMentionInput(): void {
    if (!this.inputArea) return;
    const value = this.inputArea.value;
    const cursorPos = this.inputArea.selectionStart || 0;
    const textBeforeCursor = value.slice(0, cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex === -1) {
      this.hideMentionDropdown();
      return;
    }

    const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
    if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
      this.hideMentionDropdown();
      return;
    }

    this.mentionQuery = textAfterAt.toLowerCase();
    this.mentionStartIndex = lastAtIndex;
    this.buildMentionItems();
    this.showMentionDropdown();
  }

  private buildMentionItems(): void {
    this.mentionItems = [];
    const query = this.mentionQuery;

    const registry = this.plugin.mcpRegistry;
    if (registry) {
      for (const server of registry.getEnabledServers()) {
        if (server.name.toLowerCase().includes(query)) {
          this.mentionItems.push({
            label: server.name,
            value: server.name,
            type: 'server',
          });
        }
      }
    }

    const files = this.app.vault.getMarkdownFiles();
    const maxFiles = 20;
    let fileCount = 0;
    for (const file of files) {
      if (fileCount >= maxFiles) break;
      if (file.path.toLowerCase().includes(query)) {
        this.mentionItems.push({
          label: file.path,
          value: file.path,
          type: 'file',
        });
        fileCount++;
      }
    }

    const allFolders = new Set<string>();
    const maxFolders = 10;
    let folderCount = 0;
    for (const file of this.app.vault.getFiles()) {
      if (folderCount >= maxFolders) break;
      const parts = file.path.split('/');
      parts.pop();
      for (let i = 0; i < parts.length; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        if (allFolders.has(folderPath)) continue;
        if (folderPath.toLowerCase().includes(query)) {
          this.mentionItems.push({
            label: folderPath,
            value: folderPath,
            type: 'folder',
          });
          allFolders.add(folderPath);
          folderCount++;
          if (folderCount >= maxFolders) break;
        }
      }
    }

    this.mentionSelectedIndex = this.mentionItems.length > 0 ? 0 : -1;
  }

  private showMentionDropdown(): void {
    if (!this.inputArea || !this.container || this.mentionItems.length === 0) {
      if (this.mentionDropdown) this.mentionDropdown.style.display = 'none';
      return;
    }

    if (!this.mentionDropdown) {
      this.mentionDropdown = this.container.createDiv({ cls: 'super-obsidian-mention-dropdown' });
    }
    this.mentionDropdown.empty();
    this.mentionDropdown.style.display = 'block';

    const serverItems = this.mentionItems.filter((i) => i.type === 'server');
    const fileItems = this.mentionItems.filter((i) => i.type === 'file');
    const folderItems = this.mentionItems.filter((i) => i.type === 'folder');

    if (serverItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'super-obsidian-mention-group' });
      group.createDiv({
        cls: 'super-obsidian-mention-group-label',
        text: t('mcpMentionServers'),
      });
      for (const item of serverItems) {
        const el = group.createDiv({ cls: 'super-obsidian-mention-item' });
        el.createSpan({ cls: 'super-obsidian-mention-item-icon', text: '🔌' });
        el.createSpan({ cls: 'super-obsidian-mention-item-name', text: item.label });
        el.addEventListener('click', () => this.insertMention(item));
      }
    }

    if (folderItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'super-obsidian-mention-group' });
      group.createDiv({
        cls: 'super-obsidian-mention-group-label',
        text: t('mcpMentionFolders'),
      });
      for (const item of folderItems) {
        const el = group.createDiv({ cls: 'super-obsidian-mention-item' });
        el.createSpan({ cls: 'super-obsidian-mention-item-icon folder', text: '📁' });
        el.createSpan({ cls: 'super-obsidian-mention-item-name', text: item.label });
        el.addEventListener('click', () => this.insertMention(item));
      }
    }

    if (fileItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'super-obsidian-mention-group' });
      group.createDiv({
        cls: 'super-obsidian-mention-group-label',
        text: t('mcpMentionFiles'),
      });
      for (const item of fileItems) {
        const el = group.createDiv({ cls: 'super-obsidian-mention-item' });
        el.createSpan({ cls: 'super-obsidian-mention-item-icon', text: '📄' });
        el.createSpan({ cls: 'super-obsidian-mention-item-name', text: item.label });
        el.addEventListener('click', () => this.insertMention(item));
      }
    }

    this.positionMentionDropdown();
    this.selectMentionItem(0);
  }

  private positionMentionDropdown(): void {
    if (!this.mentionDropdown || !this.inputArea) return;
    const inputRect = this.inputArea.getBoundingClientRect();
    const containerRect = this.container!.getBoundingClientRect();
    const spaceBelow = containerRect.height - (inputRect.bottom - containerRect.top);
    const spaceAbove = inputRect.top - containerRect.top;

    this.mentionDropdown.style.position = 'absolute';
    this.mentionDropdown.style.left = '12px';
    this.mentionDropdown.style.right = '12px';

    if (spaceBelow < 200 && spaceAbove > 200) {
      this.mentionDropdown.style.bottom = `${containerRect.height - (inputRect.top - containerRect.top) + 4}px`;
      this.mentionDropdown.style.top = 'auto';
      this.mentionDropdown.addClass('above');
    } else {
      this.mentionDropdown.style.top = `${inputRect.bottom - containerRect.top + 4}px`;
      this.mentionDropdown.style.bottom = 'auto';
      this.mentionDropdown.removeClass('above');
    }
  }

  private selectMentionItem(index: number): void {
    if (!this.mentionDropdown) return;
    const items = this.mentionDropdown.querySelectorAll('.super-obsidian-mention-item');
    if (items.length === 0) return;

    let targetIndex = index;
    if (targetIndex < 0) targetIndex = items.length - 1;
    if (targetIndex >= items.length) targetIndex = 0;

    this.mentionSelectedIndex = targetIndex;
    for (let i = 0; i < items.length; i++) {
      items[i].toggleClass('selected', i === targetIndex);
    }
  }

  private confirmMentionSelection(): void {
    if (this.mentionSelectedIndex >= 0 && this.mentionSelectedIndex < this.mentionItems.length) {
      this.insertMention(this.mentionItems[this.mentionSelectedIndex]);
    } else {
      this.hideMentionDropdown();
    }
  }

  private insertMention(item: {
    label: string;
    value: string;
    type: 'server' | 'file' | 'folder';
  }): void {
    if (!this.inputArea) return;
    const value = this.inputArea.value;
    const before = value.slice(0, this.mentionStartIndex);
    const after = value.slice(this.inputArea.selectionStart || 0);
    // 경로에 공백이 포함된 경우 브래킷으로 감싸서 parseMentions가 올바르게 파싱하도록 함
    const needsBrackets = item.type !== 'server' && item.value.includes(' ');
    const insertText = needsBrackets ? `@[${item.value}] ` : `@${item.value} `;
    this.inputArea.value = before + insertText + after;
    const newCursorPos = before.length + insertText.length;
    this.inputArea.setSelectionRange(newCursorPos, newCursorPos);
    this.hideMentionDropdown();
    this.autoResizeInput();
  }

  private hideMentionDropdown(): void {
    if (this.mentionDropdown) {
      this.mentionDropdown.style.display = 'none';
    }
    this.mentionSelectedIndex = -1;
    this.mentionItems = [];
    this.mentionStartIndex = -1;
  }

  private markdownRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MARKDOWN_RENDER_INTERVAL = 300;
  private pendingMarkdownEl: HTMLElement | null = null;
  private pendingMarkdownContent: string = '';

  private autoResizeInput(): void {
    if (!this.inputArea) return;
    this.inputArea.style.height = 'auto';
    this.inputArea.style.height = `${Math.min(this.inputArea.scrollHeight, 200)}px`;
  }

  private handleScroll(): void {
    if (!this.messagesArea) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesArea;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 60;
    this.autoScroll = nearBottom;
    if (this.scrollBtn) {
      this.scrollBtn.style.display = nearBottom ? 'none' : 'flex';
    }
  }

  private scrollToBottom(): void {
    if (!this.messagesArea) return;
    this.messagesArea.scrollTo({ top: this.messagesArea.scrollHeight, behavior: 'auto' });
    this.autoScroll = true;
    if (this.scrollBtn) this.scrollBtn.style.display = 'none';
  }

  addMessage(
    role: ChatMessage['role'],
    content: string,
    reasoning?: string,
    toolCalls?: ToolCallRecord[],
    metaInput?: MessageMetaInput,
  ): string {
    const now = new Date();
    const nowIso = now.toISOString();
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const msg: ChatMessageWithMeta = {
      id,
      role,
      content,
      timestamp: now.getTime(),
      createdAt: nowIso,
      updatedAt: nowIso,
      providerKey: metaInput?.providerKey,
      providerLabel: metaInput?.providerLabel,
      model: metaInput?.model,
      status:
        metaInput?.status ??
        (role === 'assistant' && this.isStreaming
          ? 'streaming'
          : role === 'tool'
            ? 'pending'
            : 'complete'),
      errorMessage: metaInput?.errorMessage,
      reasoning,
      toolCalls,
      citations: metaInput?.citations,
      contextAttachments: metaInput?.contextAttachments,
      branchOf: metaInput?.branchOf,
      stopReason: metaInput?.stopReason,
    };
    this.messages.push(msg);
    this.markDirtyAndAutoSave();

    const wrapper = this.messagesArea!.createDiv({
      cls: `super-obsidian-chat-message-wrapper ${role}`,
    });
    this.messageEls.set(id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'super-obsidian-chat-avatar' });
    avatar.setText(this.getAvatarText(role));

    const bubbleContainer = wrapper.createDiv({ cls: 'super-obsidian-chat-bubble-container' });
    bubbleContainer.setAttribute('data-message-id', id);

    const meta = bubbleContainer.createDiv({ cls: 'super-obsidian-chat-meta' });
    this.renderMessageMeta(meta, msg);

    if (role === 'assistant') {
      this.createAssistantLayers(bubbleContainer, content, reasoning, toolCalls);
    } else if (role === 'tool') {
      const bubble = bubbleContainer.createDiv({
        cls: 'super-obsidian-chat-bubble tool',
      });
      this.renderToolBubble(bubble, content, 'running');
    } else {
      const bubble = bubbleContainer.createDiv({
        cls: `super-obsidian-chat-bubble ${role}`,
      });
      void this.renderMarkdownBubble(bubble, content);
    }
    this.renderContextAttachmentsSection(bubbleContainer, msg.contextAttachments ?? []);
    this.renderMessageActions(bubbleContainer, msg);

    if (this.autoScroll) {
      this.scrollToBottom();
    }
    return id;
  }

  updateMessage(
    id: string,
    content: string,
    isDone: boolean,
    reasoning?: string,
    toolCalls?: ToolCallRecord[],
    metaInput?: MessageMetaInput,
  ): void {
    const wrapper = this.messageEls.get(id);
    if (!wrapper) return;

    const message = this.messages.find((m) => m.id === id);
    if (message) {
      message.content = content;
      message.reasoning = reasoning;
      message.updatedAt = new Date().toISOString();
      message.providerKey = metaInput?.providerKey ?? message.providerKey;
      message.providerLabel = metaInput?.providerLabel ?? message.providerLabel;
      message.model = metaInput?.model ?? message.model;
      message.status = metaInput?.status ?? (isDone ? 'complete' : 'streaming');
      message.errorMessage = metaInput?.errorMessage;
      message.citations = metaInput?.citations ?? message.citations;
      message.contextAttachments = metaInput?.contextAttachments ?? message.contextAttachments;
      message.branchOf = metaInput?.branchOf ?? message.branchOf;
      message.stopReason = metaInput?.stopReason ?? (isDone ? 'complete' : message.stopReason);
      if (toolCalls) {
        message.toolCalls = toolCalls.map((toolCall) => ({ ...toolCall }));
      }
      this.updateMessageMeta(wrapper, message);
      this.markDirtyAndAutoSave();
    }

    const isTool = wrapper.classList.contains('tool');
    const isAssistant = wrapper.classList.contains('assistant');

    if (isAssistant) {
      this.updateAssistantLayers(
        wrapper,
        content,
        isDone,
        reasoning,
        toolCalls,
        message?.citations,
      );
      if (this.autoScroll) {
        this.scrollToBottom();
      }
      return;
    }

    if (isTool) {
      const bubble = wrapper.querySelector('.super-obsidian-chat-bubble.tool');
      if (bubble instanceof HTMLElement) {
        const status = isDone ? 'success' : 'running';
        this.renderToolBubble(bubble, content, status);
      }
    } else {
      const bubble = wrapper.querySelector('.super-obsidian-chat-bubble');
      if (bubble instanceof HTMLElement) {
        if (!isDone) {
          bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
        } else {
          void this.renderMarkdownBubble(bubble, content);
        }
      }
    }

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private createAssistantLayers(
    bubbleContainer: HTMLElement,
    content: string,
    reasoning?: string,
    toolCalls?: ToolCallRecord[],
    citations?: SourceCitation[],
  ): void {
    const shouldShowStreamingPlaceholders = this.isStreaming && !content;

    const thinking = bubbleContainer.createEl('details', {
      cls: 'super-obsidian-chat-thinking super-obsidian-chat-reasoning',
    });
    thinking.style.display = reasoning || shouldShowStreamingPlaceholders ? '' : 'none';
    if (shouldShowStreamingPlaceholders || (reasoning && reasoning.length > 0)) {
      thinking.open = true;
    }
    thinking.addEventListener('toggle', () => {
      if (this.autoScroll) this.scrollToBottom();
    });
    const thinkingSummary = thinking.createEl('summary');
    thinkingSummary.setText(`💭 ${t('reasoningLabel')}`);
    const thinkingContent = thinking.createDiv({
      cls: 'super-obsidian-chat-thinking-content super-obsidian-chat-reasoning-content',
    });
    thinkingContent.setText(reasoning ?? t('thinkingPlaceholder'));

    const toolCallsSection = bubbleContainer.createDiv({
      cls: 'super-obsidian-chat-tool-calls',
    });
    const hasToolCalls = toolCalls && toolCalls.length > 0;
    toolCallsSection.style.display = hasToolCalls || shouldShowStreamingPlaceholders ? '' : 'none';
    this.renderToolCallsSection(
      toolCallsSection,
      toolCalls ?? [],
      shouldShowStreamingPlaceholders && !hasToolCalls,
    );

    const answerLayer = bubbleContainer.createDiv({ cls: 'super-obsidian-chat-answer' });
    answerLayer.createDiv({
      cls: 'super-obsidian-chat-answer-label',
      text: `💬 ${t('answerLabel')}`,
    });
    const bubble = answerLayer.createDiv({
      cls: 'super-obsidian-chat-bubble assistant',
    });
    if (content.trim()) {
      void this.renderMarkdownBubble(bubble, content);
    } else {
      bubble.setText(content);
    }
    this.renderCitationsSection(bubbleContainer, citations ?? []);
  }

  private updateAssistantLayers(
    wrapper: HTMLElement,
    content: string,
    isDone: boolean,
    reasoning?: string,
    toolCalls?: ToolCallRecord[],
    citations?: SourceCitation[],
  ): void {
    const bubbleContainer = wrapper.querySelector('.super-obsidian-chat-bubble-container');
    if (!(bubbleContainer instanceof HTMLElement)) return;

    let thinking = bubbleContainer.querySelector('.super-obsidian-chat-thinking');
    if (!(thinking instanceof HTMLDetailsElement)) {
      this.createAssistantLayers(bubbleContainer, content, reasoning, toolCalls, citations);
      thinking = bubbleContainer.querySelector('.super-obsidian-chat-thinking');
    }

    if (thinking instanceof HTMLDetailsElement) {
      const hasReasoning = reasoning !== undefined && reasoning.length > 0;
      thinking.style.display = hasReasoning || !isDone ? '' : 'none';
      const thinkingContent = thinking.querySelector('.super-obsidian-chat-thinking-content');
      if (thinkingContent instanceof HTMLElement) {
        if (!isDone) {
          const text = hasReasoning ? reasoning : t('thinkingPlaceholder');
          thinkingContent.innerHTML = escapeHtml(text ?? '').replace(/\n/g, '<br>');
          thinking.open = true;
        } else if (hasReasoning) {
          void this.renderMarkdownBubble(thinkingContent, reasoning ?? '');
          thinking.open = false;
        } else {
          thinkingContent.setText('');
          thinking.open = false;
        }
      } else if (!hasReasoning && isDone) {
        thinking.open = false;
      }
    }

    const toolCallsSection = bubbleContainer.querySelector('.super-obsidian-chat-tool-calls');
    if (toolCallsSection instanceof HTMLElement) {
      const calls = toolCalls ?? [];
      toolCallsSection.style.display = calls.length > 0 || !isDone ? '' : 'none';
      this.renderToolCallsSection(toolCallsSection, calls, !isDone);
    }

    const bubble = bubbleContainer.querySelector('.super-obsidian-chat-bubble.assistant');
    if (bubble instanceof HTMLElement) {
      const meta = bubbleContainer.querySelector('.super-obsidian-chat-meta');
      const generatingLabel = meta?.querySelector('.super-obsidian-chat-generating-label');
      if (!isDone) {
        if (
          !content.trim() &&
          !generatingLabel &&
          !bubbleContainer
            .querySelector('.super-obsidian-chat-thinking-content')
            ?.textContent?.trim() &&
          !(toolCalls && toolCalls.length > 0)
        ) {
          const label = document.createElement('span');
          label.className = 'super-obsidian-chat-generating-label';
          label.textContent = '응답 생성 중...';
          if (meta instanceof HTMLElement) {
            meta.appendChild(label);
          }
        }
        this.scheduleStreamingMarkdownRender(bubble, content);
      } else {
        this.cancelStreamingMarkdownRender();
        void this.renderMarkdownBubble(bubble, content);
        if (generatingLabel instanceof HTMLElement) {
          generatingLabel.remove();
        }
        wrapper.classList.remove('generating');
      }
    }
    this.renderCitationsSection(bubbleContainer, citations ?? []);
  }

  private scheduleStreamingMarkdownRender(bubble: HTMLElement, content: string): void {
    bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');

    const existingCursor = bubble.querySelector('.super-obsidian-chat-streaming-cursor');
    if (!existingCursor) {
      const cursor = bubble.createSpan({ cls: 'super-obsidian-chat-streaming-cursor' });
      bubble.appendChild(cursor);
    }

    this.pendingMarkdownEl = bubble;
    this.pendingMarkdownContent = content;

    if (!this.markdownRenderTimer) {
      this.markdownRenderTimer = setTimeout(() => {
        this.markdownRenderTimer = null;
        if (this.pendingMarkdownEl && this.pendingMarkdownEl.isConnected) {
          const el = this.pendingMarkdownEl;
          const txt = this.pendingMarkdownContent;
          if (txt.trim()) {
            void this.renderMarkdownBubble(el, txt);
            const cursor = el.createSpan({ cls: 'super-obsidian-chat-streaming-cursor' });
            el.appendChild(cursor);
          }
        }
      }, ChatView.MARKDOWN_RENDER_INTERVAL);
    }
  }

  private cancelStreamingMarkdownRender(): void {
    if (this.markdownRenderTimer) {
      clearTimeout(this.markdownRenderTimer);
      this.markdownRenderTimer = null;
    }
    this.pendingMarkdownEl = null;
    this.pendingMarkdownContent = '';
  }

  private renderToolCallsSection(
    section: HTMLElement,
    toolCalls: ToolCallRecord[],
    showPlaceholder: boolean,
  ): void {
    const existingLabel = section.querySelector('.super-obsidian-chat-tool-calls-label');
    if (!existingLabel) {
      section.createDiv({
        cls: 'super-obsidian-chat-tool-calls-label',
        text: `🔧 ${t('toolCallLabel')}`,
      });
    }

    if (toolCalls.length === 0 && showPlaceholder) {
      const existingPlaceholder = section.querySelector('.super-obsidian-tool-call.placeholder');
      if (!existingPlaceholder) {
        const row = section.createDiv({ cls: 'super-obsidian-tool-call placeholder' });
        row.createSpan({ cls: 'super-obsidian-tool-call-icon', text: '🔧' });
        row.createSpan({ cls: 'super-obsidian-tool-call-name', text: t('mcpToolRunning') });
        const statusBadge = row.createSpan({ cls: 'super-obsidian-tool-call-status running' });
        this.renderRunningDots(statusBadge);
      }
      return;
    }

    section.querySelectorAll('.super-obsidian-tool-call.placeholder').forEach((el) => el.remove());

    for (const toolCall of toolCalls) {
      const rowId = `tool-call-${toolCall.id || toolCall.name}`;
      let callRow = Array.from(section.querySelectorAll('.super-obsidian-tool-call')).find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el.getAttribute('data-tool-call-id') === rowId,
      );

      if (!callRow) {
        callRow = section.createDiv({ cls: 'super-obsidian-tool-call' });
        callRow.setAttribute('data-tool-call-id', rowId);
        callRow.createSpan({ cls: 'super-obsidian-tool-call-icon', text: '🔧' });
        callRow.createSpan({
          cls: 'super-obsidian-tool-call-name',
          text: toolCall.name || t('toolCallLabel'),
        });
        const statusBadge = callRow.createSpan({
          cls: `super-obsidian-tool-call-status ${toolCall.status}`,
        });
        this.renderToolCallStatus(statusBadge, toolCall.status);
      } else {
        const statusBadge = callRow.querySelector('.super-obsidian-tool-call-status');
        if (statusBadge instanceof HTMLElement) {
          statusBadge.className = `super-obsidian-tool-call-status ${toolCall.status}`;
          this.renderToolCallStatus(statusBadge, toolCall.status);
        }
      }

      const staleApproveBtn = callRow.querySelector('.super-obsidian-tool-call-approve');
      if (
        staleApproveBtn instanceof HTMLElement &&
        (toolCall.status !== 'running' || toolCall.approved !== false)
      ) {
        staleApproveBtn.remove();
      }
      if (
        this.toolExecutionPolicy.manualApproval &&
        toolCall.status === 'running' &&
        toolCall.approved === false &&
        !callRow.querySelector('.super-obsidian-tool-call-approve')
      ) {
        const approveBtn = callRow.createEl('button', {
          cls: 'super-obsidian-tool-call-approve',
          text: '실행 승인',
        });
        approveBtn.addEventListener('click', () => {
          const messageId = section
            .closest('.super-obsidian-chat-bubble-container')
            ?.getAttribute('data-message-id');
          if (messageId) void this.approveToolCall(messageId, toolCall.id || toolCall.name);
        });
      }

      const existingArgs = Array.from(
        section.querySelectorAll('.super-obsidian-tool-arguments'),
      ).find(
        (el): el is HTMLDetailsElement =>
          el instanceof HTMLDetailsElement && el.getAttribute('data-tool-call-id') === rowId,
      );
      const existingResult = Array.from(
        section.querySelectorAll('.super-obsidian-tool-result-details'),
      ).find(
        (el): el is HTMLDetailsElement =>
          el instanceof HTMLDetailsElement && el.getAttribute('data-tool-call-id') === rowId,
      );
      const argsOpen = existingArgs?.open ?? false;
      const resultOpen = existingResult?.open ?? false;
      existingArgs?.remove();
      existingResult?.remove();

      const argumentPreview = toolCall.arguments.trim();
      if (argumentPreview) {
        const args = section.createEl('details', { cls: 'super-obsidian-tool-arguments' });
        args.setAttribute('data-tool-call-id', rowId);
        args.open = argsOpen;
        args.createEl('summary', { text: t('toolArgs') });
        args.createEl('pre', { text: argumentPreview });
      }

      if (toolCall.result) {
        const resultDetails = section.createEl('details', {
          cls: 'super-obsidian-tool-result-details',
        });
        resultDetails.setAttribute('data-tool-call-id', rowId);
        resultDetails.open = resultOpen;
        resultDetails.createEl('summary', { text: t('toolResult') });
        const resultArea = resultDetails.createDiv({ cls: 'super-obsidian-tool-result' });
        void this.renderMarkdownBubble(resultArea, toolCall.result);
      }
    }

    const currentIds = new Set(
      toolCalls.map((toolCall) => `tool-call-${toolCall.id || toolCall.name}`),
    );
    section.querySelectorAll('.super-obsidian-tool-call:not(.placeholder)').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.super-obsidian-tool-arguments').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.super-obsidian-tool-result-details').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
  }

  private renderCitationsSection(container: HTMLElement, citations: SourceCitation[]): void {
    let section = container.querySelector('.super-obsidian-chat-citations');
    if (citations.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'super-obsidian-chat-citations' });
    }
    section.empty();
    section.createDiv({
      cls: 'super-obsidian-chat-citations-label',
      text: `출처 ${citations.length}개`,
    });

    for (const citation of citations) {
      const card = section.createDiv({ cls: 'super-obsidian-chat-citation-card' });
      const title = card.createDiv({ cls: 'super-obsidian-chat-citation-title' });
      title.createSpan({ text: citation.filePath });
      if (citation.heading) {
        title.createSpan({
          cls: 'super-obsidian-chat-citation-heading',
          text: ` # ${citation.heading}`,
        });
      }
      const metaParts = [
        citation.line !== undefined ? `line ${citation.line}` : '',
        citation.score !== undefined ? `score ${citation.score.toFixed(3)}` : '',
      ].filter(Boolean);
      if (metaParts.length > 0) {
        card.createDiv({ cls: 'super-obsidian-chat-citation-meta', text: metaParts.join(' · ') });
      }
      card.createDiv({ cls: 'super-obsidian-chat-citation-preview', text: citation.preview });
      const actions = card.createDiv({ cls: 'super-obsidian-chat-citation-actions' });
      const openBtn = actions.createEl('button', { text: '열기' });
      openBtn.addEventListener('click', () => void this.openCitation(citation));
      const copyBtn = actions.createEl('button', { text: '링크 복사' });
      copyBtn.addEventListener('click', () => void this.copyCitationLink(citation, copyBtn));
      const insertBtn = actions.createEl('button', { text: '노트에 삽입' });
      insertBtn.addEventListener('click', () => void this.insertCitationIntoActiveNote(citation));
    }
  }

  private renderContextAttachmentsSection(
    container: HTMLElement,
    attachments: ContextAttachment[],
  ): void {
    let section = container.querySelector('.super-obsidian-chat-context-attachments');
    if (attachments.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'super-obsidian-chat-context-attachments' });
    }
    section.empty();
    for (const attachment of attachments) {
      const chip = section.createSpan({
        cls: `super-obsidian-chat-context-chip ${attachment.type} ${attachment.status}`,
        text: attachment.label,
      });
      if (attachment.detail) {
        chip.setAttribute('title', attachment.detail);
      }
    }
  }

  private async openCitation(citation: SourceCitation): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(citation.filePath);
    if (!(file instanceof TFile)) {
      new Notice(`파일을 찾을 수 없습니다: ${citation.filePath}`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async copyCitationLink(
    citation: SourceCitation,
    button: HTMLButtonElement,
  ): Promise<void> {
    const heading = citation.heading ? `#${citation.heading}` : '';
    await navigator.clipboard.writeText(`[[${citation.filePath}${heading}]]`);
    button.setText(t('copied'));
    window.setTimeout(() => button.setText('링크 복사'), 1500);
  }

  private async insertCitationIntoActiveNote(citation: SourceCitation): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    if (!active) {
      new Notice('활성 노트가 없습니다.');
      return;
    }
    const link = citation.heading
      ? `[[${citation.filePath}#${citation.heading}]]`
      : `[[${citation.filePath}]]`;
    await this.app.vault.append(active, `\n> 출처: ${link}\n> ${citation.preview}\n`);
    new Notice('활성 노트에 출처를 삽입했습니다.');
  }

  private renderToolCallStatus(statusBadge: HTMLElement, status: ToolCallRecord['status']): void {
    if (status === 'running') {
      this.renderRunningDots(statusBadge);
    } else if (status === 'success') {
      statusBadge.setText('✓');
    } else {
      statusBadge.setText('✗');
    }
  }

  private renderRunningDots(container: HTMLElement): void {
    container.empty();
    const dots = container.createSpan({ cls: 'super-obsidian-tool-running-dots' });
    dots.createSpan({});
    dots.createSpan({});
    dots.createSpan({});
  }

  private async renderMarkdownBubble(bubble: HTMLElement, content: string): Promise<void> {
    bubble.empty();
    await MarkdownRenderer.renderMarkdown(content, bubble, '', this);
    this.enhanceCodeBlocks(bubble);
    this.stylizeMentions(bubble);
  }

  private stylizeMentions(container: HTMLElement): void {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('a, code, pre')) continue;
      textNodes.push(node as Text);
    }
    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      const regex = /@([^\s\n<>,;:!?()[\]{}]+)/g;
      if (!regex.test(text)) continue;
      regex.lastIndex = 0;
      const fragments: (Text | HTMLElement)[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const span = document.createElement('span');
        span.addClass('super-obsidian-mention-inline');
        span.setText(match[1]);
        fragments.push(span);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
      }
      if (fragments.length === 0) continue;
      const parent = textNode.parentNode;
      if (!parent) continue;
      for (const frag of fragments) {
        parent.insertBefore(frag, textNode);
      }
      parent.removeChild(textNode);
    }
  }

  private enhanceCodeBlocks(container: HTMLElement): void {
    const pres = container.querySelectorAll('pre');
    for (const pre of Array.from(pres)) {
      if (pre.parentElement?.classList.contains('super-obsidian-code-block-wrapper')) {
        continue;
      }
      const wrapper = document.createElement('div');
      wrapper.addClass('super-obsidian-code-block-wrapper');
      pre.parentNode!.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const copyBtn = wrapper.createEl('button', {
        cls: 'super-obsidian-code-copy-btn',
        text: t('copyCode'),
      });
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
        void navigator.clipboard.writeText(code).then(() => {
          copyBtn.setText(t('copied'));
          setTimeout(() => copyBtn.setText(t('copyCode')), 1500);
        });
      });
    }
  }

  private getAvatarText(role: string): string {
    switch (role) {
      case 'user':
        return '👤';
      case 'assistant':
        return '🤖';
      case 'system':
        return '⚙️';
      case 'tool':
        return '🔧';
      default:
        return '•';
    }
  }

  private getRoleLabel(role: string): string {
    switch (role) {
      case 'user':
        return t('messageUser');
      case 'assistant':
        return t('messageAssistant');
      case 'system':
        return t('messageSystem');
      case 'tool':
        return t('messageTool');
      default:
        return role;
    }
  }

  private renderMessageMeta(meta: HTMLElement, msg: ChatMessageWithMeta): void {
    meta.empty();
    meta.createSpan({ cls: 'super-obsidian-chat-role', text: this.getRoleLabel(msg.role) });
    meta.createSpan({
      cls: 'super-obsidian-chat-timestamp',
      text: this.formatExactTimestamp(msg.createdAt),
    });
    if (msg.providerLabel || msg.model) {
      meta.createSpan({
        cls: 'super-obsidian-chat-model-meta',
        text: [msg.providerLabel, msg.model].filter(Boolean).join(' / '),
      });
    }
    const status = meta.createSpan({
      cls: `super-obsidian-chat-message-status ${msg.status}`,
      text: this.getMessageStatusLabel(msg.status),
    });
    if (msg.errorMessage) {
      status.setAttribute('title', msg.errorMessage);
    }
  }

  private updateMessageMeta(wrapper: HTMLElement, msg: ChatMessageWithMeta): void {
    const meta = wrapper.querySelector('.super-obsidian-chat-meta');
    if (meta instanceof HTMLElement) {
      this.renderMessageMeta(meta, msg);
    }
  }

  private renderMessageActions(container: HTMLElement, msg: ChatMessageWithMeta): void {
    const existing = container.querySelector('.super-obsidian-chat-message-actions');
    existing?.remove();
    const actions = container.createDiv({ cls: 'super-obsidian-chat-message-actions' });

    const copyBtn = actions.createEl('button', { text: '복사' });
    copyBtn.addEventListener('click', () => void this.copyMessage(msg, copyBtn));

    if (msg.role === 'assistant') {
      const retryBtn = actions.createEl('button', { text: '재생성' });
      retryBtn.addEventListener('click', () => void this.regenerateFromAssistant(msg.id));
      const insertBtn = actions.createEl('button', { text: '노트에 삽입' });
      insertBtn.addEventListener('click', () => void this.insertMessageIntoActiveNote(msg));
      const saveBtn = actions.createEl('button', { text: '새 노트' });
      saveBtn.addEventListener('click', () => void this.saveMessageAsNote(msg));
      const branchBtn = actions.createEl('button', { text: '브랜치' });
      branchBtn.addEventListener('click', () => void this.branchFromMessage(msg.id));
    } else if (msg.role === 'user') {
      const editBtn = actions.createEl('button', { text: '수정 후 전송' });
      editBtn.addEventListener('click', () => void this.editAndResendUserMessage(msg));
    }
  }

  private async copyMessage(msg: ChatMessageWithMeta, button: HTMLButtonElement): Promise<void> {
    await navigator.clipboard.writeText(msg.content);
    button.setText(t('copied'));
    window.setTimeout(() => button.setText('복사'), 1500);
  }

  private async insertMessageIntoActiveNote(msg: ChatMessageWithMeta): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    if (!active) {
      new Notice('활성 노트가 없습니다.');
      return;
    }
    await this.app.vault.append(active, `\n\n${msg.content}\n`);
    new Notice('활성 노트에 삽입했습니다.');
  }

  private async saveMessageAsNote(msg: ChatMessageWithMeta): Promise<void> {
    const folder = this.plugin.settings.chat.saveFolder || 'SuperObsidianByAI';
    const title = this.session.title || 'AI 답변';
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const path = `${folder}/${safeTitle}-answer-${Date.now()}.md`;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }
    await this.app.vault.create(path, `# ${title}\n\n${msg.content}\n`);
    new Notice(`새 노트로 저장했습니다: ${path}`);
  }

  private async editAndResendUserMessage(msg: ChatMessageWithMeta): Promise<void> {
    const edited = window.prompt('수정할 메시지', msg.content);
    if (!edited?.trim()) return;
    this.inputArea!.value = edited.trim();
    this.autoResizeInput();
    this.renderContextPreview(edited.trim());
    await this.handleSend();
  }

  private async regenerateFromAssistant(messageId: string): Promise<void> {
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index <= 0) return;
    const previousUser = [...this.messages.slice(0, index)]
      .reverse()
      .find((message) => message.role === 'user');
    if (!previousUser) return;
    this.messages = this.messages.slice(0, index);
    this.markDirtyAndAutoSave();
    this.rebuildMessagesDOM();
    this.inputArea!.value = previousUser.content;
    this.autoResizeInput();
    this.renderContextPreview(previousUser.content);
    await this.handleSend();
  }

  private async branchFromMessage(messageId: string): Promise<void> {
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    await this.saveCurrentSession(true);
    const branchMessages = this.messages.slice(0, index + 1).map((message) => ({
      ...message,
      branchOf: message.branchOf ?? this.session.filePath ?? messageId,
    }));
    this.messages = branchMessages;
    this.session = {
      filePath: null,
      title: `${this.session.title || t('chatSessionTitle')} branch`,
      isDirty: true,
    };
    this.rebuildMessagesDOM();
    await this.saveCurrentSession(true);
    new Notice('브랜치 세션을 만들었습니다.');
  }

  private formatExactTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private getMessageStatusLabel(status: ChatMessageWithMeta['status']): string {
    switch (status) {
      case 'pending':
        return '대기';
      case 'streaming':
        return '생성 중';
      case 'complete':
        return '완료';
      case 'error':
        return '오류';
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sessionSystemPrompt = null;
    this.session = { filePath: null, title: '', isDirty: false };
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    this.updateSessionTitle();
    this.messageEls.clear();
    if (this.messagesArea) {
      const children = Array.from(this.messagesArea.children);
      for (const child of children) {
        if (!child.hasClass('super-obsidian-typing-indicator')) {
          child.remove();
        }
      }
    }
    this.updateHeaderTitle();
  }

  private isCurrentSessionPath(path: string): boolean {
    return this.session.filePath === path;
  }

  private getCurrentSessionFile(): TFile | null {
    if (!this.session.filePath) return null;
    const file = this.app.vault.getAbstractFileByPath(this.session.filePath);
    return file instanceof TFile ? file : null;
  }

  private resetMissingSession(missingPath: string): void {
    const hadMessages = this.messages.length > 0;
    this.clearMessages();
    this.setLoading(false);
    if (this.typingIndicator) this.typingIndicator.style.display = 'none';
    if (hadMessages) {
      new Notice(`채팅 세션 파일이 삭제되어 채팅창을 초기화했습니다: ${missingPath}`);
    }
  }

  async startNewSession(): Promise<void> {
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    await this.saveCurrentSession(true);
    this.messages = [];
    this.sessionSystemPrompt = null;
    this.messageEls.clear();
    this.session = { filePath: null, title: '', isDirty: false };
    if (this.messagesArea) {
      const children = Array.from(this.messagesArea.children);
      for (const child of children) {
        if (!child.hasClass('super-obsidian-typing-indicator')) {
          child.remove();
        }
      }
    }
    this.updateHeaderTitle();
  }

  private updateHeaderTitle(): void {
    if (this.sessionTitleEl) {
      this.sessionTitleEl.textContent = this.session.title || t('chatTabTitle');
      this.sessionTitleEl.toggleClass('unsaved', this.session.isDirty);
    }
    this.updateSessionInfo();
  }

  private updateSessionInfo(): void {
    if (!this.sessionInfoEl) return;
    const parts: string[] = [];
    if (this.messages.length > 0) {
      parts.push(`${this.messages.length}${t('chatMessageUnit')}`);
    }
    if (this.session.isDirty) {
      parts.push('●');
    }
    this.sessionInfoEl.setText(parts.join(' '));
  }

  private updateSessionTitle(): void {
    if (this.session.title) return;
    const firstUserMsg = this.messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
      this.session.title = firstUserMsg.content.replace(/\n/g, ' ').trim().slice(0, 50);
      this.updateHeaderTitle();
    }
  }

  private markDirtyAndAutoSave(): void {
    this.session.isDirty = true;
    this.updateSessionTitle();
    this.updateHeaderTitle();

    if (!this.plugin.settings.chat.autoSaveEnabled) return;
    if (!this.plugin.settings.chat.saveFolder) return;
    if (this.isStreaming) return;

    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      void this.saveCurrentSession();
    }, this.plugin.settings.chat.autoSaveDebounceMs);
  }

  private clearAutoSaveTimer(): void {
    if (!this.autoSaveTimer) return;
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  private async saveCurrentSession(force = false): Promise<void> {
    const folder = this.plugin.settings.chat.saveFolder;
    if (!folder || this.messages.length === 0 || (!this.session.isDirty && !force)) return;
    if (this.session.filePath && !this.getCurrentSessionFile()) {
      this.resetMissingSession(this.session.filePath);
      return;
    }

    try {
      const file = await saveChat(
        this.app.vault,
        this.messages,
        folder,
        this.sessionSystemPrompt ?? undefined,
        { filePath: this.session.filePath ?? undefined, title: this.session.title || undefined },
      );
      this.session.filePath = file.path;
      this.session.isDirty = false;
      this.clearAutoSaveTimer();
      this.updateHeaderTitle();
    } catch (err) {
      console.error('[Super-Obsidian] 채팅 자동 저장 실패:', err);
    }
  }

  async loadSession(filePath: string): Promise<void> {
    try {
      this.clearAutoSaveTimer();
      await this.saveCurrentSession(true);
      const session = await loadChat(this.app.vault, filePath);
      const now = new Date().toISOString();
      this.messages = session.messages.map((m) => ({
        id: m.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp ?? Date.now(),
        createdAt: m.createdAt ?? now,
        updatedAt: m.updatedAt ?? m.createdAt ?? now,
        providerKey: m.providerKey,
        providerLabel: m.providerLabel,
        model: m.model,
        status: m.status ?? 'complete',
        errorMessage: m.errorMessage,
        reasoning: m.reasoning,
        toolCalls: m.toolCalls
          ? m.toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              result: tc.result,
              status: tc.status,
              serverName: tc.serverName,
              approved: tc.approved,
            }))
          : undefined,
        citations: m.citations,
        contextAttachments: m.contextAttachments,
        branchOf: m.branchOf,
        stopReason: m.stopReason,
      }));
      this.sessionSystemPrompt = session.systemPrompt ?? null;
      this.session = {
        filePath,
        title: session.title || '',
        isDirty: false,
      };
      this.rebuildMessagesDOM();
      this.updateHeaderTitle();
    } catch (err) {
      new Notice(`채팅 불러오기 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private rebuildMessagesDOM(): void {
    if (!this.messagesArea) return;
    const children = Array.from(this.messagesArea.children);
    for (const child of children) {
      if (!child.hasClass('super-obsidian-typing-indicator')) {
        child.remove();
      }
    }
    this.messageEls.clear();
    for (const msg of this.messages) {
      this.renderExistingMessage(msg);
    }
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private renderExistingMessage(msg: ChatMessageWithMeta): void {
    if (!this.messagesArea) return;

    const wrapper = this.messagesArea.createDiv({
      cls: `super-obsidian-chat-message-wrapper ${msg.role}`,
    });
    this.messageEls.set(msg.id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'super-obsidian-chat-avatar' });
    avatar.setText(this.getAvatarText(msg.role));

    const bubbleContainer = wrapper.createDiv({ cls: 'super-obsidian-chat-bubble-container' });
    bubbleContainer.setAttribute('data-message-id', msg.id);
    const meta = bubbleContainer.createDiv({ cls: 'super-obsidian-chat-meta' });
    this.renderMessageMeta(meta, msg);

    if (msg.role === 'assistant') {
      this.createAssistantLayers(
        bubbleContainer,
        msg.content,
        msg.reasoning,
        msg.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          result: tc.result,
          status: tc.status,
          serverName: tc.serverName,
          approved: tc.approved,
        })),
        msg.citations,
      );
    } else if (msg.role === 'tool') {
      const bubble = bubbleContainer.createDiv({ cls: 'super-obsidian-chat-bubble tool' });
      this.renderToolBubble(bubble, msg.content, 'success');
    } else {
      const bubble = bubbleContainer.createDiv({ cls: `super-obsidian-chat-bubble ${msg.role}` });
      void this.renderMarkdownBubble(bubble, msg.content);
    }
    this.renderContextAttachmentsSection(bubbleContainer, msg.contextAttachments ?? []);
    this.renderMessageActions(bubbleContainer, msg);
  }

  private promptRenameSession(): void {
    if (!this.session.filePath && this.messages.length === 0) {
      new Notice(t('chatNoSavedSessions'));
      return;
    }

    const currentTitle = this.session.title || t('chatSessionTitle');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'super-obsidian-session-rename-input';
    input.placeholder = t('chatRenameSession');

    const finishRename = (): void => {
      const newTitle = input.value.trim();
      if (!newTitle || newTitle === currentTitle) {
        this.updateHeaderTitle();
        return;
      }
      this.session.title = newTitle;
      this.updateHeaderTitle();
      this.markDirtyAndAutoSave();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        this.updateHeaderTitle();
      }
    });
    input.addEventListener('blur', () => void finishRename());

    if (this.sessionTitleEl) {
      this.sessionTitleEl.empty();
      this.sessionTitleEl.appendChild(input);
      input.focus();
      input.select();
    }
  }

  private async openSessionHistoryModal(): Promise<void> {
    if (!this.plugin.settings.chat.saveFolder) {
      new Notice(t('chatSaveFolder') + ' 경로를 먼저 설정하세요.');
      return;
    }
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    await this.saveCurrentSession(true);
    openSessionHistoryModal(
      this.container!,
      this.app,
      this.app.vault,
      this.plugin.settings.chat.saveFolder,
      (filePath: string) => void this.loadSession(filePath),
      this.session.filePath,
    );
  }

  private async handleSend(): Promise<void> {
    const text = this.inputArea?.value.trim();
    if (!text || this.isStreaming) return;
    this.lastUserPrompt = text;

    const { createProvider } = await import('../llm/providers');

    const selectedModel = this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel;
    if (!selectedModel) {
      new Notice('기본 모델이 설정되지 않았습니다. 설정 탭에서 모델을 선택하세요.');
      return;
    }

    const parts = selectedModel.split(':');
    if (parts.length < 2) {
      new Notice('모델 설정 형식이 잘못되었습니다.');
      return;
    }

    const key = parts[0] as ProviderKey;
    const modelName = parts.slice(1).join(':');
    const config = this.plugin.settings[key];
    const providerLabel = PROVIDER_LABELS[key];

    if (!config?.enabled) {
      new Notice('활성화된 LLM Provider가 없습니다. 설정에서 Provider를 활성화하세요.');
      return;
    }

    const provider = createProvider(key, config, modelName);
    if (!provider) {
      new Notice('Provider 생성에 실패했습니다.');
      return;
    }

    this.inputArea!.value = '';
    this.autoResizeInput();
    this.renderContextPreview('');
    const promptContext = await this.buildPromptContext(text);
    this.addMessage('user', text, undefined, undefined, {
      providerKey: key,
      providerLabel,
      model: modelName,
      status: 'complete',
      contextAttachments: promptContext.attachments,
    });
    await this.saveCurrentSession(true);
    this.setLoading(true);

    if (this.typingIndicator) this.typingIndicator.style.display = 'flex';

    let assistantId = '';
    let assistantWrapper: HTMLElement | undefined;
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const systemPrompt = promptContext.systemPrompt;
      const mentionedServers = this.getMentionedServerNames(text);
      const toolDefinitions: ToolDefinition[] = [];
      for (const serverName of mentionedServers) {
        const client = this.plugin.mcpRegistry?.getClient(serverName);
        if (!client) continue;
        try {
          const tools = await client.listTools();
          for (const tool of tools) {
            toolDefinitions.push({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description ?? '',
                parameters: (tool.inputSchema as Record<string, unknown>) ?? {
                  type: 'object',
                  properties: {},
                },
              },
            });
          }
        } catch {
          // ignore
        }
      }
      const messages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...this.messages.slice(-10).map((m) => this.toProviderMessage(m)),
      ];

      assistantId = this.addMessage('assistant', '', undefined, undefined, {
        providerKey: key,
        providerLabel,
        model: modelName,
        status: 'streaming',
        citations: promptContext.citations,
        contextAttachments: promptContext.attachments,
      });
      assistantWrapper = this.messageEls.get(assistantId);
      if (assistantWrapper) {
        assistantWrapper.classList.add('generating');
      }

      let fullText = '';
      let fullReasoning = '';
      let hasReceivedContent = false;
      const toolCallMap = new Map<number, ToolCallRecord>();
      await provider.streamChat(
        messages,
        (chunk: StreamChunk) => {
          if (chunk.content) {
            fullText += chunk.content;
          }
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning;
          }
          if (chunk.toolCalls) {
            this.mergeToolCallDeltas(toolCallMap, chunk.toolCalls);
          }

          if (!hasReceivedContent && (fullText || fullReasoning)) {
            hasReceivedContent = true;
            if (this.typingIndicator) this.typingIndicator.style.display = 'none';
          }

          this.updateMessage(
            assistantId,
            fullText,
            chunk.done,
            fullReasoning || undefined,
            Array.from(toolCallMap.values()),
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              status: chunk.done ? 'complete' : 'streaming',
              citations: promptContext.citations,
              contextAttachments: promptContext.attachments,
            },
          );
        },
        0.7,
        toolDefinitions,
        { signal: abortController.signal },
      );
      if (this.typingIndicator) this.typingIndicator.style.display = 'none';
      const parsedToolCalls = this.parseInlineToolRequests(fullText);
      if (parsedToolCalls.length > 0) {
        fullText = this.stripInlineToolRequests(fullText);
        const baseToolCallIndex = toolCallMap.size;
        parsedToolCalls.forEach((toolCall, index) =>
          toolCallMap.set(baseToolCallIndex + index, toolCall),
        );
      }

      let toolCalls = Array.from(toolCallMap.values());
      this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
        providerKey: key,
        providerLabel,
        model: modelName,
        status: 'complete',
        citations: promptContext.citations,
        contextAttachments: promptContext.attachments,
        stopReason: abortController.signal.aborted ? 'cancelled' : 'complete',
      });

      const runnableToolCalls = toolCalls.filter((toolCall) => toolCall.status === 'running');
      if (runnableToolCalls.length > 0) {
        if (this.toolExecutionPolicy.manualApproval) {
          const approvalToolCalls = toolCalls.map((toolCall) =>
            toolCall.status === 'running' ? { ...toolCall, approved: false } : toolCall,
          );
          this.updateMessage(
            assistantId,
            fullText,
            true,
            fullReasoning || undefined,
            approvalToolCalls,
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              status: 'complete',
              citations: promptContext.citations,
              contextAttachments: promptContext.attachments,
            },
          );
          new Notice('MCP 툴 실행은 메시지의 “실행 승인” 버튼을 눌러 진행하세요.');
          return;
        }
        toolCalls = await this.executeAssistantToolCalls(
          assistantId,
          toolCalls,
          this.getMentionedServerNames(text),
          fullReasoning || undefined,
        );
        const successfulToolCalls = toolCalls.filter(
          (toolCall) => toolCall.status === 'success' && toolCall.result,
        );
        if (successfulToolCalls.length > 0) {
          fullText = '';
          fullReasoning = '';
          const assistantMsg = this.messages.find((m) => m.id === assistantId);
          const toolCallsPayload = (assistantMsg?.toolCalls ?? []).map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
          const secondMessages: ChatMessage[] = [
            ...messages,
            {
              role: 'assistant',
              content: assistantMsg?.content ?? '',
              toolCalls: toolCallsPayload,
            },
            ...successfulToolCalls.map((tc) => ({
              role: 'tool' as const,
              content: tc.result ?? '',
              tool_call_id: tc.id,
              name: tc.name,
            })),
          ];
          // Ollama 등 툴 호출 후속 응답에서도 tools 전달 필요
          await provider.streamChat(
            secondMessages,
            (chunk: StreamChunk) => {
              if (chunk.content) {
                fullText += chunk.content;
              }
              if (chunk.reasoning) {
                fullReasoning += chunk.reasoning;
              }
              this.updateMessage(
                assistantId,
                fullText,
                chunk.done,
                fullReasoning || undefined,
                toolCalls,
                {
                  providerKey: key,
                  providerLabel,
                  model: modelName,
                  status: chunk.done ? 'complete' : 'streaming',
                  citations: promptContext.citations,
                  contextAttachments: promptContext.attachments,
                },
              );
            },
            0.7,
            toolDefinitions,
            { signal: abortController.signal },
          );
          this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
            providerKey: key,
            providerLabel,
            model: modelName,
            status: 'complete',
            citations: promptContext.citations,
            contextAttachments: promptContext.attachments,
          });
        }
      }
      if (assistantWrapper) {
        assistantWrapper.classList.remove('generating');
        const generatingLabel = assistantWrapper.querySelector(
          '.super-obsidian-chat-generating-label',
        );
        if (generatingLabel instanceof HTMLElement) {
          generatingLabel.remove();
        }
      }
    } catch (err) {
      if (this.typingIndicator) this.typingIndicator.style.display = 'none';
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (assistantId) {
          const assistantMsg = this.messages.find((message) => message.id === assistantId);
          this.updateMessage(
            assistantId,
            assistantMsg?.content || '응답 생성이 중단되었습니다.',
            true,
            assistantMsg?.reasoning,
            assistantMsg?.toolCalls,
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              status: 'complete',
              citations: promptContext.citations,
              contextAttachments: promptContext.attachments,
              stopReason: 'cancelled',
            },
          );
        }
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (assistantId) {
        const errDetail = this.formatErrorDetail(key, modelName, errorMsg);
        this.updateMessage(assistantId, `LLM API 오류: ${errDetail}`, true, undefined, undefined, {
          providerKey: key,
          providerLabel,
          model: modelName,
          status: 'error',
          errorMessage: errDetail,
          citations: promptContext.citations,
          contextAttachments: promptContext.attachments,
          stopReason: 'error',
        });
        if (assistantWrapper) {
          assistantWrapper.classList.remove('generating');
          const generatingLabel = assistantWrapper.querySelector(
            '.super-obsidian-chat-generating-label',
          );
          if (generatingLabel instanceof HTMLElement) {
            generatingLabel.remove();
          }
        }
      } else {
        const errDetail = this.formatErrorDetail(key, modelName, errorMsg);
        this.addMessage('assistant', `LLM API 오류: ${errDetail}`, undefined, undefined, {
          providerKey: key,
          providerLabel,
          model: modelName,
          status: 'error',
          errorMessage: errDetail,
        });
      }
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
      await this.saveCurrentSession(true);
      this.setLoading(false);
    }
  }

  private setLoading(loading: boolean): void {
    this.isStreaming = loading;
    if (this.sendBtn) {
      this.sendBtn.disabled = false;
      this.sendBtn.setText(loading ? '중단' : t('sendButton'));
    }
    if (this.inputArea) this.inputArea.disabled = loading;
    if (this.mcpBtn) this.mcpBtn.disabled = loading;
    if (this.modelSelectEl) this.modelSelectEl.disabled = loading;
  }

  private toProviderMessage(message: ChatMessageWithMeta): ChatMessage {
    const providerMessage: ChatMessage = {
      role: message.role,
      content: message.content,
      ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    };
    if (message.toolCalls && message.toolCalls.length > 0) {
      providerMessage.toolCalls = message.toolCalls.map((toolCall): ToolCallInfo => {
        return {
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        };
      });
    }
    if (message.role === 'tool' && message.toolCalls && message.toolCalls.length > 0) {
      providerMessage.tool_call_id = message.toolCalls[0].id;
    }
    if (message.role === 'tool') {
      providerMessage.name = message.toolCalls?.[0]?.name;
    }
    return providerMessage;
  }

  private mergeToolCallDeltas(
    toolCallMap: Map<number, ToolCallRecord>,
    deltas: ToolCallDelta[],
  ): void {
    for (const toolCallDelta of deltas) {
      const existing = toolCallMap.get(toolCallDelta.index);
      if (existing) {
        if (toolCallDelta.id) existing.id = toolCallDelta.id;
        if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name;
        if (toolCallDelta.function?.arguments)
          existing.arguments += toolCallDelta.function.arguments;
      } else {
        toolCallMap.set(toolCallDelta.index, {
          id: toolCallDelta.id ?? '',
          name: toolCallDelta.function?.name ?? '',
          arguments: toolCallDelta.function?.arguments ?? '',
          status: 'running',
        });
      }
    }
  }

  private parseInlineToolRequests(content: string): ToolCallRecord[] {
    const snippets =
      content.match(
        /<function_requests[\s\S]*?<\/function_requests>|<function_calls[\s\S]*?<\/function_calls>/g,
      ) ?? [];
    const toolCalls: ToolCallRecord[] = [];

    for (const snippet of snippets) {
      const doc = new DOMParser().parseFromString(`<root>${snippet}</root>`, 'application/xml');
      if (doc.querySelector('parsererror')) continue;

      for (const request of Array.from(doc.querySelectorAll('function_request'))) {
        const name = request.getAttribute('name')?.trim();
        if (!name) continue;
        const parameters = request.querySelector('parameters');
        const args = parameters ? this.readXmlParameters(parameters) : {};
        toolCalls.push({
          id: `xml-tool-${Date.now()}-${toolCalls.length}`,
          name,
          arguments: JSON.stringify(args),
          status: 'running',
        });
      }

      for (const invoke of Array.from(doc.querySelectorAll('invoke'))) {
        const name = invoke.getAttribute('name')?.trim();
        if (!name) continue;
        toolCalls.push({
          id: `xml-tool-${Date.now()}-${toolCalls.length}`,
          name,
          arguments: JSON.stringify(this.readXmlParameters(invoke)),
          status: 'running',
        });
      }
    }

    return toolCalls;
  }

  private readXmlParameters(container: Element): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const child of Array.from(container.children)) {
      const key = child.getAttribute('name')?.trim() || child.tagName;
      if (!key) continue;
      args[key] = this.parseToolScalar(child.textContent?.trim() ?? '');
    }
    return args;
  }

  private parseToolScalar(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }
    return value;
  }

  private stripInlineToolRequests(content: string): string {
    return content
      .replace(
        /<function_requests[\s\S]*?<\/function_requests>|<function_calls[\s\S]*?<\/function_calls>/g,
        '',
      )
      .trim();
  }

  private getMentionedServerNames(text: string): string[] {
    return this.parseMentions(text)
      .filter((mention) => mention.type === 'server')
      .map((mention) => mention.name);
  }

  private async executeAssistantToolCalls(
    messageId: string,
    toolCalls: ToolCallRecord[],
    preferredServerNames: string[],
    reasoning?: string,
  ): Promise<ToolCallRecord[]> {
    const updatedToolCalls = toolCalls.map((toolCall) => ({ ...toolCall }));
    this.updateMessage(
      messageId,
      this.messages.find((m) => m.id === messageId)?.content ?? '',
      false,
      reasoning,
      updatedToolCalls,
    );

    for (const toolCall of updatedToolCalls) {
      if (this.toolExecutionPolicy.manualApproval && toolCall.approved !== true) {
        continue;
      }
      const serverName = await this.findServerForTool(toolCall.name, preferredServerNames);
      if (!serverName) {
        toolCall.status = 'error';
        toolCall.result = `연결된 MCP 서버에서 \`${toolCall.name}\` 도구를 찾을 수 없습니다.`;
        this.updateMessage(
          messageId,
          this.messages.find((m) => m.id === messageId)?.content ?? '',
          false,
          reasoning,
          updatedToolCalls,
        );
        continue;
      }

      const registry = this.plugin.mcpRegistry;
      const client = registry?.getClient(serverName);
      if (!client) {
        toolCall.status = 'error';
        toolCall.result = `MCP 서버 \`${serverName}\`에 연결되어 있지 않습니다.`;
        this.updateMessage(
          messageId,
          this.messages.find((m) => m.id === messageId)?.content ?? '',
          false,
          reasoning,
          updatedToolCalls,
        );
        continue;
      }
      toolCall.serverName = serverName;

      try {
        const result = await client.callTool(
          toolCall.name,
          this.parseToolArguments(toolCall.arguments),
        );
        const isErrorResult =
          typeof result === 'object' &&
          result !== null &&
          'isError' in result &&
          (result as Record<string, unknown>).isError === true;
        toolCall.result = this.formatToolResult(result);
        toolCall.status = isErrorResult ? 'error' : 'success';
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        toolCall.result = `[MCP 도구 오류] ${this.normalizeToolError(rawMsg)}`;
        toolCall.status = 'error';
      }

      this.updateMessage(
        messageId,
        this.messages.find((m) => m.id === messageId)?.content ?? '',
        false,
        reasoning,
        updatedToolCalls,
      );
    }

    this.updateMessage(
      messageId,
      this.messages.find((m) => m.id === messageId)?.content ?? '',
      true,
      reasoning,
      updatedToolCalls,
    );
    return updatedToolCalls;
  }

  private async approveToolCall(messageId: string, toolCallId: string): Promise<void> {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message?.toolCalls) return;
    const toolCalls = message.toolCalls.map((toolCall) =>
      toolCall.id === toolCallId || toolCall.name === toolCallId
        ? { ...toolCall, approved: true }
        : { ...toolCall },
    );
    this.updateMessage(messageId, message.content, false, message.reasoning, toolCalls);
    const updated = await this.executeAssistantToolCalls(
      messageId,
      toolCalls,
      this.getMentionedServerNames(this.lastUserPrompt ?? ''),
      message.reasoning,
    );
    const stopReason = updated.some((toolCall) => toolCall.status === 'error')
      ? 'tool-failed'
      : 'complete';
    const latestMessage = this.messages.find((m) => m.id === messageId);
    this.updateMessage(
      messageId,
      latestMessage?.content ?? message.content,
      true,
      latestMessage?.reasoning ?? message.reasoning,
      updated,
      { stopReason },
    );
    await this.saveCurrentSession(true);
  }

  private async findServerForTool(
    toolName: string,
    preferredServerNames: string[],
  ): Promise<string | null> {
    const registry = this.plugin.mcpRegistry;
    if (!registry) return null;

    const preferred = preferredServerNames.filter(
      (serverName) => registry.getConnectionStatus(serverName) === 'connected',
    );
    const fallback = registry
      .getEnabledServers()
      .map((server) => server.name)
      .filter(
        (serverName) =>
          registry.getConnectionStatus(serverName) === 'connected' &&
          !preferred.includes(serverName),
      );

    for (const serverName of [...preferred, ...fallback]) {
      const client = registry.getClient(serverName);
      if (!client) continue;
      try {
        const tools = await client.listTools();
        if (tools.some((tool) => tool.name === toolName)) {
          return serverName;
        }
      } catch {
        // 연결이 불안정한 서버는 다음 후보로 넘어갑니다.
      }
    }

    return null;
  }

  private parseToolArguments(argumentsText: string): Record<string, unknown> {
    const trimmed = argumentsText.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { input: parsed };
    } catch {
      return { input: trimmed };
    }
  }

  private async buildPromptContext(lastUserText: string): Promise<ContextBuildResult> {
    const parts: string[] = [];
    const globalPrompt = this.plugin.settings.chat.systemPrompt?.trim();
    const sessionPrompt = this.sessionSystemPrompt ?? globalPrompt;
    if (sessionPrompt) parts.push(sessionPrompt);

    if (this.plugin.settings.pluginAwareEnabled) {
      const { formatActivePluginsForPrompt } = await import('../utils/obsidian-compat');
      const pluginInfo = formatActivePluginsForPrompt(this.app);
      if (pluginInfo) parts.push(pluginInfo);
    }

    const ragEngine = (
      this.plugin as unknown as {
        ragEngine?: RagQueryLike | null;
      }
    ).ragEngine;
    const context = await buildChatContext(lastUserText, {
      app: this.app,
      ragEngine,
      mcpRegistry: this.plugin.mcpRegistry,
    });
    if (context.systemPrompt) parts.push(context.systemPrompt);

    return {
      ...context,
      systemPrompt: parts.length > 0 ? parts.join('\n') : null,
    };
  }

  private parseMentions(text: string): ParsedMention[] {
    return parseContextMentions(text, createAppMentionResolver(this.app, this.plugin.mcpRegistry));
  }
  private async openMcpToolPicker(): Promise<void> {
    const registry = this.plugin.mcpRegistry;
    if (!registry || registry.getConnectedCount() === 0) {
      new Notice(t('noToolsAvailable'));
      return;
    }

    const overlay = this.container!.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'super-obsidian-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-title',
      text: t('selectTool'),
    });
    const closeBtn = title.createEl('button', {
      cls: 'super-obsidian-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const list = panel.createDiv({ cls: 'super-obsidian-mcp-tool-list' });

    for (const server of registry.getEnabledServers()) {
      const client = registry.getClient(server.name);
      if (!client) continue;
      try {
        const tools = await client.listTools();
        if (tools.length === 0) continue;
        list.createDiv({
          cls: 'super-obsidian-mcp-tool-server',
          text: server.name,
        });
        for (const tool of tools) {
          const item = list.createDiv({ cls: 'super-obsidian-mcp-tool-item' });
          item.createDiv({ cls: 'super-obsidian-mcp-tool-name', text: tool.name });
          if (tool.description) {
            item.createDiv({
              cls: 'super-obsidian-mcp-tool-desc',
              text: tool.description,
            });
          }
          item.addEventListener('click', () => {
            close();
            void this.openMcpToolForm(server.name, tool.name, tool.inputSchema ?? {});
          });
        }
      } catch {
        // 서버 스킵
      }
    }

    if (list.children.length === 0) {
      list.createDiv({
        cls: 'super-obsidian-mcp-empty-state-desc',
        text: t('noToolsAvailable'),
      });
    }
  }

  private openMcpToolForm(
    serverName: string,
    toolName: string,
    inputSchema: Record<string, unknown>,
  ): void {
    const overlay = this.container!.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'super-obsidian-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-title',
      text: toolName,
    });
    const closeBtn = title.createEl('button', {
      cls: 'super-obsidian-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const form = panel.createDiv({ cls: 'super-obsidian-mcp-tool-form' });
    const inputs: {
      key: string;
      el: HTMLInputElement | HTMLTextAreaElement;
      def: {
        type?: string;
        description?: string;
        pattern?: string;
        minimum?: number;
        maximum?: number;
      };
      required: boolean;
    }[] = [];

    const schema = inputSchema as {
      properties?: Record<
        string,
        {
          type?: string;
          description?: string;
          pattern?: string;
          minimum?: number;
          maximum?: number;
        }
      >;
      required?: string[];
    };
    const properties = schema.properties ?? {};
    const requiredSet = new Set(schema.required ?? []);

    for (const [propName, propDef] of Object.entries(properties)) {
      const row = form.createDiv({ cls: 'super-obsidian-mcp-tool-form-row' });
      row.createEl('label', {
        cls: 'super-obsidian-mcp-tool-form-label',
        text: propName,
      });
      if (propDef.description) {
        row.createDiv({
          cls: 'super-obsidian-mcp-tool-form-desc',
          text: propDef.description,
        });
      }

      let inputEl: HTMLInputElement | HTMLTextAreaElement;
      const type = propDef.type ?? 'string';
      if (type === 'boolean') {
        inputEl = row.createEl('input', {
          type: 'checkbox',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else if (type === 'number' || type === 'integer') {
        inputEl = row.createEl('input', {
          type: 'number',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else if (type === 'string') {
        inputEl = row.createEl('input', {
          type: 'text',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else {
        inputEl = row.createEl('textarea', {
          cls: 'super-obsidian-mcp-tool-form-input',
          attr: { rows: '3' },
        });
      }
      if (requiredSet.has(propName)) {
        inputEl.required = true;
      }
      inputs.push({
        key: propName,
        el: inputEl,
        def: propDef,
        required: requiredSet.has(propName),
      });
    }

    const actions = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-form-actions',
    });
    const execBtn = actions.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: t('executeTool'),
    });
    execBtn.addEventListener('click', () => {
      const values: Record<string, unknown> = {};
      const validationErrors: string[] = [];

      for (const { key, el, def, required } of inputs) {
        if (el.type === 'checkbox') {
          values[key] = (el as HTMLInputElement).checked;
        } else if (el.type === 'number') {
          const numVal = parseFloat(el.value);
          if (Number.isNaN(numVal)) {
            if (required) {
              validationErrors.push(
                t('mcpToolInvalidField', { field: key, detail: '숫자 값이 필요합니다.' }),
              );
              continue;
            }
            continue;
          }
          if (def.minimum !== undefined && numVal < def.minimum) {
            validationErrors.push(
              t('mcpToolInvalidField', {
                field: key,
                detail: `최소값 ${def.minimum} 이상이어야 합니다.`,
              }),
            );
            continue;
          }
          if (def.maximum !== undefined && numVal > def.maximum) {
            validationErrors.push(
              t('mcpToolInvalidField', {
                field: key,
                detail: `최대값 ${def.maximum} 이하여야 합니다.`,
              }),
            );
            continue;
          }
          values[key] = numVal;
        } else {
          const trimmed = el.value.trim();
          if (required && trimmed === '') {
            validationErrors.push(
              t('mcpToolInvalidField', { field: key, detail: '필수 입력값입니다.' }),
            );
            continue;
          }
          if (trimmed === '' && !required) {
            continue;
          }
          if (def.pattern && trimmed !== '') {
            try {
              const regex = new RegExp(def.pattern);
              if (!regex.test(trimmed)) {
                validationErrors.push(
                  t('mcpToolInvalidField', {
                    field: key,
                    detail: `형식이 올바르지 않습니다. (패턴: ${def.pattern})`,
                  }),
                );
                continue;
              }
            } catch {
              // 잘못된 regex 패턴은 무시
            }
          }
          try {
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              values[key] = JSON.parse(trimmed);
            } else {
              values[key] = trimmed;
            }
          } catch {
            values[key] = trimmed;
          }
        }
      }

      if (validationErrors.length > 0) {
        new Notice(t('mcpToolValidationError') + '\n' + validationErrors.join('\n'), 8000);
        return;
      }

      close();
      void this.executeMcpTool(serverName, toolName, values);
    });
  }

  private async executeMcpTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    messageId?: string,
  ): Promise<void> {
    const registry = this.plugin.mcpRegistry;
    if (!registry) return;
    const client = registry.getClient(serverName);
    if (!client) return;

    let runId: string | null = null;
    if (messageId) {
      this.updateToolCallInMessage(messageId, toolName, {
        arguments: JSON.stringify(args),
        status: 'running',
      });
    } else {
      runId = this.addMessage('tool', `${t('mcpToolRunning')} ${toolName}...`);
    }

    try {
      const result = await client.callTool(toolName, args);
      const formatted = this.formatToolResult(result);
      if (messageId) {
        this.updateToolCallInMessage(messageId, toolName, {
          result: formatted,
          status: 'success',
        });
      } else if (runId) {
        this.updateMessage(runId, `**${t('mcpToolSuccess')} — ${toolName}**\n\n${formatted}`, true);
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const friendlyMsg = this.normalizeToolError(rawMsg);
      if (messageId) {
        this.updateToolCallInMessage(messageId, toolName, {
          result: friendlyMsg,
          status: 'error',
        });
      } else if (runId) {
        this.updateMessage(runId, `**${t('mcpToolError')} — ${toolName}**\n\n${friendlyMsg}`, true);
      }
    }
  }

  private updateToolCallInMessage(
    messageId: string,
    toolName: string,
    patch: Partial<ToolCallRecord>,
  ): void {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) return;
    const toolCalls = message.toolCalls ?? [];
    const existing = toolCalls.find((toolCall) => toolCall.name === toolName);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      toolCalls.push({
        id: patch.id ?? '',
        name: patch.name ?? toolName,
        arguments: patch.arguments ?? '',
        result: patch.result,
        status: patch.status ?? 'running',
      });
    }
    message.toolCalls = toolCalls;
    this.updateMessage(
      messageId,
      message.content,
      true,
      message.reasoning,
      toolCalls.map((toolCall) => ({ ...toolCall })),
    );
  }

  private normalizeToolError(rawMsg: string): string {
    if (rawMsg.includes('Input validation error')) {
      const match = rawMsg.match(/does not match '(.+?)'/);
      if (match) {
        return `입력값의 형식이 올바르지 않습니다. 요구되는 패턴: \`${match[1]}\``;
      }
      const fieldMatch = rawMsg.match(/'([^']+)'/);
      if (fieldMatch) {
        return `필드 \`${fieldMatch[1]}\`의 입력값이 잘못되었습니다.`;
      }
      return '입력값이 스키마 검증을 통과하지 못했습니다. 필수 필드와 값의 형식을 확인해주세요.';
    }
    if (rawMsg.includes('required')) {
      return '필수 입력값이 누락되었습니다. 모든 필수 필드를 채워주세요.';
    }
    return rawMsg;
  }

  /** LLM API 에러 발생 시 진단 정보를 포함한 상세 메시지 생성 */
  private formatErrorDetail(providerKey: string, model: string, rawError: string): string {
    const timestamp = new Date().toISOString();
    const statusMatch = rawError.match(/status\s*(\d{3})/);
    const statusCode = statusMatch ? statusMatch[1] : '???';

    const providerHints: Record<number, string> = {
      400: '요청 형식이 잘못되었습니다. 입력값이나 파라미터를 확인하세요.',
      401: 'API 키가 유효하지 않거나 만료되었습니다.',
      402: '잔액이 부족합니다. 결제 수단을 확인하세요.',
      403: '접근이 거부되었습니다. API 키 권한을 확인하세요.',
      404: '요청한 모델/엔드포인트를 찾을 수 없습니다.',
      429: '요청 횟수 제한을 초과했습니다. 잠시 후 다시 시도하세요.',
      500: '서버 내부 오류입니다. 잠시 후 다시 시도하세요.',
      502: '게이트웨이 오류입니다. 서버가 일시적으로 불안정합니다.',
      503: '서비스가 일시적으로 사용 불가능합니다.',
    };

    const hint = statusCode !== '???' ? (providerHints[Number(statusCode)] ?? '') : '';
    const detail = [
      `[${timestamp}] ${providerKey}/${model}`,
      `오류 코드: ${statusCode}`,
      ...(hint ? [`원인 추정: ${hint}`] : []),
      `원본: ${rawError}`,
    ];
    return detail.join('\n');
  }

  private formatToolResult(result: unknown): string {
    if (result === null) return 'null';
    if (typeof result === 'string') return this.truncateIfNeeded(result);
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);
    if (
      typeof result === 'object' &&
      result !== null &&
      'isError' in result &&
      (result as Record<string, unknown>).isError === true
    ) {
      const r = result as Record<string, unknown>;
      const content = r.content;
      if (Array.isArray(content)) {
        const text = content
          .filter(
            (item: unknown): item is Record<string, string> =>
              typeof item === 'object' && item !== null && 'type' in item && item.type === 'text',
          )
          .map((item) => item.text)
          .join('\n');
        return `[MCP 도구 오류]\n${this.truncateIfNeeded(text)}`;
      }
      return `[MCP 도구 오류]\n${this.truncateIfNeeded(JSON.stringify(result, null, 2))}`;
    }
    return this.formatStructuredResult(result);
  }

  /** 결과 문자열이 MAX_TOOL_RESULT_SIZE를 초과하면 요약으로 대체 */
  private truncateIfNeeded(text: string): string {
    if (text.length <= ChatView.MAX_TOOL_RESULT_SIZE) return text;
    const max = ChatView.MAX_TOOL_RESULT_SIZE;
    const byteSize = new TextEncoder().encode(text).length;
    return `[결과가 너무 커서 생략되었습니다 — ${(byteSize / 1024).toFixed(1)} KB]\n\n${text.slice(0, max)}…`;
  }

  /** 구조화된 결과(검색, API 응답 등)를 요약 압축 */
  private formatStructuredResult(result: unknown): string {
    const full = JSON.stringify(result, null, 2);
    if (full.length <= ChatView.MAX_TOOL_RESULT_SIZE) {
      return '```json\n' + full + '\n```';
    }

    // 검색 엔진 응답인 경우 요약
    const obj = result as Record<string, unknown>;
    if (obj.organic && Array.isArray(obj.organic)) {
      return this.summarizeSearchResult(obj);
    }
    if (obj.content && Array.isArray(obj.content)) {
      // content[{type:"text", text:"{\"organic\":[...]}"}] 형태 처리
      for (const item of obj.content) {
        if (
          typeof item === 'object' &&
          item !== null &&
          (item as Record<string, unknown>).type === 'text'
        ) {
          const inner = (item as Record<string, unknown>).text as string;
          if (inner && inner.length > 200) {
            try {
              const parsed = JSON.parse(inner) as Record<string, unknown>;
              if (parsed.organic && Array.isArray(parsed.organic)) {
                return this.summarizeSearchResult(parsed);
              }
            } catch {
              // 파싱 실패 시 truncate
            }
          }
        }
      }
    }

    // 일반 객체: 크기 제한 적용
    const max = ChatView.MAX_TOOL_RESULT_SIZE;
    const byteSize = new TextEncoder().encode(full).length;
    return `[결과가 너무 커서 생략되었습니다 — ${(byteSize / 1024).toFixed(1)} KB]\n\n\`\`\`json\n${full.slice(0, max)}…\n\`\`\``;
  }

  /** 검색 결과를 3개 스니펫 + 총 건수로 요약 */
  private summarizeSearchResult(obj: Record<string, unknown>): string {
    const organic = obj.organic as Array<{ title?: string; snippet?: string; link?: string }>;
    const total = organic.length;
    const lines: string[] = [`**검색 결과 요약** (총 ${total}건)`];

    const top3 = organic.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      const item = top3[i];
      const title = item.title ?? '(제목 없음)';
      const snippet = (item.snippet ?? '').slice(0, 200);
      const link = item.link ?? '';
      lines.push(
        `${i + 1}. **${title.replace(/\|/g, '\\\\|')}** — ${snippet.replace(/\|/g, '\\\\|').replace(/\n/g, ' ')}`,
      );
      if (link) lines.push(`   → ${link}`);
    }

    if (total > 3) {
      lines.push(`\n… 외 ${total - 3}건 생략`);
    }

    return lines.join('\n');
  }

  private renderToolBubble(
    bubble: HTMLElement,
    content: string,
    status: 'running' | 'success' | 'error',
  ): void {
    bubble.empty();

    // Content formats (i18n):
    //   Running:  "툴 실행 중... {toolName}..." / "Running tool... {toolName}..."
    //   Success: "**툴 실행 성공 — toolName**\n\n{formatted}" / "**Tool executed successfully — toolName**\n\n{formatted}"
    //   Error:    "**툴 실행 실패 — toolName**\n\n{friendlyMsg}" / "**Tool execution failed — toolName**\n\n{friendlyMsg}"

    let toolName = '';
    let resultText = '';

    const runningMatch = content.match(/(?:툴 실행 중|Running tool)\s*\.{0,3}\s*(.+)/);
    const successMatch = content.match(
      /\*\*(?:툴 실행 성공|Tool executed successfully)\s*[—–]\s*(.+?)\*\*\s*\n+([\s\S]*)/,
    );
    const errorMatch = content.match(
      /\*\*(?:툴 실행 실패|Tool execution failed)\s*[—–]\s*(.+?)\*\*\s*\n+([\s\S]*)/,
    );

    if (runningMatch) {
      toolName = runningMatch[1].replace(/\.\.\.+$/, '').trim();
    } else if (successMatch) {
      toolName = successMatch[1].trim();
      resultText = successMatch[2].trim();
      status = 'success';
    } else if (errorMatch) {
      toolName = errorMatch[1].trim();
      resultText = errorMatch[2].trim();
      status = 'error';
    } else {
      toolName = content.length > 40 ? content.slice(0, 40) + '…' : content;
      resultText = content;
    }

    const callRow = bubble.createDiv({ cls: 'super-obsidian-tool-call' });
    callRow.createSpan({ cls: 'super-obsidian-tool-call-icon', text: '🔧' });
    callRow.createSpan({
      cls: 'super-obsidian-tool-call-name',
      text: toolName || t('messageTool'),
    });
    const statusBadge = callRow.createSpan({
      cls: `super-obsidian-tool-call-status ${status}`,
    });
    if (status === 'running') {
      statusBadge.setText('');
      const dots = statusBadge.createSpan({ cls: 'super-obsidian-tool-running-dots' });
      dots.createSpan({});
      dots.createSpan({});
      dots.createSpan({});
    } else if (status === 'success') {
      statusBadge.setText('✓');
    } else if (status === 'error') {
      statusBadge.setText('✗');
    }

    const resultArea = bubble.createDiv({ cls: 'super-obsidian-tool-result' });
    if (resultText && status !== 'running') {
      void this.renderMarkdownBubble(resultArea, resultText);
    }

    if (resultText && status !== 'running') {
      const toggle = bubble.createDiv({ cls: 'super-obsidian-tool-result-toggle collapsed' });
      toggle.createSpan({ cls: 'super-obsidian-tool-result-toggle-chevron', text: '▾' });
      toggle.createSpan({ text: t('toolResult') });
      toggle.addEventListener('click', () => {
        const isCollapsed = resultArea.classList.contains('collapsed');
        if (isCollapsed) {
          resultArea.classList.remove('collapsed');
          toggle.classList.remove('collapsed');
        } else {
          resultArea.classList.add('collapsed');
          toggle.classList.add('collapsed');
        }
      });
      resultArea.classList.add('collapsed');
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
