// 검색 평가 어댑터. 어댑터 계약:
//   build(documents)            -> Promise<void>      (문서 {path,title,text,chunks}를 인덱스에 적재)
//   query(question, k)          -> Promise<results>   (results: {path,startLine,endLine,score,...} 절대 행 기준)
//   update({changedDocuments, removedPaths}) -> Promise<updateCounts>
//   stats()                     -> {chunkCount, bodyBytes, indexBytes, ...}
//   free()                      -> void
// 이 파일의 실행은 Node 단위 평가이며 제품 DB/IO end-to-end가 아니다.
// 제품 검색 통합 경로는 chatimpl의 searchIndexedVault(SearchPort)이고, 여기서는 그 전 단계
// (BM25 후보 추출 + 엔진 plan) 계약만 결정적으로 측정한다.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const SEARCH_EVAL_SCOPE = 'node-adapter-unit: BM25 WASM retrieval(+engine plan feature-detect), not product DB/IO end-to-end';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let tokenizerVersion = null;
const DOCUMENT_BATCH_SIZE = 128;

let wasmModulePromise = null;
let wasmInitialized = false;

export function loadGeneratedWasm() {
  wasmModulePromise ??= importGeneratedWasmModule();
  return wasmModulePromise;
}

export async function isEnginePlannerAvailable() {
  const module = await loadGeneratedWasm();
  return typeof module.plan_indexed_evidence_json === 'function';
}

export async function createSearchAdapter(name, options = {}) {
  if (name === 'baseline') return createBaselineAdapter(options);
  if (name === 'engine') return createEnginePlannerAdapter(options);
  throw new Error(`알 수 없는 어댑터: ${name}`);
}

// 기준선: 현재 제품 WASM의 BM25 runtime index를 그대로 사용한다.
export async function createBaselineAdapter(options = {}) {
  const module = await loadGeneratedWasm();
  initWasm(module);
  const index = new module.Bm25RuntimeIndex(tokenizerVersion);
  const chunksByPath = new Map();
  const chunkByDocId = new Map();
  let bodyBytes = 0;
  let indexBytes = null;
  return {
    name: 'baseline-bm25-wasm',
    sentence: '현재 generated WASM BM25 단일 단계',
    async build(documents) {
      chunksByPath.clear();
      chunkByDocId.clear();
      bodyBytes = 0;
      const batch = [];
      for (const document of documents) {
        bodyBytes += document.bytes;
        chunksByPath.set(document.path, document.chunks);
        for (const chunk of document.chunks) {
          const docId = chunkDocId(document.path, chunk.index);
          chunkByDocId.set(docId, { path: document.path, chunk });
          batch.push({
            id: docId,
            text: buildSearchText(document, chunk),
            sourcePath: document.path,
            ...documentFields(document, chunk.text),
          });
          if (batch.length === DOCUMENT_BATCH_SIZE) {
            flushBatch(index, batch);
          }
        }
      }
      flushBatch(index, batch);
      if (options.measureIndexBytes) indexBytes = Buffer.byteLength(index.to_json(), 'utf8');
    },
    async query(question, k) {
      return readTopHits(index, chunkByDocId, question, k);
    },
    async update({ changedDocuments = [], removedPaths = [] } = {}) {
      for (const removed of removedPaths) {
        index.remove_source(removed, tokenizerVersion);
        chunksByPath.delete(removed);
        for (const [docId, entry] of chunkByDocId)
          if (entry.path === removed) chunkByDocId.delete(docId);
      }
      for (const document of changedDocuments) {
        index.remove_source(document.path, tokenizerVersion);
        for (const [docId, entry] of chunkByDocId)
          if (entry.path === document.path) chunkByDocId.delete(docId);
        chunksByPath.set(document.path, document.chunks);
        const batch = [];
        for (const chunk of document.chunks) {
          const docId = chunkDocId(document.path, chunk.index);
          chunkByDocId.set(docId, { path: document.path, chunk });
          batch.push({
            id: docId,
            text: buildSearchText(document, chunk),
            sourcePath: document.path,
            ...documentFields(document, chunk.text),
          });
          if (batch.length === DOCUMENT_BATCH_SIZE) flushBatch(index, batch);
        }
        flushBatch(index, batch);
      }
      return { changedSources: changedDocuments.length, removedSources: removedPaths.length };
    },
    stats() {
      return {
        chunkCount: index.total_docs(),
        bodyBytes,
        indexBytes,
        plannerAvailable: null,
      };
    },
    free() {
      index.free();
    },
  };
}

