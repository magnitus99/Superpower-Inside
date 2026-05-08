import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { isExcludedExt } from './utils/vault';
import type { VectorStore } from './rag/store';
import type { VaultIndexer } from './rag/indexer';
import { type Language, t } from './i18n';
import { MCPClientManager } from './mcp/client';

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
}

export const PROVIDER_KEYS = ['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'] as const;

export const PROVIDER_LABELS: Record<typeof PROVIDER_KEYS[number], string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  ollama: 'Ollama (Local)',
  ollamaCloud: 'Ollama (Cloud)',
  openRouter: 'OpenRouter',
};

export type ProviderKey = typeof PROVIDER_KEYS[number];

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  token?: string;
  registryUrl?: string;
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
    { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimensions: 1536, description: '가장 널리 쓰이는 기본 모델. 성능과 비용의 균형이 뛰어납니다.' },
    { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimensions: 3072, description: '최고 성능 모델. 다국어와 복잡한 문맥에 강점이 있습니다.' },
  ],
  openRouter: [
    { id: 'openai/text-embedding-3-small', name: 'OpenAI text-embedding-3-small (via OpenRouter)', dimensions: 1536, description: 'OpenRouter 경유. 동일 품질, OpenRouter API 키 사용.' },
    { id: 'baai/bge-m3', name: 'BAAI bge-m3', dimensions: 1024, description: '다국어(한국어 포함) 최적화. 8K 컨텍스트.' },
    { id: 'qwen/qwen3-embedding-8b', name: 'Qwen3 Embedding 8B', dimensions: 1024, description: '32K 컨텍스트 지원. 긴 문서에 적합.' },
  ],
  ollama: [
    { id: 'nomic-embed-text', name: 'nomic-embed-text', dimensions: 768, description: 'Ollama 기본 임베딩 모델. 로컬 설치 필요.' },
  ],
  other: [],
};

export const EMBEDDING_PROVIDER_LABELS: Record<EmbeddingProviderKey, string> = {
  openai: 'OpenAI',
  ollama: 'Ollama (Local)',
  openRouter: 'OpenRouter',
  other: 'Other (Custom)',
};

export const MCP_TRANSPORT_LABELS: Record<MCPServerConfig['transport'], string> = {
  stdio: 'stdio',
  sse: 'sse',
  http: 'http',
};

export const MCP_PRESETS: { label: string; config: Partial<MCPServerConfig> }[] = [
  {
    label: 'uvx (npx-like for uv)',
    config: { transport: 'stdio', command: 'uvx', args: ['mcp-server-example'] },
  },
  {
    label: 'npx (Node)',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@ anthropic-ai/mcp-server'] },
  },
  {
    label: 'bunx (Bun)',
    config: { transport: 'stdio', command: 'bunx', args: ['@ anthropic-ai/mcp-server'] },
  },
  {
    label: 'Custom stdio',
    config: { transport: 'stdio', command: '', args: [] },
  },
  {
    label: 'Custom HTTP/SSE',
    config: { transport: 'http', url: '' },
  },
];

export interface RAGConfig {
  excludePaths: string[];
  excludeExts: string[];
  chunkSize: number;
  overlap: number;
  vectorStoreType: 'json' | 'indexeddb';
  embeddingProvider: EmbeddingProviderKey;
  embeddingModel: string;
  autoUpdateEnabled: boolean;
  autoUpdateIntervalMs: number;
}

export interface ChatConfig {
  saveFolder: string;
  defaultModel: string;
}

