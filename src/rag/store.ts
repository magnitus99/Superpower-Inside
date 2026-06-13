import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { writeJsonToVault, readJsonFromVault } from '../utils/vault';
import {
  planFileIndexRecordsRust,
  planVectorStoreAddRust,
  planVectorStoreLookupByFilePathsRust,
  planVectorStoreLookupByIdsRust,
  planVectorStoreRemoveFileRust,
  planVectorStoreReplaceFileRust,
  planVectorStoreStatsRust,
  rankTopKPairsRust,
  type RustVectorStoreMutationPlan,
  type RustFileIndexEntryInput,
} from './rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    endLine?: number;
    text: string;
    sourceMtime?: number;
    sourceSize?: number;
    contentHash?: string;
    indexedAt?: number;
    embeddingProvider?: string;
    embeddingModel?: string;
  };
}

export interface FileIndexRecord {
  filePath: string;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  hasCompleteMetadata?: boolean;
  vectorCount: number;
  updated: number;
}

export interface VectorStoreStats {
  totalEntries: number;
  totalFiles: number;
  totalVectors: number;
  averageVectorsPerFile: number;
  lastUpdated: number | null;
}

export interface VectorStore {
  add(entries: VectorEntry[]): Promise<void>;
  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void>;
  removeByFilePath(filePath: string): Promise<number>;
  query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]>;
  clear(): Promise<void>;
  persist(): Promise<void>;
  withBatch<T>(operation: () => Promise<T>): Promise<T>;
  getStats(): Promise<VectorStoreStats>;
  getIndexedFilePaths(): Promise<string[]>;
  getFileIndexRecords(): Promise<FileIndexRecord[]>;
  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]>;
  getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]>;
  getEntries(): Promise<VectorEntry[]>;
}

interface IndexedDbVectorRecord extends VectorEntry {
  filePath: string;
  updated: number;
}

class VectorStoreDB extends Dexie {
  vectors!: Dexie.Table<IndexedDbVectorRecord, string>;
  fileIndex!: Dexie.Table<FileIndexRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      vectors: 'id, filePath, updated',
    });
    this.version(2).stores({
      vectors: 'id, filePath, updated',
      fileIndex: 'filePath, updated',
    });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function scoredQuery(
  entries: VectorEntry[],
  vector: number[],
  topK: number,
  signal?: AbortSignal,
): Promise<VectorEntry[]> {
  throwIfAborted(signal);
  const rustScores = rankTopKPairsRust(
    vector,
    entries.map((entry) => entry.vector),
    topK,
  );
  if (rustScores !== null) {
    throwIfAborted(signal);
    const selected: VectorEntry[] = [];
    for (const result of rustScores) {
      const resultIndex = result.index;
      if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= entries.length) {
        continue;
      }
      const entry = entries[resultIndex];
      if (entry) selected.push(entry);
    }
    return Promise.resolve(selected);
  }

  return Promise.resolve([]);
}

/** Dexie/IndexedDB 기반 로컬 벡터 저장소 */
export class IndexedDbVectorStore implements VectorStore {
  private db: VectorStoreDB;
  private entriesCache: VectorEntry[] | null = null;

  constructor(dbName = 'SuperpowerInsideVectorStore') {
    this.db = new VectorStoreDB(dbName);
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const records = newEntries.map((entry) => ({
      ...entry,
      filePath: entry.metadata.filePath,
      updated: now,
    }));
    await this.db.vectors.bulkPut(records);
    await this.upsertFileIndexRecords(newEntries, now);
    this.entriesCache = null;
  }

