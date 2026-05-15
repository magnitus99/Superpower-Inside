import type { TFile, Vault } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { RAGConfig } from '../settings';
import { MemoryVectorStore, type VectorEntry } from './store';
import { calculateRagStatus } from './status';

const baseRagConfig: RAGConfig = {
  excludePaths: ['excluded'],
  excludeExts: ['canvas'],
  chunkSize: 1000,
  overlap: 100,
  vectorStoreType: 'json',
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
};

describe('calculateRagStatus', () => {
  it('신규 문서를 missing으로 분류한다', async () => {
    const vault = createVault([createFile('note.md', 1000, 10)]);
    const store = new MemoryVectorStore();

    const status = await calculateRagStatus(vault, store, baseRagConfig);

    expect(status.missingDocuments).toBe(1);
    expect(status.updateRequiredDocuments).toEqual([
      expect.objectContaining({ path: 'note.md', status: 'missing' }),
    ]);
  });

  it('mtime 또는 size가 달라진 문서를 stale로 분류한다', async () => {
    const vault = createVault([createFile('note.md', 2000, 20)]);
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('note.md', {
        sourceMtime: 1000,
        sourceSize: 20,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      }),
    ]);

    const status = await calculateRagStatus(vault, store, baseRagConfig);

    expect(status.staleDocuments).toBe(1);
    expect(status.updateRequiredDocuments[0]).toEqual(
      expect.objectContaining({ path: 'note.md', status: 'stale' }),
    );
  });

  it('메타데이터가 없는 기존 벡터를 unknown으로 분류한다', async () => {
    const vault = createVault([createFile('legacy.md', 1000, 10)]);
    const store = new MemoryVectorStore();
    await store.add([createLegacyEntry('legacy.md')]);

    const status = await calculateRagStatus(vault, store, baseRagConfig);

    expect(status.unknownDocuments).toBe(1);
    expect(status.updateRequiredDocuments[0]).toEqual(
      expect.objectContaining({ path: 'legacy.md', status: 'unknown' }),
    );
  });

  it('제외 경로와 제외 확장자는 상태 계산 대상에서 제외한다', async () => {
    const vault = createVault([
      createFile('included.md', 1000, 10),
      createFile('excluded/skip.md', 1000, 10),
      createFile('board.canvas', 1000, 10),
    ]);
    const store = new MemoryVectorStore();

    const status = await calculateRagStatus(vault, store, baseRagConfig);

    expect(status.totalDocuments).toBe(1);
    expect(status.excludedDocuments).toBe(2);
    expect(status.updateRequiredDocuments.map((document) => document.path)).toEqual(['included.md']);
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

function createVault(files: TFile[]): Vault {
  return {
    getMarkdownFiles: () => files,
  } as unknown as Vault;
}

function createEntry(
  path: string,
  metadata: Pick<
    VectorEntry['metadata'],
    'sourceMtime' | 'sourceSize' | 'embeddingProvider' | 'embeddingModel'
  >,
): VectorEntry {
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      text: 'content',
      ...metadata,
    },
  };
}

function createLegacyEntry(path: string): VectorEntry {
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      text: 'content',
    },
  };
}
