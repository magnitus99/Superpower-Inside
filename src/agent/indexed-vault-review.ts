import { t } from '../i18n';
import type { ChatMessage, LLMProvider, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  createContentHashRust,
  hasVaultInventoryIntentRust,
  mergeIndexedEvidencePlansRust,
  pageIndexedDiscoveryRust,
  scopeIndexedDiscoveryRust,
  planIndexedEvidenceRust,
  planIndexedReviewAnswerPlanRust,
  planModelContextRust,
  planTurnUsageRust,
  renderIndexedReviewAnswerRust,
  validateIndexedReviewAnswerRust,
  verifyIndexedEvidenceRust,
  type IndexedSearchPlan,
  type RustIndexedDiscoveryPage,
  type RustIndexedDiscoverySummary,
  type RustIndexedEvidenceBudget,
  type RustIndexedEvidenceCoverage,
  type RustIndexedEvidenceDocument,
  type RustIndexedEvidenceFilters,
  type RustIndexedEvidenceMergeResult,
  type RustIndexedEvidencePassage,
  type RustIndexedEvidencePlan,
  type RustIndexedEvidenceStatus,
  type RustIndexedEvidenceVerificationDocument,
  type RustIndexedReviewAnswerPlan,
  type RustIndexedReviewAnswerFailureReason,
} from '../rag/rust-core';
import type { FileIndexRecord, VectorEntry } from '../rag/store';
import type { SourceMetadata } from '../rag/source-access';
import type { SourceCitation, TurnUsageSnapshot } from '../chat/types';
import type { IndexedEvidenceSourceSnapshot } from '../search/engine-adapter';
import type { SearchCandidateState } from '../search/engine-port';
import { appLogger } from '../utils/logger';
import { selectAnswerCitations } from './citation-selection';
import { coversFacet, facetQueryVariants, findCurrentFacetPassages, type CurrentFacetScanCounts } from './current-facet-search';
import { answerBindings, decodeAnswerBindings } from './answer-bindings';
import { roundRobinPaths, type RankFollowup } from './facet-retrieval';
import { CurrentSourceWindows } from './current-source-windows';
import { searchIndexedFollowup, type FollowupFailure } from './indexed-vault-followup';
import { enumerateIndexedDocuments } from './indexed-vault-enumeration';
import type { VaultResearchProgress } from './research-agent';
import { prepareLiteralReview, type IndexedLiteralInventory, type LiteralReviewPreparation } from './literal-review';
import type { LiteralInventoryHandle, LiteralInventoryPage } from '../rag/literal-inventory';

/** 색인 본문·리비전만으로 근거를 선별하는 엔진 연결(provider 미사용)입니다. */
export type IndexedEvidenceItem = RustIndexedEvidencePassage & { adjacentTo?: string };
export type IndexedEvidencePlan = RustIndexedEvidencePlan;
export type IndexedEvidenceStatus = RustIndexedEvidenceStatus;
export type IndexedEvidenceBudget = RustIndexedEvidenceBudget;

/** 하이브리드 검색이 지목한 후보와 점수입니다. 순위 병합은 엔진이 결정합니다. */
export interface IndexedEvidenceCandidate {
  path: string;
  /** 엔진 입력과 같은 1 기반 줄 번호입니다. */
  startLine?: number;
  endLine?: number;
  score: number;
  source: 'bm25' | 'lexical' | 'vector' | 'ann' | 'structural';
  rank: number;
  queryIndex?: number;
}

/** 색인 전체 규모(이번 배치 밖 미검토 포함)를 엔진에 알리는 계약입니다. */
export interface IndexedEvidenceInventory {
  indexedCount: number;
  unreviewedCount: number;
  notIndexedCount: number;
}

/**
 * 엔진이 색인 전체에서 센 질의 핵심어 하나의 일치 집계입니다.
 * 점수·순위가 아니라 답변이 수치로 인용할 인벤토리이며, `documents`는 상위 경로만 담고
 * 총계는 색인 전체 기준입니다.
 */
export interface IndexedMatchCount {
  /** 집계한 정확 term 또는 구문입니다. */
  query: string;
  totalDocuments: number;
  totalChunks: number;
  totalOccurrences: number;
  /** 발생 횟수가 많은 상위 경로입니다. */
  documents: readonly { sourcePath: string; occurrences: number }[];
}

/** 색인 저장소의 본문·리비전 조회 계약입니다. */
export interface IndexedVaultCorpus {
  getEntriesByFilePaths(paths: readonly string[]): Promise<readonly VectorEntry[]>;
  getFileIndexRecords(): Promise<readonly FileIndexRecord[]>;
}

export type IndexedVaultDocumentScope = 'all' | 'candidates';

export interface IndexedVaultSearchOptions {
  question: string;
  queryVariants?: readonly string[];
  /** 번역 변형과 달리 각각 대표 근거를 보존할 독립 후속 질의입니다. */
  queryFacets?: readonly string[];
  indexedPaths: readonly string[];
  scopes: readonly string[];
  corpus: IndexedVaultCorpus;
  /** 후보는 검토 범위가 아니라 순위 prior이며 기본 검토는 전체 색인을 대상으로 합니다. */
  documentScope?: IndexedVaultDocumentScope;
  candidates?: readonly IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
  exhaustiveReview?: boolean;
  filters?: RustIndexedEvidenceFilters;
  budget?: IndexedEvidenceBudget;
  signal?: AbortSignal;
}

export interface IndexedVaultSearchCoverage extends RustIndexedEvidenceCoverage {
  documentScope: IndexedVaultDocumentScope;
  requestedPaths: readonly string[];
  plannedPaths: readonly string[];
  unreviewedPaths: readonly string[];
}

export interface IndexedVaultSearchResult {
  sourceDocuments?: Readonly<Record<string, SourceMetadata>>;
  plan: IndexedEvidencePlan;
  /** 구절·위치·리비전·스코프 검증을 통과한 근거만 담습니다. */
  evidence: readonly IndexedEvidenceItem[];
  rejected: readonly IndexedEvidenceStatus[];
  coverage: IndexedVaultSearchCoverage;
  scannedDocuments: number;
  scannedPaths: number;
}

const DEFAULT_EVIDENCE_BUDGET: Required<IndexedEvidenceBudget> = {
  maxDocuments: 64,
  maxPassages: 24,
  maxChars: 262_144,
};

/** 기본값을 채운 실제 근거 예산입니다. 엔진 계획과 전역 병합에 같은 값을 씁니다. */
function resolveEvidenceBudget(
  budget: IndexedEvidenceBudget | undefined,
): Required<IndexedEvidenceBudget> {
  return { ...DEFAULT_EVIDENCE_BUDGET, ...budget };
}

/**
 * 코퍼스 청크 메타데이터를 엔진 plan 입력 문서로 옮깁니다.
 * 줄 번호는 청킹 경계에서 이미 1 기반으로 변환되어 그대로 씁니다.
 */
function planDocument(
  metadata: VectorEntry['metadata'],
  revision: string,
): RustIndexedEvidenceDocument {
  const heading = metadata.heading;
  const modifiedAt = metadata.sourceMtime;
  return {
    path: metadata.filePath,
    revision,
    indexed: true,
    reviewState: 'reviewed',
    text: metadata.text,
    startLine: metadata.startLine,
    ...(metadata.title !== undefined ? { title: metadata.title } : {}),
    ...(metadata.tags !== undefined ? { tags: metadata.tags } : {}),
    ...(metadata.aliases !== undefined && metadata.aliases.length > 0
      ? { aliases: metadata.aliases }
      : {}),
    ...(metadata.headings !== undefined
      ? { headings: metadata.headings }
      : heading
        ? { headings: [heading] }
        : {}),
    ...(typeof modifiedAt === 'number' && Number.isSafeInteger(modifiedAt) && modifiedAt >= 0
      ? { modifiedAt }
      : {}),
  };
}

/**
 * 원문 변경 복구 계획에도 기본 후보와 discovery 추가 검토에서 고른 후보를 함께 넘깁니다.
 * 복구 대상 문서의 경로만 남기고 같은 경로·신호·순위·facet 후보는 한 번만 전달합니다.
 */