  async replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const records = entries.map((entry) => ({
      ...entry,
      filePath: entry.metadata.filePath,
      updated: now,
    }));
    await this.db.transaction('rw', this.db.vectors, async () => {
      await this.db.vectors.where('filePath').equals(filePath).delete();
      if (records.length > 0) {
        await this.db.vectors.bulkPut(records);
      }
    });
    if (entries.length > 0) {
      const [record] = fileIndexRecordsFromRust(entries, now);
      if (record) {
        await this.db.fileIndex.put(record);
      } else {
        await this.db.fileIndex.delete(filePath);
      }
    } else {
      await this.db.fileIndex.delete(filePath);
    }
    if (this.entriesCache) {
      this.entriesCache = [
        ...this.entriesCache.filter((entry) => entry.metadata.filePath !== filePath),
        ...copyEntries(entries),
      ];
    }
  }

  async removeByFilePath(filePath: string): Promise<number> {
    const removed = await this.db.vectors.where('filePath').equals(filePath).delete();
    await this.db.fileIndex.delete(filePath);
    if (this.entriesCache) {
      this.entriesCache = this.entriesCache.filter((entry) => entry.metadata.filePath !== filePath);
    }
    return removed;
  }

  async query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]> {
    const entries = await this.getCachedEntries();
    return scoredQuery(entries, vector, topK, signal);
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.vectors, this.db.fileIndex, async () => {
      await this.db.vectors.clear();
      await this.db.fileIndex.clear();
    });
    this.entriesCache = [];
  }

  async persist(): Promise<void> {
    // IndexedDB는 각 쓰기 작업이 트랜잭션으로 즉시 반영되므로 별도 flush가 필요 없습니다.
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async getStats(): Promise<VectorStoreStats> {
    const records = await this.getFileIndexRecords();
    const totalVectors = records.reduce((total, record) => total + record.vectorCount, 0);
    const lastUpdated = records.reduce<number | null>(
      (latest, record) => (latest === null ? record.updated : Math.max(latest, record.updated)),
      null,
    );
    return {
      totalEntries: totalVectors,
      totalFiles: records.length,
      totalVectors,
      averageVectorsPerFile: records.length > 0 ? totalVectors / records.length : 0,
      lastUpdated,
    };
  }

  async getIndexedFilePaths(): Promise<string[]> {
    return (await this.getFileIndexRecords()).map((record) => record.filePath).sort();
  }

  async getFileIndexRecords(): Promise<FileIndexRecord[]> {
    const records = await this.db.fileIndex.toArray();
    const vectorCount = await this.db.vectors.count();
    if (records.length > 0 || vectorCount === 0) {
      return records;
    }
    await this.rebuildFileIndexFromVectors();
    return this.db.fileIndex.toArray();
  }

  async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    const uniquePaths = [...new Set(filePaths)];
    if (uniquePaths.length === 0) return [];
    const records = await this.db.vectors.where('filePath').anyOf(uniquePaths).toArray();
    return records.map(({ id, vector, metadata }) => ({
      id,
      vector: [...vector],
      metadata: { ...metadata },
    }));
  }

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    if (ids.length === 0) return [];
    const records = await this.db.vectors.bulkGet([...ids]);
    return records
      .filter((record): record is IndexedDbVectorRecord => record !== undefined)
      .map(({ id, vector, metadata }) => ({
        id,
        vector: [...vector],
        metadata: { ...metadata },
      }));
  }

  async getEntries(): Promise<VectorEntry[]> {
    return copyEntries(await this.getCachedEntries());
  }

  private async getCachedEntries(): Promise<VectorEntry[]> {
    if (this.entriesCache) return this.entriesCache;
    const records = await this.db.vectors.toArray();
    this.entriesCache = records.map(({ id, vector, metadata }) => ({
      id,
      vector: [...vector],
      metadata: { ...metadata },
    }));
    return this.entriesCache;
  }

  private async upsertFileIndexRecords(
    entries: readonly VectorEntry[],
    updated: number,
  ): Promise<void> {
    const records = fileIndexRecordsFromRust(entries, updated);
    if (records.length > 0) {
      await this.db.fileIndex.bulkPut(records);
    }
  }

  private async rebuildFileIndexFromVectors(): Promise<void> {
    const records = await this.db.vectors.toArray();
    const fileRecords = fileIndexRecordsFromRust(records, 0);
    if (fileRecords.length > 0) {
      await this.db.fileIndex.bulkPut(fileRecords);
    }
  }
}

