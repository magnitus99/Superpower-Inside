import 'fake-indexeddb/auto';
import type { App } from 'obsidian';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';
import { subscribeEmbeddingGemmaStatus } from './embeddinggemma-status';
import {
  CachedEmbeddingProvider,
  EmbeddingGemmaProvider,
  TernlightEmbeddingProvider,
} from './embedding';
import {
  closeTernlightRuntime,
  embedTernlightBatch,
  TernlightWorkerRuntime,
  waitForEmbeddingOperation,
  type TernlightWorkerFactory,
  type TernlightWorkerRequest,
  type TernlightWorkerResponse,
} from './ternlight-runtime';

const models = vi.hoisted(() => ({
  prepare: vi.fn(() => Promise.resolve()),
  read: vi.fn(() => Promise.resolve(new ArrayBuffer(1))),
}));
vi.mock('./local-embedding-models', () => ({ getLocalEmbeddingModels: () => models }));
vi.mock('../../.local/generated/embeddinggemma-assets', () => ({
  EMBEDDINGGEMMA_ASSETS: [{ file: 'embeddinggemma-worker.js' }, { file: 'model.bin' }],
}));
vi.mock('../rag/rust-core', () => ({
  createIndexedDbRecordKeyRust: (namespace: string, text: string) => `${namespace}:${text}`,
  embeddingGemmaInputsRust: (texts: string[]) => texts,
  // 기존 baseline/priority 회귀는 새 최적화가 불가한 Rust 경계를 검증한다.
  planLocalRagAdmissionRust: () => null,
}));
vi.mock('obsidian', () => ({
  requestUrl: () => {
    throw new Error('합성 검증에서 네트워크 호출 금지');
  },
}));

const cleanup: (() => void)[] = [];
beforeEach(() => {
  models.prepare.mockReset().mockResolvedValue(undefined);
  models.read.mockReset().mockImplementation(() => Promise.resolve(new ArrayBuffer(1)));
  vi.stubGlobal('fetch', () => {
    throw new Error('합성 검증에서 네트워크 호출 금지');
  });
});
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  closeTernlightRuntime();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLanguage('ko');
});

function gateWorker() {
  let onMessage: (event: MessageEvent<TernlightWorkerResponse>) => void = () => undefined;
  let onError: (event: ErrorEvent) => void = () => undefined;
  const requests: TernlightWorkerRequest[] = [];
  const terminate = vi.fn();
  const dispose = vi.fn();
  const create: TernlightWorkerFactory = () => ({
    worker: {
      setOnMessage: (handler) => {
        onMessage = handler;
      },
      setOnError: (handler) => {
        onError = handler;
      },
      postMessage: (request) => {
        requests.push(request);
      },
      terminate,
    },
    dispose,
  });
  const respond = (response: TernlightWorkerResponse) =>
    onMessage({ data: response } as MessageEvent<TernlightWorkerResponse>);
  return {
    create,
    requests,
    terminate,
    dispose,
    respond,
    fail: () => onError({ message: '합성 worker 실패' } as ErrorEvent),
    async request(operation: TernlightWorkerRequest['operation'], index = 0) {
      await vi.waitFor(() =>
        expect(
          requests.filter((request) => request.operation === operation).length,
        ).toBeGreaterThan(index),
      );
      return requests.filter((request) => request.operation === operation)[index];
    },
    async initialize() {
      respond({ id: (await this.request('initialize')).id });
    },
    async vectors(dimensions = 2, index = 0) {
      const request = await this.request('embed', index);
      const rows = request.texts?.length ?? 0;
      respond({
        id: request.id,
        rows,
        dimensions,
        values: Float32Array.from({ length: rows * dimensions }, (_, i) => i + 1).buffer,
      });
    },
  };
}
function options(worker: ReturnType<typeof gateWorker>) {
  return {
    app: { vault: { configDir: '.synthetic' } } as unknown as App,
    pluginId: 'synthetic',
    pluginVersion: '1',
    createWorker: worker.create,
  };
}
function provider(worker: ReturnType<typeof gateWorker>) {
  const result = new TernlightEmbeddingProvider('ternlight-base', options(worker));
  cleanup.push(() => result.close());
  return result;
}
async function expectBusy(wait: Promise<void>) {
  const settled = vi.fn();
  void wait.then(settled);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
}

