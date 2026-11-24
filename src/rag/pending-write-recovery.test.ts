import { describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import type { RAGConfig, ChatConfig } from '../settings';
import { getRagIndexingManifest } from '../utils/vault';
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

  it('동일 manifest의 unreadable 원문은 정책 제외나 orphan으로 삭제하지 않는다', async () => {
    const target = file('Unreadable.md');
    const remove = vi.fn(() => Promise.resolve());
    const schedule = vi.fn();
    const recovery = createPendingWriteRecoveryHost({ getAbstractFileByPath: () => target } as never, {} as never, {} as never, schedule, remove, { candidates: [], failures: [{ file: target, reason: 'frontmatter-unreadable' }], policyExcluded: [], unsupported: [], totalVaultFiles: 1 });
    await expect(recoverPendingFileWrites([target.path], recovery)).rejects.toThrow('frontmatter-unreadable');
    expect(remove).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('metadata-only recovery admission은 다른 partial 원문을 전역 probe하지 않고 실제 YAML·읽기 실패 검사는 indexer에 남긴다', async () => {
    const target = Object.assign(file('Synthetic/actionable.md'), { name: 'actionable.md' });
    const readBinary = vi.fn(() => Promise.reject(new Error('synthetic unreadable source')));
    const vault = { getFiles: () => [target], getAbstractFileByPath: () => target, configDir: '.obsidian', readBinary } as unknown as Vault;
    const rag = { excludePaths: [], excludeExts: [], excludeChatFolder: false } as unknown as RAGConfig;
    const chat = { saveFolder: '' } as ChatConfig;
    const inventory = getRagIndexingManifest(vault, rag, chat);
    const schedule = vi.fn();
    const remove = vi.fn(() => Promise.resolve());
    const recovery = createPendingWriteRecoveryHost(vault, rag, chat, schedule, remove, inventory);
    await recoverPendingFileWrites([target.path], recovery);
    expect(readBinary).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(target);
    expect(remove).not.toHaveBeenCalled();
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
