import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type EventRef,
  type Events,
} from 'obsidian';
import { execSync } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { validateMcpJson, formatMcpJson } from './utils/mcp-json';
import type { MCPRegistry } from './mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  type MCPConnectionState,
  type MCPServerConnectionStatus,
} from './mcp/connection-state';
import type { VectorStore } from './rag/store';
import type { VaultIndexer } from './rag/indexer';
import { calculateRagStatus, type RagDocumentUpdate, type RagStatusSummary } from './rag/status';
import { type Language, t } from './i18n';

interface StandardMcpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface StandardMcpConfig {
  mcpServers: Record<string, StandardMcpServerEntry>;
}

function internalToStandard(servers: MCPServerConfig[]): StandardMcpConfig {
  const mcpServers: Record<string, StandardMcpServerEntry> = {};
  for (const s of servers) {
    const entry: StandardMcpServerEntry = { command: s.command };
    if (s.args !== undefined && s.args.length > 0) entry.args = s.args;
    if (s.env !== undefined && Object.keys(s.env).length > 0) entry.env = s.env;
    mcpServers[s.name] = entry;
  }
  return { mcpServers };
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

export type EmbeddingProviderKey = 'openai' | 'ollama' | 'openRouter' | 'other';

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  dimensions: number;
  description: string;
}

export const EMBEDDING_MODELS: Record<EmbeddingProviderKey, EmbeddingModelInfo[]> = {
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

export const EMBEDDING_PROVIDER_LABELS: Record<EmbeddingProviderKey, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  openRouter: 'OpenRouter',
  other: 'Other (Custom)',
};

export interface RAGConfig {
  excludePaths: string[];
  excludeExts: string[];
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
}

export interface ChatConfig {
  saveFolder: string;
  defaultModel: string;
  systemPrompt?: string;
  mcpToolExecutionPolicy: 'mentioned-auto' | 'always-manual' | 'always-auto';
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  enforceMcpTools: boolean;
}

export interface SuperObsidianSettings {
  openai: ProviderConfig;
  claude: ProviderConfig;
  ollama: ProviderConfig;
  ollamaCloud: ProviderConfig;
  openRouter: ProviderConfig;
  customOpenAIProviders: CustomOpenAIProviderConfig[];
  rag: RAGConfig;
  mcpServers: MCPServerConfig[];
  mcpPath: string;
  chat: ChatConfig;
  pluginAwareEnabled: boolean;
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  language: Language;
}

export const DEFAULT_SETTINGS: SuperObsidianSettings = {
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
    excludePaths: [
      '.git',
      'node_modules',
      '.obsidian',
      'attachments',
      'SuperObsidianByAI',
      'SuperObsidianByAIChats',
    ],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    chunkSize: 1000,
    overlap: 100,
    vectorStoreType: 'json',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autoUpdateEnabled: false,
    autoUpdateIntervalMin: 5,
    minScore: 0.5,
    enableBM25: true,
    bm25Weight: 0.3,
  },
  mcpServers: [],
  mcpPath: '',
  chat: {
    saveFolder: 'SuperObsidianByAI',
    defaultModel: 'ollama:llama3.1',
    systemPrompt: '',
    mcpToolExecutionPolicy: 'mentioned-auto',
    autoSaveEnabled: true,
    autoSaveDebounceMs: 3000,
    enforceMcpTools: true,
  },
  pluginAwareEnabled: false,
  autoSaveEnabled: true,
  autoSaveDebounceMs: 500,
  language: 'ko',
};
export interface PluginLike {
  app: App;
  settings: SuperObsidianSettings;
  saveSettings(): Promise<{ success: boolean; mcpErrors?: string[] }>;
  reconnectMCP(): Promise<string[]>;
  setupAutoUpdate(): void;
  initRAG(): Promise<void>;
  mcpRegistry: MCPRegistry | null;
  mcpConnectionState?: MCPConnectionState;
  mcpLastErrors?: string[];
  eventDrivenRagStats?: RagStatusSummary | null;
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

export class SuperObsidianSettingTab extends PluginSettingTab {
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

  constructor(app: App, plugin: PluginLike) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }

