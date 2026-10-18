import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t, type I18nKeys } from './i18n';
import {
  EXCLUDE_POPOVER_HOVER_DELAY_MS,
  ExcludePathPopoverController,
  formatExcludeByteSize,
  formatExcludeDate,
  planExcludePopoverLayout,
  splitExcludePathSegments,
} from './settings-exclude-popover';
import type { ExcludePathMetadata } from './utils/vault';

interface TestElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

interface TestEvent {
  type: string;
  target: TestHTMLElement | null;
  key?: string;
}

interface TestRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

class TestHTMLElement {
  readonly children: TestHTMLElement[] = [];
  readonly tagName: string;
  parentElement: TestHTMLElement | null = null;
  className = '';
  textContent = '';
  rect: TestRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  readonly cssProps = new Map<string, string>();
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(event: TestEvent) => void>>();

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  createDiv(options?: TestElementOptions): TestHTMLElement {
    return this.appendElement(new TestHTMLElement('div'), options);
  }

  createSpan(options?: TestElementOptions): TestHTMLElement {
    return this.appendElement(new TestHTMLElement('span'), options);
  }

  createEl(tagName: string, options?: TestElementOptions): TestHTMLElement {
    return this.appendElement(new TestHTMLElement(tagName), options);
  }

  empty(): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.textContent = '';
  }

  addClass(...classes: string[]): void {
    const current = this.className.split(' ').filter((value) => value.length > 0);
    for (const value of classes) {
      if (!current.includes(value)) current.push(value);
    }
    this.className = current.join(' ');
  }

  removeClass(...classes: string[]): void {
    this.className = this.className
      .split(' ')
      .filter((value) => value.length > 0 && !classes.includes(value))
      .join(' ');
  }

  toggleClass(classes: string | string[], value: boolean): void {
    const list = typeof classes === 'string' ? [classes] : classes;
    if (value) this.addClass(...list);
    else this.removeClass(...list);
  }

  hasClass(cls: string): boolean {
    return this.className.split(' ').includes(cls);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className.length > 0 ? this.className : null;
    return this.attributes.get(name) ?? null;
  }

  setCssProps(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.cssProps.set(name, value);
  }

  getCssProp(name: string): string | null {
    return this.cssProps.get(name) ?? null;
  }

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = (this.listeners.get(type) ?? []).filter((entry) => entry !== listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(type: string, init: { target?: TestHTMLElement; key?: string } = {}): void {
    const event: TestEvent = { type, target: init.target ?? this, key: init.key };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  contains(node: unknown): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
  }

  getBoundingClientRect(): TestRect {
    return this.rect;
  }

  querySelector<T extends TestHTMLElement = TestHTMLElement>(selector: string): T | null {
    return this.findDescendant((element) => element.matches(selector)) as T | null;
  }

  querySelectorAll<T extends TestHTMLElement = TestHTMLElement>(selector: string): T[] {
    return this.findDescendants((element) => element.matches(selector)) as T[];
  }

  private matches(selector: string): boolean {
    const classes = selector
      .split('.')
      .slice(1)
      .filter((value) => value.length > 0);
    return classes.every((className) => this.hasClass(className));
  }

  private appendElement<T extends TestHTMLElement>(element: T, options?: TestElementOptions): T {
    element.parentElement = this;
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.children.push(element);
    return element;
  }

  private findDescendant(predicate: (element: TestHTMLElement) => boolean): TestHTMLElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const descendant = child.findDescendant(predicate);
      if (descendant) return descendant;
    }
    return null;
  }

  private findDescendants(predicate: (element: TestHTMLElement) => boolean): TestHTMLElement[] {
    const matches: TestHTMLElement[] = [];
    for (const child of this.children) {
      if (predicate(child)) matches.push(child);
      matches.push(...child.findDescendants(predicate));
    }
    return matches;
  }
}

class TestView {
  private readonly listeners = new Map<string, Array<(event: TestEvent) => void>>();

