// 실행은 부모 소유입니다. 이 파일의 개발 검증은 합성 VM으로만 수행합니다.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexicalOracle, scoreInformation, mandatoryGate, auditLiteralInventory } from './quality-oracle.mjs';
import { publicReport } from './quality-report.mjs';
import { createQualityWorkerBindings } from './quality-worker-guard.mjs';

// app 메모리의 독립 gold만 받습니다. 원문·질의·경로를 CLI/파일에 운반하지 않습니다.
function hasIndependentGold(cases) {
  return Array.isArray(cases) && cases.length > 0 && !Array.from(cases).some((item) =>
    !item || typeof item.question !== 'string' || !item.question.trim() ||
    !Array.isArray(item.terms) || !item.terms.length || Array.from(item.terms).some((term) => typeof term !== 'string' || !term.trim()) ||
    (item.expectNoAnswer !== undefined && typeof item.expectNoAnswer !== 'boolean') ||
    (item.hardExcludedPaths !== undefined && (!Array.isArray(item.hardExcludedPaths) || Array.from(item.hardExcludedPaths).some((entry) => typeof entry !== 'string' || !entry.trim()))) ||
    !Array.isArray(item.information) || (!item.information.length && item.expectNoAnswer !== true) ||
    Array.from(item.information).some((info) => !info || ['id', 'kind', 'path', 'text'].some((key) => typeof info[key] !== 'string' || !info[key].trim()) || !Number.isSafeInteger(info.line) || info.line < 1) ||
    new Set(item.information.map((info) => info.id)).size !== item.information.length
  );
}

function captureIndependentGold(readCases) {
  const copyList = (value, copy) => Array.isArray(value) ? Array.from(value, copy) : value;
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  const matches = (live, pinned) => {
    if (Array.isArray(pinned)) return Array.isArray(live) && live.length === pinned.length && pinned.every((entry, index) => matches(live[index], entry));
    if (pinned && typeof pinned === 'object') return live != null && Object.keys(pinned).every(key => matches(live[key], pinned[key]));
    return live === pinned;
  };
  try {
    const original = readCases();
    // Copy only the evaluation schema, never hold the app's mutable objects in the snapshot.
    const cases = copyList(original, item => ({
      question: item?.question,
      terms: copyList(item?.terms),
      hardExcludedPaths: copyList(item?.hardExcludedPaths),
      expectNoAnswer: item?.expectNoAnswer,
      information: copyList(item?.information, info => ({ id: info?.id, kind: info?.kind, path: info?.path, text: info?.text, line: info?.line })),
    }));
    if (!hasIndependentGold(cases)) return null;
    freeze(cases);
    // A later restoration (e.g. during lease release) cannot clear an observed mismatch.
    let current = true;
    return {
      cases,
      isCurrent() {
        if (current) {
          try { current = readCases() === original && matches(original, cases) && readCases() === original; }
          catch { current = false; }
        }
        return current;
      },
    };
  } catch { return null; }
}

export async function evaluateVaultRuntime(app, plugin, runtime, cases, oracle, score, gate, ledger = { provider: 0, embedding: 0, network: 0, releases: 0 }, audit = auditLiteralInventory) {
  return evaluatePinnedVaultRuntime(app, plugin, runtime, captureIndependentGold(() => cases), oracle, score, gate, ledger, audit);
}

