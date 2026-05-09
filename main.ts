import { Plugin, Notice } from 'obsidian';
import {
  type SuperObsidianSettings,
  type ProviderConfig,
  DEFAULT_SETTINGS,
  SuperObsidianSettingTab,
} from './src/settings';
import {
  createProvider,
  type ProviderKey,
  type LLMProvider,
} from './src/llm/providers';
import {
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  CachedEmbeddingProvider,
  type EmbeddingProvider,
} from './src/llm/embedding';
import { JsonFileVectorStore, type VectorStore } from './src/rag/store';
import { VaultIndexer, registerModifyEvent } from './src/rag/indexer';
import { isExcludedExt } from './src/utils/vault';
import { RAGQueryEngine } from './src/rag/query';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { saveChat, type ChatMessage } from './src/chat/persistence';
import { executeDirective, parseDirective } from './src/chat/commands';
import { MCPClientManager } from './src/mcp/client';
import { MCPRegistry } from './src/mcp/registry';
import { setLanguage, t } from './src/i18n';

export default class SuperObsidianPlugin extends Plugin {
  settings!: SuperObsidianSettings;
  private provider: LLMProvider | null = null;
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  ragEngine: RAGQueryEngine | null = null;
  private vaultIndexer: VaultIndexer | null = null;
  mcpRegistry: MCPRegistry | null = null;
  private modifyCleanup: (() => void) | null = null;
  private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;

  // 실시간 통계 캐시 (이벤트 기반 업데이트)
  eventDrivenRagStats: {
    totalFiles: number;
    indexedFiles: number;
    pendingFiles: number;
    totalVectors: number;
  } | null = null;
  private statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.initProvider();
    this.initRAG();
    void this.initMCP();

    // 채팅 뷰 등록
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // 리본 아이콘
    this.addRibbonIcon('message-circle', t('cmdOpenAiChat'), () => {
      void this.openChatView();
    });

    // 명령어
    this.addCommand({
      id: 'open-ai-chat',
      name: t('cmdOpenAiChat'),
      callback: () => this.openChatView(),
    });

