import type { DataAdapter } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import { JsonFileBM25Index } from './bm25';
import { RAGQueryEngine } from './query';
import { MemoryVectorStore, type VectorEntry } from './store';

describe('RAGQueryEngine', () => {
  it('벡터 상위 후보 밖의 BM25 전용 후보도 최종 후보에 포함한다', async () => {
    const store = new MemoryVectorStore();
    const entries = Array.from({ length: 12 }, (_, index) =>
      createEntry(`semantic-${index}.md`, [1, 0], '일반 문서 내용'),
    );
    entries.push(createEntry('keyword.md', [0.2, 0.98], 'specialterm 정확한 키워드 문서'));
    await store.add(entries);
    const bm25 = await createBm25([
      ['keyword.md', 'specialterm 정확한 키워드 문서'],
      ...entries.slice(0, 12).map((entry) => [entry.metadata.filePath, '일반 문서 내용'] as const),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('keyword.md');
    expect(results[0]?.bm25Score).toBeGreaterThan(0);
  });

  it('파일 단위 BM25 보정만 받은 무관 청크는 통과시키지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('mixed.md', [0.2, 0.98], 'specialterm 관련 청크'),
      createEntry('mixed.md', [0.2, 0.98], '전혀 다른 청크', 20),
    ]);
    const bm25 = await createBm25([['mixed.md', 'specialterm 관련 청크 전혀 다른 청크']]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 5);

    expect(results.map((result) => result.entry.metadata.startLine)).toEqual([0]);
  });

  it('최고점 대비 점수 차이가 큰 낮은 관련도 후보를 제외한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('best.md', [1, 0], '질문과 가까운 문서'),
      createEntry('weak.md', [0.7, 0.714], '약한 관련 문서'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual(['best.md']);
  });
});

function createEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: () => Promise.resolve(vector),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => vector)),
  };
}

function createEntry(path: string, vector: number[], text: string, startLine = 0): VectorEntry {
  return {
    id: `${path}::${startLine}`,
    vector,
    metadata: {
      filePath: path,
      startLine,
      endLine: startLine,
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      contentHash: 'hash',
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<JsonFileBM25Index> {
  const bm25 = new JsonFileBM25Index(createAdapter());
  await bm25.load();
  for (const [path, text] of documents) {
    bm25.addDocument(path, text);
  }
  return bm25;
}

function createAdapter(): DataAdapter {
  return {
    exists: () => Promise.resolve(false),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
}
