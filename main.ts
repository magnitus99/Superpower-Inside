import { Plugin, Notice } from 'obsidian';
import { getEffectiveExcludePaths } from './src/utils/vault';
import {
  type SuperObsidianSettings,
  type ProviderConfig,
  DEFAULT_SETTINGS,
  SuperObsidianSettingTab,
} from './src/settings';
import { shouldShowProviderApiKey } from './src/rag/settings-display';
import {
  createCustomOpenAIProvider,
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
import { IndexedDbVectorStore, JsonFileVectorStore, type VectorStore } from './src/rag/store';
import { JsonFileBM25Index } from './src/rag/bm25';
import {
  VaultIndexer,
  registerModifyEvent,
  registerDeleteEvent,
  registerRenameEvent,
} from './src/rag/indexer';
import { calculateRagStatus, type RagStatusSummary } from './src/rag/status';
import { RAGQueryEngine } from './src/rag/query';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { executeDirective, parseDirective } from './src/chat/commands';
import { normalizePromptLibrary } from './src/chat/prompt-library';
import { MCPClientManager } from './src/mcp/client';
import { MCPRegistry } from './src/mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  getMcpConnectionState,
  type MCPConnectionState,
} from './src/mcp/connection-state';
import { setLanguage, t } from './src/i18n';

const MCP_AUTO_RETRY_DELAYS_MS = [2000, 5000] as const;

export default class SuperObsidianPlugin extends Plugin {
  settings!: SuperObsidianSettings;
  private provider: LLMProvider | null = null;
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  ragEngine: RAGQueryEngine | null = null;
  private vaultIndexer: VaultIndexer | null = null;
  mcpRegistry: MCPRegistry | null = null;
  mcpConnectionState: MCPConnectionState = 'idle';
  mcpLastErrors: string[] = [];
  private mcpConnectionRunId = 0;
  private mcpRetryTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private modifyCleanup: (() => void) | null = null;
  private deleteCleanup: (() => void) | null = null;
  private renameCleanup: (() => void) | null = null;
  private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;

