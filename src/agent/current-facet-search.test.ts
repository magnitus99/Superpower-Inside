import { describe, expect, it, vi } from 'vitest';
import { coversFacet } from './current-facet-search';
import { planIndexedEvidenceRust } from '../rag/rust-core';
import { prepareCurrentEvidenceSource, resolveCurrentIndexedPassage, reviewIndexedVault, type IndexedVaultReviewOptions } from './indexed-vault-review';

const path = 'Synthetic/vent.md';
const alpha = 'Alpine copper expands under load.';
const beta = 'Lunar mica contracts only in winter.';
const plan = { mode: 'comparison' as const, facets: [
  { kind: 'question' as const, id: 'question', query: 'Compare Alpine copper versus Lunar mica', queryIndex: 0, terms: ['compare'] },
  { kind: 'subject' as const, id: 'subject-0', query: 'alpine copper', queryIndex: 1, terms: ['alpine', 'copper'] },
  { kind: 'subject' as const, id: 'subject-1', query: 'lunar mica', queryIndex: 2, terms: ['lunar', 'mica'] },
] };

function options(row: string): IndexedVaultReviewOptions {
  const text = `${alpha}\n\n${row}`;
  const candidates = [{ path, score: 1, source: 'lexical' as const, rank: 1, startLine: 1, endLine: 1, queryIndex: 1 }];
  return { question: plan.facets[0].query, scopes: ['Synthetic'], indexedPaths: [path], searchPlan: plan,
    candidates, discoveryCandidates: candidates, discoveryPaths: [path], getFollowupPaths: () => Promise.resolve([path]),
    corpus: { getFileIndexRecords: () => Promise.resolve([{ filePath: path, contentHash: 'old', sourceMtime: 1, sourceSize: 1, vectorCount: 1, updated: 1 }]),
      getEntriesByFilePaths: () => Promise.resolve([{ id: 'c1', vector: [], metadata: { filePath: path, startLine: 1, endLine: 1, text: alpha, contentHash: 'old' } }]) },
    executionMode: 'engine-only', provider: { streamChat: vi.fn(() => { throw Error('unexpected provider request'); }) },
    sourceReader: () => Promise.resolve({ revision: '2:4', text, chunks: [{ startLine: 1, endLine: 1, text: alpha }, { startLine: 3, endLine: 3, text: row }] }),
  };
}

describe('부족한 비교 항목의 제한된 현재 원문 탐색', () => {
  it.each(['supported', 'substring', 'not-in-current-chunk', 'scope-revoked', 'filtered'] as const)('%s', async mode => {
    const input = options(mode === 'substring' ? 'Sublunar micaceous mixture.' : beta);
    if (mode === 'not-in-current-chunk') {
      const read = input.sourceReader!;
      input.sourceReader = async path => { const source = await read(path); return { ...source, chunks: source.chunks?.slice(0, 1) }; };
    }
    if (mode === 'scope-revoked') {
      let calls = 0;
      input.getFollowupPaths = () => Promise.resolve(++calls >= 3 ? [] : [path]);
    }
    if (mode === 'filtered') input.filters = { tags: ['unavailable'] };
    const observed = vi.fn();
    const result = await reviewIndexedVault({ ...input, onDiagnostics: observed });
    expect(observed.mock.lastCall?.[0]).toMatchObject({ outcome: result.outcome, stageTrace: result.diagnostics.stageTrace });
    if (mode === 'scope-revoked') {
      expect(result).toMatchObject({ outcome: 'indexing', evidence: [], citations: [], dossier: { evidence: [] } });
      expect(input.provider.streamChat).not.toHaveBeenCalled();
      return;
    }
    const target = result.dossier.answerPlan?.facets.find(f => f.id === 'subject-1');
    expect(target?.status).toBe(mode === 'supported' ? 'supported' : 'missing');
    expect(result.dossier.answerPlan?.synthesisRequired).toBe(mode === 'supported');
    if (mode === 'supported') {
      expect(result.diagnostics.stageTrace?.selectionAndFollowup).toMatchObject({ currentFacetPaths: 1, currentFacetPassages: 1,
        currentFacetScan: { status: 'complete', missing: 1, pathFacetScans: 1, termWindowCandidates: 1, rankedPassages: 1, fullTermPassages: 1, proofRejected: 0, policyDropped: 0 } });
      expect(result.evidence.find(e => target?.sourceIds.includes(e.sourceId))).toMatchObject({ path, quote: beta, startLine: 3, revision: '2:4', queryIndexes: [2] });
    } else if (mode === 'filtered') {
      expect(result.diagnostics.stageTrace?.selectionAndFollowup?.currentFacetScan).toBeUndefined();
    } else {
      expect(result.diagnostics.stageTrace?.selectionAndFollowup).toMatchObject({ currentFacetPaths: 1, currentFacetPassages: 0,
        currentFacetScan: { status: 'complete', missing: 1, pathFacetScans: 1, rankedPassages: 0, fullTermPassages: 0, proofRejected: 0, policyDropped: 0 } });
    }
    expect(input.provider.streamChat).not.toHaveBeenCalled();
  });
});

