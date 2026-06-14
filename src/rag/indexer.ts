import type { TFile, Vault } from 'obsidian';
import type { EmbeddingProvider } from '../llm/embedding';
import { assertValidEmbeddingBatch } from '../llm/embedding-validation';
import type { VectorStore, VectorEntry } from './store';
import {
  getRagCandidateFiles,
  isExcludedPath,
  isExcludedExt,
  isRagIndexableFile,
} from '../utils/vault';
import type { RAGConfig, ChatConfig } from '../settings';
import { calculateRagStatus } from './status';
import type { IndexedDbBM25Index } from './bm25';
import { createContentHash } from './hash';
import { chunkMarkdownRust, chunkPlainTextRust, planIndexPendingFilesRust } from './rust-core';
import type { PerformanceGuardState } from './performance-guard';
import { appLogger, type AppLogger, type ScopedLogger } from '../utils/logger';
import { normalizeRustIndices } from '../utils/rust-index-plan';

export class IndexingCancelledError extends Error {
  constructor() {
    super('RAG indexing cancelled');
    this.name = 'IndexingCancelledError';
  }
}

export interface IndexingOptions {
  signal?: AbortSignal;
  maxEmbeddingBatchSize?: number;
  indexingYieldMs?: number;
  onBatchComplete?: (durationMs: number) => void;
  getPerformanceGuardState?: () => PerformanceGuardState | null;
}

export interface IndexingResult {
  indexed: number;
  vectors: number;
  skipped: number;
  documents: string[];
  durationMs: number;
  guardState?: PerformanceGuardState | null;
}

export function isIndexingCancelledError(error: unknown): boolean {
  return (
    error instanceof IndexingCancelledError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

function throwIfIndexingCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new IndexingCancelledError();
  }
}

function createEmptyIndexingResult(startedAt: number): IndexingResult {
  return {
    indexed: 0,
    vectors: 0,
    skipped: 0,
    documents: [],
    durationMs: performance.now() - startedAt,
  };
}

function finishIndexingResult(
  result: Omit<IndexingResult, 'durationMs' | 'guardState'>,
  startedAt: number,
  options: IndexingOptions,
): IndexingResult {
  return {
    ...result,
    durationMs: performance.now() - startedAt,
    guardState: options.getPerformanceGuardState?.() ?? null,
  };
}

async function pauseAfterBatch(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new IndexingCancelledError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildPendingPlanFromUpdatePaths(
  filePaths: readonly string[],
  updatePaths: readonly string[],
): { fileIndices: number[]; skipped: number } {
  const updatePathSet = new Set(updatePaths);
  const fileIndices: number[] = [];
  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    if (filePath !== undefined && updatePathSet.has(filePath)) {
      fileIndices.push(index);
    }
  }
  return {
    fileIndices,
    skipped: Math.max(filePaths.length - fileIndices.length, 0),
  };
}

export interface Chunk {
  text: string;
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    endLine: number;
  };
}

/** 마크다운을 헤딩/코드블록/단락을 존중하며 청킹합니다. */
export function chunkMarkdown(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const rustChunks = chunkMarkdownRust(content, maxChunkSize, overlapChars);
  return rustChunks ?? [];
}

/** 일반 텍스트와 코드 파일을 줄 경계를 우선해 청킹합니다. */
export function chunkPlainText(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const rustChunks = chunkPlainTextRust(content, maxChunkSize, overlapChars);
  return rustChunks ?? [];
}

export function buildSearchText(file: TFile, chunk: Chunk): string {
  const hints = [`File: ${file.path}`, `Title: ${file.basename}`];
  if (chunk.metadata.heading) {
    hints.push(`Heading: ${chunk.metadata.heading}`);
  }
  return `${hints.join('\n')}\n\n${chunk.text}`;
}

/** 볼트 인덱서 */
export class VaultIndexer {
  private vault: Vault;
  private vectorStore: VectorStore;
  private embeddingProvider: EmbeddingProvider;
  private ragConfig: RAGConfig;
  private chatConfig: ChatConfig;
  private logger: ScopedLogger;

