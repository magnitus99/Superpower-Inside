import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BM25_WORKER_SOURCE } from '../../generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import { RustBm25RuntimeIndex } from './rust-core';
import {
  BM25WorkerRuntime,
  type BM25WorkerAdapter,
  type BM25WorkerFactory,
  type BM25WorkerResponse,
} from './bm25-worker-runtime';

afterEach(() => vi.useRealTimers());

describe('BM25 worker runtime', () => {
  it('저장 문서가 WASM 묶음 한도를 넘더라도 생성된 작업자가 전부 복원한다', async () => {
    const worker = createNodeWorker({ persistedFixture: true });
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        dbName: 'persisted-worker-test',
        snapshot: '',
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 300 }),
      );
      const searched = waitForNodeWorkerResponse(worker, 2);
      worker.postMessage({ id: 2, operation: 'search-top', query: 'lastdocument', limit: 1 });
      await expect(searched).resolves.toEqual(
        expect.objectContaining({ hits: [expect.objectContaining({ docId: 'doc-299' })] }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들에서 BM25 복원과 검색을 수행한다', async () => {
    const worker = createNodeWorker();
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        snapshot: '',
        documents: [
          { id: 'alpha::0', text: 'renderer safe lexical search', sourcePath: 'alpha.md' },
        ],
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ id: 1, ready: true, totalDocs: 1 }),
      );

      const searched = waitForNodeWorkerResponse(worker, 2);
      worker.postMessage({ id: 2, operation: 'search-top', query: 'lexical', limit: 5 });
      await expect(searched).resolves.toEqual(
        expect.objectContaining({
          id: 2,
          hits: [expect.objectContaining({ docId: 'alpha::0', sourcePath: 'alpha.md' })],
        }),
      );

      const batched = waitForNodeWorkerResponse(worker, 3);
      worker.postMessage({
        id: 3,
        operation: 'batch',
        queries: [{ query: 'lexical', limit: 5 }],
        aggregates: [{ query: 'lexical', limit: 5, allowedPaths: ['alpha.md'] }],
      });
      const batchResponse = await batched;
      expect(batchResponse).toEqual(expect.objectContaining({ id: 3 }));
      expect(JSON.parse(batchResponse.batchJson ?? '{}')).toMatchObject({
        queries: [{ hits: [expect.objectContaining({ sourcePath: 'alpha.md', rank: 1 })] }],
        aggregates: [expect.objectContaining({ totalDocuments: 1, totalOccurrences: 1 })],
      });
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들이 단건 추가 필드와 제목 전용 토큰을 스냅샷 복원 뒤에도 유지한다', async () => {
    const worker = createNodeWorker();
    try {
      const rebuilt = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({ id: 1, operation: 'rebuild', wasmBase64: RAG_WASM_BASE64, documents: [] });
      await expect(rebuilt).resolves.toEqual(expect.objectContaining({ totalDocs: 0 }));

      const indexed = waitForNodeWorkerResponse(worker, 2);
      worker.postMessage({
        id: 2,
        operation: 'add',
        document: {
          id: 'fielded::0',
          text: 'alpha beta body',
          sourcePath: 'reports/ledger.md',
          title: 'Quarterly Ledger',
          headings: ['Deployment Guide'],
          tags: ['finance'],
        },
      });
      await expect(indexed).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1 }),
      );

      for (const [id, query] of [
        [3, 'title:quarterly'],
        [4, 'headings:deployment'],
        [5, 'tags:finance'],
        [6, 'path:ledger'],
      ] as const) {
        const searched = waitForNodeWorkerResponse(worker, id);
        worker.postMessage({ id, operation: 'search-top', query, limit: 5 });
        await expect(searched).resolves.toEqual(
          expect.objectContaining({
            hits: [
              expect.objectContaining({ docId: 'fielded::0', sourcePath: 'reports/ledger.md' }),
            ],
          }),
        );
      }

      const serialized = waitForNodeWorkerResponse(worker, 7);
      worker.postMessage({ id: 7, operation: 'serialize' });
      const snapshot = (await serialized).snapshot;
      expect(typeof snapshot).toBe('string');

      const restored = waitForNodeWorkerResponse(worker, 8);
      worker.postMessage({ id: 8, operation: 'initialize', wasmBase64: RAG_WASM_BASE64, snapshot });
      await expect(restored).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1 }),
      );

      const titleOnly = waitForNodeWorkerResponse(worker, 9);
      worker.postMessage({ id: 9, operation: 'search-top', query: 'title:quarterly', limit: 5 });
      await expect(titleOnly).resolves.toEqual(
        expect.objectContaining({
          hits: [expect.objectContaining({ docId: 'fielded::0', sourcePath: 'reports/ledger.md' })],
        }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들이 위치 정보 없는 스냅샷을 거절하고 저장 원문에서 전량 복구한다', async () => {
    const dbName = 'legacy-snapshot-fixture';
    const legacySnapshot = createLegacySnapshotWithoutPosition();
    const worker = createNodeWorker({
      legacyFixture: {
        dbName,
        documents: [{ id: 'legacy::0', text: 'alpha beta', sourcePath: 'legacy.md', order: 1 }],
      },
    });
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        dbName,
        snapshot: legacySnapshot,
        sinceOrder: 100,
        expectedDocs: 1,
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1, snapshotRejected: true }),
      );

      const recovered = waitForNodeWorkerResponse(worker, 2);
      worker.postMessage({ id: 2, operation: 'search-top', query: '"alpha beta"', limit: 5 });
      await expect(recovered).resolves.toEqual(
        expect.objectContaining({
          hits: [expect.objectContaining({ docId: 'legacy::0', sourcePath: 'legacy.md' })],
        }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('시간 제한을 넘긴 worker를 종료하고 대기 작업을 거부한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('test-db', '');
    const rejected = expect(initialization).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(500);

    await rejected;
    expect(fixture.terminate).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it('앞선 복원 대기 시간은 다음 검색의 실행 제한에서 제외한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('queued-test-db', '');
    const search = runtime.searchTop('independent query', 10);
    const results = Promise.allSettled([initialization, search]);

    await vi.advanceTimersByTimeAsync(450);
    expect(fixture.terminate).not.toHaveBeenCalled();
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, ready: true, tokenizerCurrent: true, totalDocs: 1 });
    expect(fixture.postMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90);
    fixture.respond({ id: 2, hits: [{ docId: 'result', sourcePath: 'result.md', score: 1 }] });

    expect((await results).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(fixture.terminate).not.toHaveBeenCalled();
    runtime.close();
  });

  it('대기 중 취소한 요청은 작업자에게 보내지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const first = runtime.searchTop('first query', 10);
    const controller = new AbortController();
    const cancelled = runtime.aggregate('cancelled query', 10, controller.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = runtime.searchTop('next query', 10);
    controller.abort();
    await cancellation;

    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, hits: [] });
    await first;
    expect(fixture.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 3, operation: 'search-top' }),
    );
    fixture.respond({ id: 3, hits: [] });
    await expect(next).resolves.toEqual([]);
    runtime.close();
  });

  it('실행 중 취소는 즉시 알리되 늦은 응답 전에는 다음 요청을 실행하지 않는다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const controller = new AbortController();
    const cancelled = runtime.searchTop('first query', 10, controller.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = runtime.searchTop('next query', 10);
    controller.abort();
    await cancellation;

    await vi.advanceTimersByTimeAsync(90);
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, hits: [] });
    await vi.advanceTimersByTimeAsync(90);
    fixture.respond({ id: 2, hits: [] });
    await expect(next).resolves.toEqual([]);
    expect(fixture.terminate).not.toHaveBeenCalled();
    runtime.close();
  });

  it('실행 중 요청이 멈추면 대기 요청도 거부하고 작업자를 종료한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const first = runtime.searchTop('first query', 10);
    const next = runtime.aggregate('next query', 10);
    const results = Promise.allSettled([first, next]);

    await vi.advanceTimersByTimeAsync(100);

    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    expect(fixture.terminate).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it('문서 hydration 진행 신호가 오면 무응답 제한을 다시 계산한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('large-test-db', '');

    await vi.advanceTimersByTimeAsync(75);
    fixture.respond({
      id: 1,
      progress: { processedDocuments: 128 },
    });
    await vi.advanceTimersByTimeAsync(75);
    fixture.respond({
      id: 1,
      ready: true,
      tokenizerCurrent: true,
      totalDocs: 256,
    });

    await expect(initialization).resolves.toEqual(
      expect.objectContaining({ ready: true, totalDocs: 256 }),
    );
    expect(fixture.terminate).not.toHaveBeenCalled();
  });

  it('검색 취소와 늦은 응답 뒤에도 다음 검색과 작업자를 보존한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('test-db', '');
    fixture.respond({ id: 1, ready: true, tokenizerCurrent: true, totalDocs: 1 });
    await initialization;
    const controller = new AbortController();
    const search = runtime.searchTop('slow query', 10, controller.signal);

    controller.abort();

    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.terminate).not.toHaveBeenCalled();
    fixture.respond({ id: 2, hits: [{ docId: 'late', sourcePath: 'late.md', score: 1 }] });
    const next = runtime.searchTop('next query', 10);
    fixture.respond({ id: 3, hits: [{ docId: 'next', sourcePath: 'next.md', score: 2 }] });
    await expect(next).resolves.toEqual([{ docId: 'next', sourcePath: 'next.md', score: 2 }]);
    runtime.close();
  });
});

