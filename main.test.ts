import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

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

  it('설정 로드 시 localStorage 값이 있으면 data.json을 읽지 않는다', async () => {
    const { default: SuperpowerInsidePlugin } = await import('./main.ts');
    const { DEFAULT_SETTINGS } = await import('./src/settings');
    const app = createApp({
      localSettings: {
        ...DEFAULT_SETTINGS,
        openai: { ...DEFAULT_SETTINGS.openai, enabled: true, apiKey: 'local-key' },
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

    expect(app.loadLocalStorage).toHaveBeenCalledWith('superpower-inside:settings');
    expect(plugin.loadData).not.toHaveBeenCalled();
    expect(plugin.settings.openai.apiKey).toBe('local-key');
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
});

function createApp(options: { localSettings?: unknown; legacyDataExists?: boolean } = {}) {
  const refs: unknown[] = [];
  const vault = {
    adapter: {
      exists: vi.fn((path: string) =>
        Promise.resolve(path.endsWith('/data.json') ? options.legacyDataExists === true : false),
      ),
      stat: vi.fn(() => Promise.resolve(null)),
      mkdir: vi.fn(() => Promise.resolve()),
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
