import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { LocalEmbeddingModelId, LocalModelState } from './local-embedding-models';

const mocks = vi.hoisted(() => ({
  listeners: new Map<LocalEmbeddingModelId, (state: LocalModelState) => void>(),
  confirm: vi.fn(() => Promise.resolve(false)),
  prepare: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('./local-embedding-models', () => ({
  getLocalEmbeddingModels: () => ({
    subscribe: (id: LocalEmbeddingModelId, listener: (state: LocalModelState) => void) => {
      mocks.listeners.set(id, listener);
      listener({ phase: 'ready', totalBytes: 100, completedBytes: 100, hasFiles: true });
      return mocks.dispose;
    },
    state: () => ({ phase: 'ready', totalBytes: 100, completedBytes: 100, hasFiles: true }),
    refresh: () => Promise.resolve(),
    prepare: mocks.prepare,
    cancel: mocks.cancel,
  }),
}));
vi.mock('../utils/modal-prompts', () => ({ confirmWithModal: mocks.confirm }));
vi.mock('obsidian', () => ({
  Notice: class {},
  Setting: class {
    settingEl: ElementFixture;
    infoEl: ElementFixture;
    controlEl: ElementFixture;
    constructor(container: ElementFixture) {
      this.settingEl = container.createDiv();
      this.infoEl = this.settingEl.createDiv();
      this.controlEl = this.settingEl.createDiv();
    }
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    setHeading() {
      return this;
    }
  },
}));
import { buildLocalEmbeddingModelSettings } from './local-embedding-settings';

class ElementFixture {
  children: ElementFixture[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  events = new Map<string, () => void>();
  disabled = false;
  isConnected = true;
  textContent = '';
  title = '';
  value = 0;
  max = 0;
  private concealed = false;
  constructor(
    readonly ownerDocument: { activeElement: ElementFixture | null; body: ElementFixture | null },
    readonly tag = 'div',
  ) {}
  get hidden() {
    return this.concealed;
  }
  set hidden(value: boolean) {
    this.concealed = value;
    if (value && this.ownerDocument.activeElement === this)
      this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  createEl(tag: string, options: { text?: string; attr?: Record<string, string> } = {}) {
    const element = new ElementFixture(this.ownerDocument, tag);
    element.textContent = options.text ?? '';
    for (const [key, value] of Object.entries(options.attr ?? {}))
      element.attributes.set(key, value);
    this.children.push(element);
    return element;
  }
  createDiv() {
    return this.createEl('div');
  }
  addClass() {}
  toggleClass() {}
  setText(value: string) {
    this.textContent = value;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  addEventListener(type: string, action: () => void) {
    this.events.set(type, action);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  all(): ElementFixture[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

describe('기본 모델 설정의 접근성과 삭제 계약', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    mocks.confirm.mockClear();
    mocks.dispose.mockClear();
  });
  it('두 모델을 개별 관리하고 취소 버튼이 숨겨질 때 포커스를 복구한다', () => {
    const document = { activeElement: null, body: null } as {
      activeElement: ElementFixture | null;
      body: ElementFixture | null;
    };
    const root = new ElementFixture(document);
    document.body = root;
    const dispose = buildLocalEmbeddingModelSettings(
      root as unknown as HTMLElement,
      { app: {} as App, pluginId: 'test', pluginVersion: 'test' },
      { remove: () => Promise.resolve() },
    );
    expect(mocks.listeners.size).toBe(2);
    const controls = root
      .all()
      .filter(
        (element) =>
          element.tag === 'button' &&
          element.getAttribute('aria-label')?.startsWith('EmbeddingGemma'),
      );
    const [download, cancel] = controls;
    mocks.listeners.get('embeddinggemma-300m')?.({
      phase: 'downloading',
      totalBytes: 100,
      completedBytes: 25,
    });
    cancel.focus();
    mocks.listeners.get('embeddinggemma-300m')?.({
      phase: 'missing',
      totalBytes: 100,
      completedBytes: 0,
    });
    expect(document.activeElement).toBe(download);
    expect(
      root.all().filter((element) => element.tag === 'progress' && !element.hidden),
    ).toHaveLength(0);
    dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });

  it('삭제 확인을 취소하면 모델 파일 삭제를 호출하지 않는다', async () => {
    const document = { activeElement: null, body: null } as {
      activeElement: ElementFixture | null;
      body: ElementFixture | null;
    };
    const root = new ElementFixture(document);
    document.body = root;
    const remove = vi.fn(() => Promise.resolve());
    const dispose = buildLocalEmbeddingModelSettings(
      root as unknown as HTMLElement,
      { app: {} as App, pluginId: 'test', pluginVersion: 'test' },
      { remove },
    );
    const button = root
      .all()
      .find(
        (element) =>
          element.tag === 'button' &&
          element.getAttribute('aria-label')?.startsWith('Ternlight') &&
          !element.hidden,
      );
    button?.events.get('click')?.();
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(remove).not.toHaveBeenCalled();
    dispose();
  });

  it('확인한 모델 ID만 삭제 동작으로 전달한다', async () => {
    mocks.confirm.mockResolvedValueOnce(true);
    const document = { activeElement: null, body: null } as {
      activeElement: ElementFixture | null;
      body: ElementFixture | null;
    };
    const root = new ElementFixture(document);
    document.body = root;
    const remove = vi.fn(() => Promise.resolve());
    const dispose = buildLocalEmbeddingModelSettings(
      root as unknown as HTMLElement,
      { app: {} as App, pluginId: 'test', pluginVersion: 'test' },
      { remove },
    );
    const button = root
      .all()
      .find(
        (element) =>
          element.tag === 'button' &&
          element.getAttribute('aria-label')?.startsWith('EmbeddingGemma') &&
          !element.hidden,
      );
    button?.events.get('click')?.();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('embeddinggemma-300m'));
    expect(remove).toHaveBeenCalledTimes(1);
    dispose();
  });
});