/** Vault adapter 기반 JSON 파일 벡터 저장소 */
export class JsonFileVectorStore implements VectorStore {
  private adapter: DataAdapter;
  private path: string;
  private entries: VectorEntry[];
  private loaded: boolean;
  private loadingPromise: Promise<void> | null = null;
  private batchDepth = 0;
  private batchDirty = false;

  constructor(adapter: DataAdapter, path = '.superpower-inside/vectors.json') {
    this.adapter = adapter;
    this.path = path;
    this.entries = [];
    this.loaded = false;
    this.loadingPromise = null;
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    await this.loadIfNeeded();
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      newEntries,
      planVectorStoreAddRust(
        this.entries.map((entry) => entry.id),
        newEntries.map((entry) => entry.id),
      ),
      { mode: 'add' },
    );
    await this.persistIfNeeded();
  }

  async replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    await this.loadIfNeeded();
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      entries,
      planVectorStoreReplaceFileRust(
        this.entries.map((entry) => entry.metadata.filePath),
        filePath,
        entries.length,
      ),
      { mode: 'replace', filePath },
    );
    await this.persistIfNeeded();
  }

  async removeByFilePath(filePath: string): Promise<number> {
    await this.loadIfNeeded();
    const plan = planVectorStoreRemoveFileRust(
      this.entries.map((entry) => entry.metadata.filePath),
      filePath,
    );
    const removed = plan?.removedCount ?? countEntriesForFilePath(this.entries, filePath);
    this.entries = applyVectorStoreMutationPlan(this.entries, [], plan, {
      mode: 'remove',
      filePath,
    });
    if (removed > 0) {
      await this.persistIfNeeded();
    }
    return removed;
  }

  async query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return scoredQuery(this.entries, vector, topK, signal);
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persistIfNeeded();
  }

  async persist(): Promise<void> {
    await writeJsonToVault(this.adapter, this.path, this.entries);
    this.loaded = true;
    this.batchDirty = false;
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await operation();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchDirty) {
        await this.persist();
      }
    }
  }

  private async persistIfNeeded(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      this.loaded = true;
      return;
    }
    await this.persist();
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }
    this.loadingPromise = (async () => {
      const data = await readJsonFromVault(this.adapter, this.path);
      if (Array.isArray(data)) {
        this.entries = data as VectorEntry[];
      } else {
        this.entries = [];
      }
      this.loaded = true;
    })();
    await this.loadingPromise;
  }

  async getStats(): Promise<VectorStoreStats> {
    await this.loadIfNeeded();
    const stats = vectorStoreStatsFromRust(this.entries);
    return {
      totalEntries: stats.totalEntries,
      totalFiles: stats.totalFiles,
      totalVectors: stats.totalVectors,
      averageVectorsPerFile: stats.averageVectorsPerFile,
      lastUpdated: stats.lastUpdated,
    };
  }

  async getIndexedFilePaths(): Promise<string[]> {
    await this.loadIfNeeded();
    return vectorStoreStatsFromRust(this.entries).indexedFilePaths;
  }

  async getFileIndexRecords(): Promise<FileIndexRecord[]> {
    await this.loadIfNeeded();
    return fileIndexRecordsFromRust(this.entries, Date.now());
  }

  async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return copyEntries(selectEntriesByIndexPlan(this.entries, vectorStoreLookupByFilePaths(this.entries, filePaths)));
  }

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return copyEntries(selectEntriesByIndexPlan(this.entries, vectorStoreLookupByIds(this.entries, ids)));
  }

  async getEntries(): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return copyEntries(this.entries);
  }
}

/** 간단한 인메모리 벡터 저장소 (테스트/폴백용) */
export class MemoryVectorStore implements VectorStore {
  private entries: VectorEntry[];

