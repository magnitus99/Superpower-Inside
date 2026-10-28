import { describe, expect, it, vi } from 'vitest';

// WASM 초기화 실패를 재현해 TypeScript 계산 대체가 일어나지 않는지 확인합니다.
vi.mock('../../generated/rag-wasm/rag_wasm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../generated/rag-wasm/rag_wasm.js')>();
  return {
    ...actual,
    initSync: () => {
      throw new Error('synthetic wasm init failure');
    },
  };
});

describe('WASM 초기화 실패 경계', () => {
  it('rankTopKPairsRust는 TypeScript cosine으로 대체하지 않고 null을 반환한다', async () => {
    vi.resetModules();
    const { rankTopKPairsRust } = await import('./rust-core');

    expect(
      rankTopKPairsRust(
        [1, 0],
        [
          [1, 0],
          [0, 1],
        ],
        1,
      ),
    ).toBeNull();
  });

  it('검색 선택·다양성 계획도 TypeScript 계산으로 대체하지 않고 null을 반환한다', async () => {
    vi.resetModules();
    const { planDiverseResultIndicesRust, selectRelevantResultIndicesRust } = await import(
      './rust-core'
    );

    expect(
      selectRelevantResultIndicesRust(
        [
          {
            score: 1,
            vectorScore: 1,
            bm25Score: 1,
            keywordMatches: 1,
            retrievalSources: ['bm25'],
            sourceEvidenceScore: 1,
          },
        ],
        0.5,
        true,
      ),
    ).toBeNull();
    expect(
      planDiverseResultIndicesRust(
        [
          { score: 2, vector: [1, 0], sourcePath: 'Synthetic/A.md' },
          { score: 1, vector: [0, 1], sourcePath: 'Synthetic/B.md' },
        ],
        1,
      ),
    ).toBeNull();
  });

  it('벡터 저장소·RAG 상태·pending 계획도 TypeScript 계산으로 대체하지 않는다', async () => {
    vi.resetModules();
    const {
      planIndexPendingFilesRust,
      planRagStatusRust,
      planVectorStoreAddRust,
      planVectorStoreLookupByIdsRust,
      planVectorStoreLookupByFilePathsRust,
      planVectorStoreRemoveFileRust,
      planVectorStoreReplaceFileRust,
      planVectorStoreStatsRust,
    } = await import('./rust-core');

    expect(planVectorStoreAddRust(['a'], ['a', 'b'])).toBeNull();
    expect(planVectorStoreReplaceFileRust(['a.md'], 'a.md', 1)).toBeNull();
    expect(planVectorStoreRemoveFileRust(['a.md'], 'a.md')).toBeNull();
    expect(planVectorStoreStatsRust(['a.md'], 1)).toBeNull();
    expect(planVectorStoreLookupByFilePathsRust(['a.md'], ['a.md'])).toBeNull();
    expect(planVectorStoreLookupByIdsRust(['a'], ['a'])).toBeNull();
    expect(planIndexPendingFilesRust(['a.md'], ['a.md'])).toBeNull();
    expect(
      planRagStatusRust({
        includedFiles: [],
        records: [],
        totalVaultFiles: 0,
        embeddingProvider: 'synthetic',
        embeddingModel: 'synthetic',
        reasons: {
          missing: 'missing',
          legacy: 'legacy',
          staleFile: 'stale',
          embeddingChanged: 'embedding',
        },
      }),
    ).toBeNull();
  });

  it('메모리 벡터 저장소는 계획 실패 시 쓰기를 중단하고 조회를 빈 결과로 닫는다', async () => {
    vi.resetModules();
    const { MemoryVectorStore } = await import('./store');
    const store = new MemoryVectorStore();
    const entry = {
      id: 'a',
      vector: [1, 0],
      metadata: { filePath: 'Synthetic/A.md', startLine: 0, text: 'Synthetic' },
    };

    await expect(store.add([entry])).rejects.toThrow('planning failed');
    expect(await store.getStats()).toMatchObject({ totalEntries: 0, totalFiles: 0 });
    expect(await store.getEntriesByFilePaths(['Synthetic/A.md'])).toEqual([]);
    expect(await store.getEntriesByIds(['a'])).toEqual([]);
  });
});
