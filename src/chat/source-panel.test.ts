import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import {
  SourcePanel,
  createCitationSectionView,
  createContextAttachmentChipViews,
  createContextBudgetView,
  createDataBoundaryView,
  createSourceWarningViews,
} from './source-panel';
import type {
  ContextAttachment,
  DataBoundarySnapshot,
  SourceCitation,
  SourceValidationWarning,
} from './types';

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

  empty(): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.textContent = '';
  }

  querySelector(selector: string): TestHTMLElement | null {
    return this.findDescendant((element) => element.matches(selector));
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

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
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

  private matches(selector: string): boolean {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.className.split(/\s+/).includes(className);
    }
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector.toUpperCase();
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

describe('SourcePanel view model contract', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  it('presents sources as checked evidence instead of retrieval internals', () => {
    const citations: SourceCitation[] = [
      {
        id: 'rag-1',
        filePath: 'Notes/A.md',
        heading: 'Overview',
        line: 3,
        score: 0.8123,
        status: 'verified',
        preview: 'Grounded note excerpt',
        selectionReason: 'keyword-vector',
        previewTruncated: true,
      },
      {
        id: 'graph-1',
        filePath: 'graph://community/product-philosophy',
        status: 'verified',
        preview: 'Related themes are connected in the knowledge graph.',
        graphType: 'community',
        selectionReason: 'strong-graph-evidence',
      },
      {
        id: 'rag-2',
        filePath: 'Notes/Old.md',
        status: 'stale',
        detail: 'The note changed after this context was prepared.',
        preview: 'Older context preview',
      },
    ];

    const view = createCitationSectionView(citations);

    expect(view.labelText).toBe('2/3 sources checked');
    expect(view.collapsedByDefault).toBe(true);
    expect(view.cards[0]).toEqual(
      expect.objectContaining({
        statusText: 'Checked',
        headingText: ' # Overview',
        metaText: 'line 3 / strong text match / preview shortened',
      }),
    );
    expect(view.cards[1]).toEqual(
      expect.objectContaining({
        graphKindText: 'Knowledge theme',
        metaText: 'strong relationship match',
      }),
    );
    expect(view.cards[2]).toEqual(
      expect.objectContaining({
        statusText: 'Changed',
        detail: 'The note changed after this context was prepared.',
      }),
    );

    const renderedText = JSON.stringify(view);
    expect(renderedText).not.toContain('GraphRAG');
    expect(renderedText).not.toContain('vector');
    expect(renderedText).not.toContain('relevance 0.812');
  });

  it('summarizes context attachments in user-facing work language', () => {
    const attachments: ContextAttachment[] = [
      {
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: 'Auto RAG 3',
        status: 'attached',
        sourceIds: ['rag-1', 'rag-2', 'rag-3'],
        detail: 'Automatically searched nearby vault notes for this question.',
      },
      {
        id: 'folder:Research',
        type: 'folder',
        name: 'Research',
        label: 'Research',
        status: 'partial',
        fileCount: 1,
        folderLimitReason: 'budget',
        detail: 'Only part of the folder was attached to fit the context budget.',
      },
      {
        id: 'graph-rag:auto',
        type: 'graph-rag',
        name: 'auto',
        label: 'GraphRAG 1 entity',
        status: 'attached',
        sourceIds: ['graph-1'],
      },
      {
        id: 'rag:skipped',
        type: 'rag',
        name: 'auto',
        label: 'Auto RAG',
        status: 'missing',
        autoRagReason: 'server-only',
        detail: 'Auto RAG is disabled for this turn.',
      },
    ];

    expect(createContextAttachmentChipViews(attachments)).toEqual([
      {
        id: 'rag:auto',
        className: 'superpower-inside-chat-context-chip rag attached',
        label: 'Checked 3 related notes',
        title: 'Found related notes automatically.',
      },
      {
        id: 'folder:Research',
        className: 'superpower-inside-chat-context-chip folder partial',
        label: 'Research: 1 note used',
        title: 'Only the part that fit was included.',
      },
      {
        id: 'graph-rag:auto',
        className: 'superpower-inside-chat-context-chip graph-rag attached',
        label: 'Checked knowledge graph',
        title: undefined,
      },
      {
        id: 'rag:skipped',
        className: 'superpower-inside-chat-context-chip rag skipped',
        label: 'Vault search skipped',
        title: 'Vault search was skipped for this question.',
      },
    ]);
  });

  it('keeps diagnostics available without turning the answer into an index dashboard', () => {
    expect(
      createContextBudgetView({
        maxChars: 4000,
        usedChars: 1200,
        attachmentCount: 4,
        citationCount: 2,
        truncated: true,
        includedAttachmentIds: ['file:a', 'rag:auto', 'graph:auto'],
        excludedAttachmentIds: ['rag:old'],
      }),
    ).toEqual({
      className: 'superpower-inside-chat-context-budget truncated',
      usageText: '3 context items prepared',
      detailText: '1 item left out',
      truncatedText: 'Some material was shortened.',
    });

    const boundary: DataBoundarySnapshot = {
      providerLabel: 'OpenAI',
      model: 'gpt-4.1',
      localOnly: ['Draft store', 'Source card UI state'],
      sentToProvider: ['System prompt', '3 context attachments', '2 source previews'],
      sentToMcp: ['search'],
      privacyNotes: ['1 excluded attachment is not sent to the provider.'],
    };

    expect(createDataBoundaryView(boundary)).toEqual({
      title: 'What this answer used',
      providerLabel: 'Sent to OpenAI / gpt-4.1',
      localLabel: 'Kept on this device',
      mcpLabel: 'Tools contacted',
      providerItems: ['Answer instructions', '3 notes and references', '2 source previews'],
      localItems: ['Draft and source-card state'],
      mcpItems: ['search'],
      privacyNotes: ['1 item was left out and was not sent.'],
    });
  });

  it('keeps source repair action explicit when an answer cites unchecked material', () => {
    const warnings: SourceValidationWarning[] = [
      {
        id: 'warn-1',
        label: 'Source rag-9',
        detail: 'This source ID is not in the checked evidence.',
        kind: 'unverified-source',
      },
    ];

    expect(createSourceWarningViews(warnings)).toEqual([
      {
        id: 'warn-1',
        className: 'superpower-inside-chat-source-warning unverified-source',
        label: 'Source rag-9',
        detail: 'This source ID is not in the checked evidence.',
        repairActionText: 'Check source',
      },
    ]);
  });
});

