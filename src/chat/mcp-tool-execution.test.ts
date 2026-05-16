import { describe, expect, it, vi } from 'vitest';
import type { MCPRegistryLike } from './mcp-tool-execution';
import {
  executeMcpToolCalls,
  parseToolArguments,
  prepareToolCallsForExecution,
} from './mcp-tool-execution';
import type { ToolCallRecord } from './types';

describe('MCP 툴 실행 결과 반영', () => {
  it('자동승인된 MCP 결과를 ToolCallRecord에 반드시 반영한다', async () => {
    const client = createClient({
      content: [{ type: 'text', text: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.' }],
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
    expect(executed[0]).toMatchObject({
      status: 'success',
      serverName: 'serper',
      result: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
      resultSummary: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
      normalizedResult: '검색 결과: Elite Series 2 대안은 Xbox Wireless Controller입니다.',
    });
    expect(updates.at(-1)?.[0]?.result).toContain('Elite Series 2');
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

  it('JSON이 아닌 인자는 input 필드로 보존한다', () => {
    expect(parseToolArguments('대추방울토마토 영양성분')).toEqual({
      input: '대추방울토마토 영양성분',
    });
  });
});

function createToolCall(patch: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: patch.id ?? `tc-${patch.name ?? 'tool'}`,
    name: patch.name ?? 'search',
    arguments: patch.arguments ?? '{}',
    status: patch.status ?? 'running',
    serverName: patch.serverName,
    approved: patch.approved,
  };
}

function createClient(result: unknown) {
  return {
    listTools: vi.fn(() =>
      Promise.resolve([
        { name: 'search', description: '검색', inputSchema: { type: 'object' } },
        { name: 'lookup_docs', description: '문서 검색', inputSchema: { type: 'object' } },
      ]),
    ),
    callTool: vi.fn(() => Promise.resolve(result)),
  };
}

function createRegistry(client: ReturnType<typeof createClient>, serverName = 'serper'): MCPRegistryLike {
  return {
    getConnectionStatus: (name) => (name === serverName ? 'connected' : 'disconnected'),
    getEnabledServers: () => [{ name: serverName }],
    getClient: (name) => (name === serverName ? client : undefined),
  };
}