describe('모델 자산 준비 실제 단계', () => {
  it.each(['ternlight', 'gemma'] as const)('%s는 실제 prepare/read/graph ACK에서만 준비 계수를 게시한다', async (kind) => {
    const worker = gateWorker();
    const progress: [number, number][] = [];
    const config = { ...options(worker), onPreparationProgress: (processed: number, total: number) => { progress.push([processed, total]); } };
    const owner = kind === 'ternlight' ? new TernlightEmbeddingProvider('ternlight-base', config) : new EmbeddingGemmaProvider(config);
    cleanup.push(() => owner.close());
    let release!: () => void;
    models.read.mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { release = () => resolve(new ArrayBuffer(1)); }));
    const result = owner.embed('synthetic fixture');
    const total = kind === 'ternlight' ? 3 : 4;
    await vi.waitFor(() => expect(progress).toEqual([[0, total], [1, total]]));
    release();
    await worker.request('initialize');
    expect(progress.at(-1)).toEqual([total - 1, total]);
    await worker.initialize();
    await worker.request('embed');
    expect(progress.at(-1)).toEqual([total, total]);
    await worker.vectors(kind === 'ternlight' ? 2 : 768);
    await result;
  });
  it('준비 관측자 실패는 fake provider의 실제 ACK와 idle을 막지 않는다', async () => {
    const worker = gateWorker();
    const owner = new EmbeddingGemmaProvider({ ...options(worker), onPreparationProgress: () => { throw new Error('observer'); } });
    cleanup.push(() => owner.close());
    const result = owner.embed('synthetic fixture');
    await worker.initialize(); await worker.vectors(768); await result; await owner.waitForIdle();
  });
});

