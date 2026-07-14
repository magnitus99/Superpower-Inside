import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import Dexie from 'dexie';
import { t } from '../i18n';
import { createIndexedDbRecordKeyRust, planIndexedDbRecordRetentionRust } from '../rag/rust-core';
import { assertValidEmbeddingBatch } from './embedding-validation';
import { getTernlightEmbedder, type TernlightRuntimeOptions } from './ternlight-runtime';
import { appLogger, type AppLogger, type ScopedLogger } from '../utils/logger';
export { assertValidEmbeddingBatch } from './embedding-validation';

export interface EmbeddingRecord {
  id: string;
  textHash: string;
  vectorBuffer?: ArrayBuffer;
  vector?: number[];
  dimension: number;
  updated: number;
}

interface EmbeddingAccessRecord {
  id: string;
  updated: number;
}

class EmbeddingCacheDB extends Dexie {
  embeddings!: Dexie.Table<EmbeddingRecord, string>;
  access!: Dexie.Table<EmbeddingAccessRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      embeddings: 'id, textHash, updated',
    });
    this.version(2).stores({
      embeddings: 'id, updated',
      access: 'id, updated',
    });
  }
}

export interface EmbeddingProvider {
  embed(text: string, options?: EmbeddingOptions): Promise<number[]>;
  embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
  close?(): void;
}

export interface EmbeddingOptions {
  signal?: AbortSignal;
}

export interface EmbeddingRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  requestTimeoutMs: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface EmbeddingProviderRuntimeOptions {
  logger?: AppLogger | ScopedLogger;
  retry?: Partial<EmbeddingRetryOptions>;
}

export class TernlightEmbeddingProvider implements EmbeddingProvider {
  private logger: ScopedLogger;

  constructor(
    private readonly model: string,
    private readonly runtime: TernlightRuntimeOptions,
    options: Pick<EmbeddingProviderRuntimeOptions, 'logger'> = {},
  ) {
    if (model !== 'ternlight-base') {
      throw new Error(`Unsupported Ternlight embedding model: ${model}`);
    }
    this.logger = createScopedEmbeddingLogger(options.logger, 'embedding.ternlight');
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    throwIfAborted(options?.signal);
    const embed = await getTernlightEmbedder(this.runtime);
    const vector = Array.from(embed(text));
    throwIfAborted(options?.signal);
    return vector;
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    throwIfAborted(options?.signal);
    this.logger.debug('Ternlight embedding batch started.', {
      data: { model: this.model, batchSize: texts.length },
    });
    const embed = await getTernlightEmbedder(this.runtime);
    const vectors = texts.map((text) => {
      throwIfAborted(options?.signal);
      return Array.from(embed(text));
    });
    throwIfAborted(options?.signal);
    assertValidEmbeddingBatch(vectors, texts.length, 'Ternlight embedding batch');
    this.logger.debug('Ternlight embedding batch completed.', {
      data: { model: this.model, batchSize: texts.length },
    });
    return vectors;
  }
}

interface RetryRequestContext {
  endpoint: string;
  model: string;
  batchSize: number;
  signal?: AbortSignal;
}

const DEFAULT_EMBEDDING_RETRY: EmbeddingRetryOptions = {
  maxRetries: 4,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  requestTimeoutMs: 120_000,
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Embedding request cancelled', 'AbortError');
  }
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    const onAbort = (): void => {
      window.clearTimeout(timeout);
      reject(new DOMException('Embedding request cancelled', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeRetryOptions(options?: Partial<EmbeddingRetryOptions>): EmbeddingRetryOptions {
  return {
    maxRetries: clampRetryInteger(options?.maxRetries, 0, 10, DEFAULT_EMBEDDING_RETRY.maxRetries),
    baseDelayMs: clampRetryInteger(
      options?.baseDelayMs,
      0,
      300_000,
      DEFAULT_EMBEDDING_RETRY.baseDelayMs,
    ),
    maxDelayMs: clampRetryInteger(
      options?.maxDelayMs,
      1,
      300_000,
      DEFAULT_EMBEDDING_RETRY.maxDelayMs,
    ),
    requestTimeoutMs: clampRetryInteger(
      options?.requestTimeoutMs,
      0,
      3_600_000,
      DEFAULT_EMBEDDING_RETRY.requestTimeoutMs,
    ),
    sleep: options?.sleep ?? sleepWithAbort,
  };
}

function clampRetryInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createScopedEmbeddingLogger(
  logger: AppLogger | ScopedLogger | undefined,
  source: string,
): ScopedLogger {
  const candidate = logger ?? appLogger;
  return 'child' in candidate ? candidate.child(source) : candidate;
}

function getHeaderValue(headers: RequestUrlResponse['headers'], headerName: string): string | null {
  const normalizedHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }
  return null;
}

function parseRetryAfterMs(
  headers: RequestUrlResponse['headers'],
  now = Date.now(),
): number | null {
  const retryAfter = getHeaderValue(headers, 'retry-after');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - now);
  }
  return null;
}

