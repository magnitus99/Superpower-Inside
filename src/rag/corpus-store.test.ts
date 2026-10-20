import { describe, expect, it } from 'vitest';
import { BM25DocumentCorpusStore } from './corpus-store';
import type { IndexedDbBM25Index } from './bm25';

describe('BM25 원문 조회 어댑터', () => {
  it('벡터가 없어도 원문과 별도 검색 메타데이터를 두 조회 경로에서 보존한다', async () => {
    const document = {
      id: 'chunk',
      sourcePath: 'synthetic.md',
      text: 'Raw evidence',
      title: 'Title',
      headings: ['Heading'],
      tags: ['tag'],
      startLine: 0,
    };
    const index = {
      getCorpusDocumentsByIds: () => Promise.resolve([document]),
      getCorpusDocumentsBySourcePaths: () => Promise.resolve([document]),
    } as unknown as IndexedDbBM25Index;
    const corpus = new BM25DocumentCorpusStore(index);
    for (const entries of [
      await corpus.getEntriesByIds(['chunk']),
      await corpus.getEntriesByFilePaths(['synthetic.md']),
    ]) {
      expect(entries[0]?.metadata).toMatchObject({
        text: 'Raw evidence',
        title: 'Title',
        headings: ['Heading'],
        tags: ['tag'],
        startLine: 0,
      });
    }
  });
});
