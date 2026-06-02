import { t } from '../i18n';
import type { AssistantQuestion } from './types';

export function formatAssistantQuestionAnswer(
  question: AssistantQuestion,
  selectedLabels: string[],
  freeText: string,
): string | null {
  const trimmedFreeText = freeText.trim();
  if (selectedLabels.length === 0 && !trimmedFreeText) return null;

  const parts = [t('assistantQuestionPrefix', { question: question.prompt })];
  if (selectedLabels.length > 0) {
    parts.push(t('assistantQuestionSelectedItems'), ...selectedLabels.map((label) => `- ${label}`));
  }
  if (trimmedFreeText) {
    parts.push(t('assistantQuestionAdditionalInput'), trimmedFreeText);
  }
  return parts.join('\n');
}
