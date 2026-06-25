import type { TFile } from 'obsidian';
import type { IndexingOptions, IndexingResult, RagIndexingProgressSnapshot } from './indexer';
import { planRagIndexingEtaRust, type RustRagIndexingEtaPlan } from './rust-core';

export type RagIndexingRequestReason = 'modify' | 'rename' | 'manual' | 'auto';
export type RagIndexingPhase = 'idle' | 'file' | 'pending' | 'all';

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

interface SchedulerOperations {
  debounceMs: number;
  maxDirtyFiles?: number;
  indexFile: (file: TFile, options: IndexingOptions) => Promise<IndexingResult>;
  removeFile: (filePath: string) => Promise<number>;
  indexPending: (options: IndexingOptions) => Promise<IndexingResult>;
  reindexAll: (options: IndexingOptions) => Promise<IndexingResult>;
  createIndexingOptions?: (signal: AbortSignal) => IndexingOptions;
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
  | { kind: 'pending'; resolve: (result: IndexingResult) => void; reject: (error: unknown) => void }
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
  private running = false;
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
      running: this.running,
      phase: this.phase,
      queuedFiles: this.dirtySet.size + this.queue.filter((job) => job.kind === 'file').length,
      lastResult: this.lastResult,
      progress: this.progress,
    };
  }

  isRunning(): boolean {
    return this.running;
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
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'delete', filePath, resolve, reject });
      this.kick();
    });
  }

  indexPending(): Promise<IndexingResult> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.enqueuePending(resolve, reject);
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
    this.queue = this.queue.filter((job) => job.kind !== 'file');
    this.progress = null;
    this.emitStatus();
  }

  async waitForIdle(): Promise<void> {
    if (
      !this.running &&
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
    if (!this.running) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emitStatus();
    try {
      while (!this.cancelled) {
        this.flushPendingFiles();
        const job = this.queue.shift();
        if (!job) break;
        await this.runJob(job);
      }
    } finally {
      this.running = false;
      this.phase = 'idle';
      this.abortController = null;
      this.progress = null;
      this.emitStatus();
      const resolvers = this.idleResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
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
  ): void {
    if (this.queue.some((job) => job.kind === 'pending' || job.kind === 'all')) {
      resolve(this.lastResult ?? createEmptyIndexingResult());
      return;
    }
    this.queue.push({ kind: 'pending', resolve, reject });
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

  private async runJob(job: QueueJob): Promise<void> {
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
        return;
      }
      if (job.kind === 'delete') {
        this.phase = 'file';
        this.emitStatus();
        const removed = await this.operations.removeFile(job.filePath);
        job.resolve(removed);
        return;
      }
      if (job.kind === 'pending') {
        this.phase = 'pending';
        this.emitStatus();
        const result = await this.operations.indexPending(options);
        this.lastResult = result;
        job.resolve(result);
        return;
      }
      this.phase = 'all';
      this.emitStatus();
      const result = await this.operations.reindexAll(options);
      this.lastResult = result;
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    }
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
