import type { DataAdapter } from 'obsidian';
import {
  RustBm25RuntimeIndex,
  tokenizeRust,
} from './rust-core';

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
  private runtime: RustBm25RuntimeIndex | null;
  private adapter: DataAdapter;
  private path: string;
  private loaded: boolean;
  private batchDepth: number;
  private batchDirty: boolean;

  constructor(adapter: DataAdapter, path = '.superpower-inside/bm25-index.json') {
    this.adapter = adapter;
    this.path = path;
    this.runtime = null;
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
  }

  async load(): Promise<void> {
    this.runtime?.dispose();
    const raw = (await this.adapter.exists(this.path)) ? await this.adapter.read(this.path) : '';
    this.runtime =
      raw.trim().length > 0
        ? RustBm25RuntimeIndex.fromJson(raw, TOKENIZER_VERSION)
        : RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
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
    await writeTextToVault(this.adapter, this.path, this.runtime?.toJson() ?? createEmptyPayload());
    this.batchDirty = false;
  }

  async clear(): Promise<void> {
    this.runtime?.dispose();
    this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
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
    this.ensureRuntime().addDocument(docId, text, sourcePath, TOKENIZER_VERSION);
  }

  removeDocument(docId: string): void {
    this.ensureRuntime().removeDocument(docId, TOKENIZER_VERSION);
  }

  removeDocumentsBySource(sourcePath: string): void {
    this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
  }

  search(query: string): Map<string, number> {
    const mappedScores = new Map<string, number>();
    for (const { docId, score } of this.ensureRuntime().search(query) ?? []) {
      mappedScores.set(docId, score);
    }
    return mappedScores;
  }

  get isReady(): boolean {
    return this.loaded && (this.runtime?.isReady() ?? false);
  }

  get isTokenizerCurrent(): boolean {
    return this.runtime?.isTokenizerCurrent(TOKENIZER_VERSION) ?? false;
  }

  get totalDocs(): number {
    return this.runtime?.totalDocs() ?? 0;
  }

  getDocumentSource(docId: string): string | undefined {
    return this.runtime?.sourcePathForDoc(docId);
  }

  private ensureRuntime(): RustBm25RuntimeIndex {
    if (this.runtime === null) {
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    if (this.runtime === null) {
      throw new Error('Rust BM25 runtime is unavailable');
    }
    return this.runtime;
  }
}

function createEmptyPayload(): string {
  return (
    RustBm25RuntimeIndex.empty(TOKENIZER_VERSION)?.toJson() ??
    '{"schemaVersion":3,"tokenizerVersion":2,"docs":[],"terms":[],"totalDocs":0,"avgDocLength":1}'
  );
}

async function writeTextToVault(
  adapter: DataAdapter,
  path: string,
  content: string,
): Promise<void> {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) {
    await adapter.mkdir(dir);
  }
  const tmpPath = `${path}.tmp.${Date.now()}`;
  await adapter.write(tmpPath, content);
  try {
    await adapter.rename(tmpPath, path);
  } catch (renameError) {
    try {
      if (await adapter.exists(path)) {
        await adapter.remove(path);
      }
      await adapter.rename(tmpPath, path);
    } catch (fallbackError) {
      try {
        await adapter.remove(tmpPath);
      } catch {
        // temp 파일 정리 실패는 무시한다.
      }
      throw fallbackError instanceof Error ? fallbackError : renameError;
    }
  }
}
