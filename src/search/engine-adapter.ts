import {
  searchIndexedVault,
  prepareCurrentEvidenceSource,
  resolveCurrentIndexedPassage,
  distinctCurrentSourceIds,
  type IndexedEvidenceCandidate,
  type IndexedEvidenceInventory,
  type IndexedEvidenceItem,
  type IndexedMatchCount,
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
import { summarizeIndexedConfidence } from './confidence';
import type { IndexedSearchPlan } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import type { SourceMetadata } from '../rag/source-access';
import type { LiteralInventoryHandle } from '../rag/literal-inventory';

import type { RankFollowup } from '../agent/facet-retrieval';

export interface IndexedSearchSource {
  rankFollowup?: RankFollowup;
  literalQuery?: string;
  openLiteralInventory?: (needles: readonly string[], signal?: AbortSignal, allowedPaths?: readonly string[]) => Promise<LiteralInventoryHandle>;
  release?: () => void | Promise<void>;
  isCurrent?: () => boolean;
  corpus: IndexedVaultCorpus;
  getIndexedPaths(): Promise<readonly string[]>;
  /** exhaustive BM25가 성공했을 때 실제 본문을 검증할 후보 경로입니다. */
  reviewPaths?: readonly string[];
  /** 전체 색인 lexical 검토 성공 여부입니다. 생략하면 부분 후보 검토로 취급합니다. */
  exhaustiveReview?: boolean;
  /** 근거 선택에 쓰는 순위 prior입니다. 전체 발견 단서와 검토 범위를 뜻하지 않습니다. */
  candidates?: readonly (IndexedEvidenceCandidate & { queryIndex?: number })[];
  /** 검토 예산으로 자르기 전의 조사 단서입니다. 원문 근거가 아니며 외부에 직접 전달하지 않습니다. */
  discoveryCandidates?: readonly IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
  /** 엔진이 센 색인 전체 일치 집계입니다. 순위·후보 선발에는 쓰지 않습니다. */
  matchInventory?: readonly IndexedMatchCount[];
  candidatesState?: SearchCandidateState;
  scopes?: readonly string[];
  searchPlan?: IndexedSearchPlan;
  queryVariants?: readonly string[];
  /** 색인 리비전과 현재 vault 리비전(mtime:size)을 대조하는 reader. 없으면 결과를 verified로 표시하지 않는다. */
  revisionReader?: (path: string) => Promise<string | null>;
  /** 답변 전에 채택 문서의 현재 원문을 다시 읽는 로컬 vault reader. */
  sourceReader?: (path: string, signal?: AbortSignal) => Promise<IndexedEvidenceSourceSnapshot>;
  /** true는 reader 없는 검증도 실패 폐쇄합니다. false는 명시적인 legacy revision-only 경로입니다. */
  verifyCurrentSource?: boolean;
}

/** 현재 vault 원문과 그 revision입니다. 읽을 수 없으면 두 값 모두 null입니다. */
export interface IndexedEvidenceSourceSnapshot {
  failure?: 'changed-during-read' | 'read-failed';
  sourceMetadata?: SourceMetadata;
  revision: string | null;
  text: string | null;
  contentHash?: string;
  /** 원문을 색인과 같은 청킹 규칙으로 다시 나눈 검증 구간입니다. */
  chunks?: readonly { text: string; startLine: number; endLine: number }[];
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
    if (candidatesState === 'indexing') {
      return createPendingSearchResponse(candidatesState, source.inventory);
    }
    const { revisionReader } = source;
    // 현재 원문 리비전을 확인할 수 없으면 색인 사본을 verified 결과로 내보내지 않는다.
    if (!revisionReader || (source.verifyCurrentSource === true && !source.sourceReader)) return null;
    request.signal?.throwIfAborted();
    const hasFilters = request.filters !== undefined;
    const indexedPaths = hasFilters
      ? await source.getIndexedPaths()
      : (source.reviewPaths ?? (await source.getIndexedPaths()));
    const exhaustiveReview = hasFilters ? false : source.exhaustiveReview === true;
    const searchStarted = performance.now();
    const result = await search({
      question: request.query,
      queryVariants: source.queryVariants,
      indexedPaths,
      scopes: source.scopes ?? [],
      corpus: source.corpus,
      candidates: source.candidates,
      documentScope: 'all',
      exhaustiveReview,
      inventory: source.inventory,
      filters: request.filters,
      signal: request.signal,
    });
    const searchMs = performance.now() - searchStarted;
    if (!result) return null;
    appLogger.debug('Indexed search engine evidence ready.', {
      source: 'search.evidence',
      data: {
        indexedPaths: indexedPaths.length,
        engineEvidence: result.evidence.length,
        engineDocuments: new Set(result.evidence.map((item) => item.path)).size,
      },
    });
    const revisionStarted = performance.now();
    const revision = await keepCurrentRevision(result.evidence, revisionReader);
    const revisionMs = performance.now() - revisionStarted;
    const sourceStarted = performance.now();
    const current = source.verifyCurrentSource === false
      ? { evidence: revision.evidence, staleDocuments: 0, incomplete: false }
      : source.sourceReader
      ? await keepCurrentSourceEvidence(
          revision.evidence,
          source.sourceReader,
          request.signal,
          source.verifyCurrentSource === true,
        )
      : { evidence: revision.evidence, staleDocuments: 0, incomplete: false };
    const sourceMs = performance.now() - sourceStarted;
    const response = toSearchResponse({ ...result, evidence: current.evidence });
    response.staleDocuments = revision.staleDocuments + current.staleDocuments;
    appLogger.debug('Indexed search current-source verification finished.', {
      source: 'search.evidence',
      data: {
        currentEvidence: current.evidence.length,
        staleDocuments: response.staleDocuments,
        searchMs,
        revisionMs,
        sourceMs,
      },
    });
    response.diagnostics.selectedDocuments = new Set(
      current.evidence.map((item) => item.path),
    ).size;
    if ((response.staleDocuments > 0 || current.incomplete) && response.coverage.status === 'supported') {
      response.coverage.status = 'incomplete';
    }
    return response;
  };
}

