import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { scoreInformation, firstLoss, lexicalOracle, mandatoryGate, auditLiteralInventory } from './quality-oracle.mjs';
import { evaluateVaultRuntime } from './quality-vault.mjs';
import { literalProtocolFixture } from './quality-test-runtime.mjs';

const documents = [{ path: 'synthetic/context.md', text: 'Zephyr has one intake.\nZephyr starts at dawn.\nIt remains closed during frost.' }];
const testCase = { information: [{ id: 'frost-condition', kind: 'condition', path: documents[0].path, line: 3, text: 'It remains closed during frost.' }] };
const passage = { path: documents[0].path, startLine: 2, endLine: 2, quote: 'Zephyr starts at dawn.', contextBefore: 'Zephyr has one intake.\n', contextAfter: '\nIt remains closed during frost.' };

describe('literal 총계와 실제 페이지의 독립 전수 대조', () => {
  function fixture() {
    const docs = [{ path: 'synthetic/a', text: 'aaaaa\r\nﬃ' }];
    const terms = ['aa', 'f'];
    const references = [{ path: docs[0].path, line: 1, needleIndex: 0, normalizedStart: 0, normalizedEnd: 2 }, { path: docs[0].path, line: 1, needleIndex: 0, normalizedStart: 2, normalizedEnd: 4 }, { path: docs[0].path, line: 2, needleIndex: 1, normalizedStart: 0, normalizedEnd: 1 }, { path: docs[0].path, line: 2, needleIndex: 1, normalizedStart: 1, normalizedEnd: 2 }];
    const inventory = { status: 'complete', summary: { matchMode: 'nfkc-unicode-lower-line-substring-v1', sources: 1, pageCount: 1, needles: terms.map((needle) => ({ needle, normalizedNeedle: needle, documents: 1, matchingLines: 1, occurrences: 2 })) } };
    return { docs, terms, references, inventory, read: (index) => Promise.resolve(index === 0 ? { pageIndex: 0, nextPage: null, references } : null) };
  }
  it('NFKC 확장 두 발생과 비중첩·실제 행·정규화 UTF8주소를 페이지에서 확인한다', async () => {
    const data = fixture();
    expect(await auditLiteralInventory({ terms: data.terms }, data.inventory, data.read, data.docs)).toEqual({ passed: true, discoveryMissing: 0 });
  });
  it.each(['missing', 'duplicate', 'line', 'span', 'path'])('총계만 맞고 %s인 원장은 합격하지 않는다', async (kind) => {
    const data = fixture();
    if (kind === 'missing') data.references.pop();
    if (kind === 'duplicate') data.references[3] = { ...data.references[2] };
    if (kind === 'line') data.references[2].line = 1;
    if (kind === 'span') data.references[2].normalizedStart = 1;
    if (kind === 'path') data.references[2].path = 'synthetic/excluded';
    expect((await auditLiteralInventory({ terms: data.terms }, data.inventory, data.read, data.docs)).passed).toBe(false);
  });
  it.each(['line', 'span', 'missing', 'duplicate', 'unknown-index'])('추가 planner needle의 %s도 필수 term 밖이라고 건너뛰지 않는다', async (kind) => {
    const data = fixture();
    if (kind === 'line') data.references[2].line = 99;
    if (kind === 'span') data.references[2].normalizedStart = 99;
    if (kind === 'missing') data.references.pop();
    if (kind === 'duplicate') data.references[3] = { ...data.references[2] };
    if (kind === 'unknown-index') data.references[2].needleIndex = 2;
    expect((await auditLiteralInventory({ terms: ['aa'] }, data.inventory, data.read, data.docs)).passed).toBe(false);
  });
  it.each(['valid', 'missing', 'span'])('중복 정규화 needle도 각 index 전체를 대조한다 (%s)', async (kind) => {
    const data = fixture();
    data.inventory.summary.needles.push({ ...data.inventory.summary.needles[0], needle: 'ＡＡ' });
    const alias = data.references.slice(0, 2).map((reference) => ({ ...reference, needleIndex: 2 }));
    if (kind === 'missing') alias.pop();
    if (kind === 'span') alias[0].normalizedStart = 99;
    data.references.splice(2, 0, ...alias);
    expect((await auditLiteralInventory({ terms: ['aa'] }, data.inventory, data.read, data.docs)).passed).toBe(kind === 'valid');
  });
  it('독립 기준선의 카운트를 재사용하고 새 planner needle은 한 번만 묶어 스캔한다', async () => {
    const data = fixture();
    const terms = ['aa', 'aa', 'ＡＡ', 'f', 'Ｆ', 'fi'];
    const literal = literalProtocolFixture(data.docs, terms);
    const testCase = { terms: ['aa', 'aa'] };
    const baseline = lexicalOracle(data.docs, testCase.terms);
    const scan = vi.fn(lexicalOracle);
    expect(await auditLiteralInventory(testCase, literal.inventory, literal.readPage, data.docs, [], scan, baseline)).toEqual({ passed: true, discoveryMissing: 0 });
    expect(scan.mock.calls).toEqual([[data.docs, ['f', 'fi'], []]]);
    scan.mockClear();
    expect(await auditLiteralInventory(testCase, literal.inventory, literal.readPage, data.docs, [], scan)).toEqual({ passed: true, discoveryMissing: 0 });
    expect(scan.mock.calls).toEqual([[data.docs, testCase.terms, []], [data.docs, ['f', 'fi'], []]]);
  });
  it('matchline나 literal 총계를 token·관측된 페이지 수로 대체하지 않는다', async () => {
    const data = fixture(); data.inventory.summary.needles[0].matchingLines = 2;
    expect((await auditLiteralInventory({ terms: data.terms }, data.inventory, data.read, data.docs)).passed).toBe(false);
    data.inventory.status = 'failed';
    expect((await auditLiteralInventory({ terms: data.terms }, data.inventory, data.read, data.docs)).passed).toBe(false);
  });
  it('깨끗한 literal 페이지라도 hard 제외 후보의 별도 노출을 덮지 못한다', async () => {
    const data = fixture();
    const testCase = { terms: ['aa'], hardExcludedPaths: [data.docs[0].path] };
    const literal = literalProtocolFixture(data.docs, testCase.terms, testCase.hardExcludedPaths);
    expect(await auditLiteralInventory(testCase, literal.inventory, literal.readPage, data.docs, testCase.hardExcludedPaths)).toEqual({ passed: false, discoveryMissing: 0 });
  });
  it('중간·후속 페이지 유실이나 보고하지 않은 추가 페이지도 실패다', async () => {
    const data = fixture();
    expect((await auditLiteralInventory({ terms: data.terms }, data.inventory, () => Promise.resolve(null), data.docs)).passed).toBe(false);
    expect((await auditLiteralInventory({ terms: data.terms }, data.inventory, (index) => data.read(0).then((page) => ({ ...page, pageIndex: index })), data.docs)).passed).toBe(false);
  });
});

