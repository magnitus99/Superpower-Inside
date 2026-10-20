import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkMarkdown,
  chunkPlainText,
  buildSearchText,
  IndexingCancelledError,
  IndexingPerformancePausedError,
  registerModifyEvent,
  VaultIndexer,
} from './indexer';
import type { DataAdapter, TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import type { EmbeddingProvider } from '../llm/embedding';
import { IndexedDbVectorStore, MemoryVectorStore, type VectorEntry } from './store';
import { calculateRagStatus } from './status';
import { IndexedDbBM25Index } from './bm25';
import { planIndexPendingFilesRust } from './rust-core';
import { createContentHash } from './hash';
import { RAGQueryEngine } from './query';
import { getRagCandidateFiles } from '../utils/vault';
import * as sourceAccess from './source-access';
import * as sourceSnapshot from './source-snapshot';

const bm25DbNames = new Set<string>();
const vectorDbNames = new Set<string>();

describe('인덱싱 제외 정책', () => {
  it('기존 메타데이터와 Rust 청크 헤딩을 BM25 필드로 전달한다', async () => {
    const vault = createVault(new Map([['reports/ledger.md', '# Deployment\nalpha beta body']]));
    const file = vault.getFiles()[0];
    const dbName = `metadata-fields-${crypto.randomUUID()}`;
    bm25DbNames.add(dbName);
    const bm25 = new IndexedDbBM25Index(dbName);
    await bm25.load();
    const vectors = new MemoryVectorStore();
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    try {
      const indexer = new VaultIndexer(
        vault,
        vectors,
        {
          embed: () => Promise.resolve([1, 0]),
          embedBatch,
        },
        createRagConfig(),
        createChatConfig(),
        bm25,
        undefined,
        undefined,
        {
          getFileCache: () => ({
            frontmatter: { title: 'Quarterly Report', tags: ['finance', 'planning'] },
          }),
        },
      );
      await indexer.indexFile(file);
      const documents = await bm25.getCorpusDocumentsBySourcePaths([file.path]);
      expect(documents).not.toHaveLength(0);
      expect(documents[0]).toMatchObject({
        text: '# Deployment\nalpha beta body',
        title: 'Quarterly Report',
        tags: ['finance', 'planning'],
        headings: ['Deployment'],
      });
      expect((await vectors.getEntries())[0]?.metadata).toMatchObject({
        text: '# Deployment\nalpha beta body',
        title: 'Quarterly Report',
        tags: ['finance', 'planning'],
        headings: ['Deployment'],
        startLine: 0,
      });
      expect(embedBatch.mock.calls[0]?.[0]?.[0]).toContain('File: reports/ledger.md');
    } finally {
      bm25.close();
    }
  });
  it.each(
    ['vector', 'bm25', 'hybrid', 'ann'].flatMap((mode) =>
      ['true', '"true"', '0', '1', '트루', '""', 'null', '', '[]', '{}'].map((value) => ({
        mode,
        value,
      })),
    ),
  )(
    '$mode 검색은 YAML 값 $value의 제외와 복구를 공유하며 오래된 인덱스도 차단한다',
    async ({ mode, value }) => {
      const contents = new Map([['private.md', 'uniquesecret private evidence']]);
      const vault = createVault(contents);
      const file = vault.getFiles()[0];
      const store = new MemoryVectorStore();
      const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
      const provider: EmbeddingProvider = {
        embed: () => Promise.resolve([1, 0]),
        embedBatch,
      };
      const config = createRagConfig();
      const chat = createChatConfig();
      const dbName = `exclusion-search-${mode}-${crypto.randomUUID()}`;
      bm25DbNames.add(dbName);
      const bm25 = new IndexedDbBM25Index(dbName);
      try {
        await bm25.load();
        const indexer = new VaultIndexer(vault, store, provider, config, chat, bm25);
        await indexer.indexFile(file);
        const engine = new RAGQueryEngine(
          mode === 'bm25' ? null : store,
          mode === 'bm25' ? null : provider,
          mode === 'vector' ? undefined : bm25,
          mode === 'bm25' ? 1 : 0.3,
          0,
          {
            corpusStore: store,
            annEnabled: mode === 'ann',
            annMinEntryCount: 1,
            getCandidatePaths: async () =>
              new Set(
                (await getRagCandidateFiles(vault, config, chat)).map(
                  (candidate) => candidate.path,
                ),
              ),
          },
        );
        expect(
          (await engine.query('uniquesecret', 5, 0)).map((result) => result.sourcePath),
        ).toContain(file.path);
        contents.set(
          file.path,
          `---\nsuperpower-inside-exclude: ${value}\n---\nuniquesecret private evidence`,
        );
        // 제거 이벤트를 처리하기 전의 벡터·키워드 인덱스도 검색 결과에 나타나면 안 됩니다.
        expect(await store.getIndexedFilePaths()).toContain(file.path);
        expect(await bm25.getSourcePaths()).toContain(file.path);
        expect(await engine.query('uniquesecret', 5, 0)).toEqual([]);
        embedBatch.mockClear();
        await indexer.indexFile(file);
        expect(embedBatch).not.toHaveBeenCalled();
        expect(await store.getIndexedFilePaths()).toEqual([]);
        expect(await bm25.getSourcePaths()).toEqual([]);
        for (const frontmatter of [
          '---\nsuperpower-inside-exclude: false\n---\n',
          '---\nsuperpower-inside-exclude: "false"\n---\n',
          '',
        ]) {
          contents.set(file.path, `${frontmatter}uniquesecret private evidence`);
          await indexer.indexFile(file);
          expect(
            (await engine.query('uniquesecret', 5, 0)).map((result) => result.sourcePath),
          ).toContain(file.path);
        }
      } finally {
        bm25.close();
      }
    },
  );
  it.each(['yaml', 'path', 'extension'])(
    '대기 중 %s 제외로 바뀐 문서는 임베딩하지 않고 기존 인덱스를 제거한다',
    async (kind) => {
      const contents = new Map([['private.md', 'private secret']]);
      const vault = createVault(contents);
      const file = vault.getFiles()[0];
      const store = new MemoryVectorStore();
      const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
      const config = createRagConfig();
      const dbName = `exclusion-${kind}-${Date.now()}`;
      bm25DbNames.add(dbName);
      const bm25 = new IndexedDbBM25Index(dbName);
      const indexer = new VaultIndexer(
        vault,
        store,
        { embedBatch } as unknown as EmbeddingProvider,
        config,
        createChatConfig(),
        bm25,
      );
      await indexer.indexFile(file);
      expect(await store.getIndexedFilePaths()).toContain(file.path);
      if (kind === 'yaml')
        contents.set(file.path, '---\nsuperpower-inside-exclude: true\n---\nprivate secret');
      if (kind === 'path') config.excludePaths.push(file.path);
      if (kind === 'extension') config.excludeExts.push('md');
      embedBatch.mockClear();
      const result = await indexer.indexFile(file);
      expect(result.skipped).toBe(1);
      expect(embedBatch).not.toHaveBeenCalled();
      expect(await store.getIndexedFilePaths()).not.toContain(file.path);
      expect(await bm25.getSourcePaths()).not.toContain(file.path);
      if (kind === 'yaml') {
        contents.set(file.path, '---\nsuperpower-inside-exclude: false\n---\npublic');
        await indexer.indexFile(file);
        expect(embedBatch).toHaveBeenCalledOnce();
        expect(await store.getIndexedFilePaths()).toContain(file.path);
        expect(await bm25.getSourcePaths()).toContain(file.path);
      }
      bm25.close();
    },
  );
  it('중단된 파일 쓰기 복구 요청은 재색인 성공 뒤 완료 처리된다', async () => {
    const vault = createVault(new Map([['recovered.md', 'recovery alpha evidence']]));
    const file = vault.getFiles()[0];
    if (!file) throw new Error('테스트 파일이 없습니다.');
    const dbName = `write-recovery-${crypto.randomUUID()}`;
    vectorDbNames.add(dbName);
    const store = new IndexedDbVectorStore(dbName);
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig());
    await store.setMetaValue('write-recovery-requests:v1', ['recovered.md']);
    expect(await store.readPendingWriteRecovery()).toEqual(['recovered.md']);

    const result = await indexer.indexFile(file);

    expect(result.indexed).toBe(1);
    expect(await store.readPendingWriteRecovery()).toEqual([]);
    store.close();
  });

  it('임베딩 응답을 기다리는 동안 YAML로 제외하면 늦은 벡터와 BM25를 모두 제거한다', async () => {
    const contents = new Map([['private.md', 'private secret']]);
    const vault = createVault(contents);
    const file = vault.getFiles()[0];
    const store = new MemoryVectorStore();
    const dbName = `exclusion-inflight-${Date.now()}`;
    bm25DbNames.add(dbName);
    const bm25 = new IndexedDbBM25Index(dbName);
    const embedBatch = vi.fn((texts: string[]) => {
      contents.set(file.path, '---\nsuperpower-inside-exclude: true\n---\nprivate secret');
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    const indexer = new VaultIndexer(
      vault,
      store,
      { embedBatch } as unknown as EmbeddingProvider,
      createRagConfig(),
      createChatConfig(),
      bm25,
    );
    expect((await indexer.indexFile(file)).skipped).toBe(1);
    expect(await store.getEntries()).toEqual([]);
    expect(await bm25.getSourcePaths()).not.toContain(file.path);
    bm25.close();
  });
});

afterEach(async () => {
  await Promise.all([...bm25DbNames].map((name) => Dexie.delete(name)));
  bm25DbNames.clear();
  await Promise.all([...vectorDbNames].map((name) => Dexie.delete(name)));
  vectorDbNames.clear();
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
    const content = Array.from(
      { length: 12 },
      (_, index) => `line-${index}-${'x'.repeat(20)}`,
    ).join('\n');

    const chunks = chunkPlainText(content, 100, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 100)).toBe(true);
  });
});

