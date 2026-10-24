import { ItemView, Menu, WorkspaceLeaf, Notice, TFile, setIcon, type Events } from 'obsidian';
import type { PluginLike } from '../settings';

function isPluginSearching(plugin: PluginLike): boolean {
  return (
    (plugin as PluginLike & { isRagSearching?: () => boolean }).isRagSearching?.() ??
    plugin.isRagIndexing?.() ??
    false
  );
}
import { resolveChatModelState } from './chat-model-state';
import { buildStoredChatModelRef, prepareChatProviderForModel } from '../llm/provider-resolution';
import type {
  ChatMessage,
  LLMProvider,
  StreamChunk,
  ToolCallDelta,
  ToolDefinition,
  ToolChoice,
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
import { formatAnswerNoteContent, loadChat, saveChat } from './persistence';
import { buildChatTraceConfigSnapshot } from '../debug/chat-trace-config';
import { buildChatTraceRuntimeSnapshot } from '../debug/chat-trace-runtime';
import { SaveAnswerModal } from './save-answer-modal';
import { summarizeSessionTitle } from './session-title';
import { captureWorkspaceMentionFiles, type WorkspaceMentionFiles } from './workspace-mentions';
import { collectTagMentionFiles } from './tag-mentions';
import { planTagMentionsRust, planPluginAwareIndicesRust } from '../rag/rust-core';
import { renderComposerReferencePreview } from './composer-reference-preview';
import { openSessionHistoryModal } from './session-modal';
import {
  buildChatContext,
  createAppMentionResolver,
  parseMentions as parseContextMentions,
  resolveChatRagEngine,
  type ContextBuildResult,
  type ParsedMention,
  type RagQueryLike,
} from './context';
import {
  ExplicitMcpToolDiscoveryError,
  collectExternalMcpToolDefinitions,
  scopeMcpServerNames,
} from './mcp-tool-catalog';
import {
  appendAssistantToolRound,
  collectCompletedMcpServerNames,
  collectToolCitations,
  createNativeToolAnswerRepairPrompt,
  enforceNativeToolAnswerContract,
  executeAssistantToolCalls as executeToolCalls,
  joinAssistantToolRoundText,
  markRepeatedToolCalls,
  prepareAssistantToolCalls,
  resolveAssistantToolLoopText,
  resolveToolLoopTerminalText,
  selectProviderReinjectableToolCalls,
  type ToolTranscriptProtocol,
} from './tool-execution';
import { NATIVE_VAULT_TOOL_NAME, NATIVE_VAULT_NAMED_TOOL_NAMES } from '../agent/native-vault-tool';
import { finalizeEvidenceAnswer } from './evidence-collection';
import { summarizeIndexedConfidence } from '../search/confidence';
import {
  selectDisplayedAnswerCitations,
  selectGroundedRepairCitations,
} from '../agent/citation-selection';
import {
  getVaultResearchPhaseLabel,
  isWholeVaultResearchRequest,
  isScopedVaultResearchRequest,
} from '../agent/research-agent';
import { reviewIndexedVault } from '../agent/indexed-vault-review';
import { collectIndexedSearchSource } from '../search/indexed-search-deps';
import { openPromptLibraryModal } from './prompt-library-modal';
import { getEffectiveSystemPrompt } from './prompt-library';
import { getPluginAwareServerNames } from './plugin-aware-context7';
import { buildPluginAwareDocumentation } from './plugin-aware-docs';
import { getActivePluginInfo, openPluginSettings } from '../utils/obsidian-compat';
import { confirmWithModal } from '../utils/modal-prompts';
import { validateAnswerSources } from './source-validation';
import {
  classifyAssistantResponse,
  shouldRenderAssistantQuestion,
} from './assistant-response-classifier';
import { formatAssistantQuestionAnswer } from './assistant-question';
import {
  classifyChatFailure,
  createChatErrorPresentation,
  createChatRecoveryActions,
  getChatHttpStatus,
  getChatRetryAfterMs,
  redactDebugDetail,
  type ChatRecoveryAction,
} from './chat-error-actions';
import {
  createLiveContextPreviewChips,
  createComposerDraftSnapshot,
  createComposerLoadingState,
  resolveComposerKeyAction,
  resolveComposerMentionTrigger,
  type ComposerDraftSnapshot,
} from './chat-composer';
import { evaluateToolTrace } from './quality-evaluation';
import { createChatReadinessSnapshot, type ChatReadinessItem } from './chat-readiness';
import {
  createChatMessageMetaItems,
  createChatMessageTechnicalSummary,
} from './chat-message-renderer';
import {
  createAssistantResponseLayout,
  type AssistantResponseLayoutController,
  type AssistantResponseLayoutState,
} from './assistant-response-layout';
import {
  CHAT_MESSAGE_ACTION_ATTRIBUTE,
  createChatMessageActionId,
  createChatMessageActionRenderState,
  createRecoveryMessageActionId,
} from './chat-message-actions';
import { createStreamingRenderPlan, STREAMING_CURSOR_CLASS } from './chat-streaming-renderer';
import { expandVaultSearchPlan, expandVaultSearchQueryLocally } from './vault-query-expansion';
import { requestQueryVariants, splitLongQuestion } from './query-variants';
import {
  createDataBoundarySnapshot,
  createResearchDataBoundarySnapshot,
  withDataBoundaryProviderUsage,
} from './context-composer';
import {
  createAssistantVariantGroup,
  createAssistantVariantGroupByRoot,
  createEditResendPlan,
  createRegenerationDraft,
  createVariantComparisonRows,
  markMessageRegenerated,
  selectActiveConversationMessages,
  selectPreviousUserQuestions,
  type RegenerationDraft,
} from './conversation-variants';
import { enhanceCodeBlocks, renderMarkdownToElement } from './markdown';
import { renderChatVariantNav } from './chat-variant-nav';
import { createProviderWaitStatus } from './provider-wait';
import { SourcePanel } from './source-panel';
import { ToolCallPanel } from './tool-call-panel';
import { renderAnswerDiagnostics, hasAnswerDiagnostics } from './answer-diagnostics';
import { observeChatRetrieval } from './retrieval-trace';
import { withTurnUsage } from './turn-usage';
import {
  createCompatibilityToolPrompt,
  createToolEvidencePrompt,
  parseCompatibilityToolTurn,
  sanitizeNonExecutingToolTurn,
} from './tool-protocol';
import {
  createToolApprovalResumePlan,
  resolveToolApprovalQuestionContext,
} from './tool-approval-resume';
import {
  createChatTurnState,
  getChatTurnStageStatus,
  transitionChatTurn,
  type ChatTurnEvent,
  type ChatTurnStage,
  type ChatTurnState,
} from './turn-state';
import { formatNumber, t } from '../i18n';
import { isDomInstance } from '../utils/dom';
import { promptWithModal } from '../utils/modal-prompts';
import { EditMessageModal } from './edit-modal';
import { MCP_STATUS_CHANGE_EVENT } from '../mcp/connection-state';
import { planNativeToolCompatibilityFallbackRust } from '../rag/rust-core';
import { prepareLoadedSessionMessages } from './session-recovery';
import { buildProviderConversation } from './provider-conversation';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  appendAgenticCheckpoint,
  planAgenticToolTurn,
  selectAgenticToolDefinitions,
} from './tool-orchestration';
import { selectBoundedToolDefinitions } from './tool-catalog-budget';
import { createMcpToolBindingAllowlist } from './mcp-tool-wire';
import {
  isChatRunActive,
  isChatRunOwner,
  planChatRunFinalization,
  type ChatRunHandle,
} from './run-ownership';

export const CHAT_VIEW_TYPE = 'superpower-inside-chat';
/** 준비 상태 표시를 다시 그리는 간격입니다(색인 진행률 갱신). */
const READINESS_REFRESH_INTERVAL_MS = 1000;
const HIDDEN_CLASS = 'superpower-inside-hidden';
const MAX_TOOL_CALLS_PER_ROUND = 8;
const MAX_TOOL_CALLS_PER_TURN = 64;
const MENTION_TOP_VAR = '--superpower-inside-mention-top';
const MENTION_BOTTOM_VAR = '--superpower-inside-mention-bottom';
const CHAT_INPUT_HEIGHT_VAR = '--superpower-inside-chat-input-height';

function getProviderReferenceIdentity(reference: string): string {
  const [kind = '', id = ''] = reference.split(':');
  return kind === 'profile' || kind === 'customOpenAI' ? `${kind}:${id}` : kind;
}

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
  usageSnapshot?: ChatMessageWithMeta['usageSnapshot'];
  retrievalTrace?: ChatMessageWithMeta['retrievalTrace'];
  indexedReviewDiagnostics?: ChatMessageWithMeta['indexedReviewDiagnostics'];
  indexedReviewNotice?: string;
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
  branchRoot?: string;
  variantOf?: string;
  stopReason?: ChatMessageWithMeta['stopReason'];
  originalContent?: string;
  providerCapability?: ChatMessageWithMeta['providerCapability'];
  turnStage?: ChatTurnStage;
  toolRound?: number;
  contextBudgetSnapshot?: ChatMessageWithMeta['contextBudgetSnapshot'];
  dataBoundarySnapshot?: ChatMessageWithMeta['dataBoundarySnapshot'];
  errorKind?: ChatMessageWithMeta['errorKind'];
  errorRetryAt?: string;
  actionHistory?: ChatMessageWithMeta['actionHistory'];
}

export class ChatView extends ItemView {
  private plugin: PluginLike;
  private messages: ChatMessageWithMeta[];
  private sessionSystemPrompt: string | null;
  private isStreaming: boolean;
  private autoScroll: boolean;
  private session: SessionState;
  private autoSaveTimer: number | null;

  private container: HTMLElement | null;
  private headerEl: HTMLElement | null;
  private sessionTitleEl: HTMLElement | null;
  private sessionInfoEl: HTMLElement | null;
  private messagesArea: HTMLElement | null;
  private inputArea: HTMLTextAreaElement | null;
  private sendBtn: HTMLButtonElement | null;
  private typingIndicator: HTMLElement | null;
  private emptyStateEl: HTMLElement | null;
  private scrollBtn: HTMLElement | null;
  private readinessEl: HTMLElement | null;
  private readinessTicker: number | null = null;
  private preparationErrorEl: HTMLElement | null = null;
  private runControlEl: HTMLElement | null;
  private modelSelectEl: HTMLSelectElement | null;
  private contextPreviewEl: HTMLElement | null;
  private mentionDropdown: HTMLElement | null;
  private mentionQuery: string;
  private mentionSelectedIndex: number;
  private mentionItems: {
    label: string;
    value: string;
    type: 'workspace' | 'server' | 'file' | 'folder' | 'tag';
  }[];
  private mentionStartIndex: number;
  private mentionMode: 'at' | 'wiki';
  private readonly mentionDropdownId: string;
  private abortController: AbortController | null;
  private activeRun: ChatRunHandle<AbortController> | null;
  private runTokenSequence: number;
  private lastUserPrompt: string | null;
  private skipAutoRagOnce = false;
  private pendingSubmittedDraft: ComposerDraftSnapshot | null;
  private pendingRegeneration: RegenerationDraft | null;
  private readonly sourcePanel: SourcePanel;
  private readonly toolCallPanel: ToolCallPanel;
  private readonly assistantResponseLayouts = new WeakMap<
    HTMLElement,
    AssistantResponseLayoutController
  >();
  private retrievalObserver?: {
    run: ChatRunHandle<AbortController>;
    record: (record: import('./types').ChatRetrievalRecord) => void;
  };
  private readonly compatibilityToolModels: Set<string>;
  private lastStreamingMarkdownAt: number;
  private localToolCallSequence: number;

  // RefreshBus 구독 해제 함수들
  private refreshBusUnsubscribers: (() => void)[] = [];

