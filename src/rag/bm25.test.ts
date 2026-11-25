import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbBM25Index, getBM25DocumentFields, tokenize, type BM25DocumentInput } from './bm25';
import { BM25WorkerRuntime } from './bm25-worker-runtime';
import type {
  BM25WorkerAdapter,
  BM25WorkerFactory,
  BM25WorkerHandle,
  BM25WorkerRequest,
  BM25WorkerResponse,
} from './bm25-worker-runtime';
import { RustBm25RuntimeIndex } from './rust-core';
import { TOKENIZER_VERSION } from './tokenizer-version';
import { isStoreMutationReceipt } from './durability';

const dbNames = new Set<string>();
const scriptedPrefixes = new Map<string, { appliedRevision: number; pendingRevision: number | null; nextPart: number }>();

function applyScriptedPrefix(message: BM25WorkerRequest, succeeded = true) {
  const state = scriptedPrefixes.get(message.sessionId) ?? { appliedRevision: 0, pendingRevision: null, nextPart: 0 };
  if (succeeded && message.operation === 'initialize') Object.assign(state, { appliedRevision: 0, pendingRevision: null, nextPart: 0 });
  else if (succeeded && ['add', 'rebuild', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(message.operation)) {
    if (message.revision !== (state.pendingRevision ?? state.appliedRevision + 1) || message.part !== state.nextPart) throw new Error('Synthetic worker prefix mismatch.');
    if (message.finalPart) Object.assign(state, { appliedRevision: message.revision, pendingRevision: null, nextPart: 0 });
    else Object.assign(state, { pendingRevision: message.revision, nextPart: message.part + 1 });
  }
  scriptedPrefixes.set(message.sessionId, state);
  return { sessionId: message.sessionId, ...state };
}

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
  scriptedPrefixes.clear();
});

describe('BM25 문서 필드', () => {
  it('frontmatter 별칭을 문자열과 배열 모두 별칭 필드로 넘긴다', () => {
    const file = { path: 'notes/b-007.md', basename: 'b-007' } as Parameters<
      typeof getBM25DocumentFields
    >[0];

    expect(
      getBM25DocumentFields(file, { frontmatter: { aliases: '보고서 51호' } }, '본문'),
    ).toMatchObject({ aliases: ['보고서 51호'] });
    expect(
      getBM25DocumentFields(
        file,
        { frontmatter: { aliases: ['보고서 51', 51] } },
        '본문',
      ),
    ).toMatchObject({ aliases: ['보고서 51', '51'] });
    expect(getBM25DocumentFields(file, null, '본문')).toMatchObject({ aliases: [] });
  });
});

describe('BM25 tokenizer', () => {
  it('영문 camelCase와 구분자 변형을 같은 키워드로 검색할 수 있게 토큰화한다', () => {
    const tokens = tokenize('OpenRouter freeLLMApi open-router');

    expect(tokens).toEqual(
      expect.arrayContaining(['openrouter', 'open', 'router', 'freellmapi', 'free', 'llm', 'api']),
    );
  });

  it('한글과 숫자가 섞인 Obsidian 제목 키워드는 원문과 n-gram을 함께 보존한다', () => {
    const tokens = tokenize('요고49 포인트 페이백');

    expect(tokens).toEqual(
      expect.arrayContaining(['요고49', '요고', '49', '포인트', '포인', '인트', '페이백']),
    );
  });

  it('macOS 한글 입력의 분해형(NFD)도 조합형(NFC)과 같은 토큰을 만든다', () => {
    const composed = '오린 퀼런의 기록';
    const decomposed = composed.normalize('NFD');

    expect(decomposed).not.toBe(composed);
    expect(tokenize(decomposed)).toEqual(tokenize(composed));
  });

  it('조합형 문서 색인을 분해형 질의로도 찾는다', () => {
    const index = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    if (!index) throw new Error("BM25 런타임을 만들지 못했습니다.");
    index.addDocument("a.md::0", "오린 퀼런의 기록은 오래 남는다", "a.md", TOKENIZER_VERSION);

    const hits = index.searchTop("오린 퀼런의 기록".normalize("NFD"), 1);

    expect(hits?.length ?? 0).toBe(1);
  });
});

