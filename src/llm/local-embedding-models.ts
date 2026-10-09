import { normalizePath, requestUrl, type App } from 'obsidian';
import { localModelRangeMatchesRust } from '../rag/rust-core';
import { appLogger } from '../utils/logger';
import {
  createGeneratedFileAdapter,
  GeneratedArtifactRegistry,
} from '../storage/generated-artifacts';
import { EMBEDDINGGEMMA_ASSETS } from '../../generated/embeddinggemma-assets';
import {
  buildTernlightReleaseAssetUrl,
  TERNLIGHT_MODEL_FILE_NAME,
  TERNLIGHT_MODEL_BYTE_LENGTH,
  TERNLIGHT_MODEL_SHA256,
} from './ternlight-model';

export type LocalEmbeddingModelId = 'ternlight-base' | 'embeddinggemma-300m';
export interface LocalModelAsset {
  file: string;
  url: string;
  size: number;
  sha256: string;
}
export interface LocalModelState {
  phase:
    | 'missing'
    | 'checking'
    | 'downloading'
    | 'cancelling'
    | 'verifying'
    | 'ready'
    | 'error'
    | 'deleting';
  completedBytes: number;
  totalBytes: number;
  error?: string;
  hasFiles?: boolean;
}
interface ModelAdapter {
  exists(path: string): Promise<boolean>;
  mkdir?(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, bytes: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
export type LocalModelDownload = (
  asset: LocalModelAsset,
  start: number,
  end: number,
) => Promise<{ status: number; bytes: ArrayBuffer; contentRange?: string }>;
type Listener = (state: LocalModelState) => void;
const logger = appLogger.child('llm.local-model');

export class LocalEmbeddingModels {
  private readonly states = new Map<LocalEmbeddingModelId, LocalModelState>();
  private readonly listeners = new Map<LocalEmbeddingModelId, Set<Listener>>();
  private readonly pending = new Map<
    LocalEmbeddingModelId,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly requiresDownload = new Set<LocalEmbeddingModelId>();

  constructor(
    private readonly adapter: ModelAdapter,
    private readonly root: string,
    private readonly assets: Record<LocalEmbeddingModelId, readonly LocalModelAsset[]>,
    private readonly download: LocalModelDownload = downloadAsset,
    private readonly chunkBytes = 4 * 1024 * 1024,
    private readonly artifacts?: GeneratedArtifactRegistry,
  ) {}

  state(id: LocalEmbeddingModelId): LocalModelState {
    return (
      this.states.get(id) ?? {
        phase: 'missing',
        completedBytes: 0,
        totalBytes: this.assets[id].reduce((sum, asset) => sum + asset.size, 0),
      }
    );
  }

  subscribe(id: LocalEmbeddingModelId, listener: Listener): () => void {
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    this.listeners.set(id, listeners);
    listeners.add(listener);
    listener(this.state(id));
    return () => {
      listeners.delete(listener);
    };
  }

  async refresh(id: LocalEmbeddingModelId): Promise<void> {
    if (this.pending.has(id) || this.state(id).phase === 'deleting') return;
    const present = await Promise.all(
      this.assets[id].map((asset) => this.adapter.exists(this.path(id, asset.file))),
    );
    if (this.pending.has(id) || this.state(id).phase === 'deleting') return;
    this.update(id, {
      phase: present.every(Boolean) ? 'ready' : 'missing',
      hasFiles: present.some(Boolean),
      completedBytes: present.every(Boolean) ? this.state(id).totalBytes : 0,
    });
  }

  prepare(id: LocalEmbeddingModelId, manual = true): Promise<void> {
    if (this.state(id).phase === 'deleting')
      return Promise.reject(new Error('Local model is being deleted.'));
    if (!manual && this.requiresDownload.has(id))
      return Promise.reject(
        new Error('Local model was deleted. Download it again in embedding settings.'),
      );
    const existing = this.pending.get(id);
    if (existing) return existing.promise;
    if (manual) this.requiresDownload.delete(id);
    const controller = new AbortController();
    const promise = this.prepareFiles(id, controller.signal, manual)
      .catch((error: unknown) => {
        this.update(id, {
          phase: controller.signal.aborted ? 'missing' : 'error',
          error: controller.signal.aborted ? undefined : String(error),
          completedBytes: 0,
        });
        logger.warn(
          controller.signal.aborted ? 'Model download cancelled.' : 'Model preparation failed.',
          { data: { model: id, error: controller.signal.aborted ? undefined : String(error) } },
        );
        throw error;
      })
      .finally(() => {
        this.pending.delete(id);
      });
    this.pending.set(id, { controller, promise });
    return promise;
  }

  cancel(id: LocalEmbeddingModelId): void {
    const operation = this.pending.get(id);
    if (!operation) return;
    operation.controller.abort();
    this.update(id, { phase: 'cancelling' });
  }

  async remove(id: LocalEmbeddingModelId): Promise<void> {
    this.requiresDownload.add(id);
    const operation = this.pending.get(id);
    operation?.controller.abort();
    if (operation) await operation.promise.catch(() => undefined);
    this.update(id, { phase: 'deleting', error: undefined });
    try {
      await this.artifactAdapter(id).writeBinary(this.deletionMarker(id), new ArrayBuffer(0));
      for (const asset of this.assets[id]) {
        const path = this.path(id, asset.file);
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
      }
      this.update(id, { phase: 'missing', completedBytes: 0, hasFiles: false });
      logger.notice('Local model files deleted.', { data: { model: id } });
    } catch (error) {
      this.update(id, { phase: 'error', error: String(error) });
      throw error;
    }
  }

  read(id: LocalEmbeddingModelId, file: string): Promise<ArrayBuffer> {
    if (!this.assets[id].some((asset) => asset.file === file))
      return Promise.reject(new Error('Unknown local model asset.'));
    return this.adapter.readBinary(this.path(id, file));
  }

  private path(id: LocalEmbeddingModelId, file: string): string {
    return normalizePath(`${this.root}/${id === 'ternlight-base' ? '' : `${id}/`}${file}`);
  }

  private artifactAdapter(id: LocalEmbeddingModelId): ModelAdapter {
    return this.artifacts
      ? createGeneratedFileAdapter(this.adapter, this.artifacts.forFeature(`local-model:${id}`))
      : this.adapter;
  }

  private update(id: LocalEmbeddingModelId, change: Partial<LocalModelState>): void {
    const state = { ...this.state(id), ...change };
    this.states.set(id, state);
    for (const listener of this.listeners.get(id) ?? []) listener(state);
  }

  private deletionMarker(id: LocalEmbeddingModelId): string {
    return normalizePath(`${this.root}/${id}.deleted`);
  }

  private async prepareFiles(
    id: LocalEmbeddingModelId,
    signal: AbortSignal,
    manual: boolean,
  ): Promise<void> {
    const marker = this.deletionMarker(id);
    if (await this.adapter.exists(marker)) {
      if (!manual)
        throw new Error('Local model was deleted. Download it again in embedding settings.');
      await this.adapter.remove(marker);
    }
    this.update(id, { phase: 'checking', completedBytes: 0, error: undefined });
    let completed = 0;
    for (const asset of this.assets[id]) {
      signal.throwIfAborted();
      const path = this.path(id, asset.file);
      if (await this.adapter.exists(path)) {
        this.update(id, { hasFiles: true });
        const bytes = await this.adapter.readBinary(path);
        if (await validAsset(asset, bytes)) {
          this.artifacts?.forFeature(`local-model:${id}`).register('file', path);
          completed += asset.size;
          this.update(id, { completedBytes: completed, hasFiles: true });
          continue;
        }
      }
      const bundledPath = normalizePath(`${this.root}/${asset.file}`);
      const bundled =
        asset.url.includes('/releases/download/') &&
        id !== 'ternlight-base' &&
        (await this.adapter.exists(bundledPath))
          ? await this.adapter.readBinary(bundledPath)
          : undefined;
      const bundledValid = bundled && (await validAsset(asset, bundled));
      const bytes = bundledValid ? new Uint8Array(bundled) : new Uint8Array(asset.size);
      this.update(id, { phase: 'downloading' });
      for (let start = bundledValid ? asset.size : 0; start < asset.size; ) {
        signal.throwIfAborted();
        const end = Math.min(start + this.chunkBytes, asset.size) - 1;
        const response = await this.download(asset, start, end);
        signal.throwIfAborted();
        if (
          !localModelRangeMatchesRust(
            start,
            end,
            asset.size,
            response.status,
            response.bytes.byteLength,
            response.contentRange ?? '',
          )
        )
          throw new Error(
            `Invalid model download response: ${asset.file} (HTTP ${response.status}).`,
          );
        bytes.set(new Uint8Array(response.bytes), start);
        start += response.bytes.byteLength;
        this.update(id, { completedBytes: completed + start });
      }
      this.update(id, { phase: 'verifying' });
      if (!(await validAsset(asset, bytes.buffer)))
        throw new Error(`Invalid model checksum: ${asset.file}.`);
      signal.throwIfAborted();
      const directory = path.slice(0, path.lastIndexOf('/'));
      if (!(await this.adapter.exists(directory))) await this.adapter.mkdir?.(directory);
      const temporary = `${path}.download.tmp`;
      try {
        await this.artifactAdapter(id).writeBinary(temporary, bytes.buffer);
        signal.throwIfAborted();
        if (await this.adapter.exists(path)) await this.adapter.remove(path);
        await this.artifactAdapter(id).rename(temporary, path);
      } finally {
        if (await this.adapter.exists(temporary)) await this.artifactAdapter(id).remove(temporary);
      }
      completed += asset.size;
      this.update(id, { hasFiles: true });
    }
    signal.throwIfAborted();
    this.update(id, { phase: 'ready', completedBytes: completed });
    logger.notice('Local model files verified.', { data: { model: id } });
  }
}

async function validAsset(asset: LocalModelAsset, bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength !== asset.size) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') ===
    asset.sha256
  );
}

