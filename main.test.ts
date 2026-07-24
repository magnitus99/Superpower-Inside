import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { GraphRagIndexingResult, GraphRagRunOptions } from './src/graph/indexing-runner';
import type { GraphRagStatusSummary } from './src/graph/status';

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
    requestUrl: vi.fn(),
  };
});

describe('SuperpowerInsidePlugin RAG runtime', () => {
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
        graphRagEnabled: false,
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
      graphRagIndexingRunner: unknown;
      createProviderForModel: ReturnType<typeof vi.fn>;
      initRAG: ReturnType<typeof vi.fn>;
    };
    plugin.vectorStore = null;
    plugin.vaultIndexer = null;
    plugin.ragIndexingScheduler = null;
    plugin.initRAG = vi.fn(() => {
      plugin.vectorStore = {};
      plugin.vaultIndexer = {};
      plugin.ragIndexingScheduler = {};
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
        recordAgentDiagnosticsBreadcrumb: ReturnType<typeof vi.fn>;
      };
      plugin.lastRagRuntimeInitError = null;
      plugin.lastRagRuntimeInitStage = null;
      plugin.getLogger = vi.fn(() => logger);
      plugin.recordAgentDiagnosticsBreadcrumb = vi.fn(() => Promise.resolve());

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
      expect(plugin.recordAgentDiagnosticsBreadcrumb).toHaveBeenCalledWith({
        phase: 'rag.runtime',
        action: 'enter',
        detail: 'legacy-vector-import',
      });
      expect(plugin.recordAgentDiagnosticsBreadcrumb).toHaveBeenCalledWith({
        phase: 'rag.runtime',
        action: 'error',
        detail: 'legacy-vector-import',
        data: expect.objectContaining({ durationMs: 10 }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('RAG runtime initialization records completion breadcrumbs for finished steps', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      lastRagRuntimeInitError: string | null;
      lastRagRuntimeInitStage: string | null;
      getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      recordAgentDiagnosticsBreadcrumb: ReturnType<typeof vi.fn>;
    };
    plugin.lastRagRuntimeInitError = null;
    plugin.lastRagRuntimeInitStage = null;
    plugin.getLogger = vi.fn(() => logger);
    plugin.recordAgentDiagnosticsBreadcrumb = vi.fn(() => Promise.resolve());

    await (
      plugin as unknown as {
        runRagRuntimeInitStep(
          stage: string,
          operation: () => Promise<string>,
          timeoutMs: number,
        ): Promise<string>;
      }
    ).runRagRuntimeInitStep('bm25-load', () => Promise.resolve('done'), 1000);

    expect(plugin.recordAgentDiagnosticsBreadcrumb).toHaveBeenCalledWith({
      phase: 'rag.runtime',
      action: 'leave',
      detail: 'bm25-load',
      data: expect.objectContaining({ durationMs: expect.any(Number) }),
    });
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
        recordAgentDiagnosticsBreadcrumb: ReturnType<typeof vi.fn>;
      };
      plugin.lastRagRuntimeInitError = null;
      plugin.lastRagRuntimeInitStage = null;
      plugin.getLogger = vi.fn(() => logger);
      plugin.recordAgentDiagnosticsBreadcrumb = vi.fn(() => Promise.resolve());

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

  it('unload로 닫힌 RAG 초기화 단계는 오류로 보고하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };
    let rejectOperation = (error: Error): void => undefined;
    const operation = new Promise<void>((_, reject) => {
      rejectOperation = reject;
    });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      unloaded: boolean;
      lastRagRuntimeInitError: string | null;
      lastRagRuntimeInitStage: string | null;
      getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      recordAgentDiagnosticsBreadcrumb: ReturnType<typeof vi.fn>;
    };
    plugin.unloaded = false;
    plugin.lastRagRuntimeInitError = null;
    plugin.lastRagRuntimeInitStage = null;
    plugin.getLogger = vi.fn(() => logger);
    plugin.recordAgentDiagnosticsBreadcrumb = vi.fn(() => Promise.resolve());

    const result = (
      plugin as unknown as {
        runRagRuntimeInitStep(stage: string, operation: () => Promise<void>): Promise<void>;
      }
    ).runRagRuntimeInitStep('bm25-load', () => operation);
    await Promise.resolve();
    plugin.unloaded = true;
    rejectOperation(new Error('BM25 worker was closed.'));

    await expect(result).rejects.toThrow('BM25 worker was closed.');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'RAG runtime initialization step stopped because the plugin unloaded.',
      expect.objectContaining({
        source: 'rag',
        data: expect.objectContaining({ stage: 'bm25-load' }),
      }),
    );
  });

  it('RAG indexing operations record active-operation breadcrumbs', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      ragIndexAbortController: AbortController | null;
      getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      notifyRagStatsRefresh: ReturnType<typeof vi.fn>;
      recordAgentDiagnosticsBreadcrumb: ReturnType<typeof vi.fn>;
    };
    plugin.ragIndexAbortController = null;
    plugin.getLogger = vi.fn(() => logger);
    plugin.notifyRagStatsRefresh = vi.fn();
    plugin.recordAgentDiagnosticsBreadcrumb = vi.fn(() => Promise.resolve());

    const result = await plugin.runRagIndexing(() => Promise.resolve('indexed'));

    expect(result).toBe('indexed');
    expect(plugin.recordAgentDiagnosticsBreadcrumb).toHaveBeenCalledWith({
      phase: 'rag.indexing',
      action: 'enter',
      detail: 'operation',
    });
    expect(plugin.recordAgentDiagnosticsBreadcrumb).toHaveBeenCalledWith({
      phase: 'rag.indexing',
      action: 'leave',
      detail: 'operation',
      data: expect.objectContaining({ durationMs: expect.any(Number) }),
    });
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
        graphRagEnabled: true,
        graphRagModel: 'test-provider:model',
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
        graphRagEnabled: false,
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

  it('GraphRAG 변경분 동기화는 실행 상태 재계산 전에 stale 파일 목록을 보존한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const initialStatus = createGraphRagStatus({
      state: 'stale',
      staleFileCount: 2,
      staleFilePaths: ['a.md', 'b.md'],
    });
    const runningStatus = createGraphRagStatus({
      state: 'building',
      staleFileCount: 0,
      staleFilePaths: [],
    });
    const result: GraphRagIndexingResult = {
      totalCandidateFiles: 2,
      selectedFiles: 2,
      processedFiles: 2,
      skippedFiles: 0,
      failedFiles: 0,
      processedChunks: 2,
      skippedChunks: 0,
      failedChunks: 0,
      cancelled: false,
      startedAt: 1,
      finishedAt: 2,
      runId: 7,
    };
    const run = vi.fn<(options: GraphRagRunOptions) => Promise<GraphRagIndexingResult>>(() =>
      Promise.resolve(result),
    );
    const logger = {
      info: vi.fn(),
      notice: vi.fn(),
      error: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      graphRagIndexingRunner: { run: typeof run };
      graphRagAbortController: AbortController | null;
      graphRagStatus: GraphRagStatusSummary | null;
      computeAndEmitGraphRagStatus: ReturnType<typeof vi.fn<() => Promise<void>>>;
      getLogger: ReturnType<typeof vi.fn<() => typeof logger>>;
      emitGraphDataRefresh: ReturnType<typeof vi.fn>;
    };
    plugin.graphRagIndexingRunner = { run };
    plugin.graphRagAbortController = null;
    plugin.graphRagStatus = initialStatus;
    plugin.computeAndEmitGraphRagStatus = vi.fn(async () => {
      plugin.graphRagStatus = runningStatus;
    });
    plugin.getLogger = vi.fn(() => logger);
    plugin.emitGraphDataRefresh = vi.fn();

    await plugin.syncStaleGraphRag();

    expect(run).toHaveBeenCalledOnce();
    const [options] = run.mock.calls[0];
    expect(options.onlyStaleFiles).toBe(true);
    expect(options.staleFilePaths).toEqual(['a.md', 'b.md']);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('거부된 사실은 cache hit을 우회하는 실패 파일 경로로 자동 복구한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const result: GraphRagIndexingResult = {
      totalCandidateFiles: 1,
      selectedFiles: 1,
      processedFiles: 1,
      skippedFiles: 0,
      failedFiles: 0,
      processedChunks: 1,
      skippedChunks: 0,
      failedChunks: 0,
      cancelled: false,
      startedAt: 1,
      finishedAt: 2,
      runId: 8,
    };
    const run = vi.fn<(options: GraphRagRunOptions) => Promise<GraphRagIndexingResult>>(() =>
      Promise.resolve(result),
    );
    const logger = { info: vi.fn(), notice: vi.fn(), error: vi.fn() };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as unknown as {
      graphRagIndexingRunner: { run: typeof run };
      graphRagAbortController: AbortController | null;
      graphRagStatus: GraphRagStatusSummary | null;
      knowledgeGraphStore: { getRejectedFacts: () => Promise<Array<{ filePath: string }>> };
      computeAndEmitGraphRagStatus: ReturnType<typeof vi.fn<() => Promise<void>>>;
      getLogger: () => typeof logger;
      emitGraphDataRefresh: ReturnType<typeof vi.fn>;
      syncStaleGraphRag(options?: { silent?: boolean }): Promise<GraphRagIndexingResult | null>;
    };
    plugin.graphRagIndexingRunner = { run };
    plugin.graphRagAbortController = null;
    plugin.graphRagStatus = createGraphRagStatus({
      state: 'stale',
      failedFileCount: 1,
      staleFileCount: 0,
      staleFilePaths: [],
    });
    plugin.knowledgeGraphStore = {
      getRejectedFacts: () => Promise.resolve([{ filePath: 'failed.md' }]),
    };
    plugin.computeAndEmitGraphRagStatus = vi.fn(() => Promise.resolve());
    plugin.getLogger = () => logger;
    plugin.emitGraphDataRefresh = vi.fn();

    await plugin.syncStaleGraphRag({ silent: true });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        onlyFailedFiles: true,
        failedFilePaths: ['failed.md'],
      }),
    );
  });

  it('RAG 런타임 재초기화가 중간에 실패하면 기존 인덱서를 복구한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      settings: typeof DEFAULT_SETTINGS;
      manifest: { id: string };
      vectorStore: unknown;
      knowledgeGraphStore: unknown;
      embeddingProvider: unknown;
      ragEngine: unknown;
      graphRagIndexingRunner: unknown;
      vaultIndexer: unknown;
      ragIndexingScheduler: { cancel: ReturnType<typeof vi.fn> };
      createProviderForModel: ReturnType<typeof vi.fn>;
    };
    const previousVectorStore = { kind: 'previous-vector-store', close: vi.fn() };
    const previousKnowledgeGraphStore = { kind: 'previous-graph-store', close: vi.fn() };
    const previousEmbeddingProvider = { kind: 'previous-embedding-provider', close: vi.fn() };
    const previousRagEngine = { kind: 'previous-rag-engine' };
    const previousGraphRagRunner = { kind: 'previous-graph-runner' };
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
        graphRagEnabled: true,
        graphRagModel: 'openai:gpt-test',
        graphRagAutoSyncEnabled: false,
      },
    };
    plugin.vectorStore = previousVectorStore;
    plugin.knowledgeGraphStore = previousKnowledgeGraphStore;
    plugin.embeddingProvider = previousEmbeddingProvider;
    plugin.ragEngine = previousRagEngine;
    plugin.graphRagIndexingRunner = previousGraphRagRunner;
    plugin.vaultIndexer = previousVaultIndexer;
    plugin.ragIndexingScheduler = previousScheduler;
    plugin.createProviderForModel = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('graph provider failed');
      })
      .mockReturnValue(null);

    await expect(
      (
        plugin as unknown as {
          initRAGRuntime(): Promise<void>;
        }
      ).initRAGRuntime(),
    ).rejects.toThrow('graph provider failed');

    expect(plugin.vectorStore).toBe(previousVectorStore);
    expect(plugin.knowledgeGraphStore).toBe(previousKnowledgeGraphStore);
    expect(plugin.embeddingProvider).toBe(previousEmbeddingProvider);
    expect(plugin.ragEngine).toBe(previousRagEngine);
    expect(plugin.graphRagIndexingRunner).toBe(previousGraphRagRunner);
    expect(plugin.vaultIndexer).toBe(previousVaultIndexer);
    expect(plugin.ragIndexingScheduler).toBe(previousScheduler);
    expect(previousVectorStore.close).not.toHaveBeenCalled();
    expect(previousKnowledgeGraphStore.close).not.toHaveBeenCalled();
    expect(previousEmbeddingProvider.close).not.toHaveBeenCalled();
  });

  it('GraphRAG 자동 동기화 설정 간격으로 실제 scheduler를 실행한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    vi.useFakeTimers();
    try {
      const maybeAutoSyncGraphRag = vi.fn(() => Promise.resolve());
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        settings: typeof DEFAULT_SETTINGS;
        graphAutoSyncTimer: number | null;
        graphAutoSyncFailureCount: number;
        graphAutoSyncNextAllowedAt: number;
        maybeAutoSyncGraphRag: typeof maybeAutoSyncGraphRag;
        setupGraphRagAutoSync(): void;
      };
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          graphRagEnabled: true,
          graphRagAutoSyncEnabled: true,
          graphRagAutoSyncIntervalMin: 2,
        },
      };
      plugin.graphAutoSyncTimer = null;
      plugin.graphAutoSyncFailureCount = 0;
      plugin.graphAutoSyncNextAllowedAt = 0;
      plugin.maybeAutoSyncGraphRag = maybeAutoSyncGraphRag;

      plugin.setupGraphRagAutoSync();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(maybeAutoSyncGraphRag).toHaveBeenCalledOnce();
      if (plugin.graphAutoSyncTimer) window.clearInterval(plugin.graphAutoSyncTimer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('GraphRAG 자동 동기화 실패 backoff는 반복 호출 간격을 늘리고 상한을 지킨다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00Z'));
    try {
      const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
        settings: typeof DEFAULT_SETTINGS;
        graphAutoSyncFailureCount: number;
        graphAutoSyncNextAllowedAt: number;
        scheduleGraphAutoSyncBackoff(): void;
      };
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        rag: {
          ...DEFAULT_SETTINGS.rag,
          graphRagAutoSyncIntervalMin: 10,
        },
      };
      plugin.graphAutoSyncFailureCount = 0;
      plugin.graphAutoSyncNextAllowedAt = 0;

      plugin.scheduleGraphAutoSyncBackoff();
      expect(plugin.graphAutoSyncFailureCount).toBe(1);
      expect(plugin.graphAutoSyncNextAllowedAt - Date.now()).toBe(20 * 60_000);

      for (let index = 0; index < 8; index++) plugin.scheduleGraphAutoSyncBackoff();
      expect(plugin.graphAutoSyncNextAllowedAt - Date.now()).toBe(6 * 60 * 60_000);
    } finally {
      vi.useRealTimers();
    }
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
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
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

  it('설정 로드 시 동작하지 않던 레거시 ontologyEnabled 값을 제거한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      rag: { ...DEFAULT_SETTINGS.rag, ontologyEnabled: false },
    };
    const app = createApp({ localSettings: legacySettings });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect('ontologyEnabled' in plugin.settings.rag).toBe(false);
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

  it('GraphRAG 동시 요청 수를 안전 범위로 정규화한다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const oldSettings = {
      ...DEFAULT_SETTINGS,
      rag: { ...DEFAULT_SETTINGS.rag },
    };
    delete (oldSettings.rag as Partial<typeof DEFAULT_SETTINGS.rag>).graphRagMaxConcurrentRequests;
    const app = createApp({ localSettings: oldSettings });
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: ReturnType<typeof createApp>;
      loadData: ReturnType<typeof vi.fn>;
      settings: typeof DEFAULT_SETTINGS;
    };
    plugin.app = app;
    plugin.loadData = vi.fn();

    await plugin.loadSettings();

    expect(plugin.settings.rag.graphRagMaxConcurrentRequests).toBe(1);
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

  it('localStorage 설정이 없으면 data.json에서 복구하고 localStorage에도 다시 저장한다', async () => {
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
    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      'superpower-inside:settings',
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: 'legacy-key' }),
      }),
    );
    expect(app.vault.adapter.remove).not.toHaveBeenCalled();
    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        openai: expect.objectContaining({ apiKey: 'legacy-key' }),
      }),
    );
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
      knowledgeGraphStore: {
        clear: ReturnType<typeof vi.fn>;
        deleteDatabase: ReturnType<typeof vi.fn>;
      };
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
    const knowledgeGraphStore = {
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
    plugin.knowledgeGraphStore = knowledgeGraphStore;
    plugin.bm25Index = bm25Index;
    plugin.embeddingProvider = embeddingProvider;
    plugin.createIndexedDbName = (kind: string) => `superpower-inside:UnitVault:${kind}`;

    await plugin.resetPluginData();

    expect(vectorStore.deleteDatabase).toHaveBeenCalledOnce();
    expect(knowledgeGraphStore.deleteDatabase).toHaveBeenCalledOnce();
    expect(bm25Index.deleteDatabase).toHaveBeenCalledOnce();
    expect(vectorStore.clear).not.toHaveBeenCalled();
    expect(knowledgeGraphStore.clear).not.toHaveBeenCalled();
    expect(bm25Index.clear).not.toHaveBeenCalled();
    expect(embeddingProvider.deleteDatabase).toHaveBeenCalledOnce();
    expect(embeddingProvider.clearCache).not.toHaveBeenCalled();
    expect(app.vault.adapter.rmdir).toHaveBeenCalledWith('.superpower-inside', true);
    expect(app.vault.adapter.remove).not.toHaveBeenCalledWith('Notes/user-note.md');
    expect(app.saveLocalStorage).toHaveBeenCalledWith(
      'superpower-inside:settings',
      DEFAULT_SETTINGS,
    );
    expect(plugin.saveData).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(plugin.settings.openai.apiKey).toBe('');
    expect(plugin.initMCP).toHaveBeenCalledOnce();
    expect(plugin.refreshBus.emit).toHaveBeenCalledWith('rag', {
      status: 'success',
      detail: 'Plugin data reset',
    });
  });
});