export interface SuperObsidianSettings {
  openai: ProviderConfig;
  claude: ProviderConfig;
  ollama: ProviderConfig;
  ollamaCloud: ProviderConfig;
  openRouter: ProviderConfig;
  rag: RAGConfig;
  mcpServers: MCPServerConfig[];
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
  rag: {
    excludePaths: ['.git', 'node_modules', '.obsidian', 'attachments'],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    chunkSize: 1000,
    overlap: 100,
    vectorStoreType: 'json',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autoUpdateEnabled: false,
    autoUpdateIntervalMs: 30000,
  },
  mcpServers: [],
  chat: {
    saveFolder: 'chats',
    defaultModel: 'openai:gpt-4o-mini',
  },
  pluginAwareEnabled: false,
  autoSaveEnabled: true,
  autoSaveDebounceMs: 500,
  language: 'ko',
};
export interface PluginLike {
  app: App;
  settings: SuperObsidianSettings;
  saveSettings(): Promise<void>;
  eventDrivenRagStats?: {
    totalFiles: number;
    indexedFiles: number;
    pendingFiles: number;
    totalVectors: number;
  } | null;
}

// Tab Types and Configuration
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

export class SuperObsidianSettingTab extends PluginSettingTab {
  private plugin: PluginLike;

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
    if (this.pendingEmbeddingProvider !== null || this.pendingEmbeddingModel !== null) {
      this.pendingEmbeddingProvider = null;
      this.pendingEmbeddingModel = null;
      new Notice('임베딩 설정 변경이 취소되었습니다. (설정 탭을 닫으면서 저장되지 않은 변경사항은 버려집니다)');
    }
    this.flushSave();
    super.hide();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    // Header
    containerEl.createEl('h2', { text: t('settingsTitle') });

    // Security Warning
    const warning = containerEl.createDiv({
      cls: 'super-obsidian-settings-warning',
    });
    warning.setText(t('securityWarning'));
    
    // Tab Bar
    const tabBar = containerEl.createDiv({ cls: 'super-obsidian-settings-tabs' });
    TABS.forEach(tab => {
      const button = tabBar.createEl('button', { 
        text: tab.label, 
        cls: 'super-obsidian-settings-tab' 
      });
      this.tabButtons.set(tab.id, button);
      button.addEventListener('click', () => this.switchTab(tab.id));
    });
    
