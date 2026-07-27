import type { TFile } from 'obsidian';
import {
  IndexingCancelledError,
  IndexingPerformancePausedError,
  type IndexingOptions,
  type IndexingResult,
  type RagIndexingProgressSnapshot,
} from './indexer';
import type { PerformanceGuardState } from './performance-guard';
import { planRagIndexingEtaRust, type RustRagIndexingEtaPlan } from './rust-core';

export type RagIndexingRequestReason = 'modify' | 'rename' | 'manual' | 'auto';
export type RagIndexingPhase = 'idle' | 'file' | 'pending' | 'all' | 'paused';

export interface RagIndexingSchedulerStatus {
  running: boolean;
  phase: RagIndexingPhase;
  queuedFiles: number;
  lastResult: IndexingResult | null;
  progress: RagIndexingSchedulerProgress | null;
}

export interface RagIndexingSchedulerProgress extends RagIndexingProgressSnapshot {
  eta: RustRagIndexingEtaPlan | null;
}

export interface RagPendingIndexingOptions {
  automaticRecovery?: boolean;
}

interface SchedulerOperations {
  debounceMs: number;
  maxDirtyFiles?: number;
  indexFile: (file: TFile, options: IndexingOptions) => Promise<IndexingResult>;
  removeFile: (filePath: string) => Promise<number>;
  indexPending: (options: IndexingOptions) => Promise<IndexingResult>;
  reindexAll: (options: IndexingOptions) => Promise<IndexingResult>;
  createIndexingOptions?: (signal: AbortSignal) => IndexingOptions;
  getPerformanceGuardState?: () => PerformanceGuardState | null;
  resumePerformanceGuard?: (force: boolean) => PerformanceGuardState | null;
  onStatusChange?: (status: RagIndexingSchedulerStatus) => void;
}

type QueueJob =
  | {
      kind: 'file';
      file: TFile;
      resolve: (result: IndexingResult) => void;
      reject: (error: unknown) => void;
    }
  | {
      kind: 'delete';
      filePath: string;
      resolve: (removed: number) => void;
      reject: (error: unknown) => void;
    }
  | {
      kind: 'pending';
      options: RagPendingIndexingOptions;
      resolve: (result: IndexingResult) => void;
      reject: (error: unknown) => void;
    }
  | { kind: 'all'; resolve: (result: IndexingResult) => void; reject: (error: unknown) => void };

export interface RagDirtySetJournalDrain {
  files: TFile[];
  overflowed: boolean;
}

export class RagDirtySetJournal {
  private readonly maxDirtyFiles: number;
  private files = new Map<string, TFile>();
  private overflowed = false;

  constructor(maxDirtyFiles = 512) {
    this.maxDirtyFiles = Math.max(1, Math.floor(maxDirtyFiles));
  }

  get size(): number {
    return this.files.size;
  }

  get hasOverflowed(): boolean {
    return this.overflowed;
  }

  add(file: TFile): void {
    if (this.overflowed) return;
    if (!this.files.has(file.path) && this.files.size >= this.maxDirtyFiles) {
      this.files.clear();
      this.overflowed = true;
      return;
    }
    this.files.set(file.path, file);
  }

  delete(filePath: string): void {
    this.files.delete(filePath);
  }

  clear(): void {
    this.files.clear();
    this.overflowed = false;
  }

  drain(): RagDirtySetJournalDrain {
    const snapshot = {
      files: [...this.files.values()],
      overflowed: this.overflowed,
    };
    this.clear();
    return snapshot;
  }
}

export class RAGIndexingScheduler {
  private readonly operations: SchedulerOperations;
  private debounceTimers = new Map<string, number>();
  private readonly dirtySet: RagDirtySetJournal;
  private queue: QueueJob[] = [];
  private draining = false;
  private parkedJob: QueueJob | null = null;
  private pauseTimer: number | null = null;
  private pauseTimerGeneration = 0;
  private phase: RagIndexingPhase = 'idle';
  private idleResolvers: Array<() => void> = [];
  private abortController: AbortController | null = null;
  private cancelled = false;
  private lastResult: IndexingResult | null = null;
  private progress: RagIndexingSchedulerProgress | null = null;

  constructor(operations: SchedulerOperations) {
    this.operations = operations;
    this.dirtySet = new RagDirtySetJournal(operations.maxDirtyFiles);
  }

  getStatus(): RagIndexingSchedulerStatus {
    return {
      running: this.isRunning(),
      phase: this.phase,
      queuedFiles:
        this.dirtySet.size +
        this.queue.filter((job) => job.kind === 'file').length +
        (this.parkedJob?.kind === 'file' ? 1 : 0),
      lastResult: this.lastResult,
      progress: this.progress,
    };
  }

  isRunning(): boolean {
    return this.draining || this.parkedJob !== null;
  }

