import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ExplicitMcpToolDiscoveryError,
  collectExternalMcpToolDefinitions,
} from './mcp-tool-catalog';

function createOptions(
  overrides: Partial<Parameters<typeof collectExternalMcpToolDefinitions>[0]> = {},
): Parameters<typeof collectExternalMcpToolDefinitions>[0] {
  return {
    serverNames: ['docs'],
    explicitlyMentionedServerNames: ['docs'],
    reservedToolNames: new Set(['superpower_inside_search']),
    getClient: () => undefined,
    isActive: () => true,
    ...overrides,
  };
}

describe('MCP 채팅 도구 카탈로그', () => {
  it('사용자가 명시한 서버의 클라이언트가 없으면 조용히 다른 도구로 대체하지 않는다', async () => {
    await expect(collectExternalMcpToolDefinitions(createOptions())).rejects.toMatchObject({
      name: 'ExplicitMcpToolDiscoveryError',
      serverName: 'docs',
    });
  });

  it('사용자가 명시한 서버의 tools/list 실패 원인을 보존한다', async () => {
    const cause = new Error('server closed');
    const request = collectExternalMcpToolDefinitions(
      createOptions({
        getClient: () => ({
          listTools: vi.fn().mockRejectedValue(cause),
        }),
      }),
    );

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<ExplicitMcpToolDiscoveryError>>({
        name: 'ExplicitMcpToolDiscoveryError',
        serverName: 'docs',
        cause,
      }),
    );
  });

  it('자동으로 선택된 서버가 실패하면 내장 도구 흐름을 막지 않는다', async () => {
    const definitions = await collectExternalMcpToolDefinitions(
      createOptions({
        explicitlyMentionedServerNames: [],
        getClient: () => ({
          listTools: vi.fn().mockRejectedValue(new Error('not connected')),
        }),
      }),
    );

    expect(definitions).toEqual([]);
  });

  it('비활성화된 run은 명시 서버 오류로 잘못 표시하지 않는다', async () => {
    let active = true;
    const definitions = await collectExternalMcpToolDefinitions(
      createOptions({
        getClient: () => ({
          listTools: vi.fn().mockImplementation(() => {
            active = false;
            return Promise.reject(new Error('aborted'));
          }),
        }),
        isActive: () => active,
      }),
    );

    expect(definitions).toEqual([]);
  });

  it('외부 schema를 provider 도구 정의로 변환하고 예약된 이름은 제외한다', async () => {
    const definitions = await collectExternalMcpToolDefinitions(
      createOptions({
        getClient: () => ({
          listTools: vi.fn().mockResolvedValue([
            {
              name: 'superpower_inside_search',
              description: '충돌',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'lookup_docs',
              description: '문서를 조회합니다.',
              inputSchema: {
                type: 'object',
                properties: { query: { type: 'string' } },
              },
            },
          ]),
        }),
      }),
    );

    expect(definitions).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup_docs',
          description: '문서를 조회합니다.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      },
    ]);
  });

  it('초기 요청과 승인 재개 모두 명시 서버 목록을 별도로 전달한다', () => {
    const source = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');

    expect(source).toContain('explicitToolServerCount: explicitlyMentionedServers.length');
    expect(
      source.match(
        /this\.collectToolDefinitions\(\s*mentionedServers,\s*explicitlyMentionedServers,\s*run,?\s*\)/g,
      ),
    ).toHaveLength(2);
  });
});
