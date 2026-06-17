export type GraphRagIndexingPhase =
  | 'idle'
  | 'selecting-files'
  | 'checking-cache'
  | 'api-waiting'
  | 'api-response-received'
  | 'api-response-normalizing'
  | 'storing-results'
  | 'file-completed'
  | 'building-communities'
  | 'completed'
  | 'cancelled';

export interface GraphRagIndexingProgressCounters {
  processedChunks: number;
  skippedChunks: number;
  failedChunks: number;
  storedEvidence: number;
  storedEntities: number;
  storedRelations: number;
  storedClaims: number;
  storedRejectedFacts: number;
  cachedChunks: number;
}

export type GraphRagIndexingCounterPatch = Partial<GraphRagIndexingProgressCounters>;

export interface GraphRagIndexingProgress extends GraphRagIndexingProgressCounters {
  currentFile: string | null;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedFiles: number;
  runId: number;
  phase: GraphRagIndexingPhase;
}

export function createEmptyGraphRagProgressCounters(): GraphRagIndexingProgressCounters {
  return {
    processedChunks: 0,
    skippedChunks: 0,
    failedChunks: 0,
    storedEvidence: 0,
    storedEntities: 0,
    storedRelations: 0,
    storedClaims: 0,
    storedRejectedFacts: 0,
    cachedChunks: 0,
  };
}
