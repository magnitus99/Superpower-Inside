import Dexie from 'dexie';
import {
  planIndexedDbBoundedCleanupRust,
  planIndexedDbStorageLayoutRust,
  type RustIndexedDbStorageLayout,
} from './rust-core';

export type RagStorageLayout = RustIndexedDbStorageLayout;
export type IndexedDbDeleteStatus = 'deleted' | 'blocked' | 'failed';

export interface IndexedDbLifecycleHost {
  listDatabaseNames(): Promise<string[]>;
  deleteDatabase(name: string): Promise<IndexedDbDeleteStatus>;
}

export interface IndexedDbCleanupResult {
  deletedNames: string[];
  blockedNames: string[];
  failedNames: string[];
  remainingDeleteCount: number;
}

export interface IndexedDbCleanupOptions {
  maxDeletions?: number;
  preserveEmbeddingCache?: boolean;
  preserveBm25?: boolean;
  preserveGraph?: boolean;
}

export function createRagStorageLayout(input: {
  pluginId: string;
  vaultIdentity: string;
  legacyVaultName: string;
  embeddingNamespace: string;
}): RagStorageLayout {
  const layout = planIndexedDbStorageLayoutRust(
    input.pluginId,
    input.vaultIdentity,
    input.legacyVaultName,
    input.embeddingNamespace,
  );
  if (!layout) {
    throw new Error('Rust storage layout planning failed');
  }
  return layout;
}

export async function cleanupStaleIndexedDbGenerations(
  layout: RagStorageLayout,
  options: IndexedDbCleanupOptions = {},
  host: IndexedDbLifecycleHost = browserIndexedDbLifecycleHost,
): Promise<IndexedDbCleanupResult> {
  const databaseNames = await host.listDatabaseNames();
  const preserveEmbeddingCache = options.preserveEmbeddingCache ?? true;
  const activeNames = [layout.active.vector];
  if (options.preserveBm25 ?? true) activeNames.push(layout.active.bm25);
  if (options.preserveGraph ?? true) activeNames.push(layout.active.graph);
  if (preserveEmbeddingCache) activeNames.push(layout.active.embeddingCache);
  const plan = planIndexedDbBoundedCleanupRust(
    databaseNames,
    activeNames,
    layout.ownedVaultPrefixes,
    layout.cleanupLegacyNames,
    Math.max(0, Math.floor(options.maxDeletions ?? 1)),
  );
  if (!plan) {
    throw new Error('Rust bounded IndexedDB cleanup planning failed');
  }
  const result = createEmptyCleanupResult(plan.remainingDeleteCount);
  for (const name of plan.deleteNames) {
    const status = await host.deleteDatabase(name);
    if (status === 'deleted') result.deletedNames.push(name);
    else if (status === 'blocked') result.blockedNames.push(name);
    else result.failedNames.push(name);
    await yieldToHost();
  }
  return result;
}

export async function deleteRagIndexedDbGenerations(
  layout: RagStorageLayout,
  host: IndexedDbLifecycleHost = browserIndexedDbLifecycleHost,
): Promise<IndexedDbCleanupResult> {
  const databaseNames = await host.listDatabaseNames();
  const plan = planIndexedDbBoundedCleanupRust(
    databaseNames,
    [],
    layout.ownedVaultPrefixes,
    layout.legacyNames,
    databaseNames.length,
  );
  if (!plan) {
    throw new Error('Rust full IndexedDB cleanup planning failed');
  }

  const result = createEmptyCleanupResult(plan.remainingDeleteCount);
  for (const name of plan.deleteNames) {
    const status = await host.deleteDatabase(name);
    if (status === 'deleted') result.deletedNames.push(name);
    else if (status === 'blocked') result.blockedNames.push(name);
    else result.failedNames.push(name);
    await yieldToHost();
  }
  return result;
}

function createEmptyCleanupResult(remainingDeleteCount: number): IndexedDbCleanupResult {
  return {
    deletedNames: [],
    blockedNames: [],
    failedNames: [],
    remainingDeleteCount,
  };
}

const browserIndexedDbLifecycleHost: IndexedDbLifecycleHost = {
  listDatabaseNames: () => Dexie.getDatabaseNames(),
  deleteDatabase: deleteBrowserIndexedDb,
};

function deleteBrowserIndexedDb(name: string): Promise<IndexedDbDeleteStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (status: IndexedDbDeleteStatus): void => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => settle('deleted');
      request.onerror = () => settle('failed');
      request.onblocked = () => settle('blocked');
    } catch {
      settle('failed');
    }
  });
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
