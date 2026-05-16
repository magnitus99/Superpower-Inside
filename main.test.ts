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
});

function createApp() {
  const refs: unknown[] = [];
  const vault = {
    adapter: {
      exists: vi.fn(() => Promise.resolve(false)),
      mkdir: vi.fn(() => Promise.resolve()),
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
    vault,
    workspace: {
      trigger: vi.fn(),
    },
  };
}
