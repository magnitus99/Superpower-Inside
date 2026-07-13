import { buildKnowledgeGraphContract } from './knowledge-contract';
import type { RAGConfig } from '../settings';
import type { FileIndexRecord, VectorEntry, VectorStore } from '../rag/store';
import {
  planGraphRagStatusEntryLookupsRust,
  graphExtractionContractVersionRust,
  planGraphRagStatusEntryLookupsFallback,
  planGraphRagStatusEntrySnapshotRust,
  planGraphRagStatusEntrySnapshotFallback,
  planGraphRagStatusFileSnapshotRust,
  planGraphRagStatusFileSnapshotFallback,
  planGraphRagStatusFallback,
  planGraphRagStatusRust,
  type RustGraphRagRunFilePathInput,
  type RustGraphRagStatusCacheInput,
  type RustGraphRagStatusEntryInput,
  type RustGraphRagStatusEntrySnapshotInput,
  type RustGraphRagStatusEntrySnapshotPlan,
  type RustGraphRagStatusEvidenceInput,
  type RustGraphRagStatusFileRecordInput,
  type RustGraphRagStatusFileSnapshotPlan,
  type RustGraphRagStatusFileSnapshotRecordInput,
  type RustGraphRagStatusInput,
} from '../rag/rust-core';
import { isProcessableGraphRagFilePath, type GraphRagFilePathPredicate } from './file-paths';
import { selectByRustIndices } from '../utils/rust-index-plan';
import type { GraphEvidenceRecord, GraphExtractionCacheRecord, KnowledgeGraphStore } from './store';

export type GraphRagIndexState =
  | 'disabled'
  | 'not-built'
  | 'building'
  | 'ready'
  | 'partial'
  | 'stale'
  | 'schema-error';

export interface GraphRagStatusInput {
  ragConfig: Pick<RAGConfig, 'graphRagEnabled' | 'graphRagModel' | 'graphRagMaxFilesPerRun'>;
  graphStore: KnowledgeGraphStore;
  vectorStore: VectorStore;
  isRunning: boolean;
  schemaErrors: readonly string[];
  isProcessableFilePath?: GraphRagFilePathPredicate;
}

export interface GraphRagStatusSummary {
  state: GraphRagIndexState;
  totalCandidateFiles: number;
  graphEvidenceCount: number;
  rejectedFactCount: number;
  failedFileCount: number;
  pendingMergeCount: number;
  staleFileCount: number;
  staleFilePaths: readonly string[];
  maxFilesPerRun: number;
}

export async function calculateGraphRagStatus(
  input: GraphRagStatusInput,
): Promise<GraphRagStatusSummary> {
  if (!input.ragConfig.graphRagEnabled) {
    return createDisabledGraphRagStatus(input.ragConfig.graphRagMaxFilesPerRun);
  }

  if (input.schemaErrors.length > 0) {
    return requireGraphRagStatusPlan(createGraphRagStatusInput(input, [], 0));
  }

  const fileSnapshot = await getGraphRagStatusFileSnapshot(
    input.vectorStore,
    input.isProcessableFilePath,
  );
  const fileIndexRecords = fileSnapshot.fileIndexRecords;
  const totalCandidateFiles = fileSnapshot.totalCandidateFiles;

  const [evidence, rejectedFacts, pendingMerges, cacheRecords] = await Promise.all([
    input.graphStore.getEvidence(),
    input.graphStore.getRejectedFacts(),
    input.graphStore.getPendingEntityMerges(),
    input.graphStore.getExtractionCacheRecords(),
  ]);
  const entryIds =
    evidence.length === 0
      ? []
      : requireGraphRagStatusEntryLookups(
          evidence.map((record) => record.entryId),
          cacheRecords.map((record) => record.entryId),
        );
  const entries =
    entryIds.length === 0
      ? []
      : getGraphRagStatusEntries(
          await input.vectorStore.getEntriesByIds(entryIds),
          input.isProcessableFilePath,
        );
  return requireGraphRagStatusPlan(
    createGraphRagStatusInput(input, fileIndexRecords, totalCandidateFiles, {
      evidence,
      rejectedFactFilePaths: rejectedFacts.map((fact) => fact.filePath),
      pendingMergeCount: pendingMerges.length,
      cacheRecords,
      entries,
    }),
  );
}

