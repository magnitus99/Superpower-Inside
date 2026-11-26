import Dexie from 'dexie';
import type { SourceMetadata } from './source-access';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';
import type { RetrievalCorpusStore } from './corpus-store';
import type { FileIndexRecord, VectorEntry } from './store';
import type { SourceDocument } from './source-document';
import type { RustSourceRevision } from './rust-core';
import { isRustSourceBodyPlan, type RustSourceBodyPlan, type RustSourceBodyBlockRange } from './source-body';
import { readStoreMutationReceipt, stampStoreMutation, type StoreMutationReceipt, type DurabilityMetaRecord } from './durability';

export type CorpusSourceRevision = Pick<RustSourceRevision, 'sourceMtime' | 'sourceSize' | 'contentHash'>;
export interface CorpusSourceBody {
  text: string;
  plan: RustSourceBodyPlan;
}
export type CorpusSourceBodyManifest = Omit<RustSourceBodyPlan, 'blocks'> & { blockCount: number };
export interface CorpusSourceBlock extends RustSourceBodyBlockRange {
  filePath: string;
  index: number;
  text: string;
}
export interface CorpusSourceBodyHeader {
  filePath: string;
  sourceMtime: number | null;
  sourceSize: number | null;
  contentHash: string | null;
  sourceMetadataHash: string | null;
  body: CorpusSourceBodyManifest | null;
  segments: readonly { startLine: number; endLine: number }[];
  incomplete: boolean;
}
interface CorpusFileRecord extends FileIndexRecord { sourceBody?: CorpusSourceBodyManifest }
interface LiteralLedgerPage { ownerId: string; index: number; payload: string }

export interface DocumentCorpusFile {
  sourceBody?: CorpusSourceBody;
  filePath: string;
  documents: readonly SourceDocument[];
  sourceMetadata?: SourceMetadata;
  sourceMetadataHash?: string;
  sourceRevision?: CorpusSourceRevision;
}

/** 벡터 생성 여부와 독립된 파일·본문 저장 계약입니다. */
export interface DocumentCorpusStore extends RetrievalCorpusStore {
  getIndexedFilePaths(): Promise<string[]>;
  getFileIndexRecords(): Promise<FileIndexRecord[]>;
  getDurabilityReceipt(): Promise<StoreMutationReceipt | null>;
  initializeEmptyDurabilityReceipt(): Promise<StoreMutationReceipt | null>;
  backfillSourceBody(filePath: string, expected: CorpusSourceRevision & { sourceMetadataHash: string }, sourceBody: CorpusSourceBody, admit?: () => boolean): Promise<boolean>;
  /** 여러 파일의 원문을 하나의 트랜잭션으로 교체합니다. */
  replaceBatchFileDocuments(entries: readonly DocumentCorpusFile[]): Promise<void>;
}

class DocumentCorpusDB extends GeneratedArtifactDatabase {
  documents!: Dexie.Table<SourceDocument, string>;
  files!: Dexie.Table<CorpusFileRecord, string>;
  meta!: Dexie.Table<DurabilityMetaRecord, string>;
  sourceBlocks!: Dexie.Table<CorpusSourceBlock, [string, number]>;
  literalPages!: Dexie.Table<LiteralLedgerPage, [string, number]>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({ documents: 'id, sourcePath', files: 'filePath' });
    this.version(2).stores({ documents: 'id, sourcePath', files: 'filePath', meta: 'key' });
    this.version(3).stores({ documents: 'id, sourcePath', files: 'filePath', meta: 'key', sourceBlocks: '[filePath+index], filePath', literalPages: '[ownerId+index], ownerId' });
  }
}

