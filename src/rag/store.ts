import Dexie from 'dexie';
import { DURABILITY_RECEIPT_KEY, readStoreMutationReceipt, stampStoreMutation, type StoreMutationReceipt } from './durability';
import type { SourceMetadata } from './source-access';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';
import type { DataAdapter } from 'obsidian';
import { readJsonFromVault } from '../utils/vault';
import {
  planFileIndexRecordsRust,
  planSourceChunkImportIndicesRust,
  planVectorStoreAddRust,
  planVectorStoreLookupByFilePathsRust,
  planVectorStoreLookupByIdsRust,
  planVectorStoreRemoveFileRust,
  planVectorStoreReplaceFileRust,
  planVectorFileIndexBatchRust,
  planVectorRecordBatchRust,
  planVectorStoreStatsRust,
  rankTopKPairsRust,
  RustIvfRuntimeIndex,
  RustVectorRuntimeIndex,
  type RustVectorStoreMutationPlan,
  type RustFileIndexEntryInput,
  type RustVectorScore,
} from './rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';
import { createPagedVectorMatrix, enforceRuntimePayloadBudget } from './runtime-boundary';
import {
  VectorSearchWorkerRuntime,
  canUseVectorSearchWorker,
} from './vector-search-worker-runtime';

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: {
    filePath: string;
    heading?: string;
    title?: string;
    headings?: string[];
    tags?: string[];
    aliases?: string[];
    startLine: number;
    endLine?: number;
    text: string;
    sourceMtime?: number;
    sourceSize?: number;
    contentHash?: string;
    chunkHash?: string;
    sourceSegment?: number;
    sourceMetadataHash?: string;
    indexedAt?: number;
    embeddingProvider?: string;
    embeddingModel?: string;
  };
}

export interface FileIndexRecord {
  sourceMetadata?: SourceMetadata;
  sourceMetadataHash?: string;
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

export interface VectorStoreDurabilityCheckpoint {
  receipt: StoreMutationReceipt | null;
  pendingWrites: number;
  recoveryPending: boolean;
}

export interface IndexedDbVectorStoreOptions {
  artifactOwnership?: GeneratedArtifactBinding;
  hydrateAllEntryLimit?: number;
  pageSize?: number;
  maxRuntimePayloadBytes?: number;
  searchCacheLimit?: number;
  runtimeIndexCacheLimit?: number;
  ivfRuntimeIndexCacheLimit?: number;
  vectorSearchWorkerFactory?: () => VectorSearchWorkerLike;
}

export interface VectorSearchWorkerSearchStats {
  revision: number | null;
  cacheHit: boolean;
  indexBytes: number;
  indexedCount: number;
  /** 작업자가 실제로 수행한 검색 방식입니다. */
  mode?: 'exact' | 'ann';
  /** 색인 생성과 질의 계산에 쓴 시간입니다. */
  buildMs?: number;
  queryMs?: number;
}

export interface VectorSearchWorkerLike {
  search(input: {
    dbName: string;
    queryVector: readonly number[];
    topK: number;
    filter?: VectorSearchFilter;
    signal?: AbortSignal;
    /** 스토어 변경 세대. 작업자 색인 캐시 키에 포함된다. */
    revision?: number;
    mode?: 'exact' | 'ann';
    annMinEntryCount?: number;
    annClusterCount?: number;
    annProbeCount?: number;
  }): Promise<Array<{ id: string; score: number }>>;
  readonly lastSearchStats?: VectorSearchWorkerSearchStats | null;
  close(reason?: Error): void;
}

export interface VectorRuntimeCacheStats {
  entriesCacheLoaded: boolean;
  searchEntriesCacheSize: number;
  filteredRuntimeIndexCount: number;
  ivfRuntimeIndexCount: number;
  workerSearchActive: boolean;
  /** 마지막 작업자 검색이 색인 세대를 재사용했는지(cold/warm)와 메모리 사용량입니다. */
  searchCacheHit: boolean;
  searchIndexBytes: number;
  searchRevision: number;
  /** 마지막 검색이 세대 불일치로 구세대 결과를 버렸는지(불완전 표시)입니다. */
  searchStale: boolean;
  /** 작업자 검색이 실패해 정확 검색으로 내려갔는지와 이유입니다. */
  searchDegraded: boolean;
  searchFallbackReason: string | null;
}

export interface VectorSearchFilter {
  embeddingProvider?: string;
  embeddingModel?: string;
  dimension?: number;
  filePathPrefixes?: readonly string[];
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

export interface FileIndexReadOptions { repair?: boolean }

export class FileIndexRepairRequiredError extends Error {
  constructor() { super('RAG file index repair required'); this.name = 'FileIndexRepairRequiredError'; }
}

export interface VectorStore {
  getDurabilityCheckpoint?(): Promise<VectorStoreDurabilityCheckpoint>;
  initializeEmptyDurabilityReceipt?(): Promise<StoreMutationReceipt | null>;
  add(entries: VectorEntry[]): Promise<void>;
  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void>;
  /** 여러 파일의 벡터를 하나의 트랜잭션으로 교체합니다. */
  replaceBatchFileEntries(
    batches: readonly { filePath: string; entries: VectorEntry[]; sourceMetadata?: SourceMetadata; sourceMetadataHash?: string }[],
  ): Promise<void>;
  markFileIndexedWithoutVectors(record: Omit<FileIndexRecord, 'vectorCount'>): Promise<void>;
  /** 내용은 같고 mtime/size만 변한 파일의 revision만 갱신하고 기존 벡터는 보존합니다. */
  refreshFileIndexRevision(
    record: Pick<FileIndexRecord, 'filePath' | 'sourceMtime' | 'sourceSize' | 'contentHash' | 'sourceMetadata' | 'sourceMetadataHash'>,
  ): Promise<boolean>;
  removeByFilePath(filePath: string): Promise<number>;
  query(vector: number[], topK: number, signal?: AbortSignal): Promise<VectorEntry[]>;
  search(request: VectorSearchRequest): Promise<VectorSearchResult[]>;
  clear(): Promise<void>;
  persist(): Promise<void>;
  withBatch<T>(operation: () => Promise<T>): Promise<T>;
  getStats(): Promise<VectorStoreStats>;
  /** 후보 검색의 exact/ann 판단에 쓰는 저렴한 벡터 수입니다. */
  getEntryCount?(): Promise<number>;
  getIndexedFilePaths(): Promise<string[]>;
  getFileIndexRecord(filePath: string): Promise<FileIndexRecord | null>;
  getFileIndexRecords(options?: FileIndexReadOptions): Promise<FileIndexRecord[]>;
  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]>;
  getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]>;
  getEntries(): Promise<VectorEntry[]>;
  getMetaValue?<T>(key: string): Promise<T | undefined>;
  setMetaValue?(key: string, value: unknown): Promise<void>;
  /** 중단된 파일 쓰기 원장을 읽고 내구 복구 요청으로 등록한 뒤 비웁니다. */
  probePendingFileWrites?(): Promise<string[]>;
  /** corpus·lexical 쓰기 전에 복구 요청을 내구 등록합니다. */
  beginPendingWriteRecovery?(filePaths: readonly string[], owner?: string): Promise<void>;
  /** 아직 완료되지 않은 내구 복구 요청입니다. */
  readPendingWriteRecovery?(): Promise<string[]>;
  /** 재색인·삭제가 끝난 경로를 복구 요청에서 제거합니다. */
  completePendingWriteRecovery?(filePaths: readonly string[], owner?: string): Promise<void>;
  close(): void;
}

