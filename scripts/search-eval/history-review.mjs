// Offline ledger only: no app, vault, provider, or local harness dependency.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const setup = ['targetAndBuild', 'modelAndSettings', 'indexReady', 'baselineExcluded', 'fiveNewDistinctRecords', 'existingDataPreserved', 'noActiveTurns'];
const history = ['normalSend', 'terminalAnswer', 'saved', 'listedAndClicked', 'sameQuestion', 'sameBody', 'sameStatus', 'sameCitations', 'sameTurnTrace'];
const stages = ['plan', 'retrieval', 'selectionAndFollowup', 'currentSource', 'dossier', 'generationAndCorrection', 'displayAndCitations'];
const rubric = ['subquestions', 'factsAndCounts', 'comparisonsAndRelations', 'conditionsAndExceptions', 'groundingAndScope'];
const blank = keys => Object.fromEntries(keys.map(key => [key, null]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const validId = id => typeof id === 'string' && uuid.test(id);

export function newLedgers() {
  const run = randomUUID();
  const cases = Array.from({ length: 5 }, (_, i) => ({ item: i + 1, receipt: randomUUID() }));
  return {
    observations: {
      run, checks: blank(setup),
      cases: cases.map(row => ({
        ...row, ui: blank(history),
        trace: Object.fromEntries(stages.map(key => [key, {
          observation: key === 'displayAndCitations' ? 'reopened-ui' : `review.stageTrace.${key}`,
          finding: null, analysis: null,
        }])),
      })),
    },
    review: {
      run, independentHuman: null,
      cases: cases.map(row => ({
        ...row, reference: blank(rubric), userAnswer: blank(rubric),
        rationale: { reference: null, userAnswer: null },
      })),
    },
  };
}

export function evaluate(observations, review) {
  if (!validId(observations?.run) || observations.run !== review?.run ||
      ![observations, review].every(x => Array.isArray(x.cases) && x.cases.length === 5) ||
      new Set(observations.cases.map(x => x?.receipt)).size !== 5) return { status: 'incomplete' };
  let incomplete = false, failed = false;
  const check = (value, good, bad) => {
    if (value === bad) failed = true;
    else if (value !== good) incomplete = true;
  };
  for (const key of setup) check(observations.checks?.[key], true, false);
  if (review.independentHuman !== true) incomplete = true;
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const a = observations.cases[i], b = review.cases[i];
    if (!validId(a?.receipt) || a.receipt !== b?.receipt || a.item !== i + 1 || b.item !== i + 1) return { status: 'incomplete' };
    for (const key of history) check(a.ui?.[key], true, false);
    let firstLoss = 'none';
    const unobserved = [];
    for (const key of stages) {
      const stage = a.trace?.[key];
      const v = a.ui?.sameTurnTrace === true && typeof stage?.analysis === 'string' && stage.analysis.trim()
        ? stage.finding : null;
      if (v !== 'loss' && v !== 'preserved') unobserved.push(key);
      check(v, 'preserved', 'loss');
      if (firstLoss === 'none' && v !== 'preserved') firstLoss = v === 'loss' ? key : 'unknown';
    }
    const gaps = [];
    for (const basis of ['reference', 'userAnswer']) for (const key of rubric) {
      const rationale = b.rationale?.[basis];
      const v = review.independentHuman === true && typeof rationale === 'string' && rationale.trim()
        ? b[basis]?.[key] : null;
      check(v, 'meets', 'misses');
      if (v !== 'meets') gaps.push(`${basis}.${key}:${v === 'misses' ? 'misses' : 'unknown'}`);
    }
    rows.push({ item: i + 1, missingOrFailedUI: history.filter(key => a.ui?.[key] !== true), firstLoss, unobserved, gaps });
  }
  return {
    status: incomplete ? 'incomplete' : failed ? 'failed' : 'passed',
    observedFailure: failed, missingOrFailedSetup: setup.filter(key => observations.checks?.[key] !== true), rows,
  };
}

const root = fileURLToPath(new URL('../../.thinkrail/context/_history-review/', import.meta.url));
async function main(args) {
  if (args.length === 1 && args[0] === 'init') {
    const pair = newLedgers(), dir = path.join(root, pair.review.run);
    await mkdir(root, { recursive: true });
    await mkdir(dir);
    for (const [name, value] of Object.entries(pair)) await writeFile(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    console.log(pair.review.run);
    return;
  }
  if (args.length !== 2 || args[0] !== 'check' || !validId(args[1])) throw Error();
  const load = async name => JSON.parse(await readFile(path.join(root, args[1], `${name}.json`), 'utf8'));
  const a = await load('observations');
  const result = a?.run === args[1] ? evaluate(a, await load('review')) : { status: 'incomplete' };
  console.log(JSON.stringify(result));
  if (result.status !== 'passed') process.exitCode = result.status === 'failed' ? 1 : 2;
}
if (process.argv[1] && path.relative(process.argv[1], fileURLToPath(import.meta.url)) === '') {
  main(process.argv.slice(2)).catch(() => { console.error('history-review: incomplete'); process.exitCode = 2; });
}
