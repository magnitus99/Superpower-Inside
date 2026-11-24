import type { RagIndexingSchedulerStatus } from './indexing-scheduler';
import type { RustRagIndexingEtaPlan } from './rust-core';
import type { RagGenerationSnapshot } from './runtime-generation';

import type { RagRuntimeWorkProgress } from './runtime-work-progress';
export type { RagRuntimeWorkProgress } from './runtime-work-progress';

export type RagIndexingActivity = 'preparing' | 'indexing' | 'settling' | 'paused' | 'partial' | 'cancelled' | 'failed';

/** 채팅·검색 화면이 진행 상황을 보여 줄 때 쓰는 색인 요약입니다. */
export interface RagIndexingProgressSummary {
  work?: RagRuntimeWorkProgress | null;
  phase: RagIndexingSchedulerStatus['phase'];
  completedFiles: number;
  totalFiles: number;
  currentFileEmbeddedChunks: number | null;
  currentFileTotalChunks: number | null;
  etaRemainingMs: number | null;
  activity?: RagIndexingActivity;
  pauseReason?: 'user' | 'performance' | 'unknown';
  servingAvailable?: boolean;
  totalFilesKnown?: boolean;
  processedFiles?: number | null;
  failedFiles?: number | null;
  partialFiles?: number | null;
  skippedFiles?: number | null;
  stage?: NonNullable<RagIndexingSchedulerStatus['progress']>['stage'];
  etaConfidence?: RustRagIndexingEtaPlan['confidence'];
  etaReason?: string;
  etaLowerRemainingMs?: number | null;
  etaUpperRemainingMs?: number | null;
  pipelineRemainingMs?: number | null;
  inferenceRemainingMs?: number | null;
  pipelineConfidence?: RustRagIndexingEtaPlan['confidence'];
  /** 키워드 색인을 IndexedDB에서 다시 읽는 중이면 그 진행입니다. */
  keywordRestore?: { processedDocuments: number; expectedDocuments: number | null } | null;
}

/**
 * 색인 스케줄러와 키워드 색인 복원 상태를 함께 요약합니다.
 *
 * 색인 작업도 복원도 진행 중이 아니면 null입니다.
 */
export function summarizeRagActivity(input: {
  status: RagIndexingSchedulerStatus | null;
  keywordRestore: { processedDocuments: number; expectedDocuments: number | null } | null;
  generation?: Pick<RagGenerationSnapshot, 'availability' | 'building'>;
  work?: RagRuntimeWorkProgress | null;
  pausedByUser?: boolean;
}): RagIndexingProgressSummary | null {
  const summary = input.generation || input.pausedByUser ? summarizeGenerationActivity(input) : summarizeLegacyActivity(input);
  if (!input.work) return summary;
  return { ...(summary ?? { phase: 'preparing', completedFiles: 0, totalFiles: 0, currentFileEmbeddedChunks: null, currentFileTotalChunks: null, etaRemainingMs: null, activity: 'preparing', totalFilesKnown: false }), servingAvailable: input.generation?.availability === 'usable', work: input.work };
}

function summarizeLegacyActivity(input: {
  status: RagIndexingSchedulerStatus | null;
  keywordRestore: { processedDocuments: number; expectedDocuments: number | null } | null;
}): RagIndexingProgressSummary | null {
  const indexing = summarizeRagIndexingProgress(input.status);
  if (indexing) return indexing;
  if (!input.keywordRestore) return null;
  return {
    phase: 'preparing',
    completedFiles: 0,
    totalFiles: 0,
    currentFileEmbeddedChunks: null,
    currentFileTotalChunks: null,
    etaRemainingMs: null,
    keywordRestore: input.keywordRestore,
  };
}

/**
 * 스케줄러 상태를 화면 표시용 요약으로 줄입니다.
 *
 * 색인이 돌지 않으면 null을 돌려주고, 아직 전체 파일 수를 모르는 준비 단계에서는 totalFiles를 0으로 둡니다.
 */
export function summarizeRagIndexingProgress(
  status: RagIndexingSchedulerStatus | null,
): RagIndexingProgressSummary | null {
  if (!status?.running) return null;
  return summarizeProgress(status);
}

