import type { TFile } from 'obsidian';
import type { RAGConfig } from '../settings';
import type { BM25CorpusDocument } from './bm25';
import { createContentHash } from './hash';
import { buildSearchText, chunkMarkdown, chunkPlainText } from './indexer';

export function buildBM25CorpusDocuments(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
): BM25CorpusDocument[] {
  const chunks =
    file.extension.toLowerCase() === 'md'
      ? chunkMarkdown(content, config.chunkSize, config.overlap)
      : chunkPlainText(content, config.chunkSize, config.overlap);
  const indexedAt = Date.now();
  const contentHash = createContentHash(content);
  return chunks.map((chunk, index) => ({
    id: `${file.path}::${chunk.metadata.startLine}::${index}`,
    text: buildSearchText(file, chunk),
    sourcePath: file.path,
    heading: chunk.metadata.heading,
    startLine: chunk.metadata.startLine,
    endLine: chunk.metadata.endLine,
    sourceMtime: file.stat.mtime,
    sourceSize: file.stat.size,
    contentHash,
    indexedAt,
  }));
}