export interface VectorStoreReconciliationResult {
  deletedFilePaths: string[];
  remainingStaleCount: number;
}

export interface VectorStoreReconciliationBatchResult {
  deletedFilePaths: string[];
  deletedVectorIds: string[];
  complete: boolean;
}

export interface VectorStoreHealthProbe {
  queryable: boolean;
  embeddingContractMatches: boolean;
  dimension: number | null;
}

export interface LegacyJsonVectorImportResult {
  imported: number;
  skipped: boolean;
}

export interface LegacyJsonVectorImportOptions {
  maxBytes?: number;
  requireSourceChunkIds?: boolean;
}

const LEGACY_JSON_VECTOR_IMPORT_KEY = 'legacy-json-vector-import:v1';
const DEFAULT_LEGACY_JSON_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_HYDRATE_ALL_ENTRY_LIMIT = 4096;
const DEFAULT_VECTOR_SEARCH_PAGE_SIZE = 256;
const DEFAULT_RUNTIME_PAYLOAD_BUDGET_BYTES = 4 * 1024 * 1024;
const DEFAULT_SEARCH_CACHE_LIMIT = 4;
const DEFAULT_RUNTIME_INDEX_CACHE_LIMIT = 2;
const WORKER_SEARCH_REVISION_ATTEMPTS = 2;
const DEFAULT_IVF_RUNTIME_INDEX_CACHE_LIMIT = 2;
const DEFAULT_RECONCILIATION_PAGE_SIZE = 64;
/** 중단된 파일 쓰기의 내구 복구 요청을 담는 meta 키입니다. */
const VECTOR_WRITE_RECOVERY_KEY = 'write-recovery-requests:v1';

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
  updated?: number;
}

/** 파일 단위 벡터 쓰기의 시작/완료를 남기는 원장입니다. */
interface VectorPendingWriteRecord {
  filePath: string;
  updated: number;
}

