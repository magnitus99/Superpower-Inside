import { describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

// 공개 main 테스트도 사용자 보고서를 읽거나 덮어쓰지 않습니다.
vi.mock('node:fs/promises', async (original) => ({ ...await original(), mkdir: vi.fn(), writeFile: vi.fn() }));
vi.mock('esbuild', async (original) => ({ ...await original(), build: vi.fn((...args) => original().then((actual) => actual.build(...args))) }));
import { qualityFixture } from './quality-fixture.mjs';
import { lexicalOracle, scoreInformation, mandatoryGate, firstLoss } from './quality-oracle.mjs';
import { literalProtocolFixture } from './quality-test-runtime.mjs';

const testCase = qualityFixture.cases[0];
const evidence = testCase.information.map((info) => ({ path: info.path, quote: info.text, startLine: info.line, endLine: info.line }));
describe('독립 품질 oracle', () => {
  it('문서·구절·발생을 구별하고 hard 제외를 세계 밖으로 둔다', () => {
    const result = lexicalOracle([{ path: 'a', text: 'QUARTZ quartz\nＱＵＡＲＴＺ' }, { path: 'x', text: 'quartz' }], ['quartz'], ['x']);
    expect([result.documents, result.passages, result.occurrences]).toEqual([1, 2, 3]);
  });
  it.each(['fact', 'condition', 'exception', 'conflict-left', 'conflict-right', 'relation'])('%s 하나 누락은 평균/밀도로 상쇄 불가', (id) => {
    const row = scoreInformation(testCase, evidence.filter((_, i) => testCase.information[i].id !== id), qualityFixture.documents);
    expect(row.passed).toBe(false);
    expect(mandatoryGate([{ passed: true }, row])).toBe(false);
  });
  it('중복은 유용 recall을 부풀리지 않고 전달량/중복 비용에 남는다', () => {
    const base = scoreInformation(testCase, evidence, qualityFixture.documents);
    const duplicate = scoreInformation(testCase, [...evidence, ...evidence], qualityFixture.documents);
    expect(base.passed).toBe(true);
    expect(duplicate.found).toBe(base.found);
    expect(duplicate.duplication).toBe(evidence.length);
    expect(duplicate.deliveredBytes).toBe(base.deliveredBytes * 2);
    expect(firstLoss({ oracleFound: true, dossierFound: false })).toBe('unknown');
  });
});

import { attemptLedger, assertNoAttempts, loadProductRuntime, publicReport, runSyntheticQuality } from './quality-loop.mjs';
import { evaluateVaultRuntime, buildQualityVaultCode } from './quality-vault.mjs';
import { createContext, runInContext, runInNewContext } from 'node:vm';

describe('제품 runtime 경계와 비노출', () => {
  it('실제 제품 collect/current/review를 실행하며 semantic 합격으로 승격하지 않는다', async () => {
    const report = await runSyntheticQuality();
    expect(report.status).toBe('passed');
    expect(report.rows[0]).toMatchObject({ found: 6, missing: 0, current: true, aggregationPass: true, discoveryMissing: 0 });
    expect(report.rows).toHaveLength(qualityFixture.cases.length);
    qualityFixture.cases.forEach((item, index) => {
      expect(report.rows[index]).toMatchObject({
        required: new Set(item.information.map((info) => info.id)).size,
        found: new Set(item.information.map((info) => info.id)).size,
        missing: 0, passed: true, current: true, aggregationPass: true, discoveryMissing: 0,
        noAnswerPass: item.expectNoAnswer ? true : null,
      });
    });
    expect(report.semantic).toBe('unverified-no-prepared-vectors');
    expect(report.ledger).toMatchObject({ provider: 0, embedding: 0, network: 0, releases: qualityFixture.cases.length });
    expect(publicReport(report)).toEqual(report);
  });
  it('내부에서 흡수한 embedding sentinel도 최종 시도 원장으로 실패한다', async () => {
    const ledger = attemptLedger();
    const { runtime, restore } = await loadProductRuntime(ledger);
    let product;
    try {
      product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
      product.host.ragEngine.query = async () => { ledger.embedding++; throw new Error('synthetic-sensitive-embedding-error'); };
      await expect(runtime.runProductCase(product.host, testCase, ledger)).rejects.toThrow('quality-attempt-blocked');
      expect(ledger.embedding).toBeGreaterThan(0);
      expect(() => assertNoAttempts(ledger)).toThrow('quality-attempt-blocked');
      expect(ledger.releases).toBe(1);
    } finally { product?.close(); restore(); }
  });
  it.each(['provider', 'network'])('제품 내부에서 흡수한 %s 시도도 실패하고 lease를 해제한다', async (kind) => {
    const ledger = attemptLedger();
    const { runtime, restore } = await loadProductRuntime(ledger);
    let product;
    try {
      product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
      const query = product.host.ragEngine.query.bind(product.host.ragEngine);
      product.host.ragEngine.query = async (...args) => {
        try { ledger[kind]++; throw new Error('synthetic-swallowed-attempt'); } catch { /* 제품 catch를 합성합니다. */ }
        return query(...args);
      };
      await expect(runtime.runProductCase(product.host, testCase, ledger)).rejects.toThrow('quality-attempt-blocked');
      expect(ledger[kind]).toBeGreaterThan(0);
      expect(ledger.releases).toBe(1);
    } finally { product?.close(); restore(); }
  });
  it('비밀이 항목명·오류·진행·stdout/stderr 필드에 섞여도 공개 직렬화하지 않는다', () => {
    const secret = 'independent-synthetic-private-sentinel';
    for (const injected of [
      { status: secret }, { reason: secret }, { [secret]: 1 }, { quote: secret },
      { providerError: secret }, { progress: secret }, { stdout: secret }, { stderr: secret },
      { rows: [{ firstLoss: secret }] }, { dossier: { question: secret } },
    ]) expect(() => publicReport(injected)).toThrow('quality-output-blocked');
  });
});

describe('vault 전용 API 합성 검사(실제 앱 미실행)', () => {
  const evaluate = (plugin, runtime = {}, cases = []) => evaluateVaultRuntime({}, plugin, runtime, cases, lexicalOracle, scoreInformation, mandatoryGate);
  it('전용 API 없음/null은 getSearchPort나 initRAG로 fallback하지 않는다', async () => {
    const forbidden = () => { throw new Error('synthetic-sensitive-fallback'); };
    expect(await evaluate({ getSearchPort: forbidden, initRAG: forbidden })).toEqual({ status: 'blocked', reason: 'engine-only-snapshot-required' });
    expect(await evaluate({ acquireRagEngineOnlySnapshot: async () => null, getSearchPort: forbidden })).toEqual({ status: 'blocked', reason: 'engine-only-snapshot-unavailable' });
  });
  it('독립 gold 없음/오류에도 원래 active lease를 반드시 해제한다', async () => {
    let releases = 0;
    const plugin = { acquireRagEngineOnlySnapshot: async () => ({ ragEngine: {}, documentCorpus: {}, release: () => releases++ }) };
    expect((await evaluate(plugin)).reason).toBe('independent-gold-required');
    expect(releases).toBe(1);
    const runtime = { createEngineOnlyVaultHost: () => { throw new Error('synthetic-sensitive-provider-error'); } };
    const result = await evaluate(plugin, runtime, [testCase]);
    expect(result.status).toBe('failed');
    expect(releases).toBe(2);
    expect(JSON.stringify(result)).not.toContain('synthetic-sensitive');
  });
  it('CLI bootstrap은 API 미제공 앱에서 고정 집계만 기록한다', async () => {
    const outputs = [];
    runInNewContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), {
      app: { plugins: { plugins: {} } }, require: () => ({ writeFileSync: (_name, value) => outputs.push(JSON.parse(value)) }),
    });
    expect(outputs).toEqual([{ status: 'blocked', reason: 'engine-only-snapshot-required' }, { completed: true }]);
  });
  it('CLI bootstrap의 예외 문자열을 파일/진행으로 복제하지 않는다', async () => {
    const outputs = [];
    runInNewContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), {
      app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot: () => null } } } },
      require: (name) => name === 'node:fs' ? { writeFileSync: (_name, value) => outputs.push(JSON.parse(value)) } : { createRequire: () => { throw new Error('synthetic-sensitive-credential'); } },
    });
    expect(outputs).toEqual([{ status: 'failed', reason: 'quality-vault-blocked' }, { completed: true }]);
  });
});

