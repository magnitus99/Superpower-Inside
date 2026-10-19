import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RAG_WASM_BASE64 } from './rag-wasm-bytes';
import { RustBm25RuntimeIndex } from './rust-core';
import type { BM25WorkerRequest, BM25WorkerResponse } from './bm25-worker-entry';

interface WorkerScope {
  onmessage: ((event: MessageEvent<BM25WorkerRequest>) => void) | null;
  postMessage(message: BM25WorkerResponse): void;
}

const dbNames = new Set<string>();
const responses: BM25WorkerResponse[] = [];
let nextRequestId = 1;

beforeAll(async () => {
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message) => responses.push(message),
  };
  vi.stubGlobal('self', scope);
  await import('./bm25-worker-entry');
});

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
  responses.length = 0;
});

describe('BM25 worker snapshot recovery', () => {
  it('필드와 경로는 단건 추가·snapshot·delta 이후에도 production 질의에서 검색된다', async () => {
    await send({
      operation: 'rebuild',
      wasmBase64: RAG_WASM_BASE64,
      documents: [
        {
          id: 'fielded',
          text: 'alpha beta gamma',
          sourcePath: 'reports/ledger.md',
          title: 'Previous',
        },
      ],
    });
    expect(
      (await send({ operation: 'search-top', query: 'title:previous', limit: 5 })).hits?.map(
        (hit) => hit.docId,
      ),
    ).toEqual(['fielded']);
    await send({
      operation: 'add',
      document: {
        id: 'fielded',
        text: 'alpha beta gamma',
        sourcePath: 'reports/ledger.md',
        path: 'override.md',
        title: 'Quarterly Ledger',
        headings: ['Deployment Guide'],
        tags: ['finance'],
      },
    });
    expect(
      (await send({ operation: 'search-top', query: 'title:previous', limit: 5 })).hits,
    ).toEqual([]);
    expect(
      (await send({ operation: 'search-top', query: 'path:override', limit: 5 })).hits,
    ).toEqual([]);
    for (const query of [
      'title:quarterly',
      'headings:deployment',
      'tags:finance',
      'path:ledger',
      '"alpha beta"',
      '"alpha gamma"~1',
      'alph*',
      'alphx',
    ]) {
      expect(
        (await send({ operation: 'search-top', query, limit: 5 })).hits?.map((hit) => hit.docId),
      ).toEqual(['fielded']);
    }
    const serialized = await send({ operation: 'serialize' });
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: [
        {
          id: 'delta',
          text: 'delta body',
          sourcePath: 'delta.md',
          order: 2,
          title: 'Future Report',
          tags: ['planning'],
        },
      ],
    });
    await send({ operation: 'initialize', dbName, snapshot: serialized.snapshot, sinceOrder: 1 });
    expect(
      (await send({ operation: 'search-top', query: 'title:quarterly', limit: 5 })).hits?.map(
        (hit) => hit.docId,
      ),
    ).toEqual(['fielded']);
    expect(
      (await send({ operation: 'search-top', query: 'tags:planning', limit: 5 })).hits?.map(
        (hit) => hit.docId,
      ),
    ).toEqual(['delta']);
  });

  it('위치 없는 legacy snapshot은 watermark 이전 원문도 자동 전량 복구한다', async () => {
    const snapshot = JSON.parse(createSnapshot([['legacy', 'alpha beta', 'legacy.md']])) as Record<
      string,
      unknown
    >;
    for (const document of snapshot.docs as Array<Record<string, unknown>>) delete document.runs;
    for (const term of snapshot.terms as Array<Record<string, unknown>>) delete term.pos;
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: [{ id: 'legacy', text: 'alpha beta', sourcePath: 'legacy.md', order: 1 }],
    });
    const result = await send({
      operation: 'initialize',
      dbName,
      snapshot: JSON.stringify(snapshot),
      sinceOrder: 100,
    });
    expect(result.snapshotRejected).toBe(true);
    expect(
      (await send({ operation: 'search-top', query: '"alpha beta"', limit: 5 })).hits?.map(
        (hit) => hit.docId,
      ),
    ).toEqual(['legacy']);
  });
  it('스냅샷 이후 문서와 tombstone만 델타로 적용한다', async () => {
    const dbName = createDbName();
    const snapshot = createSnapshot([['snap.md::0', 'snapshotalpha 원문', 'snap.md']]);
    await seedDb(dbName, {
      documents: [
        { id: 'old.md::0', text: 'staleomega 이전 문서', sourcePath: 'old.md', order: 50 },
        { id: 'new.md::0', text: 'deltaomega 새 문서', sourcePath: 'new.md', order: 150 },
      ],
      removals: [{ order: 120, kind: 'remove-source', target: 'snap.md' }],
    });

    const initialize = await send({
      operation: 'initialize',
      wasmBase64: RAG_WASM_BASE64,
      dbName,
      snapshot,
      sinceOrder: 100,
    });
    expect(initialize.error).toBeUndefined();
    expect(initialize.totalDocs).toBe(1);

    const removed = await send({ operation: 'search-top', query: 'snapshotalpha', limit: 5 });
    expect(removed.hits).toEqual([]);
    const stale = await send({ operation: 'search-top', query: 'staleomega', limit: 5 });
    expect(stale.hits).toEqual([]);
    const delta = await send({ operation: 'search-top', query: 'deltaomega', limit: 5 });
    expect(delta.hits?.map((hit) => hit.docId)).toEqual(['new.md::0']);
  });

  it('serialize 결과는 같은 문서 집합을 복원할 수 있는 스냅샷이어야 한다', async () => {
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: [
        { id: 'new.md::0', text: 'deltaomega 새 문서', sourcePath: 'new.md', order: 150 },
      ],
    });
    await send({
      operation: 'initialize',
      wasmBase64: RAG_WASM_BASE64,
      dbName,
      snapshot: createSnapshot([['snap.md::0', 'snapshotalpha 원문', 'snap.md']]),
      sinceOrder: 100,
    });

    const serialized = await send({ operation: 'serialize' });
    expect(typeof serialized.snapshot).toBe('string');

    const emptyDbName = createDbName();
    await seedDb(emptyDbName, {});
    const restored = await send({
      operation: 'initialize',
      wasmBase64: RAG_WASM_BASE64,
      dbName: emptyDbName,
      snapshot: serialized.snapshot ?? '',
      sinceOrder: 200,
    });
    expect(restored.error).toBeUndefined();
    const hits = await send({ operation: 'search-top', query: 'snapshotalpha', limit: 5 });
    expect(hits.hits?.map((hit) => hit.docId)).toEqual(['snap.md::0']);
  });

  it('손상된 스냅샷은 거절하고 저장된 원문에서 전량 복구한다', async () => {
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: [
        { id: 'old.md::0', text: 'staleomega 이전 문서', sourcePath: 'old.md', order: 50 },
        { id: 'new.md::0', text: 'deltaomega 새 문서', sourcePath: 'new.md', order: 150 },
      ],
    });

    const initialize = await send({
      operation: 'initialize',
      wasmBase64: RAG_WASM_BASE64,
      dbName,
      snapshot: '{"schemaVersion":3,"broken":',
      sinceOrder: 100,
      expectedDocs: 1,
    });
    expect(initialize.snapshotRejected).toBe(true);
    expect(initialize.totalDocs).toBe(2);
    const recovered = await send({ operation: 'search-top', query: 'staleomega', limit: 5 });
    expect(recovered.hits?.map((hit) => hit.docId)).toEqual(['old.md::0']);
  });
});

