import type { StoreMutationReceipt } from './durability';
import { TOKENIZER_VERSION } from './tokenizer-version';

export const BM25_POSTING_KEY = 'bm25-posting-checkpoint:v1';
export const BM25_POSTING_STAGE_KEY = 'bm25-posting-staging:v1';
export const BM25_POSTING_PAGE_BYTES = 1024 * 1024;
export const BM25_POSTING_CHECKSUM_SEED = 0x811c9dc5;
const MIN_PAGE_BYTES = 17;
// v1 keys are decimal (not lexically ordered); queue exact keys with at most 4 MiB in flight.
const READ_BATCH_PAGES = 4;

export interface BM25PostingReadTiming {
  pages: number;
  bytes: number;
  dbOpenMs: number;
  readWaitMs: number;
  checksumMs: number;
  transactionSettleMs: number;
}

export interface BM25PostingWorkerTiming extends BM25PostingReadTiming {
  wasmInitMs: number;
  importMs: number;
  sealMs: number;
  deltaMs: number;
  workerMs: number;
  progressMessages: number;
  workerProgressMs: number;
}

export interface BM25PostingRestoreTiming extends BM25PostingWorkerTiming {
  requestRoundTripMs: number;
  hostDispatchAndDeliveryMs: number;
  headRecheckMs: number;
}

/** Diagnostic only: reconstruct numeric keys rather than passing arbitrary worker data to the logger. */
export function parseBm25PostingWorkerTiming(value: unknown, manifest: BM25PostingManifest): BM25PostingWorkerTiming | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.pages !== manifest.blockCount || record.bytes !== manifest.byteLength ||
      typeof record.progressMessages !== 'number' || !Number.isSafeInteger(record.progressMessages) ||
      record.progressMessages < 0 || record.progressMessages > manifest.blockCount) return null;
  const values = {} as Omit<BM25PostingWorkerTiming, 'pages' | 'bytes' | 'progressMessages'>;
  for (const key of ['dbOpenMs', 'readWaitMs', 'checksumMs', 'transactionSettleMs', 'wasmInitMs', 'importMs', 'sealMs', 'deltaMs', 'workerMs', 'workerProgressMs'] as const) {
    const amount = record[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
    values[key] = amount;
  }
  return { ...values, pages: manifest.blockCount, bytes: manifest.byteLength, progressMessages: record.progressMessages };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The base is immutable. Only the live head is advanced alongside a projection mutation. */
export interface BM25PostingManifest {
  version: 1;
  tokenizerVersion: number;
  generation: string;
  lastOrder: number;
  sourceReceipt: StoreMutationReceipt | null;
  headOrder: number;
  headReceipt: StoreMutationReceipt | null;
  docCount: number;
  byteLength: number;
  blockCount: number;
  checksum: number;
}

export function isBm25PostingId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function sameBm25PostingReceipt(left: StoreMutationReceipt | null, right: StoreMutationReceipt | null): boolean {
  return left === null ? right === null : right !== null && left.incarnation === right.incarnation && left.mutation === right.mutation;
}

export function isBm25PostingManifest(value: unknown, requireCurrentTokenizer = true): value is BM25PostingManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const integer = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
  // Keep the worker wire check independent of the host Dexie implementation.
  const receipt = (value: unknown): value is StoreMutationReceipt | null => {
    if (value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value) || !value) return false;
    const { version, incarnation, mutation } = value as Record<string, unknown>;
    return Object.keys(value).length === 3 && version === 1 && isBm25PostingId(incarnation) && isBm25PostingId(mutation);
  };
  return Object.keys(record).length === 11 && record.version === 1 &&
    (requireCurrentTokenizer ? record.tokenizerVersion === TOKENIZER_VERSION : integer(record.tokenizerVersion, 1, 0xffff_ffff)) &&
    isBm25PostingId(record.generation) && integer(record.lastOrder, 0) && integer(record.headOrder, record.lastOrder) &&
    receipt(record.sourceReceipt) && receipt(record.headReceipt) &&
    (record.headOrder === record.lastOrder
      ? sameBm25PostingReceipt(record.sourceReceipt, record.headReceipt)
      : record.headReceipt !== null && (record.sourceReceipt === null || record.sourceReceipt.incarnation === record.headReceipt.incarnation)) &&
    integer(record.docCount, 1, 0xffff_ffff) && integer(record.blockCount, Math.ceil(record.docCount / 256), record.docCount) &&
    integer(record.byteLength, MIN_PAGE_BYTES * record.blockCount, BM25_POSTING_PAGE_BYTES * record.blockCount) &&
    integer(record.checksum, 0, 0xffff_ffff);
}

