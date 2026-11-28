import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { IndexedDbBM25Index } from './bm25';
import { bm25PostingKey, BM25_POSTING_CHECKSUM_SEED, checksumBm25PostingPage, readBm25PostingPages, type BM25PostingManifest } from './bm25-posting-checkpoint';
import { TOKENIZER_VERSION } from './tokenizer-version';
import type { BM25WorkerFactory, BM25WorkerRequest, BM25WorkerResponse } from './bm25-worker-runtime';

const key = 'bm25-posting-checkpoint:v1';

async function workerFixture(intercept?: (response: BM25WorkerResponse, deliver: () => void) => void) {
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  let deliver: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
  const scope = {
    onmessage: null as ((event: MessageEvent<BM25WorkerRequest>) => void) | null,
    postMessage: (response: BM25WorkerResponse) => {
      const send = () => deliver?.({ data: response } as MessageEvent<BM25WorkerResponse>);
      if (intercept) intercept(response, send);
      else send();
    },
  };
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: scope });
  vi.resetModules();
  await import('./bm25-worker-entry');
  const requests: BM25WorkerRequest[] = [];
  const factory: BM25WorkerFactory = () => ({ worker: {
    postMessage: (message) => { requests.push(message); scope.onmessage?.({ data: message } as MessageEvent<BM25WorkerRequest>); },
    terminate: vi.fn(), setOnMessage: (handler) => { deliver = handler; }, setOnError: vi.fn(),
  }, dispose: vi.fn() });
  return { factory, requests, restore: () => {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  } };
}

it('reads exact decimal checkpoint keys in numeric order across bulk requests and checks the tail', async () => {
  const name = `bm25-posting-reader-${crypto.randomUUID()}`;
  const index = new IndexedDbBM25Index(name);
  const db = index['db'];
  const generation = crypto.randomUUID();
  const pages = Array.from({ length: 13 }, (_, i) => new Uint8Array(17).fill(i));
  const manifest: BM25PostingManifest = {
    version: 1, tokenizerVersion: TOKENIZER_VERSION, generation, lastOrder: 0, headOrder: 0,
    sourceReceipt: null, headReceipt: null, docCount: pages.length, blockCount: pages.length,
    byteLength: pages.length * 17, checksum: pages.reduce(checksumBm25PostingPage, BM25_POSTING_CHECKSUM_SEED),
  };
  const read = vi.fn();
  try {
    await db.snapshotBlocks.bulkPut(pages.map((data, part) => ({ key: bm25PostingKey(generation, part), data })));
    expect(await readBm25PostingPages(db.name, manifest, read)).toMatchObject({ pages: 13, bytes: 221 });
    expect(read.mock.calls).toEqual(pages.map((page, part) => [page, part]));
    await db.snapshotBlocks.delete(bm25PostingKey(generation, 12));
    await expect(readBm25PostingPages(db.name, manifest, () => {})).rejects.toThrow('Missing or invalid BM25 posting block.');
  } finally {
    await index.deleteDatabase();
  }
  await expect(readBm25PostingPages(db.name, manifest, () => {})).rejects.toThrow();
  expect((await indexedDB.databases()).some((row) => row.name === db.name)).toBe(false);
});