it.each(['beta-phase', 'beta_phase'])('복합어 %s의 현재 인용만 지지로 채택한다', async term => {
  const compoundPlan = { ...plan, facets: plan.facets.map(f => f.queryIndex === 2 ? { ...f, query: term, terms: [term] } : f) };
  const target = compoundPlan.facets[2];
  const other = term === 'beta-phase' ? 'beta_phase' : 'beta-phase';
  const exact = `The ${term} contracts in winter.`;
  const partial = `The pre-${term} and ${term}-extra were recorded with ${other}.`;
  expect(coversFacet(partial, target)).toBe(false);
  expect(coversFacet(exact, target)).toBe(true);
  expect(coversFacet(term === 'beta-phase' ? 'ＢＥＴＡ－ＰＨＡＳＥ' : 'ＢＥＴＡ＿ＰＨＡＳＥ', target)).toBe(true);
  expect(coversFacet('Both beta and phase were recorded.', target)).toBe(false);
  expect(coversFacet(`The ${term} contracts.`, { ...target, terms: ['phase'] })).toBe(false);
  for (const [row, status] of [[exact, 'supported'], [partial, 'missing']]) {
    const result = await reviewIndexedVault({ ...options(row), searchPlan: compoundPlan });
    const facet = result.dossier.answerPlan?.facets.find(f => f.id === target.id);
    expect(facet?.status).toBe(status);
    expect(result.diagnostics.stageTrace?.selectionAndFollowup?.currentFacetScan?.termWindowCandidates).toBe(status === 'supported' ? 1 : 0);
    if (status === 'supported') expect(result.evidence.find(item => facet?.sourceIds.includes(item.sourceId))?.quote).toBe(exact);
  }
});

it('명시적인 한국어 조사도 현재 청크와 행의 힌트에서 일관되게 처리한다', async () => {
  const row = '운모는 겨울에 수축한다.';
  const input = options(row);
  const searchPlan = { ...plan, facets: plan.facets.map(f => f.queryIndex === 2 ? { ...f, query: '운모', terms: ['운모'] } : f) };
  const result = await reviewIndexedVault({ ...input, searchPlan });
  expect(result.evidence.find(item => item.quote === row)?.queryIndexes).toEqual([2]);
});

describe('큰 원문 주소 교정', () => {
  const quote = 'Lunar mica\ncontracts at night.';
  const item = planIndexedEvidenceRust({ question: 'lunar mica', scopes: [], documents: [{ path, revision: 'before', text: quote, startLine: 1 }] })!.evidence[0];
  it.each(['unique', 'repeated', 'wrong-chunk', 'excluded', 'absent'] as const)('%s', mode => {
    const padding = '雪'.repeat(800_000) + '\n';
    const text = `${padding}${mode === 'absent' ? 'changed' : quote}\n${mode === 'repeated' ? padding + quote : ''}`;
    const source = prepareCurrentEvidenceSource({ revision: 'now', contentHash: 'current', text,
      chunks: [{ text: quote, startLine: mode === 'wrong-chunk' ? 3 : 2, endLine: 3 }] })!;
    const passage = resolveCurrentIndexedPassage({ ...item, quote, startLine: 77, endLine: 78 }, source, mode === 'excluded' ? ['Elsewhere'] : ['Synthetic']);
    if (mode === 'unique') expect(passage).toMatchObject({ quote, sourceId: `${path}#L2-L3`, revision: 'now', contentHash: 'current' });
    else expect(passage).toBeNull();
  });
});

it('reads the bounded ranked variants with independent facet scoring even for a single-topic request', async () => {
  const input = options(beta);
  const opts: IndexedVaultReviewOptions = { ...input, executionMode: undefined, deferAnswer: true, searchPlan: { mode: 'single', facets: [plan.facets[0]] },
    provider: { streamChat: (_m, emit) => { emit({ content: '["lunar mica"]', done: true }); return Promise.resolve(); } },
    rankFollowup: () => Promise.resolve([[path]]),
  };
  const result = await reviewIndexedVault(opts);
  expect(result.diagnostics.counts.discoveryInspectedDocuments).toBe(1);
});
