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
}

const MAX_INDEX_CACHE_SIZE = 2;
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
    const index = await getOrBuildIndex(request.dbName, filter, request.records);
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
  providedRecords?: PersistedVectorRecord[],
): Promise<CachedVectorIndex> {
  const key = createIndexKey(dbName, filter);
  const cached = indexCache.get(key);
  if (cached) {
    indexCache.delete(key);
    indexCache.set(key, cached);
    return cached;
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
  const next = { ids, dimension, runtime: new VectorRuntimeIndex(compactMatrix, dimension) };
  indexCache.set(key, next);
  while (indexCache.size > MAX_INDEX_CACHE_SIZE) {
    const oldestKey = indexCache.keys().next().value;
    if (!oldestKey) break;
    indexCache.get(oldestKey)?.runtime.free();
    indexCache.delete(oldestKey);
  }
  return next;
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

function createIndexKey(dbName: string, filter: VectorSearchFilter): string {
  return [
    dbName,
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
