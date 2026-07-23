import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_VAULT_TOOL_NAME,
  NativeVaultToolRuntime,
  createNativeVaultToolDefinition,
  type NativeVaultToolPort,
} from './native-vault-tool';

describe('Superpower Inside 네이티브 Vault 도구', () => {
  it('쓰기 동작 없이 단일 function tool 계약만 노출한다', () => {
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
      match: 'all' as const,
      hits: [
        {
          path: 'Projects/Alpha.md',
          startLine: 2,
          endLine: 3,
          preview: '둘째 줄 셋째 줄',
          score: 0.91,
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