describe('인용과 주변 문맥의 독립 정보 평가', () => {
  it('실제로 전달되고 현재 원문에 붙어 있는 조건을 문맥에서도 회수한다', () => {
    expect(scoreInformation(testCase, [passage], documents)).toMatchObject({ found: 1, missing: 0, citationFailures: 0, passed: true });
  });

  it.each(['contextBefore', 'contextAfter'])('%s의 조작은 정상 인용으로 숨기지 못한다', (key) => {
    const row = scoreInformation({ information: [] }, [{ ...passage, [key]: 'fabricated-context' }], documents);
    expect(row.citationFailures).toBe(1);
    expect(row.passed).toBe(false);
  });

  it.each([[0, 2], [1.5, 2], [2, 1], [2, 4], [1, 3]])('잘못된 절대 행 %s..%s를 승격하지 않는다', (startLine, endLine) => {
    expect(scoreInformation({ information: [] }, [{ ...passage, startLine, endLine }], documents)).toMatchObject({ citationFailures: 1, passed: false });
  });

  it('다른 위치의 조건이나 전달하지 않은 문맥으로 회수를 부풀리지 않는다', () => {
    expect(scoreInformation(testCase, [{ ...passage, contextAfter: '' }], documents)).toMatchObject({ found: 0, missing: 1, passed: false });
    const wrongLine = { information: [{ ...testCase.information[0], line: 1 }] };
    expect(scoreInformation(wrongLine, [passage], documents)).toMatchObject({ found: 0, missing: 1, passed: false });
  });

  it('행 끝 개행을 포함한 정상 인용은 다음 행의 내용으로 오해하지 않는다', () => {
    expect(scoreInformation({ information: [] }, [{ ...passage, quote: `${passage.quote}\n`, contextAfter: 'It remains closed during frost.' }], documents)).toMatchObject({ citationFailures: 0, passed: true });
  });

  it('같은 행의 앞 출현이 빠져도 뒤쪽 정상 전달본으로 같은 정보를 회수한다', () => {
    const fact = 'Valve stays closed.';
    const suffix = `Late note: ${fact}`;
    const repeated = [{ path: 'synthetic/repeated.md', text: `${fact} ${'maintenance '.repeat(300)}${suffix}` }];
    const gold = { information: [{ id: 'closed', kind: 'condition', path: repeated[0].path, line: 1, text: fact }] };
    const item = { path: repeated[0].path, startLine: 1, endLine: 1, quote: suffix };
    expect(scoreInformation(gold, [item], repeated)).toMatchObject({ found: 1, missing: 0, citationFailures: 0, passed: true });
    expect(scoreInformation(gold, [{ ...item, quote: 'Late note:' }], repeated)).toMatchObject({ found: 0, missing: 1, passed: false });
    expect(scoreInformation({ information: [{ ...gold.information[0], line: 2 }] }, [item], repeated)).toMatchObject({ found: 0, missing: 1, passed: false });
  });

  it('중복 문맥은 유일 정보 회수 대신 전달 비용으로 남는다', () => {
    const once = scoreInformation(testCase, [passage], documents);
    const twice = scoreInformation(testCase, [passage, passage], documents);
    expect(twice).toMatchObject({ found: 1, missing: 0, duplication: 1, passed: true });
    expect(twice.deliveredBytes).toBe(once.deliveredBytes * 2);
  });

  it('볼트 VM에 넣는 scorer도 중복 gold ID를 하나로 합쳐 합격시키지 않는다', () => {
    const duplicate = { information: [testCase.information[0], { ...testCase.information[0], line: 2 }] };
    const score = runInNewContext(`(${scoreInformation.toString()})`, { TextEncoder });
    expect(score(testCase, [passage], documents)).toEqual(scoreInformation(testCase, [passage], documents));
    for (const scorer of [score, scoreInformation]) expect(() => scorer(duplicate, [passage], documents)).toThrow('quality-duplicate-gold-id');
  });
});

