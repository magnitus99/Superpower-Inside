import type { TFile, Vault } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  registerDeleteEvent,
  registerModifyEvent,
  registerRenameEvent,
  VaultIndexer,
} from './indexer';
import { MemoryVectorStore, type VectorEntry, type VectorStore } from './store';

const ragConfig: RAGConfig = {
  excludePaths: [],
  excludeExts: [],
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
    const indexer = new VaultIndexer(vault, store, createEmbeddingProvider(), ragConfig, chatConfig);

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
    const indexer = new VaultIndexer(vault, store, createEmbeddingProvider(), ragConfig, chatConfig);

    const result = await indexer.indexPending();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.documents).toEqual([]);
  });
});

describe('RAG 자동 업데이트 이벤트 제외 정책', () => {
  it('modify 이벤트는 excludeExts에 포함된 Markdown 파일을 인덱싱하지 않는다', async () => {
    const file = createFile('note.md', 1000, 10);
    const vault = createEventVault();
    const indexFile = vi.fn(() => Promise.resolve());
    const indexer = { indexFile } as unknown as VaultIndexer;
    registerModifyEvent(vault, indexer, [], ['md']);

    await vault.emitVault('modify', file);

    expect(indexFile).not.toHaveBeenCalled();
  });

  it('delete 이벤트도 excludeExts 정책을 따른다', async () => {
    const file = createFile('note.md', 1000, 10);
    const vault = createEventVault();
    const removeByFilePath = vi.fn(() => Promise.resolve(1));
    const store = {
      removeByFilePath,
    } as unknown as VectorStore;
    registerDeleteEvent(vault, store, [], ['md']);

    await vault.emitVault('delete', file);

    expect(removeByFilePath).not.toHaveBeenCalled();
  });

  it('rename에서 포함 경로가 제외 경로로 이동하면 기존 벡터만 제거한다', async () => {
    const file = createFile('Archive/note.md', 1000, 10);
    const vault = createEventVault();
    const indexFile = vi.fn(() => Promise.resolve());
    const indexer = { indexFile } as unknown as VaultIndexer;
    const removeByFilePath = vi.fn(() => Promise.resolve(1));
    const store = {
      removeByFilePath,
    } as unknown as VectorStore;
    const onComplete = vi.fn();
    registerRenameEvent(vault, indexer, store, ['Archive'], [], onComplete);

    await vault.emitVault('rename', file, 'note.md');

    expect(removeByFilePath).toHaveBeenCalledWith('note.md');
    expect(indexFile).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith('note.md', 'Archive/note.md');
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

type VaultEvent = 'modify' | 'delete' | 'rename';
type EventHandler = (...args: unknown[]) => Promise<void> | void;

interface EventVault extends Vault {
  emitVault(event: VaultEvent, ...args: unknown[]): Promise<void>;
}

function createEventVault(): EventVault {
  const handlers = new Map<VaultEvent, EventHandler[]>();
  const vault = {
    on: (event: VaultEvent, callback: EventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), callback]);
      return { event, callback };
    },
    offref: () => undefined,
    emitVault: async (event: VaultEvent, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler(...args);
      }
    },
  };
  return vault as unknown as EventVault;
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