interface GraphRagStatusFileSnapshot {
  fileIndexRecords: FileIndexRecord[];
  totalCandidateFiles: number;
}

async function getGraphRagStatusFileSnapshot(
  vectorStore: VectorStore,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): Promise<GraphRagStatusFileSnapshot> {
  const fileIndexRecords = await vectorStore.getFileIndexRecords();
  const indexedFilePaths = fileIndexRecords.map((record) => record.filePath);
  const plan = requireGraphRagStatusFileSnapshot(
    fileIndexRecords.map((record) =>
      toGraphRagStatusFileSnapshotRecordInput(record, isProcessableFilePath),
    ),
    indexedFilePaths.map((filePath) =>
      toGraphRagStatusIndexedFilePathInput(filePath, isProcessableFilePath),
    ),
  );
  return {
    fileIndexRecords: selectGraphRagStatusFileRecords(fileIndexRecords, plan.fileRecordIndices),
    totalCandidateFiles: plan.totalCandidateFiles,
  };
}

function getGraphRagStatusEntries(
  entries: readonly VectorEntry[],
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): VectorEntry[] {
  const plan = requireGraphRagStatusEntrySnapshot(
    entries.map((entry) => toGraphRagStatusEntrySnapshotInput(entry, isProcessableFilePath)),
  );
  return selectGraphRagStatusEntries(entries, plan.entryIndices);
}

interface GraphRagStatusSnapshot {
  evidence?: readonly GraphEvidenceRecord[];
  rejectedFactFilePaths?: readonly string[];
  pendingMergeCount?: number;
  cacheRecords?: readonly GraphExtractionCacheRecord[];
  entries?: readonly VectorEntry[];
}

function createGraphRagStatusInput(
  input: GraphRagStatusInput,
  fileIndexRecords: readonly FileIndexRecord[],
  totalCandidateFiles: number,
  snapshot: GraphRagStatusSnapshot = {},
): RustGraphRagStatusInput {
  const knowledgeContract = buildKnowledgeGraphContract();
  return {
    graphRagEnabled: true,
    isRunning: input.isRunning,
    schemaErrorCount: input.schemaErrors.length,
    totalCandidateFiles,
    graphRagMaxFilesPerRun: input.ragConfig.graphRagMaxFilesPerRun,
    graphRagModel: input.ragConfig.graphRagModel,
    ontologySchemaId: knowledgeContract.id,
    ontologyVersion: knowledgeContract.version,
    extractionContractVersion: graphExtractionContractVersionRust(),
    fileRecords: fileIndexRecords.map(toGraphRagStatusFileRecordInput),
    evidence: (snapshot.evidence ?? []).map((record) =>
      toGraphRagStatusEvidenceInput(record, input.isProcessableFilePath),
    ),
    rejectedFactFilePaths: snapshot.rejectedFactFilePaths ?? [],
    pendingMergeCount: snapshot.pendingMergeCount ?? 0,
    cacheRecords: (snapshot.cacheRecords ?? []).map(toGraphRagStatusCacheInput),
    entries: (snapshot.entries ?? []).map(toGraphRagStatusEntryInput),
  };
}

function createDisabledGraphRagStatus(maxFilesPerRun: number): GraphRagStatusSummary {
  return {
    state: 'disabled',
    totalCandidateFiles: 0,
    graphEvidenceCount: 0,
    rejectedFactCount: 0,
    failedFileCount: 0,
    pendingMergeCount: 0,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun,
  };
}

function requireGraphRagStatusEntryLookups(
  evidenceEntryIds: readonly string[],
  cacheEntryIds: readonly string[],
): string[] {
  const entryIds = planGraphRagStatusEntryLookupsRust(evidenceEntryIds, cacheEntryIds);
  if (entryIds === null) {
    return planGraphRagStatusEntryLookupsFallback(evidenceEntryIds, cacheEntryIds);
  }
  return entryIds;
}

