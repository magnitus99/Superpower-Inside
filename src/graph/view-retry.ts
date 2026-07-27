import type { GraphRagIndexingResult } from './indexing-runner';

export interface RejectedGraphFactRetryPlugin {
  isGraphRagIndexing(): boolean;
  retryGraphRagFile(filePath: string): Promise<GraphRagIndexingResult | null>;
}

export interface RejectedGraphFactRetryButton {
  setText(text: string): void;
}

export interface RejectedGraphFactRetryInput {
  plugin: RejectedGraphFactRetryPlugin;
  filePath: string;
  button: RejectedGraphFactRetryButton;
  labels: {
    retry: string;
    processing: string;
  };
  setRetryControlsDisabled(disabled: boolean): void;
  refreshGraphData?(result: { status: 'success'; runId?: number; source: 'graph-run' }): void;
  onIgnored?(): void;
  onError?(error: unknown): void;
}

export async function retryRejectedGraphFact(
  input: RejectedGraphFactRetryInput,
): Promise<GraphRagIndexingResult | null> {
  if (input.plugin.isGraphRagIndexing()) {
    input.onIgnored?.();
    return null;
  }

  input.setRetryControlsDisabled(true);
  input.button.setText(input.labels.processing);
  try {
    const result = await input.plugin.retryGraphRagFile(input.filePath);
    if (result === null) {
      input.onIgnored?.();
      return null;
    }
    input.refreshGraphData?.({ status: 'success', source: 'graph-run', runId: result.runId });
    return result;
  } catch (error) {
    input.onError?.(error);
    throw error;
  } finally {
    input.button.setText(input.labels.retry);
    input.setRetryControlsDisabled(false);
  }
}
