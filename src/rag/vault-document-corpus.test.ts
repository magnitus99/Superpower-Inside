import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type Vault } from 'obsidian';
import { DEFAULT_SETTINGS, type RAGConfig } from '../settings';
import { appLogger } from '../utils/logger';
import { IndexedDbDocumentCorpusStore } from './document-corpus-store';
import { VaultDocumentCorpus } from './vault-document-corpus';
import { readSourceFileSnapshot } from './source-snapshot';
import { VaultIndexer } from './indexer';
import { MemoryVectorStore } from './store';
import * as rustCore from './rust-core';
import * as sourceSnapshots from './source-snapshot';

const stores: IndexedDbDocumentCorpusStore[] = [];
const names: string[] = [];
vi.mock('obsidian', () => ({
  getFrontMatterInfo: (content: string) => {
    const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
    return { exists: match !== null, frontmatter: match?.[1] ?? '' };
  },
  parseYaml: (content: string) => (createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown }).load(content),
  App: class {},
  TFile: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isDesktopApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
}));
afterEach(async () => {
  for (const store of stores) store.close();
  await Promise.all(names.map((name) => Dexie.delete(name)));
  stores.length = 0;
  names.length = 0;
});

function fixture(path = 'notes/source.txt') {
  let content = '현재 원문 근거';
  const file = Object.assign(new TFile(), {
    path,
    name: path.split('/').at(-1),
    basename: 'source',
    extension: path.split('.').at(-1),
    stat: { mtime: 1, size: content.length },
  });
  const files = new Map([[path, file]]);
  const binaries = new Map<string, Uint8Array>();
  const read = vi.fn((target: TFile) =>
    Promise.resolve(
      target.path === path
        ? sourceBytes(content)
        : (binaries.get(target.path)?.slice().buffer ?? new ArrayBuffer(0)),
    ),
  );
  const vault = {
    configDir: '.obsidian',
    getFiles: () => [...files.values()],
    getAbstractFileByPath: (key: string) => files.get(key) ?? null,
    readBinary: read,
  } as unknown as Vault;
  const name = `source-corpus:${crypto.randomUUID()}`;
  const store = new IndexedDbDocumentCorpusStore(name);
  stores.push(store);
  names.push(name);
  const config: RAGConfig = { ...DEFAULT_SETTINGS.rag, excludePaths: [], excludeExts: [] };
  const corpus = new VaultDocumentCorpus(
    vault,
    store,
    () => config,
    () => DEFAULT_SETTINGS.chat,
    appLogger,
  );
  return {
    file,
    files,
    binaries,
    vault,
    store,
    corpus,
    read,
    config,
    update(text: string) {
      content = text;
      file.stat.mtime++;
      file.stat.size = text.length;
    },
  };
}

