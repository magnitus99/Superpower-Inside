import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceGuard } from './performance-guard';

describe('PerformanceGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('이벤트 루프 지연이 연속 임계치를 넘으면 배치 크기를 낮춰 throttled 상태가 된다', () => {
    const guard = new PerformanceGuard({
      enabled: true,
      initialBatchSize: 32,
      initialYieldMs: 25,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });

    guard.recordEventLoopLag(180);
    guard.recordEventLoopLag(190);
    guard.recordEventLoopLag(200);

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 16,
        currentYieldMs: 50,
      }),
    );
  });

  it('느린 샘플이 반복되면 cooldown 종료 시각이 있는 paused 상태가 된다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T00:00:00.000Z'));
    const guard = new PerformanceGuard({
      enabled: true,
      initialBatchSize: 8,
      initialYieldMs: 25,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });

    for (let i = 0; i < 6; i++) {
      guard.recordBatchDuration(3500);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'paused',
        currentBatchSize: 1,
        currentYieldMs: 500,
        pauseUntilMs: Date.now() + 30_000,
        remainingPauseMs: 30_000,
        lastSlowReason: '인덱싱 배치 3500ms',
      }),
    );
  });

  it('cooldown이 끝나면 최소 배치로 재개할 수 있다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T00:00:00.000Z'));
    const guard = new PerformanceGuard({
      enabled: true,
      initialBatchSize: 8,
      initialYieldMs: 25,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });

    for (let i = 0; i < 6; i++) {
      guard.recordBatchDuration(3500);
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

  it('정상 샘플이 이어지면 완화 상태를 회복한다', () => {
    const guard = new PerformanceGuard({
      enabled: true,
      initialBatchSize: 16,
      initialYieldMs: 25,
      slowEventLoopThresholdMs: 150,
      slowBatchThresholdMs: 3000,
    });

    guard.recordBatchDuration(3500);
    guard.recordBatchDuration(3600);
    guard.recordBatchDuration(3700);
    expect(guard.getState().mode).toBe('throttled');

    guard.recordBatchDuration(100);
    guard.recordBatchDuration(100);
    guard.recordBatchDuration(100);

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 16,
        currentYieldMs: 25,
      }),
    );
  });
});