  constructor(
    vault: Vault,
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    ragConfig: RAGConfig,
    chatConfig: ChatConfig,
    private bm25Index?: IndexedDbBM25Index,
    logger?: AppLogger | ScopedLogger,
  ) {
    this.chatConfig = chatConfig;
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.ragConfig = ragConfig;
    this.logger = createScopedIndexerLogger(logger);
  }

  async indexVault(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    this.logger.info('Vault indexing started.', { data: { fileCount: files.length } });

    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      for (let i = 0; i < files.length; i++) {
        throwIfIndexingCancelled(options.signal);
        const file = files[i];
        const fileResult = await this.indexFile(file, options);
        throwIfIndexingCancelled(options.signal);
        batchResult.indexed += fileResult.indexed;
        batchResult.vectors += fileResult.vectors;
        batchResult.skipped += fileResult.skipped;
        batchResult.documents.push(...fileResult.documents);
        if (i > 0 && i % 5 === 0) {
          await pauseAfterBatch(0, options.signal).catch(() => {});
        }
      }
      return batchResult;
    });
    const finished = finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
    this.logger.notice('Vault indexing completed.', {
      data: {
        indexed: finished.indexed,
        vectors: finished.vectors,
        skipped: finished.skipped,
        durationMs: Math.round(finished.durationMs),
      },
    });
    return finished;
  }

  async indexFile(file: TFile, options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    this.logger.debug('File indexing started.', {
      data: { path: file.path, size: file.stat.size },
    });
    const content = await this.vault.cachedRead(file);
    throwIfIndexingCancelled(options.signal);
    const sourceHash = createContentHash(content);
    const indexedAt = Date.now();
    const chunks =
      file.extension.toLowerCase() === 'md'
        ? chunkMarkdown(content, this.ragConfig.chunkSize, this.ragConfig.overlap)
        : chunkPlainText(content, this.ragConfig.chunkSize, this.ragConfig.overlap);
    throwIfIndexingCancelled(options.signal);
    if (chunks.length === 0) {
      await this.vectorStore.removeByFilePath(file.path);
      if (this.bm25Index) {
        this.bm25Index.removeDocumentsBySource(file.path);
        await this.bm25Index.persist();
      }
      throwIfIndexingCancelled(options.signal);
      const skipped = finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
      this.logger.debug('File indexing skipped because no chunks were produced.', {
        data: { path: file.path },
      });
      return skipped;
    }

    const texts = chunks.map((chunk) => buildSearchText(file, chunk));
    const vectors = await this.embedTextsInBatches(texts, options);
    throwIfIndexingCancelled(options.signal);

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id: `${file.path}::${chunk.metadata.startLine}::${i}`,
      vector: vectors[i],
      metadata: {
        filePath: file.path,
        heading: chunk.metadata.heading,
        startLine: chunk.metadata.startLine,
        endLine: chunk.metadata.endLine,
        text: texts[i],
        sourceMtime: file.stat.mtime,
        sourceSize: file.stat.size,
        contentHash: sourceHash,
        indexedAt,
        embeddingProvider: this.ragConfig.embeddingProvider,
        embeddingModel: this.ragConfig.embeddingModel,
      },
    }));

    await this.vectorStore.replaceFileEntries(file.path, entries);
    throwIfIndexingCancelled(options.signal);

    if (this.bm25Index) {
      this.bm25Index.removeDocumentsBySource(file.path);
      for (const entry of entries) {
        this.bm25Index.addDocument(entry.id, entry.metadata.text, file.path);
      }
      await this.bm25Index.persist();
      throwIfIndexingCancelled(options.signal);
    }

    const finished = finishIndexingResult(
      { indexed: 1, vectors: entries.length, skipped: 0, documents: [file.path] },
      startedAt,
      options,
    );
    this.logger.debug('File indexing completed.', {
      data: {
        path: file.path,
        chunks: chunks.length,
        vectors: entries.length,
        durationMs: Math.round(finished.durationMs),
      },
    });
    return finished;
  }

  async reindexAll(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const result = await this.withIndexBatch(async () => {
      await this.vectorStore.clear();
      if (this.bm25Index) {
        await this.bm25Index.clear();
      }
      throwIfIndexingCancelled(options.signal);
      return this.indexVault(options);
    });
    return finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
  }

  async removeFile(filePath: string): Promise<number> {
    const removed = await this.vectorStore.removeByFilePath(filePath);
    if (this.bm25Index) {
      this.bm25Index.removeDocumentsBySource(filePath);
      await this.bm25Index.persist();
    }
    return removed;
  }

  async indexPending(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    const status = await calculateRagStatus(
      this.vault,
      this.vectorStore,
      this.ragConfig,
      this.chatConfig,
      options.signal,
    );
    throwIfIndexingCancelled(options.signal);
    const candidatePaths = files.map((file) => file.path);
    const requiredPaths = status.updateRequiredDocuments.map((document) => document.path);
    const pendingPlan =
      planIndexPendingFilesRust(candidatePaths, requiredPaths) ??
      buildPendingPlanFromUpdatePaths(candidatePaths, requiredPaths);

    const normalizedPendingPlanFileIndices = normalizeRustIndices(
      [...new Set(pendingPlan.fileIndices)],
      files.length,
      {
        dedupe: true,
      },
    );
    const normalizedPendingPlan = {
      fileIndices: normalizedPendingPlanFileIndices,
      skipped: Math.max(candidatePaths.length - normalizedPendingPlanFileIndices.length, 0),
    };

    const result = await this.withIndexBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      batchResult.skipped = normalizedPendingPlan.skipped;
      for (let i = 0; i < normalizedPendingPlan.fileIndices.length; i++) {
        throwIfIndexingCancelled(options.signal);
        const file = files[normalizedPendingPlan.fileIndices[i]];
        if (!file) {
          batchResult.skipped += 1;
          continue;
        }
        const fileResult = await this.indexFile(file, options);
        throwIfIndexingCancelled(options.signal);
        batchResult.indexed += fileResult.indexed;
        batchResult.vectors += fileResult.vectors;
        batchResult.skipped += fileResult.skipped;
        batchResult.documents.push(...fileResult.documents);
        if (i > 0 && i % 5 === 0) {
          await pauseAfterBatch(0, options.signal).catch(() => {});
        }
      }
      return batchResult;
    });

    return finishIndexingResult(
      {
        indexed: result.indexed,
        vectors: result.vectors,
        skipped: result.skipped,
        documents: result.documents,
      },
      startedAt,
      options,
    );
  }

  private async embedTextsInBatches(
    texts: string[],
    options: IndexingOptions,
  ): Promise<number[][]> {
    const batchSize = Math.max(1, Math.floor(options.maxEmbeddingBatchSize ?? texts.length));
    const vectors: number[][] = [];
    let expectedDimension: number | undefined;

    for (let offset = 0; offset < texts.length; offset += batchSize) {
      throwIfIndexingCancelled(options.signal);
      const batch = texts.slice(offset, offset + batchSize);
      const startedAt = performance.now();
      this.logger.trace('Embedding batch started.', {
        data: {
          offset,
          batchSize: batch.length,
          total: texts.length,
        },
      });
      const batchVectors = await this.embeddingProvider.embedBatch(batch, {
        signal: options.signal,
      });
      expectedDimension = assertValidEmbeddingBatch(
        batchVectors,
        batch.length,
        'Embedding batch',
        expectedDimension,
      );
      const durationMs = performance.now() - startedAt;
      options.onBatchComplete?.(durationMs);
      this.logger.trace('Embedding batch validated.', {
        data: {
          offset,
          batchSize: batch.length,
          durationMs: Math.round(durationMs),
          dimension: expectedDimension,
        },
      });
      if (options.getPerformanceGuardState?.()?.mode === 'paused') {
        throw new IndexingCancelledError();
      }
      vectors.push(...batchVectors);
      throwIfIndexingCancelled(options.signal);
      if (offset + batchSize < texts.length) {
        await pauseAfterBatch(options.indexingYieldMs ?? 0, options.signal);
      }
    }

    return vectors;
  }

  private async withIndexBatch<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.bm25Index) {
      return this.vectorStore.withBatch(operation);
    }
    return this.vectorStore.withBatch(() => this.bm25Index!.withBatch(operation));
  }
}

