import type { CachedMetadata, TFile } from 'obsidian';
import type { RAGConfig } from '../settings';
import type { SourceTextSegment } from './source-access';
import { getBM25DocumentFields, type BM25CorpusDocument } from './bm25';
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

/**
 * 추출 문서의 구간 라벨을 청크에서 가장 가까운 시작 줄 기준으로 붙입니다.
 *
 * 라벨은 출처 표시와 검색 힌트에만 쓰고 `id`·`chunkHash`는 원문에서 계산된 값을 그대로
 * 유지해 재색인 사이의 청크 식별자가 바뀌지 않게 합니다.
 */
export function chunkSourceDocument(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
  segments: readonly SourceTextSegment[] = [],
): RustSourceChunk[] {
  const chunks = chunkSourceFile(file, content, config);
  if (segments.length === 0) return chunks;
  return chunks.map((chunk) => {
    const segment = segments.find(
      (candidate) =>
        chunk.metadata.startLine >= candidate.startLine &&
        chunk.metadata.startLine <= candidate.endLine,
    );
    if (!segment) return chunk;
    return { ...chunk, metadata: { ...chunk.metadata, heading: segment.label } };
  });
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
): SourceDocument[] {
  const indexedAt = Date.now();
  const contentHash = createContentHash(content);
  return chunkSourceDocument(file, content, config, segments).map((chunk) => ({
    id: chunk.id,
    chunkHash: chunk.chunkHash,
    text: chunk.text,
    ...getBM25DocumentFields(file, metadata, chunk.metadata.heading),
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
