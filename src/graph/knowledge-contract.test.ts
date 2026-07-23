import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraphContract } from './knowledge-contract';

describe('KnowledgeGraphContract', () => {
  it('작업 지식까지 표현하는 v2 ontology와 열린 relation hint를 제공한다', () => {
    const contract = buildKnowledgeGraphContract();

    expect(contract.id).toBe('knowledge-graph');
    expect(contract.version).toBe(2);
    expect(contract.entityTypes.map((type) => type.id)).toEqual([
      'person',
      'organization',
      'place',
      'document',
      'event',
      'concept',
      'project',
      'task',
      'decision',
      'question',
      'requirement',
      'metric',
      'product',
      'technology',
      'other',
    ]);
    expect(contract.claimTypes.map((type) => type.id)).toEqual([
      'factual_claim',
      'interpretive_claim',
      'evaluative_claim',
      'decision_claim',
      'hypothesis_claim',
      'requirement_claim',
      'action_item_claim',
    ]);
    expect(contract.allowUnknownRelationTypes).toBe(true);
    expect(contract.relationTypeHints.map((type) => type.id)).toEqual(
      expect.arrayContaining(['depends_on', 'supports', 'contradicts', 'blocks', 'implements']),
    );
  });
});
