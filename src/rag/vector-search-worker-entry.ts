import { readWorkerStorePages } from './worker-indexed-db';
import {
  VectorRuntimeIndex,
  initSync,
  plan_vector_scope_indices_json,
} from '../../generated/rag-wasm/rag_wasm';

interface VectorSearchFilter {
  embeddingProvider?: string;
  embeddingModel?: string;
  dimension?: number;
  filePathPrefixes?: readonly string[];
}

interface VectorSearchWorkerRequest {
  id: number;
  operation: 'search';
  wasmBase64?: string;
  dbName: string;
  queryVector: number[];
  topK: number;
  filter?: VectorSearchFilter;
  /** 스토어 변경 세대. 색인 캐시 키에 포함되어 쓰기 뒤 구세대를 재사용하지 않습니다. */
  revision?: number;
  /** 단일 색인이 차지할 수 있는 최대 바이트. 초과하면 명시 오류로 정확 검색에 위임합니다. */
  maxIndexBytes?: number;
  records?: PersistedVectorRecord[];
}

interface VectorSearchWorkerHit {
  id: string;
  score: number;
}

interface VectorSearchWorkerResponse {
  id: number;
  hits?: VectorSearchWorkerHit[];
  indexedCount?: number;
  revision?: number;
  cacheHit?: boolean;
  indexBytes?: number;
  error?: string;
}

interface PersistedVectorRecord {
  id: string;
  filePath?: string;
  vectorBuffer?: ArrayBuffer;
  vector?: number[];
  dimension: number;
  embeddingProvider?: string;
  embeddingModel?: string;
  metadata?: {
    filePath?: string;
    embeddingProvider?: string;
    embeddingModel?: string;
  };
}

interface CachedVectorIndex {
  ids: string[];
  dimension: number;
  runtime: VectorRuntimeIndex;
  indexBytes: number;
}

/** 작업자가 만든 색인을 유지하는 세대 수입니다. 쓰기마다 세대가 바뀌므로 최근 세대만 남깁니다. */
const MAX_INDEX_CACHE_SIZE = 2;
const DEFAULT_MAX_INDEX_BYTES = 192 * 1024 * 1024;
const indexCache = new Map<string, CachedVectorIndex>();
let initialized = false;
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<VectorSearchWorkerRequest>): void => {
  const request = event.data;
  queue = queue.then(() => handleMessage(request));
};

async function handleMessage(request: VectorSearchWorkerRequest): Promise<void> {
  try {
    if (!initialized) {
      if (!request.wasmBase64) throw new Error('Vector search worker WASM payload is missing.');
      initSync({ module: decodeBase64(request.wasmBase64) });
      initialized = true;
    }
    if (request.operation !== 'search') throw new Error('Unknown vector worker operation.');
    const query = Float32Array.from(request.queryVector);
    if (query.length === 0) throw new Error('Vector search query is empty.');
    const filter = { ...request.filter, dimension: request.filter?.dimension ?? query.length };
    const cache = await getOrBuildIndex(
      request.dbName,
      filter,
      request.revision,
      request.maxIndexBytes,
      request.records,
    );
    const index = cache.index;
    if (index.dimension !== query.length) {
      throw new Error('Vector search query dimension does not match the index.');
    }
    const pairs = index.runtime.rank_top_k(query, Math.max(0, Math.floor(request.topK)));
    const hits: VectorSearchWorkerHit[] = [];
    for (let offset = 0; offset + 1 < pairs.length; offset += 2) {
      const rowIndex = pairs[offset];
      const score = pairs[offset + 1];
      if (
        rowIndex === undefined ||
        score === undefined ||
        !Number.isInteger(rowIndex) ||
        rowIndex < 0 ||
        rowIndex >= index.ids.length ||
        !Number.isFinite(score)
      ) {
        continue;
      }
      const id = index.ids[rowIndex];
      if (id) hits.push({ id, score });
    }
    self.postMessage({
      id: request.id,
      hits,
      indexedCount: index.ids.length,
      revision: request.revision,
      cacheHit: cache.cacheHit,
      indexBytes: index.indexBytes,
    } satisfies VectorSearchWorkerResponse);
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies VectorSearchWorkerResponse);
  }
}

