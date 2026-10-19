import {
  searchIndexedVault,
  type IndexedEvidenceCandidate,
  type IndexedEvidenceInventory,
  type IndexedEvidenceItem,
  type IndexedVaultCorpus,
  type IndexedVaultSearchResult,
} from '../agent/indexed-vault-review';
import type {
  SearchCandidateState,
  SearchHighlight,
  SearchPort,
  SearchRequest,
  SearchResponse,
} from './engine-port';

export interface IndexedSearchSource {
  corpus: IndexedVaultCorpus;
  getIndexedPaths(): Promise<readonly string[]>;
  /** 하이브리드 검색이 지목한 후보 신호. 검색 화면은 이 범위 밖의 색인 본문을 읽지 않는다. */
  candidates?: readonly IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
  candidatesState?: SearchCandidateState;
  scopes?: readonly string[];
  /** 색인 리비전과 현재 vault 리비전(mtime:size)을 대조하는 reader. 없으면 결과를 verified로 표시하지 않는다. */
  revisionReader?: (path: string) => Promise<string | null>;
}

type IndexedVaultSearch = typeof searchIndexedVault;

/**
 * 색인 검색 함수와 색인 저장소를 UI 포트로 연결한다.
 * 순위·구절 선택·병합은 엔진이 결정하고 여기서는 전달과 최신성 대조만 한다.
 */
export function createIndexedSearchPort(
  source: IndexedSearchSource,
  search: IndexedVaultSearch = searchIndexedVault,
): SearchPort {
  return async (request: SearchRequest): Promise<SearchResponse | null> => {
    const candidatesState = source.candidatesState ?? 'ready';
    if (candidatesState === 'indexing' || candidatesState === 'initializing') {
      return createPendingSearchResponse(candidatesState, source.inventory);
    }
    if (candidatesState === 'unavailable') return null;
    const { revisionReader } = source;
    // 현재 원문 리비전을 확인할 수 없으면 색인 사본을 verified 결과로 내보내지 않는다.
    if (!revisionReader) return null;
    const indexedPaths = await source.getIndexedPaths();
    const result = await search({
      question: request.query,
      indexedPaths,
      scopes: source.scopes ?? [],
      corpus: source.corpus,
      candidates: source.candidates,
      documentScope: 'candidates',
      inventory: source.inventory,
      filters: request.filters,
      signal: request.signal,
    });
    if (!result) return null;
    const revision = await keepCurrentRevision(result.evidence, revisionReader);
    const response = toSearchResponse({ ...result, evidence: revision.evidence });
    response.staleDocuments = revision.staleDocuments;
    response.diagnostics.selectedDocuments = new Set(
      revision.evidence.map((item) => item.path),
    ).size;
    if (revision.staleDocuments > 0 && response.coverage.status === 'supported') {
      response.coverage.status = 'incomplete';
    }
    return response;
  };
}

function createPendingSearchResponse(
  state: 'indexing' | 'initializing',
  inventory: IndexedEvidenceInventory | undefined,
): SearchResponse {
  const indexedCount = inventory?.indexedCount ?? 0;
  return {
    evidence: [],
    queryTokens: [],
    phrases: [],
    diagnostics: {
      candidateDepth: 0,
      candidateDocuments: 0,
      selectedDocuments: 0,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
      unmatchedTerms: [],
      zeroHitReason: state,
    },
    coverage: {
      documentScope: 'candidates',
      status: 'incomplete',
      reviewedDocuments: 0,
      unreviewedDocuments: inventory?.unreviewedCount ?? indexedCount,
      notIndexedDocuments: inventory?.notIndexedCount ?? 0,
    },
    staleDocuments: 0,
  };
}

