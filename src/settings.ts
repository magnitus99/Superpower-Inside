import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
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
import { IndexedDbVectorStore, JsonFileVectorStore, type VectorStore } from './rag/store';
import { isIndexingCancelledError, type IndexingResult, type VaultIndexer } from './rag/indexer';
import type { RAGIndexingScheduler } from './rag/indexing-scheduler';
import type { PerformanceGuardState } from './rag/performance-guard';
import { calculateRagStatus, type RagDocumentUpdate, type RagStatusSummary } from './rag/status';
import {
  buildEmbeddingModelOptions,
  getRagIndexingControlState,
  getChatFolderExcludeDescription,
  getVectorStoreTransferNotice,
  getVectorStoreDescription,
  getVectorStoreLabel,
  resolveRagPerformanceSettings,
  type RagPerformanceTuningMode,
  type VectorStoreType,
  shouldShowProviderApiKey,
} from './rag/settings-display';
import {
  createDefaultPromptEntry,
  createPromptEntry,
  getActivePromptEntry,
  type PromptLibraryEntry,
} from './chat/prompt-library';
import { openPromptLibraryModal } from './chat/prompt-library-modal';
import {
  validateExcludeExtensionInput,
  validateExcludePathInput,
  type ExcludeValidationIssue,
  type ExcludeValidationResult,
} from './utils/rag-exclude-validation';
import { countFilesByExtensions, getRagFileTypeSummary } from './utils/vault';
import { type Language, t } from './i18n';
import {
  createDefaultContext7McpServer,
  shouldShowPluginAwareContext7Warning,
} from './mcp/context7';

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

export const EMBEDDING_MODELS: Record<BuiltInEmbeddingProviderKey, EmbeddingModelInfo[]> = {
  openai: [
    {
      id: 'text-embedding-3-small',
      name: 'text-embedding-3-small',
      dimensions: 1536,
      description: '가장 널리 쓰이는 기본 모델. 성능과 비용의 균형이 뛰어납니다.',
    },
    {
      id: 'text-embedding-3-large',
      name: 'text-embedding-3-large',
      dimensions: 3072,
      description: '최고 성능 모델. 다국어와 복잡한 문맥에 강점이 있습니다.',
    },
  ],
  openRouter: [
    {
      id: 'openai/text-embedding-3-small',
      name: 'OpenAI text-embedding-3-small (via OpenRouter)',
      dimensions: 1536,
      description: 'OpenRouter 경유. 동일 품질, OpenRouter API 키 사용.',
    },
    {
      id: 'baai/bge-m3',
      name: 'BAAI bge-m3',
      dimensions: 1024,
      description: '다국어(한국어 포함) 최적화. 8K 컨텍스트.',
    },
    {
      id: 'qwen/qwen3-embedding-8b',
      name: 'Qwen3 Embedding 8B',
      dimensions: 1024,
      description: '32K 컨텍스트 지원. 긴 문서에 적합.',
    },
  ],
  ollama: [
    {
      id: 'nomic-embed-text',
      name: 'nomic-embed-text',
      dimensions: 768,
      description: 'Ollama 기본 임베딩 모델. 로컬 설치 필요.',
    },
  ],
  other: [],
};

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
  vectorStoreType: 'json' | 'indexeddb';
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
    excludePaths: ['.git', 'node_modules', '.obsidian', 'attachments'],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    excludeChatFolder: true,
    chunkSize: 1000,
    overlap: 100,
    vectorStoreType: 'indexeddb',
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
};
export interface PluginLike {
  app: App;
  settings: SuperpowerInsideSettings;
  saveSettings(): Promise<{ success: boolean; mcpErrors?: string[] }>;
  reconnectMCP(): Promise<string[]>;
  setupAutoUpdate(): void;
  initRAG(): Promise<void>;
  isRagIndexing(): boolean;
  cancelRagIndexing(): void;
  runRagIndexing<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null>;
  resumeRagIndexing(): void;
  getRagPerformanceGuardState(): PerformanceGuardState | null;
  mcpRegistry: MCPRegistry | null;
  mcpConnectionState?: MCPConnectionState;
  mcpLastErrors?: string[];
  eventDrivenRagStats?: RagStatusSummary | null;
  nextAutoUpdateAt?: number | null;
  lastAutoUpdateSkippedReason?: string | null;
  lastAutoUpdateResult?: IndexingResult | null;
}

// 탭 타입 및 설정
type SettingsTabId = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced';

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'general', label: t('tabGeneral') },
  { id: 'providers', label: t('tabProviders') },
  { id: 'rag', label: t('tabRag') },
  { id: 'chat', label: t('tabChat') },
  { id: 'mcp', label: t('tabMcp') },
  { id: 'advanced', label: t('tabAdvanced') },
];

interface ProviderValidationCache {
  [key: string]: {
    valid: boolean;
    models: string[];
    error?: string;
  };
}

type ProviderSettingsTarget =
  | { kind: 'fixed'; key: ProviderKey; label: string; config: ProviderConfig }
  | { kind: 'custom'; key: string; label: string; config: CustomOpenAIProviderConfig };

export class SuperpowerInsideSettingTab extends PluginSettingTab {
  private plugin: PluginLike;
  private mcpStatusEventRef: EventRef | null = null;

  private activeTab: SettingsTabId = 'general';
  private tabButtons: Map<SettingsTabId, HTMLButtonElement> = new Map();
  private tabPanels: Map<SettingsTabId, HTMLDivElement> = new Map();

  private validationCache: ProviderValidationCache = {};

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSave = false;

  private pendingEmbeddingProvider: EmbeddingProviderKey | null = null;
  private pendingEmbeddingModel: string | null = null;

  // RefreshAction 인스턴스 (생명주기 == 탭 활성화 기간)
  private ragStatusRefresh: RefreshAction | null = null;
  private mcpStatusRefresh: RefreshAction | null = null;
  private modelListRefresh: RefreshAction | null = null;
  private excludeCountRefresh: RefreshAction | null = null;
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
  // RefreshBus 구독 해제 함수들
  private refreshBusUnsubscribers: (() => void)[] = [];

