import type { LLMProvider } from '../llm/providers';
import { planVaultQueryExpansionRust } from '../rag/rust-core';

/** 한 번에 붙일 수 있는 교차 언어 검색 구문 상한입니다. */
export const MAX_QUERY_VARIANTS = 3;

/**
 * 질문에 ASCII 밖의 알파벳이 있으면 다른 언어로 색인된 문서를 놓칠 수 있습니다.
 * Rust 확장기와 같은 규칙을 씁니다.
 */
export function needsCrossLanguageSearch(question: string): boolean {
  for (const character of question) {
    if (!/\p{L}/u.test(character)) continue;
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x7f) return true;
  }
  return false;
}

/**
 * provider에 다른 언어 검색 구문을 요청하고 Rust 확장기로 검증합니다.
 * 실패·지연·형식 오류는 검색 실패가 아니라 확장 없음으로 처리합니다.
 */
export async function requestQueryVariants(
  provider: Pick<LLMProvider, 'chat'> | null | undefined,
  question: string,
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const segments = splitLongQuestion(question);
  const longQuestionVariants = segments.slice(1);
  if (!provider || !needsCrossLanguageSearch(question)) return longQuestionVariants;
  if (signal?.aborted) return [];
  let response: string;
  try {
    response = await provider.chat([{ role: 'system', content: systemPrompt }, { role: 'user', content: question }]);
  } catch {
    return [];
  }
  if (signal?.aborted) return [];
  const plan = planVaultQueryExpansionRust(question, response.trim());
  if (!plan) return [];
  const seen = new Set<string>([question.trim().toLocaleLowerCase()]);
  const variants: string[] = [...longQuestionVariants];
  for (const variant of plan.variants) {
    const normalized = variant.replace(/\s+/gu, ' ').trim();
    const key = normalized.toLocaleLowerCase();
    if (normalized.length === 0 || seen.has(key)) continue;
    seen.add(key);
    variants.push(normalized);
  }
  return variants.slice(0, MAX_QUERY_VARIANTS);
}

/** Rust 검색 계획이 받아들이는 질의 하나의 문자 수 상한과 같습니다. */
export const MAX_SEARCH_QUERY_CHARS = 320;

/**
 * 긴 질문을 검색 계획 상한 이하 조각으로 나눕니다.
 * 원문을 버리지 않고, 문장·절 경계를 우선하며 숫자·고유명사를 함께 남깁니다.
 */
export function splitLongQuestion(
  question: string,
  limit = MAX_SEARCH_QUERY_CHARS,
  maxParts = 4,
): string[] {
  const normalized = question.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= limit) return [normalized];
  const sentences = normalized.split(/(?<=[.?!。？！])\s+/u);
  const parts: string[] = [];
  let buffer = '';
  const flush = () => {
    const value = buffer.trim();
    if (value.length > 0) parts.push(value);
    buffer = '';
  };
  for (const sentence of sentences) {
    if (sentence.length <= limit && buffer.length + sentence.length + 1 <= limit) {
      buffer = buffer.length > 0 ? `${buffer} ${sentence}` : sentence;
      continue;
    }
    flush();
    if (sentence.length <= limit) {
      buffer = sentence;
      continue;
    }
    // 한 문장이 상한보다 길면 단어 경계에서 나눕니다.
    let rest = sentence;
    while (rest.length > limit) {
      const cut = rest.lastIndexOf(' ', limit);
      const end = cut > limit * 0.5 ? cut : limit;
      parts.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    buffer = rest;
  }
  flush();
  return parts.slice(0, maxParts);
}
