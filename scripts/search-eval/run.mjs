#!/usr/bin/env node

// 합성 검색 평가 CLI.
// 사용: node scripts/search-eval/run.mjs --scale 10k --split heldout --adapter baseline [--json out.json]
// 이 실행은 Node 어댑터 단위 평가이며 제품 DB/IO end-to-end가 아니다(adapters.mjs 상단 참고).
// 출력에는 합성 집계 지표·지연·메모리만 담고 실볼트 내용은 다루지 않는다.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSyntheticCorpus, SEARCH_EVAL_SCALES } from './corpus.mjs';
import { latencySummary, summarizeSearchEvaluation } from './metrics.mjs';
import { createSearchAdapter, SEARCH_EVAL_SCOPE } from './adapters.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const flag = (name) => args.includes(name);

async function main() {
  const scale = option('--scale') ?? 'ci';
  if (!SEARCH_EVAL_SCALES[scale]) throw new Error(`--scale은 ${Object.keys(SEARCH_EVAL_SCALES).join('|')} 중 하나여야 합니다.`);
  const split = option('--split') ?? 'dev';
  const adapterName = option('--adapter') ?? 'baseline';
  const k = Number(option('--k') ?? 8);
  const repeat = Number(option('--repeat') ?? 3);
  const minScore = Number(option('--min-score') ?? 0);
  const queriesPerCategory = option('--queries-per-category')
    ? Number(option('--queries-per-category'))
    : undefined;
  const seed = option('--seed') ? Number(option('--seed')) : undefined;
  const queryCap = option('--queries') ? Number(option('--queries')) : undefined;
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('--k는 1..100 정수여야 합니다.');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('--repeat은 1..20 정수여야 합니다.');

  const corpus = createSyntheticCorpus({ scale, split, seed, queriesPerCategory });
  const queries = queryCap ? selectQueries(corpus.queries, queryCap) : corpus.queries;
  const adapter = await createSearchAdapter(adapterName, {
    measureIndexBytes: flag('--index-bytes'),
  });

  const memoryBefore = process.memoryUsage().rss;
  const buildStart = performance.now();
  await adapter.build(corpus.documents);
  const coldBuildMs = performance.now() - buildStart;
  const memoryAfterBuild = process.memoryUsage().rss;

  const resultsByQueryId = new Map();
  const warmSamplesMs = [];
  let stabilityIdentical = true;
  for (let round = 0; round < repeat; round += 1) {
    for (const query of queries) {
      const startedAt = performance.now();
      const results = await adapter.query(query.text, k);
      warmSamplesMs.push(performance.now() - startedAt);
      if (round === 0) resultsByQueryId.set(query.id, results);
      else if (!sameResults(resultsByQueryId.get(query.id), results)) stabilityIdentical = false;
    }
  }
  const memoryAfterWarm = process.memoryUsage().rss;

  const metrics = summarizeSearchEvaluation(queries, resultsByQueryId, { k, minScore });
  const storageBeforeUpdate = adapter.stats();
  const update = flag('--skip-update') ? { supported: false, reason: 'skipped' } : await runUpdateScenario(adapter, corpus);
  const storageAfterUpdate = adapter.stats();
  const memoryAfterUpdate = process.memoryUsage().rss;

  const report = {
    schemaVersion: 1,
    evaluationScope: SEARCH_EVAL_SCOPE,
    adapter: adapter.name,
    adapterSentence: adapter.sentence,
    corpus: {
      scale,
      split,
      seed: corpus.seed,
      queriesPerCategory: corpus.queriesPerCategory,
      documentCount: corpus.stats.documentCount,
      chunkCount: corpus.stats.chunkCount,
      bodyBytes: corpus.stats.bodyBytes,
      queryCount: corpus.stats.queryCount,
      evaluatedQueryCount: queries.length,
      categoryCounts: corpus.stats.categoryCounts,
    },
    config: { k, repeat, minScore },
    metrics: { overall: metrics.overall, byCategory: metrics.byCategory },
    latency: { coldBuildMs, warm: latencySummary(warmSamplesMs) },
    memory: {
      rssBeforeBytes: memoryBefore,
      rssAfterBuildBytes: memoryAfterBuild,
      rssAfterWarmBytes: memoryAfterWarm,
      rssAfterUpdateBytes: memoryAfterUpdate,
    },
    storage: storageBeforeUpdate,
    storageAfterUpdate,
    stability: { rounds: repeat, identical: stabilityIdentical },
    update,
  };

  const baselinePath = option('--baseline');
  if (baselinePath) report.comparison = await compareWithBaseline(path.resolve(baselinePath), report);

  adapter.free?.();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = option('--json');
  if (output) await writeFile(path.resolve(output), serialized);
  process.stdout.write(output ? `${JSON.stringify(reportSummary(report))}\n` : serialized);
}

// 범주별로 고르게 뽑아 --queries 상한에서도 모든 범주가 평가되게 한다.
function selectQueries(allQueries, cap) {
  if (!Number.isInteger(cap) || cap < 1) throw new Error('--queries는 1 이상 정수여야 합니다.');
  const byCategory = new Map();
  for (const query of allQueries) {
    const bucket = byCategory.get(query.category) ?? [];
    bucket.push(query);
    byCategory.set(query.category, bucket);
  }
  const selected = [];
  let index = 0;
  while (selected.length < cap && selected.length < allQueries.length) {
    for (const bucket of byCategory.values()) {
      if (bucket[index]) selected.push(bucket[index]);
      if (selected.length >= cap) break;
    }
    index += 1;
  }
  return selected.slice(0, Math.min(cap, allQueries.length));
}

