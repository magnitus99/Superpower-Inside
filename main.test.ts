import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { createFakeSecretStorage } from './src/test/secret-storage';
import type { RagStatusSummary } from './src/rag/status';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = 'md';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  class MockTFolder {
    path = '';
    name = '';
    children: unknown[] = [];
  }
  class ChainableSetting {
    setName(): this {
      return this;
    }
    setDesc(): this {
      return this;
    }
    addText(): this {
      return this;
    }
    addToggle(): this {
      return this;
    }
    addButton(): this {
      return this;
    }
    addDropdown(): this {
      return this;
    }
    addSlider(): this {
      return this;
    }
  }

  return {
    App: class {},
    Component: class {},
    Editor: class {},
    ItemView: class {},
    MarkdownRenderer: { renderMarkdown: vi.fn() },
    Modal: class {},
    Notice: class {},
    Platform: { isDesktopApp: true },
    Plugin: class {},
    PluginSettingTab: class {},
    Setting: ChainableSetting,
    TFile: MockTFile,
    TFolder: MockTFolder,
    WorkspaceLeaf: class {},
    getLanguage: () => 'en',
    requestUrl: vi.fn(),
  };
});

describe('SuperpowerInsidePlugin RAG runtime', () => {
  it.each([false, true])(
    '중단된 자동 복구는 새 색인이 성공한 뒤에만 유지보수를 재개한다 (성공=%s)',
    async (completed) => {
      const { default: SuperpowerInsidePlugin } = await import('./main.ts');
      const previousResult = { indexed: 1, vectors: 1 };
      const resume = vi.fn();
      const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
      Object.assign(runtime, {
        ragIndexingStatus: { running: true, lastResult: previousResult },
        automaticRagRecovery: { resume },
        getLogger: () => ({ debug: vi.fn() }),
        refreshBus: { emit: vi.fn() },
        debouncedRefreshStats: vi.fn(),
      });
      (
        runtime as unknown as { handleRagIndexingStatusChange(status: object): void }
      ).handleRagIndexingStatusChange({
        running: false,
        phase: 'idle',
        queuedFiles: 0,
        progress: null,
        lastResult: completed ? { indexed: 2, vectors: 2 } : previousResult,
      });
      expect(resume).toHaveBeenCalledTimes(completed ? 1 : 0);
    },
  );

  it('사용자 중단은 런타임 재초기화 뒤에도 자동 복구를 시작하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const start = vi.fn(() => Promise.resolve());
    const suspend = vi.fn();
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      ragAutoRecoveryPausedByUser: true,
      automaticRagRecovery: { start, suspend },
    });
    const restart = runtime as unknown as { startAutomaticRagRecovery(): Promise<void> };
    await restart.startAutomaticRagRecovery();
    expect(start).not.toHaveBeenCalled();
    expect(suspend).toHaveBeenCalledOnce();
    Object.assign(runtime, { ragAutoRecoveryPausedByUser: false });
    await restart.startAutomaticRagRecovery();
    expect(start).toHaveBeenCalledOnce();
  });

  it('명시적 재개는 사용자 중단을 풀고 자동 복구를 다시 시작한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const resume = vi.fn();
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      ragAutoRecoveryPausedByUser: true,
      automaticRagRecovery: { resume },
      ragIndexingScheduler: { resumeNow: () => false },
      refreshBus: { emit: vi.fn() },
    });
    expect(runtime.resumeRagIndexing()).toBe(false);
    expect(
      (runtime as unknown as { ragAutoRecoveryPausedByUser: boolean }).ragAutoRecoveryPausedByUser,
    ).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
  });

  it('사용자 중단은 자동 복구를 멈추고 완료된 색인으로 재개하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const resume = vi.fn();
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      ragAutoRecoveryPausedByUser: true,
      ragIndexingStatus: { running: true, lastResult: { indexed: 1, vectors: 1 } },
      automaticRagRecovery: { resume },
      getLogger: () => ({ debug: vi.fn() }),
      refreshBus: { emit: vi.fn() },
      debouncedRefreshStats: vi.fn(),
    });
    (
      runtime as unknown as { handleRagIndexingStatusChange(status: object): void }
    ).handleRagIndexingStatusChange({
      running: false,
      phase: 'idle',
      queuedFiles: 0,
      progress: null,
      lastResult: { indexed: 2, vectors: 2 },
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it('사용자 중단 버튼은 자동 복구 일시정지를 기록한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const suspend = vi.fn();
    const cancel = vi.fn();
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      automaticRagRecovery: { suspend },
      ragIndexingScheduler: { cancel },
      ragIndexAbortController: null,
    });
    runtime.cancelRagIndexing({ byUser: true });
    expect(
      (runtime as unknown as { ragAutoRecoveryPausedByUser: boolean }).ragAutoRecoveryPausedByUser,
    ).toBe(true);
    expect(suspend).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('자동 인덱싱 준비 중 취소하면 늦은 상태 계산 뒤 작업을 시작하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { RAGIndexingScheduler } = await import('./src/rag/indexing-scheduler');
    let finish = (): void => undefined;
    const records = new Promise<[]>((resolve) => {
      finish = () => resolve([]);
    });
    const indexPending = vi.fn(() =>
      Promise.resolve({ indexed: 0, vectors: 0, skipped: 0, documents: [], errors: [] }),
    );
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: indexPending,
      removeFile: () => Promise.resolve(0),
      indexPending,
      reindexAll: indexPending,
    });
    const getFileIndexRecords = vi.fn(() => records);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    const automaticRecovery = { suspend: vi.fn() };
    Object.assign(runtime, {
      app: createApp(),
      settings: DEFAULT_SETTINGS,
      unloaded: false,
      vectorStore: { getFileIndexRecords },
      vaultIndexer: {},
      ragIndexingScheduler: scheduler,
      ragPerformanceGuard: null,
      ragIndexAbortController: null,
      automaticRagRecovery: automaticRecovery,
      getLogger: () => logger,
    });
    const run = (runtime as unknown as { autoIndex(): Promise<void> }).autoIndex();
    await vi.waitFor(() => expect(getFileIndexRecords).toHaveBeenCalledOnce());
    runtime.cancelRagIndexing();
    expect(automaticRecovery.suspend).toHaveBeenCalledOnce();
    expect(runtime.isRagIndexing()).toBe(false);
    Object.assign(runtime, { lastAutoUpdateSkippedReason: 'newer-operation' });
    finish();
    await run;
    expect(indexPending).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(runtime.getRagRuntimeState().lastAutoUpdateSkippedReason).toBe('newer-operation');
  });

  it('대상이 없는 자동 인덱싱 tick은 running 상태나 재색인을 시작하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { RAGIndexingScheduler } = await import('./src/rag/indexing-scheduler');
    const file = {
      path: 'clean.md',
      name: 'clean.md',
      basename: 'clean',
      extension: 'md',
      stat: { ctime: 1000, mtime: 1000, size: 1 },
    } as TFile;
    const indexPending = vi.fn(() =>
      Promise.resolve({ indexed: 0, vectors: 0, skipped: 0, documents: [], errors: [] }),
    );
    const statuses: Array<{ running: boolean }> = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: indexPending,
      removeFile: () => Promise.resolve(0),
      indexPending,
      reindexAll: indexPending,
      onStatusChange: (status) => statuses.push(status),
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      app: createApp({ files: [file], contents: new Map([['clean.md', 'x']]) }),
      settings: DEFAULT_SETTINGS,
      unloaded: false,
      vectorStore: {
        getFileIndexRecords: vi.fn(() =>
          Promise.resolve([
            {
              filePath: file.path,
              sourceMtime: file.stat.mtime,
              sourceSize: file.stat.size,
              contentHash: 'hash',
              indexedAt: 1,
              embeddingProvider: DEFAULT_SETTINGS.rag.embeddingProvider,
              embeddingModel: DEFAULT_SETTINGS.rag.embeddingModel,
              hasCompleteMetadata: true,
              vectorCount: 1,
              updated: 1,
            },
          ]),
        ),
      },
      vaultIndexer: {},
      ragIndexingScheduler: scheduler,
      ragPerformanceGuard: null,
      ragIndexAbortController: null,
      getLogger: () => logger,
    });

    await (runtime as unknown as { autoIndex(): Promise<void> }).autoIndex();

    expect(indexPending).not.toHaveBeenCalled();
    expect(statuses.some((status) => status.running)).toBe(false);
    expect(runtime.isRagIndexing()).toBe(false);
  });

  it('RAG 검색 준비는 corpus busy와 pending 색인 통계를 동기화한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    const status: RagStatusSummary = {
      totalDocuments: 2,
      healthyDocuments: 2,
      missingDocuments: 0,
      staleDocuments: 0,
      unknownDocuments: 0,
      excludedDocuments: 0,
      totalVectors: 2,
      lastCalculatedAt: 1,
      updateRequiredDocuments: [],
    };
    Object.assign(plugin, {
      settings: { rag: { enableBM25: true } },
      ragEngine: {},
      ragRuntimeInitRunner: null,
      lastRagRuntimeInitError: null,
      lastRagRuntimeInitSkippedReason: null,
      bm25Index: { isReady: true },
      ragIndexAbortController: null,
      ragIndexingScheduler: { isRunning: () => false },
      vaultDocumentCorpus: { isBusy: () => false },
      eventDrivenRagStats: status,
    });

    expect(plugin.getRetrievalReadiness()).toBe('ready');
    Object.assign(plugin, {
      eventDrivenRagStats: {
        ...status,
        updateRequiredDocuments: [
          { path: 'synthetic.md', status: 'stale', reason: 'synthetic', mtime: 1, size: 1 },
        ],
      },
    });
    expect(plugin.getRetrievalReadiness()).toBe('preparing');
    Object.assign(plugin, {
      eventDrivenRagStats: status,
      vaultDocumentCorpus: { isBusy: () => true },
    });
    expect(plugin.getRetrievalReadiness()).toBe('preparing');
  });

  it('RAG 런타임 재초기화가 중간에 실패하면 기존 인덱서를 복구한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      manifest: { id: string };
      vectorStore: unknown;
      embeddingProvider: unknown;
      ragEngine: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: { cancel: ReturnType<typeof vi.fn> };
    };
    const previousVectorStore = { kind: 'previous-vector-store', close: vi.fn() };
    const previousEmbeddingProvider = { kind: 'previous-embedding-provider', close: vi.fn() };
    const previousRagEngine = { kind: 'previous-rag-engine' };
    const previousVaultIndexer = { kind: 'previous-vault-indexer' };
    const previousScheduler = { cancel: vi.fn() };

    plugin.app = createApp();
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      providerProfiles: [createOpenAiEmbeddingProfile('test-key')],
      rag: {
        ...createRagWithEmbedding(DEFAULT_SETTINGS.rag),
        autoUpdateEnabled: false,
      },
    };
    plugin.vectorStore = previousVectorStore;
    plugin.embeddingProvider = previousEmbeddingProvider;
    plugin.ragEngine = previousRagEngine;
    plugin.vaultIndexer = previousVaultIndexer;
    plugin.ragIndexingScheduler = previousScheduler;
    Object.defineProperty(plugin.app, 'metadataCache', {
      get: () => {
        throw new Error('metadata unavailable');
      },
    });

    await expect(
      (
        plugin as unknown as {
          initRAGRuntime(): Promise<void>;
        }
      ).initRAGRuntime(),
    ).rejects.toThrow('metadata unavailable');

    expect(plugin.vectorStore).toBe(previousVectorStore);
    expect(plugin.embeddingProvider).toBe(previousEmbeddingProvider);
    expect(plugin.ragEngine).toBe(previousRagEngine);
    expect(plugin.vaultIndexer).toBe(previousVaultIndexer);
    expect(plugin.ragIndexingScheduler).toBe(previousScheduler);
    expect(previousVectorStore.close).not.toHaveBeenCalled();
    expect(previousEmbeddingProvider.close).not.toHaveBeenCalled();
  });

  it('임베딩 모델이 없어도 BM25 lexical runtime을 채팅에 준비한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      manifest: { id: string };
      bm25Index: { isReady: boolean } | null;
      ragEngine: { query(question: string): Promise<unknown[]> } | null;
      vectorStore: unknown;
    };
    plugin.app = createApp();
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      providerProfiles: [],
      rag: {
        ...DEFAULT_SETTINGS.rag,
        embeddingModelRef: '',
        enableBM25: true,
      },
    };

    await plugin.initRAG();

    expect(plugin.bm25Index).not.toBeNull();
    expect(plugin.ragEngine).not.toBeNull();
    await expect(plugin.ragEngine?.query('아무 질의')).resolves.toEqual([]);
    expect(plugin.vectorStore).toBeNull();
    expect(plugin.app.vault.on).toHaveBeenCalledTimes(4);
  });

  it('플러그인 시작 직후 RAG 런타임을 자동 초기화하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    vi.useFakeTimers();
    try {
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        register: ReturnType<typeof vi.fn>;
        initRAG: ReturnType<typeof vi.fn>;
        initMCP: ReturnType<typeof vi.fn>;
      };
      plugin.register = vi.fn();
      plugin.initRAG = vi.fn(() => Promise.resolve());
      plugin.initMCP = vi.fn(() => Promise.resolve([]));

      (
        plugin as unknown as {
          startDeferredStartupTasks(): void;
        }
      ).startDeferredStartupTasks();
      await vi.advanceTimersByTimeAsync(500);

      expect(plugin.initRAG).not.toHaveBeenCalled();
      expect(plugin.initMCP).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);

      expect(plugin.initRAG).not.toHaveBeenCalled();
      expect(plugin.initMCP).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it('명시적 RAG 액션에서 런타임이 없으면 초기화를 시도한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      vectorStore: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: unknown;
      createProviderForModel: ReturnType<typeof vi.fn>;
      initRAG: ReturnType<typeof vi.fn>;
    };
    plugin.vectorStore = null;
    plugin.vaultIndexer = null;
    plugin.ragIndexingScheduler = null;
    plugin.ragEngine = null;
    plugin.initRAG = vi.fn(() => {
      plugin.vectorStore = {};
      plugin.vaultIndexer = {};
      plugin.ragIndexingScheduler = {};
      plugin.ragEngine = {};
      return Promise.resolve();
    });

    const initialized = await (
      plugin as unknown as {
        ensureRagRuntimeInitialized(): Promise<boolean>;
      }
    ).ensureRagRuntimeInitialized();

    expect(initialized).toBe(true);
    expect(plugin.initRAG).toHaveBeenCalledOnce();
  });

  it('저장소만 만들어진 부분 초기화에서도 질의 엔진 초기화를 건너뛰지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      vectorStore: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: unknown;
      ragEngine: unknown;
      initRAG: ReturnType<typeof vi.fn>;
    };
    plugin.vectorStore = {};
    plugin.vaultIndexer = {};
    plugin.ragIndexingScheduler = {};
    plugin.ragEngine = null;
    plugin.initRAG = vi.fn(() => {
      plugin.ragEngine = {};
      return Promise.resolve();
    });

    const initialized = await (
      plugin as unknown as {
        ensureRagRuntimeInitialized(): Promise<boolean>;
      }
    ).ensureRagRuntimeInitialized();

    expect(initialized).toBe(true);
    expect(plugin.initRAG).toHaveBeenCalledOnce();
  });

  it('채팅 진입은 RAG runtime만 준비하고 자동 인덱싱 주기를 우회하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      settings: { rag: { autoUpdateEnabled: boolean } };
      ensureRagRuntimeInitialized: ReturnType<typeof vi.fn>;
      isRagIndexing: ReturnType<typeof vi.fn>;
      autoIndex: ReturnType<typeof vi.fn>;
    };
    plugin.settings = { rag: { autoUpdateEnabled: true } };
    plugin.ensureRagRuntimeInitialized = vi.fn(() => Promise.resolve(true));
    plugin.isRagIndexing = vi.fn(() => false);
    plugin.autoIndex = vi.fn(() => Promise.resolve());

    await plugin.prepareRagForChat();

    expect(plugin.ensureRagRuntimeInitialized).toHaveBeenCalledOnce();
    expect(plugin.autoIndex).not.toHaveBeenCalled();
  });

  it('채팅은 vector 검색 엔진이 준비되면 선택적 BM25 초기화를 기다리지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      settings: { rag: { autoUpdateEnabled: boolean } };
      ragEngine: unknown;
      ensureRagRuntimeInitialized: ReturnType<typeof vi.fn>;
      isRagIndexing: ReturnType<typeof vi.fn>;
      autoIndex: ReturnType<typeof vi.fn>;
    };
    plugin.settings = { rag: { autoUpdateEnabled: false } };
    plugin.ragEngine = {};
    plugin.ensureRagRuntimeInitialized = vi.fn(() => new Promise<boolean>(() => undefined));
    plugin.isRagIndexing = vi.fn(() => false);
    plugin.autoIndex = vi.fn(() => Promise.resolve());

    await expect(plugin.prepareRagForChat()).resolves.toBe(true);

    expect(plugin.ensureRagRuntimeInitialized).not.toHaveBeenCalled();
  });

  it('자동 인덱싱은 플러그인 재로드 중 교체된 RAG runtime을 사용하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    let releaseLagMeasurement = (): void => undefined;
    const lagMeasurement = new Promise<void>((resolve) => {
      releaseLagMeasurement = resolve;
    });
    const vectorStore = {
      getFileIndexRecords: vi.fn(() => Promise.resolve([])),
    };
    const scheduler = {
      isRunning: vi.fn(() => false),
      indexPending: vi.fn(() => Promise.resolve({ indexed: 0, vectors: 0, skipped: 0 })),
    };
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime as object, {
      app: createApp(),
      settings: DEFAULT_SETTINGS,
      unloaded: false,
      vectorStore,
      vaultIndexer: {},
      ragIndexingScheduler: scheduler,
      ragPerformanceGuard: {
        measureEventLoopLag: vi.fn(() => lagMeasurement),
        getState: vi.fn(() => null),
      },
      ragIndexAbortController: null,
      getLogger: () => logger,
    });

    const run = (
      runtime as unknown as {
        autoIndex(): Promise<void>;
      }
    ).autoIndex();
    await Promise.resolve();
    Object.assign(runtime as object, {
      unloaded: true,
      vectorStore: null,
      vaultIndexer: null,
      ragIndexingScheduler: null,
      ragPerformanceGuard: null,
    });
    releaseLagMeasurement();
    await run;

    expect(vectorStore.getFileIndexRecords).not.toHaveBeenCalled();
    expect(scheduler.indexPending).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Auto RAG indexing stopped because the runtime changed.',
      { source: 'rag.auto' },
    );
  });

  it('unload된 인스턴스의 늦은 자동 인덱싱 tick은 경고 없이 종료한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      unloaded: boolean;
      getLogger: () => typeof logger;
    };
    plugin.unloaded = true;
    plugin.getLogger = () => logger;

    await (
      plugin as unknown as {
        autoIndex(): Promise<void>;
      }
    ).autoIndex();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Auto RAG indexing stopped because the plugin unloaded.',
      { source: 'rag.auto' },
    );
  });

  it('RAG runtime initialization records the stuck stage when a step times out', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    vi.useFakeTimers();
    try {
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
      };
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        lastRagRuntimeInitError: string | null;
        lastRagRuntimeInitStage: string | null;
        getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      };
      plugin.lastRagRuntimeInitError = null;
      plugin.lastRagRuntimeInitStage = null;
      plugin.getLogger = vi.fn(() => logger);

      const result = (
        plugin as unknown as {
          runRagRuntimeInitStep(
            stage: string,
            operation: () => Promise<void>,
            timeoutMs: number,
          ): Promise<void>;
        }
      ).runRagRuntimeInitStep('legacy-vector-import', () => new Promise(() => undefined), 10);
      const expectation = expect(result).rejects.toThrow('legacy-vector-import');

      await vi.advanceTimersByTimeAsync(10);

      await expectation;
      expect(plugin.lastRagRuntimeInitStage).toBe('legacy-vector-import');
      expect(plugin.lastRagRuntimeInitError).toContain('legacy-vector-import');
      expect(logger.error).toHaveBeenCalledWith(
        'RAG runtime initialization step failed.',
        expect.objectContaining({
          data: expect.objectContaining({ stage: 'legacy-vector-import' }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });


  it('BM25 load의 worker 무응답 감시가 진행 중이면 고정 총시간 제한을 중복 적용하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    vi.useFakeTimers();
    try {
      let finish = (value: string): void => undefined;
      const operation = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
      };
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        lastRagRuntimeInitError: string | null;
        lastRagRuntimeInitStage: string | null;
        getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      };
      plugin.lastRagRuntimeInitError = null;
      plugin.lastRagRuntimeInitStage = null;
      plugin.getLogger = vi.fn(() => logger);

      const result = (
        plugin as unknown as {
          runRagRuntimeInitStep(
            stage: string,
            operation: () => Promise<string>,
            timeoutMs: number | null,
          ): Promise<string>;
        }
      ).runRagRuntimeInitStep('bm25-load', () => operation, null);
      await vi.advanceTimersByTimeAsync(60_000);
      finish('ready');

      await expect(result).resolves.toBe('ready');
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });



  it('BM25 로드 이후 RAG 파일 이벤트를 등록한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
    };
    const app = createApp();
    plugin.app = app;
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      providerProfiles: [createOpenAiEmbeddingProfile('test-key')],
      rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag, { enableBM25: true }),
    };

    await plugin.initRAG();

    expect(app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
    expect(app.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
    expect(app.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
    expect(app.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
  });

  it('BM25 load failure does not block the vector RAG runtime', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const { VaultIndexer } = await import('./src/rag/indexer');
    const logger = {
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      manifest: { id: string };
      getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      bm25Index: unknown;
      ragEngine: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: unknown;
      lastRagRuntimeInitError: string | null;
    };
    plugin.app = createApp();
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      providerProfiles: [createOpenAiEmbeddingProfile('test-key')],
      rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag, {
        enableBM25: true,
      }),
    };
    plugin.getLogger = vi.fn(() => logger);
    plugin.createProviderForModel = vi.fn(() => ({
      capability: {
        toolCalls: false,
        embeddings: false,
        vision: false,
        reasoning: false,
      },
      chat: vi.fn(() => Promise.resolve('{"entities":[],"relations":[],"claims":[]}')),
      streamChat: vi.fn(() => Promise.resolve()),
    }));
    const loadSpy = vi
      .spyOn(IndexedDbBM25Index.prototype, 'load')
      .mockRejectedValue(new Error('BM25 stuck'));
    const detachSpy = vi.spyOn(VaultIndexer.prototype, 'setBM25Index');
    try {
      await (
        plugin as unknown as {
          initRAGRuntime(): Promise<void>;
        }
      ).initRAGRuntime();
      await vi.waitFor(() => {
        expect(plugin.bm25Index).toBeNull();
      });

      expect(plugin.ragEngine).not.toBeNull();
      expect(plugin.vaultIndexer).not.toBeNull();
      expect(plugin.ragIndexingScheduler).not.toBeNull();
      expect(plugin.lastRagRuntimeInitError).toBeNull();
      expect(detachSpy).toHaveBeenCalledWith(undefined);
      expect(logger.warn).toHaveBeenCalledWith(
        'BM25 index initialization failed; continuing without BM25.',
        expect.objectContaining({ source: 'rag.bm25' }),
      );
    } finally {
      loadSpy.mockRestore();
      detachSpy.mockRestore();
    }
  });

  it('이전 run의 늦은 BM25 완료는 현재 runtime을 변경하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const staleIndex = { close: vi.fn() };
    const currentIndex = {};
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      unloaded: boolean;
      ragRuntimeInitRunId: number;
      bm25Index: unknown;
      getLogger: () => typeof logger;
    };
    plugin.unloaded = false;
    plugin.ragRuntimeInitRunId = 2;
    plugin.bm25Index = currentIndex;
    plugin.getLogger = () => logger;

    const available = await (
      plugin as unknown as {
        finishBM25BackgroundLoad(
          index: unknown,
          outcome: Promise<{
            error: Error | null;
            startedAt: number;
            loadDurationMs: number;
          }>,
          runId: number,
        ): Promise<boolean>;
      }
    ).finishBM25BackgroundLoad(
      staleIndex,
      Promise.resolve({ error: null, startedAt: Date.now() - 25, loadDurationMs: 25 }),
      1,
    );

    expect(available).toBe(false);
    expect(staleIndex.close).not.toHaveBeenCalled();
    expect(plugin.bm25Index).toBe(currentIndex);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('BM25 load가 진행 중이어도 vector RAG runtime 초기화를 즉시 완료한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      manifest: { id: string };
      bm25Index: unknown;
      ragEngine: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: unknown;
    };
    plugin.app = createApp();
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      providerProfiles: [createOpenAiEmbeddingProfile('test-key')],
      rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag, {
        enableBM25: true,
      }),
    };

    let finishLoad = (): void => undefined;
    const loadSpy = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const rebuildSpy = vi
      .spyOn(IndexedDbBM25Index.prototype, 'rebuild')
      .mockResolvedValue(undefined);
    let initializationSettled = false;
    const initialization = (
      plugin as unknown as {
        initRAGRuntime(): Promise<void>;
      }
    )
      .initRAGRuntime()
      .then(() => {
        initializationSettled = true;
      });

    try {
      await vi.waitFor(() => {
        expect(loadSpy).toHaveBeenCalledOnce();
      });
      await vi.waitFor(() => {
        expect(initializationSettled).toBe(true);
      });

      expect(plugin.bm25Index).not.toBeNull();
      expect(plugin.ragEngine).not.toBeNull();
      expect(plugin.vaultIndexer).not.toBeNull();
      expect(plugin.ragIndexingScheduler).not.toBeNull();
    } finally {
      finishLoad();
      await initialization;
      await vi.waitFor(() => {
        expect(rebuildSpy).toHaveBeenCalledOnce();
      });
      loadSpy.mockRestore();
      rebuildSpy.mockRestore();
    }
  });

  it('RAG 재초기화 시 기존 이벤트를 해제하고 새 이벤트를 등록한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
    };
    const app = createApp();
    plugin.app = app;
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      providerProfiles: [createOpenAiEmbeddingProfile('test-key')],
      rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag, { enableBM25: true }),
    };

    await plugin.initRAG();
    await plugin.initRAG();

    expect(app.vault.offref).toHaveBeenCalledTimes(4);
    expect(app.vault.on).toHaveBeenCalledTimes(8);
  });

  it('RAG 상태는 초기화 시 한 번 갱신하고 반복 타이머를 만들지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const refresh = vi.fn();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      settings: typeof DEFAULT_SETTINGS;
      ragStatusTimer: number | null;
      refreshRagStatusInBackground: typeof refresh;
    };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rag: { ...DEFAULT_SETTINGS.rag, autoUpdateEnabled: true },
    };
    plugin.ragStatusTimer = null;
    plugin.refreshRagStatusInBackground = refresh;

    try {
      (
        plugin as unknown as {
          setupRagStatusTimer(): void;
        }
      ).setupRagStatusTimer();

      expect(refresh).toHaveBeenCalledOnce();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('hot reload 시 이전 자동 인덱싱 interval을 회수하고 현재 lifecycle에 등록한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockReturnValueOnce(101)
      .mockReturnValueOnce(202);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const createPlugin = () => {
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        settings: typeof DEFAULT_SETTINGS;
        vaultIndexer: object;
        autoUpdateTimer: number | null;
        registerInterval: ReturnType<typeof vi.fn<(id: number) => number>>;
      };
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          autoUpdateEnabled: true,
          autoUpdateIntervalMin: 1,
        },
      };
      plugin.vaultIndexer = {};
      plugin.autoUpdateTimer = null;
      plugin.registerInterval = vi.fn((id) => id);
      return plugin;
    };
    const firstPlugin = createPlugin();
    const secondPlugin = createPlugin();

    try {
      firstPlugin.setupAutoUpdate();
      secondPlugin.setupAutoUpdate();

      expect(clearIntervalSpy).toHaveBeenCalledWith(101);
      expect(firstPlugin.registerInterval).toHaveBeenCalledWith(101);
      expect(secondPlugin.registerInterval).toHaveBeenCalledWith(202);
    } finally {
      secondPlugin.settings.rag.autoUpdateEnabled = false;
      secondPlugin.setupAutoUpdate();
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('RAG 인덱싱 완료 시 전체 상태를 한 번 다시 계산한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = { debug: vi.fn() };
    const refreshBus = { emit: vi.fn() };
    const debouncedRefreshStats = vi.fn();
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      ragIndexingStatus: {
        running: boolean;
        phase: 'idle' | 'indexing';
        queuedFiles: number;
        progress: null;
        lastResult: null;
        pausedUntil: null;
      } | null;
      refreshBus: typeof refreshBus;
      getLogger: () => typeof logger;
      debouncedRefreshStats: typeof debouncedRefreshStats;
    };
    plugin.ragIndexingStatus = {
      running: true,
      phase: 'indexing',
      queuedFiles: 0,
      progress: null,
      lastResult: null,
      pausedUntil: null,
    };
    plugin.refreshBus = refreshBus;
    plugin.getLogger = () => logger;
    plugin.debouncedRefreshStats = debouncedRefreshStats;

    (
      plugin as unknown as {
        handleRagIndexingStatusChange(status: {
          running: boolean;
          phase: 'idle';
          queuedFiles: number;
          progress: null;
          lastResult: null;
          pausedUntil: null;
        }): void;
      }
    ).handleRagIndexingStatusChange({
      running: false,
      phase: 'idle',
      queuedFiles: 0,
      progress: null,
      lastResult: null,
      pausedUntil: null,
    });

    expect(debouncedRefreshStats).toHaveBeenCalledOnce();
  });

  it('적응형 속도 조절 중에도 정적인 경고 대신 현재 인덱싱 진행률을 표시한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      ragPerformanceGuard: { getState(): { mode: 'throttled' } };
    };
    plugin.ragPerformanceGuard = { getState: () => ({ mode: 'throttled' }) };

    const detail = (
      plugin as unknown as {
        formatRagIndexingStatus(status: unknown): string;
      }
    ).formatRagIndexingStatus({
      running: true,
      phase: 'pending',
      queuedFiles: 0,
      lastResult: null,
      progress: {
        totalFiles: 3,
        completedFiles: 1,
        currentFileTotalChunks: 8000,
        currentFileEmbeddedChunks: 384,
        eta: null,
      },
    });

    expect(detail).toContain('1');
    expect(detail).toContain('3');
    expect(detail).toContain('384');
    expect(detail).toContain('8000');
  });

  it('설정 로드 시 data.json의 RAG 안전 설정이 stale localStorage 값을 덮는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({
      localSettings: {
        ...DEFAULT_SETTINGS,
        openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'local-key' },
        rag: {
          ...DEFAULT_SETTINGS.rag,
          excludePaths: ['**/.git', '**/node_modules', '**/.obsidian'],
          autoUpdateEnabled: true,
          enableBM25: true,
        },
      },
    });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      saveData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.saveData = vi.fn(() => Promise.resolve());
    plugin.loadData = vi.fn(() =>
      Promise.resolve({
        rag: {
          ...DEFAULT_SETTINGS.rag,
          excludePaths: [
            '**/.git',
            '**/node_modules',
            '**/.obsidian',
            '**/.venv',
            '**/__pycache__',
          ],
          autoUpdateEnabled: false,
          enableBM25: false,
        },
      }),
    );

    await plugin.loadSettings();

    expect(app.loadLocalStorage).toHaveBeenCalledWith('superpower-inside:settings');
    expect(plugin.loadData).toHaveBeenCalledOnce();
    expect(plugin.settings.openai.apiKey).toBe('local-key');
    expect(plugin.settings.rag.autoUpdateEnabled).toBe(false);
    expect(plugin.settings.rag.enableBM25).toBe(false);
    expect(plugin.settings.rag.excludePaths).toContain('**/__pycache__');
  });

  it('저장된 언어가 없으면 Obsidian 호스트 언어로 기본 프롬프트까지 초기화한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { t } = await import('./src/i18n');
    const app = createApp({ localSettings: {} });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: {
        language: string;
        chat: {
          promptLibrary: Array<{ source: string; content: string }>;
        };
      };
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.language).toBe('en');
    expect(plugin.settings.chat.promptLibrary).toContainEqual(
      expect.objectContaining({
        source: 'default',
        content: t('defaultObsidianSystemPrompt'),
      }),
    );
    expect(plugin.settings.chat.promptLibrary.some((entry) => /[가-힣]/u.test(entry.content))).toBe(
      false,
    );
  });

  it('설정 로드 시 레거시 성능 보호 비활성 값을 활성 상태로 정규화한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({
      localSettings: {
        ...DEFAULT_SETTINGS,
        rag: { ...DEFAULT_SETTINGS.rag, performanceGuardEnabled: false },
      },
    });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.rag.performanceGuardEnabled).toBe(true);
  });

  it.each([
    [undefined, 30], [null, 30], ['60', 30], [0, 10], [12.5, 30], [60, 60], [99999, 3600],
  ])('전역 한도 조회 주기는 저장값 %s를 %s초로 정규화한다', async (saved, expected) => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(plugin, {
      app: createApp({ localSettings: { ...DEFAULT_SETTINGS, quotaCheckIntervalSeconds: saved } }),
      loadData: vi.fn(),
    });
    await plugin.loadSettings();
    expect(plugin.settings.quotaCheckIntervalSeconds).toBe(expected);
  });

  it('한도 갱신 이벤트는 연결 ID를 보존하고 비활성을 부분 실패로 올리지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { RefreshBus } = await import('./src/utils/refresh-bus');
    const bus = new RefreshBus(); const updates: Array<{ status: string; detail?: string }> = [];
    bus.on('quota', (result) => updates.push(result));
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(plugin, {
      app: createApp(), register: vi.fn(), refreshBus: bus,
      settings: { ...structuredClone(DEFAULT_SETTINGS), providerProfiles: ['first', 'second'].map((id) => ({
        id, name: id, strategy: 'openai', enabled: false, apiKey: '', models: [],
      })) },
    });
    (plugin as unknown as { startProviderQuota(): void }).startProviderQuota();
    try {
      expect(updates).toEqual([{ status: 'success', detail: 'first' }, { status: 'success', detail: 'second' }]);
      expect(plugin.providerQuota?.get('first')).toEqual({ status: 'disabled' });
      expect(plugin.providerQuota?.get('second')).toEqual({ status: 'disabled' });
    } finally { plugin.providerQuota?.dispose(); bus.destroy(); }
  });

  it.each(['load', 'save'] as const)('WASM 간격 검증 실패 시 %s 경로는 기존 설정을 덮어쓰지 않는다', async (operation) => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const rust = await import('./src/rag/rust-core');
    const normalize = vi.spyOn(rust, 'normalizeQuotaIntervalSecondsRust').mockReturnValueOnce(null);
    const settings = { ...structuredClone(DEFAULT_SETTINGS), quotaCheckIntervalSeconds: 60 };
    const app = createApp({ localSettings: settings });
    const saveData = vi.fn();
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(plugin, { app, settings, loadData: vi.fn(), saveData });
    try {
      await expect(operation === 'load' ? plugin.loadSettings() : plugin.saveSettingsLight()).rejects.toThrow();
      expect(plugin.settings.quotaCheckIntervalSeconds).toBe(60);
      expect(saveData).not.toHaveBeenCalled();
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    } finally { normalize.mockRestore(); }
  });

  it('가벼운 설정 저장도 공통 조회기를 갱신하되 RAG와 MCP는 재초기화하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { ProviderQuotaService } = await import('./src/llm/provider-quota-service');
    const quota = new ProviderQuotaService({ getProfiles: () => [], getIntervalSeconds: () => 60, onChange: () => {} });
    const configure = vi.spyOn(quota, 'configure');
    const initRAG = vi.fn(); const initMCP = vi.fn();
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(plugin, {
      app: createApp(), settings: { ...structuredClone(DEFAULT_SETTINGS), quotaCheckIntervalSeconds: 60 },
      saveData: vi.fn(), initProvider: vi.fn(), providerQuota: quota, initRAG, initMCP,
    });
    await plugin.saveSettingsLight();
    expect(configure).toHaveBeenCalledOnce();
    expect(plugin.saveData).toHaveBeenCalledWith(expect.objectContaining({ quotaCheckIntervalSeconds: 60 }));
    expect(initRAG).not.toHaveBeenCalled(); expect(initMCP).not.toHaveBeenCalled();
    quota.dispose();
  });

  it('기존 설정 로드 시 WSL PATH 조회 옵션 기본값을 보강한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const oldSettings = { ...DEFAULT_SETTINGS };
    delete (oldSettings as Partial<typeof DEFAULT_SETTINGS>).mcpIncludeWslPath;
    const app = createApp({ localSettings: oldSettings });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.mcpIncludeWslPath).toBe(false);
  });

  it('설정 로드 시 레거시 other 임베딩 프로바이더를 기본 OpenAI 임베딩으로 정규화한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({
      localSettings: {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          embeddingProvider: 'other',
          embeddingModel: 'legacy-custom-embedding',
        },
      },
    });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.rag.embeddingProvider).toBe('ternlight');
    expect(plugin.settings.rag.embeddingModel).toBe('ternlight-base');
  });

  it('localStorage 설정이 없으면 data.json의 평문 키를 키체인으로 옮기고 저장본에서는 지운다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({ legacyDataExists: true });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      manifest: { id: string };
      loadData: ReturnType<typeof vi.fn>;
      saveData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.manifest = { id: 'superpower-inside' };
    plugin.loadData = vi.fn(() =>
      Promise.resolve({
        openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'legacy-key' },
      }),
    );
    plugin.saveData = vi.fn(() => Promise.resolve());

    await plugin.loadSettings();

    expect(plugin.loadData).toHaveBeenCalledOnce();
    expect(app.secretStorage.getSecret('superpower-inside-openai')).toBe('legacy-key');
    expect(plugin.settings.openai.apiKeySecret).toBe('superpower-inside-openai');
    expect(plugin.settings.openai.apiKey).toBe('legacy-key');
    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      'superpower-inside:settings',
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: '', apiKeySecret: 'superpower-inside-openai' }),
      }),
    );
    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: '', apiKeySecret: 'superpower-inside-openai' }),
      }),
    );
    expect(JSON.stringify(app.saveLocalStorage.mock.calls.at(-1)?.[1])).not.toContain('legacy-key');
    expect(JSON.stringify(plugin.saveData.mock.calls.at(-1)?.[0])).not.toContain('legacy-key');
    expect(app.vault.adapter.remove).not.toHaveBeenCalled();
  });

  it('설정 저장 시 localStorage와 data.json에 모두 저장해 재활성화 후에도 복구 가능하게 한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp();
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      saveData: ReturnType<typeof vi.fn>;
      initProvider: ReturnType<typeof vi.fn>;
      initRAG: ReturnType<typeof vi.fn>;
      initMCP: ReturnType<typeof vi.fn>;
    };
    plugin.app = app;
    plugin.settings = DEFAULT_SETTINGS;
    plugin.saveData = vi.fn();
    plugin.initProvider = vi.fn();
    plugin.initRAG = vi.fn(() => Promise.resolve());
    plugin.initMCP = vi.fn(() => Promise.resolve([]));

    await plugin.saveSettings();

    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      'superpower-inside:settings',
      DEFAULT_SETTINGS,
    );
    expect(plugin.saveData).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('설정 저장 시 키 원문을 보안 저장소에 넣고 저장본에서는 지운다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp();
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      saveData: ReturnType<typeof vi.fn>;
      initProvider: ReturnType<typeof vi.fn>;
      initRAG: ReturnType<typeof vi.fn>;
      initMCP: ReturnType<typeof vi.fn>;
    };
    plugin.app = app;
    plugin.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'typed-key' },
    };
    plugin.saveData = vi.fn(() => Promise.resolve());
    plugin.initProvider = vi.fn();
    plugin.initRAG = vi.fn(() => Promise.resolve());
    plugin.initMCP = vi.fn(() => Promise.resolve([]));

    await plugin.saveSettings();

    expect(app.secretStorage.getSecret('superpower-inside-openai')).toBe('typed-key');
    expect(plugin.settings.openai.apiKeySecret).toBe('superpower-inside-openai');
    expect(plugin.settings.openai.apiKey).toBe('typed-key');
    expect(JSON.stringify(plugin.saveData.mock.calls.at(-1)?.[0])).not.toContain('typed-key');
  });

  it('전체 플러그인 데이터 초기화는 설정과 플러그인 소유 저장소만 기본 상태로 되돌린다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({ pluginDataDirExists: true });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      manifest: { id: string };
      settings: typeof DEFAULT_SETTINGS;
      saveData: ReturnType<typeof vi.fn>;
      initProvider: ReturnType<typeof vi.fn>;
      initMCP: ReturnType<typeof vi.fn>;
      refreshBus: { emit: ReturnType<typeof vi.fn> };
      getLogger: ReturnType<
        typeof vi.fn<
          () => {
            info: ReturnType<typeof vi.fn>;
            notice: ReturnType<typeof vi.fn>;
            warn: ReturnType<typeof vi.fn>;
            error: ReturnType<typeof vi.fn>;
            configure: ReturnType<typeof vi.fn>;
          }
        >
      >;
      vectorStore: { clear: ReturnType<typeof vi.fn>; deleteDatabase: ReturnType<typeof vi.fn> };
      bm25Index: { clear: ReturnType<typeof vi.fn>; deleteDatabase: ReturnType<typeof vi.fn> };
      embeddingProvider: {
        clearCache: ReturnType<typeof vi.fn>;
        deleteDatabase: ReturnType<typeof vi.fn>;
      };
      createIndexedDbName: (kind: string) => string;
    };
    const logger = {
      info: vi.fn(),
      notice: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      configure: vi.fn(),
    };
    plugin.app = app;
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'should-reset' },
    };
    plugin.saveData = vi.fn(() => Promise.resolve());
    plugin.initProvider = vi.fn();
    plugin.initMCP = vi.fn(() => Promise.resolve([]));
    plugin.refreshBus = { emit: vi.fn() };
    plugin.getLogger = vi.fn(() => logger);
    const vectorStore = {
      clear: vi.fn(() => Promise.resolve()),
      deleteDatabase: vi.fn(() => Promise.resolve()),
    };
    const bm25Index = {
      clear: vi.fn(() => Promise.resolve()),
      deleteDatabase: vi.fn(() => Promise.resolve()),
    };
    const embeddingProvider = {
      clearCache: vi.fn(() => Promise.resolve()),
      deleteDatabase: vi.fn(() => Promise.resolve()),
    };
    plugin.vectorStore = vectorStore;
    plugin.bm25Index = bm25Index;
    plugin.embeddingProvider = embeddingProvider;
    plugin.createIndexedDbName = (kind: string) => `superpower-inside:UnitVault:${kind}`;

    await plugin.resetPluginData();

    expect(vectorStore.deleteDatabase).toHaveBeenCalledOnce();
    expect(bm25Index.deleteDatabase).toHaveBeenCalledOnce();
    expect(vectorStore.clear).not.toHaveBeenCalled();
    expect(bm25Index.clear).not.toHaveBeenCalled();
    expect(embeddingProvider.deleteDatabase).toHaveBeenCalledOnce();
    expect(embeddingProvider.clearCache).not.toHaveBeenCalled();
    expect(app.vault.adapter.rmdir).toHaveBeenCalledWith('.superpower-inside', true);
    expect(app.vault.adapter.remove).not.toHaveBeenCalledWith('Notes/user-note.md');
    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      'superpower-inside:settings',
      expect.objectContaining({
        language: 'en',
        chat: expect.objectContaining({
          promptLibrary: [
            expect.objectContaining({
              id: 'default-obsidian-knowledge-work',
              source: 'default',
            }),
          ],
        }),
      }),
    );
    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'en',
        chat: expect.objectContaining({
          promptLibrary: [
            expect.objectContaining({
              id: 'default-obsidian-knowledge-work',
              source: 'default',
            }),
          ],
        }),
      }),
    );
    expect(plugin.settings.openai.apiKey).toBe('');
    expect(plugin.initMCP).toHaveBeenCalledOnce();
    expect(plugin.refreshBus.emit).toHaveBeenCalledWith('rag', {
      status: 'success',
      detail: 'Plugin data reset',
    });
  });
});

