#!/usr/bin/env node

// 실볼트 제품 검색 포트 집계 평가.
// Obsidian 앱 안에서 제품 검색 경로를 실제 호출하고 지연·RSS·자기 문서 발견률만 집계한다.
// 우선순위: plugin.getSearchPort()(searchIndexedVault SearchPort) → plugin.ragEngine.query(기준선).
// 질의·경로·본문·오류 메시지는 어디에도 기록하지 않는다.
// 사용: node scripts/search-eval/run-vault.mjs --vault .test-vault --queries 24 [--json out.json]

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function main() {
  const vault = option('--vault') ?? '.test-vault';
  const queries = Number(option('--queries') ?? 24);
  const timeoutMinutes = Number(option('--timeout-min') ?? 30);
  if (!Number.isInteger(queries) || queries < 1 || queries > 200)
    throw new Error('--queries는 1..200 정수여야 합니다.');
  const tempRoot = path.resolve('node_modules/.cache/search-eval');
  execFileSync('git', ['check-ignore', '--quiet', path.join(tempRoot, 'probe')]);
  await mkdir(tempRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tempRoot, 'vault-'));
  const statusPath = path.join(directory, 'status.json');
  const outputPath = path.join(directory, 'report.json');
  const code = buildEvaluationCode({ queries, statusPath, outputPath, requirePort: !args.includes('--allow-baseline') });
  const cli = option('--obsidian-cli') ?? '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli';
  try {
    const launch = execFileSync(cli, [`vault=${vault}`, 'eval', `code=${code}`], {
      encoding: 'utf8',
      timeout: 30 * 60_000,
    });
    if (launch.includes('Error:')) throw new Error('Obsidian 평가 스크립트를 시작하지 못했습니다.');
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let status = null;
    while (Date.now() < deadline) {
      status = await readFile(statusPath, 'utf8').then(
        (value) => JSON.parse(value),
        () => null,
      );
      if (status && !status.running) break;
      if (status?.hostPid && !isAlive(status.hostPid))
        throw new Error('Obsidian 평가 호스트가 종료되었습니다.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!status || status.running) throw new Error('Obsidian 평가 대기 시간이 초과되었습니다.');
    if (!status.completed) throw new Error(`실제 볼트 검색 평가 실패: 단계=${status.stage}`);
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    const output = option('--json');
    if (output) await writeFile(path.resolve(output), serialized);
    process.stdout.write(serialized);
    if (report.searchPath === 'search-port' &&
      (report.contractFailures > 0 || report.uncoveredContracts.length > 0 || report.coverage.errors > 0 || report.coverage.nullResponses > 0))
      process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 평가 코드는 앱 안에서 실행되며 집계만 status/output 파일로 내보낸다.
export function buildEvaluationCode({ queries, statusPath, outputPath, requirePort = true }) {
  return [
    'void (async () => {',
    '  let stage = "plugin";',
    `  const statusPath = ${JSON.stringify(statusPath)};`,
    `  const outputPath = ${JSON.stringify(outputPath)};`,
    '  const fs = require("node:fs");',
    '  const writeStatus = (value) => fs.writeFileSync(statusPath, JSON.stringify(value));',
    '  try {',
    '    writeStatus({ running: true, hostPid: process.pid, stage });',
    '    const plugin = app.plugins.plugins["superpower-inside"];',
    '    const port = plugin && typeof plugin.getSearchPort === "function" ? plugin.getSearchPort() : null;',
    '    const engine = plugin && plugin.ragEngine ? plugin.ragEngine : null;',
    '    const searchPath = port ? "search-port" : engine ? "rag-engine" : null;',
    '    if (!searchPath) { writeStatus({ completed: false, stage: "search-unavailable" }); return; }',
    `    if (${requirePort} && !port) { writeStatus({ completed: false, stage: "new-search-port-required" }); return; }`,
    '    const pluginVersion = plugin && plugin.manifest ? plugin.manifest.version : null;',
    '    const files = app.vault.getMarkdownFiles().slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));',
    `    const target = Math.min(${queries}, files.length);`,
    '    const stride = Math.max(1, Math.floor(files.length / Math.max(1, target)));',
    '    const probes = [];',
    '    for (let index = 0; index < files.length && probes.length < target; index += stride) probes.push(files[index]);',
    '    stage = "probing";',
    '    let zeroHit = 0, top1Self = 0, topkSelf = 0, nullResponses = 0, errors = 0, evidenceTotal = 0;',
    '    let reviewed = 0, unreviewed = 0, notIndexed = 0;',
    '    const contracts = {};',
    '    const check = (name, ok) => { const row = contracts[name] ||= { checked: 0, passed: 0 }; row.checked++; if (ok) row.passed++; };',
    '    const latencies = [];',
    '    const rssBefore = process.memoryUsage().rss;',
    '    for (let index = 0; index < probes.length; index++) {',
    '      const file = probes[index];',
    '      let query = file.basename.replace(/[-_.]+/g, " ").trim();',
    '      try {',
    '        const content = await app.vault.cachedRead(file);',
    '        const heading = /^#{1,6}\\s+(.+)$/m.exec(content);',
    '        if (heading && heading[1].trim().length >= 3) query = heading[1].trim();',
    '      } catch (error) { /* 읽기 실패 시 파일명 질의 유지 */ }',
    '      query = query.slice(0, 80);',
    '      let hits = null;',
    '      const startedAt = performance.now();',
    '      try {',
    '        if (searchPath === "search-port") {',
    '          const response = await port({ query });',
    '          if (!response) { nullResponses += 1; hits = []; }',
    '          else {',
    '            hits = response.evidence || [];',
    '            const coverage = response.coverage || {};',
    '            reviewed += coverage.reviewedDocuments || 0;',
    '            unreviewed += coverage.unreviewedDocuments || 0;',
    '            notIndexed += coverage.notIndexedDocuments || 0;',
    '          }',
    '        } else {',
    '          const results = await engine.query(query, 8, 0, undefined, {});',
    '          hits = (results || []).map((item) => ({ path: item.sourcePath, startLine: item.chunkRange ? item.chunkRange.startLine : null, endLine: item.chunkRange && item.chunkRange.endLine !== undefined ? item.chunkRange.endLine : (item.chunkRange ? item.chunkRange.startLine : null) }));',
    '        }',
    '      } catch (error) { errors += 1; hits = null; }',
    '      latencies.push(performance.now() - startedAt);',
    '      if (hits !== null) {',
    '        evidenceTotal += hits.length;',
    '        if (hits.length === 0) zeroHit += 1;',
    '        if (hits.some((item) => item.path === file.path)) topkSelf += 1;',
    '        if (hits[0] && hits[0].path === file.path) top1Self += 1;',
    '      }',
    '      if (port && hits) {',
    '        for (const hit of hits) {',
    '          const current = app.vault.getAbstractFileByPath(hit.path);',
    '          check("selectedRevisionCurrent", Boolean(current && hit.revision === `${current.stat.mtime}:${current.stat.size}`));',
    '          if (current) {',
    '            const text = await app.vault.cachedRead(current);',
    '            const segment = text.split("\\n").slice(hit.startLine - 1, hit.endLine).join("\\n");',
    '            check("selectedQuoteAtAbsoluteLines", typeof hit.quote === "string" && hit.quote.length > 0 && segment.includes(hit.quote));',
    '          }',
    '        }',
    '        if (index === 0) {',
    '          const cancelled = new AbortController(); cancelled.abort();',
    '          try { const value = await port({ query, signal: cancelled.signal }); check("preCancelled", value === null || value.evidence.length === 0); }',
    '          catch (error) { check("preCancelled", error && error.name === "AbortError"); }',
    '          const absent = "zzabsent" + require("node:crypto").randomUUID().replace(/-/g, "");',
    '          const empty = await port({ query: absent });',
    '          check("noAnswer", Boolean(empty && empty.evidence.length === 0));',
    '          if (hits.length > 0) {',
    '            const selected = app.vault.getAbstractFileByPath(hits[0].path);',
    '            const metadata = app.metadataCache.getFileCache(selected) || {};',
    '            const tags = (metadata.tags || []).map((item) => item.tag.replace(/^#/, ""));',
    '            const filterCases = [',
    '              ["pathFilter", { pathPrefixes: [selected.path] }, (hit) => hit.path.startsWith(selected.path)],',
    '              ["extensionFilter", { extensions: [selected.extension] }, (hit) => hit.path.endsWith("." + selected.extension)],',
    '              ["modifiedFilter", { modifiedAfter: selected.stat.mtime }, (hit) => app.vault.getAbstractFileByPath(hit.path)?.stat.mtime >= selected.stat.mtime],',
    '            ];',
    '            if (tags.length) filterCases.push(["tagFilter", { tags: [tags[0]] }, (hit) => { const file = app.vault.getAbstractFileByPath(hit.path); const cache = app.metadataCache.getFileCache(file); return Boolean(cache?.tags?.some((item) => item.tag.replace(/^#/, "") === tags[0])); }]);',
    '            for (const [name, filters, predicate] of filterCases) {',
    '              const response = await port({ query, filters });',
    '              check(name, Boolean(response && response.evidence.length > 0 && response.evidence.every(predicate)));',
    '            }',
    '            const terms = hits[0].quote.trim().split(/\\s+/).slice(0, 3);',
    '            const literal = terms.join(" ").replace(/"/g, "");',
    '            const phrase = await port({ query: `"${literal}"` });',
    '            check("quotedPhrase", Boolean(phrase && phrase.evidence.length > 0 && phrase.evidence.every((hit) => hit.quote.includes(literal))));',
    '            const typo = await port({ query: literal.slice(0, -1) + "x" });',
    '            check("typoResponseContract", Boolean(typo && Array.isArray(typo.evidence) && typo.diagnostics));',
    '          }',
    '        }',
    '      }',
    '      writeStatus({ running: true, hostPid: process.pid, stage, completed: index + 1, total: probes.length });',
    '    }',
    '    const rssAfter = process.memoryUsage().rss;',
    '    const sorted = latencies.slice().sort((a, b) => a - b);',
    '    const quantile = (fraction) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];',
    '    const report = {',
    '      schemaVersion: 1,',
    '      kind: "product-search-live-aggregate",',
    '      searchPath,',
    '      pluginVersion,',
    '      searchPortFnAvailable: typeof plugin?.getSearchPort === "function",',
    '      vaultMarkdownFiles: files.length,',
    '      probes: probes.length,',
    '      probeKind: "self-retrieval from first heading or file name (no gold labels)",',
    '      accuracyValidation: "self-document probes and contract checks only; not full relevance accuracy",',
    '      contracts,',
    '      contractFailures: Object.values(contracts).reduce((total, row) => total + row.checked - row.passed, 0),',
    '      uncoveredContracts: searchPath === "search-port" ? ["selectedRevisionCurrent", "selectedQuoteAtAbsoluteLines", "preCancelled", "noAnswer", "pathFilter", "extensionFilter", "modifiedFilter", "quotedPhrase", "typoResponseContract"].filter((name) => !contracts[name]?.checked) : [],',
    '      metadataTagProbeAvailable: Boolean(contracts.tagFilter?.checked),',
    '      latency: { meanMs: sorted.length ? sorted.reduce((total, value) => total + value, 0) / sorted.length : null, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: sorted.length ? sorted[sorted.length - 1] : null },',
    '      coverage: { zeroHit, top1SelfHit: top1Self, topkSelfHit: topkSelf, nullResponses, errors, evidenceTotal, reviewedDocumentsSum: reviewed, unreviewedDocumentsSum: unreviewed, notIndexedDocumentsSum: notIndexed },',
    '      memory: { rssBeforeBytes: rssBefore, rssAfterBytes: rssAfter },',
    '      privacy: "aggregate-only: no queries, paths, or bodies recorded",',
    '    };',
    '    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));',
    '    writeStatus({ completed: true });',
    '  } catch (error) {',
    '    writeStatus({ completed: false, stage, errorName: error && error.name ? String(error.name).slice(0, 40) : "Error" });',
    '  }',
    '})();',
    '"검색 평가 시작"',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`실제 볼트 검색 평가 실패: ${error.name === 'Error' ? '실행 또는 호스트 검사 실패' : '입출력 실패'}`);
  process.exitCode = 1;
});
