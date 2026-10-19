// 합성 검색 평가 지표. 입력은 어댑터와 무관한 {path, startLine, endLine, score} 결과만 받는다.
// 골드는 문서(path)·구절(line range 겹침)·상충/복수 문서(모두 상위 k) 3단으로 채점한다.

export function evaluateQuery(query, results, k = 8) {
  const ranked = rankResults(results, k);
  const paths = ranked.map((result) => result.path);
  const goldPaths = query.goldPaths ?? [];
  const foundGold = goldPaths.filter((path) => paths.includes(path));
  const firstRank = paths.findIndex((path) => goldPaths.includes(path));
  const passageHits = (query.goldPassages ?? []).filter((passage) =>
    ranked.some((result) => result.path === passage.path && overlapsPassage(result, passage)),
  );
  return {
    id: query.id,
    category: query.category,
    resultCount: ranked.length,
    documentRecall: goldPaths.length === 0 ? null : foundGold.length / goldPaths.length,
    precision: ranked.length === 0 ? null : foundGold.length / Math.max(1, k),
    reciprocalRank: goldPaths.length === 0 ? null : firstRank < 0 ? 0 : 1 / (firstRank + 1),
    ndcg10: binaryNdcg(ranked, goldPaths),
    passageHitRatio:
      (query.goldPassages ?? []).length === 0
        ? null
        : passageHits.length / query.goldPassages.length,
    passageAllHit:
      (query.goldPassages ?? []).length === 0 ? null : passageHits.length === query.goldPassages.length,
    multiGoldCovered:
      query.multiGold || query.conflictPair
        ? goldPaths.length > 0 && foundGold.length === goldPaths.length
        : null,
    conflictPairCovered: query.conflictPair
      ? goldPaths.length > 1 && foundGold.length === goldPaths.length
      : null,
    noAnswerPass: query.expectNoAnswer ? ranked.length === 0 : null,
    forbiddenTop1: query.forbiddenPaths?.length
      ? ranked.length > 0 && query.forbiddenPaths.includes(ranked[0].path)
      : null,
  };
}

export function summarizeSearchEvaluation(queries, resultsByQueryId, options = {}) {
  const k = options.k ?? 8;
  const minScore = options.minScore ?? 0;
  const rows = queries.map((query) =>
    evaluateQuery(
      query,
      (resultsByQueryId.get(query.id) ?? []).filter((result) => (result.score ?? 1) >= minScore),
      k,
    ),
  );
  const byCategory = {};
  for (const row of rows) {
    const bucket = (byCategory[row.category] ??= []);
    bucket.push(row);
  }
  const categories = {};
  for (const [category, bucket] of Object.entries(byCategory)) categories[category] = aggregateRows(bucket);
  return { k, minScore, queryCount: rows.length, overall: aggregateRows(rows), byCategory: categories, rows };
}

export function aggregateRows(rows) {
  const mean = (selector) => {
    const values = rows.map(selector).filter((value) => typeof value === 'number');
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
  };
  return {
    queryCount: rows.length,
    documentRecall: mean((row) => row.documentRecall),
    precision: mean((row) => row.precision),
    mrr: mean((row) => row.reciprocalRank),
    ndcg10: mean((row) => row.ndcg10),
    passageHitRatio: mean((row) => row.passageHitRatio),
    multiGoldCoverage: mean((row) => (row.multiGoldCovered === null ? null : Number(row.multiGoldCovered))),
    conflictPairCoverage: mean((row) =>
      row.conflictPairCovered === null ? null : Number(row.conflictPairCovered),
    ),
    noAnswerAccuracy: mean((row) => (row.noAnswerPass === null ? null : Number(row.noAnswerPass))),
    forbiddenTop1Rate: mean((row) =>
      row.forbiddenTop1 === null ? null : Number(row.forbiddenTop1),
    ),
  };
}

export function latencySummary(samplesMs) {
  const samples = samplesMs.filter((value) => Number.isFinite(value));
  if (samples.length === 0) return { count: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    meanMs: total / samples.length,
    p50Ms: quantile(samples, 0.5),
    p95Ms: quantile(samples, 0.95),
    maxMs: Math.max(...samples),
  };
}

export function quantile(samples, fraction) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

// 결과 순서에서 처음 등장한 path만 관련도로 세고, 같은 path 반복으로 점수를 올리지 못하게 한다.
function rankResults(results, k) {
  const seen = new Set();
  const ranked = [];
  for (const result of results) {
    if (seen.has(result.path)) continue;
    seen.add(result.path);
    ranked.push(result);
    if (ranked.length >= k) break;
  }
  return ranked;
}

function binaryNdcg(ranked, goldPaths) {
  if (goldPaths.length === 0) return null;
  let dcg = 0;
  ranked.slice(0, 10).forEach((result, index) => {
    if (goldPaths.includes(result.path)) dcg += 1 / Math.log2(index + 2);
  });
  let idcg = 0;
  for (let index = 0; index < Math.min(goldPaths.length, 10); index += 1)
    idcg += 1 / Math.log2(index + 2);
  return idcg === 0 ? null : dcg / idcg;
}

function overlapsPassage(result, passage) {
  if (!Number.isInteger(result.startLine) || !Number.isInteger(result.endLine)) return false;
  return result.startLine <= passage.endLine && passage.startLine <= result.endLine;
}
