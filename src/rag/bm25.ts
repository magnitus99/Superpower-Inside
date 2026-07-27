import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { planStaleIndexSourcePathsRust, RustBm25RuntimeIndex, tokenizeRust } from './rust-core';
import {
  BM25WorkerRuntime,
  canUseBM25Worker,
  type BM25WorkerFactory,
  type BM25WorkerHit,
} from './bm25-worker-runtime';

export interface BM25DocumentInput {
  id: string;
  text: string;
  sourcePath?: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
}

export interface BM25CorpusDocument extends BM25DocumentInput {
  sourcePath: string;
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
  heading?: string;
  startLine?: number;
  endLine?: number;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
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
  workerFactory?: BM25WorkerFactory;
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
  private readonly workerFactory?: BM25WorkerFactory;
  private pendingOperations: BM25PendingOperation[];
  private nextOperationOrderValue: number;
  private workerRuntime: BM25WorkerRuntime | null = null;
  private workerQueue: Promise<void> = Promise.resolve();
  private workerReady = false;
  private workerTokenizerCurrent = false;
  private workerTotalDocs = 0;
  private workerFailure: Error | null = null;
  private rebuildReplayOperations: BM25PendingOperation[] | null = null;

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
    this.workerFactory = options.workerFactory;
    this.pendingOperations = [];
    this.nextOperationOrderValue = Date.now() * 1000;
  }

  async load(): Promise<void> {
    this.runtime?.dispose();
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.workerQueue = Promise.resolve();
    this.workerFailure = null;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.loaded = false;
    if (this.workerFactory || canUseBM25Worker()) {
      const worker = new BM25WorkerRuntime(this.workerFactory);
      this.workerRuntime = worker;
      const initialization = (async () => {
        const snapshot = await this.loadSnapshot();
        const raw = snapshot.raw.trim();
        const state = await worker.initialize(
          this.db.name,
          raw.length > 0 && raw.length <= this.maxSnapshotBytes ? raw : '',
        );
        this.applyWorkerState(state);
        this.runtime = null;
        this.loaded = true;
        if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
          await this.persistSnapshotRaw(raw);
        }
      })();
      // 초기화 중 들어온 파일 변경도 hydration 완료 뒤 같은 worker에 순서대로 적용한다.
      this.workerQueue = initialization;
      try {
        await initialization;
        return;
      } catch (error) {
        worker.close();
        if (this.workerRuntime === worker) {
          this.workerRuntime = null;
        }
        this.loaded = false;
        throw error;
      }
    }
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
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.clear());
      });
    } else {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    this.queueMutation('clear', '*');
    await this.persist();
  }

  async deleteDatabase(): Promise<void> {
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.pendingOperations = [];
    this.rebuildReplayOperations = null;
    this.batchDirty = false;
    this.loaded = false;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.db.close({ disableAutoOpen: true });
    await Dexie.delete(this.db.name);
  }

  close(): void {
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.pendingOperations = [];
    this.rebuildReplayOperations = null;
    this.batchDirty = false;
    this.loaded = false;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.db.close({ disableAutoOpen: true });
  }

  async rebuild(documents: readonly BM25DocumentInput[]): Promise<void> {
    if (this.workerRuntime) {
      await this.withBatch(() => {
        this.queueMutation('clear', '*', false);
        for (const document of documents) {
          this.queueDocument(normalizeCorpusDocument(document), false);
        }
        this.batchDirty = true;
        return Promise.resolve();
      });
      const workerDocuments = documents.map((document) => ({
        id: document.id,
        text: document.text,
        sourcePath: document.sourcePath ?? document.id,
      }));
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.rebuild(workerDocuments));
      });
      await this.workerQueue;
      if (this.workerFailure) throw this.workerFailure;
      return;
    }
    await this.withBatch(async () => {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
      this.queueMutation('clear', '*', false);
      const seenDocIds = new Set<string>();
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        if (document === undefined) continue;
        if (seenDocIds.has(document.id)) {
          this.ensureRuntime().addDocument(
            document.id,
            document.text,
            document.sourcePath ?? document.id,
            TOKENIZER_VERSION,
          );
          this.queueDocument(normalizeCorpusDocument(document), false);
        } else {
          this.ensureRuntime().addNewDocument(
            document.id,
            document.text,
            document.sourcePath ?? document.id,
            TOKENIZER_VERSION,
          );
          this.queueDocument(normalizeCorpusDocument(document), false);
          seenDocIds.add(document.id);
        }
        if (index + 1 < documents.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) {
          await yieldToHost();
        }
      }
      await this.persist();
    });
  }

  async rebuildFrom(createDocuments: () => Promise<readonly BM25DocumentInput[]>): Promise<void> {
    if (this.rebuildReplayOperations !== null) {
      throw new Error('BM25 rebuild is already in progress.');
    }
    this.rebuildReplayOperations = [];
    let rebuildStarted = false;
    let rebuildError: Error | null = null;
    try {
      const documents = await createDocuments();
      rebuildStarted = true;
      await this.rebuild(documents);
    } catch (error) {
      rebuildError = error instanceof Error ? error : new Error(String(error));
    }

    const replayOperations = this.rebuildReplayOperations ?? [];
    this.rebuildReplayOperations = null;
    if (rebuildStarted && replayOperations.length > 0) {
      await this.replayOperationsAfterRebuild(replayOperations);
    }
    if (rebuildError) throw rebuildError;
  }

  addDocument(docId: string, text: string, sourcePath = docId): void {
    this.addCorpusDocument({ id: docId, text, sourcePath });
  }

  addCorpusDocument(document: BM25CorpusDocument): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(
          await worker.add({
            id: document.id,
            text: document.text,
            sourcePath: document.sourcePath,
          }),
        );
      });
    } else {
      this.ensureRuntime().addDocument(
        document.id,
        document.text,
        document.sourcePath,
        TOKENIZER_VERSION,
      );
    }
    this.queueDocument(document);
  }

  removeDocument(docId: string): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeDocument(docId));
      });
    } else {
      this.ensureRuntime().removeDocument(docId, TOKENIZER_VERSION);
    }
    this.queueMutation('remove-doc', docId);
  }

  removeDocumentsBySource(sourcePath: string): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeSource(sourcePath));
      });
    } else {
      this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
    }
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

  async searchTopWithSources(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<BM25WorkerHit[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (normalizedLimit === 0) return [];
    if (this.workerRuntime) {
      await this.workerQueue;
      if (this.workerFailure) return [];
      return this.workerRuntime.searchTop(query, normalizedLimit, signal);
    }
    return [...this.searchTop(query, normalizedLimit)].map(([docId, score]) => ({
      docId,
      sourcePath: this.getDocumentSource(docId) ?? docId,
      score,
    }));
  }

  get isReady(): boolean {
    return (
      this.loaded &&
      this.workerFailure === null &&
      (this.workerRuntime ? this.workerReady : (this.runtime?.isReady() ?? false))
    );
  }

  get isTokenizerCurrent(): boolean {
    return this.workerRuntime
      ? this.workerTokenizerCurrent
      : (this.runtime?.isTokenizerCurrent(TOKENIZER_VERSION) ?? false);
  }

  get totalDocs(): number {
    return this.workerRuntime ? this.workerTotalDocs : (this.runtime?.totalDocs() ?? 0);
  }

  getDocumentSource(docId: string): string | undefined {
    return this.runtime?.sourcePathForDoc(docId);
  }

  async getSourcePaths(): Promise<string[]> {
    await this.persist();
    const records = await this.db.documents.toArray();
    return [...new Set(records.map((record) => record.sourcePath))].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  async getCorpusDocumentsByIds(ids: readonly string[]): Promise<BM25CorpusDocument[]> {
    await this.persist();
    const records = await this.db.documents.bulkGet([...ids]);
    return records.flatMap((record) => (record ? [toCorpusDocument(record)] : []));
  }

  async getCorpusDocumentsBySourcePaths(
    sourcePaths: readonly string[],
  ): Promise<BM25CorpusDocument[]> {
    await this.persist();
    if (sourcePaths.length === 0) return [];
    const records = await this.db.documents
      .where('sourcePath')
      .anyOf([...sourcePaths])
      .toArray();
    return records.map(toCorpusDocument);
  }

  async reconcileSourcePaths(
    validSourcePaths: readonly string[],
    maxDeletions = 128,
  ): Promise<{ deletedSourcePaths: string[]; remainingWork: boolean }> {
    const sourcePaths = await this.getSourcePaths();
    const plan = planStaleIndexSourcePathsRust(sourcePaths, validSourcePaths, maxDeletions);
    if (!plan) throw new Error('Rust BM25 source reconciliation planning failed');
    await this.withBatch(async () => {
      for (const sourcePath of plan.deletePaths) this.removeDocumentsBySource(sourcePath);
      await this.persist();
    });
    await this.workerQueue;
    if (this.workerFailure) throw this.workerFailure;
    return {
      deletedSourcePaths: plan.deletePaths,
      remainingWork: plan.remainingDeleteCount > 0,
    };
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

  private enqueueWorkerMutation(operation: (worker: BM25WorkerRuntime) => Promise<void>): void {
    const worker = this.workerRuntime;
    if (!worker) return;
    this.workerQueue = this.workerQueue
      .then(() => operation(worker))
      .catch((error: unknown) => {
        this.workerFailure = error instanceof Error ? error : new Error(String(error));
        this.workerReady = false;
        worker.close(this.workerFailure);
      });
  }

  private applyWorkerState(state: {
    ready?: boolean;
    tokenizerCurrent?: boolean;
    totalDocs?: number;
  }): void {
    this.workerReady = state.ready ?? false;
    this.workerTokenizerCurrent = state.tokenizerCurrent ?? false;
    this.workerTotalDocs = state.totalDocs ?? 0;
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
      if (index + 1 < operations.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) {
        await yieldToHost();
      }
    }
    this.pendingOperations = [];
    this.batchDirty = false;
    if (mutations.length > 0) {
      await this.db.mutations.clear();
    }
  }

  private async persistMutationOperation(record: BM25MutationRecord): Promise<void> {
    if (record.kind === 'clear') {
      await this.db.documents.clear();
      await this.db.mutations.clear();
      return;
    }
    if (record.kind === 'remove-doc') {
      await this.db.documents.delete(record.target);
    } else {
      await this.db.documents.where('sourcePath').equals(record.target).delete();
    }
  }

  private async replayOperationsAfterRebuild(
    operations: readonly BM25PendingOperation[],
  ): Promise<void> {
    await this.withBatch(async () => {
      for (const operation of operations) {
        if (operation.kind === 'upsert-document') {
          const document = toCorpusDocument(operation.record);
          if (this.workerRuntime) {
            this.enqueueWorkerMutation(async (worker) => {
              this.applyWorkerState(
                await worker.add({
                  id: document.id,
                  text: document.text,
                  sourcePath: document.sourcePath,
                }),
              );
            });
          } else {
            this.ensureRuntime().addDocument(
              document.id,
              document.text,
              document.sourcePath,
              TOKENIZER_VERSION,
            );
          }
        } else if (this.workerRuntime) {
          const mutation = operation.record;
          this.enqueueWorkerMutation(async (worker) => {
            if (mutation.kind === 'clear') {
              this.applyWorkerState(await worker.clear());
            } else if (mutation.kind === 'remove-doc') {
              this.applyWorkerState(await worker.removeDocument(mutation.target));
            } else {
              this.applyWorkerState(await worker.removeSource(mutation.target));
            }
          });
        } else {
          this.applyMutation(operation.record);
        }
        this.pendingOperations.push(operation);
      }
      await this.persist();
    });
    await this.workerQueue;
    if (this.workerFailure) throw this.workerFailure;
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

  private queueDocument(document: BM25CorpusDocument, captureForRebuild = true): void {
    const now = Date.now();
    const operation: BM25PendingOperation = {
      kind: 'upsert-document',
      record: {
        id: document.id,
        text: document.text,
        sourcePath: document.sourcePath,
        updated: now,
        order: this.nextOperationOrder(),
        heading: document.heading,
        startLine: document.startLine,
        endLine: document.endLine,
        sourceMtime: document.sourceMtime,
        sourceSize: document.sourceSize,
        contentHash: document.contentHash,
        indexedAt: document.indexedAt,
      },
    };
    this.pendingOperations.push(operation);
    if (captureForRebuild) {
      this.rebuildReplayOperations?.push(operation);
    }
  }

  private queueMutation(
    kind: BM25MutationRecord['kind'],
    target: string,
    captureForRebuild = true,
  ): void {
    const now = Date.now();
    const order = this.nextOperationOrder();
    const operation: BM25PendingOperation = {
      kind: 'mutation',
      record: {
        id: `${kind}:${target}:${order}`,
        kind,
        target,
        updated: now,
        order,
      },
    };
    this.pendingOperations.push(operation);
    if (captureForRebuild) {
      this.rebuildReplayOperations?.push(operation);
    }
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

function toCorpusDocument(record: BM25DocumentRecord): BM25CorpusDocument {
  return {
    id: record.id,
    text: record.text,
    sourcePath: record.sourcePath,
    heading: record.heading,
    startLine: record.startLine,
    endLine: record.endLine,
    sourceMtime: record.sourceMtime,
    sourceSize: record.sourceSize,
    contentHash: record.contentHash,
    indexedAt: record.indexedAt,
  };
}

function normalizeCorpusDocument(document: BM25DocumentInput): BM25CorpusDocument {
  return { ...document, sourcePath: document.sourcePath ?? document.id };
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
