import type { TAbstractFile, TFile, Vault } from 'obsidian';
import type { PdfReadOptions } from './pdf-worker-runtime';
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
  options: PdfReadOptions = {},
): Promise<SourceFileSnapshot | null> {
  const snapshot = createSourceSnapshot(file);
  const source = await readSourceText(vault, snapshot, options);
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

/**
 * 읽는 동안 바뀐 `stat`이 본문과 섞이지 않도록 값만 고정한 사본을 만듭니다.
 *
 * Obsidian `TFile`의 `cache()` 같은 인스턴스 메서드는 객체 스프레드로 복사되지 않는
 * 프로토타입 멤버라서, 프로토타입을 유지해야 `vault.cachedRead`가 실패하지 않습니다.
 */
function createSourceSnapshot(file: TFile): TFile {
  const snapshot: TFile = { ...file, stat: { ...file.stat } };
  Object.setPrototypeOf(snapshot, Object.getPrototypeOf(file) as object | null);
  return snapshot;
}

function isSourceFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'stat' in file && 'extension' in file && 'basename' in file;
}
