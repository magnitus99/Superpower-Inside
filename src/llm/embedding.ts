import { requestUrl } from 'obsidian';
import Dexie from 'dexie';
import { createContentHash } from '../rag/hash';
import { assertValidEmbeddingBatch } from './embedding-validation';
export { assertValidEmbeddingBatch } from './embedding-validation';

export interface EmbeddingRecord {
  id: string;
  textHash: string;
  vector: number[];
  updated: number;
}

class EmbeddingCacheDB extends Dexie {
  embeddings!: Dexie.Table<EmbeddingRecord, string>;

  constructor() {
    super('SuperpowerInsideEmbeddingCache');
    this.version(1).stores({
      embeddings: 'id, textHash, updated',
    });
  }
}

const db = new EmbeddingCacheDB();

export interface EmbeddingProvider {
  embed(text: string, options?: EmbeddingOptions): Promise<number[]>;
  embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
}

export interface EmbeddingOptions {
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Embedding request cancelled', 'AbortError');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return isUnknownArray(value) && value.every((item) => typeof item === 'number');
}

function extractEmbeddingVector(response: unknown): number[] | null {
  if (!isRecord(response)) return null;

  const data = response.data;
  if (isUnknownArray(data)) {
    const first = data[0];
    if (isRecord(first) && isNumberArray(first.embedding)) {
      return first.embedding;
    }
  }

  const embeddings = response.embeddings;
  if (isUnknownArray(embeddings)) {
    const first = embeddings[0];
    if (isNumberArray(first)) return first;
    if (isNumberArray(embeddings)) return embeddings;
  }

  if (isNumberArray(response.embedding)) {
    return response.embedding;
  }

  return null;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private embeddingsUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl = 'https://api.openai.com',
    model = 'text-embedding-3-small',
  ) {
    this.apiKey = apiKey;
    this.embeddingsUrl = normalizeOpenAIEmbeddingsUrl(baseUrl);
    this.model = model;
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const results = await this.embedBatch([text], options);
    return results[0];
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.apiKey.trim()}`;
    }
    const res = await requestUrl({
      url: this.embeddingsUrl,
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
      throw: false,
    });
    throwIfAborted(options?.signal);
    if (res.status >= 400) {
      throw new Error(
        `Embedding API ${res.status} (endpoint: ${this.embeddingsUrl}, model: ${this.model}): ${res.text}`,
      );
    }
    const data = res.json as {
      data?: Array<{ embedding: number[] }>;
    };
    if (!data.data) {
      throw new Error('Embedding response missing data');
    }
    const vectors = data.data.map((d) => d.embedding);
    assertValidEmbeddingBatch(vectors, texts.length, 'OpenAI embedding batch');
    return vectors;
  }
}

function normalizeOpenAIEmbeddingsUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/embeddings')) {
    return url;
  }
  if (!url.endsWith('/v1')) {
    url = `${url}/v1`;
  }
  return `${url}/embeddings`;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'nomic-embed-text', apiKey?: string) {
    let normalized = baseUrl.trim().replace(/\/+$/, '');
    if (normalized.endsWith('/api')) {
      normalized = normalized.slice(0, -4);
    }
    this.baseUrl = normalized.replace(/\/+$/, '');
    this.model = model;
    this.apiKey = apiKey;
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const results = await this.embedBatch([text], options);
    return results[0];
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const vectors: number[][] = [];
    for (const text of texts) {
      vectors.push(await this.embedSingle(text, headers, options));
      throwIfAborted(options?.signal);
    }
    assertValidEmbeddingBatch(vectors, texts.length, 'Ollama embedding batch');
    return vectors;
  }

  private async embedSingle(
    text: string,
    headers: Record<string, string>,
    options?: EmbeddingOptions,
  ): Promise<number[]> {
    // Ollama native endpoint 시도
    const res = await requestUrl({
      url: `${this.baseUrl}/api/embed`,
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: text, truncate: true }),
      throw: false,
    });
    throwIfAborted(options?.signal);

    if (res.status < 400) {
      const vector = extractEmbeddingVector(res.json);
      if (vector) {
        return vector;
      }
      throw new Error('Ollama embedding response missing embeddings');
    }

    // 400/404/405 → 여러 대체 endpoint 시도
    const fallbackRequests = [
      {
        url: `${this.baseUrl}/api/embeddings`,
        body: JSON.stringify({ model: this.model, prompt: text }),
      },
      {
        url: `${this.baseUrl}/v1/embeddings`,
        body: JSON.stringify({ model: this.model, input: text }),
      },
    ];
    let lastError = '';
    for (const request of fallbackRequests) {
      try {
        const fbRes = await requestUrl({
          url: request.url,
          method: 'POST',
          headers,
          body: request.body,
          throw: false,
        });
        throwIfAborted(options?.signal);
        if (fbRes.status < 400) {
          const vector = extractEmbeddingVector(fbRes.json);
          if (vector) {
            return vector;
          }
        }
        lastError = `Embedding API ${fbRes.status} (${request.url}): ${fbRes.text}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const rawError = lastError || res.text;
    const isContextLengthError = /context length|input length exceeds|exceeds the context length/i.test(rawError);
    const message = isContextLengthError
      ? `Ollama 임베딩 모델의 최대 컨텍스트 길이를 초과했습니다. 긴 단일 줄이나 로그 파일은 자동 분할되도록 수정되었으니 플러그인을 다시 빌드한 뒤 RAG 재인덱싱을 실행하세요. 계속 실패하면 해당 파일을 제외하거나 청크 크기(chunkSize)를 더 낮춰보세요. (원본 오류: ${rawError})`
      : `Ollama embedding failed for model "${this.model}". Tried /api/embed -> ${res.status}, then ${fallbackRequests.map((request) => request.url).join(', ')}. Last error: ${rawError}`;
    throw new Error(message);
  }
}

