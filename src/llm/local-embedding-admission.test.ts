import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalEmbeddingAdmission,
  type LocalEmbeddingAdmissionIO,
} from './local-embedding-admission';
import {
  CachedEmbeddingProvider,
  EmbeddingGemmaProvider,
  TernlightEmbeddingProvider,
  type EmbeddingInferenceSample,
} from './embedding';
import {
  TernlightWorkerRuntime,
  type TernlightWorkerRequest,
  type TernlightWorkerResponse,
  type TernlightRuntimeOptions,
} from './ternlight-runtime';
import { dispatchSourceRead, getSourceDispatchSnapshot } from '../rag/source-worker-runtime';
import { subscribeEmbeddingGemmaStatus } from './embeddinggemma-status';
import { appLogger } from '../utils/logger';
import * as core from '../rag/rust-core';

const models = vi.hoisted(() => ({
  prepare: vi.fn(() => Promise.resolve()),
  read: vi.fn(() => Promise.resolve(new ArrayBuffer(1))),
}));
vi.mock('./local-embedding-models', () => ({ getLocalEmbeddingModels: () => models }));
vi.mock('../../.local/generated/embeddinggemma-assets', () => ({
  EMBEDDINGGEMMA_ASSETS: [{ file: 'embeddinggemma-worker.js' }, { file: 'model.bin' }],
}));
vi.mock('obsidian', () => ({
  requestUrl: () => {
    throw new Error('합성 검증에서 네트워크 금지');
  },
}));
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('Worker', class {}); // source 원장이 지원되는 호스트이며 실제 worker는 아래 대역만 사용한다.
  vi.stubGlobal('fetch', () => {
    throw new Error('합성 검증에서 네트워크 금지');
  });
});
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function clock() {
  let now = 1000;
  let next = 0;
  const timers = new Map<number, () => void>();
  const memory = vi.fn(() => ({ rssBytes: 1000, availableBytes: 1000000 }));
  const io: LocalEmbeddingAdmissionIO = {
    now: () => now,
    readMemory: memory,
    setTimer: (callback) => {
      const id = ++next;
      timers.set(id, callback);
      return () => {
        timers.delete(id);
      };
    },
  };
  return {
    io,
    memory,
    advance: (ms: number) => {
      now += ms;
    },
    tick: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    timers,
  };
}
const source = { sourceBudgetBytes: 10000, reservedSourceBytes: 200, plannedSourceBytes: 300 };
const counts = { foregroundPending: 0, physicalSourceCount: 0, physicalInferenceCount: 1 };
function worker() {
  let message: (event: MessageEvent<TernlightWorkerResponse>) => void = () => undefined;
  let error: (event: ErrorEvent) => void = () => undefined;
  const requests: TernlightWorkerRequest[] = [];
  const terminate = vi.fn();
  const post = vi.fn((request: TernlightWorkerRequest) => {
    requests.push(request);
  });
  const create = () => ({
    worker: {
      setOnMessage: (callback: typeof message) => {
        message = callback;
      },
      setOnError: (callback: typeof error) => {
        error = callback;
      },
      postMessage: post,
      terminate,
    },
    dispose: vi.fn(),
  });
  const respond = (response: TernlightWorkerResponse) =>
    message({ data: response } as MessageEvent<TernlightWorkerResponse>);
  return {
    create,
    requests,
    post,
    terminate,
    respond,
    fail: () => error({ message: '합성 오류' } as ErrorEvent),
    async request(index: number) {
      await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
      return requests[index];
    },
    async ack(index: number, dimensions = 2, backend?: 'wasm' | 'webgpu') {
      const request = await this.request(index);
      const rows = request.texts?.length ?? 0;
      respond({
        id: request.id,
        rows,
        dimensions,
        values: Float32Array.from(
          { length: rows * dimensions },
          (_, i) => (request.texts?.[Math.floor(i / dimensions)]?.length ?? 0) + (i % dimensions),
        ).buffer,
        backend,
      });
    },
  };
}
function options(
  w: ReturnType<typeof worker>,
  c: ReturnType<typeof clock>,
): TernlightRuntimeOptions {
  return {
    app: { vault: { configDir: '.synthetic' } } as App,
    pluginId: 'synthetic',
    pluginVersion: '1',
    createWorker: w.create,
    admissionIO: c.io,
  };
}
function owner(w: ReturnType<typeof worker>, c: ReturnType<typeof clock>) {
  const result = new TernlightEmbeddingProvider('ternlight-base', options(w, c));
  cleanup.push(() => result.close());
  return result;
}
async function busy(promise: Promise<void>) {
  const settled = vi.fn();
  void promise.then(settled);
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
}

