import type { BM25CorpusDocument, IndexedDbBM25Index } from './bm25';
import type { VectorEntry } from './store';

export interface RetrievalCorpusStore {
  getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]>;
  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]>;
}

export class BM25DocumentCorpusStore implements RetrievalCorpusStore {
  constructor(private readonly index: IndexedDbBM25Index) {}

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    const documents = await this.index.getCorpusDocumentsByIds(ids);
    return documents.map(toRetrievalEntry);
  }

  async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    const documents = await this.index.getCorpusDocumentsBySourcePaths(filePaths);
    return documents.map(toRetrievalEntry);
  }
}

export class FallbackRetrievalCorpusStore implements RetrievalCorpusStore {
  constructor(
    private readonly primary: RetrievalCorpusStore,
    private readonly fallback: RetrievalCorpusStore,
  ) {}

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    return this.primary.getEntriesByIds(ids);
  }

  async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    const primaryEntries = await this.primary.getEntriesByFilePaths(filePaths);
    const resolvedPaths = new Set(primaryEntries.map((entry) => entry.metadata.filePath));
    const missingPaths = filePaths.filter((path) => !resolvedPaths.has(path));
    if (missingPaths.length === 0) return primaryEntries;
    return [...primaryEntries, ...(await this.fallback.getEntriesByFilePaths(missingPaths))];
  }
}

function toRetrievalEntry(document: BM25CorpusDocument): VectorEntry {
  return {
    id: document.id,
    vector: [],
    metadata: {
      filePath: document.sourcePath,
      heading: document.heading,
      startLine: document.startLine ?? 0,
      endLine: document.endLine,
      text: document.text,
      sourceMtime: document.sourceMtime,
      sourceSize: document.sourceSize,
      contentHash: document.contentHash,
      indexedAt: document.indexedAt,
    },
  };
}
