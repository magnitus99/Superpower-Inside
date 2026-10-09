import Dexie from 'dexie';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';
import type { RetrievalCorpusStore } from './corpus-store';
import type { FileIndexRecord, VectorEntry } from './store';
import type { SourceDocument } from './source-document';

/** 벡터 생성 여부와 독립된 파일·본문 저장 계약입니다. */
export interface DocumentCorpusStore extends RetrievalCorpusStore {
  getIndexedFilePaths(): Promise<string[]>;
  getFileIndexRecords(): Promise<FileIndexRecord[]>;
}

class DocumentCorpusDB extends GeneratedArtifactDatabase {
  documents!: Dexie.Table<SourceDocument, string>;
  files!: Dexie.Table<FileIndexRecord, string>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({ documents: 'id, sourcePath', files: 'filePath' });
  }
}

export class IndexedDbDocumentCorpusStore implements DocumentCorpusStore {
  private readonly db: DocumentCorpusDB;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    this.db = new DocumentCorpusDB(name, ownership);
  }

  async replaceFileDocuments(
    filePath: string,
    documents: readonly SourceDocument[],
  ): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.files, async () => {
      await this.db.documents.where('sourcePath').equals(filePath).delete();
      await this.db.files.delete(filePath);
      const first = documents[0];
      if (!first) return;
      await this.db.documents.bulkPut([...documents]);
      await this.db.files.put({
        filePath,
        sourceMtime: first.sourceMtime,
        sourceSize: first.sourceSize,
        contentHash: first.contentHash,
        indexedAt: first.indexedAt,
        hasCompleteMetadata: true,
        // 원문 청크 수를 파일 인덱스에 기록합니다.
        vectorCount: documents.length,
        updated: first.indexedAt,
      });
    });
  }

  async removeByFilePath(filePath: string): Promise<number> {
    return this.db.transaction('rw', this.db.documents, this.db.files, async () => {
      const removed = await this.db.documents.where('sourcePath').equals(filePath).delete();
      await this.db.files.delete(filePath);
      return removed;
    });
  }

  async getEntriesByIds(ids: readonly string[]): Promise<VectorEntry[]> {
    const documents = await this.db.documents
      .where('id')
      .anyOf([...ids])
      .toArray();
    return documents.map(toDocumentEntry);
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
    await this.db.transaction('rw', this.db.documents, this.db.files, async () => {
      await this.db.documents.clear();
      await this.db.files.clear();
    });
  }

  close(): void {
    this.db.close();
  }
}

export function toDocumentEntry(document: SourceDocument): VectorEntry {
  return {
    id: document.id,
    vector: [],
    metadata: {
      filePath: document.sourcePath,
      heading: document.heading,
      startLine: document.startLine,
      endLine: document.endLine,
      text: document.text,
      sourceMtime: document.sourceMtime,
      sourceSize: document.sourceSize,
      contentHash: document.contentHash,
      chunkHash: document.chunkHash,
      indexedAt: document.indexedAt,
    },
  };
}
