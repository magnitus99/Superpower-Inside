import type { GraphRagStatusSummary } from './graph/status';
import type { MCPConnectionState, MCPServerConnectionStatus } from './mcp/connection-state';
import type { RagStatusSummary } from './rag/status';
import { t } from './i18n';
import { shouldRequireProviderApiKey } from './rag/settings-display';
import type {
  CustomOpenAIProviderConfig,
  MCPServerConfig,
  ProviderConfig,
  ProviderKey,
  SuperpowerInsideSettings,
} from './settings';
import { PROVIDER_KEYS, PROVIDER_LABELS } from './settings';

export type SettingsOverviewTone = 'neutral' | 'success' | 'warning' | 'danger';
export type SettingsOverviewTarget = 'general' | 'providers' | 'rag' | 'chat' | 'mcp' | 'advanced';

export interface SettingsOverviewRuntimeState {
  ragStatus: RagStatusSummary | null;
  graphRagStatus: GraphRagStatusSummary | null;
  mcpConnectionState: MCPConnectionState;
  mcpServers: readonly SettingsOverviewMcpServerState[];
  isRagIndexing: boolean;
  isGraphRagIndexing: boolean;
  hasGraphRagRunner: boolean;
}

export interface SettingsOverviewMcpServerState {
  name: string;
  status: MCPServerConnectionStatus;
  error?: string;
}

export interface SettingsOverviewStatusRow {
  id: string;
  label: string;
  value: string;
  statusLabel: string;
  detail: string;
  tone: SettingsOverviewTone;
  target: SettingsOverviewTarget;
}

export interface SettingsOverviewMetric {
  id: string;
  label: string;
  value: string;
  statusLabel: string;
  detail: string;
  tone: SettingsOverviewTone;
  target: SettingsOverviewTarget;
}

export interface SettingsOverviewAttentionItem {
  id: string;
  label: string;
  detail: string;
  tone: Exclude<SettingsOverviewTone, 'neutral' | 'success'>;
  target: SettingsOverviewTarget;
  actionLabel: string;
}

export interface SettingsOverviewSnapshot {
  metrics: SettingsOverviewMetric[];
  providerRows: SettingsOverviewStatusRow[];
  rag: SettingsOverviewMetric;
  graphRag: SettingsOverviewMetric;
  mcp: SettingsOverviewMetric;
  mcpRows: SettingsOverviewStatusRow[];
  chat: SettingsOverviewMetric;
  attentionItems: SettingsOverviewAttentionItem[];
}

interface ProviderSource {
  id: string;
  label: string;
  key: ProviderKey | 'customOpenAI';
  config: ProviderConfig | CustomOpenAIProviderConfig;
}

export function buildSettingsOverviewSnapshot(input: {
  settings: SuperpowerInsideSettings;
  runtime: SettingsOverviewRuntimeState;
}): SettingsOverviewSnapshot {
  const providerRows = buildProviderRows(input.settings);
  const rag = buildRagMetric(input.settings, input.runtime);
  const graphRag = buildGraphRagMetric(input.settings, input.runtime);
  const mcpRows = buildMcpRows(input.settings.mcpServers, input.runtime.mcpServers);
  const mcp = buildMcpMetric(input.settings.mcpServers, input.runtime, mcpRows);
  const chat = buildChatMetric(input.settings);
  const attentionItems = buildAttentionItems({
    settings: input.settings,
    providerRows,
    rag,
    graphRag,
    mcp,
    chat,
  });

  return {
    metrics: [buildProviderMetric(providerRows), rag, graphRag, mcp, chat],
    providerRows,
    rag,
    graphRag,
    mcp,
    mcpRows,
    chat,
    attentionItems,
  };
}

function buildProviderRows(settings: SuperpowerInsideSettings): SettingsOverviewStatusRow[] {
  return getProviderSources(settings).map((source) => {
    const modelCount = source.config.models.length;
    const requiresKey = shouldRequireProviderApiKey(source.key);
    const missingKey = requiresKey && source.config.enabled && source.config.apiKey.trim() === '';
    const tone: SettingsOverviewTone = !source.config.enabled
      ? 'neutral'
      : missingKey
        ? 'danger'
        : modelCount === 0
          ? 'warning'
          : 'success';
    const statusLabel = !source.config.enabled
      ? t('overviewProviderOff')
      : missingKey
        ? t('overviewProviderKeyNeeded')
        : modelCount === 0
          ? t('overviewProviderNoModels')
          : t('overviewReady');
    const value = source.config.enabled
      ? t('overviewModelsCount', { count: modelCount })
      : t('overviewDisabled');
    const detail = missingKey
      ? t('overviewProviderMissingKeyDetail')
      : modelCount === 0 && source.config.enabled
        ? t('overviewProviderNoModelsDetail')
        : source.config.enabled
          ? source.config.models.slice(0, 2).join(', ') || t('overviewProviderModelsSelected')
          : t('overviewProviderDisabledDetail');

    return {
      id: `provider-${source.id}`,
      label: source.label.replace(' (Local)', ' Local').replace(' (Cloud)', ' Cloud'),
      value,
      statusLabel,
      detail,
      tone,
      target: 'providers',
    };
  });
}