describe('SuperpowerInsidePlugin agent diagnostics view', () => {
  it('keeps background file diagnostics stopped when diagnostics are disabled', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const service = {
      setEnabled: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      settings: typeof DEFAULT_SETTINGS;
      agentDiagnosticsService: typeof service | null;
      getOrCreateAgentDiagnosticsService: () => typeof service;
    };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      agentDiagnostics: { enabled: false },
    };
    plugin.agentDiagnosticsService = null;
    plugin.getOrCreateAgentDiagnosticsService = () => service;

    await (
      plugin as unknown as {
        configureAgentDiagnosticsService(): Promise<void>;
      }
    ).configureAgentDiagnosticsService();

    expect(service.setEnabled).toHaveBeenCalledWith(false);
  });

  it('applies the diagnostics safe mode flag before startup work can re-enter RAG', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const writtenSettings: unknown[] = [];
    const adapter = {
      exists: vi.fn(() => Promise.resolve(true)),
      read: vi.fn(() => Promise.resolve(JSON.stringify({ enabled: true }))),
    };
    const logger = {
      warn: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: {
        vault: { configDir: string; adapter: typeof adapter };
        saveLocalStorage: ReturnType<typeof vi.fn>;
      };
      manifest: { id: string };
      settings: typeof DEFAULT_SETTINGS;
      saveData: (settings: unknown) => Promise<void>;
      getLogger: () => typeof logger;
    };
    plugin.app = { vault: { configDir: '.obsidian', adapter }, saveLocalStorage: vi.fn() };
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rag: {
        ...DEFAULT_SETTINGS.rag,
        autoUpdateEnabled: true,
        enableBM25: true,
        structuralGraphEnabled: true,
        annEnabled: true,
        graphRagAutoSyncEnabled: true,
      },
    };
    plugin.saveData = (settings: unknown) => {
      writtenSettings.push(settings);
      return Promise.resolve();
    };
    plugin.getLogger = () => logger;

    await (
      plugin as unknown as {
        applyAgentDiagnosticsSafeModeFlag(): Promise<void>;
      }
    ).applyAgentDiagnosticsSafeModeFlag();

    expect(plugin.settings.rag).toEqual(
      expect.objectContaining({
        autoUpdateEnabled: false,
        enableBM25: false,
        structuralGraphEnabled: false,
        annEnabled: false,
        graphRagAutoSyncEnabled: false,
      }),
    );
    expect(writtenSettings).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Agent diagnostics safe mode flag applied.',
      expect.objectContaining({ source: 'diagnostics' }),
    );
  });

  it('writes the diagnostics safe mode flag from the recovery action', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const files = new Map<string, string>();
    const adapter = {
      exists: vi.fn((path: string) => Promise.resolve(files.has(path))),
      read: vi.fn((path: string) => Promise.resolve(files.get(path) ?? 'null')),
      mkdir: vi.fn(() => Promise.resolve()),
      write: vi.fn((path: string, data: string) => {
        files.set(path, data);
        return Promise.resolve();
      }),
      rename: vi.fn((oldPath: string, newPath: string) => {
        const data = files.get(oldPath);
        if (data === undefined) return Promise.reject(new Error(`Missing ${oldPath}`));
        files.set(newPath, data);
        files.delete(oldPath);
        return Promise.resolve();
      }),
      remove: vi.fn((path: string) => {
        files.delete(path);
        return Promise.resolve();
      }),
    };
    const logger = {
      warn: vi.fn(),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: {
        vault: { configDir: string; adapter: typeof adapter };
        saveLocalStorage: ReturnType<typeof vi.fn>;
      };
      manifest: { id: string };
      settings: typeof DEFAULT_SETTINGS;
      saveData: (settings: unknown) => Promise<void>;
      getLogger: () => typeof logger;
      writeAgentDiagnosticsSnapshot: ReturnType<typeof vi.fn>;
    };
    plugin.app = { vault: { configDir: '.obsidian', adapter }, saveLocalStorage: vi.fn() };
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      rag: {
        ...DEFAULT_SETTINGS.rag,
        autoUpdateEnabled: true,
        enableBM25: true,
        structuralGraphEnabled: true,
        annEnabled: true,
        graphRagAutoSyncEnabled: true,
      },
    };
    plugin.saveData = () => Promise.resolve();
    plugin.getLogger = () => logger;
    plugin.writeAgentDiagnosticsSnapshot = vi.fn(() => Promise.resolve());

    await plugin.enableAgentDiagnosticsSafeMode();

    expect(files.get('.obsidian/plugins/superpower-inside/agent-diagnostics-safe-mode.json')).toBe(
      JSON.stringify({ enabled: true }),
    );
    expect(plugin.settings.rag).toEqual(
      expect.objectContaining({
        autoUpdateEnabled: false,
        enableBM25: false,
        structuralGraphEnabled: false,
        annEnabled: false,
        graphRagAutoSyncEnabled: false,
      }),
    );
    expect(plugin.writeAgentDiagnosticsSnapshot).toHaveBeenCalledWith('safe-mode-enabled');
  });

  it('reuses a readable root workspace diagnostics leaf', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { AGENT_DIAGNOSTICS_VIEW_TYPE } = await import('./src/diagnostics/view');
    const root = { kind: 'root' };
    const existingLeaf = createWorkspaceLeaf(root, 640);
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [existingLeaf]),
      getMostRecentLeaf: vi.fn(),
      setActiveLeaf: vi.fn(),
      getLeaf: vi.fn(),
      createLeafBySplit: vi.fn(),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    plugin.openAgentDiagnosticsView();

    expect(workspace.getLeavesOfType).toHaveBeenCalledWith(AGENT_DIAGNOSTICS_VIEW_TYPE);
    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(existingLeaf.detach).not.toHaveBeenCalled();
    expect(workspace.getLeaf).not.toHaveBeenCalled();
  });

  it('replaces sidebar or too narrow diagnostics leaves with a root workspace tab', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { AGENT_DIAGNOSTICS_VIEW_TYPE } = await import('./src/diagnostics/view');
    const root = { kind: 'root' };
    const sideRoot = { kind: 'right-sidebar' };
    const sidebarLeaf = createWorkspaceLeaf(sideRoot, 420);
    const narrowRootLeaf = createWorkspaceLeaf(root, 52);
    const recentRootLeaf = createWorkspaceLeaf(root, 720);
    const newLeaf = createWorkspaceLeaf(root, 720);
    const workspace = {
      rootSplit: root,
      getLeavesOfType: vi.fn(() => [sidebarLeaf, narrowRootLeaf]),
      getMostRecentLeaf: vi.fn(() => recentRootLeaf),
      setActiveLeaf: vi.fn(),
      getLeaf: vi.fn(() => newLeaf),
      createLeafBySplit: vi.fn(),
      revealLeaf: vi.fn(() => Promise.resolve()),
    };
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin & {
      app: { workspace: typeof workspace };
    };
    plugin.app = { workspace };

    plugin.openAgentDiagnosticsView();

    expect(sidebarLeaf.detach).toHaveBeenCalledOnce();
    expect(narrowRootLeaf.detach).toHaveBeenCalledOnce();
    expect(workspace.setActiveLeaf).toHaveBeenCalledWith(recentRootLeaf, { focus: false });
    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(newLeaf.setViewState).toHaveBeenCalledWith({
      type: AGENT_DIAGNOSTICS_VIEW_TYPE,
      active: true,
    });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
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
    getFiles: vi.fn(() => []),
    getMarkdownFiles: vi.fn(() => []),
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

function createGraphRagStatus(
  override: Partial<GraphRagStatusSummary> = {},
): GraphRagStatusSummary {
  return {
    state: 'ready',
    totalCandidateFiles: 0,
    graphEvidenceCount: 0,
    rejectedFactCount: 0,
    failedFileCount: 0,
    pendingMergeCount: 0,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun: 50,
    ...override,
  };
}
