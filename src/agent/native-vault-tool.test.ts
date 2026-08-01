import { describe, expect, it, vi } from 'vitest';
import { planAgenticToolTurn } from '../chat/tool-orchestration';
import type { ToolCallRecord } from '../chat/types';
import {
  NATIVE_VAULT_NAMED_TOOL_NAMES,
  NATIVE_VAULT_TOOL_NAME,
  NativeVaultToolRuntime,
  createNativeVaultToolDefinition,
  createNativeVaultToolDefinitions,
  type NativeVaultToolPort,
} from './native-vault-tool';

describe('Superpower Inside 네이티브 Vault 도구', () => {
  it('저장된 호출 호환성을 위한 legacy function tool 계약을 보존한다', () => {
    const definition = createNativeVaultToolDefinition();

    expect(definition).toMatchObject({
      type: 'function',
      function: {
        name: NATIVE_VAULT_TOOL_NAME,
        parameters: {
          properties: {
            action: { enum: ['search', 'related', 'read', 'list', 'links', 'stats'] },
            queries: { maxItems: 3 },
            match: { enum: ['all', 'any', 'phrase'] },
          },
        },
      },
    });
    expect(JSON.stringify(definition)).not.toMatch(/write|create|delete|modify/iu);
    expect(definition.function.description).toContain('current RAG indexing policy');
    expect(definition.function.description).toContain('excluded paths and extensions');
  });

  it('모델에는 action별 필수 인자와 상한이 분리된 6개 도구 정의를 제공한다', () => {
    const definitions = createNativeVaultToolDefinitions();
    const byName = new Map(
      definitions.map((definition) => [definition.function.name, definition.function]),
    );

    expect(definitions.map((definition) => definition.function.name)).toEqual(
      Object.values(NATIVE_VAULT_NAMED_TOOL_NAMES),
    );
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.search)?.parameters).toMatchObject({
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { maxLength: 512 },
        queries: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string', maxLength: 512 },
        },
        limit: { minimum: 1, maximum: 20 },
      },
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.read)?.parameters).toMatchObject({
      required: ['path'],
      properties: {
        start_line: { minimum: 1 },
        end_line: { minimum: 1 },
      },
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.related)?.parameters).toMatchObject({
      required: ['path'],
      properties: { limit: { minimum: 1, maximum: 20 } },
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.list)?.parameters).toMatchObject({
      required: [],
      properties: {
        cursor: { minimum: 0 },
        limit: { minimum: 1, maximum: 100 },
      },
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.links)?.parameters).toMatchObject({
      required: ['path'],
      properties: {
        direction: { enum: ['incoming', 'outgoing', 'both'] },
        limit: { minimum: 1, maximum: 100 },
      },
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.stats)?.parameters).toMatchObject({
      required: [],
      properties: {},
    });
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.search)?.description).toContain(
      'citationStatus="verified" is answer-ready current text',
    );
    expect(byName.get(NATIVE_VAULT_NAMED_TOOL_NAMES.search)?.description).toContain(
      'requiresRead=true marks a locator that still needs superpower_inside_read',
    );
    expect(
      definitions.every(
        (definition) =>
          !Object.hasOwn(
            definition.function.parameters.properties as Record<string, unknown>,
            'action',
          ),
      ),
    ).toBe(true);
  });

  it('legacy alias와 6개 named tool을 모두 네이티브 도구로 식별한다', () => {
    const runtime = new NativeVaultToolRuntime(createPort().port);

    expect(runtime.isNativeTool(NATIVE_VAULT_TOOL_NAME)).toBe(true);
    for (const name of Object.values(NATIVE_VAULT_NAMED_TOOL_NAMES)) {
      expect(runtime.isNativeTool(name)).toBe(true);
    }
    expect(runtime.isNativeTool('untrusted_tool')).toBe(false);
  });

  it('named tool 이름이 인자 안의 action보다 우선하며 Rust 정규화를 거친다', async () => {
    const { port, read, list } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await runtime.execute(
      JSON.stringify({
        action: 'list',
        path: 'Projects/Alpha.md',
        start_line: 2,
        end_line: 3,
      }),
      undefined,
      NATIVE_VAULT_NAMED_TOOL_NAMES.read,
    );

    expect(read).toHaveBeenCalledWith({
      action: 'read',
      path: 'Projects/Alpha.md',
      startLine: 2,
      startOffset: 0,
      endLine: 3,
    });
    expect(list).not.toHaveBeenCalled();
  });

  it('read 결과를 모델용 구조화 텍스트와 검증 가능한 출처로 반환한다', async () => {
    const { port, read } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    const result = await runtime.execute(
      JSON.stringify({ action: 'read', path: 'Projects/Alpha.md', start_line: 2, end_line: 3 }),
    );

    expect(read).toHaveBeenCalledWith({
      action: 'read',
      path: 'Projects/Alpha.md',
      startLine: 2,
      startOffset: 0,
      endLine: 3,
    });
    expect(JSON.parse(result.modelText)).toMatchObject({
      action: 'read',
      path: 'Projects/Alpha.md',
      startLine: 2,
      endLine: 3,
      content: '둘째 줄\n셋째 줄',
    });
    expect(result.citations).toEqual([
      expect.objectContaining({
        id: 'vault:Projects/Alpha.md:2-3',
        filePath: 'Projects/Alpha.md',
        line: 2,
        endLine: 3,
        status: 'verified',
      }),
    ]);
  });

  it('list cursor와 limit을 정규화한 요청으로 포트에 전달한다', async () => {
    const { port, list } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await runtime.execute(
      JSON.stringify({ action: 'list', path: 'Projects', cursor: 4, limit: 500 }),
    );

    expect(list).toHaveBeenCalledWith({
      action: 'list',
      path: 'Projects',
      cursor: 4,
      limit: 100,
    });
  });

  it('search 결과의 각 근거를 출처로 보존한다', async () => {
    const { port } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    const result = await runtime.execute(
      JSON.stringify({ action: 'search', query: '고객 문제', limit: 3 }),
    );

    expect(result.citations).toEqual([
      expect.objectContaining({
        id: 'vault:Projects/Alpha.md:2-3',
        filePath: 'Projects/Alpha.md',
      }),
    ]);
  });

  it('search는 기본적으로 모든 검색어가 일치하는 요청으로 정규화한다', async () => {
    const { port, search } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await runtime.execute(JSON.stringify({ action: 'search', query: '네빌 창세기' }));

    expect(search).toHaveBeenCalledWith({
      action: 'search',
      query: '네빌 창세기',
      queries: ['네빌 창세기'],
      path: '',
      limit: 8,
      match: 'all',
    });
  });

  it('search의 보조 검색어 3개는 필수 검색어와 함께 총 4개로 정규화한다', async () => {
    const { port, search } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await runtime.execute(
      JSON.stringify({
        action: 'search',
        query: '  Customer   Problem  ',
        queries: ['Onboarding friction', '이탈 원인', '활성화 장애'],
      }),
    );

    expect(search).toHaveBeenCalledWith({
      action: 'search',
      query: 'Customer Problem',
      queries: ['Customer Problem', 'Onboarding friction', '이탈 원인', '활성화 장애'],
      path: '',
      limit: 8,
      match: 'all',
    });
  });

  it('search의 원 검색어를 포함해 고유 검색어가 4개를 넘으면 포트 I/O 전에 거부한다', async () => {
    const { port, search } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await expect(
      runtime.execute(
        JSON.stringify({
          action: 'search',
          query: 'one',
          queries: ['two', 'three', 'four', 'five'],
        }),
      ),
    ).rejects.toThrow('보조 검색어는 최대 3개');
    expect(search).not.toHaveBeenCalled();
  });

  it('과도하게 긴 검색어와 원래 검색 항목 수를 포트 I/O 전에 거부한다', async () => {
    const { port, search } = createPort();
    const runtime = new NativeVaultToolRuntime(port);
    const excessiveTerms = Array.from({ length: 33 }, (_, index) => `term${index}`).join(',');

    await expect(
      runtime.execute(JSON.stringify({ action: 'search', query: '가'.repeat(513) })),
    ).rejects.toThrow('검색어가 너무 깁니다');
    await expect(
      runtime.execute(JSON.stringify({ action: 'search', query: excessiveTerms })),
    ).rejects.toThrow('검색 항목이 너무 많습니다');
    expect(search).not.toHaveBeenCalled();
  });

  it('명시한 match all은 OR가 포함된 query에서도 그대로 보존한다', async () => {
    const { port, search } = createPort();
    const runtime = new NativeVaultToolRuntime(port);

    await runtime.execute(
      JSON.stringify({
        action: 'search',
        query: 'Neville OR Goddard',
        match: 'all',
      }),
    );

    expect(search).toHaveBeenCalledWith({
      action: 'search',
      query: 'Neville OR Goddard',
      queries: ['Neville OR Goddard'],
      path: '',
      limit: 8,
      match: 'all',
    });
  });

  it('잘못된 JSON과 지원하지 않는 action을 실행 전에 거부한다', async () => {
    const runtime = new NativeVaultToolRuntime(createPort().port);

    await expect(runtime.execute('{')).rejects.toThrow('유효한 JSON');
    await expect(
      runtime.execute(JSON.stringify({ action: 'write', path: 'Alpha.md' })),
    ).rejects.toThrow('지원하지 않는 동작');
  });

  it('전체 중단 signal이 이미 취소되었으면 포트 I/O를 시작하지 않는다', async () => {
    const { port, read } = createPort();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new NativeVaultToolRuntime(port).execute(
        JSON.stringify({ action: 'read', path: 'Projects/Alpha.md' }),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'related',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.related,
      argumentsText: JSON.stringify({ path: 'Projects/Alpha.md' }),
      spyName: 'related',
    },
    {
      label: 'search',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.search,
      argumentsText: JSON.stringify({ query: '고객 문제' }),
      spyName: 'search',
    },
    {
      label: 'read',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.read,
      argumentsText: JSON.stringify({ path: 'Projects/Alpha.md' }),
      spyName: 'read',
    },
    {
      label: 'list',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.list,
      argumentsText: JSON.stringify({ path: 'Projects' }),
      spyName: 'list',
    },
    {
      label: 'links',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.links,
      argumentsText: JSON.stringify({ path: 'Projects/Alpha.md' }),
      spyName: 'links',
    },
    {
      label: 'stats',
      toolName: NATIVE_VAULT_NAMED_TOOL_NAMES.stats,
      argumentsText: '{}',
      spyName: 'stats',
    },
  ] as const)(
    '$label 실행은 같은 AbortSignal을 포트 경계까지 전달한다',
    async ({ toolName, argumentsText, spyName }) => {
      const fixture = createPort();
      const controller = new AbortController();

      await new NativeVaultToolRuntime(fixture.port).execute(
        argumentsText,
        controller.signal,
        toolName,
      );

      expect(fixture[spyName]).toHaveBeenCalledWith(expect.any(Object), controller.signal);
    },
  );

  it('큰 read의 전체 JSON wire를 64KiB 안에 보존하고 partial 후속 읽기를 계획한다', async () => {
    const fixture = createPort();
    fixture.read.mockResolvedValue({
      action: 'read',
      path: 'Projects/Large.md',
      startLine: 1,
      endLine: 400,
      totalLines: 800,
      truncated: true,
      content: '\u0000"\\한글🙂'.repeat(20_000),
      citations: [
        {
          id: 'vault:Projects/Large.md:1-400',
          filePath: 'Projects/Large.md',
          line: 1,
          endLine: 400,
          preview: '큰 원문',
          status: 'verified',
        },
      ],
    });
    const execution = await new NativeVaultToolRuntime(fixture.port).execute(
      JSON.stringify({ path: 'Projects/Large.md' }),
      undefined,
      NATIVE_VAULT_NAMED_TOOL_NAMES.read,
    );

    expect(new TextEncoder().encode(execution.modelText).byteLength).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(JSON.parse(execution.modelText)).toMatchObject({
      action: 'read',
      path: 'Projects/Large.md',
      startLine: 1,
      startOffset: 0,
      endLine: 1,
      truncated: true,
    });
    const boundedRead = JSON.parse(execution.modelText) as {
      content: string;
      nextStartLine: number;
      nextStartOffset: number;
      citations: Array<{ preview: string; endLine: number }>;
    };
    expect(boundedRead.nextStartLine).toBe(1);
    expect(boundedRead.nextStartOffset).toBe(boundedRead.content.length);
    expect(boundedRead.nextStartOffset).toBeGreaterThan(0);
    expect(boundedRead.content.startsWith(boundedRead.citations[0]?.preview ?? '')).toBe(true);
    expect(
      new TextEncoder().encode(boundedRead.citations[0]?.preview ?? '').byteLength,
    ).toBeLessThanOrEqual(1024);
    expect(boundedRead.citations[0]?.endLine).toBe(1);

    const toolCalls: ToolCallRecord[] = [
      {
        id: 'large-read',
        name: NATIVE_VAULT_NAMED_TOOL_NAMES.read,
        arguments: '{"path":"Projects/Large.md"}',
        normalizedResult: execution.modelText,
        status: 'success',
        serverName: 'Superpower Inside',
        executionKind: 'native',
      },
    ];
    const plan = planAgenticToolTurn({
      question: '이 파일 전체의 내용을 확인해줘',
      contextAttachments: [],
      explicitToolServerCount: 0,
      toolDefinitions: createNativeVaultToolDefinitions(),
      toolCalls,
      phase: 'after-tools',
      round: 1,
      maxRounds: 10,
    });

    expect(plan).toMatchObject({
      nextAction: 'verify-source',
      ledger: { verifiedReads: 1, completeReads: 0 },
    });
    expect(plan?.checkpoint).toContain('read was truncated');
  });

  it('큰 list 결과는 파일 prefix와 연속 cursor를 함께 보존하며 64KiB 안으로 줄인다', async () => {
    const fixture = createPort();
    fixture.list.mockResolvedValueOnce({
      action: 'list',
      path: '',
      exists: true,
      files: Array.from({ length: 100 }, (_, index) => ({
        path: `Notes/${String(index).padStart(3, '0')}-${'긴경로'.repeat(180)}.md`,
        modifiedAt: index,
        size: index + 1,
      })),
      nextCursor: 100,
      total: 200,
      citations: [],
    });

    const execution = await new NativeVaultToolRuntime(fixture.port).execute(
      '{}',
      undefined,
      NATIVE_VAULT_NAMED_TOOL_NAMES.list,
    );
    const result = JSON.parse(execution.modelText) as {
      files: unknown[];
      nextCursor: number;
    };

    expect(new TextEncoder().encode(execution.modelText).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(result.files.length).toBeLessThan(100);
    expect(result.nextCursor).toBe(result.files.length);
  });

  it('큰 search 결과는 완전한 hit 단위로 줄이고 잘림 상태를 표시한다', async () => {
    const fixture = createPort();
    fixture.search.mockResolvedValueOnce({
      action: 'search',
      query: '고객 근거',
      path: '',
      match: 'all',
      scannedFiles: 100,
      unreadableFiles: 0,
      totalHits: 100,
      truncated: false,
      hits: Array.from({ length: 20 }, (_, index) => ({
        path: `Notes/${index}.md`,
        startLine: 1,
        endLine: 10,
        preview: `근거-${index}-${'한글🙂'.repeat(2_000)}`,
        score: 1 - index / 100,
        requiresRead: true as const,
      })),
      citations: Array.from({ length: 20 }, (_, index) => ({
        id: `vault:Notes/${index}.md:1-10`,
        filePath: `Notes/${index}.md`,
        line: 1,
        endLine: 10,
        preview: `근거-${index}-${'한글🙂'.repeat(2_000)}`,
        status: 'candidate' as const,
      })),
    });

    const execution = await new NativeVaultToolRuntime(fixture.port).execute(
      JSON.stringify({ query: '고객 근거' }),
      undefined,
      NATIVE_VAULT_NAMED_TOOL_NAMES.search,
    );
    const result = JSON.parse(execution.modelText) as {
      hits: unknown[];
      citations: unknown[];
      truncated: boolean;
    };

    expect(new TextEncoder().encode(execution.modelText).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(result.hits.length).toBeLessThan(20);
    expect(result.citations).toHaveLength(result.hits.length);
    expect(result.truncated).toBe(true);
  });

  it('큰 links 결과는 양쪽 총계와 잘림 상태를 보존하며 64KiB 안으로 줄인다', async () => {
    const fixture = createPort();
    fixture.links.mockResolvedValueOnce({
      action: 'links',
      path: 'Notes/Hub.md',
      direction: 'both',
      outgoing: Array.from({ length: 100 }, (_, index) =>
        `Outgoing/${index}-${'긴경로'.repeat(120)}.md`,
      ),
      incoming: Array.from({ length: 100 }, (_, index) =>
        `Incoming/${index}-${'긴경로'.repeat(120)}.md`,
      ),
      totalOutgoing: 100,
      totalIncoming: 100,
      truncated: false,
      citations: [],
    });

    const execution = await new NativeVaultToolRuntime(fixture.port).execute(
      JSON.stringify({ path: 'Notes/Hub.md' }),
      undefined,
      NATIVE_VAULT_NAMED_TOOL_NAMES.links,
    );
    const result = JSON.parse(execution.modelText) as {
      outgoing: unknown[];
      incoming: unknown[];
      totalOutgoing: number;
      totalIncoming: number;
      truncated: boolean;
    };

    expect(new TextEncoder().encode(execution.modelText).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(result.outgoing.length + result.incoming.length).toBeLessThan(200);
    expect(result).toMatchObject({ totalOutgoing: 100, totalIncoming: 100, truncated: true });
  });
});

function createPort(): {
  port: NativeVaultToolPort;
  read: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  related: ReturnType<typeof vi.fn>;
  links: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
} {
  const citation = {
    id: 'vault:Projects/Alpha.md:2-3',
    filePath: 'Projects/Alpha.md',
    line: 2,
    endLine: 3,
    preview: '둘째 줄 셋째 줄',
    status: 'verified' as const,
  };
  const read = vi.fn(() =>
    Promise.resolve({
      action: 'read' as const,
      path: 'Projects/Alpha.md',
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      truncated: false,
      content: '둘째 줄\n셋째 줄',
      citations: [citation],
    }),
  );
  const list = vi.fn(() =>
    Promise.resolve({
      action: 'list' as const,
      path: 'Projects',
      exists: true,
      files: [{ path: 'Projects/Alpha.md', modifiedAt: 1, size: 24 }],
      nextCursor: null,
      total: 1,
      citations: [],
    }),
  );
  const search = vi.fn(() =>
    Promise.resolve({
      action: 'search' as const,
      query: '고객 문제',
      path: '',
      match: 'all' as const,
      scannedFiles: 1,
      unreadableFiles: 0,
      totalHits: 1,
      truncated: false,
      hits: [
        {
          path: 'Projects/Alpha.md',
          startLine: 2,
          endLine: 3,
          preview: '둘째 줄 셋째 줄',
          score: 0.91,
          requiresRead: true as const,
        },
      ],
      citations: [citation],
    }),
  );
  const related = vi.fn(() =>
    Promise.resolve({
      action: 'related' as const,
      path: 'Projects/Alpha.md',
      startLine: 1,
      endLine: 4,
      hits: [],
      truncated: false,
      citations: [],
    }),
  );
  const links = vi.fn(() =>
    Promise.resolve({
      action: 'links' as const,
      path: 'Projects/Alpha.md',
      direction: 'both' as const,
      outgoing: [],
      incoming: [],
      citations: [],
    }),
  );
  const stats = vi.fn(() =>
    Promise.resolve({
      action: 'stats' as const,
      fileCount: 1,
      totalBytes: 24,
      citations: [],
    }),
  );
  const port: NativeVaultToolPort = {
    search,
    related,
    read,
    list,
    links,
    stats,
  };
  return { port, read, list, search, related, links, stats };
}
