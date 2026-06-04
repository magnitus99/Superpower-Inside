import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import type { RAGConfig } from '../settings';
import { createContentHash } from '../rag/hash';
import type { FileIndexRecord, VectorEntry, VectorStore } from '../rag/store';
import {
  filterProcessableGraphRagFilePaths,
  isProcessableGraphRagFilePath,
  type GraphRagFilePathPredicate,
} from './file-paths';
import type { KnowledgeGraphStore } from './store';

export type GraphRagIndexState =
  | 'disabled'
  | 'not-built'
  | 'building'
  | 'ready'
  | 'partial'
  | 'stale'
  | 'schema-error';

export interface GraphRagStatusInput {
  ragConfig: Pick<
    RAGConfig,
    'graphRagEnabled' | 'graphRagModel' | 'graphRagMaxFilesPerRun'
  >;
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
  const fileIndexRecords = await getFileIndexRecords(
    input.vectorStore,
    input.isProcessableFilePath,
  );
  const totalCandidateFiles = await getTotalCandidateFiles(
    input.vectorStore,
    input.isProcessableFilePath,
    fileIndexRecords,
  );
  const maxFilesPerRun = Math.max(1, Math.floor(input.ragConfig.graphRagMaxFilesPerRun));
  if (!input.ragConfig.graphRagEnabled) {
    return emptyStatus('disabled', totalCandidateFiles, maxFilesPerRun);
  }
  if (input.schemaErrors.length > 0) {
    return emptyStatus('schema-error', totalCandidateFiles, maxFilesPerRun);
  }
  if (input.isRunning) {
    return emptyStatus('building', totalCandidateFiles, maxFilesPerRun);
  }

  const [evidence, rejectedFacts, pendingMerges, cacheRecords] = await Promise.all([
    input.graphStore.getEvidence(),
    input.graphStore.getRejectedFacts(),
    input.graphStore.getPendingEntityMerges(),
    input.graphStore.getExtractionCacheRecords(),
  ]);
  const graphEvidenceCount = evidence.length;
  if (graphEvidenceCount === 0) {
    return {
      ...emptyStatus('not-built', totalCandidateFiles, maxFilesPerRun),
      rejectedFactCount: rejectedFacts.length,
      failedFileCount: countUnique(rejectedFacts.map((fact) => fact.filePath)),
      pendingMergeCount: pendingMerges.length,
    };
  }

  const ontologySchema = DEFAULT_ONTOLOGY_SCHEMA;
  const cacheByEntryId = new Map(cacheRecords.map((record) => [record.entryId, record]));
  const vectorFilePaths = new Set(fileIndexRecords.map((record) => record.filePath));
  const staleFiles = new Set<string>();
  for (const record of evidence) {
    if (
      !isProcessableGraphRagFilePath(record.filePath, input.isProcessableFilePath) ||
      !vectorFilePaths.has(record.filePath)
    ) {
      staleFiles.add(record.filePath);
    }
  }

  const relevantEntryIds = [
    ...new Set([...evidence.map((record) => record.entryId), ...cacheRecords.map((record) => record.entryId)]),
  ];
  const entries = filterProcessableGraphRagEntries(
    await input.vectorStore.getEntriesByIds(relevantEntryIds),
    input.isProcessableFilePath,
  );
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const freshCacheCountByFilePath = new Map<string, number>();

  for (const record of cacheRecords) {
    const entry = entriesById.get(record.entryId);
    if (!entry) {
      staleFiles.add(getFilePathForMissingEntry(record.entryId, evidence));
    }
  }
  for (const record of evidence) {
    const entry = entriesById.get(record.entryId);
    if (!entry) {
      staleFiles.add(record.filePath);
      continue;
    }
    const contentHash = entry.metadata.contentHash ?? createContentHash(entry.metadata.text);
    if (
      record.contentHash !== contentHash ||
      record.extractionModelKey !== input.ragConfig.graphRagModel
    ) {
      staleFiles.add(record.filePath);
    }
  }
  for (const entry of entries) {
    const contentHash = entry.metadata.contentHash ?? createContentHash(entry.metadata.text);
    const cache = cacheByEntryId.get(entry.id);
    if (
      cache?.contentHash !== contentHash ||
      cache.extractionModelKey !== input.ragConfig.graphRagModel ||
      cache.ontologySchemaId !== ontologySchema.id ||
      cache.ontologyVersion !== ontologySchema.version
    ) {
      staleFiles.add(entry.metadata.filePath);
      continue;
    }
    freshCacheCountByFilePath.set(
      entry.metadata.filePath,
      (freshCacheCountByFilePath.get(entry.metadata.filePath) ?? 0) + 1,
    );
  }
  for (const record of fileIndexRecords) {
    const freshCacheCount = freshCacheCountByFilePath.get(record.filePath) ?? 0;
    if (freshCacheCount < record.vectorCount) {
      staleFiles.add(record.filePath);
    }
  }

  const failedFileCount = countUnique(rejectedFacts.map((fact) => fact.filePath));
  const state: GraphRagIndexState =
    staleFiles.size > 0 ? 'stale' : failedFileCount > 0 ? 'partial' : 'ready';
  return {
    state,
    totalCandidateFiles,
    graphEvidenceCount,
    rejectedFactCount: rejectedFacts.length,
    failedFileCount,
    pendingMergeCount: pendingMerges.length,
    staleFileCount: staleFiles.size,
    staleFilePaths: [...staleFiles].sort(),
    maxFilesPerRun,
  };
}

async function getTotalCandidateFiles(
  vectorStore: VectorStore,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
  fileIndexRecords: readonly FileIndexRecord[],
): Promise<number> {
  const records = fileIndexRecords;
  if (records.length > 0) return records.length;
  return filterProcessableGraphRagFilePaths(
    await vectorStore.getIndexedFilePaths(),
    isProcessableFilePath,
  ).length;
}

async function getFileIndexRecords(
  vectorStore: VectorStore,
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): Promise<FileIndexRecord[]> {
  return (await vectorStore.getFileIndexRecords()).filter((record) =>
    isProcessableGraphRagFilePath(record.filePath, isProcessableFilePath),
  );
}

function filterProcessableGraphRagEntries(
  entries: readonly VectorEntry[],
  isProcessableFilePath: GraphRagFilePathPredicate | undefined,
): VectorEntry[] {
  return entries.filter((entry) =>
    isProcessableGraphRagFilePath(entry.metadata.filePath, isProcessableFilePath),
  );
}

function emptyStatus(
  state: GraphRagIndexState,
  totalCandidateFiles: number,
  maxFilesPerRun: number,
): GraphRagStatusSummary {
  return {
    state,
    totalCandidateFiles,
    graphEvidenceCount: 0,
    rejectedFactCount: 0,
    failedFileCount: 0,
    pendingMergeCount: 0,
    staleFileCount: 0,
    staleFilePaths: [],
    maxFilesPerRun,
  };
}

function countUnique(values: readonly string[]): number {
  return new Set(values).size;
}

function getFilePathForMissingEntry(
  entryId: string,
  evidence: readonly { entryId: string; filePath: string }[],
): string {
  return evidence.find((record) => record.entryId === entryId)?.filePath ?? entryId.split('::')[0] ?? entryId;
}
