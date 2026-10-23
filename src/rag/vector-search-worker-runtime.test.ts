import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VECTOR_SEARCH_WORKER_SOURCE } from '../../generated/vector-search-worker-source';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import {
  VectorSearchWorkerRuntime,
  type VectorSearchWorkerAdapter,
  type VectorSearchWorkerFactory,
  type VectorSearchWorkerResponse,
} from './vector-search-worker-runtime';

afterEach(() => vi.useRealTimers());

describe('대형 볼트 vector search worker', () => {
  it('생성된 worker 번들에서 Rust exact index를 만들고 상위 id와 점수를 반환한다', async () => {
    const worker = createNodeWorker();
    try {
      const response = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({
        id: 1,
        operation: 'search',
        wasmBase64: RAG_WASM_BASE64,
        dbName: 'fixture',
        queryVector: [1, 0],
        topK: 2,
        filter: { dimension: 2 },
        records: [
          { id: 'alpha', vector: [1, 0], dimension: 2 },
          { id: 'beta', vector: [0, 1], dimension: 2 },
          { id: 'gamma', vector: [0.8, 0.2], dimension: 2 },
        ],
      });

      await expect(response).resolves.toEqual(
        expect.objectContaining({
          id: 1,
          indexedCount: 3,
          hits: [
            expect.objectContaining({ id: 'alpha' }),
            expect.objectContaining({ id: 'gamma' }),
          ],
        }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('폴더·파일 범위와 형제 경로를 구별하며 범위마다 색인을 다시 만들지 않는다', async () => {
    const worker = createNodeWorker();
    const records = [
      { id: 'inside', filePath: 'notes/a.md', dimension: 2, vector: [1, 0] },
      { id: 'sibling', filePath: 'notes-other/a.md', dimension: 2, vector: [1, 0] },
      { id: 'other', filePath: 'other.md', dimension: 2, vector: [1, 0] },
    ];
    try {
      for (const [index, prefix, expected] of [
        [1, 'notes', 'inside'],
        [2, 'other.md', 'other'],
      ] as const) {
        const response = waitForNodeWorkerResponse(worker, index);
        worker.postMessage({
          id: index,
          operation: 'search',
          wasmBase64: RAG_WASM_BASE64,
          dbName: 'scoped',
          queryVector: [1, 0],
          topK: 5,
          filter: { dimension: 2, filePathPrefixes: [prefix] },
          records,
        });
        await expect(response).resolves.toMatchObject({
          indexedCount: 3,
          hits: [{ id: expected, score: 1 }],
        });
      }
    } finally {
      await worker.terminate();
    }
  });

  it('취소된 요청만 거부하고 준비 중인 worker 자체는 유지한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new VectorSearchWorkerRuntime(fixture.create);
    const controller = new AbortController();
    const search = runtime.search({
      dbName: 'test-db',
      queryVector: [1, 0],
      topK: 1,
      signal: controller.signal,
    });

    controller.abort();

    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.terminate).not.toHaveBeenCalled();
    fixture.respond({ id: 1, hits: [{ id: 'late', score: 1 }] });
    runtime.close();
  });

  it('시간 제한을 넘긴 worker는 종료해 정지된 검색을 남기지 않는다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new VectorSearchWorkerRuntime(fixture.create, 100);
    const search = runtime.search({ dbName: 'test-db', queryVector: [1, 0], topK: 1 });
    const rejected = expect(search).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);

    await rejected;
    expect(fixture.terminate).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });
});

function createFakeWorker(): {
  create: VectorSearchWorkerFactory;
  respond(response: VectorSearchWorkerResponse): void;
  terminate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  let onMessage: ((event: MessageEvent<VectorSearchWorkerResponse>) => void) | null = null;
  const terminate = vi.fn();
  const dispose = vi.fn();
  const worker: VectorSearchWorkerAdapter = {
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
      onMessage?.({ data: response } as MessageEvent<VectorSearchWorkerResponse>);
    },
    terminate,
    dispose,
  };
}

interface NodeWorkerResponse {
  id: number;
  indexedCount?: number;
  hits?: Array<{ id: string; score: number }>;
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
    ${VECTOR_SEARCH_WORKER_SOURCE}
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
