import type { TAbstractFile, TFile, Vault } from 'obsidian';
import type { EmbeddingProvider } from '../llm/embedding';
import { assertValidEmbeddingBatch } from '../llm/embedding-validation';
import type { VectorStore, VectorEntry, FileIndexRecord } from './store';
import {
  getRagCandidateFiles,
  isExcludedPath,
  isExcludedExt,
  isRagIndexableFile,
} from '../utils/vault';
import type { RAGConfig, ChatConfig } from '../settings';
import { calculateRagStatus } from './status';
import type { IndexedDbBM25Index } from './bm25';
import { createContentHash } from './hash';
import {
  chunkMarkdownRust,
  chunkPlainTextRust,
  planIndexPendingFilesRust,
  planRagAutomaticRecoveryBatchRust,
} from './rust-core';
import type { PerformanceGuardState } from './performance-guard';
import { appLogger, type AppLogger, type ScopedLogger } from '../utils/logger';
import { normalizeRustIndices } from '../utils/rust-index-plan';

export class IndexingCancelledError extends Error {
  constructor() {
    super('RAG indexing cancelled');
    this.name = 'IndexingCancelledError';
  }
}

export class IndexingPerformancePausedError extends Error {
  constructor() {
    super('RAG indexing paused by performance guard');
    this.name = 'IndexingPerformancePausedError';
  }
}

export interface IndexingOptions {
  signal?: AbortSignal;
  maxEmbeddingBatchSize?: number;
  indexingYieldMs?: number;
  getMaxEmbeddingBatchSize?: () => number;
  getIndexingYieldMs?: () => number;
  onBatchComplete?: (durationMs: number, batchSize: number) => void | Promise<void>;
  onProgress?: (progress: RagIndexingProgressSnapshot) => void;
  getPerformanceGuardState?: () => PerformanceGuardState | null;
  automaticRecovery?: boolean;
}

export type RagIndexingProgressEvent =
  | 'plan'
  | 'file-start'
  | 'file-chunks'
  | 'batch-complete'
  | 'file-complete';

export interface RagIndexingProgressSnapshot {
  event: RagIndexingProgressEvent;
  startedAtMs: number;
  nowMs: number;
  totalFiles: number;
  completedFiles: number;
  currentFilePath?: string;
  currentFileIndex?: number;
  currentFileTotalChunks: number;
  currentFileEmbeddedChunks: number;
  totalEstimatedChunks: number;
  completedEstimatedChunks: number;
  currentFileEstimatedChunks: number;
  totalPlannedChunks: number;
  completedPlannedChunks: number;
  currentFilePlannedChunks: number;
  planningComplete: boolean;
  indexed: number;
  vectors: number;
  skipped: number;
  completedBatchDurationsMs: readonly number[];
  completedBatchChunkCounts: readonly number[];
  completedFileDurationsMs: readonly number[];
  completedFileChunkCounts: readonly number[];
  completedFileEstimatedChunkCounts: readonly number[];
  completedFileActualChunkCounts: readonly number[];
  completedFileOverheadDurationsMs: readonly number[];
  historicalMsPerChunk: number | null;
  historicalChunkEstimateRatio: number | null;
  historicalVariance: number | null;
}

interface IndexingProgressTracker {
  startedAtMs: number;
  totalFiles: number;
  completedFiles: number;
  currentFilePath?: string;
  currentFileIndex?: number;
  currentFileTotalChunks: number;
  currentFileEmbeddedChunks: number;
  totalEstimatedChunks: number;
  completedEstimatedChunks: number;
  currentFileEstimatedChunks: number;
  totalPlannedChunks: number;
  completedPlannedChunks: number;
  currentFilePlannedChunks: number;
  planningComplete: boolean;
  plannedChunkCountsByPath: Map<string, number>;
  indexed: number;
  vectors: number;
  skipped: number;
  completedBatchDurationsMs: number[];
  completedBatchChunkCounts: number[];
  completedFileDurationsMs: number[];
  completedFileChunkCounts: number[];
  completedFileEstimatedChunkCounts: number[];
  completedFileActualChunkCounts: number[];
  completedFileOverheadDurationsMs: number[];
  currentFileBatchDurationMs: number;
  historicalMsPerChunk: number | null;
  historicalChunkEstimateRatio: number | null;
  historicalVariance: number | null;
}

interface RagEtaCalibrationSummary {
  version: 1;
  embeddingProvider: string;
  embeddingModel: string;
  chunkSize: number;
  overlap: number;
  msPerChunk: number;
  chunkEstimateRatio: number;
  variance: number;
  sampleCount: number;
  updatedAt: number;
}

const RAG_ETA_CALIBRATION_META_PREFIX = 'rag-indexing-eta-calibration:v1';

export interface IndexingResult {
  indexed: number;
  vectors: number;
  skipped: number;
  documents: string[];
  durationMs: number;
  guardState?: PerformanceGuardState | null;
}

