import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../rag/query';
import { ObsidianNativeVaultToolPort } from './obsidian-native-vault-port';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = 'md';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  return { TFile: MockTFile };
});

describe('Obsidian 네이티브 Vault 포트', () => {
  it('read는 실제 행 번호를 보존하고 한 번에 최대 400행만 반환한다', async () => {
    const lines = Array.from({ length: 500 }, (_, index) => `${index + 1}번째 줄`);
    const port = new ObsidianNativeVaultToolPort(
      createApp([createFile('Projects/Alpha.md', lines.join('\n'))]),
    );

    const result = await port.read({
      action: 'read',
      path: 'Projects/Alpha.md',
      startLine: 2,
      endLine: null,
    });

    expect(result).toMatchObject({
      path: 'Projects/Alpha.md',
      startLine: 2,
      endLine: 401,
      totalLines: 500,
      truncated: true,
    });
    expect(result.content.split('\n')).toHaveLength(400);
  });

  it('list는 폴더 경로 안의 문서를 안정된 순서로 페이지 처리한다', async () => {
    const app = createApp([
      createFile('Projects/Beta.md', 'beta'),
      createFile('Archive/Old.md', 'old'),
      createFile('Projects/Alpha.md', 'alpha'),
    ]);
    const port = new ObsidianNativeVaultToolPort(app);

    const result = await port.list({ action: 'list', path: 'Projects', cursor: 0, limit: 1 });

    expect(result).toMatchObject({
      exists: true,
      files: [{ path: 'Projects/Alpha.md' }],
      nextCursor: 1,
      total: 2,
    });
  });

  it('임베딩 엔진이 없어도 Rust lexical plan으로 Vault를 검색한다', async () => {
    const app = createApp([
      createFile('Projects/Alpha.md', '핵심 고객 문제를 해결하는 제품 전략'),
      createFile('Projects/Beta.md', '주말 장보기 목록'),
    ]);
    const port = new ObsidianNativeVaultToolPort(app);

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.path).toBe('Projects/Alpha.md');
    expect(result.hits[0]?.preview).toContain('고객 문제');
    expect(result.citations[0]).toMatchObject({
      filePath: 'Projects/Alpha.md',
      status: 'verified',
    });
  });

  it('네이티브 lexical 근거가 충분하면 RAG/GraphRAG 검색을 호출하지 않는다', async () => {
    const query = vi.fn(() => Promise.resolve([]));
    const app = createApp([
      createFile('Projects/Alpha.md', '고객 문제와 고객 문제의 근거'),
      createFile('Projects/Beta.md', '다른 고객 문제'),
    ]);
    const port = new ObsidianNativeVaultToolPort(app, () => ({ query }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 2,
      match: 'all',
    });

    expect(result.hits).toHaveLength(2);
    expect(query).not.toHaveBeenCalled();
  });

  it('indexed 후보도 요청한 모든 검색어 일치 조건을 통과해야 한다', async () => {
    const indexedResults = [
      {
        sourcePath: 'Bible/Genesis.md',
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 1,
        chunkRange: { startLine: 1, endLine: 1 },
        entry: {
          id: 'genesis',
          vector: [],
          metadata: {
            filePath: 'Bible/Genesis.md',
            text: '창세기 본문',
            startLine: 1,
            endLine: 1,
          },
        },
      },
    ] satisfies QueryResult[];
    const query = vi.fn(() => Promise.resolve(indexedResults));
    const app = createApp([createFile('Bible/Genesis.md', '창세기 본문')]);
    const port = new ObsidianNativeVaultToolPort(app, () => ({ query }));

    const result = await port.search({
      action: 'search',
      query: '네빌 창세기',
      path: '',
      limit: 8,
      match: 'all',
    });

    expect(result.hits).toEqual([]);
  });

  it('비상 lexical 검색은 큰 Vault를 제한된 I/O 배치로 읽는다', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const files = Array.from({ length: 25 }, (_, index) =>
      createFile(`Notes/${index}.md`, index === 24 ? '마지막 고객 근거' : `문서 ${index}`),
    );
    const app = createApp(files, {}, async (file) => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return file.content;
    });

    const result = await new ObsidianNativeVaultToolPort(app).search({
      action: 'search',
      query: '고객 근거',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.path).toBe('Notes/24.md');
    expect(maxActiveReads).toBeLessThanOrEqual(8);
  });

  it('links는 Obsidian 링크 그래프에서 outgoing과 incoming을 함께 찾는다', async () => {
    const alpha = createFile('Projects/Alpha.md', '[[Beta]]');
    const beta = createFile('Projects/Beta.md', 'beta');
    const gamma = createFile('Projects/Gamma.md', '[[Alpha]]');
    const app = createApp([alpha, beta, gamma], {
      'Projects/Alpha.md': { 'Projects/Beta.md': 1 },
      'Projects/Gamma.md': { 'Projects/Alpha.md': 1 },
    });
    const port = new ObsidianNativeVaultToolPort(app);

    const result = await port.links({
      action: 'links',
      path: 'Projects/Alpha.md',
      direction: 'both',
      limit: 10,
    });

    expect(result).toMatchObject({
      outgoing: ['Projects/Beta.md'],
      incoming: ['Projects/Gamma.md'],
    });
  });

  it('stats는 Markdown 문서 개수와 전체 크기를 반환한다', async () => {
    const app = createApp([createFile('Alpha.md', '1234'), createFile('Beta.md', '123456')]);
    const port = new ObsidianNativeVaultToolPort(app);

    await expect(port.stats({ action: 'stats' })).resolves.toMatchObject({
      fileCount: 2,
      totalBytes: 10,
    });
  });

  it('모든 검색어가 일치하지 않으면 일부 단어만 맞는 문서를 반환하지 않는다', async () => {
    const app = createApp([
      createFile('Bible/Genesis.md', '창세기 본문'),
      createFile('People/Neville.md', '네빌 고다드 강연'),
      createFile('Research/Neville-Genesis.md', '네빌 고다드의 창세기 해석'),
    ]);

    const result = await new ObsidianNativeVaultToolPort(app).search({
      action: 'search',
      query: '네빌 창세기',
      path: '',
      limit: 8,
      match: 'all',
    });

    expect(result.hits.map((hit) => hit.path)).toEqual(['Research/Neville-Genesis.md']);
  });

  it('제외 경로는 모든 Vault 탐색 액션에서 일관되게 숨긴다', async () => {
    const app = createApp([
      createFile('Notes/Genesis.md', '창세기'),
      createFile('SuperpowerInsideChats/Current.md', '네빌 창세기'),
    ]);
    const port = new ObsidianNativeVaultToolPort(app, () => null, () => [
      'SuperpowerInsideChats',
    ]);

    const search = await port.search({
      action: 'search',
      query: '네빌 창세기',
      path: '',
      limit: 8,
      match: 'all',
    });
    const list = await port.list({ action: 'list', path: '', cursor: 0, limit: 100 });
    const excludedList = await port.list({
      action: 'list',
      path: 'SuperpowerInsideChats',
      cursor: 0,
      limit: 100,
    });
    const stats = await port.stats({ action: 'stats' });

    expect(search.hits).toEqual([]);
    expect(list.files.map((file) => file.path)).toEqual(['Notes/Genesis.md']);
    expect(excludedList).toMatchObject({ exists: false, files: [], total: 0 });
    expect(stats.fileCount).toBe(1);
    await expect(
      port.read({
        action: 'read',
        path: 'SuperpowerInsideChats/Current.md',
        startLine: 1,
        endLine: null,
      }),
    ).rejects.toThrow('SuperpowerInsideChats/Current.md');
    expect(() =>
      port.links({
        action: 'links',
        path: 'SuperpowerInsideChats/Current.md',
        direction: 'both',
        limit: 10,
      }),
    ).toThrow('SuperpowerInsideChats/Current.md');
  });

  it('존재하지 않는 폴더와 빈 폴더를 구분한다', async () => {
    const app = createApp([createFile('Projects/Alpha.md', 'alpha')]);
    const port = new ObsidianNativeVaultToolPort(app);

    await expect(
      port.list({ action: 'list', path: 'Missing', cursor: 0, limit: 10 }),
    ).resolves.toMatchObject({ exists: false, total: 0, files: [] });
  });
});

function createFile(path: string, content: string): TFile & { content: string } {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name: path.split('/').at(-1) ?? path,
    basename: (path.split('/').at(-1) ?? path).replace(/\.md$/u, ''),
    extension: 'md',
    content,
    stat: { ctime: 1, mtime: 2, size: content.length },
  }) as TFile & { content: string };
}

function createApp(
  files: Array<TFile & { content: string }>,
  resolvedLinks: Record<string, Record<string, number>> = {},
  cachedRead: (file: TFile & { content: string }) => Promise<string> = (file) =>
    Promise.resolve(file.content),
): App {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
      cachedRead,
    },
    metadataCache: {
      resolvedLinks,
      getFirstLinkpathDest: (path: string) =>
        byPath.get(path) ?? byPath.get(path.endsWith('.md') ? path : `${path}.md`) ?? null,
    },
  } as unknown as App;
}
