import { normalizePath, type TFile, type Vault } from 'obsidian';
import { appLogger } from '../utils/logger';
import { ensureReleaseAsset } from '../utils/release-asset';
import { PDF_WORKER_ASSETS } from '../../.local/generated/pdf-worker-assets';

/** 줄 번호는 0부터 세며 Rust 원문 추출기의 구간 계약과 같습니다. */
export interface PdfSourceSegment {
  label: string;
  startLine: number;
  endLine: number;
}
export type PdfMissingPageReason = 'ocr-low-confidence' | 'ocr-empty' | 'page-error';
export interface PdfCompleteness {
  status: 'complete' | 'partial';
  pageCount: number;
  missingPageCount: number;
  /** 누락 주소는 본문이나 인용 가능한 segment를 만들지 않습니다. */
  missingPages: Array<{ pageNumber: number; reason: PdfMissingPageReason }>;
  failures: Array<{
    part: 'metadata' | 'fields' | 'annotations';
    reason: 'extract-error';
    pageNumber?: number;
  }>;
}
export interface PdfSourceText {
  text: string;
  segments: PdfSourceSegment[];
  completeness: PdfCompleteness;
}

export class PdfSourceExtractionError extends Error {
  constructor(
    message: string,
    public readonly completeness?: PdfCompleteness,
  ) {
    super(message);
    this.name = 'PdfSourceExtractionError';
  }
}

/** PDF 예외 경계에서 worker·영속 캐시 wire를 같은 규칙으로 검증합니다. */
export function isPdfSourceText(value: unknown): value is PdfSourceText {
  if (
    !isRecord(value) ||
    typeof value.text !== 'string' ||
    value.text.length > 8 * 1024 * 1024 ||
    !Array.isArray(value.segments) ||
    !isPdfCompleteness(value.completeness)
  )
    return false;
  const lines = value.text.split('\n').length;
  let previousEnd = -1;
  for (const segment of value.segments) {
    if (
      !isRecord(segment) ||
      typeof segment.label !== 'string' ||
      segment.label.length === 0 ||
      !isInteger(segment.startLine, 0) ||
      !isInteger(segment.endLine, 0) ||
      segment.startLine <= previousEnd ||
      segment.endLine < segment.startLine ||
      segment.endLine >= lines
    )
      return false;
    previousEnd = segment.endLine;
  }
  return value.text.trim().length > 0 && value.segments.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}
function isPdfCompleteness(value: unknown): value is PdfCompleteness {
  if (
    !isRecord(value) ||
    !isInteger(value.pageCount, 1) ||
    value.pageCount > 2000 ||
    !Array.isArray(value.missingPages) ||
    !Array.isArray(value.failures) ||
    value.failures.length > 2002
  )
    return false;
  if (value.missingPageCount !== value.missingPages.length) return false;
  let previous = 0;
  for (const missing of value.missingPages) {
    if (
      !isRecord(missing) ||
      !isInteger(missing.pageNumber, 1) ||
      missing.pageNumber <= previous ||
      missing.pageNumber > value.pageCount ||
      typeof missing.reason !== 'string' ||
      !['ocr-low-confidence', 'ocr-empty', 'page-error'].includes(missing.reason)
    )
      return false;
    previous = missing.pageNumber;
  }
  for (const failure of value.failures) {
    if (
      !isRecord(failure) ||
      typeof failure.part !== 'string' ||
      !['metadata', 'fields', 'annotations'].includes(failure.part) ||
      failure.reason !== 'extract-error' ||
      (failure.pageNumber !== undefined &&
        (!isInteger(failure.pageNumber, 1) || failure.pageNumber > value.pageCount))
    )
      return false;
    if ((failure.part === 'annotations') !== (failure.pageNumber !== undefined)) return false;
  }
  return (
    value.status ===
    (value.missingPages.length + value.failures.length > 0 ? 'partial' : 'complete')
  );
}
export interface PdfReadOptions {
  signal?: AbortSignal;
  onProgress?: (page: number, pageCount: number) => void;
  /** 원문 재검증처럼 캐시된 추출문을 신뢰하면 안 되는 읽기에서 사용합니다. */
  forceRefresh?: boolean;
}
interface PdfWorkerResponse {
  id: number;
  kind?: string;
  ok: boolean;
  reason?: string;
  text?: string;
  segments?: PdfSourceSegment[];
  page?: number;
  pageCount?: number;
  lowConfidencePages?: number;
  completeness?: PdfCompleteness;
}
interface PendingRequest {
  resolve(response: PdfWorkerResponse): void;
  reject(error: Error): void;
  timeoutId: number;
  cleanup(): void;
  options: PdfReadOptions;
  cancelOcrAssets?(): void;
}

