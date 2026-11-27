import type { IndexedEvidenceCandidate, IndexedVaultReviewOptions } from './indexed-vault-review';
import { pageIndexedDiscoveryRust, scopeIndexedDiscoveryRust } from '../rag/rust-core';
import { LiteralInventoryError, type LiteralInventoryHandle, type LiteralInventorySummary } from '../rag/literal-inventory';
import { appLogger } from '../utils/logger';

export type IndexedLiteralInventory =
  | { status: 'complete'; summary: LiteralInventorySummary; representativePages: number }
  | { status: 'unavailable' | 'failed'; reason: 'unsupported-filters' | 'source-literal-unavailable' };
export interface LiteralReviewPreparation { options: IndexedVaultReviewOptions; inventory?: IndexedLiteralInventory; handle?: LiteralInventoryHandle }

/** 전체 원장은 유지하고 기존 검토 예산으로 전달할 위치 힌트만 별도 페이지에서 읽습니다. */
export async function prepareLiteralReview(options: IndexedVaultReviewOptions): Promise<LiteralReviewPreparation> {
  if (options.candidatesState === 'indexing' || options.isCurrent?.() === false || options.filters || !options.openLiteralInventory) {
    const inventory: IndexedLiteralInventory = { status: 'unavailable', reason: options.filters ? 'unsupported-filters' : 'source-literal-unavailable' };
    return { options: { ...options, literalInventory: inventory }, inventory };
  }
  let handle: LiteralInventoryHandle | undefined;
  try {
    const candidatesOnly = options.documentScope === 'candidates' ? new Set(options.candidates?.map((candidate) => candidate.path)) : null;
    const paths = candidatesOnly ? options.indexedPaths.filter((path) => candidatesOnly.has(path)) : options.discoveryPaths ?? options.indexedPaths;
    const allowed = new Set(paths);
    const needles = [options.literalQuery ?? options.scoringQuestion ?? options.question, ...(options.searchPlan?.facets.flatMap((facet) => facet.terms) ?? [])];
    handle = await options.openLiteralInventory(needles, options.signal, paths);
    const summary = await handle.getSummary();
    const observed: IndexedEvidenceCandidate[] = [];
    let representativePages = 0;
    for (let index = 0; index < Math.min(summary.pageCount, 8); index++) {
      options.signal?.throwIfAborted();
      const page = await handle.readPage(index);
      if (!page) throw new Error('literal-review-page-missing');
      for (const reference of page.references) {
        if (!allowed.has(reference.path)) throw new Error('literal-review-page-outside-scope');
        observed.push({ path: reference.path, startLine: reference.line, endLine: reference.line, source: 'lexical', score: 0, rank: 1 });
      }
      representativePages++;
    }
    const inventory: IndexedLiteralInventory = { status: 'complete', summary, representativePages };
    if (observed.length === 0) return { options: { ...options, literalInventory: inventory }, inventory, handle };
    const knownPaths = new Set((options.discoveryCandidates ?? options.candidates ?? []).map((candidate) => candidate.path));
    const newHints = observed.filter((candidate) => !knownPaths.has(candidate.path));
    const candidates = [...(options.candidates ?? []), ...newHints];
    const discoveryCandidates = [...newHints, ...(options.discoveryCandidates ?? options.candidates ?? []), ...observed.filter((candidate) => knownPaths.has(candidate.path))];
    const representatives = pageIndexedDiscoveryRust({ candidates: observed, originalPaths: paths, originalScopes: options.scopes, allowedPaths: paths,
      scopes: options.scopes, reviewedPaths: [], selectedPaths: [], failedPaths: [], offset: 0, limit: 96 });
    if (!representatives) throw new Error('literal-review-discovery-unavailable');
    const indexedPaths = scopeIndexedDiscoveryRust({ originalPaths: [...options.indexedPaths, ...representatives.items.map((item) => item.path)], originalScopes: options.scopes, allowedPaths: paths, scopes: options.scopes });
    if (!indexedPaths) throw new Error('literal-review-scope-unavailable');
    return { options: { ...options, indexedPaths, candidates, discoveryCandidates, literalInspectionPaths: representatives.items.map((item) => item.path).filter((path) => !knownPaths.has(path)), candidatesState: 'ready', literalInventory: inventory }, inventory, handle };
  } catch (error) {
    await handle?.close();
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    const reason = error instanceof LiteralInventoryError ? error.reason : '';
    const code = reason === 'source-currentness-unverified' ? 'unprepared-body-hashes'
      : reason === 'source-revision-stale' || reason === 'inventory-stale' ? 'stale'
      : reason === 'source-body-unavailable' ? 'body-unavailable' : 'unavailable';
    appLogger.debug('Literal review inventory unavailable.', { source: 'chat.indexed-review.literal', data: { code } });
    const inventory: IndexedLiteralInventory = { status: 'failed', reason: 'source-literal-unavailable' };
    return { options: { ...options, literalInventory: inventory }, inventory };
  }
}