// 후속: 스토리지/BM25 후보 위에 엔진 plan export를 얹는 하이브리드 단위 평가.
// plan/verify export가 generated WASM에 아직 없으면 query 시 명확히 실패한다.
export async function createEnginePlannerAdapter(options = {}) {
  const module = await loadGeneratedWasm();
  initWasm(module);
  if (typeof module.plan_indexed_evidence_json !== 'function')
    throw new Error(
      'engine plan export가 현재 generated WASM에 없습니다. engine rebuild 후 같은 데이터로 다시 실행하세요.',
    );
  const candidateLimit = options.candidateLimit ?? 64;
  const baseline = await createBaselineAdapter(options);
  const documentsByPath = new Map();
  return {
    name: 'engine-plan-bm25-candidates',
    sentence: 'BM25 후보 + engine plan(구절 결정) 하이브리드',
    async build(documents) {
      await baseline.build(documents);
      documentsByPath.clear();
      for (const document of documents) documentsByPath.set(document.path, document);
    },
    async query(question, k) {
      const candidates = await baseline.query(question, candidateLimit);
      const planInput = buildEnginePlanInput(question, candidates, documentsByPath, candidateLimit);
      const parsed = JSON.parse(module.plan_indexed_evidence_json(JSON.stringify(planInput)));
      const evidence = Array.isArray(parsed) ? parsed : (parsed.evidence ?? []);
      return evidence.slice(0, k).map((item, index) => ({
        path: item.path,
        startLine: item.startLine,
        endLine: item.endLine,
        score: item.score,
        rank: item.rank ?? index + 1,
        signal: item.signal,
        exactSignals: item.exactSignals,
        duplicateOf: item.duplicateOf,
      }));
    },
    async update(payload = {}) {
      const counts = await baseline.update(payload);
      for (const removed of payload.removedPaths ?? []) documentsByPath.delete(removed);
      for (const document of payload.changedDocuments ?? []) documentsByPath.set(document.path, document);
      return counts;
    },
    verifyEvidence(input) {
      const parsed = JSON.parse(module.verify_indexed_evidence_json(JSON.stringify(input)));
      return Array.isArray(parsed) ? parsed : (parsed.statuses ?? []);
    },
    stats() {
      return { ...baseline.stats(), plannerAvailable: true };
    },
    free() {
      baseline.free();
    },
  };
}

// 후보 청크는 신호로만 전달하고, 엔진에는 경로별 최신 전체 본문 하나를 전달한다.
export function buildEnginePlanInput(question, candidates, documentsByPath, candidateLimit) {
  const selected = [...new Set(candidates.map((candidate) => candidate.path))];
  const documents = selected.map((filePath) => {
    const document = documentsByPath.get(filePath);
    if (!document) throw new Error('후보의 합성 본문이 없습니다.');
    const lines = [];
    for (const chunk of document.chunks) {
      const chunkLines = chunk.text.split('\n');
      for (let index = 0; index < chunkLines.length; index++)
        lines[chunk.startLine - 1 + index] = chunkLines[index];
    }
    const text = lines.join('\n');
    return {
      ...documentFields(document, text),
      path: filePath,
      revision: createHash('sha256').update(text).digest('hex'),
      indexed: true, reviewState: 'reviewed', text, startLine: 1,
    };
  });
  return {
    question, documents,
    candidates: candidates.map((candidate, index) => ({
      path: candidate.path, source: 'bm25', rank: index + 1,
      score: candidate.score, startLine: candidate.startLine,
    })),
    inventory: {
      indexedCount: documentsByPath.size,
      unreviewedCount: documentsByPath.size - documents.length,
      notIndexedCount: 0,
    },
    scopes: [],
    filters: { pathPrefixes: [], extensions: [], tags: [], modifiedAfter: null },
    budget: { maxDocuments: candidateLimit, maxPassages: 12, maxChars: 262144 },
  };
}

