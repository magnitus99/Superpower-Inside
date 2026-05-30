import { Plugin, Notice, Platform, TFile } from 'obsidian';
import { getEffectiveExcludePaths } from './src/utils/vault';
import {
  type SuperpowerInsideSettings,
  type ProviderConfig,
  type CustomOpenAIProviderConfig,
  type EmbeddingProviderKey,
  DEFAULT_SETTINGS,
  getCustomOpenAIEmbeddingProviderId,
  isCustomOpenAIEmbeddingProviderKey,
  normalizeChatSaveFolder,
  SuperpowerInsideSettingTab,
} from './src/settings';
import {
  normalizeRagPerformanceTuningMode,
  resolveRagPerformanceSettings,
  shouldRequireProviderApiKey,
  shouldShowProviderApiKey,
  getGraphRagStatusPresentation,
} from './src/rag/settings-display';
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
  isIndexingCancelledError,
  type IndexingResult,
} from './src/rag/indexer';
import { calculateRagStatus, type RagStatusSummary } from './src/rag/status';
import { RAGQueryEngine } from './src/rag/query';
import { GraphRagIndexingRunner, type GraphRagCommunityBuildResult, type GraphRagIndexingResult } from './src/graph/indexing-runner';
import { GraphRagQueryEngine } from './src/graph/query-engine';
import { calculateGraphRagStatus, type GraphRagStatusSummary } from './src/graph/status';
import { IndexedDbKnowledgeGraphStore, type KnowledgeGraphStore } from './src/graph/store';
import { DEFAULT_ONTOLOGY_SCHEMA, validateOntologySchema } from './src/ontology/schema';
import { PerformanceGuard, type PerformanceGuardState } from './src/rag/performance-guard';
import { RAGIndexingScheduler, type RagIndexingSchedulerStatus } from './src/rag/indexing-scheduler';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { GRAPH_RAG_VIEW_TYPE, GraphRagView } from './src/graph/view';
import { normalizePromptLibrary } from './src/chat/prompt-library';
import { MCPRegistry } from './src/mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  getMcpConnectionState,
  type MCPConnectionState,
} from './src/mcp/connection-state';
import { shouldAppendMcpPathHint } from './src/mcp/errors';
import { MCP_DESKTOP_ONLY_MESSAGE, isMcpStdioAvailable } from './src/mcp/platform';
import { setLanguage, t } from './src/i18n';
import { RefreshBus } from './src/utils/refresh-bus';
import {
  loadLocalSettings,
  removeLegacyDataJson,
  saveLocalSettings,
} from './src/settings-storage';

