import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToolCallPanel } from './tool-call-panel';
import type { ToolCallRecord } from './types';

interface TestElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

type TestEventListener = () => void;

class TestHTMLElement {
  readonly children: TestHTMLElement[] = [];
  readonly tagName: string;
  parentElement: TestHTMLElement | null = null;
  className = '';
  hidden = false;
  id = '';
  textContent = '';
  focused = false;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, TestEventListener[]>();

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
    const element =
      tagName === 'details' ? new TestHTMLDetailsElement() : new TestHTMLElement(tagName);
    return this.appendElement(element, options);
  }

  appendChild<T extends TestHTMLElement>(element: T): T {
    element.remove();
    element.parentElement = this;
    this.children.push(element);
    return element;
  }

  insertBefore<T extends TestHTMLElement>(element: T, reference: TestHTMLElement | null): T {
    element.remove();
    element.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(element);
    else this.children.splice(index, 0, element);
    return element;
  }

  empty(): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.textContent = '';
  }

  setText(text: string): void {
    this.empty();
    this.textContent = text;
  }

  querySelector<T extends TestHTMLElement = TestHTMLElement>(selector: string): T | null {
    return this.findDescendant((element) => element.matches(selector)) as T | null;
  }

  querySelectorAll<T extends TestHTMLElement = TestHTMLElement>(selector: string): T[] {
    return this.findDescendants((element) => element.matches(selector)) as T[];
  }

  closest<T extends TestHTMLElement = TestHTMLElement>(selector: string): T | null {
    if (this.matches(selector)) return this as unknown as T;
    let element = this.parentElement;
    while (element) {
      if (element.matches(selector)) return element as T;
      element = element.parentElement;
    }
    return null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.id = value;
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || null;
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: TestEventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  click(): void {
    this.dispatchEvent('click');
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

  private matches(selector: string): boolean {
    const notClassMatch = selector.match(/:not\(\.([^)]+)\)$/);
    const selectorWithoutNot = notClassMatch
      ? selector.slice(0, Math.max(0, selector.length - notClassMatch[0].length))
      : selector;
    const selectorParts = selectorWithoutNot.split('.');
    const tagName = selectorParts[0] ?? '';
    const classes = selectorParts.slice(1).filter(Boolean);
    const hasRequiredClasses = classes.every((className) =>
      this.className.split(/\s+/).includes(className),
    );
    const hasRequiredTag = !tagName || this.tagName === tagName.toUpperCase();
    const excludesNotClass =
      !notClassMatch || !this.className.split(/\s+/).includes(notClassMatch[1] ?? '');
    return hasRequiredClasses && hasRequiredTag && excludesNotClass;
  }
}

class TestHTMLDetailsElement extends TestHTMLElement {
  open = false;

  constructor() {
    super('details');
  }
}

const originalHTMLElement = globalThis.HTMLElement;
const originalHTMLDetailsElement = globalThis.HTMLDetailsElement;

beforeAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: TestHTMLElement,
  });
  Object.defineProperty(globalThis, 'HTMLDetailsElement', {
    configurable: true,
    value: TestHTMLDetailsElement,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: originalHTMLElement,
  });
  Object.defineProperty(globalThis, 'HTMLDetailsElement', {
    configurable: true,
    value: originalHTMLDetailsElement,
  });
});

function createFixture(): {
  section: TestHTMLElement;
  panel: ToolCallPanel;
  approveToolCall: ReturnType<typeof vi.fn>;
} {
  const bubble = new TestHTMLElement();
  bubble.className = 'superpower-inside-chat-bubble-container';
  bubble.setAttribute('data-message-id', 'message-1');
  const section = bubble.createDiv();
  const approveToolCall = vi.fn();
  const panel = new ToolCallPanel({
    approveToolCall,
    renderMarkdown: (container, content) => {
      container.setText(content);
    },
    setIcon: (element, icon) => {
      element.setAttribute('data-test-icon', icon);
    },
  });
  return { section, panel, approveToolCall };
}

