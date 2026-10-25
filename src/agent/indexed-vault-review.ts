import { t } from '../i18n';
import type { ChatMessage, LLMProvider, TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  mergeIndexedEvidencePlansRust,
  planIndexedEvidenceRust,
  planIndexedReviewAnswerPlanRust,
  planModelContextRust,
  planTurnUsageRust,
  renderIndexedReviewAnswerRust,
  validateIndexedReviewAnswerRust,
  verifyIndexedEvidenceRust,
  type IndexedSearchPlan,
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
} from '../rag/rust-core';
import type { FileIndexRecord, VectorEntry } from '../rag/store';
import type { SourceCitation, TurnUsageSnapshot } from '../chat/types';
import type { IndexedEvidenceSourceSnapshot } from '../search/engine-adapter';
import type { SearchCandidateState } from '../search/engine-port';
import { appLogger } from '../utils/logger';
import { selectAnswerCitations } from './citation-selection';
import type { VaultResearchProgress } from './research-agent';

/** 색인 본문·리비전만으로 근거를 선별하는 엔진 연결(provider 미사용)입니다. */
export type IndexedEvidenceItem = RustIndexedEvidencePassage;
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

const EVIDENCE_PATH_BATCH = 256;

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
    const size = encoder.encode(JSON.stringify(document)).byteLength + 1;
    if (
      encoder.encode(document.text).byteLength > RUST_DOCUMENT_MAX_BYTES ||
      envelopeBytes + size > RUST_INPUT_MAX_BYTES
    ) {
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
  const unreviewedDocuments = Math.max(
    finalInventory.unreviewedCount,
    plan.coverage.unreviewedDocuments,
    unreviewedPaths.size +
      (documentScope === 'all' && !exhaustiveReview
        ? scopeCount - requestedPaths.length
        : 0),
  );
  const notIndexedDocuments = Math.max(
    finalInventory.notIndexedCount,
    plan.coverage.notIndexedDocuments,
  );
  const finalCoverage: RustIndexedEvidenceCoverage = {
    status:
      unreviewedDocuments > 0 || (documentScope === 'all' && notIndexedDocuments > 0)
        ? 'incomplete'
        : plan.coverage.status === 'budget-exhausted'
          ? 'budget-exhausted'
          : 'supported',
    reviewedDocuments: Math.max(0, scopeCount - unreviewedDocuments),
    unreviewedDocuments,
    notIndexedDocuments,
  };
  const resultPlan = { ...plan, coverage: finalCoverage };
  return {
    plan: resultPlan,
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

export interface IndexedReviewDiagnostics {
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
  };
  /** 최종 리뷰 결과 종류입니다. 디버그 추적에서 답변이 왜 근거만 나왔는지 판단할 때 씁니다. */
  outcome?: IndexedReviewOutcome;
  /** 엔진 선별 단계의 진단입니다. 후보가 0건인 이유를 그대로 보존합니다. */
  search?: IndexedEvidencePlan['diagnostics'] | null;
}

export interface IndexedVaultReviewOptions {
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  corpus?: IndexedVaultCorpus;
  documentScope?: IndexedVaultDocumentScope;
  candidates?: readonly IndexedEvidenceCandidate[];
  candidatesState?: SearchCandidateState;
  inventory?: IndexedEvidenceInventory;
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
  /** 검색 도중 재색인·corpus refresh가 시작되면 결과를 폐기합니다. */
  isCurrent?: () => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
  onAnswer?: (content: string) => void;
  onDiagnostics?: (diagnostics: IndexedReviewDiagnostics) => void;
}

/** 엔진이 검증한 근거와 범위만 해석 모델에 전달하는 정규 계약입니다. */
export interface IndexedEvidenceDossier {
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
  evidence: readonly IndexedEvidenceItem[];
  coverage: IndexedVaultSearchCoverage;
  diagnostics: IndexedEvidencePlan['diagnostics'] | null;
  notice: string;
  searchPlan?: IndexedSearchPlan;
  answerPlan?: RustIndexedReviewAnswerPlan;
}

export type IndexedReviewOutcome =
  | 'answered'
  | 'evidence-only'
  | 'no-evidence'
  | 'engine-unavailable'
  | 'indexing';

export interface IndexedVaultReviewResult {
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
  source: { revision: string; text: string },
): RustIndexedEvidenceVerificationDocument | null {
  const lines = source.text.split('\n');
  if (lines.length === 0) return null;
  const start = Math.max(1, Math.min(item.startLine, lines.length) - 3);
  const end = Math.min(lines.length, Math.max(item.endLine, item.startLine) + 3);
  const text = lines.slice(start - 1, end).join('\n') + (end < lines.length ? '\n' : '');
  if (encoder.encode(text).byteLength > VERIFICATION_WINDOW_BYTES) return null;
  return {
    path: item.path,
    text,
    startLine: start,
    revision: source.revision,
    indexed: true,
    reviewState: 'reviewed',
  };
}

export async function reviewIndexedVault(
  options: IndexedVaultReviewOptions,
): Promise<IndexedVaultReviewResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    const result = await runIndexedVaultReview({ ...options, signal: controller.signal });
    // 엔진 진단과 결과 종류를 남겨야 후속 디버그 추적이 0건 원인을 설명할 수 있습니다.
    result.diagnostics.outcome = result.outcome;
    result.diagnostics.search = result.dossier.diagnostics ?? null;
    return result;
  } finally {
    controller.abort();
    options.signal?.removeEventListener('abort', cancel);
  }
}

