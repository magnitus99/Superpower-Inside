import { describeIndexingProgress, type ChatKeywordIndexState, type ChatRetrievalReadiness } from '../chat/chat-readiness';
import { t } from '../i18n';
import type { RagIndexingProgressSummary } from './indexing-progress';
import type { RagStatusSummary } from './status';

/** 검색 화면이 같은 순간의 준비 상태와 색인 숫자를 함께 읽기 위한 스냅샷입니다. */
export interface SearchStatusSnapshot {
  /** 벡터 색인과 키워드 색인을 합친 준비 상태입니다. */
  readiness: ChatRetrievalReadiness;
  /** 키워드 색인의 수명 주기 상태입니다. */
  keywordIndex: ChatKeywordIndexState;
  /** 마지막으로 계산된 색인 현황입니다. 아직 없으면 null입니다. */
  ragStatus: RagStatusSummary | null;
  /** 진행 중인 색인·복원 요약입니다. */
  indexing: RagIndexingProgressSummary | null;
}

export interface SearchStatusDescription {
  /** 한 단어 상태입니다. */
  label: string;
  /** 상태의 근거가 되는 진행·복원 문구입니다. */
  detail: string;
}

/**
 * 준비 상태와 그 근거를 한 쌍으로 만듭니다.
 *
 * 숫자만 보고 "색인 완료"로 오해하지 않도록, 준비 중이면 무엇을 기다리는지 함께 돌려줍니다.
 */
export function describeSearchStatus(snapshot: SearchStatusSnapshot): SearchStatusDescription {
  if (snapshot.readiness === 'degraded') {
    return {
      label: t('chatReadinessRagNotReady'),
      detail: t('chatReadinessRagNotReadyDetail'),
    };
  }
  if (snapshot.readiness === 'preparing') {
    return {
      label: t('chatReadinessRagIndexing'),
      detail: describeIndexingProgress(snapshot.indexing),
    };
  }
  return { label: t('ragOverviewReady'), detail: '' };
}
