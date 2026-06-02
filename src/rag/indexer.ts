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
import { JsonFileBM25Index } from './bm25';
import { createContentHash } from './hash';
import type { PerformanceGuardState } from './performance-guard';

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

export interface Chunk {
  text: string;
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    endLine: number;
  };
}

interface TextSegment {
  text: string;
  startLine: number;
  endLine: number;
}

function splitTextToSegments(text: string, initialLine: number, maxChunkSize: number): TextSegment[] {
  const maxSize = Math.max(1, Math.floor(maxChunkSize));
  const lines = text.split('\n');
  const segments: TextSegment[] = [];
  let currentLines: string[] = [];
  let currentStartLine = initialLine;
  let currentLength = 0;

  const flush = (endLine: number): void => {
    const segmentText = currentLines.join('\n').trim();
    if (segmentText) {
      segments.push({
        text: segmentText,
        startLine: currentStartLine,
        endLine,
      });
    }
    currentLines = [];
    currentLength = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = initialLine + i;

    if (line.length > maxSize) {
      flush(lineNumber - 1);
      for (let offset = 0; offset < line.length; offset += maxSize) {
        const piece = line.slice(offset, offset + maxSize).trim();
        if (!piece) continue;
        segments.push({
          text: piece,
          startLine: lineNumber,
          endLine: lineNumber,
        });
      }
      currentStartLine = lineNumber + 1;
      continue;
    }

    const nextLength = currentLines.length === 0 ? line.length : currentLength + 1 + line.length;
    if (currentLines.length > 0 && nextLength > maxSize) {
      flush(lineNumber - 1);
      currentStartLine = lineNumber;
    }

    currentLines.push(line);
    currentLength = currentLines.length === 1 ? line.length : currentLength + 1 + line.length;
  }

  if (currentLines.length > 0) {
    flush(initialLine + lines.length - 1);
  }

  return segments;
}

function enforceChunkSize(chunks: Chunk[], maxChunkSize: number): Chunk[] {
  return chunks.flatMap((chunk) => {
    if (chunk.text.length <= maxChunkSize) return [chunk];
    return splitTextToSegments(chunk.text, chunk.metadata.startLine, maxChunkSize).map((segment) => ({
      ...chunk,
      text: segment.text,
      metadata: {
        ...chunk.metadata,
        startLine: segment.startLine,
        endLine: segment.endLine,
      },
    }));
  });
}

function getTrailingOverlap(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text.trim();

  const tail = text.slice(-maxChars);
  const firstNewline = tail.indexOf('\n');
  if (firstNewline > 0 && firstNewline < tail.length - 1) {
    return tail.slice(firstNewline + 1).trim();
  }
  return tail.trim();
}

function applyLineOverlap(chunks: Chunk[], overlapChars: number, maxChunkSize: number): Chunk[] {
  if (overlapChars <= 0 || chunks.length <= 1) return chunks;

  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const previous = chunks[index - 1];
    const maxOverlapChars = Math.min(overlapChars, maxChunkSize - chunk.text.length - 1);
    const overlapText = getTrailingOverlap(previous.text, maxOverlapChars);
    if (!overlapText) return chunk;

    const overlapLineCount = overlapText.split('\n').length;
    const startLine = Math.max(previous.metadata.startLine, chunk.metadata.startLine - overlapLineCount);
    return {
      ...chunk,
      text: `${overlapText}\n${chunk.text}`.trim(),
      metadata: {
        ...chunk.metadata,
        startLine,
      },
    };
  });
}

function finalizeChunks(chunks: Chunk[], maxChunkSize: number, overlapChars: number): Chunk[] {
  const sizedChunks = enforceChunkSize(chunks, maxChunkSize);
  return applyLineOverlap(sizedChunks, overlapChars, maxChunkSize);
}

