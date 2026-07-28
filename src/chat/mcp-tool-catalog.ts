import type { MCPListedTool } from '../mcp/client';
import type { ToolDefinition } from '../llm/providers';

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
  const registeredNames = new Set(options.reservedToolNames);
  const definitions: ToolDefinition[] = [];

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

    for (const tool of tools) {
      if (registeredNames.has(tool.name)) continue;
      registeredNames.add(tool.name);
      definitions.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description ?? '',
          parameters: tool.inputSchema ?? {
            type: 'object',
            properties: {},
          },
        },
      });
    }
  }

  return definitions;
}
