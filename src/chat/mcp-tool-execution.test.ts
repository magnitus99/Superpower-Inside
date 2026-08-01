import { describe, expect, it, vi } from 'vitest';
import { collectExternalMcpToolDefinitions } from './mcp-tool-catalog';
import type { MCPRegistryLike } from './mcp-tool-execution';
import {
  executeMcpToolCalls,
  findServerForTool,
  parseToolArguments,
  prepareToolCallsForExecution,
} from './mcp-tool-execution';
import {
  createMcpProviderToolAlias,
  createMcpToolBindingAllowlist,
} from './mcp-tool-wire';
import type { ToolCallRecord } from './types';

describe('MCP 툴 실행 결과 반영', () => {
  it('자동승인된 MCP 결과를 ToolCallRecord에 반드시 반영한다', async () => {
    const client = createClient({
      content: [
        { type: 'text', text: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.' },
      ],
    });
    const registry = createRegistry(client);
    const toolCalls = await prepareToolCallsForExecution(
      [createToolCall({ name: 'search', arguments: '{"query":"xbox elite series 2"}' })],
      registry,
      ['serper'],
      'mentioned-auto',
    );

    expect(toolCalls[0]?.approved).toBe(true);

    const updates: ToolCallRecord[][] = [];
    const executed = await executeMcpToolCalls({
      registry,
      toolCalls,
      preferredServerNames: ['serper'],
      onUpdate: (next) => updates.push(next.map((toolCall) => ({ ...toolCall }))),
    });

    expect(client.callTool).toHaveBeenCalledWith('search', { query: 'xbox elite series 2' });
    expect(client.listTools).toHaveBeenCalledTimes(1);
    expect(executed[0]).toMatchObject({
      status: 'success',
      serverName: 'serper',
      result: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
      resultSummary: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
      normalizedResult: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
    });
    expect(updates.at(-1)?.[0]?.result).toContain('Elite Series 2');
  });

  it('채팅 실행의 취소 신호를 진행 중인 MCP 도구 요청까지 전달한다', async () => {
    const controller = new AbortController();
    const client = createClient({
      content: [{ type: 'text', text: '늦은 결과' }],
    });
    client.callTool.mockImplementation((_name, _args, signal) => {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('사용자 중지', 'AbortError')),
          { once: true },
        );
      });
    });
    const registry = createRegistry(client);

    const execution = executeMcpToolCalls({
      registry,
      toolCalls: [createToolCall({ name: 'search', arguments: '{"query":"slow"}' })],
      preferredServerNames: ['serper'],
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(client.callTool).toHaveBeenCalledTimes(1));
    controller.abort();

    expect(client.callTool).toHaveBeenCalledWith('search', { query: 'slow' }, controller.signal);
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('수동승인 대기 상태에서는 실행하지 않고 승인 후 결과를 반영한다', async () => {
    const client = createClient({
      content: [{ type: 'text', text: 'Context7 문서 결과: Supabase RLS 정책을 확인하세요.' }],
    });
    const registry = createRegistry(client, 'context7');
    const pending = await prepareToolCallsForExecution(
      [createToolCall({ name: 'lookup_docs', arguments: '{"topic":"supabase rls"}' })],
      registry,
      ['context7'],
      'always-manual',
    );

    expect(pending[0]?.approved).toBe(false);

    const skipped = await executeMcpToolCalls({
      registry,
      toolCalls: pending,
      preferredServerNames: ['context7'],
    });

    expect(client.callTool).not.toHaveBeenCalled();
    expect(skipped[0]).toMatchObject({ status: 'running', approved: false });

    const approved = pending.map((toolCall) => ({ ...toolCall, approved: true }));
    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: approved,
      preferredServerNames: ['context7'],
    });

    expect(client.callTool).toHaveBeenCalledWith('lookup_docs', { topic: 'supabase rls' });
    expect(executed[0]).toMatchObject({
      status: 'success',
      result: 'Context7 문서 결과: Supabase RLS 정책을 확인하세요.',
    });
    expect(client.listTools).toHaveBeenCalledTimes(1);
  });

  it('mentioned-auto는 멘션된 서버의 일반 툴을 사용자 의도로 보고 자동 승인한다', async () => {
    const registry = createRegistry(
      createClient({ content: [{ type: 'text', text: '파일 내용' }] }, ['read_file']),
      'filesystem',
    );

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: 'read_file', arguments: '{"path":"Notes/test.md"}' })],
      registry,
      ['filesystem'],
      'mentioned-auto',
    );

    expect(prepared[0]).toMatchObject({
      approved: true,
      serverName: 'filesystem',
    });
  });

  it('mentioned-auto는 destructive 이름의 툴을 멘션된 서버에서도 승인 대기로 둔다', async () => {
    const registry = createRegistry(
      createClient({ content: [{ type: 'text', text: '삭제됨' }] }, ['delete_file']),
      'filesystem',
    );

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: 'delete_file', arguments: '{"path":"Notes/test.md"}' })],
      registry,
      ['filesystem'],
      'mentioned-auto',
    );

    expect(prepared[0]).toMatchObject({
      approved: false,
      serverName: 'filesystem',
    });
  });

  it('mentioned-auto는 멘션되지 않은 서버의 툴을 자동 승인하지 않는다', async () => {
    const registry = createRegistry(
      createClient({ content: [{ type: 'text', text: '검색 결과' }] }),
      'serper',
    );

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: 'search', arguments: '{"query":"obsidian"}' })],
      registry,
      [],
      'mentioned-auto',
    );

    expect(prepared[0]).toMatchObject({
      approved: false,
      serverName: 'serper',
    });
  });

  it('always-auto는 멘션 여부와 무관하게 non-destructive 툴을 승인한다', async () => {
    const registry = createRegistry(
      createClient({ content: [{ type: 'text', text: '검색 결과' }] }),
    );

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: 'search', arguments: '{"query":"obsidian"}' })],
      registry,
      [],
      'always-auto',
    );

    expect(prepared[0]).toMatchObject({
      approved: true,
      serverName: 'serper',
    });
  });

  it('MCP가 빈 결과를 반환하면 성공으로 위장하지 않고 오류로 반영한다', async () => {
    const registry = createRegistry(createClient({ content: [] }));

    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: [createToolCall({ name: 'search', arguments: '{}' })],
      preferredServerNames: ['serper'],
    });

    expect(executed[0]?.status).toBe('error');
    expect(executed[0]?.result).toContain('빈 결과');
  });

  it('이미 완료된 MCP 호출은 승인 흐름에서 다시 실행하지 않는다', async () => {
    const client = createClient({ content: [{ type: 'text', text: '새 결과' }] });
    const registry = createRegistry(client);

    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: [
        createToolCall({
          name: 'search',
          status: 'success',
          approved: true,
          result: '기존 결과',
        }),
      ],
      preferredServerNames: ['serper'],
    });

    expect(client.callTool).not.toHaveBeenCalled();
    expect(executed[0]).toMatchObject({ status: 'success', result: '기존 결과' });
  });

  it('JSON이 아닌 인자는 input 필드로 보존한다', () => {
    expect(parseToolArguments('대추방울토마토 영양성분')).toEqual({
      input: '대추방울토마토 영양성분',
    });
  });

  it('서버 후보 순서와 tool name matching은 Rust plan을 따른다', async () => {
    const serperClient = createClient({ content: [{ type: 'text', text: '검색 결과' }] });
    const filesystemClient = createClient({ content: [{ type: 'text', text: '파일 내용' }] }, [
      'read_file',
    ]);
    const clients = new Map([
      ['serper', serperClient],
      ['filesystem', filesystemClient],
    ]);
    const registry: MCPRegistryLike = {
      getConnectionStatus: (name) =>
        name === 'serper' || name === 'filesystem' ? 'connected' : 'disconnected',
      getEnabledServers: () => [{ name: 'filesystem' }, { name: 'serper' }, { name: 'context7' }],
      getClient: (name) => clients.get(name),
    };

    await expect(
      findServerForTool(registry, 'read_file', ['context7', 'serper', 'serper']),
    ).resolves.toBe('filesystem');
    expect(serperClient.listTools).toHaveBeenCalledTimes(1);
    expect(filesystemClient.listTools).toHaveBeenCalledTimes(1);
  });

  it('prepare가 확정한 같은 이름의 서버가 사라져도 다른 서버로 조용히 전환하지 않는다', async () => {
    const primaryClient = createClient({ content: [{ type: 'text', text: '주 서버 결과' }] });
    const secondaryClient = createClient({ content: [{ type: 'text', text: '보조 서버 결과' }] });
    let primaryAvailable = true;
    const registry: MCPRegistryLike = {
      getConnectionStatus: (name) =>
        name === 'primary' || name === 'secondary' ? 'connected' : 'disconnected',
      getEnabledServers: () => [{ name: 'primary' }, { name: 'secondary' }],
      getClient: (name) => {
        if (name === 'primary') return primaryAvailable ? primaryClient : undefined;
        return name === 'secondary' ? secondaryClient : undefined;
      },
    };
    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: 'search', arguments: '{"query":"same name"}' })],
      registry,
      ['primary'],
      'always-auto',
    );
    primaryAvailable = false;

    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: prepared,
      preferredServerNames: ['primary', 'secondary'],
    });

    expect(prepared[0]?.serverName).toBe('primary');
    expect(executed[0]).toMatchObject({
      status: 'error',
      serverName: 'primary',
    });
    expect(primaryClient.listTools).toHaveBeenCalledTimes(1);
    expect(secondaryClient.listTools).not.toHaveBeenCalled();
    expect(secondaryClient.callTool).not.toHaveBeenCalled();
  });

  it('같은 실제 이름의 catalog alias를 정확한 명시 서버와 실제 도구로 실행한다', async () => {
    const primaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'primary result' }] },
      ['search'],
    );
    const secondaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'secondary result' }] },
      ['search'],
    );
    const clients = new Map([
      ['primary', primaryClient],
      ['secondary', secondaryClient],
    ]);
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['primary', 'secondary'],
      explicitlyMentionedServerNames: ['primary', 'secondary'],
      reservedToolNames: new Set(),
      getClient: (serverName) => clients.get(serverName),
      isActive: () => true,
    });
    const secondaryDefinition = definitions.find((definition) =>
      definition.function.description.startsWith('MCP server "secondary".'),
    );
    expect(secondaryDefinition).toBeDefined();
    const providerName = secondaryDefinition?.function.name ?? '';
    const registry = createMultiServerRegistry(clients);

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName, arguments: '{"query":"same name"}' })],
      registry,
      ['primary', 'secondary'],
      'mentioned-auto',
      createMcpToolBindingAllowlist(definitions),
    );

    expect(prepared[0]).toMatchObject({
      name: providerName,
      actualToolName: 'search',
      serverName: 'secondary',
      mcpBindingSource: 'catalog',
      approved: true,
    });

    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: prepared,
      preferredServerNames: ['primary', 'secondary'],
    });

    expect(primaryClient.callTool).not.toHaveBeenCalled();
    expect(secondaryClient.callTool).toHaveBeenCalledWith('search', { query: 'same name' });
    expect(executed[0]).toMatchObject({
      name: providerName,
      actualToolName: 'search',
      serverName: 'secondary',
      status: 'success',
    });
  });

  it('destructive 실제 이름이 alias에 가려져도 mentioned-auto는 수동 승인을 유지한다', async () => {
    const primaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'deleted' }] },
      ['delete_file'],
    );
    const secondaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'deleted' }] },
      ['delete_file'],
    );
    const clients = new Map([
      ['primary', primaryClient],
      ['secondary', secondaryClient],
    ]);
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['primary', 'secondary'],
      explicitlyMentionedServerNames: ['primary', 'secondary'],
      reservedToolNames: new Set(),
      getClient: (serverName) => clients.get(serverName),
      isActive: () => true,
    });
    const providerName = definitions[1]?.function.name ?? '';

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName, arguments: '{"path":"Notes/test.md"}' })],
      createMultiServerRegistry(clients),
      ['primary', 'secondary'],
      'mentioned-auto',
      createMcpToolBindingAllowlist(definitions),
    );

    expect(prepared[0]).toMatchObject({
      name: providerName,
      actualToolName: 'delete_file',
      serverName: 'secondary',
      mcpBindingSource: 'catalog',
      approved: false,
    });
  });

  it('재시작 후 actual binding이 없는 승인 대기도 고정 서버의 alias로만 복원한다', async () => {
    const primaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'primary result' }] },
      ['search'],
    );
    const secondaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'secondary result' }] },
      ['search'],
    );
    const clients = new Map([
      ['primary', primaryClient],
      ['secondary', secondaryClient],
    ]);
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['primary', 'secondary'],
      explicitlyMentionedServerNames: ['primary', 'secondary'],
      reservedToolNames: new Set(),
      getClient: (serverName) => clients.get(serverName),
      isActive: () => true,
    });
    const providerName = definitions[1]?.function.name ?? '';
    primaryClient.listTools.mockClear();
    secondaryClient.listTools.mockClear();

    const executed = await executeMcpToolCalls({
      registry: createMultiServerRegistry(clients),
      toolCalls: [
        createToolCall({
          name: providerName,
          serverName: 'secondary',
          approved: true,
          arguments: '{"query":"resume"}',
        }),
      ],
      preferredServerNames: ['primary', 'secondary'],
    });

    expect(primaryClient.listTools).not.toHaveBeenCalled();
    expect(primaryClient.callTool).not.toHaveBeenCalled();
    expect(secondaryClient.callTool).toHaveBeenCalledWith('search', { query: 'resume' });
    expect(executed[0]).toMatchObject({
      name: providerName,
      actualToolName: 'search',
      serverName: 'secondary',
      status: 'success',
    });
  });

  it('다른 서버의 자연 도구 이름이 잠재 alias와 같아도 catalog binding을 역추정하지 않는다', async () => {
    const aliasLikeNaturalName = createMcpProviderToolAlias('alpha', 'safe_read');
    const alphaClient = createNamedClient(
      { content: [{ type: 'text', text: 'alpha result' }] },
      ['safe_read'],
    );
    const betaClient = createNamedClient(
      { content: [{ type: 'text', text: 'beta result' }] },
      [aliasLikeNaturalName],
    );
    const clients = new Map([
      ['alpha', alphaClient],
      ['beta', betaClient],
    ]);
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['alpha', 'beta'],
      explicitlyMentionedServerNames: ['alpha', 'beta'],
      reservedToolNames: new Set(),
      getClient: (serverName) => clients.get(serverName),
      isActive: () => true,
    });

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: aliasLikeNaturalName })],
      createMultiServerRegistry(clients),
      ['alpha', 'beta'],
      'mentioned-auto',
      createMcpToolBindingAllowlist(definitions),
    );

    expect(prepared[0]).toMatchObject({
      name: aliasLikeNaturalName,
      actualToolName: aliasLikeNaturalName,
      serverName: 'beta',
      mcpBindingSource: 'catalog',
    });
  });

  it('native 예약 이름과 충돌한 MCP alias를 실제 외부 도구 이름으로 실행한다', async () => {
    const client = createNamedClient(
      { content: [{ type: 'text', text: 'external native-name result' }] },
      ['superpower_inside_search'],
    );
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['external'],
      explicitlyMentionedServerNames: ['external'],
      reservedToolNames: new Set(['superpower_inside_search']),
      getClient: () => client,
      isActive: () => true,
    });
    const providerName = definitions[0]?.function.name ?? '';
    expect(providerName).not.toBe('superpower_inside_search');

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName, arguments: '{"query":"external"}' })],
      createRegistry(client, 'external'),
      ['external'],
      'mentioned-auto',
      createMcpToolBindingAllowlist(definitions),
    );
    const executed = await executeMcpToolCalls({
      registry: createRegistry(client, 'external'),
      toolCalls: prepared,
      preferredServerNames: ['external'],
    });

    expect(client.callTool).toHaveBeenCalledWith('superpower_inside_search', {
      query: 'external',
    });
    expect(executed[0]).toMatchObject({
      name: providerName,
      actualToolName: 'superpower_inside_search',
      serverName: 'external',
      mcpBindingSource: 'catalog',
      status: 'success',
    });
  });

  it('catalog가 고정한 alias 서버가 끊기면 같은 실제 이름의 다른 서버로 전환하지 않는다', async () => {
    const primaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'primary result' }] },
      ['search'],
    );
    const secondaryClient = createNamedClient(
      { content: [{ type: 'text', text: 'secondary result' }] },
      ['search'],
    );
    const clients = new Map([
      ['primary', primaryClient],
      ['secondary', secondaryClient],
    ]);
    const definitions = await collectExternalMcpToolDefinitions({
      serverNames: ['primary', 'secondary'],
      explicitlyMentionedServerNames: ['primary', 'secondary'],
      reservedToolNames: new Set(),
      getClient: (serverName) => clients.get(serverName),
      isActive: () => true,
    });
    const providerName = definitions[1]?.function.name ?? '';
    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName })],
      createMultiServerRegistry(clients),
      ['primary', 'secondary'],
      'always-auto',
      createMcpToolBindingAllowlist(definitions),
    );
    clients.delete('secondary');

    const executed = await executeMcpToolCalls({
      registry: createMultiServerRegistry(clients),
      toolCalls: prepared,
      preferredServerNames: ['primary', 'secondary'],
    });

    expect(executed[0]).toMatchObject({
      name: providerName,
      serverName: 'secondary',
      actualToolName: 'search',
      status: 'error',
    });
    expect(primaryClient.callTool).not.toHaveBeenCalled();
    expect(secondaryClient.callTool).not.toHaveBeenCalled();
  });

  it('modern catalog allowlist miss는 사용자가 승인해도 실행 단계에서 재탐색하지 않는다', async () => {
    const client = createNamedClient(
      { content: [{ type: 'text', text: 'should not run' }] },
      ['delete_file'],
    );
    const registry = createRegistry(client, 'filesystem');
    const providerName = createMcpProviderToolAlias('filesystem', 'delete_file');
    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName })],
      registry,
      ['filesystem'],
      'always-auto',
      new Map(),
    );

    expect(prepared[0]).toMatchObject({
      approved: false,
      mcpBindingSource: 'catalog',
      actualToolName: undefined,
      serverName: undefined,
    });

    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: prepared.map((toolCall) => ({ ...toolCall, approved: true })),
      preferredServerNames: ['filesystem'],
    });

    expect(client.listTools).not.toHaveBeenCalled();
    expect(client.callTool).not.toHaveBeenCalled();
    expect(executed[0]?.status).toBe('error');
  });

  it('legacy alias discovery가 실패하면 always-auto에서도 destructive 재시도를 실행하지 않는다', async () => {
    const client = createNamedClient(
      { content: [{ type: 'text', text: 'deleted' }] },
      ['delete_file'],
    );
    client.listTools
      .mockRejectedValueOnce(new Error('temporary discovery failure'))
      .mockResolvedValueOnce([
        {
          name: 'delete_file',
          description: 'delete file',
          inputSchema: { type: 'object' as const },
        },
      ]);
    const registry = createRegistry(client, 'filesystem');
    const providerName = createMcpProviderToolAlias('filesystem', 'delete_file');

    const prepared = await prepareToolCallsForExecution(
      [createToolCall({ name: providerName, serverName: 'filesystem' })],
      registry,
      ['filesystem'],
      'always-auto',
    );
    const executed = await executeMcpToolCalls({
      registry,
      toolCalls: prepared,
      preferredServerNames: ['filesystem'],
    });

    expect(prepared[0]?.approved).toBe(false);
    expect(client.listTools).toHaveBeenCalledTimes(1);
    expect(client.callTool).not.toHaveBeenCalled();
    expect(executed[0]?.status).toBe('running');
  });
});

