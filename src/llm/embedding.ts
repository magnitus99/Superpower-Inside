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
    super('SuperpowerInsideEmbeddingCache');
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

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl = 'https://api.openai.com',
    model = 'text-embedding-3-small',
  ) {
    this.apiKey = apiKey;
    // trailing slash 제거, /v1 중복 방지
    let url = baseUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/v1')) {
      url = url.slice(0, -3);
    }
    this.baseUrl = url;
    this.model = model;
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const results = await this.embedBatch([text], options);
    return results[0];
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });
    throwIfAborted(options?.signal);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Embedding API ${res.status} (endpoint: ${this.baseUrl}/v1/embeddings, model: ${this.model}): ${body}`,
      );
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

    // Ollama native endpoint 시도
    const res = await requestUrl({
      url: `${this.baseUrl}/api/embed`,
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts, truncate: true }),
      throw: false,
    });
    throwIfAborted(options?.signal);

    if (res.status < 400) {
      const data = res.json as { embeddings?: number[][] };
      if (data.embeddings) {
        return data.embeddings;
      }
      throw new Error('Ollama embedding response missing embeddings');
    }

    // 400/404/405 → 여러 대체 endpoint 시도
    const fallbackUrls = [
      `${this.baseUrl}/api/embeddings`,
      `${this.baseUrl}/v1/embeddings`,
    ];
    let lastError = '';
    for (const fbUrl of fallbackUrls) {
      try {
        const fbRes = await requestUrl({
          url: fbUrl,
          method: 'POST',
          headers,
          body: JSON.stringify({ model: this.model, input: texts, truncate: true }),
          throw: false,
        });
        throwIfAborted(options?.signal);
        if (fbRes.status < 400) {
          const fbData = fbRes.json as {
            data?: Array<{ embedding: number[] }>;
            embeddings?: number[][];
          };
          if (fbData.data) return fbData.data.map((d) => d.embedding);
          if (fbData.embeddings) return fbData.embeddings;
        }
        lastError = `Embedding API ${fbRes.status} (${fbUrl}): ${fbRes.text}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const rawError = lastError || res.text;
    const isContextLengthError = /context length|input length exceeds|exceeds the context length/i.test(rawError);
    const message = isContextLengthError
      ? `Ollama 임베딩 모델의 최대 컨텍스트 길이를 초과했습니다. 설정 > RAG > 청크 크기(chunkSize)를 줄이고 다시 인덱싱해보세요. (원본 오류: ${rawError})`
      : `Ollama embedding failed for model "${this.model}". Tried /api/embed -> ${res.status}, then ${fallbackUrls.join(', ')}. Last error: ${rawError}`;
    throw new Error(message);
  }
}

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private memoryCache: Map<string, number[]>;
  private modelName: string;

  constructor(inner: EmbeddingProvider, modelName: string) {
    this.inner = inner;
    this.memoryCache = new Map();
    this.modelName = modelName;
  }

  private async computeHash(text: string): Promise<string> {
    return sha256Hex(`${this.modelName}::${text}`);
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    throwIfAborted(options?.signal);
    const hash = await this.computeHash(text);
    throwIfAborted(options?.signal);
    const mem = this.memoryCache.get(hash);
    if (mem) return mem;

    const cached = await db.embeddings.where('textHash').equals(hash).first();
    throwIfAborted(options?.signal);
    if (cached) {
      this.memoryCache.set(hash, cached.vector);
      return cached.vector;
    }

    const vector = await this.inner.embed(text, options);
    throwIfAborted(options?.signal);
    this.memoryCache.set(hash, vector);
    await db.embeddings.put({ id: hash, textHash: hash, vector, updated: Date.now() });
    return vector;
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    const hashes: string[] = [];
    for (const t of texts) {
      hashes.push(await this.computeHash(t));
      throwIfAborted(options?.signal);
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
      throwIfAborted(options?.signal);
      if (cached) {
        this.memoryCache.set(hash, cached.vector);
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
      for (let j = 0; j < missingTexts.length; j++) {
        const originalIdx = missingIndices[j];
        const vector = newVectors[j];
        const hash = hashes[originalIdx];
        results[originalIdx] = vector;
        this.memoryCache.set(hash, vector);
        await db.embeddings.put({ id: hash, textHash: hash, vector, updated: now });
        throwIfAborted(options?.signal);
      }
    }

    return results as number[][];
  }

  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    await db.embeddings.clear();
  }
}
