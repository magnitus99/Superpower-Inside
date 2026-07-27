import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { IndexingCancelledError, IndexingPerformancePausedError } from './indexer';
import { RAGIndexingScheduler } from './indexing-scheduler';

describe('RAGIndexingScheduler', () => {
  it('같은 파일의 연속 modify 요청은 마지막 요청 하나만 처리한다', async () => {
    vi.useFakeTimers();
    const indexedPaths: string[] = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 50,
      indexFile: (file) => {
        indexedPaths.push(file.path);
        return Promise.resolve(createResult({ indexed: 1, vectors: 1, documents: [file.path] }));
      },
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.resolve(createResult()),
      reindexAll: () => Promise.resolve(createResult()),
    });

    scheduler.scheduleFile(createFile('note.md', 1), 'modify');
    scheduler.scheduleFile(createFile('note.md', 2), 'modify');
    await vi.advanceTimersByTimeAsync(60);
    await scheduler.waitForIdle();

    expect(indexedPaths).toEqual(['note.md']);
    vi.useRealTimers();
  });

  it('전체 재인덱싱 중 들어온 파일 이벤트는 재인덱싱 완료 후 처리한다', async () => {
    let releaseReindex = (): void => {
      throw new Error('releaseReindex가 초기화되지 않았습니다.');
    };
    const calls: string[] = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: (file) => {
        calls.push(`file:${file.path}`);
        return Promise.resolve(createResult({ indexed: 1, vectors: 1, documents: [file.path] }));
      },
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.resolve(createResult()),
      reindexAll: () =>
        new Promise((resolve) => {
          calls.push('all:start');
          releaseReindex = () => {
            calls.push('all:end');
            resolve(createResult({ indexed: 10, vectors: 20 }));
          };
        }),
    });

    const reindexPromise = scheduler.reindexAll();
    await Promise.resolve();
    scheduler.scheduleFile(createFile('changed.md'), 'modify');
    releaseReindex();
    await reindexPromise;
    await scheduler.waitForIdle();

    expect(calls).toEqual(['all:start', 'all:end', 'file:changed.md']);
  });

  it('취소하면 남은 큐 작업을 실행하지 않는다', async () => {
    let releaseFirst = (): void => {
      throw new Error('releaseFirst가 초기화되지 않았습니다.');
    };
    const indexedPaths: string[] = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: (file) =>
        new Promise((resolve) => {
          indexedPaths.push(file.path);
          releaseFirst = () =>
            resolve(createResult({ indexed: 1, vectors: 1, documents: [file.path] }));
        }),
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.resolve(createResult()),
      reindexAll: () => Promise.resolve(createResult()),
    });

    scheduler.scheduleFile(createFile('a.md'), 'modify');
    scheduler.scheduleFile(createFile('b.md'), 'modify');
    await Promise.resolve();
    scheduler.cancel();
    releaseFirst();
    await scheduler.waitForIdle();

    expect(indexedPaths).toEqual(['a.md']);
  });

  it('dirty set 상한을 넘으면 파일별 큐 대신 pending scan으로 backpressure를 건다', async () => {
    let releaseFirst = (): void => {
      throw new Error('releaseFirst가 초기화되지 않았습니다.');
    };
    const calls: string[] = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      maxDirtyFiles: 2,
      indexFile: (file) =>
        new Promise((resolve) => {
          calls.push(`file:${file.path}`);
          releaseFirst = () =>
            resolve(createResult({ indexed: 1, vectors: 1, documents: [file.path] }));
        }),
      removeFile: () => Promise.resolve(0),
      indexPending: () => {
        calls.push('pending');
        return Promise.resolve(createResult({ indexed: 3, vectors: 3 }));
      },
      reindexAll: () => Promise.resolve(createResult()),
    });

    scheduler.scheduleFile(createFile('a.md'), 'modify');
    await Promise.resolve();
    scheduler.scheduleFile(createFile('b.md'), 'modify');
    scheduler.scheduleFile(createFile('c.md'), 'modify');
    scheduler.scheduleFile(createFile('d.md'), 'modify');
    expect(scheduler.getStatus().queuedFiles).toBeLessThanOrEqual(2);

    releaseFirst();
    await scheduler.waitForIdle();

    expect(calls).toEqual(['file:a.md', 'pending']);
  });

  it('emits RAG indexing progress with Rust-planned ETA and clears it after idle', async () => {
    const statuses: ReturnType<RAGIndexingScheduler['getStatus']>[] = [];
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: (options) => {
        options.onProgress?.({
          event: 'batch-complete',
          startedAtMs: 0,
          nowMs: 10000,
          totalFiles: 10,
          completedFiles: 3,
          currentFilePath: 'c.md',
          currentFileIndex: 2,
          currentFileTotalChunks: 1,
          currentFileEmbeddedChunks: 0,
          totalEstimatedChunks: 10,
          completedEstimatedChunks: 3,
          currentFileEstimatedChunks: 1,
          totalPlannedChunks: 0,
          completedPlannedChunks: 0,
          currentFilePlannedChunks: 0,
          planningComplete: false,
          indexed: 2,
          vectors: 20,
          skipped: 0,
          completedBatchDurationsMs: [500],
          completedBatchChunkCounts: [1],
          completedFileDurationsMs: [2000, 3000, 2500],
          completedFileChunkCounts: [1, 1, 1],
          completedFileEstimatedChunkCounts: [1, 1, 1],
          completedFileActualChunkCounts: [1, 1, 1],
          completedFileOverheadDurationsMs: [],
          historicalMsPerChunk: null,
          historicalChunkEstimateRatio: null,
          historicalVariance: null,
        });
        return Promise.resolve(createResult({ indexed: 2, vectors: 20 }));
      },
      reindexAll: () => Promise.resolve(createResult()),
      onStatusChange: (status) => {
        statuses.push(status);
      },
    });

    await scheduler.indexPending();
    await scheduler.waitForIdle();

    const progressStatus = statuses.find(
      (status) => status.running && status.phase === 'pending' && status.progress !== null,
    );
    expect(progressStatus?.progress?.currentFilePath).toBe('c.md');
    expect(progressStatus?.progress?.eta?.remainingMs).toBe(17500);
    expect(progressStatus?.progress?.eta?.estimatedCompletionMs).toBe(27500);
    expect(progressStatus?.progress?.eta?.confidence).toBe('medium');
    expect(progressStatus?.progress?.eta?.basis).toBe('calibrated-estimate');
    expect(scheduler.getStatus().progress).toBeNull();
  });

  it('returns to idle when a pending indexing job rejects', async () => {
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.reject(new Error('embedding request timed out')),
      reindexAll: () => Promise.resolve(createResult()),
    });

    await expect(scheduler.indexPending()).rejects.toThrow('embedding request timed out');
    await scheduler.waitForIdle();

    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({
        running: false,
        phase: 'idle',
      }),
    );
  });

  it('forwards the automatic recovery mode only to the queued pending job', async () => {
    const pending = vi.fn(() => Promise.resolve(createResult()));
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: pending,
      reindexAll: () => Promise.resolve(createResult()),
    });

    await scheduler.indexPending({ automaticRecovery: true });

    expect(pending).toHaveBeenCalledWith(expect.objectContaining({ automaticRecovery: true }));
  });

  it('parks a performance-paused job and resumes the same promise after cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    let guardMode: 'paused' | 'throttled' = 'paused';
    let callCount = 0;
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: () => {
        callCount += 1;
        return callCount === 1
          ? Promise.reject(new IndexingPerformancePausedError())
          : Promise.resolve(createResult({ indexed: 1 }));
      },
      reindexAll: () => Promise.resolve(createResult()),
      getPerformanceGuardState: () => ({
        mode: guardMode,
        currentBatchSize: 1,
        currentYieldMs: 500,
        reason: 'paused',
        pauseUntilMs: guardMode === 'paused' ? Date.now() + 1_000 : null,
        remainingPauseMs: guardMode === 'paused' ? 1_000 : null,
        lastSlowReason: 'event loop',
      }),
      resumePerformanceGuard: () => {
        guardMode = 'throttled';
        return {
          mode: guardMode,
          currentBatchSize: 1,
          currentYieldMs: 500,
          reason: 'resumed',
          pauseUntilMs: null,
          remainingPauseMs: null,
          lastSlowReason: 'event loop',
        };
      },
    });

    const resultPromise = scheduler.indexPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({ running: true, phase: 'paused' }),
    );
    let idleResolved = false;
    void scheduler.waitForIdle().then(() => {
      idleResolved = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(idleResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ indexed: 1 }));
    await scheduler.waitForIdle();
    expect(callCount).toBe(2);
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({ running: false, phase: 'idle' }),
    );
    vi.useRealTimers();
  });

  it('manual resume wakes parked work without cancelling or resetting the queue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    let callCount = 0;
    const resumePerformanceGuard = vi.fn(() => ({
      mode: 'throttled' as const,
      currentBatchSize: 1,
      currentYieldMs: 500,
      reason: 'resumed',
      pauseUntilMs: null,
      remainingPauseMs: null,
      lastSlowReason: 'event loop',
    }));
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: () => {
        callCount += 1;
        return callCount === 1
          ? Promise.reject(new IndexingPerformancePausedError())
          : Promise.resolve(createResult({ indexed: 1 }));
      },
      reindexAll: () => Promise.resolve(createResult()),
      getPerformanceGuardState: () => ({
        mode: 'paused',
        currentBatchSize: 1,
        currentYieldMs: 500,
        reason: 'paused',
        pauseUntilMs: Date.now() + 30_000,
        remainingPauseMs: 30_000,
        lastSlowReason: 'event loop',
      }),
      resumePerformanceGuard,
    });

    const resultPromise = scheduler.indexPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.resumeNow()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ indexed: 1 }));
    expect(resumePerformanceGuard).toHaveBeenCalledWith(true);
    expect(callCount).toBe(2);
    vi.useRealTimers();
  });

  it('cancellation rejects parked work and invalidates its wake timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const resumePerformanceGuard = vi.fn();
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.reject(new IndexingPerformancePausedError()),
      reindexAll: () => Promise.resolve(createResult()),
      getPerformanceGuardState: () => ({
        mode: 'paused',
        currentBatchSize: 1,
        currentYieldMs: 500,
        reason: 'paused',
        pauseUntilMs: Date.now() + 30_000,
        remainingPauseMs: 30_000,
        lastSlowReason: 'event loop',
      }),
      resumePerformanceGuard,
    });

    const resultPromise = scheduler.indexPending();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.cancel();

    await expect(resultPromise).rejects.toBeInstanceOf(IndexingCancelledError);
    await scheduler.waitForIdle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resumePerformanceGuard).not.toHaveBeenCalled();
    expect(scheduler.isRunning()).toBe(false);
    vi.useRealTimers();
  });

  it('keeps work parked when the performance policy cannot confirm a resume', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const resumePerformanceGuard = vi.fn(() => null);
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () => Promise.resolve(createResult()),
      removeFile: () => Promise.resolve(0),
      indexPending: () => Promise.reject(new IndexingPerformancePausedError()),
      reindexAll: () => Promise.resolve(createResult()),
      getPerformanceGuardState: () => ({
        mode: 'paused',
        currentBatchSize: 1,
        currentYieldMs: 500,
        reason: 'paused',
        pauseUntilMs: Date.now(),
        remainingPauseMs: 0,
        lastSlowReason: 'event loop',
      }),
      resumePerformanceGuard,
    });

    const resultPromise = scheduler.indexPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.resumeNow()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumePerformanceGuard).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toEqual(
      expect.objectContaining({ running: true, phase: 'paused' }),
    );

    scheduler.cancel();
    await expect(resultPromise).rejects.toBeInstanceOf(IndexingCancelledError);
    vi.useRealTimers();
  });

  it('settles queued public jobs on cancel and accepts a fresh generation', async () => {
    let releaseActive = (): void => undefined;
    const scheduler = new RAGIndexingScheduler({
      debounceMs: 0,
      indexFile: () =>
        new Promise((resolve) => {
          releaseActive = () => resolve(createResult({ indexed: 1 }));
        }),
      removeFile: () => Promise.resolve(1),
      indexPending: () => Promise.resolve(createResult({ indexed: 1 })),
      reindexAll: () => Promise.resolve(createResult({ indexed: 1 })),
    });

    scheduler.scheduleFile(createFile('active.md'), 'modify');
    await Promise.resolve();
    const deletePromise = scheduler.deleteFile('deleted.md');
    const pendingPromise = scheduler.indexPending();
    scheduler.cancel();

    await expect(deletePromise).rejects.toBeInstanceOf(IndexingCancelledError);
    await expect(pendingPromise).rejects.toBeInstanceOf(IndexingCancelledError);
    releaseActive();
    await scheduler.waitForIdle();

    await expect(scheduler.indexPending()).resolves.toEqual(expect.objectContaining({ indexed: 1 }));
  });
});

function createFile(path: string, mtime = 1): TFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.replace(/\.[^.]+$/, ''),
    extension: path.split('.').pop() ?? '',
    stat: { ctime: mtime, mtime, size: 10 },
  } as unknown as TFile;
}

function createResult(
  overrides: Partial<{
    indexed: number;
    vectors: number;
    skipped: number;
    documents: string[];
  }> = {},
) {
  return {
    indexed: overrides.indexed ?? 0,
    vectors: overrides.vectors ?? 0,
    skipped: overrides.skipped ?? 0,
    documents: overrides.documents ?? [],
    durationMs: 0,
  };
}
