import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportClose: vi.fn<() => Promise<void>>(),
  transportParams: [] as unknown[],
  clientOptions: [] as unknown[],
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function Client(...args: unknown[]) {
    sdkMocks.clientOptions.push(args[1]);
    return {
      connect: sdkMocks.connect,
      close: sdkMocks.close,
      listTools: sdkMocks.listTools,
      callTool: sdkMocks.callTool,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function StdioClientTransport(params: unknown) {
    sdkMocks.transportParams.push(params);
    return {
      close: sdkMocks.transportClose,
    };
  }),
}));

import { MCPClientManager } from './client';

describe('MCPClientManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sdkMocks.connect.mockReset();
    sdkMocks.close.mockReset();
    sdkMocks.listTools.mockReset();
    sdkMocks.callTool.mockReset();
    sdkMocks.transportClose.mockReset();
    sdkMocks.transportParams.length = 0;
    sdkMocks.clientOptions.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stdio 연결이 timeout되면 내부 client와 transport 상태를 정리한다', async () => {
    sdkMocks.connect.mockReturnValue(new Promise(() => undefined));
    sdkMocks.close.mockResolvedValue(undefined);
    sdkMocks.transportClose.mockResolvedValue(undefined);
    const client = new MCPClientManager({ connectTimeoutMs: 25 });

    const result = client.connectStdio({
      name: 'slow',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });
    const observed = result.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(observed).resolves.toBe('MCP stdio connection timed out after 25ms');
    expect(sdkMocks.close).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);
  });

  it('tools/list가 멈추면 timeout으로 대기를 끝내고 다음 조회를 새로 시작한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.listTools
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce({
        tools: [{ name: 'recovered', inputSchema: { type: 'object' as const } }],
      });
    const client = new MCPClientManager({ toolsListTimeoutMs: 25 });
    await client.connectStdio({
      name: 'slow-list',
      command: 'npx',
      args: ['-y', 'slow-list-mcp'],
    });

    const first = client.listTools();
    const observed = first.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(observed).resolves.toBe('MCP tools/list timed out after 25ms');
    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'recovered' }),
    ]);
    expect(sdkMocks.listTools).toHaveBeenCalledTimes(2);
  });

  it('호출 run의 AbortSignal은 공유 tools/list 응답을 기다리는 caller만 즉시 취소한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.listTools.mockReturnValue(new Promise(() => undefined));
    const client = new MCPClientManager({ toolsListTimeoutMs: 1_000 });
    const controller = new AbortController();
    await client.connectStdio({
      name: 'abort-list',
      command: 'npx',
      args: ['-y', 'abort-list-mcp'],
    });

    const request = client.listTools(controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(sdkMocks.listTools).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it('도구 호출 취소 신호를 SDK RequestOptions까지 그대로 전달한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.callTool.mockResolvedValue({ content: [] });
    const client = new MCPClientManager();
    const controller = new AbortController();
    await client.connectStdio({
      name: 'abortable',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    });

    await client.callTool('slow_tool', { query: 'obsidian' }, controller.signal);

    expect(sdkMocks.callTool).toHaveBeenCalledWith(
      { name: 'slow_tool', arguments: { query: 'obsidian' } },
      undefined,
      { signal: controller.signal },
    );
  });

  it('tools/list의 모든 cursor 페이지를 한 요청으로 합치고 동시 호출과 후속 호출에 캐시한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.listTools.mockImplementation((params?: { cursor?: string }) =>
      Promise.resolve(
        params?.cursor === 'second'
          ? {
              tools: [
                {
                  name: 'read_file',
                  description: '파일 읽기',
                  inputSchema: { type: 'object' as const },
                },
              ],
            }
          : {
              tools: [
                {
                  name: 'search',
                  description: '검색',
                  inputSchema: { type: 'object' as const },
                },
              ],
              nextCursor: 'second',
            },
      ),
    );
    const client = new MCPClientManager();
    await client.connectStdio({
      name: 'paged',
      command: 'npx',
      args: ['-y', 'paged-mcp'],
    });

    const [first, concurrent] = await Promise.all([client.listTools(), client.listTools()]);
    const cached = await client.listTools();

    expect(first.map((tool) => tool.name)).toEqual(['search', 'read_file']);
    expect(concurrent).toEqual(first);
    expect(cached).toEqual(first);
    expect(sdkMocks.listTools).toHaveBeenCalledTimes(2);
    expect(sdkMocks.listTools).toHaveBeenNthCalledWith(1);
    expect(sdkMocks.listTools).toHaveBeenNthCalledWith(2, { cursor: 'second' });
  });

  it('tools/list_changed 알림은 자동 재요청 없이 캐시만 무효화한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.listTools
      .mockResolvedValueOnce({
        tools: [{ name: 'before', inputSchema: { type: 'object' as const } }],
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'after', inputSchema: { type: 'object' as const } }],
      });
    const client = new MCPClientManager();
    await client.connectStdio({
      name: 'changing',
      command: 'npx',
      args: ['-y', 'changing-mcp'],
    });
    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'before' }),
    ]);
    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'before' }),
    ]);

    const options = sdkMocks.clientOptions[0] as {
      listChanged?: {
        tools?: {
          autoRefresh?: boolean;
          debounceMs?: number;
          onChanged?: () => void;
        };
      };
    };
    expect(options.listChanged?.tools).toMatchObject({
      autoRefresh: false,
      debounceMs: 0,
    });
    options.listChanged?.tools?.onChanged?.();
    expect(sdkMocks.listTools).toHaveBeenCalledTimes(1);

    await expect(client.listTools()).resolves.toEqual([expect.objectContaining({ name: 'after' })]);
    expect(sdkMocks.listTools).toHaveBeenCalledTimes(2);
  });

  it('연결 종료와 재연결 사이에는 이전 도구 캐시를 재사용하지 않는다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.close.mockResolvedValue(undefined);
    sdkMocks.listTools
      .mockResolvedValueOnce({
        tools: [{ name: 'first_connection', inputSchema: { type: 'object' as const } }],
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'second_connection', inputSchema: { type: 'object' as const } }],
      });
    const client = new MCPClientManager();
    const config = {
      name: 'reconnected',
      command: 'npx',
      args: ['-y', 'reconnected-mcp'],
    };

    await client.connectStdio(config);
    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'first_connection' }),
    ]);
    await client.disconnect();
    await client.connectStdio(config);
    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({ name: 'second_connection' }),
    ]);

    expect(sdkMocks.listTools).toHaveBeenCalledTimes(2);
  });

  it('반복 nextCursor를 감지해 무한 pagination을 중단한다', async () => {
    sdkMocks.connect.mockResolvedValue(undefined);
    sdkMocks.listTools.mockResolvedValue({
      tools: [],
      nextCursor: 'repeated',
    });
    const client = new MCPClientManager();
    await client.connectStdio({
      name: 'looping',
      command: 'npx',
      args: ['-y', 'looping-mcp'],
    });

    await expect(client.listTools()).rejects.toThrow('repeated nextCursor');
    expect(sdkMocks.listTools).toHaveBeenCalledTimes(2);
  });
});