export function isIndexingCancelledError(error: unknown): boolean {
  return (
    error instanceof IndexingCancelledError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

function throwIfIndexingCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new IndexingCancelledError();
  }
}

function throwIfPerformanceGuardPaused(options: IndexingOptions): void {
  if (options.getPerformanceGuardState?.()?.mode === 'paused') {
    throw new IndexingPerformancePausedError();
  }
}

function isCurrentVaultFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'extension' in file && 'stat' in file && 'basename' in file;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTFileLike(file: unknown): file is TFile {
  if (!isRecord(file)) return false;
  const stat = file.stat;
  return (
    typeof file.path === 'string' &&
    typeof file.name === 'string' &&
    typeof file.extension === 'string' &&
    isRecord(stat) &&
    typeof stat.size === 'number'
  );
}

function ragEtaCalibrationMetaKey(ragConfig: RAGConfig): string {
  return [
    RAG_ETA_CALIBRATION_META_PREFIX,
    ragConfig.embeddingProvider,
    ragConfig.embeddingModel,
    String(Math.floor(ragConfig.chunkSize)),
    String(Math.floor(ragConfig.overlap)),
  ].join(':');
}

function isMatchingRagEtaCalibrationSummary(
  value: unknown,
  ragConfig: RAGConfig,
): value is RagEtaCalibrationSummary {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    value.embeddingProvider === ragConfig.embeddingProvider &&
    value.embeddingModel === ragConfig.embeddingModel &&
    value.chunkSize === Math.floor(ragConfig.chunkSize) &&
    value.overlap === Math.floor(ragConfig.overlap) &&
    typeof value.msPerChunk === 'number' &&
    Number.isFinite(value.msPerChunk) &&
    value.msPerChunk > 0 &&
    typeof value.chunkEstimateRatio === 'number' &&
    Number.isFinite(value.chunkEstimateRatio) &&
    value.chunkEstimateRatio > 0 &&
    typeof value.variance === 'number' &&
    Number.isFinite(value.variance) &&
    value.variance >= 0 &&
    typeof value.sampleCount === 'number' &&
    Number.isInteger(value.sampleCount) &&
    value.sampleCount > 0 &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  );
}

function createRagEtaCalibrationSummary(
  tracker: IndexingProgressTracker,
  ragConfig: RAGConfig,
): RagEtaCalibrationSummary | null {
  const totalBatchDurationMs = tracker.completedBatchDurationsMs.reduce(
    (total, durationMs) => total + Math.max(0, durationMs),
    0,
  );
  const totalBatchChunks = tracker.completedBatchChunkCounts.reduce(
    (total, chunkCount) => total + Math.max(0, chunkCount),
    0,
  );
  if (totalBatchDurationMs <= 0 || totalBatchChunks <= 0) return null;
  const chunkEstimateRatio = observedChunkEstimateRatio(
    tracker.completedFileEstimatedChunkCounts,
    tracker.completedFileActualChunkCounts,
  );
  if (chunkEstimateRatio === null) return null;
  const msPerChunk = totalBatchDurationMs / totalBatchChunks;
  return {
    version: 1,
    embeddingProvider: ragConfig.embeddingProvider,
    embeddingModel: ragConfig.embeddingModel,
    chunkSize: Math.floor(ragConfig.chunkSize),
    overlap: Math.floor(ragConfig.overlap),
    msPerChunk,
    chunkEstimateRatio,
    variance: observedBatchRateVariance(
      tracker.completedBatchDurationsMs,
      tracker.completedBatchChunkCounts,
      msPerChunk,
    ),
    sampleCount: tracker.completedBatchChunkCounts.length,
    updatedAt: Date.now(),
  };
}

function observedChunkEstimateRatio(
  estimatedChunkCounts: readonly number[],
  actualChunkCounts: readonly number[],
): number | null {
  let estimatedTotal = 0;
  let actualTotal = 0;
  for (let index = 0; index < estimatedChunkCounts.length; index++) {
    const estimated = estimatedChunkCounts[index] ?? 0;
    const actual = actualChunkCounts[index] ?? 0;
    if (estimated <= 0 || actual <= 0) continue;
    estimatedTotal += estimated;
    actualTotal += actual;
  }
  if (estimatedTotal <= 0 || actualTotal <= 0) return null;
  return actualTotal / estimatedTotal;
}

function observedBatchRateVariance(
  durationsMs: readonly number[],
  chunkCounts: readonly number[],
  meanMsPerChunk: number,
): number {
  if (meanMsPerChunk <= 0) return 1;
  const rates: number[] = [];
  for (let index = 0; index < durationsMs.length; index++) {
    const durationMs = durationsMs[index] ?? 0;
    const chunkCount = chunkCounts[index] ?? 0;
    if (!Number.isFinite(durationMs) || durationMs <= 0 || chunkCount <= 0) continue;
    rates.push(durationMs / chunkCount);
  }
  if (rates.length <= 1) return 1;
  const variance =
    rates.reduce((total, rate) => total + (rate - meanMsPerChunk) ** 2, 0) / rates.length;
  return variance / (meanMsPerChunk * meanMsPerChunk);
}

