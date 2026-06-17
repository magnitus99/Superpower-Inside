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
const DEFAULT_BM25_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;

interface BM25MetaRecord {
  key: string;
  value: string;
  updated: number;
}

interface BM25DocumentRecord {
  id: string;
  text: string;
  sourcePath: string;
  updated: number;
  order: number;
}

interface BM25MutationRecord {
  id: string;
  kind: 'clear' | 'remove-doc' | 'remove-source';
  target: string;
  updated: number;
  order: number;
}

type BM25PendingOperation =
  | { kind: 'upsert-document'; record: BM25DocumentRecord }
  | { kind: 'mutation'; record: BM25MutationRecord };

type BM25SnapshotSource = 'indexeddb' | 'legacy' | 'empty';

interface BM25Snapshot {
  raw: string;
  source: BM25SnapshotSource;
}

export interface IndexedDbBM25IndexOptions {
  maxSnapshotBytes?: number;
}

class BM25IndexDB extends Dexie {
  meta!: Dexie.Table<BM25MetaRecord, string>;
  documents!: Dexie.Table<BM25DocumentRecord, string>;
  mutations!: Dexie.Table<BM25MutationRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
    });
    this.version(2).stores({
      meta: 'key',
      documents: 'id, sourcePath, updated, order',
      mutations: 'id, kind, target, updated, order',
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
  private readonly maxSnapshotBytes: number;
  private pendingOperations: BM25PendingOperation[];
  private nextOperationOrderValue: number;

  constructor(
    dbName = 'SuperpowerInsideBM25Index',
    legacyAdapter?: DataAdapter,
    legacyPath = '.superpower-inside/bm25-index.json',
    options: IndexedDbBM25IndexOptions = {},
  ) {
    this.db = new BM25IndexDB(dbName);
    this.legacyAdapter = legacyAdapter;
    this.legacyPath = legacyPath;
    this.runtime = null;
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
    this.maxSnapshotBytes = normalizeMaxSnapshotBytes(options.maxSnapshotBytes);
    this.pendingOperations = [];
    this.nextOperationOrderValue = Date.now() * 1000;
  }

  async load(): Promise<void> {
    this.runtime?.dispose();
    const snapshot = await this.loadSnapshot();
    const raw = snapshot.raw.trim();
    const snapshotRuntime =
      raw.length > 0 && raw.length <= this.maxSnapshotBytes
        ? RustBm25RuntimeIndex.fromJson(raw, TOKENIZER_VERSION)
        : null;
    this.runtime = snapshotRuntime ?? RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    await this.replayPersistedOperations();
    this.loaded = true;
    if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
      await this.persistSnapshotRaw(raw);
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
    const operations = [...this.pendingOperations];
    if (operations.length === 0) {
      this.batchDirty = false;
      return;
    }
    await this.db.transaction('rw', this.db.documents, this.db.mutations, async () => {
      for (const operation of operations) {
        if (operation.kind === 'upsert-document') {
          await this.db.documents.put(operation.record);
          continue;
        }
        await this.persistMutationOperation(operation.record);
      }
    });
    this.pendingOperations = this.pendingOperations.slice(operations.length);
    this.batchDirty = false;
  }

  async clear(): Promise<void> {
    this.runtime?.dispose();
    this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    this.queueMutation('clear', '*');
    await this.persist();
  }

  async rebuild(documents: readonly BM25DocumentInput[]): Promise<void> {
    await this.withBatch(async () => {
      await this.clear();
      const seenDocIds = new Set<string>();
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        if (document === undefined) continue;
        if (seenDocIds.has(document.id)) {
          this.addDocument(document.id, document.text, document.sourcePath);
        } else {
          this.ensureRuntime().addNewDocument(
            document.id,
            document.text,
            document.sourcePath ?? document.id,
            TOKENIZER_VERSION,
          );
          this.queueDocument(document.id, document.text, document.sourcePath ?? document.id);
          seenDocIds.add(document.id);
        }
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
    this.queueDocument(docId, text, sourcePath);
  }

  removeDocument(docId: string): void {
    this.ensureRuntime().removeDocument(docId, TOKENIZER_VERSION);
    this.queueMutation('remove-doc', docId);
  }

  removeDocumentsBySource(sourcePath: string): void {
    this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
    this.queueMutation('remove-source', sourcePath);
  }

  search(query: string): Map<string, number> {
    const mappedScores = new Map<string, number>();
    for (const { docId, score } of this.ensureRuntime().search(query) ?? []) {
      mappedScores.set(docId, score);
    }
    return mappedScores;
  }

  searchTop(query: string, limit: number): Map<string, number> {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (normalizedLimit === 0) return new Map<string, number>();

    const mappedScores = new Map<string, number>();
    for (const { docId, score } of this.ensureRuntime().searchTop(query, normalizedLimit) ?? []) {
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

  private async replayPersistedOperations(): Promise<void> {
    const [documents, mutations] = await Promise.all([
      this.db.documents.toArray(),
      this.db.mutations.toArray(),
    ]);
    const operations: Array<
      | { kind: 'upsert-document'; record: BM25DocumentRecord; order: number }
      | { kind: 'mutation'; record: BM25MutationRecord; order: number }
    > = [
      ...documents.map((record) => ({
        kind: 'upsert-document' as const,
        record,
        order: normalizeOperationOrder(record),
      })),
      ...mutations.map((record) => ({
        kind: 'mutation' as const,
        record,
        order: normalizeOperationOrder(record),
      })),
    ].sort((a, b) => a.order - b.order);

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      if (!operation) continue;
      if (operation.kind === 'upsert-document') {
        this.ensureRuntime().addDocument(
          operation.record.id,
          operation.record.text,
          operation.record.sourcePath,
          TOKENIZER_VERSION,
        );
      } else {
        this.applyMutation(operation.record);
      }
      if (
        index + 1 < operations.length &&
        (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0
      ) {
        await yieldToHost();
      }
    }
    this.pendingOperations = [];
    this.batchDirty = false;
  }

  private async persistMutationOperation(record: BM25MutationRecord): Promise<void> {
    if (record.kind === 'clear') {
      await this.db.documents.clear();
      await this.db.mutations.clear();
      await this.db.mutations.put(record);
      return;
    }
    if (record.kind === 'remove-doc') {
      await this.db.documents.delete(record.target);
    } else {
      await this.db.documents.where('sourcePath').equals(record.target).delete();
    }
    await this.db.mutations.put(record);
  }

  private applyMutation(record: BM25MutationRecord): void {
    if (record.kind === 'clear') {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
      return;
    }
    if (record.kind === 'remove-doc') {
      this.ensureRuntime().removeDocument(record.target, TOKENIZER_VERSION);
      return;
    }
    this.ensureRuntime().removeSource(record.target, TOKENIZER_VERSION);
  }

  private queueDocument(docId: string, text: string, sourcePath: string): void {
    const now = Date.now();
    this.pendingOperations.push({
      kind: 'upsert-document',
      record: {
        id: docId,
        text,
        sourcePath,
        updated: now,
        order: this.nextOperationOrder(),
      },
    });
  }

  private queueMutation(kind: BM25MutationRecord['kind'], target: string): void {
    const now = Date.now();
    const order = this.nextOperationOrder();
    this.pendingOperations.push({
      kind: 'mutation',
      record: {
        id: `${kind}:${target}:${order}`,
        kind,
        target,
        updated: now,
        order,
      },
    });
  }

  private nextOperationOrder(): number {
    const nextClockOrder = Date.now() * 1000;
    this.nextOperationOrderValue = Math.max(this.nextOperationOrderValue + 1, nextClockOrder);
    return this.nextOperationOrderValue;
  }

  private async persistSnapshotRaw(raw: string): Promise<void> {
    await this.db.meta.put({
      key: BM25_SNAPSHOT_KEY,
      value: raw,
      updated: Date.now(),
    });
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
    const stat = await statLegacyPath(this.legacyAdapter, this.legacyPath);
    if (stat?.type === 'file' && stat.size > this.maxSnapshotBytes) {
      return { raw: '', source: 'empty' };
    }
    return { raw: await this.legacyAdapter.read(this.legacyPath), source: 'legacy' };
  }
}

async function statLegacyPath(adapter: DataAdapter, path: string) {
  if (typeof adapter.stat !== 'function') return null;
  try {
    return await adapter.stat(path);
  } catch {
    return null;
  }
}

function normalizeMaxSnapshotBytes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BM25_SNAPSHOT_MAX_BYTES;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeOperationOrder(record: { order?: number; updated: number }): number {
  return Number.isFinite(record.order) ? (record.order as number) : record.updated * 1000;
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
