import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { parseVaultArgs, validateVaultResult, buildQualityVaultCode, runVaultQuality } from './quality-vault.mjs';
import { literalProtocolFixture } from './quality-test-runtime.mjs';
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), mkdtemp: vi.fn(), readFile: vi.fn(), rm: vi.fn(), writeFile: vi.fn() }));

const args = ['--mode=vault', '--vault', 'synthetic', '--obsidian-cli', path.resolve('Obsidian.com')];
it.each([
  args.slice(0, -1),
  [...args, '--other'],
  [...args, '--vault', 'duplicate'],
  args.map((v) => (v === 'synthetic' ? '--missing' : v)),
  args.map((v) => (v === 'synthetic' ? ' ' : v)),
  [...args.slice(0, -1), 'relative-cli'],
  [...args.slice(0, -1), path.resolve('unrelated.exe')],
])('rejects ambiguous host arguments %#', (...values) => {
  expect(() => parseVaultArgs(values)).toThrow();
});
it('accepts one explicit host and CLI', () =>
  expect(parseVaultArgs(args)).toEqual({ vault: 'synthetic', cli: args.at(-1) }));
it.each([
  {},
  { status: 'passed' },
  { status: 'passed', scope: 'synthetic-product-runtime' },
  { status: 'passed', rows: [{ passed: true }], ledger: { network: 0 } },
])('rejects incomplete completion %#', (value) => {
  expect(() => validateVaultResult(value, 1)).toThrow();
});
function completedReport(noAnswer = false) {
  const found = noAnswer ? 0 : 1;
  return {
    schemaVersion: 1, status: 'passed', scope: 'vault-product-runtime', semantic: 'unverified-no-prepared-vectors',
    ledger: { releases: 1, provider: 0, embedding: 0, network: 0 },
    rows: [{
      required: found, found, missing: 0, noAnswerPass: noAnswer ? true : null, uniqueUsefulRecall: noAnswer ? null : 1,
      passed: true, current: true, aggregationPass: true, firstLoss: 'none', cappedRecall: null,
      citationFailures: 0, hardLeakage: 0, discoveryMissing: 0,
      duplication: 0, noise: 0, deliveredBytes: found * 3, density: found / 3, dossierBytes: 200,
      oracleDocuments: found, oraclePassages: found, oracleOccurrences: found,
      baseline: { found, missing: 0, passed: true, deliveredBytes: found * 6, duplication: 0, noise: 0, density: found / 6 },
      densityImproved: noAnswer ? null : true,
    }],
  };
}
it.each([false, true])('accepts consistent gold and no-answer completions (noAnswer=%s)', (noAnswer) => {
  const report = completedReport(noAnswer);
  expect(validateVaultResult(report, 1)).toEqual(report);
});
it.each(['product', 'baseline'])('checks %s delivery arithmetic independently', (side) => {
  for (const [noAnswer, change] of [
    [true, { deliveredBytes: 1 }], [true, { noise: 1 }], [true, { duplication: 1 }],
    [false, { density: side === 'product' ? 1 : 0.01 }], [false, { deliveredBytes: 0, density: 0 }],
  ]) {
    const report = completedReport(noAnswer);
    const row = report.rows[0];
    Object.assign(side === 'product' ? row : row.baseline, change);
    row.densityImproved = noAnswer ? null : row.density > row.baseline.density;
    expect(() => validateVaultResult(report, 1)).toThrow('quality-vault-blocked');
  }
});
it.each([{ oracleDocuments: 0 }, { oraclePassages: 0 }, { oracleOccurrences: 0 }, { dossierBytes: 1 }])(
  'rejects impossible aggregate sizes %#', (change) => {
    const report = completedReport();
    Object.assign(report.rows[0], change);
    expect(() => validateVaultResult(report, 1)).toThrow('quality-vault-blocked');
  },
);
function noAnswerWithOracleMatches() {
  const report = completedReport(true);
  Object.assign(report.rows[0], { oracleDocuments: 1, oraclePassages: 2, oracleOccurrences: 3 });
  Object.assign(report.rows[0].baseline, { passed: false, deliveredBytes: 2, noise: 2 });
  return report;
}
it('allows empty product delivery with exactly one noise item and at least one byte per oracle passage', () => {
  const report = noAnswerWithOracleMatches();
  expect(validateVaultResult(report, 1)).toEqual(report);
});
it.each([
  [true, { noise: 0 }], [true, { noise: 3 }],
  [true, { passed: true, deliveredBytes: 0, noise: 0 }],
  [true, { deliveredBytes: 0 }], [true, { deliveredBytes: 1 }],
  [false, { passed: false }], [false, { passed: false, deliveredBytes: 1 }],
  [false, { passed: false, noise: 1 }],
])('rejects inconsistent no-answer baseline with oracle matches=%s: %j', (matches, change) => {
  const report = matches ? noAnswerWithOracleMatches() : completedReport(true);
  Object.assign(report.rows[0].baseline, change);
  expect(() => validateVaultResult(report, 1)).toThrow('quality-vault-blocked');
});
it('checks the actual vault before touching the plugin', () => {
  const plugins = vi.fn(() => ({}));
  const writes = [];
  runInNewContext(
    buildQualityVaultCode({ root: 'synthetic', outputPath: 'report', statusPath: 'status', vault: 'expected' }),
    {
      app: {
        vault: { getName: () => 'different' },
        get plugins() {
          return plugins();
        },
      },
      require: () => ({ writeFileSync: (_, v) => writes.push(JSON.parse(v)), renameSync() {} }),
    },
  );
  expect(plugins).not.toHaveBeenCalled();
  expect(writes[0].status).not.toBe('passed');
});

