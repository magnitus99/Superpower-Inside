import { planResearchCandidateSelectionRust } from '../rag/rust-core';

const MAX_EXPANDED_QUERY_CHARS = 500;

export function expandVaultSearchQueryLocally(
  question: string,
  previousUserQuestions: readonly string[] = [],
): string {
  const plan = planResearchCandidateSelectionRust({
    currentQuestion: question,
    previousUserQuestions,
    paths: [],
    samples: [],
  });
  if (!plan) return question;

  const normalizedQuestion = question.toLocaleLowerCase();
  const additionalTerms = plan.terms.filter(
    (term) => !normalizedQuestion.includes(term.toLocaleLowerCase()),
  );
  return [question, ...additionalTerms]
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_EXPANDED_QUERY_CHARS);
}
