import type { TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import type { AppLogger } from '../utils/logger';
import { getRagCandidateFiles, isRagCandidateFile } from '../utils/vault';
import { buildSourceDocuments } from './source-document';
import { readSourceFileSnapshot } from './source-snapshot';
import { planStaleIndexSourcePathsRust, isSourceRevisionCurrentRust } from './rust-core';
import type { IndexedDbDocumentCorpusStore } from './document-corpus-store';

/** 파일 정책·본문 읽기·생명주기를 검색 엔진과 독립적으로 조정합니다. */
export class VaultDocumentCorpus {
  private readonly ownership = new Map<string, symbol>();
  private suspended = false;
  private refreshing: Promise<void> | null = null;
  private candidatePaths = new Set<string>();
  private readonly readingPaths = new Set<string>();
  private readonly failedPaths = new Set<string>();

  constructor(
    private readonly vault: Vault,
    private readonly store: IndexedDbDocumentCorpusStore,
    private readonly getRagConfig: () => RAGConfig,
    private readonly getChatConfig: () => ChatConfig,
    private readonly logger: AppLogger,
  ) {}

  refresh(): Promise<void> {
    if (this.suspended) return Promise.resolve();
    this.refreshing ??= this.refreshAllFiles().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  hasCandidatePath(path: string): boolean {
    return this.candidatePaths.has(path);
  }

  isReadingPath(path: string): boolean {
    return this.readingPaths.has(path);
  }
  hasFailedPath(path: string): boolean {
    return this.failedPaths.has(path);
  }

  async refreshFile(file: TFile, signal?: AbortSignal): Promise<void> {
    if (this.suspended) return;
    signal?.throwIfAborted();
    const path = file.path;
    const owner = Symbol(path);
    this.ownership.set(path, owner);
    this.readingPaths.add(path);
    this.failedPaths.delete(path);
    const isCurrent = (): boolean => !this.suspended && this.ownership.get(path) === owner;
    try {
      const candidate = await isRagCandidateFile(
        this.vault,
        file,
        this.getRagConfig(),
        this.getChatConfig(),
      );
      signal?.throwIfAborted();
      if (!candidate) {
        if (isCurrent()) {
          this.candidatePaths.delete(path);
          this.failedPaths.delete(path);
          await this.store.removeByFilePath(path);
        }
        return;
      }
      const snapshot = await readSourceFileSnapshot(this.vault, file, { signal });
      signal?.throwIfAborted();
      if (!snapshot || !isCurrent()) return;
      this.candidatePaths.add(path);
      const documents = buildSourceDocuments(
        snapshot.file,
        snapshot.content,
        this.getRagConfig(),
        snapshot.segments,
      );
      if (isCurrent()) await this.store.replaceFileDocuments(path, documents);
      if (isCurrent()) this.failedPaths.delete(path);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isCurrent()) {
        this.candidatePaths.delete(path);
        this.failedPaths.add(path);
        await this.store.removeByFilePath(path);
      }
      throw error;
    } finally {
      if (isCurrent()) this.readingPaths.delete(path);
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

  private async refreshAllFiles(): Promise<void> {
    const files = await getRagCandidateFiles(this.vault, this.getRagConfig(), this.getChatConfig());
    if (this.suspended) return;
    this.candidatePaths = new Set(files.map((file) => file.path));
    const stalePaths = planStaleIndexSourcePathsRust(
      await this.store.getIndexedFilePaths(),
      files.map((file) => file.path),
      Number.MAX_SAFE_INTEGER,
    );
    if (stalePaths === null) throw new Error('Source corpus reconciliation is unavailable.');
    for (const path of stalePaths.deletePaths) await this.removeFile(path);
    const records = new Map(
      (await this.store.getFileIndexRecords()).map((record) => [record.filePath, record]),
    );
    for (const file of files) {
      if (this.suspended) return;
      const record = records.get(file.path);
      if (
        record &&
        isSourceRevisionCurrentRust(
          {
            filePath: record.filePath,
            sourceMtime: record.sourceMtime ?? -1,
            sourceSize: record.sourceSize ?? -1,
            contentHash: record.contentHash ?? '',
          },
          {
            filePath: file.path,
            sourceMtime: file.stat.mtime,
            sourceSize: file.stat.size,
            contentHash: record.contentHash ?? '',
          },
        )
      )
        continue;
      try {
        await this.refreshFile(file);
      } catch (error) {
        this.logger.warn('Source corpus file refresh failed.', {
          source: 'rag.corpus',
          data: { path: file.path },
          error,
        });
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
}
