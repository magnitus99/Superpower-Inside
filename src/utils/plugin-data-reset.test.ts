import { describe, expect, it, vi } from 'vitest';

import {
  EMBEDDING_CACHE_DB_NAME,
  PLUGIN_DATA_DIR,
  buildPluginIndexedDbNames,
  resetPluginOwnedData,
} from './plugin-data-reset';

describe('plugin data reset', () => {
  it('현재 볼트용 IndexedDB 이름과 전역 임베딩 캐시 DB 이름을 초기화 대상으로 만든다', () => {
    const names = buildPluginIndexedDbNames((kind) => `superpower-inside:TestVault:${kind}`);

    expect(names).toEqual([
      'superpower-inside:TestVault:VectorStore',
      'superpower-inside:TestVault:KnowledgeGraph',
      'superpower-inside:TestVault:BM25Index',
      EMBEDDING_CACHE_DB_NAME,
    ]);
  });

  it('플러그인 내부 데이터 디렉터리와 지정된 IndexedDB만 삭제한다', async () => {
    const removedDirectories: Array<{ path: string; recursive: boolean }> = [];
    const deletedDatabases: string[] = [];
    const adapter = {
      exists: vi.fn((path: string) => Promise.resolve(path === PLUGIN_DATA_DIR)),
      rmdir: vi.fn((path: string, recursive: boolean) => {
        removedDirectories.push({ path, recursive });
        return Promise.resolve();
      }),
    };

    const result = await resetPluginOwnedData({
      adapter,
      indexedDbNames: ['superpower-inside:TestVault:VectorStore', EMBEDDING_CACHE_DB_NAME],
      deleteDatabase: (name) => {
        deletedDatabases.push(name);
        return Promise.resolve();
      },
    });

    expect(adapter.exists).toHaveBeenCalledWith(PLUGIN_DATA_DIR);
    expect(removedDirectories).toEqual([{ path: PLUGIN_DATA_DIR, recursive: true }]);
    expect(deletedDatabases).toEqual([
      'superpower-inside:TestVault:VectorStore',
      EMBEDDING_CACHE_DB_NAME,
    ]);
    expect(result).toEqual({
      deletedLegacyDataDir: true,
      deletedIndexedDbNames: [
        'superpower-inside:TestVault:VectorStore',
        EMBEDDING_CACHE_DB_NAME,
      ],
    });
  });
});
