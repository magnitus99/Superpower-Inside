import type { MCPListedTool } from '../mcp/client';
import type { ToolDefinition } from '../llm/providers';
import {
  bindMcpToolDefinition,
  createMcpToolDescription,
  isProviderSafeToolName,
  selectAvailableMcpProviderToolAlias,
} from './mcp-tool-wire';

interface McpToolListingClient {
  listTools(signal?: AbortSignal): Promise<MCPListedTool[]>;
}

export interface CollectExternalMcpToolDefinitionsOptions {
  serverNames: readonly string[];
  explicitlyMentionedServerNames: readonly string[];
  reservedToolNames: ReadonlySet<string>;
  signal?: AbortSignal;
  getClient: (serverName: string) => McpToolListingClient | undefined;
  isActive: () => boolean;
}

/** 사용자가 명시한 MCP 서버의 도구를 조회하지 못했음을 구분하는 오류입니다. */
export class ExplicitMcpToolDiscoveryError extends Error {
  constructor(
    readonly serverName: string,
    options?: ErrorOptions,
  ) {
    super(`MCP tool discovery failed for explicitly mentioned server "${serverName}"`, options);
    this.name = 'ExplicitMcpToolDiscoveryError';
  }
}

/**
 * 자동 서버 실패는 건너뛰되 사용자가 명시한 서버 실패는 조용히 다른 도구로 대체하지 않습니다.
 */
export async function collectExternalMcpToolDefinitions(
  options: CollectExternalMcpToolDefinitionsOptions,
): Promise<ToolDefinition[]> {
  const explicitlyMentioned = new Set(options.explicitlyMentionedServerNames);
  const discoveredServers: DiscoveredMcpServer[] = [];

  for (const serverName of options.serverNames) {
    if (!options.isActive()) return [];
    const client = options.getClient(serverName);
    if (!client) {
      if (explicitlyMentioned.has(serverName)) {
        throw new ExplicitMcpToolDiscoveryError(serverName);
      }
      continue;
    }

    let tools: MCPListedTool[];
    try {
      tools = await client.listTools(options.signal);
    } catch (cause) {
      if (!options.isActive()) return [];
      if (explicitlyMentioned.has(serverName)) {
        throw new ExplicitMcpToolDiscoveryError(serverName, { cause });
      }
      continue;
    }
    if (!options.isActive()) return [];
    const uniqueTools = uniqueCallableTools(tools);
    if (explicitlyMentioned.has(serverName) && uniqueTools.length === 0) {
      throw new ExplicitMcpToolDiscoveryError(serverName);
    }
    discoveredServers.push({
      serverName,
      explicitlyMentioned: explicitlyMentioned.has(serverName),
      tools: uniqueTools,
    });
  }

  const nameCounts = countActualToolNames(discoveredServers);
  const unavailableProviderNames = new Set(options.reservedToolNames);
  for (const server of discoveredServers) {
    for (const tool of server.tools) {
      if (
        nameCounts.get(tool.name) === 1 &&
        !options.reservedToolNames.has(tool.name) &&
        isProviderSafeToolName(tool.name)
      ) {
        unavailableProviderNames.add(tool.name);
      }
    }
  }

  const definitions: ToolDefinition[] = [];
  for (const server of discoveredServers) {
    let emittedCount = 0;
    for (const tool of server.tools) {
      const requiresAlias =
        nameCounts.get(tool.name) !== 1 ||
        options.reservedToolNames.has(tool.name) ||
        !isProviderSafeToolName(tool.name);
      const providerToolName = requiresAlias
        ? selectAvailableMcpProviderToolAlias(
            server.serverName,
            tool.name,
            unavailableProviderNames,
          )
        : tool.name;
      if (providerToolName === null) continue;
      unavailableProviderNames.add(providerToolName);
      const definition = bindMcpToolDefinition(
        {
          type: 'function',
          function: {
            name: providerToolName,
            description: createMcpToolDescription(
              server.serverName,
              tool.name,
              tool.description,
            ),
            parameters: tool.inputSchema ?? {
              type: 'object',
              properties: {},
            },
          },
        },
        {
          serverName: server.serverName,
          actualToolName: tool.name,
          providerToolName,
          explicitlyMentioned: server.explicitlyMentioned,
        },
      );
      definitions.push(definition);
      emittedCount += 1;
    }
    if (server.explicitlyMentioned && emittedCount === 0) {
      throw new ExplicitMcpToolDiscoveryError(server.serverName);
    }
  }

  return definitions;
}

interface DiscoveredMcpServer {
  serverName: string;
  explicitlyMentioned: boolean;
  tools: MCPListedTool[];
}

function uniqueCallableTools(tools: readonly MCPListedTool[]): MCPListedTool[] {
  const names = new Set<string>();
  const unique: MCPListedTool[] = [];
  for (const tool of tools) {
    if (tool.name.trim().length === 0 || names.has(tool.name)) continue;
    names.add(tool.name);
    unique.push(tool);
  }
  return unique;
}

function countActualToolNames(servers: readonly DiscoveredMcpServer[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const server of servers) {
    for (const tool of server.tools) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }
  }
  return counts;
}