  constructor(readonly innerHeight: number) {}

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = (this.listeners.get(type) ?? []).filter((entry) => entry !== listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(type: string, init: { target?: TestHTMLElement } = {}): void {
    const event: TestEvent = { type, target: init.target ?? null };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

class TestDocument {
  defaultView: TestView | null = null;
  private readonly listeners = new Map<string, Array<(event: TestEvent) => void>>();

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void): void {
    const listeners = (this.listeners.get(type) ?? []).filter((entry) => entry !== listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(type: string, init: { key?: string } = {}): void {
    const event: TestEvent = { type, target: null, key: init.key };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const originalHTMLElement = globalThis.HTMLElement;

beforeAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: TestHTMLElement,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: originalHTMLElement,
  });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setLanguage('ko');
});

function createMetadata(overrides: Partial<ExcludePathMetadata> = {}): ExcludePathMetadata {
  return {
    entry: 'Research/Archive',
    kind: 'folder',
    displayPath: 'Research/Archive',
    exists: true,
    matches: [],
    matchCount: 0,
    totalFileCount: 32,
    totalSizeBytes: 1887437,
    latestMtimeMs: Date.UTC(2026, 0, 15, 12),
    ...overrides,
  };
}

function createFixture(metadata: ExcludePathMetadata = createMetadata()) {
  const doc = new TestDocument();
  const container = new TestHTMLElement('body');
  const bounds = new TestHTMLElement('div');
  bounds.rect = { left: 100, top: 0, right: 520, bottom: 900, width: 420, height: 900 };
  const rowEl = new TestHTMLElement('div');
  rowEl.addClass('superpower-inside-exclude-item');
  const valueEl = rowEl.createDiv({ cls: 'superpower-inside-exclude-value', text: 'Research/Archive' });
  const removeButtonEl = rowEl.createEl('button', { cls: 'superpower-inside-exclude-remove-btn' });
  const getMetadata = vi.fn((value: string): ExcludePathMetadata => ({ ...metadata, entry: value }));
  const controller = new ExcludePathPopoverController({
    doc: doc as unknown as Document,
    container: container as unknown as HTMLElement,
    boundsEl: bounds as unknown as HTMLElement,
    getMetadata,
  });
  controller.attachRow({
    rowEl: rowEl as unknown as HTMLElement,
    valueEl: valueEl as unknown as HTMLElement,
    removeButtonEl: removeButtonEl as unknown as HTMLElement,
    value: 'Research/Archive',
  });
  const getPopover = (): TestHTMLElement => {
    const popover = container.querySelector('.superpower-inside-exclude-popover');
    if (!popover) throw new Error('팝오버가 생성되지 않았습니다.');
    return popover;
  };
  return { controller, doc, container, bounds, rowEl, valueEl, removeButtonEl, getMetadata, getPopover };
}

describe('제외 경로 팝오버 포맷', () => {
  it('바이트 값을 사람이 읽는 단위로 바꾼다', () => {
    expect(formatExcludeByteSize(0)).toBe('0 B');
    expect(formatExcludeByteSize(900)).toBe('900 B');
    expect(formatExcludeByteSize(1024)).toBe('1 KB');
    expect(formatExcludeByteSize(1536)).toBe('1.5 KB');
    expect(formatExcludeByteSize(1887437)).toBe('1.8 MB');
    expect(formatExcludeByteSize(5 * 1024 * 1024 * 1024)).toBe('5 GB');
  });

  it('날짜가 없으면 null, 있으면 연도를 담은 날짜를 돌려준다', () => {
    expect(formatExcludeDate(null, 'ko-KR')).toBeNull();
    expect(formatExcludeDate(Date.UTC(2026, 5, 10, 12), 'ko-KR')).toContain('2026');
    expect(formatExcludeDate(Date.UTC(2026, 5, 10, 12), 'en-US')).toContain('2026');
  });

  it('경로를 /로 나눠 브레드크럼 조각으로 만든다', () => {
    expect(splitExcludePathSegments('**/drafts/**')).toEqual(['**', 'drafts', '**']);
    expect(splitExcludePathSegments('Research/Archive/')).toEqual(['Research', 'Archive']);
    expect(splitExcludePathSegments('/')).toEqual([]);
  });
});

describe('제외 경로 팝오버 배치', () => {
  const baseInput = {
    anchor: { left: 200, top: 600, bottom: 628, width: 200 },
    size: { width: 320, height: 180 },
    bounds: { left: 100, right: 520 },
    vertical: { top: 12, bottom: 1000 },
    gap: 12,
    arrowHalf: 5,
  };

  it('위 공간이 충분하면 행 위에 놓고 화살표를 행 중앙에 맞춘다', () => {
    const layout = planExcludePopoverLayout(baseInput);
    expect(layout.placement).toBe('above');
    expect(layout.top).toBe(408);
    expect(layout.left).toBe(140);
    expect(layout.arrowX).toBe(160);
    expect(layout.width).toBe(320);
  });

  it('위 공간이 부족할 때만 아래로 뒤집는다', () => {
    const layout = planExcludePopoverLayout({
      ...baseInput,
      anchor: { left: 200, top: 40, bottom: 68, width: 200 },
    });
    expect(layout.placement).toBe('below');
    expect(layout.top).toBe(80);
  });

  it('좌우는 설정 콘텐츠 경계 안으로 클램프한다', () => {
    const leftLayout = planExcludePopoverLayout({
      ...baseInput,
      anchor: { left: 90, top: 600, bottom: 628, width: 20 },
    });
    expect(leftLayout.left).toBe(100);
    expect(leftLayout.arrowX).toBe(5);

    const rightLayout = planExcludePopoverLayout({
      ...baseInput,
      anchor: { left: 510, top: 600, bottom: 628, width: 20 },
    });
    expect(rightLayout.left).toBe(200);
    expect(rightLayout.arrowX).toBe(315);
  });

  it('위·아래 모두 부족한 낮은 뷰포트에서는 배치를 유지하고 남는 높이로 제한한다', () => {
    const layout = planExcludePopoverLayout({
      ...baseInput,
      anchor: { left: 200, top: 300, bottom: 336, width: 200 },
      size: { width: 320, height: 345.7 },
      vertical: { top: 12, bottom: 588 },
    });

    expect(layout.placement).toBe('below');
    expect(layout.top).toBe(348);
    expect(layout.maxHeight).toBe(240);
    expect(layout.top + (layout.maxHeight ?? 0)).toBeLessThanOrEqual(588);
    expect(layout.arrowX).toBeGreaterThanOrEqual(baseInput.arrowHalf);
    expect(layout.arrowX).toBeLessThanOrEqual(layout.width - baseInput.arrowHalf);
  });

  it('정상 뷰포트에서는 높이 제한 없이 기존 배치를 유지한다', () => {
    const layout = planExcludePopoverLayout(baseInput);

    expect(layout.placement).toBe('above');
    expect(layout.top).toBe(408);
    expect(layout.maxHeight).toBeNull();
  });

  it('뷰포트가 최소 가독 높이보다 짧아도 팝오버는 뷰포트 안에 남는다', () => {
    const layout = planExcludePopoverLayout({
      ...baseInput,
      anchor: { left: 200, top: 20, bottom: 40, width: 200 },
      size: { width: 320, height: 345 },
      vertical: { top: 12, bottom: 68 },
    });

    expect(layout.top).toBe(52);
    expect(layout.maxHeight).toBe(16);
    expect(layout.maxHeight).toBeLessThan(120);
    expect(layout.top + (layout.maxHeight ?? 0)).toBe(68);
    expect(layout.arrowX).toBeGreaterThanOrEqual(baseInput.arrowHalf);
    expect(layout.arrowX).toBeLessThanOrEqual(layout.width - baseInput.arrowHalf);
  });

  it('콘텐츠 경계가 좁으면 폭을 줄여 경계를 넘지 않는다', () => {
    const layout = planExcludePopoverLayout({ ...baseInput, bounds: { left: 0, right: 240 } });
    expect(layout.width).toBe(240);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.left + layout.width).toBeLessThanOrEqual(240);
  });
});

describe('제외 경로 팝오버 동작', () => {
  it('행 위 1000ms에서 열리고 999ms에서는 열지 않는다', () => {
    const { rowEl, valueEl, getMetadata, getPopover } = createFixture();
    rowEl.dispatchEvent('pointerover', { target: valueEl });

    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS - 1);
    expect(getPopover().hasClass('is-open')).toBe(false);
    expect(getMetadata).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(getPopover().hasClass('is-open')).toBe(true);
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('마우스가 행을 떠나면 대기 중인 팝오버를 열지 않는다', () => {
    const { rowEl, valueEl, getMetadata, getPopover } = createFixture();
    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(500);
    rowEl.dispatchEvent('pointerleave');
    vi.advanceTimersByTime(1500);

    expect(getPopover().hasClass('is-open')).toBe(false);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('팝오버로 포인터를 옮기면 유지하고 팝오버를 떠나면 닫는다', () => {
    const { rowEl, valueEl, getPopover } = createFixture();
    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS);
    const popover = getPopover();
    expect(popover.hasClass('is-open')).toBe(true);

    rowEl.dispatchEvent('pointerleave');
    popover.dispatchEvent('pointerenter');
    vi.advanceTimersByTime(1000);
    expect(popover.hasClass('is-open')).toBe(true);

    popover.dispatchEvent('pointerleave');
    vi.advanceTimersByTime(1000);
    expect(popover.hasClass('is-open')).toBe(false);
  });

  it('제거 버튼 위에서는 팝오버를 띄우지 않는다', () => {
    const { rowEl, removeButtonEl, getMetadata, getPopover } = createFixture();
    rowEl.dispatchEvent('pointerover', { target: removeButtonEl });
    vi.advanceTimersByTime(1500);

    expect(getPopover().hasClass('is-open')).toBe(false);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it('경로 값에 포커스하면 지연 없이 열리고 blur에서 닫힌다', () => {
    const { valueEl, getPopover } = createFixture();
    valueEl.dispatchEvent('focus');
    expect(getPopover().hasClass('is-open')).toBe(true);

    valueEl.dispatchEvent('blur');
    expect(getPopover().hasClass('is-open')).toBe(false);
  });

  it('경로에 포커스가 남아 있으면 행을 벗어나도 닫지 않는다', () => {
    const { rowEl, valueEl, getPopover } = createFixture();
    valueEl.dispatchEvent('focus');
    rowEl.dispatchEvent('pointerleave');
    vi.advanceTimersByTime(1000);
    expect(getPopover().hasClass('is-open')).toBe(true);

    valueEl.dispatchEvent('blur');
    expect(getPopover().hasClass('is-open')).toBe(false);
  });

  it('Esc로 닫는다', () => {
    const { valueEl, doc, getPopover } = createFixture();
    valueEl.dispatchEvent('focus');
    expect(getPopover().hasClass('is-open')).toBe(true);

    doc.dispatchEvent('keydown', { key: 'Escape' });
    expect(getPopover().hasClass('is-open')).toBe(false);
  });

  it('메타데이터는 처음 열 때 한 번만 계산해 행 단위로 재사용한다', () => {
    const { rowEl, valueEl, doc, getMetadata } = createFixture();
    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS);
    doc.dispatchEvent('keydown', { key: 'Escape' });

    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS);
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('낮은 뷰포트에서는 높이를 제한하고 내부 스크롤 클래스를 붙인다', () => {
    const { doc, rowEl, valueEl, getPopover } = createFixture(createMetadata({ kind: 'pattern' }));
    doc.defaultView = new TestView(600);
    rowEl.rect = { left: 200, top: 300, right: 420, bottom: 336, width: 220, height: 36 };
    const popover = getPopover();
    popover.rect = { left: 150, top: 0, right: 470, bottom: 345, width: 320, height: 345 };

    valueEl.dispatchEvent('focus');

    expect(popover.getCssProp('--superpower-inside-exclude-popover-y')).toBe('348px');
    expect(popover.getCssProp('--superpower-inside-exclude-popover-max-height')).toBe('240px');
    expect(popover.hasClass('is-scrollable')).toBe(true);
  });

  it('뷰포트가 충분하면 높이 제한을 걸지 않는다', () => {
    const { valueEl, getPopover } = createFixture();
    valueEl.dispatchEvent('focus');
    const popover = getPopover();

    expect(popover.hasClass('is-scrollable')).toBe(false);
    expect(popover.getCssProp('--superpower-inside-exclude-popover-max-height')).toBeNull();
  });

  it('정리하면 팝오버를 제거하고 더 이상 반응하지 않는다', () => {
    const { controller, rowEl, valueEl, getMetadata, getPopover } = createFixture();
    const popover = getPopover();
    controller.destroy();

    expect(popover.parentElement).toBeNull();
    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS);
    expect(popover.hasClass('is-open')).toBe(false);
    expect(getMetadata).not.toHaveBeenCalled();
  });
});

describe('제외 경로 팝오버 내용', () => {
  it('경로 값은 포커스 가능하고 팝오버와 aria로 연결된다', () => {
    const { valueEl, getPopover } = createFixture();
    const popover = getPopover();

    expect(valueEl.getAttribute('tabindex')).toBe('0');
    expect(valueEl.getAttribute('aria-describedby')).toBe(popover.getAttribute('id'));
    expect(popover.getAttribute('id')).toMatch(/^superpower-inside-exclude-popover-/);
    expect(popover.getAttribute('role')).toBe('tooltip');
  });

  it('패턴은 매칭 위치를 3곳까지만 보여주고 나머지를 개수로 요약한다', () => {
    const matches = [1, 2, 3, 4, 5].map((index) => ({
      path: 'Projects/Atlas/drafts-' + String(index),
      fileCount: index,
      sizeBytes: index * 1024,
      latestMtimeMs: null,
    }));
    const { rowEl, valueEl, getPopover } = createFixture(
      createMetadata({
        kind: 'pattern',
        displayPath: '**/drafts/**',
        matches,
        matchCount: 5,
        totalFileCount: 18,
      }),
    );
    rowEl.dispatchEvent('pointerover', { target: valueEl });
    vi.advanceTimersByTime(EXCLUDE_POPOVER_HOVER_DELAY_MS);
    const popover = getPopover();

    expect(popover.querySelectorAll('.superpower-inside-exclude-popover-match')).toHaveLength(3);
    expect(popover.querySelector('.superpower-inside-exclude-popover-more')?.textContent).toBe(
      t('excludePopoverMatchesMore', { count: 2 }),
    );
  });

  it('일치하는 위치가 없으면 경고 톤으로 안내하고 통계는 비워 둔다', () => {
    const { valueEl, getPopover } = createFixture(
      createMetadata({
        exists: false,
        matches: [],
        matchCount: 0,
        totalFileCount: 0,
        totalSizeBytes: 0,
        latestMtimeMs: null,
      }),
    );
    valueEl.dispatchEvent('focus');
    const popover = getPopover();
    const status = popover.querySelector('.superpower-inside-exclude-popover-status');

    expect(status?.hasClass('is-warning')).toBe(true);
    expect(status?.querySelector('.superpower-inside-exclude-popover-tone')?.textContent).toBe('◇');
    expect(status?.querySelector('.superpower-inside-exclude-popover-status-text')?.textContent).toBe(
      t('excludePopoverMissing'),
    );
  });
});

describe('제외 경로 팝오버 문구', () => {
  const keys: Array<keyof I18nKeys> = [
    'excludePopoverTitle',
    'excludePopoverKindFolder',
    'excludePopoverKindPattern',
    'excludePopoverRoot',
    'excludePopoverFolderStatus',
    'excludePopoverPatternStatus',
    'excludePopoverMissing',
    'excludePopoverMatchesLabel',
    'excludePopoverCountValue',
    'excludePopoverMatchesMore',
    'excludePopoverStatDocuments',
    'excludePopoverStatSize',
    'excludePopoverStatModified',
    'excludePopoverNote',
  ];

  it('팝오버 문구가 한국어와 영어에 모두 있다', () => {
    for (const language of ['ko', 'en'] as const) {
      setLanguage(language);
      for (const key of keys) {
        const text = t(key);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toBe(key);
      }
    }
  });
});