it('vault CLI VM 성공 경로도 원문·질의·경로·인용 대신 고정 집계만 저장한다', async () => {
  const outputs = [];
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const currentDocuments = qualityFixture.documents.map((doc) => ({ ...doc, revision: '1:1', contentHash: 'synthetic-hash' }));
  const expected = lexicalOracle(currentDocuments, testCase.terms, testCase.hardExcludedPaths);
  let releases = 0;
  const literal = literalProtocolFixture(currentDocuments, testCase.terms, testCase.hardExcludedPaths);
  const runtime = {
    createEngineOnlyVaultHost: () => ({}),
    readOracleDocuments: async () => currentDocuments,
    runProductCase: async (_host, _case, _ledger, _signal, consume) => {
      const value = { source: { discoveryCandidates: expected.rows.map((row) => ({ path: row.path })) }, result: { readLiteralDiscoveryPage: literal.readPage, dossier: {
        literalInventory: literal.inventory,
        evidence: evidence.map((item) => ({ ...item, revision: '1:1', contentHash: 'synthetic-hash' })),
        matchInventory: [{ query: 'quartz', totalDocuments: expected.documents, totalOccurrences: expected.occurrences }],
      } } };
      await consume?.(value); return value;
    },
  };
  runInNewContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), {
    app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot: async () => ({ ragEngine: {}, documentCorpus: {}, release: () => releases++ }) } } } },
    superpowerQualityLoopCases: [testCase], __qualityRuntime: runtime, TextEncoder,
    require: (name) => name === 'node:fs' ? { writeFileSync: (target, value) => { outputs.push(JSON.parse(value)); if (target === 'status') finish(); } }
      : { createRequire: () => () => ({ build: async () => ({ outputFiles: [{ text: 'module.exports=globalThis.__qualityRuntime' }] }) }) },
  });
  await completed;
  expect(outputs[0].status).toBe('passed');
  expect(outputs[0].rows[0]).toMatchObject({ found: 6, aggregationPass: true, current: true });
  expect(outputs[0].ledger.releases).toBe(1);
  expect(releases).toBe(1);
  const serialized = JSON.stringify(outputs);
  for (const info of testCase.information) { expect(serialized).not.toContain(info.text); expect(serialized).not.toContain(info.path); }
  expect(serialized).not.toContain(testCase.question);
  expect(publicReport(outputs[0])).toEqual(outputs[0]);
});

