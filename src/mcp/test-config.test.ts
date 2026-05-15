import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLiveMcpTestConfig } from './test-config';

describe('loadLiveMcpTestConfig', () => {
  it('data.json을 .env.test.local보다 우선 사용한다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'super-obsidian-mcp-config-'));
    try {
      writeFileSync(
        path.join(dir, 'data.json'),
        JSON.stringify({
          chat: { defaultModel: 'openRouter:openrouter/free' },
          mcpPath: '/data/path',
          mcpServers: [{ name: 'serper', command: 'uvx', args: ['serper-mcp-server'] }],
          openRouter: { apiKey: 'secret', enabled: true, models: ['openrouter/free'] },
        }),
      );
      writeFileSync(
        path.join(dir, '.env.test.local'),
        'MCP_TEST_DEFAULT_MODEL=openai:gpt-4o-mini\nMCP_TEST_SERVERS_JSON=[]\n',
      );

      const config = loadLiveMcpTestConfig(dir);

      expect(config?.source).toBe('data.json');
      expect(config?.defaultModel).toBe('openRouter:openrouter/free');
      expect(config?.mcpServers[0]?.name).toBe('serper');
      expect(config?.providers.openRouter?.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('data.json이 없으면 .env.test.local의 MCP_TEST_SERVERS_JSON을 사용한다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'super-obsidian-mcp-config-'));
    try {
      writeFileSync(
        path.join(dir, '.env.test.local'),
        [
          'MCP_TEST_DEFAULT_MODEL=openai:gpt-4o-mini',
          'MCP_TEST_MCP_PATH=/env/path',
          'MCP_TEST_SERVERS_JSON=[{"name":"fixture","command":"node","args":["server.mjs"]}]',
        ].join('\n'),
      );

      const config = loadLiveMcpTestConfig(dir);

      expect(config?.source).toBe('.env.test.local');
      expect(config?.defaultModel).toBe('openai:gpt-4o-mini');
      expect(config?.mcpPath).toBe('/env/path');
      expect(config?.mcpServers[0]).toMatchObject({ name: 'fixture', command: 'node' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
