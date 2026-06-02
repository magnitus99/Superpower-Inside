import { t } from '../i18n';

export type PerformanceGuardMode = 'normal' | 'throttled' | 'paused';

export interface PerformanceGuardOptions {
  enabled: boolean;
  initialBatchSize: number;
  initialYieldMs: number;
  slowEventLoopThresholdMs: number;
  slowBatchThresholdMs: number;
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

const SLOW_SAMPLE_LIMIT = 3;
const PAUSE_SAMPLE_LIMIT = 6;
const RECOVERY_SAMPLE_LIMIT = 3;
const MAX_YIELD_MS = 500;
const DEFAULT_PAUSE_MS = 30_000;

export class PerformanceGuard {
  private readonly options: PerformanceGuardOptions;
  private readonly initialBatchSize: number;
  private readonly initialYieldMs: number;
  private mode: PerformanceGuardMode = 'normal';
  private currentBatchSize: number;
  private currentYieldMs: number;
  private slowSamples = 0;
  private recoverySamples = 0;
  private reason: string | null = null;
  private pauseUntilMs: number | null = null;
  private lastSlowReason: string | null = null;

  constructor(options: PerformanceGuardOptions) {
    this.options = options;
    this.initialBatchSize = Math.max(1, Math.floor(options.initialBatchSize));
    this.initialYieldMs = Math.max(0, Math.floor(options.initialYieldMs));
    this.currentBatchSize = this.initialBatchSize;
    this.currentYieldMs = this.initialYieldMs;
  }

  getState(): PerformanceGuardState {
    this.resumeIfReady();
    return {
      mode: this.mode,
      currentBatchSize: this.currentBatchSize,
      currentYieldMs: this.currentYieldMs,
      reason: this.reason,
      pauseUntilMs: this.pauseUntilMs,
      remainingPauseMs: this.getRemainingPauseMs(),
      lastSlowReason: this.lastSlowReason,
    };
  }

  getBatchSize(): number {
    this.resumeIfReady();
    return this.currentBatchSize;
  }

  getYieldMs(): number {
    this.resumeIfReady();
    return this.currentYieldMs;
  }

  resume(): PerformanceGuardState {
    if (this.mode !== 'paused') {
      return this.getState();
    }
    if ((this.pauseUntilMs ?? 0) > Date.now()) {
      return this.getState();
    }

    this.mode = 'throttled';
    this.currentBatchSize = 1;
    this.currentYieldMs = MAX_YIELD_MS;
    this.slowSamples = 0;
    this.recoverySamples = 0;
    this.pauseUntilMs = null;
    this.reason = t('perfGuardResumed');
    return this.getState();
  }

  reset(): PerformanceGuardState {
    this.mode = 'normal';
    this.currentBatchSize = this.initialBatchSize;
    this.currentYieldMs = this.initialYieldMs;
    this.slowSamples = 0;
    this.recoverySamples = 0;
    this.reason = null;
    this.pauseUntilMs = null;
    this.lastSlowReason = null;
    return this.getState();
  }

  recordEventLoopLag(lagMs: number): PerformanceGuardState {
    return this.recordSample(
      lagMs > this.options.slowEventLoopThresholdMs,
      t('perfEventLoopLag', { ms: Math.round(lagMs) }),
    );
  }

  recordBatchDuration(durationMs: number): PerformanceGuardState {
    return this.recordSample(
      durationMs > this.options.slowBatchThresholdMs,
      t('perfIndexingBatch', { ms: Math.round(durationMs) }),
    );
  }

  async measureEventLoopLag(): Promise<number> {
    if (!this.options.enabled) return 0;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const lagMs = Math.max(0, performance.now() - startedAt);
    this.recordEventLoopLag(lagMs);
    return lagMs;
  }

  private recordSample(isSlow: boolean, reason: string): PerformanceGuardState {
    if (!this.options.enabled) {
      return this.getState();
    }

    if (isSlow) {
      this.slowSamples++;
      this.recoverySamples = 0;
      if (this.slowSamples >= PAUSE_SAMPLE_LIMIT) {
        this.pause(reason);
      } else if (this.slowSamples >= SLOW_SAMPLE_LIMIT) {
        this.throttle(reason);
      }
      return this.getState();
    }

    this.recoverySamples++;
    if (this.recoverySamples >= RECOVERY_SAMPLE_LIMIT) {
      this.reset();
    }
    return this.getState();
  }

  private throttle(reason: string): void {
    if (this.mode === 'paused') return;
    this.mode = 'throttled';
    this.currentBatchSize = Math.max(1, Math.floor(this.currentBatchSize / 2));
    this.currentYieldMs = Math.min(
      MAX_YIELD_MS,
      Math.max(this.initialYieldMs * 2, this.currentYieldMs * 2),
    );
    this.reason = t('perfSlowDetected', { reason });
  }

  private pause(reason: string): void {
    this.mode = 'paused';
    this.currentBatchSize = 1;
    this.currentYieldMs = MAX_YIELD_MS;
    this.pauseUntilMs = Date.now() + DEFAULT_PAUSE_MS;
    this.lastSlowReason = reason;
    this.reason = t('perfPausedWithReason', { reason });
  }

  private resumeIfReady(): void {
    if (this.mode === 'paused' && (this.pauseUntilMs ?? 0) <= Date.now()) {
      this.resume();
    }
  }

  private getRemainingPauseMs(): number | null {
    if (this.mode !== 'paused' || this.pauseUntilMs === null) return null;
    return Math.max(0, this.pauseUntilMs - Date.now());
  }
}
