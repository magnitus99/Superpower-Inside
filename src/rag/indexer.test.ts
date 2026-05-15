import type { TFile, Vault } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import type { RAGConfig } from '../settings';
import { VaultIndexer } from './indexer';
import { MemoryVectorStore, type VectorEntry } from './store';

const ragConfig: RAGConfig = {
  excludePaths: [],
  excludeExts: [],
  chunkSize: 1000,
  overlap: 100,
  vectorStoreType: 'json',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
  minScore: 0.5,
  enableBM25: false,
  bm25Weight: 0.3,
};

describe('VaultIndexer.indexPending', () => {
  it('missing 문서와 stale 문서만 인덱싱한다', async () => {
    const fresh = createFile('fresh.md', 1000, 10);
    const stale = createFile('stale.md', 2000, 20);
    const missing = createFile('missing.md', 3000, 30);
    const vault = createVault(
      [fresh, stale, missing],
      new Map([
        ['fresh.md', 'fresh content'],
        ['stale.md', 'stale content'],
        ['missing.md', 'missing content'],
      ]),
    );
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('fresh.md', 1000, 10),
      createEntry('stale.md', 1000, 20),
    ]);
    const indexer = new VaultIndexer(vault, store, createEmbeddingProvider(), ragConfig);

    const result = await indexer.indexPending();

    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.documents).toEqual(['stale.md', 'missing.md']);
  });

  it('업데이트할 문서가 없으면 모두 skipped로 처리한다', async () => {
    const file = createFile('fresh.md', 1000, 10);
    const vault = createVault([file], new Map([['fresh.md', 'fresh content']]));
    const store = new MemoryVectorStore();
    await store.add([createEntry('fresh.md', 1000, 10)]);
    const indexer = new VaultIndexer(vault, store, createEmbeddingProvider(), ragConfig);

    const result = await indexer.indexPending();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.documents).toEqual([]);
  });
});

function createFile(path: string, mtime: number, size: number): TFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path,
    extension: path.split('.').pop() ?? '',
    stat: {
      ctime: mtime,
      mtime,
      size,
    },
  } as unknown as TFile;
}

function createVault(files: TFile[], contents: Map<string, string>): Vault {
  return {
    getMarkdownFiles: () => files,
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? ''),
  } as unknown as Vault;
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: () => Promise.resolve([1, 0]),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => [1, 0])),
  };
}

function createEntry(path: string, sourceMtime: number, sourceSize: number): VectorEntry {
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      text: 'content',
      sourceMtime,
      sourceSize,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}
