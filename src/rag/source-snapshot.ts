import type { TAbstractFile, TFile, Vault } from 'obsidian';
import { createContentHash } from './hash';
import { isSourceRevisionCurrentRust, type RustSourceRevision } from './rust-core';

export interface SourceFileSnapshot {
  file: TFile;
  content: string;
  revision: RustSourceRevision;
}

/** 읽는 동안 바뀌거나 이동한 원문을 새 revision의 본문으로 저장하지 않습니다. */
export async function readSourceFileSnapshot(
  vault: Vault,
  file: TFile,
): Promise<SourceFileSnapshot | null> {
  const snapshot: TFile = {
    ...file,
    stat: { ...file.stat },
  };
  const content = await vault.cachedRead(file);
  const current = vault.getAbstractFileByPath(snapshot.path);
  if (!isSourceFile(current)) return null;
  const contentHash = createContentHash(content);
  const revision = {
    filePath: snapshot.path,
    sourceMtime: snapshot.stat.mtime,
    sourceSize: snapshot.stat.size,
    contentHash,
  };
  if (
    !isSourceRevisionCurrentRust(revision, {
      filePath: current.path,
      sourceMtime: current.stat.mtime,
      sourceSize: current.stat.size,
      contentHash,
    })
  )
    return null;
  return { file: snapshot, content, revision };
}

function isSourceFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'stat' in file && 'extension' in file && 'basename' in file;
}
