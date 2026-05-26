import type { TFile } from 'obsidian';
import type { IndexingOptions, IndexingResult } from './indexer';

export type RagIndexingRequestReason = 'modify' | 'rename' | 'manual' | 'auto';
export type RagIndexingPhase = 'idle' | 'file' | 'pending' | 'all';

export interface RagIndexingSchedulerStatus {
  running: boolean;
  phase: RagIndexingPhase;
  queuedFiles: number;
  lastResult: IndexingResult | null;
}

interface SchedulerOperations {
  debounceMs: number;
  indexFile: (file: TFile, options: IndexingOptions) => Promise<IndexingResult>;
  removeFile: (filePath: string) => Promise<number>;
  indexPending: (options: IndexingOptions) => Promise<IndexingResult>;
  reindexAll: (options: IndexingOptions) => Promise<IndexingResult>;
  createIndexingOptions?: (signal: AbortSignal) => IndexingOptions;
  onStatusChange?: (status: RagIndexingSchedulerStatus) => void;
}

type QueueJob =
  | { kind: 'file'; file: TFile; resolve: (result: IndexingResult) => void; reject: (error: unknown) => void }
  | { kind: 'delete'; filePath: string; resolve: (removed: number) => void; reject: (error: unknown) => void }
  | { kind: 'pending'; resolve: (result: IndexingResult) => void; reject: (error: unknown) => void }
  | { kind: 'all'; resolve: (result: IndexingResult) => void; reject: (error: unknown) => void };

export class RAGIndexingScheduler {
  private readonly operations: SchedulerOperations;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingFiles = new Map<string, TFile>();
  private queue: QueueJob[] = [];
  private running = false;
  private phase: RagIndexingPhase = 'idle';
  private idleResolvers: Array<() => void> = [];
  private abortController: AbortController | null = null;
  private cancelled = false;
  private lastResult: IndexingResult | null = null;

  constructor(operations: SchedulerOperations) {
    this.operations = operations;
  }

  getStatus(): RagIndexingSchedulerStatus {
    return {
      running: this.running,
      phase: this.phase,
      queuedFiles: this.pendingFiles.size + this.queue.filter((job) => job.kind === 'file').length,
      lastResult: this.lastResult,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  scheduleFile(file: TFile, _reason: RagIndexingRequestReason): void {
    this.cancelled = false;
    const existingTimer = this.debounceTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (this.operations.debounceMs <= 0) {
      this.enqueueFile(file);
      return;
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(file.path);
      this.enqueueFile(file);
    }, this.operations.debounceMs);
    this.debounceTimers.set(file.path, timer);
  }

  deleteFile(filePath: string): Promise<number> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'delete', filePath, resolve, reject });
      this.kick();
    });
  }

  indexPending(): Promise<IndexingResult> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'pending', resolve, reject });
      this.kick();
    });
  }

  reindexAll(): Promise<IndexingResult> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: 'all', resolve, reject });
      this.kick();
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingFiles.clear();
    this.queue = this.queue.filter((job) => job.kind !== 'file');
    this.emitStatus();
  }

  async waitForIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0 && this.pendingFiles.size === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private enqueueFile(file: TFile): void {
    this.pendingFiles.set(file.path, file);
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
      this.emitStatus();
      const resolvers = this.idleResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  private flushPendingFiles(): void {
    if (this.pendingFiles.size === 0) return;
    const files = [...this.pendingFiles.values()];
    this.pendingFiles.clear();
    for (const file of files) {
      this.queue.push({
        kind: 'file',
        file,
        resolve: () => undefined,
        reject: () => undefined,
      });
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    this.abortController = new AbortController();
    const options = this.operations.createIndexingOptions?.(this.abortController.signal) ?? {
      signal: this.abortController.signal,
    };
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
}
