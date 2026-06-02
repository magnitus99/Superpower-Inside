import type { GraphRagStatusSummary } from './graph/status';
import type {
  MCPConnectionState,
  MCPServerConnectionStatus,
} from './mcp/connection-state';
import type { RagStatusSummary } from './rag/status';
import { shouldShowProviderApiKey } from './rag/settings-display';
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
    metrics: [
      buildProviderMetric(providerRows),
      rag,
      graphRag,
      mcp,
      chat,
    ],
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
    const requiresKey = shouldShowProviderApiKey(source.key);
    const missingKey = requiresKey && source.config.enabled && source.config.apiKey.trim() === '';
    const tone: SettingsOverviewTone = !source.config.enabled
      ? 'neutral'
      : missingKey
        ? 'danger'
        : modelCount === 0
          ? 'warning'
          : 'success';
    const statusLabel = !source.config.enabled
      ? '꺼짐'
      : missingKey
        ? '키 필요'
        : modelCount === 0
          ? '모델 없음'
          : '준비됨';
    const value = source.config.enabled ? `${modelCount}개 모델` : '비활성';
    const detail = missingKey
      ? 'API Key를 입력해야 채팅과 임베딩에서 사용할 수 있습니다.'
      : modelCount === 0 && source.config.enabled
        ? '모델을 하나 이상 선택해야 기본 모델로 사용할 수 있습니다.'
        : source.config.enabled
          ? source.config.models.slice(0, 2).join(', ') || '모델 선택됨'
          : '필요할 때 Providers 탭에서 켤 수 있습니다.';

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
  const enabledRows = rows.filter((row) => row.statusLabel !== '꺼짐');
  const readyRows = rows.filter((row) => row.tone === 'success');
  const failingRows = rows.filter((row) => row.tone === 'danger');
  const warningRows = rows.filter((row) => row.tone === 'warning');
  const tone: SettingsOverviewTone =
    failingRows.length > 0 ? 'danger' : warningRows.length > 0 ? 'warning' : readyRows.length > 0 ? 'success' : 'neutral';
  const statusLabel =
    failingRows.length > 0 ? '키 필요' : warningRows.length > 0 ? '모델 확인' : readyRows.length > 0 ? '준비됨' : '비활성';

  return {
    id: 'providers',
    label: 'Providers',
    value: `${readyRows.length}/${enabledRows.length}`,
    statusLabel,
    detail: enabledRows.length > 0 ? `${enabledRows.length}개 활성, ${readyRows.length}개 준비됨` : '활성 Provider가 없습니다.',
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
      value: '실행 중',
      statusLabel: '인덱싱 중',
      detail: '인덱싱이 진행 중입니다.',
      tone: 'warning',
      target: 'rag',
    };
  }
  if (!status) {
    return {
      id: 'rag',
      label: 'RAG',
      value: '계산 전',
      statusLabel: '계산 전',
      detail: `${getEmbeddingLabel(settings)} 기준 상태를 아직 계산하지 않았습니다.`,
      tone: 'warning',
      target: 'rag',
    };
  }

  const updateRequiredCount = status.updateRequiredDocuments.length;
  const tone: SettingsOverviewTone =
    status.totalDocuments === 0 ? 'warning' : updateRequiredCount > 0 ? 'warning' : 'success';
  const value =
    status.totalDocuments === 0
      ? '대상 없음'
      : updateRequiredCount > 0
        ? `${updateRequiredCount}개 필요`
        : '최신';
  const detail =
    status.totalDocuments === 0
      ? '인덱싱 대상 파일이 없습니다.'
      : updateRequiredCount > 0
        ? `${updateRequiredCount}개 문서가 missing/stale/unknown 상태입니다.`
        : `${status.healthyDocuments}/${status.totalDocuments}개 문서가 최신입니다.`;

  return {
    id: 'rag',
    label: 'RAG',
    value,
    statusLabel:
      status.totalDocuments === 0 ? '대상 없음' : updateRequiredCount > 0 ? '동기화 필요' : '최신',
    detail,
    tone,
    target: 'rag',
  };
}

