import type { DataAdapter } from 'obsidian';

import {
  planPluginOwnedFileMaintenanceRust,
  type RustPluginOwnedFileRecord,
} from '../rag/rust-core';

export const LEGACY_PLUGIN_DATA_DIRECTORY = '.superpower-inside';
export const DEFAULT_DIAGNOSTICS_EVENT_LOG_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_STALE_TEMP_AGE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_DELETIONS = 16;

export interface PluginOwnedFileMaintenanceOptions {
  adapter: DataAdapter;
  pluginDirectory: string;
  eventLogPath: string;
  legacyDataDirectory?: string;
  allowLegacyCleanup?: boolean;
  includePluginDirectory?: boolean;
  maxEventLogBytes?: number;
  staleTempAgeMs?: number;
  maxDeletions?: number;
  now?: number;
}

export interface PluginOwnedFileMaintenanceResult {
  deletedPaths: string[];
  failedPaths: string[];
  remainingDeleteCount: number;
  rotatedEventLogPath: string | null;
  removedLegacyDirectory: boolean;
}

export async function maintainPluginOwnedFiles(
  options: PluginOwnedFileMaintenanceOptions,
): Promise<PluginOwnedFileMaintenanceResult> {
  const legacyDataDirectory = options.legacyDataDirectory ?? LEGACY_PLUGIN_DATA_DIRECTORY;
  const directories = [
    ...(options.includePluginDirectory === false ? [] : [options.pluginDirectory]),
    legacyDataDirectory,
  ];
  const records = await listOwnedFileRecords(options.adapter, directories);
  const plan = planPluginOwnedFileMaintenanceRust({
    records,
    pluginDirectory: options.pluginDirectory,
    legacyDataDirectory,
    eventLogPath: options.eventLogPath,
    now: options.now ?? Date.now(),
    staleTempAgeMs: normalizeNonNegativeInteger(options.staleTempAgeMs, DEFAULT_STALE_TEMP_AGE_MS),
    maxEventLogBytes: normalizeNonNegativeInteger(
      options.maxEventLogBytes,
      DEFAULT_DIAGNOSTICS_EVENT_LOG_MAX_BYTES,
    ),
    allowLegacyCleanup: options.allowLegacyCleanup ?? false,
    maxDeletions: normalizeNonNegativeInteger(options.maxDeletions, DEFAULT_MAX_DELETIONS),
  });
  if (!plan) throw new Error('Rust plugin-owned file maintenance planning failed');

  const deletedPaths: string[] = [];
  const failedPaths: string[] = [];
  for (const path of plan.deletePaths) {
    try {
      await options.adapter.remove(path);
      deletedPaths.push(path);
    } catch {
      failedPaths.push(path);
    }
  }

  let rotatedEventLogPath: string | null = null;
  if (plan.rotateEventLogPath) {
    try {
      await rotatePluginEventLog(options.adapter, plan.rotateEventLogPath);
      rotatedEventLogPath = plan.rotateEventLogPath;
    } catch {
      failedPaths.push(plan.rotateEventLogPath);
    }
  }

  const removedLegacyDirectory =
    (options.allowLegacyCleanup ?? false) &&
    plan.remainingDeleteCount === 0 &&
    failedPaths.length === 0
      ? await removeDirectoryIfEmpty(options.adapter, legacyDataDirectory)
      : false;
  return {
    deletedPaths,
    failedPaths,
    remainingDeleteCount: plan.remainingDeleteCount,
    rotatedEventLogPath,
    removedLegacyDirectory,
  };
}

export async function rotatePluginEventLog(
  adapter: DataAdapter,
  eventLogPath: string,
): Promise<void> {
  if (!(await adapter.exists(eventLogPath))) return;
  const previousPath = `${eventLogPath}.previous`;
  if (await adapter.exists(previousPath)) {
    await adapter.remove(previousPath);
  }
  await adapter.rename(eventLogPath, previousPath);
}

async function listOwnedFileRecords(
  adapter: DataAdapter,
  directories: readonly string[],
): Promise<RustPluginOwnedFileRecord[]> {
  const records: RustPluginOwnedFileRecord[] = [];
  for (const directory of new Set(directories)) {
    if (!(await adapter.exists(directory))) continue;
    const listed = await adapter.list(directory);
    for (const path of listed.files) {
      const stat = await adapter.stat(path);
      if (stat?.type !== 'file') continue;
      records.push({ path, mtime: stat.mtime, size: stat.size });
    }
  }
  return records;
}

async function removeDirectoryIfEmpty(adapter: DataAdapter, directory: string): Promise<boolean> {
  if (!(await adapter.exists(directory))) return false;
  const listed = await adapter.list(directory);
  if (listed.files.length > 0 || listed.folders.length > 0) return false;
  try {
    await adapter.rmdir(directory, false);
    return true;
  } catch {
    return false;
  }
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