function createToolCall(patch: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: patch.id ?? `tc-${patch.name ?? 'tool'}`,
    name: patch.name ?? 'search',
    arguments: patch.arguments ?? '{}',
    status: patch.status ?? 'running',
    serverName: patch.serverName,
    actualToolName: patch.actualToolName,
    mcpBindingSource: patch.mcpBindingSource,
    approved: patch.approved,
    result: patch.result,
  };
}

function createClient(result: unknown, extraToolNames: string[] = []) {
  return {
    listTools: vi.fn(() =>
      Promise.resolve([
        {
          name: 'search',
          description: '검색',
          inputSchema: { type: 'object' as const },
        },
        {
          name: 'lookup_docs',
          description: '문서 검색',
          inputSchema: { type: 'object' as const },
        },
        ...extraToolNames.map((name) => ({
          name,
          description: '추가 테스트 툴',
          inputSchema: { type: 'object' as const },
        })),
      ]),
    ),
    callTool: vi.fn<
      (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
    >(() => Promise.resolve(result)),
  };
}

function createRegistry(
  client: ReturnType<typeof createClient>,
  serverName = 'serper',
): MCPRegistryLike {
  return {
    getConnectionStatus: (name) => (name === serverName ? 'connected' : 'disconnected'),
    getEnabledServers: () => [{ name: serverName }],
    getClient: (name) => (name === serverName ? client : undefined),
  };
}

function createNamedClient(result: unknown, toolNames: readonly string[]) {
  return {
    listTools: vi.fn(() =>
      Promise.resolve(
        toolNames.map((name) => ({
          name,
          description: `${name} test tool`,
          inputSchema: { type: 'object' as const },
        })),
      ),
    ),
    callTool: vi.fn<
      (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
    >(() => Promise.resolve(result)),
  };
}

function createMultiServerRegistry(
  clients: ReadonlyMap<string, ReturnType<typeof createNamedClient>>,
): MCPRegistryLike {
  return {
    getConnectionStatus: (name) => (clients.has(name) ? 'connected' : 'disconnected'),
    getEnabledServers: () => [...clients.keys()].map((name) => ({ name })),
    getClient: (name) => clients.get(name),
  };
}
