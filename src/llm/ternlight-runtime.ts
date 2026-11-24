import { type App } from 'obsidian';
import { t } from '../i18n';
import { appLogger } from '../utils/logger';
import { getSourceDispatchSnapshot } from '../rag/source-worker-runtime';
import { type RustLocalRagAdmissionPlan } from '../rag/rust-core';
import {
  LocalEmbeddingAdmission,
  type LocalAdmissionSource,
  type LocalEmbeddingAdmissionIO,
} from './local-embedding-admission';

import { TERNLIGHT_WORKER_SOURCE } from '../../.local/generated/ternlight-worker-source';
import { TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';
import { getLocalEmbeddingModels } from './local-embedding-models';
import type { EmbeddingInferenceSample } from './embedding';

export interface TernlightRuntimeOptions {
  app: App;
  pluginId: string;
  pluginVersion: string;
  createWorker?: TernlightWorkerFactory;
  admissionIO?: LocalEmbeddingAdmissionIO;
  onPreparationProgress?: (processedSteps: number, totalSteps: number) => void;
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
  gpuAvailable?: boolean;
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
  message?: TernlightWorkerRequest;
  transfer?: Transferable[];
  priority?: 'foreground' | 'background';
  operation: 'initialize' | 'embed';
  expectedRows: number;
  adaptiveRows?: { value: number };
  onInferenceDispatch?: () => void;
  onInferenceSample?: (sample: EmbeddingInferenceSample) => void;
  posted?: boolean;
  inferenceSample?: EmbeddingInferenceSample;
  physicalRoundtrip?: ReturnType<LocalEmbeddingAdmission['begin']>;
}

interface WorkerAdmissionOptions {
  io?: LocalEmbeddingAdmissionIO;
  backend: 'cpu' | 'webgpu' | null;
  maxBatchSize: number;
  foregroundPending(): number;
  dimensions?: number;
}

// 관찰자와 진단 logger 모두 계산/큐/물리 정착에 대한 권한이 없다.
function observeInference(callback: (() => void) | undefined, kind: 'dispatch' | 'sample'): void {
  try {
    callback?.();
  } catch {
    try {
      appLogger.warn(`Local embedding ${kind} observer failed.`, { source: `embedding.${kind}` });
    } catch {
      /* 고정 진단 실패도 격리한다. */
    }
  }
}

export class TernlightWorkerRuntime {
  private readonly worker: TernlightWorkerAdapter;
  private readonly disposeWorker: () => void;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly microOperations = new Set<Promise<number[][]>>();
  private nextRequestId = 1;
  private activeRequestId: number | null = null;
  private closed = false;
  private readonly admission?: LocalEmbeddingAdmission;

  constructor(
    createWorker: TernlightWorkerFactory,
    private readonly onRuntimeStatus?: (response: TernlightWorkerResponse) => void,
    private readonly admissionOptions?: WorkerAdmissionOptions,
  ) {
    if (admissionOptions)
      this.admission = new LocalEmbeddingAdmission(
        admissionOptions.io,
        admissionOptions.backend,
        admissionOptions.maxBatchSize,
      );
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

  embedBatch(
    texts: string[],
    signal?: AbortSignal,
    priority?: 'foreground' | 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
  ): Promise<number[][]> {
    if (this.closed) return Promise.reject(new Error('Ternlight worker is closed.'));
    if (this.admission && priority === 'background') {
      const operation = this.embedMicrobatches(
        texts,
        signal,
        priority,
        onInferenceDispatch,
        onInferenceSample,
      );
      this.microOperations.add(operation);
      const settle = (): void => {
        this.microOperations.delete(operation);
        this.notifyIdle();
      };
      void operation.then(settle, settle);
      return operation;
    }
    return this.embedPhysicalBatch(texts, signal, priority, onInferenceDispatch, onInferenceSample);
  }

  planLocalAdmission(source: LocalAdmissionSource): RustLocalRagAdmissionPlan | null {
    if (this.closed || !this.admission || !this.admissionOptions) return null;
    const snapshot = getSourceDispatchSnapshot();
    if (!snapshot.supported) return null;
    const active =
      this.activeRequestId === null ? undefined : this.pending.get(this.activeRequestId);
    return this.admission.plan(source, {
      // local demand는 queued + active의 아직 정착하지 않은 FG 소비자이며 초기화 대기도 포함한다.
      foregroundPending: this.admissionOptions.foregroundPending() + snapshot.queuedForeground,
      physicalSourceCount: snapshot.active,
      physicalInferenceCount: active?.operation === 'embed' ? 1 : 0,
    });
  }

  private async embedMicrobatches(
    texts: string[],
    signal: AbortSignal | undefined,
    priority: 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
  ): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; ) {
      signal?.throwIfAborted();
      const next = await this.embedPhysicalBatch(
        texts.slice(offset),
        signal,
        priority,
        onInferenceDispatch,
        onInferenceSample,
        true,
      );
      for (const vector of next) vectors.push(vector);
      offset += next.length;
    }
    return vectors;
  }

  private embedPhysicalBatch(
    texts: string[],
    signal?: AbortSignal,
    priority?: 'foreground' | 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
    adaptive = false,
  ): Promise<number[][]> {
    // 응답 검증에는 행 수만 남겨 취소된 원문을 continuation이 붙잡지 않는다.
    const expectedRows = { value: texts.length };
    return this.request(
      { operation: 'embed', texts },
      signal,
      undefined,
      priority,
      onInferenceDispatch,
      onInferenceSample,
      adaptive ? expectedRows : undefined,
    ).then((response) => {
      const rows = response.rows;
      const dimensions = response.dimensions;
      const values = response.values;
      if (
        rows !== expectedRows.value ||
        dimensions === undefined ||
        !Number.isSafeInteger(dimensions) ||
        dimensions <= 0 ||
        (this.admissionOptions?.dimensions !== undefined &&
          dimensions !== this.admissionOptions.dimensions) ||
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
    });
  }

  close(reason = new Error('Ternlight worker was closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    this.disposeWorker();
    this.admission?.close();
    for (const request of this.pending.values()) {
      request.message = undefined;
      request.transfer = undefined;
      request.onInferenceDispatch = undefined;
      request.onInferenceSample = undefined;
      request.inferenceSample = undefined;
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
    this.activeRequestId = null;
    this.notifyIdle();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  waitForIdle(): Promise<void> {
    if (this.pending.size === 0 && this.microOperations.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private notifyIdle(): void {
    if (this.pending.size > 0 || this.microOperations.size > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private request(
    request: Omit<TernlightWorkerRequest, 'id'>,
    signal?: AbortSignal,
    transfer?: Transferable[],
    priority?: 'foreground' | 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
    adaptiveRows?: { value: number },
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
        // 전송 전 취소는 큐와 큰 입력 참조까지 제거한다. 실행 중 슬롯은 ACK까지 보존한다.
        if (this.activeRequestId !== id) this.pending.delete(id);
        pending.message = undefined;
        pending.transfer = undefined;
        pending.onInferenceDispatch = undefined;
        pending.onInferenceSample = undefined;
        pending.inferenceSample = undefined;
        pending.removeAbortListener();
        pending.reject(new DOMException('Ternlight embedding cancelled.', 'AbortError'));
        this.notifyIdle();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
        message: { id, ...request },
        transfer,
        priority,
        operation: request.operation,
        expectedRows: request.texts?.length ?? 0,
        adaptiveRows,
        onInferenceDispatch,
        onInferenceSample,
      });
      // abort listener의 바깥 closure에도 큰 입력·transfer 참조를 남기지 않는다.
      request = { operation: request.operation };
      transfer = undefined;
      this.dispatchNext();
    });
  }

  private dispatchNext(): void {
    while (!this.closed && this.activeRequestId === null && this.pending.size > 0) {
      // Map 삽입 순서로 같은 우선순위의 FIFO를 보존한다. priority는 wire에 싣지 않는다.
      let next = this.pending.entries().next().value!;
      for (const entry of this.pending) {
        if (entry[1].priority === 'foreground') {
          next = entry;
          break;
        }
      }
      const [id, pending] = next;
      const message = pending.message!;
      // 큐 대기 중 FG/backend/health가 바뀔 수 있으므로 크기는 실제 물리 turn에서만 결정한다.
      if (pending.adaptiveRows && message.texts) {
        // 이 호출은 source를 예약하지 않는다. window charge는 public plan의 caller만 제공한다.
        const plan = this.planLocalAdmission({
          sourceBudgetBytes: 0,
          reservedSourceBytes: 0,
          plannedSourceBytes: 0,
        });
        if (plan) message.texts = message.texts.slice(0, plan.nextBatchSize);
        pending.expectedRows = message.texts.length;
        pending.adaptiveRows.value = pending.expectedRows;
      }
      const transfer = pending.transfer;
      pending.message = undefined;
      pending.transfer = undefined;
      this.activeRequestId = id;
      const onInferenceDispatch = pending.onInferenceDispatch;
      pending.onInferenceDispatch = undefined;
      if (message.operation === 'embed')
        pending.physicalRoundtrip = this.admission?.begin(pending.expectedRows);
      try {
        this.worker.postMessage(message, transfer);
        // 성공한 실제 post 뒤에만 알린다. 동기 fake ACK여도 정착과 hook은 독립적이다.
        pending.posted = true;
        if (message.operation === 'embed') observeInference(onInferenceDispatch, 'dispatch');
        this.observeSample(pending);
      } catch (error) {
        pending.onInferenceSample = undefined;
        pending.inferenceSample = undefined;
        // 실패한 전송만 정착시키고 다음 소비자가 굶지 않도록 계속 dispatch한다.
        if (this.activeRequestId === id) {
          if (pending.physicalRoundtrip) this.admission?.finish(pending.physicalRoundtrip, false);
          this.pending.delete(id);
          this.activeRequestId = null;
          pending.removeAbortListener();
          pending.reject(
            error instanceof Error
              ? error
              : new Error(t('embeddingRequestDispatchFailed', { model: 'Ternlight' })),
          );
        }
      }
    }
    this.notifyIdle();
  }

  private observeSample(request: PendingRequest): void {
    if (!request.posted || !request.inferenceSample) return;
    const sample = request.inferenceSample;
    const callback = request.onInferenceSample;
    request.inferenceSample = undefined;
    request.onInferenceSample = undefined;
    if (!this.closed && callback) observeInference(() => callback(sample), 'sample');
  }

  private handleMessage(response: TernlightWorkerResponse): void {
    // 미전송·알 수 없는·지난 ACK가 현재 슬롯이나 큐를 해제하지 못하게 한다.
    if (response.id !== this.activeRequestId) return;
    const request = this.pending.get(response.id);
    if (!request) return;
    const endedAtMs = this.admission?.now();
    this.pending.delete(response.id);
    this.activeRequestId = null;
    request.removeAbortListener();
    // backend는 선호 설정이 아니라 이 worker의 실제 ACK에서만 선택한다.
    const actualGemmaBackend = response.backend === 'wasm' || response.backend === 'webgpu';
    if (!response.error && actualGemmaBackend && this.admissionOptions?.dimensions === 768) {
      this.admission?.setBackend(
        response.backend === 'webgpu' ? 'webgpu' : 'cpu',
        response.backend === 'webgpu' ? 32 : 4,
      );
    }
    if (request.physicalRoundtrip) {
      let valid = false;
      try {
        const values =
          response.values instanceof ArrayBuffer ? new Float32Array(response.values) : undefined;
        valid =
          !response.error &&
          response.rows === request.expectedRows &&
          Number.isSafeInteger(response.dimensions) &&
          response.dimensions! > 0 &&
          (this.admissionOptions?.dimensions === undefined ||
            response.dimensions === this.admissionOptions.dimensions) &&
          values !== undefined &&
          values.length === request.expectedRows * response.dimensions! &&
          values.every(Number.isFinite);
      } catch {
        /* 손상 payload는 성공 표본이 아니다. 기존 응답 검증이 요청을 거절한다. */
      }
      const sample = this.admission?.finish(request.physicalRoundtrip, valid, endedAtMs);
      // Gemma는 같은 span의 실제 ACK backend가 확인된 경우만 공개한다.
      if (this.admissionOptions?.dimensions !== 768 || actualGemmaBackend)
        request.inferenceSample = sample;
    }
    try {
      if (response.error) request.reject(new Error(response.error));
      else {
        request.resolve(response);
        try {
          this.onRuntimeStatus?.(response);
        } catch {
          try {
            appLogger.warn('Local embedding status observer failed.', {
              source: 'embedding.status',
            });
          } catch {
            /* 고정 진단 실패도 격리한다. */
          }
        }
        // 응답 검증·소비자 정착 뒤 알리며, 동기 ACK는 성공 post 반환까지 보류한다.
        this.observeSample(request);
      }
    } finally {
      this.dispatchNext();
    }
  }
}

export class TernlightRuntime {
  private initialization: Promise<TernlightWorkerRuntime> | null = null;
  private runtime: TernlightWorkerRuntime | null = null;
  private readonly operations = new Set<Promise<number[][]>>();
  private foregroundDemand = 0;
  private closed = false;

  constructor(private readonly options: TernlightRuntimeOptions) {}

  embed(
    texts: string[],
    signal?: AbortSignal,
    priority?: 'foreground' | 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
  ): Promise<number[][]> {
    if (priority === 'foreground') this.foregroundDemand++;
    const operation = this.embedInputs(
      texts,
      signal,
      priority,
      onInferenceDispatch,
      onInferenceSample,
    );
    this.operations.add(operation);
    void operation.then(
      () => {
        this.operations.delete(operation);
        if (priority === 'foreground') this.foregroundDemand--;
      },
      () => {
        this.operations.delete(operation);
        if (priority === 'foreground') this.foregroundDemand--;
      },
    );
    return operation;
  }

  planLocalAdmission(source: LocalAdmissionSource): RustLocalRagAdmissionPlan | null {
    return this.closed ? null : (this.runtime?.planLocalAdmission(source) ?? null);
  }

  private async embedInputs(
    texts: string[],
    signal?: AbortSignal,
    priority?: 'foreground' | 'background',
    onInferenceDispatch?: () => void,
    onInferenceSample?: (sample: EmbeddingInferenceSample) => void,
  ): Promise<number[][]> {
    if (this.closed) throw new Error(t('embeddingOwnerClosed', { owner: 'Ternlight' }));
    signal?.throwIfAborted();
    if (texts.length === 0) return [];
    this.initialization ??= this.initialize().catch((error: unknown) => {
      this.initialization = null;
      throw error;
    });
    const runtime = await waitForEmbeddingOperation(this.initialization, signal);
    if (this.closed) throw new Error(t('embeddingOwnerClosed', { owner: 'Ternlight' }));
    try {
      return await runtime.embedBatch(texts, signal, priority, onInferenceDispatch, onInferenceSample);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        throw error;
      // 요청별 실패는 다른 소비자를 닫지 않는다. 치명적 worker 종료일 때만 재초기화한다.
      if (runtime.isClosed && this.runtime === runtime) {
        this.runtime = null;
        this.initialization = null;
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.runtime?.close();
  }

  async waitForIdle(): Promise<void> {
    do {
      await Promise.allSettled([...this.operations]);
      await this.initialization?.catch(() => undefined);
      await this.runtime?.waitForIdle();
    } while (this.operations.size > 0);
  }

  private async initialize(): Promise<TernlightWorkerRuntime> {
    const publish = (processed: number): void => {
      if (this.closed) return;
      try { this.options.onPreparationProgress?.(processed, 3); } catch { /* 비권위 관측은 모델 수명을 바꾸지 않습니다. */ }
    };
    publish(0);
    const models = getLocalEmbeddingModels(this.options);
    await models.prepare('ternlight-base', false);
    publish(1);
    if (this.closed) throw new Error(t('embeddingInitializationClosed', { model: 'Ternlight' }));
    const wasmBytes = await models.read('ternlight-base', TERNLIGHT_MODEL_FILE_NAME);
    publish(2);
    if (this.closed) throw new Error(t('embeddingInitializationClosed', { model: 'Ternlight' }));
    const runtime = new TernlightWorkerRuntime(
      this.options.createWorker ?? createBrowserWorker,
      undefined,
      {
        io: this.options.admissionIO,
        backend: 'cpu',
        maxBatchSize: 32,
        foregroundPending: () => this.foregroundDemand,
      },
    );
    this.runtime = runtime;
    try {
      await runtime.initialize(wasmBytes);
      publish(3);
      if (this.closed) throw new Error(t('embeddingInitializationClosed', { model: 'Ternlight' }));
      return runtime;
    } catch (error) {
      runtime.close();
      if (this.runtime === runtime) this.runtime = null;
      throw error;
    }
  }
}

// 소비자 취소와 별개로 원래 작업 Promise는 소유자가 idle까지 추적한다.
export function waitForEmbeddingOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new DOMException(t('actionCancelledNotice'), 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(t('providerModelEmbeddingFailed')));
      },
    );
  });
}

// 기존 직접 호출과 테스트 cleanup만 위한 소유자이며 provider 수명과 공유하지 않는다.
let legacyRuntime: TernlightRuntime | null = null;
let legacyKey = '';

export function embedTernlightBatch(
  options: TernlightRuntimeOptions,
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const key = `${options.app.vault.configDir}:${options.pluginId}:${options.pluginVersion}`;
  if (legacyKey !== key) closeTernlightRuntime();
  legacyKey = key;
  legacyRuntime ??= new TernlightRuntime(options);
  return legacyRuntime.embed(texts, signal);
}

export function closeTernlightRuntime(): void {
  legacyRuntime?.close();
  legacyRuntime = null;
  legacyKey = '';
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
