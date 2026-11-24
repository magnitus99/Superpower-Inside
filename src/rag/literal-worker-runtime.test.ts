import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanLiteralSource, type LiteralSourceIO } from './literal-worker-runtime';
import { createLiteralWorkerHandler, type LiteralWorkerResponse } from './literal-worker-entry';
import { RustLiteralSourceScanner, type LiteralPage, type LiteralScannerInput, type LiteralSourceBlock } from './literal-core';
import { createContentHashRust, planSourceBodyRust, decodeSourceBytesRust } from './rust-core';
import { dispatchSourceRead, getSourceDispatchSnapshot } from './source-worker-runtime';
import { XLSX_WORKER_SOURCE } from '../../.local/generated/xlsx-worker-source';

function fixture(text = '항구시험의 항구시험은 항구시험을 항구시험이', needles = ['항구시험']) {
  const plan = planSourceBodyRust(text);
  if (!plan) throw new Error('합성 bodyPlan 필요');
  const input: Omit<LiteralScannerInput, 'maxChargeBytes'> = { version: 1, needles, source: { path: 'synthetic/source.txt', contentHash: createContentHashRust(text) ?? '', sourceMetadataHash: 'aaaaaaaa', sourceMtime: 10.25, sourceSize: plan.byteLength, version: 1, byteLength: plan.byteLength, utf16Length: plan.utf16Length, blockCount: plan.blocks.length, scanChargeBytes: plan.scanChargeBytes, segments: [{ startLine: 0, endLine: 0 }] } };
  const pages: LiteralPage[] = [];
  const io: { readBlock: (index: number) => Promise<LiteralSourceBlock | null>; writePage: (page: LiteralPage) => Promise<void> } = { readBlock: vi.fn((index: number) => Promise.resolve(plan.blocks[index] ? { index, ...plan.blocks[index], text: text.slice(plan.blocks[index].startUtf16, plan.blocks[index].endUtf16) } : null)), writePage: vi.fn((page: LiteralPage) => { pages.push(page); return Promise.resolve(); }) };
  return { input, io, pages, plan };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

// 실제 handler/WASM의 합성 RPC이며 실제 브라우저 Worker 실행 증거가 아닙니다.
function browser(change?: (response: LiteralWorkerResponse) => unknown, postThrow = false) {
  const workers: FakeWorker[] = [];
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob as Blob); return 'blob:literal'; });
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    handler = createLiteralWorkerHandler((response) => {
      const data = change ? change(response) : response;
      if (data !== undefined) this.onmessage?.({ data } as MessageEvent);
    });
    constructor() { workers.push(this); }
    postMessage(request: unknown): void {
      if (typeof request === 'object' && request !== null && 'operation' in request && request.operation === 'source-decode' && 'bytes' in request && request.bytes instanceof Uint8Array) {
        this.onmessage?.({ data: { ok: true, json: JSON.stringify({ ...decodeSourceBytesRust(request.bytes), format: 'text', segments: [] }) } } as MessageEvent);
      } else this.handler(request);
      if (postThrow) throw new Error('private raw error');
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return { workers, revoked, blobs };
}
afterEach(async () => { await vi.waitFor(() => { const snapshot = getSourceDispatchSnapshot(); if (snapshot.supported) expect(snapshot.active).toBe(0); }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('literal 비동기 host 계약', () => {
  it('contract: 독립 scanLiteralSource 런타임 파일이 존재한다 (의미 RED와 구분)', () => {
    expect(existsSync(new URL('./literal-worker-runtime.ts', import.meta.url))).toBe(true);
    expect(scanLiteralSource).toBeTypeOf('function');
  });
  it('actual Node WASM: Korean4/NFKC/CR/same-span2를 IO로 전달하고 계측을 위장하지 않는다', async () => {
    vi.stubGlobal('Worker', undefined); vi.stubGlobal('document', undefined);
    const value = fixture('항구시험의 항구시험은 항구시험을 항구시험이\nＣＯＮＤＩＴＩＯＮ ﬃ\r', ['항구시험', 'condition', 'f', '\r']);
    const summary = await scanLiteralSource(value.input, value.io);
    expect(summary.needles.map((needle) => needle.occurrences)).toEqual([4, 1, 2, 1]);
    const expanded = value.pages.flatMap((page) => page.references).filter((ref) => ref.needleIndex === 2);
    expect(expanded).toHaveLength(2); expect(expanded[0].utf16Start).toBe(expanded[1].utf16Start);
    expect(expanded[0].normalizedStart).not.toBe(expanded[1].normalizedStart);
    expect(value.pages[0].references[0]).toMatchObject({ line: 1, sourceSegments: [0] });
    expect(value.io.readBlock).toHaveBeenCalledTimes(value.plan.blocks.length);
    expect(getSourceDispatchSnapshot()).toMatchObject({ supported: false, active: null, reservedBytes: null });
  });
  it('actual Node WASM: longline 두 block을 한 행으로 scan하고 페이지 저장을 기다린다', async () => {
    const value = fixture('a'.repeat(65535) + 'needle', ['needle']);
    expect(value.plan.blocks).toHaveLength(2);
    const written = deferred<void>();
    value.io.writePage = vi.fn(() => written.promise);
    let done = false;
    const scanning = scanLiteralSource(value.input, value.io).then((summary) => { done = true; return summary; });
    await vi.waitFor(() => expect(value.io.writePage).toHaveBeenCalledOnce());
    expect(done).toBe(false); written.resolve();
    expect((await scanning).needles[0].occurrences).toBe(1);
    expect(value.io.readBlock).toHaveBeenNthCalledWith(1, 0); expect(value.io.readBlock).toHaveBeenNthCalledWith(2, 1);
  });
  it('actual Node WASM: metadata-only empty는 writer 없이 완전 0', async () => {
    const value = fixture('', ['needle']);
    expect((await scanLiteralSource(value.input, value.io)).needles[0].occurrences).toBe(0);
    expect(value.io.readBlock).not.toHaveBeenCalled(); expect(value.io.writePage).not.toHaveBeenCalled();
  });
  it.each(['node', 'browser'] as const)('허용 needle의 정규화 확장 summary는 page 한도로 자르지 않는다 (%s)', async (environment) => {
    if (environment === 'browser') browser();
    else { vi.stubGlobal('Worker', undefined); vi.stubGlobal('document', undefined); }
    const value = fixture('', Array.from({ length: 16 }, () => '\ufdfa'.repeat(4096)));
    const summary = await scanLiteralSource(value.input, value.io);
    expect(summary.needles).toHaveLength(16);
    expect(summary.needles.every((item) => item.normalizedNeedle.length > 65536 && item.occurrences === 0)).toBe(true);
    expect(value.io.readBlock).not.toHaveBeenCalled(); expect(value.io.writePage).not.toHaveBeenCalled();
  });
  it.each([NaN, -1, 0.5, Number.MAX_SAFE_INTEGER, 256 * 1024 * 1024 - 16 * 1024 * 1024 + 1])('예약 범위 %s는 IO 전에 memory-budget', async (charge) => {
    const value = fixture(); value.input.source.scanChargeBytes = charge;
    await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'memory-budget' });
    expect(value.io.readBlock).not.toHaveBeenCalled();
  });
  it('DOM에 Worker가 없으면 메인 계산 없이 fixed worker-unavailable', async () => {
    vi.stubGlobal('document', {}); vi.stubGlobal('Worker', undefined);
    const value = fixture();
    await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-unavailable' });
    expect(value.io.readBlock).not.toHaveBeenCalled();
  });
  it('기존 exact XLSX 자산과 공유 예약을 쓰고 256개/1MiB씩 ACK 후 저장한다', async () => {
    const state = browser(); const value = fixture('x '.repeat(300), ['x']);
    expect((await scanLiteralSource(value.input, value.io)).needles[0].occurrences).toBe(300);
    expect(value.pages.map((page) => page.references.length)).toEqual([256, 44]);
    expect(await state.blobs[0].text()).toBe(XLSX_WORKER_SOURCE);
    expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
  });
  it('append ACK 전에 다음 raw block을 읽지 않고 writer 정착 전에 summary RPC를 보내지 않는다', async () => {
    let appendAck: LiteralWorkerResponse | undefined; const operations: string[] = [];
    const state = browser((response) => { operations.push(response.operation); if (response.operation === 'append' && !appendAck) { appendAck = response; return undefined; } return response; });
    const value = fixture('a'.repeat(65535) + 'needle', ['needle']); const hold = deferred<void>(); value.io.writePage = vi.fn(() => hold.promise);
    const scanning = scanLiteralSource(value.input, value.io);
    await vi.waitFor(() => expect(appendAck).toBeDefined()); expect(value.io.readBlock).toHaveBeenCalledOnce();
    state.workers[0].onmessage?.({ data: appendAck } as MessageEvent);
    await vi.waitFor(() => expect(value.io.writePage).toHaveBeenCalledOnce());
    expect(value.io.readBlock).toHaveBeenCalledTimes(2); expect(operations).toEqual(['init', 'append', 'append', 'seal', 'page']);
    hold.resolve(); await scanning; expect(operations.at(-1)).toBe('summary');
  });
  it('응답 없는 RPC timeout도 worker/URL/예약을 회수한다', async () => {
    const state = browser(() => undefined); const value = fixture(); vi.useFakeTimers();
    try {
      const rejected = expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
      await vi.advanceTimersByTimeAsync(60_001); await rejected;
      expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce(); expect(value.io.readBlock).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('held BG + literal FG는 두 슬롯을 공유하고 FG FIFO가 다음 BG보다 먼저다', async () => {
    browser(); const bgHold = deferred<Uint8Array<ArrayBuffer>>(); const order: string[] = [];
    const background = dispatchSourceRead('source-decode', () => bgHold.promise, 'txt', { inputBytes: 1, priority: 'background' });
    await vi.waitFor(() => expect(getSourceDispatchSnapshot()).toMatchObject({ active: 1 }));
    const hold = deferred<void>(); const first = fixture(); first.io.writePage = () => hold.promise;
    const one = scanLiteralSource(first.input, first.io);
    await vi.waitFor(() => expect(getSourceDispatchSnapshot()).toMatchObject({ active: 2, reservedBytes: 8 * 1024 * 1024 + 4 + first.input.source.scanChargeBytes + 16 * 1024 * 1024 }));
    const start = (label: string) => { const value = fixture(); const read = value.io.readBlock; value.io.readBlock = (index) => { order.push(label); return read(index); }; return scanLiteralSource(value.input, value.io); };
    const bg2 = dispatchSourceRead('source-decode', () => { order.push('BG'); return Promise.resolve(new Uint8Array([65])); }, 'txt', { inputBytes: 1, priority: 'background' });
    const two = start('FG2'); const three = start('FG3');
    expect(getSourceDispatchSnapshot()).toMatchObject({ queuedForeground: 2 });
    hold.resolve(); await one; await two; await three;
    expect(order).toEqual(['FG2', 'FG3']); bgHold.resolve(new Uint8Array([65])); await background; await bg2;
    expect(order).toEqual(['FG2', 'FG3', 'BG']);
  });
  it('queued abort는 block을 읽지 않고 제거하며 active read abort는 IO 정착까지 예약/Promise를 보존한다', async () => {
    const state = browser(); const value = fixture(); value.input.source.scanChargeBytes = 240 * 1024 * 1024;
    const readHold = deferred<Awaited<ReturnType<LiteralSourceIO['readBlock']>>>();
    const original = await value.io.readBlock(0); value.io.readBlock = vi.fn(() => readHold.promise);
    const controller = new AbortController(); const active = scanLiteralSource(value.input, value.io, controller.signal);
    const activeRejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(value.io.readBlock).toHaveBeenCalledOnce());
    const queued = fixture(); const queuedController = new AbortController();
    const queuedRejected = expect(scanLiteralSource(queued.input, queued.io, queuedController.signal)).rejects.toMatchObject({ name: 'AbortError' });
    queuedController.abort(); await queuedRejected; expect(queued.io.readBlock).not.toHaveBeenCalled();
    let settled = false; void active.then(() => { settled = true; }, () => { settled = true; });
    controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
    expect(getSourceDispatchSnapshot()).toMatchObject({ active: 1, reservedBytes: 256 * 1024 * 1024, queuedForeground: 0 });
    readHold.resolve(original); await activeRejected;
    expect(state.workers[0].terminate).toHaveBeenCalledOnce();
    await expect(dispatchSourceRead('source-decode', () => Promise.resolve(new Uint8Array([65])), 'txt', { inputBytes: 1 })).resolves.toMatchObject({ text: 'A' });
  });
  it('active uncancellable writer와 reentrant abort 뒤 summary를 게시하지 않는다', async () => {
    browser(); const value = fixture(); const hold = deferred<void>(); const controller = new AbortController();
    value.io.writePage = vi.fn(() => { controller.abort(); return hold.promise; });
    const rejected = expect(scanLiteralSource(value.input, value.io, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(value.io.writePage).toHaveBeenCalledOnce());
    expect(getSourceDispatchSnapshot()).toMatchObject({ active: 1 }); hold.resolve(); await rejected;
  });
  it.each(['read', 'write', 'missing', 'hash'] as const)('%s 실패는 partial summary 없이 cleanup하고 다음 source를 실행한다', async (failure) => {
    const state = browser(); const value = fixture();
    if (failure === 'read') value.io.readBlock = () => { throw new Error('private callback'); };
    if (failure === 'write') value.io.writePage = () => { throw new Error('private callback'); };
    if (failure === 'missing') value.io.readBlock = () => Promise.resolve(null);
    if (failure === 'hash') value.input.source.contentHash = '00000000';
    await expect(scanLiteralSource(value.input, value.io)).rejects.toBeInstanceOf(Error);
    expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
    await expect(dispatchSourceRead('source-decode', () => Promise.resolve(new Uint8Array([65])), 'txt', { inputBytes: 1 })).resolves.toMatchObject({ text: 'A' });
  });
  it.each(['protocol', 'id', 'operation', 'malformed', 'raw-reason'] as const)('foreign/malformed %s ACK를 성공으로 무시하지 않는다', async (kind) => {
    const state = browser((response) => kind === 'malformed' ? null : kind === 'raw-reason' ? { ...response, ok: false, reason: 'private source path' } : { ...response, [kind]: kind === 'id' ? 999 : 'foreign' });
    const value = fixture(); await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    expect(value.io.readBlock).not.toHaveBeenCalled(); expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
  });
  it.each(['page', 'summary'] as const)('malformed native %s 성공 payload는 fixed worker-failed', async (operation) => {
    const state = browser((response) => response.operation === operation ? { ...response, json: '{"ok":true,"done":true,"references":[null]}' } : response);
    const value = fixture();
    await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
  });
  it.each(['terminate', 'revoke'] as const)('%s throw도 양쪽 cleanup을 시도하고 fixed worker-failed 및 다음 source 실행', async (cleanup) => {
    const state = browser(); const value = fixture(); const hold = deferred<void>();
    value.io.writePage = vi.fn(() => hold.promise);
    const scanning = scanLiteralSource(value.input, value.io);
    const rejected = expect(scanning).rejects.toMatchObject({ reason: 'worker-failed' });
    await vi.waitFor(() => expect(value.io.writePage).toHaveBeenCalledOnce());
    if (cleanup === 'terminate') state.workers[0].terminate.mockImplementation(() => { throw new Error('private cleanup path'); });
    else state.revoked.mockImplementationOnce(() => { throw new Error('private cleanup path'); });
    hold.resolve(); await rejected; expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
    await expect(dispatchSourceRead('source-decode', () => Promise.resolve(new Uint8Array([65])), 'txt', { inputBytes: 1 })).resolves.toMatchObject({ text: 'A' });
  });
  it('actual Node: read 직후 재진입 abort는 append/다음 block 없이 class를 닫는다', async () => {
    vi.stubGlobal('Worker', undefined); vi.stubGlobal('document', undefined);
    const close = vi.spyOn(RustLiteralSourceScanner.prototype, 'close'); const append = vi.spyOn(RustLiteralSourceScanner.prototype, 'appendBlock');
    const value = fixture('a'.repeat(65536) + 'needle', ['needle']); const read = value.io.readBlock; const controller = new AbortController();
    value.io.readBlock = vi.fn((index: number) => { const block = read(index); controller.abort(); return block; });
    await expect(scanLiteralSource(value.input, value.io, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(value.io.readBlock).toHaveBeenCalledOnce(); expect(append).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });
  it('actual Node: callback throw도 scanner를 닫는다', async () => {
    vi.stubGlobal('Worker', undefined); vi.stubGlobal('document', undefined);
    const close = vi.spyOn(RustLiteralSourceScanner.prototype, 'close'); const value = fixture();
    value.io.writePage = () => { throw new Error('synthetic writer'); };
    await expect(scanLiteralSource(value.input, value.io)).rejects.toThrow('synthetic writer'); expect(close).toHaveBeenCalledOnce();
  });
  it('이전 ACK가 uncancellable read 중 도착해도 다음 RPC를 성공시키지 않는다', async () => {
    const state = browser(); const value = fixture(); const block = await value.io.readBlock(0); const hold = deferred<typeof block>();
    value.io.readBlock = vi.fn(() => hold.promise);
    const rejected = expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    await vi.waitFor(() => expect(value.io.readBlock).toHaveBeenCalledOnce());
    state.workers[0].onmessage?.({ data: { protocol: 'literal-source-v1', id: 1, operation: 'init', ok: true, json: '{"ok":true}' } } as MessageEvent);
    hold.resolve(block); await rejected; expect(state.workers[0].terminate).toHaveBeenCalledOnce();
  });
  it.each(['onerror', 'onmessageerror'] as const)('Worker %s 뒤 uncancellable read 정착 전에는 예약을 해제하지 않는다', async (event) => {
    const state = browser(); const value = fixture(); const block = await value.io.readBlock(0); const hold = deferred<typeof block>(); value.io.readBlock = vi.fn(() => hold.promise);
    const rejected = expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    await vi.waitFor(() => expect(value.io.readBlock).toHaveBeenCalledOnce()); state.workers[0][event]?.();
    expect(getSourceDispatchSnapshot()).toMatchObject({ active: 1 }); hold.resolve(block); await rejected;
    expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
  });
  it('constructor 실패도 URL을 회수하고 read를 시작하지 않는다', async () => {
    const state = browser(); vi.stubGlobal('Worker', class { constructor() { throw new Error('private constructor'); } }); const value = fixture();
    await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    expect(state.revoked).toHaveBeenCalledOnce(); expect(value.io.readBlock).not.toHaveBeenCalled();
  });
  it('sync ACK 뒤 postMessage throw는 성공 init/read로 취급하지 않는다', async () => {
    const state = browser(undefined, true); const value = fixture();
    await expect(scanLiteralSource(value.input, value.io)).rejects.toMatchObject({ reason: 'worker-failed' });
    expect(value.io.readBlock).not.toHaveBeenCalled(); expect(state.workers[0].terminate).toHaveBeenCalledOnce(); expect(state.revoked).toHaveBeenCalledOnce();
  });
});