describe('SuperpowerInsidePlugin chat view placement', () => {
  it('포커스된 사이드바 채팅 뷰는 reveal만 하고 새 탭을 만들지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { CHAT_VIEW_TYPE, ChatView } = await import('./src/chat/view');
    const root = { kind: 'root' };
    const sidebarParent = { kind: 'right-sidebar' };
    const chatView = { kind: 'chat-view' };
    const chatLeaf = createChatPlacementLeaf({
      root: sidebarParent,
      parent: sidebarParent,
      view: chatView,
    });
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [chatLeaf]),
      getActiveViewOfType: vi.fn(() => chatView),
      getMostRecentLeaf: vi.fn(() => null),
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    await (plugin as unknown as { openChatView(): Promise<void> }).openChatView();

    expect(workspace.getActiveViewOfType).toHaveBeenCalledWith(ChatView);
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(CHAT_VIEW_TYPE);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(chatLeaf);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(chatLeaf.setViewState).not.toHaveBeenCalled();
  });

  it('활성 메인 탭 그룹의 기존 채팅 leaf를 재사용하고 setViewState를 다시 호출하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { CHAT_VIEW_TYPE } = await import('./src/chat/view');
    const root = { kind: 'root' };
    const activeGroup = { kind: 'root-group' };
    const contextLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'markdown' },
    });
    const existingLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'chat-view' },
    });
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [existingLeaf]),
      getActiveViewOfType: vi.fn(() => null),
      getMostRecentLeaf: vi.fn(() => contextLeaf),
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    await (plugin as unknown as { openChatView(): Promise<void> }).openChatView();

    expect(workspace.getMostRecentLeaf).toHaveBeenCalledWith(workspace.rootSplit);
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(CHAT_VIEW_TYPE);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(existingLeaf.setViewState).not.toHaveBeenCalled();
  });

  it('오른쪽 사이드바 채팅만 있으면 활성 메인 탭 그룹에 새 탭을 연다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { CHAT_VIEW_TYPE } = await import('./src/chat/view');
    const root = { kind: 'root' };
    const sidebarRoot = { kind: 'right-sidebar' };
    const sidebarParent = { kind: 'right-sidebar' };
    const activeGroup = { kind: 'root-group' };
    const sidebarChatLeaf = createChatPlacementLeaf({
      root: sidebarRoot,
      parent: sidebarParent,
      view: { kind: 'chat-view' },
    });
    const contextLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'markdown' },
    });
    const newLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'empty' },
    });
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [sidebarChatLeaf]),
      getActiveViewOfType: vi.fn(() => null),
      getMostRecentLeaf: vi.fn(() => contextLeaf),
      getLeaf: vi.fn(() => newLeaf),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    await (plugin as unknown as { openChatView(): Promise<void> }).openChatView();

    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
    expect(sidebarChatLeaf.setViewState).not.toHaveBeenCalled();
    expect(sidebarChatLeaf.detach).not.toHaveBeenCalled();
  });

  it('채팅이 하나도 없고 root leaf가 있으면 그 컨텍스트 그룹에 새 탭을 연다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { CHAT_VIEW_TYPE } = await import('./src/chat/view');
    const root = { kind: 'root' };
    const activeGroup = { kind: 'root-group' };
    const contextLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'markdown' },
    });
    const newLeaf = createChatPlacementLeaf({
      root,
      parent: activeGroup,
      view: { kind: 'empty' },
    });
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => []),
      getActiveViewOfType: vi.fn(() => null),
      getMostRecentLeaf: vi.fn(() => contextLeaf),
      getLeaf: vi.fn(() => newLeaf),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    await (plugin as unknown as { openChatView(): Promise<void> }).openChatView();

    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(CHAT_VIEW_TYPE);
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(newLeaf.setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
  });

  it('컨텍스트 leaf가 없으면 기존 채팅 leaf를 재사용한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { CHAT_VIEW_TYPE } = await import('./src/chat/view');
    const root = { kind: 'root' };
    const floatingParent = { kind: 'floating' };
    const existingLeaf = createChatPlacementLeaf({
      root,
      parent: floatingParent,
      view: { kind: 'chat-view' },
    });
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [existingLeaf]),
      getActiveViewOfType: vi.fn(() => null),
      getMostRecentLeaf: vi.fn(() => null),
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    await (plugin as unknown as { openChatView(): Promise<void> }).openChatView();

    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(CHAT_VIEW_TYPE);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(existingLeaf.setViewState).not.toHaveBeenCalled();
  });
});