it('실제 제품 runtime의 취소·정책 축소에서도 원문/근거를 게시하지 않고 lease를 해제한다', async () => {
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
    const abort = new AbortController(); abort.abort();
    await runtime.runProductCase(product.host, testCase, ledger, abort.signal).catch(() => null);
    expect(ledger.releases).toBe(1);
    const query = product.host.ragEngine.query.bind(product.host.ragEngine);
    product.host.ragEngine.query = async (...args) => { const result = await query(...args); product.setAllowed([]); return result; };
    await expect(runtime.runProductCase(product.host, testCase, ledger)).rejects.toThrow('quality-policy-changed');
    expect(ledger.releases).toBe(2);
    assertNoAttempts(ledger);
  } finally { product?.close(); restore(); }
});

it('공개 main의 실패는 raw 인자/예외를 stdout·stderr·보고서에 복제하지 않는다', async () => {
  const { main, reportPath } = await import('./quality-loop.mjs');
  let report = 'synthetic-previous-report';
  writeFile.mockImplementationOnce(async (target, value) => {
    expect(String(target).replaceAll('\\', '/').endsWith(reportPath)).toBe(true);
    report = value;
  });
  const writesBefore = writeFile.mock.calls.length;
  const secret = 'synthetic-private-cli-argument';
  const output = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
  const exitCode = process.exitCode;
  try {
    // 필수 CLI가 없어서 실행 전 차단됩니다. 실제 vault/앱은 호출하지 않습니다.
    await main(['--mode=vault', '--vault', secret]);
    expect(process.exitCode).toBe(1);
    expect(writeFile.mock.calls.length).toBe(writesBefore + 1);
    expect(mkdir).toHaveBeenCalled();
    expect(report).toBe('{"status":"failed","reason":"quality-loop-blocked"}\n');
    expect(output.join('')).toBe(report);
    expect(output.join('')).not.toContain(secret);
    expect(report).not.toContain(secret);
  } finally { stdout.mockRestore(); stderr.mockRestore(); process.exitCode = exitCode; }
});

