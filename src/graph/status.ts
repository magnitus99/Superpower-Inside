import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import type { RAGConfig } from '../settings';
import { createContentHash } from '../rag/hash';
import type { VectorStore } from '../rag/store';
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
  const totalCandidateFiles = await getTotalCandidateFiles(input.vectorStore);
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
  const entries = await input.vectorStore.getEntries();
  const vectorFilePaths = new Set(entries.map((entry) => entry.metadata.filePath));
  const staleFiles = new Set<string>();
  for (const record of evidence) {
    if (!vectorFilePaths.has(record.filePath)) {
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

async function getTotalCandidateFiles(vectorStore: VectorStore): Promise<number> {
  const records = await vectorStore.getFileIndexRecords();
  if (records.length > 0) return records.length;
  return (await vectorStore.getIndexedFilePaths()).length;
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