function createScopedIndexerLogger(logger: AppLogger | ScopedLogger | undefined): ScopedLogger {
  const candidate = logger ?? appLogger;
  return 'child' in candidate ? candidate.child('rag.indexer') : candidate;
}

function shouldConsiderRagPath(
  filePath: string,
  excludePaths: string[],
  excludeExts: string[],
): boolean {
  return !isExcludedPath(filePath, excludePaths) && !isExcludedExt(filePath, excludeExts);
}

async function shouldIndexRagFile(
  vault: Vault,
  file: TFile,
  excludePaths: string[],
  excludeExts: string[],
): Promise<boolean> {
  return (
    shouldConsiderRagPath(file.path, excludePaths, excludeExts) && isRagIndexableFile(vault, file)
  );
}

/** 파일 변경 이벤트를 등록하여 자동 재인덱싱합니다. */
export function registerModifyEvent(
  vault: Vault,
  indexer: {
    indexFile(file: TFile): Promise<unknown>;
    removeByFilePath?(filePath: string): Promise<number>;
  },
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (file: TFile) => void,
): () => void {
  const ref = vault.on('modify', async (file) => {
    if (!(file instanceof Object)) return;
    if (!('path' in file)) return;
    const f = file as TFile;
    if (!shouldConsiderRagPath(f.path, excludePaths, excludeExts)) return;
    if (!(await isRagIndexableFile(vault, f))) {
      const removed = await indexer.removeByFilePath?.(f.path);
      if (removed && removed > 0) {
        onComplete?.(f);
      }
      return;
    }
    await indexer.indexFile(f);
    onComplete?.(f);
  });
  return () => vault.offref(ref);
}

