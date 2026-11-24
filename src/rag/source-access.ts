import type { TFile, Vault } from 'obsidian';
import { dispatchSourceRead, type SourceDispatchOptions } from './source-worker-runtime';
import { disposeXlsxWorker } from './xlsx-worker-runtime';
import {
  configurePdfWorkerAssets,
  disposePdfWorker,
  extractPdfSourceText,
  isPdfSourceText,
  type PdfSourceSegment,
  type PdfReadOptions,
  type PdfCompleteness,
} from './pdf-worker-runtime';
import { PdfSourceCache, PDF_EXTRACTOR_VERSION } from './pdf-source-cache';
import type { GeneratedArtifactBinding } from '../storage/generated-artifacts';
import { appLogger } from '../utils/logger';
import {
  decodeSourceBytesRust,
  TEXT_DECODER_VERSION,
  isExtractableSourceExtensionRust,
  type RustSourceTextSegment,
  type RustSourceMetadataPart,
  type RustPreparedSource,
  type RustSourceTextExtraction,
} from './rust-core';

/** 추출 본문에서 라벨이 붙은 구간입니다. 줄 번호는 0부터 셉니다. */
export type SourceTextSegment = RustSourceTextSegment | PdfSourceSegment;

export type SourceReadOptions = PdfReadOptions & SourceDispatchOptions;

export interface SourceMetadata {
  segments: readonly SourceTextSegment[];
  metadataParts?: readonly RustSourceMetadataPart[];
  completeness?: PdfCompleteness;
}

export interface SourceText extends SourceMetadata {
  text: string;
  segments: readonly SourceTextSegment[];
  /** PDF에서만 제공하며 이후 코퍼스/엔진으로의 전파는 소비자 책임입니다. */
  completeness?: PdfCompleteness;
  /** 원문과 같은 worker가 계산한 결과. 캐시/소비자가 큰 원장을 재직렬화하지 않습니다. */
  prepared?: RustPreparedSource;
}

export class SourceReadError extends Error {
  constructor(readonly reason: string) {
    super(`Source byte decoding failed / Source text extraction failed (${reason}).`);
    this.name = 'SourceReadError';
  }
}

/** 같은 파일을 동시에 읽는 소비자가 추출을 중복 실행하지 않도록 합니다. */
const pendingReads = new Map<string, Promise<SourceText>>();
const readControllers = new WeakMap<Promise<SourceText>, AbortController>();
const readObservers = new Map<string, Set<PdfReadOptions>>();
/** 재색인 중 같은 원문을 반복 추출하지 않기 위한 최근 사용 캐시입니다. */
const recentReads = new Map<string, SourceText>();
const recentReadCosts = new WeakMap<SourceText, number>();
const RECENT_READ_CHAR_LIMIT = 8 * 1024 * 1024;
let recentReadChars = 0;
let cacheGeneration = 0;
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
  disposeXlsxWorker();
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
  options: SourceReadOptions = {},
): Promise<SourceText> {
  options.signal?.throwIfAborted();
  const extractor = selectSourceExtractor(file.extension ?? '');
  if (extractor === null)
    return waitForRead(extractSourceText(null, vault, file, options, () => false), options);
  const key = `${sourceCacheKey(vault, file)}\u0000${JSON.stringify(options.preparation ?? null)}`;
  if (options.forceRefresh === true) {
    pendingReads.delete(key);
    readObservers.delete(key);
    const previous = recentReads.get(key);
    if (previous) recentReadChars -= recentReadCosts.get(previous) ?? previous.text.length;
    recentReads.delete(key);
  }

  const owner = cacheGeneration;
  const cached = recentReads.get(key);
  if (cached) return cached;
  const observers = readObservers.get(key) ?? new Set<PdfReadOptions>();
  readObservers.set(key, observers);
  observers.add(options);
  const waitForSharedRead = (read: Promise<SourceText>): Promise<SourceText> =>
    waitForRead(read, options).finally(() => {
      observers.delete(options);
      if (observers.size === 0 && pendingReads.get(key) === read) {
        pendingReads.delete(key);
        readObservers.delete(key);
        readControllers.get(read)?.abort();
      }
    });
  const pending = pendingReads.get(key);
  if (pending) return waitForSharedRead(pending);

  const canCache = (): boolean =>
    owner === cacheGeneration && pendingReads.get(key) === read && observers.size > 0;
  const controller = new AbortController();
  const read = extractSourceText(
    extractor,
    vault,
    file,
    {
      forceRefresh: options.forceRefresh,
      priority: options.priority,
      preparation: options.preparation,
      signal: controller.signal,
      onProgress: (page, total) => {
        for (const observer of observers) observer.onProgress?.(page, total);
      },
    },
    canCache,
  )
    .then((result) => {
      if (canCache()) remember(key, result);
      return result;
    })
    .finally(() => {
      if (pendingReads.get(key) === read) {
        pendingReads.delete(key);
        readObservers.delete(key);
      }
    });
  readControllers.set(read, controller);
  pendingReads.set(key, read);
  return waitForSharedRead(read);
}

/** 소비자별 원문 I/O 대기만 취소합니다. 공유 추출은 마지막 소비자가 해제합니다. */
function waitForRead(read: Promise<SourceText>, options: SourceReadOptions): Promise<SourceText> {
  const signal = options.signal;
  if (!signal) return read;
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      const error = new DOMException('Source extraction aborted.', 'AbortError');
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
  const extractable = isExtractableSourceExtensionRust(normalized);
  if (extractable === null) throw new Error('Source format policy is unavailable.');
  return extractable ? 'rust' : null;
}

