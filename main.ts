import {
  getLanguage as getObsidianLanguage,
  Plugin,
  Notice,
  Platform,
  TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import {
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  readJsonFromVault,
  writeJsonToVault,
} from './src/utils/vault';
import {
  type SuperpowerInsideSettings,
  DEFAULT_SETTINGS,
  isCustomOpenAIEmbeddingProviderKey,
  migrateLegacyProviderProfiles,
  normalizeAgentDiagnosticsSettings,
  normalizeChatSaveFolder,
  resolveChatModelPlan,
  resolveProviderModelRef,
  resolveUsableProviderModelRef,
  SuperpowerInsideSettingTab,
} from './src/settings';
import {
  normalizeRagPerformanceTuningMode,
  resolveRagPerformanceSettings,
  shouldShowProviderApiKey,
} from './src/rag/settings-display';
import type { LLMProvider } from './src/llm/providers';
import { createChatProviderForModel } from './src/llm/provider-resolution';
import { normalizeProviderCapabilityOverrides } from './src/llm/provider-capabilities';
import { chatGPTOAuth, initializeChatGPTOAuth } from './src/llm/chatgpt-oauth';
import {
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  TernlightEmbeddingProvider,
  EmbeddingGemmaProvider,
  CachedEmbeddingProvider,
  createEmbeddingCacheNamespace,
  type EmbeddingProvider,
} from './src/llm/embedding';
import {
  IndexedDbVectorStore,
  importLegacyJsonVectorStore,
  type VectorStore,
} from './src/rag/store';
import {
  getLocalEmbeddingModels,
  type LocalEmbeddingModelId,
} from './src/llm/local-embedding-models';
import { IndexedDbBM25Index, type BM25CorpusDocument } from './src/rag/bm25';
import { buildBM25CorpusDocuments } from './src/rag/bm25-corpus';
import { IndexedDbDocumentCorpusStore } from './src/rag/document-corpus-store';
import { VaultDocumentCorpus } from './src/rag/vault-document-corpus';
import {
  planSourceProcessingRust,
  type SourceProcessingSummary,
} from './src/rag/source-processing';
import {
  VaultIndexer,
  registerModifyEvent,
  registerCreateEvent,
  registerDeleteEvent,
  registerRenameEvent,
  isIndexingCancelledError,
  type IndexingResult,
} from './src/rag/indexer';
import { calculateRagStatus, type RagStatusSummary } from './src/rag/status';
import { RAGQueryEngine } from './src/rag/query';
import { PerformanceGuard, type PerformanceGuardState } from './src/rag/performance-guard';
import {
  RAGIndexingScheduler,
  type RagIndexingSchedulerStatus,
} from './src/rag/indexing-scheduler';
import { shouldRunRagStatusBackgroundRefresh } from './src/rag/background-status';
import type { StructuralMetadataContext } from './src/rag/retrieval-pipeline';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { AGENT_DIAGNOSTICS_VIEW_TYPE, AgentDiagnosticsView } from './src/diagnostics/view';
import {
  AgentDiagnosticsService,
  type AgentDiagnosticsBreadcrumbInput,
  type AgentDiagnosticsServiceSnapshotState,
} from './src/diagnostics/service';
import {
  buildAgentDiagnosticsSnapshot,
  getAgentDiagnosticsEventLogPath,
  getAgentDiagnosticsFilePath,
  getAgentDiagnosticsSafeModeFilePath,
  type AgentDiagnosticsRuntimeState,
} from './src/diagnostics/snapshot';
import { normalizePromptLibrary } from './src/chat/prompt-library';
import { MCPRegistry } from './src/mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  getMcpConnectionState,
  type MCPConnectionState,
} from './src/mcp/connection-state';
import { shouldAppendMcpPathHint } from './src/mcp/errors';
import { getMcpDesktopOnlyMessage, isMcpStdioAvailable } from './src/mcp/platform';
import { isLocalizedValue, resolveUiLanguage, setLanguage, t } from './src/i18n';
import { RefreshBus } from './src/utils/refresh-bus';
import {
  loadLocalSettings,
  resolveSettingsLoadData,
  saveLocalSettings,
} from './src/settings-storage';
import { appLogger, normalizeLoggerConfig, type AppLogger } from './src/utils/logger';
import { CoalescedAsyncRunner } from './src/utils/coalesced-async-runner';
import {
  cleanupStaleIndexedDbGenerations,
  createRagIndexNamespace,
  createRagStorageLayout,
  deleteRagIndexedDbGenerations,
} from './src/rag/storage-lifecycle';
import {
  AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY,
  AutomaticRagRecoveryCoordinator,
  createWindowAutomaticRagRecoveryTimer,
  selectAutomaticRecoveryEligibleFiles,
  type AutomaticRagRecoveryEvent,
} from './src/rag/automatic-recovery';
import {
  RAG_STORAGE_MAINTENANCE_COMPLETION_KEY,
  runRagStorageMaintenance,
} from './src/rag/storage-maintenance';
import { cleanupInactiveRagIndexedDb } from './src/rag/storage-registry';
import { buildPluginIndexedDbNames, resetPluginOwnedData } from './src/utils/plugin-data-reset';
import { maintainPluginOwnedFiles } from './src/utils/plugin-file-maintenance';

const MCP_AUTO_RETRY_DELAYS_MS = [2000, 5000] as const;
const AGENT_DIAGNOSTICS_MIN_READABLE_WIDTH = 320;
const RAG_RUNTIME_INIT_STEP_TIMEOUT_MS = 30_000;
const AUTO_UPDATE_TIMER_WINDOW_KEY = '__superpowerInsideAutoUpdateTimerV1' as const;

type AutoUpdateTimerWindow = Window & {
  [AUTO_UPDATE_TIMER_WINDOW_KEY]?: number;
};

class RagRuntimeInitializationCancelledError extends Error {
  constructor() {
    super('RAG runtime initialization was cancelled.');
    this.name = 'RagRuntimeInitializationCancelledError';
  }
}

interface ClearableEmbeddingProvider extends EmbeddingProvider {
  clearCache(): Promise<void>;
  deleteDatabase?: () => Promise<void>;
}

interface DeletableIndexedDbStore {
  deleteDatabase(): Promise<void>;
}

function hasClearableEmbeddingCache(
  provider: EmbeddingProvider | null,
): provider is ClearableEmbeddingProvider {
  const candidate = provider as Partial<ClearableEmbeddingProvider> | null;
  return typeof candidate?.clearCache === 'function';
}

function hasDeletableIndexedDbStore(store: unknown): store is DeletableIndexedDbStore {
  return (
    typeof store === 'object' &&
    store !== null &&
    typeof (store as Partial<DeletableIndexedDbStore>).deleteDatabase === 'function'
  );
}

function isSafeModeFlagEnabled(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === true
  );
}

interface RagRuntimeSnapshot {
  documentCorpus: IndexedDbDocumentCorpusStore | null;
  vaultDocumentCorpus: VaultDocumentCorpus | null;
  vectorStore: VectorStore | null;
  embeddingProvider: EmbeddingProvider | null;
  bm25Index: IndexedDbBM25Index | null;
  ragEngine: RAGQueryEngine | null;
  vaultIndexer: VaultIndexer | null;
  ragIndexingScheduler: RAGIndexingScheduler | null;
  automaticRagRecovery: AutomaticRagRecoveryCoordinator | null;
  ragPerformanceGuard: PerformanceGuard | null;
  ragIndexingStatus: RagIndexingSchedulerStatus | null;
  nextAutoUpdateAt: number | null;
  lastAutoUpdateSkippedReason: string | null;
  lastAutoUpdateResult: IndexingResult | null;
}

interface BM25BackgroundLoadOutcome {
  error: Error | null;
  startedAt: number;
  loadDurationMs: number;
}

export default class SuperpowerInsidePlugin extends Plugin {
  documentCorpus: IndexedDbDocumentCorpusStore | null = null;
  private vaultDocumentCorpus: VaultDocumentCorpus | null = null;
  async getSourceFileProcessingStatus(
    files: readonly TFile[],
    limit = 32,
  ): Promise<SourceProcessingSummary | null> {
    const corpus = this.documentCorpus;
    if (!corpus) return null;
    const paths = files.map((file) => file.path);
    const [documents, bm25, vectors] = await Promise.all([
      corpus.getDocuments(),
      this.bm25Index?.getCorpusDocumentsBySourcePaths(paths) ?? Promise.resolve([]),
      this.vectorStore?.getFileIndexRecords() ?? Promise.resolve([]),
    ]);
    if (this.documentCorpus !== corpus) return null;
    const rag = this.settings.rag;
    const embedding = resolveUsableProviderModelRef(
      this.settings,
      rag.embeddingModelRef ?? '',
      'embedding',
    );
    return planSourceProcessingRust({
      files: files.map((file) => ({
        filePath: file.path,
        sourceMtime: file.stat.mtime,
        sourceSize: file.stat.size,
        readFailed: this.vaultDocumentCorpus?.hasFailedPath(file.path) ?? false,
        readPending: this.vaultDocumentCorpus?.isReadingPath(file.path) ?? false,
      })),
      documents: documents.map(
        ({ id, sourcePath, sourceMtime, sourceSize, contentHash, chunkHash }) => ({
          id,
          sourcePath,
          sourceMtime,
          sourceSize,
          contentHash,
          chunkHash,
        }),
      ),
      bm25: bm25.map(({ id, sourcePath, sourceMtime, sourceSize, contentHash }) => ({
        id,
        sourcePath,
        sourceMtime,
        sourceSize,
        contentHash,
      })),
      vectors,
      failedEmbeddingPaths: this.vaultIndexer?.getFailedFilePaths() ?? [],
      config: {
        bm25Enabled: rag.enableBM25,
        embeddingEnabled: embedding !== null,
        embeddingProvider: rag.embeddingProvider,
        embeddingModel: rag.embeddingModel,
      },
      limit,
    });
  }
  declare settings: SuperpowerInsideSettings;
  logger: AppLogger = appLogger;
  private provider: LLMProvider | null = null;
  vectorStore: VectorStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private bm25Index: IndexedDbBM25Index | null = null;
  ragEngine: RAGQueryEngine | null = null;
  private vaultIndexer: VaultIndexer | null = null;
  private ragIndexingScheduler: RAGIndexingScheduler | null = null;
  private automaticRagRecovery: AutomaticRagRecoveryCoordinator | null = null;
  private ragPerformanceGuard: PerformanceGuard | null = null;
  ragIndexingStatus: RagIndexingSchedulerStatus | null = null;
  nextAutoUpdateAt: number | null = null;
  lastAutoUpdateSkippedReason: string | null = null;
  lastAutoUpdateResult: IndexingResult | null = null;
  lastRagRuntimeInitError: string | null = null;
  lastRagRuntimeInitSkippedReason: string | null = null;
  lastRagRuntimeInitStage: string | null = null;
  lastRagRuntimeInitStartedAt: number | null = null;
  lastRagRuntimeInitFinishedAt: number | null = null;
  mcpRegistry: MCPRegistry | null = null;
  mcpConnectionState: MCPConnectionState = 'idle';
  mcpLastErrors: string[] = [];
  private mcpConnectionRunId = 0;
  private mcpRetryTimers = new Map<number, () => void>();
  private modifyCleanup: (() => void) | null = null;
  private createCleanup: (() => void) | null = null;
  private deleteCleanup: (() => void) | null = null;
  private renameCleanup: (() => void) | null = null;
  private autoUpdateTimer: number | null = null;
  private ragStatusTimer: number | null = null;
  private ragIndexAbortController: AbortController | null = null;
  private ragRuntimeInitRunner: CoalescedAsyncRunner | null = null;
  private ragRuntimeInitRunId = 0;
  private unloaded = false;

  // 실시간 통계 캐시 (이벤트 기반 업데이트)
  eventDrivenRagStats: RagStatusSummary | null = null;
  private statsDebounceTimer: number | null = null;
  refreshBus: RefreshBus = new RefreshBus();
  private agentDiagnosticsService: AgentDiagnosticsService | null = null;

