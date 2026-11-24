import type { Table } from 'dexie';
import { isStoreMutationReceipt, type StoreMutationReceipt } from './durability';
import type { RAGQueryEngine } from './query';
import type { RagIndexingSchedulerStatus } from './indexing-scheduler';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';

export interface RagGenerationDescriptor {
  id: string;
  namespace: string;
  databases: { corpus: string; bm25: string; vector: string; embeddingCache: string };
  contract: {
    chunkSize: number;
    overlap: number;
    tokenizer: number;
    extractor: number;
    embedding: string;
    embeddingBinding?: string;
    bm25Enabled: boolean;
    vectorMode?: 'disabled' | 'indexeddb' | 'memory';
  };
}

export interface RagDurabilitySeal {
  version: 1;
  corpus: StoreMutationReceipt;
  lexical: { state: 'disabled' } | { state: 'enabled'; receipt: StoreMutationReceipt; applied: { sessionId: string; revision: number } };
  vector: { state: 'disabled' | 'ephemeral' } | { state: 'enabled'; receipt: StoreMutationReceipt };
}

/** 서로 다른 DB의 transaction이라고 주장하지 않고 각 저장 경계의 확인 결과만 기록합니다. */
export interface RagGenerationProof {
  seal?: RagDurabilitySeal;
  corpusDurable: boolean;
  lexicalDurable: boolean;
  lexicalApplied: boolean;
  vectorDurable: boolean;
  pendingWrites: number;
  targetsSettled: boolean;
  documentCount: number;
  failures: readonly { path: string; reason: string }[];
}

export type RagGenerationTerminal = 'building' | 'complete' | 'partial' | 'cancelled' | 'failed';
export interface RagGenerationRecord extends RagGenerationDescriptor {
  terminal: RagGenerationTerminal;
  proof?: RagGenerationProof;
}
export interface RagGenerationState {
  key: 'generation';
  revision: number;
  pausedByUser: boolean;
  active: RagGenerationRecord | null;
  building: RagGenerationRecord | null;
}

export interface RagGenerationSnapshot {
  revision: number;
  serving: RagGenerationRecord | null;
  availability: 'none' | 'restoring' | 'usable' | 'failed';
  coverage: 'complete' | 'partial' | 'legacy-limited' | null;
  semanticAvailable: boolean;
  building: {
    generation: RagGenerationRecord | null;
    status: RagGenerationTerminal | 'paused';
    indexing: RagIndexingSchedulerStatus | null;
  } | null;
}

/** 병렬 writer는 유지하고 checkpoint 동안만 이후 admission을 대기시킵니다. */
export class RagRuntimeWorkBarrier {
  private gate: Promise<void> = Promise.resolve();
  private readonly pending = new Set<Promise<unknown>>();
  private epoch = 0;
  private closed = false;

  invalidate(): void { this.epoch++; }

  captureReadSnapshot(): () => boolean {
    const epoch = this.epoch;
    return () => !this.closed && this.epoch === epoch;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('RAG runtime writer is closed'));
    this.epoch++;
    const task = this.gate.then(() => {
      if (this.closed) throw new Error('RAG runtime writer is closed');
      return operation();
    });
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  checkpoint<T>(operation: (stable: () => boolean) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('RAG runtime writer is closed'));
    const epoch = this.epoch;
    const pending = [...this.pending];
    const task = this.gate.then(async () => {
      await Promise.allSettled(pending);
      return operation(() => !this.closed && this.epoch === epoch);
    });
    this.gate = task.then(() => undefined, () => undefined);
    return task;
  }

  close(): void { this.closed = true; }

  async waitForIdle(): Promise<void> {
    for (;;) {
      const gate = this.gate;
      await gate;
      await Promise.allSettled([...this.pending]);
      if (gate === this.gate && this.pending.size === 0) return;
    }
  }
}

const emptyState = (): RagGenerationState => ({
  key: 'generation',
  revision: 0,
  pausedByUser: false,
  active: null,
  building: null,
});