    // Tab Content Panels
    const tabContentContainer = containerEl.createDiv();
    TABS.forEach(tab => {
      const panel = tabContentContainer.createDiv({ 
        cls: 'super-obsidian-settings-tab-content' 
      });
      this.tabPanels.set(tab.id, panel);
      
      // Build content for each tab
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
    
    // Initialize first tab as active
    this.switchTab(this.activeTab);
  }

  private switchTab(tabId: SettingsTabId): void {
    // Update active tab
    this.activeTab = tabId;
    
    // Toggle classes on buttons
    this.tabButtons.forEach((button, id) => {
      if (id === tabId) {
        button.classList.add('is-active');
      } else {
        button.classList.remove('is-active');
      }
    });
    
    // Toggle classes on panels
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
        toggle
          .setValue(this.plugin.settings.autoSaveEnabled)
          .onChange(async (value) => {
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
    for (const key of PROVIDER_KEYS) {
      const conf = this.plugin.settings[key];
      if (!conf.enabled) continue;
      for (const model of conf.models) {
        allModels.push({ value: `${key}:${model}`, label: `${PROVIDER_LABELS[key]} — ${model}` });
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
      });
  }
  
  private buildProvidersTab(containerEl: HTMLElement): void {
    this.buildProviderSettings(containerEl, 'OpenAI', 'openai');
    this.buildProviderSettings(containerEl, 'Claude (Anthropic)', 'claude');
    this.buildProviderSettings(containerEl, 'Ollama (Local)', 'ollama');
    this.buildProviderSettings(containerEl, 'Ollama (Cloud)', 'ollamaCloud');
    this.buildProviderSettings(containerEl, 'OpenRouter', 'openRouter');
  }
  
  // RAG 탭 — 4섹션 구조
  private buildRAGTab(containerEl: HTMLElement): void {
    this.buildEmbeddingProviderSection(containerEl);
    this.buildStatsSection(containerEl);
    this.buildControlsSection(containerEl);
    this.buildIndexingOptionsSection(containerEl);
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
    providerNotice.setText('API 키는 Providers 탭에서 설정한 값을 사용합니다. 여기서는 임베딩 전용 모델만 선택하세요.');

    if (isPending) {
      const warningEl = section.createDiv({ cls: 'super-obsidian-settings-warning' });
      warningEl.setText('⚠️ 임베딩 프로바이더/모델 변경은 자동으로 저장되지 않습니다. "저장" 버튼을 클릭해야 적용됩니다. 변경 시 기존 임베딩 데이터가 삭제되지 않습니다. 새 모델을 모든 데이터에 적용하려면 "전체 재인덱싱"을 실행하세요.');
      warningEl.style.marginBottom = '12px';
      warningEl.style.whiteSpace = 'normal';
    }

    new Setting(section)
      .setName('Provider')
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
        .setName('Model ID')
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
        .setName('Model')
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
    new Setting(section)
      .setName('연결 테스트')
      .addButton((button) => {
        button.setButtonText('Test Connection');
        button.onClick(async () => {
          statusEl.setText('');
          button.setDisabled(true);
          statusEl.setText('🔄 Testing...');

          try {
            const config = effectiveProvider === 'other'
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

    // Async load stats
    this.renderStats(grid).catch(() => {
      grid.setText('통계를 불러올 수 없습니다.');
    });

    // Refresh button
    new Setting(section)
      .setName('')
      .addButton((btn) => {
        btn.setButtonText('새로고침');
        btn.onClick(() => {
          grid.empty();
          void this.renderStats(grid);
        });
      });
  }

  private async renderStats(gridEl: HTMLElement): Promise<void> {
    const rag = this.plugin.settings.rag;
    const vault = this.plugin.app.vault;

    if (this.plugin.eventDrivenRagStats) {
      const cache = this.plugin.eventDrivenRagStats;
      const stats = [
        { value: String(cache.totalFiles), label: '전체 파일', desc: '볼트 내 마크다운 파일 수' },
        { value: String(cache.indexedFiles), label: '인덱싱 완료', desc: '임베딩 처리된 파일 수' },
        { value: String(cache.pendingFiles), label: '대기 중', desc: '아직 인덱싱되지 않은 파일 수' },
        { value: String(cache.totalVectors), label: '전체 벡터', desc: '저장된 임베딩 벡터 개수' },
      ];
      for (const stat of stats) {
        const card = gridEl.createDiv({ cls: 'super-obsidian-stat-card' });
        card.createDiv({ cls: 'super-obsidian-stat-value', text: stat.value });
        card.createDiv({ cls: 'super-obsidian-stat-label', text: stat.label });
        card.createDiv({ cls: 'super-obsidian-stat-desc', text: stat.desc });
      }
      return;
    }
    const { getMarkdownFilesFiltered } = await import('./utils/vault');
    const allFiles = getMarkdownFilesFiltered(vault, rag.excludePaths).filter(
      (f) => !isExcludedExt(f.path, rag.excludeExts),
    );
    const totalFiles = allFiles.length;

    let indexedFiles = 0;
    let totalVectors = 0;
    const p = this.plugin as unknown as { vectorStore?: VectorStore };
    if (p.vectorStore) {
      const indexedPaths = await p.vectorStore.getIndexedFilePaths();
      indexedFiles = indexedPaths.length;
      const stats = await p.vectorStore.getStats();
      totalVectors = stats.totalEntries;
    }

    const pendingFiles = Math.max(0, totalFiles - indexedFiles);

    const stats = [
      { value: String(totalFiles), label: '전체 파일', desc: '볼트 내 마크다운 파일 수' },
      { value: String(indexedFiles), label: '인덱싱 완료', desc: '임베딩 처리된 파일 수' },
      { value: String(pendingFiles), label: '대기 중', desc: '아직 인덱싱되지 않은 파일 수' },
      { value: String(totalVectors), label: '전체 벡터', desc: '저장된 임베딩 벡터 개수' },
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
    const grid = ragPanel.querySelector('.super-obsidian-stats-grid');
    if (!grid || !(grid instanceof HTMLElement)) return;
    grid.empty();
    void this.renderStats(grid);
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
    const p = this.plugin as unknown as { vaultIndexer?: VaultIndexer; vectorStore?: VectorStore; embeddingProvider?: { clearCache(): Promise<void> } };
    const hasIndexer = !!p.vaultIndexer;

    controls.createEl('button', { text: '대기 중인 파일 업데이트' }, (btn) => {
      btn.addEventListener('click', () => {
        void (async () => {
          if (!hasIndexer) {
            new Notice('RAG 인덱서가 초기화되지 않았습니다. ' + this.diagnoseRAGInitFailure());
            return;
          }
          new Notice('대기 중인 파일 인덱싱 시작...');
          try {
            const result = await p.vaultIndexer!.indexPending();
            new Notice(`${result.indexed}개 파일 인덱싱 완료, ${result.skipped}개 파일 스킵됨`);
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
    section.createDiv({ cls: 'super-obsidian-rag-section-title', text: '인덱싱 옵션' });

    // Auto-update toggle
    new Setting(section)
      .setName('자동 업데이트')
      .setDesc('설정된 간격으로 새 파일을 자동으로 인덱싱합니다')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.rag.autoUpdateEnabled)
          .onChange(async (value) => {
            this.plugin.settings.rag.autoUpdateEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    // Auto-update interval slider
    new Setting(section)
      .setName('자동 업데이트 간격')
      .setDesc('자동 인덱싱 간격 (분)')
      .addSlider((slider) =>
        slider
          .setLimits(1, 60, 1)
          .setValue(this.plugin.settings.rag.autoUpdateIntervalMs / 60000)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.rag.autoUpdateIntervalMs = value * 60000;
            this.debouncedSave();
          }),
      );

    // Exclude Paths
    new Setting(section)
      .setName('제외할 경로')
      .setDesc('인덱싱에서 제외할 폴더 (쉼표로 구분)')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.rag.excludePaths.join(', '))
          .onChange((value) => {
            this.plugin.settings.rag.excludePaths = value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            this.debouncedSave();
          }),
      );

    // Exclude Extensions
    new Setting(section)
      .setName('제외할 확장자')
      .setDesc('인덱싱에서 제외할 파일 확장자 (쉼표로 구분, 점 제외)')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.rag.excludeExts.join(', '))
          .onChange((value) => {
            this.plugin.settings.rag.excludeExts = value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            this.debouncedSave();
          }),
      );

    // Chunk Size
    new Setting(section)
      .setName('청크 크기')
      .setDesc('마크다운 청크당 최대 문자 수')
      .addSlider((slider) =>
        slider
          .setLimits(100, 5000, 100)
          .setValue(this.plugin.settings.rag.chunkSize)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.rag.chunkSize = value;
            this.debouncedSave();
          }),
      );

    // Vector Store Type
    new Setting(section)
      .setName('벡터 저장소 유형')
      .setDesc(
        'JSON File은 볼트 안의 JSON 파일에 저장되어 Obsidian Sync/Git 등으로 동기화됩니다. IndexedDB는 브라우저 로컬 데이터베이스에 저장되며, 큰 임베딩 데이터에서 더 빠르고 효율적이지만 수동 백업 없이는 동기화되지 않습니다.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('json', 'JSON File')
          .addOption('indexeddb', 'IndexedDB')
          .setValue(this.plugin.settings.rag.vectorStoreType)
          .onChange((value) => {
            this.plugin.settings.rag.vectorStoreType = value as 'json' | 'indexeddb';
            this.debouncedSave();
          }),
      );
  }
  
  private buildChatTab(containerEl: HTMLElement): void {
    // Chat settings - currently only save folder is implemented
    new Setting(containerEl)
      .setName('Chat Save Folder')
      .setDesc('Vault folder path to save conversations')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.chat.saveFolder)
          .onChange((value) => {
            this.plugin.settings.chat.saveFolder = value.trim();
            this.debouncedSave();
          }),
      );
  }
  
  private buildMCPTab(containerEl: HTMLElement): void {
    const mcpSection = containerEl.createDiv();
    this.buildMCPList(mcpSection);
  }
  
  private buildAdvancedTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Enable Plugin-Aware Generation')
      .setDesc(
        'Include active plugin list in LLM prompts to encourage compatible syntax. (Uses unofficial API)',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.pluginAwareEnabled)
          .onChange((value) => {
            this.plugin.settings.pluginAwareEnabled = value;
            this.debouncedSave();
          }),
      );
  }
  
  private buildProviderSettings(
    containerEl: HTMLElement,
    label: string,
    key: ProviderKey,
  ): void {
    const config = this.plugin.settings[key];
    const section = containerEl.createDiv({ cls: 'super-obsidian-settings-section' });
    section.createDiv({ cls: 'super-obsidian-settings-section-title', text: label });

    new Setting(section)
      .setName('Enabled')
      .addToggle((toggle) =>
        toggle.setValue(config.enabled).onChange((value) => {
          config.enabled = value;
          this.debouncedSave();
        }),
      );

    new Setting(section)
      .setName('API Key')
      .addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(config.apiKey)
          .onChange((value) => {
            config.apiKey = value.trim();
            this.debouncedSave();
          }),
      );

    new Setting(section)
      .setName('Base URL')
      .addText((text) =>
        text
          .setPlaceholder('https://api...')
          .setValue(config.baseUrl ?? '')
          .onChange((value) => {
            let url = value.trim();
            if (key === 'ollama' || key === 'ollamaCloud') {
              url = url.replace(/\/+$/, '');
              if (url.endsWith('/api')) {
                url = url.slice(0, -4);
              }
              url = url.replace(/\/+$/, '');
            }
            config.baseUrl = url || undefined;
            this.debouncedSave();
          }),
      );

    const modelListContainer = section.createDiv({ cls: 'super-obsidian-settings-model-list' });

    const statusContainer = section.createDiv({ cls: 'super-obsidian-settings-validation-status' });

    const renderModelList = (models: string[]) => {
      modelListContainer.empty();
      if (models.length === 0) {
        modelListContainer.setText('No models found.');
        return;
      }
      
      // Sort models alphabetically
      const sortedModels = [...models].sort((a, b) => a.localeCompare(b, 'en'));
      
      // Add model count header
      const header = modelListContainer.createDiv({ cls: 'super-obsidian-settings-model-list-header' });
      header.textContent = `${sortedModels.length} models available`;
      
      sortedModels.forEach((model) => {
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
        });
      });
    };

    // 초기 렌더링: 저장된 모델 + 캐시된 모델 리스트를 합쳐서 항상 보여줌
    const getInitialModels = () => {
      const cached = this.validationCache[key];
      const models = new Set<string>(config.models);
      if (cached && cached.valid && cached.models.length > 0) {
        cached.models.forEach(m => models.add(m));
      }
      return Array.from(models).sort((a, b) => a.localeCompare(b, 'en'));
    };
    renderModelList(getInitialModels());

    new Setting(section)
      .setName('Validate API Key')
      .addButton((button) => {
        button.setButtonText('Validate');
        button.onClick(async () => {
          statusContainer.setText('');
          button.setDisabled(true);
          const spinner = statusContainer.createSpan({ cls: 'super-obsidian-spinner' });

          try {
            const { validateProviderApi } = await import('./llm/validation');
            const result = await validateProviderApi(key, config);
            spinner.remove();

            if (result.valid) {
              statusContainer.setText(`✅ Valid! ${result.models.length} models found.`);
              renderModelList(result.models);
              this.validationCache[key] = result;
            } else {
              statusContainer.setText(`❌ Invalid: ${result.error}`);
              // 모델 리스트는 그대로 유지, 숨기지 않음
              this.validationCache[key] = {
                valid: false,
                models: this.validationCache[key]?.models ?? [],
                error: result.error,
              };
            }
          } catch (err) {
            spinner.remove();
            const msg = err instanceof Error ? err.message : String(err);
            statusContainer.setText(`❌ Error: ${msg}`);
            // 모델 리스트는 그대로 유지, 숨기지 않음
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }

  private buildMCPList(containerEl: HTMLElement): void {
    containerEl.empty();

    const mcpClientManager = new MCPClientManager();

    const statusSection = containerEl.createDiv({ cls: 'super-obsidian-mcp-status' });
    this.renderMCPStatus(statusSection);

    containerEl.createEl('h3', { text: t('mcpQuickTemplates'), cls: 'super-obsidian-mcp-section-title' });
    const presetSection = containerEl.createDiv({ cls: 'super-obsidian-mcp-presets' });
    for (const preset of MCP_PRESETS) {
      const presetBtn = presetSection.createEl('button', { text: preset.label, cls: 'super-obsidian-mcp-preset-btn' });
      presetBtn.addEventListener('click', () => {
        const existing = this.plugin.settings.mcpServers.find(s => s.name === preset.label);
        if (existing) {
          new Notice(`"${preset.label}" 서버가 이미 존재합니다.`);
          return;
        }
        this.plugin.settings.mcpServers.push({
          name: preset.label,
          transport: preset.config.transport ?? 'stdio',
          command: preset.config.command,
          args: preset.config.args,
          url: preset.config.url,
          enabled: false,
          token: undefined,
          registryUrl: undefined,
        });
        this.flushSave();
        this.buildMCPList(containerEl);
      });
    }

    containerEl.createEl('h3', { text: t('mcpCustom'), cls: 'super-obsidian-mcp-section-title' });

    for (let i = 0; i < this.plugin.settings.mcpServers.length; i++) {
      const server = this.plugin.settings.mcpServers[i];
      const row = containerEl.createDiv({ cls: 'super-obsidian-mcp-card' });

      const header = row.createDiv({ cls: 'super-obsidian-mcp-card-header' });
      const nameInput = header.createEl('input', { type: 'text', value: server.name, cls: 'super-obsidian-mcp-name-input' });
      nameInput.addEventListener('change', () => {
        server.name = nameInput.value.trim();
        this.debouncedSave();
      });

      const statusBadge = header.createDiv({ cls: `super-obsidian-mcp-status-badge ${server.enabled ? 'active' : 'inactive'}` });
      statusBadge.setText(server.enabled ? t('mcpActive') : t('mcpInactive'));

      new Setting(row)
        .setName(t('mcpTransport'))
        .setDesc(t('mcpTransportDesc'))
        .addDropdown((dropdown) =>
          dropdown
            .addOption('stdio', 'stdio')
            .addOption('sse', 'sse')
            .addOption('http', 'http')
            .setValue(server.transport)
            .onChange((value) => {
              server.transport = value as 'stdio' | 'sse' | 'http';
              this.debouncedSave();
              this.buildMCPList(containerEl);
            }),
        );

      new Setting(row)
        .setName(t('enabled'))
        .addToggle((toggle) =>
          toggle.setValue(server.enabled).onChange((value) => {
            server.enabled = value;
            this.debouncedSave();
            statusBadge.setText(server.enabled ? t('mcpActive') : t('mcpInactive'));
            statusBadge.className = `super-obsidian-mcp-status-badge ${server.enabled ? 'active' : 'inactive'}`;
          }),
        );

      if (server.transport === 'stdio') {
        new Setting(row)
          .setName(t('mcpCommand'))
          .setDesc(t('mcpCommandDesc'))
          .addText((text) =>
            text.setValue(server.command ?? '').onChange((value) => {
              server.command = value.trim();
              this.debouncedSave();
            }),
          );
        new Setting(row)
          .setName(t('mcpArgs'))
          .setDesc(t('mcpArgsDesc'))
          .addText((text) =>
            text.setValue((server.args ?? []).join(' ')).onChange((value) => {
              server.args = value.trim().split(/\s+/).filter(Boolean);
              this.debouncedSave();
            }),
          );
      } else {
        new Setting(row)
          .setName(t('mcpUrl'))
          .setDesc(t('mcpUrlDesc'))
          .addText((text) =>
            text.setValue(server.url ?? '').onChange((value) => {
              server.url = value.trim();
              this.debouncedSave();
            }),
          );
      }

      const testStatus = row.createDiv({ cls: 'super-obsidian-mcp-test-status' });
      new Setting(row)
        .setName(t('mcpConnectionTest'))
        .addButton((btn) => {
          btn.setButtonText(t('testConnection'));
          btn.onClick(async () => {
            testStatus.setText('');
            btn.setDisabled(true);
            testStatus.setText(t('testing'));

            try {
              const result = await mcpClientManager.testConnection(server);
              if (result.success) {
                testStatus.setText(`\u2705 ${t('mcpTestSuccess')}`);
              } else {
                testStatus.setText(`\u274c ${t('mcpTestFailed', { error: result.error ?? 'Unknown error' })}`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              testStatus.setText(`\u274c ${t('mcpTestError', { error: msg })}`);
            } finally {
              btn.setDisabled(false);
            }
          });
        });

      new Setting(row).addButton((btn) =>
        btn.setButtonText(t('deleteMcpServer')).setWarning().onClick(() => {
          this.plugin.settings.mcpServers.splice(i, 1);
          this.flushSave();
          this.buildMCPList(containerEl);
        }),
      );
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText(`+ ${t('addMcpServer')}`)
        .setCta()
        .onClick(() => {
          this.plugin.settings.mcpServers.push({
            name: `mcp-server-${this.plugin.settings.mcpServers.length + 1}`,
            transport: 'http',
            enabled: false,
            command: undefined,
            args: undefined,
            url: '',
            token: undefined,
            registryUrl: undefined,
          });
          this.flushSave();
          this.buildMCPList(containerEl);
        }),
    );
  }

  private renderMCPStatus(containerEl: HTMLElement): void {
    containerEl.empty();
    const enabledCount = this.plugin.settings.mcpServers.filter(s => s.enabled).length;
    const totalCount = this.plugin.settings.mcpServers.length;

    const statusBox = containerEl.createDiv({ cls: 'super-obsidian-mcp-status-box' });
    statusBox.createDiv({ cls: 'super-obsidian-mcp-status-title', text: t('mcpStatus') });
    statusBox.createDiv({
      cls: 'super-obsidian-mcp-status-count',
      text: t('mcpTotalActive', { count: enabledCount, total: totalCount }),
    });

    if (totalCount > 0) {
      const list = statusBox.createDiv({ cls: 'super-obsidian-mcp-status-list' });
      for (const server of this.plugin.settings.mcpServers) {
        const item = list.createDiv({ cls: 'super-obsidian-mcp-status-item' });
        void item.createDiv({ cls: `super-obsidian-mcp-status-dot ${server.enabled ? 'active' : 'inactive'}` });
        item.createSpan({ text: server.name, cls: 'super-obsidian-mcp-status-name' });
        item.createSpan({
          text: server.enabled ? t('mcpActive') : t('mcpInactive'),
          cls: `super-obsidian-mcp-status-label ${server.enabled ? 'active' : 'inactive'}`,
        });
      }
    }
  }
}
