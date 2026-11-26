import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  acquireRuntimeLease,
  retireRuntime,
  leaseRagQueryEngine,
  RagGenerationManifest,
  RagRuntimeWorkBarrier,
  trackRagProviderOperations,
} from './runtime-generation';

const generation = (id: string) => ({
  id,
  namespace: 'idx-v5:1000:100',
  databases: {
    corpus: `vault:${id}:corpus`,
    bm25: `vault:${id}:bm25`,
    vector: `vault:${id}:vectors`,
    embeddingCache: 'vault:cache',
  },
  contract: {
    chunkSize: 1000,
    overlap: 100,
    tokenizer: 1,
    extractor: 5,
    embedding: 'model-a',
    bm25Enabled: true,
    vectorMode: 'disabled' as const,
  },
});
const receipt = () => ({ version: 1 as const, incarnation: crypto.randomUUID(), mutation: crypto.randomUUID() });
const proof = {
  seal: { version: 1 as const, corpus: receipt(),
    lexical: { state: 'enabled' as const, receipt: receipt(), applied: { sessionId: crypto.randomUUID(), revision: 0 } },
    vector: { state: 'disabled' as const },
  },
  corpusDurable: true,
  lexicalDurable: true,
  lexicalApplied: true,
  vectorDurable: true,
  pendingWrites: 0,
  targetsSettled: true,
  documentCount: 0,
  failures: [],
} as const;