function createRunningCall(result = '긴 실행 결과'): ToolCallRecord {
  return {
    id: 'call-1',
    name: 'search_notes',
    arguments: '{ "query": "obsidian" }',
    result,
    resultSummary: '검색 결과 1개',
    status: 'running',
    approved: false,
  };
}

describe('ToolCallPanel DOM contract', () => {
  it('호출 하나의 헤더, 요약, 승인, 단일 세부정보를 같은 그룹 안에 순서대로 둔다', () => {
    const { section, panel, approveToolCall } = createFixture();

    panel.renderToolCallsSection(section as unknown as HTMLElement, [createRunningCall()], false);

    const group = section.querySelector('.superpower-inside-tool-call-group');
    expect(group?.getAttribute('data-tool-call-id')).toBe('tool-call-call-1');
    expect(group?.children.map((child) => child.className)).toEqual([
      'superpower-inside-tool-call-header',
      'superpower-inside-tool-call-summary',
      'superpower-inside-tool-call-approve',
      'superpower-inside-tool-call-details',
    ]);

    const details = group?.querySelector<TestHTMLDetailsElement>(
      '.superpower-inside-tool-call-details',
    );
    expect(section.querySelectorAll('details')).toHaveLength(1);
    expect(details?.open).toBe(false);
    expect(details?.parentElement).toBe(group);
    expect(details?.querySelector('.superpower-inside-tool-arguments')?.parentElement).toBe(
      details?.querySelector('.superpower-inside-tool-call-details-content'),
    );
    expect(details?.querySelector('.superpower-inside-tool-result-details')?.parentElement).toBe(
      details?.querySelector('.superpower-inside-tool-call-details-content'),
    );

    const status = group?.querySelector('.superpower-inside-tool-call-status');
    expect(status?.textContent).toBe('');
    expect(status?.querySelector('.superpower-inside-tool-call-status-text')?.textContent).toBe(
      '실행 중',
    );
    expect(
      status
        ?.querySelector('.superpower-inside-tool-call-status-icon')
        ?.getAttribute('data-test-icon'),
    ).toBe('loader-circle');

    const approve = group?.querySelector('.superpower-inside-tool-call-approve');
    expect(approve?.tagName).toBe('BUTTON');
    expect(approve?.getAttribute('type')).toBe('button');
    expect(approve?.getAttribute('aria-label')).toBe('실행 승인');
    approve?.click();
    expect(approveToolCall).toHaveBeenCalledWith('message-1', 'call-1');
  });

  it('재렌더 시 세부정보 open 상태와 포커스된 승인 버튼을 보존한다', () => {
    const { section, panel } = createFixture();
    panel.renderToolCallsSection(section as unknown as HTMLElement, [createRunningCall()], false);

    const firstDetails = section.querySelector<TestHTMLDetailsElement>(
      '.superpower-inside-tool-call-details',
    );
    const firstSummary = firstDetails?.querySelector(
      '.superpower-inside-tool-call-details-summary',
    );
    const firstApprove = section.querySelector('.superpower-inside-tool-call-approve');
    if (!firstDetails || !firstSummary || !firstApprove) throw new Error('초기 패널 렌더 실패');

    firstDetails.open = true;
    firstDetails.dispatchEvent('toggle');
    firstApprove.focus();
    expect(firstSummary.getAttribute('aria-expanded')).toBe('true');

    panel.renderToolCallsSection(
      section as unknown as HTMLElement,
      [createRunningCall('업데이트된 긴 실행 결과')],
      false,
    );

    const rerenderedDetails = section.querySelector<TestHTMLDetailsElement>(
      '.superpower-inside-tool-call-details',
    );
    const rerenderedSummary = rerenderedDetails?.querySelector(
      '.superpower-inside-tool-call-details-summary',
    );
    const rerenderedApprove = section.querySelector('.superpower-inside-tool-call-approve');
    expect(rerenderedDetails?.open).toBe(true);
    expect(rerenderedSummary?.getAttribute('aria-expanded')).toBe('true');
    expect(rerenderedApprove).toBe(firstApprove);
    expect(rerenderedApprove?.focused).toBe(true);
  });
});
