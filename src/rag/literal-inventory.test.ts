import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { IndexedDbDocumentCorpusStore, type DocumentCorpusFile } from './document-corpus-store';
import { buildSourceDocuments } from './source-document';
import { prepareSourceTextRust } from './rust-core';
import type { SourceMetadata } from './source-access';
import { openLiteralInventory, type LiteralInventorySource, type LiteralInventoryScope, type LiteralInventoryHandle } from './literal-inventory';

const stores: IndexedDbDocumentCorpusStore[] = [], names: string[] = [];
const handles: LiteralInventoryHandle[] = [];
afterEach(async () => {
  await Promise.allSettled(handles.splice(0).map((handle) => handle.close()));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
  vi.restoreAllMocks();
});
function entry(text: string, path = 'synthetic/source.txt', metadata: SourceMetadata = { segments: [] }): DocumentCorpusFile {
  const config = { chunkSize: 12, overlap: 4 };
  const source = { ok: true, reason: null, format: 'text', text, ...metadata, segments: [...metadata.segments] };
  const result = prepareSourceTextRust('txt', source, { path, ...config });
  const prepared = result?.prepared;
  if (!prepared?.bodyPlan) throw new Error('literal-test-preparation-missing');
  const sourceSize = new TextEncoder().encode(text).length;
  const file = { path, name: path.split('/').at(-1), basename: 'source', extension: 'txt', stat: { mtime: 1, size: sourceSize } } as TFile;
  const documents = buildSourceDocuments(file, text, config, metadata.segments, undefined, prepared.chunks, prepared.contentHash);
  return { filePath: path, documents, sourceMetadata: metadata, sourceMetadataHash: prepared.sourceMetadataHash, sourceRevision: { contentHash: prepared.contentHash, sourceMtime: 1, sourceSize }, sourceBody: { text, plan: prepared.bodyPlan } };
}
async function fixture(entries: DocumentCorpusFile[]) {
  const name = `literal-inventory:${crypto.randomUUID()}`; names.push(name);
  const corpus = new IndexedDbDocumentCorpusStore(name); stores.push(corpus);
  if (entries.length) await corpus.replaceBatchFileDocuments(entries);
  else await corpus.initializeEmptyDurabilityReceipt();
  let current = true;
  const scope: LiteralInventoryScope = { generationId: 'synthetic-generation', sources: new Map(entries.map((item) => [item.filePath, { sourceMtime: item.sourceRevision?.sourceMtime ?? 1, sourceSize: item.sourceRevision?.sourceSize ?? 0, contentHash: item.sourceRevision?.contentHash ?? '', sourceMetadataHash: item.sourceMetadataHash ?? '', verified: true }])), isCurrent: () => current };
  const source: LiteralInventorySource = { corpus, captureScope: () => Promise.resolve(scope) };
  return { corpus, source, scope, invalidate: () => { current = false; } };
}
async function open(source: LiteralInventorySource, needles: string[], signal?: AbortSignal) {
  const handle = await openLiteralInventory(source, needles, signal); handles.push(handle); return handle;
}

