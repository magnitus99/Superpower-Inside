import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { writeJsonToVault, readJsonFromVault } from '../utils/vault';

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
  query(vector: number[], topK: number): Promise<VectorEntry[]>;
  clear(): Promise<void>;
  persist(): Promise<void>;
  withBatch<T>(operation: () => Promise<T>): Promise<T>;
  getStats(): Promise<VectorStoreStats>;
  getIndexedFilePaths(): Promise<string[]>;
  getFileIndexRecords(): Promise<FileIndexRecord[]>;
  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]>;
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

const QUERY_YIELD_INTERVAL = 256;

async function scoredQuery(entries: VectorEntry[], vector: number[], topK: number): Promise<VectorEntry[]> {
  const scored: Array<{ entry: VectorEntry; score: number }> = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    scored.push({
      entry,
      score: cosineSimilarity(vector, entry.vector),
    });
    if (index > 0 && index % QUERY_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.entry);
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
    await this.upsertFileIndexRecords(groupEntriesByFilePath(newEntries), now);
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
      await this.db.fileIndex.put(createFileIndexRecord(filePath, entries, now));
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

  async query(vector: number[], topK: number): Promise<VectorEntry[]> {
    const entries = await this.getCachedEntries();
    return scoredQuery(entries, vector, topK);
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
    entriesByPath: Map<string, VectorEntry[]>,
    updated: number,
  ): Promise<void> {
    const records = [...entriesByPath.entries()].map(([filePath, entries]) =>
      createFileIndexRecord(filePath, entries, updated),
    );
    if (records.length > 0) {
      await this.db.fileIndex.bulkPut(records);
    }
  }

  private async rebuildFileIndexFromVectors(): Promise<void> {
    const records = await this.db.vectors.toArray();
    const grouped = groupEntriesByFilePath(records);
    const fileRecords = [...grouped.entries()].map(([filePath, entries]) =>
      createFileIndexRecord(
        filePath,
        entries,
        entries.reduce((latest, entry) => Math.max(latest, entry.updated), 0),
      ),
    );
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
    const seen = new Set(this.entries.map((e) => e.id));
    for (const entry of newEntries) {
      if (seen.has(entry.id)) {
        const idx = this.entries.findIndex((e) => e.id === entry.id);
        if (idx !== -1) this.entries[idx] = entry;
      } else {
        this.entries.push(entry);
        seen.add(entry.id);
      }
    }
    await this.persistIfNeeded();
  }

  async replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    await this.loadIfNeeded();
    this.entries = this.entries.filter((entry) => entry.metadata.filePath !== filePath);
    this.entries.push(...entries);
    await this.persistIfNeeded();
  }

  async removeByFilePath(filePath: string): Promise<number> {
    await this.loadIfNeeded();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.metadata.filePath !== filePath);
    const removed = before - this.entries.length;
    if (removed > 0) {
      await this.persistIfNeeded();
    }
    return removed;
  }

  async query(vector: number[], topK: number): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return scoredQuery(this.entries, vector, topK);
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
    const uniqueFiles = new Set(this.entries.map((e) => e.metadata.filePath));
    const totalFiles = uniqueFiles.size;
    return {
      totalEntries: this.entries.length,
      totalFiles,
      totalVectors: this.entries.length,
      averageVectorsPerFile: totalFiles > 0 ? this.entries.length / totalFiles : 0,
      lastUpdated: this.entries.length > 0 ? Date.now() : null,
    };
  }

  async getIndexedFilePaths(): Promise<string[]> {
    await this.loadIfNeeded();
    return [...new Set(this.entries.map((e) => e.metadata.filePath))];
  }

  async getFileIndexRecords(): Promise<FileIndexRecord[]> {
    await this.loadIfNeeded();
    return createFileIndexRecordsFromEntries(this.entries, Date.now());
  }

  async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    const allowed = new Set(filePaths);
    return copyEntries(this.entries.filter((entry) => allowed.has(entry.metadata.filePath)));
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
    const seen = new Set(this.entries.map((e) => e.id));
    for (const entry of newEntries) {
      if (seen.has(entry.id)) {
        const idx = this.entries.findIndex((e) => e.id === entry.id);
        if (idx !== -1) this.entries[idx] = entry;
      } else {
        this.entries.push(entry);
        seen.add(entry.id);
      }
    }
    await this.persist();
  }

  replaceFileEntries(filePath: string, entries: VectorEntry[]): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.metadata.filePath !== filePath);
    this.entries.push(...entries);
    return Promise.resolve();
  }

  removeByFilePath(filePath: string): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.metadata.filePath !== filePath);
    return Promise.resolve(before - this.entries.length);
  }

  async query(vector: number[], topK: number): Promise<VectorEntry[]> {
    return scoredQuery(this.entries, vector, topK);
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
    const uniqueFiles = new Set(this.entries.map((e) => e.metadata.filePath));
    const totalFiles = uniqueFiles.size;
    return Promise.resolve({
      totalEntries: this.entries.length,
      totalFiles,
      totalVectors: this.entries.length,
      averageVectorsPerFile: totalFiles > 0 ? this.entries.length / totalFiles : 0,
      lastUpdated: this.entries.length > 0 ? Date.now() : null,
    });
  }

  getIndexedFilePaths(): Promise<string[]> {
    return Promise.resolve([...new Set(this.entries.map((e) => e.metadata.filePath))]);
  }

  getFileIndexRecords(): Promise<FileIndexRecord[]> {
    return Promise.resolve(createFileIndexRecordsFromEntries(this.entries, Date.now()));
  }

  getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    const allowed = new Set(filePaths);
    return Promise.resolve(copyEntries(this.entries.filter((entry) => allowed.has(entry.metadata.filePath))));
  }

  getEntries(): Promise<VectorEntry[]> {
    return Promise.resolve(copyEntries(this.entries));
  }
}

