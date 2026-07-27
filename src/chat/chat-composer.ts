import { t } from '../i18n';

export interface ComposerLoadingState {
  isStreaming: boolean;
  sendButton: {
    disabled: boolean;
    text: string;
  };
  inputDisabled: boolean;
  toolsDisabled: boolean;
  modelSelectDisabled: boolean;
  runControl: {
    hidden: boolean;
    statusText: string;
    stopText: string;
  };
}

export type ComposerKeyAction =
  | 'send'
  | 'force-send'
  | 'newline'
  | 'cancel'
  | 'close-dropdown'
  | 'select-next'
  | 'select-previous'
  | 'confirm-mention'
  | 'none';

export interface ComposerKeyInput {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  mentionOpen?: boolean;
  isStreaming?: boolean;
}

export interface ComposerDraftSnapshot {
  text: string;
  attachmentIds: string[];
  updatedAt: string;
  hasContext: boolean;
}

export interface ContextPreviewMention {
  type: 'file' | 'server' | 'folder' | 'entity';
  name: string;
}

export interface ContextPreviewChip {
  label: string;
  cls: string;
}

export function createComposerLoadingState(loading: boolean): ComposerLoadingState {
  return {
    isStreaming: loading,
    sendButton: {
      disabled: false,
      text: loading ? t('stopButton') : t('sendButton'),
    },
    inputDisabled: loading,
    toolsDisabled: loading,
    modelSelectDisabled: loading,
    runControl: {
      hidden: !loading,
      statusText: t('chatRunActive'),
      stopText: t('stopAllButton'),
    },
  };
}

export function createContextPreviewChips(
  mentions: readonly ContextPreviewMention[],
): ContextPreviewChip[] {
  return [
    { label: t('chatAutoRagChip'), cls: 'rag' },
    ...mentions.map((mention) => ({
      label: createMentionChipLabel(mention),
      cls: mention.type,
    })),
  ];
}

export function resolveComposerKeyAction(input: ComposerKeyInput): ComposerKeyAction {
  if (input.mentionOpen) {
    if (input.key === 'ArrowDown') return 'select-next';
    if (input.key === 'ArrowUp') return 'select-previous';
    if (input.key === 'Enter' || input.key === 'Tab') return 'confirm-mention';
    if (input.key === 'Escape') return 'close-dropdown';
  }

  if (input.key === 'Escape' && input.isStreaming) return 'cancel';
  if (input.key !== 'Enter') return 'none';
  if (input.shiftKey) return 'newline';
  if (input.metaKey || input.ctrlKey) return 'force-send';
  return 'send';
}

function createMentionChipLabel(mention: ContextPreviewMention): string {
  if (mention.type === 'server') return t('chatToolMentionChip', { name: mention.name });
  if (mention.type === 'folder') return t('chatFolderMentionChip', { name: mention.name });
  if (mention.type === 'entity') return t('contextChipKnowledgeGraph');
  return t('chatFileMentionChip', { name: mention.name });
}

export function createComposerDraftSnapshot(input: {
  text: string;
  attachmentIds?: readonly string[];
  now?: string;
}): ComposerDraftSnapshot {
  const attachmentIds = [...(input.attachmentIds ?? [])];
  return {
    text: input.text,
    attachmentIds,
    updatedAt: input.now ?? new Date().toISOString(),
    hasContext: attachmentIds.length > 0,
  };
}
