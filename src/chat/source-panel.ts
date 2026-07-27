import { t } from '../i18n';
import { isDomInstance } from '../utils/dom';
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
  collapsedByDefault: boolean;
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
  setIcon(element: HTMLElement, icon: string): void;
  openCitation(citation: SourceCitation): void | Promise<void>;
  copyCitationLink(citation: SourceCitation, button: HTMLButtonElement): void | Promise<void>;
  insertCitation(citation: SourceCitation): void | Promise<void>;
  repairSourceWarning?(warning: SourceValidationWarning): void | Promise<void>;
}

interface DisclosureSnapshot {
  expanded: boolean;
  contentId?: string;
}

export function createCitationSectionView(
  citations: readonly SourceCitation[],
): CitationSectionView {
  const verifiedCount = citations.filter((citation) => citation.status === 'verified').length;
  return {
    labelText:
      verifiedCount === citations.length
        ? t('sourceVerifiedCount', { count: verifiedCount })
        : t('sourceSearchVerifiedCount', { verified: verifiedCount, total: citations.length }),
    collapsedByDefault: true,
    cards: citations.map(createCitationCardView),
  };
}

export function createCitationCardView(citation: SourceCitation): CitationCardView {
  const status = citation.status ?? 'candidate';
  const metaParts = [
    citation.line !== undefined ? t('sourceLineMeta', { line: citation.line }) : '',
    citation.endLine !== undefined ? t('sourceEndLineMeta', { line: citation.endLine }) : '',
    citation.selectionReason ? getCitationSelectionReasonText(citation.selectionReason) : '',
    citation.previewTruncated ? t('sourcePreviewTruncated') : '',
  ].filter(Boolean);
  return {
    id: citation.id,
    className: `superpower-inside-chat-citation-card ${status}`,
    status,
    statusText: getCitationStatusText(status),
    filePath: citation.filePath,
    headingText: citation.heading ? ` # ${citation.heading}` : undefined,
    metaText: metaParts.length > 0 ? metaParts.join(' / ') : undefined,
    detail: normalizeSourceDetail(citation.detail),
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
    className: createContextAttachmentClassName(attachment),
    label: createContextAttachmentLabel(attachment),
    title: normalizeContextAttachmentDetail(attachment),
  }));
}

export interface ContextBudgetView {
  className: string;
  usageText: string;
  detailText: string;
  truncatedText?: string;
}

