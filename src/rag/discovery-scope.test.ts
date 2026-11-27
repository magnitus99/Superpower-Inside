import { describe, expect, it } from 'vitest';
import { planModelContextRust, scopeIndexedDiscoveryRust } from './rust-core';

describe('large discovery scope through the generated Rust WASM', () => {
  it('preserves the full permitted intersection at five-digit path counts', () => {
    const paths = Array.from({ length: 13_638 }, (_, i) => `Synthetic/자료-${i}.md`);
    const allowedPaths = paths.slice(1);
    expect(scopeIndexedDiscoveryRust({ originalPaths: [...paths, 'Other/test.md'], originalScopes: [],
      allowedPaths: [...allowedPaths, 'Other/test.md', 'Synthetic/new.md'], scopes: ['Synthetic'] })).toEqual(allowedPaths);
  });

  it('rejects oversized UTF-8 input rather than reporting an empty intersection', () => {
    const paths = Array.from({ length: 13_638 }, (_, i) => `Synthetic/${'가'.repeat(105)}-${i}.md`);
    const input = { originalPaths: paths, allowedPaths: paths, originalScopes: [], scopes: [] };
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeGreaterThan(8 * 1024 * 1024);
    expect(scopeIndexedDiscoveryRust(input)).toBeNull();
    // Answer budgeting takes model metadata, never the discovery ledger.
    expect(planModelContextRust({})?.contextTokens).toBe(50_000);
  });
});
