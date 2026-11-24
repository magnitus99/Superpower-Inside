// 실행은 부모 소유입니다. 이 파일의 개발 검증은 합성 VM으로만 수행합니다.
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexicalOracle, scoreInformation, mandatoryGate, auditLiteralInventory } from './quality-oracle.mjs';
import { publicReport } from './quality-report.mjs';
import { createQualityWorkerBindings } from './quality-worker-guard.mjs';

// app 메모리의 독립 gold만 받습니다. 원문·질의·경로를 CLI/파일에 운반하지 않습니다.
export async function evaluateVaultRuntime(app, plugin, runtime, cases, oracle, score, gate, ledger = { provider: 0, embedding: 0, network: 0, releases: 0 }, audit = auditLiteralInventory) {
  if (typeof plugin?.acquireRagEngineOnlySnapshot !== 'function') return { status: 'blocked', reason: 'engine-only-snapshot-required' };
  let lease;
  try {
    lease = await plugin.acquireRagEngineOnlySnapshot();
    if (!lease?.ragEngine || !lease?.documentCorpus || typeof lease.release !== 'function') return { status: 'blocked', reason: 'engine-only-snapshot-unavailable' };
    // MAIN의 lexical-only 계약 위반은 실제 provider를 호출하기 전에 실패 폐쇄합니다.
    if (lease.ragEngine.embeddingProvider || lease.ragEngine.vectorStore) return { status: 'blocked', reason: 'engine-only-snapshot-unavailable' };
    if (!Array.isArray(cases) || !cases.length || Array.from(cases).some((item) =>
      !item || typeof item.question !== 'string' || !item.question.trim() ||
      !Array.isArray(item.terms) || !item.terms.length || Array.from(item.terms).some((term) => typeof term !== 'string' || !term.trim()) ||
      (item.expectNoAnswer !== undefined && typeof item.expectNoAnswer !== 'boolean') ||
      (item.hardExcludedPaths !== undefined && (!Array.isArray(item.hardExcludedPaths) || Array.from(item.hardExcludedPaths).some((entry) => typeof entry !== 'string' || !entry.trim()))) ||
      !Array.isArray(item.information) || (!item.information.length && item.expectNoAnswer !== true) ||
      Array.from(item.information).some((info) => !info || ['id', 'kind', 'path', 'text'].some((key) => typeof info[key] !== 'string' || !info[key].trim()) || !Number.isInteger(info.line) || info.line < 1)
    )) return { status: 'blocked', reason: 'independent-gold-required' };
    const host = runtime.createEngineOnlyVaultHost(app, plugin, lease);
    const documents = await runtime.readOracleDocuments(host, lease);
    const rows = [];
    for (const testCase of cases) {
      const expected = oracle(documents, testCase.terms, testCase.hardExcludedPaths);
      let literalAudit;
      const { result } = await runtime.runProductCase(host, testCase, ledger, undefined, async ({ source, result }) => {
        literalAudit = await audit(testCase, result.dossier.literalInventory, result.readLiteralDiscoveryPage, documents, (source.discoveryCandidates ?? source.candidates ?? []).map((item) => item.path), oracle);
      });
      const row = score(testCase, result.dossier.evidence, documents);
      const baseline = score(testCase, expected.rows.flatMap((item) => item.passages.map((line) => ({
        path: item.path, startLine: line, endLine: line,
        quote: documents.find((document) => document.path === item.path).text.split('\n')[line - 1],
      }))), documents);
      const discoveryMissing = literalAudit?.discoveryMissing ?? expected.documents;
      const aggregationPass = literalAudit?.passed === true;
      const current = result.dossier.evidence.every((item) => {
        const document = documents.find((document) => document.path === item.path);
        return document && item.revision === document.revision && item.contentHash === document.contentHash;
      });
      rows.push({ ...row, dossierBytes: new TextEncoder().encode(JSON.stringify(result.dossier)).length,
        baseline: { found: baseline.found, missing: baseline.missing, passed: baseline.passed, duplication: baseline.duplication, noise: baseline.noise, deliveredBytes: baseline.deliveredBytes, density: baseline.density },
        densityImproved: row.passed && baseline.passed && row.required > 0 ? row.density > baseline.density : null,
        cappedRecall: null,
        discoveryMissing, aggregationPass, current, firstLoss: discoveryMissing > 0 ? 'discovery' : row.passed && current && aggregationPass ? 'none' : 'unknown',
        oracleDocuments: expected.documents, oraclePassages: expected.passages, oracleOccurrences: expected.occurrences,
        passed: row.passed && !discoveryMissing && aggregationPass && current });
    }
    if (ledger.provider + ledger.embedding + ledger.network) return { status: 'failed', reason: 'quality-attempt-blocked', ledger };
    return { schemaVersion: 1, status: gate(rows) ? 'passed' : 'failed', scope: 'vault-product-runtime', semantic: 'unverified-no-prepared-vectors', rows, ledger };
  } catch {
    return { status: 'failed', reason: 'quality-vault-blocked', ledger };
  } finally {
    if (lease?.release) { lease.release(); ledger.releases++; }
  }
}

