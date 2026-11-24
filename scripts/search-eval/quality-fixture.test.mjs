import { describe, expect, it, vi } from 'vitest';
import { qualityFixture } from './quality-fixture.mjs';
import { createSyntheticCorpus } from './corpus.mjs';
import { scoreInformation } from './quality-oracle.mjs';
import { attemptLedger, assertNoAttempts, loadProductRuntime } from './quality-loop.mjs';

describe('독립 합성 정보 원장 범위', () => {
  it('기존 필수 정보와 다국어·정규화·여러 청크·정답 없음·정책 제외를 별도 사례로 둔다', () => {
    expect(qualityFixture.cases.map((item) => item.id)).toEqual([
      'required-information', 'no-answer', 'hard-excluded-only',
      'english-relations', 'korean-conditions', 'multi-chunk-conditions', 'normalized-body', 'literal-inside-word',
    ]);
    expect(qualityFixture.cases[0].information.map((info) => info.kind)).toEqual(['fact', 'relation', 'condition', 'exception', 'conflict', 'conflict']);
  });

  it('정답의 출처와 절대 행은 제품 결과가 아니라 독립 원문에서 확인한다', () => {
    for (const item of qualityFixture.cases) {
      expect(item.terms.length).toBeGreaterThan(0);
      expect(new Set(item.information.map((info) => info.id)).size).toBe(item.information.length);
      for (const info of item.information) {
        const document = qualityFixture.documents.find((entry) => entry.path === info.path);
        expect(document?.text.split('\n')[info.line - 1]).toBe(info.text);
      }
    }
  });
});

it('합성 제품도 실제 raw corpus와 Native literal API로 조사 포함 네 발생을 센다', async () => {
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product, inventory, source;
  try {
    product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
    expect(product.host.documentCorpus.getSourceBodyHeaders).toBeTypeOf('function');
    source = await runtime.collectIndexedSearchSource(product.host, '항구시험');
    inventory = await source.openLiteralInventory(['항구시험']);
    const summary = await inventory.getSummary();
    expect(summary.needles[0]).toMatchObject({ documents: 1, matchingLines: 4, occurrences: 4 });
    expect((await inventory.readPage(0)).references).toHaveLength(4);
    assertNoAttempts(ledger);
  } finally { await inventory?.close(); await source?.release(); product?.close(); restore(); }
});

it('96개 밖 literal 전용 단서도 실제 원문 심사와 dossier에 도달한다', async () => {
  const target = { path: 'synthetic/000-literal-target.md', text: 'Hyperneedledelta keeps the emergency intake closed during frost.' };
  const documents = [target, ...Array.from({ length: 110 }, (_, index) => ({ path: `synthetic/old-${String(index).padStart(3, '0')}.md`, text: 'needle identifies a decorative catalogue line.' }))];
  const testCase = { question: 'needle', terms: ['needle'], information: [{ id: 'target-condition', kind: 'condition', path: target.path, line: 1, text: target.text }] };
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct(documents, ledger);
    const reads = vi.spyOn(product.host.app.vault, 'readBinary');
    const { source, result } = await runtime.runProductCase(product.host, testCase, ledger);
    expect(source.discoveryCandidates.some((candidate) => candidate.path === target.path)).toBe(false);
    expect(source.reviewPaths).toHaveLength(96);
    expect(result.coverage.requestedPaths).toContain(target.path);
    expect(reads.mock.calls.some(([file]) => file.path === target.path)).toBe(true);
    expect(scoreInformation(testCase, result.dossier.evidence, documents)).toMatchObject({ found: 1, missing: 0, citationFailures: 0, passed: true });
    assertNoAttempts(ledger);
  } finally { product?.close(); restore(); }
});

it('이미 발견한 문서의 literal 위치 힌트가 같은 필수정보의 전달량을 부풀리지 않는다', async () => {
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
    const testCase = qualityFixture.cases.find((item) => item.id === 'multi-chunk-conditions');
    const engine = product.host.ragEngine;
    const original = engine.openLiteralInventory;
    engine.openLiteralInventory = undefined;
    const baseline = await runtime.runProductCase(product.host, testCase, ledger);
    engine.openLiteralInventory = original;
    const actual = await runtime.runProductCase(product.host, testCase, ledger);
    const expected = scoreInformation(testCase, baseline.result.dossier.evidence, qualityFixture.documents);
    const received = scoreInformation(testCase, actual.result.dossier.evidence, qualityFixture.documents);
    expect(received).toMatchObject({ found: 3, missing: 0, citationFailures: 0, passed: true });
    expect(received.deliveredBytes).toBeLessThanOrEqual(expected.deliveredBytes);
    assertNoAttempts(ledger);
  } finally { product?.close(); restore(); }
});

it('bare BM25 field 벤치와 구분해 제품 collect/current/dossier의 6개 출처·구절 회귀를 고정한다', async () => {
  const corpus = createSyntheticCorpus({ scale: 'ci', split: 'dev' });
  const cases = corpus.queries.filter((item) => item.category === 'field-title' || item.category === 'field-path');
  expect(cases).toHaveLength(6);
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct(corpus.documents, ledger);
    for (const item of cases) {
      const information = item.goldPassages.flatMap((passage, index) => {
        const document = corpus.documents.find((entry) => entry.path === passage.path);
        return document.text.split('\n').slice(passage.startLine - 1, passage.endLine).map((text, offset) => ({
          id: `independent-${index}-${offset}`, kind: 'fact', path: passage.path, line: passage.startLine + offset, text,
        }));
      });
      const testCase = { question: item.text, information };
      const { source, result } = await runtime.runProductCase(product.host, testCase, ledger);
      expect(scoreInformation(testCase, result.dossier.evidence, corpus.documents)).toMatchObject({ found: information.length, missing: 0, citationFailures: 0, passed: true });
      const discovered = new Set(source.discoveryCandidates.map((candidate) => candidate.path));
      expect(item.goldPaths.every((path) => discovered.has(path))).toBe(true);
      for (const evidence of result.dossier.evidence) {
        const file = product.files.get(evidence.path);
        expect(evidence.revision).toBe(`${file.stat.mtime}:${file.stat.size}`);
        expect(evidence.contentHash).toBe(runtime.createContentHash(product.texts.get(evidence.path)));
      }
    }
    assertNoAttempts(ledger);
    expect(ledger).toMatchObject({ provider: 0, embedding: 0, network: 0, releases: 6 });
  } finally { product?.close(); restore(); }
});
