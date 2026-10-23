import { countWorkerStoreRows, readWorkerStorePages } from './worker-indexed-db';
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
  /**
   * 호출자가 요청한 검색 방식입니다. 작업자는 볼트 전체 색인 하나를 정확 검색으로 유지합니다.
   * 263MB 행렬의 IVF k-means는 색인 생성에만 2분 가까이 들어 질의 경로에 쓸 수 없고,
   * 정확 검색은 같은 데이터에서 질의당 수백 ms면 충분합니다. 작은 저장소의 ANN은 메인 스레드 경로가 맡습니다.
   */
  mode?: 'exact' | 'ann';
  annMinEntryCount?: number;
  annClusterCount?: number;
  annProbeCount?: number;
  annIterations?: number;
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
  /**
   * 실제로 수행한 검색 방식입니다. 작업자는 항상 세대별 전체 색인을 정확 검색하므로 'exact'입니다.
   */
  mode?: 'exact' | 'ann';
  /** 색인을 새로 만든 시간과 질의 계산 시간입니다. 캐시 적중이면 buildMs는 0입니다. */
  buildMs?: number;
  queryMs?: number;
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
  /** 범위 필터를 질의 시점에 계산하려면 행별 경로가 필요합니다. */
  paths: string[];
  dimension: number;
  index: VectorRuntimeIndex;
  indexBytes: number;
  /** 같은 범위로 반복 질의할 때 경로 계획을 다시 만들지 않습니다. */
  scopeRows: Map<string, Uint32Array>;
}

/** 색인이 유지하는 범위 계획 수입니다. 검색 화면과 채팅이 쓰는 범위만 남깁니다. */
const MAX_SCOPE_CACHE_SIZE = 8;
/**
 * 작업자가 만든 색인을 유지하는 세대 수입니다. 볼트 전체 색인 하나를 세대별로 유지합니다.
 * 범위(파일 경로)는 색인 키에 넣지 않습니다. 범위마다 263MB 색인을 다시 만들면
 * 질의마다 수십 초가 들고, 경로별 행 선택만으로도 같은 결과를 낼 수 있습니다.
 */
const MAX_INDEX_CACHE_SIZE = 2;
/**
 * 단일 색인이 차지할 수 있는 최대 바이트. 정규화 행렬(JS)과 WASM 사본이 동시에 존재하므로
 * 실제 피크는 이 값의 두 배 안팎입니다.
 */
const DEFAULT_MAX_INDEX_BYTES = 512 * 1024 * 1024;
const indexCache = new Map<string, CachedVectorIndex>();
/** 같은 세대·필터의 동시 요청이 색인을 두 번 만들지 않도록 진행 중인 빌드를 공유합니다. */
const indexBuilds = new Map<string, Promise<{ index: CachedVectorIndex; cacheHit: boolean }>>();
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
    const buildStarted = performance.now();
    const cache = await getOrBuildIndex(request.dbName, filter, request);
    const buildMs = cache.cacheHit ? 0 : performance.now() - buildStarted;
    const index = cache.index;
    if (index.dimension !== query.length) {
      throw new Error('Vector search query dimension does not match the index.');
    }
    const queryStarted = performance.now();
    const topK = Math.max(0, Math.floor(request.topK));
    const scopeRows = resolveScopeRows(index, filter.filePathPrefixes);
    const pairs = scopeRows
      ? index.index.rank_top_k_filtered(query, scopeRows, topK)
      : index.index.rank_top_k(query, topK);
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
      mode: 'exact',
      buildMs: Math.round(buildMs),
      queryMs: Math.round(performance.now() - queryStarted),
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
  request: VectorSearchWorkerRequest,
): Promise<{ index: CachedVectorIndex; cacheHit: boolean }> {
  const key = createIndexKey(dbName, filter, request);
  const cached = indexCache.get(key);
  if (cached) {
    indexCache.delete(key);
    indexCache.set(key, cached);
    return { index: cached, cacheHit: true };
  }
  const running = indexBuilds.get(key);
  if (running) return running;
  const build = buildIndex(dbName, filter, key, request).finally(() =>
    indexBuilds.delete(key),
  );
  indexBuilds.set(key, build);
  return build;
}

async function buildIndex(
  dbName: string,
  filter: VectorSearchFilter,
  key: string,
  request: VectorSearchWorkerRequest,
): Promise<{ index: CachedVectorIndex; cacheHit: boolean }> {
  const maxIndexBytes = normalizeMaxIndexBytes(request.maxIndexBytes);
  const providedRecords = request.records;
  const dimension = filter.dimension ?? (await readFirstMatchingDimension(dbName, filter));
  if (dimension <= 0) throw new Error('Vector search index dimension is invalid.');
  const matchingRecords = providedRecords?.filter((record) => matchesFilter(record, filter));
  const totalRows = matchingRecords?.length ?? (await countWorkerStoreRows(dbName, 'vectors'));
  // 저장소 전체 행을 상한으로 예산을 먼저 확인해, 예산 초과 색인을 읽지 않고 즉시 위임합니다.
  let allocation = totalRows;
  if (totalRows * dimension * 4 > maxIndexBytes) {
    allocation = matchingRecords
      ? matchingRecords.length
      : await countMatchingRows(dbName, filter, dimension);
    assertIndexBudget(allocation * dimension * 4, maxIndexBytes);
  }
  const ids: string[] = [];
  const paths: string[] = [];
  const matrix = new Float32Array(allocation * dimension);
  let rowCount = 0;
  const appendRecord = (record: PersistedVectorRecord): void => {
    if (!matchesFilter(record, filter)) return;
    const vector = readVector(record);
    if (vector.length !== dimension) return;
    if (rowCount * dimension + dimension > matrix.length) return;
    matrix.set(vector, rowCount * dimension);
    ids.push(record.id);
    paths.push(record.filePath ?? record.metadata?.filePath ?? '');
    rowCount++;
  };
  if (matchingRecords) {
    for (const record of matchingRecords) appendRecord(record);
  } else {
    await readWorkerStorePages(dbName, 'vectors', (batch) => {
      for (const raw of batch) appendRecord(raw as PersistedVectorRecord);
    });
  }
  const index = buildWholeIndex(matrix, ids, paths, rowCount, dimension);
  indexCache.set(key, index);
  evictIndexesAboveBudget(maxIndexBytes);
  return { index, cacheHit: false };
}

