import { describe, expect, it, vi } from 'vitest';
import { renderComposerReferencePreview } from './composer-reference-preview';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));

interface ElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

class PreviewElement {
  children: PreviewElement[] = [];
  attributes = new Map<string, string>();
  classes = new Set<string>();
  listeners = new Map<string, ((event: { key?: string }) => void)[]>();
  textContent = '';
  onmouseleave: (() => void) | null = null;
  constructor(readonly ownerDocument: { activeElement: PreviewElement | null }) {}
  createEl(_tag: string, options: ElementOptions = {}): PreviewElement {
    const child = new PreviewElement(this.ownerDocument);
    child.classes = new Set(options.cls?.split(' '));
    child.textContent = options.text ?? '';
    child.attributes = new Map(Object.entries(options.attr ?? {}));
    this.children.push(child);
    return child;
  }
  createSpan(options?: ElementOptions): PreviewElement {
    return this.createEl('span', options);
  }
  createDiv(options?: ElementOptions): PreviewElement {
    return this.createEl('div', options);
  }
  empty(): void {
    this.children = [];
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  toggleClass(name: string, enabled: boolean): void {
    if (enabled) this.classes.add(name);
    else this.classes.delete(name);
  }
  addEventListener(type: string, listener: (event: { key?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string, key?: string): void {
    if (type === 'mouseleave') this.onmouseleave?.();
    for (const listener of this.listeners.get(type) ?? []) listener({ key });
  }
}

describe('참조 미리보기 접근성', () => {
  it('스크롤 목록 밖의 미리보기를 포커스·호버로 열고 Escape로 닫는다', () => {
    const doc = { activeElement: null as PreviewElement | null };
    const container = new PreviewElement(doc);
    renderComposerReferencePreview(container as unknown as HTMLElement, [
      {
        label: '@tabs',
        cls: 'file',
        valid: true,
        detail: '사용 가능',
        paths: ['프로젝트/회의 문서.md', '연구/설계.md'],
      },
    ]);
    const [list, preview] = container.children;
    const button = list.children[0].children[0];
    expect(list.classes.has('superpower-inside-reference-list')).toBe(true);
    expect(button.attributes.get('aria-describedby')).toBe(preview.attributes.get('id'));
    expect(preview.attributes.get('role')).toBe('tooltip');
    doc.activeElement = button;
    button.dispatch('focus');
    button.dispatch('click');
    expect(button.attributes.get('aria-expanded')).toBe('true');
    expect(preview.children.map((item) => item.textContent)).toEqual([
      '사용 가능',
      '프로젝트/회의 문서.md',
      '연구/설계.md',
    ]);
    container.dispatch('mouseleave');
    expect(button.attributes.get('aria-expanded')).toBe('true');
    button.dispatch('keydown', 'Escape');
    expect(button.attributes.get('aria-expanded')).toBe('false');
    button.dispatch('mouseenter');
    expect(button.attributes.get('aria-expanded')).toBe('true');
    doc.activeElement = null;
    container.dispatch('mouseleave');
    expect(button.attributes.get('aria-expanded')).toBe('false');
  });
});
