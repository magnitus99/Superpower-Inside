import 'fake-indexeddb/auto';
import type { TFile, Vault } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatConfig, RAGConfig } from '../settings';
import { disposeRagFileEligibilityCache, getRagFileInventory } from '../utils/vault';
import { VaultIndexer, type RagIndexingProgressSnapshot } from './indexer';
import { MemoryVectorStore } from './store';
import { calculateRagStatus } from './status';

vi.mock('obsidian', () => ({ TFolder: class MockTFolder {} }));

const rag: RAGConfig = {
  excludePaths: ['policy'],
  excludeExts: [],
  excludeChatFolder: false,
  chunkSize: 1000,
  overlap: 100,
  embeddingProvider: 'openai',
  embeddingModel: 'fixture',
  autoUpdateEnabled: false,
  autoUpdateIntervalMin: 5,
  minScore: 0.5,
  annEnabled: false,
  annClusterCount: 0,
  annProbeCount: 4,
  structuralGraphEnabled: false,
  enableBM25: false,
  bm25Weight: 0.3,
  performanceTuningMode: 'auto',
  performanceGuardEnabled: true,
  maxEmbeddingBatchSize: 32,
  indexingYieldMs: 0,
  slowEventLoopThresholdMs: 150,
  slowBatchThresholdMs: 3000,
};
const chat: ChatConfig = {
  saveFolder: 'Chats',
  defaultModel: '',
  promptLibrary: [],
  mcpToolExecutionPolicy: 'mentioned-auto',
  autoSaveEnabled: false,
  autoSaveDebounceMs: 1000,
  mcpMentionOnly: false,
};
const damaged = new Uint8Array([0xef, 0xbb, 0xbf, 0xe2, 0x82]);
const liveVaults: Vault[] = [];
afterEach(() => {
  for (const vault of liveVaults.splice(0)) disposeRagFileEligibilityCache(vault);
});

function fixture(entries: Record<string, Uint8Array | Error>) {
  const bytes = new Map(Object.entries(entries));
  const files = [...bytes.keys()].map(
    (path) =>
      ({
        path,
        name: path.split('/').pop() ?? path,
        extension: path.split('.').pop() ?? '',
        basename: path.replace(/\.[^.]*$/u, ''),
        stat: { ctime: 1, mtime: 2, size: 10 },
      }) as TFile,
  );
  type Listener = { name: string; callback: (file: TFile) => void };
  const listeners = new Set<Listener>();
  const readBinary = vi.fn((file: TFile): Promise<ArrayBuffer> => {
    const value = bytes.get(file.path);
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve((value ?? new Uint8Array()).slice().buffer);
  });
  const vault = {
    configDir: '.obsidian',
    getFiles: () => files,
    getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    readBinary,
    on: (name: string, callback: Listener['callback']) => {
      const listener = { name, callback };
      listeners.add(listener);
      return listener;
    },
    offref: (listener: Listener) => listeners.delete(listener),
  } as unknown as Vault;
  liveVaults.push(vault);
  return {
    vault,
    files,
    bytes,
    readBinary,
    modify: (file: TFile) => {
      for (const listener of listeners) if (listener.name === 'modify') listener.callback(file);
    },
  };
}
const utf8 = (text: string) => new TextEncoder().encode(text);

