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
    expect(layout.active.embeddingCache).toContain('embedding-cache');
    expect(layout.active.bm25).toContain(':bm25');
    expect(layout.legacyNames).toContain('superpower-inside:Example:VectorStore');
  });

  it('deletes only stale current-vault generations and known legacy stores', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'profile:local::embedding-v2',
    });
    const staleGeneration = `${layout.currentVaultPrefix}stale:vectors`;
    const foreignGeneration = 'superpower-inside:rag-v2:foreign:stale:vectors';
    const deleteDatabase = vi.fn(
      (name: string): Promise<'blocked' | 'deleted'> =>
        Promise.resolve(name === staleGeneration ? 'blocked' : 'deleted'),
    );
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([
          layout.active.vector,
          staleGeneration,
          foreignGeneration,
          layout.legacyNames[0] ?? '',
          'unrelated-db',
        ]),
      ),
      deleteDatabase,
    };

    await expect(cleanupStaleIndexedDbGenerations(layout, host)).resolves.toEqual({
      deletedNames: [layout.legacyNames[0]],
      blockedNames: [staleGeneration],
      failedNames: [],
    });
    expect(deleteDatabase).not.toHaveBeenCalledWith(foreignGeneration);
  });

  it('deletes active and stale current-vault generations during a full plugin reset', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: 'C:/Vaults/Example',
      legacyVaultName: 'Example',
      embeddingNamespace: 'reset',
    });
    const staleGeneration = `${layout.currentVaultPrefix}old:embedding-cache`;
    const foreignGeneration = 'superpower-inside:rag-v2:foreign:old:embedding-cache';
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbLifecycleHost = {
      listDatabaseNames: vi.fn(() =>
        Promise.resolve([
          layout.active.vector,
          staleGeneration,
          foreignGeneration,
          layout.legacyNames[0] ?? '',
        ]),
      ),
      deleteDatabase,
    };

    const result = await deleteRagIndexedDbGenerations(layout, host);

    expect(result.deletedNames).toEqual(
      expect.arrayContaining([layout.active.vector, staleGeneration, layout.legacyNames[0]]),
    );
    expect(deleteDatabase).not.toHaveBeenCalledWith(foreignGeneration);
  });
});
