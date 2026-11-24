import type { TAbstractFile, TFile, Vault } from 'obsidian';
import { isSourceRevisionCurrentRust, type RustSourceRevision, type RustSourceChunk, type RustSourceBodyPlan } from './rust-core';
import { beginRagPreparedSourceProbe } from '../utils/vault';
import { readSourceText, SourceReadError, type SourceTextSegment, type SourceMetadata, type SourceReadOptions } from './source-access';

export interface SourceFileSnapshot {
  bodyPlan?: RustSourceBodyPlan;
  file: TFile;
  content: string;
  segments: readonly SourceTextSegment[];
  revision: RustSourceRevision;
  sourceMetadata: SourceMetadata;
  sourceMetadataHash: string;
  sourceMetadataBytes: number;
  chargeBytes: number;
  chunks?: readonly RustSourceChunk[];
}

/**
 * 읽는 동안 바뀌거나 이동한 원문을 새 revision의 본문으로 저장하지 않습니다.
 *
 * 압축 문서를 포함한 모든 원문은 `readSourceText`를 통해 같은 추출 본문을 사용합니다.
 */
export async function readSourceFileSnapshot(
  vault: Vault,
  file: TFile,
  options: SourceReadOptions = {},
): Promise<SourceFileSnapshot | null> {
  const snapshot = createSourceSnapshot(file);
  const publish = beginRagPreparedSourceProbe(vault, file);
  let source;
  try {
    source = await readSourceText(vault, snapshot, { ...options, forceRefresh: options.forceRefresh ?? true, preparation: { ...options.preparation, path: snapshot.path } });
  } catch (error) {
    if (error instanceof SourceReadError) publish({ reason: error.reason });
    else if (!(error instanceof Error && error.name === 'AbortError')) publish({ reason: 'read-failed' });
    throw error;
  }
  options.signal?.throwIfAborted();
  const content = source.text;
  const current = vault.getAbstractFileByPath(snapshot.path);
  if (!isSourceFile(current)) return null;
  const prepared = source.prepared;
  if (!prepared) throw new Error('Source worker preparation is unavailable.');
  const contentHash = prepared.contentHash;
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
  const sourceMetadata: SourceMetadata = {
    segments: source.segments,
    ...(source.metadataParts ? { metadataParts: source.metadataParts } : {}),
    ...(source.completeness ? { completeness: source.completeness } : {}),
  };
  // 명시적으로 추출 캐시를 허용한 읽기는 fresh byte verdict로 승격하지 않습니다.
  if (options.forceRefresh !== false) publish({ text: content, contentHash, sourceMetadataHash: prepared.sourceMetadataHash });
  return { file: snapshot, content, segments: source.segments, revision, sourceMetadata,
    sourceMetadataHash: prepared.sourceMetadataHash, sourceMetadataBytes: prepared.sourceMetadataBytes,
    chargeBytes: prepared.chargeBytes + snapshot.stat.size * 4,
    ...(prepared.bodyPlan ? { bodyPlan: prepared.bodyPlan } : {}), ...(prepared.chunks ? { chunks: prepared.chunks } : {}) };
}

/**
 * 읽는 동안 바뀐 `stat`이 본문과 섞이지 않도록 값만 고정한 사본을 만듭니다.
 *
 * Obsidian `TFile`의 `cache()` 같은 인스턴스 메서드는 객체 스프레드로 복사되지 않습니다.
 * 호스트 API에 파일 인스턴스 계약을 그대로 전달하도록 프로토타입도 유지합니다.
 */
function createSourceSnapshot(file: TFile): TFile {
  const snapshot: TFile = { ...file, stat: { ...file.stat } };
  Object.setPrototypeOf(snapshot, Object.getPrototypeOf(file) as object | null);
  return snapshot;
}

function isSourceFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'stat' in file && 'extension' in file && 'basename' in file;
}