// Exercise the injected preflight and publication, not just the Node evaluator.
async function goldVm({ at, change, restoreOnRelease = false } = {}) {
  const term = 'synthetic-needle';
  const source = { path: 'synthetic-private.md', text: term, revision: '1', contentHash: 'synthetic-hash' };
  const item = { question: 'synthetic-private-question', terms: [term], hardExcludedPaths: ['synthetic-private-exclusion'],
    information: [{ id: 'synthetic-private-id', kind: 'fact', path: source.path, text: term, line: 1 }] };
  const original = [item];
  const writes = [];
  let done, evaluated;
  const completed = new Promise(resolve => { done = resolve; });
  const checkpoint = async (phase) => {
    if (phase !== at) return;
    await Promise.resolve();
    change(context, item);
  };
  const release = vi.fn(() => {
    if (restoreOnRelease) item.information[0].text = term;
    if (at === 'release') change(context, item);
  });
  const acquireRagEngineOnlySnapshot = vi.fn(async () => {
    await checkpoint('lease');
    return { ragEngine: {}, documentCorpus: {}, release };
  });
  const read = vi.fn(() => [source]);
  const literal = literalProtocolFixture([source], item.terms, item.hardExcludedPaths);
  const runProductCase = vi.fn(async (_host, testCase, _ledger, _signal, consume) => {
    evaluated = testCase;
    await checkpoint('evaluation');
    const result = { source: {}, result: { readLiteralDiscoveryPage: literal.readPage, dossier: {
      literalInventory: literal.inventory, evidence: [{ ...source, startLine: 1, endLine: 1, quote: source.text }],
    } } };
    await consume(result);
    return result;
  });
  const bundleInit = vi.fn(() => { if (at === 'bundle') change(context, item); });
  const createHost = vi.fn(() => { if (at === 'host') change(context, item); return {}; });
  const readOracleDocuments = vi.fn(async (_host, _lease, assertGoldCurrent) => {
    await checkpoint('source-scope');
    assertGoldCurrent?.();
    return read();
  });
  const context = {
    app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot } } } },
    TextEncoder, superpowerQualityLoopCases: original,
    __bundleInit: bundleInit,
    __qualityRuntime: { createEngineOnlyVaultHost: createHost, readOracleDocuments, runProductCase },
    require: (name) => name === 'node:fs' ? {
      writeFileSync: (target, value) => writes.push([target, value]),
      renameSync: () => done(),
    } : { createRequire: () => () => ({ build: async () => {
      await checkpoint('build');
      return { outputFiles: [{ text: 'globalThis.__bundleInit(); module.exports=globalThis.__qualityRuntime;' }] };
    } }) },
  };
  const code = buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status', atomicStatus: true });
  expect(runInNewContext(code, context)).toBe(1);
  await completed;
  for (const sensitive of [term, source.path, item.question, item.hardExcludedPaths[0], item.information[0].id, 'synthetic-new-gold']) {
    expect(code).not.toContain(sensitive);
    expect(JSON.stringify(writes)).not.toContain(sensitive);
  }
  expect(writes.map(([name]) => name)).toEqual(['report', 'status.pending']);
  expect(JSON.parse(writes[1][1])).toEqual({ completed: true, cases: 1 });
  return { report: JSON.parse(writes[0][1]), original, evaluated, bundleInit, acquireRagEngineOnlySnapshot, release, createHost, readOracleDocuments, read, runProductCase };
}