export class IndexedDbDocumentCorpusStore implements DocumentCorpusStore {
  private readonly db: DocumentCorpusDB;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    this.db = new DocumentCorpusDB(name, ownership);
  }

  getDurabilityReceipt(): Promise<StoreMutationReceipt | null> {
    return readStoreMutationReceipt(this.db.meta);
  }

  initializeEmptyDurabilityReceipt(): Promise<StoreMutationReceipt | null> {
    return this.db.transaction('rw', this.db.documents, this.db.files, this.db.meta, this.db.sourceBlocks, async () => {
      const existing = await readStoreMutationReceipt(this.db.meta);
      if (existing) return existing;
      if (await this.db.documents.count() || await this.db.files.count() || await this.db.sourceBlocks.count()) return null;
      return stampStoreMutation(this.db.meta);
    });
  }

  async replaceFileDocuments(
    filePath: string,
    documents: readonly SourceDocument[],
    sourceMetadata?: SourceMetadata,
    sourceMetadataHash?: string,
    sourceRevision?: CorpusSourceRevision,
    sourceBody?: CorpusSourceBody,
  ): Promise<void> {
    await this.replaceBatchFileDocuments([{ filePath, documents, sourceMetadata, sourceMetadataHash, sourceRevision, sourceBody }]);
  }

  async replaceBatchFileDocuments(entries: readonly DocumentCorpusFile[]): Promise<void> {
    if (entries.length === 0) return;
    if (new Set(entries.map((entry) => entry.filePath)).size !== entries.length) throw new Error('rag-source-batch-invalid');
    const bodies = entries.map(prepareStoredBody);
    await this.db.transaction('rw', this.db.documents, this.db.files, this.db.meta, this.db.sourceBlocks, async () => {
      const filePaths = entries.map((entry) => entry.filePath);
      await this.db.documents.where('sourcePath').anyOf(filePaths).delete();
      await this.db.files.bulkDelete(filePaths);
      await this.db.sourceBlocks.where('filePath').anyOf(filePaths).delete();
      const allDocuments: SourceDocument[] = [];
      const fileRecords: CorpusFileRecord[] = [];
      for (const [index, { filePath, documents, sourceMetadata, sourceMetadataHash, sourceRevision }] of entries.entries()) {
        const body = bodies[index];
        const first = documents[0];
        if (!first) {
          if (sourceMetadata || sourceRevision) {
            const updated = Date.now();
            fileRecords.push({ filePath, ...(body ? { sourceBody: body.manifest } : {}), ...(sourceMetadata ? { sourceMetadata } : {}), ...(sourceMetadataHash !== undefined ? { sourceMetadataHash } : {}),
              sourceMtime: sourceRevision?.sourceMtime, sourceSize: sourceRevision?.sourceSize, contentHash: sourceRevision?.contentHash,
              indexedAt: updated, hasCompleteMetadata: sourceRevision !== undefined, vectorCount: 0, updated });
          }
          continue;
        }
        for (const doc of documents) allDocuments.push(doc);
        fileRecords.push({
          ...(body ? { sourceBody: body.manifest } : {}),
          ...(sourceMetadata ? { sourceMetadata } : {}),
          ...(sourceMetadataHash !== undefined ? { sourceMetadataHash } : {}),
          filePath,
          sourceMtime: first.sourceMtime,
          sourceSize: first.sourceSize,
          contentHash: first.contentHash,
          indexedAt: first.indexedAt,
          hasCompleteMetadata: true,
          vectorCount: documents.length,
          updated: first.indexedAt,
        });
      }
      if (allDocuments.length > 0) await this.db.documents.bulkPut(allDocuments);
      if (fileRecords.length > 0) await this.db.files.bulkPut(fileRecords);
      const blocks = bodies.flatMap((body) => body?.blocks ?? []);
      if (blocks.length > 0) await this.db.sourceBlocks.bulkPut(blocks);
      await stampStoreMutation(this.db.meta);
    });
  }

  /** Native 준비 본문만 보충하며 기존 청크·메타데이터는 다시 만들지 않습니다. */
  async backfillSourceBody(
    filePath: string,
    expected: CorpusSourceRevision & { sourceMetadataHash: string },
    sourceBody: CorpusSourceBody,
    admit?: () => boolean,
  ): Promise<boolean> {
    const revision = { ...expected };
    const body = prepareStoredBody({ filePath, documents: [], sourceRevision: revision, sourceBody });
    if (!body || typeof revision.contentHash !== 'string' || typeof revision.sourceMetadataHash !== 'string' || !/^[0-9a-f]{8}$/.test(revision.sourceMetadataHash)) throw new Error('rag-source-body-invalid');
    const assertAdmitted = (): void => {
      // 재진입한 새 owner가 취소될 이 transaction을 상속하지 않게 합니다.
      try { if (admit === undefined || Dexie.ignoreTransaction(admit)) return; } catch { /* 외부 callback의 원문 오류를 노출하지 않습니다. */ }
      throw new DOMException('rag-source-body-aborted', 'AbortError');
    };
    assertAdmitted();
    try {
      return await this.db.transaction('rw', this.db.files, this.db.sourceBlocks, this.db.meta, async () => {
        assertAdmitted();
        const record = await this.db.files.get(filePath);
        assertAdmitted();
        if (!record || record.sourceBody !== undefined || record.sourceMtime !== revision.sourceMtime ||
            record.sourceSize !== revision.sourceSize || record.contentHash !== revision.contentHash ||
            record.sourceMetadataHash !== revision.sourceMetadataHash) return false;
        await this.db.sourceBlocks.where('filePath').equals(filePath).delete();
        assertAdmitted();
        if (body.blocks.length > 0) {
          await this.db.sourceBlocks.bulkPut(body.blocks);
          assertAdmitted();
        }
        await this.db.files.put({ ...record, sourceBody: body.manifest });
        assertAdmitted();
        await stampStoreMutation(this.db.meta);
        assertAdmitted();
        return true;
      });
    } catch (error) {
      if (error instanceof Dexie.AbortError || (error instanceof Error && error.name === 'AbortError')) throw new DOMException('rag-source-body-aborted', 'AbortError');
      throw error;
    }
  }

  async removeByFilePath(filePath: string): Promise<number> {
    return this.db.transaction('rw', this.db.documents, this.db.files, this.db.meta, this.db.sourceBlocks, async () => {
      const removed = await this.db.documents.where('sourcePath').equals(filePath).delete();
      await this.db.files.delete(filePath);
      await this.db.sourceBlocks.where('filePath').equals(filePath).delete();
      await stampStoreMutation(this.db.meta);
      return removed;
    });
  }

  async getSourceBodyHeaders(afterPath: string | null, limit: number): Promise<CorpusSourceBodyHeader[]> {
    assertPageLimit(limit);
    if (afterPath !== null && (typeof afterPath !== 'string' || afterPath.length > 4096)) throw new Error('rag-source-page-invalid');
    const rows = await (afterPath === null ? this.db.files.orderBy('filePath') : this.db.files.where('filePath').above(afterPath)).limit(limit).toArray();
    return rows.map(toSourceBodyHeader);
  }

  async getSourceBodyHeader(filePath: string): Promise<CorpusSourceBodyHeader | null> {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) throw new Error('rag-source-page-invalid');
    const record = await this.db.files.get(filePath);
    return record ? toSourceBodyHeader(record) : null;
  }

  async getSourceBodyBlocks(filePath: string, fromIndex: number, limit: number): Promise<CorpusSourceBlock[]> {
    assertPageLimit(limit);
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || !Number.isSafeInteger(fromIndex) || fromIndex < 0) throw new Error('rag-source-page-invalid');
    return this.db.sourceBlocks.where('[filePath+index]').between([filePath, fromIndex], [filePath, Dexie.maxKey], true, true).limit(limit).toArray();
  }

  async putLiteralPage(ownerId: string, index: number, payload: string): Promise<void> {
    assertPageAddress(ownerId, index);
    if (typeof payload !== 'string' || payload.length > 1024 * 1024 || new TextEncoder().encode(payload).byteLength > 1024 * 1024) throw new Error('rag-literal-page-invalid');
    await this.db.literalPages.put({ ownerId, index, payload });
  }

  async getLiteralPage(ownerId: string, index: number): Promise<string | null> {
    assertPageAddress(ownerId, index);
    return (await this.db.literalPages.get([ownerId, index]))?.payload ?? null;
  }

  async deleteLiteralPages(ownerId: string): Promise<void> {
    assertPageAddress(ownerId);
    await this.db.literalPages.where('ownerId').equals(ownerId).delete();
  }

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    if (ids.length === 0) return [];
    // anyOf cursor가 반환하던 primary-key 순서를 유지합니다.
    const documents = await this.db.documents.bulkGet([...new Set(ids)].sort());
    return documents
      .filter((document): document is SourceDocument => document !== undefined)
      .map(toDocumentEntry);
  }

  async getEntriesByFilePaths(paths: readonly string[]): Promise<VectorEntry[]> {
    const documents = await this.db.documents
      .where('sourcePath')
      .anyOf([...paths])
      .toArray();
    return documents.map(toDocumentEntry);
  }

  getFileIndexRecords(): Promise<FileIndexRecord[]> {
    return this.db.files.toArray();
  }

  getDocuments(): Promise<SourceDocument[]> {
    return this.db.documents.toArray();
  }

  getDocumentsByFilePath(path: string): Promise<SourceDocument[]> {
    return this.db.documents.where('sourcePath').equals(path).toArray();
  }

  async getIndexedFilePaths(): Promise<string[]> {
    return this.db.files.toCollection().primaryKeys();
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.files, this.db.meta, this.db.sourceBlocks, async () => {
      await this.db.documents.clear();
      await this.db.files.clear();
      await this.db.sourceBlocks.clear();
      await stampStoreMutation(this.db.meta);
    });
  }

  close(): void {
    this.db.close();
  }
}

