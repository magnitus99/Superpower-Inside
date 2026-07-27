import { planContextBudgetAppendRust } from '../rag/rust-core';
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
      const plan = planContextBudgetAppendRust(remainingChars, block.text);
      if (!plan) {
        remainingChars = 0;
        return false;
      }
      remainingChars = plan.remainingChars;
      if (!plan.appended) return false;
      blocks.push({ ...block, text: plan.text });
      return plan.complete;
    },
    getBlocks(): AppendedContextBlock[] {
      return blocks;
    },
    getRemainingChars(): number {
      return remainingChars;
    },
  };
}
