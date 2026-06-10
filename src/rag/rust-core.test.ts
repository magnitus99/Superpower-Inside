import { describe, expect, it } from 'vitest';

import {
  createContentHashRust,
  chunkMarkdownRust,
  chunkPlainTextRust,
  isRustCoreAvailable,
  rankTopKPairsRust,
  tokenizeRust,
} from './rust-core';

describe('Rust WASM RAG core bridge', () => {
  it('loads embedded WASM bytes synchronously', () => {
    expect(isRustCoreAvailable()).toBe(true);
  });

  it('preserves content hash and tokenizer contracts through WASM', () => {
    expect(createContentHashRust('hello')).toBe('4f9f2cab');
    expect(createContentHashRust('요고49 포인트 페이백')).toBe('d30c670d');

    const tokens = tokenizeRust('OpenRouter freeLLMApi 요고49 포인트 페이백');
    expect(tokens).not.toBeNull();
    expect(tokens).toContain('openrouter');
    expect(tokens).toContain('free');
    expect(tokens).toContain('llm');
    expect(tokens).toContain('요고49');
    expect(tokens).toContain('포인트');
  });

  it('returns original vector row indexes and scores for top-k ranking', () => {
    const scores = rankTopKPairsRust(
      [1, 0],
      [
        [0, 1],
        [1, 0],
        [0.6, 0.8],
        [0, 0],
      ],
      3,
    );

    expect(scores).not.toBeNull();
    expect(scores).toEqual([
      { index: 1, score: 1 },
      { index: 2, score: 0.6 },
      { index: 0, score: 0 },
    ]);
  });

  it('returns markdown chunks with heading and line metadata', () => {
    const chunks = chunkMarkdownRust(
      ['# First', 'alpha', '', 'beta', '# Second', '```', 'const value = 1;', '```'].join('\n'),
      100,
      0,
    );

    expect(chunks).toEqual([
      {
        text: '# First\nalpha\n\nbeta',
        metadata: {
          filePath: '',
          heading: 'First',
          startLine: 0,
          endLine: 3,
        },
      },
      {
        text: '# Second\n```\nconst value = 1;\n```',
        metadata: {
          filePath: '',
          heading: 'Second',
          startLine: 4,
          endLine: 7,
        },
      },
    ]);
  });

  it('returns plain text chunks with blank-line split metadata', () => {
    const chunks = chunkPlainTextRust(['alpha', '', 'beta beta'].join('\n'), 12, 0);

    expect(chunks).toEqual([
      {
        text: 'alpha',
        metadata: {
          filePath: '',
          startLine: 0,
          endLine: 1,
        },
      },
      {
        text: 'beta beta',
        metadata: {
          filePath: '',
          startLine: 2,
          endLine: 2,
        },
      },
    ]);
  });
});
