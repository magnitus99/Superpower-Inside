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
const AGENT_DIAGNOSTICS_EVENT_LOG_FILE_NAME = 'agent-diagnostics.ndjson';
const AGENT_DIAGNOSTICS_SAFE_MODE_FILE_NAME = 'agent-diagnostics-safe-mode.json';

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

export interface AgentDiagnosticsPreviousSessionState {
  id: string;
  status: AgentDiagnosticsSessionState['status'];
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  lastGeneratedAt: number | null;
  lastHeartbeat: AgentDiagnosticsHeartbeatState | null;
  lastActiveOperation: AgentDiagnosticsActiveOperationState | null;
  suspectedUncleanShutdown: boolean;
}

export type AgentDiagnosticsBreadcrumbAction = 'enter' | 'leave' | 'error' | 'mark';

export interface AgentDiagnosticsBreadcrumb {
  id: number;
  timestamp: number;
  phase: string;
  action: AgentDiagnosticsBreadcrumbAction;
  detail?: string;
  data?: unknown;
}

export interface AgentDiagnosticsActiveOperationState {
  id: number;
  phase: string;
  detail?: string;
  startedAt: number;
  lastUpdatedAt: number;
  data?: unknown;
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

export interface AgentDiagnosticsEventLogState {
  path: string;
  lastAppendAt: number | null;
  lastError: string | null;
}

export interface AgentDiagnosticsSnapshotInput {
  manifest: AgentDiagnosticsManifestInfo;
  vault: AgentDiagnosticsVaultInfo;
  settings: SuperpowerInsideSettings;
  runtime: AgentDiagnosticsRuntimeState;
  session: AgentDiagnosticsSessionState;
  previousSession: AgentDiagnosticsPreviousSessionState | null;
  heartbeat: AgentDiagnosticsHeartbeatState;
  refreshEvents: readonly AgentDiagnosticsRefreshEvent[];
  breadcrumbs: readonly AgentDiagnosticsBreadcrumb[];
  activeOperations: readonly AgentDiagnosticsActiveOperationState[];
  logs: readonly LogEntry[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
  eventLog: AgentDiagnosticsEventLogState | null;
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
  previousSession: AgentDiagnosticsPreviousSessionState | null;
  diagnosticFile: {
    path: string;
    eventLogPath: string;
    safeModeFlagPath: string;
  };
  diagnosis: AgentDiagnosticsDiagnosisSnapshot;
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
  breadcrumbs: AgentDiagnosticsBreadcrumb[];
  activeOperations: AgentDiagnosticsActiveOperationState[];
  logs: AgentDiagnosticsLogSnapshot[];
  fileWrite: AgentDiagnosticsFileWriteState | null;
  eventLog: AgentDiagnosticsEventLogState | null;
}

export interface AgentDiagnosticsDiagnosisSnapshot {
  status: 'ok' | 'running' | 'attention' | 'unclean-shutdown';
  summary: string;
  lastActiveOperation: AgentDiagnosticsActiveOperationState | null;
  suspectedCause: string | null;
  recommendedActions: AgentDiagnosticsRecommendedActionSnapshot[];
}

export interface AgentDiagnosticsRecommendedActionSnapshot {
  id: string;
  label: string;
  detail: string;
  settingsPatch?: unknown;
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

export function getAgentDiagnosticsEventLogPath(configDir: string, pluginId: string): string {
  return joinVaultPath(configDir, 'plugins', pluginId, AGENT_DIAGNOSTICS_EVENT_LOG_FILE_NAME);
}

export function getAgentDiagnosticsSafeModeFilePath(configDir: string, pluginId: string): string {
  return joinVaultPath(configDir, 'plugins', pluginId, AGENT_DIAGNOSTICS_SAFE_MODE_FILE_NAME);
}

export function buildAgentDiagnosticsSnapshot(
  input: AgentDiagnosticsSnapshotInput,
): AgentDiagnosticsSnapshot {
  const diagnosticFilePath = input.fileWrite?.path ?? getAgentDiagnosticsFilePath(
    input.vault.configDir,
    input.manifest.id,
  );
  const eventLogPath =
    input.eventLog?.path ?? getAgentDiagnosticsEventLogPath(input.vault.configDir, input.manifest.id);
  const safeModeFlagPath = getAgentDiagnosticsSafeModeFilePath(
    input.vault.configDir,
    input.manifest.id,
  );
  const diagnosis = buildDiagnosisSnapshot(input, safeModeFlagPath);
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
    previousSession: input.previousSession,
    diagnosticFile: {
      path: diagnosticFilePath,
      eventLogPath,
      safeModeFlagPath,
    },
    diagnosis,
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
    breadcrumbs: input.breadcrumbs.map(toBreadcrumbSnapshot),
    activeOperations: input.activeOperations.map(toActiveOperationSnapshot),
    logs: input.logs.map(toLogSnapshot),
    fileWrite: input.fileWrite,
    eventLog: input.eventLog,
  };
}

function buildDiagnosisSnapshot(
  input: AgentDiagnosticsSnapshotInput,
  safeModeFlagPath: string,
): AgentDiagnosticsDiagnosisSnapshot {
  const lastActiveOperation =
    input.activeOperations.at(-1) ?? input.previousSession?.lastActiveOperation ?? null;
  const suspectedCause = inferSuspectedCause(lastActiveOperation, input);
  const recommendedActions = buildRecommendedActions(lastActiveOperation, safeModeFlagPath);
  if (input.previousSession?.suspectedUncleanShutdown) {
    return {
      status: 'unclean-shutdown',
      summary: lastActiveOperation
        ? `Previous Obsidian session stopped while ${formatOperation(lastActiveOperation)} was active.`
        : 'Previous Obsidian session stopped without a clean plugin unload.',
      lastActiveOperation,
      suspectedCause,
      recommendedActions,
    };
  }
  if (input.activeOperations.length > 0) {
    return {
      status: 'running',
      summary: `Currently active: ${formatOperation(lastActiveOperation)}`,
      lastActiveOperation,
      suspectedCause,
      recommendedActions,
    };
  }
  if ((input.heartbeat.lastLagMs ?? 0) > 1_000 || input.heartbeat.maxLagMs > 1_000) {
    return {
      status: 'attention',
      summary: `Renderer event loop lag peaked at ${Math.round(input.heartbeat.maxLagMs)} ms.`,
      lastActiveOperation,
      suspectedCause: 'event-loop-lag',
      recommendedActions,
    };
  }
  return {
    status: 'ok',
    summary: 'No stuck operation is currently visible in Agent Diagnostics.',
    lastActiveOperation,
    suspectedCause,
    recommendedActions,
  };
}

function inferSuspectedCause(
  operation: AgentDiagnosticsActiveOperationState | null,
  input: AgentDiagnosticsSnapshotInput,
): string | null {
  if (!operation) {
    if (input.runtime.isRagIndexing) return 'rag-indexing';
    if (input.runtime.isGraphRagIndexing) return 'graph-rag-indexing';
    if (input.runtime.mcpConnectionState === 'connecting') return 'mcp-connection';
    return null;
  }
  if (operation.phase.startsWith('rag.')) return 'rag-runtime-or-indexing';
  if (operation.phase.startsWith('graph.')) return 'graph-rag-indexing';
  if (operation.phase.startsWith('mcp.')) return 'mcp-connection';
  if (operation.phase.startsWith('plugin.')) return 'plugin-startup';
  return operation.phase;
}

function buildRecommendedActions(
  operation: AgentDiagnosticsActiveOperationState | null,
  safeModeFlagPath: string,
): AgentDiagnosticsRecommendedActionSnapshot[] {
  const actions: AgentDiagnosticsRecommendedActionSnapshot[] = [
    {
      id: 'safe-mode-flag',
      label: 'Create safe mode flag and restart Obsidian',
      detail: `Write {"enabled":true} to ${safeModeFlagPath} to start with heavy Superpower indexing disabled.`,
      settingsPatch: {
        rag: {
          autoUpdateEnabled: false,
          enableBM25: false,
          structuralGraphEnabled: false,
          annEnabled: false,
          graphRagAutoSyncEnabled: false,
        },
      },
    },
  ];
  if (!operation) return actions;
  if (operation.phase.startsWith('rag.')) {
    actions.unshift({
      id: 'disable-rag-startup-work',
      label: 'Disable RAG startup work',
      detail: 'Turn off RAG auto update, BM25, structural graph, and ANN before reopening the vault.',
      settingsPatch: {
        rag: {
          autoUpdateEnabled: false,
          enableBM25: false,
          structuralGraphEnabled: false,
          annEnabled: false,
        },
      },
    });
  }
  if (operation.phase.startsWith('mcp.')) {
    actions.unshift({
      id: 'disable-mcp-autoconnect',
      label: 'Disconnect MCP servers',
      detail: 'Disable or fix MCP server commands before reconnecting.',
    });
  }
  return actions;
}

function formatOperation(operation: AgentDiagnosticsActiveOperationState | null): string {
  if (!operation) return 'no active operation';
  return operation.detail ? `${operation.phase}:${operation.detail}` : operation.phase;
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

function toBreadcrumbSnapshot(
  entry: AgentDiagnosticsBreadcrumb,
): AgentDiagnosticsBreadcrumb {
  return {
    ...entry,
    data: entry.data === undefined ? undefined : redactLogValue(entry.data),
  };
}

function toActiveOperationSnapshot(
  entry: AgentDiagnosticsActiveOperationState,
): AgentDiagnosticsActiveOperationState {
  return {
    ...entry,
    data: entry.data === undefined ? undefined : redactLogValue(entry.data),
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
