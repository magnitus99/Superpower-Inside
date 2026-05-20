import type { SourceCitation } from './types';

export interface ContextBlock {
  text: string;
  citation?: SourceCitation;
}

export interface AppendedContextBlock extends ContextBlock {
  text: string;
}

export interface ContextBudget {
  append(block: ContextBlock): boolean;
  getBlocks(): AppendedContextBlock[];
  getRemainingChars(): number;
}

export function createContextBudget(maxChars: number): ContextBudget {
  const blocks: AppendedContextBlock[] = [];
  let remainingChars = maxChars;

  return {
    append(block: ContextBlock): boolean {
      if (remainingChars <= 0) return false;
      const text =
        block.text.length > remainingChars ? block.text.slice(0, remainingChars) : block.text;
      blocks.push({ ...block, text });
      remainingChars -= text.length;
      return text.length === block.text.length;
    },
    getBlocks(): AppendedContextBlock[] {
      return blocks;
    },
    getRemainingChars(): number {
      return remainingChars;
    },
  };
}