function createEmptyIndexingResult(startedAt: number): IndexingResult {
  return {
    indexed: 0,
    vectors: 0,
    skipped: 0,
    documents: [],
    durationMs: performance.now() - startedAt,
  };
}

function finishIndexingResult(
  result: Omit<IndexingResult, 'durationMs' | 'guardState'>,
  startedAt: number,
  options: IndexingOptions,
): IndexingResult {
  return {
    ...result,
    durationMs: performance.now() - startedAt,
    guardState: options.getPerformanceGuardState?.() ?? null,
  };
}

function createProgressTracker(
  files: readonly TFile[],
  ragConfig: RAGConfig,
  skipped = 0,
): IndexingProgressTracker {
  return {
    startedAtMs: performance.now(),
    totalFiles: files.length,
    completedFiles: 0,
    currentFileTotalChunks: 0,
    currentFileEmbeddedChunks: 0,
    totalEstimatedChunks: estimateFilesChunkCount(files, ragConfig),
    completedEstimatedChunks: 0,
    currentFileEstimatedChunks: 0,
    totalPlannedChunks: 0,
    completedPlannedChunks: 0,
    currentFilePlannedChunks: 0,
    planningComplete: false,
    plannedChunkCountsByPath: new Map(),
    indexed: 0,
    vectors: 0,
    skipped,
    completedBatchDurationsMs: [],
    completedBatchChunkCounts: [],
    completedFileDurationsMs: [],
    completedFileChunkCounts: [],
    completedFileEstimatedChunkCounts: [],
    completedFileActualChunkCounts: [],
    completedFileOverheadDurationsMs: [],
    currentFileBatchDurationMs: 0,
    historicalMsPerChunk: null,
    historicalChunkEstimateRatio: null,
    historicalVariance: null,
  };
}

function resetProgressTrackerPlan(
  tracker: IndexingProgressTracker,
  files: readonly TFile[],
  ragConfig: RAGConfig,
  skipped = tracker.skipped,
): void {
  tracker.totalFiles = files.length;
  tracker.totalEstimatedChunks = estimateFilesChunkCount(files, ragConfig);
  tracker.totalPlannedChunks = 0;
  tracker.completedPlannedChunks = 0;
  tracker.currentFilePlannedChunks = 0;
  tracker.planningComplete = false;
  tracker.plannedChunkCountsByPath.clear();
  tracker.historicalMsPerChunk = null;
  tracker.historicalChunkEstimateRatio = null;
  tracker.historicalVariance = null;
  tracker.skipped = skipped;
}

function estimateFilesChunkCount(files: readonly TFile[], ragConfig: RAGConfig): number {
  return files.reduce((total, file) => total + estimateFileChunkCount(file, ragConfig), 0);
}

function estimateFileChunkCount(file: TFile, ragConfig: RAGConfig): number {
  const chunkSize = Math.max(1, Math.floor(ragConfig.chunkSize));
  const overlap = Math.max(0, Math.min(Math.floor(ragConfig.overlap), chunkSize - 1));
  const stride = Math.max(1, chunkSize - overlap);
  const size = Math.max(0, Math.floor(file.stat.size));
  return Math.max(1, Math.ceil(size / stride));
}

function countPlannedChunks(file: TFile, content: string, ragConfig: RAGConfig): number {
  const chunks =
    file.extension.toLowerCase() === 'md'
      ? chunkMarkdown(content, ragConfig.chunkSize, ragConfig.overlap)
      : chunkPlainText(content, ragConfig.chunkSize, ragConfig.overlap);
  return Math.max(1, chunks.length);
}

function completeProgressFile(
  tracker: IndexingProgressTracker,
  durationMs: number,
  actualChunkCount: number,
): void {
  const estimatedChunks = Math.max(1, tracker.currentFileEstimatedChunks);
  const actualChunks = Math.max(0, Math.floor(actualChunkCount));
  const plannedChunks = Math.max(
    1,
    tracker.currentFilePlannedChunks || actualChunks || estimatedChunks,
  );
  tracker.completedFiles += 1;
  tracker.completedEstimatedChunks = Math.min(
    tracker.totalEstimatedChunks,
    tracker.completedEstimatedChunks + estimatedChunks,
  );
  tracker.completedPlannedChunks = tracker.planningComplete
    ? Math.min(tracker.totalPlannedChunks, tracker.completedPlannedChunks + plannedChunks)
    : tracker.completedPlannedChunks + plannedChunks;
  tracker.completedFileDurationsMs.push(durationMs);
  tracker.completedFileChunkCounts.push(actualChunks);
  tracker.completedFileEstimatedChunkCounts.push(estimatedChunks);
  tracker.completedFileActualChunkCounts.push(actualChunks);
  tracker.completedFileOverheadDurationsMs.push(
    Math.max(0, durationMs - tracker.currentFileBatchDurationMs),
  );
  tracker.currentFileBatchDurationMs = 0;
}