function sameResults(before, after) {
  if (!before || before.length !== after.length) return false;
  return before.every((result, index) => {
    const other = after[index];
    return (
      result.path === other.path &&
      result.startLine === other.startLine &&
      result.endLine === other.endLine
    );
  });
}

// 수정·추가·삭제가 실제 검색 결과에 반영되는지 결정적으로 확인한다.
async function runUpdateScenario(adapter, corpus) {
  const candidates = corpus.queries.filter((query) => query.goldPaths.length > 0);
  if (candidates.length < 2) return { supported: false, reason: 'no-case' };
  const changeTarget = candidates[0];
  const removeTarget = candidates[1];
  const changedPath = changeTarget.goldPaths[0];
  const removedPath = removeTarget.goldPaths[0];
  const changedDocument = corpus.documents.find((document) => document.path === changedPath);
  const removedDocument = corpus.documents.find((document) => document.path === removedPath);
  const goldChunkIndex = changedDocument?.goldChunkIndexes[0] ?? 0;
  const marker = `marker-${corpus.split}-refresh`;
  const additionMarker = `marker-${corpus.split}-addition`;
  const changed = {
    ...changedDocument,
    chunks: changedDocument.chunks.map((chunk) =>
      chunk.index === goldChunkIndex ? { ...chunk, text: `${marker} 갱신된 구절 본문` } : chunk,
    ),
  };
  const added = {
    path: `update-${corpus.split}/added.md`,
    title: `update ${corpus.split} added`,
    text: `${additionMarker} 추가된 구절 본문\n`,
    chunks: [{ index: 0, startLine: 1, endLine: 1, text: `${additionMarker} 추가된 구절 본문` }],
    goldChunkIndexes: [0],
    forbiddenChunkIndexes: [],
    bytes: Buffer.byteLength(`${additionMarker} 추가된 구절 본문\n`, 'utf8'),
  };
  const startedAt = performance.now();
  const counts = await adapter.update({ changedDocuments: [changed, added], removedPaths: [removedPath] });
  const updateMs = performance.now() - startedAt;
  const changedHits = await adapter.query(marker, 5);
  const addedHits = await adapter.query(additionMarker, 5);
  const removedHits = await adapter.query(removeTarget.text, 5);
  const changedChunk = changed.chunks.find((chunk) => chunk.index === goldChunkIndex);
  return {
    supported: true,
    changedSources: counts?.changedSources ?? null,
    removedSources: counts?.removedSources ?? null,
    updateMs,
    changedRetrievable: changedHits.some(
      (hit) =>
        hit.path === changedPath &&
        hit.startLine <= changedChunk.endLine &&
        changedChunk.startLine <= hit.endLine,
    ),
    addedRetrievable: addedHits.some((hit) => hit.path === added.path),
    removedAbsent: removedHits.every((hit) => hit.path !== removedPath),
    removedDocumentPresent: Boolean(removedDocument),
  };
}

async function compareWithBaseline(baselinePath, report) {
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const delta = (previous, current) => {
    if (typeof previous !== 'number' || typeof current !== 'number') return null;
    return { absolute: current - previous, relative: previous === 0 ? null : (current - previous) / previous };
  };
  return {
    baselineAdapter: baseline.adapter ?? null,
    baselineCorpus: baseline.corpus
      ? { scale: baseline.corpus.scale, split: baseline.corpus.split, documentCount: baseline.corpus.documentCount }
      : null,
    metrics: {
      documentRecall: delta(baseline.metrics?.overall?.documentRecall, report.metrics.overall.documentRecall),
      ndcg10: delta(baseline.metrics?.overall?.ndcg10, report.metrics.overall.ndcg10),
      passageHitRatio: delta(baseline.metrics?.overall?.passageHitRatio, report.metrics.overall.passageHitRatio),
      noAnswerAccuracy: delta(baseline.metrics?.overall?.noAnswerAccuracy, report.metrics.overall.noAnswerAccuracy),
      conflictPairCoverage: delta(
        baseline.metrics?.overall?.conflictPairCoverage,
        report.metrics.overall.conflictPairCoverage,
      ),
    },
    latency: {
      coldBuildMs: delta(baseline.latency?.coldBuildMs, report.latency.coldBuildMs),
      warmP50Ms: delta(baseline.latency?.warm?.p50Ms, report.latency.warm.p50Ms),
      warmP95Ms: delta(baseline.latency?.warm?.p95Ms, report.latency.warm.p95Ms),
    },
  };
}

function reportSummary(report) {
  return {
    adapter: report.adapter,
    scope: report.evaluationScope,
    corpus: report.corpus,
    metrics: report.metrics.overall,
    latency: { coldBuildMs: report.latency.coldBuildMs, warm: report.latency.warm },
    memory: report.memory,
    storage: report.storage,
    stability: report.stability,
    update: report.update,
    comparison: report.comparison ?? null,
    json: option('--json') ?? null,
  };
}

main().catch((error) => {
  console.error(`검색 평가 실행 실패: ${error.message}`);
  process.exitCode = 1;
});