async function send(request: Omit<BM25WorkerRequest, 'id'>): Promise<BM25WorkerResponse> {
  const scope = (globalThis as unknown as { self: WorkerScope }).self;
  const id = nextRequestId++;
  scope.onmessage?.({ data: { id, ...request } } as MessageEvent<BM25WorkerRequest>);
  for (let attempt = 0; attempt < 400; attempt++) {
    const found = responses.find((response) => response.id === id && !response.progress);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('BM25 worker response was not delivered.');
}

function createSnapshot(documents: ReadonlyArray<readonly [string, string, string]>): string {
  const runtime = RustBm25RuntimeIndex.empty(2);
  if (!runtime) throw new Error('WASM 초기화 실패');
  try {
    for (const [id, text, sourcePath] of documents) {
      runtime.addDocument(id, text, sourcePath, 2);
    }
    return runtime.toJson();
  } finally {
    runtime.dispose();
  }
}

interface SeedDocument {
  id: string;
  text: string;
  sourcePath: string;
  order: number;
  title?: string;
  headings?: string[];
  tags?: string[];
}

interface SeedRemoval {
  order: number;
  kind: 'clear' | 'remove-doc' | 'remove-source';
  target: string;
}

async function seedDb(
  dbName: string,
  seed: { documents?: SeedDocument[]; removals?: SeedRemoval[] },
): Promise<void> {
  const db = new Dexie(dbName);
  db.version(3).stores({
    meta: 'key',
    documents: 'id, sourcePath, updated, order',
    mutations: 'id, kind, target, updated, order',
    removals: 'order, target',
    snapshotBlocks: 'key',
  });
  await db.table('documents').bulkPut(seed.documents ?? []);
  await db.table('removals').bulkPut(seed.removals ?? []);
  db.close();
}

function createDbName(): string {
  const name = `SuperpowerInsideBM25WorkerRecoveryTest-${crypto.randomUUID()}`;
  dbNames.add(name);
  return name;
}
