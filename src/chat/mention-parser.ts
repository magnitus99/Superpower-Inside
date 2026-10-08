import { parseMentionCandidatesRust, planChatContextMentionsRust } from '../rag/rust-core';
import type { WorkspaceMentionFiles } from './workspace-mentions';

export interface ParsedMention {
  raw: string;
  type: 'file' | 'server' | 'folder' | 'tag';
  name: string;
}

export interface MentionResolver {
  workspaceFiles?: WorkspaceMentionFiles;
  tagFiles?(tag: string): readonly string[];
  isServer(name: string): boolean;
  isFile(name: string): boolean;
  isFolder(name: string): boolean;
}

export function parseMentions(text: string, resolver: MentionResolver): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const candidates = parseMentionCandidatesRust(text) ?? [];

  const addMention = (raw: string, name: string): void => {
    if (resolver.isServer(name)) {
      mentions.push({ raw, type: 'server', name });
    } else if (resolver.isFile(name)) {
      mentions.push({ raw, type: 'file', name });
    } else if (resolver.isFolder(name)) {
      mentions.push({ raw, type: 'folder', name });
    }
  };

  for (const candidate of candidates) {
    if (candidate.tag) {
      mentions.push({ raw: candidate.raw, type: 'tag', name: candidate.tag });
      continue;
    }
    if (candidate.workspace) {
      for (const path of resolver.workspaceFiles?.[candidate.workspace] ?? []) {
        mentions.push({ raw: candidate.raw, type: 'file', name: path });
      }
      continue;
    }
    addMention(candidate.raw, candidate.name);
  }

  return mentions;
}

export function shouldUseAutoRagForMentions(mentions: ParsedMention[]): boolean {
  return planChatContextMentionsRust(mentions.map((mention) => mention.type))?.useAutoRag ?? false;
}