/** 현재 원문·절대 행·revision 경계를 확인합니다. */
async function keepCurrentSourceEvidence(
  evidence: readonly IndexedEvidenceItem[],
  reader: NonNullable<IndexedSearchSource['sourceReader']>,
  signal?: AbortSignal,
  strict = false,
): Promise<{ evidence: readonly IndexedEvidenceItem[]; staleDocuments: number; incomplete?: boolean }> {
  if (evidence.length === 0) return { evidence, staleDocuments: 0 };
  const paths = [...new Set(evidence.map((item) => item.path))];
  const snapshots = await Promise.all(
    paths.map(async (path) => {
      signal?.throwIfAborted();
      try {
        const snapshot = await reader(path, signal);
        return [path, (!strict || snapshot.contentHash) ? prepareCurrentEvidenceSource(snapshot) : null] as const;
      } catch (error) {
        if (signal?.aborted) throw error;
        return [path, null] as const;
      }
    }),
  );
  const byPath = new Map(snapshots);
  const rejectedPaths = new Set<string>();
  const current = evidence.flatMap((item) => {
    const snapshot = byPath.get(item.path);
    const current = snapshot && resolveCurrentIndexedPassage(item, snapshot);
    if (!current) {
      rejectedPaths.add(item.path);
      return [];
    }
    return [current];
  });
  return {
    evidence: distinctCurrentSourceIds(current),
    staleDocuments: rejectedPaths.size,
    incomplete: snapshots.some(([, snapshot]) => snapshot?.sourceMetadata?.completeness?.status === 'partial'),
  };
}

function createPendingSearchResponse(
  state: 'indexing',
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
      documentScope: 'all',
      status: 'incomplete',
      reviewedDocuments: 0,
      unreviewedDocuments: inventory?.unreviewedCount ?? indexedCount,
      notIndexedDocuments: inventory?.notIndexedCount ?? 0,
    },
    staleDocuments: 0,
    confidence: 'low',
    alternativeInterpretations: [],
  };
}

/** 채택 문서를 현재 vault 리비전과 대조하고, 확인되지 않은 구절은 제외한다. */
async function keepCurrentRevision(
  evidence: readonly IndexedEvidenceItem[],
  revisionReader: (path: string) => Promise<string | null>,
): Promise<{ evidence: readonly IndexedEvidenceItem[]; staleDocuments: number; incomplete?: boolean }> {
  const currentByPath = new Map<string, string | null>();
  await Promise.all(
    [...new Set(evidence.map((item) => item.path))].map(async (path) => {
      try {
        currentByPath.set(path, await revisionReader(path));
      } catch {
        currentByPath.set(path, null);
      }
    }),
  );
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
  const confidence = summarizeIndexedConfidence(result.evidence);
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
    confidence: confidence.confidence,
    alternativeInterpretations: confidence.alternatives,
  };
}
