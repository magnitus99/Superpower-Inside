import { describe, expect, it } from 'vitest';
import {
  createPagedVectorMatrix,
  estimateRuntimePayloadBytes,
  enforceRuntimePayloadBudget,
} from './runtime-boundary';

describe('RAG runtime boundary', () => {
  it('vector matrix를 고정 크기 Float32Array page로 나눈다', () => {
    const pages = createPagedVectorMatrix(
      [
        { id: 'a', vector: [1, 0] },
        { id: 'b', vector: [0, 1] },
        { id: 'c', vector: [0.5, 0.5] },
      ],
      { pageSize: 2 },
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual(
      expect.objectContaining({
        offset: 0,
        rowCount: 2,
        dimension: 2,
        entryIds: ['a', 'b'],
      }),
    );
    expect(pages[0]?.values).toBeInstanceOf(Float32Array);
    expect(Array.from(pages[0]?.values ?? [])).toEqual([1, 0, 0, 1]);
    expect(pages[1]).toEqual(
      expect.objectContaining({
        offset: 2,
        rowCount: 1,
        dimension: 2,
        entryIds: ['c'],
      }),
    );
  });

  it('runtime payload budget을 넘는 page를 거부한다', () => {
    const page = createPagedVectorMatrix(
      [
        { id: 'a', vector: [1, 0] },
        { id: 'b', vector: [0, 1] },
      ],
      { pageSize: 2 },
    )[0];

    expect(page).toBeDefined();
    if (!page) {
      throw new Error('page가 생성되지 않았습니다.');
    }
    expect(estimateRuntimePayloadBytes(page)).toBe(16);
    expect(() => enforceRuntimePayloadBudget(page, 15)).toThrow(/RAG runtime payload/);
    expect(() => enforceRuntimePayloadBudget(page, 16)).not.toThrow();
  });
});