describe('파일 중심 문서 생명주기', () => {
  it('recovery metadata getter는 files만 한 번 전달하고 원문·body block을 읽지 않는다', async () => {
    const source = fixture();
    await source.corpus.refreshFile(source.file);
    const expected = await source.store.getFileIndexRecords();
    const files = vi.spyOn(source.store, 'getFileIndexRecords');
    const body = vi.spyOn(source.store, 'getSourceBodyBlocks');
    const documents = vi.spyOn(source.store, 'getDocuments');
    source.read.mockClear();
    expect(await source.corpus.getFileIndexRecords()).toEqual(expected);
    expect(files).toHaveBeenCalledOnce();
    expect(source.read).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(documents).not.toHaveBeenCalled();
  });

  it('lexical 준비도 바이트를 한 번 읽고 worker의 hash·청크를 재사용한다', async () => {
    const source = fixture('notes/source.md');
    const hash = vi.spyOn(rustCore, 'createContentHashRust');
    const chunk = vi.spyOn(rustCore, 'chunkMarkdownRust');
    const original = rustCore.prepareSourceBytesRust;
    const prepare = vi.spyOn(rustCore, 'prepareSourceBytesRust').mockImplementation((...args) => {
      const result = original(...args);
      if (!result?.prepared) return result;
      const byteLength = new TextEncoder().encode(result.text).length;
      return { ...result, prepared: { ...result.prepared, bodyPlan: { version: 1 as const, byteLength, utf16Length: result.text.length, scanChargeBytes: 4096, blocks: byteLength ? [{ startByte: 0, endByte: byteLength, startUtf16: 0, endUtf16: result.text.length }] : [] } } };
    });
    try {
      await source.corpus.refreshFile(source.file);
      expect(source.read).toHaveBeenCalledOnce();
      expect(hash).not.toHaveBeenCalled();
      expect(chunk).not.toHaveBeenCalled();
      expect((await source.store.getDocuments()).map(({ text }) => text)).toEqual(['현재 원문 근거']);
      expect((await source.store.getSourceBodyHeaders(null, 8))[0]?.body).toMatchObject({ version: 1, blockCount: 1 });
      expect((await source.store.getSourceBodyBlocks(source.file.path, 0, 8))[0]?.text).toBe('현재 원문 근거');
    } finally { hash.mockRestore(); chunk.mockRestore(); prepare.mockRestore(); }
  });

  it('lexical 빈 파일도 worker의 실제 revision으로 저장하고 가짜 본문·좌표를 만들지 않는다', async () => {
    const source = fixture('notes/empty.txt');
    source.update('');
    await source.corpus.refreshFile(source.file);
    expect(await source.store.getFileIndexRecords()).toEqual([expect.objectContaining({ filePath: source.file.path, sourceMtime: source.file.stat.mtime, sourceSize: 0, contentHash: '811c9dc5', vectorCount: 0, hasCompleteMetadata: true })]);
    expect(await source.store.getDocuments()).toEqual([]);
    expect(await source.store.getEntriesByFilePaths([source.file.path])).toEqual([]);
  });

  it('주입된 파일 캐시의 검색 필드는 raw corpus 본문과 별도로 저장한다', async () => {
    const source = fixture('notes/source.md');
    source.update('# Cooling\nQuartz cooling cycles');
    const getMetadata = vi.fn(() => ({
      frontmatter: { title: 'Thermal Guide', tags: ['thermal'] },
    }));
    const corpus = new VaultDocumentCorpus(
      source.vault,
      source.store,
      () => source.config,
      () => DEFAULT_SETTINGS.chat,
      appLogger,
      getMetadata,
    );
    await corpus.refreshFile(source.file);
    expect(getMetadata).toHaveBeenCalledWith(source.file);
    expect(
      (await source.store.getEntriesByFilePaths([source.file.path]))[0]?.metadata,
    ).toMatchObject({
      text: '# Cooling\nQuartz cooling cycles',
      title: 'Thermal Guide',
      headings: ['Cooling'],
      tags: ['thermal'],
      startLine: 1,
    });
  });
  it('파일 읽기가 끝나기 전에는 busy이고 완료되면 해제된다', async () => {
    const source = fixture('notes/busy.txt');
    let resolveRead!: (bytes: ArrayBuffer) => void;
    source.read.mockReturnValueOnce(
        new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        }),
      );
    const refresh = source.corpus.refreshFile(source.file);
    expect(source.corpus.isBusy()).toBe(true);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    expect(source.corpus.isBusy()).toBe(true);
    resolveRead(sourceBytes('현재 원문 근거'));
    await refresh;
    expect(source.corpus.isBusy()).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)(
    '원문 갱신 취소는 기존 문서를 보존하고 늦은 %s 결과가 새 갱신을 덮지 않는다',
    async (settlement) => {
      const source = fixture('notes/cancel.txt');
      await source.corpus.refreshFile(source.file);
      const previous = await source.store.getDocuments();
      source.update('합성 새 본문');
      const controller = new AbortController();
      let resolveRead!: (bytes: ArrayBuffer) => void;
      let rejectRead!: (error: Error) => void;
      // 단일 원문 읽기를 지연해 소비자 취소와 실제 I/O 정착을 분리합니다.
      source.read.mockReturnValueOnce(
          new Promise<ArrayBuffer>((resolve, reject) => {
            resolveRead = resolve;
            rejectRead = reject;
          }),
        );
      let outcome: unknown;
      const refresh = source.corpus.refreshFile(source.file, controller.signal);
      const observed = refresh.catch((error: unknown) => {
        outcome = error;
      });
      try {
        await vi.waitFor(() => expect(source.read).toHaveBeenCalledTimes(2));
        controller.abort();
        await vi.waitFor(() => expect(outcome).toMatchObject({ name: 'AbortError' }));
        expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
        expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
        expect(source.corpus.hasCandidatePath(source.file.path)).toBe(true);
        expect(await source.store.getDocuments()).toEqual(previous);
        await source.corpus.refreshFile(source.file);
      } finally {
        if (settlement === 'resolve') resolveRead(sourceBytes('합성 이전 응답'));
        else rejectRead(new Error('late corpus read failure'));
        await observed;
      }
      await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
      expect((await source.store.getDocuments())[0]?.text).toContain('합성 새 본문');
      expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
      expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    },
  );

  it('준비 원문을 corpus에 재사용하고 내구 저장 대기 중 취소하면 임베딩·완료를 게시하지 않는다', async () => {
    const source = fixture('notes/index-cancel.txt');
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const replace = source.corpus.replaceBatchFileDocuments.bind(source.corpus);
    const saving = vi.spyOn(source.corpus, 'replaceBatchFileDocuments').mockImplementation(async (entries) => {
      await gate;
      await replace(entries);
    });
    const refresh = vi.spyOn(source.corpus, 'refreshFile');
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const vectors = new MemoryVectorStore();
    const indexer = new VaultIndexer(source.vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, source.config, DEFAULT_SETTINGS.chat, undefined, appLogger, source.corpus);
    const completed: number[] = [];
    const indexing = indexer.indexFile(source.file, { signal: controller.signal, onProgress: (snapshot) => completed.push(snapshot.completedFiles) });
    const rejected = expect(indexing).rejects.toMatchObject({ name: 'IndexingCancelledError' });
    await vi.waitFor(() => expect(saving).toHaveBeenCalledOnce());
    expect(refresh).not.toHaveBeenCalled();
    expect(embedBatch).not.toHaveBeenCalled();
    expect(completed.every((count) => count === 0)).toBe(true);
    controller.abort();
    release();
    await rejected;
    expect(embedBatch).not.toHaveBeenCalled();
    expect(await vectors.getEntries()).toEqual([]);
    expect(await source.store.getDocuments()).not.toHaveLength(0);
  });

  it('파일 읽기 실패는 기록하고 성공한 재시도에서는 실패·진행 상태를 해제한다', async () => {
    const source = fixture();
    source.read.mockRejectedValueOnce(new Error('read failed'));
    await expect(source.corpus.refreshFile(source.file)).rejects.toThrow('read failed');
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(true);
    expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
    let finishRead = (_bytes: ArrayBuffer): void => undefined;
    source.read.mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            finishRead = resolve;
          }),
      );
    const retry = source.corpus.refreshFile(source.file);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledTimes(2));
    expect(source.corpus.isReadingPath(source.file.path)).toBe(true);
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    finishRead(sourceBytes('복구된 근거'));
    await retry;
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
  });
  it('이전 읽기의 늦은 실패가 더 최신 원문을 제거하지 않는다', async () => {
    const source = fixture();
    let fail = (_error: Error): void => undefined;
    source.read.mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            fail = reject;
          }),
      );
    const old = source.corpus.refreshFile(source.file).catch((error: unknown) => error);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    source.update('새 근거');
    await source.corpus.refreshFile(source.file);
    fail(new Error('old read failed'));
    expect(await old).toBeInstanceOf(Error);
    expect((await source.store.getDocuments())[0]?.text).toContain('새 근거');
  });
  it('지원 텍스트·코드만 수집하고 설정 변경과 삭제를 같은 저장소에 반영한다', async () => {
    const source = fixture('notes/source.ts');
    source.files.set('image.png', Object.assign(new TFile(), source.file, { path: 'image.png', extension: 'png' }));
    source.binaries.set('image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    await source.corpus.refresh();
    expect(await source.store.getIndexedFilePaths()).toEqual([source.file.path]);
    source.update('수정한 코드 근거');
    await source.corpus.refreshFile(source.file);
    expect((await source.store.getDocuments())[0]?.text).toContain('수정한 코드 근거');
    source.config.excludeExts = ['ts'];
    await source.corpus.refresh();
    expect(await source.store.getDocuments()).toEqual([]);
    expect(source.corpus.hasCandidatePath(source.file.path)).toBe(false);
  });

  it('삭제 후 늦게 도착한 본문 읽기는 삭제한 파일을 되살리지 않는다', async () => {
    const source = fixture();
    let release = (_bytes: ArrayBuffer): void => undefined;
    source.read.mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            release = resolve;
          }),
      );
    const refreshing = source.corpus.refreshFile(source.file);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    source.files.delete(source.file.path);
    await source.corpus.removeFile(source.file.path);
    release(sourceBytes('이전 원문'));
    await refreshing;
    expect(await source.store.getDocuments()).toEqual([]);
  });

  it('읽는 중 원문이 바뀌면 새 메타데이터와 이전 본문을 혼합하지 않는다', async () => {
    const source = fixture();
    source.read.mockImplementationOnce(() => {
      source.update('새 원문');
      return Promise.resolve(sourceBytes('이전 원문'));
    });
    expect(await readSourceFileSnapshot(source.vault, source.file)).toBeNull();
  });

  it('임베딩 실패 후에도 공통 원문과 BM25에 쓸 청크를 보존한다', async () => {
    const source = fixture();
    const indexer = new VaultIndexer(
      source.vault,
      new MemoryVectorStore(),
      {
        embed: () => Promise.reject(new Error('offline')),
        embedBatch: () => Promise.reject(new Error('offline')),
      },
      source.config,
      DEFAULT_SETTINGS.chat,
      undefined,
      appLogger,
      source.corpus,
    );
    await expect(indexer.indexFile(source.file)).rejects.toThrow('offline');
    expect((await source.store.getDocuments())[0]?.text).toContain('현재 원문 근거');
  });

  it('임베딩 요청 중 원문이 변경되면 늦은 벡터를 저장하지 않는다', async () => {
    const source = fixture();
    const vectors = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      source.vault,
      vectors,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: async (texts) => {
          source.update('더 최신 근거');
          await source.corpus.refreshFile(source.file);
          return texts.map(() => [1, 0]);
        },
      },
      source.config,
      DEFAULT_SETTINGS.chat,
      undefined,
      appLogger,
      source.corpus,
    );
    expect(await indexer.indexFile(source.file)).toMatchObject({ indexed: 0, skipped: 1 });
    expect(await vectors.getEntries()).toEqual([]);
    expect((await source.store.getDocuments())[0]?.text).toContain('더 최신 근거');
  });
});

function sourceBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

async function legacyFixture(path = 'notes/backfill.md') {
  const source = fixture(path);
  await source.corpus.refreshFile(source.file);
  const [record] = await source.store.getFileIndexRecords();
  const documents = await source.store.getDocuments();
  await source.store.replaceFileDocuments(path, documents, record.sourceMetadata, record.sourceMetadataHash,
    { sourceMtime: record.sourceMtime!, sourceSize: record.sourceSize!, contentHash: record.contentHash! });
  source.read.mockClear();
  return source;
}

describe('model-free legacy 원문 보충', () => {
  it('실제 Native body 준비를 한 번 읽고 기존 문서·metadata·chunk IDs는 완전히 보존한다', async () => {
    const source = await legacyFixture();
    const documents = await source.store.getDocuments(), [record] = await source.store.getFileIndexRecords(), receipt = await source.store.getDurabilityReceipt();
    const hash = vi.spyOn(rustCore, 'createContentHashRust'), chunks = vi.spyOn(rustCore, 'planSourceChunksRust');
    const prepare = vi.spyOn(rustCore, 'prepareSourceBytesRust');
    const replace = vi.spyOn(source.store, 'replaceFileDocuments'), batch = vi.spyOn(source.store, 'replaceBatchFileDocuments');
    try {
      expect(await source.corpus.backfillSourceBody(source.file)).toBe('updated');
      expect(source.read).toHaveBeenCalledOnce();
      expect(prepare).toHaveBeenCalledOnce();
      expect(prepare.mock.calls[0][2]).toEqual(expect.objectContaining({ path: source.file.path }));
      expect(prepare.mock.calls[0][2]?.chunkSize).toBeUndefined();
      expect(hash).not.toHaveBeenCalled();
      expect(chunks).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(batch).not.toHaveBeenCalled();
      expect(await source.store.getDocuments()).toEqual(documents);
      const [{ sourceBody, ...after }] = await source.store['db'].files.toArray();
      expect(after).toEqual(record);
      expect(sourceBody?.version).toBe(1);
      expect((await source.store.getSourceBodyBlocks(source.file.path, 0, 8)).map(({ text }) => text).join('')).toBe('현재 원문 근거');
      expect(await source.store.getDurabilityReceipt()).not.toEqual(receipt);
      const next = await source.store.getDurabilityReceipt();
      expect(await source.corpus.backfillSourceBody(source.file)).toBe('unchanged');
      expect(source.read).toHaveBeenCalledOnce();
      expect(await source.store.getDurabilityReceipt()).toEqual(next);
    } finally { hash.mockRestore(); chunks.mockRestore(); prepare.mockRestore(); replace.mockRestore(); batch.mockRestore(); }
  });

  it.each(['stat', 'same-stat-body', 'metadata', 'excluded', 'frontmatter', 'deleted', 'missing-record', 'missing-hash', 'invalid-revision', 'unsupported'] as const)('%s는 기존 rows/receipt를 보존한다', async (change) => {
    const source = await legacyFixture();
    if (change === 'stat') source.update('changed');
    if (change === 'same-stat-body' || change === 'frontmatter' || change === 'unsupported') {
      const stat = { ...source.file.stat };
      source.update(change === 'frontmatter' ? '---\nsuperpower-inside-exclude: true\n---\n현재 원문 근거' : '변경된 같은 stat');
      Object.assign(source.file.stat, stat);
      if (change === 'unsupported') source.read.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]).buffer);
    }
    if (change === 'metadata') await source.store['db'].files.update(source.file.path, { sourceMetadataHash: 'bbbbbbbb' });
    if (change === 'excluded') source.config.excludePaths = ['notes'];
    if (change === 'deleted') source.files.delete(source.file.path);
    if (change === 'missing-record') await source.store['db'].files.delete(source.file.path);
    if (change === 'missing-hash') await source.store['db'].files.update(source.file.path, { sourceMetadataHash: undefined });
    if (change === 'invalid-revision') await source.store['db'].files.update(source.file.path, { contentHash: 'not-hash8' });
    const before = await source.store.getFileIndexRecords(), documents = await source.store.getDocuments(), receipt = await source.store.getDurabilityReceipt();
    expect(await source.corpus.backfillSourceBody(source.file)).toBe(['missing-record', 'missing-hash', 'invalid-revision', 'unsupported'].includes(change) ? 'unavailable' : 'stale');
    expect(await source.store.getFileIndexRecords()).toEqual(before);
    expect(await source.store.getDocuments()).toEqual(documents);
    expect(await source.store.getSourceBodyBlocks(source.file.path, 0, 8)).toEqual([]);
    expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
  });

  it.each(['no-plan', 'partial'] as const)('%s 원문은 complete로 승격하지 않는다', async (kind) => {
    const source = await legacyFixture();
    const snapshot = await readSourceFileSnapshot(source.vault, source.file, { preparation: { path: source.file.path } });
    const read = vi.spyOn(sourceSnapshots, 'readSourceFileSnapshot').mockResolvedValue({ ...snapshot!, ...(kind === 'no-plan' ? { bodyPlan: undefined } : { sourceMetadata: { segments: [], completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } } }) });
    const receipt = await source.store.getDurabilityReceipt();
    try {
      expect(await source.corpus.backfillSourceBody(source.file)).toBe('unavailable');
      expect((await source.store.getSourceBodyHeader(source.file.path))?.body).toBeNull();
      expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
    } finally { read.mockRestore(); }
  });

  it('명시적 빈 본문은 0청크 legacy의 실제 원문 capability로 저장한다', async () => {
    const source = await legacyFixture('notes/empty.md');
    source.update('');
    await source.corpus.refreshFile(source.file);
    const [record] = await source.store.getFileIndexRecords();
    await source.store.replaceFileDocuments(source.file.path, [], record.sourceMetadata, record.sourceMetadataHash, { sourceMtime: record.sourceMtime!, sourceSize: 0, contentHash: record.contentHash! });
    expect(await source.corpus.backfillSourceBody(source.file)).toBe('updated');
    expect((await source.store.getSourceBodyHeader(source.file.path))?.body).toMatchObject({ byteLength: 0, blockCount: 0 });
    expect(await source.store.getDocuments()).toEqual([]);
  });

  it.each(['signal', 'suspend', 'admit', 'callback-throw', 'reentrant-signal', 'reentrant-suspend'] as const)('%s는 기존 rows를 보존하고 고정 AbortError만 반환한다', async (kind) => {
    const source = await legacyFixture();
    const receipt = await source.store.getDurabilityReceipt(), documents = await source.store.getDocuments();
    const controller = new AbortController();
    if (kind === 'signal') controller.abort(new Error('PRIVATE ABORT REASON'));
    if (kind === 'suspend') source.corpus.suspend();
    const admit = () => {
      if (kind === 'callback-throw') throw new Error('PRIVATE ADMIT BODY');
      if (kind === 'reentrant-signal') controller.abort(new Error('PRIVATE SIGNAL BODY'));
      if (kind === 'reentrant-suspend') source.corpus.suspend();
      return kind !== 'admit';
    };
    await expect(source.corpus.backfillSourceBody(source.file, { signal: controller.signal, admit })).rejects.toMatchObject({ name: 'AbortError', message: 'rag-source-body-aborted' });
    expect(await source.store.getDocuments()).toEqual(documents);
    expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
    expect(source.read).not.toHaveBeenCalled();
  });

  it.each(['signal', 'suspend', 'refresh', 'backfill'] as const)('읽는 중 %s가 이전 owner의 late write를 막는다', async (kind) => {
    const source = await legacyFixture();
    let finish!: (bytes: ArrayBuffer) => void;
    source.read.mockReturnValueOnce(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const previous = source.corpus.backfillSourceBody(source.file, { signal: controller.signal });
    const rejected = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    if (kind === 'signal') controller.abort();
    if (kind === 'suspend') source.corpus.suspend();
    if (kind === 'refresh')
      await source.corpus.refreshFile(source.file);
    if (kind === 'backfill') expect(await source.corpus.backfillSourceBody(source.file)).toBe('updated');
    finish(sourceBytes('late obsolete source'));
    await rejected;
    expect(source.corpus.isBusy()).toBe(false);
    if (kind === 'signal' || kind === 'suspend') expect((await source.store.getSourceBodyHeader(source.file.path))?.body).toBeNull();
    else expect((await source.store.getSourceBodyBlocks(source.file.path, 0, 8))[0]?.text).toBe('현재 원문 근거');
  });

  it('store가 쓰는 도중 정책/stat/admit가 변하면 transaction 전체가 rollback된다', async () => {
    for (const change of ['policy', 'stat', 'admit', 'extension'] as const) {
      const source = await legacyFixture();
      const receipt = await source.store.getDurabilityReceipt();
      let allowed = true;
      source.store['db'].sourceBlocks.hook('creating', () => {
        if (change === 'policy') source.config.excludePaths = ['notes'];
        if (change === 'stat') source.file.stat.mtime++;
        if (change === 'extension') source.file.extension = 'txt';
        if (change === 'admit') allowed = false;
      });
      await expect(source.corpus.backfillSourceBody(source.file, { admit: () => allowed })).rejects.toMatchObject({ name: 'AbortError' });
      expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
      expect((await source.store.getSourceBodyHeader(source.file.path))?.body).toBeNull();
      expect(await source.store.getSourceBodyBlocks(source.file.path, 0, 8)).toEqual([]);
    }
  });

  it('cursor의 작은 header page만 순회하고 상태 원장을 집계한다', async () => {
    const source = await legacyFixture();
    for (let index = 0; index < 35; index++) {
      const path = `notes/page-${String(index).padStart(2, '0')}.md`;
      const file = Object.assign(new TFile(), source.file, { path });
      source.files.set(path, file);
      source.binaries.set(path, new TextEncoder().encode('현재 원문 근거'));
      await source.corpus.refreshFile(file);
    }
    const legacy = await source.store.getSourceBodyHeader(source.file.path);
    const emptyPath = 'notes/missing-meta.md';
    await source.store['db'].files.put({ filePath: emptyPath, vectorCount: 0, updated: 1 });
    source.files.set(emptyPath, Object.assign(new TFile(), source.file, { path: emptyPath }));
    const missingPath = 'notes/removed.md';
    await source.store['db'].files.put({ filePath: missingPath, sourceMtime: legacy!.sourceMtime!, sourceSize: legacy!.sourceSize!, contentHash: legacy!.contentHash!, sourceMetadataHash: legacy!.sourceMetadataHash!, vectorCount: 0, updated: 1 });
    source.read.mockClear();
    const pages = vi.spyOn(source.store, 'getSourceBodyHeaders');
    const full = vi.spyOn(source.store, 'getFileIndexRecords').mockRejectedValue(new Error('full file scan forbidden'));
    const blocks = vi.spyOn(source.store, 'getSourceBodyBlocks').mockRejectedValue(new Error('raw preload forbidden'));
    try {
      expect(await source.corpus.backfillSourceBodies()).toEqual({ updated: 1, unchanged: 35, stale: 1, unavailable: 1 });
      expect(pages.mock.calls.length).toBeGreaterThan(1);
      expect(pages.mock.calls.every(([, limit]) => limit >= 1 && limit <= 32)).toBe(true);
      expect(pages.mock.calls[1][0]).not.toBeNull();
      expect(full).not.toHaveBeenCalled();
      expect(blocks).not.toHaveBeenCalled();
      expect(source.read).toHaveBeenCalledOnce();
    } finally { pages.mockRestore(); full.mockRestore(); blocks.mockRestore(); }
  });
});