class VectorStoreDB extends GeneratedArtifactDatabase {
  vectors!: Dexie.Table<IndexedDbVectorRecord, string>;
  fileIndex!: Dexie.Table<FileIndexRecord, string>;
  meta!: Dexie.Table<VectorStoreMetaRecord, string>;
  pendingWrites!: Dexie.Table<VectorPendingWriteRecord, string>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({
      vectors: 'id, filePath, updated',
    });
    this.version(2).stores({
      vectors: 'id, filePath, updated',
      fileIndex: 'filePath, updated',
    });
    this.version(3).stores({
      vectors:
        'id, filePath, embeddingProvider, embeddingModel, dimension, [embeddingProvider+embeddingModel+dimension], updated',
      fileIndex: 'filePath, updated',
      meta: 'key',
    });
    this.version(4).stores({
      vectors:
        'id, filePath, embeddingProvider, embeddingModel, dimension, [embeddingProvider+embeddingModel+dimension], updated',
      fileIndex: 'filePath, updated',
      meta: 'key',
      pendingWrites: 'filePath, updated',
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
    typeof filter?.dimension === 'number' ||
    (filter?.filePathPrefixes?.length ?? 0) > 0
  );
}

const VECTOR_SEARCH_ALL_KEY = '__all__';

function vectorSearchFilterKey(filter?: VectorSearchFilter): string {
  if (!hasVectorSearchFilter(filter)) return VECTOR_SEARCH_ALL_KEY;
  return [
    filter?.embeddingProvider ?? '',
    filter?.embeddingModel ?? '',
    typeof filter?.dimension === 'number' ? String(filter.dimension) : '',
    normalizeFilePathPrefixes(filter?.filePathPrefixes).join('\u0001'),
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
  if (!matchesFilePathPrefixes(entry.metadata.filePath, filter.filePathPrefixes)) return false;
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
  if (filter.embeddingModel && embeddingModel && embeddingModel !== filter.embeddingModel) {
    return false;
  }
  if (
    typeof filter.dimension === 'number' &&
    getVectorRecordDimension(record) !== filter.dimension
  ) {
    return false;
  }
  if (!matchesFilePathPrefixes(record.filePath, filter.filePathPrefixes)) return false;
  return true;
}

function normalizeFilePathPrefixes(prefixes: readonly string[] | undefined): string[] {
  return [
    ...new Set((prefixes ?? []).map((prefix) => prefix.trim().replace(/\/+$/, '')).filter(Boolean)),
  ].sort();
}

function matchesFilePathPrefixes(
  filePath: string,
  prefixes: readonly string[] | undefined,
): boolean {
  const normalized = normalizeFilePathPrefixes(prefixes);
  if (normalized.length === 0) return true;
  return normalized.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`));
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

function vectorEntryFromRecordWithUpdated(
  record: IndexedDbVectorRecord,
): VectorEntry & { updated?: number } {
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
  return (
    isRecord(metadata) &&
    typeof metadata.filePath === 'string' &&
    typeof metadata.startLine === 'number' &&
    typeof metadata.text === 'string'
  );
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
      if (oldest.done === true) break;
      const oldestKey = oldest.value;
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
  private entryCountCache: { receipt: StoreMutationReceipt; count: number } | null = null;
  private entriesCache: VectorEntry[] | null = null;
  private runtimeIndex: RustVectorRuntimeIndex | null = null;
  private searchEntriesCache: BoundedLruCache<string, VectorEntry[]>;
  private filteredRuntimeIndexes: BoundedLruCache<string, RustVectorRuntimeIndex>;
  private ivfRuntimeIndexes: BoundedLruCache<string, RustIvfRuntimeIndex>;
  private vectorSearchWorker: VectorSearchWorkerLike | null = null;
  private readonly vectorSearchWorkerFactory: () => VectorSearchWorkerLike;
  private mutationRevision = 0;
  private lastWorkerSearchStats: VectorSearchWorkerSearchStats | null = null;
  private lastSearchStale = false;
  private lastSearchDegraded = false;
  private lastSearchFallbackReason: string | null = null;
  private readonly vectorSearchWorkerAvailable: boolean;
  private readonly hydrateAllEntryLimit: number;
  private readonly pageSize: number;
  private readonly maxRuntimePayloadBytes: number;
  private reconciliationState: {
    key: string;
    phase: 'fileIndex' | 'vectors';
    cursor: string | null;
    validFilePaths: Set<string>;
  } | null = null;

  constructor(dbName = 'SuperpowerInsideVectorStore', options: IndexedDbVectorStoreOptions = {}) {
    this.db = new VectorStoreDB(dbName, options.artifactOwnership);
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
    this.vectorSearchWorkerFactory =
      options.vectorSearchWorkerFactory ?? (() => new VectorSearchWorkerRuntime());
    this.vectorSearchWorkerAvailable =
      options.vectorSearchWorkerFactory !== undefined || canUseVectorSearchWorker();
  }

  getDurabilityCheckpoint(): Promise<VectorStoreDurabilityCheckpoint> {
    return this.db.transaction('r', [this.db.meta, this.db.pendingWrites], async () => {
      const [receipt, pendingWrites, requests, owners] = await Promise.all([
        readStoreMutationReceipt(this.db.meta), this.db.pendingWrites.count(),
        this.db.meta.get(VECTOR_WRITE_RECOVERY_KEY), this.db.meta.get(`${VECTOR_WRITE_RECOVERY_KEY}:owners`),
      ]);
      return {
        receipt, pendingWrites,
        recoveryPending: [requests, owners].some((record) => record !== undefined && (!Array.isArray(record.value) || record.value.length > 0)),
      };
    });
  }

  initializeEmptyDurabilityReceipt(): Promise<StoreMutationReceipt | null> {
    return this.db.transaction('rw', [this.db.vectors, this.db.fileIndex, this.db.pendingWrites, this.db.meta], async () => {
      const checkpoint = await this.getDurabilityCheckpoint();
      if (checkpoint.receipt) return checkpoint.receipt;
      if (checkpoint.pendingWrites || checkpoint.recoveryPending || await this.db.vectors.count() || await this.db.fileIndex.count()) return null;
      return stampStoreMutation(this.db.meta);
    });
  }

  private commitMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', [this.db.vectors, this.db.fileIndex, this.db.pendingWrites, this.db.meta], async () => {
      const result = await operation();
      await stampStoreMutation(this.db.meta);
      return result;
    });
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const filePaths = uniqueFilePaths(newEntries);
    const records = newEntries.map((entry) => vectorRecordFromEntry(entry, now));
    await this.beginFileWrites(filePaths, now);
    await this.commitMutation(() => this.db.vectors.bulkPut(records));
    await this.upsertFileIndexRecords(newEntries, now);
    await this.finishFileWrites(filePaths);
    this.noteVectorMutation();
    this.invalidateRuntimeCache();
  }

  async replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    const now = Date.now();
    const records = entries.map((entry) => vectorRecordFromEntry(entry, now));
    await this.beginFileWrites([filePath], now);
    await this.commitMutation(async () => {
      await this.db.vectors.where('filePath').equals(filePath).delete();
      if (records.length > 0) {
        await this.db.vectors.bulkPut(records);
      }
    });
    if (entries.length > 0) {
      const [record] = fileIndexRecordsFromRust(entries, now);
      if (record) {
        await this.commitMutation(() => this.db.fileIndex.put(record));
      } else {
        await this.commitMutation(() => this.db.fileIndex.delete(filePath));
      }
    } else {
      await this.commitMutation(() => this.db.fileIndex.delete(filePath));
    }
    await this.finishFileWrites([filePath]);
    if (this.entriesCache) {
      this.entriesCache = [
        ...this.entriesCache.filter((entry) => entry.metadata.filePath !== filePath),
        ...copyEntries(entries),
      ];
    }
    this.noteVectorMutation();
    this.invalidateRuntimeIndex();
  }

  /** 여러 파일을 한 트랜잭션으로 교체해 파일마다 지불하던 커밋 비용을 나눕니다. */
  async replaceBatchFileEntries(
    batches: readonly { filePath: string; entries: VectorEntry[]; sourceMetadata?: SourceMetadata; sourceMetadataHash?: string }[],
  ): Promise<void> {
    if (batches.length === 0) return;
    const now = Date.now();
    const filePaths = batches.map((batch) => batch.filePath);
    const records = batches.flatMap((batch) =>
      batch.entries.map((entry) => vectorRecordFromEntry(entry, now)),
    );
    await this.commitMutation(
      async () => {
        await this.db.pendingWrites.bulkPut(filePaths.map((filePath) => ({ filePath, updated: now })));
        await this.db.vectors.where('filePath').anyOf([...filePaths]).delete();
        if (records.length > 0) await this.db.vectors.bulkPut(records);
        const fileRecords = batches.flatMap((batch) =>
          batch.entries.length > 0 ? fileIndexRecordsFromRust(batch.entries, now).map((record) => ({ ...record, ...(batch.sourceMetadata ? { sourceMetadata: batch.sourceMetadata, sourceMetadataHash: batch.sourceMetadataHash } : {}) })) : [],
        );
        if (fileRecords.length > 0) await this.db.fileIndex.bulkPut(fileRecords);
        const written = new Set(fileRecords.map((record) => record.filePath));
        const emptyByFile = filePaths.filter((filePath) => !written.has(filePath));
        if (emptyByFile.length > 0) await this.db.fileIndex.bulkDelete(emptyByFile);
        await this.db.pendingWrites.bulkDelete([...filePaths]);
      },
    );
    if (this.entriesCache) {
      const replaced = new Set(filePaths);
      this.entriesCache = [
        ...this.entriesCache.filter((entry) => !replaced.has(entry.metadata.filePath)),
        ...copyEntries(batches.flatMap((batch) => batch.entries)),
      ];
    }
    this.noteVectorMutation();
    this.invalidateRuntimeIndex();
  }

  async markFileIndexedWithoutVectors(record: Omit<FileIndexRecord, 'vectorCount'>): Promise<void> {
    await this.beginFileWrites([record.filePath], Date.now());
    await this.commitMutation(async () => {
      await this.db.vectors.where('filePath').equals(record.filePath).delete();
      await this.db.fileIndex.put({ ...record, vectorCount: 0 });
    });
    await this.finishFileWrites([record.filePath]);
    if (this.entriesCache) {
      this.entriesCache = this.entriesCache.filter(
        (entry) => entry.metadata.filePath !== record.filePath,
      );
    }
    this.noteVectorMutation();
    this.invalidateRuntimeIndex();
  }

  async refreshFileIndexRevision(
    record: Pick<FileIndexRecord, 'filePath' | 'sourceMtime' | 'sourceSize' | 'contentHash' | 'sourceMetadata' | 'sourceMetadataHash'>,
  ): Promise<boolean> {
    const existing = await this.db.fileIndex.get(record.filePath);
    if (!existing) return false;
    const updated = Date.now();
    await this.commitMutation(async () => {
      await this.db.vectors
        .where('filePath')
        .equals(record.filePath)
        .modify((vectorRecord) => {
          vectorRecord.metadata = {
            ...vectorRecord.metadata,
            sourceMtime: record.sourceMtime,
            sourceSize: record.sourceSize,
            contentHash: record.contentHash,
          };
          vectorRecord.updated = updated;
        });
      await this.db.fileIndex.put({
        ...existing,
        sourceMtime: record.sourceMtime,
        sourceSize: record.sourceSize,
        contentHash: record.contentHash,
        ...(record.sourceMetadata ? { sourceMetadata: record.sourceMetadata, sourceMetadataHash: record.sourceMetadataHash } : {}),
        updated,
      });
    });
    if (this.entriesCache) {
      this.entriesCache = this.entriesCache.map((entry) =>
        entry.metadata.filePath === record.filePath
          ? {
              ...entry,
              metadata: {
                ...entry.metadata,
                sourceMtime: record.sourceMtime,
                sourceSize: record.sourceSize,
                contentHash: record.contentHash,
              },
            }
          : entry,
      );
    }
    this.searchEntriesCache.clear();
    return true;
  }

  async removeByFilePath(filePath: string): Promise<number> {
    await this.beginFileWrites([filePath], Date.now());
    const removed = await this.commitMutation(() => this.db.vectors.where('filePath').equals(filePath).delete());
    const removedFileIndex = (await this.db.fileIndex.get(filePath)) !== undefined;
    await this.commitMutation(() => this.db.fileIndex.delete(filePath));
    await this.finishFileWrites([filePath]);
    if (this.entriesCache) {
      this.entriesCache = this.entriesCache.filter((entry) => entry.metadata.filePath !== filePath);
    }
    // 이미 없는 경로를 지우는 유지보수 호출까지 색인 세대를 바꾸면 검색 색인이 계속 무효화됩니다.
    if (removed > 0 || removedFileIndex) {
      this.noteVectorMutation();
      this.invalidateRuntimeIndex();
    }
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
    this.lastSearchStale = false;
    this.lastSearchDegraded = false;
    this.lastSearchFallbackReason = null;
    const totalEntries = await this.getEntryCount();
    if (totalEntries > this.hydrateAllEntryLimit) {
      if (this.vectorSearchWorkerAvailable) {
        try {
          return await this.searchInWorker(request);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          this.vectorSearchWorker?.close();
          this.vectorSearchWorker = null;
          // 예산·작업자 실패로 정확 검색에 위임할 때는 조용히 넘기지 않고 불완전/저하를 표시한다.
          this.lastSearchDegraded = true;
          this.lastSearchFallbackReason = error instanceof Error ? error.message : String(error);
        }
      }
      return this.searchPagedExact(request);
    }
    return this.searchCachedExact(request);
  }

  private async searchCachedExact(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    let results: VectorSearchResult[] = [];
    let stale = false;
    for (let attempt = 0; attempt < WORKER_SEARCH_REVISION_ATTEMPTS; attempt++) {
      const revision = this.mutationRevision;
      const key = vectorSearchFilterKey(request.filter);
      const entries = await this.getSearchEntries(key, request.filter);
      const mode =
        request.mode === 'ann' && entries.length >= Math.max(1, request.annMinEntryCount ?? 1)
          ? 'ann'
          : 'exact';
      const runtimeIndex = mode === 'exact' ? this.getRuntimeIndexForKey(key, entries) : null;
      const ivfIndex =
        mode === 'ann' ? this.getIvfRuntimeIndexForKey(key, entries, request) : null;
      results = await scoredSearch(entries, { ...request, filter: undefined }, runtimeIndex, ivfIndex);
      await this.afterSearchRead();
      stale = this.mutationRevision !== revision;
      if (!stale) break;
    }
    this.lastSearchStale = stale;
    return stale ? await this.dropRemovedSearchResults(results) : results;
  }

  getRuntimeCacheStats(): VectorRuntimeCacheStats {
    return {
      entriesCacheLoaded: this.entriesCache !== null,
      searchEntriesCacheSize: this.searchEntriesCache.size,
      filteredRuntimeIndexCount: this.filteredRuntimeIndexes.size,
      ivfRuntimeIndexCount: this.ivfRuntimeIndexes.size,
      workerSearchActive: this.vectorSearchWorker !== null,
      searchCacheHit: this.lastWorkerSearchStats?.cacheHit ?? false,
      searchIndexBytes: this.lastWorkerSearchStats?.indexBytes ?? 0,
      searchRevision: this.lastWorkerSearchStats?.revision ?? this.mutationRevision,
      searchStale: this.lastSearchStale,
      searchDegraded: this.lastSearchDegraded,
      searchFallbackReason: this.lastSearchFallbackReason,
    };
  }

  async clear(): Promise<void> {
    await this.commitMutation(async () => {
      await this.db.vectors.clear();
      await this.db.fileIndex.clear();
    });
    this.entriesCache = [];
    this.reconciliationState = null;
    this.noteVectorMutation();
    this.invalidateRuntimeIndex();
  }

  async deleteDatabase(): Promise<void> {
    this.entryCountCache = null;
    this.entriesCache = null;
    this.reconciliationState = null;
    this.closeVectorSearchWorker();
    this.invalidateRuntimeIndex();
    this.db.close({ disableAutoOpen: true });
    await Dexie.delete(this.db.name);
  }

  close(): void {
    this.entryCountCache = null;
    this.entriesCache = null;
    this.reconciliationState = null;
    this.closeVectorSearchWorker();
    this.invalidateRuntimeIndex();
    this.db.close({ disableAutoOpen: true });
  }

  async reconcileFileIndex(input: {
    validFilePaths: readonly string[];
    embeddingProvider: string;
    embeddingModel: string;
    maxDeletions?: number;
  }): Promise<VectorStoreReconciliationResult> {
    const validPaths = new Set(input.validFilePaths);
    const maxDeletions = Math.max(0, Math.floor(input.maxDeletions ?? 128));
    const stalePaths: string[] = [];
    let cursor: string | null = null;
    while (true) {
      const records = await this.readFileIndexPage(cursor, DEFAULT_RECONCILIATION_PAGE_SIZE);
      if (records.length === 0) break;
      const plan = planVectorFileIndexBatchRust(
        records.map((record) => ({
          filePath: record.filePath,
          isEligible: validPaths.has(record.filePath),
          hasCompleteMetadata: record.hasCompleteMetadata === true,
          embeddingProvider: record.embeddingProvider,
          embeddingModel: record.embeddingModel,
        })),
        input.embeddingProvider,
        input.embeddingModel,
        records.length,
      );
      if (!plan) throw new Error('Rust vector file-index batch planning failed');
      stalePaths.push(...plan);
      cursor = records.at(-1)?.filePath ?? null;
      if (records.length < DEFAULT_RECONCILIATION_PAGE_SIZE) break;
      await yieldToEventLoop();
    }
    const deleteFilePaths = stalePaths.slice(0, maxDeletions);
    if (deleteFilePaths.length > 0) await this.deleteFilePaths(deleteFilePaths);
    return {
      deletedFilePaths: deleteFilePaths,
      remainingStaleCount: Math.max(0, stalePaths.length - deleteFilePaths.length),
    };
  }

  async probeActiveHealth(input: {
    candidateFilePaths: readonly string[];
    embeddingProvider: string;
    embeddingModel: string;
  }): Promise<VectorStoreHealthProbe> {
    if (input.candidateFilePaths.length === 0) {
      return { queryable: true, embeddingContractMatches: true, dimension: null };
    }
    for (
      let offset = 0;
      offset < input.candidateFilePaths.length;
      offset += DEFAULT_RECONCILIATION_PAGE_SIZE
    ) {
      const paths = input.candidateFilePaths.slice(
        offset,
        offset + DEFAULT_RECONCILIATION_PAGE_SIZE,
      );
      const fileRecords = await this.db.fileIndex.bulkGet(paths);
      const eligiblePaths = paths.filter((_, index) => {
        const fileRecord = fileRecords[index];
        return (
          fileRecord?.hasCompleteMetadata === true &&
          fileRecord.embeddingProvider === input.embeddingProvider &&
          fileRecord.embeddingModel === input.embeddingModel
        );
      });
      const vectors = await Promise.all(
        eligiblePaths.map((path) => this.db.vectors.where('filePath').equals(path).first()),
      );
      for (const vectorRecord of vectors) {
        if (!vectorRecord || !isCompleteVectorMetadata(vectorRecord)) continue;
        const dimension = getVectorRecordDimension(vectorRecord);
        const embeddingProvider =
          vectorRecord.embeddingProvider ?? vectorRecord.metadata.embeddingProvider;
        const embeddingModel = vectorRecord.embeddingModel ?? vectorRecord.metadata.embeddingModel;
        if (
          dimension > 0 &&
          vectorFromRecord(vectorRecord).length > 0 &&
          embeddingProvider === input.embeddingProvider &&
          embeddingModel === input.embeddingModel
        ) {
          return { queryable: true, embeddingContractMatches: true, dimension };
        }
      }
      await yieldToEventLoop();
    }
    return { queryable: false, embeddingContractMatches: false, dimension: null };
  }

  async reconcileBatch(input: {
    lifecycleKey: string;
    validFilePaths: readonly string[];
    embeddingProvider: string;
    embeddingModel: string;
    expectedDimension: number;
    pageSize?: number;
  }): Promise<VectorStoreReconciliationBatchResult> {
    const pageSize = Math.max(1, Math.floor(input.pageSize ?? DEFAULT_RECONCILIATION_PAGE_SIZE));
    if (!this.reconciliationState || this.reconciliationState.key !== input.lifecycleKey) {
      this.reconciliationState = {
        key: input.lifecycleKey,
        phase: 'fileIndex',
        cursor: null,
        validFilePaths: new Set(input.validFilePaths),
      };
    }
    const state = this.reconciliationState;
    if (state.phase === 'fileIndex') {
      const records = await this.readFileIndexPage(state.cursor, pageSize);
      const validPaths = state.validFilePaths;
      const deleteFilePaths = planVectorFileIndexBatchRust(
        records.map((record) => ({
          filePath: record.filePath,
          isEligible: validPaths.has(record.filePath),
          hasCompleteMetadata: record.hasCompleteMetadata === true,
          embeddingProvider: record.embeddingProvider,
          embeddingModel: record.embeddingModel,
        })),
        input.embeddingProvider,
        input.embeddingModel,
        pageSize,
      );
      if (!deleteFilePaths) throw new Error('Rust vector file-index batch planning failed');
      state.cursor = records.at(-1)?.filePath ?? state.cursor;
      if (deleteFilePaths.length > 0) await this.deleteFilePaths(deleteFilePaths);
      if (records.length < pageSize) {
        state.phase = 'vectors';
        state.cursor = null;
      }
      await yieldToEventLoop();
      return { deletedFilePaths: deleteFilePaths, deletedVectorIds: [], complete: false };
    }

    const records = await this.readVectorPage(state.cursor, pageSize);
    const filePaths = [...new Set(records.map((record) => record.filePath))];
    const fileRecords = await this.db.fileIndex.bulkGet(filePaths);
    const fileRecordByPath = new Map<string, FileIndexRecord>();
    for (let index = 0; index < filePaths.length; index++) {
      const fileRecord = fileRecords[index];
      const filePath = filePaths[index];
      if (fileRecord && filePath) fileRecordByPath.set(filePath, fileRecord);
    }
    const deleteVectorIds = planVectorRecordBatchRust(
      records.map((record) => {
        const fileRecord = fileRecordByPath.get(record.filePath);
        return {
          id: record.id,
          embeddingProvider: record.embeddingProvider ?? record.metadata.embeddingProvider,
          embeddingModel: record.embeddingModel ?? record.metadata.embeddingModel,
          dimension: getVectorRecordDimension(record),
          fileIndexExists: fileRecord !== undefined,
          metadataComplete: isCompleteVectorMetadata(record),
          contentHash: record.metadata.contentHash,
          fileContentHash: fileRecord?.contentHash,
          updated: record.updated,
          fileUpdated: fileRecord?.updated,
        };
      }),
      input.embeddingProvider,
      input.embeddingModel,
      input.expectedDimension,
      pageSize,
    );
    if (!deleteVectorIds) throw new Error('Rust vector record batch planning failed');
    state.cursor = records.at(-1)?.id ?? state.cursor;
    if (deleteVectorIds.length > 0) {
      await this.commitMutation(() => this.db.vectors.bulkDelete(deleteVectorIds));
      this.invalidateRuntimeCache();
    }
    const complete = records.length < pageSize;
    if (complete) this.reconciliationState = null;
    await yieldToEventLoop();
    return { deletedFilePaths: [], deletedVectorIds: deleteVectorIds, complete };
  }

  async getMetaValue<T>(key: string): Promise<T | undefined> {
    const record = await this.db.meta.get(key);
    return record?.value as T | undefined;
  }

  async setMetaValue(key: string, value: unknown): Promise<void> {
    if (key === DURABILITY_RECEIPT_KEY) throw new Error('rag-durability-reserved-key');
    await this.commitMutation(() => this.db.meta.put({ key, value, updated: Date.now() }));
  }

  async persist(): Promise<void> {
    // IndexedDB는 각 쓰기 작업이 트랜잭션으로 즉시 반영되므로 별도 flush가 필요 없습니다.
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  /** 후보 검색의 exact/ann 판단에 쓰는 저렴한 벡터 수입니다. */
  async getEntryCount(): Promise<number> {
    // 상위 transaction의 범위와 아직 commit되지 않은 쓰기의 가시성을 유지합니다.
    if (Dexie.currentTransaction) return this.db.vectors.count();
    const observation = await this.db.transaction('r', [this.db.meta, this.db.vectors], async () => {
      const receipt = await readStoreMutationReceipt(this.db.meta);
      const cached = this.entryCountCache;
      if (receipt && cached && receipt.incarnation === cached.receipt.incarnation &&
          receipt.mutation === cached.receipt.mutation) return cached;
      return { receipt, count: await this.db.vectors.count() };
    });
    // receipt와 count를 같은 snapshot에서 읽고, 성공적으로 정착한 결과만 보관합니다.
    this.entryCountCache = observation.receipt && this.db.isOpen()
      ? { receipt: observation.receipt, count: observation.count }
      : null;
    return observation.count;
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

  async getFileIndexRecord(filePath: string): Promise<FileIndexRecord | null> {
    const record = await this.db.fileIndex.get(filePath);
    if (record) return record;
    // 요청 경로에 벡터가 없으면 전체 파일 기록을 복구해도 얻을 행이 없습니다.
    const vector = await this.db.vectors.where('filePath').equals(filePath).first();
    if (!vector) return null;
    await this.rebuildFileIndexFromVectors();
    return (await this.db.fileIndex.get(filePath)) ?? null;
  }

  async getFileIndexRecords(options?: FileIndexReadOptions): Promise<FileIndexRecord[]> {
    const records = await this.readAllFileIndexRecordsPaged();
    if (records.length > 0) return records;
    const keys = await this.db.vectors.orderBy(':id').limit(1).primaryKeys();
    if (keys.length === 0) return records;
    if (options?.repair === false) throw new FileIndexRepairRequiredError();
    await this.rebuildFileIndexFromVectors();
    return this.readAllFileIndexRecordsPaged();
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

  private async getSearchEntries(key: string, filter?: VectorSearchFilter): Promise<VectorEntry[]> {
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
    let results: VectorSearchResult[] = [];
    let stale = false;
    for (let attempt = 0; attempt < WORKER_SEARCH_REVISION_ATTEMPTS; attempt++) {
      const revision = this.mutationRevision;
      results = await this.searchPagedExactOnce(request);
      await this.afterSearchRead();
      stale = this.mutationRevision !== revision;
      if (!stale) break;
    }
    this.lastSearchStale = stale;
    // 구세대 페이지 결과는 현재 DB에 없는 id를 버려 삭제·rename 근거를 남기지 않는다.
    return stale ? await this.dropRemovedSearchResults(results) : results;
  }

  /** 중단된 쓰기 없이 읽는 단일 시도입니다. 세대 판정은 호출부가 합니다. */
  private async searchPagedExactOnce(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    throwIfAborted(request.signal);
    const topK = Math.max(0, Math.floor(request.topK));
    if (topK <= 0) return [];

    const selected: VectorSearchResult[] = [];
    const scorePage = async (records: IndexedDbVectorRecord[]): Promise<void> => {
      if (records.length === 0) return;
      const entries = records
        .filter((record) => matchesVectorRecordSearchFilter(record, request.filter))
        .map(vectorEntryFromRecord);
      this.enforceRuntimeBoundary(entries);
      const pageResults = await scoredSearch(
        entries,
        { ...request, mode: 'exact', filter: undefined, topK },
        null,
        null,
      );
      selected.push(...pageResults);
      selected.sort((left, right) => right.score - left.score);
      selected.splice(topK);
    };

    // 기본 키 커서로 페이징합니다. offset()은 페이지마다 앞쪽 레코드를 다시 건너뛰어
    // 큰 저장소에서 전체 스캔 비용이 제곱으로 늘고 메인 스레드를 붙잡습니다.
    const scoreKeysetPages = async (after?: string): Promise<void> => {
      throwIfAborted(request.signal);
      const records = await (after === undefined
        ? this.db.vectors.orderBy('id').limit(this.pageSize).toArray()
        : this.db.vectors.where('id').above(after).limit(this.pageSize).toArray());
      await scorePage(records);
      const lastKey = records.at(-1)?.id;
      if (records.length >= this.pageSize && lastKey !== undefined) {
        await scoreKeysetPages(lastKey);
      }
    };

    const prefixes = normalizeFilePathPrefixes(request.filter?.filePathPrefixes);
    if (prefixes.length > 0) {
      // 경로 범위는 중복 키를 가질 수 있어 기본 키 목록을 먼저 모은 뒤 묶어서 읽습니다.
      const keys: string[] = [];
      for (const prefix of prefixes) {
        keys.push(...(await this.db.vectors.where('filePath').equals(prefix).primaryKeys()));
        keys.push(
          ...(await this.db.vectors
            .where('filePath')
            .startsWith(`${prefix}/`)
            .primaryKeys()),
        );
      }
      for (let index = 0; index < keys.length; index += this.pageSize) {
        throwIfAborted(request.signal);
        const chunk = keys.slice(index, index + this.pageSize);
        const records = (await this.db.vectors.bulkGet(chunk)).filter(
          (record): record is IndexedDbVectorRecord => record !== undefined,
        );
        await scorePage(records);
      }
    } else {
      await scoreKeysetPages();
    }
    return selected;
  }

  /** 검색이 저장소를 모두 읽은 직후 호출되는 확장점으로, 테스트가 쓰기를 주입합니다. */
  protected afterSearchRead(): Promise<void> {
    return Promise.resolve();
  }

  /** 구세대 결과에서 현재 DB에 없는 id를 제거합니다. */
  private async dropRemovedSearchResults(
    results: readonly VectorSearchResult[],
  ): Promise<VectorSearchResult[]> {
    if (results.length === 0) return [];
    const records = await this.db.vectors.bulkGet(results.map((result) => result.entry.id));
    return results.filter((_, index) => records[index] !== undefined);
  }

  private async searchInWorker(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const worker = (this.vectorSearchWorker ??= this.vectorSearchWorkerFactory());
    let hits: Array<{ id: string; score: number }> = [];
    let stale = false;
    // 색인 세대가 검색 중 바뀌면 구세대 결과를 버리고 최신 세대로 한 번 더 시도한다.
    for (let attempt = 0; attempt < WORKER_SEARCH_REVISION_ATTEMPTS; attempt++) {
      const revision = this.mutationRevision;
      hits = await worker.search({
        dbName: this.db.name,
        queryVector: request.queryVector,
        topK: request.topK,
        filter: request.filter,
        signal: request.signal,
        revision,
        mode: request.mode,
        annMinEntryCount: request.annMinEntryCount,
        annClusterCount: request.annClusterCount,
        annProbeCount: request.annProbeCount,
      });
      const stats = worker.lastSearchStats ?? null;
      this.lastWorkerSearchStats = stats;
      stale = this.mutationRevision !== revision;
      if (!stale) break;
    }
    this.lastSearchStale = stale;
    throwIfAborted(request.signal);
    const records = await this.db.vectors.bulkGet(hits.map((hit) => hit.id));
    // 작업자가 실제로 수행한 방식을 그대로 보고해 정확 검색을 ANN으로 오표기하지 않습니다.
    const mode: VectorSearchResult['mode'] = worker.lastSearchStats?.mode ?? 'exact';
    return hits.flatMap((hit, index) => {
      const record = records[index];
      if (!record || !matchesVectorRecordSearchFilter(record, request.filter)) return [];
      return [{ entry: vectorEntryFromRecord(record), score: hit.score, mode }];
    });
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

  private async assertRecoveryLedgerReadable(): Promise<void> {
    const [requests, owners] = await this.db.meta.bulkGet([VECTOR_WRITE_RECOVERY_KEY, `${VECTOR_WRITE_RECOVERY_KEY}:owners`]);
    if (requests !== undefined) {
      if (!Array.isArray(requests.value)) throw new Error('rag-vector-recovery-invalid');
      const entries: unknown[] = requests.value;
      for (const entry of entries) {
        if (typeof entry !== 'string') throw new Error('rag-vector-recovery-invalid');
      }
    }
    if (owners !== undefined) {
      if (!Array.isArray(owners.value)) throw new Error('rag-vector-recovery-invalid');
      const entries: unknown[] = owners.value;
      const paths = new Set<string>();
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || paths.has(entry[0])) throw new Error('rag-vector-recovery-invalid');
        paths.add(entry[0]);
      }
    }
  }

  /**
   * 파일 쓰기 전에 원장에 시작을 남깁니다. 완료 기록 없이 재시작되면 그 파일은 재색인 대상입니다.
   * 완료 기록은 성공 경로에서만 지우므로 중단·실패가 남습니다.
   */
  private async beginFileWrites(filePaths: readonly string[], updated: number): Promise<void> {
    if (filePaths.length === 0) return;
    await this.commitMutation(() => this.db.pendingWrites.bulkPut(
      filePaths.map((filePath) => ({ filePath, updated })),
    ));
  }

  private async finishFileWrites(filePaths: readonly string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.commitMutation(() => this.db.pendingWrites.bulkDelete([...filePaths]));
  }

  /**
   * 중단된 파일 쓰기 원장을 읽고 내구 복구 요청으로 등록한 뒤 비웁니다.
   * 요청 기록이 먼저 성공해야 원장을 지우므로, 중간에 죽어도 복구 대상이 사라지지 않습니다.
   */
  async probePendingFileWrites(): Promise<string[]> {
    return this.db.transaction('rw', [this.db.pendingWrites, this.db.meta], async () => {
      await this.assertRecoveryLedgerReadable();
      const records = await this.db.pendingWrites.toArray();
      if (records.length === 0) return [];
      const interrupted = [...new Set(records.map((record) => record.filePath))].sort((a, b) => a.localeCompare(b));
      await this.persistWriteRecoveryRequests(interrupted);
      await this.db.pendingWrites.bulkDelete(interrupted);
      await stampStoreMutation(this.db.meta);
      return interrupted;
    });
  }

  /** 테스트에서 복구 요청 기록 실패를 주입할 수 있게 분리한 기록입니다. */
  protected async persistWriteRecoveryRequests(filePaths: readonly string[]): Promise<void> {
    const existing = await this.readPendingWriteRecovery();
    const merged = [...new Set([...existing, ...filePaths])].sort((a, b) => a.localeCompare(b));
    await this.db.meta.put({
      key: VECTOR_WRITE_RECOVERY_KEY,
      value: merged,
      updated: Date.now(),
    });
  }

  async beginPendingWriteRecovery(filePaths: readonly string[], owner?: string): Promise<void> {
    await this.commitMutation(async () => {
      await this.assertRecoveryLedgerReadable();
      await this.persistWriteRecoveryRequests(filePaths);
      const stored = await this.db.meta.get(`${VECTOR_WRITE_RECOVERY_KEY}:owners`);
      const owners = new Map<string, string>(Array.isArray(stored?.value) ? stored.value as [string, string][] : []);
      for (const path of filePaths) {
        if (owner) owners.set(path, owner);
      }
      await this.db.meta.put({ key: `${VECTOR_WRITE_RECOVERY_KEY}:owners`, value: [...owners], updated: Date.now() });
    });
  }

  async readPendingWriteRecovery(): Promise<string[]> {
    const stored = await this.db.meta.get(VECTOR_WRITE_RECOVERY_KEY);
    const value = stored?.value;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  async completePendingWriteRecovery(filePaths: readonly string[], owner?: string): Promise<void> {
    if (filePaths.length === 0) return;
    await this.commitMutation(async () => {
    await this.assertRecoveryLedgerReadable();
    const stored = await this.db.meta.get(`${VECTOR_WRITE_RECOVERY_KEY}:owners`);
    const owners = new Map<string, string>(Array.isArray(stored?.value) ? stored.value as [string, string][] : []);
    const completed = new Set(filePaths.filter((path) => owners.get(path) === owner));
    for (const path of completed) owners.delete(path);
    await this.db.meta.put({ key: `${VECTOR_WRITE_RECOVERY_KEY}:owners`, value: [...owners], updated: Date.now() });
    const remaining = (await this.readPendingWriteRecovery()).filter(
      (filePath) => !completed.has(filePath),
    );
    if (remaining.length === 0) {
      await this.db.meta.delete(VECTOR_WRITE_RECOVERY_KEY);
      return;
    }
    await this.db.meta.put({
      key: VECTOR_WRITE_RECOVERY_KEY,
      value: remaining,
      updated: Date.now(),
    });
    });
  }

  private noteVectorMutation(): void {
    this.mutationRevision += 1;
    this.lastSearchStale = false;
  }

  private closeVectorSearchWorker(): void {
    this.vectorSearchWorker?.close();
    this.vectorSearchWorker = null;
  }

  /**
   * 작업자는 쓰기마다 종료하지 않고 살려 두고 revision으로 색인 세대를 무효화합니다.
   * 작업자 재기동과 WASM 재초기화가 사라져 대형 볼트의 첫 검색 비용만 남습니다.
   */
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
      await this.commitMutation(() => this.db.fileIndex.bulkPut(records));
    }
  }

  private async rebuildFileIndexFromVectors(): Promise<void> {
    let filePathCursor: string | null = null;
    while (true) {
      const firstRecord: IndexedDbVectorRecord | undefined = filePathCursor
        ? await this.db.vectors.where('filePath').above(filePathCursor).first()
        : await this.db.vectors.orderBy('filePath').first();
      if (!firstRecord) break;
      await this.db.transaction('rw', [this.db.vectors, this.db.fileIndex, this.db.meta], async () => {
        // 탐색 뒤 도착한 최신 행을 덮어쓰지 않도록 같은 transaction에서 재확인합니다.
        if (await this.db.fileIndex.get(firstRecord.filePath)) return;
        const current = await this.db.vectors.where('filePath').equals(firstRecord.filePath).first();
        if (!current) return;
        const vectorCount = await this.db.vectors.where('filePath').equals(current.filePath).count();
        const [fileRecord] = fileIndexRecordsFromRust([vectorEntryFromRecordWithUpdated(current)], current.updated);
        if (!fileRecord) return;
        await this.db.fileIndex.put({ ...fileRecord, vectorCount });
        await stampStoreMutation(this.db.meta);
      });
      filePathCursor = firstRecord.filePath;
      await yieldToEventLoop();
    }
  }

  private readFileIndexPage(cursor: string | null, pageSize: number): Promise<FileIndexRecord[]> {
    const collection = cursor
      ? this.db.fileIndex.where(':id').above(cursor)
      : this.db.fileIndex.orderBy(':id');
    return collection.limit(pageSize).toArray();
  }

  private readVectorPage(
    cursor: string | null,
    pageSize: number,
  ): Promise<IndexedDbVectorRecord[]> {
    const collection = cursor
      ? this.db.vectors.where(':id').above(cursor)
      : this.db.vectors.orderBy(':id');
    return collection.limit(pageSize).toArray();
  }

  private async readAllFileIndexRecordsPaged(): Promise<FileIndexRecord[]> {
    const records: FileIndexRecord[] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await this.readFileIndexPage(cursor, this.pageSize);
      records.push(...page);
      cursor = page.at(-1)?.filePath ?? null;
      if (page.length < this.pageSize) break;
      await yieldToEventLoop();
    }
    return records;
  }

  private async deleteFilePaths(filePaths: readonly string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.commitMutation(async () => {
      await this.db.vectors
        .where('filePath')
        .anyOf([...filePaths])
        .delete();
      await this.db.fileIndex.bulkDelete([...filePaths]);
    });
    this.noteVectorMutation();
    this.invalidateRuntimeCache();
  }
}

function uniqueFilePaths(entries: readonly VectorEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.metadata.filePath))];
}

function isCompleteVectorMetadata(record: IndexedDbVectorRecord): boolean {
  const metadata = record.metadata;
  return (
    metadata.filePath === record.filePath &&
    Number.isFinite(metadata.startLine) &&
    typeof metadata.text === 'string' &&
    metadata.text.length > 0 &&
    typeof metadata.contentHash === 'string' &&
    metadata.contentHash.length > 0 &&
    typeof (record.embeddingProvider ?? metadata.embeddingProvider) === 'string' &&
    typeof (record.embeddingModel ?? metadata.embeddingModel) === 'string'
  );
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
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
  let entries = Array.isArray(data)
    ? data.filter(isVectorEntryLike).map((entry) => ({
        id: entry.id,
        vector: [...entry.vector],
        metadata: { ...entry.metadata },
      }))
    : [];
  if (options.requireSourceChunkIds) {
    const indices = planSourceChunkImportIndicesRust(
      entries.map((entry) => ({
        id: entry.id,
        filePath: entry.metadata.filePath,
        chunkHash: entry.metadata.chunkHash,
      })),
    );
    if (indices === null) throw new Error('Source chunk import planning is unavailable.');
    entries = selectByRustIndices(entries, indices);
  }
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
  private readonly sourceMetadataRecords = new Map<string, Pick<FileIndexRecord, 'sourceMetadata' | 'sourceMetadataHash'>>();
  private readonly emptyFileRecords = new Map<string, FileIndexRecord>();
  private runtimeIndex: RustVectorRuntimeIndex | null = null;
  private ivfRuntimeIndexes = new BoundedLruCache<string, RustIvfRuntimeIndex>(
    DEFAULT_IVF_RUNTIME_INDEX_CACHE_LIMIT,
    (index) => index.dispose(),
  );

  constructor() {
    this.entries = [];
  }

  async add(newEntries: VectorEntry[]): Promise<void> {
    for (const entry of newEntries) {
      this.emptyFileRecords.delete(entry.metadata.filePath);
    }
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      newEntries,
      planVectorStoreAddRust(
        this.entries.map((entry) => entry.id),
        newEntries.map((entry) => entry.id),
      ),
    );
    this.invalidateRuntimeIndex();
    await this.persist();
  }

  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    this.emptyFileRecords.delete(filePath);
    this.sourceMetadataRecords.delete(filePath);
    this.entries = applyVectorStoreMutationPlan(
      this.entries,
      entries,
      planVectorStoreReplaceFileRust(
        this.entries.map((entry) => entry.metadata.filePath),
        filePath,
        entries.length,
      ),
    );
    this.invalidateRuntimeIndex();
    return Promise.resolve();
  }

  async replaceBatchFileEntries(
    batches: readonly { filePath: string; entries: VectorEntry[]; sourceMetadata?: SourceMetadata; sourceMetadataHash?: string }[],
  ): Promise<void> {
    for (const batch of batches) {
      await this.replaceFileEntries(batch.filePath, batch.entries);
      if (batch.sourceMetadata) this.sourceMetadataRecords.set(batch.filePath, { sourceMetadata: batch.sourceMetadata, sourceMetadataHash: batch.sourceMetadataHash });
    }
  }

  removeByFilePath(filePath: string): Promise<number> {
    this.emptyFileRecords.delete(filePath);
    this.sourceMetadataRecords.delete(filePath);
    const plan = planVectorStoreRemoveFileRust(
      this.entries.map((entry) => entry.metadata.filePath),
      filePath,
    );
    if (plan === null) throw new Error('Rust vector store mutation planning failed');
    const removed = plan.removedCount;
    this.entries = applyVectorStoreMutationPlan(this.entries, [], plan);
    this.invalidateRuntimeIndex();
    return Promise.resolve(removed);
  }

  async markFileIndexedWithoutVectors(record: Omit<FileIndexRecord, 'vectorCount'>): Promise<void> {
    await this.removeByFilePath(record.filePath);
    this.emptyFileRecords.set(record.filePath, { ...record, vectorCount: 0 });
  }

  refreshFileIndexRevision(
    record: Pick<FileIndexRecord, 'filePath' | 'sourceMtime' | 'sourceSize' | 'contentHash' | 'sourceMetadata' | 'sourceMetadataHash'>,
  ): Promise<boolean> {
    if (record.sourceMetadata) this.sourceMetadataRecords.set(record.filePath, { sourceMetadata: record.sourceMetadata, sourceMetadataHash: record.sourceMetadataHash });
    const emptyRecord = this.emptyFileRecords.get(record.filePath);
    let found = false;
    if (emptyRecord) {
      this.emptyFileRecords.set(record.filePath, {
        ...emptyRecord,
        sourceMtime: record.sourceMtime,
        sourceSize: record.sourceSize,
        contentHash: record.contentHash,
        ...(record.sourceMetadata ? { sourceMetadata: record.sourceMetadata, sourceMetadataHash: record.sourceMetadataHash } : {}),
        updated: Date.now(),
      });
      found = true;
    }
    if (this.entries.some((entry) => entry.metadata.filePath === record.filePath)) {
      this.entries = this.entries.map((entry) =>
        entry.metadata.filePath === record.filePath
          ? {
              ...entry,
              metadata: {
                ...entry.metadata,
                sourceMtime: record.sourceMtime,
                sourceSize: record.sourceSize,
                contentHash: record.contentHash,
              },
            }
          : entry,
      );
      found = true;
    }
    return Promise.resolve(found);
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
    this.emptyFileRecords.clear();
    this.sourceMetadataRecords.clear();
    this.invalidateRuntimeIndex();
    return Promise.resolve();
  }

  async persist(): Promise<void> {
    // 아무것도 하지 않음
  }

  close(): void {
    this.invalidateRuntimeIndex();
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  getEntryCount(): Promise<number> {
    return Promise.resolve(this.entries.length);
  }

  getStats(): Promise<VectorStoreStats> {
    const stats = vectorStoreStatsFromRust(this.entries);
    const emptyRecords = [...this.emptyFileRecords.values()];
    return Promise.resolve({
      totalEntries: stats.totalEntries,
      totalFiles: stats.totalFiles + emptyRecords.length,
      totalVectors: stats.totalVectors,
      averageVectorsPerFile:
        stats.totalFiles + emptyRecords.length > 0
          ? stats.totalVectors / (stats.totalFiles + emptyRecords.length)
          : 0,
      lastUpdated: emptyRecords.reduce<number | null>(
        (latest, record) => (latest === null ? record.updated : Math.max(latest, record.updated)),
        stats.lastUpdated,
      ),
    });
  }

  getIndexedFilePaths(): Promise<string[]> {
    return Promise.resolve(
      [...vectorStoreStatsFromRust(this.entries).indexedFilePaths, ...this.emptyFileRecords.keys()]
        .filter((path, index, paths) => paths.indexOf(path) === index)
        .sort(),
    );
  }

  async getFileIndexRecord(filePath: string): Promise<FileIndexRecord | null> {
    return (
      (await this.getFileIndexRecords()).find((record) => record.filePath === filePath) ?? null
    );
  }

  getFileIndexRecords(_options?: FileIndexReadOptions): Promise<FileIndexRecord[]> {
    const records = fileIndexRecordsFromRust(this.entries, Date.now());
    const vectorPaths = new Set(records.map((record) => record.filePath));
    return Promise.resolve([
      ...records.map((record) => ({ ...record, ...this.sourceMetadataRecords.get(record.filePath) })),
      ...[...this.emptyFileRecords.values()].filter((record) => !vectorPaths.has(record.filePath)),
    ]);
  }

  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    return Promise.resolve(
      copyEntries(
        selectEntriesByIndexPlan(
          this.entries,
          vectorStoreLookupByFilePaths(this.entries, filePaths),
        ),
      ),
    );
  }

  getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    return Promise.resolve(
      copyEntries(
        selectEntriesByIndexPlan(this.entries, vectorStoreLookupByIds(this.entries, ids)),
      ),
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

function fileIndexRecordsFromRust(
  entries: readonly VectorEntry[],
  updated: number,
): FileIndexRecord[] {
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
): VectorEntry[] {
  if (plan === null) {
    throw new Error('Rust vector store mutation planning failed');
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
    return {
      totalEntries: 0,
      totalFiles: 0,
      totalVectors: 0,
      averageVectorsPerFile: 0,
      lastUpdated: null,
      indexedFilePaths: [],
    };
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
    return [];
  }
  return plan;
}

function vectorStoreLookupByIds(entries: readonly VectorEntry[], ids: readonly string[]): number[] {
  const plan = planVectorStoreLookupByIdsRust(
    entries.map((entry) => entry.id),
    ids,
  );
  if (plan === null) {
    return [];
  }
  return plan;
}

function selectEntriesByIndexPlan(
  entries: readonly VectorEntry[],
  indexes: readonly number[],
): VectorEntry[] {
  return selectByRustIndices(entries, indexes, { dedupe: true });
}

function copyEntries(entries: readonly VectorEntry[]): VectorEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    vector: [...entry.vector],
    metadata: { ...entry.metadata },
  }));
}
