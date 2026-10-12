import type { TFile, Vault } from 'obsidian';
import {
  configurePdfWorkerAssets,
  disposePdfWorker,
  extractPdfSourceText,
  type PdfSourceSegment,
  type PdfReadOptions,
} from './pdf-worker-runtime';
import { PdfSourceCache, PDF_EXTRACTOR_VERSION } from './pdf-source-cache';
import type { GeneratedArtifactBinding } from '../storage/generated-artifacts';
import { appLogger } from '../utils/logger';
import {
  extractSourceTextRust,
  isExtractableSourceExtensionRust,
  type RustSourceTextSegment,
} from './rust-core';

/** 추출 본문에서 라벨이 붙은 구간입니다. 줄 번호는 0부터 셉니다. */
export type SourceTextSegment = RustSourceTextSegment | PdfSourceSegment;

export interface SourceText {
  text: string;
  segments: readonly SourceTextSegment[];
}

/** 같은 파일을 동시에 읽는 소비자가 추출을 중복 실행하지 않도록 합니다. */
const pendingReads = new Map<string, Promise<SourceText>>();
const readObservers = new Map<string, Set<PdfReadOptions>>();
/** 재색인 중 같은 원문을 반복 추출하지 않기 위한 최근 사용 캐시입니다. */
const recentReads = new Map<string, SourceText>();
const RECENT_READ_CHAR_LIMIT = 8 * 1024 * 1024;
let recentReadChars = 0;
let pdfCache: PdfSourceCache | null = null;
const vaultIds = new WeakMap<Vault, number>();
let nextVaultId = 0;

/** 플러그인 폴더를 알려 추출 worker 자산을 찾을 수 있게 합니다. */
export function configureSourceAssets(
  pluginId: string,
  vaultScope?: string,
  ownership?: GeneratedArtifactBinding,
): void {
  pdfCache?.close();
  pdfCache = vaultScope
    ? new PdfSourceCache(`SuperpowerInsidePdfSources:${vaultScope}`, ownership)
    : null;
  clearSourceTextCache();
  configurePdfWorkerAssets(pluginId);
}

export function disposeSourceAssets(): void {
  disposePdfWorker();
  pdfCache?.close();
  pdfCache = null;
  clearSourceTextCache();
}

/**
 * 볼트 원문 읽기의 단일 진입점입니다.
 *
 * 일반 텍스트는 그대로 읽고, 추출 지원 문서는 바이트를 결정적 추출기에 넘깁니다.
 * `RAG`·`BM25`·임베딩·네이티브 도구·채팅 컨텍스트가 모두 이 함수를 통해 같은 본문을 봅니다.
 */
export async function readSourceText(
  vault: Vault,
  file: TFile,
  options: PdfReadOptions = {},
): Promise<SourceText> {
  options.signal?.throwIfAborted();
  const extractor = selectSourceExtractor(file.extension ?? '');
  if (extractor === null) return { text: await vault.cachedRead(file), segments: [] };

  const key = sourceCacheKey(vault, file);
  const cached = recentReads.get(key);
  if (cached) return cached;
  let observers = readObservers.get(key);
  if (!observers) {
    observers = new Set();
    readObservers.set(key, observers);
  }
  observers.add(options);
  const pending = pendingReads.get(key);
  if (pending) return waitForRead(pending, options);

  const read = extractSourceText(extractor, vault, file, {
    signal: options.signal,
    onProgress: (page, total) => {
      for (const observer of observers) observer.onProgress?.(page, total);
    },
  })
    .then((result) => {
      options.signal?.throwIfAborted();
      remember(key, result);
      return result;
    })
    .finally(() => {
      pendingReads.delete(key);
      readObservers.delete(key);
    });
  pendingReads.set(key, read);
  return waitForRead(read, options);
}

/** 공유된 PDF 추출을 기다리는 소비자의 취소도 실제 worker에 전달합니다. */
function waitForRead(read: Promise<SourceText>, options: PdfReadOptions): Promise<SourceText> {
  const signal = options.signal;
  if (!signal) return read;
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      const error = new DOMException('Source extraction aborted.', 'AbortError');
      disposePdfWorker(error);
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
    void read.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/**
 * 확장자에 맞는 추출기를 고릅니다.
 *
 * PDF는 Rust 코어가 아니라 전용 worker가 본문을 만들기 때문에 여기서 먼저 분기합니다.
 * Obsidian은 확장자를 대소문자 그대로 주므로 정규화한 값으로 비교합니다.
 */
function selectSourceExtractor(extension: string): 'rust' | 'pdf' | null {
  const normalized = extension.trim().toLowerCase();
  if (normalized === 'pdf') return 'pdf';
  return isExtractableSourceExtensionRust(normalized) === true ? 'rust' : null;
}

/** 추출 결과가 없으면 호출자가 파일 단위로 실패를 처리하도록 오류를 던집니다. */
async function extractSourceText(
  extractor: 'rust' | 'pdf',
  vault: Vault,
  file: TFile,
  options: PdfReadOptions,
): Promise<SourceText> {
  if (extractor === 'pdf') {
    const cache = pdfCache;
    const cached = await cache?.get(file.path, file.stat.mtime, file.stat.size).catch(() => {
      appLogger.warn('PDF cache read failed.', { source: 'rag.pdf.cache' });
      return undefined;
    });
    options.signal?.throwIfAborted();
    if (cached) return cached;
    const source = await extractPdfSourceText(vault, file, options);
    options.signal?.throwIfAborted();
    await cache?.put(file.path, file.stat.mtime, file.stat.size, source).catch(() => {
      appLogger.warn('PDF cache write failed.', { source: 'rag.pdf.cache' });
    });
    return source;
  }

  const bytes = new Uint8Array(await vault.readBinary(file));
  const extracted = extractSourceTextRust(file.extension ?? '', bytes);
  if (!extracted) throw new Error(`Source text extraction is unavailable for ${file.path}.`);
  if (!extracted.ok)
    throw new Error(
      `Source text extraction failed for ${file.path} (${extracted.reason ?? 'unknown'}).`,
    );
  return { text: extracted.text, segments: extracted.segments };
}

/** 캐시가 본문 길이 상한을 넘지 않도록 가장 오래된 항목부터 비웁니다. */
function remember(key: string, result: SourceText): void {
  recentReads.set(key, result);
  recentReadChars += result.text.length;
  while (recentReadChars > RECENT_READ_CHAR_LIMIT && recentReads.size > 1) {
    const oldest = recentReads.keys().next();
    if (oldest.done) break;
    const evicted = recentReads.get(oldest.value);
    recentReads.delete(oldest.value);
    recentReadChars = Math.max(0, recentReadChars - (evicted?.text.length ?? 0));
  }
}

function sourceCacheKey(vault: Vault, file: TFile): string {
  let vaultId = vaultIds.get(vault);
  if (vaultId === undefined) {
    vaultId = nextVaultId++;
    vaultIds.set(vault, vaultId);
  }
  return `${vaultId}\u0000${PDF_EXTRACTOR_VERSION}\u0000${file.path}\u0000${file.stat.mtime}\u0000${file.stat.size}`;
}

/** 테스트와 다시 읽기에서 이전 revision 본문이 남지 않도록 캐시를 비웁니다. */
export function clearSourceTextCache(): void {
  pendingReads.clear();
  readObservers.clear();
  recentReads.clear();
  recentReadChars = 0;
}
