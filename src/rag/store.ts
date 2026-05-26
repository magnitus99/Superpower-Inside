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
  getEntries(): Promise<VectorEntry[]>;
}

interface IndexedDbVectorRecord extends VectorEntry {
  filePath: string;
  updated: number;
}

class VectorStoreDB extends Dexie {
  vectors!: Dexie.Table<IndexedDbVectorRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      vectors: 'id, filePath, updated',
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

function scoredQuery(entries: VectorEntry[], vector: number[], topK: number): VectorEntry[] {
  const scored = entries.map((e) => ({
    entry: e,
    score: cosineSimilarity(vector, e.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.entry);
}

/** Dexie/IndexedDB 기반 로컬 벡터 저장소 */
export class IndexedDbVectorStore implements VectorStore {
  private db: VectorStoreDB;

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
  }

  async removeByFilePath(filePath: string): Promise<number> {
    return this.db.vectors.where('filePath').equals(filePath).delete();
  }

  async query(vector: number[], topK: number): Promise<VectorEntry[]> {
    const entries = await this.getEntries();
    return scoredQuery(entries, vector, topK);
  }

  async clear(): Promise<void> {
    await this.db.vectors.clear();
  }

  async persist(): Promise<void> {
    // IndexedDB는 각 쓰기 작업이 트랜잭션으로 즉시 반영되므로 별도 flush가 필요 없습니다.
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async getStats(): Promise<VectorStoreStats> {
    const records = await this.db.vectors.toArray();
    const uniqueFiles = new Set(records.map((record) => record.filePath));
    const lastUpdated = records.reduce<number | null>(
      (latest, record) => (latest === null ? record.updated : Math.max(latest, record.updated)),
      null,
    );
    return {
      totalEntries: records.length,
      totalFiles: uniqueFiles.size,
      totalVectors: records.length,
      averageVectorsPerFile: uniqueFiles.size > 0 ? records.length / uniqueFiles.size : 0,
      lastUpdated,
    };
  }

  async getIndexedFilePaths(): Promise<string[]> {
    const filePaths = await this.db.vectors.orderBy('filePath').uniqueKeys();
    return filePaths.filter((filePath): filePath is string => typeof filePath === 'string');
  }

  async getEntries(): Promise<VectorEntry[]> {
    const records = await this.db.vectors.toArray();
    return records.map(({ id, vector, metadata }) => ({
      id,
      vector: [...vector],
      metadata: { ...metadata },
    }));
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
    return Promise.resolve(scoredQuery(this.entries, vector, topK));
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

  async getEntries(): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return this.entries.map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
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
    return Promise.resolve(scoredQuery(this.entries, vector, topK));
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

  getEntries(): Promise<VectorEntry[]> {
    return Promise.resolve(
      this.entries.map((entry) => ({ ...entry, metadata: { ...entry.metadata } })),
    );
  }
}
