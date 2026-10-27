import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForRetrievalReady } from './retrieval-wait';
import type { ChatRetrievalReadiness } from './chat-readiness';

describe('검색 준비 대기 수명 주기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('실제 ready 전환에 한 번만 완료하고 timer를 해제한다', async () => {
    let readiness: ChatRetrievalReadiness = 'preparing';
    const ready = vi.fn(() => readiness);
    const done = vi.fn();
    const pending = waitForRetrievalReady({
      signal: new AbortController().signal,
      getReadiness: ready,
      isCurrent: () => true,
    }).then(done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).not.toHaveBeenCalled();
    readiness = 'ready';
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(done).toHaveBeenCalledExactlyOnceWith('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['취소', '이전 실행'] as const)(
    '%s 이후 늦은 ready는 실행을 재개하지 않는다',
    async (reason) => {
      const controller = new AbortController();
      let current = true;
      const pending = waitForRetrievalReady({
        signal: controller.signal,
        getReadiness: () => 'preparing',
        isCurrent: () => current,
      });
      const result =
        reason === '취소'
          ? expect(pending).rejects.toMatchObject({ name: 'AbortError' })
          : expect(pending).resolves.toBe('changed');
      if (reason === '취소') controller.abort();
      else current = false;
      await vi.advanceTimersByTimeAsync(500);
      await result;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('이미 취소된 실행은 readiness를 읽지도 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    const ready = vi.fn(() => 'ready' as const);
    await expect(
      waitForRetrievalReady({
        signal: controller.signal,
        getReadiness: ready,
        isCurrent: () => true,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(ready).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('영구 실패와 장시간 준비는 성공으로 바꾸거나 무한 재시도하지 않는다', async () => {
    let readiness: ChatRetrievalReadiness = 'preparing';
    const options = {
      signal: new AbortController().signal,
      getReadiness: () => readiness,
      isCurrent: () => true,
    };
    const failed = waitForRetrievalReady(options);
    readiness = 'degraded';
    await vi.advanceTimersByTimeAsync(500);
    await expect(failed).resolves.toBe('unavailable');
    readiness = 'preparing';
    const timeout = waitForRetrievalReady(options);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await expect(timeout).resolves.toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('readiness 읽기 실패도 timer와 abort listener를 해제한다', async () => {
    const signal = new AbortController().signal;
    const remove = vi.spyOn(signal, 'removeEventListener');
    await expect(
      waitForRetrievalReady({
        signal,
        getReadiness: () => {
          throw new Error('synthetic readiness failure');
        },
        isCurrent: () => true,
      }),
    ).rejects.toThrow('synthetic readiness failure');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
