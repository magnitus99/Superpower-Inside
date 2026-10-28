import { t } from '../i18n';
import type { RagIndexingProgressSummary } from '../rag/indexing-progress';
import { formatRagEtaDuration } from '../rag/indexing-progress';

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
  /** 진행 중인 색인 요약입니다. 있으면 단계·문서 범위·남은 시간을 함께 보여 줍니다. */
  indexing?: RagIndexingProgressSummary | null;
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
  /** 키워드 또는 벡터 색인 중 하나라도 실제 검색에 쓸 수 있습니다. */
  searchBackendReady?: boolean;
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
  // 한 검색 백엔드라도 살아 있으면 다른 백엔드의 초기화 실패만으로 검색을 막지 않습니다.
  if (!state.searchBackendReady && (state.failed || state.keywordIndex === 'unavailable')) {
    return 'degraded';
  }
  if (state.initializing || state.keywordIndex === 'loading' || state.indexing) return 'preparing';
  return 'ready';
}

/** 색인 단계 이름을 사용자 문구로 바꿉니다. */
function describeIndexingPhase(phase: RagIndexingProgressSummary['phase']): string {
  switch (phase) {
    case 'preparing':
      return t('chatReadinessIndexingPhasePreparing');
    case 'file':
      return t('chatReadinessIndexingPhaseFile');
    case 'pending':
      return t('chatReadinessIndexingPhasePending');
    case 'all':
      return t('chatReadinessIndexingPhaseAll');
    case 'paused':
      return t('chatReadinessIndexingPhasePaused');
    default:
      return t('chatReadinessIndexingPhaseIdle');
  }
}

/** 색인 진행 중이면 단계·문서 범위·남은 시간을 한 줄로 요약합니다. */
export function describeIndexingProgress(indexing: RagIndexingProgressSummary | null): string {
  if (!indexing) return t('chatReadinessRagIndexingDetail');
  if (indexing.keywordRestore) {
    const { processedDocuments, expectedDocuments } = indexing.keywordRestore;
    // 기대 문서 수를 모르거나 이미 넘었다면 읽은 수만 보여 줍니다.
    return expectedDocuments > processedDocuments
      ? t('chatReadinessKeywordRestore', {
          completed: String(processedDocuments),
          total: String(expectedDocuments),
        })
      : t('chatReadinessKeywordRestoreCount', { completed: String(processedDocuments) });
  }
  const parts = [describeIndexingPhase(indexing.phase)];
  if (indexing.totalFiles > 0) {
    parts.push(
      t('chatReadinessIndexingDocumentRange', {
        completed: String(indexing.completedFiles),
        total: String(indexing.totalFiles),
      }),
    );
  }
  if (indexing.currentFileTotalChunks !== null && indexing.currentFileEmbeddedChunks !== null) {
    parts.push(
      t('chatReadinessIndexingChunkRange', {
        completed: String(
          Math.min(indexing.currentFileEmbeddedChunks, indexing.currentFileTotalChunks),
        ),
        total: String(indexing.currentFileTotalChunks),
      }),
    );
  }
  parts.push(
    indexing.etaRemainingMs === null
      ? t('chatReadinessIndexingEtaCalculating')
      : t('chatReadinessIndexingEta', {
          eta: formatRagEtaDuration(indexing.etaRemainingMs),
        }),
  );
  return parts.join(' · ');
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
      detail: preparing
        ? describeIndexingProgress(input.indexing ?? null)
        : t('chatReadinessRagNotReadyDetail'),
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

/** 준비 중에는 부분 색인으로 컨텍스트를 만들지 않고 호출부의 readiness 대기로 넘깁니다. */
export function canUseRagContext(readiness: ChatRetrievalReadiness): boolean {
  return readiness === 'ready';
}

/** 준비되지 않은 색인 엔진은 컨텍스트 구성에서 제외하고 대기 경로로 넘깁니다. */
export function selectRagContextEngine<T>(
  engine: T | null,
  readiness: ChatRetrievalReadiness,
): T | null {
  return engine !== null && canUseRagContext(readiness) ? engine : null;
}
