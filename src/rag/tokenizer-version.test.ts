import { describe, expect, it } from 'vitest';
import { tokenizerVersionRust } from './rust-core';
import { TOKENIZER_VERSION } from './tokenizer-version';

describe('검색 토큰 규칙 버전', () => {
  it('TypeScript 사본이 WASM 토큰 규칙 버전과 같다', () => {
    expect(tokenizerVersionRust()).toBe(TOKENIZER_VERSION);
  });
});
