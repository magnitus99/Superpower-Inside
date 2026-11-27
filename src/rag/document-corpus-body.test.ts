import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { IndexedDbDocumentCorpusStore } from './document-corpus-store';
import { buildSourceDocuments } from './source-document';
import { createContentHash } from './hash';

const stores: IndexedDbDocumentCorpusStore[] = [];
const names: string[] = [];
afterEach(async () => {
  for (const store of stores) store.close();
  await Promise.all(names.map((name) => Dexie.delete(name)));
  stores.length = 0;
  names.length = 0;
});
function storeFixture() {
  const name = `literal-corpus:${crypto.randomUUID()}`;
  const store = new IndexedDbDocumentCorpusStore(name);
  names.push(name); stores.push(store);
  return store;
}
function sourceEntry(text: string, filePath = 'synthetic/body.md') {
  const byteLength = new TextEncoder().encode(text).length;
  const file = { path: filePath, basename: 'body', extension: 'md', stat: { mtime: 10, size: byteLength } } as TFile;
  const documents = buildSourceDocuments(file, text, { chunkSize: 20, overlap: 4 });
  const split = text.indexOf('\n') + 1;
  const cut = split > 0 && split < text.length ? split : text.length;
  const firstBytes = new TextEncoder().encode(text.slice(0, cut)).length;
  const blocks = text ? [{ startByte: 0, endByte: firstBytes, startUtf16: 0, endUtf16: cut }] : [];
  if (cut < text.length) blocks.push({ startByte: firstBytes, endByte: byteLength, startUtf16: cut, endUtf16: text.length });
  return {
    filePath, documents, sourceMetadataHash: 'aaaaaaaa', sourceMetadata: { segments: [] },
    sourceRevision: { sourceMtime: 10, sourceSize: byteLength, contentHash: createContentHash(text) },
    sourceBody: { text, plan: { version: 1 as const, byteLength, utf16Length: text.length, scanChargeBytes: Math.max(4096, byteLength * 100), blocks } },
  };
}

