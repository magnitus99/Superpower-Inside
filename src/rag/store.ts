import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { readJsonFromVault } from '../utils/vault';
import {
  planFileIndexRecordsRust,
  planVectorStoreAddRust,
  planVectorStoreLookupByFilePathsRust,
  planVectorStoreLookupByIdsRust,
  planVectorStoreRemoveFileRust,
  planVectorStoreReplaceFileRust,
  planVectorStoreStatsRust,
  rankTopKPairsRust,
  RustIvfRuntimeIndex,
  RustVectorRuntimeIndex,
  type RustVectorStoreMutationPlan,
  type RustFileIndexEntryInput,
  type RustVectorScore,
} from './rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';
import {
  createPagedVectorMatrix,
  enforceRuntimePayloadBudget,
} from './runtime-boundary';

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

export interface IndexedDbVectorStoreOptions {
  hydrateAllEntryLimit?: number;
  pageSize?: number;
  maxRuntimePayloadBytes?: number;
  searchCacheLimit?: number;
  runtimeIndexCacheLimit?: number;
  ivfRuntimeIndexCacheLimit?: number;
}

export interface VectorRuntimeCacheStats {
  entriesCacheLoaded: boolean;
  searchEntriesCacheSize: number;
  filteredRuntimeIndexCount: number;
  ivfRuntimeIndexCount: number;
}

export interface VectorSearchFilter {
  embeddingProvider?: string;
  embeddingModel?: string;
  dimension?: number;
}

export interface VectorSearchRequest {
  queryVector: readonly number[];
  topK: number;
  filter?: VectorSearchFilter;
  mode?: 'exact' | 'ann';
  annMinEntryCount?: number;
  annClusterCount?: number;
  annProbeCount?: number;
  signal?: AbortSignal;
}

export interface VectorSearchResult {
  entry: VectorEntry;
  score: number;
  mode: 'exact' | 'ann';
}

