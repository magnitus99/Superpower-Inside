import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';

export const PLUGIN_DATA_DIR = '.superpower-inside';
export const EMBEDDING_CACHE_DB_NAME = 'SuperpowerInsideEmbeddingCache';

const PLUGIN_INDEXED_DB_KINDS = ['VectorStore', 'KnowledgeGraph', 'BM25Index'] as const;

export interface PluginOwnedDataResetResult {
  deletedLegacyDataDir: boolean;
  deletedIndexedDbNames: string[];
}

interface PluginOwnedDataResetOptions {
  adapter: Pick<DataAdapter, 'exists' | 'rmdir'>;
  indexedDbNames: readonly string[];
  deleteDatabase?: (name: string) => Promise<void>;
  legacyDataDir?: string;
}

export function buildPluginIndexedDbNames(createIndexedDbName: (kind: string) => string): string[] {
  return [...PLUGIN_INDEXED_DB_KINDS.map((kind) => createIndexedDbName(kind)), EMBEDDING_CACHE_DB_NAME];
}

export async function resetPluginOwnedData(
  options: PluginOwnedDataResetOptions,
): Promise<PluginOwnedDataResetResult> {
  const legacyDataDir = options.legacyDataDir ?? PLUGIN_DATA_DIR;
  const deleteDatabase = options.deleteDatabase ?? ((name: string) => Dexie.delete(name));
  const deletedIndexedDbNames: string[] = [];
  const uniqueDbNames = [...new Set(options.indexedDbNames.map((name) => name.trim()).filter(Boolean))];

  let deletedLegacyDataDir = false;
  if (await options.adapter.exists(legacyDataDir)) {
    await options.adapter.rmdir(legacyDataDir, true);
    deletedLegacyDataDir = true;
  }

  for (const name of uniqueDbNames) {
    await deleteDatabase(name);
    deletedIndexedDbNames.push(name);
  }

  return {
    deletedLegacyDataDir,
    deletedIndexedDbNames,
  };
}
