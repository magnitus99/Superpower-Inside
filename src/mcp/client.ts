import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPClientManagerOptions {
  connectTimeoutMs?: number;
  toolsListTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_TOOLS_LIST_TIMEOUT_MS = 15000;
const MAX_TOOL_LIST_PAGES = 64;
const MAX_LISTED_TOOLS = 4096;

export type MCPListedTool = Pick<Tool, 'name' | 'description' | 'inputSchema'>;

export class MCPClientManager {
  private client: Client | null;
  private transport: StdioClientTransport | null;
  private readonly connectTimeoutMs: number;
  private readonly toolsListTimeoutMs: number;
  private toolsCache: readonly MCPListedTool[] | null = null;
  private toolsRequest: Promise<readonly MCPListedTool[]> | null = null;
  private toolsCacheGeneration = 0;
  private connectionGeneration = 0;

  constructor(options: MCPClientManagerOptions = {}) {
    this.client = null;
    this.transport = null;
    this.connectTimeoutMs = normalizeTimeoutMs(options.connectTimeoutMs);
    this.toolsListTimeoutMs = normalizeTimeoutMs(
      options.toolsListTimeoutMs,
      DEFAULT_TOOLS_LIST_TIMEOUT_MS,
    );
  }

  isConnected(): boolean {
    return this.client !== null && this.transport !== null;
  }

  async testConnection(config: MCPServerConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.command) {
      return { success: false, error: 'Command is required' };
    }
    const tempClient = new MCPClientManager();
    try {
      await tempClient.connectStdio(config);
      await tempClient.disconnect();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  async connectStdio(config: MCPServerConfig): Promise<void> {
    const connectionGeneration = this.connectionGeneration + 1;
    this.connectionGeneration = connectionGeneration;
    this.invalidateToolsCache();
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });
    const client = new Client(
      { name: 'superpower-inside', version: '1.0.0' },
      {
        listChanged: {
          tools: {
            autoRefresh: false,
            debounceMs: 0,
            onChanged: () => {
              if (this.connectionGeneration === connectionGeneration) {
                this.invalidateToolsCache();
              }
            },
          },
        },
      },
    );
    this.transport = transport;
    this.client = client;
    try {
      await withTimeout(
        client.connect(transport),
        this.connectTimeoutMs,
        `MCP stdio connection timed out after ${this.connectTimeoutMs}ms`,
      );
    } catch (err) {
      try {
        await this.disconnect();
      } catch {
        // 연결 실패 후 정리 실패가 원래 연결 오류를 덮지 않게 한다.
      }
      throw err;
    }
  }

  async listTools(signal?: AbortSignal): Promise<MCPListedTool[]> {
    const cached = this.toolsCache;
    if (cached) return copyListedTools(cached);
    const pending = this.toolsRequest ?? this.startToolsRequest();
    return copyListedTools(await withAbortSignal(pending, signal));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.client) throw new Error('MCP client not connected');
    const params = { name, arguments: args };
    const result = signal
      ? await this.client.callTool(params, undefined, { signal })
      : await this.client.callTool(params);
    return result;
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.connectionGeneration++;
    this.invalidateToolsCache();
    this.client = null;
    this.transport = null;
    if (client) {
      await client.close();
      return;
    }
    if (transport) {
      await transport.close();
    }
  }

  private startToolsRequest(): Promise<readonly MCPListedTool[]> {
    const client = this.client;
    if (!client) throw new Error('MCP client not connected');
    const cacheGeneration = this.toolsCacheGeneration;
    const request = this.fetchAllTools(client).then((tools) => {
      if (this.client === client && this.toolsCacheGeneration === cacheGeneration) {
        this.toolsCache = tools;
      }
      return tools;
    });
    this.toolsRequest = request;
    const clearRequest = (): void => {
      if (this.toolsRequest === request) this.toolsRequest = null;
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  private async fetchAllTools(client: Client): Promise<readonly MCPListedTool[]> {
    const tools: MCPListedTool[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
      const operation = cursor ? client.listTools({ cursor }) : client.listTools();
      const result = await withTimeout(
        operation,
        this.toolsListTimeoutMs,
        `MCP tools/list timed out after ${this.toolsListTimeoutMs}ms`,
      );
      for (const tool of result.tools) {
        if (tools.length >= MAX_LISTED_TOOLS) {
          throw new Error(`MCP tools/list exceeded ${MAX_LISTED_TOOLS} tools`);
        }
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }

      const nextCursor = result.nextCursor;
      if (!nextCursor) return tools;
      if (seenCursors.has(nextCursor)) {
        throw new Error('MCP tools/list returned a repeated nextCursor');
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw new Error(`MCP tools/list exceeded ${MAX_TOOL_LIST_PAGES} pages`);
  }

  private invalidateToolsCache(): void {
    this.toolsCacheGeneration++;
    this.toolsCache = null;
    this.toolsRequest = null;
  }
}

function normalizeTimeoutMs(
  value: number | undefined,
  defaultValue = DEFAULT_CONNECT_TIMEOUT_MS,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(1, Math.floor(value));
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  });
}

function withAbortSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    return Promise.reject(new DOMException('MCP tools/list cancelled', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new DOMException('MCP tools/list cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function copyListedTools(tools: readonly MCPListedTool[]): MCPListedTool[] {
  return tools.map((tool) => ({ ...tool }));
}
