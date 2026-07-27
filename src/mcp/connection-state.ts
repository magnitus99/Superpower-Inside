import { getMcpConnectionStateRust } from '../rag/rust-core';

export const MCP_STATUS_CHANGE_EVENT = 'superpower-inside:mcp-status-change';

export type MCPServerConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type MCPConnectionState = 'idle' | 'connecting' | 'connected' | 'partial-error' | 'error';

export interface MCPConnectionSummaryInput {
  totalCount: number;
  connectedCount: number;
  failedCount: number;
  isConnecting: boolean;
}

export function getMcpConnectionState(input: MCPConnectionSummaryInput): MCPConnectionState {
  const rustState = getMcpConnectionStateRust(
    input.totalCount,
    input.connectedCount,
    input.failedCount,
    input.isConnecting,
  );
  if (rustState !== null) return rustState;

  if (input.totalCount === 0) {
    return 'idle';
  }

  if (input.isConnecting) {
    return 'connecting';
  }

  if (input.failedCount === 0) {
    return 'connected';
  }

  if (input.connectedCount > 0) {
    return 'partial-error';
  }

  return 'error';
}
