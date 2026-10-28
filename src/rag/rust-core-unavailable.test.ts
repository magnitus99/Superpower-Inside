import { describe, expect, it, vi } from 'vitest';

// WASM 초기화 실패를 재현해 TypeScript 계산 대체가 일어나지 않는지 확인합니다.
vi.mock('../../generated/rag-wasm/rag_wasm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/rag-wasm/rag_wasm.js')>();
  return {
    ...actual,
    initSync: () => {
      throw new Error('synthetic wasm init failure');
    },
  };
});

describe('WASM 초기화 실패 경계', () => {
  it('rankTopKPairsRust는 TypeScript cosine으로 대체하지 않고 null을 반환한다', async () => {
    vi.resetModules();
    const { rankTopKPairsRust } = await import('./rust-core');

    expect(
      rankTopKPairsRust(
        [1, 0],
        [
          [1, 0],
          [0, 1],
        ],
        1,
      ),
    ).toBeNull();
  });
});