  constructor(app: App, plugin: PluginLike) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }

  debouncedSave(): void {
    if (!this.plugin.settings.autoSaveEnabled) {
      void this.saveSettingsWithFeedback();
      return;
    }

    this.pendingSave = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.pendingSave = false;
      void this.saveSettingsWithFeedback();
    }, this.plugin.settings.autoSaveDebounceMs);
  }

  flushSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.pendingSave) {
      this.pendingSave = false;
      void this.saveSettingsWithFeedback();
    }
  }

  private async saveSettingsWithFeedback(): Promise<void> {
    try {
      const result = await this.plugin.saveSettings();
      if (result.success) {
        new Notice(t('autoSaveSuccessNotice'));
        return;
      }

      if (result.mcpErrors && result.mcpErrors.length > 0) {
        new Notice(t('autoSaveMcpFailedNotice', { count: result.mcpErrors.length }), 7000);
        return;
      }

      new Notice(t('autoSaveFailedNotice', { message: t('autoSaveUnknownError') }), 7000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('autoSaveFailedNotice', { message }), 7000);
    }
  }

  hide(): void {
    this.unregisterMcpStatusEvent();
    // RefreshAction 인스턴스 정리
    this.ragStatusRefresh?.detach();
    this.ragStatusRefresh = null;
    this.mcpStatusRefresh?.detach();
    this.mcpStatusRefresh = null;
    this.modelListRefresh?.detach();
    this.modelListRefresh = null;
    this.excludeCountRefresh?.detach();
    this.excludeCountRefresh = null;
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
      new Notice(
        '임베딩 설정 변경이 취소되었습니다. (설정 탭을 닫으면서 저장되지 않은 변경사항은 버려집니다)',
      );
    }
    this.flushSave();
    super.hide();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // RefreshBus 구독: RAG 이벤트 수신 시 부분 업데이트
    const plugin = this.plugin as unknown as { refreshBus?: { on: (domain: string, handler: (result: { status: string; detail?: string }) => void) => () => void } };
    if (plugin.refreshBus) {
      this.refreshBusUnsubscribers.push(
        plugin.refreshBus.on('rag', (result) => {
          this.updateRagStats(result.detail);
        }),
      );
    }

    // 헤더
    containerEl.createEl('h2', { text: t('settingsTitle') });

    // 보안 경고
    const warning = containerEl.createDiv({
      cls: 'superpower-inside-settings-warning',
    });
    warning.setText(t('securityWarning'));

    // 탭 바
    const tabBar = containerEl.createDiv({ cls: 'superpower-inside-settings-tabs' });
    TABS.forEach((tab) => {
      const button = tabBar.createEl('button', {
        text: tab.label,
        cls: 'superpower-inside-settings-tab',
      });
      this.tabButtons.set(tab.id, button);
      button.addEventListener('click', () => this.switchTab(tab.id));
    });

    // 탭 콘텐츠 패널
    const tabContentContainer = containerEl.createDiv();
    TABS.forEach((tab) => {
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
    }
  }

  private refreshGeneralTab(): void {
    this.repopulateDefaultModelDropdown();
  }

  /** General 탭의 기본 모델 dropdown만 다시 채웁니다 (full rebuild 대신). */
  private repopulateDefaultModelDropdown(): void {
    const generalPanel = this.tabPanels.get('general');
    if (!generalPanel) return;

    const dropdown = generalPanel.querySelector<HTMLSelectElement>(
      '.setting-item:has(.setting-item-name:has-text("기본 모델")) select, .setting-item:has(.setting-item-name:has-text("Default Model")) select',
    );
    if (!dropdown) return;

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

    // RefreshBus로 모델 이벤트 발행 (채팅 뷰 동기화)
    const pluginWithBus = this.plugin as unknown as { refreshBus?: { emit: (domain: string, result: { status: string; detail?: string }) => void } };
    pluginWithBus.refreshBus?.emit('models', { status: 'success' });
  }

  private buildGeneralTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName(t('autoSaveSettings'))
      .setDesc(t('autoSaveSettingsDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoSaveEnabled).onChange(async (value) => {
          this.plugin.settings.autoSaveEnabled = value;
          await this.saveSettingsWithFeedback();
        }),
      );

    new Setting(containerEl)
      .setName(t('autoSaveDelay'))
      .setDesc(t('autoSaveDelayDesc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setValue(String(this.plugin.settings.autoSaveDebounceMs));
        const unit = document.createElement('span');
        unit.textContent = ` ${t('delayMs')}`;
        unit.style.marginLeft = '6px';
        unit.style.color = 'var(--text-muted)';
        unit.style.fontSize = 'var(--font-ui-small)';
        text.inputEl.parentElement?.appendChild(unit);
        text.onChange((value) => {
          const num = parseInt(value, 10);
          if (!Number.isNaN(num) && num >= 0 && num <= 5000) {
            this.plugin.settings.autoSaveDebounceMs = num;
            this.debouncedSave();
          }
        });
      });

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

    allModels.sort((a, b) => a.label.localeCompare(b.label, 'en'));

    new Setting(containerEl)
      .setName(t('defaultModel'))
      .setDesc(t('defaultModelDesc'))
      .addDropdown((dropdown) => {
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
      })
      .addButton((button) => {
        button.setButtonText('새로고침');
        button.setTooltip(t('refreshModelList'));
        // RefreshAction을 버튼에 연결
        this.modelListRefresh = new RefreshAction({
          action: (_signal) => {
            void _signal;
            this.repopulateDefaultModelDropdown();
            return Promise.resolve({ status: 'success' } as const);
          },
          loadingText: '새로고침 중...',
          spinnerClass: 'spinning',
          successNotice: false,
        });
        this.modelListRefresh.attach(button.buttonEl);
      });
  }

  private buildProvidersTab(containerEl: HTMLElement): void {
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
    this.buildRagStatusPanel(containerEl);
    this.buildControlsSection(containerEl);
    this.buildEmbeddingProviderSection(containerEl);
    this.buildExcludeOptionsSection(containerEl);
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
      text: '고급 설정/진단',
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
    header.createDiv({ cls: 'superpower-inside-rag-section-title', text: 'RAG 상태' });
    const refreshButton = header.createEl('button', {
      cls: 'superpower-inside-rag-status-refresh-btn',
      text: '새로고침',
      attr: { type: 'button' },
    });

    const rag = this.plugin.settings.rag;
    const statusGrid = section.createDiv({ cls: 'superpower-inside-rag-status-grid' });
    const actionEl = section.createDiv({ cls: 'superpower-inside-rag-status-action' });
    const detailsEl = section.createDiv({ cls: 'superpower-inside-rag-status-details' });

    const warning = this.getRagSetupWarning();
    if (warning) {
      section.createDiv({ cls: 'superpower-inside-settings-warning', text: warning });
    }

    const vectorStoreTransferWarningEl = section.createDiv();
    void this.renderVectorStoreTransferWarning(vectorStoreTransferWarningEl, rag.vectorStoreType);

    const timestampEl = section.createDiv({
      cls: 'superpower-inside-rag-status-timestamp',
      text: '상태 계산 중...',
    });
    // DOM 참조 저장 (부분 업데이트용)
    this.ragStatusGrid = statusGrid;
    this.ragStatusAction = actionEl;
    this.ragStatusDetails = detailsEl;
    this.ragStatusTimestamp = timestampEl;

    this.ragStatusRefresh = new RefreshAction({
      action: async (signal) => {
        try {
          const status = await this.getRagStatus(signal);
          if (status) {
            timestampEl.setText(
              `마지막 상태 계산: ${new Date(status.lastCalculatedAt).toLocaleString()}`,
            );
            return { status: 'success' };
          }
          timestampEl.setText(
            'RAG 인덱서가 초기화되지 않아 상태를 계산할 수 없습니다.',
          );
          return { status: 'error', detail: '인덱서 미초기화' };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          timestampEl.setText(`상태를 불러오지 못했습니다: ${msg}`);
          return { status: 'error', detail: msg };
        }
      },
      loadingText: '새로고침 중...',
      spinnerClass: 'spinning',
    });
    this.ragStatusRefresh.attach(refreshButton);
    // 자동 갱신은 백그라운드 타이머에서 처리
    void this.updateRagStats();
  }

  private createRagStatusItem(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({ cls: 'superpower-inside-rag-status-item' });
    item.createDiv({ cls: 'superpower-inside-rag-status-label', text: label });
    item.createDiv({ cls: 'superpower-inside-rag-status-value', text: value });
  }

  private getIndexingStatusLabel(): string {
    const plugin = this.plugin as unknown as {
      ragIndexingStatus?: { running: boolean; phase: string; queuedFiles: number; lastResult?: { indexed: number; vectors: number } | null };
    };
    const status = plugin.ragIndexingStatus;
    if (!status) return this.plugin.isRagIndexing() ? '인덱싱 중' : '대기 중';
    if (status.running) {
      return `인덱싱 중: ${status.phase}, 대기 ${status.queuedFiles}개`;
    }
    if (status.lastResult) {
      return `${status.lastResult.indexed}개 문서, ${status.lastResult.vectors}개 벡터`;
    }
    return '대기 중';
  }

  private buildEmbeddingProviderSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '임베딩 프로바이더' });

    const rag = this.plugin.settings.rag;

    const effectiveProvider = this.pendingEmbeddingProvider ?? rag.embeddingProvider;
    const effectiveModel = this.pendingEmbeddingModel ?? rag.embeddingModel;

    const builtInProvider = isCustomOpenAIEmbeddingProviderKey(effectiveProvider)
      ? null
      : effectiveProvider;
    const modelsForProvider = builtInProvider ? EMBEDDING_MODELS[builtInProvider] : [];
    const isOther = effectiveProvider === 'other';
    const providerModels = isOther ? [] : this.getEmbeddingProviderModels(effectiveProvider);
    const modelOptions = isOther
      ? []
      : buildEmbeddingModelOptions(modelsForProvider, providerModels, effectiveModel);
    const isPending = this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null;

    const providerNotice = section.createDiv({ cls: 'superpower-inside-model-description' });
    providerNotice.setText(
      'API 키는 Providers 탭에서 설정한 값을 사용합니다. 여기서는 임베딩 전용 모델만 선택하세요.',
    );

    if (isPending) {
      const warningEl = section.createDiv({ cls: 'superpower-inside-settings-warning' });
      warningEl.setText(
        '⚠️ 임베딩 프로바이더/모델 변경은 자동으로 저장되지 않습니다. "저장" 버튼을 클릭해야 적용됩니다. 변경 시 기존 임베딩 데이터가 삭제되지 않습니다. 새 모델을 모든 데이터에 적용하려면 "전체 재인덱싱"을 실행하세요.',
      );
      warningEl.style.marginBottom = '12px';
      warningEl.style.whiteSpace = 'normal';
    }

    new Setting(section)
      .setName(t('embeddingProvider'))
      .setDesc('임베딩에 사용할 프로바이더를 선택하세요')
      .addDropdown((dropdown) => {
        for (const option of buildEmbeddingProviderOptions(
          this.plugin.settings.customOpenAIProviders,
        )) {
          dropdown.addOption(option.value, option.label);
        }
        dropdown.setValue(effectiveProvider);
        dropdown.onChange((value) => {
          const nextProvider = value as EmbeddingProviderKey;
          this.pendingEmbeddingProvider = nextProvider;
          if (nextProvider === 'other') {
            this.pendingEmbeddingModel = '';
          } else {
            const nextBuiltInProvider = isCustomOpenAIEmbeddingProviderKey(nextProvider)
              ? null
              : nextProvider;
            const nextModels = buildEmbeddingModelOptions(
              nextBuiltInProvider ? EMBEDDING_MODELS[nextBuiltInProvider] : [],
              this.getEmbeddingProviderModels(nextProvider),
              '',
            );
            this.pendingEmbeddingModel = nextModels[0]?.id ?? '';
          }
          section.remove();
          this.buildEmbeddingProviderSection(containerEl);
        });
      });

    if (isOther) {
      new Setting(section)
        .setName(t('embeddingModelId'))
        .setDesc('임베딩 모델 ID를 직접 입력하세요')
        .addText((text) =>
          text
            .setValue(effectiveModel)
            .setPlaceholder('예: my-custom-model')
            .onChange((value) => {
              this.pendingEmbeddingModel = value.trim();
            }),
        );
    } else if (modelOptions.length > 0) {
      new Setting(section)
        .setName(t('embeddingModel'))
        .setDesc('사용할 임베딩 모델을 선택하세요')
        .addDropdown((dropdown) => {
          for (const model of modelOptions) {
            dropdown.addOption(model.id, model.label);
          }
          dropdown.setValue(effectiveModel);
          dropdown.onChange((value) => {
            this.pendingEmbeddingModel = value;
            section.remove();
            this.buildEmbeddingProviderSection(containerEl);
          });
        });

      const selectedModel = modelOptions.find((m) => m.id === effectiveModel);
      const descEl = section.createDiv({ cls: 'superpower-inside-model-description' });
      descEl.setText(selectedModel?.description ?? '');
    }

    if (!isOther) {
      new Setting(section)
        .setName('모델 목록 새로고침')
        .setDesc('Providers 탭의 현재 모델 구성을 다시 읽어 임베딩 모델 목록에 반영합니다.')
        .addButton((button) => {
          button.setButtonText('새로고침');
          const embRefresh = new RefreshAction({
            action: (_signal) => {
              void _signal;
              section.remove();
              this.buildEmbeddingProviderSection(containerEl);
              return Promise.resolve({ status: 'success' } as const);
            },
            loadingText: '새로고침 중...',
            spinnerClass: 'spinning',
            successNotice: false,
          });
          embRefresh.attach(button.buttonEl);
        });
    }

    if (isPending) {
      const btnRow = section.createDiv({ cls: 'superpower-inside-rag-controls' });
      btnRow.style.marginTop = '8px';

      const saveBtn = btnRow.createEl('button', { text: '저장' });
      saveBtn.addEventListener('click', () => {
        void (async () => {
          if (this.pendingEmbeddingProvider !== null) {
            rag.embeddingProvider = this.pendingEmbeddingProvider;
          }
          if (this.pendingEmbeddingModel !== null) {
            rag.embeddingModel = this.pendingEmbeddingModel;
          }
          this.pendingEmbeddingProvider = null;
          this.pendingEmbeddingModel = null;
          await this.plugin.saveSettings();
          new Notice('임베딩 설정이 저장되었습니다.');
          section.remove();
          this.buildEmbeddingProviderSection(containerEl);
        })();
      });

      const cancelBtn = btnRow.createEl('button', { text: '취소' });
      cancelBtn.addEventListener('click', () => {
        this.pendingEmbeddingProvider = null;
        this.pendingEmbeddingModel = null;
        section.remove();
        this.buildEmbeddingProviderSection(containerEl);
      });
    }

    const statusEl = section.createDiv({ cls: 'superpower-inside-connection-status' });
    const getEmbeddingValidationConfig = (): ProviderConfig | CustomOpenAIProviderConfig =>
      effectiveProvider === 'other'
        ? { apiKey: '', models: [], enabled: false }
        : this.getEmbeddingProviderConfig(effectiveProvider) ?? {
            apiKey: '',
            models: [],
            enabled: false,
          };

    new Setting(section)
      .setName('연결 테스트')
      .setDesc('모델/태그 목록만 조회합니다. 임베딩 생성 요청을 보내지 않습니다.')
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
              statusEl.setText(`✅ 연결 성공! ${result.models.length}개 모델 확인됨`);
            } else {
              statusEl.setText(`❌ 연결 실패: ${result.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            statusEl.setText(`❌ 오류: ${msg}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    new Setting(section)
      .setName('임베딩 생성 테스트')
      .setDesc(
        '선택된 임베딩 모델로 실제 최소 요청을 보냅니다. 프로바이더에 따라 과금될 수 있습니다.',
      )
      .addButton((button) => {
        button.setButtonText('임베딩 생성 테스트');
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
              statusEl.setText(`✅ 임베딩 생성 성공: ${effectiveModel}`);
            } else {
              statusEl.setText(`❌ 임베딩 생성 실패: ${result.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            statusEl.setText(`❌ 오류: ${msg}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }

  private buildStatsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '인덱스 통계' });

    const grid = section.createDiv({ cls: 'superpower-inside-stats-grid' });

    // 통계 비동기 로드
    this.renderStats(grid).catch(() => {
      grid.setText('통계를 불러올 수 없습니다.');
    });

    // 새로고침 버튼
    new Setting(section).setName('').addButton((btn) => {
      btn.setButtonText('새로고침');
      const statsRefresh = new RefreshAction({
        action: async (_signal) => {
          grid.empty();
          await this.renderStats(grid);
          return { status: 'success' };
        },
        loadingText: '새로고침 중...',
        spinnerClass: 'spinning',
        successNotice: false,
      });
      statsRefresh.attach(btn.buttonEl);
    });
  }

  private async renderStats(gridEl: HTMLElement): Promise<void> {
    const status = await this.getRagStatus();
    if (!status) {
      gridEl.setText('RAG 인덱서가 초기화되지 않았습니다.');
      return;
    }

    const stats = [
      { value: String(status.totalDocuments), label: '전체 문서', desc: 'RAG 대상 파일' },
      { value: String(status.healthyDocuments), label: '정상', desc: '현재 벡터가 최신인 문서' },
      {
        value: String(status.updateRequiredDocuments.length),
        label: '업데이트 필요',
        desc: '미인덱싱/수정됨/확인 필요',
      },
      { value: String(status.totalVectors), label: '전체 벡터', desc: '저장된 임베딩 벡터 개수' },
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
    const refreshButton = header.createEl('button', {
      cls: 'superpower-inside-rag-status-refresh-btn',
      text: t('refresh'),
      attr: { type: 'button' },
    });
    const contentEl = section.createDiv({ cls: 'superpower-inside-rag-file-types' });

    const render = async (): Promise<void> => {
      contentEl.empty();
      contentEl.setText('파일 형식을 계산하는 중...');
      refreshButton.disabled = true;
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
        contentEl.setText(`파일 형식을 불러오지 못했습니다: ${msg}`);
      } finally {
        refreshButton.disabled = false;
      }
    };

    refreshButton.addEventListener('click', () => {
      void render();
    });
    void render();
  }

  private renderTargetFileTypeCounts(
    containerEl: HTMLElement,
    targetTypes: { extension: string; label: string; count: number }[],
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
      card.createDiv({ cls: 'superpower-inside-rag-file-type-count', text: `${item.count}개` });
    }
  }

  private renderExcludeRecommendations(
    containerEl: HTMLElement,
    recommendations: { extension: string; label: string; count: number; reason: string }[],
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
        text: `${item.label} · ${item.count}개`,
      });
      body.createDiv({ cls: 'superpower-inside-rag-recommendation-reason', text: item.reason });

      if (item.extension === '(none)') continue;
      const button = row.createEl('button', {
        cls: 'superpower-inside-rag-recommendation-add',
        text: t('addExcludeExtension'),
        attr: { type: 'button' },
      });
      button.addEventListener('click', () => {
        const normalized = item.extension.trim().toLowerCase();
        if (!this.plugin.settings.rag.excludeExts.includes(normalized)) {
          this.plugin.settings.rag.excludeExts.push(normalized);
          this.debouncedSave();
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
      this.ragStatusTimestamp!.setText(indexingDetail ? `현재 상태: ${indexingDetail}` : '상태 계산 중...');
      try {
        const status = await this.getRagStatus();
        if (status) {
          this.renderRagStatusSummary(status, indexingDetail);
          this.ragStatusTimestamp!.setText(
            indexingDetail
              ? `현재 상태: ${indexingDetail} · 마지막 상태 계산: ${new Date(status.lastCalculatedAt).toLocaleString()}`
              : `마지막 상태 계산: ${new Date(status.lastCalculatedAt).toLocaleString()}`,
          );
        }
        this.updateRagControlStates(status ?? null);
        // RAG 통계 섹션도 부분 업데이트
        this.updateRagStatsSection();
        this.updateRagUpdateList();
      } catch {
        this.ragStatusTimestamp!.setText('통계를 불러올 수 없습니다.');
      }
    })();
  }

  private renderRagStatusSummary(status: RagStatusSummary, indexingDetail?: string): void {
    if (!this.ragStatusGrid || !this.ragStatusAction || !this.ragStatusDetails) return;
    const rag = this.plugin.settings.rag;
    const guardState = this.plugin.getRagPerformanceGuardState();
    const updateCount = status.updateRequiredDocuments.length;

    this.ragStatusGrid.empty();
    this.createRagStatusItem(this.ragStatusGrid, '현재 상태', indexingDetail ?? this.getIndexingStatusLabel());
    this.createRagStatusItem(this.ragStatusGrid, '필요 작업', this.getRagNextActionLabel(status, guardState));
    this.createRagStatusItem(this.ragStatusGrid, '업데이트 필요', `${updateCount}개`);
    this.createRagStatusItem(this.ragStatusGrid, '자동 업데이트', this.getAutoUpdateLabel());

    this.ragStatusAction.empty();
    this.ragStatusAction.setText(this.getRagActionMessage(status, guardState));

    this.ragStatusDetails.empty();
    const detailItems = [
      `임베딩: ${this.getEmbeddingProviderLabel(rag.embeddingProvider)} / ${rag.embeddingModel || '미설정'}`,
      `저장소: ${getVectorStoreLabel(rag.vectorStoreType)}`,
      `성능 보호: ${this.getPerformanceGuardLabel(guardState)}`,
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
    if (this.plugin.isRagIndexing()) return '진행 중인 인덱싱 확인';
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      return `약 ${Math.ceil((guardState.remainingPauseMs ?? 0) / 1000)}초 후 재개`;
    }
    if (status.updateRequiredDocuments.length > 0) return '필요 문서 업데이트';
    if (status.totalDocuments > 0) return '필요 시 전체 재인덱싱';
    return 'RAG 대상 문서 없음';
  }

  private getRagActionMessage(
    status: RagStatusSummary,
    guardState: PerformanceGuardState | null,
  ): string {
    if (this.plugin.isRagIndexing()) {
      return '인덱싱이 실행 중입니다. 오래 걸리거나 Obsidian이 느려지면 중단할 수 있습니다.';
    }
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      return `성능 보호 때문에 잠시 대기 중입니다. 원인: ${guardState.lastSlowReason ?? guardState.reason ?? '느린 인덱싱 감지'}`;
    }
    const updateCount = status.updateRequiredDocuments.length;
    if (updateCount > 0) return `${updateCount}개 문서가 검색 품질에 반영되지 않았습니다. 필요 문서 업데이트를 실행하세요.`;
    if (status.totalDocuments > 0) return '현재 인덱스는 최신입니다. 모델이나 저장소를 바꾼 경우에만 전체 재인덱싱이 필요합니다.';
    return '현재 설정 기준으로 RAG 대상 문서가 없습니다. 제외 경로나 파일 형식을 확인하세요.';
  }

  private getAutoUpdateLabel(): string {
    if (!this.plugin.settings.rag.autoUpdateEnabled) return '꺼짐';
    if (this.plugin.lastAutoUpdateSkippedReason) return `켜짐 · ${this.plugin.lastAutoUpdateSkippedReason}`;
    return '켜짐';
  }

  private getAutoUpdateDetail(): string | null {
    if (!this.plugin.settings.rag.autoUpdateEnabled) return null;
    const details: string[] = [];
    if (this.plugin.nextAutoUpdateAt) {
      details.push(`다음 자동 업데이트: ${new Date(this.plugin.nextAutoUpdateAt).toLocaleString()}`);
    }
    if (this.plugin.lastAutoUpdateResult) {
      details.push(
        `마지막 자동 업데이트: ${this.plugin.lastAutoUpdateResult.indexed}개 문서, ${this.plugin.lastAutoUpdateResult.vectors}개 벡터`,
      );
    }
    if (this.plugin.lastAutoUpdateSkippedReason) {
      details.push(`최근 건너뜀: ${this.plugin.lastAutoUpdateSkippedReason}`);
    }
    return details.length > 0 ? details.join(' · ') : null;
  }

  private getPerformanceGuardLabel(guardState: PerformanceGuardState | null): string {
    if (!guardState) return '상태 없음';
    if (guardState.mode === 'paused') {
      return `대기 중 · 약 ${Math.ceil((guardState.remainingPauseMs ?? 0) / 1000)}초 남음`;
    }
    if (guardState.mode === 'throttled') {
      return `속도 조절 중 · 배치 ${guardState.currentBatchSize}, 대기 ${guardState.currentYieldMs}ms`;
    }
    return `정상 · 배치 ${guardState.currentBatchSize}, 대기 ${guardState.currentYieldMs}ms`;
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
      updateList.setText('문서 상태를 확인하는 중...');
      void this.getRagStatus().then((status) => {
        updateList.empty();
        if (!status) {
          updateList.setText('RAG 인덱서가 초기화되지 않아 문서 목록을 계산할 수 없습니다.');
          return;
        }
        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          updateList.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: '업데이트가 필요한 문서가 없습니다.',
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
      text: '업데이트가 필요한 문서',
    });

    const listEl = section.createDiv({ cls: 'superpower-inside-rag-update-list' });
    listEl.setText('문서 상태를 확인하는 중...');

    void this.getRagStatus()
      .then((status) => {
        listEl.empty();
        if (!status) {
          listEl.setText('RAG 인덱서가 초기화되지 않아 문서 목록을 계산할 수 없습니다.');
          return;
        }

        const documents = status.updateRequiredDocuments;
        if (documents.length === 0) {
          listEl.createDiv({
            cls: 'superpower-inside-rag-empty-state',
            text: '업데이트가 필요한 문서가 없습니다.',
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
        listEl.setText(`문서 상태를 불러오지 못했습니다: ${msg}`);
      });
  }

  private formatRagUpdateSummary(documents: RagDocumentUpdate[]): string {
    const missingCount = documents.filter((document) => document.status === 'missing').length;
    const staleCount = documents.filter((document) => document.status === 'stale').length;
    const unknownCount = documents.filter((document) => document.status === 'unknown').length;
    return `${documents.length}개 문서에 업데이트가 필요합니다. 미인덱싱 ${missingCount}개, 수정됨 ${staleCount}개, 확인 필요 ${unknownCount}개. 아래에는 최대 10개만 표시됩니다.`;
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
    if (status === 'missing') return '미인덱싱';
    if (status === 'stale') return '수정됨';
    return '확인 필요';
  }

  private async getRagStatus(signal?: AbortSignal): Promise<RagStatusSummary | null> {
    // 캐시된 eventDrivenRagStats가 있으면 우선 사용 (백그라운드 타이머가 자동 갱신)
    if (this.plugin.eventDrivenRagStats) {
      return this.plugin.eventDrivenRagStats;
    }
    const p = this.plugin as unknown as { vectorStore?: VectorStore };
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

  private async renderVectorStoreTransferWarning(
    containerEl: HTMLElement,
    selectedType: VectorStoreType,
  ): Promise<void> {
    try {
      const notice = await this.getVectorStoreTransferWarning(selectedType);
      if (!notice) {
        containerEl.remove();
        return;
      }
      containerEl.addClass('superpower-inside-settings-warning');
      containerEl.setText(notice);
    } catch {
      containerEl.remove();
    }
  }

  private async getVectorStoreTransferWarning(
    selectedType: VectorStoreType,
  ): Promise<string | null> {
    const [jsonVectorCount, indexedDbVectorCount] = await Promise.all([
      this.getJsonVectorCount(),
      this.getIndexedDbVectorCount(),
    ]);
    return getVectorStoreTransferNotice(selectedType, jsonVectorCount, indexedDbVectorCount);
  }

  private async getJsonVectorCount(): Promise<number> {
    const store = new JsonFileVectorStore(
      this.plugin.app.vault.adapter,
      '.superpower-inside/vectors.json',
    );
    const stats = await store.getStats();
    return stats.totalVectors;
  }

  private async getIndexedDbVectorCount(): Promise<number> {
    const store = new IndexedDbVectorStore();
    const stats = await store.getStats();
    return stats.totalVectors;
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
        return `Providers 탭에서 "${label}"을 먼저 활성화하세요.`;
      }
      const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
        ? 'customOpenAI'
        : providerKey;
      if (shouldShowProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
        return `Providers 탭에서 "${label}" API Key를 입력하세요.`;
      }
    }
    if (!rag.embeddingModel.trim()) {
      return '임베딩 모델을 선택하고 저장하세요.';
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
        return `Providers 탭에서 "${label}"의 Enabled 토글을 켜주세요.`;
      }
      const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
        ? 'customOpenAI'
        : providerKey;
      if (shouldShowProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
        return `Providers 탭에서 "${label}"의 API Key를 입력하세요.`;
      }
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return `임베딩 모델이 선택되지 않았습니다. Embedding Provider 섹션에서 모델을 선택하고 "저장" 버튼을 클릭하세요.`;
      }
    } else {
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return `임베딩 모델 ID를 직접 입력하고 "저장" 버튼을 클릭하세요.`;
      }
    }
    return `프로바이더 "${this.getEmbeddingProviderLabel(providerKey)}"(${rag.embeddingModel}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.`;
  }

  private buildControlsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '인덱싱 제어' });

    const controls = section.createDiv({ cls: 'superpower-inside-rag-controls' });
    const p = this.plugin as unknown as {
      vaultIndexer?: VaultIndexer;
      vectorStore?: VectorStore;
      embeddingProvider?: { clearCache(): Promise<void> };
      ragIndexingScheduler?: RAGIndexingScheduler;
    };
    const hasIndexer = !!p.vaultIndexer && !!p.ragIndexingScheduler;
    const isIndexing = this.plugin.isRagIndexing();

    controls.createEl('button', { text: '필요 문서 업데이트' }, (btn) => {
      this.updatePendingButton = btn;
      btn.disabled = true;
      void this.getRagStatus().then((status) => {
        this.updateRagControlStates(status);
      });
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice('RAG 인덱서가 초기화되지 않았습니다. ' + this.diagnoseRAGInitFailure());
            return;
          }
          try {
            const status = await this.getRagStatus();
            if (!status || status.updateRequiredDocuments.length === 0) {
              return;
            }
            new Notice(`${status.updateRequiredDocuments.length}개 문서 업데이트 시작...`);
            const result = await p.ragIndexingScheduler!.indexPending();
            new Notice(`${result.indexed}개 문서 업데이트 완료, ${result.skipped}개 문서 스킵됨`);
            this.updateRagStats();
          } catch (err) {
            if (isIndexingCancelledError(err)) {
              new Notice('인덱싱이 중단되었습니다.');
              this.updateRagStats();
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`인덱싱 실패: ${msg}`);
          }
        })();
      });
    });

    controls.createEl('button', { text: '전체 재인덱싱' }, (btn) => {
      this.reindexAllButton = btn;
      btn.disabled = isIndexing || !hasIndexer;
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice('RAG 인덱서가 초기화되지 않았습니다. ' + this.diagnoseRAGInitFailure());
            return;
          }
          try {
            const status = await this.getRagStatus();
            if (!status || status.totalDocuments === 0) {
              return;
            }
            new Notice('전체 재인덱싱 시작...');
            const result = await p.ragIndexingScheduler!.reindexAll();
            new Notice(`${result.indexed}개 파일 재인덱싱 완료`);
            this.updateRagStats();
          } catch (err) {
            if (isIndexingCancelledError(err)) {
              new Notice('인덱싱이 중단되었습니다.');
              this.updateRagStats();
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`재인덱싱 실패: ${msg}`);
          }
        })();
      });
    });

    controls.createEl('button', { text: '인덱싱 중단' }, (btn) => {
      this.cancelIndexingButton = btn;
      btn.disabled = !isIndexing;
      btn.addEventListener('click', () => {
        this.plugin.cancelRagIndexing();
        this.updateRagStats();
      });
    });

    controls.createEl('button', { text: '지금 재개' }, (btn) => {
      this.resumeIndexingButton = btn;
      btn.disabled = true;
      btn.addEventListener('click', () => {
        this.plugin.resumeRagIndexing();
        this.updateRagStats();
      });
    });

    this.ragControlsHint = section.createDiv({
      cls: 'superpower-inside-rag-controls-hint',
      text: '버튼 상태를 확인하는 중...',
    });

    controls.createEl('button', { text: '임베딩 데이터 초기화' }, (btn) => {
      btn.disabled = isIndexing;
      btn.addEventListener('click', () => {
        void (async () => {
          if (!confirm('모든 임베딩 데이터를 삭제하시겠습니까? 복구할 수 없습니다.')) {
            return;
          }
          try {
            if (p.vectorStore) {
              await p.vectorStore.clear();
            }
            if (p.embeddingProvider) {
              await p.embeddingProvider.clearCache();
            }
            new Notice('모든 임베딩 데이터가 초기화되었습니다.');
            this.updateRagStats();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`초기화 실패: ${msg}`);
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
      this.ragControlsHint.setText(firstReason ?? '실행할 작업을 선택하세요.');
    }
  }

  private applyButtonState(
    button: HTMLButtonElement | null,
    state: { disabled: boolean; reason: string | null },
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
        const refreshButton = countMetaEl.createEl('button', {
          cls: 'superpower-inside-exclude-count-refresh-btn',
          text: countMeta.refreshLabel,
          attr: { type: 'button' },
        });
        this.excludeCountRefresh = new RefreshAction({
          action: (_signal) => {
            void _signal;
            itemCounts = countMeta.getCounts();
            renderList();
            return Promise.resolve({ status: 'success' } as const);
          },
          loadingText: '새로고침 중...',
          spinnerClass: 'spinning',
          successNotice: false,
        });
        this.excludeCountRefresh.attach(refreshButton);
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
      case 'extension-markdown':
        return t('excludeExtMarkdownWarning');
    }
  }

  private buildExcludeOptionsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '인덱싱 제외 대상' });

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
        this.debouncedSave();
      },
    });

    new Setting(section)
      .setName(t('excludeChatFolder'))
      .setDesc(getChatFolderExcludeDescription(this.plugin.settings.chat.saveFolder))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.excludeChatFolder).onChange((value) => {
          this.plugin.settings.rag.excludeChatFolder = value;
          this.debouncedSave();
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
        this.debouncedSave();
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
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '고급 인덱싱 옵션' });

    // 자동 업데이트 토글
    new Setting(section)
      .setName('자동 업데이트')
      .setDesc('설정된 간격으로 새 파일을 자동으로 인덱싱합니다')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.autoUpdateEnabled).onChange(async (value) => {
          this.plugin.settings.rag.autoUpdateEnabled = value;
          await this.plugin.saveSettings();
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
      .setName('성능 튜닝')
      .setDesc('기본값은 임베딩 프로바이더에 맞춰 자동으로 적용하고, 필요할 때만 직접 조정합니다.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', '자동')
          .addOption('custom', '수동')
          .setValue(this.plugin.settings.rag.performanceTuningMode)
          .onChange((value) => {
            this.plugin.settings.rag.performanceTuningMode =
              value === 'custom' ? 'custom' : 'auto';
            this.debouncedSave();
            section.remove();
            this.buildIndexingOptionsSection(containerEl);
          }),
      );

    if (this.plugin.settings.rag.performanceTuningMode !== 'custom') {
      const performanceSettings = resolveRagPerformanceSettings(this.plugin.settings.rag);
      section.createDiv({
        cls: 'superpower-inside-rag-performance-summary',
        text: `자동 적용 중: 배치 ${performanceSettings.maxEmbeddingBatchSize}, 대기 ${performanceSettings.indexingYieldMs}ms, 느림 감지 ${performanceSettings.slowEventLoopThresholdMs}ms/${performanceSettings.slowBatchThresholdMs}ms`,
      });
    }

    if (this.plugin.settings.rag.performanceTuningMode === 'custom') {
    new Setting(section)
      .setName('성능 보호')
      .setDesc('인덱싱 중 Obsidian이 느려지면 배치 크기와 대기 시간을 자동으로 조절합니다.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.rag.performanceGuardEnabled).onChange((value) => {
          this.plugin.settings.rag.performanceGuardEnabled = value;
          this.debouncedSave();
        }),
      );

    new Setting(section)
      .setName('임베딩 배치 크기')
      .setDesc('한 번에 임베딩 요청으로 보낼 청크 수입니다. Ollama 로컬 모델은 1을 권장합니다.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.maxEmbeddingBatchSize))
          .setPlaceholder(this.plugin.settings.rag.embeddingProvider === 'ollama' ? '1' : '32')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 1 || num > 128 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.maxEmbeddingBatchSize = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.max = '128';
      });

    new Setting(section)
      .setName('배치 사이 대기 시간(ms)')
      .setDesc('연속 인덱싱 배치 사이에 메인 스레드가 쉴 시간을 둡니다.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.indexingYieldMs))
          .setPlaceholder('25')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 0 || num > 1000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.indexingYieldMs = num;
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1000';
      });

    new Setting(section)
      .setName('느림 감지 임계값')
      .setDesc('이벤트 루프 지연(ms)과 배치 처리 시간(ms)을 기준으로 자동 완화를 시작합니다.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.slowEventLoopThresholdMs))
          .setPlaceholder('150')
          .onChange((value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isNaN(num) || num < 16 || num > 5000 || !Number.isInteger(num)) return;
            this.plugin.settings.rag.slowEventLoopThresholdMs = num;
            this.debouncedSave();
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
            this.debouncedSave();
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

    // 벡터 저장소 유형
    new Setting(section)
      .setName('벡터 저장소 유형')
      .setDesc(getVectorStoreDescription())
      .addDropdown((dropdown) =>
        dropdown
          .addOption('json', 'JSON File')
          .addOption('indexeddb', 'IndexedDB')
          .setValue(this.plugin.settings.rag.vectorStoreType)
          .onChange((value) => {
            const vectorStoreType = value as VectorStoreType;
            this.plugin.settings.rag.vectorStoreType = vectorStoreType;
            this.debouncedSave();
            void this.getVectorStoreTransferWarning(vectorStoreType)
              .then((notice) => {
                if (notice) new Notice(notice);
              })
              .catch(() => undefined);
          }),
      );
  }

  private buildSearchQualitySection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-rag-section' });
    section.createDiv({ cls: 'superpower-inside-rag-section-title', text: '검색 품질' });

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
            this.debouncedSave();
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
          void this.plugin.saveSettings().then(() => this.plugin.initRAG());
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
            this.debouncedSave();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1';
        text.inputEl.step = '0.05';
      });
  }

  private buildChatTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('chatSaveFolder'))
      .setDesc(t('chatSaveFolderDesc'))
      .addText((text) =>
        text.setValue(this.plugin.settings.chat.saveFolder).onChange((value) => {
          this.plugin.settings.chat.saveFolder = value.trim();
          this.debouncedSave();
        }),
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    const presetRow = containerEl.createDiv({ cls: 'superpower-inside-chat-presets' });
    const presets: { label: string; description: string; prompt: string }[] = [
      {
        label: '지식 연결',
        description: '노트 사이의 연결과 링크 후보를 우선 제안합니다.',
        prompt:
          '당신은 Obsidian 볼트 기반 지식 연결 보조자입니다. 제공된 Vault Context와 명시적 파일/폴더 멘션을 우선 근거로 삼으세요. Vault Context에 없는 문서명은 출처로 쓰지 말고, 연결할 만한 링크 후보와 새 노트 구조는 반드시 "제안"으로 분리하세요. 근거와 추론을 구분하고, 확실하지 않은 내용은 꾸며내지 마세요.',
      },
      {
        label: '출처 기반 답변',
        description: '볼트 컨텍스트의 출처와 한계를 분명히 드러냅니다.',
        prompt:
          '당신은 Obsidian 볼트의 출처 기반 답변 보조자입니다. Vault Context에 포함된 파일 경로와 헤딩을 우선 확인하고, 근거가 있는 주장과 사용자의 질문에서 추론한 내용을 분리하세요. 관련 컨텍스트가 부족하면 답을 꾸미지 말고 필요한 노트나 추가 질문을 요청하세요.',
      },
      {
        label: '연구 노트',
        description: '근거, 쟁점, 후속 질문을 연구 노트 형태로 정리합니다.',
        prompt:
          '당신은 Obsidian 연구 노트 보조자입니다. 사용자의 질문에 답할 때 핵심 주장, 근거, 반론 또는 불확실성, 후속 조사 질문을 구분하세요. Vault Context에 없는 문서명은 출처로 쓰지 말고, 볼트 안 관련 노트와 연결 후보는 "제안"으로 분리하세요. 연구 노트에 바로 붙일 수 있는 Markdown 구조로 답하세요.',
      },
      {
        label: '프로젝트 노트',
        description: '결정 사항, 작업 항목, 리스크를 분명히 나눕니다.',
        prompt:
          '당신은 Obsidian 프로젝트 노트 보조자입니다. 답변은 결정 사항, 작업 항목, 리스크, 다음 행동을 중심으로 구성하세요. Vault Context를 근거로 사용하고, Vault Context에 없는 문서명은 출처로 쓰지 마세요. 관련 프로젝트 노트 링크 후보와 후속 정리 위치는 "제안"으로 분리하세요.',
      },
      {
        label: '글쓰기 초안',
        description: '볼트의 기존 맥락을 살려 개요와 문단 전개를 돕습니다.',
        prompt:
          '당신은 Obsidian 글쓰기 보조자입니다. 볼트의 기존 노트 맥락과 사용자의 의도를 존중해 개요, 문단 전개, 제목 후보, 연결할 노트를 제안하세요. 사용자가 요청하지 않은 단순 요약이나 번역으로 흐르지 말고, 노트로 발전 가능한 초안을 만드세요.',
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
        new Notice(`${preset.label} 프리셋이 보관함에 저장되고 전역 기본값으로 적용되었습니다.`);
      });
    }

    const resetRow = containerEl.createDiv({ cls: 'superpower-inside-chat-presets' });
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
      new Notice('시스템 프롬프트가 초기화되었습니다.');
    });

    new Setting(containerEl)
      .setName(t('chatAutoSave'))
      .setDesc(t('chatAutoSaveDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.chat.autoSaveEnabled).onChange((value) => {
          this.plugin.settings.chat.autoSaveEnabled = value;
          this.debouncedSave();
        }),
      );

    new Setting(containerEl)
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

    new Setting(containerEl)
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
    const mcpSection = containerEl.createDiv();

    const pathHeader = mcpSection.createEl('div', {
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

    const pathContent = mcpSection.createDiv({
      cls: 'superpower-inside-mcp-collapsible-content',
    });

    const pathDesc = pathContent.createDiv({ cls: 'setting-item-description' });
    pathDesc.setText(t('mcpPathDesc'));

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
            throw new Error('MCP PATH 자동 조회는 Obsidian 데스크톱 앱에서만 사용할 수 있습니다.');
          }

          const { getDesktopLoginShellPath } = await import('./mcp/path');
          const output = getDesktopLoginShellPath({
            platform: Platform,
            includeWslPath: this.plugin.settings.mcpIncludeWslPath,
          });
          pathText.value = output;
          this.plugin.settings.mcpPath = output;
          await this.plugin.saveSettings();
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
        await this.plugin.saveSettings();
        new Notice(t('mcpJsonSaved'));
      })();
    });

    pathHeader.addEventListener('click', () => {
      const isExpanded = pathContent.style.display !== 'none';
      if (isExpanded) {
        pathContent.style.display = 'none';
        pathChevron.textContent = '▶';
        pathHeader.removeClass('is-expanded');
      } else {
        pathContent.style.display = 'block';
        pathChevron.textContent = '▼';
        pathHeader.addClass('is-expanded');
      }
    });

    pathContent.style.display = 'none';

    mcpSection.createDiv({ cls: 'superpower-inside-mcp-section-divider' });

    const statusSection = mcpSection.createDiv({ cls: 'superpower-inside-mcp-status' });
    this.renderMCPStatus(statusSection);
    this.unregisterMcpStatusEvent();
    this.mcpStatusEventRef = (this.app.workspace as unknown as Events).on(
      MCP_STATUS_CHANGE_EVENT,
      () => {
        this.renderMCPStatus(statusSection);
      },
    );

    mcpSection.createDiv({ cls: 'superpower-inside-mcp-section-divider' });
    mcpSection.createEl('h3', {
      text: t('mcpJsonEditor'),
      cls: 'superpower-inside-mcp-section-title',
    });

    const lintStatus = mcpSection.createDiv({ cls: 'superpower-inside-mcp-lint-status' });
    lintStatus.setText('');

    const defaultJson = buildMcpJsonEditorValue(this.plugin.settings.mcpServers);
    const jsonTextArea = mcpSection.createEl('textarea', {
      cls: 'superpower-inside-mcp-json-editor',
    });
    jsonTextArea.value = defaultJson;

    let lintTimeout: ReturnType<typeof setTimeout> | null = null;
    let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;

    const runLint = () => {
      lintStatus.setText(t('mcpJsonLinting'));
      lintStatus.removeClass('success');
      lintStatus.removeClass('error');

      if (lintTimeout) {
        clearTimeout(lintTimeout);
        lintTimeout = null;
      }
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = null;
      }

      lintTimeout = setTimeout(() => {
        lintTimeout = null;
        const result = validateMcpJson(jsonTextArea.value);

        if (result.valid) {
          lintStatus.setText('✅ ' + t('mcpJsonLintOk'));
          lintStatus.addClass('success');
          lintStatus.removeClass('error');

          autoSaveTimeout = setTimeout(() => {
            autoSaveTimeout = null;
            this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
            void (async () => {
              const saveResult = await this.plugin.saveSettings();
              if (saveResult.success) {
                lintStatus.setText('✅ ' + t('mcpJsonSaved'));
              } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
                lintStatus.setText(`⚠️ 저장됨, ${saveResult.mcpErrors.length}개 서버 연결 실패`);
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

    new Setting(mcpSection).addButton((btn) =>
      btn.setButtonText(t('save')).onClick(async () => {
        const result = validateMcpJson(jsonTextArea.value);
        if (result.valid) {
          this.plugin.settings.mcpServers = standardToInternal(result.data as StandardMcpConfig);
          const saveResult = await this.plugin.saveSettings();

          if (saveResult.success) {
            lintStatus.setText('✅ ' + t('mcpJsonSaved'));
            lintStatus.addClass('success');
            lintStatus.removeClass('error');
            new Notice(t('mcpJsonSaved'));
            jsonTextArea.value = JSON.stringify(result.data, null, 2);
          } else if (saveResult.mcpErrors && saveResult.mcpErrors.length > 0) {
            lintStatus.setText(
              `⚠️ 설정은 저장되었으나 ${saveResult.mcpErrors.length}개 서버 연결 실패`,
            );
            lintStatus.addClass('error');
            lintStatus.removeClass('success');

            const errorDetails = saveResult.mcpErrors.map((err) => `• ${err}`).join('\n');
            new Notice(`MCP 연결 오류:\n${errorDetails}`, 10000);
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

  private buildDetailedMcpError(rawError: string): { short: string; full: string } {
    if (rawError.includes(t('mcpJsonInvalidObject'))) {
      return {
        short: 'JSON 형식 오류',
        full: `❌ ${t('mcpJsonInvalidObject')}\n\n✅ 예시:\n  {\n    "mcpServers": {\n      "my-server": {\n        "command": "npx",\n        "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n      }\n    }\n  }`,
      };
    }
    if (rawError.includes(t('mcpJsonMissingMcpServers'))) {
      return {
        short: '"mcpServers" 키 누락',
        full: `❌ ${t('mcpJsonMissingMcpServers')}\n\n✅ 예시:\n  {\n    "mcpServers": { ... }\n  }`,
      };
    }
    if (rawError.includes(t('mcpJsonInvalidMcpServers'))) {
      return {
        short: '"mcpServers" 형식 오류',
        full: `❌ ${t('mcpJsonInvalidMcpServers')}\n\n✅ 예시:\n  {\n    "mcpServers": {\n      "server-name": { ... }\n    }\n  }`,
      };
    }
    if (rawError.includes(t('mcpJsonServerNeedsCommand'))) {
      return {
        short: '서버 설정 누락',
        full: `❌ ${t('mcpJsonServerNeedsCommand')}\n\n✅ 예시:\n  "my-server": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n  }`,
      };
    }
    if (rawError.includes(t('mcpJsonInvalidArgs'))) {
      return {
        short: '"args" 형식 오류',
        full: `❌ ${t('mcpJsonInvalidArgs')}\n\n✅ 예시:\n  "args": ["-y", "@modelcontextprotocol/server-filesystem"]`,
      };
    }
    if (rawError.includes(t('mcpJsonInvalidEnv'))) {
      return {
        short: '"env" 형식 오류',
        full: `❌ ${t('mcpJsonInvalidEnv')}\n\n✅ 예시:\n  "env": {\n    "API_KEY": "secret"\n  }`,
      };
    }

    if (rawError.includes('Unexpected token') || rawError.includes('JSON')) {
      return {
        short: 'JSON 문법 오류',
        full: `❌ JSON 문법 오류: ${rawError}\n\n확인 항목:\n• 마지막 속성 뒤에 쉼표(,)가 없는지\n• 따옴표(")가 짝을 이루는지\n• 중괄호({})와 대괄호([])가 짝을 이루는지`,
      };
    }
    return {
      short: rawError,
      full: `❌ 오류: ${rawError}`,
    };
  }

  private buildAdvancedTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('pluginAwareGeneration'))
      .setDesc(t('pluginAwareGenerationDesc'))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pluginAwareEnabled).onChange((value) => {
          this.plugin.settings.pluginAwareEnabled = value;
          this.debouncedSave();
        }),
      );

    containerEl.createDiv({
      cls: 'superpower-inside-settings-help',
      text: t('pluginAwareGenerationLimitNotice'),
    });

    if (
      shouldShowPluginAwareContext7Warning({
        pluginAwareEnabled: this.plugin.settings.pluginAwareEnabled,
        servers: this.plugin.settings.mcpServers,
      })
    ) {
      containerEl.createDiv({
        cls: 'superpower-inside-settings-warning',
        text: t('pluginAwareContext7MissingWarning'),
      });
    }
  }

  private buildProviderSettings(containerEl: HTMLElement, target: ProviderSettingsTarget): void {
    const { config, label } = target;
    const cacheKey = target.key;
    const section = containerEl.createDiv({
      cls: 'superpower-inside-settings-section superpower-inside-provider-card',
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
      new Setting(section).setName('표시 이름').addText((text) =>
        text
          .setPlaceholder('예: LM Studio')
          .setValue(target.config.name)
          .onChange((value) => {
            target.config.name = value.trim();
            this.debouncedSave();
          }),
      );

      new Setting(section).setName('OpenAI v1 Base URL').addText((text) =>
        text
          .setPlaceholder('예: http://localhost:1234/v1')
          .setValue(target.config.baseUrl ?? '')
          .onChange((value) => {
            target.config.baseUrl = value.trim();
            this.debouncedSave();
          }),
      );

      const useRequestUrl = target.config.useRequestUrl ?? true;
      new Setting(section)
        .setName('CORS 우회 (requestUrl)')
        .setDesc(
          'Obsidian 내부 API로 요청을 보내 CORS 문제를 우회합니다. ' +
            '스트리밍이 비활성화되므로, 서버가 CORS를 지원하면 해제하는 것을 권장합니다.',
        )
        .addToggle((toggle) =>
          toggle.setValue(useRequestUrl).onChange((value) => {
            target.config.useRequestUrl = value;
            this.debouncedSave();
          }),
        );
    }

    const controls = section.createDiv({ cls: 'superpower-inside-provider-model-controls' });
    const searchInput = controls.createEl('input', {
      type: 'search',
      placeholder: '모델 검색...',
      cls: 'superpower-inside-provider-model-search',
    });
    const selectedOnlyLabel = controls.createEl('label', {
      cls: 'superpower-inside-provider-selected-only',
    });
    const selectedOnlyInput = selectedOnlyLabel.createEl('input', { type: 'checkbox' });
    selectedOnlyLabel.createSpan({ text: '선택됨만 보기' });
    const modelListContainer = section.createDiv({ cls: 'superpower-inside-settings-model-list' });

    const statusContainer = section.createDiv({
      cls: 'superpower-inside-settings-validation-status',
    });
    let filterText = '';
    let selectedOnly = false;
    let availableModels = this.getInitialProviderModels(cacheKey, config);

    const renderModelList = () => {
      modelListContainer.empty();
      selectedCountEl.setText(`${config.models.length}개 선택됨`);
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
      header.textContent = `${visibleModels.length}/${sortedModels.length}개 모델 표시`;

      if (visibleModels.length === 0) {
        modelListContainer.createDiv({
          cls: 'superpower-inside-provider-empty-models',
          text: '검색 조건에 맞는 모델이 없습니다.',
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
      .setName('모델 검색')
      .setDesc('모델/태그 목록만 조회합니다. 토큰 생성 요청을 보내지 않습니다.')
      .addButton((button) => {
        button.setButtonText('모델 가져오기');
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
              statusContainer.setText(`✅ 모델 ${result.models.length}개를 가져왔습니다.`);
              renderModelList();
            } else {
              statusContainer.setText(`❌ 모델 검색 실패: ${result.error}`);
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
      .setName('연결 테스트')
      .setDesc('모델/태그 목록만 조회합니다. 토큰 생성 요청을 보내지 않습니다.')
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
              statusContainer.setText(`✅ 연결 성공: 모델 ${result.models.length}개 확인됨`);
              this.validationCache[cacheKey] = result;
              renderModelList();
            } else {
              statusContainer.setText(`❌ 연결 실패: ${result.error}`);
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
      .setName('최소 생성 테스트')
      .setDesc(
        '선택된 첫 모델로 실제 최소 생성 요청을 보냅니다. 프로바이더에 따라 과금될 수 있습니다.',
      )
      .addButton((button) => {
        button.setButtonText('최소 생성 테스트');
        button.onClick(async () => {
          statusContainer.setText('');
          const model = config.models[0];
          if (!model) {
            statusContainer.setText('❌ 최소 생성 테스트 전에 모델을 하나 이상 선택하세요.');
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
              statusContainer.setText(`✅ 최소 생성 성공: ${model}`);
              this.validationCache[cacheKey] = result;
            } else {
              statusContainer.setText(`❌ 최소 생성 실패: ${result.error}`);
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
      cls: 'superpower-inside-settings-section superpower-inside-provider-custom-section',
    });
    section.createDiv({
      cls: 'superpower-inside-settings-section-title',
      text: 'Custom OpenAI-Compatible',
    });
    section.createDiv({
      cls: 'superpower-inside-provider-help',
      text: 'LM Studio, vLLM, LiteLLM처럼 OpenAI v1 인터페이스를 제공하는 서버를 등록합니다.',
    });

    for (const provider of this.plugin.settings.customOpenAIProviders) {
      this.buildProviderSettings(section, {
        kind: 'custom',
        key: `customOpenAI:${provider.id}`,
        label: provider.name.trim() || 'Custom OpenAI-Compatible',
        config: provider,
      });
      const row = section.createDiv({ cls: 'superpower-inside-provider-custom-actions' });
      const removeButton = row.createEl('button', { text: '커스텀 프로바이더 삭제' });
      removeButton.addEventListener('click', () => {
        this.plugin.settings.customOpenAIProviders =
          this.plugin.settings.customOpenAIProviders.filter((item) => item.id !== provider.id);
        this.debouncedSave();
        section.remove();
        this.buildCustomOpenAIProvidersSection(containerEl);
      });
    }

    const addButton = section.createEl('button', { text: '커스텀 프로바이더 추가' });
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
      attr: { 'aria-label': '연결 상태 새로고침' },
    });
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;

    this.mcpStatusRefresh = new RefreshAction({
      action: async (_signal) => {
        if (plugin.reconnectMCP) {
          const errors = await plugin.reconnectMCP();
          containerEl.empty();
          this.renderMCPStatus(containerEl);

          if (errors.length > 0) {
            const errorDetails = errors.map((err) => `• ${err}`).join('\n');
            new Notice(`MCP 연결 오류:\n${errorDetails}`, 10000);
            return { status: 'partial', detail: `${errors.length}개 서버 실패` };
          }
          // RefreshBus로 MCP 이벤트 발행 (채팅 뷰 동기화)
          const pluginWithBus = this.plugin as unknown as { refreshBus?: { emit: (domain: string, result: { status: string; detail?: string }) => void } };
          pluginWithBus.refreshBus?.emit('mcp', { status: 'success' });
          return { status: 'success' };
        }
        return { status: 'error', detail: 'reconnectMCP 는 함수가 없습니다.' };
      },
      loadingText: '재연결 중...',
      spinnerClass: 'spinning',
      successNotice: '연결 상태가 새로고침되었습니다.',
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
