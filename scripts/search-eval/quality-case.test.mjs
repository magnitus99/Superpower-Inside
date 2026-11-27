import { describe, expect, it, vi } from 'vitest';
import { attemptLedger, loadProductRuntime } from './quality-loop.mjs';
import { qualityFixture } from './quality-fixture.mjs';
import { scoreInformation, auditLiteralInventory } from './quality-oracle.mjs';

const target = { path: 'synthetic/allowlisted.md', text: 'Caldera controls the return valve.' };
const forbidden = { path: 'excluded/restricted.md', text: 'Vespertine operates the covered inlet.' };
const noAnswer = { question: 'zynthar', terms: ['zynthar'], hardExcludedPaths: [forbidden.path], expectNoAnswer: true, information: [] };
const withEvidence = { ...noAnswer, question: 'caldera', terms: ['caldera'], expectNoAnswer: false };

const failureMessage = (run) => run.then(() => 'returned', (error) => error.message);
const failureReason = (run) => run.then(() => null, (error) => error);

function trackLease(host) {
  const acquire = host.acquireSnapshot;
  let current = true;
  host.acquireSnapshot = () => ({ ...acquire(), isCurrent: () => current });
  return () => { current = false; };
}

async function withProduct(test) {
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct([target, forbidden], ledger);
    await test(runtime, product, ledger);
  } finally { product?.close(); restore(); }
}

