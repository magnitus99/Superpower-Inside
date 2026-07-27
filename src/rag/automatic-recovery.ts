import {
  planRagAutomaticRecoveryBatchRust,
  planRagAutomaticRecoveryRust,
  ragAutomaticRecoveryDelayMsRust,
  type RustRagAutomaticRecoveryFileInput,
} from './rust-core';

export const AUTOMATIC_RAG_RECOVERY_COMPLETION_KEY =
  'rag-automatic-recovery:v1:completed-fingerprint';

export type AutomaticRagRecoveryEvent =
  | 'scheduled'
  | 'started'
  | 'completed'
  | 'progressed'
  | 'retrying'
  | 'current'
  | 'exhausted';

export interface AutomaticRagRecoveryTimer {
  schedule(callback: () => void, delayMs: number): number;
  cancel(timerId: number): void;
}

export interface AutomaticRagRecoveryHost {
  listCandidateFiles(): Promise<readonly RustRagAutomaticRecoveryFileInput[]>;
  readCompletedFingerprint(): Promise<string | undefined>;
  writeCompletedFingerprint(fingerprint: string): Promise<void>;
  runPending(): Promise<void>;
  waitForIdle(): Promise<void>;
  countPendingDocuments(): Promise<number>;
  runHealthyMaintenance(
    fingerprint: string,
    force: boolean,
    isCancelled: () => boolean,
  ): Promise<void>;
  timer: AutomaticRagRecoveryTimer;
  onEvent?(event: AutomaticRagRecoveryEvent, detail?: unknown): void;
}

/** Coordinates idle, incremental recovery while Rust owns every scheduling decision. */
export class AutomaticRagRecoveryCoordinator {
  private attempt = 0;
  private timerId: number | null = null;
  private disposed = false;
  private suspended = false;
  private running = false;

  constructor(private readonly host: AutomaticRagRecoveryHost) {}

  start(): Promise<void> {
    if (this.disposed || this.suspended || this.running || this.timerId !== null) {
      return Promise.resolve();
    }
    this.scheduleEvaluation();
    return Promise.resolve();
  }

  suspend(): void {
    if (this.disposed) return;
    this.suspended = true;
    this.clearTimer();
  }

  resume(): void {
    if (this.disposed || !this.suspended) return;
    this.suspended = false;
    void this.start().catch((error: unknown) => this.host.onEvent?.('exhausted', error));
  }

  dispose(): void {
    this.disposed = true;
    this.suspended = false;
    this.clearTimer();
  }

  private scheduleEvaluation(): void {
    if (this.disposed || this.suspended) return;
    const delayMs = ragAutomaticRecoveryDelayMsRust(this.attempt);
    if (!delayMs) {
      this.host.onEvent?.('exhausted');
      return;
    }
    this.timerId = this.host.timer.schedule(() => {
      this.timerId = null;
      void this.evaluateAndRecover().catch((error: unknown) => this.retryAfterFailure(error));
    }, delayMs);
    this.host.onEvent?.('scheduled', delayMs);
  }

  private async evaluateAndRecover(): Promise<void> {
    if (this.disposed || this.suspended) return;
    try {
      const [files, completedFingerprint, pendingDocumentCount] = await Promise.all([
        this.host.listCandidateFiles(),
        this.host.readCompletedFingerprint(),
        this.host.countPendingDocuments(),
      ]);
      if (this.disposed || this.suspended) return;
      const plan = planRagAutomaticRecoveryRust(
        files,
        completedFingerprint ?? '',
        this.attempt,
        pendingDocumentCount,
      );
      if (!plan) {
        throw new Error('Rust automatic RAG recovery planning failed');
      }
      if (plan.shouldRecordCompletion) {
        await this.host.writeCompletedFingerprint(plan.fingerprint);
        await this.host.runHealthyMaintenance(plan.fingerprint, true, () => this.isCancelled());
        this.host.onEvent?.('completed');
        return;
      }
      if (!plan.requiresRecovery) {
        if (pendingDocumentCount > 0) {
          this.host.onEvent?.('exhausted', { pendingDocumentCount });
          return;
        }
        await this.host.runHealthyMaintenance(plan.fingerprint, false, () => this.isCancelled());
        this.host.onEvent?.(plan.retryAllowed ? 'current' : 'exhausted');
        return;
      }
      await this.run(plan.fingerprint, pendingDocumentCount);
    } catch (error) {
      this.retryAfterFailure(error);
    }
  }

  private async run(plannedFingerprint: string, pendingBefore: number): Promise<void> {
    if (this.disposed || this.suspended || this.running) return;
    this.running = true;
    this.host.onEvent?.('started');
    try {
      await this.host.runPending();
      await this.host.waitForIdle();
      if (this.disposed || this.suspended) return;
      const pendingCount = await this.host.countPendingDocuments();
      if (pendingCount !== 0) {
        if (pendingCount >= pendingBefore) {
          this.retryAfterFailure(
            new Error(`RAG recovery made no coverage progress (${pendingCount} pending)`),
          );
          return;
        }
        this.attempt = Math.min(this.attempt + 1, 2);
        this.host.onEvent?.('progressed', { pendingDocumentCount: pendingCount });
        this.scheduleEvaluation();
        return;
      }
      const files = await this.host.listCandidateFiles();
      const finalPlan = planRagAutomaticRecoveryRust(files, plannedFingerprint, 0);
      if (!finalPlan || finalPlan.fingerprint !== plannedFingerprint) {
        this.retryAfterFailure(new Error('Vault changed while RAG coverage was recovering'));
        return;
      }
      await this.host.writeCompletedFingerprint(plannedFingerprint);
      await this.host.runHealthyMaintenance(plannedFingerprint, true, () => this.isCancelled());
      this.host.onEvent?.('completed');
    } finally {
      this.running = false;
    }
  }

  private retryAfterFailure(error: unknown): void {
    if (this.disposed || this.suspended) return;
    this.attempt += 1;
    this.host.onEvent?.('retrying', error);
    this.scheduleEvaluation();
  }

  private clearTimer(): void {
    if (this.timerId === null) return;
    this.host.timer.cancel(this.timerId);
    this.timerId = null;
  }

  private isCancelled(): boolean {
    return this.disposed || this.suspended;
  }
}

export function selectAutomaticRecoveryEligibleFiles(
  files: readonly RustRagAutomaticRecoveryFileInput[],
): RustRagAutomaticRecoveryFileInput[] | null {
  const plan = planRagAutomaticRecoveryBatchRust(files);
  if (!plan) return null;
  const eligible = new Set(plan.eligibleIndices);
  return files.filter((_, index) => eligible.has(index));
}

export function createWindowAutomaticRagRecoveryTimer(): AutomaticRagRecoveryTimer {
  return {
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (timerId) => window.clearTimeout(timerId),
  };
}
