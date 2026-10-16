import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ExplicitMcpToolDiscoveryError,
  collectExternalMcpToolDefinitions,
  scopeMcpServerNames,
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

  it('외부 schema를 provider 도구 정의로 변환하고 native 예약 이름 충돌은 안전한 alias로 보존한다', async () => {
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

    expect(definitions).toHaveLength(2);
    expect(definitions[0]?.function).toMatchObject({
      description: 'MCP server "docs". Actual tool "superpower_inside_search". 충돌',
      parameters: { type: 'object', properties: {} },
    });
    expect(definitions[0]?.function.name).not.toBe('superpower_inside_search');
    expect(definitions[0]?.function.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(definitions[1]).toEqual(
      {
        type: 'function',
        function: {
          name: 'lookup_docs',
          description: 'MCP server "docs". Actual tool "lookup_docs". 문서를 조회합니다.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      },
    );
  });

  it('서로 다른 명시 서버의 같은 실제 이름을 서로 다른 deterministic alias로 모두 노출한다', async () => {
    const clients = new Map([
      [
        'primary',
        {
          listTools: vi.fn().mockResolvedValue([
            { name: 'search', inputSchema: { type: 'object', properties: {} } },
          ]),
        },
      ],
      [
        'secondary',
        {
          listTools: vi.fn().mockResolvedValue([
            { name: 'search', inputSchema: { type: 'object', properties: {} } },
          ]),
        },
      ],
    ]);
    const options = createOptions({
      serverNames: ['primary', 'secondary'],
      explicitlyMentionedServerNames: ['primary', 'secondary'],
      getClient: (serverName) => clients.get(serverName),
    });

    const first = await collectExternalMcpToolDefinitions(options);
    const second = await collectExternalMcpToolDefinitions({
      ...options,
      serverNames: ['secondary', 'primary'],
    });
    const names = first.map((definition) => definition.function.name);

    expect(first).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names).not.toContain('search');
    expect(names.every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name))).toBe(true);
    expect(
      new Map(
        second.map((definition) => [
          definition.function.description,
          definition.function.name,
        ]),
      ),
    ).toEqual(
      new Map(
        first.map((definition) => [
          definition.function.description,
          definition.function.name,
        ]),
      ),
    );
    expect(first.map((definition) => definition.function.description)).toEqual([
      'MCP server "primary". Actual tool "search".',
      'MCP server "secondary". Actual tool "search".',
    ]);
  });

  it('멘션은 기본 제안으로 멘션 서버를 앞세우고 연결된 서버를 모두 유지한다', () => {
    expect(scopeMcpServerNames(['docs', 'search', 'plans'], ['search'], false)).toEqual([
      'search',
      'docs',
      'plans',
    ]);
  });

  it('멘션 전용 모드에서만 카탈로그를 멘션 서버로 제한한다', () => {
    expect(scopeMcpServerNames(['docs', 'search'], ['search'], true)).toEqual(['search']);
    expect(scopeMcpServerNames(['docs', 'search'], [], true)).toEqual(['docs', 'search']);
  });

  it('멘션 전용 모드에서만 강제 서버 목록을 정책과 카탈로그에 전달한다', () => {
    const source = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');

    expect(source).toContain('scopeMcpServerNames(');
    expect(source).toContain('this.plugin.settings.chat.mcpMentionOnly ?');
    expect(source).toContain('explicitToolServerCount: mentionOnlyServers.length');
    expect(source).toContain('explicitToolServerNames: mentionOnlyServers');
    expect(
      source.match(
        /this\.collectToolDefinitions\(\s*mentionedServers,\s*mentionOnlyServers,\s*run,?\s*\)/g,
      ),
    ).toHaveLength(2);
    expect(source).toContain('toolCall.id === toolCallId');
    expect(source).not.toContain('toolCall.name === toolCallId');
  });
});
