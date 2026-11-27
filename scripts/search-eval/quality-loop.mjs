#!/usr/bin/env node
// 제품 collect → 현재 원문 검증 → engine-only dossier. raw 자료는 메모리 밖으로 내보내지 않습니다.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { qualityFixture } from './quality-fixture.mjs';
import { lexicalOracle, scoreInformation, mandatoryGate, auditLiteralInventory } from './quality-oracle.mjs';
import { publicReport } from './quality-report.mjs';
export { publicReport };

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
export const reportPath = '.thinkrail/context/quality-loop-report.json';
export const vaultReportPath = '.thinkrail/context/quality-loop-vault-report.json';
export function attemptLedger() { return { provider: 0, embedding: 0, network: 0, releases: 0, suppressedOutput: 0 }; }
export function assertNoAttempts(ledger) { if (!['provider', 'embedding', 'network'].every(key => ledger[key] === 0)) throw new Error('quality-attempt-blocked'); }

export async function bundleProductRuntime({ vault = false } = {}) {
  const result = await build({
    entryPoints: [path.join(root, 'scripts/search-eval/product-runtime.mjs')], bundle: true, write: false,
    platform: 'node', format: 'cjs', target: 'es2022', packages: 'external', logLevel: 'silent',
    plugins: vault ? [] : [{ name: 'isolated-obsidian', setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'synthetic' }));
      builder.onResolve({ filter: /^dexie$/ }, () => ({ path: require.resolve('dexie') }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: `
        export class TFile {} export class TFolder {}
        export const getAllTags = () => [];
        export const getFrontMatterInfo = () => ({exists:false,frontmatter:''});
        export const parseYaml = () => ({});
        export const normalizePath = (path) => path;
        export const requestUrl = (...args) => globalThis.fetch(...args);
      ` }));
    } }],
  });
  return result.outputFiles[0].text;
}

export async function loadProductRuntime(ledger) {
  const code = await bundleProductRuntime();
  const fake = require('fake-indexeddb');
  const module = { exports: {} };
  function blocked() { ledger.network++; throw new Error('quality-network-blocked'); }
  const quiet = () => { ledger.suppressedOutput++; };
  const context = {
    module, exports: module.exports, crypto: webcrypto,
    require: (name) => {
      if (['dexie', 'fflate'].includes(name)) return require(name);
      return blocked();
    },
    indexedDB: new fake.IDBFactory(), IDBKeyRange: fake.IDBKeyRange,
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, WebAssembly, atob, btoa,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance,
    AbortController, AbortSignal, DOMException, structuredClone, CustomEvent,
    console: { log: quiet, warn: quiet, error: quiet, debug: quiet, info: quiet, trace: quiet },
    fetch: blocked, XMLHttpRequest: blocked, WebSocket: blocked,
  };
  context.window = context; context.self = context; context.global = context;
  runInNewContext(code, context, { timeout: 30_000 });
  // Dexie도 같은 격리 realm에서 실행하므로 호스트 전역 복구는 필요 없습니다.
  return { runtime: module.exports, restore: () => {} };
}

export async function runSyntheticQuality() {
  const ledger = attemptLedger();
  const { runtime, restore } = await loadProductRuntime(ledger);
  let product;
  try {
    product = await runtime.createSyntheticProduct(qualityFixture.documents, ledger);
    const rows = [];
    for (const testCase of qualityFixture.cases) {
      const oracle = lexicalOracle(qualityFixture.documents, testCase.terms, testCase.hardExcludedPaths);
      let literalAudit;
      const { result } = await runtime.runProductCase(product.host, testCase, ledger, undefined, async ({ source, result }) => {
        literalAudit = await auditLiteralInventory(testCase, result.dossier.literalInventory, result.readLiteralDiscoveryPage, qualityFixture.documents, (source.discoveryCandidates ?? source.candidates ?? []).map((item) => item.path), lexicalOracle, oracle);
      });
      const evidence = result.dossier.evidence;
      const quality = scoreInformation(testCase, evidence, qualityFixture.documents);
      const baseline = scoreInformation(testCase, oracle.rows.flatMap(({ path, passages }) => {
        const lines = qualityFixture.documents.find(doc => doc.path === path).text.split('\n');
        return passages.map(line => ({ path, startLine: line, endLine: line, quote: lines[line - 1] }));
      }), qualityFixture.documents);
      const discoveryMissing = literalAudit?.discoveryMissing ?? oracle.documents;
      const current = evidence.every((item) => {
        const file = product.files.get(item.path);
        return item.revision === `${file.stat.mtime}:${file.stat.size}` && item.contentHash === runtime.createContentHash(product.texts.get(item.path));
      });
      // BM25 token 집계는 별도로 유지하며 원문 literal 총계·전 페이지를 같은 정의로 대조합니다.
      const aggregationPass = literalAudit?.passed === true;
      rows.push({ ...quality, dossierBytes: new TextEncoder().encode(JSON.stringify(result.dossier)).length, discoveryMissing, oracleDocuments: oracle.documents, oraclePassages: oracle.passages, oracleOccurrences: oracle.occurrences,
        current, aggregationPass, firstLoss: discoveryMissing > 0 ? 'discovery' : quality.passed && current && aggregationPass ? 'none' : 'unknown', cappedRecall: null,
        baseline: { found: baseline.found, missing: baseline.missing, passed: baseline.passed, duplication: baseline.duplication, noise: baseline.noise, deliveredBytes: baseline.deliveredBytes, density: baseline.density },
        densityImproved: quality.passed && baseline.passed && quality.required > 0 ? quality.density > baseline.density : null,
        passed: quality.passed && current && aggregationPass && discoveryMissing === 0 });
    }
    assertNoAttempts(ledger);
    return { schemaVersion: 1, status: mandatoryGate(rows) ? 'passed' : 'failed', scope: 'synthetic-product-runtime', semantic: 'unverified-no-prepared-vectors', rows, ledger };
  } finally { product?.close(); restore(); }
}

async function publishReport(target, serialized) {
  await mkdir(path.dirname(target), { recursive: true });
  const pending = `${target}.${randomUUID()}.pending`;
  try {
    await writeFile(pending, serialized, { flag: 'wx' });
    await rename(pending, target);
  } finally { await rm(pending, { force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  const vault = args.some(arg => ['--mode=vault', '--vault', '--obsidian-cli'].includes(arg));
  const target = path.join(root, vault ? vaultReportPath : reportPath);
  try {
    if (!vault && args.length && !(args.length === 1 && args[0] === '--mode=synthetic')) throw new Error('quality-invalid-mode');
    const report = publicReport(vault
      ? await (await import('./quality-vault.mjs')).runVaultQuality(args)
      : await runSyntheticQuality());
    await publishReport(target, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.status !== 'passed') process.exitCode = 1;
  } catch {
    // 예외/child stdout/stderr/진행은 절대로 출력하지 않습니다. 이전 성공 보고서도 남기지 않습니다.
    const serialized = '{"status":"failed","reason":"quality-loop-blocked"}\n';
    try {
      await publishReport(target, serialized);
    } catch { /* 출력 경로 실패도 원문 없는 고정 상태로 끝냅니다. */ }
    process.stdout.write(serialized);
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
