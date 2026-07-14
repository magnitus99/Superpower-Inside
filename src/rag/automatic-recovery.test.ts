import { describe, expect, it, vi } from 'vitest';
import {
  AutomaticRagRecoveryCoordinator,
  type AutomaticRagRecoveryHost,
  type AutomaticRagRecoveryTimer,
} from './automatic-recovery';

const FILES = [
  { path: 'notes/alpha.md', mtime: 100, size: 10 },
  { path: 'notes/beta.md', mtime: 200, size: 20 },
] as const;

describe('AutomaticRagRecoveryCoordinator', () => {
  it('quietly schedules first-use recovery and records completion only after coverage is healthy', async () => {
    const fixture = createFixture();
    await fixture.coordinator.start();

    expect(fixture.timer.delays).toEqual([2_000]);
    expect(fixture.host.runPending).not.toHaveBeenCalled();

    await fixture.timer.runNext();

    expect(fixture.host.runPending).toHaveBeenCalledTimes(1);
    expect(fixture.host.waitForIdle).toHaveBeenCalledTimes(1);
    expect(fixture.host.countPendingDocuments).toHaveBeenCalledTimes(2);
    expect(fixture.host.writeCompletedFingerprint).toHaveBeenCalledTimes(1);
    expect(fixture.events).toEqual(['scheduled', 'started', 'completed']);
  });

  it('does not schedule work when the completed fingerprint matches the current vault', async () => {
    const first = createFixture();
    await first.coordinator.start();
    await first.timer.runNext();
    const completedFingerprint = first.host.writeCompletedFingerprint.mock.calls[0]?.[0];
    expect(completedFingerprint).toBeTypeOf('string');

    const second = createFixture({ completedFingerprint });
    await second.coordinator.start();
    await second.timer.runNext();

    expect(second.timer.delays).toEqual([2_000]);
    expect(second.host.runPending).not.toHaveBeenCalled();
    expect(second.events).toEqual(['scheduled', 'current']);
  });

  it('repairs missing coverage even when a completion marker still matches', async () => {
    const first = createFixture();
    await first.coordinator.start();
    await first.timer.runNext();
    const completedFingerprint = first.host.writeCompletedFingerprint.mock.calls[0]?.[0];

    const damaged = createFixture({ completedFingerprint, pendingCounts: [1, 0] });
    await damaged.coordinator.start();

    expect(damaged.timer.delays).toEqual([2_000]);
    await damaged.timer.runNext();
    expect(damaged.host.runPending).toHaveBeenCalledTimes(1);
    expect(damaged.host.writeCompletedFingerprint).toHaveBeenCalledTimes(1);
  });

  it('keeps partial progress unmarked and retries with Rust-planned backoff', async () => {
    const fixture = createFixture({ pendingCounts: [2, 1, 1, 0] });
    await fixture.coordinator.start();
    await fixture.timer.runNext();

    expect(fixture.host.writeCompletedFingerprint).not.toHaveBeenCalled();
    expect(fixture.timer.delays).toEqual([2_000, 30_000]);
    expect(fixture.events).toEqual(['scheduled', 'started', 'progressed', 'scheduled']);

    await fixture.timer.runNext();

    expect(fixture.host.runPending).toHaveBeenCalledTimes(2);
    expect(fixture.host.writeCompletedFingerprint).toHaveBeenCalledTimes(1);
    expect(fixture.events.at(-1)).toBe('completed');
  });

  it('stops retrying in-session when bounded batches make no coverage progress', async () => {
    const fixture = createFixture({ pendingCounts: [1, 1, 1, 1, 1, 1] });
    await fixture.coordinator.start();
    await fixture.timer.runNext();
    await fixture.timer.runNext();
    await fixture.timer.runNext();

    expect(fixture.host.runPending).toHaveBeenCalledTimes(3);
    expect(fixture.timer.delays).toEqual([2_000, 30_000, 120_000]);
    expect(fixture.events.at(-1)).toBe('exhausted');
  });

  it('cancels scheduled recovery when the RAG runtime is disposed', async () => {
    const fixture = createFixture();
    await fixture.coordinator.start();

    fixture.coordinator.dispose();
    await fixture.timer.runNext();

    expect(fixture.host.runPending).not.toHaveBeenCalled();
    expect(fixture.timer.cancelled).toEqual([1]);
  });

  it('suspends and resumes safely while a RAG runtime is being replaced', async () => {
    const fixture = createFixture();
    await fixture.coordinator.start();

    fixture.coordinator.suspend();
    fixture.coordinator.resume();
    await fixture.timer.runNext();

    expect(fixture.timer.cancelled).toEqual([1]);
    expect(fixture.timer.delays).toEqual([2_000, 2_000]);
    expect(fixture.host.runPending).toHaveBeenCalledTimes(1);
  });
});

interface FixtureOptions {
  completedFingerprint?: string;
  pendingCounts?: number[];
}

function createFixture(options: FixtureOptions = {}) {
  const timer = new ManualTimer();
  const events: string[] = [];
  const pendingCounts = [...(options.pendingCounts ?? [0])];
  const host = {
    listCandidateFiles: vi.fn<() => Promise<typeof FILES>>().mockResolvedValue(FILES),
    readCompletedFingerprint: vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValue(options.completedFingerprint),
    writeCompletedFingerprint: vi
      .fn<(fingerprint: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    runPending: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForIdle: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    countPendingDocuments: vi
      .fn()
      .mockImplementation(() => Promise.resolve(pendingCounts.shift() ?? 0)),
    runHealthyMaintenance: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    timer,
    onEvent: (event: string) => events.push(event),
  } satisfies AutomaticRagRecoveryHost;
  return {
    coordinator: new AutomaticRagRecoveryCoordinator(host),
    host,
    timer,
    events,
  };
}

class ManualTimer implements AutomaticRagRecoveryTimer {
  readonly delays: number[] = [];
  readonly cancelled: number[] = [];
  private nextId = 1;
  private callbacks = new Map<number, () => void>();

  schedule(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.delays.push(delayMs);
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(timerId: number): void {
    this.cancelled.push(timerId);
    this.callbacks.delete(timerId);
  }

  async runNext(): Promise<void> {
    const next = this.callbacks.entries().next().value;
    if (!next) return;
    this.callbacks.delete(next[0]);
    next[1]();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
