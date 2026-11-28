import { planIndexedEvidenceRust, type RustIndexedSearchFacet } from '../rag/rust-core';
import type { IndexedEvidenceItem } from './indexed-vault-review';
import { facetWords, matchesSubjectWord } from './facet-retrieval';
import type { CurrentSourceWindows } from './current-source-windows';

/** 검색용 변형은 누락 facet 하나의 Rust 계획 term에서만 만든다. */
export function facetQueryVariants(facet: RustIndexedSearchFacet): string[] {
  return [...new Set([facet.terms.join(' '), ...facet.terms.slice(0, 2)])].filter(q => q && q !== facet.query);
}

function facetGroups(facet: RustIndexedSearchFacet): string[][] {
  return (facet.identities ?? [facet.terms]).map(group => group.map(term => term.normalize('NFKC').toLowerCase()));
}

function matchTerms(text: string): (term: string) => boolean {
  const words = new Set(facetWords(text));
  return term => {
    if (words.has(term)) return true;
    if (term.length >= 2 && /[가-힣]$/u.test(term)) {
      for (const word of words) if (matchesSubjectWord(term, word)) return true;
    }
    return false;
  };
}

function coversGroups(text: string, groups: readonly (readonly string[])[]): boolean {
  const matches = matchTerms(text);
  return groups.some(group => group.length && group.every(matches));
}

/** 단어 일부나 문서 이름만 일치하는 경우에는 facet 귀속을 증명하지 못한다. */
export function coversFacet(quote: string, facet: RustIndexedSearchFacet): boolean {
  return coversGroups(quote, facetGroups(facet));
}

export interface CurrentFacetScanCounts {
  pathFacetScans: number;
  termWindowCandidates: number;
  rankingUnavailable: number;
  rankedPassages: number;
  fullTermPassages: number;
}

/** 경로 prior·색인 prefix를 증명에 쓰지 않는다. 현재 청크 주소의 실제 행에서 독립 질의를 평가한다. */
export async function findCurrentFacetPassages(facet: RustIndexedSearchFacet, path: string, revision: string,
  chunks: readonly { startLine: number; endLine: number; text: string }[], windows: CurrentSourceWindows,
  scopes: readonly string[], signal?: AbortSignal, counts?: CurrentFacetScanCounts): Promise<IndexedEvidenceItem[]> {
  const groups = facetGroups(facet);
  const terms = [...new Set(groups.flat())].filter(Boolean);
  if (!terms.length) return [];
  const documents: { path: string; revision: string; indexed: boolean; reviewState: 'reviewed'; startLine: number; text: string }[] = [];
  const seen = new Set<string>();
  // 전체 본문 복제 대신 청크 크기의 창에서만 검색한다. 힌트는 후보일 뿐이며 최종 quote를 다시 검사한다.
  let work = 0;
  const yieldToHost = () => new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
  for (const chunk of chunks) {
    if (++work % 128 === 0) {
      await yieldToHost();
      signal?.throwIfAborted();
    }
    if (chunk.text.length <= 65_536 && !coversGroups(chunk.text, groups)) continue;
    for (let line = chunk.startLine; line <= chunk.endLine; line++) {
      if (++work % 512 === 0) {
        await yieldToHost();
        signal?.throwIfAborted();
      }
      const row = windows.rows(line, line, 4096);
      if (row === undefined) break;
      if (!row?.trim() || !terms.some(matchTerms(row))) continue;
      // 조건이 다음 행에 이어질 수 있다. 같은 현재 청크 안의 짧은 다행 구절도 후보로 보존한다.
      for (const [start, end] of [[Math.max(chunk.startLine, line - 1), Math.min(chunk.endLine, line + 1)], [line, line]]) {
        const key = `${start}:${end}`;
        if (seen.has(key)) continue;
        const quote = windows.rows(start, end, 4096)?.replace(/[\r\n]+$/, '');
        if (!quote || !chunk.text.includes(quote) || !coversGroups(quote, groups)) continue;
        seen.add(key);
        documents.push({ path, revision, indexed: true, reviewState: 'reviewed' as const, startLine: start, text: quote });
        if (documents.length >= 64) break;
      }
      if (documents.length >= 64) break;
    }
    if (documents.length >= 64) break;
  }
  if (counts) {
    counts.pathFacetScans++;
    counts.termWindowCandidates += documents.length;
  }
  if (!documents.length) return [];
  const plan = planIndexedEvidenceRust({ question: facet.query, queryVariants: facetQueryVariants(facet), documents, scopes,
    budget: { maxPassages: 4, maxChars: 8192, maxDocuments: 1 } });
  // 부분 문자열·일부 공통어·순위 신호는 대상 facet 전체의 lexical coverage가 아니다.
  const chosen = (plan?.evidence ?? []).flatMap(item => {
    if (item.path !== path || item.revision !== revision) return [];
    if (coversGroups(item.quote, groups)) return [item];
    // The extractor can crop a qualifying multi-line window to a sentence without its
    // subject. Restore only the bounded current window containing the ranked span;
    // the caller still has to verify these exact lines and quote against the current chunk.
    const full = documents.find(d => d.startLine <= item.startLine && d.text.includes(item.quote) &&
      d.startLine + d.text.split('\n').length - 1 >= item.endLine);
    if (!full) return [];
    const endLine = full.startLine + full.text.split('\n').length - 1;
    return [{ ...item, sourceId: `${path}#L${full.startLine}-L${endLine}`, startLine: full.startLine, endLine, quote: full.text }];
  });
  if (counts) {
    if (!plan) counts.rankingUnavailable++;
    counts.rankedPassages += plan?.evidence.length ?? 0;
    counts.fullTermPassages += chosen.length;
  }
  return chosen.map(item => ({ ...item, queryIndexes: [facet.queryIndex], preferredQueryIndexes: [facet.queryIndex] }));
}
