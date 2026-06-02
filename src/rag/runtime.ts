import type { GraphRagStatusSummary } from '../graph/status';

export interface GraphRagRuntimeRebuildInput {
  graphRagEnabled: boolean;
  graphRagModel: string;
  previousStatus: GraphRagStatusSummary | null;
  nextStatus: GraphRagStatusSummary | null;
  graphProviderAttached: boolean;
}

export function shouldRebuildRagRuntimeForGraphStatus(
  input: GraphRagRuntimeRebuildInput,
): boolean {
  if (!input.graphRagEnabled || !input.graphRagModel.trim()) return false;
  if (input.graphProviderAttached) return false;
  if (!isGraphRagQueryable(input.nextStatus)) return false;
  return !isGraphRagQueryable(input.previousStatus) || !input.graphProviderAttached;
}

function isGraphRagQueryable(status: GraphRagStatusSummary | null): boolean {
  return status?.state === 'ready' || status?.state === 'partial';
}
