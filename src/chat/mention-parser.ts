export interface ParsedMention {
  raw: string;
  type: 'file' | 'server' | 'folder';
  name: string;
}

export interface MentionResolver {
  isServer(name: string): boolean;
  isFile(name: string): boolean;
  isFolder(name: string): boolean;
}

export function parseMentions(text: string, resolver: MentionResolver): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const seen = new Set<string>();

  const addMention = (raw: string, name: string): void => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    if (resolver.isServer(name)) {
      mentions.push({ raw, type: 'server', name });
    } else if (resolver.isFile(name)) {
      mentions.push({ raw, type: 'file', name });
    } else if (resolver.isFolder(name)) {
      mentions.push({ raw, type: 'folder', name });
    }
  };

  const bracketRegex = /@\[([^\]]+)\]/g;
  let bracketMatch: RegExpExecArray | null;
  while ((bracketMatch = bracketRegex.exec(text)) !== null) {
    addMention(bracketMatch[0], bracketMatch[1].trim());
  }

  const textWithoutBracketMentions = text.replace(bracketRegex, ' ');
  const wordRegex = /@([^\s\n@]+)/g;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = wordRegex.exec(textWithoutBracketMentions)) !== null) {
    addMention(wordMatch[0], wordMatch[1].trim());
  }

  return mentions;
}
