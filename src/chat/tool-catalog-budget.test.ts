import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../llm/providers';
import {
  ExplicitMcpToolDiscoveryError,
  collectExternalMcpToolDefinitions,
} from './mcp-tool-catalog';
import {
  MAX_CHAT_TOOL_CATALOG_BYTES,
  MAX_CHAT_TOOL_DEFINITIONS,
  selectBoundedToolDefinitions,
} from './tool-catalog-budget';

function tool(name: string, description = name): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: {} },
    },
  };
}

describe('채팅 provider 도구 카탈로그 예산', () => {
  it('내장 도구를 보존하고 전체 정의 수를 64개로 제한한다', () => {
    const native = Array.from({ length: 5 }, (_, index) => tool(`superpower_inside_${index}`));
    const external = Array.from({ length: 100 }, (_, index) => tool(`external_${index}`));

    const result = selectBoundedToolDefinitions(native, external);

    expect(result).toHaveLength(MAX_CHAT_TOOL_DEFINITIONS);
    expect(result.slice(0, native.length)).toEqual(native);
  });

  it('과도하게 큰 외부 schema를 건너뛰고 뒤의 작은 도구를 유지한다', () => {
    const native = [tool('superpower_inside_search')];
    const oversized = tool('oversized', 'x'.repeat(MAX_CHAT_TOOL_CATALOG_BYTES));
    const small = tool('small');

    const result = selectBoundedToolDefinitions(native, [oversized, small]);

    expect(result.map((definition) => definition.function.name)).toEqual([
      'superpower_inside_search',
      'small',
    ]);
  });

  it('중복 이름은 첫 정의만 provider에 전달한다', () => {
    const first = tool('same', 'first');
    const second = tool('same', 'second');

    expect(selectBoundedToolDefinitions([], [first, second])).toEqual([first]);
  });

  it('호출자가 더 큰 limit을 요청해도 hard slot과 최종 JSON byte 상한을 넘지 않는다', () => {
    const external = Array.from({ length: 100 }, (_, index) =>
      tool(`external_${index}`, 'x'.repeat(8_000)),
    );

    const result = selectBoundedToolDefinitions(
      [],
      external,
      MAX_CHAT_TOOL_DEFINITIONS * 2,
      MAX_CHAT_TOOL_CATALOG_BYTES * 2,
    );

    expect(result.length).toBeLessThanOrEqual(MAX_CHAT_TOOL_DEFINITIONS);
    expect(catalogBytes(result)).toBeLessThanOrEqual(MAX_CHAT_TOOL_CATALOG_BYTES);
  });

  it('유효하지 않은 limit이 hard cap 비교를 우회하지 못한다', () => {
    expect(selectBoundedToolDefinitions([], [tool('external')], Number.NaN)).toEqual([]);
    expect(
      selectBoundedToolDefinitions([], [tool('external')], MAX_CHAT_TOOL_DEFINITIONS, Number.NaN),
    ).toEqual([]);
  });

  it('첫 명시 서버가 60개 넘는 도구를 제공해도 다음 명시 서버 도구를 최소 하나 보존한다', async () => {
    const toolsByServer = new Map([
      [
        'large',
        Array.from({ length: 61 }, (_, index) => ({
          name: `large_${index}`,
          inputSchema: { type: 'object' as const, properties: {} },
        })),
      ],
      [
        'small',
        [
          {
            name: 'small_only',
            inputSchema: { type: 'object' as const, properties: {} },
          },
        ],
      ],
    ]);
    const external = await collectExternalMcpToolDefinitions({
      serverNames: ['large', 'small'],
      explicitlyMentionedServerNames: ['large', 'small'],
      reservedToolNames: new Set(),
      getClient: (serverName) => ({
        listTools: () => Promise.resolve(toolsByServer.get(serverName) ?? []),
      }),
      isActive: () => true,
    });
    const native = Array.from({ length: 5 }, (_, index) =>
      tool(`superpower_inside_${index}`),
    );

    const result = selectBoundedToolDefinitions(native, external);

    expect(result).toHaveLength(MAX_CHAT_TOOL_DEFINITIONS);
    expect(
      result.some((definition) =>
        definition.function.description.startsWith('MCP server "large".'),
      ),
    ).toBe(true);
    expect(
      result.some((definition) =>
        definition.function.description.startsWith('MCP server "small".'),
      ),
    ).toBe(true);
    expect(catalogBytes(result)).toBeLessThanOrEqual(MAX_CHAT_TOOL_CATALOG_BYTES);
  });

  it('명시 서버에서 예산 안에 담을 수 있는 도구가 하나도 없으면 서버 이름과 함께 실패한다', async () => {
    const external = await collectExternalMcpToolDefinitions({
      serverNames: ['oversized'],
      explicitlyMentionedServerNames: ['oversized'],
      reservedToolNames: new Set(),
      getClient: () => ({
        listTools: () =>
          Promise.resolve([
            {
              name: 'huge_schema',
              description: 'x'.repeat(MAX_CHAT_TOOL_CATALOG_BYTES),
              inputSchema: { type: 'object' as const, properties: {} },
            },
          ]),
      }),
      isActive: () => true,
    });

    expect(() => selectBoundedToolDefinitions([], external)).toThrow(
      expect.objectContaining<Partial<ExplicitMcpToolDiscoveryError>>({
        name: 'ExplicitMcpToolDiscoveryError',
        serverName: 'oversized',
      }),
    );
  });

  it('명시 서버 대표 정의를 우선해도 총 slot과 byte 상한을 넘지 않는다', async () => {
    const external = await collectExternalMcpToolDefinitions({
      serverNames: ['first', 'second'],
      explicitlyMentionedServerNames: ['first', 'second'],
      reservedToolNames: new Set(),
      getClient: (serverName) => ({
        listTools: () =>
          Promise.resolve([
            {
              name: `${serverName}_small`,
              description: 'small',
              inputSchema: { type: 'object' as const, properties: {} },
            },
            {
              name: `${serverName}_large`,
              description: 'x'.repeat(10_000),
              inputSchema: { type: 'object' as const, properties: {} },
            },
          ]),
      }),
      isActive: () => true,
    });

    const result = selectBoundedToolDefinitions(
      Array.from({ length: 5 }, (_, index) => tool(`native_${index}`)),
      external,
      7,
      2_000,
    );

    expect(result).toHaveLength(7);
    expect(catalogBytes(result)).toBeLessThanOrEqual(2_000);
    expect(
      result.filter((definition) =>
        definition.function.description.startsWith('MCP server "'),
      ),
    ).toHaveLength(2);
  });

  it('남은 slot이 명시 서버 수보다 적으면 일부 서버를 조용히 누락하지 않는다', async () => {
    const external = await collectExternalMcpToolDefinitions({
      serverNames: ['first', 'second'],
      explicitlyMentionedServerNames: ['first', 'second'],
      reservedToolNames: new Set(),
      getClient: (serverName) => ({
        listTools: () =>
          Promise.resolve([
            {
              name: `${serverName}_only`,
              inputSchema: { type: 'object' as const, properties: {} },
            },
          ]),
      }),
      isActive: () => true,
    });

    expect(() =>
      selectBoundedToolDefinitions(
        Array.from({ length: 5 }, (_, index) => tool(`native_${index}`)),
        external,
        6,
      ),
    ).toThrow(
      expect.objectContaining<Partial<ExplicitMcpToolDiscoveryError>>({
        name: 'ExplicitMcpToolDiscoveryError',
        serverName: 'second',
      }),
    );
  });
});

function catalogBytes(definitions: readonly ToolDefinition[]): number {
  return new TextEncoder().encode(JSON.stringify(definitions)).byteLength;
}