/** 추출 결과가 없으면 호출자가 파일 단위로 실패를 처리하도록 오류를 던집니다. */
async function extractSourceText(
  extractor: 'rust' | 'pdf' | null,
  vault: Vault,
  file: TFile,
  options: SourceReadOptions,
  canCache: () => boolean,
): Promise<SourceText> {
  if (extractor === 'pdf') {
    const cache = pdfCache;
    const cached =
      options.forceRefresh === true
        ? undefined
        : await cache?.get(file.path, file.stat.mtime, file.stat.size).catch(() => {
            appLogger.warn('PDF cache read failed.', { source: 'rag.pdf.cache' });
            return undefined;
          });
    options.signal?.throwIfAborted();
    if (cached) return finishSourcePreparation(cached, file, options);
  }

  // 평문 크기는 I/O 이전에도 제한합니다. 구조 문서의 별도 입력 예산은 유지합니다.
  if (extractor === null) {
    const budget = decodeSourceBytesRust(new Uint8Array(), false, file.stat.size);
    if (!budget?.ok) throw new SourceReadError(budget?.reason ?? 'unavailable');
  } else if (file.stat.size > 128 * 1024 * 1024) throw new SourceReadError('memory-budget');
  const extracted = await dispatchSourceRead('source-read', async () => new Uint8Array(await vault.readBinary(file)), file.extension ?? '', { ...options, inputBytes: file.stat.size });
  if (!extracted.ok) throw new SourceReadError(extracted.reason ?? 'unavailable');
  if (extracted.binary) {
    if (extractor !== 'pdf' || !extracted.bytes) throw new SourceReadError('invalid-source');
    const cache = pdfCache;
    const source = await extractPdfSourceText(vault, file, options, extracted.bytes);
    options.signal?.throwIfAborted();
    if (canCache() && cache === pdfCache) {
      await cache?.put(file.path, file.stat.mtime, file.stat.size, source).catch(() => {
        appLogger.warn('PDF cache write failed.', { source: 'rag.pdf.cache' });
      });
    }
    return finishSourcePreparation(source, file, options);
  }
  return sourceResult(extracted);
}

function sourceResult(result: RustSourceTextExtraction & { prepared?: RustPreparedSource }): SourceText {
  if ('completeness' in result && !isPdfSourceText(result)) throw new SourceReadError('invalid-pdf-wire');
  const source: SourceText = { text: result.text, segments: result.segments, ...(result.metadataParts?.length ? { metadataParts: result.metadataParts } : {}), ...('completeness' in result ? { completeness: result.completeness as PdfCompleteness } : {}) };
  return result.prepared ? { ...source, prepared: result.prepared } : source;
}

async function finishSourcePreparation(source: SourceText, file: TFile, options: SourceReadOptions): Promise<SourceText> {
  if (!options.preparation) return source;
  const result = await dispatchSourceRead('source-finish', () => Promise.resolve(new Uint8Array()), file.extension ?? '', {
    ...options, inputBytes: Math.max(file.stat.size, source.text.length * 2 + source.segments.length * 256),
  }, { ...source, format: file.extension, ok: true, reason: null });
  if (!result.ok || !result.prepared) throw new SourceReadError(result.reason ?? 'preparation-unavailable');
  if (source.completeness && !isPdfSourceText(result)) throw new SourceReadError('invalid-pdf-wire');
  return sourceResult(result);
}

/** 캐시가 본문 길이 상한을 넘지 않도록 가장 오래된 항목부터 비웁니다. */
function remember(key: string, result: SourceText): void {
  if (result.text.length > RECENT_READ_CHAR_LIMIT) return;
  const cost = result.prepared ? Math.ceil(result.prepared.chargeBytes / 2) : result.text.length + JSON.stringify({ segments: result.segments, metadataParts: result.metadataParts, completeness: result.completeness }).length;
  if (cost > RECENT_READ_CHAR_LIMIT) return;
  recentReadCosts.set(result, cost);
  recentReads.set(key, result);
  recentReadChars += cost;
  while (recentReadChars > RECENT_READ_CHAR_LIMIT && recentReads.size > 1) {
    const oldest = recentReads.keys().next();
    if (oldest.done) break;
    const evicted = recentReads.get(oldest.value);
    recentReads.delete(oldest.value);
    recentReadChars = Math.max(0, recentReadChars - (evicted ? (recentReadCosts.get(evicted) ?? evicted.text.length) : 0));
  }
}

function sourceCacheKey(vault: Vault, file: TFile): string {
  let vaultId = vaultIds.get(vault);
  if (vaultId === undefined) {
    vaultId = nextVaultId++;
    vaultIds.set(vault, vaultId);
  }
  return `${vaultId}\u0000${PDF_EXTRACTOR_VERSION}\u0000${TEXT_DECODER_VERSION}\u0000${file.path}\u0000${file.stat.mtime}\u0000${file.stat.size}`;
}

/** 테스트와 다시 읽기에서 이전 revision 본문이 남지 않도록 캐시를 비웁니다. */
export function clearSourceTextCache(): void {
  cacheGeneration++;
  pendingReads.clear();
  readObservers.clear();
  recentReads.clear();
  recentReadChars = 0;
}
