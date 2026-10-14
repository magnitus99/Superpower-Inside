import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPClientManager } from './client';
import { buildMcpJsonEditorValue, standardToInternal } from '../settings';
import { validateMcpJson } from '../utils/mcp-json';
import { migrateStoredMcpServersRust } from '../rag/rust-core';

vi.mock('obsidian', () => ({
  App: class {},
  Modal: class {},
  Notice: class {},
  Plugin: class {},
  PluginSettingTab: class {},
  Platform: { isDesktopApp: true },
  Setting: class {},
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(
  mode: 'http-json' | 'http-sse' | 'sse',
  token?: string,
  termination: 'ok' | '405' | 'stall' = 'ok',
) {
  const protocol = new Server(
    { name: 'synthetic-server', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  let listed = 0;
  let cancellation = (): void => {};
  const cancelled = new Promise<void>((resolve) => {
    cancellation = resolve;
  });
  protocol.setRequestHandler(ListToolsRequestSchema, (request) => {
    listed++;
    return {
      tools: [
        { name: request.params?.cursor ? 'second' : 'first', inputSchema: { type: 'object' } },
      ],
      ...(request.params?.cursor ? {} : { nextCursor: 'page-2' }),
    };
  });
  protocol.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === 'wait') {
      await new Promise<void>((resolve) => {
        extra.signal.addEventListener(
          'abort',
          () => {
            cancellation();
            resolve();
          },
          { once: true },
        );
      });
    }
    return {
      content: [{ type: 'text', text: '합성 결과' }],
      structuredContent: { input: request.params.arguments },
    };
  });
  let sse: SSEServerTransport | undefined;
  const http =
    mode === 'sse'
      ? undefined
      : new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: mode === 'http-json',
        });
  if (http) await protocol.connect(http);
  const authorization: string[] = [];
  let deletions = 0;
  const host = createServer((request, response) => {
    if (request.method === 'DELETE') {
      deletions++;
      if (termination === '405') {
        response.writeHead(405);
        response.end();
        return;
      }
      if (termination === 'stall') return;
    }
    authorization.push(request.headers.authorization ?? '');
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end();
      return;
    }
    const handle = async (): Promise<void> => {
      if (http) await http.handleRequest(request, response);
      else if (request.method === 'GET') {
        sse = new SSEServerTransport('/messages', response);
        await protocol.connect(sse);
      } else if (sse) await sse.handlePostMessage(request, response);
      else {
        response.writeHead(400);
        response.end();
      }
    };
    void handle().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await listen(host);
  cleanup.push(async () => {
    await protocol.close();
    await closeHost(host);
  });
  return {
    url: address(host),
    protocol,
    authorization,
    listed: () => listed,
    cancelled,
    deletions: () => deletions,
  };
}
async function listen(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}
function address(server: HttpServer): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}
async function closeHost(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function manager(timeout = 1000): MCPClientManager {
  const client = new MCPClientManager({ connectTimeoutMs: timeout });
  cleanup.push(() => client.disconnect());
  return client;
}

describe('공식 SDK 서버와 원격 MCP 실제 소켓 연동', () => {
  it('Claude Desktop JSON에서 stdio·HTTP·SSE를 함께 가져와 저장·복원한 뒤 실제 도구를 호출한다', async () => {
    const modern = await fixture('http-json');
    const legacy = await fixture('sse');
    const localScript = pathToFileURL(resolve('tests/fixtures/local-mcp-server.mjs')).href;
    const config = {
      mcpServers: {
        local: {
          command: process.execPath,
          args: [
            '--input-type=module',
            '-e',
            `if (process.env.SYNTHETIC_OPTION !== '한글 값' || process.argv[1] !== 'argument with spaces') throw new Error('fixture config mismatch'); await import(${JSON.stringify(localScript)});`,
            'argument with spaces',
          ],
          env: { SYNTHETIC_OPTION: '한글 값' },
        },
        modern: { url: modern.url },
        legacy: { url: legacy.url, transport: 'sse' as const },
      },
    };
    expect(validateMcpJson(JSON.stringify(config))).toEqual({ valid: true, data: config });
    const saved = buildMcpJsonEditorValue(standardToInternal(config));
    const restored = migrateStoredMcpServersRust(
      standardToInternal(JSON.parse(saved) as Parameters<typeof standardToInternal>[0]),
    );
    expect(restored).toHaveLength(3);
    if (!restored) throw new Error('MCP migration unavailable');
    const clients = restored.map(() => manager());
    for (const [index, server] of restored.entries()) {
      const client = clients[index];
      await client.connect(server);
      expect(client.isConnected()).toBe(true);
      const tools = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      await expect(
        client.callTool(server.name === 'local' ? 'search' : 'first', { query: 'synthetic query' }),
      ).resolves.toMatchObject({ content: [{ type: 'text' }] });
    }
    const local = clients[0];
    await local.disconnect();
    await local.connect(restored[0]);
    expect((await local.listTools()).some((tool) => tool.name === 'search')).toBe(true);
  });
  it.each(['http-json', 'http-sse', 'sse'] as const)(
    '%s 초기화·인증·페이지·도구 결과·캐시 무효화·취소·재연결',
    async (mode) => {
      const remote = await fixture(mode, 'synthetic-token');
      const client = manager();
      const config = {
        name: 'fixture',
        command: '',
        url: remote.url,
        transport: mode === 'sse' ? ('sse' as const) : ('http' as const),
      };
      await client.connect(config, 'synthetic-token');
      expect(client.isConnected()).toBe(true);
      expect((await client.listTools()).map((tool) => tool.name)).toEqual(['first', 'second']);
      await client.listTools();
      expect(remote.listed()).toBe(2);
      await expect(client.callTool('first', { query: 'independent' })).resolves.toMatchObject({
        content: [{ text: '합성 결과' }],
        structuredContent: { input: { query: 'independent' } },
      });
      const notification = new Promise<void>((resolve) => {
        // 다음 목록 요청이 실제 알림 수신 뒤 실행되는지 SDK 송신 완료와 이벤트 루프로 확인한다.
        void remote.protocol.sendToolListChanged().then(() => setTimeout(resolve, 30));
      });
      await notification;
      await client.listTools();
      expect(remote.listed()).toBe(4);
      const controller = new AbortController();
      const pending = client.callTool('wait', {}, controller.signal);
      const assertion = expect(pending).rejects.toBeDefined();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      controller.abort();
      await assertion;
      await remote.cancelled;
      expect(remote.authorization.every((header) => header === 'Bearer synthetic-token')).toBe(
        true,
      );
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(remote.deletions()).toBe(mode === 'sse' ? 0 : 1);
      if (mode !== 'sse') {
        const another = await fixture(mode);
        await client.connect({ ...config, url: another.url });
        expect((await client.listTools()).length).toBe(2);
      }
    },
  );

  it.each(['http', 'sse'] as const)(
    '%s 인증 실패와 초기화 timeout은 연결을 정리한다',
    async (transport) => {
      const remote = await fixture(transport === 'http' ? 'http-json' : 'sse', 'expected');
      const client = manager(50);
      await expect(
        client.connect({ name: 'fixture', command: '', url: remote.url, transport }, 'wrong'),
      ).rejects.toBeDefined();
      expect(client.isConnected()).toBe(false);
      const host = createServer(() => {});
      await listen(host);
      cleanup.push(() => closeHost(host));
      await expect(
        client.connect({ name: 'fixture', command: '', url: address(host), transport }),
      ).rejects.toThrow('timed out');
      expect(client.isConnected()).toBe(false);
    },
  );

  it('토큰을 외부 평문 HTTP로 보내지 않는다', async () => {
    await expect(
      manager().connect({ name: 'fixture', command: '', url: 'http://example.com/mcp' }, 'secret'),
    ).rejects.toThrow('HTTPS');
  });
  it.each(['405', 'stall'] as const)(
    'HTTP 세션 종료 %s에도 로컬 연결을 닫는다',
    async (termination) => {
      const remote = await fixture('http-json', undefined, termination);
      const client = manager(100);
      await client.connect({ name: 'fixture', command: '', url: remote.url });
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(remote.deletions()).toBe(1);
    },
  );
});
