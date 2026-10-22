import { describe, expect, it } from 'vitest';
import {
  formatRagEtaDuration,
  summarizeRagActivity,
  summarizeRagIndexingProgress,
} from './indexing-progress';
import type { RagIndexingSchedulerStatus } from './indexing-scheduler';
import type { RustRagIndexingEtaPlan } from './rust-core';

/** 테스트용 진행 스냅샷을 만듭니다. */
function progress(
  overrides: Partial<RagIndexingSchedulerStatus['progress'] & object> = {},
): NonNullable<RagIndexingSchedulerStatus['progress']> {
  return {
    event: 'file-chunks',
    startedAtMs: 0,
    nowMs: 1_000,
    totalFiles: 40,
    completedFiles: 12,
    currentFileTotalChunks: 120,
    currentFileEmbeddedChunks: 30,
    totalEstimatedChunks: 4_000,
    completedEstimatedChunks: 1_000,
    currentFileEstimatedChunks: 120,
    totalPlannedChunks: 4_000,
    completedPlannedChunks: 1_000,
    currentFilePlannedChunks: 120,
    planningComplete: true,
    indexed: 12,
    vectors: 1_000,
    skipped: 0,
    completedBatchDurationsMs: [],
    completedBatchChunkCounts: [],
    completedFileDurationsMs: [],
    completedFileChunkCounts: [],
    completedFileEstimatedChunkCounts: [],
    completedFileActualChunkCounts: [],
    completedFileOverheadDurationsMs: [],
    historicalMsPerChunk: null,
    historicalChunkEstimateRatio: null,
    historicalVariance: null,
    eta: null,
    ...overrides,
  };
}

/** 테스트용 남은 시간 추정을 만듭니다. */
function eta(remainingMs: number | null, confidence: RustRagIndexingEtaPlan['confidence']) {
  return {
    totalFiles: 40,
    completedFiles: 12,
    currentFileProgress: 0.25,
    progressRatio: 0.3,
    elapsedMs: 1_000,
    remainingMs,
    estimatedCompletionMs: null,
    confidence,
    basis: 'batch-rate',
    lowerRemainingMs: null,
    upperRemainingMs: null,
    confidenceReason: '',
    etaConfidenceReason: '',
  } as RustRagIndexingEtaPlan;
}

/** 테스트용 스케줄러 상태를 만듭니다. */
function status(overrides: Partial<RagIndexingSchedulerStatus> = {}): RagIndexingSchedulerStatus {
  return {
    running: true,
    phase: 'file',
    startedAt: 0,
    queuedFiles: 2,
    lastResult: null,
    progress: null,
    ...overrides,
  };
}

describe('색인 진행 요약', () => {
  it('색인이 돌지 않으면 요약하지 않는다', () => {
    expect(summarizeRagIndexingProgress(null)).toBeNull();
    expect(summarizeRagIndexingProgress(status({ running: false }))).toBeNull();
  });

  it('준비 단계처럼 진행 정보가 없으면 단계만 알려 준다', () => {
    expect(summarizeRagIndexingProgress(status({ phase: 'preparing' }))).toEqual({
      phase: 'preparing',
      completedFiles: 0,
      totalFiles: 0,
      currentFileEmbeddedChunks: null,
      currentFileTotalChunks: null,
      etaRemainingMs: null,
    });
  });

  it('문서 범위와 현재 문서 청크, 남은 시간을 함께 요약한다', () => {
    const summary = summarizeRagIndexingProgress(
      status({ progress: progress({ eta: eta(95_000, 'medium') }) }),
    );
    expect(summary).toEqual({
      phase: 'file',
      completedFiles: 12,
      totalFiles: 40,
      currentFileEmbeddedChunks: 30,
      currentFileTotalChunks: 120,
      etaRemainingMs: 95_000,
    });
  });

  it('신뢰도가 낮은 추정은 남은 시간으로 쓰지 않는다', () => {
    const summary = summarizeRagIndexingProgress(
      status({
        progress: progress({
          currentFileEmbeddedChunks: 0,
          currentFileTotalChunks: 0,
          eta: eta(10_000, 'low'),
        }),
      }),
    );
    expect(summary?.etaRemainingMs).toBeNull();
    expect(summary?.currentFileTotalChunks).toBeNull();
  });

  it('완료 문서 수가 전체 문서 수를 넘지 않는다', () => {
    const summary = summarizeRagIndexingProgress(
      status({ progress: progress({ completedFiles: 9, totalFiles: 4 }) }),
    );
    expect(summary?.completedFiles).toBe(4);
  });
});

describe('색인 활동 요약', () => {
  it('색인 작업이 없고 복원만 진행 중이면 복원 진행을 알려 준다', () => {
    expect(
      summarizeRagActivity({
        status: null,
        keywordRestore: { processedDocuments: 1_200, expectedDocuments: 5_400 },
      }),
    ).toEqual({
      phase: 'preparing',
      completedFiles: 0,
      totalFiles: 0,
      currentFileEmbeddedChunks: null,
      currentFileTotalChunks: null,
      etaRemainingMs: null,
      keywordRestore: { processedDocuments: 1_200, expectedDocuments: 5_400 },
    });
  });

  it('색인 작업이 돌면 스케줄러 진행을 우선한다', () => {
    expect(
      summarizeRagActivity({
        status: status({ phase: 'all' }),
        keywordRestore: { processedDocuments: 1, expectedDocuments: 2 },
      })?.phase,
    ).toBe('all');
  });

  it('아무 작업도 없으면 요약하지 않는다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null })).toBeNull();
  });
});

describe('남은 시간 표기', () => {
  it('1분 미만은 초로 표시한다', () => {
    expect(formatRagEtaDuration(0)).toBe('0s');
    expect(formatRagEtaDuration(59_400)).toBe('1m');
  });

  it('분·시간 단위로 줄여 표시한다', () => {
    expect(formatRagEtaDuration(60_000)).toBe('1m');
    expect(formatRagEtaDuration(95_000)).toBe('1m 35s');
    expect(formatRagEtaDuration(3_600_000)).toBe('1h');
    expect(formatRagEtaDuration(5_400_000)).toBe('1h 30m');
  });
});
