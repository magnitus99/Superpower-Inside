import { t } from '../i18n';
import type { SourceCitation } from '../chat/types';
import { renderIndexedReviewAnswerRust, scopeIndexedDiscoveryRust } from '../rag/rust-core';
import type { IndexedVaultReviewOptions, IndexedVaultReviewResult } from './indexed-vault-review';

/** 전체 열거는 전역 상위 k와 분리해 문서별 원문 검증을 끝낸 목록으로 만듭니다. */
export async function enumerateIndexedDocuments(
  options: IndexedVaultReviewOptions,
  review: (options: IndexedVaultReviewOptions) => Promise<IndexedVaultReviewResult>,
): Promise<{ content: string; citations: SourceCitation[]; incomplete: boolean }> {
  // Rust 검색 계획은 질의 변형을 최대 3개까지만 받아들입니다. 4개 이상을 넘기면
  // 열거 계획 자체가 거부되어 확인된 문서가 실패로 집계됩니다.
  const MAX_QUERY_VARIANTS = 3;
  const documents = new Map<string, string[]>();
  let missing = 0;
  for (const match of options.matchInventory ?? []) {
    missing += Math.max(0, match.totalDocuments - match.documents.length);
    for (const document of match.documents) {
      const queries = documents.get(document.sourcePath) ?? [];
      queries.push(match.query);
      documents.set(document.sourcePath, queries);
    }
  }
  const currentPaths = async () => {
    options.signal?.throwIfAborted();
    const allowedPaths = await options.getFollowupPaths?.() ?? options.indexedPaths;
    options.signal?.throwIfAborted();
    if (options.isCurrent?.() === false) throw new DOMException(t('cancelledLabel'), 'AbortError');
    return scopeIndexedDiscoveryRust({ originalPaths: options.discoveryPaths ?? options.indexedPaths,
      originalScopes: options.scopes, allowedPaths, scopes: options.scopes });
  };
  const rows: { path: string; content: string; citation: SourceCitation }[] = [];
  let failed = 0;
  for (const [path, queries] of documents) {
    const allowed = await currentPaths();
    if (!allowed) { failed += 1; continue; }
    if (!allowed.includes(path)) continue;
    const result = await review({
      ...options, question: queries[0] ?? options.question,
      queryVariants: queries.slice(1, 1 + MAX_QUERY_VARIANTS),
      indexedPaths: [path], documentScope: 'all', candidates: undefined,
      discoveryCandidates: undefined, discoveryPaths: undefined, getFollowupPaths: undefined,
      matchInventory: undefined, inventory: undefined, searchPlan: undefined,
      deferAnswer: true, exhaustiveReview: false,
      onAnswer: undefined, onProgress: undefined, onDiagnostics: undefined, onReasoning: undefined,
    });
    options.signal?.throwIfAborted();
    const item = result.evidence.find((item) => item.path === path);
    const citation = result.citations.find((citation) => citation.filePath === path && citation.status === 'verified');
    if (!item || !citation) { failed += 1; continue; }
    const label = path.replace(/\s+/g, ' ').replace(/[&<>\\`*_{}[\]()#+\-.!|~:$]/g,
      (character) => `&#${character.charCodeAt(0)};`);
    const rendered = renderIndexedReviewAnswerRust([item.sourceId], JSON.stringify({
      paragraphs: [{ text: `- ${label} (L${item.startLine}–L${item.endLine})`, sources: [item.sourceId] }],
    }));
    if (!rendered) { failed += 1; continue; }
    rows.push({ path, content: rendered, citation });
    options.onProgress?.({ phase: 'verify', completedFiles: rows.length + failed, totalFiles: documents.size });
  }
  const allowed = await currentPaths();
  const currentRows = allowed ? rows.filter((row) => allowed.includes(row.path)) : [];
  const incomplete = !allowed || failed > 0 || missing > 0 || !options.matchInventory?.length;
  const notice = t(incomplete ? 'indexedReviewEnumerationIncomplete' : 'indexedReviewEnumerationComplete',
    { verified: currentRows.length, failed, missing });
  return { content: [notice, ...currentRows.map((row) => row.content)].join('\n\n'),
    citations: currentRows.map((row) => row.citation), incomplete };
}
