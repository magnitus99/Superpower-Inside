import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { IndexedDbDocumentCorpusStore } from './document-corpus-store';
import { buildSourceDocuments } from './source-document';

const stores: IndexedDbDocumentCorpusStore[] = [];
const names: string[] = [];

afterEach(async () => {
  for (const store of stores) store.close();
  await Promise.all(names.map((name) => Dexie.delete(name)));
  stores.length = 0;
  names.length = 0;
});

function createStore(): IndexedDbDocumentCorpusStore {
  const name = `document-corpus-test:${crypto.randomUUID()}`;
  names.push(name);
  const store = new IndexedDbDocumentCorpusStore(name);
  stores.push(store);
  return store;
}

function createFile(path: string): TFile {
  return {
    path,
    basename: 'source',
    extension: path.split('.').at(-1),
    stat: { mtime: 10, size: 100 },
  } as TFile;
}

describe('지원 파일 공통 문서 저장소', () => {
  it.each(['md', 'markdown', 'txt', 'ts', 'json', 'csv', 'custom'])(
    '임베딩과 그래프 없이도 %s 본문과 원문 revision을 보존한다',
    async (extension) => {
      const store = createStore();
      const file = createFile(`notes/source.${extension}`);
      const documents = buildSourceDocuments(file, '# 제목\n같은 근거', {
        chunkSize: 1000,
        overlap: 100,
      });
      await store.replaceFileDocuments(file.path, documents);
      const entries = await store.getEntriesByFilePaths([file.path]);
      expect(entries).toHaveLength(documents.length);
      expect(entries[0]).toMatchObject({
        id: documents[0]?.id,
        vector: [],
        metadata: { filePath: file.path, sourceMtime: 10, sourceSize: 100 },
      });
      expect(await store.getEntriesByIds(documents.map((document) => document.id))).toEqual(
        entries,
      );
      expect(await store.getFileIndexRecords()).toEqual([
        expect.objectContaining({
          filePath: file.path,
          vectorCount: documents.length,
          hasCompleteMetadata: true,
        }),
      ]);
    },
  );

  it('본문 교체와 삭제는 파일 기록과 청크에 함께 반영된다', async () => {
    const store = createStore();
    const file = createFile('notes/source.txt');
    await store.replaceFileDocuments(
      file.path,
      buildSourceDocuments(file, '이전 본문', { chunkSize: 1000, overlap: 0 }),
    );
    await store.replaceFileDocuments(
      file.path,
      buildSourceDocuments(file, '새 본문', { chunkSize: 1000, overlap: 0 }),
    );
    expect((await store.getEntriesByFilePaths([file.path]))[0]?.metadata.text).toContain('새 본문');
    await store.removeByFilePath(file.path);
    expect(await store.getIndexedFilePaths()).toEqual([]);
    expect(await store.getEntriesByFilePaths([file.path])).toEqual([]);
  });

  it('markdown 확장자도 헤딩을 보존하는 같은 청킹 계약을 사용한다', () => {
    const config = { chunkSize: 1000, overlap: 100 };
    const content = '# 제목\n원문 근거\n\n## 다음\n추가 근거';
    const markdown = buildSourceDocuments(createFile('notes/source.markdown'), content, config);
    const md = buildSourceDocuments(createFile('notes/source.md'), content, config);
    expect(
      markdown.map(({ heading, startLine, endLine }) => ({ heading, startLine, endLine })),
    ).toEqual(md.map(({ heading, startLine, endLine }) => ({ heading, startLine, endLine })));
    expect(markdown[0]?.heading).toBe('제목');
  });
});
