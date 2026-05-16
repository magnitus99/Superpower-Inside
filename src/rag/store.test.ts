import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbVectorStore, type VectorEntry } from './store';

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

function createStore(): IndexedDbVectorStore {
  const dbName = `SuperObsidianVectorStoreTest-${crypto.randomUUID()}`;
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
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}