async function runIndexedVaultReview(
  options: IndexedVaultReviewOptions,
): Promise<IndexedVaultReviewResult> {
  const phase = (): IndexedReviewPhaseDiagnostics => ({
    durationMs: 0,
    requests: 0,
    reportedRequests: 0,
  });
  const diagnostics: IndexedReviewDiagnostics = {
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
  const phaseStartedAt = performance.now();
  let activePhase: IndexedReviewPhase = 'inventory';
  const emitDiagnostics = () => {
    diagnostics.phases[activePhase].durationMs = performance.now() - phaseStartedAt;
    if (!finished) options.onDiagnostics?.(structuredClone(diagnostics));
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
    const total =
      documentScope === 'candidates'
        ? new Set(options.candidates?.map((candidate) => candidate.path) ?? []).size
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
    if (options.candidatesState === 'indexing') {
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
    const search = options.corpus
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
    activePhase = 'search';
    if (!search) {
      emitDiagnostics();
      activePhase = 'answer';
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
    diagnostics.counts.candidateSegments = search.plan.evidence.length;
    diagnostics.counts.screenAcceptedSegments = search.evidence.length;
    diagnostics.counts.extractedSegments = search.evidence.length;
    activePhase = 'map';
    options.onProgress?.({ phase: 'map', completedFiles: 0, totalFiles: total });
    // 채택 문서만 현재 vault 원문과 revision으로 다시 검증합니다.
    const adoptedPaths = [...new Set(search.evidence.map((item) => item.path))];
    const stale = new Set<string>();
    const currentSources = new Map<
      string,
      {
        revision: string;
        text: string;
        contentHash?: string;
        chunks?: readonly { text: string; startLine: number; endLine: number }[];
      }
    >();
    for (const path of adoptedPaths) {
      const expected = search.evidence.find((item) => item.path === path)?.revision ?? null;
      let current: string | null = null;
      if (options.sourceReader) {
        check();
        try {
          const snapshot = await interruptible(options.sourceReader(path, options.signal));
          current = snapshot.revision;
          if (snapshot.revision !== null && snapshot.text !== null) {
            currentSources.set(path, {
              revision: snapshot.revision,
              text: snapshot.text,
              ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}),
              ...(snapshot.chunks ? { chunks: snapshot.chunks } : {}),
            });
          }
        } catch (error) {
          check();
          if (error instanceof Error && error.name === 'AbortError') throw error;
          current = null;
        }
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
      if (
        expected === null ||
        current === null ||
        current !== expected ||
        (options.sourceReader !== undefined && !currentSources.has(path))
      ) {
        stale.add(path);
      }
    }
    let evidence = search.evidence.filter((item) => !stale.has(item.path));
    if (options.sourceReader && evidence.length > 0) {
      const verificationDocuments = new Map<string, RustIndexedEvidenceVerificationDocument>();
      const rejectedPaths = new Set<string>();
      const verifiableEvidence = evidence.filter((item) => {
        const source = currentSources.get(item.path);
        if (!source) {
          rejectedPaths.add(item.path);
          return false;
        }
        if (source.chunks && source.chunks.length > 0) {
          for (const chunk of source.chunks) {
            verificationDocuments.set(
              `${item.path}\u0000${chunk.startLine}\u0000${chunk.text.length}`,
              {
                path: item.path,
                text: chunk.text,
                startLine: chunk.startLine,
                revision: source.revision,
                indexed: true,
                reviewState: 'reviewed',
              },
            );
          }
          return true;
        }
        const document = verificationWindow(item, source);
        if (!document) {
          rejectedPaths.add(item.path);
          return false;
        }
        verificationDocuments.set(`${item.path}\u0000${document.startLine}`, document);
        return true;
      });
      if (verifiableEvidence.length > 0) {
        const currentVerification = verifyIndexedEvidenceRust({
          evidence: verifiableEvidence.map((item) => ({
            sourceId: item.sourceId,
            path: item.path,
            quote: item.quote,
            ...(item.revision !== null ? { revision: item.revision } : {}),
            startLine: item.startLine,
            endLine: item.endLine,
          })),
          documents: [...verificationDocuments.values()],
          scopes: options.scopes,
        });
        if (!currentVerification) {
          for (const item of verifiableEvidence) rejectedPaths.add(item.path);
          appLogger.warn(
            'Current source verification unavailable; discarding unverified evidence.',
            {
              source: 'chat.indexed-review',
            },
          );
        } else {
          const statuses = new Map(
            currentVerification.statuses.map((status) => [status.sourceId, status]),
          );
          const rejectedByStatus = new Map<string, number>();
          const rejectedByExtension = new Map<string, number>();
          for (const item of verifiableEvidence) {
            if (statuses.get(item.sourceId)?.status === 'verified') continue;
            const status = statuses.get(item.sourceId)?.status ?? 'missing-status';
            const extension = item.path.split('.').pop() ?? '';
            rejectedByStatus.set(status, (rejectedByStatus.get(status) ?? 0) + 1);
            rejectedByExtension.set(extension, (rejectedByExtension.get(extension) ?? 0) + 1);
            rejectedPaths.add(item.path);
          }
          if (rejectedPaths.size > 0) {
            appLogger.debug('Current source verification rejected evidence.', {
              source: 'chat.indexed-review',
              data: {
                statuses: Object.fromEntries(rejectedByStatus),
                extensions: Object.fromEntries(rejectedByExtension),
              },
            });
          }
        }
      }
      for (const path of rejectedPaths) stale.add(path);
      evidence = evidence.filter((item) => !rejectedPaths.has(item.path));
    }
    if (options.sourceReader && stale.size > 0) {
      // 색인 뒤에 원문이 바뀐 문서도 인용이 현재 본문에 남아 있으면 근거로 복구합니다.
      // 색인 지연만으로 검토 대상이 통째로 사라지면 답변이 근거를 잃습니다.
      const freshDocuments: RustIndexedEvidenceDocument[] = [];
      for (const path of stale) {
        const source = currentSources.get(path);
        if (!source || source.text === null) continue;
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
        // 재선택 전에 원래 구절을 보존합니다. 주소 계산은 Rust가 맡고 제안도 엄격히 재검증합니다.
        const original = search.evidence.filter((item) => stale.has(item.path));
        const relocation = verifyIndexedEvidenceRust({
          evidence: original.map(({ revision, ...item }) => ({
            ...item,
            ...(revision !== null ? { revision } : {}),
          })),
          documents: freshDocuments,
          scopes: options.scopes,
        });
        const suggested = new Map(
          relocation?.statuses.map((status) => [status.sourceId, status.relocation]),
        );
        const relocated = original.flatMap((item) => {
          const address = suggested.get(item.sourceId);
          return address
            ? [
                {
                  ...item,
                  ...address,
                  contentHash: currentSources.get(item.path)?.contentHash,
                  contextBefore: '',
                  contextAfter: '',
                },
              ]
            : [];
        });
        if (relocated.length > 0) {
          const verification = verifyIndexedEvidenceRust({
            evidence: relocated,
            documents: freshDocuments,
            scopes: options.scopes,
          });
          const verified = new Set(
            verification?.statuses
              .filter((status) => status.status === 'verified')
              .map((status) => status.sourceId),
          );
          const preserved = relocated.filter((item) => verified.has(item.sourceId));
          evidence = [...evidence, ...preserved];
          for (const item of preserved) stale.delete(item.path);
          appLogger.debug('Preserved selected quotes at verified current source addresses.', {
            source: 'chat.indexed-review',
            data: { preserved: preserved.length },
          });
        }
        const unresolved = freshDocuments.filter((document) => stale.has(document.path));
        const recoveryBudget = DEFAULT_EVIDENCE_BUDGET;
        const recoveryPlan =
          unresolved.length > 0
            ? planIndexedEvidenceRust({
                question: options.scoringQuestion ?? options.question,
                queryVariants: options.queryVariants,
                documents: unresolved,
                scopes: options.scopes,
                candidates: options.candidates ? [...options.candidates] : undefined,
                ...(options.filters ? { filters: options.filters } : {}),
                budget: recoveryBudget,
                inventory: {
                  indexedCount: unresolved.length,
                  unreviewedCount: 0,
                  notIndexedCount: 0,
                },
              })
            : null;
        if (recoveryPlan && recoveryPlan.evidence.length > 0) {
          const recoveryVerification = verifyIndexedEvidenceRust({
            evidence: recoveryPlan.evidence.map((item) => ({
              sourceId: item.sourceId,
              path: item.path,
              ...(item.revision !== null ? { revision: item.revision } : {}),
              startLine: item.startLine,
              endLine: item.endLine,
              quote: item.quote,
            })),
            documents: freshDocuments,
            scopes: options.scopes,
          });
          const verified = recoveryVerification
            ? new Set(
                recoveryVerification.statuses
                  .filter((status) => status.status === 'verified')
                  .map((status) => status.sourceId),
              )
            : new Set<string>();
          const recovered = recoveryPlan.evidence.filter(
            (item) =>
              verified.has(item.sourceId) &&
              !evidence.some((existing) => existing.path === item.path),
          );
          if (recovered.length > 0) {
            for (const item of recovered) stale.delete(item.path);
            evidence = [...recovered, ...evidence].slice(0, recoveryBudget.maxPassages);
            appLogger.debug('Recovered evidence from documents changed after indexing.', {
              source: 'chat.indexed-review',
              data: { recovered: recovered.length },
            });
          }
        }
      }
    }
    const answerPlan = options.searchPlan
      ? (planIndexedReviewAnswerPlanRust({
          searchPlan: options.searchPlan,
          evidence: evidence.map((item) => ({
            sourceId: item.sourceId,
            path: item.path,
            quote: item.quote,
            ...(item.queryIndexes !== undefined ? { queryIndexes: item.queryIndexes } : {}),
          })),
        }) ?? undefined)
      : undefined;
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
    const verificationRejected = search.rejected.length - budgetExcluded;
    // 전역 예산·coverage·truncated는 엔진 병합 값을 그대로 두고, 엔진이 알 수 없는
    // 현재 vault 리비전(stale) 제거분만 별도 읽기 실패로 반영합니다.
    const unreviewedPaths = [...new Set([...search.coverage.unreviewedPaths, ...stale])];
    const newlyStale = [...stale].filter(
      (path) => !search.coverage.unreviewedPaths.includes(path),
    ).length;
    const hasIncompleteCoverage = search.coverage.status === 'incomplete' || stale.size > 0;
    const effectiveCoverage: IndexedVaultSearchCoverage = {
      ...search.coverage,
      status: hasIncompleteCoverage ? ('incomplete' as const) : search.coverage.status,
      reviewedDocuments: Math.max(0, search.coverage.reviewedDocuments - newlyStale),
      unreviewedDocuments: search.coverage.unreviewedDocuments + newlyStale,
      unreviewedPaths,
    };
    const reviewed = effectiveCoverage.reviewedDocuments;
    const noticeValues = {
      total,
      machineExcluded,
      accepted: accepted.size,
      rejected: verificationRejected,
      budgetExcluded,
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
    const dossier: IndexedEvidenceDossier = {
      question: options.question,
      scoringQuestion: options.scoringQuestion ?? options.question,
      previousUserQuestions: options.previousUserQuestions ?? [],
      queryPlan: { queryTokens: search.plan.queryTokens, phrases: search.plan.phrases },
      matchInventory: options.matchInventory,
      documentScope,
      evidence,
      coverage: effectiveCoverage,
      diagnostics: search.plan.diagnostics,
      notice,
      ...(options.searchPlan ? { searchPlan: options.searchPlan } : {}),
      ...(answerPlan ? { answerPlan } : {}),
    };
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
    activePhase = 'answer';
    emitDiagnostics();
    const comparisonLimitations = comparisonLimitNotice(options.searchPlan, answerPlan);
    const finishAsEvidenceOnly = (limitations: string): IndexedVaultReviewResult => {
      const body =
        evidence.length === 0
          ? t('indexedReviewNoEvidence')
          : evidenceOnlyContent(evidence);
      const content = [body, limitations, notice].filter(Boolean).join('\n\n');
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return {
        outcome: 'evidence-only',
        dossier,
        evidence,
        coverage: effectiveCoverage,
        content,
        citations: [...citations.values()],
        processedFiles: reviewed,
        totalFiles: total,
        rejectedFiles: verificationRejected,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: notice,
        diagnostics,
        engineUnavailable: false,
      };
    };
    if (options.searchPlan && !answerPlan) {
      appLogger.warn('Indexed answer plan unavailable; returning verified evidence only.', {
        source: 'chat.indexed-review',
      });
      return finishAsEvidenceOnly(comparisonLimitations);
    }
    if (answerPlan?.mode === 'comparison' && answerPlan.requiredFacetIds.length === 0) {
      appLogger.warn(
        'Indexed comparison has no supported subject facet; returning verified evidence only.',
        {
          source: 'chat.indexed-review',
        },
      );
      return finishAsEvidenceOnly(comparisonLimitations);
    }
    if (options.deferAnswer || evidence.length === 0) {
      const body =
        evidence.length === 0
          ? t('indexedReviewNoEvidence')
          : evidenceOnlyContent(evidence);
      const content = [body, comparisonLimitations, notice].filter(Boolean).join('\n\n');
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return {
        outcome: evidence.length === 0 ? 'no-evidence' : 'evidence-only',
        dossier,
        evidence,
        coverage: effectiveCoverage,
        content,
        citations: [...citations.values()],
        processedFiles: reviewed,
        totalFiles: total,
        rejectedFiles: verificationRejected,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: notice,
        diagnostics,
        engineUnavailable: false,
      };
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
      if (!budget) throw new Error(t('vaultResearchContractUnavailable'));
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: [t('llmEvidenceDataBoundary'), options.systemPrompt, t('llmIndexedReviewAnswer')]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(dossier),
        },
      ];
      if (previousAnswer !== undefined) {
        if (previousAnswer.trim()) {
          messages.push({ role: 'assistant', content: previousAnswer });
        }
        messages.push({
          role: 'user',
          content: t('llmIndexedReviewAnswerCorrection', correction),
        });
      }
      const prepared = prepareProviderRequest(messages, undefined, budget.inputBytes);
      const updates: TokenUsage[] = [];
      usage.push(updates);
      if (previousAnswer !== undefined) diagnostics.counts.answerCorrectionRequests = 1;
      let content = '';
      try {
        sentToProvider = true;
        await interruptible(
          options.provider.streamChat(
            prepared.messages,
            (chunk) => {
              if (options.signal?.aborted) return;
              content += chunk.content ?? '';
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
        const firstValidation = validateIndexedReviewAnswerRust({
          sourceIds: [...citations.keys()],
          answerPlan,
          response: first.raw,
        });
        if (firstValidation?.valid) {
          answer = firstValidation.content;
        } else {
          const reason =
            firstValidation && !firstValidation.valid
              ? firstValidation.reason
              : 'validator-unavailable';
          const missingFacetIds =
            firstValidation && !firstValidation.valid ? firstValidation.missingFacetIds : [];
          const formatIssue =
            firstValidation && !firstValidation.valid ? firstValidation.formatIssue : undefined;
          appLogger.warn('Indexed answer failed facet validation; attempting one correction.', {
            source: 'chat.indexed-review',
            data: { reason, missingFacetIds, formatIssue },
          });
          const corrected = await requestAnswer(first.raw, {
            reason: formatIssue ? `${reason}:${formatIssue}` : reason,
            facets: missingFacetIds.join(', ') || '-',
          });
          const correctedValidation = validateIndexedReviewAnswerRust({
            sourceIds: [...citations.keys()],
            answerPlan,
            response: corrected.raw,
          });
          if (correctedValidation?.valid) {
            answer = correctedValidation.content;
          } else {
            const correctedReason =
              correctedValidation && !correctedValidation.valid
                ? correctedValidation.reason
                : 'validator-unavailable';
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
              },
            });
          }
        }
      } else {
        answer = first.rendered;
        if (answer === null) answer = (await requestAnswer(first.raw)).rendered;
      }
    } catch (error) {
      check();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      appLogger.warn('Final indexed review answer attempt failed.', {
        source: 'chat.indexed-review',
        error,
      });
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
    const content = [body, notice].filter(Boolean).join('\n\n');
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
    return {
      outcome: resolved ? 'answered' : 'evidence-only',
      dossier,
      evidence,
      coverage: effectiveCoverage,
      content,
      citations:
        answer !== null
          ? selectAnswerCitations(answer, [...citations.values()], 0)
          : [...citations.values()],
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