/** vault 전용 DB 하나에서만 소유권 CAS와 active 포인터를 원자적으로 바꿉니다. */
export class RagGenerationManifest extends GeneratedArtifactDatabase {
  private readonly state: Table<RagGenerationState, string>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({ state: '&key' });
    this.state = this.table('state');
  }

  async read(): Promise<RagGenerationState> {
    const state = await this.state.get('generation');
    if (!state) return emptyState();
    if (!validState(state)) throw new Error('Invalid RAG generation manifest');
    return state;
  }

  begin(revision: number, generation: RagGenerationDescriptor): Promise<number | null> {
    if (!validDescriptor(generation)) throw new Error('Invalid RAG generation descriptor');
    const { id, namespace, databases, contract } = generation;
    const descriptor: RagGenerationDescriptor = {
      id,
      namespace,
      databases: {
        corpus: databases.corpus,
        bm25: databases.bm25,
        vector: databases.vector,
        embeddingCache: databases.embeddingCache,
      },
      contract: {
        chunkSize: contract.chunkSize,
        overlap: contract.overlap,
        tokenizer: contract.tokenizer,
        extractor: contract.extractor,
        embedding: contract.embedding,
        ...(contract.embeddingBinding ? { embeddingBinding: contract.embeddingBinding } : {}),
        bm25Enabled: contract.bm25Enabled,
        ...(contract.vectorMode === undefined ? {} : { vectorMode: contract.vectorMode }),
      },
    };
    return this.change(revision, (state) => ({
      ...state,
      building: { ...descriptor, terminal: 'building' },
    }));
  }

  commit(revision: number, id: string, proof: RagGenerationProof): Promise<number | null> {
    if (
      !validProof(proof) || !proof.seal ||
      !proof.corpusDurable ||
      !proof.lexicalDurable ||
      !proof.lexicalApplied ||
      !proof.vectorDurable ||
      proof.pendingWrites !== 0 ||
      !proof.targetsSettled
    ) {
      return Promise.reject(new Error('RAG generation has no durable completion proof'));
    }
    return this.change(revision, (state) => {
      if (state.building?.id !== id || state.building.terminal !== 'building' || state.pausedByUser)
        return null;
      if (!proof.seal || !sealMatchesContract(proof.seal, state.building.contract)) throw new Error('RAG generation has no durable completion proof');
      const active: RagGenerationRecord = {
        ...state.building,
        terminal: proof.failures.length > 0 ? 'partial' : 'complete',
        proof: copyGenerationProof(proof),
      };
      return { ...state, active, building: null };
    });
  }

  refreshActive(revision: number, id: string, previous: RagDurabilitySeal | null, proof: RagGenerationProof): Promise<number | null> {
    if (!validProof(proof) || !proof.seal || !proof.corpusDurable || !proof.lexicalDurable || !proof.lexicalApplied ||
        !proof.vectorDurable || proof.pendingWrites !== 0 || !proof.targetsSettled) {
      return Promise.reject(new Error('RAG generation has no durable completion proof'));
    }
    return this.change(revision, (state) => {
      if (state.active?.id !== id || state.pausedByUser || !sameRagDurabilitySeal(state.active.proof?.seal ?? null, previous)) return null;
      if (!proof.seal || !sealMatchesContract(proof.seal, state.active.contract)) throw new Error('RAG generation has no durable completion proof');
      return { ...state, active: { ...state.active, terminal: proof.failures.length ? 'partial' : 'complete', proof: copyGenerationProof(proof) } };
    });
  }

  rollbackCommittedActive(
    revision: number,
    id: string,
    seal: RagDurabilitySeal,
    previous: RagGenerationRecord | null,
    admit: () => boolean,
  ): Promise<number | null> {
    const prior = previous ? structuredClone(previous) : null;
    if (!Number.isSafeInteger(revision) || revision < 0 || typeof admit !== 'function' || !isRagDurabilitySeal(seal) || (prior && (!validDescriptor(prior) || (prior.proof && !validProof(prior.proof)) ||
        (prior.terminal !== 'complete' && prior.terminal !== 'partial')))) {
      return Promise.reject(new Error('RAG generation rollback is invalid'));
    }
    return this.transaction('rw', this.state, async () => {
      const state = await this.read();
      if (state.revision < revision || state.active?.id !== id || !sameRagDurabilitySeal(state.active.proof?.seal ?? null, seal) || !admit()) return null;
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('RAG generation revision overflow');
      const next = { ...state, revision: state.revision + 1, active: prior };
      await this.state.put(next);
      return next.revision;
    });
  }

  stop(
    revision: number,
    id: string,
    terminal: 'cancelled' | 'failed',
    pausedByUser = false,
  ): Promise<number | null> {
    return this.change(revision, (state) =>
      state.building?.id === id
        ? {
            ...state,
            pausedByUser: state.pausedByUser || pausedByUser,
            building: { ...state.building, terminal },
          }
        : null,
    );
  }

  setPaused(revision: number, pausedByUser: boolean): Promise<number | null> {
    return this.change(revision, (state) => ({ ...state, pausedByUser }));
  }

  private change(
    revision: number,
    update: (state: RagGenerationState) => RagGenerationState | null,
  ): Promise<number | null> {
    return this.transaction('rw', this.state, async () => {
      const current = await this.read();
      if (current.revision !== revision) return null;
      const next = update(current);
      if (!next) return null;
      next.revision = revision + 1;
      await this.state.put(next);
      return next.revision;
    });
  }
}