function groupEntriesByFilePath<T extends VectorEntry>(entries: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const path = entry.metadata.filePath;
    const existing = grouped.get(path);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(path, [entry]);
    }
  }
  return grouped;
}

function createFileIndexRecordsFromEntries(
  entries: readonly VectorEntry[],
  updated: number,
): FileIndexRecord[] {
  return [...groupEntriesByFilePath(entries).entries()].map(([filePath, fileEntries]) =>
    createFileIndexRecord(filePath, fileEntries, updated),
  );
}

function createFileIndexRecord(
  filePath: string,
  entries: readonly VectorEntry[],
  updated: number,
): FileIndexRecord {
  const first = entries[0];
  const hasCompleteMetadata = entries.every(
    (entry) =>
      typeof entry.metadata.sourceMtime === 'number' &&
      typeof entry.metadata.sourceSize === 'number' &&
      typeof entry.metadata.contentHash === 'string' &&
      typeof entry.metadata.indexedAt === 'number' &&
      typeof entry.metadata.endLine === 'number' &&
      typeof entry.metadata.embeddingProvider === 'string' &&
      typeof entry.metadata.embeddingModel === 'string',
  );
  return {
    filePath,
    sourceMtime: hasCompleteMetadata ? first?.metadata.sourceMtime : undefined,
    sourceSize: hasCompleteMetadata ? first?.metadata.sourceSize : undefined,
    contentHash: hasCompleteMetadata ? first?.metadata.contentHash : undefined,
    indexedAt: hasCompleteMetadata ? first?.metadata.indexedAt : undefined,
    embeddingProvider: hasCompleteMetadata ? first?.metadata.embeddingProvider : undefined,
    embeddingModel: hasCompleteMetadata ? first?.metadata.embeddingModel : undefined,
    hasCompleteMetadata,
    vectorCount: entries.length,
    updated,
  };
}

function copyEntries(entries: readonly VectorEntry[]): VectorEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    vector: [...entry.vector],
    metadata: { ...entry.metadata },
  }));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
