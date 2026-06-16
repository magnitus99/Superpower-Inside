import { t } from '../i18n';
import type {
  ContextAttachment,
  ContextBudgetSnapshot,
  DataBoundarySnapshot,
  SourceCitation,
} from './types';

export interface ContextAttachmentView {
  id: string;
  className: string;
  label: string;
  statusText: string;
  reasonText?: string;
  sizeText?: string;
  detail?: string;
  pinned: boolean;
  excluded: boolean;
  sourceIds: string[];
}

export interface ContextBudgetInput {
  maxChars: number;
  usedChars: number;
  attachments: readonly ContextAttachment[];
  citations: readonly SourceCitation[];
}

export interface DataBoundaryInput {
  providerLabel?: string;
  model?: string;
  hasSystemPrompt: boolean;
  attachments: readonly ContextAttachment[];
  citations: readonly SourceCitation[];
  mcpServerNames: readonly string[];
}

export function createContextAttachmentViews(
  attachments: readonly ContextAttachment[],
): ContextAttachmentView[] {
  return attachments.map((attachment) => {
    const excluded = Boolean(attachment.excluded) || isExcludedStatus(attachment.status);
    const actualChars = attachment.actualChars ?? attachment.estimatedChars;
    return {
      id: attachment.id,
      className: `superpower-inside-chat-context-chip ${attachment.type} ${attachment.status}${
        attachment.pinned ? ' pinned' : ''
      }${excluded ? ' excluded' : ''}`,
      label: attachment.label,
      statusText: excluded ? t('contextAttachmentExcluded') : getContextStatusText(attachment.status),
      reasonText: attachment.reason,
      sizeText:
        actualChars === undefined
          ? undefined
          : t('contextAttachmentChars', { count: actualChars.toLocaleString('ko-KR') }),
      detail: attachment.detail,
      pinned: Boolean(attachment.pinned),
      excluded,
      sourceIds: [...(attachment.sourceIds ?? [])],
    };
  });
}

export function createContextBudgetSnapshot(input: ContextBudgetInput): ContextBudgetSnapshot {
  const usedChars = Math.max(0, Math.min(input.maxChars, Math.trunc(input.usedChars)));
  const includedAttachmentIds = input.attachments
    .filter((attachment) => !attachment.excluded && !isExcludedStatus(attachment.status))
    .map((attachment) => attachment.id);
  const excludedAttachmentIds = input.attachments
    .filter((attachment) => attachment.excluded || isExcludedStatus(attachment.status))
    .map((attachment) => attachment.id);

  return {
    maxChars: input.maxChars,
    usedChars,
    remainingChars: Math.max(0, input.maxChars - usedChars),
    attachmentCount: input.attachments.length,
    citationCount: input.citations.length,
    truncated:
      usedChars >= input.maxChars || input.attachments.some((attachment) => attachment.status === 'partial'),
    includedAttachmentIds,
    excludedAttachmentIds,
  };
}

export function createDataBoundarySnapshot(input: DataBoundaryInput): DataBoundarySnapshot {
  const includedCount = input.attachments.filter(
    (attachment) => !attachment.excluded && !isExcludedStatus(attachment.status),
  ).length;
  const excludedCount = input.attachments.length - includedCount;
  const sentToProvider = [
    ...(input.hasSystemPrompt ? [t('dataBoundarySystemPrompt')] : []),
    includedCount > 0 ? t('dataBoundaryAttachedContext', { count: includedCount }) : null,
    input.citations.length > 0 ? t('dataBoundaryCitationPreview', { count: input.citations.length }) : null,
  ].filter((item): item is string => item !== null);

  return {
    providerLabel: input.providerLabel,
    model: input.model,
    localOnly: [t('dataBoundaryDraftStore'), t('dataBoundarySourceCardState')],
    sentToProvider,
    sentToMcp: [...input.mcpServerNames],
    privacyNotes:
      excludedCount > 0
        ? [t('dataBoundaryExcludedAttachmentNote', { count: excludedCount })]
        : [],
  };
}

function getContextStatusText(status: ContextAttachment['status']): string {
  switch (status) {
    case 'attached':
      return t('contextAttachmentAttached');
    case 'partial':
      return t('contextAttachmentPartial');
    case 'missing':
      return t('contextAttachmentMissing');
    case 'error':
      return t('contextAttachmentError');
    case 'low-relevance':
      return t('contextAttachmentLowRelevance');
  }
}

function isExcludedStatus(status: ContextAttachment['status']): boolean {
  return status === 'missing' || status === 'error' || status === 'low-relevance';
}