function calculateRetryDelayMs(
  response: RequestUrlResponse,
  attempt: number,
  retry: EmbeddingRetryOptions,
): number {
  return Math.min(
    retry.maxDelayMs,
    parseRetryAfterMs(response.headers) ?? retry.baseDelayMs * 2 ** attempt,
  );
}

async function requestEmbeddingWithRateLimitRetry(
  request: RequestUrlParam,
  retry: EmbeddingRetryOptions,
  logger: ScopedLogger,
  context: RetryRequestContext,
): Promise<RequestUrlResponse> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(context.signal);
    const response = await requestUrlWithTimeout(request, retry.requestTimeoutMs, logger, context);
    throwIfAborted(context.signal);
    if (response.status !== 429 || attempt >= retry.maxRetries) {
      if (response.status === 429) {
        logger.error('Embedding API rate limit retries exhausted.', {
          data: {
            endpoint: context.endpoint,
            model: context.model,
            batchSize: context.batchSize,
            attempts: attempt + 1,
          },
        });
      }
      return response;
    }

    const retryInMs = calculateRetryDelayMs(response, attempt, retry);
    logger.warn('Embedding API rate limited; retrying request.', {
      data: {
        endpoint: context.endpoint,
        model: context.model,
        batchSize: context.batchSize,
        attempt: attempt + 1,
        retryInMs,
      },
    });
    await retry.sleep?.(retryInMs, context.signal);
  }
}

function requestUrlWithTimeout(
  request: RequestUrlParam,
  timeoutMs: number,
  logger: ScopedLogger,
  context: RetryRequestContext,
): Promise<RequestUrlResponse> {
  throwIfAborted(context.signal);
  if (timeoutMs <= 0 && !context.signal) {
    return requestUrl(request);
  }

  return new Promise<RequestUrlResponse>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      context.signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => {
      settle(() => reject(new DOMException('Embedding request cancelled', 'AbortError')));
    };

    if (timeoutMs > 0) {
      timeoutId = window.setTimeout(() => {
        logger.error('Embedding request timed out.', {
          data: {
            endpoint: context.endpoint,
            model: context.model,
            batchSize: context.batchSize,
            timeoutMs,
          },
        });
        settle(() =>
          reject(
            new Error(
              `Embedding request timed out after ${timeoutMs}ms (endpoint: ${context.endpoint}, model: ${context.model}).`,
            ),
          ),
        );
      }, timeoutMs);
    }
    context.signal?.addEventListener('abort', onAbort, { once: true });

    void requestUrl(request).then(
      (response) => settle(() => resolve(response)),
      (error: unknown) => settle(() => reject(toError(error))),
    );
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  private retry: EmbeddingRetryOptions;
  private logger: ScopedLogger;

  constructor(
    apiKey: string,
    baseUrl = 'https://api.openai.com',
    model = 'text-embedding-3-small',
    options: EmbeddingProviderRuntimeOptions = {},
  ) {
    this.apiKey = apiKey;
    this.embeddingsUrl = normalizeOpenAIEmbeddingsUrl(baseUrl);
    this.model = model;
    this.retry = normalizeRetryOptions(options.retry);
    this.logger = createScopedEmbeddingLogger(options.logger, 'embedding.openai');
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
    this.logger.debug('Embedding batch request started.', {
      data: { endpoint: this.embeddingsUrl, model: this.model, batchSize: texts.length },
    });
    const res = await requestEmbeddingWithRateLimitRetry(
      {
        url: this.embeddingsUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: texts,
          model: this.model,
        }),
        throw: false,
      },
      this.retry,
      this.logger,
      {
        endpoint: this.embeddingsUrl,
        model: this.model,
        batchSize: texts.length,
        signal: options?.signal,
      },
    );
    throwIfAborted(options?.signal);
    if (res.status >= 400) {
      this.logger.error('Embedding batch request failed.', {
        data: {
          endpoint: this.embeddingsUrl,
          model: this.model,
          batchSize: texts.length,
          status: res.status,
          response: res.text,
        },
      });
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
    this.logger.debug('Embedding batch request completed.', {
      data: { endpoint: this.embeddingsUrl, model: this.model, batchSize: texts.length },
    });
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
  private retry: EmbeddingRetryOptions;
  private logger: ScopedLogger;

  constructor(
    baseUrl: string,
    model: string,
    apiKey?: string,
    options: EmbeddingProviderRuntimeOptions = {},
  ) {
    let normalized = baseUrl.trim().replace(/\/+$/, '');
    if (normalized.endsWith('/api')) {
      normalized = normalized.slice(0, -4);
    }
    this.baseUrl = normalized.replace(/\/+$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.retry = normalizeRetryOptions(options.retry);
    this.logger = createScopedEmbeddingLogger(options.logger, 'embedding.ollama');
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
    const primaryUrl = `${this.baseUrl}/api/embed`;
    const res = await requestEmbeddingWithRateLimitRetry(
      {
        url: primaryUrl,
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, input: text, truncate: true }),
        throw: false,
      },
      this.retry,
      this.logger,
      { endpoint: primaryUrl, model: this.model, batchSize: 1, signal: options?.signal },
    );
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
        const fbRes = await requestEmbeddingWithRateLimitRetry(
          {
            url: request.url,
            method: 'POST',
            headers,
            body: request.body,
            throw: false,
          },
          this.retry,
          this.logger,
          { endpoint: request.url, model: this.model, batchSize: 1, signal: options?.signal },
        );
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
    const isContextLengthError =
      /context length|input length exceeds|exceeds the context length/i.test(rawError);
    const message = isContextLengthError
      ? t('ollamaEmbeddingContextTooLong', { error: rawError })
      : `Ollama embedding failed for model "${this.model}". Tried /api/embed -> ${res.status}, then ${fallbackRequests.map((request) => request.url).join(', ')}. Last error: ${rawError}`;
    throw new Error(message);
  }
}

