import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { createFakeSecretStorage } from './src/test/secret-storage';
import type { RagStatusSummary } from './src/rag/status';
import type { IndexedDbVectorStore } from './src/rag/store';

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
    Plugin: class {
      saveData(): Promise<void> { return Promise.resolve(); }
    },
    PluginSettingTab: class {},
    Setting: ChainableSetting,
    TFile: MockTFile,
    TFolder: MockTFolder,
    WorkspaceLeaf: class {},
    getLanguage: () => 'en',
    normalizePath: (path: string) => path.replace(/\\/gu, '/'),
    requestUrl: vi.fn(),
  };
});

describe('SuperpowerInsidePlugin RAG runtime', () => {
  it.each(['retire', 'unload', 'building-cancel'] as const)('BM25 physical load는 %s drain까지 정착을 보호한다', async (boundary) => {
    const plugin = await lexicalRuntime();
    const { RagRuntimeWorkBarrier } = await import('./src/rag/runtime-generation');
    const runtime = { ...plugin['captureRagRuntimeSnapshot'](), io: new RagRuntimeWorkBarrier(), ragEngine: null };
    let finish!: () => void;
    const load = vi.spyOn(runtime.bm25Index!, 'load').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const close = vi.spyOn(runtime.bm25Index!, 'close');
    const corpusClose = vi.spyOn(runtime.documentCorpus!, 'close');
    const loading = plugin['startBM25BackgroundLoad'](runtime.bm25Index!, runtime);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    if (boundary === 'unload') Object.assign(plugin, { unloaded: true });
    if (boundary === 'building-cancel') { plugin['buildingRagRuntime'] = runtime; plugin.cancelRagIndexing({ byUser: true }); }
    const drain = plugin['drainRagRuntimeSnapshot'](runtime);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(close).not.toHaveBeenCalled(); expect(corpusClose).not.toHaveBeenCalled();
    } finally { finish(); await loading; await drain; load.mockRestore(); }
    expect(close).toHaveBeenCalledOnce();
  });

  it('chat recovery의 실제 Promise와 legacy barrier는 retire까지 store를 보존한다', async () => {
    const plugin = await lexicalRuntime();
    plugin['activeRagRuntime'] = null;
    vi.spyOn(plugin.bm25Index!, 'hasFailure', 'get').mockReturnValue(true);
    let finish!: () => void;
    const recovery = vi.spyOn(plugin.bm25Index!, 'recoverClosedWorker').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const preparing = plugin.prepareRagForChat();
    await vi.waitFor(() => expect(recovery).toHaveBeenCalledOnce());
    const runtime = plugin['captureRagRuntimeSnapshot']();
    const close = vi.spyOn(runtime.documentCorpus!, 'close');
    const drain = plugin['drainRagRuntimeSnapshot'](runtime);
    try { await new Promise((resolve) => setTimeout(resolve, 10)); expect(close).not.toHaveBeenCalled(); }
    finally { finish(); await preparing; await drain; recovery.mockRestore(); }
    expect(close).toHaveBeenCalledOnce();
  });

  it('사용자 중단 뒤 scheduled/chat BM25 자동복구를 시작하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    plugin.cancelRagIndexing({ byUser: true });
    const recover = vi.spyOn(plugin.bm25Index!, 'recoverClosedWorker');
    plugin['scheduleBm25WorkerRecovery']();
    await plugin.prepareRagForChat();
    expect(recover).not.toHaveBeenCalled();
    await plugin['drainRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
  });

  it('scripted worker late initialize ACK는 host retire의 physical drain 뒤에만 닫힌다', async () => {
    const plugin = await lexicalRuntime();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const { RagRuntimeWorkBarrier } = await import('./src/rag/runtime-generation');
    const Dexie = (await import('dexie')).default;
    type Request = import('./src/rag/bm25-worker-runtime').BM25WorkerRequest;
    type Response = import('./src/rag/bm25-worker-runtime').BM25WorkerResponse;
    let initialize!: Request;
    let respond!: (event: MessageEvent<Response>) => void;
    const dispose = vi.fn();
    const name = 'synthetic-host-late-ack-' + crypto.randomUUID();
    const index = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: () => ({
      worker: { terminate: vi.fn(), postMessage: (message) => { initialize = message; }, setOnMessage: (handler) => { respond = handler; }, setOnError: () => undefined }, dispose,
    }) });
    const runtime = { ...plugin['captureRagRuntimeSnapshot'](), io: new RagRuntimeWorkBarrier(), bm25Index: index, ragEngine: null, documentCorpus: null, vaultDocumentCorpus: null };
    const oldEngine = plugin.ragEngine;
    const oldClose = vi.spyOn(plugin.documentCorpus!, 'close');
    const observe = vi.spyOn(plugin as never as { observeRagRuntimeWork(...args: unknown[]): void }, 'observeRagRuntimeWork');
    const close = vi.spyOn(index, 'close');
    const loading = plugin['startBM25BackgroundLoad'](index, runtime);
    await vi.waitFor(() => expect(initialize?.operation).toBe('initialize'));
    const drain = plugin['drainRagRuntimeSnapshot'](runtime);
    const calls = observe.mock.calls.length;
    const ack = (): void => respond({ data: { id: initialize.id, sessionId: initialize.sessionId, appliedRevision: 0, pendingRevision: null, nextPart: 0, ready: true, tokenizerCurrent: true, totalDocs: 0 } } as MessageEvent<Response>);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(close).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled();
      ack();
      expect((await loading).error).toBeNull();
      await drain;
      expect(close).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
      ack();
      expect(observe.mock.calls.length).toBe(calls);
      expect(plugin.ragEngine).toBe(oldEngine); expect(oldClose).not.toHaveBeenCalled();
    } finally {
      ack(); await loading; await drain; observe.mockRestore();
      await plugin['drainRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
      await Dexie.delete(name);
    }
  });

  it('BM25 load barrier 밖 checkpoint는 자신을 기다리지 않고 완료한다', async () => {
    const plugin = await lexicalRuntime();
    const runtime = plugin['captureRagRuntimeSnapshot']();
    const loading = plugin['startBM25BackgroundLoad'](runtime.bm25Index!, runtime);
    const checkpoint = runtime.io!.checkpoint(async (stable) => {
      expect((await loading).error).toBeNull(); expect(stable()).toBe(true);
    });
    await checkpoint;
    await plugin['drainRagRuntimeSnapshot'](runtime);
  });

  it('scheduled BM25 복구는 한 기회에 최대 두 번만 실행한다', async () => {
    const plugin = await lexicalRuntime();
    Object.assign(plugin, { bm25RecoveryAttempts: 0, bm25RecoveryInFlight: false, bm25RecoveryExhausted: false });
    const recovery = vi.spyOn(plugin.bm25Index!, 'recoverClosedWorker').mockRejectedValue(new Error('synthetic worker failure'));
    // 실제 실패 상태를 대신해 ready getter만 고정합니다. 복구 횟수/lease/barrier는 host 구현입니다.
    const ready = vi.spyOn(plugin.bm25Index!, 'isReady', 'get').mockReturnValue(false);
    for (let attempt = 0; attempt < 3; attempt++) {
      plugin['scheduleBm25WorkerRecovery']();
      await vi.waitFor(() => expect(plugin['bm25RecoveryInFlight']).toBe(false));
    }
    expect(recovery).toHaveBeenCalledTimes(2);
    expect(plugin['bm25RecoveryExhausted']).toBe(true);
    recovery.mockRestore(); ready.mockRestore();
    await plugin['drainRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
  });

  it('scheduled recovery 대기 중 retire는 store와 진행/proof를 보존한다', async () => {
    const plugin = await lexicalRuntime();
    Object.assign(plugin, { bm25RecoveryAttempts: 0, bm25RecoveryInFlight: false, bm25RecoveryExhausted: false, refreshBus: { emit: vi.fn() } });
    let finish!: () => void;
    const recovery = vi.spyOn(plugin.bm25Index!, 'recoverClosedWorker').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const runtime = plugin['captureRagRuntimeSnapshot']();
    const generation = runtime.generation;
    const close = vi.spyOn(runtime.documentCorpus!, 'close');
    plugin['scheduleBm25WorkerRecovery']();
    await vi.waitFor(() => expect(recovery).toHaveBeenCalledOnce());
    const drain = plugin['drainRagRuntimeSnapshot'](runtime);
    try { await new Promise((resolve) => setTimeout(resolve, 10)); expect(close).not.toHaveBeenCalled(); }
    finally { finish(); await drain; recovery.mockRestore(); }
    expect(plugin['activeRagRuntime']!.generation).toEqual(generation);
    expect(plugin.refreshBus.emit).not.toHaveBeenCalled();
  });

  it('정상 chat 준비는 BM25 no-op 복구로 read currentness를 무효화하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const runtime = plugin['captureRagRuntimeSnapshot']();
    const current = runtime.io!.captureReadSnapshot();
    await plugin.prepareRagForChat();
    expect(current()).toBe(true);
    await plugin['drainRagRuntimeSnapshot'](runtime);
  });

  it.each(['building-cancel', 'unload'] as const)('실제 새 building의 지연 load는 %s 뒤 정착 전에 닫히지 않는다', async (boundary) => {
    const plugin = await lexicalRuntime();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const oldEngine = plugin.ragEngine;
    const original = IndexedDbBM25Index.prototype.load;
    let finish!: () => void;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index, observer) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this, observer).then(resolve, reject); }; });
    });
    const building = plugin.rebuildRagGeneration().catch(() => undefined);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    const runtime = plugin['buildingRagRuntime']!;
    const close = vi.spyOn(runtime.bm25Index!, 'close');
    const corpusClose = vi.spyOn(runtime.documentCorpus!, 'close');
    if (boundary === 'building-cancel') plugin.cancelRagIndexing({ byUser: true });
    else {
      Object.assign(plugin, { mcpRetryTimers: new Map(), mcpConnectionRunId: 0, refreshBus: { emit: vi.fn(), destroy: vi.fn() } });
      plugin.onunload();
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(close).not.toHaveBeenCalled(); expect(corpusClose).not.toHaveBeenCalled();
      if (boundary === 'building-cancel') expect(plugin.ragEngine).toBe(oldEngine);
    } finally { finish(); await building; load.mockRestore(); }
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    if (boundary === 'building-cancel') {
      expect(plugin.ragEngine).toBe(oldEngine);
      expect(plugin['ragAutoRecoveryPausedByUser']).toBe(true);
      await plugin['drainRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
    }
  });

  it('닫힌 barrier의 퇴역 owner는 snapshot 복원으로 다시 admission하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const runtime = plugin['captureRagRuntimeSnapshot']();
    const drain = plugin['drainRagRuntimeSnapshot'](runtime);
    expect(plugin['restoreRagRuntimeSnapshot'](runtime)).toBe(false);
    await drain;
  });

  it('기존 초기화 오류와 기록된 단계를 공통 실패 요약으로 전달한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { lastRagRuntimeInitError: 'Synthetic arbitrary initialization failure', lastRagRuntimeInitStage: 'synthetic-init-step' });
    const generation = { revision: 0, coverage: null, semanticAvailable: false, availability: 'failed' as const, serving: null, building: { generation: null, status: 'failed' as const, indexing: null } };
    expect(plugin.getRagIndexingProgressSummary(generation)).toMatchObject({ lastInitError: plugin.lastRagRuntimeInitError, lastInitStage: plugin.lastRagRuntimeInitStage });
    plugin.lastRagRuntimeInitError = null;
    plugin.lastRagRuntimeInitStage = null;
    expect(plugin.getRagIndexingProgressSummary(generation)?.lastInitError ?? null).toBeNull();
  });

  async function lexicalRuntime(options: Parameters<typeof createApp>[0] = {}) {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: createApp(options), manifest: { id: 'superpower-inside' }, settings: {
      ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true },
    } });
    await plugin.initRAG();
    return plugin;
  }

  it.each([
    { mode: 'legacy', fail: false }, { mode: 'persisted', fail: false },
    { mode: 'legacy', fail: true }, { mode: 'persisted', fail: true },
  ] as const)('$mode 복원 fail=$fail은 실제 작업과 현재 원인을 게시한다', async ({ mode, fail }) => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const { IndexedDbDocumentCorpusStore } = await import('./src/rag/document-corpus-store');
    const { createRagStorageLayout } = await import('./src/rag/storage-lifecycle');
    const first = mode === 'persisted' ? await lexicalRuntime() : null;
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: first?.app ?? createApp(), manifest: { id: 'superpower-inside' }, settings: first ? structuredClone(first.settings) : {
      ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true },
    } });
    let legacyCorpus: InstanceType<typeof IndexedDbDocumentCorpusStore> | null = null;
    let legacyBm25: InstanceType<typeof IndexedDbBM25Index> | null = null;
    if (mode === 'legacy') {
      const layout = createRagStorageLayout({ pluginId: 'superpower-inside', vaultIdentity: plugin.app.vault.getName(), legacyVaultName: plugin.app.vault.getName(), embeddingNamespace: 'lexical-baseline', indexNamespace: 'idx-v4:' + plugin.settings.rag.chunkSize + ':' + plugin.settings.rag.overlap });
      legacyCorpus = new IndexedDbDocumentCorpusStore(layout.active.corpus);
      await legacyCorpus.replaceFileDocuments('synthetic-legacy.md', [], undefined, undefined, { sourceMtime: 1, sourceSize: 1, contentHash: 'synthetic-hash' });
      legacyBm25 = new IndexedDbBM25Index(layout.active.bm25);
      await legacyBm25.load();
    }
    let release!: () => void;
    let progress!: NonNullable<Parameters<IndexedDbBM25Index['load']>[0]>;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation((observer) => {
      progress = observer!;
      observer?.({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 0, totalUnits: 4096 });
      return new Promise<void>((resolve, reject) => { release = () => fail ? reject(new Error('synthetic restore unreachable')) : resolve(); });
    });
    plugin['ragRestoreFailure'] = { error: 'previous restore', stage: 'opening-storage' };
    const restoring = plugin['restorePersistedRagGeneration']();
    try {
      expect(plugin.getRagGenerationSnapshot()).toMatchObject({ restoring: true, restoreFailure: null });
      expect(plugin.getSearchStatusSnapshot().indexing?.work?.stage).toBe('opening-storage');
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      expect(plugin.getRagGenerationSnapshot().building).toBeNull();
      progress({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 128, totalUnits: 4096 });
      const snapshot = plugin.getSearchStatusSnapshot();
      expect(snapshot.indexing).toMatchObject({ activity: 'preparing', work: { stage: 'restoring-keyword-documents', processedUnits: 128, totalUnits: 4096 } });
      expect(plugin.getRagIndexingProgressSummary()?.work?.processedUnits).toBe(snapshot.indexing?.work?.processedUnits);
      plugin['lastBuildingGeneration'] = { ...plugin['restoringRagRuntime']!.generation!, terminal: 'failed' };
      plugin['lastBuildingGenerationSource'] = 'saved';
      plugin.lastRagRuntimeInitError = 'unrelated init error';
      expect(plugin.getRagIndexingProgressSummary()?.activity).toBe('preparing');
      release(); await restoring;
      expect(plugin.getRagGenerationSnapshot()).toMatchObject({ restoring: false, building: { source: 'saved' } });
      expect(plugin.lastRagRuntimeInitError).toBe('unrelated init error');
      if (fail) {
        expect(plugin.getRagGenerationSnapshot().restoreFailure).toMatchObject({ error: 'synthetic restore unreachable', stage: 'restoring-keyword-documents' });
        expect(plugin.getRagIndexingProgressSummary()).toMatchObject({ activity: 'failed', servingAvailable: true, failure: { source: 'restore', error: 'synthetic restore unreachable', stage: 'restoring-keyword-documents' } });
      } else {
        expect(plugin.getRagGenerationSnapshot().restoreFailure ?? null).toBeNull();
        expect(plugin.getRagIndexingProgressSummary()).toMatchObject({ failure: { source: 'saved', error: null, stage: null } });
      }
      expect(plugin.getRagIndexingProgressSummary()?.work ?? null).toBeNull();
      progress({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 256, totalUnits: 4096 });
      expect(plugin.getRagIndexingProgressSummary()?.work ?? null).toBeNull();
    } finally {
      release?.(); await restoring;
      load.mockRestore(); plugin['endRagRuntimeWork']();
      legacyCorpus?.close(); legacyBm25?.close();
      plugin.bm25Index?.close(); plugin.documentCorpus?.close();
      first?.['unregisterRAGEvents'](); first?.bm25Index?.close(); first?.documentCorpus?.close();
    }
  });

  it('검증된 검색 세대를 게시하면 이전 복원 오류를 남기지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const runtime = plugin['captureRagRuntimeSnapshot']();
    runtime.bm25Index!.addDocument('synthetic-restore-ready', 'synthetic restored evidence', 'synthetic.md');
    await runtime.bm25Index!.persist();
    plugin['ragRestoreFailure'] = { error: 'synthetic previous restore failure', stage: 'restoring-keyword-documents' };
    try {
      expect(runtime.bm25Index?.isReady).toBe(true);
      expect(plugin['restoreRagRuntimeSnapshot'](runtime)).toBe(true);
      expect(plugin.getRagGenerationSnapshot().restoreFailure).toBeNull();
    } finally { await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('복원 외부 실패도 현재 owner의 관측 단계로 기록한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { ragRuntimeInitRunId: 1 });
    const read = vi.fn().mockRejectedValue(new Error('synthetic manifest failure'));
    vi.spyOn(plugin as never, 'getRagGenerationManifest').mockReturnValue({ read } as never);
    try {
      await expect(plugin['restorePersistedRagGeneration']()).rejects.toThrow('synthetic manifest failure');
      expect(plugin.getRagGenerationSnapshot()).toMatchObject({
        restoring: false, availability: 'failed', restoreFailure: { error: 'synthetic manifest failure', stage: 'opening-storage' },
      });
    } finally { plugin['endRagRuntimeWork'](); }
  });

  it('복원 진단은 owner·실행·중단·unload 경계를 넘지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { IndexingCancelledError } = await import('./src/rag/indexer');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    const owner = {}, other = {};
    Object.assign(plugin, { ragRuntimeInitRunId: 1, ragRestoreOwner: owner });
    plugin['beginRagRuntimeWork'](owner);
    const record = (error: unknown = new Error('late restore')) => plugin['recordRagRestoreFailure'](error, owner, 1);
    try {
      record(new IndexingCancelledError());
      expect(plugin.getRagGenerationSnapshot().restoreFailure).toBeNull();
      for (const state of [
        { ragRestoreOwner: other }, { ragRuntimeInitRunId: 2 }, { unloaded: true },
        { ragResetInProgress: true }, { ragAutoRecoveryPausedByUser: true },
      ]) {
        Object.assign(plugin, state);
        record();
        expect(plugin.getRagGenerationSnapshot().restoreFailure).toBeNull();
        Object.assign(plugin, { ragRestoreOwner: owner, ragRuntimeInitRunId: 1, unloaded: false, ragResetInProgress: false, ragAutoRecoveryPausedByUser: false });
      }
      plugin['beginRagRuntimeWork'](other);
      record();
      expect(plugin.getRagGenerationSnapshot().restoreFailure).toBeNull();
      plugin['beginRagRuntimeWork'](owner);
      plugin['observeRagRuntimeWork'](owner, 'restoring-corpus', 'files');
      record();
      plugin['recordRagRestoreFailure'](new Error('secondary closed'), owner, 1);
      expect(plugin.getRagGenerationSnapshot().restoreFailure).toEqual({ error: 'late restore', stage: 'restoring-corpus' });
    } finally { plugin['endRagRuntimeWork'](); }
  });

  it('작업 owner 교체·중단·unload는 늦은 진척을 무시하되 기존 물리 drain을 종료하지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { ragRuntimeInitRunId: 1, refreshBus: { emit: vi.fn() } });
    const old = {}, current = {};
    plugin['beginRagRuntimeWork'](old);
    plugin['observeRagRuntimeWork'](old, 'restoring-keyword-documents', 'documents', 128, 4096);
    plugin['beginRagRuntimeWork'](current);
    plugin['observeRagRuntimeWork'](old, 'embedding', 'documents', 256, 4096);
    expect(plugin.getRagIndexingProgressSummary()?.work?.stage).toBe('opening-storage');
    let finish!: () => void;
    const physical = new Promise<void>((resolve) => { finish = resolve; });
    const settled = vi.fn(); void physical.then(settled);
    Object.assign(plugin, { pendingRagRuntimeDisposals: new Set([physical]) });
    plugin['settleRagRuntimeWork'](current);
    expect(plugin.getRagIndexingProgressSummary()?.work?.stage).toBe('cleanup');
    plugin['endRagRuntimeWork'](old);
    expect(plugin.getRagIndexingProgressSummary()?.work?.stage).toBe('cleanup');
    plugin.cancelRagIndexing();
    plugin['observeRagRuntimeWork'](current, 'embedding');
    expect(plugin.getRagIndexingProgressSummary()).toBeNull();
    expect(settled).not.toHaveBeenCalled();
    plugin['beginRagRuntimeWork'](current);
    finish(); await physical; await Promise.resolve();
    expect(settled).toHaveBeenCalledOnce();
    expect(plugin.getRagIndexingProgressSummary()?.work?.stage).toBe('opening-storage');
    Object.assign(plugin, { unloaded: true });
    expect(plugin.getRagIndexingProgressSummary()).toBeNull();
    plugin['endRagRuntimeWork']();
  });

  it('hydrate load 중 source 사건은 복사한 이전 complete를 다시 게시하지 않는다', async () => {
    const files: TFile[] = [];
    const contents = new Map<string, string>();
    const first = await lexicalRuntime({ files, contents });
    first['unregisterRAGEvents']();
    const { default: PluginClass } = await import('./main.ts');
    const { TFile } = await import('obsidian');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    await plugin['restorePersistedRagGeneration']();
    expect(plugin.getRagGenerationSnapshot().coverage).toBe('complete');
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; });
    });
    const initializing = plugin.initRAG();
    const file = Object.assign(new TFile(), { path: 'Synthetic/hydrate-added.md', basename: 'hydrate-added', extension: 'md', stat: { ctime: 1, mtime: 1, size: 1 } });
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      files.push(file);
      contents.set(file.path, 'x');
      plugin.app.vault.trigger('create', file);
      expect(plugin.getRagGenerationSnapshot().coverage).toBe('partial');
      finish();
      await initializing;
      expect(await plugin.documentCorpus!.getIndexedFilePaths()).not.toContain(file.path);
      expect(plugin.getRagGenerationSnapshot().coverage).toBe('partial');
      expect(plugin.getRagGenerationSnapshot().serving?.proof?.failures.some(({ path }) => path === file.path)).toBe(true);
    } finally { finish(); await initializing; load.mockRestore(); }
  });

  it('durable commit 직후 무효화는 이전 serving과 디스크 active를 함께 보존한다', async () => {
    const plugin = await lexicalRuntime();
    const previous = plugin.getRagGenerationSnapshot().serving!;
    const manifest = plugin['getRagGenerationManifest']();
    const original = manifest.commit.bind(manifest);
    const commit = vi.spyOn(manifest, 'commit').mockImplementation(async (...args) => {
      const revision = await original(...args);
      plugin['buildingRagRuntime']?.io?.invalidate();
      return revision;
    });
    try {
      await plugin.rebuildRagGeneration().catch(() => undefined);
      expect(commit).toHaveBeenCalledOnce();
      expect(plugin.getRagGenerationSnapshot().serving?.id).toBe(previous.id);
      expect((await manifest.read()).active?.id).toBe(previous.id);
      expect((await manifest.read()).building).toBeNull();
    } finally { commit.mockRestore(); }
  });

  it('old active checkpoint가 building을 보존한 revision은 새 build를 취소하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const previous = plugin['captureRagRuntimeSnapshot']();
    const manifest = plugin['getRagGenerationManifest']();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; });
    });
    const building = plugin.rebuildRagGeneration();
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      const began = await manifest.read();
      expect(began.building).not.toBeNull();
      await previous.io!.run(() => previous.documentCorpus!.replaceFileDocuments('Synthetic/old-checkpoint.md', []));
      await plugin['refreshRagRuntimeCheckpoint'](previous);
      const refreshed = await manifest.read();
      expect(refreshed.revision).toBeGreaterThan(began.revision);
      expect(refreshed.building?.id).toBe(began.building?.id);
      finish();
      await building;
      expect(plugin.getRagGenerationSnapshot().serving?.id).toBe(began.building?.id);
      expect((await manifest.read()).active?.id).toBe(began.building?.id);
    } finally { finish(); await building.catch(() => undefined); load.mockRestore(); }
  });

  it('old serving이 ready여도 초기 building 진행을 같은 검색 snapshot에 게시한다', async () => {
    const plugin = await lexicalRuntime();
    const serving = plugin.getRagGenerationSnapshot().serving!.id;
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; });
    });
    const building = plugin.rebuildRagGeneration();
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      const now = performance.now();
      const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
      try {
        const snapshot = plugin.getSearchStatusSnapshot();
        expect(snapshot.readiness).toBe('ready');
        expect(snapshot.generation.serving?.id).toBe(serving);
        expect(snapshot.generation.building?.status).toBe('building');
        expect(snapshot.indexing).toMatchObject({ activity: 'preparing', servingAvailable: true, totalFilesKnown: false, etaRemainingMs: null });
        expect(plugin.getRagIndexingProgressSummary()).toEqual(snapshot.indexing);
        clock.mockReturnValue(now + 1_000);
        const later = plugin.getRagIndexingProgressSummary();
        expect(later?.work?.elapsedMs).toBeCloseTo(snapshot.indexing!.work!.elapsedMs + 1_000, 4);
        expect(later?.work?.processedUnits).toBe(snapshot.indexing!.work!.processedUnits);
      } finally { clock.mockRestore(); }
      finish();
      await building;
      expect(plugin.getSearchStatusSnapshot().indexing).toBeNull();
    } finally { finish(); await building.catch(() => undefined); load.mockRestore(); }
  });

  it('실제 scheduler heartbeat는 모델 준비를 덮지 않고 준비 ACK 뒤 임베딩으로 돌아간다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const { TernlightRuntime } = await import('./src/llm/ternlight-runtime');
    const text = 'synthetic model preparation heartbeat evidence';
    const file = Object.assign(new TFile(), { path: 'Synthetic/model-heartbeat.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const profile = createOpenAiEmbeddingProfile('');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: createApp({ files: [file], contents: new Map([[file.path, text]]) }), manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [{ ...profile, id: 'local', strategy: 'ternlight', models: [{ ...profile.models[0], id: 'ternlight-base' }] }],
      rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: 'profile:local:ternlight-base' },
    } });
    let finishPreparation!: () => void;
    let finishInference!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const preparation = new Promise<void>((resolve) => { finishPreparation = resolve; });
    const inference = new Promise<void>((resolve) => { finishInference = resolve; });
    const embed = vi.spyOn(TernlightRuntime.prototype, 'embed').mockImplementation(async function (this: TernlightRuntime, texts) {
      this['options'].onPreparationProgress?.(0, 3);
      entered();
      await preparation;
      this['options'].onPreparationProgress?.(3, 3);
      await inference;
      return texts.map(() => [1, 0]);
    });
    const initializing = plugin.initRAG();
    try {
      await started;
      const scheduler = plugin['buildingRagRuntime']!.ragIndexingScheduler!;
      expect(plugin.getSearchStatusSnapshot().indexing?.work?.stage).toBe('loading-model');
      for (let pulse = 0; pulse < 3; pulse++) {
        scheduler['emitStatus']();
        expect(plugin.getSearchStatusSnapshot().indexing?.work).toMatchObject({ stage: 'loading-model', processedUnits: 0, totalUnits: 3 });
      }
      finishPreparation();
      await vi.waitFor(() => expect(plugin.getSearchStatusSnapshot().indexing?.work?.stage).toBe('embedding'));
      expect(embed).toHaveBeenCalledOnce();
      finishInference();
      await initializing;
    } finally { finishPreparation(); finishInference(); await initializing.catch(() => undefined); embed.mockRestore(); }
  });

  it('MAIN proof는 알려진 SourceReadError reason을 장식 메시지 없이 보존한다', async () => {
    const files: TFile[] = [];
    const plugin = await lexicalRuntime({ files });
    const { TFile } = await import('obsidian');
    const sourceSnapshot = await import('./src/rag/source-snapshot');
    const { SourceReadError } = await import('./src/rag/source-access');
    const file = Object.assign(new TFile(), { path: 'Synthetic/verification-failed.md', basename: 'verification-failed', extension: 'md', stat: { ctime: 1, mtime: 1, size: 1 } });
    files.push(file);
    const read = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot').mockRejectedValue(new SourceReadError('memory-budget'));
    try {
      const proof = await plugin['collectRagRuntimeProof'](plugin['captureRagRuntimeSnapshot'](), () => undefined, false);
      expect(proof.failures).toContainEqual({ path: file.path, reason: 'memory-budget' });
    } finally { read.mockRestore(); }
  });

  it('MAIN 완료 seal은 실제 corpus head와 현재 BM25 적용 checkpoint를 기록한다', async () => {
    const plugin = await lexicalRuntime();
    const saved = await plugin['getRagGenerationManifest']().read();
    const seal = saved.active?.proof?.seal;
    expect(seal?.corpus).toEqual(await plugin.documentCorpus!.getDurabilityReceipt());
    const lexical = await plugin.bm25Index!.getCheckpoint();
    expect(lexical.applied).not.toBeNull();
    expect(seal?.lexical).toEqual({ state: 'enabled', receipt: lexical.receipt, applied: { sessionId: lexical.applied!.sessionId, revision: lexical.applied!.revision } });
    expect(seal?.vector).toEqual({ state: 'disabled' });
    expect(saved.active?.contract.vectorMode).toBe('disabled');
    expect(plugin.getRagGenerationSnapshot().coverage).toBe('complete');
  });

  it('cold 현재 seal은 새 모델 없이 인증하고 다른 corpus mutation이면 제한 상태를 보존한다', async () => {
    const first = await lexicalRuntime();
    const { default: PluginClass } = await import('./main.ts');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    await second['restorePersistedRagGeneration']();
    expect(second.getRagGenerationSnapshot().coverage).toBe('complete');
    expect(second.embeddingProvider).toBeNull();
    await first.documentCorpus!.replaceFileDocuments('synthetic-extra.md', []);
    const third = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(third, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    await third['restorePersistedRagGeneration']();
    expect(third.getRagGenerationSnapshot().coverage).toBe('legacy-limited');
    expect(third.ragEngine).not.toBeNull();
    expect(third.embeddingProvider).toBeNull();
  });

  it('lexical modify는 동일 UUID의 저장소 seal을 새 source·BM25 checkpoint로 CAS 갱신한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const text = 'synthetic alpha';
    const file = Object.assign(new TFile(), { path: 'Synthetic/current.md', basename: 'current', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const contents = new Map([[file.path, text]]);
    const app = createApp({ files: [file], contents });
    Object.assign(app, { metadataCache: { getFileCache: () => null } });
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true } } });
    await plugin.initRAG();
    const manifest = plugin['getRagGenerationManifest']();
    const before = await manifest.read();
    contents.set(file.path, 'synthetic gamma');
    file.stat.mtime = 2;
    const callbacks = app.vault.on.mock.calls.filter(([name]) => name === 'modify');
    await Promise.all(callbacks.map(([, callback]) => (callback as (file: TFile) => unknown)(file)));
    await vi.waitFor(async () => {
      const after = await manifest.read();
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(after.active?.id).toBe(before.active?.id);
      expect(after.active?.proof?.seal?.corpus).toEqual(await plugin.documentCorpus!.getDurabilityReceipt());
      expect(after.active?.proof?.seal?.corpus.mutation).not.toBe(before.active?.proof?.seal?.corpus.mutation);
      expect(after.active?.terminal).toBe('complete');
    });
    expect(plugin.getRagGenerationSnapshot().coverage).toBe('complete');
    expect((await plugin.ragEngine!.query('gamma')).length).toBeGreaterThan(0);
  });

  it('cold source bytes는 mtime/size와 DB head가 같아도 다시 확인해 complete를 거절한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const text = 'synthetic alpha';
    const file = Object.assign(new TFile(), { path: 'Synthetic/hash.md', basename: 'hash', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const contents = new Map([[file.path, text]]);
    const app = createApp({ files: [file], contents });
    Object.assign(app, { metadataCache: { getFileCache: () => null } });
    const first = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(first, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true } } });
    await first.initRAG();
    const before = await first.documentCorpus!.getDurabilityReceipt();
    contents.set(file.path, 'synthetic gamma');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    await second['restorePersistedRagGeneration']();
    expect(await second.documentCorpus!.getDurabilityReceipt()).toEqual(before);
    expect(second.getRagGenerationSnapshot().coverage).toBe('partial');
    expect(second.getRagGenerationSnapshot().serving?.proof?.failures).toContainEqual({ path: file.path, reason: 'source-not-current-at-checkpoint' });
    expect(second.embeddingProvider).toBeNull();
  });

  it('정책만 바뀌어도 기존 complete를 재사용하지 않고 같은 UUID에서 다시 확인한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const text = 'synthetic policy body';
    const file = Object.assign(new TFile(), { path: 'Synthetic/policy.md', basename: 'policy', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const app = createApp({ files: [file], contents: new Map([[file.path, text]]) });
    Object.assign(app, { metadataCache: { getFileCache: () => null } });
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true } } });
    await plugin.initRAG();
    const before = plugin.getRagGenerationSnapshot();
    expect(before.coverage).toBe('complete');
    plugin.settings.rag.excludePaths = ['Synthetic'];
    expect(plugin.getRagGenerationSnapshot().coverage).toBe('partial');
    await plugin['refreshRagRuntimeCheckpoint'](plugin['captureRagRuntimeSnapshot']());
    const saved = await plugin['getRagGenerationManifest']().read();
    expect(saved.active?.id).toBe(before.serving?.id);
    expect(saved.active?.terminal).toBe('partial');
    expect(saved.active?.proof?.failures).toContainEqual({ path: file.path, reason: 'source-not-candidate' });
    expect(plugin.embeddingProvider).toBeNull();
  });

  async function livePartialCheckpointFixture() {
    const { TFile } = await import('obsidian');
    const text = 'synthetic live partial body';
    const file = Object.assign(new TFile(), { path: 'Synthetic/live-partial.md', basename: 'live-partial', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    const runtime = plugin['captureRagRuntimeSnapshot']();
    // Corrupt a real projection through its writer: the checkpoint must actually read the source
    // and retain the mismatch as partial, rather than certifying a mocked/empty complete proof.
    const row = (await plugin.documentCorpus!.getFileIndexRecords())[0];
    const documents = await plugin.documentCorpus!.getDocumentsByFilePath(file.path);
    await runtime.io!.run(() => plugin.documentCorpus!.replaceFileDocuments(file.path,
      documents.map((document) => ({ ...document, text: document.text + ' stale projection' })), row.sourceMetadata, row.sourceMetadataHash));
    await plugin['refreshRagRuntimeCheckpoint'](runtime);
    const manifest = plugin['getRagGenerationManifest']();
    const partial = await manifest.read();
    expect(partial.active?.terminal).toBe('partial');
    expect(partial.active?.proof?.failures).toContainEqual({ path: file.path, reason: 'lexical-projection-not-current' });
    return { plugin, runtime, manifest, partial, file };
  }

  it('원문 검증 워크플로: live partial의 무변이 checkpoint 반복은 scan과 manifest revision을 늘리지 않는다', async () => {
    const { plugin, runtime, manifest, partial } = await livePartialCheckpointFixture();
    const source = await import('./src/rag/source-snapshot');
    const read = vi.spyOn(source, 'readSourceFileSnapshot');
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    try {
      for (let request = 0; request < 3; request++) await plugin['refreshRagRuntimeCheckpoint'](runtime);
      const after = await manifest.read();
      expect.soft(collect.mock.calls.length).toBe(0);
      expect.soft(read.mock.calls.length).toBe(0);
      expect.soft(after.revision).toBe(partial.revision);
      expect(after.active).toEqual(partial.active);
      expect(plugin.getRagGenerationSnapshot().coverage).toBe('partial');
    } finally { read.mockRestore(); collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('원문 검증 워크플로: 진행 중 partial checkpoint의 동일 입력 중복 요청은 한 번만 정착한다', async () => {
    const { plugin, runtime, manifest, partial, file } = await livePartialCheckpointFixture();
    // A real corpus transaction requires one new verification while the projection remains partial.
    const documents = await plugin.documentCorpus!.getDocumentsByFilePath(file.path);
    const row = (await plugin.documentCorpus!.getFileIndexRecords()).find((record) => record.filePath === file.path)!;
    await runtime.io!.run(() => plugin.documentCorpus!.replaceFileDocuments(file.path, documents, row.sourceMetadata, row.sourceMetadataHash));
    const original = plugin['collectRagRuntimeProof'].bind(plugin);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    collect.mockImplementation(async (...args) => {
      await gate;
      return original(...args as Parameters<typeof original>);
    });
    const pending = plugin['refreshRagRuntimeCheckpoint'](runtime);
    try {
      await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
      const duplicates = Array.from({ length: 5 }, () => plugin['refreshRagRuntimeCheckpoint'](runtime));
      release();
      await Promise.all([pending, ...duplicates]);
      const after = await manifest.read();
      expect.soft(collect).toHaveBeenCalledOnce();
      expect.soft(after.revision).toBe(partial.revision + 1);
      expect(after.active?.terminal).toBe('partial');
      expect(after.active?.proof?.failures).toEqual(partial.active?.proof?.failures);
    } finally { release(); await pending; collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it.each(['source', 'policy', 'projection'] as const)('원문 검증 워크플로: live partial 뒤 %s 변경은 같은 seal 재사용으로 숨기지 않는다', async (change) => {
    const { plugin, runtime, manifest, partial, file } = await livePartialCheckpointFixture();
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    try {
      if (change === 'source') {
        // Keep stat and bytes unchanged: the observed event alone invalidates verification history.
        plugin['unregisterRAGEvents']();
        plugin.app.vault.trigger('modify', file);
      } else if (change === 'policy') plugin.settings.rag.excludePaths = ['Synthetic'];
      else {
        const documents = await plugin.documentCorpus!.getDocumentsByFilePath(file.path);
        const row = (await plugin.documentCorpus!.getFileIndexRecords())[0];
        await runtime.io!.run(() => plugin.documentCorpus!.replaceFileDocuments(file.path,
          documents.map((document) => ({ ...document, text: document.text + ' another mutation' })), row.sourceMetadata, row.sourceMetadataHash));
      }
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      const after = await manifest.read();
      expect(collect).toHaveBeenCalledOnce();
      expect(after.revision).toBe(partial.revision + 1);
      expect(after.active?.terminal).toBe('partial');
      expect(after.active?.proof?.failures).toContainEqual({ path: file.path, reason: change === 'policy' ? 'source-not-candidate' : 'lexical-projection-not-current' });
      if (change === 'projection') expect(after.active?.proof?.seal?.corpus).not.toEqual(partial.active?.proof?.seal?.corpus);
    } finally { collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it.each(['paused', 'unload'] as const)('원문 검증 워크플로: %s 뒤 partial checkpoint는 scan이나 manifest를 게시하지 않는다', async (boundary) => {
    const { plugin, runtime, manifest, partial } = await livePartialCheckpointFixture();
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    Object.assign(plugin, boundary === 'paused' ? { ragAutoRecoveryPausedByUser: true } : { unloaded: true });
    try {
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      expect(collect).not.toHaveBeenCalled();
      expect(await manifest.read()).toEqual(partial);
    } finally { collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('원문 검증 워크플로: CAS 거절된 partial proof는 다음 요청의 검증 이력으로 승격하지 않는다', async () => {
    const { plugin, runtime, manifest, partial } = await livePartialCheckpointFixture();
    plugin.settings.rag.excludePaths = ['Synthetic'];
    const cas = vi.spyOn(manifest, 'refreshActive').mockResolvedValueOnce(null);
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    try {
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      expect(await manifest.read()).toEqual(partial);
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      expect(collect).toHaveBeenCalledTimes(2);
      expect(cas).toHaveBeenCalledTimes(2);
      expect((await manifest.read()).revision).toBe(partial.revision + 1);
    } finally { cas.mockRestore(); collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it.each(['paused', 'unload', 'owner'] as const)('원문 검증 워크플로: 검증 도중 %s 교체는 늦은 partial proof 게시를 막는다', async (boundary) => {
    const { plugin, runtime, manifest, partial } = await livePartialCheckpointFixture();
    plugin.settings.rag.excludePaths = ['Synthetic'];
    const original = plugin['collectRagRuntimeProof'].bind(plugin);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const collect = vi.spyOn(plugin as never as { collectRagRuntimeProof(...args: unknown[]): Promise<unknown> }, 'collectRagRuntimeProof');
    let collected = false;
    collect.mockImplementation(async (...args) => {
      const proof = await original(...args as Parameters<typeof original>);
      collected = true;
      await gate;
      return proof;
    });
    const pending = plugin['refreshRagRuntimeCheckpoint'](runtime);
    try {
      await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
      // Wait for the real proof to finish, not merely for its spy to be entered.
      await vi.waitFor(() => expect(collected).toBe(true));
      if (boundary === 'paused') Object.assign(plugin, { ragAutoRecoveryPausedByUser: true });
      else if (boundary === 'unload') Object.assign(plugin, { unloaded: true });
      else plugin.ragEngine = null;
      release();
      await pending;
      expect(await manifest.read()).toEqual(partial);
    } finally { release(); await pending; collect.mockRestore(); await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('원문 검증 워크플로: cold partial 복원은 저장 seal이 같아도 새 BM25 session에서 원문을 읽는다', async () => {
    const { plugin, runtime, partial, file } = await livePartialCheckpointFixture();
    const { default: PluginClass } = await import('./main.ts');
    const source = await import('./src/rag/source-snapshot');
    const read = vi.spyOn(source, 'readSourceFileSnapshot');
    const restored = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(restored, { app: plugin.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(plugin.settings) });
    try {
      await restored['restorePersistedRagGeneration']();
      expect(read.mock.calls.some(([, current]) => current.path === file.path)).toBe(true);
      expect(restored.getRagGenerationSnapshot().coverage).toBe('partial');
      expect(restored.getRagGenerationSnapshot().serving?.proof?.failures).toEqual(partial.active?.proof?.failures);
      const checkpoint = await restored.bm25Index!.getCheckpoint();
      const previous = partial.active!.proof!.seal!.lexical;
      expect(previous.state).toBe('enabled');
      if (previous.state !== 'enabled') throw new Error('Synthetic lexical checkpoint missing');
      expect(checkpoint.applied?.sessionId).not.toBe(previous.applied.sessionId);
    } finally {
      read.mockRestore();
      await restored['drainRagRuntimeSnapshot'](restored['captureRagRuntimeSnapshot']());
      await plugin['drainRagRuntimeSnapshot'](runtime);
    }
  });

  async function denseReadWorkflowFixture() {
    const { TFile } = await import('obsidian');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const text = 'synthetic read currentness body';
    const file = Object.assign(new TFile(), { path: 'Synthetic/read-currentness.md', basename: 'read-currentness', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    plugin.settings.providerProfiles = [createOpenAiEmbeddingProfile('synthetic-key')];
    plugin.settings.rag = createRagWithEmbedding(plugin.settings.rag);
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    try {
      await plugin.startRagUpdate();
      expect(embed).toHaveBeenCalledOnce();
      expect(plugin.getRagGenerationSnapshot().coverage).toBe('complete');
    } finally { embed.mockRestore(); }
    plugin['automaticRagRecovery']!.dispose();
    return { plugin, runtime: plugin['captureRagRuntimeSnapshot'](), file };
  }

  it.each(['stats', 'automatic-count'] as const)('원문 검증 워크플로: 실제 무변이 %s 조회는 foreign read currentness를 유지한다', async (entry) => {
    const { plugin, runtime } = await denseReadWorkflowFixture();
    const current = plugin['captureRagReadCurrentness'](runtime);
    const seal = await plugin['readRagRuntimeSeal'](runtime);
    const manifest = await plugin['getRagGenerationManifest']().read();
    try {
      if (entry === 'stats') await plugin['computeAndEmitRagStats']();
      else expect(await plugin['automaticRagRecovery']!['host'].countPendingDocuments()).toMatchObject({ pendingDocumentCount: 0 });
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      expect.soft(current()).toBe(true);
      expect(await plugin['readRagRuntimeSeal'](runtime)).toEqual(seal);
      expect(await plugin['getRagGenerationManifest']().read()).toEqual(manifest);
    } finally { await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('원문 검증 워크플로: stats의 legacy file-index repair는 실제 write로 foreign read를 무효화한다', async () => {
    const { plugin, runtime, file } = await denseReadWorkflowFixture();
    const store = plugin.vectorStore as IndexedDbVectorStore;
    // Simulate the documented legacy shape (vectors present, file-index absent).
    await runtime.io!.run(() => store['db'].fileIndex.clear());
    const current = plugin['captureRagReadCurrentness'](runtime);
    const before = (await store.getDurabilityCheckpoint()).receipt;
    try {
      await plugin['computeAndEmitRagStats']();
      await plugin['refreshRagRuntimeCheckpoint'](runtime);
      expect(current()).toBe(false);
      expect((await store.getDurabilityCheckpoint()).receipt).not.toEqual(before);
      expect((await store.getFileIndexRecords()).map((row) => row.filePath)).toContain(file.path);
    } finally { await plugin['drainRagRuntimeSnapshot'](runtime); }
  });

  it('metadata changed는 같은 본문 alias를 다시 반영하고 새 seal을 발행한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const text = 'synthetic metadata body';
    const file = Object.assign(new TFile(), { path: 'Synthetic/alias.md', basename: 'alias', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const app = createApp({ files: [file], contents: new Map([[file.path, text]]) });
    let cache = { frontmatter: { aliases: ['previousalias'] } };
    const metadata = { getFileCache: () => cache, on: vi.fn((_event: string, callback: (file: TFile) => unknown) => ({ callback })), offref: vi.fn() };
    Object.assign(app, { metadataCache: metadata });
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true } } });
    await plugin.initRAG();
    const before = await plugin['getRagGenerationManifest']().read();
    cache = { frontmatter: { aliases: ['currentalias'] } };
    for (const result of metadata.on.mock.results) result.value.callback(file);
    await vi.waitFor(async () => {
      const documents = await plugin.documentCorpus!.getDocumentsByFilePath(file.path);
      expect(documents[0]?.aliases).toEqual(['currentalias']);
      const saved = await plugin['getRagGenerationManifest']().read();
      expect(saved.revision).toBeGreaterThan(before.revision);
      expect(saved.active?.terminal).toBe('complete');
      expect(saved.active?.proof?.seal?.corpus.mutation).not.toBe(before.active?.proof?.seal?.corpus.mutation);
    });
  });

  it('runtime drain은 실제 writer 작업이 정착하기 전에 저장소를 닫지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const runtime = plugin['captureRagRuntimeSnapshot']();
    let finish!: () => void;
    const writing = runtime.io!.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const close = vi.spyOn(plugin.documentCorpus!, 'close');
    const draining = plugin['drainRagRuntimeSnapshot'](runtime);
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    finish(); await writing; await draining;
    expect(close).toHaveBeenCalledOnce();
  });

  it('무모델 품질 snapshot은 cold lexical만 복원하고 모델·새 구축 없이 serving lease를 유지한다', async () => {
    const first = await lexicalRuntime();
    const { default: PluginClass } = await import('./main.ts');
    const { RAGQueryEngine } = await import('./src/rag/query');
    const { requestUrl } = await import('obsidian');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    const init = vi.spyOn(second, 'initRAG');
    const provider = vi.fn(() => { throw new Error('Unexpected model initialization'); });
    Object.assign(second, { createProviderForModel: provider });
    vi.mocked(requestUrl).mockClear();
    const snapshot = await second.acquireRagEngineOnlySnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ragEngine).toBeInstanceOf(RAGQueryEngine);
    expect(snapshot!.ragEngine).not.toBe(second.ragEngine);
    expect(snapshot!.documentCorpus).toBe(second.documentCorpus);
    expect(await snapshot!.ragEngine.query('synthetic')).toEqual([]);
    expect(init).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(requestUrl).not.toHaveBeenCalled();
    const close = vi.spyOn(second.documentCorpus!, 'close');
    second['disposeRagRuntimeSnapshot'](second['captureRagRuntimeSnapshot']());
    expect(close).not.toHaveBeenCalled();
    snapshot!.release();
    snapshot!.release();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('무모델 snapshot의 literal은 현재 원문 hash를 쓰고 handle 정리까지 serving을 유지한다', async () => {
    const { TFile } = await import('obsidian');
    const text = '항구시험의 항구시험은 항구시험을 항구시험이';
    const file = Object.assign(new TFile(), { path: 'Synthetic/literal.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: new TextEncoder().encode(text).length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    const snapshot = await plugin.acquireRagEngineOnlySnapshot();
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error('synthetic literal snapshot missing');
    let handle: Awaited<ReturnType<typeof snapshot.ragEngine.openLiteralInventory>> | undefined;
    try {
      handle = await snapshot.ragEngine.openLiteralInventory(['항구시험']);
      expect((await handle.getSummary()).needles[0]).toMatchObject({ documents: 1, matchingLines: 1, occurrences: 4 });
      expect((await handle.readPage(0))?.references).toHaveLength(4);
      const close = vi.spyOn(plugin.documentCorpus!, 'close');
      snapshot.release();
      plugin['disposeRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
      expect(close).not.toHaveBeenCalled();
      await handle.close();
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    } finally { await handle?.close(); snapshot.release(); }
  });

  it('구자료 raw 보충은 품질 snapshot이 아니라 명시 업데이트에서만 하고 청크를 보존한다', async () => {
    const { TFile } = await import('obsidian');
    const text = '항구시험의 항구시험은';
    const file = Object.assign(new TFile(), { path: 'Synthetic/backfill.md', name: 'backfill.md', basename: 'backfill', extension: 'md', stat: { ctime: 1, mtime: 1, size: new TextEncoder().encode(text).length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    const corpus = plugin.documentCorpus!;
    const documents = await corpus.getDocuments();
    const record = (await corpus.getFileIndexRecords())[0];
    await corpus.replaceBatchFileDocuments([{ filePath: file.path, documents, sourceMetadata: record.sourceMetadata, sourceMetadataHash: record.sourceMetadataHash }]);
    const before = await corpus.getDurabilityReceipt();
    const id = plugin.getRagGenerationSnapshot().serving?.id;
    plugin['ragAutoRecoveryPausedByUser'] = true;
    const snapshot = await plugin.acquireRagEngineOnlySnapshot();
    if (!snapshot) throw new Error('synthetic backfill snapshot missing');
    try { await expect(snapshot.ragEngine.openLiteralInventory(['항구시험'])).rejects.toThrow('source-body-unavailable'); }
    finally { snapshot.release(); }
    expect(await corpus.getDurabilityReceipt()).toEqual(before);
    expect((await corpus.getSourceBodyHeader(file.path))?.body).toBeNull();
    await plugin.startRagUpdate();
    expect((await corpus.getSourceBodyHeader(file.path))?.body).not.toBeNull();
    expect(await corpus.getDocuments()).toEqual(documents);
    expect(plugin.getRagGenerationSnapshot().serving?.id).toBe(id);
    const inventory = await plugin.ragEngine!.openLiteralInventory(['항구시험']);
    try { expect((await inventory.getSummary()).needles[0].occurrences).toBe(2); }
    finally { await inventory.close(); }
  });

  it('무모델 품질 snapshot은 serving이 없으면 새 구축 대신 null을 반환한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: createApp(), manifest: { id: 'superpower-inside' }, settings: structuredClone(DEFAULT_SETTINGS) });
    const init = vi.spyOn(plugin, 'initRAG');
    const provider = vi.fn(() => { throw new Error('Unexpected model initialization'); });
    Object.assign(plugin, { createProviderForModel: provider });
    await expect(plugin.acquireRagEngineOnlySnapshot()).resolves.toBeNull();
    expect(init).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('무모델 snapshot은 선택된 embedding provider가 있어도 실제 query/cache 경로를 호출하지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const { TFile } = await import('obsidian');
    const text = 'synthetic searchable body-marker';
    const file = Object.assign(new TFile(), { path: 'Synthetic/quality.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const app = createApp({ files: [file], contents: new Map([[file.path, text]]) });
    const batch = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embed').mockResolvedValue([1, 0]);
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag, { enableBM25: true, minScore: 0 }) } });
    try {
      await plugin.initRAG();
      const previous = { batch: batch.mock.calls.length, embed: embed.mock.calls.length };
      const snapshot = await plugin.acquireRagEngineOnlySnapshot();
      expect(snapshot).not.toBeNull();
      try { expect((await snapshot!.ragEngine.query('body-marker')).length).toBeGreaterThan(0); }
      finally { snapshot!.release(); }
      expect(batch).toHaveBeenCalledTimes(previous.batch);
      expect(embed).toHaveBeenCalledTimes(previous.embed);
    } finally { batch.mockRestore(); embed.mockRestore(); }
  });

  it('현재 hydrate 실패가 저장된 과거 실패에 가려지지 않고 manifest를 보존한다', async () => {
    const first = await lexicalRuntime();
    const { default: PluginClass } = await import('./main.ts');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    await second['restorePersistedRagGeneration']();
    const serving = second.getRagGenerationSnapshot().serving!;
    second['lastBuildingGeneration'] = { ...serving, id: crypto.randomUUID(), terminal: 'failed' };
    second['lastBuildingGenerationSource'] = 'saved';
    const manifest = second['getRagGenerationManifest']();
    const before = await manifest.read();
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockRejectedValueOnce(new Error('synthetic hydrate failure'));
    try {
      await expect(second.initRAG()).rejects.toThrow('synthetic hydrate failure');
      expect(second.getRagGenerationSnapshot()).toMatchObject({ serving: { id: serving.id }, building: { source: 'live', status: 'failed' } });
      expect(second.getRagIndexingProgressSummary()?.failure).toMatchObject({ source: 'init', error: 'synthetic hydrate failure' });
      expect(await manifest.read()).toEqual(before);
    } finally {
      load.mockRestore();
      first['unregisterRAGEvents'](); second['unregisterRAGEvents']();
      await first['drainRagRuntimeSnapshot'](first['captureRagRuntimeSnapshot']());
      await second['drainRagRuntimeSnapshot'](second['captureRagRuntimeSnapshot']());
    }
  });

  it('cold 동일 계약은 같은 descriptor를 hydrate하고 전체 source refresh나 새 UUID를 만들지 않는다', async () => {
    const first = await lexicalRuntime();
    const { default: PluginClass } = await import('./main.ts');
    const { VaultDocumentCorpus } = await import('./src/rag/vault-document-corpus');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    const refresh = vi.spyOn(VaultDocumentCorpus.prototype, 'refresh');
    const id = first.getRagGenerationSnapshot().serving?.id;
    await second.initRAG();
    expect(second.getRagGenerationSnapshot().serving?.id).toBe(id);
    expect(refresh).not.toHaveBeenCalled();
    refresh.mockRestore();
  });

  it('cold provider 계약은 동일 binding이면 indexer를 hydrate하고 인증 변경 뒤 cache와 vector 공간을 분리한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { VaultDocumentCorpus } = await import('./src/rag/vault-document-corpus');
    const app = createApp();
    const first = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(first, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    await first.initRAG();
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings), initProvider: vi.fn() });
    const refresh = vi.spyOn(VaultDocumentCorpus.prototype, 'refresh');
    try {
      await second.initRAG();
      expect(refresh).not.toHaveBeenCalled();
      expect(second.vaultIndexer).not.toBeNull();
      expect(second.getRagGenerationSnapshot().semanticAvailable).toBe(true);
      const before = second.getRagGenerationSnapshot().serving!;
      expect(before.id).toBe(first.getRagGenerationSnapshot().serving?.id);
      second.settings.providerProfiles[0].apiKey = 'synthetic-rotated';
      await second.saveSettingsLight();
      expect(second.getRagGenerationSnapshot().semanticAvailable).toBe(false);
      await second.initRAG();
      const after = second.getRagGenerationSnapshot().serving!;
      expect(after.id).not.toBe(before.id);
      expect(after.databases.embeddingCache).not.toBe(before.databases.embeddingCache);
      expect(after.databases.vector).not.toBe(before.databases.vector);
    } finally { refresh.mockRestore(); }
  });

  it('dense 초기화는 250파일 전역 probe·별도 corpus refresh 전에 첫 실제 임베딩을 시작한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const { VaultDocumentCorpus } = await import('./src/rag/vault-document-corpus');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const { TFile } = await import('obsidian');
    const files = Array.from({ length: 250 }, (_, index) => {
      const text = `synthetic streaming evidence ${index}`;
      return Object.assign(new TFile(), { path: `Synthetic/stream-${index}.md`, name: `stream-${index}.md`, basename: `stream-${index}`, extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    });
    const contents = new Map(files.map((file, index) => [file.path, `synthetic streaming evidence ${index}`]));
    const app = createApp({ files, contents });
    Object.assign(app, { metadataCache: { getFileCache: () => null } });
    const read = vi.spyOn(app.vault, 'readBinary');
    let firstEmbeddingReads = 0;
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => {
      if (firstEmbeddingReads === 0) firstEmbeddingReads = read.mock.calls.length;
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    const refresh = vi.spyOn(VaultDocumentCorpus.prototype, 'refresh');
    const rebuild = vi.spyOn(IndexedDbBM25Index.prototype, 'rebuildFrom');
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    try {
      await plugin.initRAG();
      expect(embed).toHaveBeenCalled();
      expect(firstEmbeddingReads).toBeGreaterThan(0);
      expect(firstEmbeddingReads).toBeLessThan(250);
      expect(refresh).not.toHaveBeenCalled();
      expect(rebuild).not.toHaveBeenCalled();
      expect(await plugin.documentCorpus?.getIndexedFilePaths()).toHaveLength(250);
      expect(await plugin.vectorStore?.getIndexedFilePaths()).toHaveLength(250);
      expect(plugin.bm25Index?.totalDocs).toBe(250);
    } finally { embed.mockRestore(); refresh.mockRestore(); rebuild.mockRestore(); }
  });

  it('dense 교차 파일 배치 실패도 개별 파일 처리 뒤 lexical 검색 제공을 막지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const { TFile } = await import('obsidian');
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const files = Array.from({ length: 20 }, (_, index) => {
      const text = `synthetic isolation evidence ${index}`;
      return Object.assign(new TFile(), { path: `Synthetic/isolation-${index}.md`, name: `isolation-${index}.md`, basename: `isolation-${index}`, extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    });
    const app = createApp({ files, contents: new Map(files.map((file, index) => [file.path, `synthetic isolation evidence ${index}`])) });
    Object.assign(app, { metadataCache: { getFileCache: () => null } });
    let rejectedBatches = 0;
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => {
      if (texts.length > 1) { rejectedBatches++; return Promise.reject(new Error('Synthetic multi-input batch rejected.')); }
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    try {
      await plugin.initRAG();
      expect(rejectedBatches).toBe(1);
      expect(plugin.getRagGenerationSnapshot().availability).toBe('usable');
      expect(plugin.ragEngine).not.toBeNull();
      expect(await plugin.documentCorpus?.getIndexedFilePaths()).toHaveLength(20);
      expect(await plugin.vectorStore?.getIndexedFilePaths()).toHaveLength(20);
      expect([...plugin.bm25Index!.search('isolation').keys()]).toHaveLength(20);
    } finally { clock.mockRestore(); embed.mockRestore(); }
  });

  it('문서가 있는 cold 동일 계약은 기존 vector/cache를 재사용하고 provider를 다시 호출하지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const { TFile } = await import('obsidian');
    const text = 'synthetic persisted lexical evidence';
    const file = Object.assign(new TFile(), { path: 'Synthetic/persisted.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const app = createApp({ files: [file], contents: new Map([[file.path, text]]) });
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    const first = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(first, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    try {
      await first.initRAG();
      expect(embed).toHaveBeenCalled();
      const calls = embed.mock.calls.length;
      const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
      Object.assign(second, { app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
      await second.initRAG();
      await second.ragIndexingScheduler?.waitForIdle();
      expect(second.getRagGenerationSnapshot().serving?.id).toBe(first.getRagGenerationSnapshot().serving?.id);
      expect(await second.documentCorpus?.getIndexedFilePaths()).toEqual([file.path]);
      expect(embed).toHaveBeenCalledTimes(calls);
    } finally { embed.mockRestore(); }
  });

  it('명시 업데이트는 새 세대의 실제 구축 결과를 후속 pending 0건으로 덮지 않는다', async () => {
    const { TFile } = await import('obsidian');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const text = 'synthetic explicit recovery result evidence';
    const file = Object.assign(new TFile(), { path: 'Synthetic/manual-build-result.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    const before = plugin.getRagGenerationSnapshot().serving!.id;
    plugin.settings.providerProfiles = [createOpenAiEmbeddingProfile('synthetic-key')];
    plugin.settings.rag = createRagWithEmbedding(plugin.settings.rag);
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    try {
      const result = await plugin.startRagUpdate();
      expect(plugin.getRagGenerationSnapshot().serving?.id).not.toBe(before);
      expect(plugin.getRagGenerationSnapshot().coverage).toBe('complete');
      expect(result).toMatchObject({ indexed: 1, vectors: 1, documents: [file.path] });
      expect(embed).toHaveBeenCalledOnce();
    } finally { embed.mockRestore(); }
  });

  it.each(['update', 'rebuild'] as const)('%s 명시 실행은 저장 성공 뒤 최종 원문 검증 실패를 partial로 반환한다', async (kind) => {
    const { TFile } = await import('obsidian');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const source = await import('./src/rag/source-snapshot');
    const { SourceReadError } = await import('./src/rag/source-access');
    const text = 'synthetic final verification failure evidence';
    const file = Object.assign(new TFile(), { path: 'Synthetic/manual-final-proof.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    const plugin = await lexicalRuntime({ files: [file], contents: new Map([[file.path, text]]) });
    plugin.settings.providerProfiles = [createOpenAiEmbeddingProfile('synthetic-key')];
    plugin.settings.rag = createRagWithEmbedding(plugin.settings.rag);
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    let verifying = false;
    const originalRead = source.readSourceFileSnapshot;
    const read = vi.spyOn(source, 'readSourceFileSnapshot').mockImplementation((...args) => {
      if (verifying) return Promise.reject(new SourceReadError('read-failed'));
      return originalRead(...args);
    });
    const originalProof = plugin['collectRagRuntimeProof'].bind(plugin);
    const proof = vi.spyOn(plugin, 'collectRagRuntimeProof' as never).mockImplementation((async (...args: Parameters<typeof originalProof>) => {
      verifying = true;
      try { return await originalProof(...args); }
      finally { verifying = false; }
    }) as never);
    try {
      const result = kind === 'update' ? await plugin.startRagUpdate() : await plugin.rebuildRagGeneration();
      expect(plugin.getRagGenerationSnapshot().serving?.terminal).toBe('partial');
      expect(plugin.getRagGenerationSnapshot().serving?.proof?.failures).toEqual([{ path: file.path, reason: 'read-failed' }]);
      expect(result).toMatchObject({ indexed: 1, vectors: 1, partial: 1 });
      expect(embed).toHaveBeenCalledOnce();
    } finally { proof.mockRestore(); read.mockRestore(); embed.mockRestore(); }
  });

  it('명시 전체 구축이 새 runtime을 게시하지 않으면 가짜 0건 성공을 반환하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const init = vi.spyOn(plugin, 'initRAG').mockResolvedValue(undefined);
    try { await expect(plugin.rebuildRagGeneration()).rejects.toThrow('rag-rebuild-result-unavailable'); }
    finally { init.mockRestore(); }
  });

  it('cold legacy binding은 lexical-limited로 남고 자동 재임베딩하지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { VaultDocumentCorpus } = await import('./src/rag/vault-document-corpus');
    const first = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(first, { app: createApp(), manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    await first.initRAG();
    const manifest = first['getRagGenerationManifest']();
    const state = await manifest.read();
    delete state.active!.contract.embeddingBinding;
    await manifest.table('state').put(state);
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings) });
    const refresh = vi.spyOn(VaultDocumentCorpus.prototype, 'refresh');
    try {
      await second.initRAG();
      expect(refresh).not.toHaveBeenCalled();
      expect(second.getRagGenerationSnapshot()).toMatchObject({ availability: 'usable', coverage: 'legacy-limited', semanticAvailable: false });
      expect(second.getRagGenerationSnapshot().serving?.id).toBe(state.active!.id);
    } finally { refresh.mockRestore(); }
  });

  it('cold count가 같아도 pending 원장은 보존하고 중단된 증분을 complete로 승격하지 않는다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const first = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(first, { app: createApp(), manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    await first.initRAG();
    await first.vectorStore!.beginPendingWriteRecovery!(['Synthetic/pending.md'], 'synthetic-owner');
    const manifest = first['getRagGenerationManifest']();
    const saved = await manifest.read();
    saved.active!.terminal = 'partial';
    saved.active!.proof!.failures = [{ path: 'Synthetic/failed.md', reason: 'indexing-failed' }];
    await manifest.table('state').put(saved);
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings), ragAutoRecoveryPausedByUser: true });
    await second.initRAG();
    expect(second.getRagGenerationSnapshot()).toMatchObject({ availability: 'usable', coverage: 'legacy-limited' });
    expect(second.getRagGenerationSnapshot().serving?.id).toBe(first.getRagGenerationSnapshot().serving?.id);
    expect(await first.vectorStore!.readPendingWriteRecovery!()).toEqual(['Synthetic/pending.md']);
    expect(second.getRagGenerationSnapshot().serving?.proof?.failures).toEqual(saved.active!.proof!.failures);
  });

  it.each(['embedding', 'vector'] as const)('MAIN 자동 count·maintenance는 corpus-only partial %s debt를 숨기거나 auto file 큐로 우회하지 않는다', async (phase) => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { TFile } = await import('obsidian');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const sourceAccess = await import('./src/rag/source-access');
    const { prepareSourceTextRust } = await import('./src/rag/rust-core');
    const files: TFile[] = [];
    const contents = new Map<string, string>();
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: createApp({ files, contents }), manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    await plugin.initRAG();
    const file = Object.assign(new TFile(), { path: 'Synthetic/partial.pdf', basename: 'partial', extension: 'pdf', stat: { ctime: 1, mtime: 1, size: 13 } });
    files.push(file); contents.set(file.path, 'synthetic PDF');
    const reader = vi.spyOn(sourceAccess, 'readSourceText').mockImplementation((_vault, current, options) => {
      if (!options?.preparation) throw new Error('Synthetic preparation required');
      const source = { ok: true, text: 'synthetic retained page', format: 'pdf', reason: null, segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }], completeness: { status: 'partial' as const, pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } };
      const prepared = prepareSourceTextRust(current.extension, source, options.preparation);
      if (!prepared?.prepared) throw new Error('Synthetic preparation unavailable');
      return Promise.resolve({ ...source, prepared: prepared.prepared });
    });
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => phase === 'embedding' ? Promise.reject(new Error('synthetic embedding rejection')) : Promise.resolve(texts.map(() => [1, 0])));
    const vectors = plugin.vectorStore as IndexedDbVectorStore;
    const vectorCommit = phase === 'vector' ? vi.spyOn(vectors['db'].fileIndex, 'bulkPut').mockRejectedValue(new Error('synthetic vector rejection')) : null;
    try {
      expect(await plugin.vaultIndexer!.indexVault()).toMatchObject({ indexed: 0, failed: 1 });
      expect(embed).toHaveBeenCalled();
      expect(plugin.vaultIndexer!.getFailedFileReasons()).toEqual([{ path: file.path, reason: phase === 'embedding' ? 'synthetic embedding rejection' : 'synthetic vector rejection' }]);
      // 실제 batch rollback과 별개로 재시작 interrupted journal의 auto 우회도 재현합니다.
      if (phase === 'vector') await vectors['db'].pendingWrites.put({ filePath: file.path, updated: 1 });
      const probe = vi.spyOn(plugin.vaultIndexer!, 'listPendingWriteRecovery');
      const host = plugin['automaticRagRecovery']!['host'];
      const scheduler = plugin.ragIndexingScheduler!;
      const schedule = vi.spyOn(scheduler, 'scheduleFile');
      const receipt = await plugin.documentCorpus!.getDurabilityReceipt();
      const completed = await host.readCompletedFingerprint();
      const owners = await plugin.vectorStore!.getMetaValue!<unknown>('write-recovery-requests:v1:owners');
      const maintenance = await plugin.vectorStore!.getMetaValue!<unknown>('rag-storage-maintenance:v3:completed-fingerprint');
      const rows = await plugin.documentCorpus!.getFileIndexRecords();
      const raw = await plugin.documentCorpus!.getSourceBodyBlocks(file.path, 0, 8);
      expect(rows[0]?.sourceMetadata?.completeness?.status).toBe('partial');
      expect(raw.map((block) => block.text).join('')).toBe('synthetic retained page');
      reader.mockClear(); embed.mockClear();
      expect(await host.countPendingDocuments()).toMatchObject({ pendingDocumentCount: 1, actionableDocumentCount: 0, deferredDocumentCount: 1 });
      await host.runPending();
      await host.runHealthyMaintenance('synthetic-maintenance', true, () => false);
      expect(probe).toHaveResolvedWith(phase === 'vector' ? [file.path] : []);
      expect(await vectors['db'].pendingWrites.count()).toBe(0);
      expect(schedule).not.toHaveBeenCalled();
      expect(reader).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
      expect(await plugin.vectorStore!.readPendingWriteRecovery!()).toEqual([file.path]);
      expect(await plugin.vectorStore!.getFileIndexRecord(file.path)).toBeNull();
      expect(await plugin.documentCorpus!.getFileIndexRecords()).toEqual(rows);
      expect(await plugin.documentCorpus!.getSourceBodyBlocks(file.path, 0, 8)).toEqual(raw);
      expect(await plugin.documentCorpus!.getDurabilityReceipt()).toEqual(receipt);
      expect(await host.readCompletedFingerprint()).toEqual(completed);
      expect(await plugin.vectorStore!.getMetaValue!<unknown>('write-recovery-requests:v1:owners')).toEqual(owners);
      expect(await plugin.vectorStore!.getMetaValue!<unknown>('rag-storage-maintenance:v3:completed-fingerprint')).toEqual(maintenance);
      const invalidate = vi.spyOn(plugin.vaultIndexer!, 'invalidateAutomaticRecoverySource');
      plugin['unregisterRAGEvents']();
      plugin.app.vault.trigger('modify', file);
      expect(invalidate).toHaveBeenCalledWith(file.path);
      expect(await host.countPendingDocuments()).toMatchObject({ pendingDocumentCount: 1, actionableDocumentCount: 1, deferredDocumentCount: 0 });
    } finally { reader.mockRestore(); embed.mockRestore(); vectorCommit?.mockRestore(); plugin['automaticRagRecovery']?.dispose(); plugin['unregisterRAGEvents'](); }
  });

  it('provider binding nonce는 이름 변경에는 유지하고 endpoint와 인증 변경에만 갱신한다', async () => {
    const plugin = await lexicalRuntime();
    plugin.settings.providerProfiles = [createOpenAiEmbeddingProfile('synthetic-key')];
    const saveData = vi.fn<() => Promise<void>>().mockResolvedValue();
    Object.assign(plugin, { saveData, initProvider: vi.fn() });
    await plugin.saveSettingsLight();
    const first = plugin.settings.providerProfiles[0].embeddingBindingRevision;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    plugin.settings.providerProfiles[0].name = 'synthetic label';
    await plugin.saveSettingsLight();
    expect(plugin.settings.providerProfiles[0].embeddingBindingRevision).toBe(first);
    plugin.settings.providerProfiles[0].baseUrl = 'https://synthetic.invalid';
    await plugin.saveSettingsLight();
    const second = plugin.settings.providerProfiles[0].embeddingBindingRevision;
    expect(second).not.toBe(first);
    plugin.settings.providerProfiles[0].apiKey = 'synthetic-rotated';
    await plugin.saveSettingsLight();
    expect(plugin.settings.providerProfiles[0].embeddingBindingRevision).not.toBe(second);
  });

  it.each([{ boundary: 'retire', reject: false }, { boundary: 'unload', reject: true }, { boundary: 'building-cancel', reject: true }])('indexer provider 작업 중 $boundary 뒤 늦은 정착까지 store를 닫지 않는다', async ({ boundary, reject: rejectLate }) => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider, CachedEmbeddingProvider } = await import('./src/llm/embedding');
    const { TFile } = await import('obsidian');
    const files: TFile[] = [];
    const contents = new Map<string, string>();
    const app = createApp({ files, contents });
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    await plugin.initRAG();
    let finish!: () => void;
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => new Promise((resolve, reject) => {
      finish = () => rejectLate ? reject(new Error('synthetic late provider failure')) : resolve(texts.map(() => [1, 0]));
    }));
    let close = vi.spyOn(plugin.vectorStore!, 'close');
    const providerClose = vi.spyOn(CachedEmbeddingProvider.prototype, 'close');
    const file = Object.assign(new TFile(), { path: 'Synthetic/drain.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: 15 } });
    files.push(file); contents.set(file.path, 'synthetic drain');
    const pending = (boundary === 'building-cancel' ? plugin.rebuildRagGeneration() : plugin.ragIndexingScheduler!.indexPending()).catch(() => undefined);
    try {
      await vi.waitFor(() => expect(embed).toHaveBeenCalledOnce());
      if (boundary === 'building-cancel') {
        close.mockRestore();
        close = vi.spyOn(plugin['buildingRagRuntime']!.vectorStore!, 'close');
        plugin.cancelRagIndexing({ byUser: true });
      } else if (boundary === 'unload') {
        Object.assign(plugin, { mcpRetryTimers: new Map(), mcpConnectionRunId: 0, refreshBus: { emit: vi.fn(), destroy: vi.fn() } });
        plugin.onunload();
      } else plugin['disposeRagRuntimeSnapshot'](plugin['captureRagRuntimeSnapshot']());
      expect(close).not.toHaveBeenCalled();
      expect(providerClose).not.toHaveBeenCalled();
      finish();
      await pending;
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(providerClose).toHaveBeenCalledOnce();
    } finally { finish?.(); await pending; embed.mockRestore(); close.mockRestore(); providerClose.mockRestore(); }
  });

  it('퇴역 전 시작한 검색은 lease 종료 전까지 같은 provider의 하위 작업을 시작할 수 있다', async () => {
    const plugin = await lexicalRuntime();
    const { acquireRuntimeLease, trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const provider = { embed: vi.fn().mockResolvedValue([1, 0]), close: vi.fn() };
    const tracked = trackRagProviderOperations(provider);
    const snapshot = plugin['captureRagRuntimeSnapshot']();
    Object.assign(snapshot, { embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    const release = acquireRuntimeLease(snapshot.ragEngine!);
    plugin['disposeRagRuntimeSnapshot'](snapshot);
    try { await expect(tracked.provider.embed('synthetic')).resolves.toEqual([1, 0]); }
    finally { release(); }
    await vi.waitFor(() => expect(provider.close).toHaveBeenCalledOnce());
  });

  it('같은 퇴역 handle의 drain은 재사용하고 마지막 lease 뒤에만 완료한다', async () => {
    const plugin = await lexicalRuntime();
    const { acquireRuntimeLease } = await import('./src/rag/runtime-generation');
    const snapshot = plugin['captureRagRuntimeSnapshot']();
    const release = acquireRuntimeLease(snapshot.ragEngine!);
    const close = vi.spyOn(snapshot.documentCorpus!, 'close');
    plugin['disposeRagRuntimeSnapshot'](snapshot);
    const first = plugin['drainRagRuntimeSnapshot'](snapshot);
    const second = plugin['drainRagRuntimeSnapshot']({ ...snapshot });
    expect(second).toBe(first);
    expect(plugin['pendingRagRuntimeDisposals']!.has(first)).toBe(true);
    expect(close).not.toHaveBeenCalled();
    release();
    await first;
    expect(close).toHaveBeenCalledOnce();
    expect(plugin['pendingRagRuntimeDisposals']!.size).toBe(0);
  });

  it('cold 복원을 기다리는 초기화는 reset 진입 뒤 새 세대를 시작하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    plugin.settings.rag = { ...plugin.settings.rag, chunkSize: plugin.settings.rag.chunkSize + 1 };
    const manifest = plugin['getRagGenerationManifest']();
    const begin = vi.spyOn(manifest, 'begin');
    let resume!: () => void;
    const originalRestore = plugin['restorePersistedRagGeneration'];
    const restore = vi.fn(() => new Promise<void>((resolve) => { resume = resolve; }));
    plugin['restorePersistedRagGeneration'] = restore;
    const starting = plugin.initRAG();
    await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
    plugin['ragResetInProgress'] = true;
    plugin['ragRuntimeInitRunId']++;
    resume();
    try {
      await starting;
      expect(begin).not.toHaveBeenCalled();
      expect(plugin['buildingRagRuntime']).toBeNull();
    } finally { plugin['ragResetInProgress'] = false; plugin['restorePersistedRagGeneration'] = originalRestore; }
  });

  it('reset이 시작되면 대기하던 중복 초기화도 runner를 다시 실행하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const runner = plugin['getRagRuntimeInitRunner']();
    vi.spyOn(runner, 'isRunning').mockReturnValue(true);
    const run = vi.spyOn(runner, 'run').mockImplementation(() => {
      plugin['ragResetInProgress'] = true;
      return Promise.resolve();
    });
    try {
      await plugin.initRAG();
      expect(run).toHaveBeenCalledOnce();
    } finally { plugin['ragResetInProgress'] = false; }
  });

  it('reset 중 명시 업데이트·재구축은 새 원장 쓰기나 사용자 pause 해제를 시작하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const manifest = plugin['getRagGenerationManifest']();
    const paused = vi.spyOn(manifest, 'setPaused');
    plugin['ragResetInProgress'] = true;
    plugin['ragAutoRecoveryPausedByUser'] = true;
    try {
      await expect(plugin.startRagUpdate()).resolves.toBeNull();
      expect(paused).not.toHaveBeenCalled();
      expect(plugin['ragAutoRecoveryPausedByUser']).toBe(true);
      plugin['ragAutoRecoveryPausedByUser'] = false;
      await expect(plugin.rebuildRagGeneration()).rejects.toMatchObject({ name: 'RagRuntimeInitializationCancelledError' });
    } finally { plugin['ragResetInProgress'] = false; }
  });

  it.each(['query', 'indexing', 'physical'] as const)('로컬 모델 삭제는 %s와 실제 owner close 뒤에만 파일 삭제를 시작한다', async (boundary) => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { acquireRuntimeLease, trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const events: string[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const raw = { waitForIdle: () => boundary === 'physical' ? gate : Promise.resolve(), close: () => { events.push('close'); } };
    const tracked = trackRagProviderOperations(raw);
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    if (boundary === 'indexing') {
      const scheduler = { cancel: vi.fn(), waitForIdle: () => gate };
      Object.assign(plugin['activeRagRuntime']!, { ragIndexingScheduler: scheduler });
      Object.assign(plugin, { ragIndexingScheduler: scheduler });
    }
    const release = boundary === 'query' ? acquireRuntimeLease(plugin.ragEngine!) : finish;
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockImplementation(() => { events.push('remove'); return Promise.resolve(); });
    const deleting = plugin.deleteLocalEmbeddingModel('ternlight-base');
    const observed = deleting.catch((error: unknown) => error);
    try {
      await Promise.resolve();
      expect(remove).not.toHaveBeenCalled();
      expect(events).not.toContain('close');
      release();
      await deleting;
      expect(events).toEqual(['close', 'remove']);
      expect(remove).toHaveBeenCalledWith('ternlight-base');
    } finally { release(); finish(); await observed; remove.mockRestore(); }
  });

  it.each(['idle', 'close'] as const)('로컬 모델의 %s 실패는 파일 삭제와 성공 고지를 차단한다', async (failure) => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const raw = { waitForIdle: () => failure === 'idle' ? Promise.reject(new Error('Synthetic idle failure.')) : Promise.resolve(), close: () => { if (failure === 'close') throw new Error('Synthetic close failure.'); } };
    const tracked = trackRagProviderOperations(raw);
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const emit = vi.fn();
    Object.assign(plugin, { refreshBus: { emit } });
    try {
      await expect(plugin.deleteLocalEmbeddingModel('ternlight-base')).rejects.toThrow(failure === 'idle' ? 'rag-runtime-provider-drain-failed' : 'rag-runtime-close-failed');
      expect(remove).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    } finally { remove.mockRestore(); }
  });

  it('이미 퇴역 중인 모델도 기다리고 다른 active lexical owner는 종료하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    let finish!: () => void;
    const physical = new Promise<void>((resolve) => { finish = resolve; });
    const tracked = trackRagProviderOperations({ waitForIdle: () => physical, close: vi.fn() });
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    plugin.settings.rag = { ...plugin.settings.rag, chunkSize: plugin.settings.rag.chunkSize + 1 };
    await plugin.initRAG();
    const engine = plugin.ragEngine;
    const close = vi.spyOn(plugin.documentCorpus!, 'close');
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const deleting = plugin.deleteLocalEmbeddingModel('ternlight-base');
    const observed = deleting.catch((error: unknown) => error);
    try {
      await Promise.resolve();
      expect(remove).not.toHaveBeenCalled();
      finish();
      await deleting;
      expect(plugin.ragEngine).toBe(engine);
      expect(close).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledOnce();
    } finally { finish(); await observed; remove.mockRestore(); }
  });

  it('building 모델 owner의 물리 종료를 기다리되 다른 active owner는 보존한다', async () => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { RAGQueryEngine } = await import('./src/rag/query');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const engine = plugin.ragEngine;
    const close = vi.spyOn(plugin.documentCorpus!, 'close');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const tracked = trackRagProviderOperations({ waitForIdle: () => gate, close: vi.fn() });
    const building = plugin['captureRagRuntimeSnapshot']();
    Object.assign(building, { localEmbeddingModelId: 'ternlight-base', ragEngine: new RAGQueryEngine(null, null), documentCorpus: null, vaultDocumentCorpus: null, vectorStore: null, bm25Index: null, automaticRagRecovery: null, ragIndexingScheduler: null, embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    plugin['buildingRagRuntime'] = building;
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const deleting = plugin.deleteLocalEmbeddingModel('ternlight-base');
    const observed = deleting.catch((error: unknown) => error);
    try {
      await Promise.resolve();
      expect(remove).not.toHaveBeenCalled();
      finish();
      await deleting;
      expect(plugin.ragEngine).toBe(engine);
      expect(close).not.toHaveBeenCalled();
      expect(plugin['buildingRagRuntime']).toBeNull();
      expect(remove).toHaveBeenCalledOnce();
    } finally { finish(); await observed; remove.mockRestore(); }
  });

  it('active 모델 삭제는 다른 모델의 building 작업을 취소하거나 종료하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { RAGQueryEngine } = await import('./src/rag/query');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const tracked = trackRagProviderOperations({ waitForIdle: () => gate, close: vi.fn() });
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    const building = plugin['captureRagRuntimeSnapshot']();
    const cancel = vi.fn();
    const close = vi.fn();
    const otherController = new AbortController();
    plugin['ragIndexAbortController'] = otherController;
    Object.assign(building, { localEmbeddingModelId: 'embeddinggemma-300m', ragEngine: new RAGQueryEngine(null, null), documentCorpus: null, vaultDocumentCorpus: null, vectorStore: null, bm25Index: null, automaticRagRecovery: null, ragIndexingScheduler: { cancel, waitForIdle: () => Promise.resolve() }, embeddingProvider: { close }, retireProvider: undefined });
    plugin['buildingRagRuntime'] = building;
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const deleting = plugin.deleteLocalEmbeddingModel('ternlight-base');
    const observed = deleting.catch((error: unknown) => error);
    try {
      await Promise.resolve();
      expect(remove).not.toHaveBeenCalled();
      finish();
      await deleting;
      expect(plugin['buildingRagRuntime']).toBe(building);
      expect(otherController.signal.aborted).toBe(false);
      expect(cancel).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledOnce();
    } finally { finish(); await observed; remove.mockRestore(); await plugin['drainRagRuntimeSnapshot'](building); }
  });

  it('모델 삭제 대기 중 같은 모델의 새 구축 진입을 막는다', async () => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const profile = createOpenAiEmbeddingProfile('');
    plugin.settings.providerProfiles = [{ ...profile, id: 'local', name: 'Local', strategy: 'ternlight', baseUrl: '', models: [{ ...profile.models[0], id: 'ternlight-base' }] }];
    plugin.settings.rag = { ...plugin.settings.rag, embeddingModelRef: 'profile:local:ternlight-base' };
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const tracked = trackRagProviderOperations({ waitForIdle: () => gate, close: vi.fn() });
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    const begin = vi.spyOn(plugin['getRagGenerationManifest'](), 'begin');
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const prepare = vi.spyOn(LocalEmbeddingModels.prototype, 'prepare').mockRejectedValue(new Error('Unexpected synthetic model preparation.'));
    const deleting = plugin.deleteLocalEmbeddingModel('ternlight-base');
    const observed = deleting.catch((error: unknown) => error);
    try {
      await Promise.resolve();
      await plugin.initRAG();
      expect(begin).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      finish();
      await deleting;
    } finally { finish(); await observed; remove.mockRestore(); prepare.mockRestore(); }
  });

  it('다른 모델의 실제 구축 실패는 삭제·종료한 active를 복원하지 않고 새 lexical 복원을 허용한다', async () => {
    const plugin = await lexicalRuntime();
    const { LocalEmbeddingModels } = await import('./src/llm/local-embedding-models');
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const oldEngine = plugin.ragEngine;
    const oldCorpus = plugin.documentCorpus;
    const close = vi.fn();
    const tracked = trackRagProviderOperations({ waitForIdle: () => Promise.resolve(), close });
    Object.assign(plugin['activeRagRuntime']!, { localEmbeddingModelId: 'ternlight-base', embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    Object.assign(plugin, { embeddingProvider: tracked.provider });
    const profile = createOpenAiEmbeddingProfile('');
    plugin.settings.providerProfiles = [{ ...profile, id: 'local', name: 'Local', strategy: 'ternlight', baseUrl: '', models: [{ ...profile.models[0], id: 'embeddinggemma-300m' }] }];
    plugin.settings.rag = { ...plugin.settings.rag, embeddingModelRef: 'profile:local:embeddinggemma-300m' };
    let entered!: () => void;
    let fail!: (error: Error) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<never>((_resolve, reject) => { fail = reject; });
    const begin = vi.spyOn(plugin['getRagGenerationManifest'](), 'begin').mockImplementation(() => { entered(); return gate; });
    const remove = vi.spyOn(LocalEmbeddingModels.prototype, 'remove').mockResolvedValue(undefined);
    const prepare = vi.spyOn(LocalEmbeddingModels.prototype, 'prepare').mockRejectedValue(new Error('Unexpected synthetic model preparation.'));
    const initializing = plugin.initRAG();
    const observed = initializing.catch((error: unknown) => error);
    try {
      await started;
      expect(plugin['buildingRagRuntime']?.localEmbeddingModelId).toBe('embeddinggemma-300m');
      await plugin.deleteLocalEmbeddingModel('ternlight-base');
      expect(close).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('ternlight-base');
      expect(plugin.ragEngine).toBeNull();
      fail(new Error('Synthetic other model initialization failure.'));
      await expect(initializing).rejects.toThrow('Synthetic other model initialization failure.');
      expect(plugin.ragEngine).toBeNull();
      expect(plugin.embeddingProvider).toBeNull();
      const snapshot = await plugin.acquireRagEngineOnlySnapshot();
      try {
        expect(snapshot).not.toBeNull();
        expect(plugin.ragEngine).not.toBe(oldEngine);
        expect(snapshot?.documentCorpus).not.toBe(oldCorpus);
        expect(prepare).not.toHaveBeenCalled();
      } finally { snapshot?.release(); }
    } finally { fail(new Error('Synthetic cleanup.')); await observed; begin.mockRestore(); remove.mockRestore(); prepare.mockRestore(); }
  });

  it('provider 물리 idle 실패는 runtime 종료와 파괴적 초기화를 성공으로 처리하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const snapshot = plugin['captureRagRuntimeSnapshot']();
    const close = vi.spyOn(snapshot.documentCorpus!, 'close');
    const remove = vi.spyOn(snapshot.bm25Index!, 'deleteDatabase');
    const raw = { embed: vi.fn().mockResolvedValue([1, 0]), waitForIdle: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Synthetic physical idle failure.')), close: vi.fn() };
    const tracked = trackRagProviderOperations(raw);
    Object.assign(snapshot, { embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    try {
      await expect(plugin['drainRagRuntimeSnapshot'](snapshot)).rejects.toThrow('rag-runtime-provider-drain-failed');
      await expect(plugin.resetPluginData()).rejects.toThrow('rag-runtime-provider-drain-failed');
      expect(close).not.toHaveBeenCalled();
      expect(raw.close).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(plugin.app.vault.adapter.rmdir).not.toHaveBeenCalled();
    } finally { snapshot.documentCorpus?.close(); snapshot.bm25Index?.close(); }
  });

  it('퇴역 proxy의 실제 close 실패도 성공한 drain으로 숨기지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const { trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    const snapshot = plugin['captureRagRuntimeSnapshot']();
    const raw = { close: () => { throw new Error('Synthetic provider close failure.'); } };
    const tracked = trackRagProviderOperations(raw);
    Object.assign(snapshot, { embeddingProvider: tracked.provider, retireProvider: tracked.retire });
    await expect(plugin['drainRagRuntimeSnapshot'](snapshot)).rejects.toThrow('rag-runtime-close-failed');
    await expect(plugin.resetPluginData()).rejects.toThrow('rag-runtime-close-failed');
    expect(plugin.app.vault.adapter.rmdir).not.toHaveBeenCalled();
  });

  it('폐쇄된 실제 cache owner도 명시 초기화에서는 drain 뒤 정확한 소유 DB만 삭제한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { default: Dexie } = await import('dexie');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { OpenAIEmbeddingProvider } = await import('./src/llm/embedding');
    const { chatGPTOAuth } = await import('./src/llm/chatgpt-oauth');
    const { googleGeminiOAuth } = await import('./src/llm/google-gemini-oauth');
    const chatDisconnect = vi.spyOn(chatGPTOAuth, 'disconnect').mockImplementation(() => undefined);
    const geminiDisconnect = vi.spyOn(googleGeminiOAuth, 'disconnect').mockImplementation(() => undefined);
    const embed = vi.spyOn(OpenAIEmbeddingProvider.prototype, 'embedBatch').mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 0])));
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app: createApp(), manifest: { id: 'superpower-inside' }, refreshBus: { emit: vi.fn() }, initProvider: vi.fn(), initMCP: vi.fn().mockResolvedValue([]), settings: { ...DEFAULT_SETTINGS,
      providerProfiles: [createOpenAiEmbeddingProfile('synthetic-key')], rag: createRagWithEmbedding(DEFAULT_SETTINGS.rag) } });
    try {
      await plugin.initRAG();
      await plugin.embeddingProvider!.embed('synthetic reset cache');
      const cacheName = plugin.getRagGenerationSnapshot().serving!.databases.embeddingCache;
      expect(await Dexie.exists(cacheName)).toBe(true);
      await plugin.resetPluginData();
      expect(await Dexie.exists(cacheName)).toBe(false);
      expect(embed).toHaveBeenCalledOnce();
    } finally { embed.mockRestore(); chatDisconnect.mockRestore(); geminiDisconnect.mockRestore(); }
  });

  it('확인하지 못한 indexing drain은 초기화 삭제와 설정 변경을 계속 막는다', async () => {
    const plugin = await lexicalRuntime();
    const snapshot = plugin['captureRagRuntimeSnapshot']();
    const before = structuredClone(plugin.settings);
    const close = vi.spyOn(snapshot.documentCorpus!, 'close');
    const remove = vi.spyOn(snapshot.bm25Index!, 'deleteDatabase');
    const idle = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('synthetic drain failure'));
    Object.assign(snapshot, { ragIndexingScheduler: { cancel: vi.fn(), waitForIdle: idle } });
    try {
      await expect(plugin['drainRagRuntimeSnapshot'](snapshot)).rejects.toThrow('rag-runtime-indexing-drain-failed');
      await expect(plugin.resetPluginData()).rejects.toThrow('rag-runtime-indexing-drain-failed');
      expect(close).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(plugin.app.vault.adapter.rmdir).not.toHaveBeenCalled();
      expect(plugin.settings).toEqual(before);
      expect(plugin.getRagGenerationSnapshot().availability).toBe('failed');
    } finally { snapshot.documentCorpus?.close(); snapshot.bm25Index?.close(); }
  });

  it('lexical-only 명시 업데이트도 동일 UUID에서 새 원문을 증분 반영한다', async () => {
    const plugin = await lexicalRuntime();
    const { TFile } = await import('obsidian');
    const text = 'synthetic lexical increment';
    const file = Object.assign(new TFile(), { path: 'Synthetic/lexical-increment.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
    vi.spyOn(plugin.app.vault, 'getFiles').mockReturnValue([file]);
    vi.spyOn(plugin.app.vault, 'getAbstractFileByPath').mockReturnValue(file);
    vi.spyOn(plugin.app.vault, 'readBinary').mockResolvedValue(new TextEncoder().encode(text).buffer);
    Object.assign(plugin.app, { metadataCache: { getFileCache: () => null } });
    const id = plugin.getRagGenerationSnapshot().serving?.id;
    await plugin.startRagUpdate();
    expect(plugin.getRagGenerationSnapshot().serving?.id).toBe(id);
    expect(await plugin.documentCorpus?.getIndexedFilePaths()).toEqual([file.path]);
  });

  it('검색 무관 채팅 설정은 동일 runtime과 UUID를 유지한다', async () => {
    const plugin = await lexicalRuntime();
    const engine = plugin.ragEngine;
    const id = plugin.getRagGenerationSnapshot().serving?.id;
    plugin.settings.chat = { ...plugin.settings.chat, systemPrompt: 'synthetic UI change' };
    await plugin.initRAG();
    expect(plugin.getRagGenerationSnapshot().serving?.id).toBe(id);
    expect(plugin.ragEngine).toBe(engine);
  });

  it('증분 corpus 수 변경 뒤 cold 복원은 complete로 승격하지 않고 usable lexical을 보존한다', async () => {
    const first = await lexicalRuntime();
    const { TFile } = await import('obsidian');
    const { buildSourceDocuments } = await import('./src/rag/source-document');
    const file = Object.assign(new TFile(), { path: 'Synthetic/increment.md', extension: 'md', stat: { ctime: 1, mtime: 1, size: 9 } });
    await first.documentCorpus!.replaceFileDocuments(file.path, buildSourceDocuments(file, 'synthetic increment', first.settings.rag));
    const { default: PluginClass } = await import('./main.ts');
    const second = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(second, { app: first.app, manifest: { id: 'superpower-inside' }, settings: structuredClone(first.settings), ragAutoRecoveryPausedByUser: true });
    await second.initRAG();
    expect(second.getRagGenerationSnapshot()).toMatchObject({ availability: 'usable', coverage: 'legacy-limited', serving: { id: first.getRagGenerationSnapshot().serving?.id } });
    expect(await second.documentCorpus?.getIndexedFilePaths()).toEqual([file.path]);
  });

  it('cold start는 현재 vault가 달라도 정확한 v4 저장 집합을 제한된 기존 색인으로 제공한다', async () => {
    const { default: PluginClass } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { createRagStorageLayout } = await import('./src/rag/storage-lifecycle');
    const { IndexedDbDocumentCorpusStore } = await import('./src/rag/document-corpus-store');
    const { buildSourceDocuments } = await import('./src/rag/source-document');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const { TFile } = await import('obsidian');
    const app = createApp();
    const layout = createRagStorageLayout({ pluginId: 'superpower-inside', vaultIdentity: app.vault.getName(), legacyVaultName: app.vault.getName(), embeddingNamespace: 'lexical-baseline', indexNamespace: `idx-v4:${DEFAULT_SETTINGS.rag.chunkSize}:${DEFAULT_SETTINGS.rag.overlap}` });
    const legacy = new IndexedDbDocumentCorpusStore(layout.active.corpus);
    const file = Object.assign(new TFile(), { path: 'Synthetic/previous.md', extension: 'md', basename: 'previous', stat: { ctime: 1, mtime: 1, size: 14 } });
    await legacy.replaceFileDocuments(file.path, buildSourceDocuments(file, 'synthetic previous source', DEFAULT_SETTINGS.rag));
    legacy.close();
    const plugin = Object.create(PluginClass.prototype) as InstanceType<typeof PluginClass>;
    Object.assign(plugin, { app, manifest: { id: 'superpower-inside' }, settings: { ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true } } });
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; });
    });
    const initialization = plugin.initRAG();
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      expect(plugin.getRagGenerationSnapshot()).toMatchObject({ availability: 'usable', coverage: 'legacy-limited', serving: { id: 'legacy-v4' } });
      expect(plugin.getRetrievalReadiness()).toBe('ready');
      expect(await plugin.documentCorpus?.getIndexedFilePaths()).toEqual(['Synthetic/previous.md']);
    } finally { finish(); await initialization; load.mockRestore(); }
  });

  it('commit 이후 background recovery 실패는 새 active를 닫거나 퇴역한 old handle로 되돌리지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const old = plugin.documentCorpus;
    plugin.settings.providerProfiles = [createOpenAiEmbeddingProfile('synthetic-key')];
    plugin.settings.rag = createRagWithEmbedding(plugin.settings.rag);
    const recovery = vi.spyOn(plugin as unknown as { startAutomaticRagRecovery(): Promise<void> }, 'startAutomaticRagRecovery').mockRejectedValue(new Error('synthetic-recovery-failed'));
    try {
      await plugin.initRAG();
      expect(plugin.documentCorpus).not.toBe(old);
      expect(plugin.getRagGenerationSnapshot()).toMatchObject({ availability: 'usable', coverage: 'complete' });
      await expect(plugin.documentCorpus?.getIndexedFilePaths()).resolves.toEqual([]);
    } finally { recovery.mockRestore(); }
  });

  it('실패한 building은 old 검색을 보존하고 실패 terminal만 게시한다', async () => {
    const plugin = await lexicalRuntime();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const engine = plugin.ragEngine;
    const corpus = plugin.documentCorpus!;
    const close = vi.spyOn(corpus, 'close');
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockRejectedValue(new Error('synthetic-build-failed'));
    try {
      await expect(plugin.rebuildRagGeneration()).rejects.toThrow('synthetic-build-failed');
      expect(plugin.ragEngine).toBe(engine);
      expect(plugin.getRetrievalReadiness()).toBe('ready');
      expect(plugin.getRagGenerationSnapshot().building?.status).toBe('failed');
      expect(close).not.toHaveBeenCalled();
    } finally { load.mockRestore(); }
  });

  it('중단된 building은 old 검색을 보존하고 자동 재초기화해도 다시 시작하지 않는다', async () => {
    const plugin = await lexicalRuntime();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const old = plugin.ragEngine;
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; });
    });
    const build = plugin.rebuildRagGeneration();
    const cancelled = expect(build).rejects.toThrow();
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      plugin.cancelRagIndexing({ byUser: true });
      finish();
      await cancelled;
      expect(plugin.ragEngine).toBe(old);
      expect(plugin.getRagGenerationSnapshot().building?.status).toBe('cancelled');
      await plugin.initRAG();
      expect(load).toHaveBeenCalledOnce();
      expect(plugin.getRagRuntimeState().autoRecoveryPausedByUser).toBe(true);
      expect(plugin.getRetrievalReadiness()).toBe('ready');
    } finally { finish(); await cancelled; load.mockRestore(); }
  });

  it('setup B를 기다리던 중 C 설정이 들어오면 늦은 B는 공개하지 않고 C를 한 번 구축한다', async () => {
    const plugin = await lexicalRuntime();
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const old = plugin.ragEngine;
    const original = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    let calls = 0;
    const load = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      calls++;
      return calls === 1 ? new Promise<void>((resolve, reject) => { finish = () => { void original.call(this).then(resolve, reject); }; }) : original.call(this);
    });
    const b = plugin.rebuildRagGeneration();
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      plugin.settings.rag = { ...plugin.settings.rag, chunkSize: 777 };
      const c = plugin.initRAG();
      expect(plugin.ragEngine).toBe(old);
      finish();
      await Promise.all([b, c]);
      expect(load).toHaveBeenCalledTimes(2);
      expect(plugin.getRagGenerationSnapshot().serving?.contract.chunkSize).toBe(777);
      expect(plugin.getRagGenerationSnapshot().building).toBeNull();
    } finally { finish(); await b; load.mockRestore(); }
  });

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

  it('재개 진입점은 resumeRagAutoRecovery 하나이며 사용자 중단을 푼다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const resume = vi.fn();
    const runtime = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(runtime, {
      ragAutoRecoveryPausedByUser: true,
      automaticRagRecovery: { resume },
      refreshBus: { emit: vi.fn() },
    });
    runtime.resumeRagAutoRecovery();
    expect(
      (runtime as unknown as { ragAutoRecoveryPausedByUser: boolean }).ragAutoRecoveryPausedByUser,
    ).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
    expect(
      (runtime as unknown as { resumeRagIndexing?: unknown }).resumeRagIndexing,
    ).toBeUndefined();
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
    // 런타임·바이트 후보 캐시·writer epoch가 이벤트 4개씩 구독합니다.
    expect(plugin.app.vault.on).toHaveBeenCalledTimes(12);
    for (const event of ['create', 'modify', 'delete', 'rename']) {
      expect(plugin.app.vault.on.mock.calls.filter(([name]) => name === event)).toHaveLength(3);
    }
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

  it('building BM25 실패는 불완전한 새 vector runtime을 공개하지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
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
    try {
      await expect((plugin as unknown as { initRAGRuntime(): Promise<void> }).initRAGRuntime()).rejects.toThrow('BM25 stuck');
      expect(plugin.ragEngine ?? null).toBeNull();
      expect(plugin.vectorStore ?? null).toBeNull();
      expect(plugin.lastRagRuntimeInitError).toBe('BM25 stuck');
    } finally {
      loadSpy.mockRestore();
    }
  });

  it('old 검색 lease를 유지하면서 building 반영을 기다리고 cutover 후 마지막 검색 종료에만 닫는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const { IndexedDbBM25Index } = await import('./src/rag/bm25');
    const plugin = Object.create(SuperpowerInsidePlugin.prototype) as SuperpowerInsidePlugin;
    Object.assign(plugin, { app: createApp(), manifest: { id: 'superpower-inside' }, settings: {
      ...DEFAULT_SETTINGS, providerProfiles: [], rag: { ...DEFAULT_SETTINGS.rag, embeddingModelRef: '', enableBM25: true },
    } });
    await plugin.initRAG();
    const oldEngine = plugin.ragEngine;
    const oldCorpus = plugin.documentCorpus!;
    const oldClose = vi.spyOn(oldCorpus, 'close');
    const clear = vi.spyOn(oldCorpus, 'clear');
    const lease = plugin.acquireRagSearchSnapshot();
    const load = IndexedDbBM25Index.prototype.load;
    let finish = (): void => undefined;
    const loadSpy = vi.spyOn(IndexedDbBM25Index.prototype, 'load').mockImplementation(function (this: IndexedDbBM25Index) {
      return new Promise<void>((resolve, reject) => { finish = () => { void load.call(this).then(resolve, reject); }; });
    });
    const rebuilding = plugin.rebuildRagGeneration();
    try {
      await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledOnce());
      expect(plugin.ragEngine).toBe(oldEngine);
      expect(plugin.documentCorpus).toBe(oldCorpus);
      expect(plugin.getRetrievalReadiness()).toBe('ready');
      expect(plugin.getRagRuntimeState().generation.building).not.toBeNull();
      finish();
      await rebuilding;
      expect(plugin.ragEngine).not.toBe(oldEngine);
      expect(oldClose).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
      lease.release();
      expect(oldClose).toHaveBeenCalledOnce();
    } finally { finish(); await rebuilding; lease.release(); loadSpy.mockRestore(); }
  });

  it('동일 계약 초기화는 full rebuild와 이벤트 재구독을 만들지 않는다', async () => {
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
    expect(app.vault.on).toHaveBeenCalledTimes(12);
    const firstRuntimeRefs = app.vault.on.mock.results
      .slice(8, 12)
      .map((result) => result.value as unknown);
    await plugin.initRAG();

    expect(app.vault.offref).not.toHaveBeenCalled();
    expect(app.vault.on).toHaveBeenCalledTimes(12);
    expect(app.vault.on.mock.results.slice(8, 12).map((result) => result.value)).toEqual(firstRuntimeRefs);
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

  it.each(['idle', 'lease', 'provider'] as const)('전체 초기화는 %s 작업 drain 뒤 설정과 소유 저장소만 되돌린다', async (boundary) => {
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
      close: vi.fn(),
    };
    const bm25Index = {
      clear: vi.fn(() => Promise.resolve()),
      deleteDatabase: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
    };
    const embeddingProvider = {
      clearCache: vi.fn(() => Promise.resolve()),
      deleteDatabase: vi.fn(() => Promise.resolve()),
      embed: vi.fn<() => Promise<number[]>>(),
      close: vi.fn(),
    };
    plugin.vectorStore = vectorStore;
    plugin.bm25Index = bm25Index;
    plugin.embeddingProvider = embeddingProvider;
    plugin.createIndexedDbName = (kind: string) => `superpower-inside:UnitVault:${kind}`;

    const { RAGQueryEngine } = await import('./src/rag/query');
    const { acquireRuntimeLease, trackRagProviderOperations } = await import('./src/rag/runtime-generation');
    let finish = (): void => undefined;
    let pending: Promise<unknown> = Promise.resolve();
    if (boundary !== 'idle') plugin.ragEngine = new RAGQueryEngine(null, null);
    if (boundary === 'lease') finish = acquireRuntimeLease(plugin.ragEngine!);
    if (boundary === 'provider') {
      embeddingProvider.embed.mockImplementation(() => new Promise((resolve) => { finish = () => resolve([1, 0]); }));
      const tracked = trackRagProviderOperations(embeddingProvider);
      Object.assign(plugin, { embeddingProvider: tracked.provider, activeRagRuntime: {
        retireProvider: tracked.retire,
        clearEmbeddingCache: () => embeddingProvider.deleteDatabase(),
      } });
      pending = tracked.provider.embed();
    }
    const resetting = plugin.resetPluginData();
    try {
      if (boundary !== 'idle') {
        await Promise.resolve();
        expect(vectorStore.deleteDatabase).not.toHaveBeenCalled();
        expect(bm25Index.deleteDatabase).not.toHaveBeenCalled();
        expect(embeddingProvider.deleteDatabase).not.toHaveBeenCalled();
        expect(app.vault.adapter.rmdir).not.toHaveBeenCalled();
        expect(plugin.acquireRagSearchSnapshot()).toBeNull();
        expect(plugin.getRetrievalReadiness()).toBe('preparing');
      }
      finish();
      await resetting;
    } finally { finish(); await pending; await resetting.catch(() => undefined); }

    expect(vectorStore.close.mock.invocationCallOrder[0]).toBeLessThan(vectorStore.deleteDatabase.mock.invocationCallOrder[0]);
    expect(bm25Index.close.mock.invocationCallOrder[0]).toBeLessThan(bm25Index.deleteDatabase.mock.invocationCallOrder[0]);
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
  const vaultName = `synthetic-${crypto.randomUUID()}`;
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
    getName: () => vaultName,
    getFiles: vi.fn(() => [...(options.files ?? [])]),
    getMarkdownFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(
      (path: string) => options.files?.find((file) => file.path === path) ?? null,
    ),
    cachedRead: vi.fn((file: TFile) => Promise.resolve(options.contents?.get(file.path) ?? '')),
    readBinary: vi.fn((file: TFile) =>
      Promise.resolve(new TextEncoder().encode(options.contents?.get(file.path) ?? '').buffer),
    ),
    on: vi.fn((event: string, callback: unknown) => {
      const ref = { event, callback };
      refs.push(ref);
      return ref;
    }),
    offref: vi.fn((ref: unknown) => {
      const index = refs.indexOf(ref);
      if (index >= 0) refs.splice(index, 1);
    }),
    trigger: vi.fn((event: string, ...args: unknown[]) => {
      for (const ref of [...refs] as { event: string; callback: (...args: unknown[]) => void }[]) {
        if (ref.event === event) ref.callback(...args);
      }
    }),
  };

  return {
    loadLocalStorage: vi.fn(() => options.localSettings ?? null),
    saveLocalStorage: vi.fn(),
    secretStorage: createFakeSecretStorage(options.secrets),
    vault: { ...vault, configDir: '.obsidian' },
    metadataCache: { getFileCache: vi.fn(() => ({})) },
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
