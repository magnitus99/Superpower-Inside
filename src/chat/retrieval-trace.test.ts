import { describe, expect, it, vi } from 'vitest';
import { RAGQueryEngine } from '../rag/query';
import { MemoryVectorStore } from '../rag/store';
import { observeChatRetrieval } from './retrieval-trace';

describe('채팅 검색 기록', () => {
  it('요청별 진단 콜백과 실패 공급자 제외 옵션을 관찰 래퍼가 보존한다', async () => {
    const engine = new RAGQueryEngine(null, null);
    const query = vi.spyOn(engine, 'query');
    const callback = vi.fn();
    const onRecord = vi.fn();
    const observed = observeChatRetrieval(engine, onRecord);
    await observed.query('independent synthetic query', 2, 0, undefined, {
      onRetrieved: callback,
      excludedProviderIds: ['ivf-vector'],
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(onRecord).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      'independent synthetic query',
      2,
      0,
      undefined,
      expect.objectContaining({ excludedProviderIds: ['ivf-vector'] }),
    );
  });

  it('검색 결과의 점수·줄 위치만 전달하고 원문·벡터를 복제하지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      {
        id: 'synthetic',
        vector: [1, 0],
        metadata: {
          filePath: 'Synthetic.md',
          text: 'independent synthetic text',
          startLine: 0,
          endLine: 2,
        },
      },
    ]);
    const engine = new RAGQueryEngine(store, {
      embed: () => Promise.resolve([1, 0]),
      embedBatch: () => Promise.resolve([]),
    });
    const onRecord = vi.fn();
    const observed = observeChatRetrieval(engine, onRecord);
    await observed.query('synthetic', 2, 0);
    expect(onRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'synthetic',
        results: [
          expect.objectContaining({
            filePath: 'Synthetic.md',
            line: 1,
            endLine: 3,
            vectorScore: 1,
          }),
        ],
      }),
    );
    const stored = JSON.stringify(onRecord.mock.calls);
    expect(stored).not.toContain('independent synthetic text');
    expect(stored).not.toContain('"vector":');
  });
});