function summarizeProgress(status: Pick<RagIndexingSchedulerStatus, 'phase' | 'progress'>): RagIndexingProgressSummary {
  const progress = status.progress;
  if (!progress) {
    return {
      phase: status.phase,
      completedFiles: 0,
      totalFiles: 0,
      currentFileEmbeddedChunks: null,
      currentFileTotalChunks: null,
      etaRemainingMs: null,
    };
  }
  const totalFiles = Math.max(0, progress.totalFiles);
  return {
    phase: status.phase,
    completedFiles: Math.min(Math.max(0, progress.completedFiles), totalFiles),
    totalFiles,
    currentFileEmbeddedChunks:
      progress.currentFileTotalChunks > 0 ? progress.currentFileEmbeddedChunks : null,
    currentFileTotalChunks:
      progress.currentFileTotalChunks > 0 ? progress.currentFileTotalChunks : null,
    etaRemainingMs: reliableEtaRemainingMs(progress.eta),
  };
}

function summarizeGenerationActivity(input: {
  status: RagIndexingSchedulerStatus | null;
  keywordRestore: { processedDocuments: number; expectedDocuments: number | null } | null;
  generation?: Pick<RagGenerationSnapshot, 'availability' | 'building'>;
  pausedByUser?: boolean;
}): RagIndexingProgressSummary | null {
  const building = input.generation?.building;
  const pendingBuilding = building && building.status !== 'complete' ? building : null;
  const status = pendingBuilding ? pendingBuilding.indexing : input.status;
  const paused = input.pausedByUser || pendingBuilding?.status === 'paused' || status?.phase === 'paused';
  let activity: RagIndexingActivity;
  let summary: RagIndexingProgressSummary | null;
  if (paused || pendingBuilding) {
    if (paused) activity = 'paused';
    else if (pendingBuilding?.status === 'partial' || pendingBuilding?.status === 'failed' || pendingBuilding?.status === 'cancelled') activity = pendingBuilding.status;
    else activity = status?.progress?.pipeline?.lifecycle === 'finalizing' ? 'settling'
      : status?.running ? 'indexing' : status?.lastResult ? 'settling' : 'preparing';
    summary = summarizeProgress(status ?? { phase: 'preparing', progress: null });
  } else {
    summary = summarizeRagActivity({ status, keywordRestore: input.keywordRestore });
    activity = summary?.keywordRestore || !status?.progress ? 'preparing' : 'indexing';
  }
  if (!summary) return null;
  const progress = summary.keywordRestore ? null : status?.progress;
  const estimate = activity === 'indexing' ? progress?.eta : null;
  const showEta = summary.etaRemainingMs !== null && estimate !== null && estimate !== undefined;
  return {
    ...summary,
    activity,
    pauseReason: paused ? input.pausedByUser ? 'user' : status?.phase === 'paused' ? 'performance' : 'unknown' : undefined,
    servingAvailable: input.generation?.availability === 'usable',
    totalFilesKnown: progress?.pipeline?.totalKnown ?? !!progress,
    processedFiles: progress?.processedFiles ?? null,
    failedFiles: progress?.failedFiles ?? null,
    partialFiles: progress?.partialFiles ?? null,
    skippedFiles: progress?.skipped ?? null,
    stage: activity === 'settling' ? 'committing' : progress?.stage ?? 'preparing',
    etaRemainingMs: showEta ? summary.etaRemainingMs : null,
    etaConfidence: showEta ? estimate.confidence : 'calculating',
    etaReason: activity === 'settling' ? 'awaiting-generation-commit' : activity === 'indexing' ? estimate?.confidenceReason ?? activity : activity,
    etaLowerRemainingMs: showEta ? estimate.lowerRemainingMs : null,
    etaUpperRemainingMs: showEta ? estimate.upperRemainingMs : null,
    pipelineRemainingMs: estimate?.pipelineRemainingMs ?? null,
    inferenceRemainingMs: estimate?.inferenceRemainingMs ?? null,
    pipelineConfidence: estimate?.pipelineConfidence ?? 'calculating',
  };
}

/** 신뢰도가 낮은 추정은 화면에 남은 시간으로 쓰지 않습니다. */
function reliableEtaRemainingMs(eta: RustRagIndexingEtaPlan | null): number | null {
  if (!eta || eta.remainingMs === null) return null;
  if (eta.confidence === 'calculating' || eta.confidence === 'low') return null;
  return Math.max(0, eta.remainingMs);
}

/** 남은 시간을 초·분·시간 단위로 줄여 표시합니다. */
export function formatRagEtaDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
