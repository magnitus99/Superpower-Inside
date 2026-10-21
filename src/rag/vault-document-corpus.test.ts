import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile, Vault } from 'obsidian';
import { DEFAULT_SETTINGS, type RAGConfig } from '../settings';
import { appLogger } from '../utils/logger';
import { IndexedDbDocumentCorpusStore } from './document-corpus-store';
import { VaultDocumentCorpus } from './vault-document-corpus';
import { readSourceFileSnapshot } from './source-snapshot';
import { VaultIndexer } from './indexer';
import { MemoryVectorStore } from './store';

const stores: IndexedDbDocumentCorpusStore[] = [];
const names: string[] = [];
vi.mock('obsidian', () => ({
  App: class {},
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
  const file = {
    path,
    name: path.split('/').at(-1),
    basename: 'source',
    extension: path.split('.').at(-1),
    stat: { mtime: 1, size: content.length },
  } as TFile;
  const files = new Map([[path, file]]);
  const read = vi.fn(() => Promise.resolve(content));
  const vault = {
    configDir: '.obsidian',
    getFiles: () => [...files.values()],
    getAbstractFileByPath: (key: string) => files.get(key) ?? null,
    cachedRead: read,
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
      startLine: 0,
    });
  });
  it('파일 읽기가 끝나기 전에는 busy이고 완료되면 해제된다', async () => {
    const source = fixture('notes/busy.txt');
    let resolveRead!: (text: string) => void;
    source.read.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const refresh = source.corpus.refreshFile(source.file);
    expect(source.corpus.isBusy()).toBe(true);
    resolveRead('현재 원문 근거');
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
      let resolveRead!: (text: string) => void;
      let rejectRead!: (error: Error) => void;
      source.read.mockReturnValueOnce(
        new Promise<string>((resolve, reject) => {
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
        if (settlement === 'resolve') resolveRead('합성 이전 응답');
        else rejectRead(new Error('late corpus read failure'));
        await observed;
      }
      await expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
      expect((await source.store.getDocuments())[0]?.text).toContain('합성 새 본문');
      expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
      expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    },
  );

  it('인덱서가 corpus의 추가 원문 읽기에 signal을 전달하여 임베딩 전에 취소된다', async () => {
    const source = fixture('notes/index-cancel.txt');
    const controller = new AbortController();
    let resolveRead!: (text: string) => void;
    source.read
      .mockResolvedValueOnce('합성 본문')
      .mockResolvedValueOnce('합성 본문')
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
      );
    const refreshFile = vi.spyOn(source.corpus, 'refreshFile');
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const vectors = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      source.vault,
      vectors,
      { embed: () => Promise.resolve([1, 0]), embedBatch },
      source.config,
      DEFAULT_SETTINGS.chat,
      undefined,
      appLogger,
      source.corpus,
    );
    let outcome: unknown;
    const indexing = indexer.indexFile(source.file, { signal: controller.signal });
    const observed = indexing.catch((error: unknown) => {
      outcome = error;
    });
    try {
      await vi.waitFor(() => expect(source.read).toHaveBeenCalledTimes(3));
      controller.abort();
      await vi.waitFor(() => expect(outcome).toMatchObject({ name: 'AbortError' }));
      expect(refreshFile).toHaveBeenCalledWith(source.file, controller.signal);
      expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
      expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    } finally {
      resolveRead('합성 본문');
      await observed;
    }
    expect(embedBatch).not.toHaveBeenCalled();
    expect(await vectors.getEntries()).toEqual([]);
  });

  it('파일 읽기 실패는 기록하고 성공한 재시도에서는 실패·진행 상태를 해제한다', async () => {
    const source = fixture();
    source.read.mockRejectedValueOnce(new Error('read failed'));
    await expect(source.corpus.refreshFile(source.file)).rejects.toThrow('read failed');
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(true);
    expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
    let finishRead = (_text: string): void => undefined;
    source.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    const retry = source.corpus.refreshFile(source.file);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalledTimes(2));
    expect(source.corpus.isReadingPath(source.file.path)).toBe(true);
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    finishRead('복구된 근거');
    await retry;
    expect(source.corpus.hasFailedPath(source.file.path)).toBe(false);
    expect(source.corpus.isReadingPath(source.file.path)).toBe(false);
  });
  it('이전 읽기의 늦은 실패가 더 최신 원문을 제거하지 않는다', async () => {
    const source = fixture();
    let fail = (_error: Error): void => undefined;
    source.read.mockImplementationOnce(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const old = source.corpus.refreshFile(source.file).catch((error: unknown) => error);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalled());
    source.update('새 근거');
    await source.corpus.refreshFile(source.file);
    fail(new Error('old read failed'));
    expect(await old).toBeInstanceOf(Error);
    expect((await source.store.getDocuments())[0]?.text).toContain('새 근거');
  });
  it('지원 텍스트·코드만 수집하고 설정 변경과 삭제를 같은 저장소에 반영한다', async () => {
    const source = fixture('notes/source.ts');
    source.files.set('image.png', { ...source.file, path: 'image.png', extension: 'png' });
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
    let release = (_content: string): void => undefined;
    source.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const refreshing = source.corpus.refreshFile(source.file);
    await vi.waitFor(() => expect(source.read).toHaveBeenCalled());
    source.files.delete(source.file.path);
    await source.corpus.removeFile(source.file.path);
    release('이전 원문');
    await refreshing;
    expect(await source.store.getDocuments()).toEqual([]);
  });

  it('읽는 중 원문이 바뀌면 새 메타데이터와 이전 본문을 혼합하지 않는다', async () => {
    const source = fixture();
    source.read.mockImplementationOnce(() => {
      source.update('새 원문');
      return Promise.resolve('이전 원문');
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
