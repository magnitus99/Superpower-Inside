import { t } from '../i18n';

export type ChatReadinessStatus = 'ready' | 'degraded' | 'blocked';
export type ChatReadinessSeverity = 'ok' | 'notice' | 'blocking';
export type ChatReadinessItemKind = 'provider' | 'model' | 'rag' | 'mcp' | 'save-folder';
export type ChatReadinessAction =
  | 'configure-provider'
  | 'select-model'
  | 'index-rag'
  | 'reconnect-mcp'
  | 'set-save-folder';

export interface ChatReadinessInput {
  enabledProviderCount: number;
  availableModelCount: number;
  selectedModel: string;
  ragEnabled: boolean;
  ragReady: boolean;
  ragIndexing: boolean;
  configuredMcpServerCount: number;
  connectedMcpServerCount: number;
  saveFolderConfigured: boolean;
}

export interface ChatReadinessItem {
  kind: ChatReadinessItemKind;
  severity: ChatReadinessSeverity;
  label: string;
  detail: string;
  action?: ChatReadinessAction;
}

export interface ChatReadinessSnapshot {
  status: ChatReadinessStatus;
  blocksSend: boolean;
  primaryText: string;
  items: ChatReadinessItem[];
}

export function createChatReadinessSnapshot(input: ChatReadinessInput): ChatReadinessSnapshot {
  const items: ChatReadinessItem[] = [];

  if (input.enabledProviderCount <= 0) {
    items.push({
      kind: 'provider',
      severity: 'blocking',
      label: t('chatReadinessProviderMissing'),
      detail: t('chatReadinessProviderMissingDetail'),
      action: 'configure-provider',
    });
  } else if (input.availableModelCount <= 0 || !input.selectedModel) {
    items.push({
      kind: 'model',
      severity: 'blocking',
      label: t('chatReadinessModelMissing'),
      detail: t('chatReadinessModelMissingDetail'),
      action: 'select-model',
    });
  }

  if (input.ragEnabled && !input.ragReady) {
    items.push({
      kind: 'rag',
      severity: 'notice',
      label: input.ragIndexing ? t('chatReadinessRagIndexing') : t('chatReadinessRagNotReady'),
      detail: input.ragIndexing
        ? t('chatReadinessRagIndexingDetail')
        : t('chatReadinessRagNotReadyDetail'),
      action: 'index-rag',
    });
  }

  if (
    input.configuredMcpServerCount > 0 &&
    input.connectedMcpServerCount < input.configuredMcpServerCount
  ) {
    items.push({
      kind: 'mcp',
      severity: 'notice',
      label: t('chatReadinessMcpPartial'),
      detail: t('chatReadinessMcpPartialDetail', {
        connected: input.connectedMcpServerCount,
        total: input.configuredMcpServerCount,
      }),
      action: 'reconnect-mcp',
    });
  }

  if (!input.saveFolderConfigured) {
    items.push({
      kind: 'save-folder',
      severity: 'notice',
      label: t('chatReadinessSaveFolderMissing'),
      detail: t('chatReadinessSaveFolderMissingDetail'),
      action: 'set-save-folder',
    });
  }

  const blocksSend = items.some((item) => item.severity === 'blocking');
  const status: ChatReadinessStatus = blocksSend ? 'blocked' : items.length > 0 ? 'degraded' : 'ready';
  return {
    status,
    blocksSend,
    primaryText:
      status === 'ready'
        ? t('chatReadinessReady')
        : status === 'blocked'
          ? t('chatReadinessBlocked')
          : t('chatReadinessDegraded'),
    items,
  };
}
