import { TFile, TFolder, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { MCPRegistry } from '../mcp/registry';
import { createContentHash } from '../rag/hash';
import type { QueryResult } from '../rag/query';
import { expandVaultSearchPlan } from './vault-query-expansion';
import { buildChatContext, resolveChatRagEngine, type RagQueryLike } from './context';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  class MockTFolder {}
  return {
    TFile: MockTFile,
    TFolder: MockTFolder,
    getAllTags: (cache: { tags?: { tag: string }[]; frontmatter?: { tags?: string[] } }) => [
      ...(cache.tags ?? []).map((tag) => tag.tag),
      ...(cache.frontmatter?.tags ?? []).map((tag) => `#${tag}`),
    ],
  };
});

describe('buildChatContext RAG 출처 검증', () => {
  it('제외된 확장자를 직접 지정하면 명시 읽기로 첨부하고 읽을 수 없는 파일과 구분한다', async () => {
    const log = createFile('monithub 개요.log', '합성 추출 본문', 1000, 'log');
    const secret = createFile('Secrets/.env', 'TOKEN=secret', 1000, 'env');
    const app = createApp(
      new Map([
        [log.path, log],
        [secret.path, secret],
      ]),
    );

    const context = await buildChatContext('[[monithub%20개요.log]] 요약해줘 @[Secrets/.env]', {
      app,
      candidatePaths: new Set<string>(),
      isExplicitReadAllowed: (file) => Promise.resolve(file.path === log.path),
    });

    expect(context.systemPrompt).toContain('합성 추출 본문');
    expect(context.attachments).toContainEqual(
      expect.objectContaining({ id: 'file:monithub 개요.log', status: 'attached' }),
    );
    expect(context.attachments).toContainEqual(
      expect.objectContaining({
        id: 'file:Secrets/.env',
        status: 'missing',
        detail: '읽을 수 없는 파일: Secrets/.env',
      }),
    );
  });

  it('플러그인 코드 질문은 명시한 자료만 읽고 자동 검색과 질의 확장을 건너뛴다', async () => {
    const explicit = createFile(
      'Example.md',
      '명시적으로 제공한 합성 자료 [[archive/Other]]',
      1000,
    );
    const unrelated = createFile('archive/Other.md', '자동 첨부되면 안 되는 합성 자료', 1000);
    const app = createApp(
      new Map([
        [explicit.path, explicit],
        [unrelated.path, unrelated],
      ]),
    );
    const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
    const queryExpander = vi.fn(() => Promise.resolve('archive'));
    const context = await buildChatContext('Sample Query로 archive 쿼리를 작성해줘 @Example.md', {
      app,
      ragEngine: { query },
      queryExpander,
      explicitContextOnly: true,
    });
    expect(context.citations.map((citation) => citation.filePath)).toEqual(['Example.md']);
    expect(context.vaultSearchEnabled).toBe(false);
    expect(context.systemPrompt).toContain('명시적으로 제공한 합성 자료');
    expect(context.systemPrompt).not.toContain('자동 첨부되면 안 되는 합성 자료');
    expect(query).not.toHaveBeenCalled();
    expect(queryExpander).not.toHaveBeenCalled();
    const empty = await buildChatContext('Sample Query로 archive 쿼리를 작성해줘', {
      app,
      ragEngine: { query },
      queryExpander,
      explicitContextOnly: true,
    });
    expect(empty.citations).toEqual([]);
    expect(empty.vaultSearchEnabled).toBe(false);
    expect(empty.attachments.some((item) => item.id.startsWith('folder:auto:'))).toBe(false);
    expect(queryExpander).not.toHaveBeenCalled();
  });
  it('태그의 본문·속성·하위 태그 문서만 첨부하고 중복·제외·범위 밖 자료를 막는다', async () => {
    const files = [
      createFile('Alpha.md', '합성 태그 본문 근거', 1000),
      createFile('Beta.md', '합성 속성 태그 근거', 1000),
      createFile('Gamma.md', '범위 밖 자료', 1000),
      createFile('Hidden.md', '---\nsuperpower-inside-exclude: true\n---\n제외 자료', 1000),
    ];
    const metadata = new Map([
      ['Alpha.md', { tags: [{ tag: '#Research/설계' }] }],
      ['Beta.md', { frontmatter: { tags: ['research'] } }],
      ['Gamma.md', { tags: [{ tag: '#researcher' }] }],
      [
        'Hidden.md',
        { tags: [{ tag: '#research' }], frontmatter: { 'superpower-inside-exclude': true } },
      ],
    ]);
    const app = createApp(
      new Map(files.map((file) => [file.path, file])),
      new Map(),
      new Set(),
      metadata,
    );
    const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
    const context = await buildChatContext('@#RESEARCH @#research @Alpha.md', {
      app,
      ragEngine: { query },
    });
    expect(context.systemPrompt).toContain('합성 태그 본문 근거');
    expect(context.systemPrompt).toContain('합성 속성 태그 근거');
    expect(context.systemPrompt).not.toContain('범위 밖 자료');
    expect(context.systemPrompt).not.toContain('제외 자료');
    expect(context.citations.map((citation) => citation.filePath)).toEqual(['Alpha.md', 'Beta.md']);
    expect(context.attachments.filter((item) => item.type === 'tag')).toHaveLength(1);
    expect(query).not.toHaveBeenCalled();
    const bounded = await buildChatContext('@#research', { app, maxFolderFiles: 1 });
    expect(bounded.attachments[0]).toMatchObject({
      type: 'tag',
      status: 'partial',
      fileCount: 1,
      filteredCount: 1,
    });
    const restricted = await buildChatContext('@#research', {
      app,
      candidatePaths: new Set(['Beta.md']),
    });
    expect(restricted.citations.map((citation) => citation.filePath)).toEqual(['Beta.md']);
    const empty = await buildChatContext('@#missing', { app, ragEngine: { query } });
    expect(empty.citations).toEqual([]);
    expect(empty.attachments[0]).toMatchObject({ type: 'tag', status: 'missing', excluded: true });
    metadata.set('Beta.md', { frontmatter: { tags: ['other'] } });
    const changed = await buildChatContext('@#research', { app });
    expect(changed.citations.map((citation) => citation.filePath)).toEqual(['Alpha.md']);
  });

  it('태그 첨부의 읽기 실패와 분량 제한을 부분 첨부로 표시한다', async () => {
    const files = [
      createFile('A.md', '합성 근거'.repeat(1000), 1000),
      createFile('B.md', '합성 근거', 1000),
    ];
    const metadata = new Map(files.map((file) => [file.path, { tags: [{ tag: '#topic' }] }]));
    const app = createApp(
      new Map(files.map((file) => [file.path, file])),
      new Map(),
      new Set(['B.md']),
      metadata,
    );
    const context = await buildChatContext('@#topic', { app, maxContextChars: 300 });
    expect(context.attachments[0]).toMatchObject({ type: 'tag', status: 'partial' });
    expect(context.contextBudgetSnapshot?.usedChars).toBeLessThanOrEqual(300);
  });
  it('도구가 활성화된 큰 폴더는 검색 범위만 전달한다', async () => {
    const files = Array.from({ length: 15 }, (_, index) =>
      createFile('fixtures/' + index + '.md', '합성 부품 설명'.repeat(1000), 1000),
    );
    const folder = createFolder('fixtures');
    const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
    const context = await buildChatContext('@[fixtures] 교체할 케이블을 찾아줘', {
      app: createApp(
        new Map(files.map((file) => [file.path, file])),
        new Map([[folder.path, folder]]),
      ),
      ragEngine: { query },
      deferImplicitFolderEvidenceToTools: true,
    });
    expect(context.citations).toEqual([]);
    expect(context.attachments[0]).toMatchObject({
      name: 'fixtures',
      fileCount: 15,
      sourceIds: [],
      excluded: false,
    });
    expect(context.systemPrompt).toContain('fixtures');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { question: '교체할 케이블', variants: ['copper cable', 'ceramic connector'] },
    { question: '点検するセンサー', variants: ['optical sensor', 'pressure switch'] },
  ])('각 번역 질의를 지정 폴더 안에서 검색한다: $question', async ({ question, variants }) => {
    const files = [
      createFile('fixtures/a.md', '합성 부품 자료', 1000),
      createFile('outside.md', '다른 범위의 자료', 1000),
    ];
    const folder = createFolder('fixtures');
    const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
    await buildChatContext('@[fixtures] ' + question, {
      app: createApp(
        new Map(files.map((file) => [file.path, file])),
        new Map([[folder.path, folder]]),
      ),
      ragEngine: { query },
      queryExpander: () => Promise.resolve({ query: question, variants }),
    });
    for (const variant of variants)
      expect(query).toHaveBeenCalledWith(
        variant,
        expect.any(Number),
        undefined,
        ['fixtures'],
        expect.any(Object),
      );
    expect(query.mock.calls.every((args) => args[3]?.[0] === 'fixtures')).toBe(true);
  });
  it('현재 문서와 열린 문서의 원문을 함께 컨텍스트에 전달한다', async () => {
    const first = createFile('Notes/현재.md', '현재 문서의 근거', 1000);
    const second = createFile('Notes/다른.md', '다른 문서의 근거', 1000);
    const context = await buildChatContext('@current @tabs', {
      app: createApp(
        new Map([
          [first.path, first],
          [second.path, second],
        ]),
      ),
      workspaceFiles: { current: [first.path], tabs: [first.path, second.path] },
    });
    expect(context.systemPrompt).toContain('현재 문서의 근거');
    expect(context.systemPrompt).toContain('다른 문서의 근거');
    expect(context.attachments).toHaveLength(2);
  });
  it('전송 시 문서 스냅샷을 읽어 열린 문서의 중복 첨부와 검색 범위 밖 유출을 막는다', async () => {
    const first = createFile('Notes/현재.md', '현재 문서의 근거', 1000);
    const second = createFile('Notes/다른.md', '다른 문서의 근거', 1000);
    const context = await buildChatContext('@current @tabs @[Notes/현재.md]', {
      app: createApp(
        new Map([
          [first.path, first],
          [second.path, second],
        ]),
      ),
      workspaceFiles: { current: [first.path], tabs: [first.path, second.path] },
      candidatePaths: new Set([first.path]),
    });
    expect(context.systemPrompt).toContain('현재 문서의 근거');
    expect(context.systemPrompt).not.toContain('다른 문서의 근거');
    expect(context.attachments.filter((item) => item.name === first.path)).toHaveLength(1);
  });
  it('긴 명시 파일과 폴더를 함께 지정하면 양쪽 근거를 먼저 예약한다', async () => {
    const first = createFile(
      'A.md',
      `# Background\n${'Unrelated.\n'.repeat(150)}# Deployment\nA deployment owner is Mina.`,
      1000,
    );
    const second = createFile('docs/B.md', 'B deployment owner is Joon.', 1000);
    const folder = createFolder('docs');
    const context = await buildChatContext('@[A.md] @[docs] deployment owner를 비교해줘.', {
      app: createApp(
        new Map([
          [first.path, first],
          [second.path, second],
        ]),
        new Map([[folder.path, folder]]),
      ),
      maxContextChars: 650,
    });
    expect(context.systemPrompt).toContain('owner is Mina');
    expect(context.systemPrompt).toContain('owner is Joon');
  });

  it('폴더의 긴 첫 파일이 부분 첨부되어도 다음 파일의 근거를 전달한다', async () => {
    const first = createFile(
      'docs/A.md',
      `# Background\n${'Unrelated.\n'.repeat(150)}# Deployment\nA deployment owner is Mina.`,
      1000,
    );
    const second = createFile('docs/B.md', 'B deployment owner is Joon.', 1000);
    const folder = createFolder('docs');
    const context = await buildChatContext('@[docs] deployment owner를 비교해줘.', {
      app: createApp(
        new Map([
          [first.path, first],
          [second.path, second],
        ]),
        new Map([[folder.path, folder]]),
      ),
      maxContextChars: 650,
    });
    expect(context.systemPrompt).toContain('owner is Mina');
    expect(context.systemPrompt).toContain('owner is Joon');
  });

  it('폴더 검색 결과의 순서를 유지하고 범위 밖 결과와 최대 파일 수를 제한한다', async () => {
    const files = [
      createFile('docs/A.md', '첫 파일', 1000),
      createFile('docs/B.md', '관련 파일', 1000),
      createFile('outside.md', '범위 밖', 1000),
    ];
    const folder = createFolder('docs');
    const context = await buildChatContext('@[docs] 관련 파일을 찾아줘.', {
      app: createApp(
        new Map(files.map((file) => [file.path, file])),
        new Map([[folder.path, folder]]),
      ),
      maxFolderFiles: 1,
      ragEngine: createRagEngine([
        createResult('outside.md', '범위 밖', 'hash'),
        createResult('docs/B.md', '관련 파일', 'hash'),
        createResult('docs/A.md', '첫 파일', 'hash'),
      ]),
    });
    expect(
      context.citations
        .filter((citation) => citation.status === 'verified')
        .map((citation) => citation.filePath),
    ).toEqual(['docs/B.md']);
    expect(context.systemPrompt).not.toContain('범위 밖');
    expect(context.systemPrompt).not.toContain('첫 파일');
    expect(context.attachments[0]).toMatchObject({
      fileCount: 1,
      filteredCount: 1,
      status: 'partial',
    });
  });
  it('폴더 멘션과 원문 링크 확장에도 동일한 검색 대상 목록을 적용한다', async () => {
    const visible = createFile('notes/visible.md', '공개 근거 [[hidden]]', 1000);
    const hidden = createFile('notes/hidden.md', '제외된 문서의 근거', 1000);
    const folder = createFolder('notes');
    const app = createApp(
      new Map([
        [visible.path, visible],
        [hidden.path, hidden],
      ]),
      new Map([[folder.path, folder]]),
    );
    for (const question of ['@[notes]', '@[notes/visible.md]', '@[notes/hidden.md]']) {
      const context = await buildChatContext(question, {
        app,
        candidatePaths: new Set([visible.path]),
      });
      expect(context.systemPrompt ?? '').not.toContain('제외된 문서의 근거');
      expect(context.citations.some((citation) => citation.filePath === hidden.path)).toBe(false);
    }
  });
  it('검색 범위에서 제외된 파일은 검증된 RAG 결과여도 답변에 넣지 않는다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const context = await buildChatContext('질문', {
      app: createApp(new Map([['note.md', file]])),
      candidatePaths: new Set(),
      ragEngine: createRagEngine([
        createResult('note.md', '현재 내용', createContentHash('현재 내용')),
      ]),
    });
    expect(context.systemPrompt).toBeNull();
    expect(context.citations).toEqual([]);
  });
  it('RAG 없이 재전송할 때는 RAG 준비 자체를 건너뛴다', async () => {
    const prepare = vi.fn(() => Promise.reject(new Error('RAG initialization failed')));

    await expect(
      resolveChatRagEngine(true, prepare, () => createRagEngine([])),
    ).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('존재하지 않는 파일 후보는 Vault Context에 넣지 않는다', async () => {
    const app = createApp(new Map());
    const ragEngine = createRagEngine([createResult('missing.md', '없는 문서', 'hash')]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toBeNull();
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'missing.md', status: 'missing' }),
    );
    expect(context.attachments[0]).toEqual(expect.objectContaining({ status: 'low-relevance' }));
  });

  it('stale 후보는 citation 경고로만 남기고 프롬프트 컨텍스트에서 제외한다', async () => {
    const file = createFile('note.md', '현재 내용', 2000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = createRagEngine([createResult('note.md', '이전 내용', 'old-hash')]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toBeNull();
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'note.md', status: 'stale' }),
    );
  });

  it('검증된 후보만 Vault Context에 포함한다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = createRagEngine([
      createResult('note.md', '현재 내용', createContentHash('현재 내용')),
    ]);

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.systemPrompt).toContain('[Vault Context Rules]');
    expect(context.systemPrompt).toContain('[Source rag-1: note.md]');
    expect(context.citations[0]).toEqual(
      expect.objectContaining({ filePath: 'note.md', status: 'verified' }),
    );
  });

  it('시간 초과 복구는 실패 provider만 제외하고 정상 검색은 다시 허용한다', async () => {
    const app = createApp(new Map());
    const query = vi.fn<RagQueryLike['query']>((_question, _topK, minScore, _prefixes, options) => {
      options?.onRetrieved?.(
        [],
        [
          {
            providerId: 'bm25',
            source: 'bm25',
            status: minScore === 0 ? 'skipped' : 'timeout',
            durationMs: 2,
            candidateCount: 0,
            readiness: 'ready',
            estimatedCost: 'low',
          },
        ],
      );
      return Promise.resolve([]);
    });
    const context = await buildChatContext('synthetic query', { app, ragEngine: { query } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[4]).toMatchObject({ excludedProviderIds: ['bm25'] });
    expect(context.attachments.find((item) => item.id === 'rag:auto')?.detail).toContain('timeout');
  });

  it('초기 검색 취소를 빈 검색 결과로 삼아 확대 재시도하지 않는다', async () => {
    const controller = new AbortController();
    const query = vi.fn<RagQueryLike['query']>(() => {
      controller.abort();
      return Promise.reject(new DOMException('cancelled', 'AbortError'));
    });
    await expect(
      buildChatContext('synthetic query', {
        app: createApp(new Map()),
        ragEngine: { query },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[4]?.signal).toBe(controller.signal);
  });

  it.each(['압력 센서 교체 기록', '青い配線の点検'])(
    '검토에 위임한 질의는 번역 없이 로컬 계획만 사용한다: %s',
    async (question) => {
      const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
      const previous = ['copper relay inspection'];
      const plan = expandVaultSearchPlan(question, previous);
      const context = await buildChatContext(question, {
        app: createApp(new Map()),
        ragEngine: { query },
        deferAutoRagToReview: true,
        queryExpander: (text) => expandVaultSearchPlan(text, previous),
      });
      expect(context.searchQueries).toEqual([plan.query, ...plan.variants]);
      expect(context.scoringQuestion).toBe(plan.variants[0] ?? plan.query);
      expect(context.scoringQuestion).not.toContain('["');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('엔진 검토에 위임해도 검색 활성 상태와 확장 질의를 보존하며 초기 검색은 반복하지 않는다', async () => {
    const query = vi.fn<RagQueryLike['query']>(() => Promise.resolve([]));
    const queryExpander = vi.fn(() =>
      Promise.resolve({ query: 'expanded question', variants: ['alternative evidence'] }),
    );
    const context = await buildChatContext('synthetic query', {
      app: createApp(new Map()),
      ragEngine: { query },
      queryExpander,
      deferAutoRagToReview: true,
    });
    expect(query).not.toHaveBeenCalled();
    expect(queryExpander).toHaveBeenCalledOnce();
    expect(context.vaultSearchEnabled).toBe(true);
    expect(context.searchQueries).toEqual(['expanded question', 'alternative evidence']);
    expect(context.scoringQuestion).toBe('alternative evidence');
    expect(context.attachments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'rag:auto', status: 'missing' })]),
    );
  });

  it('병렬 질의의 실패 provider를 다른 질의의 복구에 섞지 않는다', async () => {
    const app = createApp(new Map());
    const query = vi.fn<RagQueryLike['query']>((question, _topK, minScore, _prefixes, options) => {
      options?.onRetrieved?.(
        [],
        [
          {
            providerId: question === 'alpha' ? 'bm25' : 'ivf-vector',
            source: 'bm25',
            status: minScore === 0 ? 'skipped' : 'timeout',
            durationMs: 2,
            candidateCount: 0,
            readiness: 'ready',
            estimatedCost: 'low',
          },
        ],
      );
      return Promise.resolve([]);
    });
    await buildChatContext('synthetic query', {
      app,
      ragEngine: { query },
      queryExpander: () => Promise.resolve({ query: 'alpha', variants: ['alpha', 'beta'] }),
    });
    const retries = query.mock.calls.filter((call) => call[2] === 0);
    expect(retries.find((call) => call[0] === 'alpha')?.[4]).toMatchObject({
      excludedProviderIds: ['bm25'],
    });
    expect(retries.find((call) => call[0] === 'beta')?.[4]).toMatchObject({
      excludedProviderIds: ['ivf-vector'],
    });
  });

  it('기본 점수 검색이 비면 확장된 주제어로 로컬 lexical 후보를 다시 선별한다', async () => {
    const genesis = createFile('Ledger.md', '원장 본문과 상징 해석', 1000);
    const unrelated = createFile('Shopping.md', '주말 장보기 목록', 1000);
    const app = createApp(
      new Map([
        [genesis.path, genesis],
        [unrelated.path, unrelated],
      ]),
    );
    const query = vi.fn(
      (_question: string, _topK?: number, minScore?: number): Promise<QueryResult[]> =>
        Promise.resolve(
          minScore === 0
            ? [
                createResult(genesis.path, genesis.content, createContentHash(genesis.content)),
                createResult(
                  unrelated.path,
                  unrelated.content,
                  createContentHash(unrelated.content),
                ),
              ]
            : [],
        ),
    );

    const context = await buildChatContext('퀼런은 원장을 어떻게 해석했어?', {
      app,
      ragEngine: { query },
      ragMinScore: 0.75,
      queryExpander: () => Promise.resolve('퀼런 Orin Quillon 원장 Ledger'),
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      '퀼런 Orin Quillon 원장 Ledger',
      5,
      0.75,
      undefined,
      expect.any(Object),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      '퀼런 Orin Quillon 원장 Ledger',
      15,
      0,
      undefined,
      expect.any(Object),
    );
    expect(context.citations.map((citation) => citation.filePath)).toEqual(['Ledger.md']);
  });

  it('RAG provider diagnostic 요약을 attachment detail에 표시한다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const app = createApp(new Map([['note.md', file]]));
    const ragEngine = {
      query: () =>
        Promise.resolve([createResult('note.md', '현재 내용', createContentHash('현재 내용'))]),
      getLastRetrievalDiagnostics: () => [
        {
          providerId: 'exact-vector',
          source: 'vector',
          status: 'ok',
          durationMs: 12,
          candidateCount: 5,
          readiness: 'ready',
          estimatedCost: 'low',
        },
        {
          providerId: 'bm25',
          source: 'bm25',
          status: 'timeout',
          durationMs: 80,
          candidateCount: 0,
          readiness: 'ready',
          estimatedCost: 'free',
        },
      ],
    } satisfies RagQueryLike & {
      getLastRetrievalDiagnostics: () => Array<{
        providerId: string;
        source: string;
        status: string;
        durationMs: number;
        candidateCount: number;
        readiness: string;
        estimatedCost: string;
      }>;
    };

    const context = await buildChatContext('질문', { app, ragEngine });

    expect(context.attachments[0]?.detail).toContain(
      'exact-vector ok/ready 5개, bm25 timeout/ready 0개',
    );
  });

  it('자연어의 한글 표기와 가까운 영문 폴더에서 확장된 키워드로 원문을 직접 찾는다', async () => {
    const archive = createFile('archive/overview.md', '지난 프로젝트 개요', 1000);
    const aurora = createFile('aurora/migration.txt', 'Aurora migration plan', 1000, 'txt');
    const app = createApp(
      new Map([
        [archive.path, archive],
        [aurora.path, aurora],
      ]),
    );
    const calls: Array<{ minScore?: number; pathPrefixes?: readonly string[] }> = [];
    const ragEngine: RagQueryLike = {
      query: (_question, _topK, minScore, pathPrefixes) => {
        calls.push({ minScore, pathPrefixes });
        return Promise.resolve(
          pathPrefixes?.includes('aurora')
            ? [createResult(aurora.path, aurora.content, createContentHash(aurora.content))]
            : [createResult(archive.path, archive.content, createContentHash(archive.content))],
        );
      },
    };

    const context = await buildChatContext('오로라 프로젝트의 마이그레이션 계획은?', {
      app,
      ragEngine,
      queryExpander: () => Promise.resolve('Aurora migration plan'),
    });

    expect(calls).toEqual([]);
    expect(context.citations.map((citation) => citation.filePath)).toEqual([
      'aurora/migration.txt',
    ]);
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'folder:auto:aurora',
          status: 'attached',
          sourceIds: ['folder-auto-1'],
        }),
      ]),
    );
  });

  it('도구 루프가 조사할 때는 암시적 폴더 전체를 선별하지 않고 RAG 후보만 먼저 붙인다', async () => {
    const archive = createFile('archive/overview.md', '지난 프로젝트 개요', 1000);
    const aurora = createFile('aurora/migration.txt', 'Aurora migration plan', 1000, 'txt');
    const app = createApp(
      new Map([
        [archive.path, archive],
        [aurora.path, aurora],
      ]),
    );
    const query = vi.fn(() =>
      Promise.resolve([
        createResult(aurora.path, aurora.content, createContentHash(aurora.content)),
      ]),
    );

    const context = await buildChatContext('오로라 프로젝트의 마이그레이션 계획은?', {
      app,
      ragEngine: { query },
      queryExpander: () => Promise.resolve('Aurora migration plan'),
      deferImplicitFolderEvidenceToTools: true,
    });

    expect(query).toHaveBeenCalledWith(
      'Aurora migration plan',
      5,
      undefined,
      undefined,
      expect.any(Object),
    );
    expect(context.attachments.some((attachment) => attachment.id.startsWith('folder:auto:'))).toBe(
      false,
    );
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rag:auto',
          type: 'rag',
          status: 'attached',
        }),
      ]),
    );
    expect(context.citations.map((citation) => citation.filePath)).toEqual([
      'aurora/migration.txt',
    ]);
  });
});

