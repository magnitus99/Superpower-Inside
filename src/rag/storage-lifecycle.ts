import Dexie from 'dexie';
import { DEFAULT_CHUNK_CONTRACT } from './search-defaults';
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

/** 청킹 계약 버전. 청커 동작이나 청크 저장 형식이 바뀌면 올려 인덱스 세대를 교체합니다. */
export const RAG_INDEX_CONTRACT_VERSION = 1;

/** 청킹 계약 v1의 기본값은 기존 세대 이름을 그대로 써서 불필요한 재색인을 피합니다. */
const LEGACY_GENERATION_CONTRACT = {
  version: 1,
  chunkSize: DEFAULT_CHUNK_CONTRACT.chunkSize,
  overlap: DEFAULT_CHUNK_CONTRACT.overlap,
};

/**
 * 청킹 계약에 따른 인덱스 세대 이름을 만듭니다.
 *
 * 빈 문자열이면 기존 세대를 유지하고, 값이 있으면 vector와 BM25만 새 세대로 옮깁니다.
 */
export function createRagIndexNamespace(rag: { chunkSize: number; overlap: number }): string {
  const contract = {
    version: RAG_INDEX_CONTRACT_VERSION,
    chunkSize: rag.chunkSize,
    overlap: rag.overlap,
  };
  if (
    contract.version === LEGACY_GENERATION_CONTRACT.version &&
    contract.chunkSize === LEGACY_GENERATION_CONTRACT.chunkSize &&
    contract.overlap === LEGACY_GENERATION_CONTRACT.overlap
  ) {
    return '';
  }
  return `idx-v${contract.version}:${contract.chunkSize}:${contract.overlap}`;
}

export function createRagStorageLayout(input: {
  pluginId: string;
  vaultIdentity: string;
  legacyVaultName: string;
  embeddingNamespace: string;
  indexNamespace: string;
}): RagStorageLayout {
  const layout = planIndexedDbStorageLayoutRust(
    input.pluginId,
    input.vaultIdentity,
    input.legacyVaultName,
    input.embeddingNamespace,
    input.indexNamespace,
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