  scheduleFile(file: TFile, _reason: RagIndexingRequestReason): void {
    this.cancelled = false;
    const existingTimer = this.debounceTimers.get(file.path);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    if (this.operations.debounceMs <= 0) {
      this.enqueueFile(file);
      return;
    }

    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(file.path);
      this.enqueueFile(file);
    }, this.operations.debounceMs);
    this.debounceTimers.set(file.path, timer);
  }

  deleteFile(filePath: string): Promise<number> {
    this.cancelled = false;
    this.dirtySet.delete(filePath);
    this.resolveMatchingFileJobs(filePath);
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'delete', filePath, resolve, reject });
      this.kick();
    });
  }

  indexPending(options: RagPendingIndexingOptions = {}): Promise<IndexingResult> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.enqueuePending(resolve, reject, options);
      this.kick();
    });
  }

  reindexAll(): Promise<IndexingResult> {
    this.cancelled = false;
    this.dirtySet.clear();
    this.resolveSupersededIndexJobs();
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'all', resolve, reject });
      this.kick();
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.dirtySet.clear();
    this.clearPauseTimer();
    const cancellation = new IndexingCancelledError();
    if (this.parkedJob) {
      this.parkedJob.reject(cancellation);
      this.parkedJob = null;
    }
    for (const job of this.queue) {
      job.reject(cancellation);
    }
    this.queue = [];
    this.progress = null;
    if (!this.draining) {
      this.phase = 'idle';
      this.resolveIdleIfReady();
    }
    this.emitStatus();
  }

  resumeNow(): boolean {
    if (!this.parkedJob) return false;
    let state: PerformanceGuardState | null = null;
    try {
      state = this.operations.resumePerformanceGuard?.(true) ?? null;
    } catch {
      return false;
    }
    if (!state || state.mode === 'paused') {
      this.armPauseTimer(state);
      this.emitStatus();
      return false;
    }
    this.wakeParkedJob();
    return true;
  }

  async waitForIdle(): Promise<void> {
    if (
      !this.draining &&
      !this.parkedJob &&
      this.queue.length === 0 &&
      this.dirtySet.size === 0 &&
      !this.dirtySet.hasOverflowed
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private enqueueFile(file: TFile): void {
    this.dirtySet.add(file);
    this.kick();
  }

  private kick(): void {
    this.emitStatus();
    if (!this.draining && !this.parkedJob) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || this.parkedJob) return;
    this.draining = true;
    this.emitStatus();
    try {
      while (!this.cancelled) {
        this.flushPendingFiles();
        const job = this.queue.shift();
        if (!job) break;
        if ((await this.runJob(job)) === 'paused') break;
      }
    } finally {
      this.draining = false;
      if (!this.parkedJob) this.phase = 'idle';
      this.abortController = null;
      this.progress = null;
      this.emitStatus();
      this.resolveIdleIfReady();
      if (!this.cancelled && !this.parkedJob && (this.queue.length > 0 || this.dirtySet.size > 0)) {
        this.kick();
      }
    }
  }

  private flushPendingFiles(): void {
    if (this.dirtySet.size === 0 && !this.dirtySet.hasOverflowed) return;
    const { files, overflowed } = this.dirtySet.drain();
    if (overflowed) {
      this.enqueuePending(
        () => undefined,
        () => undefined,
      );
      return;
    }
    for (const file of files) {
      this.queue.push({
        kind: 'file',
        file,
        resolve: () => undefined,
        reject: () => undefined,
      });
    }
  }

  private enqueuePending(
    resolve: (result: IndexingResult) => void,
    reject: (error: unknown) => void,
    options: RagPendingIndexingOptions = {},
  ): void {
    if (this.queue.some((job) => job.kind === 'pending' || job.kind === 'all')) {
      resolve(this.lastResult ?? createEmptyIndexingResult());
      return;
    }
    this.queue.push({ kind: 'pending', options, resolve, reject });
  }

  private resolveSupersededIndexJobs(): void {
    const remaining: QueueJob[] = [];
    for (const job of this.queue) {
      if (job.kind === 'file') {
        job.resolve(createEmptyIndexingResult());
        continue;
      }
      if (job.kind === 'pending') {
        job.resolve(this.lastResult ?? createEmptyIndexingResult());
        continue;
      }
      remaining.push(job);
    }
    this.queue = remaining;
  }

  private async runJob(job: QueueJob): Promise<'completed' | 'paused'> {
    this.abortController = new AbortController();
    const baseOptions = this.operations.createIndexingOptions?.(this.abortController.signal) ?? {
      signal: this.abortController.signal,
    };
    const options: IndexingOptions = {
      ...baseOptions,
      onProgress: (progress) => {
        baseOptions.onProgress?.(progress);
        this.handleProgress(progress);
      },
    };
    this.progress = null;
    try {
      if (job.kind === 'file') {
        this.phase = 'file';
        this.emitStatus();
        const result = await this.operations.indexFile(job.file, options);
        this.lastResult = result;
        job.resolve(result);
        return 'completed';
      }
      if (job.kind === 'delete') {
        this.phase = 'file';
        this.emitStatus();
        const removed = await this.operations.removeFile(job.filePath);
        job.resolve(removed);
        return 'completed';
      }
      if (job.kind === 'pending') {
        this.phase = 'pending';
        this.emitStatus();
        const result = await this.operations.indexPending({
          ...options,
          automaticRecovery: job.options.automaticRecovery,
        });
        this.lastResult = result;
        job.resolve(result);
        return 'completed';
      }
      this.phase = 'all';
      this.emitStatus();
      const result = await this.operations.reindexAll(options);
      this.lastResult = result;
      job.resolve(result);
      return 'completed';
    } catch (error) {
      if (error instanceof IndexingPerformancePausedError && !this.abortController.signal.aborted) {
        this.parkedJob = job;
        this.phase = 'paused';
        this.progress = null;
        let state: PerformanceGuardState | null = null;
        try {
          state = this.operations.getPerformanceGuardState?.() ?? null;
        } catch {
          state = null;
        }
        if (state && state.mode !== 'paused') {
          this.wakeParkedJob();
        } else {
          this.armPauseTimer(state);
        }
        this.emitStatus();
        return 'paused';
      }
      job.reject(error);
      return 'completed';
    }
  }

  private armPauseTimer(state: PerformanceGuardState | null): void {
    this.clearPauseTimer();
    if (!this.parkedJob || state?.mode !== 'paused' || state.pauseUntilMs === null) return;
    const delayMs = state.pauseUntilMs - Date.now();
    if (delayMs <= 0) return;
    const generation = this.pauseTimerGeneration;
    this.pauseTimer = window.setTimeout(() => {
      if (generation !== this.pauseTimerGeneration || !this.parkedJob) return;
      this.pauseTimer = null;
      let resumed: PerformanceGuardState | null = null;
      try {
        resumed = this.operations.resumePerformanceGuard?.(false) ?? null;
      } catch {
        return;
      }
      if (!resumed || resumed.mode === 'paused') {
        this.armPauseTimer(resumed);
        return;
      }
      this.wakeParkedJob();
    }, delayMs);
  }

  private clearPauseTimer(): void {
    this.pauseTimerGeneration += 1;
    if (this.pauseTimer !== null) {
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private wakeParkedJob(): void {
    const job = this.parkedJob;
    if (!job) return;
    this.clearPauseTimer();
    this.parkedJob = null;
    this.phase = 'idle';
    this.queue.unshift(job);
    this.cancelled = false;
    this.kick();
  }

  private resolveMatchingFileJobs(filePath: string): void {
    if (this.parkedJob?.kind === 'file' && this.parkedJob.file.path === filePath) {
      this.parkedJob.resolve(createEmptyIndexingResult());
      this.parkedJob = null;
      this.clearPauseTimer();
      this.phase = 'idle';
    }
    const remaining: QueueJob[] = [];
    for (const job of this.queue) {
      if (job.kind === 'file' && job.file.path === filePath) {
        job.resolve(createEmptyIndexingResult());
      } else {
        remaining.push(job);
      }
    }
    this.queue = remaining;
  }

  private resolveIdleIfReady(): void {
    if (
      this.draining ||
      this.parkedJob ||
      this.queue.length > 0 ||
      this.dirtySet.size > 0 ||
      this.dirtySet.hasOverflowed
    ) {
      return;
    }
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }

  private emitStatus(): void {
    this.operations.onStatusChange?.(this.getStatus());
  }

  private handleProgress(progress: RagIndexingProgressSnapshot): void {
    this.progress = {
      ...progress,
      eta: planRagIndexingEtaRust({
        nowMs: progress.nowMs,
        startedAtMs: progress.startedAtMs,
        totalFiles: progress.totalFiles,
        completedFiles: progress.completedFiles,
        currentFileTotalChunks: progress.currentFileTotalChunks,
        currentFileEmbeddedChunks: progress.currentFileEmbeddedChunks,
        totalEstimatedChunks: progress.totalEstimatedChunks,
        completedEstimatedChunks: progress.completedEstimatedChunks,
        currentFileEstimatedChunks: progress.currentFileEstimatedChunks,
        totalPlannedChunks: progress.totalPlannedChunks,
        completedPlannedChunks: progress.completedPlannedChunks,
        planningComplete: progress.planningComplete,
        completedBatchDurationsMs: progress.completedBatchDurationsMs,
        completedBatchChunkCounts: progress.completedBatchChunkCounts,
        completedFileDurationsMs: progress.completedFileDurationsMs,
        completedFileChunkCounts: progress.completedFileChunkCounts,
        completedFileEstimatedChunkCounts: progress.completedFileEstimatedChunkCounts,
        completedFileActualChunkCounts: progress.completedFileActualChunkCounts,
        completedFileOverheadDurationsMs: progress.completedFileOverheadDurationsMs,
        historicalMsPerChunk: progress.historicalMsPerChunk,
        historicalChunkEstimateRatio: progress.historicalChunkEstimateRatio,
        historicalVariance: progress.historicalVariance,
      }),
    };
    this.emitStatus();
  }
}

function createEmptyIndexingResult(): IndexingResult {
  return {
    indexed: 0,
    vectors: 0,
    skipped: 0,
    documents: [],
    durationMs: 0,
  };
}
