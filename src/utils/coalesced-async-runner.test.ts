import { describe, expect, it, vi } from 'vitest';
import { CoalescedAsyncRunner } from './coalesced-async-runner';

describe('CoalescedAsyncRunner', () => {
  it('shares one in-flight initialization without scheduling a trailing duplicate', async () => {
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
    await Promise.all([first, second, third]);

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
