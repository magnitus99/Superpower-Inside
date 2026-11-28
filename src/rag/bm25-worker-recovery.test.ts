import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import { RustBm25RuntimeIndex } from './rust-core';
import type { BM25WorkerRequest, BM25WorkerResponse } from './bm25-worker-entry';

interface WorkerScope {
  onmessage: ((event: MessageEvent<BM25WorkerRequest>) => void) | null;
  postMessage(message: BM25WorkerResponse): void;
}

const dbNames = new Set<string>();
const responses: BM25WorkerResponse[] = [];
let nextRequestId = 1;
const SESSION = 'b238c776-a0d9-4e69-855a-eb39bcd65c94';
let revision = 0;

beforeAll(async () => {
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message) => responses.push(message),
  };
  vi.stubGlobal('self', scope);
  await import('./bm25-worker-entry');
});

beforeEach(async () => {
  revision = 0;
  const initialized = await send({ operation: 'initialize', wasmBase64: RAG_WASM_BASE64 });
  expect(initialized).toMatchObject({
    sessionId: SESSION,
    appliedRevision: 0,
    pendingRevision: null,
  });
});

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
  responses.length = 0;
});

describe('BM25 worker snapshot recovery', () => {
  it('Rust가 단건 추가를 거부하면 counts와 무관하게 완료 revision을 발행하지 않는다', async () => {
    const rejected = await send({
      operation: 'add',
      document: { id: '', text: 'synthetic invalid', sourcePath: 'invalid.md' },
    });
    expect(rejected.error).toEqual(expect.any(String));
    expect(rejected.appliedRevision).toBeNull();
    const late = await send({ operation: 'clear' });
    expect(late.error).toEqual(expect.any(String));
    expect(late.appliedRevision).toBeNull();
  });

  it('DB hydration의 중간 progress와 실패는 base revision 0을 발행하지 않는다', async () => {
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: Array.from({ length: 128 }, (_, index) => ({
        id: 'valid-' + index,
        text: 'synthetic valid',
        sourcePath: 'valid.md',
        order: index,
      })),
    });
    const db = new Dexie(dbName);
    await db.open();
    try {
      await db
        .table('documents')
        .put({ id: 'zz-invalid', text: 123, sourcePath: 'invalid.md', order: 129 });
    } finally {
      db.close();
    }
    const result = await send({ operation: 'initialize', dbName });
    expect(result.error).toEqual(expect.any(String));
    expect(result.appliedRevision).toBeNull();
    const progress = responses.filter((response) => response.id === result.id && response.progress);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      sessionId: SESSION,
      appliedRevision: null,
      pendingRevision: null,
      progress: { processedDocuments: 128 },
    });
  });

  it('hydrate 중 도착한 mutation은 복원 완료 뒤 실제 Rust에 적용한다', async () => {
    const dbName = createDbName();
    await seedDb(dbName, {
      documents: [
        { id: 'persisted', text: 'synthetic persisted', sourcePath: 'persisted.md', order: 1 },
      ],
    });
    const initialize = send({ operation: 'initialize', dbName });
    const mutation = send({
      operation: 'add',
      document: { id: 'following', text: 'synthetic following', sourcePath: 'following.md' },
    });
    expect(await initialize).toMatchObject({ appliedRevision: 0, totalDocs: 1 });
    expect(await mutation).toMatchObject({ appliedRevision: 1, totalDocs: 2 });
  });

  it('다른 session의 요청은 현재 entry session을 바꾸거나 증명을 복구하지 못한다', async () => {
    const result = await send({ operation: 'clear', sessionId: crypto.randomUUID() });
    expect(result.error).toEqual(expect.any(String));
    expect(result.sessionId).toBe(SESSION);
    expect(result.appliedRevision).toBeNull();
    expect((await send({ operation: 'initialize' })).appliedRevision).toBe(0);
  });
  it('실제 Rust 적용 완료만 논리 prefix를 전진시키며 129개 source의 중간 직렬화는 부분 상태를 보존한다', async () => {
    const documents = Array.from({ length: 129 }, (_, index) => ({
      id: 'part-' + index,
      text: 'synthetic marker ' + index,
      sourcePath: 'parts.md',
    }));
    const first = await send({
      operation: 'replace-source',
      target: 'parts.md',
      removeFirst: true,
      documents: documents.slice(0, 128),
      revision: 1,
      part: 0,
      finalPart: false,
    });
    expect(first).toMatchObject({
      appliedRevision: 0,
      pendingRevision: 1,
      nextPart: 1,
      totalDocs: 128,
    });
    const partial = await send({ operation: 'serialize' });
    expect(partial).toMatchObject({ appliedRevision: 0, pendingRevision: 1, nextPart: 1 });
    const restored = RustBm25RuntimeIndex.fromJson(partial.snapshot ?? '', 2);
    try {
      expect(restored?.totalDocs()).toBe(128);
    } finally {
      restored?.dispose();
    }
    const last = await send({
      operation: 'replace-source',
      target: 'parts.md',
      removeFirst: false,
      documents: documents.slice(128),
      revision: 1,
      part: 1,
      finalPart: true,
    });
    expect(last).toMatchObject({ appliedRevision: 1, pendingRevision: null, totalDocs: 129 });
    expect(
      await send({
        operation: 'add',
        document: { id: 'added', text: 'synthetic extra', sourcePath: 'extra.md' },
      }),
    ).toMatchObject({ appliedRevision: 2, pendingRevision: null });
    expect(
      await send({
        operation: 'rebuild',
        documents: [{ id: 'rebuilt', text: 'rebuilt marker', sourcePath: 'rebuilt.md' }],
      }),
    ).toMatchObject({ appliedRevision: 3, pendingRevision: null, totalDocs: 1 });
    const snapshot = await send({ operation: 'serialize' });
    expect(snapshot).toMatchObject({
      sessionId: SESSION,
      appliedRevision: 3,
      pendingRevision: null,
    });
    expect(
      (await send({ operation: 'search-top', query: 'rebuilt', limit: 5 })).hits?.map(
        (hit) => hit.docId,
      ),
    ).toEqual(['rebuilt']);
    expect(await send({ operation: 'aggregate', query: 'rebuilt', limit: 5 })).toMatchObject({
      appliedRevision: 3,
    });
    expect(await send({ operation: 'batch', queries: [], aggregates: [] })).toMatchObject({
      appliedRevision: 3,
    });
  });

  it('part 순서 오류 뒤에는 serialize나 늦은 mutation으로 증명을 복구하지 않는다', async () => {
    expect(
      await send({
        operation: 'replace-source',
        target: 'parts.md',
        documents: [],
        revision: 1,
        part: 1,
      }),
    ).toMatchObject({ error: expect.any(String) as unknown, appliedRevision: null });
    expect(await send({ operation: 'clear', revision: 1 })).toMatchObject({
      error: expect.any(String) as unknown,
      appliedRevision: null,
    });
    expect(await send({ operation: 'serialize' })).toMatchObject({
      error: expect.any(String) as unknown,
      appliedRevision: null,
    });
    expect(await send({ operation: 'initialize', wasmBase64: RAG_WASM_BASE64 })).toMatchObject({
      appliedRevision: 0,
      pendingRevision: null,
    });
    expect(await send({ operation: 'clear' })).toMatchObject({ appliedRevision: 1 });
  });

  it('실제 mutation 실패는 prefix를 폐기하고 정식 초기화 전까지 다음 ACK를 금지한다', async () => {
    expect(await send({ operation: 'add' })).toMatchObject({
      error: expect.any(String) as unknown,
      appliedRevision: null,
    });
    expect(await send({ operation: 'rebuild', documents: [] })).toMatchObject({
      error: expect.any(String) as unknown,
      appliedRevision: null,
    });
  });

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

    const tooLarge = await send({ operation: 'serialize', maxSnapshotBytes: 32 });
    expect(tooLarge.snapshot).toBe('');
    expect(tooLarge.appliedRevision).toBe(serialized.appliedRevision);
    expect(tooLarge.sessionId).toBe(serialized.sessionId);
    const byteLength = new TextEncoder().encode(serialized.snapshot).length;
    const bounded = await send({ operation: 'serialize', maxSnapshotBytes: byteLength });
    expect(bounded.snapshot).toBe(serialized.snapshot);

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

async function send(
  request: Omit<BM25WorkerRequest, 'id' | 'sessionId' | 'revision' | 'part' | 'finalPart'> & {
    sessionId?: string;
    revision?: number;
    part?: number;
    finalPart?: boolean;
  },
): Promise<BM25WorkerResponse> {
  const scope = (globalThis as unknown as { self: WorkerScope }).self;
  const id = nextRequestId++;
  if (request.operation === 'initialize') revision = 0;
  else if (
    ['rebuild', 'add', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(
      request.operation,
    )
  )
    revision = request.revision ?? revision + 1;
  scope.onmessage?.({
    data: { id, sessionId: SESSION, revision, part: 0, finalPart: true, ...request },
  } as MessageEvent<BM25WorkerRequest>);
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
