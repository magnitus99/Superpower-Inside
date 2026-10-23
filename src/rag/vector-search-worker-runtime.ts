import { VECTOR_SEARCH_WORKER_SOURCE } from '../../generated/vector-search-worker-source';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import type { VectorSearchFilter } from './store';

export interface VectorSearchWorkerHit {
  id: string;
  score: number;
}

interface VectorSearchWorkerRequest {
  id: number;
  operation: 'search';
  wasmBase64?: string;
  dbName: string;
  queryVector: number[];
  topK: number;
  filter?: VectorSearchFilter;
  revision?: number;
  maxIndexBytes?: number;
  mode?: 'exact' | 'ann';
  annMinEntryCount?: number;
  annClusterCount?: number;
  annProbeCount?: number;
  annIterations?: number;
}

export interface VectorSearchWorkerResponse {
  id: number;
  hits?: VectorSearchWorkerHit[];
  indexedCount?: number;
  revision?: number;
  cacheHit?: boolean;
  indexBytes?: number;
  mode?: 'exact' | 'ann';
  /** 색인을 새로 만든 시간과 질의 계산 시간입니다. */
  buildMs?: number;
  queryMs?: number;
  error?: string;
}

/** 마지막 작업자 검색의 색인 세대와 메모리 사용량 계측값입니다. */
export interface VectorSearchWorkerSearchStats {
  revision: number | null;
  cacheHit: boolean;
  indexBytes: number;
  indexedCount: number;
  /** 작업자가 실제로 수행한 검색 방식입니다. */
  mode: 'exact' | 'ann';
  /** 색인을 새로 만든 시간입니다. 캐시를 재사용했으면 0입니다. */
  buildMs: number;
  /** 질의 계산에 쓴 시간입니다. */
  queryMs: number;
}

interface PendingRequest {
  resolve(response: VectorSearchWorkerResponse): void;
  reject(error: Error): void;
  timeoutId: number;
  removeAbortListener(): void;
}

export interface VectorSearchWorkerAdapter {
  postMessage(message: VectorSearchWorkerRequest): void;
  terminate(): void;
  setOnMessage(handler: (event: MessageEvent<VectorSearchWorkerResponse>) => void): void;
  setOnError(handler: (event: ErrorEvent) => void): void;
}

export interface VectorSearchWorkerHandle {
  worker: VectorSearchWorkerAdapter;
  dispose(): void;
}

export type VectorSearchWorkerFactory = () => VectorSearchWorkerHandle;

/**
 * 워커 요청 한 건의 상한입니다. 첫 검색은 색인 구축(볼트 전체 벡터 읽기)까지 포함하므로
 * provider deadline(5초)보다 길게 두어 구축이 중단되지 않고 캐시에 남게 합니다.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export class VectorSearchWorkerRuntime {
  private readonly worker: VectorSearchWorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private initialized = false;
  /** 첫 요청이 WASM을 보낸 뒤 응답 전까지 다른 요청이 중복 전송하지 않게 합니다. */
  private initializing = false;
  private closed = false;
  private stats: VectorSearchWorkerSearchStats | null = null;

  constructor(
    createWorker: VectorSearchWorkerFactory = createBrowserWorker,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    const handle = createWorker();
    this.worker = handle.worker;
    this.disposeWorker = () => handle.dispose();
    this.worker.setOnMessage((event) => this.handleMessage(event.data));
    this.worker.setOnError((event) =>
      this.close(new Error(event.message || 'Vector search worker failed.')),
    );
  }

  async search(input: {
    dbName: string;
    queryVector: readonly number[];
    topK: number;
    filter?: VectorSearchFilter;
    signal?: AbortSignal;
    revision?: number;
    maxIndexBytes?: number;
    mode?: 'exact' | 'ann';
    annMinEntryCount?: number;
    annClusterCount?: number;
    annProbeCount?: number;
    annIterations?: number;
  }): Promise<VectorSearchWorkerHit[]> {
    const sendWasm = !this.initialized && !this.initializing;
    if (sendWasm) this.initializing = true;
    let response: VectorSearchWorkerResponse;
    try {
      response = await this.request(
        {
          operation: 'search',
          ...(sendWasm ? { wasmBase64: RAG_WASM_BASE64 } : {}),
          dbName: input.dbName,
          queryVector: [...input.queryVector],
          topK: input.topK,
          filter: input.filter,
          revision: input.revision,
          maxIndexBytes: input.maxIndexBytes,
          mode: input.mode,
          annMinEntryCount: input.annMinEntryCount,
          annClusterCount: input.annClusterCount,
          annProbeCount: input.annProbeCount,
          annIterations: input.annIterations,
        },
        input.signal,
      );
    } catch (error) {
      // 초기화 요청이 실패하면 다음 요청이 WASM을 다시 보내도록 되돌립니다.
      if (sendWasm && !this.initialized) this.initializing = false;
      throw error;
    }
    this.initialized = true;
    this.initializing = false;
    this.stats = {
      revision: typeof response.revision === 'number' ? response.revision : null,
      cacheHit: response.cacheHit === true,
      indexBytes: response.indexBytes ?? 0,
      indexedCount: response.indexedCount ?? 0,
      mode: response.mode === 'ann' ? 'ann' : 'exact',
      buildMs: response.buildMs ?? 0,
      queryMs: response.queryMs ?? 0,
    };
    return response.hits ?? [];
  }

  /** 검색 실패 뒤에도 마지막 색인 계측값을 남겨 cold/warm 판단에 쓴다. */
  get lastSearchStats(): VectorSearchWorkerSearchStats | null {
    return this.stats;
  }

  close(reason = new Error('Vector search worker was closed.')): void {
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
    request: Omit<VectorSearchWorkerRequest, 'id'>,
    signal?: AbortSignal,
  ): Promise<VectorSearchWorkerResponse> {
    if (this.closed) return Promise.reject(new Error('Vector search worker is closed.'));
    if (signal?.aborted) {
      return Promise.reject(
        new DOMException('Vector search worker request cancelled.', 'AbortError'),
      );
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        window.clearTimeout(pending.timeoutId);
        pending.removeAbortListener();
        reject(new DOMException('Vector search worker request cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      const timeoutId = window.setTimeout(() => {
        this.close(new Error('Vector search worker request timed out.'));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        timeoutId,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      this.worker.postMessage({ id, ...request });
    });
  }

  private handleMessage(response: VectorSearchWorkerResponse): void {
    const request = this.pending.get(response.id);
    if (!request) return;
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

export function canUseVectorSearchWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
}

function createBrowserWorker(): VectorSearchWorkerHandle {
  const workerUrl = URL.createObjectURL(
    new Blob([VECTOR_SEARCH_WORKER_SOURCE], { type: 'text/javascript' }),
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
