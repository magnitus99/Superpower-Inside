import type { IndexedDbDocumentCorpusStore, CorpusSourceBodyHeader } from './document-corpus-store';
import { isStoreMutationReceipt, type StoreMutationReceipt } from './durability';
import { RustLiteralInventoryTotals, LiteralCoreError, parseLiteralPage, type LiteralScannerInput, type LiteralNeedleCounts, type LiteralReference, type LiteralSourceHeader } from './literal-core';
import { scanLiteralSource } from './literal-worker-runtime';

export interface LiteralScopeSource { sourceMtime: number; sourceSize: number; contentHash: string; sourceMetadataHash: string; verified: boolean }
export interface LiteralInventoryScope {
  generationId: string;
  sources: ReadonlyMap<string, LiteralScopeSource>;
  isCurrent(): boolean;
}
export type LiteralInventoryCorpus = Pick<IndexedDbDocumentCorpusStore, 'getDurabilityReceipt' | 'getSourceBodyHeaders' | 'getSourceBodyHeader' | 'getSourceBodyBlocks' | 'putLiteralPage' | 'getLiteralPage' | 'deleteLiteralPages'>;
export interface LiteralInventorySource { corpus: LiteralInventoryCorpus; captureScope(): Promise<LiteralInventoryScope> }
export interface LiteralInventorySummary {
  matchMode: 'nfkc-unicode-lower-line-substring-v1';
  generationId: string;
  receipt: StoreMutationReceipt;
  sources: number;
  needles: LiteralNeedleCounts[];
  pageCount: number;
}
export interface LiteralInventoryPage { pageIndex: number; nextPage: number | null; references: LiteralReference[] }
export interface LiteralInventoryHandle {
  getSummary(): Promise<LiteralInventorySummary>;
  readPage(index: number): Promise<LiteralInventoryPage | null>;
  close(): Promise<void>;
}
export class LiteralInventoryError extends Error {
  constructor(readonly reason: string) { super(`rag-literal-${reason}`); this.name = 'LiteralInventoryError'; }
}
function sameReceipt(a: StoreMutationReceipt, b: unknown): boolean {
  return isStoreMutationReceipt(b) && a.version === b.version && a.incarnation === b.incarnation && a.mutation === b.mutation;
}
function sourceHeader(header: CorpusSourceBodyHeader, scope: LiteralInventoryScope): LiteralSourceHeader {
  const current = scope.sources.get(header.filePath);
  if (!current || !current.verified) throw new LiteralInventoryError('source-currentness-unverified');
  if (header.sourceMtime !== current.sourceMtime || header.sourceSize !== current.sourceSize) throw new LiteralInventoryError('source-revision-stale');
  if (header.incomplete) throw new LiteralInventoryError('source-partial');
  if (!header.body || header.body.version !== 1 || header.contentHash === null || header.sourceMetadataHash === null) throw new LiteralInventoryError('source-body-unavailable');
  if (header.contentHash !== current.contentHash || header.sourceMetadataHash !== current.sourceMetadataHash) throw new LiteralInventoryError('source-revision-stale');
  return { ...header.body, path: header.filePath, sourceMtime: current.sourceMtime, sourceSize: current.sourceSize, contentHash: header.contentHash, sourceMetadataHash: header.sourceMetadataHash, segments: header.segments.map((segment) => ({ ...segment })) };
}
function publicFailure(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return new DOMException('Literal inventory aborted.', 'AbortError');
  if (error instanceof LiteralInventoryError || error instanceof LiteralCoreError) return error;
  return new LiteralInventoryError('inventory-failed');
}

