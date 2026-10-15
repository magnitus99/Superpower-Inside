import Dexie from 'dexie';
import {
  GeneratedArtifactDatabase,
  type GeneratedArtifactBinding,
} from '../storage/generated-artifacts';
import type { PdfSourceText } from './pdf-worker-runtime';

export const PDF_EXTRACTOR_VERSION = 'pdfjs-5.4.54-tesseract-7-kor-eng-v3';

interface CachedPdf {
  path: string;
  mtime: number;
  size: number;
  version: string;
  usedAt: number;
  source: PdfSourceText;
}

class PdfSourceCacheDB extends GeneratedArtifactDatabase {
  sources!: Dexie.Table<CachedPdf, string>;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    super(name, ownership);
    this.version(1).stores({ sources: 'path, usedAt' });
  }
}

/** OCR 본문은 볼트별 로컬 IndexedDB에만 저장하며 최근 8개 파일로 제한합니다. */
export class PdfSourceCache {
  private readonly db: PdfSourceCacheDB;

  constructor(name: string, ownership?: GeneratedArtifactBinding) {
    this.db = new PdfSourceCacheDB(name, ownership);
  }

  async get(
    path: string,
    mtime: number,
    size: number,
    version = PDF_EXTRACTOR_VERSION,
  ): Promise<PdfSourceText | undefined> {
    const row = await this.db.sources.get(path);
    if (row?.mtime !== mtime || row.size !== size || row.version !== version) return undefined;
    await this.db.sources.update(path, { usedAt: Date.now() });
    return row.source;
  }

  async put(path: string, mtime: number, size: number, source: PdfSourceText): Promise<void> {
    await this.db.transaction('rw', this.db.sources, async () => {
      await this.db.sources.put({
        path,
        mtime,
        size,
        version: PDF_EXTRACTOR_VERSION,
        usedAt: Date.now(),
        source,
      });
      await this.db.sources.orderBy('usedAt').reverse().offset(8).delete();
    });
  }

  close(): void {
    this.db.close();
  }

  delete(): Promise<void> {
    return this.db.delete();
  }
}