export function bm25PostingPrefix(generation: string): string {
  return `posting:${generation}:`;
}

export function bm25PostingKey(generation: string, block: number): string {
  return `${bm25PostingPrefix(generation)}${block}`;
}

export function isBm25PostingPage(data: unknown): data is Uint8Array {
  return data instanceof Uint8Array && data.byteLength >= MIN_PAGE_BYTES && data.byteLength <= BM25_POSTING_PAGE_BYTES;
}

/** Limit cumulative allocation to the manifest count; Rust validates the untrusted page header. */
export function declaredBm25PostingPageDocuments(page: Uint8Array): number {
  return new DataView(page.buffer, page.byteOffset, page.byteLength).getUint32(8, true);
}

/** Non-cryptographic integrity check of the ordered bytestream. */
export function checksumBm25PostingPage(checksum: number, page: Uint8Array): number {
  for (let i = 0; i < page.length; i++) checksum = Math.imul(checksum ^ page[i], 0x01000193);
  return checksum >>> 0;
}

/** Read ordered bounded groups in one readonly snapshot of the v1 block store. */
export function readBm25PostingPages(dbName: string, manifest: BM25PostingManifest, consume: (page: Uint8Array, part: number) => void): Promise<BM25PostingReadTiming> {
  return new Promise((resolve, reject) => {
    const opening = performance.now();
    const opened = indexedDB.open(dbName);
    opened.onupgradeneeded = () => opened.transaction?.abort();
    opened.onerror = () => reject(opened.error ?? new Error('BM25 posting DB open failed.'));
    opened.onsuccess = () => {
      const dbOpenMs = performance.now() - opening;
      const db = opened.result;
      if (!db.objectStoreNames.contains('snapshotBlocks')) {
        db.close(); reject(new Error('Missing BM25 posting store.')); return;
      }
      const tx = db.transaction('snapshotBlocks', 'readonly');
      const store = tx.objectStore('snapshotBlocks');
      let failure: unknown;
      let pages = 0;
      let bytes = 0;
      let checksum = BM25_POSTING_CHECKSUM_SEED;
      let checksumMs = 0;
      let readWaitMs = 0;
      let finished = performance.now();
      const read = (): void => {
        const end = Math.min(pages + READ_BATCH_PAGES, manifest.blockCount);
        const queued = performance.now();
        const batch: { key: string; request: IDBRequest<unknown> }[] = [];
        for (let part = pages; part < end; part++) {
          const key = bm25PostingKey(manifest.generation, part);
          batch.push({ key, request: store.get(key) });
        }
        const last = batch.at(-1);
        if (!last) return;
        // IDB requests complete in enqueue order within a transaction.
        last.request.onsuccess = () => {
          readWaitMs += performance.now() - queued;
          try {
            for (const { key, request } of batch) {
              const row = request.result as { key?: unknown; data?: unknown } | undefined;
              if (row?.key !== key || !isBm25PostingPage(row.data)) throw new Error('Missing or invalid BM25 posting block.');
              bytes += row.data.byteLength;
              if (bytes > manifest.byteLength) throw new Error('Invalid BM25 posting byte length.');
              const hashing = performance.now();
              checksum = checksumBm25PostingPage(checksum, row.data);
              checksumMs += performance.now() - hashing;
              consume(row.data, pages++);
            }
            if (pages < manifest.blockCount) read();
            else finished = performance.now();
          } catch (error) { failure = error; tx.abort(); }
        };
      };
      tx.onabort = () => { db.close(); reject(failure instanceof Error ? failure : tx.error ?? new Error('BM25 posting read aborted.')); };
      tx.oncomplete = () => {
        db.close();
        if (pages !== manifest.blockCount || bytes !== manifest.byteLength || checksum !== manifest.checksum) reject(new Error('BM25 posting checksum mismatch.'));
        else resolve({ pages, bytes, dbOpenMs, readWaitMs, checksumMs, transactionSettleMs: performance.now() - finished });
      };
      read();
    };
  });
}
