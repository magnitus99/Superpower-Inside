import { BM25_WORKER_SOURCE } from '../../.local/generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import { isBm25PostingPage, type BM25PostingManifest, type BM25PostingWorkerTiming } from './bm25-posting-checkpoint';

export interface BM25WorkerDocument {
  id: string;
  text: string;
  sourcePath: string;
  title?: string;
  headings?: string[];
  tags?: string[];
  path?: string;
}

export interface BM25WorkerHit {
  docId: string;
  sourcePath: string;
  score: number;
}

export interface BM25WorkerSearchQuery {
  query: string;
  limit: number;
}

export interface BM25WorkerAggregateQuery {
  query: string;
  limit: number;
}

export interface BM25WorkerMutationContext {
  revision: number;
  part?: number;
  finalPart?: boolean;
}

export interface BM25WorkerCheckpoint {
  snapshot: string;
  sessionId: string;
  appliedRevision: number;
  pendingRevision: number | null;
}

export interface BM25WorkerRequest {
  id: number;
  sessionId: string;
  revision: number;
  part: number;
  finalPart: boolean;
  operation:
    | 'initialize'
    | 'rebuild'
    | 'add'
    | 'replace-source'
    | 'remove-doc'
    | 'remove-source'
    | 'clear'
    | 'serialize'
    | 'posting-page'
    | 'search-top'
    | 'search-representatives'
    | 'aggregate'
    | 'batch';
  wasmBase64?: string;
  dbName?: string;
  snapshot?: string;
  maxSnapshotBytes?: number;
  sinceOrder?: number;
  expectedDocs?: number;
  posting?: BM25PostingManifest;
  postingPart?: number;
  documents?: readonly BM25WorkerDocument[];
  document?: BM25WorkerDocument;
  target?: string;
  removeFirst?: boolean;
  query?: string;
  limit?: number;
  allowedPaths?: readonly string[];
  queries?: readonly BM25WorkerSearchQuery[];
  aggregates?: readonly BM25WorkerAggregateQuery[];
}

export interface BM25WorkerResponse {
  id: number;
  sessionId: string | null;
  appliedRevision: number | null;
  pendingRevision: number | null;
  nextPart: number;
  ready?: boolean;
  tokenizerCurrent?: boolean;
  totalDocs?: number;
  snapshot?: string;
  snapshotRejected?: boolean;
  postingVersion?: 1;
  postingPart?: number;
  postingPage?: Uint8Array;
  postingRejected?: boolean;
  postingTiming?: BM25PostingWorkerTiming;
  hits?: BM25WorkerHit[];
  representativeHitsJson?: string;
  /** 점수 없이 센 질의 일치 인벤토리입니다. TS가 형식을 검증합니다. */
  aggregateJson?: string;
  /** 여러 질의의 검색·집계를 담은 JSON입니다. TS가 형식을 검증합니다. */
  batchJson?: string;
  progress?: {
    processedDocuments: number;
  };
  error?: string;
}

