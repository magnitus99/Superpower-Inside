import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import type { App } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTernlightRuntime,
  embedTernlightBatch,
  type TernlightWorkerAdapter,
  type TernlightWorkerFactory,
  type TernlightWorkerResponse,
} from './ternlight-runtime';
import { TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';
import { TERNLIGHT_WORKER_SOURCE } from '../../generated/ternlight-worker-source';

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path,
  requestUrl: vi.fn(),
}));

afterEach(() => closeTernlightRuntime());

describe('Ternlight worker runtime', () => {
  it('initializes the production worker bundle and returns a normalized 384-dimensional vector', async () => {
    const worker = createNodeWorker();
    try {
      const bytes = readFileSync(join(process.cwd(), TERNLIGHT_MODEL_FILE_NAME));
      const model = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const initialized = waitForNodeWorkerResponse(worker, 1);
      worker.postMessage({ id: 1, operation: 'initialize', wasmBytes: model }, [model]);
      await expect(initialized).resolves.toEqual(expect.objectContaining({ id: 1 }));

      const embedded = waitForNodeWorkerResponse(worker, 2);
      worker.postMessage({ id: 2, operation: 'embed', texts: ['semantic search'] });
      const response = await embedded;
      expect(response.error).toBeUndefined();
      expect(response.dimensions).toBe(384);
      expect(response.rows).toBe(1);
      if (!response.values) throw new Error('Ternlight worker response is missing vector data.');
      const vector = new Float32Array(response.values);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    } finally {
      await worker.terminate();
    }
  });

  it('sends the complete embedding batch to a worker and reconstructs its vectors', async () => {
    const factory = createFakeWorkerFactory((texts) =>
      texts.map((text) => [text.length, text.length + 1]),
    );

    await expect(
      embedTernlightBatch(createRuntimeOptions(factory.create), ['alpha', 'beta']),
    ).resolves.toEqual([
      [5, 6],
      [4, 5],
    ]);

    expect(factory.operations).toEqual(['initialize', 'embed']);
    expect(factory.embedInputs).toEqual([['alpha', 'beta']]);
    expect(factory.terminated).toHaveBeenCalledTimes(0);
  });

  it('terminates the worker when an embedding request is cancelled', async () => {
    const factory = createFakeWorkerFactory(() => new Promise<number[][]>(() => undefined));
    const controller = new AbortController();
    const embedding = embedTernlightBatch(
      createRuntimeOptions(factory.create, 'cancel-test'),
      ['slow input'],
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();

    await expect(embedding).rejects.toMatchObject({ name: 'AbortError' });
    expect(factory.terminated).toHaveBeenCalledTimes(1);
  });
});

function createRuntimeOptions(createWorker: TernlightWorkerFactory, version = 'worker-test') {
  const bytes = readFileSync(join(process.cwd(), TERNLIGHT_MODEL_FILE_NAME));
  const model = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    app: {
      vault: {
        configDir: '.obsidian',
        adapter: {
          exists: vi.fn().mockResolvedValue(true),
          readBinary: vi.fn().mockResolvedValue(model),
          writeBinary: vi.fn(),
          remove: vi.fn(),
          rename: vi.fn(),
        },
      },
    } as unknown as App,
    pluginId: 'superpower-inside',
    pluginVersion: version,
    createWorker,
  };
}

function createFakeWorkerFactory(embed: (texts: string[]) => number[][] | Promise<number[][]>): {
  create: TernlightWorkerFactory;
  operations: string[];
  embedInputs: string[][];
  terminated: ReturnType<typeof vi.fn>;
} {
  const operations: string[] = [];
  const embedInputs: string[][] = [];
  const terminated = vi.fn();
  const create: TernlightWorkerFactory = () => {
    let onMessage: ((event: MessageEvent<TernlightWorkerResponse>) => void) | undefined;
    let onError: ((event: ErrorEvent) => void) | undefined;
    const worker: TernlightWorkerAdapter = {
      setOnMessage: (handler) => {
        onMessage = handler;
      },
      setOnError: (handler) => {
        onError = handler;
      },
      postMessage: (message) => {
        operations.push(message.operation);
        if (message.operation === 'initialize') {
          queueMicrotask(() => onMessage?.(messageEvent({ id: message.id })));
          return;
        }
        const texts = message.texts ?? [];
        embedInputs.push(texts);
        void Promise.resolve(embed(texts)).then(
          (vectors) => {
            const dimensions = vectors[0]?.length ?? 0;
            const values = new Float32Array(vectors.length * dimensions);
            vectors.forEach((vector, row) => values.set(vector, row * dimensions));
            onMessage?.(
              messageEvent({
                id: message.id,
                dimensions,
                rows: vectors.length,
                values: values.buffer,
              }),
            );
          },
          (error: unknown) =>
            onError?.({
              message: error instanceof Error ? error.message : String(error),
            } as ErrorEvent),
        );
      },
      terminate: terminated,
    };
    return { worker, dispose: vi.fn() };
  };
  return { create, operations, embedInputs, terminated };
}

function messageEvent(data: TernlightWorkerResponse): MessageEvent<TernlightWorkerResponse> {
  return { data } as MessageEvent<TernlightWorkerResponse>;
}

function createNodeWorker(): NodeWorker {
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = {
      postMessage(message, options) {
        parentPort.postMessage(message, options?.transfer ?? []);
      },
    };
    ${TERNLIGHT_WORKER_SOURCE}
    parentPort.on('message', (data) => globalThis.self.onmessage({ data }));
  `;
  return new NodeWorker(bootstrap, { eval: true });
}

function waitForNodeWorkerResponse(
  worker: NodeWorker,
  id: number,
): Promise<TernlightWorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: TernlightWorkerResponse): void => {
      if (response.id !== id) return;
      cleanup();
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