function recoveryCandidatePool(
  base: readonly IndexedEvidenceCandidate[] | undefined,
  inspected: readonly IndexedEvidenceCandidate[],
  documents: readonly RustIndexedEvidenceDocument[],
): IndexedEvidenceCandidate[] | undefined {
  const paths = new Set(documents.map((document) => document.path));
  const merged = new Map<string, IndexedEvidenceCandidate>();
  for (const candidate of [...(base ?? []), ...inspected]) {
    if (!paths.has(candidate.path)) continue;
    const key = [
      candidate.path,
      candidate.source,
      candidate.rank,
      candidate.queryIndex ?? '',
    ].join('\u0000');
    if (!merged.has(key)) merged.set(key, candidate);
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}

const EVIDENCE_PATH_BATCH = 256;
/** 검토 예산 밖 discovery 페이지에서 추가로 원문 검토할 경로 상한입니다. */
const MAX_DISCOVERY_INSPECTIONS = 8;
/** 미검토 경로를 찾기 위해 넘길 discovery 페이지 상한입니다. */
const MAX_DISCOVERY_INSPECTION_PAGES = 8;

/** 색인 경로 순서를 유지하면서 후보에 포함된 경로만 중복 없이 고릅니다. */
function candidateScopedPaths(
  indexedPaths: readonly string[],
  candidates: readonly IndexedEvidenceCandidate[] | undefined,
): string[] {
  const candidatePaths = new Set(candidates?.map((candidate) => candidate.path) ?? []);
  const seen = new Set<string>();
  return indexedPaths.filter((path) => {
    if (!candidatePaths.has(path) || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

interface IndexedEvidenceEngineInput {
  question: string;
  queryVariants?: readonly string[];
  queryFacets?: readonly string[];
  documents: RustIndexedEvidenceDocument[];
  scopes: string[];
  filters?: RustIndexedEvidenceFilters;
  budget: IndexedEvidenceBudget;
  candidates?: IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
}

function evidenceRevision(record: FileIndexRecord | undefined, entry: VectorEntry): string | null {
  if (!record) return null;
  // 청크 자신의 해시가 없거나 파일 인덱스와 어긋나면 오래된 본문으로 보고 제외합니다.
  const chunkHash = entry.metadata.contentHash;
  if (!chunkHash) return null;
  if (!record.contentHash || record.contentHash !== chunkHash) return null;
  // 해시와 파일 mtime·size는 비교 영역이 다르므로 원문 대조는 sourceMtime:sourceSize로만 합니다.
  if (record.sourceMtime === undefined || record.sourceSize === undefined) return null;
  if (
    (entry.metadata.sourceMtime !== undefined &&
      entry.metadata.sourceMtime !== record.sourceMtime) ||
    (entry.metadata.sourceSize !== undefined && entry.metadata.sourceSize !== record.sourceSize)
  )
    return null;
  return record.sourceMtime + ':' + record.sourceSize;
}

const RUST_INPUT_MAX_DOCUMENTS = 4096;
const RUST_INPUT_MAX_BYTES = 8 * 1024 * 1024;
const RUST_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
const VERIFICATION_WINDOW_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

/** payload 상한(문서 수·바이트)에 맞춰 자르고, 단독으로 상한을 넘는 청크는 미검토로 분리합니다. */
function partitionEvidencePayloads(
  documents: readonly RustIndexedEvidenceDocument[],
  oversizePaths: Set<string>,
  envelopeBytes: number,
): RustIndexedEvidenceDocument[][] {
  const batches: RustIndexedEvidenceDocument[][] = [];
  let current: RustIndexedEvidenceDocument[] = [];
  let bytes = envelopeBytes;
  for (const document of documents) {
    if (document.text.length > RUST_DOCUMENT_MAX_BYTES || encoder.encode(document.text).byteLength > RUST_DOCUMENT_MAX_BYTES) {
      oversizePaths.add(document.path);
      continue;
    }
    const size = encoder.encode(JSON.stringify(document)).byteLength + 1;
    if (envelopeBytes + size > RUST_INPUT_MAX_BYTES) {
      oversizePaths.add(document.path);
      continue;
    }
    if (
      current.length > 0 &&
      (current.length >= RUST_INPUT_MAX_DOCUMENTS || bytes + size > RUST_INPUT_MAX_BYTES)
    ) {
      batches.push(current);
      current = [];
      bytes = envelopeBytes;
    }
    current.push(document);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** 병합 결과에서 원래 근거 행을 대조하는 키입니다(점수 비교가 아니라 같은 행 식별용). */
function evidenceRowKey(item: IndexedEvidenceItem): string {
  return `${item.path}\u0000${item.startLine}\u0000${item.endLine}\u0000${item.quote}`;
}

/**
 * 엔진 전역 병합 결과를 계획 계약으로 옮깁니다.
 * 순위·선택 수·예산·coverage·truncated는 엔진 값을 그대로 쓰고, 병합 API가 돌려주지 않는
 * 배치 진단(후보 깊이·기계 제외 합계·미일치 토큰)만 모읍니다.
 */
function mergedEvidencePlan(
  plans: readonly RustIndexedEvidencePlan[],
  merged: RustIndexedEvidenceMergeResult,
  budget: Required<IndexedEvidenceBudget>,
  documentCount: number,
): RustIndexedEvidencePlan | null {
  const first = plans[0];
  if (!first) return null;
  let candidateDepth = 0;
  let candidateDocuments = 0;
  let candidateChunks = 0;
  let belowThreshold = 0;
  let filtered = 0;
  let missingCandidatePaths = 0;
  let zeroHitReason: string | null = null;
  const unmatchedTerms = new Set<string>();
  for (const plan of plans) {
    candidateDepth = Math.max(candidateDepth, plan.diagnostics.candidateDepth);
    candidateDocuments += plan.diagnostics.candidateDocuments;
    candidateChunks += plan.diagnostics.candidateChunks;
    belowThreshold += plan.diagnostics.droppedDocuments.belowThreshold;
    filtered += plan.diagnostics.droppedDocuments.filtered;
    missingCandidatePaths = Math.max(missingCandidatePaths, plan.diagnostics.missingCandidatePaths);
    for (const term of plan.diagnostics.unmatchedTerms) unmatchedTerms.add(term);
    zeroHitReason ??= plan.diagnostics.zeroHitReason;
  }
  return {
    queryTokens: first.queryTokens,
    phrases: first.phrases,
    evidence: merged.evidence,
    order: merged.order,
    coverage: merged.coverage,
    diagnostics: {
      candidateDepth,
      candidateDocuments: Math.min(candidateDocuments, documentCount),
      candidateChunks,
      selectedDocuments: merged.diagnostics.selectedDocuments,
      selectedChunks: merged.diagnostics.selectedChunks,
      truncated: merged.diagnostics.truncated,
      droppedDocuments: {
        budget: merged.diagnostics.budgetDropped,
        belowThreshold,
        filtered,
      },
      unmatchedTerms: [...unmatchedTerms],
      missingCandidatePaths,
      zeroHitReason,
    },
    budget: {
      maxDocuments: budget.maxDocuments,
      maxPassages: merged.budget.maxPassages,
      maxChars: merged.budget.maxChars,
      usedChars: merged.budget.usedChars,
    },
  };
}

/**
 * 기본 검토와 추가 검토(후속 질의·미검토 단서)를 Rust 병합 계약으로 합칩니다.
 * 경로 집계는 실제 I/O 작업의 합집합이며 근거 선택·중복 제거는 엔진이 담당합니다.
 */
function mergeIndexedVaultSearch(
  base: IndexedVaultSearchResult,
  extra: IndexedVaultSearchResult,
  options: { resetFacetAttribution: boolean },
): IndexedVaultSearchResult | null {
  const merged = mergeIndexedEvidencePlansRust({
    plans: [
      { ...base.plan, evidence: base.evidence },
      // 후속 질의의 번호는 원래 비교 facet의 번호가 아니므로 재사용하지 않습니다.
      // 같은 질문·변형으로 다시 검토한 discovery 근거는 원래 facet 귀속을 유지합니다.
      {
        ...extra.plan,
        evidence: options.resetFacetAttribution
          ? extra.evidence.map((item) => ({
              ...item,
              queryIndexes: [],
              preferredQueryIndexes: [],
            }))
          : extra.evidence,
      },
    ],
    budget: {
      maxPassages: base.evidence.length + extra.evidence.length,
      maxChars: base.plan.budget.maxChars + extra.plan.budget.maxChars,
    },
  });
  if (!merged) return null;
  const requestedPaths = [
    ...new Set([...base.coverage.requestedPaths, ...extra.coverage.requestedPaths]),
  ];
  const plannedPaths = [
    ...new Set([...base.coverage.plannedPaths, ...extra.coverage.plannedPaths]),
  ];
  // 같은 문서를 다시 계획에 넣은 사실만으로 앞선 부분 읽기 실패를 해소하지 않습니다.
  const unreviewedPaths = [
    ...new Set([...base.coverage.unreviewedPaths, ...extra.coverage.unreviewedPaths]),
  ];
  // 추가 검토가 성공해도 기본 검토에서 남은 미검토·미색인 수를 지우지 않습니다.
  const unreviewedDocuments = Math.max(
    base.coverage.unreviewedDocuments,
    extra.coverage.unreviewedDocuments,
    unreviewedPaths.length,
    merged.coverage.unreviewedDocuments,
  );
  const notIndexedDocuments = Math.max(
    base.coverage.notIndexedDocuments,
    extra.coverage.notIndexedDocuments,
    merged.coverage.notIndexedDocuments,
  );
  const coverage: IndexedVaultSearchCoverage = {
    ...base.coverage,
    status:
      unreviewedDocuments > 0 ||
      merged.coverage.status === 'incomplete' ||
      (base.coverage.documentScope === 'all' && notIndexedDocuments > 0)
        ? 'incomplete'
        : merged.coverage.status,
    requestedPaths,
    plannedPaths,
    unreviewedPaths,
    reviewedDocuments: plannedPaths.filter((path) => !unreviewedPaths.includes(path)).length,
    unreviewedDocuments,
    notIndexedDocuments,
  };
  return {
    ...base,
    plan: {
      ...base.plan,
      evidence: merged.evidence,
      order: merged.order,
      budget: { ...base.plan.budget, ...merged.budget },
      diagnostics: {
        ...base.plan.diagnostics,
        selectedDocuments: merged.diagnostics.selectedDocuments,
        selectedChunks: merged.diagnostics.selectedChunks,
        truncated:
          base.plan.diagnostics.truncated ||
          extra.plan.diagnostics.truncated ||
          merged.diagnostics.truncated,
      },
    },
    evidence: merged.evidence,
    rejected: [...base.rejected, ...extra.rejected],
    coverage,
  };
}

/** 색인 본문으로 근거를 선별하고 구절·위치·리비전을 검증합니다. 실패하면 null입니다. */
export async function searchIndexedVault(
  options: IndexedVaultSearchOptions,
): Promise<IndexedVaultSearchResult | null> {
  options.signal?.throwIfAborted();
  const budget = resolveEvidenceBudget(options.budget);
  const documentScope = options.documentScope ?? 'all';
  const exhaustiveReview = options.exhaustiveReview === true;
  const requestedPaths = [
    ...new Set(
      documentScope === 'candidates'
        ? (options.candidates?.map((candidate) => candidate.path) ?? [])
        : options.indexedPaths,
    ),
  ];
  const scopedPaths =
    documentScope === 'candidates'
      ? candidateScopedPaths(options.indexedPaths, options.candidates)
      : requestedPaths;
  // 후보 범위에 읽을 경로가 없으면 저장소 구현이 전체 색인을 재구성하지 않도록 records도 읽지 않습니다.
  let records: readonly FileIndexRecord[] = [];
  try {
    if (scopedPaths.length > 0) records = await options.corpus.getFileIndexRecords();
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    appLogger.warn('Indexed file records unavailable; preserving unreviewed coverage.', {
      source: 'search.corpus',
      error,
    });
  }
  options.signal?.throwIfAborted();
  const byPath = new Map(records.map((record) => [record.filePath, record]));
  const contentHashByPath = new Map(
    records.map((record) => [record.filePath, record.contentHash] as const),
  );
  const indexedPaths = scopedPaths.filter((path) => byPath.has(path));
  const scopeCount =
    documentScope === 'candidates'
      ? requestedPaths.length
      : Math.max(requestedPaths.length, options.inventory?.indexedCount ?? 0);
  const scannedPaths = new Set<string>();
  const oversizePaths = new Set<string>();
  // 청크 해시·원문 리비전이 없어 엔진 입력에서 빠진 경로는 미검토로 남깁니다.
  const unreviewedPaths = new Set(requestedPaths.filter((path) => !byPath.has(path)));
  const inventoryFor = (): IndexedEvidenceInventory => ({
    indexedCount: scopeCount,
    unreviewedCount: Math.max(
      documentScope === 'all' ? (options.inventory?.unreviewedCount ?? 0) : 0,
      unreviewedPaths.size,
    ),
    notIndexedCount: options.inventory?.notIndexedCount ?? 0,
  });
  const plans: RustIndexedEvidencePlan[] = [];
  const statuses: RustIndexedEvidenceStatus[] = [];
  for (let offset = 0; offset < indexedPaths.length; offset += EVIDENCE_PATH_BATCH) {
    options.signal?.throwIfAborted();
    const paths = indexedPaths.slice(offset, offset + EVIDENCE_PATH_BATCH);
    let entries: readonly VectorEntry[];
    try {
      entries = await options.corpus.getEntriesByFilePaths(paths);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      for (const path of paths) unreviewedPaths.add(path);
      appLogger.warn('Indexed chunks unavailable; preserving unreviewed coverage.', {
        source: 'search.corpus',
        error,
      });
      continue;
    }
    options.signal?.throwIfAborted();
    const documents: RustIndexedEvidenceDocument[] = [];
    const validChunks = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (!paths.includes(entry.metadata.filePath)) continue;
      const revision = evidenceRevision(byPath.get(entry.metadata.filePath), entry);
      if (revision === null) {
        unreviewedPaths.add(entry.metadata.filePath);
        continue;
      }
      const ids = validChunks.get(entry.metadata.filePath) ?? new Set<string>();
      ids.add(entry.id);
      validChunks.set(entry.metadata.filePath, ids);
      documents.push(planDocument(entry.metadata, revision));
    }
    for (const path of paths) {
      if (
        (validChunks.get(path)?.size ?? 0) !== byPath.get(path)?.vectorCount ||
        !validChunks.has(path)
      ) {
        unreviewedPaths.add(path);
      }
    }
    // payload 상한을 넘는 구간만 잘라 보내고, 상한 초과 단일 청크는 미검토로 남깁니다.
    // 검증 요청은 같은 본문에 인용문을 더하므로 JSON 이스케이프 최악 크기도 예약합니다.
    const longestPathBytes = Math.max(0, ...paths.map((path) => encoder.encode(path).byteLength));
    const verificationBytes =
      budget.maxChars * 6 + budget.maxPassages * (longestPathBytes * 4 + 256);
    const envelopeBytes =
      verificationBytes +
      encoder.encode(
        JSON.stringify({
          question: options.question,
          queryVariants: options.queryVariants,
          queryFacets: options.queryFacets,
          documents: [],
          scopes: options.scopes,
          filters: options.filters,
          budget,
          candidates: options.candidates,
          inventory: inventoryFor(),
        }),
      ).byteLength +
      256;
    const batches = partitionEvidencePayloads(documents, oversizePaths, envelopeBytes);
    for (const path of oversizePaths) unreviewedPaths.add(path);
    for (const batch of batches) {
      options.signal?.throwIfAborted();
      const engineInput: IndexedEvidenceEngineInput = {
        question: options.question,
        queryVariants: options.queryVariants,
        queryFacets: options.queryFacets,
        documents: batch,
        scopes: [...options.scopes],
        filters: options.filters,
        budget,
        candidates: options.candidates ? [...options.candidates] : undefined,
        inventory: inventoryFor(),
      };
      const plan = planIndexedEvidenceRust(engineInput);
      if (!plan) return null;
      const verification = verifyIndexedEvidenceRust({
        evidence: plan.evidence.map((item) => ({
          sourceId: item.sourceId,
          path: item.path,
          revision: item.revision ?? undefined,
          startLine: item.startLine,
          endLine: item.endLine,
          quote: item.quote,
        })),
        documents: batch,
        scopes: [...options.scopes],
      });
      if (!verification) return null;
      for (const document of batch) scannedPaths.add(document.path);
      plans.push(plan);
      statuses.push(...verification.statuses);
    }
  }
  for (const path of requestedPaths) {
    if (!scannedPaths.has(path)) unreviewedPaths.add(path);
  }
  if (plans.length === 0) {
    const engineInput: IndexedEvidenceEngineInput = {
      question: options.question,
      queryVariants: options.queryVariants,
      queryFacets: options.queryFacets,
      documents: [],
      scopes: [...options.scopes],
      filters: options.filters,
      budget,
      candidates: options.candidates ? [...options.candidates] : undefined,
      inventory: inventoryFor(),
    };
    const plan = planIndexedEvidenceRust(engineInput);
    if (!plan) return null;
    const verification = verifyIndexedEvidenceRust({
      evidence: [],
      documents: [],
      scopes: [...options.scopes],
    });
    if (!verification) return null;
    plans.push(plan);
    statuses.push(...verification.statuses);
  }
  const bySource = new Map(statuses.map((status) => [status.sourceId, status]));
  // 근거 자격은 엔진 검증이 정하고, 전역 순위·중복 제거·예산 절단은 엔진 병합이 정합니다.
  const mergePlans = plans.map((plan) => ({
    ...plan,
    evidence: plan.evidence.filter((item) => bySource.get(item.sourceId)?.status === 'verified'),
  }));
  const merged = mergeIndexedEvidencePlansRust({
    plans: mergePlans,
    budget: { maxPassages: budget.maxPassages, maxChars: budget.maxChars },
  });
  if (!merged) return null;
  const evidenceWithHashes = merged.evidence.map((item) => {
    const contentHash = contentHashByPath.get(item.path);
    return contentHash ? { ...item, contentHash } : item;
  });
  const mergedWithHashes = { ...merged, evidence: evidenceWithHashes };
  const plan = mergedEvidencePlan(plans, mergedWithHashes, budget, scannedPaths.size);
  if (!plan) return null;
  const selected = new Set(plan.evidence.map((item) => evidenceRowKey(item)));
  const rejected: IndexedEvidenceStatus[] = [];
  const reported = new Set<string>();
  for (const batchPlan of plans) {
    for (const item of batchPlan.evidence) {
      if (reported.has(item.sourceId)) continue;
      reported.add(item.sourceId);
      const status = bySource.get(item.sourceId);
      if (!status) continue;
      if (status.status !== 'verified') {
        rejected.push(status);
        continue;
      }
      // 엔진 전역 예산·중복으로 제외된 근거는 out-of-scope가 아니라 미검토로 남깁니다.
      if (!selected.has(evidenceRowKey(item)))
        rejected.push({ ...status, status: 'unreviewed', reviewState: 'unreviewed' });
    }
  }
  const finalInventory = inventoryFor();
  // 발견 범위(전체 lexical 후보·색인 수)와 현재 원문 검토 범위는 다릅니다.
  // exhaustive 발견이어도 실제 원문을 읽은 경로만 검토 완료로 세고, 검토 예산 밖 경로를
  // "미검토"로 부풀리지 않습니다. documentScope all의 비-exhaustive 호출은 전체 범위를
  // 요청했으므로 요청 밖 색인 경로를 미검토 실패로 유지합니다.
  const reviewFailures = Math.max(
    finalInventory.unreviewedCount,
    plan.coverage.unreviewedDocuments,
    unreviewedPaths.size,
  );
  const unreviewedDocuments =
    reviewFailures +
    (documentScope === 'all' && !exhaustiveReview
      ? Math.max(0, scopeCount - requestedPaths.length)
      : 0);
  const notIndexedDocuments = Math.max(
    finalInventory.notIndexedCount,
    plan.coverage.notIndexedDocuments,
  );
  const finalCoverage: RustIndexedEvidenceCoverage = {
    status:
      unreviewedDocuments > 0 || (documentScope === 'all' && notIndexedDocuments > 0) || records.some((record) => requestedPaths.includes(record.filePath) && record.sourceMetadata?.completeness?.status === 'partial')
        ? 'incomplete'
        : plan.coverage.status === 'budget-exhausted'
          ? 'budget-exhausted'
          : 'supported',
    reviewedDocuments: Math.max(0, requestedPaths.length - reviewFailures),
    unreviewedDocuments,
    notIndexedDocuments,
  };
  const resultPlan = { ...plan, coverage: finalCoverage };
  return {
    plan: resultPlan,
    sourceDocuments: Object.fromEntries(records.filter((record) => record.sourceMetadata && plan.evidence.some((item) => item.path === record.filePath)).map((record) => [record.filePath, record.sourceMetadata!])),
    evidence: plan.evidence,
    rejected,
    coverage: {
      ...finalCoverage,
      documentScope,
      requestedPaths,
      plannedPaths: requestedPaths.filter((path) => scannedPaths.has(path)),
      unreviewedPaths: requestedPaths.filter((path) => unreviewedPaths.has(path)),
    },
    scannedDocuments: scannedPaths.size,
    scannedPaths: scannedPaths.size,
  };
}

/** 엔진 채택 근거를 그대로 쓰고 LLM에는 최종 해석만 맡깁니다. */
export type IndexedReviewPhase =
  | 'inventory'
  | 'search'
  | 'map'
  | 'screen'
  | 'extract'
  | 'reduce'
  | 'answer';

export interface IndexedReviewPhaseDiagnostics extends TurnUsageSnapshot {
  durationMs: number;
}

/** Numeric/fixed-code observations, not a verdict on semantic retention. Null = not observed here. */
export interface ReviewStageTrace {
  plan: { facets: number; failedFacets: number } | null;
  retrieval: { candidates: number; discoveryCandidates: number | null; baseSelected: number; baseBudgetDropped: number; maxPassages: number; maxChars: number } | null;
  selectionAndFollowup: { followup: 'skipped' | 'searched' | 'failed'; failure?: FollowupFailure; missingBeforeInspection?: number[]; currentFacetPaths?: number; currentFacetPassages?: number; currentFacetScan?: CurrentFacetScanCounts & {
    missing: number; noCurrentChunks: number; proofRejected: number; policyDropped: number; status: 'started' | 'complete' | 'unavailable';
  }; pages: number; inspected: number; pathLimit: number; pageLimit: number } | null;
  currentSource: { failures: Partial<Record<CurrentFailure, number>>; verified: number; adjacentVerified: number; duplicateNeighbors: number; adjacentBytes: number; adjacentByteLimit: number; adjacentRejected: Partial<Record<CurrentFailure | 'byte-budget' | 'segment-boundary', number>> } | null;
  dossier: { passages: number; distinctQuoteCount?: number; missingFacets: number | null; facetSourceCounts: number[] | null } | null;
  generationAndCorrection: { requests: number; sentPassages: number; inputByteLimit?: number; preparedBytes?: number; citedPositions?: number[]; preparationFailed?: boolean; validationFailures: (RustIndexedReviewAnswerFailureReason | 'validator-unavailable')[] } | null;
  displayAndCitations: null;
}

export interface IndexedReviewDiagnostics {
  stageTrace?: ReviewStageTrace;
  /** 정상 집계는 작업 상세에 두고 경고만 답변 본문에 보존합니다. */
  noticeLevel?: 'detail' | 'warning';
  literalPreparationMs?: number;
  phases: Record<IndexedReviewPhase, IndexedReviewPhaseDiagnostics>;
  counts: {
    candidateSegments: number;
    screenAcceptedSegments: number;
    extractedSegments: number;
    screenRetries: number;
    extractRetries: number;
    splitBatches: number;
    reduceRequests: number;
    cacheHits: number;
    answerCorrectionRequests?: number;
    followupRequests?: number;
    followupDocuments?: number;
    discoveryInspectedDocuments?: number;
    recoveryExcludedSegments?: number;
  };
  /** 최종 리뷰 결과 종류입니다. 디버그 추적에서 답변이 왜 근거만 나왔는지 판단할 때 씁니다. */
  outcome?: IndexedReviewOutcome;
  /** 엔진 선별 단계의 진단입니다. 후보가 0건인 이유를 그대로 보존합니다. */
  search?: IndexedEvidencePlan['diagnostics'] | null;
}

export interface IndexedVaultReviewOptions {
  literalQuery?: string;
  literalInventory?: IndexedLiteralInventory;
  literalInspectionPaths?: readonly string[];
  openLiteralInventory?: (needles: readonly string[], signal?: AbortSignal, allowedPaths?: readonly string[]) => Promise<LiteralInventoryHandle>;
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  corpus?: IndexedVaultCorpus;
  documentScope?: IndexedVaultDocumentScope;
  candidates?: readonly IndexedEvidenceCandidate[];
  candidatesState?: SearchCandidateState;
  inventory?: IndexedEvidenceInventory;
  /** 검토 예산 밖 후보와 수집 시점 허용 경로입니다. 후보는 확정 근거가 아닙니다. */
  discoveryCandidates?: readonly IndexedEvidenceCandidate[];
  discoveryPaths?: readonly string[];
  /** 후속 검색 직전에 현재 접근·제외 정책으로 허용 경로를 다시 읽습니다. */
  rankFollowup?: RankFollowup;
  getFollowupPaths?: () => Promise<readonly string[]>;
  /** 색인 전체 일치 집계입니다. 없으면 집계 수치 없이 근거만으로 답합니다. */
  matchInventory?: readonly IndexedMatchCount[];
  exhaustiveReview?: boolean;
  filters?: RustIndexedEvidenceFilters;
  searchPlan?: IndexedSearchPlan;
  /** 채택 문서의 현재 원문과 revision을 답변 전에 다시 읽는 로컬 vault reader입니다. */
  sourceReader?: (path: string, signal?: AbortSignal) => Promise<IndexedEvidenceSourceSnapshot>;
  /** sourceReader가 없을 때 채택 문서의 현재 vault 리비전만 확인하는 caller 주입 reader입니다. */
  revisionReader?: (path: string) => Promise<string | null>;
  provider: Pick<LLMProvider, 'streamChat' | 'contextBudget'>;
  systemPrompt?: string;
  previousUserQuestions?: readonly string[];
  scoringQuestion?: string;
  queryVariants?: readonly string[];
  deferAnswer?: boolean;
  /** 모델 후속 조사·답변을 모두 금지하며 결정적 발견·정책 재조회·열거는 유지합니다. */
  executionMode?: 'engine-only';
  /** 검색 도중 재색인·corpus refresh가 시작되면 결과를 폐기합니다. */
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
  onAnswer?: (content: string) => void;
  /** provider가 실제 제공한 추론 요약만 전달합니다. 답변 JSON은 검증 후 전달합니다. */
  onReasoning?: (delta: string) => void;
  onDiagnostics?: (diagnostics: IndexedReviewDiagnostics) => void;
}

/** 엔진이 검증한 근거와 범위만 해석 모델에 전달하는 정규 계약입니다. */
export interface IndexedEvidenceDossier {
  literalInventory?: IndexedLiteralInventory;
  sourceDocuments?: Readonly<Record<string, SourceMetadata>>;
  question: string;
  scoringQuestion: string;
  previousUserQuestions: readonly string[];
  queryPlan: Pick<IndexedEvidencePlan, 'queryTokens' | 'phrases'>;
  /**
   * 색인 전체에서 센 정확 term·구문 일치 집계입니다.
   * 질문 핵심어별 일치 문서 수·근거 구간 수·발생 횟수를 그대로 인용하고 점수·순위로 쓰지 않습니다.
   */
  matchInventory?: readonly IndexedMatchCount[];
  documentScope: IndexedVaultDocumentScope;
  /** 발견 범위와 실제 근거 검토를 분리한 집계입니다. 후보 원문이나 인용은 아닙니다. */
  discoverySummary?: RustIndexedDiscoverySummary;
  followup?: { status: 'skipped' | 'searched' | 'failed'; queries?: readonly string[] };
  enumeration?: { content: string; citations: SourceCitation[]; incomplete: boolean };
  evidence: readonly IndexedEvidenceItem[];
  coverage: IndexedVaultSearchCoverage;
  diagnostics: IndexedEvidencePlan['diagnostics'] | null;
  notice: string;
  searchPlan?: IndexedSearchPlan;
  answerPlan?: RustIndexedReviewAnswerPlan;
}

/** 파일·요청 원장은 보존하고 기존 모델 전달용 요약만 투영합니다. */
export function toModelIndexedEvidenceDossier(dossier: IndexedEvidenceDossier) {
  const sourceFacets = new Map<string, string[]>();
  for (const facet of dossier.answerPlan?.facets ?? []) {
    if (facet.status !== 'supported') continue;
    for (const sourceId of facet.sourceIds) {
      const ids = sourceFacets.get(sourceId) ?? [];
      ids.push(facet.id);
      sourceFacets.set(sourceId, ids);
    }
  }
  const supported = dossier.answerPlan?.facets.filter(f => f.status === 'supported' && f.sourceIds.length) ?? [];
  const usingPairs = dossier.answerPlan?.mode === 'comparison';
  const bindings = usingPairs ? answerBindings(dossier.evidence.map(e => e.sourceId), supported) : [];
  const bindingExamples = supported.flatMap(f => {
    const pair = bindings.find(b => b.facetId === f.id);
    return pair ? [{ text: '…', supports: [pair.key] }] : [];
  });
  if (dossier.answerPlan?.synthesisRequired) bindingExamples.push({ text: '…', supports: bindingExamples.flatMap(p => p.supports) });
  const firstQuote = new Map<string, string>();
  return {
    ...dossier,
    ...(dossier.answerPlan ? { paragraphContract: {
      ...(usingPairs ? {
        supportChoices: bindings.filter(b => b.facetId !== null), supplementalChoices: bindings.filter(b => b.facetId === null),
        example: { paragraphs: bindingExamples },
      } : {
        sources: { minItems: 1, maxItems: 8, enum: dossier.evidence.map(e => e.sourceId) },
        covers: { minItems: 1, maxItems: 1, enum: supported.map(f => f.id) },
        example: { paragraphs: supported.map(f => ({ text: '…', sources: [f.sourceIds[0]], covers: [f.id] })) },
      }),
      allowedSourcesByFacet: Object.fromEntries(supported.map(f => [f.id, f.sourceIds])),
    } } : {}),
    // 파일 원장은 호출자에게 보존하되 거대한 셀 원장을 모델 프롬프트에 복제하지 않습니다.
    sourceDocuments: undefined,
    // 색인에서 선택한 인접 문맥/하이라이트는 현재 구절 검증의 대상이 아닙니다.
    evidence: dossier.evidence.map(({ sourceId, path, startLine, endLine, quote, queryIndexes, adjacentTo }) => {
      const sameQuoteAs = firstQuote.get(quote);
      if (!sameQuoteAs) firstQuote.set(quote, sourceId);
      return { sourceId, path, startLine, endLine, ...(sameQuoteAs ? { sameQuoteAs } : { quote }), queryIndexes,
        ...(adjacentTo ? { adjacentTo } : {}), ...(usingPairs ? { supportKeys: bindings.filter(b => b.sourceId === sourceId && b.facetId).map(b => b.key), additionalKey: bindings.find(b => b.sourceId === sourceId && !b.facetId)?.key } : {}), ...(dossier.answerPlan ? { facetIds: sourceFacets.get(sourceId) ?? [] } : {}) };
    }),
    matchInventory: dossier.matchInventory?.map((inventory) => ({
      query: inventory.query,
      totalDocuments: inventory.totalDocuments,
      totalChunks: inventory.totalChunks,
      totalOccurrences: inventory.totalOccurrences,
    })),
    literalInventory: dossier.literalInventory?.status === 'complete' ? {
      matchMode: dossier.literalInventory.summary.matchMode,
      scope: 'indexed-policy-allowed-source-body',
      needles: dossier.literalInventory.summary.needles,
      discoveryPagesReadComplete: dossier.literalInventory.representativePages === dossier.literalInventory.summary.pageCount,
    } : dossier.literalInventory,
    coverage: {
      documentScope: dossier.coverage.documentScope,
      status: dossier.coverage.status,
      reviewedDocuments: dossier.coverage.reviewedDocuments,
      unreviewedDocuments: dossier.coverage.unreviewedDocuments,
      notIndexedDocuments: dossier.coverage.notIndexedDocuments,
    },
  };
}

export type IndexedReviewOutcome =
  | 'answered'
  | 'evidence-only'
  | 'no-evidence'
  | 'engine-unavailable'
  | 'indexing';

export interface IndexedDiscoveryPageRequest {
  /** 후속 호출 시 다시 확인한 현재 허용 경로와 폴더 범위입니다. */
  allowedPaths: readonly string[];
  scopes: readonly string[];
  offset: number;
  limit: number;
  signal?: AbortSignal;
}

export interface IndexedVaultReviewResult {
  readLiteralDiscoveryPage?: (index: number) => Promise<LiteralInventoryPage | null>;
  closeLiteralDiscovery?: () => Promise<void>;
  /** 미검증 단서만 조회합니다. 실제 근거 채택에는 별도의 현재 원문 검증이 필요합니다. */
  readDiscoveryPage?: (request: IndexedDiscoveryPageRequest) => RustIndexedDiscoveryPage | null;
  outcome: IndexedReviewOutcome;
  dossier: IndexedEvidenceDossier;
  evidence: readonly IndexedEvidenceItem[];
  coverage: IndexedVaultSearchCoverage;
  content: string;
  citations: SourceCitation[];
  processedFiles: number;
  totalFiles: number;
  rejectedFiles: number;
  providerTransfer: { sentFiles: number; sentPaths?: string[] };
  coverageNotice: string;
  diagnostics: IndexedReviewDiagnostics;
  engineUnavailable: boolean;
}

/** 원문에 포함된 링크·HTML·이미지·Markdown 구문은 표시용 문자로만 출력합니다. */
function evidenceOnlyContent(evidence: readonly IndexedEvidenceItem[]): string {
  const escape = (value: string): string =>
    value.replace(/[&<>\\`*_{}[\]()#+\-.!|~:$\r]/g, (character) => `&#${character.charCodeAt(0)};`);
  const body =
    t('indexedReviewEvidenceOnly') +
    '\n\n' +
    evidence
      .map(
        (item) =>
          item.quote
            .split('\n')
            .map((line) => `> ${escape(line)}`)
            .join('\n') +
          `\n\n- ${escape(item.path).replaceAll('\n', ' ')} (L${item.startLine}–L${item.endLine})`,
      )
      .join('\n\n');
  return body;
}

/** 동적 facet label은 Markdown·HTML 제어문자를 표시용 엔티티로 바꿉니다. */
function plainFacetLabel(label: string): string {
  return label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[&<>\\`*_{}[\]()#+\-.!|~:$]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function facetLabels(
  facetIds: readonly string[],
  plan: IndexedSearchPlan | RustIndexedReviewAnswerPlan | undefined,
): string {
  return facetIds
    .map((id) => {
      const facet = plan?.facets.find((item) => item.id === id);
      const label = facet ? ('label' in facet ? facet.label : facet.query) : id;
      return plainFacetLabel(label);
    })
    .join(', ');
}

/** 비교 검색·답변 계획의 미확인 한계를 기존 coverage와 분리해 만듭니다. */
function comparisonLimitNotice(
  searchPlan: IndexedSearchPlan | undefined,
  answerPlan: RustIndexedReviewAnswerPlan | undefined,
): string {
  if (searchPlan?.mode !== 'comparison') return '';
  const notices: string[] = [];
  if (answerPlan && answerPlan.missingFacetIds.length > 0) {
    notices.push(
      t('indexedReviewComparisonMissing', {
        facets: facetLabels(answerPlan.missingFacetIds, answerPlan),
      }),
    );
  }
  if ((searchPlan.failedFacetIds?.length ?? 0) > 0) {
    notices.push(
      t('indexedReviewComparisonSearchFailed', {
        facets: facetLabels(searchPlan.failedFacetIds ?? [], searchPlan),
      }),
    );
  }
  return notices.join('\n\n');
}

/** 현재 원문 전체가 아니라 인용 주변의 절대 행 구간만 verifier에 넘깁니다. */
function verificationWindow(
  item: IndexedEvidenceItem,
  source: CurrentEvidenceSource,
): RustIndexedEvidenceVerificationDocument | null {
  let start = Math.max(1, item.startLine - 3);
  let text = source.windows.rows(start, item.endLine + 3, VERIFICATION_WINDOW_BYTES);
  if (text == null || encoder.encode(text).byteLength > VERIFICATION_WINDOW_BYTES) {
    start = item.startLine;
    text = source.windows.rows(start, item.endLine, VERIFICATION_WINDOW_BYTES);
    if (text == null || encoder.encode(text).byteLength > VERIFICATION_WINDOW_BYTES) return null;
  }
  return {
    path: item.path,
    text,
    startLine: start,
    revision: source.revision,
    indexed: true,
    reviewState: 'reviewed',
  };
}

/** 서로 다른 기존 ID가 같은 원문 주소로 이동해도 인라인 마커와 인용은 일대일로 유지합니다. */
export function distinctCurrentSourceIds(items: readonly IndexedEvidenceItem[]): IndexedEvidenceItem[] {
  const reserved = new Set(items.map(item => item.sourceId));
  const used = new Set<string>();
  return items.map(item => {
    if (!used.has(item.sourceId)) {
      used.add(item.sourceId);
      return item;
    }
    let ordinal = 2;
    while (reserved.has(`${item.sourceId}#${ordinal}`)) ordinal++;
    const sourceId = `${item.sourceId}#${ordinal}`;
    reserved.add(sourceId);
    return { ...item, sourceId };
  });
}

type CurrentEvidenceSource = IndexedEvidenceSourceSnapshot & { revision: string; text: string; contentHash: string; windows: CurrentSourceWindows };

type CurrentFailure = Exclude<IndexedEvidenceStatus['status'], 'verified'> | 'body-unavailable' | NonNullable<IndexedEvidenceSourceSnapshot['failure']> | 'hash-unavailable' | 'chunk-boundary' | 'verifier-unavailable' | 'verification-budget';

/** 현재 문서당 한 번만 원문 hash를 확정합니다. 색인·복구 후보의 hash는 사용하지 않습니다. */
export function prepareCurrentEvidenceSource(snapshot: IndexedEvidenceSourceSnapshot): CurrentEvidenceSource | null {
  const { revision, text } = snapshot;
  if (revision === null || text === null) return null;
  const contentHash = snapshot.contentHash || createContentHashRust(text);
  return contentHash ? { ...snapshot, revision, text, contentHash, windows: new CurrentSourceWindows(text) } : null;
}

/** 청크는 인용 가능 범위만 제한하고 절대 행은 현재 원문으로 확인합니다. */
export function resolveCurrentIndexedPassage(
  item: IndexedEvidenceItem,
  snapshot: CurrentEvidenceSource,
  scopes: readonly string[] = [],
  relocate = true,
  onFailure?: (reason: CurrentFailure) => void,
): IndexedEvidenceItem | null {
  const reject = (reason: CurrentFailure): null => { onFailure?.(reason); return null; };
  const { revision, text, chunks, contentHash } = snapshot;
  if (chunks?.length === 0) return reject('chunk-boundary');
  const eligible = (candidate: IndexedEvidenceItem) => !chunks || chunks.some(chunk =>
    chunk.startLine <= candidate.startLine && chunk.endLine >= candidate.endLine && chunk.text.includes(candidate.quote));
  const verify = (candidate: IndexedEvidenceItem, document: RustIndexedEvidenceVerificationDocument) => {
    const evidence = [{ sourceId: candidate.sourceId, path: candidate.path, quote: candidate.quote,
      revision: candidate.revision ?? undefined, startLine: candidate.startLine, endLine: candidate.endLine }];
    return verifyIndexedEvidenceRust({ evidence, documents: [document], scopes })?.statuses.find(status => status.sourceId === candidate.sourceId);
  };
  const window = revision === item.revision && verificationWindow(item, snapshot);
  const local = window && eligible(item) ? verify(item, window) : undefined;
  if (local?.status === 'verified') return { ...item, revision, contentHash };
  if (!relocate) return reject(local?.status ?? (!eligible(item) ? 'chunk-boundary' : 'verifier-unavailable'));
  // 창 바깥에 같은 구절이 있을 수 있으므로 일부 원문만 보고 주소를 옮기지 않습니다.
  // 큰 본문은 직렬화하지 않는다. 전체에서 유일한 실제 원문 slice만 Rust 주소 제안에 넘긴다.
  const large = text.length > RUST_DOCUMENT_MAX_BYTES / 3;
  if (item.quote.length > VERIFICATION_WINDOW_BYTES || encoder.encode(item.quote).byteLength > VERIFICATION_WINDOW_BYTES) return reject('verification-budget');
  const slice = large ? snapshot.windows.uniqueWindow(item.quote) : { text, startLine: 1 };
  if (typeof slice === 'string') return reject(slice);
  const document = { path: item.path, ...slice, revision, indexed: true, reviewState: 'reviewed' as const };
  const full = verify(item, document);
  if (large && full?.status === 'verified' && item.revision === revision) {
    return eligible(item) ? { ...item, revision, contentHash } : reject('chunk-boundary');
  }
  const address = full?.relocation;
  if (!address) return reject(full?.status === 'verified' ? (!eligible(item) ? 'chunk-boundary' : window ? 'verifier-unavailable' : 'verification-budget') : full?.status ?? 'verifier-unavailable');
  const sourceId = `${item.path}#L${address.startLine}-L${address.endLine}`;
  const moved = { ...item, ...address, sourceId, contextBefore: '', contextAfter: '' };
  const corrected = verificationWindow(moved, snapshot) ?? (large ? document : null);
  if (!eligible(moved)) return reject('chunk-boundary');
  if (!corrected) return reject('verification-budget');
  const status = verify(moved, corrected)?.status;
  return status === 'verified' ? { ...moved, revision, contentHash } : reject(status ?? 'verifier-unavailable');
}

const ADJACENT_BYTE_LIMIT = 4096;

/** Only whole, individually verified current lines. Adjacency is not proof of facet support. */
function currentNeighbors(anchors: readonly IndexedEvidenceItem[], sources: ReadonlyMap<string, CurrentEvidenceSource>,
  scopes: readonly string[], trace: NonNullable<ReviewStageTrace['currentSource']>): IndexedEvidenceItem[] {
  const extra: IndexedEvidenceItem[] = [];
  const limit = Math.min(8, 64 - anchors.length); // Rust answer-plan source limit
  const reject = (reason: keyof typeof trace.adjacentRejected) => {
    trace.adjacentRejected[reason] = (trace.adjacentRejected[reason] ?? 0) + 1;
  };
  const seen = new Set(anchors.flatMap(item => item.quote.split('\n').map(line => line.trim())));
  for (const anchor of anchors) {
    if (extra.length >= limit) break;
    const source = sources.get(anchor.path);
    if (!source?.chunks?.length) continue;
    for (const line of [anchor.endLine + 1, anchor.startLine - 1]) {
      if (extra.length >= limit) break;
      const row = source.windows.rows(line, line, ADJACENT_BYTE_LIMIT + 1);
      if (row === null) { reject('byte-budget'); continue; }
      const quote = row?.replace(/\n$/, '');
      if (!quote?.trim()) continue;
      if (quote.length > ADJACENT_BYTE_LIMIT) { reject('byte-budget'); continue; }
      const size = encoder.encode(quote).byteLength;
      if (size + trace.adjacentBytes > ADJACENT_BYTE_LIMIT) { reject('byte-budget'); continue; }
      if (seen.has(quote.trim())) { trace.duplicateNeighbors++; continue; }
      const start = Math.min(line, anchor.startLine), end = Math.max(line, anchor.endLine);
      const segments = source.sourceMetadata?.segments;
      if (segments?.length && !segments.some(segment => segment.startLine < start && segment.endLine >= end - 1)) { reject('segment-boundary'); continue; }
      // resolveCurrentIndexedPassage still requires the new quote in a current chunk at this address.
      const candidate: IndexedEvidenceItem = { ...anchor, sourceId: `${anchor.path}#L${line}-L${line}`, startLine: line, endLine: line,
        quote, adjacentTo: anchor.sourceId, queryIndexes: [], preferredQueryIndexes: [], contextBefore: '', contextAfter: '',
        score: 0, signal: 'adjacent', phraseMatches: 0, proximityScore: 0, fieldScore: 0, exactSignals: [], fieldMatches: [],
        mergeRanking: undefined, highlights: [], duplicateOf: null, negatedNearby: false };
      const resolved = resolveCurrentIndexedPassage(candidate, source, scopes, false, reject);
      if (resolved) { extra.push(resolved); seen.add(quote.trim()); trace.adjacentBytes += size; }
    }
  }
  trace.adjacentVerified = extra.length;
  return extra;
}

function answerPlanFor(searchPlan: IndexedSearchPlan | undefined, evidence: readonly IndexedEvidenceItem[]) {
  if (!searchPlan) return undefined;
  return planIndexedReviewAnswerPlanRust({ searchPlan,
    evidence: evidence.map(({ sourceId, path, quote, queryIndexes }) => ({ sourceId, path, quote, queryIndexes })),
  }) ?? undefined;
}

export async function reviewIndexedVault(
  options: IndexedVaultReviewOptions,
): Promise<IndexedVaultReviewResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let literal: LiteralReviewPreparation | undefined;
  let returned = false;
  try {
    const literalStartedAt = performance.now();
    literal = await prepareLiteralReview(options);
    const literalMs = performance.now() - literalStartedAt;
    const handle = literal.handle;
    let literalCurrent = true;
    const validateLiteral = async () => {
      if (handle && literalCurrent) {
        try { await handle.getSummary(); }
        catch { literalCurrent = false; }
      }
      options.signal?.throwIfAborted();
      return literalCurrent;
    };
    let answer: string | undefined;
    let completed: VaultResearchProgress | undefined;
    let result = await runIndexedVaultReview(
      { ...literal.options, signal: controller.signal,
        onAnswer: (content) => { answer = content; },
        onProgress: (progress) => {
          if (progress.phase === 'complete') completed = progress; else options.onProgress?.(progress);
        },
      },
      options.signal,
      handle ? validateLiteral : undefined,
    );
    if (!await validateLiteral() || options.isCurrent?.() === false) {
      await handle?.close();
      if (handle) literal = { ...literal, handle: undefined, inventory: { status: 'failed', reason: 'source-literal-unavailable' } };
      result = await runIndexedVaultReview({ ...literal.options, candidatesState: 'indexing', signal: controller.signal, onAnswer: undefined, onProgress: undefined, onDiagnostics: undefined }, options.signal);
      answer = undefined; completed = undefined;
    } else if (handle) {
      result.readLiteralDiscoveryPage = (index) => handle.readPage(index);
      result.closeLiteralDiscovery = () => handle.close();
    }
    if (literal.inventory) result.dossier.literalInventory = literal.inventory;
    // 엔진 진단과 결과 종류를 남겨야 후속 디버그 추적이 0건 원인을 설명할 수 있습니다.
    result.diagnostics.literalPreparationMs = literalMs;
    result.diagnostics.outcome = result.outcome;
    result.diagnostics.search = result.dossier.diagnostics ?? null;
    options.onDiagnostics?.(structuredClone(result.diagnostics));
    if (answer !== undefined) options.onAnswer?.(answer);
    if (completed) options.onProgress?.(completed);
    returned = true;
    return result;
  } finally {
    if (!returned) await literal?.handle?.close();
    controller.abort();
    options.signal?.removeEventListener('abort', cancel);
  }
}

async function runIndexedVaultReview(
  options: IndexedVaultReviewOptions,
  discoverySignal?: AbortSignal,
  validateLiteral?: () => Promise<boolean>,
): Promise<IndexedVaultReviewResult> {
  const phase = (): IndexedReviewPhaseDiagnostics => ({
    durationMs: 0,
    requests: 0,
    reportedRequests: 0,
  });
  const stageTrace: ReviewStageTrace = {
    plan: options.searchPlan ? { facets: options.searchPlan.facets.length, failedFacets: options.searchPlan.failedFacetIds?.length ?? 0 } : null,
    retrieval: null, selectionAndFollowup: null, currentSource: null, dossier: null, generationAndCorrection: null, displayAndCitations: null,
  };
  const diagnostics: IndexedReviewDiagnostics = {
    stageTrace,
    phases: {
      inventory: phase(),
      search: phase(),
      map: phase(),
      screen: phase(),
      extract: phase(),
      reduce: phase(),
      answer: phase(),
    },
    counts: {
      candidateSegments: 0,
      screenAcceptedSegments: 0,
      extractedSegments: 0,
      screenRetries: 0,
      extractRetries: 0,
      splitBatches: 0,
      reduceRequests: 0,
      cacheHits: 0,
      answerCorrectionRequests: 0,
    },
  };
  let finished = false;
  let phaseStartedAt = performance.now();
  let activePhase: IndexedReviewPhase = 'inventory';
  const emitDiagnostics = () => {
    diagnostics.phases[activePhase].durationMs = performance.now() - phaseStartedAt;
    if (!finished) options.onDiagnostics?.(structuredClone(diagnostics));
  };
  const startPhase = (phase: IndexedReviewPhase) => {
    diagnostics.phases[activePhase].durationMs = performance.now() - phaseStartedAt;
    activePhase = phase;
    phaseStartedAt = performance.now();
  };
  const check = () => options.signal?.throwIfAborted();
  const interruptible = <T>(operation: Promise<T>): Promise<T> => {
    const signal = options.signal;
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException(t('cancelledLabel'), 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      void operation
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  };
  try {
    options.onProgress?.({ phase: 'inventory', completedFiles: 0, totalFiles: 0 });
    emitDiagnostics();
    const documentScope = options.documentScope ?? 'all';
    let total =
      documentScope === 'candidates'
        ? new Set(options.candidates?.map((candidate) => candidate.path) ?? []).size
        : options.exhaustiveReview === true
          ? options.indexedPaths.length
          : Math.max(options.indexedPaths.length, options.inventory?.indexedCount ?? 0);
    if (
      options.candidatesState === 'initializing' ||
      options.candidatesState === 'unavailable'
    ) {
      appLogger.warn('Hybrid candidates not ready; continuing with full indexed review.', {
        source: 'chat.indexed-review',
        data: { state: options.candidatesState },
      });
    }
    if (options.candidatesState === 'indexing' || options.isCurrent?.() === false) {
      const content = t('indexedReviewIndexing');
      const requestedPaths = [
        ...new Set(
          documentScope === 'candidates'
            ? (options.candidates?.map((candidate) => candidate.path) ?? [])
            : options.indexedPaths,
        ),
      ];
      const coverage: IndexedVaultSearchCoverage = {
        documentScope,
        status: 'incomplete',
        reviewedDocuments: 0,
        unreviewedDocuments: requestedPaths.length,
        notIndexedDocuments: options.inventory?.notIndexedCount ?? 0,
        requestedPaths,
        plannedPaths: [],
        unreviewedPaths: requestedPaths,
      };
      return {
        outcome: 'indexing',
        dossier: {
          question: options.question,
          scoringQuestion: options.scoringQuestion ?? options.question,
          previousUserQuestions: options.previousUserQuestions ?? [],
          queryPlan: { queryTokens: [], phrases: [] },
          documentScope,
          evidence: [],
          coverage,
          diagnostics: null,
          notice: content,
          ...(options.searchPlan ? { searchPlan: options.searchPlan } : {}),
        },
        evidence: [],
        coverage,
        content,
        citations: [],
        processedFiles: 0,
        totalFiles: total,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: content,
        diagnostics,
        engineUnavailable: true,
      };
    }
    startPhase('search');
    options.onProgress?.({ phase: 'search', completedFiles: 0, totalFiles: total });
    const baseSearch = options.corpus
      ? await interruptible(
          searchIndexedVault({
            question: options.scoringQuestion ?? options.question,
            queryVariants: options.queryVariants,
            indexedPaths: options.indexedPaths,
            scopes: options.scopes,
            corpus: options.corpus,
            candidates: options.candidates,
            documentScope,
            exhaustiveReview: options.exhaustiveReview,
            inventory: options.inventory,
            filters: options.filters,
            signal: options.signal,
          }),
        )
      : null;
    check();
    if (!baseSearch) {
      emitDiagnostics();
      const content = t('indexedReviewNoEvidence');
      const requestedPaths = [
        ...new Set(
          documentScope === 'candidates'
            ? (options.candidates?.map((candidate) => candidate.path) ?? [])
            : options.indexedPaths,
        ),
      ];
      const coverage: IndexedVaultSearchCoverage = {
        documentScope,
        status: 'incomplete',
        reviewedDocuments: 0,
        unreviewedDocuments: requestedPaths.length,
        notIndexedDocuments: options.inventory?.notIndexedCount ?? 0,
        requestedPaths,
        plannedPaths: [],
        unreviewedPaths: requestedPaths,
      };
      const dossier: IndexedEvidenceDossier = {
        question: options.question,
        scoringQuestion: options.scoringQuestion ?? options.question,
        previousUserQuestions: options.previousUserQuestions ?? [],
        queryPlan: { queryTokens: [], phrases: [] },
        documentScope,
        evidence: [],
        coverage,
        diagnostics: null,
        notice: content,
        ...(options.searchPlan ? { searchPlan: options.searchPlan } : {}),
      };
      appLogger.warn('Indexed evidence engine unavailable.', {
        source: 'chat.indexed-review',
      });
      return {
        outcome: 'engine-unavailable',
        dossier,
        evidence: [],
        coverage,
        content,
        citations: [],
        processedFiles: 0,
        totalFiles: total,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: content,
        diagnostics,
        engineUnavailable: true,
      };
    }
    let search: IndexedVaultSearchResult = baseSearch;
    stageTrace.retrieval = {
      candidates: search.plan.diagnostics.candidateChunks, discoveryCandidates: options.discoveryCandidates?.length ?? null,
      baseSelected: search.evidence.length, baseBudgetDropped: search.plan.diagnostics.droppedDocuments.budget,
      maxPassages: search.plan.budget.maxPassages, maxChars: search.plan.budget.maxChars,
    };
    const followupUsage: TokenUsage[] = [];
    const followup = await interruptible(searchIndexedFollowup(
      options,
      baseSearch,
      (queries, paths, signal) => searchIndexedVault({
        question: queries[0] ?? options.question,
        queryVariants: queries.slice(1),
        queryFacets: queries,
        indexedPaths: paths,
        scopes: options.scopes,
        corpus: options.corpus!,
        // 이전 질의의 순위·facet은 새 질의의 후보 prior로 넘기지 않습니다.
        documentScope: 'all',
        filters: options.filters,
        budget: { maxDocuments: 8, maxPassages: 8, maxChars: 32_768 },
        signal,
      }),
      (update) => {
        followupUsage.push(update);
        const usage = planTurnUsageRust({ requests: [followupUsage] });
        if (usage) Object.assign(diagnostics.phases.reduce, usage);
      },
      () => {
        diagnostics.counts.followupRequests = 1;
        options.onProgress?.({ phase: 'followup', completedFiles: 0, totalFiles: total });
      },
    ));
    check();
    if (followup.search) {
      const mergedSearch = mergeIndexedVaultSearch(search, followup.search, {
        resetFacetAttribution: true,
      });
      if (mergedSearch) {
        search = mergedSearch;
        diagnostics.counts.followupDocuments = followup.search.coverage.plannedPaths.length;
      } else {
        followup.status = 'failed';
        followup.failure = 'merge';
      }
    }
    const selection: NonNullable<ReviewStageTrace['selectionAndFollowup']> = stageTrace.selectionAndFollowup = { followup: followup.status, ...(followup.failure ? { failure: followup.failure } : {}), pages: 0, inspected: 0,
      pathLimit: MAX_DISCOVERY_INSPECTIONS, pageLimit: MAX_DISCOVERY_INSPECTION_PAGES };
    if (options.sourceReader) stageTrace.currentSource = { failures: {}, verified: 0, adjacentVerified: 0, duplicateNeighbors: 0, adjacentBytes: 0, adjacentRejected: {}, adjacentByteLimit: ADJACENT_BYTE_LIMIT };
    const currentSources = new Map<string, CurrentEvidenceSource>();
    const readFailures = new Map<string, CurrentFailure>();
    const readCurrent = async (path: string) => {
      if (!options.sourceReader || readFailures.has(path) || currentSources.has(path)) return;
      check();
      try {
        const snapshot = await interruptible(options.sourceReader(path, options.signal));
        const source = prepareCurrentEvidenceSource(snapshot);
        if (source) currentSources.set(path, source);
        else readFailures.set(path, snapshot.failure ?? (snapshot.text === null ? 'body-unavailable' : snapshot.revision === null ? 'revision-unknown' : 'hash-unavailable'));
      } catch (error) {
        check();
        if (error instanceof Error && error.name === 'AbortError') throw error;
        readFailures.set(path, 'read-failed');
      }
    };
    const resolveCurrent = (item: IndexedEvidenceItem) => {
      const source = currentSources.get(item.path);
      let failure: CurrentFailure = readFailures.get(item.path) ?? 'verifier-unavailable';
      const resolved = source && resolveCurrentIndexedPassage(item, source, options.scopes, true, reason => { failure = reason; });
      if (!resolved && stageTrace.currentSource) {
        const counts = stageTrace.currentSource.failures;
        counts[failure] = (counts[failure] ?? 0) + 1;
      }
      return resolved;
    };
    // 검토 예산 밖 discovery 페이지의 미검토 경로를 결정적으로 골라 원문 검토에 넘깁니다.
    // 후보 구절이나 미검증 단서는 답변 컨텍스트로 승격하지 않고, 엔진의 현재 원문 검증을 통과한 근거만 합칩니다.
    const discoveryCorpus = options.corpus;
    let inspectedRankedCandidates: readonly IndexedEvidenceCandidate[] = [];
    let inspectedFallbackCandidates: readonly IndexedEvidenceCandidate[] = [];
    let targetFacets: IndexedSearchPlan['facets'] = [];
    const rankedEvidenceRows = new Set<string>();
    if (
      discoveryCorpus &&
      options.discoveryCandidates?.length &&
      options.discoveryPaths?.length &&
      (!options.filters || options.getFollowupPaths)
    ) {
      try {
        const missingIndexes = new Set<number>();
        const visited = new Set(search.coverage.plannedPaths);
        const hasFacetLead = options.discoveryCandidates.some(candidate =>
          !visited.has(candidate.path) && candidate.queryIndex !== undefined && candidate.queryIndex > 0);
        if (options.sourceReader && options.searchPlan?.mode === 'comparison' && hasFacetLead) {
          const indexedPlan = answerPlanFor(options.searchPlan, search.evidence);
          try {
            for (const facet of indexedPlan?.facets ?? []) {
              const index = options.searchPlan.facets.find(f => f.id === facet.id)?.queryIndex;
              if (index === undefined) continue;
              let supported = false;
              for (const item of search.evidence) {
                if (!facet.sourceIds.includes(item.sourceId)) continue;
                await readCurrent(item.path);
                const source = currentSources.get(item.path);
                if (source && resolveCurrentIndexedPassage(item, source, options.scopes)) {
                  supported = true;
                  break;
                }
              }
              if (!supported) missingIndexes.add(index);
            }
            if (indexedPlan) stageTrace.selectionAndFollowup.missingBeforeInspection = [...missingIndexes];
          } finally {
            // 이 판정은 후속 I/O 순서만 바꾼다. 최종 게시용 원문·정책·hash는 다시 확인한다.
            currentSources.clear();
            readFailures.clear();
          }
        }
        const allowedPaths = options.getFollowupPaths
          ? await interruptible(options.getFollowupPaths())
          : options.discoveryPaths;
        check();
        const literalInspection = new Set(options.literalInspectionPaths ?? []);
        const candidates = options.discoveryCandidates;
        const fallbackFacets = options.searchPlan?.facets.filter(f => missingIndexes.has(f.queryIndex)) ?? [];
        const priority = candidates.filter(item => item.queryIndex !== undefined && missingIndexes.has(item.queryIndex));
        const pools = priority.length && priority.length !== candidates.length ? [priority, candidates] : [candidates];
        const ranked = followup.rankedPaths ?? [];
        const rankedScope = new Set(ranked.some(group => group.length) && options.isCurrent?.() !== false
          ? scopeIndexedDiscoveryRust({ originalPaths: options.discoveryPaths, originalScopes: options.scopes,
            allowedPaths, scopes: options.scopes }) ?? [] : []);
        const rankedPaths = roundRobinPaths(ranked.map(group => group.filter(path => rankedScope.has(path))), MAX_DISCOVERY_INSPECTIONS);
        const inspected = new Set(rankedPaths);
        const fallbackPaths: string[] = [];
        let pool = 0;
        let offset = 0;
        for (
          let pageCount = 0;
          pageCount < MAX_DISCOVERY_INSPECTION_PAGES && inspected.size < MAX_DISCOVERY_INSPECTIONS;
          pageCount += 1
        ) {
          if (allowedPaths.length === 0 || options.isCurrent?.() === false) break;
          const page = pageIndexedDiscoveryRust({
            candidates: pools[pool],
            originalPaths: options.discoveryPaths,
            originalScopes: options.scopes,
            allowedPaths,
            reviewedPaths: search.coverage.plannedPaths.filter((path) => !literalInspection.has(path)),
            selectedPaths: search.evidence.map((item) => item.path),
            failedPaths: search.coverage.unreviewedPaths.filter((path) => !literalInspection.has(path)),
            scopes: options.scopes,
            offset,
            limit: 96,
          });
          if (!page) break;
          for (const item of page.items) {
            if (item.state !== 'unreviewed' || inspected.has(item.path)) continue;
            inspected.add(item.path);
            fallbackPaths.push(item.path);
            if (inspected.size >= MAX_DISCOVERY_INSPECTIONS) break;
          }
          selection.pages++;
          if (page.nextOffset === null || page.nextOffset <= offset) {
            if (++pool >= pools.length) break;
            offset = 0;
          } else offset = page.nextOffset;
        }
        if (inspected.size) targetFacets = fallbackFacets;
        const proposesComparison = options.searchPlan?.mode === 'comparison' && !!followup.subjects;
        const rankedSet = new Set(rankedPaths);
        const rankedPassageBudget = rankedPaths.length ? MAX_DISCOVERY_INSPECTIONS - fallbackPaths.length : 0;
        // 순위 질의와 원래 discovery 질의의 점수·번호는 섞지 않고, 경로와 인용 예산만 공유한다.
        for (const [selected, useRanked] of [[rankedPaths, true], [fallbackPaths, false]] as const) {
          if (!selected.length || options.isCurrent?.() === false) continue;
          let paths: readonly string[] = selected;
          if (!useRanked && rankedPaths.length && options.getFollowupPaths) {
            // 첫 배치의 비동기 I/O 뒤에도 두 번째 배치의 권한을 확인한다.
            const live = new Set(await interruptible(options.getFollowupPaths()));
            check();
            paths = paths.filter(path => live.has(path));
            if (!paths.length || options.isCurrent?.() === false) continue;
          }
          selection.inspected += paths.length;
          const fallbackSet = new Set(paths);
          const maxPassages = useRanked ? rankedPassageBudget : MAX_DISCOVERY_INSPECTIONS - rankedPassageBudget;
          const inspectedCandidates = useRanked
            ? ranked.flatMap(group => [...new Set(group)].flatMap((path, j) => rankedSet.has(path)
              ? [{ path, queryIndex: 0, score: 1 / (j + 1), source: 'bm25' as const, rank: j + 1 }] : []))
            : candidates.filter(candidate => fallbackSet.has(candidate.path));
          if (useRanked) inspectedRankedCandidates = inspectedCandidates;
          else inspectedFallbackCandidates = inspectedCandidates;
          const focused = fallbackFacets[0];
          const inspectedSearch = await interruptible(
            searchIndexedVault({
              question: (useRanked ? followup.queries?.[0] : focused?.query) ?? options.scoringQuestion ?? options.question,
              queryVariants: useRanked ? followup.queries?.slice(1) : focused ? facetQueryVariants(focused) : options.queryVariants,
              ...(useRanked ? { queryFacets: followup.queries } : fallbackFacets.length > 1 ? { queryFacets: fallbackFacets.map(f => f.query) } : {}),
              indexedPaths: paths,
              scopes: options.scopes,
              corpus: discoveryCorpus,
              documentScope: 'all',
              filters: options.filters,
              ...(!useRanked && !focused && inspectedCandidates.length > 0 ? { candidates: inspectedCandidates } : {}),
              budget: { maxPassages, maxChars: maxPassages * 4096 },
              signal: options.signal,
            }),
          );
          check();
          const proposed = useRanked && proposesComparison;
          if (inspectedSearch && !proposed && (useRanked || focused)) {
            // 독립 검색에서 생긴 번호·경로 순위는 원래 비교의 귀속이 아니다.
            inspectedSearch.evidence = inspectedSearch.evidence.map(item => ({ ...item,
              queryIndexes: targetFacets.filter(f => coversFacet(item.quote, f)).map(f => f.queryIndex), preferredQueryIndexes: [],
            }));
          }
          const mergedSearch = inspectedSearch
            ? mergeIndexedVaultSearch(search, inspectedSearch, { resetFacetAttribution: proposed })
            : null;
          if (mergedSearch) {
            if (proposed && inspectedSearch && mergedSearch.evidence.length > search.evidence.length) {
              const previous = new Set(search.evidence.map(evidenceRowKey));
              const rankedRows = new Set(inspectedSearch.evidence.map(evidenceRowKey));
              for (const item of mergedSearch.evidence) {
                const key = evidenceRowKey(item);
                if (rankedRows.has(key) && !previous.has(key)) rankedEvidenceRows.add(key);
              }
            }
            search = mergedSearch;
            diagnostics.counts.discoveryInspectedDocuments = (diagnostics.counts.discoveryInspectedDocuments ?? 0) + paths.length;
          } else {
            appLogger.warn(
              'Discovery inspection could not be merged; retaining the reviewed evidence.',
              {
                source: 'chat.indexed-review',
                data: { inspectedDocuments: paths.length },
              },
            );
          }
        }
      } catch (error) {
        check();
        if (error instanceof Error && error.name === 'AbortError') throw error;
        appLogger.warn(
          'Discovery inspection unavailable; retaining the reviewed evidence.',
          { source: 'chat.indexed-review' },
        );
      }
    }
    // 재해석 전에는 순위 그룹 번호를 기본 계획의 facet 번호로 사용하지 않는다.
    const originalInspectionCandidates = [...inspectedRankedCandidates, ...inspectedFallbackCandidates];
    // 후속·discovery 추가 검토가 기본 검토 범위를 넓히면 완료 진행과 안내의 총계도 같은 범위를 씁니다.
    total = Math.max(total, search.coverage.plannedPaths.length);
    diagnostics.counts.candidateSegments = search.plan.evidence.length;
    diagnostics.counts.screenAcceptedSegments = search.evidence.length;
    diagnostics.counts.extractedSegments = search.evidence.length;
    startPhase('map');
    // 채택 문서만 현재 vault 원문과 revision으로 다시 검증합니다.
    const adoptedPaths = [...new Set(search.evidence.map((item) => item.path))];
    options.onProgress?.({ phase: 'verify', completedFiles: 0, totalFiles: adoptedPaths.length });
    let completedSources = 0;
    const stale = new Set<string>();
    for (const path of adoptedPaths) {
      const expected = search.evidence.find((item) => item.path === path)?.revision ?? null;
      let current: string | null = null;
      if (options.sourceReader) {
        await readCurrent(path);
      } else {
        // sourceReader가 없는 legacy 경로는 기존 stat-only 재확인을 유지합니다.
        for (let attempt = 0; attempt < 2; attempt++) {
          check();
          try {
            current = options.revisionReader
              ? await interruptible(options.revisionReader(path))
              : null;
          } catch (error) {
            check();
            if (error instanceof Error && error.name === 'AbortError') throw error;
            current = null;
            appLogger.warn('Source revision read failed; treating the document as stale.', {
              source: 'chat.indexed-review',
            });
          }
          if (current !== null && current === expected) break;
        }
      }
      options.onProgress?.({ phase: 'verify', completedFiles: ++completedSources, totalFiles: adoptedPaths.length, currentPath: path });
      if (!options.sourceReader && (expected === null || current !== expected)) {
        stale.add(path);
      }
    }
    let evidence: readonly IndexedEvidenceItem[] = search.evidence.filter((item) => !stale.has(item.path));
    const currentRankedRows = new Set<string>();
    const currentOriginalRows = new Set<string>();
    let recoveryExcludedSegments = 0;
    if (options.sourceReader) {
      evidence = search.evidence.flatMap((item) => {
        const resolved = resolveCurrent(item);
        if (!resolved) {
          stale.add(item.path);
          return [];
        }
        if (rankedEvidenceRows.size) {
          const rows = rankedEvidenceRows.has(evidenceRowKey(item)) ? currentRankedRows : currentOriginalRows;
          rows.add(evidenceRowKey(resolved));
        }
        return [resolved];
      });
    }
    if (options.sourceReader && stale.size > 0) {
      // 색인 뒤에 원문이 바뀐 문서도 인용이 현재 본문에 남아 있으면 근거로 복구합니다.
      // 색인 지연만으로 검토 대상이 통째로 사라지면 답변이 근거를 잃습니다.
      const freshDocuments: RustIndexedEvidenceDocument[] = [];
      const verifiedRecovery = (item: IndexedEvidenceItem): IndexedEvidenceItem[] => {
        const source = currentSources.get(item.path);
        if (!source || evidence.some(existing => existing.path === item.path)) return [];
        const resolved = resolveCurrentIndexedPassage(item, source, options.scopes, false);
        if (!resolved) return [];
        if (!targetFacets.length) return [resolved];
        const keepIndex = (index: number) => targetFacets.every(f => f.queryIndex !== index || coversFacet(resolved.quote, f));
        return [{ ...resolved, queryIndexes: resolved.queryIndexes?.filter(keepIndex), preferredQueryIndexes: resolved.preferredQueryIndexes?.filter(keepIndex) }];
      };
      for (const path of stale) {
        const source = currentSources.get(path);
        if (!source || evidence.some((item) => item.path === path)) continue;
        // 복구도 현재 청킹의 절대 줄 주소를 유지해 원래 검색 신호로 구절을 고릅니다.
        const chunks = source.chunks ?? [{ text: source.text, startLine: 1 }];
        for (const chunk of chunks) {
          freshDocuments.push({
            ...chunk,
            path,
            revision: source.revision,
            indexed: true,
            reviewState: 'reviewed',
          });
        }
      }
      if (freshDocuments.length > 0) {
        const input = {
          question: options.scoringQuestion ?? options.question, queryVariants: options.queryVariants,
          scopes: options.scopes, filters: options.filters, budget: DEFAULT_EVIDENCE_BUDGET,
          candidates: recoveryCandidatePool(options.candidates, originalInspectionCandidates, freshDocuments),
          inventory: { indexedCount: freshDocuments.length, unreviewedCount: 0, notIndexedCount: 0 },
        };
        // 여러 대형 문서의 청크를 단일 WASM JSON에 복제하지 않는다. 실패한 배치는 승격하지 않는다.
        const batches = partitionEvidencePayloads(freshDocuments, new Set(), encoder.encode(JSON.stringify(input)).byteLength + 256);
        const plans = batches.flatMap(documents => {
          const plan = planIndexedEvidenceRust({ ...input, documents });
          if (!plan) return [];
          const verified = plan.evidence.flatMap(verifiedRecovery);
          return [{ ...plan, evidence: verified, order: verified.map(item => item.sourceId) }];
        });
        const merged = plans.length > 1 && mergeIndexedEvidencePlansRust({ plans, budget: DEFAULT_EVIDENCE_BUDGET });
        const recoveryPlan = plans.length === 1 ? plans[0] : merged && mergedEvidencePlan(plans, merged, DEFAULT_EVIDENCE_BUDGET, stale.size);
        if (recoveryPlan && recoveryPlan.evidence.length > 0) {
          const recovered = recoveryPlan.evidence.map(item => ({ ...item, contentHash: currentSources.get(item.path)!.contentHash }));
          if (recovered.length > 0) {
            for (const item of recovered) stale.delete(item.path);
            // 기존 검증 근거가 없으면 복구 근거를 그대로 쓰고, 있으면 확장 예산으로 다시 병합해
            // 고정 상한이 앞선 검증 근거를 버리지 않게 합니다.
            const mergedRecovery =
              evidence.length === 0
                ? null
                : mergeIndexedEvidencePlansRust({
              plans: [
                {
                  ...search.plan,
                  evidence,
                  order: evidence.map((item) => item.sourceId),
                },
                { ...recoveryPlan, evidence: recovered },
              ],
              budget: {
                maxPassages: evidence.length + recovered.length,
                maxChars: search.plan.budget.maxChars + recoveryPlan.budget.maxChars,
              },
            });
            if (evidence.length === 0) {
              evidence = recovered;
            } else if (mergedRecovery) {
              // 병합 DTO는 원문 hash를 보존하지 않습니다. 현재 검증한 revision에만 다시 연결합니다.
              const merged = mergedRecovery.evidence.flatMap(item => {
                const source = currentSources.get(item.path);
                return source && item.revision === source.revision ? [{ ...item, contentHash: source.contentHash }] : [];
              });
              recoveryExcludedSegments += Math.max(0, evidence.length + recovered.length - merged.length);
              evidence = merged;
            } else {
              // 엔진 병합이 불가능하면 기존 검증 근거를 유지하고 복구분만 보류합니다.
              recoveryExcludedSegments += recovered.length;
              appLogger.warn(
                'Recovered evidence could not be merged; keeping the verified evidence.',
                { source: 'chat.indexed-review', data: { recovered: recovered.length } },
              );
            }
            appLogger.debug('Recovered evidence from documents changed after indexing.', {
              source: 'chat.indexed-review',
              data: { recovered: recovered.length },
            });
          }
        }
      }
    }
    // 기본·재선택을 마친 뒤에도 빠진 비교 항목만 독립적으로 조사한다.
    // 현재 태그·시각을 입증할 메타데이터가 없는 직접 탐색은 필터 요청에서 실행하지 않는다.
    if (options.sourceReader && !options.filters && options.searchPlan?.mode === 'comparison' &&
        options.getFollowupPaths && options.discoveryPaths?.length && options.discoveryCandidates?.length) {
      const missingIds = answerPlanFor(options.searchPlan, evidence)?.missingFacetIds ?? [];
      const facets = options.searchPlan.facets.filter(f => missingIds.includes(f.id) && f.terms.length);
      if (facets.length && evidence.length < 64) {
        const scan: NonNullable<typeof selection.currentFacetScan> = {
          status: 'started', missing: facets.length, noCurrentChunks: 0, pathFacetScans: 0,
          termWindowCandidates: 0, rankingUnavailable: 0, rankedPassages: 0,
          fullTermPassages: 0, proofRejected: 0, policyDropped: 0,
        };
        selection.currentFacetScan = scan;
        const liveScope = async () => {
          const paths = scopeIndexedDiscoveryRust({ originalPaths: options.discoveryPaths!, originalScopes: options.scopes,
            scopes: options.scopes, allowedPaths: await interruptible(options.getFollowupPaths!()) });
          if (!paths) throw new Error('scope-unavailable');
          return new Set(paths);
        };
        // 이전 dossier의 경로가 철회됐다는 사실을 알면 원래 구절도 게시하지 않는다.
        const invalidScope = () => runIndexedVaultReview({ ...options, candidatesState: 'indexing' }, discoverySignal);
        try {
          const allowed = await liveScope();
          check();
          if (evidence.some(item => !allowed.has(item.path))) return invalidScope();
          const reviewed = new Set(search.coverage.plannedPaths.filter(p => allowed.has(p) && !search.coverage.unreviewedPaths.includes(p)));
          const leads = [...originalInspectionCandidates, ...(options.candidates ?? [])];
          const queues = facets.map(f => leads.filter(c => c.queryIndex === f.queryIndex && reviewed.has(c.path)).sort((a,b) => a.rank-b.rank).map(c => c.path));
          const targets = new Set(roundRobinPaths(queues, MAX_DISCOVERY_INSPECTIONS));
          for (const path of reviewed) { if (targets.size >= MAX_DISCOVERY_INSPECTIONS) break; targets.add(path); }
          const extra: IndexedEvidenceItem[] = [];
          const extraSources = new Map<string, CurrentEvidenceSource>();
          const found = new Set<number>();
          selection.currentFacetPaths = 0;
          for (const path of targets) {
            check();
            if (options.isCurrent?.() === false || found.size === facets.length || evidence.length + extra.length >= 64) break;
            selection.currentFacetPaths++;
            await readCurrent(path);
            const source = currentSources.get(path);
            if (!source?.chunks?.length) {
              scan.noCurrentChunks++;
              if (!adoptedPaths.includes(path)) currentSources.delete(path);
              continue;
            }
            for (const facet of facets) {
              if (found.has(facet.queryIndex)) continue;
              const candidates = await findCurrentFacetPassages(facet, path, source.revision, source.chunks, source.windows, options.scopes, options.signal, scan);
              check();
              for (const candidate of candidates) {
                const item = resolveCurrentIndexedPassage(candidate, source, options.scopes, false);
                if (!item) { scan.proofRejected++; continue; }
                if (evidence.length + extra.length >= 64) continue;
                if (extra.some(existing => existing.path === item.path && existing.queryIndexes?.includes(facet.queryIndex) &&
                    existing.startLine <= item.endLine && existing.endLine >= item.startLine)) continue;
                extra.push(item);
                found.add(facet.queryIndex);
                extraSources.set(path, source);
              }
            }
            if (!adoptedPaths.includes(path)) currentSources.delete(path);
          }
          const stillAllowed = targets.size ? await liveScope() : allowed;
          check();
          if (evidence.some(item => !stillAllowed.has(item.path))) return invalidScope();
          const admitted = extra.filter(item => stillAllowed.has(item.path) && options.isCurrent?.() !== false);
          for (const item of admitted) currentSources.set(item.path, extraSources.get(item.path)!);
          // 같은 실제 주소는 중복 전달하지 않고 입증한 귀속만 추가한다.
          const combined = [...evidence];
          for (const item of admitted) {
            const key = evidenceRowKey(item);
            const index = combined.findIndex(existing => evidenceRowKey(existing) === key);
            const previous = combined[index];
            if (previous) combined[index] = { ...previous, queryIndexes: [...new Set([...(previous.queryIndexes ?? []), ...(item.queryIndexes ?? [])])] };
            else combined.push(item);
          }
          evidence = combined;
          selection.currentFacetPassages = admitted.length;
          scan.policyDropped = extra.length - admitted.length;
          scan.status = 'complete';
        } catch (error) {
          scan.status = 'unavailable';
          check();
          if (error instanceof Error && error.name === 'AbortError') throw error;
          appLogger.warn('Current facet inspection unavailable; retaining verified evidence.', { source: 'chat.indexed-review' });
        }
      }
    }
    if (options.sourceReader) evidence = distinctCurrentSourceIds(evidence);
    // 인접 구절은 보충 인용일 뿐이므로 답변 계획은 원래 근거만 사용한다.
    let answerPlan = answerPlanFor(options.searchPlan, evidence);
    // 기본 독립 탐색까지 마친 뒤 병합·원문 검증된 새 순위 근거가 있을 때만 재해석을 검토한다.
    const proposedSubjects = followup.subjects;
    const originalPlan = options.searchPlan;
    if (currentRankedRows.size && originalPlan?.mode === 'comparison' && proposedSubjects &&
        originalPlan.facets.filter(f => f.kind === 'subject').length === proposedSubjects.length) {
      let next = 0;
      const proposedPlan = { ...originalPlan, facets: originalPlan.facets.map(f => {
        if (f.kind !== 'subject') return f;
        const subject = proposedSubjects[next++];
        return { ...f, query: subject.anchor, terms: subject.terms, identities: subject.identities };
      }) };
      const adapted = proposedPlan.facets.filter(f => f.kind === 'subject');
      const proposedEvidence = evidence.map(item => ({ ...item, preferredQueryIndexes: [],
        queryIndexes: adapted.filter(f => coversFacet(item.quote, f)).map(f => f.queryIndex),
      }));
      const hasNewSupport = proposedEvidence.some(item => {
        const key = evidenceRowKey(item);
        return item.queryIndexes.length > 0 && currentRankedRows.has(key) && !currentOriginalRows.has(key);
      });
      if (hasNewSupport && answerPlan) {
        const proposedAnswer = answerPlanFor(proposedPlan, proposedEvidence);
        if (proposedAnswer && answerPlan.requiredFacetIds.every(id => proposedAnswer.requiredFacetIds.includes(id)) &&
            (!answerPlan.synthesisRequired || proposedAnswer.synthesisRequired)) {
          options = { ...options, searchPlan: proposedPlan };
          evidence = proposedEvidence;
          answerPlan = proposedAnswer;
        }
      }
    }
    const anchorEvidence = evidence;
    if (stageTrace.currentSource) {
      stageTrace.currentSource.verified = evidence.length;
      const neighbors = currentNeighbors(evidence, currentSources, options.scopes, stageTrace.currentSource);
      if (neighbors.length) evidence = distinctCurrentSourceIds([...evidence, ...neighbors]);
    }
    const citations = new Map<string, SourceCitation>();
    for (const item of evidence) {
      citations.set(item.sourceId, {
        id: item.sourceId,
        filePath: item.path,
        line: item.startLine,
        endLine: item.endLine,
        preview: item.quote,
        status: 'verified',
      });
    }
    const accepted = new Set(evidence.map((item) => item.path));
    const machineExcluded =
      search.plan.diagnostics.droppedDocuments.belowThreshold +
      search.plan.diagnostics.droppedDocuments.filtered;
    const budgetExcluded = search.rejected.filter((item) => item.status === 'unreviewed').length;
    diagnostics.counts.recoveryExcludedSegments = recoveryExcludedSegments;
    const verificationRejected = search.rejected.length - budgetExcluded;
    // 전역 예산·coverage·truncated는 엔진 병합 값을 그대로 두고, 엔진이 알 수 없는
    // 현재 vault 리비전(stale) 제거분만 별도 읽기 실패로 반영합니다.
    const unreviewedPaths = [...new Set([...search.coverage.unreviewedPaths, ...stale])];
    const newlyStale = [...stale].filter(
      (path) => !search.coverage.unreviewedPaths.includes(path),
    ).length;
    // 모델이 열거를 선택하지 못하거나 후속 요청이 실패해도 목록·개수 질문은
    // 결정적 의도 감지로 전체 열거를 유지합니다.
    const enumerationIntent =
      followup.enumerate === true || hasVaultInventoryIntentRust(options.question);
    const enumeration = enumerationIntent
      ? await interruptible(enumerateIndexedDocuments(options, (request) => runIndexedVaultReview(request)))
      : undefined;
    check();
    const hasIncompleteCoverage = search.coverage.status === 'incomplete' || stale.size > 0 || recoveryExcludedSegments > 0 || enumeration?.incomplete === true || [...currentSources.values()].some((source) => source.sourceMetadata?.completeness?.status === 'partial');
    const effectiveCoverage: IndexedVaultSearchCoverage = {
      ...search.coverage,
      status: hasIncompleteCoverage ? ('incomplete' as const) : search.coverage.status,
      reviewedDocuments: Math.max(0, search.coverage.reviewedDocuments - newlyStale),
      unreviewedDocuments: search.coverage.unreviewedDocuments + newlyStale,
      unreviewedPaths,
    };
    // 현재 원문 검증에서 제외된 문서와 열거가 바꾼 실제 검토 범위를 최종 총계에 반영합니다.
    total = Math.max(
      total,
      effectiveCoverage.plannedPaths.length,
      effectiveCoverage.reviewedDocuments,
    );
    const reviewed = effectiveCoverage.reviewedDocuments;
    const noticeValues = {
      total,
      machineExcluded,
      accepted: accepted.size,
      rejected: verificationRejected,
      budgetExcluded: budgetExcluded + recoveryExcludedSegments,
      unreviewed: effectiveCoverage.unreviewedDocuments,
      notIndexed: effectiveCoverage.notIndexedDocuments,
      unreadable: stale.size,
    };
    const coverage = t('indexedReviewCoverage', noticeValues);
    const limitedReview =
      !hasIncompleteCoverage &&
      (effectiveCoverage.status === 'budget-exhausted' || search.plan.diagnostics.truncated);
    const notice = hasIncompleteCoverage
      ? t('indexedReviewIncompleteNotice', noticeValues)
      : limitedReview
        ? t('indexedReviewLimitedNotice', noticeValues)
        : coverage;
    // 태그·시각 필터의 후보 메타데이터가 없으면 범위 밖 단서를 노출하지 않습니다.
    const discoveryInput = options.discoveryCandidates && options.discoveryPaths && (!options.filters || options.getFollowupPaths)
      ? {
          candidates: options.discoveryCandidates,
          originalPaths: options.discoveryPaths,
          originalScopes: options.scopes,
          reviewedPaths: search.coverage.plannedPaths,
          selectedPaths: [...accepted],
          failedPaths: [...stale],
        }
      : undefined;
    const readDiscoveryPage = discoveryInput
      ? (request: IndexedDiscoveryPageRequest): RustIndexedDiscoveryPage | null => {
          discoverySignal?.throwIfAborted();
          request.signal?.throwIfAborted();
          if (options.isCurrent?.() === false) return null;
          return pageIndexedDiscoveryRust({
            ...discoveryInput,
            allowedPaths: request.allowedPaths,
            scopes: request.scopes,
            offset: request.offset,
            limit: request.limit,
          });
        }
      : undefined;
    const discoveryPage = readDiscoveryPage?.({
      allowedPaths: options.discoveryPaths ?? [], scopes: options.scopes, offset: 0, limit: 32,
      signal: options.signal,
    });
    const sourceDocuments = { ...search.sourceDocuments, ...Object.fromEntries([...currentSources].filter(([, source]) => source.sourceMetadata).map(([path, source]) => [path, source.sourceMetadata!])) };
    const dossier: IndexedEvidenceDossier = {
      ...(Object.keys(sourceDocuments).length > 0 ? { sourceDocuments } : {}),
      question: options.question,
      scoringQuestion: options.scoringQuestion ?? options.question,
      previousUserQuestions: options.previousUserQuestions ?? [],
      queryPlan: { queryTokens: search.plan.queryTokens, phrases: search.plan.phrases },
      ...(discoveryPage ? { discoverySummary: discoveryPage.summary } : {}),
      ...(options.getFollowupPaths ? { followup: { status: followup.status, queries: followup.queries } } : {}),
      matchInventory: options.matchInventory,
      literalInventory: options.literalInventory,
      ...(enumeration ? { enumeration } : {}),
      documentScope,
      evidence,
      coverage: effectiveCoverage,
      diagnostics: search.plan.diagnostics,
      notice,
      ...(options.searchPlan ? { searchPlan: options.searchPlan } : {}),
      ...(answerPlan ? { answerPlan } : {}),
    };
    stageTrace.dossier = { passages: evidence.length, distinctQuoteCount: new Set(evidence.map(item => item.quote)).size, missingFacets: answerPlan?.missingFacetIds.length ?? null, facetSourceCounts: answerPlan?.facets.map(f => f.sourceIds.length) ?? null };
    const generation: NonNullable<ReviewStageTrace['generationAndCorrection']> = { requests: 0, sentPassages: 0, validationFailures: [] };
    stageTrace.generationAndCorrection = generation;
    const indexingContent = t('indexedReviewIndexing');
    const returnIndexing = (): IndexedVaultReviewResult => ({
      outcome: 'indexing',
      dossier: { ...dossier, notice: indexingContent },
      evidence: [],
      coverage: effectiveCoverage,
      content: indexingContent,
      citations: [],
      processedFiles: reviewed,
      totalFiles: total,
      rejectedFiles: 0,
      providerTransfer: { sentFiles: 0, sentPaths: [] },
      coverageNotice: indexingContent,
      diagnostics,
      engineUnavailable: true,
    });
    // 검색 중 재색인·corpus refresh가 시작됐다면 이전 색인의 답을 게시하지 않습니다.
    if (options.isCurrent?.() === false) {
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return returnIndexing();
    }
    startPhase('answer');
    emitDiagnostics();
    const comparisonLimitations = comparisonLimitNotice(options.searchPlan, answerPlan);
    const finishAsEvidenceOnly = (limitations: string): IndexedVaultReviewResult => {
      const hasVerified = evidence.length > 0 || Boolean(enumeration?.citations.length);
      const body = evidence.length ? evidenceOnlyContent(evidence) : hasVerified ? '' : t('indexedReviewNoEvidence');
      const content = [body, limitations, enumeration?.content, notice].filter(Boolean).join('\n\n');
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return {
        outcome: hasVerified ? 'evidence-only' : 'no-evidence',
        dossier,
        readDiscoveryPage,
        evidence,
        coverage: effectiveCoverage,
        content,
        citations: [...new Map([...citations.values(), ...(enumeration?.citations ?? [])].map((citation) => [citation.id, citation])).values()],
        processedFiles: reviewed,
        totalFiles: total,
        rejectedFiles: verificationRejected,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: notice,
        diagnostics,
        engineUnavailable: false,
      };
    };
    if (evidence.length > 0 && options.searchPlan && !answerPlan) {
      appLogger.warn('Indexed answer plan unavailable; returning verified evidence only.', {
        source: 'chat.indexed-review',
      });
      return finishAsEvidenceOnly(comparisonLimitations);
    }
    if (evidence.length > 0 && answerPlan?.mode === 'comparison' && answerPlan.requiredFacetIds.length === 0) {
      appLogger.warn(
        'Indexed comparison has no supported subject facet; returning verified evidence only.',
        {
          source: 'chat.indexed-review',
        },
      );
      return finishAsEvidenceOnly(comparisonLimitations);
    }
    if (options.executionMode === 'engine-only' || options.deferAnswer || evidence.length === 0) {
      return finishAsEvidenceOnly(comparisonLimitations);
    }
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    let sentToProvider = false;
    const usage: TokenUsage[][] = [];
    const requestAnswer = async (
      previousAnswer?: string,
      correction: { reason: string; facets: string } = {
        reason: 'invalid-format',
        facets: '-',
      },
    ): Promise<{ raw: string; rendered: string | null }> => {
      check();
      if (options.isCurrent?.() === false) throw new Error(t('vaultResearchContractUnavailable'));
      if (!budget) throw new Error(t('vaultResearchContractUnavailable'));
      generation.inputByteLimit = budget.inputBytes;
      let payload = JSON.stringify(toModelIndexedEvidenceDossier(dossier));
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: [t('llmEvidenceDataBoundary'), options.systemPrompt, answerPlan?.mode === 'comparison' ? t('llmIndexedBoundAnswer') : t('llmIndexedReviewAnswer')]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          // 전체 경로 원장은 결과에 보존하고, 모델에는 집계와 검증 원문을 전달합니다.
          content: payload,
        },
      ];
      if (previousAnswer !== undefined) {
        if (previousAnswer.trim()) {
          messages.push({ role: 'assistant', content: previousAnswer });
        }
        messages.push({
          role: 'user',
          content: answerPlan?.mode === 'comparison' ? t('llmIndexedBoundCorrection', correction) : t('llmIndexedReviewAnswerCorrection', correction),
        });
      }
      const prepare = (input: ChatMessage[]) => {
        const prepared = prepareProviderRequest(input, undefined, budget.inputBytes);
        if (!prepared.messages.some((message) => message.role === 'user' && message.content === payload)) {
          throw new Error(t('chatInputBudgetExceeded'));
        }
        return prepared;
      };
      let prepared: ReturnType<typeof prepareProviderRequest>;
      const prepareWithCorrection = () => {
        try { return prepare(messages); }
        catch (error) {
          if (!previousAnswer?.trim()) throw error;
          return prepare(messages.filter(message => message.role !== 'assistant'));
        }
      };
      try { prepared = prepareWithCorrection(); }
      catch (error) {
        if (previousAnswer !== undefined || evidence === anchorEvidence) { generation.preparationFailed = true; throw error; }
        // Optional context must not displace the mandatory verified dossier on first send.
        payload = JSON.stringify(toModelIndexedEvidenceDossier({ ...dossier, evidence: anchorEvidence }));
        messages[1] = { role: 'user', content: payload };
        try { prepared = prepare(messages); }
        catch (retryError) { generation.preparationFailed = true; throw retryError; }
        for (const item of evidence.slice(anchorEvidence.length)) citations.delete(item.sourceId);
        evidence = anchorEvidence;
        dossier.evidence = evidence;
        if (stageTrace.dossier) {
          stageTrace.dossier.passages = evidence.length;
          stageTrace.dossier.distinctQuoteCount = new Set(evidence.map(item => item.quote)).size;
        }
      }
      const updates: TokenUsage[] = [];
      options.onProgress?.({ phase: previousAnswer === undefined ? 'answer' : 'repair', completedFiles: evidence.length, totalFiles: evidence.length });
      check();
      if ((validateLiteral && !await validateLiteral()) || options.isCurrent?.() === false) throw new Error(t('vaultResearchContractUnavailable'));
      check();
      let content = '';
      try {
        sentToProvider = true;
        generation.requests++;
        generation.sentPassages = evidence.length;
        generation.preparedBytes = prepared.usedBytes;
        usage.push(updates);
        if (previousAnswer !== undefined) diagnostics.counts.answerCorrectionRequests = 1;
        await interruptible(
          options.provider.streamChat(
            prepared.messages,
            (chunk) => {
              if (options.signal?.aborted || options.isCurrent?.() === false) return;
              content += chunk.content ?? '';
              if (chunk.reasoning) options.onReasoning?.(chunk.reasoning);
            },
            0.2,
            undefined,
            {
              signal: options.signal,
              toolChoice: 'none',
              onUsage: (chunkUsage) => {
                if (options.signal?.aborted) return;
                updates.push({ ...chunkUsage });
                const plan = planTurnUsageRust({ requests: usage });
                if (plan) Object.assign(diagnostics.phases.answer, plan);
                emitDiagnostics();
              },
            },
          ),
        );
      } finally {
        const plan = planTurnUsageRust({ requests: usage });
        if (plan) Object.assign(diagnostics.phases.answer, plan);
      }
      check();
      return {
        raw: content,
        rendered: !answerPlan && content.trim()
          ? renderIndexedReviewAnswerRust([...citations.keys()], content)
          : null,
      };
    };
    let answer: string | null = null;
    try {
      // 정상 해석 1회와 결정적 인용 형식 오류 교정 1회까지만 허용합니다.
      const first = await requestAnswer();
      if (answerPlan) {
        let bindingFailure: string | undefined;
        const sourceIds = [...citations.keys()];
        const bindings = answerPlan.mode === 'single' ? null : answerBindings(sourceIds, answerPlan.facets.filter(f => f.status === 'supported'));
        const validateAnswer = (raw: string) => {
          bindingFailure = undefined;
          return validateIndexedReviewAnswerRust({
            sourceIds,
            answerPlan,
            response: decodeAnswerBindings(raw, bindings, code => { bindingFailure = code; }),
          });
        };
        const firstValidation = validateAnswer(first.raw);
        if (firstValidation?.valid) {
          answer = firstValidation.content;
        } else {
          const reason =
            firstValidation && !firstValidation.valid
              ? firstValidation.reason
              : 'validator-unavailable';
          generation.validationFailures.push(reason);
          const missingFacetIds =
            firstValidation && !firstValidation.valid ? firstValidation.missingFacetIds : [];
          const formatIssue =
            firstValidation && !firstValidation.valid ? firstValidation.formatIssue : undefined;
          appLogger.warn('Indexed answer failed facet validation; attempting one correction.', {
            source: 'chat.indexed-review',
            data: { reason, missingFacetIds, formatIssue, fieldIssue: firstValidation?.fieldIssue, ...(bindingFailure ? { bindingFailure } : {}) },
          });
          const corrected = await requestAnswer(first.raw, {
            reason: bindingFailure ?? (formatIssue ? [reason, formatIssue, firstValidation?.fieldIssue].filter(Boolean).join(':') : reason),
            facets: missingFacetIds.join(', ') || '-',
          });
          const correctedValidation = validateAnswer(corrected.raw);
          if (correctedValidation?.valid) {
            answer = correctedValidation.content;
          } else {
            const correctedReason =
              correctedValidation && !correctedValidation.valid
                ? correctedValidation.reason
                : 'validator-unavailable';
            generation.validationFailures.push(correctedReason);
            const correctedMissingFacetIds =
              correctedValidation && !correctedValidation.valid
                ? correctedValidation.missingFacetIds
                : [];
            appLogger.warn('Indexed answer correction failed; returning verified evidence only.', {
              source: 'chat.indexed-review',
              data: {
                reason: correctedReason,
                missingFacetIds: correctedMissingFacetIds,
                formatIssue: correctedValidation?.formatIssue,
                fieldIssue: correctedValidation?.fieldIssue, ...(bindingFailure ? { bindingFailure } : {}),
              },
            });
          }
        }
      } else {
        answer = first.rendered;
        if (answer === null) {
          generation.validationFailures.push('invalid-format');
          answer = (await requestAnswer(first.raw)).rendered;
          if (answer === null) generation.validationFailures.push('invalid-format');
        }
      }
    } catch (error) {
      check();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      appLogger.warn('Final indexed review answer attempt failed.', { source: 'chat.indexed-review' });
      answer = null;
    }
    // provider 응답 도중 재색인이 시작돼도 이전 색인 답변을 게시하지 않습니다.
    if (options.isCurrent?.() === false) {
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return returnIndexing();
    }
    const resolved = answer !== null;
    const body = resolved
      ? [answer, comparisonLimitations].filter(Boolean).join('\n\n')
      : [evidenceOnlyContent(evidence), comparisonLimitations].filter(Boolean).join('\n\n');
    const showNotice = hasIncompleteCoverage || limitedReview || Boolean(comparisonLimitations) || !resolved;
    diagnostics.noticeLevel = showNotice ? 'warning' : 'detail';
    const content = [body, enumeration?.content, showNotice ? notice : ''].filter(Boolean).join('\n\n');
    options.onAnswer?.(content);
    options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
    if (hasIncompleteCoverage || limitedReview || !resolved)
      appLogger.warn('Finished the indexed document review with unresolved coverage.', {
        source: 'chat.indexed-review',
        data: {
          accepted: accepted.size,
          rejected: verificationRejected,
          budgetExcluded,
          stale: stale.size,
        },
      });
    const answerCitations = answer === null ? null : selectAnswerCitations(answer, [...citations.values()], 0);
    if (answerCitations) {
      const cited = new Set(answerCitations.map(item => item.id));
      generation.citedPositions = evidence.flatMap((item, index) => cited.has(item.sourceId) ? [index] : []);
    }
    return {
      outcome: resolved ? 'answered' : 'evidence-only',
      dossier,
      readDiscoveryPage,
      evidence,
      coverage: effectiveCoverage,
      content,
      citations: [...new Map([
        ...(answerCitations ?? citations.values()),
        ...(enumeration?.citations ?? []),
      ].map((citation) => [citation.id, citation])).values()],
      processedFiles: reviewed,
      totalFiles: total,
      rejectedFiles: verificationRejected,
      providerTransfer: {
        sentFiles: sentToProvider ? accepted.size : 0,
        sentPaths: sentToProvider ? [...accepted] : [],
      },
      coverageNotice: notice,
      diagnostics,
      engineUnavailable: false,
    };
  } finally {
    emitDiagnostics();
    finished = true;
  }
}