interface PendingRequest {
  resolve(response: BM25WorkerResponse): void;
  reject(error: Error): void;
  message: BM25WorkerRequest;
  timeoutId?: number;
  timeoutMs: number;
  expectedDocuments?: number;
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

type RequestInput = Omit<
  BM25WorkerRequest,
  'id' | 'sessionId' | 'revision' | 'part' | 'finalPart'
> &
  Partial<BM25WorkerMutationContext>;

function isMutation(operation: BM25WorkerRequest['operation']): boolean {
  return ['rebuild', 'add', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(
    operation,
  );
}

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
/** 전체 색인 복원·직렬화는 수십 초가 걸릴 수 있어 기본 한도의 배수로 늘립니다. */
const RESTORE_TIMEOUT_MULTIPLIER = 5;

export class BM25WorkerRuntime {
  public readonly sessionId = crypto.randomUUID();
  private appliedRevisionValue: number | null = null;
  private pendingRevisionValue: number | null = null;
  private nextPart = 0;
  private issuedRevision = 0;
  private faulted = false;
  private readonly worker: BM25WorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private lastInitializeRequestId = 0;
  private activeRequestId: number | null = null;
  private closed = false;
  private closeReasonValue: Error | null = null;
  private hydration: { processedDocuments: number; expectedDocuments: number | null } | null = null;

  constructor(
    createWorker: BM25WorkerFactory = createBrowserWorker,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly onHydrationProgress?: (progress: { processedDocuments: number; expectedDocuments: number | null }) => void,
  ) {
    const handle = createWorker();
    this.worker = handle.worker;
    this.disposeWorker = () => handle.dispose();
    this.worker.setOnMessage((event) => this.handleMessage(event.data));
    this.worker.setOnError((event) =>
      this.close(new Error(event.message || 'BM25 worker failed.')),
    );
  }

  initialize(
    dbName: string,
    snapshot: string,
    sinceOrder?: number,
    expectedDocs?: number,
    posting?: BM25PostingManifest,
  ): Promise<BM25WorkerResponse> {
    this.issuedRevision = 0;
    return this.request(
      {
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        dbName,
        snapshot,
        sinceOrder,
        expectedDocs,
        ...(posting ? { posting } : {}),
      },
      undefined,
      this.requestTimeoutMs * RESTORE_TIMEOUT_MULTIPLIER,
      posting?.docCount ?? (snapshot.trim().length > 0 ? undefined : expectedDocs),
    );
  }

  async readPostingPage(postingPart: number): Promise<BM25WorkerResponse> {
    return this.request({ operation: 'posting-page', postingPart });
  }

  async serializeCheckpoint(maxSnapshotBytes?: number): Promise<BM25WorkerCheckpoint> {
    const response = await this.request(
      { operation: 'serialize', maxSnapshotBytes },
      undefined,
      this.requestTimeoutMs * RESTORE_TIMEOUT_MULTIPLIER,
    );
    if (this.closed || this.faulted || response.id < this.lastInitializeRequestId)
      throw new Error('BM25 worker checkpoint is no longer current.');
    if (
      typeof response.snapshot !== 'string' ||
      response.appliedRevision === null ||
      response.sessionId !== this.sessionId
    ) {
      this.invalidate(new Error('Invalid BM25 worker checkpoint.'));
      throw new Error('Invalid BM25 worker checkpoint.');
    }
    return {
      snapshot: response.snapshot,
      sessionId: response.sessionId,
      appliedRevision: response.appliedRevision,
      pendingRevision: response.pendingRevision,
    };
  }

  async serialize(): Promise<string> {
    return (await this.serializeCheckpoint()).snapshot;
  }

  get appliedRevision(): number | null {
    return this.appliedRevisionValue;
  }
  get pendingRevision(): number | null {
    return this.pendingRevisionValue;
  }

  private mutate(
    request: RequestInput,
    context?: BM25WorkerMutationContext,
  ): Promise<BM25WorkerResponse> {
    const revision = context?.revision ?? this.issuedRevision + 1;
    return this.request({
      ...request,
      revision,
      part: context?.part ?? 0,
      finalPart: context?.finalPart ?? true,
    });
  }

  rebuild(
    documents: readonly BM25WorkerDocument[],
    context?: BM25WorkerMutationContext,
  ): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'rebuild', documents }, context);
  }

  add(
    document: BM25WorkerDocument,
    context?: BM25WorkerMutationContext,
  ): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'add', document }, context);
  }

  replaceSource(
    target: string,
    documents: readonly BM25WorkerDocument[],
    removeFirst = true,
    context?: BM25WorkerMutationContext,
  ): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'replace-source', target, documents, removeFirst }, context);
  }

  removeDocument(target: string, context?: BM25WorkerMutationContext): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'remove-doc', target }, context);
  }

  removeSource(target: string, context?: BM25WorkerMutationContext): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'remove-source', target }, context);
  }

  clear(context?: BM25WorkerMutationContext): Promise<BM25WorkerResponse> {
    return this.mutate({ operation: 'clear' }, context);
  }

  async searchTop(query: string, limit: number, signal?: AbortSignal): Promise<BM25WorkerHit[]> {
    const response = await this.request({ operation: 'search-top', query, limit }, signal);
    return response.hits ?? [];
  }

  async searchRepresentatives(
    query: string,
    limit: number,
    signal?: AbortSignal,
    allowedPaths?: readonly string[],
  ): Promise<string> {
    const response = await this.request({ operation: 'search-representatives', query, limit, allowedPaths }, signal);
    return response.representativeHitsJson ?? '';
  }

  /** 점수 없이 센 질의 일치 인벤토리 JSON을 받아옵니다. 해석은 호출자가 검증해 합니다. */
  async aggregate(
    query: string,
    limit: number,
    signal?: AbortSignal,
    allowedPaths?: readonly string[],
  ): Promise<string> {
    const response = await this.request(
      { operation: 'aggregate', query, limit, allowedPaths },
      signal,
    );
    return response.aggregateJson ?? '';
  }

  /** 여러 facet 검색과 집계를 한 작업자 요청으로 실행합니다. */
  async batch(
    queries: readonly BM25WorkerSearchQuery[],
    aggregates: readonly BM25WorkerAggregateQuery[],
    allowedPaths?: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.request(
      { operation: 'batch', queries, aggregates, allowedPaths },
      signal,
    );
    return response.batchJson ?? '';
  }

  close(reason = new Error('BM25 worker was closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReasonValue = reason;
    this.hydration = null;
    this.appliedRevisionValue = null;
    this.pendingRevisionValue = null;
    this.worker.terminate();
    this.disposeWorker();
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeoutId);
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
    this.activeRequestId = null;
  }

  /** 최초 종료 원인은 후속 요청이나 재종료로 바꾸지 않습니다. */
  get closeReason(): Error | null {
    return this.closeReasonValue;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private publishHydration(): void {
    if (!this.hydration) return;
    try { this.onHydrationProgress?.({ ...this.hydration }); } catch { /* 관측 오류는 실제 ACK 정착을 막지 않습니다. */ }
  }

  /** 색인 복원 중이면 지금까지 읽은 문서 수와 기대 문서 수를 알려줍니다. */
  get hydrationProgress(): { processedDocuments: number; expectedDocuments: number | null } | null {
    return this.hydration;
  }

  private request(
    request: RequestInput,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
    expectedDocuments?: number,
  ): Promise<BM25WorkerResponse> {
    if (this.closed) return Promise.reject(new Error('BM25 worker is closed.'));
    if (this.faulted && request.operation !== 'initialize')
      return Promise.reject(new Error('BM25 worker requires initialization.'));
    if (signal?.aborted) {
      return Promise.reject(new DOMException('BM25 worker request cancelled.', 'AbortError'));
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        pending.removeAbortListener();
        pending.reject(new DOMException('BM25 worker request cancelled.', 'AbortError'));
        if (this.activeRequestId === id) {
          // 실행 중인 WASM은 중단할 수 없어 응답 또는 시간 제한까지 순서를 유지합니다.
          pending.resolve = () => {};
          pending.reject = () => {};
        } else {
          this.pending.delete(id);
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        message: {
          id,
          sessionId: this.sessionId,
          revision: 0,
          part: 0,
          finalPart: true,
          ...request,
        },
        timeoutMs,
        expectedDocuments,
        lastProcessedDocuments: 0,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });
      if (isMutation(request.operation) && request.revision !== undefined)
        this.issuedRevision = request.revision;
      this.dispatchNext();
    });
  }

  /** 작업자 실행 한 건에만 제한 시간을 적용하고 대기 요청은 순서대로 보냅니다. */
  private dispatchNext(): void {
    if (this.closed || this.activeRequestId !== null) return;
    const next = this.pending.entries().next().value;
    if (!next) return;
    const [id, request] = next;
    this.activeRequestId = id;
    if (request.message.operation === 'initialize') {
      this.lastInitializeRequestId = id;
      this.appliedRevisionValue = null;
      this.pendingRevisionValue = null;
      this.nextPart = 0;
      this.hydration = { processedDocuments: 0, expectedDocuments: request.expectedDocuments ?? null };
      this.publishHydration();
    } else if (!isMutation(request.message.operation)) {
      request.message.revision = this.appliedRevisionValue ?? 0;
    }
    request.timeoutId = window.setTimeout(() => {
      this.close(new Error('BM25 worker request timed out.'));
    }, request.timeoutMs);
    try {
      this.worker.postMessage(request.message);
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(response: BM25WorkerResponse): void {
    if (this.closed) return;
    if (
      typeof response !== 'object' ||
      response === null ||
      !Number.isSafeInteger(response.id) ||
      response.id < 1
    ) {
      this.invalidate(new Error('Invalid BM25 worker response.'));
      return;
    }
    const request = this.pending.get(response.id);
    if (!request) return;
    if (response.id !== this.activeRequestId) {
      this.invalidate(new Error('Out-of-order BM25 worker acknowledgement.'));
      return;
    }
    if (!this.validState(response) || response.sessionId !== this.sessionId) {
      this.invalidate(new Error('Invalid BM25 worker acknowledgement.'));
      return;
    }
    if (response.error !== undefined) {
      this.invalidate(
        new Error(typeof response.error === 'string' ? response.error : 'BM25 worker failed.'),
      );
      return;
    }
    const processedDocuments = response.progress?.processedDocuments;
    if (response.progress !== undefined) {
      if (
        response.appliedRevision !== this.appliedRevisionValue ||
        response.pendingRevision !== this.pendingRevisionValue ||
        response.nextPart !== this.nextPart ||
        typeof processedDocuments !== 'number' ||
        !Number.isSafeInteger(processedDocuments) ||
        processedDocuments < 0
      ) {
        this.invalidate(new Error('Invalid BM25 worker progress.'));
        return;
      }
      if (
        Number.isSafeInteger(processedDocuments) &&
        processedDocuments > request.lastProcessedDocuments
      ) {
        request.lastProcessedDocuments = processedDocuments;
        this.hydration = {
          processedDocuments,
          expectedDocuments: request.expectedDocuments ?? null,
        };
        this.publishHydration();
        window.clearTimeout(request.timeoutId);
        request.timeoutId = window.setTimeout(() => {
          const error = new Error('BM25 worker request timed out.');
          this.close(error);
        }, request.timeoutMs);
      }
      return;
    }
    if (!this.validAcknowledgement(request.message, response)) {
      this.invalidate(new Error('Invalid BM25 worker applied prefix.'));
      return;
    }
    this.appliedRevisionValue = response.appliedRevision;
    this.pendingRevisionValue = response.pendingRevision;
    this.nextPart = response.nextPart;
    if (request.message.operation === 'initialize') { this.faulted = false; this.hydration = null; }
    this.pending.delete(response.id);
    window.clearTimeout(request.timeoutId);
    request.removeAbortListener();
    this.activeRequestId = null;
    request.resolve(response);
    this.dispatchNext();
  }

  private validState(response: BM25WorkerResponse): boolean {
    const revision = (value: unknown): boolean =>
      value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    return (
      revision(response.appliedRevision) &&
      revision(response.pendingRevision) &&
      Number.isSafeInteger(response.nextPart) &&
      response.nextPart >= 0 &&
      (response.pendingRevision === null
        ? response.nextPart === 0
        : response.appliedRevision !== null &&
          response.pendingRevision === response.appliedRevision + 1 &&
          response.nextPart > 0)
    );
  }

  private validAcknowledgement(request: BM25WorkerRequest, response: BM25WorkerResponse): boolean {
    if (request.operation === 'initialize')
      return (
        response.appliedRevision === (request.posting && response.postingRejected === true ? null : 0) &&
        response.pendingRevision === null &&
        response.nextPart === 0
      );
    if (!isMutation(request.operation))
      return (
        (request.operation !== 'serialize' || typeof response.snapshot === 'string') &&
        (request.operation !== 'posting-page' || (response.postingPart === request.postingPart &&
          (response.postingRejected === true ? response.postingPage === undefined :
            (response.postingPage instanceof Uint8Array && response.postingPage.length === 0) || isBm25PostingPage(response.postingPage)))) &&
        response.appliedRevision === this.appliedRevisionValue &&
        response.pendingRevision === this.pendingRevisionValue &&
        response.nextPart === this.nextPart
      );
    if (
      this.appliedRevisionValue === null ||
      request.revision !== this.appliedRevisionValue + 1 ||
      request.part !== this.nextPart ||
      !Number.isSafeInteger(request.revision) ||
      !Number.isSafeInteger(request.part)
    )
      return false;
    return request.finalPart
      ? response.appliedRevision === request.revision &&
          response.pendingRevision === null &&
          response.nextPart === 0
      : response.appliedRevision === this.appliedRevisionValue &&
          response.pendingRevision === request.revision &&
          response.nextPart === request.part + 1;
  }

  /** 실패 뒤 늦은 응답은 폐기하고 정식 초기화만 새 증명을 발행할 수 있습니다. */
  private invalidate(reason: Error): void {
    this.faulted = true;
    this.hydration = null;
    this.appliedRevisionValue = null;
    this.pendingRevisionValue = null;
    this.nextPart = 0;
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeoutId);
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
    this.activeRequestId = null;
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