describe('buildChatContext 참조 문서 확장', () => {
  it('명시 파일 둘을 참조 확장보다 먼저 전달하고 제외한 참조를 검증 출처로 등록하지 않는다', async () => {
    const first = createFile('a.md', '[[reference]]', 1000);
    const second = createFile('b.md', '비교할 두 번째 근거', 1000);
    const reference = createFile('reference.md', '참조 자료 '.repeat(100), 1000);
    const context = await buildChatContext('@[a.md] @[b.md] 비교해줘', {
      app: createApp(new Map([first, second, reference].map((file) => [file.path, file]))),
      maxContextChars: 180,
    });
    expect(context.systemPrompt).toContain(second.content);
    expect(
      context.citations
        .filter((citation) => citation.status === 'verified')
        .map((citation) => citation.filePath),
    ).toEqual(['a.md', 'b.md']);
    expect(context.attachments.find((attachment) => attachment.type === 'reference')).toMatchObject(
      { actualChars: 0, sourceIds: [], excluded: true },
    );
  });

  it('예산을 초과한 긴 문서의 후반부에서 질문과 관련된 완전한 구간을 전달한다', async () => {
    const file = createFile(
      'decision.md',
      '# 배경\n' +
        '배경 기록입니다.\n'.repeat(150) +
        '\n# 배포 결정\n배포는 금요일에 진행하며 담당자는 민수입니다.',
      1000,
    );
    const context = await buildChatContext('@[decision.md] 배포 담당자는 누구야?', {
      app: createApp(new Map([[file.path, file]])),
      maxContextChars: 300,
    });
    expect(context.systemPrompt).toContain('담당자는 민수');
    expect(context.attachments[0]).toMatchObject({ status: 'partial' });
    expect(context.attachments[0]?.actualChars).toBeLessThanOrEqual(300);
    expect(context.citations[0]?.line).toBeGreaterThan(100);
    expect(context.citations[0]?.preview).toContain('민수');
  });

  it('한정된 폴더 내용 질문은 열거 순서보다 범위 안의 관련 문서를 우선한다', async () => {
    const folder = createFolder('docs');
    const unrelated = createFile('docs/a.md', '장보기 목록', 1000);
    const relevant = createFile('docs/z.md', '배포 담당자는 민수입니다.', 1000);
    const context = await buildChatContext('@[docs] 배포 담당자를 찾아줘', {
      app: createApp(
        new Map([unrelated, relevant].map((file) => [file.path, file])),
        new Map([[folder.path, folder]]),
      ),
      maxFolderFiles: 1,
    });
    expect(context.systemPrompt).toContain(relevant.content);
    expect(context.systemPrompt).not.toContain(unrelated.content);
  });

  it('예산 밖 RAG 구간은 전달 출처와 실제 문자 수에 포함하지 않는다', async () => {
    const file = createFile('note.md', '현재 내용', 1000);
    const context = await buildChatContext('질문', {
      app: createApp(new Map([[file.path, file]])),
      ragEngine: createRagEngine([
        createResult(file.path, file.content, createContentHash(file.content)),
      ]),
      maxContextChars: 1,
    });
    expect(context.citations.filter((citation) => citation.status === 'verified')).toEqual([]);
    expect(context.attachments[0]).toMatchObject({ actualChars: 0, sourceIds: [], excluded: true });
  });
  it('폴더 멘션 파일 선택과 partial 여부는 Rust folder plan을 따른다', async () => {
    const folder = createFolder('제품문서');
    const first = createFile('제품문서/a.md', '첫 문서', 1000);
    const second = createFile('제품문서/nested/b.md', '둘째 문서', 1000);
    const outside = createFile('제품문서-extra/c.md', '외부 문서', 1000);
    const app = createApp(
      new Map([
        [first.path, first],
        [second.path, second],
        [outside.path, outside],
      ]),
      new Map([[folder.path, folder]]),
    );

    const context = await buildChatContext('@[제품문서] 정리', {
      app,
      maxFolderFiles: 1,
    });

    expect(context.systemPrompt).toContain('[Folder File: 제품문서/a.md]');
    expect(context.systemPrompt).toContain('첫 문서');
    expect(context.systemPrompt).not.toContain('둘째 문서');
    expect(context.systemPrompt).not.toContain('외부 문서');
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'folder',
          name: '제품문서',
          status: 'partial',
          sourceIds: ['folder-1'],
        }),
      ]),
    );
  });

  it('명시 파일 안의 wikilink 참조 문서를 Vault Context에 포함한다', async () => {
    const source = createFile(
      '제품문서/고객 입장에서의 제품/데모 및 제품 기획.md',
      '핵심 기획입니다.\n[[제품 개념 정리]]',
      1000,
    );
    const reference = createFile(
      '제품문서/고객 입장에서의 제품/제품 개념 정리.md',
      '제품 개념 참조 내용',
      1000,
    );
    const app = createApp(
      new Map([
        [source.path, source],
        [reference.path, reference],
      ]),
    );

    const context = await buildChatContext(
      '@[제품문서/고객 입장에서의 제품/데모 및 제품 기획.md] 이 파일에 따라 도와줘',
      { app },
    );

    expect(context.systemPrompt).toContain(
      '[File: 제품문서/고객 입장에서의 제품/데모 및 제품 기획.md]',
    );
    expect(context.systemPrompt).toContain(
      '[Reference File: 제품문서/고객 입장에서의 제품/제품 개념 정리.md]',
    );
    expect(context.systemPrompt).toContain('제품 개념 참조 내용');
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reference',
          name: reference.path,
          status: 'attached',
        }),
      ]),
    );
  });

  it('직접 멘션 문서를 자동 RAG보다 먼저 컨텍스트에 배치한다', async () => {
    const source = createFile('제품문서/데모 및 제품 기획.md', '직접 멘션 내용', 1000);
    const ragFile = createFile('RAG.md', 'RAG 내용', 1000);
    const app = createApp(
      new Map([
        [source.path, source],
        [ragFile.path, ragFile],
      ]),
    );
    const ragEngine = createRagEngine([
      createResult('RAG.md', 'RAG 내용', createContentHash('RAG 내용')),
    ]);

    const context = await buildChatContext('@[제품문서/데모 및 제품 기획.md] 질문', {
      app,
      ragEngine,
    });

    expect(context.systemPrompt?.indexOf('[File: 제품문서/데모 및 제품 기획.md]')).toBeLessThan(
      context.systemPrompt?.indexOf('[Source rag-') ?? Number.POSITIVE_INFINITY,
    );
  });

  it('참조 문서가 컨텍스트 예산 때문에 잘리면 partial attachment로 표시한다', async () => {
    const source = createFile('제품문서/데모 및 제품 기획.md', '[[제품 개념 정리]]', 1000);
    const reference = createFile('제품문서/제품 개념 정리.md', '참조 내용이 매우 깁니다.', 1000);
    const app = createApp(
      new Map([
        [source.path, source],
        [reference.path, reference],
      ]),
    );

    const context = await buildChatContext('@[제품문서/데모 및 제품 기획.md] 질문', {
      app,
      maxContextChars: 42,
    });

    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reference',
          name: reference.path,
          status: 'partial',
        }),
      ]),
    );
  });
});

