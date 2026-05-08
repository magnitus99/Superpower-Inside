import { App, PluginSettingTab, Setting, type Plugin } from 'obsidian';

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  enabled: boolean;
}

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface RAGConfig {
  excludePaths: string[];
  excludeExts: string[];
  chunkSize: number;
  overlap: number;
  vectorStoreType: 'json' | 'indexeddb';
}

export interface ChatConfig {
  saveFolder: string;
  defaultProvider: string;
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
}

export interface PluginLike {
  app: App;
  settings: SuperObsidianSettings;
  saveSettings(): Promise<void>;
}

export const DEFAULT_SETTINGS: SuperObsidianSettings = {
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    enabled: false,
  },
  claude: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-20241022',
    enabled: false,
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1',
    enabled: false,
  },
  ollamaCloud: {
    apiKey: '',
    baseUrl: 'https://api.ollama.com',
    model: 'llama3.1',
    enabled: false,
  },
  openRouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    model: 'openrouter/auto',
    enabled: false,
  },
  rag: {
    excludePaths: ['.git', 'node_modules', '.obsidian', 'attachments'],
    excludeExts: ['png', 'jpg', 'jpeg', 'gif', 'pdf', 'mp4', 'zip'],
    chunkSize: 1000,
    overlap: 100,
    vectorStoreType: 'json',
  },
  mcpServers: [],
  chat: {
    saveFolder: 'chats',
    defaultProvider: 'openai',
  },
  pluginAwareEnabled: false,
};

// Tab Types and Configuration
type SettingsTabId = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced';

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'providers', label: 'Providers' },
  { id: 'rag', label: 'RAG' },
  { id: 'chat', label: 'Chat' },
  { id: 'mcp', label: 'MCP' },
  { id: 'advanced', label: 'Advanced' },
];

export class SuperObsidianSettingTab extends PluginSettingTab {
  private plugin: PluginLike;
  
  // Tab Management Properties
  private activeTab: SettingsTabId = 'general';
  private tabButtons: Map<SettingsTabId, HTMLButtonElement> = new Map();
  private tabPanels: Map<SettingsTabId, HTMLDivElement> = new Map();

  constructor(app: App, plugin: PluginLike) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    // Header
    containerEl.createEl('h2', { text: 'Super Obsidian by AI — Settings' });
    