  // 실시간 통계 캐시 (이벤트 기반 업데이트)
  eventDrivenRagStats: RagStatusSummary | null = null;
  private statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.initProvider();
    void this.initRAG();
    void this.initMCP()
      .then((errors) => {
        if (errors.length > 0) {
          new Notice(`MCP 자동 연결 실패: ${errors.length}개 서버를 확인하세요.`, 10000);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`MCP 자동 연결 실패: ${msg}`, 10000);
      });

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
            } else if (shouldShowProviderApiKey(providerKey) && !config.apiKey.trim()) {
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

    const effectiveExcludePaths = getEffectiveExcludePaths(this.settings.rag, this.settings.chat);

    // 파일 변경 이벤트
    if (this.vaultIndexer) {
      this.modifyCleanup = registerModifyEvent(
        this.app.vault,
        this.vaultIndexer,
        effectiveExcludePaths,
        () => {
          this.debouncedRefreshStats();
        },
      );
    }

    // 파일 삭제/이름 변경 이벤트
    if (this.vaultIndexer && this.vectorStore) {
      this.deleteCleanup = registerDeleteEvent(
        this.app.vault,
        this.vectorStore,
        effectiveExcludePaths,
        () => {
          this.debouncedRefreshStats();
        },
      );
      this.renameCleanup = registerRenameEvent(
        this.app.vault,
        this.vaultIndexer,
        this.vectorStore,
        effectiveExcludePaths,
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
    if (this.deleteCleanup) {
      this.deleteCleanup();
      this.deleteCleanup = null;
    }
    if (this.renameCleanup) {
      this.renameCleanup();
      this.renameCleanup = null;
    }
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.mcpRegistry) {
      void this.mcpRegistry.disconnectAll();
    }
    this.mcpConnectionRunId++;
    this.clearMcpRetryTimers();
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

    const customOpenAIProviders = data.customOpenAIProviders;
    if (Array.isArray(customOpenAIProviders)) {
      data.customOpenAIProviders = customOpenAIProviders
        .filter((provider): provider is Record<string, unknown> => {
          return typeof provider === 'object' && provider !== null && !Array.isArray(provider);
        })
        .map((provider, index) => {
          const id =
            typeof provider.id === 'string' && provider.id ? provider.id : `custom-${index + 1}`;
          const name =
            typeof provider.name === 'string' && provider.name.trim()
              ? provider.name.trim()
              : 'Custom OpenAI-Compatible';
          const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
          const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';
          const models = Array.isArray(provider.models)
            ? provider.models.filter((model): model is string => typeof model === 'string')
            : [];
          const enabled = typeof provider.enabled === 'boolean' ? provider.enabled : false;
          return { id, name, apiKey, baseUrl, models, enabled };
        });
    } else {
      data.customOpenAIProviders = [];
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
      const oldModel =
        (
          (data[oldProvider] as Record<string, unknown> | undefined)?.models as string[] | undefined
        )?.[0] ?? '';
      if (oldProvider && oldModel) {
        chatObj.defaultModel = `${oldProvider}:${oldModel}`;
      }
    }

    if (chat && typeof chat === 'object' && !Array.isArray(chat) && !('systemPrompt' in chat)) {
      (chat as Record<string, unknown>).systemPrompt = '';
    }
    if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
      const chatObj = chat as Record<string, unknown>;
      if (chatObj.saveFolder === 'SuperObsidianByAI') {
        chatObj.saveFolder = 'SuperObsidianByAIChats';
      }
      const migratedPromptLibrary = normalizePromptLibrary(
        chatObj.promptLibrary,
        chatObj.activePromptId,
        typeof chatObj.systemPrompt === 'string' ? chatObj.systemPrompt : '',
      );
      chatObj.promptLibrary = migratedPromptLibrary.promptLibrary;
      chatObj.activePromptId = migratedPromptLibrary.activePromptId;
    }
    if (
      chat &&
      typeof chat === 'object' &&
      !Array.isArray(chat) &&
      !('mcpToolExecutionPolicy' in chat)
    ) {
      (chat as Record<string, unknown>).mcpToolExecutionPolicy = 'mentioned-auto';
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
      if (typeof rag.autoUpdateIntervalMin !== 'number') {
        rag.autoUpdateIntervalMin = 5;
      }
      if (typeof rag.excludeChatFolder !== 'boolean') {
        rag.excludeChatFolder = true;
      }
      if (Array.isArray(rag.excludePaths)) {
        for (const path of ['SuperObsidianByAI', 'SuperObsidianByAIChats']) {
          if (!rag.excludePaths.includes(path)) {
            rag.excludePaths.push(path);
          }
        }
      }
      rag.autoUpdateIntervalMin = Math.max(1, Math.min(99, rag.autoUpdateIntervalMin as number));
      if ('autoUpdateIntervalMs' in rag && !('autoUpdateIntervalMin' in rag)) {
        rag.autoUpdateIntervalMin = Math.max(
          1,
          Math.min(99, Math.round((rag.autoUpdateIntervalMs as number) / 60000)),
        );
        delete rag.autoUpdateIntervalMs;
      }
      if (typeof rag.minScore !== 'number') {
        rag.minScore = 0.5;
      }
      if (typeof rag.enableBM25 !== 'boolean') {
        rag.enableBM25 = true;
      }
      if (typeof rag.bm25Weight !== 'number') {
        rag.bm25Weight = 0.3;
      }
    }

    // Migrate enforceMcpTools
    if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
      const chatObj = chat as Record<string, unknown>;
      if (typeof chatObj.enforceMcpTools !== 'boolean') {
        chatObj.enforceMcpTools = true;
      }
    }

    // Migrate old MCP settings to standard format
    const mcpServers = data.mcpServers as unknown[] | undefined;
    if (Array.isArray(mcpServers)) {
      const migrated: Array<{
        name: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      }> = [];
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
        const args = Array.isArray(server.args)
          ? server.args.filter((a): a is string => typeof a === 'string')
          : undefined;
        const env =
          typeof server.env === 'object' && server.env !== null && !Array.isArray(server.env)
            ? (Object.fromEntries(
                Object.entries(server.env).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
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
    void this.initRAG();
    const mcpErrors = await this.initMCP();
    return { success: mcpErrors.length === 0, mcpErrors };
  }

  getActiveProvider(): LLMProvider | null {
    if (this.provider) return this.provider;
    this.initProvider();
    return this.provider;
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

    if (parts[0] === 'customOpenAI') {
      if (parts.length < 3) {
        this.provider = null;
        return;
      }
      const providerId = parts[1];
      const customModelName = parts.slice(2).join(':');
      const customProvider = this.settings.customOpenAIProviders.find(
        (provider) => provider.id === providerId,
      );
      if (
        !customProvider?.enabled ||
        !customProvider.models.includes(customModelName) ||
        !customProvider.baseUrl?.trim()
      ) {
        this.provider = null;
        return;
      }
      try {
        this.provider = createCustomOpenAIProvider(customProvider, customModelName);
      } catch {
        this.provider = null;
      }
      return;
    }

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
      this.eventDrivenRagStats = await calculateRagStatus(
        this.app.vault,
        this.vectorStore,
        this.settings.rag,
        this.settings.chat,
      );

      const appWithSetting = this.app as unknown as {
        setting?: { activeTab?: { refreshStats?(): void } };
      };
      if (appWithSetting.setting?.activeTab?.refreshStats) {
        appWithSetting.setting.activeTab.refreshStats();
      }
    } catch {
      /* empty */
    }
  }

  async initRAG(): Promise<void> {
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
    if (config && providerKey !== 'other' && shouldShowProviderApiKey(providerKey)) {
      apiKey = config.apiKey;
    }
    if (providerKey === 'openai') {
      baseUrl = 'https://api.openai.com';
    } else if (providerKey === 'openRouter') {
      baseUrl = 'https://openrouter.ai/api';
    } else if (providerKey === 'ollama') {
      baseUrl = 'http://localhost:11434';
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
    this.vectorStore =
      rag.vectorStoreType === 'indexeddb'
        ? new IndexedDbVectorStore()
        : new JsonFileVectorStore(this.app.vault.adapter, '.super-obsidian/vectors.json');

    // BM25 index
    let bm25Index: JsonFileBM25Index | undefined;
    if (rag.enableBM25) {
      bm25Index = new JsonFileBM25Index(
        this.app.vault.adapter,
        '.super-obsidian/bm25-index.json',
      );
      await bm25Index.load();
    }

    // RAG engine
    this.ragEngine = new RAGQueryEngine(
      this.vectorStore,
      this.embeddingProvider,
      bm25Index,
      rag.bm25Weight,
      rag.minScore,
    );

    // Indexer
    this.vaultIndexer = new VaultIndexer(
      this.app.vault,
      this.vectorStore,
      this.embeddingProvider,
      this.settings.rag,
      this.settings.chat,
      bm25Index,
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

  setupAutoUpdate(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.settings.rag.autoUpdateEnabled && this.vaultIndexer) {
      this.autoUpdateTimer = setInterval(() => {
        void this.autoIndex();
      }, this.settings.rag.autoUpdateIntervalMin * 60000);
    }
  }

  private async autoIndex(): Promise<void> {
    if (!this.vaultIndexer || !this.vectorStore) return;
    try {
      const status = await calculateRagStatus(
        this.app.vault,
        this.vectorStore,
        this.settings.rag,
        this.settings.chat,
      );
      if (status.updateRequiredDocuments.length === 0) {
        return;
      }
      new Notice(t('autoUpdateIndexingStarted'));
      const result = await this.vaultIndexer.indexPending();
      if (result.indexed > 0) {
        new Notice(`${result.indexed}${t('autoUpdateIndexingDone')}`);
      }
      void this.refreshStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`${t('autoUpdateIndexingFailed')}: ${msg}`, 10000);
    }
  }

  private async initMCP(): Promise<string[]> {
    const errors = await this.runMcpConnections({ retryFailed: true });
    return errors;
  }

  async reconnectMCP(): Promise<string[]> {
    const errors = await this.runMcpConnections({ retryFailed: false });
    return errors;
  }

  private async runMcpConnections(options: { retryFailed: boolean }): Promise<string[]> {
    const runId = ++this.mcpConnectionRunId;
    this.clearMcpRetryTimers();

    if (this.mcpRegistry) {
      try {
        await this.mcpRegistry.disconnectAll();
      } catch {
        /* ignore disconnect errors */
      }
    }
    this.mcpRegistry = new MCPRegistry(this.settings.mcpServers);
    this.setMcpConnectionState('connecting', []);

    let errors = await this.connectMcpServers(this.mcpRegistry.getEnabledServers(), runId);

    if (options.retryFailed) {
      for (const delayMs of MCP_AUTO_RETRY_DELAYS_MS) {
        if (runId !== this.mcpConnectionRunId || errors.length === 0 || !this.mcpRegistry) {
          break;
        }

        const shouldContinue = await this.sleepForMcpRetry(delayMs, runId);
        if (!shouldContinue || runId !== this.mcpConnectionRunId || !this.mcpRegistry) {
          break;
        }

        const failedServers = this.mcpRegistry
          .getFailedServerNames()
          .map((name) => this.mcpRegistry?.getServer(name))
          .filter((server): server is NonNullable<typeof server> => server !== undefined);

        if (failedServers.length === 0) {
          break;
        }

        this.setMcpConnectionState('connecting', errors);
        errors = await this.connectMcpServers(failedServers, runId);
      }
    }

    this.refreshMcpConnectionState();
    return errors;
  }

  private async connectMcpServers(
    servers: SuperObsidianSettings['mcpServers'],
    runId: number,
  ): Promise<string[]> {
    const registry = this.mcpRegistry;
    if (!registry) return [];

    const errors: string[] = [];
    const promises = servers.map(async (server) => {
      const previousClient = registry.getClient(server.name);
      if (previousClient) {
        try {
          await previousClient.disconnect();
        } catch {
          // 이전 연결 정리 실패는 새 연결 시도를 막지 않는다.
        }
      }

      const client = new MCPClientManager();
      registry.setClient(server.name, client);
      registry.setConnectionStatus(server.name, 'connecting');
      this.refreshMcpConnectionState();

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

        if (runId !== this.mcpConnectionRunId) {
          await client.disconnect();
          return;
        }

        registry.setConnectionStatus(server.name, 'connected');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (runId !== this.mcpConnectionRunId) return;
        registry.setConnectionStatus(server.name, 'error', msg);
        errors.push(`${server.name}: ${msg}`);
      } finally {
        if (runId === this.mcpConnectionRunId) {
          this.refreshMcpConnectionState();
        }
      }
    });

    await Promise.all(promises);
    return errors;
  }

  private setMcpConnectionState(state: MCPConnectionState, errors: string[]): void {
    this.mcpConnectionState = state;
    this.mcpLastErrors = errors;
    this.app.workspace.trigger(MCP_STATUS_CHANGE_EVENT, {
      state: this.mcpConnectionState,
      errors: this.mcpLastErrors,
    });
  }

  private refreshMcpConnectionState(): void {
    const registry = this.mcpRegistry;
    if (!registry) {
      this.setMcpConnectionState('idle', []);
      return;
    }

    const servers = registry.getEnabledServers();
    const errors = registry
      .getFailedServerNames()
      .map((name) => `${name}: ${registry.getLastError(name) ?? 'Unknown error'}`);

    this.setMcpConnectionState(
      getMcpConnectionState({
        totalCount: servers.length,
        connectedCount: registry.getConnectedCount(),
        failedCount: registry.getErrorCount(),
        isConnecting: registry.isConnecting(),
      }),
      errors,
    );
  }

  private sleepForMcpRetry(delayMs: number, runId: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (runId !== this.mcpConnectionRunId) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        this.mcpRetryTimers.delete(timer);
        resolve(runId === this.mcpConnectionRunId);
      }, delayMs);
      this.mcpRetryTimers.set(timer, () => {
        clearTimeout(timer);
        this.mcpRetryTimers.delete(timer);
      });
    });
  }

  private clearMcpRetryTimers(): void {
    for (const [, cancel] of this.mcpRetryTimers) {
      cancel();
    }
    this.mcpRetryTimers.clear();
  }

  private async openChatView(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return Promise.resolve();
  }
}
