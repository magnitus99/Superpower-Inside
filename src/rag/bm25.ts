import type { DataAdapter } from 'obsidian';
import { readJsonFromVault, writeJsonToVault } from '../utils/vault';
import {
  planBm25IndexAddDocumentRust,
  planBm25IndexRemoveDocumentRust,
  planBm25IndexRemoveSourceRust,
  planBm25SearchRust,
  tokenizeRust,
  type RustBm25IndexData,
} from './rust-core';

type BM25Data = RustBm25IndexData;

export interface BM25DocumentInput {
  id: string;
  text: string;
  sourcePath?: string;
}

export function tokenize(text: string): string[] {
  const rustTokens = tokenizeRust(text);
  return rustTokens ?? [];
}

const TOKENIZER_VERSION = 2;

export class JsonFileBM25Index {
  private data: BM25Data;
  private adapter: DataAdapter;
  private path: string;
  private loaded: boolean;
  private batchDepth: number;
  private batchDirty: boolean;

  constructor(adapter: DataAdapter, path = '.superpower-inside/bm25-index.json') {
    this.adapter = adapter;
    this.path = path;
    this.data = createEmptyData();
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
  }

  async load(): Promise<void> {
    const raw = await readJsonFromVault(this.adapter, this.path);
    if (raw && typeof raw === 'object' && 'inverted' in (raw as Record<string, unknown>)) {
      const parsed = raw as Partial<BM25Data>;
      const docLengths = parsed.docLengths ?? {};
      this.data = {
        tokenizerVersion: typeof parsed.tokenizerVersion === 'number' ? parsed.tokenizerVersion : 0,
        inverted: parsed.inverted ?? {},
        docLengths,
        docSources:
          parsed.docSources ??
          Object.fromEntries(Object.keys(docLengths).map((docId) => [docId, docId])),
        totalDocs: parsed.totalDocs ?? Object.keys(docLengths).length,
        avgDocLength: parsed.avgDocLength ?? 1,
      };
    }
    this.loaded = true;
  }

  async persist(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    await this.persistNow();
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await operation();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchDirty) {
        await this.persistNow();
      }
    }
  }

  private async persistNow(): Promise<void> {
    await writeJsonToVault(this.adapter, this.path, this.data);
    this.batchDirty = false;
  }

  async clear(): Promise<void> {
    this.data = createEmptyData();
    await this.persist();
  }

  async rebuild(documents: readonly BM25DocumentInput[]): Promise<void> {
    await this.withBatch(async () => {
      await this.clear();
      for (const document of documents) {
        this.addDocument(document.id, document.text, document.sourcePath);
      }
      await this.persist();
    });
  }

  addDocument(docId: string, text: string, sourcePath = docId): void {
    this.data =
      planBm25IndexAddDocumentRust(this.data, docId, text, sourcePath, TOKENIZER_VERSION) ??
      this.data;
  }

  removeDocument(docId: string): void {
    this.data =
      planBm25IndexRemoveDocumentRust(this.data, docId, TOKENIZER_VERSION) ?? this.data;
  }

  removeDocumentsBySource(sourcePath: string): void {
    this.data =
      planBm25IndexRemoveSourceRust(this.data, sourcePath, TOKENIZER_VERSION) ?? this.data;
  }

  search(query: string): Map<string, number> {
    const mappedScores = new Map<string, number>();
    for (const { docId, score } of planBm25SearchRust(this.data, query) ?? []) {
      mappedScores.set(docId, score);
    }
    return mappedScores;
  }

  get isReady(): boolean {
    return this.loaded && this.data.totalDocs > 0;
  }

  get isTokenizerCurrent(): boolean {
    return this.data.tokenizerVersion === TOKENIZER_VERSION;
  }

  get totalDocs(): number {
    return this.data.totalDocs;
  }

  getDocumentSource(docId: string): string | undefined {
    return this.data.docSources[docId];
  }
}

function createEmptyData(): BM25Data {
  return {
    tokenizerVersion: TOKENIZER_VERSION,
    inverted: {},
    docLengths: {},
    docSources: {},
    totalDocs: 0,
    avgDocLength: 1,
  };
}
