import type { MetadataCache, TAbstractFile, TFile, Vault } from 'obsidian';
import type { EmbeddingInferenceSample, EmbeddingProvider } from '../llm/embedding';
import { assertValidEmbeddingBatch } from '../llm/embedding-validation';
import type { VectorStore, VectorEntry, FileIndexRecord } from './store';
import {
  getRagIndexingManifest,
  getRagPreparedSourceRevision,
  getRagUnverifiedIndexingFiles,
  isRagFileMetadataExcluded,
  getRagPreparedContentVerdict,
  recordRagIndexingVerdict,
  type RagFileInventory,
  type RagFileFailure,
  isExcludedPath,
  isExcludedExt,
  isRagIndexableFile,
  isRagFileExcluded,
  isRagFileExcludedWithContent,
} from '../utils/vault';
import type { RAGConfig, ChatConfig } from '../settings';
import { calculateRagStatus } from './status';
import { getBM25DocumentFields, type IndexedDbBM25Index } from './bm25';
import {
  planEmptyFileIndexRecordRust,
  planIndexPendingFilesRust,
  planRagAutomaticRecoveryBatchRust,
  isSourceRevisionCurrentRust,
  planEmbeddingInputsRust,
  type RustSourceChunk,
  type RustRagRecoveryPartialRecord,
  type RustRagIndexingEtaPipelineInput,
  type RustRagIndexingEtaWindowSample,
} from './rust-core';
import type { PerformanceGuardState } from './performance-guard';
import { appLogger, type AppLogger, type ScopedLogger } from '../utils/logger';
import { normalizeRustIndices } from '../utils/rust-index-plan';
import { buildSourceDocuments, buildSearchText, type SourceDocument } from './source-document';
import type { VaultDocumentCorpus } from './vault-document-corpus';
import { readSourceFileSnapshot, type SourceFileSnapshot } from './source-snapshot';
import { SourceReadError, type SourceTextSegment } from './source-access';
export { chunkMarkdown, chunkPlainText, buildSearchText, type Chunk } from './source-document';

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
  getMaxEmbeddingBatchSize?: () => number | undefined;
  getIndexingYieldMs?: () => number;
  onBatchComplete?: (durationMs: number, batchSize: number) => void | Promise<void>;
  onProgress?: (progress: RagIndexingProgressSnapshot) => void;
  getPerformanceGuardState?: () => PerformanceGuardState | null;
  automaticRecovery?: boolean;
  /** 같은 실행의 corpus·상태·pending 계획이 재사용하는 후보 원장입니다. */
  inventory?: RagFileInventory;
  /** 세대·lease 소유자가 늦은 게시를 차단하는 호스트 경계입니다. */
  isCurrent?: () => boolean;
}

export type RagIndexingProgressEvent =
  | 'plan'
  | 'file-start'
  | 'file-chunks'
  | 'batch-complete'
  | 'file-complete'
  | 'window-complete';

