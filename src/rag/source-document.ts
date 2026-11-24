import type { CachedMetadata, TFile } from 'obsidian';
import type { RAGConfig } from '../settings';
import type { SourceTextSegment } from './source-access';
import { getBM25DocumentFields, type BM25CorpusDocument } from './bm25';
import { createContentHash } from './hash';
import {
  chunkMarkdownRust,
  chunkPlainTextRust,
  planSourceChunksRust,
  planSourceSegmentChunksRust,
  type RustSourceChunk,
} from './rust-core';

export interface Chunk {
  text: string;
  metadata: { filePath: string; heading?: string; startLine: number; endLine: number; sourceSegment?: number };
}

export interface SourceDocument extends BM25CorpusDocument {
  startLine: number;
  endLine: number;
  sourceMtime: number;
  sourceSize: number;
  contentHash: string;
  chunkHash: string;
  indexedAt: number;
  sourceSegment?: number;
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

/** 구간 경계를 넘지 않도록 Rust에서 청킹하고 라벨은 검색 메타데이터로만 붙입니다. */
export function chunkSourceDocument(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
  segments: readonly SourceTextSegment[] = [],
): RustSourceChunk[] {
  if (segments.length === 0) return chunkSourceFile(file, content, config);
  const chunks = planSourceSegmentChunksRust(
    file.path,
    file.extension ?? '',
    content,
    config.chunkSize,
    config.overlap,
    segments,
  );
  if (chunks === null) throw new Error('Source segment chunking is unavailable.');
  return chunks;
}

/** 임베딩 요청에만 사용하는 일시적 projection이며 원문 저장에는 사용하지 않습니다. */
export function buildSearchText(file: TFile, chunk: Chunk): string {
  const hints = [`File: ${file.path}`, `Title: ${file.basename}`];
  if (chunk.metadata.heading) hints.push(`Heading: ${chunk.metadata.heading}`);
  return `${hints.join('\n')}\n\n${chunk.text}`;
}

export function buildSourceDocuments(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
  segments: readonly SourceTextSegment[] = [],
  metadata?: CachedMetadata | null,
  preparedChunks?: readonly RustSourceChunk[],
  preparedHash?: string,
): SourceDocument[] {
  const indexedAt = Date.now();
  const contentHash = preparedHash ?? createContentHash(content);
  return (preparedChunks ?? chunkSourceDocument(file, content, config, segments)).map((chunk) => ({
    id: chunk.id,
    chunkHash: chunk.chunkHash,
    text: chunk.text,
    ...getBM25DocumentFields(file, metadata, chunk.metadata.heading),
    sourcePath: file.path,
    heading: chunk.metadata.heading,
    startLine: chunk.metadata.startLine,
    endLine: chunk.metadata.endLine,
    ...(chunk.metadata.sourceSegment !== undefined ? { sourceSegment: chunk.metadata.sourceSegment } : {}),
    sourceMtime: file.stat.mtime,
    sourceSize: file.stat.size,
    contentHash,
    indexedAt,
  }));
}
