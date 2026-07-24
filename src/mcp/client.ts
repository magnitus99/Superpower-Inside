import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPClientManagerOptions {
  connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

export class MCPClientManager {
  private client: Client | null;
  private transport: StdioClientTransport | null;
  private readonly connectTimeoutMs: number;

  constructor(options: MCPClientManagerOptions = {}) {
    this.client = null;
    this.transport = null;
    this.connectTimeoutMs = normalizeTimeoutMs(options.connectTimeoutMs);
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
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });
    const client = new Client({ name: 'superpower-inside', version: '1.0.0' });
    this.transport = transport;
    this.client = client;
    try {
      await withTimeout(client.connect(transport), this.connectTimeoutMs);
    } catch (err) {
      try {
        await this.disconnect();
      } catch {
        // 연결 실패 후 정리 실패가 원래 연결 오류를 덮지 않게 한다.
      }
      throw err;
    }
  }

  async listTools(): Promise<
    { name: string; description?: string; inputSchema?: Record<string, unknown> }[]
  > {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
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
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONNECT_TIMEOUT_MS;
  return Math.max(1, Math.floor(value));
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`MCP stdio connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  });
}
