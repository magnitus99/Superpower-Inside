import { describe, expect, it, vi } from 'vitest';
import { RAGQueryEngine } from '../rag/query';
import { MemoryVectorStore } from '../rag/store';
import { observeChatRetrieval } from './retrieval-trace';

describe('채팅 검색 기록', () => {
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
