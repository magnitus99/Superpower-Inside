import { TFile, type CachedMetadata, type Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import type { AppLogger } from '../utils/logger';
import { getRagIndexingManifest, isRagFileMetadataExcluded, getRagPreparedContentVerdict, type RagFileInventory } from '../utils/vault';
import { buildSourceDocuments } from './source-document';
import { readSourceFileSnapshot } from './source-snapshot';
import { planStaleIndexSourcePathsRust, isSourceRevisionCurrentRust } from './rust-core';
import { SourceReadError } from './source-access';
import type { IndexedDbDocumentCorpusStore, DocumentCorpusFile } from './document-corpus-store';

export interface SourceBodyBackfillOptions {
  signal?: AbortSignal;
  admit?: () => boolean;
  onProgress?: (processedFiles: number) => void;
}
export type SourceBodyBackfillOutcome = 'updated' | 'unchanged' | 'stale' | 'unavailable';
export type SourceBodyBackfillResult = Record<SourceBodyBackfillOutcome, number>;

interface CorpusRefreshResult {
  documents: string[];
  skipped: number;
  partial?: number;
}

/** 파일 정책·본문 읽기·생명주기를 검색 엔진과 독립적으로 조정합니다. */
export class VaultDocumentCorpus {
  private readonly ownership = new Map<string, symbol>();
  private readonly sourceReads = new Map<string, AbortController>();
  private suspended = false;
  private refreshing: Promise<CorpusRefreshResult> | null = null;
  private candidatePaths = new Set<string>();
  private readonly readingPaths = new Set<string>();
  private readonly failedPaths = new Set<string>();

  constructor(
    private readonly vault: Vault,
    private readonly store: IndexedDbDocumentCorpusStore,
    private readonly getRagConfig: () => RAGConfig,
    private readonly getChatConfig: () => ChatConfig,
    private readonly logger: AppLogger,
    private readonly getMetadata?: (file: TFile) => CachedMetadata | null | undefined,
    private readonly onWork?: (stage: 'planning' | 'preparing-source' | 'lexical', processed: number | null, total: number | null) => void,
  ) {}

  private publishWork(stage: 'planning' | 'preparing-source' | 'lexical', processed: number | null = null, total: number | null = null): void {
    try { this.onWork?.(stage, processed, total); } catch { /* 비권위 관측 오류는 저장을 막지 않습니다. */ }
  }

  refresh(inventory?: RagFileInventory): Promise<CorpusRefreshResult> {
    if (this.suspended) return Promise.resolve({ documents: [], skipped: 0 });
    this.refreshing ??= this.refreshAllFiles(inventory).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  getFileIndexRecords() {
    return this.store.getFileIndexRecords();
  }

  hasCandidatePath(path: string): boolean {
    return this.candidatePaths.has(path);
  }

  isReadingPath(path: string): boolean {
    return this.readingPaths.has(path);
  }
  /** 초기 전체 refresh나 개별 파일 read가 끝나지 않았으면 true입니다. */
  isBusy(): boolean {
    return this.refreshing !== null || this.readingPaths.size > 0;
  }
  hasFailedPath(path: string): boolean {
    return this.failedPaths.has(path);
  }

  async refreshFile(
    file: TFile,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.writeFile(file, signal);
  }

  /** 현재 owner가 저장한 완전 파일과 부분 파일을 구분합니다. */
  private async writeFile(file: TFile, signal?: AbortSignal): Promise<'indexed' | 'skipped' | 'partial'> {
    if (this.suspended) return 'skipped';
    signal?.throwIfAborted();
    const path = file.path;
    this.sourceReads.get(path)?.abort();
    const controller = new AbortController();
    this.sourceReads.set(path, controller);
    const sourceSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const owner = Symbol(path);
    this.ownership.set(path, owner);
    this.readingPaths.add(path);
    this.failedPaths.delete(path);
    const isCurrent = (): boolean => !this.suspended && this.ownership.get(path) === owner;
    try {
      const rag = this.getRagConfig();
      if (isRagFileMetadataExcluded(this.vault, file, rag, this.getChatConfig())) {
        if (isCurrent()) await this.removeFile(path);
        return 'skipped';
      }
      const snapshot = await readSourceFileSnapshot(this.vault, file, { signal: sourceSignal, priority: 'background', preparation: { path, chunkSize: rag.chunkSize, overlap: rag.overlap } });
      signal?.throwIfAborted();
      if (!snapshot || !isCurrent()) return 'skipped';
      const verdict = getRagPreparedContentVerdict(this.vault, snapshot.file, snapshot.content, this.getRagConfig(), this.getChatConfig());
      if (verdict.kind === 'failed') throw new SourceReadError(verdict.reason ?? 'frontmatter-unreadable');
      if (verdict.kind === 'policy-excluded') { await this.removeFile(path); return 'skipped'; }
      if (!snapshot.chunks) throw new Error('Source worker chunks are unavailable.');
      this.candidatePaths.add(path);
      const documents = buildSourceDocuments(
        snapshot.file,
        snapshot.content,
        this.getRagConfig(),
        snapshot.segments,
        this.getMetadata?.(snapshot.file),
        snapshot.chunks,
        snapshot.revision.contentHash,
      );
      if (!isCurrent()) return 'skipped';
      this.publishWork('lexical');
      await this.store.replaceFileDocuments(path, documents, snapshot.sourceMetadata, snapshot.sourceMetadataHash, snapshot.revision,
        snapshot.bodyPlan ? { text: snapshot.content, plan: snapshot.bodyPlan } : undefined);
      if (!isCurrent()) return 'skipped';
      this.failedPaths.delete(path);
      return snapshot.sourceMetadata.completeness?.status === 'partial' ? 'partial' : 'indexed';
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof SourceReadError && error.reason === 'binary') {
        if (isCurrent()) await this.removeFile(path);
        return 'skipped';
      }
      if (isCurrent()) {
        this.candidatePaths.delete(path);
        this.failedPaths.add(path);
        await this.store.removeByFilePath(path);
      }
      throw error;
    } finally {
      if (this.sourceReads.get(path) === controller) this.sourceReads.delete(path);
      if (isCurrent()) this.readingPaths.delete(path);
    }
  }

  /** 구자료의 원문 capability만 보충하며 재색인·삭제·임베딩하지 않습니다. */
  async backfillSourceBody(file: TFile, options: SourceBodyBackfillOptions = {}): Promise<SourceBodyBackfillOutcome> {
    this.assertBodyBackfillAdmission(options);
    const path = file.path;
    const mtime = file.stat.mtime, size = file.stat.size, extension = file.extension;
    this.sourceReads.get(path)?.abort();
    const controller = new AbortController();
    this.sourceReads.set(path, controller);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const owner = Symbol(path);
    this.ownership.set(path, owner);
    this.readingPaths.add(path);
    const owned = (): boolean => !this.suspended && !signal.aborted && this.ownership.get(path) === owner;
    const assertCurrent = (): void => {
      this.assertBodyBackfillAdmission(options);
      if (!owned()) throw new DOMException('rag-source-body-aborted', 'AbortError');
    };
    const sameFile = (): boolean => this.vault.getAbstractFileByPath(path) === file && file.path === path && file.extension === extension && file.stat.mtime === mtime && file.stat.size === size;
    try {
      const header = await this.store.getSourceBodyHeader(path);
      assertCurrent();
      if (!header) return 'unavailable';
      if (header.body?.version === 1) return 'unchanged';
      if (header.body || header.incomplete || header.sourceMtime === null || !Number.isFinite(header.sourceMtime) || header.sourceMtime < 0 ||
          header.sourceSize === null || !Number.isSafeInteger(header.sourceSize) || header.sourceSize < 0 ||
          typeof header.contentHash !== 'string' || !/^[0-9a-f]{8}$/.test(header.contentHash) ||
          typeof header.sourceMetadataHash !== 'string' || !/^[0-9a-f]{8}$/.test(header.sourceMetadataHash)) return 'unavailable';
      if (!sameFile() || header.sourceMtime !== mtime || header.sourceSize !== size ||
          isRagFileMetadataExcluded(this.vault, file, this.getRagConfig(), this.getChatConfig())) return 'stale';
      assertCurrent();
      const snapshot = await readSourceFileSnapshot(this.vault, file, { signal, forceRefresh: true, priority: 'background', preparation: { path } });
      assertCurrent();
      if (!snapshot || !sameFile()) return 'stale';
      const verdict = getRagPreparedContentVerdict(this.vault, snapshot.file, snapshot.content, this.getRagConfig(), this.getChatConfig());
      if (verdict.kind === 'policy-excluded') return 'stale';
      const completeness = snapshot.sourceMetadata.completeness;
      if (verdict.kind !== 'candidate' || !snapshot.bodyPlan || (completeness &&
          (completeness.status !== 'complete' || completeness.missingPageCount > 0 || completeness.failures.length > 0))) return 'unavailable';
      if (snapshot.revision.contentHash !== header.contentHash || snapshot.sourceMetadataHash !== header.sourceMetadataHash ||
          snapshot.revision.sourceMtime !== header.sourceMtime || snapshot.revision.sourceSize !== header.sourceSize) return 'stale';
      const updated = await this.store.backfillSourceBody(path,
        { sourceMtime: header.sourceMtime, sourceSize: header.sourceSize, contentHash: header.contentHash, sourceMetadataHash: header.sourceMetadataHash },
        { text: snapshot.content, plan: snapshot.bodyPlan }, () => {
          assertCurrent();
          const currentPolicy = getRagPreparedContentVerdict(this.vault, snapshot.file, snapshot.content, this.getRagConfig(), this.getChatConfig());
          return currentPolicy.kind === 'candidate' && sameFile() && owned();
        });
      return updated ? 'updated' : 'stale';
    } catch (error) {
      if (!owned() || options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DOMException('rag-source-body-aborted', 'AbortError');
      return 'unavailable';
    } finally {
      if (this.sourceReads.get(path) === controller) this.sourceReads.delete(path);
      if (this.ownership.get(path) === owner) this.readingPaths.delete(path);
    }
  }

  async backfillSourceBodies(options: SourceBodyBackfillOptions = {}): Promise<SourceBodyBackfillResult> {
    const result: SourceBodyBackfillResult = { updated: 0, unchanged: 0, stale: 0, unavailable: 0 };
    let cursor: string | null = null;
    let processed = 0;
    const publish = (): void => { try { options.onProgress?.(processed); } catch { /* 비권위 관측 오류를 격리합니다. */ } };
    publish();
    while (true) {
      this.assertBodyBackfillAdmission(options);
      const headers = await this.store.getSourceBodyHeaders(cursor, 32);
      this.assertBodyBackfillAdmission(options);
      if (headers.length === 0) return result;
      for (const header of headers) {
        this.assertBodyBackfillAdmission(options);
        const file = this.vault.getAbstractFileByPath(header.filePath);
        if (!(file instanceof TFile)) result.stale++;
        else result[await this.backfillSourceBody(file, options)]++;
        this.assertBodyBackfillAdmission(options);
        processed++; publish();
      }
      cursor = headers[headers.length - 1].filePath;
    }
  }

  private assertBodyBackfillAdmission(options: SourceBodyBackfillOptions): void {
    try {
      if (!this.suspended && !options.signal?.aborted && (options.admit === undefined || options.admit()) && !this.suspended && !options.signal?.aborted) return;
    } catch { /* 외부 callback 오류나 취소 사유에 원문이 포함될 수 있습니다. */ }
    throw new DOMException('rag-source-body-aborted', 'AbortError');
  }

  /** 여러 파일의 원문을 한 트랜잭션으로 반영합니다. */
  async replaceBatchFileDocuments(
    entries: readonly DocumentCorpusFile[],
  ): Promise<void> {
    if (entries.length === 0) return;
    if (this.suspended) throw new DOMException('Source corpus is suspended.', 'AbortError');
    const owners = new Map(entries.map((entry) => [entry.filePath, Symbol(entry.filePath)]));
    for (const entry of entries) {
      this.ownership.set(entry.filePath, owners.get(entry.filePath)!);
      this.readingPaths.delete(entry.filePath);
    }
    await this.store.replaceBatchFileDocuments(entries);
    for (const entry of entries) {
      if (this.suspended || this.ownership.get(entry.filePath) !== owners.get(entry.filePath)) continue;
      this.candidatePaths.add(entry.filePath);
      this.failedPaths.delete(entry.filePath);
    }
  }

  async removeFile(path: string): Promise<void> {
    this.candidatePaths.delete(path);
    this.readingPaths.delete(path);
    this.failedPaths.delete(path);
    this.ownership.set(path, Symbol(path));
    if (!this.suspended) await this.store.removeByFilePath(path);
  }

  suspend(): void {
    this.suspended = true;
    this.ownership.clear();
    this.readingPaths.clear();
  }
  resume(): void {
    this.suspended = false;
  }
  dispose(): void {
    this.suspend();
  }

  private async refreshAllFiles(sharedInventory?: RagFileInventory): Promise<CorpusRefreshResult> {
    const result: CorpusRefreshResult = { documents: [], skipped: 0 };
    this.publishWork('planning');
    const inventory = sharedInventory ?? getRagIndexingManifest(this.vault, this.getRagConfig(), this.getChatConfig());
    const files = inventory.candidates;
    if (this.suspended) return result;
    result.skipped = inventory.failures.length + inventory.unsupported.length;
    this.candidatePaths = new Set(files.map((file) => file.path));
    for (const { file } of inventory.failures) this.failedPaths.add(file.path);
    const stalePaths = planStaleIndexSourcePathsRust(
      await this.store.getIndexedFilePaths(),
      [...files, ...inventory.failures.map(({ file }) => file)].map((file) => file.path),
      Number.MAX_SAFE_INTEGER,
    );
    if (stalePaths === null) throw new Error('Source corpus reconciliation is unavailable.');
    for (const path of stalePaths.deletePaths) await this.removeFile(path);
    const records = new Map((await this.store.getFileIndexRecords()).map((record) => [record.filePath, record]));
    // 별도 전체 refresh는 큰 버퍼를 병렬 선읽지 않으며 준비 파이프라인 호출자는 이 경로를 재호출하지 않습니다.
    let processed = 0;
    this.publishWork('preparing-source', processed, files.length);
    for (const file of files) {
      if (this.suspended) return result;
      const record = records.get(file.path);
      if (record && !this.failedPaths.has(file.path) && isSourceRevisionCurrentRust(
        { filePath: record.filePath, sourceMtime: record.sourceMtime ?? -1, sourceSize: record.sourceSize ?? -1, contentHash: record.contentHash ?? '' },
        { filePath: file.path, sourceMtime: file.stat.mtime, sourceSize: file.stat.size, contentHash: record.contentHash ?? '' },
      )) {
        result.skipped++;
      } else {
        try {
          const outcome = await this.writeFile(file);
          if (outcome === 'indexed') result.documents.push(file.path);
          else if (outcome === 'partial') result.partial = (result.partial ?? 0) + 1;
          else result.skipped++;
        } catch (error) {
          result.skipped++;
          this.logger.warn('Source corpus file refresh failed.', { source: 'rag.corpus', data: { path: file.path }, error });
        }
      }
      this.publishWork('preparing-source', ++processed, files.length);
    }
    return result;
  }
}
