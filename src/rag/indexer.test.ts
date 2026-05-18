import type { TFile, Vault } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  chunkMarkdown,
  IndexingCancelledError,
  registerDeleteEvent,
  registerModifyEvent,
  registerRenameEvent,
  VaultIndexer,
} from './indexer';
import { createContentHash } from './hash';
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
  it('청크 overlap은 다음 청크 앞에 이전 줄 일부를 포함한다', () => {
    const chunks = chunkMarkdown('첫 줄\n\n두 번째 줄\n\n세 번째 줄', 8, 6);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text).toContain('두 번째 줄');
  });

  it('인덱싱 메타데이터에 endLine, contentHash, indexedAt과 검색 힌트를 저장한다', async () => {
    const file = createFile('Notes/Topic.md', 1000, 'content'.length);
    const vault = createVault([file], new Map([['Notes/Topic.md', '# Heading\ncontent']]));
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      vault,
      store,
      createEmbeddingProvider(),
      ragConfig,
      chatConfig,
    );

    await indexer.indexFile(file);

    const entries = await store.getEntries();
    expect(entries[0].metadata).toEqual(
      expect.objectContaining({
        filePath: 'Notes/Topic.md',
        heading: 'Heading',
        startLine: 0,
        endLine: 1,
        contentHash: createContentHash('# Heading\ncontent'),
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      }),
    );
    expect(entries[0].metadata.indexedAt).toEqual(expect.any(Number));
    expect(entries[0].metadata.text).toContain('File: Notes/Topic.md');
    expect(entries[0].metadata.text).toContain('Heading: Heading');
  });

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
    await store.add([createEntry('fresh.md', 1000, 10), createEntry('stale.md', 1000, 20)]);
    const indexer = new VaultIndexer(
      vault,
      store,
      createEmbeddingProvider(),
      ragConfig,
      chatConfig,
    );

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
    const indexer = new VaultIndexer(
      vault,
      store,
      createEmbeddingProvider(),
      ragConfig,
      chatConfig,
    );

    const result = await indexer.indexPending();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.documents).toEqual([]);
  });

  it('마크다운 외 텍스트 파일도 인덱싱한다', async () => {
    const source = createFile('src/main.ts', 1000, 10);
    const note = createFile('notes.txt', 1000, 10);
    const vault = createVault(
      [source, note],
      new Map([
        ['src/main.ts', 'const value = 1;'],
        ['notes.txt', 'plain text'],
      ]),
    );
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      vault,
      store,
      createEmbeddingProvider(),
      ragConfig,
      chatConfig,
    );

    const count = await indexer.indexVault();

    expect(count).toBe(2);
    expect(await store.getIndexedFilePaths()).toEqual(['src/main.ts', 'notes.txt']);
  });

  it('이미 취소된 signal이면 대기 문서를 인덱싱하지 않는다', async () => {
    const file = createFile('missing.md', 1000, 10);
    const vault = createVault([file], new Map([['missing.md', 'content']]));
    const store = new MemoryVectorStore();
    const provider = createEmbeddingProvider();
    const indexer = new VaultIndexer(vault, store, provider, ragConfig, chatConfig);
    const controller = new AbortController();
    controller.abort();

    await expect(indexer.indexPending({ signal: controller.signal })).rejects.toBeInstanceOf(
      IndexingCancelledError,
    );
    expect(await store.getIndexedFilePaths()).toEqual([]);
  });

  it('임베딩 호출 중 취소되면 전용 취소 오류로 전파한다', async () => {
    const file = createFile('missing.md', 1000, 10);
    const vault = createVault([file], new Map([['missing.md', 'content']]));
    const store = new MemoryVectorStore();
    const controller = new AbortController();
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => {
        controller.abort();
        return Promise.resolve([[1, 0]]);
      },
    };
    const indexer = new VaultIndexer(vault, store, provider, ragConfig, chatConfig);

    await expect(indexer.indexPending({ signal: controller.signal })).rejects.toBeInstanceOf(
      IndexingCancelledError,
    );
    expect(await store.getIndexedFilePaths()).toEqual([]);
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

  it('modify 이벤트는 Markdown 외 텍스트 파일을 인덱싱한다', async () => {
    const file = createFile('src/main.ts', 1000, 10);
    const vault = createEventVault();
    const indexFile = vi.fn(() => Promise.resolve());
    const indexer = { indexFile } as unknown as VaultIndexer;
    registerModifyEvent(vault, indexer, [], []);

    await vault.emitVault('modify', file);

    expect(indexFile).toHaveBeenCalledWith(file);
  });

  it('modify 이벤트는 제외 확장자에 포함된 비Markdown 파일을 인덱싱하지 않는다', async () => {
    const file = createFile('src/main.ts', 1000, 10);
    const vault = createEventVault();
    const indexFile = vi.fn(() => Promise.resolve());
    const indexer = { indexFile } as unknown as VaultIndexer;
    registerModifyEvent(vault, indexer, [], ['ts']);

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

function createVault(files: TFile[], contents: Map<string, string>): Vault {
  return {
    getMarkdownFiles: () => files,
    getFiles: () => files,
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
    cachedRead: (file: TFile) => Promise.resolve(`${file.path} content`),
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
  const text = `${path.replace(/\.md$/, '')} content`;
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      endLine: 0,
      text,
      sourceMtime,
      sourceSize,
      contentHash: createContentHash(text),
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}