/** 마크다운을 헤딩/코드블록/단락을 존중하며 청킹합니다. */
export function chunkMarkdown(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentHeading: string | undefined;
  let startLine = 0;
  let inCodeBlock = false;

  const flush = (endLine: number) => {
    const text = currentLines.join('\n').trim();
    if (!text) return;
    chunks.push({
      text,
      metadata: {
        filePath: '',
        heading: currentHeading,
        startLine,
        endLine,
      },
    });
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      if (!inCodeBlock) {
        const chunkText = currentLines.join('\n');
        if (chunkText.length > maxChunkSize) {
          flush(i);
          startLine = i + 1;
        }
      }
      continue;
    }

    if (!inCodeBlock && line.startsWith('#')) {
      if (currentLines.length > 0) {
        flush(i - 1);
      }
      currentHeading = line.replace(/^#+\s*/, '').trim();
      startLine = i;
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
    const chunkText = currentLines.join('\n');

    if (!inCodeBlock && chunkText.length >= maxChunkSize) {
      const lastParaBreak = chunkText.lastIndexOf('\n\n');
      if (lastParaBreak > maxChunkSize * 0.5) {
        const splitIdx = currentLines.findIndex((_, idx) => {
          const partial = currentLines.slice(0, idx + 1).join('\n');
          return partial.length >= lastParaBreak;
        });
        if (splitIdx !== -1) {
          const part = currentLines.slice(0, splitIdx + 1);
          const rest = currentLines.slice(splitIdx + 1);
          currentLines = part;
          flush(i);
          currentLines = rest;
          startLine = i - rest.length + 1;
        } else {
          flush(i);
          startLine = i + 1;
        }
      } else {
        flush(i);
        startLine = i + 1;
      }
    }
  }

  if (currentLines.length > 0) {
    flush(lines.length - 1);
  }

  return finalizeChunks(chunks, maxChunkSize, overlapChars);
}

/** 일반 텍스트와 코드 파일을 줄 경계를 우선해 청킹합니다. */
export function chunkPlainText(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let startLine = 0;

  const flush = (endLine: number): void => {
    const text = currentLines.join('\n').trim();
    if (!text) return;
    chunks.push({
      text,
      metadata: {
        filePath: '',
        startLine,
        endLine,
      },
    });
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    currentLines.push(lines[i]);
    const chunkText = currentLines.join('\n');
    if (chunkText.length < maxChunkSize) continue;

    const lastBlankLine = currentLines
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.trim() === '')
      .at(-1)?.index;

    if (lastBlankLine !== undefined && lastBlankLine > 0) {
      const part = currentLines.slice(0, lastBlankLine + 1);
      const rest = currentLines.slice(lastBlankLine + 1);
      currentLines = part;
      flush(i - rest.length);
      currentLines = rest;
      startLine = i - rest.length + 1;
      continue;
    }

    flush(i);
    startLine = i + 1;
  }

  if (currentLines.length > 0) {
    flush(lines.length - 1);
  }

  return finalizeChunks(chunks, maxChunkSize, overlapChars);
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

  constructor(
    vault: Vault,
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    ragConfig: RAGConfig,
    chatConfig: ChatConfig,
    private bm25Index?: JsonFileBM25Index,
  ) {
    this.chatConfig = chatConfig;
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.ragConfig = ragConfig;
  }

  async indexVault(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);

    const result = await this.vectorStore.withBatch(async () => {
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

  async indexFile(file: TFile, options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
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
      return finishIndexingResult(
        { indexed: 0, vectors: 0, skipped: 1, documents: [file.path] },
        startedAt,
        options,
      );
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

    return finishIndexingResult(
      { indexed: 1, vectors: entries.length, skipped: 0, documents: [file.path] },
      startedAt,
      options,
    );
  }

  async reindexAll(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startedAt = performance.now();
    throwIfIndexingCancelled(options.signal);
    const result = await this.vectorStore.withBatch(async () => {
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
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const status = await calculateRagStatus(
      this.vault,
      this.vectorStore,
      this.ragConfig,
      this.chatConfig, options.signal,
    );
    throwIfIndexingCancelled(options.signal);
    const updatePaths = new Set(status.updateRequiredDocuments.map((document) => document.path));

    const result = await this.vectorStore.withBatch(async () => {
      const batchResult = createEmptyIndexingResult(startedAt);
      for (let i = 0; i < files.length; i++) {
        throwIfIndexingCancelled(options.signal);
        const file = files[i];
        if (!updatePaths.has(file.path)) {
          batchResult.skipped++;
          continue;
        }
        const targetFile = filesByPath.get(file.path);
        if (!targetFile) {
          batchResult.skipped++;
          continue;
        }
        const fileResult = await this.indexFile(targetFile, options);
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
      const batchVectors = await this.embeddingProvider.embedBatch(batch, { signal: options.signal });
      expectedDimension = assertValidEmbeddingBatch(
        batchVectors,
        batch.length,
        'Embedding batch',
        expectedDimension,
      );
      const durationMs = performance.now() - startedAt;
      options.onBatchComplete?.(durationMs);
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
  indexer: { indexFile(file: TFile): Promise<unknown> },
  excludePaths: string[],
  excludeExts: string[],
  onComplete?: (file: TFile) => void,
): () => void {
  const ref = vault.on('modify', async (file) => {
    if (!(file instanceof Object)) return;
    if (!('path' in file)) return;
    const f = file as TFile;
    if (!(await shouldIndexRagFile(vault, f, excludePaths, excludeExts))) return;
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
