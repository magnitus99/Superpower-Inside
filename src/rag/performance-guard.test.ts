import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceGuard } from './performance-guard';

const OPTIONS = {
  enabled: true,
  initialBatchSize: 32,
  initialYieldMs: 25,
  slowEventLoopThresholdMs: 150,
  slowBatchThresholdMs: 3000,
} as const;

describe('PerformanceGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('progressively throttles slow provider batches without pausing the renderer', () => {
    const guard = new PerformanceGuard(OPTIONS);

    for (let index = 0; index < 12; index++) {
      guard.recordBatchDuration(3500);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 2,
        currentYieldMs: 400,
        pauseUntilMs: null,
      }),
    );
  });

  it('pauses only after sustained event-loop pressure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const guard = new PerformanceGuard(OPTIONS);

    for (let index = 0; index < 6; index++) {
      guard.recordEventLoopLag(200);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'paused',
        currentBatchSize: 1,
        currentYieldMs: 500,
        pauseUntilMs: Date.now() + 30_000,
        remainingPauseMs: 30_000,
        lastSlowReason: '이벤트 루프 지연 200ms',
      }),
    );
  });

  it('requires healthy samples from both channels before restoring defaults', () => {
    const guard = new PerformanceGuard(OPTIONS);
    guard.recordBatchDuration(3500);
    guard.recordBatchDuration(3500);
    guard.recordBatchDuration(3500);
    expect(guard.getState().mode).toBe('throttled');

    guard.recordEventLoopLag(10);
    guard.recordEventLoopLag(10);
    guard.recordEventLoopLag(10);
    expect(guard.getState().mode).toBe('throttled');

    guard.recordBatchDuration(100);
    guard.recordBatchDuration(100);
    guard.recordBatchDuration(100);
    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 32,
        currentYieldMs: 25,
      }),
    );
  });

  it('resumes after cooldown in the safest throttled state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const guard = new PerformanceGuard(OPTIONS);
    for (let index = 0; index < 6; index++) {
      guard.recordEventLoopLag(200);
    }
    vi.advanceTimersByTime(30_000);

    expect(guard.resume()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 1,
        currentYieldMs: 500,
        pauseUntilMs: null,
        remainingPauseMs: null,
      }),
    );
  });

  it('force-resumes before cooldown without resetting to full speed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
    const guard = new PerformanceGuard(OPTIONS);
    for (let index = 0; index < 6; index++) {
      guard.recordEventLoopLag(200);
    }

    expect(guard.forceResume()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 1,
        currentYieldMs: 500,
        pauseUntilMs: null,
      }),
    );
  });

  it('keeps a disabled guard inert', () => {
    const guard = new PerformanceGuard({ ...OPTIONS, enabled: false });
    for (let index = 0; index < 12; index++) {
      guard.recordBatchDuration(10000);
      guard.recordEventLoopLag(10000);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 32,
        currentYieldMs: 25,
        pauseUntilMs: null,
      }),
    );
  });

  it('preserves a user-configured yield above the default protection floor', () => {
    const guard = new PerformanceGuard({ ...OPTIONS, initialYieldMs: 1_000 });

    for (let index = 0; index < 3; index++) guard.recordBatchDuration(5_000);
    expect(guard.getState()).toEqual(
      expect.objectContaining({ mode: 'throttled', currentYieldMs: 1_000 }),
    );

    for (let index = 0; index < 6; index++) guard.recordEventLoopLag(500);
    guard.forceResume();
    expect(guard.getState()).toEqual(
      expect.objectContaining({ mode: 'throttled', currentYieldMs: 1_000 }),
    );
  });
});
