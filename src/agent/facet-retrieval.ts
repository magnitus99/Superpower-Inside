/** Search-only descriptors. Neither a model's choice nor a path hit is evidence. */
export interface RetrievalSubject { anchor: string; query: string; discoveryQuery: string; terms: string[]; identities: string[][] }
export type RankFollowup = (queries: readonly string[], paths: readonly string[], signal: AbortSignal) => Promise<readonly (readonly string[])[] | null>;
// research_contract::append_meaningful_tokens의 단어 경계만 사용한다. BM25의 부분 토큰은 근거가 아니다.
export function facetWords(text: string): string[] {
  return (text.normalize('NFKC').match(/[\p{Alphabetic}\p{N}_-]+/gu) ?? []).map(word => word.toLowerCase());
}
const subjectParticle = /^(?:은|는|이|가|을|를|와|과|의|에서|에|로|으로)$/u;
export function matchesSubjectWord(term: string, word: string): boolean {
  return term === word || (term.length >= 2 && /[가-힣]$/u.test(term) && word.startsWith(term) && subjectParticle.test(word.slice(term.length)));
}

/** Literal anchors from the question, not invented labels, instructions or file selectors. */
export function parseFacetRetrieval(question: string, response: string): RetrievalSubject[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(response); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !('subjects' in parsed) || !Array.isArray(parsed.subjects) || parsed.subjects.length !== 2) return null;
  const result: RetrievalSubject[] = [];
  const collisionGroups: string[][][] = [];
  const q = facetWords(question);
  let firstSpan: { start: number; length: number } | undefined;
  for (const item of parsed.subjects as unknown[]) {
    if (!item || typeof item !== 'object' || !('anchor' in item) || !('identity' in item) || !('query' in item)) return null;
    const { anchor, identity, query } = item;
    if (typeof anchor !== 'string' || typeof identity !== 'string' || typeof query !== 'string' ||
      [anchor, identity, query].some(s => !s.trim() || s.length > 160 || /[\r\n/\\{}]/u.test(s))) return null;
    const label = facetWords(anchor), terms = [...new Set(facetWords(identity))], probes = facetWords(query);
    if (!label.length || label.length > 9) return null;
    const start = q.findIndex((_, i) => label.every((w, j) => q[i+j] === w ||
      (j === label.length-1 && q[i+j]?.startsWith(w) && subjectParticle.test(q[i+j].slice(w.length)))));
    if (start === -1 || (firstSpan?.start === start && firstSpan.length === label.length)) return null;
    firstSpan ??= { start, length: label.length };
    if (!terms.length || terms.length > 6 || !terms.some(w => /\p{L}/u.test(w) && w.length >= 2)) return null;
    const search = terms.every(w => probes.includes(w)) ? query.trim() : `${identity.trim()} ${query.trim()}`;
    if (search.length > 160) return null;
    const identities = [terms];
    if (label.some(w => w.length >= 2 && /\p{L}/u.test(w)) && label.join(' ') !== terms.join(' ')) identities.push(label);
    const discoveryQuery = identities.map(group => `"${group.join(' ')}"`).join(' ');
    result.push({ anchor, terms, identities, discoveryQuery, query: search });
    collisionGroups.push([terms, label]);
  }
  const [a, b] = collisionGroups;
  // 검색·인용 identity로 쓰기 짧은 원표기도 양쪽 표현의 충돌 검사에서는 제외하지 않는다.
  const includes = (group: readonly string[], terms: readonly string[]) => terms.every(term => group.some(word => matchesSubjectWord(term, word)));
  return a.some(left => b.some(right => includes(left, right) || includes(right, left))) ? null : result;
}

/** A shared top path consumes one slot; a sibling advances to its next distinct candidate. */
export function roundRobinPaths(groups: readonly (readonly string[])[], limit: number): string[] {
  const chosen = new Set<string>(), cursors = groups.map(() => 0);
  while (chosen.size < limit) {
    const before = chosen.size;
    for (const [i, group] of groups.entries()) {
      while (cursors[i] < group.length && chosen.has(group[cursors[i]])) cursors[i]++;
      if (cursors[i] < group.length) chosen.add(group[cursors[i]++]);
      if (chosen.size >= limit) break;
    }
    if (chosen.size === before) break;
  }
  return [...chosen];
}