function emitIndexingProgress(
  options: IndexingOptions,
  tracker: IndexingProgressTracker | undefined,
  event: RagIndexingProgressEvent,
): void {
  if (!tracker || !options.onProgress) return;
  options.onProgress({
    event,
    startedAtMs: tracker.startedAtMs,
    nowMs: performance.now(),
    totalFiles: tracker.totalFiles,
    completedFiles: tracker.completedFiles,
    currentFilePath: tracker.currentFilePath,
    currentFileIndex: tracker.currentFileIndex,
    currentFileTotalChunks: tracker.currentFileTotalChunks,
    currentFileEmbeddedChunks: tracker.currentFileEmbeddedChunks,
    totalEstimatedChunks: tracker.totalEstimatedChunks,
    completedEstimatedChunks: tracker.completedEstimatedChunks,
    currentFileEstimatedChunks: tracker.currentFileEstimatedChunks,
    totalPlannedChunks: tracker.totalPlannedChunks,
    completedPlannedChunks: tracker.completedPlannedChunks,
    currentFilePlannedChunks: tracker.currentFilePlannedChunks,
    planningComplete: tracker.planningComplete,
    indexed: tracker.indexed,
    vectors: tracker.vectors,
    skipped: tracker.skipped,
    completedBatchDurationsMs: [...tracker.completedBatchDurationsMs],
    completedBatchChunkCounts: [...tracker.completedBatchChunkCounts],
    completedFileDurationsMs: [...tracker.completedFileDurationsMs],
    completedFileChunkCounts: [...tracker.completedFileChunkCounts],
    completedFileEstimatedChunkCounts: [...tracker.completedFileEstimatedChunkCounts],
    completedFileActualChunkCounts: [...tracker.completedFileActualChunkCounts],
    completedFileOverheadDurationsMs: [...tracker.completedFileOverheadDurationsMs],
    historicalMsPerChunk: tracker.historicalMsPerChunk,
    historicalChunkEstimateRatio: tracker.historicalChunkEstimateRatio,
    historicalVariance: tracker.historicalVariance,
  });
}

