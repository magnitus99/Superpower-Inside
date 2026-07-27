import { normalizePath, type App } from 'obsidian';

import { TERNLIGHT_WORKER_SOURCE } from '../../generated/ternlight-worker-source';
import { ensureTernlightModel, TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';

export interface TernlightRuntimeOptions {
  app: App;
  pluginId: string;
  pluginVersion: string;
  createWorker?: TernlightWorkerFactory;
}

interface TernlightWorkerRequest {
  id: number;
  operation: 'initialize' | 'embed';
  wasmBytes?: ArrayBuffer;
  texts?: string[];
}

export interface TernlightWorkerResponse {
  id: number;
  dimensions?: number;
  rows?: number;
  values?: ArrayBuffer;
  error?: string;
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

class TernlightWorkerRuntime {
  private readonly worker: TernlightWorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(createWorker: TernlightWorkerFactory) {
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
        this.close(new DOMException('Ternlight embedding cancelled.', 'AbortError'));
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
    request.resolve(response);
  }
}

let initialization: Promise<TernlightWorkerRuntime> | null = null;
let initializationKey = '';
let activeRuntime: TernlightWorkerRuntime | null = null;

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
    activeRuntime?.close();
    activeRuntime = null;
    initialization = null;
    initializationKey = nextKey;
  }
  initialization ??= initializeTernlight(options).catch((error: unknown) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

async function initializeTernlight(
  options: TernlightRuntimeOptions,
): Promise<TernlightWorkerRuntime> {
  const modelPath = normalizePath(
    `${options.app.vault.configDir}/plugins/${options.pluginId}/${TERNLIGHT_MODEL_FILE_NAME}`,
  );
  const wasmBytes = await ensureTernlightModel({
    adapter: options.app.vault.adapter,
    modelPath,
    pluginVersion: options.pluginVersion,
  });
  const runtime = new TernlightWorkerRuntime(options.createWorker ?? createBrowserWorker);
  try {
    await runtime.initialize(wasmBytes);
    activeRuntime = runtime;
    return runtime;
  } catch (error) {
    runtime.close();
    throw error;
  }
}

export function closeTernlightRuntime(): void {
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
