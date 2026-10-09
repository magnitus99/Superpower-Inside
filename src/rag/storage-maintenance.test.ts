import { describe, expect, it, vi } from 'vitest';
import { runRagStorageMaintenance, type RagStorageMaintenanceHost } from './storage-maintenance';

const FILES = [
  { path: 'notes/a.md', mtime: 100, size: 10 },
  { path: 'notes/b.md', mtime: 200, size: 20 },
] as const;

describe('RAG storage maintenance', () => {
  it('keeps time-based cache retention current without repeating store reconciliation', async () => {
    const fixture = await createFixture({ maintenanceFingerprintCurrent: true });

    await runRagStorageMaintenance(fixture.host, fixture.fingerprint, false, () => false);

    expect(fixture.order).toEqual(['prune-cache', 'reconcile-bm25']);
  });

  it('reconciles against every valid RAG path, including files outside quiet recovery', async () => {
    const fixture = await createFixture({
      validFilePaths: [...FILES.map((file) => file.path), 'notes/explicit-large.md'],
    });

    await runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false);

    const input = fixture.host.reconcileActiveStoreBatch.mock.calls[0]?.[0];
    expect(input?.candidateFilePaths).toContain('notes/explicit-large.md');
  });

  it('never reconciles or deletes generations before the recovery health gate passes', async () => {
    const fixture = await createFixture({ pendingCounts: [1] });

    await expect(
      runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false),
    ).rejects.toThrow('health gate');
    expect(fixture.host.reconcileActiveStoreBatch).not.toHaveBeenCalled();
  });

  it('지원 종료 데이터는 자동 삭제하지 않고 현행 인덱스만 유지보수한다', async () => {
    const fixture = await createFixture({
      reconciliationComplete: [false, true],
    });

    await runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false);

    expect(fixture.order).toEqual([
      'reconcile',
      'yield',
      'reconcile',
      'prune-cache',
      'reconcile-bm25',
      'complete',
    ]);
  });

  it('does not delete a generation or record completion when the vault changes mid-run', async () => {
    const fixture = await createFixture({
      fileSnapshots: [FILES, [{ path: 'notes/a.md', mtime: 101, size: 11 }]],
    });

    await expect(
      runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false),
    ).rejects.toThrow('health changed');
    expect(fixture.host.writeMaintenanceFingerprint).not.toHaveBeenCalled();
  });

  it('cancels between bounded batches without deleting generations', async () => {
    let cancelled = false;
    const fixture = await createFixture({ reconciliationComplete: [false, true] });
    fixture.host.yieldToHost.mockImplementation(() => {
      cancelled = true;
      return Promise.resolve();
    });

    await expect(
      runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => cancelled),
    ).rejects.toThrow('cancelled');
  });
});

interface FixtureOptions {
  pendingCounts?: number[];
  reconciliationComplete?: boolean[];
  fileSnapshots?: Array<readonly { path: string; mtime: number; size: number }[]>;
  maintenanceFingerprintCurrent?: boolean;
  validFilePaths?: string[];
}

async function createFixture(options: FixtureOptions = {}) {
  const order: string[] = [];
  const pendingCounts = [...(options.pendingCounts ?? [0])];
  const reconciliation = [...(options.reconciliationComplete ?? [true])];
  const snapshots = [...(options.fileSnapshots ?? [FILES])];
  const { planRagAutomaticRecoveryRust } = await import('./rust-core');
  const fingerprint = planRagAutomaticRecoveryRust(FILES, '', 0, 0)?.fingerprint ?? '';
  const host = {
    listCandidateFiles: vi.fn(() => Promise.resolve(snapshots.shift() ?? FILES)),
    listValidFilePaths: vi.fn(() =>
      Promise.resolve(options.validFilePaths ?? FILES.map((file) => file.path)),
    ),
    readRecoveryFingerprint: vi.fn(() => Promise.resolve(fingerprint)),
    countPendingDocuments: vi.fn(() => Promise.resolve(pendingCounts.shift() ?? 0)),
    probeActiveStore: vi.fn(() =>
      Promise.resolve({ queryable: true, embeddingContractMatches: true, dimension: 2 }),
    ),
    readMaintenanceFingerprint: vi.fn(() =>
      Promise.resolve(options.maintenanceFingerprintCurrent ? fingerprint : undefined),
    ),
    writeMaintenanceFingerprint: vi.fn(() => {
      order.push('complete');
      return Promise.resolve();
    }),
    reconcileActiveStoreBatch: vi.fn<RagStorageMaintenanceHost['reconcileActiveStoreBatch']>(() => {
      order.push('reconcile');
      return Promise.resolve({ complete: reconciliation.shift() ?? true });
    }),
    pruneEmbeddingCacheBatch: vi.fn(() => {
      order.push('prune-cache');
      return Promise.resolve({ remainingWork: false });
    }),
    reconcileBm25SourceBatch: vi.fn(() => {
      order.push('reconcile-bm25');
      return Promise.resolve({ remainingWork: false });
    }),
    yieldToHost: vi.fn(() => {
      order.push('yield');
      return Promise.resolve();
    }),
  } satisfies RagStorageMaintenanceHost;
  return { host, order, fingerprint };
}
