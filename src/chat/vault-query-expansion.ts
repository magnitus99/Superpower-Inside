import { planResearchCandidateSelectionRust } from '../rag/rust-core';

const MAX_EXPANDED_QUERY_CHARS = 240;
const MAX_ADDITIONAL_TERMS = 16;

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

  const normalizedQuestion = question.replace(/\s+/gu, ' ').trim();
  const normalizedLower = normalizedQuestion.toLocaleLowerCase();
  const uniqueTerms = plan.terms
    .map((term) => term.replace(/\s+/gu, ' ').trim())
    .filter((term) => term.length > 0 && term.length <= 80)
    .filter(
      (term, index, terms) =>
        terms.findIndex(
          (candidate) => candidate.toLocaleLowerCase() === term.toLocaleLowerCase(),
        ) === index,
    );
  const additionalTerms = uniqueTerms
    .filter((term) => !normalizedLower.includes(term.toLocaleLowerCase()))
    .slice(0, MAX_ADDITIONAL_TERMS);
  // 긴 질문은 전문을 그대로 검색어로 쓰지 않고 엔진이 고른 핵심 용어만 사용합니다.
  const searchTerms =
    normalizedQuestion.length > MAX_EXPANDED_QUERY_CHARS
      ? uniqueTerms.slice(0, MAX_ADDITIONAL_TERMS + 1)
      : [normalizedQuestion, ...additionalTerms];
  return searchTerms
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_EXPANDED_QUERY_CHARS);
}