describe('공개 readonly inference 관측', () => {
  it('16행 논리 BG는 실제 전송된 micro행 순서와 ACK 시각만 관측한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const samples: EmbeddingInferenceSample[] = [];
    const texts = Array.from({ length: 16 }, (_, i) => 'a'.repeat(i + 1));
    const work = raw.embedBatch(texts, { onInferenceSample: (sample) => samples.push(sample) });
    w.respond({ id: (await w.request(0)).id });
    let sent = 0;
    let index = 1;
    let endedAtMs = 1000;
    while (sent < 16) {
      const posted = await w.request(index);
      expect(posted.texts).toEqual(texts.slice(sent, sent + posted.texts!.length));
      const rows = posted.texts!.length;
      expect(samples).toHaveLength(index - 1);
      c.advance(1);
      c.tick();
      c.advance(9);
      endedAtMs += 10;
      await w.ack(index);
      expect(samples.at(-1)).toEqual({ backend: 'cpu', workUnits: rows, durationMs: 10, endedAtMs });
      sent += rows;
      index++;
    }
    const result = await work;
    expect(result.map((row) => row[0])).toEqual(texts.map((text) => text.length));
    expect(samples.reduce((sum, sample) => sum + sample.workUnits, 0)).toBe(16);
    expect(samples).toHaveLength(w.requests.length - 1);
    await raw.waitForIdle();
  });

  it('FG 큐 대기는 제외하고 active/queued 취소는 공개 표본 없이 실제 ACK까지 drain한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const bgSample = vi.fn();
    const fgSample = vi.fn();
    const cancelledSample = vi.fn();
    const bg = raw.embedBatch(['a'], { onInferenceSample: bgSample });
    w.respond({ id: (await w.request(0)).id });
    const activeBg = await w.request(1);
    const fg = raw.embed('bb', { onInferenceSample: fgSample });
    await busy(raw.waitForIdle());
    w.respond({
      id: activeBg.id + 1, rows: 1, dimensions: 2, values: new Float32Array(2).buffer,
    }); // queued FG의 미전송 ACK는 슬롯·관측을 건드리지 않는다.
    expect(bgSample).not.toHaveBeenCalled();
    expect(fgSample).not.toHaveBeenCalled();
    c.advance(1000);
    await w.ack(1);
    await bg;
    await w.request(2);
    c.advance(10);
    await w.ack(2);
    await fg;
    expect(bgSample).toHaveBeenCalledWith({
      backend: 'cpu', workUnits: 1, durationMs: 1000, endedAtMs: 2000,
    });
    expect(fgSample).toHaveBeenCalledWith({
      backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 2010,
    });
    const activeAbort = new AbortController();
    const active = expect(raw.embed('ccc', {
      signal: activeAbort.signal, onInferenceSample: cancelledSample,
    })).rejects.toMatchObject({ name: 'AbortError' });
    await w.request(3);
    const queuedAbort = new AbortController();
    const queued = expect(raw.embed('dddd', {
      signal: queuedAbort.signal, onInferenceSample: cancelledSample,
    })).rejects.toMatchObject({ name: 'AbortError' });
    queuedAbort.abort();
    activeAbort.abort();
    await Promise.all([active, queued]);
    await busy(raw.waitForIdle());
    c.advance(10);
    await w.ack(3);
    await raw.waitForIdle();
    expect(cancelledSample).not.toHaveBeenCalled();
    expect(w.requests).toHaveLength(4);
  });

  it('Gemma unknown·backend 전환 span은 생략하고 실제 ACK backend만 공개한다', async () => {
    const w = worker();
    const c = clock();
    const raw = new EmbeddingGemmaProvider(options(w, c));
    cleanup.push(() => raw.close());
    const sample = vi.fn<(value: EmbeddingInferenceSample) => void>();
    const first = raw.embedBatch(['a'], { onInferenceSample: sample });
    w.respond({ id: (await w.request(0)).id }); // backend 미확인
    const backends = [undefined, 'wasm', 'wasm', 'webgpu', 'webgpu', undefined, 'wasm', 'wasm'] as const;
    for (const [index, backend] of backends.entries()) {
      const work = index === 0 ? first : raw.embedBatch(['b'], { onInferenceSample: sample });
      await w.request(index + 1);
      c.advance(10);
      await w.ack(index + 1, 768, backend);
      await work;
    }
    expect(sample.mock.calls.map(([value]) => value)).toEqual([
      { backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 1030 },
      { backend: 'webgpu', workUnits: 1, durationMs: 10, endedAtMs: 1050 },
      { backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 1080 },
    ]);
    await raw.waitForIdle();
  });

  it('sample/status/logger throw에도 다음 FG·남은 BG·drain이 정착한다', async () => {
    vi.spyOn(appLogger, 'warn').mockImplementation(() => {
      throw new Error('private');
    });
    const w = worker();
    const c = clock();
    const config = options(w, c);
    const raw = new EmbeddingGemmaProvider(config);
    let armed = false;
    const unsubscribe = subscribeEmbeddingGemmaStatus(config.app, () => {
      if (armed) throw new Error('private');
    });
    cleanup.push(() => {
      unsubscribe();
      raw.close();
    });
    const observe = vi.fn(() => {
      throw new Error('private');
    });
    const bg = raw.embedBatch(['a', 'bb'], { onInferenceSample: observe });
    w.respond({ id: (await w.request(0)).id, backend: 'wasm' });
    armed = true;
    await w.request(1);
    const fg = raw.embed('ccc', { onInferenceSample: observe });
    const idle = raw.waitForIdle();
    c.advance(10);
    await w.ack(1, 768, 'wasm');
    expect((await w.request(2)).texts).toHaveLength(1);
    c.advance(10);
    await w.ack(2, 768, 'wasm');
    await fg;
    await w.request(3);
    c.advance(10);
    await w.ack(3, 768, 'wasm');
    await bg;
    await idle;
    expect(observe).toHaveBeenCalledTimes(3);
  });

  it.each(['error', 'nonfinite', 'dimensions', 'closed'] as const)(
    '%s ACK에는 성공 표본이 없다',
    async (kind) => {
      const w = worker();
      const c = clock();
      const raw = owner(w, c);
      const observe = vi.fn();
      const rejected = expect(
        raw.embedBatch(['a'], { onInferenceSample: observe }),
      ).rejects.toBeInstanceOf(Error);
      w.respond({ id: (await w.request(0)).id });
      const active = await w.request(1);
      c.advance(10);
      if (kind === 'closed') raw.close();
      w.respond({
        id: active.id,
        rows: 1,
        dimensions: kind === 'dimensions' ? 0 : 2,
        values: new Float32Array([kind === 'nonfinite' ? NaN : 1, 2]).buffer,
        error: kind === 'error' ? 'synthetic failure' : undefined,
      });
      await rejected;
      await raw.waitForIdle();
      expect(observe).not.toHaveBeenCalled();
    },
  );

  it('동기 ACK도 post 성공 뒤에만 한 번 공개하고 post throw에는 공개하지 않는다', async () => {
    for (const throws of [false, true]) {
      const w = worker();
      const c = clock();
      const observe = vi.fn();
      let returned = false;
      w.post.mockImplementation((request) => {
        w.requests.push(request);
        c.advance(10);
        w.respond({ id: request.id, rows: 1, dimensions: 2, values: new Float32Array([1, 2]).buffer });
        expect(observe).not.toHaveBeenCalled();
        if (throws) throw new Error('synthetic failure');
        returned = true;
      });
      const low = new TernlightWorkerRuntime(w.create, undefined, {
        io: c.io,
        backend: 'cpu',
        maxBatchSize: 32,
        foregroundPending: () => 0,
      });
      cleanup.push(() => low.close());
      await low.embedBatch(['a'], undefined, 'foreground', undefined, (sample) => {
        expect(returned).toBe(true);
        observe(sample);
      });
      expect(observe).toHaveBeenCalledTimes(throws ? 0 : 1);
      await low.waitForIdle();
    }
  });

  it.each([0, -1, NaN, Infinity])('duration %s는 공개 표본이 아니다', (elapsed) => {
    const c = clock();
    const sampler = new LocalEmbeddingAdmission(c.io);
    cleanup.push(() => sampler.close());
    const span = sampler.begin(1);
    c.advance(elapsed);
    expect(sampler.finish(span, true)).toBeUndefined();
  });

  it.each([0, -1, 1.5, NaN, Infinity])('posted rows %s는 공개 표본이 아니다', (rows) => {
    const c = clock();
    const sampler = new LocalEmbeddingAdmission(c.io);
    cleanup.push(() => sampler.close());
    const span = sampler.begin(rows);
    c.advance(10);
    expect(sampler.finish(span, true)).toBeUndefined();
  });

  it('Cached physical miss만 같은 clock의 actual post→ACK 표본을 한 번 전달한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const cached = new CachedEmbeddingProvider(raw, 'inference-observation', { persistent: false });
    cleanup.push(() => cached.close());
    const samples: EmbeddingInferenceSample[] = [];
    const observe = vi.fn((sample: EmbeddingInferenceSample) => samples.push(sample));
    const miss = cached.embedBatch(['a', 'a'], { onInferenceSample: observe });
    c.advance(500); // 초기화는 inference가 아니다.
    w.respond({ id: (await w.request(0)).id });
    const active = await w.request(1);
    expect(active.texts).toHaveLength(1);
    w.respond({ id: active.id + 1, rows: 1, dimensions: 2, values: new Float32Array(2).buffer });
    expect(observe).not.toHaveBeenCalled();
    c.advance(10);
    await w.ack(1, 2, 'webgpu'); // Ternlight의 고정 CPU 실행은 Gemma backend 메타데이터를 쓰지 않는다.
    await miss;
    await w.ack(1); // 이미 정착한 ACK는 재관측하지 않는다.
    expect(samples).toEqual([{ backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 1510 }]);
    expect(Object.isFrozen(samples[0])).toBe(true);
    expect(Reflect.set(samples[0], 'workUnits', 900)).toBe(false);
    expect(Object.keys(samples[0]).sort()).toEqual(['backend', 'durationMs', 'endedAtMs', 'workUnits']);
    await cached.embedBatch(['a', 'a'], { onInferenceSample: observe });
    expect(observe).toHaveBeenCalledOnce();
    expect(w.requests).toHaveLength(2);
  });

  it('지연된 persistent cache commit은 ACK 표본 밖이며 cache idle에는 남는다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const cached = new CachedEmbeddingProvider(raw, 'delayed-inference-observation', {
      dbName: `InferenceObservation-${crypto.randomUUID()}`,
    });
    cleanup.push(() => cached.close());
    const db = cached['db'];
    if (!db) throw new Error('합성 DB 누락');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const put = db.embeddings.bulkPut.bind(db.embeddings);
    const held = vi.spyOn(db.embeddings, 'bulkPut').mockImplementationOnce((items) =>
      Dexie.Promise.resolve(Dexie.waitFor(gate)).then(() => put(items)),
    );
    const observe = vi.fn();
    const work = cached.embedBatch(['a', 'a'], { onInferenceSample: observe });
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    c.advance(10);
    await w.ack(1);
    await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
    await raw.waitForIdle();
    await busy(cached.waitForIdle());
    c.advance(5000);
    expect(observe).toHaveBeenCalledWith({
      backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 1010,
    });
    release();
    await work;
    await cached.waitForIdle();
    expect(observe).toHaveBeenCalledOnce();
    await cached.deleteDatabase();
  });

  it('메모리·timer 미지원은 admission 건강과 달리 유효한 wall 관측을 숨기지 않는다', () => {
    const c = clock();
    c.io.readMemory = () => ({ rssBytes: null, availableBytes: null });
    c.io.setTimer = undefined;
    const sampler = new LocalEmbeddingAdmission(c.io);
    cleanup.push(() => sampler.close());
    const span = sampler.begin(1);
    c.advance(10);
    expect(sampler.finish(span, true)).toEqual({
      backend: 'cpu', workUnits: 1, durationMs: 10, endedAtMs: 1010,
    });
    expect(sampler.plan(source, counts)?.admitSourcePrefetch).toBe(false);
  });

  it('finish는 private admission 표본과 분리된 frozen allowlist만 반환한다', () => {
    const c = clock();
    const sampler = new LocalEmbeddingAdmission(c.io, 'cpu', 4);
    cleanup.push(() => sampler.close());
    const planning = vi.spyOn(core, 'planLocalRagAdmissionRust');
    sampler.plan(source, counts);
    const span = sampler.begin(2);
    c.advance(1);
    c.tick();
    c.advance(9);
    const sample = sampler.finish(span, true, 1010);
    expect(sample).toEqual({ backend: 'cpu', workUnits: 2, durationMs: 10, endedAtMs: 1010 });
    expect(Object.isFrozen(sample)).toBe(true);
    if (!sample) throw new Error('관측 누락');
    expect(Reflect.set(sample, 'durationMs', 999)).toBe(false);
    sampler.plan(source, counts);
    expect(planning).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sample: expect.objectContaining({ workUnits: 2, durationMs: 10, endedAtMs: 1010 }),
      }),
    );
    expect(sampler.finish(span, true, 1020)).toBeUndefined();
  });
});

