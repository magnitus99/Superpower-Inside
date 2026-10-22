import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../i18n';
import { describeSearchStatus, type SearchStatusSnapshot } from './search-status';

function snapshot(overrides: Partial<SearchStatusSnapshot> = {}): SearchStatusSnapshot {
  return {
    readiness: 'ready',
    keywordIndex: 'ready',
    ragStatus: null,
    indexing: null,
    ...overrides,
  };
}

describe('검색 준비 상태 설명', () => {
  beforeEach(() => {
    setLanguage('ko');
  });

  it('준비 중이면 기다리는 대상과 진행 범위를 함께 알려 준다', () => {
    const description = describeSearchStatus(
      snapshot({
        readiness: 'preparing',
        indexing: {
          phase: 'all',
          completedFiles: 12,
          totalFiles: 40,
          currentFileEmbeddedChunks: null,
          currentFileTotalChunks: null,
          etaRemainingMs: 95_000,
        },
      }),
    );

    expect(description.label).toBe(t('chatReadinessRagIndexing'));
    expect(description.detail).toBe('전체 재색인 · 문서 12/40개 · 남은 시간 1m 35s');
  });

  it('키워드 색인을 다시 읽는 중이면 읽은 문서 수를 근거로 보여 준다', () => {
    const description = describeSearchStatus(
      snapshot({
        readiness: 'preparing',
        keywordIndex: 'loading',
        indexing: {
          phase: 'preparing',
          completedFiles: 0,
          totalFiles: 0,
          currentFileEmbeddedChunks: null,
          currentFileTotalChunks: null,
          etaRemainingMs: null,
          keywordRestore: { processedDocuments: 1_200, expectedDocuments: 0 },
        },
      }),
    );

    expect(description.detail).toBe('키워드 색인을 다시 읽는 중 · 문서 1200개');
  });

  it('제한 상태면 이유를 남기고, 준비 완료면 근거 문구를 비운다', () => {
    expect(describeSearchStatus(snapshot({ readiness: 'degraded', keywordIndex: 'unavailable' }))).toEqual(
      {
        label: t('chatReadinessRagNotReady'),
        detail: t('chatReadinessRagNotReadyDetail'),
      },
    );
    expect(describeSearchStatus(snapshot())).toEqual({ label: t('ragOverviewReady'), detail: '' });
  });
});