describe('IndexedDbBM25Index', () => {
  it('snapshot 없는 worker 복원은 실제 원 DB.count를 expectedDocs에 전달한다', async () => {
    const name = createDbName();
    const seed = new IndexedDbBM25Index(name);
    await seed.load();
    seed.addDocument('synthetic-a', 'alpha', 'a.md');
    seed.addDocument('synthetic-b', 'beta', 'b.md');
    await seed.flush(); seed.close();
    const worker = createScriptedWorker('');
    const reopened = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: worker.factory });
    const progress = vi.fn();
    try {
      await reopened.load(progress);
      expect(worker.requests.find((request) => request.operation === 'initialize')).toMatchObject({ expectedDocs: 2, snapshot: '' });
      expect(progress).toHaveBeenCalledWith({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 0, totalUnits: 2 });
    } finally { reopened.close(); }
  });

  it('BM25 receipt는 읽기/빈 load로 인증하지 않으며 명시 초기화·재열기·재생성을 구분한다', async () => {
    const name = createDbName();
    const index = new IndexedDbBM25Index(name);
    await index.load();
    expect(await index.getDurabilityReceipt()).toBeNull();
    await index.flush();
    expect(await index.getDurabilityReceipt()).toBeNull();
    const first = await index.initializeEmptyDurabilityReceipt();
    expect(isStoreMutationReceipt(first)).toBe(true);
    expect(await index.initializeEmptyDurabilityReceipt()).toEqual(first);
    index.close();
    const reopened = new IndexedDbBM25Index(name);
    await reopened.load();
    expect(await reopened.getDurabilityReceipt()).toEqual(first);
    reopened.close();
    await Dexie.delete(name);
    const recreated = new IndexedDbBM25Index(name);
    await recreated.load();
    const next = await recreated.initializeEmptyDurabilityReceipt();
    expect(isStoreMutationReceipt(next)).toBe(true);
    expect(next?.incarnation).not.toBe(first?.incarnation);
    recreated.close();
  });

  it('BM25 v3 원문은 migration과 load만으로 receipt를 만들거나 지우지 않는다', async () => {
    const name = createDbName();
    const legacy = new Dexie(name);
    legacy.version(3).stores({ meta: 'key', documents: 'id, sourcePath, updated, order', mutations: 'id, kind, target, updated, order', removals: 'order, target', snapshotBlocks: 'key' });
    await legacy.table('documents').put({ id: 'a', text: 'synthetic legacy', sourcePath: 'a.md', updated: 1, order: 7 });
    legacy.close();
    const index = new IndexedDbBM25Index(name);
    await index.load();
    expect(await index.getDurabilityReceipt()).toBeNull();
    expect(await index.initializeEmptyDurabilityReceipt()).toBeNull();
    expect([...index.search('synthetic').keys()]).toEqual(['a']);
    expect((await index.getCorpusDocumentsByIds(['a']))[0]?.text).toBe('synthetic legacy');
    expect(await index.getDurabilityReceipt()).toBeNull();
    index.close();
  });

  it('BM25 저장 순서는 다른 connection과 역행한 clock에서도 DB-local로 증가한다', async () => {
    const name = createDbName();
    const a = new IndexedDbBM25Index(name);
    await a.load();
    a.addDocument('a', 'alpha', 'a.md');
    await a.flush();
    const b = new IndexedDbBM25Index(name);
    await b.load();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      b.addDocument('b', 'beta', 'b.md');
      await b.flush();
      a.addDocument('c', 'gamma', 'c.md');
      await a.flush();
      const records = await a['db'].documents.bulkGet(['a', 'b', 'c']);
      expect(records[1]?.order).toBeGreaterThan(records[0]?.order ?? 0);
      expect(records[2]?.order).toBeGreaterThan(records[1]?.order ?? 0);
      expect((await a['db'].durability.get('bm25-order-v1'))?.value).toBe(records[2]?.order);
    } finally { clock.mockRestore(); a.close(); b.close(); }
  });

  it('BM25 같은 count 본문·metadata·삭제의 실제 commit은 다른 mutation을 남긴다', async () => {
    const index = new IndexedDbBM25Index(createDbName());
    await index.load();
    index.addDocument('a', 'alpha', 'a.md');
    await index.flush();
    let previous = await index.getDurabilityReceipt();
    expect(isStoreMutationReceipt(previous)).toBe(true);
    for (const mutate of [
      async () => { index.addDocument('a', 'beta', 'a.md'); await index.flush(); },
      async () => { expect(await index.refreshSourceRevision('a.md', { sourceMtime: 2, sourceSize: 4, contentHash: 'synthetic' })).toBe(1); },
      async () => { index.removeDocument('a'); await index.flush(); },
      () => index.clear(),
    ]) {
      await mutate();
      const current = await index.getDurabilityReceipt();
      expect(isStoreMutationReceipt(current)).toBe(true);
      expect(current?.incarnation).toBe(previous?.incarnation);
      expect(current?.mutation).not.toBe(previous?.mutation);
      previous = current;
    }
    index.close();
  });

  it('BM25 receipt 기록 실패는 본문과 DB-local order를 함께 rollback한다', async () => {
    const index = new IndexedDbBM25Index(createDbName());
    await index.load();
    index.addDocument('a', 'alpha', 'a.md');
    await index.flush();
    const before = await index.getDurabilityReceipt();
    const db = index['db'];
    const order = await db.durability.get('bm25-order-v1');
    vi.spyOn(db.durability, 'put').mockRejectedValueOnce(new Error('Synthetic BM25 receipt failure.'));
    index.addDocument('b', 'beta', 'b.md');
    await expect(index.flush()).rejects.toThrow('Synthetic BM25 receipt failure.');
    expect(await index.getDurabilityReceipt()).toEqual(before);
    expect(await db.durability.get('bm25-order-v1')).toEqual(order);
    expect(await db.documents.count()).toBe(1);
    await index.flush();
    expect(await db.documents.count()).toBe(2);
    expect((await index.getDurabilityReceipt())?.mutation).not.toBe(before?.mutation);
    index.close();
  });

  it('BM25 metadata revision의 noop는 head를 바꾸지 않는다', async () => {
    const index = new IndexedDbBM25Index(createDbName());
    await index.load();
    index.addCorpusDocument({ id: 'a', text: 'alpha', sourcePath: 'a.md', sourceMtime: 1, sourceSize: 5, contentHash: 'synthetic' });
    await index.flush();
    const before = await index.getDurabilityReceipt();
    expect(await index.refreshSourceRevision('a.md', { sourceMtime: 1, sourceSize: 5, contentHash: 'synthetic' })).toBe(0);
    expect(await index.getDurabilityReceipt()).toEqual(before);
    index.close();
  });

  it('BM25 checkpoint는 동일 session의 저장·적용 revision이 같을 때만 proof를 준다', async () => {
    const index = new IndexedDbBM25Index(createDbName());
    await index.load();
    expect((await index.getCheckpoint()).applied).toBeNull();
    const initial = await index.initializeEmptyDurabilityReceipt();
    expect((await index.getCheckpoint()).applied).toMatchObject({ receipt: initial, revision: 0 });
    index.addDocument('a', 'alpha', 'a.md');
    const pending = await index.getCheckpoint();
    expect(pending.pendingOperations).toBe(1);
    expect(pending.applied).toBeNull();
    await index.flush();
    const committed = await index.getCheckpoint();
    expect(committed.applied).toMatchObject({ receipt: committed.receipt, revision: 1 });
    expect(committed.applied?.sessionId).toMatch(/^[0-9a-f-]{36}$/u);
    const receipt = committed.receipt;
    await index.getCheckpoint();
    expect(await index.getDurabilityReceipt()).toEqual(receipt);
    index.close();
  });

  it('BM25 빈 초기화 호출로 다른 owner의 기존 head를 자기 빈 runtime에 바인딩하지 않는다', async () => {
    const name = createDbName();
    const a = new IndexedDbBM25Index(name);
    const b = new IndexedDbBM25Index(name);
    await a.load(); await b.load();
    b.addDocument('foreign', 'synthetic foreign', 'foreign.md');
    await b.flush();
    expect(await a.initializeEmptyDurabilityReceipt()).toEqual(await b.getDurabilityReceipt());
    expect(a.totalDocs).toBe(0);
    expect((await a.getCheckpoint()).applied).toBeNull();
    a.close(); b.close();
  });

  it('BM25 다른 owner의 변경 뒤 자기 delta만 적용해 전체 DB를 인증하지 않는다', async () => {
    const name = createDbName();
    const a = new IndexedDbBM25Index(name);
    await a.load();
    await a.initializeEmptyDurabilityReceipt();
    a.addDocument('a', 'alpha', 'a.md');
    await a.flush();
    expect((await a.getCheckpoint()).applied).not.toBeNull();
    const b = new IndexedDbBM25Index(name);
    await b.load();
    expect((await b.getCheckpoint()).applied).not.toBeNull();
    b.addDocument('b', 'beta', 'b.md');
    await b.flush();
    expect((await a.getCheckpoint()).applied).toBeNull();
    a.addDocument('c', 'gamma', 'c.md');
    await a.flush();
    expect((await a.getCheckpoint()).applied).toBeNull();
    await a.rebuild([{ id: 'complete', text: 'synthetic replacement', sourcePath: 'complete.md' }]);
    expect((await a.getCheckpoint()).applied).not.toBeNull();
    a.close(); b.close();
  });

  it('BM25 NoWorker hydration 중 새 변경을 잃거나 hydration 이전 ACK로 인증하지 않는다', async () => {
    const name = createDbName();
    const original = new IndexedDbBM25Index(name);
    await original.load();
    original.addDocument('a', 'alpha', 'a.md');
    await original.flush();
    original.close();
    const index = new IndexedDbBM25Index(name);
    const loadSnapshot = index['loadSnapshot'].bind(index);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    index['loadSnapshot'] = async () => { entered(); await gate; return loadSnapshot(); };
    const loading = index.load();
    const observed = loading.catch((error: unknown) => error);
    try {
      await started;
      index.addDocument('b', 'beta', 'b.md');
      expect((await index.getCheckpoint()).applied).toBeNull();
      release();
      await loading;
      await index.flush();
      expect([...index.search('alpha').keys()]).toEqual(['a']);
      expect([...index.search('beta').keys()]).toEqual(['b']);
      expect(await index.getCorpusDocumentsByIds(['a', 'b'])).toHaveLength(2);
      expect((await index.getCheckpoint()).applied).not.toBeNull();
    } finally { release(); await observed; index.close(); }
  });

  it.each(['worker', 'NoWorker'] as const)('BM25 %s hydration 중 다른 DB commit은 적용 proof를 만들지 않는다', async (mode) => {
    const name = createDbName();
    const seed = new IndexedDbBM25Index(name);
    await seed.load(); seed.addDocument('a', 'alpha', 'a.md'); await seed.flush(); seed.close();
    const a = new IndexedDbBM25Index(name, undefined, undefined, mode === 'worker' ? { workerFactory: createScriptedWorker('').factory } : {});
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sweep = a['sweepOrphanSnapshotBlocks'].bind(a);
    a['sweepOrphanSnapshotBlocks'] = async () => { await sweep(); entered(); await gate; };
    const loading = a.load();
    const observed = loading.catch((error: unknown) => error);
    const b = new IndexedDbBM25Index(name);
    try {
      await started;
      await b.load(); b.addDocument('b', 'beta', 'b.md'); await b.flush();
      release(); await loading;
      expect((await a.getCheckpoint()).applied).toBeNull();
      a.addDocument('c', 'gamma', 'c.md'); await a.flush();
      expect((await a.getCheckpoint()).applied).toBeNull();
    } finally { release(); await observed; a.close(); b.close(); }
  });

  it.each(['worker', 'NoWorker'] as const)('BM25 %s의 늦은 이전 load 실패는 새 session을 덮지 않는다', async (mode) => {
    const name = createDbName();
    const seed = new IndexedDbBM25Index(name);
    await seed.load();
    seed.addDocument('synthetic', 'synthetic ready input', 'synthetic.md');
    await seed.flush();
    seed.close();
    const index = new IndexedDbBM25Index(name, undefined, undefined, mode === 'worker' ? { workerFactory: createScriptedWorker('').factory } : {});
    const sweep = index['sweepOrphanSnapshotBlocks'].bind(index);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    index['sweepOrphanSnapshotBlocks'] = async () => { if (first) { first = false; entered(); await gate; } else await sweep(); };
    const loading = index.load();
    const observed = loading.catch((error: unknown) => error);
    try {
      await started;
      await index.load();
      expect(index.isReady).toBe(true);
      release();
      await expect(loading).rejects.toThrow('rag-bm25-session-retired');
      expect(index.isReady).toBe(true);
    } finally { release(); await observed; index.close(); }
  });

  it.each(['rebuild', 'replace-source'] as const)('BM25 %s의 저장 완료는 마지막 실제 ACK 전 적용 proof가 아니다', async (mode) => {
    const name = createDbName();
    const sent: BM25WorkerRequest[] = [];
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    const index = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: () => ({ worker: {
      postMessage: (message) => {
        sent.push(message);
        if (message.operation === 'initialize') queueMicrotask(() => respond?.({ data: { id: message.id, ...applyScriptedPrefix(message), ready: true, tokenizerCurrent: true, totalDocs: 0 } } as MessageEvent<BM25WorkerResponse>));
      }, terminate: vi.fn(), setOnMessage: (handler) => { respond = handler; }, setOnError: vi.fn(),
    }, dispose: vi.fn() }) });
    await index.load();
    await index.initializeEmptyDurabilityReceipt();
    const documents = Array.from({ length: mode === 'rebuild' ? 1 : 129 }, (_, i) => ({ id: `a::${i}`, text: `synthetic ${i}`, sourcePath: 'a.md' }));
    let operation: Promise<void>;
    if (mode === 'rebuild') operation = index.rebuild(documents);
    else { index.replaceSourceDocuments('a.md', documents); operation = index.flush(); }
    const observed = operation.catch((error: unknown) => error);
    try {
      await vi.waitFor(async () => { expect(sent).toHaveLength(2); expect(await index['db'].documents.count()).toBe(documents.length); });
      expect((await index.getCheckpoint()).applied).toBeNull();
      if (mode === 'replace-source') {
        const first = sent[1];
        respond?.({ data: { id: first.id, ...applyScriptedPrefix(first), ready: true, tokenizerCurrent: true, totalDocs: 128 } } as MessageEvent<BM25WorkerResponse>);
        await vi.waitFor(() => expect(sent).toHaveLength(3));
        expect(index['workerRuntime']?.appliedRevision).toBe(0);
        expect(index['workerRuntime']?.pendingRevision).toBe(1);
        expect((await index.getCheckpoint()).applied).toBeNull();
      }
      const last = sent.at(-1);
      if (!last) throw new Error('Synthetic final request missing.');
      respond?.({ data: { id: last.id, ...applyScriptedPrefix(last), ready: true, tokenizerCurrent: true, totalDocs: documents.length } } as MessageEvent<BM25WorkerResponse>);
      await operation;
      const checkpoint = await index.getCheckpoint();
      expect(checkpoint.applied).toMatchObject({ receipt: checkpoint.receipt, revision: 1 });
    } finally { index.close(); await observed; }
  });

  it('외부 배치의 flush는 hydration ready와 달리 내구 커밋 뒤 worker ACK까지 기다린다', async () => {
    const name = createDbName();
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    const sent: BM25WorkerRequest[] = [];
    const index = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: () => ({ worker: {
      postMessage: (message) => { sent.push(message); if (message.operation === 'initialize') queueMicrotask(() => respond?.({ data: { id: message.id, ...applyScriptedPrefix(message), ready: true, tokenizerCurrent: true, totalDocs: 0 } } as MessageEvent<BM25WorkerResponse>)); },
      terminate: vi.fn(), setOnMessage: (handler) => { respond = handler; }, setOnError: vi.fn(),
    }, dispose: vi.fn() }) });
    await index.load();
    try {
      await index.withBatch(async () => {
        index.replaceSourceDocuments('a.md', [{ id: 'a', text: 'alpha', sourcePath: 'a.md' }]);
        let settled = false;
        const flushing = index.flush().then(() => { settled = true; });
        await vi.waitFor(() => expect(sent).toHaveLength(2));
        const persisted = new Dexie(name);
        await persisted.open();
        try { await vi.waitFor(async () => expect(await persisted.table('documents').count()).toBe(1)); }
        finally { persisted.close(); }
        expect(index.isReady).toBe(true);
        expect(settled).toBe(false);
        respond?.({ data: { id: sent[1].id, ...applyScriptedPrefix(sent[1]), ready: true, tokenizerCurrent: true, totalDocs: 1 } } as MessageEvent<BM25WorkerResponse>);
        await flushing;
        expect(settled).toBe(true);
      });
    } finally { index.close(); }
  });

  it('외부 배치 안의 flush는 실제 내구 checkpoint를 만들고 다음 변경도 잃지 않는다', async () => {
    const name = createDbName();
    const index = new IndexedDbBM25Index(name);
    await index.load();
    try {
      await index.withBatch(async () => {
        index.addDocument('a', 'alpha', 'a.md');
        await index.persist();
        expect(await index.getCorpusDocumentsByIds(['a'])).toEqual([]);
        await index.flush();
        expect(await index.getCorpusDocumentsByIds(['a'])).toHaveLength(1);
        index.addDocument('b', 'beta', 'b.md');
        await Promise.all([index.flush(), index.flush()]);
        expect(await index.getCorpusDocumentsByIds(['a', 'b'])).toHaveLength(2);
      });
      index.replaceSourceDocuments('a.md', [{ id: 'c', text: 'gamma', sourcePath: 'a.md' }]);
      await index.flush();
      expect([...index.search('alpha').keys()]).toEqual([]);
      expect([...index.search('gamma').keys()]).toEqual(['c']);
    } finally {
      index.close();
    }
    const restored = new IndexedDbBM25Index(name);
    try {
      await restored.load();
      expect([...restored.search('beta').keys()]).toEqual(['b']);
      expect([...restored.search('gamma').keys()]).toEqual(['c']);
    } finally { restored.close(); }
  });

  it('실패한 외부 배치는 자동 저장하지 않고 원래 오류와 다음 checkpoint의 원장을 보존한다', async () => {
    const name = createDbName();
    const index = new IndexedDbBM25Index(name);
    await index.load();
    try {
      await expect(index.withBatch(async () => {
        index.addDocument('a', 'alpha');
        await index.persist();
        throw new Error('original-error');
      })).rejects.toThrow('original-error');
      const persisted = new Dexie(name);
      await persisted.open();
      try { expect(await persisted.table('documents').count()).toBe(0); }
      finally { persisted.close(); }
      await index.flush();
      expect(await index.getCorpusDocumentsByIds(['a'])).toHaveLength(1);
    } finally { index.close(); }
  });

  it('위치 없는 snapshot과 저장 원문이 있으면 비 worker 시작도 원문에서 자동 복구한다', async () => {
    const dbName = createDbName();
    const index = new IndexedDbBM25Index(dbName);
    await index.load();
    index.addCorpusDocument({
      id: 'raw',
      text: 'alpha beta',
      sourcePath: 'ledger.md',
      title: 'Quarterly',
    });
    await index.persist();
    index.close();
    const legacy = {
      tokenizerVersion: 2,
      inverted: { wrong: { stale: 1 } },
      docLengths: { stale: 1 },
      docSources: { stale: 'stale.md' },
      totalDocs: 1,
      avgDocLength: 1,
    };
    const db = new Dexie(dbName);
    await db.open();
    await db
      .table('meta')
      .put({ key: 'bm25-runtime-snapshot:v1', value: JSON.stringify(legacy), updated: Date.now() });
    db.close();
    const restored = new IndexedDbBM25Index(dbName);
    try {
      await restored.load();
      expect(restored.isTokenizerCurrent).toBe(true);
      expect([...restored.search('wrong').keys()]).toEqual([]);
      expect([...restored.search('"alpha beta"').keys()]).toEqual(['raw']);
      expect([...restored.search('title:quarterly').keys()]).toEqual(['raw']);
      expect([...restored.search('path:ledger').keys()]).toEqual(['raw']);
    } finally {
      restored.close();
    }
  });
  it('필드는 저장·재시작 후에도 유지하고 경로 필드는 항상 원본 경로를 사용한다', async () => {
    const dbName = createDbName();
    const index = new IndexedDbBM25Index(dbName);
    await index.load();
    const document = {
      id: 'fielded',
      text: 'alpha beta gamma',
      sourcePath: 'reports/ledger.md',
      title: 'Quarterly Ledger',
      headings: ['Deployment Guide'],
      tags: ['finance'],
    };
    index.addCorpusDocument(document);
    await index.persist();
    expect(await index.getCorpusDocumentsByIds(['fielded'])).toEqual([
      expect.objectContaining(document),
    ]);
    index.close();
    const restored = new IndexedDbBM25Index(dbName);
    try {
      await restored.load();
      expect(await restored.getCorpusDocumentsByIds(['fielded'])).toEqual([
        expect.objectContaining(document),
      ]);
      for (const query of [
        'title:quarterly',
        'heading:deployment',
        'tag:finance',
        'path:ledger',
        '"alpha beta"',
        '"alpha gamma"~1',
        'alph*',
        'alphx',
      ]) {
        expect([...restored.search(query).keys()], query).toEqual(['fielded']);
      }
    } finally {
      restored.close();
    }
  });
  it('sourcePath가 없는 문서는 런타임 path 필드로 id를 사용한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('standalone::0', 'alpha 베타');

      expect([...bm25.search('path:standalone').keys()]).toEqual(['standalone::0']);
      expect([...bm25.search('alpha').keys()]).toEqual(['standalone::0']);
    } finally {
      bm25.close();
    }
  });
  it('일치 집계는 정확 term·구문만 세고 오타·prefix 확장으로 수치를 부풀리지 않는다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('alpha.md::0', 'alpha beta alpha synthetic', 'alpha.md');
      bm25.addDocument('beta.md::0', 'alpha alpha alpha', 'beta.md');

      expect(await bm25.aggregateMatches('alpha', 10)).toEqual({
        totalDocuments: 2,
        totalChunks: 2,
        totalOccurrences: 5,
        documents: [
          {
            sourcePath: 'beta.md',
            occurrences: 3,
            chunks: [{ docId: 'beta.md::0', occurrences: 3 }],
          },
          {
            sourcePath: 'alpha.md',
            occurrences: 2,
            chunks: [{ docId: 'alpha.md::0', occurrences: 2 }],
          },
        ],
      });
      expect((await bm25.aggregateMatches('"alpha beta"', 10))?.totalOccurrences).toBe(1);
      expect((await bm25.aggregateMatches('alphx', 10))?.totalOccurrences).toBe(0);
      expect((await bm25.aggregateMatches('alph*', 10))?.totalOccurrences).toBe(0);
    } finally {
      bm25.close();
    }
  });
  it('여러 facet 검색·집계를 한 batch 호출에서 같은 값으로 돌려준다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('a::0', 'alpha beta alpha', 'a.md');
      bm25.addDocument('a::1', 'alpha gamma', 'a.md');
      bm25.addDocument('b::0', 'alpha alpha alpha', 'b.md');

      const batch = await bm25.batchSearchAndAggregate(
        [
          { query: 'alpha', limit: 10 },
          { query: 'gamma', limit: 1 },
        ],
        [
          { query: 'alpha', limit: 10 },
          { query: 'gamma', limit: 10 },
        ],
      );

      expect(batch?.queries).toHaveLength(2);
      expect(batch?.queries[0]?.hits.map((hit) => hit.sourcePath)).toEqual(['b.md', 'a.md']);
      expect(batch?.queries[0]?.hits.map((hit) => hit.rank)).toEqual([1, 2]);
      expect(batch?.queries[1]?.hits.map((hit) => hit.sourcePath)).toEqual(['a.md']);
      expect(batch?.aggregates[0]).toMatchObject({
        totalDocuments: 2,
        totalChunks: 3,
        totalOccurrences: 6,
      });
      expect(batch?.aggregates[1]).toMatchObject({
        totalDocuments: 1,
        totalOccurrences: 1,
      });

      const scoped = await bm25.batchSearchAndAggregate(
        [],
        [{ query: 'alpha', limit: 10 }],
        ['b.md'],
      );
      expect(scoped?.aggregates[0]).toMatchObject({
        totalDocuments: 1,
        totalOccurrences: 3,
      });
    } finally {
      bm25.close();
    }
  });

  it('허용 경로는 목록 상한을 적용하기 전에 집계 전체에 적용한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('a::0', 'alpha alpha', 'allowed/a.md');
      bm25.addDocument('a::1', 'alpha', 'allowed/a.md');
      bm25.addDocument('b::0', 'alpha', 'allowed/b.md');
      bm25.addDocument('hidden::0', 'alpha '.repeat(30), 'outside/hidden.md');
      const result = await bm25.aggregateMatches('alpha', 1, undefined, ['allowed/a.md', 'allowed/b.md']);
      expect(result).toMatchObject({ totalDocuments: 2, totalChunks: 3, totalOccurrences: 4 });
      expect(result?.documents.map((item) => item.sourcePath)).toEqual(['allowed/a.md']);
      expect(await bm25.aggregateMatches('alpha', 1, undefined, [])).toMatchObject({ totalDocuments: 0 });
    } finally {
      bm25.close();
    }
  });
  it('집계는 원래 단어만 세고 후보 검색은 부분 토큰을 계속 발견한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      for (const [index, [query, distractor]] of ([
        ['은하수', '은하 하수'],
        ['星空帳', '星空 空帳'],
        ['LunarAtlas', 'lunar atlas'],
      ] as const).entries()) {
        const matchId = `match-${index}::0`;
        const partialId = `partial-${index}::0`;
        bm25.addDocument(matchId, `${query} ${query}`, `match-${index}.md`);
        bm25.addDocument(partialId, distractor, `partial-${index}.md`);

        expect((await bm25.aggregateMatches(query, 10))?.totalDocuments).toBe(1);
        expect((await bm25.aggregateMatches(query, 10))?.totalOccurrences).toBe(2);
        expect([...bm25.search(query).keys()]).toEqual(expect.arrayContaining([matchId, partialId]));
      }
    } finally {
      bm25.close();
    }
  });
  it('현행 WASM 런타임에서 문서 교체와 원문별 삭제 후 검색·저장을 보존한다', () => {
    const runtime = RustBm25RuntimeIndex.empty(2);
    if (!runtime) throw new Error('WASM 초기화 실패');
    try {
      runtime.addDocument('api.md::0', 'OpenRouter API access key', 'api.md', 2);
      runtime.addDocument('other.md::0', 'Ollama local model', 'other.md', 2);
      expect(runtime.search('open router')?.map((hit) => hit.docId)).toEqual(['api.md::0']);
      runtime.addDocument('api.md::0', 'Ollama remote endpoint', 'api.md', 2);
      expect(runtime.search('open router')).toEqual([]);
      expect(runtime.search('ollama')?.map((hit) => hit.docId)).toEqual([
        'api.md::0',
        'other.md::0',
      ]);
      runtime.removeSource('api.md', 2);
      expect(runtime.search('endpoint')).toEqual([]);
      expect(runtime.sourcePathForDoc('other.md::0')).toBe('other.md');
      const restored = RustBm25RuntimeIndex.fromJson(runtime.toJson(), 2);
      if (!restored) throw new Error('WASM 복원 실패');
      try {
        expect(restored.search('ollama')?.map((hit) => hit.docId)).toEqual(['other.md::0']);
        restored.removeDocument('other.md::0', 2);
        expect(restored.totalDocs()).toBe(0);
        expect(restored.search('ollama')).toEqual([]);
      } finally {
        restored.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('반복된 질의 토큰으로 같은 문서 점수를 중복 가산하지 않는다', async () => {
    const bm25 = await createBm25([
      ['doc.md::0', 'specialterm 직접 근거'],
      ['other.md::0', '다른 내용'],
    ]);

    expect(bm25.search('specialterm specialterm').get('doc.md::0')).toBe(
      bm25.search('specialterm').get('doc.md::0'),
    );
  });

  it('OpenRouter 문서는 open router처럼 띄어 쓴 질의로도 검색된다', async () => {
    const bm25 = await createBm25([
      ['api.md::0', 'OpenRouter API access key'],
      ['other.md::0', 'Ollama local model'],
    ]);

    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('구버전 BM25 JSON은 토큰화 버전 불일치로 감지하고 재빌드할 수 있다', async () => {
    const adapter = createAdapter(
      JSON.stringify({
        inverted: { openrouter: { 'api.md::0': 1 } },
        docLengths: { 'api.md::0': 1 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 1,
      }),
    );
    const bm25 = new IndexedDbBM25Index(createDbName(), adapter);

    await bm25.load();

    expect(bm25.isTokenizerCurrent).toBe(false);
    expect([...bm25.search('open router').keys()]).toEqual([]);

    await bm25.rebuild([
      {
        id: 'api.md::0',
        text: 'OpenRouter API access key',
        sourcePath: 'api.md',
      },
    ]);

    expect(bm25.isTokenizerCurrent).toBe(true);
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('legacy BM25 JSON을 읽은 뒤 저장할 때 IndexedDB snapshot으로 마이그레이션한다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);

    bm25.addDocument('new.md::0', 'Retrieval open router evidence', 'new.md');
    await bm25.persist();

    expect(inspectable.writeCount()).toBe(0);
    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();
  });

  it('legacy BM25 JSON은 load 직후 IndexedDB snapshot으로 남겨 다음 초기화에서 다시 읽지 않는다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect(inspectable.readCount()).toBe(1);

    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();

    expect(inspectable.readCount()).toBe(1);
    expect([...reopened.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('증분 persist는 전체 runtime JSON 직렬화를 호출하지 않고 재시작 후 검색을 유지한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    const toJsonSpy = vi.spyOn(RustBm25RuntimeIndex.prototype, 'toJson');
    try {
      bm25.addDocument('doc.md::0', 'specialterm 직접 근거', 'doc.md');
      await bm25.persist();

      expect(toJsonSpy).not.toHaveBeenCalled();
    } finally {
      toJsonSpy.mockRestore();
    }

    const reopened = new IndexedDbBM25Index(dbName, createAdapter());
    await reopened.load();
    expect([...reopened.search('specialterm').keys()]).toEqual(['doc.md::0']);
  });

  it('큰 legacy BM25 JSON은 시작 경로에서 읽지 않고 빈 runtime으로 시작한다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: { giant: { 'large.md::0': 1 } },
        docLengths: { 'large.md::0': 1 },
        docSources: { 'large.md::0': 'large.md' },
        totalDocs: 1,
        avgDocLength: 1,
      }),
    );
    const bm25 = new IndexedDbBM25Index(
      createDbName(),
      inspectable.adapter,
      '.superpower-inside/bm25-index.json',
      { maxSnapshotBytes: 4 },
    );

    await bm25.load();

    expect(inspectable.readCount()).toBe(0);
    expect(bm25.totalDocs).toBe(0);
    expect(bm25.isTokenizerCurrent).toBe(true);
  });

  it('큰 IndexedDB BM25 snapshot은 시작 경로에서 WASM runtime으로 파싱하지 않는다', async () => {
    const dbName = createDbName();
    await seedBm25Snapshot(dbName, '{"schemaVersion":3,"tokenizerVersion":2,"docs":["large"]}');
    const bm25 = new IndexedDbBM25Index(
      dbName,
      createAdapter(),
      '.superpower-inside/bm25-index.json',
      {
        maxSnapshotBytes: 4,
      },
    );

    await bm25.load();

    expect(bm25.totalDocs).toBe(0);
    expect(bm25.isTokenizerCurrent).toBe(true);
  });

  it('종료된 작업자는 한 번만 복원하고 저장된 원문 코퍼스를 보존한다', async () => {
    let created = 0;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => {
      created++;
      let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
      return {
        worker: {
          postMessage: (message) =>
            queueMicrotask(() =>
              respond?.({
                data: { id: message.id, ...applyScriptedPrefix(message), ready: true, tokenizerCurrent: true, totalDocs: 1 },
              } as MessageEvent<BM25WorkerResponse>),
            ),
          terminate: vi.fn(),
          setOnMessage: (handler) => {
            respond = handler;
          },
          setOnError: (handler) => {
            fail = handler;
          },
        },
        dispose: vi.fn(),
      };
    };
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    await bm25.load();
    bm25.addDocument('doc::0', '원문은 보존됩니다.', 'doc.md');
    await bm25.persist();
    await Promise.resolve();
    fail?.({ message: 'worker failed' } as ErrorEvent);
    expect(bm25.isReady).toBe(false);
    await Promise.all([bm25.recoverClosedWorker(), bm25.recoverClosedWorker()]);
    expect(created).toBe(2);
    expect(bm25.isReady).toBe(true);
    expect(await bm25.getCorpusDocumentsByIds(['doc::0'])).toEqual([
      expect.objectContaining({ text: '원문은 보존됩니다.' }),
    ]);
    bm25.close();
  });

  it('작업자 재초기화가 한 번 실패해도 다음 준비에서 저장된 자료로 다시 복구한다', async () => {
    let created = 0;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => {
      const attempt = ++created;
      let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
      return {
        worker: {
          postMessage: (message) =>
            queueMicrotask(() =>
              respond?.({
                data:
                  attempt === 2
                    ? { id: message.id, ...applyScriptedPrefix(message, false), error: '합성 재초기화 실패' }
                    : { id: message.id, ...applyScriptedPrefix(message), ready: true, tokenizerCurrent: true, totalDocs: 1 },
              } as MessageEvent<BM25WorkerResponse>),
            ),
          terminate: vi.fn(),
          setOnMessage: (handler) => {
            respond = handler;
          },
          setOnError: (handler) => {
            fail = handler;
          },
        },
        dispose: vi.fn(),
      };
    };
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      bm25.addDocument('synthetic::0', '합성 원문 보존', 'synthetic.md');
      await bm25.persist();
      await Promise.resolve();
      fail?.({ message: '합성 작업자 종료' } as ErrorEvent);
      await expect(bm25.recoverClosedWorker()).rejects.toThrow('합성 재초기화 실패');
      await Promise.all([bm25.recoverClosedWorker(), bm25.recoverClosedWorker()]);
      expect(created).toBe(3);
      expect(bm25.isReady).toBe(true);
      expect(await bm25.getCorpusDocumentsByIds(['synthetic::0'])).toEqual([
        expect.objectContaining({ text: '합성 원문 보존' }),
      ]);
    } finally {
      bm25.close();
    }
  });

  it('작업자가 종료되면 이번 세션 색인을 쓸 수 없는 상태로 보고한다', async () => {
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory = (): BM25WorkerHandle => ({
      worker: {
        postMessage: (message: BM25WorkerRequest) => {
          window.setTimeout(
            () =>
              respond?.(
                {
                  data: {
                    id: message.id,
                    ...applyScriptedPrefix(message),
                    ready: true,
                    tokenizerCurrent: true,
                    totalDocs: 1,
                  },
                } as MessageEvent<BM25WorkerResponse>,
              ),
            0,
          );
        },
        terminate: vi.fn(),
        setOnMessage: (handler: (event: MessageEvent<BM25WorkerResponse>) => void) => {
          respond = handler;
        },
        setOnError: (handler: (event: ErrorEvent) => void) => {
          fail = handler;
        },
      },
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      expect(bm25.hasFailure).toBe(false);
      fail?.({ message: '합성 작업자 종료' } as ErrorEvent);
      expect(bm25.hasFailure).toBe(true);
    } finally {
      bm25.close();
    }
  });

  it('증분 작업 대기 중 취소한 검색을 worker에 뒤늦게 보내지 않는다', async () => {
    const operations: string[] = [];
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => ({
      worker: {
        postMessage: (message) => {
          operations.push(message.operation);
          if (message.operation === 'add') return;
          queueMicrotask(() =>
            respond?.({
              data: {
                id: message.id,
                ...applyScriptedPrefix(message),
                ready: true,
                tokenizerCurrent: true,
                totalDocs: 0,
              },
            } as unknown as MessageEvent<BM25WorkerResponse>),
          );
        },
        terminate: vi.fn(),
        setOnMessage: (handler) => {
          respond = handler;
        },
        setOnError: vi.fn(),
      },
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      bm25.addDocument('synthetic::0', 'synthetic pending mutation', 'synthetic.md');
      await vi.waitFor(() => expect(operations).toContain('add'));
      const controller = new AbortController();
      let outcome = 'pending';
      const execution = bm25.searchTopWithSources('synthetic', 1, controller.signal).then(
        () => {
          outcome = 'resolved';
        },
        (error: unknown) => {
          outcome = error instanceof DOMException ? error.name : 'other-error';
        },
      );
      controller.abort();
      await vi.waitFor(() => expect(outcome).toBe('AbortError'), { timeout: 100 });
      await execution;
      expect(operations).not.toContain('search-top');
    } finally {
      bm25.close();
    }
  });

  it('worker hydration 중에도 검색을 막지 않고 증분 변경은 순서대로 적용한다', async () => {
    const operations: string[] = [];
    const workerControl: {
      initializeRequestId?: number;
      initializeRequest?: BM25WorkerRequest;
      onMessage?: (event: MessageEvent<BM25WorkerResponse>) => void;
    } = {};
    const workerFactory: BM25WorkerFactory = () => ({
      worker: {
        postMessage: (message) => {
          operations.push(message.operation);
          if (message.operation === 'initialize') {
            workerControl.initializeRequestId = message.id;
            workerControl.initializeRequest = message;
            return;
          }
          queueMicrotask(() => {
            workerControl.onMessage?.({
              data: {
                id: message.id,
                ...applyScriptedPrefix(message),
                ready: true,
                tokenizerCurrent: true,
                totalDocs: 2,
                ...(message.operation === 'search-top'
                  ? {
                      hits: [
                        {
                          docId: 'new.md::0',
                          sourcePath: 'new.md',
                          score: 1,
                        },
                      ],
                    }
                  : {}),
              },
            } as unknown as MessageEvent<BM25WorkerResponse>);
          });
        },
        terminate: vi.fn(),
        setOnMessage: (handler) => {
          workerControl.onMessage = handler;
        },
        setOnError: vi.fn(),
      } satisfies BM25WorkerAdapter,
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });

    const loading = bm25.load();
    await vi.waitFor(() => {
      expect(operations).toEqual(['initialize']);
    });
    bm25.addDocument('new.md::0', 'hydration 이후 반영할 문서', 'new.md');
    await Promise.resolve();
    expect(operations).toEqual(['initialize']);

    // 적재 중 검색은 기다리지 않고 빈 결과로 물러납니다.
    await expect(bm25.searchTopWithSources('hydration', 1)).resolves.toEqual([]);
    // 복구할 작업자가 없으므로 준비 호출도 적재를 기다리지 않습니다.
    await bm25.recoverClosedWorker();
    expect(operations).toEqual(['initialize']);

    const initializeRequestId = workerControl.initializeRequestId;
    const onMessage = workerControl.onMessage;
    if (initializeRequestId === undefined || onMessage === undefined || !workerControl.initializeRequest) {
      throw new Error('BM25 worker initialize request was not captured.');
    }
    onMessage({
      data: {
        id: initializeRequestId,
        ...applyScriptedPrefix(workerControl.initializeRequest),
        ready: true,
        tokenizerCurrent: true,
        totalDocs: 1,
      },
    } as unknown as MessageEvent<BM25WorkerResponse>);
    await loading;
    const hits = await bm25.searchTopWithSources('hydration', 1);

    expect(operations).toEqual(['initialize', 'add', 'search-top']);
    expect(hits).toEqual([
      {
        docId: 'new.md::0',
        sourcePath: 'new.md',
        score: 1,
      },
    ]);
  });

  it('전체 재빌드 중 긴 문서 루프는 이벤트 루프에 양보하면서 검색 결과를 유지한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    try {
      const documents = Array.from({ length: 129 }, (_, index) => ({
        id: `doc-${index}.md::0`,
        text: index === 128 ? 'needle final document' : `ordinary document ${index}`,
        sourcePath: `doc-${index}.md`,
      }));

      const rebuildPromise = bm25.rebuild(documents);
      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);

      await vi.runAllTimersAsync();
      await rebuildPromise;

      expect(bm25.totalDocs).toBe(documents.length);
      expect([...bm25.search('needle').keys()]).toEqual(['doc-128.md::0']);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('전체 재빌드에서 같은 doc id가 반복되면 마지막 문서로 교체한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();

    await bm25.rebuild([
      { id: 'note.md::0', text: 'obsoletealpha', sourcePath: 'note.md' },
      { id: 'note.md::0', text: 'freshbeta', sourcePath: 'note.md' },
    ]);

    expect([...bm25.search('obsoletealpha').keys()]).toEqual([]);
    expect([...bm25.search('freshbeta').keys()]).toEqual(['note.md::0']);
  });

  it.each(['worker', 'no-worker'] as const)('재빌드 자료 준비 중 reload는 이전 재구축 잠금을 정리한다 (%s)', async (mode) => {
    const index = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined,
      mode === 'worker' ? { workerFactory: createScriptedWorker('').factory } : {});
    let finish!: (documents: BM25DocumentInput[]) => void;
    try {
      await index.load();
      const preparing = index.rebuildFrom(() => new Promise<BM25DocumentInput[]>((resolve) => { finish = resolve; }));
      const rejected = expect(preparing).rejects.toThrow('rag-bm25-session-retired');
      await index.load();
      finish([]);
      await rejected;
      expect(index['rebuildReplayOperations']).toBeNull();
      await index.rebuildFrom(() => Promise.resolve([{ id: 'fresh', text: 'synthetic fresh evidence', sourcePath: 'fresh.md' }]));
      expect(await index.getCorpusDocumentsByIds(['fresh'])).toHaveLength(1);
    } finally { index.close(); }
  });

  it('재빌드 corpus를 준비하는 동안 들어온 증분 변경은 bulk 교체 뒤 다시 적용한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    bm25.addDocument('gone.md::0', 'removeme 이전 문서', 'gone.md');
    await bm25.persist();

    let finishCorpus = (_documents: BM25DocumentInput[]): void => undefined;
    const corpus = new Promise<BM25DocumentInput[]>((resolve) => {
      finishCorpus = resolve;
    });
    const rebuilding = bm25.rebuildFrom(() => corpus);
    bm25.removeDocumentsBySource('gone.md');
    bm25.addDocument('new.md::0', 'keepme 최신 문서', 'new.md');
    await bm25.persist();
    finishCorpus([
      {
        id: 'gone.md::0',
        text: 'removeme stale snapshot',
        sourcePath: 'gone.md',
      },
      {
        id: 'baseline.md::0',
        text: 'baseline snapshot',
        sourcePath: 'baseline.md',
      },
    ]);

    await rebuilding;

    expect([...bm25.search('removeme').keys()]).toEqual([]);
    expect([...bm25.search('keepme').keys()]).toEqual(['new.md::0']);
    expect([...bm25.search('baseline').keys()]).toEqual(['baseline.md::0']);
  });

  it('재시작은 스냅샷과 tombstone 델타만으로 런타임을 복구한다', async () => {
    const dbName = createDbName();
    const snapshotRaw = '{"schemaVersion":3,"tokenizerVersion":2,"docs":["canned"]}';
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker(snapshotRaw).factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    expect(first.recoveryMode).toBe('full');
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();

    const captured = await readSnapshotState(dbName);
    expect(captured.manifest?.tokenizerVersion).toBe(TOKENIZER_VERSION);
    expect(captured.manifest?.docCount).toBe(1);
    expect(captured.manifest?.lastOrder).toBeGreaterThan(0);
    expect(captured.blockCount).toBeGreaterThan(0);
    expect(captured.manifest?.byteLength).toBe(snapshotRaw.length);
    first.removeDocumentsBySource('note.md');
    await first.persist();
    // 두 번째 persist는 캡처 주기 안이라 tombstone 로그를 지우지 않는다.
    const afterRemoval = await readSnapshotState(dbName);
    expect(afterRemoval.manifest?.lastOrder).toBe(captured.manifest?.lastOrder);
    expect(afterRemoval.removals.map((record) => record.kind)).toEqual(['remove-source']);
    expect(afterRemoval.removals[0]?.order).toBeGreaterThan(captured.manifest?.lastOrder ?? 0);

    const secondWorker = createScriptedWorker(snapshotRaw);
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    const initialize = secondWorker.requests.find((request) => request.operation === 'initialize');
    expect(initialize?.snapshot).toBe(snapshotRaw);
    expect(initialize?.sinceOrder).toBe(captured.manifest?.lastOrder);
    expect(initialize?.expectedDocs).toBe(captured.manifest?.docCount);
    expect(second.recoveryMode).toBe('snapshot+delta');
    second.close();
    first.close();
  });

  it('블록이 사라진 스냅샷은 폐기하고 원문에서 전량 복구한다', async () => {
    const dbName = createDbName();
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();
    await deleteSnapshotBlocks(dbName);

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    const initialize = secondWorker.requests.find((request) => request.operation === 'initialize');
    expect(initialize?.snapshot).toBe('');
    expect(initialize?.sinceOrder).toBeUndefined();
    expect(second.recoveryMode).toBe('full');
    expect((await readSnapshotState(dbName)).manifest).toBeNull();
    second.close();
    first.close();
  });

  it('블록 기록이 quota로 실패해도 색인은 계속되고 다음 시작은 전량 복구한다', async () => {
    const dbName = createDbName();
    const failing = new QuotaFailingBm25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await failing.load();
    failing.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await failing.persist();

    expect(failing.isReady).toBe(true);
    expect(failing.recoveryMode).toBe('full');
    const state = await readSnapshotState(dbName);
    expect(state.manifest).toBeNull();
    expect(state.blockCount).toBe(0);

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();
    expect(second.recoveryMode).toBe('full');
    expect((await second.getCorpusDocumentsByIds(['note.md::0'])).length).toBe(1);
    second.close();
    failing.close();
  });

  it('BM25 capture 대기 중 reload는 이전 진행 플래그를 버리고 새 capture를 허용한다', async () => {
    const name = createDbName();
    const gated = createScriptedWorker('{"docs":[]}', { holdSerialize: true });
    const index = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: gated.factory, snapshotMinOrders: 1, snapshotIntervalMs: 0 });
    await index.load();
    index.addDocument('a', 'alpha', 'a.md');
    const saving = index.flush();
    const observed = saving.catch((error: unknown) => error);
    try {
      await waitForRequest(gated.requests, 'serialize');
      await index.load();
      await observed;
      gated.releaseSerialize();
      expect(index['snapshotCaptureInFlight']).toBe(false);
      expect((await index.getCheckpoint()).applied).not.toBeNull();
      index.addDocument('b', 'beta', 'b.md');
      await index.flush();
      expect((await readSnapshotState(name)).manifest).not.toBeNull();
      expect((await index.getCheckpoint()).applied).not.toBeNull();
    } finally { gated.releaseSerialize(); index.close(); await observed; }
  });

  it('BM25 실제 cold worker는 다른 NoWorker owner의 삭제·source 교체를 snapshot delta로 복원한다', async () => {
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    let deliver: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    const scope: { onmessage: ((event: MessageEvent<BM25WorkerRequest>) => void) | null; postMessage(response: BM25WorkerResponse): void } = {
      onmessage: null, postMessage: (response) => deliver?.({ data: response } as MessageEvent<BM25WorkerResponse>),
    };
    Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: scope });
    await import('./bm25-worker-entry');
    const factory: BM25WorkerFactory = () => ({ worker: {
      postMessage: (message) => scope.onmessage?.({ data: message } as MessageEvent<BM25WorkerRequest>),
      terminate: vi.fn(), setOnMessage: (handler) => { deliver = handler; }, setOnError: vi.fn(),
    }, dispose: vi.fn() });
    try {
      for (const operation of ['remove-doc', 'remove-source', 'replace-source'] as const) {
        const name = createDbName();
        const a = new IndexedDbBM25Index(name);
        const b = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: factory, snapshotMinOrders: 1, snapshotIntervalMs: 60_000 });
        let c: IndexedDbBM25Index | undefined;
        try {
          await a.load(); await b.load();
          b.addDocument('a', 'synthetic alpha', 'a.md'); await b.flush();
          expect((await readSnapshotState(name)).manifest).not.toBeNull();
          b.close();
          if (operation === 'remove-doc') a.removeDocument('a');
          else if (operation === 'remove-source') a.removeDocumentsBySource('a.md');
          else a.replaceSourceDocuments('a.md', []);
          await a.flush();
          expect(await a['db'].documents.count()).toBe(0);
          c = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: factory });
          await c.load();
          expect(await c.searchTopWithSources('alpha', 5)).toEqual([]);
          expect(c.totalDocs).toBe(0);
          expect((await c.getCheckpoint()).applied).not.toBeNull();
        } finally { a.close(); b.close(); c?.close(); }
      }
    } finally {
      if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
      else Reflect.deleteProperty(globalThis, 'self');
    }
  });

  it('BM25 serialize 중 다른 owner가 commit하면 그 prefix의 snapshot을 발행하지 않는다', async () => {
    const name = createDbName();
    const gated = createScriptedWorker('{"docs":[]}', { holdSerialize: true });
    const a = new IndexedDbBM25Index(name, undefined, undefined, { workerFactory: gated.factory, snapshotMinOrders: 1, snapshotIntervalMs: 60_000 });
    await a.load();
    a.addDocument('a', 'alpha', 'a.md');
    const saving = a.flush();
    const observed = saving.catch((error: unknown) => error);
    const b = new IndexedDbBM25Index(name);
    try {
      await waitForRequest(gated.requests, 'serialize');
      await b.load();
      b.addDocument('b', 'beta', 'b.md');
      await b.flush();
      const foreign = await b.getDurabilityReceipt();
      gated.releaseSerialize();
      await saving;
      expect((await readSnapshotState(name)).manifest).toBeNull();
      expect(await a.getDurabilityReceipt()).toEqual(foreign);
      expect((await a.getCheckpoint()).applied).toBeNull();
      expect(a.isReady).toBe(true);
    } finally { gated.releaseSerialize(); await observed; a.close(); b.close(); }
  });

  it('스냅샷 직렬화 중 들어온 변경은 다음 델타로 남겨 유실하지 않는다', async () => {
    const dbName = createDbName();
    const gated = createScriptedWorker('{"docs":[]}', { holdSerialize: true });
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: gated.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await bm25.load();
    bm25.addDocument('early.md::0', 'early 원문', 'early.md');
    const persisting = bm25.persist();
    await waitForRequest(gated.requests, 'serialize');
    bm25.addDocument('late.md::0', 'late 원문', 'late.md');
    gated.releaseSerialize();
    await persisting;
    // 캡처 뒤 들어온 변경은 다음 persist에서 저장되어 델타로 남는다.
    await bm25.persist();

    const state = await readSnapshotState(dbName);
    const late = await readDocumentOrder(dbName, 'late.md::0');
    expect(late).toBeGreaterThan(state.manifest?.lastOrder ?? 0);
    expect(await readDocumentOrder(dbName, 'early.md::0')).toBeLessThanOrEqual(
      state.manifest?.lastOrder ?? 0,
    );
    bm25.close();
  });

  it('다른 토크나이저의 스냅샷은 적용하지 않되 새 완료본 전까지 블록·원장 순서를 보존한다', async () => {
    const dbName = createDbName();
    const manifest = { generation: 'legacy-generation', tokenizerVersion: 1, lastOrder: 100, docCount: 1, byteLength: 8, blockCount: 1 };
    await seedSnapshotManifest(dbName, manifest);
    await seedOrphanSnapshotBlock(dbName, manifest.generation, 'old-data');
    const worker = createScriptedWorker('{"docs":[]}');
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: worker.factory, snapshotMinOrders: 1000, snapshotIntervalMs: 60_000,
    });
    try {
      await bm25.load();
      const initialize = worker.requests.find((request) => request.operation === 'initialize');
      expect(initialize?.snapshot).toBe('');
      expect(bm25.recoveryMode).toBe('full');
      expect((await readSnapshotState(dbName)).manifest).toEqual(manifest);
      expect(await readSnapshotBlockKeys(dbName)).toEqual([`${manifest.generation}:0`]);
      bm25.addDocument('new', 'new source', 'new.md');
      await bm25.flush();
      expect(await readDocumentOrder(dbName, 'new')).toBeGreaterThan(manifest.lastOrder);
      expect((await readSnapshotState(dbName)).manifest).toEqual(manifest);
    } finally { bm25.close(); }
  });

  it('소유 manifest가 손상되었으면 블록을 고아로 간주해 일괄 삭제하지 않는다', async () => {
    const dbName = createDbName();
    const manifest = { generation: '', tokenizerVersion: TOKENIZER_VERSION, lastOrder: 100, docCount: 1, byteLength: 8, blockCount: 1 };
    await seedSnapshotManifest(dbName, manifest);
    await seedOrphanSnapshotBlock(dbName, 'unknown-owner', 'old-data');
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter(), undefined, { workerFactory: createScriptedWorker('{"docs":[]}').factory });
    try {
      await bm25.load();
      expect((await readSnapshotState(dbName)).manifest).toEqual(manifest);
      expect(await readSnapshotBlockKeys(dbName)).toEqual(['unknown-owner:0']);
    } finally { bm25.close(); }
  });

  it('재시작 sweep은 활성 세대가 아닌 고아 스냅샷 블록만 지운다', async () => {
    const dbName = createDbName();
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();
    const captured = await readSnapshotState(dbName);
    await seedOrphanSnapshotBlock(dbName, 'dead-generation', '{}');

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    expect(second.recoveryMode).toBe('snapshot+delta');
    expect(await readSnapshotBlockKeys(dbName)).toEqual([`${captured.manifest?.generation}:0`]);
    second.close();
    first.close();
  });

  it('deleteDatabase는 BM25 문서와 mutation DB를 통째로 삭제한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    bm25.addDocument('note.md::0', 'freshbeta', 'note.md');
    await bm25.persist();

    await bm25.deleteDatabase();

    const reopened = new IndexedDbBM25Index(dbName, createAdapter());
    await reopened.load();
    expect(reopened.totalDocs).toBe(0);
    expect([...reopened.search('freshbeta').keys()]).toEqual([]);
  });
  it('materializes removals without retaining an unbounded tombstone log', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    bm25.addDocument('obsolete.md::0', 'obsolete text', 'obsolete.md');
    await bm25.persist();

    for (let index = 0; index < 5; index++) {
      bm25.removeDocumentsBySource('obsolete.md');
      await bm25.persist();
    }

    expect(await countBm25Mutations(dbName)).toBe(0);
  });

  it('removes sources for files deleted while the plugin was not running', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    bm25.addDocument('keep.md::0', 'keep text', 'keep.md');
    bm25.addDocument('gone.md::0', 'gone text', 'gone.md');
    await bm25.persist();

    const result = await bm25.reconcileSourcePaths(['keep.md']);

    expect(result).toEqual({ deletedSourcePaths: ['gone.md'], remainingWork: false });
    await expect(bm25.getSourcePaths()).resolves.toEqual(['keep.md']);
    expect([...bm25.search('gone').keys()]).toEqual([]);
  });
});

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<IndexedDbBM25Index> {
  const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
  await bm25.load();
  for (const [id, text] of documents) {
    bm25.addDocument(id, text);
  }
  return bm25;
}