const MAX_MEMORY_CACHE_SIZE = 5000;
const DEFAULT_PERSISTENT_CACHE_SIZE = 10_000;
const DEFAULT_PERSISTENT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PERSISTENT_PRUNE_INTERVAL = 128;

export function createEmbeddingCacheNamespace(providerKey: string, modelName: string): string {
  return `${providerKey.trim()}::${modelName.trim()}`;
}

export interface CachedEmbeddingProviderOptions {
  dbName?: string;
  maxPersistentEntries?: number;
  maxPersistentAgeMs?: number;
  pruneEveryWrites?: number;
  now?: () => number;
}

export class CachedEmbeddingProvider implements EmbeddingProvider {
  private inner: EmbeddingProvider;
  private memoryCache: Map<string, number[]>;
  private cacheNamespace: string;
  private cacheKeys: string[];
  private db: EmbeddingCacheDB;
  private readonly maxPersistentEntries: number;
  private readonly maxPersistentAgeMs: number;
  private readonly pruneEveryWrites: number;
  private readonly now: () => number;
  private writesSincePrune = 0;

  constructor(
    inner: EmbeddingProvider,
    cacheNamespace: string,
    options: CachedEmbeddingProviderOptions = {},
  ) {
    this.inner = inner;
    this.memoryCache = new Map();
    this.cacheKeys = [];
    this.cacheNamespace = cacheNamespace;
    this.db = new EmbeddingCacheDB(
      options.dbName ??
        `SuperpowerInsideEmbeddingCache-v2:${requireIndexedDbRecordKey('embedding-cache', cacheNamespace)}`,
    );
    this.maxPersistentEntries = normalizeCacheLimit(
      options.maxPersistentEntries,
      DEFAULT_PERSISTENT_CACHE_SIZE,
    );
    this.maxPersistentAgeMs = normalizeCacheLimit(
      options.maxPersistentAgeMs,
      DEFAULT_PERSISTENT_CACHE_MAX_AGE_MS,
    );
    this.pruneEveryWrites = normalizeCacheLimit(
      options.pruneEveryWrites,
      DEFAULT_PERSISTENT_PRUNE_INTERVAL,
    );
    this.now = options.now ?? Date.now;
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
    return requireIndexedDbRecordKey(this.cacheNamespace, text);
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    throwIfAborted(options?.signal);
    const hash = this.computeHash(text);
    throwIfAborted(options?.signal);
    const mem = this.memoryCache.get(hash);
    if (mem) return mem;

    const cached = await this.db.embeddings.get(hash);
    throwIfAborted(options?.signal);
    if (cached) {
      const cachedVector = embeddingVectorFromRecord(cached);
      if (cachedVector.length > 0) {
        this.setCache(hash, cachedVector);
        return cachedVector;
      }
    }

    const vector = await this.inner.embed(text, options);
    throwIfAborted(options?.signal);
    this.setCache(hash, vector);
    const updated = this.now();
    await this.db.transaction('rw', this.db.embeddings, this.db.access, async () => {
      await this.db.embeddings.put(embeddingRecord(hash, vector, updated));
      await this.db.access.put({ id: hash, updated });
    });
    await this.prunePersistentCacheIfNeeded(1);
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
    const dbLookupIndices: number[] = [];
    const dbLookupHashes: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const hash = hashes[i];
      const mem = this.memoryCache.get(hash);
      if (mem) {
        results[i] = mem;
        continue;
      }
      dbLookupIndices.push(i);
      dbLookupHashes.push(hash);
    }