const noAnswerCase = { question: 'independent-absent', terms: ['independent-absent'], information: [], expectNoAnswer: true };
const emptyVaultRuntime = {
  createEngineOnlyVaultHost: () => ({}),
  readOracleDocuments: async () => [],
  runProductCase: async (_host, testCase, _ledger, _signal, consume) => {
    const literal = literalProtocolFixture([], testCase.terms);
    const value = { source: {}, result: { readLiteralDiscoveryPage: literal.readPage, dossier: {
      literalInventory: literal.inventory, evidence: [], matchInventory: [{ query: noAnswerCase.question, totalDocuments: 0, totalOccurrences: 0 }],
    } } };
    await consume?.(value); return value;
  },
};

async function runVaultVm(text, cases = [testCase], runtime = emptyVaultRuntime, absentApis = []) {
  const outputs = [];
  let finish, releases = 0, hostCalls = 0;
  const completed = new Promise((resolve) => { finish = resolve; });
  function sentinel() { hostCalls++; throw new Error('synthetic-host-network-called'); }
  const context = {
    app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot: async () => ({
      ragEngine: {}, documentCorpus: {}, release: () => releases++,
    }) } } } },
    superpowerQualityLoopCases: cases, __qualityRuntime: runtime, TextEncoder,
    fetch: sentinel, XMLHttpRequest: sentinel, WebSocket: sentinel,
    EventSource: sentinel, Worker: sentinel, SharedWorker: sentinel, importScripts: sentinel,
    navigator: { sendBeacon: sentinel },
    require: (name) => {
      if (name === 'node:fs') return { writeFileSync: (target, value) => { outputs.push(JSON.parse(value)); if (target === 'status') finish(); } };
      if (name === 'obsidian') return { requestUrl: sentinel };
      if (name === 'node:module') return { createRequire: () => (dependency) => {
        if (dependency === 'esbuild') return { build: async () => ({ outputFiles: [{ text }] }) };
        throw new Error('synthetic-unexpected-dependency');
      } };
      throw new Error('synthetic-unexpected-require');
    },
  };
  for (const name of absentApis) delete context[name];
  context.window = context; context.self = context; context.global = context;
  createContext(context);
  runInContext(`
    globalThis.__timerCalls = 0;
    for (const name of ['setTimeout','clearTimeout','queueMicrotask']) globalThis[name] = function () {
      if (this !== globalThis) throw new Error('synthetic-timer-brand');
      globalThis.__timerCalls++;
    };
    globalThis.indexedDB = {check() { if (this !== globalThis.indexedDB) throw new Error('synthetic-idb-brand'); return true; }};
    let globalReceiver;
    Object.defineProperty(globalThis, '__hostBrand', {get() { if (globalReceiver && this !== globalReceiver) throw new Error('synthetic-global-brand'); globalReceiver = this; return true; }});
    globalThis.__hostBrand;
    navigator.check = function () { if (this !== navigator) throw new Error('synthetic-navigator-brand'); return true; };
  `, context);
  runInContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), context);
  await completed;
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts']) expect(context[key]).toBe(absentApis.includes(key) ? undefined : sentinel);
  expect(context.navigator.sendBeacon).toBe(sentinel);
  expect(context.window).toBe(context);
  return { outputs, releases, hostCalls, timerCalls: context.__timerCalls };
}