describe('원문 보충의 소유권·admission 경계', () => {
  it('이전 refresh의 늦은 읽기는 후발 backfill 소유권을 덮거나 삭제하지 않는다', async () => {
    const source = await legacyFixture();
    let finish!: (bytes: ArrayBuffer) => void;
    source.read.mockReturnValueOnce(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
    const refreshing = source.corpus.refreshFile(source.file);
    const rejected = expect(refreshing).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledOnce());
    expect(await source.corpus.backfillSourceBody(source.file)).toBe('updated');
    finish(sourceBytes('obsolete refresh source'));
    await rejected;
    expect((await source.store.getDocuments())[0]?.text).toBe('현재 원문 근거');
    expect((await source.store.getSourceBodyBlocks(source.file.path, 0, 8))[0]?.text).toBe('현재 원문 근거');
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
  });

  it.each(['admit', 'signal', 'owner'] as const)('DB await 뒤 reentrant %s는 쓰기를 rollback한다', async (kind) => {
    const source = await legacyFixture();
    const controller = new AbortController();
    const receipt = await source.store.getDurabilityReceipt();
    let written = false, replacement: Promise<void> | undefined;
    source.store['db'].sourceBlocks.hook('creating', () => { written = true; });
    await expect(source.corpus.backfillSourceBody(source.file, { signal: controller.signal, admit: () => {
      if (!written) return true;
      if (kind === 'signal') controller.abort(new Error('PRIVATE REENTRANT ERROR'));
      if (kind === 'owner' && !replacement) replacement = source.corpus.refreshFile(source.file);
      return kind !== 'admit';
    } })).rejects.toMatchObject({ name: 'AbortError', message: 'rag-source-body-aborted' });
    if (replacement) {
      await replacement;
      expect((await source.store.getSourceBodyBlocks(source.file.path, 0, 8))[0]?.text).toBe('현재 원문 근거');
    } else {
      expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
      expect((await source.store.getSourceBodyHeader(source.file.path))?.body).toBeNull();
      expect(await source.store.getSourceBodyBlocks(source.file.path, 0, 8)).toEqual([]);
    }
  });

  it('header page await 중 중단은 새 파일 읽기·쓰기 없이 종료한다', async () => {
    const source = await legacyFixture();
    const get = source.store.getSourceBodyHeaders.bind(source.store);
    const page = vi.spyOn(source.store, 'getSourceBodyHeaders').mockImplementation(async (...args) => {
      const result = await get(...args);
      source.corpus.suspend();
      return result;
    });
    const receipt = await source.store.getDurabilityReceipt();
    try {
      await expect(source.corpus.backfillSourceBodies()).rejects.toMatchObject({ name: 'AbortError' });
      expect(source.read).not.toHaveBeenCalled();
      expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
    } finally { page.mockRestore(); }
  });
});

