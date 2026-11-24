import type { EmbeddingInferenceSample } from './embedding';
import {
  planLocalRagAdmissionRust,
  type RustLocalRagAdmissionInput,
  type RustLocalRagAdmissionPlan,
  type RustLocalRagAdmissionState,
} from '../rag/rust-core';

export interface LocalAdmissionSource {
  sourceBudgetBytes: number;
  reservedSourceBytes: number;
  plannedSourceBytes: number;
}
export interface LocalAdmissionCounts {
  foregroundPending: number;
  physicalSourceCount: number;
  physicalInferenceCount: number;
}
export interface LocalEmbeddingAdmissionIO {
  now(): number;
  readMemory(): { rssBytes: number | null; availableBytes: number | null };
  // 실제 timer drift만 관측한다. 미지원은 null 표본이며 설정/정책용 timer가 아니다.
  setTimer?: (callback: () => void) => () => void;
}
interface PhysicalRoundtrip {
  startedAtMs: number;
  workUnits: number;
  backend: 'cpu' | 'webgpu' | null;
  lagMs: number | null;
  cancelTimer?: () => void;
}
const defaultIO: LocalEmbeddingAdmissionIO = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  readMemory: () => {
    // heap/deviceMemory/weights는 RSS나 가용 메모리의 대용값이 아니다.
    const host = (
      globalThis as {
        process?: { memoryUsage?: () => { rss?: number }; availableMemory?: () => number };
      }
    ).process;
    let rssBytes: number | null = null;
    let availableBytes: number | null = null;
    try {
      rssBytes = host?.memoryUsage?.().rss ?? null;
    } catch {
      /* 미지원 */
    }
    try {
      availableBytes = host?.availableMemory?.() ?? null;
    } catch {
      /* 미지원 */
    }
    return { rssBytes, availableBytes };
  },
  setTimer:
    typeof globalThis.setTimeout === 'function' && typeof globalThis.clearTimeout === 'function'
      ? (callback) => {
          const timer = globalThis.setTimeout(callback, 0);
          return () => globalThis.clearTimeout(timer);
        }
      : undefined,
};

/** owner의 물리 worker 하나에만 속한다. 계산·상한 증감·예산 판정은 전부 Rust가 소유한다. */
export class LocalEmbeddingAdmission {
  private state: RustLocalRagAdmissionState | null = null;
  private sample: RustLocalRagAdmissionInput['sample'] = null;
  private active: PhysicalRoundtrip | null = null;
  private closed = false;

  constructor(
    private readonly io: LocalEmbeddingAdmissionIO = defaultIO,
    private backend: 'cpu' | 'webgpu' | null = 'cpu',
    private maxBatchSize = 32,
  ) {}

  setBackend(backend: 'cpu' | 'webgpu', maxBatchSize: number): void {
    if (this.closed) return;
    if (backend !== this.backend) this.sample = null;
    this.backend = backend;
    this.maxBatchSize = maxBatchSize;
    // 이전 state/maxBatchSize는 그대로 왕복해야 Rust가 backend/상한 축소를 감지한다.
  }

  now(): number {
    try {
      return this.io.now();
    } catch {
      return NaN;
    } // Rust가 손상 시각을 거절한다. 가짜 유한 시각을 만들지 않는다.
  }

  readMemory(): ReturnType<LocalEmbeddingAdmissionIO['readMemory']> {
    try {
      return this.io.readMemory();
    } catch {
      return { rssBytes: null, availableBytes: null };
    }
  }

  begin(workUnits: number): PhysicalRoundtrip {
    const span: PhysicalRoundtrip = {
      startedAtMs: this.now(),
      workUnits,
      backend: this.backend,
      lagMs: null,
    };
    this.active = span;
    try {
      span.cancelTimer = this.io.setTimer?.(() => {
        if (!this.closed && this.active === span) span.lagMs = this.now() - span.startedAtMs;
      });
    } catch {
      /* 지원되지 않는 timer는 null이다. */
    }
    return span;
  }

  finish(
    span: PhysicalRoundtrip,
    successful: boolean,
    endedAtMs = this.now(),
  ): EmbeddingInferenceSample | undefined {
    if (this.closed || this.active !== span) return;
    this.active = null;
    try {
      span.cancelTimer?.();
    } catch {
      /* 관측자 정리가 물리 정착을 막지 않는다. */
    }
    this.sample = null;
    if (!successful || span.backend !== this.backend) return;
    const memory = this.readMemory();
    // post→ACK wall span이다. CPU 시간/lookup·cache commit/queued wait가 아니다.
    this.sample = {
      endedAtMs,
      workUnits: span.workUnits,
      durationMs: endedAtMs - span.startedAtMs,
      lagMs: span.lagMs,
      ...memory,
    };
    // 공개용 복사에는 admission 상태·건강·메모리를 노출하지 않는다.
    const { durationMs, workUnits } = this.sample;
    if (
      span.backend === null ||
      !Number.isFinite(endedAtMs) ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      typeof workUnits !== 'number' ||
      !Number.isSafeInteger(workUnits) ||
      workUnits <= 0
    ) {
      return;
    }
    return Object.freeze({ backend: span.backend, workUnits, durationMs, endedAtMs });
  }

  plan(
    source: LocalAdmissionSource,
    counts: LocalAdmissionCounts,
  ): RustLocalRagAdmissionPlan | null {
    if (this.closed || this.backend === null) return null;
    try {
      const plan = planLocalRagAdmissionRust({
        backend: this.backend,
        maxBatchSize: this.maxBatchSize,
        // 기존 host performance guard의 기본 응답성 한도를 입력한다. 판정은 Rust만 한다.
        targetBatchMs: 3000,
        maxLagMs: 150,
        nowMs: this.now(),
        ...source,
        ...counts,
        state: this.state,
        sample: this.sample,
      });
      if (plan) this.state = plan.state;
      return plan;
    } catch {
      return null;
    } // Rust 불가/실패 때 TS 수치 정책으로 대체하지 않는다.
  }

  close(): void {
    this.closed = true;
    try {
      this.active?.cancelTimer?.();
    } catch {
      /* 관측 정리만 한다. */
    }
    this.active = null;
    this.sample = null;
    this.state = null;
  }
}