describe('corpus의 원문 block과 파생 literal 페이지', () => {
  it('v2 corpus의 upgrade는 원문을 추측해 backfill하거나 기존 행을 인증하지 않는다', async () => {
    const name = `literal-legacy:${crypto.randomUUID()}`;
    names.push(name);
    const entry = sourceEntry('legacy source');
    const old = new Dexie(name);
    old.version(2).stores({ documents: 'id, sourcePath', files: 'filePath', meta: 'key' });
    await old.table('documents').bulkPut(entry.documents);
    await old.table('files').put({ filePath: entry.filePath, ...entry.sourceRevision, vectorCount: entry.documents.length, updated: 1 });
    old.close();
    const store = new IndexedDbDocumentCorpusStore(name);
    stores.push(store);
    expect(await store.getDocuments()).toEqual(entry.documents);
    expect((await store.getSourceBodyHeaders(null, 8))[0]?.body).toBeNull();
    expect(await store.getSourceBodyBlocks(entry.filePath, 0, 8)).toEqual([]);
    expect(await store.getDurabilityReceipt()).toBeNull();
    expect(await store.initializeEmptyDurabilityReceipt()).toBeNull();
  });

  it('원문은 청크와 별도로 한 번 저장하고 metadata 페이지에는 본문을 넣지 않는다', async () => {
    const store = storeFixture();
    const entry = sourceEntry('Uncopied 😀 source.\nneedle twice needle.');
    await store.replaceBatchFileDocuments([entry]);
    const headers = await store.getSourceBodyHeaders(null, 1);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ filePath: entry.filePath, ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash, body: { version: 1, byteLength: entry.sourceBody.plan.byteLength, utf16Length: entry.sourceBody.text.length, blockCount: 2 } });
    expect(await store.getSourceBodyHeader(entry.filePath)).toEqual(headers[0]);
    expect(await store.getSourceBodyHeader('missing')).toBeNull();
    expect(JSON.stringify(headers)).not.toContain(entry.sourceBody.text);
    expect(JSON.stringify(await store.getFileIndexRecords())).not.toContain(entry.sourceBody.text);
    const first = await store.getSourceBodyBlocks(entry.filePath, 0, 1);
    const second = await store.getSourceBodyBlocks(entry.filePath, 1, 1);
    expect(first[0]).toMatchObject({ filePath: entry.filePath, index: 0, ...entry.sourceBody.plan.blocks[0] });
    expect(first.concat(second).map((block) => block.text).join('')).toBe(entry.sourceBody.text);
    expect(await store.getSourceBodyBlocks(entry.filePath, 2, 1)).toEqual([]);
    expect((await store.getDocuments()).map((document) => document.text).join('')).not.toBe(entry.sourceBody.text);
  });

  it('명시적 빈 원문과 raw capability가 없는 legacy를 같은 0건으로 숨기지 않는다', async () => {
    const store = storeFixture();
    const empty = sourceEntry('', 'synthetic/empty.xlsx');
    await store.replaceBatchFileDocuments([empty]);
    const old = sourceEntry('legacy preserved', 'synthetic/legacy.md');
    await store.replaceFileDocuments(old.filePath, old.documents);
    const headers = await store.getSourceBodyHeaders(null, 8);
    expect(headers.find((header) => header.filePath === empty.filePath)?.body).toMatchObject({ version: 1, byteLength: 0, utf16Length: 0, blockCount: 0 });
    expect(headers.find((header) => header.filePath === old.filePath)?.body).toBeNull();
    expect(await store.getSourceBodyBlocks(empty.filePath, 0, 8)).toEqual([]);
  });

  it('전달된 metadata hash는 별도 metadata 객체 유무로 버리지 않는다', async () => {
    const store = storeFixture();
    const entry = { ...sourceEntry('source'), sourceMetadata: undefined };
    await store.replaceBatchFileDocuments([entry]);
    expect((await store.getSourceBodyHeaders(null, 1))[0]?.sourceMetadataHash).toBe(entry.sourceMetadataHash);
  });

  it('원문·청크·파일·receipt는 outer transaction 실패에서 함께 rollback된다', async () => {
    const store = storeFixture();
    const original = sourceEntry('old source\nneedle old');
    await store.replaceBatchFileDocuments([original]);
    const receipt = await store.getDurabilityReceipt();
    await expect(store['db'].transaction('rw', ['documents', 'files', 'meta', 'sourceBlocks'], async () => {
      await store.replaceBatchFileDocuments([sourceEntry('new source\nneedle new')]);
      expect(await store.getDurabilityReceipt()).not.toEqual(receipt);
      throw new Error('Synthetic body transaction abort.');
    })).rejects.toThrow('Synthetic body transaction abort.');
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
    expect((await store.getSourceBodyBlocks(original.filePath, 0, 8)).map((block) => block.text).join('')).toBe(original.sourceBody.text);
  });

  it('잘못된 범위의 배치는 이전 본문·receipt를 부분 변경하지 않는다', async () => {
    const store = storeFixture();
    const original = sourceEntry('old source');
    await store.replaceBatchFileDocuments([original]);
    const receipt = await store.getDurabilityReceipt();
    const invalid = sourceEntry('new source');
    invalid.sourceBody.plan.blocks[0].startUtf16 = 1;
    await expect(store.replaceBatchFileDocuments([invalid])).rejects.toThrow('rag-source-body-invalid');
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
    expect((await store.getSourceBodyBlocks(original.filePath, 0, 8))[0]?.text).toBe(original.sourceBody.text);
  });

  it('같은 파일을 두 번 담은 배치는 원문과 파일 기록을 서로 섞지 않는다', async () => {
    const store = storeFixture();
    const original = sourceEntry('old source');
    await store.replaceBatchFileDocuments([original]);
    const receipt = await store.getDurabilityReceipt();
    await expect(store.replaceBatchFileDocuments([sourceEntry('first replacement'), sourceEntry('second replacement')])).rejects.toThrow('rag-source-batch-invalid');
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
    expect((await store.getSourceBodyBlocks(original.filePath, 0, 8))[0]?.text).toBe(original.sourceBody.text);
  });

  it('본문이 갱신되었는데 bodyPlan이 없으면 옛 raw를 새 hash 아래에 남기지 않는다', async () => {
    const store = storeFixture();
    const original = sourceEntry('old source');
    await store.replaceBatchFileDocuments([original]);
    const next = sourceEntry('new source');
    await store.replaceFileDocuments(next.filePath, next.documents);
    expect((await store.getSourceBodyHeaders(null, 8))[0]?.body).toBeNull();
    expect(await store.getSourceBodyBlocks(next.filePath, 0, 8)).toEqual([]);
  });

  it('헤더 keyset은 IDB의 UTF-16 경로 순서로 연속이고 raw를 전체 적재하지 않는다', async () => {
    const store = storeFixture();
    await store.replaceBatchFileDocuments(['a.md', '😀.md', '\ue000.md', 'z.md'].map((path) => sourceEntry('source', path)));
    const first = await store.getSourceBodyHeaders(null, 2);
    const second = await store.getSourceBodyHeaders(first.at(-1)!.filePath, 2);
    expect(first.concat(second).map((header) => header.filePath)).toEqual(['a.md', 'z.md', '😀.md', '\ue000.md']);
    expect(await store.getSourceBodyHeaders(second.at(-1)!.filePath, 2)).toEqual([]);
  });

  it('요청 페이지 쓰기는 receipt를 만들지 않으며 자기 owner만 정리한다', async () => {
    const store = storeFixture();
    const owner = crypto.randomUUID(), other = crypto.randomUUID();
    const page = '{"ok":true,"done":false,"references":[]}';
    expect(await store.getDurabilityReceipt()).toBeNull();
    await store.putLiteralPage(owner, 0, page);
    await store.putLiteralPage(other, 0, page);
    expect(await store.getDurabilityReceipt()).toBeNull();
    const receipt = await store.initializeEmptyDurabilityReceipt();
    await store.putLiteralPage(owner, 1, page);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
    await store.deleteLiteralPages(owner);
    expect(await store.getLiteralPage(owner, 0)).toBeNull();
    expect(await store.getLiteralPage(other, 0)).toBe(page);
  });

  it('단독 authoritative body block도 없는 DB라고 인증하지 않는다', async () => {
    const store = storeFixture();
    await store['db'].open();
    await store['db'].table('sourceBlocks').put({ filePath: 'orphan.md', index: 0, text: 'source', startByte: 0, endByte: 6, startUtf16: 0, endUtf16: 6 });
    expect(await store.initializeEmptyDurabilityReceipt()).toBeNull();
  });

  it('삭제·clear는 원문도 함께 바꾸고 다른 요청 파생 페이지는 지우지 않는다', async () => {
    const store = storeFixture();
    await store.replaceBatchFileDocuments([sourceEntry('first', 'a.md'), sourceEntry('second', 'b.md')]);
    const owner = crypto.randomUUID();
    const page = '{"ok":true,"done":false,"references":[]}';
    await store.putLiteralPage(owner, 0, page);
    await store.removeByFilePath('a.md');
    expect(await store.getSourceBodyBlocks('a.md', 0, 8)).toEqual([]);
    expect((await store.getSourceBodyBlocks('b.md', 0, 8))[0]?.text).toBe('second');
    const before = await store.getDurabilityReceipt();
    await store.clear();
    expect(await store.getDurabilityReceipt()).not.toEqual(before);
    expect(await store.getSourceBodyHeaders(null, 8)).toEqual([]);
    expect(await store.getSourceBodyBlocks('b.md', 0, 8)).toEqual([]);
    expect(await store.getLiteralPage(owner, 0)).toBe(page);
  });

  it('파생 페이지의 잘못된 owner·주소·초과 payload는 쓰지 않는다', async () => {
    const store = storeFixture();
    const page = '{"ok":true}';
    const owner = crypto.randomUUID();
    await expect(store.putLiteralPage('unknown-owner', 0, page)).rejects.toThrow('rag-literal-page-invalid');
    for (const index of [-1, 0.5, Number.NaN]) await expect(store.putLiteralPage(owner, index, page)).rejects.toThrow('rag-literal-page-invalid');
    await expect(store.putLiteralPage(owner, 0, 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow('rag-literal-page-invalid');
    expect(await store.getLiteralPage(owner, 0)).toBeNull();
    expect(await store.getDurabilityReceipt()).toBeNull();
  });

  it.each([0, -1, Number.NaN, 129])('잘못된 페이지 상한 %s는 보정하지 않는다', async (limit) => {
    const store = storeFixture();
    await expect(store.getSourceBodyHeaders(null, limit)).rejects.toThrow('rag-source-page-invalid');
    await expect(store.getSourceBodyBlocks('a.md', 0, limit)).rejects.toThrow('rag-source-page-invalid');
  });
});