async function pauseAfterBatch(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    const onAbort = (): void => {
      window.clearTimeout(timeout);
      reject(new IndexingCancelledError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildPendingPlanFromUpdatePaths(
  filePaths: readonly string[],
  updatePaths: readonly string[],
): { fileIndices: number[]; skipped: number } {
  const updatePathSet = new Set(updatePaths);
  const fileIndices: number[] = [];
  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    if (filePath !== undefined && updatePathSet.has(filePath)) {
      fileIndices.push(index);
    }
  }
  return {
    fileIndices,
    skipped: Math.max(filePaths.length - fileIndices.length, 0),
  };
}

export interface Chunk {
  text: string;
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    endLine: number;
  };
}

/** 마크다운을 헤딩/코드블록/단락을 존중하며 청킹합니다. */
export function chunkMarkdown(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const rustChunks = chunkMarkdownRust(content, maxChunkSize, overlapChars);
  return rustChunks ?? [];
}

/** 일반 텍스트와 코드 파일을 줄 경계를 우선해 청킹합니다. */
export function chunkPlainText(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const rustChunks = chunkPlainTextRust(content, maxChunkSize, overlapChars);
  return rustChunks ?? [];
}

export function buildSearchText(file: TFile, chunk: Chunk): string {
  const hints = [`File: ${file.path}`, `Title: ${file.basename}`];
  if (chunk.metadata.heading) {
    hints.push(`Heading: ${chunk.metadata.heading}`);
  }
  return `${hints.join('\n')}\n\n${chunk.text}`;
}

/** 볼트 인덱서 */
export class VaultIndexer {
  private vault: Vault;
  private vectorStore: VectorStore;
  private embeddingProvider: EmbeddingProvider;
  private ragConfig: RAGConfig;
  private chatConfig: ChatConfig;
  private logger: ScopedLogger;

  constructor(
    vault: Vault,
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    ragConfig: RAGConfig,
    chatConfig: ChatConfig,
    private bm25Index?: IndexedDbBM25Index,
    logger?: AppLogger | ScopedLogger,
  ) {
    this.chatConfig = chatConfig;
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.ragConfig = ragConfig;
    this.logger = createScopedIndexerLogger(logger);
  }

  async indexVault(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const progressTracker = createProgressTracker(this.vault.getFiles(), this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    this.logger.info('Vault indexing started.', { data: { fileCount: files.length } });
    resetProgressTrackerPlan(progressTracker, files, this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    await this.planProgressChunks(files, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');

    return this.indexFiles(files, startedAt, options, progressTracker);
  }

  private async indexFiles(
    files: TFile[],
    startedAt: number,
    options: IndexingOptions,
    progressTracker: IndexingProgressTracker,
  ): Promise<IndexingResult> {
    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      for (let i = 0; i < files.length; i++) {
        throwIfIndexingCancelled(options.signal);
        const file = files[i];
        const fileResult = await this.indexFile(file, options, progressTracker, i);
        throwIfIndexingCancelled(options.signal);
        batchResult.indexed += fileResult.indexed;
        batchResult.vectors += fileResult.vectors;
        batchResult.skipped += fileResult.skipped;
        batchResult.documents.push(...fileResult.documents);
        if (i > 0 && i % 5 === 0) {
          await pauseAfterBatch(0, options.signal).catch(() => {});
        }
      }
      return batchResult;
    });
    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    this.logger.notice('Vault indexing completed.', {
      data: {
        indexed: finished.indexed,
        vectors: finished.vectors,
        skipped: finished.skipped,
        durationMs: Math.round(finished.durationMs),
      },
    });
    await this.saveEtaCalibration(progressTracker);
    return finished;
  }

  private async planProgressChunks(
    files: readonly TFile[],
    options: IndexingOptions,
    tracker: IndexingProgressTracker,
  ): Promise<void> {
    await this.loadEtaCalibration(tracker);
    tracker.plannedChunkCountsByPath.clear();
    let totalPlannedChunks = 0;
    for (const file of files) {
      throwIfIndexingCancelled(options.signal);
      const content = await this.vault.cachedRead(file);
      throwIfIndexingCancelled(options.signal);
      const plannedChunks = countPlannedChunks(file, content, this.ragConfig);
      tracker.plannedChunkCountsByPath.set(file.path, plannedChunks);
      totalPlannedChunks += plannedChunks;
    }
    tracker.totalPlannedChunks = totalPlannedChunks;
    tracker.completedPlannedChunks = 0;
    tracker.currentFilePlannedChunks = 0;
    tracker.planningComplete = true;
  }

  private async loadEtaCalibration(tracker: IndexingProgressTracker): Promise<void> {
    const summary = await this.vectorStore.getMetaValue?.<RagEtaCalibrationSummary>(
      ragEtaCalibrationMetaKey(this.ragConfig),
    );
    if (!isMatchingRagEtaCalibrationSummary(summary, this.ragConfig)) return;
    tracker.historicalMsPerChunk = summary.msPerChunk;
    tracker.historicalChunkEstimateRatio = summary.chunkEstimateRatio;
    tracker.historicalVariance = summary.variance;
  }

  private async saveEtaCalibration(tracker: IndexingProgressTracker): Promise<void> {
    const summary = createRagEtaCalibrationSummary(tracker, this.ragConfig);
    if (!summary) return;
    await this.vectorStore.setMetaValue?.(ragEtaCalibrationMetaKey(this.ragConfig), summary);
  }

  async indexFile(
    file: TFile,
    options: IndexingOptions = {},
    progressTracker?: IndexingProgressTracker,
    fileIndex = 0,
  ): Promise<IndexingResult> {
    const startedAt = performance.now();
    const currentFile = this.vault.getAbstractFileByPath(file.path);
    if (!isCurrentVaultFile(currentFile)) {
      this.logger.debug('File indexing skipped because the queued file no longer exists.', {
        data: { path: file.path },
      });
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
    }
    file = currentFile;
    const tracker = progressTracker ?? createProgressTracker([file], this.ragConfig);
    if (!progressTracker) {
      emitIndexingProgress(options, tracker, 'plan');
      await this.planProgressChunks([file], options, tracker);
      emitIndexingProgress(options, tracker, 'plan');
    }
    throwIfIndexingCancelled(options.signal);
    tracker.currentFilePath = file.path;
    tracker.currentFileIndex = fileIndex;
    tracker.currentFileTotalChunks = 0;
    tracker.currentFileEmbeddedChunks = 0;
    tracker.currentFileEstimatedChunks = estimateFileChunkCount(file, this.ragConfig);
    tracker.currentFilePlannedChunks = tracker.plannedChunkCountsByPath.get(file.path) ?? 0;
    tracker.currentFileBatchDurationMs = 0;
    const fileStartedAt = performance.now();
    emitIndexingProgress(options, tracker, 'file-start');
    this.logger.debug('File indexing started.', {
      data: { path: file.path, size: file.stat.size },
    });
    const content = await this.vault.cachedRead(file);
    throwIfIndexingCancelled(options.signal);
    const sourceHash = createContentHash(content);
    if (await this.isCurrentFileIndexRecord(file, sourceHash)) {
      const skipped = finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
      tracker.skipped += 1;
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0);
      emitIndexingProgress(options, tracker, 'file-complete');
      this.logger.debug('File indexing skipped because content hash is unchanged.', {
        data: { path: file.path },
      });
      return skipped;
    }
    const indexedAt = Date.now();
    const chunks =
      file.extension.toLowerCase() === 'md'
        ? chunkMarkdown(content, this.ragConfig.chunkSize, this.ragConfig.overlap)
        : chunkPlainText(content, this.ragConfig.chunkSize, this.ragConfig.overlap);
    throwIfIndexingCancelled(options.signal);
    if (chunks.length === 0) {
      await this.vectorStore.removeByFilePath(file.path);
      if (this.bm25Index) {
        this.bm25Index.removeDocumentsBySource(file.path);
        await this.bm25Index.persist();
      }
      throwIfIndexingCancelled(options.signal);
      const skipped = finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
      tracker.skipped += 1;
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0);
      emitIndexingProgress(options, tracker, 'file-complete');
      this.logger.debug('File indexing skipped because no chunks were produced.', {
        data: { path: file.path },
      });
      return skipped;
    }
    tracker.currentFileTotalChunks = chunks.length;
    tracker.currentFilePlannedChunks = Math.max(
      1,
      tracker.currentFilePlannedChunks || chunks.length,
    );
    tracker.currentFileEmbeddedChunks = 0;
    emitIndexingProgress(options, tracker, 'file-chunks');

    const texts = chunks.map((chunk) => buildSearchText(file, chunk));
    const vectors = await this.embedTextsInBatches(texts, options, tracker);
    throwIfIndexingCancelled(options.signal);

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id: `${file.path}::${chunk.metadata.startLine}::${i}`,
      vector: vectors[i],
      metadata: {
        filePath: file.path,
        heading: chunk.metadata.heading,
        startLine: chunk.metadata.startLine,
        endLine: chunk.metadata.endLine,
        text: texts[i],
        sourceMtime: file.stat.mtime,
        sourceSize: file.stat.size,
        contentHash: sourceHash,
        indexedAt,
        embeddingProvider: this.ragConfig.embeddingProvider,
        embeddingModel: this.ragConfig.embeddingModel,
      },
    }));

    await this.vectorStore.replaceFileEntries(file.path, entries);

    if (this.bm25Index) {
      this.bm25Index.removeDocumentsBySource(file.path);
      for (const entry of entries) {
        this.bm25Index.addDocument(entry.id, entry.metadata.text, file.path);
      }
      await this.bm25Index.persist();
      throwIfIndexingCancelled(options.signal);
    }

    const finished = finishIndexingResult(
      { indexed: 1, vectors: entries.length, skipped: 0, documents: [file.path] },
      startedAt,
      options,
    );
    tracker.indexed += 1;
    tracker.vectors += entries.length;
    completeProgressFile(tracker, performance.now() - fileStartedAt, entries.length);
    emitIndexingProgress(options, tracker, 'file-complete');
    if (!progressTracker) {
      await this.saveEtaCalibration(tracker);
    }
    this.logger.debug('File indexing completed.', {
      data: {
        path: file.path,
        chunks: chunks.length,
        vectors: entries.length,
        durationMs: Math.round(finished.durationMs),
      },
    });
    return finished;
  }

  async reindexAll(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const progressTracker = createProgressTracker(this.vault.getFiles(), this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    this.logger.info('Vault full reindex started.', { data: { fileCount: files.length } });
    resetProgressTrackerPlan(progressTracker, files, this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    await this.planProgressChunks(files, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');
    const existingSourcePaths = new Set(await this.vectorStore.getIndexedFilePaths());
    for (const sourcePath of (await this.bm25Index?.getSourcePaths()) ?? []) {
      existingSourcePaths.add(sourcePath);
    }
    const result = await this.indexFiles(files, startedAt, options, progressTracker);
    throwIfIndexingCancelled(options.signal);
    const currentSourcePaths = new Set(files.map((file) => file.path));
    await this.withIndexBatch(async () => {
      for (const sourcePath of existingSourcePaths) {
        if (currentSourcePaths.has(sourcePath)) continue;
        await this.vectorStore.removeByFilePath(sourcePath);
        this.bm25Index?.removeDocumentsBySource(sourcePath);
      }
      await this.bm25Index?.persist();
    });
    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    return finished;
  }

  async removeFile(filePath: string): Promise<number> {
    const removed = await this.vectorStore.removeByFilePath(filePath);
    if (this.bm25Index) {
      this.bm25Index.removeDocumentsBySource(filePath);
      await this.bm25Index.persist();
    }
    return removed;
  }

  async indexPending(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const progressTracker = createProgressTracker(this.vault.getFiles(), this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    const status = await calculateRagStatus(
      this.vault,
      this.vectorStore,
      this.ragConfig,
      this.chatConfig,
      options.signal,
    );
    throwIfIndexingCancelled(options.signal);
    const candidatePaths = files.map((file) => file.path);
    const requiredPaths = status.updateRequiredDocuments.map((document) => document.path);
    const pendingPlan =
      planIndexPendingFilesRust(candidatePaths, requiredPaths) ??
      buildPendingPlanFromUpdatePaths(candidatePaths, requiredPaths);

    const normalizedPendingPlanFileIndices = normalizeRustIndices(
      [...new Set(pendingPlan.fileIndices)],
      files.length,
      {
        dedupe: true,
      },
    );
    const normalizedPendingPlan = {
      fileIndices: normalizedPendingPlanFileIndices,
      skipped: Math.max(candidatePaths.length - normalizedPendingPlanFileIndices.length, 0),
    };
    const pendingFiles = normalizedPendingPlan.fileIndices
      .map((index) => files[index])
      .filter((file): file is TFile => file !== undefined);
    const selectedFileIndices = options.automaticRecovery
      ? selectAutomaticRecoveryFileIndices(files, normalizedPendingPlan.fileIndices, pendingFiles)
      : normalizedPendingPlan.fileIndices;
    const selectedFiles = selectedFileIndices
      .map((index) => files[index])
      .filter((file): file is TFile => file !== undefined);
    resetProgressTrackerPlan(
      progressTracker,
      selectedFiles,
      this.ragConfig,
      Math.max(candidatePaths.length - selectedFiles.length, 0),
    );
    emitIndexingProgress(options, progressTracker, 'plan');
    await this.planProgressChunks(selectedFiles, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');

    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      batchResult.skipped = Math.max(candidatePaths.length - selectedFiles.length, 0);
      for (let i = 0; i < selectedFileIndices.length; i++) {
        throwIfIndexingCancelled(options.signal);
        const file = files[selectedFileIndices[i]];
        if (!file) {
          batchResult.skipped += 1;
          continue;
        }
        const fileResult = await this.indexFile(file, options, progressTracker, i);
        throwIfIndexingCancelled(options.signal);
        batchResult.indexed += fileResult.indexed;
        batchResult.vectors += fileResult.vectors;
        batchResult.skipped += fileResult.skipped;
        batchResult.documents.push(...fileResult.documents);
        if (i > 0 && i % 5 === 0) {
          await pauseAfterBatch(0, options.signal).catch(() => {});
        }
      }
      return batchResult;
    });

    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    await this.saveEtaCalibration(progressTracker);
    return finished;
  }

  private async embedTextsInBatches(
    texts: string[],
    options: IndexingOptions,
    progressTracker?: IndexingProgressTracker,
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    let expectedDimension: number | undefined;
    let offset = 0;

    while (offset < texts.length) {
      throwIfIndexingCancelled(options.signal);
      throwIfPerformanceGuardPaused(options);
      const requestedBatchSize =
        options.getMaxEmbeddingBatchSize?.() ?? options.maxEmbeddingBatchSize ?? texts.length;
      const batchSize = Math.max(1, Math.floor(requestedBatchSize));
      const batch = texts.slice(offset, offset + batchSize);
      const startedAt = performance.now();
      this.logger.trace('Embedding batch started.', {
        data: {
          offset,
          batchSize: batch.length,
          total: texts.length,
        },
      });
      const batchVectors = await this.embeddingProvider.embedBatch(batch, {
        signal: options.signal,
      });
      expectedDimension = assertValidEmbeddingBatch(
        batchVectors,
        batch.length,
        'Embedding batch',
        expectedDimension,
      );
      const durationMs = performance.now() - startedAt;
      await options.onBatchComplete?.(durationMs, batch.length);
      if (progressTracker) {
        progressTracker.completedBatchDurationsMs.push(durationMs);
        progressTracker.completedBatchChunkCounts.push(batch.length);
        progressTracker.currentFileBatchDurationMs += durationMs;
        progressTracker.currentFileEmbeddedChunks = Math.min(
          progressTracker.currentFileTotalChunks,
          progressTracker.currentFileEmbeddedChunks + batch.length,
        );
        emitIndexingProgress(options, progressTracker, 'batch-complete');
      }
      this.logger.trace('Embedding batch validated.', {
        data: {
          offset,
          batchSize: batch.length,
          durationMs: Math.round(durationMs),
          dimension: expectedDimension,
        },
      });
      throwIfIndexingCancelled(options.signal);
      throwIfPerformanceGuardPaused(options);
      vectors.push(...batchVectors);
      offset += batch.length;
      if (offset < texts.length) {
        const yieldMs = options.getIndexingYieldMs?.() ?? options.indexingYieldMs ?? 0;
        await pauseAfterBatch(yieldMs, options.signal);
      }
    }

    return vectors;
  }

  private async withIndexBatch<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.bm25Index) {
      return this.vectorStore.withBatch(operation);
    }
    return this.vectorStore.withBatch(() => this.bm25Index!.withBatch(operation));
  }

  private async isCurrentFileIndexRecord(file: TFile, contentHash: string): Promise<boolean> {
    const record = await this.vectorStore.getFileIndexRecord(file.path);
    return record ? isCurrentFileIndexRecord(record, file, contentHash, this.ragConfig) : false;
  }
}