    // Security Warning
    const warning = containerEl.createDiv({
      cls: 'super-obsidian-settings-warning',
    });
    warning.setText(
      'Warning: API keys are stored in plain text in data.json. Be aware of sensitive information exposure.',
    );
    
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
  }
  
  private buildGeneralTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Default LLM Provider')
      .setDesc('Default provider for chat and commands')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('claude', 'Claude')
          .addOption('ollama', 'Ollama (Local)')
          .addOption('ollamaCloud', 'Ollama (Cloud)')
          .addOption('openRouter', 'OpenRouter')
          .setValue(this.plugin.settings.chat.defaultProvider)
          .onChange(async (value) => {
            this.plugin.settings.chat.defaultProvider = value;
            await this.plugin.saveSettings();
          }),
      );
  }
  
  private buildProvidersTab(containerEl: HTMLElement): void {
    this.buildProviderSettings(containerEl, 'OpenAI', 'openai');
    this.buildProviderSettings(containerEl, 'Claude (Anthropic)', 'claude');
    this.buildProviderSettings(containerEl, 'Ollama (Local)', 'ollama');
    this.buildProviderSettings(containerEl, 'Ollama (Cloud)', 'ollamaCloud');
    this.buildProviderSettings(containerEl, 'OpenRouter', 'openRouter');
  }
  
  private buildRAGTab(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Exclude Paths')
      .setDesc('Folders to exclude from indexing, comma-separated')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.rag.excludePaths.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.rag.excludePaths = value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Exclude Extensions')
      .setDesc('Extensions to exclude from indexing, comma-separated')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.rag.excludeExts.join(', '))
          .onChange(async (value) => {
            this.plugin.settings.rag.excludeExts = value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Chunk Size')
      .setDesc('Max characters per markdown chunk')
      .addSlider((slider) =>
        slider
          .setLimits(100, 5000, 100)
          .setValue(this.plugin.settings.rag.chunkSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rag.chunkSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Vector Store Type')
      .setDesc('IndexedDB works on desktop/mobile but does not sync with Obsidian Sync')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('json', 'JSON File (vault.adapter)')
          .addOption('indexeddb', 'IndexedDB (Dexie)')
          .setValue(this.plugin.settings.rag.vectorStoreType)
          .onChange(async (value) => {
            this.plugin.settings.rag.vectorStoreType = value as 'json' | 'indexeddb';
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.chat.saveFolder = value.trim();
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.pluginAwareEnabled = value;
            await this.plugin.saveSettings();
          }),
      );
  }
  
  private buildProviderSettings(
    containerEl: HTMLElement,
    label: string,
    key: keyof Omit<
      SuperObsidianSettings,
      'rag' | 'mcpServers' | 'chat' | 'pluginAwareEnabled'
    >,
  ): void {
    const config = this.plugin.settings[key];
    const section = containerEl.createDiv({ cls: 'super-obsidian-settings-section' });
    section.createDiv({ cls: 'super-obsidian-settings-section-title', text: label });

    new Setting(section)
      .setName('Enabled')
      .addToggle((toggle) =>
        toggle.setValue(config.enabled).onChange(async (value) => {
          config.enabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(section)
      .setName('API Key')
      .addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(config.apiKey)
          .onChange(async (value) => {
            config.apiKey = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(section)
      .setName('Base URL')
      .addText((text) =>
        text
          .setPlaceholder('https://api...')
          .setValue(config.baseUrl ?? '')
          .onChange(async (value) => {
            config.baseUrl = value.trim() || undefined;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(section)
      .setName('Model')
      .addText((text) =>
        text
          .setPlaceholder('gpt-4o-mini')
          .setValue(config.model)
          .onChange(async (value) => {
            config.model = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }

  private buildMCPList(containerEl: HTMLElement): void {
    containerEl.empty();

    for (let i = 0; i < this.plugin.settings.mcpServers.length; i++) {
      const server = this.plugin.settings.mcpServers[i];
      const row = containerEl.createDiv({ cls: 'super-obsidian-settings-section' });

      row.createEl('strong', { text: server.name || `Server ${i + 1}` });

      new Setting(row)
        .setName('Enabled')
        .addToggle((toggle) =>
          toggle.setValue(server.enabled).onChange(async (value) => {
            server.enabled = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(row)
        .setName('Transport')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('stdio', 'stdio')
            .addOption('sse', 'sse')
            .addOption('http', 'http')
            .setValue(server.transport)
            .onChange(async (value) => {
              server.transport = value as 'stdio' | 'sse' | 'http';
              await this.plugin.saveSettings();
              this.buildMCPList(containerEl);
            }),
        );

      if (server.transport === 'stdio') {
        new Setting(row)
          .setName('Command')
          .addText((text) =>
            text.setValue(server.command ?? '').onChange(async (value) => {
              server.command = value.trim();
              await this.plugin.saveSettings();
            }),
          );
        new Setting(row)
          .setName('Arguments')
          .addText((text) =>
            text.setValue((server.args ?? []).join(' ')).onChange(async (value) => {
              server.args = value.trim().split(/\s+/).filter(Boolean);
              await this.plugin.saveSettings();
            }),
          );
      } else {
        new Setting(row)
          .setName('URL')
          .addText((text) =>
            text.setValue(server.url ?? '').onChange(async (value) => {
              server.url = value.trim();
              await this.plugin.saveSettings();
            }),
          );
      }

      new Setting(row).addButton((btn) =>
        btn.setButtonText('Delete').onClick(async () => {
          this.plugin.settings.mcpServers.splice(i, 1);
          await this.plugin.saveSettings();
          this.buildMCPList(containerEl);
        }),
      );
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText('+ Add MCP Server')
        .setCta()
        .onClick(async () => {
          this.plugin.settings.mcpServers.push({
            name: `mcp-server-${this.plugin.settings.mcpServers.length + 1}`,
            transport: 'http',
            enabled: true,
          });
          await this.plugin.saveSettings();
          this.buildMCPList(containerEl);
        }),
    );
  }
}
