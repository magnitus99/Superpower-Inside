import { describe, expect, it } from 'vitest';
import { isReleaseVersion } from './release-version.mjs';

describe('release version format', () => {
  it.each(['1.0.0', '3.2.5', '10.20.300', '2026.10.14'])('accepts %s', (version) => {
    expect(isReleaseVersion(version)).toBe(true);
  });

  it.each(['3.2', '3.2.5.1', 'v3.2.5', '3.2.5-rc.1', '03.2.5'])(
    'rejects %s',
    (version) => {
      expect(isReleaseVersion(version)).toBe(false);
    },
  );
});