describe('buildChatContext UX reason metadata', () => {
  it('server-only mentions skip auto RAG with an explicit reason', async () => {
    const app = createApp(new Map());
    const query = vi.fn(() => Promise.resolve([]));
    const ragEngine = { query } satisfies RagQueryLike;

    const context = await buildChatContext('@web search latest docs', {
      app,
      ragEngine,
      mcpRegistry: createMcpRegistry('web'),
    });

    expect(query).not.toHaveBeenCalled();
    const autoRagAttachment = context.attachments.find(
      (attachment) => attachment.id === 'rag:auto',
    );
    expect(context.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rag:auto',
          type: 'rag',
          status: 'missing',
          autoRagReason: 'server-only',
        }),
        expect.objectContaining({
          id: 'mcp:web',
          type: 'mcp-server',
          status: 'attached',
        }),
      ]),
    );
    expect(typeof autoRagAttachment?.detail).toBe('string');
  });

  it('folder mention exposes max-files as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const first = createFile('docs/a.md', 'first', 1000);
    const second = createFile('docs/b.md', 'second', 1000);
    const app = createApp(
      new Map([
        [first.path, first],
        [second.path, second],
      ]),
      new Map([[folder.path, folder]]),
    );

    const context = await buildChatContext('@[docs] summarize', {
      app,
      maxFolderFiles: 1,
    });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        filteredCount: 1,
        folderLimitReason: 'max-files',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });

  it('folder mention은 RAG가 인덱싱하는 txt 파일도 첨부한다', async () => {
    const folder = createFolder('research');
    const textFile = createFile('research/lecture.txt', 'Research lecture', 1000, 'txt');
    const app = createApp(new Map([[textFile.path, textFile]]), new Map([[folder.path, folder]]));

    const context = await buildChatContext('@research 요약', { app });

    expect(context.citations).toEqual([
      expect.objectContaining({ filePath: 'research/lecture.txt', status: 'verified' }),
    ]);
    expect(context.attachments).toEqual([
      expect.objectContaining({ id: 'folder:research', status: 'attached', fileCount: 1 }),
    ]);
  });

  it('folder mention exposes budget as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const first = createFile(
      'docs/a.md',
      'This document is intentionally longer than the budget.',
      1000,
    );
    const app = createApp(new Map([[first.path, first]]), new Map([[folder.path, folder]]));

    const context = await buildChatContext('@[docs] summarize', {
      app,
      maxContextChars: 12,
    });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        folderLimitReason: 'budget',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });

  it('folder mention exposes read errors as the partial attachment reason', async () => {
    const folder = createFolder('docs');
    const unreadable = createFile('docs/a.md', 'unreadable', 1000);
    const readable = createFile('docs/b.md', 'readable', 1000);
    const app = createApp(
      new Map([
        [unreadable.path, unreadable],
        [readable.path, readable],
      ]),
      new Map([[folder.path, folder]]),
      new Set([unreadable.path]),
    );
    const cachedRead = app.vault.cachedRead.bind(app.vault);
    let policyRead = true;
    app.vault.cachedRead = (file) => {
      if (file.path === unreadable.path && policyRead) {
        policyRead = false;
        return Promise.resolve('unreadable');
      }
      return cachedRead(file);
    };

    const context = await buildChatContext('@[docs] summarize', {
      app,
      // 후보 확인 후 본문 읽기에서 실패하는 상황을 검증합니다.
      candidatePaths: new Set([unreadable.path, readable.path]),
    });

    const folderAttachment = context.attachments.find(
      (attachment) => attachment.type === 'folder' && attachment.name === 'docs',
    );
    expect(folderAttachment).toEqual(
      expect.objectContaining({
        type: 'folder',
        name: 'docs',
        status: 'partial',
        folderLimitReason: 'read-error',
      }),
    );
    expect(typeof folderAttachment?.detail).toBe('string');
  });
});