  constructor() {
    this.entries = [];
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      newEntries,
      planVectorStoreAddRust(
        this.entries.map((entry) => entry.id),
        newEntries.map((entry) => entry.id),
      ),
      { mode: 'add' },
    );
    await this.persist();
  }

  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      entries,
      planVectorStoreReplaceFileRust(
        this.entries.map((entry) => entry.metadata.filePath),
        filePath,
        entries.length,
      ),
      { mode: 'replace', filePath },
    );
    return Promise.resolve();
  }

  removeByFilePath(filePath: string): Promise<number> {
    const plan = planVectorStoreRemoveFileRust(
      this.entries.map((entry) => entry.metadata.filePath),
      filePath,
    );
    const removed = plan?.removedCount ?? countEntriesForFilePath(this.entries, filePath);
    this.entries = applyVectorStoreMutationPlan(this.entries, [], plan, {
      mode: 'remove',
      filePath,
    });
    return Promise.resolve(removed);
  }

  async query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]> {
    return scoredQuery(this.entries, vector, topK, signal);
  }

  async clear(): Promise<void> {
    this.entries = [];
    return Promise.resolve();
  }

  async persist(): Promise<void> {
    // 아무것도 하지 않음
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  getStats(): Promise<VectorStoreStats> {
    const stats = vectorStoreStatsFromRust(this.entries);
    return Promise.resolve({
      totalEntries: stats.totalEntries,
      totalFiles: stats.totalFiles,
      totalVectors: stats.totalVectors,
      averageVectorsPerFile: stats.averageVectorsPerFile,
      lastUpdated: stats.lastUpdated,
    });
  }

  getIndexedFilePaths(): Promise<string[]> {
    return Promise.resolve(vectorStoreStatsFromRust(this.entries).indexedFilePaths);
  }

  getFileIndexRecords(): Promise<FileIndexRecord[]> {
    return Promise.resolve(fileIndexRecordsFromRust(this.entries, Date.now()));
  }

  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    return Promise.resolve(
      copyEntries(selectEntriesByIndexPlan(this.entries, vectorStoreLookupByFilePaths(this.entries, filePaths))),
    );
  }

  getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    return Promise.resolve(
      copyEntries(selectEntriesByIndexPlan(this.entries, vectorStoreLookupByIds(this.entries, ids))),
    );
  }

  getEntries(): Promise<VectorEntry[]> {
    return Promise.resolve(copyEntries(this.entries));
  }
}

function fileIndexRecordsFromRust(entries: readonly VectorEntry[], updated: number): FileIndexRecord[] {
  const records = planFileIndexRecordsRust(
    entries.map((entry) => {
      const indexedRecord = entry as VectorEntry & { updated?: number };
      return {
        filePath: entry.metadata.filePath,
        sourceMtime: entry.metadata.sourceMtime,
        sourceSize: entry.metadata.sourceSize,
        contentHash: entry.metadata.contentHash,
        indexedAt: entry.metadata.indexedAt,
        endLine: entry.metadata.endLine,
        embeddingProvider: entry.metadata.embeddingProvider,
        embeddingModel: entry.metadata.embeddingModel,
        updated: indexedRecord.updated,
      } satisfies RustFileIndexEntryInput;
    }),
    updated,
  );
  if (records === null) return [];

  return records.map((record) => ({
    filePath: record.filePath,
    sourceMtime: record.sourceMtime,
    sourceSize: record.sourceSize,
    contentHash: record.contentHash,
    indexedAt: record.indexedAt,
    embeddingProvider: record.embeddingProvider,
    embeddingModel: record.embeddingModel,
    hasCompleteMetadata: record.hasCompleteMetadata,
    vectorCount: record.vectorCount,
    updated: record.updated,
  }));
}

