import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeMcpToolCalls } from '../chat/mcp-tool-execution';
import type { ToolCallRecord } from '../chat/types';
import { MCPClientManager } from './client';
import { MCPRegistry } from './registry';

describe('MCPClientManager 실제 stdio MCP 연동', () => {
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