function copyGenerationProof(proof: RagGenerationProof): RagGenerationProof {
  return {
    ...(proof.seal ? { seal: structuredClone(proof.seal) } : {}),
    corpusDurable: proof.corpusDurable, lexicalDurable: proof.lexicalDurable,
    lexicalApplied: proof.lexicalApplied, vectorDurable: proof.vectorDurable,
    pendingWrites: proof.pendingWrites, targetsSettled: proof.targetsSettled,
    documentCount: proof.documentCount,
    failures: proof.failures.map(({ path, reason }) => ({ path, reason })),
  };
}

function validDescriptor(value: RagGenerationDescriptor): boolean {
  return (
    typeof value?.id === 'string' &&
    value.id.length > 0 &&
    typeof value.namespace === 'string' &&
    !!value.databases &&
    ['corpus', 'bm25', 'vector', 'embeddingCache'].every(
      (key) => typeof value.databases[key as keyof typeof value.databases] === 'string',
    ) &&
    !!value.contract &&
    Number.isSafeInteger(value.contract.chunkSize) &&
    value.contract.chunkSize > 0 &&
    Number.isSafeInteger(value.contract.overlap) &&
    value.contract.overlap >= 0 &&
    Number.isSafeInteger(value.contract.tokenizer) &&
    Number.isSafeInteger(value.contract.extractor) &&
    typeof value.contract.embedding === 'string' &&
    (value.contract.embeddingBinding === undefined || /^[0-9a-f-]{36}$/i.test(value.contract.embeddingBinding)) &&
    typeof value.contract.bm25Enabled === 'boolean' &&
    (value.contract.vectorMode === undefined || ['disabled', 'indexeddb', 'memory'].includes(value.contract.vectorMode))
  );
}

export function isRagDurabilitySeal(value: unknown): value is RagDurabilitySeal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const seal = value as Record<string, unknown>;
  if (Object.keys(seal).length !== 4 || seal.version !== 1 || !isStoreMutationReceipt(seal.corpus)) return false;
  if (!seal.lexical || typeof seal.lexical !== 'object' || Array.isArray(seal.lexical) || !seal.vector || typeof seal.vector !== 'object' || Array.isArray(seal.vector)) return false;
  const lexical = seal.lexical as Record<string, unknown>;
  const vector = seal.vector as Record<string, unknown>;
  if (lexical.state === 'disabled') { if (Object.keys(lexical).length !== 1) return false; }
  else if (lexical.state === 'enabled') {
    if (Object.keys(lexical).length !== 3 || !isStoreMutationReceipt(lexical.receipt) || !lexical.applied || typeof lexical.applied !== 'object' || Array.isArray(lexical.applied)) return false;
    const applied = lexical.applied as Record<string, unknown>;
    if (Object.keys(applied).length !== 2 || typeof applied.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(applied.sessionId) || typeof applied.revision !== 'number' || !Number.isSafeInteger(applied.revision) || applied.revision < 0) return false;
  } else return false;
  return vector.state === 'enabled' ? Object.keys(vector).length === 2 && isStoreMutationReceipt(vector.receipt) :
    (vector.state === 'disabled' || vector.state === 'ephemeral') && Object.keys(vector).length === 1;
}