describe('원문 literal inventory의 I/O·소유권 경계', () => {
  it('overlap 청크를 합치지 않고 같은 원문의 발생·행·문서를 별도로 센다', async () => {
    const data = entry('aaaaa\n항구시험의 항구시험은\nneedle needle\n');
    const { corpus, source } = await fixture([data]);
    const chunks = vi.spyOn(corpus, 'getEntriesByFilePaths').mockRejectedValue(new Error('literal-test-chunks-forbidden'));
    const all = vi.spyOn(corpus, 'getFileIndexRecords').mockRejectedValue(new Error('literal-test-metadata-all-forbidden'));
    const blocks = vi.spyOn(corpus, 'getSourceBodyBlocks');
    const receipt = await corpus.getDurabilityReceipt();
    const handle = await open(source, ['aa', '항구시험', 'needle']);
    const summary = await handle.getSummary();
    expect(summary).toMatchObject({ matchMode: 'nfkc-unicode-lower-line-substring-v1', sources: 1, pageCount: 1 });
    expect(summary.needles.map(({ documents, matchingLines, occurrences }) => ({ documents, matchingLines, occurrences }))).toEqual([{ documents: 1, matchingLines: 1, occurrences: 2 }, { documents: 1, matchingLines: 1, occurrences: 2 }, { documents: 1, matchingLines: 1, occurrences: 2 }]);
    expect(blocks.mock.calls.every(([, , limit]) => limit === 1)).toBe(true);
    expect(chunks).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled();
    expect(await corpus.getDurabilityReceipt()).toEqual(receipt);
    summary.needles[0].occurrences = 999;
    expect((await handle.getSummary()).needles[0].occurrences).toBe(2);
  });
  it('순위·검토 96개 바깥의 파일도 연속 페이지로 접근한다', async () => {
    const rows = Array.from({ length: 97 }, (_, index) => entry('needle', `synthetic/${String(index).padStart(3, '0')}.txt`));
    const { source } = await fixture(rows);
    const handle = await open(source, ['needle']);
    expect(await handle.getSummary()).toMatchObject({ sources: 97, pageCount: 97, needles: [{ documents: 97, matchingLines: 97, occurrences: 97 }] });
    expect((await handle.readPage(96))?.references[0].path).toBe('synthetic/096.txt');
    expect((await handle.readPage(96))?.nextPage).toBeNull();
    expect(await handle.readPage(97)).toBeNull();
  });
  it('한 source의 600발생을 모든 페이지에 정확히 한 번 보존한다', async () => {
    const { source } = await fixture([entry('x '.repeat(600))]);
    const handle = await open(source, ['x']);
    const pages = [await handle.readPage(0), await handle.readPage(1), await handle.readPage(2)];
    expect(pages.map((page) => page?.references.length)).toEqual([256, 256, 88]);
    expect(pages.map((page) => page?.nextPage)).toEqual([1, 2, null]);
    expect((await handle.getSummary()).needles[0]).toMatchObject({ documents: 1, matchingLines: 1, occurrences: 600 });
  });
  it('제외된 파일은 header를 보더라도 raw block을 읽거나 총계에 넣지 않는다', async () => {
    const { corpus, source, scope } = await fixture([entry('needle', 'synthetic/allowed'), entry('needle needle', 'synthetic/excluded')]);
    scope.sources = new Map([...scope.sources].filter(([path]) => path === 'synthetic/allowed'));
    const blocks = vi.spyOn(corpus, 'getSourceBodyBlocks');
    const handle = await open(source, ['needle']);
    expect((await handle.getSummary()).needles[0].occurrences).toBe(1);
    expect(blocks.mock.calls.every(([path]) => path === 'synthetic/allowed')).toBe(true);
  });
  it('명시적 빈 본문과 진짜 빈 scope만 complete zero가 된다', async () => {
    const empty = await fixture([entry('')]);
    const handle = await open(empty.source, ['needle']);
    expect(await handle.getSummary()).toMatchObject({ sources: 1, pageCount: 0, needles: [{ documents: 0, matchingLines: 0, occurrences: 0 }] });
    const none = await fixture([]);
    expect(await (await open(none.source, ['needle'])).getSummary()).toMatchObject({ sources: 0, pageCount: 0 });
  });
  it.each(['legacy', 'unindexed', 'unverified', 'revision', 'partial'] as const)('%s source를 성공 0으로 숨기지 않는다', async (kind) => {
    const data = entry('needle');
    if (kind === 'legacy') delete data.sourceBody;
    if (kind === 'partial') data.sourceMetadata = { segments: [], completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } };
    const state = await fixture(kind === 'unindexed' ? [] : [data]);
    if (kind === 'unindexed') state.scope.sources = new Map([['synthetic/missing', { sourceMtime: 1, sourceSize: 6, contentHash: '11111111', sourceMetadataHash: 'aaaaaaaa', verified: true }]]);
    if (kind === 'unverified') state.scope.sources = new Map([[data.filePath, { sourceMtime: 1, sourceSize: 6, contentHash: data.sourceRevision?.contentHash ?? '', sourceMetadataHash: data.sourceMetadataHash ?? '', verified: false }]]);
    if (kind === 'revision') state.scope.sources = new Map([[data.filePath, { sourceMtime: 2, sourceSize: 6, contentHash: data.sourceRevision?.contentHash ?? '', sourceMetadataHash: data.sourceMetadataHash ?? '', verified: true }]]);
    const blocks = vi.spyOn(state.corpus, 'getSourceBodyBlocks');
    await expect(open(state.source, ['needle'])).rejects.toThrow();
    expect(blocks).not.toHaveBeenCalled();
  });
  it.each(['contentHash', 'sourceMetadataHash'] as const)('stat가 같아도 현재 준비된 %s와 다른 body 원장을 쓰지 않는다', async (field) => {
    const { corpus, source, scope } = await fixture([entry('needle')]);
    const previous = scope.sources.get('synthetic/source.txt');
    if (!previous) throw new Error('literal-test-source-missing');
    scope.sources = new Map([['synthetic/source.txt', { ...previous, [field]: '00000000' }]]);
    const blocks = vi.spyOn(corpus, 'getSourceBodyBlocks');
    await expect(open(source, ['needle'])).rejects.toThrow('source-revision-stale');
    expect(blocks).not.toHaveBeenCalled();
  });
  it('누락된 raw block은 실패하며 다른 요청 페이지를 지우지 않는다', async () => {
    const { corpus, source } = await fixture([entry('needle')]);
    const other = crypto.randomUUID(); await corpus.putLiteralPage(other, 0, '{"other":true}');
    const read = vi.spyOn(corpus, 'getSourceBodyBlocks').mockResolvedValue([]);
    await expect(open(source, ['needle'])).rejects.toThrow('source-block-missing');
    expect(read).toHaveBeenCalled(); expect(await corpus.getLiteralPage(other, 0)).toBe('{"other":true}');
  });
  it.each(['epoch', 'receipt'] as const)('%s가 페이지 저장 중 바뀌면 이전 합계를 게시하지 않는다', async (kind) => {
    const { corpus, source, invalidate } = await fixture([entry('needle')]);
    const original = corpus.putLiteralPage.bind(corpus);
    let owner: string | undefined;
    vi.spyOn(corpus, 'putLiteralPage').mockImplementation(async (...args) => {
      owner = args[0]; await original(...args);
      if (kind === 'epoch') invalidate(); else await corpus.replaceBatchFileDocuments([entry('changed')]);
    });
    await expect(open(source, ['needle'])).rejects.toThrow('inventory-stale');
    expect(owner).toBeDefined();
    if (owner) expect(await corpus.getLiteralPage(owner, 0)).toBeNull();
    expect((await corpus.getSourceBodyHeader('synthetic/source.txt'))?.body).not.toBeNull();
  });
  it('원문 block의 취소 불가 I/O가 끝나기 전에 owner 정리를 완료하지 않는다', async () => {
    const { corpus, source } = await fixture([entry('needle')]);
    let entered = (): void => {}, release = (): void => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const original = corpus.getSourceBodyBlocks.bind(corpus);
    vi.spyOn(corpus, 'getSourceBodyBlocks').mockImplementation(async (...args) => { entered(); await held; return original(...args); });
    const cleanup = vi.spyOn(corpus, 'deleteLiteralPages');
    const controller = new AbortController();
    const opening = open(source, ['needle'], controller.signal);
    const outcome = opening.catch((error: unknown) => error);
    await started; controller.abort(); await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    release(); expect((await outcome as Error).name).toBe('AbortError');
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('read와 close가 겹치면 실제 read 정착 뒤 자기 페이지만 정리한다', async () => {
    const { corpus, source } = await fixture([entry('needle')]);
    const handle = await open(source, ['needle']);
    let entered = (): void => {}, release = (): void => {};
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const original = corpus.getLiteralPage.bind(corpus);
    vi.spyOn(corpus, 'getLiteralPage').mockImplementation(async (...args) => { entered(); await held; return original(...args); });
    const cleanup = vi.spyOn(corpus, 'deleteLiteralPages');
    const reading = handle.readPage(0).catch((error: unknown) => error);
    await started; const closing = handle.close();
    expect(cleanup).not.toHaveBeenCalled();
    release(); expect(await reading).toBeInstanceOf(Error); await closing;
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(handle.getSummary()).rejects.toThrow('inventory-closed');
  });
  it('한 번 관측한 scope 무효화는 정책이 돌아와도 옛 handle을 되살리지 않는다', async () => {
    const { source, scope } = await fixture([entry('needle')]);
    const handle = await open(source, ['needle']);
    scope.isCurrent = () => false;
    await expect(handle.getSummary()).rejects.toThrow('inventory-stale');
    scope.isCurrent = () => true;
    await expect(handle.getSummary()).rejects.toThrow('inventory-stale');
  });
  it('전체 완료 뒤 source 무효화·페이지 유실도 유효한 0페이지가 아니다', async () => {
    const { corpus, source, invalidate } = await fixture([entry('needle')]);
    const handle = await open(source, ['needle']);
    vi.spyOn(corpus, 'getLiteralPage').mockResolvedValue(null);
    await expect(handle.readPage(0)).rejects.toThrow('inventory-page-missing');
    invalidate(); await expect(handle.getSummary()).rejects.toThrow('inventory-stale');
  });
});