const MCP_AUTO_RETRY_DELAYS_MS = [2000, 5000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default class SuperpowerInsidePlugin extends Plugin {
  settings!: SuperpowerInsideSettings;
  private provider: LLMProvider | null = null;
  vectorStore: VectorStore | null = null;
  knowledgeGraphStore: KnowledgeGraphStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  ragEngine: RAGQueryEngine | null = null;
  graphRagStatus: GraphRagStatusSummary | null = null;
  private graphRagIndexingRunner: GraphRagIndexingRunner | null = null;
  private graphRagAbortController: AbortController | null = null;
  private vaultIndexer: VaultIndexer | null = null;
  private ragIndexingScheduler: RAGIndexingScheduler | null = null;
  private ragPerformanceGuard: PerformanceGuard | null = null;
  ragIndexingStatus: RagIndexingSchedulerStatus | null = null;
  nextAutoUpdateAt: number | null = null;
  lastAutoUpdateSkippedReason: string | null = null;
  lastAutoUpdateResult: IndexingResult | null = null;
  mcpRegistry: MCPRegistry | null = null;
  mcpConnectionState: MCPConnectionState = 'idle';
  mcpLastErrors: string[] = [];
  private mcpConnectionRunId = 0;
  private mcpRetryTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private modifyCleanup: (() => void) | null = null;
  private deleteCleanup: (() => void) | null = null;
  private renameCleanup: (() => void) | null = null;
  private autoUpdateTimer: ReturnType<typeof setInterval> | null = null;
  private ragStatusTimer: ReturnType<typeof setInterval> | null = null;
  private ragIndexAbortController: AbortController | null = null;

  // 실시간 통계 캐시 (이벤트 기반 업데이트)
  eventDrivenRagStats: RagStatusSummary | null = null;
  private statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  refreshBus: RefreshBus = new RefreshBus();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.initProvider();
    await this.initRAG();
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
    this.registerView(GRAPH_RAG_VIEW_TYPE, (leaf) => new GraphRagView(leaf, this));
    this.addRibbonIcon('message-circle', t('cmdOpenAiChat'), () => {
      void this.openChatView();
    });

    this.addRibbonIcon('git-branch', t('cmdOpenGraphRagView'), () => {
      void this.openGraphRagView();
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
          const config = this.getEmbeddingProviderConfig(providerKey);
          const providerLabel = this.getEmbeddingProviderLabel(providerKey);
          const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
            ? 'customOpenAI'
            : providerKey;
          if (!config?.enabled) {
            reason += ` Providers 탭에서 "${providerLabel}"의 Enabled 토글을 켜주세요.`;
          } else if (shouldRequireProviderApiKey(apiKeyVisibilityKey) && !config.apiKey.trim()) {
            reason += ` Providers 탭에서 "${providerLabel}"의 API Key를 입력하세요.`;
          } else if (rag.embeddingModel === '' || !rag.embeddingModel.trim()) {
            reason += ` 임베딩 모델이 선택되지 않았습니다. 설정 → RAG에서 모델을 선택하고 저장하세요.`;
          } else {
            reason += ` "${providerLabel}"(${rag.embeddingModel}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.`;
          }
          new Notice(reason);
          return;
        }
        if (this.isRagIndexing()) return;
        try {
          const status = this.vectorStore
            ? await calculateRagStatus(
                this.app.vault,
                this.vectorStore,
                this.settings.rag,
                this.settings.chat,
              )
            : null;
          if (!status || status.totalDocuments === 0) return;
          new Notice('볼트 인덱싱 시작...');
          const result = await this.ragIndexingScheduler?.reindexAll();
          if (result) {
            new Notice(`${result.indexed}개 파일 인덱싱 완료`);
          }
        } catch (err) {
          if (isIndexingCancelledError(err)) {
            new Notice('인덱싱이 중단되었습니다.');
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`인덱싱 실패: ${msg}`);
        }
      },
    });


    this.addCommand({
      id: 'open-graph-rag-view',
      name: t('cmdOpenGraphRagView'),
      callback: () => this.openGraphRagView(),
    });
    // 설정 탭
    this.addSettingTab(new SuperpowerInsideSettingTab(this.app, this));
  }

  onunload(): void {
    this.cancelRagIndexing();
    this.cancelGraphRagIndexing();
    this.unregisterRAGEvents();
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
      this.statsDebounceTimer = null;
    }
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.ragStatusTimer) {
      clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    if (this.mcpRegistry) {
      const disconnectPromise = this.mcpRegistry.disconnectAll();
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('MCP disconnect timeout')), 3000),
      );
      void Promise.race([disconnectPromise, timeoutPromise]).catch(() => {
        // MCP 연결 정리 타임아웃 — 강제 종료
      });
    }
    this.mcpConnectionRunId++;
    this.clearMcpRetryTimers();
    this.refreshBus.destroy();
  }

  isRagIndexing(): boolean {
    return this.ragIndexAbortController !== null || (this.ragIndexingScheduler?.isRunning() ?? false);
  }

  cancelRagIndexing(): void {
    this.ragIndexAbortController?.abort();
    this.ragIndexingScheduler?.cancel();
  }

  isGraphRagIndexing(): boolean {
    return this.graphRagAbortController !== null || (this.graphRagIndexingRunner?.isRunning() ?? false);
  }

  cancelGraphRagIndexing(): void {
    this.graphRagAbortController?.abort();
  }

  async runGraphRagIndexing(): Promise<GraphRagIndexingResult | null> {
    return this.runGraphRagOperation(false);
  }

  async resumeGraphRagIndexing(): Promise<GraphRagIndexingResult | null> {
    return this.runGraphRagOperation(true);
  }

  hasGraphRagRunner(): boolean {
    return this.graphRagIndexingRunner !== null;
  }

  resumeRagIndexing(): void {
    this.ragPerformanceGuard?.reset();
    this.ragIndexingScheduler?.cancel();
    this.refreshBus?.emit('rag', {
      status: 'success',
      detail: this.ragIndexingStatus
        ? this.formatRagIndexingStatus(this.ragIndexingStatus)
        : '대기 중',
    });
  }

  getRagPerformanceGuardState(): PerformanceGuardState | null {
    return this.ragPerformanceGuard?.getState() ?? null;
  }

  async runRagIndexing<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (this.ragIndexAbortController) {
      return null;
    }
    const controller = new AbortController();
    this.ragIndexAbortController = controller;
    this.notifyRagStatsRefresh();
    try {
      return await operation(controller.signal);
    } finally {
      if (this.ragIndexAbortController === controller) {
        this.ragIndexAbortController = null;
      }
      this.notifyRagStatsRefresh();
    }
  }

  private notifyRagStatsRefresh(): void {
    void this.computeAndEmitRagStats();
    void this.computeAndEmitGraphRagStatus();
  }

  private async runGraphRagOperation(resumeFailed: boolean): Promise<GraphRagIndexingResult | null> {
    if (this.graphRagAbortController || !this.graphRagIndexingRunner) {
      return null;
    }
    const controller = new AbortController();
    this.graphRagAbortController = controller;
    await this.computeAndEmitGraphRagStatus();
    try {
      const result = resumeFailed
        ? await this.graphRagIndexingRunner.resumeFailed({ signal: controller.signal })
        : await this.graphRagIndexingRunner.run({ signal: controller.signal });
      await this.computeAndEmitGraphRagStatus();
      return result;
    } finally {
      if (this.graphRagAbortController === controller) {
        this.graphRagAbortController = null;
      }
      await this.computeAndEmitGraphRagStatus();
    }
  }

  async syncStaleGraphRag(): Promise<GraphRagIndexingResult | null> {
    if (!this.graphRagIndexingRunner || this.graphRagAbortController) {
      return null;
    }
    if (!this.graphRagStatus?.staleFileCount) {
      return null;
    }
    const controller = new AbortController();
    this.graphRagAbortController = controller;
    await this.computeAndEmitGraphRagStatus();
    try {
      const result = await this.graphRagIndexingRunner.run({
        signal: controller.signal,
        onlyStaleFiles: true,
        staleFilePaths: this.graphRagStatus.staleFilePaths,
      });
      await this.computeAndEmitGraphRagStatus();
      const presentation = getGraphRagStatusPresentation(this.graphRagStatus.state);
      new Notice(`GraphRAG ${presentation.label}: ${presentation.description}`);
      return result;
    } finally {
      if (this.graphRagAbortController === controller) {
        this.graphRagAbortController = null;
      }
      await this.computeAndEmitGraphRagStatus();
    }
  }

  async buildGraphRagCommunities(): Promise<GraphRagCommunityBuildResult | null> {
    if (!this.graphRagIndexingRunner) return null;
    const result = await this.graphRagIndexingRunner.buildCommunities();
    await this.computeAndEmitGraphRagStatus();
    return result;
  }

  private async cleanupGraphRagForDeletedFiles(filePaths: string[]): Promise<void> {
    if (!this.knowledgeGraphStore) return;
    await Promise.all([
      this.knowledgeGraphStore.removeEvidenceByFilePaths(filePaths),
      this.knowledgeGraphStore.removeRejectedFactsByFilePaths(filePaths),
    ]);
  }

  private async computeAndEmitRagStats(): Promise<void> {
    if (!this.vectorStore) return;
    try {
      this.eventDrivenRagStats = await calculateRagStatus(
        this.app.vault,
        this.vectorStore,
        this.settings.rag,
        this.settings.chat,
      );
      const summary = this.eventDrivenRagStats;
      if (this.refreshBus) {
        this.refreshBus.emit('rag', {
          status: 'success',
          detail: `${summary.healthyDocuments} / ${summary.totalDocuments}`,
        });
        this.refreshBus.emit('exclude-counts', { status: 'success' });
      }
    } catch {
      if (this.refreshBus) {
        this.refreshBus.emit('rag', { status: 'error', detail: '통계 계산 실패' });
      }
    }
  }

  async loadSettings(): Promise<void> {
    const localRaw = loadLocalSettings(this.app);
    let migratedFromLegacyData = false;
    let raw: Record<string, unknown> = {};
    if (isRecord(localRaw)) {
      raw = localRaw;
    } else {
      const legacyRaw = (await this.loadData()) as unknown;
      if (isRecord(legacyRaw)) {
        raw = legacyRaw;
        migratedFromLegacyData = true;
      }
    }
    const data = { ...raw };

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
          const useRequestUrl =
            typeof provider.useRequestUrl === 'boolean' ? provider.useRequestUrl : true;
          return { id, name, apiKey, baseUrl, models, enabled, useRequestUrl };
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
      const normalizedSaveFolder = normalizeChatSaveFolder(chatObj.saveFolder);
      if (normalizedSaveFolder !== null) {
        chatObj.saveFolder = normalizedSaveFolder;
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
    const hasExplicitVectorStoreType =
      rag && typeof rag === 'object' && Object.hasOwn(rag, 'vectorStoreType');
    if (!hasExplicitVectorStoreType && (await this.hasExistingJsonVectors())) {
      data.rag = { ...(rag ?? {}), vectorStoreType: 'json' };
    }
    const migratedRag = data.rag as Record<string, unknown> | undefined;
    if (migratedRag && typeof migratedRag === 'object') {
      if (!('embeddingProvider' in migratedRag)) {
        migratedRag.embeddingProvider = 'openai';
      }
      if (!('embeddingModel' in migratedRag)) {
        migratedRag.embeddingModel = 'text-embedding-3-small';
      }
      const embeddingProvider = migratedRag.embeddingProvider;
      const isKnownEmbeddingProvider =
        embeddingProvider === 'openai' ||
        embeddingProvider === 'ollama' ||
        embeddingProvider === 'openRouter' ||
        (typeof embeddingProvider === 'string' &&
          isCustomOpenAIEmbeddingProviderKey(embeddingProvider));
      if (!isKnownEmbeddingProvider) {
        migratedRag.embeddingProvider = DEFAULT_SETTINGS.rag.embeddingProvider;
        migratedRag.embeddingModel = DEFAULT_SETTINGS.rag.embeddingModel;
      }
      if (typeof migratedRag.autoUpdateEnabled !== 'boolean') {
        migratedRag.autoUpdateEnabled = false;
      }
      if (typeof migratedRag.autoUpdateIntervalMin !== 'number') {
        migratedRag.autoUpdateIntervalMin = 5;
      }
      if (typeof migratedRag.excludeChatFolder !== 'boolean') {
        migratedRag.excludeChatFolder = true;
      }
      migratedRag.autoUpdateIntervalMin = Math.max(
        1,
        Math.min(99, migratedRag.autoUpdateIntervalMin as number),
      );
      if ('autoUpdateIntervalMs' in migratedRag && !('autoUpdateIntervalMin' in migratedRag)) {
        migratedRag.autoUpdateIntervalMin = Math.max(
          1,
          Math.min(99, Math.round((migratedRag.autoUpdateIntervalMs as number) / 60000)),
        );
        delete migratedRag.autoUpdateIntervalMs;
      }
      if (typeof migratedRag.minScore !== 'number') {
        migratedRag.minScore = 0.5;
      }
      if (typeof migratedRag.annEnabled !== 'boolean') {
        migratedRag.annEnabled = true;
      }
      if (typeof migratedRag.annClusterCount !== 'number') {
        migratedRag.annClusterCount = 0;
      }
      if (typeof migratedRag.annProbeCount !== 'number') {
        migratedRag.annProbeCount = 4;
      }
      if (typeof migratedRag.structuralGraphEnabled !== 'boolean') {
        migratedRag.structuralGraphEnabled = true;
      }
      if (typeof migratedRag.ontologyEnabled !== 'boolean') {
        migratedRag.ontologyEnabled = true;
      }
      if (typeof migratedRag.ontologyAutoMergeThreshold !== 'number') {
        migratedRag.ontologyAutoMergeThreshold = 0.88;
      }
      if (typeof migratedRag.ontologyPendingMergeThreshold !== 'number') {
        migratedRag.ontologyPendingMergeThreshold = 0.72;
      }
      if (typeof migratedRag.graphRagEnabled !== 'boolean') {
        migratedRag.graphRagEnabled = false;
      }
      if (typeof migratedRag.graphRagModel !== 'string') {
        migratedRag.graphRagModel = '';
      }
      if (typeof migratedRag.graphRagMaxFilesPerRun !== 'number') {
        migratedRag.graphRagMaxFilesPerRun = 50;
      }
      if (!['auto', 'local', 'global', 'hybrid'].includes(String(migratedRag.graphRagQueryMode))) {
        migratedRag.graphRagQueryMode = 'auto';
      }
      if (typeof migratedRag.graphRagAutoSyncEnabled !== 'boolean') {
        migratedRag.graphRagAutoSyncEnabled = false;
      }
      if (typeof migratedRag.graphRagAutoSyncIntervalMin !== 'number') {
        migratedRag.graphRagAutoSyncIntervalMin = 30;
      }
      if (typeof migratedRag.enableBM25 !== 'boolean') {
        migratedRag.enableBM25 = true;
      }
      if (typeof migratedRag.bm25Weight !== 'number') {
        migratedRag.bm25Weight = 0.3;
      }
      migratedRag.performanceTuningMode = normalizeRagPerformanceTuningMode(
        migratedRag.performanceTuningMode,
      );
      if (typeof migratedRag.performanceGuardEnabled !== 'boolean') {
        migratedRag.performanceGuardEnabled = true;
      }
      if (typeof migratedRag.maxEmbeddingBatchSize !== 'number') {
        migratedRag.maxEmbeddingBatchSize = migratedRag.embeddingProvider === 'ollama' ? 1 : 32;
      }
      if (typeof migratedRag.indexingYieldMs !== 'number') {
        migratedRag.indexingYieldMs = 25;
      }
      if (typeof migratedRag.slowEventLoopThresholdMs !== 'number') {
        migratedRag.slowEventLoopThresholdMs = 150;
      }
      if (typeof migratedRag.slowBatchThresholdMs !== 'number') {
        migratedRag.slowBatchThresholdMs = 3000;
      }
    }

    // Migrate enforceMcpTools
    if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
      const chatObj = chat as Record<string, unknown>;
      if (typeof chatObj.enforceMcpTools !== 'boolean') {
        chatObj.enforceMcpTools = true;
      }
    }

    if (typeof data.mcpIncludeWslPath !== 'boolean') {
      data.mcpIncludeWslPath = false;
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

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SuperpowerInsideSettings>);
    this.settings.rag = {
      ...DEFAULT_SETTINGS.rag,
      ...(data.rag as Partial<SuperpowerInsideSettings['rag']> | undefined),
    };
    setLanguage(this.settings.language);
    if (migratedFromLegacyData) {
      saveLocalSettings(this.app, this.settings);
      await removeLegacyDataJson(this.app, this.manifest?.id ?? 'superpower-inside');
    }
  }

  private async hasExistingJsonVectors(): Promise<boolean> {
    const path = '.superpower-inside/vectors.json';
    try {
      if (!(await this.app.vault.adapter.exists(path))) return false;
      const raw = await this.app.vault.adapter.read(path);
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }

  async saveSettings(options?: { reinitRag?: boolean; reinitMcp?: boolean }): Promise<{ success: boolean; mcpErrors?: string[] }> {
    const reinitRag = options?.reinitRag ?? true;
    const reinitMcp = options?.reinitMcp ?? true;
    saveLocalSettings(this.app, this.settings);
    await removeLegacyDataJson(this.app, this.manifest?.id ?? 'superpower-inside');
    this.initProvider();
    if (reinitRag) {
      await this.initRAG();
    }
    const mcpErrors: string[] = [];
    if (reinitMcp) {
      const errs = await this.initMCP();
      mcpErrors.push(...errs);
    }
    return { success: mcpErrors.length === 0, mcpErrors };
  }

  async saveSettingsLight(): Promise<void> {
    saveLocalSettings(this.app, this.settings);
    await removeLegacyDataJson(this.app, this.manifest?.id ?? 'superpower-inside');
    this.initProvider();
  }

  getActiveProvider(): LLMProvider | null {
    if (this.provider) return this.provider;
    this.initProvider();
    return this.provider;
  }

  get llmProvider(): LLMProvider | null {
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

  private createProviderForModel(modelKey: string): LLMProvider | null {
    const normalizedModelKey = modelKey.trim();
    if (!normalizedModelKey) return null;
    const parts = normalizedModelKey.split(':');
    if (parts.length < 2) return null;
    if (parts[0] === 'customOpenAI') {
      if (parts.length < 3) return null;
      const providerId = parts[1];
      const modelName = parts.slice(2).join(':');
      const customProvider = this.settings.customOpenAIProviders.find(
        (provider) => provider.id === providerId,
      );
      if (
        !customProvider?.enabled ||
        !customProvider.models.includes(modelName) ||
        !customProvider.baseUrl?.trim()
      ) {
        return null;
      }
      try {
        return createCustomOpenAIProvider(customProvider, modelName);
      } catch {
        return null;
      }
    }
    const providerKey = parts[0] as ProviderKey;
    const modelName = parts.slice(1).join(':');
    if (!['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'].includes(providerKey)) {
      return null;
    }
    const config = this.settings[providerKey];
    if (!config?.enabled || !config.models.includes(modelName)) return null;
    try {
      return createProvider(providerKey, config, modelName);
    } catch {
      return null;
    }
  }

  private getEmbeddingProviderConfig(
    providerKey: EmbeddingProviderKey,
  ): ProviderConfig | CustomOpenAIProviderConfig | null {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      return (
        this.settings.customOpenAIProviders.find((provider) => provider.id === providerId) ?? null
      );
    }
    return this.settings[providerKey as ProviderKey];
  }

  private getEmbeddingProviderLabel(providerKey: EmbeddingProviderKey): string {
    if (isCustomOpenAIEmbeddingProviderKey(providerKey)) {
      const providerId = getCustomOpenAIEmbeddingProviderId(providerKey);
      const provider = this.settings.customOpenAIProviders.find((item) => item.id === providerId);
      return provider?.name.trim() || 'Custom OpenAI-Compatible';
    }
    return providerKey;
  }

  private debouncedRefreshStats(): void {
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
    }
    this.statsDebounceTimer = setTimeout(() => {
      void this.computeAndEmitRagStats();
      void this.maybeAutoSyncGraphRag();
    }, 500);
  }

  private async maybeAutoSyncGraphRag(): Promise<void> {
    const rag = this.settings.rag;
    if (!rag.graphRagEnabled || !rag.graphRagAutoSyncEnabled) return;
    if (this.isGraphRagIndexing()) return;
    await this.computeAndEmitGraphRagStatus();
    if (this.graphRagStatus?.state === 'stale') {
      new Notice('GraphRAG 자동 동기화 시작...');
      const result = await this.syncStaleGraphRag();
      if (result) {
        new Notice(
          `GraphRAG 자동 동기화 완료: ${result.processedFiles}개 처리, ${result.failedFiles}개 실패`,
        );
      }
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

    const config = this.getEmbeddingProviderConfig(providerKey);
    if (!config?.enabled) {
      console.warn(`[Superpower Inside] RAG embedding provider "${providerKey}" is disabled.`);
      return;
    }

    let baseUrl: string | undefined;
    let apiKey = '';
    const apiKeyVisibilityKey = isCustomOpenAIEmbeddingProviderKey(providerKey)
      ? 'customOpenAI'
      : providerKey;
    if (shouldShowProviderApiKey(apiKeyVisibilityKey)) {
      apiKey = config.apiKey;
      if (config.baseUrl) {
        baseUrl = config.baseUrl;
      }
    }
    if (!baseUrl) {
      if (providerKey === 'openai') {
        baseUrl = 'https://api.openai.com';
      } else if (providerKey === 'openRouter') {
        baseUrl = 'https://openrouter.ai/api';
      } else if (providerKey === 'ollama') {
        baseUrl = 'http://localhost:11434';
      }
    }

    // Create embedding provider
    let rawProvider: EmbeddingProvider;
    if (providerKey === 'ollama') {
      rawProvider = new OllamaEmbeddingProvider(baseUrl, rag.embeddingModel, apiKey);
    } else {
      rawProvider = new OpenAIEmbeddingProvider(apiKey, baseUrl, rag.embeddingModel);
    }

    this.embeddingProvider = new CachedEmbeddingProvider(rawProvider, rag.embeddingModel);

    // Vector store
    this.vectorStore =
      rag.vectorStoreType === 'indexeddb'
        ? new IndexedDbVectorStore()
        : new JsonFileVectorStore(this.app.vault.adapter, '.superpower-inside/vectors.json');
    this.knowledgeGraphStore = new IndexedDbKnowledgeGraphStore(this.createIndexedDbName('KnowledgeGraph'));
    await this.computeAndEmitGraphRagStatus();

    // BM25 index
    let bm25Index: JsonFileBM25Index | undefined;
    if (rag.enableBM25) {
      bm25Index = new JsonFileBM25Index(
        this.app.vault.adapter,
        '.superpower-inside/bm25-index.json',
      );
      await bm25Index.load();
    }
    const structuralMetadataContext = this.app.metadataCache
      ? {
          resolvedLinks: this.app.metadataCache.resolvedLinks,
          getFileByPath: (path: string) => {
            const file = this.app.vault.getAbstractFileByPath(path);
            return file instanceof TFile ? file : null;
          },
          getFileCache: (file: TFile) => this.app.metadataCache.getFileCache(file),
          getFirstLinkpathDest: (linkpath: string, sourcePath: string) =>
            this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
        }
      : undefined;

    const ontologySchema = DEFAULT_ONTOLOGY_SCHEMA;
    const graphRagEnabledForQuery =
      rag.graphRagEnabled &&
      (this.graphRagStatus?.state === 'ready' || this.graphRagStatus?.state === 'partial');
    const graphRagQueryEngine =
      graphRagEnabledForQuery && this.knowledgeGraphStore
        ? new GraphRagQueryEngine(this.knowledgeGraphStore, this.vectorStore, ontologySchema, {
            queryMode: rag.graphRagQueryMode,
          })
        : undefined;

    // RAG engine
    this.ragEngine = new RAGQueryEngine(
      this.vectorStore,
      this.embeddingProvider,
      bm25Index,
      rag.bm25Weight,
      rag.minScore,
      {
        annEnabled: rag.annEnabled,
        annClusterCount: rag.annClusterCount,
        annProbeCount: rag.annProbeCount,
        structuralGraphEnabled: rag.structuralGraphEnabled,
        structuralMetadataContext,
        graphRagEnabled: graphRagEnabledForQuery,
        graphRagQueryEngine,
      },
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

    const graphProvider =
      rag.graphRagEnabled && rag.graphRagModel.trim()
        ? this.createProviderForModel(rag.graphRagModel)
        : null;
    this.graphRagIndexingRunner =
      graphProvider && this.knowledgeGraphStore && this.embeddingProvider
        ? new GraphRagIndexingRunner({
            vectorStore: this.vectorStore,
            graphStore: this.knowledgeGraphStore,
            provider: graphProvider,
            embeddingProvider: this.embeddingProvider,
            ontologySchema,
            extractionModelKey: rag.graphRagModel,
            maxFilesPerRun: rag.graphRagMaxFilesPerRun,
            entityResolverOptions: {
              autoMergeThreshold: rag.ontologyAutoMergeThreshold,
              pendingMergeThreshold: rag.ontologyPendingMergeThreshold,
            },
            onProgress: (progress) => {
              this.refreshBus.emit('graph-progress', {
                status: 'partial',
                detail: `${progress.processedFiles + progress.failedFiles}/${progress.selectedFiles}`,
                progress,
              });
            },
          })
        : null;
    await this.computeAndEmitGraphRagStatus();

    const performanceSettings = resolveRagPerformanceSettings(rag);
    this.ragPerformanceGuard = new PerformanceGuard({
      enabled: performanceSettings.enabled,
      initialBatchSize: performanceSettings.maxEmbeddingBatchSize,
      initialYieldMs: performanceSettings.indexingYieldMs,
      slowEventLoopThresholdMs: performanceSettings.slowEventLoopThresholdMs,
      slowBatchThresholdMs: performanceSettings.slowBatchThresholdMs,
    });
    this.ragIndexingScheduler = new RAGIndexingScheduler({
      debounceMs: 500,
      indexFile: (file, options) => this.vaultIndexer!.indexFile(file, options),
      removeFile: (filePath) => this.vectorStore!.removeByFilePath(filePath),
      indexPending: (options) => this.vaultIndexer!.indexPending(options),
      reindexAll: (options) => this.vaultIndexer!.reindexAll(options),
      createIndexingOptions: (signal) => ({
        signal,
        maxEmbeddingBatchSize:
          this.ragPerformanceGuard?.getBatchSize() ??
          performanceSettings.maxEmbeddingBatchSize,
        indexingYieldMs:
          this.ragPerformanceGuard?.getYieldMs() ?? performanceSettings.indexingYieldMs,
        onBatchComplete: (durationMs) => {
          this.ragPerformanceGuard?.recordBatchDuration(durationMs);
          void this.ragPerformanceGuard?.measureEventLoopLag();
        },
        getPerformanceGuardState: () => this.ragPerformanceGuard?.getState() ?? null,
      }),
      onStatusChange: (status) => {
        this.ragIndexingStatus = status;
        this.refreshBus?.emit('rag', {
          status: status.running ? 'partial' : 'success',
          detail: this.formatRagIndexingStatus(status),
        });
      },
    });

    // Auto-update timer
    this.setupAutoUpdate();
    // RAG 상태 자동 갱신 타이머 (30초 간격)
    this.setupRagStatusTimer();
    this.registerRAGEvents();
  }

  private formatRagIndexingStatus(status: RagIndexingSchedulerStatus): string {
    const guardState = status.lastResult?.guardState ?? this.ragPerformanceGuard?.getState() ?? null;
    if (guardState?.mode === 'paused') {
      return '성능 보호 대기';
    }
    if (guardState?.mode === 'throttled') {
      return '속도 조절 중';
    }
    if (status.running) {
      return `인덱싱 중: ${this.formatRagIndexingPhase(status.phase)}`;
    }
    if (status.lastResult) {
      return `${status.lastResult.indexed}개 문서, ${status.lastResult.vectors}개 벡터`;
    }
    return '대기 중';
  }

  private formatRagIndexingPhase(phase: RagIndexingSchedulerStatus['phase']): string {
    if (phase === 'file') return '변경 파일';
    if (phase === 'pending') return '필요 문서 업데이트';
    if (phase === 'all') return '전체 재인덱싱';
    return '대기';
  }

  private clearRAG(): void {
    this.cancelRagIndexing();
    this.cancelGraphRagIndexing();
    this.unregisterRAGEvents();
    if (this.statsDebounceTimer) {
      clearTimeout(this.statsDebounceTimer);
      this.statsDebounceTimer = null;
    }
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    if (this.ragStatusTimer) {
      clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    this.vectorStore = null;
    this.knowledgeGraphStore = null;
    this.embeddingProvider = null;
    this.ragEngine = null;
    this.graphRagIndexingRunner = null;
    this.graphRagStatus = null;
    this.vaultIndexer = null;
    this.ragIndexingScheduler = null;
    this.ragPerformanceGuard = null;
    this.ragIndexingStatus = null;
    this.nextAutoUpdateAt = null;
    this.lastAutoUpdateSkippedReason = null;
    this.lastAutoUpdateResult = null;
  }

  private unregisterRAGEvents(): void {
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
  }

  private registerRAGEvents(): void {
    this.unregisterRAGEvents();
    if (!this.vaultIndexer || !this.ragIndexingScheduler) return;

    const effectiveExcludePaths = getEffectiveExcludePaths(this.settings.rag, this.settings.chat);
    this.modifyCleanup = registerModifyEvent(
      this.app.vault,
      {
        indexFile: (file: TFile) => {
          this.ragIndexingScheduler?.scheduleFile(file, 'modify');
          return Promise.resolve();
        },
      },
      effectiveExcludePaths,
      this.settings.rag.excludeExts,
      () => {
        this.debouncedRefreshStats();
      },
    );

    if (!this.vectorStore || !this.ragIndexingScheduler) return;
    this.deleteCleanup = registerDeleteEvent(
      this.app.vault,
      {
        removeByFilePath: (filePath: string) =>
          this.ragIndexingScheduler?.deleteFile(filePath) ?? Promise.resolve(0),
      },
      effectiveExcludePaths,
      this.settings.rag.excludeExts,
      (filePath) => {
        this.debouncedRefreshStats();
        if (this.knowledgeGraphStore) {
          void this.cleanupGraphRagForDeletedFiles([filePath]);
        }
      },
    );
    this.renameCleanup = registerRenameEvent(
      this.app.vault,
      {
        indexFile: (file: TFile) => {
          this.ragIndexingScheduler?.scheduleFile(file, 'rename');
          return Promise.resolve();
        },
      },
      {
        removeByFilePath: (filePath: string) =>
          this.ragIndexingScheduler?.deleteFile(filePath) ?? Promise.resolve(0),
      },
      effectiveExcludePaths,
      this.settings.rag.excludeExts,
      () => {
        this.debouncedRefreshStats();
      },
    );
  }

  /** RAG 상태 계산을 30초 간격으로 자동 갱신하고 RefreshBus로 발행 */
  private setupRagStatusTimer(): void {
    if (this.ragStatusTimer) {
      clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    // 초기 1회 즉시 실행
    void this.computeAndEmitRagStats();
    void this.computeAndEmitGraphRagStatus();
    // 30초 간격 갱신
    this.ragStatusTimer = setInterval(() => {
      void this.computeAndEmitRagStats();
      void this.computeAndEmitGraphRagStatus();
    }, 30_000);
  }

  private async computeAndEmitGraphRagStatus(): Promise<void> {
    if (!this.vectorStore || !this.knowledgeGraphStore) {
      this.graphRagStatus = null;
      return;
    }
    const ontologySchema = DEFAULT_ONTOLOGY_SCHEMA;
    const schemaErrors = validateOntologySchema(ontologySchema);
    this.graphRagStatus = await calculateGraphRagStatus({
      ragConfig: this.settings.rag,
      graphStore: this.knowledgeGraphStore,
      vectorStore: this.vectorStore,
      isRunning: this.isGraphRagIndexing(),
      schemaErrors,
    });
    const presentation = getGraphRagStatusPresentation(this.graphRagStatus.state);
    this.refreshBus?.emit('rag', {
      status: this.graphRagStatus.state === 'ready' ? 'success' : 'partial',
      detail: `GraphRAG ${presentation.label}: ${presentation.description}`,
    });
  }

  private createIndexedDbName(kind: string): string {
    const vault = this.app.vault as { getName?: () => string };
    const vaultName = vault.getName ? vault.getName() : 'default-vault';
    const pluginId = this.manifest?.id ?? 'superpower-inside';
    return `${pluginId}:${vaultName}:${kind}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  }

  setupAutoUpdate(): void {
    if (this.autoUpdateTimer) {
      clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = null;
    }
    this.nextAutoUpdateAt = null;
    if (this.settings.rag.autoUpdateEnabled && this.vaultIndexer) {
      this.nextAutoUpdateAt = Date.now() + this.settings.rag.autoUpdateIntervalMin * 60000;
      this.autoUpdateTimer = setInterval(() => {
        void this.autoIndex();
      }, this.settings.rag.autoUpdateIntervalMin * 60000);
    }
  }

  private async autoIndex(): Promise<void> {
    if (!this.vaultIndexer || !this.vectorStore || !this.ragIndexingScheduler) {
      this.lastAutoUpdateSkippedReason = 'RAG 인덱서가 초기화되지 않았습니다.';
      return;
    }
    this.nextAutoUpdateAt = Date.now() + this.settings.rag.autoUpdateIntervalMin * 60000;
    if (this.isRagIndexing()) {
      this.lastAutoUpdateSkippedReason = '인덱싱이 이미 실행 중입니다.';
      this.refreshBus?.emit('rag', { status: 'partial', detail: '인덱싱 중' });
      return;
    }
    const guardState = this.ragPerformanceGuard?.getState() ?? null;
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      this.lastAutoUpdateSkippedReason = `성능 보호 대기 중입니다. 약 ${Math.ceil((guardState.remainingPauseMs ?? 0) / 1000)}초 후 다시 시도합니다.`;
      this.refreshBus?.emit('rag', { status: 'partial', detail: '성능 보호 대기' });
      return;
    }
    try {
      const status = await calculateRagStatus(
        this.app.vault,
        this.vectorStore,
        this.settings.rag,
        this.settings.chat,
      );
      if (status.updateRequiredDocuments.length === 0) {
        this.lastAutoUpdateSkippedReason = '업데이트 대상 없음';
        this.refreshBus?.emit('rag', { status: 'success', detail: '업데이트 대상 없음' });
        return;
      }
      new Notice(t('autoUpdateIndexingStarted'));
      const result = await this.ragIndexingScheduler.indexPending();
      this.lastAutoUpdateResult = result;
      this.lastAutoUpdateSkippedReason = null;
      if (result.indexed > 0) {
        new Notice(`${result.indexed}${t('autoUpdateIndexingDone')}`);
      }
      void this.computeAndEmitRagStats();
    } catch (err) {
      if (isIndexingCancelledError(err)) {
        const pausedState = this.ragPerformanceGuard?.getState() ?? null;
        if (pausedState?.mode === 'paused') {
          this.lastAutoUpdateSkippedReason = `성능 보호 대기 중입니다. 약 ${Math.ceil((pausedState.remainingPauseMs ?? 0) / 1000)}초 후 다시 시도합니다.`;
          this.refreshBus?.emit('rag', { status: 'partial', detail: '성능 보호 대기' });
          return;
        }
        this.lastAutoUpdateSkippedReason = '인덱싱이 중단되었습니다.';
        new Notice('인덱싱이 중단되었습니다.');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.lastAutoUpdateSkippedReason = msg;
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

    if (!isMcpStdioAvailable(Platform)) {
      const enabledServers = this.mcpRegistry.getEnabledServers();
      const errors = enabledServers.map((server) => `${server.name}: ${MCP_DESKTOP_ONLY_MESSAGE}`);
      for (const server of enabledServers) {
        this.mcpRegistry.setConnectionStatus(server.name, 'error', MCP_DESKTOP_ONLY_MESSAGE);
      }
      this.refreshMcpConnectionState();
      return errors;
    }

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
    servers: SuperpowerInsideSettings['mcpServers'],
    runId: number,
  ): Promise<string[]> {
    const registry = this.mcpRegistry;
    if (!registry) return [];
    const { MCPClientManager } = await import('./src/mcp/client');

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

        const effectivePath =
          this.settings.mcpPath || (typeof process !== 'undefined' ? process.env.PATH : '') || '';
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
        let msg = err instanceof Error ? err.message : String(err);
        if (shouldAppendMcpPathHint(server.command, msg)) {
          msg = `${msg}\n${t('mcpPathCommandNotFoundHint').replace('{command}', server.command)}`;
        }
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

  openGraphRagView(): void {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    void leaf.setViewState({ type: GRAPH_RAG_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }
}