describe('상태 관찰자와 물리 큐', () => {
  it.each([false, true])('상태 subscriber 예외는 실제 ACK·다음 FG·idle을 막지 않는다 (취소=%s)', async (cancelled) => {
    const worker = gateWorker();
    const config = options(worker);
    const owner = new EmbeddingGemmaProvider(config);
    cleanup.push(() => owner.close());
    let throwNext = false;
    cleanup.push(subscribeEmbeddingGemmaStatus(config.app, () => {
      if (!throwNext) return;
      throwNext = false;
      throw new Error('synthetic status observer failure');
    }));
    const controller = new AbortController();
    const background = owner.embedBatch(['synthetic background'], { signal: controller.signal });
    void background.catch(() => undefined);
    await worker.initialize();
    const active = await worker.request('embed');
    const foreground = owner.embed('synthetic foreground');
    void foreground.catch(() => undefined);
    const idle = owner.waitForIdle();
    await expectBusy(idle);
    expect(worker.requests.filter(({ operation }) => operation === 'embed')).toHaveLength(1);
    if (cancelled) {
      controller.abort();
      await expect(background).rejects.toMatchObject({ name: 'AbortError' });
      await expectBusy(idle);
    }
    throwNext = true;
    expect(() => worker.respond({ id: active.id, rows: 1, dimensions: 768, values: new Float32Array(768).fill(1).buffer })).not.toThrow();
    if (!cancelled) await expect(background).resolves.toHaveLength(1);
    expect((await worker.request('embed', 1)).texts).toEqual(['synthetic foreground']);
    await expectBusy(idle);
    await worker.vectors(768, 1);
    await expect(foreground).resolves.toHaveLength(768);
    await idle;
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});

describe('로컬 임베딩 오류 문구', () => {
  it.each(['ko', 'en'] as const)(
    '%s에서 닫힌 owner의 종류와 재사용 금지를 보존한다',
    async (language) => {
      setLanguage(language);
      const worker = gateWorker();
      const owners = [
        { runtime: provider(worker), owner: 'Ternlight' },
        { runtime: new EmbeddingGemmaProvider(options(worker)), owner: 'EmbeddingGemma' },
        {
          runtime: new CachedEmbeddingProvider(provider(worker), 'synthetic-copy', {
            persistent: false,
          }),
          owner: 'Embedding cache',
        },
      ];
      for (const { runtime, owner } of owners) {
        cleanup.push(() => runtime.close());
        runtime.close();
        const result = runtime.embedBatch([]);
        await expect(result).rejects.toBeInstanceOf(Error);
        await expect(result).rejects.toThrow(t('embeddingOwnerClosed', { owner }));
      }
      expect(worker.requests).toHaveLength(0);
    },
  );

  it.each(['ko', 'en'] as const)('%s에서 종료된 초기화 문구를 보존한다', async (language) => {
    setLanguage(language);
    for (const model of ['Ternlight', 'EmbeddingGemma']) {
      let release!: () => void;
      models.prepare.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const worker = gateWorker();
      const runtime =
        model === 'Ternlight' ? provider(worker) : new EmbeddingGemmaProvider(options(worker));
      cleanup.push(() => runtime.close());
      const result = runtime.embed('합성 입력');
      const rejected = expect(result).rejects.toThrow(
        t('embeddingInitializationClosed', { model }),
      );
      runtime.close();
      release();
      await rejected;
      await runtime.waitForIdle();
      expect(worker.requests).toHaveLength(0);
    }
  });

  it.each(['ko', 'en'] as const)(
    '%s에서 합성 실패와 취소는 번역하되 Error와 AbortError는 보존한다',
    async (language) => {
      setLanguage(language);
      const controller = new AbortController();
      controller.abort();
      const cancelled = waitForEmbeddingOperation(Promise.resolve([]), controller.signal);
      await expect(cancelled).rejects.toBeInstanceOf(DOMException);
      await expect(cancelled).rejects.toMatchObject({
        name: 'AbortError',
        message: t('actionCancelledNotice'),
      });
      await expect(
        waitForEmbeddingOperation(
          vi.fn<() => Promise<unknown>>().mockRejectedValue('synthetic')(),
          new AbortController().signal,
        ),
      ).rejects.toThrow(t('providerModelEmbeddingFailed'));
      const original = new Error('synthetic');
      await expect(
        waitForEmbeddingOperation(Promise.reject(original), new AbortController().signal),
      ).rejects.toBe(original);
      const worker = gateWorker();
      const runtime = new TernlightWorkerRuntime(() => {
        const handle = worker.create();
        handle.worker.postMessage = () => {
          const failure = vi.fn<() => unknown>().mockReturnValue('synthetic')();
          throw failure;
        };
        return handle;
      });
      cleanup.push(() => runtime.close());
      await expect(runtime.embedBatch(['합성 입력'])).rejects.toThrow(
        t('embeddingRequestDispatchFailed', { model: 'Ternlight' }),
      );
      await runtime.waitForIdle();
    },
  );
});

describe('로컬 임베딩 owner와 물리 idle', () => {
  it.each(['close', 'error'] as const)(
    '동일 설정 owner A의 %s가 B 요청을 종료하지 않는다',
    async (action) => {
      const aWorker = gateWorker();
      const bWorker = gateWorker();
      const a = provider(aWorker);
      const b = provider(bWorker);
      const aResult = a.embed('가');
      const aRejected = expect(aResult).rejects.toBeInstanceOf(Error);
      await aWorker.initialize();
      await aWorker.request('embed');
      const bResult = b.embedBatch(['나', '다']);
      await bWorker.initialize();
      await bWorker.request('embed');
      if (action === 'close') {
        a.close();
        a.close();
      } else aWorker.respond({ id: (await aWorker.request('embed')).id, error: '합성 지연 실패' });
      await aRejected;
      expect(bWorker.terminate).not.toHaveBeenCalled();
      await bWorker.vectors();
      await expect(bResult).resolves.toEqual([
        [1, 2],
        [3, 4],
      ]);
      if (action === 'close') {
        await expect(a.embed('재사용')).rejects.toBeInstanceOf(Error);
        expect(aWorker.requests).toHaveLength(2);
        expect(aWorker.terminate).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(['ternlight', 'gemma'] as const)(
    '%s 초기화 ACK 전 owner close와 늦은 오류가 B 준비를 방해하지 않는다',
    async (kind) => {
      const aw = gateWorker();
      const bw = gateWorker();
      const a = kind === 'ternlight' ? provider(aw) : new EmbeddingGemmaProvider(options(aw));
      const b = kind === 'ternlight' ? provider(bw) : new EmbeddingGemmaProvider(options(bw));
      cleanup.push(
        () => a.close(),
        () => b.close(),
      );
      const rejected = expect(a.embed('가')).rejects.toBeInstanceOf(Error);
      await aw.request('initialize');
      const result = b.embed('나');
      await bw.request('initialize');
      a.close();
      a.close();
      aw.fail();
      await rejected;
      await a.waitForIdle();
      expect(aw.terminate).toHaveBeenCalledTimes(1);
      expect(bw.terminate).not.toHaveBeenCalled();
      await bw.initialize();
      const dimensions = kind === 'ternlight' ? 2 : 768;
      await bw.vectors(dimensions);
      await expect(result).resolves.toEqual(Array.from({ length: dimensions }, (_, i) => i + 1));
      await expect(a.embedBatch([])).rejects.toBeInstanceOf(Error);
    },
  );

  it.each(['ack', 'error', 'terminate'] as const)(
    '취소 뒤 물리 작업은 %s까지 busy다',
    async (completion) => {
      const worker = gateWorker();
      const runtime = new TernlightWorkerRuntime(worker.create);
      cleanup.push(() => runtime.close());
      const controller = new AbortController();
      const result = runtime.embedBatch(['가', '나'], controller.signal);
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      const request = await worker.request('embed');
      controller.abort();
      await rejected;
      const idle = runtime.waitForIdle();
      await expectBusy(idle);
      if (completion === 'ack') await worker.vectors();
      else if (completion === 'error') worker.respond({ id: request.id, error: '합성 지연 실패' });
      else {
        runtime.close();
        runtime.close();
        expect(worker.terminate).toHaveBeenCalledTimes(1);
      }
      await idle;
    },
  );

  it('미전송·지난 응답은 현재 슬롯을 풀지 않고 요청별 순서와 마지막 물리 idle을 유지한다', async () => {
    const worker = gateWorker();
    const runtime = new TernlightWorkerRuntime(worker.create);
    cleanup.push(() => runtime.close());
    const first = runtime.embedBatch(['가', '나']);
    const second = runtime.embedBatch(['다']);
    const idle = runtime.waitForIdle();
    const firstRequest = await worker.request('embed');
    worker.respond({ id: firstRequest.id + 1, error: 'synthetic unposted response' });
    worker.respond({ id: 999, error: 'synthetic unknown response' });
    expect(worker.requests).toHaveLength(1);
    await expectBusy(idle);
    await worker.vectors();
    await expect(first).resolves.toEqual([
      [1, 2],
      [3, 4],
    ]);
    const secondRequest = await worker.request('embed', 1);
    expect(secondRequest.texts).toEqual(['다']);
    worker.respond({ id: firstRequest.id, error: 'synthetic late response' });
    await expectBusy(idle);
    await worker.vectors(2, 1);
    await expect(second).resolves.toEqual([[1, 2]]);
    await idle;
  });

  it('A 자산 준비의 늦은 실패가 준비된 B를 초기화하거나 종료하지 않는다', async () => {
    let rejectPreparation!: (error: Error) => void;
    models.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPreparation = reject;
        }),
    );
    const aw = gateWorker();
    const bw = gateWorker();
    const a = provider(aw);
    const b = provider(bw);
    const rejected = expect(a.embed('가')).rejects.toThrow('합성 자산 실패');
    const result = b.embed('나');
    await bw.initialize();
    await bw.request('embed');
    rejectPreparation(new Error('합성 자산 실패'));
    await rejected;
    a.close();
    a.close();
    expect(bw.terminate).not.toHaveBeenCalled();
    await bw.vectors();
    await expect(result).resolves.toEqual([1, 2]);
    const next = b.embed('다');
    await bw.vectors(2, 1);
    await expect(next).resolves.toEqual([1, 2]);
    expect(bw.requests.filter((request) => request.operation === 'initialize')).toHaveLength(1);
  });

  it('postMessage 실패는 유령 물리 작업을 남기지 않는다', async () => {
    const worker = gateWorker();
    const create: TernlightWorkerFactory = () => {
      const handle = worker.create();
      handle.worker.postMessage = () => {
        throw new Error('합성 dispatch 실패');
      };
      return handle;
    };
    const runtime = new TernlightWorkerRuntime(create);
    cleanup.push(() => runtime.close());
    await expect(runtime.embedBatch(['가'])).rejects.toThrow('합성 dispatch 실패');
    await runtime.waitForIdle();
  });

  it.each(['ternlight', 'gemma'] as const)(
    '%s 초기화 취소는 즉시 거부하고 자산 작업은 idle까지 남긴다',
    async (kind) => {
      let release!: () => void;
      models.prepare.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const worker = gateWorker();
      const runtime =
        kind === 'ternlight' ? provider(worker) : new EmbeddingGemmaProvider(options(worker));
      cleanup.push(() => runtime.close());
      const controller = new AbortController();
      const rejected = expect(
        runtime.embed('가', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await rejected;
      runtime.close();
      const idle = runtime.waitForIdle();
      await expectBusy(idle);
      release();
      await idle;
      expect(worker.requests).toHaveLength(0);
      await expect(runtime.embed('재사용')).rejects.toBeInstanceOf(Error);
    },
  );

  it('cache의 취소 응답 뒤에도 inner 물리 ACK를 기다리고 중복 입력 순서를 유지한다', async () => {
    const worker = gateWorker();
    const raw = provider(worker);
    const cached = new CachedEmbeddingProvider(raw, 'synthetic', { persistent: false });
    cleanup.push(() => cached.close());
    const controller = new AbortController();
    const rejected = expect(
      cached.embedBatch(['가', '나', '가'], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await worker.initialize();
    await worker.request('embed');
    controller.abort();
    await rejected;
    const idle = cached.waitForIdle();
    await expectBusy(idle);
    await worker.vectors();
    await idle;
    const next = cached.embedBatch(['나', '가', '나']);
    await worker.vectors(2, 1);
    await expect(next).resolves.toEqual([
      [1, 2],
      [3, 4],
      [1, 2],
    ]);
    cached.close();
    cached.close();
    await expect(cached.embed('닫힘')).rejects.toBeInstanceOf(Error);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('Gemma provider도 소비자 취소와 물리 완료를 구분한다', async () => {
    const worker = gateWorker();
    const raw = new EmbeddingGemmaProvider(options(worker));
    cleanup.push(() => raw.close());
    const controller = new AbortController();
    const rejected = expect(raw.embed('가', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await worker.initialize();
    await worker.request('embed');
    controller.abort();
    await rejected;
    const idle = raw.waitForIdle();
    await expectBusy(idle);
    await worker.vectors(768);
    await idle;
    raw.close();
    raw.close();
    await expect(raw.embedBatch([])).rejects.toBeInstanceOf(Error);
  });

  it('cache 저장이 남아 있으면 소비자 취소 후에도 idle이 아니다', async () => {
    const dbName = `SyntheticOwnerDrain-${crypto.randomUUID()}`;
    const cached = new CachedEmbeddingProvider(
      { embed: () => Promise.resolve([1, 2]), embedBatch: () => Promise.resolve([[1, 2]]) },
      'synthetic-db',
      { dbName },
    );
    cleanup.push(() => cached.close());
    const inspection = (cached as unknown as { db: Dexie }).db;
    const prototype = Object.getPrototypeOf(inspection.table('embeddings')) as {
      put: (...args: unknown[]) => Promise<string>;
    };
    const original = prototype.put;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();
    const put = vi.spyOn(prototype, 'put').mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      entered();
      return gate.then(() => original.apply(this, args));
    });
    const controller = new AbortController();
    const rejected = expect(
      cached.embed('가', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(entered).toHaveBeenCalled());
    controller.abort();
    await rejected;
    const idle = cached.waitForIdle();
    await expectBusy(idle);
    release();
    await idle;
    put.mockRestore();
    inspection.close();
    await cached.deleteDatabase();
  });

  it('명시적 전역 cleanup은 legacy 호출만 종료하고 provider를 종료하지 않는다', async () => {
    const legacyWorker = gateWorker();
    const ownerWorker = gateWorker();
    const legacy = expect(
      embedTernlightBatch(options(legacyWorker), ['가']),
    ).rejects.toBeInstanceOf(Error);
    await legacyWorker.request('initialize');
    const owner = provider(ownerWorker);
    const result = owner.embed('나');
    await ownerWorker.initialize();
    await ownerWorker.request('embed');
    closeTernlightRuntime();
    await legacy;
    expect(ownerWorker.terminate).not.toHaveBeenCalled();
    await ownerWorker.vectors();
    await expect(result).resolves.toEqual([1, 2]);
  });
});

describe('로컬 임베딩 물리 요청 우선 큐', () => {
  it('BG1만 전송하고 ACK 뒤 FG FIFO → BG FIFO로 진행하며 wire에 priority를 싣지 않는다', async () => {
    const worker = gateWorker();
    const runtime = new TernlightWorkerRuntime(worker.create);
    cleanup.push(() => runtime.close());
    const results = [
      runtime.embedBatch(['BG1'], undefined, 'background'),
      runtime.embedBatch(['BG2'], undefined, 'background'),
      runtime.embedBatch(['FG1'], undefined, 'foreground'),
      runtime.embedBatch(['FG2'], undefined, 'foreground'),
      runtime.embedBatch(['BG3'], undefined, 'background'),
    ];
    const idle = runtime.waitForIdle();
    expect(worker.requests.map((request) => request.texts)).toEqual([['BG1']]);
    for (const [index, text] of ['BG1', 'FG1', 'FG2', 'BG2', 'BG3'].entries()) {
      const request = await worker.request('embed', index);
      expect(request.texts).toEqual([text]);
      expect(request).not.toHaveProperty('priority');
      expect(worker.requests).toHaveLength(index + 1);
      await expectBusy(idle);
      await worker.vectors(2, index);
    }
    await expect(Promise.all(results)).resolves.toEqual(Array.from({ length: 5 }, () => [[1, 2]]));
    await idle;
  });

  it.each(['ack', 'error'] as const)(
    'active 취소 뒤 FG와 idle은 실제 %s까지 대기한다',
    async (completion) => {
      const worker = gateWorker();
      const runtime = new TernlightWorkerRuntime(worker.create);
      cleanup.push(() => runtime.close());
      const controller = new AbortController();
      const rejected = expect(
        runtime.embedBatch(['BG'], controller.signal, 'background'),
      ).rejects.toMatchObject({ name: 'AbortError' });
      const fg = runtime.embedBatch(['FG'], undefined, 'foreground');
      const active = await worker.request('embed');
      controller.abort();
      await rejected;
      const idle = runtime.waitForIdle();
      await expectBusy(idle);
      expect(worker.requests).toHaveLength(1);
      if (completion === 'ack') await worker.vectors();
      else worker.respond({ id: active.id, error: 'synthetic ACK error' });
      expect((await worker.request('embed', 1)).texts).toEqual(['FG']);
      await expectBusy(idle);
      await worker.vectors(2, 1);
      await expect(fg).resolves.toEqual([[1, 2]]);
      await idle;
    },
  );

  it('queued abort는 큰 입력의 큐 참조와 listener를 제거하고 worker로 보내지 않는다', async () => {
    const worker = gateWorker();
    const runtime = new TernlightWorkerRuntime(worker.create);
    cleanup.push(() => runtime.close());
    const first = runtime.embedBatch(['active']);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const texts = ['x'.repeat(1024 * 1024)];
    const rejected = expect(
      runtime.embedBatch(texts, controller.signal, 'foreground'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // GC 시점 대신 소유 큐에서 큰 원문 참조가 실제 제거되는지 확인한다.
    const pending = (
      runtime as unknown as {
        pending: Map<number, { message?: TernlightWorkerRequest; transfer?: Transferable[] }>;
      }
    ).pending;
    expect(pending.size).toBe(2);
    const queued = [...pending.values()][1];
    expect(queued.message?.texts).toBe(texts);
    controller.abort();
    await rejected;
    expect(queued.message).toBeUndefined();
    expect(queued.transfer).toBeUndefined();
    expect(pending.size).toBe(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(worker.requests).toHaveLength(1);
    const idle = runtime.waitForIdle();
    await expectBusy(idle);
    await worker.vectors();
    await first;
    await idle;
    expect(pending.size).toBe(0);
    expect(worker.requests).toHaveLength(1);
  });

  it('close는 active·queued initialize 자산·consumer를 같은 Error로 거절하고 늦은 A 응답은 B와 무관하다', async () => {
    const aw = gateWorker();
    const bw = gateWorker();
    const a = new TernlightWorkerRuntime(aw.create);
    const b = new TernlightWorkerRuntime(bw.create);
    cleanup.push(
      () => a.close(),
      () => b.close(),
    );
    const reason = new Error('synthetic owner close');
    const rejected = [
      expect(a.embedBatch(['active'])).rejects.toBe(reason),
      expect(a.initializeAssets({ model: new ArrayBuffer(1024 * 1024) })).rejects.toBe(reason),
      expect(a.embedBatch(['queued'], undefined, 'foreground')).rejects.toBe(reason),
    ];
    const active = await aw.request('embed');
    const entries = [
      ...(
        a as unknown as {
          pending: Map<number, { message?: TernlightWorkerRequest; transfer?: Transferable[] }>;
        }
      ).pending.values(),
    ];
    expect(entries[1].message?.assets?.model.byteLength).toBe(1024 * 1024);
    expect(entries[1].transfer).toHaveLength(1);
    const bResult = b.embedBatch(['B']);
    const idle = a.waitForIdle();
    await expectBusy(idle);
    expect(aw.requests).toHaveLength(1);
    a.close(reason);
    a.close();
    await Promise.all(rejected);
    await idle;
    expect((a as unknown as { pending: Map<number, unknown> }).pending.size).toBe(0);
    expect(aw.terminate).toHaveBeenCalledTimes(1);
    expect(aw.dispose).toHaveBeenCalledTimes(1);
    for (const entry of entries) {
      expect(entry.message).toBeUndefined();
      expect(entry.transfer).toBeUndefined();
    }
    aw.respond({ id: active.id });
    aw.fail();
    await expect(a.embedBatch(['closed'])).rejects.toBeInstanceOf(Error);
    expect(aw.requests).toHaveLength(1);
    expect(bw.terminate).not.toHaveBeenCalled();
    await bw.vectors();
    await expect(bResult).resolves.toEqual([[1, 2]]);
  });

  it('queued postthrow는 원래 Error를 보존하고 마지막 슬롯과 다음 요청을 정착시킨다', async () => {
    const worker = gateWorker();
    const original = new Error('synthetic postthrow');
    const runtime = new TernlightWorkerRuntime(() => {
      const handle = worker.create();
      const post = handle.worker.postMessage.bind(handle.worker);
      handle.worker.postMessage = (request, transfer) => {
        if (request.texts?.[0] === 'throws') throw original;
        post(request, transfer);
      };
      return handle;
    });
    cleanup.push(() => runtime.close());
    const first = runtime.embedBatch(['active']);
    const rejected = expect(runtime.embedBatch(['throws'], undefined, 'foreground')).rejects.toBe(
      original,
    );
    const next = runtime.embedBatch(['next'], undefined, 'background');
    expect(worker.requests).toHaveLength(1);
    const idle = runtime.waitForIdle();
    await worker.vectors();
    await first;
    await rejected;
    expect((await worker.request('embed', 1)).texts).toEqual(['next']);
    await expectBusy(idle);
    await worker.vectors(2, 1);
    await next;
    await idle;
    await expect(runtime.embedBatch(['throws'])).rejects.toBe(original);
    await runtime.waitForIdle();
  });

  it('Ternlight owner도 queued postthrow 뒤 이미 대기한 다음 작업을 닫지 않는다', async () => {
    const worker = gateWorker();
    const original = new Error('synthetic owner dispatch failure');
    const runtime = new TernlightEmbeddingProvider('ternlight-base', {
      ...options(worker),
      createWorker: () => {
        const handle = worker.create();
        const post = handle.worker.postMessage.bind(handle.worker);
        handle.worker.postMessage = (request, transfer) => {
          if (request.texts?.[0] === 'throws') throw original;
          post(request, transfer);
        };
        return handle;
      },
    });
    cleanup.push(() => runtime.close());
    const first = runtime.embedBatch(['active']);
    await worker.initialize();
    await worker.request('embed');
    const rejected = expect(runtime.embed('throws')).rejects.toBe(original);
    const next = runtime.embedBatch(['next']);
    const observedNext = expect(next).resolves.toEqual([[1, 2]]);
    void observedNext.catch(() => undefined);
    await expectBusy(runtime.waitForIdle());
    await worker.vectors();
    await first;
    await rejected;
    await worker.request('embed', 1);
    await expectBusy(runtime.waitForIdle());
    expect(worker.terminate).not.toHaveBeenCalled();
    await worker.vectors(2, 1);
    await observedNext;
    await runtime.waitForIdle();
    expect(worker.terminate).not.toHaveBeenCalled();
    const lastRejected = expect(runtime.embed('throws')).rejects.toBe(original);
    await lastRejected;
    const last = runtime.embed('after failure');
    await worker.vectors(2, 2);
    await expect(last).resolves.toEqual([1, 2]);
    expect(worker.requests.filter((request) => request.operation === 'initialize')).toHaveLength(1);
  });

  it.each(['ternlight', 'gemma'] as const)(
    '%s owner close는 active와 queued 소비자를 함께 거절하고 B는 보존한다',
    async (kind) => {
      const aw = gateWorker();
      const bw = gateWorker();
      const a = kind === 'ternlight' ? provider(aw) : new EmbeddingGemmaProvider(options(aw));
      const b = kind === 'ternlight' ? provider(bw) : new EmbeddingGemmaProvider(options(bw));
      cleanup.push(
        () => a.close(),
        () => b.close(),
      );
      const first = a.embedBatch(['active']);
      await aw.initialize();
      const active = await aw.request('embed');
      const second = a.embedBatch(['queued BG']);
      const third = a.embed('queued FG');
      const settled = Promise.allSettled([first, second, third]);
      const bResult = b.embed('B');
      await bw.initialize();
      await bw.request('embed');
      await expectBusy(a.waitForIdle());
      expect(aw.requests).toHaveLength(2);
      a.close();
      a.close();
      const outcomes = await settled;
      expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
      const errors = outcomes.map((outcome) =>
        outcome.status === 'rejected' ? (outcome.reason as unknown) : undefined,
      );
      expect(errors[0]).toBeInstanceOf(Error);
      expect(errors[1]).toBe(errors[0]);
      expect(errors[2]).toBe(errors[0]);
      await a.waitForIdle();
      aw.respond({ id: active.id, error: 'synthetic late A response' });
      aw.fail();
      expect(aw.terminate).toHaveBeenCalledTimes(1);
      expect(aw.requests).toHaveLength(2);
      expect(bw.terminate).not.toHaveBeenCalled();
      await bw.vectors(kind === 'ternlight' ? 2 : 768);
      await expect(bResult).resolves.toHaveLength(kind === 'ternlight' ? 2 : 768);
      await expect(a.embed('closed')).rejects.toBeInstanceOf(Error);
    },
  );

  it('치명적 Ternlight worker 오류 뒤에는 같은 owner가 새 worker로 복구한다', async () => {
    const aw = gateWorker();
    const bw = gateWorker();
    const create = vi.fn().mockImplementationOnce(aw.create).mockImplementationOnce(bw.create);
    const runtime = new TernlightEmbeddingProvider('ternlight-base', {
      ...options(aw),
      createWorker: create,
    });
    cleanup.push(() => runtime.close());
    const rejected = expect(runtime.embed('A')).rejects.toBeInstanceOf(Error);
    await aw.initialize();
    const active = await aw.request('embed');
    aw.fail();
    await rejected;
    expect(aw.terminate).toHaveBeenCalledTimes(1);
    const next = runtime.embed('B');
    await bw.initialize();
    aw.respond({ id: active.id, error: 'synthetic late A error' });
    expect(bw.terminate).not.toHaveBeenCalled();
    await bw.vectors();
    await expect(next).resolves.toEqual([1, 2]);
    await runtime.waitForIdle();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each(['ternlight', 'gemma'] as const)(
    '%s는 동시 초기화를 합치고 cache miss의 기본·명시 priority와 입력 순서를 보존한다',
    async (kind) => {
      const worker = gateWorker();
      const raw =
        kind === 'ternlight' ? provider(worker) : new EmbeddingGemmaProvider(options(worker));
      const cached = new CachedEmbeddingProvider(raw, 'synthetic-priority', { persistent: false });
      cleanup.push(() => cached.close());
      const bg1 = cached.embedBatch(['BG1', 'BG1']);
      await worker.request('initialize');
      const bg2 = cached.embedBatch(['BG2']);
      const fg = cached.embed('FG');
      const explicitFg = cached.embedBatch(['explicit FG'], { priority: 'foreground' });
      const explicitBg = cached.embed('explicit BG', { priority: 'background' });
      await expectBusy(cached.waitForIdle());
      expect(worker.requests.map((request) => request.operation)).toEqual(['initialize']);
      await worker.initialize();
      const dimensions = kind === 'ternlight' ? 2 : 768;
      const vector = Array.from({ length: dimensions }, (_, i) => i + 1);
      for (const [index, text] of ['BG1', 'FG', 'explicit FG', 'BG2', 'explicit BG'].entries()) {
        expect((await worker.request('embed', index)).texts).toEqual([text]);
        expect(worker.requests.filter((request) => request.operation === 'embed')).toHaveLength(
          index + 1,
        );
        // 다음 cache miss가 큐에 들어올 시간을 주되 물리 ACK는 아직 보내지 않는다.
        await expectBusy(cached.waitForIdle());
        await worker.vectors(dimensions, index);
      }
      await expect(bg1).resolves.toEqual([vector, vector]);
      await expect(bg2).resolves.toEqual([vector]);
      await expect(fg).resolves.toEqual(vector);
      await expect(explicitFg).resolves.toEqual([vector]);
      await expect(explicitBg).resolves.toEqual(vector);
      await cached.waitForIdle();
      await expect(cached.embed('FG', { priority: 'background' })).resolves.toEqual(vector);
      await expect(cached.embedBatch(['BG1', 'BG1'], { priority: 'foreground' })).resolves.toEqual([
        vector,
        vector,
      ]);
      expect(worker.requests).toHaveLength(6);
      expect(models.prepare).toHaveBeenCalledTimes(1);
      expect(worker.requests.filter((request) => request.operation === 'initialize')).toHaveLength(
        1,
      );
    },
  );
});