function createRagEngine(results: QueryResult[]): RagQueryLike {
  return {
    query: () => Promise.resolve(results),
  };
}

function createResult(filePath: string, text: string, contentHash: string): QueryResult {
  return {
    entry: {
      id: `${filePath}::0`,
      vector: [1, 0],
      metadata: {
        filePath,
        startLine: 0,
        endLine: 0,
        text,
        sourceMtime: 1000,
        sourceSize: text.length,
        contentHash,
        indexedAt: 1000,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    },
    score: 0.9,
    vectorScore: 0.9,
    bm25Score: 0.1,
    combinedScore: 0.9,
    sourcePath: filePath,
    chunkRange: { startLine: 0, endLine: 0 },
    keywordMatches: 1,
  };
}

function createFile(
  path: string,
  content: string,
  mtime: number,
  extension = 'md',
): TFile & { content: string } {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension,
    content,
    stat: {
      ctime: mtime,
      mtime,
      size: content.length,
    },
  }) as TFile & { content: string };
}

function createFolder(path: string): TFolder & { path: string } {
  return Object.assign(Object.create(TFolder.prototype), {
    path,
    name: path.split('/').pop() ?? path,
  }) as TFolder & { path: string };
}

function createApp(
  files: Map<string, TFile & { content: string }>,
  folders = new Map<string, TFolder & { path: string }>(),
  readErrors = new Set<string>(),
  tagMetadata = new Map<
    string,
    { tags?: { tag: string }[]; frontmatter?: Record<string, unknown> }
  >(),
): App {
  return {
    workspace: { getActiveFile: () => null, iterateAllLeaves: () => undefined },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
      cachedRead: (file: TFile & { content: string }) =>
        readErrors.has(file.path)
          ? Promise.reject(new Error(`read failed: ${file.path}`))
          : Promise.resolve(file.content),
      getMarkdownFiles: () => [...files.values()],
      getFiles: () => [...files.values()],
    },
    metadataCache: {
      getFileCache: (file: TFile) => tagMetadata.get(file.path) ?? null,
      getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
        const sourceFolder = sourcePath.split('/').slice(0, -1).join('/');
        const candidates = [
          linkpath,
          linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`,
          sourceFolder ? `${sourceFolder}/${linkpath}` : linkpath,
          sourceFolder && !linkpath.endsWith('.md') ? `${sourceFolder}/${linkpath}.md` : '',
        ].filter(Boolean);
        for (const candidate of candidates) {
          const file = files.get(candidate);
          if (file) return file;
        }
        return null;
      },
    },
  } as unknown as App;
}

function createMcpRegistry(...serverNames: string[]): MCPRegistry {
  return {
    getEnabledServers: () => serverNames.map((name) => ({ name })),
    getClient: (name: string) =>
      serverNames.includes(name)
        ? {
            listTools: () => Promise.resolve([]),
          }
        : null,
  } as unknown as MCPRegistry;
}