async function countBm25Mutations(dbName: string): Promise<number> {
  const db = new Dexie(dbName);
  db.version(2).stores({
    meta: 'key',
    documents: 'id, sourcePath, updated, order',
    mutations: 'id, kind, target, updated, order',
  });
  const count = await db.table('mutations').count();
  db.close();
  return count;
}

function createDbName(): string {
  const dbName = `SuperpowerInsideBM25IndexTest-${crypto.randomUUID()}`;
  dbNames.add(dbName);
  return dbName;
}

function createAdapter(rawJson?: string): DataAdapter {
  return createInspectableAdapter(rawJson).adapter;
}

async function seedBm25Snapshot(dbName: string, raw: string): Promise<void> {
  const db = new Dexie(dbName);
  db.version(1).stores({
    meta: 'key',
  });
  await db.table('meta').put({
    key: 'bm25-runtime-snapshot:v1',
    value: raw,
    updated: 1000,
  });
  db.close();
}

interface InspectableAdapter {
  adapter: DataAdapter;
  readRaw(path: string): string | undefined;
  readCount(): number;
  writeCount(): number;
}

function createInspectableAdapter(rawJson?: string): InspectableAdapter {
  const files = new Map<string, string>();
  let reads = 0;
  let writes = 0;
  if (rawJson !== undefined) {
    files.set('.superpower-inside/bm25-index.json', rawJson);
  }
  const adapter = {
    exists: (path: string) => Promise.resolve(files.has(path)),
    stat: (path: string) => {
      const data = files.get(path);
      if (data === undefined) return Promise.resolve(null);
      return Promise.resolve({
        type: 'file',
        ctime: 1000,
        mtime: 1000,
        size: data.length,
      });
    },
    read: (path: string) => {
      reads += 1;
      return Promise.resolve(files.get(path) ?? '');
    },
    write: (path: string, data: string) => {
      writes += 1;
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (path: string, newPath: string) => {
      const data = files.get(path);
      if (data !== undefined) {
        files.set(newPath, data);
        files.delete(path);
      }
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
  return {
    adapter,
    readRaw: (path: string) => files.get(path),
    readCount: () => reads,
    writeCount: () => writes,
  };
}

class QuotaFailingBm25Index extends IndexedDbBM25Index {
  protected override writeSnapshotBlock(_key: string, _data: string): Promise<void> {
    return Promise.reject(new DOMException('quota exceeded', 'QuotaExceededError'));
  }
}

interface ScriptedWorkerHandle {
  factory: BM25WorkerFactory;
  requests: BM25WorkerRequest[];
  releaseSerialize(): void;
}

function createScriptedWorker(
  snapshot: string,
  options: { holdSerialize?: boolean } = {},
): ScriptedWorkerHandle {
  const requests: BM25WorkerRequest[] = [];
  let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
  let release: (() => void) | undefined;
  const gate = options.holdSerialize
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : undefined;
  const factory: BM25WorkerFactory = () => ({
    worker: {
      postMessage: (message) => {
        requests.push(message);
        const deliver = async (): Promise<void> => {
          let response: BM25WorkerResponse = {
            id: message.id,
            ...applyScriptedPrefix(message),
            ready: true,
            tokenizerCurrent: true,
            totalDocs: message.snapshot ? 1 : 2,
          };
          if (message.operation === 'serialize') {
            await gate;
            response = { ...response, snapshot };
          }
          respond?.({ data: response } as MessageEvent<BM25WorkerResponse>);
        };
        void deliver();
      },
      terminate: vi.fn(),
      setOnMessage: (handler) => {
        respond = handler;
      },
      setOnError: () => undefined,
    },
    dispose: vi.fn(),
  });
  return { factory, requests, releaseSerialize: () => release?.() };
}

async function waitForRequest(
  requests: readonly BM25WorkerRequest[],
  operation: BM25WorkerRequest['operation'],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (requests.some((request) => request.operation === operation)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`BM25 worker request ${operation} was not sent.`);
}

interface SnapshotManifestRecord {
  generation: string;
  tokenizerVersion: number;
  lastOrder: number;
  docCount: number;
  byteLength: number;
  blockCount: number;
}

interface SnapshotRemovalRecord {
  order: number;
  kind: string;
  target: string;
}

interface SnapshotState {
  manifest: SnapshotManifestRecord | null;
  blockCount: number;
  removals: SnapshotRemovalRecord[];
}

interface StoredSnapshotMeta {
  key: string;
  value: string;
  updated: number;
}

function openSnapshotDb(dbName: string): Dexie {
  const db = new Dexie(dbName);
  db.version(4).stores({
    meta: 'key',
    documents: 'id, sourcePath, updated, order',
    mutations: 'id, kind, target, updated, order',
    removals: 'order, target',
    snapshotBlocks: 'key',
    durability: 'key',
  });
  return db;
}

async function seedOrphanSnapshotBlock(
  dbName: string,
  generation: string,
  data: string,
): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('snapshotBlocks').put({ key: `${generation}:0`, data });
  } finally {
    db.close();
  }
}

async function readSnapshotBlockKeys(dbName: string): Promise<string[]> {
  const db = openSnapshotDb(dbName);
  try {
    const keys = await db
      .table<{ key: string }, string>('snapshotBlocks')
      .toCollection()
      .primaryKeys();
    return [...keys].sort((a, b) => a.localeCompare(b));
  } finally {
    db.close();
  }
}

async function readSnapshotState(dbName: string): Promise<SnapshotState> {
  const db = openSnapshotDb(dbName);
  try {
    const stored = await db
      .table<StoredSnapshotMeta, string>('meta')
      .get('bm25-snapshot-manifest:v1');
    const value = stored?.value;
    return {
      manifest: typeof value === 'string' ? (JSON.parse(value) as SnapshotManifestRecord) : null,
      blockCount: await db.table('snapshotBlocks').count(),
      removals: await db.table<SnapshotRemovalRecord, number>('removals').toArray(),
    };
  } finally {
    db.close();
  }
}

async function readDocumentOrder(dbName: string, id: string): Promise<number | undefined> {
  const db = openSnapshotDb(dbName);
  try {
    const record = await db.table<{ id: string; order?: number }, string>('documents').get(id);
    return record?.order;
  } finally {
    db.close();
  }
}

async function deleteSnapshotBlocks(dbName: string): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('snapshotBlocks').clear();
  } finally {
    db.close();
  }
}

