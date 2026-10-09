import { EMBEDDINGGEMMA_ASSETS } from '../../generated/embeddinggemma-assets';
import { getLocalEmbeddingModels } from './local-embedding-models';
import { appLogger } from '../utils/logger';
import {
  TernlightWorkerRuntime,
  type TernlightRuntimeOptions,
  type TernlightWorkerHandle,
} from './ternlight-runtime';

export class EmbeddingGemmaRuntime {
  private initialization: Promise<TernlightWorkerRuntime> | null = null;
  private runtime: TernlightWorkerRuntime | null = null;
  private revision = 0;
  private backend: 'webgpu' | 'wasm' | undefined;

  constructor(private readonly options: TernlightRuntimeOptions) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    if (texts.length === 0) return [];
    const revision = this.revision;
    this.initialization ??= this.initialize(revision).catch((error: unknown) => {
      if (revision === this.revision) this.initialization = null;
      throw error;
    });
    const runtime = await this.initialization;
    signal?.throwIfAborted();
    const vectors = await runtime.embedBatch(texts, signal);
    if (vectors.some((vector) => vector.length !== 768))
      throw new Error('EmbeddingGemma returned invalid dimensions.');
    return vectors;
  }

  close(): void {
    this.revision++;
    this.runtime?.close();
    this.runtime = null;
    this.initialization = null;
    this.backend = undefined;
  }

  private async initialize(revision: number): Promise<TernlightWorkerRuntime> {
    const models = getLocalEmbeddingModels(this.options);
    await models.prepare('embeddinggemma-300m', false);
    const assets: Record<string, ArrayBuffer> = {};
    for (const asset of EMBEDDINGGEMMA_ASSETS)
      assets[asset.file] = await models.read('embeddinggemma-300m', asset.file);
    if (revision !== this.revision) throw new Error('EmbeddingGemma initialization was cancelled.');
    const runtime = new TernlightWorkerRuntime(
      this.options.createWorker ?? (() => createWorker(assets['embeddinggemma-worker.js'])),
      (response) => {
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
    );
    this.runtime = runtime;
    try {
      delete assets['embeddinggemma-worker.js'];
      await runtime.initializeAssets(assets);
      if (revision !== this.revision)
        throw new Error('EmbeddingGemma initialization was cancelled.');
      return runtime;
    } catch (error) {
      runtime.close();
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
