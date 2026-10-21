import { describe, expect, it } from 'vitest';
import {
  planIndexedReviewAnswerPlanRust,
  planIndexedSearchQueriesRust,
  validateIndexedReviewAnswerRust,
} from './rust-core';

describe('indexed search and answer WASM integration', () => {
  it('plans both comparison facets and validates their cited synthesis', () => {
    const searchPlan = planIndexedSearchQueriesRust({
      question: 'Compare "alpha beta" and gamma',
      scoringQuestion: 'alpha beta gamma',
      scopes: [],
    });
    expect(searchPlan?.mode).toBe('comparison');
    expect(searchPlan?.facets.map(({ id, queryIndex }) => ({ id, queryIndex }))).toEqual([
      { id: 'question', queryIndex: 0 },
      { id: 'subject-0', queryIndex: 1 },
      { id: 'subject-1', queryIndex: 2 },
    ]);
    if (!searchPlan) throw new Error('search plan is unavailable');

    const evidence = [
      {
        sourceId: 'synthetic/a.md#L1-L1',
        path: 'synthetic/a.md',
        quote: 'alpha beta',
        queryIndexes: [1],
      },
      {
        sourceId: 'synthetic/b.md#L1-L1',
        path: 'synthetic/b.md',
        quote: 'gamma',
        queryIndexes: [2],
      },
    ];
    const answerPlan = planIndexedReviewAnswerPlanRust({ searchPlan, evidence });
    expect(answerPlan).toMatchObject({
      mode: 'comparison',
      requiredFacetIds: ['subject-0', 'subject-1'],
      missingFacetIds: [],
      synthesisRequired: true,
    });
    if (!answerPlan) throw new Error('answer plan is unavailable');

    expect(
      validateIndexedReviewAnswerRust({
        sourceIds: evidence.map(({ sourceId }) => sourceId),
        answerPlan,
        response: JSON.stringify({
          paragraphs: [
            {
              text: 'Alpha and gamma have different documented constraints.',
              sources: evidence.map(({ sourceId }) => sourceId),
              covers: ['subject-0', 'subject-1'],
            },
          ],
        }),
      }),
    ).toEqual({
      valid: true,
      content:
        'Alpha and gamma have different documented constraints. [synthetic/a.md#L1-L1] [synthetic/b.md#L1-L1]',
    });
  });

  it('rejects a comparison answer that omits a required facet', () => {
    const searchPlan = planIndexedSearchQueriesRust({
      question: 'Compare alpha and beta',
      scopes: [],
    });
    if (!searchPlan) throw new Error('search plan is unavailable');
    const evidence = [
      {
        sourceId: 'synthetic/a.md#L1-L1',
        path: 'synthetic/a.md',
        quote: 'alpha',
        queryIndexes: [1],
      },
      {
        sourceId: 'synthetic/b.md#L1-L1',
        path: 'synthetic/b.md',
        quote: 'beta',
        queryIndexes: [2],
      },
    ];
    const answerPlan = planIndexedReviewAnswerPlanRust({ searchPlan, evidence });
    if (!answerPlan) throw new Error('answer plan is unavailable');

    expect(
      validateIndexedReviewAnswerRust({
        sourceIds: evidence.map(({ sourceId }) => sourceId),
        answerPlan,
        response: JSON.stringify({
          paragraphs: [
            {
              text: 'Only alpha is documented.',
              sources: ['synthetic/a.md#L1-L1'],
              covers: ['subject-0'],
            },
          ],
        }),
      }),
    ).toEqual({
      valid: false,
      reason: 'missing-facet',
      missingFacetIds: ['subject-1'],
    });
  });
});
