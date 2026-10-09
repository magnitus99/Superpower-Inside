import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { buildBM25CorpusDocuments } from './bm25-corpus';
import { createContentHash } from './hash';

describe('BM25 원문 코퍼스', () => {
  it.each(['md', 'txt'])('벡터 없이도 %s 원문 위치와 최신성 검증 정보를 보존한다', (extension) => {
    const content = '# 제목\n문서의 고유한 검색 근거';
    const file = {
      path: `notes/target.${extension}`,
      basename: 'target',
      extension,
      stat: { mtime: 10, size: 100 },
    } as TFile;
    const documents = buildBM25CorpusDocuments(file, content, { chunkSize: 1000, overlap: 100 });
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document).toMatchObject({
        sourcePath: file.path,
        sourceMtime: 10,
        sourceSize: 100,
        contentHash: createContentHash(content),
      });
      expect(document.startLine).toBeGreaterThanOrEqual(0);
      expect(document.endLine).toBeLessThan(content.split('\n').length);
      expect(document.text).toContain('검색 근거');
    }
  });
});