function getProviderSources(settings: SuperpowerInsideSettings): ProviderSource[] {
  const fixed = PROVIDER_KEYS.map((key) => ({
    id: key,
    label: PROVIDER_LABELS[key],
    key,
    config: settings[key],
  }));
  const custom = settings.customOpenAIProviders.map((provider) => ({
    id: `custom-${provider.id}`,
    label: provider.name.trim() || 'Custom OpenAI',
    key: 'customOpenAI' as const,
    config: provider,
  }));
  return [...fixed, ...custom];
}

function buildProviderMetric(rows: readonly SettingsOverviewStatusRow[]): SettingsOverviewMetric {
  const enabledRows = rows.filter((row) => row.statusLabel !== t('overviewProviderOff'));
  const readyRows = rows.filter((row) => row.tone === 'success');
  const failingRows = rows.filter((row) => row.tone === 'danger');
  const warningRows = rows.filter((row) => row.tone === 'warning');
  const tone: SettingsOverviewTone =
    failingRows.length > 0
      ? 'danger'
      : warningRows.length > 0
        ? 'warning'
        : readyRows.length > 0
          ? 'success'
          : 'neutral';
  const statusLabel =
    failingRows.length > 0
      ? t('overviewProviderKeyNeeded')
      : warningRows.length > 0
        ? t('overviewProviderCheckModels')
        : readyRows.length > 0
          ? t('overviewReady')
          : t('overviewDisabled');

  return {
    id: 'providers',
    label: 'Providers',
    value: `${readyRows.length}/${enabledRows.length}`,
    statusLabel,
    detail:
      enabledRows.length > 0
        ? t('overviewProviderSummaryDetail', {
            enabled: enabledRows.length,
            ready: readyRows.length,
          })
        : t('overviewProviderNoneActive'),
    tone,
    target: 'providers',
  };
}

function buildRagMetric(
  settings: SuperpowerInsideSettings,
  runtime: SettingsOverviewRuntimeState,
): SettingsOverviewMetric {
  const status = runtime.ragStatus;
  if (runtime.isRagIndexing) {
    return {
      id: 'rag',
      label: 'RAG',
      value: t('overviewRunning'),
      statusLabel: t('ragIndexingInProgress'),
      detail: t('overviewGraphRagExtractingDetail'),
      tone: 'warning',
      target: 'rag',
    };
  }
  if (!status) {
    return {
      id: 'rag',
      label: 'RAG',
      value: t('overviewBeforeCalculation'),
      statusLabel: t('overviewBeforeCalculation'),
      detail: t('overviewRagNotCalculatedDetail', { embedding: getEmbeddingLabel(settings) }),
      tone: 'warning',
      target: 'rag',
    };
  }

  const updateRequiredCount = status.updateRequiredDocuments.length;
  const tone: SettingsOverviewTone =
    status.totalDocuments === 0 ? 'warning' : updateRequiredCount > 0 ? 'warning' : 'success';
  const value =
    status.totalDocuments === 0
      ? t('overviewNoTargets')
      : updateRequiredCount > 0
        ? t('overviewNeedsCount', { count: updateRequiredCount })
        : t('overviewLatest');
  const detail =
    status.totalDocuments === 0
      ? t('overviewNoIndexingTargetFiles')
      : updateRequiredCount > 0
        ? t('overviewRagNeedsDetail', { count: updateRequiredCount })
        : t('overviewRagHealthyDetail', {
            healthy: status.healthyDocuments,
            total: status.totalDocuments,
          });

  return {
    id: 'rag',
    label: 'RAG',
    value,
    statusLabel:
      status.totalDocuments === 0
        ? t('overviewNoTargets')
        : updateRequiredCount > 0
          ? t('overviewSyncRequired')
          : t('overviewLatest'),
    detail,
    tone,
    target: 'rag',
  };
}

