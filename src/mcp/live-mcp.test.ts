import { describe, expect, it } from 'vitest';
import { executeMcpToolCalls } from '../chat/mcp-tool-execution';
import { MCPClientManager } from './client';
import { MCPRegistry } from './registry';
import { loadLiveMcpTestConfig } from './test-config';

const runLiveMcpTests = process.env.RUN_LIVE_MCP_TESTS === '1';
const liveDescribe = runLiveMcpTests ? describe : describe.skip;

liveDescribe('live MCP 결과 채팅 반영', () => {
  it('data.json 또는 .env.test.local 설정의 실제 MCP 응답을 ToolCallRecord에 반영한다', async () => {
    const config = loadLiveMcpTestConfig();
    expect(config).not.toBeNull();
    if (!config) return;

    const defaultModel = parseDefaultModel(config.defaultModel);
    expect(defaultModel.providerKey.length).toBeGreaterThan(0);
    expect(defaultModel.model.length).toBeGreaterThan(0);

    const scenarios = [
      {
        serverName: 'serper',
        prompt:
          '패드 모델 b를 쓰고 있어. 이거보다 나은 대체 기기가 있는지 찾아줘. 콘솔에서도 되어야 해. 유선 연결은 좀 불편해.',
        toolCandidates: ['search', 'google_search', 'serper_search', 'web_search'],
        preferredArgs: {
          q: 'pad model b wireless console alternative',
          query: 'pad model b wireless console alternative',
        },
      },
      {
        serverName: 'context7',
        prompt: '문서 저장소 a의 안내를 찾아줘. 권한 규칙을 바꿀 때 무엇을 해야 하는거야?',
        toolCandidates: ['resolve-library-id', 'resolve_library_id', 'get-library-docs', 'get_library_docs'],
        preferredArgs: {
          libraryName: 'docs-lib-a',
          libraryNameOrId: 'docs-lib-a',
          topic: 'permission update',
          query: 'docs-lib-a permission update',
        },
      },
      {
        serverName: 'playwright',
        prompt: '브라우저로 사전 사이트를 열어줘.',
        toolCandidates: ['browser_navigate', 'navigate', 'open_browser'],
        preferredArgs: { url: 'https://example.com/dictionary' },
      },
    ];

    let executedScenarioCount = 0;
    for (const scenario of scenarios) {
      const server = config.mcpServers.find((item) => item.name === scenario.serverName);
      if (!server) continue;

      const client = new MCPClientManager();
      await client.connectStdio({
        ...server,
        env: {
          ...server.env,
          PATH: server.env?.PATH ?? (config.mcpPath || process.env.PATH || ''),
        },
      });

      try {
        const tools = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);
        const tool = selectTool(tools, scenario.toolCandidates);
        const registry = new MCPRegistry([server]);
        registry.setClient(server.name, client);
        registry.setConnectionStatus(server.name, 'connected');

        const executed = await executeMcpToolCalls({
          registry,
          toolCalls: [
            {
              id: `live-${scenario.serverName}`,
              name: tool.name,
              arguments: JSON.stringify(buildArgs(tool.inputSchema, scenario.preferredArgs)),
              status: 'running',
              approved: true,
            },
          ],
          preferredServerNames: [server.name],
        });

        expect(executed[0]).toMatchObject({
          status: 'success',
          serverName: server.name,
        });
        expect(executed[0]?.result?.trim().length).toBeGreaterThan(0);
        expect(executed[0]?.normalizedResult?.trim().length).toBeGreaterThan(0);
        executedScenarioCount++;
      } finally {
        await client.disconnect();
      }
    }
    expect(executedScenarioCount).toBeGreaterThan(0);
  }, 120000);
});

interface LiveToolInfo {
  name: string;
  inputSchema?: Record<string, unknown>;
}

function parseDefaultModel(defaultModel: string): { providerKey: string; model: string } {
  const parts = defaultModel.split(':');
  return {
    providerKey: parts[0] ?? '',
    model: parts.slice(1).join(':'),
  };
}

function selectTool(tools: LiveToolInfo[], candidates: string[]): LiveToolInfo {
  for (const candidate of candidates) {
    const exact = tools.find((tool) => tool.name === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = tools.find((tool) => tool.name.toLowerCase().includes(candidate.toLowerCase()));
    if (partial) return partial;
  }
  return tools[0] ?? { name: candidates[0] ?? 'unknown' };
}

function buildArgs(
  inputSchema: Record<string, unknown> | undefined,
  preferredArgs: Record<string, unknown>,
): Record<string, unknown> {
  if (!inputSchema || !isRecord(inputSchema.properties)) {
    return preferredArgs;
  }

  const args: Record<string, unknown> = {};
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item): item is string => typeof item === 'string')
    : [];
  for (const [key, rawProperty] of Object.entries(inputSchema.properties)) {
    if (key in preferredArgs) {
      args[key] = preferredArgs[key];
      continue;
    }
    if (required.includes(key)) {
      args[key] = fallbackValueForSchema(rawProperty);
    }
  }

  return Object.keys(args).length > 0 ? args : preferredArgs;
}

function fallbackValueForSchema(rawSchema: unknown): unknown {
  if (!isRecord(rawSchema)) return 'test';
  const type = rawSchema.type;
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return false;
  if (type === 'array') return ['test'];
  if (type === 'object') return {};
  return 'test';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
