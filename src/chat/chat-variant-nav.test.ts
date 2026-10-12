import { describe, expect, it, vi } from 'vitest';
import { renderChatVariantNav } from './chat-variant-nav';

interface TestElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

class TestHTMLElement {
  readonly children: TestHTMLElement[] = [];
  readonly tagName: string;
  className = '';
  textContent = '';
  disabled = false;
  parentElement: TestHTMLElement | null = null;
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();

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

  appendElement<T extends TestHTMLElement>(element: T, options?: TestElementOptions): T {
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) {
      element.attributes.set(key, value);
    }
    element.parentElement = this;
    this.children.push(element);
    return element;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  findChild(className: string): TestHTMLElement | undefined {
    return this.children.find((child) => child.className === className);
  }
}

function renderNav(input: { total: number; activeIndex: number }) {
  const container = new TestHTMLElement('div');
  const onSwitch = vi.fn();
  const setIcon = vi.fn();
  renderChatVariantNav(container as unknown as HTMLElement, {
    total: input.total,
    activeIndex: input.activeIndex,
    labels: { prev: '이전 답변', next: '다음 답변', position: '1 / 3' },
    setIcon,
    onSwitch,
  });
  return { container, onSwitch, setIcon };
}

describe('채팅 변형 내비게이션', () => {
  it('변형이 2개 미만이면 내비게이션을 만들지 않는다', () => {
    const { container, setIcon } = renderNav({ total: 1, activeIndex: 0 });

    expect(container.children).toHaveLength(0);
    expect(setIcon).not.toHaveBeenCalled();
  });

  it('위치 표시와 접근 가능한 이름, 끝단 비활성 상태를 만든다', () => {
    const { container, setIcon } = renderNav({ total: 3, activeIndex: 0 });
    const nav = container.findChild('superpower-inside-chat-variant-nav');
    const [prev, position, next] = nav?.children ?? [];

    expect(prev?.getAttribute('aria-label')).toBe('이전 답변');
    expect(prev?.disabled).toBe(true);
    expect(position?.className).toBe('superpower-inside-chat-variant-nav-position');
    expect(position?.textContent).toBe('1 / 3');
    expect(next?.getAttribute('aria-label')).toBe('다음 답변');
    expect(next?.disabled).toBe(false);
    expect(setIcon).toHaveBeenCalledTimes(2);
  });

  it('가운데 위치에서는 이전/다음 클릭이 대상 인덱스를 전달한다', () => {
    const { container, onSwitch } = renderNav({ total: 3, activeIndex: 1 });
    const [prev, , next] =
      container.findChild('superpower-inside-chat-variant-nav')?.children ?? [];

    expect(prev?.disabled).toBe(false);
    expect(next?.disabled).toBe(false);
    next?.click();
    prev?.click();
    expect(onSwitch.mock.calls).toEqual([[2], [0]]);
  });

  it('마지막 위치에서는 다음 버튼이 비활성이다', () => {
    const { container } = renderNav({ total: 3, activeIndex: 2 });
    const [, , next] = container.findChild('superpower-inside-chat-variant-nav')?.children ?? [];

    expect(next?.disabled).toBe(true);
  });
});
