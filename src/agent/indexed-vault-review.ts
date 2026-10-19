import { t } from '../i18n';
import { LLMProviderHttpError, type LLMProvider, type TokenUsage } from '../llm/providers';
import { prepareProviderRequest } from '../llm/request-budget';
import {
  planIndexedReviewInventoryRust,
  planIndexedReviewSegmentsRust,
  planModelContextRust,
  planResearchSummaryBatchesRust,
  planTurnUsageRust,
  renderIndexedReviewAnswerRust,
  scoreIndexedReviewSegmentsRust,
  validateIndexedReviewRust,
  validateIndexedReviewScreenRust,
  type IndexedReviewSegment,
  type IndexedReviewFinding,
} from '../rag/rust-core';
import type { SourceCitation, TurnUsageSnapshot } from '../chat/types';
import { appLogger } from '../utils/logger';
import { selectAnswerCitations } from './citation-selection';
import type {
  NativeVaultListResult,
  NativeVaultReadResult,
  NativeVaultSearchHit,
  NativeVaultSearchResult,
  NativeVaultToolRuntimeLike,
} from './native-vault-tool';
import type { VaultResearchProgress } from './research-agent';

/** 후보 세그먼트 상한과 screen 배치 크기입니다. */
const CANDIDATE_LIMIT = 128;
const SCREEN_BATCH_LIMIT = 16;
const REVIEW_CACHE_LIMIT = 64;
const REVIEW_CACHE_BYTES = 2 * 1024 * 1024;

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
  };
}

interface IndexedVaultReviewOptions {
  question: string;
  indexedPaths: readonly string[];
  scopes: readonly string[];
  nativeTool: NativeVaultToolRuntimeLike;
  provider: Pick<LLMProvider, 'streamChat' | 'contextBudget'>;
  systemPrompt?: string;
  previousUserQuestions?: readonly string[];
  searchQueries?: readonly string[];
  scoringQuestion?: string;
  reviewCache?: Map<string, string>;
  cacheScope?: string;
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
}

/** 전 문서 스크리닝 점수와 검색 하한 고정 여부를 보존합니다. */
interface ScoredReviewSegment {
  segment: IndexedReviewSegment;
  score: number;
  floorLocked: boolean;
}