  debouncedSave(): void {
    if (!this.plugin.settings.autoSaveEnabled) {
      void this.plugin.saveSettings();
      return;
    }

    this.pendingSave = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.pendingSave = false;
      void this.plugin.saveSettings();
    }, this.plugin.settings.autoSaveDebounceMs);
  }

  flushSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.pendingSave) {
      this.pendingSave = false;
      void this.plugin.saveSettings();
    }
  }

  hide(): void {
    this.unregisterMcpStatusEvent();
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

    // 헤더
    containerEl.createEl('h2', { text: t('settingsTitle') });

    // 보안 경고
    const warning = containerEl.createDiv({
      cls: 'super-obsidian-settings-warning',
    });
    warning.setText(t('securityWarning'));

    // 탭 바
    const tabBar = containerEl.createDiv({ cls: 'super-obsidian-settings-tabs' });
    TABS.forEach((tab) => {
      const button = tabBar.createEl('button', {
        text: tab.label,
        cls: 'super-obsidian-settings-tab',
      });
      this.tabButtons.set(tab.id, button);
      button.addEventListener('click', () => this.switchTab(tab.id));
    });

    // 탭 콘텐츠 패널
    const tabContentContainer = containerEl.createDiv();
    TABS.forEach((tab) => {
      const panel = tabContentContainer.createDiv({
        cls: 'super-obsidian-settings-tab-content',
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
    const generalPanel = this.tabPanels.get('general');
    if (generalPanel) {
      generalPanel.empty();
      this.buildGeneralTab(generalPanel);
    }
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
          await this.plugin.saveSettings();
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
        button.setIcon('refresh');
        button.setTooltip(t('refreshModelList'));
        button.onClick(() => {
          this.refreshGeneralTab();
        });
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
    this.buildEmbeddingProviderSection(containerEl);
    this.buildStatsSection(containerEl);
    this.buildUpdateRequiredDocumentsSection(containerEl);
    this.buildControlsSection(containerEl);
    this.buildIndexingOptionsSection(containerEl);
    this.buildSearchQualitySection(containerEl);
  }

  private buildRagStatusPanel(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({
      cls: 'super-obsidian-rag-section super-obsidian-rag-status-panel',
    });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: 'RAG 상태' });

    const rag = this.plugin.settings.rag;
    const providerLabel = EMBEDDING_PROVIDER_LABELS[rag.embeddingProvider];
    const statusGrid = section.createDiv({ cls: 'super-obsidian-rag-status-grid' });
    this.createRagStatusItem(statusGrid, '프로바이더', providerLabel);
    this.createRagStatusItem(statusGrid, '임베딩 모델', rag.embeddingModel || '미설정');
    this.createRagStatusItem(statusGrid, '저장소', 'JSON File');
    this.createRagStatusItem(statusGrid, '자동 업데이트', rag.autoUpdateEnabled ? '켜짐' : '꺼짐');

    const warning = this.getRagSetupWarning();
    if (warning) {
      section.createDiv({ cls: 'super-obsidian-settings-warning', text: warning });
    }

    if (rag.vectorStoreType === 'indexeddb') {
      section.createDiv({
        cls: 'super-obsidian-settings-warning',
        text: '현재 런타임은 JSON File 벡터 저장소만 사용합니다. IndexedDB 선택값은 아직 적용되지 않습니다.',
      });
    }

    const timestampEl = section.createDiv({
      cls: 'super-obsidian-rag-status-timestamp',
      text: '상태 계산 중...',
    });
    void this.getRagStatus().then((status) => {
      timestampEl.setText(
        status
          ? `마지막 상태 계산: ${new Date(status.lastCalculatedAt).toLocaleString()}`
          : 'RAG 인덱서가 초기화되지 않아 상태를 계산할 수 없습니다.',
      );
    });
  }

  private createRagStatusItem(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({ cls: 'super-obsidian-rag-status-item' });
    item.createDiv({ cls: 'super-obsidian-rag-status-label', text: label });
    item.createDiv({ cls: 'super-obsidian-rag-status-value', text: value });
  }

  private buildEmbeddingProviderSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '임베딩 프로바이더' });

    const rag = this.plugin.settings.rag;

    const effectiveProvider = this.pendingEmbeddingProvider ?? rag.embeddingProvider;
    const effectiveModel = this.pendingEmbeddingModel ?? rag.embeddingModel;

    const modelsForProvider = EMBEDDING_MODELS[effectiveProvider];
    const isOther = effectiveProvider === 'other';
    const isPending = this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null;

    const providerNotice = section.createDiv({ cls: 'super-obsidian-model-description' });
    providerNotice.setText(
      'API 키는 Providers 탭에서 설정한 값을 사용합니다. 여기서는 임베딩 전용 모델만 선택하세요.',
    );

    if (isPending) {
      const warningEl = section.createDiv({ cls: 'super-obsidian-settings-warning' });
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
        for (const [key, label] of Object.entries(EMBEDDING_PROVIDER_LABELS)) {
          dropdown.addOption(key, label);
        }
        dropdown.setValue(effectiveProvider);
        dropdown.onChange((value) => {
          this.pendingEmbeddingProvider = value as EmbeddingProviderKey;
          const newModels = EMBEDDING_MODELS[value as EmbeddingProviderKey];
          if (newModels.length > 0) {
            this.pendingEmbeddingModel = newModels[0].id;
          } else {
            this.pendingEmbeddingModel = '';
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
    } else if (modelsForProvider.length > 0) {
      new Setting(section)
        .setName(t('embeddingModel'))
        .setDesc('사용할 임베딩 모델을 선택하세요')
        .addDropdown((dropdown) => {
          for (const model of modelsForProvider) {
            dropdown.addOption(model.id, `${model.name} (${model.dimensions}차원)`);
          }
          dropdown.setValue(effectiveModel);
          dropdown.onChange((value) => {
            this.pendingEmbeddingModel = value;
            section.remove();
            this.buildEmbeddingProviderSection(containerEl);
          });
        });

      const selectedModel = modelsForProvider.find((m) => m.id === effectiveModel);
      const descEl = section.createDiv({ cls: 'super-obsidian-model-description' });
      descEl.setText(selectedModel?.description ?? '');
    }

    if (isPending) {
      const btnRow = section.createDiv({ cls: 'super-obsidian-rag-controls' });
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

    const statusEl = section.createDiv({ cls: 'super-obsidian-connection-status' });
    new Setting(section).setName('연결 테스트').addButton((button) => {
      button.setButtonText(t('testConnection'));
      button.onClick(async () => {
        statusEl.setText('');
        button.setDisabled(true);
        statusEl.setText(t('testing'));

        try {
          const config =
            effectiveProvider === 'other'
              ? null
              : this.plugin.settings[effectiveProvider as ProviderKey];
          const { validateEmbeddingConnection } = await import('./llm/validation');
          const result = await validateEmbeddingConnection(
            effectiveProvider,
            effectiveModel,
            config ?? { apiKey: '', models: [], enabled: false },
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
  }

  private buildStatsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '인덱스 통계' });

    const grid = section.createDiv({ cls: 'super-obsidian-stats-grid' });

    // 통계 비동기 로드
    this.renderStats(grid).catch(() => {
      grid.setText('통계를 불러올 수 없습니다.');
    });

    // 새로고침 버튼
    new Setting(section).setName('').addButton((btn) => {
      btn.setButtonText('새로고침');
      btn.onClick(() => {
        grid.empty();
        void this.renderStats(grid);
      });
    });
  }

  private async renderStats(gridEl: HTMLElement): Promise<void> {
    const status = await this.getRagStatus();
    if (!status) {
      gridEl.setText('RAG 인덱서가 초기화되지 않았습니다.');
      return;
    }

    const stats = [
      { value: String(status.totalDocuments), label: '전체 문서', desc: '인덱싱 대상 Markdown' },
      { value: String(status.healthyDocuments), label: '정상', desc: '현재 벡터가 최신인 문서' },
      {
        value: String(status.updateRequiredDocuments.length),
        label: '업데이트 필요',
        desc: '미인덱싱/수정됨/확인 필요',
      },
      { value: String(status.totalVectors), label: '전체 벡터', desc: '저장된 임베딩 벡터 개수' },
    ];

    for (const stat of stats) {
      const card = gridEl.createDiv({ cls: 'super-obsidian-stat-card' });
      card.createDiv({ cls: 'super-obsidian-stat-value', text: stat.value });
      card.createDiv({ cls: 'super-obsidian-stat-label', text: stat.label });
      card.createDiv({ cls: 'super-obsidian-stat-desc', text: stat.desc });
    }
  }

  refreshStats(): void {
    const ragPanel = this.tabPanels.get('rag');
    if (!ragPanel) return;
    ragPanel.empty();
    this.buildRAGTab(ragPanel);
  }

  private buildUpdateRequiredDocumentsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '업데이트가 필요한 문서' });

    const listEl = section.createDiv({ cls: 'super-obsidian-rag-update-list' });
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
            cls: 'super-obsidian-rag-empty-state',
            text: '업데이트가 필요한 문서가 없습니다.',
          });
          return;
        }

        listEl.createDiv({
          cls: 'super-obsidian-rag-update-summary',
          text: `${documents.length}개 문서에 업데이트가 필요합니다. 아래에는 최대 10개만 표시됩니다.`,
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

  private renderRagUpdateDocument(containerEl: HTMLElement, document: RagDocumentUpdate): void {
    const row = containerEl.createDiv({ cls: 'super-obsidian-rag-update-row' });
    row.createSpan({
      cls: `super-obsidian-rag-update-badge ${document.status}`,
      text: this.getRagStatusLabel(document.status),
    });
    const body = row.createDiv({ cls: 'super-obsidian-rag-update-body' });
    body.createDiv({ cls: 'super-obsidian-rag-update-path', text: document.path });
    body.createDiv({ cls: 'super-obsidian-rag-update-reason', text: document.reason });
  }

  private getRagStatusLabel(status: RagDocumentUpdate['status']): string {
    if (status === 'missing') return '미인덱싱';
    if (status === 'stale') return '수정됨';
    return '확인 필요';
  }

  private async getRagStatus(): Promise<RagStatusSummary | null> {
    const p = this.plugin as unknown as { vectorStore?: VectorStore };
    if (p.vectorStore) {
      return calculateRagStatus(this.plugin.app.vault, p.vectorStore, this.plugin.settings.rag);
    }
    return this.plugin.eventDrivenRagStats ?? null;
  }

  private getRagSetupWarning(): string | null {
    const rag = this.plugin.settings.rag;
    const providerKey = rag.embeddingProvider;
    if (providerKey !== 'other') {
      const config = this.plugin.settings[providerKey as ProviderKey];
      if (!config?.enabled) {
        return `Providers 탭에서 "${EMBEDDING_PROVIDER_LABELS[providerKey]}"을 먼저 활성화하세요.`;
      }
      if (!config.apiKey.trim()) {
        return `Providers 탭에서 "${EMBEDDING_PROVIDER_LABELS[providerKey]}" API Key를 입력하세요.`;
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
      const config = this.plugin.settings[providerKey as ProviderKey];
      if (!config?.enabled) {
        return `Providers 탭에서 "${EMBEDDING_PROVIDER_LABELS[providerKey]}"의 Enabled 토글을 켜주세요.`;
      }
      if (!config.apiKey.trim()) {
        return `Providers 탭에서 "${EMBEDDING_PROVIDER_LABELS[providerKey]}"의 API Key를 입력하세요.`;
      }
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return `임베딩 모델이 선택되지 않았습니다. Embedding Provider 섹션에서 모델을 선택하고 "저장" 버튼을 클릭하세요.`;
      }
    } else {
      if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
        return `임베딩 모델 ID를 직접 입력하고 "저장" 버튼을 클릭하세요.`;
      }
    }
    return `프로바이더 "${EMBEDDING_PROVIDER_LABELS[providerKey]}"(${rag.embeddingModel}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.`;
  }

  private buildControlsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '인덱싱 제어' });

    const controls = section.createDiv({ cls: 'super-obsidian-rag-controls' });
    const p = this.plugin as unknown as {
      vaultIndexer?: VaultIndexer;
      vectorStore?: VectorStore;
      embeddingProvider?: { clearCache(): Promise<void> };
    };
    const hasIndexer = !!p.vaultIndexer;

    controls.createEl('button', { text: '필요 문서 업데이트' }, (btn) => {
      btn.disabled = true;
      void this.getRagStatus().then((status) => {
        btn.disabled = !hasIndexer || !status || status.updateRequiredDocuments.length === 0;
        btn.title =
          status && status.updateRequiredDocuments.length === 0
            ? '업데이트가 필요한 문서가 없습니다.'
            : '';
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
              new Notice('업데이트가 필요한 문서가 없습니다.');
              return;
            }
            new Notice(`${status.updateRequiredDocuments.length}개 문서 업데이트 시작...`);
            const result = await p.vaultIndexer!.indexPending();
            new Notice(`${result.indexed}개 문서 업데이트 완료, ${result.skipped}개 문서 스킵됨`);
            this.refreshStats();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`인덱싱 실패: ${msg}`);
          }
        })();
      });
    });

    controls.createEl('button', { text: '전체 재인덱싱' }, (btn) => {
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice('RAG 인덱서가 초기화되지 않았습니다. ' + this.diagnoseRAGInitFailure());
            return;
          }
          new Notice('전체 재인덱싱 시작...');
          try {
            const count = await p.vaultIndexer!.reindexAll();
            new Notice(`${count}개 파일 재인덱싱 완료`);
            this.refreshStats();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`재인덱싱 실패: ${msg}`);
          }
        })();
      });
    });

    controls.createEl('button', { text: '임베딩 데이터 초기화' }, (btn) => {
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
            this.refreshStats();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`초기화 실패: ${msg}`);
          }
        })();
      });
    });
  }

  private buildIndexingOptionsSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '고급 인덱싱 옵션' });

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

    // 제외 경로
    new Setting(section)
      .setName('제외할 경로')
      .setDesc('인덱싱에서 제외할 폴더 (쉼표로 구분)')
      .addText((text) =>
        text.setValue(this.plugin.settings.rag.excludePaths.join(', ')).onChange((value) => {
          this.plugin.settings.rag.excludePaths = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          this.debouncedSave();
        }),
      );

    // 제외 확장자
    new Setting(section)
      .setName('제외할 확장자')
      .setDesc('인덱싱에서 제외할 파일 확장자 (쉼표로 구분, 점 제외)')
      .addText((text) =>
        text.setValue(this.plugin.settings.rag.excludeExts.join(', ')).onChange((value) => {
          this.plugin.settings.rag.excludeExts = value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          this.debouncedSave();
        }),
      );

    // 청크 크기
    new Setting(section)
      .setName(t('chunkSize'))
      .setDesc(t('chunkSizeDesc'))
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.rag.chunkSize))
          .setPlaceholder('1000')
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

    // 벡터 저장소 유형
    new Setting(section)
      .setName('벡터 저장소 유형')
      .setDesc(
        '현재 런타임은 JSON File만 사용합니다. IndexedDB는 설정값으로 보이지만 아직 실제 저장소로 연결되지 않았습니다.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('json', 'JSON File')
          .addOption('indexeddb', 'IndexedDB (미지원)')
          .setValue(this.plugin.settings.rag.vectorStoreType)
          .onChange((value) => {
            this.plugin.settings.rag.vectorStoreType = value as 'json' | 'indexeddb';
            this.debouncedSave();
            if (value === 'indexeddb') {
              new Notice('현재 IndexedDB 벡터 저장소는 런타임에서 아직 지원되지 않습니다.');
            }
          }),
      );
  }

  private buildSearchQualitySection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'super-obsidian-rag-section' });
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '검색 품질' });

    const guidanceEl = section.createEl('div');
    guidanceEl.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85em; padding: 8px 12px; border-left: 3px solid var(--interactive-accent); background: var(--background-secondary); border-radius: 4px; margin: 8px 0;">${t('bm25Guidance')}</p>`;

    new Setting(section)
      .setName(t('minScore'))
      .setDesc(t('minScoreDesc'))
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.rag.minScore)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.rag.minScore = value;
            this.debouncedSave();
          }),
      );

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
      .addSlider((slider) =>
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.rag.bm25Weight)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.rag.bm25Weight = value;
            this.debouncedSave();
          }),
      );
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
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.setValue(this.plugin.settings.chat.systemPrompt ?? '');
        text.setPlaceholder(t('systemPromptPlaceholder'));
        text.onChange((value) => {
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

    const presetRow = containerEl.createDiv({ cls: 'super-obsidian-chat-presets' });
    const presets: { label: string; prompt: string }[] = [
      {
        label: t('quickPresetGeneral'),
        prompt:
          '당신은 Obsidian 노트 작성을 돕는 전문가 어시스턴트입니다. 마크다운 문법을 잘 알고 있으며, 사용자의 질문에 정확하고 간결하게 답변합니다.',
      },
      {
        label: t('quickPresetCodeReview'),
        prompt:
          '당신은 시니어 개발자입니다. 사용자가 제시한 코드를 리뷰하고, 버그, 성능 문제, 가독성 개선점을 찾아 한국어로 설명합니다.',
      },
      {
        label: t('quickPresetTranslate'),
        prompt:
          '당신은 전문 번역가입니다. 사용자가 요청한 텍스트를 지정한 언어로 자연스럽게 번역합니다. 원문의 뉘앙스와 전문 용어를 최대한 살려주세요.',
      },
      {
        label: t('quickPresetSummarize'),
        prompt:
          '당신은 요약 전문가입니다. 사용자가 제공한 긴 텍스트나 문서를 핵심만 간결하게 요약합니다. bullet point 형식을 사용하세요.',
      },
    ];
    for (const preset of presets) {
      const btn = presetRow.createEl('button', {
        text: preset.label,
        cls: 'super-obsidian-mcp-preset-btn',
      });
      btn.addEventListener('click', () => {
        this.plugin.settings.chat.systemPrompt = preset.prompt;
        this.debouncedSave();
        const chatPanel = this.tabPanels.get('chat');
        if (chatPanel) {
          chatPanel.empty();
          this.buildChatTab(chatPanel);
        }
        new Notice(`${preset.label} 프리셋이 적용되었습니다.`);
      });
    }

    const resetRow = containerEl.createDiv({ cls: 'super-obsidian-chat-presets' });
    const resetBtn = resetRow.createEl('button', {
      text: t('resetToDefault'),
      cls: 'super-obsidian-mcp-preset-btn',
    });
    resetBtn.addEventListener('click', () => {
      this.plugin.settings.chat.systemPrompt = '';
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
      .addSlider((slider) =>
        slider
          .setLimits(1000, 10000, 500)
          .setValue(this.plugin.settings.chat.autoSaveDebounceMs)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.chat.autoSaveDebounceMs = value;
            this.debouncedSave();
          }),
      );

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
      cls: 'super-obsidian-mcp-collapsible-header',
    });
    const pathChevron = pathHeader.createEl('span', {
      cls: 'super-obsidian-mcp-collapsible-chevron',
      text: '▶',
    });
    pathHeader.createEl('span', {
      cls: 'super-obsidian-mcp-collapsible-title',
      text: t('mcpPathTitle'),
    });

    const pathContent = mcpSection.createDiv({
      cls: 'super-obsidian-mcp-collapsible-content',
    });

    const pathDesc = pathContent.createDiv({ cls: 'setting-item-description' });
    pathDesc.setText(t('mcpPathDesc'));

    const pathRow = pathContent.createDiv({ cls: 'super-obsidian-mcp-path-row' });

    const pathText = pathRow.createEl('textarea', {
      cls: 'super-obsidian-mcp-json-editor',
      attr: { placeholder: t('mcpPathPlaceholder'), rows: '3' },
    });
    pathText.value = this.plugin.settings.mcpPath;

    const pathActions = pathRow.createDiv({ cls: 'super-obsidian-mcp-path-actions' });

    const fetchBtn = pathActions.createEl('button', { text: t('mcpPathFetch') });
    fetchBtn.addEventListener('click', () => {
      void (async () => {
        const originalText = fetchBtn.textContent;
        fetchBtn.setText(t('mcpPathFetching'));
        fetchBtn.disabled = true;

        try {
          let shell = process.env.SHELL ?? '';

          if (!shell || !shell.startsWith('/')) {
            const candidates = [
              '/opt/homebrew/bin/fish',
              '/usr/local/bin/fish',
              '/usr/bin/fish',
              '/bin/zsh',
              '/bin/bash',
              '/bin/sh',
            ];
            for (const c of candidates) {
              try {
                accessSync(c, fsConstants.X_OK);
                shell = c;
                break;
              } catch {
                void 0;
              }
            }
          }

          let output: string;
          if (shell.includes('fish')) {
            output = execSync(`${shell} -lc 'printenv PATH'`, {
              encoding: 'utf8',
              timeout: 5000,
            }).trim();
          } else {
            output = execSync(`${shell} -ilc 'printenv PATH'`, {
              encoding: 'utf8',
              timeout: 5000,
            }).trim();
          }

          if (output.includes(':') || output.includes(';')) {
            pathText.value = output;
            this.plugin.settings.mcpPath = output;
            await this.plugin.saveSettings();
            new Notice(t('mcpPathFetchSuccess'));
          } else {
            throw new Error(`Unexpected PATH output: "${output}"`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`${t('mcpPathFetchError')}: ${msg}`);
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

    mcpSection.createDiv({ cls: 'super-obsidian-mcp-section-divider' });

    const statusSection = mcpSection.createDiv({ cls: 'super-obsidian-mcp-status' });
    this.renderMCPStatus(statusSection);
    this.unregisterMcpStatusEvent();
    this.mcpStatusEventRef = (this.app.workspace as unknown as Events).on(
      MCP_STATUS_CHANGE_EVENT,
      () => {
        this.renderMCPStatus(statusSection);
      },
    );

    mcpSection.createDiv({ cls: 'super-obsidian-mcp-section-divider' });
    mcpSection.createEl('h3', {
      text: t('mcpJsonEditor'),
      cls: 'super-obsidian-mcp-section-title',
    });

    const lintStatus = mcpSection.createDiv({ cls: 'super-obsidian-mcp-lint-status' });
    lintStatus.setText('');

    const defaultJson = JSON.stringify(
      internalToStandard(this.plugin.settings.mcpServers),
      null,
      2,
    );
    const jsonTextArea = mcpSection.createEl('textarea', {
      cls: 'super-obsidian-mcp-json-editor',
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
  }

  private buildProviderSettings(containerEl: HTMLElement, target: ProviderSettingsTarget): void {
    const { config, label } = target;
    const cacheKey = target.key;
    const section = containerEl.createDiv({
      cls: 'super-obsidian-settings-section super-obsidian-provider-card',
    });
    const titleRow = section.createDiv({ cls: 'super-obsidian-provider-title-row' });
    titleRow.createDiv({ cls: 'super-obsidian-settings-section-title', text: label });
    const selectedCountEl = titleRow.createDiv({ cls: 'super-obsidian-provider-selected-count' });

    new Setting(section).setName(t('enabled')).addToggle((toggle) =>
      toggle.setValue(config.enabled).onChange((value) => {
        config.enabled = value;
        this.debouncedSave();
      }),
    );

    new Setting(section).setName(t('apiKey')).addText((text) =>
      text
        .setPlaceholder('sk-...')
        .setValue(config.apiKey)
        .onChange((value) => {
          config.apiKey = value.trim();
          this.debouncedSave();
        }),
    );

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
          'Obsidian 내부 API로 요청을 보내 CORS 문제를 우회합니다. '
          + '스트리밍이 비활성화되므로, 서버가 CORS를 지원하면 해제하는 것을 권장합니다.',
        )
        .addToggle((toggle) =>
          toggle.setValue(useRequestUrl).onChange((value) => {
            target.config.useRequestUrl = value;
            this.debouncedSave();
          }),
        );
    }

    const controls = section.createDiv({ cls: 'super-obsidian-provider-model-controls' });
    const searchInput = controls.createEl('input', {
      type: 'search',
      placeholder: '모델 검색...',
      cls: 'super-obsidian-provider-model-search',
    });
    const selectedOnlyLabel = controls.createEl('label', {
      cls: 'super-obsidian-provider-selected-only',
    });
    const selectedOnlyInput = selectedOnlyLabel.createEl('input', { type: 'checkbox' });
    selectedOnlyLabel.createSpan({ text: '선택됨만 보기' });
    const modelListContainer = section.createDiv({ cls: 'super-obsidian-settings-model-list' });

    const statusContainer = section.createDiv({ cls: 'super-obsidian-settings-validation-status' });
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
        cls: 'super-obsidian-settings-model-list-header',
      });
      header.textContent = `${visibleModels.length}/${sortedModels.length}개 모델 표시`;

      if (visibleModels.length === 0) {
        modelListContainer.createDiv({
          cls: 'super-obsidian-provider-empty-models',
          text: '검색 조건에 맞는 모델이 없습니다.',
        });
        return;
      }

      visibleModels.forEach((model) => {
        const item = modelListContainer.createDiv({ cls: 'super-obsidian-settings-model-item' });
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
          const spinner = statusContainer.createSpan({ cls: 'super-obsidian-spinner' });

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
      .setDesc(
        '선택된 첫 모델로 실제 최소 요청을 보냅니다. 프로바이더에 따라 소액 과금될 수 있습니다.',
      )
      .addButton((button) => {
        button.setButtonText(t('testConnection'));
        button.onClick(async () => {
          statusContainer.setText('');
          const model = config.models[0];
          if (!model) {
            statusContainer.setText('❌ 연결 테스트 전에 모델을 하나 이상 선택하세요.');
            return;
          }
          button.setDisabled(true);
          const spinner = statusContainer.createSpan({ cls: 'super-obsidian-spinner' });

          try {
            const { testProviderConnection } = await import('./llm/validation');
            const result =
              target.kind === 'fixed'
                ? await testProviderConnection(target.key, config, model)
                : await testProviderConnection('customOpenAI', target.config, model);
            spinner.remove();

            if (result.valid) {
              statusContainer.setText(`✅ 연결 성공: ${model}`);
              this.validationCache[cacheKey] = result;
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
      cls: 'super-obsidian-settings-section super-obsidian-provider-custom-section',
    });
    section.createDiv({
      cls: 'super-obsidian-settings-section-title',
      text: 'Custom OpenAI-Compatible',
    });
    section.createDiv({
      cls: 'super-obsidian-provider-help',
      text: 'LM Studio, vLLM, LiteLLM처럼 OpenAI v1 인터페이스를 제공하는 서버를 등록합니다.',
    });

    for (const provider of this.plugin.settings.customOpenAIProviders) {
      this.buildProviderSettings(section, {
        kind: 'custom',
        key: `customOpenAI:${provider.id}`,
        label: provider.name.trim() || 'Custom OpenAI-Compatible',
        config: provider,
      });
      const row = section.createDiv({ cls: 'super-obsidian-provider-custom-actions' });
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

    const statusBox = containerEl.createDiv({ cls: 'super-obsidian-mcp-status-box' });

    const headerRow = statusBox.createDiv({ cls: 'super-obsidian-mcp-status-header-row' });
    headerRow.createDiv({ cls: 'super-obsidian-mcp-status-title', text: t('mcpConnectionHealth') });

    const actionsRow = headerRow.createDiv({ cls: 'super-obsidian-mcp-status-actions' });
    const refreshBtn = actionsRow.createEl('button', {
      cls: 'super-obsidian-mcp-refresh-btn',
      attr: { 'aria-label': '연결 상태 새로고침' },
    });
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;

    refreshBtn.addEventListener('click', () => {
      void (async () => {
        refreshBtn.disabled = true;
        refreshBtn.addClass('spinning');

        try {
          if (plugin.reconnectMCP) {
            const errors = await plugin.reconnectMCP();
            containerEl.empty();
            this.renderMCPStatus(containerEl);

            if (errors.length > 0) {
              const errorDetails = errors.map((err) => `• ${err}`).join('\n');
              new Notice(`MCP 연결 오류:\n${errorDetails}`, 10000);
            } else {
              new Notice('연결 상태가 새로고침되었습니다.');
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`새로고침 실패: ${msg}`);
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.removeClass('spinning');
        }
      })();
    });

    const countEl = statusBox.createDiv({ cls: 'super-obsidian-mcp-status-count' });
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
      const list = statusBox.createDiv({ cls: 'super-obsidian-mcp-status-list' });
      for (const server of servers) {
        const item = list.createDiv({ cls: 'super-obsidian-mcp-status-item' });
        let status: MCPServerConnectionStatus = 'disconnected';

        if (registry) {
          status = registry.getConnectionStatus(server.name);
        }

        item.createDiv({ cls: `super-obsidian-mcp-status-dot ${status}` });
        item.createSpan({ text: server.name, cls: 'super-obsidian-mcp-status-name' });

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
          cls: `super-obsidian-mcp-status-label ${status}`,
        });

        const error = registry?.getLastError(server.name);
        if (error) {
          item.createDiv({
            text: error,
            cls: 'super-obsidian-mcp-status-error-detail',
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
