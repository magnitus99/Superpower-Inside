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
      rag: { ...DEFAULT_SETTINGS.rag, enableBM25: true },
    };

    await plugin.initRAG();

    expect(app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
    expect(app.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
    expect(app.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
  });

  it('BM25 load failure does not block the vector RAG runtime', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
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
      runRagRuntimeInitStep: ReturnType<
        typeof vi.fn<(stage: string, operation: () => Promise<unknown>) => Promise<unknown>>
      >;
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
      rag: { ...DEFAULT_SETTINGS.rag, enableBM25: true },
    };
    plugin.getLogger = vi.fn(() => logger);
    plugin.runRagRuntimeInitStep = vi.fn((stage, operation) => {
      if (stage === 'bm25-load') {
        return Promise.reject(new Error('BM25 stuck'));
      }
      return operation();
    });

    await (
      plugin as unknown as {
        initRAGRuntime(): Promise<void>;
      }
    ).initRAGRuntime();

    expect(plugin.bm25Index).toBeNull();
    expect(plugin.ragEngine).not.toBeNull();
    expect(plugin.vaultIndexer).not.toBeNull();
    expect(plugin.ragIndexingScheduler).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'BM25 index initialization failed; continuing without BM25.',
      expect.objectContaining({ source: 'rag.bm25' }),
    );
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
      rag: { ...DEFAULT_SETTINGS.rag, enableBM25: true },
    };

    await plugin.initRAG();
    await plugin.initRAG();

    expect(app.vault.offref).toHaveBeenCalledTimes(3);
    expect(app.vault.on).toHaveBeenCalledTimes(6);
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
    const previousVectorStore = { kind: 'previous-vector-store' };
    const previousKnowledgeGraphStore = { kind: 'previous-graph-store' };
    const previousEmbeddingProvider = { kind: 'previous-embedding-provider' };
    const previousRagEngine = { kind: 'previous-rag-engine' };
    const previousGraphRagRunner = { kind: 'previous-graph-runner' };
    const previousVaultIndexer = { kind: 'previous-vault-indexer' };
    const previousScheduler = { cancel: vi.fn() };

    plugin.app = createApp();
    plugin.manifest = { id: 'superpower-inside' };
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'test-key' },
      rag: {
        ...DEFAULT_SETTINGS.rag,
        autoUpdateEnabled: false,
        graphRagEnabled: false,
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
    plugin.createProviderForModel = vi.fn(() => {
      throw new Error('graph provider failed');
    });

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

    expect(plugin.settings.rag.embeddingProvider).toBe('openai');
    expect(plugin.settings.rag.embeddingModel).toBe('text-embedding-3-small');
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
      embeddingProvider: { clearCache: ReturnType<typeof vi.fn>; deleteDatabase: ReturnType<typeof vi.fn> };
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
    expect(app.saveLocalStorage).toHaveBeenCalledWith('superpower-inside:settings', DEFAULT_SETTINGS);
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
