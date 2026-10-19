import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import {
  createPendingWriteRecoveryHost,
  recoverPendingFileWrites,
  type PendingWriteRecoveryHost,
} from './pending-write-recovery';

function file(path: string): TFile {
  return {
    path,
    extension: 'md',
    basename: path.replace(/\.md$/u, ''),
    stat: { ctime: 0, mtime: 1, size: 1 },
  } as TFile;
}

function host(files: ReadonlyMap<string, TFile>, excluded: ReadonlySet<string> = new Set()) {
  const scheduled: string[] = [];
  const removed: string[] = [];
  const recovery: PendingWriteRecoveryHost = {
    getAbstractFileByPath: (path) => files.get(path) ?? null,
    isRagFileExcluded: (path) => Promise.resolve(excluded.has(path)),
    scheduleFile: (value) => scheduled.push(value.path),
    removeFile: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
  };
  return { recovery, scheduled, removed };
}

describe('중단된 파일 쓰기 복구', () => {
  it('현재 포함 파일은 재색인하고 제외·삭제 파일은 색인 원장에서 제거한다', async () => {
    const files = new Map([
      ['Included.md', file('Included.md')],
      ['Excluded.md', file('Excluded.md')],
    ]);
    const fixture = host(files, new Set(['Excluded.md']));

    await recoverPendingFileWrites(
      ['Included.md', 'Excluded.md', 'Missing.md', 'Included.md'],
      fixture.recovery,
    );

    expect(fixture.scheduled).toEqual(['Included.md']);
    expect(fixture.removed).toEqual(['Excluded.md', 'Missing.md']);
  });

  it('제외 판단 실패는 원인을 전달하고 재색인을 시작하지 않는다', async () => {
    const files = new Map([['Included.md', file('Included.md')]]);
    const fixture = host(files);
    fixture.recovery.isRagFileExcluded = () => Promise.reject(new Error('synthetic failure'));

    await expect(recoverPendingFileWrites(['Included.md'], fixture.recovery)).rejects.toThrow(
      'synthetic failure',
    );
    expect(fixture.scheduled).toEqual([]);
  });

  it('생성한 host는 vault 조회를 그대로 위임한다', () => {
    const target = file('Included.md');
    const getAbstractFileByPath = vi.fn((path: string) => (path === target.path ? target : null));
    const recovery = createPendingWriteRecoveryHost(
      {
        getAbstractFileByPath,
        configDir: '.obsidian',
      } as never,
      {} as never,
      {} as never,
      () => undefined,
      () => Promise.resolve(),
    );

    expect(recovery.getAbstractFileByPath(target.path)).toBe(target);
    expect(getAbstractFileByPath).toHaveBeenCalledWith(target.path);
  });
});