function toSourceBodyHeader(record: CorpusFileRecord): CorpusSourceBodyHeader {
  return {
    filePath: record.filePath, sourceMtime: record.sourceMtime ?? null, sourceSize: record.sourceSize ?? null,
    contentHash: record.contentHash ?? null, sourceMetadataHash: record.sourceMetadataHash ?? null,
    body: record.sourceBody ?? null,
    segments: (record.sourceMetadata?.segments ?? []).map(({ startLine, endLine }) => ({ startLine, endLine })),
    incomplete: record.sourceMetadata?.completeness !== undefined && (record.sourceMetadata.completeness.status !== 'complete' || record.sourceMetadata.completeness.missingPageCount > 0 || record.sourceMetadata.completeness.failures.length > 0),
  };
}

function prepareStoredBody(entry: DocumentCorpusFile): { manifest: CorpusSourceBodyManifest; blocks: CorpusSourceBlock[] } | null {
  const body = entry.sourceBody;
  if (body === undefined) return null;
  const revision = entry.documents[0] ?? entry.sourceRevision;
  if (typeof entry.filePath !== 'string' || entry.filePath.length === 0 || entry.filePath.length > 4096 ||
      !body || typeof body.text !== 'string' || !isRustSourceBodyPlan(body.plan, body.text) ||
      !revision || !/^[0-9a-f]{8}$/.test(revision.contentHash) || !Number.isFinite(revision.sourceMtime) || revision.sourceMtime < 0 ||
      !Number.isSafeInteger(revision.sourceSize) || revision.sourceSize < 0 ||
      entry.documents.some((document) => document.sourcePath !== entry.filePath || document.contentHash !== revision.contentHash || document.sourceMtime !== revision.sourceMtime || document.sourceSize !== revision.sourceSize) ||
      (entry.sourceRevision !== undefined && (entry.sourceRevision.contentHash !== revision.contentHash || entry.sourceRevision.sourceMtime !== revision.sourceMtime || entry.sourceRevision.sourceSize !== revision.sourceSize))) throw new Error('rag-source-body-invalid');
  const { blocks, ...manifest } = body.plan;
  return {
    manifest: { ...manifest, blockCount: blocks.length },
    blocks: blocks.map((range, index) => ({ filePath: entry.filePath, index, ...range, text: body.text.slice(range.startUtf16, range.endUtf16) })),
  };
}

function assertPageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new Error('rag-source-page-invalid');
}
function assertPageAddress(ownerId: string, index?: number): void {
  if (typeof ownerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId) ||
      (index !== undefined && (!Number.isSafeInteger(index) || index < 0))) throw new Error('rag-literal-page-invalid');
}

export function toDocumentEntry(document: SourceDocument): VectorEntry {
  return {
    id: document.id,
    vector: [],
    metadata: {
      filePath: document.sourcePath,
      title: document.title,
      headings: document.headings,
      tags: document.tags,
      heading: document.heading,
      startLine: document.startLine,
      endLine: document.endLine,
      text: document.text,
      sourceMtime: document.sourceMtime,
      sourceSize: document.sourceSize,
      contentHash: document.contentHash,
      chunkHash: document.chunkHash,
      ...(document.sourceSegment !== undefined ? { sourceSegment: document.sourceSegment } : {}),
      indexedAt: document.indexedAt,
    },
  };
}