function initWasm(module) {
  if (wasmInitialized) return;
  module.initSync({ module: readEmbeddedWasmBytes() });
  tokenizerVersion = module.tokenizer_version();
  wasmInitialized = true;
}

function readTopHits(index, chunkByDocId, question, k) {
  if (k < 1) return [];
  const parsed = JSON.parse(index.search_top_json(question, k));
  const results = [];
  for (const hit of parsed) {
    const entry = chunkByDocId.get(hit.docId);
    if (!entry) continue;
    results.push({
      path: entry.path,
      startLine: entry.chunk.startLine,
      endLine: entry.chunk.endLine,
      text: entry.chunk.text,
      score: hit.score,
    });
  }
  return results;
}

function flushBatch(index, batch) {
  if (batch.length === 0) return;
  const expected = batch.length;
  const added = index.add_documents_json(JSON.stringify(batch), tokenizerVersion, true);
  if (added !== expected) throw new Error('BM25 평가 문서 batch 검증에 실패했습니다.');
  batch.length = 0;
}

// 제품 add_document_fields_json/add_documents_json 계약과 같은 문서 필드 묶음을 만든다.
// title·headings가 없으면 파일명과 ATX 헤딩 줄에서 유도하고, tags는 배열일 때만 넘긴다.
function documentFields(document, text) {
  const fields = {
    path: document.path,
    title: documentTitle(document),
    headings: Array.isArray(document.headings) ? document.headings : atxHeadings(text),
  };
  if (Array.isArray(document.tags)) fields.tags = document.tags;
  return fields;
}

// 제품 getBM25DocumentFields와 같은 기본값: 제목이 없으면 확장자를 뺀 파일명을 쓴다.
function documentTitle(document) {
  const title = typeof document.title === 'string' ? document.title.trim() : '';
  if (title.length > 0) return title;
  const basename = path.basename(document.path);
  const extension = path.extname(basename);
  return extension.length > 0 ? basename.slice(0, -extension.length) : basename;
}

// ATX 헤딩(# …) 줄만 뽑는다. 펜스 코드 블록 안의 줄은 헤딩으로 보지 않는다.
function atxHeadings(text) {
  const headings = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^\s{0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!heading) continue;
    const title = (heading[1] ?? '').replace(/[ \t]+#+[ \t]*$/, '');
    if (title.length > 0) headings.push(title);
  }
  return headings;
}

function chunkDocId(filePath, chunkIndex) {
  return `${filePath}::${chunkIndex}`;
}

// 제품 buildSearchText와 같은 필드 힌트를 넣어 title/path 질의를 공정하게 평가한다.
function buildSearchText(document, chunk) {
  return `File: ${document.path}\nTitle: ${path.basename(document.path, '.md')}\n\n${chunk.text}`;
}

function readEmbeddedWasmBytes() {
  const source = readFileSync(path.join(repository, 'src/rag/rag-wasm-bytes.ts'), 'utf8');
  const chunks = [...source.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
  if (chunks.length === 0) throw new Error('embedded WASM base64 청크를 찾지 못했습니다.');
  return Buffer.from(chunks.join(''), 'base64');
}

async function importGeneratedWasmModule() {
  const sourcePath = path.join(repository, 'generated/rag-wasm/rag_wasm.js');
  const tempRoot = path.join(repository, 'node_modules/.cache/search-eval');
  execFileSync('git', ['check-ignore', '--quiet', path.join(tempRoot, 'probe')], { cwd: repository });
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(tempRoot, 'wasm-'));
  const modulePath = path.join(tempDir, 'rag_wasm.mjs');
  writeFileSync(modulePath, readFileSync(sourcePath, 'utf8'));
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
