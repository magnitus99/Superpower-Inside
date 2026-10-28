import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import type { SearchStatusSnapshot } from '../rag/search-status';
import type { SearchEvidence, SearchPort, SearchResponse } from './engine-port';

const dom = vi.hoisted(() => {
  interface TestEvent {
    type: string;
    key?: string;
    preventDefault: () => void;
  }

  class TestTextNode {
    constructor(public textContent: string) {}
  }

  class TestElement {
    readonly children: Array<TestElement | TestTextNode> = [];
    readonly tagName: string;
    parentElement: TestElement | null = null;
    className = '';
    textContent = '';
    value = '';
    disabled = false;
    focused = false;
    readonly ownerDocument = {
      createTextNode: (text: string) => new TestTextNode(text),
    };
    private readonly attributes = new Map<string, string>();
    private readonly listeners = new Map<string, Array<(event: TestEvent) => void>>();

    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
    }

    createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      return this.createEl('div', options);
    }

    createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      return this.createEl('span', options);
    }

    createEl(
      tagName: string,
      options?: {
        cls?: string;
        text?: string;
        attr?: Record<string, string>;
        value?: string;
      },
    ) {
      const element = new TestElement(tagName);
      if (options?.cls) element.className = options.cls;
      if (options?.text !== undefined) element.textContent = options.text;
      if (options?.value !== undefined) element.value = options.value;
      for (const [name, value] of Object.entries(options?.attr ?? {})) {
        element.setAttribute(name, value);
      }
      element.parentElement = this;
      this.children.push(element);
      return element;
    }

    appendChild<T extends TestElement | TestTextNode>(child: T): T {
      if (child instanceof TestElement) {
        child.remove();
        child.parentElement = this;
      }
      this.children.push(child);
      return child;
    }

    addClass(cls: string): void {
      const classes = new Set(this.className.split(' ').filter((value) => value.length > 0));
      classes.add(cls);
      this.className = [...classes].join(' ');
    }

    removeClass(cls: string): void {
      this.className = this.className
        .split(' ')
        .filter((value) => value.length > 0 && value !== cls)
        .join(' ');
    }

    hasClass(cls: string): boolean {
      return this.className.split(' ').includes(cls);
    }

    toggleClass(cls: string, force: boolean): void {
      if (force) this.addClass(cls);
      else this.removeClass(cls);
    }

    setText(text: string): void {
      this.empty();
      this.textContent = text;
    }

    empty(): void {
      for (const child of this.children) {
        if (child instanceof TestElement) child.parentElement = null;
      }
      this.children.length = 0;
      this.textContent = '';
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }

    addEventListener(type: string, listener: (event: TestEvent) => void): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    dispatchEvent(type: string, options: { key?: string } = {}): void {
      const event: TestEvent = { type, key: options.key, preventDefault: () => {} };
      for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    }

    focus(): void {
      this.focused = true;
    }

    remove(): void {
      if (!this.parentElement) return;
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }

    querySelector<T extends TestElement = TestElement>(selector: string): T | null {
      return (this.findDescendants(selector)[0] ?? null) as T | null;
    }

    querySelectorAll<T extends TestElement = TestElement>(selector: string): T[] {
      return this.findDescendants(selector) as T[];
    }

    textOf(): string {
      return (
        this.textContent +
        this.children
          .map((child) => (child instanceof TestElement ? child.textOf() : child.textContent))
          .join('')
      );
    }

    private findDescendants(selector: string): TestElement[] {
      const found: TestElement[] = [];
      for (const child of this.children) {
        if (!(child instanceof TestElement)) continue;
        if (matches(child, selector)) found.push(child);
        found.push(...child.findDescendants(selector));
      }
      return found;
    }

  }

  function matches(element: TestElement, selector: string): boolean {
    if (selector.startsWith('.')) return element.hasClass(selector.slice(1));
    return element.tagName === selector.toUpperCase();
  }

  class ItemView {
    readonly containerEl = new TestElement('div');
    constructor() {
      this.containerEl.createDiv({ cls: 'view-header' });
      this.containerEl.createDiv({ cls: 'view-content' });
    }
  }

  class Notice {
    constructor(public readonly message: string) {}
  }

  class TFile {
    constructor(public readonly path: string) {}
  }

  function setIcon(element: TestElement, name: string): void {
    element.setAttribute('data-icon', name);
  }

  return { TestElement, ItemView, Notice, TFile, setIcon };
});

