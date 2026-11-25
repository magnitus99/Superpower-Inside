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

describe('serving과 building의 공유 진행', () => {
  it('사용 가능한 serving이 있어도 building의 진행·실패·범위를 우선한다', () => {
    const summary = summarizeRagActivity({
      status: status({ progress: progress({ completedFiles: 39 }) }), keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, status: 'building', indexing: status({ phase: 'all', progress: progress({ completedFiles: 12, processedFiles: 15, failedFiles: 1, partialFiles: 2, stage: 'embedding', currentFilePath: 'Synthetic/nonpublic-source.md', eta: eta(95000, 'medium') }) }) } },
    });
    expect(summary).toMatchObject({ completedFiles: 12, totalFiles: 40, totalFilesKnown: true, processedFiles: 15, failedFiles: 1, partialFiles: 2, stage: 'embedding', activity: 'indexing', servingAvailable: true, etaRemainingMs: 95000, etaConfidence: 'medium' });
    expect(JSON.stringify(summary)).not.toContain('nonpublic-source');
  });

  it('전체 tail 미확인은 유지하고 색인 부분 추정은 별도 수치로 전달한다', () => {
    const measured: RustRagIndexingEtaPlan = { ...eta(null, 'calculating'), lifecycle: 'running', pipelineRemainingMs: 2000, inferenceRemainingMs: 1200, pipelineConfidence: 'medium' };
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, status: 'building', indexing: status({ progress: progress({ eta: measured }) }) } },
    })).toMatchObject({ etaRemainingMs: null, pipelineRemainingMs: 2000, pipelineConfidence: 'medium', inferenceRemainingMs: 1200 });
  });

  it('초기 building은 미확인 총량을 실제 0건 완료로 표시하지 않는다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'none', building: { generation: null, status: 'building', indexing: null } },
    })).toMatchObject({ activity: 'preparing', totalFilesKnown: false, etaRemainingMs: null, servingAvailable: false });
  });

  it('scheduler 종료 후 manifest 확인 전에는 완료 ETA 대신 마무리 중을 게시한다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, status: 'building', indexing: status({ running: false, lastResult: { indexed: 40, documents: Array.from({ length: 40 }, (_, index) => `Synthetic/final-${index}.md`), vectors: 4000, skipped: 0, durationMs: 1000 }, progress: progress({ completedFiles: 40, eta: eta(0, 'complete'), stage: 'settled' }) }) } },
    })).toMatchObject({ activity: 'settling', stage: 'committing', etaRemainingMs: null, servingAvailable: true });
  });

  it.each(['partial', 'failed', 'cancelled'] as const)('종료된 building %s는 success나 0 ETA가 아니다', (terminal) => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, status: terminal, indexing: null } },
    })).toMatchObject({ activity: terminal, etaRemainingMs: null, totalFilesKnown: false, servingAvailable: true });
  });

  it('사용자 중단은 종료 레코드의 cancelled와 구별하고 ETA를 지운다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null, pausedByUser: true,
      generation: { availability: 'usable', building: { generation: null, status: 'cancelled', indexing: null } },
    })).toMatchObject({ activity: 'paused', pauseReason: 'user', etaRemainingMs: null, servingAvailable: true });
  });
});

