import Dexie from 'dexie';
import { isStoreMutationReceipt, readStoreMutationReceipt, stampStoreMutation, type DurabilityMetaRecord, type StoreMutationReceipt } from './durability';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';
import type { CachedMetadata, DataAdapter, TFile } from 'obsidian';
import type { ScopedLogger } from '../utils/logger';
import { planStaleIndexSourcePathsRust, parseBm25MatchAggregateJson, RustBm25RuntimeIndex, tokenizeRust } from './rust-core';
import type { RustBm25MatchAggregate } from './rust-core';
import { TOKENIZER_VERSION } from './tokenizer-version';
import {
  BM25WorkerRuntime,
  canUseBM25Worker,
  type BM25WorkerFactory,
  type BM25WorkerHit,
} from './bm25-worker-runtime';

export interface BM25DocumentInput {
  id: string;
  text: string;
  sourcePath?: string;
  title?: string;
  headings?: string[];
  tags?: string[];
  aliases?: string[];
  heading?: string;
  startLine?: number;
  endLine?: number;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
}

export interface BM25CorpusDocument extends BM25DocumentInput {
  sourcePath: string;
}

export interface BM25BatchSearchHit {
  docId: string;
  sourcePath: string;
  score: number;
  rank: number;
}

export interface BM25BatchResult {
  queries: readonly { hits: readonly BM25BatchSearchHit[] }[];
  aggregates: readonly RustBm25MatchAggregate[];
}

/** frontmatter 별칭은 문자열 또는 문자열 배열로 올 수 있습니다. */
function frontmatterAliases(value: unknown): string[] {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return raw
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

/** 원문을 다시 파싱하지 않고 기존 파일·캐시·청크의 필드를 전달합니다. */
export function getBM25DocumentFields(
  file: TFile,
  metadata?: CachedMetadata | null,
  heading?: string,
) {
  const title: unknown = metadata?.frontmatter?.title;
  const frontmatterTags: unknown = metadata?.frontmatter?.tags;
  return {
    title: typeof title === 'string' ? title : file.basename,
    headings: metadata?.headings?.map((item) => item.heading) ?? (heading ? [heading] : []),
    tags: [
      ...(metadata?.tags?.map((item) => item.tag) ?? []),
      ...(typeof frontmatterTags === 'string'
        ? [frontmatterTags]
        : Array.isArray(frontmatterTags)
          ? frontmatterTags.filter((tag): tag is string => typeof tag === 'string')
          : []),
    ],
    aliases: frontmatterAliases(metadata?.frontmatter?.aliases),
  };
}

export function tokenize(text: string): string[] {
  const rustTokens = tokenizeRust(text);
  return rustTokens ?? [];
}

function parseBm25RepresentativeHits(hits: unknown): BM25BatchSearchHit[] | null {
  if (!Array.isArray(hits)) return null;
  const parsedHits: BM25BatchSearchHit[] = [];
  for (const hit of hits) {
    if (typeof hit !== 'object' || hit === null || Array.isArray(hit)) return null;
    const row = hit as Record<string, unknown>;
    if (
      typeof row.docId !== 'string' ||
      typeof row.sourcePath !== 'string' ||
      typeof row.score !== 'number' ||
      !Number.isFinite(row.score) ||
      !Number.isSafeInteger(row.rank) ||
      (row.rank as number) <= 0
    ) {
      return null;
    }
    parsedHits.push({
      docId: row.docId,
      sourcePath: row.sourcePath,
      score: row.score,
      rank: row.rank as number,
    });
  }
  return parsedHits;
}

/** worker batch 응답의 wire 형식을 검증하고 실패하면 null을 돌려줍니다. */
function parseBm25BatchJson(raw: string): BM25BatchResult | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.queries) || !Array.isArray(record.aggregates)) return null;
    const queries: { hits: BM25BatchSearchHit[] }[] = [];
    for (const item of record.queries) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const hits = parseBm25RepresentativeHits((item as Record<string, unknown>).hits);
      if (!hits) return null;
      queries.push({ hits });
    }
    const aggregates: RustBm25MatchAggregate[] = [];
    for (const item of record.aggregates) {
      const aggregate = parseBm25MatchAggregateJson(JSON.stringify(item));
      if (!aggregate) return null;
      aggregates.push(aggregate);
    }
    return { queries, aggregates };
  } catch {
    return null;
  }
}

const BM25_SNAPSHOT_KEY = 'bm25-runtime-snapshot:v1';
const BM25_SNAPSHOT_MANIFEST_KEY = 'bm25-snapshot-manifest:v1';
const BM25_REBUILD_YIELD_INTERVAL = 128;
const DEFAULT_BM25_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
/** 스냅샷은 단일 레코드 quota와 부분 손상을 피하려고 블록 레코드로 나눠 저장합니다. */
const BM25_SNAPSHOT_BLOCK_BYTES = 512 * 1024;
const DEFAULT_BM25_SNAPSHOT_MIN_ORDERS = 256;
const DEFAULT_BM25_SNAPSHOT_INTERVAL_MS = 60_000;
/** 삭제 tombstone 로그가 이 수를 넘으면 스냅샷을 다시 만들거나 폐기해 로그를 정리합니다. */
const BM25_REMOVAL_LOG_LIMIT = 4096;

interface BM25MetaRecord {
  key: string;
  value: string;
  updated: number;
}

interface BM25DocumentRecord {
  id: string;
  text: string;
  sourcePath: string;
  title?: string;
  headings?: string[];
  tags?: string[];
  aliases?: string[];
  updated: number;
  order: number;
  heading?: string;
  startLine?: number;
  endLine?: number;
  sourceMtime?: number;
  sourceSize?: number;
  contentHash?: string;
  indexedAt?: number;
}

interface BM25RemovalRecord {
  order: number;
  kind: 'clear' | 'remove-doc' | 'remove-source';
  target: string;
  updated: number;
}

interface BM25SnapshotManifest {
  sourceReceipt?: StoreMutationReceipt;
  generation: string;
  tokenizerVersion: number;
  lastOrder: number;
  docCount: number;
  byteLength: number;
  blockCount: number;
}

interface BM25SnapshotBlock {
  key: string;
  data: string;
}

interface BM25MutationRecord {
  id: string;
  kind: 'clear' | 'remove-doc' | 'remove-source';
  target: string;
  updated: number;
  order: number;
}

type BM25PendingOperation =
  | { kind: 'upsert-document'; record: BM25DocumentRecord; revision: number }
  | { kind: 'mutation'; record: BM25MutationRecord; revision: number };

export interface BM25DurabilityCheckpoint {
  receipt: StoreMutationReceipt | null;
  applied: { receipt: StoreMutationReceipt; sessionId: string; revision: number } | null;
  pendingOperations: number;
}

type BM25SnapshotSource = 'manifest' | 'indexeddb' | 'legacy' | 'empty';

interface BM25Snapshot {
  raw: string;
  source: BM25SnapshotSource;
  manifest?: BM25SnapshotManifest;
}

export interface IndexedDbBM25IndexOptions {
  artifactOwnership?: GeneratedArtifactBinding;
  maxSnapshotBytes?: number;
  workerFactory?: BM25WorkerFactory;
  /** 스냅샷 캡처 최소 주기와 최소 변경 수입니다. 기본값은 운영 기준으로 둡니다. */
  snapshotMinOrders?: number;
  snapshotIntervalMs?: number;
  /** 호출부가 스코프(source)를 붙여 전달하는 로거입니다. */
  logger?: ScopedLogger;
}

class BM25IndexDB extends GeneratedArtifactDatabase {
  meta!: Dexie.Table<BM25MetaRecord, string>;
  documents!: Dexie.Table<BM25DocumentRecord, string>;
  mutations!: Dexie.Table<BM25MutationRecord, string>;
  removals!: Dexie.Table<BM25RemovalRecord, number>;
  snapshotBlocks!: Dexie.Table<BM25SnapshotBlock, string>;
  durability!: Dexie.Table<DurabilityMetaRecord, string>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({
      meta: 'key',
    });
    this.version(2).stores({
      meta: 'key',
      documents: 'id, sourcePath, updated, order',
      mutations: 'id, kind, target, updated, order',
    });
    this.version(3).stores({
      meta: 'key',
      documents: 'id, sourcePath, updated, order',
      mutations: 'id, kind, target, updated, order',
      removals: 'order, target',
      snapshotBlocks: 'key',
    });
    this.version(4).stores({
      meta: 'key', documents: 'id, sourcePath, updated, order', mutations: 'id, kind, target, updated, order',
      removals: 'order, target', snapshotBlocks: 'key', durability: 'key',
    });
  }
}