async function evaluatePinnedVaultRuntime(app, plugin, runtime, gold, oracle, score, gate, ledger, audit) {
  const acquire = plugin?.acquireRagEngineOnlySnapshot;
  if (typeof acquire !== 'function') return { status: 'blocked', reason: 'engine-only-snapshot-required' };
  const goldBlocked = { status: 'blocked', reason: 'independent-gold-required' };
  const assertGoldCurrent = () => { if (!gold?.isCurrent()) throw new Error('independent-gold-required'); };
  let lease;
  try {
    assertGoldCurrent();
    lease = await acquire.call(plugin);
    assertGoldCurrent();
    if (!lease?.ragEngine || !lease?.documentCorpus || typeof lease.release !== 'function') return { status: 'blocked', reason: 'engine-only-snapshot-unavailable' };
    // MAIN의 lexical-only 계약 위반은 실제 provider를 호출하기 전에 실패 폐쇄합니다.
    if (lease.ragEngine.embeddingProvider || lease.ragEngine.vectorStore) return { status: 'blocked', reason: 'engine-only-snapshot-unavailable' };
    const host = runtime.createEngineOnlyVaultHost(app, plugin, lease);
    assertGoldCurrent();
    const documents = await runtime.readOracleDocuments(host, lease, assertGoldCurrent);
    const documentsByPath = new Map(documents.map(doc => [doc.path, doc]));
    const rows = [];
    for (const testCase of gold.cases) {
      assertGoldCurrent();
      const expected = oracle(documents, testCase.terms, testCase.hardExcludedPaths);
      let literalAudit;
      const { result } = await runtime.runProductCase(host, testCase, ledger, undefined, async ({ source, result }) => {
        literalAudit = await audit(testCase, result.dossier.literalInventory, result.readLiteralDiscoveryPage, documents, (source.discoveryCandidates ?? source.candidates ?? []).map((item) => item.path), oracle, expected);
      });
      const row = score(testCase, result.dossier.evidence, documents);
      const baseline = score(testCase, expected.rows.flatMap(({ path, passages }) => {
        const lines = documentsByPath.get(path).text.split('\n');
        return passages.map(line => ({ path, startLine: line, endLine: line, quote: lines[line - 1] }));
      }), documents);
      const discoveryMissing = literalAudit?.discoveryMissing ?? expected.documents;
      const aggregationPass = literalAudit?.passed === true;
      const current = result.dossier.evidence.every((item) => {
        const document = documentsByPath.get(item.path);
        return document && typeof document.revision === 'string' && !!document.revision && typeof document.contentHash === 'string' && !!document.contentHash && item.revision === document.revision && item.contentHash === document.contentHash;
      });
      rows.push({ ...row, dossierBytes: new TextEncoder().encode(JSON.stringify(result.dossier)).length,
        baseline: { found: baseline.found, missing: baseline.missing, passed: baseline.passed, duplication: baseline.duplication, noise: baseline.noise, deliveredBytes: baseline.deliveredBytes, density: baseline.density },
        densityImproved: row.passed && baseline.passed && row.required > 0 ? row.density > baseline.density : null,
        cappedRecall: null,
        discoveryMissing, aggregationPass, current, firstLoss: discoveryMissing > 0 ? 'discovery' : row.passed && current && aggregationPass ? 'none' : 'unknown',
        oracleDocuments: expected.documents, oraclePassages: expected.passages, oracleOccurrences: expected.occurrences,
        passed: row.passed && !discoveryMissing && aggregationPass && current });
    }
    const report = ['provider', 'embedding', 'network'].every(key => ledger[key] === 0)
      ? { schemaVersion: 1, status: gate(rows) ? 'passed' : 'failed', scope: 'vault-product-runtime', semantic: 'unverified-no-prepared-vectors', rows, ledger }
      : { status: 'failed', reason: 'quality-attempt-blocked', ledger };
    assertGoldCurrent();
    return report;
  } catch {
    return gold?.isCurrent() ? { status: 'failed', reason: 'quality-vault-blocked', ledger } : goldBlocked;
  } finally {
    if (typeof lease?.release === 'function') { lease.release(); ledger.releases++; }
  }
}

