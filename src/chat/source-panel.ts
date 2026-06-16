import { t } from '../i18n';
import type {
  ContextAttachment,
  ContextBudgetSnapshot,
  DataBoundarySnapshot,
  SourceCitation,
  SourceValidationWarning,
} from './types';

export interface CitationCardView {
  id: string;
  className: string;
  status: NonNullable<SourceCitation['status']>;
  statusText: string;
  filePath: string;
  headingText?: string;
  metaText?: string;
  detail?: string;
  preview: string;
  graphKindText?: string;
}

export interface CitationSectionView {
  labelText: string;
  cards: CitationCardView[];
}

export interface SourceWarningView {
  id: string;
  className: string;
  label: string;
  detail: string;
  repairActionText: string;
}

export interface ContextAttachmentChipView {
  id: string;
  className: string;
  label: string;
  title?: string;
}

export interface SourcePanelHandlers {
  openCitation(citation: SourceCitation): void | Promise<void>;
  copyCitationLink(citation: SourceCitation, button: HTMLButtonElement): void | Promise<void>;
  insertCitation(citation: SourceCitation): void | Promise<void>;
  repairSourceWarning?(warning: SourceValidationWarning): void | Promise<void>;
}

export function createCitationSectionView(citations: readonly SourceCitation[]): CitationSectionView {
  const verifiedCount = citations.filter((citation) => citation.status === 'verified').length;
  return {
    labelText:
      verifiedCount === citations.length
        ? t('sourceVerifiedCount', { count: verifiedCount })
        : t('sourceSearchVerifiedCount', { verified: verifiedCount, total: citations.length }),
    cards: citations.map(createCitationCardView),
  };
}

export function createCitationCardView(citation: SourceCitation): CitationCardView {
  const status = citation.status ?? 'candidate';
  const metaParts = [
    citation.line !== undefined ? `line ${citation.line}` : '',
    citation.endLine !== undefined ? `end ${citation.endLine}` : '',
    citation.score !== undefined ? `score ${citation.score.toFixed(3)}` : '',
    citation.vectorScore !== undefined ? `vector ${citation.vectorScore.toFixed(3)}` : '',
    citation.bm25Score !== undefined ? `bm25 ${citation.bm25Score.toFixed(3)}` : '',
    `status ${status}`,
  ].filter(Boolean);
  return {
    id: citation.id,
    className: `superpower-inside-chat-citation-card ${status}`,
    status,
    statusText: getCitationStatusText(status),
    filePath: citation.filePath,
    headingText: citation.heading ? ` # ${citation.heading}` : undefined,
    metaText: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
    detail: citation.detail,
    preview: citation.preview,
    graphKindText: citation.graphType ? getGraphKindText(citation.graphType) : undefined,
  };
}

export function createSourceWarningViews(
  warnings: readonly SourceValidationWarning[],
): SourceWarningView[] {
  return warnings.map((warning) => ({
    id: warning.id,
    className: `superpower-inside-chat-source-warning ${warning.kind}`,
    label: warning.label,
    detail: warning.detail,
    repairActionText: t('sourceRepairAction'),
  }));
}

export function createContextAttachmentChipViews(
  attachments: readonly ContextAttachment[],
): ContextAttachmentChipView[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    className: `superpower-inside-chat-context-chip ${attachment.type} ${attachment.status}`,
    label: attachment.label,
    title: attachment.detail,
  }));
}

export interface ContextBudgetView {
  className: string;
  usageText: string;
  detailText: string;
  truncatedText?: string;
}

export function createContextBudgetView(snapshot: ContextBudgetSnapshot): ContextBudgetView {
  return {
    className: `superpower-inside-chat-context-budget ${snapshot.truncated ? 'truncated' : 'ok'}`,
    usageText: t('contextBudgetUsage', {
      used: snapshot.usedChars.toLocaleString(),
      max: snapshot.maxChars.toLocaleString(),
    }),
    detailText: t('contextBudgetIncludedExcluded', {
      included: snapshot.includedAttachmentIds?.length ?? snapshot.attachmentCount,
      excluded: snapshot.excludedAttachmentIds?.length ?? 0,
    }),
    truncatedText: snapshot.truncated ? t('contextBudgetTruncated') : undefined,
  };
}

