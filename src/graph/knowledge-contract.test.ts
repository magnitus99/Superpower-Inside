import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraphContract } from './knowledge-contract';

describe('KnowledgeGraphContract', () => {
  it('고정 relation whitelist 없이 범용 entity hint만 제공한다', () => {
    const contract = buildKnowledgeGraphContract();

    expect(contract.id).toBe('knowledge-graph');
    expect(contract.entityTypes.map((type) => type.id)).toEqual([
      'person',
      'organization',
      'place',
      'document',
      'event',
      'concept',
      'other',
    ]);
    expect(contract).not.toHaveProperty('relationTypes');
  });
});
