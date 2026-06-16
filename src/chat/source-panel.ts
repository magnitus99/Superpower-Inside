import { t } from '../i18n';
import type { ContextAttachment, SourceCitation, SourceValidationWarning } from './types';

export interface CitationCardView {
  id: string;
  className: string;
  status: NonNullable<SourceCitation['status']>;
  filePath: string;
  headingText?: string;
  metaText?: string;
  detail?: string;
  preview: string;
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
    filePath: citation.filePath,
    headingText: citation.heading ? ` # ${citation.heading}` : undefined,
    metaText: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
    detail: citation.detail,
    preview: citation.preview,
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
      const title = card.createDiv({ cls: 'superpower-inside-chat-citation-title' });
      title.createSpan({ text: cardView.filePath });
      if (cardView.headingText) {
        title.createSpan({
          cls: 'superpower-inside-chat-citation-heading',
          text: cardView.headingText,
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
}