function buildGraphRagMetric(
  settings: SuperpowerInsideSettings,
  runtime: SettingsOverviewRuntimeState,
): SettingsOverviewMetric {
  if (runtime.isGraphRagIndexing) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewRunning'),
      statusLabel: t('ragIndexingInProgress'),
      detail: t('overviewGraphRagExtractingDetail'),
      tone: 'warning',
      target: 'rag',
    };
  }

  const status = runtime.graphRagStatus;
  if (status?.state === 'ready') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewLatest'),
      statusLabel: t('overviewLatest'),
      detail: t('overviewGraphRagEvidenceReady', { count: status.graphEvidenceCount }),
      tone: 'success',
      target: 'rag',
    };
  }
  if (status?.state === 'stale') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewGraphRagStaleValue', { count: status.staleFileCount }),
      statusLabel: t('overviewSyncRequired'),
      detail: t('overviewGraphRagStaleDetail'),
      tone: 'warning',
      target: 'rag',
    };
  }
  if (status?.state === 'partial') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('graphRagStatusPartialLabel'),
      statusLabel: t('graphRagStatusPartialLabel'),
      detail: t('overviewGraphRagPartialDetail', { count: status.failedFileCount }),
      tone: 'warning',
      target: 'rag',
    };
  }
  if (status?.state === 'schema-error') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewNotReady'),
      statusLabel: t('graphRagStatusSchemaErrorLabel'),
      detail: t('overviewGraphRagNeedIndexing'),
      tone: 'danger',
      target: 'rag',
    };
  }
  if (!settings.rag.graphRagEnabled) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('graphRagStatusDisabledLabel'),
      statusLabel: t('graphRagStatusDisabledLabel'),
      detail: t('overviewGraphRagDisabledDetail'),
      tone: 'neutral',
      target: 'rag',
    };
  }
  if (!runtime.hasGraphRagRunner || !settings.rag.graphRagModel.trim()) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewNeedsSetup'),
      statusLabel: t('overviewNeedsSetup'),
      detail: runtime.hasGraphRagRunner
        ? t('graphRagModelMissingReason')
        : t('overviewGraphRagRunnerMissing'),
      tone: 'warning',
      target: 'rag',
    };
  }
  if (!status) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: t('overviewBeforeCalculation'),
      statusLabel: t('overviewBeforeCalculation'),
      detail: t('overviewGraphRagNotCalculated'),
      tone: 'warning',
      target: 'rag',
    };
  }

  return {
    id: 'graph-rag',
    label: 'GraphRAG',
    value: t('overviewNotReady'),
    statusLabel: t('overviewNotReady'),
    detail: t('overviewGraphRagNeedIndexing'),
    tone: 'warning',
    target: 'rag',
  };
}

function buildMcpRows(
  servers: readonly MCPServerConfig[],
  runtimeServers: readonly SettingsOverviewMcpServerState[],
): SettingsOverviewStatusRow[] {
  const runtimeByName = new Map(runtimeServers.map((server) => [server.name, server]));
  return servers.map((server) => {
    const runtime = runtimeByName.get(server.name);
    const status = runtime?.status ?? 'disconnected';
    const tone = mcpStatusTone(status);
    return {
      id: `mcp-${server.name}`,
      label: server.name,
      value: server.command,
      statusLabel: mcpStatusLabel(status),
      detail:
        runtime?.error ??
        (status === 'connected' ? t('overviewToolCallReady') : t('overviewConnectionCheck')),
      tone,
      target: 'mcp',
    };
  });
}

function buildMcpMetric(
  servers: readonly MCPServerConfig[],
  runtime: SettingsOverviewRuntimeState,
  rows: readonly SettingsOverviewStatusRow[],
): SettingsOverviewMetric {
  const total = servers.length;
  const connected = rows.filter((row) => row.tone === 'success').length;
  const errors = rows.filter((row) => row.tone === 'danger').length;
  const tone: SettingsOverviewTone =
    total === 0
      ? 'neutral'
      : errors > 0
        ? 'danger'
        : connected === total
          ? 'success'
          : runtime.mcpConnectionState === 'connecting'
            ? 'warning'
            : 'warning';
  const value = total === 0 ? t('overviewNone') : `${connected}/${total}`;
  const statusLabel =
    total === 0
      ? t('overviewNoServers')
      : errors > 0
        ? connected > 0
          ? t('overviewPartialError')
          : t('overviewError')
        : connected === total
          ? t('overviewConnected')
          : runtime.mcpConnectionState === 'connecting'
            ? t('overviewConnecting')
            : t('overviewDisconnected');
  const detail =
    total === 0
      ? t('overviewMcpNoServersDetail')
      : errors > 0
        ? t('overviewMcpErrorsDetail', { count: errors })
        : connected === total
          ? t('overviewMcpAllConnected')
          : t('overviewMcpSomeDisconnected');

  return {
    id: 'mcp',
    label: 'MCP',
    value,
    statusLabel,
    detail,
    tone,
    target: 'mcp',
  };
}

