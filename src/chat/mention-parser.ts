import { parseMentionCandidatesRust, planChatContextMentionsRust } from '../rag/rust-core';

export interface ParsedMention {
  raw: string;
  type: 'file' | 'server' | 'folder' | 'entity';
  name: string;
}

export interface MentionResolver {
  isServer(name: string): boolean;
  isFile(name: string): boolean;
  isFolder(name: string): boolean;
  isEntity(name: string): boolean;
}

export function parseMentions(text: string, resolver: MentionResolver): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const candidates = parseMentionCandidatesRust(text) ?? [];

  const addMention = (raw: string, name: string): void => {
    if (name.startsWith('entity:')) {
      const entityName = name.slice(7).trim();
      if (entityName && resolver.isEntity(entityName)) {
        mentions.push({ raw, type: 'entity', name: entityName });
        return;
      }
      return;
    }

    if (resolver.isServer(name)) {
      mentions.push({ raw, type: 'server', name });
    } else if (resolver.isFile(name)) {
      mentions.push({ raw, type: 'file', name });
    } else if (resolver.isFolder(name)) {
      mentions.push({ raw, type: 'folder', name });
    }
  };

  for (const candidate of candidates) {
    addMention(candidate.raw, candidate.name);
  }

  return mentions;
}

export function shouldUseAutoRagForMentions(mentions: ParsedMention[]): boolean {
  return planChatContextMentionsRust(mentions.map((mention) => mention.type))?.useAutoRag ?? false;
}
