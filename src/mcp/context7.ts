import type { MCPServerConfig } from '../settings';

export const CONTEXT7_MCP_SERVER_NAME = 'context7';

export function createDefaultContext7McpServer(): MCPServerConfig {
  return {
    name: CONTEXT7_MCP_SERVER_NAME,
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  };
}

export function isContext7McpServer(
  server: Pick<MCPServerConfig, 'name' | 'command'> & Partial<Pick<MCPServerConfig, 'args'>>,
): boolean {
  if (server.name.trim().toLowerCase() === CONTEXT7_MCP_SERVER_NAME) return true;

  const command = server.command.trim().toLowerCase();
  if (command === 'ctx7' || command.includes('context7')) return true;

  return (server.args ?? []).some((arg) => {
    const normalized = arg.trim().toLowerCase();
    return normalized === 'ctx7' || normalized.includes('context7');
  });
}

export function getContext7McpServerName(
  servers: readonly (Pick<MCPServerConfig, 'name' | 'command'> &
    Partial<Pick<MCPServerConfig, 'args'>>)[],
): string | null {
  return servers.find(isContext7McpServer)?.name ?? null;
}

export function hasContext7McpServer(
  servers: readonly (Pick<MCPServerConfig, 'name' | 'command'> &
    Partial<Pick<MCPServerConfig, 'args'>>)[],
): boolean {
  return getContext7McpServerName(servers) !== null;
}

export function shouldShowPluginAwareContext7Warning(input: {
  pluginAwareEnabled: boolean;
  servers: readonly (Pick<MCPServerConfig, 'name' | 'command'> &
    Partial<Pick<MCPServerConfig, 'args'>>)[];
}): boolean {
  return input.pluginAwareEnabled && !hasContext7McpServer(input.servers);
}
