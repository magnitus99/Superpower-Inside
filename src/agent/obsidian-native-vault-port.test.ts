import { TFile, TFolder, type App } from 'obsidian';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { RAGQueryEngine, type QueryResult } from '../rag/query';
import { MemoryVectorStore } from '../rag/store';
import { createContentHash } from '../rag/hash';
import type { RAGConfig, ChatConfig } from '../settings';
import { RagNativeVaultFileScope } from './rag-native-vault-file-scope';
import { NativeVaultToolRuntime } from './native-vault-tool';
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
  return {
    getFrontMatterInfo: (content: string) => {
      const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
      return { exists: match !== null, frontmatter: match?.[1] ?? '' };
    },
    parseYaml: (source: string): unknown => {
      const yaml = createRequire(import.meta.url)('js-yaml') as {
        load: (source: string) => unknown;
      };
      return yaml.load(source);
    },
    TFile: MockTFile,
    TFolder: MockTFolder,
    getAllTags: (cache: { tags?: { tag: string }[]; frontmatter?: { tags?: string[] } }) => [
      ...(cache.tags?.map((tag) => tag.tag) ?? []),
      ...(cache.frontmatter?.tags ?? []),
    ],
  };
});

describe('Obsidian 네이티브 Vault 포트', () => {
  it('어휘 검색에서 읽은 revision을 여러 문서의 후속 읽기와 다음 질문에서도 재사용한다', async () => {
    const files = [
      createFile('Synthetic/First.txt', 'Quartz cooling requires two cycles.'),
      createFile('Synthetic/Second.txt', 'Quartz cooling requires a closed valve.'),
    ];
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    const port = createNativeVaultPort(createApp(files, {}, cachedRead));
    const search = {
      action: 'search' as const,
      query: 'quartz',
      path: '',
      limit: 8,
      match: 'any' as const,
      mode: 'word' as const,
    };
    await port.search(search);
    for (const file of [...files, files[0]]) {
      const result = await port.read({ action: 'read', path: file.path, startLine: 1, endLine: null });
      expect(result.content).toBe(file.content);
    }
    await port.search({ ...search, query: 'valve' });
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it('원문 캐시가 있어도 변경된 revision과 현재 읽기 제외 정책을 적용한다', async () => {
    const file = createFile('Synthetic/Changing.txt', 'Quartz cooling requires two cycles.');
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    let allowed = true;
    const port = createNativeVaultPort(createApp([file], {}, cachedRead), () =>
      Promise.resolve(allowed ? [file] : []),
    );
    const read = { action: 'read' as const, path: file.path, startLine: 1, endLine: null };
    await port.read(read);
    file.content = 'Quartz cooling requires three cycles.';
    file.stat.mtime++;
    expect((await port.read(read)).content).toBe(file.content);
    allowed = false;
    await expect(port.read(read)).rejects.toThrow();
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it('원문 캐시의 문서 수 상한을 넘으면 가장 오래 사용하지 않은 문서를 다시 읽는다', async () => {
    const files = Array.from({ length: 129 }, (_, index) =>
      createFile(`Synthetic/Cache-${index}.txt`, 'Quartz cooling requires two cycles.'),
    );
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    const port = createNativeVaultPort(createApp(files, {}, cachedRead));
    for (const file of files) {
      await port.read({ action: 'read', path: file.path, startLine: 1, endLine: null });
    }
    await port.read({ action: 'read', path: files[128].path, startLine: 1, endLine: null });
    expect(cachedRead).toHaveBeenCalledTimes(129);
    await port.read({ action: 'read', path: files[0].path, startLine: 1, endLine: null });
    expect(cachedRead).toHaveBeenCalledTimes(130);
  });

  it('취소된 읽기가 늦게 완료되어도 다음 질문의 원문 캐시로 사용하지 않는다', async () => {
    const file = createFile('Synthetic/Delayed.txt', 'A documented cooling condition.');
    const pending = createDeferred<string>();
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    cachedRead.mockImplementationOnce(() => pending.promise);
    const port = createNativeVaultPort(createApp([file], {}, cachedRead));
    const request = { action: 'read' as const, path: file.path, startLine: 1, endLine: null };
    const controller = new AbortController();
    const reading = port.read(request, controller.signal);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledOnce());
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    pending.resolve(file.content);
    expect((await port.read(request)).content).toBe(file.content);
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it.each(['deleted', 'replaced'] as const)(
    '목록의 과거 파일 객체가 %s 상태면 캐시된 본문을 검색 결과로 반환하지 않는다',
    async (state) => {
      const file = createFile('Synthetic/Stale-list.txt', 'quartz cooling evidence');
      let current: TFile | null = file;
      const cachedRead = vi.fn((source: TFile & { content: string }) =>
        Promise.resolve(source.content),
      );
      const app = createApp([file], {}, cachedRead);
      app.vault.getAbstractFileByPath = () => current;
      const port = createNativeVaultPort(app, () => Promise.resolve([file]));
      const request = {
        action: 'search' as const,
        query: 'quartz',
        path: '',
        limit: 8,
        match: 'any' as const,
        mode: 'word' as const,
      };
      expect((await port.search(request)).hits).toHaveLength(1);
      current = state === 'deleted' ? null : createFile(file.path, 'x'.repeat(file.content.length));
      const result = await port.search(request);
      expect(result.hits).toEqual([]);
      expect(result.unreadableFiles).toBe(1);
      expect(cachedRead).toHaveBeenCalledOnce();
    },
  );

  it('소수의 큰 원문도 캐시 본문 예산을 넘으면 이전 문서를 다시 읽는다', async () => {
    const files = [
      createFile('Synthetic/Large-A.txt', 'x'.repeat(2_200_000)),
      createFile('Synthetic/Large-B.txt', 'y'.repeat(2_200_000)),
    ];
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    const port = createNativeVaultPort(createApp(files, {}, cachedRead));
    const search = {
      action: 'search' as const,
      query: 'quartz',
      path: '',
      limit: 8,
      match: 'any' as const,
      mode: 'word' as const,
    };
    await port.search(search);
    await port.search({ ...search, path: files[0].path });
    expect(cachedRead).toHaveBeenCalledTimes(3);
  });

  it.each(['Synthetic/Record #3.txt', 'Synthetic/A|B.txt', 'Synthetic/Rate%20Plan.txt'])(
    '실제 파일 경로의 링크 특수문자를 헤딩·별칭으로 해석하지 않는다: %s',
    async (path) => {
      const file = createFile(path, 'A synthetic source passage.');
      const result = await createNativeVaultPort(createApp([file])).read({
        action: 'read',
        path,
        startLine: 1,
        endLine: null,
      });
      expect(result.path).toBe(path);
      expect(result.content).toBe(file.content);
    },
  );

  it('긴 문서를 이어 읽을 때 같은 revision의 전체 본문과 메타데이터를 다시 계산하지 않는다', async () => {
    const file = createFile('Synthetic/Long.txt', 'A documented condition.\n'.repeat(1201));
    const cachedRead = vi.fn((source: TFile & { content: string }) =>
      Promise.resolve(source.content),
    );
    const port = createNativeVaultPort(createApp([file], {}, cachedRead));
    for (const startLine of [1, 401, 801, 1201]) {
      await port.read({ action: 'read', path: file.path, startLine, endLine: null });
    }
    expect(cachedRead).toHaveBeenCalledOnce();
    file.content = 'A revised condition.';
    file.stat.mtime++;
    const updated = await port.read({
      action: 'read',
      path: file.path,
      startLine: 1,
      endLine: null,
    });
    expect(updated.content).toBe(file.content);
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });
  it('정상 인덱스의 후보가 있어도 전체 텍스트에서 뒤쪽의 어휘 일치를 함께 찾는다', async () => {
    const files = [
      createFile('Synthetic/Overview.md', 'A general overview of relay maintenance.'),
      ...Array.from({ length: 2001 }, (_, index) =>
        createFile(`Synthetic/Archive-${index}.txt`, 'An unrelated delivery schedule.'),
      ),
      createFile('Synthetic/Tail.txt', 'The quartz relay requires two cooling cycles.'),
    ];
    const query = vi.fn(() =>
      Promise.resolve([createQueryResult(files[0].path, 'overview', 0, ['vector'], 'vector')]),
    );
    const result = await createNativeVaultPort(createApp(files), undefined, () =>
      createReadyQueryEngineDouble(query),
    ).search({ action: 'search', query: 'quartz', path: '', limit: 8, match: 'any' });

    expect(result.scannedFiles).toBe(files.length);
    expect(result.hits.map((hit) => hit.path)).toContain('Synthetic/Tail.txt');
    expect(result.hits.map((hit) => hit.path)).toContain('Synthetic/Overview.md');
    expect(query).toHaveBeenCalledOnce();
  });
  it('원문 변경 시 과거 메타데이터를 남기지 않고 다시 계산한다', async () => {
    const file = createFile(
      'fixtures/maintenance.md',
      'title: Pump inspection\ntype: maintenance\ndate: 2041-04-02\n\n3-Apr-2041',
    );
    const port = createNativeVaultPort(createApp([file]));
    const original = await port.read({ action: 'read', path: file.path, startLine: 1, endLine: 5 });
    expect(original.metadata?.dateStatus).toBe('conflict');
    expect(original.metadata?.entries).toContainEqual({
      field: 'type',
      value: 'maintenance',
      line: 2,
      origin: 'header',
      status: 'known',
    });
    file.content = '제목: 교체 부품 목록\n유형: inventory\n날짜: not-recorded';
    file.stat.mtime++;
    const updated = await port.read({ action: 'read', path: file.path, startLine: 1, endLine: 3 });
    expect(updated.metadata).toMatchObject({ dateStatus: 'unknown' });
    expect(updated.metadata?.entries.some((entry) => entry.value === '2041-04-02')).toBe(false);
    expect(updated.metadata?.header?.content).toContain('교체 부품 목록');
  });
  it.each([
    { first: 'copper relay', second: 'ceramic fuse' },
    { first: '파란 나사', second: '빨간 케이블' },
  ])('분리된 질의의 일치 구간을 한 문서에서 함께 보존한다: $first', async ({ first, second }) => {
    const file = createFile(
      'fixtures/parts.md',
      '\n' + first + '\n\nOther.\n\nOther.\n\n' + second + '\n',
    );
    const result = await createNativeVaultPort(createApp([file])).search({
      action: 'search',
      query: first,
      queries: [first, second],
      path: 'fixtures',
      limit: 10,
      match: 'phrase',
      mode: 'word',
      field: 'content',
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].passages?.map((passage) => passage.startLine)).toEqual([1, 7]);
    expect(
      result.citations
        .filter((citation) => citation.status === 'verified')
        .map((citation) => citation.id),
    ).toEqual(['vault:fixtures/parts.md:1-3', 'vault:fixtures/parts.md:7-9']);
  });
  it('서로 다른 일치 구간과 명시한 저자 정보를 원문 행으로 전달한다', async () => {
    const file = createFile(
      'fixtures/inspection.md',
      '제목: 압력 센서 점검\n날짜: not-recorded\n\n저자: 합성 작성자 A\n\nThe copper relay is ready.\n\nUnrelated.\n\nA COPPER RELAY needs inspection.',
    );
    const port = createNativeVaultPort(createApp([file]));
    const result = await port.search({
      action: 'search',
      query: 'copper relay',
      path: 'fixtures',
      limit: 10,
      match: 'phrase',
      mode: 'word',
      field: 'content',
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].passages).toHaveLength(2);
    expect(result.hits[0].metadata).toMatchObject({ dateStatus: 'unknown' });
    expect(
      result.citations
        .filter((citation) => citation.status === 'verified')
        .map((citation) => citation.line),
    ).toEqual([5, 9, 1, 4]);
    const read = await port.read({ action: 'read', path: file.path, startLine: 10, endLine: 10 });
    expect(read.content).toBe('A COPPER RELAY needs inspection.');
    expect(
      read.metadata?.entries.some((entry) => entry.field === 'author' && entry.line === 4),
    ).toBe(true);
  });
  it.each(
    ['lexical', 'indexed'].flatMap((mode) =>
      ['true', '"true"', '0', '1', '트루', '""', 'null', '', '[]', '{}'].map((value) => ({
        mode,
        value,
      })),
    ),
  )(
    'YAML 값 $value의 제외는 $mode 도구 호출의 검색·목록·읽기·연관·링크·통계에 모두 적용된다',
    async ({ mode, value }) => {
      const hidden = createFile(
        'private.md',
        `---\nsuperpower-inside-exclude: ${value}\n---\nuniquesecret [[visible]]`,
      );
      const visible = createFile('visible.md', 'public [[private]]');
      const app = createApp([hidden, visible], { 'visible.md': { 'private.md': 1 } });
      const rag: RAGConfig = {
        excludePaths: [],
        excludeExts: [],
        excludeChatFolder: false,
        chunkSize: 100,
        overlap: 0,
        embeddingProvider: 'openai',
        embeddingModel: 'test',
        autoUpdateEnabled: false,
        autoUpdateIntervalMin: 5,
        minScore: 0,
        annEnabled: false,
        annClusterCount: 0,
        annProbeCount: 4,
        structuralGraphEnabled: true,
        enableBM25: true,
        bm25Weight: 0.3,
        performanceTuningMode: 'auto',
        performanceGuardEnabled: true,
        maxEmbeddingBatchSize: 32,
        indexingYieldMs: 25,
        slowEventLoopThresholdMs: 150,
        slowBatchThresholdMs: 3000,
      };
      const chat: ChatConfig = {
        saveFolder: 'Chats',
        defaultModel: '',
        promptLibrary: [],
        mcpToolExecutionPolicy: 'mentioned-auto',
        autoSaveEnabled: false,
        autoSaveDebounceMs: 1000,
        mcpMentionOnly: false,
      };
      const scope = new RagNativeVaultFileScope(
        app,
        () => rag,
        () => chat,
      );
      const query = vi.fn(() =>
        Promise.resolve([
          createQueryResult(hidden.path, 'stale', 0, ['vector', 'bm25'], 'keyword-vector'),
        ]),
      );
      const runtime = new NativeVaultToolRuntime(
        new ObsidianNativeVaultToolPort(app, scope, () =>
          mode === 'indexed' ? createReadyQueryEngineDouble(query) : null,
        ),
      );
      const search = await runtime.execute(
        JSON.stringify({ action: 'search', query: 'uniquesecret' }),
      );
      expect(JSON.parse(search.modelText)).toMatchObject({ hits: [] });
      expect(search.citations).toEqual([]);
      expect(JSON.stringify(search)).not.toContain('uniquesecret [[visible]]');
      const list = await runtime.execute(JSON.stringify({ action: 'list' }));
      expect(JSON.stringify(list)).toContain('visible.md');
      expect(JSON.stringify(list)).not.toContain('private.md');
      const stats = await runtime.execute(JSON.stringify({ action: 'stats' }));
      expect(JSON.parse(stats.modelText)).toMatchObject({ fileCount: 1 });
      for (const action of ['read', 'related', 'links']) {
        await expect(
          runtime.execute(JSON.stringify({ action, path: hidden.path })),
        ).rejects.toThrow();
      }
      const links = await runtime.execute(JSON.stringify({ action: 'links', path: visible.path }));
      expect(JSON.stringify(links)).not.toContain('private.md');
      for (const frontmatter of [
        '---\nsuperpower-inside-exclude: false\n---\n',
        '---\nsuperpower-inside-exclude: "false"\n---\n',
        '',
      ]) {
        hidden.content = `${frontmatter}uniquesecret [[visible]]`;
        const restored = await runtime.execute(
          JSON.stringify({ action: 'read', path: hidden.path }),
        );
        expect(JSON.stringify(restored)).toContain('uniquesecret');
      }
    },
  );
  it('단일 파일 경로도 검색과 목록의 동일한 범위로 처리한다', async () => {
    const files = [
      createFile('Notes/Target.txt', 'inner conversation\nVictor'),
      createFile('Notes/Other.txt', 'inner conversation\nVictor'),
    ];
    const port = createNativeVaultPort(createApp(files));
    const result = await port.search({
      action: 'search',
      query: 'inner conversation',
      queries: ['Victor'],
      path: 'Notes/Target.txt',
      limit: 8,
      match: 'all',
    });
    expect(result.hits.map((hit) => hit.path)).toEqual(['Notes/Target.txt']);
    expect(result.scannedFiles).toBe(1);
    const list = await port.list({
      action: 'list',
      path: 'Notes/Target.txt',
      cursor: 0,
      limit: 50,
    });
    expect(list.files.map((file) => file.path)).toEqual(['Notes/Target.txt']);
    expect(list.exists).toBe(true);
  });

  it('정확 일치는 인덱스를 건너뛰고 대소문자와 연속 공백을 보존한다', async () => {
    const files = [
      createFile('Exact.md', '설정: API  Key 사용'),
      createFile('Similar.md', '설정: api key 사용'),
    ];
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp(files), undefined, () => ({ query }));
    const result = await port.search({
      action: 'search',
      query: 'API  Key',
      path: '',
      limit: 8,
      match: 'phrase',
      mode: 'exact',
      field: 'content',
    });
    expect(result.hits.map((hit) => hit.path)).toEqual(['Exact.md']);
    expect(query).not.toHaveBeenCalled();
  });

  it('경로 검색은 본문을 읽지 않고 파일명 일치만 반환한다', async () => {
    const files = [createFile('Aurora.md', '무관한 본문'), createFile('Other.md', 'Aurora')];
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const result = await createNativeVaultPort(createApp(files, {}, cachedRead)).search({
      action: 'search',
      query: 'Aurora',
      path: '',
      limit: 8,
      match: 'phrase',
      mode: 'exact',
      field: 'path',
    });
    expect(result.hits.map((hit) => hit.path)).toEqual(['Aurora.md']);
    expect(result.hits[0]?.citationStatus).toBe('candidate');
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it('본문 필드는 파일명으로만 일치한 인덱스 후보를 섞지 않는다', async () => {
    const named = createFile('Aurora.md', '무관한 본문');
    const body = createFile('Other.md', 'Aurora');
    const query = vi.fn(() =>
      Promise.resolve([createQueryResult(named.path, 'named', 0, ['bm25'], 'keyword', named)]),
    );
    const port = createNativeVaultPort(createApp([named, body]), undefined, () =>
      createReadyQueryEngineDouble(query),
    );
    const result = await port.search({
      action: 'search',
      query: 'Aurora',
      field: 'content',
      path: '',
      limit: 8,
      match: 'all',
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([body.path]);
    expect(query).not.toHaveBeenCalled();
  });

  it('날짜와 태그와 타입이 같은 속성 조건을 검색과 목록에 함께 적용한다', async () => {
    const files = [
      createFile('A.md', '고객 근거'),
      createFile('B.md', '고객 근거'),
      createFile('C.md', '고객 근거'),
    ];
    files[0].stat.mtime = 100;
    files[1].stat.mtime = 10;
    files[2].stat.mtime = 100;
    const app = createApp(files);
    app.metadataCache.getFileCache = (file) => ({
      tags: [
        {
          tag: '#project',
          position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
        },
      ],
      frontmatter: { status: file.path === 'C.md' ? 'closed' : 'active', priority: 1 },
    });
    const filters = {
      modifiedAfter: 50,
      tags: ['project'],
      properties: { status: 'active', priority: 1 },
    };
    const port = createNativeVaultPort(app);
    const search = await port.search({
      action: 'search',
      query: '고객 근거',
      path: '',
      limit: 8,
      match: 'all',
      filters,
    });
    const list = await port.list({ action: 'list', path: '', cursor: 0, limit: 50, filters });
    expect(search.hits.map((hit) => hit.path)).toEqual(['A.md']);
    expect(search.scopeRestricted).toBe(true);
    expect(list.files.map((file) => file.path)).toEqual(['A.md']);
    expect(list.total).toBe(1);
    const typed = await port.list({
      action: 'list',
      path: '',
      cursor: 0,
      limit: 50,
      filters: { properties: { priority: '1' } },
    });
    expect(typed.files).toEqual([]);
  });

  it('묶음 검색에서도 뒤쪽의 높은 순위와 여러 질의의 전체 일치 수를 보존한다', async () => {
    const files = Array.from({ length: 33 }, (_, index) =>
      createFile(`Notes/${String(index).padStart(2, '0')}.md`, 'alpha'),
    );
    files.push(createFile('Notes/alpha-beta.md', 'beta'));
    const result = await createNativeVaultPort(createApp(files)).search({
      action: 'search',
      query: 'alpha',
      queries: ['alpha', 'beta'],
      path: '',
      limit: 3,
      match: 'any',
    });
    expect(result.hits[0]?.path).toBe('Notes/alpha-beta.md');
    expect(result.totalHits).toBe(34);
    expect(result.scannedFiles).toBe(34);
    expect(result.truncated).toBe(true);
  });

  it('메타데이터 조건과 폴더 범위를 함께 인덱스 검색에 전달한다', async () => {
    const inside = createFile('Projects/A.md', '고객 근거');
    const outside = createFile('Other/B.md', '고객 근거');
    const app = createApp([inside, outside]);
    app.metadataCache.getFileCache = () => ({ frontmatter: { status: 'active' } });
    const query = vi.fn(() =>
      Promise.resolve([
        createQueryResult(inside.path, 'inside', 0, ['vector'], 'vector', inside),
        createQueryResult(outside.path, 'outside', 0, ['vector'], 'vector', outside),
      ]),
    );
    const port = createNativeVaultPort(app, undefined, () => createReadyQueryEngineDouble(query));
    const result = await port.search({
      action: 'search',
      query: '고객 근거',
      path: 'Projects',
      limit: 8,
      match: 'all',
      filters: { properties: { status: 'active' } },
    });
    expect(query).toHaveBeenCalledWith('고객 근거', 8, undefined, [inside.path], {
      signal: undefined,
    });
    expect(result.hits.map((hit) => hit.path)).toEqual([inside.path]);
    expect(result.scopeRestricted).toBe(true);
  });

  it('색인 없이 전체 볼트를 훑을 때는 추출 문서를 건너뛰고 그 사실을 남긴다', async () => {
    const note = createFile('Notes/alpha.md', 'alpha 근거');
    const sheet = createFile('Notes/전표.xlsx', 'alpha 근거');
    const port = createNativeVaultPort(createApp([note, sheet]));

    const blind = await port.search({
      action: 'search',
      query: 'alpha',
      path: '',
      limit: 10,
      match: 'all',
    });
    expect(blind.hits.map((hit) => hit.path)).toEqual([note.path]);
    expect(blind.skippedFiles).toBe(1);
    expect(blind.truncated).toBe(true);

    const scoped = await port.search({
      action: 'search',
      query: 'alpha',
      path: 'Notes',
      limit: 10,
      match: 'all',
    });
    expect(scoped.skippedFiles).toBeUndefined();
  });

  it('목록의 다음 페이지에서 필터를 바꾸면 이전 snapshot을 재사용하지 않는다', async () => {
    const files = [createFile('A.md', ''), createFile('B.md', ''), createFile('C.md', '')];
    const app = createApp(files);
    app.metadataCache.getFileCache = (file) => ({ frontmatter: { active: file.path !== 'C.md' } });
    const port = createNativeVaultPort(app);
    const first = await port.list({
      action: 'list',
      path: '',
      cursor: 0,
      limit: 1,
      filters: { properties: { active: true } },
    });
    expect(first.nextCursor).toBe(1);
    const changed = await port.list({
      action: 'list',
      path: '',
      cursor: 1,
      limit: 1,
      filters: { properties: { active: false } },
    });
    expect(changed.total).toBe(1);
    expect(changed.files).toEqual([]);
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

  it('read는 Obsidian 링크 표기와 제외 확장자 경로를 명시 참조로 읽는다', async () => {
    // PDF 본문 추출은 worker 경계이므로 여기서는 같은 조건의 텍스트 확장자로 확인한다.
    const app = createApp([createFile('monithub 개요.log', '추출 본문')]);
    const port = new ObsidianNativeVaultToolPort(
      app,
      {
        // 제외 확장자는 후보 목록에 없지만 사용자가 직접 지정하면 읽습니다.
        listCandidateFiles: () => Promise.resolve([]),
        isCandidateFile: () => Promise.resolve(false),
        isExplicitReadAllowed: () => Promise.resolve(true),
        isPathVisible: () => true,
      },
      () => null,
    );

    const result = await port.read({
      action: 'read',
      path: '[[monithub%20개요.log]]',
      startLine: 1,
      endLine: null,
    });

    expect(result).toMatchObject({ path: 'monithub 개요.log', content: '추출 본문' });
  });

  it('read는 존재하지만 읽을 수 없는 파일을 찾을 수 없음과 구분한다', async () => {
    const app = createApp([createFile('Secrets/.env', 'TOKEN=secret')]);
    const port = new ObsidianNativeVaultToolPort(
      app,
      {
        listCandidateFiles: () => Promise.resolve([]),
        isCandidateFile: () => Promise.resolve(false),
        isExplicitReadAllowed: () => Promise.resolve(false),
        isPathVisible: () => true,
      },
      () => null,
    );

    await expect(
      port.read({ action: 'read', path: 'Secrets/.env', startLine: 1, endLine: null }),
    ).rejects.toThrow('Secrets/.env');
    await expect(
      port.read({ action: 'read', path: 'Secrets/missing.env', startLine: 1, endLine: null }),
    ).rejects.toThrow();
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
    expect(getCandidateFiles).toHaveBeenCalledTimes(3);
  });

  it('연속 목록 페이지에서도 새로 제외된 파일은 노출하지 않는다', async () => {
    const alpha = createFile('Alpha.md', 'alpha');
    const beta = createFile('Beta.md', 'beta');
    const gamma = createFile('Gamma.md', 'gamma');
    let candidates: readonly TFile[] = [alpha, beta, gamma];
    const port = createNativeVaultPort(createApp([alpha, beta, gamma]), () =>
      Promise.resolve(candidates),
    );
    const first = await port.list({ action: 'list', path: '', cursor: 0, limit: 1 });
    candidates = [alpha, gamma];
    const next = await port.list({
      action: 'list',
      path: '',
      cursor: first.nextCursor ?? 0,
      limit: 10,
    });
    expect(next.files.map((file) => file.path)).toEqual([gamma.path]);
    expect(next.total).toBe(2);
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

  it('정상 인덱스의 상위 후보 검증과 전체 본문 검색을 함께 수행한다', async () => {
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
    const port = createNativeVaultPort(app, undefined, () => createReadyQueryEngineDouble(query));

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
    expect(query).toHaveBeenCalledWith('고객 문제', 2, undefined, undefined, {});
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('인덱스가 찾은 유효한 구간을 현재 Vault 본문으로 즉시 검증한다', async () => {
    const alpha = createFile(
      'Projects/Alpha.md',
      ['# 결정', '현재 고객 인터뷰에서 온보딩 마찰이 확인됐다.', '후속 실험을 시작한다.'].join(
        '\n',
      ),
    );
    const query = vi.fn(() =>
      Promise.resolve([
        {
          ...createQueryResult(
            alpha.path,
            'alpha-current',
            1,
            ['vector', 'bm25'],
            'keyword-vector',
            alpha,
          ),
          chunkRange: { startLine: 1, endLine: 2 },
        },
      ]),
    );
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: '온보딩 이탈 원인',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        path: alpha.path,
        startLine: 2,
        endLine: 3,
        preview: '현재 고객 인터뷰에서 온보딩 마찰이 확인됐다.\n후속 실험을 시작한다.',
        citationStatus: 'verified',
      }),
    ]);
    expect(result.hits[0]).not.toHaveProperty('requiresRead');
    expect(result.citations).toEqual([
      expect.objectContaining({
        filePath: alpha.path,
        line: 2,
        endLine: 3,
        status: 'verified',
      }),
    ]);
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('인덱스 후보의 현재 본문을 읽지 못하면 검증되지 않은 locator로 보존한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '현재 본문');
    const query = vi.fn(() =>
      Promise.resolve([createQueryResult(alpha.path, 'alpha-unreadable', 0, ['vector'], 'vector')]),
    );
    const cachedRead = vi.fn(() => Promise.reject(new Error('read failed')));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: 'semantic evidence',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits[0]).toMatchObject({
      path: alpha.path,
      citationStatus: 'candidate',
      requiresRead: true,
    });
    expect(result.citations[0]).toMatchObject({ status: 'candidate' });
  });

  it('인덱스 근거 검증은 Vault 읽기 동시성을 제한한다', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const files = Array.from({ length: 20 }, (_, index) =>
      createFile(`Projects/Evidence-${index}.md`, `현재 근거 ${index}`),
    );
    const query = vi.fn(() =>
      Promise.resolve(
        files.map((file, index) =>
          createQueryResult(file.path, `evidence-${index}`, 0, ['vector'], 'vector', file),
        ),
      ),
    );
    const cachedRead = vi.fn(async (file: TFile & { content: string }) => {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return file.content;
    });
    const port = createNativeVaultPort(createApp(files, {}, cachedRead), undefined, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: '현재 근거',
      path: '',
      limit: 20,
      match: 'all',
    });

    expect(result.hits).toHaveLength(20);
    expect(result.hits.every((hit) => hit.citationStatus === 'verified')).toBe(true);
    expect(maxActiveReads).toBe(8);
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

    expect(query).toHaveBeenCalledWith(seed.content, 7, 0, undefined, {});
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

  it('인덱스 상위 경로 검증에 더해 전체 후보 목록을 검색한다', async () => {
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
        isExplicitReadAllowed: () => Promise.resolve(true),
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
    expect(listCandidateFiles).toHaveBeenCalledOnce();
    expect(isCandidateFile).toHaveBeenCalledOnce();
  });

  it('정상 인덱스의 의미 기반 후보는 어휘가 모두 겹치지 않아도 현재 본문으로 검증한다', async () => {
    const indexedResults = [
      {
        sourcePath: 'Bible/Genesis.md',
        score: 0.9,
        vectorScore: 0.9,
        bm25Score: 0,
        combinedScore: 0.9,
        keywordMatches: 1,
        chunkRange: { startLine: 0, endLine: 0 },
        entry: {
          id: 'genesis',
          vector: [],
          metadata: {
            filePath: 'Bible/Genesis.md',
            text: '창세기 본문',
            startLine: 0,
            endLine: 0,
            sourceMtime: 2,
            sourceSize: '창세기 본문'.length,
            contentHash: createContentHash('창세기 본문'),
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
        citationStatus: 'verified',
      }),
    ]);
    expect(result.hits[0]).not.toHaveProperty('requiresRead');
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('정상 인덱스가 비어도 원문에서 일치하는 문서를 복구한다', async () => {
    const files = [
      createFile('Projects/Alpha.md', '고객 문제'),
      createFile('Projects/Beta.md', '고객 문제'),
    ];
    const query = vi.fn(() => Promise.resolve([]));
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const listCandidateFiles = vi.fn(() => Promise.resolve(files));
    const port = createNativeVaultPort(createApp(files, {}, cachedRead), listCandidateFiles, () =>
      createReadyQueryEngineDouble(query),
    );

    const result = await port.search({
      action: 'search',
      query: '고객 문제',
      path: '',
      limit: 3,
      match: 'all',
    });

    expect(result.hits.map((hit) => hit.path)).toEqual(files.map((file) => file.path));
    expect(result).toMatchObject({
      scannedFiles: 2,
      unreadableFiles: 0,
      totalHits: 2,
      truncated: false,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(listCandidateFiles).toHaveBeenCalledTimes(3);
    expect(cachedRead).toHaveBeenCalledTimes(2);
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
        createQueryResult(
          gamma.path,
          'gamma-entry',
          30,
          ['structural'],
          'strong-structural-evidence',
        ),
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

    expect(query).toHaveBeenNthCalledWith(1, 'customer retention', 3, undefined, undefined, {});
    expect(query).toHaveBeenNthCalledWith(2, 'onboarding churn', 3, undefined, undefined, {});
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
    expect(query).toHaveBeenCalledWith('first query', 3, undefined, undefined, {
      signal: controller.signal,
    });
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

  it('core vector가 ready여도 검색 결과가 비면 원문을 확인한다', async () => {
    const alpha = createFile('Projects/Alpha.md', '핵심 고객 문제');
    const cachedRead = vi.fn((file: TFile & { content: string }) => Promise.resolve(file.content));
    const query = vi.fn(() => Promise.resolve([]));
    const port = createNativeVaultPort(createApp([alpha], {}, cachedRead), undefined, () => ({
      query,
      getLastRetrievalDiagnostics: () => [
        createRetrievalDiagnostic('partial', 'structural'),
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

    expect(result.hits.map((hit) => hit.path)).toEqual([alpha.path]);
    expect(cachedRead).toHaveBeenCalledWith(alpha);
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
        getLastRetrievalDiagnostics: () => [createRetrievalDiagnostic('stale', 'vector')],
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

  it('메타데이터가 같아도 해시가 다른 인덱스 구간은 검증된 근거로 승격하지 않는다', async () => {
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
    expect(result.hits[0]).toMatchObject({ citationStatus: 'candidate', requiresRead: true });
    expect(cachedRead).toHaveBeenCalledOnce();
  });

  it('ready 인덱스 결과가 모두 숨김 대상이면 같은 검색 범위의 원문을 확인한다', async () => {
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
        isExplicitReadAllowed: (file) => Promise.resolve(file.path === visible.path),
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

    expect(result.hits.map((hit) => hit.path)).toEqual([visible.path]);
    expect(listCandidateFiles).toHaveBeenCalled();
    expect(cachedRead).toHaveBeenCalledWith(visible);
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
    expect(listCandidateFiles).toHaveBeenCalledTimes(4);
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
      Promise.resolve([createQueryResult(first.path, 'first-entry', 0, ['vector'], 'vector')]),
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

  it('stats는 현재 RAG 후보 파일 개수와 전체 크기를 반환한다', async () => {
    const app = createApp([createFile('Alpha.md', '1234'), createFile('Beta.md', '123456')]);
    const port = createNativeVaultPort(app);

    await expect(port.stats({ action: 'stats' })).resolves.toMatchObject({
      fileCount: 2,
      totalBytes: 10,
    });
  });

  it('stats에 같은 파일 목록의 처리 상태를 연결하며 진단 실패가 파일 통계를 막지 않는다', async () => {
    const app = createApp([createFile('source.ts', '원문 근거')]);
    const summary = {
      totalFiles: 1,
      chatReadyFiles: 1,
      completeFiles: 1,
      truncated: false,
      files: [],
    };
    const readStatus = vi.fn(() => Promise.resolve(summary));
    const scope = {
      listCandidateFiles: () => Promise.resolve(app.vault.getFiles()),
      isCandidateFile: () => Promise.resolve(true),
      isExplicitReadAllowed: () => Promise.resolve(true),
      isPathVisible: () => true,
    };
    const port = new ObsidianNativeVaultToolPort(app, scope, () => null, readStatus);
    expect(await port.stats({ action: 'stats' })).toMatchObject({
      fileCount: 1,
      processing: summary,
    });
    expect(readStatus).toHaveBeenCalledWith(app.vault.getFiles());
    const unavailable = new ObsidianNativeVaultToolPort(
      app,
      scope,
      () => null,
      () => Promise.reject(new Error('diagnostics unavailable')),
    );
    expect(await unavailable.stats({ action: 'stats' })).toMatchObject({ fileCount: 1 });
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
      isExplicitReadAllowed: async (file) =>
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
  source: 'vector' | 'ann' | 'bm25' | 'structural' = 'bm25',
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
  source?: TFile & { content: string },
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
        ...(source
          ? {
              sourceMtime: source.stat.mtime,
              sourceSize: source.stat.size,
              contentHash: createContentHash(source.content),
            }
          : {}),
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
