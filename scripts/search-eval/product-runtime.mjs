// 메모리 번들 진입점: 검색 계산은 실제 제품 TS/Rust가 수행합니다.
import { TFile } from 'obsidian';
import { IndexedDbBM25Index } from '../../src/rag/bm25.ts';
import { RAGQueryEngine } from '../../src/rag/query.ts';
import { buildSourceDocuments } from '../../src/rag/source-document.ts';
import { IndexedDbDocumentCorpusStore } from '../../src/rag/document-corpus-store.ts';
import { prepareSourceBytesRust } from '../../src/rag/rust-core.ts';
import { createContentHash } from '../../src/rag/hash.ts';
import { collectIndexedSearchSource, createVaultSourceReader } from '../../src/search/indexed-search-deps.ts';
import { getRagCandidateFiles } from '../../src/utils/vault.ts';
import { reviewIndexedVault } from '../../src/agent/indexed-vault-review.ts';
import { appLogger } from '../../src/utils/logger.ts';
import { XLSX_WORKER_SOURCE } from '../../.local/generated/xlsx-worker-source';
import { PDF_WORKER_ASSETS } from '../../.local/generated/pdf-worker-assets';

export { createContentHash, collectIndexedSearchSource };

export function getQualityWorkerPolicy() {
  return { source: XLSX_WORKER_SOURCE, pdf: PDF_WORKER_ASSETS.find((asset) => asset.file === 'pdf-worker.js') };
}

export function createEngineOnlyVaultHost(app, plugin, lease) {
  appLogger.configure({ mirrorToConsole: false, minLevel: 'fatal' });
  const getCandidatePaths = async () => (await getRagCandidateFiles(app.vault, plugin.settings.rag, plugin.settings.chat)).map((file) => file.path);
  return { app, ragEngine: lease.ragEngine, documentCorpus: lease.documentCorpus, getCandidatePaths,
    acquireSnapshot: () => ({ ...lease, release: () => {} }),
  };
}
export async function readOracleDocuments(host, lease) {
  const allowed = new Set(await host.getCandidatePaths());
  const paths = (await lease.documentCorpus.getIndexedFilePaths()).filter((path) => allowed.has(path));
  const reader = createVaultSourceReader(host.app, true, lease.chunkConfig);
  const documents = [];
  for (const path of paths) {
    const source = await reader(path);
    if (source.text === null) throw new Error('quality-source-unavailable');
    documents.push({ path, text: source.text, revision: source.revision, contentHash: source.contentHash });
  }
  return documents;
}
export async function createSyntheticProduct(documents, ledger) {
  appLogger.configure({ mirrorToConsole: false, minLevel: 'fatal' });
  const files = new Map(), texts = new Map(), revisions = new Map();
  const documentCorpus = new IndexedDbDocumentCorpusStore(`quality-corpus-${crypto.randomUUID()}`);
  const chunkConfig = { chunkSize: 1200, overlap: 0 };
  const bm25 = new IndexedDbBM25Index(`quality-loop-${Date.now()}-${Math.random()}`);
  await bm25.load();
  for (const document of documents) {
    const name = document.path.split('/').at(-1);
    const file = Object.assign(new TFile(), { path: document.path, name, basename: name.slice(0, -3), extension: 'md', stat: { mtime: 1, ctime: 1, size: new TextEncoder().encode(document.text).length } });
    files.set(file.path, file); texts.set(file.path, document.text);
    const source = prepareSourceBytesRust('md', new TextEncoder().encode(document.text), { path: file.path, ...chunkConfig });
    const prepared = source?.prepared;
    if (!source?.ok || !prepared?.bodyPlan) throw new Error('quality-source-preparation-unavailable');
    const chunks = buildSourceDocuments(file, source.text, chunkConfig, source.segments, undefined, prepared.chunks, prepared.contentHash);
    bm25.replaceSourceDocuments(file.path, chunks);
    const revision = { sourceMtime: 1, sourceSize: file.stat.size, contentHash: prepared.contentHash };
    await documentCorpus.replaceBatchFileDocuments([{ filePath: file.path, documents: chunks, sourceRevision: revision,
      sourceMetadata: { segments: source.segments }, sourceMetadataHash: prepared.sourceMetadataHash, sourceBody: { text: source.text, plan: prepared.bodyPlan } }]);
    revisions.set(file.path, { ...revision, sourceMetadataHash: prepared.sourceMetadataHash, verified: true });
  }
  await bm25.flush();
  if (documents.length === 0) await documentCorpus.initializeEmptyDurabilityReceipt();
  let allowed = documents.filter((doc) => !doc.path.startsWith('excluded/')).map((doc) => doc.path);
  const app = { vault: {
    getAbstractFileByPath: (path) => files.get(path) ?? null,
    readBinary: async (file) => new TextEncoder().encode(texts.get(file.path)).buffer,
    adapter: { stat: async (path) => files.get(path)?.stat ?? null },
  }, metadataCache: { getFileCache: () => ({}) } };
  let closed = false, epoch = 0;
  const literalInventorySource = { corpus: documentCorpus, captureScope: () => {
    const capturedEpoch = epoch;
    return Promise.resolve({ generationId: 'synthetic-generation', sources: new Map(allowed.map((path) => [path, revisions.get(path) ?? { sourceMtime: 0, sourceSize: 0, contentHash: '', sourceMetadataHash: '', verified: false }])), isCurrent: () => !closed && capturedEpoch === epoch });
  } };
  const ragEngine = new RAGQueryEngine(null, null, bm25, undefined, 0, { corpusStore: documentCorpus, literalInventorySource, getCandidatePaths: async () => new Set(allowed) });
  const host = { app, ragEngine, documentCorpus, getCandidatePaths: async () => allowed,
    acquireSnapshot: () => ({ ragEngine, documentCorpus, chunkConfig, release: () => { ledger.releases++; } }),
  };
  return { host, texts, files, setAllowed: (paths) => { allowed = paths; epoch++; }, close: () => { closed = true; bm25.close(); documentCorpus.close(); } };
}

export async function runProductCase(host, testCase, ledger, signal, consume) {
  appLogger.configure({ mirrorToConsole: false, minLevel: 'fatal' });
  const source = await collectIndexedSearchSource(host, testCase.question, signal);
  if (!source) throw new Error('quality-source-unavailable');
  try {
    const paths = await source.getIndexedPaths();
    const result = await reviewIndexedVault({
      ...source, question: testCase.question, indexedPaths: source.reviewPaths ?? paths,
      discoveryPaths: paths, scopes: [], documentScope: 'all', executionMode: 'engine-only', signal,
      getFollowupPaths: host.getCandidatePaths ?? source.getIndexedPaths,
      provider: { streamChat: async () => { ledger.provider++; throw new Error('quality-model-blocked'); } },
      onProgress: () => {},
    });
    const currentAllowed = host.getCandidatePaths ? new Set(await host.getCandidatePaths()) : new Set(paths);
    if (paths.some((path) => !currentAllowed.has(path))) throw new Error('quality-policy-changed');
    // 내부 catch가 sentinel을 흡수해도 최종 원장을 반드시 검사합니다.
    if (ledger.provider || ledger.embedding || ledger.network) throw new Error('quality-attempt-blocked');
    const value = { source, result };
    await consume?.(value);
    signal?.throwIfAborted();
    if (ledger.provider || ledger.embedding || ledger.network) throw new Error('quality-attempt-blocked');
    return value;
  } finally { await source.release?.(); }
}
