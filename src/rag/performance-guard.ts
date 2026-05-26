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
}

const SLOW_SAMPLE_LIMIT = 3;
const PAUSE_SAMPLE_LIMIT = 6;
const RECOVERY_SAMPLE_LIMIT = 3;
const MAX_YIELD_MS = 500;

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

  constructor(options: PerformanceGuardOptions) {
    this.options = options;
    this.initialBatchSize = Math.max(1, Math.floor(options.initialBatchSize));
    this.initialYieldMs = Math.max(0, Math.floor(options.initialYieldMs));
    this.currentBatchSize = this.initialBatchSize;
    this.currentYieldMs = this.initialYieldMs;
  }

  getState(): PerformanceGuardState {
    return {
      mode: this.mode,
      currentBatchSize: this.currentBatchSize,
      currentYieldMs: this.currentYieldMs,
      reason: this.reason,
    };
  }

  getBatchSize(): number {
    return this.currentBatchSize;
  }

  getYieldMs(): number {
    return this.currentYieldMs;
  }

  recordEventLoopLag(lagMs: number): PerformanceGuardState {
    return this.recordSample(
      lagMs > this.options.slowEventLoopThresholdMs,
      `이벤트 루프 지연 ${Math.round(lagMs)}ms`,
    );
  }

  recordBatchDuration(durationMs: number): PerformanceGuardState {
    return this.recordSample(
      durationMs > this.options.slowBatchThresholdMs,
      `인덱싱 배치 ${Math.round(durationMs)}ms`,
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
    this.reason = `느림 감지: ${reason}`;
  }

  private pause(reason: string): void {
    this.mode = 'paused';
    this.currentBatchSize = 1;
    this.currentYieldMs = MAX_YIELD_MS;
    this.reason = `일시정지됨: ${reason}`;
  }

  private reset(): void {
    this.mode = 'normal';
    this.currentBatchSize = this.initialBatchSize;
    this.currentYieldMs = this.initialYieldMs;
    this.slowSamples = 0;
    this.recoverySamples = 0;
    this.reason = null;
  }
}