/** 검색은 읽기 순서만 바꾸며 색인 전체의 명시적 검토가 끝나야 최종 답변을 생성합니다. */
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
    // 한 병렬 판정의 치명적 실패 뒤 다른 분기가 새 호출을 이어가지 못하게 합니다.
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
    },
  };
  const phaseRequests: Partial<Record<IndexedReviewPhase, TokenUsage[][]>> = {};
  let phaseStartedAt = performance.now();
  let activePhase: IndexedReviewPhase | undefined = 'inventory';
  let finished = false;
  const emitDiagnostics = () => {
    if (finished) return;
    if (activePhase)
      diagnostics.phases[activePhase].durationMs = performance.now() - phaseStartedAt;
    options.onDiagnostics?.(structuredClone(diagnostics));
  };
  const completePhase = (name: IndexedReviewPhase) => {
    diagnostics.phases[name].durationMs = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const next: Partial<Record<IndexedReviewPhase, IndexedReviewPhase>> = {
      inventory: 'search',
      search: 'map',
      map: 'screen',
      screen: 'extract',
      extract: 'reduce',
      reduce: 'answer',
    };
    activePhase = next[name];
    emitDiagnostics();
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
  const execute = async (request: Record<string, unknown>) => {
    check();
    const result = await interruptible(
      options.nativeTool.execute(JSON.stringify(request), options.signal),
    );
    check();
    return result.modelText;
  };
  try {
    emitDiagnostics();
    options.onProgress?.({ phase: 'inventory', completedFiles: 0, totalFiles: 0 });
    const visiblePaths: string[] = [];
    let cursor = 0;
    while (true) {
      const page = JSON.parse(
        await execute({ action: 'list', cursor, limit: 100 }),
      ) as NativeVaultListResult;
      visiblePaths.push(...page.files.map((file) => file.path));
      if (page.nextCursor === null) break;
      if (page.nextCursor <= cursor) throw new Error(t('vaultResearchListStalled'));
      cursor = page.nextCursor;
    }
    completePhase('inventory');
    let priorityPaths: string[] = [];
    let hits: NativeVaultSearchHit[] = [];
    try {
      const search = JSON.parse(
        await execute({
          action: 'search',
          query: options.question,
          queries: options.searchQueries,
          path: '',
          limit: 20,
          mode: 'auto',
          match: 'any',
        }),
      ) as NativeVaultSearchResult;
      hits = search.hits;
      priorityPaths = search.hits.map((hit) => hit.path);
    } catch (error) {
      check();
      appLogger.warn('Search prioritization failed; continuing the full indexed review.', {
        source: 'chat.indexed-review',
        error,
      });
    }
    completePhase('search');
    const paths = planIndexedReviewInventoryRust({
      indexedPaths: options.indexedPaths,
      visiblePaths,
      priorityPaths,
      scopes: options.scopes,
    });
    if (!paths) throw new Error(t('vaultResearchContractUnavailable'));
    if (paths.length === 0)
      return {
        content: t('indexedReviewEmpty'),
        citations: [],
        processedFiles: 0,
        totalFiles: 0,
        rejectedFiles: 0,
        providerTransfer: { sentFiles: 0, sentPaths: [] },
        coverageNotice: t('indexedReviewEmpty'),
        diagnostics,
      };

    const budget = options.provider.contextBudget ?? planModelContextRust({});
    if (!budget) throw new Error(t('vaultResearchContractUnavailable'));
    const batchChars = budget.evidenceChars;
    // 출력 한도를 모르는 모델은 추론에 출력 예산을 소진하기 쉬워 판정 묶음을 더 작게 보냅니다.
    const judgeBatchLimit = budget.outputSource === 'fallback' ? 4 : 8;
    const citations = new Map<string, SourceCitation>();
    const relevantPaths = new Set<string>();
    const sentPaths = new Set<string>();
    const screenedDocs = new Set<string>();
    const unreadablePaths = new Set<string>();
    const unresolvedPaths = new Set<string>();
    const scored: ScoredReviewSegment[] = [];
    let undecidedSegments = 0;
    let consecutiveJudgeFailures = 0;
    let judgingSuspended = false;
    let summaries: string[] = [];

    const request = async (
      name: IndexedReviewPhase,
      instruction: string,
      body: string,
      sourcePaths: Iterable<string> = [],
    ) => {
      check();
      const prepared = prepareProviderRequest(
        [
          { role: 'system', content: [t('llmEvidenceDataBoundary'), instruction].join('\n\n') },
          { role: 'user', content: body },
        ],
        undefined,
        budget.inputBytes,
      );
      const updates: TokenUsage[] = [];
      for (const path of sourcePaths) sentPaths.add(path);
      const requests = (phaseRequests[name] ??= []);
      requests.push(updates);
      const updateUsage = () => {
        const usage = planTurnUsageRust({ requests });
        if (usage) Object.assign(diagnostics.phases[name], usage);
        emitDiagnostics();
      };
      updateUsage();
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
              onUsage: (usage) => {
                if (options.signal?.aborted) return;
                updates.push({ ...usage });
                updateUsage();
              },
            },
          ),
        );
      } finally {
        updateUsage();
      }
      check();
      if (!content.trim()) throw new Error(t('indexedReviewIncomplete'));
      return content;
    };

    const compact = async () => {
      for (let round = 0; round < 16; round++) {
        if (summaries.join('\n\n').length <= batchChars) return;
        const batches = planResearchSummaryBatchesRust(
          summaries.map((text) => text.length + 2),
          8,
          batchChars,
        );
        if (!batches) throw new Error(t('vaultResearchBatchPlanFailed'));
        const before = summaries.join('\n\n').length;
        const next: string[] = [];
        for (const batch of batches) {
          const evidence = batch.flatMap((index) => (summaries[index] ? [summaries[index]] : []));
          if (evidence.length <= 1) {
            next.push(...evidence);
            continue;
          }
          try {
            diagnostics.counts.reduceRequests += 1;
            next.push(
              await request(
                'reduce',
                t('llmIndexedReviewReduce'),
                JSON.stringify({ question: options.question, evidence }),
                relevantPaths,
              ),
            );
          } catch (error) {
            check();
            if (error instanceof LLMProviderHttpError) throw error;
            appLogger.warn('Summary compression failed; keeping the original summaries.', {
              source: 'chat.indexed-review',
              error,
            });
            next.push(evidence.join('\n\n'));
          }
        }
        summaries = next;
        // 줄이지 못한 묶음만 남으면 원본 요약을 유지한 채 정상 종료합니다.
        if (summaries.join('\n\n').length >= before) return;
      }
    };

    const requestAnswer = async (): Promise<string | null> => {
      try {
        const response = await request(
          'answer',
          [options.systemPrompt, t('llmIndexedReviewAnswer')].filter(Boolean).join('\n\n'),
          JSON.stringify({
            question: options.question,
            previousUserQuestions: options.previousUserQuestions ?? [],
            evidence: summaries,
          }),
          relevantPaths,
        );
        return renderIndexedReviewAnswerRust([...citations.keys()], response);
      } catch (error) {
        check();
        if (error instanceof LLMProviderHttpError) throw error;
        appLogger.warn('Final indexed review answer attempt failed.', {
          source: 'chat.indexed-review',
          error,
        });
        return null;
      }
    };

    const generateAnswer = async (): Promise<string | null> => {
      const first = await requestAnswer();
      if (first !== null) return first;
      const second = await requestAnswer();
      if (second !== null) return second;
      appLogger.warn('Ending the indexed review with the incomplete notice.', {
        source: 'chat.indexed-review',
      });
      return null;
    };

    const markUndecided = (rows: readonly IndexedReviewSegment[]): void => {
      if (rows.length === 0) return;
      for (const row of rows) {
        undecidedSegments += 1;
        unresolvedPaths.add(row.path);
      }
      appLogger.warn('Left judged segments undecided; continuing the review.', {
        source: 'chat.indexed-review',
        data: { segments: rows.length },
      });
    };

    /** 빈 응답이 이어지면 같은 실패를 반복하지 않도록 판정 호출 자체를 멈춥니다. */
    const recordJudgeFailure = (): void => {
      consecutiveJudgeFailures += 1;
      if (consecutiveJudgeFailures < 8) return;
      judgingSuspended = true;
      appLogger.warn('Suspending indexed review judgments after repeated empty responses.', {
        source: 'chat.indexed-review',
      });
    };

    let activeJudgments = 0;
    const judgmentWaiters = new Set<() => void>();
    const requestJudgment = async <T>(
      name: 'screen' | 'extract',
      instruction: string,
      rows: readonly IndexedReviewSegment[],
      validate: (rows: readonly IndexedReviewSegment[], response: string) => T | null,
    ): Promise<T | null> => {
      check();
      const body = JSON.stringify({
        question: options.question,
        previousUserQuestions: options.previousUserQuestions ?? [],
        segments: rows,
      });
      const cache = options.cacheScope ? options.reviewCache : undefined;
      const cacheKey = JSON.stringify([
        options.cacheScope,
        t('llmEvidenceDataBoundary'),
        instruction,
        body,
      ]);
      const cached = cache?.get(cacheKey);
      if (cached !== undefined) {
        const result = validate(rows, cached);
        if (result) {
          diagnostics.counts.cacheHits += 1;
          return result;
        }
        cache?.delete(cacheKey);
      }
      // 실패 한도 직전에는 진행 중 판정을 기다려 병렬 호출이 한도를 넘지 않게 합니다.
      while (!judgingSuspended && consecutiveJudgeFailures + activeJudgments >= 8) {
        await interruptible(new Promise<void>((resolve) => judgmentWaiters.add(resolve)));
        check();
      }
      if (judgingSuspended) return null;
      activeJudgments += 1;
      try {
        const response = await request(
          name,
          instruction,
          body,
          rows.map((row) => row.path),
        );
        const result = validate(rows, response);
        if (!result) {
          recordJudgeFailure();
          return null;
        }
        consecutiveJudgeFailures = 0;
        if (cache) {
          // 현재 원문이 포함된 정확한 요청만 재사용하고 메모리 보관량도 제한합니다.
          const encoder = new TextEncoder();
          const bytes = encoder.encode(cacheKey).byteLength + encoder.encode(response).byteLength;
          if (bytes <= REVIEW_CACHE_BYTES) {
            cache.set(cacheKey, response);
            let totalBytes = 0;
            for (const [key, value] of cache)
              totalBytes += encoder.encode(key).byteLength + encoder.encode(value).byteLength;
            while (cache.size > REVIEW_CACHE_LIMIT || totalBytes > REVIEW_CACHE_BYTES) {
              const oldest = cache.entries().next().value;
              if (!oldest) break;
              totalBytes -=
                encoder.encode(oldest[0]).byteLength + encoder.encode(oldest[1]).byteLength;
              cache.delete(oldest[0]);
            }
          }
        }
        return result;
      } catch (error) {
        check();
        if (!(error instanceof LLMProviderHttpError)) recordJudgeFailure();
        throw error;
      } finally {
        activeJudgments -= 1;
        for (const resolve of judgmentWaiters) resolve();
        judgmentWaiters.clear();
      }
    };

    /** 검색이 지목한 구간과 겹치면 점수와 무관하게 후보로 고정합니다. */
    const lockedBySearchHit = (segment: IndexedReviewSegment): boolean =>
      hits.some((hit) => {
        if (hit.path !== segment.path) return false;
        if (!Number.isSafeInteger(hit.startLine)) return true;
        const endLine = typeof hit.endLine === 'number' ? hit.endLine : hit.startLine;
        return segment.startLine <= endLine && segment.endLine >= hit.startLine;
      });

    for (const path of paths) {
      check();
      options.onProgress?.({
        phase: 'map',
        completedFiles: screenedDocs.size,
        totalFiles: paths.length,
        currentPath: path,
      });
      let startLine = 1;
      let startOffset = 0;
      let readFailed = false;
      const segments: IndexedReviewSegment[] = [];
      while (true) {
        let raw: string;
        try {
          raw = await execute({
            action: 'read',
            path,
            start_line: startLine,
            start_offset: startOffset,
          });
        } catch (error) {
          check();
          unreadablePaths.add(path);
          readFailed = true;
          appLogger.warn('Source read failed; continuing the remaining indexed documents.', {
            source: 'chat.indexed-review',
            error,
          });
          break;
        }
        const rows = planIndexedReviewSegmentsRust(raw, batchChars);
        if (!rows || rows.some((row) => row.path !== path))
          throw new Error(t('indexedReviewIncomplete'));
        segments.push(...rows);
        const payload = JSON.parse(raw) as NativeVaultReadResult;
        if (!payload.truncated) break;
        const nextLine = payload.nextStartLine;
        const nextOffset = payload.nextStartOffset ?? 0;
        if (
          nextLine === null ||
          nextLine === undefined ||
          nextLine < startLine ||
          (nextLine === startLine && nextOffset <= startOffset)
        )
          throw new Error(t('indexedReviewIncomplete'));
        startLine = nextLine;
        startOffset = nextOffset;
      }
      if (readFailed) continue;
      // 점수 계산이 실패하면 조용히 빼지 않고 안전 측으로 1.0을 주어 후보로 남깁니다.
      for (const segment of segments) {
        scored.push({
          segment,
          score: 1,
          floorLocked: lockedBySearchHit(segment),
        });
      }
      screenedDocs.add(path);
      options.onProgress?.({
        phase: 'map',
        completedFiles: screenedDocs.size,
        totalFiles: paths.length,
        currentPath: path,
      });
    }

    const scores = scoreIndexedReviewSegmentsRust(
      options.scoringQuestion ?? options.question,
      scored.map((row) => row.segment),
      hits.map((hit, index) => ({
        path: hit.path,
        startLine: hit.startLine,
        endLine: hit.endLine,
        rank: index + 1,
      })),
    );
    for (const row of scored) row.score = scores?.get(row.segment.id) ?? 1;
    completePhase('map');

    const locked = scored.filter((row) => row.floorLocked);
    const candidates = [...locked];
    for (const row of scored
      .filter((item) => !item.floorLocked && item.score > 0)
      .sort((left, right) => right.score - left.score)) {
      if (candidates.length >= CANDIDATE_LIMIT) break;
      candidates.push(row);
    }
    const candidatePaths = new Set(candidates.map((row) => row.segment.path));
    const floorDocs = new Set(locked.map((row) => row.segment.path));
    const machineExcludedDocs = new Set(
      [...screenedDocs].filter((path) => !candidatePaths.has(path)),
    );

    const candidateById = new Map(candidates.map((row) => [row.segment.id, row.segment]));
    diagnostics.counts.candidateSegments = candidates.length;
    const accepted: IndexedReviewSegment[] = [];
    let screenedSegments = 0;
    const completeScreen = (rows: readonly IndexedReviewSegment[], undecided: boolean): void => {
      if (undecided) markUndecided(rows);
      screenedSegments += rows.length;
      options.onProgress?.({
        phase: 'screen',
        completedFiles: screenedSegments,
        totalFiles: candidates.length,
      });
    };

    const screenBatch = async (rows: readonly IndexedReviewSegment[]): Promise<void> => {
      if (judgingSuspended) {
        completeScreen(rows, true);
        return;
      }
      // 빈 응답·검증 실패는 한 번 더 시도하고, 그래도 실패하면 절반으로 나눠 판정합니다.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) diagnostics.counts.screenRetries += 1;
        try {
          const decisions = await requestJudgment(
            'screen',
            t('llmIndexedReviewScreen'),
            rows,
            validateIndexedReviewScreenRust,
          );
          if (!decisions) {
            if (judgingSuspended) {
              completeScreen(rows, true);
              return;
            }
            continue;
          }
          for (const decision of decisions) {
            const segment = candidateById.get(decision.id);
            if (decision.relevant && segment) accepted.push(segment);
          }
          completeScreen(rows, false);
          return;
        } catch (error) {
          check();
          if (error instanceof LLMProviderHttpError) throw error;
          appLogger.warn('Screen call failed; retrying or splitting the batch.', {
            source: 'chat.indexed-review',
            error,
          });
          if (judgingSuspended) {
            completeScreen(rows, true);
            return;
          }
        }
      }
      if (rows.length > 1) {
        diagnostics.counts.splitBatches += 1;
        const middle = Math.ceil(rows.length / 2);
        await screenBatch(rows.slice(0, middle));
        await screenBatch(rows.slice(middle));
        return;
      }
      completeScreen(rows, true);
    };

    const screenBatches = planResearchSummaryBatchesRust(
      candidates.map((row) => JSON.stringify(row.segment).length),
      SCREEN_BATCH_LIMIT,
      batchChars,
    );
    if (!screenBatches) throw new Error(t('vaultResearchBatchPlanFailed'));
    for (let index = 0; index < screenBatches.length; index += 2) {
      const pending = screenBatches.slice(index, index + 2).map((batch) => {
        const rows = batch.flatMap((item) => (candidates[item] ? [candidates[item].segment] : []));
        return rows.length > 0 ? screenBatch(rows) : Promise.resolve();
      });
      await Promise.all(pending);
      // 즉시 응답하는 로컬 provider에서도 취소·화면 갱신을 처리할 기회를 줍니다.
      await interruptible(new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)));
    }
    // 응답 도착 순서와 무관하게 검색·스크리닝의 원래 순서를 다음 단계에 전달합니다.
    const acceptedIds = new Set(accepted.map((row) => row.id));
    accepted.splice(
      0,
      accepted.length,
      ...candidates.filter((row) => acceptedIds.has(row.segment.id)).map((row) => row.segment),
    );
    diagnostics.counts.screenAcceptedSegments = accepted.length;
    completePhase('screen');

    let extractedSegments = 0;
    const findingsByBatch = new Map<string, IndexedReviewFinding[]>();
    const completeExtract = (rows: readonly IndexedReviewSegment[], undecided: boolean): void => {
      if (undecided) markUndecided(rows);
      else diagnostics.counts.extractedSegments += rows.length;
      extractedSegments += rows.length;
      options.onProgress?.({
        phase: 'extract',
        completedFiles: extractedSegments,
        totalFiles: accepted.length,
      });
    };

    const judgeBatch = async (rows: readonly IndexedReviewSegment[]): Promise<void> => {
      if (judgingSuspended) {
        completeExtract(rows, true);
        return;
      }
      // 빈 응답·검증 실패는 같은 본문을 반복하지 않고 절반으로 나눠 다시 판정합니다.
      const attempts = rows.length > 1 ? 1 : 2;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) diagnostics.counts.extractRetries += 1;
        try {
          const review = await requestJudgment(
            'extract',
            t('llmIndexedReviewJudge'),
            rows,
            validateIndexedReviewRust,
          );
          if (!review) {
            if (judgingSuspended) {
              completeExtract(rows, true);
              return;
            }
            continue;
          }
          if (rows[0]) findingsByBatch.set(rows[0].id, review.findings);
          completeExtract(rows, false);
          return;
        } catch (error) {
          check();
          if (error instanceof LLMProviderHttpError) throw error;
          appLogger.warn('Judge call failed; retrying with smaller pieces when possible.', {
            source: 'chat.indexed-review',
            error,
          });
          if (judgingSuspended) {
            completeExtract(rows, true);
            return;
          }
        }
      }
      if (rows.length > 1) {
        diagnostics.counts.splitBatches += 1;
        const middle = Math.ceil(rows.length / 2);
        await judgeBatch(rows.slice(0, middle));
        await judgeBatch(rows.slice(middle));
        return;
      }
      completeExtract(rows, true);
    };

    const extractBatches = planResearchSummaryBatchesRust(
      accepted.map((row) => JSON.stringify(row).length),
      judgeBatchLimit,
      batchChars,
    );
    if (!extractBatches) throw new Error(t('vaultResearchBatchPlanFailed'));
    for (let index = 0; index < extractBatches.length; index += 2) {
      const pending = extractBatches.slice(index, index + 2).map((batch) => {
        const rows = batch.flatMap((item) => (accepted[item] ? [accepted[item]] : []));
        return rows.length > 0 ? judgeBatch(rows) : Promise.resolve();
      });
      await Promise.all(pending);
      await interruptible(new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)));
    }
    for (const row of accepted) {
      for (const finding of findingsByBatch.get(row.id) ?? []) {
        relevantPaths.add(finding.path);
        citations.set(finding.sourceId, {
          id: finding.sourceId,
          filePath: finding.path,
          line: finding.startLine,
          endLine: finding.endLine,
          preview: finding.quote,
          status: 'verified',
        });
        summaries.push(JSON.stringify([finding]));
      }
    }
    completePhase('extract');

    check();
    await compact();
    completePhase('reduce');
    // 후보가 있었지만 채택 근거도 미판정도 없는 문서는 LLM 제외로 집계합니다.
    const rejectedDocs = new Set<string>();
    for (const path of candidatePaths) {
      if (relevantPaths.has(path) || unresolvedPaths.has(path)) continue;
      rejectedDocs.add(path);
    }
    const rejectedFiles = machineExcludedDocs.size + rejectedDocs.size;
    const coverage = t('indexedReviewCoverage', {
      total: paths.length,
      floor: floorDocs.size,
      machineExcluded: machineExcludedDocs.size,
      accepted: relevantPaths.size,
      rejected: rejectedDocs.size,
    });
    const notice = t('indexedReviewIncompleteNotice', {
      total: paths.length,
      screened: screenedDocs.size,
      floor: floorDocs.size,
      machineExcluded: machineExcludedDocs.size,
      accepted: relevantPaths.size,
      rejected: rejectedDocs.size,
      undecided: undecidedSegments,
      unreadable: unreadablePaths.size,
    });
    const partialReview = unreadablePaths.size > 0 || undecidedSegments > 0;
    let answer: string | null = null;
    if (summaries.length > 0 && !options.deferAnswer) {
      options.onProgress?.({
        phase: 'reduce',
        completedFiles: paths.length,
        totalFiles: paths.length,
      });
      answer = await generateAnswer();
      if (answer !== null) options.onAnswer?.(`${partialReview ? notice : coverage}\n\n${answer}`);
    }
    completePhase('answer');
    const answerFailed = !options.deferAnswer && summaries.length > 0 && answer === null;
    const noEvidence = partialReview || summaries.length > 0 ? null : t('indexedReviewNoEvidence');
    const body =
      options.deferAnswer && summaries.length > 0
        ? JSON.stringify({ evidence: summaries })
        : (answer ?? noEvidence);
    const content = answerFailed
      ? `${notice}\n\n${t('indexedReviewAnswerUnavailable')}`
      : body === null
        ? notice
        : `${partialReview ? notice : coverage}\n\n${body}`;
    options.onProgress?.({
      phase: 'complete',
      completedFiles: paths.length,
      totalFiles: paths.length,
    });
    const reviewStats = {
      reviewed: screenedDocs.size,
      accepted: relevantPaths.size,
      rejected: rejectedFiles,
      floor: floorDocs.size,
      machineExcluded: machineExcludedDocs.size,
      unreadable: unreadablePaths.size,
      undecided: undecidedSegments,
    };
    if (partialReview || answerFailed)
      appLogger.warn('Finished the indexed document review with unresolved coverage.', {
        source: 'chat.indexed-review',
        data: reviewStats,
      });
    else
      appLogger.notice('Completed the full indexed document review.', {
        source: 'chat.indexed-review',
        data: reviewStats,
      });
    return {
      content,
      citations: options.deferAnswer
        ? [...citations.values()]
        : selectAnswerCitations(answer ?? '', [...citations.values()], 0),
      totalFiles: paths.length,
      processedFiles: screenedDocs.size,
      rejectedFiles,
      providerTransfer: { sentFiles: sentPaths.size, sentPaths: [...sentPaths] },
      coverageNotice: partialReview || answerFailed ? notice : coverage,
      diagnostics,
    };
  } finally {
    emitDiagnostics();
    finished = true;
  }
}
