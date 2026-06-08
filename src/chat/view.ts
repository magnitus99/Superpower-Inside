import { ItemView, WorkspaceLeaf, Notice, TFile, type Events } from 'obsidian';
import {
  CHAT_PROVIDER_KEYS,
  PROVIDER_LABELS,
  type PluginLike,
  type ProviderKey,
} from '../settings';
import type {
  ChatMessage,
  LLMProvider,
  StreamChunk,
  ToolCallInfo,
  ToolCallDelta,
  ToolDefinition,
} from '../llm/providers';
import { normalizeReasoningChunk } from '../llm/reasoning';
import type {
  AssistantQuestion,
  ChatMessageWithMeta,
  SessionState,
  SourceValidationWarning,
  ToolCallRecord,
} from './types';
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
import { normalizeToolResult } from './mcp-tools';
import { executeMcpToolCalls, prepareToolCallsForExecution } from './mcp-tool-execution';
import { openPromptLibraryModal } from './prompt-library-modal';
import { getEffectiveSystemPrompt } from './prompt-library';
import { getPluginAwareServerNames } from './plugin-aware-context7';
import { validateAnswerSources } from './source-validation';
import { classifyAssistantResponse } from './assistant-response-classifier';
import { formatAssistantQuestionAnswer } from './assistant-question';
import { enhanceCodeBlocks, renderMarkdownToElement } from './markdown';
import { t } from '../i18n';
import { RefreshAction } from '../utils/refresh-action';
import { EditMessageModal } from './edit-modal';
import { MCP_STATUS_CHANGE_EVENT } from '../mcp/connection-state';

export const CHAT_VIEW_TYPE = 'superpower-inside-chat';
const HIDDEN_CLASS = 'superpower-inside-hidden';
const MENTION_TOP_VAR = '--superpower-inside-mention-top';
const MENTION_BOTTOM_VAR = '--superpower-inside-mention-bottom';
const CHAT_INPUT_HEIGHT_VAR = '--superpower-inside-chat-input-height';

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.toggleClass(HIDDEN_CLASS, hidden);
}

function renderPlainTextWithBreaks(container: HTMLElement, text: string): void {
  container.empty();
  const doc = container.ownerDocument;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) {
      container.createEl('br');
    }
    container.appendChild(doc.createTextNode(line));
  });
}

interface MessageMetaInput {
  providerKey?: ChatMessageWithMeta['providerKey'];
  providerLabel?: string;
  model?: string;
  status?: ChatMessageWithMeta['status'];
  errorMessage?: string;
  citations?: SourceCitation[];
  sourceWarnings?: SourceValidationWarning[];
  contextAttachments?: ContextAttachment[];
  assistantQuestion?: AssistantQuestion;
  branchOf?: string;
  stopReason?: ChatMessageWithMeta['stopReason'];
  originalContent?: string;
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
  private previousUserQueries: string[];

  // RefreshAction 인스턴스
  private mcpRefreshAction: RefreshAction | null = null;
  // RefreshBus 구독 해제 함수들
  private refreshBusUnsubscribers: (() => void)[] = [];

  private messageEls: Map<string, HTMLElement>;

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
    this.previousUserQueries = [];
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
    root.addClass('superpower-inside-chat-container');
    this.container = root;

    this.buildHeader(root);
    this.buildMcpStatusBar(root);

    this.messagesArea = root.createDiv({ cls: 'superpower-inside-chat-messages' });
    this.messagesArea.addEventListener('scroll', () => this.handleScroll());

    this.scrollBtn = root.createDiv({ cls: 'superpower-inside-scroll-to-bottom' });
    setHidden(this.scrollBtn, true);
    this.scrollBtn.setText(t('chatScrollToBottom'));
    this.scrollBtn.addEventListener('click', () => this.scrollToBottom());

    this.typingIndicator = this.messagesArea.createDiv({
      cls: 'superpower-inside-typing-indicator',
    });
    setHidden(this.typingIndicator, true);
    for (let i = 0; i < 3; i++) {
      this.typingIndicator.createSpan({ cls: 'superpower-inside-typing-dot' });
    }
    this.typingIndicator.createSpan({
      cls: 'superpower-inside-typing-text',
      text: t('chatTyping'),
    });

