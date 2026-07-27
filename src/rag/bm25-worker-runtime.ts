import { BM25_WORKER_SOURCE } from '../../generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

export interface BM25WorkerDocument {
  id: string;
  text: string;
  sourcePath: string;
}

export interface BM25WorkerHit {
  docId: string;
  sourcePath: string;
  score: number;
}

interface BM25WorkerRequest {
  id: number;
  operation:
    | 'initialize'
    | 'rebuild'
    | 'add'
    | 'remove-doc'
    | 'remove-source'
    | 'clear'
    | 'search-top';
  wasmBase64?: string;
  dbName?: string;
  snapshot?: string;
  documents?: readonly BM25WorkerDocument[];
  document?: BM25WorkerDocument;
  target?: string;
  query?: string;
  limit?: number;
}

export interface BM25WorkerResponse {
  id: number;
  ready?: boolean;
  tokenizerCurrent?: boolean;
  totalDocs?: number;
  hits?: BM25WorkerHit[];
  progress?: {
    processedDocuments: number;
  };
  error?: string;
}

interface PendingRequest {
  resolve(response: BM25WorkerResponse): void;
  reject(error: Error): void;
  timeoutId: number;
  lastProcessedDocuments: number;
  removeAbortListener(): void;
}

export interface BM25WorkerAdapter {
  postMessage(message: BM25WorkerRequest): void;
  terminate(): void;
  setOnMessage(handler: (event: MessageEvent<BM25WorkerResponse>) => void): void;
  setOnError(handler: (event: ErrorEvent) => void): void;
}

export interface BM25WorkerHandle {
  worker: BM25WorkerAdapter;
  dispose(): void;
}

export type BM25WorkerFactory = () => BM25WorkerHandle;

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

export class BM25WorkerRuntime {
  private readonly worker: BM25WorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(
    createWorker: BM25WorkerFactory = createBrowserWorker,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    const handle = createWorker();
    this.worker = handle.worker;
    this.disposeWorker = () => handle.dispose();
    this.worker.setOnMessage((event) => this.handleMessage(event.data));
    this.worker.setOnError((event) =>
      this.close(new Error(event.message || 'BM25 worker failed.')),
    );
  }

  initialize(dbName: string, snapshot: string): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'initialize', wasmBase64: RAG_WASM_BASE64, dbName, snapshot });
  }

  rebuild(documents: readonly BM25WorkerDocument[]): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'rebuild', documents });
  }

  add(document: BM25WorkerDocument): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'add', document });
  }

  removeDocument(target: string): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'remove-doc', target });
  }

  removeSource(target: string): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'remove-source', target });
  }

  clear(): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'clear' });
  }

  async searchTop(query: string, limit: number, signal?: AbortSignal): Promise<BM25WorkerHit[]> {
    const response = await this.request({ operation: 'search-top', query, limit }, signal);
    return response.hits ?? [];
  }

  close(reason = new Error('BM25 worker was closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.disposeWorker();
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeoutId);
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
  }

  private request(
    request: Omit<BM25WorkerRequest, 'id'>,
    signal?: AbortSignal,
  ): Promise<BM25WorkerResponse> {
    if (this.closed) return Promise.reject(new Error('BM25 worker is closed.'));
    if (signal?.aborted) {
      return Promise.reject(new DOMException('BM25 worker request cancelled.', 'AbortError'));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.close(new DOMException('BM25 worker request cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      const timeoutId = window.setTimeout(() => {
        const error = new Error('BM25 worker request timed out.');
        this.close(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timeoutId,
        lastProcessedDocuments: 0,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      this.worker.postMessage({ id, ...request });
    });
  }

  private handleMessage(response: BM25WorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
    const processedDocuments = response.progress?.processedDocuments;
    if (processedDocuments !== undefined) {
      if (
        Number.isSafeInteger(processedDocuments) &&
        processedDocuments > request.lastProcessedDocuments
      ) {
        request.lastProcessedDocuments = processedDocuments;
        window.clearTimeout(request.timeoutId);
        request.timeoutId = window.setTimeout(() => {
          const error = new Error('BM25 worker request timed out.');
          this.close(error);
        }, this.requestTimeoutMs);
      }
      return;
    }
    this.pending.delete(response.id);
    window.clearTimeout(request.timeoutId);
    request.removeAbortListener();
    if (response.error) {
      request.reject(new Error(response.error));
      return;
    }
    request.resolve(response);
  }
}

export function canUseBM25Worker(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
}

function createBrowserWorker(): BM25WorkerHandle {
  const workerUrl = URL.createObjectURL(
    new Blob([BM25_WORKER_SOURCE], { type: 'text/javascript' }),
  );
  const browserWorker = new Worker(workerUrl);
  return {
    worker: {
      postMessage: (message) => browserWorker.postMessage(message),
      terminate: () => browserWorker.terminate(),
      setOnMessage: (handler) => {
        browserWorker.onmessage = handler;
      },
      setOnError: (handler) => {
        browserWorker.onerror = handler;
      },
    },
    dispose: () => URL.revokeObjectURL(workerUrl),
  };
}
