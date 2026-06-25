import type { GraphRagStatusSummary } from '../graph/status';
import type { MCPConnectionState, MCPServerConnectionStatus } from '../mcp/connection-state';
import type { PerformanceGuardState } from '../rag/performance-guard';
import type { RagIndexingSchedulerStatus } from '../rag/indexing-scheduler';
import type { RagStatusSummary } from '../rag/status';
import {
  PROVIDER_KEYS,
  PROVIDER_LABELS,
  type CustomOpenAIProviderConfig,
  type ProviderConfig,
  type ProviderKey,
  type SuperpowerInsideSettings,
} from '../settings';
import type { RefreshDomain } from '../utils/refresh-bus';
import type { RefreshResult } from '../utils/refresh-action';
import { redactLogValue, type LogEntry } from '../utils/logger';
import type { IndexingResult } from '../rag/indexer';

const AGENT_DIAGNOSTICS_FILE_NAME = 'agent-diagnostics.json';

export interface AgentDiagnosticsManifestInfo {
  id: string;
  name: string;
  version: string;
}

export interface AgentDiagnosticsVaultInfo {
  name: string;
  configDir: string;
  adapterBasePath: string | null;
}

export interface AgentDiagnosticsMcpServerRuntime {
  name: string;
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  status: MCPServerConnectionStatus;
  error?: string;
}

export interface AgentDiagnosticsRuntimeState {
  ragStatus: RagStatusSummary | null;
  graphRagStatus: GraphRagStatusSummary | null;
  mcpConnectionState: MCPConnectionState;
  mcpServers: readonly AgentDiagnosticsMcpServerRuntime[];
  isRagIndexing: boolean;
  isGraphRagIndexing: boolean;
  hasGraphRagRunner: boolean;
  ragIndexingStatus: RagIndexingSchedulerStatus | null;
  performanceGuardState: PerformanceGuardState | null;
  nextAutoUpdateAt: number | null;
  lastAutoUpdateSkippedReason: string | null;
  lastAutoUpdateResult: IndexingResult | null;
  ragRuntimeInit: AgentDiagnosticsRagRuntimeInitState;
  runtimeFlags: AgentDiagnosticsRuntimeFlags;
}

export interface AgentDiagnosticsRagRuntimeInitState {
  running: boolean;
  currentStage: string | null;
  lastError: string | null;
  lastSkippedReason: string | null;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
}

export interface AgentDiagnosticsRuntimeFlags {
  vectorStoreReady: boolean;
  knowledgeGraphStoreReady: boolean;
  ragEngineReady: boolean;
  providerReady: boolean;
}

export interface AgentDiagnosticsSessionState {
  id: string;
  status: 'running' | 'stopped';
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
}

export interface AgentDiagnosticsHeartbeatState {
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastLagMs: number | null;
  maxLagMs: number;
  tickCount: number;
}

export interface AgentDiagnosticsRefreshEvent {
  id: number;
  timestamp: number;
  domain: RefreshDomain;
  status: RefreshResult['status'];
  detail?: string;
  runId?: number;
  source?: RefreshResult['source'];
}