export interface DataBoundaryView {
  title: string;
  providerLabel: string;
  localLabel: string;
  mcpLabel: string;
  providerItems: string[];
  localItems: string[];
  mcpItems: string[];
  privacyNotes: string[];
}

export function createDataBoundaryView(snapshot: DataBoundarySnapshot): DataBoundaryView {
  const providerName = [snapshot.providerLabel, snapshot.model].filter(Boolean).join(' / ');
  return {
    title: t('dataBoundaryTitle'),
    providerLabel: providerName ? `${t('dataBoundaryProvider')}: ${providerName}` : t('dataBoundaryProvider'),
    localLabel: t('dataBoundaryLocal'),
    mcpLabel: t('dataBoundaryMcp'),
    providerItems: snapshot.sentToProvider,
    localItems: snapshot.localOnly,
    mcpItems: snapshot.sentToMcp,
    privacyNotes: snapshot.privacyNotes,
  };
}

export class SourcePanel {
  constructor(private readonly handlers: SourcePanelHandlers) {}

  renderCitationsSection(container: HTMLElement, citations: SourceCitation[]): void {
    let section = container.querySelector('.superpower-inside-chat-citations');
    if (citations.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-citations' });
    }
    section.empty();
    const view = createCitationSectionView(citations);
    section.createDiv({
      cls: 'superpower-inside-chat-citations-label',
      text: view.labelText,
    });

    for (const [index, citation] of citations.entries()) {
      const cardView = view.cards[index];
      if (!cardView) continue;
      const card = section.createDiv({ cls: cardView.className });
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-citation-id', cardView.id);
      card.setAttribute('aria-label', t('citationMarkerAria', { id: cardView.id }));
      card.addEventListener('focus', () => this.setCitationHighlight(container, cardView.id, true));
      card.addEventListener('blur', () => this.setCitationHighlight(container, cardView.id, false));
      card.addEventListener('mouseenter', () =>
        this.setCitationHighlight(container, cardView.id, true),
      );
      card.addEventListener('mouseleave', () =>
        this.setCitationHighlight(container, cardView.id, false),
      );
      const title = card.createDiv({ cls: 'superpower-inside-chat-citation-title' });
      title.createSpan({ text: cardView.filePath });
      if (cardView.headingText) {
        title.createSpan({
          cls: 'superpower-inside-chat-citation-heading',
          text: cardView.headingText,
        });
      }
      title.createSpan({
        cls: 'superpower-inside-chat-citation-status',
        text: cardView.statusText,
      });
      if (cardView.graphKindText) {
        title.createSpan({
          cls: 'superpower-inside-chat-citation-graph-kind',
          text: cardView.graphKindText,
        });
      }
      if (cardView.metaText) {
        card.createDiv({
          cls: 'superpower-inside-chat-citation-meta',
          text: cardView.metaText,
        });
      }
      if (cardView.detail) {
        card.createDiv({ cls: 'superpower-inside-chat-citation-warning', text: cardView.detail });
      }
      card.createDiv({ cls: 'superpower-inside-chat-citation-preview', text: cardView.preview });
      const actions = card.createDiv({ cls: 'superpower-inside-chat-citation-actions' });
      const openBtn = actions.createEl('button', { text: t('sourceOpenAction') });
      openBtn.addEventListener('click', () => void this.handlers.openCitation(citation));
      const copyBtn = actions.createEl('button', { text: t('sourceCopyLinkAction') });
      copyBtn.addEventListener(
        'click',
        () => void this.handlers.copyCitationLink(citation, copyBtn),
      );
      const insertBtn = actions.createEl('button', { text: t('sourceInsertIntoNoteAction') });
      insertBtn.addEventListener('click', () => void this.handlers.insertCitation(citation));
    }
  }

