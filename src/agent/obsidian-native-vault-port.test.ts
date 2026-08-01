import { TFile, TFolder, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { RAGQueryEngine, type QueryResult } from '../rag/query';
import { MemoryVectorStore } from '../rag/store';
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

  it('read는 큰 한 줄을 손실 없이 런타임 경계로 전달한다', async () => {
    const port = createNativeVaultPort(
      createApp([createFile('Projects/Large.md', '한글🙂'.repeat(100_000))]),
    );

    const result = await port.read({
      action: 'read',
      path: 'Projects/Large.md',
      startLine: 1,
      endLine: 1,
    });

    expect(result).toMatchObject({
      startLine: 1,
      startOffset: 0,
      endLine: 1,
      nextStartLine: null,
      nextStartOffset: null,
      truncated: false,
    });
    expect(result.content).toBe('한글🙂'.repeat(100_000));
  });

  it('read continuation offset은 같은 행의 다음 UTF-16 경계부터 정확히 이어 읽는다', async () => {
    const port = createNativeVaultPort(
      createApp([createFile('Projects/Offset.md', 'abc🙂def\n둘째 줄')]),
    );

    const result = await port.read({
      action: 'read',
      path: 'Projects/Offset.md',
      startLine: 1,
      startOffset: 5,
      endLine: 1,
    });

    expect(result).toMatchObject({ startLine: 1, startOffset: 5, content: 'def' });
    await expect(
      port.read({
        action: 'read',
        path: 'Projects/Offset.md',
        startLine: 1,
        startOffset: 4,
        endLine: 1,
      }),
    ).rejects.toThrow();
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
    const port = createNativeVaultPort(app, undefined, () =>
      createReadyQueryEngineDouble(query),
    );

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
    expect(query).toHaveBeenCalledWith(
      '고객 문제',
      2,
      undefined,
      undefined,
      { fileBackedOnly: true },
    );
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('related는 지정한 문서 본문을 임베딩 검색 시드로 삼고 자기 자신은 제외한다', async () => {
    const seed = createFile('Notes/Seed.md', '고객 온보딩 마찰과 이탈 원인\n실험 결과');
    const neighbor = createFile('Notes/Neighbor.md', '첫 세션 이탈 감소 실험');
    const query = vi.fn(() =>
      Promise.resolve([
        createQueryResult(seed.path, 'seed-entry', 1, ['vector'], 'vector'),
        createQueryResult(neighbor.path, 'neighbor-entry', 7, ['vector', 'bm25'], 'keyword-vector'),
      ]),
    );
    const port = createNativeVaultPort(createApp([seed, neighbor]), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.related({
      action: 'related',
      path: seed.path,
      startLine: 1,
      endLine: null,
      limit: 3,
    });

    expect(query).toHaveBeenCalledWith(seed.content, 7, 0, undefined, {
      fileBackedOnly: true,
    });
    expect(result).toMatchObject({
      action: 'related',
      path: seed.path,
      startLine: 1,
      endLine: 2,
      truncated: false,
    });
    expect(result.hits).toEqual([
      expect.objectContaining({
        path: neighbor.path,
        retrievalSources: ['vector', 'bm25'],
        requiresRead: true,
      }),
    ]);
    expect(result.citations).toEqual([
      expect.objectContaining({ filePath: neighbor.path, status: 'candidate' }),
    ]);
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
      () => createReadyQueryEngineDouble(vi.fn(() => Promise.resolve(indexedResults))),
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
    const port = createNativeVaultPort(app, undefined, () => createReadyQueryEngineDouble(query));

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
    const listCandidateFiles = vi.fn(() => Promise.resolve(files));
    const port = createNativeVaultPort(
      createApp(files, {}, cachedRead),
      listCandidateFiles,
      () => createReadyQueryEngineDouble(query),
    );

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
    expect(listCandidateFiles).not.toHaveBeenCalled();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('여러 indexed query 결과를 entry 기준 RRF로 융합하고 bounded provenance를 보존한다', async () => {
    const alpha = createFile('Notes/Alpha.md', 'alpha');
    const beta = createFile('Notes/Beta.md', 'beta');
    const gamma = createFile('Notes/Gamma.md', 'gamma');
    const byQuery: Record<string, QueryResult[]> = {
      'customer retention': [
        createQueryResult(alpha.path, 'alpha-entry', 10, ['vector'], 'vector'),
        createQueryResult(beta.path, 'beta-entry', 20, ['bm25'], 'keyword'),
      ],
      'onboarding churn': [
        createQueryResult(gamma.path, 'gamma-entry', 30, ['graph-local'], 'strong-graph-evidence'),
        createQueryResult(beta.path, 'beta-entry', 20, ['vector', 'bm25'], 'keyword-vector'),
      ],
    };
    const query = vi.fn((question: string) => Promise.resolve(byQuery[question] ?? []));
    const port = createNativeVaultPort(createApp([alpha, beta, gamma]), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: 'customer retention',
      queries: ['customer retention', 'onboarding churn'],
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      'customer retention',
      3,
      undefined,
      undefined,
      { fileBackedOnly: true },
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      'onboarding churn',
      3,
      undefined,
      undefined,
      { fileBackedOnly: true },
    );
    expect(result.hits[0]).toMatchObject({
      path: beta.path,
      retrievalSources: ['bm25', 'vector'],
      selectionReason: 'keyword',
      matchedQueries: ['customer retention', 'onboarding churn'],
      recommendedReadRange: { startLine: 21, endLine: 21 },
      requiresRead: true,
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([beta.path, alpha.path, gamma.path]);
  });

  it('indexed query가 대기 중 취소되면 즉시 중단하고 다음 query를 시작하지 않는다', async () => {
    const firstQuery = createDeferred<QueryResult[]>();
    const query = vi
      .fn<NativeVaultQueryEngineLike['query']>()
      .mockImplementationOnce(() => firstQuery.promise)
      .mockResolvedValue([]);
    const file = createFile('Notes/Alpha.md', 'alpha');
    const controller = new AbortController();
    const port = createNativeVaultPort(createApp([file]), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [createRetrievalDiagnostic('ready')],
    }));

    const execution = port.search(
      {
        action: 'search',
        query: 'first query',
        queries: ['first query', 'second query'],
        path: '',
        limit: 3,
        match: 'all',
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());

    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      'first query',
      3,
      undefined,
      undefined,
      { fileBackedOnly: true, signal: controller.signal },
    );
    firstQuery.resolve([]);
  });

  it('indexed 결과가 비어 있고 진단이 stale이면 live lexical fallback을 실행한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '핵심 고객 문제');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [createRetrievalDiagnostic('stale')],
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: alpha.path,
      retrievalSources: ['live-lexical'],
      selectionReason: 'keyword',
      recommendedReadRange: { startLine: 1, endLine: 1 },
    });
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('여러 검색어 중 하나라도 core retrieval이 timeout이면 live lexical fallback을 실행한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '두 번째 질문 근거');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    let completedQueries = 0;
    const query = vi.fn(() => {
      completedQueries++;
      return Promise.resolve([]);
    });
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [
        {
          ...createRetrievalDiagnostic('ready', 'vector'),
          status: completedQueries === 1 ? ('ok' as const) : ('timeout' as const),
        },
      ],
    }));

    const result = await port.search({
      action: 'search',
      query: '첫 번째 질문',
      queries: ['첫 번째 질문', '두 번째 질문'],
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(result.hits[0]?.path).toBe(alpha.path);
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('vector가 stale이고 BM25가 timeout이면 live lexical 근거를 함께 탐색한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '현재 고객 근거');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [
        createRetrievalDiagnostic('stale', 'vector'),
        { ...createRetrievalDiagnostic('ready', 'bm25'), status: 'timeout' as const },
      ],
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 근거',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: alpha.path,
      retrievalSources: ['live-lexical'],
    });
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('선택적 GraphRAG만 partial이고 core vector가 ready이면 live scan을 실행하지 않는다', async () => {
    const alpha = createFile('Projects/Alpha.md', '핵심 고객 문제');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [
        createRetrievalDiagnostic('partial', 'graph-local'),
        createRetrievalDiagnostic('ready', 'vector'),
      ],
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits).toEqual([]);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('선택적 GraphRAG가 ready여도 core vector가 stale이면 live scan을 실행한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '핵심 고객 문제');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [
        createRetrievalDiagnostic('ready', 'graph-local'),
        createRetrievalDiagnostic('stale', 'vector'),
      ],
    }));

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.path).toBe(alpha.path);
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('stale indexed semantic 근거와 live lexical 새 노트를 bounded RRF로 함께 보존한다', async () => {
    const oldNote = createFile('Projects/Old.md', '현재 본문에는 검색어가 없다.');
    const newNote = createFile('Projects/New.md', '새로운 고객 이탈 근거');
    const sharedNote = createFile('Projects/Shared.md', '공유 고객 이탈 근거');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() =>
      Promise.resolve([
        createQueryResult(oldNote.path, 'old-entry', 7, ['vector'], 'vector'),
        createQueryResult(sharedNote.path, 'shared-entry', 20, ['bm25'], 'keyword'),
      ]),
    );
    const port = createNativeVaultPort(
      createApp([oldNote, newNote, sharedNote], {}, cachedRead),
      undefined,
      () => ({
        query,
        getLastRetrievalDiagnostics: () => [
          createRetrievalDiagnostic('stale', 'vector'),
        ],
      }),
    );

    const result = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits.map((hit) => hit.path)).toHaveLength(3);
    expect(result.hits.map((hit) => hit.path)).toEqual(
      expect.arrayContaining([oldNote.path, newNote.path, sharedNote.path]),
    );
    expect(result.hits.find((hit) => hit.path === oldNote.path)).toMatchObject({
      retrievalSources: ['vector'],
      matchedQueries: ['고객 이탈'],
      recommendedReadRange: { startLine: 8, endLine: 8 },
    });
    expect(result.hits.find((hit) => hit.path === newNote.path)).toMatchObject({
      retrievalSources: ['live-lexical'],
      matchedQueries: ['고객 이탈'],
      recommendedReadRange: { startLine: 1, endLine: 1 },
    });
    expect(result.hits.filter((hit) => hit.path === sharedNote.path)).toEqual([
      expect.objectContaining({
        retrievalSources: ['live-lexical', 'bm25'],
        matchedQueries: ['고객 이탈'],
        recommendedReadRange: { startLine: 1, endLine: 1 },
      }),
    ]);
    expect(result.citations.map((citation) => citation.filePath)).toHaveLength(3);
    expect(cachedRead).toHaveBeenCalledTimes(3);
  });

  it('production vector file record가 stale 또는 missing이면 live lexical을 함께 탐색한다', async () => {
    const indexedNote = createFile('Projects/Indexed.md', '현재 본문에는 검색어가 없다.');
    const newNote = createFile('Projects/New-Live.md', '새 고객 이탈 근거');
    const store = new MemoryVectorStore();
    await store.add([
      {
        id: 'indexed-production-entry',
        vector: [1, 0],
        metadata: {
          filePath: indexedNote.path,
          startLine: 0,
          endLine: 0,
          text: 'semantic retention evidence',
          sourceMtime: indexedNote.stat.mtime - 1,
          sourceSize: indexedNote.stat.size,
          contentHash: 'indexed-content',
          indexedAt: 1,
          embeddingProvider: 'test-provider',
          embeddingModel: 'test-model',
        },
      },
    ]);
    const engine = new RAGQueryEngine(
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      undefined,
      0.3,
      0,
      { embeddingModel: 'test-model' },
    );
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(
      createApp([indexedNote, newNote], {}, cachedRead),
      undefined,
      () => engine,
    );

    const result = await port.search({
      action: 'search',
      query: '고객 이탈',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits.map((hit) => hit.path)).toEqual(
      expect.arrayContaining([indexedNote.path, newNote.path]),
    );
    expect(result.hits.find((hit) => hit.path === newNote.path)?.retrievalSources).toEqual([
      'live-lexical',
    ]);
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it('production vector file records가 healthy이면 Vault 본문을 다시 읽지 않는다', async () => {
    const indexedNote = createFile('Projects/Healthy.md', '현재 본문');
    const store = new MemoryVectorStore();
    await store.add([
      {
        id: 'healthy-production-entry',
        vector: [1, 0],
        metadata: {
          filePath: indexedNote.path,
          startLine: 0,
          endLine: 0,
          text: 'semantic healthy evidence',
          sourceMtime: indexedNote.stat.mtime,
          sourceSize: indexedNote.stat.size,
          contentHash: 'healthy-content',
          indexedAt: 1,
          embeddingProvider: 'test-provider',
          embeddingModel: 'test-model',
        },
      },
    ]);
    const engine = new RAGQueryEngine(
      store,
      {
        embed: () => Promise.resolve([1, 0]),
        embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0])),
      },
      undefined,
      0.3,
      0,
      { embeddingModel: 'test-model' },
    );
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(
      createApp([indexedNote], {}, cachedRead),
      undefined,
      () => engine,
    );

    const result = await port.search({
      action: 'search',
      query: 'healthy semantic',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]?.path).toBe(indexedNote.path);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('indexed 결과가 모두 숨김 대상이어도 ready 진단이면 live scan을 하지 않는다', async () => {
    const visible = createFile('Notes/Visible.md', '현재 근거');
    const hidden = createFile('Notes/Hidden.md', '숨긴 근거');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const listCandidateFiles = vi.fn(() => Promise.resolve([visible]));
    const query = vi.fn(() =>
      Promise.resolve([createQueryResult(hidden.path, 'hidden-entry', 1, ['vector'], 'vector')]),
    );
    const port = new ObsidianNativeVaultToolPort(
      createApp([visible, hidden], {}, cachedRead),
      {
        listCandidateFiles,
        isCandidateFile: (file) => Promise.resolve(file.path === visible.path),
        isPathVisible: () => true,
      },
      () => createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: '근거',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits).toEqual([]);
    expect(listCandidateFiles).not.toHaveBeenCalled();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('stale 인덱스가 비면 파일 경로까지 포함한 live lexical 후보를 돌려준다', async () => {
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
      () => ({
        query,
        getLastRetrievalDiagnostics: () => [createRetrievalDiagnostic('stale')],
      }),
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
    expect(cachedRead).toHaveBeenCalledTimes(3);
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

  it('indexed synthetic 일치 행 대신 실제 chunkRange를 400행 상한으로 권장한다', async () => {
    const indexedResults = [
      {
        sourcePath: 'Archive/Record.md',
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 2,
        chunkRange: { startLine: 40, endLine: 640 },
        entry: {
          id: 'record',
          vector: [],
          metadata: {
            filePath: 'Archive/Record.md',
            text: '무관한 과거 문장\n고객 이탈의 직접 원인\n후속 기록',
            startLine: 40,
            endLine: 640,
          },
        },
      },
    ] satisfies QueryResult[];
    const query = vi.fn(() => Promise.resolve(indexedResults));
    const app = createApp([createFile('Archive/Record.md', '현재 본문에는 관련 내용이 없음')]);
    const port = createNativeVaultPort(app, undefined, () => createReadyQueryEngineDouble(query));

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
      endLine: 440,
      recommendedReadRange: { startLine: 41, endLine: 440 },
      citationStatus: 'candidate',
      requiresRead: true,
    });
    expect(result.hits[0]?.preview).toContain('고객 이탈');
    expect(result.citations[0]).toMatchObject({
      filePath: 'Archive/Record.md',
      line: 41,
      endLine: 440,
      status: 'candidate',
    });
  });

  it('0-based 첫 chunk 행을 read와 citation의 1행으로 변환한다', async () => {
    const first = createFile('Archive/First.md', '첫 행 근거');
    const query = vi.fn(() =>
      Promise.resolve([
        createQueryResult(first.path, 'first-entry', 0, ['vector'], 'vector'),
      ]),
    );
    const port = createNativeVaultPort(createApp([first]), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: '첫 행',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      startLine: 1,
      endLine: 1,
      recommendedReadRange: { startLine: 1, endLine: 1 },
    });
    expect(result.citations[0]).toMatchObject({ line: 1, endLine: 1 });
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

  it('lexical read batch가 대기 중 취소되면 즉시 중단하고 다음 batch를 읽지 않는다', async () => {
    const readBatch = createDeferred<string>();
    const files = Array.from({ length: 9 }, (_, index) =>
      createFile(`Notes/${index}.md`, `문서 ${index}`),
    );
    const cachedRead = vi.fn(() => readBatch.promise);
    const controller = new AbortController();
    const port = createNativeVaultPort(createApp(files, {}, cachedRead));

    const execution = port.search(
      {
        action: 'search',
        query: '문서',
        path: '',
        limit: 3,
        match: 'all',
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(8));

    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    expect(cachedRead).toHaveBeenCalledTimes(8);
    readBatch.resolve('문서');
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

function createReadyQueryEngineDouble(
  query: NativeVaultQueryEngineLike['query'],
): NativeVaultQueryEngineLike {
  return {
    query,
    getLastRetrievalDiagnostics: () => [createRetrievalDiagnostic('ready')],
  };
}

function createRetrievalDiagnostic(
  readiness: 'cold' | 'partial' | 'ready' | 'stale' | 'degraded',
  source: 'vector' | 'ann' | 'bm25' | 'structural' | 'graph-local' = 'bm25',
) {
  return {
    providerId: 'test-provider',
    source,
    status: 'ok' as const,
    durationMs: 1,
    candidateCount: 0,
    readiness,
    estimatedCost: 'free' as const,
  };
}

function createQueryResult(
  path: string,
  id: string,
  startLine: number,
  retrievalSources: string[],
  selectionReason: NonNullable<QueryResult['selectionReason']>,
): QueryResult {
  return {
    sourcePath: path,
    score: 0.9,
    vectorScore: 0.9,
    bm25Score: 0,
    combinedScore: 0.9,
    keywordMatches: 1,
    retrievalSources,
    selectionReason,
    chunkRange: { startLine, endLine: startLine },
    entry: {
      id,
      vector: [],
      metadata: {
        filePath: path,
        text: `indexed evidence for ${path}`,
        startLine,
        endLine: startLine,
      },
    },
  };
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}