export function buildQualityVaultCode({ root, outputPath, statusPath, vault, atomicStatus = vault !== undefined }) {
  return `(() => { void (async () => {
    const fs = require('node:fs');
    const publicReport = (${publicReport.toString()});
    const goldBlocked = {status:'blocked',reason:'independent-gold-required'};
    let gold, caseCount = 0;
    const emit = (value) => {
      let report = JSON.stringify(publicReport(value));
      if (gold && !gold.isCurrent()) report = JSON.stringify(publicReport(goldBlocked));
      fs.writeFileSync(${JSON.stringify(outputPath)}, report);
      ${!atomicStatus ? `fs.writeFileSync(${JSON.stringify(statusPath)}, '{"completed":true}');` : `
      fs.writeFileSync(${JSON.stringify(statusPath + '.pending')}, JSON.stringify({completed:true, cases:caseCount}));
      fs.renameSync(${JSON.stringify(statusPath + '.pending')}, ${JSON.stringify(statusPath)});`}
    };
    try {
      ${vault === undefined ? '' : `if (app.vault?.getName?.() !== ${JSON.stringify(vault)}) throw new Error('quality-host-mismatch');`}
      const plugin = app.plugins.plugins['superpower-inside'];
      if (typeof plugin?.acquireRagEngineOnlySnapshot !== 'function') { emit({status:'blocked',reason:'engine-only-snapshot-required'}); return; }
      const hasIndependentGold = (${hasIndependentGold.toString()});
      const captureIndependentGold = (${captureIndependentGold.toString()});
      gold = captureIndependentGold(() => globalThis.superpowerQualityLoopCases);
      if (!gold?.isCurrent()) { emit(goldBlocked); return; }
      caseCount = gold.cases.length;
      const localRequire = require('node:module').createRequire(${JSON.stringify(path.join(root, 'package.json'))});
      const esbuild = localRequire('esbuild');
      const built = await esbuild.build({entryPoints:[${JSON.stringify(path.join(root, 'scripts/search-eval/product-runtime.mjs'))}],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',packages:'external',logLevel:'silent'});
      if (!gold.isCurrent()) { emit(goldBlocked); return; }
      const module = {exports:{}};
      const ledger = {provider:0,embedding:0,network:0,releases:0};
      function blocked() { ledger.network++; throw new Error('quality-network-blocked'); }
      const productRequire = (name) => {
        if (name === 'obsidian') return {...require('obsidian'), requestUrl: blocked};
        if (name === 'dexie' || name === 'fflate') return localRequire(name);
        return blocked();
      };
      // 신뢰한 제품 번들의 lexical 경계입니다. 임의 JS sandbox가 아니며 MAIN lexical-only lease가 필수입니다.
      // 앱 전역은 수정하지 않고, host getter/IDB/constructor는 원래 receiver와 정체성을 유지합니다.
      const host = globalThis;
      const hostNavigator = host.navigator;
      const navigator = new Proxy(Object.create(null), {get: (_target, key) => {
        if (key === 'sendBeacon') return blocked;
        const value = hostNavigator && Reflect.get(hostNavigator, key, hostNavigator);
        return typeof value === 'function' ? value.bind(hostNavigator) : value;
      }});
      const bindings = {fetch:blocked, XMLHttpRequest:blocked, WebSocket:blocked, navigator:hostNavigator ? navigator : undefined};
      // 없는 API를 만들면 제품의 기능 탐지가 달라지므로 추가 경로는 host에 있는 경우만 차단합니다.
      for (const name of ['EventSource','Worker','SharedWorker','importScripts']) bindings[name] = typeof host[name] === 'function' ? blocked : undefined;
      Object.assign(bindings, (${createQualityWorkerBindings.toString()})(host,
        () => module.exports.getQualityWorkerPolicy?.(),
        (bytes) => require('node:crypto').createHash('sha256').update(bytes).digest('hex'), blocked));
      const hostMethods = new Set(['setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','cancelIdleCallback','atob','btoa']);
      const scope = new Proxy(Object.create(null), {get: (_target, key) => {
        if (Object.hasOwn(bindings, key)) return bindings[key];
        const value = Reflect.get(host, key, host);
        return hostMethods.has(key) && typeof value === 'function' ? value.bind(host) : value;
      }});
      Object.assign(bindings, {globalThis:scope, window:scope, self:scope, global:scope});
      new Function('module','exports','require',...Object.keys(bindings),built.outputFiles[0].text).call(scope,module,module.exports,productRequire,...Object.values(bindings));
      emit(await (${evaluatePinnedVaultRuntime.toString()})(app, plugin, module.exports,
        gold,
        ${lexicalOracle.toString()},
        ${scoreInformation.toString()}, ${mandatoryGate.toString()}, ledger, ${auditLiteralInventory.toString()}));
    } catch { emit({status:'failed',reason:'quality-vault-blocked'}); }

  })().catch(() => {}); return 1; })()`;
}

export function parseVaultArgs(args) {
  const invalid = () => { throw new Error('quality-explicit-host-required'); };
  const options = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (options.has(flag)) invalid();
    if (flag === '--mode=vault') { options.set(flag, true); continue; }
    if (!['--vault', '--obsidian-cli'].includes(flag)) invalid();
    const value = args[++i];
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /^-|[\r\n\0]/.test(value)) invalid();
    options.set(flag, value);
  }
  const vault = options.get('--vault'), cli = options.get('--obsidian-cli');
  if (!vault || !cli || !path.isAbsolute(cli) || !/^obsidian(?:-cli)?(?:\.exe|\.com)?$/i.test(path.basename(cli))) invalid();
  return { vault, cli };
}

