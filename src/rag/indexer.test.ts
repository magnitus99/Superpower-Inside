import { describe, expect, it } from 'vitest';
import { chunkMarkdown, chunkPlainText, buildSearchText, VaultIndexer } from './indexer';
import type { TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import type { EmbeddingProvider } from '../llm/embedding';
import { MemoryVectorStore, type VectorEntry } from './store';

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

    // Ollama nomic-embed-text-v2-moe의 컨텍스트 상한은 약 2048 tokens.
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
});

function createRagConfig(): RAGConfig {
  return {
    excludePaths: [],
    excludeExts: [],
    excludeChatFolder: false,
    chunkSize: 100,
    overlap: 0,
    vectorStoreType: 'indexeddb',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    autoUpdateEnabled: false,
    autoUpdateIntervalMin: 5,
    minScore: 0.5,
    enableBM25: false,
    bm25Weight: 0.3,
    performanceGuardEnabled: true,
    maxEmbeddingBatchSize: 32,
    indexingYieldMs: 25,
    slowEventLoopThresholdMs: 150,
    slowBatchThresholdMs: 3000,
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