describe('SourcePanel disclosure DOM contract', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  it('preserves the citation disclosure state and controlled content across rerenders', () => {
    const setIcon = vi.fn((element: HTMLElement, icon: string) => {
      element.setAttribute('data-test-icon', icon);
    });
    const panel = new SourcePanel({
      setIcon,
      openCitation: vi.fn(),
      copyCitationLink: vi.fn(),
      insertCitation: vi.fn(),
    });
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const firstCitation: SourceCitation = {
      id: 'rag-1',
      filePath: 'Notes/A.md',
      status: 'verified',
      preview: 'First source',
    };

    panel.renderCitationsSection(container, [firstCitation]);

    const firstToggle = container.querySelector<HTMLButtonElement>(
      '.superpower-inside-chat-citations-label',
    );
    const firstContent = container.querySelector<HTMLElement>(
      '.superpower-inside-chat-citations-content',
    );
    const firstIcon = container.querySelector('.superpower-inside-chat-citations-toggle-icon');
    expect(firstToggle?.tagName).toBe('BUTTON');
    expect(firstToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(firstToggle?.getAttribute('aria-controls')).toBe(firstContent?.id);
    expect(firstContent?.hidden).toBe(true);
    expect(firstIcon?.getAttribute('data-test-icon')).toBe('chevron-right');

    firstToggle?.click();
    const controlsId = firstToggle?.getAttribute('aria-controls');
    panel.renderCitationsSection(container, [
      {
        ...firstCitation,
        id: 'rag-2',
        preview: 'Updated source',
      },
    ]);

    const rerenderedToggle = container.querySelector<HTMLButtonElement>(
      '.superpower-inside-chat-citations-label',
    );
    const rerenderedContent = container.querySelector<HTMLElement>(
      '.superpower-inside-chat-citations-content',
    );
    const rerenderedIcon = container.querySelector('.superpower-inside-chat-citations-toggle-icon');
    expect(rerenderedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rerenderedToggle?.getAttribute('aria-controls')).toBe(controlsId);
    expect(rerenderedContent?.id).toBe(controlsId);
    expect(rerenderedContent?.hidden).toBe(false);
    expect(rerenderedIcon?.getAttribute('data-test-icon')).toBe('chevron-down');

    rerenderedToggle?.click();
    panel.renderCitationsSection(container, [firstCitation]);

    expect(
      container
        .querySelector('.superpower-inside-chat-citations-label')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      container.querySelector<HTMLElement>('.superpower-inside-chat-citations-content')?.hidden,
    ).toBe(true);
  });

  it('renders the data boundary as an accessible state-preserving disclosure', () => {
    const setIcon = vi.fn((element: HTMLElement, icon: string) => {
      element.setAttribute('data-test-icon', icon);
    });
    const panel = new SourcePanel({
      setIcon,
      openCitation: vi.fn(),
      copyCitationLink: vi.fn(),
      insertCitation: vi.fn(),
    });
    const container = new TestHTMLElement() as unknown as HTMLElement;
    const snapshot: DataBoundarySnapshot = {
      providerLabel: 'OpenAI',
      model: 'gpt-4.1',
      localOnly: ['Draft store'],
      sentToProvider: ['System prompt'],
      sentToMcp: [],
      privacyNotes: [],
    };

    panel.renderDataBoundarySection(container, snapshot);

    const firstToggle = container.querySelector<HTMLButtonElement>(
      '.superpower-inside-chat-data-boundary-title',
    );
    const firstContent = container.querySelector<HTMLElement>(
      '.superpower-inside-chat-data-boundary-content',
    );
    const firstIcon = container.querySelector('.superpower-inside-chat-data-boundary-toggle-icon');
    expect(firstToggle?.tagName).toBe('BUTTON');
    expect(firstToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(firstToggle?.getAttribute('aria-controls')).toBe(firstContent?.id);
    expect(firstContent?.hidden).toBe(true);
    expect(firstIcon?.getAttribute('data-test-icon')).toBe('chevron-right');

    firstToggle?.click();
    const controlsId = firstToggle?.getAttribute('aria-controls');
    panel.renderDataBoundarySection(container, {
      ...snapshot,
      sentToProvider: ['System prompt', '1 source preview'],
    });

    const rerenderedToggle = container.querySelector<HTMLButtonElement>(
      '.superpower-inside-chat-data-boundary-title',
    );
    const rerenderedContent = container.querySelector<HTMLElement>(
      '.superpower-inside-chat-data-boundary-content',
    );
    const rerenderedIcon = container.querySelector(
      '.superpower-inside-chat-data-boundary-toggle-icon',
    );
    expect(rerenderedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rerenderedToggle?.getAttribute('aria-controls')).toBe(controlsId);
    expect(rerenderedContent?.id).toBe(controlsId);
    expect(rerenderedContent?.hidden).toBe(false);
    expect(rerenderedIcon?.getAttribute('data-test-icon')).toBe('chevron-down');

    rerenderedToggle?.click();
    panel.renderDataBoundarySection(container, snapshot);

    expect(
      container
        .querySelector('.superpower-inside-chat-data-boundary-title')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(
      container.querySelector<HTMLElement>('.superpower-inside-chat-data-boundary-content')?.hidden,
    ).toBe(true);
    expect(
      container
        .querySelector('.superpower-inside-chat-data-boundary-toggle-icon')
        ?.getAttribute('data-test-icon'),
    ).toBe('chevron-right');
  });
});