vi.mock('obsidian', () => ({
  ItemView: dom.ItemView,
  Notice: dom.Notice,
  TFile: dom.TFile,
  setIcon: dom.setIcon,
}));

const { SearchView } = await import('./view');
const { RefreshBus } = await import('../utils/refresh-bus');

type TestElement = InstanceType<typeof dom.TestElement>;

interface HarnessOptions {
  port: SearchPort | null;
  totalDocuments?: number;
  staleDocuments?: number;
  readiness?: SearchStatusSnapshot['readiness'];
  indexing?: SearchStatusSnapshot['indexing'];
}

function createHarness(options: HarnessOptions) {
  const opened: Array<{ path: string; line: number | undefined }> = [];
  const errors: unknown[] = [];
  const files = new Map<string, InstanceType<typeof dom.TFile>>();
  const refreshBus = new RefreshBus();
  const state = {
    readiness: options.readiness ?? 'ready',
    indexing: options.indexing ?? null,
  };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    },
    workspace: {
      getLeaf: () => ({
        openFile: (file: { path: string }, state?: { eState?: { line?: number } }) => {
          opened.push({ path: file.path, line: state?.eState?.line });
          return Promise.resolve();
        },
      }),
    },
  };
  const host = {
    app,
    logger: {
      warn: () => {},
      error: (_message: string, data?: { error?: unknown }) => {
        errors.push(data?.error);
      },
    },
    refreshBus,
    getSearchStatusSnapshot: () => ({
      readiness: state.readiness,
      keywordIndex: 'ready',
      ragStatus:
        options.totalDocuments === undefined
          ? null
          : {
              totalDocuments: options.totalDocuments,
              staleDocuments: options.staleDocuments ?? 0,
              missingDocuments: 0,
            },
      indexing: state.indexing,
    }),
    getSearchPort: () => options.port,
  };
  const view = new SearchView(undefined as never, host as never);
  const setReadiness = (
    readiness: SearchStatusSnapshot['readiness'],
    indexing: SearchStatusSnapshot['indexing'] = null,
  ) => {
    state.readiness = readiness;
    state.indexing = indexing;
    refreshBus.emit('rag', { status: 'success' });
  };
  return { view, opened, errors, files, setReadiness };
}

function evidence(overrides: Partial<SearchEvidence> = {}): SearchEvidence {
  return {
    sourceId: 'source-1',
    path: 'Synthetic/Alpha.md',
    revision: 'rev-1',
    startLine: 3,
    endLine: 5,
    quote: 'Quartz restarts after cooling cycles.',
    contextBefore: '',
    contextAfter: '',
    score: 3,
    rank: 1,
    signal: 'bm25',
    phraseMatches: 1,
    proximityScore: 0.4,
    fieldScore: 1,
    exactSignals: [],
    negatedNearby: false,
    duplicateOf: null,
    highlights: [{ start: 0, end: 6 }],
    ...overrides,
  };
}

