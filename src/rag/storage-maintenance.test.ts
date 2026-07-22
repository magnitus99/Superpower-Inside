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

    expect(fixture.order).toEqual([
      'prune-cache',
      'reconcile-bm25',
      'maintain-graph',
      'cleanup-inactive',
    ]);
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
    expect(fixture.host.cleanupStaleGenerationBatch).not.toHaveBeenCalled();
    expect(fixture.host.cleanupLegacyFileArtifacts).not.toHaveBeenCalled();
  });

  it('runs reconciliation before bounded stale generation cleanup and records completion last', async () => {
    const fixture = await createFixture({
      reconciliationComplete: [false, true],
      cleanupResults: [cleanupResult(['stale-v3'], 1), cleanupResult([], 0)],
    });

    await runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false);

    expect(fixture.order).toEqual([
      'reconcile',
      'yield',
      'reconcile',
      'prune-cache',
      'reconcile-bm25',
      'maintain-graph',
      'cleanup-inactive',
      'cleanup',
      'yield',
      'cleanup',
      'cleanup-files',
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
    expect(fixture.host.cleanupStaleGenerationBatch).not.toHaveBeenCalled();
    expect(fixture.host.writeMaintenanceFingerprint).not.toHaveBeenCalled();
  });

  it('leaves blocked deletion unfinished so a later run can retry', async () => {
    const blocked = cleanupResult([], 0, ['stale-v3']);
    const fixture = await createFixture({ cleanupResults: [blocked] });

    await expect(
      runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false),
    ).rejects.toThrow('blocked');
    expect(fixture.host.writeMaintenanceFingerprint).not.toHaveBeenCalled();
  });

  it('does not record completion when legacy file cleanup is incomplete', async () => {
    const fixture = await createFixture();
    fixture.host.cleanupLegacyFileArtifacts.mockResolvedValue({
      failedPaths: ['.superpower-inside/vectors.json'],
      remainingDeleteCount: 0,
    });

    await expect(
      runRagStorageMaintenance(fixture.host, fixture.fingerprint, true, () => false),
    ).rejects.toThrow('Legacy plugin file cleanup');
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
    expect(fixture.host.cleanupStaleGenerationBatch).not.toHaveBeenCalled();
  });
});

interface FixtureOptions {
  pendingCounts?: number[];
  reconciliationComplete?: boolean[];
  cleanupResults?: ReturnType<typeof cleanupResult>[];
  fileSnapshots?: Array<readonly { path: string; mtime: number; size: number }[]>;
  maintenanceFingerprintCurrent?: boolean;
  validFilePaths?: string[];
}

async function createFixture(options: FixtureOptions = {}) {
  const order: string[] = [];
  const pendingCounts = [...(options.pendingCounts ?? [0])];
  const reconciliation = [...(options.reconciliationComplete ?? [true])];
  const cleanup = [...(options.cleanupResults ?? [cleanupResult([], 0)])];
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
    maintainGraphStorageBatch: vi.fn(() => {
      order.push('maintain-graph');
      return Promise.resolve({ remainingWork: false });
    }),
    cleanupStaleGenerationBatch: vi.fn(() => {
      order.push('cleanup');
      return Promise.resolve(cleanup.shift() ?? cleanupResult([], 0));
    }),
    cleanupInactiveVaultDatabaseBatch: vi.fn(() => {
      order.push('cleanup-inactive');
      return Promise.resolve(cleanupResult([], 0));
    }),
    cleanupLegacyFileArtifacts: vi.fn<RagStorageMaintenanceHost['cleanupLegacyFileArtifacts']>(
      () => {
        order.push('cleanup-files');
        return Promise.resolve({ failedPaths: [], remainingDeleteCount: 0 });
      },
    ),
    yieldToHost: vi.fn(() => {
      order.push('yield');
      return Promise.resolve();
    }),
  } satisfies RagStorageMaintenanceHost;
  return { host, order, fingerprint };
}

function cleanupResult(
  deletedNames: string[],
  remainingDeleteCount: number,
  blockedNames: string[] = [],
) {
  return { deletedNames, blockedNames, failedNames: [], remainingDeleteCount };
}