/** 채택 문서를 현재 vault 리비전과 대조하고, 확인되지 않은 구절은 제외한다. */
async function keepCurrentRevision(
  evidence: readonly IndexedEvidenceItem[],
  revisionReader: (path: string) => Promise<string | null>,
): Promise<{ evidence: readonly IndexedEvidenceItem[]; staleDocuments: number }> {
  const currentByPath = new Map<string, string | null>();
  for (const path of new Set(evidence.map((item) => item.path))) {
    try {
      currentByPath.set(path, await revisionReader(path));
    } catch {
      currentByPath.set(path, null);
    }
  }
  const verified: IndexedEvidenceItem[] = [];
  const stalePaths = new Set<string>();
  for (const item of evidence) {
    const current = currentByPath.get(item.path);
    if (item.revision !== null && current !== null && current === item.revision) {
      verified.push(item);
    } else {
      stalePaths.add(item.path);
    }
  }
  return { evidence: verified, staleDocuments: stalePaths.size };
}

/**
 * 엔진이 보낸 quote 기준 ordered ranges만 그대로 전달한다.
 * 정렬·범위 보정은 엔진 책임이므로 잘못된 값은 강조 없이 버린다.
 */
function readOrderedHighlights(item: IndexedEvidenceItem): readonly SearchHighlight[] | undefined {
  const value = (item as unknown as { highlights?: unknown }).highlights;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  let previousEnd = 0;
  const ranges: SearchHighlight[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const { start, end } = entry as { start?: unknown; end?: unknown };
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < previousEnd ||
      (end as number) <= (start as number) ||
      (end as number) > item.quote.length
    ) {
      return undefined;
    }
    ranges.push({ start: start as number, end: end as number });
    previousEnd = end as number;
  }
  return ranges;
}

/** 엔진 결과를 화면 계약으로 옮긴다. 필드 이름만 맞추고 값은 그대로 보존한다. */
export function toSearchResponse(result: IndexedVaultSearchResult): SearchResponse {
  const { plan } = result;
  return {
    evidence: result.evidence.map((item) => ({
      sourceId: item.sourceId,
      path: item.path,
      revision: item.revision,
      startLine: item.startLine,
      endLine: item.endLine,
      quote: item.quote,
      contextBefore: item.contextBefore,
      contextAfter: item.contextAfter,
      score: item.score,
      rank: item.rank,
      signal: item.signal,
      phraseMatches: item.phraseMatches,
      proximityScore: item.proximityScore,
      fieldScore: item.fieldScore,
      exactSignals: item.exactSignals,
      negatedNearby: item.negatedNearby,
      duplicateOf: item.duplicateOf,
      ...(readOrderedHighlights(item) ? { highlights: readOrderedHighlights(item) } : {}),
    })),
    queryTokens: plan.queryTokens.map((token) => ({
      text: token.text,
      position: token.position,
      field: token.field,
      kind: token.kind,
      negated: token.negated,
      phraseIndex: token.phraseIndex,
    })),
    phrases: plan.phrases.map((phrase) => ({
      tokens: phrase.tokens,
      negated: phrase.negated,
      field: phrase.field,
    })),
    diagnostics: {
      candidateDepth: plan.diagnostics.candidateDepth,
      candidateDocuments: plan.diagnostics.candidateDocuments,
      selectedDocuments: plan.diagnostics.selectedDocuments,
      truncated: plan.diagnostics.truncated,
      droppedDocuments: {
        budget: plan.diagnostics.droppedDocuments.budget,
        belowThreshold: plan.diagnostics.droppedDocuments.belowThreshold,
        filtered: plan.diagnostics.droppedDocuments.filtered,
      },
      unmatchedTerms: plan.diagnostics.unmatchedTerms,
      zeroHitReason: plan.diagnostics.zeroHitReason,
    },
    coverage: {
      documentScope: result.coverage.documentScope,
      status: result.coverage.status,
      reviewedDocuments: result.coverage.reviewedDocuments,
      unreviewedDocuments: result.coverage.unreviewedDocuments,
      notIndexedDocuments: result.coverage.notIndexedDocuments,
    },
    staleDocuments: 0,
  };
}