function response(
  items: readonly SearchEvidence[],
  zeroHitReason: string | null = null,
  staleDocuments = 0,
): SearchResponse {
  return {
    evidence: items,
    queryTokens: [],
    phrases: [],
    diagnostics: {
      candidateDepth: 2,
      candidateDocuments: 4,
      selectedDocuments: 2,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 1, filtered: 0 },
      unmatchedTerms: [],
      zeroHitReason,
    },
    coverage: {
      documentScope: 'all',
      status: staleDocuments > 0 ? 'incomplete' : 'supported',
      reviewedDocuments: 2,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    staleDocuments,
    confidence: 'high',
    alternativeInterpretations: [],
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function contentOf(view: InstanceType<typeof SearchView>): TestElement {
  const container = view.containerEl as unknown as TestElement;
  return container.children[1] as TestElement;
}

describe('검색 화면 구조', () => {
  it('검색·필터·상태·결과 영역과 접근성 라벨을 만든다', async () => {
    const harness = createHarness({ port: null, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);

    expect(root.hasClass('superpower-inside-search-container')).toBe(true);
    const form = root.querySelector('form');
    expect(form?.getAttribute('role')).toBe('search');
    expect(root.querySelector('input')?.getAttribute('aria-label')).toBe(t('searchQueryLabel'));
    const list = root.querySelector('.superpower-inside-search-results');
    expect(list?.getAttribute('role')).toBe('list');
    expect(list?.getAttribute('aria-label')).toBe(t('searchResultsListLabel'));
    expect(root.querySelector('.superpower-inside-search-filters')?.hasClass('superpower-inside-hidden')).toBe(true);
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(t('searchStatusIdle'));
  });

  it('색인된 문서가 없으면 검색 실행을 막고 빈 색인을 알린다', async () => {
    const harness = createHarness({ port: null, totalDocuments: 0 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);

    expect(root.querySelector('.superpower-inside-search-index')?.textContent).toBe(
      t('searchIndexEmpty'),
    );
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(true);
  });

  it('색인 중이면 문서 범위를 보여 주고 검색 실행을 막는다', async () => {
    const harness = createHarness({
      port: null,
      readiness: 'preparing',
      indexing: {
        phase: 'file',
        completedFiles: 2,
        totalFiles: 5,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
      },
    });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const index = root.querySelector('.superpower-inside-search-index');

    expect(index?.textContent).toBe(t('searchIndexProgress', { completed: 2, total: 5 }));
    expect(index?.textContent).toContain('2/5');
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(true);
  });

  it('준비 중에는 키워드 색인만 남아도 부분 색인 검색을 막는다', async () => {
    const harness = createHarness({
      port: null,
      totalDocuments: 10,
      readiness: 'preparing',
      indexing: {
        phase: 'preparing',
        completedFiles: 0,
        totalFiles: 0,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
        keywordRestore: { processedDocuments: 1_200, expectedDocuments: 0 },
      },
    });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const index = root.querySelector('.superpower-inside-search-index');

    expect(index?.textContent).toContain(t('chatReadinessRagIndexing'));
    expect(index?.textContent).toContain('1200');
    // 부분 색인을 정상 결과로 쓰지 않도록 준비가 끝날 때까지 실행하지 않습니다.
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(true);
  });

  it('준비 중 Enter 제출은 질의를 보존하고 준비가 끝나면 한 번 재개한다', async () => {
    const port = vi.fn(() => Promise.resolve(response([evidence()])));
    const harness = createHarness({
      port,
      totalDocuments: 10,
      readiness: 'preparing',
      indexing: {
        phase: 'preparing',
        completedFiles: 0,
        totalFiles: 0,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
        keywordRestore: { processedDocuments: 12, expectedDocuments: 100 },
      },
    });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(port).not.toHaveBeenCalled();
    expect(input?.value).toBe('quartz');
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusWaitingForIndex'),
    );

    harness.setReadiness('ready');
    await flush();

    expect(port).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.superpower-inside-search-passage')).toHaveLength(1);
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusResults', { count: 1, documents: 1 }),
    );
  });

  it('준비 중 Escape는 보존한 검색을 취소하고 재개하지 않는다', async () => {
    const port = vi.fn(() => Promise.resolve(response([evidence()])));
    const harness = createHarness({
      port,
      totalDocuments: 10,
      readiness: 'preparing',
      indexing: {
        phase: 'preparing',
        completedFiles: 0,
        totalFiles: 0,
        currentFileEmbeddedChunks: null,
        currentFileTotalChunks: null,
        etaRemainingMs: null,
      },
    });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();
    root.dispatchEvent('keydown', { key: 'Escape' });

    harness.setReadiness('ready');
    await flush();

    expect(port).not.toHaveBeenCalled();
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusIdle'),
    );
  });

  it('검색 중 색인 준비로 바뀐 늦은 결과는 게시하지 않고 한 번 재개한다', async () => {
    let resolveFirst!: (value: SearchResponse) => void;
    const first = new Promise<SearchResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const port = vi
      .fn<SearchPort>()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(response([evidence()])));
    const harness = createHarness({ port, totalDocuments: 10 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();
    expect(port).toHaveBeenCalledTimes(1);

    harness.setReadiness('preparing', {
      phase: 'file',
      completedFiles: 1,
      totalFiles: 4,
      currentFileEmbeddedChunks: null,
      currentFileTotalChunks: null,
      etaRemainingMs: null,
    });
    await flush();
    resolveFirst(response([evidence()]));
    await flush();

    expect(root.querySelectorAll('.superpower-inside-search-passage')).toHaveLength(0);
    expect(input?.value).toBe('quartz');
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusWaitingForIndex'),
    );

    harness.setReadiness('ready');
    await flush();

    expect(port).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('.superpower-inside-search-passage')).toHaveLength(1);
    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusResults', { count: 1, documents: 1 }),
    );
  });

  it('확인된 제한 상태에서는 색인된 문서 범위로 검색을 허용한다', async () => {
    const harness = createHarness({
      port: null,
      totalDocuments: 10,
      readiness: 'degraded',
    });
    await harness.view.onOpen();
    const root = contentOf(harness.view);

    expect(root.querySelector('.superpower-inside-search-index')?.textContent).toContain(
      t('chatReadinessRagNotReady'),
    );
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(false);
  });

  it('색인 현황이 아직 없으면 색인 없음으로 안내한다', async () => {
    const harness = createHarness({ port: null, readiness: 'ready' });
    await harness.view.onOpen();
    const root = contentOf(harness.view);

    expect(root.querySelector('.superpower-inside-search-index')?.textContent).toBe(
      t('searchIndexMissing'),
    );
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(true);
  });

  it('오래된 색인이면 갱신 대기 수를 알린다', async () => {
    const harness = createHarness({ port: null, totalDocuments: 10, staleDocuments: 3 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);

    expect(root.querySelector('.superpower-inside-search-index')?.textContent).toBe(
      t('searchIndexStale', { count: 3 }),
    );
    expect(root.querySelector('.superpower-inside-search-run')?.disabled).toBe(false);
  });

  it('검색 엔진 포트가 없으면 사용 불가 상태를 표시한다', async () => {
    const harness = createHarness({ port: null, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');

    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusUnavailable'),
    );
  });

  it('결과를 파일별로 묶고 강조 구간과 위치를 표시한다', async () => {
    const port: SearchPort = () =>
      Promise.resolve(
        response([
          evidence({ rank: 1, startLine: 3, endLine: 5 }),
          evidence({
            rank: 2,
            sourceId: 'source-2',
            path: 'Synthetic/Beta.md',
            startLine: 12,
            endLine: 12,
            duplicateOf: 'source-1',
          }),
        ]),
      );
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusResults', { count: 2, documents: 2 }),
    );
    const passages = root.querySelectorAll('.superpower-inside-search-passage');
    expect(passages).toHaveLength(2);
    expect(passages[0]?.querySelector('mark')?.textContent).toBe('Quartz');
    expect(passages[0]?.textOf()).toContain(t('searchResultLineLabel', { range: '3–5' }));
    expect(passages[1]?.textOf()).toContain(t('searchResultLineLabel', { range: '12' }));
    expect(passages[1]?.textOf()).toContain(t('searchResultDuplicate'));
    expect(root.querySelectorAll('.superpower-inside-search-path')).toHaveLength(2);
    expect(root.textOf()).toContain(t('searchScoreNotice'));
  });

  it('확신도가 높지 않으면 결과 뒤에 다른 해석 후보를 안내한다', async () => {
    const port: SearchPort = () =>
      Promise.resolve({
        ...response([evidence({ rank: 1 })]),
        confidence: 'medium',
        alternativeInterpretations: ['Synthetic/Beta.md', 'Synthetic/Gamma.md'],
      });
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.textOf()).toContain(
      t('searchStatusOtherInterpretations', {
        paths: 'Synthetic/Beta.md, Synthetic/Gamma.md',
      }),
    );
  });

  it('빈 결과는 이유와 함께 표시한다', async () => {
    const port: SearchPort = () => Promise.resolve(response([], 'no-candidate'));
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusEmpty'),
    );
    expect(root.textOf()).toContain(t('searchStatusEmptyReason', { reason: 'no-candidate' }));
  });

  it('후보 범위 검색의 빈 결과는 전체 색인 검토로 표시하지 않는다', async () => {
    const candidateResponse = response([], 'no-documents');
    candidateResponse.coverage = {
      ...candidateResponse.coverage,
      documentScope: 'candidates',
      status: 'incomplete',
      reviewedDocuments: 0,
      unreviewedDocuments: 4,
    };
    const port: SearchPort = () => Promise.resolve(candidateResponse);
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.textOf()).toContain(
      t('searchStatusTruncated', {
        total: candidateResponse.coverage.reviewedDocuments,
        candidate: candidateResponse.diagnostics.candidateDocuments,
        selected: candidateResponse.diagnostics.selectedDocuments,
      }),
    );
  });

  it('리비전 불일치로 결과가 비면 완료 대신 오래된 색인 상태를 표시한다', async () => {
    const port: SearchPort = () => Promise.resolve(response([], 'no-candidate', 1));
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusStaleNoResults', { count: 1 }),
    );
    expect(root.querySelector('.superpower-inside-search-status')?.hasClass('is-warning')).toBe(true);
  });

  it('일부 결과가 오래되면 결과와 함께 색인 갱신 안내를 표시한다', async () => {
    const port: SearchPort = () => Promise.resolve(response([evidence()], null, 1));
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.textOf()).toContain(t('searchStatusStale', { count: 1 }));
    expect(root.querySelector('.superpower-inside-search-status')?.hasClass('is-warning')).toBe(true);
  });

  it('실패하면 오류 상태를 표시하고 기록을 남긴다', async () => {
    const port: SearchPort = () => {
      return Promise.reject(new Error('synthetic failure'));
    };
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    expect(root.querySelector('.superpower-inside-search-status')?.textContent).toBe(
      t('searchStatusFailed', { message: 'synthetic failure' }),
    );
    expect(harness.errors).toHaveLength(1);
  });

  it('↑/↓로 결과를 이동하고 Enter로 문서를 연다', async () => {
    const port: SearchPort = () =>
      Promise.resolve(
        response([evidence({ rank: 1 }), evidence({ rank: 2, sourceId: 'source-2', startLine: 9 })]),
      );
    const harness = createHarness({ port, totalDocuments: 4 });
    await harness.view.onOpen();
    const root = contentOf(harness.view);
    const input = root.querySelector('input');
    if (input) input.value = 'quartz';
    root.querySelector('form')?.dispatchEvent('submit');
    await flush();

    harness.files.set('Synthetic/Alpha.md', new dom.TFile('Synthetic/Alpha.md'));
    const passages = root.querySelectorAll('.superpower-inside-search-passage');
    root.dispatchEvent('keydown', { key: 'ArrowDown' });
    expect(passages[1]?.focused).toBe(true);

    passages[1]?.dispatchEvent('keydown', { key: 'Enter' });
    await flush();
    expect(harness.opened).toEqual([{ path: 'Synthetic/Alpha.md', line: 8 }]);
  });
});