export interface AgentDiagnosticsFileWriteState {
  path: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface AgentDiagnosticsSnapshotInput {
  manifest: AgentDiagnosticsManifestInfo;
  vault: AgentDiagnosticsVaultInfo;
  settings: SuperpowerInsideSettings;
  runtime: AgentDiagnosticsRuntimeState;
  session: AgentDiagnosticsSessionState;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: readonly AgentDiagnosticsRefreshEvent[];
  logs: readonly LogEntry[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
  now: number;
}

export interface AgentDiagnosticsProviderRow {
  id: string;
  label: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  modelCount: number;
  models: string[];
  baseUrl: string;
}

export interface AgentDiagnosticsSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  manifest: AgentDiagnosticsManifestInfo;
  vault: AgentDiagnosticsVaultInfo;
  session: AgentDiagnosticsSessionState;
  diagnosticFile: {
    path: string;
  };
  providers: {
    enabledCount: number;
    rows: AgentDiagnosticsProviderRow[];
  };
  settingsSummary: {
    language: SuperpowerInsideSettings['language'];
    agentDiagnosticsEnabled: boolean;
    logging: SuperpowerInsideSettings['logging'];
    chat: {
      defaultModel: string;
      saveFolderConfigured: boolean;
      autoSaveEnabled: boolean;
      enforceMcpTools: boolean;
    };
    rag: {
      embeddingProvider: SuperpowerInsideSettings['rag']['embeddingProvider'];
      embeddingModel: string;
      autoUpdateEnabled: boolean;
      graphRagEnabled: boolean;
      graphRagModelConfigured: boolean;
      enableBM25: boolean;
      annEnabled: boolean;
    };
  };
  rag: {
    status: RagStatusSummary | null;
    indexing: RagIndexingSchedulerStatus | null;
    isIndexing: boolean;
    nextAutoUpdateAt: number | null;
    lastAutoUpdateSkippedReason: string | null;
    lastAutoUpdateResult: IndexingResult | null;
    performanceGuard: PerformanceGuardState | null;
    init: AgentDiagnosticsRagRuntimeInitState;
  };
  graphRag: {
    status: GraphRagStatusSummary | null;
    isIndexing: boolean;
    hasRunner: boolean;
  };
  mcp: {
    state: MCPConnectionState;
    servers: AgentDiagnosticsMcpServerSnapshot[];
  };
  runtimeFlags: AgentDiagnosticsRuntimeFlags;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: AgentDiagnosticsRefreshEvent[];
  logs: AgentDiagnosticsLogSnapshot[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
}

export interface AgentDiagnosticsMcpServerSnapshot {
  name: string;
  command: string;
  args: string[];
  env: Record<string, unknown>;
  status: MCPServerConnectionStatus;
  error?: string;
}

export interface AgentDiagnosticsLogSnapshot {
  id: number;
  timestamp: number;
  level: LogEntry['level'];
  source: string;
  message: string;
  data?: unknown;
  error?: string;
}

export function getAgentDiagnosticsFilePath(configDir: string, pluginId: string): string {
  return joinVaultPath(configDir, 'plugins', pluginId, AGENT_DIAGNOSTICS_FILE_NAME);
}

export function buildAgentDiagnosticsSnapshot(
  input: AgentDiagnosticsSnapshotInput,
): AgentDiagnosticsSnapshot {
  const diagnosticFilePath = input.fileWrite?.path ?? getAgentDiagnosticsFilePath(
    input.vault.configDir,
    input.manifest.id,
  );
  return {
    schemaVersion: 1,
    generatedAt: input.now,
    manifest: input.manifest,
    vault: {
      ...input.vault,
      adapterBasePath:
        typeof input.vault.adapterBasePath === 'string' ? input.vault.adapterBasePath : null,
    },
    session: input.session,
    diagnosticFile: {
      path: diagnosticFilePath,
    },
    providers: buildProviderSnapshot(input.settings),
    settingsSummary: buildSettingsSummary(input.settings),
    rag: {
      status: input.runtime.ragStatus,
      indexing: input.runtime.ragIndexingStatus,
      isIndexing: input.runtime.isRagIndexing,
      nextAutoUpdateAt: input.runtime.nextAutoUpdateAt,
      lastAutoUpdateSkippedReason: input.runtime.lastAutoUpdateSkippedReason,
      lastAutoUpdateResult: input.runtime.lastAutoUpdateResult,
      performanceGuard: input.runtime.performanceGuardState,
      init: { ...input.runtime.ragRuntimeInit },
    },
    graphRag: {
      status: input.runtime.graphRagStatus,
      isIndexing: input.runtime.isGraphRagIndexing,
      hasRunner: input.runtime.hasGraphRagRunner,
    },
    mcp: {
      state: input.runtime.mcpConnectionState,
      servers: input.runtime.mcpServers.map(toMcpServerSnapshot),
    },
    runtimeFlags: input.runtime.runtimeFlags,
    heartbeat: input.heartbeat,
    refreshEvents: input.refreshEvents.map((event) => ({ ...event })),
    logs: input.logs.map(toLogSnapshot),
    fileWrite: input.fileWrite,
  };
}

function buildProviderSnapshot(settings: SuperpowerInsideSettings): {
  enabledCount: number;
  rows: AgentDiagnosticsProviderRow[];
} {
  const fixedRows = PROVIDER_KEYS.map((key) =>
    toProviderRow(key, PROVIDER_LABELS[key], settings[key]),
  );
  const customRows = settings.customOpenAIProviders.map(toCustomProviderRow);
  const rows = [...fixedRows, ...customRows];
  return {
    enabledCount: rows.filter((row) => row.enabled).length,
    rows,
  };
}

function toProviderRow(
  id: ProviderKey,
  label: string,
  config: ProviderConfig,
): AgentDiagnosticsProviderRow {
  return {
    id,
    label,
    enabled: config.enabled,
    apiKeyConfigured: config.apiKey.trim().length > 0,
    modelCount: config.models.length,
    models: [...config.models],
    baseUrl: config.baseUrl ?? '',
  };
}

function toCustomProviderRow(config: CustomOpenAIProviderConfig): AgentDiagnosticsProviderRow {
  return {
    id: `customOpenAI:${config.id}`,
    label: config.name.trim() || 'Custom OpenAI-Compatible',
    enabled: config.enabled,
    apiKeyConfigured: config.apiKey.trim().length > 0,
    modelCount: config.models.length,
    models: [...config.models],
    baseUrl: config.baseUrl ?? '',
  };
}

function buildSettingsSummary(settings: SuperpowerInsideSettings): AgentDiagnosticsSnapshot['settingsSummary'] {
  return {
    language: settings.language,
    agentDiagnosticsEnabled: settings.agentDiagnostics.enabled,
    logging: settings.logging,
    chat: {
      defaultModel: settings.chat.defaultModel,
      saveFolderConfigured: settings.chat.saveFolder.trim().length > 0,
      autoSaveEnabled: settings.chat.autoSaveEnabled,
      enforceMcpTools: settings.chat.enforceMcpTools,
    },
    rag: {
      embeddingProvider: settings.rag.embeddingProvider,
      embeddingModel: settings.rag.embeddingModel,
      autoUpdateEnabled: settings.rag.autoUpdateEnabled,
      graphRagEnabled: settings.rag.graphRagEnabled,
      graphRagModelConfigured: settings.rag.graphRagModel.trim().length > 0,
      enableBM25: settings.rag.enableBM25,
      annEnabled: settings.rag.annEnabled,
    },
  };
}

function toMcpServerSnapshot(
  server: AgentDiagnosticsMcpServerRuntime,
): AgentDiagnosticsMcpServerSnapshot {
  return {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: redactRecord(server.env),
    status: server.status,
    error: server.error ? redactString(server.error) : undefined,
  };
}

function toLogSnapshot(entry: LogEntry): AgentDiagnosticsLogSnapshot {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    source: entry.source,
    message: entry.message,
    data: entry.data === undefined ? undefined : redactLogValue(entry.data),
    error: entry.error ? redactString(entry.error) : undefined,
  };
}

function redactRecord(input: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] = redactLogValue(value, key);
  }
  return result;
}

function redactString(value: string): string {
  const redacted = redactLogValue(value);
  return typeof redacted === 'string' ? redacted : value;
}

function joinVaultPath(...parts: readonly string[]): string {
  return parts
    .map((part) => part.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, ''))
    .filter((part) => part.length > 0)
    .join('/');
}