    this.buildInputArea(root);
    this.registerMcpStatusEvents();
    this.registerSessionFileEvents();
    this.registerRefreshBusEvents();
  }

  private registerRefreshBusEvents(): void {
    const pluginWithBus = this.plugin as unknown as {
      refreshBus?: {
        on: (
          domain: string,
          handler: (result: { status: string; detail?: string }) => void,
        ) => () => void;
      };
    };
    if (!pluginWithBus.refreshBus) return;

    this.refreshBusUnsubscribers.push(
      pluginWithBus.refreshBus.on('mcp', () => {
        this.renderMcpStatusBar();
      }),
    );
    this.refreshBusUnsubscribers.push(
      pluginWithBus.refreshBus.on('models', () => {
        this.populateModelSelect();
      }),
    );
    this.refreshBusUnsubscribers.push(
      pluginWithBus.refreshBus.on('rag', () => {
        /* RAG 상태 변경은 채팅 컨텍스트가 다음 질문 시 자동 반영됨 */
      }),
    );
  }

  private registerMcpStatusEvents(): void {
    this.registerEvent(
      (this.app.workspace as unknown as Events).on(MCP_STATUS_CHANGE_EVENT, () => {
        this.renderMcpStatusBar();
      }),
    );
  }

  async onClose(): Promise<void> {
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    this.cancelStreamingMarkdownRender();
    // RefreshAction 정리
    this.mcpRefreshAction?.detach();
    this.mcpRefreshAction = null;
    // RefreshBus 구독 해제
    for (const unsub of this.refreshBusUnsubscribers) {
      unsub();
    }
    this.refreshBusUnsubscribers = [];
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
    this.headerEl = container.createDiv({ cls: 'superpower-inside-chat-header' });

    const titleSection = this.headerEl.createDiv({
      cls: 'superpower-inside-chat-header-title-section',
    });

    this.sessionTitleEl = titleSection.createSpan({
      cls: 'superpower-inside-chat-session-title',
      text: this.session.title || t('chatTabTitle'),
    });
    this.sessionTitleEl.addEventListener('click', () => this.promptRenameSession());

    this.sessionInfoEl = titleSection.createDiv({ cls: 'superpower-inside-chat-session-info' });
    this.updateSessionInfo();

    const actions = this.headerEl.createDiv({ cls: 'superpower-inside-chat-header-actions' });

    const newChatBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      text: t('chatNewSession'),
    });
    newChatBtn.addEventListener('click', () => void this.startNewSession());

    const historyBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      text: t('chatHistory'),
    });
    historyBtn.addEventListener('click', () => void this.openSessionHistoryModal());

    const sysToggle = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      text: '⚙️',
      attr: { 'aria-label': t('systemPrompt') },
    });
    sysToggle.addEventListener('click', () => {
      openPromptLibraryModal({
        containerEl: container,
        plugin: this.plugin,
        currentSessionPrompt: this.sessionSystemPrompt,
        selectedModel: this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel,
        onApplyToSession: (prompt) => {
          this.sessionSystemPrompt = prompt.trim() || null;
          this.updateSystemPromptBadge();
          this.markDirtyAndAutoSave();
        },
      });
    });
  }

  private updateSystemPromptBadge(): void {}

  private buildMcpStatusBar(container: HTMLElement): void {
    this.mcpStatusBar = container.createDiv({ cls: 'superpower-inside-chat-mcp-status-bar' });
    this.renderMcpStatusBar();
  }

  private renderMcpStatusBar(): void {
    if (!this.mcpStatusBar) return;
    this.mcpStatusBar.empty();

    const registry = this.plugin.mcpRegistry;
    const state = this.plugin.mcpConnectionState ?? 'idle';
    if (state === 'connecting') {
      const connectingLabel = this.mcpStatusBar.createSpan({
        cls: 'superpower-inside-chat-mcp-status-label',
      });
      connectingLabel.setText(t('mcpConnecting'));
      this.attachMcpRefreshButton();
      return;
    }

    if (!registry || registry.getConnectedCount() === 0) {
      const emptyLabel = this.mcpStatusBar.createSpan({
        cls: 'superpower-inside-chat-mcp-status-label',
      });
      emptyLabel.setText(state === 'error' ? t('mcpConnectionFailed') : t('mcpNoActiveServers'));
      this.attachMcpRefreshButton();
      return;
    }

    const servers = registry.getEnabledServers();
    const connectedCount = registry.getConnectedCount();
    const totalCount = servers.length;

    const summary = this.mcpStatusBar.createSpan({
      cls: 'superpower-inside-chat-mcp-status-label',
    });
    summary.setText(
      state === 'partial-error'
        ? `${t('mcpPartialError')} · ${t('mcpActiveServers', { count: connectedCount, total: totalCount })}`
        : t('mcpActiveServers', { count: connectedCount, total: totalCount }),
    );

    for (const server of servers) {
      const status = registry.getConnectionStatus(server.name);
      if (status !== 'connected') continue;
      const chip = this.mcpStatusBar.createSpan({
        cls: `superpower-inside-chat-mcp-server-chip ${status}`,
      });
      chip.setText(server.name);
    }

    this.attachMcpRefreshButton();
  }

  private attachMcpRefreshButton(): void {
    if (!this.mcpStatusBar) return;
    // 이전 버튼 정리
    const existing = this.mcpStatusBar.querySelector('.superpower-inside-chat-mcp-refresh-btn');
    if (existing) existing.remove();

    const refreshBtn = this.mcpStatusBar.createEl('button', {
      cls: 'superpower-inside-chat-mcp-refresh-btn',
      text: t('mcpReconnect'),
    });

    this.mcpRefreshAction?.detach();
    this.mcpRefreshAction = new RefreshAction({
      action: async (_signal) => {
        const errors = await this.plugin.reconnectMCP();
        if (errors.length > 0) {
          new Notice(t('chatMcpReconnectFailedNotice', { count: errors.length }), 5000);
          return {
            status: 'partial',
            detail: t('chatMcpReconnectFailedDetail', { count: errors.length }),
          };
        }
        // RefreshBus로 MCP 이벤트 발행 (설정 탭 동기화)
        const pluginWithBus = this.plugin as unknown as {
          refreshBus?: {
            emit: (domain: string, result: { status: string; detail?: string }) => void;
          };
        };
        pluginWithBus.refreshBus?.emit('mcp', { status: 'success' });
        new Notice(t('chatMcpReconnectCompleteNotice'), 3000);
        return { status: 'success' };
      },
      loadingText: t('mcpRefreshing'),
      spinnerClass: 'spinning',
      errorNotice: false,
      successNotice: false,
    });
    this.mcpRefreshAction.attach(refreshBtn);
  }

  private buildInputArea(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'superpower-inside-chat-input-wrapper' });

    const toolbar = wrapper.createDiv({ cls: 'superpower-inside-chat-input-toolbar' });

    this.modelSelectEl = toolbar.createEl('select', {
      cls: 'superpower-inside-chat-model-select',
      attr: { 'aria-label': t('modelSelector') },
    });
    this.populateModelSelect();

    this.mcpBtn = toolbar.createEl('button', {
      cls: 'superpower-inside-chat-toolbar-btn',
      text: t('toolbarTools'),
    });
    this.mcpBtn.addEventListener('click', () => void this.openMcpToolPicker());

    const searchBtn = toolbar.createEl('button', {
      cls: 'superpower-inside-chat-toolbar-btn',
      text: t('chatSearchButton'),
      attr: { 'aria-label': t('chatMessageSearchAria') },
    });
    searchBtn.addEventListener('click', () => this.focusMessageSearch());

    this.contextPreviewEl = wrapper.createDiv({ cls: 'superpower-inside-chat-context-preview' });
    this.renderContextPreview('');

    const inputRow = wrapper.createDiv({ cls: 'superpower-inside-chat-input-area' });
    this.inputArea = inputRow.createEl('textarea', {
      cls: 'superpower-inside-chat-input',
      attr: { placeholder: t('chatInputPlaceholder'), rows: '2' },
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
      cls: 'superpower-inside-chat-send-btn',
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
    const query = window.prompt(t('chatMessageSearchPrompt'));
    if (!query) return;
    const lowered = query.toLowerCase();
    const match = this.messages.find((message) => message.content.toLowerCase().includes(lowered));
    if (!match) {
      new Notice(t('chatNoSearchResults'));
      return;
    }
    const el = this.messageEls.get(match.id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.addClass('superpower-inside-chat-search-hit');
    window.setTimeout(() => el.removeClass('superpower-inside-chat-search-hit'), 1800);
  }

  private renderContextPreview(text: string): void {
    if (!this.contextPreviewEl) return;
    this.contextPreviewEl.empty();
    const mentions = text.trim() ? this.parseMentions(text) : [];
    const chips = [
      { label: t('chatAutoRagChip'), cls: 'rag' },
      ...mentions.map((mention) => ({
        label:
          mention.type === 'server'
            ? `MCP ${mention.name}`
            : mention.type === 'folder'
              ? t('chatFolderMentionChip', { name: mention.name })
              : t('chatFileMentionChip', { name: mention.name }),
        cls: mention.type,
      })),
    ];
    for (const chip of chips.slice(0, 8)) {
      this.contextPreviewEl.createSpan({
        cls: `superpower-inside-chat-context-chip ${chip.cls}`,
        text: chip.label,
      });
    }
  }

  private stopStreaming(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.isStreaming = false;
    setHidden(this.typingIndicator, true);
    const current = [...this.messages].reverse().find((message) => message.status === 'streaming');
    if (current) {
      this.updateMessage(
        current.id,
        current.content || t('chatGenerationStopped'),
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
    for (const provider of this.plugin.settings.customOpenAIProviders) {
      if (!provider.enabled) continue;
      const label = provider.name.trim() || 'Custom OpenAI-Compatible';
      for (const model of provider.models) {
        allModels.push({
          value: `customOpenAI:${provider.id}:${model}`,
          label: `${label} — ${model}`,
        });
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
    if (this.mentionDropdown && !this.mentionDropdown.hasClass(HIDDEN_CLASS)) {
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
      setHidden(this.mentionDropdown, true);
      return;
    }

    if (!this.mentionDropdown) {
      this.mentionDropdown = this.container.createDiv({
        cls: 'superpower-inside-mention-dropdown',
      });
    }
    this.mentionDropdown.empty();
    setHidden(this.mentionDropdown, false);

    const serverItems = this.mentionItems.filter((i) => i.type === 'server');
    const fileItems = this.mentionItems.filter((i) => i.type === 'file');
    const folderItems = this.mentionItems.filter((i) => i.type === 'folder');

    if (serverItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'superpower-inside-mention-group' });
      group.createDiv({
        cls: 'superpower-inside-mention-group-label',
        text: t('mcpMentionServers'),
      });
      for (const item of serverItems) {
        const el = group.createDiv({ cls: 'superpower-inside-mention-item' });
        el.createSpan({ cls: 'superpower-inside-mention-item-icon', text: '🔌' });
        el.createSpan({ cls: 'superpower-inside-mention-item-name', text: item.label });
        el.addEventListener('click', () => this.insertMention(item));
      }
    }

    if (folderItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'superpower-inside-mention-group' });
      group.createDiv({
        cls: 'superpower-inside-mention-group-label',
        text: t('mcpMentionFolders'),
      });
      for (const item of folderItems) {
        const el = group.createDiv({ cls: 'superpower-inside-mention-item' });
        el.createSpan({ cls: 'superpower-inside-mention-item-icon folder', text: '📁' });
        el.createSpan({ cls: 'superpower-inside-mention-item-name', text: item.label });
        el.addEventListener('click', () => this.insertMention(item));
      }
    }

    if (fileItems.length > 0) {
      const group = this.mentionDropdown.createDiv({ cls: 'superpower-inside-mention-group' });
      group.createDiv({
        cls: 'superpower-inside-mention-group-label',
        text: t('mcpMentionFiles'),
      });
      for (const item of fileItems) {
        const el = group.createDiv({ cls: 'superpower-inside-mention-item' });
        el.createSpan({ cls: 'superpower-inside-mention-item-icon', text: '📄' });
        el.createSpan({ cls: 'superpower-inside-mention-item-name', text: item.label });
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

    if (spaceBelow < 200 && spaceAbove > 200) {
      this.mentionDropdown.setCssProps({
        [MENTION_BOTTOM_VAR]: `${containerRect.height - (inputRect.top - containerRect.top) + 4}px`,
        [MENTION_TOP_VAR]: 'auto',
      });
      this.mentionDropdown.addClass('above');
    } else {
      this.mentionDropdown.setCssProps({
        [MENTION_TOP_VAR]: `${inputRect.bottom - containerRect.top + 4}px`,
        [MENTION_BOTTOM_VAR]: 'auto',
      });
      this.mentionDropdown.removeClass('above');
    }
  }

  private selectMentionItem(index: number): void {
    if (!this.mentionDropdown) return;
    const items = this.mentionDropdown.querySelectorAll('.superpower-inside-mention-item');
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
      setHidden(this.mentionDropdown, true);
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
    this.inputArea.setCssProps({ [CHAT_INPUT_HEIGHT_VAR]: 'auto' });
    this.inputArea.setCssProps({
      [CHAT_INPUT_HEIGHT_VAR]: `${Math.min(this.inputArea.scrollHeight, 200)}px`,
    });
  }

  private handleScroll(): void {
    if (!this.messagesArea) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesArea;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 60;
    this.autoScroll = nearBottom;
    if (this.scrollBtn) {
      setHidden(this.scrollBtn, nearBottom);
    }
  }

  private scrollToBottom(): void {
    if (!this.messagesArea) return;
    this.messagesArea.scrollTo({ top: this.messagesArea.scrollHeight, behavior: 'auto' });
    this.autoScroll = true;
    setHidden(this.scrollBtn, true);
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
      sourceWarnings: metaInput?.sourceWarnings,
      contextAttachments: metaInput?.contextAttachments,
      assistantQuestion: metaInput?.assistantQuestion,
      branchOf: metaInput?.branchOf,
      stopReason: metaInput?.stopReason,
    };
    this.messages.push(msg);
    this.markDirtyAndAutoSave();

    const wrapper = this.messagesArea!.createDiv({
      cls: `superpower-inside-chat-message-wrapper ${role}`,
    });
    this.messageEls.set(id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'superpower-inside-chat-avatar' });
    avatar.setText(this.getAvatarText(role));

    const bubbleContainer = wrapper.createDiv({ cls: 'superpower-inside-chat-bubble-container' });
    bubbleContainer.setAttribute('data-message-id', id);

    const meta = bubbleContainer.createDiv({ cls: 'superpower-inside-chat-meta' });
    this.renderMessageMeta(meta, msg);

    if (role === 'assistant') {
      this.createAssistantLayers(
        bubbleContainer,
        content,
        reasoning,
        toolCalls,
        msg.citations,
        msg.sourceWarnings,
        msg.assistantQuestion,
      );
    } else if (role === 'tool') {
      const bubble = bubbleContainer.createDiv({
        cls: 'superpower-inside-chat-bubble tool',
      });
      this.renderToolBubble(bubble, content, 'running');
    } else {
      const bubble = bubbleContainer.createDiv({
        cls: `superpower-inside-chat-bubble ${role}`,
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
      if (metaInput?.originalContent !== undefined) {
        message.originalContent = metaInput.originalContent;
      }
      message.updatedAt = new Date().toISOString();
      message.providerKey = metaInput?.providerKey ?? message.providerKey;
      message.providerLabel = metaInput?.providerLabel ?? message.providerLabel;
      message.model = metaInput?.model ?? message.model;
      message.status = metaInput?.status ?? (isDone ? 'complete' : 'streaming');
      message.errorMessage = metaInput?.errorMessage;
      message.citations = metaInput?.citations ?? message.citations;
      message.sourceWarnings = metaInput?.sourceWarnings ?? message.sourceWarnings;
      message.contextAttachments = metaInput?.contextAttachments ?? message.contextAttachments;
      message.assistantQuestion = metaInput?.assistantQuestion;
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
        message?.sourceWarnings,
        message?.assistantQuestion,
      );
      if (this.autoScroll) {
        this.scrollToBottom();
      }
      return;
    }

    if (isTool) {
      const bubble = wrapper.querySelector('.superpower-inside-chat-bubble.tool');
      if (bubble instanceof HTMLElement) {
        const status = isDone ? 'success' : 'running';
        this.renderToolBubble(bubble, content, status);
      }
    } else {
      const bubble = wrapper.querySelector('.superpower-inside-chat-bubble');
      if (bubble instanceof HTMLElement) {
        if (!isDone) {
          renderPlainTextWithBreaks(bubble, content);
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
    sourceWarnings?: SourceValidationWarning[],
    assistantQuestion?: AssistantQuestion,
  ): void {
    const shouldShowStreamingPlaceholders = this.isStreaming && !content;

    const thinking = bubbleContainer.createEl('details', {
      cls: 'superpower-inside-chat-thinking superpower-inside-chat-reasoning',
    });
    setHidden(thinking, !(reasoning || shouldShowStreamingPlaceholders));
    if (shouldShowStreamingPlaceholders || (reasoning && reasoning.length > 0)) {
      thinking.open = true;
    }
    thinking.addEventListener('toggle', () => {
      if (this.autoScroll) this.scrollToBottom();
    });
    const thinkingSummary = thinking.createEl('summary');
    thinkingSummary.setText(`💭 ${t('reasoningLabel')}`);
    const thinkingContent = thinking.createDiv({
      cls: 'superpower-inside-chat-thinking-content superpower-inside-chat-reasoning-content',
    });
    thinkingContent.setText(reasoning ?? t('thinkingPlaceholder'));

    const toolCallsSection = bubbleContainer.createDiv({
      cls: 'superpower-inside-chat-tool-calls',
    });
    const hasToolCalls = toolCalls && toolCalls.length > 0;
    setHidden(toolCallsSection, !(hasToolCalls || shouldShowStreamingPlaceholders));
    this.renderToolCallsSection(
      toolCallsSection,
      toolCalls ?? [],
      shouldShowStreamingPlaceholders && !hasToolCalls,
    );

    const answerLayer = bubbleContainer.createDiv({ cls: 'superpower-inside-chat-answer' });
    answerLayer.createDiv({
      cls: 'superpower-inside-chat-answer-label',
      text: `💬 ${t('answerLabel')}`,
    });
    const bubble = answerLayer.createDiv({
      cls: 'superpower-inside-chat-bubble assistant',
    });
    if (assistantQuestion) {
      this.renderAssistantQuestionCard(bubble, assistantQuestion);
    } else if (content.trim()) {
      void this.renderMarkdownBubble(bubble, content);
    } else {
      bubble.setText(content);
    }
    this.renderCitationsSection(bubbleContainer, citations ?? []);
    this.renderSourceWarningsSection(bubbleContainer, sourceWarnings ?? []);
  }

  private updateAssistantLayers(
    wrapper: HTMLElement,
    content: string,
    isDone: boolean,
    reasoning?: string,
    toolCalls?: ToolCallRecord[],
    citations?: SourceCitation[],
    sourceWarnings?: SourceValidationWarning[],
    assistantQuestion?: AssistantQuestion,
  ): void {
    const bubbleContainer = wrapper.querySelector('.superpower-inside-chat-bubble-container');
    if (!(bubbleContainer instanceof HTMLElement)) return;

    let thinking = bubbleContainer.querySelector('.superpower-inside-chat-thinking');
    if (!(thinking instanceof HTMLDetailsElement)) {
      this.createAssistantLayers(
        bubbleContainer,
        content,
        reasoning,
        toolCalls,
        citations,
        sourceWarnings,
        assistantQuestion,
      );
      thinking = bubbleContainer.querySelector('.superpower-inside-chat-thinking');
    }

    if (thinking instanceof HTMLDetailsElement) {
      const hasReasoning = reasoning !== undefined && reasoning.length > 0;
      setHidden(thinking, !(hasReasoning || !isDone));
      const thinkingContent = thinking.querySelector('.superpower-inside-chat-thinking-content');
      if (thinkingContent instanceof HTMLElement) {
        if (!isDone) {
          const text = hasReasoning ? reasoning : t('thinkingPlaceholder');
          renderPlainTextWithBreaks(thinkingContent, text ?? '');
          thinking.open = true;
        } else if (hasReasoning) {
          void this.renderMarkdownBubble(thinkingContent, reasoning ?? '');
          thinking.open = true;
        } else {
          thinkingContent.setText('');
          thinking.open = false;
        }
      } else if (!hasReasoning && isDone) {
        thinking.open = false;
      }
    }

    const toolCallsSection = bubbleContainer.querySelector('.superpower-inside-chat-tool-calls');
    if (toolCallsSection instanceof HTMLElement) {
      const calls = toolCalls ?? [];
      setHidden(toolCallsSection, !(calls.length > 0 || !isDone));
      this.renderToolCallsSection(toolCallsSection, calls, !isDone);
    }

    const bubble = bubbleContainer.querySelector('.superpower-inside-chat-bubble.assistant');
    if (bubble instanceof HTMLElement) {
      const meta = bubbleContainer.querySelector('.superpower-inside-chat-meta');
      const generatingLabel = meta?.querySelector('.superpower-inside-chat-generating-label');
      if (!isDone) {
        if (
          !content.trim() &&
          !generatingLabel &&
          !bubbleContainer
            .querySelector('.superpower-inside-chat-thinking-content')
            ?.textContent?.trim() &&
          !(toolCalls && toolCalls.length > 0)
        ) {
          const label = bubbleContainer.ownerDocument.createElement('span');
          label.className = 'superpower-inside-chat-generating-label';
          label.textContent = t('chatGeneratingResponse');
          if (meta instanceof HTMLElement) {
            meta.appendChild(label);
          }
        }
        this.scheduleStreamingMarkdownRender(bubble, content);
      } else {
        this.cancelStreamingMarkdownRender();
        if (assistantQuestion) {
          this.renderAssistantQuestionCard(bubble, assistantQuestion);
        } else {
          void this.renderMarkdownBubble(bubble, content);
        }
        if (generatingLabel instanceof HTMLElement) {
          generatingLabel.remove();
        }
        wrapper.classList.remove('generating');
      }
    }
    this.renderCitationsSection(bubbleContainer, citations ?? []);
    this.renderSourceWarningsSection(bubbleContainer, sourceWarnings ?? []);
  }

  private renderAssistantQuestionCard(container: HTMLElement, question: AssistantQuestion): void {
    container.empty();
    container.addClass('superpower-inside-chat-question-card');
    const prompt = container.createDiv({
      cls: 'superpower-inside-chat-question-prompt',
      text: question.prompt,
    });
    prompt.setAttribute(
      'title',
      question.source === 'reasoning-leak'
        ? t('assistantQuestionReasoningTitle')
        : t('assistantQuestionSelectionTitle'),
    );

    const selected = new Set<string>();
    const choiceControls: HTMLInputElement[] = [];

    if (question.choices.length > 0) {
      const choices = container.createDiv({ cls: 'superpower-inside-chat-question-choices' });
      for (const choice of question.choices) {
        const label = choices.createEl('label', {
          cls: 'superpower-inside-chat-question-choice',
        });
        const input = label.createEl('input');
        input.type = question.selectionMode === 'multiple' ? 'checkbox' : 'radio';
        input.name = `assistant-question-${question.prompt}`;
        input.value = choice.id;
        choiceControls.push(input);
        label.createSpan({ text: choice.label });
        input.addEventListener('change', () => {
          if (question.selectionMode === 'single') selected.clear();
          if (input.checked) {
            selected.add(choice.id);
          } else {
            selected.delete(choice.id);
          }
        });
      }
    }

    let freeTextInput: HTMLTextAreaElement | null = null;
    if (question.allowFreeText) {
      freeTextInput = container.createEl('textarea', {
        cls: 'superpower-inside-chat-question-free-text',
        attr: { placeholder: t('assistantQuestionFreeTextPlaceholder') },
      });
    }

    const submit = container.createEl('button', {
      cls: 'superpower-inside-chat-question-submit',
      text:
        question.selectionMode === 'multiple'
          ? t('assistantQuestionCompleteSelection')
          : t('assistantQuestionSendAnswer'),
    });
    submit.addEventListener('click', () => {
      const selectedLabels = question.choices
        .filter((choice) => selected.has(choice.id))
        .map((choice) => choice.label);
      const freeText = freeTextInput?.value.trim() ?? '';
      if (selectedLabels.length === 0 && !freeText) {
        new Notice(t('assistantQuestionRequiredNotice'));
        return;
      }
      const answer = formatAssistantQuestionAnswer(question, selectedLabels, freeText);
      if (!answer) {
        new Notice(t('assistantQuestionRequiredNotice'));
        return;
      }
      if (this.inputArea) {
        this.inputArea.value = answer;
        this.autoResizeInput();
      }
      for (const control of choiceControls) {
        control.disabled = true;
      }
      if (freeTextInput) freeTextInput.disabled = true;
      submit.disabled = true;
      void this.handleSend();
    });
  }

  private scheduleStreamingMarkdownRender(bubble: HTMLElement, content: string): void {
    renderPlainTextWithBreaks(bubble, content);

    const existingCursor = bubble.querySelector('.superpower-inside-chat-streaming-cursor');
    if (!existingCursor) {
      const cursor = bubble.createSpan({ cls: 'superpower-inside-chat-streaming-cursor' });
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
            const cursor = el.createSpan({ cls: 'superpower-inside-chat-streaming-cursor' });
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
    const existingLabel = section.querySelector('.superpower-inside-chat-tool-calls-label');
    if (!existingLabel) {
      section.createDiv({
        cls: 'superpower-inside-chat-tool-calls-label',
        text: `🔧 ${t('toolCallLabel')}`,
      });
    }

    if (toolCalls.length === 0 && showPlaceholder) {
      const existingPlaceholder = section.querySelector('.superpower-inside-tool-call.placeholder');
      if (!existingPlaceholder) {
        const row = section.createDiv({ cls: 'superpower-inside-tool-call placeholder' });
        row.createSpan({ cls: 'superpower-inside-tool-call-icon', text: '🔧' });
        row.createSpan({ cls: 'superpower-inside-tool-call-name', text: t('mcpToolRunning') });
        const statusBadge = row.createSpan({ cls: 'superpower-inside-tool-call-status running' });
        this.renderRunningDots(statusBadge);
      }
      return;
    }

    section
      .querySelectorAll('.superpower-inside-tool-call.placeholder')
      .forEach((el) => el.remove());

    for (const toolCall of toolCalls) {
      const rowId = `tool-call-${toolCall.id || toolCall.name}`;
      let callRow = Array.from(section.querySelectorAll('.superpower-inside-tool-call')).find(
        (el): el is HTMLElement =>
          el instanceof HTMLElement && el.getAttribute('data-tool-call-id') === rowId,
      );

      if (!callRow) {
        callRow = section.createDiv({ cls: 'superpower-inside-tool-call' });
        callRow.setAttribute('data-tool-call-id', rowId);
        callRow.createSpan({ cls: 'superpower-inside-tool-call-icon', text: '🔧' });
        callRow.createSpan({
          cls: 'superpower-inside-tool-call-name',
          text: toolCall.name || t('toolCallLabel'),
        });
        const statusBadge = callRow.createSpan({
          cls: `superpower-inside-tool-call-status ${toolCall.status}`,
        });
        this.renderToolCallStatus(statusBadge, toolCall.status);
      } else {
        const statusBadge = callRow.querySelector('.superpower-inside-tool-call-status');
        if (statusBadge instanceof HTMLElement) {
          statusBadge.className = `superpower-inside-tool-call-status ${toolCall.status}`;
          this.renderToolCallStatus(statusBadge, toolCall.status);
        }
      }

      const staleApproveBtn = callRow.querySelector('.superpower-inside-tool-call-approve');
      if (
        staleApproveBtn instanceof HTMLElement &&
        (toolCall.status !== 'running' || toolCall.approved !== false)
      ) {
        staleApproveBtn.remove();
      }
      if (
        toolCall.status === 'running' &&
        toolCall.approved === false &&
        !callRow.querySelector('.superpower-inside-tool-call-approve')
      ) {
        const approveBtn = callRow.createEl('button', {
          cls: 'superpower-inside-tool-call-approve',
          text: t('toolApproveExecution'),
        });
        approveBtn.addEventListener('click', () => {
          const messageId = section
            .closest('.superpower-inside-chat-bubble-container')
            ?.getAttribute('data-message-id');
          if (messageId) void this.approveToolCall(messageId, toolCall.id || toolCall.name);
        });
      }

      const existingArgs = Array.from(
        section.querySelectorAll('.superpower-inside-tool-arguments'),
      ).find(
        (el): el is HTMLDetailsElement =>
          el instanceof HTMLDetailsElement && el.getAttribute('data-tool-call-id') === rowId,
      );
      const existingResult = Array.from(
        section.querySelectorAll('.superpower-inside-tool-result-details'),
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
        const args = section.createEl('details', { cls: 'superpower-inside-tool-arguments' });
        args.setAttribute('data-tool-call-id', rowId);
        args.open = argsOpen;
        args.createEl('summary', { text: t('toolArgs') });
        args.createEl('pre', { text: argumentPreview });
      }

      if (toolCall.result) {
        const resultDetails = section.createEl('details', {
          cls: 'superpower-inside-tool-result-details',
        });
        resultDetails.setAttribute('data-tool-call-id', rowId);
        resultDetails.open = resultOpen;
        resultDetails.createEl('summary', { text: t('toolResult') });
        const resultArea = resultDetails.createDiv({ cls: 'superpower-inside-tool-result' });
        void this.renderMarkdownBubble(resultArea, toolCall.result);
      }
    }

    const currentIds = new Set(
      toolCalls.map((toolCall) => `tool-call-${toolCall.id || toolCall.name}`),
    );
    section.querySelectorAll('.superpower-inside-tool-call:not(.placeholder)').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.superpower-inside-tool-arguments').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.superpower-inside-tool-result-details').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
  }

  private renderCitationsSection(container: HTMLElement, citations: SourceCitation[]): void {
    let section = container.querySelector('.superpower-inside-chat-citations');
    if (citations.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-citations' });
    }
    section.empty();
    const verifiedCount = citations.filter((citation) => citation.status === 'verified').length;
    section.createDiv({
      cls: 'superpower-inside-chat-citations-label',
      text:
        verifiedCount === citations.length
          ? t('sourceVerifiedCount', { count: verifiedCount })
          : t('sourceSearchVerifiedCount', { verified: verifiedCount, total: citations.length }),
    });

    for (const citation of citations) {
      const status = citation.status ?? 'candidate';
      const card = section.createDiv({
        cls: `superpower-inside-chat-citation-card ${status}`,
      });
      const title = card.createDiv({ cls: 'superpower-inside-chat-citation-title' });
      title.createSpan({ text: citation.filePath });
      if (citation.heading) {
        title.createSpan({
          cls: 'superpower-inside-chat-citation-heading',
          text: ` # ${citation.heading}`,
        });
      }
      const metaParts = [
        citation.line !== undefined ? `line ${citation.line}` : '',
        citation.endLine !== undefined ? `end ${citation.endLine}` : '',
        citation.score !== undefined ? `score ${citation.score.toFixed(3)}` : '',
        citation.vectorScore !== undefined ? `vector ${citation.vectorScore.toFixed(3)}` : '',
        citation.bm25Score !== undefined ? `bm25 ${citation.bm25Score.toFixed(3)}` : '',
        `status ${status}`,
      ].filter(Boolean);
      if (metaParts.length > 0) {
        card.createDiv({
          cls: 'superpower-inside-chat-citation-meta',
          text: metaParts.join(' · '),
        });
      }
      if (citation.detail) {
        card.createDiv({ cls: 'superpower-inside-chat-citation-warning', text: citation.detail });
      }
      card.createDiv({ cls: 'superpower-inside-chat-citation-preview', text: citation.preview });
      const actions = card.createDiv({ cls: 'superpower-inside-chat-citation-actions' });
      const openBtn = actions.createEl('button', { text: t('sourceOpenAction') });
      openBtn.addEventListener('click', () => void this.openCitation(citation));
      const copyBtn = actions.createEl('button', { text: t('sourceCopyLinkAction') });
      copyBtn.addEventListener('click', () => void this.copyCitationLink(citation, copyBtn));
      const insertBtn = actions.createEl('button', { text: t('sourceInsertIntoNoteAction') });
      insertBtn.addEventListener('click', () => void this.insertCitationIntoActiveNote(citation));
    }
  }

  private renderSourceWarningsSection(
    container: HTMLElement,
    warnings: SourceValidationWarning[],
  ): void {
    let section = container.querySelector('.superpower-inside-chat-source-warnings');
    if (warnings.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-source-warnings' });
    }
    section.empty();
    section.createDiv({
      cls: 'superpower-inside-chat-source-warnings-label',
      text: t('sourceUnverifiedCount', { count: warnings.length }),
    });
    for (const warning of warnings) {
      const item = section.createDiv({
        cls: `superpower-inside-chat-source-warning ${warning.kind}`,
      });
      item.createSpan({ cls: 'superpower-inside-chat-source-warning-label', text: warning.label });
      item.createSpan({
        cls: 'superpower-inside-chat-source-warning-detail',
        text: warning.detail,
      });
    }
  }

  private renderContextAttachmentsSection(
    container: HTMLElement,
    attachments: ContextAttachment[],
  ): void {
    let section = container.querySelector('.superpower-inside-chat-context-attachments');
    if (attachments.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-context-attachments' });
    }
    section.empty();
    for (const attachment of attachments) {
      const chip = section.createSpan({
        cls: `superpower-inside-chat-context-chip ${attachment.type} ${attachment.status}`,
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
      new Notice(t('sourceFileNotFound', { path: citation.filePath }));
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async copyCitationLink(
    citation: SourceCitation,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (citation.status && citation.status !== 'verified') {
      new Notice(
        t('sourceUnverifiedCandidate', { detail: citation.detail ?? citation.status ?? '' }),
      );
    }
    const heading = citation.heading ? `#${citation.heading}` : '';
    await navigator.clipboard.writeText(`[[${citation.filePath}${heading}]]`);
    button.setText(t('copied'));
    window.setTimeout(() => button.setText(t('sourceCopyLinkAction')), 1500);
  }

  private async insertCitationIntoActiveNote(citation: SourceCitation): Promise<void> {
    if (citation.status && citation.status !== 'verified') {
      new Notice(
        t('sourceUnverifiedCandidate', { detail: citation.detail ?? citation.status ?? '' }),
      );
      return;
    }
    const active = this.app.workspace.getActiveFile();
    if (!active) {
      new Notice(t('activeNoteMissingNotice'));
      return;
    }
    const link = citation.heading
      ? `[[${citation.filePath}#${citation.heading}]]`
      : `[[${citation.filePath}]]`;
    await this.app.vault.append(
      active,
      t('sourceInsertBlock', { link, preview: citation.preview }),
    );
    new Notice(t('sourceInsertedNotice'));
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
    const dots = container.createSpan({ cls: 'superpower-inside-tool-running-dots' });
    dots.createSpan({});
    dots.createSpan({});
    dots.createSpan({});
  }

  private async renderMarkdownBubble(bubble: HTMLElement, content: string): Promise<void> {
    await renderMarkdownToElement(bubble, content, '', this);
    enhanceCodeBlocks(bubble);
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
        span.addClass('superpower-inside-mention-inline');
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
    meta.createSpan({ cls: 'superpower-inside-chat-role', text: this.getRoleLabel(msg.role) });
    meta.createSpan({
      cls: 'superpower-inside-chat-timestamp',
      text: this.formatExactTimestamp(msg.createdAt),
    });
    if (msg.providerLabel || msg.model) {
      meta.createSpan({
        cls: 'superpower-inside-chat-model-meta',
        text: [msg.providerLabel, msg.model].filter(Boolean).join(' / '),
      });
    }
    const status = meta.createSpan({
      cls: `superpower-inside-chat-message-status ${msg.status}`,
      text: this.getMessageStatusLabel(msg.status),
    });
    if (msg.errorMessage) {
      status.setAttribute('title', msg.errorMessage);
    }
  }

  private updateMessageMeta(wrapper: HTMLElement, msg: ChatMessageWithMeta): void {
    const meta = wrapper.querySelector('.superpower-inside-chat-meta');
    if (meta instanceof HTMLElement) {
      this.renderMessageMeta(meta, msg);
    }
  }

  private renderMessageActions(container: HTMLElement, msg: ChatMessageWithMeta): void {
    const existing = container.querySelector('.superpower-inside-chat-message-actions');
    existing?.remove();
    const actions = container.createDiv({ cls: 'superpower-inside-chat-message-actions' });

    const copyBtn = actions.createEl('button', { text: t('messageCopyAction') });
    copyBtn.addEventListener('click', () => void this.copyMessage(msg, copyBtn));

    if (msg.role === 'assistant') {
      const retryBtn = actions.createEl('button', { text: t('messageRetryAction') });
      retryBtn.addEventListener('click', () => void this.regenerateFromAssistant(msg.id));
      const insertBtn = actions.createEl('button', { text: t('sourceInsertIntoNoteAction') });
      insertBtn.addEventListener('click', () => void this.insertMessageIntoActiveNote(msg));
      const saveBtn = actions.createEl('button', { text: t('messageNewNoteAction') });
      saveBtn.addEventListener('click', () => void this.saveMessageAsNote(msg));
      const branchBtn = actions.createEl('button', { text: t('messageBranchAction') });
      branchBtn.addEventListener('click', () => void this.branchFromMessage(msg.id));
    } else if (msg.role === 'user') {
      const editBtn = actions.createEl('button', { text: t('messageEditAndSendAction') });
      editBtn.addEventListener('click', () => void this.editAndResendUserMessage(msg));
    }
  }

  private async copyMessage(msg: ChatMessageWithMeta, button: HTMLButtonElement): Promise<void> {
    this.noticeSourceWarnings(msg);
    await navigator.clipboard.writeText(msg.content);
    button.setText(t('copied'));
    window.setTimeout(() => button.setText(t('messageCopyAction')), 1500);
  }

  private async insertMessageIntoActiveNote(msg: ChatMessageWithMeta): Promise<void> {
    this.noticeSourceWarnings(msg);
    const active = this.app.workspace.getActiveFile();
    if (!active) {
      new Notice(t('activeNoteMissingNotice'));
      return;
    }
    await this.app.vault.append(active, `\n\n${msg.content}\n`);
    new Notice(t('messageInsertedNotice'));
  }

  private noticeSourceWarnings(msg: ChatMessageWithMeta): void {
    if (!msg.sourceWarnings || msg.sourceWarnings.length === 0) return;
    new Notice(t('sourceWarningIncluded', { count: msg.sourceWarnings.length }), 5000);
  }

  private async saveMessageAsNote(msg: ChatMessageWithMeta): Promise<void> {
    const folder = this.plugin.settings.chat.saveFolder || 'SuperpowerInsideChats';
    const title = this.session.title || t('aiAnswerTitle');
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const path = `${folder}/${safeTitle}-answer-${Date.now()}.md`;
    if (!(await this.app.vault.adapter.exists(folder))) {
      await this.app.vault.createFolder(folder);
    }
    await this.app.vault.create(path, `# ${title}\n\n${msg.content}\n`);
    new Notice(t('savedAsNewNoteNotice', { path }));
  }

  private editAndResendUserMessage(msg: ChatMessageWithMeta): void {
    new EditMessageModal(this.app, msg.content, (edited) => {
      const index = this.messages.findIndex((m) => m.id === msg.id);
      if (index >= 0) {
        this.messages = this.messages.slice(0, index);
      }
      this.inputArea!.value = edited;
      this.autoResizeInput();
      this.renderContextPreview(edited);
      void this.handleSend();
    }).open();
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
    new Notice(t('branchSessionCreatedNotice'));
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
        return t('chatStatusIdle');
      case 'streaming':
        return t('chatStatusRunning');
      case 'complete':
        return t('chatStatusDone');
      case 'error':
        return t('chatStatusError');
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
        if (!child.hasClass('superpower-inside-typing-indicator')) {
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
    setHidden(this.typingIndicator, true);
    if (hadMessages) {
      new Notice(t('deletedSessionResetNotice', { path: missingPath }));
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
        if (!child.hasClass('superpower-inside-typing-indicator')) {
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
      (
        this.plugin as unknown as {
          refreshBus?: { emit: (domain: string, result: { status: string }) => void };
        }
      ).refreshBus?.emit('sessions', { status: 'success' });
      this.clearAutoSaveTimer();
      this.updateHeaderTitle();
    } catch (err) {
      this.plugin.logger.error(t('chatAutoSaveFailedLog'), {
        source: 'chat',
        error: err,
      });
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
              resultSummary: tc.resultSummary,
              normalizedResult: tc.normalizedResult,
              status: tc.status,
              serverName: tc.serverName,
              approved: tc.approved,
            }))
          : undefined,
        citations: m.citations,
        sourceWarnings: m.sourceWarnings,
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
      new Notice(
        t('chatLoadFailedNotice', { message: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  private rebuildMessagesDOM(): void {
    if (!this.messagesArea) return;
    const children = Array.from(this.messagesArea.children);
    for (const child of children) {
      if (!child.hasClass('superpower-inside-typing-indicator')) {
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
      cls: `superpower-inside-chat-message-wrapper ${msg.role}`,
    });
    this.messageEls.set(msg.id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'superpower-inside-chat-avatar' });
    avatar.setText(this.getAvatarText(msg.role));

    const bubbleContainer = wrapper.createDiv({ cls: 'superpower-inside-chat-bubble-container' });
    bubbleContainer.setAttribute('data-message-id', msg.id);
    const meta = bubbleContainer.createDiv({ cls: 'superpower-inside-chat-meta' });
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
          resultSummary: tc.resultSummary,
          normalizedResult: tc.normalizedResult,
          status: tc.status,
          serverName: tc.serverName,
          approved: tc.approved,
        })),
        msg.citations,
        msg.sourceWarnings,
        msg.assistantQuestion,
      );
    } else if (msg.role === 'tool') {
      const bubble = bubbleContainer.createDiv({ cls: 'superpower-inside-chat-bubble tool' });
      this.renderToolBubble(bubble, msg.content, 'success');
    } else {
      const bubble = bubbleContainer.createDiv({
        cls: `superpower-inside-chat-bubble ${msg.role}`,
      });
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
    input.className = 'superpower-inside-session-rename-input';
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
      new Notice(t('chatSaveFolder') + t('providerPathRequiredSuffix'));
      return;
    }
    this.clearAutoSaveTimer();
    this.isStreaming = false;
    this.setLoading(false);
    await this.saveCurrentSession(true);
    const pluginWithBus = this.plugin as unknown as {
      refreshBus?: { emit: (domain: string, result: { status: string }) => void };
    };
    openSessionHistoryModal(
      this.container!,
      this.app,
      this.app.vault,
      this.plugin.settings.chat.saveFolder,
      (filePath: string) => void this.loadSession(filePath),
      this.session.filePath,
      pluginWithBus.refreshBus,
    );
  }

  private async handleSend(): Promise<void> {
    const text = this.inputArea?.value.trim();
    if (!text || this.isStreaming) return;
    this.lastUserPrompt = text;
    this.previousUserQueries.push(text);
    if (this.previousUserQueries.length > 5) this.previousUserQueries.shift();

    const { createCustomOpenAIProvider, createProvider } = await import('../llm/providers');

    const selectedModel = this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel;
    if (!selectedModel) {
      new Notice(t('defaultModelMissingNotice'));
      return;
    }

    const parts = selectedModel.split(':');
    if (parts.length < 2) {
      new Notice(t('modelSettingInvalid'));
      return;
    }

    let key: string;
    let modelName: string;
    let providerLabel: string;
    let provider: LLMProvider;

    if (parts[0] === 'customOpenAI') {
      if (parts.length < 3) {
        new Notice(t('customModelSettingInvalid'));
        return;
      }
      const providerId = parts[1];
      modelName = parts.slice(2).join(':');
      const customProvider = this.plugin.settings.customOpenAIProviders.find(
        (item) => item.id === providerId,
      );
      if (!customProvider?.enabled) {
        new Notice(t('customProviderDisabled'));
        return;
      }
      key = `customOpenAI:${providerId}`;
      providerLabel = customProvider.name.trim() || 'Custom OpenAI-Compatible';
      provider = createCustomOpenAIProvider(customProvider, modelName);
    } else {
      const fixedKey = parts[0] as ProviderKey;
      key = fixedKey;
      modelName = parts.slice(1).join(':');
      const config = this.plugin.settings[fixedKey];
      providerLabel = PROVIDER_LABELS[fixedKey];

      if (!config?.enabled) {
        new Notice(t('noActiveProviderNotice'));
        return;
      }

      provider = createProvider(fixedKey, config, modelName);
    }

    this.inputArea!.value = '';
    this.autoResizeInput();
    this.renderContextPreview('');
    const promptContext = await this.buildPromptContext(text, this.previousUserQueries);
    this.addMessage('user', text, undefined, undefined, {
      providerKey: key,
      providerLabel,
      model: modelName,
      status: 'complete',
      contextAttachments: promptContext.attachments,
    });
    await this.saveCurrentSession(true);
    this.setLoading(true);

    setHidden(this.typingIndicator, false);

    let assistantId = '';
    let assistantWrapper: HTMLElement | undefined;
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const systemPrompt = promptContext.systemPrompt;
      const mentionedServers = this.getEffectiveMcpServerNames(text);
      const toolDefinitions = await this.collectToolDefinitions(mentionedServers);
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
            setHidden(this.typingIndicator, true);
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
      setHidden(this.typingIndicator, true);
      let normalized = normalizeReasoningChunk({
        content: fullText,
        reasoning: fullReasoning || undefined,
      });
      fullText = normalized.content;
      fullReasoning = normalized.reasoning ?? '';

      const firstClassification = classifyAssistantResponse({
        content: fullText,
        reasoning: fullReasoning,
      });
      if (firstClassification.type === 'question') {
        this.updateMessage(
          assistantId,
          firstClassification.content,
          true,
          firstClassification.reasoning || undefined,
          Array.from(toolCallMap.values()),
          {
            providerKey: key,
            providerLabel,
            model: modelName,
            status: 'complete',
            citations: promptContext.citations,
            contextAttachments: promptContext.attachments,
            assistantQuestion: firstClassification.question,
            stopReason: abortController.signal.aborted ? 'cancelled' : 'complete',
            originalContent: firstClassification.originalContent,
          },
        );
        return;
      }

      const parsedToolCalls = this.parseInlineToolRequests(fullText);
      if (parsedToolCalls.length > 0) {
        fullText = this.stripInlineToolRequests(fullText);
        const baseToolCallIndex = toolCallMap.size;
        parsedToolCalls.forEach((toolCall, index) =>
          toolCallMap.set(baseToolCallIndex + index, toolCall),
        );
      }

      let toolCalls = Array.from(toolCallMap.values());

      const hasMentionedServers = mentionedServers.length > 0;
      const hasToolCalls = toolCalls.length > 0;
      const hasSubstantiveAnswer = fullText.trim().length > 50;
      if (
        hasMentionedServers &&
        !hasToolCalls &&
        hasSubstantiveAnswer &&
        this.plugin.settings.chat.enforceMcpTools
      ) {
        const serverNames = mentionedServers.join(', ');
        new Notice(t('mcpRetryToolUseNotice', { servers: serverNames }), 3000);

        const retrySystemPrompt = `${systemPrompt}\n\n[IMPORTANT] You have access to the following MCP server(s): ${serverNames}. You MUST use the available tools to answer the question. Do NOT generate an answer without calling tools. If you need to read files or directories, use the appropriate tools first.`;

        const retryMessages: ChatMessage[] = [
          { role: 'system', content: retrySystemPrompt },
          ...this.messages.slice(-10).map((m) => this.toProviderMessage(m)),
        ];

        fullText = '';
        fullReasoning = '';
        toolCallMap.clear();

        this.updateMessage(assistantId, '', false, undefined, [], {
          providerKey: key,
          providerLabel,
          model: modelName,
          status: 'streaming',
          citations: promptContext.citations,
          contextAttachments: promptContext.attachments,
        });

        await provider.streamChat(
          retryMessages,
          (chunk: StreamChunk) => {
            if (chunk.content) fullText += chunk.content;
            if (chunk.reasoning) fullReasoning += chunk.reasoning;
            if (chunk.toolCalls) this.mergeToolCallDeltas(toolCallMap, chunk.toolCalls);
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

        normalized = normalizeReasoningChunk({
          content: fullText,
          reasoning: fullReasoning || undefined,
        });
        fullText = normalized.content;
        fullReasoning = normalized.reasoning ?? '';

        const retryClassification = classifyAssistantResponse({
          content: fullText,
          reasoning: fullReasoning,
        });
        if (retryClassification.type === 'question') {
          this.updateMessage(
            assistantId,
            retryClassification.content,
            true,
            retryClassification.reasoning || undefined,
            Array.from(toolCallMap.values()),
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              status: 'complete',
              citations: promptContext.citations,
              contextAttachments: promptContext.attachments,
              assistantQuestion: retryClassification.question,
              stopReason: abortController.signal.aborted ? 'cancelled' : 'complete',
              originalContent: retryClassification.originalContent,
            },
          );
          return;
        }

        toolCalls = Array.from(toolCallMap.values());

        if (toolCalls.length === 0 && fullText.trim().length > 50) {
          new Notice(t('mcpRetryNoToolUseNotice', { servers: serverNames }), 5000);
        }
      }

      const sourceWarnings = this.validateAssistantSources(fullText, promptContext.citations);
      this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
        providerKey: key,
        providerLabel,
        model: modelName,
        status: 'complete',
        citations: promptContext.citations,
        sourceWarnings,
        contextAttachments: promptContext.attachments,
        stopReason: abortController.signal.aborted ? 'cancelled' : 'complete',
      });

      const runnableToolCalls = toolCalls.filter((toolCall) => toolCall.status === 'running');
      if (runnableToolCalls.length > 0) {
        toolCalls = await prepareToolCallsForExecution(
          toolCalls,
          this.plugin.mcpRegistry,
          mentionedServers,
          this.plugin.settings.chat.mcpToolExecutionPolicy,
        );
        const pendingApproval = toolCalls.some(
          (toolCall) => toolCall.status === 'running' && toolCall.approved === false,
        );
        if (pendingApproval) {
          this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
            providerKey: key,
            providerLabel,
            model: modelName,
            status: 'complete',
            citations: promptContext.citations,
            sourceWarnings,
            contextAttachments: promptContext.attachments,
          });
          new Notice(t('mcpApprovalRequiredNotice'));
        }
        toolCalls = await this.executeAssistantToolCalls(
          assistantId,
          toolCalls,
          mentionedServers,
          fullReasoning || undefined,
        );
        await this.runToolResponseLoop({
          provider,
          messageId: assistantId,
          baseMessages: messages,
          toolDefinitions,
          toolCalls,
          abortController,
          meta: {
            providerKey: key,
            providerLabel,
            model: modelName,
            citations: promptContext.citations,
            contextAttachments: promptContext.attachments,
          },
          mentionedServers,
          initialText: fullText,
          initialReasoning: fullReasoning,
        });
      }
      if (assistantWrapper) {
        assistantWrapper.classList.remove('generating');
        const generatingLabel = assistantWrapper.querySelector(
          '.superpower-inside-chat-generating-label',
        );
        if (generatingLabel instanceof HTMLElement) {
          generatingLabel.remove();
        }
      }
    } catch (err) {
      setHidden(this.typingIndicator, true);
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (assistantId) {
          const assistantMsg = this.messages.find((message) => message.id === assistantId);
          this.updateMessage(
            assistantId,
            assistantMsg?.content || t('chatGenerationStopped'),
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
        this.updateMessage(
          assistantId,
          t('llmApiError', { detail: errDetail }),
          true,
          undefined,
          undefined,
          {
            providerKey: key,
            providerLabel,
            model: modelName,
            status: 'error',
            errorMessage: errDetail,
            citations: promptContext.citations,
            contextAttachments: promptContext.attachments,
            stopReason: 'error',
          },
        );
        if (assistantWrapper) {
          assistantWrapper.classList.remove('generating');
          const generatingLabel = assistantWrapper.querySelector(
            '.superpower-inside-chat-generating-label',
          );
          if (generatingLabel instanceof HTMLElement) {
            generatingLabel.remove();
          }
        }
      } else {
        const errDetail = this.formatErrorDetail(key, modelName, errorMsg);
        this.addMessage(
          'assistant',
          t('llmApiError', { detail: errDetail }),
          undefined,
          undefined,
          {
            providerKey: key,
            providerLabel,
            model: modelName,
            status: 'error',
            errorMessage: errDetail,
          },
        );
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
      this.sendBtn.setText(loading ? t('stopButton') : t('sendButton'));
    }
    if (this.inputArea) this.inputArea.disabled = loading;
    if (this.mcpBtn) this.mcpBtn.disabled = loading;
    if (this.modelSelectEl) this.modelSelectEl.disabled = loading;
  }

  private toProviderMessage(message: ChatMessageWithMeta): ChatMessage {
    const providerMessage: ChatMessage = {
      role: message.role,
      content:
        message.content ||
        (message.assistantQuestion
          ? t('assistantQuestionProviderContent', {
              prompt: message.assistantQuestion.prompt,
              choices: message.assistantQuestion.choices
                .map((choice) => `- ${choice.label}`)
                .join('\n'),
            })
          : ''),
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

  private async collectToolDefinitions(serverNames: string[]): Promise<ToolDefinition[]> {
    const toolDefinitions: ToolDefinition[] = [];
    for (const serverName of serverNames) {
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
        // 연결이 불안정한 서버는 이번 요청에서 제외합니다.
      }
    }
    return toolDefinitions;
  }

  private async streamFinalAnswerAfterTools(args: {
    provider: LLMProvider;
    messageId: string;
    baseMessages: ChatMessage[];
    toolDefinitions: ToolDefinition[];
    toolCalls: ToolCallRecord[];
    abortController: AbortController;
    meta: MessageMetaInput;
  }): Promise<{ finalText: string; finalReasoning: string; newToolCalls: ToolCallRecord[] }> {
    const successfulToolCalls = args.toolCalls.filter(
      (toolCall) => toolCall.status === 'success' && (toolCall.normalizedResult || toolCall.result),
    );
    if (successfulToolCalls.length === 0) {
      return { finalText: '', finalReasoning: '', newToolCalls: [] };
    }

    let finalText = '';
    let finalReasoning = '';
    const newToolCallMap = new Map<number, ToolCallRecord>();
    const assistantMsg = this.messages.find((message) => message.id === args.messageId);
    const toolCallsPayload = successfulToolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));
    const secondMessages: ChatMessage[] = [
      ...args.baseMessages,
      {
        role: 'assistant',
        content: assistantMsg?.content ?? '',
        toolCalls: toolCallsPayload,
      },
      ...successfulToolCalls.map((toolCall) => ({
        role: 'tool' as const,
        content: toolCall.normalizedResult ?? toolCall.result ?? '',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      })),
    ];

    const visibleToolCalls = [...args.toolCalls];
    await args.provider.streamChat(
      secondMessages,
      (chunk: StreamChunk) => {
        if (chunk.content) finalText += chunk.content;
        if (chunk.reasoning) finalReasoning += chunk.reasoning;
        if (chunk.toolCalls) {
          this.mergeToolCallDeltas(newToolCallMap, chunk.toolCalls);
        }
        this.updateMessage(
          args.messageId,
          finalText,
          false,
          finalReasoning || undefined,
          [...visibleToolCalls, ...Array.from(newToolCallMap.values())],
          { ...args.meta, status: 'streaming' },
        );
      },
      0.7,
      args.toolDefinitions,
      { signal: args.abortController.signal },
    );

    return {
      finalText,
      finalReasoning,
      newToolCalls: Array.from(newToolCallMap.values()),
    };
  }

  private async runToolResponseLoop(args: {
    provider: LLMProvider;
    messageId: string;
    baseMessages: ChatMessage[];
    toolDefinitions: ToolDefinition[];
    toolCalls: ToolCallRecord[];
    abortController: AbortController;
    meta: MessageMetaInput;
    mentionedServers: string[];
    initialText?: string;
    initialReasoning?: string;
  }): Promise<void> {
    const MAX_ROUNDS = 10;
    let round = 0;
    let currentToolCalls = args.toolCalls;
    let accumulatedText = args.initialText ?? '';
    let accumulatedReasoning = args.initialReasoning ?? '';
    const allToolCalls: ToolCallRecord[] = [...args.toolCalls];

    while (round < MAX_ROUNDS) {
      if (args.abortController.signal.aborted) break;
      round++;

      const result = await this.streamFinalAnswerAfterTools({
        provider: args.provider,
        messageId: args.messageId,
        baseMessages: args.baseMessages,
        toolDefinitions: args.toolDefinitions,
        toolCalls: currentToolCalls,
        abortController: args.abortController,
        meta: args.meta,
      });

      accumulatedText += result.finalText;
      if (result.finalReasoning) accumulatedReasoning += result.finalReasoning;

      if (result.newToolCalls.length > 0) {
        allToolCalls.push(...result.newToolCalls);
        currentToolCalls = await this.executeAssistantToolCalls(
          args.messageId,
          result.newToolCalls,
          args.mentionedServers,
          accumulatedReasoning || undefined,
        );
        allToolCalls.push(...currentToolCalls);
        this.updateMessage(
          args.messageId,
          accumulatedText,
          false,
          accumulatedReasoning || undefined,
          allToolCalls,
          { ...args.meta, status: 'streaming' },
        );
        continue;
      }

      if (!accumulatedText.trim()) {
        this.updateMessage(
          args.messageId,
          t('mcpToolFinalAnswerMissing'),
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          {
            ...args.meta,
            status: 'error',
            errorMessage: t('mcpToolFinalAnswerMissing'),
            stopReason: 'tool-failed',
          },
        );
      } else {
        const normalized = normalizeReasoningChunk({
          content: accumulatedText,
          reasoning: accumulatedReasoning || undefined,
        });
        accumulatedText = normalized.content;
        accumulatedReasoning = normalized.reasoning ?? '';
        const classification = classifyAssistantResponse({
          content: accumulatedText,
          reasoning: accumulatedReasoning,
        });
        if (classification.type === 'question') {
          this.updateMessage(
            args.messageId,
            classification.content,
            true,
            classification.reasoning || undefined,
            allToolCalls,
            {
              ...args.meta,
              assistantQuestion: classification.question,
              status: 'complete',
              stopReason: 'complete',
            },
          );
          return;
        }
        const sourceWarnings = this.validateAssistantSources(
          accumulatedText,
          args.meta.citations ?? [],
        );
        this.updateMessage(
          args.messageId,
          accumulatedText,
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          { ...args.meta, sourceWarnings, status: 'complete', stopReason: 'complete' },
        );
      }
      return;
    }

    if (args.abortController.signal.aborted) {
      const sourceWarnings = this.validateAssistantSources(
        accumulatedText,
        args.meta.citations ?? [],
      );
      this.updateMessage(
        args.messageId,
        accumulatedText || t('cancelledLabel'),
        true,
        accumulatedReasoning || undefined,
        allToolCalls,
        { ...args.meta, sourceWarnings, status: 'complete', stopReason: 'cancelled' },
      );
    } else {
      const content = accumulatedText || t('tooManyToolCalls');
      const sourceWarnings = this.validateAssistantSources(content, args.meta.citations ?? []);
      this.updateMessage(
        args.messageId,
        content,
        true,
        accumulatedReasoning || undefined,
        allToolCalls,
        { ...args.meta, sourceWarnings, status: 'error', stopReason: 'error' },
      );
    }
  }

  private getMentionedServerNames(text: string): string[] {
    return this.parseMentions(text)
      .filter((mention) => mention.type === 'server')
      .map((mention) => mention.name);
  }

  private getEffectiveMcpServerNames(text: string): string[] {
    return getPluginAwareServerNames({
      mentionedServerNames: this.getMentionedServerNames(text),
      pluginAwareEnabled: this.plugin.settings.pluginAwareEnabled,
      registry: this.plugin.mcpRegistry,
    });
  }

  private validateAssistantSources(
    content: string,
    citations: SourceCitation[],
  ): SourceValidationWarning[] {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    return validateAnswerSources(content, citations, {
      exists: (path: string) => {
        if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return true;
        if (
          !path.endsWith('.md') &&
          this.app.vault.getAbstractFileByPath(`${path}.md`) instanceof TFile
        ) {
          return true;
        }
        return markdownFiles.some((file) => file.basename === path || file.name === path);
      },
    });
  }

  private async executeAssistantToolCalls(
    messageId: string,
    toolCalls: ToolCallRecord[],
    preferredServerNames: string[],
    reasoning?: string,
  ): Promise<ToolCallRecord[]> {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) {
      throw new Error(t('mcpResultMessageMissing', { messageId }));
    }
    return executeMcpToolCalls({
      registry: this.plugin.mcpRegistry,
      toolCalls,
      preferredServerNames,
      onUpdate: (updatedToolCalls) => {
        const current = this.messages.find((m) => m.id === messageId);
        if (!current) {
          throw new Error(t('mcpResultMessageMissing', { messageId }));
        }
        const isDone = !updatedToolCalls.some(
          (toolCall) => toolCall.status === 'running' && toolCall.approved !== false,
        );
        this.updateMessage(messageId, current.content, isDone, reasoning, updatedToolCalls);
      },
    });
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
      this.getEffectiveMcpServerNames(this.lastUserPrompt ?? ''),
      message.reasoning,
    );
    const stopReason = updated.some((toolCall) => toolCall.status === 'error')
      ? 'tool-failed'
      : 'complete';
    const latestMessage = this.messages.find((m) => m.id === messageId);
    const successfulToolCalls = updated.filter(
      (toolCall) => toolCall.status === 'success' && (toolCall.normalizedResult || toolCall.result),
    );
    if (successfulToolCalls.length > 0 && message.providerKey && message.model) {
      const { createCustomOpenAIProvider, createProvider } = await import('../llm/providers');
      const provider = message.providerKey.startsWith('customOpenAI:')
        ? (() => {
            const providerId = message.providerKey?.split(':')[1] ?? '';
            const customProvider = this.plugin.settings.customOpenAIProviders.find(
              (item) => item.id === providerId,
            );
            if (!customProvider) {
              throw new Error(t('customProviderNotFound'));
            }
            return createCustomOpenAIProvider(customProvider, message.model);
          })()
        : createProvider(
            message.providerKey as ProviderKey,
            this.plugin.settings[message.providerKey as ProviderKey],
            message.model,
          );
      const mentionedServers = this.getEffectiveMcpServerNames(this.lastUserPrompt ?? '');
      const promptContext = await this.buildPromptContext(this.lastUserPrompt ?? '');
      const systemPrompt = promptContext.systemPrompt;
      const messageIndex = this.messages.findIndex((item) => item.id === messageId);
      const previousMessages = this.messages
        .slice(Math.max(0, messageIndex - 10), Math.max(0, messageIndex))
        .map((item) => this.toProviderMessage(item));
      const baseMessages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...previousMessages,
      ];
      await this.runToolResponseLoop({
        provider,
        messageId,
        baseMessages,
        toolDefinitions: await this.collectToolDefinitions(mentionedServers),
        toolCalls: updated,
        abortController: this.abortController ?? new AbortController(),
        meta: {
          providerKey: message.providerKey,
          providerLabel: message.providerLabel,
          model: message.model,
          citations: latestMessage?.citations,
          contextAttachments: latestMessage?.contextAttachments,
        },
        mentionedServers,
      });
    } else {
      this.updateMessage(
        messageId,
        latestMessage?.content ?? message.content,
        true,
        latestMessage?.reasoning ?? message.reasoning,
        updated,
        { stopReason },
      );
    }
    await this.saveCurrentSession(true);
  }

  private async buildPromptContext(
    lastUserText: string,
    previousQueries?: string[],
  ): Promise<ContextBuildResult> {
    const parts: string[] = [];
    const systemPrompt = getEffectiveSystemPrompt(this.plugin.settings, this.sessionSystemPrompt);
    if (systemPrompt) parts.push(systemPrompt);

    if (this.plugin.settings.pluginAwareEnabled) {
      const { formatActivePluginsForPrompt } = await import('../utils/obsidian-compat');
      const pluginInfo = formatActivePluginsForPrompt(this.app);
      if (pluginInfo) parts.push(pluginInfo);
    }

    let ragQuery = lastUserText;
    if (previousQueries && previousQueries.length >= 2) {
      const prev = previousQueries[previousQueries.length - 2];
      const isFollowUp =
        lastUserText.length < 15 ||
        /^(어|아|왜|근데|그래서|하여튼|아니|잠시|계속|다시).{0,30}$/.test(lastUserText);
      if (isFollowUp && prev) {
        ragQuery = prev;
      }
    }

    const ragEngine = (
      this.plugin as unknown as {
        ragEngine?: RagQueryLike | null;
      }
    ).ragEngine;
    const context = await buildChatContext(ragQuery, {
      app: this.app,
      ragEngine,
      mcpRegistry: this.plugin.mcpRegistry,
      knowledgeGraphStore: this.plugin.knowledgeGraphStore,
      ragMinScore: this.plugin.settings.rag.minScore,
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
      cls: 'superpower-inside-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'superpower-inside-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'superpower-inside-mcp-tool-picker-title',
      text: t('selectTool'),
    });
    const closeBtn = title.createEl('button', {
      cls: 'superpower-inside-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const list = panel.createDiv({ cls: 'superpower-inside-mcp-tool-list' });

    for (const server of registry.getEnabledServers()) {
      const client = registry.getClient(server.name);
      if (!client) continue;
      try {
        const tools = await client.listTools();
        if (tools.length === 0) continue;
        list.createDiv({
          cls: 'superpower-inside-mcp-tool-server',
          text: server.name,
        });
        for (const tool of tools) {
          const item = list.createDiv({ cls: 'superpower-inside-mcp-tool-item' });
          item.createDiv({ cls: 'superpower-inside-mcp-tool-name', text: tool.name });
          if (tool.description) {
            item.createDiv({
              cls: 'superpower-inside-mcp-tool-desc',
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
        cls: 'superpower-inside-mcp-empty-state-desc',
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
      cls: 'superpower-inside-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'superpower-inside-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'superpower-inside-mcp-tool-picker-title',
      text: toolName,
    });
    const closeBtn = title.createEl('button', {
      cls: 'superpower-inside-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const form = panel.createDiv({ cls: 'superpower-inside-mcp-tool-form' });
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
      const row = form.createDiv({ cls: 'superpower-inside-mcp-tool-form-row' });
      row.createEl('label', {
        cls: 'superpower-inside-mcp-tool-form-label',
        text: propName,
      });
      if (propDef.description) {
        row.createDiv({
          cls: 'superpower-inside-mcp-tool-form-desc',
          text: propDef.description,
        });
      }

      let inputEl: HTMLInputElement | HTMLTextAreaElement;
      const type = propDef.type ?? 'string';
      if (type === 'boolean') {
        inputEl = row.createEl('input', {
          type: 'checkbox',
          cls: 'superpower-inside-mcp-tool-form-input',
        });
      } else if (type === 'number' || type === 'integer') {
        inputEl = row.createEl('input', {
          type: 'number',
          cls: 'superpower-inside-mcp-tool-form-input',
        });
      } else if (type === 'string') {
        inputEl = row.createEl('input', {
          type: 'text',
          cls: 'superpower-inside-mcp-tool-form-input',
        });
      } else {
        inputEl = row.createEl('textarea', {
          cls: 'superpower-inside-mcp-tool-form-input',
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
      cls: 'superpower-inside-mcp-tool-form-actions',
    });
    const execBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-send-btn',
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
                t('mcpToolInvalidField', { field: key, detail: t('validationNeedsNumber') }),
              );
              continue;
            }
            continue;
          }
          if (def.minimum !== undefined && numVal < def.minimum) {
            validationErrors.push(
              t('mcpToolInvalidField', {
                field: key,
                detail: t('validationMinValue', { minimum: def.minimum }),
              }),
            );
            continue;
          }
          if (def.maximum !== undefined && numVal > def.maximum) {
            validationErrors.push(
              t('mcpToolInvalidField', {
                field: key,
                detail: t('validationMaxValue', { maximum: def.maximum }),
              }),
            );
            continue;
          }
          values[key] = numVal;
        } else {
          const trimmed = el.value.trim();
          if (required && trimmed === '') {
            validationErrors.push(
              t('mcpToolInvalidField', { field: key, detail: t('validationRequiredValue') }),
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
                    detail: t('validationPatternDetail', { pattern: def.pattern }),
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
      const normalized = normalizeToolResult(result);
      const formatted = normalized.displayText;
      if (messageId) {
        this.updateToolCallInMessage(messageId, toolName, {
          result: formatted,
          resultSummary: formatted,
          normalizedResult: normalized.modelText,
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
        resultSummary: patch.resultSummary,
        normalizedResult: patch.normalizedResult,
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
        return t('mcpValidationPattern', { pattern: match[1] });
      }
      const fieldMatch = rawMsg.match(/'([^']+)'/);
      if (fieldMatch) {
        return t('mcpValidationField', { field: fieldMatch[1] });
      }
      return t('mcpValidationSchemaFailed');
    }
    if (rawMsg.includes('required')) {
      return t('mcpValidationRequiredMissing');
    }
    return rawMsg;
  }

  /** LLM API 에러 발생 시 진단 정보를 포함한 상세 메시지 생성 */
  private formatErrorDetail(providerKey: string, model: string, rawError: string): string {
    const timestamp = new Date().toISOString();
    const statusMatch = rawError.match(/status\s*(\d{3})/);
    const statusCode = statusMatch ? statusMatch[1] : '???';

    const providerHints: Record<number, string> = {
      400: t('apiHintBadRequest'),
      401: t('apiHintUnauthorized'),
      402: t('apiHintPaymentRequired'),
      403: t('apiHintForbidden'),
      404: t('apiHintNotFound'),
      429: t('apiHintRateLimited'),
      500: t('apiHintServerError'),
      502: t('apiHintBadGateway'),
      503: t('apiHintServiceUnavailable'),
    };

    const hint =
      statusCode !== '???'
        ? (providerHints[Number(statusCode)] ?? '')
        : rawError.includes('Failed to fetch')
          ? t('apiHintFetchCors')
          : '';
    const detail = [
      `[${timestamp}] ${providerKey}/${model}`,
      t('apiErrorCode', { code: statusCode }),
      ...(hint ? [t('apiErrorLikelyCause', { hint })] : []),
      t('apiErrorRaw', { error: rawError }),
    ];
    return detail.join('\n');
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

    const callRow = bubble.createDiv({ cls: 'superpower-inside-tool-call' });
    callRow.createSpan({ cls: 'superpower-inside-tool-call-icon', text: '🔧' });
    callRow.createSpan({
      cls: 'superpower-inside-tool-call-name',
      text: toolName || t('messageTool'),
    });
    const statusBadge = callRow.createSpan({
      cls: `superpower-inside-tool-call-status ${status}`,
    });
    if (status === 'running') {
      statusBadge.setText('');
      const dots = statusBadge.createSpan({ cls: 'superpower-inside-tool-running-dots' });
      dots.createSpan({});
      dots.createSpan({});
      dots.createSpan({});
    } else if (status === 'success') {
      statusBadge.setText('✓');
    } else if (status === 'error') {
      statusBadge.setText('✗');
    }

    const resultArea = bubble.createDiv({ cls: 'superpower-inside-tool-result' });
    if (resultText && status !== 'running') {
      void this.renderMarkdownBubble(resultArea, resultText);
    }

    if (resultText && status !== 'running') {
      const toggle = bubble.createDiv({ cls: 'superpower-inside-tool-result-toggle collapsed' });
      toggle.createSpan({ cls: 'superpower-inside-tool-result-toggle-chevron', text: '▾' });
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
