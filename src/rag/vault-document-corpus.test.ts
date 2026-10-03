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
