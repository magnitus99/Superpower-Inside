import { describe, expect, it } from 'vitest';

import { normalizeRustIndices, selectByRustIndices } from './rust-index-plan';

describe('rust-index-plan', () => {
  const records = ['a', 'b', 'c'];

  it('dedupes indices by default', () => {
    expect(selectByRustIndices(records, [1, 1, 2, 1, 0])).toEqual(['b', 'c', 'a']);
  });

  it('allows duplicate indices when dedupe is false', () => {
    expect(selectByRustIndices(records, [1, 1, 2, 1, 0], { dedupe: false })).toEqual([
      'b',
      'b',
      'c',
      'b',
      'a',
    ]);
  });

  it('filters invalid and out-of-range indices in normalizeRustIndices', () => {
    expect(normalizeRustIndices([0, -1, 3, 2, 1.2], records.length)).toEqual([0, 2]);
  });

  it('returns empty when records length is invalid', () => {
    expect(normalizeRustIndices([0, 1], -1)).toEqual([]);
    expect(normalizeRustIndices([0, 1], Number.NaN)).toEqual([]);
  });
});
