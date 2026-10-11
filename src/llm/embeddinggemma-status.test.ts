import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { subscribeEmbeddingGemmaStatus, updateEmbeddingGemmaStatus } from './embeddinggemma-status';

describe('EmbeddingGemma CPU 안내', () => {
  it('GPU 정상 실행과 GPU 없는 CPU 실행은 안내하지 않고 종료 시 안내를 지운다', () => {
    const app = {} as App;
    const owner = {};
    const listener = vi.fn();
    const dispose = subscribeEmbeddingGemmaStatus(app, listener);
    for (const status of [
      { id: 1, backend: 'webgpu' as const, gpuAvailable: true },
      { id: 2, backend: 'wasm' as const, gpuAvailable: false },
    ]) {
      updateEmbeddingGemmaStatus(app, owner, status);
      expect(listener).toHaveBeenLastCalledWith(undefined);
    }
    const fallback = {
      id: 3,
      backend: 'wasm' as const,
      gpuAvailable: true,
      fallbackReason: 'driver failed',
    };
    updateEmbeddingGemmaStatus(app, owner, fallback);
    expect(listener).toHaveBeenLastCalledWith(fallback);
    const reopened = vi.fn();
    const unsubscribe = subscribeEmbeddingGemmaStatus(app, reopened);
    expect(reopened).toHaveBeenLastCalledWith(fallback);
    updateEmbeddingGemmaStatus(app, {}, { id: 4, backend: 'webgpu', gpuAvailable: true });
    expect(listener).toHaveBeenLastCalledWith(fallback);
    updateEmbeddingGemmaStatus(app, owner);
    expect(listener).toHaveBeenLastCalledWith(undefined);
    dispose();
    unsubscribe();
  });
});
