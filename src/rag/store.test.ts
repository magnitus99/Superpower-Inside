import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbVectorStore,
  JsonFileVectorStore,
  MemoryVectorStore,
  type VectorEntry,
  type VectorStore,
} from './store';

const dbNames = new Set<string>();

describe('IndexedDbVectorStore', () => {
  afterEach(async () => {
    await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
    dbNames.clear();
  });

  it('벡터를 추가하고 같은 id를 덮어쓴다', async () => {
    const store = createStore();
    await store.add([createEntry('note.md', 0, [1, 0], 'old')]);

    await store.add([createEntry('note.md', 0, [0, 1], 'new')]);

    const entries = await store.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(expect.objectContaining({ id: 'note.md::0', vector: [0, 1] }));
    expect(entries[0].metadata.text).toBe('new');
  });

  it('파일 경로 기준으로 벡터를 삭제한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('note.md', 0, [1, 0], 'a'),
      createEntry('note.md', 10, [0.9, 0.1], 'b'),
      createEntry('other.md', 0, [0, 1], 'c'),
    ]);

    const removed = await store.removeByFilePath('note.md');

    expect(removed).toBe(2);
    expect((await store.getEntries()).map((entry) => entry.id)).toEqual(['other.md::0']);
  });

  it('통계와 인덱싱된 파일 경로를 반환한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('note.md', 0, [1, 0], 'a'),
      createEntry('note.md', 10, [0.9, 0.1], 'b'),
      createEntry('other.md', 0, [0, 1], 'c'),
    ]);

    const stats = await store.getStats();

    expect(stats.totalEntries).toBe(3);
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalVectors).toBe(3);
    expect(stats.averageVectorsPerFile).toBe(1.5);
    expect(stats.lastUpdated).toEqual(expect.any(Number));
    expect(await store.getIndexedFilePaths()).toEqual(['note.md', 'other.md']);
  });

  it('파일 단위 인덱스 메타를 증분 갱신한다', async () => {
    const store = createStore();
    await store.replaceFileEntries('note.md', [
      createEntry('note.md', 0, [1, 0], 'a'),
      createEntry('note.md', 10, [0.9, 0.1], 'b'),
    ]);

    expect(await store.getFileIndexRecords()).toEqual([
      expect.objectContaining({
        filePath: 'note.md',
        sourceMtime: 1000,
        sourceSize: 1,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        vectorCount: 2,
      }),
    ]);

    await store.replaceFileEntries('note.md', [createEntry('note.md', 20, [0, 1], 'new')]);

    expect(await store.getFileIndexRecords()).toEqual([
      expect.objectContaining({
        filePath: 'note.md',
        sourceSize: 3,
        vectorCount: 1,
      }),
    ]);
  });

  it('파일 경로 목록으로 필요한 entries만 조회한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('a.md', 0, [1, 0], 'a'),
      createEntry('b.md', 0, [0, 1], 'b'),
      createEntry('c.md', 0, [0.5, 0.5], 'c'),
    ]);

    const entries = await store.getEntriesByFilePaths(['b.md', 'c.md']);

    expect(entries.map((entry) => entry.metadata.filePath).sort()).toEqual(['b.md', 'c.md']);
  });

  it('cosine similarity 순서로 query 결과를 반환한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('a.md', 0, [1, 0], 'a'),
      createEntry('b.md', 0, [0, 1], 'b'),
      createEntry('c.md', 0, [0.8, 0.2], 'c'),
    ]);

    const results = await store.query([1, 0], 2);

    expect(results.map((entry) => entry.id)).toEqual(['a.md::0', 'c.md::0']);
  });

  it('clear로 모든 벡터를 삭제한다', async () => {
    const store = createStore();
    await store.add([createEntry('note.md', 0, [1, 0], 'a')]);

    await store.clear();

    expect(await store.getEntries()).toEqual([]);
    expect(await store.getStats()).toEqual({
      totalEntries: 0,
      totalFiles: 0,
      totalVectors: 0,
      averageVectorsPerFile: 0,
      lastUpdated: null,
    });
  });
});

describe('VectorStore contract', () => {
  it('MemoryVectorStore가 공통 저장소 계약을 만족한다', async () => {
    await expectVectorStoreContract(new MemoryVectorStore());
  });

  it('JsonFileVectorStore가 공통 저장소 계약을 만족한다', async () => {
    const adapter = new TestJsonAdapter();
    await expectVectorStoreContract(new JsonFileVectorStore(adapter.asDataAdapter(), 'vectors.json'));
  });

  it('IndexedDbVectorStore가 공통 저장소 계약을 만족한다', async () => {
    await expectVectorStoreContract(createStore());
  });
});

