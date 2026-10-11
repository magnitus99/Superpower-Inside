import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { buildEmbeddingGemmaCaution } from './embeddinggemma-caution';
import { updateEmbeddingGemmaStatus } from './embeddinggemma-status';

describe('임베딩 영역 CPU 주의 문구', () => {
  it('정상에서는 숨기고 CPU 전환에서 짧은 오류만 표시하며 종료와 구독 해제를 반영한다', () => {
    const app = {} as App;
    const owner = {};
    const element = {
      hidden: false,
      textContent: '',
      setText(text: string) {
        this.textContent = text;
      },
    };
    const container = { createDiv: () => element };
    const dispose = buildEmbeddingGemmaCaution(container as unknown as HTMLElement, app);
    expect(element.hidden).toBe(true);
    updateEmbeddingGemmaStatus(app, owner, {
      id: 1,
      backend: 'wasm',
      gpuAvailable: true,
      fallbackReason: 'private driver details',
    });
    expect(element.hidden).toBe(false);
    expect(element.textContent).toContain('CPU');
    expect(element.textContent).toContain('WebGPU');
    expect(element.textContent).not.toContain('private driver details');
    updateEmbeddingGemmaStatus(app, owner, { id: 2, backend: 'webgpu', gpuAvailable: true });
    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe('');
    dispose();
    updateEmbeddingGemmaStatus(app, owner, { id: 3, backend: 'wasm', gpuAvailable: true });
    expect(element.hidden).toBe(true);
  });
});
