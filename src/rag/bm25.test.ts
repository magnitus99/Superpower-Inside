import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbBM25Index, tokenize } from './bm25';

const dbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
});

describe('BM25 tokenizer', () => {
  it('영문 camelCase와 구분자 변형을 같은 키워드로 검색할 수 있게 토큰화한다', () => {
    const tokens = tokenize('OpenRouter freeLLMApi open-router');

    expect(tokens).toEqual(
      expect.arrayContaining(['openrouter', 'open', 'router', 'freellmapi', 'free', 'llm', 'api']),
    );
  });

  it('한글과 숫자가 섞인 Obsidian 제목 키워드는 원문과 n-gram을 함께 보존한다', () => {
    const tokens = tokenize('요고49 포인트 페이백');

    expect(tokens).toEqual(
      expect.arrayContaining(['요고49', '요고', '49', '포인트', '포인', '인트', '페이백']),
    );
  });
});

describe('IndexedDbBM25Index', () => {
  it('반복된 질의 토큰으로 같은 문서 점수를 중복 가산하지 않는다', async () => {
    const bm25 = await createBm25([
      ['doc.md::0', 'specialterm 직접 근거'],
      ['other.md::0', '다른 내용'],
    ]);

    expect(bm25.search('specialterm specialterm').get('doc.md::0')).toBe(
      bm25.search('specialterm').get('doc.md::0'),
    );
  });

  it('OpenRouter 문서는 open router처럼 띄어 쓴 질의로도 검색된다', async () => {
    const bm25 = await createBm25([
      ['api.md::0', 'OpenRouter API access key'],
      ['other.md::0', 'Ollama local model'],
    ]);

    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('구버전 BM25 JSON은 토큰화 버전 불일치로 감지하고 재빌드할 수 있다', async () => {
    const adapter = createAdapter(
      JSON.stringify({
        inverted: { openrouter: { 'api.md::0': 1 } },
        docLengths: { 'api.md::0': 1 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 1,
      }),
    );
    const bm25 = new IndexedDbBM25Index(createDbName(), adapter);

    await bm25.load();

    expect(bm25.isTokenizerCurrent).toBe(false);
    expect([...bm25.search('open router').keys()]).toEqual([]);

    await bm25.rebuild([
      {
        id: 'api.md::0',
        text: 'OpenRouter API access key',
        sourcePath: 'api.md',
      },
    ]);

    expect(bm25.isTokenizerCurrent).toBe(true);
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('legacy BM25 JSON을 읽은 뒤 저장할 때 IndexedDB snapshot으로 마이그레이션한다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);

    bm25.addDocument('new.md::0', 'GraphRAG open router evidence', 'new.md');
    await bm25.persist();

    expect(inspectable.writeCount()).toBe(0);
    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();
    expect([...reopened.search('graphrag').keys()]).toEqual(['new.md::0']);
  });

  it('legacy BM25 JSON은 load 직후 IndexedDB snapshot으로 남겨 다음 초기화에서 다시 읽지 않는다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect(inspectable.readCount()).toBe(1);

    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();

    expect(inspectable.readCount()).toBe(1);
    expect([...reopened.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('전체 재빌드 중 긴 문서 루프는 이벤트 루프에 양보하면서 검색 결과를 유지한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    try {
      const documents = Array.from({ length: 129 }, (_, index) => ({
        id: `doc-${index}.md::0`,
        text: index === 128 ? 'needle final document' : `ordinary document ${index}`,
        sourcePath: `doc-${index}.md`,
      }));

      const rebuildPromise = bm25.rebuild(documents);
      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);

      await vi.runAllTimersAsync();
      await rebuildPromise;

      expect(bm25.totalDocs).toBe(documents.length);
      expect([...bm25.search('needle').keys()]).toEqual(['doc-128.md::0']);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('전체 재빌드에서 같은 doc id가 반복되면 마지막 문서로 교체한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();

    await bm25.rebuild([
      { id: 'note.md::0', text: 'obsoletealpha', sourcePath: 'note.md' },
      { id: 'note.md::0', text: 'freshbeta', sourcePath: 'note.md' },
    ]);

    expect([...bm25.search('obsoletealpha').keys()]).toEqual([]);
    expect([...bm25.search('freshbeta').keys()]).toEqual(['note.md::0']);
  });
});

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<IndexedDbBM25Index> {
  const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
  await bm25.load();
  for (const [id, text] of documents) {
    bm25.addDocument(id, text);
  }
  return bm25;
}

function createDbName(): string {
  const dbName = `SuperpowerInsideBM25IndexTest-${crypto.randomUUID()}`;
  dbNames.add(dbName);
  return dbName;
}

function createAdapter(rawJson?: string): DataAdapter {
  return createInspectableAdapter(rawJson).adapter;
}

interface InspectableAdapter {
  adapter: DataAdapter;
  readRaw(path: string): string | undefined;
  readCount(): number;
  writeCount(): number;
}

function createInspectableAdapter(rawJson?: string): InspectableAdapter {
  const files = new Map<string, string>();
  let reads = 0;
  let writes = 0;
  if (rawJson !== undefined) {
    files.set('.superpower-inside/bm25-index.json', rawJson);
  }
  const adapter = {
    exists: (path: string) => Promise.resolve(files.has(path)),
    read: (path: string) => {
      reads += 1;
      return Promise.resolve(files.get(path) ?? '');
    },
    write: (path: string, data: string) => {
      writes += 1;
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (path: string, newPath: string) => {
      const data = files.get(path);
      if (data !== undefined) {
        files.set(newPath, data);
        files.delete(path);
      }
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
  return {
    adapter,
    readRaw: (path: string) => files.get(path),
    readCount: () => reads,
    writeCount: () => writes,
  };
}