export function createContextBudgetView(snapshot: ContextBudgetSnapshot): ContextBudgetView {
  const includedCount = snapshot.includedAttachmentIds?.length ?? snapshot.attachmentCount;
  const excludedCount = snapshot.excludedAttachmentIds?.length ?? 0;
  return {
    className: `superpower-inside-chat-context-budget ${snapshot.truncated ? 'truncated' : 'ok'}`,
    usageText: t('contextBudgetItemsPrepared', {
      count: includedCount,
      itemLabel: formatItemLabel(includedCount),
    }),
    detailText: t('contextBudgetItemsLeftOut', {
      count: excludedCount,
      itemLabel: formatItemLabel(excludedCount),
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
    providerLabel: providerName
      ? `${t('dataBoundaryProvider')} ${providerName}`
      : t('dataBoundaryProvider'),
    localLabel: t('dataBoundaryLocal'),
    mcpLabel: t('dataBoundaryMcp'),
    providerItems: snapshot.sentToProvider.map(normalizeProviderBoundaryItem),
    localItems: normalizeLocalBoundaryItems(snapshot.localOnly),
    mcpItems: snapshot.sentToMcp,
    privacyNotes: snapshot.privacyNotes.map(normalizePrivacyBoundaryNote),
  };
}

function createContextAttachmentLabel(attachment: ContextAttachment): string {
  const name = attachment.name || attachment.label;
  const sourceCount = attachment.sourceIds?.length ?? attachment.fileCount ?? 0;

  switch (attachment.type) {
    case 'rag':
      if (isVaultSearchSkipped(attachment)) return t('contextChipVaultSearchSkipped');
      if (attachment.status === 'attached' || attachment.status === 'partial') {
        return sourceCount > 0
          ? t('contextChipRelatedNotes', {
              count: sourceCount,
              noteLabel: formatNoteLabel(sourceCount),
            })
          : t('contextChipNoRelatedNotes');
      }
      return t('contextChipNoRelatedNotes');
    case 'graph-rag':
      return attachment.status === 'attached' || attachment.status === 'partial'
        ? t('contextChipKnowledgeGraph')
        : t('contextChipKnowledgeGraphMissing');
    case 'folder': {
      const fileCount = attachment.fileCount ?? attachment.sourceIds?.length ?? 0;
      return fileCount > 0
        ? t('contextChipFolderNotesUsed', {
            name,
            count: fileCount,
            noteLabel: formatNoteLabel(fileCount),
          })
        : name;
    }
    case 'reference':
      return t('contextChipReferenceAttached', { name });
    case 'file':
      return t('contextChipFileAttached', { name });
    case 'mcp-server':
      return attachment.status === 'attached' || attachment.status === 'partial'
        ? t('contextChipToolReady', { name })
        : t('contextChipToolUnavailable', { name });
  }
}

function createContextAttachmentClassName(attachment: ContextAttachment): string {
  const displayStatus = isVaultSearchSkipped(attachment) ? 'skipped' : attachment.status;
  return `superpower-inside-chat-context-chip ${attachment.type} ${displayStatus}`;
}

function normalizeContextAttachmentDetail(attachment: ContextAttachment): string | undefined {
  if (!attachment.detail) return undefined;
  if (attachment.type === 'rag') {
    if (isVaultSearchSkipped(attachment)) return t('contextChipDetailSkipped');
    if (attachment.status === 'attached' || attachment.status === 'partial') {
      return t('contextChipDetailAuto');
    }
  }
  if (
    attachment.status === 'partial' ||
    attachment.folderLimitReason === 'budget' ||
    attachment.detail.toLowerCase().includes('context budget')
  ) {
    return t('contextChipDetailShortened');
  }
  return normalizeSourceDetail(attachment.detail);
}

function isVaultSearchSkipped(attachment: ContextAttachment): boolean {
  return (
    attachment.autoRagReason === 'disabled' ||
    attachment.autoRagReason === 'server-only' ||
    attachment.detail?.toLowerCase().includes('auto rag is disabled') === true
  );
}

function normalizeSourceDetail(detail: string | undefined): string | undefined {
  return detail;
}

function formatNoteLabel(count: number): string {
  return count === 1 ? t('contextNoteSingular') : t('contextNotePlural');
}

function formatItemLabel(count: number): string {
  return count === 1 ? t('contextItemSingular') : t('contextItemPlural');
}

function normalizeProviderBoundaryItem(item: string): string {
  if (item === 'System prompt' || item === t('dataBoundarySystemPrompt')) {
    return t('dataBoundarySystemPrompt');
  }
  const contextMatch = item.match(/^(\d+)\s+(?:context attachments?|notes and references)\b/i);
  if (contextMatch?.[1]) {
    return t('dataBoundaryAttachedContext', { count: Number(contextMatch[1]) });
  }
  const previewMatch = item.match(/^(\d+)\s+source previews?\b/i);
  if (previewMatch?.[1]) {
    return t('dataBoundaryCitationPreview', { count: Number(previewMatch[1]) });
  }
  return item;
}

function normalizeLocalBoundaryItems(items: readonly string[]): string[] {
  const hasDraftStore = items.some(
    (item) => item === 'Draft store' || item === t('dataBoundaryDraftStore'),
  );
  const hasSourceCardState = items.some(
    (item) => item === 'Source card UI state' || item === t('dataBoundarySourceCardState'),
  );
  if (hasDraftStore && hasSourceCardState) {
    return [t('dataBoundaryDraftStore')];
  }

  return Array.from(new Set(items.map(normalizeLocalBoundaryItem)));
}

function normalizeLocalBoundaryItem(item: string): string {
  if (item === 'Draft store') return t('dataBoundaryDraftStore');
  if (item === 'Source card UI state') return t('dataBoundarySourceCardState');
  return item;
}

function normalizePrivacyBoundaryNote(note: string): string {
  const excludedMatch = note.match(/^(\d+)\s+(?:excluded attachments?|items?)\b/i);
  if (excludedMatch?.[1]) {
    return formatExcludedBoundaryNote(Number(excludedMatch[1]));
  }
  return note;
}

function formatExcludedBoundaryNote(count: number): string {
  return count === 1
    ? t('dataBoundaryExcludedAttachmentNoteSingular', { count })
    : t('dataBoundaryExcludedAttachmentNotePlural', { count });
}

export class SourcePanel {
  private sectionSequence = 0;

  constructor(private readonly handlers: SourcePanelHandlers) {}

  renderCitationsSection(container: HTMLElement, citations: SourceCitation[]): void {
    const existingSection = container.querySelector('.superpower-inside-chat-citations');
    if (citations.length === 0) {
      existingSection?.remove();
      return;
    }
    const view = createCitationSectionView(citations);
    const disclosure = readDisclosureSnapshot(
      existingSection,
      '.superpower-inside-chat-citations-label',
      !view.collapsedByDefault,
    );
    const section = isDomInstance(existingSection, HTMLElement)
      ? existingSection
      : container.createDiv({ cls: 'superpower-inside-chat-citations' });
    section.empty();
    const content = this.renderDisclosure(section, {
      buttonClassName: 'superpower-inside-chat-citations-label',
      iconClassName: 'superpower-inside-chat-citations-toggle-icon',
      contentClassName: 'superpower-inside-chat-citations-content',
      contentId:
        disclosure.contentId ?? `superpower-inside-chat-citations-${++this.sectionSequence}`,
      label: view.labelText,
      expanded: disclosure.expanded,
    });

    for (const [index, citation] of citations.entries()) {
      const cardView = view.cards[index];
      if (!cardView) continue;
      const card = content.createDiv({ cls: cardView.className });
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

  renderSourceWarningsSection(container: HTMLElement, warnings: SourceValidationWarning[]): void {
    let section = container.querySelector('.superpower-inside-chat-source-warnings');
    if (warnings.length === 0) {
      section?.remove();
      return;
    }
    if (!isDomInstance(section, HTMLElement)) {
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

  renderContextAttachmentsSection(container: HTMLElement, attachments: ContextAttachment[]): void {
    let section = container.querySelector('.superpower-inside-chat-context-attachments');
    if (attachments.length === 0) {
      section?.remove();
      return;
    }
    if (!isDomInstance(section, HTMLElement)) {
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
    if (!isDomInstance(section, HTMLElement)) {
      section = container.createDiv();
    }
    section.empty();
    const view = createContextBudgetView(snapshot);
    section.className = view.className;
    section.createSpan({
      cls: 'superpower-inside-chat-context-budget-usage',
      text: view.usageText,
    });
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
    const existingSection = container.querySelector('.superpower-inside-chat-data-boundary');
    if (!snapshot) {
      existingSection?.remove();
      return;
    }
    const disclosure = readDisclosureSnapshot(
      existingSection,
      '.superpower-inside-chat-data-boundary-title',
      false,
    );
    let section: HTMLElement;
    if (!isDomInstance(existingSection, HTMLElement)) {
      section = container.createDiv({
        cls: 'superpower-inside-chat-data-boundary',
      });
    } else if (isDomInstance(existingSection, HTMLDetailsElement)) {
      const replacement = container.createDiv({
        cls: 'superpower-inside-chat-data-boundary',
      });
      existingSection.replaceWith(replacement);
      section = replacement;
    } else {
      section = existingSection;
    }
    section.empty();
    const view = createDataBoundaryView(snapshot);
    const content = this.renderDisclosure(section, {
      buttonClassName: 'superpower-inside-chat-data-boundary-title',
      iconClassName: 'superpower-inside-chat-data-boundary-toggle-icon',
      contentClassName: 'superpower-inside-chat-data-boundary-content',
      contentId:
        disclosure.contentId ?? `superpower-inside-chat-data-boundary-${++this.sectionSequence}`,
      label: view.title,
      expanded: disclosure.expanded,
    });
    this.renderDataBoundaryGroup(content, view.providerLabel, view.providerItems);
    this.renderDataBoundaryGroup(content, view.localLabel, view.localItems);
    this.renderDataBoundaryGroup(content, view.mcpLabel, view.mcpItems);
    if (view.privacyNotes.length > 0) {
      const notes = content.createDiv({
        cls: 'superpower-inside-chat-data-boundary-notes',
      });
      for (const note of view.privacyNotes) {
        notes.createDiv({ cls: 'superpower-inside-chat-data-boundary-note', text: note });
      }
    }
  }

  private renderDisclosure(
    container: HTMLElement,
    options: {
      buttonClassName: string;
      iconClassName: string;
      contentClassName: string;
      contentId: string;
      label: string;
      expanded: boolean;
    },
  ): HTMLElement {
    const toggle = container.createEl('button', {
      cls: options.buttonClassName,
      attr: {
        type: 'button',
        'aria-controls': options.contentId,
      },
    });
    const toggleIcon = toggle.createSpan({ cls: options.iconClassName });
    toggle.createSpan({ text: options.label });
    const content = container.createDiv({ cls: options.contentClassName });
    content.id = options.contentId;
    const setExpanded = (expanded: boolean): void => {
      toggle.setAttribute('aria-expanded', String(expanded));
      content.hidden = !expanded;
      this.handlers.setIcon(toggleIcon, expanded ? 'chevron-down' : 'chevron-right');
    };
    setExpanded(options.expanded);
    toggle.addEventListener('click', () => {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });
    return content;
  }

  linkAnswerCitationMarkers(container: HTMLElement, citations: readonly SourceCitation[]): void {
    if (citations.length === 0) return;
    const bubble = container.querySelector('.superpower-inside-chat-bubble.assistant');
    if (!isDomInstance(bubble, HTMLElement)) return;
    const ids = citations.map((citation) => citation.id).filter(Boolean);
    if (ids.length === 0) return;
    const pattern = new RegExp(`\\b(${ids.map(escapeRegExp).join('|')})\\b`, 'g');
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
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
          fragments.push(doc.createTextNode(text.slice(lastIndex, match.index)));
        }
        const citationId = match[1] ?? '';
        const marker = doc.createElement('span');
        marker.addClass('superpower-inside-chat-citation-marker');
        marker.setAttribute('tabindex', '0');
        marker.setAttribute('data-citation-id', citationId);
        marker.setAttribute('aria-label', t('citationMarkerAria', { id: citationId }));
        marker.setText(citationId);
        marker.addEventListener('focus', () =>
          this.setCitationHighlight(container, citationId, true),
        );
        marker.addEventListener('blur', () =>
          this.setCitationHighlight(container, citationId, false),
        );
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
        fragments.push(doc.createTextNode(text.slice(lastIndex)));
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
      if (isDomInstance(target, HTMLElement)) {
        target.toggleClass('linked', active);
      }
    }
  }
}

function readDisclosureSnapshot(
  section: Element | null,
  toggleSelector: string,
  defaultExpanded: boolean,
): DisclosureSnapshot {
  const toggle = section?.querySelector(toggleSelector);
  const controlledContentId = toggle?.getAttribute('aria-controls')?.trim();
  const expandedAttribute = toggle?.getAttribute('aria-expanded');
  let expanded = defaultExpanded;
  if (expandedAttribute === 'true') {
    expanded = true;
  } else if (expandedAttribute === 'false') {
    expanded = false;
  } else if (isDomInstance(section, HTMLDetailsElement)) {
    expanded = section.open;
  }
  return {
    expanded,
    contentId: controlledContentId || undefined,
  };
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

function getCitationSelectionReasonText(
  reason: NonNullable<SourceCitation['selectionReason']>,
): string {
  switch (reason) {
    case 'strong-graph-evidence':
      return t('sourceReasonStrongGraph');
    case 'graph-structural-evidence':
      return t('sourceReasonGraphStructural');
    case 'keyword-vector':
      return t('sourceReasonKeywordVector');
    case 'keyword':
      return t('sourceReasonKeyword');
    case 'vector':
      return t('sourceReasonVector');
    case 'hybrid':
      return t('sourceReasonHybrid');
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
