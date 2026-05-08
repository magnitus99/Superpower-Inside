import type { MCPServerConfig } from '../settings';
import type { MCPClientManager } from './client';

export class MCPRegistry {
  private servers: MCPServerConfig[];
  private clients: Map<string, MCPClientManager>;

  constructor(initialServers: MCPServerConfig[] = []) {
    this.servers = [...initialServers];
    this.clients = new Map();
  }

  addServer(config: MCPServerConfig): void {
    const idx = this.servers.findIndex((s) => s.name === config.name);
    if (idx !== -1) {
      this.servers[idx] = config;
    } else {
      this.servers.push(config);
    }
  }

  removeServer(name: string): void {
    this.servers = this.servers.filter((s) => s.name !== name);
    const client = this.clients.get(name);
    if (client) {
      void client.disconnect();
      this.clients.delete(name);
    }
  }

  getEnabledServers(): MCPServerConfig[] {
    return this.servers.filter((s) => s.enabled);
  }

  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.find((s) => s.name === name);
  }

  allServers(): MCPServerConfig[] {
    return [...this.servers];
  }

  setClient(name: string, client: MCPClientManager): void {
    this.clients.set(name, client);
  }

  getClient(name: string): MCPClientManager | undefined {
    return this.clients.get(name);
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients.entries()) {
      await client.disconnect();
      this.clients.delete(name);
    }
  }
}
