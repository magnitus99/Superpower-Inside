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

/** 실행 중인 인덱싱 상태를 1초마다 다시 알려 경과 시간 표시를 갱신합니다. */
const STATUS_HEARTBEAT_MS = 1000;

export type RagIndexingRequestReason = 'modify' | 'rename' | 'manual' | 'auto';
export type RagIndexingPhase = 'idle' | 'preparing' | 'file' | 'pending' | 'all' | 'paused';

export interface RagIndexingSchedulerStatus {
  running: boolean;
  phase: RagIndexingPhase;
  startedAt: number | null;
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
  private activeJob: QueueJob | null = null;
  private lastResult: IndexingResult | null = null;
  private progress: RagIndexingSchedulerProgress | null = null;
  private startedAt: number | null = null;
  private preparing = false;
  private statusHeartbeat: number | null = null;

  constructor(operations: SchedulerOperations) {
    this.operations = operations;
    this.dirtySet = new RagDirtySetJournal(operations.maxDirtyFiles);
  }

  getStatus(): RagIndexingSchedulerStatus {
    return {
      running: this.isRunning(),
      phase: this.phase,
      startedAt: this.startedAt,
      queuedFiles:
        this.dirtySet.size +
        this.queue.filter((job) => job.kind === 'file').length +
        (this.parkedJob?.kind === 'file' ? 1 : 0),
      lastResult: this.lastResult,
      progress: this.progress,
    };
  }

  isRunning(): boolean {
    return this.draining || this.parkedJob !== null || this.preparing;
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
    if (this.activeJob?.kind === 'all' || this.queue.some((job) => job.kind === 'all')) {
      return Promise.resolve(this.lastResult ?? createEmptyIndexingResult());
    }
    this.dirtySet.clear();
    this.resolveSupersededIndexJobs();
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'all', resolve, reject });
      this.kick();
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.preparing = false;
    this.abortController?.abort();
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.dirtySet.clear();
    this.clearPauseTimer();
    this.stopStatusHeartbeat();
    this.startedAt = null;
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

  /**
   * 상태 계산·고아 정리·계획 같은 인덱싱 전 사전 단계를 실행 중으로 표시합니다.
   * 실제 작업이 시작되면 drain이 경과 시간을 이어받습니다.
   */
  beginPreparation(): void {
    if (this.isRunning()) return;
    this.cancelled = false;
    this.preparing = true;
    this.phase = 'preparing';
    this.startedAt = performance.now();
    this.startStatusHeartbeat();
    this.emitStatus();
  }

  /** 사전 단계 표시를 끝내고 실제 작업이 없으면 유휴 상태로 돌립니다. */
  endPreparation(): void {
    if (!this.preparing) return;
    this.preparing = false;
    if (!this.draining && !this.parkedJob) {
      this.stopStatusHeartbeat();
      this.phase = 'idle';
      this.startedAt = null;
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
    this.preparing = false;
    this.startedAt = this.startedAt ?? performance.now();
    this.startStatusHeartbeat();
    this.emitStatus();
    try {
      while (!this.cancelled) {
        this.flushPendingFiles();
        const job = this.queue.shift();
        if (!job) break;
        this.activeJob = job;
        let outcome: 'completed' | 'paused' = 'completed';
        try {
          outcome = await this.runJob(job);
        } finally {
          this.activeJob = null;
        }
        if (outcome === 'paused') break;
      }
    } finally {
      this.stopStatusHeartbeat();
      this.draining = false;
      if (!this.parkedJob) this.phase = 'idle';
      this.abortController = null;
      this.activeJob = null;
      this.progress = null;
      this.startedAt = null;
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
        {},
        false,
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
    mergeActive = true,
  ): void {
    if (mergeActive && this.coversPendingRequest(this.activeJob, options)) {
      resolve(this.lastResult ?? createEmptyIndexingResult());
      return;
    }
    if (this.queue.some((job) => job.kind === 'pending' || job.kind === 'all')) {
      resolve(this.lastResult ?? createEmptyIndexingResult());
      return;
    }
    this.queue.push({ kind: 'pending', options, resolve, reject });
  }

  /** 실행 중인 작업이 같은 범위를 처음부터 다시 도는 요청인지 판정합니다. */
  private coversPendingRequest(job: QueueJob | null, options: RagPendingIndexingOptions): boolean {
    if (!job) return false;
    if (job.kind === 'all') return true;
    if (job.kind !== 'pending') return false;
    return !job.options.automaticRecovery || options.automaticRecovery === true;
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

  private startStatusHeartbeat(): void {
    if (this.statusHeartbeat !== null) return;
    this.statusHeartbeat = window.setInterval(() => {
      if (!this.draining && !this.preparing) return;
      // 마지막 progress는 유지하고 시계만 갱신해 경과 시간이 매초 움직이게 합니다.
      if (this.progress) this.progress = { ...this.progress, nowMs: performance.now() };
      this.emitStatus();
    }, STATUS_HEARTBEAT_MS);
  }

  private stopStatusHeartbeat(): void {
    if (this.statusHeartbeat === null) return;
    window.clearInterval(this.statusHeartbeat);
    this.statusHeartbeat = null;
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