export function sameRagDurabilitySeal(left: RagDurabilitySeal | null, right: RagDurabilitySeal | null): boolean {
  if (!left || !right) return left === right;
  const same = (a: StoreMutationReceipt, b: StoreMutationReceipt): boolean => a.incarnation === b.incarnation && a.mutation === b.mutation;
  if (!same(left.corpus, right.corpus) || left.lexical.state !== right.lexical.state || left.vector.state !== right.vector.state) return false;
  if (left.lexical.state === 'enabled' && (right.lexical.state !== 'enabled' || !same(left.lexical.receipt, right.lexical.receipt) || left.lexical.applied.sessionId !== right.lexical.applied.sessionId || left.lexical.applied.revision !== right.lexical.applied.revision)) return false;
  return left.vector.state !== 'enabled' || (right.vector.state === 'enabled' && same(left.vector.receipt, right.vector.receipt));
}

function sealMatchesContract(seal: RagDurabilitySeal, contract: RagGenerationDescriptor['contract']): boolean {
  return (seal.lexical.state === 'enabled') === contract.bm25Enabled &&
    (contract.vectorMode === 'disabled' ? seal.vector.state === 'disabled' : contract.vectorMode === 'memory' ? seal.vector.state === 'ephemeral' : contract.vectorMode === 'indexeddb' && seal.vector.state === 'enabled');
}

function validProof(value: RagGenerationProof): boolean {
  return (
    !!value && (value.seal === undefined || isRagDurabilitySeal(value.seal)) &&
    ['corpusDurable', 'lexicalDurable', 'lexicalApplied', 'vectorDurable', 'targetsSettled'].every(
      (key) => typeof value[key as keyof RagGenerationProof] === 'boolean',
    ) &&
    Number.isSafeInteger(value.pendingWrites) &&
    value.pendingWrites >= 0 &&
    Number.isSafeInteger(value.documentCount) &&
    value.documentCount >= 0 &&
    validFailureLedger(value.failures)
  );
}

function validFailureLedger(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const failures: unknown[] = value;
  for (const failure of failures) {
    if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return false;
    const row = failure as { path?: unknown; reason?: unknown };
    if (typeof row.path !== 'string' || typeof row.reason !== 'string') return false;
  }
  return true;
}

function validState(value: RagGenerationState): boolean {
  const validRecord = (record: RagGenerationRecord | null, active: boolean): boolean =>
    record === null ||
    (validDescriptor(record) &&
      ['building', 'complete', 'partial', 'cancelled', 'failed'].includes(record.terminal) &&
      (!active ||
        ((record.terminal === 'complete' || record.terminal === 'partial') &&
          !!record.proof &&
          validProof(record.proof) &&
          (record.proof.seal === undefined || sealMatchesContract(record.proof.seal, record.contract)) &&
          record.proof.corpusDurable &&
          record.proof.lexicalDurable &&
          record.proof.lexicalApplied &&
          record.proof.vectorDurable &&
          record.proof.targetsSettled &&
          record.proof.pendingWrites === 0)));
  return (
    !!value &&
    value.key === 'generation' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    typeof value.pausedByUser === 'boolean' &&
    validRecord(value.active, true) &&
    validRecord(value.building, false)
  );
}

interface RuntimeLeaseState {
  count: number;
  retired: boolean;
  close?: () => void;
}
const runtimeLeases = new WeakMap<object, RuntimeLeaseState>();

/** 한 요청의 corpus·engine·config가 끝날 때까지 같은 handle을 보존합니다. */
export function acquireRuntimeLease(runtime: object): () => void {
  return retainRuntimeLease(runtime, false);
}

function retainRuntimeLease(runtime: object, inFlight: boolean): () => void {
  const state = runtimeLeases.get(runtime) ?? { count: 0, retired: false };
  if (state.retired && (!inFlight || state.count === 0)) throw new Error('RAG runtime is retired');
  runtimeLeases.set(runtime, state);
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count--;
    if (state.count === 0 && state.retired) {
      const close = state.close;
      state.close = undefined;
      close?.();
    }
  };
}

export function retireRuntime(runtime: object, close: () => void): void {
  const state = runtimeLeases.get(runtime) ?? { count: 0, retired: false };
  if (state.retired) return;
  state.retired = true;
  runtimeLeases.set(runtime, state);
  if (state.count === 0) close();
  else state.close = close;
}

