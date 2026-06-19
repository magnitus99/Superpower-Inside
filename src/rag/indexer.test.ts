import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkMarkdown,
  chunkPlainText,
  buildSearchText,
  registerModifyEvent,
  VaultIndexer,
} from './indexer';
import type { DataAdapter, TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import type { EmbeddingProvider } from '../llm/embedding';
import { MemoryVectorStore, type VectorEntry } from './store';
import { IndexedDbBM25Index } from './bm25';
import { planIndexPendingFilesRust } from './rust-core';
import { createContentHash } from './hash';

const bm25DbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...bm25DbNames].map((name) => Dexie.delete(name)));
  bm25DbNames.clear();
});

vi.mock('./rust-core', async () => {
  const actual = await vi.importActual<typeof import('./rust-core')>('./rust-core');
  return {
    ...actual,
    planIndexPendingFilesRust: vi.fn(actual.planIndexPendingFilesRust),
  };
});

describe('chunkMarkdown + buildSearchText Ollama context length scenario', () => {
  it('chunkSize 1000으로 큰 파일을 청킹하면 buildSearchText 결과가 Ollama 안전 문자수(3000자)를 초과할 수 있다', () => {
    // 여러 줄로 구성된 큰 콘텐츠 (줄바꿈이 있어야 chunkMarkdown이 분할한다)
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push('word '.repeat(15).trim());
    }
    const content = lines.join('\n');
    const chunks = chunkMarkdown(content, 1000);

    const mockFile = {
      path: 'test.md',
      basename: 'test',
      stat: { mtime: 0, size: 0 },
    } as unknown as TFile;

    const searchTexts = chunks.map((chunk) => buildSearchText(mockFile, chunk));
    const maxLen = Math.max(...searchTexts.map((s) => s.length));

    // buildSearchText는 File/Title/Heading 메타데이터를 추가하므로
    // chunkSize 1000이어도 실제 임베딩 입력은 1000자를 초과할 수 있음
    expect(maxLen).toBeGreaterThan(1000);

    // 일부 로컬 임베딩 모델의 컨텍스트 상한은 약 2048 tokens.
    // 한국어 혼합 텍스트 기준 안전 문자수는 약 3000자이므로,
    // chunkSize 1000 + 메타데이터 오버헤드 조합이 이 상한을 초과할 가능성을 문서화한다.
    // (이 테스트는 chunkSize를 낮춰야 하는 근거를 제공한다.)
  });

  it('chunkSize를 500으로 낮추면 buildSearchText 결과가 3000자 이하로 제한된다', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push('word '.repeat(15).trim());
    }
    const content = lines.join('\n');
    const chunks = chunkMarkdown(content, 500);

    const mockFile = {
      path: 'test.md',
      basename: 'test',
      stat: { mtime: 0, size: 0 },
    } as unknown as TFile;

    const searchTexts = chunks.map((chunk) => buildSearchText(mockFile, chunk));
    const maxLen = Math.max(...searchTexts.map((s) => s.length));

    // chunkSize 500 + 메타데이터 오버헤드(최대 ~200자)면 3000자 상한 내에 안전하다
    expect(maxLen).toBeLessThanOrEqual(3000);
  });

  it('긴 단일 txt 줄도 chunkSize 이하로 하드 분할한다', () => {
    const chunks = chunkPlainText('x'.repeat(5000), 100);

    expect(chunks.length).toBe(50);
    expect(chunks.every((chunk) => chunk.text.length <= 100)).toBe(true);
    expect(chunks.every((chunk) => chunk.metadata.startLine === 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.metadata.endLine === 0)).toBe(true);
  });

  it('긴 코드블록과 긴 문단도 최종 Markdown 청크 길이를 chunkSize 이하로 제한한다', () => {
    const content = [
      '# Heading',
      '```',
      'const value = "' + 'x'.repeat(500) + '";',
      '```',
      '',
      'y'.repeat(450),
    ].join('\n');

    const chunks = chunkMarkdown(content, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 100)).toBe(true);
  });

  it('overlap이 chunkSize와 같아도 최종 청크 길이를 키우지 않는다', () => {
    const content = Array.from({ length: 12 }, (_, index) => `line-${index}-${'x'.repeat(20)}`).join(
      '\n',
    );

    const chunks = chunkPlainText(content, 100, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 100)).toBe(true);
  });
});

