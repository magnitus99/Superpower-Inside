import { type App } from 'obsidian';

import { TERNLIGHT_WORKER_SOURCE } from '../../generated/ternlight-worker-source';
import { TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';
import { getLocalEmbeddingModels } from './local-embedding-models';

export interface TernlightRuntimeOptions {
  app: App;
  pluginId: string;
  pluginVersion: string;
  createWorker?: TernlightWorkerFactory;
}

export interface TernlightWorkerRequest {
  id: number;
  operation: 'initialize' | 'embed';
  wasmBytes?: ArrayBuffer;
  assets?: Record<string, ArrayBuffer>;
  texts?: string[];
}

export interface TernlightWorkerResponse {
  id: number;
  dimensions?: number;
  rows?: number;
  values?: ArrayBuffer;
  error?: string;
  backend?: 'webgpu' | 'wasm';
  threads?: number;
  fallbackReason?: string;
}

export interface TernlightWorkerAdapter {
  setOnError(handler: (event: ErrorEvent) => void): void;
  setOnMessage(handler: (event: MessageEvent<TernlightWorkerResponse>) => void): void;
  postMessage(message: TernlightWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface TernlightWorkerHandle {
  worker: TernlightWorkerAdapter;
  dispose(): void;
}

export type TernlightWorkerFactory = () => TernlightWorkerHandle;

interface PendingRequest {
  resolve(response: TernlightWorkerResponse): void;
  reject(error: Error): void;
  removeAbortListener(): void;
}

export class TernlightWorkerRuntime {
  private readonly worker: TernlightWorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(
    createWorker: TernlightWorkerFactory,
    private readonly onRuntimeStatus?: (response: TernlightWorkerResponse) => void,
  ) {
    const handle = createWorker();
    this.worker = handle.worker;
    this.disposeWorker = () => handle.dispose();
    this.worker.setOnMessage((event) => this.handleMessage(event.data));
    this.worker.setOnError((event) => {
      this.close(new Error(event.message || 'Ternlight worker failed.'));
    });
  }

  async initialize(wasmBytes: ArrayBuffer): Promise<void> {
    await this.request({ operation: 'initialize', wasmBytes }, undefined, [wasmBytes]);
  }

  async initializeAssets(assets: Record<string, ArrayBuffer>): Promise<void> {
    await this.request({ operation: 'initialize', assets }, undefined, Object.values(assets));
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await this.request({ operation: 'embed', texts }, signal);
    const rows = response.rows;
    const dimensions = response.dimensions;
    const values = response.values;
    if (
      rows !== texts.length ||
      dimensions === undefined ||
      !Number.isSafeInteger(dimensions) ||
      dimensions <= 0 ||
      values === undefined
    ) {
      throw new Error('Ternlight worker returned invalid vector metadata.');
    }
    const flattened = new Float32Array(values);
    if (flattened.length !== rows * dimensions) {
      throw new Error('Ternlight worker returned an invalid vector payload.');
    }
    return Array.from({ length: rows }, (_, row) =>
      Array.from(flattened.subarray(row * dimensions, (row + 1) * dimensions)),
    );
  }

  close(reason = new Error('Ternlight worker was closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.disposeWorker();
    for (const request of this.pending.values()) {
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
  }

  private request(
    request: Omit<TernlightWorkerRequest, 'id'>,
    signal?: AbortSignal,
    transfer?: Transferable[],
  ): Promise<TernlightWorkerResponse> {
    if (this.closed) return Promise.reject(new Error('Ternlight worker is closed.'));
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Ternlight embedding cancelled.', 'AbortError'));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.removeAbortListener();
        pending.reject(new DOMException('Ternlight embedding cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      this.worker.postMessage({ id, ...request }, transfer);
    });
  }

  private handleMessage(response: TernlightWorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    request.removeAbortListener();
    if (response.error) {
      request.reject(new Error(response.error));
      return;
    }
    this.onRuntimeStatus?.(response);
    request.resolve(response);
  }
}

let initialization: Promise<TernlightWorkerRuntime> | null = null;
let initializationKey = '';
let activeRuntime: TernlightWorkerRuntime | null = null;
let runtimeRevision = 0;

export async function embedTernlightBatch(
  options: TernlightRuntimeOptions,
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (signal?.aborted) {
    throw new DOMException('Ternlight embedding cancelled.', 'AbortError');
  }
  if (texts.length === 0) return [];
  const runtime = await getTernlightRuntime(options);
  try {
    return await runtime.embedBatch(texts, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
      throw error;
    if (initializationKey === createInitializationKey(options)) {
      runtime.close();
      if (activeRuntime === runtime) activeRuntime = null;
      initialization = null;
    }
    throw error;
  }
}

async function getTernlightRuntime(
  options: TernlightRuntimeOptions,
): Promise<TernlightWorkerRuntime> {
  const nextKey = createInitializationKey(options);
  if (initializationKey !== nextKey) {
    runtimeRevision++;
    activeRuntime?.close();
    activeRuntime = null;
    initialization = null;
    initializationKey = nextKey;
  }
  const revision = runtimeRevision;
  initialization ??= initializeTernlight(options, revision).catch((error: unknown) => {
    if (revision === runtimeRevision) initialization = null;
    throw error;
  });
  return initialization;
}

async function initializeTernlight(
  options: TernlightRuntimeOptions,
  revision: number,
): Promise<TernlightWorkerRuntime> {
  const models = getLocalEmbeddingModels(options);
  await models.prepare('ternlight-base', false);
  const wasmBytes = await models.read('ternlight-base', TERNLIGHT_MODEL_FILE_NAME);
  if (revision !== runtimeRevision) throw new Error('Ternlight initialization was cancelled.');
  const runtime = new TernlightWorkerRuntime(options.createWorker ?? createBrowserWorker);
  try {
    await runtime.initialize(wasmBytes);
    if (revision !== runtimeRevision) throw new Error('Ternlight initialization was cancelled.');
    activeRuntime = runtime;
    return runtime;
  } catch (error) {
    runtime.close();
    throw error;
  }
}

export function closeTernlightRuntime(): void {
  runtimeRevision++;
  activeRuntime?.close();
  activeRuntime = null;
  initialization = null;
  initializationKey = '';
}

function createInitializationKey(options: TernlightRuntimeOptions): string {
  return `${options.app.vault.configDir}:${options.pluginId}:${options.pluginVersion}`;
}

function createBrowserWorker(): TernlightWorkerHandle {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Ternlight requires Web Worker support to protect the Obsidian renderer.');
  }
  const workerUrl = URL.createObjectURL(
    new Blob([TERNLIGHT_WORKER_SOURCE], { type: 'text/javascript' }),
  );
  const browserWorker = new Worker(workerUrl);
  return {
    worker: {
      setOnError: (handler) => {
        browserWorker.onerror = handler;
      },
      setOnMessage: (handler) => {
        browserWorker.onmessage = handler;
      },
      postMessage: (message, transfer) => browserWorker.postMessage(message, transfer ?? []),
      terminate: () => browserWorker.terminate(),
    },
    dispose: () => URL.revokeObjectURL(workerUrl),
  };
}
