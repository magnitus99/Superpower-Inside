import type { TFile } from 'obsidian';
import type { RAGConfig } from '../settings';
import type { BM25CorpusDocument } from './bm25';
import { createContentHash } from './hash';
import {
  chunkMarkdownRust,
  chunkPlainTextRust,
  planSourceChunksRust,
  type RustSourceChunk,
} from './rust-core';

export interface Chunk {
  text: string;
  metadata: { filePath: string; heading?: string; startLine: number; endLine: number };
}

export interface SourceDocument extends BM25CorpusDocument {
  startLine: number;
  endLine: number;
  sourceMtime: number;
  sourceSize: number;
  contentHash: string;
  chunkHash: string;
  indexedAt: number;
}

export function chunkMarkdown(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  return chunkMarkdownRust(content, maxChunkSize, overlapChars) ?? [];
}

export function chunkPlainText(content: string, maxChunkSize: number, overlapChars = 0): Chunk[] {
  return chunkPlainTextRust(content, maxChunkSize, overlapChars) ?? [];
}

/** 지원 파일의 모든 소비자가 같은 청킹 계약을 사용합니다. */
export function chunkSourceFile(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
): RustSourceChunk[] {
  const chunks = planSourceChunksRust(
    file.path,
    file.extension ?? '',
    content,
    config.chunkSize,
    config.overlap,
  );
  if (chunks === null) throw new Error('Source document chunking is unavailable.');
  return chunks;
}

export function buildSearchText(file: TFile, chunk: Chunk): string {
  const hints = [`File: ${file.path}`, `Title: ${file.basename}`];
  if (chunk.metadata.heading) hints.push(`Heading: ${chunk.metadata.heading}`);
  return `${hints.join('\n')}\n\n${chunk.text}`;
}

export function buildSourceDocuments(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
): SourceDocument[] {
  const indexedAt = Date.now();
  const contentHash = createContentHash(content);
  return chunkSourceFile(file, content, config).map((chunk) => ({
    id: chunk.id,
    chunkHash: chunk.chunkHash,
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
