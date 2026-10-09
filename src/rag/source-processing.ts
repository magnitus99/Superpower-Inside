import type { SourceDocument } from './source-document';
import type { BM25CorpusDocument } from './bm25';
import type { FileIndexRecord } from './store';
export { planSourceProcessingRust } from './rust-core';

export type SourceProcessingState = 'ready' | 'pending' | 'stale' | 'failed' | 'disabled';
export interface SourceFileProcessingState {
  filePath: string;
  source: SourceProcessingState;
  bm25: SourceProcessingState;
  embedding: SourceProcessingState;
  chat: 'ready' | 'pending';
}
export interface SourceProcessingSummary {
  totalFiles: number;
  chatReadyFiles: number;
  completeFiles: number;
  truncated: boolean;
  files: SourceFileProcessingState[];
}
export interface SourceProcessingInput {
  files: {
    filePath: string;
    sourceMtime: number;
    sourceSize: number;
    readFailed: boolean;
    readPending: boolean;
  }[];
  documents: Pick<
    SourceDocument,
    'id' | 'sourcePath' | 'sourceMtime' | 'sourceSize' | 'contentHash' | 'chunkHash'
  >[];
  bm25: Pick<
    BM25CorpusDocument,
    'id' | 'sourcePath' | 'sourceMtime' | 'sourceSize' | 'contentHash'
  >[];
  vectors: FileIndexRecord[];
  failedEmbeddingPaths: string[];
  config: {
    bm25Enabled: boolean;
    embeddingEnabled: boolean;
    embeddingProvider: string;
    embeddingModel: string;
  };
  limit: number;
}