/** 전체 책 길이가 아니라 worker의 무응답 시간을 제한합니다. */
const REQUEST_TIMEOUT_MS = 120_000;
let pluginId = '';
let workerPromise: Promise<Worker> | null = null;
let activeWorker: Worker | null = null;
let generation = 0;
const assetUrls = new Set<string>();
let ocrAssetPromise: Promise<string> | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();
const abandoned = new Set<number>();

export function configurePdfWorkerAssets(id: string): void {
  if (id !== pluginId) disposePdfWorker();
  pluginId = id;
}

/** 플러그인 종료·취소·실패 시 worker와 자산 URL을 함께 정리합니다. */
export function disposePdfWorker(error = new Error('PDF worker disposed.')): void {
  generation++;
  activeWorker?.terminate();
  activeWorker = null;
  workerPromise = null;
  ocrAssetPromise = null;
  for (const request of pending.values()) {
    request.cleanup();
    request.reject(error);
  }
  pending.clear();
  abandoned.clear();
  for (const url of assetUrls) URL.revokeObjectURL(url);
  assetUrls.clear();
}

export async function extractPdfSourceText(
  vault: Vault,
  file: TFile,
  options: PdfReadOptions = {},
  inputBytes?: Uint8Array<ArrayBuffer>,
): Promise<PdfSourceText> {
  options.signal?.throwIfAborted();
  if (file.stat.size > 128 * 1024 * 1024) throw new Error('PDF source is too-large.');
  const bytes = inputBytes ?? new Uint8Array(await vault.readBinary(file));
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('PDF source is too-large.');
  options.signal?.throwIfAborted();
  const worker = await ensureWorker(vault);
  options.signal?.throwIfAborted();
  const id = nextRequestId++;
  return new Promise<PdfSourceText>((resolve, reject) => {
    const abort = (): void => {
      const owned = pending.get(id);
      if (!owned) return;
      pending.delete(id);
      abandoned.add(id);
      owned.cleanup();
      owned.cancelOcrAssets?.();
      owned.reject(new DOMException('PDF extraction aborted.', 'AbortError'));
      // 다른 파일의 소비자가 있는 공유 PDF worker를 함께 취소하지 않습니다.
      if (pending.size === 0) disposePdfWorker();
    };
    const request: PendingRequest = {
      resolve: (response) => {
        if (response.ok && isPdfSourceText(response)) {
          const lowConfidencePages = response.lowConfidencePages ?? 0;
          if (lowConfidencePages > 0)
            appLogger.warn('PDF pages skipped at low OCR confidence.', {
              source: 'rag.pdf',
              data: { path: file.path, pages: lowConfidencePages },
            });
          resolve({
            text: response.text,
            segments: response.segments,
            completeness: response.completeness,
          });
        } else {
          appLogger.warn('PDF source extraction failed.', {
            source: 'rag.pdf',
            data: { reason: response.reason },
          });
          reject(
            new PdfSourceExtractionError(
              `Source text extraction failed for ${file.path} (${response.reason ?? 'corrupt'}).`,
              response.completeness,
            ),
          );
        }
      },
      reject,
      timeoutId: 0,
      options,
      cleanup: () => {
        window.clearTimeout(request.timeoutId);
        options.signal?.removeEventListener('abort', abort);
      },
    };
    pending.set(id, request);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    touch(request);
    try {
      worker.postMessage({ id, bytes }, [bytes.buffer]);
    } catch (error) {
      disposePdfWorker(error instanceof Error ? error : new Error('PDF worker message failed.'));
    }
  });
}

function touch(request: PendingRequest): void {
  window.clearTimeout(request.timeoutId);
  request.timeoutId = window.setTimeout(() => {
    appLogger.warn('PDF worker timed out.', { source: 'rag.pdf' });
    disposePdfWorker(new Error('PDF extraction timeout.'));
  }, REQUEST_TIMEOUT_MS);
}

function ensureWorker(vault: Vault): Promise<Worker> {
  if (workerPromise) return workerPromise;
  const owned = createWorker(vault).catch((error: unknown) => {
    if (workerPromise === owned) workerPromise = null;
    throw error;
  });
  workerPromise = owned;
  return owned;
}

async function assetUrl(
  vault: Vault,
  file: 'pdf-worker.js' | 'pdf-ocr-worker.js',
): Promise<string> {
  const currentGeneration = generation;
  const path = normalizePath(`${vault.configDir}/plugins/${pluginId}/${file}`);
  const asset = PDF_WORKER_ASSETS.find((item) => item.file === file);
  if (!asset) throw new Error('PDF asset metadata is unavailable.');
  const source = await ensureReleaseAsset({ adapter: vault.adapter, path, ...asset });
  if (generation !== currentGeneration) throw new Error('PDF asset loading was cancelled.');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  assetUrls.add(url);
  return url;
}

