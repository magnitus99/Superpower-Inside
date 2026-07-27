import { describe, expect, it, vi } from 'vitest';
import { createRagStorageLayout } from './storage-lifecycle';
import { cleanupInactiveRagIndexedDb, type IndexedDbRegistryHost } from './storage-registry';

describe('IndexedDB vault lifecycle registry', () => {
  it('observes foreign vault databases before retiring them after inactivity', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: '/vault/current',
      legacyVaultName: 'current',
      embeddingNamespace: 'embedding',
    });
    const foreign = 'superpower-inside:rag-v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:graph';
    const databases = [layout.active.graph, foreign, 'SuperpowerInsideEmbeddingCache'];
    let registry: string | null = null;
    let now = 100;
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbRegistryHost = {
      listDatabaseNames: vi.fn(() => Promise.resolve(databases)),
      deleteDatabase,
      readRegistry: () => registry,
      writeRegistry: (value) => {
        registry = value;
      },
      now: () => now,
    };

    const observed = await cleanupInactiveRagIndexedDb(
      layout,
      'superpower-inside',
      { maxInactiveAgeMs: 50, maxDeletions: 4 },
      host,
    );
    expect(observed.deletedNames).toEqual([]);
    expect(deleteDatabase).not.toHaveBeenCalled();

    now = 151;
    const retired = await cleanupInactiveRagIndexedDb(
      layout,
      'superpower-inside',
      { maxInactiveAgeMs: 50, maxDeletions: 4 },
      host,
    );
    expect(retired.deletedNames).toEqual(
      expect.arrayContaining([foreign, 'SuperpowerInsideEmbeddingCache']),
    );
    expect(deleteDatabase).not.toHaveBeenCalledWith(layout.active.graph);
  });

  it('recovers from malformed registry state without deleting newly discovered databases', async () => {
    const layout = createRagStorageLayout({
      pluginId: 'superpower-inside',
      vaultIdentity: '/vault/current',
      legacyVaultName: 'current',
      embeddingNamespace: 'embedding',
    });
    const foreign = 'superpower-inside:rag-v2:cccccccccccccccccccccccccccccccc:bm25';
    const deleteDatabase = vi.fn(() => Promise.resolve<'deleted'>('deleted'));
    const host: IndexedDbRegistryHost = {
      listDatabaseNames: () => Promise.resolve([foreign]),
      deleteDatabase,
      readRegistry: () => '{broken',
      writeRegistry: vi.fn(),
      now: () => 10_000,
    };

    await cleanupInactiveRagIndexedDb(
      layout,
      'superpower-inside',
      { maxInactiveAgeMs: 1, maxDeletions: 4 },
      host,
    );

    expect(deleteDatabase).not.toHaveBeenCalled();
  });
});
