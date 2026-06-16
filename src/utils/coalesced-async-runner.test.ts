import { describe, expect, it, vi } from 'vitest';
import { CoalescedAsyncRunner } from './coalesced-async-runner';

describe('CoalescedAsyncRunner', () => {
  it('실행 중 들어온 여러 요청은 현재 실행 뒤 후속 실행 한 번으로 합친다', async () => {
    const releases: Array<() => void> = [];
    const operation = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releases.push(resolve);
        }),
    );
    const runner = new CoalescedAsyncRunner(operation);

    const first = runner.run();
    expect(operation).toHaveBeenCalledTimes(1);

    const second = runner.run();
    const third = runner.run();
    releases[0]?.();
    await Promise.resolve();

    expect(operation).toHaveBeenCalledTimes(2);
    releases[1]?.();
    await Promise.all([first, second, third]);

    expect(operation).toHaveBeenCalledTimes(2);
  });
});