export async function openLiteralInventory(source: LiteralInventorySource, requestedNeedles: readonly string[], signal?: AbortSignal): Promise<LiteralInventoryHandle> {
  const { corpus } = source;
  const ownerId = crypto.randomUUID();
  const needles = [...requestedNeedles];
  let reducer: RustLiteralInventoryTotals | null = null;
  let closed = false;
  try {
    signal?.throwIfAborted();
    const captured = await source.captureScope();
    const scope: LiteralInventoryScope = { generationId: captured.generationId, isCurrent: () => captured.isCurrent(), sources: new Map([...captured.sources].map(([path, revision]) => [path, { ...revision }])) };
    for (const revision of scope.sources.values()) if (!revision.verified) throw new LiteralInventoryError('source-currentness-unverified');
    const receipt = await corpus.getDurabilityReceipt();
    if (!isStoreMutationReceipt(receipt)) throw new LiteralInventoryError('corpus-unverified');
    let invalidated = false;
    const current = (): void => {
      const valid = !invalidated && scope.isCurrent();
      if (!valid) invalidated = true;
      signal?.throwIfAborted();
      if (closed) throw new LiteralInventoryError('inventory-closed');
      if (!valid) throw new LiteralInventoryError('inventory-stale');
    };
    const guard = async (): Promise<void> => {
      current();
      const live = await corpus.getDurabilityReceipt();
      current();
      if (!sameReceipt(receipt, live)) { invalidated = true; throw new LiteralInventoryError('inventory-stale'); }
    };
    await guard();
    reducer = new RustLiteralInventoryTotals({ version: 1, needles, expectedSources: scope.sources.size });
    let afterPath: string | null = null;
    let pageCount = 0;
    if (scope.sources.size > 0) for (;;) {
      await guard();
      const headers = await corpus.getSourceBodyHeaders(afterPath, 1);
      await guard();
      if (headers.length === 0) break;
      const header = headers[0];
      afterPath = header.filePath;
      if (!scope.sources.has(header.filePath)) continue;
      const input = { version: 1 as const, needles, source: sourceHeader(header, scope) };
      const summary = await scanLiteralSource(input, {
        readBlock: async (index) => {
          await guard();
          const blocks = await corpus.getSourceBodyBlocks(header.filePath, index, 1);
          await guard();
          const block = blocks[0];
          if (!block || block.filePath !== header.filePath || block.index !== index) throw new LiteralInventoryError('source-block-missing');
          return block;
        },
        writePage: async (page) => {
          await guard();
          if (!Number.isSafeInteger(pageCount + 1)) throw new LiteralInventoryError('inventory-page-overflow');
          await corpus.putLiteralPage(ownerId, pageCount, JSON.stringify(page));
          await guard();
          pageCount++;
        },
      }, signal);
      await guard();
      reducer.appendSource(summary);
    }
    const totals = reducer.finish();
    await guard();
    reducer.close(); reducer = null;
    let gate = Promise.resolve();
    let closing: Promise<void> | null = null;
    const read = <T>(operation: () => Promise<T>): Promise<T> => {
      if (closed) return Promise.reject(new LiteralInventoryError('inventory-closed'));
      const task = gate.then(async () => {
        try { await guard(); const result = await operation(); await guard(); return result; }
        catch (error) { throw publicFailure(error, signal); }
      });
      gate = task.then(() => undefined, () => undefined);
      return task;
    };
    return {
      getSummary: () => read(() => Promise.resolve({ matchMode: 'nfkc-unicode-lower-line-substring-v1' as const, generationId: scope.generationId, receipt: { ...receipt }, sources: totals.sources, needles: totals.needles.map((item) => ({ ...item })), pageCount })),
      readPage: (index) => read(async () => {
        if (!Number.isSafeInteger(index) || index < 0) throw new LiteralInventoryError('inventory-page-invalid');
        if (index >= pageCount) return null;
        const payload = await corpus.getLiteralPage(ownerId, index);
        await guard();
        if (payload === null) throw new LiteralInventoryError('inventory-page-missing');
        let first: unknown;
        try {
          const value: unknown = JSON.parse(payload);
          if (typeof value === 'object' && value !== null && 'references' in value && Array.isArray(value.references)) first = (value.references as unknown[])[0];
        } catch { throw new LiteralInventoryError('inventory-page-invalid'); }
        if (typeof first !== 'object' || first === null || !('path' in first) || typeof first.path !== 'string' || !scope.sources.has(first.path)) throw new LiteralInventoryError('inventory-page-invalid');
        const header = await corpus.getSourceBodyHeader(first.path);
        await guard();
        if (!header) throw new LiteralInventoryError('inventory-page-missing');
        const input: LiteralScannerInput = { version: 1, needles, source: sourceHeader(header, scope), maxChargeBytes: 0 };
        const page = parseLiteralPage(payload, input, 256);
        return { pageIndex: index, nextPage: index + 1 < pageCount ? index + 1 : null, references: page.references };
      }),
      close: () => {
        if (!closing) {
          closed = true;
          closing = gate.then(async () => {
            try { await corpus.deleteLiteralPages(ownerId); }
            catch { throw new LiteralInventoryError('inventory-cleanup-failed'); }
          });
        }
        return closing;
      },
    };
  } catch (error) {
    closed = true;
    let failure = publicFailure(error, signal);
    try { reducer?.close(); } catch { failure = new LiteralInventoryError('inventory-close-failed'); }
    try { await corpus.deleteLiteralPages(ownerId); } catch { failure = new LiteralInventoryError('inventory-cleanup-failed'); }
    throw failure;
  }
}