describe('model-free 원문 보충 CAS', () => {
  it.each([2, 3])('legacy v%s의 문서·기존 metadata는 그대로 두고 raw·receipt만 추가한다', async (version) => {
    const name = `literal-backfill:${crypto.randomUUID()}`;
    names.push(name);
    const entry = sourceEntry('overlap source source.\nraw second line');
    const record = { filePath: entry.filePath, ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash, sourceMetadata: { segments: [], metadataParts: [{ label: 'preserved' }] }, vectorCount: 71, updated: 123, indexedAt: 99, hasCompleteMetadata: true };
    const old = new Dexie(name);
    old.version(version).stores({ documents: 'id, sourcePath', files: 'filePath', meta: 'key', ...(version === 3 ? { sourceBlocks: '[filePath+index], filePath', literalPages: '[ownerId+index], ownerId' } : {}) });
    await old.table('documents').bulkPut(entry.documents);
    await old.table('files').put(record);
    old.close();
    const store = new IndexedDbDocumentCorpusStore(name);
    stores.push(store);
    const before = await store.getDurabilityReceipt();
    expect(await store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody)).toBe(true);
    // IndexedDB의 toArray()는 청크 생성 순서가 아니라 기본 키 순서로 읽습니다.
    const expectedDocuments = [...entry.documents].sort((a, b) => indexedDB.cmp(a.id, b.id));
    expect(await store.getDocuments()).toEqual(expectedDocuments);
    const [{ sourceBody, ...after }] = await store['db'].files.toArray();
    expect(after).toEqual(record);
    expect(sourceBody).toMatchObject({ version: 1, blockCount: 2 });
    expect((await store.getSourceBodyBlocks(entry.filePath, 0, 8)).map(({ text }) => text).join('')).toBe(entry.sourceBody.text);
    expect(await store.getDurabilityReceipt()).not.toEqual(before);
    const receipt = await store.getDurabilityReceipt();
    expect(await store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody)).toBe(false);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });

  it.each(['sourceMtime', 'sourceSize', 'contentHash', 'sourceMetadataHash', 'missing-metadata', 'missing-record'] as const)('%s 불일치 CAS는 완전 no-op이다', async (field) => {
    const store = storeFixture(), entry = sourceEntry('preserved source');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    if (field === 'missing-metadata') await store['db'].files.update(entry.filePath, { sourceMetadataHash: undefined });
    if (field === 'missing-record') await store['db'].files.delete(entry.filePath);
    const records = await store.getFileIndexRecords(), docs = await store.getDocuments(), receipt = await store.getDurabilityReceipt();
    const expected = { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash };
    if (field === 'sourceMtime' || field === 'sourceSize') expected[field]++;
    if (field === 'contentHash' || field === 'sourceMetadataHash') expected[field] = 'bbbbbbbb';
    expect(await store.backfillSourceBody(entry.filePath, expected, entry.sourceBody)).toBe(false);
    expect(await store.getFileIndexRecords()).toEqual(records);
    expect(await store.getDocuments()).toEqual(docs);
    expect(await store.getSourceBodyBlocks(entry.filePath, 0, 8)).toEqual([]);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });

  it('다른 파일과 literal page owner를 보존하고 명시적 빈 body도 저장한다', async () => {
    const store = storeFixture(), entry = sourceEntry('', 'empty.xlsx'), other = sourceEntry('other body', 'other.md');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }, other]);
    const owner = crypto.randomUUID();
    await store.putLiteralPage(owner, 0, '{}');
    const otherHeader = await store.getSourceBodyHeader(other.filePath), otherBlocks = await store.getSourceBodyBlocks(other.filePath, 0, 8);
    expect(await store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody)).toBe(true);
    expect((await store.getSourceBodyHeader(entry.filePath))?.body).toMatchObject({ blockCount: 0, byteLength: 0 });
    expect(await store.getSourceBodyHeader(other.filePath)).toEqual(otherHeader);
    expect(await store.getSourceBodyBlocks(other.filePath, 0, 8)).toEqual(otherBlocks);
    expect(await store.getLiteralPage(owner, 0)).toBe('{}');
  });

  it('outer transaction rollback은 raw/header/receipt를 함께 되돌린다', async () => {
    const store = storeFixture(), entry = sourceEntry('body');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    const before = await store.getFileIndexRecords(), receipt = await store.getDurabilityReceipt();
    await expect(store['db'].transaction('rw', ['files', 'sourceBlocks', 'meta'], async () => {
      expect(await store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody)).toBe(true);
      throw new Error('synthetic outer abort');
    })).rejects.toThrow('synthetic outer abort');
    expect(await store.getFileIndexRecords()).toEqual(before);
    expect(await store.getSourceBodyBlocks(entry.filePath, 0, 8)).toEqual([]);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });

  it.each(['initial', 'read', 'delete', 'put', 'file', 'receipt', 'throw'] as const)('admit %s 경계 거절은 raw와 이전 receipt를 섞지 않는다', async (phase) => {
    const store = storeFixture(), entry = sourceEntry('body');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    const before = await store.getFileIndexRecords(), receipt = await store.getDurabilityReceipt();
    let allowed = phase !== 'initial';
    const deny = () => { allowed = false; };
    if (phase === 'read') store['db'].files.hook('reading', (record) => { deny(); return record; });
    if (phase === 'delete') {
      await store['db'].sourceBlocks.put({ ...entry.sourceBody.plan.blocks[0], filePath: entry.filePath, index: 0, text: 'orphan' });
      store['db'].sourceBlocks.hook('deleting', deny);
    }
    if (phase === 'put') store['db'].sourceBlocks.hook('creating', deny);
    if (phase === 'file') store['db'].files.hook('updating', deny);
    if (phase === 'receipt') store['db'].meta.hook('updating', deny);
    const admit = () => { if (phase === 'throw') throw new Error('PRIVATE CALLBACK BODY'); return allowed; };
    await expect(store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody, admit)).rejects.toMatchObject({ name: 'AbortError', message: 'rag-source-body-aborted' });
    expect(await store.getFileIndexRecords()).toEqual(before);
    expect((await store.getSourceBodyBlocks(entry.filePath, 0, 8)).map(({ text }) => text)).toEqual(phase === 'delete' ? ['orphan'] : []);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });

  it('잘못된 plan/revision/metadata hash는 쓰기 전에 거절한다', async () => {
    const store = storeFixture(), entry = sourceEntry('body');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    const receipt = await store.getDurabilityReceipt();
    const expected = { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash };
    await expect(store.backfillSourceBody(entry.filePath, { ...expected, sourceMetadataHash: '' }, entry.sourceBody)).rejects.toThrow('rag-source-body-invalid');
    await expect(store.backfillSourceBody(entry.filePath, { ...expected, sourceSize: -1 }, entry.sourceBody)).rejects.toThrow('rag-source-body-invalid');
    entry.sourceBody.plan.blocks[0].startUtf16 = 1;
    await expect(store.backfillSourceBody(entry.filePath, expected, entry.sourceBody)).rejects.toThrow('rag-source-body-invalid');
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });
});

