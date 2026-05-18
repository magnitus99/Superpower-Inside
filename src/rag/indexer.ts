import type { TFile, Vault } from 'obsidian';
import type { EmbeddingProvider } from '../llm/embedding';
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

export class IndexingCancelledError extends Error {
  constructor() {
    super('RAG indexing cancelled');
    this.name = 'IndexingCancelledError';
  }
}

export interface IndexingOptions {
  signal?: AbortSignal;
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

export interface Chunk {
  text: string;
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    endLine: number;
  };
}

function applyLineOverlap(chunks: Chunk[], lines: string[], overlapChars: number): Chunk[] {
  if (overlapChars <= 0 || chunks.length <= 1) return chunks;

  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const previous = chunks[index - 1];
    const overlapLines: string[] = [];
    let total = 0;
    for (let line = previous.metadata.endLine; line >= previous.metadata.startLine; line--) {
      const text = lines[line] ?? '';
      overlapLines.unshift(text);
      total += text.length + 1;
      if (total >= overlapChars) break;
    }
    if (overlapLines.length === 0) return chunk;
    const startLine = Math.max(
      previous.metadata.startLine,
      chunk.metadata.startLine - overlapLines.length,
    );
    return {
      ...chunk,
      text: `${overlapLines.join('\n')}\n${chunk.text}`.trim(),
      metadata: {
        ...chunk.metadata,
        startLine,
      },
    };
  });
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

  return applyLineOverlap(chunks, lines, overlapChars);
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

  return applyLineOverlap(chunks, lines, overlapChars);
}

function buildSearchText(file: TFile, chunk: Chunk): string {
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

  async indexVault(options: IndexingOptions = {}): Promise<number> {
    throwIfIndexingCancelled(options.signal);
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);

    let indexed = 0;
    for (const file of files) {
      throwIfIndexingCancelled(options.signal);
      await this.indexFile(file, options);
      throwIfIndexingCancelled(options.signal);
      indexed++;
    }
    return indexed;
  }

  async indexFile(file: TFile, options: IndexingOptions = {}): Promise<void> {
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
      throwIfIndexingCancelled(options.signal);
      return;
    }

    const texts = chunks.map((chunk) => buildSearchText(file, chunk));
    const vectors = await this.embeddingProvider.embedBatch(texts, { signal: options.signal });
    throwIfIndexingCancelled(options.signal);

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id: `${file.path}::${chunk.metadata.startLine}`,
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

    await this.vectorStore.removeByFilePath(file.path);
    throwIfIndexingCancelled(options.signal);
    await this.vectorStore.add(entries);
    throwIfIndexingCancelled(options.signal);

    if (this.bm25Index) {
      this.bm25Index.removeDocument(file.path);
      if (content.trim()) {
        this.bm25Index.addDocument(file.path, content);
        await this.bm25Index.persist();
        throwIfIndexingCancelled(options.signal);
      }
    }
  }

  async reindexAll(options: IndexingOptions = {}): Promise<number> {
    throwIfIndexingCancelled(options.signal);
    await this.vectorStore.clear();
    throwIfIndexingCancelled(options.signal);
    return this.indexVault(options);
  }

  async indexPending(
    options: IndexingOptions = {},
  ): Promise<{ indexed: number; skipped: number; documents: string[] }> {
    throwIfIndexingCancelled(options.signal);
    const files = await getRagCandidateFiles(this.vault, this.ragConfig, this.chatConfig);
    throwIfIndexingCancelled(options.signal);
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const status = await calculateRagStatus(
      this.vault,
      this.vectorStore,
      this.ragConfig,
      this.chatConfig,
    );
    throwIfIndexingCancelled(options.signal);
    const updatePaths = new Set(status.updateRequiredDocuments.map((document) => document.path));

    let indexed = 0;
    let skipped = 0;
    const documents: string[] = [];

    for (const file of files) {
      throwIfIndexingCancelled(options.signal);
      if (!updatePaths.has(file.path)) {
        skipped++;
        continue;
      }
      const targetFile = filesByPath.get(file.path);
      if (!targetFile) {
        skipped++;
        continue;
      }
      await this.indexFile(targetFile, options);
      throwIfIndexingCancelled(options.signal);
      indexed++;
      documents.push(file.path);
    }

    return { indexed, skipped, documents };
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
  indexer: VaultIndexer,
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
  vectorStore: VectorStore,
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
  indexer: VaultIndexer,
  vectorStore: VectorStore,
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
