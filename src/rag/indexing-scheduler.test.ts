import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
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