describe('JsonFileVectorStore load state', () => {
  it('정상적인 빈 저장소는 반복 호출해도 한 번만 읽는다', async () => {
    const adapter = new TestJsonAdapter();
    adapter.setRaw('vectors.json', '[]');
    const store = new JsonFileVectorStore(adapter.asDataAdapter(), 'vectors.json');

    expect(await store.getEntries()).toEqual([]);
    expect(await store.getStats()).toMatchObject({ totalEntries: 0, lastUpdated: null });
    expect(await store.getIndexedFilePaths()).toEqual([]);

    expect(adapter.readCount).toBe(1);
  });

  it('invalid JSON은 빈 저장소로 고정하고 반복 read를 만들지 않는다', async () => {
    const adapter = new TestJsonAdapter();
    adapter.setRaw('vectors.json', '{ invalid');
    const store = new JsonFileVectorStore(adapter.asDataAdapter(), 'vectors.json');

    expect(await store.getEntries()).toEqual([]);
    expect(await store.getIndexedFilePaths()).toEqual([]);

    expect(adapter.readCount).toBe(1);
  });
});

function createStore(): IndexedDbVectorStore {
  const dbName = `SuperpowerInsideVectorStoreTest-${crypto.randomUUID()}`;
  dbNames.add(dbName);
  return new IndexedDbVectorStore(dbName);
}

function createEntry(
  filePath: string,
  startLine: number,
  vector: number[],
  text: string,
): VectorEntry {
  return {
    id: `${filePath}::${startLine}`,
    vector,
    metadata: {
      filePath,
      startLine,
      endLine: startLine,
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      contentHash: text,
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}

async function expectVectorStoreContract(store: VectorStore): Promise<void> {
  await store.add([
    createEntry('note.md', 0, [1, 0], 'a'),
    createEntry('note.md', 10, [0.8, 0.2], 'b'),
    createEntry('other.md', 0, [0, 1], 'c'),
  ]);

  expect((await store.query([1, 0], 2)).map((entry) => entry.id)).toEqual([
    'note.md::0',
    'note.md::10',
  ]);
  expect(await store.removeByFilePath('note.md')).toBe(2);
  expect((await store.getEntries()).map((entry) => entry.id)).toEqual(['other.md::0']);

  const stats = await store.getStats();
  expect(stats.totalEntries).toBe(1);
  expect(stats.totalFiles).toBe(1);
  expect(stats.totalVectors).toBe(1);
  expect(await store.getIndexedFilePaths()).toEqual(['other.md']);

  await store.clear();
  expect(await store.getEntries()).toEqual([]);
}

class TestJsonAdapter {
  private files = new Map<string, string>();
  readCount = 0;
  writeCount = 0;

  setRaw(path: string, value: string): void {
    this.files.set(path, value);
  }

  asDataAdapter(): DataAdapter {
    return {
      exists: (path: string) => Promise.resolve(this.files.has(path)),
      read: (path: string) => {
        this.readCount += 1;
        return Promise.resolve(this.files.get(path) ?? '');
      },
      write: (path: string, data: string) => {
        this.writeCount += 1;
        this.files.set(path, data);
        return Promise.resolve();
      },
      mkdir: () => Promise.resolve(),
    } as unknown as DataAdapter;
  }
}

describe('VectorStore 파일 단위 교체', () => {
  it('replaceFileEntries는 대상 파일의 기존 벡터만 교체한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('note.md', 0, [1, 0], 'old-a'),
      createEntry('note.md', 10, [0.9, 0.1], 'old-b'),
      createEntry('other.md', 0, [0, 1], 'other'),
    ]);

    await store.replaceFileEntries('note.md', [createEntry('note.md', 20, [0.5, 0.5], 'new')]);

    expect((await store.getEntries()).map((entry) => entry.id)).toEqual([
      'other.md::0',
      'note.md::20',
    ]);
  });

  it('JSON 저장소 배치 모드에서는 여러 파일 교체 후 한 번만 persist한다', async () => {
    const adapter = new TestJsonAdapter();
    const store = new JsonFileVectorStore(adapter.asDataAdapter(), 'vectors.json');

    await store.withBatch(async () => {
      await store.replaceFileEntries('a.md', [createEntry('a.md', 0, [1, 0], 'a')]);
      await store.replaceFileEntries('b.md', [createEntry('b.md', 0, [0, 1], 'b')]);
    });

    expect(adapter.writeCount).toBe(2);
    expect((await store.getIndexedFilePaths()).sort()).toEqual(['a.md', 'b.md']);
  });
});
