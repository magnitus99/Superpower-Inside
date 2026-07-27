import {
  extractStructuredReasoningRust,
  normalizeReasoningChunkRust,
  splitReasoningTagsRust,
} from '../rag/rust-core';

export interface ReasoningExtractor {
  name: string;
  extract(delta: Record<string, unknown>): string | undefined;
}

export interface NormalizedReasoningChunk {
  content: string;
  reasoning?: string;
}

export function extractStructuredReasoning(delta: Record<string, unknown>): string | undefined {
  const rustReasoning = extractStructuredReasoningRust(delta);
  if (rustReasoning !== null) {
    return rustReasoning;
  }
  for (const key of ['reasoning', 'reasoning_content', 'thinking']) {
    const value = delta[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function splitReasoningTags(content: string): NormalizedReasoningChunk {
  const rustChunk = splitReasoningTagsRust(content);
  if (rustChunk !== null) {
    return rustChunk;
  }
  const trimmed = content.trim();
  if (!trimmed) return { content: '' };

  const REASONING_TAGS = ['think', 'thinking', 'reasoning', 'thought'];
  const REASONING_TAG_PATTERN = REASONING_TAGS.join('|');

  const pairedTag = new RegExp(
    `<(${REASONING_TAG_PATTERN})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
    'gi',
  );
  const reasoningParts: string[] = [];
  const contentParts: string[] = [];
  let lastIndex = 0;
  let pairedMatch: RegExpExecArray | null;
  while ((pairedMatch = pairedTag.exec(trimmed)) !== null) {
    const before = trimmed.slice(lastIndex, pairedMatch.index).trim();
    if (before) contentParts.push(before);
    const reasoning = pairedMatch[2].trim();
    if (reasoning) reasoningParts.push(reasoning);
    lastIndex = pairedMatch.index + pairedMatch[0].length;
  }
  if (reasoningParts.length > 0) {
    const after = trimmed.slice(lastIndex).trim();
    if (after) contentParts.push(after);
    return {
      reasoning: reasoningParts.join('\n\n'),
      content: contentParts.join('\n\n'),
    };
  }

  const closingOnly = new RegExp(`([\\s\\S]*?)<\\/(${REASONING_TAG_PATTERN})>`, 'i');
  const closingMatch = closingOnly.exec(trimmed);
  if (closingMatch) {
    return {
      reasoning: closingMatch[1].trim(),
      content: trimmed.slice(closingMatch.index + closingMatch[0].length).trim(),
    };
  }

  const openingOnly = new RegExp(`<(${REASONING_TAG_PATTERN})\\b[^>]*>([\\s\\S]*)`, 'i');
  const openingMatch = openingOnly.exec(trimmed);
  if (openingMatch) {
    return {
      reasoning: openingMatch[2].trim(),
      content: trimmed.slice(0, openingMatch.index).trim(),
    };
  }

  return { content };
}

export function normalizeReasoningChunk(input: {
  content?: string;
  reasoning?: string;
}): NormalizedReasoningChunk {
  const rustChunk = normalizeReasoningChunkRust({
    content: input.content,
    reasoning: input.reasoning,
  });
  if (rustChunk !== null) {
    return rustChunk;
  }
  const split = splitReasoningTags(input.content ?? '');
  const reasoning = [input.reasoning, split.reasoning].filter(Boolean).join('\n\n');
  return {
    content: split.content,
    ...(reasoning ? { reasoning } : {}),
  };
}

const openAIReasoning: ReasoningExtractor = {
  name: 'openai',
  extract: extractStructuredReasoning,
};

const openRouterReasoning: ReasoningExtractor = {
  name: 'openrouter',
  extract: extractStructuredReasoning,
};

const defaultReasoning: ReasoningExtractor = {
  name: 'default',
  extract: extractStructuredReasoning,
};

export const REASONING_EXTRACTORS: Record<string, ReasoningExtractor> = {
  openai: openAIReasoning,
  openRouter: openRouterReasoning,
  default: defaultReasoning,
};
