import { planAssistantResponseClassificationRust } from '../rag/rust-core';
import type { AssistantQuestion } from './types';

export type AssistantResponseClassification =
  | {
      type: 'answer';
      content: string;
      reasoning: string;
    }
  | {
      type: 'question';
      content: string;
      reasoning: string;
      question: AssistantQuestion;
      originalContent: string;
    };

interface ClassifyInput {
  content: string;
  reasoning: string;
}

export function classifyAssistantResponse(
  input: ClassifyInput,
): AssistantResponseClassification {
  return (
    planAssistantResponseClassificationRust(input) ?? {
      type: 'answer',
      content: input.content.trim(),
      reasoning: input.reasoning.trim(),
    }
  );
}

export function shouldRenderAssistantQuestion(
  classification: AssistantResponseClassification,
  activeToolCallCount: number,
): classification is Extract<AssistantResponseClassification, { type: 'question' }> {
  return classification.type === 'question' && activeToolCallCount === 0;
}
