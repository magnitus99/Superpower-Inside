import { describe, expect, it } from 'vitest';
import {
  createAssistantResponseLayout,
  createAssistantResponseLayoutViewModel,
  type AssistantResponseLayoutLabels,
} from './assistant-response-layout';

interface TestElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

interface TestEvent {
  key: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

type TestEventListener = (event: TestEvent) => void;

class TestHTMLElement {
  readonly children: TestHTMLElement[] = [];
  readonly tagName: string;
  className = '';
  disabled = false;
  focusCount = 0;
  hidden = false;
  id = '';
  tabIndex = 0;
  textContent = '';
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, TestEventListener[]>();

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  createDiv(options?: TestElementOptions): TestHTMLElement {
    return this.appendElement(new TestHTMLElement('div'), options);
  }

  createEl(tagName: string, options?: TestElementOptions): TestHTMLElement {
    return this.appendElement(new TestHTMLElement(tagName), options);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: TestEventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    this.dispatch('click', '');
  }

  keydown(key: string): TestEvent {
    return this.dispatch('keydown', key);
  }

  focus(): void {
    this.focusCount += 1;
  }

  private dispatch(type: string, key: string): TestEvent {
    const event: TestEvent = {
      key,
      defaultPrevented: false,
      preventDefault: () => {
        event.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }

  private appendElement<T extends TestHTMLElement>(element: T, options?: TestElementOptions): T {
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.children.push(element);
    return element;
  }
}

const labels: AssistantResponseLayoutLabels = {
  answer: '답변',
  work: '작업',
  sources: (count) => `출처 ${count}`,
};

describe('Assistant response layout view model', () => {
  it('진행 중 답변이 비어 있고 작업이 있으면 작업을 선택한다', () => {
    const view = createAssistantResponseLayoutViewModel({
      hasAnswer: false,
      hasWork: true,
      sourceCount: 2,
      isComplete: false,
      labels,
    });

    expect(view.activeTab).toBe('work');
    expect(view.tabs.find((tab) => tab.key === 'answer')).toEqual(
      expect.objectContaining({
        available: false,
        hidden: true,
        disabled: true,
        selected: false,
      }),
    );
    expect(view.tabs.find((tab) => tab.key === 'work')?.selected).toBe(true);
    expect(view.tabs.find((tab) => tab.key === 'sources')?.label).toBe('출처 2');
  });

  it('완료된 답변이 있으면 작업보다 답변을 우선한다', () => {
    const view = createAssistantResponseLayoutViewModel({
      hasAnswer: true,
      hasWork: true,
      sourceCount: 1,
      isComplete: true,
      labels,
    });

    expect(view.activeTab).toBe('answer');
  });

  it('사용자가 고른 가용 탭을 자동 선택 규칙보다 우선한다', () => {
    const view = createAssistantResponseLayoutViewModel({
      hasAnswer: true,
      hasWork: true,
      sourceCount: 3,
      isComplete: true,
      labels,
      manualActiveTab: 'work',
    });

    expect(view.activeTab).toBe('work');
    expect(view.tabs.find((tab) => tab.key === 'work')?.tabIndex).toBe(0);
    expect(view.tabs.find((tab) => tab.key === 'answer')?.tabIndex).toBe(-1);
  });

  it('잘못된 출처 수를 0으로 정규화하고 빈 탭은 선택하지 않는다', () => {
    const view = createAssistantResponseLayoutViewModel({
      hasAnswer: false,
      hasWork: false,
      sourceCount: Number.NaN,
      isComplete: false,
      labels,
      manualActiveTab: 'sources',
    });

    expect(view.sourceCount).toBe(0);
    expect(view.activeTab).toBeNull();
    expect(view.tabs.every((tab) => tab.hidden && tab.disabled)).toBe(true);
  });
});

describe('Assistant response layout DOM contract', () => {
  it('tablist, tab, tabpanel 관계를 접근 가능한 속성으로 연결한다', () => {
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const layout = createAssistantResponseLayout(container, {
      idPrefix: 'message-1',
      ariaLabel: 'AI 응답',
      labels,
      state: {
        hasAnswer: true,
        hasWork: true,
        sourceCount: 2,
        isComplete: true,
      },
    });

    expect(layout.tabList.getAttribute('role')).toBe('tablist');
    expect(layout.tabList.getAttribute('aria-label')).toBe('AI 응답');
    expect(layout.tabs.answer.getAttribute('role')).toBe('tab');
    expect(layout.tabs.answer.getAttribute('aria-controls')).toBe('message-1-panel-answer');
    expect(layout.tabs.answer.getAttribute('aria-selected')).toBe('true');
    expect(layout.panels.answer.getAttribute('role')).toBe('tabpanel');
    expect(layout.panels.answer.getAttribute('aria-labelledby')).toBe('message-1-tab-answer');
    expect(layout.panels.answer.hidden).toBe(false);
    expect(layout.panels.work.hidden).toBe(true);
  });

  it('출처 수와 작업·출처 가용성을 update에서 갱신한다', () => {
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const layout = createAssistantResponseLayout(container, {
      ariaLabel: 'AI 응답',
      labels,
      state: {
        hasAnswer: false,
        hasWork: true,
        sourceCount: 0,
        isComplete: false,
      },
    });

    expect(layout.tabs.answer.hidden).toBe(true);
    expect(layout.tabs.work.getAttribute('aria-selected')).toBe('true');
    expect(layout.tabs.sources.hidden).toBe(true);

    layout.update({
      hasAnswer: true,
      hasWork: false,
      sourceCount: 4,
      isComplete: true,
    });

    expect(layout.tabs.answer.hidden).toBe(false);
    expect(layout.tabs.answer.getAttribute('aria-selected')).toBe('true');
    expect(layout.tabs.work.hidden).toBe(true);
    expect(layout.tabs.work.disabled).toBe(true);
    expect(layout.tabs.sources.hidden).toBe(false);
    expect(layout.tabs.sources.textContent).toBe('출처 4');
  });

  it('선택 가능한 보기가 하나뿐이면 불필요한 탭 막대를 숨긴다', () => {
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const layout = createAssistantResponseLayout(container, {
      ariaLabel: 'AI 응답',
      labels,
      state: {
        hasAnswer: true,
        hasWork: false,
        sourceCount: 0,
        isComplete: true,
      },
    });

    expect(layout.tabList.hidden).toBe(true);

    layout.update({
      hasAnswer: true,
      hasWork: true,
      sourceCount: 0,
      isComplete: true,
    });

    expect(layout.tabList.hidden).toBe(false);
  });

  it('수동 탭 선택을 이후 update에서도 보존한다', () => {
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const layout = createAssistantResponseLayout(container, {
      ariaLabel: 'AI 응답',
      labels,
      state: {
        hasAnswer: true,
        hasWork: true,
        sourceCount: 2,
        isComplete: false,
      },
    });

    layout.tabs.sources.click();
    layout.update({
      hasAnswer: true,
      hasWork: true,
      sourceCount: 5,
      isComplete: true,
    });

    expect(layout.getViewModel().activeTab).toBe('sources');
    expect(layout.tabs.sources.getAttribute('aria-selected')).toBe('true');
    expect(layout.tabs.sources.textContent).toBe('출처 5');
    expect(layout.panels.sources.hidden).toBe(false);
  });

  it('방향키와 Home, End로 가용 탭만 순환하며 선택 탭에 초점을 옮긴다', () => {
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const layout = createAssistantResponseLayout(container, {
      ariaLabel: 'AI 응답',
      labels,
      state: {
        hasAnswer: true,
        hasWork: false,
        sourceCount: 2,
        isComplete: true,
      },
    });

    const rightEvent = (layout.tabs.answer as unknown as TestHTMLElement).keydown('ArrowRight');
    expect(rightEvent.defaultPrevented).toBe(true);
    expect(layout.getViewModel().activeTab).toBe('sources');
    expect((layout.tabs.sources as unknown as TestHTMLElement).focusCount).toBe(1);

    (layout.tabs.sources as unknown as TestHTMLElement).keydown('ArrowLeft');
    expect(layout.getViewModel().activeTab).toBe('answer');

    (layout.tabs.answer as unknown as TestHTMLElement).keydown('End');
    expect(layout.getViewModel().activeTab).toBe('sources');

    (layout.tabs.sources as unknown as TestHTMLElement).keydown('Home');
    expect(layout.getViewModel().activeTab).toBe('answer');
  });
});
