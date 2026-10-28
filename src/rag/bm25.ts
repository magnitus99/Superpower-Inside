import Dexie from 'dexie';
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
      const hits = (item as Record<string, unknown>).hits;
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
      queries.push({ hits: parsedHits });
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
  | { kind: 'upsert-document'; record: BM25DocumentRecord }
  | { kind: 'mutation'; record: BM25MutationRecord };

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

  async load(): Promise<void> {
    this.runtime?.dispose();
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
    this.workerGeneration += 1;
    if (this.workerFactory || canUseBM25Worker()) {
      const worker = new BM25WorkerRuntime(this.workerFactory);
      this.workerRuntime = worker;
      const initialization = (async () => {
        const snapshot = await this.loadSnapshot();
        const raw = snapshot.raw.trim();
        const usableRaw = raw.length > 0 && raw.length <= this.maxSnapshotBytes ? raw : '';
        const manifest = usableRaw.length > 0 ? snapshot.manifest : undefined;
        const state = await worker.initialize(
          this.db.name,
          usableRaw,
          manifest?.lastOrder,
          manifest?.docCount,
        );
        let finalState = state;
        if (state.snapshotRejected) {
          // 손상 스냅샷은 폐기하고 저장된 원문에서 전량 복구한다.
          await this.dropSnapshot();
          finalState = await worker.initialize(this.db.name, '', undefined, undefined);
        }
        this.applyWorkerState(finalState);
        this.restoreMode = manifest && !state.snapshotRejected ? 'snapshot+delta' : 'full';
        if (manifest && !state.snapshotRejected) {
          this.activeManifest = manifest;
          this.ordersSinceSnapshot = 0;
          this.removalsSinceSnapshot = 0;
          await this.db.meta.delete(BM25_SNAPSHOT_KEY);
        }
        this.runtime = null;
        this.loaded = true;
        if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
          await this.persistSnapshotRaw(raw);
        }
        await this.sweepOrphanSnapshotBlocks();
      })();
      // 초기화 중 들어온 파일 변경도 hydration 완료 뒤 같은 worker에 순서대로 적용한다.
      this.workerQueue = initialization;
      try {
        await initialization;
        return;
      } catch (error) {
        worker.close();
        // 닫힌 작업자를 남겨 다음 준비에서도 재초기화를 시도할 수 있게 합니다.
        this.loaded = false;
        throw error;
      }
    }
    const snapshot = await this.loadSnapshot();
    if (snapshot.manifest) {
      // 작업자 없는 세션은 tombstone 델타를 남길 수 없으므로 스냅샷을 버리고 원문에서 재구성한다.
      await this.dropSnapshot();
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
      this.runtime.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    await this.replayPersistedOperations();
    this.loaded = true;
    if (snapshot.source === 'legacy' && raw.length <= this.maxSnapshotBytes) {
      await this.persistSnapshotRaw(raw);
    }
    await this.sweepOrphanSnapshotBlocks();
  }

  async persist(): Promise<void> {
    if (this.batchDepth > 0) {
      this.batchDirty = true;
      return;
    }
    await this.persistNow();
  }

  async withBatch<T>(operation: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await operation();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchDirty) {
        await this.persistNow();
      }
    }
  }

  private async persistNow(): Promise<void> {
    const operations = [...this.pendingOperations];
    if (operations.length === 0) {
      this.batchDirty = false;
      return;
    }
    // 스냅샷 델타는 작업자 세션에서만 유효하므로 tombstone도 그때만 남긴다.
    const removalRecords: BM25RemovalRecord[] = [];
    if (this.workerRuntime) {
      for (const operation of operations) {
        if (operation.kind === 'mutation') {
          removalRecords.push({
            order: operation.record.order,
            kind: operation.record.kind,
            target: operation.record.target,
            updated: operation.record.updated,
          });
        }
      }
    }
    await this.db.transaction(
      'rw',
      this.db.documents,
      this.db.mutations,
      this.db.removals,
      async () => {
        for (const operation of operations) {
          if (operation.kind === 'upsert-document') {
            await this.db.documents.put(operation.record);
            continue;
          }
          await this.persistMutationOperation(operation.record);
        }
        if (removalRecords.length > 0) await this.db.removals.bulkPut(removalRecords);
      },
    );
    this.pendingOperations = this.pendingOperations.slice(operations.length);
    this.batchDirty = false;
    this.removalsSinceSnapshot += removalRecords.length;
    await this.enforceRemovalLogBound();
    await this.captureSnapshotIfDue();
  }

  async clear(): Promise<void> {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.clear());
      });
    } else {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    this.queueMutation('clear', '*');
    await this.persist();
    await this.dropSnapshot();
  }

  async deleteDatabase(): Promise<void> {
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
    if (this.workerRuntime) {
      await this.withBatch(() => {
        this.queueMutation('clear', '*', false);
        for (const document of documents) {
          this.queueDocument(normalizeCorpusDocument(document), false);
        }
        this.batchDirty = true;
        return Promise.resolve();
      });
      const workerDocuments = documents.map((document) => ({
        ...document,
        ...documentFields(document),
        id: document.id,
        text: document.text,
        sourcePath: document.sourcePath ?? document.id,
      }));
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.rebuild(workerDocuments));
      });
      await this.workerQueue;
      // 재구성된 런타임은 직렬화 스냅샷과 어긋나므로 이전 세대를 버린다.
      await this.dropSnapshot();
      if (this.workerFailure) throw this.workerFailure;
      return;
    }
    await this.withBatch(async () => {
      this.runtime?.dispose();
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
      this.queueMutation('clear', '*', false);
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        if (document === undefined) continue;
        this.ensureRuntime().addDocumentFields(
          document.id,
          document.text,
          document.sourcePath ?? document.id,
          documentFields(document),
          TOKENIZER_VERSION,
        );
        this.queueDocument(normalizeCorpusDocument(document), false);
        if (index + 1 < documents.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) {
          await yieldToHost();
        }
      }
      await this.persist();
    });
  }

  async rebuildFrom(createDocuments: () => Promise<readonly BM25DocumentInput[]>): Promise<void> {
    if (this.rebuildReplayOperations !== null) {
      throw new Error('BM25 rebuild is already in progress.');
    }
    this.rebuildReplayOperations = [];
    let rebuildStarted = false;
    let rebuildError: Error | null = null;
    try {
      const documents = await createDocuments();
      rebuildStarted = true;
      await this.rebuild(documents);
    } catch (error) {
      rebuildError = error instanceof Error ? error : new Error(String(error));
    }

    const replayOperations = this.rebuildReplayOperations ?? [];
    this.rebuildReplayOperations = null;
    if (rebuildStarted && replayOperations.length > 0) {
      await this.replayOperationsAfterRebuild(replayOperations);
    }
    if (rebuildError) throw rebuildError;
  }

  addDocument(docId: string, text: string, sourcePath = docId): void {
    this.addCorpusDocument({ id: docId, text, sourcePath });
  }

  addCorpusDocument(document: BM25CorpusDocument): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(
          await worker.add({
            ...document,
            ...documentFields(document),
            id: document.id,
            text: document.text,
            sourcePath: document.sourcePath,
          }),
        );
      });
    } else {
      this.ensureRuntime().addDocumentFields(
        document.id,
        document.text,
        document.sourcePath,
        documentFields(document),
        TOKENIZER_VERSION,
      );
    }
    this.queueDocument(document);
  }

  removeDocument(docId: string): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeDocument(docId));
      });
    } else {
      this.ensureRuntime().removeDocument(docId, TOKENIZER_VERSION);
    }
    this.queueMutation('remove-doc', docId);
  }

  removeDocumentsBySource(sourcePath: string): void {
    if (this.workerRuntime) {
      this.enqueueWorkerMutation(async (worker) => {
        this.applyWorkerState(await worker.removeSource(sourcePath));
      });
    } else {
      this.ensureRuntime().removeSource(sourcePath, TOKENIZER_VERSION);
    }
    this.queueMutation('remove-source', sourcePath);
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
  get restoreProgress(): { processedDocuments: number; expectedDocuments: number } | null {
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
    // 복구할 작업자가 없으면 초기 적재·변이 대기열에 호출자를 붙잡아 두지 않습니다.
    if (!this.workerRuntime?.isClosed) return;
    this.recovery ??= this.workerQueue
      // 초기화 실패로 거절된 대기열도 복구 진입을 막지 않습니다.
      .catch(() => undefined)
      .then(async () => {
        // 기록 대기 중인 변경을 먼저 저장하고 같은 코퍼스에서 작업자만 복원한다.
        await this.persist();
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
    await this.persist();
    const updated = Date.now();
    return this.db.documents.where('sourcePath').equals(sourcePath).modify((record) => {
      record.sourceMtime = revision.sourceMtime;
      record.sourceSize = revision.sourceSize;
      record.contentHash = revision.contentHash;
      record.updated = updated;
    });
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
    if (this.runtime === null) {
      this.runtime = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    }
    if (this.runtime === null) {
      throw new Error('Rust BM25 runtime is unavailable');
    }
    return this.runtime;
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
    const task = this.workerQueue.then(() => operation(worker));
    this.workerQueue = task.then(
      () => undefined,
      (error: unknown) => {
        this.workerFailure = error instanceof Error ? error : new Error(String(error));
        this.workerReady = false;
        worker.close(this.workerFailure);
      },
    );
    return task;
  }

  private applyWorkerState(state: {
    ready?: boolean;
    tokenizerCurrent?: boolean;
    totalDocs?: number;
  }): void {
    this.workerReady = state.ready ?? false;
    this.workerTokenizerCurrent = state.tokenizerCurrent ?? false;
    this.workerTotalDocs = state.totalDocs ?? 0;
  }

  private async replayPersistedOperations(): Promise<void> {
    const [documents, mutations] = await Promise.all([
      this.db.documents.toArray(),
      this.db.mutations.toArray(),
    ]);
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

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      if (!operation) continue;
      if (operation.kind === 'upsert-document') {
        this.ensureRuntime().addDocumentFields(
          operation.record.id,
          operation.record.text,
          operation.record.sourcePath,
          documentFields(operation.record),
          TOKENIZER_VERSION,
        );
      } else {
        this.applyMutation(operation.record);
      }
      if (index + 1 < operations.length && (index + 1) % BM25_REBUILD_YIELD_INTERVAL === 0) {
        await yieldToHost();
      }
    }
    this.pendingOperations = [];
    this.batchDirty = false;
    if (mutations.length > 0) {
      await this.db.mutations.clear();
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

  private async replayOperationsAfterRebuild(
    operations: readonly BM25PendingOperation[],
  ): Promise<void> {
    await this.withBatch(async () => {
      for (const operation of operations) {
        if (operation.kind === 'upsert-document') {
          const document = toCorpusDocument(operation.record);
          if (this.workerRuntime) {
            this.enqueueWorkerMutation(async (worker) => {
              this.applyWorkerState(
                await worker.add({
                  ...document,
                  ...documentFields(document),
                  id: document.id,
                  text: document.text,
                  sourcePath: document.sourcePath,
                }),
              );
            });
          } else {
            this.ensureRuntime().addDocumentFields(
              document.id,
              document.text,
              document.sourcePath,
              documentFields(document),
              TOKENIZER_VERSION,
            );
          }
        } else if (this.workerRuntime) {
          const mutation = operation.record;
          this.enqueueWorkerMutation(async (worker) => {
            if (mutation.kind === 'clear') {
              this.applyWorkerState(await worker.clear());
            } else if (mutation.kind === 'remove-doc') {
              this.applyWorkerState(await worker.removeDocument(mutation.target));
            } else {
              this.applyWorkerState(await worker.removeSource(mutation.target));
            }
          });
        } else {
          this.applyMutation(operation.record);
        }
        this.pendingOperations.push(operation);
      }
      await this.persist();
    });
    await this.workerQueue;
    if (this.workerFailure) throw this.workerFailure;
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

  private queueDocument(document: BM25CorpusDocument, captureForRebuild = true): void {
    const now = Date.now();
    const operation: BM25PendingOperation = {
      kind: 'upsert-document',
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
    this.ordersSinceSnapshot += 1;
    if (captureForRebuild) {
      this.rebuildReplayOperations?.push(operation);
    }
  }

  private queueMutation(
    kind: BM25MutationRecord['kind'],
    target: string,
    captureForRebuild = true,
  ): void {
    const now = Date.now();
    const order = this.nextOperationOrder();
    const operation: BM25PendingOperation = {
      kind: 'mutation',
      record: {
        id: `${kind}:${target}:${order}`,
        kind,
        target,
        updated: now,
        order,
      },
    };
    this.pendingOperations.push(operation);
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
    if (!this.workerRuntime || this.workerFailure || !this.loaded) return false;
    if (this.batchDepth > 0 || this.snapshotCaptureInFlight || this.pendingOperations.length > 0) {
      return false;
    }
    if (!force) {
      if (this.ordersSinceSnapshot < this.snapshotMinOrders) return false;
      if (Date.now() - this.lastSnapshotAt < this.snapshotIntervalMs) return false;
    }
    this.snapshotCaptureInFlight = true;
    // watermark는 직렬화 작업을 대기열에 넣는 이 시점의 순서여야 한다.
    const lastOrder = this.nextOperationOrderValue;
    const worker = this.workerRuntime;
    try {
      await this.enqueueWorkerTask(async () => {
        const raw = await worker.serialize();
        if (raw.length === 0 || raw.length > this.maxSnapshotBytes) {
          this.lastSnapshotAt = Date.now();
          return;
        }
        await this.commitSnapshot(raw, lastOrder, await this.db.documents.count());
      });
    } catch (error) {
      this.logger?.warn('BM25 snapshot capture failed; keeping the previous snapshot.', {
        error,
      });
      return false;
    } finally {
      this.snapshotCaptureInFlight = false;
    }
    return this.activeManifest !== null;
  }

  /** 블록을 먼저 쓰고 manifest 1건을 마지막에 써서 원자적으로 세대를 교체합니다. */
  private async commitSnapshot(raw: string, lastOrder: number, docCount: number): Promise<void> {
    const generation = crypto.randomUUID();
    const blockCount = Math.max(1, Math.ceil(raw.length / BM25_SNAPSHOT_BLOCK_BYTES));
    const manifest: BM25SnapshotManifest = {
      generation,
      tokenizerVersion: TOKENIZER_VERSION,
      lastOrder,
      docCount,
      byteLength: raw.length,
      blockCount,
    };
    try {
      for (let index = 0; index < blockCount; index++) {
        await this.writeSnapshotBlock(
          `${generation}:${index}`,
          raw.slice(index * BM25_SNAPSHOT_BLOCK_BYTES, (index + 1) * BM25_SNAPSHOT_BLOCK_BYTES),
        );
      }
      await this.db.meta.put({
        key: BM25_SNAPSHOT_MANIFEST_KEY,
        value: JSON.stringify(manifest),
        updated: Date.now(),
      });
    } catch (error) {
      this.lastSnapshotAt = Date.now();
      await this.deleteSnapshotBlocks(generation, blockCount).catch(() => undefined);
      this.logger?.warn('BM25 snapshot commit failed; keeping the previous snapshot.', {
        error,
      });
      return;
    }
    const previous = this.activeManifest;
    this.activeManifest = manifest;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.lastSnapshotAt = Date.now();
    try {
      if (previous && previous.generation !== generation) {
        await this.deleteSnapshotBlocks(previous.generation, previous.blockCount);
      }
      await this.db.removals.where('order').belowOrEqual(lastOrder).delete();
      await this.db.meta.delete(BM25_SNAPSHOT_KEY);
    } catch (error) {
      // 정리는 실패해도 새 스냅샷 자체는 유효하므로 다음 캡처에서 다시 시도한다.
      this.logger?.warn('BM25 snapshot cleanup failed.', {
        error,
      });
    }
  }

  /** 스냅샷과 tombstone 로그를 버리고 다음 복구를 전량 재구성으로 되돌립니다. */
  private async dropSnapshot(): Promise<void> {
    const manifest = this.activeManifest ?? (await this.readManifest());
    this.activeManifest = null;
    this.ordersSinceSnapshot = 0;
    this.removalsSinceSnapshot = 0;
    this.restoreMode = 'full';
    try {
      await this.db.meta.delete(BM25_SNAPSHOT_MANIFEST_KEY);
      if (manifest) await this.deleteSnapshotBlocks(manifest.generation, manifest.blockCount);
      await this.db.removals.clear();
    } catch (error) {
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
    await this.db.snapshotBlocks.put({ key, data });
  }

  private async deleteSnapshotBlocks(generation: string, blockCount: number): Promise<void> {
    const keys = Array.from({ length: blockCount }, (_, index) => `${generation}:${index}`);
    await this.db.snapshotBlocks.bulkDelete(keys);
  }

  /**
   * 재시작 sweep: 활성 세대가 아닌 블록만 키 prefix 기준으로 정리합니다.
   * 캡처 도중 죽어 남은 세대와 폐기된 세대를 함께 회수합니다.
   */
  private async sweepOrphanSnapshotBlocks(): Promise<void> {
    const activeGeneration = this.activeManifest?.generation ?? null;
    try {
      const keys = await this.db.snapshotBlocks.toCollection().primaryKeys();
      const orphans = keys.filter(
        (key) => activeGeneration === null || !key.startsWith(`${activeGeneration}:`),
      );
      if (orphans.length === 0) return;
      await this.db.snapshotBlocks.bulkDelete(orphans);
      this.logger?.warn('BM25 orphan snapshot blocks were removed.', {
        data: { blocks: orphans.length },
      });
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
      await this.db.meta.delete(BM25_SNAPSHOT_MANIFEST_KEY);
      await this.db.snapshotBlocks.clear();
      await this.db.removals.clear();
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
    await this.db.meta.put({
      key: BM25_SNAPSHOT_KEY,
      value: raw,
      updated: Date.now(),
    });
  }

  private async loadSnapshot(): Promise<BM25Snapshot> {
    const manifest = await this.readManifest();
    if (manifest) {
      if (manifest.byteLength > this.maxSnapshotBytes) {
        // 메모리 상한을 넘는 스냅샷은 다음 기회를 위해 남겨 두고 원문에서 복구한다.
        return { raw: '', source: 'empty' };
      }
      const manifestRaw = await this.readSnapshotBlocks(manifest);
      if (manifestRaw !== null) return { raw: manifestRaw, source: 'manifest', manifest };
      this.logger?.warn('BM25 snapshot blocks are missing; falling back to stored documents.', {
        data: { blocks: manifest.blockCount },
      });
      await this.dropSnapshot();
    }
    const stored = await this.db.meta.get(BM25_SNAPSHOT_KEY);
    if (stored?.value) {
      return { raw: stored.value, source: 'indexeddb' };
    }
    if (!this.legacyAdapter) {
      return { raw: '', source: 'empty' };
    }
    if (!(await this.legacyAdapter.exists(this.legacyPath))) {
      return { raw: '', source: 'empty' };
    }
    const stat = await statLegacyPath(this.legacyAdapter, this.legacyPath);
    if (stat?.type === 'file' && stat.size > this.maxSnapshotBytes) {
      return { raw: '', source: 'empty' };
    }
    return { raw: await this.legacyAdapter.read(this.legacyPath), source: 'legacy' };
  }
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
    record.tokenizerVersion === TOKENIZER_VERSION &&
    typeof record.lastOrder === 'number' &&
    Number.isFinite(record.lastOrder) &&
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
