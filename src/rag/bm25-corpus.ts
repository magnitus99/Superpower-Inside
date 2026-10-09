import type { TFile } from 'obsidian';
import type { RAGConfig } from '../settings';
import type { BM25CorpusDocument } from './bm25';
import { buildSourceDocuments } from './source-document';

export function buildBM25CorpusDocuments(
  file: TFile,
  content: string,
  config: Pick<RAGConfig, 'chunkSize' | 'overlap'>,
): BM25CorpusDocument[] {
  return buildSourceDocuments(file, content, config);
}