export interface RagIndexingProgressSnapshot {
  pipeline?: RustRagIndexingEtaPipelineInput;
  processedFiles?: number;
  failedFiles?: number;
  partialFiles?: number;
  stage?: 'preparing' | 'lexical' | 'embedding' | 'committing' | 'settled';
  sourcePage?: number;
  sourcePageCount?: number;
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

interface PreparedSource {
  readonly snapshot: SourceFileSnapshot;
  readonly originalFile: TFile;
  readonly owner: symbol;
  readonly recoveryOwner: string;
  readonly documents: SourceDocument[];
  readonly mtime: number;
  readonly size: number;
  readonly text: string;
  readonly segments: readonly SourceTextSegment[];
  readonly chunks: readonly RustSourceChunk[];
  readonly contentHash: string;
}

interface SourceLookahead {
  file: TFile;
  controller: AbortController;
  snapshot: Promise<SourceFileSnapshot | null>;
}

type PipelineObservations = { -readonly [Key in keyof RustRagIndexingEtaPipelineInput]: RustRagIndexingEtaPipelineInput[Key] };

interface PipelineWindow {
  startedAtMs: number;
  valid: boolean;
  open: boolean;
  dispatchCount: number;
  sampleCount: number;
  physicalWorkUnits: number;
  logicalChunks: number;
  pendingSamples: EmbeddingInferenceSample[];
  resetBoundary: boolean;
}

interface IndexingProgressTracker {
  pipeline: PipelineObservations;
  processedFilePaths: Set<string>;
  activeWindow?: PipelineWindow;
  nextWindowStartedAtMs?: number;
  onInferenceSample?: (sample: EmbeddingInferenceSample) => void;
  processedFiles: number;
  failedFiles: number;
  partialFiles: number;
  stage: NonNullable<RagIndexingProgressSnapshot['stage']>;
  sourcePage?: number;
  sourcePageCount?: number;
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
  preparedSources: Map<string, PreparedSource>;
  onInferenceDispatch?: () => void;
  existingRecordsByPath: Map<string, FileIndexRecord> | null;
  prefetchedVectorsByText: Map<string, number[]>;
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

/** 계획 단계가 길어도 라벨이 멈추지 않도록 진행 이벤트를 주기적으로 보냅니다. */
const PREPARED_WINDOW_BYTES = 8 * 1024 * 1024;
const PREPARED_WINDOW_CHUNKS = 4096;
/** 진행 스냅샷 직렬화 비용을 O(1)로 유지하기 위한 최근 샘플 슬라이딩 윈도우 크기입니다. */
const MAX_ETA_TRACKED_SAMPLES = 64;
/** 다중 파일 색인 시 교차 파일 임베딩 배치를 구성하는 파일 윈도우 크기입니다. */
const PREPARED_WINDOW_INPUT_BYTES = 4 * 1024 * 1024;

function pushBoundedSample<T>(samples: T[], value: T): void {
  if (samples.length >= MAX_ETA_TRACKED_SAMPLES) {
    samples.shift();
  }
  samples.push(value);
}

function recordBatchSample(
  tracker: IndexingProgressTracker,
  durationMs: number,
  chunkCount: number,
): void {
  pushBoundedSample(tracker.completedBatchDurationsMs, durationMs);
  pushBoundedSample(tracker.completedBatchChunkCounts, chunkCount);
}

export interface IndexingResult {
  partial?: number;
  failed?: number;
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

function throwIfIndexingCancelled(signal?: AbortSignal, isCurrent?: () => boolean): void {
  if (signal?.aborted || isCurrent?.() === false) {
    throw new IndexingCancelledError();
  }
}

async function awaitEmbeddingBatch(
  request: Promise<number[][]>,
  signal?: AbortSignal,
): Promise<number[][]> {
  if (!signal) return request;
  let onAbort: () => void = () => undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new IndexingCancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
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

function createPipelineObservations(observedAtMs = performance.now()): PipelineObservations {
  return {
    lifecycle: 'running', totalKnown: false, processedFiles: 0, failedFiles: 0, partialFiles: 0,
    processedEstimatedChunks: 0, processedPlannedChunks: 0, observedAtMs,
    backend: 'unknown', windowSamples: [], inferenceSamples: [],
  };
}

function copyPipelineObservations(pipeline: RustRagIndexingEtaPipelineInput): RustRagIndexingEtaPipelineInput {
  return { ...pipeline, windowSamples: pipeline.windowSamples.map((sample) => ({ ...sample })),
    inferenceSamples: pipeline.inferenceSamples.map((sample) => ({ ...sample })) };
}

function beginPipelineWindow(tracker: IndexingProgressTracker, options: IndexingOptions): PipelineWindow {
  const window: PipelineWindow = {
    startedAtMs: tracker.nextWindowStartedAtMs ?? performance.now(), valid: true, open: true,
    dispatchCount: 0, sampleCount: 0, physicalWorkUnits: 0, logicalChunks: 0, pendingSamples: [], resetBoundary: false,
  };
  tracker.activeWindow = window;
  tracker.pipeline.lifecycle = 'running';
  const isLive = (): boolean => {
    if (!window.open || tracker.activeWindow !== window) return false;
    if (options.signal?.aborted || options.isCurrent?.() === false || options.getPerformanceGuardState?.()?.mode === 'paused') {
      window.valid = false;
      window.resetBoundary = true;
      window.pendingSamples = [];
      tracker.pipeline.windowSamples = [];
      tracker.pipeline.inferenceSamples = [];
      return false;
    }
    return true;
  };
  tracker.onInferenceDispatch = () => { if (isLive()) window.dispatchCount++; };
  tracker.onInferenceSample = (sample) => {
    if (!isLive()) return;
    if ((sample.backend !== 'cpu' && sample.backend !== 'webgpu') || !Number.isSafeInteger(sample.workUnits) || sample.workUnits <= 0 ||
      !Number.isFinite(sample.durationMs) || sample.durationMs <= 0 || !Number.isFinite(sample.endedAtMs)) {
      window.valid = false;
      return;
    }
    if (tracker.pipeline.backend !== 'unknown' && tracker.pipeline.backend !== sample.backend) {
      window.valid = false;
      window.resetBoundary = true;
      window.pendingSamples = [];
      tracker.pipeline.windowSamples = [];
      tracker.pipeline.inferenceSamples = [];
    }
    tracker.pipeline.backend = sample.backend;
    window.sampleCount++;
    window.physicalWorkUnits += sample.workUnits;
    pushBoundedSample(window.pendingSamples, {
      backend: sample.backend, workUnits: sample.workUnits, durationMs: sample.durationMs, endedAtMs: sample.endedAtMs,
    });
  };
  return window;
}

function finishPipelineWindow(tracker: IndexingProgressTracker, options: IndexingOptions, window: PipelineWindow, settled: boolean): void {
  window.open = false;
  tracker.activeWindow = undefined;
  tracker.onInferenceDispatch = undefined;
  tracker.onInferenceSample = undefined;
  const endedAtMs = performance.now();
  tracker.nextWindowStartedAtMs = window.resetBoundary ? undefined : endedAtMs;
  tracker.pipeline.observedAtMs = endedAtMs;
  const live = !options.signal?.aborted && options.isCurrent?.() !== false && options.getPerformanceGuardState?.()?.mode !== 'paused';
  if (settled && live && window.valid && window.logicalChunks > 0 && Number.isFinite(endedAtMs) && endedAtMs > window.startedAtMs) {
    // dispatch가 없다는 사실만으로 로컬 완전 계측이나 물리 작업 0을 증명할 수 없습니다.
    const matched = window.dispatchCount > 0 && window.sampleCount === window.dispatchCount;
    const sample: RustRagIndexingEtaWindowSample = { startedAtMs: window.startedAtMs, endedAtMs,
      logicalChunks: window.logicalChunks, physicalWorkUnits: matched ? window.physicalWorkUnits : null };
    const windows = [...tracker.pipeline.windowSamples];
    pushBoundedSample(windows, sample);
    tracker.pipeline.windowSamples = windows;
    if (matched) {
      const inference = [...tracker.pipeline.inferenceSamples];
      for (const pending of window.pendingSamples) pushBoundedSample(inference, pending);
      tracker.pipeline.inferenceSamples = inference;
    }
  }
  window.pendingSamples = [];
  if (!live || !settled) {
    tracker.pipeline.windowSamples = [];
    tracker.pipeline.inferenceSamples = [];
    tracker.nextWindowStartedAtMs = undefined;
  }
  tracker.pipeline.lifecycle = options.signal?.aborted || options.isCurrent?.() === false ? 'cancelled'
    : options.getPerformanceGuardState?.()?.mode === 'paused' ? 'paused'
    : !settled || tracker.failedFiles > 0 ? 'failed' : tracker.partialFiles > 0 ? 'partial' : 'running';
  emitIndexingProgress(options, tracker, 'window-complete');
}

function finalizePipeline(tracker: IndexingProgressTracker): void {
  tracker.pipeline.lifecycle = tracker.failedFiles > 0 ? 'failed' : tracker.partialFiles > 0 ? 'partial' : 'finalizing';
}

function createProgressTracker(
  files: readonly TFile[],
  ragConfig: RAGConfig,
  skipped = 0,
): IndexingProgressTracker {
  const startedAtMs = performance.now();
  return {
    pipeline: createPipelineObservations(startedAtMs),
    processedFilePaths: new Set(),
    startedAtMs,
    totalFiles: files.length,
    completedFiles: 0,
    processedFiles: 0,
    failedFiles: 0,
    partialFiles: 0,
    stage: 'preparing',
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
    preparedSources: new Map(),
    existingRecordsByPath: null,
    prefetchedVectorsByText: new Map(),
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
  tracker.pipeline = createPipelineObservations();
  tracker.pipeline.totalKnown = true;
  if (tracker.activeWindow) tracker.activeWindow.open = false;
  tracker.activeWindow = undefined;
  tracker.processedFilePaths.clear();
  tracker.processedFiles = 0;
  tracker.completedFiles = 0;
  tracker.failedFiles = 0;
  tracker.partialFiles = 0;
  tracker.completedEstimatedChunks = 0;
  tracker.nextWindowStartedAtMs = undefined;
  tracker.onInferenceDispatch = undefined;
  tracker.onInferenceSample = undefined;
  tracker.totalFiles = files.length;
  tracker.totalEstimatedChunks = estimateFilesChunkCount(files, ragConfig);
  tracker.totalPlannedChunks = 0;
  tracker.completedPlannedChunks = 0;
  tracker.currentFilePlannedChunks = 0;
  tracker.planningComplete = false;
  tracker.plannedChunkCountsByPath.clear();
  tracker.preparedSources.clear();
  tracker.prefetchedVectorsByText.clear();
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

function completeProgressFile(
  tracker: IndexingProgressTracker,
  durationMs: number,
  actualChunkCount: number,
  outcome: 'completed' | 'skipped' | 'partial' | 'failed',
): void {
  if (tracker.currentFilePath) {
    if (tracker.processedFilePaths.has(tracker.currentFilePath)) return;
    tracker.processedFilePaths.add(tracker.currentFilePath);
  }
  const estimatedChunks = Math.max(1, tracker.currentFileEstimatedChunks);
  const actualChunks = Math.max(0, Math.floor(actualChunkCount));
  const plannedChunks = tracker.currentFilePlannedChunks;
  tracker.processedFiles += 1;
  tracker.pipeline.processedFiles = tracker.processedFiles;
  tracker.pipeline.processedEstimatedChunks += estimatedChunks;
  tracker.pipeline.processedPlannedChunks += plannedChunks;
  tracker.pipeline.observedAtMs = performance.now();
  if (outcome === 'completed') {
    tracker.completedFiles += 1;
    tracker.completedEstimatedChunks = Math.min(tracker.totalEstimatedChunks, tracker.completedEstimatedChunks + estimatedChunks);
    tracker.completedPlannedChunks = tracker.planningComplete
      ? Math.min(tracker.totalPlannedChunks, tracker.completedPlannedChunks + plannedChunks)
      : tracker.completedPlannedChunks + plannedChunks;
    if (tracker.activeWindow) tracker.activeWindow.logicalChunks += actualChunks;
  } else {
    if (tracker.activeWindow) tracker.activeWindow.valid = false;
    if (outcome === 'failed') tracker.failedFiles += 1;
    if (outcome === 'partial') tracker.partialFiles += 1;
  }
  tracker.pipeline.failedFiles = tracker.failedFiles;
  tracker.pipeline.partialFiles = tracker.partialFiles;
  if (outcome === 'completed' && actualChunks > 0) {
    pushBoundedSample(tracker.completedFileDurationsMs, durationMs);
    pushBoundedSample(tracker.completedFileChunkCounts, actualChunks);
    pushBoundedSample(tracker.completedFileEstimatedChunkCounts, estimatedChunks);
    pushBoundedSample(tracker.completedFileActualChunkCounts, actualChunks);
    pushBoundedSample(
      tracker.completedFileOverheadDurationsMs,
      Math.max(0, durationMs - tracker.currentFileBatchDurationMs),
    );
  }
  tracker.currentFileBatchDurationMs = 0;
  // 완료한 파일의 청크는 누적 작업량에만 포함합니다.
  tracker.currentFileTotalChunks = 0;
  tracker.currentFileEmbeddedChunks = 0;
  tracker.currentFileEstimatedChunks = 0;
  tracker.currentFilePlannedChunks = 0;
}

function emitIndexingProgress(
  options: IndexingOptions,
  tracker: IndexingProgressTracker | undefined,
  event: RagIndexingProgressEvent,
): void {
  if (!tracker || !options.onProgress) return;
  try { options.onProgress({
    pipeline: copyPipelineObservations(tracker.pipeline),
    sourcePage: tracker.sourcePage,
    sourcePageCount: tracker.sourcePageCount,
    event,
    startedAtMs: tracker.startedAtMs,
    nowMs: performance.now(),
    totalFiles: tracker.totalFiles,
    completedFiles: tracker.completedFiles,
    processedFiles: tracker.processedFiles,
    failedFiles: tracker.failedFiles,
    partialFiles: tracker.partialFiles,
    stage: tracker.stage,
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
  }); } catch { /* 관측자 실패는 실제 저장·취소 정착을 바꾸지 않습니다. */ }
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

/** 볼트 인덱서 */
export class VaultIndexer {
  private readonly failedFiles = new Map<string, { mtime: number; size: number; reason?: string }>();
  private readonly fileOwners = new Map<string, symbol>();
  private readonly invalidatedRecoveryPaths = new Set<string>();
  private recoverySourceEpoch = 0;

  invalidateAutomaticRecoverySource(path: string): void {
    this.invalidatedRecoveryPaths.add(path);
    this.recoverySourceEpoch++;
  }

  getAutomaticRecoveryInvalidatedPaths(): readonly string[] {
    return [...this.invalidatedRecoveryPaths];
  }

  getFailedFilePaths(): string[] {
    return [...this.failedFiles]
      .filter(([path, revision]) => {
        const current = this.vault.getAbstractFileByPath(path);
        return (
          isCurrentVaultFile(current) &&
          isSourceRevisionCurrentRust(
            {
              filePath: path,
              sourceMtime: revision.mtime,
              sourceSize: revision.size,
              contentHash: 'status',
            },
            {
              filePath: path,
              sourceMtime: current.stat.mtime,
              sourceSize: current.stat.size,
              contentHash: 'status',
            },
          )
        );
      })
      .map(([path]) => path);
  }
  getFailedFileReasons(): { path: string; reason: string }[] {
    return this.getFailedFilePaths().map((path) => ({
      path, reason: this.failedFiles.get(path)?.reason ?? 'indexing-failed',
    }));
  }

  private recordInventoryFailures(inventory: RagFileInventory): void {
    const allowed = new Set([...inventory.candidates, ...inventory.failures.map(({ file }) => file)].map((file) => file.path));
    for (const path of this.failedFiles.keys()) {
      if (!allowed.has(path)) this.failedFiles.delete(path);
    }
    for (const { file, reason } of inventory.failures) {
      this.fileOwners.set(file.path, Symbol(file.path));
      this.failedFiles.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, reason });
      this.logger.warn('Source inventory read failed.', { data: { path: file.path, reason } });
    }
  }

  private completeInventoryFailures(
    failures: readonly RagFileFailure[],
    options: IndexingOptions,
    tracker: IndexingProgressTracker,
  ): void {
    tracker.totalFiles += failures.length;
    tracker.skipped += failures.length;
    for (let index = 0; index < failures.length; index++) {
      // 실패는 파일 처리 수만 채우며 청크 완료량·추론 속도 표본을 늘리지 않는다.
      const file = failures[index].file;
      tracker.currentFilePath = file.path;
      const estimated = estimateFileChunkCount(file, this.ragConfig);
      tracker.totalEstimatedChunks += estimated;
      tracker.totalPlannedChunks += estimated;
      tracker.currentFileEstimatedChunks = estimated;
      tracker.currentFilePlannedChunks = estimated;
      completeProgressFile(tracker, 0, 0, 'failed');
      emitIndexingProgress(options, tracker, 'file-complete');
    }
  }

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
    private readonly documentCorpus?: Pick<
      VaultDocumentCorpus,
      'refreshFile' | 'removeFile' | 'replaceBatchFileDocuments'
    > & Partial<Pick<VaultDocumentCorpus, 'getFileIndexRecords'>>,
    private readonly metadataCache?: Pick<MetadataCache, 'getFileCache'>,
  ) {
    this.chatConfig = chatConfig;
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.ragConfig = ragConfig;
    this.logger = createScopedIndexerLogger(logger);
  }

  setBM25Index(index?: IndexedDbBM25Index): void {
    this.bm25Index = index;
  }

  async indexVault(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const progressTracker = createProgressTracker(this.vault.getFiles(), this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    const inventory = options.inventory ?? getRagIndexingManifest(this.vault, this.ragConfig, this.chatConfig);
    options = { ...options, inventory };
    const files = inventory.candidates;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    this.recordInventoryFailures(inventory);
    this.logger.info('Vault indexing started.', { data: { fileCount: files.length } });
    resetProgressTrackerPlan(progressTracker, files, this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    this.planProgressChunks(files, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');

    this.completeInventoryFailures(inventory.failures, options, progressTracker);
    return this.indexFiles(files, startedAt, options, progressTracker, inventory.failures);
  }

  private async indexFiles(
    files: TFile[],
    startedAt: number,
    options: IndexingOptions,
    progressTracker: IndexingProgressTracker,
    failures: readonly RagFileFailure[] = [],
  ): Promise<IndexingResult> {
    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      batchResult.skipped = failures.length;
      if (failures.length > 0) batchResult.failed = failures.length;
      batchResult.documents.push(...failures.map(({ file }) => file.path));
      await this.indexBatchFiles(files, batchResult, options, progressTracker);
      return batchResult;
    });
    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        ...(result.partial ? { partial: result.partial } : {}),
        ...(result.failed ? { failed: result.failed } : {}),
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    const incomplete = failures.length > 0 || (finished.failed ?? 0) > 0 || (finished.partial ?? 0) > 0;
    this.logger[incomplete ? 'warn' : 'notice'](
      incomplete
        ? 'Vault indexing finished with source failures.'
        : 'Vault indexing completed.',
      {
        data: {
          indexed: finished.indexed,
          vectors: finished.vectors,
          skipped: finished.skipped,
          sourceFailures: failures.length,
          failed: finished.failed ?? 0,
          partial: finished.partial ?? 0,
          durationMs: Math.round(finished.durationMs),
        },
      },
    );
    return finished;
  }

  /**
   * 파일 하나의 추출 실패가 같은 배치의 나머지 문서 색인을 중단시키지 않게 순차 처리합니다.
   *
   * 취소와 성능 일시중지는 배치 전체를 중단하고, 그 밖의 실패는 그 파일만 건너뜁니다.
   */
  private async indexBatchFiles(
    files: readonly TFile[],
    batchResult: IndexingResult,
    options: IndexingOptions,
    progressTracker: IndexingProgressTracker,
  ): Promise<void> {
    if (!progressTracker.existingRecordsByPath) {
      const existingRecords = await this.vectorStore.getFileIndexRecords().catch(() => []);
      progressTracker.existingRecordsByPath = new Map(
        existingRecords.map((record) => [record.filePath, record]),
      );
    }
    let offset = 0;
    let canPrefetch = true;
    let canPrepareAhead = true;
    const lookahead: { current: SourceLookahead | null } = { current: null };
    while (offset < files.length) {
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      throwIfPerformanceGuardPaused(options);
      let residentBytes = 0;
      let chunkCount = 0;
      const observationWindow = beginPipelineWindow(progressTracker, options);
      const windowStartedAt = performance.now();
      const window: TFile[] = [];
      const preparationFailures = new Map<string, unknown>();
      const preparationSkips = new Set<string>();
      let windowSettled = false;
      let windowOpen = true;
      try {
        const staged = lookahead.current;
        lookahead.current = null;
        const preloaded = await staged?.snapshot;
        while (offset < files.length) {
          const file = files[offset];
          if (window.length > 0 && (residentBytes + file.stat.size * 4 > PREPARED_WINDOW_BYTES ||
            residentBytes >= PREPARED_WINDOW_INPUT_BYTES || chunkCount >= PREPARED_WINDOW_CHUNKS || performance.now() - windowStartedAt >= 12)) break;
          offset++;
          window.push(file);
          try {
            this.fileOwners.set(file.path, Symbol(file.path));
            progressTracker.stage = 'preparing';
            progressTracker.currentFilePath = file.path;
            progressTracker.currentFileIndex = offset - 1;
            emitIndexingProgress(options, progressTracker, 'plan');
            const prepared = await this.prepareSource(file, options, progressTracker, staged?.file === file ? preloaded : undefined);
            if (prepared) {
              residentBytes += prepared.snapshot.chargeBytes + prepared.documents.reduce((sum, doc) => sum + doc.text.length * 2, 0);
              chunkCount += prepared.chunks.length;
            } else preparationSkips.add(file.path);
          } catch (error) {
            throwIfIndexingCancelled(options.signal, options.isCurrent);
            if (isIndexingCancelledError(error) || error instanceof IndexingPerformancePausedError) throw error;
            progressTracker.preparedSources.delete(file.path);
            preparationFailures.set(file.path, error);
            const unsupported = error instanceof SourceReadError && error.reason === 'binary';
            recordRagIndexingVerdict(options.inventory, file, unsupported ? { kind: 'unsupported' } : { kind: 'failed', reason: error instanceof SourceReadError ? error.reason : 'preparation-failed' });
            if (!unsupported) this.failedFiles.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, reason: error instanceof SourceReadError ? error.reason : error instanceof Error ? error.message : 'preparation-failed' });
          }
        }
        // 이 윈도의 원문과 lexical checkpoint가 내구 반영된 뒤에만 임베딩을 시작합니다.
        progressTracker.planningComplete = offset === files.length;
        emitIndexingProgress(options, progressTracker, 'plan');
        const countDispatch = progressTracker.onInferenceDispatch;
        progressTracker.onInferenceDispatch = () => {
          countDispatch?.();
          if (!windowOpen || !canPrepareAhead || lookahead.current || offset >= files.length || residentBytes >= PREPARED_WINDOW_BYTES || chunkCount >= PREPARED_WINDOW_CHUNKS || options.signal?.aborted || options.isCurrent?.() === false || options.getPerformanceGuardState?.()?.mode === 'paused') return;
          const controller = new AbortController();
          const staged: SourceLookahead = { file: files[offset], controller, snapshot: Promise.resolve(null) };
          lookahead.current = staged;
          const plannedSourceBytes = PREPARED_WINDOW_BYTES - residentBytes;
          const preparedBudgetBytes = plannedSourceBytes - staged.file.stat.size * 4;
          if (!Number.isSafeInteger(preparedBudgetBytes) || preparedBudgetBytes <= 0) { lookahead.current = null; return; }
          try {
            const plan = this.embeddingProvider.planLocalAdmission?.({ sourceBudgetBytes: PREPARED_WINDOW_BYTES, reservedSourceBytes: residentBytes, plannedSourceBytes });
            if (!plan?.admitSourcePrefetch) { lookahead.current = null; return; }
            const abort = (): void => controller.abort();
            options.signal?.addEventListener('abort', abort, { once: true });
            if (options.signal?.aborted) abort();
            staged.snapshot = readSourceFileSnapshot(this.vault, staged.file, {
              signal: controller.signal, priority: 'background', forceRefresh: true,
              preparation: { path: staged.file.path, chunkSize: this.ragConfig.chunkSize, overlap: this.ragConfig.overlap,
                maxChargeBytes: preparedBudgetBytes, maxPreparedChunks: PREPARED_WINDOW_CHUNKS - chunkCount },
            }).then((snapshot) => {
              if (!snapshot) observationWindow.valid = false;
              if (snapshot && (!Number.isSafeInteger(snapshot.chargeBytes) || snapshot.chargeBytes > plannedSourceBytes)) { observationWindow.valid = false; canPrepareAhead = false; return null; }
              return snapshot;
            }).catch(() => {
              observationWindow.valid = false;
              canPrepareAhead = false;
              return null;
            }).finally(() => options.signal?.removeEventListener('abort', abort));
          } catch {
            observationWindow.valid = false;
            canPrepareAhead = false;
            lookahead.current = null;
          }
        };
        if (canPrefetch) {
          try { await this.prefetchCrossFileEmbeddings(window, options, progressTracker); }
          catch (error) {
            throwIfIndexingCancelled(options.signal, options.isCurrent);
            if (isIndexingCancelledError(error) || error instanceof IndexingPerformancePausedError) throw error;
            throwIfPerformanceGuardPaused(options);
            observationWindow.valid = false;
            canPrefetch = false;
            progressTracker.prefetchedVectorsByText.clear();
            this.logger.warn('Cross-file embedding prefetch failed; continuing per-file.');
          }
        }
        for (const file of window) {
          progressTracker.currentFilePath = file.path;
          progressTracker.currentFileEstimatedChunks = estimateFileChunkCount(file, this.ragConfig);
          progressTracker.currentFilePlannedChunks = progressTracker.plannedChunkCountsByPath.get(file.path) ?? estimateFileChunkCount(file, this.ragConfig);
          throwIfIndexingCancelled(options.signal, options.isCurrent);
          try {
            if (preparationFailures.has(file.path)) throw preparationFailures.get(file.path);
            if (preparationSkips.has(file.path)) {
              batchResult.skipped++;
              batchResult.documents.push(file.path);
              progressTracker.skipped++;
              completeProgressFile(progressTracker, 0, 0, 'skipped');
              emitIndexingProgress(options, progressTracker, 'file-complete');
              continue;
            }
            const result = await this.indexFile(file, options, progressTracker, files.indexOf(file));
            batchResult.partial = (batchResult.partial ?? 0) + (result.partial ?? 0);
            batchResult.indexed += result.indexed;
            batchResult.vectors += result.vectors;
            batchResult.skipped += result.skipped;
            batchResult.documents.push(...result.documents);
          } catch (error) {
            if (isIndexingCancelledError(error) || error instanceof IndexingPerformancePausedError || options.signal?.aborted) throw error;
            batchResult.skipped++;
            batchResult.documents.push(file.path);
            progressTracker.skipped++;
            const unsupported = error instanceof SourceReadError && error.reason === 'binary';
            completeProgressFile(progressTracker, 0, 0, unsupported ? 'skipped' : 'failed');
            if (!unsupported) batchResult.failed = (batchResult.failed ?? 0) + 1;
            emitIndexingProgress(options, progressTracker, 'file-complete');
            this.logger.warn('File indexing failed.', { data: { path: file.path }, error });
          } finally {
            progressTracker.preparedSources.delete(file.path);
          }
        }
        windowSettled = true;
      } finally {
        windowOpen = false;
        progressTracker.onInferenceDispatch = undefined;
        if (!windowSettled) lookahead.current?.controller.abort();
        await lookahead.current?.snapshot;
        finishPipelineWindow(progressTracker, options, observationWindow, windowSettled);
        // 실패·중단 시 성공 flush 없이 큰 본문·청크·벡터 참조만 해제합니다.
        progressTracker.preparedSources.clear();
        progressTracker.prefetchedVectorsByText.clear();
      }
    }
    progressTracker.planningComplete = true;
    progressTracker.stage = 'settled';
    finalizePipeline(progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');
  }

  private async prepareSource(file: TFile, options: IndexingOptions, tracker: IndexingProgressTracker, preloaded?: SourceFileSnapshot | null): Promise<PreparedSource | null> {
    tracker.stage = 'preparing';
    emitIndexingProgress(options, tracker, 'plan');
    const sourceEpoch = this.recoverySourceEpoch;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    throwIfPerformanceGuardPaused(options);
    const current = this.vault.getAbstractFileByPath(file.path);
    if (!isCurrentVaultFile(current)) return null;
    if (isRagFileMetadataExcluded(this.vault, current, this.ragConfig, this.chatConfig)) {
      recordRagIndexingVerdict(options.inventory, current, { kind: 'policy-excluded' });
      await this.removeFile(file.path);
      return null;
    }
    const owner = this.fileOwners.get(file.path) ?? Symbol(file.path);
    this.fileOwners.set(file.path, owner);
    const invalidated = this.invalidatedRecoveryPaths.has(current.path);
    const reusable = !invalidated && current === file && preloaded?.revision.filePath === current.path && preloaded.revision.sourceMtime === current.stat.mtime && preloaded.revision.sourceSize === current.stat.size;
    const snapshot = reusable ? preloaded : await readSourceFileSnapshot(this.vault, current, { signal: options.signal, priority: 'background', preparation: { path: current.path, chunkSize: this.ragConfig.chunkSize, overlap: this.ragConfig.overlap }, forceRefresh: options.automaticRecovery !== true || invalidated,
      onProgress: (page, pageCount) => {
        tracker.sourcePage = page;
        tracker.sourcePageCount = pageCount;
        emitIndexingProgress(options, tracker, 'plan');
      },
    });
    if (!snapshot) return null;
    const verdict = getRagPreparedContentVerdict(this.vault, current, snapshot.content, this.ragConfig, this.chatConfig);
    recordRagIndexingVerdict(options.inventory, current, verdict);
    if (verdict.kind === 'failed') throw new SourceReadError(verdict.reason ?? 'frontmatter-unreadable');
    if (verdict.kind === 'policy-excluded') {
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      if (this.fileOwners.get(file.path) === owner && this.vault.getAbstractFileByPath(file.path) === current && current.stat.mtime === snapshot.revision.sourceMtime && current.stat.size === snapshot.revision.sourceSize) await this.removeFile(file.path);
      return null;
    }
    tracker.sourcePage = undefined;
    tracker.sourcePageCount = undefined;
    const chunks = snapshot.chunks;
    if (!chunks) throw new Error('Prepared source chunks are unavailable.');
    const documents = buildSourceDocuments(snapshot.file, snapshot.content, this.ragConfig, snapshot.segments, this.metadataCache?.getFileCache(current), chunks, snapshot.revision.contentHash);
    const prepared: PreparedSource = {
      snapshot, originalFile: current, owner, recoveryOwner: crypto.randomUUID(), documents, chunks,
      mtime: snapshot.revision.sourceMtime, size: snapshot.revision.sourceSize,
      text: snapshot.content, segments: snapshot.segments, contentHash: snapshot.revision.contentHash,
    };
    tracker.stage = 'lexical';
    emitIndexingProgress(options, tracker, 'plan');
    tracker.preparedSources.set(file.path, prepared);
    tracker.totalPlannedChunks += chunks.length - (tracker.plannedChunkCountsByPath.get(file.path) ?? estimateFileChunkCount(file, this.ragConfig));
    tracker.plannedChunkCountsByPath.set(file.path, chunks.length);
    // 독립 DB와 파일시스템을 한 원자 트랜잭션으로 간주하지 않습니다.
    if (!(await this.isPreparedCurrent(prepared, options, false))) throw new Error('Source changed before recovery registration.');
    await this.vectorStore.beginPendingWriteRecovery?.([file.path], prepared.recoveryOwner);
    if (!(await this.isPreparedCurrent(prepared, options, false))) throw new Error('Source changed before lexical commit.');
    await this.documentCorpus?.replaceBatchFileDocuments([{ filePath: file.path, documents, sourceMetadata: snapshot.sourceMetadata, sourceMetadataHash: snapshot.sourceMetadataHash, sourceRevision: snapshot.revision,
      ...(snapshot.bodyPlan ? { sourceBody: { text: snapshot.content, plan: snapshot.bodyPlan } } : {}) }]);
    this.bm25Index?.replaceSourceDocuments(file.path, documents);
    await this.bm25Index?.flush();
    if (!(await this.isPreparedCurrent(prepared, options, false))) throw new Error('Source changed during lexical commit.');
    if (sourceEpoch === this.recoverySourceEpoch) this.invalidatedRecoveryPaths.delete(file.path);
    return prepared;
  }

  private async isPreparedCurrent(prepared: PreparedSource, options: IndexingOptions, reread = true): Promise<boolean> {
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    throwIfPerformanceGuardPaused(options);
    const path = prepared.snapshot.revision.filePath;
    const current = this.vault.getAbstractFileByPath(path);
    if (this.fileOwners.get(path) !== prepared.owner || current !== prepared.originalFile || !isCurrentVaultFile(current)) return false;
    if (isRagFileMetadataExcluded(this.vault, current, this.ragConfig, this.chatConfig)) return false;
    if (!reread) return current.stat.mtime === prepared.mtime && current.stat.size === prepared.size &&
      !isRagFileExcludedWithContent(this.vault, current, prepared.text, this.ragConfig, this.chatConfig);
    // stat가 같아도 현재 바이트와 구절의 해시는 다시 읽습니다.
    const fresh = await readSourceFileSnapshot(this.vault, current, { signal: options.signal, forceRefresh: true });
    return !!fresh && this.fileOwners.get(path) === prepared.owner && this.vault.getAbstractFileByPath(path) === current &&
      isSourceRevisionCurrentRust(prepared.snapshot.revision, fresh.revision) && prepared.snapshot.sourceMetadataHash === fresh.sourceMetadataHash &&
      !isRagFileExcludedWithContent(this.vault, fresh.file, fresh.content, this.ragConfig, this.chatConfig);
  }

  private async prefetchCrossFileEmbeddings(files: readonly TFile[], options: IndexingOptions, tracker: IndexingProgressTracker): Promise<void> {
    const inputs: string[] = [];
    let eligible = 0;
    for (const file of files) {
      const prepared = tracker.preparedSources.get(file.path);
      if (!prepared) continue;
      const existing = tracker.existingRecordsByPath?.get(file.path);
      if (existing && isCurrentFileIndexRecord(existing, prepared.contentHash, this.ragConfig)) continue;
      eligible++;
      for (const chunk of prepared.chunks) inputs.push(buildSearchText(file, chunk));
    }
    if (eligible < 2 || inputs.length < 2) return;
    const vectors = await this.embedTextsInBatches(inputs, options, tracker);
    for (let index = 0; index < inputs.length; index++) tracker.prefetchedVectorsByText.set(inputs[index], vectors[index]);
  }

  private planProgressChunks(files: readonly TFile[], options: IndexingOptions, tracker: IndexingProgressTracker): void {
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    tracker.plannedChunkCountsByPath.clear();
    tracker.preparedSources.clear();
    tracker.totalPlannedChunks = files.reduce((sum, file) => sum + estimateFileChunkCount(file, this.ragConfig), 0);
    tracker.completedPlannedChunks = 0;
    tracker.currentFilePlannedChunks = 0;
    tracker.planningComplete = false;
  }

  async indexFile(
    file: TFile,
    options: IndexingOptions = {},
    progressTracker?: IndexingProgressTracker,
    fileIndex = 0,
  ): Promise<IndexingResult> {
    const path = file.path;
    const owner = progressTracker?.preparedSources.get(path)?.owner ?? Symbol(path);
    const revision = { mtime: file.stat.mtime, size: file.stat.size };
    this.fileOwners.set(path, owner);
    const tracker = progressTracker ?? createProgressTracker([file], this.ragConfig);
    if (!progressTracker) tracker.pipeline.totalKnown = true;
    if (!progressTracker) {
      emitIndexingProgress(options, tracker, 'plan');
      this.planProgressChunks([file], options, tracker);
      tracker.currentFileEstimatedChunks = estimateFileChunkCount(file, this.ragConfig);
      tracker.currentFilePlannedChunks = tracker.plannedChunkCountsByPath.get(file.path) ?? estimateFileChunkCount(file, this.ragConfig);
    }
    tracker.currentFilePath = path;
    const completedBefore = tracker.completedFiles;
    const window = progressTracker ? undefined : beginPipelineWindow(tracker, options);
    let settled = false;
    try {
      const result = await this.indexFileInternal(file, options, tracker, fileIndex);
      settled = true;
      if (!progressTracker) tracker.planningComplete = true;
      if (this.fileOwners.get(path) === owner && (tracker.completedFiles > completedBefore || (result.partial ?? 0) > 0)) this.failedFiles.delete(path);
      return result;
    } catch (error) {
      if (!progressTracker && !isIndexingCancelledError(error) && !(error instanceof IndexingPerformancePausedError)) {
        completeProgressFile(tracker, 0, 0, error instanceof SourceReadError && error.reason === 'binary' ? 'skipped' : 'failed');
        emitIndexingProgress(options, tracker, 'file-complete');
      }
      if (this.fileOwners.get(path) === owner && error instanceof SourceReadError) {
        recordRagIndexingVerdict(options.inventory, file, error.reason === 'binary' ? { kind: 'unsupported' } : { kind: 'failed', reason: error.reason });
      }
      if (
        this.fileOwners.get(path) === owner &&
        !(error instanceof IndexingCancelledError) &&
        !(error instanceof IndexingPerformancePausedError) &&
        !(error instanceof SourceReadError && error.reason === 'binary')
      )
        this.failedFiles.set(path, { ...revision, reason: error instanceof SourceReadError ? error.reason : error instanceof Error ? error.message : 'indexing-failed' });
      throw error;
    } finally {
      if (window) {
        finishPipelineWindow(tracker, options, window, settled);
        if (settled) {
          finalizePipeline(tracker);
          emitIndexingProgress(options, tracker, 'plan');
        }
      }
    }
  }

  private async indexFileInternal(
    file: TFile,
    options: IndexingOptions,
    tracker: IndexingProgressTracker,
    fileIndex = 0,
  ): Promise<IndexingResult> {
    const startedAt = performance.now();
    const currentFile = this.vault.getAbstractFileByPath(file.path);
    if (!isCurrentVaultFile(currentFile)) {
      tracker.skipped += 1;
      completeProgressFile(tracker, 0, 0, 'skipped');
      emitIndexingProgress(options, tracker, 'file-complete');
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
    if (isRagFileMetadataExcluded(this.vault, file, this.ragConfig, this.chatConfig)) {
      await this.removeFile(file.path);
      tracker.skipped += 1;
      completeProgressFile(tracker, 0, 0, 'skipped');
      emitIndexingProgress(options, tracker, 'file-complete');
      this.logger.debug('File indexing skipped by the current exclusion policy.', {
        data: { path: file.path },
      });
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
    }
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    tracker.currentFilePath = file.path;
    tracker.currentFileIndex = fileIndex;
    tracker.currentFileTotalChunks = 0;
    tracker.currentFileEmbeddedChunks = 0;
    tracker.currentFileEstimatedChunks = estimateFileChunkCount(file, this.ragConfig);
    tracker.currentFilePlannedChunks = tracker.plannedChunkCountsByPath.get(file.path) ?? estimateFileChunkCount(file, this.ragConfig);
    tracker.currentFileBatchDurationMs = 0;
    const fileStartedAt = performance.now();
    emitIndexingProgress(options, tracker, 'file-start');
    this.logger.debug('File indexing started.', {
      data: { path: file.path, size: file.stat.size },
    });
    const prepared = tracker.preparedSources.get(file.path) ?? await this.prepareSource(file, options, tracker);
    const snapshot = prepared?.snapshot;
    if (!snapshot) {
      tracker.skipped += 1;
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0, 'skipped');
      emitIndexingProgress(options, tracker, 'file-complete');
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
    }
    file = snapshot.file;
    tracker.currentFilePlannedChunks = prepared.chunks.length;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const sourceHash = snapshot.revision.contentHash;
    const currentRecord = tracker.existingRecordsByPath ? (tracker.existingRecordsByPath.get(file.path) ?? null) : await this.vectorStore.getFileIndexRecord(file.path);
    if (currentRecord && isCurrentFileIndexRecord(currentRecord, sourceHash, this.ragConfig)) {
      if (!(await this.isPreparedCurrent(prepared, options))) throw new Error('Source changed before metadata commit.');
      const existingEntries = await this.vectorStore.getEntriesByFilePaths([file.path]);
      const byId = new Map(existingEntries.map((entry) => [entry.id, entry]));
      const updatedEntries = prepared.chunks.map((chunk): VectorEntry | null => {
        const existing = byId.get(chunk.id);
        return existing ? { ...existing, metadata: { ...existing.metadata,
          heading: chunk.metadata.heading, startLine: chunk.metadata.startLine, endLine: chunk.metadata.endLine,
          sourceSegment: chunk.metadata.sourceSegment, sourceMetadataHash: snapshot.sourceMetadataHash,
          sourceMtime: file.stat.mtime, sourceSize: file.stat.size,
        } } : null;
      });
      if (!updatedEntries.some((entry) => entry === null)) {
        if (currentRecord.sourceMetadataHash !== snapshot.sourceMetadataHash || currentRecord.sourceMtime !== file.stat.mtime || currentRecord.sourceSize !== file.stat.size || existingEntries.length !== updatedEntries.length) {
          if (updatedEntries.length === 0) {
            await this.vectorStore.markFileIndexedWithoutVectors({ ...currentRecord, sourceMtime: file.stat.mtime, sourceSize: file.stat.size, contentHash: sourceHash, sourceMetadata: snapshot.sourceMetadata, sourceMetadataHash: snapshot.sourceMetadataHash, updated: Date.now() });
          } else if (currentRecord.sourceMetadataHash === snapshot.sourceMetadataHash && existingEntries.length === updatedEntries.length) {
            await this.vectorStore.refreshFileIndexRevision({ filePath: file.path, sourceMtime: file.stat.mtime, sourceSize: file.stat.size, contentHash: sourceHash });
          } else {
            await this.vectorStore.replaceBatchFileEntries([{ filePath: file.path, entries: updatedEntries.filter((entry): entry is VectorEntry => entry !== null), sourceMetadata: snapshot.sourceMetadata, sourceMetadataHash: snapshot.sourceMetadataHash }]);
          }
        }
        if (!(await this.isPreparedCurrent(prepared, options))) throw new Error('Source changed during metadata commit.');
        await this.vectorStore.completePendingWriteRecovery?.([file.path], prepared.recoveryOwner);
        const partial = snapshot.sourceMetadata.completeness?.status === 'partial';
        const skipped = finishIndexingResult(
          { indexed: 0, vectors: 0, skipped: partial ? 0 : 1, documents: [file.path], ...(partial ? { partial: 1 } : {}) },
          startedAt,
          options,
        );
        if (!partial && prepared.chunks.length > 0) tracker.skipped += 1;
        completeProgressFile(tracker, performance.now() - fileStartedAt, 0, partial ? 'partial' : prepared.chunks.length === 0 ? 'completed' : 'skipped');
        emitIndexingProgress(options, tracker, 'file-complete');
        this.failedFiles.delete(file.path);
        this.logger.debug('File indexing skipped because content hash and chunks are unchanged.', {
          data: { path: file.path },
        });
        return skipped;
      }
    }
    const indexedAt = Date.now();
    const chunks = prepared.chunks;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    if (chunks.length === 0) {
      const emptyRecord = planEmptyFileIndexRecordRust(
        {
          filePath: file.path,
          sourceMtime: file.stat.mtime,
          sourceSize: file.stat.size,
          contentHash: sourceHash,
          indexedAt,
          embeddingProvider: this.ragConfig.embeddingProvider,
          embeddingModel: this.ragConfig.embeddingModel,
        },
        indexedAt,
      );
      if (!emptyRecord) {
        throw new Error('Rust empty-file index record planning failed');
      }
      if (!(await this.isPreparedCurrent(prepared, options))) throw new Error('Source changed before empty-file commit.');
      await this.vectorStore.markFileIndexedWithoutVectors({ ...emptyRecord, sourceMetadata: snapshot.sourceMetadata, sourceMetadataHash: snapshot.sourceMetadataHash });
      if (!(await this.isPreparedCurrent(prepared, options))) throw new Error('Source changed during empty-file commit.');
      await this.vectorStore.completePendingWriteRecovery?.([file.path], prepared.recoveryOwner);
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      const partial = snapshot.sourceMetadata.completeness?.status === 'partial';
      const skipped = finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: partial ? 0 : 1, documents: [file.path], ...(partial ? { partial: 1 } : {}) },
        startedAt,
        options,
      );
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0, partial ? 'partial' : 'completed');
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
    const metadata = this.metadataCache?.getFileCache(file);
    tracker.stage = 'embedding';
    emitIndexingProgress(options, tracker, 'file-chunks');
    const vectors = await this.embedTextsInBatches(texts, options, tracker);
    throwIfIndexingCancelled(options.signal, options.isCurrent);

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i],
      metadata: {
        filePath: file.path,
        ...getBM25DocumentFields(file, metadata, chunk.metadata.heading),
        heading: chunk.metadata.heading,
        startLine: chunk.metadata.startLine,
        endLine: chunk.metadata.endLine,
        text: chunk.text,
        sourceMtime: file.stat.mtime,
        sourceSize: file.stat.size,
        contentHash: sourceHash,
        chunkHash: chunk.chunkHash,
        sourceSegment: chunk.metadata.sourceSegment,
        sourceMetadataHash: snapshot.sourceMetadataHash,
        indexedAt,
        embeddingProvider: this.ragConfig.embeddingProvider,
        embeddingModel: this.ragConfig.embeddingModel,
      },
    }));

    const latestFile = this.vault.getAbstractFileByPath(file.path);
    const currentSnapshot = isCurrentVaultFile(latestFile) && !isRagFileMetadataExcluded(this.vault, latestFile, this.ragConfig, this.chatConfig)
      ? await readSourceFileSnapshot(this.vault, latestFile, { signal: options.signal, forceRefresh: true })
      : null;
    if (
      !currentSnapshot ||
      !isSourceRevisionCurrentRust(snapshot.revision, currentSnapshot.revision) || snapshot.sourceMetadataHash !== currentSnapshot.sourceMetadataHash
    ) {
      if (
        this.fileOwners.get(file.path) === prepared.owner && isCurrentVaultFile(latestFile) &&
        (await isRagFileExcluded(this.vault, latestFile, this.ragConfig, this.chatConfig))
      )
        await this.removeFile(file.path);
      this.logger.debug('Late embedding result skipped because source revision changed.', {
        data: { path: file.path },
      });
      tracker.skipped += 1;
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0, 'skipped');
      emitIndexingProgress(options, tracker, 'file-complete');
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
    }
    if (
      isRagFileExcludedWithContent(this.vault, currentSnapshot.file, currentSnapshot.content, this.ragConfig, this.chatConfig)
    ) {
      if (this.fileOwners.get(file.path) === prepared.owner) await this.removeFile(file.path);
      tracker.skipped += 1;
      completeProgressFile(tracker, performance.now() - fileStartedAt, 0, 'skipped');
      emitIndexingProgress(options, tracker, 'file-complete');
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
    }
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    if (!(await this.isPreparedCurrent(prepared, options, false))) throw new Error('Source changed before vector commit.');
    tracker.stage = 'committing';
    emitIndexingProgress(options, tracker, 'file-chunks');
    await this.vectorStore.replaceBatchFileEntries([{ filePath: file.path, entries, sourceMetadata: snapshot.sourceMetadata, sourceMetadataHash: snapshot.sourceMetadataHash }]);
    if (!(await this.isPreparedCurrent(prepared, options))) throw new Error('Source changed during vector commit.');
    tracker.existingRecordsByPath?.set(file.path, {
      filePath: file.path, sourceMtime: file.stat.mtime, sourceSize: file.stat.size, contentHash: sourceHash,
      indexedAt, embeddingProvider: this.ragConfig.embeddingProvider, embeddingModel: this.ragConfig.embeddingModel,
      hasCompleteMetadata: true, vectorCount: entries.length, updated: indexedAt,
    });
    // 중단된 쓰기로 등록된 복구 요청은 재색인이 끝난 시점에 완료 처리한다.
    await this.vectorStore.completePendingWriteRecovery?.([file.path], prepared.recoveryOwner);
    const partial = snapshot.sourceMetadata.completeness?.status === 'partial';

    const finished = finishIndexingResult(
      { indexed: partial ? 0 : 1, vectors: entries.length, skipped: 0, documents: [file.path], ...(partial ? { partial: 1 } : {}) },
      startedAt,
      options,
    );
    tracker.stage = 'settled';
    tracker.indexed += partial ? 0 : 1;
    tracker.vectors += entries.length;
    if (partial) {
      completeProgressFile(tracker, 0, 0, 'partial');
    } else completeProgressFile(tracker, performance.now() - fileStartedAt, entries.length, 'completed');
    emitIndexingProgress(options, tracker, 'file-complete');
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
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const progressTracker = createProgressTracker([], this.ragConfig);
    const inventory = options.inventory ?? getRagIndexingManifest(this.vault, this.ragConfig, this.chatConfig);
    options = { ...options, inventory };
    const files = inventory.candidates;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    this.recordInventoryFailures(inventory);
    this.logger.info('Vault full reindex started.', { data: { fileCount: files.length } });
    resetProgressTrackerPlan(progressTracker, files, this.ragConfig);
    emitIndexingProgress(options, progressTracker, 'plan');
    this.planProgressChunks(files, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');
    const existingSourcePaths = new Set(await this.vectorStore.getIndexedFilePaths());
    for (const sourcePath of (await this.bm25Index?.getSourcePaths()) ?? []) {
      existingSourcePaths.add(sourcePath);
    }
    this.completeInventoryFailures(inventory.failures, options, progressTracker);
    const result = await this.indexFiles(files, startedAt, options, progressTracker, inventory.failures);
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const currentSourcePaths = new Set([...files, ...inventory.failures.map(({ file }) => file)].map((file) => file.path));
    await this.withIndexBatch(async () => {
      for (const sourcePath of existingSourcePaths) {
        if (currentSourcePaths.has(sourcePath)) continue;
        await this.removeOrphanSource(sourcePath, options);
      }
    });
    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        ...(result.partial ? { partial: result.partial } : {}),
        ...(result.failed ? { failed: result.failed } : {}),
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    return finished;
  }

  private async removeOrphanedSources(
    files: readonly TFile[],
    options: IndexingOptions,
  ): Promise<void> {
    const existingSourcePaths = new Set(await this.vectorStore.getIndexedFilePaths());
    for (const sourcePath of (await this.bm25Index?.getSourcePaths()) ?? []) {
      existingSourcePaths.add(sourcePath);
    }
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const currentSourcePaths = new Set(files.map((file) => file.path));
    await this.withIndexBatch(async () => {
      for (const sourcePath of existingSourcePaths) {
        if (currentSourcePaths.has(sourcePath)) continue;
        await this.removeOrphanSource(sourcePath, options);
      }
    });
    throwIfIndexingCancelled(options.signal, options.isCurrent);
  }

  private async removeOrphanSource(path: string, options: IndexingOptions): Promise<void> {
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const owner = this.fileOwners.get(path);
    const file = this.vault.getAbstractFileByPath(path);
    if (isCurrentVaultFile(file) && !isRagFileMetadataExcluded(this.vault, file, this.ragConfig, this.chatConfig)) {
      try {
        const snapshot = await readSourceFileSnapshot(this.vault, file, { signal: options.signal, forceRefresh: true });
        if (!snapshot || !isRagFileExcludedWithContent(this.vault, snapshot.file, snapshot.content, this.ragConfig, this.chatConfig)) return;
      } catch (error) {
        throwIfIndexingCancelled(options.signal, options.isCurrent);
        if (isIndexingCancelledError(error)) throw error;
        if (this.fileOwners.get(path) !== owner) return;
        this.failedFiles.set(path, { mtime: file.stat.mtime, size: file.stat.size, reason: error instanceof SourceReadError ? error.reason : error instanceof Error ? error.message : 'source-read-failed' });
        return;
      }
    }
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    if (this.fileOwners.get(path) !== owner) return;
    await this.removeFile(path);
  }

  async removeFile(filePath: string): Promise<number> {
    const owner = Symbol(filePath);
    const recoveryOwner = crypto.randomUUID();
    this.fileOwners.set(filePath, owner);
    await this.vectorStore.beginPendingWriteRecovery?.([filePath], recoveryOwner);
    if (this.fileOwners.get(filePath) !== owner) return 0;
    await this.documentCorpus?.removeFile(filePath);
    if (this.fileOwners.get(filePath) !== owner) return 0;
    const removed = await this.vectorStore.removeByFilePath(filePath);
    if (this.fileOwners.get(filePath) !== owner) return removed;
    if (this.bm25Index) {
      this.bm25Index.removeDocumentsBySource(filePath);
      await this.bm25Index.flush();
    }
    // 다른 owner가 인수한 복구 요청은 이전 삭제 작업이 해제하지 않습니다.
    if (this.fileOwners.get(filePath) === owner) await this.vectorStore.completePendingWriteRecovery?.([filePath], recoveryOwner);
    return removed;
  }

  /**
   * 중단된 파일 쓰기 원장을 보고하고 내구 복구 요청으로 등록합니다.
   * 반환된 경로를 다시 색인하거나 삭제하면 요청이 자동으로 완료됩니다.
   */
  async listPendingWriteRecovery(): Promise<string[]> {
    return (await this.vectorStore.probePendingFileWrites?.()) ?? [];
  }

  private captureRecoveryCurrentness(files: readonly TFile[], options: IndexingOptions): () => void {
    const epoch = this.recoverySourceEpoch;
    const snapshots = files.map((file) => ({ file, path: file.path, mtime: file.stat.mtime, size: file.stat.size, owner: this.fileOwners.get(file.path) }));
    return () => {
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      if (epoch !== this.recoverySourceEpoch || snapshots.some(({ file, path, mtime, size, owner }) =>
        this.vault.getAbstractFileByPath(path) !== file || file.path !== path || file.stat.mtime !== mtime || file.stat.size !== size || this.fileOwners.get(path) !== owner)) {
        throw new IndexingCancelledError();
      }
    };
  }

  private async planPendingFiles(inventory: RagFileInventory, options: IndexingOptions) {
    const requireCurrent = this.captureRecoveryCurrentness(inventory.candidates, options);
    const status = await calculateRagStatus(this.vault, this.vectorStore, this.ragConfig, this.chatConfig, options.signal, inventory);
    requireCurrent();
    const recoveryPaths = (await this.vectorStore.readPendingWriteRecovery?.()) ?? [];
    requireCurrent();
    // 실패·내구 recovery까지 합친 뒤 Native에서 terminal partial을 판정합니다.
    const requiredPaths = [...getRagUnverifiedIndexingFiles(inventory).map((file) => file.path),
      ...status.updateRequiredDocuments.map((document) => document.path), ...inventory.failures.map(({ file }) => file.path), ...this.getFailedFilePaths(), ...recoveryPaths, ...this.invalidatedRecoveryPaths];
    const plan = planIndexPendingFilesRust(inventory.candidates.map((file) => file.path), requiredPaths);
    if (!plan) throw new Error('Rust pending index file planning failed');
    return plan;
  }

  private async planAutomaticRecovery(inventory: RagFileInventory, pendingIndices: readonly number[], options: IndexingOptions) {
    const requireCurrent = this.captureRecoveryCurrentness(inventory.candidates, options);
    const [corpusRows, vectorRows] = await Promise.all([
      this.documentCorpus?.getFileIndexRecords?.() ?? Promise.resolve([]), this.vectorStore.getFileIndexRecords(),
    ]);
    requireCurrent();
    const corpus = new Map(corpusRows.map((row) => [row.filePath, row]));
    const vectors = new Map(vectorRows.map((row) => [row.filePath, row]));
    const pendingFiles = pendingIndices.map((index) => inventory.candidates[index]);
    const plan = planRagAutomaticRecoveryBatchRust(pendingFiles.map((file) => {
      const prepared = getRagPreparedSourceRevision(this.vault, file);
      return { path: file.path, mtime: file.stat.mtime, size: file.stat.size,
        invalidated: this.invalidatedRecoveryPaths.has(file.path) || inventory.failures.some((failure) => failure.file.path === file.path),
        ...(prepared ? { contentHash: prepared.contentHash, sourceMetadataHash: prepared.sourceMetadataHash } : {}),
        corpusRecord: projectRecoveryPartialRecord(corpus.get(file.path)), vectorRecord: projectRecoveryPartialRecord(vectors.get(file.path)) };
    }));
    if (!plan) throw new Error('Rust automatic RAG recovery batch planning failed');
    requireCurrent();
    return { ...plan, deferredPaths: plan.deferredIndices.map((index) => pendingFiles[index].path) };
  }

  async getAutomaticRecoveryPendingState(options: IndexingOptions = {}) {
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const manifest = options.inventory ?? getRagIndexingManifest(this.vault, this.ragConfig, this.chatConfig);
    const inventory = { ...manifest, candidates: [...manifest.candidates, ...manifest.failures.map(({ file }) => file)] };
    const requireCurrent = this.captureRecoveryCurrentness(inventory.candidates, options);
    const pending = await this.planPendingFiles(inventory, options);
    requireCurrent();
    const plan = await this.planAutomaticRecovery(inventory, pending.fileIndices, options);
    requireCurrent();
    return plan;
  }

  async indexPending(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    const progressTracker = createProgressTracker([], this.ragConfig);
    const inventory = options.inventory ?? getRagIndexingManifest(this.vault, this.ragConfig, this.chatConfig);
    options = { ...options, inventory };
    const files = inventory.candidates;
    throwIfIndexingCancelled(options.signal, options.isCurrent);
    this.recordInventoryFailures(inventory);
    await this.removeOrphanedSources([...files, ...inventory.failures.map(({ file }) => file)], options);
    const candidatePaths = files.map((file) => file.path);
    const requireCurrent = this.captureRecoveryCurrentness(files, options);
    const pendingPlan = await this.planPendingFiles(inventory, options);
    requireCurrent();

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
    const automatic = options.automaticRecovery
      ? await this.planAutomaticRecovery(inventory, normalizedPendingPlan.fileIndices, options)
      : null;
    requireCurrent();
    const selectedFileIndices = automatic
      ? automatic.batchIndices.map((index) => normalizedPendingPlan.fileIndices[index])
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
    this.planProgressChunks(selectedFiles, options, progressTracker);
    emitIndexingProgress(options, progressTracker, 'plan');

    this.completeInventoryFailures(inventory.failures, options, progressTracker);
    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      batchResult.skipped = Math.max(candidatePaths.length - selectedFiles.length, 0) + inventory.failures.length;
      if (inventory.failures.length > 0) batchResult.failed = inventory.failures.length;
      batchResult.documents.push(...inventory.failures.map(({ file }) => file.path));
      await this.indexBatchFiles(selectedFiles, batchResult, options, progressTracker);
      return batchResult;
    });

    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        ...(result.partial ? { partial: result.partial } : {}),
        ...(result.failed ? { failed: result.failed } : {}),
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    return finished;
  }

  private async embedTextsInBatches(
    texts: string[],
    options: IndexingOptions,
    progressTracker?: IndexingProgressTracker,
  ): Promise<number[][]> {
    if (progressTracker && texts.length > 0 && texts.every((text) => progressTracker.prefetchedVectorsByText.has(text))) {
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      throwIfPerformanceGuardPaused(options);
      const cached = texts.map((text) => progressTracker.prefetchedVectorsByText.get(text)!);
      for (const text of texts) progressTracker.prefetchedVectorsByText.delete(text);
      progressTracker.currentFileEmbeddedChunks = progressTracker.currentFileTotalChunks;
      emitIndexingProgress(options, progressTracker, 'batch-complete');
      return cached;
    }
    const plan = planEmbeddingInputsRust(texts);
    if (!plan) throw new Error('Rust embedding batch planning failed');
    const inputs = plan.inputIndices.map((index) => texts[index]);
    const vectors: number[][] = [];
    let expectedDimension: number | undefined;
    let offset = 0;

    while (offset < inputs.length) {
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      throwIfPerformanceGuardPaused(options);
      const requestedBatchSize =
        options.getMaxEmbeddingBatchSize?.() ?? options.maxEmbeddingBatchSize ?? inputs.length;
      const batchSize = Math.max(1, Math.floor(requestedBatchSize));
      const batch = inputs.slice(offset, offset + batchSize);
      const startedAt = performance.now();
      this.logger.trace('Embedding batch started.', {
        data: {
          offset,
          batchSize: batch.length,
          total: texts.length,
        },
      });
      const batchVectors = await awaitEmbeddingBatch(
        this.embeddingProvider.embedBatch(batch, { signal: options.signal, priority: 'background', onInferenceDispatch: progressTracker?.onInferenceDispatch, onInferenceSample: progressTracker?.onInferenceSample }),
        options.signal,
      );
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      expectedDimension = assertValidEmbeddingBatch(
        batchVectors,
        batch.length,
        'Embedding batch',
        expectedDimension,
      );
      const durationMs = performance.now() - startedAt;
      await options.onBatchComplete?.(durationMs, batch.length);
      if (progressTracker) {
        recordBatchSample(progressTracker, durationMs, batch.length);
        progressTracker.currentFileBatchDurationMs += durationMs;
        progressTracker.currentFileEmbeddedChunks = Math.min(
          progressTracker.currentFileTotalChunks,
          plan.cumulativeChunkCounts[offset + batch.length - 1],
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
      throwIfIndexingCancelled(options.signal, options.isCurrent);
      throwIfPerformanceGuardPaused(options);
      vectors.push(...batchVectors);
      offset += batch.length;
      if (offset < inputs.length) {
        const yieldMs = options.getIndexingYieldMs?.() ?? options.indexingYieldMs ?? 0;
        await pauseAfterBatch(yieldMs, options.signal);
      }
    }

    return plan.outputIndices.map((index) => vectors[index]);
  }

  private async withIndexBatch<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.bm25Index) {
      return this.vectorStore.withBatch(operation);
    }
    return this.vectorStore.withBatch(() => this.bm25Index!.withBatch(operation));
  }

}