describe('원문 실패 단일 manifest', () => {
  it('손상·모호성은 실패로, 정책과 확정 바이너리는 별도 보존한다', async () => {
    const { vault, readBinary } = fixture({
      'good.txt': utf8('ordinary source text'),
      'damaged.txt': damaged,
      'raw.bin': new Uint8Array([255, 255, 255, 255, 255, 255, 10]),
      'image.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      'policy/private.txt': new Error('must not read'),
    });
    const inventory = await getRagFileInventory(vault, rag, chat);
    expect(inventory.candidates.map((file) => file.path)).toEqual(['good.txt']);
    expect(inventory.failures.map(({ file, reason }) => [file.path, reason])).toEqual([
      ['damaged.txt', 'corrupt-encoding'],
      ['raw.bin', 'ambiguous-encoding'],
    ]);
    expect(inventory.policyExcluded.map((file) => file.path)).toEqual(['policy/private.txt']);
    expect(inventory.unsupported.map((file) => file.path)).toEqual(['image.png']);
    expect(readBinary).toHaveBeenCalledTimes(4);
    const status = await calculateRagStatus(
      vault,
      new MemoryVectorStore(),
      rag,
      chat,
      undefined,
      inventory,
    );
    expect(readBinary).toHaveBeenCalledTimes(4);
    expect(status).toMatchObject({
      totalDocuments: 3,
      missingDocuments: 1,
      failedDocuments: 2,
      unknownDocuments: 2,
      healthyDocuments: 0,
      excludedDocuments: 2,
    });
    expect(status.updateRequiredDocuments).toContainEqual(
      expect.objectContaining({
        path: 'damaged.txt',
        status: 'unknown',
        reason: 'corrupt-encoding',
      }),
    );
  });

  it('같은 stat의 modify 후 성공·손상·복구가 판정 캐시에 가려지지 않는다', async () => {
    const { vault, files, bytes, modify, readBinary } = fixture({ 'good.txt': utf8('valid text') });
    expect((await getRagFileInventory(vault, rag, chat)).candidates).toHaveLength(1);
    expect((await getRagFileInventory(vault, rag, chat)).candidates).toHaveLength(1);
    expect(readBinary).toHaveBeenCalledTimes(1);
    bytes.set('good.txt', damaged);
    modify(files[0]);
    expect((await getRagFileInventory(vault, rag, chat)).failures).toHaveLength(1);
    bytes.set('good.txt', utf8('repaired text'));
    modify(files[0]);
    const repaired = await getRagFileInventory(vault, rag, chat);
    expect(repaired.failures).toEqual([]);
    expect(repaired.candidates).toHaveLength(1);
  });

  it('I/O·quota·사전 메모리 예산·읽기 중 growth 예산 원인을 잃지 않는다', async () => {
    const quota = new Error('quota');
    quota.name = 'QuotaExceededError';
    const { vault, files, readBinary } = fixture({
      'io.txt': new Error('I/O'),
      'quota.txt': quota,
      'allocation.txt': new RangeError('allocation'),
      'preflight.txt': utf8('must not read'),
      'growth.txt': new Uint8Array(64 * 1024 * 1024 + 1),
    });
    const preflight = files.find((file) => file.path === 'preflight.txt')!;
    preflight.stat.size = 64 * 1024 * 1024 + 1;
    const inventory = await getRagFileInventory(vault, rag, chat);
    expect(inventory.failures.map(({ file, reason }) => [file.path, reason])).toEqual([
      ['io.txt', 'read-failed'],
      ['quota.txt', 'quota-exceeded'],
      ['allocation.txt', 'memory-budget'],
      ['preflight.txt', 'memory-budget'],
      ['growth.txt', 'memory-budget'],
    ]);
    expect(readBinary).toHaveBeenCalledTimes(4);
    expect(readBinary).not.toHaveBeenCalledWith(preflight);
    expect(inventory.unsupported).toEqual([]);
  });

  it('기존 healthy 벡터가 있어도 same-stat 실패 복구를 pending 재시도에서 놓치지 않는다', async () => {
    const { vault, files, bytes, modify } = fixture({ 'good.txt': utf8('first source text') });
    const store = new MemoryVectorStore();
    const indexer = new VaultIndexer(
      vault,
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      rag,
      chat,
    );
    await indexer.indexVault();
    bytes.set('good.txt', damaged);
    modify(files[0]);
    expect(await indexer.indexPending()).toMatchObject({ indexed: 0, skipped: 1 });
    expect(indexer.getFailedFilePaths()).toEqual(['good.txt']);
    expect(await calculateRagStatus(vault, store, rag, chat)).toMatchObject({
      healthyDocuments: 0,
      unknownDocuments: 1,
      failedDocuments: 1,
      totalVectors: 0,
    });
    bytes.set('good.txt', utf8('second source text'));
    modify(files[0]);
    expect(await indexer.indexPending()).toMatchObject({ indexed: 1, skipped: 0 });
    expect(indexer.getFailedFilePaths()).toEqual([]);
  });

  it.each(['indexVault', 'indexPending'] as const)(
    '%s는 내구 완료와 처리 실패를 구분하고 복구 뒤 실패 원장을 해제한다',
    async (method) => {
      const { vault, files, bytes, modify, readBinary } = fixture({
        'good.txt': utf8('ordinary source text'),
        'damaged.txt': damaged,
      });
      const store = new MemoryVectorStore();
      const indexer = new VaultIndexer(
        vault,
        store,
        {
          embed: () => Promise.resolve([1, 0]),
          embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
        },
        rag,
        chat,
      );
      const progress: RagIndexingProgressSnapshot[] = [];
      const result = await indexer[method]({ onProgress: (value) => progress.push(value) });
      expect(result).toMatchObject({ indexed: 1, skipped: 1 });
      expect(result.documents).toContain('damaged.txt');
      expect(indexer.getFailedFilePaths()).toEqual(['damaged.txt']);
      expect(indexer.getFailedFileReasons()).toEqual([
        { path: 'damaged.txt', reason: 'corrupt-encoding' },
      ]);
      expect(readBinary.mock.calls.filter(([file]) => file.path === 'damaged.txt')).toHaveLength(1);
      expect(progress.at(-1)).toMatchObject({
        totalFiles: 2,
        processedFiles: 2,
        completedFiles: 1,
        failedFiles: 1,
        partialFiles: 0,
        skipped: 1,
        stage: 'settled',
      });
      expect(await store.getFileIndexRecords()).toHaveLength(1);
      expect(await calculateRagStatus(vault, store, rag, chat)).toMatchObject({
        healthyDocuments: 1,
        unknownDocuments: 1,
        failedDocuments: 1,
      });
      bytes.set('damaged.txt', utf8('repaired source text'));
      modify(files.find((file) => file.path === 'damaged.txt')!);
      await indexer.indexPending();
      expect(indexer.getFailedFilePaths()).toEqual([]);
      expect(await calculateRagStatus(vault, store, rag, chat)).toMatchObject({
        healthyDocuments: 2,
        failedDocuments: 0,
        unknownDocuments: 0,
      });
    },
  );
});