function applyVectorStoreMutationPlan(
  existingEntries: readonly VectorEntry[],
  incomingEntries: readonly VectorEntry[],
  plan: RustVectorStoreMutationPlan | null,
  options?: { mode: VectorStoreMutationMode; filePath?: string },
): VectorEntry[] {
  if (plan === null) {
    return applyVectorStoreMutationPlanFallback(existingEntries, incomingEntries, options);
  }

  const nextEntries: VectorEntry[] = [];
  for (const source of plan.sources) {
    const sourceEntries = source.source === 'existing' ? existingEntries : incomingEntries;
    const sourceIndex = source.index;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= sourceEntries.length) {
      continue;
    }
    const entry = sourceEntries[sourceIndex];
    if (entry !== undefined) {
      nextEntries.push(entry);
    }
  }
  return copyEntries(nextEntries);
}

function vectorStoreStatsFromRust(entries: readonly VectorEntry[]): VectorStoreStats & {
  indexedFilePaths: string[];
} {
  const plan = planVectorStoreStatsRust(
    entries.map((entry) => entry.metadata.filePath),
    Date.now(),
  );
  if (plan === null) {
    return vectorStoreStatsFallback(entries);
  }
  return plan;
}

function vectorStoreLookupByFilePaths(
  entries: readonly VectorEntry[],
  filePaths: readonly string[],
): number[] {
  const plan = planVectorStoreLookupByFilePathsRust(
    entries.map((entry) => entry.metadata.filePath),
    filePaths,
  );
  if (plan === null) {
    return vectorStoreLookupByFilePathsFallback(
      entries.map((entry) => entry.metadata.filePath),
      filePaths,
    );
  }
  return plan;
}

function vectorStoreLookupByIds(entries: readonly VectorEntry[], ids: readonly string[]): number[] {
  const plan = planVectorStoreLookupByIdsRust(
    entries.map((entry) => entry.id),
    ids,
  );
  if (plan === null) {
    return vectorStoreLookupByIdsFallback(
      entries.map((entry) => entry.id),
      ids,
    );
  }
  return plan;
}

function selectEntriesByIndexPlan(
  entries: readonly VectorEntry[],
  indexes: readonly number[],
): VectorEntry[] {
  return selectByRustIndices(entries, indexes, { dedupe: true });
}

type VectorStoreMutationMode = 'add' | 'replace' | 'remove';

function applyVectorStoreMutationPlanFallback(
  existingEntries: readonly VectorEntry[],
  incomingEntries: readonly VectorEntry[],
  options?: { mode: VectorStoreMutationMode; filePath?: string },
): VectorEntry[] {
  if (!options) {
    return addEntriesFallback(existingEntries, incomingEntries);
  }

  if (options.mode === 'replace') {
    return replaceFileEntriesFallback(existingEntries, incomingEntries, options.filePath);
  }
  if (options.mode === 'remove') {
    return removeFileEntriesFallback(existingEntries, options.filePath ?? '');
  }
  return addEntriesFallback(existingEntries, incomingEntries);
}

function addEntriesFallback(
  existingEntries: readonly VectorEntry[],
  incomingEntries: readonly VectorEntry[],
): VectorEntry[] {
  const latestIncomingIndexById = new Map<string, number>();
  for (let index = 0; index < incomingEntries.length; index++) {
    const incoming = incomingEntries[index];
    if (incoming === undefined) {
      continue;
    }
    latestIncomingIndexById.set(incoming.id, index);
  }

  const existingIdSet = new Set(existingEntries.map((entry) => entry.id));
  const usedIncomingIndices = new Set<number>();
  const nextEntries: VectorEntry[] = [];
  for (let index = 0; index < existingEntries.length; index++) {
    const existingEntry = existingEntries[index];
    if (!existingEntry) {
      continue;
    }
    const incomingIndex = latestIncomingIndexById.get(existingEntry.id);
    if (incomingIndex === undefined) {
      nextEntries.push(existingEntry);
      continue;
    }
    const incomingEntry = incomingEntries[incomingIndex];
    if (!incomingEntry) {
      nextEntries.push(existingEntry);
      continue;
    }
    usedIncomingIndices.add(incomingIndex);
    nextEntries.push(incomingEntry);
  }

  for (let index = 0; index < incomingEntries.length; index++) {
    const incomingEntry = incomingEntries[index];
    if (!incomingEntry) {
      continue;
    }
    const incomingId = incomingEntry.id;
    const isLatestForId = latestIncomingIndexById.get(incomingId) === index;
    if (!isLatestForId || existingIdSet.has(incomingId) || usedIncomingIndices.has(index)) {
      continue;
    }
    usedIncomingIndices.add(index);
    nextEntries.push(incomingEntry);
  }
  return copyEntries(nextEntries);
}

