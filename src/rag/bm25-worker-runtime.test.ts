import { Worker as NodeWorker } from 'node:worker_threads';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BM25_WORKER_SOURCE } from '../../.local/generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import { RustBm25RuntimeIndex } from './rust-core';
import { TOKENIZER_VERSION } from './tokenizer-version';
import {
  BM25WorkerRuntime,
  type BM25WorkerAdapter,
  type BM25WorkerFactory,
  type BM25WorkerRequest,
  type BM25WorkerResponse,
} from './bm25-worker-runtime';

afterEach(() => vi.useRealTimers());

describe('BM25 worker runtime', () => {
  it('최초 close 원인은 재종료와 닫힌 worker 요청에도 보존한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const original = new Error('synthetic original shutdown');
    const pending = runtime.initialize('synthetic-db', '');
    const outcome = pending.catch((error: unknown) => error);
    runtime.close(original);
    runtime.close(new Error('synthetic secondary shutdown'));
    expect(await outcome).toBe(original);
    expect(runtime.closeReason).toBe(original);
    await expect(runtime.initialize('synthetic-db', '')).rejects.toThrow('closed');
    expect(runtime.closeReason).toBe(original);
  });

  it('현재 entry와 실제 Rust checkpoint는 초기화·추가·rebuild·분할 source의 실제 prefix를 담는다', async () => {
    const built = await build({
      entryPoints: ['src/rag/bm25-worker-entry.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
    });
    const worker = createNodeWorker({ source: built.outputFiles[0].text, persistedFixture: true });
    const runtime = createNodeRuntime(worker);
    try {
      expect(runtime.appliedRevision).toBeNull();
      expect(runtime.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(await runtime.initialize('persisted-worker-test', '')).toMatchObject({
        sessionId: runtime.sessionId,
        appliedRevision: 0,
        pendingRevision: null,
        totalDocs: 300,
      });
      await runtime.add({ id: 'added', text: 'synthetic added', sourcePath: 'added.md' });
      expect(runtime.appliedRevision).toBe(1);
      await runtime.rebuild([
        { id: 'rebuilt', text: 'synthetic rebuilt', sourcePath: 'rebuilt.md' },
      ]);
      expect(runtime.appliedRevision).toBe(2);
      const documents = Array.from({ length: 129 }, (_, index) => ({
        id: 'part-' + index,
        text: 'synthetic fragment ' + index,
        sourcePath: 'parts.md',
      }));
      const first = runtime.replaceSource('parts.md', documents.slice(0, 128), true, {
        revision: 3,
        part: 0,
        finalPart: false,
      });
      expect(runtime.appliedRevision).toBe(2);
      await first;
      expect(runtime.appliedRevision).toBe(2);
      expect(runtime.pendingRevision).toBe(3);
      const partial = await runtime.serializeCheckpoint();
      expect(partial).toMatchObject({
        sessionId: runtime.sessionId,
        appliedRevision: 2,
        pendingRevision: 3,
      });
      const partialIndex = RustBm25RuntimeIndex.fromJson(partial.snapshot, TOKENIZER_VERSION);
      try {
        expect(partialIndex?.totalDocs()).toBe(129);
      } finally {
        partialIndex?.dispose();
      }
      await runtime.replaceSource('parts.md', documents.slice(128), false, {
        revision: 3,
        part: 1,
        finalPart: true,
      });
      const complete = await runtime.serializeCheckpoint();
      expect(complete).toMatchObject({
        sessionId: runtime.sessionId,
        appliedRevision: 3,
        pendingRevision: null,
      });
      const completeIndex = RustBm25RuntimeIndex.fromJson(complete.snapshot, TOKENIZER_VERSION);
      try {
        expect(completeIndex?.totalDocs()).toBe(130);
      } finally {
        completeIndex?.dispose();
      }
      expect(await runtime.serialize()).toBe(complete.snapshot);
      await runtime.searchTop('fragment', 1);
      await runtime.aggregate('fragment', 1);
      await runtime.batch([], []);
      expect(runtime.appliedRevision).toBe(3);
      const session = runtime.sessionId;
      await runtime.initialize('persisted-worker-test', '');
      expect(runtime.sessionId).toBe(session);
      expect(runtime.appliedRevision).toBe(0);
      expect(runtime.pendingRevision).toBeNull();
      expect(await runtime.removeDocument('doc-0')).toMatchObject({
        appliedRevision: 1,
        totalDocs: 299,
      });
      expect(await runtime.removeSource('a.md')).toMatchObject({
        appliedRevision: 2,
        totalDocs: 0,
      });
      expect(await runtime.clear()).toMatchObject({ appliedRevision: 3, totalDocs: 0 });
      await expect(
        runtime.replaceSource('parts.md', [], true, { revision: 4, part: 1 }),
      ).rejects.toThrow('mutation sequence');
      expect(runtime.appliedRevision).toBeNull();
      await expect(runtime.serializeCheckpoint()).rejects.toThrow('requires initialization');
      expect(await runtime.initialize('persisted-worker-test', '')).toMatchObject({
        appliedRevision: 0,
        totalDocs: 300,
      });
    } finally {
      runtime.close();
      await worker.terminate();
    }
  });

  it.each(['clear', 'add'] as const)(
    '현재 entry의 오류 복구 초기화 중 거절된 %s는 첫 자동 mutation 번호를 소비하지 않는다',
    async (operation) => {
      const built = await build({
        entryPoints: ['src/rag/bm25-worker-entry.ts'],
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
      });
      const worker = createNodeWorker({ source: built.outputFiles[0].text, persistedFixture: true });
      let gateInitialization = false;
      let releaseGate: (release: () => void) => void = () => {};
      const gated = new Promise<() => void>((resolve) => {
        releaseGate = resolve;
      });
      const runtime = createNodeRuntime(worker, (response, deliver) => {
        if (gateInitialization && response.appliedRevision === 0 && !response.progress) {
          gateInitialization = false;
          releaseGate(deliver);
        } else deliver();
      });
      try {
        await runtime.initialize('persisted-worker-test', '');
        await expect(
          runtime.add({ id: '', text: 'synthetic invalid', sourcePath: 'invalid.md' }),
        ).rejects.toThrow('validation failed');
        expect(runtime.appliedRevision).toBeNull();
        gateInitialization = true;
        const initialization = runtime.initialize('persisted-worker-test', '');
        const release = await gated;
        expect(runtime.appliedRevision).toBeNull();
        await expect(
          operation === 'clear'
            ? runtime.clear()
            : runtime.add({ id: 'rejected', text: 'synthetic rejected', sourcePath: 'rejected.md' }),
        ).rejects.toThrow('requires initialization');
        release();
        expect(await initialization).toMatchObject({ appliedRevision: 0, totalDocs: 300 });
        expect(
          await (operation === 'clear'
            ? runtime.clear()
            : runtime.add({ id: 'accepted', text: 'synthetic accepted', sourcePath: 'accepted.md' })),
        ).toMatchObject({ appliedRevision: 1, totalDocs: operation === 'clear' ? 0 : 301 });
        expect(runtime.appliedRevision).toBe(1);
        expect(await runtime.serializeCheckpoint()).toMatchObject({
          sessionId: runtime.sessionId,
          appliedRevision: 1,
          pendingRevision: null,
        });
      } finally {
        runtime.close();
        await worker.terminate();
      }
    },
  );

  it('초기 initialize ACK는 이미 수락한 대기 mutation의 자동 번호를 덮어쓰지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    try {
      const initialization = runtime.initialize('synthetic-db', '');
      const first = runtime.clear();
      const second = runtime.add({ id: 'queued', text: 'synthetic queued', sourcePath: 'queued.md' });
      expect(fixture.postMessage).toHaveBeenCalledTimes(1);
      fixture.respond({ id: 1 });
      await initialization;
      const third = runtime.clear();
      fixture.respond({ id: 2 });
      fixture.respond({ id: 3 });
      fixture.respond({ id: 4 });
      await Promise.all([first, second, third]);
      expect(
        fixture.postMessage.mock.calls.map(([message]) => message.revision),
      ).toEqual([0, 1, 2, 3]);
      expect(runtime.appliedRevision).toBe(3);
    } finally {
      runtime.close();
    }
  });

  it('checkpoint는 다음 mutation ACK 뒤에도 serialize 성공 시점의 prefix를 반환한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 1 });
    await initialization;
    const first = runtime.add({ id: 'first', text: 'synthetic first', sourcePath: 'first.md' });
    const checkpoint = runtime.serializeCheckpoint();
    const second = runtime.clear();
    fixture.respond({ id: 2 });
    fixture.respond({ id: 3, snapshot: 'synthetic snapshot' });
    fixture.respond({ id: 4 });
    await Promise.all([first, second]);
    expect(await checkpoint).toEqual({
      snapshot: 'synthetic snapshot',
      sessionId: runtime.sessionId,
      appliedRevision: 1,
      pendingRevision: null,
    });
    expect(runtime.appliedRevision).toBe(2);
    expect(
      fixture.postMessage.mock.calls.map(([message]: [BM25WorkerRequest]) => ({
        revision: message.revision,
        part: message.part,
        finalPart: message.finalPart,
      })),
    ).toEqual([
      { revision: 0, part: 0, finalPart: true },
      { revision: 1, part: 0, finalPart: true },
      { revision: 1, part: 0, finalPart: true },
      { revision: 2, part: 0, finalPart: true },
    ]);
    runtime.close();
  });
  it('같은 session을 재초기화한 뒤 이전 serialize ACK를 새 checkpoint로 반환하지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 1 });
    await initialization;
    const checkpoint = runtime.serializeCheckpoint();
    const rejected = expect(checkpoint).rejects.toThrow('no longer current');
    const recovery = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 2, snapshot: 'synthetic previous prefix' });
    fixture.respond({ id: 3 });
    await recovery;
    await rejected;
    expect(runtime.appliedRevision).toBe(0);
    runtime.close();
  });

  it.each(['success', 'progress', 'error'] as const)(
    '이전 session의 %s 응답은 현재 초기화를 인증하지 못한다',
    async (kind) => {
      const fixture = createFakeWorker();
      const runtime = new BM25WorkerRuntime(fixture.create);
      const initialization = runtime.initialize('synthetic-db', '');
      const rejected = expect(initialization).rejects.toThrow('acknowledgement');
      fixture.rawRespond({
        id: 1,
        sessionId: crypto.randomUUID(),
        appliedRevision: kind === 'success' ? 0 : null,
        pendingRevision: null,
        nextPart: 0,
        ...(kind === 'progress' ? { progress: { processedDocuments: 128 } } : {}),
        ...(kind === 'error' ? { error: 'Synthetic failure.' } : {}),
      });
      await rejected;
      expect(runtime.appliedRevision).toBeNull();
      expect(runtime.hydrationProgress).toBeNull();
      await expect(runtime.clear()).rejects.toThrow('requires initialization');
      runtime.close();
    },
  );

  it('실패 뒤 late ACK와 재초기화 전 ACK는 새 prefix를 만들지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 1 });
    await initialization;
    const mutation = runtime.clear();
    const queued = runtime.clear();
    const rejected = Promise.allSettled([mutation, queued]);
    fixture.respond({ id: 2, error: 'Synthetic failure.' });
    expect((await rejected).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    fixture.rawRespond({
      id: 2,
      sessionId: runtime.sessionId,
      appliedRevision: 1,
      pendingRevision: null,
      nextPart: 0,
    });
    expect(runtime.appliedRevision).toBeNull();
    await expect(runtime.serializeCheckpoint()).rejects.toThrow('requires initialization');
    const recovery = runtime.initialize('synthetic-db', '');
    fixture.rawRespond({
      id: 1,
      sessionId: runtime.sessionId,
      appliedRevision: 0,
      pendingRevision: null,
      nextPart: 0,
    });
    fixture.rawRespond({
      id: 3,
      sessionId: runtime.sessionId,
      appliedRevision: 2,
      pendingRevision: null,
      nextPart: 0,
    });
    expect(runtime.appliedRevision).toBeNull();
    fixture.respond({ id: 4 });
    await recovery;
    expect(runtime.appliedRevision).toBe(0);
    const valid = runtime.clear();
    fixture.respond({ id: 5 });
    await valid;
    expect(runtime.appliedRevision).toBe(1);
    runtime.close();
    fixture.rawRespond({
      id: 5,
      sessionId: runtime.sessionId,
      appliedRevision: 1,
      pendingRevision: null,
      nextPart: 0,
    });
    expect(runtime.appliedRevision).toBeNull();
    await expect(runtime.initialize('synthetic-db', '')).rejects.toThrow('closed');
  });

  it.each([
    { appliedRevision: 0, pendingRevision: null, nextPart: 0 },
    { appliedRevision: 2, pendingRevision: null, nextPart: 0 },
    { appliedRevision: 0, pendingRevision: 1, nextPart: 1 },
    { appliedRevision: 1.5, pendingRevision: null, nextPart: 0 },
  ])('완료 mutation의 잘못된 prefix ACK를 거절한다: %j', async (state) => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 1 });
    await initialization;
    const mutation = runtime.clear();
    const rejected = expect(mutation).rejects.toThrow();
    fixture.rawRespond({ id: 2, sessionId: runtime.sessionId, ...state });
    await rejected;
    expect(runtime.appliedRevision).toBeNull();
    runtime.close();
  });

  it('wire 필드 누락과 뒤순서 ACK는 queue를 인증하지 못한다', async () => {
    for (const outOfOrder of [false, true]) {
      const fixture = createFakeWorker();
      const runtime = new BM25WorkerRuntime(fixture.create);
      const initialization = runtime.initialize('synthetic-db', '');
      const next = runtime.clear();
      const rejected = Promise.allSettled([initialization, next]);
      fixture.rawRespond(
        outOfOrder
          ? {
              id: 2,
              sessionId: runtime.sessionId,
              appliedRevision: 1,
              pendingRevision: null,
              nextPart: 0,
            }
          : { id: 1, ready: true, totalDocs: 0 },
      );
      expect((await rejected).map((result) => result.status)).toEqual(['rejected', 'rejected']);
      expect(runtime.appliedRevision).toBeNull();
      runtime.close();
    }
  });

  it('현재 entry의 source-replacement batch는 다른 파일과 위치·legacy 직렬화를 보존한다', async () => {
    const built = await build({
      entryPoints: ['src/rag/bm25-worker-entry.ts'],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
    });
    const worker = createNodeWorker({ source: built.outputFiles[0].text });
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, {
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        documents: [
          { id: 'old', sourcePath: 'a.md', text: 'old alpha' },
          { id: 'other', sourcePath: 'b.md', text: 'beta' },
        ],
      });
      await initialized;
      const replaced = waitForNodeWorkerResponse(worker, 2);
      postNodeRequest(worker, {
        id: 2,
        operation: 'replace-source',
        target: 'a.md',
        removeFirst: true,
        documents: [{ id: 'new', sourcePath: 'a.md', text: 'alpha gamma' }],
      });
      expect(await replaced).toMatchObject({ totalDocs: 2 });
      const searched = waitForNodeWorkerResponse(worker, 3);
      postNodeRequest(worker, { id: 3, operation: 'search-top', query: '"alpha gamma"', limit: 5 });
      expect((await searched).hits?.map((hit) => hit.docId)).toEqual(['new']);
      const serialized = waitForNodeWorkerResponse(worker, 4);
      postNodeRequest(worker, { id: 4, operation: 'serialize' });
      const snapshot = (await serialized).snapshot;
      const runtime = RustBm25RuntimeIndex.fromJson(snapshot ?? '', TOKENIZER_VERSION);
      try {
        expect(runtime?.searchTop('beta', 1)?.map((hit) => hit.docId)).toEqual(['other']);
        expect(runtime?.searchTop('old', 1)).toEqual([]);
      } finally {
        runtime?.dispose();
      }
    } finally {
      await worker.terminate();
    }
  });

  it('저장 문서가 WASM 묶음 한도를 넘더라도 생성된 작업자가 전부 복원한다', async () => {
    const worker = createNodeWorker({ persistedFixture: true });
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, {
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        dbName: 'persisted-worker-test',
        snapshot: '',
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 300 }),
      );
      const searched = waitForNodeWorkerResponse(worker, 2);
      postNodeRequest(worker, { id: 2, operation: 'search-top', query: 'lastdocument', limit: 1 });
      await expect(searched).resolves.toEqual(
        expect.objectContaining({ hits: [expect.objectContaining({ docId: 'doc-299' })] }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들에서 BM25 복원과 검색을 수행한다', async () => {
    const worker = createNodeWorker();
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, {
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        snapshot: '',
        documents: [
          { id: 'alpha::0', text: 'renderer safe lexical search', sourcePath: 'alpha.md' },
        ],
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ id: 1, ready: true, totalDocs: 1 }),
      );

      const searched = waitForNodeWorkerResponse(worker, 2);
      postNodeRequest(worker, { id: 2, operation: 'search-top', query: 'lexical', limit: 5 });
      await expect(searched).resolves.toEqual(
        expect.objectContaining({
          id: 2,
          hits: [expect.objectContaining({ docId: 'alpha::0', sourcePath: 'alpha.md' })],
        }),
      );

      const batched = waitForNodeWorkerResponse(worker, 3);
      postNodeRequest(worker, {
        id: 3,
        operation: 'batch',
        queries: [{ query: 'lexical', limit: 5 }],
        aggregates: [{ query: 'lexical', limit: 5 }],
        allowedPaths: ['alpha.md'],
      });
      const batchResponse = await batched;
      expect(batchResponse).toEqual(expect.objectContaining({ id: 3 }));
      expect(JSON.parse(batchResponse.batchJson ?? '{}')).toMatchObject({
        queries: [{ hits: [expect.objectContaining({ sourcePath: 'alpha.md', rank: 1 })] }],
        aggregates: [expect.objectContaining({ totalDocuments: 1, totalOccurrences: 1 })],
      });
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들이 단건 추가 필드와 제목 전용 토큰을 스냅샷 복원 뒤에도 유지한다', async () => {
    const worker = createNodeWorker();
    try {
      const rebuilt = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, {
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        documents: [],
      });
      await expect(rebuilt).resolves.toEqual(expect.objectContaining({ totalDocs: 0 }));

      const indexed = waitForNodeWorkerResponse(worker, 2);
      postNodeRequest(worker, {
        id: 2,
        operation: 'add',
        document: {
          id: 'fielded::0',
          text: 'alpha beta body',
          sourcePath: 'reports/ledger.md',
          title: 'Quarterly Ledger',
          headings: ['Deployment Guide'],
          tags: ['finance'],
        },
      });
      await expect(indexed).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1 }),
      );

      for (const [id, query] of [
        [3, 'title:quarterly'],
        [4, 'headings:deployment'],
        [5, 'tags:finance'],
        [6, 'path:ledger'],
      ] as const) {
        const searched = waitForNodeWorkerResponse(worker, id);
        postNodeRequest(worker, { id, operation: 'search-top', query, limit: 5 });
        await expect(searched).resolves.toEqual(
          expect.objectContaining({
            hits: [
              expect.objectContaining({ docId: 'fielded::0', sourcePath: 'reports/ledger.md' }),
            ],
          }),
        );
      }

      const serialized = waitForNodeWorkerResponse(worker, 7);
      postNodeRequest(worker, { id: 7, operation: 'serialize' });
      const snapshot = (await serialized).snapshot;
      expect(typeof snapshot).toBe('string');

      const restored = waitForNodeWorkerResponse(worker, 8);
      postNodeRequest(worker, {
        id: 8,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        snapshot,
      });
      await expect(restored).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1 }),
      );

      const titleOnly = waitForNodeWorkerResponse(worker, 9);
      postNodeRequest(worker, {
        id: 9,
        operation: 'search-top',
        query: 'title:quarterly',
        limit: 5,
      });
      await expect(titleOnly).resolves.toEqual(
        expect.objectContaining({
          hits: [expect.objectContaining({ docId: 'fielded::0', sourcePath: 'reports/ledger.md' })],
        }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker의 대표 경로 batch와 개별 fallback은 같은 범위·점수·순위를 사용한다', async () => {
    const worker = createNodeWorker();
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, { id: 1, operation: 'initialize', wasmBase64: RAG_WASM_BASE64 });
      await initialized;
      for (const [id, sourcePath, text] of [
        [2, 'hidden.md', 'quartz quartz quartz quartz'],
        [3, 'allowed.md', 'quartz'],
      ] as const) {
        const added = waitForNodeWorkerResponse(worker, id);
        postNodeRequest(worker, { id, operation: 'add', document: { id: String(id), sourcePath, text } });
        await expect(added).resolves.toMatchObject({ ready: true, totalDocs: id - 1 });
      }
      const result = waitForNodeWorkerResponse(worker, 4);
      postNodeRequest(worker, { id: 4, operation: 'batch', queries: [{ query: 'quartz', limit: 1 }], allowedPaths: ['allowed.md'] });
      const batch = JSON.parse((await result).batchJson ?? 'null') as { queries: { hits: unknown }[] } | null;
      const hits = batch?.queries[0]?.hits;
      expect(hits).toEqual([{ docId: '3', sourcePath: 'allowed.md', rank: 1, score: expect.any(Number) as unknown }]);

      const fallback = waitForNodeWorkerResponse(worker, 5);
      postNodeRequest(worker, { id: 5, operation: 'search-representatives', query: 'quartz', limit: 1, allowedPaths: ['allowed.md'] });
      expect(JSON.parse((await fallback).representativeHitsJson ?? 'null') as unknown).toEqual(hits);
    } finally {
      await worker.terminate();
    }
  });

  it('생성된 worker 번들이 위치 정보 없는 스냅샷을 거절하고 저장 원문에서 전량 복구한다', async () => {
    const dbName = 'legacy-snapshot-fixture';
    const legacySnapshot = createLegacySnapshotWithoutPosition();
    const worker = createNodeWorker({
      legacyFixture: {
        dbName,
        documents: [{ id: 'legacy::0', text: 'alpha beta', sourcePath: 'legacy.md', order: 1 }],
      },
    });
    try {
      const initialized = waitForNodeWorkerResponse(worker, 1);
      postNodeRequest(worker, {
        id: 1,
        operation: 'initialize',
        wasmBase64: RAG_WASM_BASE64,
        dbName,
        snapshot: legacySnapshot,
        sinceOrder: 100,
        expectedDocs: 1,
      });
      await expect(initialized).resolves.toEqual(
        expect.objectContaining({ ready: true, totalDocs: 1, snapshotRejected: true }),
      );

      const recovered = waitForNodeWorkerResponse(worker, 2);
      postNodeRequest(worker, { id: 2, operation: 'search-top', query: '"alpha beta"', limit: 5 });
      await expect(recovered).resolves.toEqual(
        expect.objectContaining({
          hits: [expect.objectContaining({ docId: 'legacy::0', sourcePath: 'legacy.md' })],
        }),
      );
    } finally {
      await worker.terminate();
    }
  });

  it('시간 제한을 넘긴 worker를 종료하고 대기 작업을 거부한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('test-db', '');
    const rejected = expect(initialization).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(500);

    await rejected;
    expect(fixture.terminate).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it('앞선 복원 대기 시간은 다음 검색의 실행 제한에서 제외한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('queued-test-db', '');
    const search = runtime.searchTop('independent query', 10);
    const results = Promise.allSettled([initialization, search]);

    await vi.advanceTimersByTimeAsync(450);
    expect(fixture.terminate).not.toHaveBeenCalled();
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, ready: true, tokenizerCurrent: true, totalDocs: 1 });
    expect(fixture.postMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90);
    fixture.respond({ id: 2, hits: [{ docId: 'result', sourcePath: 'result.md', score: 1 }] });

    expect((await results).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(fixture.terminate).not.toHaveBeenCalled();
    runtime.close();
  });

  it('대기 중 취소한 요청은 작업자에게 보내지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const first = runtime.searchTop('first query', 10);
    const controller = new AbortController();
    const cancelled = runtime.aggregate('cancelled query', 10, controller.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = runtime.searchTop('next query', 10);
    controller.abort();
    await cancellation;

    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, hits: [] });
    await first;
    expect(fixture.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 3, operation: 'search-top' }),
    );
    fixture.respond({ id: 3, hits: [] });
    await expect(next).resolves.toEqual([]);
    runtime.close();
  });

  it('실행 중 취소는 즉시 알리되 늦은 응답 전에는 다음 요청을 실행하지 않는다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const controller = new AbortController();
    const cancelled = runtime.searchTop('first query', 10, controller.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = runtime.searchTop('next query', 10);
    controller.abort();
    await cancellation;

    await vi.advanceTimersByTimeAsync(90);
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    fixture.respond({ id: 1, hits: [] });
    await vi.advanceTimersByTimeAsync(90);
    fixture.respond({ id: 2, hits: [] });
    await expect(next).resolves.toEqual([]);
    expect(fixture.terminate).not.toHaveBeenCalled();
    runtime.close();
  });

  it('취소한 소비자는 기존 prefix를 보존하지만 실제 timeout 뒤 late ACK는 인증하지 않는다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('synthetic-db', '');
    fixture.respond({ id: 1 });
    await initialization;
    const controller = new AbortController();
    const search = runtime.searchTop('synthetic query', 1, controller.signal);
    const cancelled = expect(search).rejects.toMatchObject({ name: 'AbortError' });
    const mutation = runtime.clear();
    const timedOut = expect(mutation).rejects.toThrow('timed out');
    controller.abort();
    await cancelled;
    expect(runtime.appliedRevision).toBe(0);
    expect(fixture.postMessage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    expect(runtime.appliedRevision).toBeNull();
    fixture.rawRespond({
      id: 2,
      sessionId: runtime.sessionId,
      appliedRevision: 0,
      pendingRevision: null,
      nextPart: 0,
      hits: [],
    });
    expect(runtime.appliedRevision).toBeNull();
    expect(fixture.postMessage).toHaveBeenCalledTimes(2);
    await expect(runtime.serializeCheckpoint()).rejects.toThrow('closed');
  });

  it('실행 중 요청이 멈추면 대기 요청도 거부하고 작업자를 종료한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const first = runtime.searchTop('first query', 10);
    const next = runtime.aggregate('next query', 10);
    const results = Promise.allSettled([first, next]);

    await vi.advanceTimersByTimeAsync(100);

    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(fixture.postMessage).toHaveBeenCalledTimes(1);
    expect(fixture.terminate).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it.each([135835, undefined])('실제 hydration ACK 0/128/256과 known 또는 unknown 전체량을 게시한다 (%s)', async (expected) => {
    const fixture = createFakeWorker();
    const observations: { processedDocuments: number; expectedDocuments: number | null }[] = [];
    const runtime = new BM25WorkerRuntime(fixture.create, 100, (progress) => { observations.push(progress); });
    const initialization = runtime.initialize('synthetic-progress', '', undefined, expected);
    fixture.respond({ id: 1, progress: { processedDocuments: 0 } });
    fixture.respond({ id: 1, progress: { processedDocuments: 128 } });
    fixture.respond({ id: 1, progress: { processedDocuments: 256 } });
    expect(observations).toEqual([0, 128, 256].map((processedDocuments) => ({ processedDocuments, expectedDocuments: expected ?? null })));
    fixture.respond({ id: 1 });
    await initialization;
    runtime.close();
  });

  it('hydration 관측자 예외는 ACK 정착이나 다음 요청을 막지 않는다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100, () => { throw new Error('observer'); });
    const initialization = runtime.initialize('synthetic-progress', '', undefined, 135835);
    fixture.respond({ id: 1, progress: { processedDocuments: 128 } });
    fixture.respond({ id: 1 });
    await initialization;
    const clear = runtime.clear(); fixture.respond({ id: 2 }); await clear;
    runtime.close();
  });

  it('문서 hydration 진행 신호가 오면 무응답 제한을 다시 계산한다', async () => {
    vi.useFakeTimers();
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create, 100);
    const initialization = runtime.initialize('large-test-db', '');

    await vi.advanceTimersByTimeAsync(75);
    fixture.respond({
      id: 1,
      progress: { processedDocuments: 128 },
    });
    await vi.advanceTimersByTimeAsync(75);
    fixture.respond({
      id: 1,
      ready: true,
      tokenizerCurrent: true,
      totalDocs: 256,
    });

    await expect(initialization).resolves.toEqual(
      expect.objectContaining({ ready: true, totalDocs: 256 }),
    );
    expect(fixture.terminate).not.toHaveBeenCalled();
  });

  it('검색 취소와 늦은 응답 뒤에도 다음 검색과 작업자를 보존한다', async () => {
    const fixture = createFakeWorker();
    const runtime = new BM25WorkerRuntime(fixture.create);
    const initialization = runtime.initialize('test-db', '');
    fixture.respond({ id: 1, ready: true, tokenizerCurrent: true, totalDocs: 1 });
    await initialization;
    const controller = new AbortController();
    const search = runtime.searchTop('slow query', 10, controller.signal);

    controller.abort();

    await expect(search).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.terminate).not.toHaveBeenCalled();
    fixture.respond({ id: 2, hits: [{ docId: 'late', sourcePath: 'late.md', score: 1 }] });
    const next = runtime.searchTop('next query', 10);
    fixture.respond({ id: 3, hits: [{ docId: 'next', sourcePath: 'next.md', score: 2 }] });
    await expect(next).resolves.toEqual([{ docId: 'next', sourcePath: 'next.md', score: 2 }]);
    runtime.close();
  });
});