describe('해석할 수 없는 legacy capability', () => {
  it.each(['body-version', 'zero-without-revision', 'partial-header'] as const)('%s를 성공 0 또는 repair 대상으로 승격하지 않는다', async (kind) => {
    const source = await legacyFixture();
    if (kind === 'body-version') await source.store['db'].table('files').update(source.file.path, { sourceBody: { version: 2, blockCount: 0, byteLength: 0, utf16Length: 0, scanChargeBytes: 0 } });
    if (kind === 'zero-without-revision') await source.store['db'].table('files').put({ filePath: source.file.path, vectorCount: 0, updated: 1 });
    if (kind === 'partial-header') await source.store['db'].files.update(source.file.path, { sourceMetadata: { segments: [], completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } } });
    const receipt = await source.store.getDurabilityReceipt(), before = await source.store.getFileIndexRecords();
    expect(await source.corpus.backfillSourceBody(source.file)).toBe('unavailable');
    expect(source.read).not.toHaveBeenCalled();
    expect(await source.store.getFileIndexRecords()).toEqual(before);
    expect(await source.store.getDurabilityReceipt()).toEqual(receipt);
  });
});

describe('corpus 실제 작업 관측', () => {
  it('기존 manifest 수량과 실제 source/store 정착을 게시하며 관측자 실패를 격리한다', async () => {
    const source = fixture();
    const work: { stage: string; processed: number | null; total: number | null }[] = [];
    const corpus = new VaultDocumentCorpus(source.vault, source.store, () => source.config, () => DEFAULT_SETTINGS.chat, appLogger, undefined,
      (stage, processed, total) => { work.push({ stage, processed, total }); if (stage === 'lexical') throw new Error('observer'); });
    await corpus.refresh();
    expect(work).toContainEqual({ stage: 'planning', processed: null, total: null });
    expect(work).toContainEqual({ stage: 'preparing-source', processed: 0, total: 1 });
    expect(work).toContainEqual({ stage: 'lexical', processed: null, total: null });
    expect(work.at(-1)).toEqual({ stage: 'preparing-source', processed: 1, total: 1 });
    expect(await source.store.getFileIndexRecords()).toHaveLength(1);
    corpus.dispose();
  });
});
