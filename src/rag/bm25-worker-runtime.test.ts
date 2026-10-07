import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BM25_WORKER_SOURCE } from '../../generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import {
  BM25WorkerRuntime,
  type BM25WorkerAdapter,
  type BM25WorkerFactory,
  type BM25WorkerResponse,
} from './bm25-worker-runtime';

afterEach(() => vi.useRealTimers());

describe('BM25 worker runtime', () => {
  it('저장 문서가 WASM 묶음 한도를 넘더라도 생성된 작업자가 전부 복원한다', async () => {
    const worker = createNodeWorker(true);
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

    await vi.advanceTimersByTimeAsync(100);

    await rejected;
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
} {
  let onMessage: ((event: MessageEvent<BM25WorkerResponse>) => void) | null = null;
  const terminate = vi.fn();
  const dispose = vi.fn();
  const worker: BM25WorkerAdapter = {
    postMessage: vi.fn(),
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
  };
}

interface NodeWorkerResponse {
  id: number;
  ready?: boolean;
  totalDocs?: number;
  hits?: Array<{ docId: string; sourcePath: string; score: number }>;
  progress?: { processedDocuments: number };
  error?: string;
}

function createNodeWorker(persistedFixture = false): NodeWorker {
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    require('fake-indexeddb/auto');
    const ready = ${persistedFixture} ? new Promise((resolve, reject) => {
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
    }) : Promise.resolve();
    globalThis.self = {
      postMessage(message) {
        parentPort.postMessage(message);
      },
    };
    ${BM25_WORKER_SOURCE}
    parentPort.on('message', (data) => { void ready.then(() => globalThis.self.onmessage({ data })); });
  `;
  return new NodeWorker(bootstrap, { eval: true });
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
