import { t } from '../i18n';
import {
  LLMProviderHttpError,
  type ChatMessage,
  type LLMProvider,
  type TokenUsage,
} from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  mergeIndexedEvidencePlansRust,
  planIndexedEvidenceRust,
  planModelContextRust,
  planTurnUsageRust,
  renderIndexedReviewAnswerRust,
  verifyIndexedEvidenceRust,
  type RustIndexedEvidenceBudget,
  type RustIndexedEvidenceCoverage,
  type RustIndexedEvidenceDocument,
  type RustIndexedEvidenceFilters,
  type RustIndexedEvidenceMergeResult,
  type RustIndexedEvidencePassage,
  type RustIndexedEvidencePlan,
  type RustIndexedEvidenceStatus,
} from '../rag/rust-core';
import type { FileIndexRecord, VectorEntry } from '../rag/store';
import type { SourceCitation, TurnUsageSnapshot } from '../chat/types';
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
  startLine?: number;
  endLine?: number;
  score: number;
  source: 'bm25' | 'lexical' | 'vector' | 'ann' | 'structural';
  rank: number;
}

/** 색인 전체 규모(이번 배치 밖 미검토 포함)를 엔진에 알리는 계약입니다. */
export interface IndexedEvidenceInventory {
  indexedCount: number;
  unreviewedCount: number;
  notIndexedCount: number;
}

/** 색인 저장소의 본문·리비전 조회 계약입니다. */
export interface IndexedVaultCorpus {
  getEntriesByFilePaths(paths: readonly string[]): Promise<readonly VectorEntry[]>;
  getFileIndexRecords(): Promise<readonly FileIndexRecord[]>;
}

export type IndexedVaultDocumentScope = 'all' | 'candidates';

export interface IndexedVaultSearchOptions {
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  corpus: IndexedVaultCorpus;
  /** 본문 조회 범위입니다. 기본값은 기존 채팅·리뷰 계약을 유지하는 `all`입니다. */
  documentScope?: IndexedVaultDocumentScope;
  candidates?: readonly IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
  filters?: RustIndexedEvidenceFilters;
  budget?: IndexedEvidenceBudget;
  signal?: AbortSignal;
}

