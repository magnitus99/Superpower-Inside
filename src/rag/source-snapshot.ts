import type { TAbstractFile, TFile, Vault } from 'obsidian';
import { createContentHash } from './hash';
import { isSourceRevisionCurrentRust, type RustSourceRevision } from './rust-core';
import { readSourceText, type SourceTextSegment } from './source-access';

export interface SourceFileSnapshot {
  file: TFile;
  content: string;
  segments: readonly SourceTextSegment[];
  revision: RustSourceRevision;
}

/**
 * 읽는 동안 바뀌거나 이동한 원문을 새 revision의 본문으로 저장하지 않습니다.
 *
 * 압축 문서를 포함한 모든 원문은 `readSourceText`를 통해 같은 추출 본문을 사용합니다.
 */
export async function readSourceFileSnapshot(
  vault: Vault,
  file: TFile,
): Promise<SourceFileSnapshot | null> {
  const snapshot: TFile = {
    ...file,
    stat: { ...file.stat },
  };
  const source = await readSourceText(vault, snapshot);
  const content = source.text;
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
  return { file: snapshot, content, segments: source.segments, revision };
}

function isSourceFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'stat' in file && 'extension' in file && 'basename' in file;
}