function requireGraphRagStatusFileSnapshot(
  fileRecords: readonly RustGraphRagStatusFileSnapshotRecordInput[],
  indexedFilePaths: readonly RustGraphRagRunFilePathInput[],
): RustGraphRagStatusFileSnapshotPlan {
  const plan = planGraphRagStatusFileSnapshotRust(fileRecords, indexedFilePaths);
  if (plan === null) {
    return planGraphRagStatusFileSnapshotFallback(fileRecords, indexedFilePaths);
  }
  return plan;
}

function requireGraphRagStatusEntrySnapshot(
  entries: readonly RustGraphRagStatusEntrySnapshotInput[],
): RustGraphRagStatusEntrySnapshotPlan {
  const plan = planGraphRagStatusEntrySnapshotRust(entries);
  if (plan === null) {
    return planGraphRagStatusEntrySnapshotFallback(entries);
  }
  return plan;
}

function requireGraphRagStatusPlan(input: RustGraphRagStatusInput): GraphRagStatusSummary {
  const plan = planGraphRagStatusRust(input);
  if (plan === null) {
    return planGraphRagStatusFallback(input);
  }
  return plan;
}

function toGraphRagStatusFileRecordInput(
  record: FileIndexRecord,
): RustGraphRagStatusFileRecordInput {
  return {
    filePath: record.filePath,
    vectorCount: record.vectorCount,
  };
}

function toGraphRagStatusFileSnapshotRecordInput(
  record: FileIndexRecord,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): RustGraphRagStatusFileSnapshotRecordInput {
  return {
    filePath: record.filePath,
    vectorCount: record.vectorCount,
    processable: isHostProcessableGraphRagFilePath(record.filePath, isProcessableFilePath),
  };
}

function toGraphRagStatusIndexedFilePathInput(
  filePath: string,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): RustGraphRagRunFilePathInput {
  return {
    filePath,
    processable: isHostProcessableGraphRagFilePath(filePath, isProcessableFilePath),
  };
}

function toGraphRagStatusEvidenceInput(
  record: GraphEvidenceRecord,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): RustGraphRagStatusEvidenceInput {
  return {
    filePath: record.filePath,
    entryId: record.entryId,
    contentHash: record.contentHash,
    extractionModelKey: record.extractionModelKey,
    processable: isProcessableGraphRagFilePath(record.filePath, isProcessableFilePath),
  };
}

function toGraphRagStatusCacheInput(
  record: GraphExtractionCacheRecord,
): RustGraphRagStatusCacheInput {
  return {
    entryId: record.entryId,
    contentHash: record.contentHash,
    extractionModelKey: record.extractionModelKey,
    ontologySchemaId: record.ontologySchemaId,
    ontologyVersion: record.ontologyVersion,
    extractionContractVersion: record.extractionContractVersion ?? 0,
  };
}

function toGraphRagStatusEntryInput(entry: VectorEntry): RustGraphRagStatusEntryInput {
  return {
    id: entry.id,
    filePath: entry.metadata.filePath,
    contentHash: entry.metadata.contentHash,
    text: entry.metadata.text,
  };
}

function toGraphRagStatusEntrySnapshotInput(
  entry: VectorEntry,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): RustGraphRagStatusEntrySnapshotInput {
  return {
    id: entry.id,
    filePath: entry.metadata.filePath,
    processable: isHostProcessableGraphRagFilePath(entry.metadata.filePath, isProcessableFilePath),
  };
}

function selectGraphRagStatusFileRecords(
  records: readonly FileIndexRecord[],
  indices: readonly number[],
): FileIndexRecord[] {
  return selectByRustIndices(records, indices, { dedupe: true });
}

function selectGraphRagStatusEntries(
  entries: readonly VectorEntry[],
  indices: readonly number[],
): VectorEntry[] {
  return selectByRustIndices(entries, indices, { dedupe: true });
}

function isHostProcessableGraphRagFilePath(
  filePath: string,
  predicate: GraphRagFilePathPredicate | undefined,
): boolean {
  return predicate?.(filePath) ?? true;
}
