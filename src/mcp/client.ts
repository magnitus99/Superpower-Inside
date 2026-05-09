import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class MCPClientManager {
  private client: Client | null;
  private transport: StdioClientTransport | null;

  constructor() {
    this.client = null;
    this.transport = null;
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
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });
    this.client = new Client({ name: 'super-obsidian', version: '0.1.0' });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
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
