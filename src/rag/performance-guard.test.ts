import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceGuard } from './performance-guard';

const OPTIONS = {
  enabled: true,
  initialBatchSize: 32,
  initialYieldMs: 0,
  slowEventLoopThresholdMs: 150,
  slowBatchThresholdMs: 3000,
} as const;

describe('PerformanceGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('느린 요청은 고정 sleep을 추가하지 않고 다음 배치 크기를 자동 축소한다', () => {
    const guard = new PerformanceGuard(OPTIONS);

    guard.recordBatchDuration(6_000, 32);

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 24,
        currentYieldMs: 0,
        pauseUntilMs: null,
      }),
    );
  });

  it('이벤트 루프 압력은 짧은 협력적 양보만 추가하고 인덱싱을 중단하지 않는다', () => {
    const guard = new PerformanceGuard(OPTIONS);

    for (let index = 0; index < 3; index++) {
      guard.recordEventLoopLag(300);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'throttled',
        currentBatchSize: 32,
        currentYieldMs: 150,
        pauseUntilMs: null,
        remainingPauseMs: null,
        lastSlowReason: '이벤트 루프 지연 300ms',
      }),
    );
  });

  it('건강한 요청과 이벤트 루프 샘플에서 배치 크기를 늘리고 대기를 제거한다', () => {
    const guard = new PerformanceGuard(OPTIONS);
    guard.recordBatchDuration(6_000, 32);
    guard.recordEventLoopLag(80);
    expect(guard.getState().mode).toBe('throttled');

    for (let index = 0; index < 20; index++) {
      guard.recordBatchDuration(100, guard.getBatchSize());
      guard.recordEventLoopLag(5);
    }
    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 32,
        currentYieldMs: 0,
      }),
    );
  });

  it('건강한 이벤트 루프 샘플이 협력적 양보를 빠르게 제거한다', () => {
    const guard = new PerformanceGuard(OPTIONS);
    for (let index = 0; index < 3; index++) {
      guard.recordEventLoopLag(300);
    }
    for (let index = 0; index < 8; index++) {
      guard.recordEventLoopLag(5);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 32,
        currentYieldMs: 0,
        pauseUntilMs: null,
      }),
    );
  });

  it('keeps a disabled guard inert', () => {
    const guard = new PerformanceGuard({ ...OPTIONS, enabled: false });
    for (let index = 0; index < 12; index++) {
      guard.recordBatchDuration(10000, 32);
      guard.recordEventLoopLag(10000);
    }

    expect(guard.getState()).toEqual(
      expect.objectContaining({
        mode: 'normal',
        currentBatchSize: 32,
        currentYieldMs: 0,
        pauseUntilMs: null,
      }),
    );
  });

  it('레거시 수동 대기값을 무시하고 자동 제어만 사용한다', () => {
    const guard = new PerformanceGuard({ ...OPTIONS, initialYieldMs: 1_000 });

    guard.recordBatchDuration(5_000, 32);
    expect(guard.getState()).toEqual(
      expect.objectContaining({ mode: 'throttled', currentYieldMs: 0 }),
    );

    for (let index = 0; index < 3; index++) guard.recordEventLoopLag(500);
    expect(guard.getState()).toEqual(
      expect.objectContaining({ mode: 'throttled', currentYieldMs: 250, pauseUntilMs: null }),
    );
  });
});
