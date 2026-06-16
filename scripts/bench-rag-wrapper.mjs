#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const {
  Bm25RuntimeIndex,
  IvfRuntimeIndex,
  VectorRuntimeIndex,
  chunk_markdown_json,
  initSync,
} = await importGeneratedWasmModule();
const wasmBytes = readEmbeddedWasmBytes(path.join(repoRoot, 'src/rag/rag-wasm-bytes.ts'));

initSync({ module: wasmBytes });

const PERFORMANCE_BUDGETS_MS = {
  vector_exact_query_bridge: 25,
  ivf_build_bridge: 250,
  ivf_query_bridge: 25,
  bm25_add_search_bridge: 250,
  bm25_persist_bridge: 75,
  markdown_chunk_2mb_bridge: 750,
};

const dimensions = 64;
const rowCount = 2048;
const vectors = fixtureVectors(rowCount, dimensions);
const query = fixtureQuery(dimensions);
const vectorIndex = new VectorRuntimeIndex(vectors, dimensions);
const ivfIndex = new IvfRuntimeIndex(vectors, dimensions, 32, 4);
const markdown = fixtureMarkdown2Mb();
const bm25PersistIndex = buildBm25Index(1000);

const results = [
  ['vector_exact_query_bridge', medianNs(60, () => vectorIndex.rank_top_k(query, 16))],
  ['ivf_build_bridge', medianNs(16, () => new IvfRuntimeIndex(vectors, dimensions, 32, 4).free())],
  ['ivf_query_bridge', medianNs(60, () => ivfIndex.query(query, 16, 4))],
  ['bm25_add_search_bridge', medianNs(16, () => {
    const index = buildBm25Index(1000);
    const result = index.search_json('alpha graph evidence');
    index.free();
    return result;
  })],
  ['bm25_persist_bridge', medianNs(30, () => bm25PersistIndex.to_json())],
  ['markdown_chunk_2mb_bridge', medianNs(16, () => chunk_markdown_json(markdown, 1200, 120))],
];

console.log('RAG wrapper benchmark (generated WASM bridge, median ns)');
for (const [name, median] of results) {
  const medianMs = Number(median) / 1_000_000;
  const budgetMs = PERFORMANCE_BUDGETS_MS[name];
  const status = budgetMs === undefined || medianMs <= budgetMs ? 'ok' : 'over-budget';
  console.log(`${name}: median_ns=${median} median_ms=${medianMs.toFixed(3)} budget_ms=${budgetMs ?? 'n/a'} status=${status}`);
  if (status === 'over-budget') {
    process.exitCode = 1;
  }
}

vectorIndex.free();
ivfIndex.free();
bm25PersistIndex.free();

function medianNs(sampleCount, operation) {
  const samples = [];
  for (let index = 0; index < Math.max(1, sampleCount); index++) {
    const startedAt = process.hrtime.bigint();
    const value = operation();
    consume(value);
    samples.push(process.hrtime.bigint() - startedAt);
  }
  samples.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return samples[Math.floor(samples.length / 2)]?.toString() ?? '0';
}

function readEmbeddedWasmBytes(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const chunks = [...source.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
  if (chunks.length === 0) {
    throw new Error(`embedded WASM base64 chunks not found: ${filePath}`);
  }
  return Buffer.from(chunks.join(''), 'base64');
}

async function importGeneratedWasmModule() {
  const sourcePath = path.join(repoRoot, 'generated/rag-wasm/rag_wasm.js');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'rag-wasm-bench-'));
  const modulePath = path.join(tempDir, 'rag_wasm.mjs');
  writeFileSync(modulePath, readFileSync(sourcePath, 'utf8'));
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function consume(value) {
  if (typeof value === 'number' && Number.isNaN(value)) {
    throw new Error('benchmark produced NaN');
  }
}

function fixtureVectors(rows, columns) {
  const values = new Float32Array(rows * columns);
  for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
      values[rowIndex * columns + columnIndex] = deterministicUnit(rowIndex * 131 + columnIndex * 17);
    }
  }
  return values;
}

function fixtureQuery(columns) {
  const values = new Float32Array(columns);
  for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
    values[columnIndex] = deterministicUnit(columnIndex * 29 + 7);
  }
  return values;
}

function deterministicUnit(seed) {
  return (seed % 1000) / 500 - 1;
}

function buildBm25Index(documentCount) {
  const index = new Bm25RuntimeIndex(2);
  for (let documentIndex = 0; documentIndex < documentCount; documentIndex++) {
    const group = documentIndex % 17;
    index.add_document(
      `doc-${documentIndex}.md::0`,
      `alpha beta graph rag evidence group-${group} doc-${documentIndex}`,
      `doc-${documentIndex}.md`,
      2,
    );
  }
  return index;
}

function fixtureMarkdown2Mb() {
  const segment = [
    '# Heading',
    'alpha beta graph rag evidence paragraph.',
    '',
    'beta gamma delta with korean 요고49 포인트 페이백 tokens.',
    '',
    '```ts',
    'const value = 42;',
    '```',
    '',
  ].join('\n');
  let markdown = '';
  while (markdown.length < 2_000_000) {
    markdown += segment;
  }
  return markdown;
}
