import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchSourceRead, getSourceDispatchSnapshot } from './source-worker-runtime';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import { decodeSourceBytesRust, prepareSourceBytesRust } from './rust-core';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('source Rust dispatch', () => {
  it('readonly snapshot은 Node 미계측을 unknown으로 내보내고 예약·FG 큐·실제 load 수명을 그대로 읽는다', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('document', undefined);
    expect(getSourceDispatchSnapshot()).toEqual({ supported: false, queuedForeground: null, active: null, reservedBytes: null, budgetBytes: null });
    vi.stubGlobal('Worker', class {});
    const controller = new AbortController();
    let release!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const reading = dispatchSourceRead('source-decode', () => new Promise((resolve) => { release = resolve; }), 'txt', { inputBytes: 64 * 1024 * 1024, priority: 'background', signal: controller.signal });
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const queuedController = new AbortController();
    const queued = dispatchSourceRead('source-decode', () => Promise.reject(new Error('전송되면 안 됨')), 'txt', { inputBytes: 1, signal: queuedController.signal });
    const queuedRejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(getSourceDispatchSnapshot()).toEqual({ supported: true, queuedForeground: 1, active: 1, reservedBytes: 264 * 1024 * 1024, budgetBytes: 256 * 1024 * 1024 });
    controller.abort(); await rejected;
    expect(getSourceDispatchSnapshot()).toMatchObject({ active: 1, reservedBytes: 264 * 1024 * 1024 });
    queuedController.abort(); await queuedRejected;
    expect(getSourceDispatchSnapshot()).toMatchObject({ queuedForeground: 0, active: 1 });
    release(new Uint8Array([65]));
    await vi.waitFor(() => expect(getSourceDispatchSnapshot()).toEqual({ supported: true, queuedForeground: 0, active: 0, reservedBytes: 0, budgetBytes: 256 * 1024 * 1024 }));
  });
  it('같은 source 작업에서 본문 hash·원장 signature·청크를 한 번 준비한다', async () => {
    const result = await dispatchSourceRead('source-read', () => Promise.resolve(new TextEncoder().encode('# Alpha\n\n합성 evidence')), 'md', {
      preparation: { path: 'synthetic.md', chunkSize: 1000, overlap: 20 },
    });
    expect(result).toMatchObject({ ok: true, text: '# Alpha\n\n합성 evidence' });
    expect(result.prepared?.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.prepared?.sourceMetadataHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.prepared?.chunks?.[0]?.chunkHash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.prepared?.sourceMetadataBytes).toBeGreaterThan(0);
    expect(result.prepared?.chunks).toMatchObject([{ text: '# Alpha\n\n합성 evidence' }]);
  });
  it('Node도 같은 Rust decoder를 사용하고 foreground가 다음 background보다 먼저 실행된다', async () => {
    await expect(dispatchSourceRead('source-decode', () => Promise.resolve(new TextEncoder().encode('native Rust')), 'txt', {})).resolves.toMatchObject({ text: 'native Rust' });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:priority');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      terminate(): void { /* 합성 작업자는 외부 자원을 소유하지 않습니다. */ }
      postMessage(request: { bytes: Uint8Array }): void {
        queueMicrotask(() => this.onmessage?.({ data: { ok: true, json: JSON.stringify({ ...decodeSourceBytesRust(request.bytes), format: 'text', segments: [] }) } } as MessageEvent));
      }
    });
    const order: string[] = [];
    let release!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const first = dispatchSourceRead('source-decode', () => new Promise((resolve) => { release = resolve; }), 'txt', { priority: 'background' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const load = (label: string) => (): Promise<Uint8Array<ArrayBuffer>> => { order.push(label); return Promise.resolve(new TextEncoder().encode(label)); };
    const background = dispatchSourceRead('source-decode', load('background'), 'txt', { priority: 'background' });
    const foreground = dispatchSourceRead('source-decode', load('foreground'), 'txt', {});
    release(new TextEncoder().encode('first'));
    await expect(first).resolves.toMatchObject({ ok: true, text: 'first' });
    await Promise.all([background, foreground]);
    expect(order).toEqual(['foreground', 'background']);
  });

  it('실제 load가 남은 BG 하나는 보존하고 다른 슬롯은 foreground에 남긴다', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reserved-foreground');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      terminate(): void { /* 합성 worker는 외부 자원을 소유하지 않습니다. */ }
      postMessage(request: { bytes: Uint8Array }): void {
        queueMicrotask(() => this.onmessage?.({ data: { ok: true, json: JSON.stringify({ ...decodeSourceBytesRust(request.bytes), format: 'text', segments: [] }) } } as MessageEvent));
      }
    });
    let release!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const controller = new AbortController();
    const first = dispatchSourceRead('source-decode', () => new Promise((resolve) => { release = resolve; }), 'txt', { inputBytes: 1, priority: 'background', signal: controller.signal });
    const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const backgroundLoad = vi.fn(() => Promise.resolve(new TextEncoder().encode('background')));
    const background = dispatchSourceRead('source-decode', backgroundLoad, 'txt', { inputBytes: 1, priority: 'background' });
    try {
      for (let turn = 0; turn < 6; turn++) await Promise.resolve();
      expect(backgroundLoad).not.toHaveBeenCalled();
      const foregroundLoad = vi.fn(() => Promise.resolve(new TextEncoder().encode('foreground')));
      await expect(dispatchSourceRead('source-decode', foregroundLoad, 'txt', { inputBytes: 1 })).resolves.toMatchObject({ text: 'foreground' });
      expect(foregroundLoad).toHaveBeenCalledOnce();
      expect(backgroundLoad).not.toHaveBeenCalled();
      controller.abort();
      await firstRejected;
      expect(backgroundLoad).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      release(new Uint8Array([65]));
      await firstRejected;
      await expect(background).resolves.toMatchObject({ text: 'background' });
      await vi.waitFor(() => expect(getSourceDispatchSnapshot()).toMatchObject({ active: 0, reservedBytes: 0 }));
    }
  });

  it('실제 worker에 컴파일된 WASM과 transferable 입력을 전달한다', async () => {
    const result = await build({ entryPoints: ['src/rag/xlsx-worker-entry.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
    const source = result.outputFiles[0].text;
    const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: (data, options) => parentPort.postMessage(data, options?.transfer) }; ${source}; parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
    try {
      const module = await WebAssembly.compile(Uint8Array.from(atob(RAG_WASM_BASE64), (char) => char.charCodeAt(0)));
      const bytes = new TextEncoder().encode('alpha 원문');
      const response = new Promise<{ ok: boolean; json: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      worker.postMessage({ operation: 'source-decode', module, bytes }, [bytes.buffer]);
      expect(bytes.byteLength).toBe(0);
      const message = await response;
      expect(message.ok).toBe(true);
      expect(JSON.parse(message.json)).toMatchObject({ ok: true, text: 'alpha 원문', segments: [] });
    } finally { await worker.terminate(); }
  });

  it('현재 source wire는 실제 WASM 준비와 PDF 입력 소유권 반환을 실행한다', async () => {
    const bundled = await build({ entryPoints: ['src/rag/xlsx-worker-entry.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
    const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: (data, options) => parentPort.postMessage(data, options?.transfer) }; ${bundled.outputFiles[0].text}; parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
    try {
      const module = await WebAssembly.compile(Uint8Array.from(atob(RAG_WASM_BASE64), (char) => char.charCodeAt(0)));
      const send = (bytes: Uint8Array<ArrayBuffer>, extension: string): Promise<{ ok: boolean; json: string; bytes?: Uint8Array }> => {
        const response = new Promise<{ ok: boolean; json: string; bytes?: Uint8Array }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
        worker.postMessage({ protocol: 'source-preparation-v1', operation: 'source-read', module, bytes, extension, preparation: { path: `synthetic.${extension}`, chunkSize: 1000, overlap: 20 } }, [bytes.buffer]);
        expect(bytes.byteLength).toBe(0);
        return response;
      };
      const plain = await send(new TextEncoder().encode('plain 𐀀 evidence'), 'docx');
      expect(plain.ok).toBe(true);
      const prepared: unknown = JSON.parse(plain.json);
      expect(prepared).toMatchObject({ text: 'plain 𐀀 evidence', prepared: { chunks: [{ text: 'plain 𐀀 evidence' }] } });
      const input = new TextEncoder().encode('%PDF-1.7\nsynthetic binary\n%%EOF');
      const pdf = await send(input, 'pdf');
      expect(pdf.ok).toBe(true);
      expect(JSON.parse(pdf.json)).toMatchObject({ binary: true, text: '' });
      expect(pdf.bytes).toEqual(new TextEncoder().encode('%PDF-1.7\nsynthetic binary\n%%EOF'));
    } finally { await worker.terminate(); }
  });

  it.each([
    ['source-read', 'charge'], ['source-read', 'chunks'], ['source-finish', 'charge'], ['source-finish', 'chunks'],
  ] as const)('운영 %s 응답은 요청의 %s cap을 넘는 정상 형식 결과를 거절한다', async (operation, limit) => {
    const result = prepareSourceBytesRust('md', new TextEncoder().encode('synthetic bounded source '.repeat(100)), { path: 'synthetic.md', chunkSize: 100, overlap: 20 });
    if (!result?.prepared?.chunks) throw new Error('합성 준비 결과가 필요합니다.');
    expect(result.prepared.chargeBytes).toBeGreaterThan(0);
    expect(result.prepared.chunks.length).toBeGreaterThan(0);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:over-cap');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const terminated = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      terminate = terminated;
      postMessage(): void {
        queueMicrotask(() => this.onmessage?.({ data: { protocol: 'source-preparation-v1', ok: true, json: JSON.stringify(result) } } as MessageEvent));
      }
    });
    await expect(dispatchSourceRead(operation, () => Promise.resolve(new Uint8Array([65])), 'md', {
      inputBytes: 1,
      preparation: { path: 'synthetic.md', maxChargeBytes: result.prepared.chargeBytes, maxPreparedChunks: result.prepared.chunks.length },
    }, result)).resolves.toMatchObject({ prepared: { chargeBytes: result.prepared.chargeBytes } });
    const reading = dispatchSourceRead(operation, () => Promise.resolve(new Uint8Array([65])), 'md', {
      inputBytes: 1,
      preparation: { path: 'synthetic.md', ...(limit === 'charge' ? { maxChargeBytes: 0 } : { maxPreparedChunks: 0 }) },
    }, result);
    await expect(reading).rejects.toThrow('Source worker failed.');
    expect(terminated).toHaveBeenCalledTimes(2);
  });

  it('현재 XLSX entry는 빈 시트 metadataParts를 인용 segment와 분리해 transfer한다', async () => {
    const result = await build({ entryPoints: ['src/rag/xlsx-worker-entry.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
    const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: (data, options) => parentPort.postMessage(data, options?.transfer) }; ${result.outputFiles[0].text}; parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
    try {
      const bytes = zipSync({ 'xl/worksheets/sheet1.xml': strToU8('<worksheet><row><c r="B2"/></row></worksheet>') });
      const response = new Promise<{ ok: boolean; bytes: Uint8Array; segmentsJson: string; metadataPartsJson: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      worker.postMessage({ bytes, wasmBase64: RAG_WASM_BASE64 }, [bytes.buffer]);
      const message = await response;
      expect(message).toMatchObject({ ok: true });
      expect(message.bytes.byteLength).toBe(0);
      expect(JSON.parse(message.segmentsJson)).toEqual([]);
      expect(JSON.parse(message.metadataPartsJson)).toMatchObject([{ sourcePart: 'xl/worksheets/sheet1.xml', locator: { cells: [{ address: 'B2' }] } }]);
      expect(JSON.parse(message.metadataPartsJson)).not.toHaveProperty('0.startLine');
    } finally { await worker.terminate(); }
  });

  it('취소 소비자는 즉시 거절해도 실제 원문 읽기가 끝날 때까지 admission 예약을 유지한다', async () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    const loads: Array<(bytes: Uint8Array<ArrayBuffer>) => void> = [];
    const load = vi.fn(() => new Promise<Uint8Array<ArrayBuffer>>((resolve) => { loads.push(resolve); }));
    try {
      for (let index = 0; index < 4; index++) {
        const controller = new AbortController();
        const reading = dispatchSourceRead('source-decode', load, 'txt', { signal: controller.signal, inputBytes: 64 * 1024 * 1024 });
        const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
        await Promise.resolve();
        controller.abort();
        await rejected;
      }
      expect(load).toHaveBeenCalledOnce();
      expect(worker).not.toHaveBeenCalled();
    } finally {
      for (const resolve of loads) resolve(new TextEncoder().encode('late bytes'));
      const controller = new AbortController();
      const resumed = dispatchSourceRead('source-decode', () => {
        controller.abort();
        return Promise.resolve(new Uint8Array([65]));
      }, 'txt', { signal: controller.signal, inputBytes: 1 });
      await expect(resumed).rejects.toMatchObject({ name: 'AbortError' });
    }
  });

  it('운영 worker 실패는 메인 Rust 재실행 없이 거절하고 취소·timeout도 작업자를 회수한다', async () => {
    const workers: Array<{ terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent) => void) | null; onerror: (() => void) | null }> = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('Worker', class {
      terminate = vi.fn();
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      postMessage = vi.fn();
      constructor() { workers.push(this); }
    });
    const failed = dispatchSourceRead('source-decode', () => Promise.resolve(new TextEncoder().encode('not fallback')), 'txt', {});
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const failedAssertion = expect(failed).rejects.toThrow('Source worker failed');
    workers[0].onerror?.();
    await failedAssertion;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const cancelled = dispatchSourceRead('source-decode', () => Promise.resolve(new TextEncoder().encode('cancel')), 'txt', { signal: controller.signal });
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    controller.abort();
    await cancelledAssertion;
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    const timed = dispatchSourceRead('source-decode', () => Promise.resolve(new TextEncoder().encode('timeout')), 'txt', {});
    const timedAssertion = expect(timed).rejects.toThrow('time budget');
    await vi.advanceTimersByTimeAsync(60_001);
    await timedAssertion;
    expect(workers[2].terminate).toHaveBeenCalledOnce();
  });
});