it.each(['page', 'checksum', 'tokenizer', 'missing block'] as const)('migrates once, replays a bounded delta, and safely falls back on %s corruption', async (corruption) => {
  const fixture = await workerFixture();
  const { factory, requests } = fixture;
  const name = `bm25-posting-${crypto.randomUUID()}`;
  const first = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: factory });
  const next = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: factory });
  const afterCorruption = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: factory });
  const rawReads: string[] = [];
  const getAll = Reflect.get(IDBObjectStore.prototype, 'getAll');
  const spy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (this.name === 'documents') rawReads.push(this.name);
    return getAll.call(this, ...args);
  });
  try {
    const count = 850;
    const tokens = Array.from({ length: 180 }, (_, i) => `word${i.toString(36)}fixture`).join(' ');
    const db = first['db'];
    await db.documents.bulkPut(Array.from({ length: count }, (_, i) => ({
      id: `chunk-${i}`, sourcePath: `${i}.md`, text: `needle phrase ${tokens}`, updated: 1, order: i + 1,
    })));
    await first.load();
    expect(first.recoveryMode).toBe('full');
    const manifest = (await db.durability.get(key))?.value as { byteLength: number; blockCount: number; generation: string; checksum: number };
    expect(await first['workerRuntime']?.serializeCheckpoint(2 * 1024 * 1024)).toMatchObject({ snapshot: '' });
    expect(manifest.byteLength).toBeGreaterThan(0);
    expect(manifest.blockCount).toBeGreaterThan(1);
    expect(await first.getDurabilityReceipt()).toBeNull(); // derived-only migration cannot synthesize a source proof
    expect(rawReads.length).toBeGreaterThan(0);
    first.removeDocument('chunk-1');
    first.addDocument('latest', 'delta replacement', 'latest.md');
    await first.flush();
    const hits = await first.searchTopWithSources('"needle phrase"', 4);
    first.close();

    rawReads.length = 0;
    await next.load();
    expect(next.recoveryMode).toBe('snapshot+delta');
    const timing = next.recoveryTiming;
    expect(timing).toMatchObject({ pages: manifest.blockCount, bytes: manifest.byteLength });
    for (const duration of [timing?.importMs, timing?.sealMs, timing?.deltaMs, timing?.hostDispatchAndDeliveryMs]) {
      expect(duration).toBeGreaterThanOrEqual(0);
    }
    expect(timing?.progressMessages).toBeLessThanOrEqual(manifest.blockCount);
    expect(rawReads).toEqual([]);
    expect(requests.filter((request) => request.operation === 'initialize')).toHaveLength(2);
    expect(await next.searchTopWithSources('"needle phrase"', 4)).toEqual(hits);
    expect((await next.searchTopWithSources('replacement', 5)).map(({ docId }) => docId)).toEqual(['latest']);
    expect((await next.getCheckpoint()).applied).not.toBeNull();

    const pageKey = `posting:${manifest.generation}:0`;
    if (corruption === 'checksum') {
      await next['db'].durability.put({ key, value: { ...manifest, checksum: (manifest.checksum ^ 1) >>> 0 } });
    } else if (corruption === 'tokenizer') {
      await next['db'].durability.put({ key, value: { ...manifest, tokenizerVersion: 1 } });
    } else if (corruption === 'missing block') {
      await next['db'].snapshotBlocks.delete(pageKey);
    } else {
      const bytes = (await next['db'].snapshotBlocks.get(pageKey))?.data;
      if (!(bytes instanceof Uint8Array)) throw new Error('Expected a binary posting page.');
      bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
      await next['db'].snapshotBlocks.put({ key: pageKey, data: bytes });
    }
    next.close();
    await afterCorruption.load();
    expect(afterCorruption.recoveryMode).toBe('full');
    expect(afterCorruption.recoveryTiming).toBeNull();
    expect(rawReads.length).toBeGreaterThan(0);
    expect(await afterCorruption['db'].documents.count()).toBe(count);
    expect((await afterCorruption['db'].durability.get(key))?.value).not.toMatchObject({ generation: manifest.generation });
  } finally {
    spy.mockRestore(); first.close(); next.close(); await afterCorruption.deleteDatabase();
    fixture.restore();
  }
}, 45_000);