  async onload(): Promise<void> {
    const startedAt = Date.now();
    this.unloaded = false;
    this.getLogger().info('Plugin loading started.', { source: 'lifecycle' });
    const chatGPTAuth = initializeChatGPTOAuth(this.app, this.getLogger(), this.manifest.version);
    this.register(() => chatGPTAuth.dispose());
    await this.loadSettings();
    await this.runStartupPluginFileMaintenance();
    await this.configureAgentDiagnosticsService();
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'plugin.lifecycle',
      action: 'enter',
      detail: 'onload',
      data: { manifestVersion: this.manifest?.version ?? 'unknown' },
    });
    await this.applyAgentDiagnosticsSafeModeFlag();
    this.initProvider();

    // 채팅 뷰 등록
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.registerView(AGENT_DIAGNOSTICS_VIEW_TYPE, (leaf) => new AgentDiagnosticsView(leaf, this));
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
        const initialized = await this.ensureRagRuntimeInitialized();
        if (!initialized) {
          new Notice(this.getRagIndexerNotInitializedReason());
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
          this.getLogger().info('Manual RAG reindex started.', {
            source: 'rag',
            data: { totalDocuments: status.totalDocuments },
          });
          new Notice(t('vaultIndexingStarted'));
          const result = await this.ragIndexingScheduler?.reindexAll();
          if (result) {
            this.getLogger().notice('Manual RAG reindex completed.', {
              source: 'rag',
              data: { indexed: result.indexed, vectors: result.vectors, skipped: result.skipped },
            });
            new Notice(t('vaultIndexingDone', { count: result.indexed }));
          }
        } catch (err) {
          if (isIndexingCancelledError(err)) {
            this.getLogger().warn('Manual RAG reindex cancelled.', { source: 'rag' });
            new Notice(t('indexingCancelled'));
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          this.getLogger().error('Manual RAG reindex failed.', { source: 'rag', error: err });
          new Notice(t('indexingFailedWithMessage', { message: msg }));
        }
      },
    });

    this.addCommand({
      id: 'open-agent-diagnostics-view',
      name: t('cmdOpenAgentDiagnosticsView'),
      callback: () => this.openAgentDiagnosticsView(),
    });
    // 설정 탭
    this.addSettingTab(new SuperpowerInsideSettingTab(this.app, this));
    this.startDeferredStartupTasks();
    if (this.settings.agentDiagnostics.enabled) {
      void this.agentDiagnosticsService?.writeNow('startup');
    }
    this.getLogger().info('Plugin loaded.', { source: 'lifecycle' });
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'plugin.lifecycle',
      action: 'leave',
      detail: 'onload',
      data: { durationMs: Date.now() - startedAt },
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.ragRuntimeInitRunId =
      (Number.isSafeInteger(this.ragRuntimeInitRunId) ? this.ragRuntimeInitRunId : 0) + 1;
    this.getLogger().info('Plugin unloading.', { source: 'lifecycle' });
    void this.agentDiagnosticsService?.stop('plugin-unload');
    this.cancelRagIndexing();
    this.unregisterRAGEvents();
    if (this.statsDebounceTimer) {
      window.clearTimeout(this.statsDebounceTimer);
      this.statsDebounceTimer = null;
    }
    this.clearAutoUpdateTimer();
    if (this.ragStatusTimer) {
      window.clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    if (this.mcpRegistry) {
      const disconnectPromise = this.mcpRegistry.disconnectAll();
      const timeoutPromise = new Promise<void>((_, reject) =>
        window.setTimeout(() => reject(new Error('MCP disconnect timeout')), 3000),
      );
      void Promise.race([disconnectPromise, timeoutPromise]).catch(() => {
        // MCP 연결 정리 타임아웃 — 강제 종료
      });
    }
    this.mcpConnectionRunId++;
    this.clearMcpRetryTimers();
    this.clearRAG();
    this.refreshBus.destroy();
    this.getLogger().info('Plugin unloaded.', { source: 'lifecycle' });
  }

  private startDeferredStartupTasks(): void {
    this.startDeferredMcpInitialization();
  }

  private startDeferredMcpInitialization(): void {
    const timeoutId = window.setTimeout(() => {
      void this.initMCP()
        .then((errors) => {
          if (!this.unloaded && errors.length > 0) {
            new Notice(t('mcpAutoConnectFailedCount', { count: errors.length }), 10000);
          }
        })
        .catch((err) => {
          if (this.unloaded) return;
          const msg = err instanceof Error ? err.message : String(err);
          this.getLogger().error('MCP auto-connect failed.', { source: 'mcp', error: err });
          new Notice(t('mcpAutoConnectFailedMessage', { message: msg }), 10000);
        });
    }, 1000);
    this.register(() => window.clearTimeout(timeoutId));
  }

  private getLogger(): AppLogger {
    if (!this.logger) {
      this.logger = appLogger;
    }
    return this.logger;
  }

  isRagIndexing(): boolean {
    return (
      this.ragIndexAbortController !== null || (this.ragIndexingScheduler?.isRunning() ?? false)
    );
  }

  cancelRagIndexing(): void {
    this.ragIndexAbortController?.abort();
    this.ragIndexingScheduler?.cancel();
  }

  async deleteLocalEmbeddingModel(modelId: LocalEmbeddingModelId): Promise<void> {
    const selected = resolveProviderModelRef(
      this.settings,
      this.settings.rag.embeddingModelRef ?? '',
      'embedding',
    );
    if (selected?.profile.strategy === 'ternlight' && selected.modelId === modelId) {
      this.cancelRagIndexing();
      this.embeddingProvider?.close?.();
    }
    await getLocalEmbeddingModels({
      app: this.app,
      pluginId: this.manifest.id,
      pluginVersion: this.manifest.version,
    }).remove(modelId);
    this.refreshBus?.emit('rag', {
      status: 'success',
      detail: t('localModelDeleteDone', { model: modelId }),
    });
  }

  resumeRagIndexing(): boolean {
    const resumed = this.ragIndexingScheduler?.resumeNow() ?? false;
    if (resumed) {
      this.refreshBus?.emit('rag', {
        status: 'success',
        detail: this.ragIndexingStatus
          ? this.formatRagIndexingStatus(this.ragIndexingStatus)
          : t('ragIdle'),
      });
    }
    return resumed;
  }

  getRagPerformanceGuardState(): PerformanceGuardState | null {
    return this.ragPerformanceGuard?.getState() ?? null;
  }

  getAgentDiagnosticsFilePath(): string {
    return getAgentDiagnosticsFilePath(
      this.app.vault.configDir,
      this.manifest?.id ?? 'superpower-inside',
    );
  }

  getAgentDiagnosticsEventLogPath(): string {
    return getAgentDiagnosticsEventLogPath(
      this.app.vault.configDir,
      this.manifest?.id ?? 'superpower-inside',
    );
  }

  getAgentDiagnosticsSafeModeFilePath(): string {
    return getAgentDiagnosticsSafeModeFilePath(
      this.app.vault.configDir,
      this.manifest?.id ?? 'superpower-inside',
    );
  }

  private getPluginDirectoryPath(): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest?.id ?? 'superpower-inside'}`;
  }

  private async runStartupPluginFileMaintenance(): Promise<void> {
    try {
      const result = await maintainPluginOwnedFiles({
        adapter: this.app.vault.adapter,
        pluginDirectory: this.getPluginDirectoryPath(),
        eventLogPath: this.getAgentDiagnosticsEventLogPath(),
      });
      if (result.deletedPaths.length > 0 || result.rotatedEventLogPath) {
        this.getLogger().info('Plugin-owned file maintenance completed.', {
          source: 'storage.maintenance',
          data: {
            deletedFileCount: result.deletedPaths.length,
            rotatedDiagnosticsLog: result.rotatedEventLogPath !== null,
          },
        });
      }
      if (result.failedPaths.length > 0 || result.remainingDeleteCount > 0) {
        this.getLogger().warn('Plugin-owned file maintenance remains incomplete.', {
          source: 'storage.maintenance',
          data: {
            failedFileCount: result.failedPaths.length,
            remainingDeleteCount: result.remainingDeleteCount,
          },
        });
      }
    } catch (error) {
      this.getLogger().warn('Plugin-owned file maintenance failed.', {
        source: 'storage.maintenance',
        error,
      });
    }
  }

  getAgentDiagnosticsSnapshotText(): string {
    const state =
      this.agentDiagnosticsService?.getSnapshotState() ??
      this.createDisabledAgentDiagnosticsState();
    return JSON.stringify(this.buildAgentDiagnosticsSnapshot(state), null, 2);
  }

  async writeAgentDiagnosticsSnapshot(reason: string): Promise<void> {
    const service = this.getOrCreateAgentDiagnosticsService();
    const wasRunning = service.isRunning();
    if (!wasRunning) {
      await service.setEnabled(true);
    }
    try {
      await service.writeNow(reason);
    } finally {
      if (!wasRunning) {
        await service.setEnabled(false);
      }
    }
  }

  async clearAgentDiagnosticsDetailedLogging(): Promise<void> {
    const service = this.getOrCreateAgentDiagnosticsService();
    await service.clearDetailedLogging();
  }

  async enableAgentDiagnosticsSafeMode(): Promise<void> {
    await writeJsonToVault(this.app.vault.adapter, this.getAgentDiagnosticsSafeModeFilePath(), {
      enabled: true,
    });
    await this.applyAgentDiagnosticsSafeModeFlag();
    await this.writeAgentDiagnosticsSnapshot('safe-mode-enabled');
  }

  private async recordAgentDiagnosticsBreadcrumb(
    input: AgentDiagnosticsBreadcrumbInput,
  ): Promise<void> {
    await this.agentDiagnosticsService?.recordBreadcrumb(input);
  }

  private async configureAgentDiagnosticsService(): Promise<void> {
    const service = this.getOrCreateAgentDiagnosticsService();
    await service.setEnabled(this.settings.agentDiagnostics.enabled);
  }

  private getOrCreateAgentDiagnosticsService(): AgentDiagnosticsService {
    if (!this.refreshBus) {
      this.refreshBus = new RefreshBus();
    }
    if (!this.agentDiagnosticsService) {
      this.agentDiagnosticsService = new AgentDiagnosticsService({
        adapter: this.app.vault.adapter,
        filePath: this.getAgentDiagnosticsFilePath(),
        eventLogPath: this.getAgentDiagnosticsEventLogPath(),
        refreshBus: this.refreshBus,
        logger: this.getLogger(),
        buildSnapshot: (state) => this.buildAgentDiagnosticsSnapshot(state),
      });
    }
    return this.agentDiagnosticsService;
  }

  private async applyAgentDiagnosticsSafeModeFlag(): Promise<void> {
    const raw = await readJsonFromVault(
      this.app.vault.adapter,
      this.getAgentDiagnosticsSafeModeFilePath(),
    );
    if (!isSafeModeFlagEnabled(raw)) return;
    this.settings = {
      ...this.settings,
      rag: {
        ...this.settings.rag,
        autoUpdateEnabled: false,
        enableBM25: false,
        structuralGraphEnabled: false,
        annEnabled: false,
      },
    };
    saveLocalSettings(this.app, this.settings);
    await this.saveData(this.settings);
    this.getLogger().warn('Agent diagnostics safe mode flag applied.', {
      source: 'diagnostics',
      data: {
        flagPath: this.getAgentDiagnosticsSafeModeFilePath(),
      },
    });
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'plugin.safe-mode',
      action: 'mark',
      detail: 'applied',
      data: {
        flagPath: this.getAgentDiagnosticsSafeModeFilePath(),
      },
    });
  }

  private buildAgentDiagnosticsSnapshot(state: AgentDiagnosticsServiceSnapshotState): unknown {
    return buildAgentDiagnosticsSnapshot({
      manifest: {
        id: this.manifest?.id ?? 'superpower-inside',
        name: this.manifest?.name ?? 'Superpower Inside',
        version: this.manifest?.version ?? 'unknown',
      },
      vault: {
        name: this.getVaultName(),
        configDir: this.app.vault.configDir,
        adapterBasePath: this.getVaultAdapterBasePath(),
      },
      settings: this.settings,
      runtime: this.collectAgentDiagnosticsRuntimeState(),
      session: state.session,
      previousSession: state.previousSession,
      heartbeat: state.heartbeat,
      refreshEvents: state.refreshEvents,
      breadcrumbs: state.breadcrumbs,
      activeOperations: state.activeOperations,
      logs: state.logs,
      fileWrite: state.fileWrite,
      eventLog: state.eventLog,
      now: Date.now(),
    });
  }

  private createDisabledAgentDiagnosticsState(): AgentDiagnosticsServiceSnapshotState {
    const now = Date.now();
    return {
      session: {
        id: 'agent-diagnostics-disabled',
        status: 'stopped',
        startedAt: now,
        endedAt: now,
        endReason: 'disabled',
      },
      previousSession: null,
      heartbeat: {
        lastStartedAt: null,
        lastFinishedAt: null,
        lastLagMs: null,
        maxLagMs: 0,
        tickCount: 0,
      },
      refreshEvents: [],
      breadcrumbs: [],
      activeOperations: [],
      logs: this.getLogger().getEntries().slice(-200),
      fileWrite: {
        path: this.getAgentDiagnosticsFilePath(),
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
      },
      eventLog: {
        path: this.getAgentDiagnosticsEventLogPath(),
        lastAppendAt: null,
        lastError: null,
      },
    };
  }

  private collectAgentDiagnosticsRuntimeState(): AgentDiagnosticsRuntimeState {
    const registry = this.mcpRegistry;
    return {
      ragStatus: this.eventDrivenRagStats,
      mcpConnectionState: this.mcpConnectionState,
      mcpServers: this.settings.mcpServers.map((server) => ({
        name: server.name,
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
        status: registry?.getConnectionStatus(server.name) ?? 'disconnected',
        error: registry?.getLastError(server.name),
      })),
      isRagIndexing: this.isRagIndexing(),
      ragIndexingStatus: this.ragIndexingStatus,
      performanceGuardState: this.getRagPerformanceGuardState(),
      nextAutoUpdateAt: this.nextAutoUpdateAt,
      lastAutoUpdateSkippedReason: this.lastAutoUpdateSkippedReason,
      lastAutoUpdateResult: this.lastAutoUpdateResult,
      ragRuntimeInit: {
        running: this.ragRuntimeInitRunner?.isRunning() ?? false,
        currentStage: this.lastRagRuntimeInitStage,
        lastError: this.lastRagRuntimeInitError,
        lastSkippedReason: this.lastRagRuntimeInitSkippedReason,
        lastStartedAt: this.lastRagRuntimeInitStartedAt,
        lastFinishedAt: this.lastRagRuntimeInitFinishedAt,
      },
      runtimeFlags: {
        vectorStoreReady: this.vectorStore !== null,
        ragEngineReady: this.ragEngine !== null,
        providerReady: this.provider !== null,
      },
    };
  }

  private getVaultName(): string {
    const vault = this.app.vault as { getName?: () => string };
    return vault.getName?.() ?? 'unknown-vault';
  }

  private getVaultAdapterBasePath(): string | null {
    const adapter = this.app.vault.adapter as { basePath?: unknown };
    return typeof adapter.basePath === 'string' ? adapter.basePath : null;
  }

  private getVaultStorageIdentity(): string {
    return this.getVaultAdapterBasePath() ?? this.getVaultName();
  }

  async runRagIndexing<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (this.ragIndexAbortController) {
      this.getLogger().debug('RAG operation ignored because another operation is running.', {
        source: 'rag.indexing',
      });
      return null;
    }
    const controller = new AbortController();
    this.ragIndexAbortController = controller;
    this.notifyRagStatsRefresh();
    const startedAt = Date.now();
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'rag.indexing',
      action: 'enter',
      detail: 'operation',
    });
    try {
      this.getLogger().info('RAG operation started.', { source: 'rag.indexing' });
      const result = await operation(controller.signal);
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.indexing',
        action: 'leave',
        detail: 'operation',
        data: { durationMs: Date.now() - startedAt },
      });
      return result;
    } catch (err) {
      if (isIndexingCancelledError(err)) {
        this.getLogger().warn('RAG operation cancelled.', { source: 'rag.indexing' });
      } else {
        this.getLogger().error('RAG operation failed.', { source: 'rag.indexing', error: err });
      }
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.indexing',
        action: 'error',
        detail: 'operation',
        data: {
          durationMs: Date.now() - startedAt,
          message: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    } finally {
      if (this.ragIndexAbortController === controller) {
        this.ragIndexAbortController = null;
      }
      this.notifyRagStatsRefresh();
      this.getLogger().info('RAG operation finished.', { source: 'rag.indexing' });
    }
  }

  private notifyRagStatsRefresh(): void {
    this.refreshRagStatusInBackground();
  }

  async resetPluginData(): Promise<void> {
    this.getLogger().info('Plugin data reset started.', { source: 'settings.reset' });
    this.automaticRagRecovery?.dispose();
    this.automaticRagRecovery = null;
    this.vaultDocumentCorpus?.suspend();
    this.cancelRagIndexing();

    const indexedDbNames = buildPluginIndexedDbNames((kind) => this.createIndexedDbName(kind));
    const resetStorageLayout = createRagStorageLayout({
      pluginId: this.manifest?.id ?? 'superpower-inside',
      vaultIdentity: this.getVaultStorageIdentity(),
      legacyVaultName: this.getVaultName(),
      embeddingNamespace: 'plugin-reset',
      indexNamespace: 'plugin-reset',
    });
    const vectorStoreClear = this.vectorStore
      ? hasDeletableIndexedDbStore(this.vectorStore)
        ? this.vectorStore.deleteDatabase()
        : this.vectorStore.clear()
      : Promise.resolve();
    const bm25Clear = this.bm25Index ? this.bm25Index.deleteDatabase() : Promise.resolve();
    const embeddingCacheClear = hasClearableEmbeddingCache(this.embeddingProvider)
      ? this.embeddingProvider.deleteDatabase
        ? this.embeddingProvider.deleteDatabase()
        : this.embeddingProvider.clearCache()
      : Promise.resolve();
    await Promise.all([vectorStoreClear, bm25Clear, embeddingCacheClear]);
    this.documentCorpus?.close();
    this.clearRAG({ dispose: false });
    await deleteRagIndexedDbGenerations(resetStorageLayout);

    const resetResult = await resetPluginOwnedData({
      adapter: this.app.vault.adapter,
      indexedDbNames,
    });

    const resetLanguage = resolveUiLanguage(undefined, getObsidianLanguage());
    for (const profile of this.settings.providerProfiles) chatGPTOAuth.disconnect(profile.id);
    setLanguage(resetLanguage);
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.settings.language = resetLanguage;
    const resetPromptLibrary = normalizePromptLibrary([], undefined, '');
    this.settings.chat.promptLibrary = resetPromptLibrary.promptLibrary;
    this.settings.chat.activePromptId = resetPromptLibrary.activePromptId;
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.getLogger().configure(this.settings.logging);
    saveLocalSettings(this.app, this.settings);
    await this.saveData(this.settings);
    await this.agentDiagnosticsService?.stop('plugin-reset');
    await this.agentDiagnosticsService?.clearDetailedLogging();
    this.initProvider();
    const mcpErrors = await this.initMCP();

    this.refreshBus.emit('models', { status: 'success', detail: 'Plugin data reset' });
    this.refreshBus.emit('rag', { status: 'success', detail: 'Plugin data reset' });
    this.refreshBus.emit('mcp', {
      status: mcpErrors.length === 0 ? 'success' : 'partial',
      detail: 'Plugin data reset',
    });

    this.getLogger().notice('Plugin data reset completed.', {
      source: 'settings.reset',
      data: {
        deletedLegacyDataDir: resetResult.deletedLegacyDataDir,
        deletedIndexedDbNames: resetResult.deletedIndexedDbNames,
        mcpErrors,
      },
    });
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
    } catch (err) {
      this.getLogger().warn('RAG status calculation failed.', { source: 'rag.status', error: err });
      if (this.refreshBus) {
        this.refreshBus.emit('rag', { status: 'error', detail: t('ragStatsFailed') });
      }
    }
  }

  async loadSettings(): Promise<void> {
    const localRaw = loadLocalSettings(this.app);
    const legacyRaw = (await this.loadData()) as unknown;
    const { raw, migratedFromLegacyData } = resolveSettingsLoadData(localRaw, legacyRaw);
    const data = { ...raw };
    const resolvedLanguage = resolveUiLanguage(data.language, getObsidianLanguage());
    data.language = resolvedLanguage;
    setLanguage(resolvedLanguage);

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
          const storedName =
            typeof provider.name === 'string' && provider.name.trim() ? provider.name.trim() : '';
          const name =
            storedName === 'Custom OpenAI-Compatible' ||
            isLocalizedValue('providerCustomDockTitle', storedName)
              ? ''
              : storedName;
          const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : '';
          const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl.trim() : '';
          const models = Array.isArray(provider.models)
            ? provider.models.filter((model): model is string => typeof model === 'string')
            : [];
          const enabled = typeof provider.enabled === 'boolean' ? provider.enabled : false;
          const useRequestUrl =
            typeof provider.useRequestUrl === 'boolean' ? provider.useRequestUrl : true;
          const capabilityOverrides = normalizeProviderCapabilityOverrides(
            provider.capabilityOverrides,
          );
          return {
            id,
            name,
            apiKey,
            baseUrl,
            models,
            enabled,
            useRequestUrl,
            ...(capabilityOverrides ? { capabilityOverrides } : {}),
          };
        });
    } else {
      data.customOpenAIProviders = [];
    }

    if (!Array.isArray(data.providerProfiles)) {
      data.providerProfiles = [];
    }

    if (
      typeof data.providerValidation !== 'object' ||
      data.providerValidation === null ||
      Array.isArray(data.providerValidation)
    ) {
      data.providerValidation = {};
    }

    const chat =
      data.chat && typeof data.chat === 'object' && !Array.isArray(data.chat)
        ? { ...(data.chat as Record<string, unknown>) }
        : {};
    data.chat = chat;
    if ('defaultProvider' in chat && !('defaultModel' in chat)) {
      const rawProvider = chat.defaultProvider;
      const oldProvider = typeof rawProvider === 'string' ? rawProvider : '';
      const oldModel =
        (
          (data[oldProvider] as Record<string, unknown> | undefined)?.models as string[] | undefined
        )?.[0] ?? '';
      if (oldProvider && oldModel) {
        chat.defaultModel = `${oldProvider}:${oldModel}`;
      }
    }

    if (!('systemPrompt' in chat)) {
      chat.systemPrompt = '';
    }
    const normalizedSaveFolder = normalizeChatSaveFolder(chat.saveFolder);
    if (normalizedSaveFolder !== null) {
      chat.saveFolder = normalizedSaveFolder;
    }
    const migratedPromptLibrary = normalizePromptLibrary(
      chat.promptLibrary,
      chat.activePromptId,
      typeof chat.systemPrompt === 'string' ? chat.systemPrompt : '',
    );
    chat.promptLibrary = migratedPromptLibrary.promptLibrary;
    chat.activePromptId = migratedPromptLibrary.activePromptId;
    if (!('mcpToolExecutionPolicy' in chat)) {
      chat.mcpToolExecutionPolicy = 'mentioned-auto';
    }

    // Migrate old RAG settings (pre-overhaul)
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
        embeddingProvider === 'ternlight' ||
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
        migratedRag.minScore = DEFAULT_SETTINGS.rag.minScore;
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
      if (typeof migratedRag.enableBM25 !== 'boolean') {
        migratedRag.enableBM25 = true;
      }
      if (typeof migratedRag.bm25Weight !== 'number') {
        migratedRag.bm25Weight = DEFAULT_SETTINGS.rag.bm25Weight;
      }
      migratedRag.performanceTuningMode = normalizeRagPerformanceTuningMode(
        migratedRag.performanceTuningMode,
      );
      migratedRag.performanceGuardEnabled = true;
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
    this.settings.chat = {
      ...DEFAULT_SETTINGS.chat,
      ...(data.chat as Partial<SuperpowerInsideSettings['chat']> | undefined),
    };
    this.settings = migrateLegacyProviderProfiles(this.settings);
    this.settings.logging = normalizeLoggerConfig(
      data.logging as Partial<SuperpowerInsideSettings['logging']> | undefined,
    );
    this.settings.agentDiagnostics = normalizeAgentDiagnosticsSettings(data.agentDiagnostics);
    this.getLogger().configure(this.settings.logging);
    setLanguage(this.settings.language);
    this.getLogger().info('Settings loaded.', {
      source: 'settings',
      data: {
        language: this.settings.language,
        logLevel: this.settings.logging.minLevel,
        logMaxEntries: this.settings.logging.maxEntries,
      },
    });
    if (migratedFromLegacyData) {
      saveLocalSettings(this.app, this.settings);
      await this.saveData(this.settings);
    }
  }

  async saveSettings(options?: {
    reinitRag?: boolean;
    reinitMcp?: boolean;
  }): Promise<{ success: boolean; mcpErrors?: string[] }> {
    const reinitRag = options?.reinitRag ?? true;
    const reinitMcp = options?.reinitMcp ?? true;
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.settings.agentDiagnostics = normalizeAgentDiagnosticsSettings(
      this.settings.agentDiagnostics,
    );
    this.getLogger().configure(this.settings.logging);
    saveLocalSettings(this.app, this.settings);
    await this.saveData(this.settings);
    await this.configureAgentDiagnosticsService();
    this.getLogger().debug('Settings saved.', {
      source: 'settings',
      data: { reinitRag, reinitMcp },
    });
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
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.settings.agentDiagnostics = normalizeAgentDiagnosticsSettings(
      this.settings.agentDiagnostics,
    );
    this.getLogger().configure(this.settings.logging);
    saveLocalSettings(this.app, this.settings);
    await this.saveData(this.settings);
    await this.configureAgentDiagnosticsService();
    this.getLogger().debug('Settings saved without runtime reinitialization.', {
      source: 'settings',
    });
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

  getRagRuntimeState() {
    const clearableEmbeddingProvider = hasClearableEmbeddingCache(this.embeddingProvider)
      ? this.embeddingProvider
      : null;
    return {
      ragStatus: this.eventDrivenRagStats,
      vectorStore: this.vectorStore,
      embeddingProvider: clearableEmbeddingProvider,
      ragIndexingScheduler: this.ragIndexingScheduler,
      ragIndexingStatus: this.ragIndexingStatus,
      hasIndexer: Boolean(this.vectorStore && this.vaultIndexer && this.ragIndexingScheduler),
      nextAutoUpdateAt: this.nextAutoUpdateAt,
      lastAutoUpdateSkippedReason: this.lastAutoUpdateSkippedReason,
      lastAutoUpdateResult: this.lastAutoUpdateResult,
      lastInitError: this.lastRagRuntimeInitError,
      lastInitSkippedReason: this.lastRagRuntimeInitSkippedReason,
      initRunning: this.ragRuntimeInitRunner?.isRunning() ?? false,
      lastInitStage: this.lastRagRuntimeInitStage,
      lastInitStartedAt: this.lastRagRuntimeInitStartedAt,
      lastInitFinishedAt: this.lastRagRuntimeInitFinishedAt,
    };
  }

  private initProvider(): void {
    const modelPlan = resolveChatModelPlan(this.settings);
    const effectiveModel = modelPlan.selectedModel;
    if (!effectiveModel) {
      this.provider = null;
      this.getLogger().warn('No usable chat model is configured.', {
        source: 'provider',
        data: {
          configuredModel: this.settings.chat.defaultModel,
          enabledProviderCount: modelPlan.enabledProviderCount,
        },
      });
      return;
    }
    try {
      const resolved = createChatProviderForModel(this.settings, effectiveModel);
      if (!resolved) {
        this.provider = null;
        this.getLogger().warn('Rust model plan rejected the selected chat provider.', {
          source: 'provider',
          data: { configuredModel: this.settings.chat.defaultModel, effectiveModel },
        });
        return;
      }
      this.provider = resolved.provider;
      this.getLogger().info('Chat provider initialized.', {
        source: 'provider',
        data: { provider: resolved.providerKey, model: resolved.model },
      });
    } catch (err) {
      this.provider = null;
      this.getLogger().error('Chat provider initialization failed.', {
        source: 'provider',
        data: { effectiveModel },
        error: err,
      });
    }
  }

  private debouncedRefreshStats(): void {
    if (this.statsDebounceTimer) {
      window.clearTimeout(this.statsDebounceTimer);
    }
    this.statsDebounceTimer = window.setTimeout(() => {
      this.refreshRagStatusInBackground();
    }, 500);
  }

  private async canRunRagBackgroundWork(): Promise<boolean> {
    const guard = this.ragPerformanceGuard;
    if (!guard) return true;
    await guard.measureEventLoopLag();
    return guard.getState().mode !== 'paused';
  }

  private async waitForRagBackgroundCapacity(): Promise<void> {
    const guard = this.ragPerformanceGuard;
    if (!guard) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      return;
    }
    while (true) {
      await guard.measureEventLoopLag();
      const state = guard.getState();
      if (state.mode !== 'paused') return;
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, Math.max(50, Math.min(state.remainingPauseMs ?? 1_000, 1_000))),
      );
    }
  }

  private async rebuildBM25Index(bm25Index: IndexedDbBM25Index): Promise<void> {
    await bm25Index.rebuildFrom(() => this.buildBM25IndexDocumentsFromVault());
  }

  private startBM25BackgroundLoad(
    bm25Index: IndexedDbBM25Index,
  ): Promise<BM25BackgroundLoadOutcome> {
    const startedAt = Date.now();
    this.getLogger().info('BM25 index background initialization started.', {
      source: 'rag.bm25',
    });
    void this.recordAgentDiagnosticsBreadcrumb({
      phase: 'rag.bm25',
      action: 'enter',
      detail: 'background-load',
    });
    return bm25Index.load().then(
      () => ({ error: null, startedAt, loadDurationMs: Date.now() - startedAt }),
      (error: unknown) => ({
        error: error instanceof Error ? error : new Error(String(error)),
        startedAt,
        loadDurationMs: Date.now() - startedAt,
      }),
    );
  }

  private async finishBM25BackgroundLoad(
    bm25Index: IndexedDbBM25Index,
    loadOutcome: Promise<BM25BackgroundLoadOutcome>,
    runId: number,
  ): Promise<boolean> {
    const outcome = await loadOutcome;
    const isCurrent = (): boolean =>
      !this.unloaded && this.ragRuntimeInitRunId === runId && this.bm25Index === bm25Index;
    if (!isCurrent()) {
      this.getLogger().debug('BM25 background initialization stopped because ownership changed.', {
        source: 'rag.bm25',
        data: {
          runId,
          durationMs: Date.now() - outcome.startedAt,
          loadDurationMs: outcome.loadDurationMs,
        },
      });
      return false;
    }

    try {
      if (outcome.error) throw outcome.error;
      const files = await getRagCandidateFiles(
        this.app.vault,
        this.settings.rag,
        this.settings.chat,
      );
      const sourcePaths = new Set(await bm25Index.getSourcePaths());
      const readiness = await new RAGQueryEngine(null, null, bm25Index).getIndexReadiness(
        files.map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size })),
      );
      const corpusMatches =
        sourcePaths.size === files.length && files.every((file) => sourcePaths.has(file.path));
      if (
        !bm25Index.isTokenizerCurrent ||
        bm25Index.totalDocs === 0 ||
        !corpusMatches ||
        readiness?.readiness !== 'ready'
      ) {
        this.getLogger().notice('BM25 corpus is missing or outdated; rebuilding it.', {
          source: 'rag.bm25',
        });
        await this.rebuildBM25Index(bm25Index);
      }
      if (!isCurrent()) {
        this.getLogger().debug(
          'BM25 background initialization stopped because ownership changed.',
          {
            source: 'rag.bm25',
            data: {
              runId,
              durationMs: Date.now() - outcome.startedAt,
              loadDurationMs: outcome.loadDurationMs,
            },
          },
        );
        return false;
      }
      this.getLogger().info('BM25 index background initialization completed.', {
        source: 'rag.bm25',
        data: {
          durationMs: Date.now() - outcome.startedAt,
          loadDurationMs: outcome.loadDurationMs,
          totalDocs: bm25Index.totalDocs,
        },
      });
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.bm25',
        action: 'leave',
        detail: 'background-load',
        data: {
          durationMs: Date.now() - outcome.startedAt,
          loadDurationMs: outcome.loadDurationMs,
          totalDocs: bm25Index.totalDocs,
        },
      });
      this.notifyRagStatsRefresh();
      return true;
    } catch (error) {
      if (!isCurrent()) {
        this.getLogger().debug(
          'BM25 background initialization stopped because ownership changed.',
          {
            source: 'rag.bm25',
            data: {
              runId,
              durationMs: Date.now() - outcome.startedAt,
              loadDurationMs: outcome.loadDurationMs,
            },
          },
        );
        return false;
      }
      bm25Index.close();
      this.bm25Index = null;
      this.vaultIndexer?.setBM25Index(undefined);
      if (!this.vectorStore) {
        this.registerLexicalRAGEvents(undefined);
      }
      this.getLogger().warn('BM25 index initialization failed; continuing without BM25.', {
        source: 'rag.bm25',
        data: {
          durationMs: Date.now() - outcome.startedAt,
          loadDurationMs: outcome.loadDurationMs,
        },
        error,
      });
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.bm25',
        action: 'error',
        detail: 'background-load',
        data: {
          durationMs: Date.now() - outcome.startedAt,
          loadDurationMs: outcome.loadDurationMs,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  private async buildBM25IndexDocumentsFromVault(): Promise<BM25CorpusDocument[]> {
    if (this.vaultDocumentCorpus && this.documentCorpus) {
      await this.vaultDocumentCorpus.refresh();
      return this.documentCorpus.getDocuments();
    }
    const files = await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat);
    const documents: BM25CorpusDocument[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      documents.push(...this.buildBM25CorpusDocuments(file, content));
    }
    return documents;
  }

  private buildBM25CorpusDocuments(file: TFile, content: string): BM25CorpusDocument[] {
    return buildBM25CorpusDocuments(file, content, this.settings.rag);
  }

  private async indexBM25File(
    bm25Index: IndexedDbBM25Index | undefined,
    file: TFile,
  ): Promise<void> {
    await this.vaultDocumentCorpus?.refreshFile(file);
    const documents = (await this.documentCorpus?.getDocumentsByFilePath(file.path)) ?? [];
    await bm25Index?.withBatch(async () => {
      bm25Index.removeDocumentsBySource(file.path);
      for (const document of documents) bm25Index.addCorpusDocument(document);
      await bm25Index.persist();
    });
    this.debouncedRefreshStats();
  }

  private getStructuralMetadataContext(): StructuralMetadataContext | undefined {
    const metadata = this.app.metadataCache;
    if (!metadata) return undefined;
    return {
      resolvedLinks: metadata.resolvedLinks,
      getFileByPath: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
      },
      getFileCache: (file) => metadata.getFileCache(file),
      getFirstLinkpathDest: (linkpath, sourcePath) =>
        metadata.getFirstLinkpathDest(linkpath, sourcePath),
    };
  }

  private async removeBM25File(
    bm25Index: IndexedDbBM25Index | undefined,
    filePath: string,
  ): Promise<number> {
    await this.vaultDocumentCorpus?.removeFile(filePath);
    bm25Index?.removeDocumentsBySource(filePath);
    await bm25Index?.persist();
    return 0;
  }

  async initRAG(): Promise<void> {
    await this.getRagRuntimeInitRunner().run();
  }

  async ensureRagRuntimeInitialized(): Promise<boolean> {
    if (this.vectorStore && this.vaultIndexer && this.ragIndexingScheduler) {
      return true;
    }
    await this.initRAG();
    return Boolean(this.vectorStore && this.vaultIndexer && this.ragIndexingScheduler);
  }

  async prepareRagForChat(): Promise<boolean> {
    const initialized = this.ragEngine ? true : await this.ensureRagRuntimeInitialized();
    if (this.bm25Index) await this.bm25Index.recoverClosedWorker();
    return initialized;
  }

  private getRagIndexerNotInitializedReason(): string {
    const rag = this.settings.rag;
    const resolvedEmbeddingModel = resolveProviderModelRef(
      this.settings,
      rag.embeddingModelRef ?? '',
      'embedding',
    );
    let reason = t('ragIndexerNotInitializedBase');
    if (this.lastRagRuntimeInitError) {
      return `${reason} ${t('ragIndexerLastInitError', {
        message: this.lastRagRuntimeInitError,
      })}`;
    }
    if (this.lastRagRuntimeInitSkippedReason) {
      return `${reason} ${t('ragIndexerLastInitSkipped', {
        reason: this.lastRagRuntimeInitSkippedReason,
      })}`;
    }
    if (!resolvedEmbeddingModel) {
      reason += ` ${t('ragIndexerSelectEmbeddingModel')}`;
    } else if (!resolvedEmbeddingModel.profile.enabled) {
      reason += ` ${t('ragIndexerEnableProvider', {
        provider:
          resolvedEmbeddingModel.profile.name.trim() || resolvedEmbeddingModel.profile.strategy,
      })}`;
    } else {
      reason += ` ${t('ragIndexerConnectionFailed', {
        provider:
          resolvedEmbeddingModel.profile.name.trim() || resolvedEmbeddingModel.profile.strategy,
        model: resolvedEmbeddingModel.modelId,
      })}`;
    }
    return reason;
  }

  private getRagRuntimeInitRunner(): CoalescedAsyncRunner {
    if (!this.ragRuntimeInitRunner) {
      this.ragRuntimeInitRunner = new CoalescedAsyncRunner(() => this.initRAGRuntime());
    }
    return this.ragRuntimeInitRunner;
  }

  private async runRagRuntimeInitStep<T>(
    stage: string,
    operation: () => Promise<T>,
    timeoutMs: number | null = RAG_RUNTIME_INIT_STEP_TIMEOUT_MS,
  ): Promise<T> {
    const startedAt = Date.now();
    this.lastRagRuntimeInitStage = stage;
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'rag.runtime',
      action: 'enter',
      detail: stage,
    });
    this.getLogger().info('RAG runtime initialization step started.', {
      source: 'rag',
      data: { stage },
    });
    try {
      const pending = Promise.resolve().then(operation);
      const result =
        timeoutMs === null
          ? await pending
          : await this.withRagRuntimeInitTimeout(pending, stage, timeoutMs);
      this.getLogger().info('RAG runtime initialization step completed.', {
        source: 'rag',
        data: { stage, durationMs: Date.now() - startedAt },
      });
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.runtime',
        action: 'leave',
        detail: stage,
        data: { durationMs: Date.now() - startedAt },
      });
      return result;
    } catch (err) {
      if (this.unloaded) {
        this.getLogger().debug(
          'RAG runtime initialization step stopped because the plugin unloaded.',
          {
            source: 'rag',
            data: { stage, durationMs: Date.now() - startedAt },
          },
        );
        throw err;
      }
      this.lastRagRuntimeInitError = err instanceof Error ? err.message : String(err);
      this.getLogger().error('RAG runtime initialization step failed.', {
        source: 'rag',
        data: { stage, durationMs: Date.now() - startedAt },
        error: err,
      });
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.runtime',
        action: 'error',
        detail: stage,
        data: {
          durationMs: Date.now() - startedAt,
          message: this.lastRagRuntimeInitError,
        },
      });
      throw err;
    }
  }

  private async withRagRuntimeInitTimeout<T>(
    operation: Promise<T>,
    stage: string,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutId: number | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(
          new Error(
            t('ragRuntimeInitStepTimedOut', {
              stage,
              seconds: String(Math.ceil(timeoutMs / 1000)),
            }),
          ),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private captureRagRuntimeSnapshot(): RagRuntimeSnapshot {
    return {
      documentCorpus: this.documentCorpus,
      vaultDocumentCorpus: this.vaultDocumentCorpus,
      vectorStore: this.vectorStore,
      embeddingProvider: this.embeddingProvider,
      bm25Index: this.bm25Index,
      ragEngine: this.ragEngine,
      vaultIndexer: this.vaultIndexer,
      ragIndexingScheduler: this.ragIndexingScheduler,
      automaticRagRecovery: this.automaticRagRecovery,
      ragPerformanceGuard: this.ragPerformanceGuard,
      ragIndexingStatus: this.ragIndexingStatus,
      nextAutoUpdateAt: this.nextAutoUpdateAt,
      lastAutoUpdateSkippedReason: this.lastAutoUpdateSkippedReason,
      lastAutoUpdateResult: this.lastAutoUpdateResult,
    };
  }

  private restoreRagRuntimeSnapshot(snapshot: RagRuntimeSnapshot): boolean {
    if (
      !(snapshot.documentCorpus && snapshot.ragEngine) &&
      !(snapshot.vectorStore && snapshot.vaultIndexer && snapshot.ragIndexingScheduler)
    ) {
      return false;
    }
    this.documentCorpus = snapshot.documentCorpus;
    this.vaultDocumentCorpus = snapshot.vaultDocumentCorpus;
    this.vaultDocumentCorpus?.resume();
    this.vectorStore = snapshot.vectorStore;
    this.embeddingProvider = snapshot.embeddingProvider;
    this.bm25Index = snapshot.bm25Index;
    this.ragEngine = snapshot.ragEngine;
    this.vaultIndexer = snapshot.vaultIndexer;
    this.ragIndexingScheduler = snapshot.ragIndexingScheduler;
    this.automaticRagRecovery = snapshot.automaticRagRecovery;
    this.ragPerformanceGuard = snapshot.ragPerformanceGuard;
    this.ragIndexingStatus = snapshot.ragIndexingStatus;
    this.nextAutoUpdateAt = snapshot.nextAutoUpdateAt;
    this.lastAutoUpdateSkippedReason = snapshot.lastAutoUpdateSkippedReason;
    this.lastAutoUpdateResult = snapshot.lastAutoUpdateResult;
    this.setupAutoUpdate();
    this.setupRagStatusTimer();
    if (this.ragIndexingScheduler) this.registerRAGEvents();
    else this.registerLexicalRAGEvents(this.bm25Index ?? undefined);
    this.automaticRagRecovery?.resume();
    this.refreshBus?.emit('rag', {
      status: 'success',
      detail: this.ragIndexingStatus
        ? this.formatRagIndexingStatus(this.ragIndexingStatus)
        : t('ragIdle'),
    });
    return true;
  }

  private disposeRagRuntimeSnapshot(snapshot: RagRuntimeSnapshot): void {
    snapshot.vaultDocumentCorpus?.dispose();
    snapshot.documentCorpus?.close();
    snapshot.automaticRagRecovery?.dispose();
    snapshot.vectorStore?.close?.();
    snapshot.bm25Index?.close?.();
    snapshot.embeddingProvider?.close?.();
  }

  private async initRAGRuntime(): Promise<void> {
    // NOTE: We intentionally do NOT call vectorStore.clear() or embeddingProvider.clearCache()
    // here. Clearing embeddings must only happen via explicit user action (the "Clear Embedding Data"
    // button or "Reindex All" command). Re-initializing RAG with a new provider/model must
    // preserve existing vector store data so users can incrementally reindex.

    const runId =
      (Number.isSafeInteger(this.ragRuntimeInitRunId) ? this.ragRuntimeInitRunId : 0) + 1;
    this.ragRuntimeInitRunId = runId;
    const isCurrentRun = (): boolean => !this.unloaded && this.ragRuntimeInitRunId === runId;
    const requireCurrentRun = (): void => {
      if (!isCurrentRun()) throw new RagRuntimeInitializationCancelledError();
    };
    const previousRuntime = this.captureRagRuntimeSnapshot();
    previousRuntime.automaticRagRecovery?.suspend();
    previousRuntime.vaultDocumentCorpus?.suspend();
    // Detach the current runtime while the replacement is assembled. Keep its
    // stores open so a failed rebuild can restore a genuinely usable snapshot.
    this.clearRAG({ dispose: false });
    this.lastRagRuntimeInitError = null;
    this.lastRagRuntimeInitSkippedReason = null;
    this.lastRagRuntimeInitStage = 'starting';
    this.lastRagRuntimeInitStartedAt = Date.now();
    this.lastRagRuntimeInitFinishedAt = null;

    try {
      const rag = this.settings.rag;
      const configuredEmbeddingModel = resolveProviderModelRef(
        this.settings,
        rag.embeddingModelRef ?? '',
        'embedding',
      );
      const resolvedEmbeddingModel = resolveUsableProviderModelRef(
        this.settings,
        rag.embeddingModelRef ?? '',
        'embedding',
      );
      const providerKey = configuredEmbeddingModel
        ? `profile:${configuredEmbeddingModel.profile.id}`
        : '';
      this.getLogger().info('RAG runtime initialization started.', {
        source: 'rag',
        data: {
          embeddingProvider: providerKey,
          embeddingModel: resolvedEmbeddingModel?.modelId ?? '',
          vectorStore: 'indexeddb',
          bm25Enabled: rag.enableBM25,
        },
      });

      const embeddingNamespace = resolvedEmbeddingModel
        ? createEmbeddingCacheNamespace(providerKey, resolvedEmbeddingModel.modelId)
        : 'lexical-baseline';
      const storageLayout = createRagStorageLayout({
        pluginId: this.manifest?.id ?? 'superpower-inside',
        vaultIdentity: this.getVaultStorageIdentity(),
        legacyVaultName: this.getVaultName(),
        embeddingNamespace,
        indexNamespace: createRagIndexNamespace(rag),
      });
      this.documentCorpus = new IndexedDbDocumentCorpusStore(storageLayout.active.corpus);
      this.vaultDocumentCorpus = new VaultDocumentCorpus(
        this.app.vault,
        this.documentCorpus,
        () => this.settings.rag,
        () => this.settings.chat,
        this.getLogger(),
      );
      const sourceCorpus = this.vaultDocumentCorpus;
      void sourceCorpus
        .refresh()
        .then(() => {
          if (this.vaultDocumentCorpus === sourceCorpus) this.debouncedRefreshStats();
        })
        .catch((error: unknown) => {
          this.getLogger().warn(
            'Source corpus refresh failed; native source reads remain available.',
            {
              source: 'rag.corpus',
              error,
            },
          );
        });
      let bm25Index: IndexedDbBM25Index | undefined;
      let bm25LoadOutcome: Promise<BM25BackgroundLoadOutcome> | null = null;
      let bm25BackgroundCompletionStarted = false;
      const finishBM25InBackground = (): void => {
        if (bm25BackgroundCompletionStarted || !bm25Index || !bm25LoadOutcome) return;
        bm25BackgroundCompletionStarted = true;
        const activeIndex = bm25Index;
        void this.finishBM25BackgroundLoad(activeIndex, bm25LoadOutcome, runId).then(
          (available) => {
            if (!available && bm25Index === activeIndex) {
              bm25Index = undefined;
            }
          },
        );
      };
      if (rag.enableBM25) {
        const nextBm25Index = new IndexedDbBM25Index(
          storageLayout.active.bm25,
          this.app.vault.adapter,
        );
        bm25Index = nextBm25Index;
        this.bm25Index = nextBm25Index;
        this.ragEngine = new RAGQueryEngine(null, null, nextBm25Index, 1, rag.minScore, {
          corpusStore: this.documentCorpus,
          structuralGraphEnabled: rag.structuralGraphEnabled,
          structuralMetadataContext: this.getStructuralMetadataContext(),
          getCandidatePaths: async () =>
            new Set(
              (
                await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)
              ).map((file) => file.path),
            ),
        });
        // 큰 로컬 색인은 채팅과 벡터 검색 런타임을 막지 않고 worker에서 준비한다.
        bm25LoadOutcome = this.startBM25BackgroundLoad(nextBm25Index);
      }
      this.ragEngine ??= new RAGQueryEngine(null, null, undefined, rag.bm25Weight, rag.minScore, {
        corpusStore: this.documentCorpus,
        getCandidatePaths: async () =>
          new Set(
            (await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)).map(
              (file) => file.path,
            ),
          ),
      });
      requireCurrentRun();
      if (!resolvedEmbeddingModel) {
        this.lastRagRuntimeInitSkippedReason = configuredEmbeddingModel
          ? t('ragIndexerConnectionFailed', {
              provider:
                configuredEmbeddingModel.profile.name.trim() ||
                configuredEmbeddingModel.profile.strategy,
              model: configuredEmbeddingModel.modelId,
            })
          : t('ragIndexerSelectEmbeddingModel');
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().warn('RAG embedding model is unavailable.', {
          source: 'rag',
          data: {
            embeddingModelRef: rag.embeddingModelRef,
            configured: Boolean(configuredEmbeddingModel),
          },
        });
        this.registerLexicalRAGEvents(bm25Index);
        this.disposeRagRuntimeSnapshot(previousRuntime);
        finishBM25InBackground();
        return;
      }

      const { profile, modelId: embeddingModel } = resolvedEmbeddingModel;
      if (!profile.enabled) {
        this.lastRagRuntimeInitSkippedReason = t('ragIndexerEnableProvider', {
          provider: profile.name.trim() || profile.strategy,
        });
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().warn('RAG embedding provider profile is disabled.', {
          source: 'rag',
          data: { embeddingProvider: providerKey },
        });
        this.registerLexicalRAGEvents(bm25Index);
        this.disposeRagRuntimeSnapshot(previousRuntime);
        finishBM25InBackground();
        return;
      }
      if (
        profile.strategy !== 'ollama' &&
        profile.strategy !== 'openai' &&
        profile.strategy !== 'openRouter' &&
        profile.strategy !== 'openAICompatible' &&
        profile.strategy !== 'ternlight'
      ) {
        this.lastRagRuntimeInitSkippedReason =
          'Embedding is not supported by this provider profile.';
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().warn('RAG embedding provider profile is unsupported.', {
          source: 'rag',
          data: { embeddingProvider: providerKey, strategy: profile.strategy },
        });
        this.registerLexicalRAGEvents(bm25Index);
        this.disposeRagRuntimeSnapshot(previousRuntime);
        finishBM25InBackground();
        return;
      }

      let baseUrl: string | undefined;
      let apiKey = '';
      const apiKeyVisibilityKey =
        profile.strategy === 'openAICompatible' ? 'customOpenAI' : profile.strategy;
      if (shouldShowProviderApiKey(apiKeyVisibilityKey)) {
        apiKey = profile.apiKey;
        if (profile.baseUrl) {
          baseUrl = profile.baseUrl;
        }
      }
      if (!baseUrl) {
        if (profile.strategy === 'openai') {
          baseUrl = 'https://api.openai.com';
        } else if (profile.strategy === 'openRouter') {
          baseUrl = 'https://openrouter.ai/api';
        } else if (profile.strategy === 'ollama') {
          baseUrl = 'http://localhost:11434';
        }
      }

      // Create embedding provider
      let rawProvider: EmbeddingProvider;
      if (profile.strategy === 'ternlight') {
        rawProvider =
          embeddingModel === 'embeddinggemma-300m'
            ? new EmbeddingGemmaProvider({
                app: this.app,
                pluginId: this.manifest.id,
                pluginVersion: this.manifest.version,
              })
            : new TernlightEmbeddingProvider(
                embeddingModel,
                {
                  app: this.app,
                  pluginId: this.manifest.id,
                  pluginVersion: this.manifest.version,
                },
                { logger: this.getLogger() },
              );
      } else if (profile.strategy === 'ollama') {
        rawProvider = new OllamaEmbeddingProvider(
          baseUrl ?? 'http://localhost:11434',
          embeddingModel,
          apiKey,
          {
            logger: this.getLogger(),
          },
        );
      } else {
        rawProvider = new OpenAIEmbeddingProvider(apiKey, baseUrl, embeddingModel, {
          logger: this.getLogger(),
        });
      }

      const embeddingProvider = new CachedEmbeddingProvider(rawProvider, embeddingNamespace, {
        dbName: storageLayout.active.embeddingCache,
        persistent: profile.strategy !== 'ternlight',
      });
      this.embeddingProvider = embeddingProvider;

      const performanceSettings = resolveRagPerformanceSettings(profile.strategy, embeddingModel);
      this.ragPerformanceGuard = performanceSettings.enabled
        ? new PerformanceGuard({
            enabled: true,
            initialBatchSize: performanceSettings.maxEmbeddingBatchSize,
            initialYieldMs: performanceSettings.indexingYieldMs,
            slowEventLoopThresholdMs: performanceSettings.slowEventLoopThresholdMs,
            slowBatchThresholdMs: performanceSettings.slowBatchThresholdMs,
            onPolicyError: (message) => {
              this.getLogger().error(
                'RAG performance guard policy failed; preserving last state.',
                {
                  source: 'rag.performance-guard',
                  data: { message },
                },
              );
              void this.recordAgentDiagnosticsBreadcrumb({
                phase: 'rag.performance-guard',
                action: 'error',
                detail: message,
              });
            },
          })
        : null;
      const adaptiveBatchSize = performanceSettings.enabled
        ? performanceSettings.maxEmbeddingBatchSize
        : undefined;
      const indexingYieldMs = performanceSettings.enabled ? performanceSettings.indexingYieldMs : 0;

      // Vector store
      const vectorStore = new IndexedDbVectorStore(storageLayout.active.vector);
      await this.runRagRuntimeInitStep('legacy-vector-import', () =>
        importLegacyJsonVectorStore(
          this.app.vault.adapter,
          vectorStore,
          '.superpower-inside/vectors.json',
          { requireSourceChunkIds: true },
        ),
      );
      requireCurrentRun();
      this.vectorStore = vectorStore;
      requireCurrentRun();

      // 벡터 검색 런타임이 준비된 뒤 BM25를 연결합니다.
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

      const createQueryEngine = (index?: IndexedDbBM25Index): RAGQueryEngine =>
        new RAGQueryEngine(
          this.vectorStore,
          this.embeddingProvider,
          index,
          rag.bm25Weight,
          rag.minScore,
          {
            corpusStore: this.documentCorpus ?? undefined,
            getCandidatePaths: async () =>
              new Set(
                (
                  await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)
                ).map((file) => file.path),
              ),
            annEnabled: rag.annEnabled,
            annClusterCount: rag.annClusterCount,
            annProbeCount: rag.annProbeCount,
            structuralGraphEnabled: rag.structuralGraphEnabled,
            structuralMetadataContext,
            embeddingProvider: rag.embeddingProvider,
            embeddingModel: rag.embeddingModel,
          },
        );

      // 선택적 BM25 로딩을 시작하기 전에 벡터 검색을 사용할 수 있습니다.
      this.ragEngine = createQueryEngine(bm25Index);
      requireCurrentRun();

      this.bm25Index = bm25Index ?? null;

      this.vaultIndexer = new VaultIndexer(
        this.app.vault,
        this.vectorStore,
        this.embeddingProvider,
        this.settings.rag,
        this.settings.chat,
        bm25Index,
        this.getLogger(),
        this.vaultDocumentCorpus ?? undefined,
      );

      this.ragIndexingScheduler = new RAGIndexingScheduler({
        debounceMs: 500,
        indexFile: (file, options) => this.vaultIndexer!.indexFile(file, options),
        removeFile: (filePath) => this.vaultIndexer!.removeFile(filePath),
        indexPending: (options) => this.vaultIndexer!.indexPending(options),
        reindexAll: (options) => this.vaultIndexer!.reindexAll(options),
        createIndexingOptions: (signal) => ({
          signal,
          maxEmbeddingBatchSize: this.ragPerformanceGuard?.getBatchSize() ?? adaptiveBatchSize,
          indexingYieldMs: this.ragPerformanceGuard?.getYieldMs() ?? indexingYieldMs,
          getMaxEmbeddingBatchSize: () =>
            this.ragPerformanceGuard?.getBatchSize() ?? adaptiveBatchSize,
          getIndexingYieldMs: () => this.ragPerformanceGuard?.getYieldMs() ?? indexingYieldMs,
          onBatchComplete: async (durationMs, batchSize) => {
            this.getLogger().debug('RAG embedding batch completed.', {
              source: 'rag.indexing',
              data: {
                durationMs: Math.round(durationMs),
                batchSize,
                guardState: this.ragPerformanceGuard?.getState().mode ?? 'normal',
              },
            });
            this.ragPerformanceGuard?.recordBatchDuration(durationMs, batchSize);
            await this.ragPerformanceGuard?.measureEventLoopLag();
          },
          onProgress: (progress) => {
            void this.recordAgentDiagnosticsBreadcrumb({
              phase: 'rag.indexing',
              action: 'mark',
              detail: 'operation',
              data: {
                event: progress.event,
                processed: progress.completedFiles,
                total: progress.totalFiles,
                currentFile: progress.currentFilePath ?? null,
                currentFileEmbeddedChunks: progress.currentFileEmbeddedChunks,
                currentFileTotalChunks: progress.currentFileTotalChunks,
              },
            });
          },
          getPerformanceGuardState: () => this.ragPerformanceGuard?.getState() ?? null,
        }),
        getPerformanceGuardState: () => this.ragPerformanceGuard?.getState() ?? null,
        resumePerformanceGuard: (force) =>
          force
            ? (this.ragPerformanceGuard?.forceResume() ?? null)
            : (this.ragPerformanceGuard?.resume() ?? null),
        onStatusChange: (status) => this.handleRagIndexingStatusChange(status),
      });

      const scheduler = this.ragIndexingScheduler;
      const ragConfig = this.settings.rag;
      const chatConfig = this.settings.chat;
      const listAutomaticRecoveryFiles = async () => {
        const files = await getRagCandidateFiles(this.app.vault, ragConfig, chatConfig);
        const snapshots = files.map((file) => ({
          path: file.path,
          mtime: file.stat.mtime,
          size: file.stat.size,
        }));
        const eligible = selectAutomaticRecoveryEligibleFiles(snapshots);
        if (!eligible) throw new Error('Rust automatic RAG recovery eligibility planning failed');
        return eligible;
      };
      const listRagCandidateFilePaths = async () => {
        const files = await getRagCandidateFiles(this.app.vault, ragConfig, chatConfig);
        return files.map((file) => file.path);
      };
      const countAutomaticRecoveryPendingDocuments = async () => {
        const [eligibleFiles, status] = await Promise.all([
          listAutomaticRecoveryFiles(),
          calculateRagStatus(this.app.vault, vectorStore, ragConfig, chatConfig),
        ]);
        const eligiblePaths = new Set(eligibleFiles.map((file) => file.path));
        return status.updateRequiredDocuments.filter((document) => eligiblePaths.has(document.path))
          .length;
      };
      this.automaticRagRecovery = new AutomaticRagRecoveryCoordinator({
        listCandidateFiles: listAutomaticRecoveryFiles,
        readCompletedFingerprint: () =>
          vectorStore.getMetaValue<string>(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY),
        writeCompletedFingerprint: (fingerprint) =>
          vectorStore.setMetaValue(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY, fingerprint),
        runPending: async () => {
          await scheduler.indexPending({ automaticRecovery: true });
        },
        waitForIdle: () => scheduler.waitForIdle(),
        countPendingDocuments: countAutomaticRecoveryPendingDocuments,
        runHealthyMaintenance: async (fingerprint, force, isCancelled) => {
          await scheduler.waitForIdle();
          await runRagStorageMaintenance(
            {
              listCandidateFiles: listAutomaticRecoveryFiles,
              listValidFilePaths: listRagCandidateFilePaths,
              readRecoveryFingerprint: () =>
                vectorStore.getMetaValue<string>(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY),
              countPendingDocuments: countAutomaticRecoveryPendingDocuments,
              probeActiveStore: (candidateFilePaths) =>
                vectorStore.probeActiveHealth({
                  candidateFilePaths,
                  embeddingProvider: ragConfig.embeddingProvider,
                  embeddingModel: ragConfig.embeddingModel,
                }),
              readMaintenanceFingerprint: () =>
                vectorStore.getMetaValue<string>(RAG_STORAGE_MAINTENANCE_COMPLETION_KEY),
              writeMaintenanceFingerprint: (completedFingerprint) =>
                vectorStore.setMetaValue(
                  RAG_STORAGE_MAINTENANCE_COMPLETION_KEY,
                  completedFingerprint,
                ),
              reconcileActiveStoreBatch: async (input) =>
                vectorStore.reconcileBatch({
                  lifecycleKey: input.fingerprint,
                  validFilePaths: input.candidateFilePaths,
                  embeddingProvider: ragConfig.embeddingProvider,
                  embeddingModel: ragConfig.embeddingModel,
                  expectedDimension: input.expectedDimension,
                }),
              pruneEmbeddingCacheBatch: () => embeddingProvider.prunePersistentCacheBatch(),
              reconcileBm25SourceBatch: (validFilePaths) =>
                bm25Index?.reconcileSourcePaths(validFilePaths) ??
                Promise.resolve({ remainingWork: false }),
              cleanupStaleGenerationBatch: () =>
                cleanupStaleIndexedDbGenerations(storageLayout, {
                  preserveEmbeddingCache: embeddingProvider.persistentCacheEnabled,
                  preserveBm25: bm25Index !== undefined,
                }),
              cleanupInactiveVaultDatabaseBatch: () =>
                cleanupInactiveRagIndexedDb(storageLayout, this.manifest.id),
              cleanupLegacyFileArtifacts: () =>
                maintainPluginOwnedFiles({
                  adapter: this.app.vault.adapter,
                  pluginDirectory: this.getPluginDirectoryPath(),
                  eventLogPath: this.getAgentDiagnosticsEventLogPath(),
                  allowLegacyCleanup: true,
                  includePluginDirectory: false,
                }),
              yieldToHost: () => this.waitForRagBackgroundCapacity(),
            },
            fingerprint,
            force,
            isCancelled,
          );
        },
        timer: createWindowAutomaticRagRecoveryTimer(),
        onEvent: (event, detail) => this.logAutomaticRagRecoveryEvent(event, detail),
      });

      // Auto-update timer
      this.setupAutoUpdate();
      // 초기 상태 계산 이후에는 vault 이벤트가 상태 갱신을 유도한다.
      this.setupRagStatusTimer();
      this.registerRAGEvents();
      await this.automaticRagRecovery.start();
      requireCurrentRun();
      this.getLogger().info('RAG runtime initialization completed.', {
        source: 'rag',
        data: {
          hasVectorStore: this.vectorStore !== null,
          bm25Enabled: this.bm25Index !== null,
          bm25Ready: this.bm25Index?.isReady ?? false,
        },
      });
      this.lastRagRuntimeInitError = null;
      this.lastRagRuntimeInitSkippedReason = null;
      this.lastRagRuntimeInitStage = null;
      this.lastRagRuntimeInitFinishedAt = Date.now();
      this.disposeRagRuntimeSnapshot(previousRuntime);
      finishBM25InBackground();
    } catch (err) {
      const failedRuntime = this.captureRagRuntimeSnapshot();
      this.clearRAG({ dispose: false });
      this.disposeRagRuntimeSnapshot(failedRuntime);
      if (err instanceof RagRuntimeInitializationCancelledError || !isCurrentRun()) {
        this.disposeRagRuntimeSnapshot(previousRuntime);
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().debug('RAG runtime initialization stopped because ownership changed.', {
          source: 'rag',
          data: { runId },
        });
        return;
      }
      const restored = this.restoreRagRuntimeSnapshot(previousRuntime);
      this.lastRagRuntimeInitError =
        this.lastRagRuntimeInitError ?? (err instanceof Error ? err.message : String(err));
      this.lastRagRuntimeInitFinishedAt = Date.now();
      this.getLogger().error(
        restored
          ? 'RAG runtime initialization failed; restored previous runtime.'
          : 'RAG runtime initialization failed; no previous runtime was available.',
        { source: 'rag', error: err },
      );
      throw err;
    }
  }

  private formatRagIndexingStatus(status: RagIndexingSchedulerStatus): string {
    const guardState =
      status.lastResult?.guardState ?? this.ragPerformanceGuard?.getState() ?? null;
    if (guardState?.mode === 'paused') {
      return t('ragPerformancePaused');
    }
    if (status.running) {
      const progress = status.progress;
      if (progress && progress.totalFiles > 0) {
        const completed = Math.min(progress.completedFiles, progress.totalFiles);
        const phase = this.formatRagIndexingPhase(status.phase, progress);
        const etaReason = this.formatRagEtaConfidenceReason(
          progress.eta?.etaConfidenceReason ?? progress.eta?.confidenceReason,
        );
        if (
          !progress.eta ||
          progress.eta.remainingMs === null ||
          progress.eta.confidence === 'calculating' ||
          progress.eta.confidence === 'low'
        ) {
          return t('ragIndexingRunningEtaCalculatingReason', {
            phase,
            completed: String(completed),
            total: String(progress.totalFiles),
            reason: etaReason,
          });
        }
        return t('ragIndexingRunningWithEtaReason', {
          phase,
          completed: String(completed),
          total: String(progress.totalFiles),
          eta: this.formatRagEtaDuration(progress.eta.remainingMs),
          reason: etaReason,
        });
      }
      return t('ragIndexingRunning', { phase: this.formatRagIndexingPhase(status.phase) });
    }
    if (guardState?.mode === 'throttled') {
      return t('ragPerformanceThrottled');
    }
    if (status.lastResult) {
      return t('ragIndexingResult', {
        documents: status.lastResult.indexed,
        vectors: status.lastResult.vectors,
      });
    }
    return t('ragIdle');
  }

  private handleRagIndexingStatusChange(status: RagIndexingSchedulerStatus): void {
    const wasRunning = this.ragIndexingStatus?.running === true;
    this.ragIndexingStatus = status;
    if (status.running) {
      void this.recordAgentDiagnosticsBreadcrumb({
        phase: 'rag.indexing',
        action: 'mark',
        detail: 'operation',
        data: {
          phase: status.phase,
          queuedFiles: status.queuedFiles,
          currentFile: status.progress?.currentFilePath ?? null,
          completedFiles: status.progress?.completedFiles ?? null,
          totalFiles: status.progress?.totalFiles ?? null,
        },
      });
    }
    this.getLogger().debug('RAG indexing scheduler status changed.', {
      source: 'rag.indexing',
      data: {
        running: status.running,
        phase: status.phase,
        queuedFiles: status.queuedFiles,
        lastIndexed: status.lastResult?.indexed ?? null,
        lastVectors: status.lastResult?.vectors ?? null,
      },
    });
    this.refreshBus?.emit('rag', {
      status: status.running ? 'partial' : 'success',
      detail: this.formatRagIndexingStatus(status),
    });
    if (wasRunning && !status.running) {
      this.debouncedRefreshStats();
    }
  }

  private formatRagIndexingPhase(
    phase: RagIndexingSchedulerStatus['phase'],
    progress?: RagIndexingSchedulerStatus['progress'],
  ): string {
    if (phase === 'paused') return t('ragPerformancePaused');
    const phaseLabel =
      phase === 'file'
        ? t('ragPhaseFile')
        : phase === 'pending'
          ? t('ragPhasePending')
          : phase === 'all'
            ? t('ragPhaseAll')
            : t('ragPhaseIdle');
    if (!progress || progress.currentFileTotalChunks <= 0) return phaseLabel;
    return t('ragIndexingPhaseWithChunks', {
      phase: phaseLabel,
      completed: String(
        Math.min(progress.currentFileEmbeddedChunks, progress.currentFileTotalChunks),
      ),
      total: String(progress.currentFileTotalChunks),
    });
  }

  private formatRagEtaDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
      return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  private formatRagEtaConfidenceReason(reason: string | undefined): string {
    switch (reason) {
      case 'complete':
        return t('ragEtaReasonComplete');
      case 'planned-stable':
        return t('ragEtaReasonPlannedStable');
      case 'planned-variable-rate':
        return t('ragEtaReasonPlannedVariableRate');
      case 'planned-partial':
        return t('ragEtaReasonPlannedPartial');
      case 'insufficient-samples':
        return t('ragEtaReasonInsufficientSamples');
      case 'calibration-variable':
        return t('ragEtaReasonCalibrationVariable');
      case 'calibrated-estimate':
        return t('ragEtaReasonCalibratedEstimate');
      case 'batch-rate-only':
        return t('ragEtaReasonBatchRateOnly');
      case 'elapsed-rate-only':
        return t('ragEtaReasonElapsedRateOnly');
      default:
        return t('ragEtaReasonInsufficientSamples');
    }
  }

  private logAutomaticRagRecoveryEvent(event: AutomaticRagRecoveryEvent, detail?: unknown): void {
    const context = {
      source: 'rag.recovery',
      data: { event },
      ...(detail instanceof Error ? { error: detail } : {}),
    };
    if (event === 'completed') {
      this.getLogger().info('Automatic RAG coverage recovery completed.', context);
    } else if (event === 'retrying' || event === 'exhausted') {
      this.getLogger().warn('Automatic RAG coverage recovery needs another opportunity.', context);
    } else {
      this.getLogger().debug('Automatic RAG coverage recovery state changed.', context);
    }
  }

  private clearRAG(options: { dispose?: boolean } = {}): void {
    const runtime = options.dispose === false ? null : this.captureRagRuntimeSnapshot();
    this.cancelRagIndexing();
    this.unregisterRAGEvents();
    if (this.statsDebounceTimer) {
      window.clearTimeout(this.statsDebounceTimer);
      this.statsDebounceTimer = null;
    }
    this.clearAutoUpdateTimer();
    if (this.ragStatusTimer) {
      window.clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    this.documentCorpus = null;
    this.vaultDocumentCorpus = null;
    this.vectorStore = null;
    this.embeddingProvider = null;
    this.bm25Index = null;
    this.ragEngine = null;
    this.vaultIndexer = null;
    this.ragIndexingScheduler = null;
    this.automaticRagRecovery = null;
    this.ragPerformanceGuard = null;
    this.ragIndexingStatus = null;
    this.nextAutoUpdateAt = null;
    this.lastAutoUpdateSkippedReason = null;
    this.lastAutoUpdateResult = null;
    if (runtime) {
      this.disposeRagRuntimeSnapshot(runtime);
    }
  }

  private unregisterRAGEvents(): void {
    if (this.createCleanup) {
      this.createCleanup();
      this.createCleanup = null;
    }
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
    this.registerSourceFileEvents(this.ragIndexingScheduler);
  }

  private registerLexicalRAGEvents(_bm25Index: IndexedDbBM25Index | undefined): void {
    this.registerSourceFileEvents(null);
  }

  private registerSourceFileEvents(scheduler: RAGIndexingScheduler | null): void {
    this.unregisterRAGEvents();
    if (!this.vaultDocumentCorpus) return;
    const excludePaths = getEffectiveExcludePaths(
      this.settings.rag,
      this.settings.chat,
      this.app.vault.configDir,
    );
    const indexer = {
      indexFile: async (file: TFile): Promise<void> => {
        await this.indexBM25File(this.bm25Index ?? undefined, file);
        scheduler?.scheduleFile(file, 'modify');
      },
      removeByFilePath: async (path: string): Promise<number> => {
        await this.removeBM25File(this.bm25Index ?? undefined, path);
        this.debouncedRefreshStats();
        return scheduler?.deleteFile(path) ?? 0;
      },
    };
    this.modifyCleanup = registerModifyEvent(
      this.app.vault,
      indexer,
      excludePaths,
      this.settings.rag.excludeExts,
    );
    this.createCleanup = registerCreateEvent(
      this.app.vault,
      indexer,
      excludePaths,
      this.settings.rag.excludeExts,
    );
    this.deleteCleanup = registerDeleteEvent(
      this.app.vault,
      indexer,
      excludePaths,
      this.settings.rag.excludeExts,
    );
    this.renameCleanup = registerRenameEvent(
      this.app.vault,
      indexer,
      indexer,
      excludePaths,
      this.settings.rag.excludeExts,
    );
  }

  /** RAG 상태를 초기화 시 한 번 계산하고 이후 vault 이벤트로 갱신한다. */
  private setupRagStatusTimer(): void {
    if (this.ragStatusTimer) {
      window.clearInterval(this.ragStatusTimer);
      this.ragStatusTimer = null;
    }
    if (!shouldRunRagStatusBackgroundRefresh(this.settings.rag)) {
      return;
    }
    this.refreshRagStatusInBackground();
  }

  private refreshRagStatusInBackground(): void {
    void this.runRagStatusBackgroundRefresh();
  }

  private async runRagStatusBackgroundRefresh(): Promise<void> {
    if (!(await this.canRunRagBackgroundWork())) return;
    const results = await Promise.allSettled([this.computeAndEmitRagStats()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.getLogger().warn('Background RAG status refresh failed.', {
          source: 'rag.status',
          error: result.reason,
        });
      }
    }
  }

  createIndexedDbName(kind: string): string {
    const vault = this.app.vault as { getName?: () => string };
    const vaultName = vault.getName ? vault.getName() : 'default-vault';
    const pluginId = this.manifest?.id ?? 'superpower-inside';
    return `${pluginId}:${vaultName}:${kind}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  }

  setupAutoUpdate(): void {
    this.clearAutoUpdateTimer(true);
    this.nextAutoUpdateAt = null;
    if (this.settings.rag.autoUpdateEnabled && this.vaultIndexer) {
      this.nextAutoUpdateAt = Date.now() + this.settings.rag.autoUpdateIntervalMin * 60000;
      this.autoUpdateTimer = window.setInterval(() => {
        void this.autoIndex();
      }, this.settings.rag.autoUpdateIntervalMin * 60000);
      (window as AutoUpdateTimerWindow)[AUTO_UPDATE_TIMER_WINDOW_KEY] = this.autoUpdateTimer;
      this.registerInterval?.(this.autoUpdateTimer);
    }
  }

  private clearAutoUpdateTimer(reclaimOrphan = false): void {
    const timerWindow = window as AutoUpdateTimerWindow;
    const ownedTimer = typeof this.autoUpdateTimer === 'number' ? this.autoUpdateTimer : null;
    if (ownedTimer !== null) {
      window.clearInterval(ownedTimer);
      this.autoUpdateTimer = null;
    }
    const sharedTimer = timerWindow[AUTO_UPDATE_TIMER_WINDOW_KEY];
    if (sharedTimer === undefined) return;
    if (sharedTimer === ownedTimer) {
      delete timerWindow[AUTO_UPDATE_TIMER_WINDOW_KEY];
      return;
    }
    if (reclaimOrphan && ownedTimer === null) {
      window.clearInterval(sharedTimer);
      delete timerWindow[AUTO_UPDATE_TIMER_WINDOW_KEY];
    }
  }

  private async autoIndex(): Promise<void> {
    const vaultIndexer = this.vaultIndexer;
    const vectorStore = this.vectorStore;
    const scheduler = this.ragIndexingScheduler;
    const performanceGuard = this.ragPerformanceGuard;
    if (this.unloaded) {
      this.getLogger().debug('Auto RAG indexing stopped because the plugin unloaded.', {
        source: 'rag.auto',
      });
      return;
    }
    if (!vaultIndexer || !vectorStore || !scheduler) {
      this.lastAutoUpdateSkippedReason = t('ragIndexerNotInitializedBase');
      this.getLogger().warn('Auto RAG indexing skipped because runtime is not initialized.', {
        source: 'rag.auto',
      });
      return;
    }
    const stopIfRuntimeChanged = (): boolean => {
      const changed =
        this.unloaded ||
        this.vaultIndexer !== vaultIndexer ||
        this.vectorStore !== vectorStore ||
        this.ragIndexingScheduler !== scheduler ||
        this.ragPerformanceGuard !== performanceGuard;
      if (changed) {
        this.getLogger().debug('Auto RAG indexing stopped because the runtime changed.', {
          source: 'rag.auto',
        });
      }
      return changed;
    };
    this.nextAutoUpdateAt = Date.now() + this.settings.rag.autoUpdateIntervalMin * 60000;
    await performanceGuard?.measureEventLoopLag();
    if (stopIfRuntimeChanged()) return;
    if (this.isRagIndexing()) {
      this.lastAutoUpdateSkippedReason = t('ragAutoUpdateAlreadyRunning');
      this.getLogger().debug('Auto RAG indexing skipped because indexing is already running.', {
        source: 'rag.auto',
      });
      this.refreshBus?.emit('rag', { status: 'partial', detail: t('ragIndexingInProgress') });
      return;
    }
    const guardState = performanceGuard?.getState() ?? null;
    if (guardState?.mode === 'paused' && (guardState.remainingPauseMs ?? 0) > 0) {
      this.lastAutoUpdateSkippedReason = t('ragAutoUpdatePausedRetry', {
        seconds: Math.ceil((guardState.remainingPauseMs ?? 0) / 1000),
      });
      this.getLogger().warn('Auto RAG indexing skipped because performance guard is paused.', {
        source: 'rag.auto',
        data: { remainingPauseMs: guardState.remainingPauseMs },
      });
      this.refreshBus?.emit('rag', { status: 'partial', detail: t('ragPerformancePaused') });
      return;
    }
    try {
      const status = await calculateRagStatus(
        this.app.vault,
        vectorStore,
        this.settings.rag,
        this.settings.chat,
      );
      if (stopIfRuntimeChanged()) return;
      if (status.updateRequiredDocuments.length === 0) {
        this.lastAutoUpdateSkippedReason = t('ragAutoUpdateNoTargets');
        this.getLogger().debug('Auto RAG indexing skipped because no documents need updates.', {
          source: 'rag.auto',
        });
        this.refreshBus?.emit('rag', { status: 'success', detail: t('ragAutoUpdateNoTargets') });
        return;
      }
      this.getLogger().info('Auto RAG indexing started.', {
        source: 'rag.auto',
        data: { updateRequired: status.updateRequiredDocuments.length },
      });
      new Notice(t('autoUpdateIndexingStarted'));
      const result = await scheduler.indexPending();
      if (stopIfRuntimeChanged()) return;
      this.lastAutoUpdateResult = result;
      this.lastAutoUpdateSkippedReason = null;
      this.getLogger().notice('Auto RAG indexing completed.', {
        source: 'rag.auto',
        data: { indexed: result.indexed, vectors: result.vectors, skipped: result.skipped },
      });
      if (result.indexed > 0) {
        new Notice(`${result.indexed}${t('autoUpdateIndexingDone')}`);
      }
      void this.computeAndEmitRagStats();
    } catch (err) {
      if (stopIfRuntimeChanged()) return;
      if (isIndexingCancelledError(err)) {
        const pausedState = performanceGuard?.getState() ?? null;
        if (pausedState?.mode === 'paused') {
          this.lastAutoUpdateSkippedReason = t('ragAutoUpdatePausedRetry', {
            seconds: Math.ceil((pausedState.remainingPauseMs ?? 0) / 1000),
          });
          this.refreshBus?.emit('rag', { status: 'partial', detail: t('ragPerformancePaused') });
          this.getLogger().warn('Auto RAG indexing paused by performance guard.', {
            source: 'rag.auto',
            data: { remainingPauseMs: pausedState.remainingPauseMs },
          });
          return;
        }
        this.lastAutoUpdateSkippedReason = t('indexingCancelled');
        this.getLogger().warn('Auto RAG indexing cancelled.', { source: 'rag.auto' });
        new Notice(t('indexingCancelled'));
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.lastAutoUpdateSkippedReason = msg;
      this.getLogger().error('Auto RAG indexing failed.', { source: 'rag.auto', error: err });
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
    const startedAt = Date.now();
    this.clearMcpRetryTimers();
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'mcp.connections',
      action: 'enter',
      detail: 'run-start',
      data: {
        runId,
        retryFailed: options.retryFailed,
        serverCount: this.settings.mcpServers.length,
      },
    });
    this.getLogger().info('MCP connection run started.', {
      source: 'mcp',
      data: {
        runId,
        retryFailed: options.retryFailed,
        serverCount: this.settings.mcpServers.length,
      },
    });

    if (this.mcpRegistry) {
      try {
        await this.mcpRegistry.disconnectAll();
      } catch (err) {
        this.getLogger().warn('Previous MCP connections did not disconnect cleanly.', {
          source: 'mcp',
          error: err,
        });
      }
    }
    this.mcpRegistry = new MCPRegistry(this.settings.mcpServers);
    this.setMcpConnectionState('connecting', []);

    if (!isMcpStdioAvailable(Platform)) {
      const enabledServers = this.mcpRegistry.getEnabledServers();
      const desktopOnlyMessage = getMcpDesktopOnlyMessage();
      const errors = enabledServers.map((server) => `${server.name}: ${desktopOnlyMessage}`);
      for (const server of enabledServers) {
        this.mcpRegistry.setConnectionStatus(server.name, 'error', desktopOnlyMessage);
      }
      this.refreshMcpConnectionState();
      this.getLogger().error('MCP stdio is not available on this platform.', {
        source: 'mcp',
        data: { serverCount: enabledServers.length },
      });
      await this.recordAgentDiagnosticsBreadcrumb({
        phase: 'mcp.connections',
        action: 'error',
        detail: 'run-start',
        data: {
          runId,
          durationMs: Date.now() - startedAt,
          errorCount: errors.length,
          reason: desktopOnlyMessage,
        },
      });
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

        this.getLogger().warn('Retrying failed MCP connections.', {
          source: 'mcp',
          data: { delayMs, failedServers: failedServers.map((server) => server.name) },
        });
        this.setMcpConnectionState('connecting', errors);
        errors = await this.connectMcpServers(failedServers, runId);
      }
    }

    this.refreshMcpConnectionState();
    this.getLogger().notice('MCP connection run completed.', {
      source: 'mcp',
      data: { runId, errorCount: errors.length },
    });
    await this.recordAgentDiagnosticsBreadcrumb({
      phase: 'mcp.connections',
      action: errors.length > 0 ? 'error' : 'leave',
      detail: 'run-start',
      data: {
        runId,
        durationMs: Date.now() - startedAt,
        errorCount: errors.length,
      },
    });
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
        this.getLogger().info('MCP server connected.', {
          source: 'mcp',
          data: { server: server.name, command: server.command },
        });
      } catch (err) {
        let msg = err instanceof Error ? err.message : String(err);
        if (shouldAppendMcpPathHint(server.command, msg)) {
          msg = `${msg}\n${t('mcpPathCommandNotFoundHint').replace('{command}', server.command)}`;
        }
        if (runId !== this.mcpConnectionRunId) return;
        registry.setConnectionStatus(server.name, 'error', msg);
        this.getLogger().error('MCP server connection failed.', {
          source: 'mcp',
          data: { server: server.name, command: server.command },
          error: err,
        });
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
      const timer = window.setTimeout(() => {
        this.mcpRetryTimers.delete(timer);
        resolve(runId === this.mcpConnectionRunId);
      }, delayMs);
      this.mcpRetryTimers.set(timer, () => {
        window.clearTimeout(timer);
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

  private isRootWorkspaceLeaf(leaf: WorkspaceLeaf): boolean {
    return leaf.getRoot() === this.app.workspace.rootSplit;
  }

  private isReadableAgentDiagnosticsLeaf(leaf: WorkspaceLeaf): boolean {
    const width = leaf.view.containerEl.getBoundingClientRect().width;
    return width === 0 || width >= AGENT_DIAGNOSTICS_MIN_READABLE_WIDTH;
  }

  private createRootWorkspaceTabLeaf(): WorkspaceLeaf {
    const rootLeaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    if (rootLeaf) {
      this.app.workspace.setActiveLeaf(rootLeaf, { focus: false });
    }
    const leaf = this.app.workspace.getLeaf('tab');
    if (this.isRootWorkspaceLeaf(leaf)) {
      return leaf;
    }
    leaf.detach();
    if (rootLeaf) {
      return this.app.workspace.createLeafBySplit(rootLeaf, 'vertical');
    }
    return this.app.workspace.getLeaf(true);
  }

  openAgentDiagnosticsView(): void {
    const existingLeaves = this.app.workspace.getLeavesOfType(AGENT_DIAGNOSTICS_VIEW_TYPE);
    const readableRootLeaf = existingLeaves.find(
      (leaf) => this.isRootWorkspaceLeaf(leaf) && this.isReadableAgentDiagnosticsLeaf(leaf),
    );
    if (readableRootLeaf) {
      void this.app.workspace.revealLeaf(readableRootLeaf);
      return;
    }

    for (const leaf of existingLeaves) {
      leaf.detach();
    }

    const leaf = this.createRootWorkspaceTabLeaf();
    void leaf.setViewState({ type: AGENT_DIAGNOSTICS_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }
}
