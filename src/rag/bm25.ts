import Dexie from 'dexie';
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
const BM25_SNAPSHOT_KEY = 'bm25-runtime-snapshot:v1';
const BM25_REBUILD_YIELD_INTERVAL = 128;

interface BM25MetaRecord {
  key: string;
  value: string;
  updated: number;
}

type BM25SnapshotSource = 'indexeddb' | 'legacy' | 'empty';

interface BM25Snapshot {
  raw: string;
  source: BM25SnapshotSource;
}

class BM25IndexDB extends Dexie {
  meta!: Dexie.Table<BM25MetaRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
    });
  }
}

export class IndexedDbBM25Index {
  private runtime: RustBm25RuntimeIndex | null;
  private db: BM25IndexDB;
  private legacyAdapter?: DataAdapter;
  private legacyPath: string;
  private loaded: boolean;
  private batchDepth: number;
  private batchDirty: boolean;

  constructor(
    dbName = 'SuperpowerInsideBM25Index',
    legacyAdapter?: DataAdapter,
    legacyPath = '.superpower-inside/bm25-index.json',
  ) {
    this.db = new BM25IndexDB(dbName);
    this.legacyAdapter = legacyAdapter;
    this.legacyPath = legacyPath;
    this.runtime = null;
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
  }

  async load(): Promise<void> {
    this.runtime?.dispose();
    const snapshot = await this.loadSnapshot();
    this.runtime =
      snapshot.raw.trim().length > 0
        ? RustBm25RuntimeIndex.fromJson(snapshot.raw, TOKENIZER_VERSION)
        : RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    this.loaded = true;
    if (snapshot.source === 'legacy') {
      await this.persistNow();
    }
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
    await this.db.meta.put({
      key: BM25_SNAPSHOT_KEY,
      value: this.runtime?.toJson() ?? createEmptyPayload(),
      updated: Date.now(),
    });
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
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        if (document === undefined) continue;
        this.addDocument(document.id, document.text, document.sourcePath);
        if (
          index + 1 < documents.length &&
          (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0
        ) {
          await yieldToHost();
        }
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

  private async loadSnapshot(): Promise<BM25Snapshot> {
    const stored = await this.db.meta.get(BM25_SNAPSHOT_KEY);
    if (stored?.value) {
      return { raw: stored.value, source: 'indexeddb' };
    }
    if (!this.legacyAdapter) {
      return { raw: '', source: 'empty' };
    }
    if (!(await this.legacyAdapter.exists(this.legacyPath))) {
      return { raw: '', source: 'empty' };
    }
    return { raw: await this.legacyAdapter.read(this.legacyPath), source: 'legacy' };
  }
}

function createEmptyPayload(): string {
  return (
    RustBm25RuntimeIndex.empty(TOKENIZER_VERSION)?.toJson() ??
    '{"schemaVersion":3,"tokenizerVersion":2,"docs":[],"terms":[],"totalDocs":0,"avgDocLength":1}'
  );
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
