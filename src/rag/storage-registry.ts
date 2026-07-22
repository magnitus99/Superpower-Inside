import Dexie from 'dexie';
import { planInactiveIndexedDbCleanupRust, type RustInactiveIndexedDbRecord } from './rust-core';
import type {
  IndexedDbCleanupResult,
  IndexedDbDeleteStatus,
  IndexedDbLifecycleHost,
  RagStorageLayout,
} from './storage-lifecycle';

const STORAGE_REGISTRY_KEY = 'superpower-inside:indexeddb-lifecycle:v1';
const INACTIVE_VAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface IndexedDbRegistryHost extends IndexedDbLifecycleHost {
  readRegistry(): string | null;
  writeRegistry(value: string): void;
  now(): number;
}

export interface InactiveIndexedDbCleanupOptions {
  maxDeletions?: number;
  maxInactiveAgeMs?: number;
}

export async function cleanupInactiveRagIndexedDb(
  layout: RagStorageLayout,
  pluginId: string,
  options: InactiveIndexedDbCleanupOptions = {},
  host: IndexedDbRegistryHost = browserIndexedDbRegistryHost,
): Promise<IndexedDbCleanupResult> {
  const databaseNames = await host.listDatabaseNames();
  const plan = planInactiveIndexedDbCleanupRust({
    databaseNames,
    activeNames: Object.values(layout.active),
    currentVaultPrefixes: [layout.currentVaultPrefix],
    currentLegacyNames: layout.cleanupLegacyNames,
    pluginId,
    records: parseRegistry(host.readRegistry()),
    now: host.now(),
    maxInactiveAgeMs: options.maxInactiveAgeMs ?? INACTIVE_VAULT_RETENTION_MS,
    maxDeletions: Math.max(0, Math.floor(options.maxDeletions ?? 1)),
  });
  if (!plan) throw new Error('Rust inactive IndexedDB cleanup planning failed');
  host.writeRegistry(JSON.stringify(plan.records));

  const result: IndexedDbCleanupResult = {
    deletedNames: [],
    blockedNames: [],
    failedNames: [],
    remainingDeleteCount: plan.remainingDeleteCount,
  };
  for (const name of plan.deleteNames) {
    const status = await host.deleteDatabase(name);
    appendDeleteStatus(result, name, status);
  }
  return result;
}

function parseRegistry(raw: string | null): RustInactiveIndexedDbRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRegistryRecord);
  } catch {
    return [];
  }
}

function isRegistryRecord(value: unknown): value is RustInactiveIndexedDbRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<RustInactiveIndexedDbRecord>;
  return (
    typeof record.key === 'string' &&
    record.key.length > 0 &&
    typeof record.firstSeen === 'number' &&
    Number.isFinite(record.firstSeen) &&
    (record.lastSeen === null ||
      (typeof record.lastSeen === 'number' && Number.isFinite(record.lastSeen)))
  );
}

function appendDeleteStatus(
  result: IndexedDbCleanupResult,
  name: string,
  status: IndexedDbDeleteStatus,
): void {
  if (status === 'deleted') result.deletedNames.push(name);
  else if (status === 'blocked') result.blockedNames.push(name);
  else result.failedNames.push(name);
}

const browserIndexedDbRegistryHost: IndexedDbRegistryHost = {
  listDatabaseNames: () => Dexie.getDatabaseNames(),
  deleteDatabase: deleteBrowserIndexedDb,
  readRegistry: () => window.localStorage.getItem(STORAGE_REGISTRY_KEY),
  writeRegistry: (value) => window.localStorage.setItem(STORAGE_REGISTRY_KEY, value),
  now: () => Date.now(),
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
