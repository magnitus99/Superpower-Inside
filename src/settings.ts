import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  setIcon,
  type EventRef,
  type Events,
} from 'obsidian';
import { validateMcpJson, formatMcpJson } from './utils/mcp-json';
import type { MCPRegistry } from './mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  type MCPConnectionState,
  type MCPServerConnectionStatus,
} from './mcp/connection-state';
import { isMcpStdioAvailable } from './mcp/platform';
import { RefreshAction } from './utils/refresh-action';
import type { VectorStore } from './rag/store';
import { isIndexingCancelledError, type IndexingResult, type VaultIndexer } from './rag/indexer';
import type { RAGIndexingScheduler } from './rag/indexing-scheduler';
import type { PerformanceGuardState } from './rag/performance-guard';
import { calculateRagStatus, type RagDocumentUpdate, type RagStatusSummary } from './rag/status';
import type { GraphRagCommunityBuildResult, GraphRagIndexingResult } from './graph/indexing-runner';
import {
  buildEmbeddingModelOptions,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  resolveRagPerformanceSettings,
  type RagPerformanceTuningMode,
  shouldShowProviderApiKey,
  buildGraphRagActionGroups,
  getGraphRagStatusPresentation,
  getGraphRagStatusLabel,
  getGraphRagLiveStatusPresentation,
  getGraphRagControlState,
  estimateGraphRagIndexingCost,
  type GraphRagActionDefinition,
} from './rag/settings-display';
import {
  createDefaultPromptEntry,
  createPromptEntry,
  getActivePromptEntry,
  type PromptLibraryEntry,
} from './chat/prompt-library';
import { openPromptLibraryModal } from './chat/prompt-library-modal';
import {
  isRecommendableExcludeExtension,
  validateExcludeExtensionInput,
  validateExcludePathInput,
  type ExcludeValidationIssue,
  type ExcludeValidationResult,
} from './utils/rag-exclude-validation';
import { countFilesByExtensions, getRagFileTypeSummary } from './utils/vault';
import { type Language, t } from './i18n';
import type { ProviderCapabilityOverrides } from './llm/provider-capabilities';
import {
  createDefaultContext7McpServer,
  shouldShowPluginAwareContext7Warning,
} from './mcp/context7';
import {
  buildSettingsOverviewSnapshot,
  type SettingsOverviewAttentionItem,
  type SettingsOverviewMetric,
  type SettingsOverviewRuntimeState,
  type SettingsOverviewStatusRow,
} from './settings-overview';
import { type AppLogger, type LoggerConfig } from './utils/logger';
interface StandardMcpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
interface StandardMcpConfig {
  mcpServers: Record<string, StandardMcpServerEntry>;
}
export function internalToStandard(servers: MCPServerConfig[]): StandardMcpConfig {
  const mcpServers: Record<string, StandardMcpServerEntry> = {};
  for (const s of servers) {
    const entry: StandardMcpServerEntry = { command: s.command };
    if (s.args !== undefined && s.args.length > 0) entry.args = s.args;
    if (s.env !== undefined && Object.keys(s.env).length > 0) entry.env = s.env;
    mcpServers[s.name] = entry;
  }
  return { mcpServers };
}
export function buildMcpJsonEditorValue(servers: MCPServerConfig[]): string {
  return JSON.stringify(internalToStandard(servers), null, 2);
}
function standardToInternal(standard: StandardMcpConfig): MCPServerConfig[] {
  const result: MCPServerConfig[] = [];
  for (const [name, cfg] of Object.entries(standard.mcpServers)) {
    result.push({
      name,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
    });
  }
  return result;
}
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
}
export interface CustomOpenAIProviderConfig extends ProviderConfig {
  id: string;
  name: string;
  useRequestUrl?: boolean;
  capabilityOverrides?: ProviderCapabilityOverrides;
}
export const PROVIDER_KEYS = ['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'] as const;
/** 채팅 모델 선택에 표시할 프로바이더 키 (ollama 계열만) */
export const CHAT_PROVIDER_KEYS: readonly ProviderKey[] = PROVIDER_KEYS;
export const PROVIDER_LABELS: Record<(typeof PROVIDER_KEYS)[number], string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  ollama: 'Ollama (Local)',
  ollamaCloud: 'Ollama (Cloud)',
  openRouter: 'OpenRouter',
};
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
export type BuiltInEmbeddingProviderKey = 'openai' | 'ollama' | 'openRouter' | 'other';
export type CustomOpenAIEmbeddingProviderKey = `customOpenAI:${string}`;
export type EmbeddingProviderKey = BuiltInEmbeddingProviderKey | CustomOpenAIEmbeddingProviderKey;
export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimensions: number;
  description: string;
}
export function buildEmbeddingModels(): Record<BuiltInEmbeddingProviderKey, EmbeddingModelInfo[]> {
  return {
    openai: [
      {
        id: 'text-embedding-3-small',
        name: 'text-embedding-3-small',
        dimensions: 1536,
        description: t('settingsAuto001'),
      },
      {
        id: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        dimensions: 3072,
        description: t('settingsAuto002'),
      },
    ],
    openRouter: [
      {
        id: 'openai/text-embedding-3-small',
        name: 'OpenAI text-embedding-3-small (via OpenRouter)',
        dimensions: 1536,
        description: t('settingsAuto003'),
      },
      {
        id: 'baai/bge-m3',
        name: 'BAAI bge-m3',
        dimensions: 1024,
        description: t('settingsAuto004'),
      },
      {
        id: 'qwen/qwen3-embedding-8b',
        name: 'Qwen3 Embedding 8B',
        dimensions: 1024,
        description: t('settingsAuto005'),
      },
    ],
    ollama: [
      {
        id: 'nomic-embed-text',
        name: 'nomic-embed-text',
        dimensions: 768,
        description: t('settingsAuto006'),
      },
    ],
    other: [],
  };
}
export const EMBEDDING_PROVIDER_LABELS: Record<BuiltInEmbeddingProviderKey, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  openRouter: 'OpenRouter',
  other: 'Other (Custom)',
};
export interface EmbeddingProviderOption {
  value: EmbeddingProviderKey;
  label: string;
}
export function isCustomOpenAIEmbeddingProviderKey(
  providerKey: string,
): providerKey is CustomOpenAIEmbeddingProviderKey {
  return providerKey.startsWith('customOpenAI:') && providerKey.length > 'customOpenAI:'.length;
}
export function getCustomOpenAIEmbeddingProviderId(
  providerKey: CustomOpenAIEmbeddingProviderKey,
): string {
  return providerKey.slice('customOpenAI:'.length);
}
export function buildEmbeddingProviderOptions(
  customProviders: readonly CustomOpenAIProviderConfig[],
): EmbeddingProviderOption[] {
  const options: EmbeddingProviderOption[] = Object.entries(EMBEDDING_PROVIDER_LABELS).map(
    ([value, label]) => ({
      value: value as BuiltInEmbeddingProviderKey,
      label,
    }),
  );
  for (const provider of customProviders) {
    if (!provider.enabled || !provider.baseUrl?.trim()) continue;
    options.push({
      value: `customOpenAI:${provider.id}`,
      label: provider.name.trim() || 'Custom OpenAI-Compatible',
    });
  }
  return options;
}
export interface RAGConfig {
  excludePaths: string[];
  excludeExts: string[];
  excludeChatFolder: boolean;
  chunkSize: number;
  overlap: number;
  embeddingProvider: EmbeddingProviderKey;
  embeddingModel: string;
  autoUpdateEnabled: boolean;
  autoUpdateIntervalMin: number;
  minScore: number;
  enableBM25: boolean;
  bm25Weight: number;
  performanceTuningMode: RagPerformanceTuningMode;
  performanceGuardEnabled: boolean;
  maxEmbeddingBatchSize: number;
  indexingYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
  structuralGraphEnabled: boolean;
  graphRagEnabled: boolean;
  graphRagModel: string;
  graphRagMaxFilesPerRun: number;
  graphRagQueryMode: 'auto' | 'local' | 'global' | 'hybrid';
  graphRagAutoSyncEnabled: boolean;
  graphRagAutoSyncIntervalMin: number;
  ontologyAutoMergeThreshold: number;
  ontologyPendingMergeThreshold: number;
  ontologyEnabled: boolean;
  annEnabled: boolean;
  annClusterCount: number;
  annProbeCount: number;
}
export interface ChatConfig {
  saveFolder: string;
  defaultModel: string;
  systemPrompt?: string;
  promptLibrary: PromptLibraryEntry[];
  activePromptId?: string;
  mcpToolExecutionPolicy: 'mentioned-auto' | 'always-manual' | 'always-auto';
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  enforceMcpTools: boolean;
}
export const DEFAULT_CHAT_SAVE_FOLDER = 'SuperpowerInsideChats';
export function normalizeChatSaveFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value;
}
export interface SuperpowerInsideSettings {
  openai: ProviderConfig;
  claude: ProviderConfig;
  ollama: ProviderConfig;
  ollamaCloud: ProviderConfig;
  openRouter: ProviderConfig;
  customOpenAIProviders: CustomOpenAIProviderConfig[];
  rag: RAGConfig;
  mcpServers: MCPServerConfig[];
  mcpPath: string;
  mcpIncludeWslPath: boolean;
  chat: ChatConfig;
  pluginAwareEnabled: boolean;
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  language: Language;
  logging: LoggerConfig;
}
export const DEFAULT_SETTINGS: SuperpowerInsideSettings = {
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4o-mini'],
    enabled: false,
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet-20241022'],
    enabled: false,
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    models: ['llama3.1'],
    enabled: false,
  },
  ollamaCloud: {
    apiKey: '',
    baseUrl: 'https://ollama.com',
    models: ['llama3.1'],
    enabled: false,
  },
  openRouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    models: ['openrouter/auto'],
    enabled: false,
  },
  customOpenAIProviders: [],
  rag: {
    excludePaths: ['.git', 'node_modules', 'attachments'],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    excludeChatFolder: true,
    chunkSize: 1000,
    overlap: 100,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autoUpdateEnabled: false,
    autoUpdateIntervalMin: 5,
    minScore: 0.5,
    enableBM25: true,
    bm25Weight: 0.3,
    performanceTuningMode: 'auto',
    performanceGuardEnabled: true,
    maxEmbeddingBatchSize: 32,
    indexingYieldMs: 25,
    slowEventLoopThresholdMs: 150,
    slowBatchThresholdMs: 3000,
    structuralGraphEnabled: true,
    graphRagEnabled: false,
    graphRagModel: '',
    graphRagMaxFilesPerRun: 50,
    graphRagQueryMode: 'auto',
    graphRagAutoSyncEnabled: false,
    graphRagAutoSyncIntervalMin: 30,
    ontologyEnabled: true,
    ontologyAutoMergeThreshold: 0.85,
    ontologyPendingMergeThreshold: 0.7,
    annEnabled: true,
    annClusterCount: 0,
    annProbeCount: 4,
  },
  mcpServers: [createDefaultContext7McpServer()],
  mcpPath: '',
  mcpIncludeWslPath: false,
  chat: {
    saveFolder: DEFAULT_CHAT_SAVE_FOLDER,
    defaultModel: 'ollama:llama3.1',
    systemPrompt: '',
    promptLibrary: [createDefaultPromptEntry()],
    activePromptId: 'default-obsidian-knowledge-work',
    mcpToolExecutionPolicy: 'mentioned-auto',
    autoSaveEnabled: true,
    autoSaveDebounceMs: 3000,
    enforceMcpTools: true,
  },
  pluginAwareEnabled: false,
  autoSaveEnabled: true,
  autoSaveDebounceMs: 1000,
  language: 'ko',
  logging: {
    minLevel: 'info',
    maxEntries: 1000,
    mirrorToConsole: true,
  },
};
export interface PluginLike {
  app: App;
  settings: SuperpowerInsideSettings;
  graphRagStatus: import('./graph/status').GraphRagStatusSummary | null;
  knowledgeGraphStore: import('./graph/store').KnowledgeGraphStore | null;
  vectorStore: import('./rag/store').VectorStore | null;
  saveSettings(options?: { reinitRag?: boolean; reinitMcp?: boolean }): Promise<{
    success: boolean;
    mcpErrors?: string[];
  }>;
  saveSettingsLight(): Promise<void>;
  reconnectMCP(): Promise<string[]>;
  setupAutoUpdate(): void;
  isGraphRagIndexing(): boolean;
  cancelGraphRagIndexing(): void;
  runGraphRagIndexing(): Promise<GraphRagIndexingResult | null>;
  resumeGraphRagIndexing(): Promise<GraphRagIndexingResult | null>;
  syncStaleGraphRag(): Promise<GraphRagIndexingResult | null>;
  buildGraphRagCommunities(): Promise<GraphRagCommunityBuildResult | null>;
  resetGraphRagData(): Promise<void>;
  hasGraphRagRunner(): boolean;
  openGraphRagView(): void;
  eventDrivenRagStats: import('./rag/status').RagStatusSummary | null;
  initRAG(): Promise<void>;
  isRagIndexing(): boolean;
  cancelRagIndexing(): void;
  runRagIndexing<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null>;
  resumeRagIndexing(): void;
  getRagPerformanceGuardState(): PerformanceGuardState | null;
  createIndexedDbName(kind: string): string;
  mcpRegistry: MCPRegistry | null;
  mcpConnectionState?: MCPConnectionState;
  mcpLastErrors?: string[];
  nextAutoUpdateAt?: number | null;
  lastAutoUpdateSkippedReason?: string | null;
  lastAutoUpdateResult?: IndexingResult | null;
  refreshBus: import('./utils/refresh-bus').RefreshBus;
  logger: AppLogger;
}
// 탭 타입 및 설정
type SettingsTabId = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced';
export function buildSettingsTabs(): {
  id: SettingsTabId;
  label: string;
}[] {
  return [
    { id: 'general', label: t('tabGeneral') },
    { id: 'providers', label: t('tabProviders') },
    { id: 'rag', label: t('tabRag') },
    { id: 'chat', label: t('tabChat') },
    { id: 'mcp', label: t('tabMcp') },
    { id: 'advanced', label: t('tabAdvanced') },
  ];
}
interface ProviderValidationCache {
  [key: string]: {
    valid: boolean;
    models: string[];
    error?: string;
  };
}
interface SettingsSaveOptions {
  reinitRag: boolean;
  reinitMcp: boolean;
}
type ProviderSettingsTarget =
  | {
      kind: 'fixed';
      key: ProviderKey;
      label: string;
      config: ProviderConfig;
    }
  | {
      kind: 'custom';
      key: string;
      label: string;
      config: CustomOpenAIProviderConfig;
    };
const HIDDEN_CLASS = 'superpower-inside-hidden';

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.toggleClass(HIDDEN_CLASS, hidden);
}

function createLightSaveOptions(): SettingsSaveOptions {
  return { reinitRag: false, reinitMcp: false };
}

function normalizeSaveOptions(options: Partial<SettingsSaveOptions>): SettingsSaveOptions {
  return {
    reinitRag: options.reinitRag ?? false,
    reinitMcp: options.reinitMcp ?? false,
  };
}

function mergeSaveOptions(
  current: SettingsSaveOptions,
  next: SettingsSaveOptions,
): SettingsSaveOptions {
  return {
    reinitRag: current.reinitRag || next.reinitRag,
    reinitMcp: current.reinitMcp || next.reinitMcp,
  };
}

