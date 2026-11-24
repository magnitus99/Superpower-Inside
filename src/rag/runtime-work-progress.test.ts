import { describe, expect, it, vi } from 'vitest';
import type { RustRagRuntimeWorkEtaInput, RustRagRuntimeWorkEtaPlan } from './rust-core';
const plan = vi.hoisted(() => vi.fn<(input: RustRagRuntimeWorkEtaInput) => RustRagRuntimeWorkEtaPlan | null>(() => null));
vi.mock('./rust-core', () => ({ planRagRuntimeWorkEtaRust: plan }));
import { RagRuntimeWorkTracker } from './runtime-work-progress';

describe('runtime work observation', () => {
  it('heartbeat는 실제 진척 표본을 만들지 않고 단계·재실행 경계를 분리한다', () => {
    let now = 0.25;
    const tracker = new RagRuntimeWorkTracker(() => now);
    tracker.observe('restoring-keyword-documents', 'documents', 0, 135835);
    now = 1000.75;
    tracker.observe('restoring-keyword-documents', 'documents', 128, 135835);
    now = 2000.75;
    tracker.snapshot();
    tracker.observe('restoring-keyword-documents', 'documents', 128, 135835);
    tracker.snapshot();
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ startedAtMs: 0.25, nowMs: 2000.75,
      samples: [{ atMs: 0.25, units: 0 }, { atMs: 1000.75, units: 128 }] }));
    tracker.observe('publishing');
    tracker.snapshot();
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ processedUnits: null, totalUnits: null, samples: [] }));
    tracker.clear();
    expect(tracker.snapshot()).toBeNull();
  });
  it('unknown total은 처리량과 같게 만들지 않으며 새 작업은 오래된 표본을 쓰지 않는다', () => {
    let now = 1;
    const tracker = new RagRuntimeWorkTracker(() => now);
    tracker.observe('restoring-keyword-documents', 'documents', 128);
    expect(tracker.snapshot()).toMatchObject({ processedUnits: 128, totalUnits: null, remainingMs: null, etaReason: 'native-unavailable' });
    now++;
    tracker.observe('restoring-keyword-documents', 'documents', 0, 135835);
    tracker.snapshot();
    expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ startedAtMs: 2, samples: [{ atMs: 2, units: 0 }] }));
  });
  it('관측 window는 64개에 제한한다', () => {
    let now = 0;
    const tracker = new RagRuntimeWorkTracker(() => now);
    for (let i = 0; i < 100; i++) { now++; tracker.observe('verifying', 'files', i, 100); }
    tracker.snapshot();
    expect(plan.mock.lastCall?.[0].samples).toHaveLength(64);
  });
});

it('Rust의 초기 low 단계 ETA와 소수 경과를 그대로 게시하고 전체 시간으로 복사하지 않는다', () => {
  const tracker = new RagRuntimeWorkTracker(() => 1000.75);
  tracker.observe('restoring-keyword-documents', 'documents', 128, 135835);
  plan.mockReturnValueOnce({ elapsedMs: 1000.5, lastProgressAgeMs: 0, remainingMs: 1000000, ratePerSecond: 127.5, confidence: 'low', etaReason: 'observed-rate' });
  expect(tracker.snapshot()).toMatchObject({ processedUnits: 128, totalUnits: 135835, elapsedMs: 1000.5, remainingMs: 1000000, ratePerSecond: 127.5, confidence: 'low' });
});

it('서로 비용이 다른 asset read·graph init step은 처리율로 외삽하지 않는다', () => {
  let now = 1;
  const tracker = new RagRuntimeWorkTracker(() => now);
  tracker.observe('loading-model', 'steps', 0, 4);
  now = 100;
  tracker.observe('loading-model', 'steps', 1, 4);
  now = 200;
  tracker.observe('loading-model', 'steps', 2, 4);
  tracker.snapshot();
  expect(plan).toHaveBeenLastCalledWith(expect.objectContaining({ startedAtMs: 1, samples: [{ atMs: 200, units: 2 }] }));
});