describe('VaultIndexer 배치 인덱싱', () => {
  it('임베딩이 실패해도 청크를 BM25 corpus에 먼저 보존한다', async () => {
    const file = createFile('lexical-first.md', 1000, 40);
    const vault = createVault(new Map([[file.path, '고객 문제를 해결하는 제품 전략']]));
    const bm25 = new IndexedDbBM25Index(createBm25DbName());
    await bm25.load();
    const indexer = new VaultIndexer(
      vault,
      new MemoryVectorStore(),
      {
        embed: () => Promise.reject(new Error('embedding unavailable')),
        embedBatch: () => Promise.reject(new Error('embedding unavailable')),
      },
      createRagConfig(),
      createChatConfig(),
      bm25,
    );

    await expect(indexer.indexFile(file)).rejects.toThrow('embedding unavailable');

    expect([...bm25.search('고객 문제').keys()]).toEqual([expect.stringContaining(file.path)]);
  });

  it('임베딩 요청을 maxEmbeddingBatchSize 단위로 나눈다', async () => {
    const file = createFile('note.md', 1000, 1500);
    const vault = createVault(
      new Map([
        [file.path, Array.from({ length: 12 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')],
      ]),
    );
    const store = new MemoryVectorStore();
    const batches: number[] = [];
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        batches.push(texts.length);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    const result = await indexer.indexFile(file, { maxEmbeddingBatchSize: 2 });

    expect(batches.every((size) => size <= 2)).toBe(true);
    expect(result.indexed).toBe(1);
    expect(result.vectors).toBeGreaterThan(1);
  });

  it('skips a queued file that was deleted before indexing starts', async () => {
    const file = createFile('deleted-before-start.md', 1000, 20);
    const vault = createVault(new Map([[file.path, 'content']]));
    vi.spyOn(vault, 'getAbstractFileByPath').mockReturnValue(null);
    const cachedRead = vi.spyOn(vault, 'cachedRead');
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(
      vault,
      new MemoryVectorStore(),
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    await expect(indexer.indexFile(file)).resolves.toEqual(
      expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }),
    );
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('applies adaptive batch sizes inside one job without skipping or duplicating texts', async () => {
    const file = createFile('adaptive.md', 1000, 4000);
    const content = Array.from(
      { length: 24 },
      (_, index) => `line-${index}-${'x'.repeat(24)}`,
    ).join('\n');
    const vault = createVault(new Map([[file.path, content]]));
    const store = new MemoryVectorStore();
    const batchSizes: number[] = [];
    const submittedTexts: string[] = [];
    let nextBatchSize = 4;
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        batchSizes.push(texts.length);
        submittedTexts.push(...texts);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      { ...createRagConfig(), chunkSize: 40 },
      createChatConfig(),
    );

    await indexer.indexFile(file, {
      maxEmbeddingBatchSize: 4,
      getMaxEmbeddingBatchSize: () => nextBatchSize,
      onBatchComplete: () => {
        nextBatchSize = nextBatchSize === 4 ? 2 : 1;
      },
    });

    const entries = await store.getEntries();
    expect(batchSizes.slice(0, 3)).toEqual([4, 2, 1]);
    expect(entries.map((entry) => entry.metadata.text)).toEqual(
      chunkMarkdown(content, 40).map((chunk) => chunk.text),
    );
    expect(
      new Set(chunkMarkdown(content, 40).map((chunk) => buildSearchText(file, chunk))),
    ).toEqual(new Set(submittedTexts));
    expect(new Set(submittedTexts).size).toBe(submittedTexts.length);
  });

  it('does not start a provider request while the performance guard is paused', async () => {
    const file = createFile('paused.md', 1000, 100);
    const vault = createVault(new Map([[file.path, 'paused content']]));
    const store = new MemoryVectorStore();
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(
      vault,
      store,
      { embed: () => Promise.resolve([1, 0]), embedBatch },
      createRagConfig(),
      createChatConfig(),
    );

    await expect(
      indexer.indexFile(file, {
        getPerformanceGuardState: () => ({
          mode: 'paused',
          currentBatchSize: 1,
          currentYieldMs: 500,
          reason: 'paused',
          pauseUntilMs: Date.now() + 30_000,
          remainingPauseMs: 30_000,
          lastSlowReason: 'event loop',
        }),
      }),
    ).rejects.toBeInstanceOf(IndexingPerformancePausedError);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('배치 사이에 AbortSignal 취소를 반영한다', async () => {
    const file = createFile('note.md', 1000, 1500);
    const vault = createVault(
      new Map([
        [file.path, Array.from({ length: 12 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')],
      ]),
    );
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
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    await expect(
      indexer.indexFile(file, { signal: controller.signal, maxEmbeddingBatchSize: 1 }),
    ).rejects.toThrow();
    expect(await store.getEntries()).toEqual([]);
  });

  it.each(['resolve', 'reject'] as const)(
    'signal을 무시하는 임베딩도 즉시 취소하고 늦은 %s 결과를 저장하지 않는다',
    async (settlement) => {
      const file = createFile('cancel.md', 1000, 120);
      const vault = createVault(new Map([[file.path, 'synthetic cancellation content']]));
      const store = new MemoryVectorStore();
      const controller = new AbortController();
      let resolveBatch!: (vectors: number[][]) => void;
      let rejectBatch!: (error: Error) => void;
      const pendingBatch = new Promise<number[][]>((resolve, reject) => {
        resolveBatch = resolve;
        rejectBatch = reject;
      });
      const embedBatch = vi.fn(() => pendingBatch);
      const onBatchComplete = vi.fn();
      const replaceEntries = vi.spyOn(store, 'replaceFileEntries');
      const indexer = new VaultIndexer(
        vault,
        store,
        { embed: () => Promise.resolve([1, 0]), embedBatch },
        createRagConfig(),
        createChatConfig(),
      );
      let outcome: unknown;
      const indexing = indexer.indexFile(file, { signal: controller.signal, onBatchComplete });
      const observed = indexing.catch((error: unknown) => {
        outcome = error;
      });
      try {
        await vi.waitFor(() => expect(embedBatch).toHaveBeenCalledOnce());
        controller.abort();
        await vi.waitFor(() => expect(outcome).toBeInstanceOf(IndexingCancelledError));
      } finally {
        if (settlement === 'resolve') resolveBatch([[1, 0]]);
        else rejectBatch(new Error('late provider failure'));
        await observed;
      }
      await expect(indexing).rejects.toBeInstanceOf(IndexingCancelledError);
      expect(onBatchComplete).not.toHaveBeenCalled();
      expect(replaceEntries).not.toHaveBeenCalled();
      expect(await store.getEntries()).toEqual([]);
    },
  );

  it('임베딩 이후 원문 재읽기에도 같은 취소 signal을 전달한다', async () => {
    const file = createFile('snapshot.md', 1000, 120);
    const controller = new AbortController();
    const readSnapshot = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot');
    try {
      const indexer = new VaultIndexer(
        createVault(new Map([[file.path, 'synthetic snapshot content']])),
        new MemoryVectorStore(),
        {
          embed: () => Promise.resolve([1, 0]),
          embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
        },
        createRagConfig(),
        createChatConfig(),
      );
      await indexer.indexFile(file, { signal: controller.signal });
      expect(readSnapshot).toHaveBeenCalledTimes(2);
      expect(readSnapshot).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
        signal: controller.signal,
      });
    } finally {
      readSnapshot.mockRestore();
    }
  });

  it('임베딩 batch 결과 개수가 입력 개수와 다르면 벡터를 저장하지 않는다', async () => {
    const file = createFile('note.md', 1000, 120);
    const vault = createVault(
      new Map([[file.path, ['first chunk', '', 'second chunk'].join('\n')]]),
    );
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
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    await expect(indexer.indexFile(file)).rejects.toThrow(/Invalid embedding vector/);
    expect(await store.getEntries()).toEqual([]);
  });

  it('빈 파일은 기존 벡터를 제거하고 완료 메타데이터를 보존한다', async () => {
    const file = createFile('empty.md', 1000, 0);
    const vault = createVault(new Map([[file.path, '']]));
    const store = new MemoryVectorStore();
    await store.add([createEntry('empty.md')]);
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => Promise.resolve([[1, 0]]),
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    const result = await indexer.indexFile(file);

    expect(result).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
    expect(await store.getEntries()).toEqual([]);
    expect(await store.getFileIndexRecord(file.path)).toEqual(
      expect.objectContaining({
        filePath: file.path,
        sourceMtime: file.stat.mtime,
        sourceSize: file.stat.size,
        contentHash: createContentHash(''),
        hasCompleteMetadata: true,
        vectorCount: 0,
      }),
    );

    const secondResult = await indexer.indexFile(file);

    expect(secondResult).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
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
    const vault = createVault(
      new Map([[file.path, ['specialterm 첫 청크', '', '다른 내용'].join('\n')]]),
    );
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
  it('emits progress snapshots for pending RAG embedding batches', async () => {
    const fileA = createFile('a.md', 1000, 120);
    const fileB = createFile('b.md', 1000, 120);
    const vault = createVault(
      new Map([
        [fileA.path, Array.from({ length: 6 }, (_, index) => `alpha ${index}`).join('\n')],
        [fileB.path, Array.from({ length: 6 }, (_, index) => `bravo ${index}`).join('\n')],
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
      { ...createRagConfig(), chunkSize: 20 },
      createChatConfig(),
    );
    const progress: Array<{
      event: string;
      totalFiles: number;
      completedFiles: number;
      currentFilePath?: string;
      currentFileEmbeddedChunks: number;
      totalEstimatedChunks: number;
      completedEstimatedChunks: number;
      currentFileEstimatedChunks: number;
      totalPlannedChunks: number;
      completedPlannedChunks: number;
      currentFilePlannedChunks: number;
      planningComplete: boolean;
      completedBatchDurationsMs: readonly number[];
      completedFileDurationsMs: readonly number[];
      completedFileChunkCounts: readonly number[];
      completedFileEstimatedChunkCounts: readonly number[];
      completedFileActualChunkCounts: readonly number[];
      completedFileOverheadDurationsMs: readonly number[];
    }> = [];

    await indexer.indexPending({
      maxEmbeddingBatchSize: 1,
      onProgress: (snapshot) => {
        progress.push(snapshot);
      },
    });

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'plan', totalFiles: 2, completedFiles: 0 }),
        expect.objectContaining({ event: 'file-start', currentFilePath: 'a.md' }),
        expect.objectContaining({
          event: 'file-complete',
          currentFilePath: 'b.md',
          completedFiles: 2,
        }),
      ]),
    );
    const batchProgress = progress.find((snapshot) => snapshot.event === 'batch-complete');
    const plannedProgress = progress.find(
      (snapshot) => snapshot.event === 'plan' && snapshot.planningComplete,
    );
    expect(plannedProgress?.totalPlannedChunks).toBeGreaterThan(0);
    expect(batchProgress?.currentFileEmbeddedChunks).toBeGreaterThan(0);
    expect(batchProgress?.totalEstimatedChunks).toBe(6);
    expect(batchProgress?.planningComplete).toBe(true);
    expect(batchProgress?.totalPlannedChunks).toBe(plannedProgress?.totalPlannedChunks);
    expect(batchProgress?.currentFileEstimatedChunks).toBe(3);
    expect(batchProgress?.currentFilePlannedChunks).toBeGreaterThan(0);
    expect(batchProgress?.completedBatchDurationsMs.length).toBeGreaterThan(0);
    for (const snapshot of progress.filter((entry) => entry.event === 'file-complete')) {
      expect(snapshot.currentFileEmbeddedChunks).toBe(0);
      expect(snapshot.currentFileEstimatedChunks).toBe(0);
      expect(snapshot.currentFilePlannedChunks).toBe(0);
    }
    const finalProgress = progress.find(
      (snapshot) => snapshot.event === 'file-complete' && snapshot.currentFilePath === 'b.md',
    );
    expect(finalProgress?.completedEstimatedChunks).toBe(6);
    expect(finalProgress?.completedPlannedChunks).toBe(finalProgress?.totalPlannedChunks);
    expect(finalProgress?.completedFileDurationsMs.length).toBeGreaterThan(0);
    expect(finalProgress?.completedFileChunkCounts.length).toBeGreaterThan(0);
    expect(finalProgress?.completedFileEstimatedChunkCounts.length).toBeGreaterThan(0);
    expect(finalProgress?.completedFileActualChunkCounts.length).toBeGreaterThan(0);
    expect(finalProgress?.completedFileOverheadDurationsMs.length).toBeGreaterThan(0);
  });

  it('계획 단계에서도 100개 파일마다 plan 진행 이벤트를 보낸다', async () => {
    const contents = new Map<string, string>();
    for (let index = 0; index < 250; index++) {
      contents.set(`plan/${String(index).padStart(3, '0')}.md`, `plan body ${index}`);
    }
    const indexer = new VaultIndexer(
      createVault(contents),
      new MemoryVectorStore(),
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      createRagConfig(),
      createChatConfig(),
    );
    const planIndices: Array<number | undefined> = [];

    const result = await indexer.indexPending({
      maxEmbeddingBatchSize: 128,
      onProgress: (snapshot) => {
        if (snapshot.event === 'plan' && !snapshot.planningComplete) {
          planIndices.push(snapshot.currentFileIndex);
        }
      },
    });

    expect(result.indexed).toBe(250);
    // 첫 파일을 읽기 전과 100개 파일마다 알리고, 초기 이벤트는 index가 없습니다.
    expect(planIndices).toEqual([undefined, 0, 99, 199]);
  });

  it('계획의 각 파일을 읽기 전에 현재 파일과 순번을 갱신한다', async () => {
    const contents = new Map([
      ['plan/first.md', 'synthetic first content'],
      ['plan/second.md', 'synthetic second content'],
    ]);
    const readSourceText = sourceAccess.readSourceText;
    const read = vi
      .spyOn(sourceAccess, 'readSourceText')
      .mockImplementation((vault, file, options) => {
        options?.onProgress?.(1, 1);
        return readSourceText(vault, file, options);
      });
    const currentFiles: Array<[string | undefined, number | undefined]> = [];
    try {
      const indexer = new VaultIndexer(
        createVault(contents),
        new MemoryVectorStore(),
        {
          embed: () => Promise.resolve([1, 0]),
          embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
        },
        createRagConfig(),
        createChatConfig(),
      );
      await indexer.indexPending({
        onProgress: (snapshot) => {
          if (snapshot.event === 'plan' && snapshot.sourcePage === 1) {
            currentFiles.push([snapshot.currentFilePath, snapshot.currentFileIndex]);
          }
        },
      });
      expect(currentFiles).toEqual([
        ['plan/first.md', 0],
        ['plan/second.md', 1],
      ]);
    } finally {
      read.mockRestore();
    }
  });

  it('limits automatic recovery to one Rust-planned background batch', async () => {
    const contents = new Map<string, string>();
    for (let index = 0; index < 35; index++) {
      contents.set(`notes/${String(index).padStart(2, '0')}.md`, `note ${index}`);
    }
    contents.set('notes/large.md', 'x'.repeat(600_000));
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      createVault(contents),
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      createRagConfig(),
      createChatConfig(),
    );

    const result = await indexer.indexPending({ automaticRecovery: true });

    expect(result.indexed).toBe(32);
    expect(result.documents).toHaveLength(32);
    expect(result.documents).not.toContain('notes/large.md');
  });

  it('keeps prior vector coverage when a full reindex is paused', async () => {
    const fileA = createFile('a.md', 1000, 120);
    const fileB = createFile('b.md', 1000, 120);
    const vault = createVault(
      new Map([
        [fileA.path, 'new alpha'],
        [fileB.path, 'new beta'],
      ]),
    );
    class ClearObservingStore extends MemoryVectorStore {
      clearCount = 0;

      override async clear(): Promise<void> {
        this.clearCount += 1;
        await super.clear();
      }
    }
    const store = new ClearObservingStore();
    await store.add([createEntry(fileA.path), createEntry(fileB.path)]);
    let completedBatches = 0;
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

    await expect(
      indexer.reindexAll({
        onBatchComplete: () => {
          completedBatches += 1;
        },
        getPerformanceGuardState: () =>
          completedBatches >= 2
            ? {
                mode: 'paused',
                currentBatchSize: 1,
                currentYieldMs: 500,
                reason: 'paused',
                pauseUntilMs: Date.now() + 30_000,
                remainingPauseMs: 30_000,
                lastSlowReason: 'event loop',
              }
            : null,
      }),
    ).rejects.toBeInstanceOf(IndexingPerformancePausedError);

    const entries = await store.getEntries();
    expect(store.clearCount).toBe(0);
    expect(entries.some((entry) => entry.metadata.filePath === 'a.md')).toBe(true);
    expect(entries.find((entry) => entry.metadata.filePath === 'b.md')?.metadata.text).toBe('old');
  });

  it('문서 삭제 후 증분 인덱싱은 벡터·BM25·통계를 현재 문서 기준으로 수렴시킨다', async () => {
    const contents = new Map([
      ['a.md', 'alpha 문서 내용'],
      ['b.md', 'beta 문서 내용'],
    ]);
    const vault = createVault(contents);
    const store = new MemoryVectorStore();
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const ragConfig: RAGConfig = { ...createRagConfig(), enableBM25: true };
    const chatConfig = createChatConfig();
    const indexer = new VaultIndexer(vault, store, embeddingProvider, ragConfig, chatConfig, bm25);

    await indexer.indexPending();
    const before = await calculateRagStatus(vault, store, ragConfig, chatConfig);
    expect(before.healthyDocuments).toBe(2);
    expect(before.totalVectors).toBeGreaterThan(1);

    contents.delete('b.md');
    const liveFiles = vault.getFiles();
    liveFiles.splice(
      liveFiles.findIndex((file) => file.path === 'b.md'),
      1,
    );

    await indexer.indexPending();

    const entries = await store.getEntries();
    const currentEntries = entries.filter((entry) => entry.metadata.filePath === 'a.md');
    expect(entries.some((entry) => entry.metadata.filePath === 'b.md')).toBe(false);
    expect([...bm25.search('beta').keys()]).toEqual([]);
    const after = await calculateRagStatus(vault, store, ragConfig, chatConfig);
    expect(after.healthyDocuments).toBe(1);
    expect(after.totalVectors).toBe(currentEntries.length);
    expect(after.updateRequiredDocuments).toEqual([]);
  });

  it('증분 인덱싱의 첫 진행 스냅샷은 볼트 전체가 아니라 실제 대상 수를 보고한다', async () => {
    const contents = new Map([
      ['a.md', 'alpha 문서 내용'],
      ['b.md', 'bravo 문서 내용'],
      ['c.md', 'charlie 문서 내용'],
    ]);
    const vault = createVault(contents);
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      vault,
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      createRagConfig(),
      createChatConfig(),
    );

    await indexer.indexPending();

    const target = (
      vault.getFiles() as Array<TFile & { stat: { mtime: number; size: number } }>
    ).find((file) => file.path === 'b.md');
    expect(target).toBeDefined();
    contents.set('b.md', 'bravo 문서 내용 변경');
    if (target) {
      target.stat.mtime = 2000;
      target.stat.size = 17;
    }

    const planTotals: number[] = [];
    await indexer.indexPending({
      onProgress: (snapshot) => {
        if (snapshot.event === 'plan') planTotals.push(snapshot.totalFiles);
      },
    });

    expect(planTotals).not.toContain(3);
    expect(planTotals).toContain(1);
  });

  it('증분 인덱싱도 현재 대상이 아닌 벡터와 BM25 문서를 제거한다', async () => {
    const file = createFile('current.md', 1000, 80);
    const vault = createVault(new Map([[file.path, '현재 문서 내용']]));
    const store = new MemoryVectorStore();
    await store.add([createEntry('deleted.md')]);
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

    await indexer.indexPending();

    const entries = await store.getEntries();
    expect(entries.some((entry) => entry.metadata.filePath === 'deleted.md')).toBe(false);
    expect([...bm25.search('staleterm').keys()]).toEqual([]);
  });

  it('길이별 고유 입력을 배치 처리하고 원래 청크의 벡터·진행률을 복원한다', async () => {
    const content = [
      'a'.repeat(90),
      '반복'.repeat(45),
      'a'.repeat(90),
      'z'.repeat(60),
      '반복'.repeat(45),
    ].join('\n\n');
    const vault = createVault(new Map([['batch.txt', content]]));
    const file = vault.getFiles()[0];
    const store = new MemoryVectorStore();
    const batches: string[][] = [];
    const progress: number[] = [];
    const indexer = new VaultIndexer(
      vault,
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => {
          batches.push(texts);
          return Promise.resolve(texts.map((text) => [text.length, 1]));
        },
      },
      createRagConfig(),
      createChatConfig(),
    );
    const sourceTexts = chunkPlainText(content, 100).map((chunk) => buildSearchText(file, chunk));
    expect(new Set(sourceTexts).size).toBeLessThan(sourceTexts.length);

    await indexer.indexFile(file, {
      maxEmbeddingBatchSize: 2,
      onProgress: (snapshot) => {
        if (snapshot.event === 'batch-complete') progress.push(snapshot.currentFileEmbeddedChunks);
      },
    });

    const embeddedTexts = batches.flat();
    expect(embeddedTexts).toHaveLength(new Set(sourceTexts).size);
    expect(new Set(embeddedTexts)).toEqual(new Set(sourceTexts));
    expect(embeddedTexts.map((text) => text.length)).toEqual(
      embeddedTexts.map((text) => text.length).sort((a, b) => b - a),
    );
    expect(batches.every((batch) => batch.length <= 2)).toBe(true);
    const entries = await store.getEntries();
    expect(entries.map((entry) => entry.metadata.text)).toEqual(
      chunkPlainText(content, 100).map((chunk) => chunk.text),
    );
    expect(entries.map((entry) => entry.vector)).toEqual(
      sourceTexts.map((text) => [text.length, 1]),
    );
    expect(progress.at(-1)).toBe(sourceTexts.length);
  });

  it('가드 없는 배치 옵션은 파일 청크를 한 번에 임베딩한다', async () => {
    const paragraph = 'x'.repeat(80);
    const file = createFile('bulk.md', 1000, paragraph.length * 12);
    const vault = createVault(
      new Map([
        [file.path, Array.from({ length: 12 }, (_, index) => `${index} ${paragraph}`).join('\n\n')],
      ]),
    );
    const store = new MemoryVectorStore();
    const batchSizes: number[] = [];
    const embeddingProvider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts) => {
        batchSizes.push(texts.length);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const indexer = new VaultIndexer(
      vault,
      store,
      embeddingProvider,
      createRagConfig(),
      createChatConfig(),
    );

    await indexer.indexFile(file, { maxEmbeddingBatchSize: undefined, indexingYieldMs: 0 });

    expect(batchSizes).toHaveLength(1);
    expect(batchSizes[0]).toBeGreaterThan(1);
  });

  it('메타데이터가 같아도 내용이 바뀐 파일은 전체 재인덱싱에서 다시 색인한다', async () => {
    const contents = new Map([['same.md', 'alpha 원본 내용']]);
    const vault = createVault(contents);
    const store = new MemoryVectorStore();
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(
      vault,
      store,
      { embed: () => Promise.resolve([1, 0]), embedBatch },
      createRagConfig(),
      createChatConfig(),
    );

    await indexer.reindexAll();
    contents.set('same.md', 'bravo 원본 내용');
    await indexer.reindexAll();

    expect(embedBatch).toHaveBeenCalledTimes(2);
    const entries = await store.getEntries();
    expect(entries.some((entry) => entry.metadata.text.includes('bravo'))).toBe(true);
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
    enableBM25: false,
    bm25Weight: 0.3,
    performanceTuningMode: 'auto',
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
    mcpMentionOnly: true,
  };
}

function createVault(contents: Map<string, string>, binaries?: Map<string, Uint8Array>): Vault {
  const files = [...contents.keys()].map((path) =>
    createFile(path, 1000, contents.get(path)?.length ?? 0),
  );
  return {
    getFiles: () => files,
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    cachedRead: (file: TFile) => Promise.resolve(contents.get(file.path) ?? ''),
    readBinary: (file: TFile) =>
      Promise.resolve((binaries?.get(file.path) ?? new Uint8Array()).slice().buffer),
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

describe('압축 문서 인덱싱', () => {
  it('본문 추출에 실패한 압축 문서는 볼트 전체 재색인을 중단시키지 않는다', async () => {
    const contents = new Map([
      ['notes/good.md', 'good body'],
      ['notes/broken.docx', 'x'],
    ]);
    const binaries = new Map([
      ['notes/broken.docx', new TextEncoder().encode('not-a-zip-container')],
    ]);
    const vault = createVault(contents, binaries);
    const store = new MemoryVectorStore();
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig());

    const result = await indexer.indexVault();
    const indexedPaths = await store.getIndexedFilePaths();

    expect(result.indexed).toBeGreaterThan(0);
    expect(indexedPaths).toContain('notes/good.md');
    expect(indexedPaths).not.toContain('notes/broken.docx');
    expect(indexer.getFailedFilePaths()).toContain('notes/broken.docx');
  });

  it('본문 추출에 실패한 압축 문서는 필요 문서 업데이트를 중단시키지 않는다', async () => {
    const contents = new Map([
      ['notes/a-good.md', 'alpha body'],
      ['notes/b-broken.docx', 'x'],
      ['notes/c-good.md', 'gamma body'],
    ]);
    const binaries = new Map([
      ['notes/b-broken.docx', new TextEncoder().encode('not-a-zip-container')],
    ]);
    const vault = createVault(contents, binaries);
    const store = new MemoryVectorStore();
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => [1, 0])),
    };
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig());

    const result = await indexer.indexPending();
    const indexedPaths = await store.getIndexedFilePaths();

    expect(result.skipped).toBeGreaterThan(0);
    expect(indexedPaths).toContain('notes/a-good.md');
    expect(indexedPaths).toContain('notes/c-good.md');
    expect(indexedPaths).not.toContain('notes/b-broken.docx');
    expect(indexer.getFailedFilePaths()).toContain('notes/b-broken.docx');
  });
});
