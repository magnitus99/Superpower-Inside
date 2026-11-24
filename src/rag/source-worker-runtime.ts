import { XLSX_WORKER_SOURCE } from '../../.local/generated/xlsx-worker-source';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import { decodeSourceBytesRust, extractSourceTextRust, prepareSourceBytesRust, prepareSourceTextRust, isRustSourceReadResult, type RustSourceTextExtraction, type RustSourceReadResult, type SourcePreparationConfig } from './rust-core';

export type DispatchedSourceRead = RustSourceReadResult & { bytes?: Uint8Array<ArrayBuffer> };
import type { SourceWorkerRequest } from './source-worker-entry';
import { LiteralCoreError, type LiteralSourceSummary } from './literal-core';

export interface SourceDispatchOptions {
  signal?: AbortSignal;
  priority?: 'foreground' | 'background';
  inputBytes?: number;
  preparation?: SourcePreparationConfig;
}

interface SourceJob {
  foreground: boolean;
  reservedBytes: number;
  run(): Promise<void>;
  settled?(): void;
}

const queue: SourceJob[] = [];
let active = 0;
let backgroundActive = 0;
let reservedBytes = 0;
const SOURCE_RESIDENT_BUDGET = 256 * 1024 * 1024;
let compiled: Promise<WebAssembly.Module> | undefined;

export type SourceDispatchSnapshot = Readonly<
  | { supported: true; queuedForeground: number; active: number; reservedBytes: number; budgetBytes: number }
  | { supported: false; queuedForeground: null; active: null; reservedBytes: null; budgetBytes: null }
>;

/** 동일 turn의 읽기 전용 원장이다. Node 직접 실행 경로는 계측되지 않으므로 0 여유로 위장하지 않는다. */
export function getSourceDispatchSnapshot(): SourceDispatchSnapshot {
  if (typeof Worker === 'undefined' && typeof document === 'undefined') {
    return { supported: false, queuedForeground: null, active: null, reservedBytes: null, budgetBytes: null };
  }
  return {
    supported: true,
    queuedForeground: queue.filter((job) => job.foreground).length,
    active, reservedBytes, budgetBytes: SOURCE_RESIDENT_BUDGET,
  };
}

/** 입력 읽기부터 직렬 admission하여 대기 작업의 whole-buffer가 상주하지 않게 합니다. */
export function dispatchSourceRead(
  operation: SourceWorkerRequest['operation'],
  load: () => Promise<Uint8Array<ArrayBuffer>>,
  extension: string,
  options: SourceDispatchOptions,
  source?: RustSourceTextExtraction,
): Promise<DispatchedSourceRead> {
  if (typeof Worker === 'undefined' && typeof document === 'undefined') {
    options.signal?.throwIfAborted();
    return waitForSourceLoad(load(), options.signal).then((bytes) => {
      options.signal?.throwIfAborted();
      return execute(operation, bytes, extension, options, source);
    });
  }
  const estimatedBytes = options.inputBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0 || estimatedBytes > 128 * 1024 * 1024) return Promise.reject(new Error('Source input memory-budget exceeded.'));
  return new Promise((resolve, reject) => {
    const job: SourceJob = {
      foreground: options.priority !== 'background',
      reservedBytes: estimatedBytes * 4 + 8 * 1024 * 1024,
      run: async () => {
        try {
          options.signal?.throwIfAborted();
          // 취소 응답과 취소할 수 없는 Vault I/O의 예약 해제를 분리합니다.
          const bytes = await load();
          options.signal?.throwIfAborted();
          const actualReservation = Math.max(bytes.byteLength, source ? estimatedBytes : 0) * 4 + 8 * 1024 * 1024;
          if (bytes.byteLength > 128 * 1024 * 1024 || (active > 1 && reservedBytes - job.reservedBytes + actualReservation > SOURCE_RESIDENT_BUDGET)) throw new Error('Source input memory-budget exceeded.');
          reservedBytes += actualReservation - job.reservedBytes;
          job.reservedBytes = actualReservation;
          const result = await execute(operation, bytes, extension, options, source);
          if (result.prepared && active > 1 && reservedBytes + result.prepared.chargeBytes > SOURCE_RESIDENT_BUDGET) throw new Error('Source output memory-budget exceeded.');
          resolve(result);
        } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        finally { options.signal?.removeEventListener('abort', abort); }
      },
    };
    const abort = (): void => {
      reject(new DOMException('Source read aborted.', 'AbortError'));
      const index = queue.indexOf(job);
      if (index >= 0) {
        queue.splice(index, 1);
        options.signal?.removeEventListener('abort', abort);
        queueMicrotask(drain);
      }
    };
    queue.push(job);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    // 같은 turn에 들어온 foreground가 다음 dispatch를 먼저 가져갑니다.
    queueMicrotask(drain);
  });
}