const MAX_MEMORY_CACHE_SIZE = 5000;

export function createEmbeddingCacheNamespace(providerKey: string, modelName: string): string {
  return `${providerKey.trim()}::${modelName.trim()}`;
}

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private memoryCache: Map<string, number[]>;
  private cacheNamespace: string;
  private cacheKeys: string[];

  constructor(inner: EmbeddingProvider, cacheNamespace: string) {
    this.inner = inner;
    this.memoryCache = new Map();
    this.cacheKeys = [];
    this.cacheNamespace = cacheNamespace;
  }

  private setCache(hash: string, vector: number[]): void {
    if (this.memoryCache.has(hash)) {
      this.memoryCache.set(hash, vector);
      return;
    }
    if (this.cacheKeys.length >= MAX_MEMORY_CACHE_SIZE) {
      const oldest = this.cacheKeys.shift();
      if (oldest !== undefined) {
        this.memoryCache.delete(oldest);
      }
    }
    this.memoryCache.set(hash, vector);
    this.cacheKeys.push(hash);
  }

  private computeHash(text: string): string {
    return createContentHash(`${this.cacheNamespace}::${text}`);
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    throwIfAborted(options?.signal);
    const hash = this.computeHash(text);
    throwIfAborted(options?.signal);
    const mem = this.memoryCache.get(hash);
    if (mem) return mem;

    const cached = await db.embeddings.where('textHash').equals(hash).first();
    throwIfAborted(options?.signal);
    if (cached) {
      this.setCache(hash, cached.vector);
      return cached.vector;
    }

    const vector = await this.inner.embed(text, options);
    throwIfAborted(options?.signal);
    this.setCache(hash, vector);
    await db.embeddings.put({ id: hash, textHash: hash, vector, updated: Date.now() });
    return vector;
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    const hashes: string[] = [];
    for (const t of texts) {
      hashes.push(this.computeHash(t));
      throwIfAborted(options?.signal);
    }
    const results: (number[] | null)[] = new Array(texts.length).fill(null) as (number[] | null)[];
    const missingIndices: number[] = [];
    const missingTexts: string[] = [];

    const cachedRecords = await db.embeddings.bulkGet(hashes);
    throwIfAborted(options?.signal);
    for (let i = 0; i < texts.length; i++) {
      const hash = hashes[i];
      const mem = this.memoryCache.get(hash);
      if (mem) {
        results[i] = mem;
        continue;
      }
      const cached = cachedRecords.find((r) => r?.textHash === hash);
      if (cached) {
        this.setCache(hash, cached.vector);
        results[i] = cached.vector;
        continue;
      }
      missingIndices.push(i);
      missingTexts.push(texts[i]);
    }

    if (missingTexts.length > 0) {
      const newVectors = await this.inner.embedBatch(missingTexts, options);
      throwIfAborted(options?.signal);
      const now = Date.now();
      const bulkRecords: Array<{ id: string; textHash: string; vector: number[]; updated: number }> = [];
      for (let j = 0; j < missingTexts.length; j++) {
        const originalIdx = missingIndices[j];
        const vector = newVectors[j];
        const hash = hashes[originalIdx];
        results[originalIdx] = vector;
        this.setCache(hash, vector);
        bulkRecords.push({ id: hash, textHash: hash, vector, updated: now });
      }
      await db.embeddings.bulkPut(bulkRecords);
      throwIfAborted(options?.signal);
    }

    return results as number[][];
  }

  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    await db.embeddings.clear();
  }
}