describe('실제 Rust admission 표본 경계', () => {
  it('실제 clock·memory·timer 표본과 Rust state 왕복으로 증량·감량·backend reset한다', () => {
    const c = clock();
    const sampler = new LocalEmbeddingAdmission(c.io, 'cpu', 4);
    cleanup.push(() => sampler.close());
    const plan = () => sampler.plan(source, counts)!;
    expect(plan().nextBatchSize).toBe(1);
    const sample = (rows: number, elapsed: number) => {
      const span = sampler.begin(rows);
      c.advance(1);
      c.tick();
      c.advance(elapsed - 1);
      sampler.finish(span, true);
    };
    sample(1, 10);
    expect(plan()).toMatchObject({
      nextBatchSize: 1,
      admitSourcePrefetch: true,
      state: { healthySamples: 1, maxBatchSize: 4 },
    });
    sample(1, 10);
    expect(plan()).toMatchObject({ nextBatchSize: 2, admitSourcePrefetch: false });
    sample(2, 30);
    expect(plan().nextBatchSize).toBe(1);
    sample(1, 10);
    plan();
    sample(1, 10);
    expect(plan().nextBatchSize).toBe(2);
    sampler.setBackend('cpu', 3);
    expect(plan()).toMatchObject({
      nextBatchSize: 1,
      state: { maxBatchSize: 3, previousRate: null },
    });
    sampler.setBackend('webgpu', 32);
    expect(plan()).toMatchObject({
      nextBatchSize: 1,
      state: { backend: 'webgpu', maxBatchSize: 32, previousRate: null },
    });
    sample(1, 10);
    plan();
    sample(1, 10);
    expect(plan().nextBatchSize).toBe(2);
    sampler.setBackend('cpu', 4);
    expect(plan()).toMatchObject({ nextBatchSize: 1, state: { maxBatchSize: 4 } });
  });
  it.each(['memory', 'timer', 'stale', 'nonfinite'] as const)(
    '%s 미지원·오래됨·손상 표본은 증량과 source 최적화를 닫는다',
    (kind) => {
      const c = clock();
      if (kind === 'memory') c.io.readMemory = () => ({ rssBytes: null, availableBytes: null });
      if (kind === 'timer') c.io.setTimer = undefined;
      if (kind === 'nonfinite')
        c.io.readMemory = () => ({ rssBytes: NaN, availableBytes: Infinity });
      const sampler = new LocalEmbeddingAdmission(c.io, 'cpu', 4);
      cleanup.push(() => sampler.close());
      sampler.plan(source, counts);
      for (let i = 0; i < 4; i++) {
        const span = sampler.begin(1);
        c.advance(1);
        c.tick();
        c.advance(9);
        sampler.finish(span, true);
        if (kind === 'stale') c.advance(5001);
        const plan = sampler.plan(source, counts);
        if (kind === 'nonfinite') expect(plan).toBeNull();
        else expect(plan).toMatchObject({ nextBatchSize: 1, admitSourcePrefetch: false });
      }
    },
  );
  it('기본 I/O는 지원되는 실제 process 값만 읽고 미지원·throw는 null이다', () => {
    const original = globalThis.process;
    const fake = {
      memoryUsage: () => ({ rss: 12345, heapUsed: 99999 }),
      availableMemory: () => 67890,
    };
    vi.stubGlobal('process', fake);
    const sampler = new LocalEmbeddingAdmission(undefined, 'cpu', 4);
    cleanup.push(() => sampler.close());
    expect(sampler.readMemory()).toEqual({ rssBytes: 12345, availableBytes: 67890 });
    vi.stubGlobal('process', {
      memoryUsage: () => {
        throw new Error('private');
      },
    });
    expect(sampler.readMemory()).toEqual({ rssBytes: null, availableBytes: null });
    vi.stubGlobal('process', undefined);
    expect(sampler.readMemory()).toEqual({ rssBytes: null, availableBytes: null });
    vi.stubGlobal('process', original);
  });
});