describe('합성/볼트 공통 제품 평가 경계', () => {
  it('최종 dossier나 reviewPaths에 없어도 raw discovery 후보의 hard 제외 누출은 실패한다', async () => {
    await withProduct(async (runtime, product, ledger) => {
      const engine = product.host.ragEngine;
      const batch = engine.queryBm25Batch.bind(engine);
      engine.queryBm25Batch = async (...args) => {
        const result = await batch(...args);
        return { ...result, matches: [[{ path: forbidden.path, rank: 1, score: 1 }]] };
      };
      const consume = vi.fn();
      const error = await runtime.runProductCase(product.host, noAnswer, ledger, undefined, consume).then(() => null, (error) => error.message);
      expect(error).toBe('quality-hard-exclusion-leak');
      expect(consume).not.toHaveBeenCalled();
      expect(ledger.releases).toBe(1);
    });
  });

  it('다른 구절이 같은 gold ID를 쓸 때 먼저 찾은 구절로 합격할 수 없다', async () => {
    await withProduct(async (runtime, product, ledger) => {
      const fact = { id: 'one-id', kind: 'fact', path: target.path, line: 1, text: target.text };
      const duplicate = { question: 'caldera', terms: ['caldera'], information: [fact, { ...fact, line: 2, text: 'A separate exception.' }] };
      const consume = vi.fn();
      const error = await runtime.runProductCase(product.host, duplicate, ledger, undefined, consume).then(() => null, (error) => error.message);
      expect(error).toBe('quality-duplicate-gold-id');
      expect(consume).not.toHaveBeenCalled();
      expect(ledger.releases).toBe(0);
    });
  });

  it.each(['incomplete', 'failed-facet', 'stale-lease'])('%s 실행의 빈 근거를 검증된 무답으로 처리하지 않는다', async (mode) => {
    await withProduct(async (runtime, product, ledger) => {
      if (mode === 'incomplete') {
        product.setAllowed([target.path, 'synthetic/not-indexed.md']);
      } else if (mode === 'failed-facet') {
        product.host.ragEngine.queryBm25Batch = async () => null;
        product.host.ragEngine.queryBm25Exhaustive = async () => null;
      } else {
        const acquire = product.host.acquireSnapshot;
        product.host.acquireSnapshot = () => ({ ...acquire(), isCurrent: () => false });
      }
      const consume = vi.fn();
      const error = await runtime.runProductCase(product.host, noAnswer, ledger, undefined, consume).then(() => null, (error) => error.message);
      expect(error).toBe('quality-outcome-incomplete');
      expect(consume).not.toHaveBeenCalled();
      expect(ledger.releases).toBe(1);
    });
  });

  it.each([
    ['evidence-only', 'stale', withEvidence], ['evidence-only', 'policy', withEvidence],
    ['no-evidence', 'stale', noAnswer], ['no-evidence', 'policy', noAnswer],
  ])('%s 결과는 비동기 소비 뒤의 %s에도 반환하지 않는다', async (outcome, mode, testCase) => {
    await withProduct(async (runtime, product, ledger) => {
      const { host } = product;
      const invalidate = trackLease(host);
      const consume = vi.fn(async ({ result }) => {
        expect(result.outcome).toBe(outcome);
        await Promise.resolve();
        if (mode === 'stale') invalidate(); else host.getCandidatePaths = async () => [];
      });
      const message = mode === 'stale' ? 'quality-outcome-incomplete' : 'quality-policy-changed';
      expect(await failureMessage(runtime.runProductCase(host, testCase, ledger, undefined, consume))).toBe(message);
      expect(consume).toHaveBeenCalledOnce();
      expect(ledger).toMatchObject({ provider: 0, embedding: 0, network: 0, releases: 1 });
    });
  });

  it('비동기 소비 중 검색하지 않은 새 경로가 허용되면 무답을 반환하지 않는다', async () => {
    await withProduct(async (runtime, product, ledger) => {
      const consume = vi.fn(async ({ result }) => {
        expect(result.outcome).toBe('no-evidence');
        await Promise.resolve();
        product.host.getCandidatePaths = async () => [target.path, 'synthetic/newly-allowed.md'];
      });
      expect(await failureMessage(runtime.runProductCase(product.host, noAnswer, ledger, undefined, consume))).toBe('quality-policy-changed');
      expect(consume).toHaveBeenCalledOnce();
      expect(ledger.releases).toBe(1);
    });
  });

  it.each(['stale', 'abort'])('최종 허용 경로 조회가 대기하는 동안 발생한 %s를 다시 확인한다', async (mode) => {
    await withProduct(async (runtime, product, ledger) => {
      const controller = new AbortController();
      const invalidate = trackLease(product.host);
      const recheck = vi.fn(async () => {
        await Promise.resolve();
        if (mode === 'stale') invalidate(); else controller.abort();
        return [target.path];
      });
      const run = runtime.runProductCase(product.host, noAnswer, ledger, controller.signal, async () => {
        product.host.getCandidatePaths = recheck;
      });
      if (mode === 'stale') expect(await failureMessage(run)).toBe('quality-outcome-incomplete');
      else expect(await failureReason(run)).toBe(controller.signal.reason);
      expect(recheck).toHaveBeenCalled();
      expect(ledger.releases).toBe(1);
    });
  });

  it.each(['stale', 'abort', 'policy'])('literal 정리 대기 중의 %s로 평가 결과를 무효화한다', async (mode) => {
    await withProduct(async (runtime, product, ledger) => {
      const controller = new AbortController();
      const invalidate = trackLease(product.host);
      const corpus = product.host.documentCorpus;
      const cleanup = corpus.deleteLiteralPages.bind(corpus);
      let consumed = false;
      const close = vi.spyOn(corpus, 'deleteLiteralPages').mockImplementation(async (...args) => {
        await cleanup(...args);
        if (!consumed) return;
        if (mode === 'stale') invalidate();
        else if (mode === 'abort') controller.abort();
        else product.host.getCandidatePaths = async () => [];
      });
      const run = runtime.runProductCase(product.host, noAnswer, ledger, controller.signal, async () => { consumed = true; });
      if (mode === 'abort') expect(await failureReason(run)).toBe(controller.signal.reason);
      else expect(await failureMessage(run)).toBe(mode === 'stale' ? 'quality-outcome-incomplete' : 'quality-policy-changed');
      expect(consumed).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      expect(ledger.releases).toBe(1);
    });
  });

  it.each(['stale', 'abort'])('소비 직전 허용 경로 조회의 %s는 콜백에 결과를 넘기지 않는다', async (mode) => {
    await withProduct(async (runtime, product, ledger) => {
      const { host } = product;
      const controller = new AbortController();
      const invalidate = trackLease(host);
      const open = host.ragEngine.openLiteralInventory.bind(host.ragEngine);
      host.ragEngine.openLiteralInventory = async (...args) => {
        const handle = await open(...args);
        let summaries = 0;
        return { ...handle, getSummary: async () => {
          const summary = await handle.getSummary();
          if (++summaries === 2) host.getCandidatePaths = async () => {
            await Promise.resolve();
            if (mode === 'stale') invalidate(); else controller.abort();
            return [target.path];
          };
          return summary;
        } };
      };
      const consume = vi.fn();
      const run = runtime.runProductCase(host, noAnswer, ledger, controller.signal, consume);
      if (mode === 'stale') expect(await failureMessage(run)).toBe('quality-outcome-incomplete');
      else expect(await failureReason(run)).toBe(controller.signal.reason);
      expect(consume).not.toHaveBeenCalled();
      expect(ledger.releases).toBe(1);
    });
  });

  it.each(['lease', 'policy'])('소비 뒤 %s 현재성을 확인할 방법이 없으면 통과시키지 않는다', async (mode) => {
    await withProduct(async (runtime, product, ledger) => {
      const { host } = product;
      if (mode === 'lease') {
        const acquire = host.acquireSnapshot;
        host.acquireSnapshot = () => ({ ...acquire(), isCurrent: undefined });
      }
      const consume = vi.fn(async () => {
        if (mode === 'policy') host.getCandidatePaths = undefined;
      });
      expect(await failureMessage(runtime.runProductCase(host, noAnswer, ledger, undefined, consume)))
        .toBe(mode === 'lease' ? 'quality-outcome-incomplete' : 'quality-policy-changed');
      expect(consume).toHaveBeenCalledTimes(mode === 'lease' ? 0 : 1);
      expect(ledger.releases).toBe(1);
    });
  });

  it('검색 입력 수집 중 중단되면 출처 없음으로 바꾸지 않고 중단을 전파한다', async () => {
    await withProduct(async (runtime, product, ledger) => {
      const controller = new AbortController();
      product.host.getCandidatePaths = async () => { controller.abort(); return [target.path]; };
      const consume = vi.fn();
      const run = runtime.runProductCase(product.host, noAnswer, ledger, controller.signal, consume);
      expect(await failureReason(run)).toBe(controller.signal.reason);
      expect(consume).not.toHaveBeenCalled();
      expect(ledger.releases).toBe(1);
    });
  });

  it('완전한 검색에서만 빈 결과를 실제 무답으로 보존한다', async () => {
    await withProduct(async (runtime, product, ledger) => {
      const { result } = await runtime.runProductCase(product.host, noAnswer, ledger);
      expect(result).toMatchObject({ outcome: 'no-evidence', evidence: [], coverage: { status: 'supported' } });
      expect(result.dossier.literalInventory.status).toBe('complete');
      expect(ledger.releases).toBe(1);
    });
  });
});