function buildGraphRagMetric(
  settings: SuperpowerInsideSettings,
  runtime: SettingsOverviewRuntimeState,
): SettingsOverviewMetric {
  if (!settings.rag.graphRagEnabled) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '꺼짐',
      statusLabel: '꺼짐',
      detail: '기본 RAG 검색은 계속 사용할 수 있습니다.',
      tone: 'neutral',
      target: 'rag',
    };
  }
  if (!runtime.hasGraphRagRunner || !settings.rag.graphRagModel.trim()) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '설정 필요',
      statusLabel: '설정 필요',
      detail: runtime.hasGraphRagRunner ? 'GraphRAG 모델을 선택하세요.' : 'Runner가 초기화되지 않았습니다.',
      tone: 'warning',
      target: 'rag',
    };
  }
  if (runtime.isGraphRagIndexing) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '실행 중',
      statusLabel: '인덱싱 중',
      detail: '추출 인덱싱이 진행 중입니다.',
      tone: 'warning',
      target: 'rag',
    };
  }

  const status = runtime.graphRagStatus;
  if (!status) {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '계산 전',
      statusLabel: '계산 전',
      detail: 'GraphRAG 상태를 아직 계산하지 않았습니다.',
      tone: 'warning',
      target: 'rag',
    };
  }
  if (status.state === 'ready') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '최신',
      statusLabel: '최신',
      detail: `${status.graphEvidenceCount}개 evidence가 준비되어 있습니다.`,
      tone: 'success',
      target: 'rag',
    };
  }
  if (status.state === 'stale') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: `${status.staleFileCount}개 stale`,
      statusLabel: '동기화 필요',
      detail: '파일 수정 또는 모델 변경으로 동기화가 필요합니다.',
      tone: 'warning',
      target: 'rag',
    };
  }
  if (status.state === 'partial') {
    return {
      id: 'graph-rag',
      label: 'GraphRAG',
      value: '부분 완료',
      statusLabel: '부분 완료',
      detail: `${status.failedFileCount}개 파일 실패가 남아 있습니다.`,
      tone: 'warning',
      target: 'rag',
    };
  }

  return {
    id: 'graph-rag',
    label: 'GraphRAG',
    value: '준비 안 됨',
    statusLabel: status.state === 'schema-error' ? '스키마 오류' : '준비 안 됨',
    detail: 'GraphRAG 인덱싱을 실행해야 합니다.',
    tone: status.state === 'schema-error' ? 'danger' : 'warning',
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
      detail: runtime?.error ?? (status === 'connected' ? '도구 호출 준비됨' : '연결 상태를 확인하세요.'),
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
    total === 0 ? 'neutral' : errors > 0 ? 'danger' : connected === total ? 'success' : runtime.mcpConnectionState === 'connecting' ? 'warning' : 'warning';
  const value = total === 0 ? '없음' : `${connected}/${total}`;
  const statusLabel =
    total === 0
      ? '서버 없음'
      : errors > 0
        ? connected > 0
          ? '부분 오류'
          : '오류'
        : connected === total
          ? '연결됨'
          : runtime.mcpConnectionState === 'connecting'
            ? '연결 중'
            : '끊김';
  const detail =
    total === 0
      ? '등록된 MCP 서버가 없습니다.'
      : errors > 0
        ? `${errors}개 서버 연결 오류가 있습니다.`
        : connected === total
          ? '모든 MCP 서버가 연결되어 있습니다.'
          : '일부 MCP 서버가 연결되지 않았습니다.';

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
    value: defaultModelAvailable ? '준비됨' : '모델 확인',
    statusLabel: defaultModelAvailable ? '준비됨' : '모델 확인',
    detail: defaultModelAvailable
      ? `기본 모델 ${settings.chat.defaultModel}`
      : '기본 모델이 활성 Provider 모델 목록에 없습니다.',
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
    if (row.statusLabel === '키 필요') {
      items.push({
        id: `${row.id}-api-key`,
        label: `${row.label} API Key 필요`,
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
      label: '기본 모델 확인 필요',
      detail: input.chat.detail,
      tone: 'warning',
      target: 'general',
      actionLabel: 'General',
    });
  }

  if (input.rag.tone === 'warning' && input.rag.value.includes('개 필요')) {
    items.push({
      id: 'rag-update-required',
      label: 'RAG 동기화 필요',
      detail: input.rag.detail,
      tone: 'warning',
      target: 'rag',
      actionLabel: 'RAG',
    });
  }

  if (input.mcp.tone === 'danger') {
    items.push({
      id: 'mcp-errors',
      label: 'MCP 연결 오류',
      detail: input.mcp.detail,
      tone: 'danger',
      target: 'mcp',
      actionLabel: 'MCP',
    });
  }

  if (input.graphRag.tone === 'danger') {
    items.push({
      id: 'graph-rag-error',
      label: 'GraphRAG 상태 오류',
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
  return `${settings.rag.embeddingProvider} / ${settings.rag.embeddingModel || '미설정'}`;
}

function mcpStatusTone(status: MCPServerConnectionStatus): SettingsOverviewTone {
  if (status === 'connected') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'connecting') return 'warning';
  return 'neutral';
}

function mcpStatusLabel(status: MCPServerConnectionStatus): string {
  if (status === 'connected') return '연결됨';
  if (status === 'error') return '오류';
  if (status === 'connecting') return '연결 중';
  return '끊김';
}
