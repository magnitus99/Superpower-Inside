import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { IndexedDbDocumentCorpusStore, toDocumentEntry } from './document-corpus-store';
import { buildSourceDocuments } from './source-document';
import { isStoreMutationReceipt } from './durability';

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
  it('BM25 hit는 한 번의 primary-key bulkGet으로 중복·누락을 제외하고 기존 키 순서로 읽는다', async () => {
    const store = createStore();
    const files = ['a.md', 'Z.md'].map(createFile);
    const options = { chunkSize: 1000, overlap: 0 };
    const [lower, upper] = files.map((file) => buildSourceDocuments(file, `Original ${file.path}`, options)[0]);
    await store.replaceBatchFileDocuments([
      { filePath: lower.sourcePath, documents: [lower] },
      { filePath: upper.sourcePath, documents: [upper] },
    ]);
    const receipt = await store.getDurabilityReceipt();
    const table = store['db'].documents;
    const bulkGet = vi.spyOn(table, 'bulkGet');
    const where = vi.spyOn(table, 'where');
    try {
      expect(await store.getEntriesByIds([])).toEqual([]);
      expect(bulkGet).not.toHaveBeenCalled();
      const ids = [lower.id, 'missing', upper.id, lower.id];
      expect(await store.getEntriesByIds(ids)).toEqual([toDocumentEntry(upper), toDocumentEntry(lower)]);
      expect(bulkGet).toHaveBeenCalledExactlyOnceWith([upper.id, lower.id, 'missing']);
      expect(where).not.toHaveBeenCalled();
      expect(await store.getDurabilityReceipt()).toEqual(receipt);

      const refreshed = { ...lower, sourceMtime: lower.sourceMtime + 1 };
      await store.replaceFileDocuments(lower.sourcePath, [refreshed]);
      expect(await store.getEntriesByIds(ids)).toEqual([toDocumentEntry(upper), toDocumentEntry(refreshed)]);
      const replacement = buildSourceDocuments(files[0], 'Replacement text', options)[0];
      await store.replaceFileDocuments(lower.sourcePath, [replacement]);
      expect(await store.getEntriesByIds(ids)).toEqual([toDocumentEntry(upper)]);
      await store.removeByFilePath(upper.sourcePath);
      expect(await store.getEntriesByIds([...ids, replacement.id])).toEqual([toDocumentEntry(replacement)]);
    } finally {
      bulkGet.mockRestore();
      where.mockRestore();
    }
  });
  it('receipt 읽기는 기존 행을 인증하지 않으며 빈 DB의 명시 초기화만 새 incarnation을 만든다', async () => {
    const store = createStore();
    expect(await store.getDurabilityReceipt()).toBeNull();
    const empty = await store.initializeEmptyDurabilityReceipt();
    expect(isStoreMutationReceipt(empty)).toBe(true);
    expect(await store.initializeEmptyDurabilityReceipt()).toEqual(empty);
    expect(await store.getDocuments()).toEqual([]);
  });

  it('v1 기존 본문은 migration·읽기만으로 receipt를 만들거나 지우지 않는다', async () => {
    const name = `legacy-corpus-receipt:${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({ documents: 'id, sourcePath', files: 'filePath' });
    const file = createFile('legacy.md');
    const documents = buildSourceDocuments(file, 'legacy preserved source', { chunkSize: 1000, overlap: 0 });
    await legacy.table('documents').bulkPut(documents);
    await legacy.table('files').put({ filePath: file.path, vectorCount: 1, updated: 1 });
    legacy.close();
    const store = new IndexedDbDocumentCorpusStore(name);
    stores.push(store);
    expect(await store.getDurabilityReceipt()).toBeNull();
    expect(await store.initializeEmptyDurabilityReceipt()).toBeNull();
    expect(await store.getDocuments()).toEqual(documents);
    expect(await store.getFileIndexRecords()).toEqual([{ filePath: file.path, vectorCount: 1, updated: 1 }]);
  });

  it('같은 행 수의 본문·metadata 변경과 삭제·clear도 서로 다른 mutation으로 저장한다', async () => {
    const store = createStore();
    const file = createFile('same.md');
    const heads = [await store.initializeEmptyDurabilityReceipt()];
    for (const text of ['first source', 'second source']) {
      await store.replaceFileDocuments(file.path, buildSourceDocuments(file, text, { chunkSize: 1000, overlap: 0 }));
      expect(await store.getDocuments()).toHaveLength(1);
      heads.push(await store.getDurabilityReceipt());
    }
    const sourceRevision = { sourceMtime: 20, sourceSize: 5, contentHash: '811c9dc5' };
    await store.replaceBatchFileDocuments([{ filePath: file.path, documents: [], sourceMetadata: { segments: [], metadataParts: [{ label: 'Only metadata' }] }, sourceRevision }]);
    heads.push(await store.getDurabilityReceipt());
    await store.removeByFilePath(file.path);
    heads.push(await store.getDurabilityReceipt());
    await store.clear();
    heads.push(await store.getDurabilityReceipt());
    expect(heads.every((head) => head !== null)).toBe(true);
    expect(new Set(heads.map((head) => head?.incarnation)).size).toBe(1);
    expect(new Set(heads.map((head) => head?.mutation)).size).toBe(heads.length);
  });

  it('corpus 데이터와 receipt는 같은 transaction에서 rollback된다', async () => {
    const store = createStore();
    const file = createFile('rollback.md');
    await store.replaceFileDocuments(file.path, buildSourceDocuments(file, 'preserved source', { chunkSize: 1000, overlap: 0 }));
    const before = await store.getDurabilityReceipt();
    await expect(store['db'].transaction('rw', ['documents', 'files', 'meta', 'sourceBlocks'], async () => {
      await store.replaceFileDocuments(file.path, buildSourceDocuments(file, 'uncommitted source', { chunkSize: 1000, overlap: 0 }));
      expect(await store.getDurabilityReceipt()).not.toEqual(before);
      throw new Error('Synthetic outer transaction abort.');
    })).rejects.toThrow('Synthetic outer transaction abort.');
    expect(await store.getDurabilityReceipt()).toEqual(before);
    expect((await store.getDocuments()).map(({ text }) => text)).toEqual(['preserved source']);
  });

  it('재열기는 같은 receipt이고 같은 이름의 DB 재생성은 다른 incarnation이다', async () => {
    const store = createStore();
    const before = await store.initializeEmptyDurabilityReceipt();
    const name = names.at(-1)!;
    store.close();
    const reopened = new IndexedDbDocumentCorpusStore(name);
    stores.push(reopened);
    expect(await reopened.getDurabilityReceipt()).toEqual(before);
    reopened.close();
    await Dexie.delete(name);
    const recreated = new IndexedDbDocumentCorpusStore(name);
    stores.push(recreated);
    const after = await recreated.initializeEmptyDurabilityReceipt();
    expect(after?.incarnation).not.toBe(before?.incarnation);
  });

  it.each(['file', 'batch'] as const)('%s 저장은 metadata-only 파일의 실제 revision을 가짜 청크 없이 보존한다', async (mode) => {
    const store = createStore();
    const filePath = 'empty.xlsx';
    const sourceMetadata = { segments: [], metadataParts: [{ label: 'Empty', sourcePart: 'sheet.xml', locator: { cells: [{ address: 'C3' }] } }] };
    const sourceRevision = { sourceMtime: 20, sourceSize: 250, contentHash: '811c9dc5' };
    if (mode === 'file') await store.replaceFileDocuments(filePath, [], sourceMetadata, 'aaaaaaaa', sourceRevision);
    else await store.replaceBatchFileDocuments([{ filePath, documents: [], sourceMetadata, sourceMetadataHash: 'aaaaaaaa', sourceRevision }]);
    store.close();
    const reopened = new IndexedDbDocumentCorpusStore(names.at(-1)!);
    stores.push(reopened);
    expect(await reopened.getFileIndexRecords()).toEqual([expect.objectContaining({ filePath, ...sourceRevision, sourceMetadata, sourceMetadataHash: 'aaaaaaaa', vectorCount: 0, hasCompleteMetadata: true })]);
    expect(await reopened.getDocuments()).toEqual([]);
    expect(await reopened.getEntriesByFilePaths([filePath])).toEqual([]);
  });

  it('빈 시트 원장·alias·부분 PDF를 파일에 한 번 저장하고 재시작 후에도 보존한다', async () => {
    const store = createStore();
    const file = createFile('metadata.xlsx');
    const sourceMetadata = {
      segments: [{ label: 'Sheet', startLine: 0, endLine: 0, sourcePart: 'xl/worksheets/sheet1.xml', locator: { sheetName: 'Sheet', cells: [{ address: 'A1', startLine: 0, endLine: 0, formula: 'SUM(B1)' }], aliases: [{ sourcePart: 'chart.xml', reference: 'Sheet!A1', address: 'A1', cacheIndex: 0, nodePath: '/chart/v' }] } }],
      metadataParts: [{ label: 'Empty', sourcePart: 'sheet2.xml', locator: { cells: [{ address: 'B2', blank: true }], mergedRanges: ['B2:C3'], containerChain: ['outer.docx', 'inner.xlsx'] } }],
      completeness: { status: 'partial' as const, pageCount: 2, missingPageCount: 1, missingPages: [{ pageNumber: 2, reason: 'page-error' as const }], failures: [] },
    };
    const documents = buildSourceDocuments(file, 'alpha', { chunkSize: 100, overlap: 0 }, sourceMetadata.segments);
    await store.replaceBatchFileDocuments([{ filePath: file.path, documents, sourceMetadata, sourceMetadataHash: 'metadata-signature' }, { filePath: 'empty.xlsx', documents: [], sourceMetadata: { segments: [], metadataParts: sourceMetadata.metadataParts } }]);
    store.close();
    const reopened = new IndexedDbDocumentCorpusStore(names.at(-1)!);
    stores.push(reopened);
    const records = await reopened.getFileIndexRecords();
    expect(records.find((record) => record.filePath === file.path)).toMatchObject({ sourceMetadata, sourceMetadataHash: 'metadata-signature' });
    expect(records.find((record) => record.filePath === 'empty.xlsx')).toMatchObject({ vectorCount: 0, sourceMetadata: { segments: [], metadataParts: sourceMetadata.metadataParts } });
    expect((await reopened.getDocuments())[0]).not.toHaveProperty('sourceMetadata');
    expect((await reopened.getEntriesByFilePaths([file.path]))[0]?.metadata.text).toBe('alpha');
  });

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
      startLine: 1,
      endLine: 2,
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
      startLine: 4,
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

  // 회귀: 저장 문서가 0-based로 남으면 원문 재확인 단계가 모든 구절을 position-mismatch로 버립니다.
  it('저장 문서의 줄 번호는 frontmatter를 건너뛴 원문 1행 기준과 일치한다', () => {
    const content = '---\ntitle: 합성\n---\n\n# 제목\n본문 첫 줄\n본문 둘째 줄';
    const documents = buildSourceDocuments(createFile('notes/body.md'), content, {
      chunkSize: 1000,
      overlap: 0,
    });
    const lines = content.split('\n');
    expect(documents[0]?.startLine).toBe(5);
    expect(lines[(documents[0]?.startLine ?? 0) - 1]).toBe(documents[0]?.text.split('\n')[0]);
    expect(documents.at(-1)?.endLine).toBe(lines.length);
  });

  it('CSV의 헤더와 인용된 여러 줄 레코드를 분리하지 않고 보존한다', () => {
    const documents = buildSourceDocuments(
      createFile('source.csv'),
      'name,description\nKim,"first\nsecond"\nLee,third',
      { chunkSize: 20, overlap: 0 },
    );
    expect(documents.every(({ heading }) => heading === 'name,description')).toBe(true);
    expect(documents.some(({ text }) => text.includes('Kim,"first\nsecond"'))).toBe(true);
    expect(documents.find(({ text }) => text.includes('Kim,"first'))?.endLine).toBe(3);
  });
});