export class IndexedDbBM25Index {
  private runtime: RustBm25RuntimeIndex | null;
  private db: BM25IndexDB;
  private legacyAdapter?: DataAdapter;
  private legacyPath: string;
  private loaded: boolean;
  private batchDepth: number;
  private batchDirty: boolean;
  private readonly maxSnapshotBytes: number;
  private readonly workerFactory?: BM25WorkerFactory;
  private readonly snapshotMinOrders: number;
  private readonly snapshotIntervalMs: number;
  private readonly logger?: ScopedLogger;
  private pendingOperations: BM25PendingOperation[];
  private nextOperationOrderValue: number;
  private workerRuntime: BM25WorkerRuntime | null = null;
  private workerQueue: Promise<void> = Promise.resolve();
  private workerReady = false;
  private workerTokenizerCurrent = false;
  private workerTotalDocs = 0;
  private workerFailure: Error | null = null;
  private recovery: Promise<void> | null = null;
  private rebuildReplayOperations: BM25PendingOperation[] | null = null;
  private restoreMode: 'snapshot+delta' | 'full' = 'full';
  private activeManifest: BM25SnapshotManifest | null = null;
  private ordersSinceSnapshot = 0;
  private removalsSinceSnapshot = 0;
  private lastSnapshotAt = 0;
  private snapshotCaptureInFlight = false;
  private workerGeneration = 0;
  private closed = false;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistedOrder = 0;
  private proofSession = crypto.randomUUID();
  private issuedRevision = 0;
  private appliedRevision = 0;
  private boundRevision = 0;
  private boundReceipt: StoreMutationReceipt | null = null;
  private prefixValid = false;
  private headContinuity = true;
  private loading = false;
  private loadBarrier: Promise<void> | null = null;
  private rebuilding = false;
  private pendingBarriers = 0;

  constructor(
    dbName = 'SuperpowerInsideBM25Index',
    legacyAdapter?: DataAdapter,
    legacyPath = '.superpower-inside/bm25-index.json',
    options: IndexedDbBM25IndexOptions = {},
  ) {
    this.db = new BM25IndexDB(dbName, options.artifactOwnership);
    this.legacyAdapter = legacyAdapter;
    this.legacyPath = legacyPath;
    this.runtime = null;
    this.loaded = false;
    this.batchDepth = 0;
    this.batchDirty = false;
    this.maxSnapshotBytes = normalizeMaxSnapshotBytes(options.maxSnapshotBytes);
    this.workerFactory = options.workerFactory;
    this.snapshotMinOrders = normalizePositiveInteger(
      options.snapshotMinOrders,
      DEFAULT_BM25_SNAPSHOT_MIN_ORDERS,
    );
    this.snapshotIntervalMs = normalizeNonNegativeInteger(
      options.snapshotIntervalMs,
      DEFAULT_BM25_SNAPSHOT_INTERVAL_MS,
    );
    this.logger = options.logger;
    this.pendingOperations = [];
    this.nextOperationOrderValue = Date.now() * 1000;
  }

  getDurabilityReceipt(): Promise<StoreMutationReceipt | null> {
    return readStoreMutationReceipt(this.db.durability);
  }

  async getCheckpoint(): Promise<BM25DurabilityCheckpoint> {
    const generation = this.workerGeneration;
    const receipt = await this.getDurabilityReceipt();
    const worker = this.workerRuntime;
    const revision = worker ? worker.appliedRevision : this.appliedRevision;
    const valid = receipt !== null && this.loaded && this.isTokenizerCurrent && !this.loading && !this.rebuilding && this.rebuildReplayOperations === null &&
      this.prefixValid && this.pendingBarriers === 0 && this.pendingOperations.length === 0 &&
      !this.snapshotCaptureInFlight && !this.workerFailure && !worker?.isClosed && worker?.pendingRevision == null &&
      this.boundRevision === this.issuedRevision && revision === this.boundRevision &&
      generation === this.workerGeneration && sameBm25Receipt(receipt, this.boundReceipt);
    return {
      receipt, pendingOperations: this.pendingOperations.length,
      applied: valid && receipt ? { receipt, sessionId: worker?.sessionId ?? this.proofSession, revision: this.boundRevision } : null,
    };
  }

  async initializeEmptyDurabilityReceipt(): Promise<StoreMutationReceipt | null> {
    this.requireActive();
    if (this.legacyAdapter && await this.legacyAdapter.exists(this.legacyPath)) return null;
    const nested = Dexie.currentTransaction?.db === this.db;
    let created = false;
    const receipt = await this.db.transaction('rw', this.db.tables, async () => {
      const previous = await this.getDurabilityReceipt();
      if (previous) return previous;
      for (const table of [this.db.documents, this.db.mutations, this.db.removals, this.db.meta, this.db.snapshotBlocks]) {
        if (await table.count()) return null;
      }
      const initial = await stampStoreMutation(this.db.durability);
      created = true;
      return initial;
    });
    if (!nested && created && receipt && this.loaded && !this.loading && this.pendingOperations.length === 0 && this.issuedRevision === 0 && this.totalDocs === 0) {
      this.boundReceipt = { ...receipt };
      this.prefixValid = true;
    }
    return receipt;
  }

  private bindCommittedHead(previous: StoreMutationReceipt | null, next: StoreMutationReceipt, revision = this.boundRevision, resetsProjection = false): void {
    const connected = sameBm25Receipt(previous, this.boundReceipt);
    this.headContinuity = resetsProjection || (this.headContinuity && connected);
    this.prefixValid = resetsProjection || (this.prefixValid && connected);
    this.boundReceipt = next;
    this.boundRevision = revision;
  }

  private async commitMutation<T>(operation: () => Promise<T>, projection?: { revision: number; resets: boolean }): Promise<T> {
    this.requireActive();
    const nested = Dexie.currentTransaction?.db === this.db;
    const generation = this.workerGeneration;
    const committed = await this.db.transaction('rw', this.db.tables, async () => {
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      const previous = await this.getDurabilityReceipt();
      const result = await operation();
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      const receipt = await stampStoreMutation(this.db.durability);
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      return { previous, receipt, result };
    });
    if (!nested && generation === this.workerGeneration) this.bindCommittedHead(committed.previous, committed.receipt, projection?.revision, projection?.resets);
    return committed.result;
  }

  private async readPersistedOrder(): Promise<number> {
    const stored: unknown = (await this.db.durability.get('bm25-order-v1'))?.value;
    if (stored !== undefined) {
      if (typeof stored !== 'number' || !Number.isSafeInteger(stored) || stored < 0) throw new Error('rag-bm25-order-invalid');
      return stored;
    }
    const [document, mutation, removal, manifest] = await Promise.all([
      this.db.documents.orderBy('order').last(), this.db.mutations.orderBy('order').last(),
      this.db.removals.orderBy('order').last(), this.db.meta.get(BM25_SNAPSHOT_MANIFEST_KEY),
    ]);
    let watermark = 0;
    if (manifest) {
      try { const parsed: unknown = JSON.parse(manifest.value); if (isBm25SnapshotManifest(parsed)) watermark = parsed.lastOrder; }
      catch { /* 손상된 스냅샷은 복원 경로에서 처리합니다. */ }
    }
    const order = Math.max(0, document?.order ?? 0, mutation?.order ?? 0, removal?.order ?? 0, watermark);
    if (!Number.isSafeInteger(order)) throw new Error('rag-bm25-order-invalid');
    return order;
  }

  load(onProgress?: (progress: { stage: 'restoring-keyword-snapshot' | 'restoring-keyword-documents'; processedUnits: number | null; totalUnits: number | null; unit: 'documents' | 'steps' }) => void): Promise<void> {
    if (this.closed) return Promise.reject(new Error('rag-bm25-session-retired'));
    const generation = ++this.workerGeneration;
    this.loading = true;
    this.snapshotCaptureInFlight = false;
    this.prefixValid = false;
    this.headContinuity = true;
    this.boundReceipt = null;
    this.boundRevision = 0;
    this.appliedRevision = 0;
    this.proofSession = crypto.randomUUID();
    const revisions = new Map<number, number>();
    this.pendingOperations = this.pendingOperations.map((operation) => {
      if (!revisions.has(operation.revision)) revisions.set(operation.revision, revisions.size + 1);
      return { ...operation, revision: revisions.get(operation.revision)! };
    });
    this.issuedRevision = revisions.size;
    const publish = (progress: Parameters<NonNullable<typeof onProgress>>[0]): void => {
      if (generation !== this.workerGeneration) return;
      try { onProgress?.(progress); } catch { /* 관측 오류는 복원을 중단하지 않습니다. */ }
    };
    publish({ stage: 'restoring-keyword-snapshot', processedUnits: 0, totalUnits: 1, unit: 'steps' });
    const task = this.loadRuntime(generation, publish);
    const finish = (): void => {
      if (generation === this.workerGeneration) { this.loading = false; this.loadBarrier = null; }
    };
    const completion = task.then(finish, (error: unknown) => {
      if (generation === this.workerGeneration) { this.prefixValid = false; this.loaded = false; }
      finish(); throw error;
    });
    if (generation === this.workerGeneration) this.loadBarrier = completion;
    return completion;
  }