async function createWorker(vault: Vault): Promise<Worker> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined')
    throw new Error('PDF extraction requires Web Worker support.');
  if (!pluginId) throw new Error('PDF worker assets are not configured.');
  const worker = new Worker(await assetUrl(vault, 'pdf-worker.js'));
  activeWorker = worker;
  worker.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
    if (activeWorker !== worker) return;
    const response: unknown = event.data;
    if (!isRecord(response) || !isInteger(response.id, 1)) {
      disposePdfWorker(new Error('PDF worker response is invalid.'));
      return;
    }
    const request = pending.get(response.id);
    if (!request) {
      if (abandoned.has(response.id)) {
        // 취소된 앞 파일의 OCR handshake를 풀어 다음 파일의 직렬 큐를 막지 않습니다.
        if (response.kind === 'ocr-assets') {
          try { worker.postMessage({ id: response.id, kind: 'ocr-assets', error: 'PDF extraction aborted.' }); }
          catch { disposePdfWorker(new Error('PDF worker asset message failed.')); }
        }
        if (response.kind === undefined) abandoned.delete(response.id);
        for (const queued of pending.values()) touch(queued);
      }
      return;
    }
    const kind = response.kind;
    if (
      (kind !== undefined &&
        (typeof kind !== 'string' ||
          !['ocr-assets', 'progress', 'heartbeat', 'ocr-error'].includes(kind))) ||
      (kind === 'progress' &&
        (!isInteger(response.page, 1) ||
          !isInteger(response.pageCount, 1) ||
          response.page > response.pageCount)) ||
      (kind === undefined &&
        (typeof response.ok !== 'boolean' ||
          (response.ok
            ? !isPdfSourceText(response) ||
              (response.pageCount !== undefined &&
                response.pageCount !== response.completeness.pageCount) ||
              (response.lowConfidencePages !== undefined &&
                response.lowConfidencePages !==
                  response.completeness.missingPages.filter(
                    (page) => page.reason === 'ocr-low-confidence',
                  ).length)
            : typeof response.reason !== 'string' ||
              ![
                'corrupt',
                'empty',
                'encrypted',
                'too-large',
                'ocr-low-confidence',
                'ocr-empty',
              ].includes(response.reason) ||
              response.text !== undefined ||
              response.segments !== undefined ||
              (response.completeness !== undefined && !isPdfCompleteness(response.completeness)))))
    ) {
      disposePdfWorker(new Error('PDF worker response is invalid.'));
      return;
    }
    // 활성 파일의 처리가 진행 중이면 직렬 대기 중인 요청도 타임아웃시키지 않습니다.
    for (const queued of pending.values()) touch(queued);
    if (response.kind === 'ocr-assets') {
      if (request.cancelOcrAssets) return;
      ocrAssetPromise ??= assetUrl(vault, 'pdf-ocr-worker.js').catch((error: unknown) => {
        ocrAssetPromise = null;
        throw error;
      });
      let replied = false;
      const reply = (payload: { url?: string; error?: string }): void => {
        if (replied || activeWorker !== worker || (!pending.has(response.id as number) && !abandoned.has(response.id as number))) return;
        replied = true;
        request.cancelOcrAssets = undefined;
        try {
          worker.postMessage({ id: response.id, kind: 'ocr-assets', ...payload });
        } catch {
          disposePdfWorker(new Error('PDF worker asset message failed.'));
        }
      };
      request.cancelOcrAssets = () => reply({ error: 'PDF extraction aborted.' });
      void ocrAssetPromise.then(
        (url) => reply({ url }),
        () => reply({ error: 'OCR asset is unavailable.' }),
      );
      return;
    }
    if (response.kind === 'progress') {
      request.options.onProgress?.(response.page as number, response.pageCount as number);
      return;
    }
    if (response.kind === 'ocr-error') {
      disposePdfWorker(new Error('PDF OCR worker failed.'));
      return;
    }
    if (response.kind) return;
    pending.delete(response.id);
    request.cleanup();
    request.resolve(response as unknown as PdfWorkerResponse);
  };
  worker.onerror = () => {
    if (activeWorker === worker) disposePdfWorker(new Error('PDF worker stopped unexpectedly.'));
  };
  worker.onmessageerror = () => {
    if (activeWorker === worker)
      disposePdfWorker(new Error('PDF worker response could not be decoded.'));
  };
  return worker;
}