describe('검색 세대 수명주기', () => {
  it('post-commit rollback은 active seal/ID/revision과 live guard를 확인하고 다음 building을 보존한다', async () => {
    const manifest = new RagGenerationManifest(`synthetic-rollback-${crypto.randomUUID()}`);
    try {
      await manifest.begin(0, generation('A'));
      await manifest.commit(1, 'A', proof);
      const previous = (await manifest.read()).active!;
      await manifest.begin(2, generation('B'));
      await manifest.commit(3, 'B', proof);
      await manifest.begin(4, generation('C'));
      for (const revision of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5]) {
        await expect(manifest.rollbackCommittedActive(revision, 'B', proof.seal, previous, () => true)).rejects.toThrow('rollback is invalid');
      }
      expect(await manifest.rollbackCommittedActive(6, 'B', proof.seal, previous, () => true)).toBeNull();
      expect(await manifest.rollbackCommittedActive(5, 'wrong-id', proof.seal, previous, () => true)).toBeNull();
      expect(await manifest.rollbackCommittedActive(5, 'B', { ...proof.seal, corpus: receipt() }, previous, () => true)).toBeNull();
      expect(await manifest.rollbackCommittedActive(5, 'B', proof.seal, previous, () => false)).toBeNull();
      expect((await manifest.read()).active?.id).toBe('B');
      expect(await manifest.rollbackCommittedActive(4, 'B', proof.seal, previous, () => true)).toBe(6);
      expect((await manifest.read()).active).toEqual(previous);
      expect((await manifest.read()).building?.id).toBe('C');
      await manifest.table('state').put({ ...(await manifest.read()), revision: Number.MAX_SAFE_INTEGER });
      await expect(manifest.rollbackCommittedActive(6, 'A', proof.seal, null, () => true)).rejects.toThrow('revision overflow');
      expect((await manifest.read()).active).toEqual(previous);
    } finally { await manifest.delete(); }
  });

  it('비동기 source release의 실제 정리까지 요청 결과를 완료하지 않는다', async () => {
    let finish = (): void => {};
    const cleanup = new Promise<void>((resolve) => { finish = resolve; });
    let complete = false;
    const { withRuntimeLease } = await import('./runtime-generation');
    const result = withRuntimeLease(() => cleanup, () => Promise.resolve('done')).then((value) => { complete = true; return value; });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    try { expect(complete).toBe(false); }
    finally { finish(); await result; }
    expect(await result).toBe('done');
  });

  it('읽기 snapshot은 writer admission·source event·close에서 무효화된다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    const first = barrier.captureReadSnapshot(); expect(first()).toBe(true);
    barrier.invalidate(); expect(first()).toBe(false);
    const second = barrier.captureReadSnapshot();
    const writing = barrier.run(() => Promise.resolve());
    expect(second()).toBe(false); await writing;
    const third = barrier.captureReadSnapshot(); expect(third()).toBe(true);
    barrier.close(); expect(third()).toBe(false);
  });

  it('source invalidation snapshot은 no-op writer와 독립이며 사건·close는 보존한다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    const source = barrier.captureInvalidationSnapshot();
    const read = barrier.captureReadSnapshot();
    await barrier.run(() => Promise.resolve());
    expect(source()).toBe(true);
    expect(read()).toBe(false);
    barrier.invalidate();
    expect(source()).toBe(false);
    const next = barrier.captureInvalidationSnapshot();
    barrier.invalidate();
    expect(next()).toBe(false);
    const last = barrier.captureInvalidationSnapshot();
    barrier.close();
    expect(last()).toBe(false);
  });

  it('writer barrier는 기존 병렬 쓰기 뒤 checkpoint를 배타 실행하고 이후 쓰기는 기다린다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    let finishCheckpoint!: () => void;
    const events: string[] = [];
    const a = barrier.run(async () => { events.push('a'); await new Promise<void>((resolve) => { finishFirst = resolve; }); });
    const b = barrier.run(async () => { events.push('b'); await new Promise<void>((resolve) => { finishSecond = resolve; }); });
    await vi.waitFor(() => expect(events).toEqual(['a', 'b']));
    const checkpoint = barrier.checkpoint(async (stable) => { events.push('checkpoint'); expect(stable()).toBe(true); await new Promise<void>((resolve) => { finishCheckpoint = resolve; }); expect(stable()).toBe(false); });
    finishFirst(); await a;
    expect(events).toEqual(['a', 'b']);
    finishSecond(); await b;
    await vi.waitFor(() => expect(events).toContain('checkpoint'));
    const late = barrier.run(() => { events.push('late'); return Promise.resolve(); });
    expect(events).not.toContain('late');
    finishCheckpoint(); await checkpoint; await late;
    expect(events).toEqual(['a', 'b', 'checkpoint', 'late']);
  });

  it('writer callback 이전의 source event도 checkpoint epoch를 무효화한다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    let finish!: () => void;
    const writing = barrier.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const checkpoint = barrier.checkpoint((stable) => { expect(stable()).toBe(false); return Promise.resolve(); });
    barrier.invalidate();
    finish(); await writing; await checkpoint;
  });

  it('writer 종료는 새 admission을 막되 실제 진행 작업과 queued 거절의 정착을 기다린다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    let finish!: () => void;
    const physical = barrier.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const checkpoint = barrier.checkpoint((stable) => { expect(stable()).toBe(false); return Promise.resolve(); });
    const queued = barrier.run(() => Promise.resolve());
    const rejected = expect(queued).rejects.toThrow('closed');
    barrier.close();
    await expect(barrier.run(() => Promise.resolve())).rejects.toThrow('closed');
    let idle = false;
    const draining = barrier.waitForIdle().then(() => { idle = true; });
    await Promise.resolve(); expect(idle).toBe(false);
    finish(); await physical; await checkpoint; await rejected; await draining;
    expect(idle).toBe(true);
  });

  it('실패한 writer/checkpoint가 다음 admission을 막거나 실패 정착을 숨기지 않는다', async () => {
    const barrier = new RagRuntimeWorkBarrier();
    const failed = barrier.run(() => Promise.reject(new Error('Synthetic writer failure.')));
    await expect(failed).rejects.toThrow('Synthetic writer failure.');
    await expect(barrier.checkpoint(() => Promise.reject(new Error('Synthetic checkpoint failure.')))).rejects.toThrow('Synthetic checkpoint failure.');
    await expect(barrier.run(() => Promise.resolve(42))).resolves.toBe(42);
    await barrier.waitForIdle();
  });

  it('새 commit은 count/boolean만의 proof를 거절하되 기존 manifest 읽기는 보존한다', async () => {
    const manifest = new RagGenerationManifest(`manifest-${crypto.randomUUID()}`);
    const legacy = { ...proof, seal: undefined };
    try {
      await manifest.begin(0, generation('A'));
      await expect(manifest.commit(1, 'A', legacy)).rejects.toThrow('durable completion proof');
      await manifest['state'].put({ key: 'generation', revision: 2, pausedByUser: false, building: null,
        active: { ...generation('legacy'), terminal: 'complete', proof: legacy } });
      expect((await manifest.read()).active?.proof?.seal).toBeUndefined();
      expect((await manifest.read()).active?.id).toBe('legacy');
    } finally { await manifest.delete(); }
  });

  it('active checkpoint 갱신은 revision/id/이전 seal 모두 CAS하고 building은 보존한다', async () => {
    const manifest = new RagGenerationManifest(`manifest-${crypto.randomUUID()}`);
    const next = { ...proof, seal: { ...proof.seal, corpus: receipt() }, untrustedDiagnostic: 'synthetic ignored diagnostic' };
    try {
      await manifest.begin(0, generation('A'));
      await manifest.commit(1, 'A', proof);
      await manifest.begin(2, generation('B'));
      expect(await manifest.refreshActive(3, 'A', proof.seal, next)).toBe(4);
      expect((await manifest.read()).building?.id).toBe('B');
      expect((await manifest.read()).active?.proof?.seal).toEqual(next.seal);
      expect((await manifest.read()).active?.proof).not.toHaveProperty('untrustedDiagnostic');
      expect(await manifest.refreshActive(3, 'A', next.seal, proof)).toBeNull();
      expect(await manifest.refreshActive(4, 'A', proof.seal, proof)).toBeNull();
      expect(await manifest.refreshActive(4, 'different', next.seal, proof)).toBeNull();
      await manifest.setPaused(4, true);
      expect(await manifest.refreshActive(5, 'A', next.seal, proof)).toBeNull();
    } finally { await manifest.delete(); }
  });

  it('새 seal은 저장소 UUID·현재 lexical ACK·명시 disabled 모드와 계약이 맞아야 한다', async () => {
    const manifest = new RagGenerationManifest(`manifest-${crypto.randomUUID()}`);
    try {
      await manifest.begin(0, generation('A'));
      await expect(manifest.commit(1, 'A', { ...proof, seal: { ...proof.seal, corpus: { ...proof.seal.corpus, mutation: 'invalid' } } })).rejects.toThrow('durable completion proof');
      await expect(manifest.commit(1, 'A', { ...proof, seal: { ...proof.seal, lexical: { state: 'disabled' } } })).rejects.toThrow('durable completion proof');
      await expect(manifest.commit(1, 'A', { ...proof, seal: { ...proof.seal, vector: { state: 'enabled', receipt: receipt() } } })).rejects.toThrow('durable completion proof');
      await expect(manifest.commit(1, 'A', { ...proof, failures: new Array<{ path: string; reason: string }>(1) })).rejects.toThrow('durable completion proof');
      expect((await manifest.read()).active).toBeNull();
    } finally { await manifest.delete(); }
  });

  it('소비자 취소가 끝나도 target의 물리 idle 전에 provider를 퇴역 완료하지 않는다', async () => {
    let finish!: () => void;
    const physical = new Promise<void>((resolve) => { finish = resolve; });
    const close = vi.fn();
    const waitForIdle = vi.fn(() => physical);
    const tracked = trackRagProviderOperations({ embed: () => Promise.reject(new DOMException('Synthetic cancelled consumer.', 'AbortError')), waitForIdle, close });
    await expect(tracked.provider.embed()).rejects.toMatchObject({ name: 'AbortError' });
    tracked.retire(close);
    expect(close).not.toHaveBeenCalled();
    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(() => tracked.provider.waitForIdle()).toThrow('retired');
    finish();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it.each(['throw', 'reject'] as const)('물리 idle의 %s 실패는 close 성공으로 숨기지 않고 오류 경계에 전달한다', async (kind) => {
    const close = vi.fn();
    const failed = vi.fn();
    const diagnostic = vi.fn();
    const tracked = trackRagProviderOperations({ waitForIdle: () => {
      if (kind === 'throw') throw new Error('Synthetic physical idle failure.');
      return Promise.reject(new Error('Synthetic physical idle failure.'));
    }, close }, diagnostic);
    tracked.retire(close, failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledOnce();
  });

  it.each(['embed', 'embedBatch', 'initialize'] as const)('실제 %s Promise의 늦은 정착 전 close를 막고 새 admission은 거절한다', async (method) => {
    let rejectOperation!: (error: Error) => void;
    const close = vi.fn();
    const provider = { embed: vi.fn<() => Promise<unknown>>(), embedBatch: vi.fn<() => Promise<unknown>>(), initialize: vi.fn<() => Promise<unknown>>(), close };
    provider[method].mockImplementation(() => new Promise((_resolve, reject) => { rejectOperation = reject; }));
    const tracked = trackRagProviderOperations(provider);
    const pending = tracked.provider[method]();
    // query deadline이 먼저 반환한 상황에서도 실제 provider promise는 남습니다.
    const settled = Promise.resolve(pending).catch(() => undefined);
    let closed = false;
    tracked.retire(() => { close(); closed = true; });
    expect(closed).toBe(false);
    expect(() => tracked.provider[method]()).toThrow('retired');
    rejectOperation(new Error('synthetic late rejection'));
    await settled;
    expect(close).toHaveBeenCalledOnce();
  });

  it('퇴역 handle은 마지막 검색이 끝나야 한 번 닫는다', () => {
    const runtime = {};
    const close = vi.fn();
    const first = acquireRuntimeLease(runtime);
    const second = acquireRuntimeLease(runtime);
    retireRuntime(runtime, close);
    first();
    first();
    expect(close).not.toHaveBeenCalled();
    second();
    second();
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => acquireRuntimeLease(runtime)).toThrow();
  });

  it('cutover 뒤에도 기존 요청의 하위 질의는 가능하고 timeout 뒤 실제 질의 종료까지 닫지 않는다', async () => {
    const { RAGQueryEngine } = await import('./query');
    const engine = new RAGQueryEngine(null, null);
    let finish = (): void => undefined;
    vi.spyOn(engine, 'query').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve([]);
        }),
    );
    const release = acquireRuntimeLease(engine);
    const requestEngine = leaseRagQueryEngine(engine);
    const close = vi.fn();
    retireRuntime(engine, close);
    const pending = requestEngine.query('synthetic');
    release();
    expect(close).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(close).toHaveBeenCalledOnce();
  });

  it('무모델 임시 엔진의 실제 질의도 serving owner의 종료를 지연한다', async () => {
    const { RAGQueryEngine } = await import('./query');
    const owner = {};
    const engine = new RAGQueryEngine(null, null);
    let finish = (): void => undefined;
    vi.spyOn(engine, 'query').mockImplementation(() => new Promise((resolve) => { finish = () => resolve([]); }));
    const release = acquireRuntimeLease(owner);
    const requestEngine = leaseRagQueryEngine(engine, owner);
    const pending = requestEngine.query('synthetic');
    const close = vi.fn();
    retireRuntime(owner, close);
    release();
    try { expect(close).not.toHaveBeenCalled(); }
    finally { finish(); await pending; }
    expect(close).toHaveBeenCalledOnce();
  });

  it('literal 열기·페이지 handle 정리의 실제 종료까지 serving owner를 유지한다', async () => {
    let finishOpen = (): void => {}, finishCleanup = (): void => {};
    const cleaned = new Promise<void>((resolve) => { finishCleanup = resolve; });
    const base = { getSummary: vi.fn(), readPage: vi.fn(), close: vi.fn(() => cleaned) };
    const engine = { openLiteralInventory: () => new Promise<typeof base>((resolve) => { finishOpen = () => resolve(base); }) } as unknown as import('./query').RAGQueryEngine;
    const owner = {};
    const release = acquireRuntimeLease(owner);
    const request = leaseRagQueryEngine(engine, owner);
    const opening = request.openLiteralInventory(['needle']);
    const close = vi.fn(); retireRuntime(owner, close); release();
    try {
      expect(close).not.toHaveBeenCalled();
      finishOpen(); const handle = await opening;
      expect(close).not.toHaveBeenCalled();
      const cleanup = handle.close(); expect(close).not.toHaveBeenCalled();
      finishCleanup(); await cleanup;
      expect(close).toHaveBeenCalledOnce();
      await handle.close(); expect(base.close).toHaveBeenCalledOnce();
    } finally { finishOpen(); finishCleanup(); await opening.then((handle) => handle.close()); }
  });

  it('실패한 literal 열기도 실패 Promise 정착 전에 owner를 닫지 않는다', async () => {
    let fail = (): void => {};
    const engine = { openLiteralInventory: () => new Promise<never>((_, reject) => { fail = () => reject(new Error('synthetic literal failure')); }) } as unknown as import('./query').RAGQueryEngine;
    const owner = {}, close = vi.fn();
    const release = acquireRuntimeLease(owner);
    const opening = leaseRagQueryEngine(engine, owner).openLiteralInventory(['needle']).catch((error: unknown) => error);
    retireRuntime(owner, close); release();
    try { expect(close).not.toHaveBeenCalled(); }
    finally { fail(); await opening; }
    expect(close).toHaveBeenCalledOnce();
  });

  it('동일 revision의 늦은 B는 C의 소유권을 빼앗거나 승격할 수 없다', async () => {
    const manifest = new RagGenerationManifest(`manifest-${crypto.randomUUID()}`);
    try {
      const b = await manifest.begin(0, generation('B'));
      expect(b).toBe(1);
      expect(await manifest.begin(0, generation('late-B'))).toBeNull();
      expect(await manifest.begin(1, generation('C'))).toBe(2);
      expect(await manifest.commit(1, 'B', proof)).toBeNull();
      expect(await manifest.commit(2, 'C', proof)).toBe(3);
      expect((await manifest.read()).active?.id).toBe('C');
    } finally {
      manifest.close();
    }
  });

  it('포인터 전 crash는 이전 active, 포인터 후 재개는 새 완료 0문서 세대를 보존한다', async () => {
    const name = `manifest-${crypto.randomUUID()}`;
    let manifest = new RagGenerationManifest(name);
    await manifest.begin(0, generation('A'));
    await manifest.commit(1, 'A', proof);
    await manifest.begin(2, generation('B'));
    manifest.close();
    manifest = new RagGenerationManifest(name);
    expect((await manifest.read()).active?.id).toBe('A');
    await manifest.commit(3, 'B', proof);
    manifest.close();
    manifest = new RagGenerationManifest(name);
    expect((await manifest.read()).active).toMatchObject({
      id: 'B',
      terminal: 'complete',
      proof: { documentCount: 0 },
    });
    manifest.close();
  });

  it('미완료 저장 증거는 거부하고 종료된 실패 원장은 partial로 보존한다', async () => {
    const manifest = new RagGenerationManifest(`manifest-${crypto.randomUUID()}`);
    try {
      await manifest.begin(0, generation('A'));
      await expect(manifest.commit(1, 'A', { ...proof, lexicalApplied: false })).rejects.toThrow();
      await manifest.commit(1, 'A', {
        ...proof,
        failures: [{ path: 'synthetic.md', reason: 'read-failed' }],
      });
      expect((await manifest.read()).active?.terminal).toBe('partial');
    } finally {
      manifest.close();
    }
  });

  it('사용자 중단은 새 연결에서도 유지되고 active를 바꾸지 않는다', async () => {
    const name = `manifest-${crypto.randomUUID()}`;
    let manifest = new RagGenerationManifest(name);
    await manifest.begin(0, generation('A'));
    await manifest.commit(1, 'A', proof);
    await manifest.begin(2, generation('B'));
    await manifest.stop(3, 'B', 'cancelled', true);
    manifest.close();
    manifest = new RagGenerationManifest(name);
    expect(await manifest.read()).toMatchObject({
      pausedByUser: true,
      active: { id: 'A' },
      building: { id: 'B', terminal: 'cancelled' },
    });
    manifest.close();
  });
});