export interface VectorStore {
  add(entries: VectorEntry[]): Promise<void>;
  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void>;
  removeByFilePath(filePath: string): Promise<number>;
  query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult[]>;
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

export interface LegacyJsonVectorImportResult {
  imported: number;
  skipped: boolean;
}

export interface LegacyJsonVectorImportOptions {
  maxBytes?: number;
}

const LEGACY_JSON_VECTOR_IMPORT_KEY = 'legacy-json-vector-import:v1';
const DEFAULT_LEGACY_JSON_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_HYDRATE_ALL_ENTRY_LIMIT = 4096;
const DEFAULT_VECTOR_SEARCH_PAGE_SIZE = 256;
const DEFAULT_RUNTIME_PAYLOAD_BUDGET_BYTES = 4 * 1024 * 1024;
const DEFAULT_SEARCH_CACHE_LIMIT = 4;
const DEFAULT_RUNTIME_INDEX_CACHE_LIMIT = 2;
const DEFAULT_IVF_RUNTIME_INDEX_CACHE_LIMIT = 2;

interface IndexedDbVectorRecord {
  id: string;
  vectorBuffer?: ArrayBuffer;
  vector?: number[];
  dimension: number;
  metadata: VectorEntry['metadata'];
  filePath: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  updated: number;
}

interface VectorStoreMetaRecord {
  key: string;
  value: unknown;
  updated: number;
}

class VectorStoreDB extends Dexie {
  vectors!: Dexie.Table<IndexedDbVectorRecord, string>;
  fileIndex!: Dexie.Table<FileIndexRecord, string>;
  meta!: Dexie.Table<VectorStoreMetaRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      vectors: 'id, filePath, updated',
    });
    this.version(2).stores({
      vectors: 'id, filePath, updated',
      fileIndex: 'filePath, updated',
    });
    this.version(3)
      .stores({
        vectors:
          'id, filePath, embeddingProvider, embeddingModel, dimension, [embeddingProvider+embeddingModel+dimension], updated',
        fileIndex: 'filePath, updated',
        meta: 'key',
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
  runtimeIndex?: RustVectorRuntimeIndex | null,
): Promise<VectorEntry[]> {
  throwIfAborted(signal);
  const rustScores =
    runtimeIndex?.rankTopK(vector, topK) ??
    rankTopKPairsRust(
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

function scoredSearch(
  entries: readonly VectorEntry[],
  request: VectorSearchRequest,
  runtimeIndex?: RustVectorRuntimeIndex | null,
  ivfIndex?: RustIvfRuntimeIndex | null,
): Promise<VectorSearchResult[]> {
  throwIfAborted(request.signal);
  const topK = Math.max(0, Math.floor(request.topK));
  if (topK <= 0) return Promise.resolve([]);
  const hasFilter = hasVectorSearchFilter(request.filter);
  const searchEntries = hasFilter
    ? entries.filter((entry) => matchesVectorSearchFilter(entry, request.filter))
    : entries;
  const mode =
    request.mode === 'ann' && searchEntries.length >= Math.max(1, request.annMinEntryCount ?? 1)
      ? 'ann'
      : 'exact';
  const rustScores = rankSearchEntries(searchEntries, request, topK, mode, runtimeIndex, ivfIndex);
  if (rustScores === null) return Promise.resolve([]);
  throwIfAborted(request.signal);
  const selected: VectorSearchResult[] = [];
  for (const result of rustScores) {
    const resultIndex = result.index;
    if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= searchEntries.length) {
      continue;
    }
    const entry = searchEntries[resultIndex];
    if (entry) {
      selected.push({ entry, score: result.score, mode });
    }
  }
  return Promise.resolve(selected);
}

function rankSearchEntries(
  entries: readonly VectorEntry[],
  request: VectorSearchRequest,
  topK: number,
  mode: 'exact' | 'ann',
  runtimeIndex?: RustVectorRuntimeIndex | null,
  ivfIndex?: RustIvfRuntimeIndex | null,
): RustVectorScore[] | null {
  if (mode === 'ann') {
    return (
      ivfIndex?.query(request.queryVector, topK, request.annProbeCount ?? 4) ??
      rankTopKPairsRust(
        request.queryVector,
        entries.map((entry) => entry.vector),
        topK,
      )
    );
  }
  return (
    runtimeIndex?.rankTopK(request.queryVector, topK) ??
    rankTopKPairsRust(
      request.queryVector,
      entries.map((entry) => entry.vector),
      topK,
    )
  );
}

function hasVectorSearchFilter(filter?: VectorSearchFilter): boolean {
  return !!(
    filter?.embeddingProvider ||
    filter?.embeddingModel ||
    typeof filter?.dimension === 'number'
  );
}

const VECTOR_SEARCH_ALL_KEY = '__all__';

function vectorSearchFilterKey(filter?: VectorSearchFilter): string {
  if (!hasVectorSearchFilter(filter)) return VECTOR_SEARCH_ALL_KEY;
  return [
    filter?.embeddingProvider ?? '',
    filter?.embeddingModel ?? '',
    typeof filter?.dimension === 'number' ? String(filter.dimension) : '',
  ].join('\u0000');
}

function matchesVectorSearchFilter(entry: VectorEntry, filter?: VectorSearchFilter): boolean {
  if (!filter) return true;
  if (
    filter.embeddingProvider &&
    entry.metadata.embeddingProvider &&
    entry.metadata.embeddingProvider !== filter.embeddingProvider
  ) {
    return false;
  }
  if (
    filter.embeddingModel &&
    entry.metadata.embeddingModel &&
    entry.metadata.embeddingModel !== filter.embeddingModel
  ) {
    return false;
  }
  if (typeof filter.dimension === 'number' && entry.vector.length !== filter.dimension) {
    return false;
  }
  return true;
}

function matchesVectorRecordSearchFilter(
  record: IndexedDbVectorRecord,
  filter?: VectorSearchFilter,
): boolean {
  if (!filter) return true;
  const embeddingProvider = record.embeddingProvider ?? record.metadata.embeddingProvider;
  const embeddingModel = record.embeddingModel ?? record.metadata.embeddingModel;
  if (
    filter.embeddingProvider &&
    embeddingProvider &&
    embeddingProvider !== filter.embeddingProvider
  ) {
    return false;
  }
  if (
    filter.embeddingModel &&
    embeddingModel &&
    embeddingModel !== filter.embeddingModel
  ) {
    return false;
  }
  if (
    typeof filter.dimension === 'number' &&
    getVectorRecordDimension(record) !== filter.dimension
  ) {
    return false;
  }
  return true;
}

function vectorRecordFromEntry(entry: VectorEntry, updated: number): IndexedDbVectorRecord {
  return {
    id: entry.id,
    vectorBuffer: vectorToArrayBuffer(entry.vector),
    dimension: entry.vector.length,
    metadata: { ...entry.metadata },
    filePath: entry.metadata.filePath,
    embeddingProvider: entry.metadata.embeddingProvider,
    embeddingModel: entry.metadata.embeddingModel,
    updated,
  };
}

function vectorEntryFromRecord(record: IndexedDbVectorRecord): VectorEntry {
  return {
    id: record.id,
    vector: vectorFromRecord(record),
    metadata: { ...record.metadata },
  };
}

function vectorEntryFromRecordWithUpdated(record: IndexedDbVectorRecord): VectorEntry & { updated?: number } {
  return {
    ...vectorEntryFromRecord(record),
    updated: record.updated,
  };
}

function vectorToArrayBuffer(vector: readonly number[]): ArrayBuffer {
  const values = new Float32Array(vector.length);
  values.set(vector);
  return values.buffer.slice(0);
}

function vectorFromRecord(record: IndexedDbVectorRecord): number[] {
  if (record.vectorBuffer instanceof ArrayBuffer) {
    return Array.from(new Float32Array(record.vectorBuffer));
  }
  if (Array.isArray(record.vector)) {
    return [...record.vector];
  }
  return [];
}

function getVectorRecordDimension(record: IndexedDbVectorRecord): number {
  return record.dimension || vectorFromRecord(record).length;
}

function isVectorEntryLike(value: unknown): value is VectorEntry {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (!Array.isArray(value.vector) || !value.vector.every((item) => typeof item === 'number')) {
    return false;
  }
  const metadata = value.metadata;
  return isRecord(metadata) && typeof metadata.filePath === 'string' && typeof metadata.startLine === 'number' && typeof metadata.text === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

class BoundedLruCache<K, V> {
  private readonly limit: number;
  private readonly onEvict?: (value: V) => void;
  private readonly values = new Map<K, V>();

  constructor(limit: number, onEvict?: (value: V) => void) {
    this.limit = Math.max(0, Math.floor(limit));
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.values.size;
  }

  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const existing = this.values.get(key);
    if (existing !== undefined) {
      this.values.delete(key);
      if (existing !== value) {
        this.onEvict?.(existing);
      }
    }
    if (this.limit === 0) {
      this.onEvict?.(value);
      return;
    }
    this.values.set(key, value);
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next();
      const oldestKey = oldest.value;
      if (oldestKey === undefined) break;
      const oldestValue = this.values.get(oldestKey);
      this.values.delete(oldestKey);
      if (oldestValue !== undefined) {
        this.onEvict?.(oldestValue);
      }
    }
  }

  clear(): void {
    for (const value of this.values.values()) {
      this.onEvict?.(value);
    }
    this.values.clear();
  }
}

/** Dexie/IndexedDB 기반 로컬 벡터 저장소 */
export class IndexedDbVectorStore implements VectorStore {
  private db: VectorStoreDB;
  private entriesCache: VectorEntry[] | null = null;
  private runtimeIndex: RustVectorRuntimeIndex | null = null;
  private searchEntriesCache: BoundedLruCache<string, VectorEntry[]>;
  private filteredRuntimeIndexes: BoundedLruCache<string, RustVectorRuntimeIndex>;
  private ivfRuntimeIndexes: BoundedLruCache<string, RustIvfRuntimeIndex>;
  private readonly hydrateAllEntryLimit: number;
  private readonly pageSize: number;
  private readonly maxRuntimePayloadBytes: number;

  constructor(
    dbName = 'SuperpowerInsideVectorStore',
    options: IndexedDbVectorStoreOptions = {},
  ) {
    this.db = new VectorStoreDB(dbName);
    this.hydrateAllEntryLimit = Math.max(
      1,
      Math.floor(options.hydrateAllEntryLimit ?? DEFAULT_HYDRATE_ALL_ENTRY_LIMIT),
    );
    this.pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_VECTOR_SEARCH_PAGE_SIZE));
    this.maxRuntimePayloadBytes = Math.max(
      4,
      Math.floor(options.maxRuntimePayloadBytes ?? DEFAULT_RUNTIME_PAYLOAD_BUDGET_BYTES),
    );
    this.searchEntriesCache = new BoundedLruCache(
      options.searchCacheLimit ?? DEFAULT_SEARCH_CACHE_LIMIT,
    );
    this.filteredRuntimeIndexes = new BoundedLruCache(
      options.runtimeIndexCacheLimit ?? DEFAULT_RUNTIME_INDEX_CACHE_LIMIT,
      (index) => index.dispose(),
    );
    this.ivfRuntimeIndexes = new BoundedLruCache(
      options.ivfRuntimeIndexCacheLimit ?? DEFAULT_IVF_RUNTIME_INDEX_CACHE_LIMIT,
      (index) => index.dispose(),
    );
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const records = newEntries.map((entry) => vectorRecordFromEntry(entry, now));
    await this.db.vectors.bulkPut(records);
    await this.upsertFileIndexRecords(newEntries, now);
    this.invalidateRuntimeCache();
  }

  async replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const records = entries.map((entry) => vectorRecordFromEntry(entry, now));
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
    this.invalidateRuntimeIndex();
  }

  async removeByFilePath(filePath: string): Promise<number> {
    const removed = await this.db.vectors.where('filePath').equals(filePath).delete();
    await this.db.fileIndex.delete(filePath);
    if (this.entriesCache) {
      this.entriesCache = this.entriesCache.filter((entry) => entry.metadata.filePath !== filePath);
    }
    this.invalidateRuntimeIndex();
    return removed;
  }

  async query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]> {
    const results = await this.search({
      queryVector: vector,
      topK,
      signal,
    });
    return results.map((result) => result.entry);
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const totalEntries = await this.db.vectors.count();
    if (totalEntries > this.hydrateAllEntryLimit) {
      return this.searchPagedExact(request);
    }
    const key = vectorSearchFilterKey(request.filter);
    const entries = await this.getSearchEntries(key, request.filter);
    const mode =
      request.mode === 'ann' && entries.length >= Math.max(1, request.annMinEntryCount ?? 1)
        ? 'ann'
        : 'exact';
    const runtimeIndex = mode === 'exact' ? this.getRuntimeIndexForKey(key, entries) : null;
    const ivfIndex = mode === 'ann' ? this.getIvfRuntimeIndexForKey(key, entries, request) : null;
    return scoredSearch(entries, { ...request, filter: undefined }, runtimeIndex, ivfIndex);
  }

  getRuntimeCacheStats(): VectorRuntimeCacheStats {
    return {
      entriesCacheLoaded: this.entriesCache !== null,
      searchEntriesCacheSize: this.searchEntriesCache.size,
      filteredRuntimeIndexCount: this.filteredRuntimeIndexes.size,
      ivfRuntimeIndexCount: this.ivfRuntimeIndexes.size,
    };
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.vectors, this.db.fileIndex, async () => {
      await this.db.vectors.clear();
      await this.db.fileIndex.clear();
    });
    this.entriesCache = [];
    this.invalidateRuntimeIndex();
  }

  async getMetaValue<T>(key: string): Promise<T | undefined> {
    const record = await this.db.meta.get(key);
    return record?.value as T | undefined;
  }

  async setMetaValue(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value, updated: Date.now() });
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
    return records.map(vectorEntryFromRecord);
  }

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    if (ids.length === 0) return [];
    const records = await this.db.vectors.bulkGet([...ids]);
    return records
      .filter((record): record is IndexedDbVectorRecord => record !== undefined)
      .map(vectorEntryFromRecord);
  }

  async getEntries(): Promise<VectorEntry[]> {
    return copyEntries(await this.getCachedEntries());
  }

  private async getCachedEntries(): Promise<VectorEntry[]> {
    if (this.entriesCache) return this.entriesCache;
    const records = await this.db.vectors.toArray();
    this.entriesCache = records.map(vectorEntryFromRecord);
    return this.entriesCache;
  }

  private async getSearchEntries(
    key: string,
    filter?: VectorSearchFilter,
  ): Promise<VectorEntry[]> {
    const cached = this.searchEntriesCache.get(key);
    if (cached) return cached;
    const entries = await this.getCachedEntries();
    const filtered = hasVectorSearchFilter(filter)
      ? entries.filter((entry) => matchesVectorSearchFilter(entry, filter))
      : entries;
    this.searchEntriesCache.set(key, filtered);
    return filtered;
  }

  private async searchPagedExact(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    throwIfAborted(request.signal);
    const topK = Math.max(0, Math.floor(request.topK));
    if (topK <= 0) return [];

    const selected: VectorSearchResult[] = [];
    let offset = 0;
    while (true) {
      throwIfAborted(request.signal);
      const records = await this.db.vectors
        .orderBy('id')
        .offset(offset)
        .limit(this.pageSize)
        .toArray();
      if (records.length === 0) break;

      const entries = records
        .filter((record) => matchesVectorRecordSearchFilter(record, request.filter))
        .map(vectorEntryFromRecord);
      this.enforceRuntimeBoundary(entries);
      const pageResults = await scoredSearch(
        entries,
        {
          ...request,
          mode: 'exact',
          filter: undefined,
          topK,
        },
        null,
        null,
      );
      selected.push(...pageResults);
      selected.sort((left, right) => right.score - left.score);
      selected.splice(topK);

      offset += records.length;
      if (records.length < this.pageSize) break;
    }
    return selected;
  }

  private enforceRuntimeBoundary(entries: readonly VectorEntry[]): void {
    for (const page of createPagedVectorMatrix(
      entries.map((entry) => ({ id: entry.id, vector: entry.vector })),
      { pageSize: this.pageSize },
    )) {
      enforceRuntimePayloadBudget(page, this.maxRuntimePayloadBytes);
    }
  }

  private getRuntimeIndex(entries: readonly VectorEntry[]): RustVectorRuntimeIndex | null {
    if (this.runtimeIndex) return this.runtimeIndex;
    this.runtimeIndex = createVectorRuntimeIndex(entries);
    return this.runtimeIndex;
  }

  private getRuntimeIndexForKey(
    key: string,
    entries: readonly VectorEntry[],
  ): RustVectorRuntimeIndex | null {
    if (key === VECTOR_SEARCH_ALL_KEY) return this.getRuntimeIndex(entries);
    const cached = this.filteredRuntimeIndexes.get(key);
    if (cached) return cached;
    const next = createVectorRuntimeIndex(entries);
    if (next) this.filteredRuntimeIndexes.set(key, next);
    return next;
  }

  private getIvfRuntimeIndexForKey(
    key: string,
    entries: readonly VectorEntry[],
    request: VectorSearchRequest,
  ): RustIvfRuntimeIndex | null {
    const indexKey = `${key}::${Math.max(0, Math.floor(request.annClusterCount ?? 0))}`;
    const cached = this.ivfRuntimeIndexes.get(indexKey);
    if (cached) return cached;
    const next = RustIvfRuntimeIndex.build(
      entries.map((entry) => entry.vector),
      request.annClusterCount ?? 0,
      4,
    );
    if (next) this.ivfRuntimeIndexes.set(indexKey, next);
    return next;
  }

  private invalidateRuntimeCache(): void {
    this.entriesCache = null;
    this.invalidateRuntimeIndex();
  }

  private invalidateRuntimeIndex(): void {
    this.runtimeIndex?.dispose();
    this.runtimeIndex = null;
    this.filteredRuntimeIndexes.clear();
    this.ivfRuntimeIndexes.clear();
    this.searchEntriesCache.clear();
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
    const fileRecords = fileIndexRecordsFromRust(records.map(vectorEntryFromRecordWithUpdated), 0);
    if (fileRecords.length > 0) {
      await this.db.fileIndex.bulkPut(fileRecords);
    }
  }
}