describe('원문 보충 writer 경합', () => {
  it('동시 store writer는 한 번만 raw를 보충하고 후발 writer는 no-op이다', async () => {
    const store = storeFixture(), entry = sourceEntry('one raw copy\nsecond block');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    const other = new IndexedDbDocumentCorpusStore(store['db'].name);
    stores.push(other);
    const expected = { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash };
    const result = await Promise.all([store.backfillSourceBody(entry.filePath, expected, entry.sourceBody), other.backfillSourceBody(entry.filePath, expected, entry.sourceBody)]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(await store.getDocuments()).toEqual(entry.documents);
    expect(await store.getSourceBodyBlocks(entry.filePath, 0, 8)).toHaveLength(entry.sourceBody.plan.blocks.length);
    const receipt = await store.getDurabilityReceipt();
    expect(await other.backfillSourceBody(entry.filePath, expected, entry.sourceBody)).toBe(false);
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
  });

  it('쓰기 뒤 callback 예외도 원문 오류를 숨기고 receipt/raw를 rollback한다', async () => {
    const store = storeFixture(), entry = sourceEntry('preserved body');
    await store.replaceBatchFileDocuments([{ ...entry, sourceBody: undefined }]);
    const receipt = await store.getDurabilityReceipt();
    let written = false;
    store['db'].sourceBlocks.hook('creating', () => { written = true; });
    await expect(store.backfillSourceBody(entry.filePath, { ...entry.sourceRevision, sourceMetadataHash: entry.sourceMetadataHash }, entry.sourceBody, () => {
      if (written) throw new Error('PRIVATE BODY CALLBACK');
      return true;
    })).rejects.toMatchObject({ name: 'AbortError', message: 'rag-source-body-aborted' });
    expect(await store.getDurabilityReceipt()).toEqual(receipt);
    expect((await store.getSourceBodyHeader(entry.filePath))?.body).toBeNull();
    expect(await store.getSourceBodyBlocks(entry.filePath, 0, 8)).toEqual([]);
  });
});
