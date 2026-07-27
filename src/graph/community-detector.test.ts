import { describe, expect, it } from 'vitest';

import { buildEdges, detectCommunities } from './community-detector';
import type { GraphEntityRecord, GraphRelationRecord } from './store';

describe('detectCommunities', () => {
  it('buildEdges는 relation endpoint 정렬과 confidence 합산을 보존한다', () => {
    const entities = [
      createEntityRecord('entity::b'),
      createEntityRecord('entity::a'),
      createEntityRecord('entity::c'),
    ];
    const relations = [
      createRelationRecord('entity::b', 'entity::a', 0.4),
      createRelationRecord('entity::a', 'entity::b', 0.6),
      createRelationRecord('entity::b', 'missing', 0.9),
      createRelationRecord('entity::c', 'entity::a', 0.2),
    ];

    expect(buildEdges(entities, relations)).toEqual([
      { source: 'entity::a', target: 'entity::b', weight: 1 },
      { source: 'entity::a', target: 'entity::c', weight: 0.2 },
    ]);
  });

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

function createEntityRecord(id: string): GraphEntityRecord {
  return {
    id,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'concept',
    canonicalName: id,
    aliases: [],
    description: '',
    properties: {},
    confidence: 1,
    evidenceIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function createRelationRecord(
  sourceEntityId: string,
  targetEntityId: string,
  confidence: number,
): GraphRelationRecord {
  return {
    id: `${sourceEntityId}->${targetEntityId}`,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId: 'related',
    sourceEntityId,
    targetEntityId,
    description: '',
    properties: {},
    confidence,
    evidenceIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