function createFakeWorker(): {
  create: BM25WorkerFactory;
  respond(response: BM25WorkerResponse): void;
  terminate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
} {
  let onMessage: ((event: MessageEvent<BM25WorkerResponse>) => void) | null = null;
  const terminate = vi.fn();
  const dispose = vi.fn();
  const postMessage = vi.fn();
  const worker: BM25WorkerAdapter = {
    postMessage,
    terminate,
    setOnMessage: (handler) => {
      onMessage = handler;
    },
    setOnError: vi.fn(),
  };
  return {
    create: () => ({ worker, dispose }),
    respond: (response) => {
      onMessage?.({ data: response } as MessageEvent<BM25WorkerResponse>);
    },
    terminate,
    dispose,
    postMessage,
  };
}

interface NodeWorkerResponse {
  id: number;
  ready?: boolean;
  totalDocs?: number;
  snapshot?: string;
  snapshotRejected?: boolean;
  hits?: Array<{ docId: string; sourcePath: string; score: number }>;
  batchJson?: string;
  progress?: { processedDocuments: number };
  error?: string;
}

interface NodeWorkerFixture {
  dbName: string;
  documents: Array<Record<string, unknown>>;
}

function createNodeWorker(
  options: { persistedFixture?: boolean; legacyFixture?: NodeWorkerFixture } = {},
): NodeWorker {
  const persistedSeed = options.persistedFixture
    ? `
      await new Promise((resolve, reject) => {
        const opened = indexedDB.open('persisted-worker-test', 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore('documents', { keyPath: 'id' });
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result;
          const transaction = db.transaction('documents', 'readwrite');
          for (let index = 0; index < 300; index++) transaction.objectStore('documents').put({ id: 'doc-' + index, text: index === 299 ? 'lastdocument' : 'ordinary document', sourcePath: 'a.md' });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    `
    : '';
  const legacySeed = options.legacyFixture
    ? `
      await new Promise((resolve, reject) => {
        const opened = indexedDB.open(${JSON.stringify(options.legacyFixture.dbName)}, 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore('documents', { keyPath: 'id' });
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result;
          const transaction = db.transaction('documents', 'readwrite');
          for (const document of ${JSON.stringify(options.legacyFixture.documents)}) transaction.objectStore('documents').put(document);
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    `
    : '';
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    require('fake-indexeddb/auto');
    globalThis.self = {
      postMessage(message) {
        parentPort.postMessage(message);
      },
    };
    ${BM25_WORKER_SOURCE}
    const ready = (async () => {
      ${persistedSeed}
      ${legacySeed}
    })();
    parentPort.on('message', (data) => { void ready.then(() => globalThis.self.onmessage({ data })); });
  `;
  return new NodeWorker(bootstrap, { eval: true });
}

function createLegacySnapshotWithoutPosition(): string {
  const runtime = RustBm25RuntimeIndex.empty(2);
  if (!runtime) throw new Error('WASM 초기화 실패');
  try {
    runtime.addDocument('legacy::0', 'alpha beta', 'legacy.md', 2);
    const snapshot = JSON.parse(runtime.toJson()) as {
      docs: Array<Record<string, unknown>>;
      terms: Array<Record<string, unknown>>;
    };
    for (const document of snapshot.docs) delete document.runs;
    for (const term of snapshot.terms) delete term.pos;
    return JSON.stringify(snapshot);
  } finally {
    runtime.dispose();
  }
}

function waitForNodeWorkerResponse(worker: NodeWorker, id: number): Promise<NodeWorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: NodeWorkerResponse): void => {
      if (response.id !== id) return;
      if (response.progress) return;
      cleanup();
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });
}