    const cachedRecords = await this.db.embeddings.bulkGet(dbLookupHashes);
    throwIfAborted(options?.signal);
    const missingIndexGroups = new Map<string, number[]>();
    const missingHashes: string[] = [];
    const missingTexts: string[] = [];
    for (let lookupIndex = 0; lookupIndex < dbLookupIndices.length; lookupIndex++) {
      const originalIndex = dbLookupIndices[lookupIndex];
      const hash = dbLookupHashes[lookupIndex];
      const cached = cachedRecords[lookupIndex];
      if (cached) {
        const cachedVector = embeddingVectorFromRecord(cached);
        if (cachedVector.length > 0) {
          this.setCache(hash, cachedVector);
          results[originalIndex] = cachedVector;
          continue;
        }
      }
      const existingGroup = missingIndexGroups.get(hash);
      if (existingGroup) {
        existingGroup.push(originalIndex);
        continue;
      }
      missingIndexGroups.set(hash, [originalIndex]);
      missingHashes.push(hash);
      missingTexts.push(texts[originalIndex]);
    }

    if (missingTexts.length > 0) {
      const newVectors = await this.inner.embedBatch(missingTexts, options);
      throwIfAborted(options?.signal);
      const now = this.now();
      const bulkRecords: EmbeddingRecord[] = [];
      const accessRecords: EmbeddingAccessRecord[] = [];
      for (let j = 0; j < missingTexts.length; j++) {
        const vector = newVectors[j];
        const hash = missingHashes[j];
        for (const originalIdx of missingIndexGroups.get(hash) ?? []) {
          results[originalIdx] = vector;
        }
        this.setCache(hash, vector);
        bulkRecords.push(embeddingRecord(hash, vector, now));
        accessRecords.push({ id: hash, updated: now });
      }
      await this.db.transaction('rw', this.db.embeddings, this.db.access, async () => {
        await this.db.embeddings.bulkPut(bulkRecords);
        await this.db.access.bulkPut(accessRecords);
      });
      await this.prunePersistentCacheIfNeeded(bulkRecords.length);
      throwIfAborted(options?.signal);
    }

    return results as number[][];
  }

  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    this.cacheKeys = [];
    await this.db.transaction('rw', this.db.embeddings, this.db.access, async () => {
      await this.db.embeddings.clear();
      await this.db.access.clear();
    });
  }

  async deleteDatabase(): Promise<void> {
    this.memoryCache.clear();
    this.cacheKeys = [];
    const dbName = this.db.name;
    this.db.close({ disableAutoOpen: true });
    await Dexie.delete(dbName);
  }

  close(): void {
    this.memoryCache.clear();
    this.cacheKeys = [];
    this.db.close({ disableAutoOpen: true });
  }

  private async prunePersistentCacheIfNeeded(writes: number): Promise<void> {
    this.writesSincePrune += writes;
    if (this.writesSincePrune < this.pruneEveryWrites) return;
    this.writesSincePrune = 0;
    const records = await this.db.access.toArray();
    const plan = planIndexedDbRecordRetentionRust(
      records,
      this.maxPersistentEntries,
      this.now(),
      this.maxPersistentAgeMs,
    );
    if (!plan) {
      throw new Error('Rust embedding-cache retention planning failed');
    }
    if (plan.deleteIds.length === 0) return;
    await this.db.transaction('rw', this.db.embeddings, this.db.access, async () => {
      await this.db.embeddings.bulkDelete(plan.deleteIds);
      await this.db.access.bulkDelete(plan.deleteIds);
    });
    for (const id of plan.deleteIds) {
      this.memoryCache.delete(id);
    }
  }
}

function embeddingRecord(id: string, vector: readonly number[], updated: number): EmbeddingRecord {
  const values = new Float32Array(vector.length);
  values.set(vector);
  return {
    id,
    textHash: id,
    vectorBuffer: values.buffer.slice(0),
    dimension: vector.length,
    updated,
  };
}

function embeddingVectorFromRecord(record: EmbeddingRecord): number[] {
  if (record.vectorBuffer instanceof ArrayBuffer) {
    return Array.from(new Float32Array(record.vectorBuffer));
  }
  return Array.isArray(record.vector) ? [...record.vector] : [];
}

function normalizeCacheLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function requireIndexedDbRecordKey(namespace: string, value: string): string {
  const key = createIndexedDbRecordKeyRust(namespace, value);
  if (!key) {
    throw new Error('Rust IndexedDB record-key generation failed');
  }
  return key;
}
