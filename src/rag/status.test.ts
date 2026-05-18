import type { TFile, Vault } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { ChatConfig, RAGConfig } from '../settings';
import { MemoryVectorStore, type VectorEntry } from './store';
import { calculateRagStatus } from './status';
import { createContentHash } from './hash';

const baseRagConfig: RAGConfig = {
  excludePaths: ['excluded'],
  excludeExts: ['canvas'],
  excludeChatFolder: false,
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

const chatConfig: ChatConfig = {
  saveFolder: 'SuperpowerInsideChats',
  defaultModel: 'ollama:llama3.1',
  promptLibrary: [],
  mcpToolExecutionPolicy: 'mentioned-auto',
  autoSaveEnabled: true,
  autoSaveDebounceMs: 3000,
  enforceMcpTools: true,
};

describe('calculateRagStatus', () => {
  it('신규 문서를 missing으로 분류한다', async () => {
    const vault = createVault([createFile('note.md', 1000, 10)]);
    const store = new MemoryVectorStore();

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

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

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

    expect(status.staleDocuments).toBe(1);
    expect(status.updateRequiredDocuments[0]).toEqual(
      expect.objectContaining({ path: 'note.md', status: 'stale' }),
    );
  });

  it('mtime과 size가 같아도 내용 해시가 달라진 문서를 stale로 분류한다', async () => {
    const vault = createVault([createFile('note.md', 1000, 'note.md content'.length)]);
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('note.md', {
        sourceMtime: 1000,
        sourceSize: 'note.md content'.length,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      }),
    ]);
    const entries = await store.getEntries();
    entries[0].metadata.contentHash = 'old-hash';
    await store.clear();
    await store.add(entries);

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

    expect(status.staleDocuments).toBe(1);
    expect(status.updateRequiredDocuments[0]).toEqual(
      expect.objectContaining({ path: 'note.md', status: 'stale' }),
    );
  });

  it('메타데이터가 없는 기존 벡터를 unknown으로 분류한다', async () => {
    const vault = createVault([createFile('legacy.md', 1000, 10)]);
    const store = new MemoryVectorStore();
    await store.add([createLegacyEntry('legacy.md')]);

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

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

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

    expect(status.totalDocuments).toBe(1);
    expect(status.excludedDocuments).toBe(2);
    expect(status.updateRequiredDocuments.map((document) => document.path)).toEqual([
      'included.md',
    ]);
  });

  it('마크다운 외 텍스트 파일도 상태 계산 대상에 포함한다', async () => {
    const vault = createVault([
      createFile('included.md', 1000, 10),
      createFile('src/main.ts', 1000, 10),
      createFile('notes.txt', 1000, 10),
    ]);
    const store = new MemoryVectorStore();

    const status = await calculateRagStatus(vault, store, baseRagConfig, chatConfig);

    expect(status.totalDocuments).toBe(3);
    expect(status.missingDocuments).toBe(3);
    expect(status.updateRequiredDocuments.map((document) => document.path)).toEqual([
      'included.md',
      'notes.txt',
      'src/main.ts',
    ]);
  });

  it('채팅 저장 폴더 제외 옵션이 켜져 있으면 저장 폴더명을 기준으로 제외한다', async () => {
    const vault = createVault([
      createFile('included.md', 1000, 10),
      createFile('CustomChats/session.md', 1000, 10),
    ]);
    const store = new MemoryVectorStore();
    const ragConfig: RAGConfig = {
      ...baseRagConfig,
      excludePaths: [],
      excludeChatFolder: true,
    };
    const customChatConfig: ChatConfig = {
      ...chatConfig,
      saveFolder: 'CustomChats',
    };

    const status = await calculateRagStatus(vault, store, ragConfig, customChatConfig);

    expect(status.totalDocuments).toBe(1);
    expect(status.excludedDocuments).toBe(1);
    expect(status.updateRequiredDocuments.map((document) => document.path)).toEqual([
      'included.md',
    ]);
  });
});

function createFile(path: string, mtime: number, size: number): TFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    basename:
      path
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? path,
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
    getFiles: () => files,
    cachedRead: (file: TFile) => Promise.resolve(`${file.path} content`),
  } as unknown as Vault;
}

function createEntry(
  path: string,
  metadata: Pick<
    VectorEntry['metadata'],
    'sourceMtime' | 'sourceSize' | 'embeddingProvider' | 'embeddingModel'
  >,
): VectorEntry {
  const text = `${path} content`;
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      endLine: 0,
      text,
      contentHash: createContentHash(text),
      indexedAt: 1000,
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
