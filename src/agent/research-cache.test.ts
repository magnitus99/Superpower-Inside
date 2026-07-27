import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbVaultResearchCache, type VaultResearchCacheKey } from './research-cache';

const dbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
});

describe('Vault Research 요약 캐시', () => {
  it('동일 문서 상태·질문·모델 네임스페이스에서 요약과 출처를 복원한다', async () => {
    const cache = createCache();
    const key = createKey();
    await cache.put(key, {
      content: 'Alpha 요약',
      citations: [
        {
          id: 'vault:Alpha.md:1-2',
          filePath: 'Alpha.md',
          line: 1,
          endLine: 2,
          preview: 'Alpha',
          status: 'verified',
        },
      ],
    });

    await expect(cache.get(key)).resolves.toEqual(
      expect.objectContaining({ content: 'Alpha 요약', citations: [expect.objectContaining({ filePath: 'Alpha.md' })] }),
    );
    await expect(cache.get({ ...key, modifiedAt: 2 })).resolves.toBeNull();
    await expect(cache.get({ ...key, question: '다른 질문' })).resolves.toBeNull();
    await expect(cache.get({ ...key, namespace: 'claude:opus' })).resolves.toBeNull();
    cache.close();
  });

  it('유지 한도를 넘으면 가장 오래된 레코드를 제거한다', async () => {
    const cache = createCache(2);
    const keys: VaultResearchCacheKey[] = [];
    for (let index = 0; index < 100; index++) {
      const key = createKey({ question: `질문 ${index}` });
      keys.push(key);
      await cache.put(key, { content: `요약 ${index}`, citations: [] });
    }

    const first = keys[0];
    const last = keys.at(-1);
    if (!first || !last) throw new Error('cache test keys are missing');
    await expect(cache.get(first)).resolves.toBeNull();
    await expect(cache.get(last)).resolves.toEqual({
      content: '요약 99',
      citations: [],
    });
    cache.close();
  });

  it('뷰가 닫혔다 다시 열려도 같은 캐시 인스턴스를 자동으로 재연결한다', async () => {
    const cache = createCache();
    const key = createKey();
    await cache.put(key, { content: '재사용 가능한 요약', citations: [] });

    cache.close();

    await expect(cache.get(key)).resolves.toEqual({
      content: '재사용 가능한 요약',
      citations: [],
    });
    cache.close();
  });
});

function createCache(maxRecords?: number): IndexedDbVaultResearchCache {
  const name = `research-cache-test-${crypto.randomUUID()}`;
  dbNames.add(name);
  return new IndexedDbVaultResearchCache(name, maxRecords);
}

function createKey(patch: Partial<VaultResearchCacheKey> = {}): VaultResearchCacheKey {
  return {
    path: 'Alpha.md',
    modifiedAt: 1,
    size: 10,
    question: '볼트를 요약해줘',
    namespace: 'openai:gpt',
    ...patch,
  };
}