describe('owner 실제 미스 → Rust → 순차 microdispatch', () => {
  it('BG 여러 행 중 FG가 다음 물리 post를 먼저 받고 전체 행·벡터 순서 및 hook 시점이 유지된다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const hook = vi.fn(() => {
      expect(w.requests.at(-1)?.operation).toBe('embed');
    });
    const bg = raw.embedBatch(['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff'], {
      onInferenceDispatch: hook,
    });
    w.respond({ id: (await w.request(0)).id });
    expect((await w.request(1)).texts).toEqual(['a']);
    c.advance(1);
    c.tick();
    c.advance(9);
    const fg = raw.embed('urgent');
    await busy(raw.waitForIdle());
    await w.ack(1);
    expect((await w.request(2)).texts).toEqual(['urgent']);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(2);
    await fg;
    let index = 3;
    const batches: string[][] = [];
    while (batches.flat().length < 5) {
      const request = await w.request(index);
      batches.push(request.texts!);
      c.advance(1);
      c.tick();
      c.advance(9);
      await w.ack(index++);
    }
    expect(batches.flat()).toEqual(['bb', 'ccc', 'dddd', 'eeeee', 'ffffff']);
    expect(batches.some((batch) => batch.length === 2)).toBe(true);
    await expect(bg).resolves.toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
    ]);
    expect(hook).toHaveBeenCalledTimes(index - 2);
    await raw.waitForIdle();
  });
  it('큐에서 기다리는 BG 크기도 실제 dispatch 시점의 Rust FG 감량을 다시 적용한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const warm = raw.embedBatch(['a', 'b', 'c']);
    w.respond({ id: (await w.request(0)).id });
    for (let i = 1; i <= 3; i++) {
      await w.request(i);
      c.advance(1);
      c.tick();
      c.advance(9);
      await w.ack(i);
    }
    await warm;
    const active = raw.embedBatch(['d', 'e']);
    expect((await w.request(4)).texts).toHaveLength(2);
    const queued = raw.embedBatch(['f', 'g']);
    void queued.catch(() => undefined);
    await busy(raw.waitForIdle());
    const fg = raw.embed('urgent');
    await busy(raw.waitForIdle());
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(4);
    await active;
    expect((await w.request(5)).texts).toEqual(['urgent']);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(5);
    await fg;
    expect((await w.request(6)).texts).toEqual(['f']);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(6);
    expect((await w.request(7)).texts).toEqual(['g']);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(7);
    await expect(queued).resolves.toEqual([
      [1, 2],
      [1, 2],
    ]);
  });
  it('cache hit·dedupe는 표본/dispatch를 추가하지 않고 Cached는 로컬 plan만 위임한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const cached = new CachedEmbeddingProvider(raw, 'admission-synthetic', { persistent: false });
    cleanup.push(() => cached.close());
    const hook = vi.fn();
    const work = cached.embedBatch(['a', 'a'], { onInferenceDispatch: hook });
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1);
    await work;
    const reads = c.memory.mock.calls.length;
    expect(cached.planLocalAdmission?.(source)).toEqual(raw.planLocalAdmission(source));
    await expect(cached.embedBatch(['a', 'a'], { onInferenceDispatch: hook })).resolves.toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(c.memory).toHaveBeenCalledTimes(reads);
    const remote = new CachedEmbeddingProvider(
      { embed: () => Promise.resolve([1]), embedBatch: () => Promise.resolve([[1]]) },
      'remote',
      { persistent: false },
    );
    cleanup.push(() => remote.close());
    expect(remote.planLocalAdmission).toBeUndefined();
    const remoteSample = vi.fn();
    await remote.embedBatch(['remote synthetic'], { onInferenceSample: remoteSample });
    expect(remoteSample).not.toHaveBeenCalled();
  });
  it('persistent cache hit도 새 owner의 worker·표본·hook을 만들지 않는다', async () => {
    const dbName = `LocalAdmission-${crypto.randomUUID()}`;
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const cached = new CachedEmbeddingProvider(raw, 'persistent-admission', { dbName });
    cleanup.push(() => cached.close());
    const miss = cached.embedBatch(['a', 'a']);
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1);
    await miss;
    const otherWorker = worker();
    const otherClock = clock();
    const restored = new CachedEmbeddingProvider(
      owner(otherWorker, otherClock),
      'persistent-admission',
      { dbName },
    );
    cleanup.push(() => restored.close());
    const hook = vi.fn();
    const sample = vi.fn();
    await expect(restored.embedBatch(['a', 'a'], { onInferenceDispatch: hook, onInferenceSample: sample })).resolves.toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(otherWorker.requests).toHaveLength(0);
    expect(otherClock.memory).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(sample).not.toHaveBeenCalled();
    cached.close();
    await restored.deleteDatabase();
    restored.close();
  });
  it('실제 post hook의 window charge와 실제 원장으로만 다음 source 한 개를 허용한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const first = raw.embedBatch(['a']);
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1);
    await first;
    let inHook: ReturnType<typeof raw.planLocalAdmission> = null;
    const second = raw.embedBatch(['b'], {
      onInferenceDispatch: () => {
        inHook = raw.planLocalAdmission(source);
      },
    });
    await w.request(2);
    expect(inHook).toMatchObject({ admitSourcePrefetch: true });
    expect(raw.planLocalAdmission({ ...source, plannedSourceBytes: 10001 })).toMatchObject({
      admitSourcePrefetch: false,
    });
    let release!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const abort = new AbortController();
    const reading = dispatchSourceRead(
      'source-decode',
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      'txt',
      { inputBytes: 1, signal: abort.signal, priority: 'background' },
    );
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(raw.planLocalAdmission(source)).toMatchObject({ admitSourcePrefetch: false });
    abort.abort();
    await rejected;
    expect(raw.planLocalAdmission(source)).toMatchObject({ admitSourcePrefetch: false });
    release(new Uint8Array([65]));
    await vi.waitFor(() => expect(getSourceDispatchSnapshot()).toMatchObject({ active: 0 }));
    const fg = raw.embed('urgent');
    void fg.catch(() => undefined);
    expect(raw.planLocalAdmission(source)).toMatchObject({ admitSourcePrefetch: false }); // queued FG도 즉시 반영한다.
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(2);
    await second;
    await w.request(3);
    expect(raw.planLocalAdmission(source)).toMatchObject({ admitSourcePrefetch: false }); // active unsettled FG
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(3);
    await fg;
  });
  it('queued wait는 physicalRoundtrip에서 제외하고 active abort는 ACK 전 sample/idle을 만들지 않는다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const first = raw.embedBatch(['a']);
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    const abort = new AbortController();
    const rejected = expect(raw.embed('bb', { signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    c.advance(1000);
    c.tick();
    await w.ack(1);
    await first;
    await w.request(2);
    c.advance(1);
    c.tick();
    c.advance(9);
    abort.abort();
    await rejected;
    const beforeAck = c.memory.mock.calls.length;
    await busy(raw.waitForIdle());
    expect(c.memory).toHaveBeenCalledTimes(beforeAck);
    c.advance(10);
    await w.ack(2);
    await raw.waitForIdle();
    const plan = raw.planLocalAdmission(source)!;
    expect(plan.state.previousRate).toBeCloseTo(1 / 20);
    expect(c.memory).toHaveBeenCalledTimes(beforeAck + 1);
  });
  it('actual backend 응답만 Gemma 상한을 결정하고 status observer throw도 샘플을 막지 않는다', async () => {
    const w = worker();
    const c = clock();
    const config = options(w, c);
    const raw = new EmbeddingGemmaProvider(config);
    let armed = false;
    const unsubscribe = subscribeEmbeddingGemmaStatus(config.app, () => {
      if (armed) throw new Error('private observer');
    });
    cleanup.push(() => {
      unsubscribe();
      raw.close();
    });
    armed = true;
    const bg = raw.embedBatch(['x']);
    w.respond({ id: (await w.request(0)).id, backend: 'wasm' });
    await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1, 768, 'wasm');
    await bg;
    expect(raw.planLocalAdmission(source)?.state).toMatchObject({
      backend: 'cpu',
      maxBatchSize: 4,
    });
    const next = raw.embedBatch(['y']);
    await w.request(2);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(2, 768, 'webgpu');
    await next;
    expect(raw.planLocalAdmission(source)?.state).toMatchObject({
      backend: 'webgpu',
      maxBatchSize: 32,
      batchSize: 1,
      previousRate: null,
    });
    expect(() => raw.close()).not.toThrow();
    await raw.waitForIdle();
    expect(w.terminate).toHaveBeenCalledOnce();
  });
  it('Node 미계측 source 원장은 unknown이며 새 source 최적화는 닫힌다', () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('document', undefined);
    expect(getSourceDispatchSnapshot()).toEqual({
      supported: false,
      queuedForeground: null,
      active: null,
      reservedBytes: null,
      budgetBytes: null,
    });
    expect(owner(worker(), clock()).planLocalAdmission(source)).toBeNull();
  });
  it('Rust null/throw에서는 수치 fallback 없이 기존 baseline 요청을 보존한다', async () => {
    for (const throws of [false, true]) {
      const spy = vi.spyOn(core, 'planLocalRagAdmissionRust').mockImplementation(() => {
        if (throws) throw new Error('private');
        return null;
      });
      const w = worker();
      const raw = owner(w, clock());
      const work = raw.embedBatch(['a', 'bb']);
      w.respond({ id: (await w.request(0)).id });
      expect((await w.request(1)).texts).toEqual(['a', 'bb']);
      await w.ack(1);
      await work;
      spy.mockRestore();
    }
  });
  it('hook throw·postthrow·unknown ACK·close에는 유령 sample/idle이 없고 새 owner는 이전 표본을 받지 않는다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const hook = vi.fn(() => {
      throw new Error('private hook');
    });
    const work = raw.embedBatch(['a'], { onInferenceDispatch: hook });
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    w.respond({ id: 999, rows: 1 });
    expect(c.memory).not.toHaveBeenCalled();
    await busy(raw.waitForIdle());
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1);
    await work;
    expect(hook).toHaveBeenCalledOnce();
    const next = raw.embedBatch(['b']);
    const rejected = expect(next).rejects.toBeInstanceOf(Error);
    await w.request(2);
    raw.close();
    await rejected;
    await raw.waitForIdle();
    const reads = c.memory.mock.calls.length;
    await w.ack(2);
    expect(c.memory).toHaveBeenCalledTimes(reads);
    expect(c.timers.size).toBe(0);
    const b = owner(worker(), c);
    expect(b.planLocalAdmission(source)).toBeNull();
    const broken = worker();
    broken.post.mockImplementation(() => {
      throw new Error('post failure');
    });
    const low = new TernlightWorkerRuntime(broken.create);
    cleanup.push(() => low.close());
    const never = vi.fn();
    await expect(low.embedBatch(['a'], undefined, 'background', never)).rejects.toThrow(
      'post failure',
    );
    await low.waitForIdle();
    expect(never).not.toHaveBeenCalled();
  });
  it.each(['ternlight', 'gemma'] as const)(
    '%s fatal worker 복구는 이전 owner의 표본·늦은 ACK를 이어받지 않는다',
    async (kind) => {
      const aw = worker();
      const bw = worker();
      const c = clock();
      const createWorker = vi
        .fn()
        .mockImplementationOnce(aw.create)
        .mockImplementationOnce(bw.create);
      const config = { ...options(aw, c), createWorker };
      const raw =
        kind === 'ternlight'
          ? new TernlightEmbeddingProvider('ternlight-base', config)
          : new EmbeddingGemmaProvider(config);
      cleanup.push(() => raw.close());
      const dimensions = kind === 'ternlight' ? 2 : 768;
      const observe = vi.fn();
      const first = raw.embedBatch(['a'], { onInferenceSample: observe });
      aw.respond({ id: (await aw.request(0)).id, backend: 'wasm' });
      await aw.request(1);
      c.advance(1);
      c.tick();
      c.advance(9);
      await aw.ack(1, dimensions, 'wasm');
      await first;
      expect(raw.planLocalAdmission(source)?.state.healthySamples).toBe(1);
      expect(observe).toHaveBeenCalledOnce();
      const old = raw.embedBatch(['b'], { onInferenceSample: observe });
      const rejected = expect(old).rejects.toThrow('합성 오류');
      await aw.request(2);
      aw.fail();
      await rejected;
      const next = raw.embedBatch(['c', 'dd'], { onInferenceSample: observe });
      void next.catch(() => undefined);
      bw.respond({ id: (await bw.request(0)).id, backend: 'wasm' });
      expect((await bw.request(1)).texts).toEqual(
        kind === 'ternlight' ? ['c'] : ['title: none | text: c'],
      );
      await aw.ack(2, dimensions, 'wasm');
      expect(observe).toHaveBeenCalledOnce();
      expect(raw.planLocalAdmission(source)?.state).toMatchObject({
        batchSize: 1,
        healthySamples: 0,
        previousRate: null,
      });
      c.advance(1);
      c.tick();
      c.advance(9);
      await bw.ack(1, dimensions, 'wasm');
      expect((await bw.request(2)).texts).toEqual(
        kind === 'ternlight' ? ['dd'] : ['title: none | text: dd'],
      );
      c.advance(1);
      c.tick();
      c.advance(9);
      await bw.ack(2, dimensions, 'wasm');
      await next;
      expect(observe).toHaveBeenCalledTimes(3);
      expect(bw.terminate).not.toHaveBeenCalled();
      expect(createWorker).toHaveBeenCalledTimes(2);
    },
  );
  it('hook와 고정 logger가 함께 throw해도 물리 결과·다음 dispatch·idle은 정착한다', async () => {
    vi.spyOn(appLogger, 'warn').mockImplementation(() => {
      throw new Error('private diagnostic');
    });
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const bg = raw.embedBatch(['a', 'bb'], {
      onInferenceDispatch: () => {
        throw new Error('private observer');
      },
    });
    w.respond({ id: (await w.request(0)).id });
    await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    expect(() => {
      void w.ack(1);
    }).not.toThrow();
    await w.request(2);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(2);
    await expect(bg).resolves.toEqual([
      [1, 2],
      [2, 3],
    ]);
    await raw.waitForIdle();
  });
  it('adaptive postthrow·손상 ACK는 성공 표본/후속 BG post를 만들지 않고 다른 요청은 보존한다', async () => {
    const w = worker();
    const c = clock();
    const raw = owner(w, c);
    const hook = vi.fn();
    const observe = vi.fn();
    const first = raw.embedBatch(['a', 'bb'], { onInferenceDispatch: hook, onInferenceSample: observe });
    const rejected = expect(first).rejects.toThrow('invalid vector');
    w.respond({ id: (await w.request(0)).id });
    const active = await w.request(1);
    c.advance(1);
    c.tick();
    c.advance(9);
    w.respond({ id: active.id, rows: 1, dimensions: 2, values: new Float32Array([1]).buffer });
    await rejected;
    await raw.waitForIdle();
    expect(w.requests).toHaveLength(2);
    expect(c.memory).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    w.post.mockImplementationOnce(() => {
      throw new Error('physical post failed');
    });
    await expect(raw.embedBatch(['cc'], { onInferenceDispatch: hook, onInferenceSample: observe })).rejects.toThrow(
      'physical post failed',
    );
    await raw.waitForIdle();
    expect(hook).toHaveBeenCalledOnce();
    expect(observe).not.toHaveBeenCalled();
    expect(c.timers.size).toBe(0);
    expect(c.memory).not.toHaveBeenCalled();
    const next = raw.embedBatch(['ddd'], { onInferenceSample: observe });
    await w.request(2);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(2);
    await expect(next).resolves.toEqual([[3, 4]]);
    expect(observe).toHaveBeenCalledOnce();
    await raw.waitForIdle();
    expect(w.terminate).not.toHaveBeenCalled();
  });
  it('고장난 clock/memory/timer I/O도 실제 baseline 결과·물리 정착을 막지 않는다', async () => {
    const w = worker();
    const c = clock();
    c.io.now = () => {
      throw new Error('private clock');
    };
    c.io.readMemory = () => {
      throw new Error('private memory');
    };
    c.io.setTimer = () => {
      throw new Error('private timer');
    };
    const raw = owner(w, c);
    const bg = raw.embedBatch(['a', 'bb']);
    w.respond({ id: (await w.request(0)).id });
    expect((await w.request(1)).texts).toEqual(['a', 'bb']);
    await w.ack(1);
    await expect(bg).resolves.toEqual([
      [1, 2],
      [2, 3],
    ]);
    await raw.waitForIdle();
    expect(raw.planLocalAdmission(source)).toBeNull();
  });
  it('lowlevel adaptive drain도 ACK 사이의 논리 BG 나머지를 빠뜨리지 않는다', async () => {
    const w = worker();
    const c = clock();
    const low = new TernlightWorkerRuntime(w.create, undefined, {
      io: c.io,
      backend: 'cpu',
      maxBatchSize: 32,
      foregroundPending: () => 0,
    });
    cleanup.push(() => low.close());
    const bg = low.embedBatch(['a', 'bb'], undefined, 'background');
    void bg.catch(() => undefined);
    const idle = low.waitForIdle();
    await w.request(0);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(0);
    await w.request(1);
    await busy(idle);
    c.advance(1);
    c.tick();
    c.advance(9);
    await w.ack(1);
    await expect(bg).resolves.toEqual([
      [1, 2],
      [2, 3],
    ]);
    await idle;
  });
  it('동기 fake ACK에서도 dispatch hook 예외가 결과·idle을 막지 않는다', async () => {
    const w = worker();
    w.post.mockImplementation((request) => {
      w.requests.push(request);
      w.respond({
        id: request.id,
        rows: 1,
        dimensions: 2,
        values: new Float32Array([1, 2]).buffer,
      });
    });
    const low = new TernlightWorkerRuntime(w.create);
    cleanup.push(() => low.close());
    const hook = vi.fn(() => {
      throw new Error('private');
    });
    await expect(low.embedBatch(['a'], undefined, 'background', hook)).resolves.toEqual([[1, 2]]);
    await low.waitForIdle();
    expect(hook).toHaveBeenCalledOnce();
  });
});
