import type { DataAdapter } from 'obsidian';
import { writeJsonToVault, readJsonFromVault } from '../utils/vault';

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: {
    filePath: string;
    heading?: string;
    startLine: number;
    text: string;
    sourceMtime?: number;
    sourceSize?: number;
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
  removeByFilePath(filePath: string): Promise<number>;
  query(vector: number[], topK: number): Promise<VectorEntry[]>;
  clear(): Promise<void>;
  persist(): Promise<void>;
  getStats(): Promise<VectorStoreStats>;
  getIndexedFilePaths(): Promise<string[]>;
  getEntries(): Promise<VectorEntry[]>;
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

/** Vault adapter 기반 JSON 파일 벡터 저장소 */
export class JsonFileVectorStore implements VectorStore {
  private adapter: DataAdapter;
  private path: string;
  private entries: VectorEntry[];

  constructor(adapter: DataAdapter, path = '.super-obsidian/vectors.json') {
    this.adapter = adapter;
    this.path = path;
    this.entries = [];
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
    await this.persist();
  }

  async removeByFilePath(filePath: string): Promise<number> {
    await this.loadIfNeeded();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.metadata.filePath !== filePath);
    const removed = before - this.entries.length;
    if (removed > 0) {
      await this.persist();
    }
    return removed;
  }

  async query(vector: number[], topK: number): Promise<VectorEntry[]> {
    await this.loadIfNeeded();
    return Promise.resolve(scoredQuery(this.entries, vector, topK));
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  async persist(): Promise<void> {
    await writeJsonToVault(this.adapter, this.path, this.entries);
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.entries.length > 0) return;
    const data = await readJsonFromVault(this.adapter, this.path);
    if (Array.isArray(data)) {
      this.entries = data as VectorEntry[];
    }
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
