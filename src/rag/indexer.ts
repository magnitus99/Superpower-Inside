import type { TFile, Vault } from 'obsidian';
import type { EmbeddingProvider } from '../llm/embedding';
import type { VectorStore, VectorEntry } from './store';
import { getMarkdownFilesFiltered, isExcluded, isExcludedExt } from '../utils/vault';
import type { RAGConfig } from '../settings';

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
export function chunkMarkdown(content: string, maxChunkSize: number): Chunk[] {
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

  return chunks;
}

/** 볼트 인덱서 */
export class VaultIndexer {
  private vault: Vault;
  private vectorStore: VectorStore;
  private embeddingProvider: EmbeddingProvider;
  private ragConfig: RAGConfig;

  constructor(
    vault: Vault,
    vectorStore: VectorStore,
    embeddingProvider: EmbeddingProvider,
    ragConfig: RAGConfig,
  ) {
    this.vault = vault;
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
    this.ragConfig = ragConfig;
  }

  async indexVault(): Promise<number> {
    const files = getMarkdownFilesFiltered(this.vault, [
      ...this.ragConfig.excludePaths,
    ]).filter((f) => !isExcludedExt(f.path, this.ragConfig.excludeExts));

    let indexed = 0;
    for (const file of files) {
      await this.indexFile(file);
      indexed++;
    }
    return indexed;
  }

  async indexFile(file: TFile): Promise<void> {
    const content = await this.vault.cachedRead(file);
    const chunks = chunkMarkdown(content, this.ragConfig.chunkSize);
    if (chunks.length === 0) return;

    const texts = chunks.map((c) => c.text);
    const vectors = await this.embeddingProvider.embedBatch(texts);

    const entries: VectorEntry[] = chunks.map((chunk, i) => ({
      id: `${file.path}::${chunk.metadata.startLine}`,
      vector: vectors[i],
      metadata: {
        filePath: file.path,
        heading: chunk.metadata.heading,
        startLine: chunk.metadata.startLine,
        text: chunk.text,
      },
    }));

    await this.vectorStore.add(entries);
  }

  async reindexAll(): Promise<number> {
    await this.vectorStore.clear();
    return this.indexVault();
  }

  async indexPending(): Promise<{ indexed: number; skipped: number }> {
    const files = getMarkdownFilesFiltered(this.vault, [
      ...this.ragConfig.excludePaths,
    ]).filter((f) => !isExcludedExt(f.path, this.ragConfig.excludeExts));

    const indexedPaths = await this.vectorStore.getIndexedFilePaths();
    const indexedSet = new Set(indexedPaths);

    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      if (indexedSet.has(file.path)) {
        skipped++;
        continue;
      }
      await this.indexFile(file);
      indexed++;
    }

    return { indexed, skipped };
  }
}

/** 파일 변경 이벤트를 등록하여 자동 재인덱싱합니다. */
export function registerModifyEvent(
  vault: Vault,
  indexer: VaultIndexer,
  onComplete?: (file: TFile) => void,
): () => void {
  const ref = vault.on('modify', async (file) => {
    if (!(file instanceof Object)) return;
    if (!('path' in file)) return;
    const f = file as TFile;
    if (isExcluded(f.path, []) || isExcludedExt(f.path, [])) return;
    if (!f.path.endsWith('.md')) return;
    await indexer.indexFile(f);
    onComplete?.(f);
  });
  return () => vault.offref(ref);
}
