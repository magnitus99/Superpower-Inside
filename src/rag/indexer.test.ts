import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chunkMarkdown,
  chunkPlainText,
  buildSearchText,
  IndexingCancelledError,
  IndexingPerformancePausedError,
  registerModifyEvent,
  VaultIndexer,
  type RagIndexingProgressSnapshot,
} from './indexer';
import type { DataAdapter, TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import { CachedEmbeddingProvider, type EmbeddingProvider, type EmbeddingOptions } from '../llm/embedding';
import { IndexedDbVectorStore, MemoryVectorStore, type VectorEntry, type VectorStore } from './store';
import { IndexedDbDocumentCorpusStore } from './document-corpus-store';
import { VaultDocumentCorpus } from './vault-document-corpus';
import { appLogger } from '../utils/logger';
import { buildSourceDocuments } from './source-document';
import { calculateRagStatus } from './status';
import { IndexedDbBM25Index } from './bm25';
import { planIndexPendingFilesRust, planLocalRagAdmissionRust, planRagIndexingEtaRust, prepareSourceTextRust, type SourcePreparationConfig } from './rust-core';
import { createContentHash } from './hash';
import { RAGQueryEngine } from './query';
import { getRagCandidateFiles, beginRagPreparedSourceProbe, disposeRagFileEligibilityCache } from '../utils/vault';
import * as sourceAccess from './source-access';
import * as sourceSnapshot from './source-snapshot';
import * as pdfSource from './pdf-worker-runtime';

const bm25DbNames = new Set<string>();
const vectorDbNames = new Set<string>();

describe('실제 await 이전 단계 관측', () => {
  it('lexical·embedding·vector commit은 각 실제 await가 끝나기 전 게시하고 완료 수는 늘리지 않는다', async () => {
    const vault = createVault(new Map([['synthetic-progress.md', 'synthetic progress source']]));
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const store = new MemoryVectorStore();
    let release!: () => void;
    const commit = new Promise<void>((resolve) => { release = resolve; });
    const replace = store.replaceBatchFileEntries.bind(store);
    vi.spyOn(store, 'replaceBatchFileEntries').mockImplementation(async (entries) => {
      expect(snapshots.at(-1)).toMatchObject({ stage: 'committing', completedFiles: 0 });
      await commit; await replace(entries);
    });
    const provider: EmbeddingProvider = { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => {
      expect(snapshots.at(-1)).toMatchObject({ stage: 'embedding', completedFiles: 0 });
      return Promise.resolve(texts.map(() => [1, 0]));
    } };
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig(), undefined, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: () => Promise.resolve(), replaceBatchFileDocuments: () => {
        expect(snapshots.at(-1)).toMatchObject({ stage: 'lexical', completedFiles: 0 });
        return Promise.resolve();
      },
    });
    const running = indexer.indexVault({ onProgress: (progress) => snapshots.push(progress) });
    await vi.waitFor(() => expect(snapshots.at(-1)?.stage).toBe('committing'));
    expect(snapshots.at(-1)?.completedFiles).toBe(0);
    release(); await running;
    expect(snapshots.at(-1)).toMatchObject({ stage: 'settled', completedFiles: 1 });
  });
});

describe('lexical 원문 block 저장 연결', () => {
  it('준비한 같은 본문을 첫 embedding 전에 corpus에 저장한다', async () => {
    const contents = new Map([['synthetic/raw-body.md', 'retained raw source\nneedle condition']]);
    const vault = createVault(contents);
    const corpusName = `literal-indexer:${crypto.randomUUID()}`;
    const corpus = new IndexedDbDocumentCorpusStore(corpusName);
    const config = createRagConfig(), chat = createChatConfig();
    const sourceCorpus = new VaultDocumentCorpus(vault, corpus, () => config, () => chat, appLogger);
    const bm25 = new IndexedDbBM25Index(createBm25DbName());
    await bm25.load();
    const original = sourceSnapshot.readSourceFileSnapshot;
    const read = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot').mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      if (!snapshot) return snapshot;
      const byteLength = new TextEncoder().encode(snapshot.content).length;
      return { ...snapshot, bodyPlan: { version: 1 as const, byteLength, utf16Length: snapshot.content.length, scanChargeBytes: 4096, blocks: byteLength ? [{ startByte: 0, endByte: byteLength, startUtf16: 0, endUtf16: snapshot.content.length }] : [] } };
    });
    let bodyAtEmbedding: unknown;
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: async (texts) => { bodyAtEmbedding = (await corpus.getSourceBodyHeaders(null, 8))[0]?.body; return texts.map(() => [1, 0]); },
    };
    const indexer = new VaultIndexer(vault, new MemoryVectorStore(), provider, config, chat, bm25, undefined, sourceCorpus);
    try {
      const result = await indexer.indexFile(vault.getFiles()[0]);
      expect(result.indexed).toBe(1);
      expect(bodyAtEmbedding).toMatchObject({ version: 1, blockCount: 1 });
      const blocks = await corpus.getSourceBodyBlocks('synthetic/raw-body.md', 0, 8);
      expect(blocks.map((block) => block.text).join('')).toBe(contents.get('synthetic/raw-body.md'));
    } finally { read.mockRestore(); bm25.close(); corpus.close(); await Dexie.delete(corpusName); }
  });
});