describe('조회 admission', () => {
  it('조회는 epoch를 보존하고 checkpoint와 물리 drain에 참여한다', async () => {
    const io = new RagRuntimeWorkBarrier();
    const current = io.captureReadSnapshot();
    let finish!: () => void;
    const reading = io.runRead(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    let checkpoint = false;
    const checking = io.checkpoint(() => { checkpoint = true; return Promise.resolve(); });
    let drained = false;
    const drain = io.waitForIdle().then(() => { drained = true; });
    await Promise.resolve();
    expect(current()).toBe(true);
    expect(checkpoint).toBe(false);
    expect(drained).toBe(false);
    finish();
    await Promise.all([reading, checking, drain]);
    expect(checkpoint).toBe(true);
    io.close();
    await expect(io.runRead(() => Promise.resolve())).rejects.toThrow('closed');
  });
});

it('동일 proof의 CAS 확인은 성공해도 manifest revision을 늘리지 않는다', async () => {
  const manifest = new RagGenerationManifest(`synthetic-noop-${crypto.randomUUID()}`);
  try {
    await manifest.begin(0, generation('same'));
    await manifest.commit(1, 'same', proof);
    expect(await manifest.refreshActive(2, 'same', proof.seal, proof)).toBe(2);
    expect(await manifest.refreshActive(1, 'same', proof.seal, proof)).toBeNull();
    expect((await manifest.read()).revision).toBe(2);
  } finally { await manifest.delete(); }
});

it('checkpoint 뒤 조회는 gate를 기다리며 대기 중 close는 실행과 늦은 성공을 막는다', async () => {
  const io = new RagRuntimeWorkBarrier();
  let finish!: () => void;
  const checkpoint = io.checkpoint(() => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  const read = vi.fn(() => Promise.resolve());
  const pending = io.runRead(read);
  const rejected = expect(pending).rejects.toThrow('closed');
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  io.close();
  finish();
  await Promise.all([checkpoint, rejected, io.waitForIdle()]);
  expect(read).not.toHaveBeenCalled();
});