function projectRecoveryPartialRecord(record: FileIndexRecord | undefined): RustRagRecoveryPartialRecord | undefined {
  if (!record) return undefined;
  return { mtime: record.sourceMtime, size: record.sourceSize, contentHash: record.contentHash,
    sourceMetadataHash: record.sourceMetadataHash, partial: record.sourceMetadata?.completeness?.status === 'partial',
    hasCompleteMetadata: record.hasCompleteMetadata === true };
}

function isCurrentFileIndexRecord(
  record: FileIndexRecord,
  contentHash: string,
  ragConfig: RAGConfig,
): boolean {
  return (
    record.hasCompleteMetadata === true &&
    record.sourceMtime !== undefined &&
    record.sourceSize !== undefined &&
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

/** 새 파일 이벤트를 등록하여 자동 인덱싱합니다. */
export function registerCreateEvent(
  vault: Vault,
  indexer: { indexFile(file: TFile): Promise<unknown> },
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (file: TFile) => void,
): () => void {
  const ref = vault.on('create', async (file) => {
    if (!isTFileLike(file)) return;
    const target = file;
    if (!(await shouldIndexRagFile(vault, target, excludePaths, excludeExts))) return;
    await indexer.indexFile(target);
    onComplete?.(target);
  });
  return () => vault.offref(ref);
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
    if (!(await shouldIndexRagFile(vault, f, excludePaths, excludeExts))) {
      await indexer.removeByFilePath?.(f.path);
      onComplete?.(f);
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
    await vectorStore.removeByFilePath(filePath);
    onComplete?.(filePath);
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
      await vectorStore.removeByFilePath(oldPath);
      changed = true;
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