describe('공유 window source lookahead', () => {
  it.each(['ready', 'preparation-failed', 'cancelled', 'source-changed', 'input-reservation'] as const)('실제 inference 중 source 하나를 준비하고 공유 cap/실패 격리를 지킨다 (%s)', async (scenario) => {
    const failLookahead = scenario === 'preparation-failed';
    const cancelled = scenario === 'cancelled';
    const inputBoundary = scenario === 'input-reservation';
    const contents = new Map([['synthetic/first.md', inputBoundary ? 'a'.repeat(100000) : 'synthetic first evidence'], ['synthetic/second.md', inputBoundary ? 'b'.repeat(600000) : 'synthetic second evidence'], ['synthetic/third.md', 'synthetic third evidence']]);
    const vault = createVault(contents);
    const files = vault.getFiles();
    const vectors = new MemoryVectorStore();
    const corpusDb = `synthetic-overlap-${crypto.randomUUID()}`;
    const corpus = new IndexedDbDocumentCorpusStore(corpusDb);
    const bm25 = new IndexedDbBM25Index(createBm25DbName());
    await bm25.load();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20));
    const originalRead = sourceSnapshot.readSourceFileSnapshot;
    let preparedAhead = (): void => undefined;
    let stagedSnapshot: sourceSnapshot.SourceFileSnapshot | null = null;
    let stagedError: unknown;
    const preparedReady = new Promise<void>((resolve) => { preparedAhead = resolve; });
    const reads = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot').mockImplementation(async (vault, file, options) => {
      if (options?.preparation?.maxChargeBytes !== undefined && failLookahead) throw new sourceAccess.SourceReadError('memory-budget');
      try {
        const result = await originalRead(vault, file, options);
        if (options?.preparation?.maxChargeBytes !== undefined) { stagedSnapshot = result; preparedAhead(); }
        return result;
      } catch (error) {
        if (options?.preparation?.maxChargeBytes !== undefined) { stagedError = error; preparedAhead(); }
        throw error;
      }
    });
    let finishRead = (): void => undefined;
    let readWaiting = false;
    const originalBinary = vault.readBinary.bind(vault);
    vi.spyOn(vault, 'readBinary').mockImplementation((file) => {
      if (cancelled && file.path === files[1].path && !readWaiting) {
        readWaiting = true;
        return new Promise<ArrayBuffer>((resolve) => { finishRead = () => resolve(new TextEncoder().encode(contents.get(file.path) ?? '').buffer); });
      }
      return originalBinary(file);
    });
    let finish = (): void => undefined;
    let started = (): void => undefined;
    const embeddingStarted = new Promise<void>((resolve) => { started = resolve; });
    let first = true;
    const provider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: async (texts: string[], options?: EmbeddingOptions) => {
        options?.onInferenceDispatch?.();
        if (first) {
          first = false;
          started();
          await new Promise<void>((resolve) => { finish = resolve; });
        }
        return texts.map(() => [1, 0]);
      },
      planLocalAdmission: vi.fn((source: { sourceBudgetBytes: number; reservedSourceBytes: number; plannedSourceBytes: number }) => planLocalRagAdmissionRust({
        ...source, backend: 'cpu', maxBatchSize: 1, targetBatchMs: 100, maxLagMs: 20, nowMs: 1000,
        foregroundPending: 0, physicalSourceCount: 0, physicalInferenceCount: 1,
        state: { backend: 'cpu', maxBatchSize: 1, batchSize: 1, healthySamples: 0, previousRate: 0.1, trialBaseRate: null, lastSampleEndedAtMs: 900, lastLagMs: 1 },
        sample: { endedAtMs: 1000, workUnits: 1, durationMs: 10, lagMs: 1, rssBytes: 100000000, availableBytes: 1000000000 },
      })),
    };
    const config = createRagConfig();
    if (inputBoundary) { config.chunkSize = 1000; config.overlap = 20; }
    const chat = createChatConfig();
    const sourceCorpus = new VaultDocumentCorpus(vault, corpus, () => config, () => chat, appLogger);
    const indexer = new VaultIndexer(vault, vectors, provider, config, chat, bm25, undefined, sourceCorpus);
    const controller = new AbortController();
    const indexing = indexer.indexVault({ signal: controller.signal });
    void indexing.catch(() => undefined);
    try {
      await embeddingStarted;
      await vi.waitFor(() => expect(reads.mock.calls.some(([, file, options]) => file.path === files[1].path && options?.preparation?.maxChargeBytes !== undefined)).toBe(true));
      expect(await corpus.getIndexedFilePaths()).toEqual([files[0].path]);
      expect(await vectors.getEntries()).toEqual([]);
      const prepared = reads.mock.calls.find(([, file, options]) => file.path === files[1].path && options?.preparation?.maxChargeBytes !== undefined)![2]!.preparation!;
      const charge = provider.planLocalAdmission.mock.calls[0][0];
      expect(charge.reservedSourceBytes + charge.plannedSourceBytes).toBeLessThanOrEqual(charge.sourceBudgetBytes);
      expect(prepared.maxChargeBytes).toBe(charge.plannedSourceBytes - files[1].stat.size * 4);
      expect(prepared.maxPreparedChunks).toBeLessThan(4096);
      if (cancelled) {
        await vi.waitFor(() => expect(readWaiting).toBe(true));
        controller.abort();
        await expect(indexing).rejects.toBeInstanceOf(IndexingCancelledError);
        expect(await corpus.getIndexedFilePaths()).toEqual([files[0].path]);
        expect(await vectors.getEntries()).toEqual([]);
        finishRead();
        finish();
        for (let tick = 0; tick < 12; tick++) await Promise.resolve();
        expect(await corpus.getIndexedFilePaths()).toEqual([files[0].path]);
        return;
      }
      if (inputBoundary) {
        await preparedReady;
        if (stagedSnapshot) expect(charge.reservedSourceBytes + (stagedSnapshot as sourceSnapshot.SourceFileSnapshot).chargeBytes).toBeLessThanOrEqual(charge.sourceBudgetBytes);
        expect(stagedError).toBeInstanceOf(sourceAccess.SourceReadError);
        expect((stagedError as sourceAccess.SourceReadError).reason).toBe('memory-budget');
      }
      if (scenario === 'source-changed') {
        await preparedReady;
        contents.set(files[1].path, 'synthetic revised evidence');
        files[1].stat.mtime++;
        files[1].stat.size = contents.get(files[1].path)!.length;
      }
      finish();
      const result = await indexing;
      expect(result.indexed).toBe(3);
      expect(result.failed ?? 0).toBe(0);
      expect(indexer.getFailedFilePaths()).toEqual([]);
      expect(await corpus.getIndexedFilePaths()).toHaveLength(3);
      const indexedDocuments = await bm25.getCorpusDocumentsBySourcePaths(files.map((file) => file.path));
      const storedVectors = await vectors.getEntries();
      if (inputBoundary) {
        expect(indexedDocuments.length).toBeGreaterThan(3);
        expect(storedVectors).toHaveLength(indexedDocuments.length);
        expect(new Set(storedVectors.map((entry) => entry.metadata.filePath))).toEqual(new Set(files.map((file) => file.path)));
      } else {
        expect(indexedDocuments).toHaveLength(3);
        expect(storedVectors).toHaveLength(3);
      }
      const secondPreparations = reads.mock.calls.filter(([, file, options]) => file.path === files[1].path && options?.preparation);
      expect(secondPreparations).toHaveLength(failLookahead || scenario === 'source-changed' || inputBoundary ? 2 : 1);
      if (scenario === 'source-changed') expect((await corpus.getDocumentsByFilePath(files[1].path))[0]?.text).toBe('synthetic revised evidence');
      if (failLookahead) expect(reads.mock.calls.filter(([, , options]) => options?.preparation?.maxChargeBytes !== undefined)).toHaveLength(1);
    } finally {
      finishRead();
      finish();
      await indexing.catch(() => undefined);
      vi.restoreAllMocks();
      bm25.close();
      corpus.close();
      await Dexie.delete(corpusDb);
    }
  });
});

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
            frontmatter: {
              title: 'Quarterly Report',
              tags: ['finance', 'planning'],
              aliases: ['Quarterly Ledger', '분기 보고서'],
            },
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
        aliases: ['Quarterly Ledger', '분기 보고서'],
        headings: ['Deployment'],
      });
      expect((await vectors.getEntries())[0]?.metadata).toMatchObject({
        text: '# Deployment\nalpha beta body',
        title: 'Quarterly Report',
        tags: ['finance', 'planning'],
        aliases: ['Quarterly Ledger', '분기 보고서'],
        headings: ['Deployment'],
        startLine: 1,
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
    const readBinary = vi.spyOn(vault, 'readBinary');
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
    expect(readBinary).not.toHaveBeenCalled();
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
      expect(readSnapshot).toHaveBeenCalledTimes(3);
      expect(readSnapshot.mock.calls.every((call) => call[2]?.signal === controller.signal)).toBe(true);
      expect(readSnapshot).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
        signal: controller.signal,
        forceRefresh: true,
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

    expect(await indexer.indexFile(file)).toMatchObject({ indexed: 1 });
    expect(embedBatchCalls).toBe(1);
    embedBatchCalls = 0;
    removeSourceSpy.mockClear(); addDocumentSpy.mockClear(); persistSpy.mockClear();
    const result = await indexer.indexFile(file);

    expect(result).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
    expect(result.documents).toEqual(['note.md']);
    expect(embedBatchCalls).toBe(0);
    expect(removeSourceSpy).not.toHaveBeenCalled();
    expect(addDocumentSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('mtime만 바뀌고 내용 hash가 같으면 재임베딩 없이 vector·BM25 revision만 갱신한다', async () => {
    const content = '변경되지 않은 본문';
    const contentHash = createContentHash(content);
    const vault = createVault(new Map([['note.md', content]]));
    const file = vault.getFiles()[0];
    const store = new MemoryVectorStore();
    const bm25 = new IndexedDbBM25Index(createBm25DbName(), createAdapter());
    await bm25.load();
    try {
      let embedBatchCalls = 0;
      const indexer = new VaultIndexer(
        vault,
        store,
        {
          embed: () => Promise.resolve([1, 0]),
          embedBatch: (texts) => {
            embedBatchCalls += 1;
            return Promise.resolve(texts.map(() => [1, 0]));
          },
        },
        { ...createRagConfig(), enableBM25: true },
        createChatConfig(),
        bm25,
      );
      expect(await indexer.indexFile(file)).toMatchObject({ indexed: 1 });
      expect(embedBatchCalls).toBe(1);
      embedBatchCalls = 0;
      file.stat.mtime = 2000;
      const refreshRevision = vi.spyOn(store, 'refreshFileIndexRevision');

      const observations: RagIndexingProgressSnapshot[] = [];
      const result = await indexer.indexFile(file, { onProgress: (snapshot) => observations.push(snapshot) });
      expect(observations.at(-1)).toMatchObject({ completedFiles: 0, processedFiles: 1, failedFiles: 0, partialFiles: 0 });
      expect(observations.at(-1)?.pipeline).toMatchObject({ lifecycle: 'finalizing', processedEstimatedChunks: 1, processedPlannedChunks: 1, windowSamples: [], inferenceSamples: [] });

      expect(result).toEqual(expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }));
      expect(embedBatchCalls).toBe(0);
      expect(await store.getFileIndexRecord(file.path)).toEqual(
        expect.objectContaining({
          sourceMtime: 2000,
          sourceSize: content.length,
          contentHash,
          vectorCount: 1,
        }),
      );
      expect((await store.getEntries())[0]?.metadata).toEqual(
        expect.objectContaining({ sourceMtime: 2000, sourceSize: content.length }),
      );
      expect(await bm25.getCorpusDocumentsBySourcePaths([file.path])).toEqual([
        expect.objectContaining({ sourceMtime: 2000, sourceSize: content.length, contentHash }),
      ]);
      await expect(
        calculateRagStatus(vault, store, createRagConfig(), createChatConfig()),
      ).resolves.toEqual(expect.objectContaining({ updateRequiredDocuments: [] }));
      expect(refreshRevision).toHaveBeenCalledOnce();

      await expect(indexer.indexFile(file)).resolves.toEqual(
        expect.objectContaining({ indexed: 0, vectors: 0, skipped: 1 }),
      );
      expect(embedBatchCalls).toBe(0);
      expect(refreshRevision).toHaveBeenCalledOnce();
    } finally {
      bm25.close();
    }
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
    const batchProgress = progress.find((snapshot) => snapshot.event === 'batch-complete' && snapshot.currentFileEmbeddedChunks > 0);
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

  it('전역 본문 선읽기 대신 첫 유한 window부터 임베딩하며 각 준비 위치를 게시한다', async () => {
    const contents = new Map<string, string>();
    for (let index = 0; index < 250; index++) {
      contents.set(`plan/${String(index).padStart(3, '0')}.md`, `plan body ${index}\n`.repeat(1024));
    }
    const vault = createVault(contents);
    const binaryReads = vi.spyOn(vault, 'readBinary');
    let firstEmbeddingBinaryReads = 0;
    const indexer = new VaultIndexer(
      vault,
      new MemoryVectorStore(),
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => {
          if (firstEmbeddingBinaryReads === 0) firstEmbeddingBinaryReads = binaryReads.mock.calls.length;
          return Promise.resolve(texts.map(() => [1, 0]));
        },
      },
      createRagConfig(),
      createChatConfig(),
    );
    const planIndices: Array<number | undefined> = [];
    const reads = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot');
    let firstEmbeddingReads = 0;

    const result = await indexer.indexPending({
      maxEmbeddingBatchSize: 128,
      onBatchComplete: () => { if (firstEmbeddingReads === 0) firstEmbeddingReads = reads.mock.calls.length; },
      onProgress: (snapshot) => {
        if (snapshot.event === 'plan' && !snapshot.planningComplete) {
          planIndices.push(snapshot.currentFileIndex);
        }
      },
    });

    expect(result.indexed).toBe(250);
    // 전수 본문 계획 완료를 기다리지 않고 실제 준비 window를 바로 소비합니다.
    expect(firstEmbeddingReads).toBeGreaterThan(0);
    expect(firstEmbeddingReads).toBeLessThan(250);
    expect(firstEmbeddingBinaryReads).toBeGreaterThan(0);
    expect(firstEmbeddingBinaryReads).toBeLessThan(250);
    expect([...new Set(planIndices.filter((index) => index !== undefined))]).toEqual(Array.from({ length: 250 }, (_, index) => index));
    reads.mockRestore();
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

  it('processes one Rust-planned background batch including large sources', async () => {
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

    expect(result.indexed).toBe(36);
    expect(result.documents).toHaveLength(36);
    expect(result.documents).toContain('notes/large.md');
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
        maxEmbeddingBatchSize: 1,
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
    const vault = createEventVault(contents);
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
      await vault.emitModify(target);
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
      Promise.resolve(
        (binaries?.get(file.path) ?? new TextEncoder().encode(contents.get(file.path) ?? '')).slice()
          .buffer,
      ),
  } as unknown as Vault;
}

function createEventVault(contents: Map<string, string>): Vault & {
  emitModify(file: TFile): Promise<void>;
} {
  const baseVault = createVault(contents);
  type ListenerRef = { name: string; callback: (file: TFile) => void | Promise<void> };
  const listeners = new Set<ListenerRef>();
  return {
    ...baseVault,
    on: (name: string, callback: ListenerRef['callback']) => {
      const ref = { name, callback };
      listeners.add(ref);
      return ref;
    },
    offref: (ref: ListenerRef) => {
      listeners.delete(ref);
    },
    emitModify: async (file: TFile) => {
      await Promise.all(
        [...listeners]
          .filter((ref) => ref.name === 'modify')
          .map(async (ref) => {
            await ref.callback(file);
          }),
      );
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
      ['notes/broken.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0])],
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
      ['notes/b-broken.docx', new Uint8Array([0x50, 0x4b, 3, 4, 0])],
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

  it('다중 파일 색인은 여러 문서의 청크를 교차 파일 배치로 묶어 임베딩 호출 수를 줄이고 스킵된 파일로 ETA 샘플을 오염시키지 않는다', async () => {
    const contents = new Map([
      ['notes/1.md', 'first document body'],
      ['notes/2.md', 'second document body'],
      ['notes/3.md', 'third document body'],
      ['notes/4.md', 'fourth document body'],
    ]);
    const vault = createVault(contents);
    const store = new MemoryVectorStore();
    const batches: string[][] = [];
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts: string[]) => {
        batches.push([...texts]);
        return Promise.resolve(texts.map((text) => [text.length, 1]));
      },
    };
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig());

    const firstRun = await indexer.indexVault({ maxEmbeddingBatchSize: 16 });
    expect(firstRun.indexed).toBe(4);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);

    batches.length = 0;
    contents.set('notes/4.md', 'fourth document body updated');
    const target = vault.getFiles().find((file) => file.path === 'notes/4.md');
    if (target) {
      target.stat.mtime += 1;
      target.stat.size = 28;
    }
    let lastCompletedFileSampleCount = 0;
    const secondRun = await indexer.indexVault({
      maxEmbeddingBatchSize: 16,
      onProgress: (snapshot) => {
        if (snapshot.event === 'file-complete') {
          lastCompletedFileSampleCount = snapshot.completedFileChunkCounts.length;
        }
      },
    });
    expect(secondRun.indexed).toBe(1);
    expect(secondRun.skipped).toBe(3);
    expect(lastCompletedFileSampleCount).toBe(1);
  });
});

describe('준비 원문의 lexical-first 내구 경계', () => {
  function xlsxFixture(sheets: readonly { name: string; value: string | null; address?: string }[]): Uint8Array {
    const parts: Record<string, Uint8Array> = {
      'xl/workbook.xml': strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(({ name }, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="r${index + 1}"/>`).join('')}</sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="r${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`),
    };
    sheets.forEach(({ value, address = 'A1' }, index) => {
      const cell = value === null ? `<c r="${address}"/>` : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
      parts[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="${address.replace(/^[A-Z]+/u, '')}">${cell}</row></sheetData></worksheet>`);
    });
    return zipSync(parts);
  }

  function prepareSourceFixture(file: TFile, source: sourceAccess.SourceText, preparation?: SourcePreparationConfig): sourceAccess.SourceText {
    expect(preparation?.path).toBe(file.path);
    if (!preparation) throw new Error('Synthetic preparation config is required.');
    const result = prepareSourceTextRust(file.extension, { ...source, ok: true, format: file.extension, reason: null }, preparation);
    expect(result?.ok).toBe(true);
    if (!result?.prepared) throw new Error('Synthetic Rust source preparation failed.');
    return { ...source, prepared: result.prepared };
  }

  it('decode 실패는 processed/failed이며 durable completed와 속도 표본을 늘리지 않는다', async () => {
    const vault = createVault(new Map([['good.md', 'alpha source'], ['bad.md', 'invalid']]), new Map([['bad.md', new Uint8Array([239, 187, 191, 226, 130])]]));
    const progress: RagIndexingProgressSnapshot[] = [];
    const vectors = new MemoryVectorStore();
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, createRagConfig(), createChatConfig());
    const result = await indexer.indexVault({ onProgress: (snapshot) => progress.push(snapshot) });
    expect(result).toMatchObject({ indexed: 1, failed: 1, skipped: 1 });
    expect(progress.at(-1)).toMatchObject({ totalFiles: 2, completedFiles: 1, processedFiles: 2, failedFiles: 1, partialFiles: 0, skipped: 1, stage: 'settled' });
    expect(progress.at(-1)?.completedFileActualChunkCounts).toHaveLength(1);
    expect(await vectors.getIndexedFilePaths()).toEqual(['good.md']);
  });

  it.each(['memory', 'indexeddb'] as const)('%s에서 같은 XLSX 본문의 구간이 바뀌면 corpus와 vector 청크를 함께 교체한다', async (kind) => {
    const filePath = 'segments.xlsx';
    const binaries = new Map([[filePath, xlsxFixture([{ name: 'First', value: 'alpha\n\nbeta' }])]]);
    const vault = createVault(new Map([[filePath, 'container']]), binaries);
    const name = `xlsx-segments-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    const vectors: VectorStore = kind === 'memory' ? new MemoryVectorStore() : new IndexedDbVectorStore(name);
    const corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig(), undefined, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: async (path) => { await corpus.removeByFilePath(path); },
      replaceBatchFileDocuments: (entries) => corpus.replaceBatchFileDocuments(entries),
    });
    try {
      await indexer.indexFile(vault.getFiles()[0]);
      const hash = (await vectors.getFileIndexRecord(filePath))?.contentHash;
      expect(await corpus.getDocuments()).toHaveLength(1);
      binaries.set(filePath, xlsxFixture([{ name: 'First', value: 'alpha' }, { name: 'Second', value: 'beta' }]));
      vault.getFiles()[0].stat.mtime++;
      await indexer.indexFile(vault.getFiles()[0]);
      expect((await vectors.getFileIndexRecord(filePath))?.contentHash).toBe(hash);
      const documents = await corpus.getDocuments();
      expect(documents).toHaveLength(2);
      expect((await vectors.getEntries()).map(({ id }) => id).sort()).toEqual(documents.map(({ id }) => id).sort());
      expect(embedBatch).toHaveBeenCalledTimes(2);
      expect(await vectors.readPendingWriteRecovery?.() ?? []).toEqual([]);
    } finally { vectors.close(); corpus.close(); }
  });

  it.each(['memory', 'indexeddb'] as const)('%s에서 metadata-only XLSX 갱신도 빈 파일 원장을 보존하며 가짜 벡터를 만들지 않는다', async (kind) => {
    const filePath = 'empty.xlsx';
    const binaries = new Map([[filePath, xlsxFixture([{ name: 'First', value: null }])]]);
    const vault = createVault(new Map([[filePath, 'container']]), binaries);
    const name = `xlsx-empty-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    const vectors = kind === 'memory' ? new MemoryVectorStore() : new IndexedDbVectorStore(name);
    const corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig(), undefined, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: async (path) => { await corpus.removeByFilePath(path); },
      replaceBatchFileDocuments: (entries) => corpus.replaceBatchFileDocuments(entries),
    });
    const observations: RagIndexingProgressSnapshot[] = [];
    try {
      await indexer.indexFile(vault.getFiles()[0], { onProgress: (snapshot) => observations.push(snapshot) });
      expect(observations.at(-1)).toMatchObject({ completedFiles: 1, processedFiles: 1, skipped: 0 });
      expect(observations.at(-1)?.pipeline).toMatchObject({ lifecycle: 'finalizing', processedFiles: 1, processedEstimatedChunks: 1, processedPlannedChunks: 0, windowSamples: [], inferenceSamples: [] });
      const before = await vectors.getFileIndexRecord(filePath);
      expect(before).toMatchObject({ vectorCount: 0, hasCompleteMetadata: true });
      binaries.set(filePath, xlsxFixture([{ name: 'Renamed', value: null, address: 'C3' }]));
      vault.getFiles()[0].stat.mtime++;
      observations.length = 0;
      await indexer.indexFile(vault.getFiles()[0], { onProgress: (snapshot) => observations.push(snapshot) });
      expect(observations.at(-1)).toMatchObject({ completedFiles: 1, processedFiles: 1, skipped: 0 });
      expect(observations.at(-1)?.pipeline?.windowSamples).toEqual([]);
      const after = await vectors.getFileIndexRecord(filePath);
      expect(after).toMatchObject({ vectorCount: 0, hasCompleteMetadata: true, sourceMetadata: { metadataParts: [{ label: 'Renamed', locator: { cells: [{ address: 'C3' }] } }] } });
      expect(after?.sourceMetadata?.segments).toEqual([]);
      expect(after?.sourceMetadata?.metadataParts?.[0]).not.toHaveProperty('startLine');
      expect(after?.sourceMetadata?.metadataParts?.[0]).not.toHaveProperty('endLine');
      expect(after?.sourceMetadataHash).not.toBe(before?.sourceMetadataHash);
      expect(await vectors.getIndexedFilePaths()).toEqual([filePath]);
      expect(await vectors.getEntries()).toEqual([]);
      expect(await corpus.getFileIndexRecords()).toEqual([expect.objectContaining({ filePath, sourceMtime: vault.getFiles()[0].stat.mtime, sourceSize: vault.getFiles()[0].stat.size, contentHash: '811c9dc5', sourceMetadataHash: after?.sourceMetadataHash, vectorCount: 0, hasCompleteMetadata: true })]);
      expect(await corpus.getDocuments()).toEqual([]);
      expect(embedBatch).not.toHaveBeenCalled();
    } finally { vectors.close(); corpus.close(); }
  });

  it('위치 원장만 바뀌면 파일 metadata를 갱신하고 같은 문장을 재임베딩하지 않는다', async () => {
    const vault = createVault(new Map([['location.docx', 'synthetic container']]));
    let address = 'A1';
    const reader = vi.spyOn(sourceAccess, 'readSourceText').mockImplementation((_vault, file, options) => Promise.resolve(prepareSourceFixture(file, { text: 'alpha evidence', segments: [{ label: 'Sheet', startLine: 0, endLine: 0, sourcePart: 'sheet.xml', locator: { sheetName: 'Sheet', cells: [{ address, startLine: 0, endLine: 0 }], aliases: [{ sourcePart: 'chart.xml', address, reference: `Sheet!${address}`, cacheIndex: 0, nodePath: '/chart/v' }] } }], metadataParts: [{ label: 'Empty', sourcePart: 'empty.xml', locator: { cells: [{ address: 'B2', blank: true }] } }] }, options?.preparation)));
    const vectors = new MemoryVectorStore();
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig());
    try {
      await indexer.indexFile(vault.getFiles()[0]);
      const first = await vectors.getFileIndexRecord('location.docx');
      address = 'B9';
      await indexer.indexFile(vault.getFiles()[0]);
      const second = await vectors.getFileIndexRecord('location.docx');
      expect(embedBatch).toHaveBeenCalledOnce();
      expect(second?.contentHash).toBe(first?.contentHash);
      expect(second?.sourceMetadataHash).not.toBe(first?.sourceMetadataHash);
      expect(second?.sourceMetadata?.segments[0]).toMatchObject({ locator: { cells: [{ address: 'B9' }], aliases: [{ address: 'B9' }] } });
      expect(second?.sourceMetadata?.metadataParts).toHaveLength(1);
      expect((await vectors.getEntries())[0].vector).toEqual([1, 0]);
    } finally { reader.mockRestore(); }
  });

  it('terminal partial은 같은 revision의 자동 재준비를 막고 수동·변경 revision을 허용한다', async () => {
    const vault = createVault(new Map([['partial.pdf', 'synthetic PDF']]));
    const reader = vi.spyOn(sourceAccess, 'readSourceText').mockImplementation((_vault, file, options) => Promise.resolve(prepareSourceFixture(file, { text: 'valid page evidence', segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }], completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } }, options?.preparation)));
    const vectors = new MemoryVectorStore();
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig());
    const progress: number[] = [];
    const observations: RagIndexingProgressSnapshot[] = [];
    try {
      expect(await indexer.indexVault({ onProgress: (snapshot) => { progress.push(snapshot.completedFiles); observations.push(snapshot); } })).toMatchObject({ indexed: 0, partial: 1 });
      expect(observations.at(-1)?.pipeline).toMatchObject({ lifecycle: 'partial', processedFiles: 1, partialFiles: 1, failedFiles: 0, windowSamples: [], inferenceSamples: [] });
      expect(observations.at(-1)?.pipeline?.processedPlannedChunks).toBe(observations.at(-1)?.totalPlannedChunks);
      expect(progress.every((count) => count === 0)).toBe(true);
      expect((await vectors.getFileIndexRecord('partial.pdf'))?.sourceMetadata?.completeness?.status).toBe('partial');
      reader.mockClear();
      await indexer.indexPending({ automaticRecovery: true });
      expect(reader).not.toHaveBeenCalled();
      expect(await indexer.indexFile(vault.getFiles()[0])).toMatchObject({ indexed: 0, partial: 1 });
      expect(reader).toHaveBeenCalled();
      expect(embedBatch).toHaveBeenCalledOnce();
      reader.mockClear();
      vault.getFiles()[0].stat.mtime += 1;
      await indexer.indexPending({ automaticRecovery: true });
      expect(reader).toHaveBeenCalled();
      expect((await vectors.getFileIndexRecord('partial.pdf'))?.sourceMetadata?.completeness?.status).toBe('partial');
    } finally { reader.mockRestore(); }
  });

  it.each(['embedding', 'vector'] as const)('corpus-only partial의 %s 실패는 재시작 자동 복구에서 추출·모델 재호출 없이 debt를 보존한다', async (phase) => {
    const vault = createEventVault(new Map([['partial.pdf', 'synthetic PDF']]));
    const reader = vi.spyOn(sourceAccess, 'readSourceText').mockImplementation((_vault, file, options) => Promise.resolve(prepareSourceFixture(file, { text: 'synthetic valid page', segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }], completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] } }, options?.preparation)));
    const name = `partial-debt-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    let vectors = new IndexedDbVectorStore(name);
    let corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    const rag = createRagConfig(), chat = createChatConfig();
    const embedBatch = vi.fn((texts: string[]) => phase === 'embedding' ? Promise.reject(new Error('synthetic embedding rejection')) : Promise.resolve(texts.map(() => [1, 0])));
    const provider = { embed: () => Promise.resolve([1, 0]), embedBatch };
    const makeIndexer = () => new VaultIndexer(vault, vectors, provider, rag, chat, undefined, undefined, new VaultDocumentCorpus(vault, corpus, () => rag, () => chat, appLogger));
    if (phase === 'vector') vi.spyOn(vectors['db'].fileIndex, 'bulkPut').mockRejectedValue(new Error('synthetic vector rejection'));
    try {
      const first = makeIndexer();
      expect(await first.indexVault()).toMatchObject({ indexed: 0, failed: 1 });
      expect(embedBatch).toHaveBeenCalled();
      expect(first.getFailedFileReasons()).toEqual([{ path: 'partial.pdf', reason: phase === 'embedding' ? 'synthetic embedding rejection' : 'synthetic vector rejection' }]);
      const rows = await corpus.getFileIndexRecords();
      expect(rows[0]?.sourceMetadata?.completeness?.status).toBe('partial');
      const raw = await corpus.getSourceBodyBlocks('partial.pdf', 0, 8);
      expect(raw.map((block) => block.text).join('')).toBe('synthetic valid page');
      const corpusReceipt = await corpus.getDurabilityReceipt();
      const vectorReceipt = await vectors.getDurabilityCheckpoint();
      expect(vectorReceipt.pendingWrites).toBe(0);
      expect(await vectors.getEntries()).toEqual([]);
      const owners = await vectors.getMetaValue<unknown>('write-recovery-requests:v1:owners');
      vectors.close(); corpus.close();
      vectors = new IndexedDbVectorStore(name); corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
      const restarted = makeIndexer();
      disposeRagFileEligibilityCache(vault);
      reader.mockClear(); embedBatch.mockClear();
      const bodyReads = vi.spyOn(corpus, 'getSourceBodyBlocks');
      const state = await restarted.getAutomaticRecoveryPendingState();
      expect(state).toMatchObject({ pendingDocumentCount: 1, actionableDocumentCount: 0, deferredDocumentCount: 1, deferredPaths: ['partial.pdf'] });
      expect(bodyReads).not.toHaveBeenCalled();
      await restarted.indexPending({ automaticRecovery: true });
      expect(reader).not.toHaveBeenCalled();
      expect(embedBatch).not.toHaveBeenCalled();
      expect(await vectors.getEntries()).toEqual([]);
      expect(await vectors.getFileIndexRecord('partial.pdf')).toBeNull();
      expect(await vectors.readPendingWriteRecovery()).toEqual(['partial.pdf']);
      expect(await corpus.getFileIndexRecords()).toEqual(rows);
      expect(await corpus.getSourceBodyBlocks('partial.pdf', 0, 8)).toEqual(raw);
      expect(await corpus.getDurabilityReceipt()).toEqual(corpusReceipt);
      expect(await vectors.getDurabilityCheckpoint()).toEqual(vectorReceipt);
      expect(await vectors.getMetaValue<unknown>('write-recovery-requests:v1:owners')).toEqual(owners);
      if (phase === 'vector') vi.spyOn(vectors['db'].fileIndex, 'bulkPut').mockRejectedValue(new Error('synthetic vector rejection'));
      await expect(restarted.indexFile(vault.getFiles()[0])).rejects.toThrow(phase === 'embedding' ? 'synthetic embedding rejection' : 'synthetic vector rejection');
      expect(reader).toHaveBeenCalled();
      expect(embedBatch).toHaveBeenCalled();
      reader.mockClear(); embedBatch.mockClear();
      vault.getFiles()[0].stat.mtime++;
      expect(await restarted.indexPending({ automaticRecovery: true })).toMatchObject({ indexed: 0, failed: 1 });
      expect(reader).toHaveBeenCalled();
      expect(embedBatch).toHaveBeenCalled();
    } finally { reader.mockRestore(); vectors.close(); corpus.close(); }
  });

  it('같은 stat의 source 사건은 실제 추출 cache를 우회해 fresh lexical 본문을 저장한 뒤에만 해제한다', async () => {
    const path = 'same-stat-partial.pdf';
    const contents = new Map([[path, '%PDF-1.7\nsynthetic-A\n%%EOF']]);
    const vault = createEventVault(contents);
    let body = 'synthetic page A';
    const extract = vi.spyOn(pdfSource, 'extractPdfSourceText').mockImplementation(() => Promise.resolve({
      text: body, segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }],
      completeness: { status: 'partial', pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' }], failures: [] },
    }));
    const name = `partial-source-event-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    const vectors = new IndexedDbVectorStore(name), corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    const rag = createRagConfig(), chat = createChatConfig();
    const embedBatch = vi.fn(() => Promise.reject(new Error('synthetic embedding rejection')));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, rag, chat, undefined, undefined, new VaultDocumentCorpus(vault, corpus, () => rag, () => chat, appLogger));
    try {
      expect(await indexer.indexVault()).toMatchObject({ failed: 1 });
      expect(extract).toHaveBeenCalledOnce();
      const stat = { ...vault.getFiles()[0].stat };
      expect((await corpus.getSourceBodyBlocks(path, 0, 8)).map((block) => block.text).join('')).toBe('synthetic page A');
      body = 'synthetic page B'; contents.set(path, '%PDF-1.7\nsynthetic-B\n%%EOF');
      indexer.invalidateAutomaticRecoverySource(path);
      expect(await indexer.indexPending({ automaticRecovery: true })).toMatchObject({ failed: 1 });
      expect(extract).toHaveBeenCalledTimes(2);
      expect(vault.getFiles()[0].stat).toEqual(stat);
      expect((await corpus.getSourceBodyBlocks(path, 0, 8)).map((block) => block.text).join('')).toBe('synthetic page B');
      expect(indexer.getAutomaticRecoveryInvalidatedPaths()).not.toContain(path);
      expect(await indexer.getAutomaticRecoveryPendingState()).toMatchObject({ pendingDocumentCount: 1, actionableDocumentCount: 0, deferredDocumentCount: 1 });
      expect(await vectors.readPendingWriteRecovery()).toEqual([path]);
      expect(await vectors.getFileIndexRecord(path)).toBeNull();
      expect(embedBatch).toHaveBeenCalledTimes(2);
    } finally { extract.mockRestore(); vectors.close(); corpus.close(); }
  });

  it.each(['legacy', 'known-body', 'known-metadata', 'source-event', 'complete-source'] as const)('자동 partial admission은 %s를 억제하지 않는다', async (boundary) => {
    const vault = createEventVault(new Map([['boundary.pdf', 'synthetic PDF']]));
    const partial = boundary !== 'complete-source';
    const reader = vi.spyOn(sourceAccess, 'readSourceText').mockImplementation((_vault, file, options) => Promise.resolve(prepareSourceFixture(file, { text: 'synthetic boundary page', segments: [{ label: 'Page 1', startLine: 0, endLine: 0 }], completeness: { status: partial ? 'partial' : 'complete', pageCount: 2, missingPageCount: partial ? 1 : 0, missingPages: partial ? [{ pageNumber: 2, reason: 'page-error' }] : [], failures: [] } }, options?.preparation)));
    const name = `partial-boundary-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    const vectors = new IndexedDbVectorStore(name), corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    const rag = createRagConfig(), chat = createChatConfig();
    const sourceCorpus = new VaultDocumentCorpus(vault, corpus, () => rag, () => chat, appLogger);
    const embedBatch = vi.fn(() => Promise.reject(new Error('synthetic embedding rejection')));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, rag, chat, undefined, undefined, sourceCorpus);
    try {
      expect(await indexer.indexVault()).toMatchObject({ indexed: 0, failed: 1 });
      const records = await corpus.getFileIndexRecords();
      if (boundary === 'legacy') vi.spyOn(sourceCorpus, 'getFileIndexRecords').mockResolvedValue(records.map((record) => ({ ...record, sourceMetadataHash: undefined })));
      if (boundary === 'known-body' || boundary === 'known-metadata') beginRagPreparedSourceProbe(vault, vault.getFiles()[0])({ text: 'synthetic boundary page', contentHash: boundary === 'known-body' ? '1234abcd' : records[0].contentHash, sourceMetadataHash: boundary === 'known-metadata' ? '1234abcd' : records[0].sourceMetadataHash });
      if (boundary === 'source-event') { indexer.invalidateAutomaticRecoverySource('boundary.pdf'); await vault.emitModify(vault.getFiles()[0]); }
      reader.mockClear(); embedBatch.mockClear();
      expect(await indexer.getAutomaticRecoveryPendingState()).toMatchObject({ pendingDocumentCount: 1, actionableDocumentCount: 1, deferredDocumentCount: 0 });
      expect(reader).not.toHaveBeenCalled();
      await indexer.indexPending({ automaticRecovery: true });
      expect(reader).toHaveBeenCalled();
      expect(embedBatch).toHaveBeenCalled();
      expect(await vectors.readPendingWriteRecovery()).toEqual(['boundary.pdf']);
    } finally { reader.mockRestore(); vectors.close(); corpus.close(); }
  });

  it.each(['source-epoch', 'owner', 'cancel', 'host-owner'] as const)('metadata I/O 뒤 %s가 바뀌면 오래된 자동 계획을 폐기한다', async (boundary) => {
    const vault = createEventVault(new Map([['stale.md', 'synthetic current source']]));
    const name = `stale-admission-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    const vectors = new IndexedDbVectorStore(name);
    const rag = createRagConfig(), chat = createChatConfig();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const records = vi.fn(async () => { await gate; return []; });
    const controller = new AbortController();
    let current = true;
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, rag, chat, undefined, undefined, { refreshFile: () => Promise.resolve(), removeFile: () => Promise.resolve(), replaceBatchFileDocuments: () => Promise.resolve(), getFileIndexRecords: records });
    const planning = indexer.getAutomaticRecoveryPendingState({ signal: controller.signal, isCurrent: () => current });
    const rejected = expect(planning).rejects.toBeInstanceOf(IndexingCancelledError);
    try {
      await vi.waitFor(() => expect(records).toHaveBeenCalledOnce());
      if (boundary === 'source-epoch') indexer.invalidateAutomaticRecoverySource('stale.md');
      if (boundary === 'owner') await indexer.indexFile(vault.getFiles()[0]);
      if (boundary === 'cancel') controller.abort();
      if (boundary === 'host-owner') current = false;
      const before = await vectors.getFileIndexRecords();
      release(); await rejected;
      expect(await vectors.getFileIndexRecords()).toEqual(before);
    } finally { release(); await rejected; vectors.close(); }
  });

  it('교차 파일 배치만 실패하면 개별 파일 격리로 모든 원문·벡터 준비를 계속한다', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const contents = new Map(Array.from({ length: 20 }, (_, index) => [`isolation-${index}.md`, `synthetic isolation evidence ${index}`]));
    const vault = createVault(contents);
    const name = `prefetch-isolation-${crypto.randomUUID()}`;
    vectorDbNames.add(name); vectorDbNames.add(`${name}-corpus`);
    const vectors = new IndexedDbVectorStore(name);
    const corpus = new IndexedDbDocumentCorpusStore(`${name}-corpus`);
    let rejectedBatches = 0;
    let preparedFiles = 0;
    const embedBatch = vi.fn((texts: string[]) => {
      if (texts.length > 1) { rejectedBatches++; return Promise.reject(new Error('Synthetic multi-input batch rejected.')); }
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig(), undefined, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: async (path) => { await corpus.removeByFilePath(path); },
      replaceBatchFileDocuments: async (entries) => {
        await corpus.replaceBatchFileDocuments(entries);
        preparedFiles += entries.length;
        if (preparedFiles % 2 === 0) now += 13;
      },
    });
    const observations: RagIndexingProgressSnapshot[] = [];
    try {
      expect(await indexer.indexVault({ maxEmbeddingBatchSize: 8, onProgress: (snapshot) => observations.push(snapshot) })).toMatchObject({ indexed: 20, skipped: 0 });
      expect(rejectedBatches).toBe(1);
      const firstBoundary = observations.find((snapshot) => snapshot.event === 'window-complete');
      expect(firstBoundary?.pipeline?.windowSamples).toEqual([]);
      expect(firstBoundary?.pipeline?.processedFiles).toBe(2);
      expect(observations.at(-1)?.pipeline?.windowSamples).toHaveLength(9);
      expect(observations.at(-1)?.pipeline?.lifecycle).toBe('finalizing');
      expect(indexer.getFailedFilePaths()).toEqual([]);
      expect(await vectors.getIndexedFilePaths()).toHaveLength(20);
      expect(await corpus.getIndexedFilePaths()).toHaveLength(20);
      expect(await vectors.readPendingWriteRecovery()).toEqual([]);
    } finally { clock.mockRestore(); vectors.close(); corpus.close(); }
  });

  it('임베딩이 영구 대기해도 corpus와 BM25는 재시작으로 읽을 수 있고 취소는 recovery를 보존한다', async () => {
    const vault = createVault(new Map([['durable.md', 'alpha durable source']]));
    const name = `prepared-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    const vectors = new IndexedDbVectorStore(name);
    const corpusName = `${name}-corpus`;
    vectorDbNames.add(corpusName);
    const corpus = new IndexedDbDocumentCorpusStore(corpusName);
    const bm25Name = createBm25DbName();
    const bm25 = new IndexedDbBM25Index(bm25Name);
    await bm25.load();
    const controller = new AbortController();
    const embedBatch = vi.fn(() => new Promise<number[][]>(() => undefined));
    const completions: number[] = [];
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig(), bm25, undefined, {
      refreshFile: () => Promise.resolve(),
      removeFile: async (path) => { await corpus.removeByFilePath(path); },
      replaceBatchFileDocuments: (entries) => corpus.replaceBatchFileDocuments(entries),
    });
    const indexing = indexer.indexVault({ signal: controller.signal, onProgress: (snapshot) => completions.push(snapshot.completedFiles) });
    const stopped = expect(indexing).rejects.toBeInstanceOf(IndexingCancelledError);
    try {
      await vi.waitFor(() => expect(embedBatch).toHaveBeenCalledOnce());
      expect((await corpus.getDocuments())[0]?.text).toBe('alpha durable source');
      const reloaded = new IndexedDbBM25Index(bm25Name);
      try {
        await reloaded.load();
        expect([...reloaded.search('durable').keys()]).toHaveLength(1);
      } finally { reloaded.close(); }
      expect(completions.every((value) => value === 0)).toBe(true);
      expect(await vectors.readPendingWriteRecovery()).toEqual(['durable.md']);
      controller.abort();
      await stopped;
      expect(await vectors.getEntries()).toEqual([]);
      expect(await vectors.readPendingWriteRecovery()).toEqual(['durable.md']);
    } finally { controller.abort(); await stopped; corpus.close(); bm25.close(); vectors.close(); }
  });

  it.each(['modify', 'exclude', 'delete', 'cancel'] as const)('vector commit 대기 중 %s는 내구 완료와 recovery 해제를 게시하지 않는다', async (change) => {
    const contents = new Map([['checkpoint.md', 'alpha checkpoint']]);
    const vault = createVault(contents);
    const name = `checkpoint-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class DeferredStore extends IndexedDbVectorStore {
      override async replaceBatchFileEntries(batches: Parameters<IndexedDbVectorStore['replaceBatchFileEntries']>[0]): Promise<void> {
        await gate;
        await super.replaceBatchFileEntries(batches);
      }
    }
    const vectors = new DeferredStore(name);
    const controller = new AbortController();
    const completions: number[] = [];
    const commit = vi.spyOn(vectors, 'replaceBatchFileEntries');
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, createRagConfig(), createChatConfig());
    const result = indexer.indexVault({ signal: controller.signal, onProgress: (snapshot) => completions.push(snapshot.completedFiles) }).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
      expect(completions.every((count) => count === 0)).toBe(true);
      if (change === 'modify') contents.set('checkpoint.md', 'bravo checkpoint');
      if (change === 'exclude') contents.set('checkpoint.md', '---\nsuperpower-inside-exclude: true\n---\nalpha checkpoint');
      if (change === 'delete') vi.spyOn(vault, 'getAbstractFileByPath').mockReturnValue(null);
      if (change === 'cancel') controller.abort();
      release();
      const settled = await result;
      if (change === 'cancel') expect(settled).toBeInstanceOf(IndexingCancelledError);
      else expect(settled).toMatchObject({ indexed: 0, failed: 1 });
      expect(completions.every((count) => count === 0)).toBe(true);
      expect(await vectors.readPendingWriteRecovery()).toEqual(['checkpoint.md']);
    } finally { release(); await result; vectors.close(); }
  });

  it('늦은 orphan 정리가 새 owner가 쓴 행과 복구 원장을 지우지 않는다', async () => {
    const contents = new Map<string, string>();
    const vault = createVault(contents);
    const name = `orphan-owner-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    const vectors = new IndexedDbVectorStore(name);
    await vectors.add([createEntry('resurrect.md')]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const remove = vi.fn(() => gate);
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, createRagConfig(), createChatConfig(), undefined, undefined, { refreshFile: () => Promise.resolve(), removeFile: remove, replaceBatchFileDocuments: () => Promise.resolve() });
    const maintenance = indexer.indexPending();
    try {
      await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
      contents.set('resurrect.md', 'new owner evidence');
      const current = createFile('resurrect.md', 2000, 'new owner evidence'.length);
      vault.getFiles().push(current);
      expect(await indexer.indexFile(current)).toMatchObject({ indexed: 1 });
      release();
      await maintenance;
      expect((await vectors.getEntries())[0]?.metadata.text).toBe('new owner evidence');
      expect(await vectors.readPendingWriteRecovery()).toEqual([]);
    } finally { release(); await maintenance; vectors.close(); }
  });

  it.each(['corpus', 'bm25', 'vector'] as const)('%s 쓰기 실패는 이전 내구 자료와 재시작 recovery 원장을 보존한다', async (phase) => {
    const vault = createVault(new Map([['failure.md', 'new alpha source']]));
    const name = `phase-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    const vectors = new IndexedDbVectorStore(name);
    await vectors.add([createEntry('failure.md')]);
    const corpusName = `${name}-corpus`;
    vectorDbNames.add(corpusName);
    const corpus = new IndexedDbDocumentCorpusStore(corpusName);
    await corpus.replaceFileDocuments('failure.md', buildSourceDocuments(vault.getFiles()[0], 'legacy corpus evidence', createRagConfig()));
    const bm25Name = createBm25DbName();
    const bm25 = new IndexedDbBM25Index(bm25Name);
    await bm25.load();
    bm25.addDocument('legacy', 'legacy lexical evidence', 'failure.md');
    await bm25.flush();
    const corpusWrite = vi.fn((entries: Parameters<IndexedDbDocumentCorpusStore['replaceBatchFileDocuments']>[0]) => phase === 'corpus' ? Promise.reject(new Error('corpus-write-failed')) : corpus.replaceBatchFileDocuments(entries));
    if (phase === 'bm25') vi.spyOn(bm25, 'flush').mockRejectedValue(new Error('bm25-write-failed'));
    if (phase === 'vector') vi.spyOn(vectors, 'replaceBatchFileEntries').mockRejectedValue(new Error('vector-write-failed'));
    const embedBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [1, 0])));
    const indexer = new VaultIndexer(vault, vectors, { embed: () => Promise.resolve([1, 0]), embedBatch }, createRagConfig(), createChatConfig(), bm25, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: () => Promise.resolve(), replaceBatchFileDocuments: corpusWrite,
    });
    try {
      const outcome = await indexer.indexVault().catch((error: unknown) => error);
      expect(outcome).toMatchObject({ indexed: 0, failed: 1 });
      expect(indexer.getFailedFileReasons()).toEqual([{ path: 'failure.md', reason: `${phase}-write-failed` }]);
      if (phase !== 'vector') expect(embedBatch).not.toHaveBeenCalled();
      expect(await vectors.readPendingWriteRecovery()).toEqual(['failure.md']);
    } finally { vectors.close(); bm25.close(); corpus.close(); }
    const reopened = new IndexedDbVectorStore(name);
    const reopenedCorpus = new IndexedDbDocumentCorpusStore(corpusName);
    const reopenedBm25 = new IndexedDbBM25Index(bm25Name);
    try {
      expect(await reopened.readPendingWriteRecovery()).toEqual(['failure.md']);
      expect((await reopened.getEntries())[0]?.metadata.text).toBe('old');
      expect((await reopenedCorpus.getDocuments())[0]?.text).toBe(phase === 'corpus' ? 'legacy corpus evidence' : 'new alpha source');
      await reopenedBm25.load();
      expect((await reopenedBm25.getCorpusDocumentsBySourcePaths(['failure.md']))[0]?.text).toBe(phase === 'vector' ? 'new alpha source' : 'legacy lexical evidence');
    } finally { reopened.close(); reopenedCorpus.close(); reopenedBm25.close(); }
  });
});


describe('새 pipeline 관측 계약', () => {
  it('초기 관측은 같은 소수 monotonic job 시작보다 앞서지 않는다', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => { now += 0.125; return now; });
    const vault = createVault(new Map([['fractional-clock.md', '']]));
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const provider: EmbeddingProvider = { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) };
    try {
      const indexer = new VaultIndexer(vault, new MemoryVectorStore(), provider, createRagConfig(), createChatConfig());
      await indexer.indexFile(vault.getFiles()[0], { onProgress: (snapshot) => snapshots.push(snapshot) });
      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) expect(snapshot.pipeline?.observedAtMs).toBeGreaterThanOrEqual(snapshot.startedAtMs);
    } finally { vi.restoreAllMocks(); }
  });

  it('0청크 내구 완료도 성공 예상량 원장을 정착하며 증명 입력과 모순되지 않는다', async () => {
    const vault = createVault(new Map([['zero-chunk-ledger.md', '']]));
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const store = new MemoryVectorStore();
    const provider: EmbeddingProvider = { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) };
    await new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig()).indexFile(vault.getFiles()[0], { onProgress: (snapshot) => snapshots.push(snapshot) });
    const settled = snapshots.at(-1);
    if (!settled?.pipeline) throw new Error('완료 원장 관측이 필요합니다.');
    expect(settled.completedFiles).toBe(1);
    expect(settled.completedEstimatedChunks).toBe(settled.totalEstimatedChunks);
    expect(settled.completedPlannedChunks).toBe(settled.totalPlannedChunks);
    expect(await store.getEntries()).toEqual([]);
    expect(settled.pipeline.windowSamples).toEqual([]);
    expect(planRagIndexingEtaRust({ ...settled, pipeline: { ...settled.pipeline, lifecycle: 'complete' } })).toMatchObject({ lifecycle: 'complete', remainingMs: 0 });
  });

  it('총 파일 수는 청크 계획이 끝나기 전에 알려지고 0 wall 표본은 만들지 않는다', async () => {
    let now = 100;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => { now += 20; return now; });
    const vault = createVault(new Map([['known-first.md', 'alpha evidence'], ['known-second.md', 'beta evidence']]));
    const provider: EmbeddingProvider = { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) };
    const snapshots: RagIndexingProgressSnapshot[] = [];
    try {
      await new VaultIndexer(vault, new MemoryVectorStore(), provider, createRagConfig(), createChatConfig()).indexVault({ onProgress: (snapshot) => snapshots.push(snapshot) });
      const first = snapshots.find((snapshot) => snapshot.event === 'window-complete' && snapshot.processedFiles === 1);
      expect(first).toMatchObject({ totalFiles: 2, planningComplete: false, pipeline: { totalKnown: true } });
      clock.mockReturnValue(now);
      const constant: RagIndexingProgressSnapshot[] = [];
      await new VaultIndexer(vault, new MemoryVectorStore(), provider, createRagConfig(), createChatConfig()).indexVault({ onProgress: (snapshot) => constant.push(snapshot) });
      expect(constant.at(-1)?.pipeline?.windowSamples).toEqual([]);
    } finally { vi.restoreAllMocks(); }
  });

  it.each(['observed', 'cache-only', 'cache-mixed-dedupe', 'remote', 'missing', 'mixed', 'bounded', 'backend-change'] as const)('실제 dispatch와 ACK만 물리량으로 연결하고 복사·상한을 지킨다 (%s)', async (mode) => {
    const content = mode === 'cache-mixed-dedupe' ? ['repeat alpha text', 'repeat alpha text', 'unique beta text'].join('\n\n') : 'independent synthetic evidence';
    const config = { ...createRagConfig(), chunkSize: mode === 'cache-mixed-dedupe' ? 20 : 100 };
    const vault = createVault(new Map([['synthetic-observation.md', content]]));
    const file = vault.getFiles()[0];
    const chunks = chunkMarkdown(content, config.chunkSize, config.overlap);
    const uniqueInputs = [...new Set(chunks.map((chunk) => buildSearchText(file, chunk)))];
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts, options) => {
        const count = mode === 'bounded' ? 70 : mode === 'backend-change' || mode === 'mixed' ? 2 : mode === 'remote' ? 0 : 1;
        for (let index = 0; index < count; index++) {
          options?.onInferenceDispatch?.();
          if (mode !== 'missing' && !(mode === 'mixed' && index === 1)) options?.onInferenceSample?.({ backend: mode === 'backend-change' && index === 1 ? 'webgpu' : 'cpu', workUnits: mode === 'cache-mixed-dedupe' ? texts.length : 1, durationMs: 2, endedAtMs: performance.now() });
        }
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    };
    const cached = new CachedEmbeddingProvider(provider, 'synthetic-eta-only', { persistent: false });
    if (mode === 'cache-only' || mode === 'cache-mixed-dedupe') await cached.embedBatch([uniqueInputs[0]]);
    const indexer = new VaultIndexer(vault, new MemoryVectorStore(), cached, config, createChatConfig());
    await indexer.indexVault({ onProgress: (snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.event === 'window-complete' && snapshot.pipeline?.inferenceSamples.length) {
        Reflect.set(snapshot.pipeline.inferenceSamples[0], 'workUnits', 9999);
        Reflect.set(snapshot.pipeline.windowSamples[0] ?? {}, 'logicalChunks', 9999);
      }
    } });
    const pipeline = snapshots.at(-1)?.pipeline;
    expect(pipeline).toBeDefined();
    expect(pipeline?.lifecycle).toBe('finalizing');
    expect(pipeline?.processedFiles).toBe(1);
    if (mode === 'backend-change') {
      expect(pipeline?.windowSamples).toEqual([]);
      expect(pipeline?.inferenceSamples).toEqual([]);
    } else {
      expect(pipeline?.windowSamples).toHaveLength(1);
      expect(pipeline?.windowSamples[0]).toMatchObject({ logicalChunks: chunks.length, physicalWorkUnits: mode === 'observed' ? 1 : mode === 'bounded' ? 70 : mode === 'cache-mixed-dedupe' ? uniqueInputs.length - 1 : null });
      expect(pipeline?.inferenceSamples.length).toBeLessThanOrEqual(64);
      if (mode === 'bounded') expect(pipeline?.inferenceSamples).toHaveLength(64);
      const finalCopy = snapshots.at(-1)!;
      if (pipeline?.inferenceSamples.length) {
        expect(snapshots.at(-2)?.pipeline?.inferenceSamples[0]?.workUnits).toBe(9999);
        expect(finalCopy.pipeline?.inferenceSamples[0]?.workUnits).toBe(mode === 'cache-mixed-dedupe' ? uniqueInputs.length - 1 : 1);
        expect(finalCopy.pipeline?.windowSamples[0]?.logicalChunks).toBe(chunks.length);
      }
    }
    if (mode === 'cache-mixed-dedupe') {
      expect(chunks.length).toBeGreaterThan(uniqueInputs.length);
      expect(uniqueInputs.length).toBeGreaterThan(1);
    }
    cached.close();
    expect(pipeline?.backend).toBe(mode === 'cache-only' || mode === 'remote' || mode === 'missing' ? 'unknown' : mode === 'backend-change' ? 'webgpu' : 'cpu');
  });

  it('실패 window는 성공 파일이 섞여도 속도 표본을 채택하지 않고 종료량은 제거한다', async () => {
    const vault = createVault(new Map([['good.md', 'alpha source'], ['bad.md', 'invalid']]), new Map([['bad.md', new Uint8Array([239, 187, 191, 226, 130])]]));
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const indexer = new VaultIndexer(vault, new MemoryVectorStore(), { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, createRagConfig(), createChatConfig());
    vi.spyOn(performance, 'now').mockReturnValue(100);
    try {
      await indexer.indexVault({ onProgress: (snapshot) => snapshots.push(snapshot) });
      expect(snapshots.at(-1)?.pipeline).toMatchObject({ lifecycle: 'failed', processedFiles: 2, failedFiles: 1, processedEstimatedChunks: 2, processedPlannedChunks: 2, windowSamples: [], inferenceSamples: [] });
      expect(snapshots.at(-1)).toMatchObject({ completedFiles: 1, processedFiles: 2, failedFiles: 1 });
    } finally { vi.restoreAllMocks(); }
  });

  it('v1 속도 원장은 읽거나 덮어쓰지 않고 새 pipeline에 승격하지 않는다', async () => {
    const vault = createVault(new Map([['history.md', 'synthetic history independent evidence']]));
    const name = `eta-legacy-${crypto.randomUUID()}`;
    vectorDbNames.add(name);
    const store = new IndexedDbVectorStore(name);
    const key = 'rag-indexing-eta-calibration:v1:openai:text-embedding-3-small:100:0';
    const legacy = { version: 1, embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', chunkSize: 100, overlap: 0, msPerChunk: 123, chunkEstimateRatio: 2, variance: 0, sampleCount: 9, updatedAt: 10 };
    await store.setMetaValue(key, legacy);
    const read = vi.spyOn(store, 'getMetaValue');
    const write = vi.spyOn(store, 'setMetaValue');
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const indexer = new VaultIndexer(vault, store, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])) }, createRagConfig(), createChatConfig());
    await indexer.indexVault({ onProgress: (snapshot) => snapshots.push(snapshot) });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.historicalMsPerChunk).toBeNull();
    expect(snapshots.at(-1)?.pipeline?.windowSamples[0]?.physicalWorkUnits).toBeNull();
    expect(await store.getMetaValue(key)).toEqual(legacy);
    store.close();
  });
});

describe('pipeline 실제 wall·수명 관측', () => {
  it.each(['ready', 'failed'] as const)('held lookahead 정착까지 측정하고 다음 window와 겹치지 않는다 (%s)', async (mode) => {
    let now = 10;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const vault = createVault(new Map([['wall-first.md', 'synthetic first wall evidence'], ['wall-second.md', 'synthetic second wall evidence']]));
    const read = sourceSnapshot.readSourceFileSnapshot;
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reader = vi.spyOn(sourceSnapshot, 'readSourceFileSnapshot').mockImplementation(async (vault, file, options) => {
      if (options?.preparation?.maxChargeBytes !== undefined) {
        await held;
        if (mode === 'failed') throw new sourceAccess.SourceReadError('memory-budget');
      }
      const snapshot = await read(vault, file, options);
      if (options?.preparation && file.path === 'wall-first.md') now = 30;
      return snapshot;
    });
    const snapshots: RagIndexingProgressSnapshot[] = [];
    let calls = 0;
    const provider: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: (texts, options) => {
        options?.onInferenceDispatch?.();
        now = ++calls === 1 ? 40 : 200;
        options?.onInferenceSample?.({ backend: 'cpu', workUnits: texts.length, durationMs: 10, endedAtMs: now });
        return Promise.resolve(texts.map(() => [1, 0]));
      },
      planLocalAdmission: (source) => planLocalRagAdmissionRust({
        ...source, backend: 'cpu', maxBatchSize: 1, targetBatchMs: 100, maxLagMs: 20, nowMs: 1000,
        foregroundPending: 0, physicalSourceCount: 0, physicalInferenceCount: 1,
        state: { backend: 'cpu', maxBatchSize: 1, batchSize: 1, healthySamples: 0, previousRate: 0.1, trialBaseRate: null, lastSampleEndedAtMs: 900, lastLagMs: 1 },
        sample: { endedAtMs: 1000, workUnits: 1, durationMs: 10, lagMs: 1, rssBytes: 100000000, availableBytes: 1000000000 },
      }),
    };
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(vault, store, provider, createRagConfig(), createChatConfig());
    const running = indexer.indexVault({ onProgress: (snapshot) => snapshots.push(snapshot) });
    try {
      await vi.waitFor(() => expect(snapshots.some((snapshot) => snapshot.event === 'file-complete')).toBe(true));
      expect(await store.getEntries()).toHaveLength(1);
      expect(snapshots.at(-1)?.pipeline?.windowSamples).toEqual([]);
      expect(snapshots.at(-1)?.pipeline?.inferenceSamples).toEqual([]);
      expect(reader.mock.calls.some(([, , options]) => options?.preparation?.maxChargeBytes !== undefined)).toBe(true);
      now = 140; release(); await running;
      const windows = snapshots.at(-1)?.pipeline?.windowSamples;
      expect(windows).toEqual(mode === 'ready' ? [
        { startedAtMs: 10, endedAtMs: 140, logicalChunks: 1, physicalWorkUnits: 1 },
        { startedAtMs: 140, endedAtMs: 200, logicalChunks: 1, physicalWorkUnits: 1 },
      ] : [{ startedAtMs: 140, endedAtMs: 200, logicalChunks: 1, physicalWorkUnits: 1 }]);
      const wall = windows?.reduce((sum, sample) => sum + sample.endedAtMs - sample.startedAtMs, 0) ?? 0;
      if (mode === 'ready') expect(wall).toBeGreaterThan(snapshots.at(-1)!.completedFileDurationsMs.reduce((sum, duration) => sum + duration, 0));
      expect(snapshots.at(-1)?.pipeline?.processedFiles).toBe(2);
    } finally { release(); await running; reader.mockRestore(); clock.mockRestore(); }
  });

  it.each(['cancelled', 'paused', 'owner-invalid'] as const)('지연 observer는 중단 구간이나 새 tracker로 새지 않는다 (%s)', async (scenario) => {
    const vault = createVault(new Map([['late.md', 'synthetic late observer evidence']]));
    const controller = new AbortController();
    let current = true;
    let paused = false;
    const snapshots: RagIndexingProgressSnapshot[] = [];
    let late: EmbeddingOptions | undefined;
    let release = (): void => undefined;
    let calls = 0;
    const provider: EmbeddingProvider = { embed: () => Promise.resolve([1, 0]), embedBatch: (texts, options) => {
      calls++;
      if (calls === 1) {
        late = options;
        options?.onInferenceDispatch?.();
        return new Promise((resolve) => { release = () => resolve(texts.map(() => [1, 0])); });
      }
      late?.onInferenceDispatch?.();
      late?.onInferenceSample?.({ backend: 'webgpu', workUnits: 99, durationMs: 5, endedAtMs: performance.now() });
      return Promise.resolve(texts.map(() => [1, 0]));
    } };
    const indexer = new VaultIndexer(vault, new MemoryVectorStore(), provider, createRagConfig(), createChatConfig());
    const running = indexer.indexVault({ signal: controller.signal, isCurrent: () => current,
      getPerformanceGuardState: () => paused ? { mode: 'paused', currentBatchSize: 1, currentYieldMs: 0, reason: null, pauseUntilMs: null, remainingPauseMs: null, lastSlowReason: null } : null,
      onProgress: (snapshot) => snapshots.push(snapshot) });
    const stopped = expect(running).rejects.toBeInstanceOf(scenario === 'paused' ? IndexingPerformancePausedError : IndexingCancelledError);
    await vi.waitFor(() => expect(late).toBeDefined());
    if (scenario === 'cancelled') controller.abort();
    if (scenario === 'paused') paused = true;
    if (scenario === 'owner-invalid') current = false;
    late?.onInferenceSample?.({ backend: 'cpu', workUnits: 1, durationMs: 5, endedAtMs: performance.now() });
    release(); await stopped;
    expect(snapshots.at(-1)?.pipeline?.windowSamples).toEqual([]);
    expect(snapshots.at(-1)?.pipeline?.inferenceSamples).toEqual([]);
    expect(snapshots.at(-1)?.pipeline?.lifecycle).toBe(scenario === 'paused' ? 'paused' : 'cancelled');
    const fresh: RagIndexingProgressSnapshot[] = [];
    await indexer.indexVault({ onProgress: (snapshot) => fresh.push(snapshot) });
    expect(fresh.at(-1)?.pipeline).toMatchObject({ backend: 'unknown', inferenceSamples: [], processedFiles: 1 });
    expect(fresh.at(-1)?.pipeline?.windowSamples[0]?.physicalWorkUnits).toBeNull();
  });

  it.each(['bounded', 'prefetch'] as const)('window·교차 파일 prefetch 표본은 실 wall을 쓰고 상한·전체 원장을 유지한다 (%s)', async (mode) => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const vault = createVault(new Map(Array.from({ length: mode === 'bounded' ? 70 : 3 }, (_, index) => ['repeat-' + index + '.md', 'same synthetic evidence'])));
    const snapshots: RagIndexingProgressSnapshot[] = [];
    const store = new MemoryVectorStore();
    const replace = store.replaceBatchFileEntries.bind(store);
    vi.spyOn(store, 'replaceBatchFileEntries').mockImplementation(async (entries) => {
      await replace(entries);
      if (mode === 'prefetch') now += 7;
    });
    const indexer = new VaultIndexer(vault, store, { embed: () => Promise.resolve([1, 0]), embedBatch: (texts, options) => {
      options?.onInferenceDispatch?.();
      now += 20;
      options?.onInferenceSample?.({ backend: 'cpu', workUnits: texts.length, durationMs: 10, endedAtMs: now });
      return Promise.resolve(texts.map(() => [1, 0]));
    } }, createRagConfig(), createChatConfig(), undefined, undefined, {
      refreshFile: () => Promise.resolve(), removeFile: () => Promise.resolve(),
      replaceBatchFileDocuments: () => { now += mode === 'bounded' ? 20 : 1; return Promise.resolve(); },
    });
    try {
      await indexer.indexVault({ onProgress: (snapshot) => snapshots.push(snapshot) });
      const final = snapshots.at(-1)!;
      expect(final.pipeline?.windowSamples).toHaveLength(mode === 'bounded' ? 64 : 1);
      expect(final.pipeline?.inferenceSamples).toHaveLength(mode === 'bounded' ? 64 : 1);
      expect(final.pipeline?.processedFiles).toBe(mode === 'bounded' ? 70 : 3);
      expect(await store.getEntries()).toHaveLength(mode === 'bounded' ? 70 : 3);
      if (mode === 'prefetch') {
        expect(final.pipeline?.windowSamples[0]).toEqual({ startedAtMs: 0, endedAtMs: 44, logicalChunks: 3, physicalWorkUnits: 3 });
        expect(final.completedFileDurationsMs.reduce((sum, duration) => sum + duration, 0)).toBe(21);
      }
    } finally { clock.mockRestore(); }
  });
});