it.each(['retired', 'foreign commit', 'quota'] as const)('does not publish a staged checkpoint after %s', async (scenario) => {
  let releasePage: (() => void) | undefined;
  const fixture = await workerFixture((response, send) => {
    if (response.postingPart === 1 && scenario !== 'quota' && !releasePage) releasePage = send;
    else send();
  });
  const name = `bm25-posting-${crypto.randomUUID()}`;
  const owner = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: fixture.factory });
  const foreign = new IndexedDbBM25Index(name);
  const db = owner['db'];
  let alive = true;
  let loading: Promise<void> | undefined;
  try {
    await db.documents.bulkPut(Array.from({ length: 300 }, (_, i) => ({
      id: `chunk-${i}`, sourcePath: 'preserved.md', text: 'alpha beta alpha', updated: 1, order: i + 1,
    })));
    if (scenario === 'foreign commit') await foreign.load();
    const quota = scenario === 'quota' ? vi.spyOn(db.snapshotBlocks, 'put').mockRejectedValueOnce(new DOMException('synthetic quota', 'QuotaExceededError')) : undefined;
    loading = owner.load(undefined, () => alive);
    if (scenario !== 'quota') {
      await vi.waitFor(() => expect(releasePage).toBeDefined());
      expect(await db.durability.get(key)).toBeUndefined();
      expect(await db.snapshotBlocks.count()).toBe(1);
      if (scenario === 'foreign commit') {
        foreign.addDocument('foreign', 'durable other owner', 'foreign.md');
        await foreign.flush();
      } else alive = false;
      releasePage?.();
    }
    await loading;
    quota?.mockRestore();
    expect(owner.hasFailure).toBe(false);
    expect(await db.durability.get(key)).toBeUndefined();
    expect(await db.snapshotBlocks.count()).toBe(0);
    expect(await db.documents.count()).toBe(scenario === 'foreign commit' ? 301 : 300);
  } finally {
    releasePage?.(); await loading?.catch(() => undefined);
    foreign.close(); await owner.deleteDatabase(); fixture.restore();
  }
});

it.runIf(process.env.BM25_POSTING_BENCH === '1')('measures 135,835 synthetic full, migration and warm starts', async () => {
  const fixture = await workerFixture();
  const name = `bm25-posting-bench-${crypto.randomUUID()}`;
  const open = () => new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: fixture.factory });
  const full = open(); const migration = open(); const warm = open();
  const count = 135_835;
  const fragments = [
    'Ａlpha beta. 문서 검색의 관련성과 구문 위치를 검사합니다. RetrievalFixture uses full width ＡＢＣ and mixedCase paths.',
    '바람과 구름, 한글 어절과 English Words를 함께 저장합니다. 雲と風・検索のための段落です。',
    'Markdown source, headings, tags and path fields; 책의 문단과 문장의 순서. Français naïve façade, Ελληνικά.',
    '색인 파생 데이터는 원문 및 메타데이터가 아님. Exact phrase near field prefix semantic discussion.',
  ];
  try {
    for (let start = 0; start < count; start += 512) {
      await full['db'].documents.bulkPut(Array.from({ length: Math.min(512, count - start) }, (_, offset) => {
        const i = start + offset;
        return { id: `fixture-${i.toString().padStart(6, '0')}`, sourcePath: `vault/folder-${i % 17}/source-${Math.floor(i / 10)}.md`,
          text: `${fragments[i % 4]} ${fragments[(i + 1) % 4]}`, title: `Synthetic ${i % 983}`, tags: ['fixture', 'search'], updated: 1, order: i + 1 };
      }));
    }
    const time = async (index: IndexedDbBM25Index, publish = true) => {
      const start = performance.now();
      await index.load(undefined, () => publish);
      return Math.round(performance.now() - start);
    };
    const fullMs = await time(full, false);
    expect(full.recoveryMode).toBe('full');
    const hits = await full.searchTopWithSources('"alpha beta"', 12);
    full.close();
    const migrationMs = await time(migration);
    expect(migration.recoveryMode).toBe('full');
    const manifest = (await migration['db'].durability.get(key))?.value as { byteLength: number; blockCount: number };
    migration.close();
    const warmMs = await time(warm);
    expect(warm.recoveryMode).toBe('snapshot+delta');
    expect(warm.totalDocs).toBe(count);
    expect(await warm.searchTopWithSources('"alpha beta"', 12)).toEqual(hits);
    process.stdout.write(`${JSON.stringify({ count, fullMs, migrationMs, warmMs, bytes: manifest.byteLength, blocks: manifest.blockCount })}\n`);
  } finally {
    full.close(); migration.close(); await warm.deleteDatabase(); fixture.restore();
  }
}, 360_000);