function selectAutomaticRecoveryFileIndices(
  files: readonly TFile[],
  pendingFileIndices: readonly number[],
  pendingFiles: readonly TFile[],
): number[] {
  const plan = planRagAutomaticRecoveryBatchRust(
    pendingFiles.map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size })),
  );
  if (!plan) throw new Error('Rust automatic RAG recovery batch planning failed');
  return plan.batchIndices
    .map((index) => pendingFileIndices[index])
    .filter((index): index is number => index !== undefined && index >= 0 && index < files.length);
}

function isCurrentFileIndexRecord(
  record: FileIndexRecord,
  file: TFile,
  contentHash: string,
  ragConfig: RAGConfig,
): boolean {
  return (
    record.vectorCount > 0 &&
    record.hasCompleteMetadata === true &&
    record.sourceMtime === file.stat.mtime &&
    record.sourceSize === file.stat.size &&
    record.contentHash === contentHash &&
    record.embeddingProvider === ragConfig.embeddingProvider &&
    record.embeddingModel === ragConfig.embeddingModel
  );
}

function createScopedIndexerLogger(logger: AppLogger | ScopedLogger | undefined): ScopedLogger {
  const candidate = logger ?? appLogger;
  return 'child' in candidate ? candidate.child('rag.indexer') : candidate;
}