    this.addCommand({
      id: 'reindex-vault',
      name: t('cmdReindexVault'),
      callback: async () => {
        if (!this.vaultIndexer) {
          const rag = this.settings.rag;
          const providerKey = rag.embeddingProvider;
          let reason = 'RAG 인덱서가 초기화되지 않았습니다.';
          if (providerKey !== 'other') {
            const config = this.settings[providerKey as ProviderKey];
            if (!config?.enabled) {
              reason += ` Providers 탭에서 "${providerKey}"의 Enabled 토글을 켜주세요.`;
            } else if (!config.apiKey.trim()) {
              reason += ` Providers 탭에서 "${providerKey}"의 API Key를 입력하세요.`;
            } else if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
              reason += ` 임베딩 모델이 선택되지 않았습니다. 설정 → RAG에서 모델을 선택하고 저장하세요.`;
            } else {
              reason += ` "${providerKey}"(${rag.embeddingModel}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.`;
            }
          }
          new Notice(reason);
          return;
        }
        new Notice('볼트 인덱싱 시작...');
        try {
          const count = await this.vaultIndexer.reindexAll();
          new Notice(`${count}개 파일 인덱싱 완료`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`인덱싱 실패: ${msg}`);
        }
      },
    });

    this.addCommand({
      id: 'execute-ai-directive',
      name: t('cmdExecuteAiDirective'),
      editorCallback: async (editor) => {
        const line = editor.getLine(editor.getCursor().line);
        const directive = parseDirective(line);
        if (!directive) {
          new Notice(t('noDirectiveFound'));
          return;
        }
        await executeDirective(editor, this, directive);
      },
    });

    // 파일 변경 이벤트
    if (this.vaultIndexer) {
      this.modifyCleanup = registerModifyEvent(
        this.app.vault,
        this.vaultIndexer,
        () => {
          this.debouncedRefreshStats();
        },
      );
    }

    // 설정 탭
    this.addSettingTab(new SuperObsidianSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.modifyCleanup) {
      this.modifyCleanup();
      this.modifyCleanup = null;
    }
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.mcpRegistry) {
      void this.mcpRegistry.disconnectAll();
    }
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown>;
    const data = raw == null ? {} : { ...raw };

    const providerKeys = ['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'] as const;
    for (const pk of providerKeys) {
      const pConf = data[pk] as Record<string, unknown> | undefined;
      if (pConf && 'model' in pConf && Array.isArray(pConf.models) === false) {
        const rawModel = pConf.model;
        const oldModel = typeof rawModel === 'string' ? rawModel : '';
        pConf.models = oldModel ? [oldModel] : [];
      }
      if (pConf && typeof pConf.baseUrl === 'string') {
        let url = pConf.baseUrl.trim();
        if ((pk === 'ollama' || pk === 'ollamaCloud') && url === 'https://api.ollama.com') {
          url = 'https://ollama.com';
        }
        url = url.replace(/\/+$/, '');
        if (url.endsWith('/api')) {
          url = url.slice(0, -4);
        }
        url = url.replace(/\/+$/, '');
        pConf.baseUrl = url;
      }
    }

    const chat = data.chat;
    if (
      chat &&
      typeof chat === 'object' &&
      !Array.isArray(chat) &&
      'defaultProvider' in chat &&
      !('defaultModel' in chat)
    ) {
      const chatObj = chat as Record<string, unknown>;
      const rawProvider = chatObj.defaultProvider;
      const oldProvider = typeof rawProvider === 'string' ? rawProvider : '';
      const oldModel = ((data[oldProvider] as Record<string, unknown> | undefined)?.models as string[] | undefined)?.[0] ?? '';
      if (oldProvider && oldModel) {
        chatObj.defaultModel = `${oldProvider}:${oldModel}`;
      }
    }

    if (chat && typeof chat === 'object' && !Array.isArray(chat) && !('systemPrompt' in chat)) {
      (chat as Record<string, unknown>).systemPrompt = '';
    }

    // Migrate old RAG settings (pre-overhaul)
    const rag = data.rag as Record<string, unknown> | undefined;
    if (rag && typeof rag === 'object') {
      if (!('embeddingProvider' in rag)) {
        rag.embeddingProvider = 'openai';
      }
      if (!('embeddingModel' in rag)) {
        rag.embeddingModel = 'text-embedding-3-small';
      }
      if (typeof rag.autoUpdateEnabled !== 'boolean') {
        rag.autoUpdateEnabled = false;
      }
      if (typeof rag.autoUpdateIntervalMs !== 'number') {
        rag.autoUpdateIntervalMs = 300000;
      }
    }

    // Migrate old MCP settings to standard format
    const mcpServers = data.mcpServers as unknown[] | undefined;
    if (Array.isArray(mcpServers)) {
      const migrated: Array<{ name: string; command?: string; args?: string[]; env?: Record<string, string> }> = [];
      for (const s of mcpServers) {
        if (typeof s !== 'object' || s === null) continue;
        const server = s as Record<string, unknown>;
        // Skip non-stdio transports (HTTP/SSE servers are removed)
        const transport = server.transport;
        if (transport === 'http' || transport === 'sse') {
          continue;
        }
        const name = typeof server.name === 'string' ? server.name : '';
        const command = typeof server.command === 'string' ? server.command : undefined;
        const args = Array.isArray(server.args) ? server.args.filter((a): a is string => typeof a === 'string') : undefined;
        const env =
          typeof server.env === 'object' && server.env !== null && !Array.isArray(server.env)
            ? (Object.fromEntries(
                Object.entries(server.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
              ) as Record<string, string>)
            : undefined;
        if (name && command) {
          migrated.push({ name, command, args, env });
        }
      }
      data.mcpServers = migrated;
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SuperObsidianSettings>);
    setLanguage(this.settings.language);
  }

  async saveSettings(): Promise<{ success: boolean; mcpErrors?: string[] }> {
    await this.saveData(this.settings);
    this.initProvider();
    this.initRAG();
    const mcpErrors = await this.initMCP();
    return { success: mcpErrors.length === 0, mcpErrors };
  }

  getActiveProvider(): LLMProvider | null {
    if (this.provider) return this.provider;
    this.initProvider();
    return this.provider;
  }

  async saveChat(messages: ChatMessage[], sessionSystemPrompt?: string): Promise<void> {
    await saveChat(this.app.vault, messages, this.settings.chat.saveFolder, sessionSystemPrompt);
  }

  private initProvider(): void {
    const defaultModel = this.settings.chat.defaultModel;
    if (!defaultModel) {
      this.provider = null;
      return;
    }
    const parts = defaultModel.split(':');
    if (parts.length < 2) {
      this.provider = null;
      return;
    }
    const providerKey = parts[0] as ProviderKey;
    const modelName = parts.slice(1).join(':');

    const config = this.settings[providerKey];
    if (!config?.enabled || !config.models.includes(modelName)) {
      this.provider = null;
      return;
    }
    try {
      this.provider = createProvider(providerKey, config, modelName);
    } catch {
      this.provider = null;
    }
  }

  private debouncedRefreshStats(): void {
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
    }
    this.statsDebounceTimer = setTimeout(() => {
      void this.refreshStats();
    }, 500);
  }

  private async refreshStats(): Promise<void> {
    if (!this.vectorStore) return;
    try {
      const rag = this.settings.rag;
      const { getMarkdownFilesFiltered } = await import('./src/utils/vault');
      const allFiles = getMarkdownFilesFiltered(this.app.vault, rag.excludePaths).filter(
        (f) => !isExcludedExt(f.path, rag.excludeExts),
      );
      const totalFiles = allFiles.length;

      const indexedPaths = await this.vectorStore.getIndexedFilePaths();
      const indexedFiles = indexedPaths.length;

      const stats = await this.vectorStore.getStats();
      const totalVectors = stats.totalEntries;

      this.eventDrivenRagStats = {
        totalFiles,
        indexedFiles,
        pendingFiles: Math.max(0, totalFiles - indexedFiles),
        totalVectors,
      };

      const appWithSetting = this.app as unknown as { setting?: { activeTab?: { refreshStats?(): void } } };
      if (appWithSetting.setting?.activeTab?.refreshStats) {
        appWithSetting.setting.activeTab.refreshStats();
      }
    } catch {
      /* empty */
    }
  }

  private initRAG(): void {
    // NOTE: We intentionally do NOT call vectorStore.clear() or embeddingProvider.clearCache()
    // here. Clearing embeddings must only happen via explicit user action (the "Clear Embedding Data"
    // button or "Reindex All" command). Re-initializing RAG with a new provider/model must
    // preserve existing vector store data so users can incrementally reindex.

    // Clear any existing timer
    this.clearRAG();

    const rag = this.settings.rag;
    const providerKey = rag.embeddingProvider;

    // Resolve config for known providers (use provider tab settings)
    let config: ProviderConfig | null = null;
    if (providerKey !== 'other') {
      config = this.settings[providerKey as ProviderKey];
      if (!config?.enabled) {
        console.warn(`[Super-Obsidian] RAG embedding provider "${providerKey}" is disabled.`);
        return;
      }
    }

    let baseUrl: string | undefined;
    let apiKey = '';
    if (config) {
      baseUrl = config.baseUrl;
      apiKey = config.apiKey;
    }

    // Create embedding provider
    let rawProvider: EmbeddingProvider;
    if (providerKey === 'ollama') {
      rawProvider = new OllamaEmbeddingProvider(baseUrl, rag.embeddingModel, apiKey);
    } else {
      // openai, openRouter, other all use OpenAI-compatible endpoint
      rawProvider = new OpenAIEmbeddingProvider(apiKey, baseUrl, rag.embeddingModel);
    }

    this.embeddingProvider = new CachedEmbeddingProvider(rawProvider, rag.embeddingModel);

    // Vector store
    this.vectorStore = new JsonFileVectorStore(
      this.app.vault.adapter,
      '.super-obsidian/vectors.json',
    );

    // RAG engine
    this.ragEngine = new RAGQueryEngine(this.vectorStore, this.embeddingProvider);

    // Indexer
    this.vaultIndexer = new VaultIndexer(
      this.app.vault,
      this.vectorStore,
      this.embeddingProvider,
      this.settings.rag,
    );

    // Auto-update timer
    this.setupAutoUpdate();
  }

  private clearRAG(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    this.vectorStore = null;
    this.embeddingProvider = null;
    this.ragEngine = null;
    this.vaultIndexer = null;
  }

  private setupAutoUpdate(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.settings.rag.autoUpdateEnabled && this.vaultIndexer) {
      this.autoUpdateTimer = setInterval(
        () => {
          void this.vaultIndexer!.indexPending();
        },
        this.settings.rag.autoUpdateIntervalMs,
      );
    }
  }

  private async initMCP(): Promise<string[]> {
    const errors = await this.runMcpConnections();
    return errors;
  }

  async reconnectMCP(): Promise<string[]> {
    const errors = await this.runMcpConnections();
    return errors;
  }

  private async runMcpConnections(): Promise<string[]> {
    const errors: string[] = [];

    if (this.mcpRegistry) {
      try {
        await this.mcpRegistry.disconnectAll();
      } catch {
        /* ignore disconnect errors */
      }
    }
    this.mcpRegistry = new MCPRegistry(this.settings.mcpServers);

    const promises = [];
    for (const server of this.mcpRegistry.getEnabledServers()) {
      const client = new MCPClientManager();
      this.mcpRegistry.setClient(server.name, client);

      const promise = (async () => {
        try {
          if (!server.command) {
            throw new Error('Command is required for stdio transport');
          }

          const effectivePath = this.settings.mcpPath || process.env.PATH || '';
          const env: Record<string, string> = {
            ...(server.env || {}),
            PATH: server.env?.PATH || effectivePath,
          };

          await client.connectStdio({
            name: server.name,
            command: server.command,
            args: server.args,
            env,
          });
          this.mcpRegistry!.setConnectionStatus(server.name, 'connected');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.mcpRegistry!.setConnectionStatus(server.name, 'error');
          errors.push(`${server.name}: ${msg}`);
        }
      })();

      promises.push(promise);
    }

    await Promise.all(promises);
    return errors;
  }

  private async openChatView(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return Promise.resolve();
  }
}
