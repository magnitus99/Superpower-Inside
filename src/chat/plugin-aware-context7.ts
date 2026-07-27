import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import { getContext7McpServerName } from '../mcp/context7';
import type { MCPServerConfig } from '../settings';
import { shouldOfferContext7ForPromptRust } from '../rag/rust-core';

interface PluginAwareMcpRegistryLike {
  getEnabledServers(): Pick<MCPServerConfig, 'name' | 'command' | 'args'>[];
  getConnectionStatus(name: string): MCPServerConnectionStatus;
}

export function getPluginAwareServerNames(input: {
  mentionedServerNames: string[];
  pluginAwareEnabled: boolean;
  userText: string;
  registry: PluginAwareMcpRegistryLike | null;
}): string[] {
  const names = [...input.mentionedServerNames];
  if (!input.pluginAwareEnabled || !input.registry) return names;
  if (shouldOfferContext7ForPromptRust(input.userText) !== true) return names;

  const context7ServerName = getContext7McpServerName(input.registry.getEnabledServers());
  if (!context7ServerName) return names;
  if (input.registry.getConnectionStatus(context7ServerName) !== 'connected') return names;
  if (!names.includes(context7ServerName)) names.push(context7ServerName);
  return names;
}