/**
 * 범위 필터는 색인을 다시 만들지 않고 행 선택으로 처리합니다. 계획 결과를 색인별로 캐시해
 * 같은 범위의 반복 질의가 85,850개 경로를 매번 직렬화하지 않게 합니다.
 */
function resolveScopeRows(
  index: CachedVectorIndex,
  prefixes: readonly string[] | undefined,
): Uint32Array | null {
  const scopes = normalizeScopes(prefixes);
  if (scopes.length === 0) return null;
  const key = scopes.join('\u0000');
  const cached = index.scopeRows.get(key);
  if (cached) return cached;
  const rows = Uint32Array.from(planScopeIndices(index.paths, scopes));
  index.scopeRows.set(key, rows);
  while (index.scopeRows.size > MAX_SCOPE_CACHE_SIZE) {
    const oldest = index.scopeRows.keys().next().value;
    if (oldest === undefined) break;
    index.scopeRows.delete(oldest);
  }
  return rows;
}

/** 필터에 맞는 행만 순회하며 색인 행 수를 셉니다(벡터 복사 없음). */
async function countMatchingRows(
  dbName: string,
  filter: VectorSearchFilter,
  dimension: number,
): Promise<number> {
  let rows = 0;
  await readWorkerStorePages(dbName, 'vectors', (batch) => {
    for (const raw of batch) {
      const record = raw as PersistedVectorRecord;
      if (matchesFilter(record, filter) && record.dimension === dimension) rows++;
    }
  });
  return rows;
}

/** 파일 경로 범위 선택은 Rust 계획에 맡깁니다. */
function planScopeIndices(paths: readonly string[], scopes: readonly string[]): number[] {
  const plan = plan_vector_scope_indices_json(JSON.stringify([...paths]), JSON.stringify([...scopes]));
  if (!plan) throw new Error('Vector search scope planning failed.');
  const indices: unknown = JSON.parse(plan);
  if (!Array.isArray(indices)) throw new Error('Vector search scope result is invalid.');
  return indices.flatMap((index: unknown) => {
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= paths.length)
      throw new Error('Vector search scope index is invalid.');
    return [index];
  });
}

function buildWholeIndex(
  matrix: Float32Array,
  ids: readonly string[],
  paths: readonly string[],
  rowCount: number,
  dimension: number,
): CachedVectorIndex {
  const compactMatrix = rowCount * dimension === matrix.length ? matrix : matrix.slice(0, rowCount * dimension);
  return {
    ids: [...ids],
    paths: [...paths],
    dimension,
    index: new VectorRuntimeIndex(compactMatrix, dimension),
    indexBytes: ids.length * dimension * 4,
    scopeRows: new Map(),
  };
}

function assertIndexBudget(vectorBytes: number, maxIndexBytes: number): void {
  if (vectorBytes > maxIndexBytes) {
    throw new Error(
      `Vector search index requires ${vectorBytes} bytes above the ${maxIndexBytes} byte budget.`,
    );
  }
}

function normalizeScopes(prefixes: readonly string[] | undefined): string[] {
  return (prefixes ?? []).filter((prefix) => prefix.length > 0);
}

async function readFirstMatchingDimension(
  dbName: string,
  filter: VectorSearchFilter,
): Promise<number> {
  let dimension = 0;
  try {
    await readWorkerStorePages(dbName, 'vectors', (batch) => {
      for (const raw of batch) {
        const record = raw as PersistedVectorRecord;
        if (!matchesFilter(record, filter)) continue;
        dimension = record.dimension;
        throw dimension > 0 ? STOP_READ : new Error('Vector search index dimension is invalid.');
      }
    });
  } catch (error) {
    if (error !== STOP_READ) throw error;
  }
  return dimension;
}

/** 첫 일치 레코드를 찾은 뒤 페이지 읽기를 멈추기 위한 신호입니다. */
const STOP_READ = new Error('stop');


/** 캐시된 색인 총량이 예산을 넘으면 가장 오래된 세대부터 해제합니다. */
function evictIndexesAboveBudget(maxIndexBytes: number): void {
  while (indexCache.size > 1) {
    let totalBytes = 0;
    for (const entry of indexCache.values()) totalBytes += entry.indexBytes;
    if (totalBytes <= maxIndexBytes && indexCache.size <= MAX_INDEX_CACHE_SIZE) return;
    const oldestKey = indexCache.keys().next().value;
    if (!oldestKey) return;
    const oldest = indexCache.get(oldestKey);
    oldest?.index.free();
    indexCache.delete(oldestKey);
  }
}

function normalizeMaxIndexBytes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_INDEX_BYTES;
  return Math.max(4, Math.floor(value));
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
  request: VectorSearchWorkerRequest,
): string {
  // 범위(파일 경로)와 검색 방식은 키에 넣지 않습니다. 둘 다 질의 시점에 행 선택으로 처리해
  // 같은 세대에서 색인을 한 번만 만듭니다.
  return [
    dbName,
    String(request.revision ?? 0),
    filter.embeddingProvider ?? '',
    filter.embeddingModel ?? '',
    String(filter.dimension ?? 0),
  ].join('\0');
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