export async function importLegacyJsonVectorStore(
  adapter: DataAdapter,
  store: IndexedDbVectorStore,
  path = '.superpower-inside/vectors.json',
  options: LegacyJsonVectorImportOptions = {},
): Promise<LegacyJsonVectorImportResult> {
  if ((await store.getMetaValue<boolean>(LEGACY_JSON_VECTOR_IMPORT_KEY)) === true) {
    return { imported: 0, skipped: true };
  }

  const maxBytes = Math.max(
    1,
    Math.floor(options.maxBytes ?? DEFAULT_LEGACY_JSON_IMPORT_MAX_BYTES),
  );
  const stat = await statVaultPath(adapter, path);
  if (stat?.type === 'file' && stat.size > maxBytes) {
    return { imported: 0, skipped: true };
  }

  const data = await readJsonFromVault(adapter, path);
  const entries = Array.isArray(data)
    ? data.filter(isVectorEntryLike).map((entry) => ({
        id: entry.id,
        vector: [...entry.vector],
        metadata: { ...entry.metadata },
      }))
    : [];
  if (entries.length > 0) {
    await store.add(entries);
  }
  await store.setMetaValue(LEGACY_JSON_VECTOR_IMPORT_KEY, true);
  return { imported: entries.length, skipped: false };
}

