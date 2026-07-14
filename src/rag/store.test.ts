import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbVectorStore,
  importLegacyJsonVectorStore,
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

  it('search는 embedding provider/model/dimension 필터에 맞는 벡터만 점수화한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('openai.md', 0, [1, 0], 'openai'),
      {
        ...createEntry('ollama.md', 0, [1, 0], 'ollama'),
        metadata: {
          ...createEntry('ollama.md', 0, [1, 0], 'ollama').metadata,
          embeddingProvider: 'ollama',
        },
      },
      createEntry('other-dimension.md', 0, [1, 0, 0], 'other dimension'),
    ]);

    const results = await store.search({
      queryVector: [1, 0],
      topK: 5,
      filter: {
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        dimension: 2,
      },
    });

    expect(results.map((result) => result.entry.id)).toEqual(['openai.md::0']);
    expect(results[0]?.score).toBeCloseTo(1);
    expect(results[0]?.mode).toBe('exact');
  });

  it('search는 file path prefix로 지정한 폴더의 벡터만 점수화한다', async () => {
    const store = createStore();
    await store.add([
      createEntry('archive/overview.md', 0, [1, 0], 'archive'),
      createEntry('aurora/migration.txt', 0, [0.9, 0.1], 'aurora'),
      createEntry('aurora-old/note.txt', 0, [1, 0], 'other'),
    ]);

    const results = await store.search({
      queryVector: [1, 0],
      topK: 5,
      filter: { filePathPrefixes: ['aurora'] },
    });

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual([
      'aurora/migration.txt',
    ]);
  });

  it('large store search는 전체 entries cache를 hydrate하지 않고 page 단위로 점수화한다', async () => {
    const store = createStore(createDbName(), {
      hydrateAllEntryLimit: 2,
      pageSize: 2,
    });
    await store.add([
      createEntry('a.md', 0, [1, 0], 'a'),
      createEntry('b.md', 0, [0.8, 0.2], 'b'),
      createEntry('c.md', 0, [0, 1], 'c'),
      createEntry('d.md', 0, [0.9, 0.1], 'd'),
    ]);

    const results = await store.search({ queryVector: [1, 0], topK: 2 });

    expect(results.map((result) => result.entry.id)).toEqual(['a.md::0', 'd.md::0']);
    expect(store.getRuntimeCacheStats()).toEqual(
      expect.objectContaining({
        entriesCacheLoaded: false,
        searchEntriesCacheSize: 0,
      }),
    );
  });

  it('검색/runtime index cache는 설정한 LRU 예산 안에서만 유지된다', async () => {
    const store = createStore(createDbName(), {
      hydrateAllEntryLimit: 100,
      searchCacheLimit: 1,
      runtimeIndexCacheLimit: 1,
      ivfRuntimeIndexCacheLimit: 1,
    });
    await store.add([
      createEntry('openai.md', 0, [1, 0], 'openai'),
      {
        ...createEntry('ollama.md', 0, [0, 1], 'ollama'),
        metadata: {
          ...createEntry('ollama.md', 0, [0, 1], 'ollama').metadata,
          embeddingProvider: 'ollama',
        },
      },
    ]);

    await store.search({
      queryVector: [1, 0],
      topK: 1,
      filter: { embeddingProvider: 'openai', dimension: 2 },
    });
    await store.search({
      queryVector: [0, 1],
      topK: 1,
      filter: { embeddingProvider: 'ollama', dimension: 2 },
    });
    await store.search({
      queryVector: [0, 1],
      topK: 1,
      mode: 'ann',
      annMinEntryCount: 1,
      annClusterCount: 1,
    });

    expect(store.getRuntimeCacheStats()).toEqual(
      expect.objectContaining({
        searchEntriesCacheSize: 1,
        filteredRuntimeIndexCount: 1,
        ivfRuntimeIndexCount: 1,
      }),
    );
  });

  it('IndexedDB record는 벡터를 ArrayBuffer와 dimension으로 저장한다', async () => {
    const dbName = createDbName();
    const store = createStore(dbName);

    await store.add([createEntry('typed.md', 0, [0.25, 0.75], 'typed')]);

    const db = new Dexie(dbName);
    db.version(3).stores({
      vectors:
        'id, filePath, embeddingProvider, embeddingModel, dimension, [embeddingProvider+embeddingModel+dimension], updated',
      fileIndex: 'filePath, updated',
      meta: 'key',
    });
    const raw = (await db.table('vectors').get('typed.md::0')) as
      | Record<string, unknown>
      | undefined;

    expect(raw?.vector).toBeUndefined();
    expect(raw?.vectorBuffer).toBeInstanceOf(ArrayBuffer);
    expect(raw?.dimension).toBe(2);
    db.close();
  });

  it('legacy v1 벡터 레코드는 schema upgrade에서 전체 변환하지 않고 lazy로 읽는다', async () => {
    const dbName = createDbName();
    dbNames.add(dbName);
    const legacyEntry = createEntry('legacy.md', 0, [0.25, 0.75], 'legacy');
    await seedLegacyVectorDb(dbName, legacyEntry);

    const store = createStore(dbName);

    await expect(store.getEntriesByIds([legacyEntry.id])).resolves.toEqual([legacyEntry]);
    await expect(
      store.search({
        queryVector: [0.25, 0.75],
        topK: 1,
        filter: {
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
          dimension: 2,
        },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        entry: legacyEntry,
        mode: 'exact',
      }),
    ]);

    const raw = await readRawVectorRecord(dbName, legacyEntry.id);
    expect(raw?.vector).toEqual([0.25, 0.75]);
    expect(raw?.vectorBuffer).toBeUndefined();
    expect(raw?.dimension).toBeUndefined();
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

  it('deleteDatabase는 벡터와 메타데이터 DB를 통째로 삭제한다', async () => {
    const dbName = createDbName();
    const store = createStore(dbName);
    await store.add([createEntry('note.md', 0, [1, 0], 'a')]);
    await store.setMetaValue('legacy-json-vector-import:v1', true);

    await store.deleteDatabase();

    const reopened = createStore(dbName);
    expect(await reopened.getEntries()).toEqual([]);
    expect(await reopened.getMetaValue('legacy-json-vector-import:v1')).toBeUndefined();
  });
  it('reconciles deleted, legacy, and foreign-model records in bounded Rust-planned batches', async () => {
    const store = createStore();
    const legacy = createEntry('legacy.md', 0, [1, 0], 'legacy');
    delete legacy.metadata.embeddingProvider;
    delete legacy.metadata.embeddingModel;
    const foreign = createEntry('foreign.md', 0, [1, 0], 'foreign');
    foreign.metadata.embeddingProvider = 'profile:remote';
    foreign.metadata.embeddingModel = 'embedding-v3';
    await store.add([
      createEntry('current.md', 0, [1, 0], 'current'),
      createEntry('deleted.md', 0, [1, 0], 'deleted'),
      legacy,
      foreign,
    ]);

    await expect(
      store.reconcileFileIndex({
        validFilePaths: ['current.md', 'legacy.md', 'foreign.md'],
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        maxDeletions: 2,
      }),
    ).resolves.toEqual({
      deletedFilePaths: ['deleted.md', 'foreign.md'],
      remainingStaleCount: 1,
    });
    expect((await store.getIndexedFilePaths()).sort()).toEqual(['current.md', 'legacy.md']);

    await expect(
      store.reconcileFileIndex({
        validFilePaths: ['current.md', 'legacy.md'],
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      }),
    ).resolves.toEqual({ deletedFilePaths: ['legacy.md'], remainingStaleCount: 0 });
    expect(await store.getIndexedFilePaths()).toEqual(['current.md']);
  });

  it('close releases the database and disables accidental auto-open', async () => {
    const store = createStore();
    await store.add([createEntry('current.md', 0, [1, 0], 'current')]);

    store.close();

    await expect(store.getEntries()).rejects.toThrow();
  });
});