function createOpenAiEmbeddingProfile(apiKey: string) {
  return {
    id: 'openai',
    name: 'OpenAI',
    strategy: 'openai' as const,
    apiKey,
    baseUrl: 'https://api.openai.com',
    enabled: true,
    models: [
      {
        id: 'text-embedding-3-small',
        kind: 'embedding' as const,
        verification: {
          chatStatus: 'unknown' as const,
          embeddingStatus: 'success' as const,
        },
      },
    ],
  };
}

function createRagWithEmbedding<T extends Record<string, unknown>>(
  rag: T,
  override: Partial<T> = {},
): T {
  return {
    ...rag,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingModelRef: 'profile:openai:text-embedding-3-small',
    ...override,
  } as T;
}

function createApp(
  options: {
    localSettings?: unknown;
    legacyDataExists?: boolean;
    pluginDataDirExists?: boolean;
    files?: readonly TFile[];
    contents?: ReadonlyMap<string, string>;
    secrets?: Record<string, string>;
  } = {},
) {
  const refs: unknown[] = [];
  const vault = {
    adapter: {
      exists: vi.fn((path: string) =>
        Promise.resolve(
          path.endsWith('/data.json')
            ? options.legacyDataExists === true
            : path === '.superpower-inside' && options.pluginDataDirExists === true,
        ),
      ),
      stat: vi.fn(() => Promise.resolve(null)),
      mkdir: vi.fn(() => Promise.resolve()),
      rmdir: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
      read: vi.fn(() => Promise.resolve('')),
      write: vi.fn(() => Promise.resolve()),
    },
    getFiles: vi.fn(() => [...(options.files ?? [])]),
    getMarkdownFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(
      (path: string) => options.files?.find((file) => file.path === path) ?? null,
    ),
    cachedRead: vi.fn((file: TFile) => Promise.resolve(options.contents?.get(file.path) ?? '')),
    on: vi.fn((event: string, callback: unknown) => {
      const ref = { event, callback };
      refs.push(ref);
      return ref;
    }),
    offref: vi.fn((ref: unknown) => {
      const index = refs.indexOf(ref);
      if (index >= 0) refs.splice(index, 1);
    }),
  };

  return {
    loadLocalStorage: vi.fn(() => options.localSettings ?? null),
    saveLocalStorage: vi.fn(),
    secretStorage: createFakeSecretStorage(options.secrets),
    vault: { ...vault, configDir: '.obsidian' },
    workspace: {
      trigger: vi.fn(),
    },
  };
}

function createWorkspaceLeaf(root: unknown, width: number) {
  return {
    getRoot: vi.fn(() => root),
    view: {
      containerEl: {
        getBoundingClientRect: vi.fn(() => ({ width })),
      },
    },
    setViewState: vi.fn(() => Promise.resolve()),
    detach: vi.fn(),
  };
}

function createChatPlacementLeaf(options: { root: unknown; parent: unknown; view: unknown }) {
  return {
    getRoot: vi.fn(() => options.root),
    parent: options.parent,
    view: options.view,
    setViewState: vi.fn(() => Promise.resolve()),
    detach: vi.fn(),
  };
}
