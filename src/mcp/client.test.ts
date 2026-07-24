import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportClose: vi.fn<() => Promise<void>>(),
  transportParams: [] as unknown[],
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function Client() {
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
});
