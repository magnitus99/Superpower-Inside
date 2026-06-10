import { describe, expect, it } from 'vitest';

import { detectCommunities } from './community-detector';

describe('detectCommunities', () => {
  it('Rust/WASM community assignment를 entity id map으로 되돌린다', () => {
    const result = detectCommunities(
      [
        { source: 'entity::a', target: 'entity::b', weight: 1 },
        { source: 'entity::c', target: 'entity::d', weight: 1 },
        { source: 'entity::b', target: 'entity::c', weight: 0.1 },
      ],
      20,
    );

    expect(result.communityIds).toEqual([0, 1]);
    expect(result.communities).toEqual(
      new Map([
        ['entity::a', 0],
        ['entity::b', 0],
        ['entity::c', 1],
        ['entity::d', 1],
      ]),
    );
    expect(result.modularity).toBeGreaterThan(0);
  });
});