function replaceFileEntriesFallback(
  existingEntries: readonly VectorEntry[],
  incomingEntries: readonly VectorEntry[],
  filePath?: string,
): VectorEntry[] {
  const fallbackFilePath = filePath ?? '';
  const nextEntries: VectorEntry[] = [];
  let incomingIndex = 0;
  for (let index = 0; index < existingEntries.length; index++) {
    const existingEntry = existingEntries[index];
    if (!existingEntry) {
      continue;
    }
    if (existingEntry.metadata.filePath === fallbackFilePath) {
      if (incomingIndex < incomingEntries.length) {
        const incomingEntry = incomingEntries[incomingIndex];
        if (incomingEntry) {
          nextEntries.push(incomingEntry);
        }
        incomingIndex += 1;
      }
    } else {
      nextEntries.push(existingEntry);
    }
  }
  while (incomingIndex < incomingEntries.length) {
    const incomingEntry = incomingEntries[incomingIndex];
    if (incomingEntry) {
      nextEntries.push(incomingEntry);
    }
    incomingIndex += 1;
  }
  return copyEntries(nextEntries);
}

function removeFileEntriesFallback(existingEntries: readonly VectorEntry[], filePath: string): VectorEntry[] {
  return copyEntries(existingEntries.filter((entry) => entry.metadata.filePath !== filePath));
}

function countEntriesForFilePath(existingEntries: readonly VectorEntry[], filePath: string): number {
  let removedCount = 0;
  for (let index = 0; index < existingEntries.length; index++) {
    const entry = existingEntries[index];
    if (entry.metadata.filePath === filePath) {
      removedCount++;
    }
  }
  return removedCount;
}

function vectorStoreStatsFallback(entries: readonly VectorEntry[]): VectorStoreStats & {
  indexedFilePaths: string[];
} {
  const filePaths = entries.map((entry) => entry.metadata.filePath);
  const indexedFilePaths = [...new Set(filePaths)].sort();
  return {
    totalEntries: filePaths.length,
    totalFiles: indexedFilePaths.length,
    totalVectors: filePaths.length,
    averageVectorsPerFile:
      indexedFilePaths.length > 0 ? filePaths.length / indexedFilePaths.length : 0,
    lastUpdated: indexedFilePaths.length > 0 ? Date.now() : null,
    indexedFilePaths,
  };
}

function vectorStoreLookupByFilePathsFallback(
  entryFilePaths: readonly string[],
  requestedFilePaths: readonly string[],
): number[] {
  const requested = new Set(requestedFilePaths);
  const indexes: number[] = [];
  for (let index = 0; index < entryFilePaths.length; index++) {
    const entryPath = entryFilePaths[index];
    if (entryPath !== undefined && requested.has(entryPath)) {
      indexes.push(index);
    }
  }
  return indexes;
}

function vectorStoreLookupByIdsFallback(entryIds: readonly string[], requestedIds: readonly string[]): number[] {
  const locationById = new Map<string, number>();
  for (let index = 0; index < entryIds.length; index++) {
    const entryId = entryIds[index];
    if (!locationById.has(entryId)) {
      locationById.set(entryId, index);
    }
  }

  const indexes: number[] = [];
  for (const requestedId of requestedIds) {
    const found = locationById.get(requestedId);
    if (found !== undefined) {
      indexes.push(found);
    }
  }
  return indexes;
}

function copyEntries(entries: readonly VectorEntry[]): VectorEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    vector: [...entry.vector],
    metadata: { ...entry.metadata },
  }));
}
