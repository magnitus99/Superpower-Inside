import { describe, expect, it } from 'vitest';
import { isReleaseVersion } from './release-version.mjs';

describe('release version format', () => {
  it.each(['2026.10.14', '2026.10.14.1', '2026.10.14.12'])('accepts %s', (version) => {
    expect(isReleaseVersion(version)).toBe(true);
  });

  it.each(['3.2.4', '2026.1.14', '2026.10.14.0', '2026.02.30', '2026.10.14-rc.1'])(
    'rejects %s',
    (version) => {
      expect(isReleaseVersion(version)).toBe(false);
    },
  );
});
