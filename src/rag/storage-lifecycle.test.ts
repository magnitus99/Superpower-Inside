import { describe, expect, it, vi } from 'vitest';
import {
  cleanupStaleIndexedDbGenerations,
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

  it('deletes only stale current-vault generations and known legacy stores', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
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

  it('retires an inactive persistent cache when the active provider is memory-only', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'memory-only',
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

  it('deletes active and stale current-vault generations during a full plugin reset', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'reset',
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
