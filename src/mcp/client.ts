import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface StdioServerConfig {
  name: string;
  transport: 'stdio';
  command: string;
  args?: string[];
  enabled: boolean;
}

export interface MCPServerConfigLike {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  token?: string;
}

export class MCPClientManager {
  private client: Client | null;
  private transport: StdioClientTransport | null;

  constructor() {
    this.client = null;
    this.transport = null;
  }

  async testConnection(config: MCPServerConfigLike): Promise<{ success: boolean; error?: string }> {
    if (config.transport === 'stdio') {
      if (!config.command) {
        return { success: false, error: 'Command is required for stdio transport' };
      }
      const tempClient = new MCPClientManager();
      try {
        await tempClient.connectStdio({
          name: config.name,
          enabled: true,
          command: config.command,
          args: config.args,
          transport: 'stdio',
        });
        await tempClient.disconnect();
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    } else {
      if (!config.url) {
        return { success: false, error: 'URL is required for SSE/HTTP transport' };
      }
      try {
        const response = await fetch(config.url, {
          method: 'GET',
          headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
        });
        if (response.ok) {
          return { success: true };
        } else {
          return { success: false, error: `HTTP ${response.status}` };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }
  }

  async connectStdio(config: StdioServerConfig): Promise<void> {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
    });
    this.client = new Client({ name: 'super-obsidian', version: '0.1.0' });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.transport = null;
  }
}
