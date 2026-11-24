import { EMBEDDINGGEMMA_ASSETS } from '../../.local/generated/embeddinggemma-assets';
import { getLocalEmbeddingModels } from './local-embedding-models';
import { appLogger } from '../utils/logger';
import { t } from '../i18n';
import type { RustLocalRagAdmissionPlan } from '../rag/rust-core';
import type { LocalAdmissionSource } from './local-embedding-admission';
import type { EmbeddingInferenceSample } from './embedding';
import { updateEmbeddingGemmaStatus } from './embeddinggemma-status';
import {
  TernlightWorkerRuntime,
  waitForEmbeddingOperation,
  type TernlightRuntimeOptions,
  type TernlightWorkerHandle,
  type TernlightWorkerResponse,
} from './ternlight-runtime';

export class EmbeddingGemmaRuntime {
  private initialization: Promise<TernlightWorkerRuntime> | null = null;
  private runtime: TernlightWorkerRuntime | null = null;
  private revision = 0;
  private closed = false;
  private readonly operations = new Set<Promise<number[][]>>();
  private backend: 'webgpu' | 'wasm' | undefined;
  private foregroundDemand = 0;

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
    if (this.closed) throw new Error(t('embeddingOwnerClosed', { owner: 'EmbeddingGemma' }));
    signal?.throwIfAborted();
    if (texts.length === 0) return [];
    const revision = this.revision;
    this.initialization ??= this.initialize(revision).catch((error: unknown) => {
      if (revision === this.revision) this.initialization = null;
      throw error;
    });
    const runtime = await waitForEmbeddingOperation(this.initialization, signal);
    if (this.closed) throw new Error(t('embeddingOwnerClosed', { owner: 'EmbeddingGemma' }));
    signal?.throwIfAborted();
    try {
      const vectors = await runtime.embedBatch(
        texts,
        signal,
        priority,
        onInferenceDispatch,
        onInferenceSample,
      );
      if (vectors.some((vector) => vector.length !== 768))
        throw new Error('EmbeddingGemma returned invalid dimensions.');
      return vectors;
    } catch (error) {
      if (runtime.isClosed && this.runtime === runtime && !this.closed) {
        this.runtime = null;
        this.initialization = null;
        this.backend = undefined;
        this.revision++;
        this.notifyStatus();
      }
      throw error;
    }
  }

  async waitForIdle(): Promise<void> {
    do {
      await Promise.allSettled([...this.operations]);
      await this.initialization?.catch(() => undefined);
      await this.runtime?.waitForIdle();
    } while (this.operations.size > 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.notifyStatus();
    this.revision++;
    this.runtime?.close();
    this.backend = undefined;
  }

  private notifyStatus(response?: TernlightWorkerResponse): void {
    try {
      updateEmbeddingGemmaStatus(this.options.app, this, response);
    } catch {
      try {
        appLogger.warn('Local embedding status observer failed.', { source: 'embedding.status' });
      } catch {
        /* close/초기화 실패에서도 observer·logger는 물리 정착을 막지 않는다. */
      }
    }
  }

  private async initialize(revision: number): Promise<TernlightWorkerRuntime> {
    const publish = (processed: number): void => {
      if (this.closed || revision !== this.revision) return;
      try { this.options.onPreparationProgress?.(processed, EMBEDDINGGEMMA_ASSETS.length + 2); } catch { /* 비권위 관측은 모델 수명을 바꾸지 않습니다. */ }
    };
    publish(0);
    let processed = 1;
    const models = getLocalEmbeddingModels(this.options);
    await models.prepare('embeddinggemma-300m', false);
    publish(processed);
    const assets: Record<string, ArrayBuffer> = {};
    for (const asset of EMBEDDINGGEMMA_ASSETS) {
      if (this.closed)
        throw new Error(t('embeddingInitializationClosed', { model: 'EmbeddingGemma' }));
      assets[asset.file] = await models.read('embeddinggemma-300m', asset.file);
      publish(++processed);
    }
    if (revision !== this.revision) throw new Error('EmbeddingGemma initialization was cancelled.');
    const runtime = new TernlightWorkerRuntime(
      this.options.createWorker ?? (() => createWorker(assets['embeddinggemma-worker.js'])),
      (response) => {
        if (revision !== this.revision) return;
        this.notifyStatus(response);
        if (!response.backend || response.backend === this.backend) return;
        this.backend = response.backend;
        const logger = appLogger.child('embedding.gemma');
        const data = {
          backend: response.backend,
          threads: response.threads,
          reason: response.fallbackReason,
        };
        if (response.fallbackReason) logger.warn('EmbeddingGemma switched to CPU.', { data });
        else logger.info('EmbeddingGemma compute backend selected.', { data });
      },
      {
        io: this.options.admissionIO,
        backend: null,
        maxBatchSize: 4,
        dimensions: 768,
        foregroundPending: () => this.foregroundDemand,
      },
    );
    this.runtime = runtime;
    try {
      delete assets['embeddinggemma-worker.js'];
      await runtime.initializeAssets(assets);
      publish(++processed);
      if (revision !== this.revision)
        throw new Error('EmbeddingGemma initialization was cancelled.');
      return runtime;
    } catch (error) {
      runtime.close();
      if (revision === this.revision) this.notifyStatus();
      throw error;
    }
  }
}

function createWorker(bytes: ArrayBuffer): TernlightWorkerHandle {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  const worker = new Worker(url);
  return {
    worker: {
      setOnError: (handler) => {
        worker.onerror = handler;
      },
      setOnMessage: (handler) => {
        worker.onmessage = handler;
      },
      postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
      terminate: () => worker.terminate(),
    },
    dispose: () => URL.revokeObjectURL(url),
  };
}