const networkExpressions = ['fetch()', 'new XMLHttpRequest()', 'new WebSocket()', 'new EventSource()', 'new Worker()', 'new SharedWorker()', 'importScripts()', 'navigator.sendBeacon()'];
const networkAliases = ['', 'globalThis.', 'window.', 'self.', 'global.', 'this.', 'globalThis.window.self.global.'];
const networkProbes = networkAliases.flatMap((alias) => networkExpressions.map((expression) => expression.startsWith('new ') ? `new ${alias}${expression.slice(4)}` : alias + expression));

describe('흡수된 네트워크 시도도 호출 전 차단·원장 실패', () => {
  it.each(networkProbes.filter((expression) => /fetch|XMLHttpRequest|WebSocket/.test(expression)))('synthetic VM: %s', async (expression) => {
    const ledger = attemptLedger();
    build.mockResolvedValueOnce({ outputFiles: [{ text: `try { ${expression} } catch {} module.exports = {};` }] });
    const { restore } = await loadProductRuntime(ledger);
    restore();
    expect(ledger.network).toBe(1);
    expect(() => assertNoAttempts(ledger)).toThrow('quality-attempt-blocked');
  });
  it('synthetic에 없는 API를 만들지 않아 제품의 기능 탐지를 보존한다', async () => {
    const ledger = attemptLedger();
    build.mockResolvedValueOnce({ outputFiles: [{ text: 'module.exports = [typeof Worker, typeof SharedWorker, typeof EventSource, typeof importScripts];' }] });
    const { runtime, restore } = await loadProductRuntime(ledger);
    restore();
    expect(Array.from(runtime)).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
    assertNoAttempts(ledger);
  });
  it('synthetic bundled obsidian.requestUrl도 예외 흡수 후 원장을 남긴다', async () => {
    const ledger = attemptLedger();
    build.mockImplementationOnce(async (options) => {
      const actual = await vi.importActual('esbuild');
      return actual.build({ ...options, entryPoints: [], stdin: { contents: "import {requestUrl} from 'obsidian'; try { requestUrl({url:'synthetic-never-sent'}) } catch {}", resolveDir: process.cwd() } });
    });
    const { restore } = await loadProductRuntime(ledger);
    restore();
    expect(ledger.network).toBe(1);
    expect(() => assertNoAttempts(ledger)).toThrow('quality-attempt-blocked');
  });
  it.each([...networkProbes, "require('obsidian').requestUrl()", "require('node:https')"] )('vault lexical VM: %s', async (expression) => {
    const { outputs, releases, hostCalls } = await runVaultVm(`try { ${expression} } catch {} module.exports = globalThis.__qualityRuntime;`);
    expect(hostCalls).toBe(0);
    expect(outputs[0]).toMatchObject({ status: 'failed', reason: 'quality-attempt-blocked', ledger: { network: 1, releases: 1 } });
    expect(releases).toBe(1);
    expect(publicReport(outputs[0])).toEqual(outputs[0]);
  });
  it('vault host에 없는 API도 없는 채로 유지한다', async () => {
    const absentApis = ['Worker', 'SharedWorker', 'EventSource', 'importScripts'];
    const text = `if ([typeof Worker, typeof globalThis.SharedWorker, typeof window.EventSource, typeof self.importScripts].some(value => value !== 'undefined')) throw new Error('synthetic-api-availability'); module.exports=globalThis.__qualityRuntime;`;
    const { outputs, hostCalls } = await runVaultVm(text, [noAnswerCase], emptyVaultRuntime, absentApis);
    expect(outputs[0].status).toBe('passed');
    expect(hostCalls).toBe(0);
  });
  it('vault lexical facade는 host timer·IDB receiver·constructor/static을 보존한다', async () => {
    const text = `
      if (!(new globalThis.Uint8Array(1) instanceof Uint8Array) || globalThis.Uint8Array.from([1])[0] !== 1) throw new Error('constructor');
      globalThis.setTimeout(() => {}, 0); window.clearTimeout(1); self.queueMicrotask(() => {});
      if (!globalThis.indexedDB.check() || !globalThis.__hostBrand || !globalThis.navigator.check()) throw new Error('brand');
      module.exports = globalThis.__qualityRuntime;`;
    const { outputs, hostCalls, releases, timerCalls } = await runVaultVm(text, [noAnswerCase]);
    expect(timerCalls).toBe(3);
    expect(outputs[0].status).toBe('passed');
    expect(hostCalls).toBe(0);
    expect(releases).toBe(1);
  });
});

