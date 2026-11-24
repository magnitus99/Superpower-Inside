// 테스트 대역 전용입니다. 실제 제품 검사에는 Native 결과를 쓰며 이 원장을 입력하지 않습니다.
import { lexicalOracle } from './quality-oracle.mjs';

export function literalProtocolFixture(documents, terms, excluded = [], visiblePaths) {
  const oracle = lexicalOracle(documents, terms, excluded);
  const encoder = new TextEncoder();
  const references = [];
  for (const document of documents) {
    if (excluded.includes(document.path) || (visiblePaths && !visiblePaths.includes(document.path))) continue;
    for (const [lineIndex, line] of document.text.split('\n').entries()) for (const [needleIndex, term] of terms.entries()) {
      const text = line.normalize('NFKC').toLowerCase(), needle = term.normalize('NFKC').toLowerCase();
      if (!needle) continue;
      for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + needle.length)) references.push({ path: document.path, line: lineIndex + 1, needleIndex, normalizedStart: encoder.encode(text.slice(0, start)).length, normalizedEnd: encoder.encode(text.slice(0, start + needle.length)).length });
    }
  }
  references.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || a.needleIndex - b.needleIndex || a.normalizedStart - b.normalizedStart);
  const pages = [];
  for (let from = 0; from < references.length; from += 256) pages.push(references.slice(from, from + 256));
  return {
    inventory: { status: 'complete', summary: { matchMode: 'nfkc-unicode-lower-line-substring-v1', sources: documents.filter((item) => !excluded.includes(item.path)).length, pageCount: pages.length, needles: terms.map((term) => {
      const rows = oracle.rows.filter((row) => row.term === term);
      return { needle: term, normalizedNeedle: term.normalize('NFKC').toLowerCase(), documents: rows.length, matchingLines: rows.reduce((sum, row) => sum + row.passages.length, 0), occurrences: rows.reduce((sum, row) => sum + row.occurrences, 0) };
    }) } },
    readPage: (index) => Promise.resolve(index < pages.length ? { pageIndex: index, nextPage: index + 1 < pages.length ? index + 1 : null, references: pages[index] } : null),
  };
}