function createFakeWorker(): {
  create: BM25WorkerFactory;
  respond(response: Partial<BM25WorkerResponse> & { id: number }): void;
  rawRespond(response: unknown): void;
  terminate: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  postMessage: Mock<(message: BM25WorkerRequest) => void>;
} {
  let onMessage: ((event: MessageEvent<BM25WorkerResponse>) => void) | null = null;
  const terminate = vi.fn();
  const dispose = vi.fn();
  const postMessage = vi.fn<(message: BM25WorkerRequest) => void>();
  let appliedRevision: number | null = null;
  let pendingRevision: number | null = null;
  let nextPart = 0;
  const worker: BM25WorkerAdapter = {
    postMessage,
    terminate,
    setOnMessage: (handler) => {
      onMessage = handler;
    },
    setOnError: vi.fn(),
  };
  return {
    create: () => ({ worker, dispose }),
    respond: (response) => {
      const request = postMessage.mock.calls.find(
        ([message]) => message.id === response.id,
      )?.[0] as BM25WorkerRequest;
      if (!response.progress) {
        if (response.error) {
          appliedRevision = null;
          pendingRevision = null;
          nextPart = 0;
        } else if (request.operation === 'initialize') {
          appliedRevision = 0;
          pendingRevision = null;
          nextPart = 0;
        } else if (
          ['rebuild', 'add', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(
            request.operation,
          )
        ) {
          if (request.finalPart) {
            appliedRevision = request.revision;
            pendingRevision = null;
            nextPart = 0;
          } else {
            pendingRevision = request.revision;
            nextPart = request.part + 1;
          }
        }
      }
      onMessage?.({
        data: {
          sessionId: request.sessionId,
          appliedRevision,
          pendingRevision,
          nextPart,
          ...response,
        },
      } as MessageEvent<BM25WorkerResponse>);
    },
    rawRespond: (response) => onMessage?.({ data: response } as MessageEvent<BM25WorkerResponse>),
    terminate,
    dispose,
    postMessage,
  };
}

interface NodeWorkerResponse {
  id: number;
  sessionId?: string | null;
  appliedRevision?: number | null;
  pendingRevision?: number | null;
  nextPart?: number;
  ready?: boolean;
  totalDocs?: number;
  snapshot?: string;
  snapshotRejected?: boolean;
  hits?: Array<{ docId: string; sourcePath: string; score: number }>;
  batchJson?: string;
  representativeHitsJson?: string;
  progress?: { processedDocuments: number };
  error?: string;
}

interface NodeWorkerFixture {
  dbName: string;
  documents: Array<Record<string, unknown>>;
}

function createNodeWorker(
  options: { persistedFixture?: boolean; legacyFixture?: NodeWorkerFixture; source?: string } = {},
): NodeWorker {
  const persistedSeed = options.persistedFixture
    ? `
      await new Promise((resolve, reject) => {
        const opened = indexedDB.open('persisted-worker-test', 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore('documents', { keyPath: 'id' });
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result;
          const transaction = db.transaction('documents', 'readwrite');
          for (let index = 0; index < 300; index++) transaction.objectStore('documents').put({ id: 'doc-' + index, text: index === 299 ? 'lastdocument' : 'ordinary document', sourcePath: 'a.md' });
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    `
    : '';
  const legacySeed = options.legacyFixture
    ? `
      await new Promise((resolve, reject) => {
        const opened = indexedDB.open(${JSON.stringify(options.legacyFixture.dbName)}, 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore('documents', { keyPath: 'id' });
        opened.onerror = () => reject(opened.error);
        opened.onsuccess = () => {
          const db = opened.result;
          const transaction = db.transaction('documents', 'readwrite');
          for (const document of ${JSON.stringify(options.legacyFixture.documents)}) transaction.objectStore('documents').put(document);
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    `
    : '';
  const bootstrap = `
    const { parentPort } = require('node:worker_threads');
    require('fake-indexeddb/auto');
    globalThis.self = {
      postMessage(message) {
        parentPort.postMessage(message);
      },
    };
    ${options.source ?? BM25_WORKER_SOURCE}
    const ready = (async () => {
      ${persistedSeed}
      ${legacySeed}
    })();
    parentPort.on('message', (data) => { void ready.then(() => globalThis.self.onmessage({ data })); });
  `;
  return new NodeWorker(bootstrap, { eval: true });
}

function createLegacySnapshotWithoutPosition(): string {
  const runtime = RustBm25RuntimeIndex.empty(2);
  if (!runtime) throw new Error('WASM 초기화 실패');
  try {
    runtime.addDocument('legacy::0', 'alpha beta', 'legacy.md', 2);
    const snapshot = JSON.parse(runtime.toJson()) as {
      docs: Array<Record<string, unknown>>;
      terms: Array<Record<string, unknown>>;
    };
    for (const document of snapshot.docs) delete document.runs;
    for (const term of snapshot.terms) delete term.pos;
    return JSON.stringify(snapshot);
  } finally {
    runtime.dispose();
  }
}

function waitForNodeWorkerResponse(worker: NodeWorker, id: number): Promise<NodeWorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: NodeWorkerResponse): void => {
      if (response.id !== id) return;
      if (response.progress) return;
      cleanup();
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
  });
}

