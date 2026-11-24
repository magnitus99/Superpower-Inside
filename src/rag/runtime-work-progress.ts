import { planRagRuntimeWorkEtaRust } from './rust-core';

export interface RagRuntimeWorkProgress {
  stage: 'opening-storage' | 'restoring-corpus' | 'restoring-keyword-snapshot' | 'restoring-keyword-documents' | 'loading-model' | 'planning' | 'preparing-source' | 'lexical' | 'embedding' | 'saving-vectors' | 'verifying' | 'publishing' | 'waiting' | 'cleanup';
  unit: 'files' | 'documents' | 'bytes' | 'steps';
  processedUnits: number | null;
  totalUnits: number | null;
  elapsedMs: number;
  lastProgressAgeMs: number | null;
  remainingMs: number | null;
  ratePerSecond: number | null;
  confidence: 'calculating' | 'low' | 'medium' | 'high';
  etaReason: string;
}

/** owner 별 실제 진척만 보관하며 heartbeat는 표본을 추가하지 않습니다. */
export class RagRuntimeWorkTracker {
  private phase: { stage: RagRuntimeWorkProgress['stage']; unit: RagRuntimeWorkProgress['unit']; startedAtMs: number; processedUnits: number | null; totalUnits: number | null; samples: { atMs: number; units: number }[] } | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}

  observe(stage: RagRuntimeWorkProgress['stage'], unit: RagRuntimeWorkProgress['unit'] = 'steps', processedUnits: number | null = null, totalUnits: number | null = null): void {
    const atMs = this.now();
    if (!this.phase || this.phase.stage !== stage || this.phase.unit !== unit || (processedUnits !== null && this.phase.processedUnits !== null && processedUnits < this.phase.processedUnits)) {
      this.phase = { stage, unit, startedAtMs: atMs, processedUnits, totalUnits, samples: processedUnits === null ? [] : [{ atMs, units: processedUnits }] };
      return;
    }
    const phase = this.phase;
    if (processedUnits !== null && processedUnits !== phase.processedUnits) {
      // 원자 read·graph init의 서로 다른 step은 같은 비용의 처리율 표본이 아닙니다.
      if (unit === 'steps') phase.samples = [];
      phase.samples.push({ atMs, units: processedUnits });
      // 직전 실제 관측을 보존하는 bounded window입니다.
      if (phase.samples.length > 64) phase.samples.shift();
    }
    phase.processedUnits = processedUnits;
    phase.totalUnits = totalUnits;
  }

  clear(): void { this.phase = null; }

  snapshot(): RagRuntimeWorkProgress | null {
    const phase = this.phase;
    if (!phase) return null;
    const estimate = planRagRuntimeWorkEtaRust({ ...phase, nowMs: this.now() });
    return { stage: phase.stage, unit: phase.unit, processedUnits: phase.processedUnits, totalUnits: phase.totalUnits,
      elapsedMs: estimate?.elapsedMs ?? 0, lastProgressAgeMs: estimate?.lastProgressAgeMs ?? null,
      remainingMs: estimate?.remainingMs ?? null, ratePerSecond: estimate?.ratePerSecond ?? null,
      confidence: estimate?.confidence ?? 'calculating', etaReason: estimate?.etaReason ?? 'native-unavailable' };
  }
}