async function seedSnapshotManifest(
  dbName: string,
  manifest: SnapshotManifestRecord,
): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('meta').put({
      key: 'bm25-snapshot-manifest:v1',
      value: JSON.stringify(manifest),
      updated: 1000,
    });
  } finally {
    db.close();
  }
}

describe('BM25 lifecycle 경계', () => {
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { promise, release };
  }

  function fixture() {
    const requests: BM25WorkerRequest[] = [];
    const errors: ((event: ErrorEvent) => void)[] = [];
    let rejectSnapshot = false;
    let failMutation = false;
    const workerFactory: BM25WorkerFactory = () => {
      let respond!: (event: MessageEvent<BM25WorkerResponse>) => void;
      return {
        worker: {
          postMessage: (message) => {
            requests.push(message);
            queueMicrotask(() => respond({ data: {
              id: message.id,
              ...applyScriptedPrefix(message, !(failMutation && message.operation === 'add')),
              ...(failMutation && message.operation === 'add' ? { error: 'synthetic first mutation failure' } : { ready: true, tokenizerCurrent: true, totalDocs: 0 }),
              ...(rejectSnapshot && message.operation === 'initialize' ? { snapshotRejected: true } : {}),
            } } as MessageEvent<BM25WorkerResponse>));
          },
          terminate: vi.fn(),
          setOnMessage: (handler) => { respond = handler; },
          setOnError: (handler) => { errors.push(handler); },
        },
        dispose: vi.fn(),
      };
    };
    const index = new IndexedDbBM25Index(createDbName(), undefined, undefined, { workerFactory });
    const internals = index as unknown as {
      loadSnapshot(): Promise<{ raw: string; source: 'empty' }>;
      dropSnapshot(): Promise<void>;
      persistNow(checkpoint: number): Promise<void>;
      workerQueue: Promise<void>;
      commitChangedRows(operation: () => Promise<number>): Promise<number>;
      readPersistedOrder(): Promise<number>;
      db: { documents: { count(): Promise<number> } };
      persistenceQueue: Promise<void>;
    };
    return { index, internals, requests, errors, rejectSnapshots: () => { rejectSnapshot = true; }, failMutations: () => { failMutation = true; }, resumeMutations: () => { failMutation = false; } };
  }

  it.each(['close', 'reload'] as const)('초기 진행 callback의 %s도 퇴역 load의 worker 생성을 막는다', async (action) => {
    const f = fixture();
    let replacement: Promise<void> | undefined;
    const outcome = f.index.load(() => {
      if (action === 'close') f.index.close();
      else replacement = f.index.load();
    }).catch((error: unknown) => error);
    try {
      await replacement;
      expect(await outcome).toMatchObject({ message: 'rag-bm25-session-retired' });
      expect(f.errors).toHaveLength(action === 'close' ? 0 : 1);
      if (action === 'reload') expect(f.index.isReady).toBe(true);
    } finally { f.index.close(); await outcome; }
  });

  it.each(['receipt', 'order', 'snapshot', 'count'] as const)('%s await 중 worker 장애는 initialize 호출 없이 최초 원인으로 실패한다', async (phase) => {
    const f = fixture();
    const waiting = gate();
    const entered = gate();
    const hold = async <T>(value: T): Promise<T> => { entered.release(); await waiting.promise; return value; };
    const spy = phase === 'receipt' ? vi.spyOn(f.index, 'getDurabilityReceipt').mockImplementationOnce(() => hold(null))
      : phase === 'order' ? vi.spyOn(f.internals, 'readPersistedOrder').mockImplementationOnce(() => hold(0))
      : phase === 'snapshot' ? vi.spyOn(f.internals, 'loadSnapshot').mockImplementationOnce(() => hold({ raw: '', source: 'empty' }))
      : vi.spyOn(f.internals.db.documents, 'count').mockImplementationOnce(() => hold(0));
    const initialize = vi.spyOn(BM25WorkerRuntime.prototype, 'initialize');
    const loading = f.index.load();
    const outcome = loading.catch((error: unknown) => error);
    try {
      await entered.promise;
      f.errors[0]({ message: 'synthetic original worker failure' } as ErrorEvent);
      waiting.release();
      expect(await outcome).toMatchObject({ message: 'synthetic original worker failure' });
      expect(initialize).not.toHaveBeenCalled();
      expect(f.requests).toEqual([]);
      expect((await f.index.getCheckpoint()).applied).toBeNull();
    } finally { waiting.release(); await outcome; spy.mockRestore(); initialize.mockRestore(); f.index.close(); }
  });

  it.each(['close', 'reload', 'failure'].flatMap((action) => ['drop', 'count'].map((phase) => ({ action, phase }))))('snapshot fallback $phase 대기 중 $action은 옛 worker 재초기화를 막는다', async ({ action, phase }) => {
    const f = fixture();
    f.rejectSnapshots();
    const waiting = gate(); const entered = gate();
    const hold = async (): Promise<number> => { entered.release(); await waiting.promise; return 0; };
    vi.spyOn(f.internals, 'dropSnapshot').mockImplementationOnce(async () => {
      if (phase === 'drop') await hold();
      else vi.spyOn(f.internals.db.documents, 'count').mockImplementationOnce(hold);
    });
    const initialize = vi.spyOn(BM25WorkerRuntime.prototype, 'initialize');
    const progress = vi.fn();
    const outcome = f.index.load(progress).catch((error: unknown) => error);
    try {
      await entered.promise;
      if (action === 'close') f.index.close();
      else if (action === 'reload') await f.index.load();
      else f.errors[0]({ message: 'synthetic fallback failure' } as ErrorEvent);
      const calls = initialize.mock.calls.length;
      const publications = progress.mock.calls.length;
      waiting.release();
      expect(await outcome).toBeInstanceOf(Error);
      expect(initialize).toHaveBeenCalledTimes(calls);
      expect(progress).toHaveBeenCalledTimes(publications);
      if (action === 'reload') expect(f.index.isReady).toBe(true);
    } finally { waiting.release(); await outcome; initialize.mockRestore(); f.index.close(); }
  });

  it('A 실패 뒤 B/C는 runtime을 호출하지 않고 최초 실패와 pending 원문을 보존한다', async () => {
    const f = fixture(); await f.index.load(); f.failMutations();
    const add = vi.spyOn(BM25WorkerRuntime.prototype, 'add');
    try {
      for (const id of ['A', 'B', 'C']) f.index.addDocument(id, 'synthetic ' + id);
      await expect(f.index.flush()).rejects.toThrow('synthetic first mutation failure');
      expect(add).toHaveBeenCalledTimes(1);
      await expect(f.index.flush()).rejects.toThrow('synthetic first mutation failure');
      expect((await f.index.getCheckpoint()).applied).toBeNull();
      f.resumeMutations();
      await f.index.recoverClosedWorker();
      expect(await f.index.getCorpusDocumentsByIds(['A', 'B', 'C'])).toEqual([
        expect.objectContaining({ id: 'A', text: 'synthetic A' }),
        expect.objectContaining({ id: 'B', text: 'synthetic B' }),
        expect.objectContaining({ id: 'C', text: 'synthetic C' }),
      ]);
      expect(f.index.isReady).toBe(true);
      expect(add).toHaveBeenCalledTimes(1);
    } finally { add.mockRestore(); f.index.close(); }
  });

  it.each(['close', 'reload'].flatMap((action) => ['queue', 'saving', 'saved'].map((phase) => ({ action, phase }))))('복구 $phase 대기 중 $action은 예약된 복구가 새 session을 만들지 못한다', async ({ action, phase }) => {
    const f = fixture(); await f.index.load();
    f.errors[0]({ message: 'synthetic worker failure' } as ErrorEvent);
    const waiting = gate(); const entered = gate();
    if (phase === 'queue') f.internals.workerQueue = waiting.promise;
    else if (phase === 'saving') f.internals.persistenceQueue = waiting.promise;
    else {
      const persist = f.internals.persistNow.bind(f.index);
      vi.spyOn(f.internals, 'persistNow').mockImplementationOnce(async (checkpoint) => {
        await persist(checkpoint); entered.release(); await waiting.promise;
      });
    }
    const outcome = f.index.recoverClosedWorker().catch((error: unknown) => error);
    try {
      if (phase === 'saved') await entered.promise;
      else { await Promise.resolve(); await Promise.resolve(); }
      if (action === 'close') f.index.close(); else await f.index.load();
      const created = f.errors.length;
      waiting.release();
      expect(await outcome).toMatchObject({ message: 'rag-bm25-session-retired' });
      expect(f.errors).toHaveLength(created);
      if (action === 'reload') expect(f.index.isReady).toBe(true);
    } finally { waiting.release(); await outcome; f.index.close(); }
  });

  it('snapshot fallback DB 실패는 최초 원인으로 정착하고 재초기화하지 않는다', async () => {
    const f = fixture(); f.rejectSnapshots();
    const original = new Error('synthetic fallback database failure');
    const write = vi.spyOn(f.internals, 'commitChangedRows').mockRejectedValueOnce(original);
    try {
      await expect(f.index.load()).rejects.toBe(original);
      expect(write).toHaveBeenCalledTimes(1);
      expect(f.requests.map((request) => request.operation)).toEqual(['initialize']);
      expect(f.index.isReady).toBe(false);
    } finally { f.index.close(); }
  });

  it('초기 DB 실패는 원인 그대로 한 번 실패하고 worker를 초기화하지 않는다', async () => {
    const f = fixture();
    const original = new Error('synthetic database failure');
    const receipt = vi.spyOn(f.index, 'getDurabilityReceipt').mockRejectedValueOnce(original);
    try {
      await expect(f.index.load()).rejects.toBe(original);
      expect(receipt).toHaveBeenCalledTimes(1);
      expect(f.requests).toEqual([]);
      expect(f.index.isReady).toBe(false);
    } finally { f.index.close(); }
  });

  it.each(['close', 'delete'] as const)('%s 이후 load/recover/mutation은 terminal owner를 부활시키지 않는다', async (action) => {
    const f = fixture(); await f.index.load();
    if (action === 'close') f.index.close(); else await f.index.deleteDatabase();
    try {
      await expect(f.index.load()).rejects.toThrow('rag-bm25-session-retired');
      await expect(f.index.recoverClosedWorker()).rejects.toThrow('rag-bm25-session-retired');
      expect(() => f.index.addDocument('late', 'synthetic late')).toThrow('rag-bm25-session-retired');
      await expect(f.index.rebuild([])).rejects.toThrow('rag-bm25-session-retired');
      expect(f.errors).toHaveLength(1);
    } finally { f.index.close(); }
  });
});