// A public key/value allowlist is not proof of a complete successful run.
export function validateVaultResult(raw, cases) {
  const value = publicReport(raw);
  const invalid = () => { throw new Error('quality-vault-blocked'); };
  if (!['passed', 'blocked', 'failed'].includes(value?.status)) invalid();
  if (value.status !== 'passed') return value;
  const count = n => Number.isSafeInteger(n) && n >= 0;
  const counts = (obj, keys) => keys.split(' ').every(k => count(obj?.[k]));
  const validDelivery = (score, required) =>
    score.density === (score.deliveredBytes ? score.found / score.deliveredBytes : 0) &&
    (!score.found || score.deliveredBytes > 0) &&
    (required > 0 || (score.duplication === 0 && (!score.passed || (score.deliveredBytes === 0 && score.noise === 0))));
  const {rows, ledger} = value;
  if (value.schemaVersion !== 1 || value.reason !== undefined || value.scope !== 'vault-product-runtime' || value.semantic !== 'unverified-no-prepared-vectors' ||
      !count(cases) || !cases || !Array.isArray(rows) || rows.length !== cases ||
      ledger?.releases !== 1 || !['provider', 'embedding', 'network'].every(k => ledger[k] === 0)) invalid();
  for (const r of rows) {
    const b = r?.baseline;
    if (!counts(r, 'required found missing duplication noise deliveredBytes dossierBytes oracleDocuments oraclePassages oracleOccurrences') ||
        r.dossierBytes === 0 || r.required !== r.found || r.missing !== 0 || r.uniqueUsefulRecall !== (r.required ? 1 : null) ||
        r.noAnswerPass !== (r.required ? null : true) || !validDelivery(r, r.required) || r.deliveredBytes > r.dossierBytes ||
        r.oracleDocuments > r.oraclePassages || r.oraclePassages > r.oracleOccurrences ||
        (!r.oracleDocuments && r.oracleOccurrences > 0) ||
        !['passed','current','aggregationPass'].every(k => r[k] === true) ||
        !['hardLeakage','discoveryMissing','citationFailures'].every(k => r[k] === 0) || r.firstLoss !== 'none' || r.cappedRecall !== null ||
        !counts(b, 'found missing duplication noise deliveredBytes') || b.found + b.missing !== r.required || !validDelivery(b, r.required) ||
        typeof b.passed !== 'boolean' || (b.passed && b.missing !== 0) || r.densityImproved !== (b.passed && r.required ? r.density > b.density : null)) invalid();
    // The baseline delivers one nonempty quote per oracle passage, all noise in a no-answer case.
    if (r.required === 0 && (b.noise !== r.oraclePassages || b.passed !== (r.oraclePassages === 0) ||
        (r.oraclePassages === 0 ? b.deliveredBytes !== 0 : b.deliveredBytes < r.oraclePassages))) invalid();
  }
  return value;
}

// Obsidian.com can omit oversized eval arguments without a failing exit status.
const cliArgLimit = 4096;

function buildQualityVaultLoader(scriptPath, vault, digest) {
  // Keep dynamic paths/names out of the loader's JS and CLI quoting syntax.
  const payload = Buffer.from(JSON.stringify([scriptPath, vault]), 'utf8').toString('base64');
  return [
    '(() => { try {',
    `const [filename, expectedVault] = JSON.parse(require('node:buffer').Buffer.from('${payload}', 'base64').toString('utf8'));`,
    'if (app.vault?.getName?.() !== expectedVault) return 0;',
    "const bytes = require('node:fs').readFileSync(filename);",
    `if (require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== '${digest}') return 0;`,
    "return eval(bytes.toString('utf8'));",
    '} catch { return 0; } })()',
  ].join('');
}

export async function runVaultQuality(args) {
  const { vault, cli } = parseVaultArgs(args);
  const selector = `vault=${vault}`;
  if (Buffer.byteLength(selector, 'utf8') > cliArgLimit) throw new Error('quality-vault-blocked');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parent = path.join(root, '.thinkrail/context/_work');
  execFileSync('git', ['check-ignore', '--quiet', '--', parent], { cwd: root, stdio: 'ignore' });
  await mkdir(parent, { recursive: true });
  // A detached eval can finish after timeout and cleanup. Never reuse its destination.
  const directory = await mkdtemp(path.join(parent, `quality-vault-${randomUUID()}-`));
  try {
    const statusPath = path.join(directory, 'status.json'), outputPath = path.join(directory, 'report.json');
    const scriptPath = path.join(directory, 'evaluate.js');
    const source = buildQualityVaultCode({ root, statusPath, outputPath, atomicStatus: true });
    const digest = createHash('sha256').update(source, 'utf8').digest('hex');
    const codeArg = `code=${buildQualityVaultLoader(scriptPath, vault, digest)}`;
    if (Buffer.byteLength(codeArg, 'utf8') > cliArgLimit) throw new Error('quality-vault-blocked');
    await writeFile(scriptPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const ack = execFileSync(cli, [selector, 'eval', codeArg], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000, maxBuffer: 64 * 1024 });
    if (ack.trim() !== '=> 1') throw new Error('quality-vault-blocked');
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      let marker;
      try { marker = await readFile(statusPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (marker !== undefined) {
        const status = JSON.parse(marker);
        if (status?.completed !== true) throw new Error('quality-vault-blocked');
        const report = validateVaultResult(JSON.parse(await readFile(outputPath, 'utf8')), status.cases);
        if (Date.now() >= deadline) break;
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('quality-vault-timeout');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
