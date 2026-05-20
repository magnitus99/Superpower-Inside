import type { AssistantQuestion } from './types';

export function formatAssistantQuestionAnswer(
  question: AssistantQuestion,
  selectedLabels: string[],
  freeText: string,
): string | null {
  const trimmedFreeText = freeText.trim();
  if (selectedLabels.length === 0 && !trimmedFreeText) return null;

  const parts = [`질문: ${question.prompt}`];
  if (selectedLabels.length > 0) {
    parts.push('선택한 항목:', ...selectedLabels.map((label) => `- ${label}`));
  }
  if (trimmedFreeText) {
    parts.push('추가 입력:', trimmedFreeText);
  }
  return parts.join('\n');
}
