import type { TFile, Vault } from 'obsidian';
import { XLSX_WORKER_SOURCE } from '../../generated/xlsx-worker-source';
import { t } from '../i18n';
import { appLogger } from '../utils/logger';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import type { SourceText } from './source-access';
import type { PdfReadOptions } from './pdf-worker-runtime';
import type { RustSourceTextSegment } from './rust-core';

/** 순차 추출의 파일별 전체 실행 예산이며 대기열 시간은 포함하지 않습니다. */
const XLSX_TIME_BUDGET_MS = 60_000;
/** JS와 WASM의 입력 복사도 512MiB 작업 예산에 포함됩니다. */
const XLSX_SOURCE_BYTES = 128 * 1024 * 1024;
let queue: Promise<void> = Promise.resolve();
let generation = 0;
let cancelActive: ((error: Error) => void) | null = null;

interface XlsxWorkerResponse {
  ok: boolean;
  reason?: string;
  bytes?: Uint8Array;
  segmentsJson?: string;
}

/** 오류 코드는 로깅에, 번역된 메시지는 기존 오류 표시 경로에 사용합니다. */
export class XlsxExtractionError extends Error {
  constructor(readonly reason: string) {
    const key =
      reason === 'memory-budget'
        ? 'xlsxMemoryBudgetError'
        : reason === 'xml-token-budget'
          ? 'xlsxXmlTokenBudgetError'
          : reason === 'time-budget'
            ? 'xlsxTimeBudgetError'
            : 'xlsxExtractionError';
    super(t(key, { reason }));
    this.name = 'XlsxExtractionError';
  }
}

/** 종료·설정 갱신 후 대기 중인 작업이 새로 실행되지 않도록 합니다. */
export function disposeXlsxWorker(): void {
  generation++;
  cancelActive?.(new DOMException('XLSX extraction aborted.', 'AbortError'));
}

/** 바이너리 읽기부터 직렬화해 여러 큰 원본이 메모리에 동시에 남지 않습니다. */
export async function extractXlsxSourceText(
  vault: Vault,
  file: TFile,
  options: PdfReadOptions = {},
): Promise<SourceText> {
  options.signal?.throwIfAborted();
  const owner = generation;
  const operation = queue.then(async () => {
    options.signal?.throwIfAborted();
    if (owner !== generation) throw new DOMException('XLSX extraction aborted.', 'AbortError');
    if (file.stat.size > XLSX_SOURCE_BYTES) throw new XlsxExtractionError('memory-budget');
    const bytes = new Uint8Array(await vault.readBinary(file));
    options.signal?.throwIfAborted();
    if (owner !== generation) throw new DOMException('XLSX extraction aborted.', 'AbortError');
    return runWorker(bytes, options.signal);
  });
  queue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

function runWorker(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<SourceText> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined')
    return Promise.reject(new XlsxExtractionError('worker-unavailable'));
  const url = URL.createObjectURL(new Blob([XLSX_WORKER_SOURCE], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch {
    URL.revokeObjectURL(url);
    return Promise.reject(new XlsxExtractionError('worker-unavailable'));
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    let stopped = false;
    const stopWorker = (): void => {
      if (stopped) return;
      stopped = true;
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    const finish = (error?: Error, result?: SourceText): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (cancelActive === finish) cancelActive = null;
      stopWorker();
      if (error) {
        if (error instanceof XlsxExtractionError)
          appLogger.warn('XLSX source extraction failed.', {
            source: 'rag.xlsx',
            data: { reason: error.reason },
          });
        reject(error);
      } else if (result) resolve(result);
      else reject(new XlsxExtractionError('worker-failed'));
    };
    const abort = (): void => finish(new DOMException('XLSX extraction aborted.', 'AbortError'));
    const timer = window.setTimeout(
      () => finish(new XlsxExtractionError('time-budget')),
      XLSX_TIME_BUDGET_MS,
    );
    cancelActive = finish;
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<XlsxWorkerResponse>) => {
      if (finished) return;
      const response = event.data;
      if (!response.ok) {
        finish(new XlsxExtractionError(response.reason ?? 'worker-failed'));
        return;
      }
      // 반환 버퍼는 이미 호스트에 있으므로 큰 WASM 메모리를 먼저 해제합니다.
      stopWorker();
      try {
        const segments: unknown = JSON.parse(response.segmentsJson ?? 'null');
        if (!response.bytes?.byteLength || !isSegments(segments) || segments.length === 0)
          throw new Error('Invalid XLSX wire format.');
        finish(undefined, {
          text: new TextDecoder('utf-8', { fatal: true }).decode(response.bytes),
          segments,
        });
      } catch {
        finish(new XlsxExtractionError('worker-failed'));
      }
    };
    worker.onerror = () => finish(new XlsxExtractionError('worker-failed'));
    worker.onmessageerror = () => finish(new XlsxExtractionError('worker-failed'));
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage({ bytes, wasmBase64: RAG_WASM_BASE64 }, [bytes.buffer]);
    } catch {
      finish(new XlsxExtractionError('worker-failed'));
    }
  });
}

/** TS는 워커 입출력 형식만 확인하고 문서 파싱은 Rust에 둡니다. */
function isSegments(value: unknown): value is RustSourceTextSegment[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const segment = item as Partial<RustSourceTextSegment>;
      return (
        typeof segment.label === 'string' &&
        typeof segment.startLine === 'number' &&
        Number.isSafeInteger(segment.startLine) &&
        segment.startLine >= 0 &&
        typeof segment.endLine === 'number' &&
        Number.isSafeInteger(segment.endLine) &&
        segment.endLine >= segment.startLine
      );
    })
  );
}