it('실제 비교 실행에서 두 subject facet의 후보와 현재 원문 인용을 각각 귀속한다', async () => {
  const testCase = qualityFixture.cases.find((item) => item.id === 'two-facet-comparison');
  expect(testCase).toBeDefined();
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    const documents = qualityFixture.documents;
    product = await runtime.createSyntheticProduct(documents, ledger);
    const { source, result } = await runtime.runProductCase(product.host, testCase, ledger, undefined, async ({ source, result }) => {
      const collected = source.discoveryCandidates.map((item) => item.path);
      expect(await auditLiteralInventory(testCase, result.dossier.literalInventory, result.readLiteralDiscoveryPage, documents, collected)).toEqual({ passed: true, discoveryMissing: 0 });
    });
    expect(source.searchPlan).toMatchObject({ mode: 'comparison', failedFacetIds: [] });
    expect(source.searchPlan.facets.filter((facet) => facet.kind === 'subject').map((facet) => [facet.query, facet.queryIndex])).toEqual([['asterline', 1], ['brindlewick', 2]]);
    expect(result.dossier.answerPlan).toMatchObject({ mode: 'comparison', missingFacetIds: [], synthesisRequired: true });
    expect(result.dossier.answerPlan.facets).toHaveLength(2);
    for (const [index, path] of ['synthetic/asterline.md', 'synthetic/brindlewick.md'].entries()) {
      const queryIndex = index + 1;
      const facet = result.dossier.answerPlan.facets[index];
      expect(facet.status).toBe('supported');
      expect(facet.sourceIds.length).toBeGreaterThan(0);
      expect(source.discoveryCandidates.filter((item) => item.queryIndex === queryIndex).map((item) => item.path)).toEqual([path]);
      for (const id of facet.sourceIds) {
        const citation = result.dossier.evidence.find((item) => item.sourceId === id);
        expect(citation).toMatchObject({ path, queryIndexes: expect.arrayContaining([queryIndex]), contentHash: runtime.createContentHash(product.texts.get(path)) });
        expect(citation.queryIndexes).not.toContain(index === 0 ? 2 : 1);
        const { stat } = product.files.get(path);
        expect(citation.revision).toBe(`${stat.mtime}:${stat.size}`);
      }
    }
    expect(scoreInformation(testCase, result.dossier.evidence, documents)).toMatchObject({ required: 4, found: 4, missing: 0, passed: true });
    expect(ledger).toMatchObject({ provider: 0, embedding: 0, network: 0, releases: 1 });
  } finally { product?.close(); restore(); }
});
