import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';

interface VectorSearchWorkerRequest {
  id: number;
  operation: 'search';
  wasmBase64?: string;
  dbName: string;
  queryVector: number[];
  topK: number;
  filter?: {
    embeddingProvider?: string;
    embeddingModel?: string;
    dimension?: number;
    filePathPrefixes?: readonly string[];
  };
  revision?: number;
  maxIndexBytes?: number;
}

interface VectorSearchWorkerResponse {
  id: number;
  hits?: Array<{ id: string; score: number }>;
  indexedCount?: number;
  revision?: number;
  cacheHit?: boolean;
  indexBytes?: number;
  error?: string;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<VectorSearchWorkerRequest>) => void) | null;
  postMessage(message: VectorSearchWorkerResponse): void;
}

const dbNames = new Set<string>();
const responses: VectorSearchWorkerResponse[] = [];
let nextRequestId = 1;

beforeAll(async () => {
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message) => responses.push(message),
  };
  vi.stubGlobal('self', scope);
  await import('./vector-search-worker-entry');
});

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
  responses.length = 0;
});

describe('Vector search worker generation cache', () => {
  it('같은 revision과 filter는 색인을 재사용하고 revision이 바뀌면 다시 만든다', async () => {
    const dbName = createDbName();
    await seedVectors(dbName, [
      createVector('a.md::0', 'a.md', [1, 0]),
      createVector('b.md::0', 'b.md', [0, 1]),
      createVector('c.md::0', 'c.md', [0.7, 0.7]),
    ]);

    const first = await sendSearch(dbName, { revision: 1 });
    expect(first.error).toBeUndefined();
    expect(first.cacheHit).toBe(false);
    expect(first.indexedCount).toBe(3);
    expect(first.indexBytes).toBe(3 * 2 * 4);

    const second = await sendSearch(dbName, { revision: 1 });
    expect(second.cacheHit).toBe(true);
    expect(second.hits?.map((hit) => hit.id)).toEqual(first.hits?.map((hit) => hit.id));

    await deleteVector(dbName, 'c.md::0');
    const third = await sendSearch(dbName, { revision: 2 });
    expect(third.cacheHit).toBe(false);
    expect(third.indexedCount).toBe(2);
    expect(third.hits?.some((hit) => hit.id === 'c.md::0')).toBe(false);
  });

  it('provider·model·dimension·prefix가 다르면 색인 캐시를 공유하지 않는다', async () => {
    const dbName = createDbName();
    await seedVectors(dbName, [
      createVector('a.md::0', 'a.md', [1, 0], { embeddingModel: 'model-a' }),
      createVector('b.md::0', 'b.md', [0, 1], { embeddingModel: 'model-b' }),
    ]);

    const modelA = await sendSearch(dbName, {
      revision: 1,
      filter: { embeddingModel: 'model-a', dimension: 2 },
    });
    const modelB = await sendSearch(dbName, {
      revision: 1,
      filter: { embeddingModel: 'model-b', dimension: 2 },
    });
    const repeatedA = await sendSearch(dbName, {
      revision: 1,
      filter: { embeddingModel: 'model-a', dimension: 2 },
    });

    expect(modelA.cacheHit).toBe(false);
    expect(modelB.cacheHit).toBe(false);
    expect(repeatedA.cacheHit).toBe(true);
    expect(modelA.indexedCount).toBe(1);
    expect(modelB.indexedCount).toBe(1);
  });

  it('색인이 메모리 예산을 넘으면 명시 오류로 정확 검색에 위임한다', async () => {
    const dbName = createDbName();
    await seedVectors(dbName, [
      createVector('a.md::0', 'a.md', [1, 0]),
      createVector('b.md::0', 'b.md', [0, 1]),
    ]);

    const response = await sendSearch(dbName, { revision: 1, maxIndexBytes: 8 });

    expect(response.hits).toBeUndefined();
    expect(response.error).toContain('byte budget');
  });
});

async function sendSearch(
  dbName: string,
  options: {
    revision: number;
    maxIndexBytes?: number;
    filter?: VectorSearchWorkerRequest['filter'];
  },
): Promise<VectorSearchWorkerResponse> {
  const scope = (globalThis as unknown as { self: WorkerScope }).self;
  const id = nextRequestId++;
  scope.onmessage?.({
    data: {
      id,
      operation: 'search',
      wasmBase64: RAG_WASM_BASE64,
      dbName,
      queryVector: [1, 0],
      topK: 3,
      filter: { dimension: 2, ...options.filter },
      revision: options.revision,
      maxIndexBytes: options.maxIndexBytes,
    },
  } as MessageEvent<VectorSearchWorkerRequest>);
  for (let attempt = 0; attempt < 400; attempt++) {
    const found = responses.find((response) => response.id === id);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Vector search worker response was not delivered.');
}

interface SeedVectorRecord {
  id: string;
  filePath: string;
  dimension: number;
  vector: number[];
  embeddingModel?: string;
}

function createVector(
  id: string,
  filePath: string,
  vector: number[],
  options: { embeddingModel?: string } = {},
): SeedVectorRecord {
  return { id, filePath, dimension: vector.length, vector, embeddingModel: options.embeddingModel };
}

async function seedVectors(dbName: string, records: SeedVectorRecord[]): Promise<void> {
  const db = new Dexie(dbName);
  db.version(1).stores({ vectors: 'id, filePath' });
  await db.table('vectors').bulkPut(
    records.map((record) => ({
      ...record,
      vectorBuffer: Float32Array.from(record.vector).buffer,
      metadata: { filePath: record.filePath, embeddingModel: record.embeddingModel },
    })),
  );
  db.close();
}

async function deleteVector(dbName: string, id: string): Promise<void> {
  const db = new Dexie(dbName);
  db.version(1).stores({ vectors: 'id, filePath' });
  await db.table('vectors').delete(id);
  db.close();
}

function createDbName(): string {
  const name = `SuperpowerInsideVectorWorkerGenerationTest-${crypto.randomUUID()}`;
  dbNames.add(name);
  return name;
}
