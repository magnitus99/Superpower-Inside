import { expect, it, vi } from 'vitest';
import { validateIndexedReviewAnswerRust } from '../rag/rust-core';
import { decodeAnswerBindings, answerBindings } from './answer-bindings';
const bindings = answerBindings(['west#L1','east#L4','east#L5'], [
  { id: 'subject-0', sourceIds: ['west#L1'] }, { id: 'subject-1', sourceIds: ['east#L4'] },
]);
it('only decodes explicitly selected facet/source pairs; never adds a missing side', () => {
  const decode = (p: object): unknown => {
    const wire = decodeAnswerBindings(JSON.stringify({paragraphs:[{text:'Synthetic.',...p}]}),bindings);
    if (!wire) return {};
    const raw: unknown = JSON.parse(wire);
    return raw && typeof raw === 'object' && 'paragraphs' in raw && Array.isArray(raw.paragraphs) ? raw.paragraphs[0] as unknown : null;
  };
  expect(decode({supports:['F1.S1','F2.S2'],additional:['S3']})).toEqual({text:'Synthetic.',covers:['subject-0','subject-1'],sources:['west#L1','east#L4','east#L5']});
  expect(decode({supports:['F1.S1']})).toMatchObject({covers:['subject-0'],sources:['west#L1']});
  for(const p of [{supports:['F2.S1']},{supports:['S3']},{supports:['F1.S1','S3']},{supports:['F1.S1'],additional:['F2.S2']},{supports:['F1.S1','F1.S1']},{supports:['F1.S1'],covers:['subject-1']}])expect(decode(p)).not.toHaveProperty('sources');
});

const answerPlan = { mode: 'comparison' as const, requiredFacetIds: ['subject-0','subject-1'], missingFacetIds: [], synthesisRequired: true,
  facets: ['west#L1','east#L4'].map((s,i)=>({ id:`subject-${i}`,kind:'subject',label:`Side ${i}`,status:'supported' as const,sourceIds:[s] })) };
const validateComparison = (response: string) => validateIndexedReviewAnswerRust({
  sourceIds: ['west#L1','east#L4','east#L5'], answerPlan, response,
});

it('requires the original Rust validator to accept explicit support on both sides of the synthesis', () => {
  const validate = (supports: string[][]) => validateComparison(
    decodeAnswerBindings(JSON.stringify({paragraphs:supports.map(s=>({text:'Synthetic evidence statement.', supports:s}))}),bindings),
  );
  expect(validate([['F1.S1'],['F2.S2']])).toMatchObject({ valid:false, reason:'missing-synthesis' });
  expect(validate([['F1.S1']])).toMatchObject({ valid:false, reason:'missing-facet' });
  expect(validate([['F1.S1','F2.S2']])).toMatchObject({ valid:true });
});

it.each([
  ['plain', (json: string) => json, 'paragraph-1:mixed-or-missing-supports'],
  ['fenced', (json: string) => `\`\`\`json\n${json}\n\`\`\``, 'paragraph-1:mixed-or-missing-supports'],
  ['prose-wrapped', (json: string) => `Synthetic introduction.\n${json}\nSynthetic conclusion.`, 'invalid-json'],
] as const)('rejects %s legacy comparison wire upstream of the more permissive Rust validator', (_style, wrap, reason) => {
  const legacy = wrap(JSON.stringify({ paragraphs: [{
    text: 'Synthetic comparison.', sources: ['west#L1', 'east#L4'], covers: ['subject-0', 'subject-1'],
  }] }));
  expect(validateComparison(legacy)).toMatchObject({ valid: true });

  const rejected = vi.fn();
  const response = decodeAnswerBindings(legacy, bindings, rejected);
  expect(response).toBe('');
  expect(rejected.mock.calls).toEqual([[reason]]);
  expect(validateComparison(response)).toMatchObject({ valid: false, reason: 'invalid-format' });
});

it('preserves legacy single source IDs and wrapping for the Rust validator', () => {
  const legacy = 'Synthetic introduction.\n{"paragraphs":[{"text":"Synthetic.","sources":["west#L1"],"covers":["question"]}]}\nSynthetic conclusion.';
  const rejected = vi.fn();
  const response = decodeAnswerBindings(legacy, null, rejected);
  expect(response).toBe(legacy);
  expect(rejected).not.toHaveBeenCalled();
  expect(validateIndexedReviewAnswerRust({
    sourceIds: ['west#L1'],
    answerPlan: {
      mode: 'single', requiredFacetIds: ['question'], missingFacetIds: [], synthesisRequired: false,
      facets: [{ id: 'question', kind: 'question', label: 'Synthetic', status: 'supported', sourceIds: ['west#L1'] }],
    },
    response,
  })).toMatchObject({ valid: true });
});

it.each([
  ['not JSON', 'invalid-json'],
  ['{"paragraphs":{}}', 'invalid-paragraphs'],
  ['{"paragraphs":[{"text":"Synthetic.","supports":["F1.S1"]}]}', 'paragraph-1:choose-primary-key'],
])('does not bypass comparison decoding when bindings are empty: %s', (raw, reason) => {
  const rejected = vi.fn();
  expect(decodeAnswerBindings(raw, [], rejected)).toBe('');
  expect(rejected.mock.calls).toEqual([[reason]]);
});

it('preserves the Rust diagnostic for an empty comparison paragraph list', () => {
  const rejected = vi.fn();
  const response = decodeAnswerBindings('{"paragraphs":[]}', bindings, rejected);
  expect(rejected).not.toHaveBeenCalled();
  expect(validateComparison(response)).toMatchObject({ valid: false, reason: 'invalid-format', formatIssue: 'invalid-paragraphs' });
});