describe('밀도 비교와 관측 범위의 정직성', () => {
  async function evaluate(extra = [], discovered = [documents[0].path]) {
    const current = documents.concat(extra).map((document) => ({ ...document, revision: '1:1', contentHash: 'synthetic-hash' }));
    const evidence = [{ ...passage, revision: '1:1', contentHash: 'synthetic-hash' }];
    const item = { ...testCase, question: 'Zephyr', terms: ['zephyr'] };
    const expected = lexicalOracle(current, item.terms);
    const literal = literalProtocolFixture(current, item.terms, [], discovered);
    return evaluateVaultRuntime({}, { acquireRagEngineOnlySnapshot: async () => ({ ragEngine: {}, documentCorpus: {}, release() {} }) }, {
      createEngineOnlyVaultHost: () => ({}), readOracleDocuments: async () => current,
      runProductCase: async (_host, _case, _ledger, _signal, consume) => {
        const value = { source: { discoveryCandidates: discovered.map((path) => ({ path })) }, result: { readLiteralDiscoveryPage: literal.readPage, dossier: { literalInventory: literal.inventory, evidence, matchInventory: [{ query: 'zephyr', totalDocuments: expected.documents, totalOccurrences: expected.occurrences }] } } };
        await consume?.(value); return value;
      },
    }, [item], lexicalOracle, scoreInformation, mandatoryGate);
  }

  it('필수 조건을 잃은 기준선보다 높다는 이유만으로 밀도 개선을 인증하지 않는다', async () => {
    const report = await evaluate();
    expect(report.status).toBe('passed');
    expect(report.rows[0]).toMatchObject({ found: 1, missing: 0, densityImproved: null, cappedRecall: null, baseline: { found: 0, missing: 1, passed: false } });
  });

  it('최종 필수 정보가 있어도 관측한 discovery 누락을 none으로 숨기지 않는다', async () => {
    const report = await evaluate([{ path: 'synthetic/auxiliary.md', text: 'Zephyr catalogue entry.' }]);
    expect(report.status).toBe('failed');
    expect(report.rows[0]).toMatchObject({ found: 1, missing: 0, discoveryMissing: 1, firstLoss: 'discovery', passed: false });
  });
});

describe('관측한 최초 손실만 판정한다', () => {
  it.each([
    [{ oracleFound: true, discoveryFound: false }, 'discovery'],
    [{ oracleFound: true, discoveryFound: true, verifiedFound: false }, 'verification'],
    [{ oracleFound: true, discoveryFound: true, verifiedFound: true, dossierFound: false }, 'dossier'],
    [{ oracleFound: true, discoveryFound: true, dossierFound: false }, 'unknown'],
    [{ oracleFound: true, discoveryFound: null, verifiedFound: false }, 'unknown'],
    [{ oracleFound: true, discoveryFound: true, verifiedFound: true, dossierFound: true }, 'none'],
  ])('뒤 단계 미실행은 이미 관측한 앞 실패를 지우지 않는다', (stages, expected) => {
    expect(firstLoss(stages)).toBe(expected);
  });
});