async function downloadAsset(asset: LocalModelAsset, start: number, end: number) {
  const response = await requestUrl({
    url: asset.url,
    method: 'GET',
    headers: { Range: `bytes=${start}-${end}` },
    throw: false,
  });
  return {
    status: response.status,
    bytes: response.arrayBuffer,
    contentRange: response.headers['content-range'] ?? response.headers['Content-Range'],
  };
}

const managers = new WeakMap<object, Map<string, LocalEmbeddingModels>>();
export function getLocalEmbeddingModels(options: {
  app: App;
  pluginId: string;
  pluginVersion: string;
}): LocalEmbeddingModels {
  const adapter = options.app.vault.adapter;
  const root = normalizePath(`${options.app.vault.configDir}/plugins/${options.pluginId}`);
  const key = `${root}:${options.pluginVersion}`;
  const available = managers.get(adapter) ?? new Map<string, LocalEmbeddingModels>();
  managers.set(adapter, available);
  let manager = available.get(key);
  if (!manager) {
    manager = new LocalEmbeddingModels(
      adapter,
      root,
      {
        'ternlight-base': [
          {
            file: TERNLIGHT_MODEL_FILE_NAME,
            size: TERNLIGHT_MODEL_BYTE_LENGTH,
            sha256: TERNLIGHT_MODEL_SHA256,
            url: buildTernlightReleaseAssetUrl(options.pluginVersion),
          },
        ],
        'embeddinggemma-300m': EMBEDDINGGEMMA_ASSETS.map((asset) => ({
          ...asset,
          url:
            asset.url ||
            `${buildTernlightReleaseAssetUrl(options.pluginVersion).slice(0, -TERNLIGHT_MODEL_FILE_NAME.length)}${asset.file}`,
        })),
      },
      undefined,
      undefined,
      new GeneratedArtifactRegistry(options.app, options.pluginId, ['.superpower-inside', root]),
    );
    available.set(key, manager);
  }
  return manager;
}