/** 호출자가 timeout으로 먼저 반환해도 시작된 engine 질의 Promise가 종료될 때까지 보호합니다. */
export function leaseRagQueryEngine(engine: RAGQueryEngine, owner: object = engine): RAGQueryEngine {
  const query = (
    ...args: Parameters<RAGQueryEngine['query']>
  ): ReturnType<RAGQueryEngine['query']> => {
    const release = retainRuntimeLease(owner, true);
    return engine.query(...args).finally(release);
  };
  const openLiteralInventory = (
    ...args: Parameters<RAGQueryEngine['openLiteralInventory']>
  ): ReturnType<RAGQueryEngine['openLiteralInventory']> => {
    const release = retainRuntimeLease(owner, true);
    try {
      return engine.openLiteralInventory(...args).then((handle) => {
        let closing: Promise<void> | null = null;
        return {
          getSummary: () => handle.getSummary(),
          readPage: (index: number) => handle.readPage(index),
          close: () => closing ??= Promise.resolve().then(() => handle.close()).finally(release),
        };
      }, (error: unknown) => { release(); throw error; });
    } catch (error) { release(); throw error; }
  };
  return new Proxy(engine, {
    get(target, property) {
      if (property === 'query') return query;
      if (property === 'openLiteralInventory') return openLiteralInventory;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
        : value;
    },
  });
}

/** 호출 결과 사용(현재 원문 검증 포함)이 끝난 뒤에만 lease를 해제합니다. */
export async function withRuntimeLease<T>(
  release: (() => void | Promise<void>) | undefined,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } finally {
    await release?.();
  }
}

/** deadline 밖의 실제 embedding/cache 메서드 정착을 추적하는 세대 전용 경계입니다. */
export function trackRagProviderOperations<T extends object>(provider: T, onDrainError: () => void = () => undefined): {
  provider: T;
  retire: (close: () => void, failed?: () => void) => void;
} {
  let pending = 0;
  let retired = false;
  let retirementRequested = false;
  let onDrained: (() => void) | undefined;
  let closeProvider: (() => void) | undefined;
  let providerClosed = false;
  const physicalIdle: unknown = Reflect.get(provider, 'waitForIdle', provider);
  let physicalDrained = typeof physicalIdle !== 'function';
  let physicalDrainStarted = false;
  let failed = false;
  let onFailed: (() => void) | undefined;
  const fail = (): void => {
    if (!failed) {
      failed = true;
      try { onDrainError(); } catch { /* 오류 고지가 종료 실패 상태를 지우지 않습니다. */ }
    }
    const notify = onFailed;
    onFailed = undefined;
    try { notify?.(); } catch { /* 실패 고지에서 미처리 rejection을 만들지 않습니다. */ }
  };
  const drain = (): void => {
    if (pending !== 0 || !retired || failed) return;
    if (!physicalDrained) {
      if (typeof physicalIdle !== 'function') { fail(); return; }
      if (physicalDrainStarted) return;
      physicalDrainStarted = true;
      try {
        // 퇴역 proxy가 아니라 원래 target의 물리 작업·cache 정착을 기다립니다.
        const operation: unknown = Reflect.apply(physicalIdle, provider, []);
        if (!operation || typeof operation !== 'object' || !('then' in operation) || typeof operation.then !== 'function') { fail(); return; }
        void Promise.resolve(operation).then(() => { physicalDrained = true; drain(); }, fail);
      } catch { fail(); }
      return;
    }
    const close = onDrained;
    onDrained = undefined;
    if (close) { try { close(); } catch { fail(); return; } }
    if (closeProvider && !providerClosed) {
      providerClosed = true;
      try { closeProvider(); } catch { fail(); }
    }
  };
  const settle = (): void => { pending--; drain(); };
  return {
    provider: new Proxy(provider, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (property === 'close') return (): void => {
          retired = true;
          if (providerClosed) return;
          closeProvider = () => { Reflect.apply(value, target, []); };
          if (pending === 0 && physicalDrained) {
            providerClosed = true;
            closeProvider();
          } else drain();
        };
        return (...args: unknown[]): unknown => {
          if (retired) throw new Error('RAG provider is retired');
          pending++;
          let result: unknown;
          try { result = Reflect.apply(value, target, args); }
          catch (error) { settle(); throw error; }
          if (result instanceof Promise || (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function')) {
            // 양쪽 handler를 붙이고 파생 rejection을 만들지 않아 늦은 실패도 관찰합니다.
            void Promise.resolve(result).then(settle, settle);
          } else settle();
          return result;
        };
      },
    }),
    retire(close, failedCallback) {
      if (retirementRequested) return;
      retirementRequested = true;
      retired = true;
      onDrained = close;
      onFailed = failedCallback;
      if (failed) fail();
      else drain();
    },
  };
}
