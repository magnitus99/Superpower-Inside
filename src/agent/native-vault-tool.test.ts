import { describe, expect, it, vi } from 'vitest';
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
            action: { enum: ['search', 'read', 'list', 'links', 'stats'] },
            match: { enum: ['all', 'any', 'phrase'] },
          },
        },
      },
    });
    expect(JSON.stringify(definition)).not.toMatch(/write|create|delete|modify/iu);
    expect(definition.function.description).toContain('current RAG indexing policy');
    expect(definition.function.description).toContain('excluded paths and extensions');
  });

  it('모델에는 action별 필수 인자와 상한이 분리된 5개 도구 정의를 제공한다', () => {
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
      'requires a follow-up superpower_inside_read',
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

  it('legacy alias와 5개 named tool을 모두 네이티브 도구로 식별한다', () => {
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
      path: '',
      limit: 8,
      match: 'all',
    });
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
});

function createPort(): {
  port: NativeVaultToolPort;
  read: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
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
  const port: NativeVaultToolPort = {
    search,
    read,
    list,
    links: vi.fn(() =>
      Promise.resolve({
        action: 'links' as const,
        path: 'Projects/Alpha.md',
        direction: 'both' as const,
        outgoing: [],
        incoming: [],
        citations: [],
      }),
    ),
    stats: vi.fn(() =>
      Promise.resolve({
        action: 'stats' as const,
        fileCount: 1,
        totalBytes: 24,
        citations: [],
      }),
    ),
  };
  return { port, read, list, search };
}
