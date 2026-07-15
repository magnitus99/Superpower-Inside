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

  it('검색이 취소되면 계산 중인 worker를 종료한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('test-db', '');
    fixture.respond({ id: 1, ready: true, tokenizerCurrent: true, totalDocs: 1 });
    await initialization;
    const controller = new AbortController();
    const search = runtime.searchTop('slow query', 10, controller.signal);

    controller.abort();

    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.terminate).toHaveBeenCalledOnce();
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
  error?: string;
}

function createNodeWorker(): NodeWorker {
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = {
      postMessage(message) {
        parentPort.postMessage(message);
      },
    };
    ${BM25_WORKER_SOURCE}
    parentPort.on('message', (data) => globalThis.self.onmessage({ data }));
  `;
  return new NodeWorker(bootstrap, { eval: true });
}

function waitForNodeWorkerResponse(worker: NodeWorker, id: number): Promise<NodeWorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: NodeWorkerResponse): void => {
      if (response.id !== id) return;
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
