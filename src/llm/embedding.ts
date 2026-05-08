import { requestUrl } from 'obsidian';
import Dexie from 'dexie';

export interface EmbeddingRecord {
  id: string;
  textHash: string;
  vector: number[];
  updated: number;
}

class EmbeddingCacheDB extends Dexie {
  embeddings!: Dexie.Table<EmbeddingRecord, string>;

  constructor() {
    super('SuperObsidianEmbeddingCache');
    this.version(1).stores({
      embeddings: 'id, textHash, updated',
    });
  }
}

const db = new EmbeddingCacheDB();

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = 'https://api.openai.com', model = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        encoding_format: 'float',
      }),
    });
    if (!res.ok) {
      throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    if (!data.data) {
      throw new Error('Embedding response missing data');
    }
    return data.data.map((d) => d.embedding);
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const res = await requestUrl({
      url: `${this.baseUrl}/api/embed`,
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (res.status >= 400) {
      throw new Error(`Ollama embedding failed: ${res.status} ${res.text}`);
    }
    const data = res.json as { embeddings?: number[][] };
    if (!data.embeddings) {
      throw new Error('Ollama embedding response missing embeddings');
    }
    return data.embeddings;
  }
}

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private memoryCache: Map<string, number[]>;

  constructor(inner: EmbeddingProvider) {
    this.inner = inner;
    this.memoryCache = new Map();
  }

  async embed(text: string): Promise<number[]> {
    const hash = await sha256Hex(text);
    const mem = this.memoryCache.get(hash);
    if (mem) return mem;

    const cached = await db.embeddings.where('textHash').equals(hash).first();
    if (cached) {
      this.memoryCache.set(hash, cached.vector);
      return cached.vector;
    }

    const vector = await this.inner.embed(text);
    this.memoryCache.set(hash, vector);
    await db.embeddings.put({ id: hash, textHash: hash, vector, updated: Date.now() });
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const hashes: string[] = [];
    for (const t of texts) {
      hashes.push(await sha256Hex(t));
    }
    const results: (number[] | null)[] = new Array(texts.length).fill(null) as (number[] | null)[];
    const missingIndices: number[] = [];
    const missingTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const hash = hashes[i];
      const mem = this.memoryCache.get(hash);
      if (mem) {
        results[i] = mem;
        continue;
      }
      const cached = await db.embeddings.where('textHash').equals(hash).first();
      if (cached) {
        this.memoryCache.set(hash, cached.vector);
        results[i] = cached.vector;
        continue;
      }
      missingIndices.push(i);
      missingTexts.push(texts[i]);
    }

    if (missingTexts.length > 0) {
      const newVectors = await this.inner.embedBatch(missingTexts);
      const now = Date.now();
      for (let j = 0; j < missingTexts.length; j++) {
        const originalIdx = missingIndices[j];
        const vector = newVectors[j];
        const hash = hashes[originalIdx];
        results[originalIdx] = vector;
        this.memoryCache.set(hash, vector);
        await db.embeddings.put({ id: hash, textHash: hash, vector, updated: now });
      }
    }

    return results as number[][];
  }

  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    await db.embeddings.clear();
  }
}
