import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHUNK_CONTRACT } from './search-defaults';
import {
  cleanupStaleIndexedDbGenerations,
  createRagIndexNamespace,
  createRagStorageLayout,
  deleteRagIndexedDbGenerations,
  type IndexedDbLifecycleHost,
} from './storage-lifecycle';

describe('RAG IndexedDB storage lifecycle', () => {
  it('derives a generic vault and embedding generation layout through Rust', () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });

    expect(layout.active.vector).toMatch(/^superpower-inside:rag-v2:[a-f0-9]{32}:/);
    expect(layout.ownedVaultPrefixes).toEqual([
      expect.stringMatching(/^superpower-inside:rag-v2:[a-f0-9]{32}:$/),
      expect.stringMatching(/^superpower-inside:rag-v3:[a-f0-9]{32}:$/),
    ]);
    expect(layout.active.embeddingCache).toContain('embedding-cache');
    expect(layout.active.bm25).toContain(':bm25');
    expect(layout.legacyNames).toContain('superpower-inside:Example:VectorStore');
    expect(layout.cleanupLegacyNames).not.toContain('SuperpowerInsideEmbeddingCache');
  });

  it('청킹 계약이 바뀌면 vector와 BM25만 새 세대로 옮기고 임베딩 캐시는 재사용한다', () => {
    const base = {
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
    };
    const legacy = createRagStorageLayout({
      ...base,
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const changed = createRagStorageLayout({
      ...base,
      indexNamespace: createRagIndexNamespace({ chunkSize: 500, overlap: 100 }),
    });

    expect(createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT)).toBe('');
    expect(createRagIndexNamespace({ chunkSize: 500, overlap: 100 })).toContain('500');
    expect(changed.active.vector).not.toBe(legacy.active.vector);
    expect(changed.active.bm25).not.toBe(legacy.active.bm25);
    expect(changed.active.embeddingCache).toBe(legacy.active.embeddingCache);
    expect(changed.active.graph).toBe(legacy.active.graph);
  });

  it('deletes only stale current-vault generations and known legacy stores', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const staleGeneration = `${layout.ownedVaultPrefixes[1]}stale:vectors`;
    const foreignGeneration = 'superpower-inside:rag-v2:foreign:stale:vectors';
    const deleteDatabase = vi.fn(
      (name: string): Promise<'blocked' | 'deleted'> =>
        Promise.resolve(name === staleGeneration ? 'blocked' : 'deleted'),
    );
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([layout.active.vector, staleGeneration, foreignGeneration, 'unrelated-db']),
      ),
      deleteDatabase,
    };

    await expect(cleanupStaleIndexedDbGenerations(layout, {}, host)).resolves.toEqual({
      deletedNames: [],
      blockedNames: [staleGeneration],
      failedNames: [],
      remainingDeleteCount: 0,
    });
    expect(deleteDatabase).not.toHaveBeenCalledWith(foreignGeneration);
  });

  it('이전 청킹 세대의 vector와 BM25만 정리하고 현재 세대는 유지한다', async () => {
    const base = {
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
    };
    const previousGeneration = createRagStorageLayout({
      ...base,
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const currentGeneration = createRagStorageLayout({
      ...base,
      indexNamespace: createRagIndexNamespace({ chunkSize: 500, overlap: 100 }),
    });
    const deleteDatabase = vi.fn((): Promise<'deleted'> => Promise.resolve('deleted'));
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([
          previousGeneration.active.vector,
          previousGeneration.active.bm25,
          currentGeneration.active.vector,
          currentGeneration.active.bm25,
          currentGeneration.active.embeddingCache,
          currentGeneration.active.graph,
        ]),
      ),
      deleteDatabase,
    };

    const result = await cleanupStaleIndexedDbGenerations(
      currentGeneration,
      { maxDeletions: 10 },
      host,
    );

    expect([...result.deletedNames].sort()).toEqual(
      [previousGeneration.active.vector, previousGeneration.active.bm25].sort(),
    );
    expect(result.blockedNames).toEqual([]);
    expect(result.failedNames).toEqual([]);
    expect(result.remainingDeleteCount).toBe(0);
  });

  it('retires an inactive persistent cache when the active provider is memory-only', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'memory-only',
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() => Promise.resolve([layout.active.embeddingCache])),
      deleteDatabase,
    };

    await cleanupStaleIndexedDbGenerations(
      layout,
      { maxDeletions: 1, preserveEmbeddingCache: false },
      host,
    );

    expect(deleteDatabase).toHaveBeenCalledWith(layout.active.embeddingCache);
  });

  it('retires rebuildable BM25 and Graph stores while their features are disabled', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'memory-only',
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([layout.active.vector, layout.active.bm25, layout.active.graph]),
      ),
      deleteDatabase,
    };

    await cleanupStaleIndexedDbGenerations(
      layout,
      { maxDeletions: 4, preserveBm25: false, preserveGraph: false },
      host,
    );

    expect(deleteDatabase).toHaveBeenCalledWith(layout.active.bm25);
    expect(deleteDatabase).toHaveBeenCalledWith(layout.active.graph);
    expect(deleteDatabase).not.toHaveBeenCalledWith(layout.active.vector);
  });

  it('deletes active and stale current-vault generations during a full plugin reset', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'reset',
      indexNamespace: createRagIndexNamespace(DEFAULT_CHUNK_CONTRACT),
    });
    const staleGeneration = `${layout.currentVaultPrefix}old:embedding-cache`;
    const abandonedV3 = `${layout.ownedVaultPrefixes[1]}old:vectors`;
    const foreignGeneration = 'superpower-inside:rag-v2:foreign:old:embedding-cache';
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([
          layout.active.vector,
          staleGeneration,
          abandonedV3,
          foreignGeneration,
          layout.legacyNames[0] ?? '',
        ]),
      ),
      deleteDatabase,
    };

    const result = await deleteRagIndexedDbGenerations(layout, host);

    expect(result.deletedNames).toEqual(
      expect.arrayContaining([
        layout.active.vector,
        staleGeneration,
        abandonedV3,
        layout.legacyNames[0],
      ]),
    );
    expect(result.remainingDeleteCount).toBe(0);
    expect(deleteDatabase).not.toHaveBeenCalledWith(foreignGeneration);
  });
});