describe('VectorStore contract', () => {
  it('MemoryVectorStore가 공통 저장소 계약을 만족한다', async () => {
    await expectVectorStoreContract(new MemoryVectorStore());
  });

  it('IndexedDbVectorStore가 공통 저장소 계약을 만족한다', async () => {
    await expectVectorStoreContract(createStore());
  });

  it('MemoryVectorStore 파일 인덱스 메타는 Rust plan으로 complete/incomplete를 구분한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('complete.md', 0, [1, 0], 'a'),
      createEntry('complete.md', 10, [0.8, 0.2], 'b'),
      createEntryWithoutEmbeddingModel('incomplete.md', 0, [0, 1], 'c'),
    ]);

    const records = await store.getFileIndexRecords();
    expect(records).toEqual([
      expect.objectContaining({
        filePath: 'complete.md',
        contentHash: 'a',
        hasCompleteMetadata: true,
        vectorCount: 2,
      }),
      {
        filePath: 'incomplete.md',
        sourceMtime: undefined,
        sourceSize: undefined,
        contentHash: undefined,
        indexedAt: undefined,
        embeddingProvider: undefined,
        embeddingModel: undefined,
        hasCompleteMetadata: false,
        vectorCount: 1,
        updated: records[1]?.updated,
      },
    ]);
    expect(records[1]?.updated).toEqual(expect.any(Number));
  });
});

