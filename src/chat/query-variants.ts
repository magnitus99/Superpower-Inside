/** 한 번에 붙일 수 있는 검색 구문 변형 상한입니다. */
export const MAX_QUERY_VARIANTS = 3;

/**
 * 긴 질문을 검색 계획 상한 이하 조각으로 나눠 변형을 만듭니다.
 * 제공자 번역·확장 호출 없이 로컬 결정적 분해만 사용합니다.
 */
export function planQueryVariants(question: string): string[] {
  return splitLongQuestion(question).slice(1, 1 + MAX_QUERY_VARIANTS);
}

/** Rust 검색 계획이 받아들이는 질의 하나의 문자 수 상한과 같습니다. */
export const MAX_SEARCH_QUERY_CHARS = 320;

/**
 * 긴 질문을 검색 계획 상한 이하 조각으로 나눕니다.
 * 문장·절 경계를 우선하고, 지정한 조각 수까지 숫자·고유명사를 함께 남깁니다.
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