function shouldConsiderRagPath(
  filePath: string,
  excludePaths: string[],
  excludeExts: string[],
): boolean {
  return !isExcludedPath(filePath, excludePaths) && !isExcludedExt(filePath, excludeExts);
}

async function shouldIndexRagFile(
  vault: Vault,
  file: TFile,
  excludePaths: string[],
  excludeExts: string[],
): Promise<boolean> {
  return (
    shouldConsiderRagPath(file.path, excludePaths, excludeExts) && isRagIndexableFile(vault, file)
  );
}

/** 파일 변경 이벤트를 등록하여 자동 재인덱싱합니다. */
export function registerModifyEvent(
  vault: Vault,
  indexer: {
    indexFile(file: TFile): Promise<unknown>;
    removeByFilePath?(filePath: string): Promise<number>;
  },
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (file: TFile) => void,
): () => void {
  const ref = vault.on('modify', async (file) => {
    if (!isTFileLike(file)) return;
    const f = file;
    if (!shouldConsiderRagPath(f.path, excludePaths, excludeExts)) return;
    if (!(await isRagIndexableFile(vault, f))) {
      const removed = await indexer.removeByFilePath?.(f.path);
      if (removed && removed > 0) {
        onComplete?.(f);
      }
      return;
    }
    await indexer.indexFile(f);
    onComplete?.(f);
  });
  return () => vault.offref(ref);
}

