import { t } from '../i18n';
import { parseMentionCandidatesRust } from '../rag/rust-core';
import type { MentionResolver } from './mention-parser';

export interface ComposerLoadingState {
  isStreaming: boolean;
  sendButton: {
    disabled: boolean;
    text: string;
  };
  inputDisabled: boolean;
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
  type: 'file' | 'server' | 'folder' | 'tag';
  name: string;
}

export interface ContextPreviewChip {
  label: string;
  cls: string;
  detail?: string;
  paths?: readonly string[];
  valid?: boolean;
}

/** 파싱은 Rust에 맡기고 호스트의 파일·폴더 상태를 입력 미리보기에 연결한다. */
export function createLiveContextPreviewChips(
  text: string,
  resolver: MentionResolver,
): ContextPreviewChip[] {
  const candidates = parseMentionCandidatesRust(text);
  const chips = candidates?.some((candidate) => candidate.tag) ? [] : createContextPreviewChips([]);
  if (!candidates) return [...chips, { label: t('chatReferenceUnavailable'), cls: 'missing' }];
  for (const candidate of candidates) {
    if (candidate.tag) {
      const paths = resolver.tagFiles?.(candidate.tag) ?? [];
      chips.push({
        label: candidate.raw,
        cls: 'tag',
        paths,
        valid: paths.length > 0,
        detail: t(paths.length ? 'chatTagMentionCount' : 'chatTagMentionEmpty', {
          count: paths.length,
        }),
      });
      continue;
    }
    if (candidate.workspace) {
      const paths = resolver.workspaceFiles?.[candidate.workspace] ?? [];
      const valid = paths.length > 0 && paths.every((path) => resolver.isFile(path));
      chips.push({
        label:
          candidate.workspace === 'current'
            ? t('chatCurrentMention')
            : t('chatTabsMention', { count: paths.length }),
        cls: 'workspace',
        paths,
        valid,
        detail:
          paths.length > 0
            ? t(valid ? 'chatReferenceAvailable' : 'chatReferenceMissing')
            : t(
                candidate.workspace === 'current'
                  ? 'chatCurrentMentionEmpty'
                  : 'chatTabsMentionEmpty',
              ),
      });
      continue;
    }
    if (candidate.link) {
      const resolved = resolver.resolveLink?.(candidate.name) ?? null;
      chips.push({
        label: candidate.raw,
        cls: resolved ? resolved.type : 'missing',
        valid: resolved !== null,
        paths: resolved ? [resolved.path] : [],
        detail: t(resolved ? 'chatReferenceAvailable' : 'chatReferenceMissing'),
      });
      continue;
    }
    const type = resolver.isServer(candidate.name)
      ? 'server'
      : resolver.isFile(candidate.name)
        ? 'file'
        : resolver.isFolder(candidate.name)
          ? 'folder'
          : 'missing';
    chips.push({
      label: candidate.raw,
      cls: type,
      valid: type !== 'missing',
      paths: [candidate.name],
      detail: t(type === 'missing' ? 'chatReferenceMissing' : 'chatReferenceAvailable'),
    });
  }
  return chips;
}

export interface ComposerMentionTrigger {
  mode: 'at' | 'wiki';
  query: string;
  startIndex: number;
}

/**
 * 커서 앞 텍스트에서 mention 트리거를 찾습니다.
 *
 * `[[...]]`는 Obsidian 링크 표기이므로 `]]` 전까지 공백을 포함한 경로를 그대로 찾습니다.
 */
export function resolveComposerMentionTrigger(
  textBeforeCursor: string,
): ComposerMentionTrigger | null {
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  const lastWikiStart = textBeforeCursor.lastIndexOf('[[');
  if (lastWikiStart > lastAtIndex) {
    const wikiQuery = textBeforeCursor.slice(lastWikiStart + 2);
    if (wikiQuery.includes(']]') || wikiQuery.includes('\n')) return null;
    return { mode: 'wiki', query: wikiQuery.toLowerCase(), startIndex: lastWikiStart };
  }
  if (lastAtIndex === -1) return null;
  const atQuery = textBeforeCursor.slice(lastAtIndex + 1);
  if (atQuery.includes(' ') || atQuery.includes('\n')) return null;
  return { mode: 'at', query: atQuery.toLowerCase(), startIndex: lastAtIndex };
}

export function createComposerLoadingState(loading: boolean): ComposerLoadingState {
  return {
    isStreaming: loading,
    sendButton: {
      disabled: false,
      text: loading ? t('stopButton') : t('sendButton'),
    },
    inputDisabled: loading,
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
  if (mention.type === 'tag') return `@${mention.name}`;
  if (mention.type === 'server') return t('chatToolMentionChip', { name: mention.name });
  if (mention.type === 'folder') return t('chatFolderMentionChip', { name: mention.name });
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
