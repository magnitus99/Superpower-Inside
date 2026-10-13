import { normalizePath, type TFile, type Vault } from 'obsidian';
import { appLogger } from '../utils/logger';
import { ensureReleaseAsset } from '../utils/release-asset';
import { PDF_WORKER_ASSETS } from '../../generated/pdf-worker-assets';

/** 줄 번호는 0부터 세며 Rust 원문 추출기의 구간 계약과 같습니다. */
export interface PdfSourceSegment {
  label: string;
  startLine: number;
  endLine: number;
}
export interface PdfSourceText {
  text: string;
  segments: PdfSourceSegment[];
}
export interface PdfReadOptions {
  signal?: AbortSignal;
  onProgress?: (page: number, pageCount: number) => void;
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
}
interface PendingRequest {
  resolve(response: PdfWorkerResponse): void;
  reject(error: Error): void;
  timeoutId: number;
  cleanup(): void;
  options: PdfReadOptions;
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
  for (const url of assetUrls) URL.revokeObjectURL(url);
  assetUrls.clear();
}

export async function extractPdfSourceText(
  vault: Vault,
  file: TFile,
  options: PdfReadOptions = {},
): Promise<PdfSourceText> {
  options.signal?.throwIfAborted();
  if (file.stat.size > 128 * 1024 * 1024) throw new Error('PDF source is too-large.');
  const bytes = new Uint8Array(await vault.readBinary(file));
  options.signal?.throwIfAborted();
  const worker = await ensureWorker(vault);
  options.signal?.throwIfAborted();
  const id = nextRequestId++;
  return new Promise<PdfSourceText>((resolve, reject) => {
    const abort = (): void =>
      disposePdfWorker(new DOMException('PDF extraction aborted.', 'AbortError'));
    const request: PendingRequest = {
      resolve: (response) => {
        if (response.ok) {
          resolve({ text: response.text ?? '', segments: response.segments ?? [] });
        } else {
          appLogger.warn('PDF source extraction failed.', {
            source: 'rag.pdf',
            data: { reason: response.reason },
          });
          reject(
            new Error(
              `Source text extraction failed for ${file.path} (${response.reason ?? 'corrupt'}).`,
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
  workerPromise ??= createWorker(vault).catch((error: unknown) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
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
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    // 활성 파일의 처리가 진행 중이면 직렬 대기 중인 요청도 타임아웃시키지 않습니다.
    for (const queued of pending.values()) touch(queued);
    if (response.kind === 'ocr-assets') {
      ocrAssetPromise ??= assetUrl(vault, 'pdf-ocr-worker.js').catch((error: unknown) => {
        ocrAssetPromise = null;
        throw error;
      });
      void ocrAssetPromise.then(
        (url) => worker.postMessage({ id: response.id, kind: 'ocr-assets', url }),
        () =>
          worker.postMessage({
            id: response.id,
            kind: 'ocr-assets',
            error: 'OCR asset is unavailable.',
          }),
      );
      return;
    }
    if (response.kind === 'progress') {
      request.options.onProgress?.(response.page ?? 0, response.pageCount ?? 0);
      return;
    }
    if (response.kind === 'ocr-error') {
      disposePdfWorker(new Error('PDF OCR worker failed.'));
      return;
    }
    if (response.kind) return;
    pending.delete(response.id);
    request.cleanup();
    request.resolve(response);
  };
  worker.onerror = () => disposePdfWorker(new Error('PDF worker stopped unexpectedly.'));
  worker.onmessageerror = () =>
    disposePdfWorker(new Error('PDF worker response could not be decoded.'));
  return worker;
}