/** Literal은 소비자 조기 취소 없이 callback I/O와 cleanup의 물리 정착까지 예약합니다. */
export function dispatchLiteralSourceTask(reservation: number, task: () => Promise<LiteralSourceSummary>, signal?: AbortSignal): Promise<LiteralSourceSummary> {
  if (!Number.isSafeInteger(reservation) || reservation < 16 * 1024 * 1024 || reservation > SOURCE_RESIDENT_BUDGET) return Promise.reject(new LiteralCoreError('memory-budget'));
  if (typeof Worker === 'undefined' && typeof document === 'undefined') {
    return Promise.resolve().then(() => { signal?.throwIfAborted(); return task(); });
  }
  return new Promise((resolve, reject) => {
    let complete: () => void = () => undefined;
    const job: SourceJob = {
      foreground: true,
      reservedBytes: reservation,
      run: async () => {
        signal?.removeEventListener('abort', abort);
        try {
          signal?.throwIfAborted();
          const result = await task();
          complete = () => resolve(result);
        } catch (error) { complete = () => reject(error instanceof Error ? error : new LiteralCoreError('worker-failed')); }
      },
      settled: () => complete(),
    };
    const abort = (): void => {
      const index = queue.indexOf(job);
      if (index < 0) return;
      queue.splice(index, 1);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Literal scan aborted.', 'AbortError'));
      queueMicrotask(drain);
    };
    queue.push(job);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    queueMicrotask(drain);
  });
}

export function getSourceWorkerModule(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compile(Uint8Array.from(atob(RAG_WASM_BASE64), (char) => char.charCodeAt(0)));
  return compiled;
}

function waitForSourceLoad(load: Promise<Uint8Array<ArrayBuffer>>, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!signal) return load;
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new DOMException('Source read aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void load.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function drain(): void {
  if (active >= 2 || queue.length === 0) return;
  const index = queue.findIndex((job) => job.foreground);
  const next = queue[index < 0 ? 0 : index];
  if (!next.foreground && backgroundActive > 0) return;
  if (active > 0 && reservedBytes + next.reservedBytes > SOURCE_RESIDENT_BUDGET) return;
  const [job] = queue.splice(index < 0 ? 0 : index, 1);
  active++;
  if (!job.foreground) backgroundActive++;
  reservedBytes += job.reservedBytes;
  void job.run().finally(() => { active--; if (!job.foreground) backgroundActive--; reservedBytes -= job.reservedBytes; job.settled?.(); drain(); });
  drain();
}

async function execute(operation: SourceWorkerRequest['operation'], bytes: Uint8Array<ArrayBuffer>, extension: string, options: SourceDispatchOptions, source?: RustSourceTextExtraction): Promise<DispatchedSourceRead> {
  const { signal, preparation } = options;
  // Node 검증도 동일 Rust 구현을 사용하며 운영 worker 실패를 UI 계산으로 대체하지 않습니다.
  if (typeof Worker === 'undefined') {
    if (typeof document !== 'undefined') throw new Error('Source worker is unavailable.');
    const result = operation === 'source-decode' ? decodeSourceBytesRust(bytes) : operation === 'source-extract' ? extractSourceTextRust(extension, bytes)
      : operation === 'source-finish' ? (source && preparation ? prepareSourceTextRust(extension, source, preparation) : null)
      : prepareSourceBytesRust(extension, bytes, preparation);
    if (!result) throw new Error('Rust source computation is unavailable (regenerate WASM and workers).');
    const read: DispatchedSourceRead = 'segments' in result ? result : { ...result, format: 'text', segments: [] };
    return read.binary ? { ...read, bytes } : read;
  }
  const module = await getSourceWorkerModule();
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob([XLSX_WORKER_SOURCE], { type: 'text/javascript' }));
  let worker: Worker;
  try { worker = new Worker(url); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: DispatchedSourceRead): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      // idle 인스턴스를 보관하지 않아 축소되지 않는 WASM memory를 실제로 반환합니다.
      worker.terminate();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const abort = (): void => finish(new DOMException('Source computation aborted.', 'AbortError'));
    const timer = window.setTimeout(() => finish(new Error('Source worker time budget exceeded.')), 60_000);
    worker.onmessage = (event: MessageEvent<{ protocol?: string; ok?: boolean; json?: string; bytes?: Uint8Array<ArrayBuffer> }>) => {
      try {
        if ((operation === 'source-read' || operation === 'source-finish') && event.data.protocol !== 'source-preparation-v1') throw new Error('Source worker requires regeneration.');
        const result: unknown = JSON.parse(event.data.json ?? 'null');
        if (event.data.ok !== true || !isRustSourceReadResult(result, preparation)) throw new Error('Invalid source worker response.');
        if (result.binary && (!(event.data.bytes instanceof Uint8Array) || event.data.bytes.byteLength === 0 || event.data.bytes.byteLength > 128 * 1024 * 1024)) throw new Error('Missing source input ownership.');
        finish(undefined, result.binary ? { ...result, bytes: event.data.bytes } : result);
      } catch { finish(new Error('Source worker failed.')); }
    };
    worker.onerror = () => finish(new Error('Source worker failed.'));
    worker.onmessageerror = () => finish(new Error('Source worker response failed.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ protocol: 'source-preparation-v1', operation, bytes, extension, module, preparation, source } satisfies SourceWorkerRequest, [bytes.buffer]); }
    catch { finish(new Error('Source worker dispatch failed.')); }
  });
}
