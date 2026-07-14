import Dexie from 'dexie';
import {
  planIndexedDbCleanupRust,
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
  host: IndexedDbLifecycleHost = browserIndexedDbLifecycleHost,
): Promise<IndexedDbCleanupResult> {
  return executeIndexedDbCleanup(layout, host, true);
}

export async function deleteRagIndexedDbGenerations(
  layout: RagStorageLayout,
  host: IndexedDbLifecycleHost = browserIndexedDbLifecycleHost,
): Promise<IndexedDbCleanupResult> {
  return executeIndexedDbCleanup(layout, host, false);
}

async function executeIndexedDbCleanup(
  layout: RagStorageLayout,
  host: IndexedDbLifecycleHost,
  preserveActive: boolean,
): Promise<IndexedDbCleanupResult> {
  const databaseNames = await host.listDatabaseNames();
  const activeNames = preserveActive ? Object.values(layout.active) : [];
  const plan = planIndexedDbCleanupRust(
    databaseNames,
    activeNames,
    layout.currentVaultPrefix,
    layout.legacyNames,
  );
  if (!plan) {
    throw new Error('Rust IndexedDB cleanup planning failed');
  }

  const result: IndexedDbCleanupResult = {
    deletedNames: [],
    blockedNames: [],
    failedNames: [],
  };
  for (const name of plan.deleteNames) {
    const status = await host.deleteDatabase(name);
    if (status === 'deleted') result.deletedNames.push(name);
    else if (status === 'blocked') result.blockedNames.push(name);
    else result.failedNames.push(name);
    await yieldToHost();
  }
  return result;
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
