import { describe, expect, it } from 'vitest';

import { maintainPluginOwnedFiles } from './plugin-file-maintenance';

const PLUGIN_DIRECTORY = '.obsidian/plugins/superpower-inside';
const EVENT_LOG_PATH = `${PLUGIN_DIRECTORY}/agent-diagnostics.ndjson`;
const LEGACY_DIRECTORY = '.superpower-inside';

describe('plugin-owned file maintenance', () => {
  it('removes stale plugin temps while preserving settings and user files', async () => {
    const adapter = new MaintenanceAdapter({
      [`${PLUGIN_DIRECTORY}/agent-diagnostics.json.tmp.1`]: file(1, 10),
      [`${PLUGIN_DIRECTORY}/tern_engine_bg.wasm.download-1.tmp`]: file(1, 10),
      [`${PLUGIN_DIRECTORY}/data.json.tmp-user`]: file(1, 10),
      'notes/user.md': file(1, 10),
    });

    const result = await maintainPluginOwnedFiles({
      adapter: adapter.asDataAdapter(),
      pluginDirectory: PLUGIN_DIRECTORY,
      eventLogPath: EVENT_LOG_PATH,
      legacyDataDirectory: LEGACY_DIRECTORY,
      now: 10_000,
      staleTempAgeMs: 1_000,
    });

    expect(result.deletedPaths).toEqual([
      `${PLUGIN_DIRECTORY}/agent-diagnostics.json.tmp.1`,
      `${PLUGIN_DIRECTORY}/tern_engine_bg.wasm.download-1.tmp`,
    ]);
    expect(adapter.has(`${PLUGIN_DIRECTORY}/data.json.tmp-user`)).toBe(true);
    expect(adapter.has('notes/user.md')).toBe(true);
  });

  it('retires legacy derived files only after the caller opens the health gate', async () => {
    const adapter = new MaintenanceAdapter({
      [`${LEGACY_DIRECTORY}/vectors.json`]: file(1, 10),
      [`${LEGACY_DIRECTORY}/bm25-index.json`]: file(1, 10),
    });

    await maintainPluginOwnedFiles({
      adapter: adapter.asDataAdapter(),
      pluginDirectory: PLUGIN_DIRECTORY,
      eventLogPath: EVENT_LOG_PATH,
      legacyDataDirectory: LEGACY_DIRECTORY,
      allowLegacyCleanup: false,
      includePluginDirectory: false,
      now: 10_000,
    });
    expect(adapter.has(`${LEGACY_DIRECTORY}/vectors.json`)).toBe(true);

    const result = await maintainPluginOwnedFiles({
      adapter: adapter.asDataAdapter(),
      pluginDirectory: PLUGIN_DIRECTORY,
      eventLogPath: EVENT_LOG_PATH,
      legacyDataDirectory: LEGACY_DIRECTORY,
      allowLegacyCleanup: true,
      includePluginDirectory: false,
      now: 10_000,
    });

    expect(result.deletedPaths).toEqual([
      `${LEGACY_DIRECTORY}/bm25-index.json`,
      `${LEGACY_DIRECTORY}/vectors.json`,
    ]);
    expect(result.removedLegacyDirectory).toBe(true);
  });

  it('rotates an oversized diagnostics log and keeps one previous generation', async () => {
    const adapter = new MaintenanceAdapter({
      [EVENT_LOG_PATH]: file(9_000, 2_048),
      [`${EVENT_LOG_PATH}.previous`]: file(1, 1_024),
    });

    const result = await maintainPluginOwnedFiles({
      adapter: adapter.asDataAdapter(),
      pluginDirectory: PLUGIN_DIRECTORY,
      eventLogPath: EVENT_LOG_PATH,
      legacyDataDirectory: LEGACY_DIRECTORY,
      maxEventLogBytes: 1_024,
      now: 10_000,
    });

    expect(result.rotatedEventLogPath).toBe(EVENT_LOG_PATH);
    expect(adapter.has(EVENT_LOG_PATH)).toBe(false);
    expect(adapter.has(`${EVENT_LOG_PATH}.previous`)).toBe(true);
  });
});

interface StoredFile {
  mtime: number;
  size: number;
}

function file(mtime: number, size: number): StoredFile {
  return { mtime, size };
}

class MaintenanceAdapter {
  private readonly files = new Map<string, StoredFile>();
  private readonly directories = new Set<string>();

  constructor(files: Record<string, StoredFile>) {
    for (const [path, value] of Object.entries(files)) {
      this.files.set(path, value);
      const directory = path.split('/').slice(0, -1).join('/');
      if (directory) this.directories.add(directory);
    }
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.directories.has(path));
  }

  list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    const files = [...this.files.keys()].filter((candidate) => {
      const suffix = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
      return suffix.length > 0 && !suffix.includes('/');
    });
    const folders = [...this.directories].filter((candidate) => {
      const suffix = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : '';
      return suffix.length > 0 && !suffix.includes('/');
    });
    return Promise.resolve({ files, folders });
  }

  stat(path: string): Promise<{ type: 'file'; ctime: number; mtime: number; size: number } | null> {
    const value = this.files.get(path);
    return Promise.resolve(value ? { type: 'file', ctime: value.mtime, ...value } : null);
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (!value) return Promise.reject(new Error(`Missing file: ${from}`));
    this.files.delete(from);
    this.files.set(to, value);
    return Promise.resolve();
  }

  rmdir(path: string): Promise<void> {
    this.directories.delete(path);
    return Promise.resolve();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  asDataAdapter(): never {
    return this as never;
  }
}