export class SuperpowerInsideSettingTab extends PluginSettingTab {
  private plugin: PluginLike;
  private mcpStatusEventRef: EventRef | null = null;
  private activeTab: SettingsTabId = 'general';
  private tabButtons: Map<SettingsTabId, HTMLButtonElement> = new Map();
  private tabPanels: Map<SettingsTabId, HTMLDivElement> = new Map();
  private validationCache: ProviderValidationCache = {};
  private saveTimeout: number | null = null;
  private pendingSave = false;
  private pendingSaveOptions: SettingsSaveOptions = createLightSaveOptions();
  private pendingEmbeddingProvider: EmbeddingProviderKey | null = null;
  private pendingEmbeddingModel: string | null = null;
  private isRebuildingEmbeddingSection = false;
  private defaultModelDropdownEl: HTMLSelectElement | null = null;
  // RefreshAction 인스턴스 (생명주기 == 탭 활성화 기간)
  private mcpStatusRefresh: RefreshAction | null = null;
  private excludeCountRenderer: (() => void) | null = null;
  // RAG 상태 패널의 DOM 참조 (부분 업데이트용)
  private ragStatusGrid: HTMLElement | null = null;
  private ragStatusTimestamp: HTMLElement | null = null;
  private ragStatusAction: HTMLElement | null = null;
  private ragStatusDetails: HTMLElement | null = null;
  private ragControlsHint: HTMLElement | null = null;
  private updatePendingButton: HTMLButtonElement | null = null;
  private reindexAllButton: HTMLButtonElement | null = null;
  private cancelIndexingButton: HTMLButtonElement | null = null;
  private resumeIndexingButton: HTMLButtonElement | null = null;
  // GraphRAG 상태 패널의 DOM 참조 (부분 업데이트용)
  private graphRagSummaryBanner: HTMLElement | null = null;
  private graphRagStatusGrid: HTMLElement | null = null;
  private graphRagActionsGroup: HTMLElement | null = null;
  private graphRagSectionContainer: HTMLElement | null = null;
  private graphRagProgressBanner: HTMLElement | null = null;
  private graphRagModelSelectEl: HTMLSelectElement | null = null;
  // RefreshBus 구독 해제 함수들
  private refreshBusUnsubscribers: (() => void)[] = [];
  constructor(app: App, plugin: PluginLike) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }
  debouncedSave(options: Partial<SettingsSaveOptions> = {}): void {
    this.pendingSaveOptions = mergeSaveOptions(
      this.pendingSaveOptions,
      normalizeSaveOptions(options),
    );
    if (!this.plugin.settings.autoSaveEnabled) {
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
      return;
    }
    this.pendingSave = true;
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveTimeout = null;
      this.pendingSave = false;
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
    }, this.plugin.settings.autoSaveDebounceMs);
  }
  private debouncedRagSave(): void {
    this.debouncedSave({ reinitRag: true });
  }
  flushSave(): void {
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.pendingSave) {
      this.pendingSave = false;
      const saveOptions = this.consumePendingSaveOptions();
      void this.saveSettingsWithFeedback(saveOptions);
    }
  }
  private consumePendingSaveOptions(): SettingsSaveOptions {
    const options = this.pendingSaveOptions;
    this.pendingSaveOptions = createLightSaveOptions();
    return options;
  }
  private async saveSettingsWithFeedback(options: SettingsSaveOptions): Promise<void> {
    try {
      await this.plugin.saveSettings(options);
      new Notice(t('autoSaveSuccessNotice'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('autoSaveFailedNotice', { message }), 7000);
    }
  }
  hide(): void {
    this.unregisterMcpStatusEvent();
    // RefreshAction 인스턴스 정리
    this.mcpStatusRefresh?.detach();
    this.mcpStatusRefresh = null;
    this.excludeCountRenderer = null;
    // RefreshBus 구독 해제
    for (const unsub of this.refreshBusUnsubscribers) {
      unsub();
    }
    this.refreshBusUnsubscribers = [];
    // DOM 참조 초기화
    this.ragStatusGrid = null;
    this.ragStatusTimestamp = null;
    this.ragStatusAction = null;
    this.ragStatusDetails = null;
    this.ragControlsHint = null;
    this.updatePendingButton = null;
    this.reindexAllButton = null;
    this.cancelIndexingButton = null;
    this.resumeIndexingButton = null;
    if (this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null) {
      this.pendingEmbeddingProvider = null;
      this.pendingEmbeddingModel = null;
      new Notice(t('settingsAuto007'));
    }
    this.flushSave();
    super.hide();
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // RefreshBus 구독: 이벤트 수신 시 부분 업데이트
    const bus = this.plugin.refreshBus;
    if (bus) {
      this.refreshBusUnsubscribers.push(
        bus.on('rag', (result) => {
          this.updateRagStats(result.detail);
          this.updateGraphRagStats();
          this.refreshStatsGrid();
          this.refreshFileTypeSummary();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('graph-progress', () => {
          this.updateGraphRagStats();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('models', () => {
          this.refreshRagTab();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('mcp', () => {
          this.refreshMcpStatusSection();
        }),
      );
      this.refreshBusUnsubscribers.push(
        bus.on('exclude-counts', () => {
          this.excludeCountRenderer?.();
        }),
      );
    }
    containerEl.addClass('superpower-inside-settings-root');
    // 헤더
    new Setting(containerEl).setName(t('settingsTitle')).setHeading();
    // 보안 경고
    const warning = containerEl.createDiv({
      cls: 'superpower-inside-settings-warning',
    });
    warning.setText(t('securityWarning'));
    // 탭 바
    const tabBar = containerEl.createDiv({ cls: 'superpower-inside-settings-tabs' });
    const tabs = buildSettingsTabs();
    tabs.forEach((tab) => {
      const button = tabBar.createEl('button', {
        text: tab.label,
        cls: 'superpower-inside-settings-tab',
      });
      this.tabButtons.set(tab.id, button);
      button.addEventListener('click', () => this.switchTab(tab.id));
    });
    // 탭 콘텐츠 패널
    const tabContentContainer = containerEl.createDiv({
      cls: 'superpower-inside-settings-tab-panels',
    });
    tabs.forEach((tab) => {
      const panel = tabContentContainer.createDiv({
        cls: 'superpower-inside-settings-tab-content',
      });
      this.tabPanels.set(tab.id, panel);
      // 각 탭 콘텐츠 구성
      switch (tab.id) {
        case 'general':
          this.buildGeneralTab(panel);
          break;
        case 'providers':
          this.buildProvidersTab(panel);
          break;
        case 'rag':
          this.buildRAGTab(panel);
          break;
        case 'chat':
          this.buildChatTab(panel);
          break;
        case 'mcp':
          this.buildMCPTab(panel);
          break;
        case 'advanced':
          this.buildAdvancedTab(panel);
          break;
      }
    });
    // 첫 번째 탭을 활성 상태로 초기화
    this.switchTab(this.activeTab);
  }
  private switchTab(tabId: SettingsTabId): void {
    // 활성 탭 업데이트
    this.activeTab = tabId;
    // 버튼 클래스 토글
    this.tabButtons.forEach((button, id) => {
      if (id === tabId) {
        button.classList.add('is-active');
      } else {
        button.classList.remove('is-active');
      }
    });
    // 패널 클래스 토글
    this.tabPanels.forEach((panel, id) => {
      if (id === tabId) {
        panel.classList.add('is-active');
      } else {
        panel.classList.remove('is-active');
      }
    });
    if (tabId === 'general') {
      this.refreshGeneralTab();
    } else if (tabId === 'rag') {
      this.refreshRagTab();
    }
  }
  private refreshGeneralTab(): void {
    this.repopulateDefaultModelDropdown();
  }
  /** General 탭의 기본 모델 dropdown만 다시 채웁니다 (full rebuild 대신). */
  private repopulateDefaultModelDropdown(): void {
    const dropdown = this.defaultModelDropdownEl;
    if (!dropdown) return;
    const allModels: {
      value: string;
      label: string;
    }[] = [];
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
    allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    const defaultModel = this.plugin.settings.chat.defaultModel;
    dropdown.empty();
    if (allModels.length === 0) {
      const opt = dropdown.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      dropdown.disabled = true;
    } else {
      for (const m of allModels) {
        const opt = dropdown.createEl('option');
        opt.value = m.value;
        opt.text = m.label;
      }
      dropdown.value =
        defaultModel && allModels.some((m) => m.value === defaultModel)
          ? defaultModel
          : allModels[0].value;
      dropdown.disabled = false;
    }
    this.plugin.refreshBus.emit('models', { status: 'success' });
  }
  private refreshRagTab(): void {
    const ragPanel = this.tabPanels.get('rag');
    if (!ragPanel) return;
    if (this.graphRagModelSelectEl) {
      const modelOptions = buildChatModelOptions(this.plugin.settings, {
        currentModel: this.plugin.settings.rag.graphRagModel,
        includeEmpty: true,
        emptyLabel: t('settingsAuto008'),
      });
      this.graphRagModelSelectEl.empty();
      for (const option of modelOptions) {
        const opt = this.graphRagModelSelectEl.createEl('option');
        opt.value = option.value;
        opt.text = option.label;
      }
      const selectedModel = this.plugin.settings.rag.graphRagModel.trim();
      this.graphRagModelSelectEl.value = modelOptions.some(
        (option) => option.value === selectedModel,
      )
        ? selectedModel
        : '';
    }
  }
  private createSettingsPanel(
    containerEl: HTMLElement,
    titleText: string,
    options: {
      description?: string;
      meta?: string;
      className?: string;
    } = {},
  ): HTMLElement {
    const panel = containerEl.createDiv({
      cls: `superpower-inside-settings-panel${options.className ? ` ${options.className}` : ''}`,
    });
    const header = panel.createDiv({ cls: 'superpower-inside-settings-panel-header' });
    const titleGroup = header.createDiv({ cls: 'superpower-inside-settings-panel-title-group' });
    titleGroup.createDiv({ cls: 'superpower-inside-settings-panel-title', text: titleText });
    if (options.description) {
      titleGroup.createDiv({
        cls: 'superpower-inside-settings-panel-desc',
        text: options.description,
      });
    }
    if (options.meta) {
      header.createDiv({ cls: 'superpower-inside-settings-panel-meta', text: options.meta });
    }
    return panel;
  }
  private buildGeneralTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const snapshot = buildSettingsOverviewSnapshot({
      settings: this.plugin.settings,
      runtime: this.buildOverviewRuntimeState(),
    });
    const dashboard = containerEl.createDiv({ cls: 'superpower-inside-overview' });
    const header = dashboard.createDiv({ cls: 'superpower-inside-overview-header' });
    const title = header.createDiv({ cls: 'superpower-inside-overview-title' });
    title.createDiv({ cls: 'superpower-inside-overview-heading', text: 'Overview' });
    title.createDiv({
      cls: 'superpower-inside-overview-subtitle',
      text: t('settingsAuto009'),
    });
    const refreshBtn = header.createEl('button', {
      cls: 'superpower-inside-overview-refresh',
      attr: { type: 'button' },
      text: t('settingsAuto010'),
    });
    refreshBtn.addEventListener('click', () => {
      this.updateRagStats();
      this.updateGraphRagStats();
      this.buildGeneralTab(containerEl);
    });
    this.renderOverviewMetrics(dashboard, snapshot.metrics);
    this.renderOverviewAttention(dashboard, snapshot.attentionItems);
    const matrix = dashboard.createDiv({ cls: 'superpower-inside-overview-matrix' });
    this.renderOverviewSection(matrix, t('settingsAuto011'), snapshot.providerRows);
    this.renderOverviewSection(matrix, t('settingsAuto012'), snapshot.mcpRows);
    this.renderOverviewCompactMetrics(matrix, t('settingsAuto013'), [
      snapshot.rag,
      snapshot.graphRag,
    ]);
    this.renderOverviewCompactMetrics(matrix, t('settingsAuto014'), [snapshot.chat]);
    const basics = this.createSettingsPanel(containerEl, t('settingsAuto015'), {
      description: t('settingsAuto016'),
      className: 'superpower-inside-overview-basics',
    });
    new Setting(basics)
      .setName(t('language'))
      .setDesc(t('languageDesc'))
      .addDropdown((dropdown) => {
        dropdown.addOption('ko', t('langKo'));
        dropdown.addOption('en', t('langEn'));
        dropdown.setValue(this.plugin.settings.language);
        dropdown.onChange(async (value) => {
          const newLang = value as Language;
          const currentLang = this.plugin.settings.language;
          if (newLang === currentLang) {
            return;
          }
          const confirmed = confirm(t('languageChangeConfirm'));
          if (!confirmed) {
            dropdown.setValue(currentLang);
            return;
          }
          this.plugin.settings.language = newLang;
          await this.plugin.saveSettings();
          window.location.reload();
        });
      });
    new Setting(basics)
      .setName(t('autoSaveSettings'))
      .setDesc(t('autoSaveSettingsDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSaveEnabled).onChange(async (value) => {
          this.plugin.settings.autoSaveEnabled = value;
          await this.plugin.saveSettingsLight();
        }),
      );
    new Setting(basics)
      .setName(t('autoSaveDelay'))
      .setDesc(t('autoSaveDelayDesc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.plugin.settings.autoSaveDebounceMs));
        text.inputEl.parentElement?.createSpan({
          cls: 'superpower-inside-delay-unit',
          text: ` ${t('delayMs')}`,
        });
        text.onChange((value) => {
          const num = parseInt(value, 10);
          if (!Number.isNaN(num) && num >= 0 && num <= 5000) {
            this.plugin.settings.autoSaveDebounceMs = num;
            this.debouncedSave();
          }
        });
      });
    const allModels: {
      value: string;
      label: string;
    }[] = [];
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
    allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));
    new Setting(basics)
      .setName(t('defaultModel'))
      .setDesc(t('defaultModelDesc'))
      .addDropdown((dropdown) => {
        this.defaultModelDropdownEl = dropdown.selectEl;
        if (allModels.length === 0) {
          dropdown.addOption('', t('noModelsEnabled'));
          dropdown.setDisabled(true);
        } else {
          for (const opt of allModels) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.plugin.settings.chat.defaultModel);
          dropdown.setDisabled(false);
        }
        dropdown.onChange((value) => {
          this.plugin.settings.chat.defaultModel = value;
          this.debouncedSave();
        });
      });
  }

  private buildOverviewRuntimeState(): SettingsOverviewRuntimeState {
    const registry = this.plugin.mcpRegistry;
    return {
      ragStatus: this.plugin.eventDrivenRagStats,
      graphRagStatus: this.plugin.graphRagStatus,
      mcpConnectionState: this.plugin.mcpConnectionState ?? 'idle',
      mcpServers: this.plugin.settings.mcpServers.map((server) => ({
        name: server.name,
        status: registry?.getConnectionStatus(server.name) ?? 'disconnected',
        error: registry?.getLastError(server.name),
      })),
      isRagIndexing: this.plugin.isRagIndexing(),
      isGraphRagIndexing: this.plugin.isGraphRagIndexing(),
      hasGraphRagRunner: this.plugin.hasGraphRagRunner(),
    };
  }
  private renderOverviewMetrics(
    containerEl: HTMLElement,
    metrics: readonly SettingsOverviewMetric[],
  ): void {
    const grid = containerEl.createDiv({ cls: 'superpower-inside-overview-metrics' });
    for (const metric of metrics) {
      const item = grid.createEl('button', {
        cls: `superpower-inside-overview-metric is-${metric.tone}`,
        attr: { type: 'button' },
      });
      item.addEventListener('click', () => this.switchTab(metric.target));
      item.createDiv({ cls: 'superpower-inside-overview-metric-label', text: metric.label });
      item.createDiv({ cls: 'superpower-inside-overview-metric-value', text: metric.value });
      item.createDiv({ cls: 'superpower-inside-overview-metric-status', text: metric.statusLabel });
      item.createDiv({ cls: 'superpower-inside-overview-metric-detail', text: metric.detail });
    }
  }
  private renderOverviewAttention(
    containerEl: HTMLElement,
    items: readonly SettingsOverviewAttentionItem[],
  ): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-overview-panel' });
    const header = section.createDiv({ cls: 'superpower-inside-overview-panel-header' });
    header.createDiv({
      cls: 'superpower-inside-overview-section-title',
      text: t('settingsAuto017'),
    });
    header.createDiv({
      cls: 'superpower-inside-overview-section-meta',
      text:
        items.length === 0
          ? t('settingsAuto018')
          : t('settingsAuto019', { v0: String(items.length) }),
    });
    if (items.length === 0) {
      section.createDiv({
        cls: 'superpower-inside-overview-empty',
        text: t('settingsAuto020'),
      });
      return;
    }
    const list = section.createDiv({ cls: 'superpower-inside-overview-action-list' });
    for (const item of items) {
      const row = list.createDiv({ cls: `superpower-inside-overview-action-row is-${item.tone}` });
      row.createDiv({ cls: 'superpower-inside-overview-action-label', text: item.label });
      row.createDiv({ cls: 'superpower-inside-overview-action-detail', text: item.detail });
      const btn = row.createEl('button', {
        cls: 'superpower-inside-overview-inline-btn',
        attr: { type: 'button' },
        text: item.actionLabel,
      });
      btn.addEventListener('click', () => this.switchTab(item.target));
    }
  }
  private renderOverviewSection(
    containerEl: HTMLElement,
    titleText: string,
    rows: readonly SettingsOverviewStatusRow[],
  ): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-overview-panel' });
    const header = section.createDiv({ cls: 'superpower-inside-overview-panel-header' });
    header.createDiv({ cls: 'superpower-inside-overview-section-title', text: titleText });
    header.createDiv({
      cls: 'superpower-inside-overview-section-meta',
      text:
        rows.length === 0
          ? t('settingsAuto021')
          : t('settingsAuto022', { v0: String(rows.length) }),
    });
    if (rows.length === 0) {
      section.createDiv({ cls: 'superpower-inside-overview-empty', text: t('settingsAuto023') });
      return;
    }
    const list = section.createDiv({ cls: 'superpower-inside-overview-status-list' });
    for (const row of rows) {
      const item = list.createEl('button', {
        cls: `superpower-inside-overview-status-row is-${row.tone}`,
        attr: { type: 'button' },
      });
      item.addEventListener('click', () => this.switchTab(row.target));
      item.createDiv({ cls: 'superpower-inside-overview-status-name', text: row.label });
      item.createDiv({ cls: 'superpower-inside-overview-status-value', text: row.value });
      item.createDiv({ cls: 'superpower-inside-overview-status-badge', text: row.statusLabel });
      item.createDiv({ cls: 'superpower-inside-overview-status-detail', text: row.detail });
    }
  }
  private renderOverviewCompactMetrics(
    containerEl: HTMLElement,
    titleText: string,
    metrics: readonly SettingsOverviewMetric[],
  ): void {
    const rows = metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      statusLabel: metric.statusLabel,
      detail: metric.detail,
      tone: metric.tone,
      target: metric.target,
    }));
    this.renderOverviewSection(containerEl, titleText, rows);
  }
  private buildProvidersTab(containerEl: HTMLElement): void {
    this.createSettingsPanel(containerEl, t('settingsAuto011'), {
      description: t('settingsAuto024'),
      meta: t('settingsAuto025', {
        v0: String(CHAT_PROVIDER_KEYS.length + this.plugin.settings.customOpenAIProviders.length),
      }),
      className: 'superpower-inside-settings-intro-panel',
    });
    this.buildProviderSettings(containerEl, {
      kind: 'fixed',
      key: 'openai',
      label: 'OpenAI',
      config: this.plugin.settings.openai,
    });
    this.buildProviderSettings(containerEl, {
      kind: 'fixed',
      key: 'claude',
      label: 'Claude (Anthropic)',
      config: this.plugin.settings.claude,
    });
    this.buildProviderSettings(containerEl, {
      kind: 'fixed',
      key: 'ollama',
      label: 'Ollama (Local)',
      config: this.plugin.settings.ollama,
    });
    this.buildProviderSettings(containerEl, {
      kind: 'fixed',
      key: 'ollamaCloud',
      label: 'Ollama (Cloud)',
      config: this.plugin.settings.ollamaCloud,
    });
    this.buildProviderSettings(containerEl, {
      kind: 'fixed',
      key: 'openRouter',
      label: 'OpenRouter',
      config: this.plugin.settings.openRouter,
    });
    this.buildCustomOpenAIProvidersSection(containerEl);
  }
  private buildRAGTab(containerEl: HTMLElement): void {
    const dashboard = containerEl.createDiv({ cls: 'superpower-inside-rag-dashboard' });
    this.buildRagStatusPanel(dashboard);
    this.buildControlsSection(dashboard);

    const coreSettings = containerEl.createDiv({ cls: 'superpower-inside-rag-settings-stack' });
    this.buildEmbeddingProviderSection(coreSettings);
    this.buildExcludeOptionsSection(coreSettings);

    this.buildGraphRagOperationsSection(containerEl);
    this.buildRagAdvancedSection(containerEl);
  }
  private buildRagAdvancedSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-advanced',
    });
    const header = section.createEl('button', {
      cls: 'superpower-inside-rag-collapsible-header',
      attr: { type: 'button', 'aria-expanded': 'false' },
    });
    const chevron = header.createSpan({
      cls: 'superpower-inside-rag-collapsible-chevron',
      text: '▶',
    });
    header.createSpan({
      cls: 'superpower-inside-rag-collapsible-title',
      text: t('settingsAuto026'),
    });
    const content = section.createDiv({
      cls: 'superpower-inside-rag-collapsible-content is-collapsed',
    });
    this.buildIndexingOptionsSection(content);
    this.buildSearchQualitySection(content);
    this.buildStatsSection(content);
    this.buildTargetFileTypesSection(content);
    this.buildUpdateRequiredDocumentsSection(content);
    header.addEventListener('click', () => {
      const isCollapsed = content.hasClass('is-collapsed');
      content.toggleClass('is-collapsed', !isCollapsed);
      header.setAttr('aria-expanded', isCollapsed ? 'true' : 'false');
      chevron.setText(isCollapsed ? '▼' : '▶');
    });
  }
  private buildRagStatusPanel(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-section superpower-inside-rag-status-panel',
    });
    const header = section.createDiv({ cls: 'superpower-inside-rag-status-header' });
    header.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto027') });
    const statusGrid = section.createDiv({ cls: 'superpower-inside-rag-status-grid' });
    const actionEl = section.createDiv({ cls: 'superpower-inside-rag-status-action' });
    const detailsEl = section.createDiv({ cls: 'superpower-inside-rag-status-details' });
    const warning = this.getRagSetupWarning();
    if (warning) {
      section.createDiv({ cls: 'superpower-inside-settings-warning', text: warning });
    }
    const timestampEl = section.createDiv({
      cls: 'superpower-inside-rag-status-timestamp',
      text: t('settingsAuto028'),
    });
    // DOM 참조 저장 (부분 업데이트용)
    this.ragStatusGrid = statusGrid;
    this.ragStatusAction = actionEl;
    this.ragStatusDetails = detailsEl;
    this.ragStatusTimestamp = timestampEl;
    // 자동 갱신은 백그라운드 타이머/이벤트에서 처리
    void this.updateRagStats();
  }
  private createRagStatusItem(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({ cls: 'superpower-inside-rag-status-item' });
    item.createDiv({ cls: 'superpower-inside-rag-status-label', text: label });
    item.createDiv({ cls: 'superpower-inside-rag-status-value', text: value });
  }
  private createRagStatusItemWithDesc(
    containerEl: HTMLElement,
    label: string,
    value: string,
    description: string,
    tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral',
  ): void {
    const item = containerEl.createDiv({ cls: 'superpower-inside-rag-status-item' });
    item.createDiv({ cls: 'superpower-inside-rag-status-label', text: label });
    const valueEl = item.createDiv({ cls: 'superpower-inside-rag-status-value', text: value });
    if (tone !== 'neutral') {
      valueEl.addClass(`is-${tone}`);
    }
    if (description) {
      item.createDiv({ cls: 'superpower-inside-rag-status-description', text: description });
    }
  }
  private buildGraphRagOperationsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-section superpower-inside-rag-graph-panel',
    });
    this.graphRagSectionContainer = section;
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto029') });
    const rag = this.plugin.settings.rag;
    const graphState = this.plugin.graphRagStatus;
    const statusLabel =
      graphState?.state ??
      getGraphRagStatusLabel({
        enabled: rag.graphRagEnabled,
        hasGraphIndex: false,
        isRunning: this.plugin.isGraphRagIndexing(),
        isStale: false,
        partialFailureCount: 0,
      });
    const presentation = getGraphRagStatusPresentation(statusLabel);
    const cost = estimateGraphRagIndexingCost({
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? this.plugin.eventDrivenRagStats?.totalDocuments ?? 0,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      averageChunksPerFile: 3,
      averageTokensPerChunk: 900,
      providerKind: rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')
        ? 'local'
        : 'remote',
    });
    const controls = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? this.plugin.eventDrivenRagStats?.totalDocuments ?? 0,
      failedFileCount: graphState?.failedFileCount ?? 0,
    });
    // 진행 중 배너 (기본 숨김)
    const progressBanner = section.createDiv({
      cls: 'superpower-inside-rag-graph-progress-banner superpower-inside-hidden',
    });
    const spinner = progressBanner.createDiv({ cls: 'superpower-inside-spinner' });
    spinner.setAttr('aria-hidden', 'true');
    const progressBody = progressBanner.createDiv({
      cls: 'superpower-inside-rag-graph-progress-body',
    });
    const progressTitle = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-title',
      text: '',
    });
    progressTitle.id = 'superpower-inside-graph-progress-title';
    const progressPhase = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-phase',
      text: '',
    });
    progressPhase.id = 'superpower-inside-graph-progress-phase';
    const progressText = progressBody.createDiv({
      cls: 'superpower-inside-rag-graph-progress-detail',
      text: '',
    });
    progressText.id = 'superpower-inside-graph-progress-text';
    this.graphRagProgressBanner = progressBanner;
    this.renderGraphRagProgressBanner();
    // 요약 배너
    const total = graphState?.totalCandidateFiles ?? 0;
    const done = graphState?.graphEvidenceCount ?? 0;
    const failed = graphState?.failedFileCount ?? 0;
    const stale = graphState?.staleFileCount ?? 0;
    const summaryText =
      total > 0
        ? t('settingsAuto030', {
            v0: String(total),
            v1: String(done),
            v2: String(failed > 0 ? t('settingsAuto031', { v0: String(failed) }) : ''),
            v3: String(stale > 0 ? t('settingsAuto032', { v0: String(stale) }) : ''),
          })
        : t('settingsAuto033');
    const banner = section.createDiv({ cls: 'superpower-inside-rag-graph-summary-banner' });
    this.graphRagSummaryBanner = banner;
    banner.setText(summaryText);
    // 상태 그리드
    const grid = section.createDiv({ cls: 'superpower-inside-rag-status-grid' });
    this.graphRagStatusGrid = grid;
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto034'),
      presentation.label,
      presentation.description,
      presentation.tone,
    );
    this.createRagStatusItem(grid, t('settingsAuto035'), String(total));
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto036'),
      String(done),
      t('settingsAuto036Desc'),
      'success',
    );
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto037'),
      String(failed),
      failed > 0 ? t('settingsAuto038') : t('settingsAuto039'),
    );
    this.createRagStatusItemWithDesc(
      grid,
      t('settingsAuto040'),
      String(stale),
      stale > 0 ? t('settingsAuto041') : t('settingsAuto042'),
      stale > 0 ? 'warning' : 'success',
    );
    this.createRagStatusItem(grid, t('settingsAuto043'), cost.costLabel);
    const runnerRef = (
      this.plugin as unknown as {
        graphRagIndexingRunner?: {
          getLastCommunityResult(): {
            communityCount: number;
            modularity: number;
          } | null;
        } | null;
      }
    ).graphRagIndexingRunner;
    const lastCommunity = runnerRef?.getLastCommunityResult();
    if (lastCommunity) {
      this.createRagStatusItemWithDesc(
        grid,
        t('settingsAuto044'),
        String(lastCommunity.communityCount),
        `modularity ${lastCommunity.modularity.toFixed(3)}`,
      );
    }
    // 접이식 비용 상세
    const costToggle = section.createDiv({
      cls: 'superpower-inside-rag-graph-cost-toggle',
      text: t('settingsAuto045'),
    });
    const costDetail = section.createDiv({
      cls: 'superpower-inside-rag-graph-cost-detail is-collapsed',
    });
    costToggle.addEventListener('click', () => {
      const isCollapsed = costDetail.hasClass('is-collapsed');
      costDetail.toggleClass('is-collapsed', !isCollapsed);
      costToggle.setText(isCollapsed ? t('settingsAuto046') : t('settingsAuto045'));
    });
    this.createRagStatusItem(costDetail, t('settingsAuto047'), String(cost.estimatedFiles));
    this.createRagStatusItem(costDetail, t('settingsAuto048'), String(cost.estimatedCalls));
    this.createRagStatusItem(costDetail, t('settingsAuto049'), String(cost.estimatedInputTokens));
    this.createRagStatusItem(
      costDetail,
      'Pending merge',
      String(graphState?.pendingMergeCount ?? 0),
    );
    section.appendChild(costToggle);
    section.appendChild(costDetail);
    // 기본 설정
    new Setting(section)
      .setName(t('settingsAuto050'))
      .setDesc(t('settingsAuto051'))
      .addToggle((toggle) =>
        toggle.setValue(rag.graphRagEnabled).onChange((value) => {
          this.plugin.settings.rag.graphRagEnabled = value;
          this.display();
          this.debouncedRagSave();
        }),
      );
    const renderGraphRagModelOptions = (selectEl: HTMLSelectElement): void => {
      const modelOptions = buildChatModelOptions(this.plugin.settings, {
        currentModel: this.plugin.settings.rag.graphRagModel,
        includeEmpty: true,
        emptyLabel: t('settingsAuto008'),
      });
      selectEl.empty();
      for (const option of modelOptions) {
        const opt = selectEl.createEl('option');
        opt.value = option.value;
        opt.text = option.label;
      }
      const selectedModel = this.plugin.settings.rag.graphRagModel.trim();
      selectEl.value = modelOptions.some((option) => option.value === selectedModel)
        ? selectedModel
        : '';
    };
    new Setting(section)
      .setName(t('settingsAuto052'))
      .setDesc(t('settingsAuto053'))
      .addDropdown((dropdown) => {
        this.graphRagModelSelectEl = dropdown.selectEl;
        renderGraphRagModelOptions(dropdown.selectEl);
        dropdown.onChange((value) => {
          this.plugin.settings.rag.graphRagModel = value.trim();
          this.debouncedRagSave();
        });
      });
    new Setting(section)
      .setName(t('settingsAuto054'))
      .setDesc(t('settingsAuto055'))
      .addText((text) => {
        text
          .setValue(String(rag.graphRagMaxFilesPerRun))
          .setPlaceholder('50')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 10000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.graphRagMaxFilesPerRun = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '10000';
      });
    new Setting(section)
      .setName('GraphRAG query mode')
      .setDesc(t('settingsAuto056'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', 'Auto')
          .addOption('local', 'Local')
          .addOption('global', 'Global')
          .addOption('hybrid', 'Hybrid')
          .setValue(rag.graphRagQueryMode)
          .onChange((value) => {
            this.plugin.settings.rag.graphRagQueryMode =
              value === 'local' || value === 'global' || value === 'hybrid' ? value : 'auto';
            this.debouncedRagSave();
          }),
      );
    new Setting(section)
      .setName('Merge threshold')
      .setDesc(t('settingsAuto057'))
      .addText((text) => {
        text.setValue(String(rag.ontologyAutoMergeThreshold)).onChange((value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 0 || num > 1) return;
          this.plugin.settings.rag.ontologyAutoMergeThreshold = num;
          this.debouncedRagSave();
        });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.01';
      })
      .addText((text) => {
        text.setValue(String(rag.ontologyPendingMergeThreshold)).onChange((value) => {
          const num = Number(value);
          if (Number.isNaN(num) || num < 0 || num > 1) return;
          this.plugin.settings.rag.ontologyPendingMergeThreshold = num;
          this.debouncedRagSave();
        });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.01';
      });
    // 자동 동기화 설정
    new Setting(section)
      .setName(t('settingsAuto058'))
      .setDesc(t('settingsAuto059'))
      .addToggle((toggle) =>
        toggle.setValue(rag.graphRagAutoSyncEnabled).onChange((value) => {
          this.plugin.settings.rag.graphRagAutoSyncEnabled = value;
          this.debouncedSave();
        }),
      );
    new Setting(section)
      .setName(t('settingsAuto060'))
      .setDesc(t('settingsAuto061'))
      .addText((text) => {
        text
          .setValue(String(rag.graphRagAutoSyncIntervalMin))
          .setPlaceholder('30')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 1440 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.graphRagAutoSyncIntervalMin = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '1440';
      });
    // 실행 버튼 그룹
    const actions = section.createDiv({ cls: 'superpower-inside-rag-action-groups' });
    this.graphRagActionsGroup = actions;
    const syncButtonState = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles: graphState?.staleFileCount ?? 0,
      failedFileCount: 0,
    }).start;
    const communityButtonState = {
      disabled:
        !rag.graphRagEnabled ||
        !this.plugin.hasGraphRagRunner() ||
        !rag.graphRagModel.trim() ||
        this.plugin.isGraphRagIndexing(),
      reason: !rag.graphRagEnabled
        ? t('settingsAuto062')
        : !rag.graphRagModel.trim()
          ? t('settingsAuto064')
          : !this.plugin.hasGraphRagRunner()
            ? t('settingsAuto063')
            : this.plugin.isGraphRagIndexing()
              ? t('settingsAuto065')
              : null,
    };
    const hasData = done > 0;
    const detailButtonState = { disabled: !hasData, reason: hasData ? null : t('settingsAuto066') };
    const resetGraphRagState = {
      disabled: !rag.graphRagEnabled || this.plugin.isGraphRagIndexing(),
      reason: !rag.graphRagEnabled
        ? t('settingsAuto062')
        : this.plugin.isGraphRagIndexing()
          ? t('settingsAuto065')
          : null,
    };
    this.renderGraphRagActions(actions, {
      controls,
      syncButtonState,
      communityButtonState,
      detailButtonState,
      resetGraphRag: resetGraphRagState,
      cost,
      totalCandidateFiles: total,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      failedFileCount: failed,
      staleFileCount: stale,
    });
  }

  private renderGraphRagProgressBanner(): void {
    if (!this.graphRagProgressBanner) return;
    const runner = (
      this.plugin as unknown as {
        graphRagIndexingRunner?: {
          getProgress(): {
            processedFiles: number;
            skippedFiles: number;
            failedFiles: number;
            selectedFiles: number;
            currentFile: string | null;
            phase?: import('./graph/indexing-progress').GraphRagIndexingPhase;
          };
        } | null;
      }
    ).graphRagIndexingRunner;
    const progress = runner?.getProgress();
    const presentation = getGraphRagLiveStatusPresentation({
      isRunning: this.plugin.isGraphRagIndexing() && progress !== undefined,
      phase: progress?.phase ?? null,
      currentFile: progress?.currentFile ?? null,
      processedFiles: progress?.processedFiles ?? 0,
      skippedFiles: progress?.skippedFiles ?? 0,
      failedFiles: progress?.failedFiles ?? 0,
      selectedFiles: progress?.selectedFiles ?? 0,
    });
    const titleEl = this.graphRagProgressBanner.querySelector(
      '#superpower-inside-graph-progress-title',
    );
    const phaseEl = this.graphRagProgressBanner.querySelector(
      '#superpower-inside-graph-progress-phase',
    );
    const detailEl = this.graphRagProgressBanner.querySelector(
      '#superpower-inside-graph-progress-text',
    );
    titleEl?.setText(presentation.title);
    phaseEl?.setText(presentation.phaseLabel);
    detailEl?.setText(presentation.detail);
    setHidden(this.graphRagProgressBanner, !presentation.active);
  }

  /** GraphRAG 대시보드를 부분 업데이트합니다. */
  updateGraphRagStats(): void {
    if (!this.graphRagSectionContainer) return;
    this.renderGraphRagProgressBanner();
    const graphState = this.plugin.graphRagStatus;
    const rag = this.plugin.settings.rag;
    const statusLabel =
      graphState?.state ??
      getGraphRagStatusLabel({
        enabled: rag.graphRagEnabled,
        hasGraphIndex: false,
        isRunning: this.plugin.isGraphRagIndexing(),
        isStale: false,
        partialFailureCount: 0,
      });
    const presentation = getGraphRagStatusPresentation(statusLabel);
    const cost = estimateGraphRagIndexingCost({
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? this.plugin.eventDrivenRagStats?.totalDocuments ?? 0,
      maxFilesPerRun: rag.graphRagMaxFilesPerRun,
      averageChunksPerFile: 3,
      averageTokensPerChunk: 900,
      providerKind: rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')
        ? 'local'
        : 'remote',
    });
    const controls = getGraphRagControlState({
      enabled: rag.graphRagEnabled,
      hasProvider: this.plugin.hasGraphRagRunner(),
      hasModel: rag.graphRagModel.trim().length > 0,
      isRunning: this.plugin.isGraphRagIndexing(),
      totalCandidateFiles:
        graphState?.totalCandidateFiles ?? this.plugin.eventDrivenRagStats?.totalDocuments ?? 0,
      failedFileCount: graphState?.failedFileCount ?? 0,
    });
    const total = graphState?.totalCandidateFiles ?? 0;
    const done = graphState?.graphEvidenceCount ?? 0;
    const failed = graphState?.failedFileCount ?? 0;
    const stale = graphState?.staleFileCount ?? 0;
    if (this.graphRagSummaryBanner) {
      const summaryText =
        total > 0
          ? t('settingsAuto030', {
              v0: String(total),
              v1: String(done),
              v2: String(failed > 0 ? t('settingsAuto031', { v0: String(failed) }) : ''),
              v3: String(stale > 0 ? t('settingsAuto032', { v0: String(stale) }) : ''),
            })
          : t('settingsAuto033');
      this.graphRagSummaryBanner.setText(summaryText);
    }
    if (this.graphRagStatusGrid) {
      this.graphRagStatusGrid.empty();
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto034'),
        presentation.label,
        presentation.description,
        presentation.tone,
      );
      this.createRagStatusItem(this.graphRagStatusGrid, t('settingsAuto035'), String(total));
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto036'),
        String(done),
        t('settingsAuto036Desc'),
        'success',
      );
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto037'),
        String(failed),
        failed > 0 ? t('settingsAuto038') : t('settingsAuto039'),
      );
      this.createRagStatusItemWithDesc(
        this.graphRagStatusGrid,
        t('settingsAuto040'),
        String(stale),
        stale > 0 ? t('settingsAuto041') : t('settingsAuto042'),
        stale > 0 ? 'warning' : 'success',
      );
      this.createRagStatusItem(this.graphRagStatusGrid, t('settingsAuto043'), cost.costLabel);
      const runnerInfo = (
        this.plugin as unknown as {
          graphRagIndexingRunner?: {
            getLastCommunityResult(): {
              communityCount: number;
              modularity: number;
            } | null;
          } | null;
        }
      ).graphRagIndexingRunner;
      const lastCommunity = runnerInfo?.getLastCommunityResult();
      if (lastCommunity) {
        this.createRagStatusItemWithDesc(
          this.graphRagStatusGrid,
          t('settingsAuto044'),
          String(lastCommunity.communityCount),
          `modularity ${lastCommunity.modularity.toFixed(3)}`,
        );
      }
    }
    if (this.graphRagActionsGroup) {
      const syncButtonState = getGraphRagControlState({
        enabled: rag.graphRagEnabled,
        hasProvider: this.plugin.hasGraphRagRunner(),
        hasModel: rag.graphRagModel.trim().length > 0,
        isRunning: this.plugin.isGraphRagIndexing(),
        totalCandidateFiles: stale,
        failedFileCount: 0,
      }).start;
      const communityButtonState = {
        disabled:
          !rag.graphRagEnabled ||
          !this.plugin.hasGraphRagRunner() ||
          !rag.graphRagModel.trim() ||
          this.plugin.isGraphRagIndexing(),
        reason: !rag.graphRagEnabled
          ? t('settingsAuto062')
          : !rag.graphRagModel.trim()
            ? t('settingsAuto064')
            : !this.plugin.hasGraphRagRunner()
              ? t('settingsAuto063')
              : this.plugin.isGraphRagIndexing()
                ? t('settingsAuto065')
                : null,
      };
      const hasDetailData = done > 0;
      const detailState = {
        disabled: !hasDetailData,
        reason: hasDetailData ? null : t('settingsAuto066'),
      };
      const resetGraphRagState = {
        disabled: !rag.graphRagEnabled || this.plugin.isGraphRagIndexing(),
        reason: !rag.graphRagEnabled
          ? t('settingsAuto062')
          : this.plugin.isGraphRagIndexing()
            ? t('settingsAuto065')
            : null,
      };
      this.renderGraphRagActions(this.graphRagActionsGroup, {
        controls,
        syncButtonState,
        communityButtonState,
        detailButtonState: detailState,
        resetGraphRag: resetGraphRagState,
        cost,
        totalCandidateFiles: total,
        maxFilesPerRun: rag.graphRagMaxFilesPerRun,
        failedFileCount: failed,
        staleFileCount: stale,
      });
    }
  }
  private renderGraphRagActions(
    containerEl: HTMLElement,
    input: {
      controls: ReturnType<typeof getGraphRagControlState>;
      syncButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      resetGraphRag: {
        disabled: boolean;
        reason: string | null;
      };
      communityButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      detailButtonState: {
        disabled: boolean;
        reason: string | null;
      };
      cost: {
        costLabel: string;
      };
      totalCandidateFiles: number;
      maxFilesPerRun: number;
      failedFileCount: number;
      staleFileCount: number;
    },
  ): void {
    containerEl.empty();
    const groups = buildGraphRagActionGroups({
      controls: input.controls,
      syncStale: input.syncButtonState,
      buildCommunities: input.communityButtonState,
      resetGraphRag: input.resetGraphRag,
      openExplorer: input.detailButtonState,
      totalCandidateFiles: input.totalCandidateFiles,
      maxFilesPerRun: input.maxFilesPerRun,
      failedFileCount: input.failedFileCount,
      staleFileCount: input.staleFileCount,
    });
    for (const group of groups) {
      const groupEl = containerEl.createDiv({ cls: 'superpower-inside-rag-action-group' });
      groupEl.createDiv({ cls: 'superpower-inside-rag-action-group-title', text: group.label });
      const listEl = groupEl.createDiv({ cls: 'superpower-inside-rag-action-list' });
      for (const action of group.actions) {
        this.createGraphRagActionCard(listEl, action, input.cost);
      }
    }
  }
  private createGraphRagActionCard(
    containerEl: HTMLElement,
    action: GraphRagActionDefinition,
    cost: {
      costLabel: string;
    },
  ): void {
    const item = containerEl.createDiv({
      cls: `superpower-inside-rag-action-card is-${action.tone}`,
    });
    const button = item.createEl('button', { attr: { type: 'button' } });
    setIcon(button, action.iconName);
    button.createSpan({ text: action.label });
    button.disabled = action.state.disabled;
    button.title = action.state.reason ?? action.description;
    button.addEventListener('click', () => {
      void this.handleGraphRagAction(action, cost);
    });
    item.createDiv({ cls: 'superpower-inside-rag-action-desc', text: action.description });
    if (action.state.reason) {
      item.createDiv({
        cls: 'superpower-inside-rag-action-disabled-reason',
        text: action.state.reason,
      });
    }
  }
  private async handleGraphRagAction(
    action: GraphRagActionDefinition,
    cost: {
      costLabel: string;
    },
  ): Promise<void> {
    switch (action.id) {
      case 'start': {
        if (!this.confirmGraphRagRemoteRun(cost)) return;
        const result = await this.plugin.runGraphRagIndexing();
        this.showGraphRagResult(result);
        this.updateGraphRagStats();
        return;
      }
      case 'cancel':
        this.plugin.cancelGraphRagIndexing();
        new Notice(t('settingsAuto068'));
        this.updateGraphRagStats();
        return;
      case 'resumeFailed': {
        if (!this.confirmGraphRagRemoteRun(cost)) return;
        const result = await this.plugin.resumeGraphRagIndexing();
        this.showGraphRagResult(result);
        this.updateGraphRagStats();
        return;
      }
      case 'syncStale': {
        if (!this.confirmGraphRagRemoteRun(cost)) return;
        const result = await this.plugin.syncStaleGraphRag();
        this.showGraphRagResult(result);
        this.updateGraphRagStats();
        return;
      }
      case 'buildCommunities': {
        if (!this.confirmGraphRagRemoteRun(cost)) return;
        const result = await this.plugin.buildGraphRagCommunities();
        if (result) {
          new Notice(
            t('settingsAuto069', {
              v0: String(result.communityCount),
              v1: String(result.modularity.toFixed(3)),
              v2: String((result.durationMs / 1000).toFixed(1)),
            }),
          );
        }
        this.updateGraphRagStats();
        return;
      }
      case 'openExplorer':
        this.plugin.openGraphRagView();
        return;
      case 'resetGraphRag': {
        if (!this.confirmGraphRagReset()) {
          return;
        }
        try {
          await this.plugin.resetGraphRagData();
          new Notice(t('graphRagResetDataDone'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(t('graphRagResetDataFailed', { v0: message }));
        }
        this.updateGraphRagStats();
        return;
      }
    }
  }
  private confirmGraphRagRemoteRun(cost: { costLabel: string }): boolean {
    if (cost.costLabel !== t('settingsAuto070')) return true;
    return confirm(t('settingsAuto071'));
  }

  private confirmGraphRagReset(): boolean {
    return confirm(t('graphRagResetDataConfirm'));
  }
  private showGraphRagResult(result: GraphRagIndexingResult | null): void {
    if (!result) {
      new Notice(t('settingsAuto072'));
      return;
    }
    if (result.cancelled) {
      new Notice(t('settingsAuto073'));
      return;
    }
    new Notice(
      t('settingsAuto074', {
        v0: String(result.processedFiles),
        v1: String(result.skippedFiles),
        v2: String(result.failedFiles),
      }),
    );
  }
  /** RefreshBus 'rag' 이벤트 수신 시 인덱스 통계 그리드를 갱신합니다. */
  private refreshStatsGrid(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const grid = ragTab.querySelector<HTMLElement>('.superpower-inside-stats-grid');
    if (!grid) return;
    void this.renderStats(grid);
  }
  /** RefreshBus 'rag' 이벤트 수신 시 파일 형식 요약을 갱신합니다. */
  private refreshFileTypeSummary(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const contentEl = ragTab.querySelector<HTMLElement>('.superpower-inside-rag-file-types');
    if (!contentEl) return;
    void (async () => {
      contentEl.empty();
      contentEl.setText(t('settingsAuto075'));
      try {
        const summary = await getRagFileTypeSummary(
          this.app.vault,
          this.plugin.settings.rag,
          this.plugin.settings.chat,
        );
        contentEl.empty();
        this.renderTargetFileTypeCounts(contentEl, summary.targetTypes);
        this.renderExcludeRecommendations(contentEl, summary.excludeRecommendations);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        contentEl.setText(t('settingsAuto076', { v0: String(msg) }));
      }
    })();
  }
  /** RefreshBus 'mcp' 이벤트 수신 시 MCP 상태 섹션을 갱신합니다. */
  private refreshMcpStatusSection(): void {
    const mcpTab = this.tabPanels.get('mcp');
    if (!mcpTab) return;
    const statusSection = mcpTab.querySelector<HTMLElement>('.superpower-inside-mcp-status');
    if (!statusSection) return;
    this.renderMCPStatus(statusSection);
  }
  private getIndexingStatusLabel(): string {
    const plugin = this.plugin as unknown as {
      ragIndexingStatus?: {
        running: boolean;
        phase: string;
        queuedFiles: number;
        lastResult?: {
          indexed: number;
          vectors: number;
        } | null;
      };
    };
    const status = plugin.ragIndexingStatus;
    if (!status) return this.plugin.isRagIndexing() ? t('settingsAuto077') : t('settingsAuto078');
    if (status.running) {
      return t('settingsAuto079', { v0: String(status.phase), v1: String(status.queuedFiles) });
    }
    if (status.lastResult) {
      return t('settingsAuto080', {
        v0: String(status.lastResult.indexed),
        v1: String(status.lastResult.vectors),
      });
    }
    return t('settingsAuto078');
  }
  private buildEmbeddingProviderSection(containerEl: HTMLElement): void {
    const ANCHOR_CLS = 'si-embedding-anchor';
    const WARNING_CLS = 'si-embedding-warning';
    const MODEL_DESC_CLS = 'si-embedding-model-desc';
    // Phase 1: anchor-based position preservation — stay between Controls and Exclude
    const existingAnchor = containerEl.querySelector(`:scope > .${ANCHOR_CLS}`);
    let section: HTMLElement;
    if (existingAnchor) {
      section = createDiv({ cls: 'superpower-inside-rag-section' });
      const oldSection = existingAnchor.previousElementSibling;
      if (oldSection?.classList.contains('superpower-inside-rag-section')) {
        oldSection.remove();
      }
      existingAnchor.replaceWith(section);
    } else {
      section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    }
    // Place new anchor after section for future rebuilds
    const newAnchor = createDiv({ cls: ANCHOR_CLS });
    section.after(newAnchor);
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto081') });
    const rag = this.plugin.settings.rag;
    const effectiveProvider = this.pendingEmbeddingProvider ?? rag.embeddingProvider;
    const effectiveModel = this.pendingEmbeddingModel ?? rag.embeddingModel;
    const builtInProvider = isCustomOpenAIEmbeddingProviderKey(effectiveProvider)
      ? null
      : effectiveProvider;
    const embeddingModels = buildEmbeddingModels();
    const modelsForProvider = builtInProvider ? embeddingModels[builtInProvider] : [];
    const isOther = effectiveProvider === 'other';
    const providerModels = isOther ? [] : this.getEmbeddingProviderModels(effectiveProvider);
    const modelOptions = isOther
      ? []
      : buildEmbeddingModelOptions(modelsForProvider, providerModels, effectiveModel);
    const isPending = this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null;
    const providerNotice = section.createDiv({ cls: 'superpower-inside-model-description' });
    providerNotice.setText(t('settingsAuto082'));
    if (isPending) {
      const warningEl = section.createDiv({
        cls: `${WARNING_CLS} superpower-inside-settings-warning superpower-inside-embedding-pending-warning`,
      });
      warningEl.setText(t('settingsAuto083'));
    }
    new Setting(section)
      .setName(t('embeddingProvider'))
      .setDesc(t('settingsAuto084'))
      .addDropdown((dropdown) => {
        for (const option of buildEmbeddingProviderOptions(
          this.plugin.settings.customOpenAIProviders,
        )) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(effectiveProvider);
        dropdown.onChange((value) => {
          if (this.isRebuildingEmbeddingSection) return;
          const nextProvider = value as EmbeddingProviderKey;
          this.pendingEmbeddingProvider = nextProvider;
          if (nextProvider === 'other') {
            this.pendingEmbeddingModel = '';
          } else {
            const nextBuiltInProvider = isCustomOpenAIEmbeddingProviderKey(nextProvider)
              ? null
              : nextProvider;
            const nextModels = buildEmbeddingModelOptions(
              nextBuiltInProvider ? embeddingModels[nextBuiltInProvider] : [],
              this.getEmbeddingProviderModels(nextProvider),
              '',
            );
            this.pendingEmbeddingModel = nextModels[0]?.id ?? '';
          }
          this.isRebuildingEmbeddingSection = true;
          try {
            this.buildEmbeddingProviderSection(containerEl);
          } finally {
            this.isRebuildingEmbeddingSection = false;
          }
        });
      });
    if (isOther) {
      new Setting(section)
        .setName(t('embeddingModelId'))
        .setDesc(t('settingsAuto085'))
        .addText((text) =>
          text
            .setValue(effectiveModel)
            .setPlaceholder(t('settingsAuto086'))
            .onChange((value) => {
              if (this.isRebuildingEmbeddingSection) return;
              this.pendingEmbeddingModel = value.trim();
            }),
        );
    } else if (modelOptions.length > 0) {
      new Setting(section)
        .setName(t('embeddingModel'))
        .setDesc(t('settingsAuto087'))
        .addDropdown((dropdown) => {
          for (const model of modelOptions) {
            dropdown.addOption(model.id, model.label);
          }
          dropdown.setValue(effectiveModel);
          dropdown.onChange((value) => {
            if (this.isRebuildingEmbeddingSection) return;
            this.pendingEmbeddingModel = value;
            // Partial update: model description only
            const descEl = section.querySelector(`.${MODEL_DESC_CLS}`);
            const selectedModel = modelOptions.find((m) => m.id === value);
            if (descEl) {
              descEl.setText(selectedModel?.description ?? '');
            }
            // Show pending UI if not already visible
            if (!section.querySelector(`.${WARNING_CLS}`)) {
              this.isRebuildingEmbeddingSection = true;
              try {
                this.buildEmbeddingProviderSection(containerEl);
              } finally {
                this.isRebuildingEmbeddingSection = false;
              }
            }
          });
        });
      const selectedModel = modelOptions.find((m) => m.id === effectiveModel);
      const descEl = section.createDiv({
        cls: `superpower-inside-model-description ${MODEL_DESC_CLS}`,
      });
      descEl.setText(selectedModel?.description ?? '');
    }
    if (isPending) {
      const btnRow = section.createDiv({
        cls: 'superpower-inside-rag-controls superpower-inside-embedding-pending-actions',
      });
      const saveBtn = btnRow.createEl('button', { text: t('settingsAuto088') });
      saveBtn.addEventListener('click', () => {
        void (async () => {
          if (this.isRebuildingEmbeddingSection) return;
          saveBtn.disabled = true;
          saveBtn.setText(t('settingsAuto089'));
          try {
            if (this.pendingEmbeddingProvider !== null) {
              rag.embeddingProvider = this.pendingEmbeddingProvider;
            }
            if (this.pendingEmbeddingModel !== null) {
              rag.embeddingModel = this.pendingEmbeddingModel;
            }
            this.pendingEmbeddingProvider = null;
            this.pendingEmbeddingModel = null;
            await this.plugin.saveSettings({ reinitRag: true, reinitMcp: false });
            new Notice(t('settingsAuto090'));
          } catch (err) {
            new Notice(
              t('settingsAuto091', {
                v0: String(err instanceof Error ? err.message : String(err)),
              }),
              6000,
            );
          } finally {
            saveBtn.disabled = false;
            saveBtn.setText(t('settingsAuto088'));
            this.isRebuildingEmbeddingSection = true;
            try {
              this.buildEmbeddingProviderSection(containerEl);
            } finally {
              this.isRebuildingEmbeddingSection = false;
            }
          }
        })();
      });
      const cancelBtn = btnRow.createEl('button', { text: t('settingsAuto092') });
      cancelBtn.addEventListener('click', () => {
        if (this.isRebuildingEmbeddingSection) return;
        this.pendingEmbeddingProvider = null;
        this.pendingEmbeddingModel = null;
        this.isRebuildingEmbeddingSection = true;
        try {
          this.buildEmbeddingProviderSection(containerEl);
          new Notice(t('settingsAuto093'));
        } finally {
          this.isRebuildingEmbeddingSection = false;
        }
      });
    }
    const statusEl = section.createDiv({ cls: 'superpower-inside-connection-status' });
    const getEmbeddingValidationConfig = (): ProviderConfig | CustomOpenAIProviderConfig =>
      effectiveProvider === 'other'
        ? { apiKey: '', models: [], enabled: false }
        : (this.getEmbeddingProviderConfig(effectiveProvider) ?? {
            apiKey: '',
            models: [],
            enabled: false,
          });
    new Setting(section)
      .setName(t('settingsAuto094'))
      .setDesc(t('settingsAuto095'))
      .addButton((button) => {
        button.setButtonText(t('testConnection'));
        button.onClick(async () => {
          statusEl.setText('');
          button.setDisabled(true);
          statusEl.setText(t('testing'));
          try {
            const { validateEmbeddingConnection } = await import('./llm/validation');
            const result = await validateEmbeddingConnection(
              effectiveProvider,
              effectiveModel,
              getEmbeddingValidationConfig(),
            );
            if (result.valid) {
              statusEl.setText(t('settingsAuto096', { v0: String(result.models.length) }));
            } else {
              statusEl.setText(t('settingsAuto097', { v0: String(result.error) }));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            statusEl.setText(t('settingsAuto098', { v0: String(msg) }));
          } finally {
            button.setDisabled(false);
          }
        });
      });
    new Setting(section)
      .setName(t('settingsAuto099'))
      .setDesc(t('settingsAuto100'))
      .addButton((button) => {
        button.setButtonText(t('settingsAuto099'));
        button.onClick(async () => {
          statusEl.setText('');
          button.setDisabled(true);
          statusEl.setText(t('testing'));
          try {
            const { testEmbeddingGeneration } = await import('./llm/validation');
            const result = await testEmbeddingGeneration(
              effectiveProvider,
              effectiveModel,
              getEmbeddingValidationConfig(),
            );
            if (result.valid) {
              statusEl.setText(t('settingsAuto101', { v0: String(effectiveModel) }));
            } else {
              statusEl.setText(t('settingsAuto102', { v0: String(result.error) }));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            statusEl.setText(t('settingsAuto098', { v0: String(msg) }));
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }
  private buildStatsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto103') });
    const grid = section.createDiv({ cls: 'superpower-inside-stats-grid' });
    // 통계 비동기 로드
    this.renderStats(grid).catch(() => {
      grid.setText(t('settingsAuto104'));
    });
  }
  private async renderStats(gridEl: HTMLElement): Promise<void> {
    const status = await this.getRagStatus();
    gridEl.empty();
    if (!status) {
      gridEl.setText(t('settingsAuto105'));
      return;
    }
    const stats = [
      {
        value: String(status.totalDocuments),
        label: t('settingsAuto106'),
        desc: t('settingsAuto107'),
      },
      {
        value: String(status.healthyDocuments),
        label: t('settingsAuto108'),
        desc: t('settingsAuto109'),
      },
      {
        value: String(status.updateRequiredDocuments.length),
        label: t('settingsAuto110'),
        desc: t('settingsAuto111'),
      },
      {
        value: String(status.totalVectors),
        label: t('settingsAuto112'),
        desc: t('settingsAuto113'),
      },
    ];
    for (const stat of stats) {
      const card = gridEl.createDiv({ cls: 'superpower-inside-stat-card' });
      card.createDiv({ cls: 'superpower-inside-stat-value', text: stat.value });
      card.createDiv({ cls: 'superpower-inside-stat-label', text: stat.label });
      card.createDiv({ cls: 'superpower-inside-stat-desc', text: stat.desc });
    }
  }
  private buildTargetFileTypesSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    const header = section.createDiv({ cls: 'superpower-inside-rag-file-types-header' });
    const titleGroup = header.createDiv();
    titleGroup.createDiv({
      cls: 'superpower-inside-rag-section-title',
      text: t('targetFileTypes'),
    });
    titleGroup.createDiv({
      cls: 'superpower-inside-rag-file-types-desc',
      text: t('targetFileTypesDesc'),
    });
    const contentEl = section.createDiv({ cls: 'superpower-inside-rag-file-types' });
    void (async () => {
      contentEl.setText(t('settingsAuto075'));
      try {
        const summary = await getRagFileTypeSummary(
          this.app.vault,
          this.plugin.settings.rag,
          this.plugin.settings.chat,
        );
        contentEl.empty();
        this.renderTargetFileTypeCounts(contentEl, summary.targetTypes);
        this.renderExcludeRecommendations(contentEl, summary.excludeRecommendations);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        contentEl.setText(t('settingsAuto076', { v0: String(msg) }));
      }
    })();
  }
  private renderTargetFileTypeCounts(
    containerEl: HTMLElement,
    targetTypes: {
      extension: string;
      label: string;
      count: number;
    }[],
  ): void {
    if (targetTypes.length === 0) {
      containerEl.createDiv({
        cls: 'superpower-inside-rag-empty-state',
        text: t('targetFileTypesEmpty'),
      });
      return;
    }
    const grid = containerEl.createDiv({ cls: 'superpower-inside-rag-file-type-grid' });
    for (const item of targetTypes) {
      const card = grid.createDiv({ cls: 'superpower-inside-rag-file-type-card' });
      card.createDiv({ cls: 'superpower-inside-rag-file-type-label', text: item.label });
      card.createDiv({
        cls: 'superpower-inside-rag-file-type-count',
        text: t('settingsAuto022', { v0: String(item.count) }),
      });
    }
  }
  private renderExcludeRecommendations(
    containerEl: HTMLElement,
    recommendations: {
      extension: string;
      label: string;
      count: number;
      reason: string;
    }[],
  ): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-recommendations' });
    section.createDiv({
      cls: 'superpower-inside-rag-recommendations-title',
      text: t('excludeRecommendations'),
    });
    if (recommendations.length === 0) {
      section.createDiv({
        cls: 'superpower-inside-rag-empty-state',
        text: t('excludeRecommendationEmpty'),
      });
      return;
    }
    for (const item of recommendations) {
      const row = section.createDiv({ cls: 'superpower-inside-rag-recommendation-row' });
      const body = row.createDiv({ cls: 'superpower-inside-rag-recommendation-body' });
      body.createDiv({
        cls: 'superpower-inside-rag-recommendation-label',
        text: t('settingsAuto114', { v0: String(item.label), v1: String(item.count) }),
      });
      body.createDiv({ cls: 'superpower-inside-rag-recommendation-reason', text: item.reason });
      if (item.extension === '(none)' || !isRecommendableExcludeExtension(item.extension)) continue;
      const button = row.createEl('button', {
        cls: 'superpower-inside-rag-recommendation-add',
        text: t('addExcludeExtension'),
        attr: { type: 'button' },
      });
      button.addEventListener('click', () => {
        const normalized = item.extension.trim().toLowerCase();
        if (!this.plugin.settings.rag.excludeExts.includes(normalized)) {
          this.plugin.settings.rag.excludeExts.push(normalized);
          this.debouncedRagSave();
        }
        new Notice(`${item.label} ${t('addExcludeExtensionDone')}`);
        this.updateRagStats();
      });
    }
  }
  /**
   * RefreshBus에서 rag 이벤트 수신 시 RAG 상태 패널 일부만 업데이트합니다.
   * (전체 rebuild 대신 statusGrid, timestamp, updateList 등만 갱신)
   */
  updateRagStats(indexingDetail?: string): void {
    if (!this.ragStatusGrid || !this.ragStatusTimestamp) return;
    void (async () => {
      this.ragStatusTimestamp!.setText(
        indexingDetail
          ? t('settingsAuto115', { v0: String(indexingDetail) })
          : t('settingsAuto028'),
      );
      try {
        const status = await this.getRagStatus();
        if (status) {
          this.renderRagStatusSummary(status, indexingDetail);
          this.ragStatusTimestamp!.setText(
            indexingDetail
              ? t('settingsAuto116', {
                  v0: String(indexingDetail),
                  v1: String(new Date(status.lastCalculatedAt).toLocaleString()),
                })
              : t('settingsAuto117', {
                  v0: String(new Date(status.lastCalculatedAt).toLocaleString()),
                }),
          );
        }
        this.updateRagControlStates(status ?? null);
        // RAG 통계 섹션도 부분 업데이트
        this.updateRagStatsSection();
        this.updateRagUpdateList();
      } catch {
        this.ragStatusTimestamp!.setText(t('settingsAuto104'));
      }
    })();
  }
  private renderRagStatusSummary(status: RagStatusSummary, indexingDetail?: string): void {
    if (!this.ragStatusGrid || !this.ragStatusAction || !this.ragStatusDetails) return;
    const rag = this.plugin.settings.rag;
    const guardState = this.plugin.getRagPerformanceGuardState();
    const updateCount = status.updateRequiredDocuments.length;
    this.ragStatusGrid.empty();
    this.createRagStatusItem(
      this.ragStatusGrid,
      t('settingsAuto118'),
      indexingDetail ?? this.getIndexingStatusLabel(),
    );
    this.createRagStatusItem(
      this.ragStatusGrid,
      t('settingsAuto119'),
      this.getRagNextActionLabel(status, guardState),
    );
    this.createRagStatusItem(
      this.ragStatusGrid,
      t('settingsAuto110'),
      t('settingsAuto022', { v0: String(updateCount) }),
    );
    this.createRagStatusItem(this.ragStatusGrid, t('settingsAuto120'), this.getAutoUpdateLabel());
    this.ragStatusAction.empty();
    this.ragStatusAction.setText(this.getRagActionMessage(status, guardState));
    this.ragStatusDetails.empty();
    const detailItems = [
      t('settingsAuto121', {
        v0: String(this.getEmbeddingProviderLabel(rag.embeddingProvider)),
        v1: String(rag.embeddingModel || t('settingsAuto122')),
      }),
      t('settingsAuto123', { v0: 'IndexedDB' }),
      t('settingsAuto124', { v0: String(this.getPerformanceGuardLabel(guardState)) }),
    ];
    const autoUpdateDetail = this.getAutoUpdateDetail();
    if (autoUpdateDetail) detailItems.push(autoUpdateDetail);
    for (const item of detailItems) {
      this.ragStatusDetails.createDiv({ cls: 'superpower-inside-rag-status-detail', text: item });
    }
  }
  private getRagNextActionLabel(
    status: RagStatusSummary,
    guardState: PerformanceGuardState | null,
  ): string {
    if (this.plugin.isRagIndexing()) return t('settingsAuto125');
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      return t('settingsAuto126', {
        v0: String(Math.ceil((guardState.remainingPauseMs ?? 0) / 1000)),
      });
    }
    if (status.updateRequiredDocuments.length > 0) return t('settingsAuto127');
    if (status.totalDocuments > 0) return t('settingsAuto128');
    return t('settingsAuto129');
  }
  private getRagActionMessage(
    status: RagStatusSummary,
    guardState: PerformanceGuardState | null,
  ): string {
    if (this.plugin.isRagIndexing()) {
      return t('settingsAuto130');
    }
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      return t('settingsAuto131', {
        v0: String(guardState.lastSlowReason ?? guardState.reason ?? t('settingsAuto132')),
      });
    }
    const updateCount = status.updateRequiredDocuments.length;
    if (updateCount > 0) return t('settingsAuto133', { v0: String(updateCount) });
    if (status.totalDocuments > 0) return t('settingsAuto134');
    return t('settingsAuto135');
  }
  private getAutoUpdateLabel(): string {
    if (!this.plugin.settings.rag.autoUpdateEnabled) return t('settingsAuto136');
    if (this.plugin.lastAutoUpdateSkippedReason)
      return t('settingsAuto137', { v0: String(this.plugin.lastAutoUpdateSkippedReason) });
    return t('settingsAuto138');
  }
  private getAutoUpdateDetail(): string | null {
    if (!this.plugin.settings.rag.autoUpdateEnabled) return null;
    const details: string[] = [];
    if (this.plugin.nextAutoUpdateAt) {
      details.push(
        t('settingsAuto139', {
          v0: String(new Date(this.plugin.nextAutoUpdateAt).toLocaleString()),
        }),
      );
    }
    if (this.plugin.lastAutoUpdateResult) {
      details.push(
        t('settingsAuto140', {
          v0: String(this.plugin.lastAutoUpdateResult.indexed),
          v1: String(this.plugin.lastAutoUpdateResult.vectors),
        }),
      );
    }
    if (this.plugin.lastAutoUpdateSkippedReason) {
      details.push(t('settingsAuto141', { v0: String(this.plugin.lastAutoUpdateSkippedReason) }));
    }
    return details.length > 0 ? details.join(' · ') : null;
  }
  private getPerformanceGuardLabel(guardState: PerformanceGuardState | null): string {
    if (!guardState) return t('settingsAuto142');
    if (guardState.mode === 'paused') {
      return t('settingsAuto143', {
        v0: String(Math.ceil((guardState.remainingPauseMs ?? 0) / 1000)),
      });
    }
    if (guardState.mode === 'throttled') {
      return t('settingsAuto144', {
        v0: String(guardState.currentBatchSize),
        v1: String(guardState.currentYieldMs),
      });
    }
    return t('settingsAuto145', {
      v0: String(guardState.currentBatchSize),
      v1: String(guardState.currentYieldMs),
    });
  }
  /** RAG 통계 섹션을 부분 업데이트합니다. */
  private updateRagStatsSection(): void {
    const panel = this.ragStatusGrid?.closest('.superpower-inside-rag-status-panel');
    if (!panel) return;
    const statsEl = panel.querySelector('.superpower-inside-rag-stats');
    if (statsEl) {
      const ragTab = this.tabPanels.get('rag');
      if (ragTab) {
        const existingStats = ragTab.querySelector('.superpower-inside-rag-stats');
        if (existingStats) {
          const parent = existingStats.parentElement;
          if (parent) {
            existingStats.remove();
            const tempDiv = document.createElement('div');
            tempDiv.className = 'superpower-inside-rag-stats';
            parent.appendChild(tempDiv);
            this.buildUpdateRequiredDocumentsSection(parent);
          }
        }
      }
    }
  }
  /** 업데이트가 필요한 문서 목록을 부분 업데이트합니다. */
  private updateRagUpdateList(): void {
    const ragTab = this.tabPanels.get('rag');
    if (!ragTab) return;
    const updateList = ragTab.querySelector<HTMLElement>('.superpower-inside-rag-update-list');
    if (updateList) {
      updateList.setText(t('settingsAuto146'));
      void this.getRagStatus().then((status) => {
        updateList.empty();
        if (!status) {
          updateList.setText(t('settingsAuto147'));
          return;
        }
        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          updateList.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: t('settingsAuto148'),
          });
          return;
        }
        updateList.createDiv({
          cls: 'superpower-inside-rag-update-summary',
          text: this.formatRagUpdateSummary(documents),
        });
        for (const document of documents.slice(0, 10)) {
          this.renderRagUpdateDocument(updateList, document);
        }
      });
    }
  }
  private buildUpdateRequiredDocumentsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({
      cls: 'superpower-inside-rag-section-title',
      text: t('settingsAuto149'),
    });
    const listEl = section.createDiv({ cls: 'superpower-inside-rag-update-list' });
    listEl.setText(t('settingsAuto146'));
    void this.getRagStatus()
      .then((status) => {
        listEl.empty();
        if (!status) {
          listEl.setText(t('settingsAuto147'));
          return;
        }
        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          listEl.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: t('settingsAuto148'),
          });
          return;
        }
        listEl.createDiv({
          cls: 'superpower-inside-rag-update-summary',
          text: this.formatRagUpdateSummary(documents),
        });
        for (const document of documents.slice(0, 10)) {
          this.renderRagUpdateDocument(listEl, document);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        listEl.setText(t('settingsAuto150', { v0: String(msg) }));
      });
  }
  private formatRagUpdateSummary(documents: RagDocumentUpdate[]): string {
    const missingCount = documents.filter((document) => document.status === 'missing').length;
    const staleCount = documents.filter((document) => document.status === 'stale').length;
    const unknownCount = documents.filter((document) => document.status === 'unknown').length;
    return t('settingsAuto151', {
      v0: String(documents.length),
      v1: String(missingCount),
      v2: String(staleCount),
      v3: String(unknownCount),
    });
  }
  private renderRagUpdateDocument(containerEl: HTMLElement, document: RagDocumentUpdate): void {
    const row = containerEl.createDiv({ cls: 'superpower-inside-rag-update-row' });
    row.createSpan({
      cls: `superpower-inside-rag-update-badge ${document.status}`,
      text: this.getRagStatusLabel(document.status),
    });
    const body = row.createDiv({ cls: 'superpower-inside-rag-update-body' });
    body.createDiv({ cls: 'superpower-inside-rag-update-path', text: document.path });
    body.createDiv({ cls: 'superpower-inside-rag-update-reason', text: document.reason });
  }
  private getRagStatusLabel(status: RagDocumentUpdate['status']): string {
    if (status === 'missing') return t('settingsAuto152');
    if (status === 'stale') return t('settingsAuto153');
    return t('settingsAuto154');
  }
  private async getRagStatus(signal?: AbortSignal): Promise<RagStatusSummary | null> {
    // 캐시된 eventDrivenRagStats가 있으면 우선 사용 (백그라운드 타이머가 자동 갱신)
    if (this.plugin.eventDrivenRagStats) {
      return this.plugin.eventDrivenRagStats;
    }
    const p = this.plugin as unknown as {
      vectorStore?: VectorStore;
    };
    if (p.vectorStore) {
      return calculateRagStatus(
        this.plugin.app.vault,
        p.vectorStore,
        this.plugin.settings.rag,
        this.plugin.settings.chat,
        signal,
      );
    }
    return this.plugin.eventDrivenRagStats ?? null;
  }
  private getEmbeddingProviderConfig(
    providerKey: EmbeddingProviderKey,
  ): ProviderConfig | CustomOpenAIProviderConfig | null {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      return (
        this.plugin.settings.customOpenAIProviders.find((provider) => provider.id === providerId) ??
        null
      );
    }
    if (providerKey === 'other') {
      return null;
    }
    return this.plugin.settings[providerKey];
  }
  private getEmbeddingProviderModels(providerKey: EmbeddingProviderKey): string[] {
    return this.getEmbeddingProviderConfig(providerKey)?.models ?? [];
  }
  private getEmbeddingProviderLabel(providerKey: EmbeddingProviderKey): string {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      const provider = this.plugin.settings.customOpenAIProviders.find(
        (item) => item.id === providerId,
      );
      return provider?.name.trim() || 'Custom OpenAI-Compatible';
    }
    return EMBEDDING_PROVIDER_LABELS[providerKey];
  }
  private getRagSetupWarning(): string | null {
    const rag = this.plugin.settings.rag;
    const providerKey = rag.embeddingProvider;
    if (providerKey !== 'other') {
      const config = this.getEmbeddingProviderConfig(providerKey);
      const label = this.getEmbeddingProviderLabel(providerKey);
      if (!config?.enabled) {
        return t('settingsAuto155', { v0: String(label) });
      }
      const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
        ? 'customOpenAI'
        : providerKey;
      if (shouldShowProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
        return t('settingsAuto156', { v0: String(label) });
      }
    }
    if (!rag.embeddingModel.trim()) {
      return t('settingsAuto157');
    }
    return null;
  }
  private diagnoseRAGInitFailure(): string {
    const rag = this.plugin.settings.rag;
    const providerKey = rag.embeddingProvider;
    if (providerKey !== 'other') {
      const config = this.getEmbeddingProviderConfig(providerKey);
      const label = this.getEmbeddingProviderLabel(providerKey);
      if (!config?.enabled) {
        return t('settingsAuto158', { v0: String(label) });
      }
      const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
        ? 'customOpenAI'
        : providerKey;
      if (shouldShowProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
        return t('settingsAuto159', { v0: String(label) });
      }
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return t('settingsAuto160');
      }
    } else {
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return t('settingsAuto161');
      }
    }
    return t('settingsAuto162', {
      v0: String(this.getEmbeddingProviderLabel(providerKey)),
      v1: String(rag.embeddingModel),
    });
  }
  private buildControlsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-rag-section superpower-inside-rag-controls-panel',
    });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto163') });
    const controls = section.createDiv({ cls: 'superpower-inside-rag-controls' });
    const p = this.plugin as unknown as {
      vaultIndexer?: VaultIndexer;
      vectorStore?: VectorStore;
      embeddingProvider?: {
        clearCache(): Promise<void>;
      };
      ragIndexingScheduler?: RAGIndexingScheduler;
    };
    const hasIndexer = !!p.vaultIndexer && !!p.ragIndexingScheduler;
    const isIndexing = this.plugin.isRagIndexing();
    const primaryControls = controls.createDiv({ cls: 'superpower-inside-rag-controls-group' });
    primaryControls.createEl('button', { text: t('settingsAuto127') }, (btn) => {
      this.updatePendingButton = btn;
      btn.disabled = true;
      void this.getRagStatus().then((status) => {
        this.updateRagControlStates(status);
      });
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice(t('settingsAuto164') + this.diagnoseRAGInitFailure());
            return;
          }
          try {
            const status = await this.getRagStatus();
            if (!status || status.updateRequiredDocuments.length === 0) {
              return;
            }
            new Notice(t('settingsAuto165', { v0: String(status.updateRequiredDocuments.length) }));
            const result = await p.ragIndexingScheduler!.indexPending();
            new Notice(
              t('settingsAuto166', { v0: String(result.indexed), v1: String(result.skipped) }),
            );
            this.updateRagStats();
          } catch (err) {
            if (isIndexingCancelledError(err)) {
              new Notice(t('settingsAuto167'));
              this.updateRagStats();
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(t('settingsAuto168', { v0: String(msg) }));
          }
        })();
      });
    });
    primaryControls.createEl('button', { text: t('settingsAuto169') }, (btn) => {
      this.reindexAllButton = btn;
      btn.disabled = isIndexing || !hasIndexer;
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice(t('settingsAuto164') + this.diagnoseRAGInitFailure());
            return;
          }
          try {
            const status = await this.getRagStatus();
            if (!status || status.totalDocuments === 0) {
              return;
            }
            new Notice(t('settingsAuto170'));
            const result = await p.ragIndexingScheduler!.reindexAll();
            new Notice(t('settingsAuto171', { v0: String(result.indexed) }));
            this.updateRagStats();
          } catch (err) {
            if (isIndexingCancelledError(err)) {
              new Notice(t('settingsAuto167'));
              this.updateRagStats();
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(t('settingsAuto172', { v0: String(msg) }));
          }
        })();
      });
    });
    primaryControls.createEl('button', { text: t('settingsAuto173') }, (btn) => {
      this.cancelIndexingButton = btn;
      btn.disabled = !isIndexing;
      btn.addEventListener('click', () => {
        this.plugin.cancelRagIndexing();
        this.updateRagStats();
      });
    });
    primaryControls.createEl('button', { text: t('settingsAuto174') }, (btn) => {
      this.resumeIndexingButton = btn;
      btn.disabled = true;
      btn.addEventListener('click', () => {
        this.plugin.resumeRagIndexing();
        this.updateRagStats();
      });
    });
    this.ragControlsHint = controls.createDiv({
      cls: 'superpower-inside-rag-controls-hint',
      text: t('settingsAuto175'),
    });
    const dangerControls = controls.createDiv({
      cls: 'superpower-inside-rag-controls-group is-danger',
    });
    dangerControls.createEl('button', { text: t('settingsAuto176') }, (btn) => {
      btn.disabled = isIndexing;
      btn.addEventListener('click', () => {
        void (async () => {
          if (!confirm(t('settingsAuto177'))) {
            return;
          }
          try {
            if (p.vectorStore) {
              await p.vectorStore.clear();
            }
            if (p.embeddingProvider) {
              await p.embeddingProvider.clearCache();
            }
            new Notice(t('settingsAuto178'));
            this.updateRagStats();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(t('settingsAuto179', { v0: String(msg) }));
          }
        })();
      });
    });
    void this.getRagStatus().then((status) => this.updateRagControlStates(status));
  }
  private updateRagControlStates(status: RagStatusSummary | null): void {
    const p = this.plugin as unknown as {
      vaultIndexer?: VaultIndexer;
      ragIndexingScheduler?: RAGIndexingScheduler;
    };
    const state = getRagIndexingControlState({
      hasIndexer: !!p.vaultIndexer && !!p.ragIndexingScheduler,
      isIndexing: this.plugin.isRagIndexing(),
      totalDocuments: status?.totalDocuments ?? null,
      updateRequiredCount: status?.updateRequiredDocuments.length ?? null,
      guardRemainingPauseMs: this.plugin.getRagPerformanceGuardState()?.remainingPauseMs ?? null,
    });
    this.applyButtonState(this.updatePendingButton, state.updatePending);
    this.applyButtonState(this.reindexAllButton, state.reindexAll);
    this.applyButtonState(this.cancelIndexingButton, state.cancel);
    this.applyButtonState(this.resumeIndexingButton, state.resume);
    const firstReason = state.updatePending.reason ?? state.reindexAll.reason;
    if (this.ragControlsHint) {
      this.ragControlsHint.setText(firstReason ?? t('settingsAuto180'));
    }
  }
  private applyButtonState(
    button: HTMLButtonElement | null,
    state: {
      disabled: boolean;
      reason: string | null;
    },
  ): void {
    if (!button) return;
    button.disabled = state.disabled;
    button.title = state.reason ?? '';
  }
  private buildExcludeListSetting(input: {
    containerEl: HTMLElement;
    name: string;
    description: string;
    placeholder: string;
    values: string[];
    validate: (value: string, existingValues: readonly string[]) => ExcludeValidationResult;
    onChange: (values: string[]) => void;
    countMeta?: {
      getCounts: () => Record<string, number>;
      getItemLabel: (count: number) => string;
      getSummaryLabel: (count: number) => string;
      refreshLabel: string;
    };
  }): void {
    const setting = new Setting(input.containerEl).setName(input.name).setDesc(input.description);
    const editor = setting.controlEl.createDiv({ cls: 'superpower-inside-exclude-editor' });
    const inputRow = editor.createDiv({ cls: 'superpower-inside-exclude-input-row' });
    const textInput = inputRow.createEl('input', {
      cls: 'superpower-inside-exclude-input',
      attr: { type: 'text', placeholder: input.placeholder },
    });
    const addButton = inputRow.createEl('button', {
      cls: 'superpower-inside-exclude-add-btn',
      text: t('excludeListAdd'),
      attr: { type: 'button' },
    });
    const feedbackEl = editor.createDiv({ cls: 'superpower-inside-exclude-feedback' });
    const countMetaEl = input.countMeta
      ? editor.createDiv({ cls: 'superpower-inside-exclude-count-meta' })
      : null;
    const listEl = editor.createDiv({ cls: 'superpower-inside-exclude-list' });
    let itemCounts = input.countMeta?.getCounts() ?? {};
    const getExistingWithoutIndex = (index: number): string[] =>
      input.values.filter((_, itemIndex) => itemIndex !== index);
    const renderIssues = (
      container: HTMLElement,
      issues: readonly ExcludeValidationIssue[],
    ): void => {
      container.empty();
      for (const issue of issues) {
        container.createDiv({
          cls: `superpower-inside-exclude-message is-${issue.level}`,
          text: this.getExcludeIssueText(issue),
        });
      }
    };
    const renderInputValidation = (): ExcludeValidationResult => {
      const result = input.validate(textInput.value, input.values);
      renderIssues(feedbackEl, textInput.value.length > 0 ? result.issues : []);
      addButton.disabled = !result.valid || result.normalized.length === 0;
      return result;
    };
    const renderList = (): void => {
      listEl.empty();
      if (countMetaEl && input.countMeta) {
        countMetaEl.empty();
        const totalCount = input.values.reduce(
          (sum, value) => sum + (itemCounts[value.trim().toLowerCase()] ?? 0),
          0,
        );
        countMetaEl.createDiv({
          cls: 'superpower-inside-exclude-count-summary',
          text: input.countMeta.getSummaryLabel(totalCount),
        });
        const countMeta = input.countMeta;
        this.excludeCountRenderer = () => {
          itemCounts = countMeta.getCounts();
          renderList();
        };
      }
      if (input.values.length === 0) {
        listEl.createDiv({
          cls: 'superpower-inside-exclude-empty',
          text: t('excludeListEmpty'),
        });
        return;
      }
      input.values.forEach((value, index) => {
        const item = listEl.createDiv({ cls: 'superpower-inside-exclude-item' });
        const content = item.createDiv({ cls: 'superpower-inside-exclude-item-content' });
        const valueRow = content.createDiv({ cls: 'superpower-inside-exclude-value-row' });
        valueRow.createDiv({ cls: 'superpower-inside-exclude-value', text: value });
        if (input.countMeta) {
          const count = itemCounts[value.trim().toLowerCase()] ?? 0;
          valueRow.createDiv({
            cls: 'superpower-inside-exclude-count-badge',
            text: input.countMeta.getItemLabel(count),
          });
        }
        const itemIssues = input.validate(value, getExistingWithoutIndex(index)).issues;
        if (itemIssues.length > 0) {
          const itemFeedback = content.createDiv({
            cls: 'superpower-inside-exclude-item-feedback',
          });
          renderIssues(itemFeedback, itemIssues);
        }
        const removeButton = item.createEl('button', {
          cls: 'superpower-inside-exclude-remove-btn',
          text: t('excludeListRemove'),
          attr: { type: 'button' },
        });
        removeButton.addEventListener('click', () => {
          input.values.splice(index, 1);
          input.onChange([...input.values]);
          renderInputValidation();
          renderList();
        });
      });
    };
    const addValue = (): void => {
      const result = renderInputValidation();
      if (!result.valid || !result.normalized) return;
      input.values.push(result.normalized);
      input.onChange([...input.values]);
      itemCounts = input.countMeta?.getCounts() ?? itemCounts;
      textInput.value = '';
      renderInputValidation();
      renderList();
    };
    textInput.addEventListener('input', () => renderInputValidation());
    textInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addValue();
    });
    addButton.addEventListener('click', addValue);
    renderInputValidation();
    renderList();
  }
  private getExcludeIssueText(issue: ExcludeValidationIssue): string {
    switch (issue.code) {
      case 'empty':
        return t('excludeInputEmpty');
      case 'trimmed':
        return t('excludeInputTrimmed');
      case 'duplicate':
        return t('excludeInputDuplicate');
      case 'comma':
        return t('excludeInputComma');
      case 'path-backslash':
        return t('excludePathBackslash');
      case 'path-leading-slash':
        return t('excludePathLeadingSlash');
      case 'path-missing':
        return t('excludePathMissingWarning');
      case 'extension-leading-dot':
        return t('excludeExtLeadingDot');
      case 'extension-invalid':
        return t('excludeExtInvalid');
      case 'extension-protected-document':
        return t('excludeExtProtectedDocument');
    }
  }
  private buildExcludeOptionsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto181') });
    this.buildExcludeListSetting({
      containerEl: section,
      name: t('excludePaths'),
      description: t('excludePathsDesc'),
      placeholder: t('excludePathPlaceholder'),
      values: this.plugin.settings.rag.excludePaths,
      validate: (value, existingValues) =>
        validateExcludePathInput(
          value,
          existingValues,
          (path) => path.includes('*') || this.app.vault.getAbstractFileByPath(path) !== null,
      ),
      onChange: (values) => {
        this.plugin.settings.rag.excludePaths = values;
        this.debouncedRagSave();
      },
    });
    new Setting(section)
      .setName(t('excludeChatFolder'))
      .setDesc(getChatFolderExcludeDescription(this.plugin.settings.chat.saveFolder))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.excludeChatFolder).onChange((value) => {
          this.plugin.settings.rag.excludeChatFolder = value;
          this.debouncedRagSave();
        }),
      );
    this.buildExcludeListSetting({
      containerEl: section,
      name: t('excludeExts'),
      description: t('excludeExtsDesc'),
      placeholder: t('excludeExtPlaceholder'),
      values: this.plugin.settings.rag.excludeExts,
      validate: validateExcludeExtensionInput,
      onChange: (values) => {
        this.plugin.settings.rag.excludeExts = values;
        this.debouncedRagSave();
      },
      countMeta: {
        getCounts: () =>
          countFilesByExtensions(this.app.vault, this.plugin.settings.rag.excludeExts),
        getItemLabel: (count) => t('excludeExtFileCount').replace('{count}', String(count)),
        getSummaryLabel: (count) => t('excludeExtTotalFileCount').replace('{count}', String(count)),
        refreshLabel: t('refresh'),
      },
    });
  }
  private buildIndexingOptionsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto182') });
    // 자동 업데이트 토글
    new Setting(section)
      .setName(t('settingsAuto120'))
      .setDesc(t('settingsAuto183'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.autoUpdateEnabled).onChange(async (value) => {
          this.plugin.settings.rag.autoUpdateEnabled = value;
          await this.plugin.saveSettingsLight();
          this.plugin.setupAutoUpdate();
        }),
      );
    // 자동 업데이트 간격 (분)
    new Setting(section)
      .setName(t('autoUpdateInterval'))
      .setDesc(t('autoUpdateIntervalDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.autoUpdateIntervalMin))
          .setPlaceholder('5')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 99 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.autoUpdateIntervalMin = num;
            this.debouncedSave();
            this.plugin.setupAutoUpdate();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '99';
      });
    new Setting(section)
      .setName(t('settingsAuto184'))
      .setDesc(t('settingsAuto185'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', t('settingsAuto186'))
          .addOption('custom', t('settingsAuto187'))
          .setValue(this.plugin.settings.rag.performanceTuningMode)
          .onChange((value) => {
            this.plugin.settings.rag.performanceTuningMode = value === 'custom' ? 'custom' : 'auto';
            this.debouncedRagSave();
            section.remove();
            this.buildIndexingOptionsSection(containerEl);
          }),
      );
    if (this.plugin.settings.rag.performanceTuningMode !== 'custom') {
      const performanceSettings = resolveRagPerformanceSettings(this.plugin.settings.rag);
      section.createDiv({
        cls: 'superpower-inside-rag-performance-summary',
        text: t('settingsAuto188', {
          v0: String(performanceSettings.maxEmbeddingBatchSize),
          v1: String(performanceSettings.indexingYieldMs),
          v2: String(performanceSettings.slowEventLoopThresholdMs),
          v3: String(performanceSettings.slowBatchThresholdMs),
        }),
      });
    }
    if (this.plugin.settings.rag.performanceTuningMode === 'custom') {
      new Setting(section)
        .setName(t('settingsAuto189'))
        .setDesc(t('settingsAuto190'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.rag.performanceGuardEnabled).onChange((value) => {
            this.plugin.settings.rag.performanceGuardEnabled = value;
            this.debouncedRagSave();
          }),
        );
      new Setting(section)
        .setName(t('settingsAuto191'))
        .setDesc(t('settingsAuto192'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.maxEmbeddingBatchSize))
            .setPlaceholder(this.plugin.settings.rag.embeddingProvider === 'ollama' ? '1' : '32')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 1 || num > 128 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.maxEmbeddingBatchSize = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '1';
          text.inputEl.max = '128';
        });
      new Setting(section)
        .setName(t('settingsAuto193'))
        .setDesc(t('settingsAuto194'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.indexingYieldMs))
            .setPlaceholder('25')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 0 || num > 1000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.indexingYieldMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '0';
          text.inputEl.max = '1000';
        });
      new Setting(section)
        .setName(t('settingsAuto195'))
        .setDesc(t('settingsAuto196'))
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.slowEventLoopThresholdMs))
            .setPlaceholder('150')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 16 || num > 5000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.slowEventLoopThresholdMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '16';
          text.inputEl.max = '5000';
        })
        .addText((text) => {
          text
            .setValue(String(this.plugin.settings.rag.slowBatchThresholdMs))
            .setPlaceholder('3000')
            .onChange((value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isNaN(num) || num < 100 || num > 60000 || !Number.isInteger(num)) return;
              this.plugin.settings.rag.slowBatchThresholdMs = num;
              this.debouncedRagSave();
            });
          text.inputEl.type = 'number';
          text.inputEl.min = '100';
          text.inputEl.max = '60000';
        });
    }
    // 청크 크기
    const chunkSizeSetting = new Setting(section)
      .setName(t('chunkSize'))
      .setDesc(t('chunkSizeDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.chunkSize))
          .setPlaceholder('100')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 100 || num > 5000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.chunkSize = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '100';
        text.inputEl.max = '5000';
      });
    // Ollama 임베딩 모델 컨텍스트 길이 경고
    if (this.plugin.settings.rag.embeddingProvider === 'ollama') {
      const warnEl = chunkSizeSetting.descEl.createEl('div', {
        cls: 'superpower-inside-settings-warning',
      });
      warnEl.setText(t('ragChunkSizeOllamaWarning'));
    }
  }
  private buildSearchQualitySection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: t('settingsAuto198') });
    section.createDiv({
      cls: 'superpower-inside-rag-guidance',
      text: t('bm25Guidance'),
    });
    new Setting(section)
      .setName(t('minScore'))
      .setDesc(t('minScoreDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.minScore))
          .setPlaceholder('0.5')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 0 || num > 1) return;
            this.plugin.settings.rag.minScore = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.05';
      });
    new Setting(section)
      .setName(t('enableBM25'))
      .setDesc(t('enableBM25Desc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.enableBM25).onChange((value) => {
          this.plugin.settings.rag.enableBM25 = value;
          void this.plugin.saveSettings({ reinitRag: true, reinitMcp: false });
        }),
      );
    new Setting(section)
      .setName(t('bm25Weight'))
      .setDesc(t('bm25WeightDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.bm25Weight))
          .setPlaceholder('0.3')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 0 || num > 1) return;
            this.plugin.settings.rag.bm25Weight = num;
            this.debouncedRagSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.05';
      });
  }
  private buildChatTab(containerEl: HTMLElement): void {
    const storagePanel = this.createSettingsPanel(containerEl, t('settingsAuto088'), {
      description: t('settingsAuto199'),
    });
    const promptPanel = this.createSettingsPanel(containerEl, t('settingsAuto200'), {
      description: t('settingsAuto201'),
    });
    const toolPanel = this.createSettingsPanel(containerEl, t('settingsAuto202'), {
      description: t('settingsAuto203'),
    });
    new Setting(storagePanel)
      .setName(t('chatSaveFolder'))
      .setDesc(t('chatSaveFolderDesc'))
      .addText((text) =>
        text.setValue(this.plugin.settings.chat.saveFolder).onChange((value) => {
          this.plugin.settings.chat.saveFolder = value.trim();
          this.debouncedRagSave();
        }),
      );
    new Setting(promptPanel)
      .setName(t('systemPrompt'))
      .setDesc(t('systemPromptDesc'))
      .addButton((button) => {
        button.setButtonText(t('promptLibraryOpen'));
        button.onClick(() => {
          openPromptLibraryModal({
            containerEl,
            plugin: this.plugin,
            currentSessionPrompt: null,
            selectedModel: this.plugin.settings.chat.defaultModel,
            onClose: () => {
              const chatPanel = this.tabPanels.get('chat');
              if (chatPanel) {
                chatPanel.empty();
                this.buildChatTab(chatPanel);
              }
            },
          });
        });
      })
      .addTextArea((text) => {
        const activePrompt = getActivePromptEntry(this.plugin.settings);
        text.inputEl.rows = 6;
        text.setValue(activePrompt.content);
        text.setPlaceholder(t('systemPromptPlaceholder'));
        text.onChange((value) => {
          const active = getActivePromptEntry(this.plugin.settings);
          const existing = this.plugin.settings.chat.promptLibrary.find(
            (entry) => entry.id === active.id,
          );
          if (existing) {
            existing.content = value;
            existing.updatedAt = new Date().toISOString();
          }
          this.plugin.settings.chat.systemPrompt = value;
          this.debouncedSave();
        });
      });
    new Setting(toolPanel)
      .setName(t('mcpToolExecutionPolicy'))
      .setDesc(t('mcpToolExecutionPolicyDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('mentioned-auto', t('mcpToolExecutionMentionedAuto'))
          .addOption('always-manual', t('mcpToolExecutionAlwaysManual'))
          .addOption('always-auto', t('mcpToolExecutionAlwaysAuto'))
          .setValue(this.plugin.settings.chat.mcpToolExecutionPolicy)
          .onChange((value) => {
            this.plugin.settings.chat.mcpToolExecutionPolicy =
              value as ChatConfig['mcpToolExecutionPolicy'];
            this.debouncedSave();
          }),
      );
    const presetRow = promptPanel.createDiv({ cls: 'superpower-inside-chat-presets' });
    const presets: {
      label: string;
      description: string;
      prompt: string;
    }[] = [
      {
        label: t('settingsAuto204'),
        description: t('settingsAuto205'),
        prompt: t('settingsAuto206'),
      },
      {
        label: t('settingsAuto207'),
        description: t('settingsAuto208'),
        prompt: t('settingsAuto209'),
      },
      {
        label: t('settingsAuto210'),
        description: t('settingsAuto211'),
        prompt: t('settingsAuto212'),
      },
      {
        label: t('settingsAuto213'),
        description: t('settingsAuto214'),
        prompt: t('settingsAuto215'),
      },
      {
        label: t('settingsAuto216'),
        description: t('settingsAuto217'),
        prompt: t('settingsAuto218'),
      },
    ];
    for (const preset of presets) {
      const btn = presetRow.createEl('button', {
        text: preset.label,
        cls: 'superpower-inside-mcp-preset-btn',
      });
      btn.title = preset.description;
      btn.addEventListener('click', () => {
        const entry = createPromptEntry({
          title: preset.label,
          description: preset.description,
          content: preset.prompt,
          source: 'user',
        });
        this.plugin.settings.chat.promptLibrary = [
          entry,
          ...this.plugin.settings.chat.promptLibrary,
        ];
        this.plugin.settings.chat.activePromptId = entry.id;
        this.plugin.settings.chat.systemPrompt = preset.prompt;
        this.debouncedSave();
        const chatPanel = this.tabPanels.get('chat');
        if (chatPanel) {
          chatPanel.empty();
          this.buildChatTab(chatPanel);
        }
        new Notice(t('settingsAuto219', { v0: String(preset.label) }));
      });
    }
    const resetRow = promptPanel.createDiv({ cls: 'superpower-inside-chat-presets' });
    const resetBtn = resetRow.createEl('button', {
      text: t('resetToDefault'),
      cls: 'superpower-inside-mcp-preset-btn',
    });
    resetBtn.addEventListener('click', () => {
      this.plugin.settings.chat.systemPrompt = '';
      this.plugin.settings.chat.activePromptId = 'default-obsidian-knowledge-work';
      this.debouncedSave();
      const chatPanel = this.tabPanels.get('chat');
      if (chatPanel) {
        chatPanel.empty();
        this.buildChatTab(chatPanel);
      }
      new Notice(t('settingsAuto220'));
    });
    new Setting(storagePanel)
      .setName(t('chatAutoSave'))
      .setDesc(t('chatAutoSaveDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chat.autoSaveEnabled).onChange((value) => {
          this.plugin.settings.chat.autoSaveEnabled = value;
          this.debouncedSave();
        }),
      );
    new Setting(storagePanel)
      .setName(t('chatAutoSaveDelay'))
      .setDesc(t('chatAutoSaveDelayDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.chat.autoSaveDebounceMs))
          .setPlaceholder('3000')
          .onChange((value) => {
            const num = Number(value);
            if (value.trim() === '') return;
            if (Number.isNaN(num) || num < 1000 || num > 10000 || !Number.isInteger(num)) return;
            this.plugin.settings.chat.autoSaveDebounceMs = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1000';
        text.inputEl.max = '10000';
        text.inputEl.step = '500';
      });
    new Setting(toolPanel)
      .setName(t('enforceMcpTools'))
      .setDesc(t('enforceMcpToolsDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chat.enforceMcpTools).onChange((value) => {
          this.plugin.settings.chat.enforceMcpTools = value;
          this.debouncedSave();
        }),
      );
  }
  private buildMCPTab(containerEl: HTMLElement): void {
    containerEl.empty();
    const mcpSection = containerEl.createDiv({ cls: 'superpower-inside-mcp-tab' });
    const statusPanel = this.createSettingsPanel(mcpSection, t('settingsAuto221'), {
      description: t('settingsAuto222'),
    });
    const pathPanel = this.createSettingsPanel(mcpSection, t('mcpPathTitle'), {
      description: t('mcpPathDesc'),
    });
    const editorPanel = this.createSettingsPanel(mcpSection, t('mcpJsonEditor'), {
      description: t('settingsAuto223'),
    });
    const pathHeader = pathPanel.createEl('div', {
      cls: 'superpower-inside-mcp-collapsible-header',
    });
    const pathChevron = pathHeader.createEl('span', {
      cls: 'superpower-inside-mcp-collapsible-chevron',
      text: '▶',
    });
    pathHeader.createEl('span', {
      cls: 'superpower-inside-mcp-collapsible-title',
      text: t('mcpPathTitle'),
    });
    const pathContent = pathPanel.createDiv({
      cls: 'superpower-inside-mcp-collapsible-content',
    });
    if (Platform.isWin) {
      new Setting(pathContent)
        .setName(t('mcpIncludeWslPath'))
        .setDesc(t('mcpIncludeWslPathDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.mcpIncludeWslPath).onChange((value) => {
            this.plugin.settings.mcpIncludeWslPath = value;
            this.debouncedSave();
          }),
        );
    }
    const pathRow = pathContent.createDiv({ cls: 'superpower-inside-mcp-path-row' });
    const pathText = pathRow.createEl('textarea', {
      cls: 'superpower-inside-mcp-json-editor',
      attr: { placeholder: t('mcpPathPlaceholder'), rows: '3' },
    });
    pathText.value = this.plugin.settings.mcpPath;
    const pathActions = pathRow.createDiv({ cls: 'superpower-inside-mcp-path-actions' });
    const fetchBtn = pathActions.createEl('button', { text: t('mcpPathFetch') });
    fetchBtn.addEventListener('click', () => {
      void (async () => {
        const originalText = fetchBtn.textContent;
        fetchBtn.setText(t('mcpPathFetching'));
        fetchBtn.disabled = true;
        try {
          if (!isMcpStdioAvailable(Platform)) {
            throw new Error(t('settingsAuto224'));
          }
          const { getDesktopLoginShellPath } = await import('./mcp/path');
          const output = getDesktopLoginShellPath({
            platform: Platform,
            includeWslPath: this.plugin.settings.mcpIncludeWslPath,
          });
          pathText.value = output;
          this.plugin.settings.mcpPath = output;
          await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
          new Notice(t('mcpPathFetchSuccess'));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`${t('mcpPathFetchError')}: ${msg}\n${t('mcpPathFetchErrorHelp')}`, 10000);
        } finally {
          fetchBtn.setText(originalText);
          fetchBtn.disabled = false;
        }
      })();
    });
    const saveBtn = pathActions.createEl('button', { text: t('save') });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        this.plugin.settings.mcpPath = pathText.value.trim();
        await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
        new Notice(t('mcpJsonSaved'));
      })();
    });
    pathHeader.addEventListener('click', () => {
      const isExpanded = !pathContent.hasClass(HIDDEN_CLASS);
      if (isExpanded) {
        pathContent.addClass(HIDDEN_CLASS);
        pathChevron.textContent = '▶';
        pathHeader.removeClass('is-expanded');
      } else {
        pathContent.removeClass(HIDDEN_CLASS);
        pathChevron.textContent = '▼';
        pathHeader.addClass('is-expanded');
      }
    });
    pathContent.addClass(HIDDEN_CLASS);
    const statusSection = statusPanel.createDiv({ cls: 'superpower-inside-mcp-status' });
    this.renderMCPStatus(statusSection);
    this.unregisterMcpStatusEvent();
    this.mcpStatusEventRef = (this.app.workspace as unknown as Events).on(
      MCP_STATUS_CHANGE_EVENT,
      () => {
        this.renderMCPStatus(statusSection);
      },
    );
    const lintStatus = editorPanel.createDiv({ cls: 'superpower-inside-mcp-lint-status' });
    lintStatus.setText('');
    const defaultJson = buildMcpJsonEditorValue(this.plugin.settings.mcpServers);
    const jsonTextArea = editorPanel.createEl('textarea', {
      cls: 'superpower-inside-mcp-json-editor',
    });
    jsonTextArea.value = defaultJson;
    let lintTimeout: number | null = null;
    let autoSaveTimeout: number | null = null;
    const runLint = () => {
      lintStatus.setText(t('mcpJsonLinting'));
      lintStatus.removeClass('success');
      lintStatus.removeClass('error');
      if (lintTimeout) {
        window.clearTimeout(lintTimeout);
        lintTimeout = null;
      }
      if (autoSaveTimeout) {
        window.clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }
      lintTimeout = window.setTimeout(() => {
        lintTimeout = null;
        const result = validateMcpJson(jsonTextArea.value);
        if (result.valid) {
          lintStatus.setText('✅ ' + t('mcpJsonLintOk'));
          lintStatus.addClass('success');
          lintStatus.removeClass('error');
          autoSaveTimeout = window.setTimeout(() => {
            autoSaveTimeout = null;
            this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
            void (async () => {
              const saveResult = await this.plugin.saveSettings({
                reinitRag: false,
                reinitMcp: true,
              });
              if (saveResult.success) {
                lintStatus.setText('✅ ' + t('mcpJsonSaved'));
              } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
                lintStatus.setText(
                  t('settingsAuto225', { v0: String(saveResult.mcpErrors.length) }),
                );
                lintStatus.addClass('error');
                lintStatus.removeClass('success');
              }
            })();
          }, 1000);
        } else {
          lintStatus.setText(`❌ ${t('mcpJsonLintError', { error: result.error ?? '' })}`);
          lintStatus.addClass('error');
          lintStatus.removeClass('success');
        }
      }, 1000);
    };
    jsonTextArea.addEventListener('input', () => {
      runLint();
    });
    jsonTextArea.addEventListener('blur', () => {
      const formatted = formatMcpJson(jsonTextArea.value);
      if (formatted !== null) {
        jsonTextArea.value = formatted;
      }
    });
    jsonTextArea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = jsonTextArea.selectionStart;
        const end = jsonTextArea.selectionEnd;
        const indent = '  ';
        jsonTextArea.setRangeText(indent, start, end, 'end');
        runLint();
      }
    });
    new Setting(editorPanel).addButton((btn) =>
      btn.setButtonText(t('save')).onClick(async () => {
        const result = validateMcpJson(jsonTextArea.value);
        if (result.valid) {
          this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
          const saveResult = await this.plugin.saveSettings({ reinitRag: false, reinitMcp: true });
          if (saveResult.success) {
            lintStatus.setText('✅ ' + t('mcpJsonSaved'));
            lintStatus.addClass('success');
            lintStatus.removeClass('error');
            new Notice(t('mcpJsonSaved'));
            jsonTextArea.value = JSON.stringify(result.data, null, 2);
          } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
            lintStatus.setText(t('settingsAuto226', { v0: String(saveResult.mcpErrors.length) }));
            lintStatus.addClass('error');
            lintStatus.removeClass('success');
            const errorDetails = saveResult.mcpErrors.map((err) => `• ${err}`).join('\n');
            new Notice(t('settingsAuto227', { v0: String(errorDetails) }), 10000);
          }
          statusSection.empty();
          this.renderMCPStatus(statusSection);
        } else {
          const detailedError = this.buildDetailedMcpError(result.error ?? '');
          lintStatus.setText(`❌ ${detailedError.short}`);
          lintStatus.addClass('error');
          lintStatus.removeClass('success');
          new Notice(detailedError.full, 10000);
        }
      }),
    );
  }
  private buildDetailedMcpError(rawError: string): {
    short: string;
    full: string;
  } {
    if (rawError.includes(t('mcpJsonInvalidObject'))) {
      return {
        short: t('settingsAuto228'),
        full: t('settingsAuto229', { v0: String(t('mcpJsonInvalidObject')) }),
      };
    }
    if (rawError.includes(t('mcpJsonMissingMcpServers'))) {
      return {
        short: t('settingsAuto230'),
        full: t('settingsAuto231', { v0: String(t('mcpJsonMissingMcpServers')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidMcpServers'))) {
      return {
        short: t('settingsAuto232'),
        full: t('settingsAuto233', { v0: String(t('mcpJsonInvalidMcpServers')) }),
      };
    }
    if (rawError.includes(t('mcpJsonServerNeedsCommand'))) {
      return {
        short: t('settingsAuto234'),
        full: t('settingsAuto235', { v0: String(t('mcpJsonServerNeedsCommand')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidArgs'))) {
      return {
        short: t('settingsAuto236'),
        full: t('settingsAuto237', { v0: String(t('mcpJsonInvalidArgs')) }),
      };
    }
    if (rawError.includes(t('mcpJsonInvalidEnv'))) {
      return {
        short: t('settingsAuto238'),
        full: t('settingsAuto239', { v0: String(t('mcpJsonInvalidEnv')) }),
      };
    }
    if (rawError.includes('Unexpected token') || rawError.includes('JSON')) {
      return {
        short: t('settingsAuto240'),
        full: t('settingsAuto241', { v0: String(rawError) }),
      };
    }
    return {
      short: rawError,
      full: t('settingsAuto098', { v0: String(rawError) }),
    };
  }
  private buildAdvancedTab(containerEl: HTMLElement): void {
    const pluginAwarePanel = this.createSettingsPanel(containerEl, t('settingsAuto242'), {
      description: t('settingsAuto243'),
    });
    new Setting(pluginAwarePanel)
      .setName(t('pluginAwareGeneration'))
      .setDesc(t('pluginAwareGenerationDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pluginAwareEnabled).onChange((value) => {
          this.plugin.settings.pluginAwareEnabled = value;
          this.debouncedSave();
        }),
      );
    pluginAwarePanel.createDiv({
      cls: 'superpower-inside-settings-help',
      text: t('pluginAwareGenerationLimitNotice'),
    });
    if (
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: this.plugin.settings.pluginAwareEnabled,
        servers: this.plugin.settings.mcpServers,
      })
    ) {
      pluginAwarePanel.createDiv({
        cls: 'superpower-inside-settings-warning',
        text: t('pluginAwareContext7MissingWarning'),
      });
    }
  }
  private buildProviderSettings(containerEl: HTMLElement, target: ProviderSettingsTarget): void {
    const { config, label } = target;
    const cacheKey = target.key;
    const section = containerEl.createDiv({
      cls: 'superpower-inside-settings-panel superpower-inside-provider-card',
    });
    const titleRow = section.createDiv({ cls: 'superpower-inside-provider-title-row' });
    titleRow.createDiv({ cls: 'superpower-inside-settings-section-title', text: label });
    const selectedCountEl = titleRow.createDiv({
      cls: 'superpower-inside-provider-selected-count',
    });
    new Setting(section).setName(t('enabled')).addToggle((toggle) =>
      toggle.setValue(config.enabled).onChange((value) => {
        config.enabled = value;
        this.debouncedSave();
      }),
    );
    const apiKeyVisibilityKey = target.kind === 'custom' ? 'customOpenAI' : target.key;
    if (shouldShowProviderApiKey(apiKeyVisibilityKey)) {
      new Setting(section).setName(t('apiKey')).addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(config.apiKey)
          .onChange((value) => {
            config.apiKey = value.trim();
            this.debouncedSave();
          }),
      );
    }
    if (target.kind === 'custom') {
      new Setting(section).setName(t('settingsAuto244')).addText((text) =>
        text
          .setPlaceholder(t('settingsAuto245'))
          .setValue(target.config.name)
          .onChange((value) => {
            target.config.name = value.trim();
            this.debouncedSave();
          }),
      );
      new Setting(section).setName('OpenAI v1 Base URL').addText((text) =>
        text
          .setPlaceholder(t('settingsAuto246'))
          .setValue(target.config.baseUrl ?? '')
          .onChange((value) => {
            target.config.baseUrl = value.trim();
            this.debouncedSave();
          }),
      );
      const useRequestUrl = target.config.useRequestUrl ?? true;
      new Setting(section)
        .setName(t('settingsAuto247'))
        .setDesc(t('settingsAuto248') + t('settingsAuto249'))
        .addToggle((toggle) =>
          toggle.setValue(useRequestUrl).onChange((value) => {
            target.config.useRequestUrl = value;
            this.debouncedSave();
          }),
        );
      const capabilityOverrides = target.config.capabilityOverrides ?? {};
      const updateCapabilityOverride = <K extends keyof ProviderCapabilityOverrides>(
        key: K,
        value: ProviderCapabilityOverrides[K],
      ): void => {
        target.config.capabilityOverrides = {
          ...(target.config.capabilityOverrides ?? {}),
          [key]: value,
        };
        this.debouncedSave();
      };
      new Setting(section)
        .setName(t('providerCapabilityToolCalling'))
        .setDesc(t('providerCapabilityToolCallingDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.toolCalling ?? false).onChange((value) => {
            updateCapabilityOverride('toolCalling', value);
          }),
        );
      new Setting(section)
        .setName(t('providerCapabilityReasoning'))
        .setDesc(t('providerCapabilityReasoningDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.reasoning ?? false).onChange((value) => {
            updateCapabilityOverride('reasoning', value);
          }),
        );
      new Setting(section)
        .setName(t('providerCapabilityLiveStreaming'))
        .setDesc(t('providerCapabilityLiveStreamingDesc'))
        .addToggle((toggle) =>
          toggle.setValue(capabilityOverrides.streaming ?? !useRequestUrl).onChange((value) => {
            updateCapabilityOverride('streaming', value);
          }),
        );
      const defaultAbort = useRequestUrl ? 'best-effort' : 'native';
      new Setting(section)
        .setName(t('providerCapabilityNativeAbort'))
        .setDesc(t('providerCapabilityNativeAbortDesc'))
        .addToggle((toggle) =>
          toggle.setValue((capabilityOverrides.abort ?? defaultAbort) === 'native').onChange(
            (value) => {
              updateCapabilityOverride('abort', value ? 'native' : 'best-effort');
            },
          ),
        );
      new Setting(section)
        .setName(t('providerCapabilityMaxToolRounds'))
        .setDesc(t('providerCapabilityMaxToolRoundsDesc'))
        .addText((text) =>
          text
            .setPlaceholder('0')
            .setValue(String(capabilityOverrides.maxToolRounds ?? 0))
            .onChange((value) => {
              const parsed = Number(value.trim());
              updateCapabilityOverride(
                'maxToolRounds',
                Number.isInteger(parsed) && parsed >= 0 ? parsed : 0,
              );
            }),
        );
    }
    const controls = section.createDiv({ cls: 'superpower-inside-provider-model-controls' });
    const searchInput = controls.createEl('input', {
      type: 'search',
      placeholder: t('settingsAuto250'),
      cls: 'superpower-inside-provider-model-search',
    });
    const selectedOnlyLabel = controls.createEl('label', {
      cls: 'superpower-inside-provider-selected-only',
    });
    const selectedOnlyInput = selectedOnlyLabel.createEl('input', { type: 'checkbox' });
    selectedOnlyLabel.createSpan({ text: t('settingsAuto251') });
    const modelListContainer = section.createDiv({ cls: 'superpower-inside-settings-model-list' });
    const statusContainer = section.createDiv({
      cls: 'superpower-inside-settings-validation-status',
    });
    let filterText = '';
    let selectedOnly = false;
    let availableModels = this.getInitialProviderModels(cacheKey, config);
    const renderModelList = () => {
      modelListContainer.empty();
      selectedCountEl.setText(t('settingsAuto252', { v0: String(config.models.length) }));
      if (availableModels.length === 0) {
        modelListContainer.setText(t('noModelsFound'));
        return;
      }
      const normalizedFilter = filterText.trim().toLowerCase();
      const sortedModels = [...availableModels].sort((a, b) => a.localeCompare(b, 'en'));
      const visibleModels = sortedModels.filter((model) => {
        if (selectedOnly && !config.models.includes(model)) return false;
        if (!normalizedFilter) return true;
        return model.toLowerCase().includes(normalizedFilter);
      });
      const header = modelListContainer.createDiv({
        cls: 'superpower-inside-settings-model-list-header',
      });
      header.textContent = t('settingsAuto253', {
        v0: String(visibleModels.length),
        v1: String(sortedModels.length),
      });
      if (visibleModels.length === 0) {
        modelListContainer.createDiv({
          cls: 'superpower-inside-provider-empty-models',
          text: t('settingsAuto254'),
        });
        return;
      }
      visibleModels.forEach((model) => {
        const item = modelListContainer.createDiv({ cls: 'superpower-inside-settings-model-item' });
        const checkbox = item.createEl('input', { type: 'checkbox' });
        checkbox.checked = config.models.includes(model);
        item.createSpan({ text: model });
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            config.models.push(model);
          } else {
            config.models = config.models.filter((m) => m !== model);
          }
          this.debouncedSave();
          renderModelList();
        });
      });
    };
    searchInput.addEventListener('input', () => {
      filterText = searchInput.value;
      renderModelList();
    });
    selectedOnlyInput.addEventListener('change', () => {
      selectedOnly = selectedOnlyInput.checked;
      renderModelList();
    });
    renderModelList();
    new Setting(section)
      .setName(t('settingsAuto255'))
      .setDesc(t('settingsAuto256'))
      .addButton((button) => {
        button.setButtonText(t('settingsAuto257'));
        button.onClick(async () => {
          statusContainer.setText('');
          button.setDisabled(true);
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { fetchProviderModels } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await fetchProviderModels(target.key, config)
                : await fetchProviderModels('customOpenAI', target.config);
            spinner.remove();
            if (result.valid) {
              availableModels = this.mergeModels(config.models, result.models);
              this.validationCache[cacheKey] = result;
              statusContainer.setText(t('settingsAuto258', { v0: String(result.models.length) }));
              renderModelList();
            } else {
              statusContainer.setText(t('settingsAuto259', { v0: String(result.error) }));
              this.validationCache[cacheKey] = {
                valid: false,
                models: this.validationCache[cacheKey]?.models ?? [],
                error: result.error,
              };
            }
          } catch (err) {
            spinner.remove();
            const msg = err instanceof Error ? err.message : String(err);
            statusContainer.setText(`❌ ${t('error')}: ${msg}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });
    new Setting(section)
      .setName(t('settingsAuto094'))
      .setDesc(t('settingsAuto256'))
      .addButton((button) => {
        button.setButtonText(t('testConnection'));
        button.onClick(async () => {
          statusContainer.setText('');
          button.setDisabled(true);
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { validateProviderConnection } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await validateProviderConnection(target.key, config)
                : await validateProviderConnection('customOpenAI', target.config);
            spinner.remove();
            if (result.valid) {
              availableModels = this.mergeModels(config.models, result.models);
              statusContainer.setText(t('settingsAuto260', { v0: String(result.models.length) }));
              this.validationCache[cacheKey] = result;
              renderModelList();
            } else {
              statusContainer.setText(t('settingsAuto097', { v0: String(result.error) }));
              this.validationCache[cacheKey] = {
                valid: false,
                models: this.validationCache[cacheKey]?.models ?? [],
                error: result.error,
              };
            }
          } catch (err) {
            spinner.remove();
            const msg = err instanceof Error ? err.message : String(err);
            statusContainer.setText(`❌ ${t('error')}: ${msg}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });
    new Setting(section)
      .setName(t('settingsAuto261'))
      .setDesc(t('settingsAuto262'))
      .addButton((button) => {
        button.setButtonText(t('settingsAuto261'));
        button.onClick(async () => {
          statusContainer.setText('');
          const model = config.models[0];
          if (!model) {
            statusContainer.setText(t('settingsAuto263'));
            return;
          }
          button.setDisabled(true);
          const spinner = statusContainer.createSpan({ cls: 'superpower-inside-spinner' });
          try {
            const { testProviderGeneration } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await testProviderGeneration(target.key, config, model)
                : await testProviderGeneration('customOpenAI', target.config, model);
            spinner.remove();
            if (result.valid) {
              statusContainer.setText(t('settingsAuto264', { v0: String(model) }));
              this.validationCache[cacheKey] = result;
            } else {
              statusContainer.setText(t('settingsAuto265', { v0: String(result.error) }));
              this.validationCache[cacheKey] = {
                valid: false,
                models: this.validationCache[cacheKey]?.models ?? [],
                error: result.error,
              };
            }
          } catch (err) {
            spinner.remove();
            const msg = err instanceof Error ? err.message : String(err);
            statusContainer.setText(`❌ ${t('error')}: ${msg}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }
  private getInitialProviderModels(cacheKey: string, config: ProviderConfig): string[] {
    const cached = this.validationCache[cacheKey];
    const models = new Set<string>(config.models);
    if (cached && cached.valid && cached.models.length > 0) {
      cached.models.forEach((m) => models.add(m));
    }
    return Array.from(models).sort((a, b) => a.localeCompare(b, 'en'));
  }
  private mergeModels(selectedModels: string[], fetchedModels: string[]): string[] {
    const models = new Set<string>(selectedModels);
    fetchedModels.forEach((model) => models.add(model));
    return Array.from(models).sort((a, b) => a.localeCompare(b, 'en'));
  }
  private buildCustomOpenAIProvidersSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-settings-panel superpower-inside-provider-custom-section',
    });
    section.createDiv({
      cls: 'superpower-inside-settings-section-title',
      text: 'Custom OpenAI-Compatible',
    });
    section.createDiv({
      cls: 'superpower-inside-provider-help',
      text: t('settingsAuto266'),
    });
    for (const provider of this.plugin.settings.customOpenAIProviders) {
      this.buildProviderSettings(section, {
        kind: 'custom',
        key: `customOpenAI:${provider.id}`,
        label: provider.name.trim() || 'Custom OpenAI-Compatible',
        config: provider,
      });
      const row = section.createDiv({ cls: 'superpower-inside-provider-custom-actions' });
      const removeButton = row.createEl('button', { text: t('settingsAuto267') });
      removeButton.addEventListener('click', () => {
        this.plugin.settings.customOpenAIProviders =
          this.plugin.settings.customOpenAIProviders.filter((item) => item.id !== provider.id);
        this.debouncedSave();
        section.remove();
        this.buildCustomOpenAIProvidersSection(containerEl);
      });
    }
    const addButton = section.createEl('button', { text: t('settingsAuto268') });
    addButton.addEventListener('click', () => {
      const id = this.createCustomProviderId();
      this.plugin.settings.customOpenAIProviders.push({
        id,
        name: 'Custom OpenAI-Compatible',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        models: [],
        enabled: false,
        useRequestUrl: true,
      });
      this.debouncedSave();
      section.remove();
      this.buildCustomOpenAIProvidersSection(containerEl);
    });
  }
  private createCustomProviderId(): string {
    const existing = new Set(
      this.plugin.settings.customOpenAIProviders.map((provider) => provider.id),
    );
    let index = this.plugin.settings.customOpenAIProviders.length + 1;
    let id = `custom-${index}`;
    while (existing.has(id)) {
      index += 1;
      id = `custom-${index}`;
    }
    return id;
  }
  private renderMCPStatus(containerEl: HTMLElement): void {
    containerEl.empty();
    const plugin = this.plugin as unknown as {
      mcpRegistry: import('./mcp/registry').MCPRegistry | null;
      mcpConnectionState?: MCPConnectionState;
      mcpLastErrors?: string[];
      reconnectMCP?(): Promise<string[]>;
    };
    const registry = plugin.mcpRegistry;
    const servers = this.plugin.settings.mcpServers;
    const totalCount = servers.length;
    const connectedCount = registry?.getConnectedCount() ?? 0;
    const statusBox = containerEl.createDiv({ cls: 'superpower-inside-mcp-status-box' });
    const headerRow = statusBox.createDiv({ cls: 'superpower-inside-mcp-status-header-row' });
    headerRow.createDiv({
      cls: 'superpower-inside-mcp-status-title',
      text: t('mcpConnectionHealth'),
    });
    const actionsRow = headerRow.createDiv({ cls: 'superpower-inside-mcp-status-actions' });
    const refreshBtn = actionsRow.createEl('button', {
      cls: 'superpower-inside-mcp-refresh-btn',
      attr: { 'aria-label': t('settingsAuto269') },
    });
    setIcon(refreshBtn, 'refresh-cw');
    this.mcpStatusRefresh = new RefreshAction({
      action: async (_signal) => {
        if (plugin.reconnectMCP) {
          const errors = await plugin.reconnectMCP();
          containerEl.empty();
          this.renderMCPStatus(containerEl);
          if (errors.length > 0) {
            const errorDetails = errors.map((err) => `• ${err}`).join('\n');
            new Notice(t('settingsAuto227', { v0: String(errorDetails) }), 10000);
            return {
              status: 'partial',
              detail: t('settingsAuto270', { v0: String(errors.length) }),
            };
          }
          this.plugin.refreshBus.emit('mcp', { status: 'success' });
          return { status: 'success' };
        }
        return { status: 'error', detail: t('settingsAuto271') };
      },
      loadingText: t('settingsAuto272'),
      spinnerClass: 'spinning',
      successNotice: t('settingsAuto273'),
      errorNotice: false,
    });
    this.mcpStatusRefresh.attach(refreshBtn);
    const countEl = statusBox.createDiv({ cls: 'superpower-inside-mcp-status-count' });
    const state = plugin.mcpConnectionState ?? 'idle';
    const statusText =
      state === 'connecting'
        ? `${t('mcpConnecting')} | ${t('mcpConnected')}: ${connectedCount} | ${t('totalLabel')}: ${totalCount}`
        : state === 'partial-error'
          ? `${t('mcpPartialError')} | ${t('mcpConnected')}: ${connectedCount} | ${t('totalLabel')}: ${totalCount}`
          : state === 'error'
            ? `${t('mcpConnectionFailed')} | ${t('totalLabel')}: ${totalCount}`
            : registry
              ? `${t('mcpConnected')}: ${connectedCount} | ${t('totalLabel')}: ${totalCount}`
              : t('mcpTotalActive', { count: connectedCount, total: totalCount });
    countEl.setText(statusText);
    if (totalCount > 0) {
      const list = statusBox.createDiv({ cls: 'superpower-inside-mcp-status-list' });
      for (const server of servers) {
        const item = list.createDiv({ cls: 'superpower-inside-mcp-status-item' });
        let status: MCPServerConnectionStatus = 'disconnected';
        if (registry) {
          status = registry.getConnectionStatus(server.name);
        }
        item.createDiv({ cls: `superpower-inside-mcp-status-dot ${status}` });
        item.createSpan({ text: server.name, cls: 'superpower-inside-mcp-status-name' });
        const labelText =
          status === 'connected'
            ? t('mcpStatusConnected')
            : status === 'connecting'
              ? t('mcpStatusConnecting')
              : status === 'error'
                ? t('mcpStatusError')
                : t('mcpStatusDisconnected');
        item.createSpan({
          text: labelText,
          cls: `superpower-inside-mcp-status-label ${status}`,
        });
        const error = registry?.getLastError(server.name);
        if (error) {
          item.createDiv({
            text: error,
            cls: 'superpower-inside-mcp-status-error-detail',
          });
        }
      }
    }
  }
  private unregisterMcpStatusEvent(): void {
    if (!this.mcpStatusEventRef) return;
    this.app.workspace.offref(this.mcpStatusEventRef);
    this.mcpStatusEventRef = null;
  }
}
export interface ChatModelOption {
  value: string;
  label: string;
}
export function buildChatModelOptions(
  settings: SuperpowerInsideSettings,
  options: {
    currentModel: string;
    includeEmpty?: boolean;
    emptyLabel?: string;
  },
): ChatModelOption[] {
  const result: ChatModelOption[] = [];
  if (options.includeEmpty) {
    result.push({ value: '', label: options.emptyLabel ?? t('settingsAuto008') });
  }
  const providers = [
    { key: 'openai', prefix: 'openai', label: PROVIDER_LABELS.openai, config: settings.openai },
    { key: 'claude', prefix: 'claude', label: PROVIDER_LABELS.claude, config: settings.claude },
    { key: 'ollama', prefix: 'ollama', label: PROVIDER_LABELS.ollama, config: settings.ollama },
    {
      key: 'ollamaCloud',
      prefix: 'ollamaCloud',
      label: PROVIDER_LABELS.ollamaCloud,
      config: settings.ollamaCloud,
    },
    {
      key: 'openRouter',
      prefix: 'openRouter',
      label: PROVIDER_LABELS.openRouter,
      config: settings.openRouter,
    },
  ] as const;
  for (const { prefix, label, config } of providers) {
    if (!config.enabled) continue;
    for (const model of config.models) {
      const value = `${prefix}:${model}`;
      result.push({ value, label: `${label} — ${model}` });
    }
  }
  for (const provider of settings.customOpenAIProviders) {
    if (!provider.enabled) continue;
    const providerLabel = provider.name.trim() || 'Custom OpenAI-Compatible';
    for (const model of provider.models) {
      const value = `customOpenAI:${provider.id}:${model}`;
      result.push({ value, label: `${providerLabel} — ${model}` });
    }
  }
  const current = options.currentModel.trim();
  if (current && !result.some((o) => o.value === current)) {
    result.push({ value: current, label: t('settingsAuto274', { v0: String(current) }) });
  }
  return result;
}