/** 파일 삭제 이벤트를 등록하여 벡터 저장소에서 해당 항목을 제거합니다. */
export function registerDeleteEvent(
  vault: Vault,
  vectorStore: Pick<VectorStore, 'removeByFilePath'>,
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (filePath: string) => void,
): () => void {
  const ref = vault.on('delete', async (file) => {
    if (!('path' in file)) return;
    const filePath = (file as { path: string }).path;
    if (!shouldConsiderRagPath(filePath, excludePaths, excludeExts)) return;
    const removed = await vectorStore.removeByFilePath(filePath);
    if (removed > 0) {
      onComplete?.(filePath);
    }
  });
  return () => vault.offref(ref);
}

/** 파일 이름 변경/이동 이벤트를 등록하여 기존 항목을 제거하고 새 경로로 재인덱싱합니다. */
export function registerRenameEvent(
  vault: Vault,
  indexer: { indexFile(file: TFile): Promise<unknown> },
  vectorStore: Pick<VectorStore, 'removeByFilePath'>,
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (oldPath: string, newPath: string) => void,
): () => void {
  const ref = vault.on('rename', async (file, oldPath) => {
    if (!(file instanceof Object) || !('path' in file)) return;
    const f = file as TFile;
    const newPath = f.path;
    const oldWasIndexable = shouldConsiderRagPath(oldPath, excludePaths, excludeExts);
    const newIsIndexable = await shouldIndexRagFile(vault, f, excludePaths, excludeExts);
    let changed = false;
    if (oldWasIndexable) {
      const removed = await vectorStore.removeByFilePath(oldPath);
      changed = removed > 0;
    }
    if (newIsIndexable) {
      await indexer.indexFile(f);
      changed = true;
    }
    if (changed) {
      onComplete?.(oldPath, newPath);
    }
  });
  return () => vault.offref(ref);
}
