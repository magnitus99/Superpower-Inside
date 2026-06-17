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

export interface GraphRagIndexingProgress {
  currentFile: string | null;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  selectedFiles: number;
  runId: number;
  phase: GraphRagIndexingPhase;
}