/** 파일 삭제 이벤트를 등록하여 벡터 저장소에서 해당 항목을 제거합니다. */
export function registerDeleteEvent(
  vault: Vault,
  vectorStore: Pick<VectorStore, 'removeByFilePath'>,
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (filePath: string) => void,
): () => void {
  const ref = vault.on('delete', async (file) => {
    if (!('path' in file)) return;
    const filePath = (file as { path: string }).path;
    if (!shouldConsiderRagPath(filePath, excludePaths, excludeExts)) return;
    const removed = await vectorStore.removeByFilePath(filePath);
    if (removed > 0) {
      onComplete?.(filePath);
    }
  });
  return () => vault.offref(ref);
}

/** 파일 이름 변경/이동 이벤트를 등록하여 기존 항목을 제거하고 새 경로로 재인덱싱합니다. */
export function registerRenameEvent(
  vault: Vault,
  indexer: { indexFile(file: TFile): Promise<unknown> },
  vectorStore: Pick<VectorStore, 'removeByFilePath'>,
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (oldPath: string, newPath: string) => void,
): () => void {
  const ref = vault.on('rename', async (file, oldPath) => {
    if (!isTFileLike(file)) return;
    const f = file;
    const newPath = f.path;
    const oldWasIndexable = shouldConsiderRagPath(oldPath, excludePaths, excludeExts);
    const newIsIndexable = await shouldIndexRagFile(vault, f, excludePaths, excludeExts);
    let changed = false;
    if (oldWasIndexable) {
      const removed = await vectorStore.removeByFilePath(oldPath);
      changed = removed > 0;
    }
    if (newIsIndexable) {
      await indexer.indexFile(f);
      changed = true;
    }
    if (changed) {
      onComplete?.(oldPath, newPath);
    }
  });
  return () => vault.offref(ref);
}
