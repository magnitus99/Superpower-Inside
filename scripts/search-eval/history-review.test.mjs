import { describe, expect, it } from 'vitest';
import { evaluate, newLedgers } from './history-review.mjs';

function synthetic() {
  const { observations: a, review: b } = newLedgers();
  const fill = (obj, v) => Object.keys(obj).forEach(k => { obj[k] = v; });
  fill(a.checks, true);
  b.independentHuman = true;
  for (const row of a.cases) {
    fill(row.ui, true);
    for (const stage of Object.values(row.trace)) Object.assign(stage, { finding: 'preserved', analysis: 'synthetic-private-detail' });
  }
  for (const row of b.cases) {
    fill(row.reference, 'meets'); fill(row.userAnswer, 'meets'); fill(row.rationale, 'synthetic-private-detail');
  }
  return [a, b];
}
describe('offline five-turn closeout', () => {
  it('accepts only the reviewed run; never emits input prose', () => {
    const result = evaluate(...synthetic());
    expect(result.status).toBe('passed');
    expect(JSON.stringify(result)).not.toContain('synthetic-private-detail');
  });
  it('blocks an untouched checklist and suppresses unbound trace conclusions', () => {
    const empty = newLedgers();
    expect(evaluate(empty.observations, empty.review).status).toBe('incomplete');
    const [a,b] = synthetic();
    a.cases[1].ui.sameTurnTrace = false;
    expect(evaluate(a,b)).toMatchObject({ status: 'incomplete', observedFailure: true });
    expect(evaluate(a,b).rows[1].firstLoss).toBe('unknown');
  });
  it.each([
    (a,b) => { b.independentHuman = null; }, (a,b) => { b.cases.pop(); },
    (a,b) => { b.cases.reverse(); }, (a,b) => { b.run = newLedgers().review.run; },
    (a,b) => { b.cases[0].rationale.reference = ''; }, (a,b) => { b.cases[0].userAnswer.factsAndCounts = true; },
    a => { a.cases[0].ui.listedAndClicked = undefined; }, a => { a.cases[0].trace.plan.analysis = ''; },
    (a,b) => { a.cases[1].receipt = b.cases[1].receipt = a.cases[0].receipt; },
  ])('blocks absent or mismatched evidence', mutate => {
    const pair = synthetic(); mutate(...pair); expect(evaluate(...pair).status).toBe('incomplete');
  });
  it('does not average away failures or infer the first loss through a gap', () => {
    const [a,b] = synthetic(); b.cases[4].reference.groundingAndScope = 'misses';
    expect(evaluate(a,b).status).toBe('failed');
    a.cases[4].trace.currentSource.finding = 'loss';
    expect(evaluate(a,b).rows[4].firstLoss).toBe('currentSource');
    delete a.cases[4].trace.plan;
    expect(evaluate(a,b)).toMatchObject({ status: 'incomplete' });
    expect(evaluate(a,b).rows[4].firstLoss).toBe('unknown');
  });
});