describe('공유 진행의 대기 원인', () => {
  it('성능 보호 대기를 사용자 중단으로 표시하지 않는다', () => {
    expect(summarizeRagActivity({ status: status({ phase: 'paused', running: false }), keywordRestore: null,
      generation: { availability: 'usable', building: null }, pausedByUser: false,
    })).toMatchObject({ activity: 'paused', pauseReason: 'performance' });
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

describe('runtime work canonical summary', () => {
  it('building이 없고 serving이 있어도 복원 중 작업은 같은 canonical 요약에 남는다', () => {
    const work = { stage: 'restoring-keyword-documents' as const, unit: 'documents' as const,
      processedUnits: 128, totalUnits: 135835, elapsedMs: 1000.5, lastProgressAgeMs: 0,
      remainingMs: 1060000, ratePerSecond: 128, confidence: 'low' as const, etaReason: 'observed-rate' };
    const summary = summarizeRagActivity({ status: null, keywordRestore: null, generation: { availability: 'usable', building: null }, work });
    expect(summary).toMatchObject({ phase: 'preparing', activity: 'preparing', servingAvailable: true, etaRemainingMs: null, work });
    expect(summarizeRagActivity({ status: null, keywordRestore: null, generation: { availability: 'usable', building: null }, work: null })).toBeNull();
  });
});


describe('실패 진단 전달', () => {
  it('구축 세대를 만들기 전 실패도 기존 진단값으로 표시한다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'failed', building: null },
      lastInitError: 'Synthetic early initialization failure', lastInitStage: 'starting',
    })).toMatchObject({ activity: 'failed', servingAvailable: false, totalFilesKnown: false,
      lastInitError: 'Synthetic early initialization failure', lastInitStage: 'starting' });
  });
  it.each(['failed', 'building', 'cancelled', 'paused'] as const)('%s에는 실패 상태에서만 기록된 진단을 붙인다', terminal => {
    const input = { status: null, keywordRestore: null, lastInitError: 'Synthetic arbitrary failure', lastInitStage: 'synthetic-init-step',
      generation: { availability: 'usable' as const, building: { generation: null, status: terminal, indexing: null } } };
    const result = summarizeRagActivity(input);
    if (terminal === 'failed') expect(result).toMatchObject({ lastInitError: input.lastInitError, lastInitStage: input.lastInitStage });
    else { expect(result?.lastInitError).toBeUndefined(); expect(result?.lastInitStage).toBeUndefined(); }
  });
});

describe('복원과 과거 실패의 출처', () => {
  it('복원 진행은 저장된 실패 이력보다 우선하고 사용자 중단은 유지한다', () => {
    const generation = { availability: 'restoring' as const, restoring: true,
      building: { generation: null, source: 'saved' as const, status: 'failed' as const, indexing: null } };
    expect(summarizeRagActivity({ status: null, keywordRestore: null, generation })).toMatchObject({ activity: 'preparing', restoring: true });
    expect(summarizeRagActivity({ status: null, keywordRestore: null, generation, pausedByUser: true })).toMatchObject({ activity: 'paused' });
  });
  it('업데이트 필요는 실제 진행이나 복원 실패를 만들지 않는다', () => {
    const result = summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: null, updateRequired: true } });
    expect(result).toMatchObject({ updateRequired: true, servingAvailable: true });
    expect(result?.activity).not.toBe('indexing');
    expect(result?.failure).toBeUndefined();
  });
  it('현재 복원 실패는 과거 failed와 무관한 init 오류보다 우선한다', () => {
    const summary = summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, source: 'saved', status: 'failed', indexing: null }, restoreFailure: { error: 'synthetic unreachable', stage: 'restoring-keyword-documents' } },
      lastInitError: 'unrelated', lastInitStage: 'loading-model',
    });
    expect(summary).toMatchObject({ activity: 'failed', servingAvailable: true, failure: { source: 'restore', error: 'synthetic unreachable', stage: 'restoring-keyword-documents' } });
  });
  it('과거 실패는 현재 init 오류를 빌리지 않는다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, source: 'saved', status: 'failed', indexing: null } }, lastInitError: 'unrelated',
    })).toMatchObject({ failure: { source: 'saved', error: null, stage: null } });
  });
  it('live 구축 실패는 현재 init 원인을 보존한다', () => {
    expect(summarizeRagActivity({ status: null, keywordRestore: null,
      generation: { availability: 'usable', building: { generation: null, source: 'live', status: 'failed', indexing: null }, restoreFailure: { error: 'old restore', stage: 'opening-storage' } }, lastInitError: 'new init', lastInitStage: 'loading-model',
    })).toMatchObject({ failure: { source: 'init', error: 'new init', stage: 'loading-model' } });
  });
});