async function statVaultPath(adapter: DataAdapter, path: string) {
  if (typeof adapter.stat !== 'function') return null;
  try {
    return await adapter.stat(path);
  } catch {
    return null;
  }
}

/** 간단한 인메모리 벡터 저장소 (테스트/폴백용) */
export class MemoryVectorStore implements VectorStore {
  private entries: VectorEntry[];
  private runtimeIndex: RustVectorRuntimeIndex | null = null;
  private ivfRuntimeIndexes = new BoundedLruCache<string, RustIvfRuntimeIndex>(
    DEFAULT_IVF_RUNTIME_INDEX_CACHE_LIMIT,
    (index) => index.dispose(),
  );

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
    this.invalidateRuntimeIndex();
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
    this.invalidateRuntimeIndex();
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
    this.invalidateRuntimeIndex();
    return Promise.resolve(removed);
  }

  async query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]> {
    return scoredQuery(this.entries, vector, topK, signal, this.getRuntimeIndex());
  }

  search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const mode =
      request.mode === 'ann' && this.entries.length >= Math.max(1, request.annMinEntryCount ?? 1)
        ? 'ann'
        : 'exact';
    return scoredSearch(
      this.entries,
      request,
      mode === 'exact' ? this.getRuntimeIndex() : null,
      mode === 'ann' ? this.getIvfRuntimeIndex(request) : null,
    );
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.invalidateRuntimeIndex();
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

  private getRuntimeIndex(): RustVectorRuntimeIndex | null {
    if (this.runtimeIndex) return this.runtimeIndex;
    this.runtimeIndex = createVectorRuntimeIndex(this.entries);
    return this.runtimeIndex;
  }

  private invalidateRuntimeIndex(): void {
    this.runtimeIndex?.dispose();
    this.runtimeIndex = null;
    this.ivfRuntimeIndexes.clear();
  }

  private getIvfRuntimeIndex(request: VectorSearchRequest): RustIvfRuntimeIndex | null {
    const key = String(Math.max(0, Math.floor(request.annClusterCount ?? 0)));
    const cached = this.ivfRuntimeIndexes.get(key);
    if (cached) return cached;
    const next = RustIvfRuntimeIndex.build(
      this.entries.map((entry) => entry.vector),
      request.annClusterCount ?? 0,
      4,
    );
    if (next) this.ivfRuntimeIndexes.set(key, next);
    return next;
  }
}

function createVectorRuntimeIndex(entries: readonly VectorEntry[]): RustVectorRuntimeIndex | null {
  return RustVectorRuntimeIndex.build(entries.map((entry) => entry.vector));
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
