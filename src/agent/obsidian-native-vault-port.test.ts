import { TFile, TFolder, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../rag/query';
import {
  ObsidianNativeVaultToolPort,
  type NativeVaultQueryEngineLike,
} from './obsidian-native-vault-port';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = 'md';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  class MockTFolder {
    path = '';
    name = '';
    children: unknown[] = [];
  }
  return { TFile: MockTFile, TFolder: MockTFolder };
});

describe('Obsidian 네이티브 Vault 포트', () => {
  it('read는 실제 행 번호를 보존하고 한 번에 최대 400행만 반환한다', async () => {
    const lines = Array.from({ length: 500 }, (_, index) => `${index + 1}번째 줄`);
    const port = createNativeVaultPort(
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

  it('read는 한 줄이 매우 커도 model-facing 결과를 64KiB 안으로 제한한다', async () => {
    const port = createNativeVaultPort(
      createApp([createFile('Projects/Large.md', '한글🙂'.repeat(100_000))]),
    );

    const result = await port.read({
      action: 'read',
      path: 'Projects/Large.md',
      startLine: 1,
      endLine: 1,
    });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain('output truncated');
    expect(new TextEncoder().encode(result.content).byteLength).toBeLessThanOrEqual(64 * 1024);
  });

  it('list는 폴더 경로 안의 문서를 안정된 순서로 페이지 처리한다', async () => {
    const app = createApp([
      createFile('Projects/Beta.md', 'beta'),
      createFile('Archive/Old.md', 'old'),
      createFile('Projects/Alpha.md', 'alpha'),
    ]);
    const port = createNativeVaultPort(app);

    const result = await port.list({ action: 'list', path: 'Projects', cursor: 0, limit: 1 });

    expect(result).toMatchObject({
      exists: true,
      files: [{ path: 'Projects/Alpha.md' }],
      nextCursor: 1,
      total: 2,
    });
  });

  it('RAG 후보로 선택된 비 Markdown 텍스트 파일도 모든 파일 탐색 액션에서 다룬다', async () => {
    const markdown = createFile('Projects/Overview.md', '프로젝트 개요');
    const source = createFile('Projects/main.ts', 'export const customerProblem = true;');
    const app = createApp([markdown, source]);
    const port = createNativeVaultPort(app, () => Promise.resolve([markdown, source]));

    const search = await port.search({
      action: 'search',
      query: 'customerProblem',
      path: '',
      limit: 3,
      match: 'all',
    });
    const read = await port.read({
      action: 'read',
      path: 'Projects/main.ts',
      startLine: 1,
      endLine: null,
    });
    const list = await port.list({ action: 'list', path: 'Projects', cursor: 0, limit: 10 });
    const stats = await port.stats({ action: 'stats' });

    expect(search.hits.map((hit) => hit.path)).toContain('Projects/main.ts');
    expect(read).toMatchObject({
      path: 'Projects/main.ts',
      content: 'export const customerProblem = true;',
    });
    expect(list.files.map((file) => file.path)).toEqual([
      'Projects/Overview.md',
      'Projects/main.ts',
    ]);
    expect(stats.fileCount).toBe(2);
  });

  it('list 연속 페이지는 같은 RAG 후보 스냅샷을 재사용한다', async () => {
    const alpha = createFile('Projects/Alpha.md', 'alpha');
    const beta = createFile('Projects/Beta.md', 'beta');
    const gamma = createFile('Projects/Gamma.md', 'gamma');
    let candidates: readonly TFile[] = [alpha, beta];
    const getCandidateFiles = vi.fn(() => Promise.resolve(candidates));
    const port = createNativeVaultPort(createApp([alpha, beta, gamma]), getCandidateFiles);

    const first = await port.list({ action: 'list', path: 'Projects', cursor: 0, limit: 1 });
    candidates = [alpha, beta, gamma];
    const second = await port.list({
      action: 'list',
      path: 'Projects',
      cursor: first.nextCursor ?? 0,
      limit: 1,
    });
    const refreshed = await port.list({
      action: 'list',
      path: 'Projects',
      cursor: 0,
      limit: 10,
    });

    expect(first).toMatchObject({ files: [{ path: alpha.path }], nextCursor: 1, total: 2 });
    expect(second).toMatchObject({ files: [{ path: beta.path }], nextCursor: null, total: 2 });
    expect(refreshed.total).toBe(3);
    expect(getCandidateFiles).toHaveBeenCalledTimes(2);
  });

  it('임베딩 엔진이 없어도 Rust lexical plan으로 Vault를 검색한다', async () => {
    const app = createApp([
      createFile('Projects/Alpha.md', '핵심 고객 문제를 해결하는 제품 전략'),
      createFile('Projects/Beta.md', '주말 장보기 목록'),
    ]);
    const port = createNativeVaultPort(app);

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result).toMatchObject({ query: '고객 문제', path: '', match: 'all' });
    expect(result.hits[0]?.path).toBe('Projects/Alpha.md');
    expect(result.hits[0]?.preview).toContain('고객 문제');
    expect(result.hits[0]?.requiresRead).toBe(true);
    expect(result.citations[0]).toMatchObject({
      filePath: 'Projects/Alpha.md',
      status: 'candidate',
    });
  });

  it('lexical 검색 출처는 파일 첫 줄이 아니라 실제 일치 행을 가리킨다', async () => {
    const content = [
      '# 회의 기록',
      ...Array.from({ length: 30 }, (_, index) => `무관한 기록 ${index + 1}`),
      '고객 이탈의 직접 원인은 느린 온보딩이었다.',
      '후속 실험을 다음 주에 시작한다.',
    ].join('\n');
    const port = createNativeVaultPort(createApp([createFile('Projects/Retention.md', content)]));

    const result = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: 'Projects/Retention.md',
      startLine: 32,
    });
    expect(result.hits[0]?.preview).toContain('고객 이탈');
    expect(result.citations[0]).toMatchObject({
      filePath: 'Projects/Retention.md',
      line: 32,
      status: 'candidate',
    });
    expect(result.hits[0]?.requiresRead).toBe(true);
    expect(result.citations[0]?.preview).not.toContain('무관한 기록 1');
  });

  it('모든 검색어가 서로 다른 행에만 있으면 읽기 전 출처를 후보로 표시한다', async () => {
    const port = createNativeVaultPort(
      createApp([createFile('Projects/Spread.md', '고객 인터뷰\n중간 기록\n이탈 원인')]),
    );

    const result = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.preview).toContain('고객');
    expect(result.hits[0]?.requiresRead).toBe(true);
    expect(result.citations[0]).toMatchObject({
      filePath: 'Projects/Spread.md',
      line: 1,
      status: 'candidate',
    });
  });

  it('검색어가 파일 경로에만 있으면 본문 출처를 검증된 것으로 표시하지 않는다', async () => {
    const port = createNativeVaultPort(
      createApp([createFile('Projects/Aurora.md', '본문에는 프로젝트 이름이 없다.')]),
    );

    const result = await port.search({
      action: 'search',
      query: 'Aurora',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: 'Projects/Aurora.md',
      citationStatus: 'candidate',
      requiresRead: true,
    });
    expect(result.citations[0]).toMatchObject({
      filePath: 'Projects/Aurora.md',
      status: 'candidate',
    });
  });

  it('정상 인덱스가 있으면 상위 후보만 사용하고 Vault 본문을 읽지 않는다', async () => {
    const alpha = createFile('Projects/Alpha.md', '현재 본문');
    const indexedResults = [
      {
        sourcePath: alpha.path,
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 2,
        chunkRange: { startLine: 4, endLine: 5 },
        entry: {
          id: 'alpha',
          vector: [],
          metadata: {
            filePath: alpha.path,
            text: '인덱스의 고객 문제 후보',
            startLine: 4,
            endLine: 5,
          },
        },
      },
    ] satisfies QueryResult[];
    const query = vi.fn(() => Promise.resolve(indexedResults));
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const app = createApp([alpha], {}, cachedRead);
    const port = createNativeVaultPort(app, undefined, () => ({ query }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 2,
      match: 'all',
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        path: alpha.path,
        citationStatus: 'candidate',
        requiresRead: true,
      }),
    ]);
    expect(result).toMatchObject({
      scannedFiles: 0,
      unreadableFiles: 0,
      totalHits: 1,
      truncated: true,
    });
    expect(query).toHaveBeenCalledWith('고객 문제', 2, undefined, undefined);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('인덱스 검색은 전체 후보 목록 대신 반환된 상위 경로만 검증한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '현재 본문');
    const indexedResults = [
      {
        sourcePath: alpha.path,
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 1,
        chunkRange: { startLine: 1, endLine: 1 },
        entry: {
          id: 'alpha',
          vector: [],
          metadata: {
            filePath: alpha.path,
            text: '후보',
            startLine: 1,
            endLine: 1,
          },
        },
      },
    ] satisfies QueryResult[];
    const listCandidateFiles = vi.fn(() => Promise.resolve([alpha]));
    const isCandidateFile = vi.fn(() => Promise.resolve(true));
    const port = new ObsidianNativeVaultToolPort(
      createApp([alpha]),
      {
        listCandidateFiles,
        isCandidateFile,
        isPathVisible: () => true,
      },
      () => ({ query: vi.fn(() => Promise.resolve(indexedResults)) }),
    );

    const result = await port.search({
      action: 'search',
      query: '후보',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits).toHaveLength(1);
    expect(listCandidateFiles).not.toHaveBeenCalled();
    expect(isCandidateFile).toHaveBeenCalledOnce();
  });

  it('정상 인덱스의 의미 기반 후보는 어휘가 모두 겹치지 않아도 read 후보로 보존한다', async () => {
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
    const file = createFile('Bible/Genesis.md', '창세기 본문');
    const cachedRead = vi.fn((candidate: TFile & { content: string }) =>
      Promise.resolve(candidate.content),
    );
    const app = createApp([file], {}, cachedRead);
    const port = createNativeVaultPort(app, undefined, () => ({ query }));

    const result = await port.search({
      action: 'search',
      query: '네빌 창세기',
      path: '',
      limit: 8,
      match: 'all',
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        path: 'Bible/Genesis.md',
        citationStatus: 'candidate',
        requiresRead: true,
      }),
    ]);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('정상 인덱스가 빈 결과를 반환해도 전체 lexical 스캔으로 되돌아가지 않는다', async () => {
    const files = [
      createFile('Projects/Alpha.md', '고객 문제'),
      createFile('Projects/Beta.md', '고객 문제'),
    ];
    const query = vi.fn(() => Promise.resolve([]));
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(createApp(files, {}, cachedRead), undefined, () => ({
      query,
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits).toEqual([]);
    expect(result).toMatchObject({
      scannedFiles: 0,
      unreadableFiles: 0,
      totalHits: 0,
      truncated: true,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('정상 인덱스가 비어도 질문과 일치하는 파일 경로는 본문 I/O 없이 read 후보로 돌려준다', async () => {
    const files = [
      createFile('neville/A Lesson in Scripture.txt', '본문에는 이름이 없다.'),
      createFile('neville/A Prophecy.txt', '예언에 관한 본문'),
      createFile('bible/Genesis.md', '창세기 본문'),
    ];
    const query = vi.fn(() => Promise.resolve([]));
    const listCandidateFiles = vi.fn(() => Promise.resolve(files));
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(
      createApp(files, {}, cachedRead),
      listCandidateFiles,
      () => ({ query }),
    );

    const result = await port.search({
      action: 'search',
      query: 'Neville',
      path: '',
      limit: 8,
      match: 'all',
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        path: 'neville/A Lesson in Scripture.txt',
        citationStatus: 'candidate',
        requiresRead: true,
      }),
      expect.objectContaining({
        path: 'neville/A Prophecy.txt',
        citationStatus: 'candidate',
        requiresRead: true,
      }),
    ]);
    expect(result).toMatchObject({
      scannedFiles: 3,
      unreadableFiles: 0,
      totalHits: 2,
      truncated: false,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(listCandidateFiles).toHaveBeenCalledOnce();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('인덱스 질의가 실패할 때만 lexical fallback으로 후보 파일을 읽는다', async () => {
    const files = [
      createFile('Projects/Alpha.md', '핵심 고객 문제'),
      createFile('Projects/Beta.md', '무관한 문서'),
    ];
    const query = vi.fn(() => Promise.reject(new Error('index unavailable')));
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(createApp(files, {}, cachedRead), undefined, () => ({
      query,
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: 'Projects/Alpha.md',
      citationStatus: 'candidate',
      requiresRead: true,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it('indexed 후보는 일치 행을 계산하되 live read 전에는 후보 상태를 유지한다', async () => {
    const indexedResults = [
      {
        sourcePath: 'Archive/Record.md',
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 2,
        chunkRange: { startLine: 40, endLine: 42 },
        entry: {
          id: 'record',
          vector: [],
          metadata: {
            filePath: 'Archive/Record.md',
            text: '무관한 과거 문장\n고객 이탈의 직접 원인\n후속 기록',
            startLine: 40,
            endLine: 42,
          },
        },
      },
    ] satisfies QueryResult[];
    const query = vi.fn(() => Promise.resolve(indexedResults));
    const app = createApp([createFile('Archive/Record.md', '현재 본문에는 관련 내용이 없음')]);
    const port = createNativeVaultPort(app, undefined, () => ({ query }));

    const result = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: 'Archive/Record.md',
      startLine: 41,
      citationStatus: 'candidate',
      requiresRead: true,
    });
    expect(result.hits[0]?.preview).toContain('고객 이탈');
    expect(result.citations[0]).toMatchObject({
      filePath: 'Archive/Record.md',
      line: 41,
      status: 'candidate',
    });
  });

  it('현재 RAG 후보에서 빠진 오래된 indexed 결과와 직접 read를 함께 차단한다', async () => {
    const visible = createFile('Notes/Current.md', '현재 근거');
    const excluded = createFile('Logs/secret.log', '고객 이탈 비밀 근거');
    const indexedResults = [
      {
        sourcePath: excluded.path,
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 2,
        chunkRange: { startLine: 1, endLine: 1 },
        entry: {
          id: 'stale-log',
          vector: [],
          metadata: {
            filePath: excluded.path,
            text: excluded.content,
            startLine: 1,
            endLine: 1,
          },
        },
      },
    ] satisfies QueryResult[];
    const query = vi.fn(() => Promise.resolve(indexedResults));
    const port = createNativeVaultPort(
      createApp([visible, excluded]),
      () => Promise.resolve([visible]),
      () => ({ query }),
    );

    const search = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(search.hits).toEqual([]);
    await expect(
      port.read({
        action: 'read',
        path: excluded.path,
        startLine: 1,
        endLine: null,
      }),
    ).rejects.toThrow(excluded.path);
  });

  it('비상 lexical 검색은 큰 Vault를 제한된 I/O 배치로 읽는다', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    let totalReads = 0;
    const files = Array.from({ length: 25 }, (_, index) =>
      createFile(`Notes/${index}.md`, index === 24 ? '마지막 고객 근거' : `문서 ${index}`),
    );
    const app = createApp(files, {}, async (file) => {
      activeReads++;
      totalReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return file.content;
    });

    const result = await createNativeVaultPort(app).search({
      action: 'search',
      query: '고객 근거',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.path).toBe('Notes/24.md');
    expect(maxActiveReads).toBeLessThanOrEqual(8);
    expect(totalReads).toBe(25);
  });

  it('검색 결과가 제한되면 전체 스캔 수와 잘림 여부를 함께 반환한다', async () => {
    const files = Array.from({ length: 25 }, (_, index) =>
      createFile(`Notes/${index}.md`, `공통 근거 ${index}`),
    );

    const result = await createNativeVaultPort(createApp(files)).search({
      action: 'search',
      query: '공통 근거',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result).toMatchObject({
      scannedFiles: 25,
      unreadableFiles: 0,
      totalHits: 25,
      truncated: true,
    });
    expect(result.hits).toHaveLength(3);
  });

  it('links는 Obsidian 링크 그래프에서 outgoing과 incoming을 함께 찾는다', async () => {
    const alpha = createFile('Projects/Alpha.md', '[[Beta]]');
    const beta = createFile('Projects/Beta.md', 'beta');
    const gamma = createFile('Projects/Gamma.md', '[[Alpha]]');
    const excluded = createFile('Archive/Hidden.md', '[[Alpha]]');
    const app = createApp([alpha, beta, gamma, excluded], {
      'Projects/Alpha.md': { 'Projects/Beta.md': 1, 'Archive/Hidden.md': 1 },
      'Projects/Gamma.md': { 'Projects/Alpha.md': 1 },
      'Archive/Hidden.md': { 'Projects/Alpha.md': 1 },
    });
    const port = createNativeVaultPort(app, () => Promise.resolve([alpha, beta, gamma]));

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

  it('stats는 현재 RAG 후보 파일 개수와 전체 크기를 반환한다', async () => {
    const app = createApp([createFile('Alpha.md', '1234'), createFile('Beta.md', '123456')]);
    const port = createNativeVaultPort(app);

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

    const result = await createNativeVaultPort(app).search({
      action: 'search',
      query: '네빌 창세기',
      path: '',
      limit: 8,
      match: 'all',
    });

    expect(result.hits.map((hit) => hit.path)).toEqual(['Research/Neville-Genesis.md']);
  });

  it('제외 경로는 모든 Vault 탐색 액션에서 일관되게 숨긴다', async () => {
    const visible = createFile('Notes/Genesis.md', '창세기');
    const excluded = createFile('SuperpowerInsideChats/Current.md', '네빌 창세기');
    const app = createApp([visible, excluded]);
    const port = createNativeVaultPort(app, () => Promise.resolve([visible]));

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
    await expect(
      port.links({
        action: 'links',
        path: 'SuperpowerInsideChats/Current.md',
        direction: 'both',
        limit: 10,
      }),
    ).rejects.toThrow('SuperpowerInsideChats/Current.md');
  });

  it('허용된 빈 폴더만 존재로 표시하고 후보에서 제외된 파일 경로는 숨긴다', async () => {
    const excludedFile = createFile('Secrets/.env', 'TOKEN=secret');
    const emptyFolder = createFolder('Empty');
    const app = createApp([excludedFile], {}, undefined, [emptyFolder]);
    const port = createNativeVaultPort(app, () => Promise.resolve([]));

    const empty = await port.list({ action: 'list', path: 'Empty', cursor: 0, limit: 10 });
    const excluded = await port.list({
      action: 'list',
      path: excludedFile.path,
      cursor: 0,
      limit: 10,
    });
    const missing = await port.list({ action: 'list', path: 'Missing', cursor: 0, limit: 10 });

    expect(empty).toMatchObject({ exists: true, total: 0, files: [] });
    expect(excluded).toMatchObject({ exists: false, total: 0, files: [] });
    expect(missing).toMatchObject({ exists: false, total: 0, files: [] });
  });
});

function createNativeVaultPort(
  app: App,
  getCandidateFiles: () => Promise<readonly TFile[]> = () => Promise.resolve(app.vault.getFiles()),
  getQueryEngine: () => NativeVaultQueryEngineLike | null = () => null,
): ObsidianNativeVaultToolPort {
  return new ObsidianNativeVaultToolPort(
    app,
    {
      listCandidateFiles: getCandidateFiles,
      isCandidateFile: async (file) =>
        (await getCandidateFiles()).some((candidate) => candidate.path === file.path),
      isPathVisible: () => true,
    },
    getQueryEngine,
  );
}

function createFile(path: string, content: string): TFile & { content: string } {
  const name = path.split('/').at(-1) ?? path;
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : '';
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name,
    basename: extension ? name.slice(0, -(extension.length + 1)) : name,
    extension,
    content,
    stat: { ctime: 1, mtime: 2, size: content.length },
  }) as TFile & { content: string };
}

function createFolder(path: string): TFolder {
  return Object.assign(Object.create(TFolder.prototype), {
    path,
    name: path.split('/').at(-1) ?? path,
    children: [],
  }) as TFolder;
}

function createApp(
  files: Array<TFile & { content: string }>,
  resolvedLinks: Record<string, Record<string, number>> = {},
  cachedRead: (file: TFile & { content: string }) => Promise<string> = (file) =>
    Promise.resolve(file.content),
  folders: readonly TFolder[] = [],
): App {
  const byPath = new Map([...files, ...folders].map((file) => [file.path, file]));
  return {
    vault: {
      getFiles: () => files,
      getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
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