describe('VaultIndexer 배치 인덱싱', () => {
  it('임베딩 요청을 maxEmbeddingBatchSize 단위로 나눈다', async () => {
    const file = createFile('note.md', 1000, 1500);
    const vault = createVault(new Map([[file.path, Array.from({ length: 12 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')]]));
    const store = new MemoryVectorStore();
    const batches: number[] = [];
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        batches.push(texts.length);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(vault, store, embeddingProvider, createRagConfig(), createChatConfig());

    const result = await indexer.indexFile(file, { maxEmbeddingBatchSize: 2 });

    expect(batches.every((size) => size <= 2)).toBe(true);
    expect(result.indexed).toBe(1);
    expect(result.vectors).toBeGreaterThan(1);
  });

  it('배치 사이에 AbortSignal 취소를 반영한다', async () => {
    const file = createFile('note.md', 1000, 1500);
    const vault = createVault(new Map([[file.path, Array.from({ length: 12 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')]]));
    const store = new MemoryVectorStore();
    const controller = new AbortController();
    let callCount = 0;
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        callCount++;
        if (callCount === 1) {
          controller.abort();
        }
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(vault, store, embeddingProvider, createRagConfig(), createChatConfig());

    await expect(
      indexer.indexFile(file, { signal: controller.signal, maxEmbeddingBatchSize: 1 }),
    ).rejects.toThrow();
    expect(await store.getEntries()).toEqual([]);
  });

  it('임베딩 batch 결과 개수가 입력 개수와 다르면 벡터를 저장하지 않는다', async () => {
    const file = createFile('note.md', 1000, 120);
    const vault = createVault(new Map([[file.path, ['first chunk', '', 'second chunk'].join('\n')]]));
    const store = new MemoryVectorStore();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => Promise.resolve([[1, 0]]),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      { ...createRagConfig(), chunkSize: 20 },
      createChatConfig(),
    );

    await expect(indexer.indexFile(file, { maxEmbeddingBatchSize: 10 })).rejects.toThrow(
      /Embedding batch result count mismatch/,
    );
    expect(await store.getEntries()).toEqual([]);
  });

  it('임베딩 vector가 유한한 숫자 배열이 아니면 벡터를 저장하지 않는다', async () => {
    const file = createFile('note.md', 1000, 80);
    const vault = createVault(new Map([[file.path, '문서 내용']]));
    const store = new MemoryVectorStore();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => Promise.resolve([[Number.NaN, 0]]),
    };
    const indexer = new VaultIndexer(vault, store, embeddingProvider, createRagConfig(), createChatConfig());

    await expect(indexer.indexFile(file)).rejects.toThrow(/Invalid embedding vector/);
    expect(await store.getEntries()).toEqual([]);
  });

  it('빈 파일은 기존 벡터를 제거한다', async () => {
    const file = createFile('empty.md', 1000, 0);
    const vault = createVault(new Map([[file.path, '']]));
    const store = new MemoryVectorStore();
    await store.add([createEntry('empty.md')]);
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => Promise.resolve([[1, 0]]),
    };
    const indexer = new VaultIndexer(vault, store, embeddingProvider, createRagConfig(), createChatConfig());

    const result = await indexer.indexFile(file);

    expect(result).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
    expect(await store.getEntries()).toEqual([]);
  });

  it('modify 이벤트에서 파일이 비워지면 기존 벡터를 제거한다', async () => {
    const file = createFile('empty.md', 1000, 0);
    const vault = createEventVault(new Map([[file.path, '']]));
    const indexedPaths: string[] = [];
    const removedPaths: string[] = [];

    registerModifyEvent(
      vault,
      {
        indexFile: (target) => {
          indexedPaths.push(target.path);
          return Promise.resolve();
        },
        removeByFilePath: (path) => {
          removedPaths.push(path);
          return Promise.resolve(1);
        },
      },
      [],
      [],
    );

    await vault.emitModify(file);

    expect(indexedPaths).toEqual([]);
    expect(removedPaths).toEqual(['empty.md']);
  });

  it('BM25 인덱스는 청크 ID로 갱신하고 파일 삭제 시 함께 제거한다', async () => {
    const file = createFile('note.md', 1000, 120);
    const vault = createVault(new Map([[file.path, ['specialterm 첫 청크', '', '다른 내용'].join('\n')]]));
    const store = new MemoryVectorStore();
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const ragConfig = { ...createRagConfig(), chunkSize: 40, enableBM25: true };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      ragConfig,
      createChatConfig(),
      bm25,
    );

    await indexer.indexFile(file);

    const indexedIds = [...bm25.search('specialterm').keys()];
    expect(indexedIds.length).toBeGreaterThan(0);
    expect(indexedIds.every((id) => id.startsWith('note.md::'))).toBe(true);
    expect(indexedIds).not.toContain('note.md');

    await indexer.removeFile('note.md');

    expect([...bm25.search('specialterm').keys()]).toEqual([]);
  });

  it('contentHash와 임베딩 설정이 같으면 파일 재임베딩과 BM25 재작성을 건너뛴다', async () => {
    const content = '변경 없는 문서 내용';
    const file = createFile('note.md', 1000, content.length);
    const vault = createVault(new Map([[file.path, content]]));
    const store = new MemoryVectorStore();
    await store.add([
      {
        id: 'note.md::0::0',
        vector: [1, 0],
        metadata: {
          filePath: file.path,
          startLine: 0,
          endLine: 0,
          text: 'old indexed text',
          sourceMtime: file.stat.mtime,
          sourceSize: file.stat.size,
          contentHash: createContentHash(content),
          indexedAt: 1,
          embeddingProvider: 'openai',
          embeddingModel: 'text-embedding-3-small',
        },
      },
    ]);
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    const removeSourceSpy = vi.spyOn(bm25, 'removeDocumentsBySource');
    const addDocumentSpy = vi.spyOn(bm25, 'addDocument');
    const persistSpy = vi.spyOn(bm25, 'persist');
    let embedBatchCalls = 0;
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        embedBatchCalls += 1;
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      { ...createRagConfig(), enableBM25: true },
      createChatConfig(),
      bm25,
    );

    const result = await indexer.indexFile(file);

    expect(result).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
    expect(result.documents).toEqual(['note.md']);
    expect(embedBatchCalls).toBe(0);
    expect(removeSourceSpy).not.toHaveBeenCalled();
    expect(addDocumentSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('전체 재인덱싱 전에 BM25에 남은 stale 문서를 제거한다', async () => {
    const file = createFile('current.md', 1000, 80);
    const vault = createVault(new Map([[file.path, '현재 문서 내용']]));
    const store = new MemoryVectorStore();
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    bm25.addDocument('deleted.md::0', 'staleterm 오래된 문서', 'deleted.md');
    await bm25.persist();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      { ...createRagConfig(), enableBM25: true },
      createChatConfig(),
      bm25,
    );

    await indexer.reindexAll();

    expect([...bm25.search('staleterm').keys()]).toEqual([]);
  });

  it('전체 재인덱싱 중 BM25는 vault JSON 파일에 저장하지 않는다', async () => {
    const contents = new Map([
      ['a.md', 'alpha 문서 내용'],
      ['b.md', 'beta 문서 내용'],
      ['c.md', 'gamma 문서 내용'],
    ]);
    const vault = createVault(contents);
    const store = new MemoryVectorStore();
    const adapter = new CountingAdapter();
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), adapter.asDataAdapter());
    await bm25.load();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      { ...createRagConfig(), enableBM25: true },
      createChatConfig(),
      bm25,
    );

    await indexer.reindexAll();

    expect(adapter.writeCount).toBe(0);
    expect([...bm25.search('alpha').keys()].length).toBeGreaterThan(0);
    expect([...bm25.search('beta').keys()].length).toBeGreaterThan(0);
    expect([...bm25.search('gamma').keys()].length).toBeGreaterThan(0);
  });

  it('Rust pending plan의 잘못된 인덱스가 있어도 인덱싱이 중단되지 않는다', async () => {
    const fileA = createFile('a.md', 1000, 120);
    const fileB = createFile('b.md', 1000, 120);
    const vault = createVault(
      new Map([
        [fileA.path, 'alpha 문서'],
        [fileB.path, 'bravo 문서'],
      ]),
    );
    const store = new MemoryVectorStore();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    vi.mocked(planIndexPendingFilesRust).mockReturnValueOnce({
      fileIndices: [0, 999],
      skipped: 1,
    });

    const result = await indexer.indexPending({ maxEmbeddingBatchSize: 5 });

    expect(result.indexed).toBe(1);
    expect(result.vectors).toBeGreaterThan(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.documents).toEqual(['a.md']);
  });

  it('Rust pending plan의 중복/음수 인덱스는 중복 없이 안정적으로 처리된다', async () => {
    const fileA = createFile('a.md', 1000, 120);
    const fileB = createFile('b.md', 1000, 120);
    const fileC = createFile('c.md', 1000, 120);
    const vault = createVault(
      new Map([
        [fileA.path, 'alpha 문서'],
        [fileB.path, 'bravo 문서'],
        [fileC.path, 'charlie 문서'],
      ]),
    );
    const store = new MemoryVectorStore();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    vi.mocked(planIndexPendingFilesRust).mockReturnValueOnce({
      fileIndices: [0, 0, 1, -1, 5],
      skipped: 3,
    });

    const result = await indexer.indexPending({ maxEmbeddingBatchSize: 5 });

    expect(result.indexed).toBe(2);
    expect(result.vectors).toBeGreaterThan(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.documents).toEqual(['a.md', 'b.md']);
  });
});

function createRagConfig(): RAGConfig {
  return {
    excludePaths: [],
    excludeExts: [],
    excludeChatFolder: false,
    chunkSize: 100,
    overlap: 0,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autoUpdateEnabled: false,
    autoUpdateIntervalMin: 5,
    minScore: 0.5,
    annEnabled: true,
    annClusterCount: 0,
    annProbeCount: 4,
    structuralGraphEnabled: true,
    ontologyEnabled: true,
    ontologyAutoMergeThreshold: 0.88,
    ontologyPendingMergeThreshold: 0.72,
    graphRagEnabled: false,
    graphRagModel: '',
    graphRagMaxFilesPerRun: 50,
    graphRagQueryMode: 'auto',
    enableBM25: false,
    bm25Weight: 0.3,
    performanceTuningMode: 'auto',
    performanceGuardEnabled: true,
    maxEmbeddingBatchSize: 32,
    indexingYieldMs: 25,
    slowEventLoopThresholdMs: 150,
    slowBatchThresholdMs: 3000,
    graphRagAutoSyncEnabled: false,
    graphRagAutoSyncIntervalMin: 30,
  };
}

function createChatConfig(): ChatConfig {
  return {
    saveFolder: 'Chats',
    defaultModel: 'openai:gpt-4o-mini',
    promptLibrary: [],
    mcpToolExecutionPolicy: 'mentioned-auto',
    autoSaveEnabled: true,
    autoSaveDebounceMs: 3000,
    enforceMcpTools: true,
  };
}

function createVault(contents: Map<string, string>): Vault {
  const files = [...contents.keys()].map((path) => createFile(path, 1000, contents.get(path)?.length ?? 0));
  return {
    getFiles: () => files,
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? ''),
  } as unknown as Vault;
}

function createEventVault(contents: Map<string, string>): Vault & {
  emitModify(file: TFile): Promise<void>;
} {
  const baseVault = createVault(contents);
  let modifyHandler: ((file: TFile) => Promise<void>) | null = null;
  return {
    ...baseVault,
    on: (name: string, callback: (file: TFile) => Promise<void>) => {
      if (name === 'modify') {
        modifyHandler = callback;
      }
      return { name };
    },
    offref: () => undefined,
    emitModify: async (file: TFile) => {
      if (modifyHandler) {
        await modifyHandler(file);
      }
    },
  } as unknown as Vault & { emitModify(file: TFile): Promise<void> };
}

function createAdapter(): DataAdapter {
  const files = new Map<string, string>();
  return {
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
}

function createBm25DbName(): string {
  const dbName = `SuperpowerInsideIndexerBM25Test-${crypto.randomUUID()}`;
  bm25DbNames.add(dbName);
  return dbName;
}

class CountingAdapter {
  private files = new Map<string, string>();
  writeCount = 0;

  asDataAdapter(): DataAdapter {
    return {
      exists: (path: string) => Promise.resolve(this.files.has(path)),
      read: (path: string) => Promise.resolve(this.files.get(path) ?? ''),
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

function createFile(path: string, mtime: number, size: number): TFile {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.includes('.') ? (name.split('.').pop() ?? '') : '',
    stat: { ctime: mtime, mtime, size },
  } as unknown as TFile;
}

function createEntry(path: string): VectorEntry {
  return {
    id: `${path}::0`,
    vector: [1, 0],
    metadata: {
      filePath: path,
      startLine: 0,
      endLine: 0,
      text: 'old',
      sourceMtime: 1,
      sourceSize: 3,
      contentHash: 'hash',
      indexedAt: 1,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}
