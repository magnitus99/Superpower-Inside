import { describe, expect, it } from 'vitest';

import {
  MAIN_JS_SIZE_LIMIT_BYTES,
  assertMainJsSize,
  needsStrongBundleOptimization,
} from './bundle-size-policy.mjs';

describe('release bundle size policy', () => {
  it('uses a strict decimal 5 MB limit', () => {
    expect(MAIN_JS_SIZE_LIMIT_BYTES).toBe(5_000_000);
  });

  it('requests stronger optimization only when the initial bundle exceeds the limit', () => {
    expect(needsStrongBundleOptimization(5_000_000)).toBe(false);
    expect(needsStrongBundleOptimization(5_000_001)).toBe(true);
  });

  it('rejects a release bundle that remains oversized after optimization', () => {
    expect(() => assertMainJsSize(5_000_000)).not.toThrow();
    expect(() => assertMainJsSize(5_000_001)).toThrow(/exceeds the 5 MB release limit/u);
  });
});
