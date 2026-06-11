import { parseMentionCandidatesRust, type RustMentionCandidate } from '../rag/rust-core';

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
  const candidates = parseMentionCandidatesRust(text) ?? extractMentionCandidatesWithTypeScript(text);

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

function extractMentionCandidatesWithTypeScript(text: string): RustMentionCandidate[] {
  const candidates: RustMentionCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (raw: string, name: string): void => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ raw, name });
  };

  const bracketRegex = /@\[([^\]]+)\]/g;
  let bracketMatch: RegExpExecArray | null;
  while ((bracketMatch = bracketRegex.exec(text)) !== null) {
    addCandidate(bracketMatch[0], bracketMatch[1].trim());
  }

  const textWithoutBracketMentions = text.replace(bracketRegex, ' ');
  const wordRegex = /@([^\s\n@]+)/g;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = wordRegex.exec(textWithoutBracketMentions)) !== null) {
    addCandidate(wordMatch[0], wordMatch[1].trim());
  }

  return candidates;
}

export function shouldUseAutoRagForMentions(mentions: ParsedMention[]): boolean {
  const hasServerMention = mentions.some((mention) => mention.type === 'server');
  const hasVaultMention = mentions.some(
    (mention) => mention.type === 'file' || mention.type === 'folder',
  );
  return !hasServerMention || hasVaultMention;
}
