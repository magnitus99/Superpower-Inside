import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeMcpToolCalls } from '../chat/mcp-tool-execution';
import type { ToolCallRecord } from '../chat/types';
import { MCPClientManager } from './client';
import { MCPRegistry } from './registry';

describe('MCPClientManager 실제 stdio MCP 연동', () => {
  it('초기화 중 종료된 서버의 stderr 원인을 표시하고 분할 출력된 키는 숨긴다', async () => {
    const client = new MCPClientManager();
    const secret = 'fixture-private-serper-value';
    const failure = await client
      .connectStdio({
        name: 'broken-server',
        command: process.execPath,
        args: [
          '-e',
          `process.stderr.write(process.env.SERPER_API_KEY.slice(0, 10));
           setTimeout(() => {
             process.stderr.write(process.env.SERPER_API_KEY.slice(10));
             process.stderr.write("\\nAttributeError: 'Server' object has no attribute 'list_tools'\\n");
             process.exitCode = 1;
           }, 10);`,
        ],
        env: { SERPER_API_KEY: secret },
      })
      .then(
        () => '',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    expect(failure).toContain("AttributeError: 'Server' object has no attribute 'list_tools'");
    expect(failure).toContain('[REDACTED]');
    expect(failure).not.toContain(secret);
    expect(client.isConnected()).toBe(false);
    const result = await client.testConnection({
      name: 'broken-server',
      command: process.execPath,
      args: ['-e', 'process.stderr.write(process.env.SERPER_API_KEY); process.exitCode = 1;'],
      env: { SERPER_API_KEY: secret },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('[REDACTED]');
    expect(result.error).not.toContain(secret);
  });

  it('stderr 수집 한도를 넘으면 부분 키가 노출될 수 있는 출력을 버린다', async () => {
    const client = new MCPClientManager();
    await expect(
      client.connectStdio({
        name: 'noisy-server',
        command: process.execPath,
        args: [
          '-e',
          'process.stderr.write("private-partial-key"); process.stderr.write("x".repeat(100000)); process.exitCode = 1;',
        ],
        env: { SERPER_API_KEY: 'private-partial-key-and-rest' },
      }),
    ).rejects.toThrow(/^MCP error -32000: Connection closed$/);
    expect(client.isConnected()).toBe(false);
  });

  it('fixture 시나리오 기반 MCP 결과를 채팅 ToolCallRecord에 반영한다', async () => {
    const scenarioPrompts = await loadScenarioPrompts();
    const client = new MCPClientManager();
    const fixtureServerPath = path.join(process.cwd(), 'tests/fixtures/local-mcp-server.mjs');
    await client.connectStdio({
      name: 'fixture',
      command: process.execPath,
      args: [fixtureServerPath],
    });

    try {
      const registry = new MCPRegistry([{ name: 'fixture', command: process.execPath }]);
      registry.setClient('fixture', client);
      registry.setConnectionStatus('fixture', 'connected');

      const toolCalls = scenarioPrompts
        .filter((prompt) => prompt.startsWith('@serper') || prompt.startsWith('@context7'))
        .map((prompt, index): ToolCallRecord => {
          const isContext7 = prompt.startsWith('@context7');
          return {
            id: `scenario-${index}`,
            name: isContext7 ? 'lookup_docs' : 'search',
            arguments: JSON.stringify({
              [isContext7 ? 'topic' : 'query']: prompt.replace(/^@\S+\s*/, ''),
            }),
            status: 'running',
            approved: true,
          };
        });

      const executed = await executeMcpToolCalls({
        registry,
        toolCalls,
        preferredServerNames: ['fixture'],
      });

      expect(executed).toHaveLength(3);
      for (const toolCall of executed) {
        expect(toolCall.status).toBe('success');
        expect(toolCall.result).toMatch(/^fixture (search|docs) result:/);
        expect(toolCall.resultSummary).toBe(toolCall.result);
        expect(toolCall.normalizedResult).toBe(toolCall.result);
      }
    } finally {
      await client.disconnect();
    }
  }, 15000);
});

async function loadScenarioPrompts(): Promise<string[]> {
  const scenarioPath = path.join(process.cwd(), 'tests/fixtures/mcp_test_scenario.md');
  const content = await readFile(scenarioPath, 'utf8');
  return Array.from(content.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter((prompt) => prompt.length > 0);
}
