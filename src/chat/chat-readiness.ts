import { t } from '../i18n';

export type ChatReadinessStatus = 'ready' | 'blocked';
export type ChatReadinessSeverity = 'blocking';
export type ChatReadinessItemKind = 'provider' | 'model';
export type ChatReadinessAction = 'configure-provider' | 'select-model';

export interface ChatReadinessInput {
  enabledProviderCount: number;
  availableModelCount: number;
  selectedModel: string;
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

/** 현재 입력으로 준비 상태 스냅샷을 만든다. */
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
      action: input.availableModelCount > 0 ? 'select-model' : 'configure-provider',
    });
  }

  const blocksSend = items.some((item) => item.severity === 'blocking');
  const status: ChatReadinessStatus = blocksSend ? 'blocked' : 'ready';
  return {
    status,
    blocksSend,
    primaryText: blocksSend ? items[0].label : t('chatReadinessReady'),
    items,
  };
}
