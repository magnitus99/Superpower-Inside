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
  it('raw 청크와 별도 검색 필드를 저장하고 엔트리에도 손실 없이 전달한다', async () => {
    const store = createStore();
    const file = createFile('notes/source.md');
    const content = '# Deployment\nQuartz cooling cycles';
    const documents = buildSourceDocuments(file, content, { chunkSize: 1000, overlap: 0 }, [], {
      frontmatter: { title: 'Quarterly Report', tags: ['finance'] },
      tags: [
        {
          tag: '#planning',
          position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
        },
      ],
    });
    expect(documents[0]).toMatchObject({
      text: content,
      title: 'Quarterly Report',
      headings: ['Deployment'],
      tags: ['#planning', 'finance'],
      startLine: 0,
      endLine: 1,
    });
    await store.replaceFileDocuments(file.path, documents);
    expect((await store.getEntriesByFilePaths([file.path]))[0]?.metadata).toMatchObject({
      text: content,
      title: 'Quarterly Report',
      headings: ['Deployment'],
      tags: ['#planning', 'finance'],
    });
  });
  it.each(['md', 'markdown', 'txt', 'ts', 'json', 'csv', 'custom'])(
    '임베딩 없이도 %s 본문과 원문 revision을 보존한다',
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

  it('앞쪽에 다른 절을 삽입해도 변경 없는 청크 ID와 해시는 유지한다', () => {
    const file = createFile('source.md');
    const config = { chunkSize: 1000, overlap: 0 };
    const before = buildSourceDocuments(file, '# 유지\n그대로인 근거', config);
    const after = buildSourceDocuments(
      file,
      '# 추가\n새로운 근거\n\n# 유지\n그대로인 근거',
      config,
    );
    expect(after.find((document) => document.heading === '유지')).toMatchObject({
      id: before[0]?.id,
      chunkHash: before[0]?.chunkHash,
      startLine: 3,
    });
    expect(after[1]?.contentHash).not.toBe(before[0]?.contentHash);
  });

  it('중복 청크에도 서로 다른 결정적 ID를 부여한다', () => {
    const file = createFile('source.md');
    const content = '# 동일\n같은 본문\n# 동일\n같은 본문';
    const first = buildSourceDocuments(file, content, { chunkSize: 1000, overlap: 0 });
    const second = buildSourceDocuments(file, content, { chunkSize: 1000, overlap: 0 });
    expect(new Set(first.map(({ id }) => id)).size).toBe(first.length);
    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
  });

  it('JSON의 최상위 키와 코드 선언을 공통 검색 근거에 보존한다', () => {
    const config = { chunkSize: 40, overlap: 0 };
    const json = buildSourceDocuments(
      createFile('source.json'),
      '{\n  "users": [\n    {"name": "Kim", "role": "admin"}\n  ],\n  "enabled": true\n}',
      config,
    );
    expect(json.some(({ heading }) => heading === '$.users')).toBe(true);
    expect(json.some(({ heading }) => heading === '$.enabled')).toBe(true);
    const code = buildSourceDocuments(
      createFile('source.ts'),
      'export function first() {\n  return "{";\n}\n\nexport function second() {\n  return 2;\n}',
      { chunkSize: 1000, overlap: 0 },
    );
    expect(code).toHaveLength(2);
    expect(code[0]?.heading).toContain('first');
    expect(code[1]?.heading).toContain('second');
  });

  it('CSV의 헤더와 인용된 여러 줄 레코드를 분리하지 않고 보존한다', () => {
    const documents = buildSourceDocuments(
      createFile('source.csv'),
      'name,description\nKim,"first\nsecond"\nLee,third',
      { chunkSize: 20, overlap: 0 },
    );
    expect(documents.every(({ heading }) => heading === 'name,description')).toBe(true);
    expect(documents.some(({ text }) => text.includes('Kim,"first\nsecond"'))).toBe(true);
    expect(documents.find(({ text }) => text.includes('Kim,"first'))?.endLine).toBe(2);
  });
});
