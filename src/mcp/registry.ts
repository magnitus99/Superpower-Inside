import type { MCPServerConfig } from '../settings';
import type { MCPClientManager } from './client';
import type { MCPServerConnectionStatus } from './connection-state';

export class MCPRegistry {
  private servers: MCPServerConfig[];
  private clients: Map<string, MCPClientManager>;
  private connectionStatus: Map<string, MCPServerConnectionStatus> = new Map();
  private lastErrors: Map<string, string> = new Map();

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
    this.connectionStatus.delete(name);
    this.lastErrors.delete(name);
  }

  getEnabledServers(): MCPServerConfig[] {
    return [...this.servers];
  }

  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.find((s) => s.name === name);
  }

  allServers(): MCPServerConfig[] {
    return [...this.servers];
  }

  setConnectionStatus(name: string, status: MCPServerConnectionStatus, error?: string): void {
    this.connectionStatus.set(name, status);
    if (error) {
      this.lastErrors.set(name, error);
    } else if (status !== 'error') {
      this.lastErrors.delete(name);
    }
  }

  getConnectionStatus(name: string): MCPServerConnectionStatus {
    return this.connectionStatus.get(name) ?? 'disconnected';
  }

  getLastError(name: string): string | undefined {
    return this.lastErrors.get(name);
  }

  getFailedServerNames(): string[] {
    return this.servers
      .filter((server) => this.getConnectionStatus(server.name) === 'error')
      .map((server) => server.name);
  }

  getErrorCount(): number {
    return this.getFailedServerNames().length;
  }

  isConnecting(): boolean {
    for (const status of this.connectionStatus.values()) {
      if (status === 'connecting') return true;
    }
    return false;
  }

  getConnectedCount(): number {
    let count = 0;
    for (const status of this.connectionStatus.values()) {
      if (status === 'connected') count++;
    }
    return count;
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
    this.connectionStatus.clear();
    this.lastErrors.clear();
  }
}
