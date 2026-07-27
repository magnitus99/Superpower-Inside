import type { RustRagAutomaticRecoveryFileInput } from './rust-core';
import { planRagAutomaticRecoveryRust, planRagStorageHealthRust } from './rust-core';
import type { IndexedDbCleanupResult } from './storage-lifecycle';

export const RAG_STORAGE_MAINTENANCE_COMPLETION_KEY =
  'rag-storage-maintenance:v3:completed-fingerprint';

export interface RagActiveStoreHealth {
  queryable: boolean;
  embeddingContractMatches: boolean;
  dimension: number | null;
}

export interface RagStorageMaintenanceHost {
  listCandidateFiles(): Promise<readonly RustRagAutomaticRecoveryFileInput[]>;
  listValidFilePaths(): Promise<readonly string[]>;
  readRecoveryFingerprint(): Promise<string | undefined>;
  countPendingDocuments(): Promise<number>;
  probeActiveStore(candidateFilePaths: readonly string[]): Promise<RagActiveStoreHealth>;
  readMaintenanceFingerprint(): Promise<string | undefined>;
  writeMaintenanceFingerprint(fingerprint: string): Promise<void>;
  reconcileActiveStoreBatch(input: {
    fingerprint: string;
    candidateFilePaths: readonly string[];
    expectedDimension: number;
  }): Promise<{ complete: boolean }>;
  pruneEmbeddingCacheBatch(): Promise<{ remainingWork: boolean }>;
  reconcileBm25SourceBatch(validFilePaths: readonly string[]): Promise<{ remainingWork: boolean }>;
  maintainGraphStorageBatch(validFilePaths: readonly string[]): Promise<{ remainingWork: boolean }>;
  cleanupStaleGenerationBatch(): Promise<IndexedDbCleanupResult>;
  cleanupInactiveVaultDatabaseBatch(): Promise<IndexedDbCleanupResult>;
  cleanupLegacyFileArtifacts(): Promise<{
    failedPaths: readonly string[];
    remainingDeleteCount: number;
  }>;
  yieldToHost(): Promise<void>;
}

export async function runRagStorageMaintenance(
  host: RagStorageMaintenanceHost,
  expectedFingerprint: string,
  force: boolean,
  isCancelled: () => boolean,
): Promise<void> {
  const initial = await inspectHealth(host, expectedFingerprint, false);
  if (!initial.canReconcile) throw new Error('RAG storage health gate rejected reconciliation');
  const activeStoreAlreadyMaintained =
    !force && (await host.readMaintenanceFingerprint()) === expectedFingerprint;

  if (!activeStoreAlreadyMaintained) {
    while (!isCancelled()) {
      const batch = await host.reconcileActiveStoreBatch({
        fingerprint: expectedFingerprint,
        candidateFilePaths: initial.candidateFilePaths,
        expectedDimension: initial.dimension ?? 1,
      });
      if (batch.complete) break;
      await host.yieldToHost();
    }
    throwIfCancelled(isCancelled);
  }

  while (!isCancelled()) {
    const cacheBatch = await host.pruneEmbeddingCacheBatch();
    if (!cacheBatch.remainingWork) break;
    await host.yieldToHost();
  }
  throwIfCancelled(isCancelled);

  await runBoundedMaintenanceLoop(
    host,
    async () => host.reconcileBm25SourceBatch(await host.listValidFilePaths()),
    isCancelled,
  );
  await runBoundedMaintenanceLoop(
    host,
    async () => host.maintainGraphStorageBatch(await host.listValidFilePaths()),
    isCancelled,
  );

  while (!isCancelled()) {
    const inactiveCleanup = await host.cleanupInactiveVaultDatabaseBatch();
    if (inactiveCleanup.blockedNames.length > 0 || inactiveCleanup.failedNames.length > 0) {
      throw new Error('Inactive vault IndexedDB cleanup was blocked or failed');
    }
    if (inactiveCleanup.remainingDeleteCount === 0 && inactiveCleanup.deletedNames.length === 0) {
      break;
    }
    await host.yieldToHost();
  }
  throwIfCancelled(isCancelled);

  if (activeStoreAlreadyMaintained) return;

  while (!isCancelled()) {
    const health = await inspectHealth(host, expectedFingerprint, true);
    if (!health.canDeleteStaleGenerations) {
      throw new Error('RAG storage health changed before stale generation cleanup');
    }
    const cleanup = await host.cleanupStaleGenerationBatch();
    if (cleanup.blockedNames.length > 0 || cleanup.failedNames.length > 0) {
      throw new Error('Stale IndexedDB generation cleanup was blocked or failed');
    }
    if (cleanup.remainingDeleteCount === 0 && cleanup.deletedNames.length === 0) break;
    await host.yieldToHost();
  }
  throwIfCancelled(isCancelled);

  const legacyCleanup = await host.cleanupLegacyFileArtifacts();
  if (legacyCleanup.failedPaths.length > 0 || legacyCleanup.remainingDeleteCount > 0) {
    throw new Error('Legacy plugin file cleanup was incomplete');
  }
  throwIfCancelled(isCancelled);

  const finalHealth = await inspectHealth(host, expectedFingerprint, true);
  if (!finalHealth.canDeleteStaleGenerations) {
    throw new Error('RAG storage health changed before maintenance completion');
  }
  await host.writeMaintenanceFingerprint(expectedFingerprint);
}

async function runBoundedMaintenanceLoop(
  host: RagStorageMaintenanceHost,
  runBatch: () => Promise<{ remainingWork: boolean }>,
  isCancelled: () => boolean,
): Promise<void> {
  while (!isCancelled()) {
    const batch = await runBatch();
    if (!batch.remainingWork) break;
    await host.yieldToHost();
  }
  throwIfCancelled(isCancelled);
}

async function inspectHealth(
  host: RagStorageMaintenanceHost,
  expectedFingerprint: string,
  reconciliationComplete: boolean,
): Promise<{
  canReconcile: boolean;
  canDeleteStaleGenerations: boolean;
  candidateFilePaths: string[];
  dimension: number | null;
}> {
  const [files, candidateFilePaths, recoveryFingerprint, pendingDocumentCount] = await Promise.all([
    host.listCandidateFiles(),
    host.listValidFilePaths(),
    host.readRecoveryFingerprint(),
    host.countPendingDocuments(),
  ]);
  const recoveryPlan = planRagAutomaticRecoveryRust(
    files,
    recoveryFingerprint ?? '',
    0,
    pendingDocumentCount,
  );
  if (!recoveryPlan || recoveryPlan.fingerprint !== expectedFingerprint) {
    return blockedHealth(files);
  }
  const activeStore = await host.probeActiveStore(candidateFilePaths);
  const health = planRagStorageHealthRust({
    coverageChecked: true,
    pendingDocumentCount,
    embeddingContractMatches: activeStore.embeddingContractMatches,
    completionFingerprintMatches:
      recoveryFingerprint === expectedFingerprint && !recoveryPlan.requiresRecovery,
    activeStoreQueryable: activeStore.queryable,
    reconciliationComplete,
  });
  return {
    canReconcile: health?.canReconcile ?? false,
    canDeleteStaleGenerations: health?.canDeleteStaleGenerations ?? false,
    candidateFilePaths: [...candidateFilePaths],
    dimension: activeStore.dimension,
  };
}

function blockedHealth(files: readonly RustRagAutomaticRecoveryFileInput[]) {
  return {
    canReconcile: false,
    canDeleteStaleGenerations: false,
    candidateFilePaths: files.map((file) => file.path),
    dimension: null,
  };
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw new DOMException('RAG storage maintenance cancelled', 'AbortError');
}