  private async loadRuntime(generation: number, publish: (progress: { stage: 'restoring-keyword-snapshot' | 'restoring-keyword-documents'; processedUnits: number | null; totalUnits: number | null; unit: 'documents' | 'steps' }) => void): Promise<void> {
    this.requireActive();
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    this.runtime?.dispose();
    this.runtime = null;
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.workerQueue = Promise.resolve();
    this.workerFailure = null;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.loaded = false;
    this.restoreMode = 'full';
    this.activeManifest = null;
    const initialReceipt = this.getDurabilityReceipt();
    const existingPending = [...this.pendingOperations];
    let ownerWorker: BM25WorkerRuntime | null = null;
    const requireSession = (): void => {
      this.requireActive();
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      if (ownerWorker) this.requireWorkerSession(generation, ownerWorker);
    };
    const prepareBase = async (): Promise<StoreMutationReceipt | null> => {
      const receipt = await initialReceipt;
      requireSession();
      this.boundReceipt = receipt;
      const order = await this.readPersistedOrder();
      requireSession();
      this.persistedOrder = order;
      return receipt;
    };
    const finishBase = async (snapshot: BM25Snapshot, original: StoreMutationReceipt | null, fullRead = false): Promise<void> => {
      const receipt = await this.getDurabilityReceipt();
      requireSession();
      const linked = snapshot.manifest && isStoreMutationReceipt(snapshot.manifest.sourceReceipt) &&
        snapshot.manifest.sourceReceipt.incarnation === original?.incarnation && snapshot.manifest.lastOrder <= this.persistedOrder;
      const full = fullRead || snapshot.raw.trim().length === 0;
      const documents = full ? await this.db.documents.count() : null;
      requireSession();
      const empty = documents === 0 && await this.db.mutations.count() === 0;
      requireSession();
      this.prefixValid = this.headContinuity && sameBm25Receipt(receipt, this.boundReceipt) &&
        (original !== null ? full || !!linked : empty);
      this.boundReceipt = receipt;
      this.boundRevision = 0;
      this.appliedRevision = 0;
    };
    if (this.workerFactory || canUseBM25Worker()) {
      let restoringSnapshot = false;
      const worker = new BM25WorkerRuntime(this.workerFactory, undefined, (progress) => {
        if (!this.loading || this.closed || generation !== this.workerGeneration || worker !== this.workerRuntime || worker.isClosed) return;
        if (restoringSnapshot && progress.processedDocuments === 0) publish({ stage: 'restoring-keyword-snapshot', unit: 'steps', processedUnits: 1, totalUnits: 2 });
        else publish({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: progress.processedDocuments, totalUnits: progress.expectedDocuments });
      });
      this.workerRuntime = worker;
      ownerWorker = worker;
      const initialization = (async () => {
        const original = await prepareBase();
        const snapshot = await this.loadSnapshot(requireSession);
        requireSession();
        const raw = snapshot.raw.trim();
        const usableRaw = raw.length > 0 && raw.length <= this.maxSnapshotBytes ? raw : '';
        const manifest = usableRaw.length > 0 ? snapshot.manifest : undefined;
        publish({ stage: 'restoring-keyword-snapshot', processedUnits: 1, totalUnits: 1, unit: 'steps' });
        requireSession();
        restoringSnapshot = usableRaw.length > 0;
        const expectedDocuments = manifest?.docCount ?? await this.db.documents.count();
        requireSession();
        const state = await worker.initialize(
          this.db.name,
          usableRaw,
          manifest?.lastOrder,
          expectedDocuments,
        );
        requireSession();
        if (restoringSnapshot && !state.snapshotRejected) publish({ stage: 'restoring-keyword-snapshot', unit: 'steps', processedUnits: 2, totalUnits: 2 });
        requireSession();
        restoringSnapshot = false;
        let finalState = state;
        if (state.snapshotRejected) {
          // 손상 스냅샷은 폐기하고 저장된 원문에서 전량 복구한다.
          await this.dropSnapshot(true);
          requireSession();
          const expectedDocuments = await this.db.documents.count();
          requireSession();
          finalState = await worker.initialize(this.db.name, '', undefined, expectedDocuments);
        }
        requireSession();
        this.applyWorkerState(finalState);
        this.restoreMode = manifest && !state.snapshotRejected ? 'snapshot+delta' : 'full';
        if (manifest && !state.snapshotRejected) {
          this.activeManifest = manifest;
          this.ordersSinceSnapshot = 0;
          this.removalsSinceSnapshot = 0;
          await this.commitChangedRows(() => this.db.meta.where('key').equals(BM25_SNAPSHOT_KEY).delete());
          requireSession();
        }
        this.runtime = null;
        this.loaded = true;
        if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
          await this.persistSnapshotRaw(raw);
          requireSession();
        }
        await this.sweepOrphanSnapshotBlocks();
        requireSession();
        await finishBase(snapshot, original, state.snapshotRejected === true);
      })();
      // 초기화 중 들어온 파일 변경도 hydration 완료 뒤 같은 worker에 순서대로 적용한다.
      this.workerQueue = initialization;
      if (existingPending.length) this.enqueuePendingProjection(existingPending);
      try {
        await initialization;
        return;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        worker.close(failure);
        if (generation === this.workerGeneration && worker === this.workerRuntime) this.workerFailure ??= worker.closeReason ?? failure;
        // 닫힌 작업자를 남겨 다음 준비에서도 재초기화를 시도할 수 있게 합니다.
        if (generation === this.workerGeneration) this.loaded = false;
        throw error;
      }
    }
    const original = await prepareBase();
    const snapshot = await this.loadSnapshot(requireSession);
    requireSession();
    if (snapshot.manifest) {
      // 작업자 없는 세션은 tombstone 델타를 남길 수 없으므로 스냅샷을 버리고 원문에서 재구성한다.
      await this.dropSnapshot(true);
      requireSession();
    }
    const raw = (snapshot.manifest ? '' : snapshot.raw).trim();
    const snapshotRuntime =
      raw.length > 0 && raw.length <= this.maxSnapshotBytes
        ? RustBm25RuntimeIndex.fromJson(raw, TOKENIZER_VERSION)
        : null;
    this.runtime = snapshotRuntime ?? RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    if (
      this.runtime?.positionIndexStatus()?.complete === false &&
      (await this.db.documents.count()) > 0
    ) {
      requireSession();
      this.runtime.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    publish({ stage: 'restoring-keyword-snapshot', unit: 'steps', processedUnits: 1, totalUnits: 1 });
    requireSession();
    await this.replayPersistedOperations(requireSession, (processed, total) => publish({ stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: processed, totalUnits: total }));
    requireSession();
    this.loaded = true;
    if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
      await this.persistSnapshotRaw(raw);
    }
    await this.sweepOrphanSnapshotBlocks();
    await finishBase(snapshot, original, snapshot.manifest !== undefined);
    this.applyPendingProjection(this.pendingOperations);
  }

  async persist(): Promise<void> {
    this.requireActive();
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    await this.flush();
  }

  /** 외부 배치 안에서도 호출 시점의 내구 커밋과 작업자 적용 ACK를 기다립니다. */
  flush(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('rag-bm25-session-retired'));
    const applied = this.workerQueue;
    const checkpoint = this.issuedRevision;
    this.pendingBarriers++;
    const task = this.persistenceQueue.then(async () => {
      try {
        await this.persistNow(checkpoint);
        await applied;
        if (this.workerFailure) throw this.workerFailure;
      } finally { this.pendingBarriers--; }
    });
    this.persistenceQueue = task.catch(() => undefined);
    return task;
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    let succeeded = false;
    try {
      const result = await operation();
      succeeded = true;
      return result;
    } finally {
      this.batchDepth--;
      // 실패·취소의 원래 오류와 미커밋 원장을 보존합니다.
      if (succeeded && this.batchDepth === 0 && this.batchDirty) await this.flush();
    }
  }

  private async persistNow(checkpoint: number): Promise<void> {
    this.requireActive();
    const generation = this.workerGeneration;
    if (this.loadBarrier) await this.loadBarrier;
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    const operations = this.pendingOperations.filter((operation) => operation.revision <= checkpoint)
      .sort((left, right) => left.revision - right.revision);
    if (operations.length === 0) {
      this.batchDirty = this.pendingOperations.length > 0;
      return;
    }
    const removalRecords: BM25RemovalRecord[] = [];
    const committedOrder = await this.commitMutation(async () => {
      const recordRemovals = this.workerRuntime !== null || await this.readManifest() !== null;
      let order = await this.readPersistedOrder();
      if (order > Number.MAX_SAFE_INTEGER - operations.length) throw new Error('rag-bm25-order-overflow');
      for (const operation of operations) {
        const record = { ...operation.record, order: ++order };
        if (operation.kind === 'upsert-document') {
          await this.db.documents.put({ ...operation.record, order });
          continue;
        }
        await this.persistMutationOperation({ ...operation.record, order });
        if (recordRemovals) removalRecords.push({ order, kind: operation.record.kind, target: operation.record.target, updated: record.updated });
      }
      if (removalRecords.length > 0) await this.db.removals.bulkPut(removalRecords);
      await this.db.durability.put({ key: 'bm25-order-v1', value: order });
      return order;
    }, { revision: operations.at(-1)?.revision ?? this.boundRevision, resets: operations.some((operation) => operation.kind === 'mutation' && operation.record.kind === 'clear') });
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    this.persistedOrder = committedOrder;
    const committed = new Set(operations);
    this.pendingOperations = this.pendingOperations.filter((operation) => !committed.has(operation));
    this.batchDirty = this.pendingOperations.length > 0;
    const removals = await this.db.removals.count();
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    this.removalsSinceSnapshot = removals;
    await this.enforceRemovalLogBound();
    await this.captureSnapshotIfDue();
  }

  async clear(): Promise<void> {
    this.requireActive();
    const revision = ++this.issuedRevision;
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.clear({ revision }), worker);
      });
    } else if (!this.loading && !this.rebuilding) {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    this.queueMutation('clear', '*', true, revision);
    await this.persist();
    await this.dropSnapshot();
  }

  async deleteDatabase(): Promise<void> {
    this.closed = true;
    this.workerGeneration++;
    this.prefixValid = false;
    this.loading = false;
    this.loadBarrier = null;
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.pendingOperations = [];
    this.rebuildReplayOperations = null;
    this.batchDirty = false;
    this.loaded = false;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.activeManifest = null;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.snapshotCaptureInFlight = false;
    this.restoreMode = 'full';
    this.db.close({ disableAutoOpen: true });
    await Dexie.delete(this.db.name);
  }

  close(): void {
    this.closed = true;
    this.workerGeneration++;
    this.prefixValid = false;
    this.loading = false;
    this.loadBarrier = null;
    this.workerRuntime?.close();
    this.workerRuntime = null;
    this.runtime?.dispose();
    this.runtime = null;
    this.pendingOperations = [];
    this.rebuildReplayOperations = null;
    this.batchDirty = false;
    this.loaded = false;
    this.workerReady = false;
    this.workerTokenizerCurrent = false;
    this.workerTotalDocs = 0;
    this.activeManifest = null;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.snapshotCaptureInFlight = false;
    this.restoreMode = 'full';
    this.db.close({ disableAutoOpen: true });
  }

  async rebuild(documents: readonly BM25DocumentInput[]): Promise<void> {
    this.requireActive();
    const generation = this.workerGeneration;
    if (this.loadBarrier) await this.loadBarrier;
    this.requireActive();
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    if (this.rebuilding) throw new Error('BM25 rebuild is already in progress.');
    this.rebuilding = true;
    const revision = ++this.issuedRevision;
    try {
      await this.withBatch(async () => {
        this.queueMutation('clear', '*', false, revision);
        if (this.workerRuntime) {
          const workerDocuments = documents.map((document) => ({ ...document, ...documentFields(document), sourcePath: document.sourcePath ?? document.id }));
          for (const document of documents) this.queueDocument(normalizeCorpusDocument(document), false, revision);
          this.enqueueWorkerMutation(async (worker) => { this.applyWorkerState(await worker.rebuild(workerDocuments, { revision }), worker); });
        } else {
          this.runtime?.dispose();
          this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
          for (let index = 0; index < documents.length; index++) {
            const document = documents[index];
            this.addRuntimeDocument(normalizeCorpusDocument(document));
            this.queueDocument(normalizeCorpusDocument(document), false, revision);
            if (index + 1 < documents.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) await yieldToHost();
          }
          this.appliedRevision = revision;
          this.applyPendingProjection(this.pendingOperations.filter((operation) => operation.revision > revision));
        }
        await this.persist();
      });
    } finally { this.rebuilding = false; }
    if (!this.workerRuntime) this.applyPendingProjection(this.pendingOperations.filter((operation) => operation.revision > this.appliedRevision));
    await this.flush();
    await this.dropSnapshot();
    if (this.workerFailure) throw this.workerFailure;
  }

  async rebuildFrom(createDocuments: () => Promise<readonly BM25DocumentInput[]>): Promise<void> {
    this.requireActive();
    if (this.rebuildReplayOperations !== null) {
      throw new Error('BM25 rebuild is already in progress.');
    }
    const generation = this.workerGeneration;
    const replayOperations: BM25PendingOperation[] = [];
    this.rebuildReplayOperations = replayOperations;
    let rebuildStarted = false;
    let rebuildError: Error | null = null;
    try {
      const documents = await createDocuments();
      this.requireActive();
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      rebuildStarted = true;
      await this.rebuild(documents);
    } catch (error) {
      rebuildError = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (this.rebuildReplayOperations === replayOperations) this.rebuildReplayOperations = null;
    }

    this.requireActive();
    if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
    if (rebuildStarted && replayOperations.length > 0) {
      await this.replayOperationsAfterRebuild(replayOperations);
    }
    if (rebuildError) throw rebuildError;
  }

  addDocument(docId: string, text: string, sourcePath = docId): void {
    this.addCorpusDocument({ id: docId, text, sourcePath });
  }

  addCorpusDocument(document: BM25CorpusDocument): void {
    this.requireActive();
    const revision = ++this.issuedRevision;
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(
          await worker.add({
            ...document,
            ...documentFields(document),
            id: document.id,
            text: document.text,
            sourcePath: document.sourcePath,
          }, { revision }),
          worker,
        );
      });
    } else if (!this.loading && !this.rebuilding) {
      this.addRuntimeDocument(document);
    }
    this.queueDocument(document, true, revision);
  }

  /** 소스 교체는 유한 크기 메시지로 보내며 기존 역색인·위치 계산을 그대로 사용합니다. */
  replaceSourceDocuments(sourcePath: string, documents: readonly BM25CorpusDocument[]): void {
    this.requireActive();
    if (documents.some((document) => document.sourcePath !== sourcePath))
      throw new Error('BM25 source replacement path mismatch.');
    const wireBytes = documents.map((document) => JSON.stringify(document).length * 2);
    if (wireBytes.some((bytes) => bytes > 1024 * 1024)) throw new Error('BM25 replacement message budget exceeded.');
    const revision = ++this.issuedRevision;
    this.queueMutation('remove-source', sourcePath, true, revision);
    if (!this.workerRuntime) {
      if (!this.loading && !this.rebuilding) this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
      for (const document of documents) {
        if (!this.loading && !this.rebuilding) this.addRuntimeDocument(document);
        this.queueDocument(document, true, revision);
      }
      return;
    }
    let batch: BM25CorpusDocument[] = [];
    let bytes = 0;
    let replace = true;
    let part = 0;
    const send = (finalPart: boolean): void => {
      const pending = batch;
      const removeFirst = replace;
      const context = { revision, part: part++, finalPart };
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.replaceSource(sourcePath, pending, removeFirst, context), worker);
      });
      batch = [];
      bytes = 0;
      replace = false;
    };
    for (const [index, document] of documents.entries()) {
      const size = wireBytes[index];
      if (batch.length > 0 && (bytes + size > 1024 * 1024 || batch.length >= 128)) send(false);
      batch.push(document);
      bytes += size;
      this.queueDocument(document, true, revision);
    }
    if (batch.length > 0 || replace) send(true);
  }

  removeDocument(docId: string): void {
    this.requireActive();
    const revision = ++this.issuedRevision;
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeDocument(docId, { revision }), worker);
      });
    } else if (!this.loading && !this.rebuilding) {
      this.ensureRuntime().removeDocument(docId, TOKENIZER_VERSION);
    }
    this.queueMutation('remove-doc', docId, true, revision);
  }

  removeDocumentsBySource(sourcePath: string): void {
    this.requireActive();
    const revision = ++this.issuedRevision;
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeSource(sourcePath, { revision }), worker);
      });
    } else if (!this.loading && !this.rebuilding) {
      this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
    }
    this.queueMutation('remove-source', sourcePath, true, revision);
  }

  search(query: string): Map<string, number> {
    const mappedScores = new Map<string, number>();
    for (const { docId, score } of this.ensureRuntime().search(query) ?? []) {
      mappedScores.set(docId, score);
    }
    return mappedScores;
  }

  searchTop(query: string, limit: number): Map<string, number> {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (normalizedLimit === 0) return new Map<string, number>();

    const mappedScores = new Map<string, number>();
    for (const { docId, score } of this.ensureRuntime().searchTop(query, normalizedLimit) ?? []) {
      mappedScores.set(docId, score);
    }
    return mappedScores;
  }

  async searchTopWithSources(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<BM25WorkerHit[]> {
    signal?.throwIfAborted();
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (normalizedLimit === 0) return [];
    const worker = this.workerRuntime;
    if (worker) {
      // 초기 적재가 끝나기 전에는 결과만 비우고 채팅·검색을 기다리게 하지 않습니다.
      if (!this.loaded) return [];
      const generation = this.workerGeneration;
      // 적재·변경의 순서는 유지하되 취소한 검색은 작업자 대기열 뒤에 남기지 않습니다.
      await awaitBm25SearchQueue(this.workerQueue, signal);
      signal?.throwIfAborted();
      // 복구로 작업자가 교체됐거나 실패한 세대의 결과는 버린다.
      if (this.workerFailure || worker.isClosed || generation !== this.workerGeneration) return [];
      return worker.searchTop(query, normalizedLimit, signal);
    }
    return [...this.searchTop(query, normalizedLimit)].map(([docId, score]) => ({
      docId,
      sourcePath: this.getDocumentSource(docId) ?? docId,
      score,
    }));
  }

  async searchRepresentatives(
    query: string,
    limit: number,
    signal?: AbortSignal,
    allowedPaths?: readonly string[],
  ): Promise<BM25BatchSearchHit[] | null> {
    signal?.throwIfAborted();
    const worker = this.workerRuntime;
    const generation = this.workerGeneration;
    if (worker) {
      await awaitBm25SearchQueue(this.workerQueue, signal);
      signal?.throwIfAborted();
      if (!this.isReady || generation !== this.workerGeneration) return null;
    } else if (!this.isReady) return null;
    const raw = worker
      ? await worker.searchRepresentatives(query, limit, signal, allowedPaths)
      : this.ensureRuntime().searchRepresentativesJson(query, limit, allowedPaths);
    if (!this.isReady || generation !== this.workerGeneration) return null;
    try {
      return parseBm25RepresentativeHits(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  /**
   * 색인 전체에서 질의와 정확히 일치한 문서·구간·발생 횟수를 셉니다.
   * 점수·순위가 아니라 답변이 집계로 인용할 인벤토리이며, 색인이 준비되지 않았으면 null입니다.
   */
  async aggregateMatches(
    query: string,
    limit: number,
    signal?: AbortSignal,
    allowedPaths?: readonly string[],
  ): Promise<RustBm25MatchAggregate | null> {
    signal?.throwIfAborted();
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (normalizedLimit === 0) return null;
    const worker = this.workerRuntime;
    if (worker) {
      if (!this.loaded) return null;
      const generation = this.workerGeneration;
      await awaitBm25SearchQueue(this.workerQueue, signal);
      signal?.throwIfAborted();
      if (this.workerFailure || worker.isClosed || generation !== this.workerGeneration) return null;
      return parseBm25MatchAggregateJson(await worker.aggregate(query, normalizedLimit, signal, allowedPaths));
    }
    return this.ensureRuntime().aggregate(query, normalizedLimit, allowedPaths);
  }

  /**
   * 여러 facet 검색과 집계를 한 작업자 요청으로 실행합니다.
   * 검색 후보·집계는 개별 호출과 같은 wire 값을 유지합니다.
   */
  async batchSearchAndAggregate(
    queries: readonly { query: string; limit: number }[],
    aggregates: readonly { query: string; limit: number }[],
    allowedPaths?: readonly string[],
    signal?: AbortSignal,
  ): Promise<BM25BatchResult | null> {
    signal?.throwIfAborted();
    if (queries.length === 0 && aggregates.length === 0) {
      return { queries: [], aggregates: [] };
    }
    const worker = this.workerRuntime;
    if (worker) {
      if (!this.loaded) return null;
      const generation = this.workerGeneration;
      await awaitBm25SearchQueue(this.workerQueue, signal);
      signal?.throwIfAborted();
      if (this.workerFailure || worker.isClosed || generation !== this.workerGeneration) return null;
      return parseBm25BatchJson(await worker.batch(queries, aggregates, allowedPaths, signal));
    }
    return parseBm25BatchJson(
      this.ensureRuntime().batchSearchAndAggregateJson(
        JSON.stringify({ queries, aggregates, ...(allowedPaths !== undefined ? { allowedPaths } : {}) }),
      ),
    );
  }

  /** 이번 세션 런타임이 스냅샷+델타로 복구됐는지, 원문 전량 재구성인지 알려줍니다. */
  get recoveryMode(): 'snapshot+delta' | 'full' {
    return this.restoreMode;
  }

  /** 색인 복원 중이면 읽은 문서 수와 기대 문서 수를 알려줍니다. */
  get restoreProgress(): { processedDocuments: number; expectedDocuments: number | null } | null {
    if (this.isReady) return null;
    return this.workerRuntime?.hydrationProgress ?? null;
  }

  /** 작업자 실패나 종료로 이번 세션 색인을 쓸 수 없는 상태인지 알려줍니다. */
  get hasFailure(): boolean {
    return this.workerFailure !== null || (this.workerRuntime?.isClosed ?? false);
  }

  get isReady(): boolean {
    return (
      this.loaded &&
      this.workerFailure === null &&
      (this.workerRuntime
        ? this.workerReady && !this.workerRuntime.isClosed
        : (this.runtime?.isReady() ?? false))
    );
  }

  async recoverClosedWorker(): Promise<void> {
    this.requireActive();
    // 복구할 작업자가 없으면 초기 적재·변이 대기열에 호출자를 붙잡아 두지 않습니다.
    const worker = this.workerRuntime;
    if (!worker?.isClosed) return;
    const generation = this.workerGeneration;
    const requireOwner = (): void => this.requireWorkerSession(generation, worker, true);
    this.recovery ??= this.workerQueue
      // 초기화 실패로 거절된 대기열도 복구 진입을 막지 않습니다.
      .catch(() => undefined)
      .then(async () => {
        requireOwner();
        // 기록 대기 중인 변경을 먼저 저장하고 같은 코퍼스에서 작업자만 복원한다.
        const saving = this.persistenceQueue.then(async () => {
          requireOwner();
          await this.persistNow(this.issuedRevision);
          requireOwner();
        });
        this.persistenceQueue = saving.catch(() => undefined);
        await saving;
        requireOwner();
        await this.load();
      })
      .finally(() => {
        this.recovery = null;
      });
    await this.recovery;
  }

  get isTokenizerCurrent(): boolean {
    return this.workerRuntime
      ? this.workerTokenizerCurrent
      : (this.runtime?.isTokenizerCurrent(TOKENIZER_VERSION) ?? false) &&
          this.runtime?.positionIndexStatus()?.complete === true;
  }

  get totalDocs(): number {
    return this.workerRuntime ? this.workerTotalDocs : (this.runtime?.totalDocs() ?? 0);
  }

  getDocumentSource(docId: string): string | undefined {
    return this.runtime?.sourcePathForDoc(docId);
  }

  async getSourcePaths(): Promise<string[]> {
    await this.persist();
    const records = await this.db.documents.toArray();
    return [...new Set(records.map((record) => record.sourcePath))].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  async getCorpusDocumentsByIds(ids: readonly string[]): Promise<BM25CorpusDocument[]> {
    await this.persist();
    const records = await this.db.documents.bulkGet([...ids]);
    return records.flatMap((record) => (record ? [toCorpusDocument(record)] : []));
  }

  /** 내용은 같고 파일 revision만 변한 경우 토큰 재구축 없이 source metadata만 갱신합니다. */
  async refreshSourceRevision(
    sourcePath: string,
    revision: Pick<BM25CorpusDocument, 'sourceMtime' | 'sourceSize' | 'contentHash'>,
  ): Promise<number> {
    this.pendingBarriers++;
    try {
      await this.persist();
      const updated = Date.now();
      return await this.commitChangedRows(() => this.db.documents.where('sourcePath').equals(sourcePath)
        .filter((record) => record.sourceMtime !== revision.sourceMtime || record.sourceSize !== revision.sourceSize || record.contentHash !== revision.contentHash)
        .modify((record) => {
          record.sourceMtime = revision.sourceMtime;
          record.sourceSize = revision.sourceSize;
          record.contentHash = revision.contentHash;
          record.updated = updated;
        }));
    } finally { this.pendingBarriers--; }
  }

  async getCorpusDocumentsBySourcePaths(
    sourcePaths: readonly string[],
  ): Promise<BM25CorpusDocument[]> {
    await this.persist();
    if (sourcePaths.length === 0) return [];
    const records = await this.db.documents
      .where('sourcePath')
      .anyOf([...sourcePaths])
      .toArray();
    return records.map(toCorpusDocument);
  }

  async reconcileSourcePaths(
    validSourcePaths: readonly string[],
    maxDeletions = 128,
  ): Promise<{ deletedSourcePaths: string[]; remainingWork: boolean }> {
    const sourcePaths = await this.getSourcePaths();
    const plan = planStaleIndexSourcePathsRust(sourcePaths, validSourcePaths, maxDeletions);
    if (!plan) throw new Error('Rust BM25 source reconciliation planning failed');
    await this.withBatch(async () => {
      for (const sourcePath of plan.deletePaths) this.removeDocumentsBySource(sourcePath);
      await this.persist();
    });
    await this.workerQueue;
    if (this.workerFailure) throw this.workerFailure;
    return {
      deletedSourcePaths: plan.deletePaths,
      remainingWork: plan.remainingDeleteCount > 0,
    };
  }

  private ensureRuntime(): RustBm25RuntimeIndex {
    this.requireActive();
    if (this.runtime === null) {
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    if (this.runtime === null) {
      throw new Error('Rust BM25 runtime is unavailable');
    }
    return this.runtime;
  }

  private requireActive(): void {
    if (this.closed) throw new Error('rag-bm25-session-retired');
  }

  private requireWorkerSession(generation: number, worker: BM25WorkerRuntime, allowClosed = false): void {
    this.requireActive();
    if (generation !== this.workerGeneration || worker !== this.workerRuntime) throw new Error('rag-bm25-session-retired');
    if (!allowClosed) {
      if (this.workerFailure) throw this.workerFailure;
      if (worker.isClosed) throw worker.closeReason ?? new Error('BM25 worker is closed.');
    }
  }

  private enqueueWorkerMutation(operation: (worker: BM25WorkerRuntime) => Promise<void>): void {
    void this.enqueueWorkerTask(operation).catch(() => undefined);
  }

  /** 작업자 대기열에 순서대로 붙이고 이 작업의 완료를 기다릴 수 있게 반환합니다. */
  private enqueueWorkerTask(
    operation: (worker: BM25WorkerRuntime) => Promise<void>,
  ): Promise<void> {
    const worker = this.workerRuntime;
    if (!worker) return Promise.resolve();
    const generation = this.workerGeneration;
    const task = this.workerQueue.then(() => {
      this.requireWorkerSession(generation, worker);
      return operation(worker);
    });
    this.workerQueue = task.then(
      () => undefined,
      (error: unknown) => {
        if (generation === this.workerGeneration && worker === this.workerRuntime) {
          this.workerFailure ??= worker.closeReason ?? (error instanceof Error ? error : new Error(String(error)));
          this.workerReady = false;
          worker.close(this.workerFailure);
        }
      },
    );
    return task;
  }

  private applyWorkerState(state: {
    ready?: boolean;
    tokenizerCurrent?: boolean;
    totalDocs?: number;
  }, worker?: BM25WorkerRuntime): void {
    if (worker) this.requireWorkerSession(this.workerGeneration, worker);
    this.workerReady = state.ready ?? false;
    this.workerTokenizerCurrent = state.tokenizerCurrent ?? false;
    this.workerTotalDocs = state.totalDocs ?? 0;
  }

  private async replayPersistedOperations(requireSession: () => void, progress?: (processed: number, total: number) => void): Promise<void> {
    const [documents, mutations] = await Promise.all([
      this.db.documents.toArray(),
      this.db.mutations.toArray(),
    ]);
    requireSession();
    const operations: Array<
      | { kind: 'upsert-document'; record: BM25DocumentRecord; order: number }
      | { kind: 'mutation'; record: BM25MutationRecord; order: number }
    > = [
      ...documents.map((record) => ({
        kind: 'upsert-document' as const,
        record,
        order: normalizeOperationOrder(record),
      })),
      ...mutations.map((record) => ({
        kind: 'mutation' as const,
        record,
        order: normalizeOperationOrder(record),
      })),
    ].sort((a, b) => a.order - b.order);

    let processedDocuments = 0;
    progress?.(0, documents.length);
    for (let index = 0; index < operations.length; index++) {
      requireSession();
      const operation = operations[index];
      if (!operation) continue;
      if (operation.kind === 'upsert-document') {
        this.addRuntimeDocument(toCorpusDocument(operation.record));
        processedDocuments++;
        if (processedDocuments % 128 === 0) progress?.(processedDocuments, documents.length);
      } else {
        this.applyMutation(operation.record);
      }
      if (index + 1 < operations.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) {
        await yieldToHost();
      }
    }
    requireSession();
    progress?.(processedDocuments, documents.length);
    this.batchDirty = this.pendingOperations.length > 0;
    if (mutations.length > 0) {
      await this.commitChangedRows(() => this.db.mutations.toCollection().delete());
    }
  }

  private async persistMutationOperation(record: BM25MutationRecord): Promise<void> {
    if (record.kind === 'clear') {
      await this.db.documents.clear();
      await this.db.mutations.clear();
      return;
    }
    if (record.kind === 'remove-doc') {
      await this.db.documents.delete(record.target);
    } else {
      await this.db.documents.where('sourcePath').equals(record.target).delete();
    }
  }

  private async replayOperationsAfterRebuild(operations: readonly BM25PendingOperation[]): Promise<void> {
    await this.withBatch(async () => {
      for (const operation of operations) {
        const revision = ++this.issuedRevision;
        const start = this.pendingOperations.length;
        if (operation.kind === 'upsert-document') this.queueDocument(toCorpusDocument(operation.record), false, revision);
        else this.queueMutation(operation.record.kind, operation.record.target, false, revision);
        const replay = this.pendingOperations.slice(start);
        if (this.workerRuntime) this.enqueuePendingProjection(replay);
        else this.applyPendingProjection(replay);
      }
      await this.persist();
    });
    await this.workerQueue;
    if (this.workerFailure) throw this.workerFailure;
  }

  private addRuntimeDocument(document: BM25CorpusDocument): void {
    if (!this.ensureRuntime().addDocumentFields(document.id, document.text, document.sourcePath, documentFields(document), TOKENIZER_VERSION)) {
      this.prefixValid = false;
      this.workerFailure = new Error('BM25 runtime rejected a document.');
      throw this.workerFailure;
    }
  }

  private applyPendingProjection(operations: readonly BM25PendingOperation[]): void {
    for (const operation of [...operations].sort((left, right) => left.revision - right.revision)) {
      if (operation.kind === 'upsert-document') this.addRuntimeDocument(toCorpusDocument(operation.record));
      else this.applyMutation(operation.record);
      this.appliedRevision = operation.revision;
    }
  }

  private enqueuePendingProjection(operations: readonly BM25PendingOperation[]): void {
    const groups = new Map<number, BM25PendingOperation[]>();
    for (const operation of operations) {
      const group = groups.get(operation.revision) ?? [];
      group.push(operation);
      groups.set(operation.revision, group);
    }
    for (const [revision, group] of [...groups].sort(([left], [right]) => left - right)) {
      group.forEach((operation, part) => {
        const context = { revision, part, finalPart: part === group.length - 1 };
        this.enqueueWorkerMutation(async (worker) => {
          if (operation.kind === 'upsert-document') {
            const document = toCorpusDocument(operation.record);
            this.applyWorkerState(await worker.add({ ...document, ...documentFields(document) }, context), worker);
          } else if (operation.record.kind === 'clear') this.applyWorkerState(await worker.clear(context), worker);
          else if (operation.record.kind === 'remove-doc') this.applyWorkerState(await worker.removeDocument(operation.record.target, context), worker);
          else this.applyWorkerState(await worker.removeSource(operation.record.target, context), worker);
        });
      });
    }
  }

  private applyMutation(record: BM25MutationRecord): void {
    if (record.kind === 'clear') {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
      return;
    }
    if (record.kind === 'remove-doc') {
      this.ensureRuntime().removeDocument(record.target, TOKENIZER_VERSION);
      return;
    }
    this.ensureRuntime().removeSource(record.target, TOKENIZER_VERSION);
  }

  private queueDocument(document: BM25CorpusDocument, captureForRebuild = true, revision = ++this.issuedRevision): void {
    const now = Date.now();
    const operation: BM25PendingOperation = {
      kind: 'upsert-document',
      revision,
      record: {
        ...document,
        id: document.id,
        text: document.text,
        sourcePath: document.sourcePath,
        updated: now,
        order: this.nextOperationOrder(),
        heading: document.heading,
        startLine: document.startLine,
        endLine: document.endLine,
        sourceMtime: document.sourceMtime,
        sourceSize: document.sourceSize,
        contentHash: document.contentHash,
        indexedAt: document.indexedAt,
      },
    };
    this.pendingOperations.push(operation);
    if (!this.workerRuntime && !this.loading && !this.rebuilding) this.appliedRevision = revision;
    this.ordersSinceSnapshot += 1;
    if (captureForRebuild) {
      this.rebuildReplayOperations?.push(operation);
    }
  }

  private queueMutation(
    kind: BM25MutationRecord['kind'],
    target: string,
    captureForRebuild = true,
    revision = ++this.issuedRevision,
  ): void {
    const now = Date.now();
    const order = this.nextOperationOrder();
    const operation: BM25PendingOperation = {
      kind: 'mutation',
      revision,
      record: {
        id: `${kind}:${target}:${order}`,
        kind,
        target,
        updated: now,
        order,
      },
    };
    this.pendingOperations.push(operation);
    if (!this.workerRuntime && !this.loading && !this.rebuilding) this.appliedRevision = revision;
    this.ordersSinceSnapshot += 1;
    if (captureForRebuild) {
      this.rebuildReplayOperations?.push(operation);
    }
  }

  private nextOperationOrder(): number {
    const nextClockOrder = Date.now() * 1000;
    this.nextOperationOrderValue = Math.max(this.nextOperationOrderValue + 1, nextClockOrder);
    return this.nextOperationOrderValue;
  }

  /** 스냅샷 캡처 시점의 order까지 직렬화와 manifest 기록을 마칩니다. */
  private async captureSnapshotIfDue(force = false): Promise<boolean> {
    if (!this.workerRuntime || this.workerFailure || !this.loaded || !this.isTokenizerCurrent || this.rebuilding) return false;
    if (this.batchDepth > 0 || this.snapshotCaptureInFlight || this.pendingOperations.length > 0 || !this.prefixValid || !this.boundReceipt || this.boundRevision !== this.issuedRevision) {
      return false;
    }
    if (!force) {
      if (this.ordersSinceSnapshot < this.snapshotMinOrders) return false;
      if (Date.now() - this.lastSnapshotAt < this.snapshotIntervalMs) return false;
    }
    this.snapshotCaptureInFlight = true;
    // watermark는 직렬화 작업을 대기열에 넣는 이 시점의 순서여야 한다.
    const lastOrder = this.persistedOrder;
    const sourceReceipt = this.boundReceipt;
    const revision = this.boundRevision;
    const generation = this.workerGeneration;
    const worker = this.workerRuntime;
    try {
      await this.enqueueWorkerTask(async () => {
        const serialized = await worker.serializeCheckpoint();
        if (serialized.sessionId !== worker.sessionId || serialized.appliedRevision !== revision || serialized.pendingRevision !== null) return;
        const raw = serialized.snapshot;
        if (raw.length === 0 || raw.length > this.maxSnapshotBytes) {
          this.lastSnapshotAt = Date.now();
          return;
        }
        await this.commitSnapshot(raw, lastOrder, { receipt: sourceReceipt, sessionId: serialized.sessionId, revision });
      });
    } catch (error) {
      this.logger?.warn('BM25 snapshot capture failed; keeping the previous snapshot.', {
        error,
      });
      return false;
    } finally {
      if (generation === this.workerGeneration) this.snapshotCaptureInFlight = false;
    }
    return generation === this.workerGeneration && this.activeManifest !== null;
  }

  /** 블록을 먼저 쓰고 manifest 1건을 마지막에 써서 원자적으로 세대를 교체합니다. */
  private async commitSnapshot(raw: string, lastOrder: number, expected: { receipt: StoreMutationReceipt; sessionId: string; revision: number }): Promise<void> {
    const ownerGeneration = this.workerGeneration;
    const generation = crypto.randomUUID();
    const blockCount = Math.max(1, Math.ceil(raw.length / BM25_SNAPSHOT_BLOCK_BYTES));
    const manifest: BM25SnapshotManifest = {
      generation,
      tokenizerVersion: TOKENIZER_VERSION,
      lastOrder,
      sourceReceipt: { ...expected.receipt },
      docCount: 0,
      byteLength: raw.length,
      blockCount,
    };
    try {
      await this.commitMutation(async () => {
        if (!sameBm25Receipt(await this.getDurabilityReceipt(), expected.receipt) || await this.readPersistedOrder() !== lastOrder ||
            this.workerRuntime?.sessionId !== expected.sessionId || this.workerRuntime.appliedRevision !== expected.revision || this.workerRuntime.pendingRevision !== null) {
          throw new Error('rag-bm25-snapshot-stale');
        }
        manifest.docCount = await this.db.documents.count();
        const previous = await this.readManifest();
        for (let index = 0; index < blockCount; index++) {
          await this.writeSnapshotBlock(`${generation}:${index}`, raw.slice(index * BM25_SNAPSHOT_BLOCK_BYTES, (index + 1) * BM25_SNAPSHOT_BLOCK_BYTES));
        }
        await this.db.meta.put({ key: BM25_SNAPSHOT_MANIFEST_KEY, value: JSON.stringify(manifest), updated: Date.now() });
        if (previous && previous.generation !== generation) await this.deleteSnapshotBlocks(previous.generation, previous.blockCount);
        await this.db.removals.where('order').belowOrEqual(lastOrder).delete();
        await this.db.meta.delete(BM25_SNAPSHOT_KEY);
      });
    } catch (error) {
      this.lastSnapshotAt = Date.now();
      await this.deleteSnapshotBlocks(generation, blockCount).catch(() => undefined);
      this.logger?.warn('BM25 snapshot commit failed; keeping the previous snapshot.', {
        error,
      });
      return;
    }
    if (ownerGeneration !== this.workerGeneration) return;
    this.activeManifest = manifest;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.lastSnapshotAt = Date.now();
  }

  /** 스냅샷과 tombstone 로그를 버리고 다음 복구를 전량 재구성으로 되돌립니다. */
  private async dropSnapshot(requireSuccess = false): Promise<void> {
    this.activeManifest = null;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.restoreMode = 'full';
    try {
      await this.commitChangedRows(async () => {
        const manifest = await this.readManifest();
        const removed = await this.db.meta.where('key').anyOf([BM25_SNAPSHOT_MANIFEST_KEY, BM25_SNAPSHOT_KEY]).delete();
        const blocks = manifest ? await this.db.snapshotBlocks.where('key').startsWith(`${manifest.generation}:`).delete() : 0;
        const removals = await this.db.removals.toCollection().delete();
        return removed + blocks + removals;
      });
    } catch (error) {
      if (requireSuccess) throw error;
      this.logger?.warn('BM25 snapshot cleanup failed.', {
        error,
      });
    }
  }

  private async enforceRemovalLogBound(): Promise<void> {
    if (this.removalsSinceSnapshot <= BM25_REMOVAL_LOG_LIMIT) return;
    if (await this.captureSnapshotIfDue(true)) return;
    this.logger?.warn(
      'BM25 snapshot was discarded because the tombstone log grew past its bound.',
      {
        data: { removals: this.removalsSinceSnapshot },
      },
    );
    await this.dropSnapshot();
  }

  /** 테스트에서 quota 실패를 주입할 수 있게 분리한 블록 기록입니다. */
  protected async writeSnapshotBlock(key: string, data: string): Promise<void> {
    await this.commitMutation(() => this.db.snapshotBlocks.put({ key, data }));
  }

  private async deleteSnapshotBlocks(generation: string, blockCount: number): Promise<void> {
    const keys = Array.from({ length: blockCount }, (_, index) => `${generation}:${index}`);
    await this.commitChangedRows(() => this.db.snapshotBlocks.where('key').anyOf(keys).delete());
  }

  private async commitChangedRows(operation: () => Promise<number>): Promise<number> {
    this.requireActive();
    const nested = Dexie.currentTransaction?.db === this.db;
    const generation = this.workerGeneration;
    const committed = await this.db.transaction('rw', this.db.tables, async () => {
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      const previous = await this.getDurabilityReceipt();
      const count = await operation();
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      const receipt = count > 0 ? await stampStoreMutation(this.db.durability) : null;
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      return { previous, count, receipt };
    });
    if (!nested && committed.receipt && generation === this.workerGeneration) this.bindCommittedHead(committed.previous, committed.receipt);
    return committed.count;
  }

  /**
   * 재시작 sweep: 활성 세대가 아닌 블록만 키 prefix 기준으로 정리합니다.
   * 캡처 도중 죽어 남은 세대와 폐기된 세대를 함께 회수합니다.
   */
  private async sweepOrphanSnapshotBlocks(): Promise<void> {
    try {
      const removed = await this.commitChangedRows(async () => {
        const manifest = await this.readManifest();
        if (!manifest && await this.db.meta.get(BM25_SNAPSHOT_MANIFEST_KEY)) return 0;
        const activeGeneration = manifest?.generation ?? null;
        const keys = await this.db.snapshotBlocks.toCollection().primaryKeys();
        const orphans = keys.filter((key) => activeGeneration === null || !key.startsWith(`${activeGeneration}:`));
        return orphans.length ? this.db.snapshotBlocks.where('key').anyOf(orphans).delete() : 0;
      });
      if (removed > 0) this.logger?.warn('BM25 orphan snapshot blocks were removed.', { data: { blocks: removed } });
    } catch (error) {
      this.logger?.warn('BM25 orphan snapshot sweep failed.', { error });
    }
  }

  private async readManifest(): Promise<BM25SnapshotManifest | null> {
    const stored = await this.db.meta.get(BM25_SNAPSHOT_MANIFEST_KEY);
    if (!stored?.value) return null;
    try {
      const parsed: unknown = JSON.parse(stored.value);
      if (!isBm25SnapshotManifest(parsed)) throw new Error('BM25 snapshot manifest is invalid.');
      if (parsed.tokenizerVersion !== TOKENIZER_VERSION) {
        throw new Error('BM25 snapshot tokenizer version is stale.');
      }
      return parsed;
    } catch (error) {
      this.logger?.debug('BM25 snapshot manifest was discarded.', {
        error,
      });
      return null;
    }
  }

  private async readSnapshotBlocks(manifest: BM25SnapshotManifest): Promise<string | null> {
    const keys = Array.from(
      { length: manifest.blockCount },
      (_, index) => `${manifest.generation}:${index}`,
    );
    const records = await this.db.snapshotBlocks.bulkGet(keys);
    if (records.some((record) => typeof record?.data !== 'string')) return null;
    const raw = records.map((record) => record?.data ?? '').join('');
    return raw.length === manifest.byteLength ? raw : null;
  }

  private async persistSnapshotRaw(raw: string): Promise<void> {
    await this.commitMutation(() => this.db.meta.put({ key: BM25_SNAPSHOT_KEY, value: raw, updated: Date.now() }));
  }

  private async loadSnapshot(requireSession?: () => void): Promise<BM25Snapshot> {
    const generation = this.workerGeneration;
    const worker = this.workerRuntime;
    requireSession ??= () => {
      this.requireActive();
      if (generation !== this.workerGeneration) throw new Error('rag-bm25-session-retired');
      if (worker) this.requireWorkerSession(generation, worker);
    };
    const manifest = await this.readManifest();
    requireSession();
    const storedManifest = !manifest ? await this.db.meta.get(BM25_SNAPSHOT_MANIFEST_KEY) : null;
    requireSession();
    if (storedManifest) return { raw: '', source: 'empty' };
    if (manifest) {
      if (manifest.byteLength > this.maxSnapshotBytes) {
        // 메모리 상한을 넘는 스냅샷은 다음 기회를 위해 남겨 두고 원문에서 복구한다.
        return { raw: '', source: 'empty' };
      }
      const manifestRaw = await this.readSnapshotBlocks(manifest);
      requireSession();
      if (manifestRaw !== null) return { raw: manifestRaw, source: 'manifest', manifest };
      this.logger?.warn('BM25 snapshot blocks are missing; falling back to stored documents.', {
        data: { blocks: manifest.blockCount },
      });
      await this.dropSnapshot(true);
      requireSession();
    }
    const stored = await this.db.meta.get(BM25_SNAPSHOT_KEY);
    requireSession();
    if (stored?.value) {
      return { raw: stored.value, source: 'indexeddb' };
    }
    if (!this.legacyAdapter) {
      return { raw: '', source: 'empty' };
    }
    const exists = await this.legacyAdapter.exists(this.legacyPath);
    requireSession();
    if (!exists) {
      return { raw: '', source: 'empty' };
    }
    const stat = await statLegacyPath(this.legacyAdapter, this.legacyPath);
    requireSession();
    if (stat?.type === 'file' && stat.size > this.maxSnapshotBytes) {
      return { raw: '', source: 'empty' };
    }
    const raw = await this.legacyAdapter.read(this.legacyPath);
    requireSession();
    return { raw, source: 'legacy' };
  }
}

function sameBm25Receipt(left: StoreMutationReceipt | null, right: StoreMutationReceipt | null): boolean {
  return left === null ? right === null : right !== null && left.incarnation === right.incarnation && left.mutation === right.mutation;
}

function toCorpusDocument(record: BM25DocumentRecord): BM25CorpusDocument {
  return {
    title: record.title,
    headings: record.headings,
    tags: record.tags,
    ...(record.aliases !== undefined ? { aliases: record.aliases } : {}),
    id: record.id,
    text: record.text,
    sourcePath: record.sourcePath,
    heading: record.heading,
    startLine: record.startLine,
    endLine: record.endLine,
    sourceMtime: record.sourceMtime,
    sourceSize: record.sourceSize,
    contentHash: record.contentHash,
    indexedAt: record.indexedAt,
  };
}

function normalizeCorpusDocument(document: BM25DocumentInput): BM25CorpusDocument {
  return { ...document, sourcePath: document.sourcePath ?? document.id };
}

function documentFields(document: BM25DocumentInput) {
  return {
    path: document.sourcePath ?? document.id,
    title: document.title,
    headings: document.headings ?? (document.heading ? [document.heading] : undefined),
    tags: document.tags,
  };
}

async function statLegacyPath(adapter: DataAdapter, path: string) {
  if (typeof adapter.stat !== 'function') return null;
  try {
    return await adapter.stat(path);
  } catch {
    return null;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function isBm25SnapshotManifest(value: unknown): value is BM25SnapshotManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.generation === 'string' &&
    record.generation.length > 0 &&
    typeof record.tokenizerVersion === 'number' &&
    Number.isSafeInteger(record.tokenizerVersion) && record.tokenizerVersion > 0 &&
    typeof record.lastOrder === 'number' &&
    Number.isSafeInteger(record.lastOrder) && record.lastOrder >= 0 &&
    typeof record.docCount === 'number' &&
    Number.isInteger(record.docCount) &&
    record.docCount >= 0 &&
    typeof record.byteLength === 'number' &&
    Number.isInteger(record.byteLength) &&
    record.byteLength > 0 &&
    typeof record.blockCount === 'number' &&
    Number.isInteger(record.blockCount) &&
    record.blockCount >= 1
  );
}

function normalizeMaxSnapshotBytes(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BM25_SNAPSHOT_MAX_BYTES;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeOperationOrder(record: { order?: number; updated: number }): number {
  return Number.isFinite(record.order) ? (record.order as number) : record.updated * 1000;
}

async function yieldToHost(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function awaitBm25SearchQueue(operation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return operation;
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException('BM25 search cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