  private messageEls: Map<string, HTMLElement>;
  // shortcut: 재생성 버전 선택은 재로딩 시 마지막 variant로 초기화된다. 선택 영속화가 필요해지면 저장 meta 필드와 round-trip 테스트로 확장한다.
  private readonly activeVariantByRoot = new Map<string, string>();

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
    this.typingIndicator = null;
    this.emptyStateEl = null;
    this.scrollBtn = null;
    this.readinessEl = null;
    this.runControlEl = null;
    this.modelSelectEl = null;
    this.contextPreviewEl = null;
    this.mentionDropdown = null;
    this.mentionQuery = '';
    this.mentionSelectedIndex = -1;
    this.mentionItems = [];
    this.mentionStartIndex = -1;
    this.mentionMode = 'at';
    this.mentionDropdownId = `superpower-inside-mention-dropdown-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.abortController = null;
    this.activeRun = null;
    this.runTokenSequence = 0;
    this.lastUserPrompt = null;
    this.pendingSubmittedDraft = null;
    this.pendingRegeneration = null;
    this.lastStreamingMarkdownAt = 0;
    this.localToolCallSequence = 0;
    this.compatibilityToolModels = new Set();
    this.sourcePanel = new SourcePanel({
      setIcon: (element, icon) => setIcon(element, icon),
      openCitation: (citation) => this.openCitation(citation),
      copyCitationLink: (citation, button) => this.copyCitationLink(citation, button),
      insertCitation: (citation) => this.insertCitationIntoActiveNote(citation),
      repairSourceWarning: (warning, messageId) => this.repairSourceWarning(warning, messageId),
    });
    this.toolCallPanel = new ToolCallPanel({
      setIcon: (element, icon) => setIcon(element, icon),
      approveToolCall: (messageId, toolCallId) => this.approveToolCall(messageId, toolCallId),
      renderMarkdown: (container, content) => this.renderMarkdownBubble(container, content),
    });
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

    const messagesShell = root.createDiv({ cls: 'superpower-inside-chat-messages-shell' });
    this.messagesArea = messagesShell.createDiv({
      cls: 'superpower-inside-chat-messages',
      attr: { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text' },
    });
    this.messagesArea.addEventListener('scroll', () => this.handleScroll());
    this.renderEmptyState();

    this.scrollBtn = messagesShell.createEl('button', {
      cls: 'superpower-inside-scroll-to-bottom',
      attr: { type: 'button', 'aria-label': t('chatScrollToBottom') },
    });
    setHidden(this.scrollBtn, true);
    setIcon(this.scrollBtn, 'arrow-down');
    this.scrollBtn.createSpan({ text: t('chatScrollToBottom') });
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
    const refreshReferences = (): void => this.renderContextPreview(this.inputArea?.value ?? '');
    this.registerEvent(this.app.workspace.on('file-open', refreshReferences));
    this.registerEvent(this.app.workspace.on('layout-change', refreshReferences));
    this.registerEvent(this.app.workspace.on('active-leaf-change', refreshReferences));
    this.registerEvent(this.app.vault.on('create', refreshReferences));
    this.registerEvent(this.app.vault.on('delete', refreshReferences));
    this.registerEvent(this.app.vault.on('rename', refreshReferences));
    this.registerMcpStatusEvents();
    this.registerSessionFileEvents();
    this.registerRefreshBusEvents();
    void this.plugin
      .prepareRagForChat()
      .then(() => this.renderChatReadiness())
      .catch(() => this.renderChatReadiness());
  }

  private registerRefreshBusEvents(): void {
    this.refreshBusUnsubscribers.push(
      this.plugin.refreshBus.on('mcp', () => {
        this.renderChatReadiness();
      }),
    );
    this.refreshBusUnsubscribers.push(
      this.plugin.refreshBus.on('models', () => {
        this.populateModelSelect();
        this.renderChatReadiness();
      }),
    );
    this.refreshBusUnsubscribers.push(
      this.plugin.refreshBus.on('rag', () => {
        this.renderChatReadiness();
      }),
    );
  }

  private registerMcpStatusEvents(): void {
    this.registerEvent(
      (this.app.workspace as unknown as Events).on(MCP_STATUS_CHANGE_EVENT, () => {
        this.renderChatReadiness();
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.readinessTicker !== null) {
      window.clearTimeout(this.readinessTicker);
      this.readinessTicker = null;
    }
    this.clearAutoSaveTimer();
    this.invalidateActiveChatRun(false);
    this.cancelStreamingMarkdownRender();
    // RefreshBus 구독 해제
    for (const unsub of this.refreshBusUnsubscribers) {
      unsub();
    }
    this.refreshBusUnsubscribers = [];
    await this.saveCurrentSession();
  }

  private renderEmptyState(): void {
    if (this.emptyStateEl && !this.emptyStateEl.isConnected) {
      this.emptyStateEl = null;
    }
    if (!this.messagesArea || this.messages.length > 0 || this.emptyStateEl) return;
    const emptyState = this.messagesArea.createDiv({
      cls: 'superpower-inside-chat-empty-state',
      attr: { role: 'note' },
    });
    this.emptyStateEl = emptyState;
    emptyState.createDiv({
      cls: 'superpower-inside-chat-empty-state-title',
      text: t('chatEmptyStateTitle'),
    });
    emptyState.createDiv({
      cls: 'superpower-inside-chat-empty-state-detail',
      text: t('chatEmptyStateDetail'),
    });
    const prompts = emptyState.createDiv({ cls: 'superpower-inside-chat-empty-state-prompts' });
    for (const prompt of [t('chatEmptyStatePromptSummary'), t('chatEmptyStatePromptConnections')]) {
      const button = prompts.createEl('button', { text: prompt, attr: { type: 'button' } });
      button.addEventListener('click', () => {
        if (!this.inputArea) return;
        this.inputArea.value = prompt;
        this.autoResizeInput();
        this.renderContextPreview(prompt);
        this.inputArea.focus();
      });
    }
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

    this.sessionTitleEl = titleSection.createEl('button', {
      cls: 'superpower-inside-chat-session-title',
      text: this.session.title || t('chatTabTitle'),
      attr: { type: 'button', 'aria-label': t('chatRenameSession') },
    });
    this.sessionTitleEl.addEventListener('click', () => this.promptRenameSession());

    this.sessionInfoEl = titleSection.createDiv({ cls: 'superpower-inside-chat-session-info' });
    this.updateSessionInfo();

    const actions = this.headerEl.createDiv({ cls: 'superpower-inside-chat-header-actions' });

    const newChatBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      attr: { type: 'button', 'aria-label': t('chatNewSession'), title: t('chatNewSession') },
    });
    newChatBtn.setText(t('chatNewSession'));
    newChatBtn.addEventListener('click', () => void this.startNewSession());

    const historyBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      attr: { type: 'button', 'aria-label': t('chatHistory'), title: t('chatHistory') },
    });
    historyBtn.setText(t('chatHistory'));
    historyBtn.addEventListener('click', () => void this.openSessionHistoryModal());

    const moreBtn = actions.createEl('button', {
      cls: 'superpower-inside-chat-header-btn',
      attr: {
        type: 'button',
        'aria-label': t('assistantResponseMoreActions'),
        title: t('assistantResponseMoreActions'),
        'aria-haspopup': 'menu',
      },
    });
    moreBtn.setText(t('assistantResponseMoreActions'));
    moreBtn.addEventListener('click', () => {
      const menu = new Menu();
      menu.setUseNativeMenu(false);
      menu.addItem((item) =>
        item
          .setTitle(t('chatSearchButton'))
          .setIcon('search')
          .onClick(() => void this.focusMessageSearch()),
      );
      menu.addItem((item) =>
        item
          .setTitle(t('promptLibraryTitle'))
          .setIcon('settings-2')
          .onClick(() => {
            moreBtn.focus();
            openPromptLibraryModal({
              containerEl: container,
              plugin: this.plugin,
              currentSessionPrompt: this.sessionSystemPrompt,
              selectedModel: this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel,
              onApplyToSession: (prompt) => {
                this.sessionSystemPrompt = prompt.trim() || null;
                this.markDirtyAndAutoSave();
              },
            });
          }),
      );
      const rect = moreBtn.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right, y: rect.bottom }, container.ownerDocument);
    });
  }

  private buildInputArea(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'superpower-inside-chat-input-wrapper' });

    this.readinessEl = wrapper.createDiv({
      cls: 'superpower-inside-chat-readiness',
      attr: { role: 'status', 'aria-live': 'polite' },
    });

    this.preparationErrorEl = wrapper.createDiv({
      cls: 'superpower-inside-chat-preparation-error',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    setHidden(this.preparationErrorEl, true);

    this.runControlEl = wrapper.createDiv({
      cls: 'superpower-inside-chat-run-control',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    setHidden(this.runControlEl, true);
    const runStatus = this.runControlEl.createSpan({
      cls: 'superpower-inside-chat-run-control-status',
    });
    const runStatusIcon = runStatus.createSpan({
      cls: 'superpower-inside-chat-run-control-status-icon',
    });
    runStatusIcon.addClass('superpower-inside-composer-spinner');
    runStatusIcon.setAttribute('aria-hidden', 'true');
    runStatus.createSpan({ text: t('chatRunActive') });

    this.contextPreviewEl = wrapper.createDiv({
      cls: 'superpower-inside-chat-context-preview',
      attr: { 'aria-live': 'polite', 'aria-label': t('chatWorkspaceMentions') },
    });
    this.contextPreviewEl.addEventListener('focusin', () => this.hideMentionDropdown());
    this.renderContextPreview('');

    const surface = wrapper.createDiv({ cls: 'superpower-inside-chat-composer-surface' });
    const label = surface.createEl('label', {
      cls: 'superpower-inside-chat-input-label',
      text: t('chatQuestionLabel'),
    });
    const inputRow = surface.createDiv({ cls: 'superpower-inside-chat-input-area' });
    this.inputArea = inputRow.createEl('textarea', {
      cls: 'superpower-inside-chat-input',
      attr: {
        placeholder: t('chatInputPlaceholder'),
        rows: '2',
        'aria-label': t('chatInputPlaceholder'),
        'aria-controls': this.mentionDropdownId,
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
      },
    });
    label.htmlFor = `superpower-inside-chat-input-${this.mentionDropdownId}`;
    this.inputArea.id = label.htmlFor;
    this.inputArea.addEventListener('keydown', (e) => this.handleInputKeydown(e));
    this.inputArea.addEventListener('input', () => {
      this.autoResizeInput();
      this.handleMentionInput();
      this.renderContextPreview(this.inputArea?.value ?? '');
    });
    this.inputArea.addEventListener('blur', () => {
      window.setTimeout(() => this.hideMentionDropdown(), 200);
    });

    const toolbar = surface.createDiv({ cls: 'superpower-inside-chat-input-toolbar' });
    this.modelSelectEl = toolbar.createEl('select', {
      cls: 'superpower-inside-chat-model-select',
      attr: { 'aria-label': t('modelSelector') },
    });
    this.modelSelectEl.addEventListener('change', () => this.renderChatReadiness());
    this.populateModelSelect();

    this.sendBtn = toolbar.createEl('button', {
      cls: 'superpower-inside-chat-send-btn',
      text: t('sendButton'),
      attr: { type: 'button' },
    });
    this.sendBtn.addEventListener('click', () => {
      if (this.isStreaming) {
        this.stopStreaming();
        return;
      }
      void this.handleSend();
    });

    this.renderChatReadiness();
  }

  private async focusMessageSearch(): Promise<void> {
    const query = await promptWithModal(this.app, t('chatMessageSearchPrompt'), {
      confirmText: t('chatSearchButton'),
    });
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
    const resolver = createAppMentionResolver(this.app, this.plugin.mcpRegistry);
    renderComposerReferencePreview(
      this.contextPreviewEl,
      createLiveContextPreviewChips(text, resolver),
    );
  }

  private invalidateActiveChatRun(restoreDraft: boolean): void {
    const run = this.activeRun;
    if (run) {
      run.controller.abort();
      if (isChatRunOwner(this.activeRun, run)) {
        this.activeRun = null;
        if (this.abortController === run.controller) {
          this.abortController = null;
        }
      }
    } else {
      this.abortController?.abort();
      this.abortController = null;
    }
    this.isStreaming = false;
    setHidden(this.typingIndicator, true);
    if (restoreDraft) {
      this.restoreSubmittedDraft();
    } else {
      this.pendingSubmittedDraft = null;
      this.pendingRegeneration = null;
    }
    this.setLoading(false);
  }

  private stopStreaming(): void {
    const current = [...this.messages].reverse().find((message) => message.status === 'streaming');
    this.invalidateActiveChatRun(true);
    if (current) {
      this.updateMessage(
        current.id,
        current.content || t('chatGenerationStopped'),
        true,
        current.reasoning,
        this.cancelRunningToolCalls(current.toolCalls),
        { status: 'complete', stopReason: 'cancelled' },
      );
    }
    this.inputArea?.focus({ preventScroll: true });
  }

  private cancelRunningToolCalls(toolCalls?: ToolCallRecord[]): ToolCallRecord[] | undefined {
    return toolCalls?.map((toolCall) =>
      toolCall.status === 'running'
        ? {
            ...toolCall,
            status: 'error' as const,
            result: t('cancelledLabel'),
            resultSummary: t('cancelledLabel'),
          }
        : { ...toolCall },
    );
  }

  private populateModelSelect(): void {
    if (!this.modelSelectEl) return;
    this.modelSelectEl.empty();

    const modelState = resolveChatModelState(this.plugin.settings);
    const allModels = modelState.options;

    if (allModels.length === 0) {
      const opt = this.modelSelectEl.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      this.modelSelectEl.disabled = true;
      return;
    }

    if (!modelState.selectedModel) {
      const opt = this.modelSelectEl.createEl('option');
      opt.value = '';
      opt.text = t('chatReadinessSelectModelAction');
    }
    for (const m of allModels) {
      const opt = this.modelSelectEl.createEl('option');
      opt.value = m.value;
      opt.text = m.label;
    }

    this.modelSelectEl.value = modelState.selectedModel;
    this.modelSelectEl.disabled = false;
    this.renderChatReadiness();
  }

  private renderChatReadiness(): void {
    if (!this.readinessEl) return;
    // 준비가 끝날 때까지 진행률을 갱신합니다. 색인 이벤트가 없어도 화면이 멈춰 보이지 않게 합니다.
    if (this.readinessTicker !== null) {
      window.clearTimeout(this.readinessTicker);
      this.readinessTicker = null;
    }
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: this.getEnabledProviderCount(),
      availableModelCount: this.getAvailableModelCount(),
      selectedModel: this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel,
      retrieval: this.plugin.getRetrievalReadiness(),
      indexing: this.plugin.getRagIndexingProgressSummary?.() ?? null,
    });
    if (snapshot.status !== 'ready') {
      this.readinessTicker = window.setTimeout(() => {
        this.readinessTicker = null;
        this.renderChatReadiness();
      }, READINESS_REFRESH_INTERVAL_MS);
    }
    this.readinessEl.empty();
    this.readinessEl.className = `superpower-inside-chat-readiness ${snapshot.status}`;
    setHidden(this.readinessEl, snapshot.status === 'ready');
    if (this.sendBtn && !this.isStreaming) {
      this.sendBtn.disabled = snapshot.blocksSend;
    }
    if (snapshot.items.length !== 1) {
      this.readinessEl.createSpan({
        cls: 'superpower-inside-chat-readiness-primary',
        text: snapshot.primaryText,
      });
    }
    if (snapshot.items.length === 0) return;
    const list = this.readinessEl.createDiv({ cls: 'superpower-inside-chat-readiness-items' });
    for (const item of snapshot.items.slice(0, 3)) {
      const row = list.createDiv({
        cls: `superpower-inside-chat-readiness-item ${item.kind} severity-${item.severity} tone-${item.tone}`,
      });
      row.createSpan({ cls: 'superpower-inside-chat-readiness-label', text: item.label });
      row.createSpan({ cls: 'superpower-inside-chat-readiness-detail', text: item.detail });
      if (item.action) {
        const action = row.createEl('button', {
          cls: 'superpower-inside-chat-readiness-action',
          text: this.getReadinessActionText(item),
          attr: { type: 'button' },
        });
        action.addEventListener('click', () => void this.handleReadinessAction(item));
      }
    }
  }

  private getReadinessActionText(item: ChatReadinessItem): string {
    if (item.action === 'select-model') return t('chatReadinessSelectModelAction');
    if (item.action === 'configure-provider') return t('chatReadinessConfigureProviderAction');
    return item.label;
  }

  private getEnabledProviderCount(): number {
    return resolveChatModelState(this.plugin.settings).enabledProviderCount;
  }

  private getAvailableModelCount(): number {
    return resolveChatModelState(this.plugin.settings).availableModelCount;
  }

  private handleReadinessAction(item: ChatReadinessItem): void {
    if (item.action === 'select-model') {
      this.modelSelectEl?.focus();
      return;
    }
    openPluginSettings(this.app, this.plugin.manifest?.id ?? 'superpower-inside');
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const mentionOpen = Boolean(
      this.mentionDropdown && !this.mentionDropdown.hasClass(HIDDEN_CLASS),
    );
    const action = resolveComposerKeyAction({
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      mentionOpen,
      isStreaming: this.isStreaming,
    });

    if (mentionOpen) {
      if (action === 'select-next') {
        e.preventDefault();
        this.selectMentionItem(this.mentionSelectedIndex + 1);
        return;
      }
      if (action === 'select-previous') {
        e.preventDefault();
        this.selectMentionItem(this.mentionSelectedIndex - 1);
        return;
      }
      if (action === 'confirm-mention') {
        e.preventDefault();
        this.confirmMentionSelection();
        return;
      }
      if (action === 'close-dropdown') {
        e.preventDefault();
        this.hideMentionDropdown();
        return;
      }
    }

    if (action === 'cancel') {
      e.preventDefault();
      this.stopStreaming();
      return;
    }
    if (action === 'send' || action === 'force-send') {
      e.preventDefault();
      void this.handleSend();
    }
  }

  private handleMentionInput(): void {
    if (!this.inputArea) return;
    const cursorPos = this.inputArea.selectionStart || 0;
    const trigger = resolveComposerMentionTrigger(this.inputArea.value.slice(0, cursorPos));
    if (!trigger) {
      this.hideMentionDropdown();
      return;
    }
    this.mentionMode = trigger.mode;
    this.mentionQuery = trigger.query;
    this.mentionStartIndex = trigger.startIndex;
    this.buildMentionItems();
    this.showMentionDropdown();
  }

  private buildMentionItems(): void {
    this.mentionItems = [];
    const query = this.mentionQuery;
    // `[[...]]`는 vault 경로만 가리키므로 작업공간·서버·태그 후보는 제외합니다.
    if (this.mentionMode === 'at') {
      for (const value of ['current', 'tabs']) {
        if (value.includes(query)) {
          this.mentionItems.push({
            label:
              value === 'current'
                ? t('chatCurrentMention')
                : t('chatTabsMention', {
                    count: captureWorkspaceMentionFiles(this.app).tabs.length,
                  }),
            value,
            type: 'workspace',
          });
        }
      }

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
    }

    // 첨부(PDF 등)도 직접 지정할 수 있도록 markdown 외 파일도 후보에 포함합니다.
    const files = this.app.vault.getFiles();
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

    if (this.mentionMode === 'at') {
      const tagSnapshot = collectTagMentionFiles(this.app);
      for (const tag of planTagMentionsRust(tagSnapshot.tags, query)?.tags ?? []) {
        this.mentionItems.push({ label: `@${tag}`, value: tag, type: 'tag' });
      }
    }
    this.mentionSelectedIndex = this.mentionItems.length > 0 ? 0 : -1;
  }

  private showMentionDropdown(): void {
    if (!this.inputArea || !this.container || this.mentionItems.length === 0) {
      this.hideMentionDropdown();
      return;
    }

    if (!this.mentionDropdown) {
      this.mentionDropdown = this.container.createDiv({
        cls: 'superpower-inside-mention-dropdown',
        attr: { id: this.mentionDropdownId, role: 'listbox' },
      });
    }
    this.mentionDropdown.empty();
    setHidden(this.mentionDropdown, false);
    this.inputArea.setAttribute('aria-expanded', 'true');
    for (const [type, label, icon] of [
      ['workspace', t('chatWorkspaceMentions'), 'panels-top-left'],
      ['server', t('mcpMentionServers'), 'plug'],
      ['file', t('mcpMentionFiles'), 'file-text'],
      ['folder', t('mcpMentionFolders'), 'folder'],
      ['tag', t('chatMentionTags'), 'hash'],
    ] as const) {
      const items = this.mentionItems.filter((item) => item.type === type);
      if (items.length === 0) continue;
      const group = this.mentionDropdown.createDiv({ cls: 'superpower-inside-mention-group' });
      group.createDiv({
        cls: 'superpower-inside-mention-group-label',
        text: label,
      });
      for (const item of items) {
        const el = group.createDiv({ cls: 'superpower-inside-mention-item' });
        if (item.type === 'tag') {
          el.addClass('superpower-inside-mention-item-tag');
          el.setAttribute('title', item.label);
        }
        el.id = `${this.mentionDropdownId}-${this.mentionItems.indexOf(item)}`;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', 'false');
        setIcon(el.createSpan({ cls: 'superpower-inside-mention-item-icon' }), icon);
        el.createSpan({ cls: 'superpower-inside-mention-item-name', text: item.label });
        el.addEventListener('mousedown', (event) => event.preventDefault());
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
    this.inputArea?.setAttribute('aria-activedescendant', items[targetIndex].id);
    items[targetIndex].scrollIntoView({ block: 'nearest' });
    for (let i = 0; i < items.length; i++) {
      items[i].toggleClass('selected', i === targetIndex);
      if (isDomInstance(items[i], HTMLElement)) {
        items[i].setAttribute('aria-selected', i === targetIndex ? 'true' : 'false');
      }
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
    type: 'workspace' | 'server' | 'file' | 'folder' | 'tag';
  }): void {
    if (!this.inputArea) return;
    const value = this.inputArea.value;
    const before = value.slice(0, this.mentionStartIndex);
    const after = value.slice(this.inputArea.selectionStart || 0);
    // 경로에 공백이 포함된 경우 브래킷으로 감싸서 parseMentions가 올바르게 파싱하도록 함
    const needsBrackets = item.type !== 'server' && item.value.includes(' ');
    const insertText =
      this.mentionMode === 'wiki'
        ? `[[${item.type === 'folder' ? `${item.value}/` : item.value}]]`
        : needsBrackets
          ? `@[${item.value}] `
          : `@${item.value} `;
    this.inputArea.value = before + insertText + after;
    const newCursorPos = before.length + insertText.length;
    this.inputArea.setSelectionRange(newCursorPos, newCursorPos);
    this.hideMentionDropdown();
    this.autoResizeInput();
    this.renderContextPreview(this.inputArea.value);
    this.inputArea.focus();
  }

  private hideMentionDropdown(): void {
    this.inputArea?.setAttribute('aria-expanded', 'false');
    this.inputArea?.removeAttribute('aria-activedescendant');
    if (this.mentionDropdown) {
      setHidden(this.mentionDropdown, true);
    }
    this.mentionSelectedIndex = -1;
    this.mentionItems = [];
    this.mentionStartIndex = -1;
    this.mentionMode = 'at';
  }

  private markdownRenderTimer: number | null = null;
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
      usageSnapshot: metaInput?.usageSnapshot,
      retrievalTrace: metaInput?.retrievalTrace,
      indexedReviewDiagnostics: metaInput?.indexedReviewDiagnostics,
      indexedReviewNotice: metaInput?.indexedReviewNotice,
      id,
      role,
      content,
      timestamp: now.getTime(),
      createdAt: nowIso,
      updatedAt: nowIso,
      providerKey: metaInput?.providerKey,
      providerLabel: metaInput?.providerLabel,
      model: metaInput?.model,
      providerCapability: metaInput?.providerCapability,
      turnStage: metaInput?.turnStage,
      toolRound: metaInput?.toolRound,
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
      branchRoot: metaInput?.branchRoot,
      variantOf: metaInput?.variantOf,
      stopReason: metaInput?.stopReason,
      contextBudgetSnapshot: metaInput?.contextBudgetSnapshot,
      dataBoundarySnapshot: metaInput?.dataBoundarySnapshot,
      errorKind: metaInput?.errorKind,
      errorRetryAt: metaInput?.errorRetryAt,
      actionHistory: metaInput?.actionHistory,
    };
    this.messages.push(msg);
    this.emptyStateEl?.remove();
    this.emptyStateEl = null;
    this.markDirtyAndAutoSave();

    const wrapper = this.messagesArea!.createDiv({
      cls: `superpower-inside-chat-message-wrapper ${role}`,
    });
    this.messageEls.set(id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'superpower-inside-chat-avatar' });
    this.renderMessageAvatar(avatar, role);

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
    this.renderMessageContextSections(bubbleContainer, msg);
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
      message.indexedReviewDiagnostics =
        metaInput?.indexedReviewDiagnostics ?? message.indexedReviewDiagnostics;
      message.indexedReviewNotice = metaInput?.indexedReviewNotice ?? message.indexedReviewNotice;
      if (
        isDone &&
        content &&
        message.indexedReviewNotice &&
        !content.includes(message.indexedReviewNotice)
      ) {
        content = `${content}\n\n${message.indexedReviewNotice}`;
      }
      message.content = content;
      message.reasoning = reasoning;
      if (metaInput?.originalContent !== undefined) {
        message.originalContent = metaInput.originalContent;
      }
      message.updatedAt = new Date().toISOString();
      message.providerKey = metaInput?.providerKey ?? message.providerKey;
      message.providerLabel = metaInput?.providerLabel ?? message.providerLabel;
      message.model = metaInput?.model ?? message.model;
      message.usageSnapshot = metaInput?.usageSnapshot ?? message.usageSnapshot;
      message.retrievalTrace = metaInput?.retrievalTrace ?? message.retrievalTrace;
      message.providerCapability = metaInput?.providerCapability ?? message.providerCapability;
      message.turnStage = metaInput?.turnStage ?? message.turnStage;
      message.toolRound = metaInput?.toolRound ?? message.toolRound;
      message.status = metaInput?.status ?? (isDone ? 'complete' : 'streaming');
      message.errorMessage = metaInput?.errorMessage;
      message.citations = metaInput?.citations ?? message.citations;
      message.sourceWarnings = metaInput?.sourceWarnings ?? message.sourceWarnings;
      message.contextAttachments = metaInput?.contextAttachments ?? message.contextAttachments;
      message.assistantQuestion = metaInput?.assistantQuestion;
      message.branchOf = metaInput?.branchOf ?? message.branchOf;
      message.branchRoot = metaInput?.branchRoot ?? message.branchRoot;
      message.variantOf = metaInput?.variantOf ?? message.variantOf;
      message.stopReason = metaInput?.stopReason ?? (isDone ? 'complete' : message.stopReason);
      message.contextBudgetSnapshot =
        metaInput?.contextBudgetSnapshot ?? message.contextBudgetSnapshot;
      message.dataBoundarySnapshot =
        metaInput?.dataBoundarySnapshot ?? message.dataBoundarySnapshot;
      message.errorKind = metaInput?.errorKind ?? message.errorKind;
      message.errorRetryAt = metaInput?.errorRetryAt ?? message.errorRetryAt;
      message.actionHistory = metaInput?.actionHistory ?? message.actionHistory;
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
      if (message) {
        const bubbleContainer = wrapper.querySelector('.superpower-inside-chat-bubble-container');
        if (isDomInstance(bubbleContainer, HTMLElement)) {
          this.renderMessageContextSections(bubbleContainer, message);
          if (isDone) this.renderMessageActions(bubbleContainer, message);
        }
      }
      if (this.autoScroll) {
        this.scrollToBottom();
      }
      return;
    }

    if (isTool) {
      const bubble = wrapper.querySelector('.superpower-inside-chat-bubble.tool');
      if (isDomInstance(bubble, HTMLElement)) {
        const status = isDone ? 'success' : 'running';
        this.renderToolBubble(bubble, content, status);
      }
    } else {
      const bubble = wrapper.querySelector('.superpower-inside-chat-bubble');
      if (isDomInstance(bubble, HTMLElement)) {
        if (!isDone) {
          renderPlainTextWithBreaks(bubble, content);
        } else {
          void this.renderMarkdownBubble(bubble, content);
        }
      }
    }

    if (message) {
      const bubbleContainer = wrapper.querySelector('.superpower-inside-chat-bubble-container');
      if (isDomInstance(bubbleContainer, HTMLElement)) {
        this.renderMessageContextSections(bubbleContainer, message);
      }
    }

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private getAssistantResponseSourceCount(input: {
    citations?: readonly SourceCitation[];
    sourceWarnings?: readonly SourceValidationWarning[];
    contextAttachments?: readonly ContextAttachment[];
  }): number {
    if ((input.citations?.length ?? 0) > 0) return input.citations?.length ?? 0;
    if ((input.sourceWarnings?.length ?? 0) > 0) return input.sourceWarnings?.length ?? 0;
    return input.contextAttachments?.length ?? 0;
  }

  private createAssistantResponseLayoutState(
    msg: ChatMessageWithMeta,
  ): AssistantResponseLayoutState {
    return {
      hasAnswer: Boolean(msg.content.trim() || msg.assistantQuestion),
      hasWork: Boolean(msg.reasoning?.trim() || msg.toolCalls?.length || hasAnswerDiagnostics(msg)),
      sourceCount: this.getAssistantResponseSourceCount(msg),
      isComplete:
        msg.turnStage === 'complete' || (msg.turnStage === undefined && msg.status === 'complete'),
    };
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
    const calls = toolCalls ?? [];
    const sourceCount = this.getAssistantResponseSourceCount({
      citations,
      sourceWarnings,
    });
    bubbleContainer.querySelector('.superpower-inside-chat-assistant-response')?.remove();
    const messageId = bubbleContainer.getAttribute('data-message-id') ?? 'message';
    const layout = createAssistantResponseLayout(bubbleContainer, {
      idPrefix: `superpower-inside-assistant-response-${encodeURIComponent(messageId)}`,
      ariaLabel: t('assistantResponseTabsAria'),
      labels: {
        answer: t('answerLabel'),
        work: t('assistantResponseWorkTab'),
        sources: (count) =>
          count > 0
            ? t('assistantResponseSourcesTabCount', { count })
            : t('assistantResponseSourcesTab'),
      },
      state: {
        hasAnswer: Boolean(content.trim() || assistantQuestion),
        hasWork: Boolean(reasoning?.trim() || calls.length || shouldShowStreamingPlaceholders),
        sourceCount,
        isComplete: !this.isStreaming && Boolean(content.trim() || assistantQuestion),
      },
    });
    this.assistantResponseLayouts.set(bubbleContainer, layout);
    this.renderAssistantResponseCollapseControl(bubbleContainer, layout.root);

    const thinking = layout.panels.work.createEl('details', {
      cls: 'superpower-inside-chat-thinking superpower-inside-chat-reasoning',
    });
    setHidden(thinking, !(reasoning || shouldShowStreamingPlaceholders));
    if (shouldShowStreamingPlaceholders) {
      thinking.open = true;
    }
    thinking.addEventListener('toggle', () => {
      if (this.autoScroll) this.scrollToBottom();
    });
    const thinkingSummary = thinking.createEl('summary');
    const thinkingIcon = thinkingSummary.createSpan({
      cls: 'superpower-inside-chat-layer-icon',
    });
    setIcon(thinkingIcon, 'brain');
    thinkingSummary.createSpan({ text: t('reasoningLabel') });
    const thinkingContent = thinking.createDiv({
      cls: 'superpower-inside-chat-thinking-content superpower-inside-chat-reasoning-content',
    });
    thinkingContent.setText(reasoning ?? t('thinkingPlaceholder'));

    const toolCallsSection = layout.panels.work.createDiv({
      cls: 'superpower-inside-chat-tool-calls',
    });
    const hasToolCalls = calls.length > 0;
    setHidden(toolCallsSection, !hasToolCalls);
    this.toolCallPanel.renderToolCallsSection(toolCallsSection, calls, false);

    const answerLayer = layout.panels.answer.createDiv({
      cls: 'superpower-inside-chat-answer',
    });
    const answerLabel = answerLayer.createDiv({
      cls: 'superpower-inside-chat-answer-label',
    });
    const answerIcon = answerLabel.createSpan({ cls: 'superpower-inside-chat-layer-icon' });
    setIcon(answerIcon, 'message-square-text');
    answerLabel.createSpan({ text: t('answerLabel') });
    const bubble = answerLayer.createDiv({
      cls: 'superpower-inside-chat-bubble assistant',
    });
    if (assistantQuestion) {
      this.renderAssistantQuestionCard(bubble, assistantQuestion);
    } else if (content.trim()) {
      void this.renderMarkdownBubble(bubble, content).then(() =>
        this.sourcePanel.linkAnswerCitationMarkers(bubbleContainer, citations ?? []),
      );
    } else {
      bubble.setText(content);
    }
    this.sourcePanel.renderCitationsSection(layout.panels.sources, citations ?? [], {
      mode: 'embedded',
    });
    this.sourcePanel.renderSourceWarningsSection(
      layout.panels.sources,
      sourceWarnings ?? [],
      messageId,
    );
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
    if (!isDomInstance(bubbleContainer, HTMLElement)) return;

    let layout = this.assistantResponseLayouts.get(bubbleContainer);
    if (!layout) {
      this.createAssistantLayers(
        bubbleContainer,
        content,
        reasoning,
        toolCalls,
        citations,
        sourceWarnings,
        assistantQuestion,
      );
      layout = this.assistantResponseLayouts.get(bubbleContainer);
      if (!layout) return;
    }

    let thinking = bubbleContainer.querySelector('.superpower-inside-chat-thinking');
    if (!isDomInstance(thinking, HTMLDetailsElement)) {
      this.createAssistantLayers(
        bubbleContainer,
        content,
        reasoning,
        toolCalls,
        citations,
        sourceWarnings,
        assistantQuestion,
      );
      layout = this.assistantResponseLayouts.get(bubbleContainer);
      if (!layout) return;
      thinking = bubbleContainer.querySelector('.superpower-inside-chat-thinking');
    }
    this.renderAssistantResponseCollapseControl(bubbleContainer, layout.root);

    if (isDomInstance(thinking, HTMLDetailsElement)) {
      const hasReasoning = reasoning !== undefined && reasoning.length > 0;
      setHidden(thinking, !(hasReasoning || !isDone));
      const thinkingContent = thinking.querySelector('.superpower-inside-chat-thinking-content');
      if (isDomInstance(thinkingContent, HTMLElement)) {
        if (!isDone) {
          const text = hasReasoning ? reasoning : t('thinkingPlaceholder');
          renderPlainTextWithBreaks(thinkingContent, text ?? '');
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

    const toolCallsSection = bubbleContainer.querySelector('.superpower-inside-chat-tool-calls');
    if (isDomInstance(toolCallsSection, HTMLElement)) {
      const calls = toolCalls ?? [];
      setHidden(toolCallsSection, calls.length === 0);
      this.toolCallPanel.renderToolCallsSection(toolCallsSection, calls, false);
    }

    const bubble = bubbleContainer.querySelector('.superpower-inside-chat-bubble.assistant');
    if (isDomInstance(bubble, HTMLElement)) {
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
          if (isDomInstance(meta, HTMLElement)) {
            meta.appendChild(label);
          }
        }
        this.scheduleStreamingMarkdownRender(bubble, content);
      } else {
        this.cancelStreamingMarkdownRender();
        if (assistantQuestion) {
          this.renderAssistantQuestionCard(bubble, assistantQuestion);
        } else {
          void this.renderMarkdownBubble(bubble, content).then(() =>
            this.sourcePanel.linkAnswerCitationMarkers(bubbleContainer, citations ?? []),
          );
        }
        if (isDomInstance(generatingLabel, HTMLElement)) {
          generatingLabel.remove();
        }
        wrapper.classList.remove('generating');
      }
    }
    this.sourcePanel.renderCitationsSection(layout.panels.sources, citations ?? [], {
      mode: 'embedded',
    });
    this.sourcePanel.renderSourceWarningsSection(
      layout.panels.sources,
      sourceWarnings ?? [],
      bubbleContainer.getAttribute('data-message-id') ?? '',
    );
    layout.update({
      hasAnswer: Boolean(content.trim() || assistantQuestion),
      hasWork: Boolean(reasoning?.trim() || toolCalls?.length),
      sourceCount: this.getAssistantResponseSourceCount({
        citations,
        sourceWarnings,
      }),
      isComplete: isDone,
    });
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
    const plan = createStreamingRenderPlan({
      content,
      isFinal: false,
      now: Date.now(),
      lastMarkdownAt: this.lastStreamingMarkdownAt,
      minIntervalMs: ChatView.MARKDOWN_RENDER_INTERVAL,
    });
    renderPlainTextWithBreaks(bubble, content);

    const existingCursor = bubble.querySelector(`.${STREAMING_CURSOR_CLASS}`);
    if (!existingCursor) {
      const cursor = bubble.createSpan({ cls: plan.cursorClassName });
      bubble.appendChild(cursor);
    }

    this.pendingMarkdownEl = bubble;
    this.pendingMarkdownContent = content;

    if (plan.renderMarkdown && !this.markdownRenderTimer) {
      this.markdownRenderTimer = window.setTimeout(() => {
        this.markdownRenderTimer = null;
        if (this.pendingMarkdownEl && this.pendingMarkdownEl.isConnected) {
          const el = this.pendingMarkdownEl;
          const txt = this.pendingMarkdownContent;
          if (txt.trim()) {
            void this.renderMarkdownBubble(el, txt);
            this.lastStreamingMarkdownAt = Date.now();
            const cursor = el.createSpan({ cls: STREAMING_CURSOR_CLASS });
            el.appendChild(cursor);
          }
        }
      }, ChatView.MARKDOWN_RENDER_INTERVAL);
    }
  }

  private cancelStreamingMarkdownRender(): void {
    if (this.markdownRenderTimer) {
      window.clearTimeout(this.markdownRenderTimer);
      this.markdownRenderTimer = null;
    }
    this.pendingMarkdownEl = null;
    this.pendingMarkdownContent = '';
    this.lastStreamingMarkdownAt = 0;
  }

  private async openCitation(citation: SourceCitation): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(citation.filePath);
    if (!(file instanceof TFile)) {
      new Notice(t('sourceFileNotFound', { path: citation.filePath }));
      return;
    }
    try {
      await this.app.workspace.getLeaf(false).openFile(file);
      new Notice(t('sourceOpenedNotice', { path: citation.filePath }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('sourceOpenFailedNotice', { message }), 5000);
    }
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
    try {
      await navigator.clipboard.writeText(`[[${citation.filePath}${heading}]]`);
      button.setText(t('copied'));
      window.setTimeout(() => button.setText(t('sourceCopyLinkAction')), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('sourceCopyLinkFailedNotice', { message }), 5000);
    }
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
    try {
      await this.app.vault.append(
        active,
        t('sourceInsertBlock', { link, preview: citation.preview }),
      );
      new Notice(t('sourceInsertedNotice'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('sourceInsertFailedNotice', { message }), 5000);
    }
  }

  private async renderMarkdownBubble(bubble: HTMLElement, content: string): Promise<void> {
    await renderMarkdownToElement(this.app, bubble, content, '', this);
    enhanceCodeBlocks(bubble);
    this.stylizeMentions(bubble);
  }

  private stylizeMentions(container: HTMLElement): void {
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
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
          fragments.push(doc.createTextNode(text.slice(lastIndex, match.index)));
        }
        const span = doc.createElement('span');
        span.addClass('superpower-inside-mention-inline');
        span.setText(match[1]);
        fragments.push(span);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragments.push(doc.createTextNode(text.slice(lastIndex)));
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

  private renderMessageAvatar(avatar: HTMLElement, role: string): void {
    avatar.empty();
    avatar.setAttribute('aria-hidden', 'true');
    switch (role) {
      case 'user':
        setIcon(avatar, 'user-round');
        return;
      case 'assistant':
        setIcon(avatar, 'sparkles');
        return;
      case 'system':
        setIcon(avatar, 'settings-2');
        return;
      case 'tool':
        setIcon(avatar, 'wrench');
        return;
      default:
        setIcon(avatar, 'circle');
    }
  }

  private renderMessageMeta(meta: HTMLElement, msg: ChatMessageWithMeta): void {
    meta.empty();
    const technicalSummary = createChatMessageTechnicalSummary(msg);
    if (technicalSummary) {
      meta.setAttribute('title', technicalSummary);
    } else {
      meta.removeAttribute('title');
    }
    for (const item of createChatMessageMetaItems(msg)) {
      const el = meta.createSpan({ cls: item.className });
      if (item.kind === 'status') {
        const icon = el.createSpan({
          cls: 'superpower-inside-chat-message-status-icon',
          attr: { 'aria-hidden': 'true' },
        });
        setIcon(
          icon,
          msg.status === 'complete'
            ? 'check'
            : msg.status === 'error'
              ? 'circle-alert'
              : 'loader-circle',
        );
        el.createSpan({ text: item.text });
      } else {
        el.setText(item.text);
      }
      if (item.title) {
        el.setAttribute('title', item.title);
      }
    }
  }

  private renderAssistantResponseCollapseControl(
    bubbleContainer: HTMLElement,
    response: HTMLElement,
  ): void {
    const meta = bubbleContainer.querySelector('.superpower-inside-chat-meta');
    if (!isDomInstance(meta, HTMLElement)) return;
    meta.querySelector('.superpower-inside-chat-response-collapse')?.remove();
    const button = meta.createEl('button', {
      cls: 'superpower-inside-chat-response-collapse',
      attr: {
        type: 'button',
        'aria-controls': response.id,
      },
    });
    const setExpanded = (expanded: boolean): void => {
      const label = expanded ? t('assistantResponseCollapse') : t('assistantResponseExpand');
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      response.hidden = !expanded;
      const actions = bubbleContainer.querySelector('.superpower-inside-chat-message-actions');
      if (isDomInstance(actions, HTMLElement)) {
        actions.hidden = !expanded;
      }
      setIcon(button, expanded ? 'chevron-down' : 'chevron-right');
    };
    setExpanded(!response.hidden);
    button.addEventListener('click', () => {
      setExpanded(button.getAttribute('aria-expanded') !== 'true');
    });
  }

  private updateMessageMeta(wrapper: HTMLElement, msg: ChatMessageWithMeta): void {
    const meta = wrapper.querySelector('.superpower-inside-chat-meta');
    if (isDomInstance(meta, HTMLElement)) {
      this.renderMessageMeta(meta, msg);
    }
  }

  private renderMessageContextSections(
    bubbleContainer: HTMLElement,
    msg: ChatMessageWithMeta,
  ): void {
    if (msg.role !== 'assistant') return;
    const layout = this.assistantResponseLayouts.get(bubbleContainer);
    if (layout) renderAnswerDiagnostics(layout.panels.work, msg);
    const sourcesPanel = layout?.panels.sources ?? bubbleContainer;
    this.sourcePanel.renderContextAttachmentsSection(sourcesPanel, msg.contextAttachments ?? []);
    this.sourcePanel.renderContextBudgetSection(sourcesPanel, msg.contextBudgetSnapshot);
    this.sourcePanel.renderDataBoundarySection(sourcesPanel, msg.dataBoundarySnapshot);
    this.renderVariantComparisonSection(sourcesPanel, msg);
    this.sourcePanel.linkAnswerCitationMarkers(bubbleContainer, msg.citations ?? []);
    layout?.update(this.createAssistantResponseLayoutState(msg));
  }

  private renderVariantComparisonSection(
    bubbleContainer: HTMLElement,
    msg: ChatMessageWithMeta,
  ): void {
    let section = bubbleContainer.querySelector('.superpower-inside-chat-variant-compare');
    const rows = createVariantComparisonRows(this.messages, msg.id);
    if (rows.length < 2) {
      section?.remove();
      return;
    }
    if (!isDomInstance(section, HTMLElement)) {
      section = bubbleContainer.createEl('details', {
        cls: 'superpower-inside-chat-variant-compare',
      });
    }
    section.empty();
    if (isDomInstance(section, HTMLDetailsElement)) {
      section.open = rows.some((row) => row.active && row.id === msg.id);
    }
    section.createEl('summary', { text: t('variantCompareTitle') });
    for (const row of rows) {
      const item = section.createDiv({
        cls: `superpower-inside-chat-variant-row ${row.active ? 'active' : ''}`,
      });
      item.createSpan({
        cls: 'superpower-inside-chat-variant-provider',
        text: t('variantCompareRow', {
          provider: row.providerText,
          citations: row.citationCount,
          warnings: row.sourceWarningCount,
          tools: row.toolCallCount,
          contexts: row.contextAttachmentCount,
        }),
      });
      if (row.active) {
        item.createSpan({
          cls: 'superpower-inside-chat-variant-active',
          text: t('variantCompareActive'),
        });
      }
    }
  }

  private renderVariantNavIfNeeded(container: HTMLElement, msg: ChatMessageWithMeta): void {
    const variantGroup = createAssistantVariantGroup(
      this.messages,
      msg.id,
      this.activeVariantByRoot,
    );
    if (!variantGroup || variantGroup.variants.length < 2) return;
    renderChatVariantNav(container, {
      total: variantGroup.variants.length,
      activeIndex: variantGroup.activeIndex,
      labels: {
        prev: t('variantNavPrev'),
        next: t('variantNavNext'),
        position: t('variantNavPosition', {
          current: variantGroup.activeIndex + 1,
          total: variantGroup.variants.length,
        }),
      },
      setIcon,
      onSwitch: (targetIndex) => this.switchActiveVariant(variantGroup.rootId, targetIndex),
    });
  }

  private renderMessageActions(container: HTMLElement, msg: ChatMessageWithMeta): void {
    const existing = container.querySelector('.superpower-inside-chat-message-actions');
    const existingActions = isDomInstance(existing, HTMLElement) ? existing : null;
    const existingDiagnostics = existingActions?.querySelector(
      '.superpower-inside-chat-error-diagnostics',
    );
    const existingDiagnosticsToggle = existingDiagnostics?.querySelector(
      '.superpower-inside-chat-error-diagnostics-toggle',
    );
    const activeElement = container.ownerDocument.activeElement;
    const focusedActionId =
      existingActions &&
      isDomInstance(activeElement, HTMLElement) &&
      existingActions.contains(activeElement)
        ? activeElement.getAttribute(CHAT_MESSAGE_ACTION_ATTRIBUTE)
        : undefined;
    const renderState = createChatMessageActionRenderState({
      messageId: msg.id,
      focusedActionId,
      diagnosticsExpanded: existingDiagnosticsToggle?.getAttribute('aria-expanded'),
      legacyDiagnosticsOpen: isDomInstance(existingDiagnostics, HTMLDetailsElement)
        ? existingDiagnostics.open
        : undefined,
      diagnosticsContentId: existingDiagnosticsToggle?.getAttribute('aria-controls'),
    });
    existing?.remove();
    const isComplete =
      msg.turnStage === 'complete' || (msg.turnStage === undefined && msg.status === 'complete');
    if (msg.role === 'assistant' && !msg.errorKind && !isComplete && msg.stopReason !== 'cancelled')
      return;
    const actions = container.createDiv({ cls: 'superpower-inside-chat-message-actions' });
    const response = this.assistantResponseLayouts.get(container)?.root;
    actions.hidden = Boolean(response?.hidden);
    const actionButtonRegistry = new Map<string, HTMLButtonElement>();
    const registerActionButton = (
      button: HTMLButtonElement,
      actionId: string,
    ): HTMLButtonElement => {
      button.setAttribute(CHAT_MESSAGE_ACTION_ATTRIBUTE, actionId);
      actionButtonRegistry.set(actionId, button);
      return button;
    };
    const restoreActionFocus = (): void => {
      if (!renderState.focusedActionId) return;
      actionButtonRegistry.get(renderState.focusedActionId)?.focus({ preventScroll: true });
    };

    if (msg.role === 'assistant' && msg.errorKind) {
      actions.addClass('has-error');
      for (const [index, recoveryAction] of createChatRecoveryActions(msg.errorKind).entries()) {
        const button = registerActionButton(
          actions.createEl('button', {
            text: recoveryAction.label,
            cls: index === 0 ? 'mod-cta' : undefined,
          }),
          createRecoveryMessageActionId(recoveryAction.id),
        );
        if (
          recoveryAction.id === 'retry-same-context' &&
          msg.errorRetryAt &&
          Date.parse(msg.errorRetryAt) > Date.now()
        ) {
          button.disabled = true;
          const waitMs = Date.parse(msg.errorRetryAt) - Date.now();
          window.setTimeout(
            () => {
              if (button.isConnected) button.disabled = false;
            },
            Math.min(waitMs, 2_147_483_647),
          );
        }
        button.addEventListener('click', () => {
          void this.handleChatRecoveryAction(recoveryAction, msg, button);
        });
      }
      this.renderVariantNavIfNeeded(actions, msg);
      if (msg.errorMessage) {
        const diagnostics = actions.createDiv({
          cls: 'superpower-inside-chat-error-diagnostics',
        });
        const diagnosticsToggle = registerActionButton(
          diagnostics.createEl('button', {
            cls: 'superpower-inside-chat-error-diagnostics-toggle',
            attr: {
              type: 'button',
              'aria-controls': renderState.diagnosticsContentId,
            },
          }),
          createChatMessageActionId('error-diagnostics'),
        );
        const diagnosticsIcon = diagnosticsToggle.createSpan({
          cls: 'superpower-inside-chat-error-diagnostics-toggle-icon',
        });
        diagnosticsToggle.createSpan({ text: t('chatErrorDiagnostics') });
        const diagnosticsContent = diagnostics.createEl('pre', {
          text: msg.errorMessage,
        });
        diagnosticsContent.id = renderState.diagnosticsContentId;
        const setDiagnosticsExpanded = (expanded: boolean): void => {
          diagnosticsToggle.setAttribute('aria-expanded', String(expanded));
          diagnosticsContent.hidden = !expanded;
          setIcon(diagnosticsIcon, expanded ? 'chevron-down' : 'chevron-right');
        };
        setDiagnosticsExpanded(renderState.diagnosticsExpanded);
        diagnosticsToggle.addEventListener('click', () => {
          setDiagnosticsExpanded(diagnosticsToggle.getAttribute('aria-expanded') !== 'true');
        });
      }
      restoreActionFocus();
      return;
    }

    if (msg.stopReason === 'cancelled') {
      actions.createDiv({ text: t('chatGenerationStopped'), attr: { role: 'status' } });
      const retry = actions.createEl('button', {
        text: t('messageRetryAction'),
        attr: { type: 'button' },
      });
      retry.addEventListener('click', () => void this.regenerateFromAssistant(msg.id));
    }

    const actionButtons = actions.createDiv({
      cls: 'superpower-inside-chat-message-action-buttons',
    });
    const createVisibleAction = (
      label: string,
      icon: string,
      actionId: string,
    ): HTMLButtonElement => {
      const button = registerActionButton(
        actionButtons.createEl('button', {
          attr: { type: 'button', 'aria-label': label, title: label },
        }),
        actionId,
      );
      const iconEl = button.createSpan({
        cls: 'superpower-inside-chat-message-action-icon',
        attr: { 'aria-hidden': 'true' },
      });
      setIcon(iconEl, icon);
      button.createSpan({ text: label });
      return button;
    };
    const copyBtn = createVisibleAction(
      t('messageCopyAction'),
      'copy',
      createChatMessageActionId('copy'),
    );
    copyBtn.addEventListener('click', () => void this.copyMessage(msg, copyBtn));

    if (msg.role === 'assistant') {
      const saveBtn = createVisibleAction(
        t('messageNewNoteAction'),
        'file-plus-2',
        createChatMessageActionId('save-as-note'),
      );
      saveBtn.addEventListener('click', () => this.saveMessageAsNote(msg, saveBtn));

      this.renderVariantNavIfNeeded(actionButtons, msg);

      const moreLabel = t('assistantResponseMoreActions');
      const moreBtn = registerActionButton(
        actionButtons.createEl('button', {
          cls: 'superpower-inside-chat-message-more-actions',
          attr: {
            type: 'button',
            'aria-label': moreLabel,
            title: moreLabel,
            'aria-haspopup': 'menu',
          },
        }),
        createChatMessageActionId('more'),
      );
      moreBtn.setText(moreLabel);
      moreBtn.addEventListener('click', () => {
        const menu = new Menu();
        menu.setUseNativeMenu(false);
        menu.addItem((item) =>
          item
            .setTitle(t('sourceInsertIntoNoteAction'))
            .setIcon('text-cursor-input')
            .onClick(() => void this.insertMessageIntoActiveNote(msg)),
        );
        menu.addItem((item) =>
          item
            .setTitle(t('messageRetryAction'))
            .setIcon('refresh-cw')
            .onClick(() => void this.regenerateFromAssistant(msg.id)),
        );
        menu.addItem((item) =>
          item
            .setTitle(t('messageBranchAction'))
            .setIcon('git-branch')
            .onClick(() => void this.branchFromMessage(msg.id)),
        );
        const rect = moreBtn.getBoundingClientRect();
        menu.showAtPosition({ x: rect.right, y: rect.bottom });
      });
    } else if (msg.role === 'user') {
      const editBtn = createVisibleAction(
        t('messageEditAndSendAction'),
        'pencil',
        createChatMessageActionId('edit-and-send'),
      );
      editBtn.addEventListener('click', () => void this.editAndResendUserMessage(msg));
    }
    restoreActionFocus();
  }

  private async handleChatRecoveryAction(
    action: ChatRecoveryAction,
    msg: ChatMessageWithMeta,
    button: HTMLButtonElement,
  ): Promise<void> {
    switch (action.id) {
      case 'retry-same-context':
        if (msg.errorRetryAt && Date.parse(msg.errorRetryAt) > Date.now()) return;
        await this.regenerateFromAssistant(msg.id);
        return;
      case 'switch-provider':
        await this.switchProviderAndRetry(msg);
        return;
      case 'reconnect-mcp':
        await this.plugin.reconnectMCP();
        await this.regenerateFromAssistant(msg.id);
        return;
      case 'send-without-rag':
        this.skipAutoRagOnce = true;
        await this.regenerateFromAssistant(msg.id);
        return;
      case 'copy-debug':
        try {
          await navigator.clipboard.writeText(msg.errorMessage ?? msg.content);
          button.setText(t('copied'));
          window.setTimeout(() => button.setText(action.label), 1500);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          new Notice(t('messageCopyFailedNotice', { message }), 5000);
        }
        return;
    }
  }

  private async switchProviderAndRetry(msg: ChatMessageWithMeta): Promise<void> {
    if (!this.modelSelectEl) return;
    const currentModel = this.modelSelectEl.value || this.plugin.settings.chat.defaultModel;
    const currentProvider = getProviderReferenceIdentity(currentModel);
    const options = resolveChatModelState(this.plugin.settings).options;
    const alternative =
      options.find(
        (option) =>
          option.value !== currentModel &&
          getProviderReferenceIdentity(option.value) !== currentProvider,
      ) ?? options.find((option) => option.value !== currentModel);
    if (!alternative) {
      this.modelSelectEl.focus();
      new Notice(t('chatRecoveryNoAlternativeProvider'));
      return;
    }
    this.modelSelectEl.value = alternative.value;
    new Notice(t('chatRecoveryContinuingWithProvider', { provider: alternative.label }), 3000);
    await this.regenerateFromAssistant(msg.id);
  }

  private async copyMessage(msg: ChatMessageWithMeta, button: HTMLButtonElement): Promise<void> {
    this.noticeSourceWarnings(msg);
    try {
      await navigator.clipboard.writeText(msg.content);
      button.setText(t('copied'));
      window.setTimeout(() => button.setText(t('messageCopyAction')), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('messageCopyFailedNotice', { message }), 5000);
    }
  }

  private async insertMessageIntoActiveNote(msg: ChatMessageWithMeta): Promise<void> {
    this.noticeSourceWarnings(msg);
    const active = this.app.workspace.getActiveFile();
    if (!active) {
      new Notice(t('activeNoteMissingNotice'));
      return;
    }
    try {
      await this.app.vault.append(active, `\n\n${formatAnswerNoteContent(msg)}\n`);
      new Notice(t('messageInsertedNotice'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('messageInsertFailedNotice', { message }), 5000);
    }
  }

  private noticeSourceWarnings(msg: ChatMessageWithMeta): void {
    if (!msg.sourceWarnings || msg.sourceWarnings.length === 0) return;
    new Notice(t('sourceWarningIncluded', { count: msg.sourceWarnings.length }), 5000);
  }

  private repairSourceWarning(warning: SourceValidationWarning, messageId: string): void {
    const message = this.messages.find(
      (item) => item.id === messageId && item.role === 'assistant',
    );
    if (!message) return;
    void this.handleSend(t('sourceRepairPrompt', { label: warning.label }), message);
  }

  private saveMessageAsNote(msg: ChatMessageWithMeta, button: HTMLButtonElement): void {
    this.noticeSourceWarnings(msg);
    new SaveAnswerModal(
      this.app,
      msg,
      this.plugin.settings.chat.saveFolder,
      this.session.title || t('aiAnswerTitle'),
      button,
    ).open();
  }

  private editAndResendUserMessage(msg: ChatMessageWithMeta): void {
    if (this.isStreaming) {
      new Notice(t('chatActionWhileStreamingNotice'));
      return;
    }
    new EditMessageModal(this.app, msg.content, (edited) => {
      const truncated = createEditResendPlan(this.messages, msg.id, edited);
      if (!truncated) return;
      this.messages = truncated;
      this.rebuildMessagesDOM();
      this.markDirtyAndAutoSave();
      this.inputArea!.value = edited;
      this.autoResizeInput();
      this.renderContextPreview(edited);
      void this.handleSend();
    }).open();
  }

  private async regenerateFromAssistant(messageId: string): Promise<void> {
    if (this.isStreaming) {
      new Notice(t('chatActionWhileStreamingNotice'));
      return;
    }
    const draft = createRegenerationDraft(this.messages, messageId);
    if (!draft) {
      new Notice(t('regenerationTargetMissingNotice'));
      return;
    }
    const originalIndex = this.messages.findIndex((message) => message.id === messageId);
    if (originalIndex >= 0) {
      this.messages[originalIndex] = markMessageRegenerated(this.messages[originalIndex]);
    }
    this.pendingRegeneration = draft;
    this.markDirtyAndAutoSave();
    this.rebuildMessagesDOM();
    await this.handleSend(draft.text);
    // 완료된 변형을 턴 자리로 재배치하고 이전 변형을 숨긴다.
    this.rebuildMessagesDOM();
  }

  private switchActiveVariant(rootId: string, targetIndex: number): void {
    if (this.isStreaming) {
      new Notice(t('chatActionWhileStreamingNotice'));
      return;
    }
    const group = createAssistantVariantGroupByRoot(
      this.messages,
      rootId,
      this.activeVariantByRoot,
    );
    const target = group?.variants[targetIndex];
    if (!group || !target || target.id === group.activeId) return;
    this.activeVariantByRoot.set(rootId, target.id);
    this.rebuildMessagesDOM(true);
  }

  private async branchFromMessage(messageId: string): Promise<void> {
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index < 0) {
      new Notice(t('branchSessionMissingNotice'));
      return;
    }
    try {
      await this.saveCurrentSession();
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
      await this.saveCurrentSession();
      new Notice(t('branchSessionCreatedNotice'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('branchSessionFailedNotice', { message }), 5000);
    }
  }

  clearMessages(): void {
    this.invalidateActiveChatRun(false);
    this.messages = [];
    this.activeVariantByRoot.clear();
    this.sessionSystemPrompt = null;
    this.session = { filePath: null, title: '', isDirty: false };
    this.clearAutoSaveTimer();
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
    this.renderEmptyState();
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
    this.invalidateActiveChatRun(false);
    this.clearAutoSaveTimer();
    await this.saveCurrentSession();
    this.messages = [];
    this.activeVariantByRoot.clear();
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
    this.renderEmptyState();
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
      parts.push(`${formatNumber(this.messages.length)}${t('chatMessageUnit')}`);
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
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = null;
      void this.saveCurrentSession();
    }, this.plugin.settings.chat.autoSaveDebounceMs);
  }

  private async summarizeCurrentSessionTitle(
    provider: LLMProvider,
    run: ChatRunHandle<AbortController>,
  ): Promise<void> {
    const session = this.session;
    try {
      const changed = await summarizeSessionTitle(
        session,
        this.messages,
        provider,
        run.controller.signal,
        () => this.session === session && isChatRunActive(this.activeRun, run),
      );
      if (!changed) return;
      this.updateHeaderTitle();
      await this.saveCurrentSession();
    } catch (error) {
      if (!isChatRunActive(this.activeRun, run)) return;
      this.plugin.logger.warn(t('chatSessionTitleFailedLog'), {
        source: 'chat.session-title',
        error,
      });
    }
  }

  private clearAutoSaveTimer(): void {
    if (!this.autoSaveTimer) return;
    window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
  }

  private async saveCurrentSession(): Promise<void> {
    const folder = this.plugin.settings.chat.saveFolder;
    if (!folder || this.messages.length === 0 || !this.session.isDirty) return;
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
        {
          filePath: this.session.filePath ?? undefined,
          title: this.session.title || undefined,
          debugTrace: this.plugin.settings.chatDebugTrace.enabled
            ? {
                enabled: true,
                config: buildChatTraceConfigSnapshot(this.plugin.settings),
                runtime: buildChatTraceRuntimeSnapshot(this.plugin),
              }
            : undefined,
        },
      );
      this.session.filePath = file.path;
      this.session.isDirty = false;
      this.plugin.refreshBus.emit('sessions', { status: 'success' });
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
    this.invalidateActiveChatRun(false);
    try {
      this.clearAutoSaveTimer();
      await this.saveCurrentSession();
      const session = await loadChat(this.app.vault, filePath);
      const now = new Date().toISOString();
      this.messages = prepareLoadedSessionMessages(session.messages, {
        cancelledText: t('chatGenerationStopped'),
        now,
        createId: () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });
      this.activeVariantByRoot.clear();
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

  private rebuildMessagesDOM(preserveScroll = false): void {
    if (!this.messagesArea) return;
    const scrollTop = this.messagesArea.scrollTop;
    const children = Array.from(this.messagesArea.children);
    for (const child of children) {
      if (!child.hasClass('superpower-inside-typing-indicator')) {
        child.remove();
      }
    }
    this.messageEls.clear();
    for (const msg of selectActiveConversationMessages(this.messages, this.activeVariantByRoot)) {
      this.renderExistingMessage(msg);
    }
    if (preserveScroll) {
      this.messagesArea.scrollTop = scrollTop;
    } else if (this.autoScroll) {
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
    this.renderMessageAvatar(avatar, msg.role);

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
          executionKind: tc.executionKind,
          citations: tc.citations,
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
    this.renderMessageContextSections(bubbleContainer, msg);
    this.renderMessageActions(bubbleContainer, msg);
  }

  private promptRenameSession(): void {
    if (!this.session.filePath && this.messages.length === 0) {
      new Notice(t('chatNoSavedSessions'));
      return;
    }

    const currentTitle = this.session.title || t('chatSessionTitle');
    const input = (this.sessionTitleEl?.ownerDocument ?? activeDocument).createElement('input');
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
    this.invalidateActiveChatRun(false);
    this.clearAutoSaveTimer();
    await this.saveCurrentSession();
    openSessionHistoryModal(
      this.container!,
      this.app,
      this.app.vault,
      this.plugin.settings.chat.saveFolder,
      (filePath: string) => void this.loadSession(filePath),
      this.session.filePath,
      this.plugin.refreshBus,
    );
  }

  private async handleSend(
    submittedText?: string,
    sourceMessage?: ChatMessageWithMeta,
  ): Promise<void> {
    const text = (submittedText ?? this.inputArea?.value)?.trim();
    if (!text || this.isStreaming) return;
    const workspaceFiles = captureWorkspaceMentionFiles(this.app);
    const regeneration = this.pendingRegeneration;
    const previousUserQuestions = selectPreviousUserQuestions(
      this.messages,
      regeneration?.previousUserId,
    );
    this.pendingSubmittedDraft =
      submittedText === undefined
        ? createComposerDraftSnapshot({ text, attachmentIds: this.getDraftAttachmentIds(text) })
        : null;
    this.lastUserPrompt = text;

    const abortController = new AbortController();
    const run: ChatRunHandle<AbortController> = {
      token: ++this.runTokenSequence,
      controller: abortController,
    };
    this.activeRun = run;
    this.abortController = abortController;
    this.setLoading(true);
    const releaseSetupRun = (): void => {
      if (!isChatRunOwner(this.activeRun, run)) return;
      this.activeRun = null;
      this.abortController = null;
      this.pendingSubmittedDraft = null;
      this.pendingRegeneration = null;
      this.setLoading(false);
    };

    const selectedModel = this.modelSelectEl?.value ?? this.plugin.settings.chat.defaultModel;
    if (!selectedModel) {
      new Notice(t('defaultModelMissingNotice'));
      releaseSetupRun();
      return;
    }

    let key: string;
    let modelName: string;
    let providerLabel: string;
    let provider: LLMProvider;
    const diagnosticsTarget: { messageId?: string } = {};
    let usageSnapshot: ChatMessageWithMeta['usageSnapshot'];
    let indexedReviewDiagnostics: ChatMessageWithMeta['indexedReviewDiagnostics'];
    const retrievalTrace: NonNullable<ChatMessageWithMeta['retrievalTrace']> = [];
    const updateDiagnostics = (): void => {
      if (!diagnosticsTarget.messageId || !isChatRunActive(this.activeRun, run)) return;
      const message = this.messages.find((item) => item.id === diagnosticsTarget.messageId);
      if (!message) return;
      message.usageSnapshot = usageSnapshot;
      message.indexedReviewDiagnostics = indexedReviewDiagnostics;
      message.retrievalTrace = [...retrievalTrace];
      const wrapper = this.messageEls.get(diagnosticsTarget.messageId);
      const container = wrapper?.querySelector('.superpower-inside-chat-bubble-container');
      if (isDomInstance(container, HTMLElement))
        this.renderMessageContextSections(container, message);
      this.markDirtyAndAutoSave();
    };

    try {
      const resolved = await prepareChatProviderForModel(this.plugin.settings, selectedModel);
      if (!isChatRunActive(this.activeRun, run)) return;
      if (!resolved) {
        new Notice(t('noActiveProviderNotice'));
        releaseSetupRun();
        return;
      }
      key = resolved.providerKey;
      modelName = resolved.model;
      providerLabel = resolved.providerLabel;
      provider = withTurnUsage(resolved.provider, (snapshot) => {
        if (!isChatRunActive(this.activeRun, run)) return;
        usageSnapshot = snapshot;
        updateDiagnostics();
      });
      this.retrievalObserver = {
        run,
        record: (record) => {
          if (!isChatRunActive(this.activeRun, run)) return;
          retrievalTrace.push(record);
          updateDiagnostics();
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('chatProviderInitializationFailed', { message }), 7000);
      releaseSetupRun();
      return;
    }
    setHidden(this.typingIndicator, false);

    let providerCapability = provider.capability;
    let turnState: ChatTurnState = transitionChatTurn(createChatTurnState(), { type: 'submit' });
    const toTurnMeta = (): Pick<
      MessageMetaInput,
      'turnStage' | 'toolRound' | 'status' | 'stopReason' | 'errorMessage'
    > => ({
      turnStage: turnState.stage,
      toolRound: turnState.toolRound,
      status: getChatTurnStageStatus(turnState.stage),
      stopReason: turnState.stopReason,
      errorMessage: turnState.errorMessage,
    });
    const applyTurnEvent = (event: ChatTurnEvent): ReturnType<typeof toTurnMeta> => {
      turnState = transitionChatTurn(turnState, event);
      return toTurnMeta();
    };

    if (submittedText === undefined) {
      this.inputArea!.value = '';
      this.autoResizeInput();
      this.renderContextPreview('');
    }
    const contextMentions = this.parseMentions(text);
    const mentionedFolders = contextMentions.filter((mention) => mention.type === 'folder');
    const researchScopePath = mentionedFolders.length === 1 ? mentionedFolders[0].name : undefined;
    const wholeVaultResearch =
      !(
        this.plugin.settings.pluginAwareEnabled &&
        planPluginAwareIndicesRust(text, previousUserQuestions, getActivePluginInfo(this.app))
          ?.length
      ) &&
      !contextMentions.some((mention) => mention.type === 'tag') &&
      (isWholeVaultResearchRequest(text) ||
        Boolean(researchScopePath && isScopedVaultResearchRequest(text)));
    const explicitlyMentionedServers = this.getMentionedServerNames(text);
    const mentionedServers = this.getEffectiveMcpServerNames(text, explicitlyMentionedServers);
    const mentionOnlyServers = this.getMentionOnlyServers(explicitlyMentionedServers);
    let promptContext: ContextBuildResult;
    try {
      promptContext = wholeVaultResearch
        ? {
            systemPrompt: null,
            attachments: researchScopePath
              ? [
                  {
                    id: 'research-scope',
                    type: 'folder',
                    name: researchScopePath,
                    label: researchScopePath,
                    status: 'attached',
                    scopeOnly: true,
                    sourceIds: [],
                    actualChars: 0,
                  },
                ]
              : [],
            citations: [],
            warnings: [],
          }
        : await this.buildPromptContext(
            text,
            previousUserQuestions,
            providerCapability.maxToolRounds > 0,
            workspaceFiles,
            provider,
            abortController.signal,
            true,
          );
    } catch (error) {
      if (isChatRunOwner(this.activeRun, run)) {
        this.activeRun = null;
        this.abortController = null;
        this.restoreSubmittedDraft();
        this.pendingRegeneration = null;
        this.setLoading(false);
        this.preparationErrorEl?.setText(t('answerNotePreparing'));
        setHidden(this.preparationErrorEl, false);
        const detail = error instanceof Error ? error.message : String(error);
        new Notice(t('contextRagLoadFailed', { error: redactDebugDetail(detail) }), 5000);
      }
      return;
    }
    if (!isChatRunActive(this.activeRun, run)) return;
    const contextBudgetSnapshot = promptContext.contextBudgetSnapshot
      ? { ...promptContext.contextBudgetSnapshot, modelContext: provider.contextBudget }
      : provider.contextBudget
        ? {
            maxChars: provider.contextBudget.evidenceChars,
            usedChars: 0,
            attachmentCount: 0,
            citationCount: 0,
            truncated: false,
            modelContext: provider.contextBudget,
          }
        : undefined;
    const dataBoundarySnapshot = wholeVaultResearch
      ? createResearchDataBoundarySnapshot({
          providerLabel,
          model: modelName,
          previousUserQuestionCount: previousUserQuestions.length,
        })
      : createDataBoundarySnapshot({
          providerLabel,
          model: modelName,
          hasUserQuestion: true,
          recentConversationMessageCount: this.messages.length,
          hasSystemPrompt: true,
          attachments: promptContext.attachments,
          citations: promptContext.citations,
          mcpServerNames: promptContext.preparedMcpServerNames ?? [],
        });
    const branchOf = regeneration ? (this.session.filePath ?? undefined) : undefined;
    const userVariantMeta: Pick<MessageMetaInput, 'branchOf' | 'branchRoot' | 'variantOf'> =
      regeneration
        ? {
            branchOf,
            branchRoot: regeneration.branchRoot,
            variantOf: regeneration.previousUserId,
          }
        : {};
    const assistantVariantMeta: Pick<MessageMetaInput, 'branchOf' | 'branchRoot' | 'variantOf'> =
      regeneration
        ? {
            branchOf,
            branchRoot: regeneration.branchRoot,
            variantOf: regeneration.variantOf,
          }
        : {};
    const contextMeta: Pick<
      MessageMetaInput,
      | 'contextAttachments'
      | 'contextBudgetSnapshot'
      | 'dataBoundarySnapshot'
      | 'citations'
      | 'indexedReviewDiagnostics'
      | 'indexedReviewNotice'
    > = {
      contextAttachments: promptContext.attachments,
      contextBudgetSnapshot,
      dataBoundarySnapshot,
    };
    applyTurnEvent({ type: 'context-built' });
    const userMessageId = this.addMessage('user', text, undefined, undefined, {
      providerKey: key,
      providerLabel,
      model: modelName,
      providerCapability,
      status: 'complete',
      contextAttachments: promptContext.attachments,
      contextBudgetSnapshot,
      dataBoundarySnapshot,
      ...userVariantMeta,
    });
    const requiresVaultSearch = wholeVaultResearch || promptContext.vaultSearchEnabled === true;
    const retrievalReadiness = this.plugin.getRetrievalReadiness?.() ?? 'ready';
    if (requiresVaultSearch && retrievalReadiness !== 'ready') {
      const content = t(
        retrievalReadiness === 'preparing'
          ? 'chatReadinessRagIndexingDetail'
          : 'chatReadinessRagNotReadyDetail',
      );
      this.addMessage('assistant', content, undefined, undefined, {
        providerKey: key,
        providerLabel,
        model: modelName,
        providerCapability,
        ...contextMeta,
        ...toTurnMeta(),
        ...assistantVariantMeta,
        turnStage: 'complete',
        status: 'complete',
        stopReason: 'complete',
      });
      releaseSetupRun();
      return;
    }

    const toolModelKey = `${key}\u0000${modelName}`;
    let toolProtocol: ToolTranscriptProtocol =
      providerCapability.toolCalling && !this.compatibilityToolModels.has(toolModelKey)
        ? 'native'
        : 'compatibility';
    if (toolProtocol === 'compatibility' && providerCapability.toolCalling) {
      providerCapability = { ...providerCapability, toolCalling: false };
    }
    const providerConversationSource = selectActiveConversationMessages(
      this.messages,
      this.activeVariantByRoot,
    );
    const providerConversationMessages = buildProviderConversation(
      providerConversationSource,
      toolProtocol,
    );
    if (sourceMessage) {
      // 검증 대상은 assistant 자료로 연결하며 멘션·검색 범위를 정하는 사용자 입력에 섞지 않습니다.
      providerConversationMessages.splice(-1, 0, {
        role: 'assistant',
        content: sourceMessage.content,
      });
    }
    const waitStatus = createProviderWaitStatus({
      providerLabel,
      model: modelName,
      elapsedMs: 0,
      capability: providerCapability,
    });
    const assistantId = this.addMessage(
      'assistant',
      providerCapability.streaming ? '' : waitStatus.headline,
      undefined,
      undefined,
      {
        providerKey: key,
        usageSnapshot,
        retrievalTrace: [...retrievalTrace],
        providerLabel,
        model: modelName,
        providerCapability,
        ...toTurnMeta(),
        ...contextMeta,
        ...assistantVariantMeta,
      },
    );
    diagnosticsTarget.messageId = assistantId;
    const assistantWrapper = this.messageEls.get(assistantId);
    if (assistantWrapper) {
      assistantWrapper.classList.add('generating');
    }
    await this.saveCurrentSession();
    if (!isChatRunActive(this.activeRun, run)) return;
    let restoreDraft = false;

    try {
      const maxToolRounds = Math.max(0, Math.trunc(providerCapability.maxToolRounds));
      if (promptContext.pluginDocumentationFailure) {
        this.updateMessage(
          assistantId,
          promptContext.pluginDocumentationFailure,
          true,
          undefined,
          undefined,
          {
            ...contextMeta,
            status: 'complete',
            turnStage: 'complete',
            stopReason: 'complete',
          },
        );
        setHidden(this.typingIndicator, true);
        return;
      }
      const toolsEnabled = maxToolRounds > 0;
      const indexedVaultReview = wholeVaultResearch || promptContext.vaultSearchEnabled === true;
      if (indexedVaultReview) {
        await this.plugin.prepareRagForChat();
        if (!isChatRunActive(this.activeRun, run)) return;
        const deferAnswer = toolsEnabled && explicitlyMentionedServers.length > 0;
        const localSearchQuestion =
          promptContext.scoringQuestion ??
          expandVaultSearchQueryLocally(text, previousUserQuestions);
        const mentionedTags = this.parseMentions(text)
          .filter((mention) => mention.type === 'tag')
          .map((mention) => mention.name);
        const restrictedSearch = mentionedFolders.length > 0 || mentionedTags.length > 0;
        // 검색 화면과 같은 corpus·hybrid 후보·리비전 reader를 공유합니다.
        // 질문 언어와 색인 언어가 다르면 provider가 만든 교차 언어 구문을 후보 수집에 더합니다.
        const variantProvider = await prepareChatProviderForModel(
          this.plugin.settings,
          selectedModel,
        );
        const loadQueryVariants = () =>
          requestQueryVariants(
            variantProvider?.provider,
            text,
            t('queryVariantPrompt'),
            abortController.signal,
          );
        // 검색 계획 상한을 넘는 질문은 원문을 버리지 않고 첫 조각으로 시작하고 나머지는 변형으로 넘깁니다.
        const searchQuestion = splitLongQuestion(localSearchQuestion)[0] ?? localSearchQuestion;
        const searchSource = await collectIndexedSearchSource(
          {
            app: this.app,
            ragEngine: this.plugin.ragEngine,
            documentCorpus: this.plugin.documentCorpus,
            settings: this.plugin.settings,
            getCandidateCount: () =>
              this.plugin.getRagRuntimeState?.()?.ragStatus?.totalDocuments,
            isIndexing: () => isPluginSearching(this.plugin),
          },
          searchQuestion,
          abortController.signal,
          text,
          true,
          12_000,
          loadQueryVariants,
        );
        const indexedPaths = searchSource ? await searchSource.getIndexedPaths() : [];
        const reviewPaths = restrictedSearch
          ? indexedPaths
          : (searchSource?.reviewPaths ?? indexedPaths);
        const searchInventory = searchSource?.inventory;
        const researchResult = await reviewIndexedVault({
          question: text,
          indexedPaths: reviewPaths,
          scopes: mentionedFolders.map((folder) => folder.name),
          corpus: searchSource?.corpus,
          candidates: searchSource?.candidates,
          candidatesState: searchSource?.candidatesState,
          inventory: searchInventory,
          matchInventory: searchSource?.matchInventory,
          filters: mentionedTags.length > 0 ? { tags: mentionedTags } : undefined,
          revisionReader: searchSource?.revisionReader,
          sourceReader: searchSource?.sourceReader,
          searchPlan: searchSource?.searchPlan,
          queryVariants: searchSource?.queryVariants,
          provider,
          systemPrompt: getEffectiveSystemPrompt(this.plugin.settings, this.sessionSystemPrompt),
          previousUserQuestions,
          scoringQuestion: localSearchQuestion,
          deferAnswer,
          documentScope: 'all',
          exhaustiveReview: restrictedSearch ? false : searchSource?.exhaustiveReview === true,
          isCurrent: () => this.plugin.getRetrievalReadiness() === 'ready',
          onDiagnostics: (diagnostics) => {
            if (!isChatRunActive(this.activeRun, run)) return;
            indexedReviewDiagnostics = diagnostics;
            contextMeta.indexedReviewDiagnostics = diagnostics;
            updateDiagnostics();
          },
          signal: abortController.signal,
          onProgress: (progress) => {
            if (!isChatRunActive(this.activeRun, run)) return;
            if (progress.phase === 'complete') return;
            const progressText = t('vaultResearchProgress', {
              phase: getVaultResearchPhaseLabel(progress.phase),
              completed: progress.completedFiles,
              total: progress.totalFiles,
            });
            this.updateMessage(assistantId, progressText, false, undefined, undefined, {
              providerKey: key,
              providerLabel,
              model: modelName,
              providerCapability,
              ...toTurnMeta(),
              ...contextMeta,
              ...assistantVariantMeta,
            });
          },
          onAnswer: (content) => {
            if (!isChatRunActive(this.activeRun, run)) return;
            this.updateMessage(assistantId, content, false, undefined, undefined, {
              providerKey: key,
              providerLabel,
              model: modelName,
              providerCapability,
              ...applyTurnEvent({ type: 'answer-delta' }),
              ...contextMeta,
              ...assistantVariantMeta,
            });
          },
        });
        if (!isChatRunActive(this.activeRun, run)) return;
        contextMeta.indexedReviewDiagnostics = researchResult.diagnostics;
        contextMeta.indexedReviewNotice = researchResult.coverageNotice;
        // 검수에 이관한 검색 대기는 결과가 나온 뒤 미발견 첨부로 남기지 않습니다.
        promptContext.attachments = promptContext.attachments.filter(
          (attachment) => attachment.id !== 'rag:auto',
        );
        contextMeta.contextAttachments = promptContext.attachments;
        const researchDocumentCount =
          deferAnswer && researchResult.providerTransfer.sentPaths
            ? new Set([
                ...researchResult.providerTransfer.sentPaths,
                ...researchResult.citations.map((citation) => citation.filePath),
              ]).size
            : researchResult.providerTransfer.sentFiles;
        contextMeta.dataBoundarySnapshot = withDataBoundaryProviderUsage(dataBoundarySnapshot, {
          researchDocumentCount,
        });
        if (deferAnswer) {
          // 명시한 외부 도구도 실행할 수 있도록 검토 결과와 원문 인용을 기존 흐름에 전달합니다.
          promptContext.systemPrompt = [
            promptContext.systemPrompt,
            t('llmEvidenceDataBoundary'),
            JSON.stringify({
              indexedEvidenceDossier: researchResult.dossier,
              verifiedSourcePassages: researchResult.citations,
            }),
          ]
            .filter(Boolean)
            .join('\n\n');
          promptContext.citations = [...promptContext.citations, ...researchResult.citations];
          contextMeta.citations = promptContext.citations;
        } else {
          const researchCitations = researchResult.citations;
          const answerContent = appendOtherInterpretations(
            researchResult.content,
            researchResult.evidence,
          );
          const sourceWarnings = this.validateAssistantSources(answerContent, researchCitations);
          this.updateMessage(assistantId, answerContent, true, undefined, undefined, {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...applyTurnEvent({ type: 'complete' }),
            ...contextMeta,
            ...assistantVariantMeta,
            citations: researchCitations,
            sourceWarnings,
          });
          setHidden(this.typingIndicator, true);
          assistantWrapper?.classList.remove('generating');
          return;
        }
      }

      const toolDefinitions = toolsEnabled
        ? await this.collectToolDefinitions(mentionedServers, mentionOnlyServers, run)
        : [];
      if (!isChatRunActive(this.activeRun, run)) return;
      const evidenceToolCalls: ToolCallRecord[] = [];
      const initialAgentPlan = toolsEnabled
        ? planAgenticToolTurn({
            question: text,
            contextAttachments: promptContext.attachments,
            explicitToolServerCount: mentionOnlyServers.length,
            explicitToolServerNames: mentionOnlyServers,
            toolDefinitions,
            toolCalls: evidenceToolCalls,
            phase: evidenceToolCalls.length > 0 ? 'after-tools' : 'initial',
            round: 0,
            maxRounds: maxToolRounds,
          })
        : null;
      const initialToolDefinitions = toolsEnabled
        ? selectAgenticToolDefinitions(
            toolDefinitions,
            initialAgentPlan?.requiredToolNames,
            initialAgentPlan?.requiredExternalServerNames,
          )
        : [];
      let providerToolDefinitions =
        toolsEnabled && toolProtocol === 'native' ? initialToolDefinitions : undefined;
      const toolPrompt = toolsEnabled
        ? toolProtocol === 'native'
          ? createToolEvidencePrompt(initialToolDefinitions)
          : createCompatibilityToolPrompt(initialToolDefinitions)
        : '';
      let systemPrompt = [promptContext.systemPrompt, toolPrompt, initialAgentPlan?.checkpoint]
        .filter((part): part is string => Boolean(part))
        .join('\n\n');
      if (toolsEnabled && !providerCapability.toolCalling && mentionedServers.length > 0) {
        new Notice(t('providerToolCallingUnsupportedNotice', { provider: providerLabel }), 5000);
      }
      let messages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...providerConversationMessages,
      ];

      let fullText = '';
      let fullReasoning = '';
      let hasReceivedContent = false;
      const toolCallMap = new Map<number, ToolCallRecord>();
      const consumeInitialChunk = (chunk: StreamChunk): void => {
        if (!isChatRunActive(this.activeRun, run)) return;
        if (chunk.content) {
          fullText += chunk.content;
        }
        if (chunk.reasoning) {
          fullReasoning += chunk.reasoning;
        }
        if (chunk.toolCalls) {
          this.mergeToolCallDeltas(toolCallMap, chunk.toolCalls);
        }
        const turnMeta =
          chunk.toolCalls && chunk.toolCalls.length > 0
            ? applyTurnEvent({
                type: 'tool-call-delta',
                activeToolCalls: toolCallMap.size,
              })
            : chunk.reasoning && !chunk.content
              ? applyTurnEvent({ type: 'reasoning-delta' })
              : chunk.content
                ? applyTurnEvent({ type: 'answer-delta' })
                : toTurnMeta();

        if (!hasReceivedContent && (fullText || fullReasoning)) {
          hasReceivedContent = true;
          setHidden(this.typingIndicator, true);
        }

        this.updateMessage(
          assistantId,
          fullText,
          chunk.done,
          fullReasoning || undefined,
          [...evidenceToolCalls, ...toolCallMap.values()],
          {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...turnMeta,
            ...contextMeta,
            ...assistantVariantMeta,
          },
        );
      };
      const streamInitialPass = (): Promise<void> => {
        const preparedMessages = prepareProviderRequest(
          appendAgenticCheckpoint(
            appendAssistantToolRound(messages, '', evidenceToolCalls, toolProtocol),
            evidenceToolCalls.length > 0 ? (initialAgentPlan?.checkpoint ?? '') : '',
          ),
          providerToolDefinitions,
          provider.contextBudget?.inputBytes,
        ).messages;
        contextMeta.dataBoundarySnapshot = withDataBoundaryProviderUsage(
          contextMeta.dataBoundarySnapshot ?? dataBoundarySnapshot,
          {
            recentConversationMessages: Math.max(
              0,
              providerConversationMessages.filter((message) => message.role !== 'system').length -
                1,
            ),
            toolResultCount: evidenceToolCalls.length,
          },
        );
        const userMessage = this.messages.find((message) => message.id === userMessageId);
        if (userMessage) userMessage.dataBoundarySnapshot = contextMeta.dataBoundarySnapshot;
        return provider.streamChat(
          preparedMessages,
          consumeInitialChunk,
          0.7,
          providerToolDefinitions,
          {
            signal: abortController.signal,
            toolChoice: providerToolDefinitions ? initialAgentPlan?.toolChoice : undefined,
          },
        );
      };

      try {
        await streamInitialPass();
      } catch (error) {
        if (!isChatRunActive(this.activeRun, run)) return;
        const fallbackPlan = planNativeToolCompatibilityFallbackRust({
          status: getChatHttpStatus(error) ?? null,
          message: error instanceof Error ? error.message : String(error),
          nativeAttempted: providerToolDefinitions !== undefined,
          compatibilityFallbackAttempted: false,
        });
        if (fallbackPlan?.retryWithCompatibility !== true) throw error;

        toolProtocol = 'compatibility';
        providerCapability = { ...providerCapability, toolCalling: false };
        this.compatibilityToolModels.add(toolModelKey);
        providerToolDefinitions = undefined;
        const compatibilityPrompt = createCompatibilityToolPrompt(initialToolDefinitions);
        systemPrompt = [
          promptContext.systemPrompt,
          compatibilityPrompt,
          initialAgentPlan?.checkpoint,
        ]
          .filter((part): part is string => Boolean(part))
          .join('\n\n');
        messages = [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...buildProviderConversation(providerConversationSource, toolProtocol),
        ];
        fullText = '';
        fullReasoning = '';
        hasReceivedContent = false;
        toolCallMap.clear();
        this.updateMessage(assistantId, '', false, undefined, [], {
          providerKey: key,
          providerLabel,
          model: modelName,
          providerCapability,
          ...applyTurnEvent({ type: 'context-built' }),
          ...contextMeta,
          ...assistantVariantMeta,
        });
        await streamInitialPass();
      }
      if (!isChatRunActive(this.activeRun, run)) return;
      setHidden(this.typingIndicator, true);
      let normalized = normalizeReasoningChunk({
        content: fullText,
        reasoning: fullReasoning || undefined,
      });
      fullText = normalized.content;
      fullReasoning = normalized.reasoning ?? '';

      if (toolsEnabled) {
        const compatibility = parseCompatibilityToolTurn(
          fullText,
          fullReasoning,
          (channel, index) => `compat-tool-${++this.localToolCallSequence}-${channel}-${index}`,
        );
        fullText = compatibility.visibleContent;
        fullReasoning = compatibility.visibleReasoning;
        const parsedToolCalls = [
          ...this.parseInlineToolRequests(fullText),
          ...this.parseInlineToolRequests(fullReasoning),
          ...compatibility.toolCalls,
        ];
        if (parsedToolCalls.length > 0) {
          fullText = this.stripInlineToolRequests(fullText);
          fullReasoning = this.stripInlineToolRequests(fullReasoning);
          const baseToolCallIndex = toolCallMap.size;
          parsedToolCalls
            .slice(0, Math.max(0, MAX_TOOL_CALLS_PER_ROUND - toolCallMap.size))
            .forEach((toolCall, index) => toolCallMap.set(baseToolCallIndex + index, toolCall));
        }
      } else {
        toolCallMap.clear();
      }

      const firstClassification = classifyAssistantResponse({
        content: fullText,
        reasoning: fullReasoning,
      });
      if (
        initialAgentPlan?.shouldRetryWithoutTools !== true &&
        shouldRenderAssistantQuestion(
          firstClassification,
          toolCallMap.size + evidenceToolCalls.length,
        )
      ) {
        const questionContract = enforceNativeToolAnswerContract(firstClassification.content, [
          ...evidenceToolCalls,
          ...toolCallMap.values(),
        ]);
        const questionBlocked = questionContract.content !== firstClassification.content;
        const questionCitations = selectDisplayedAnswerCitations(
          questionContract.content,
          promptContext.citations,
        );
        this.updateMessage(
          assistantId,
          questionContract.content,
          true,
          firstClassification.reasoning || undefined,
          [...evidenceToolCalls, ...toolCallMap.values()],
          {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...applyTurnEvent({ type: 'complete' }),
            ...contextMeta,
            ...assistantVariantMeta,
            citations: questionCitations,
            ...(questionBlocked
              ? {}
              : {
                  assistantQuestion: firstClassification.question,
                  originalContent: firstClassification.originalContent,
                }),
          },
        );
        return;
      }

      let toolCalls = Array.from(toolCallMap.values());

      const hasToolCalls = toolCalls.length > 0;
      if (initialAgentPlan?.shouldRetryWithoutTools === true && !hasToolCalls) {
        const serverNames = mentionedServers.join(', ');
        if (serverNames) {
          new Notice(t('mcpRetryToolUseNotice', { servers: serverNames }), 3000);
        }
        const previousAttempt = fullText.trim();
        const retryMessages: ChatMessage[] = [
          ...appendAssistantToolRound(messages, '', evidenceToolCalls, toolProtocol),
          ...(previousAttempt ? [{ role: 'assistant' as const, content: previousAttempt }] : []),
          {
            role: 'user',
            content: [
              initialAgentPlan.checkpoint,
              'Your previous response did not use the required connected tool. Do not answer yet. Make the required tool call now.',
            ].join('\n'),
          },
        ];

        fullText = '';
        fullReasoning = '';
        toolCallMap.clear();

        this.updateMessage(assistantId, '', false, undefined, [], {
          providerKey: key,
          providerLabel,
          model: modelName,
          providerCapability,
          ...applyTurnEvent({ type: 'context-built' }),
          ...contextMeta,
          ...assistantVariantMeta,
        });

        await provider.streamChat(
          retryMessages,
          (chunk: StreamChunk) => {
            if (!isChatRunActive(this.activeRun, run)) return;
            if (chunk.content) fullText += chunk.content;
            if (chunk.reasoning) fullReasoning += chunk.reasoning;
            if (chunk.toolCalls) this.mergeToolCallDeltas(toolCallMap, chunk.toolCalls);
            const turnMeta =
              chunk.toolCalls && chunk.toolCalls.length > 0
                ? applyTurnEvent({
                    type: 'tool-call-delta',
                    activeToolCalls: toolCallMap.size,
                  })
                : chunk.reasoning && !chunk.content
                  ? applyTurnEvent({ type: 'reasoning-delta' })
                  : chunk.content
                    ? applyTurnEvent({ type: 'answer-delta' })
                    : toTurnMeta();
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
                providerCapability,
                ...turnMeta,
                ...contextMeta,
                ...assistantVariantMeta,
              },
            );
          },
          0.7,
          providerToolDefinitions,
          {
            signal: abortController.signal,
            toolChoice: providerToolDefinitions ? 'required' : undefined,
          },
        );
        if (!isChatRunActive(this.activeRun, run)) return;

        normalized = normalizeReasoningChunk({
          content: fullText,
          reasoning: fullReasoning || undefined,
        });
        fullText = normalized.content;
        fullReasoning = normalized.reasoning ?? '';

        const retryCompatibility = parseCompatibilityToolTurn(
          fullText,
          fullReasoning,
          (channel, index) => `compat-retry-${++this.localToolCallSequence}-${channel}-${index}`,
        );
        fullText = retryCompatibility.visibleContent;
        fullReasoning = retryCompatibility.visibleReasoning;
        const retryParsedToolCalls = [
          ...this.parseInlineToolRequests(fullText),
          ...this.parseInlineToolRequests(fullReasoning),
          ...retryCompatibility.toolCalls,
        ];
        if (retryParsedToolCalls.length > 0) {
          fullText = this.stripInlineToolRequests(fullText);
          fullReasoning = this.stripInlineToolRequests(fullReasoning);
          const baseToolCallIndex = toolCallMap.size;
          retryParsedToolCalls
            .slice(0, Math.max(0, MAX_TOOL_CALLS_PER_ROUND - toolCallMap.size))
            .forEach((toolCall, index) => toolCallMap.set(baseToolCallIndex + index, toolCall));
        }

        const retryClassification = classifyAssistantResponse({
          content: fullText,
          reasoning: fullReasoning,
        });
        if (
          initialAgentPlan?.shouldRetryWithoutTools !== true &&
          shouldRenderAssistantQuestion(retryClassification, toolCallMap.size)
        ) {
          const questionContract = enforceNativeToolAnswerContract(
            retryClassification.content,
            Array.from(toolCallMap.values()),
          );
          const questionBlocked = questionContract.content !== retryClassification.content;
          const questionCitations = selectDisplayedAnswerCitations(
            questionContract.content,
            promptContext.citations,
          );
          this.updateMessage(
            assistantId,
            questionContract.content,
            true,
            retryClassification.reasoning || undefined,
            Array.from(toolCallMap.values()),
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              providerCapability,
              ...applyTurnEvent({ type: 'complete' }),
              ...contextMeta,
              ...assistantVariantMeta,
              citations: questionCitations,
              ...(questionBlocked
                ? {}
                : {
                    assistantQuestion: retryClassification.question,
                    originalContent: retryClassification.originalContent,
                  }),
            },
          );
          return;
        }

        toolCalls = Array.from(toolCallMap.values());

        if (toolCalls.length === 0 && serverNames) {
          new Notice(t('mcpRetryNoToolUseNotice', { servers: serverNames }), 5000);
        }
      }

      if (initialAgentPlan?.shouldRetryWithoutTools === true && toolCalls.length === 0) {
        const missingToolMessage = t('agentRequiredToolMissing');
        this.updateMessage(assistantId, missingToolMessage, true, fullReasoning || undefined, [], {
          providerKey: key,
          providerLabel,
          model: modelName,
          providerCapability,
          ...contextMeta,
          ...assistantVariantMeta,
          citations: [],
          status: 'error',
          turnStage: 'error',
          errorMessage: missingToolMessage,
          stopReason: 'tool-failed',
        });
        return;
      }

      toolCalls = [...evidenceToolCalls, ...toolCalls];
      const evidenceAnswer = toolCalls.some((call) => call.status === 'running')
        ? { content: fullText, reasoning: fullReasoning, warnings: [] }
        : await finalizeEvidenceAnswer({
            question: text,
            content: fullText,
            reasoning: fullReasoning,
            contextAttachments: promptContext.attachments,
            toolDefinitions,
            toolCalls,
            messages: appendAssistantToolRound(messages, '', toolCalls, toolProtocol),
            provider,
            signal: abortController.signal,
          });
      if (!isChatRunActive(this.activeRun, run)) return;
      fullText = evidenceAnswer.content;
      fullReasoning = evidenceAnswer.reasoning;
      fullText = enforceNativeToolAnswerContract(fullText, toolCalls).content;
      const displayedCitations = selectDisplayedAnswerCitations(fullText, promptContext.citations);
      const sourceWarnings = [
        ...evidenceAnswer.warnings,
        ...this.validateAssistantSources(fullText, displayedCitations),
      ];
      const postProviderTurnMeta =
        toolCalls.length > 0
          ? applyTurnEvent({ type: 'tool-call-delta', activeToolCalls: toolCalls.length })
          : applyTurnEvent({ type: 'complete' });
      this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
        providerKey: key,
        providerLabel,
        model: modelName,
        providerCapability,
        ...postProviderTurnMeta,
        ...contextMeta,
        ...assistantVariantMeta,
        citations: displayedCitations,
        sourceWarnings,
      });

      const runnableToolCalls = toolCalls.filter((toolCall) => toolCall.status === 'running');
      if (runnableToolCalls.length > 0) {
        const preparedToolCalls = await prepareAssistantToolCalls({
          toolCalls,
          registry: this.plugin.mcpRegistry,
          preferredServerNames: mentionedServers,
          mcpMode: this.plugin.settings.chat.mcpToolExecutionPolicy,
          mcpToolBindings: createMcpToolBindingAllowlist(initialToolDefinitions),
        });
        if (!isChatRunActive(this.activeRun, run)) return;
        toolCalls = markRepeatedToolCalls([], preparedToolCalls);
        const pendingApproval = toolCalls.some(
          (toolCall) => toolCall.status === 'running' && toolCall.approved === false,
        );
        if (pendingApproval) {
          this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...applyTurnEvent({ type: 'await-tool-approval' }),
            ...contextMeta,
            ...assistantVariantMeta,
            citations: displayedCitations,
            sourceWarnings,
          });
          new Notice(t('mcpApprovalRequiredNotice'));
        }
        if (!pendingApproval) {
          this.updateMessage(assistantId, fullText, false, fullReasoning || undefined, toolCalls, {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...applyTurnEvent({
              type: 'tools-running',
              activeToolCalls: runnableToolCalls.length,
            }),
            ...contextMeta,
            ...assistantVariantMeta,
            citations: displayedCitations,
            sourceWarnings,
          });
        }
        toolCalls = await this.executeAssistantToolCalls(
          assistantId,
          toolCalls,
          mentionedServers,
          fullReasoning || undefined,
          run,
        );
        if (!isChatRunActive(this.activeRun, run)) return;
        if (pendingApproval) {
          this.updateMessage(assistantId, fullText, true, fullReasoning || undefined, toolCalls, {
            providerKey: key,
            providerLabel,
            model: modelName,
            providerCapability,
            ...applyTurnEvent({ type: 'await-tool-approval' }),
            ...contextMeta,
            ...assistantVariantMeta,
            citations: displayedCitations,
            sourceWarnings,
          });
        } else {
          await this.runToolResponseLoop({
            provider,
            messageId: assistantId,
            baseMessages: messages,
            toolDefinitions,
            toolProtocol,
            question: text,
            contextAttachments: promptContext.attachments,
            maxToolRounds,
            toolCalls,
            run,
            meta: {
              providerKey: key,
              providerLabel,
              model: modelName,
              providerCapability,
              ...applyTurnEvent({ type: 'tools-complete' }),
              ...contextMeta,
              ...assistantVariantMeta,
              citations: promptContext.citations,
            },
            mentionedServers,
            explicitToolServerCount: mentionOnlyServers.length,
            explicitToolServerNames: mentionOnlyServers,
            initialText: fullText,
            initialReasoning: fullReasoning,
          });
          if (!isChatRunActive(this.activeRun, run)) return;
        }
      }
      if (assistantWrapper) {
        assistantWrapper.classList.remove('generating');
        const generatingLabel = assistantWrapper.querySelector(
          '.superpower-inside-chat-generating-label',
        );
        if (isDomInstance(generatingLabel, HTMLElement)) {
          generatingLabel.remove();
        }
      }
    } catch (err) {
      const ownsRun = isChatRunOwner(this.activeRun, run);
      if (ownsRun) {
        setHidden(this.typingIndicator, true);
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (ownsRun && assistantId) {
          const assistantMsg = this.messages.find((message) => message.id === assistantId);
          this.updateMessage(
            assistantId,
            assistantMsg?.content || t('chatGenerationStopped'),
            true,
            assistantMsg?.reasoning,
            this.cancelRunningToolCalls(assistantMsg?.toolCalls),
            {
              providerKey: key,
              providerLabel,
              model: modelName,
              providerCapability,
              ...applyTurnEvent({ type: 'cancel' }),
              ...contextMeta,
              ...assistantVariantMeta,
            },
          );
        }
        restoreDraft = true;
        return;
      }
      if (!ownsRun) {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorKind =
        err instanceof ExplicitMcpToolDiscoveryError ? 'tool-failed' : classifyChatFailure(err);
      const retryAfterMs = getChatRetryAfterMs(err);
      const presentation =
        err instanceof ExplicitMcpToolDiscoveryError
          ? {
              content: t('mcpMentionedServerUnavailable', { server: err.serverName }),
              retryAvailableAt: undefined,
            }
          : createChatErrorPresentation(errorKind, retryAfterMs);
      const errDetail = this.formatErrorDetail(
        key,
        modelName,
        redactDebugDetail(errorMsg),
        getChatHttpStatus(err),
      );
      if (assistantId) {
        const errorTurnMeta = applyTurnEvent({ type: 'error', errorMessage: errDetail });
        this.updateMessage(assistantId, presentation.content, true, undefined, undefined, {
          providerKey: key,
          providerLabel,
          model: modelName,
          providerCapability,
          ...errorTurnMeta,
          errorMessage: errDetail,
          errorKind,
          errorRetryAt: presentation.retryAvailableAt,
          ...contextMeta,
          ...assistantVariantMeta,
        });
        if (assistantWrapper) {
          assistantWrapper.classList.remove('generating');
          const generatingLabel = assistantWrapper.querySelector(
            '.superpower-inside-chat-generating-label',
          );
          if (isDomInstance(generatingLabel, HTMLElement)) {
            generatingLabel.remove();
          }
        }
      } else {
        const errorTurnMeta = applyTurnEvent({ type: 'error', errorMessage: errDetail });
        this.addMessage('assistant', presentation.content, undefined, undefined, {
          providerKey: key,
          providerLabel,
          model: modelName,
          providerCapability,
          ...errorTurnMeta,
          errorMessage: errDetail,
          errorKind,
          errorRetryAt: presentation.retryAvailableAt,
          ...contextMeta,
          ...assistantVariantMeta,
        });
      }
      restoreDraft = true;
    } finally {
      const finalization = planChatRunFinalization(this.activeRun, run, restoreDraft);
      if (finalization.restoreSubmittedDraft) {
        this.restoreSubmittedDraft();
        this.pendingRegeneration = null;
      } else if (finalization.clearPendingState) {
        this.pendingSubmittedDraft = null;
        this.pendingRegeneration = null;
      }
      if (finalization.saveSession) {
        await this.saveCurrentSession();
        await this.summarizeCurrentSessionTitle(provider, run);
        await this.saveCurrentSession();
      }
      if (finalization.clearLoading && isChatRunOwner(this.activeRun, run)) {
        this.activeRun = null;
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        this.setLoading(false);
      }
    }
  }

  private setLoading(loading: boolean): void {
    if (loading) this.hideMentionDropdown();
    if (loading) setHidden(this.preparationErrorEl, true);
    const state = createComposerLoadingState(loading);
    this.isStreaming = state.isStreaming;
    if (this.sendBtn) {
      this.sendBtn.disabled = state.sendButton.disabled;
      this.sendBtn.setText(state.sendButton.text);
      this.sendBtn.toggleClass('superpower-inside-chat-stop-all', loading);
      this.sendBtn.setAttribute(
        'aria-label',
        loading ? state.runControl.stopText : state.sendButton.text,
      );
    }
    if (this.inputArea) this.inputArea.disabled = state.inputDisabled;
    this.inputArea?.setAttribute('aria-busy', String(loading));
    if (this.modelSelectEl) this.modelSelectEl.disabled = state.modelSelectDisabled;
    setHidden(this.runControlEl, state.runControl.hidden);
    if (!loading) this.renderChatReadiness();
  }

  private getDraftAttachmentIds(text: string): string[] {
    return this.parseMentions(text).map((mention) =>
      mention.type === 'server' ? `mcp:${mention.name}` : `${mention.type}:${mention.name}`,
    );
  }

  private restoreSubmittedDraft(): void {
    const draft = this.pendingSubmittedDraft;
    if (!draft || !this.inputArea) return;
    if (this.inputArea.value.trim()) {
      this.pendingSubmittedDraft = null;
      return;
    }
    this.inputArea.value = draft.text;
    this.autoResizeInput();
    this.renderContextPreview(draft.text);
    this.pendingSubmittedDraft = null;
    new Notice(t('composerDraftRestoredNotice'), 3000);
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
      } else if (toolCallMap.size < MAX_TOOL_CALLS_PER_ROUND) {
        toolCallMap.set(toolCallDelta.index, {
          id: toolCallDelta.id || `local-tool-${++this.localToolCallSequence}`,
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
          id: `xml-tool-${++this.localToolCallSequence}`,
          name,
          arguments: JSON.stringify(args),
          status: 'running',
        });
        if (toolCalls.length >= MAX_TOOL_CALLS_PER_ROUND) return toolCalls;
      }

      for (const invoke of Array.from(doc.querySelectorAll('invoke'))) {
        const name = invoke.getAttribute('name')?.trim();
        if (!name) continue;
        toolCalls.push({
          id: `xml-tool-${++this.localToolCallSequence}`,
          name,
          arguments: JSON.stringify(this.readXmlParameters(invoke)),
          status: 'running',
        });
        if (toolCalls.length >= MAX_TOOL_CALLS_PER_ROUND) return toolCalls;
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

  private async collectToolDefinitions(
    serverNames: readonly string[],
    explicitlyMentionedServerNames: readonly string[],
    run: ChatRunHandle<AbortController>,
  ): Promise<ToolDefinition[]> {
    if (!isChatRunActive(this.activeRun, run)) return [];
    const externalDefinitions = await collectExternalMcpToolDefinitions({
      serverNames,
      explicitlyMentionedServerNames,
      reservedToolNames: new Set([
        NATIVE_VAULT_TOOL_NAME,
        ...Object.values(NATIVE_VAULT_NAMED_TOOL_NAMES),
      ]),
      signal: run.controller.signal,
      getClient: (serverName) => this.plugin.mcpRegistry?.getClient(serverName),
      isActive: () => isChatRunActive(this.activeRun, run),
    });
    return selectBoundedToolDefinitions([], externalDefinitions);
  }

  private async streamFinalAnswerAfterTools(args: {
    provider: LLMProvider;
    messageId: string;
    conversationMessages: ChatMessage[];
    assistantContent: string;
    assistantReasoning?: string;
    toolDefinitions: ToolDefinition[];
    toolProtocol: ToolTranscriptProtocol;
    checkpoint: string;
    toolChoice: ToolChoice;
    toolCalls: ToolCallRecord[];
    run: ChatRunHandle<AbortController>;
    meta: MessageMetaInput;
  }): Promise<{
    finalText: string;
    finalReasoning: string;
    newToolCalls: ToolCallRecord[];
    conversationMessages: ChatMessage[];
  }> {
    if (!isChatRunActive(this.activeRun, args.run)) {
      return {
        finalText: '',
        finalReasoning: '',
        newToolCalls: [],
        conversationMessages: args.conversationMessages,
      };
    }
    const completedToolCalls = selectProviderReinjectableToolCalls(args.toolCalls);
    if (completedToolCalls.length === 0) {
      return {
        finalText: '',
        finalReasoning: '',
        newToolCalls: [],
        conversationMessages: args.conversationMessages,
      };
    }

    let finalText = '';
    let finalReasoning = '';
    const newToolCallMap = new Map<number, ToolCallRecord>();
    const secondMessages = appendAssistantToolRound(
      args.conversationMessages,
      args.assistantContent,
      completedToolCalls,
      args.toolProtocol,
      args.assistantReasoning,
      args.provider.contextBudget?.inputBytes,
    );
    const roundCheckpoint =
      args.toolProtocol === 'compatibility' && args.toolDefinitions.length > 0
        ? [createCompatibilityToolPrompt(args.toolDefinitions), args.checkpoint]
            .filter(Boolean)
            .join('\n\n')
        : args.checkpoint;
    const checkpointMessages = appendAgenticCheckpoint(secondMessages, roundCheckpoint);

    const visibleToolCalls = [...args.toolCalls];
    const streamProviderPass = async (
      providerMessages: ChatMessage[],
      toolChoice: ToolChoice,
    ): Promise<void> => {
      providerMessages = prepareProviderRequest(
        providerMessages,
        args.toolProtocol === 'native' ? args.toolDefinitions : undefined,
        args.provider.contextBudget?.inputBytes,
      ).messages;
      await args.provider.streamChat(
        providerMessages,
        (chunk: StreamChunk) => {
          if (!isChatRunActive(this.activeRun, args.run)) return;
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
            {
              ...args.meta,
              citations: selectDisplayedAnswerCitations(finalText, args.meta.citations ?? []),
              status: 'streaming',
            },
          );
        },
        0.7,
        args.toolProtocol === 'native' ? args.toolDefinitions : undefined,
        {
          signal: args.run.controller.signal,
          toolChoice: args.toolProtocol === 'native' ? toolChoice : undefined,
        },
      );
    };
    const parseStreamedToolRequests = (): void => {
      const compatibility = parseCompatibilityToolTurn(
        finalText,
        finalReasoning,
        (channel, index) => `compat-tool-${++this.localToolCallSequence}-${channel}-${index}`,
      );
      finalText = compatibility.visibleContent;
      finalReasoning = compatibility.visibleReasoning;
      const legacyToolCalls = [
        ...this.parseInlineToolRequests(finalText),
        ...this.parseInlineToolRequests(finalReasoning),
      ];
      if (legacyToolCalls.length > 0) {
        finalText = this.stripInlineToolRequests(finalText);
        finalReasoning = this.stripInlineToolRequests(finalReasoning);
      }
      const compatibilityBaseIndex = newToolCallMap.size;
      [...legacyToolCalls, ...compatibility.toolCalls]
        .slice(0, Math.max(0, MAX_TOOL_CALLS_PER_ROUND - newToolCallMap.size))
        .forEach((toolCall, index) => {
          newToolCallMap.set(compatibilityBaseIndex + index, toolCall);
        });
    };

    let providerMessages = checkpointMessages;
    await streamProviderPass(providerMessages, args.toolChoice);
    if (!isChatRunActive(this.activeRun, args.run)) {
      return {
        finalText: '',
        finalReasoning: '',
        newToolCalls: [],
        conversationMessages: args.conversationMessages,
      };
    }
    parseStreamedToolRequests();

    if (args.toolChoice === 'required' && newToolCallMap.size === 0) {
      const ignoredAnswer = finalText.trim();
      providerMessages = [
        ...checkpointMessages,
        ...(ignoredAnswer
          ? [
              {
                role: 'assistant' as const,
                content: ignoredAnswer,
                ...(finalReasoning ? { reasoning: finalReasoning } : {}),
              },
            ]
          : []),
        {
          role: 'user',
          content: [
            roundCheckpoint,
            'The required next tool call was missing. Do not answer yet. Perform that tool action now. This is the only automatic correction for this step.',
          ].join('\n'),
        },
      ];
      finalText = '';
      finalReasoning = '';
      newToolCallMap.clear();
      await streamProviderPass(providerMessages, 'required');
      if (!isChatRunActive(this.activeRun, args.run)) {
        return {
          finalText: '',
          finalReasoning: '',
          newToolCalls: [],
          conversationMessages: args.conversationMessages,
        };
      }
      parseStreamedToolRequests();
    }

    return {
      finalText,
      finalReasoning,
      newToolCalls: Array.from(newToolCallMap.values()),
      conversationMessages: providerMessages,
    };
  }

  private async streamGroundedAnswerRepair(args: {
    provider: LLMProvider;
    messageId: string;
    conversationMessages: ChatMessage[];
    originalText: string;
    originalReasoning: string;
    violationCodes: Parameters<typeof createNativeToolAnswerRepairPrompt>[0];
    safeCoverageText?: string;
    toolCalls: ToolCallRecord[];
    run: ChatRunHandle<AbortController>;
    meta: MessageMetaInput;
  }): Promise<{ text: string; reasoning: string }> {
    let text = '';
    let reasoning = '';
    const repairMessages: ChatMessage[] = [
      ...args.conversationMessages,
      {
        role: 'assistant',
        content: args.originalText,
        ...(args.originalReasoning ? { reasoning: args.originalReasoning } : {}),
      },
      {
        role: 'user',
        content: createNativeToolAnswerRepairPrompt(args.violationCodes, args.safeCoverageText),
      },
    ];
    await args.provider.streamChat(
      repairMessages,
      (chunk: StreamChunk) => {
        if (!isChatRunActive(this.activeRun, args.run)) return;
        if (chunk.content) text += chunk.content;
        if (chunk.reasoning) reasoning += chunk.reasoning;
      },
      0.2,
      undefined,
      {
        signal: args.run.controller.signal,
        toolChoice: 'none',
      },
    );
    const normalized = normalizeReasoningChunk({
      content: text,
      reasoning: reasoning || undefined,
    });
    const sanitized = sanitizeNonExecutingToolTurn(normalized.content, normalized.reasoning ?? '');
    return {
      text: sanitized.visibleContent,
      reasoning: sanitized.visibleReasoning,
    };
  }

  private async runToolResponseLoop(args: {
    provider: LLMProvider;
    messageId: string;
    baseMessages: ChatMessage[];
    toolDefinitions: ToolDefinition[];
    toolProtocol: ToolTranscriptProtocol;
    question: string;
    contextAttachments: ContextAttachment[];
    maxToolRounds?: number;
    toolCalls: ToolCallRecord[];
    run: ChatRunHandle<AbortController>;
    meta: MessageMetaInput;
    mentionedServers: string[];
    explicitToolServerCount: number;
    explicitToolServerNames: readonly string[];
    initialText?: string;
    initialReasoning?: string;
  }): Promise<void> {
    const maxRounds = Math.max(0, Math.trunc(args.maxToolRounds ?? 10));
    let round = 0;
    let toolProtocol = args.toolProtocol;
    let currentToolCalls = args.toolCalls;
    let conversationMessages = [...args.baseMessages];
    let currentAssistantContent = args.initialText ?? '';
    let currentAssistantReasoning = args.initialReasoning ?? '';
    let accumulatedText = args.initialText ?? '';
    let accumulatedReasoning = args.initialReasoning ?? '';
    const allToolCalls: ToolCallRecord[] = [...args.toolCalls];
    let turnCitations = collectToolCitations(args.meta.citations ?? [], allToolCalls);
    const withCurrentProviderUsage = (): MessageMetaInput => {
      const toolResultCount = selectProviderReinjectableToolCalls(allToolCalls).length;
      const mcpServerNames = [
        ...new Set([
          ...(args.meta.dataBoundarySnapshot?.sentToMcp ?? []),
          ...collectCompletedMcpServerNames(allToolCalls),
        ]),
      ];
      return {
        ...args.meta,
        toolRound: round,
        dataBoundarySnapshot: args.meta.dataBoundarySnapshot
          ? withDataBoundaryProviderUsage(args.meta.dataBoundarySnapshot, {
              toolResultCount,
              mcpServerNames,
            })
          : undefined,
      };
    };

    while (round <= maxRounds) {
      if (!isChatRunActive(this.activeRun, args.run)) return;
      const synthesisOnly = round === maxRounds;
      const policyRound = synthesisOnly ? maxRounds : round + 1;
      round++;
      const agentPlan = planAgenticToolTurn({
        question: args.question,
        contextAttachments: args.contextAttachments,
        explicitToolServerCount: args.explicitToolServerCount,
        explicitToolServerNames: args.explicitToolServerNames,
        toolDefinitions: args.toolDefinitions,
        toolCalls: allToolCalls,
        phase: 'after-tools',
        round: policyRound,
        maxRounds,
      });
      const checkpoint = synthesisOnly
        ? [
            agentPlan?.checkpoint,
            '[Superpower Inside final synthesis checkpoint]',
            `Current user objective (highest priority): <user_objective>${args.question}</user_objective>`,
            'The bounded tool budget is now closed. Do not call another tool. Answer the current objective directly and completely from the verified results already provided.',
          ]
            .filter((part): part is string => Boolean(part))
            .join('\n')
        : (agentPlan?.checkpoint ?? '');
      const roundToolDefinitions = synthesisOnly
        ? []
        : selectAgenticToolDefinitions(
            args.toolDefinitions,
            agentPlan?.requiredToolNames,
            agentPlan?.requiredExternalServerNames,
          );
      const roundToolChoice: ToolChoice = synthesisOnly
        ? 'none'
        : (agentPlan?.toolChoice ?? 'auto');

      const streamRound = (): ReturnType<ChatView['streamFinalAnswerAfterTools']> =>
        this.streamFinalAnswerAfterTools({
          provider: args.provider,
          messageId: args.messageId,
          conversationMessages,
          assistantContent: currentAssistantContent,
          assistantReasoning: currentAssistantReasoning,
          toolDefinitions: roundToolDefinitions,
          toolProtocol,
          checkpoint,
          toolChoice: roundToolChoice,
          toolCalls: currentToolCalls,
          run: args.run,
          meta: { ...withCurrentProviderUsage(), citations: turnCitations },
        });
      let result: Awaited<ReturnType<ChatView['streamFinalAnswerAfterTools']>>;
      try {
        result = await streamRound();
      } catch (error) {
        if (!isChatRunActive(this.activeRun, args.run)) return;
        const fallbackPlan = planNativeToolCompatibilityFallbackRust({
          status: getChatHttpStatus(error) ?? null,
          message: error instanceof Error ? error.message : String(error),
          nativeAttempted: toolProtocol === 'native',
          compatibilityFallbackAttempted: toolProtocol === 'compatibility',
        });
        if (fallbackPlan?.retryWithCompatibility !== true) throw error;

        toolProtocol = 'compatibility';
        if (args.meta.providerCapability) {
          args.meta.providerCapability = {
            ...args.meta.providerCapability,
            toolCalling: false,
          };
        }
        const providerKey = args.meta.providerKey?.trim();
        const model = args.meta.model?.trim();
        if (providerKey && model) {
          this.compatibilityToolModels.add(`${providerKey}\u0000${model}`);
        }
        if (!isChatRunActive(this.activeRun, args.run)) return;
        result = await streamRound();
      }
      if (!isChatRunActive(this.activeRun, args.run)) return;
      if (synthesisOnly && result.newToolCalls.length > 0) {
        const limitMessage = t('tooManyToolCalls');
        this.updateMessage(
          args.messageId,
          limitMessage,
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          {
            ...withCurrentProviderUsage(),
            citations: [],
            status: 'error',
            turnStage: 'error',
            errorMessage: limitMessage,
            stopReason: 'tool-failed',
          },
        );
        return;
      }
      const remainingToolCalls = Math.max(0, MAX_TOOL_CALLS_PER_TURN - allToolCalls.length);
      const newToolCalls = result.newToolCalls.slice(0, remainingToolCalls);
      if (result.newToolCalls.length > 0 && newToolCalls.length === 0) {
        const limitMessage = t('tooManyToolCalls');
        this.updateMessage(
          args.messageId,
          limitMessage,
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          {
            ...withCurrentProviderUsage(),
            citations: [],
            status: 'error',
            turnStage: 'error',
            errorMessage: limitMessage,
            stopReason: 'tool-failed',
          },
        );
        return;
      }

      const roundText = resolveAssistantToolLoopText(
        accumulatedText,
        result.finalText,
        newToolCalls.length > 0,
      );
      accumulatedText = roundText.finalAnswer ?? roundText.displayText;
      if (result.finalReasoning) {
        accumulatedReasoning = joinAssistantToolRoundText(
          accumulatedReasoning,
          result.finalReasoning,
        );
      }
      conversationMessages = result.conversationMessages;

      if (newToolCalls.length === 0 && agentPlan?.shouldRetryWithoutTools === true) {
        const missingToolMessage = t('agentRequiredToolMissing');
        this.updateMessage(
          args.messageId,
          missingToolMessage,
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          {
            ...withCurrentProviderUsage(),
            citations: [],
            status: 'error',
            turnStage: 'error',
            errorMessage: missingToolMessage,
            stopReason: 'tool-failed',
          },
        );
        return;
      }

      if (newToolCalls.length > 0) {
        const preparedCandidates = await prepareAssistantToolCalls({
          toolCalls: newToolCalls,
          registry: this.plugin.mcpRegistry,
          preferredServerNames: args.mentionedServers,
          mcpMode: this.plugin.settings.chat.mcpToolExecutionPolicy,
          mcpToolBindings: createMcpToolBindingAllowlist(roundToolDefinitions),
        });
        if (!isChatRunActive(this.activeRun, args.run)) return;
        const preparedToolCalls = markRepeatedToolCalls(allToolCalls, preparedCandidates);
        if (
          preparedToolCalls.some(
            (toolCall) => toolCall.status === 'running' && toolCall.approved === false,
          )
        ) {
          allToolCalls.push(...preparedToolCalls);
          const displayedCitations = selectDisplayedAnswerCitations(accumulatedText, turnCitations);
          this.updateMessage(
            args.messageId,
            accumulatedText,
            true,
            accumulatedReasoning || undefined,
            allToolCalls,
            {
              ...withCurrentProviderUsage(),
              citations: displayedCitations,
              status: 'complete',
              turnStage: 'awaiting-tool-approval',
            },
          );
          new Notice(t('mcpApprovalRequiredNotice'));
          return;
        }
        currentToolCalls = await this.executeAssistantToolCalls(
          args.messageId,
          preparedToolCalls,
          args.mentionedServers,
          accumulatedReasoning || undefined,
          args.run,
        );
        if (!isChatRunActive(this.activeRun, args.run)) return;
        allToolCalls.push(...currentToolCalls);
        currentAssistantContent = result.finalText;
        currentAssistantReasoning = result.finalReasoning;
        turnCitations = collectToolCitations(args.meta.citations ?? [], allToolCalls);
        const displayedCitations = selectDisplayedAnswerCitations(accumulatedText, turnCitations);
        this.updateMessage(
          args.messageId,
          accumulatedText,
          false,
          accumulatedReasoning || undefined,
          allToolCalls,
          { ...withCurrentProviderUsage(), citations: displayedCitations, status: 'streaming' },
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
            ...withCurrentProviderUsage(),
            citations: [],
            status: 'error',
            turnStage: 'error',
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
        let groundedRepairCitations: SourceCitation[] = [];
        let answerContract = enforceNativeToolAnswerContract(accumulatedText, allToolCalls);
        if (answerContract.violationCodes.length > 0) {
          const originalContract = answerContract;
          try {
            const originalAnswer = accumulatedText;
            const repaired = await this.streamGroundedAnswerRepair({
              provider: args.provider,
              messageId: args.messageId,
              conversationMessages,
              originalText: accumulatedText,
              originalReasoning: accumulatedReasoning,
              violationCodes: answerContract.violationCodes,
              safeCoverageText: answerContract.safeCoverageText,
              toolCalls: allToolCalls,
              run: args.run,
              meta: {
                ...withCurrentProviderUsage(),
                citations: turnCitations,
              },
            });
            if (!isChatRunActive(this.activeRun, args.run)) return;
            if (repaired.text.trim()) {
              accumulatedText = repaired.text;
              accumulatedReasoning = repaired.reasoning || accumulatedReasoning;
              answerContract = enforceNativeToolAnswerContract(accumulatedText, allToolCalls);
              if (answerContract.violationCodes.length === 0) {
                groundedRepairCitations = selectGroundedRepairCitations(
                  originalAnswer,
                  accumulatedText,
                  turnCitations,
                );
              } else {
                answerContract = originalContract;
              }
            }
          } catch (error) {
            if (!isChatRunActive(this.activeRun, args.run)) return;
            this.plugin.logger.warn(
              'Grounded answer repair failed; preserving claims allowed by the coverage contract.',
              { source: 'chat.answer-contract', error },
            );
          }
        }
        accumulatedText = answerContract.content;
        const evidenceAnswer = await finalizeEvidenceAnswer({
          question: args.question,
          content: accumulatedText,
          reasoning: accumulatedReasoning,
          contextAttachments: args.contextAttachments,
          toolDefinitions: args.toolDefinitions,
          toolCalls: allToolCalls,
          messages: conversationMessages,
          provider: args.provider,
          signal: args.run.controller.signal,
        });
        if (!isChatRunActive(this.activeRun, args.run)) return;
        accumulatedText = enforceNativeToolAnswerContract(
          evidenceAnswer.content,
          allToolCalls,
        ).content;
        accumulatedReasoning = evidenceAnswer.reasoning;
        if (answerContract.violationCodes.length > 0) {
          this.plugin.logger.warn('Unsupported answer claims removed.', {
            source: 'chat.answer-contract',
            data: { violationCodes: answerContract.violationCodes },
          });
        }
        const classification = classifyAssistantResponse({
          content: accumulatedText,
          reasoning: accumulatedReasoning,
        });
        if (classification.type === 'question') {
          const answerCitations =
            groundedRepairCitations.length > 0
              ? groundedRepairCitations
              : selectDisplayedAnswerCitations(classification.content, turnCitations);
          this.updateMessage(
            args.messageId,
            classification.content,
            true,
            classification.reasoning || undefined,
            allToolCalls,
            {
              ...withCurrentProviderUsage(),
              citations: answerCitations,
              assistantQuestion: classification.question,
              status: 'complete',
              turnStage: 'complete',
              stopReason: 'complete',
            },
          );
          return;
        }
        const answerCitations =
          groundedRepairCitations.length > 0
            ? groundedRepairCitations
            : selectDisplayedAnswerCitations(accumulatedText, turnCitations);
        const sourceWarnings = [
          ...evidenceAnswer.warnings,
          ...this.validateAssistantSources(accumulatedText, answerCitations),
        ];
        this.plugin.logger.debug('Chat tool trace quality measured.', {
          source: 'chat.quality',
          data: evaluateToolTrace({
            question: args.question,
            answer: accumulatedText,
            toolCalls: allToolCalls,
            citations: answerCitations,
            contextAttachments: args.contextAttachments,
            toolDefinitions: args.toolDefinitions,
            maxToolRounds: maxRounds,
          }),
        });
        this.updateMessage(
          args.messageId,
          accumulatedText,
          true,
          accumulatedReasoning || undefined,
          allToolCalls,
          {
            ...withCurrentProviderUsage(),
            citations: answerCitations,
            sourceWarnings,
            status: 'complete',
            turnStage: 'complete',
            stopReason: 'complete',
          },
        );
      }
      return;
    }

    if (!isChatRunActive(this.activeRun, args.run)) return;
    const content = resolveToolLoopTerminalText(accumulatedText, 'limit');
    const answerCitations = selectDisplayedAnswerCitations(content, turnCitations);
    const sourceWarnings = this.validateAssistantSources(content, answerCitations);
    this.updateMessage(
      args.messageId,
      content,
      true,
      accumulatedReasoning || undefined,
      allToolCalls,
      {
        ...withCurrentProviderUsage(),
        citations: answerCitations,
        sourceWarnings,
        status: 'error',
        turnStage: 'error',
        stopReason: 'error',
      },
    );
  }

  private getMentionedServerNames(text: string): string[] {
    return this.parseMentions(text)
      .filter((mention) => mention.type === 'server')
      .map((mention) => mention.name);
  }

  private getEffectiveMcpServerNames(
    text: string,
    mentionedServerNames = this.getMentionedServerNames(text),
  ): string[] {
    return getPluginAwareServerNames({
      mentionedServerNames: scopeMcpServerNames(
        this.plugin.mcpRegistry?.getEnabledServers().map((server) => server.name) ?? [],
        mentionedServerNames,
        this.plugin.settings.chat.mcpMentionOnly,
      ),
      pluginAwareEnabled: this.plugin.settings.pluginAwareEnabled,
      userText: text,
      plugins: this.plugin.settings.pluginAwareEnabled ? getActivePluginInfo(this.app) : [],
      registry: this.plugin.mcpRegistry,
    });
  }

  /** 멘션 전용 모드에서만 멘션 서버의 사용을 강제하고, 기본값은 사용 제안으로 둡니다. */
  private getMentionOnlyServers(mentionedServerNames: readonly string[]): string[] {
    return this.plugin.settings.chat.mcpMentionOnly ? [...mentionedServerNames] : [];
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
    reasoning: string | undefined,
    run: ChatRunHandle<AbortController>,
  ): Promise<ToolCallRecord[]> {
    if (!isChatRunActive(this.activeRun, run)) {
      return toolCalls.map((toolCall) => ({ ...toolCall }));
    }
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) {
      throw new Error(t('mcpResultMessageMissing', { messageId }));
    }
    return executeToolCalls({
      registry: this.plugin.mcpRegistry,
      toolCalls,
      preferredServerNames,
      signal: run.controller.signal,
      onUpdate: (updatedToolCalls) => {
        if (!isChatRunActive(this.activeRun, run)) return;
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
    if (this.isStreaming) return;
    const message = this.messages.find((m) => m.id === messageId);
    if (!message?.toolCalls) return;
    const abortController = new AbortController();
    const run: ChatRunHandle<AbortController> = {
      token: ++this.runTokenSequence,
      controller: abortController,
    };
    this.activeRun = run;
    this.abortController = abortController;
    this.retrievalObserver = {
      run,
      record: (record) => {
        if (!isChatRunActive(this.activeRun, run)) return;
        message.retrievalTrace = [...(message.retrievalTrace ?? []), record];
        this.markDirtyAndAutoSave();
      },
    };
    this.setLoading(true);
    setHidden(this.typingIndicator, false);
    let titleProvider: LLMProvider | undefined;

    try {
      const messageIndex = this.messages.findIndex((item) => item.id === messageId);
      const { currentQuestion, previousUserQuestions } = resolveToolApprovalQuestionContext(
        this.messages,
        messageId,
        this.lastUserPrompt ?? '',
      );
      const explicitlyMentionedServers = this.getMentionedServerNames(currentQuestion);
      const mentionedServers = this.getEffectiveMcpServerNames(
        currentQuestion,
        explicitlyMentionedServers,
      );
      const mentionOnlyServers = this.getMentionOnlyServers(explicitlyMentionedServers);
      const toolCalls = message.toolCalls.map((toolCall) =>
        toolCall.id === toolCallId ? { ...toolCall, approved: true } : { ...toolCall },
      );
      this.updateMessage(messageId, message.content, false, message.reasoning, toolCalls, {
        status: 'streaming',
        turnStage: 'running-tools',
      });
      await this.saveCurrentSession();
      if (!isChatRunActive(this.activeRun, run)) return;
      const updated = await this.executeAssistantToolCalls(
        messageId,
        toolCalls,
        mentionedServers,
        message.reasoning,
        run,
      );
      if (!isChatRunActive(this.activeRun, run)) return;

      const pendingApproval = updated.some(
        (toolCall) => toolCall.status === 'running' && toolCall.approved === false,
      );
      if (pendingApproval) {
        const current = this.messages.find((item) => item.id === messageId);
        this.updateMessage(
          messageId,
          current?.content ?? message.content,
          true,
          current?.reasoning ?? message.reasoning,
          updated,
          { turnStage: 'awaiting-tool-approval' },
        );
        return;
      }
      const stopReason = updated.some((toolCall) => toolCall.status === 'error')
        ? 'tool-failed'
        : 'complete';
      const latestMessage = this.messages.find((m) => m.id === messageId);
      const providerReinjectableToolCalls = selectProviderReinjectableToolCalls(updated);
      if (providerReinjectableToolCalls.length > 0 && message.providerKey && message.model) {
        if (!isChatRunActive(this.activeRun, run)) return;
        const resumedProvider = await prepareChatProviderForModel(
          this.plugin.settings,
          buildStoredChatModelRef(message.providerKey, message.model),
        );
        if (!resumedProvider) throw new Error(t('noActiveProviderNotice'));
        const provider = withTurnUsage(
          resumedProvider.provider,
          (snapshot) => {
            if (!isChatRunActive(this.activeRun, run)) return;
            message.usageSnapshot = snapshot;
            this.markDirtyAndAutoSave();
          },
          message.usageSnapshot,
        );
        titleProvider = provider;
        const promptContext = await this.buildPromptContext(
          currentQuestion,
          previousUserQuestions,
          provider.capability.maxToolRounds > 0,
          captureWorkspaceMentionFiles(this.app),
          provider,
          abortController.signal,
          Boolean(message.indexedReviewDiagnostics),
        );
        if (!isChatRunActive(this.activeRun, run)) return;
        if (promptContext.pluginDocumentationFailure) {
          this.updateMessage(
            messageId,
            promptContext.pluginDocumentationFailure,
            true,
            undefined,
            updated,
            {
              contextAttachments: promptContext.attachments,
              status: 'complete',
              turnStage: 'complete',
              stopReason: 'complete',
            },
          );
          return;
        }
        let resumedResearchDocumentCount: number | undefined;
        if (message.indexedReviewDiagnostics && explicitlyMentionedServers.length > 0) {
          await this.plugin.prepareRagForChat();
          if (!isChatRunActive(this.activeRun, run)) return;
          const resumeSource = await collectIndexedSearchSource(
            {
              app: this.app,
              ragEngine: this.plugin.ragEngine,
              documentCorpus: this.plugin.documentCorpus,
              settings: this.plugin.settings,
              getCandidateCount: () =>
                this.plugin.getRagRuntimeState?.()?.ragStatus?.totalDocuments,
              isIndexing: () => isPluginSearching(this.plugin),
            },
            promptContext.scoringQuestion ?? currentQuestion,
            abortController.signal,
            currentQuestion,
            true,
            12_000,
          );
          const indexedPaths = resumeSource ? await resumeSource.getIndexedPaths() : [];
          const resumeFolderScopes = this.parseMentions(currentQuestion)
            .filter((mention) => mention.type === 'folder')
            .map((mention) => mention.name);
          const resumeTags = this.parseMentions(currentQuestion)
            .filter((mention) => mention.type === 'tag')
            .map((mention) => mention.name);
          const resumeRestricted = resumeFolderScopes.length > 0 || resumeTags.length > 0;
          const reviewPaths = resumeRestricted
            ? indexedPaths
            : (resumeSource?.reviewPaths ?? indexedPaths);
          const resumeInventory = resumeSource?.inventory;
          const researchResult = await reviewIndexedVault({
            question: currentQuestion,
            indexedPaths: reviewPaths,
            scopes: resumeFolderScopes,
            corpus: resumeSource?.corpus,
            candidates: resumeSource?.candidates,
            candidatesState: resumeSource?.candidatesState,
            inventory: resumeInventory,
            matchInventory: resumeSource?.matchInventory,
            filters: resumeTags.length > 0 ? { tags: resumeTags } : undefined,
            revisionReader: resumeSource?.revisionReader,
            sourceReader: resumeSource?.sourceReader,
            searchPlan: resumeSource?.searchPlan,
            queryVariants: resumeSource?.queryVariants,
            provider,
            previousUserQuestions,
            scoringQuestion:
              promptContext.scoringQuestion ??
              expandVaultSearchQueryLocally(currentQuestion, previousUserQuestions),
            deferAnswer: true,
            documentScope: 'all',
            exhaustiveReview: resumeRestricted ? false : resumeSource?.exhaustiveReview === true,
            isCurrent: () => this.plugin.getRetrievalReadiness() === 'ready',
            signal: abortController.signal,
            onDiagnostics: (diagnostics) => {
              if (!isChatRunActive(this.activeRun, run)) return;
              message.indexedReviewDiagnostics = diagnostics;
              this.markDirtyAndAutoSave();
            },
          });
          if (!isChatRunActive(this.activeRun, run)) return;
          message.indexedReviewNotice = researchResult.coverageNotice;
          message.indexedReviewDiagnostics = researchResult.diagnostics;
          resumedResearchDocumentCount = researchResult.providerTransfer.sentPaths
            ? new Set([
                ...researchResult.providerTransfer.sentPaths,
                ...researchResult.citations.map((citation) => citation.filePath),
              ]).size
            : researchResult.providerTransfer.sentFiles;
          promptContext.systemPrompt = [
            promptContext.systemPrompt,
            t('llmEvidenceDataBoundary'),
            JSON.stringify({
              indexedEvidenceDossier: researchResult.dossier,
              verifiedSourcePassages: researchResult.citations,
            }),
          ]
            .filter(Boolean)
            .join('\n\n');
          promptContext.citations = [...promptContext.citations, ...researchResult.citations];
          promptContext.attachments = promptContext.attachments.filter(
            (attachment) => attachment.id !== 'rag:auto',
          );
        }
        const toolDefinitions = await this.collectToolDefinitions(
          mentionedServers,
          mentionOnlyServers,
          run,
        );
        if (!isChatRunActive(this.activeRun, run)) return;
        const resumeBaseDataBoundarySnapshot = createDataBoundarySnapshot({
          providerLabel: message.providerLabel ?? message.providerKey,
          model: message.model,
          hasUserQuestion: true,
          recentConversationMessageCount: Math.max(0, messageIndex),
          hasSystemPrompt: true,
          attachments: promptContext.attachments,
          citations: promptContext.citations,
          mcpServerNames: promptContext.preparedMcpServerNames ?? [],
        });
        const resumeDataBoundarySnapshot = withDataBoundaryProviderUsage(
          resumeBaseDataBoundarySnapshot,
          { researchDocumentCount: resumedResearchDocumentCount },
        );
        const resumeToolModelKey = `${message.providerKey}\u0000${message.model}`;
        const resumeToolProtocol: ToolTranscriptProtocol =
          provider.capability.toolCalling &&
          message.providerCapability?.toolCalling !== false &&
          !this.compatibilityToolModels.has(resumeToolModelKey)
            ? 'native'
            : 'compatibility';
        const resumePlan = createToolApprovalResumePlan({
          promptSystemPrompt: promptContext.systemPrompt,
          toolDefinitions,
          providerSupportsToolCalling: resumeToolProtocol === 'native',
          toolCalls: updated,
          dataBoundarySnapshot: resumeDataBoundarySnapshot,
        });
        const previousMessages = buildProviderConversation(
          this.messages.slice(0, Math.max(0, messageIndex)),
          resumeToolProtocol,
        );
        const baseMessages: ChatMessage[] = [
          ...(resumePlan.systemPrompt
            ? [{ role: 'system' as const, content: resumePlan.systemPrompt }]
            : []),
          ...previousMessages,
        ];
        await this.runToolResponseLoop({
          provider,
          messageId,
          baseMessages,
          toolDefinitions,
          toolProtocol: resumeToolProtocol,
          question: currentQuestion,
          contextAttachments: promptContext.attachments,
          maxToolRounds: provider.capability.maxToolRounds,
          toolCalls: updated,
          run,
          meta: {
            providerKey: message.providerKey,
            providerLabel: message.providerLabel,
            model: message.model,
            providerCapability: message.providerCapability,
            citations: promptContext.citations,
            contextAttachments: promptContext.attachments,
            dataBoundarySnapshot: resumePlan.dataBoundarySnapshot,
            indexedReviewDiagnostics: message.indexedReviewDiagnostics,
            indexedReviewNotice: message.indexedReviewNotice,
          },
          mentionedServers,
          explicitToolServerCount: mentionOnlyServers.length,
          explicitToolServerNames: mentionOnlyServers,
        });
        if (!isChatRunActive(this.activeRun, run)) return;
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
    } catch (err) {
      if (!isChatRunOwner(this.activeRun, run)) return;
      setHidden(this.typingIndicator, true);
      const latestMessage = this.messages.find((item) => item.id === messageId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.updateMessage(
          messageId,
          latestMessage?.content || t('chatGenerationStopped'),
          true,
          latestMessage?.reasoning,
          this.cancelRunningToolCalls(latestMessage?.toolCalls),
          { status: 'complete', stopReason: 'cancelled' },
        );
        return;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorKind =
        err instanceof ExplicitMcpToolDiscoveryError ? 'tool-failed' : classifyChatFailure(err);
      const presentation =
        err instanceof ExplicitMcpToolDiscoveryError
          ? {
              content: t('mcpMentionedServerUnavailable', { server: err.serverName }),
              retryAvailableAt: undefined,
            }
          : createChatErrorPresentation(errorKind, getChatRetryAfterMs(err));
      const errorDetail = this.formatErrorDetail(
        message.providerKey ?? 'unknown',
        message.model ?? 'unknown',
        redactDebugDetail(errorMsg),
        getChatHttpStatus(err),
      );
      this.updateMessage(
        messageId,
        presentation.content,
        true,
        latestMessage?.reasoning,
        latestMessage?.toolCalls,
        {
          status: 'error',
          stopReason: 'error',
          errorMessage: errorDetail,
          errorKind,
          errorRetryAt: presentation.retryAvailableAt,
        },
      );
    } finally {
      const finalization = planChatRunFinalization(this.activeRun, run, false);
      if (finalization.clearPendingState) {
        this.pendingSubmittedDraft = null;
        this.pendingRegeneration = null;
      }
      if (finalization.saveSession) {
        await this.saveCurrentSession();
        if (titleProvider) await this.summarizeCurrentSessionTitle(titleProvider, run);
        await this.saveCurrentSession();
      }
      if (finalization.clearLoading && isChatRunOwner(this.activeRun, run)) {
        setHidden(this.typingIndicator, true);
        this.activeRun = null;
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        this.setLoading(false);
      }
    }
  }

  private getChatQueryEngine(
    observer: ChatView['retrievalObserver'] | null = this.retrievalObserver,
  ): ReturnType<typeof observeChatRetrieval> | null {
    const engine = this.plugin.ragEngine;
    if (!engine) return null;
    if (!observer || !isChatRunActive(this.activeRun, observer.run)) return engine;
    return observeChatRetrieval(engine, observer.record);
  }

  private async buildPromptContext(
    lastUserText: string,
    previousUserQuestions: readonly string[] = [],
    deferImplicitFolderEvidenceToTools = false,
    workspaceFiles: WorkspaceMentionFiles = captureWorkspaceMentionFiles(this.app),
    provider?: LLMProvider,
    signal?: AbortSignal,
    deferAutoRagToReview = false,
  ): Promise<ContextBuildResult> {
    const retrievalObserver = this.retrievalObserver ?? null;
    const parts: string[] = [];
    const systemPrompt = getEffectiveSystemPrompt(this.plugin.settings, this.sessionSystemPrompt);
    if (systemPrompt) parts.push(systemPrompt);

    const pluginDocumentation = await buildPluginAwareDocumentation({
      enabled: this.plugin.settings.pluginAwareEnabled,
      question: lastUserText,
      previousQuestions: previousUserQuestions,
      plugins: this.plugin.settings.pluginAwareEnabled ? getActivePluginInfo(this.app) : [],
      registry: this.plugin.mcpRegistry,
      executionMode: this.plugin.settings.chat.mcpToolExecutionPolicy,
      approve: () => confirmWithModal(this.app, t('pluginAwareDocumentationApproval')),
      signal,
    });
    if (pluginDocumentation) parts.push(pluginDocumentation.prompt);
    if (pluginDocumentation?.failureMessage) {
      return {
        systemPrompt: parts.join('\n'),
        attachments: pluginDocumentation.attachments,
        citations: [],
        warnings: [],
        preparedMcpServerNames: pluginDocumentation.serverNames,
        pluginDocumentationFailure: pluginDocumentation.failureMessage,
      };
    }

    const skipAutoRag = this.skipAutoRagOnce;
    this.skipAutoRagOnce = false;
    const ragEngine: RagQueryLike | null = await resolveChatRagEngine(
      skipAutoRag ||
        pluginDocumentation !== null ||
        this.parseMentions(lastUserText).some((mention) => mention.type === 'tag'),
      () => this.plugin.prepareRagForChat(),
      () => this.getChatQueryEngine(retrievalObserver),
    );
    const { getRagCandidateFiles, isExplicitRagReadAllowed } = await import('../utils/vault');
    const candidateFiles = await getRagCandidateFiles(
      this.app.vault,
      this.plugin.settings.rag,
      this.plugin.settings.chat,
    );
    const context = await buildChatContext(lastUserText, {
      app: this.app,
      workspaceFiles,
      candidatePaths: new Set(candidateFiles.map((file) => file.path)),
      isExplicitReadAllowed: (file) =>
        isExplicitRagReadAllowed(
          this.app.vault,
          file,
          this.plugin.settings.rag,
          this.plugin.settings.chat,
        ),
      ragEngine,
      mcpRegistry: this.plugin.mcpRegistry,
      ragMinScore: this.plugin.settings.rag.minScore,
      maxContextChars: provider?.contextBudget?.evidenceChars,
      deferImplicitFolderEvidenceToTools,
      explicitContextOnly: pluginDocumentation !== null,
      enableVaultSearch: !skipAutoRag && pluginDocumentation === null,
      deferAutoRagToReview,
      signal,
      queryExpander: (question) => expandVaultSearchPlan(question, previousUserQuestions),
    });
    if (context.systemPrompt) parts.push(context.systemPrompt);

    return {
      ...context,
      preparedMcpServerNames: pluginDocumentation?.serverNames,
      pluginDocumentationFailure: pluginDocumentation?.failureMessage,
      attachments: [...(pluginDocumentation?.attachments ?? []), ...context.attachments],
      systemPrompt: parts.length > 0 ? parts.join('\n') : null,
    };
  }

  private parseMentions(text: string): ParsedMention[] {
    return parseContextMentions(text, createAppMentionResolver(this.app, this.plugin.mcpRegistry));
  }
  /** LLM API 에러 발생 시 진단 정보를 포함한 상세 메시지 생성 */
  private formatErrorDetail(
    providerKey: string,
    model: string,
    rawError: string,
    structuredStatus?: number,
  ): string {
    const timestamp = new Date().toISOString();
    const statusMatch = rawError.match(/\b(?:status\s*[:=]?\s*|http\s+|:\s*)(\d{3})\b/i);
    const statusCode = structuredStatus?.toString() ?? statusMatch?.[1] ?? 'unknown';

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
      statusCode !== 'unknown'
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
    const toolIcon = callRow.createSpan({
      cls: 'superpower-inside-tool-call-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(toolIcon, 'wrench');
    callRow.createSpan({
      cls: 'superpower-inside-tool-call-name',
      text: toolName || t('messageTool'),
    });
    const statusBadge = callRow.createSpan({
      cls: `superpower-inside-tool-call-status ${status}`,
    });
    const statusIcon = statusBadge.createSpan({
      cls: 'superpower-inside-tool-call-status-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(
      statusIcon,
      status === 'running' ? 'loader-circle' : status === 'success' ? 'check' : 'circle-alert',
    );
    statusBadge.createSpan({
      text:
        status === 'running'
          ? t('chatStatusRunning')
          : status === 'success'
            ? t('chatStatusDone')
            : t('chatStatusError'),
    });

    const resultArea = bubble.createDiv({ cls: 'superpower-inside-tool-result' });
    if (resultText && status !== 'running') {
      void this.renderMarkdownBubble(resultArea, resultText);
    }

    if (resultText && status !== 'running') {
      const resultId = `superpower-inside-tool-result-${this.localToolCallSequence++}`;
      resultArea.id = resultId;
      const toggle = bubble.createEl('button', {
        cls: 'superpower-inside-tool-result-toggle collapsed',
        attr: {
          type: 'button',
          'aria-expanded': 'false',
          'aria-controls': resultId,
        },
      });
      const toggleIcon = toggle.createSpan({
        cls: 'superpower-inside-tool-result-toggle-chevron',
        attr: { 'aria-hidden': 'true' },
      });
      setIcon(toggleIcon, 'chevron-right');
      toggle.createSpan({ text: t('toolResult') });
      toggle.addEventListener('click', () => {
        const isCollapsed = resultArea.classList.contains('collapsed');
        if (isCollapsed) {
          resultArea.classList.remove('collapsed');
          toggle.classList.remove('collapsed');
          toggle.setAttribute('aria-expanded', 'true');
          setIcon(toggleIcon, 'chevron-down');
        } else {
          resultArea.classList.add('collapsed');
          toggle.classList.add('collapsed');
          toggle.setAttribute('aria-expanded', 'false');
          setIcon(toggleIcon, 'chevron-right');
        }
      });
      resultArea.classList.add('collapsed');
    }
  }
}

/**
 * 확신도가 높지 않을 때 답변 뒤에 다른 해석 후보를 덧붙입니다.
 *
 * Google이 결과가 갈릴 때 "Showing results for …"를 붙이듯, 답변을 막고 되묻지 않고
 * 이미 준 답변을 유지한 채 한 줄만 덧붙입니다.
 */
function appendOtherInterpretations(
  content: string,
  evidence: readonly { path: string; score: number }[],
): string {
  const { confidence, alternatives } = summarizeIndexedConfidence(evidence);
  if (confidence === 'high' || alternatives.length === 0) return content;
  return `${content}\n\n${t('searchStatusOtherInterpretations', { paths: alternatives.join(', ') })}`;
}