export function buildQualityVaultCode({ root, outputPath, statusPath }) {
  return `void (async () => {
    const fs = require('node:fs');
    const publicReport = (${publicReport.toString()});
    const emit = (value) => fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(publicReport(value)));
    try {
      const plugin = app.plugins.plugins['superpower-inside'];
      if (typeof plugin?.acquireRagEngineOnlySnapshot !== 'function') { emit({status:'blocked',reason:'engine-only-snapshot-required'}); return; }
      const localRequire = require('node:module').createRequire(${JSON.stringify(path.join(root, 'package.json'))});
      const esbuild = localRequire('esbuild');
      const built = await esbuild.build({entryPoints:[${JSON.stringify(path.join(root, 'scripts/search-eval/product-runtime.mjs'))}],bundle:true,write:false,platform:'node',format:'cjs',target:'es2022',packages:'external',logLevel:'silent'});
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
      emit(await (${evaluateVaultRuntime.toString()})(app, plugin, module.exports,
        globalThis.superpowerQualityLoopCases,
        ${lexicalOracle.toString().replaceAll('normalize(term)', "term.normalize('NFKC').toLowerCase()").replaceAll('normalize(lines[index])', "lines[index].normalize('NFKC').toLowerCase()")},
        ${scoreInformation.toString()}, ${mandatoryGate.toString()}, ledger, ${auditLiteralInventory.toString()}));
    } catch { emit({status:'failed',reason:'quality-vault-blocked'}); }
    finally { fs.writeFileSync(${JSON.stringify(statusPath)}, '{"completed":true}'); }
  })();`;
}

export async function runVaultQuality(args) {
  const option = (name) => args[args.indexOf(name) + 1];
  // 자동 볼트/CLI 탐색·기존 검색 포트·provider fallback은 없습니다.
  if (!args.includes('--vault') || !option('--vault') || !args.includes('--obsidian-cli') || !option('--obsidian-cli')) throw new Error('quality-explicit-host-required');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = path.join(root, '.thinkrail/context/_work');
  await mkdir(directory, { recursive: true });
  const statusPath = path.join(directory, 'quality-vault-status.json');
  const outputPath = path.join(directory, 'quality-vault-report.json');
  // 이전 실행 결과를 현재 성공으로 재사용하지 않습니다.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(statusPath, '{"completed":false}');
  await writeFile(outputPath, '{"status":"blocked","reason":"quality-vault-blocked"}');
  execFileSync(option('--obsidian-cli'), [`vault=${option('--vault')}`, 'eval', `code=${buildQualityVaultCode({ root, statusPath, outputPath })}`], { stdio: 'ignore', timeout: 60_000 });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const status = JSON.parse(await readFile(statusPath, 'utf8'));
    if (status.completed === true) return JSON.parse(await readFile(outputPath, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('quality-vault-timeout');
}
