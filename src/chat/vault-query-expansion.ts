import { planResearchCandidateSelectionRust } from '../rag/rust-core';

const MAX_EXPANDED_QUERY_CHARS = 500;

/** 검색 계획은 로컬 엔진만 사용하며 provider에 질문을 전송하지 않습니다. */
export function expandVaultSearchPlan(
  question: string,
  previousUserQuestions: readonly string[] = [],
): { query: string; variants: string[] } {
  const local = expandVaultSearchQueryLocally(question, previousUserQuestions);
  return { query: question, variants: local === question ? [] : [local] };
}

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
