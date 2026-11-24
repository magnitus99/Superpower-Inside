import { XLSX_WORKER_SOURCE } from '../../.local/generated/xlsx-worker-source';
import { LiteralCoreError, RustLiteralSourceScanner, parseLiteralPage, parseLiteralSummary, type LiteralScannerInput, type LiteralSourceBlock, type LiteralPage, type LiteralSourceSummary } from './literal-core';
import { dispatchLiteralSourceTask, getSourceWorkerModule } from './source-worker-runtime';
import type { LiteralWorkerCommand, LiteralWorkerRequest } from './literal-worker-entry';

export interface LiteralSourceIO {
  readBlock(index: number): Promise<LiteralSourceBlock | null>;
  writePage(page: LiteralPage): Promise<void>;
}
interface Scanner {
  appendBlock(block: LiteralSourceBlock): void | Promise<void>;
  seal(): void | Promise<void>;
  nextPage(maxMatches: number, maxBytes: number): LiteralPage | Promise<LiteralPage>;
  summary(): LiteralSourceSummary | Promise<LiteralSourceSummary>;
  close(): void;
}
const OVERHEAD = 16 * 1024 * 1024;
const BUDGET = 256 * 1024 * 1024;

/** 반환 Promise는 원문 I/O·페이지 저장·worker 회수가 모두 정착한 source 하나의 물리 수명입니다. */
export async function scanLiteralSource(input: Omit<LiteralScannerInput, 'maxChargeBytes'>, io: LiteralSourceIO, signal?: AbortSignal): Promise<LiteralSourceSummary> {
  signal?.throwIfAborted();
  const charge = input.source.scanChargeBytes;
  if (!Number.isSafeInteger(charge) || charge < 0 || charge > BUDGET - OVERHEAD) throw new LiteralCoreError('memory-budget');
  // 작은 header만 고정하며 raw 본문은 admission 안에서 block별로 읽습니다.
  const request: LiteralScannerInput = { ...input, needles: [...input.needles], source: { ...input.source, segments: input.source.segments.map((segment) => ({ ...segment })) }, maxChargeBytes: charge + OVERHEAD };
  return dispatchLiteralSourceTask(request.maxChargeBytes, async () => {
    let scanner: Scanner | undefined;
    try {
      signal?.throwIfAborted();
      if (typeof Worker === 'undefined') {
        if (typeof document !== 'undefined') throw new LiteralCoreError('worker-unavailable');
        scanner = new RustLiteralSourceScanner(request);
      } else scanner = await openWorker(request, signal);
      signal?.throwIfAborted();
      for (let index = 0; index < request.source.blockCount; index++) {
        signal?.throwIfAborted();
        const block = await io.readBlock(index);
        signal?.throwIfAborted();
        if (!block) throw new LiteralCoreError('incomplete-input');
        await scanner.appendBlock(block);
        signal?.throwIfAborted();
      }
      await scanner.seal();
      signal?.throwIfAborted();
      for (;;) {
        const page = await scanner.nextPage(256, 1024 * 1024);
        signal?.throwIfAborted();
        if (page.references.length > 0) {
          await io.writePage(page);
          signal?.throwIfAborted();
        }
        if (page.done) break;
      }
      const summary = await scanner.summary();
      signal?.throwIfAborted();
      return summary;
    } finally { scanner?.close(); }
  }, signal);
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function failed(): LiteralCoreError { return new LiteralCoreError('worker-failed'); }

async function openWorker(input: LiteralScannerInput, signal?: AbortSignal): Promise<Scanner> {
  let module: WebAssembly.Module;
  try { module = await getSourceWorkerModule(); } catch { throw failed(); }
  signal?.throwIfAborted();
  let url: string;
  try { url = URL.createObjectURL(new Blob([XLSX_WORKER_SOURCE], { type: 'text/javascript' })); } catch { throw failed(); }
  let worker: Worker;
  try { worker = new Worker(url); } catch {
    try { URL.revokeObjectURL(url); } catch { throw failed(); }
    throw failed();
  }
  let id = 0;
  let broken = false;
  let closed = false;
  let receive: (value: unknown) => void = () => { broken = true; };
  let rejectPending: (error: Error) => void = () => { broken = true; };
  worker.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
  worker.onerror = worker.onmessageerror = () => rejectPending(failed());
  const close = (): void => {
    if (closed) return;
    closed = true;
    try {
      try { worker.terminate(); } finally { URL.revokeObjectURL(url); }
    } catch { throw failed(); }
  };
  const rpc = (command: LiteralWorkerCommand): Promise<string> => {
    const { operation } = command;
    signal?.throwIfAborted();
    if (broken || closed) return Promise.reject(failed());
    const currentId = ++id;
    return new Promise((resolve, reject) => {
      let settled = false;
      let posted = false;
      let early: unknown;
      let received = false;
      const finish = (error?: Error, json?: string): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        receive = () => { broken = true; };
        rejectPending = () => { broken = true; };
        if (error) { broken = true; reject(error); } else resolve(json ?? '');
      };
      const abort = (): void => finish(new DOMException('Literal scan aborted.', 'AbortError'));
      const timer = window.setTimeout(() => finish(failed()), 60_000);
      const accept = (value: unknown): void => {
        try {
          if (!record(value) || value.protocol !== 'literal-source-v1' || value.id !== currentId || value.operation !== operation || typeof value.ok !== 'boolean') throw failed();
          if (!value.ok) {
            try { parseLiteralSummary(JSON.stringify({ ok: false, reason: value.reason }), input); }
            catch (error) { if (error instanceof LiteralCoreError && error.reason !== 'invalid-response') throw error; }
            throw failed();
          }
          if (typeof value.json !== 'string' || value.json.length > (operation === 'summary' ? 16 * 1024 * 1024 : 1024 * 1024)) throw failed();
          if (operation === 'init' || operation === 'append' || operation === 'seal') {
            const ack: unknown = JSON.parse(value.json);
            if (!record(ack) || ack.ok !== true || Object.keys(ack).length !== 1) throw failed();
          }
          finish(undefined, value.json);
        } catch (error) { finish(error instanceof LiteralCoreError ? error : failed()); }
      };
      receive = (value) => {
        if (!posted) {
          if (received) { finish(failed()); return; }
          early = value; received = true;
        } else accept(value);
      };
      rejectPending = (error) => finish(error);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try {
        worker.postMessage({ protocol: 'literal-source-v1', id: currentId, ...command } satisfies LiteralWorkerRequest);
        posted = true;
        // 동기 fake ACK도 postMessage 정상 반환 전에 성공으로 정착시키지 않습니다.
        if (received) accept(early);
      } catch { finish(failed()); }
    });
  };
  try {
    await rpc({ operation: 'init', module, input });
    return {
      appendBlock: async (block) => { await rpc({ operation: 'append', block }); },
      seal: async () => { await rpc({ operation: 'seal' }); },
      nextPage: async (maxMatches, maxBytes) => {
        const json = await rpc({ operation: 'page', maxMatches, maxBytes });
        try { return parseLiteralPage(json, input, maxMatches); } catch { throw failed(); }
      },
      summary: async () => {
        const json = await rpc({ operation: 'summary' });
        try { return parseLiteralSummary(json, input); } catch { throw failed(); }
      },
      close,
    };
  } catch (error) { close(); throw error; }
}
