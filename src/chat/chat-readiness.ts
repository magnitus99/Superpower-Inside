import { t } from '../i18n';

export type ChatReadinessStatus = 'ready' | 'degraded' | 'blocked';
export type ChatReadinessSeverity = 'notice' | 'blocking';
export type ChatReadinessItemKind = 'provider' | 'model' | 'rag';
export type ChatReadinessAction = 'configure-provider' | 'select-model';
/** 검색 준비 상태. 준비되지 않아도 질문은 보낼 수 있습니다. */
export type ChatRetrievalReadiness = 'ready' | 'preparing' | 'degraded';
/** 키워드 색인의 현재 수명 주기 상태입니다. */
export type ChatKeywordIndexState = 'disabled' | 'loading' | 'ready' | 'unavailable';

export interface ChatReadinessInput {
  enabledProviderCount: number;
  availableModelCount: number;
  selectedModel: string;
  retrieval: ChatRetrievalReadiness;
}

export type ChatReadinessTone = 'neutral' | 'warning' | 'danger';

export interface ChatReadinessItem {
  kind: ChatReadinessItemKind;
  severity: ChatReadinessSeverity;
  /** 상태 문구의 톤 마크. 중립은 빈 원, 주의는 마름모, 막힘은 정사각형입니다. */
  tone: ChatReadinessTone;
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

export interface ChatRetrievalRuntimeState {
  /** RAG 런타임 초기화가 아직 진행 중입니다. */
  initializing: boolean;
  /** 초기화 실패·건너뜀처럼 스스로 풀리지 않는 제한입니다. */
  failed: boolean;
  keywordIndex: ChatKeywordIndexState;
  indexing: boolean;
}

/**
 * 준비되지 않은 검색 상태를 사용자에게 보여 줄 한 단계로 요약합니다.
 *
 * 실패가 확인된 제한만 degraded로 남기고, 로딩·색인 갱신은 preparing으로 묶습니다.
 * 어느 상태도 질문 전송을 막지 않습니다.
 */
export function resolveChatRetrievalReadiness(
  state: ChatRetrievalRuntimeState,
): ChatRetrievalReadiness {
  if (state.failed || state.keywordIndex === 'unavailable') return 'degraded';
  if (state.initializing || state.keywordIndex === 'loading' || state.indexing) return 'preparing';
  return 'ready';
}

/** 현재 입력으로 준비 상태 스냅샷을 만든다. */
export function createChatReadinessSnapshot(input: ChatReadinessInput): ChatReadinessSnapshot {
  const items: ChatReadinessItem[] = [];

  if (input.enabledProviderCount <= 0) {
    items.push({
      kind: 'provider',
      severity: 'blocking',
      tone: 'danger',
      label: t('chatReadinessProviderMissing'),
      detail: t('chatReadinessProviderMissingDetail'),
      action: 'configure-provider',
    });
  } else if (input.availableModelCount <= 0 || !input.selectedModel) {
    items.push({
      kind: 'model',
      severity: 'blocking',
      tone: 'danger',
      label: t('chatReadinessModelMissing'),
      detail: t('chatReadinessModelMissingDetail'),
      action: input.availableModelCount > 0 ? 'select-model' : 'configure-provider',
    });
  }

  // 전송을 막는 문제가 있을 때는 검색 안내로 주의를 나누지 않습니다.
  if (!items.some((item) => item.severity === 'blocking') && input.retrieval !== 'ready') {
    const preparing = input.retrieval === 'preparing';
    items.push({
      kind: 'rag',
      severity: 'notice',
      tone: preparing ? 'neutral' : 'warning',
      label: t(preparing ? 'chatReadinessRagIndexing' : 'chatReadinessRagNotReady'),
      detail: t(preparing ? 'chatReadinessRagIndexingDetail' : 'chatReadinessRagNotReadyDetail'),
    });
  }

  const blocksSend = items.some((item) => item.severity === 'blocking');
  const status: ChatReadinessStatus = blocksSend
    ? 'blocked'
    : items.length > 0
      ? 'degraded'
      : 'ready';
  return {
    status,
    blocksSend,
    primaryText:
      status === 'ready'
        ? t('chatReadinessReady')
        : status === 'blocked'
          ? items[0].label
          : t('chatReadinessDegraded'),
    items,
  };
}
