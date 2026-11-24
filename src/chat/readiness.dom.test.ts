import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './view';
import type { RagIndexingProgressSummary } from '../rag/indexing-progress';

vi.mock('obsidian', () => ({
  ItemView: class {},
  Modal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  Notice: class {},
}));

class Element {
  children: Element[] = [];
  className = '';
  textContent = '';
  disabled = false;
  value = 'example:model';
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  ownerDocument: { activeElement: Element | null };
  classList = { contains: (cls: string) => this.className.split(' ').includes(cls) };
  constructor(
    public tagName = 'div',
    doc?: { activeElement: Element | null },
  ) {
    this.ownerDocument = doc ?? { activeElement: null };
  }
  createEl(tag: string, options?: { cls?: string; attr?: Record<string, string> }) {
    const child = new Element(tag, this.ownerDocument);
    child.className = options?.cls ?? '';
    for (const [key, value] of Object.entries(options?.attr ?? {})) child.setAttribute(key, value);
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string; attr?: Record<string, string> }) {
    return this.createEl('div', options);
  }
  createSpan(options?: { cls?: string; attr?: Record<string, string> }) {
    return this.createEl('span', options);
  }
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (
        selector.startsWith('.')
          ? child.classList.contains(selector.slice(1))
          : child.tagName === selector
      )
        return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  setText(text: string) {
    this.textContent = text;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  toggleClass(cls: string, on: boolean) {
    this.className = [
      ...this.className.split(' ').filter((value) => value && value !== cls),
      ...(on ? [cls] : []),
    ].join(' ');
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
}

interface ReadinessView {
  renderChatReadiness(): void;
  readinessTicker: number | null;
}

function harness(useSnapshot = true) {
  vi.useFakeTimers();
  const root = new Element();
  const send = new Element('button');
  const summary: RagIndexingProgressSummary = {
    phase: 'all',
    activity: 'indexing',
    servingAvailable: true,
    completedFiles: 1200,
    totalFiles: 4000,
    totalFilesKnown: true,
    currentFileEmbeddedChunks: null,
    currentFileTotalChunks: null,
    etaRemainingMs: null,
  };
  const state = {
    indexing: summary as RagIndexingProgressSummary | null,
    modelCount: 1,
    providerCount: 1,
  };
  const aliases = { retrieval: vi.fn(() => 'ready'), indexing: vi.fn(() => summary) };
  const getSearchStatusSnapshot = vi.fn(() => ({ readiness: 'ready', indexing: state.indexing }));
  const view = Object.assign(Object.create(ChatView.prototype), {
    readinessEl: root,
    sendBtn: send,
    readinessTicker: null,
    isStreaming: false,
    renderModelQuota: () => {},
    getEnabledProviderCount: () => state.providerCount,
    getAvailableModelCount: () => state.modelCount,
    modelSelectEl: new Element('select'),
    plugin: {
      settings: { chat: { defaultModel: 'example:model' } },
      getSearchStatusSnapshot: useSnapshot ? getSearchStatusSnapshot : undefined,
      getRetrievalReadiness: aliases.retrieval,
      getRagIndexingProgressSummary: aliases.indexing,
    },
  }) as ReadinessView;
  return { view, root, send, state, aliases, getSearchStatusSnapshot };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('composer 위 공유 안내 DOM', () => {
  it('snapshot 한 번으로 ready/building을 표시하고 숫자·terminal 갱신에서 같은 버튼·포커스·펼침을 유지한다', () => {
    const { view, root, state, send, getSearchStatusSnapshot, aliases } = harness();
    view.renderChatReadiness();
    expect(getSearchStatusSnapshot).toHaveBeenCalledTimes(1);
    expect(aliases.retrieval).not.toHaveBeenCalled();
    expect(aliases.indexing).not.toHaveBeenCalled();
    expect(send.disabled).toBe(false);
    expect(root.classList.contains('superpower-inside-hidden')).toBe(false);
    const toggle = root.querySelector('.superpower-inside-indexing-toggle')!;
    const headline = root.querySelector('.superpower-inside-indexing-headline')!;
    const originalHeadline = headline.textContent;
    expect(root.getAttribute('aria-live')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.focus();
    toggle.listeners.get('click')!();
    state.indexing = { ...state.indexing!, completedFiles: 1201 };
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.superpower-inside-indexing-toggle')).toBe(toggle);
    expect(root.ownerDocument.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(headline.textContent).toBe(originalHeadline);
    expect(root.querySelector('.superpower-inside-indexing-value-completed')?.textContent).toBe(
      '1,201 / 4,000',
    );
    state.indexing = { ...state.indexing, activity: 'failed' };
    view.renderChatReadiness();
    expect(root.querySelector('.superpower-inside-indexing-toggle')).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(send.disabled).toBe(false);
    state.indexing = null;
    view.renderChatReadiness();
    expect(root.classList.contains('superpower-inside-hidden')).toBe(true);
    expect(view.readinessTicker).toBeNull();
    expect(aliases.indexing).not.toHaveBeenCalled();
  });
  it('첫 null 뒤 scheduler 없는 복원도 실제 상단과 heartbeat에서 같은 작업량·단계 ETA를 표시한다', () => {
    const { view, root, state, aliases } = harness();
    const base = state.indexing!;
    state.indexing = null; view.renderChatReadiness();
    state.indexing = { ...base, activity: 'preparing', work: { stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 41984, totalUnits: 135835, elapsedMs: 252000, lastProgressAgeMs: 1000, remainingMs: 540000, ratePerSecond: 166, confidence: 'low', etaReason: 'warming-up' } };
    view.renderChatReadiness();
    const button = root.querySelector('button')!; button.focus();
    expect(root.querySelector('.superpower-inside-indexing-value-workCount')?.textContent).toContain('41,984 / 135,835');
    expect(root.querySelector('.superpower-inside-indexing-value-workTime')?.textContent).toContain('9m');
    state.indexing.work = { ...state.indexing.work!, processedUnits: 42112 };
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.superpower-inside-indexing-value-workCount')?.textContent).toContain('42,112 / 135,835');
    expect(root.querySelector('button')).toBe(button);
    expect(root.ownerDocument.activeElement).toBe(button);
    expect(aliases.indexing).not.toHaveBeenCalled();
  });
  it('snapshot 없는 legacy port에만 별칭을 사용한다', () => {
    const { view, aliases, root } = harness(false);
    view.renderChatReadiness();
    expect(aliases.indexing).toHaveBeenCalledTimes(1);
    expect(aliases.retrieval).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.superpower-inside-indexing-progress')).not.toBeNull();
  });
  it('provider/model 차단은 유지하고 모델 상태 갱신 때 action 노드도 재사용한다', () => {
    const { view, root, send, state } = harness();
    state.modelCount = 0;
    view.renderChatReadiness();
    const button = root.querySelector('.superpower-inside-chat-readiness-action')!;
    expect(send.disabled).toBe(true);
    expect(button.getAttribute('data-action')).toBe('configure-provider');
    view.renderChatReadiness();
    expect(root.querySelector('.superpower-inside-chat-readiness-action')).toBe(button);
    state.providerCount = 0;
    view.renderChatReadiness();
    expect(send.disabled).toBe(true);
    expect(
      root
        .querySelector('.superpower-inside-chat-readiness-model')
        ?.classList.contains('superpower-inside-hidden'),
    ).toBe(true);
  });
});
