import { RagRuntimeWorkTracker, type RagRuntimeWorkProgress } from './src/rag/runtime-work-progress';
import Dexie from 'dexie';
import { migrateStoredMcpServersRust, normalizeQuotaIntervalSecondsRust } from './src/rag/rust-core';
import { ProviderQuotaService } from './src/llm/provider-quota-service';
import {
  getLanguage as getObsidianLanguage,
  Plugin,
  Notice,
  Platform,
  TFile,
  type TAbstractFile,
} from 'obsidian';
import {
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  getRagIndexingManifest,
  getRagPreparedContentVerdict,
  getRagPreparedSourceRevision,
  isRagFileMetadataExcluded,
  disposeRagFileEligibilityCache,
} from './src/utils/vault';
import {
  configureSourceAssets,
  disposeSourceAssets,
  SourceReadError,
} from './src/rag/source-access';
import {
  TOGGLE_DOCUMENT_EXCLUSION_COMMAND_ID,
  toggleDocumentExclusion,
} from './src/utils/document-exclusion';
import {
  type SuperpowerInsideSettings,
  DEFAULT_SETTINGS,
  isCustomOpenAIEmbeddingProviderKey,
  migrateLegacyProviderProfiles,
  normalizeChatDebugTraceSettings,
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
import {
  chatGPTOAuth,
  initializeChatGPTOAuth,
  migrateChatGPTCredentials,
} from './src/llm/chatgpt-oauth';
import {
  googleGeminiOAuth,
  initializeGoogleGeminiOAuth,
} from './src/llm/google-gemini-oauth';
import {
  hydrateProviderApiKeys,
  migrateProviderKeysToKeychain,
  neutralizeProviderSecrets,
  persistProviderApiKeys,
  readSecretStorage,
  settingsForPersistence,
} from './src/secrets/provider-secrets';
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
  FileIndexRepairRequiredError,
  type VectorStore,
} from './src/rag/store';
import {
  getLocalEmbeddingModels,
  type LocalEmbeddingModelId,
} from './src/llm/local-embedding-models';
import {
  getBM25DocumentFields,
  IndexedDbBM25Index,
} from './src/rag/bm25';
import { IndexedDbDocumentCorpusStore } from './src/rag/document-corpus-store';
import { VaultDocumentCorpus } from './src/rag/vault-document-corpus';
import { readSourceFileSnapshot } from './src/rag/source-snapshot';
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
  IndexingCancelledError,
  type IndexingResult,
} from './src/rag/indexer';
import { calculateRagStatus, type RagStatusSummary } from './src/rag/status';
import {
  formatRagEtaDuration,
  summarizeRagActivity,
  type RagIndexingProgressSummary,
} from './src/rag/indexing-progress';
import type { SearchStatusSnapshot } from './src/rag/search-status';
import { TOKENIZER_VERSION } from './src/rag/tokenizer-version';
import { acquireRuntimeLease, retireRuntime, leaseRagQueryEngine, trackRagProviderOperations, RagGenerationManifest, RagRuntimeWorkBarrier, sameRagDurabilitySeal, type RagDurabilitySeal, type RagGenerationRecord, type RagGenerationProof, type RagGenerationSnapshot } from './src/rag/runtime-generation';
import { RAGQueryEngine } from './src/rag/query';
import { LiteralInventoryError, type LiteralInventorySource } from './src/rag/literal-inventory';
import { PerformanceGuard, type PerformanceGuardState } from './src/rag/performance-guard';
import {
  RAGIndexingScheduler,
  type RagIndexingSchedulerStatus,
} from './src/rag/indexing-scheduler';
import { shouldRunRagStatusBackgroundRefresh } from './src/rag/background-status';
import type { StructuralMetadataContext } from './src/rag/retrieval-pipeline';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { SEARCH_VIEW_TYPE, SearchView } from './src/search/view';
import { createPluginSearchPort } from './src/search/indexed-search-deps';
import {
  createPendingWriteRecoveryHost,
  recoverPendingFileWrites,
} from './src/rag/pending-write-recovery';
import type { SearchPort } from './src/search/engine-port';
import { normalizePromptLibrary } from './src/chat/prompt-library';
import {
  resolveChatRetrievalReadiness,
  type ChatKeywordIndexState,
  type ChatRetrievalReadiness,
} from './src/chat/chat-readiness';
import { MCPRegistry } from './src/mcp/registry';
import {
  MCP_STATUS_CHANGE_EVENT,
  getMcpConnectionState,
  type MCPConnectionState,
} from './src/mcp/connection-state';
import { shouldAppendMcpPathHint } from './src/mcp/errors';
import { getMcpDesktopOnlyMessage, isMcpStdioAvailable } from './src/mcp/platform';
import { isLocalizedValue, resolveUiLanguage, setLanguage, t } from './src/i18n';
import { PluginUpdateChecker, UPDATE_CHECK_INTERVAL_MS } from './src/plugin-update';
import { RefreshBus } from './src/utils/refresh-bus';
import {
  loadLocalSettings,
  resolveSettingsLoadData,
  saveLocalSettings,
} from './src/settings-storage';
import { appLogger, normalizeLoggerConfig, type AppLogger } from './src/utils/logger';
import { CoalescedAsyncRunner } from './src/utils/coalesced-async-runner';
import {
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
import {
  RETIRED_PLUGIN_FILE_NAMES,
  RetiredArtifactService,
  createRetiredArtifactHost,
} from './src/storage/retired-artifacts';
import {
  GENERATED_ARTIFACT_FEATURES,
  GeneratedArtifactRegistry,
} from './src/storage/generated-artifacts';
import { buildPluginIndexedDbNames, resetPluginOwnedData } from './src/utils/plugin-data-reset';
import { maintainPluginOwnedFiles } from './src/utils/plugin-file-maintenance';

const MCP_AUTO_RETRY_DELAYS_MS = [2000, 5000] as const;
const RAG_RUNTIME_INIT_STEP_TIMEOUT_MS = 30_000;
/** 죽은 BM25 작업자를 다시 띄우는 최대 시도 횟수입니다. */
const MAX_BM25_RECOVERY_ATTEMPTS = 2;
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


interface RagAutoIndexTick {
  beforeWrite?: () => () => void;
  repairNeedsCheckpoint?: boolean;
}

interface RagRuntimeSnapshot {
  io?: RagRuntimeWorkBarrier;
  sourcePolicyIdentity?: string;
  pendingRecoverySourceEvents?: Set<string>;
  disposeSourceObserver?: () => void;
  localEmbeddingModelId?: LocalEmbeddingModelId;
  retireProvider?: (close: () => void, failed?: () => void) => void;
  clearEmbeddingCache?: () => Promise<void>;
  coverageLimited?: boolean;
  admitsEmbedding?: () => boolean;
  config?: Pick<SuperpowerInsideSettings, 'rag' | 'chat'>;
  generation?: RagGenerationRecord;
  lexicalBuildResult?: IndexingResult;
  databaseNames?: readonly string[];
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
  private ragGenerationManifest: RagGenerationManifest | null = null;
  private ragResetInProgress = false;
  private ragRuntimeDisposals?: WeakMap<object, Promise<void>>;
  private pendingRagRuntimeDisposals?: Set<Promise<void>>;
  private ragRuntimeDisposalModels?: WeakMap<Promise<void>, LocalEmbeddingModelId>;
  private ragCheckpointRuns?: WeakMap<RagRuntimeWorkBarrier, Promise<boolean>>;
  private ragCheckpointRequests?: WeakMap<RagRuntimeWorkBarrier, number>;
  private ragFileIndexRepairs?: WeakMap<RagRuntimeWorkBarrier, Promise<void>>;
  private ragAutoIndexTicks?: WeakMap<RAGIndexingScheduler, RagAutoIndexTick>;
  private ragVerifiedProofs?: WeakMap<RagRuntimeWorkBarrier, { proof: RagGenerationProof; manifestProof: RagGenerationProof; isCurrent: (runtime: RagRuntimeSnapshot) => boolean }>;
  private deletingLocalModels?: Set<string>;
  private ragManifestRestored = false;
  private ragGenerationRestorePromise: Promise<void> | null = null;
  private ragManifestRevision = 0;
  private ragGenerationRestoring = false;
  private ragRestoreOwner: object | null = null;
  private ragRestoreFailure: RagGenerationSnapshot['restoreFailure'] = null;
  private ragRuntimeWork: { owner: object; runId: number; tracker: RagRuntimeWorkTracker; modelResume?: RagRuntimeWorkProgress | null } | null = null;
  private ragRuntimeWorkPulse: number | null = null;
  private restoringRagRuntime: RagRuntimeSnapshot | null = null;

  private beginRagRuntimeWork(owner: object): void {
    this.endRagRuntimeWork();
    this.ragRuntimeWork = { owner, runId: this.ragRuntimeInitRunId, tracker: new RagRuntimeWorkTracker() };
    this.observeRagRuntimeWork(owner, 'opening-storage');
    this.ragRuntimeWorkPulse = window.setInterval(() => {
      if (this.unloaded || this.ragRuntimeWork?.runId !== this.ragRuntimeInitRunId) this.endRagRuntimeWork();
      else this.refreshBus?.emit('rag', { status: 'partial' });
    }, 1000);
  }

  private observeRagRuntimeWork(owner: object, stage: RagRuntimeWorkProgress['stage'], unit: RagRuntimeWorkProgress['unit'] = 'steps', processed: number | null = null, total: number | null = null): void {
    const work = this.ragRuntimeWork;
    if (!work || this.unloaded || work.runId !== this.ragRuntimeInitRunId || (work.owner !== owner && owner !== this.restoringRagRuntime)) return;
    if (stage === 'loading-model' && processed === 0) {
      const previous = work.tracker.snapshot();
      if (previous?.stage !== 'loading-model') work.modelResume = previous;
    }
    const resume = stage === 'loading-model' && total !== null && processed === total ? work.modelResume : null;
    if (resume) {
      work.modelResume = null;
      work.tracker.observe(resume.stage, resume.unit, resume.processedUnits, resume.totalUnits);
    } else {
      work.tracker.observe(stage, unit, processed, total);
    }
    this.refreshBus?.emit('rag', { status: 'partial' });
  }

  private settleRagRuntimeWork(owner: object): void {
    if (this.ragRuntimeWork?.owner !== owner) return;
    const work = this.ragRuntimeWork;
    const pending = [...(this.pendingRagRuntimeDisposals ?? [])];
    if (pending.length === 0) { this.endRagRuntimeWork(owner); return; }
    this.observeRagRuntimeWork(owner, 'cleanup');
    // 표시만 실제 기존 drain에 연결하며 취소나 자원 반환 순서를 바꾸지 않습니다.
    void Promise.allSettled(pending).then(() => { if (this.ragRuntimeWork === work) this.endRagRuntimeWork(owner); });
  }

  private endRagRuntimeWork(owner?: object): void {
    if (owner && this.ragRuntimeWork?.owner !== owner) return;
    this.ragRuntimeWork?.tracker.clear();
    this.ragRuntimeWork = null;
    if (this.ragRuntimeWorkPulse !== null) window.clearInterval(this.ragRuntimeWorkPulse);
    this.ragRuntimeWorkPulse = null;
    this.refreshBus?.emit('rag', { status: 'partial' });
  }
  private lastBuildingGeneration: RagGenerationRecord | null = null;
  private lastBuildingGenerationSource: 'live' | 'saved' = 'saved';
  private forceRagGenerationBuild = false;
  private embeddingBindings = new Map<string, readonly unknown[]>();
  private activeRagRuntime: RagRuntimeSnapshot | null = null;
  private buildingRagRuntime: RagRuntimeSnapshot | null = null;
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
  /** 사용자가 색인을 중단한 동안에는 런타임 재초기화 뒤에도 자동 복구를 다시 시작하지 않습니다. */
  private ragAutoRecoveryPausedByUser = false;
  private ragPerformanceGuard: PerformanceGuard | null = null;
  ragIndexingStatus: RagIndexingSchedulerStatus | null = null;
  private bm25RecoveryAttempts = 0;
  private bm25RecoveryInFlight = false;
  private bm25RecoveryExhausted = false;
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
  private metadataCleanup: (() => void) | null = null;
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
  updateChecker: PluginUpdateChecker | null = null;
  providerQuota: ProviderQuotaService | null = null;

  async onload(): Promise<void> {
    this.unloaded = false;
    configureSourceAssets(
      this.manifest?.id ?? 'superpower-inside',
      this.getVaultStorageIdentity(),
      this.generatedArtifacts.forFeature('pdf-sources'),
    );
    this.getLogger().info('Plugin loading started.', { source: 'lifecycle' });
    const chatGPTAuth = initializeChatGPTOAuth(this.app, this.getLogger(), this.manifest.version);
    this.register(() => chatGPTAuth.dispose());
    const geminiAuth = initializeGoogleGeminiOAuth(this.app, this.getLogger());
    this.register(() => geminiAuth.dispose());
    await this.loadSettings();
    await this.runStartupPluginFileMaintenance();
    this.initProvider();
    this.startProviderQuota();

    // 채팅 뷰 등록
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.registerView(SEARCH_VIEW_TYPE, (leaf) => new SearchView(leaf, this));
    this.addRibbonIcon('message-circle', t('cmdOpenAiChat'), () => {
      void this.openChatView();
    });

    // 명령어
    this.addCommand({
      id: TOGGLE_DOCUMENT_EXCLUSION_COMMAND_ID,
      name: t('cmdToggleDocumentExclusion'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) {
          void toggleDocumentExclusion(this.app, file)
            .then(async (excluded) => {
              new Notice(
                t(excluded ? 'documentExclusionEnabled' : 'documentExclusionDisabled', {
                  path: file.path,
                }),
              );
              if (excluded) {
                try {
                  const runtime = this.captureRagRuntimeSnapshot();
                  const removing = async (): Promise<void> => { await runtime.vaultIndexer?.removeFile(file.path); };
                  await (runtime.io ? runtime.io.run(removing) : removing());
                  void this.refreshRagRuntimeCheckpoint(runtime);
                } catch (error) {
                  this.getLogger().warn('Excluded document index cleanup failed.', {
                    source: 'vault.exclusion',
                    error,
                  });
                }
              }
              this.refreshBus.emit('rag', { status: 'success' });
              this.refreshBus.emit('exclude-counts', { status: 'success' });
            })
            .catch((error: unknown) => {
              this.getLogger().error('Document exclusion toggle failed.', {
                source: 'vault.exclusion',
                error,
              });
              new Notice(t('documentExclusionFailed'));
            });
        }
        return true;
      },
    });
    this.addCommand({
      id: 'open-ai-chat',
      name: t('cmdOpenAiChat'),
      callback: () => this.openChatView(),
    });

    this.addCommand({
      id: 'open-vault-search',
      name: t('cmdOpenSearchView'),
      callback: () => this.openSearchView(),
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
        this.resumeRagAutoRecovery();
        const scheduler = this.ragIndexingScheduler;
        const signal = scheduler?.beginPreparation();
        try {
          const status = this.vectorStore
            ? await calculateRagStatus(
                this.app.vault,
                this.vectorStore,
                this.settings.rag,
                this.settings.chat,
                signal,
              )
            : null;
          signal?.throwIfAborted();
          if (this.ragIndexingScheduler !== scheduler) return;
          if (!status || status.totalDocuments === 0) return;
          this.getLogger().info('Manual RAG reindex started.', {
            source: 'rag',
            data: { totalDocuments: status.totalDocuments },
          });
          new Notice(t('vaultIndexingStarted'));
          const result = await scheduler?.reindexAll();
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
        } finally {
          scheduler?.endPreparation(signal);
        }
      },
    });

    // 설정 탭
    const settingsTab = new SuperpowerInsideSettingTab(this.app, this);
    this.addSettingTab(settingsTab);
    this.startPluginUpdateCheck(settingsTab);
    this.startDeferredStartupTasks();
    this.getLogger().info('Plugin loaded.', { source: 'lifecycle' });
  }

  onunload(): void {
    this.unloaded = true;
    this.endRagRuntimeWork();
    this.ragRuntimeInitRunId =
      (Number.isSafeInteger(this.ragRuntimeInitRunId) ? this.ragRuntimeInitRunId : 0) + 1;
    this.getLogger().info('Plugin unloading.', { source: 'lifecycle' });
    this.cancelRagIndexing();
    disposeSourceAssets();
    disposeRagFileEligibilityCache(this.app.vault);
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
    this.updateChecker?.dispose();
    this.updateChecker = null;
    this.providerQuota?.dispose();
    this.providerQuota = null;
    this.clearMcpRetryTimers();
    this.clearRAG();
    const closeManifest = () => this.ragGenerationManifest?.close();
    if (this.ragRuntimeInitRunner?.isRunning()) {
      void this.ragRuntimeInitRunner.run().catch((error: unknown) => {
        this.getLogger().debug('RAG building stopped during unload.', { source: 'rag.generation', error });
      }).finally(closeManifest);
    } else closeManifest();
    this.refreshBus.destroy();
    this.getLogger().info('Plugin unloaded.', { source: 'lifecycle' });
  }

  private startProviderQuota(): void {
    const providerQuota = new ProviderQuotaService({
      getProfiles: () => this.settings.providerProfiles,
      getIntervalSeconds: () => this.settings.quotaCheckIntervalSeconds,
      onChange: (profileId) => {
        const state = this.providerQuota?.get(profileId);
        this.refreshBus.emit('quota', {
          status: state?.status === 'unavailable' ? 'error' : state?.status === 'loading' ? 'partial' : 'success',
          detail: profileId,
        });
      },
      logger: this.getLogger(),
    });
    this.providerQuota = providerQuota;
    this.register(() => providerQuota.dispose());
    providerQuota.start();
  }

  /**
   * 릴리스 확인을 시작합니다. 시작할 때 한 번 조회하고, 이후 하루 간격으로만 다시 확인합니다.
   * 확인기는 하루가 지나기 전의 호출을 건너뛰므로 타이머는 실제 조회를 만들지 않습니다.
   */
  private startPluginUpdateCheck(settingsTab: SuperpowerInsideSettingTab): void {
    this.updateChecker = new PluginUpdateChecker(
      this.app,
      this.manifest.version,
      this.getLogger(),
      () => settingsTab.refreshUpdateNotice(),
    );
    this.registerInterval(
      window.setInterval(() => {
        void this.updateChecker?.check();
      }, UPDATE_CHECK_INTERVAL_MS),
    );
    void this.updateChecker.check();
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
    if (this.buildingRagRuntime && !this.ragAutoRecoveryPausedByUser) return true;
    return (
      this.ragIndexAbortController !== null || (this.ragIndexingScheduler?.isRunning() ?? false)
    );
  }

  /** 검색에 사용할 색인·corpus·통계가 같은 세대에서 준비됐는지 확인합니다. */
  isRagSearching(): boolean {
    if (this.activeRagRuntime?.ragEngine) return false;
    const status = this.eventDrivenRagStats;
    return (
      this.isRagIndexing() ||
      this.vaultDocumentCorpus?.isBusy() === true ||
      status === null ||
      status.updateRequiredDocuments.length > 0
    );
  }

  /** 검색 포트와 공유하는 동기 readiness 별칭입니다. */
  isIndexing(): boolean {
    return this.isRagSearching();
  }

  /** serving을 유지하면서 building의 준비·마무리·중단도 같은 요약에 게시합니다. */
  getRagIndexingProgressSummary(generation = this.getRagGenerationSnapshot()): RagIndexingProgressSummary | null {
    return summarizeRagActivity({
      status: this.ragIndexingStatus,
      lastInitError: this.lastRagRuntimeInitError,
      lastInitStage: this.lastRagRuntimeInitStage,
      keywordRestore: (this.buildingRagRuntime ? this.buildingRagRuntime.bm25Index : this.bm25Index)?.restoreProgress ?? null,
      generation,
      pausedByUser: this.ragAutoRecoveryPausedByUser,
      work: !this.unloaded && this.ragRuntimeWork && this.ragRuntimeWork.runId === this.ragRuntimeInitRunId ? this.ragRuntimeWork.tracker.snapshot() : null,
    });
  }

  /** 채팅 입력부에 보여 줄 검색 준비 상태입니다. 준비되지 않아도 질문은 보낼 수 있습니다. */
  getRetrievalReadiness(): ChatRetrievalReadiness {
    if (this.ragResetInProgress) return 'preparing';
    if (this.activeRagRuntime?.generation && this.ragEngine) return 'ready';
    const keywordIndex = this.getKeywordIndexState();
    const vectorReady = this.ragEngine?.getCandidateReadiness?.() === 'ready';
    return resolveChatRetrievalReadiness({
      initializing: this.ragEngine === null,
      failed: Boolean(this.lastRagRuntimeInitError || this.lastRagRuntimeInitSkippedReason),
      keywordIndex,
      indexing: this.isRagSearching(),
      searchBackendReady: keywordIndex === 'ready' || vectorReady,
    });
  }

  /** 화면들이 같은 순간의 준비 상태와 색인 숫자를 함께 읽도록 모아 줍니다. */
  getSearchStatusSnapshot(): SearchStatusSnapshot & { generation: RagGenerationSnapshot } {
    const generation = this.getRagGenerationSnapshot();
    return {
      generation,
      readiness: this.getRetrievalReadiness(),
      keywordIndex: this.getKeywordIndexState(),
      ragStatus: this.getRagRuntimeState().ragStatus,
      indexing: this.getRagIndexingProgressSummary(generation),
    };
  }

  private getKeywordIndexState(): ChatKeywordIndexState {
    if (!this.settings.rag.enableBM25) return 'disabled';
    if (this.bm25Index) {
      if (this.bm25Index.isReady) return 'ready';
      // 작업자가 죽은 채로 끝난 상태는 계속 '준비 중'으로 두지 않고 복구를 시도합니다.
      if (!this.bm25Index.hasFailure) return 'loading';
      this.scheduleBm25WorkerRecovery();
      return this.bm25RecoveryExhausted ? 'unavailable' : 'loading';
    }
    if (
      this.lastRagRuntimeInitFinishedAt === null ||
      (this.ragRuntimeInitRunner?.isRunning() ?? false)
    ) {
      return 'loading';
    }
    return 'unavailable';
  }

  /** 죽은 BM25 작업자를 백그라운드에서 다시 띄웁니다. 두 번 실패하면 한계로 보고합니다. */
  private scheduleBm25WorkerRecovery(): void {
    if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser || !this.bm25Index || this.bm25RecoveryInFlight || this.bm25RecoveryExhausted) return;
    if (this.bm25RecoveryAttempts >= MAX_BM25_RECOVERY_ATTEMPTS) {
      this.bm25RecoveryExhausted = true;
      return;
    }
    const runtime = this.captureRagRuntimeSnapshot();
    if (!runtime.io!.captureReadSnapshot()()) return;
    this.bm25RecoveryAttempts += 1;
    this.bm25RecoveryInFlight = true;
    const index = this.bm25Index;
    const isCurrent = (): boolean => !this.unloaded && !this.ragResetInProgress && !this.ragAutoRecoveryPausedByUser && this.bm25Index === index && this.ragEngine === runtime.ragEngine && runtime.io!.captureReadSnapshot()();
    const release = this.ragEngine ? acquireRuntimeLease(this.ragEngine) : () => undefined;
    void runtime.io!.run(() => {
      if (!isCurrent()) throw new IndexingCancelledError();
      return index.recoverClosedWorker();
    })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        this.getLogger().error('BM25 worker recovery failed.', {
          source: 'rag.bm25',
          error,
        });
        if (this.bm25RecoveryAttempts >= MAX_BM25_RECOVERY_ATTEMPTS) {
          this.bm25RecoveryExhausted = true;
        }
      })
      .finally(() => {
        release();
        if (this.bm25Index !== index || this.ragEngine !== runtime.ragEngine) return;
        this.bm25RecoveryInFlight = false;
        if (!isCurrent()) return;
        if (index.isReady) {
          this.bm25RecoveryAttempts = 0;
          this.refreshBus?.emit('rag', { status: 'success' });
        }
      });
  }

  cancelRagIndexing(options: { byUser?: boolean } = {}): void {
    this.endRagRuntimeWork();
    if (options.byUser === true) {
      this.ragAutoRecoveryPausedByUser = true;
      this.activeRagRuntime?.vaultDocumentCorpus?.suspend();
    }
    this.automaticRagRecovery?.suspend();
    this.ragIndexAbortController?.abort();
    this.ragIndexingScheduler?.cancel();
    this.buildingRagRuntime?.automaticRagRecovery?.suspend();
    this.buildingRagRuntime?.ragIndexingScheduler?.cancel();
    this.buildingRagRuntime?.vaultDocumentCorpus?.suspend();
    if (options.byUser === true) this.persistRagPause(true);
  }

  private persistRagPause(paused: boolean): void {
    const manifest = this.ragGenerationManifest;
    if (!manifest) return;
    void manifest.read().then(async (state) => {
      if (this.ragAutoRecoveryPausedByUser !== paused) return;
      const revision = await manifest.setPaused(state.revision, paused);
      if (revision !== null) this.ragManifestRevision = revision;
    }).catch((error: unknown) => {
      this.getLogger().warn('RAG pause persistence failed.', { source: 'rag.generation', error });
    });
  }

  /** 명시적 재색인·재개에서만 사용자 중단으로 멈춘 자동 복구를 다시 시작합니다. */
  resumeRagAutoRecovery(): void {
    if (this.unloaded || this.ragResetInProgress) return;
    this.ragAutoRecoveryPausedByUser = false;
    this.activeRagRuntime?.vaultDocumentCorpus?.resume();
    this.persistRagPause(false);
    this.automaticRagRecovery?.resume();
  }

  /** 사용자 중단 상태를 유지한 채 새 런타임의 자동 복구를 시작할지 결정합니다. */
  private async startAutomaticRagRecovery(): Promise<void> {
    if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser) {
      this.automaticRagRecovery?.suspend();
      return;
    }
    await this.automaticRagRecovery?.start();
  }

  async deleteLocalEmbeddingModel(modelId: LocalEmbeddingModelId): Promise<void> {
    const deleting = this.deletingLocalModels ??= new Set<string>();
    if (this.unloaded || this.ragResetInProgress || deleting.has(modelId)) throw new Error('rag-model-delete-blocked');
    deleting.add(modelId);
    try {
      const building = this.buildingRagRuntime?.localEmbeddingModelId === modelId ? this.buildingRagRuntime : null;
      if (building) {
        this.ragRuntimeInitRunId = (this.ragRuntimeInitRunId ?? 0) + 1;
        building.ragIndexingScheduler?.cancel();
        building.vaultDocumentCorpus?.suspend();
        if (this.ragRuntimeInitRunner?.isRunning()) {
          // 구축 결과와 실제 owner 종료 증명은 별도로 확인합니다.
          await this.ragRuntimeInitRunner.run().catch(() => undefined);
        }
        if (this.buildingRagRuntime === building) this.buildingRagRuntime = null;
      }
      const active = this.activeRagRuntime?.localEmbeddingModelId === modelId ? this.captureRagRuntimeSnapshot() : null;
      if (active) {
        this.clearRAG({ dispose: false, cancelBuilding: false });
        if (!this.ragRuntimeInitRunner?.isRunning()) this.ragManifestRestored = false;
      }
      const drains = [active, building].filter((runtime): runtime is RagRuntimeSnapshot => runtime !== null)
        .map((runtime) => this.drainRagRuntimeSnapshot(runtime));
      const retired = [...(this.pendingRagRuntimeDisposals ?? [])]
        .filter((promise) => this.ragRuntimeDisposalModels?.get(promise) === modelId);
      await Promise.all([...drains, ...retired]);
      if (this.unloaded || this.ragResetInProgress) throw new Error('rag-model-delete-cancelled');
      await getLocalEmbeddingModels({
        app: this.app,
        pluginId: this.manifest.id,
        pluginVersion: this.manifest.version,
      }).remove(modelId);
      this.refreshBus?.emit('rag', {
        status: 'success',
        detail: t('localModelDeleteDone', { model: modelId }),
      });
    } finally { deleting.delete(modelId); }
  }

  private isSelectedLocalModelDeleting(): boolean {
    const selected = resolveProviderModelRef(this.settings, this.settings.rag.embeddingModelRef ?? '', 'embedding');
    return selected?.profile.strategy === 'ternlight' && this.deletingLocalModels?.has(selected.modelId) === true;
  }

  getRagPerformanceGuardState(): PerformanceGuardState | null {
    return this.ragPerformanceGuard?.getState() ?? null;
  }




  private getPluginDirectoryPath(): string {
    return `${this.app.vault.configDir}/plugins/${this.manifest?.id ?? 'superpower-inside'}`;
  }

  private retiredArtifactService: RetiredArtifactService | null = null;
  private generatedArtifactRegistry: GeneratedArtifactRegistry | null = null;
  private activeArtifactDatabaseNames: Set<string> | null = null;

  private get generatedArtifacts(): GeneratedArtifactRegistry {
    return (this.generatedArtifactRegistry ??= new GeneratedArtifactRegistry(
      this.app,
      this.manifest?.id ?? 'superpower-inside',
      ['.superpower-inside', this.getPluginDirectoryPath()],
    ));
  }

  get retiredArtifacts(): RetiredArtifactService {
    return (this.retiredArtifactService ??= new RetiredArtifactService(
      createRetiredArtifactHost(this.app.vault.adapter, async () => {
        const runRevision = this.ragRuntimeInitRunId;
        const manifest = this.getRagGenerationManifest();
        const persisted = await manifest.read();
        const revision = persisted.revision;
        const layout = createRagStorageLayout({
          pluginId: this.manifest.id,
          vaultIdentity: this.getVaultStorageIdentity(),
          legacyVaultName: this.getVaultName(),
          embeddingNamespace: 'artifact-inspection',
          indexNamespace: 'artifact-inspection',
        });
        const [recovery, maintenance] = await Promise.all([
          this.vectorStore?.getMetaValue?.<string>(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY),
          this.vectorStore?.getMetaValue?.<string>(RAG_STORAGE_MAINTENANCE_COMPLETION_KEY),
        ]);
        if (runRevision !== this.ragRuntimeInitRunId || this.unloaded || (this.ragGenerationManifest && revision !== (await this.ragGenerationManifest.read()).revision)) {
          throw new Error('Storage changed during inspection');
        }
        return {
          pluginId: this.manifest.id,
          vaultPrefixes: layout.ownedVaultPrefixes,
          legacyNames: [...layout.cleanupLegacyNames, this.createIndexedDbName('KnowledgeGraph')],
          activeNames: [
            ...Object.values(layout.active),
            ...(this.activeArtifactDatabaseNames ?? []),
            manifest.name,
            ...Object.values(persisted.active?.databases ?? {}),
            ...Object.values(persisted.building?.databases ?? {}),
          ],
          legacyFilesSafe: Boolean(recovery && recovery === maintenance && this.bm25Index?.isReady),
          revision,
          tracked: this.generatedArtifacts.read(),
          activeArtifacts: this.generatedArtifacts.active,
          features: GENERATED_ARTIFACT_FEATURES,
          artifactFileRoots: ['.superpower-inside', this.getPluginDirectoryPath()],
          retiredFileNames: RETIRED_PLUGIN_FILE_NAMES,
        };
      }),
      this.getLogger(),
    ));
  }

  private async runStartupPluginFileMaintenance(): Promise<void> {
    try {
      const result = await maintainPluginOwnedFiles({
        adapter: this.app.vault.adapter,
        includeLegacyDirectory: false,
        pluginDirectory: this.getPluginDirectoryPath(),
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
    if (this.ragResetInProgress || this.unloaded) return null;
    if (this.ragIndexAbortController) {
      this.getLogger().debug('RAG operation ignored because another operation is running.', {
        source: 'rag.indexing',
      });
      return null;
    }
    const controller = new AbortController();
    this.ragIndexAbortController = controller;
    this.notifyRagStatsRefresh();
    try {
      this.getLogger().info('RAG operation started.', { source: 'rag.indexing' });
      const result = await operation(controller.signal);
      return result;
    } catch (err) {
      if (isIndexingCancelledError(err)) {
        this.getLogger().warn('RAG operation cancelled.', { source: 'rag.indexing' });
      } else {
        this.getLogger().error('RAG operation failed.', { source: 'rag.indexing', error: err });
      }
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
    if (this.ragResetInProgress) throw new Error('rag-reset-in-progress');
    this.ragResetInProgress = true;
    try { await this.resetPluginDataAfterDrain(); }
    catch (error) {
      this.clearRAG({ dispose: false });
      this.buildingRagRuntime = null;
      this.ragManifestRestored = false;
      this.lastRagRuntimeInitError = 'rag-reset-incomplete';
      throw error;
    } finally { this.ragResetInProgress = false; }
  }

  private async resetPluginDataAfterDrain(): Promise<void> {
    this.getLogger().info('Plugin data reset started.', { source: 'settings.reset' });
    this.ragRuntimeInitRunId = (this.ragRuntimeInitRunId ?? 0) + 1;
    this.cancelRagIndexing();
    if (this.ragGenerationRestorePromise) {
      try { await this.ragGenerationRestorePromise; }
      catch (error) { this.getLogger().debug('Stopped restore before explicit reset.', { source: 'settings.reset', error }); }
    }
    if (this.ragRuntimeInitRunner?.isRunning()) {
      try { await this.ragRuntimeInitRunner.run(); }
      catch (error) { this.getLogger().debug('Stopped building before explicit reset.', { source: 'settings.reset', error }); }
    }
    this.automaticRagRecovery?.dispose();
    this.automaticRagRecovery = null;
    this.vaultDocumentCorpus?.suspend();
    this.cancelRagIndexing();
    const runtime = this.captureRagRuntimeSnapshot();
    const drains = [this.drainRagRuntimeSnapshot(runtime)];
    if (this.buildingRagRuntime) drains.push(this.drainRagRuntimeSnapshot(this.buildingRagRuntime));
    await Promise.all([...drains, ...(this.pendingRagRuntimeDisposals ?? [])]);
    if (this.unloaded) throw new Error('rag-reset-cancelled');

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
    const embeddingCacheClear = runtime.clearEmbeddingCache
      ? runtime.clearEmbeddingCache()
      : hasClearableEmbeddingCache(this.embeddingProvider)
        ? this.embeddingProvider.deleteDatabase
          ? this.embeddingProvider.deleteDatabase()
          : this.embeddingProvider.clearCache()
        : Promise.resolve();
    await Promise.all([vectorStoreClear, bm25Clear, embeddingCacheClear]);
    this.documentCorpus?.close();
    this.clearRAG({ dispose: false });
    this.ragGenerationManifest?.close();
    this.ragGenerationManifest = null;
    this.ragManifestRestored = false;
    this.ragManifestRevision = 0;
    this.lastBuildingGeneration = null;
    this.ragAutoRecoveryPausedByUser = false;
    this.activeArtifactDatabaseNames = null;
    const databaseCleanup = await deleteRagIndexedDbGenerations(resetStorageLayout);
    if (databaseCleanup.blockedNames.length || databaseCleanup.failedNames.length || databaseCleanup.remainingDeleteCount) {
      throw new Error('rag-reset-database-incomplete');
    }

    const resetResult = await resetPluginOwnedData({
      adapter: this.app.vault.adapter,
      indexedDbNames,
    });

    const resetLanguage = resolveUiLanguage(undefined, getObsidianLanguage());
    for (const profile of this.settings.providerProfiles) {
      chatGPTOAuth.disconnect(profile.id);
      googleGeminiOAuth.disconnect(profile.id);
    }
    neutralizeProviderSecrets(this.app, this.settings);
    setLanguage(resetLanguage);
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.settings.language = resetLanguage;
    const resetPromptLibrary = normalizePromptLibrary([], undefined, '');
    this.settings.chat.promptLibrary = resetPromptLibrary.promptLibrary;
    this.settings.chat.activePromptId = resetPromptLibrary.activePromptId;
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.getLogger().configure(this.settings.logging);
    await this.persistSettings();
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
    const vectorStore = this.vectorStore;
    const engine = this.ragEngine;
    if (!vectorStore) return;
    const release = engine ? acquireRuntimeLease(engine) : () => undefined;
    try {
      const runtime = this.captureRagRuntimeSnapshot();
      const reading = () => calculateRagStatus(this.app.vault, vectorStore, this.settings.rag, this.settings.chat, undefined, undefined, { repair: false });
      const summary = await this.readRagRuntimeWithRepair(runtime, reading);
      if (this.unloaded || this.vectorStore !== vectorStore || this.ragEngine !== engine) return;
      this.eventDrivenRagStats = summary;
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
    } finally { release(); }
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
      chat.mcpToolExecutionPolicy = 'always-auto';
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

    if (typeof data.mcpIncludeWslPath !== 'boolean') {
      data.mcpIncludeWslPath = false;
    }

    // 기존 로컬 설정과 새 원격 설정을 재시작 후에도 함께 유지한다.
    if (Array.isArray(data.mcpServers)) {
      const migrated = migrateStoredMcpServersRust(data.mcpServers);
      if (!migrated) throw new Error(t('mcpConnectionFailed'));
      data.mcpServers = migrated;
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SuperpowerInsideSettings>);
    const quotaInterval = normalizeQuotaIntervalSecondsRust(data.quotaCheckIntervalSeconds);
    if (quotaInterval === null) throw new Error(t('settingsApplyFailed'));
    this.settings.quotaCheckIntervalSeconds = quotaInterval;
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
    this.settings.chatDebugTrace = normalizeChatDebugTraceSettings(data.chatDebugTrace);
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
    const secretStorage = readSecretStorage(this.app);
    const keyMigration = migrateProviderKeysToKeychain(this.app, this.settings);
    hydrateProviderApiKeys(this.app, this.settings);
    migrateChatGPTCredentials(
      this.app,
      this.settings.providerProfiles.map((profile) => profile.id),
    );
    if (!secretStorage) {
      this.getLogger().error('Obsidian secret storage unavailable; API keys stay in memory only.', {
        source: 'secrets.storage',
      });
      new Notice(t('apiKeySecretStorageUnavailable'));
    }
    const bindingChanged = this.synchronizeEmbeddingBindings();
    if (migratedFromLegacyData || keyMigration.changed || bindingChanged) {
      await this.persistSettings();
    }
    if (keyMigration.migrated > 0) {
      new Notice(t('apiKeyMigratedToSecretStorage', { count: keyMigration.migrated }));
    }
  }

  /** 비교 자료는 메모리에만 두고 영속화에는 독립 난수 nonce만 남깁니다. */
  private synchronizeEmbeddingBindings(): boolean {
    this.embeddingBindings ??= new Map();
    let changed = false;
    for (const profile of this.settings.providerProfiles) {
      const binding = [profile.strategy, profile.baseUrl, profile.apiKey, profile.relayApiKey, profile.geminiAuthMode, profile.useRequestUrl];
      const previous = this.embeddingBindings.get(profile.id);
      if (!profile.embeddingBindingRevision || (previous && binding.some((value, index) => value !== previous[index]))) {
        profile.embeddingBindingRevision = crypto.randomUUID();
        changed = true;
      }
      this.embeddingBindings.set(profile.id, binding);
    }
    for (const id of this.embeddingBindings.keys()) {
      if (!this.settings.providerProfiles.some((profile) => profile.id === id)) this.embeddingBindings.delete(id);
    }
    return changed;
  }

  /** 저장 전에 키 원문을 보안 저장소에 반영하고 저장 사본에서 제거한다. 모든 저장 경로가 이 메서드를 지난다. */
  private async persistSettings(): Promise<void> {
    this.synchronizeEmbeddingBindings();
    const quotaInterval = normalizeQuotaIntervalSecondsRust(this.settings.quotaCheckIntervalSeconds);
    if (quotaInterval === null) throw new Error(t('settingsApplyFailed'));
    this.settings.quotaCheckIntervalSeconds = quotaInterval;
    persistProviderApiKeys(this.app, this.settings);
    const persisted = settingsForPersistence(this.settings);
    saveLocalSettings(this.app, persisted);
    await this.saveData(persisted);
    this.providerQuota?.configure();
  }

  async saveSettings(options?: {
    reinitRag?: boolean;
    reinitMcp?: boolean;
  }): Promise<{ success: boolean; mcpErrors?: string[] }> {
    if (this.activeRagRuntime?.admitsEmbedding?.() === false) this.cancelRagIndexing();
    if (this.buildingRagRuntime) {
      this.ragRuntimeInitRunId++;
      this.buildingRagRuntime.ragIndexingScheduler?.cancel();
      this.buildingRagRuntime.vaultDocumentCorpus?.suspend();
    }
    const reinitRag = options?.reinitRag ?? true;
    const reinitMcp = options?.reinitMcp ?? true;
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.settings.chatDebugTrace = normalizeChatDebugTraceSettings(this.settings.chatDebugTrace);
    this.getLogger().configure(this.settings.logging);
    await this.persistSettings();
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
    if (this.activeRagRuntime?.admitsEmbedding?.() === false) this.cancelRagIndexing();
    this.settings.logging = normalizeLoggerConfig(this.settings.logging);
    this.settings.chatDebugTrace = normalizeChatDebugTraceSettings(this.settings.chatDebugTrace);
    this.getLogger().configure(this.settings.logging);
    await this.persistSettings();
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

  getRagGenerationSnapshot(): RagGenerationSnapshot {
    const active = this.activeRagRuntime;
    const building = this.buildingRagRuntime;
    const policyChanged = !!active?.sourcePolicyIdentity && active.sourcePolicyIdentity !== this.getRagSourcePolicyIdentity();
    return {
      restoreFailure: this.ragRestoreFailure ?? null,
      restoring: !!this.ragGenerationRestoring,
      updateRequired: !this.forceRagGenerationBuild && !!active?.generation && active.generation.contract.embedding !== 'lexical-baseline' && !active.generation.contract.embeddingBinding,
      revision: this.ragManifestRevision ?? 0,
      serving: active?.generation ?? null,
      availability: this.ragResetInProgress ? 'restoring' : this.ragEngine ? 'usable' : this.ragGenerationRestoring ? 'restoring' : this.ragRestoreFailure || this.lastRagRuntimeInitError ? 'failed' : 'none',
      coverage: active?.coverageLimited ? 'legacy-limited' : active?.generation?.proof ? !policyChanged && active.generation.terminal === 'complete' ? 'complete' : 'partial' : this.ragEngine ? 'legacy-limited' : null,
      semanticAvailable: !!this.embeddingProvider && active?.admitsEmbedding?.() !== false,
      building: building ? { source: 'live', generation: building.generation ?? null, status: this.ragAutoRecoveryPausedByUser ? 'paused' : 'building', indexing: building.ragIndexingStatus }
        : this.lastBuildingGeneration ? { source: this.lastBuildingGenerationSource ?? 'saved', generation: this.lastBuildingGeneration, status: this.lastBuildingGeneration.terminal, indexing: null } : null,
    };
  }

  getRagRuntimeState() {
    const clearableEmbeddingProvider = hasClearableEmbeddingCache(this.embeddingProvider)
      ? this.embeddingProvider
      : null;
    return {
      generation: this.getRagGenerationSnapshot(),
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
      autoRecoveryPausedByUser: this.ragAutoRecoveryPausedByUser,
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
    if (this.ragResetInProgress || this.unloaded) return false;
    const guard = this.ragPerformanceGuard;
    if (!guard) return true;
    await guard.measureEventLoopLag();
    return !this.ragResetInProgress && !this.unloaded && guard.getState().mode !== 'paused';
  }

  private async waitForRagBackgroundCapacity(): Promise<void> {
    if (this.ragResetInProgress || this.unloaded) throw new RagRuntimeInitializationCancelledError();
    const guard = this.ragPerformanceGuard;
    if (!guard) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      return;
    }
    while (true) {
      await guard.measureEventLoopLag();
      if (this.ragResetInProgress || this.unloaded) throw new RagRuntimeInitializationCancelledError();
      const state = guard.getState();
      if (state.mode !== 'paused') return;
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, Math.max(50, Math.min(state.remainingPauseMs ?? 1_000, 1_000))),
      );
    }
  }

  private startBM25BackgroundLoad(
    bm25Index: IndexedDbBM25Index,
    runtime: RagRuntimeSnapshot,
  ): Promise<BM25BackgroundLoadOutcome> {
    const startedAt = Date.now();
    this.getLogger().info('BM25 index background initialization started.', {
      source: 'rag.bm25',
    });
    // 물리 load만 등록합니다. 완료 checkpoint는 이 run 밖에서 실행해야 합니다.
    const io = runtime.io ??= new RagRuntimeWorkBarrier();
    return io.run(() => bm25Index.load((progress) => {
      const key = runtime.ragEngine ?? runtime.documentCorpus ?? runtime.vectorStore ?? runtime;
      if (this.ragRuntimeDisposals?.has(key) || this.ragAutoRecoveryPausedByUser) return;
      this.observeRagRuntimeWork(runtime, progress.stage, progress.unit, progress.processedUnits, progress.totalUnits);
    })).then(
      () => ({ error: null, startedAt, loadDurationMs: Date.now() - startedAt }),
      (error: unknown) => ({
        error: error instanceof Error ? error : new Error(String(error)),
        startedAt,
        loadDurationMs: Date.now() - startedAt,
      }),
    );
  }

  private async indexBM25File(
    bm25Index: IndexedDbBM25Index | undefined,
    file: TFile,
    runtime = this.captureRagRuntimeSnapshot(),
  ): Promise<void> {
    await runtime.vaultDocumentCorpus?.refreshFile(file);
    const documents = (await runtime.documentCorpus?.getDocumentsByFilePath(file.path)) ?? [];
    const metadata = this.app.metadataCache.getFileCache(file);
    await bm25Index?.withBatch(async () => {
      bm25Index.removeDocumentsBySource(file.path);
      for (const document of documents) {
        bm25Index.addCorpusDocument({
          ...document,
          ...getBM25DocumentFields(file, metadata, document.heading),
        });
      }
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
    runtime = this.captureRagRuntimeSnapshot(),
  ): Promise<number> {
    await runtime.vaultDocumentCorpus?.removeFile(filePath);
    bm25Index?.removeDocumentsBySource(filePath);
    await bm25Index?.persist();
    return 0;
  }

  async initRAG(): Promise<void> {
    if (this.ragResetInProgress || this.unloaded || this.isSelectedLocalModelDeleting()) return;
    if (this.buildingRagRuntime) {
      this.ragRuntimeInitRunId++;
      this.buildingRagRuntime.ragIndexingScheduler?.cancel();
      this.buildingRagRuntime.vaultDocumentCorpus?.suspend();
    }
    const runner = this.getRagRuntimeInitRunner();
    const repeat = runner.isRunning();
    await runner.run();
    if (repeat && !this.unloaded && !this.ragResetInProgress && !this.ragAutoRecoveryPausedByUser) await runner.run();
  }

  async ensureRagRuntimeInitialized(): Promise<boolean> {
    if (this.ragResetInProgress || this.unloaded) return false;
    // 저장소만 만들어진 부분 초기화 상태에서 건너뛰면 질의 엔진 없이 준비 완료로 보입니다.
    if (this.ragReady) return true;
    if (this.ragRuntimeInitRunner?.isRunning()) await this.ragRuntimeInitRunner.run();
    else await this.initRAG();
    return !this.unloaded && !this.ragResetInProgress && this.ragReady;
  }

  async prepareRagForChat(): Promise<boolean> {
    if (this.ragResetInProgress || this.unloaded) return false;
    if (!this.ragEngine) {
      try { await this.restorePersistedRagGeneration(); }
      catch (error) { this.getLogger().warn('Previous search generation unavailable.', { source: 'rag.generation', error }); }
      if (this.unloaded || this.ragResetInProgress) return false;
      if (this.ragEngine && !this.ragAutoRecoveryPausedByUser) {
        // 복원한 active가 있으면 새 구축을 기다리지 않고 현재 요청을 계속합니다.
        void this.getRagRuntimeInitRunner().run().catch((error: unknown) => {
          this.getLogger().warn('Background generation build failed; preserving serving search.', { source: 'rag.generation', error });
        });
      }
    }
    const initialized = this.ragEngine ? true : await this.ensureRagRuntimeInitialized();
    if (this.unloaded || this.ragResetInProgress) return false;
    if (this.bm25Index?.hasFailure && !this.ragAutoRecoveryPausedByUser) {
      const runtime = this.captureRagRuntimeSnapshot();
      if (!runtime.io!.captureReadSnapshot()()) return false;
      const release = runtime.ragEngine ? acquireRuntimeLease(runtime.ragEngine) : () => undefined;
      try {
        await runtime.io!.run(() => {
          if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser || this.bm25Index !== runtime.bm25Index) throw new IndexingCancelledError();
          return runtime.bm25Index!.recoverClosedWorker();
        });
      } finally { release(); }
    }
    return !this.unloaded && !this.ragResetInProgress && initialized;
  }

  private get ragReady(): boolean {
    return Boolean(
      this.ragEngine && this.vectorStore && this.vaultIndexer && this.ragIndexingScheduler,
    );
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
    // legacy handle도 이후 capture/drain이 같은 장벽을 공유해야 합니다.
    if (this.activeRagRuntime) this.activeRagRuntime.io ??= new RagRuntimeWorkBarrier();
    const snapshot: RagRuntimeSnapshot = {
      io: this.activeRagRuntime?.io,
      sourcePolicyIdentity: this.activeRagRuntime?.sourcePolicyIdentity,
      pendingRecoverySourceEvents: this.activeRagRuntime?.pendingRecoverySourceEvents,
      disposeSourceObserver: this.activeRagRuntime?.disposeSourceObserver,
      localEmbeddingModelId: this.activeRagRuntime?.localEmbeddingModelId,
      retireProvider: this.activeRagRuntime?.retireProvider,
      clearEmbeddingCache: this.activeRagRuntime?.clearEmbeddingCache,
      coverageLimited: this.activeRagRuntime?.coverageLimited,
      admitsEmbedding: this.activeRagRuntime?.admitsEmbedding,
      config: this.activeRagRuntime?.config,
      generation: this.activeRagRuntime?.generation,
      lexicalBuildResult: this.activeRagRuntime?.lexicalBuildResult,
      databaseNames: this.activeRagRuntime?.databaseNames,
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
    if (!this.activeRagRuntime && (snapshot.ragEngine || snapshot.documentCorpus || snapshot.vectorStore || snapshot.bm25Index)) {
      snapshot.io = new RagRuntimeWorkBarrier();
      this.activeRagRuntime = snapshot;
    }
    return snapshot;
  }

  private restoreRagRuntimeSnapshot(snapshot: RagRuntimeSnapshot): boolean {
    if (snapshot.io && !snapshot.io.captureReadSnapshot()()) return false;
    if (
      !(snapshot.documentCorpus && snapshot.ragEngine) &&
      !(snapshot.vectorStore && snapshot.vaultIndexer && snapshot.ragIndexingScheduler)
    ) {
      return false;
    }
    snapshot.io ??= new RagRuntimeWorkBarrier();
    if (snapshot.bm25Index?.isReady || snapshot.generation?.terminal === 'complete') this.ragRestoreFailure = null;
    this.activeRagRuntime = snapshot;
    this.documentCorpus = snapshot.documentCorpus;
    this.vaultDocumentCorpus = snapshot.vaultDocumentCorpus;
    if (!this.ragAutoRecoveryPausedByUser) this.vaultDocumentCorpus?.resume();
    this.vectorStore = snapshot.vectorStore;
    this.embeddingProvider = snapshot.embeddingProvider;
    if (this.bm25Index !== snapshot.bm25Index) {
      this.bm25RecoveryInFlight = false;
      this.bm25RecoveryAttempts = 0;
      this.bm25RecoveryExhausted = false;
    }
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
    if (!this.ragAutoRecoveryPausedByUser) this.automaticRagRecovery?.resume();
    this.refreshBus?.emit('rag', {
      status: 'success',
      detail: this.ragIndexingStatus
        ? this.formatRagIndexingStatus(this.ragIndexingStatus)
        : t('ragIdle'),
    });
    return true;
  }

  private disposeRagRuntimeSnapshot(snapshot: RagRuntimeSnapshot): void {
    void this.drainRagRuntimeSnapshot(snapshot);
  }

  private drainRagRuntimeSnapshot(snapshot: RagRuntimeSnapshot): Promise<void> {
    const key = snapshot.ragEngine ?? snapshot.documentCorpus ?? snapshot.vectorStore ?? snapshot;
    const disposals = this.ragRuntimeDisposals ??= new WeakMap<object, Promise<void>>();
    const existing = disposals.get(key);
    if (existing) return existing;
    let resolveDrain!: () => void;
    let rejectDrain!: (error: Error) => void;
    const completion = new Promise<void>((resolve, reject) => { resolveDrain = resolve; rejectDrain = reject; });
    disposals.set(key, completion);
    const pending = this.pendingRagRuntimeDisposals ??= new Set<Promise<void>>();
    pending.add(completion);
    if (snapshot.localEmbeddingModelId) (this.ragRuntimeDisposalModels ??= new WeakMap<Promise<void>, LocalEmbeddingModelId>()).set(completion, snapshot.localEmbeddingModelId);
    // 종료 실패는 소유 저장소의 파괴적 초기화를 계속 막아야 합니다.
    void completion.then(() => { pending.delete(completion); }, () => {
      this.getLogger().warn('RAG runtime drain failed; retaining storage.', { source: 'rag.generation' });
    });
    try {
      snapshot.disposeSourceObserver?.();
      snapshot.io?.close();
      snapshot.automaticRagRecovery?.dispose();
      snapshot.ragIndexingScheduler?.cancel();
      snapshot.vaultDocumentCorpus?.suspend();
    } catch { rejectDrain(new Error('rag-runtime-stop-failed')); return completion; }
    const close = (): void => {
      let failed = false;
      for (const action of [
        () => snapshot.vaultDocumentCorpus?.dispose(),
        () => snapshot.documentCorpus?.close(),
        () => snapshot.vectorStore?.close?.(),
        () => snapshot.bm25Index?.close?.(),
        () => snapshot.embeddingProvider?.close?.(),
      ]) {
        try { action(); }
        catch { failed = true; }
      }
      try { this.refreshActiveArtifactDatabaseNames(); }
      catch { failed = true; }
      if (failed) rejectDrain(new Error('rag-runtime-close-failed'));
      else resolveDrain();
    };
    // 기존 요청은 끝까지 provider를 쓸 수 있고 deadline 뒤 작업도 정착해야 합니다.
    let providerDrained = !snapshot.retireProvider;
    let providerRetirementStarted = !snapshot.retireProvider;
    let requestsDrained = !snapshot.ragEngine;
    let indexingDrained = !snapshot.ragIndexingScheduler;
    let writersDrained = !snapshot.io;
    let closed = false;
    const finish = (): void => {
      if (!providerRetirementStarted && requestsDrained && indexingDrained && writersDrained) {
        providerRetirementStarted = true;
        snapshot.retireProvider?.(() => { providerDrained = true; finish(); }, () => {
          rejectDrain(new Error('rag-runtime-provider-drain-failed'));
        });
      }
      if (!closed && providerDrained && requestsDrained && indexingDrained && writersDrained) { closed = true; close(); }
    };
    if (snapshot.ragEngine) retireRuntime(snapshot.ragEngine, () => { requestsDrained = true; finish(); });
    if (snapshot.io) void snapshot.io.waitForIdle().then(() => { writersDrained = true; finish(); }, () => rejectDrain(new Error('rag-runtime-writer-drain-failed')));
    if (snapshot.ragIndexingScheduler) {
      void snapshot.ragIndexingScheduler.waitForIdle().then(() => { indexingDrained = true; finish(); }, () => {
        // idle 경계 실패 때 미확인 store를 닫지 않습니다.
        rejectDrain(new Error('rag-runtime-indexing-drain-failed'));
      });
    }
    finish();
    return completion;
  }

  /** 품질 검사는 기존 lexical만 빌리고 선택된 모델이나 새 구축을 시작하지 않습니다. */
  async acquireRagEngineOnlySnapshot() {
    if (this.unloaded || this.ragResetInProgress) return null;
    try { await this.restorePersistedRagGeneration(); }
    catch { return null; }
    if (this.unloaded || this.ragResetInProgress) return null;
    const runtime = this.captureRagRuntimeSnapshot();
    const owner = runtime.ragEngine;
    const corpus = runtime.documentCorpus;
    if (!owner || !corpus) return null;
    const release = acquireRuntimeLease(owner);
    try {
      const rag = runtime.config?.rag ?? this.settings.rag;
      const engine = new RAGQueryEngine(null, null, runtime.bm25Index ?? undefined, 1, rag.minScore, {
        literalInventorySource: this.createRagLiteralInventorySource(runtime),
        corpusStore: corpus,
        getCandidatePaths: async () => new Set((await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)).map((file) => file.path)),
      });
      return {
        ragEngine: leaseRagQueryEngine(engine, owner),
        documentCorpus: corpus,
        chunkConfig: { chunkSize: rag.chunkSize, overlap: rag.overlap },
        queryMinScore: rag.minScore,
        isCurrent: this.captureRagReadCurrentness(runtime),
        release,
      };
    } catch (error) { release(); throw error; }
  }

  /** 포트 캐시와 무관하게 요청 시작 시 active 한 세대를 고정합니다. */
  acquireRagSearchSnapshot() {
    if (this.ragResetInProgress || this.unloaded) return null;
    const runtime = this.captureRagRuntimeSnapshot();
    const release = runtime.ragEngine ? acquireRuntimeLease(runtime.ragEngine) : () => undefined;
    return {
      ragEngine: runtime.ragEngine ? leaseRagQueryEngine(runtime.ragEngine) : null,
      documentCorpus: runtime.documentCorpus,
      chunkConfig: runtime.config?.rag ?? { ...this.settings.rag },
      queryMinScore: runtime.config?.rag.minScore ?? this.settings.rag.minScore,
      isCurrent: this.captureRagReadCurrentness(runtime),
      release,
    };
  }

  private readAutomaticRecoveryPendingState(runtime: RagRuntimeSnapshot, repair = true, signal?: AbortSignal) {
    const indexer = runtime.vaultIndexer;
    if (!indexer) throw new Error('RAG recovery indexer unavailable');
    return indexer.getAutomaticRecoveryPendingState({ signal, isCurrent: this.captureRagReadCurrentness(runtime) }, { repair });
  }

  private async readRagRuntimeWithRepair<T>(
    runtime: RagRuntimeSnapshot,
    reading: () => Promise<T>,
    requireAdmission?: () => void,
  ): Promise<T> {
    const io = runtime.io;
    if (!io) return reading();
    const release = runtime.ragEngine ? acquireRuntimeLease(runtime.ragEngine) : () => undefined;
    const read = () => {
      requireAdmission?.();
      return io.runRead(async () => {
        const current = this.captureRagReadCurrentness(runtime);
        const requireCurrent = () => {
          requireAdmission?.();
          if (!current() || this.ragEngine !== runtime.ragEngine || (this.activeRagRuntime && this.activeRagRuntime.io !== io)) throw new IndexingCancelledError();
        };
        requireCurrent();
        const result = await reading();
        requireCurrent();
        return result;
      });
    };
    try {
      try { return await read(); }
      catch (error) {
        if (!(error instanceof FileIndexRepairRequiredError)) throw error;
        requireAdmission?.();
        // 조회 admission 밖에서만 복구하며 동시 관측자는 같은 쓰기 하나를 공유합니다.
        const repairs = this.ragFileIndexRepairs ??= new WeakMap<RagRuntimeWorkBarrier, Promise<void>>();
        let repair = repairs.get(io);
        if (!repair) {
          this.requireRagRuntimeWriteCurrent(runtime);
          repair = io.run(async () => {
            requireAdmission?.();
            this.requireRagRuntimeWriteCurrent(runtime);
            await runtime.vectorStore!.getFileIndexRecords();
          }).then(() => {
            // 공유 쓰기가 proof를 한 번만 인계합니다. 조회 완료 순서는 tick을 방해하지 않습니다.
            const tick = runtime.ragIndexingScheduler && this.ragAutoIndexTicks?.get(runtime.ragIndexingScheduler);
            if (tick) tick.repairNeedsCheckpoint = true;
            else void this.refreshRagRuntimeCheckpoint(runtime);
          }).finally(() => { repairs.delete(io); });
          repairs.set(io, repair);
        }
        await repair;
        return await read();
      }
    } finally {
      release();
    }
  }

  private rememberRagRuntimeProof(runtime: RagRuntimeSnapshot, proof: RagGenerationProof, manifestProof = proof): void {
    const io = runtime.io;
    if (!io) return;
    const sourceStable = io.captureInvalidationSnapshot();
    const policy = this.getRagSourcePolicyIdentity();
    const stable = (): boolean => sourceStable() && !this.unloaded && !this.ragResetInProgress && policy === this.getRagSourcePolicyIdentity();
    const { generation, documentCorpus, bm25Index, vectorStore, vaultIndexer, ragEngine } = runtime;
    const contract = JSON.stringify(generation?.contract);
    (this.ragVerifiedProofs ??= new WeakMap()).set(io, { proof: structuredClone(proof), manifestProof: structuredClone(manifestProof), isCurrent: (current) => stable() &&
      current.generation?.id === generation?.id && JSON.stringify(current.generation?.contract) === contract &&
      current.documentCorpus === documentCorpus && current.bm25Index === bm25Index && current.vectorStore === vectorStore &&
      current.vaultIndexer === vaultIndexer && current.ragEngine === ragEngine });
  }

  private requireRagRuntimeWriteCurrent(runtime: RagRuntimeSnapshot): void {
    if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser ||
        this.ragEngine !== runtime.ragEngine || (this.activeRagRuntime && this.activeRagRuntime.io !== runtime.io) ||
        !runtime.io?.captureReadSnapshot()() || !this.matchesRagStorageContract(runtime)) throw new IndexingCancelledError();
  }

  private captureRagReadCurrentness(runtime: RagRuntimeSnapshot): () => boolean {
    const stable = runtime.io?.captureReadSnapshot();
    const policy = this.getRagSourcePolicyIdentity();
    return () => stable?.() === true && !this.unloaded && !this.ragResetInProgress && policy === this.getRagSourcePolicyIdentity();
  }

  private createRagLiteralInventorySource(runtime: RagRuntimeSnapshot): LiteralInventorySource | undefined {
    const corpus = runtime.documentCorpus;
    if (!corpus) return undefined;
    const generationId = runtime.generation?.id ?? crypto.randomUUID();
    return { corpus, captureScope: () => {
      if (!runtime.io || this.unloaded || this.ragResetInProgress) throw new LiteralInventoryError('source-scope-unavailable');
      const isCurrent = this.captureRagReadCurrentness(runtime);
      const manifest = getRagIndexingManifest(this.app.vault, this.settings.rag, this.settings.chat);
      if (manifest.failures.length > 0) throw new LiteralInventoryError('source-scope-incomplete');
      const sources = new Map(manifest.candidates.map((file) => {
        const prepared = getRagPreparedSourceRevision(this.app.vault, file);
        return [file.path, { sourceMtime: file.stat.mtime, sourceSize: file.stat.size,
          contentHash: prepared?.contentHash ?? '', sourceMetadataHash: prepared?.sourceMetadataHash ?? '', verified: prepared !== null }] as const;
      }));
      if (!manifest.isCurrent()) throw new LiteralInventoryError('inventory-stale');
      return Promise.resolve({ generationId, sources, isCurrent });
    } };
  }

  private getRagSourcePolicyIdentity(config: Pick<SuperpowerInsideSettings, 'rag' | 'chat'> = this.settings): string {
    return JSON.stringify({ paths: getEffectiveExcludePaths(config.rag, config.chat, this.app.vault.configDir), extensions: config.rag.excludeExts });
  }

  private matchesRagIndexerSourcePolicy(runtime: RagRuntimeSnapshot): boolean {
    // checkpoint가 갱신하는 proof 정책이 아니라 indexer를 만든 실제 config와 비교합니다.
    return !runtime.config || this.getRagSourcePolicyIdentity(runtime.config) === this.getRagSourcePolicyIdentity();
  }

  private observeRagRuntimeSources(runtime: RagRuntimeSnapshot): void {
    const io = runtime.io ??= new RagRuntimeWorkBarrier();
    const invalidate = (): void => {
      io.invalidate();
      const active = this.activeRagRuntime;
      if (active?.io === io && active.generation) active.generation = { ...active.generation, terminal: 'partial' };
    };
    const invalidateRecoveryPath = (path: string): void => {
      if (runtime.vaultIndexer) runtime.vaultIndexer.invalidateAutomaticRecoverySource(path);
      else (runtime.pendingRecoverySourceEvents ??= new Set()).add(path);
    };
    const changed = (file: TAbstractFile): void => {
      invalidateRecoveryPath(file.path);
      if (file instanceof TFile) {
        try { if (isRagFileMetadataExcluded(this.app.vault, file, this.settings.rag, this.settings.chat)) return; }
        catch { /* 정책 판정 실패도 미검증 변경으로 보존합니다. */ }
      }
      invalidate();
    };
    const refs = [this.app.vault.on('create', changed), this.app.vault.on('modify', changed), this.app.vault.on('delete', changed), this.app.vault.on('rename', (file, oldPath) => { invalidateRecoveryPath(oldPath); changed(file); })];
    const metadata = typeof this.app.metadataCache?.on === 'function' ? this.app.metadataCache.on('changed', changed) : null;
    let disposed = false;
    runtime.disposeSourceObserver = () => {
      if (disposed) return;
      disposed = true;
      for (const ref of refs) this.app.vault.offref(ref);
      if (metadata) this.app.metadataCache.offref(metadata);
    };
  }

  private async readRagRuntimeSeal(runtime: RagRuntimeSnapshot, vectorStore = runtime.vectorStore): Promise<RagDurabilitySeal> {
    const contract = runtime.generation?.contract;
    const corpus = await runtime.documentCorpus?.getDurabilityReceipt();
    if (!contract || !corpus) throw new Error('rag-runtime-durability-unverified');
    let lexical: RagDurabilitySeal['lexical'] = { state: 'disabled' };
    if (contract.bm25Enabled) {
      const checkpoint = await runtime.bm25Index?.getCheckpoint();
      if (!checkpoint?.receipt || !checkpoint.applied) throw new Error('rag-runtime-lexical-unverified');
      lexical = { state: 'enabled', receipt: checkpoint.receipt, applied: { sessionId: checkpoint.applied.sessionId, revision: checkpoint.applied.revision } };
    }
    let vector: RagDurabilitySeal['vector'];
    if (contract.vectorMode === 'disabled') vector = { state: 'disabled' };
    else if (contract.vectorMode === 'memory' && vectorStore) vector = { state: 'ephemeral' };
    else if (contract.vectorMode === 'indexeddb') {
      const checkpoint = await vectorStore?.getDurabilityCheckpoint?.();
      if (!checkpoint?.receipt || checkpoint.pendingWrites !== 0 || checkpoint.recoveryPending) throw new Error('rag-runtime-vector-unverified');
      vector = { state: 'enabled', receipt: checkpoint.receipt };
    } else throw new Error('rag-runtime-vector-unverified');
    return { version: 1, corpus, lexical, vector };
  }

  private async collectRagRuntimeProof(runtime: RagRuntimeSnapshot, requireCurrent: () => void, initialize: boolean): Promise<RagGenerationProof> {
    const corpus = runtime.documentCorpus;
    const captured = runtime.config;
    if (!corpus || !captured) throw new Error('rag-runtime-durability-unverified');
    const config = { rag: { ...this.settings.rag, chunkSize: captured.rag.chunkSize, overlap: captured.rag.overlap }, chat: this.settings.chat };
    const policy = this.getRagSourcePolicyIdentity();
    requireCurrent();
    await runtime.bm25Index?.flush();
    if (initialize) {
      await corpus.initializeEmptyDurabilityReceipt();
      await runtime.bm25Index?.initializeEmptyDurabilityReceipt();
      await runtime.vectorStore?.initializeEmptyDurabilityReceipt?.();
    }
    const before = await this.readRagRuntimeSeal(runtime);
    const rows = new Map((await corpus.getFileIndexRecords()).map((record) => [record.filePath, record]));
    const failures = new Map((runtime.vaultIndexer?.getFailedFilePaths() ?? []).map((path) => [path, { path, reason: 'indexing-failed' }]));
    const inventory = getRagIndexingManifest(this.app.vault, config.rag, config.chat);
    const considered = new Set<string>();
    let verified = 0;
    this.observeRagRuntimeWork(runtime, 'verifying', 'files', 0, inventory.candidates.length);
    for (const { file, reason } of inventory.failures) {
      considered.add(file.path);
      failures.set(file.path, { path: file.path, reason });
    }
    for (const file of inventory.unsupported) {
      considered.add(file.path);
      failures.set(file.path, { path: file.path, reason: 'binary' });
    }
    for (const file of inventory.candidates) {
      requireCurrent();
      considered.add(file.path);
      try {
        const snapshot = await readSourceFileSnapshot(this.app.vault, file, { priority: 'background', preparation: { path: file.path, chunkSize: config.rag.chunkSize, overlap: config.rag.overlap } });
        requireCurrent();
        if (!snapshot?.chunks) throw new Error('Source verification unavailable.');
        const verdict = getRagPreparedContentVerdict(this.app.vault, snapshot.file, snapshot.content, config.rag, config.chat);
        if (verdict.kind !== 'candidate') {
          if (rows.has(file.path) || verdict.kind === 'failed') failures.set(file.path, { path: file.path, reason: verdict.reason ?? 'source-policy-unverified' });
          continue;
        }
        const row = rows.get(file.path);
        const documents = await corpus.getDocumentsByFilePath(file.path);
        const byId = new Map(documents.map((document) => [document.id, document]));
        const matches = row?.hasCompleteMetadata === true && row.contentHash === snapshot.revision.contentHash &&
          row.sourceMtime === snapshot.revision.sourceMtime && row.sourceSize === snapshot.revision.sourceSize && row.sourceMetadataHash === snapshot.sourceMetadataHash &&
          documents.length === snapshot.chunks.length && snapshot.chunks.every((chunk) => {
            const document = byId.get(chunk.id);
            const fields = getBM25DocumentFields(snapshot.file, this.app.metadataCache?.getFileCache(snapshot.file), chunk.metadata.heading);
            return document?.text === chunk.text && document.chunkHash === chunk.chunkHash && document.startLine === chunk.metadata.startLine && document.endLine === chunk.metadata.endLine &&
              (['title', 'headings', 'tags', 'aliases'] as const).every((key) => JSON.stringify(document[key]) === JSON.stringify(fields[key]));
          });
        if (!matches) failures.set(file.path, { path: file.path, reason: 'source-not-current-at-checkpoint' });
        if (runtime.bm25Index) {
          const lexical = await runtime.bm25Index.getCorpusDocumentsBySourcePaths([file.path]);
          const lexicalById = new Map(lexical.map((document) => [document.id, document]));
          if (lexical.length !== documents.length || documents.some((document) => {
            const stored = lexicalById.get(document.id);
            return !stored || stored.text !== document.text || stored.contentHash !== document.contentHash || stored.sourceMtime !== document.sourceMtime || stored.sourceSize !== document.sourceSize ||
              (['title', 'headings', 'tags', 'aliases'] as const).some((key) => JSON.stringify(stored[key]) !== JSON.stringify(document[key]));
          })) failures.set(file.path, { path: file.path, reason: 'lexical-projection-not-current' });
        }
        if (runtime.vectorStore) {
          const record = await runtime.vectorStore.getFileIndexRecord(file.path);
          const vectors = await runtime.vectorStore.getEntriesByFilePaths([file.path]);
          const byVectorId = new Map(vectors.map((entry) => [entry.id, entry]));
          if (!record || record.contentHash !== snapshot.revision.contentHash || record.sourceMetadataHash !== snapshot.sourceMetadataHash ||
              record.sourceMtime !== snapshot.revision.sourceMtime || record.sourceSize !== snapshot.revision.sourceSize || vectors.length !== snapshot.chunks.length ||
              snapshot.chunks.some((chunk) => { const entry = byVectorId.get(chunk.id); return !entry || entry.metadata.text !== chunk.text || entry.metadata.chunkHash !== chunk.chunkHash; })) {
            failures.set(file.path, { path: file.path, reason: 'vector-projection-not-current' });
          }
        }
        if (snapshot.sourceMetadata.completeness?.status === 'partial') failures.set(file.path, { path: file.path, reason: 'source-partial' });
      } catch (error) {
        failures.set(file.path, { path: file.path, reason: error instanceof SourceReadError ? error.reason : 'source-verification-failed' });
      } finally {
        requireCurrent();
        this.observeRagRuntimeWork(runtime, 'verifying', 'files', ++verified, inventory.candidates.length);
      }
    }
    for (const path of rows.keys()) if (!considered.has(path)) failures.set(path, { path, reason: 'source-not-candidate' });
    requireCurrent();
    this.observeRagRuntimeWork(runtime, 'publishing');
    const seal = await this.readRagRuntimeSeal(runtime);
    if (!sameRagDurabilitySeal(before, seal) || policy !== this.getRagSourcePolicyIdentity()) throw new IndexingCancelledError();
    requireCurrent();
    return { seal, corpusDurable: true, lexicalDurable: true, lexicalApplied: true, vectorDurable: true,
      pendingWrites: 0, targetsSettled: true, documentCount: rows.size, failures: [...failures.values()] };
  }

  private refreshRagRuntimeCheckpoint(runtime: RagRuntimeSnapshot): Promise<boolean> {
    const io = runtime.io;
    if (!io || !runtime.generation) return Promise.resolve(false);
    const runs = this.ragCheckpointRuns ??= new WeakMap<RagRuntimeWorkBarrier, Promise<boolean>>();
    const requests = this.ragCheckpointRequests ??= new WeakMap<RagRuntimeWorkBarrier, number>();
    requests.set(io, (requests.get(io) ?? 0) + 1);
    const existing = runs.get(io);
    if (existing) return existing;
    const ownsWork = !this.ragRuntimeWork || (this.ragRuntimeWork.owner === runtime && this.buildingRagRuntime !== runtime);
    if (!this.ragRuntimeWork && !this.unloaded) this.beginRagRuntimeWork(runtime);
    const observedWork = this.ragRuntimeWork;
    const task = (async () => {
      let verified: boolean;
      let requested: number;
      let unchanged: () => boolean;
      do {
        verified = false;
        requested = requests.get(io) ?? 0;
        unchanged = this.captureRagReadCurrentness(runtime);
        try {
          await runtime.ragIndexingScheduler?.waitForIdle();
          verified = await io.checkpoint(async (stable) => {
        const policy = this.getRagSourcePolicyIdentity();
        const requireCurrent = (): void => {
          if (!stable() || policy !== this.getRagSourcePolicyIdentity() || this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser || this.ragEngine !== runtime.ragEngine || (this.activeRagRuntime && this.activeRagRuntime.io !== io) || !this.matchesRagStorageContract(runtime)) throw new IndexingCancelledError();
        };
        requireCurrent();
        const manifest = this.getRagGenerationManifest();
        const previous = await manifest.read();
        if (previous.pausedByUser || previous.active?.id !== runtime.generation!.id || JSON.stringify(previous.active.contract) !== JSON.stringify(runtime.generation!.contract)) return false;
        const cached = this.ragVerifiedProofs?.get(io);
        if (cached?.isCurrent(runtime) && !runtime.coverageLimited &&
            JSON.stringify(previous.active.proof) === JSON.stringify(cached.manifestProof) &&
            sameRagDurabilitySeal(cached.proof.seal ?? null, await this.readRagRuntimeSeal(runtime))) {
          requireCurrent();
          const latest = await manifest.read();
          requireCurrent();
          if (latest.pausedByUser || latest.active?.id !== previous.active.id || latest.revision !== previous.revision ||
              JSON.stringify(latest.active.proof) !== JSON.stringify(cached.manifestProof)) return false;
          if (cached.isCurrent(runtime)) return true;
        }
        const proof = await this.collectRagRuntimeProof(runtime, requireCurrent, true);
        requireCurrent();
        const revision = await manifest.refreshActive(previous.revision, runtime.generation!.id, previous.active.proof?.seal ?? null, proof);
        if (revision === null) return false;
        requireCurrent();
        this.ragManifestRevision = revision;
        const record: RagGenerationRecord = { ...runtime.generation!, terminal: proof.failures.length ? 'partial' : 'complete', proof };
        runtime.generation = record;
        runtime.coverageLimited = false;
        runtime.sourcePolicyIdentity = policy;
        this.rememberRagRuntimeProof(runtime, proof);
        if (this.activeRagRuntime?.io === io) { this.activeRagRuntime.generation = record; this.activeRagRuntime.coverageLimited = false; this.activeRagRuntime.sourcePolicyIdentity = policy; }
        return true;
          });
        } catch {
          this.getLogger().debug('Active RAG checkpoint remains unverified.', { source: 'rag.generation' });
        }
      } while (requested !== requests.get(io) && !unchanged() && !this.unloaded && !this.ragResetInProgress && !this.ragAutoRecoveryPausedByUser && this.ragEngine === runtime.ragEngine);
      return verified;
    })().finally(() => { runs.delete(io); if (ownsWork && this.ragRuntimeWork === observedWork) this.endRagRuntimeWork(runtime); });
    runs.set(io, task);
    return task;
  }

  private refreshActiveArtifactDatabaseNames(): void {
    this.activeArtifactDatabaseNames = new Set([
      ...(this.activeRagRuntime?.databaseNames ?? []),
      ...(this.buildingRagRuntime?.databaseNames ?? []),
      ...(this.ragGenerationManifest ? [this.ragGenerationManifest.name] : []),
      ...(this.generatedArtifactRegistry?.active ?? []).filter((record) => record.kind === 'database').map((record) => record.id),
    ]);
  }

  private getRagGenerationManifest(): RagGenerationManifest {
    if (!this.ragGenerationManifest) {
      const layout = createRagStorageLayout({
        pluginId: this.manifest?.id ?? 'superpower-inside', vaultIdentity: this.getVaultStorageIdentity(),
        legacyVaultName: this.getVaultName(), embeddingNamespace: 'generation-manifest', indexNamespace: 'generation-manifest-v1',
      });
      this.ragGenerationManifest = new RagGenerationManifest(layout.active.corpus, this.generatedArtifacts.forFeature('rag-corpus'));
    }
    return this.ragGenerationManifest;
  }

  private recordRagRestoreFailure(error: unknown, owner: object, runId: number): void {
    const work = this.ragRuntimeWork;
    if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress ||
        this.ragAutoRecoveryPausedByUser || this.ragRuntimeInitRunId !== runId ||
        work?.owner !== owner || error instanceof RagRuntimeInitializationCancelledError || isIndexingCancelledError(error)) return;
    // 복원 owner의 최초 원인과 당시 관측 단계만 보존합니다.
    this.ragRestoreFailure ??= {
      error: error instanceof Error ? error.message : String(error),
      stage: work.tracker.snapshot()?.stage ?? null,
    };
  }

  /** 이름을 열거해 최신 DB를 추측하지 않고 현재 vault·기존 v4 계약의 정확한 이름만 확인합니다. */
  private async restoreLegacyRagGeneration(owner: object): Promise<void> {
    const restoreRunId = this.ragRuntimeInitRunId;
    const rag = { ...this.settings.rag };
    const selected = resolveUsableProviderModelRef(this.settings, rag.embeddingModelRef ?? '', 'embedding');
    const embedding = selected ? createEmbeddingCacheNamespace(`profile:${selected.profile.id}`, selected.modelId) : 'lexical-baseline';
    const namespace = `idx-v4:${rag.chunkSize}:${rag.overlap}`;
    const layout = createRagStorageLayout({
      pluginId: this.manifest?.id ?? 'superpower-inside', vaultIdentity: this.getVaultStorageIdentity(),
      legacyVaultName: this.getVaultName(), embeddingNamespace: embedding, indexNamespace: namespace,
    });
    const existing = await Dexie.getDatabaseNames();
    if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId) return;
    if (!existing.includes(layout.active.corpus)) return;
    const hasBm25 = rag.enableBM25 && existing.includes(layout.active.bm25);
    const runtime: RagRuntimeSnapshot = {
      ...this.captureRagRuntimeSnapshot(), io: new RagRuntimeWorkBarrier(), sourcePolicyIdentity: this.getRagSourcePolicyIdentity(),
      generation: { id: 'legacy-v4', namespace, databases: layout.active,
        contract: { chunkSize: rag.chunkSize, overlap: rag.overlap, tokenizer: TOKENIZER_VERSION, extractor: 4, embedding, bm25Enabled: hasBm25 }, terminal: 'partial' },
      databaseNames: Object.values(layout.active), config: { rag, chat: { ...this.settings.chat } },
      documentCorpus: new IndexedDbDocumentCorpusStore(layout.active.corpus, this.generatedArtifacts.forFeature('rag-corpus')),
      vaultDocumentCorpus: null, vectorStore: null, embeddingProvider: null, vaultIndexer: null,
      ragIndexingScheduler: null, automaticRagRecovery: null,
      bm25Index: hasBm25 ? new IndexedDbBM25Index(layout.active.bm25, this.app.vault.adapter, undefined, { artifactOwnership: this.generatedArtifacts.forFeature('rag-bm25') }) : null,
    };
    try {
      this.observeRagRuntimeSources(runtime);
      this.restoringRagRuntime = runtime;
      this.observeRagRuntimeWork(runtime, 'restoring-corpus', 'files');
      const records = await runtime.documentCorpus!.getFileIndexRecords();
      this.observeRagRuntimeWork(runtime, 'restoring-corpus', 'files', records.length, records.length);
      // 완료 증거가 없는 빈 DB를 완료 0문서로 승격하지 않습니다.
      if (records.length === 0) { this.disposeRagRuntimeSnapshot(runtime); return; }
      try {
        if (runtime.bm25Index) {
          const outcome = await this.startBM25BackgroundLoad(runtime.bm25Index, runtime);
          if (outcome.error) throw outcome.error;
        }
      }
      catch (error) {
        this.recordRagRestoreFailure(error, owner, restoreRunId);
        runtime.bm25Index?.close();
        runtime.bm25Index = null;
        this.getLogger().warn('Legacy lexical worker unavailable; preserving corpus-only search.', { source: 'rag.generation', error });
      }
      this.observeRagRuntimeWork(runtime, 'publishing');
      runtime.ragEngine = new RAGQueryEngine(null, null, runtime.bm25Index ?? undefined, 1, rag.minScore, {
        literalInventorySource: this.createRagLiteralInventorySource(runtime),
        corpusStore: runtime.documentCorpus!,
        getCandidatePaths: async () => new Set((await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)).map((file) => file.path)),
      });
      if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId) { this.disposeRagRuntimeSnapshot(runtime); return; }
      this.restoreRagRuntimeSnapshot(runtime);
      this.refreshActiveArtifactDatabaseNames();
    } catch (error) {
      this.recordRagRestoreFailure(error, owner, restoreRunId);
      this.disposeRagRuntimeSnapshot(runtime);
      throw error;
    }
  }

  private restorePersistedRagGeneration(): Promise<void> {
    if (this.ragManifestRestored) return Promise.resolve();
    if (!this.ragGenerationRestorePromise) {
      this.ragGenerationRestoring = true;
      const owner = {};
      const runId = this.ragRuntimeInitRunId;
      this.ragRestoreOwner = owner;
      this.ragRestoreFailure = null;
      this.beginRagRuntimeWork(owner);
      this.ragGenerationRestorePromise = this.loadPersistedRagGeneration(owner).catch((error: unknown) => {
        this.recordRagRestoreFailure(error, owner, runId);
        throw error;
      }).finally(() => {
        this.endRagRuntimeWork(owner);
        if (this.ragRestoreOwner !== owner) return;
        this.ragRestoreOwner = null;
        this.restoringRagRuntime = null;
        this.ragManifestRestored = true;
        this.ragGenerationRestoring = false;
        this.ragGenerationRestorePromise = null;
      });
    }
    return this.ragGenerationRestorePromise;
  }

  private async loadPersistedRagGeneration(owner: object): Promise<void> {
    const restoreRunId = this.ragRuntimeInitRunId;
    const saved = await this.getRagGenerationManifest().read();
    if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId) return;
    this.ragAutoRecoveryPausedByUser = this.ragAutoRecoveryPausedByUser || saved.pausedByUser;
    this.ragManifestRevision = saved.revision;
    this.lastBuildingGeneration = saved.building;
    this.lastBuildingGenerationSource = 'saved';
    const generation = saved.active;
    if (this.ragEngine) return;
    if (!generation) { await this.restoreLegacyRagGeneration(owner); return; }
    const expected = createRagStorageLayout({
      pluginId: this.manifest?.id ?? 'superpower-inside', vaultIdentity: this.getVaultStorageIdentity(),
      legacyVaultName: this.getVaultName(), embeddingNamespace: generation.contract.embedding,
      indexNamespace: generation.namespace, buildId: generation.id,
    }).active;
    if (Object.entries(expected).some(([key, name]) => generation.databases[key as keyof typeof expected] !== name)) {
      throw new Error('RAG manifest references a foreign storage layout');
    }
    const existingNames = await Dexie.getDatabaseNames();
    if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId) return;
    if (!existingNames.includes(generation.databases.corpus)) {
      throw new Error('RAG completion receipt references missing storage');
    }
    const runtime: RagRuntimeSnapshot = {
      ...this.captureRagRuntimeSnapshot(), io: new RagRuntimeWorkBarrier(), sourcePolicyIdentity: this.getRagSourcePolicyIdentity(), generation, databaseNames: Object.values(generation.databases),
      config: { rag: { ...this.settings.rag, chunkSize: generation.contract.chunkSize, overlap: generation.contract.overlap }, chat: { ...this.settings.chat } },
      documentCorpus: new IndexedDbDocumentCorpusStore(generation.databases.corpus, this.generatedArtifacts.forFeature('rag-corpus')),
      vaultDocumentCorpus: null, vectorStore: null, embeddingProvider: null, vaultIndexer: null,
      ragIndexingScheduler: null, automaticRagRecovery: null,
      bm25Index: generation.contract.bm25Enabled && existingNames.includes(generation.databases.bm25) ? new IndexedDbBM25Index(generation.databases.bm25, this.app.vault.adapter, undefined, { artifactOwnership: this.generatedArtifacts.forFeature('rag-bm25') }) : null,
    };
    try {
      this.observeRagRuntimeSources(runtime);
      this.restoringRagRuntime = runtime;
      this.observeRagRuntimeWork(runtime, 'restoring-corpus', 'files');
      const restoredRecords = await runtime.documentCorpus!.getFileIndexRecords();
      this.observeRagRuntimeWork(runtime, 'restoring-corpus', 'files', restoredRecords.length, restoredRecords.length);
      // 구축 receipt의 count는 이후 증분의 revision seal이 아닙니다. 변경/중단된
      // corpus도 lexical로 보존하되 강한 seal 없이 complete로 재승격하지 않습니다.
      runtime.coverageLimited = true;
      runtime.generation = { ...generation, terminal: 'partial' };
      try {
        if (runtime.bm25Index) {
          const outcome = await this.startBM25BackgroundLoad(runtime.bm25Index, runtime);
          if (outcome.error) throw outcome.error;
        }
      }
      catch (error) {
        this.recordRagRestoreFailure(error, owner, restoreRunId);
        runtime.bm25Index?.close();
        runtime.bm25Index = null;
        runtime.coverageLimited = true;
        runtime.generation = { ...generation, terminal: 'partial' };
        this.getLogger().warn('Stored lexical worker unavailable; preserving limited corpus-only search.', { source: 'rag.generation', error });
      }
      if (!this.ragAutoRecoveryPausedByUser && generation.proof?.seal && generation.contract.vectorMode !== 'memory' &&
          (generation.contract.vectorMode === 'disabled' || generation.contract.embeddingBinding !== undefined)) {
        let vectorProbe: IndexedDbVectorStore | null = null;
        try {
          if (generation.contract.vectorMode === 'indexeddb') {
            if (!existingNames.includes(generation.databases.vector)) throw new Error('rag-runtime-vector-unverified');
            vectorProbe = new IndexedDbVectorStore(generation.databases.vector, { artifactOwnership: this.generatedArtifacts.forFeature('rag-vectors') });
          }
          runtime.vectorStore = vectorProbe;
          await runtime.io!.checkpoint(async (stable) => {
            const policy = this.getRagSourcePolicyIdentity();
            const requireRestore = (): void => {
              if (!stable() || this.ragAutoRecoveryPausedByUser || policy !== this.getRagSourcePolicyIdentity() || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId || this.ragEngine) throw new IndexingCancelledError();
            };
            requireRestore();
            const observed = await this.readRagRuntimeSeal(runtime);
            const stored = generation.proof!.seal!;
            const expected: RagDurabilitySeal = { ...stored, lexical: stored.lexical.state === 'enabled' && observed.lexical.state === 'enabled'
              ? { ...stored.lexical, applied: observed.lexical.applied } : stored.lexical };
            if (!sameRagDurabilitySeal(expected, observed)) return;
            const fresh = await this.collectRagRuntimeProof(runtime, requireRestore, false);
            requireRestore();
            runtime.coverageLimited = false;
            runtime.generation = { ...generation, terminal: fresh.failures.length ? 'partial' : 'complete', proof: fresh };
          });
        } catch {
          runtime.coverageLimited = true;
          this.getLogger().debug('Stored generation receipt unverified; keeping limited lexical serving.', { source: 'rag.generation' });
        } finally { runtime.vectorStore = null; vectorProbe?.close(); }
      }
      this.observeRagRuntimeWork(runtime, 'publishing');
      runtime.ragEngine = new RAGQueryEngine(null, null, runtime.bm25Index ?? undefined, 1, this.settings.rag.minScore, {
        literalInventorySource: this.createRagLiteralInventorySource(runtime),
        corpusStore: runtime.documentCorpus!,
        getCandidatePaths: async () => new Set((await getRagCandidateFiles(this.app.vault, this.settings.rag, this.settings.chat)).map((file) => file.path)),
      });
      if (this.ragRestoreOwner !== owner || this.unloaded || this.ragResetInProgress || this.ragRuntimeInitRunId !== restoreRunId) { this.disposeRagRuntimeSnapshot(runtime); return; }
      if (this.restoreRagRuntimeSnapshot(runtime) && !runtime.coverageLimited && runtime.generation?.proof) {
        this.rememberRagRuntimeProof(runtime, runtime.generation.proof, generation.proof);
      }
      this.refreshActiveArtifactDatabaseNames();
    } catch (error) {
      this.recordRagRestoreFailure(error, owner, restoreRunId);
      this.disposeRagRuntimeSnapshot(runtime);
      throw error;
    }
  }

  private async backfillRagLiteralSources(runtime: RagRuntimeSnapshot): Promise<void> {
    const { documentCorpus: corpus, ragEngine: engine, io } = runtime;
    if (!corpus || !engine || !io) return;
    const source = runtime.vaultDocumentCorpus ??= new VaultDocumentCorpus(this.app.vault, corpus,
      () => this.settings.rag, () => this.settings.chat, this.getLogger(), (file) => this.app.metadataCache?.getFileCache(file));
    if (this.ragEngine === engine) this.vaultDocumentCorpus = source;
    const release = acquireRuntimeLease(engine);
    const ownsWork = !this.ragRuntimeWork;
    if (ownsWork) this.beginRagRuntimeWork(runtime);
    try {
      let updated = 0;
      await io.run(async () => {
        const current = this.captureRagReadCurrentness(runtime);
        const admit = (): boolean => current() && !this.ragAutoRecoveryPausedByUser && this.ragEngine === engine;
        if (!admit()) throw new IndexingCancelledError();
        const result = await source.backfillSourceBodies({ admit, onProgress: (processed) => this.observeRagRuntimeWork(runtime, 'preparing-source', 'files', processed, null) });
        if (!admit()) throw new IndexingCancelledError();
        updated = result.updated;
      });
      if (updated > 0) await this.refreshRagRuntimeCheckpoint(runtime);
    } finally { release(); if (ownsWork) this.settleRagRuntimeWork(runtime); }
  }

  private withRagFinalCoverage(result: IndexingResult, runtime: RagRuntimeSnapshot | null | undefined): IndexingResult {
    return runtime?.generation?.terminal === 'partial'
      ? { ...result, partial: Math.max(result.partial ?? 0, runtime.generation.proof?.failures.length ?? 0, 1) }
      : result;
  }

  private async runVerifiedRagPending(runtime: RagRuntimeSnapshot): Promise<IndexingResult | null> {
    const scheduler = runtime.ragIndexingScheduler;
    if (!scheduler) return null;
    this.requireRagRuntimeWriteCurrent(runtime);
    const result = await scheduler.indexPending();
    this.requireRagRuntimeWriteCurrent(runtime);
    if (!await this.refreshRagRuntimeCheckpoint(runtime)) throw new IndexingCancelledError();
    this.requireRagRuntimeWriteCurrent(runtime);
    return this.withRagFinalCoverage(result, this.activeRagRuntime);
  }

  /** 설정의 업데이트 시작이 사용할 공통 재개 진입점입니다. */
  async startRagUpdate(): Promise<IndexingResult | null> {
    if (this.unloaded || this.ragResetInProgress) return null;
    const active = this.activeRagRuntime;
    const ownerIo = active?.io;
    const requireOwner = (): void => {
      if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser ||
          this.activeRagRuntime !== active || active?.io !== ownerIo) throw new IndexingCancelledError();
    };
    this.ragAutoRecoveryPausedByUser = false;
    const manifest = this.getRagGenerationManifest();
    const state = await manifest.read();
    requireOwner();
    const revision = await manifest.setPaused(state.revision, false);
    requireOwner();
    if (revision === null) throw new IndexingCancelledError();
    this.ragManifestRevision = revision;
    active?.vaultDocumentCorpus?.resume();
    active?.io?.invalidate(); // 명시 재시도는 같은 원문·receipt여도 새 검증을 요구합니다.
    if (active?.vaultIndexer && active.admitsEmbedding?.() !== false && this.matchesRagStorageContract(active)) {
      await this.backfillRagLiteralSources(active);
      this.requireRagRuntimeWriteCurrent(active);
      active.automaticRagRecovery?.resume();
      return this.runVerifiedRagPending(active);
    }
    // 증명 불가능한 legacy binding의 재구축은 명시 업데이트에서만 허용합니다.
    if (active?.generation && !this.matchesRagStorageContract(active)) this.forceRagGenerationBuild = true;
    await this.initRAG();
    if (this.unloaded || this.ragResetInProgress) return null;
    const runtime = this.activeRagRuntime;
    const buildResult = runtime !== active && runtime && this.matchesRagStorageContract(runtime)
      ? runtime.ragIndexingStatus?.lastResult ?? (runtime.generation?.id !== active?.generation?.id ? runtime.lexicalBuildResult : undefined)
      : null;
    if (runtime && this.matchesRagStorageContract(runtime)) await this.backfillRagLiteralSources(runtime);
    if (buildResult) return this.withRagFinalCoverage(buildResult, runtime);
    if (runtime?.ragIndexingScheduler) return this.runVerifiedRagPending(runtime);
    if (runtime?.vaultDocumentCorpus && runtime.documentCorpus && runtime.ragEngine && this.matchesRagStorageContract(runtime)) {
      const release = acquireRuntimeLease(runtime.ragEngine);
      const requireCurrent = (): void => this.requireRagRuntimeWriteCurrent(runtime);
      runtime.coverageLimited = true;
      if (runtime.generation) runtime.generation = { ...runtime.generation, terminal: 'partial' };
      const ownsWork = !this.ragRuntimeWork;
      if (ownsWork) this.beginRagRuntimeWork(runtime);
      try {
        const startedAt = performance.now();
        const writing = async () => {
          requireCurrent();
          runtime.vaultDocumentCorpus!.resume();
          // refresh는 저장 revision이 같은 원문을 다시 읽거나 추출하지 않습니다.
          this.observeRagRuntimeWork(runtime, 'preparing-source');
          const refreshed = await runtime.vaultDocumentCorpus!.refresh();
          requireCurrent();
          this.observeRagRuntimeWork(runtime, 'lexical');
          await runtime.bm25Index?.rebuildFrom(async () => (await runtime.documentCorpus!.getDocuments()).map((document) => {
            const file = this.app.vault.getAbstractFileByPath(document.sourcePath ?? '');
            return file instanceof TFile ? { ...document,
              ...getBM25DocumentFields(file, this.app.metadataCache?.getFileCache(file), document.heading),
            } : document;
          }));
          await runtime.bm25Index?.flush();
          requireCurrent();
          return refreshed;
        };
        const refreshed = await (runtime.io ? runtime.io.run(writing) : writing());
        if (!await this.refreshRagRuntimeCheckpoint(runtime)) throw new IndexingCancelledError();
        requireCurrent();
        return this.withRagFinalCoverage({ ...refreshed, indexed: refreshed.documents.length, vectors: 0,
          durationMs: performance.now() - startedAt }, runtime);
      } finally { release(); if (ownsWork) this.settleRagRuntimeWork(runtime); }
    }
    return null;
  }

  async rebuildRagGeneration(): Promise<IndexingResult> {
    if (this.unloaded || this.ragResetInProgress) throw new RagRuntimeInitializationCancelledError();
    const previous = this.activeRagRuntime;
    this.forceRagGenerationBuild = true;
    await this.initRAG();
    if (this.ragRuntimeInitRunner?.isRunning()) await this.ragRuntimeInitRunner.run();
    if (this.unloaded || this.ragResetInProgress || this.lastRagRuntimeInitError || this.ragAutoRecoveryPausedByUser) throw new RagRuntimeInitializationCancelledError();
    const runtime = this.activeRagRuntime;
    if (!runtime || runtime === previous || !this.matchesRagStorageContract(runtime) || !runtime.generation?.proof) throw new Error('rag-rebuild-result-unavailable');
    const result = runtime.ragIndexingStatus?.lastResult;
    if (result) return this.withRagFinalCoverage(result, runtime);
    if (runtime.generation.terminal !== 'complete') throw new Error('rag-rebuild-result-unavailable');
    return { indexed: 0, vectors: 0, skipped: 0, documents: [], durationMs: 0 };
  }

  private currentRagEmbeddingNamespace(): string {
    const selected = resolveUsableProviderModelRef(this.settings, this.settings.rag.embeddingModelRef ?? '', 'embedding');
    return selected ? createEmbeddingCacheNamespace(`profile:${selected.profile.id}:binding:${selected.profile.embeddingBindingRevision ?? 'unproven'}`, selected.modelId) : 'lexical-baseline';
  }

  private matchesRagStorageContract(runtime: RagRuntimeSnapshot): boolean {
    const contract = runtime.generation?.contract;
    const rag = this.settings.rag;
    const selected = resolveUsableProviderModelRef(this.settings, rag.embeddingModelRef ?? '', 'embedding');
    return !!contract && contract.embeddingBinding === selected?.profile.embeddingBindingRevision && runtime.generation?.namespace === createRagIndexNamespace(rag) && contract.chunkSize === rag.chunkSize && contract.overlap === rag.overlap &&
      contract.tokenizer === TOKENIZER_VERSION && contract.extractor === 5 &&
      contract.bm25Enabled === rag.enableBM25 && contract.embedding === this.currentRagEmbeddingNamespace();
  }

  private ragExecutionConfigKey(config: Pick<SuperpowerInsideSettings, 'rag' | 'chat'>): string {
    const { rag, chat } = config;
    return JSON.stringify([rag.excludePaths, rag.excludeExts, rag.excludeChatFolder, rag.excludeChatFolder ? chat.saveFolder : '',
      rag.minScore, rag.bm25Weight, rag.annEnabled, rag.annClusterCount, rag.annProbeCount, rag.structuralGraphEnabled]);
  }

  private async initRAGRuntime(): Promise<void> {
    if (this.unloaded || this.ragResetInProgress || this.isSelectedLocalModelDeleting()) return;
    this.synchronizeEmbeddingBindings();
    try { await this.restorePersistedRagGeneration(); }
    catch (error) {
      this.getLogger().warn('Stored RAG generation could not be restored; preserving its databases.', { source: 'rag.generation', error });
    }
    if (this.unloaded || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser || this.isSelectedLocalModelDeleting()) return;
    const current = this.activeRagRuntime;
    if (!this.forceRagGenerationBuild && current?.vaultDocumentCorpus && current.admitsEmbedding?.() !== false &&
        this.matchesRagStorageContract(current) && current.config &&
        this.ragExecutionConfigKey(current.config) === this.ragExecutionConfigKey(this.settings)) {
      this.setupAutoUpdate();
      return;
    }
    const hydrate = !this.forceRagGenerationBuild && !!current?.generation && this.matchesRagStorageContract(current);
    // 구 binding의 인증/endpoint를 증명할 수 없으면 과금하는 자동 재구축 대신 lexical을 유지합니다.
    if (!this.forceRagGenerationBuild && current?.generation && current.generation.contract.embedding !== 'lexical-baseline' &&
        !current.generation.contract.embeddingBinding) return;
    this.forceRagGenerationBuild = false;
    const runId =
      (Number.isSafeInteger(this.ragRuntimeInitRunId) ? this.ragRuntimeInitRunId : 0) + 1;
    this.ragRuntimeInitRunId = runId;
    const isCurrentRun = (): boolean => !this.unloaded && !this.ragResetInProgress && this.ragRuntimeInitRunId === runId &&
      !(runtime.localEmbeddingModelId && this.deletingLocalModels?.has(runtime.localEmbeddingModelId));
    const requireCurrentRun = (): void => {
      if (!isCurrentRun()) throw new RagRuntimeInitializationCancelledError();
    };
    const previousRuntime = this.captureRagRuntimeSnapshot();
    let manifestRevision: number | null = null;
    let corpusRefresh = Promise.resolve();
    let corpusFailure: unknown;
    let published = false;
    let committedCutover: { revision: number; seal: RagDurabilitySeal; previous: RagGenerationRecord | null } | null = null;
    previousRuntime.automaticRagRecovery?.suspend();
    previousRuntime.vaultDocumentCorpus?.suspend();
    previousRuntime.ragIndexingScheduler?.cancel();
    this.unregisterRAGEvents();
    this.clearAutoUpdateTimer();
    // indexer가 보관하는 배열을 UI의 직접 수정과 분리합니다. proof는 현재 설정을 검증합니다.
    const indexerConfig = { ...this.settings.rag,
      excludePaths: [...this.settings.rag.excludePaths], excludeExts: [...this.settings.rag.excludeExts],
    };
    Object.freeze(indexerConfig.excludePaths);
    Object.freeze(indexerConfig.excludeExts);
    const runtime: RagRuntimeSnapshot = {
      documentCorpus: null, vaultDocumentCorpus: null, vectorStore: null,
      embeddingProvider: null, bm25Index: null, ragEngine: null, vaultIndexer: null,
      ragIndexingScheduler: null, automaticRagRecovery: null, ragPerformanceGuard: null,
      ragIndexingStatus: null, nextAutoUpdateAt: null,
      lastAutoUpdateSkippedReason: null, lastAutoUpdateResult: null,
      config: { rag: indexerConfig, chat: { ...this.settings.chat } },
      io: new RagRuntimeWorkBarrier(),
      sourcePolicyIdentity: this.getRagSourcePolicyIdentity(),
      coverageLimited: hydrate ? previousRuntime.coverageLimited : false,
      pendingRecoverySourceEvents: new Set([
        ...(previousRuntime.vaultIndexer?.getAutomaticRecoveryInvalidatedPaths?.() ?? []),
        ...(previousRuntime.pendingRecoverySourceEvents ?? []),
      ]),
    };
    this.observeRagRuntimeSources(runtime);
    this.buildingRagRuntime = runtime;
    this.beginRagRuntimeWork(runtime);
    this.refreshBus?.emit('rag', { status: 'partial' });
    this.lastRagRuntimeInitError = null;
    this.lastRagRuntimeInitSkippedReason = null;
    this.lastRagRuntimeInitStage = 'starting';
    this.lastRagRuntimeInitStartedAt = Date.now();
    this.lastRagRuntimeInitFinishedAt = null;

    try {
      const rag = runtime.config!.rag;
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
      if (resolvedEmbeddingModel?.profile.strategy === 'ternlight' &&
          (resolvedEmbeddingModel.modelId === 'ternlight-base' || resolvedEmbeddingModel.modelId === 'embeddinggemma-300m')) {
        runtime.localEmbeddingModelId = resolvedEmbeddingModel.modelId;
      }
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

      const embeddingNamespace = this.currentRagEmbeddingNamespace();
      const buildId = hydrate ? previousRuntime.generation!.id : crypto.randomUUID();
      const storageLayout = createRagStorageLayout({
        pluginId: this.manifest?.id ?? 'superpower-inside',
        vaultIdentity: this.getVaultStorageIdentity(),
        legacyVaultName: this.getVaultName(),
        embeddingNamespace,
        indexNamespace: createRagIndexNamespace(rag),
        buildId,
      });
      runtime.generation = hydrate ? previousRuntime.generation : {
        id: buildId, namespace: createRagIndexNamespace(rag), databases: storageLayout.active,
        contract: { chunkSize: rag.chunkSize, overlap: rag.overlap, tokenizer: TOKENIZER_VERSION, extractor: 5, embedding: embeddingNamespace,
          ...(resolvedEmbeddingModel?.profile.embeddingBindingRevision ? { embeddingBinding: resolvedEmbeddingModel.profile.embeddingBindingRevision } : {}), bm25Enabled: rag.enableBM25,
          vectorMode: resolvedEmbeddingModel ? 'indexeddb' : 'disabled' },
        terminal: 'building',
      };
      const manifest = this.getRagGenerationManifest();
      if (!hydrate) {
        manifestRevision = await manifest.begin((await manifest.read()).revision, runtime.generation!);
        if (manifestRevision === null) throw new RagRuntimeInitializationCancelledError();
        this.ragManifestRevision = manifestRevision;
      } else {
        await previousRuntime.ragIndexingScheduler?.waitForIdle();
      }
      requireCurrentRun();
      runtime.documentCorpus = new IndexedDbDocumentCorpusStore(
        storageLayout.active.corpus,
        this.generatedArtifacts.forFeature('rag-corpus'),
      );
      runtime.databaseNames = Object.values(storageLayout.active);
      this.activeArtifactDatabaseNames = new Set([
        ...(previousRuntime.databaseNames ?? []), ...runtime.databaseNames,
      ]);
      runtime.vaultDocumentCorpus = new VaultDocumentCorpus(
        this.app.vault,
        runtime.documentCorpus,
        () => rag,
        () => runtime.config!.chat,
        this.getLogger(),
        (file) => this.app.metadataCache.getFileCache(file),
        (stage, processed, total) => this.observeRagRuntimeWork(runtime, stage, 'files', processed, total),
      );
      const sourceCorpus = runtime.vaultDocumentCorpus;
      let bm25Index: IndexedDbBM25Index | undefined;
      let bm25LoadOutcome: Promise<BM25BackgroundLoadOutcome> | null = null;
      const finishBuilding = async (): Promise<void> => {
        // Dense 경로는 indexer의 동일 준비 결과로 corpus·BM25를 먼저 저장합니다.
        corpusRefresh = hydrate || runtime.vaultIndexer ? Promise.resolve() : this.runRagRuntimeInitStep('corpus-refresh', async () => {
          const startedAt = performance.now();
          const refreshed = await sourceCorpus.refresh();
          runtime.lexicalBuildResult = { ...refreshed, indexed: refreshed.documents.length, vectors: 0,
            durationMs: performance.now() - startedAt };
        }, null)
          .catch((error: unknown) => { corpusFailure = error; });
        await corpusRefresh;
        if (corpusFailure) throw corpusFailure instanceof Error ? corpusFailure : new Error('Source corpus refresh failed', { cause: corpusFailure });
        requireCurrentRun();
        if (hydrate) {
          const outcome = await bm25LoadOutcome;
          if (outcome?.error) throw outcome.error;
          requireCurrentRun();
          await previousRuntime.io?.waitForIdle();
          await runtime.io!.checkpoint(async (stable) => {
            const policy = this.getRagSourcePolicyIdentity();
            const requireHydrate = (): void => {
              requireCurrentRun();
              if (!stable() || policy !== this.getRagSourcePolicyIdentity() || this.ragAutoRecoveryPausedByUser) throw new RagRuntimeInitializationCancelledError();
            };
            const proof = await this.collectRagRuntimeProof(runtime, requireHydrate, false);
            const state = await manifest.read();
            requireHydrate();
            if (state.active?.id !== runtime.generation!.id) throw new RagRuntimeInitializationCancelledError();
            const revision = await manifest.refreshActive(state.revision, state.active.id, state.active.proof?.seal ?? null, proof);
            if (revision === null) throw new RagRuntimeInitializationCancelledError();
            this.ragManifestRevision = revision;
            requireHydrate();
            runtime.generation = { ...runtime.generation!, terminal: proof.failures.length ? 'partial' : 'complete', proof };
            runtime.coverageLimited = false;
          });
          this.buildingRagRuntime = null;
          published = true;
          try { if (this.restoreRagRuntimeSnapshot(runtime)) this.rememberRagRuntimeProof(runtime, runtime.generation!.proof!); }
          finally { this.refreshActiveArtifactDatabaseNames(); this.disposeRagRuntimeSnapshot(previousRuntime); }
          return;
        }
        if (bm25Index && bm25LoadOutcome) {
          const outcome = await bm25LoadOutcome;
          if (outcome.error) throw outcome.error;
          if (!runtime.vaultIndexer) {
            this.observeRagRuntimeWork(runtime, 'lexical');
            await bm25Index.rebuildFrom(async () => {
            const documents = await runtime.documentCorpus!.getDocuments();
            return documents.map((document) => {
              const file = this.app.vault.getAbstractFileByPath(document.sourcePath ?? '');
              return file instanceof TFile ? {
                ...document,
                ...getBM25DocumentFields(file, this.app.metadataCache.getFileCache(file), document.heading),
              } : document;
            });
          });
          }
        }
        requireCurrentRun();
        if (runtime.ragIndexingScheduler && !this.ragAutoRecoveryPausedByUser) {
          await runtime.ragIndexingScheduler.indexPending();
          await runtime.ragIndexingScheduler.waitForIdle();
        }
        requireCurrentRun();
        if (this.ragAutoRecoveryPausedByUser) throw new RagRuntimeInitializationCancelledError();
        await previousRuntime.ragIndexingScheduler?.waitForIdle?.();
        requireCurrentRun();
        this.observeRagRuntimeWork(runtime, 'waiting');
        await previousRuntime.io?.waitForIdle();
        await runtime.io!.checkpoint(async (stable) => {
          const policy = this.getRagSourcePolicyIdentity();
          const requireCheckpoint = (): void => {
            requireCurrentRun();
            if (!stable() || policy !== this.getRagSourcePolicyIdentity() || this.ragAutoRecoveryPausedByUser) throw new RagRuntimeInitializationCancelledError();
          };
          const proof = await this.collectRagRuntimeProof(runtime, requireCheckpoint, true);
          requireCheckpoint();
          const commit = async (): Promise<number | null> => {
            const state = await manifest.read();
            requireCheckpoint();
            if (state.building?.id !== buildId || state.building.terminal !== 'building' || state.pausedByUser) throw new RagRuntimeInitializationCancelledError();
            const revision = await manifest.commit(state.revision, buildId, proof);
            if (revision !== null) committedCutover = { revision, seal: proof.seal!, previous: state.active };
            return revision;
          };
          const committed = previousRuntime.io && this.ragEngine === previousRuntime.ragEngine && this.activeRagRuntime?.io === previousRuntime.io &&
            !(previousRuntime.localEmbeddingModelId && this.deletingLocalModels?.has(previousRuntime.localEmbeddingModelId))
            ? await previousRuntime.io.checkpoint(commit) : await commit();
          if (committed === null) throw new RagRuntimeInitializationCancelledError();
          this.ragManifestRevision = committed;
          requireCheckpoint();
          runtime.generation = { ...runtime.generation!, terminal: proof.failures.length > 0 ? 'partial' : 'complete', proof };
          runtime.coverageLimited = false;
          this.buildingRagRuntime = null;
          this.lastBuildingGeneration = null;
          published = true;
          try { if (this.restoreRagRuntimeSnapshot(runtime)) this.rememberRagRuntimeProof(runtime, proof); }
          finally {
            this.refreshActiveArtifactDatabaseNames();
            this.disposeRagRuntimeSnapshot(previousRuntime);
          }
        });
      };
      if (rag.enableBM25) {
        const nextBm25Index = new IndexedDbBM25Index(
          storageLayout.active.bm25,
          this.app.vault.adapter,
          undefined,
          { artifactOwnership: this.generatedArtifacts.forFeature('rag-bm25') },
        );
        bm25Index = nextBm25Index;
        runtime.bm25Index = nextBm25Index;
        runtime.ragEngine = new RAGQueryEngine(null, null, nextBm25Index, 1, rag.minScore, {
          literalInventorySource: this.createRagLiteralInventorySource(runtime),
          corpusStore: runtime.documentCorpus,
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
        bm25LoadOutcome = this.startBM25BackgroundLoad(nextBm25Index, runtime);
      }
      runtime.ragEngine ??= new RAGQueryEngine(null, null, undefined, rag.bm25Weight, rag.minScore, {
        literalInventorySource: this.createRagLiteralInventorySource(runtime),
        corpusStore: runtime.documentCorpus,
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
        await finishBuilding();
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
        await finishBuilding();
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
        await finishBuilding();
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
                onPreparationProgress: (processed, total) => this.observeRagRuntimeWork(runtime, 'loading-model', 'steps', processed, total),
              })
            : new TernlightEmbeddingProvider(
                embeddingModel,
                {
                  app: this.app,
                  pluginId: this.manifest.id,
                  pluginVersion: this.manifest.version,
                onPreparationProgress: (processed, total) => this.observeRagRuntimeWork(runtime, 'loading-model', 'steps', processed, total),
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

      const cachedProvider = new CachedEmbeddingProvider(rawProvider, embeddingNamespace, {
        artifactOwnership: this.generatedArtifacts.forFeature('embedding-cache'),
        dbName: storageLayout.active.embeddingCache,
        persistent: profile.strategy !== 'ternlight',
      });
      const trackedProvider = trackRagProviderOperations(cachedProvider, () => {
        this.getLogger().warn('Retired embedding provider drain or close failed.', { source: 'rag.generation' });
      });
      const embeddingProvider = trackedProvider.provider;
      runtime.retireProvider = trackedProvider.retire;
      runtime.clearEmbeddingCache = () => Dexie.delete(storageLayout.active.embeddingCache);
      runtime.embeddingProvider = embeddingProvider;

      const performanceSettings = resolveRagPerformanceSettings(profile.strategy, embeddingModel);
      runtime.ragPerformanceGuard = performanceSettings.enabled
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
            },
          })
        : null;
      const adaptiveBatchSize = performanceSettings.enabled
        ? performanceSettings.maxEmbeddingBatchSize
        : undefined;
      const indexingYieldMs = performanceSettings.enabled ? performanceSettings.indexingYieldMs : 0;

      // Vector store
      const vectorStore = new IndexedDbVectorStore(storageLayout.active.vector, {
        artifactOwnership: this.generatedArtifacts.forFeature('rag-vectors'),
      });
      requireCurrentRun();
      runtime.vectorStore = vectorStore;
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
          runtime.vectorStore,
          runtime.embeddingProvider,
          index,
          rag.bm25Weight,
          rag.minScore,
          {
            literalInventorySource: this.createRagLiteralInventorySource(runtime),
            corpusStore: runtime.documentCorpus ?? undefined,
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
      runtime.ragEngine = createQueryEngine(bm25Index);
      const admissionContract = [profile.id, profile.strategy, profile.baseUrl, profile.apiKey, profile.embeddingBindingRevision, embeddingModel];
      runtime.admitsEmbedding = () => {
        if (runtime.localEmbeddingModelId && this.deletingLocalModels?.has(runtime.localEmbeddingModelId)) return false;
        const selected = resolveUsableProviderModelRef(this.settings, this.settings.rag.embeddingModelRef ?? '', 'embedding');
        return !!selected && selected.profile.enabled &&
          [selected.profile.id, selected.profile.strategy, selected.profile.baseUrl, selected.profile.apiKey, selected.profile.embeddingBindingRevision, selected.modelId]
            .every((value, index) => value === admissionContract[index]);
      };
      runtime.ragEngine.setSemanticSearchAdmission(runtime.admitsEmbedding);
      requireCurrentRun();

      runtime.bm25Index = bm25Index ?? null;

      runtime.vaultIndexer = new VaultIndexer(
        this.app.vault,
        runtime.vectorStore,
        runtime.embeddingProvider,
        rag,
        runtime.config!.chat,
        bm25Index,
        this.getLogger(),
        runtime.vaultDocumentCorpus ?? undefined,
        this.app.metadataCache,
      );
      for (const path of runtime.pendingRecoverySourceEvents ?? []) runtime.vaultIndexer.invalidateAutomaticRecoverySource(path);
      runtime.pendingRecoverySourceEvents?.clear();

      const requireEmbeddingAdmission = (): void => {
        if (runtime.admitsEmbedding?.() === false || this.ragAutoRecoveryPausedByUser ||
            (this.ragEngine !== runtime.ragEngine && this.buildingRagRuntime !== runtime)) {
          throw new IndexingCancelledError();
        }
      };
      runtime.ragIndexingScheduler = new RAGIndexingScheduler({
        debounceMs: 500,
        indexFile: (file, options) => {
          requireEmbeddingAdmission();
          return runtime.io!.run(() => { requireEmbeddingAdmission(); return runtime.vaultIndexer!.indexFile(file, options); });
        },
        removeFile: (filePath) => runtime.io!.run(() => runtime.vaultIndexer!.removeFile(filePath)),
        indexPending: (options) => {
          requireEmbeddingAdmission();
          // Scheduler status callbacks can start a checkpoint synchronously before the writer.
          const tick = options.automaticRecovery ? this.ragAutoIndexTicks?.get(runtime.ragIndexingScheduler!) : undefined;
          const beforeWrite = tick?.beforeWrite;
          if (tick && beforeWrite) {
            // 이 작업의 idle checkpoint가 이미 끝난 복구까지 증명합니다.
            tick.repairNeedsCheckpoint = false;
          }
          const afterGate = beforeWrite?.();
          return runtime.io!.run(() => {
            requireEmbeddingAdmission();
            if (afterGate) {
              if (options.isCurrent?.() === false) throw new IndexingCancelledError();
              afterGate();
            }
            return runtime.vaultIndexer!.indexPending(options.automaticRecovery ? {
              ...options,
              isCurrent: () => options.isCurrent?.() !== false && this.matchesRagIndexerSourcePolicy(runtime),
            } : options);
          });
        },
        reindexAll: (options) => {
          requireEmbeddingAdmission();
          return runtime.io!.run(() => { requireEmbeddingAdmission(); return runtime.vaultIndexer!.reindexAll(options); });
        },
        createIndexingOptions: (signal) => ({
          signal,
          maxEmbeddingBatchSize: runtime.ragPerformanceGuard?.getBatchSize() ?? adaptiveBatchSize,
          indexingYieldMs: runtime.ragPerformanceGuard?.getYieldMs() ?? indexingYieldMs,
          getMaxEmbeddingBatchSize: () =>
            runtime.ragPerformanceGuard?.getBatchSize() ?? adaptiveBatchSize,
          getIndexingYieldMs: () => runtime.ragPerformanceGuard?.getYieldMs() ?? indexingYieldMs,
          onBatchComplete: async (durationMs, batchSize) => {
            runtime.ragPerformanceGuard?.recordBatchDuration(durationMs, batchSize);
            const eventLoopLagMs = await runtime.ragPerformanceGuard?.measureEventLoopLag();
            const guardState = runtime.ragPerformanceGuard?.getState();
            this.getLogger().debug('RAG embedding batch completed.', {
              source: 'rag.indexing',
              data: {
                durationMs: Math.round(durationMs),
                batchSize,
                guardState: guardState?.mode ?? 'normal',
                eventLoopLagMs,
                nextBatchSize: guardState?.currentBatchSize ?? adaptiveBatchSize,
                yieldMs: guardState?.currentYieldMs ?? 0,
              },
            });
          },
          getPerformanceGuardState: () => runtime.ragPerformanceGuard?.getState() ?? null,
          onProgress: (progress) => {
            const stage = progress.stage === 'settled' ? 'waiting' : progress.stage === 'embedding' ? 'embedding' : progress.stage === 'lexical' ? 'lexical' : progress.stage === 'committing' ? 'saving-vectors' : 'preparing-source';
            this.observeRagRuntimeWork(runtime, stage, stage === 'embedding' ? 'documents' : 'steps', stage === 'embedding' ? progress.currentFileEmbeddedChunks : null, stage === 'embedding' ? progress.currentFileTotalChunks : null);
          },
        }),
        getPerformanceGuardState: () => runtime.ragPerformanceGuard?.getState() ?? null,
        resumePerformanceGuard: (force) =>
          force
            ? (runtime.ragPerformanceGuard?.forceResume() ?? null)
            : (runtime.ragPerformanceGuard?.resume() ?? null),
        onStatusChange: (status) => {
          const wasRunning = runtime.ragIndexingStatus?.running === true;
          const previousPhase = runtime.ragIndexingStatus?.phase;
          runtime.ragIndexingStatus = status;
          if (status.running) {
            if (!this.ragRuntimeWork && !this.unloaded && !this.ragAutoRecoveryPausedByUser && this.ragEngine === runtime.ragEngine) {
              this.beginRagRuntimeWork(runtime);
              this.observeRagRuntimeWork(runtime, 'planning');
            }
            if (status.phase === 'paused' && previousPhase !== 'paused') this.observeRagRuntimeWork(runtime, 'waiting');
          }
          if (this.buildingRagRuntime === runtime && isCurrentRun()) this.refreshBus?.emit('rag', { status: 'partial' });
          if (!this.unloaded && this.ragEngine === runtime.ragEngine) {
            this.handleRagIndexingStatusChange(status);
            if (wasRunning && !status.running) void this.refreshRagRuntimeCheckpoint(runtime).catch(() => {
              this.getLogger().debug('Active RAG checkpoint remains unverified.', { source: 'rag.generation' });
            });
          }
        },
      });

      const scheduler = runtime.ragIndexingScheduler;
      scheduler.reindexAll = () => this.rebuildRagGeneration();
      const ragConfig = rag;
      const chatConfig = runtime.config!.chat;
      const listAutomaticRecoveryFiles = () => {
        const manifest = getRagIndexingManifest(this.app.vault, ragConfig, chatConfig);
        const files = [...manifest.candidates, ...manifest.failures.map(({ file }) => file)];
        const snapshots = files.map((file) => ({
          path: file.path,
          mtime: file.stat.mtime,
          size: file.stat.size,
        }));
        const eligible = selectAutomaticRecoveryEligibleFiles(snapshots);
        if (!eligible) throw new Error('Rust automatic RAG recovery eligibility planning failed');
        return Promise.resolve(eligible);
      };
      const listRagCandidateFilePaths = async () => {
        const files = await getRagCandidateFiles(this.app.vault, ragConfig, chatConfig);
        return files.map((file) => file.path);
      };
      // 자동 실행·coverage debt·유지보수는 같은 Native partial admission을 소비합니다.
      const readAutomaticRecoveryPendingState = (repair = true) => this.readAutomaticRecoveryPendingState(runtime, repair);
      const countAutomaticRecoveryPendingDocuments = async () => (await readAutomaticRecoveryPendingState()).pendingDocumentCount;
      runtime.automaticRagRecovery = new AutomaticRagRecoveryCoordinator({
        listCandidateFiles: listAutomaticRecoveryFiles,
        readCompletedFingerprint: () =>
          vectorStore.getMetaValue<string>(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY),
        writeCompletedFingerprint: async (fingerprint) => {
          if (await vectorStore.getMetaValue<string>(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY) === fingerprint) return;
          this.requireRagRuntimeWriteCurrent(runtime);
          await runtime.io!.run(() => {
            this.requireRagRuntimeWriteCurrent(runtime);
            return vectorStore.setMetaValue(AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY, fingerprint);
          });
          void this.refreshRagRuntimeCheckpoint(runtime);
        },
        runPending: async () => {
          await scheduler.indexPending({ automaticRecovery: true });
        },
        waitForIdle: () => scheduler.waitForIdle(),
        countPendingDocuments: () => this.readRagRuntimeWithRepair(runtime, () => readAutomaticRecoveryPendingState(false)),
        runHealthyMaintenance: async (fingerprint, force, isCancelled) => {
          await scheduler.waitForIdle();
          this.requireRagRuntimeWriteCurrent(runtime);
          if (isCancelled()) throw new IndexingCancelledError();
          const readMaintenanceState = async () => JSON.stringify(await Promise.all([
            runtime.documentCorpus!.getDurabilityReceipt(), bm25Index?.getCheckpoint(), vectorStore.getDurabilityCheckpoint(),
          ]));
          const before = await readMaintenanceState();
          this.requireRagRuntimeWriteCurrent(runtime);
          if (isCancelled()) throw new IndexingCancelledError();
          // 무변이 admission도 진행 중 검증을 무효화하므로 진입 직전에 기록합니다.
          const interruptedCheckpoint = this.ragCheckpointRuns?.has(runtime.io!) === true;
          await runtime.io!.run(async () => {
          this.requireRagRuntimeWriteCurrent(runtime);
          if (isCancelled()) throw new IndexingCancelledError();
          // 중단된 쓰기 원장은 내구 요청 등록 후 재색인·삭제로 복구한다.
          const indexer = runtime.vaultIndexer;
          if (indexer) {
            const isCurrent = this.captureRagReadCurrentness(runtime);
            const requireCurrent = () => {
              this.requireRagRuntimeWriteCurrent(runtime);
              if (isCancelled() || !isCurrent()) throw new IndexingCancelledError();
            };
            const pendingWrites = await indexer.listPendingWriteRecovery();
            requireCurrent();
            const pendingState = await readAutomaticRecoveryPendingState();
            requireCurrent();
            if (pendingWrites.length > 0) {
              const deferred = new Set(pendingState.deferredPaths);
              await recoverPendingFileWrites(
                pendingWrites.filter((path) => !deferred.has(path)),
                createPendingWriteRecoveryHost(
                  this.app.vault,
                  ragConfig,
                  chatConfig,
                  (file) => { requireCurrent(); scheduler.scheduleFile(file, 'auto'); },
                  (path) => { requireCurrent(); return indexer.removeFile(path); },
                  getRagIndexingManifest(this.app.vault, ragConfig, chatConfig),
                ),
              );
              requireCurrent();
            }
            if (pendingState.pendingDocumentCount > 0) return;
          }
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
              yieldToHost: () => this.waitForRagBackgroundCapacity(),
            },
            fingerprint,
            force,
            isCancelled,
          );
          });
          if (before !== await readMaintenanceState() || interruptedCheckpoint) void this.refreshRagRuntimeCheckpoint(runtime);
        },
        timer: createWindowAutomaticRagRecoveryTimer(),
        onEvent: (event, detail) => this.logAutomaticRagRecoveryEvent(event, detail),
      });

      await finishBuilding();
      await this.startAutomaticRagRecovery();
      requireCurrentRun();
      this.getLogger().info('RAG runtime initialization completed.', {
        source: 'rag',
        data: {
          hasVectorStore: runtime.vectorStore !== null,
          bm25Enabled: runtime.bm25Index !== null,
          bm25Ready: runtime.bm25Index?.isReady ?? false,
        },
      });
      this.lastRagRuntimeInitError = null;
      this.lastRagRuntimeInitSkippedReason = null;
      this.lastRagRuntimeInitStage = null;
      this.lastRagRuntimeInitFinishedAt = Date.now();
    } catch (err) {
      if (published) {
        this.lastRagRuntimeInitError = err instanceof Error ? err.message : 'Post-cutover setup failed';
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().warn('Post-cutover background setup failed; retaining the committed active generation.', { source: 'rag.generation', error: err });
        return;
      }
      if (committedCutover && !this.unloaded && !this.ragResetInProgress) {
        const manifest = this.getRagGenerationManifest();
        const cutover = committedCutover as { revision: number; seal: RagDurabilitySeal; previous: RagGenerationRecord | null };
        const admit = (): boolean => !this.unloaded && !this.ragResetInProgress && this.ragEngine === previousRuntime.ragEngine &&
          this.activeRagRuntime?.io === previousRuntime.io && !(previousRuntime.localEmbeddingModelId && this.deletingLocalModels?.has(previousRuntime.localEmbeddingModelId));
        const prior = cutover.previous && this.getRagGenerationSnapshot().coverage !== 'complete'
          ? { ...cutover.previous, terminal: 'partial' as const } : cutover.previous;
        const restored = await manifest.rollbackCommittedActive(cutover.revision, runtime.generation!.id, cutover.seal, prior, admit);
        if (restored !== null) {
          this.ragManifestRevision = restored;
          this.lastRagRuntimeInitError = 'rag-generation-cutover-invalidated';
          this.lastBuildingGeneration = { ...runtime.generation!, terminal: err instanceof RagRuntimeInitializationCancelledError || isIndexingCancelledError(err) ? 'cancelled' : 'failed' };
          this.lastBuildingGenerationSource = 'live';
        } else if (admit()) {
          previousRuntime.coverageLimited = true;
          if (this.activeRagRuntime) this.activeRagRuntime.coverageLimited = true;
          this.ragManifestRestored = false;
        }
      }
      if (hydrate && runtime.generation && isCurrentRun() && !(err instanceof RagRuntimeInitializationCancelledError) && !isIndexingCancelledError(err)) {
        this.lastBuildingGeneration = { ...runtime.generation, terminal: 'failed' };
        this.lastBuildingGenerationSource = 'live';
      }
      if (manifestRevision !== null && runtime.generation && !committedCutover) {
        const manifest = this.getRagGenerationManifest();
        const stopped = await manifest.stop((await manifest.read()).revision, runtime.generation.id,
          err instanceof RagRuntimeInitializationCancelledError || isIndexingCancelledError(err) ? 'cancelled' : 'failed', this.ragAutoRecoveryPausedByUser);
        if (stopped !== null) {
          this.ragManifestRevision = stopped;
          this.lastBuildingGeneration = { ...runtime.generation, terminal: err instanceof RagRuntimeInitializationCancelledError || isIndexingCancelledError(err) ? 'cancelled' : 'failed' };
          this.lastBuildingGenerationSource = 'live';
        }
      }
      runtime.vaultDocumentCorpus?.suspend();
      runtime.ragIndexingScheduler?.cancel();
      await corpusRefresh;
      this.observeRagRuntimeWork(runtime, 'cleanup');
      await runtime.ragIndexingScheduler?.waitForIdle();
      if (this.buildingRagRuntime === runtime) this.buildingRagRuntime = null;
      this.disposeRagRuntimeSnapshot(runtime);
      if (previousRuntime.io && this.activeRagRuntime?.io === previousRuntime.io) {
        previousRuntime.generation = this.activeRagRuntime.generation;
        previousRuntime.coverageLimited = this.activeRagRuntime.coverageLimited;
        previousRuntime.sourcePolicyIdentity = this.activeRagRuntime.sourcePolicyIdentity;
      }
      const restored = !this.unloaded && this.ragEngine === previousRuntime.ragEngine && this.restoreRagRuntimeSnapshot(previousRuntime);
      if (!this.ragEngine) this.ragManifestRestored = false;
      if (err instanceof RagRuntimeInitializationCancelledError || isIndexingCancelledError(err) || !isCurrentRun()) {
        this.lastRagRuntimeInitStage = null;
        this.lastRagRuntimeInitFinishedAt = Date.now();
        this.getLogger().debug('RAG runtime initialization stopped because ownership changed.', {
          source: 'rag',
          data: { runId },
        });
        return;
      }
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
    } finally { this.settleRagRuntimeWork(runtime); }
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
        if (
          !progress.eta ||
          progress.eta.remainingMs === null ||
          progress.eta.confidence === 'calculating' ||
          progress.eta.confidence === 'low'
        ) {
          return t('ragIndexingRunningEtaCalculating', {
            phase,
            completed: String(completed),
            total: String(progress.totalFiles),
          });
        }
        return t('ragIndexingRunningWithEta', {
          phase,
          completed: String(completed),
          total: String(progress.totalFiles),
          eta: formatRagEtaDuration(progress.eta.remainingMs),
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
    const previousResult = this.ragIndexingStatus?.lastResult;
    this.ragIndexingStatus = status;
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
      if (
        !this.ragAutoRecoveryPausedByUser &&
        status.lastResult &&
        status.lastResult !== previousResult
      ) {
        this.automaticRagRecovery?.resume();
      }
      this.debouncedRefreshStats();
    }
  }

  private formatRagIndexingPhase(
    phase: RagIndexingSchedulerStatus['phase'],
    progress?: RagIndexingSchedulerStatus['progress'],
  ): string {
    if (phase === 'paused') return t('ragPerformancePaused');
    if (progress?.sourcePageCount)
      return t('ragSourcePageProgress', {
        page: String(progress.sourcePage ?? 0),
        total: String(progress.sourcePageCount),
      });
    const phaseLabel =
      phase === 'preparing'
        ? t('ragPhasePreparing')
        : phase === 'file'
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

  private clearRAG(options: { dispose?: boolean; cancelBuilding?: boolean } = {}): void {
    const runtime = options.dispose === false ? null : this.captureRagRuntimeSnapshot();
    if (options.cancelBuilding !== false) this.cancelRagIndexing();
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
    this.activeRagRuntime = null;
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
    this.metadataCleanup?.();
    this.metadataCleanup = null;
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
    const runtime = this.captureRagRuntimeSnapshot();
    const isCurrent = () => this.ragEngine === runtime.ragEngine;
    const excludePaths = getEffectiveExcludePaths(
      this.settings.rag,
      this.settings.chat,
      this.app.vault.configDir,
    );
    const indexer = {
      indexFile: async (file: TFile): Promise<void> => {
        if (!isCurrent()) return;
        const release = runtime.ragEngine ? acquireRuntimeLease(runtime.ragEngine) : () => undefined;
        try {
          const writing = () => this.indexBM25File(runtime.bm25Index ?? undefined, file, runtime);
          await (runtime.io ? runtime.io.run(writing) : writing());
          if (isCurrent()) {
            scheduler?.scheduleFile(file, 'modify');
            void this.refreshRagRuntimeCheckpoint(runtime);
          }
        } finally { release(); }
      },
      removeByFilePath: async (path: string): Promise<number> => {
        if (!isCurrent()) return 0;
        const release = runtime.ragEngine ? acquireRuntimeLease(runtime.ragEngine) : () => undefined;
        try {
          const writing = () => this.removeBM25File(runtime.bm25Index ?? undefined, path, runtime);
          await (runtime.io ? runtime.io.run(writing) : writing());
          if (!isCurrent()) return 0;
          this.debouncedRefreshStats();
          const removed = await scheduler?.deleteFile(path) ?? 0;
          void this.refreshRagRuntimeCheckpoint(runtime);
          return removed;
        } finally { release(); }
      },
    };
    if (typeof this.app.metadataCache?.on === 'function') {
      const ref = this.app.metadataCache.on('changed', (file) => {
        void Promise.resolve().then(async () => {
          if (isRagFileMetadataExcluded(this.app.vault, file, this.settings.rag, this.settings.chat)) return;
          await indexer.indexFile(file);
        }).catch(() => this.getLogger().debug('Metadata source update remains unverified.', { source: 'rag.generation' }));
      });
      this.metadataCleanup = () => this.app.metadataCache.offref(ref);
    }
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
    const runtime = this.captureRagRuntimeSnapshot();
    const io = runtime.io!;
    const stopIfRuntimeChanged = (): boolean => {
      const changed =
        this.unloaded ||
        this.activeRagRuntime?.io !== io ||
        this.ragEngine !== runtime.ragEngine ||
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
    const isBlocked = () => this.ragResetInProgress || this.ragAutoRecoveryPausedByUser ||
      this.ragCheckpointRuns?.has(io) || this.ragGenerationRestorePromise || this.buildingRagRuntime;
    const policyMatchesIndexer = () => this.matchesRagIndexerSourcePolicy(runtime);
    const ticks = this.ragAutoIndexTicks ??= new WeakMap();
    if (isBlocked() || !policyMatchesIndexer() || ticks.has(scheduler)) return;
    await performanceGuard?.measureEventLoopLag();
    if (stopIfRuntimeChanged() || isBlocked() || !policyMatchesIndexer() || ticks.has(scheduler)) return;
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
    // 대상 확인 단계는 숨기고, 실제 재색인 대상이 있을 때만 scheduler가 running을 표시합니다.
    const signal = scheduler.beginPreparation({ publishStatus: false });
    const tick: RagAutoIndexTick = {};
    ticks.set(scheduler, tick);
    const requireTickCurrent = () => {
      if (signal?.aborted || stopIfRuntimeChanged() || isBlocked() || !policyMatchesIndexer()) throw new IndexingCancelledError();
      this.requireRagRuntimeWriteCurrent(runtime);
    };
    const requireProbeAdmission = () => {
      requireTickCurrent();
      if (this.isRagIndexing()) throw new IndexingCancelledError();
    };
    let observedCurrent: (() => boolean) | undefined;
    try {
      const pending = await this.readRagRuntimeWithRepair(runtime, () => {
        observedCurrent = this.captureRagReadCurrentness(runtime);
        return this.readAutomaticRecoveryPendingState(runtime, false, signal);
      }, requireProbeAdmission);
      requireProbeAdmission();
      if (!observedCurrent?.()) return;
      if (pending.actionableDocumentCount === 0) {
        this.lastAutoUpdateSkippedReason = t('ragAutoUpdateNoTargets');
        this.getLogger().debug('Auto RAG indexing skipped because no documents need updates.', {
          source: 'rag.auto',
        });
        this.refreshBus?.emit('rag', { status: 'success', detail: t('ragAutoUpdateNoTargets') });
        return;
      }
      this.getLogger().info('Auto RAG indexing started.', {
        source: 'rag.auto',
        data: { updateRequired: pending.actionableDocumentCount },
      });
      requireProbeAdmission();
      if (!observedCurrent()) return;
      tick.beforeWrite = () => {
        requireTickCurrent();
        if (observedCurrent && !observedCurrent()) throw new IndexingCancelledError();
        // 자기 writer admission은 관측 epoch를 올리므로 gate 뒤와 작업 재개 시 재사용하지 않습니다.
        observedCurrent = undefined;
        return requireTickCurrent;
      };
      const work = scheduler.indexPending({ automaticRecovery: true });
      if (!signal?.aborted && !isBlocked()) new Notice(t('autoUpdateIndexingStarted'));
      const result = await work;
      if (signal?.aborted || stopIfRuntimeChanged() || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser) return;
      this.lastAutoUpdateResult = result;
      this.lastAutoUpdateSkippedReason = null;
      this.getLogger().notice('Auto RAG indexing completed.', {
        source: 'rag.auto',
        data: { indexed: result.indexed, vectors: result.vectors, skipped: result.skipped },
      });
      if (result.indexed > 0) {
        new Notice(`${result.indexed}${t('autoUpdateIndexingDone')}`);
      }
    } catch (err) {
      if (signal?.aborted || stopIfRuntimeChanged() || this.ragResetInProgress || this.ragAutoRecoveryPausedByUser) return;
      if (isIndexingCancelledError(err)) {
        if (isBlocked()) return;
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
    } finally {
      ticks.delete(scheduler);
      scheduler.endPreparation(signal);
      // 배치가 scheduler의 writer 진입점에 도달하지 않았다면 복구 자체의 증명을 요청합니다.
      if (tick.repairNeedsCheckpoint) void this.refreshRagRuntimeCheckpoint(runtime);
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
        if (!server.command && !server.url) {
          throw new Error('Command is required for stdio transport');
        }

        const effectivePath =
          this.settings.mcpPath || (typeof process !== 'undefined' ? process.env.PATH : '') || '';
        const env: Record<string, string> = {
          ...(server.env || {}),
          PATH: server.env?.PATH || effectivePath,
        };

        const token = server.authTokenSecret
          ? readSecretStorage(this.app)?.getSecret(server.authTokenSecret)
          : undefined;
        if (server.authTokenSecret && !token) throw new Error(t('mcpAuthSecretMissing'));
        await client.connect({ ...server, env: server.url ? undefined : env }, token ?? undefined);

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

  /**
   * 색인 검색 화면이 쓰는 포트. 색인 저장소·하이브리드 후보·리비전 reader는
   * chat과 같은 factory(src/search/indexed-search-deps.ts)에서 만든다.
   */
  getSearchPort(): SearchPort | null {
    const port = createPluginSearchPort({
      app: this.app,
      ragEngine: this.ragEngine,
      documentCorpus: this.documentCorpus,
      acquireSnapshot: () => this.acquireRagSearchSnapshot(),
      settings: this.settings,
      getCurrentSettings: () => this.settings,
      isIndexing: () => this.isRagSearching(),
      getCandidateCount: () => this.getRagRuntimeState().ragStatus?.totalDocuments,
    });
    return async (request) => {
      await this.prepareRagForChat();
      return port(request);
    };
  }

  private async openSearchView(): Promise<void> {
    const workspace = this.app.workspace;
    const leaves = workspace.getLeavesOfType(SEARCH_VIEW_TYPE);
    if (leaves.length > 0) {
      void workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: SEARCH_VIEW_TYPE, active: true });
    void workspace.revealLeaf(leaf);
  }

  private async openChatView(): Promise<void> {
    const workspace = this.app.workspace;
    const chatLeaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    const activeChatView = workspace.getActiveViewOfType(ChatView);
    const contextLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    const existingLeaf =
      (activeChatView ? chatLeaves.find((leaf) => leaf.view === activeChatView) : undefined) ??
      (contextLeaf ? chatLeaves.find((leaf) => leaf.parent === contextLeaf.parent) : chatLeaves[0]);
    if (existingLeaf) {
      void workspace.revealLeaf(existingLeaf);
      return;
    }
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    void workspace.revealLeaf(leaf);
  }




}