function createNodeRuntime(
  worker: NodeWorker,
  receive?: (response: BM25WorkerResponse, deliver: () => void) => void,
): BM25WorkerRuntime {
  return new BM25WorkerRuntime(() => ({
    worker: {
      postMessage: (message) => worker.postMessage(message),
      terminate: () => {
        void worker.terminate();
      },
      setOnMessage: (handler) => {
        worker.on('message', (data: BM25WorkerResponse) => {
          const deliver = (): void => handler({ data } as MessageEvent<BM25WorkerResponse>);
          if (receive) receive(data, deliver);
          else deliver();
        });
      },
      setOnError: (handler) => {
        worker.on('error', (error) => handler({ message: error instanceof Error ? error.message : String(error) } as ErrorEvent));
      },
    },
    dispose: () => {},
  }));
}

const nodeProtocols = new WeakMap<NodeWorker, { sessionId: string; revision: number }>();
function postNodeRequest(
  worker: NodeWorker,
  request: Omit<BM25WorkerRequest, 'sessionId' | 'revision' | 'part' | 'finalPart'> &
    Partial<BM25WorkerRequest>,
): void {
  let protocol = nodeProtocols.get(worker);
  if (!protocol) {
    protocol = { sessionId: crypto.randomUUID(), revision: 0 };
    nodeProtocols.set(worker, protocol);
  }
  if (request.operation === 'initialize') protocol.revision = 0;
  else if (
    ['rebuild', 'add', 'replace-source', 'remove-doc', 'remove-source', 'clear'].includes(
      request.operation,
    )
  )
    protocol.revision = request.revision ?? protocol.revision + 1;
  worker.postMessage({
    sessionId: protocol.sessionId,
    revision: protocol.revision,
    part: 0,
    finalPart: true,
    ...request,
  });
}
