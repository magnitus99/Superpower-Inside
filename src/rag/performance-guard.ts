import { t } from '../i18n';
import {
  planRagPerformanceGuardRust,
  type RustRagPerformanceGuardEventKind,
  type RustRagPerformanceGuardPolicyState,
  type RustRagPerformanceGuardReasonKind,
} from './rust-core';

export type PerformanceGuardMode = 'normal' | 'throttled' | 'paused';

export interface PerformanceGuardOptions {
  enabled: boolean;
  initialBatchSize: number;
  initialYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
  onPolicyError?: (message: string) => void;
}

export interface PerformanceGuardState {
  mode: PerformanceGuardMode;
  currentBatchSize: number;
  currentYieldMs: number;
  reason: string | null;
  pauseUntilMs: number | null;
  remainingPauseMs: number | null;
  lastSlowReason: string | null;
}

export class PerformanceGuard {
  private readonly options: PerformanceGuardOptions;
  private policyState: RustRagPerformanceGuardPolicyState;

  constructor(options: PerformanceGuardOptions) {
    this.options = {
      ...options,
      initialBatchSize: Math.max(1, Math.floor(options.initialBatchSize)),
      initialYieldMs: Math.max(0, Math.floor(options.initialYieldMs)),
    };
    const initialState = this.plan('initialize', undefined, undefined, null);
    if (!initialState) {
      throw new Error('Rust RAG performance guard initialization failed');
    }
    this.policyState = initialState;
  }

  getState(): PerformanceGuardState {
    if (
      this.policyState.mode === 'paused' &&
      (this.policyState.pauseUntilMs ?? Number.POSITIVE_INFINITY) <= Date.now()
    ) {
      this.apply('timer_tick');
    }
    return this.toPublicState();
  }

  getBatchSize(): number {
    return this.getState().currentBatchSize;
  }

  getYieldMs(): number {
    return this.getState().currentYieldMs;
  }

  resume(): PerformanceGuardState {
    this.apply('timer_tick');
    return this.toPublicState();
  }

  forceResume(): PerformanceGuardState {
    this.apply('force_resume');
    return this.toPublicState();
  }

  reset(): PerformanceGuardState {
    this.apply('reset');
    return this.toPublicState();
  }

  recordEventLoopLag(lagMs: number): PerformanceGuardState {
    this.apply('event_loop_sample', lagMs);
    return this.toPublicState();
  }

  recordBatchDuration(durationMs: number, batchSize: number): PerformanceGuardState {
    this.apply('batch_sample', durationMs, batchSize);
    return this.toPublicState();
  }

  async measureEventLoopLag(): Promise<number> {
    if (!this.options.enabled) return 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    const lagMs = Math.max(0, performance.now() - startedAt);
    this.recordEventLoopLag(lagMs);
    return lagMs;
  }

  private apply(
    kind: RustRagPerformanceGuardEventKind,
    durationMs?: number,
    batchSize?: number,
  ): boolean {
    const nextState = this.plan(kind, durationMs, batchSize);
    if (!nextState) {
      const message = `Rust RAG performance guard rejected the ${kind} transition`;
      this.options.onPolicyError?.(message);
      return false;
    }
    this.policyState = nextState;
    return true;
  }

  private plan(
    kind: RustRagPerformanceGuardEventKind,
    durationMs?: number,
    batchSize?: number,
    state: RustRagPerformanceGuardPolicyState | null = this.policyState,
  ): RustRagPerformanceGuardPolicyState | null {
    return planRagPerformanceGuardRust({
      config: {
        enabled: this.options.enabled,
        initialBatchSize: this.options.initialBatchSize,
        initialYieldMs: this.options.initialYieldMs,
        slowEventLoopThresholdMs: this.options.slowEventLoopThresholdMs,
        slowBatchThresholdMs: this.options.slowBatchThresholdMs,
      },
      state,
      event:
        durationMs === undefined
          ? { kind }
          : batchSize === undefined
            ? { kind, durationMs }
            : { kind, durationMs, batchSize },
      nowMs: Date.now(),
    });
  }

  private toPublicState(): PerformanceGuardState {
    const reason = formatReason(
      this.policyState.mode,
      this.policyState.reasonKind,
      this.policyState.reasonMs,
    );
    return {
      mode: this.policyState.mode,
      currentBatchSize: this.policyState.currentBatchSize,
      currentYieldMs: this.policyState.currentYieldMs,
      reason,
      pauseUntilMs: this.policyState.pauseUntilMs,
      remainingPauseMs:
        this.policyState.mode === 'paused' && this.policyState.pauseUntilMs !== null
          ? Math.max(0, this.policyState.pauseUntilMs - Date.now())
          : null,
      lastSlowReason: formatSlowReason(this.policyState.lastSlowKind, this.policyState.lastSlowMs),
    };
  }
}

function formatReason(
  mode: PerformanceGuardMode,
  kind: RustRagPerformanceGuardReasonKind | null,
  durationMs: number | null,
): string | null {
  if (kind === 'resumed') return t('perfGuardResumed');
  const slowReason = formatSlowReason(kind, durationMs);
  if (!slowReason) return null;
  return mode === 'paused'
    ? t('perfPausedWithReason', { reason: slowReason })
    : t('perfSlowDetected', { reason: slowReason });
}

function formatSlowReason(
  kind: RustRagPerformanceGuardReasonKind | null,
  durationMs: number | null,
): string | null {
  if (durationMs === null) return null;
  if (kind === 'batch') return t('perfIndexingBatch', { ms: Math.round(durationMs) });
  if (kind === 'event-loop') return t('perfEventLoopLag', { ms: Math.round(durationMs) });
  return null;
}