it('evaluates only the deep-frozen preflight copy without freezing or publishing live gold', async () => {
  const { report, original, evaluated, release } = await goldVm();
  expect(validateVaultResult(report, 1).status).toBe('passed');
  expect(evaluated).not.toBe(original[0]);
  expect(evaluated.information[0]).not.toBe(original[0].information[0]);
  for (const value of [evaluated, evaluated.terms, evaluated.hardExcludedPaths, evaluated.information, evaluated.information[0]]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(Object.isFrozen(original[0])).toBe(false);
  expect(Object.isFrozen(original[0].information[0])).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});

const replaceGold = context => { context.superpowerQualityLoopCases = [...context.superpowerQualityLoopCases]; };
const changeText = (_context, item) => { item.information[0].text = 'synthetic-new-gold'; };
it.each([
  ['build', replaceGold, 0, 0],
  ['build', (_context, item) => { item.terms[0] = 'synthetic-new-gold'; }, 0, 0],
  ['bundle', changeText, 0, 0],
  ['lease', replaceGold, 1, 0],
  ['lease', changeText, 1, 0],
  ['host', (_context, item) => { item.hardExcludedPaths.push('synthetic-new-gold'); }, 1, 0],
  ['source-scope', changeText, 1, 0],
  ['evaluation', changeText, 1, 1, true],
  ['release', replaceGold, 1, 1],
])('blocks a changed gold at %s, case %#, and releases only if acquired', async (at, change, leases, reads, restoreOnRelease) => {
  const { report, bundleInit, acquireRagEngineOnlySnapshot, release, createHost, readOracleDocuments, read, runProductCase } = await goldVm({ at, change, restoreOnRelease });
  expect(report).toEqual({ status: 'blocked', reason: 'independent-gold-required' });
  expect(bundleInit).toHaveBeenCalledTimes(at === 'build' ? 0 : 1);
  expect(acquireRagEngineOnlySnapshot).toHaveBeenCalledTimes(leases);
  expect(release).toHaveBeenCalledTimes(leases);
  expect(createHost).toHaveBeenCalledTimes(at === 'lease' ? 0 : leases);
  expect(readOracleDocuments).toHaveBeenCalledTimes(at === 'source-scope' ? 1 : reads);
  expect(read).toHaveBeenCalledTimes(reads);
  expect(runProductCase).toHaveBeenCalledTimes(reads);
});

it('the bundled oracle reader checks gold after asynchronous source enumeration', async () => {
  const { attemptLedger, loadProductRuntime } = await import('./quality-loop.mjs');
  const { runtime } = await loadProductRuntime(attemptLedger());
  const getAbstractFileByPath = vi.fn();
  const host = { app: { vault: { getAbstractFileByPath } }, getCandidatePaths: async () => ['synthetic.md'] };
  let current = true;
  const lease = { documentCorpus: { getIndexedFilePaths: async () => {
    await Promise.resolve();
    current = false;
    return ['synthetic.md'];
  } } };
  await expect(runtime.readOracleDocuments(host, lease, () => {
    if (!current) throw new Error('independent-gold-required');
  })).rejects.toThrow('independent-gold-required');
  expect(getAbstractFileByPath).not.toHaveBeenCalled();
});

// No executable, app or filesystem. Even a timed-out CLI can finish evaluating later.
const cliArgLimit = 4096;
function runner({ vault = args[2], hostVault = vault, immediate = false, pathSuffix = '', transformScript = (bytes) => bytes, plugin } = {}) {
  vi.resetAllMocks();
  const files = new Map(),
    live = new Set(),
    launches = [],
    plugins = vi.fn(() => ({ plugins: { 'superpower-inside': plugin } })),
    createRequire = vi.fn(() => { throw new Error('synthetic-bundle-unavailable'); });
  mkdir.mockResolvedValue(undefined);
  mkdtemp.mockImplementation(async (prefix) => {
    const dir = prefix + mkdtemp.mock.calls.length + pathSuffix;
    live.add(dir);
    return dir;
  });
  readFile.mockImplementation(async (name) => {
    if (!files.has(name)) throw Object.assign(new Error('not-published'), { code: 'ENOENT' });
    return files.get(name);
  });
  rm.mockImplementation(async (dir) => {
    live.delete(dir);
    for (const name of files.keys()) if (path.dirname(name) === dir) files.delete(name);
  });
  writeFile.mockImplementation(async (name, data, options) => {
    expect(options).toEqual({ encoding: 'utf8', flag: 'wx', mode: 0o600 });
    expect(files.has(name)).toBe(false);
    fs.writeFileSync(name, data);
  });
  const fs = {
    readFileSync(name) {
      if (!files.has(name)) throw new Error('not-staged');
      return transformScript(Buffer.from(files.get(name), 'utf8'));
    },
    writeFileSync(name, data) {
      if (!live.has(path.dirname(name))) throw new Error('removed');
      files.set(name, data);
    },
    renameSync(from, to) {
      this.writeFileSync(to, files.get(from));
      files.delete(from);
    },
  };
  execFileSync.mockImplementation((cmd, argv, options) => {
    if (cmd === 'git') return;
    expect(cmd).toBe(args.at(-1));
    expect(argv).toHaveLength(3);
    expect(argv.slice(0, 2)).toEqual([`vault=${vault}`, 'eval']);
    expect(argv[2]).toMatch(/^code=/);
    expect(options.shell).toBeFalsy();
    // Obsidian.com drops oversized arguments before they reach eval, even on a zero exit.
    if (argv.some((arg) => Buffer.byteLength(arg, 'utf8') > cliArgLimit)) return 'Error: missing eval argument';
    const launch = () => runInNewContext(argv[2].slice(5), {
      app: { vault: { getName: () => hostVault }, get plugins() { return plugins(); } },
      require(name) {
        if (name === 'node:fs') return fs;
        if (name === 'node:buffer') return { Buffer };
        if (name === 'node:crypto') return { createHash };
        if (name === 'node:module') return { createRequire };
        throw new Error('unexpected import');
      },
    });
    launches.push(launch);
    return immediate ? `=> ${launch()}` : '=> 1';
  });
  return { launches, live, files, plugins, createRequire };
}
it('launches only a short loader and stages trusted code without vault data', async () => {
  const vault = `금고 ');throw Error(); // \\ quoted "vault"`;
  const { live, files, plugins } = runner({ vault, pathSuffix: `-');throw Error();`, immediate: true });
  await expect(runVaultQuality(args.map((v) => v === args[2] ? vault : v))).resolves.toEqual({
    status: 'blocked', reason: 'engine-only-snapshot-required',
  });
  expect(plugins).toHaveBeenCalledOnce();
  expect(writeFile).toHaveBeenCalledOnce();
  const [scriptPath, source] = writeFile.mock.calls[0];
  const loaderArg = execFileSync.mock.lastCall[1][2];
  expect(Buffer.byteLength(source, 'utf8')).toBeGreaterThan(cliArgLimit);
  expect(Buffer.byteLength(loaderArg, 'utf8')).toBeLessThanOrEqual(cliArgLimit);
  expect(loaderArg).not.toMatch(/[\r\n]/);
  expect(source).not.toContain(vault);
  expect(source).not.toContain(JSON.stringify(vault));
  expect(loaderArg).not.toContain(scriptPath);
  expect(live.size).toBe(0);
  expect(files.size).toBe(0);
});
it('publishes the independent-gold block when the app has no gold, before bundle or lease', async () => {
  const acquireRagEngineOnlySnapshot = vi.fn(() => { throw new Error('synthetic-lease-unavailable'); });
  const { live, files, plugins, createRequire } = runner({ immediate: true, plugin: { acquireRagEngineOnlySnapshot } });
  await expect(runVaultQuality(args)).resolves.toEqual({ status: 'blocked', reason: 'independent-gold-required' });
  expect(plugins).toHaveBeenCalledOnce();
  expect(createRequire).not.toHaveBeenCalled();
  expect(acquireRagEngineOnlySnapshot).not.toHaveBeenCalled();
  expect(live.size).toBe(0);
  expect(files.size).toBe(0);
});
it('refuses a UTF-8 selector that would exceed the CLI argument limit', async () => {
  const vault = '한'.repeat(1365);
  const { live, launches } = runner({ vault });
  await expect(runVaultQuality(args.map((v) => v === args[2] ? vault : v))).rejects.toThrow('quality-vault-blocked');
  expect(execFileSync.mock.calls.some(([cmd]) => cmd === args.at(-1))).toBe(false);
  expect(writeFile).not.toHaveBeenCalled();
  expect(live.size).toBe(0);
  expect(launches).toHaveLength(0);
});
it.each([
  { transformScript: () => Buffer.from('(() => { app.plugins; return 1; })()') },
  { hostVault: 'different' },
])('does not execute staged code when content or host verification fails %#', async (options) => {
  const { live, files, plugins } = runner({ ...options, immediate: true });
  await expect(runVaultQuality(args)).rejects.toThrow('quality-vault-blocked');
  expect(plugins).not.toHaveBeenCalled();
  expect(live.size).toBe(0);
  expect(files.size).toBe(0);
});
it('concurrent runs and a late VM completion never complete another waiter; remove only the run-owned directory', async () => {
  vi.useFakeTimers();
  try {
    const { launches, live, files, plugins } = runner();
    const stale = expect(runVaultQuality(args)).rejects.toThrow('quality-vault-timeout');
    await vi.advanceTimersByTimeAsync(180000);
    await stale;
    const left = runVaultQuality(args),
      right = runVaultQuality(args);
    await vi.advanceTimersByTimeAsync(0);
    expect(live.size).toBe(2);
    expect(launches[0]()).toBe(0);
    expect(plugins).not.toHaveBeenCalled();
    expect(files.size).toBe(2); // only the two active scripts remain
    expect(launches[2]()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(await right).toEqual({ status: 'blocked', reason: 'engine-only-snapshot-required' });
    expect(live.size).toBe(1);
    expect(files.size).toBe(1);
    launches[1]();
    await vi.advanceTimersByTimeAsync(500);
    expect((await left).status).toBe('blocked');
    expect(live.size).toBe(0);
    expect(files.size).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it('cleans up the staged script when the CLI itself times out', async () => {
  const { live, files } = runner();
  execFileSync.mockImplementationOnce(() => '').mockImplementationOnce(() => {
    expect(files.size).toBe(1);
    throw Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' });
  });
  await expect(runVaultQuality(args)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  expect(live.size).toBe(0);
  expect(files.size).toBe(0);
});
it('does not accept a zero-exit diagnostic instead of the CLI launch acknowledgement', async () => {
  const { live } = runner();
  execFileSync.mockReturnValueOnce('').mockReturnValueOnce('Error: synthetic');
  await expect(runVaultQuality(args)).rejects.toThrow('quality-vault-blocked');
  expect(live.size).toBe(0);
});
it.each(['{', '{"completed":false}', '{"completed":true,"cases":1}'])(
  'rejects a torn marker or report %#',
  async (marker) => {
    const { live } = runner();
    readFile.mockResolvedValueOnce(marker).mockResolvedValueOnce('{"status":"passed"}');
    await expect(runVaultQuality(args)).rejects.toThrow();
    expect(live.size).toBe(0);
  },
);