function buildChatMetric(settings: SuperpowerInsideSettings): SettingsOverviewMetric {
  const defaultModelAvailable = getAvailableChatModelValues(settings).includes(
    settings.chat.defaultModel,
  );
  return {
    id: 'chat',
    label: 'Chat',
    value: defaultModelAvailable ? t('overviewReady') : t('overviewProviderCheckModels'),
    statusLabel: defaultModelAvailable ? t('overviewReady') : t('overviewProviderCheckModels'),
    detail: defaultModelAvailable
      ? t('overviewChatDefaultModel', { model: settings.chat.defaultModel })
      : t('overviewChatDefaultUnavailable'),
    tone: defaultModelAvailable ? 'success' : 'warning',
    target: 'chat',
  };
}

function buildAttentionItems(input: {
  settings: SuperpowerInsideSettings;
  providerRows: readonly SettingsOverviewStatusRow[];
  rag: SettingsOverviewMetric;
  graphRag: SettingsOverviewMetric;
  mcp: SettingsOverviewMetric;
  chat: SettingsOverviewMetric;
}): SettingsOverviewAttentionItem[] {
  const items: SettingsOverviewAttentionItem[] = [];

  for (const row of input.providerRows) {
    if (row.statusLabel === t('overviewProviderKeyNeeded')) {
      items.push({
        id: `${row.id}-api-key`,
        label: t('overviewProviderApiKeyNeeded', { provider: row.label }),
        detail: row.detail,
        tone: 'danger',
        target: 'providers',
        actionLabel: 'Providers',
      });
    }
  }

  if (input.chat.tone === 'warning') {
    items.push({
      id: 'chat-default-model-unavailable',
      label: t('overviewChatModelAttention'),
      detail: input.chat.detail,
      tone: 'warning',
      target: 'general',
      actionLabel: 'General',
    });
  }

  if (input.rag.tone === 'warning' && input.rag.statusLabel === t('overviewSyncRequired')) {
    items.push({
      id: 'rag-update-required',
      label: t('overviewRagSyncAttention'),
      detail: input.rag.detail,
      tone: 'warning',
      target: 'rag',
      actionLabel: 'RAG',
    });
  }

  if (input.mcp.tone === 'danger') {
    items.push({
      id: 'mcp-errors',
      label: t('overviewMcpErrorAttention'),
      detail: input.mcp.detail,
      tone: 'danger',
      target: 'mcp',
      actionLabel: 'MCP',
    });
  }

  if (input.graphRag.tone === 'danger') {
    items.push({
      id: 'graph-rag-error',
      label: t('overviewGraphRagErrorAttention'),
      detail: input.graphRag.detail,
      tone: 'danger',
      target: 'rag',
      actionLabel: 'RAG',
    });
  }

  return items.slice(0, 6);
}

function getAvailableChatModelValues(settings: SuperpowerInsideSettings): string[] {
  const values: string[] = [];
  for (const key of PROVIDER_KEYS) {
    const config = settings[key];
    if (!config.enabled) continue;
    values.push(...config.models.map((model) => `${key}:${model}`));
  }
  for (const provider of settings.customOpenAIProviders) {
    if (!provider.enabled) continue;
    values.push(...provider.models.map((model) => `customOpenAI:${provider.id}:${model}`));
  }
  return values;
}

function getEmbeddingLabel(settings: SuperpowerInsideSettings): string {
  return t('overviewEmbeddingLabel', {
    provider: settings.rag.embeddingProvider,
    model: settings.rag.embeddingModel || t('unsetLabel'),
  });
}

function mcpStatusTone(status: MCPServerConnectionStatus): SettingsOverviewTone {
  if (status === 'connected') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'connecting') return 'warning';
  return 'neutral';
}

function mcpStatusLabel(status: MCPServerConnectionStatus): string {
  if (status === 'connected') return t('overviewConnected');
  if (status === 'error') return t('overviewError');
  if (status === 'connecting') return t('overviewConnecting');
  return t('overviewDisconnected');
}
