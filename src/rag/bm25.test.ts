import type { DataAdapter } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { JsonFileBM25Index, tokenize } from './bm25';

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

describe('JsonFileBM25Index', () => {
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
    const bm25 = new JsonFileBM25Index(adapter);

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

  it('legacy BM25 JSON을 읽은 뒤 저장할 때 compact v3 포맷으로 자동 마이그레이션한다', async () => {
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
    const bm25 = new JsonFileBM25Index(inspectable.adapter);

    await bm25.load();
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);

    bm25.addDocument('new.md::0', 'GraphRAG open router evidence', 'new.md');
    await bm25.persist();

    const persisted = JSON.parse(
      inspectable.readRaw('.superpower-inside/bm25-index.json') ?? '{}',
    ) as unknown;
    expect(isRecord(persisted)).toBe(true);
    if (!isRecord(persisted)) {
      throw new Error('persisted BM25 payload must be a JSON object');
    }
    expect(persisted).toMatchObject({
      schemaVersion: 3,
      tokenizerVersion: 2,
    });
    expect(isCompactBm25Payload(persisted)).toBe(true);
    expect(Object.hasOwn(persisted, 'inverted')).toBe(false);
  });
});

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<JsonFileBM25Index> {
  const bm25 = new JsonFileBM25Index(createAdapter());
  await bm25.load();
  for (const [id, text] of documents) {
    bm25.addDocument(id, text);
  }
  return bm25;
}

function createAdapter(rawJson?: string): DataAdapter {
  return createInspectableAdapter(rawJson).adapter;
}

interface InspectableAdapter {
  adapter: DataAdapter;
  readRaw(path: string): string | undefined;
}

function createInspectableAdapter(rawJson?: string): InspectableAdapter {
  const files = new Map<string, string>();
  if (rawJson !== undefined) {
    files.set('.superpower-inside/bm25-index.json', rawJson);
  }
  const adapter = {
    exists: (path: string) => Promise.resolve(files.has(path)),
    read: (path: string) => Promise.resolve(files.get(path) ?? ''),
    write: (path: string, data: string) => {
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
  };
}

function isCompactBm25Payload(value: unknown): value is {
  docs: unknown[];
  terms: unknown[];
} {
  if (!isRecord(value)) return false;
  const docs = value.docs;
  const terms = value.terms;
  if (!Array.isArray(docs) || !Array.isArray(terms)) return false;
  return docs.every((doc) => {
    if (!isRecord(doc)) return false;
    return (
      typeof doc.id === 'string' &&
      typeof doc.length === 'number' &&
      typeof doc.sourcePath === 'string'
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