async function getOrBuildIndex(
  dbName: string,
  filter: VectorSearchFilter,
  revision: number | undefined,
  requestedMaxIndexBytes: number | undefined,
  providedRecords?: PersistedVectorRecord[],
): Promise<{ index: CachedVectorIndex; cacheHit: boolean }> {
  const key = createIndexKey(dbName, filter, revision);
  const cached = indexCache.get(key);
  if (cached) {
    indexCache.delete(key);
    indexCache.set(key, cached);
    return { index: cached, cacheHit: true };
  }
  const matchingRecords =
    providedRecords?.filter((record) => matchesFilter(record, filter)) ??
    (await readMatchingVectors(dbName, filter));
  const scopePlan = plan_vector_scope_indices_json(
    JSON.stringify(
      matchingRecords.map((record) => record.filePath ?? record.metadata?.filePath ?? ''),
    ),
    JSON.stringify(filter.filePathPrefixes ?? []),
  );
  if (!scopePlan) throw new Error('Vector search scope planning failed.');
  const indices: unknown = JSON.parse(scopePlan);
  if (!Array.isArray(indices)) throw new Error('Vector search scope result is invalid.');
  const records = indices.flatMap((index: unknown) => {
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !matchingRecords[index]
    )
      throw new Error('Vector search scope index is invalid.');
    return [matchingRecords[index]];
  });
  const dimension = filter.dimension ?? records[0]?.dimension ?? 0;
  if (dimension <= 0) throw new Error('Vector search index dimension is invalid.');
  const vectorBytes = records.length * dimension * 4;
  const maxIndexBytes = normalizeMaxIndexBytes(requestedMaxIndexBytes);
  if (vectorBytes > maxIndexBytes) {
    throw new Error(
      `Vector search index requires ${vectorBytes} bytes above the ${maxIndexBytes} byte budget.`,
    );
  }
  const ids: string[] = [];
  const matrix = new Float32Array(records.length * dimension);
  let rowCount = 0;
  for (const record of records) {
    const vector = readVector(record);
    if (vector.length !== dimension) continue;
    ids.push(record.id);
    matrix.set(vector, rowCount * dimension);
    rowCount++;
  }
  const compactMatrix =
    rowCount === records.length ? matrix : matrix.slice(0, rowCount * dimension);
  const next: CachedVectorIndex = {
    ids,
    dimension,
    runtime: new VectorRuntimeIndex(compactMatrix, dimension),
    indexBytes: rowCount * dimension * 4,
  };
  indexCache.set(key, next);
  evictIndexesAboveBudget(maxIndexBytes);
  return { index: next, cacheHit: false };
}

/** 캐시된 색인 총량이 예산을 넘으면 가장 오래된 세대부터 해제합니다. */
function evictIndexesAboveBudget(maxIndexBytes: number): void {
  while (indexCache.size > 1) {
    let totalBytes = 0;
    for (const entry of indexCache.values()) totalBytes += entry.indexBytes;
    if (totalBytes <= maxIndexBytes && indexCache.size <= MAX_INDEX_CACHE_SIZE) return;
    const oldestKey = indexCache.keys().next().value;
    if (!oldestKey) return;
    indexCache.get(oldestKey)?.runtime.free();
    indexCache.delete(oldestKey);
  }
}

function normalizeMaxIndexBytes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_INDEX_BYTES;
  return Math.max(4, Math.floor(value));
}

async function readMatchingVectors(
  dbName: string,
  filter: VectorSearchFilter,
): Promise<PersistedVectorRecord[]> {
  const records: PersistedVectorRecord[] = [];
  await readWorkerStorePages(dbName, 'vectors', (batch) => {
    for (const raw of batch) {
      const record = raw as PersistedVectorRecord;
      if (matchesFilter(record, filter)) records.push(record);
    }
  });
  return records;
}

function matchesFilter(record: PersistedVectorRecord, filter: VectorSearchFilter): boolean {
  const provider = record.embeddingProvider ?? record.metadata?.embeddingProvider;
  const model = record.embeddingModel ?? record.metadata?.embeddingModel;
  if (filter.embeddingProvider && provider && filter.embeddingProvider !== provider) return false;
  if (filter.embeddingModel && model && filter.embeddingModel !== model) return false;
  if (filter.dimension !== undefined && filter.dimension !== record.dimension) return false;
  return true;
}

function readVector(record: PersistedVectorRecord): Float32Array {
  if (record.vectorBuffer instanceof ArrayBuffer) return new Float32Array(record.vectorBuffer);
  return Float32Array.from(record.vector ?? []);
}

function createIndexKey(
  dbName: string,
  filter: VectorSearchFilter,
  revision: number | undefined,
): string {
  return [
    dbName,
    String(revision ?? 0),
    filter.embeddingProvider ?? '',
    filter.embeddingModel ?? '',
    String(filter.dimension ?? 0),
    JSON.stringify(filter.filePathPrefixes ?? []),
  ].join('\0');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