  renderSourceWarningsSection(
    container: HTMLElement,
    warnings: SourceValidationWarning[],
  ): void {
    let section = container.querySelector('.superpower-inside-chat-source-warnings');
    if (warnings.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-source-warnings' });
    }
    section.empty();
    section.createDiv({
      cls: 'superpower-inside-chat-source-warnings-label',
      text: t('sourceUnverifiedCount', { count: warnings.length }),
    });
    for (const warning of createSourceWarningViews(warnings)) {
      const item = section.createDiv({ cls: warning.className });
      item.createSpan({ cls: 'superpower-inside-chat-source-warning-label', text: warning.label });
      item.createSpan({
        cls: 'superpower-inside-chat-source-warning-detail',
        text: warning.detail,
      });
      if (this.handlers.repairSourceWarning) {
        const repair = item.createEl('button', {
          cls: 'superpower-inside-chat-source-repair',
          text: warning.repairActionText,
        });
        const original = warnings.find((candidate) => candidate.id === warning.id);
        if (original) {
          repair.addEventListener(
            'click',
            () => void this.handlers.repairSourceWarning?.(original),
          );
        }
      }
    }
  }

  renderContextAttachmentsSection(
    container: HTMLElement,
    attachments: ContextAttachment[],
  ): void {
    let section = container.querySelector('.superpower-inside-chat-context-attachments');
    if (attachments.length === 0) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv({ cls: 'superpower-inside-chat-context-attachments' });
    }
    section.empty();
    for (const attachment of createContextAttachmentChipViews(attachments)) {
      const chip = section.createSpan({
        cls: attachment.className,
        text: attachment.label,
      });
      if (attachment.title) {
        chip.setAttribute('title', attachment.title);
      }
    }
  }

  renderContextBudgetSection(
    container: HTMLElement,
    snapshot: ContextBudgetSnapshot | undefined,
  ): void {
    let section = container.querySelector('.superpower-inside-chat-context-budget');
    if (!snapshot) {
      section?.remove();
      return;
    }
    if (!(section instanceof HTMLElement)) {
      section = container.createDiv();
    }
    section.empty();
    const view = createContextBudgetView(snapshot);
    section.className = view.className;
    section.createSpan({ cls: 'superpower-inside-chat-context-budget-usage', text: view.usageText });
    section.createSpan({
      cls: 'superpower-inside-chat-context-budget-detail',
      text: view.detailText,
    });
    if (view.truncatedText) {
      section.createSpan({
        cls: 'superpower-inside-chat-context-budget-truncated',
        text: view.truncatedText,
      });
    }
  }

  renderDataBoundarySection(
    container: HTMLElement,
    snapshot: DataBoundarySnapshot | undefined,
  ): void {
    const section = container.querySelector('.superpower-inside-chat-data-boundary');
    if (!snapshot) {
      section?.remove();
      return;
    }
    const boundarySection =
      section instanceof HTMLElement
        ? section
        : container.createEl('details', {
            cls: 'superpower-inside-chat-data-boundary',
          });
    boundarySection.empty();
    const view = createDataBoundaryView(snapshot);
    const details = boundarySection instanceof HTMLDetailsElement ? boundarySection : null;
    if (details) details.open = false;
    boundarySection.createEl('summary', {
      cls: 'superpower-inside-chat-data-boundary-title',
      text: view.title,
    });
    this.renderDataBoundaryGroup(boundarySection, view.providerLabel, view.providerItems);
    this.renderDataBoundaryGroup(boundarySection, view.localLabel, view.localItems);
    this.renderDataBoundaryGroup(boundarySection, view.mcpLabel, view.mcpItems);
    if (view.privacyNotes.length > 0) {
      const notes = boundarySection.createDiv({
        cls: 'superpower-inside-chat-data-boundary-notes',
      });
      for (const note of view.privacyNotes) {
        notes.createDiv({ cls: 'superpower-inside-chat-data-boundary-note', text: note });
      }
    }
  }

  linkAnswerCitationMarkers(container: HTMLElement, citations: readonly SourceCitation[]): void {
    if (citations.length === 0) return;
    const bubble = container.querySelector('.superpower-inside-chat-bubble.assistant');
    if (!(bubble instanceof HTMLElement)) return;
    const ids = citations.map((citation) => citation.id).filter(Boolean);
    if (ids.length === 0) return;
    const pattern = new RegExp(`\\b(${ids.map(escapeRegExp).join('|')})\\b`, 'g');
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('a, code, pre, .superpower-inside-chat-citation-marker')) {
        continue;
      }
      pattern.lastIndex = 0;
      if (pattern.test(node.textContent ?? '')) {
        pattern.lastIndex = 0;
        textNodes.push(node as Text);
      }
    }
    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      const fragments: (Text | HTMLElement)[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const citationId = match[1] ?? '';
        const marker = document.createElement('span');
        marker.addClass('superpower-inside-chat-citation-marker');
        marker.setAttribute('tabindex', '0');
        marker.setAttribute('data-citation-id', citationId);
        marker.setAttribute('aria-label', t('citationMarkerAria', { id: citationId }));
        marker.setText(citationId);
        marker.addEventListener('focus', () => this.setCitationHighlight(container, citationId, true));
        marker.addEventListener('blur', () => this.setCitationHighlight(container, citationId, false));
        marker.addEventListener('mouseenter', () =>
          this.setCitationHighlight(container, citationId, true),
        );
        marker.addEventListener('mouseleave', () =>
          this.setCitationHighlight(container, citationId, false),
        );
        fragments.push(marker);
        lastIndex = pattern.lastIndex;
      }
      if (lastIndex < text.length) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
      }
      const parent = textNode.parentNode;
      if (!parent) continue;
      for (const fragment of fragments) {
        parent.insertBefore(fragment, textNode);
      }
      parent.removeChild(textNode);
    }
  }

  private renderDataBoundaryGroup(container: HTMLElement, label: string, items: string[]): void {
    const group = container.createDiv({ cls: 'superpower-inside-chat-data-boundary-group' });
    group.createDiv({ cls: 'superpower-inside-chat-data-boundary-label', text: label });
    const list = group.createEl('ul', { cls: 'superpower-inside-chat-data-boundary-list' });
    if (items.length === 0) {
      list.createEl('li', { text: '-' });
      return;
    }
    for (const item of items) {
      list.createEl('li', { text: item });
    }
  }

  private setCitationHighlight(container: HTMLElement, citationId: string, active: boolean): void {
    const selector = `[data-citation-id="${cssEscape(citationId)}"]`;
    for (const target of Array.from(container.querySelectorAll(selector))) {
      if (target instanceof HTMLElement) {
        target.toggleClass('linked', active);
      }
    }
  }
}

function getCitationStatusText(status: NonNullable<SourceCitation['status']>): string {
  switch (status) {
    case 'verified':
      return t('sourceStatusVerified');
    case 'candidate':
      return t('sourceStatusCandidate');
    case 'missing':
      return t('sourceStatusMissing');
    case 'stale':
      return t('sourceStatusStale');
    case 'low-relevance':
      return t('sourceStatusLowRelevance');
  }
}

function getGraphKindText(graphType: NonNullable<SourceCitation['graphType']>): string {
  switch (graphType) {
    case 'entity':
      return t('sourceGraphEntity');
    case 'relation':
      return t('sourceGraphRelation');
    case 'community':
      return t('sourceGraphCommunity');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return escapeRegExp(value).replace(/"/g, '\\"');
}
