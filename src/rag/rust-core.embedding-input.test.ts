import { afterEach, describe, expect, it, vi } from 'vitest';
import * as wasm from '../../generated/rag-wasm/rag_wasm.js';
import { planEmbeddingInputsRust } from './rust-core';

afterEach(() => vi.restoreAllMocks());

describe('임베딩 입력 계획 WASM 계약', () => {
  it('길이순 고유 입력과 원문 복원 및 누적 진행량을 반환한다', () => {
    const texts = ['a', 'long', 'a', 'bb', 'long', ''];
    const plan = planEmbeddingInputsRust(texts);
    expect(plan).toEqual({
      inputIndices: [1, 3, 0, 5],
      outputIndices: [2, 0, 2, 1, 0, 3],
      cumulativeChunkCounts: [2, 3, 5, 6],
    });
    const uniqueTexts = plan?.inputIndices.map((index) => texts[index]);
    expect(plan?.outputIndices.map((index) => uniqueTexts?.[index])).toEqual(texts);
  });

  it('Unicode 글자수를 사용하고 같은 길이의 최초 순서와 문자열 차이를 보존한다', () => {
    expect(planEmbeddingInputsRust(['😀', 'ab', '가', 'é', 'é', '😀', ''])).toEqual({
      inputIndices: [1, 4, 0, 2, 3, 6],
      outputIndices: [2, 0, 3, 4, 1, 2, 5],
      cumulativeChunkCounts: [1, 2, 4, 5, 6, 7],
    });
  });

  it('빈 입력과 빈 문자열 중복을 처리한다', () => {
    expect(planEmbeddingInputsRust([])).toEqual({
      inputIndices: [],
      outputIndices: [],
      cumulativeChunkCounts: [],
    });
    expect(planEmbeddingInputsRust(['', '', ''])).toEqual({
      inputIndices: [0],
      outputIndices: [0, 0, 0],
      cumulativeChunkCounts: [3],
    });
  });

  it.each([undefined, '{', '{}', '{"inputIndices":[-1]}'])(
    'WASM 응답 %s가 없거나 손상되면 TS 계산으로 대체하지 않는다',
    (response) => {
      vi.spyOn(wasm, 'plan_embedding_inputs_json').mockReturnValue(response);
      expect(planEmbeddingInputsRust(['a', 'long', 'a'])).toBeNull();
    },
  );

  it('WASM 호출 실패를 null로 반환한다', () => {
    vi.spyOn(wasm, 'plan_embedding_inputs_json').mockImplementation(() => {
      throw new Error('synthetic wasm failure');
    });
    expect(planEmbeddingInputsRust(['a'])).toBeNull();
  });

  it.each([
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [1, 4] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [2, 1] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [3, 3] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [0, 3] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [1, 2] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [1.5, 3] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [-1, 3] },
    { inputIndices: [1, 0], outputIndices: [1, 0, 1], cumulativeChunkCounts: [3] },
    { inputIndices: [1, 3], outputIndices: [1, 0, 1], cumulativeChunkCounts: [1, 3] },
    { inputIndices: [1, 0], outputIndices: [2, 0, 1], cumulativeChunkCounts: [1, 3] },
    { inputIndices: [1, 0], outputIndices: [1, 0], cumulativeChunkCounts: [1, 3] },
    { inputIndices: [], outputIndices: [], cumulativeChunkCounts: [] },
  ])('손상된 인덱스와 누적 처리 수를 거부한다: %j', (response) => {
    vi.spyOn(wasm, 'plan_embedding_inputs_json').mockReturnValue(JSON.stringify(response));
    expect(planEmbeddingInputsRust(['a', 'long', 'a'])).toBeNull();
  });
});