describe('legacy JSON vector import', () => {
  it('기존 JSON 벡터 파일을 IndexedDB로 한 번만 가져온다', async () => {
    const adapter = new TestJsonAdapter();
    adapter.setRaw('vectors.json', JSON.stringify([createEntry('legacy.md', 0, [1, 0], 'legacy')]));
    const store = createStore();

    await expect(
      importLegacyJsonVectorStore(adapter.asDataAdapter(), store, 'vectors.json'),
    ).resolves.toEqual({
      imported: 1,
      skipped: false,
    });
    expect((await store.getEntries()).map((entry) => entry.id)).toEqual(['legacy.md::0']);

    adapter.setRaw('vectors.json', JSON.stringify([createEntry('new.md', 0, [0, 1], 'new')]));
    await expect(
      importLegacyJsonVectorStore(adapter.asDataAdapter(), store, 'vectors.json'),
    ).resolves.toEqual({
      imported: 0,
      skipped: true,
    });
    expect((await store.getEntries()).map((entry) => entry.id)).toEqual(['legacy.md::0']);
  });

  it('잘못된 JSON 벡터 파일은 빈 이관으로 처리하고 반복 시도하지 않는다', async () => {
    const adapter = new TestJsonAdapter();
    adapter.setRaw('vectors.json', '{ invalid');
    const store = createStore();

    await expect(
      importLegacyJsonVectorStore(adapter.asDataAdapter(), store, 'vectors.json'),
    ).resolves.toEqual({
      imported: 0,
      skipped: false,
    });
    await expect(
      importLegacyJsonVectorStore(adapter.asDataAdapter(), store, 'vectors.json'),
    ).resolves.toEqual({
      imported: 0,
      skipped: true,
    });
    expect(await store.getEntries()).toEqual([]);
  });

  it('큰 legacy JSON 벡터 파일은 시작 경로에서 읽지 않고 건너뛴다', async () => {
    const adapter = new TestJsonAdapter();
    adapter.setRaw('vectors.json', JSON.stringify([createEntry('large.md', 0, [1, 0], 'large')]));
    const store = createStore();

    await expect(
      importLegacyJsonVectorStore(adapter.asDataAdapter(), store, 'vectors.json', {
        maxBytes: 4,
      }),
    ).resolves.toEqual({
      imported: 0,
      skipped: true,
    });
    expect(adapter.readCount).toBe(0);
    expect(await store.getEntries()).toEqual([]);
  });
});

function createDbName(): string {
  return `SuperpowerInsideVectorStoreTest-${crypto.randomUUID()}`;
}

function createStore(
  dbName = createDbName(),
  options?: ConstructorParameters<typeof IndexedDbVectorStore>[1],
): IndexedDbVectorStore {
  dbNames.add(dbName);
  return new IndexedDbVectorStore(dbName, options);
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

function createEntryWithoutEmbeddingModel(
  filePath: string,
  startLine: number,
  vector: number[],
  text: string,
): VectorEntry {
  const entry = createEntry(filePath, startLine, vector, text);
  delete entry.metadata.embeddingModel;
  return entry;
}

async function seedLegacyVectorDb(dbName: string, entry: VectorEntry): Promise<void> {
  const db = new Dexie(dbName);
  db.version(1).stores({
    vectors: 'id, filePath, updated',
  });
  await db.table('vectors').put({
    id: entry.id,
    vector: [...entry.vector],
    metadata: { ...entry.metadata },
    filePath: entry.metadata.filePath,
    updated: 1000,
  });
  db.close();
}

async function readRawVectorRecord(
  dbName: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const db = new Dexie(dbName);
  db.version(3).stores({
    vectors:
      'id, filePath, embeddingProvider, embeddingModel, dimension, [embeddingProvider+embeddingModel+dimension], updated',
    fileIndex: 'filePath, updated',
    meta: 'key',
  });
  const raw = (await db.table('vectors').get(id)) as Record<string, unknown> | undefined;
  db.close();
  return raw;
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
  expect(
    (await store.getEntriesByIds(['note.md::10', 'missing::0', 'note.md::0'])).map(
      (entry) => entry.id,
    ),
  ).toEqual(['note.md::10', 'note.md::0']);
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
      stat: (path: string) => {
        const data = this.files.get(path);
        if (data === undefined) return Promise.resolve(null);
        return Promise.resolve({
          type: 'file',
          ctime: 1000,
          mtime: 1000,
          size: data.length,
        });
      },
      read: (path: string) => {
        this.readCount += 1;
        return Promise.resolve(this.files.get(path) ?? '');
      },
      write: (path: string, data: string) => {
        this.writeCount += 1;
        this.files.set(path, data);
        return Promise.resolve();
      },
      rename: (path: string, newPath: string) => {
        const data = this.files.get(path);
        if (data !== undefined) {
          this.files.set(newPath, data);
          this.files.delete(path);
        }
        return Promise.resolve();
      },
      remove: (path: string) => {
        this.files.delete(path);
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
});