describe('vault 독립 no-answer와 gold shape', () => {
  it('명시 no-answer-only + 빈 gold는 독립 사례로 통과하고 lease를 해제한다', async () => {
    const { outputs, releases } = await runVaultVm('module.exports=globalThis.__qualityRuntime', [noAnswerCase]);
    expect(outputs[0]).toMatchObject({ status: 'passed', rows: [{ required: 0, noAnswerPass: true, passed: true }], ledger: { releases: 1 } });
    expect(releases).toBe(1);
  });
  it.each([null, {}, { ...noAnswerCase, expectNoAnswer: false }, { ...noAnswerCase, expectNoAnswer: 'true' },
    { ...noAnswerCase, information: null }, { ...noAnswerCase, information: undefined },
    { ...noAnswerCase, information: [null] }, { ...noAnswerCase, information: [{}] },
    { ...noAnswerCase, terms: null }, { ...noAnswerCase, question: null },
    { ...testCase, information: [{ ...testCase.information[0], line: 0 }] },
  ])('잘못된 gold/사례 shape는 blocked: %#', async (invalid) => {
    const { outputs, releases } = await runVaultVm('module.exports=globalThis.__qualityRuntime', [invalid]);
    expect(outputs[0]).toEqual({ status: 'blocked', reason: 'independent-gold-required' });
    expect(releases).toBe(1);
  });
  it('no-answer 예상에 실제 근거가 있으면 mandatory 실패하며 lease를 해제한다', async () => {
    const runtime = { ...emptyVaultRuntime,
      readOracleDocuments: async () => [{ path: 'independent', text: 'unrelated', revision: '1', contentHash: 'hash' }],
      runProductCase: async (...args) => {
        const result = await emptyVaultRuntime.runProductCase(...args);
        result.result.dossier.evidence = [{ path: 'independent', quote: 'unrelated', startLine: 1, endLine: 1, revision: '1', contentHash: 'hash' }];
        return result;
      },
    };
    const { outputs, releases } = await runVaultVm('module.exports=globalThis.__qualityRuntime', [noAnswerCase], runtime);
    expect(outputs[0]).toMatchObject({ status: 'failed', rows: [{ noAnswerPass: false, passed: false }] });
    expect(releases).toBe(1);
  });
  it('취소 오류·provider guard도 원래 lease를 해제한다', async () => {
    let releases = 0;
    const lease = { ragEngine: { embeddingProvider: {} }, documentCorpus: {}, release: () => releases++ };
    const plugin = { acquireRagEngineOnlySnapshot: async () => lease };
    const evaluate = (runtime) => evaluateVaultRuntime({}, plugin, runtime, [noAnswerCase], lexicalOracle, scoreInformation, mandatoryGate);
    expect((await evaluate(emptyVaultRuntime)).reason).toBe('engine-only-snapshot-unavailable');
    lease.ragEngine = {};
    const cancelled = { ...emptyVaultRuntime, runProductCase: async () => { throw new DOMException('synthetic-cancel', 'AbortError'); } };
    expect((await evaluate(cancelled)).status).toBe('failed');
    expect(releases).toBe(2);
  });
});