export interface IndexedVaultSearchCoverage extends RustIndexedEvidenceCoverage {
  documentScope: IndexedVaultDocumentScope;
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
 * 엔진 plan 입력 문서입니다.
 * 엔진 `scan_input_document`는 title·headings·tags·codeBlocks를 optional로 받지만
 * 래퍼 타입(`RustIndexedEvidenceDocument`)에는 아직 headings가 없어 로컬에서만 더합니다.
 */
interface IndexedEvidencePlanDocument extends RustIndexedEvidenceDocument {
  /** 엔진 heading 필드 매칭에 쓰는 청크 헤딩 목록입니다. */
  headings?: readonly string[];
}

/**
 * 코퍼스 청크 메타데이터를 엔진 plan 입력 문서로 옮깁니다.
 * 실제로 확인되는 값만 싣고 없는 값은 키를 만들지 않아 엔진 기본값(경로 유도 title 등)을 씁니다.
 * title·tags·codeBlocks는 문서 코퍼스가 아직 전달하지 않아 이 경로에서는 비어 있습니다.
 * 수정 시각은 청크 `metadata.sourceMtime`(ms epoch)만 엔진 u64 계약에 맞춰 싣고,
 * 안전한 양의 정수가 아니면 키를 만들지 않아 엔진 입력 자체가 거절되지 않게 합니다.
 */
function planDocument(
  metadata: VectorEntry['metadata'],
  revision: string,
): IndexedEvidencePlanDocument {
  const heading = metadata.heading;
  const modifiedAt = metadata.sourceMtime;
  return {
    path: metadata.filePath,
    revision,
    indexed: true,
    reviewState: 'reviewed',
    text: metadata.text,
    startLine: metadata.startLine,
    ...(heading && heading.trim().length > 0 ? { headings: [heading] } : {}),
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
  if (record.contentHash && record.contentHash !== chunkHash) return null;
  // 해시와 파일 mtime·size는 비교 영역이 다르므로 원문 대조는 sourceMtime:sourceSize로만 합니다.
  if (record.sourceMtime === undefined || record.sourceSize === undefined) return null;
  return record.sourceMtime + ':' + record.sourceSize;
}

const RUST_INPUT_MAX_DOCUMENTS = 4096;
const RUST_INPUT_MAX_BYTES = 8 * 1024 * 1024;

/** payload 상한(문서 수·바이트)에 맞춰 자르고, 단독으로 상한을 넘는 청크는 미검토로 분리합니다. */
function partitionEvidencePayloads(
  documents: readonly RustIndexedEvidenceDocument[],
  oversizePaths: Set<string>,
): RustIndexedEvidenceDocument[][] {
  const batches: RustIndexedEvidenceDocument[][] = [];
  let current: RustIndexedEvidenceDocument[] = [];
  let bytes = 0;
  for (const document of documents) {
    // UTF-8 최악 3바이트/문자를 가정한 보수적 추정치입니다.
    const size = (document.text.length + 64) * 3;
    if (size > RUST_INPUT_MAX_BYTES) {
      oversizePaths.add(document.path);
      continue;
    }
    if (
      current.length > 0 &&
      (current.length >= RUST_INPUT_MAX_DOCUMENTS || bytes + size > RUST_INPUT_MAX_BYTES)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
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
  const scopedPaths =
    documentScope === 'candidates'
      ? candidateScopedPaths(options.indexedPaths, options.candidates)
      : options.indexedPaths;
  // 후보 범위에 읽을 경로가 없으면 저장소 구현이 전체 색인을 재구성하지 않도록 records도 읽지 않습니다.
  const records =
    documentScope === 'candidates' && scopedPaths.length === 0
      ? []
      : await options.corpus.getFileIndexRecords();
  options.signal?.throwIfAborted();
  const byPath = new Map(records.map((record) => [record.filePath, record]));
  const indexedPaths = scopedPaths.filter((path) => byPath.has(path));
  const totalIndexed = Math.max(options.indexedPaths.length, options.inventory?.indexedCount ?? 0);
  const scannedPaths = new Set<string>();
  const oversizePaths = new Set<string>();
  // 청크 해시·원문 리비전이 없어 엔진 입력에서 빠진 경로는 미검토로 남깁니다.
  const unreviewedPaths = new Set<string>();
  const inventoryFor = (): IndexedEvidenceInventory =>
    documentScope === 'candidates'
      ? {
          indexedCount: totalIndexed,
          // 후보 밖 색인 문서와 읽지 못한 후보는 모두 미검토로 남깁니다.
          unreviewedCount: Math.min(
            totalIndexed,
            Math.max(options.inventory?.unreviewedCount ?? 0, totalIndexed - scannedPaths.size),
          ),
          notIndexedCount: options.inventory?.notIndexedCount ?? 0,
        }
      : {
          indexedCount: options.inventory?.indexedCount ?? indexedPaths.length,
          unreviewedCount: (options.inventory?.unreviewedCount ?? 0) + unreviewedPaths.size,
          notIndexedCount: options.inventory?.notIndexedCount ?? 0,
        };
  const plans: RustIndexedEvidencePlan[] = [];
  const statuses: RustIndexedEvidenceStatus[] = [];
  for (let offset = 0; offset < indexedPaths.length; offset += EVIDENCE_PATH_BATCH) {
    options.signal?.throwIfAborted();
    const paths = indexedPaths.slice(offset, offset + EVIDENCE_PATH_BATCH);
    const entries = await options.corpus.getEntriesByFilePaths(paths);
    options.signal?.throwIfAborted();
    const documents: IndexedEvidencePlanDocument[] = [];
    const pathsWithDocuments = new Set<string>();
    for (const entry of entries) {
      const revision = evidenceRevision(byPath.get(entry.metadata.filePath), entry);
      if (revision === null) continue;
      scannedPaths.add(entry.metadata.filePath);
      pathsWithDocuments.add(entry.metadata.filePath);
      documents.push(planDocument(entry.metadata, revision));
    }
    for (const path of paths) {
      if (!pathsWithDocuments.has(path)) unreviewedPaths.add(path);
    }
    // payload 상한을 넘는 구간만 잘라 보내고, 상한 초과 단일 청크는 미검토로 남깁니다.
    for (const batch of partitionEvidencePayloads(documents, oversizePaths)) {
      options.signal?.throwIfAborted();
      const engineInput: IndexedEvidenceEngineInput = {
        question: options.question,
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
      for (const document of batch) {
        if (oversizePaths.has(document.path)) unreviewedPaths.add(document.path);
      }
      plans.push(plan);
      statuses.push(...verification.statuses);
    }
  }
  if (scannedPaths.size === 0 && documentScope === 'all') return null;
  if (plans.length === 0 && documentScope === 'candidates') {
    const engineInput: IndexedEvidenceEngineInput = {
      question: options.question,
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
  const merged = mergeIndexedEvidencePlansRust({
    plans: plans.map((plan) => ({
      ...plan,
      evidence: plan.evidence.filter((item) => bySource.get(item.sourceId)?.status === 'verified'),
    })),
    budget: { maxPassages: budget.maxPassages, maxChars: budget.maxChars },
  });
  if (!merged) return null;
  const plan = mergedEvidencePlan(plans, merged, budget, scannedPaths.size);
  if (!plan) return null;
  const selected = new Set(merged.evidence.map((item) => evidenceRowKey(item)));
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
  const finalCoverage: RustIndexedEvidenceCoverage =
    documentScope === 'candidates'
      ? {
          status:
            plan.coverage.status === 'budget-exhausted'
              ? 'budget-exhausted'
              : plan.coverage.status === 'incomplete' ||
                  finalInventory.unreviewedCount > 0 ||
                  finalInventory.notIndexedCount > 0
                ? 'incomplete'
                : 'supported',
          reviewedDocuments: Math.max(
            0,
            finalInventory.indexedCount - finalInventory.unreviewedCount,
          ),
          unreviewedDocuments: finalInventory.unreviewedCount,
          notIndexedDocuments: finalInventory.notIndexedCount,
        }
      : plan.coverage;
  const resultPlan = { ...plan, coverage: finalCoverage };
  return {
    plan: resultPlan,
    evidence: merged.evidence,
    rejected,
    coverage: { ...finalCoverage, documentScope },
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
}

export interface IndexedVaultReviewOptions {
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  corpus?: IndexedVaultCorpus;
  candidates?: readonly IndexedEvidenceCandidate[];
  inventory?: IndexedEvidenceInventory;
  /** 채택 문서의 현재 vault 리비전을 확인하는 caller 주입 reader입니다. */
  revisionReader?: (path: string) => Promise<string | null>;
  provider: Pick<LLMProvider, 'streamChat' | 'contextBudget'>;
  systemPrompt?: string;
  previousUserQuestions?: readonly string[];
  scoringQuestion?: string;
  deferAnswer?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
  onAnswer?: (content: string) => void;
  onDiagnostics?: (diagnostics: IndexedReviewDiagnostics) => void;
}

export interface IndexedVaultReviewResult {
  content: string;
  citations: SourceCitation[];
  processedFiles: number;
  totalFiles: number;
  rejectedFiles: number;
  providerTransfer: { sentFiles: number; sentPaths?: string[] };
  coverageNotice: string;
  diagnostics: IndexedReviewDiagnostics;
  /** 엔진이 선별하지 못했거나 리비전이 어긋나 도구 호출 fallback이 필요함을 알립니다. */
  toolFallback: boolean;
  engineUnavailable: boolean;
}

export async function reviewIndexedVault(
  options: IndexedVaultReviewOptions,
): Promise<IndexedVaultReviewResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    return await runIndexedVaultReview({ ...options, signal: controller.signal });
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
    const total = options.indexedPaths.length;
    const search = options.corpus
      ? await interruptible(
          searchIndexedVault({
            question: options.scoringQuestion ?? options.question,
            indexedPaths: options.indexedPaths,
            scopes: options.scopes,
            corpus: options.corpus,
            candidates: options.candidates,
            documentScope: 'all',
            inventory: options.inventory,
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
      appLogger.warn('Indexed evidence engine unavailable; deferring to tool calls.', {
        source: 'chat.indexed-review',
      });
      return {
        content,
        citations: [],
        processedFiles: 0,
        totalFiles: total,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: content,
        diagnostics,
        toolFallback: true,
        engineUnavailable: true,
      };
    }
    diagnostics.counts.candidateSegments = search.plan.evidence.length;
    diagnostics.counts.screenAcceptedSegments = search.evidence.length;
    diagnostics.counts.extractedSegments = search.evidence.length;
    activePhase = 'map';
    options.onProgress?.({ phase: 'map', completedFiles: 0, totalFiles: total });
    // 채택 문서만 현재 vault 리비전과 대조합니다.
    const adoptedPaths = [...new Set(search.evidence.map((item) => item.path))];
    const stale = new Set<string>();
    for (const path of adoptedPaths) {
      const expected = search.evidence.find((item) => item.path === path)?.revision ?? null;
      let current: string | null = null;
      // 원문 리비전을 한 번 더 확인하고, 그래도 어긋나면 verified로 승격하지 않습니다.
      for (let attempt = 0; attempt < 2; attempt++) {
        check();
        try {
          current = (await options.revisionReader?.(path)) ?? null;
        } catch (error) {
          check();
          current = null;
          appLogger.warn('Source revision read failed; treating the document as stale.', {
            source: 'chat.indexed-review',
            error,
          });
        }
        if (current !== null && current === expected) break;
      }
      if (expected === null || current === null || current !== expected) stale.add(path);
    }
    const evidence = search.evidence.filter((item) => !stale.has(item.path));
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
    const reviewed = search.coverage.reviewedDocuments;
    const machineExcluded =
      search.plan.diagnostics.droppedDocuments.belowThreshold +
      search.plan.diagnostics.droppedDocuments.filtered;
    const budgetExcluded = search.rejected.filter((item) => item.status === 'unreviewed').length;
    const verificationRejected = search.rejected.length - budgetExcluded;
    // 전역 예산·coverage·truncated는 엔진 병합 값을 그대로 두고, 엔진이 알 수 없는
    // 현재 vault 리비전(stale) 제거분만 별도 읽기 실패로 반영합니다.
    const hasIncompleteCoverage =
      search.coverage.status === 'incomplete' ||
      search.coverage.unreviewedDocuments > 0 ||
      search.coverage.notIndexedDocuments > 0 ||
      stale.size > 0;
    const effectiveCoverage = {
      ...search.coverage,
      status: hasIncompleteCoverage ? ('incomplete' as const) : search.coverage.status,
    };
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
    const evidencePayload = evidence.map((item) => ({
      sourceId: item.sourceId,
      path: item.path,
      startLine: item.startLine,
      endLine: item.endLine,
      quote: item.quote,
      contextBefore: item.contextBefore,
      contextAfter: item.contextAfter,
    }));
    activePhase = 'answer';
    emitDiagnostics();
    if (options.deferAnswer || evidence.length === 0) {
      const content =
        evidence.length === 0
          ? hasIncompleteCoverage || limitedReview
            ? notice
            : t('indexedReviewNoEvidence')
          : JSON.stringify({ evidence: evidencePayload });
      options.onProgress?.({ phase: 'complete', completedFiles: total, totalFiles: total });
      return {
        content,
        citations: [...citations.values()],
        processedFiles: reviewed,
        totalFiles: total,
        rejectedFiles: verificationRejected,
        providerTransfer: { sentFiles: accepted.size, sentPaths: [...accepted] },
        coverageNotice: notice,
        diagnostics,
        toolFallback: evidence.length === 0,
        engineUnavailable: false,
      };
    }
    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) throw new Error(t('vaultResearchContractUnavailable'));
    const usage: TokenUsage[][] = [];
    const requestAnswer = async (
      previousAnswer?: string,
    ): Promise<{ raw: string; rendered: string | null }> => {
      check();
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: [t('llmEvidenceDataBoundary'), options.systemPrompt, t('llmIndexedReviewAnswer')]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            question: options.question,
            previousUserQuestions: options.previousUserQuestions ?? [],
            evidence: evidencePayload,
          }),
        },
      ];
      if (previousAnswer !== undefined) {
        if (previousAnswer.trim()) {
          messages.push({ role: 'assistant', content: previousAnswer });
        }
        messages.push({ role: 'user', content: t('llmIndexedReviewAnswerCorrection') });
      }
      const prepared = prepareProviderRequest(messages, undefined, budget.inputBytes);
      const updates: TokenUsage[] = [];
      usage.push(updates);
      if (previousAnswer !== undefined) diagnostics.counts.answerCorrectionRequests = 1;
      let content = '';
      try {
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
        rendered: content.trim()
          ? renderIndexedReviewAnswerRust([...citations.keys()], content)
          : null,
      };
    };
    let answer: string | null = null;
    try {
      // 정상 해석 1회와 결정적 인용 형식 오류 교정 1회까지만 허용합니다.
      const first = await requestAnswer();
      answer = first.rendered;
      if (answer === null) answer = (await requestAnswer(first.raw)).rendered;
    } catch (error) {
      check();
      if (error instanceof LLMProviderHttpError) throw error;
      appLogger.warn('Final indexed review answer attempt failed.', {
        source: 'chat.indexed-review',
        error,
      });
      answer = null;
    }
    const resolved = answer !== null;
    const body = resolved ? answer : t('indexedReviewAnswerUnavailable');
    const content = notice + '\n\n' + body;
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
      content,
      citations: selectAnswerCitations(answer ?? '', [...citations.values()], 0),
      processedFiles: reviewed,
      totalFiles: total,
      rejectedFiles: verificationRejected,
      providerTransfer: { sentFiles: accepted.size, sentPaths: [...accepted] },
      coverageNotice: notice,
      diagnostics,
      toolFallback: false,
      engineUnavailable: false,
    };
  } finally {
    emitDiagnostics();
    finished = true;
  }
}
