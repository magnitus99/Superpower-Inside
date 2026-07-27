import type { GraphRagStatusSummary } from '../graph/status';
import { shouldRebuildGraphRuntimeForGraphStatusRust } from './rust-core';

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
  const nextStatusState = input.nextStatus?.state ?? '';
  const previousStatusState = input.previousStatus?.state ?? '';

  const rustResult = shouldRebuildGraphRuntimeForGraphStatusRust(
    input.graphRagEnabled,
    input.graphRagModel,
    previousStatusState,
    nextStatusState,
    input.graphProviderAttached,
  );
  if (rustResult !== null) return rustResult;

  return shouldRebuildGraphRuntimeForGraphStatusFallback(
    input.graphRagEnabled,
    input.graphRagModel,
    previousStatusState,
    nextStatusState,
    input.graphProviderAttached,
  );
}

function shouldRebuildGraphRuntimeForGraphStatusFallback(
  graphRagEnabled: boolean,
  graphRagModel: string,
  previousStatusState: GraphRagStatusSummary['state'] | '',
  nextStatusState: GraphRagStatusSummary['state'] | '',
  graphProviderAttached: boolean,
): boolean {
  if (!graphRagEnabled || !graphRagModel.trim()) return false;
  if (graphProviderAttached) return false;
  if (!isGraphRagQueryableState(nextStatusState)) return false;
  return !isGraphRagQueryableState(previousStatusState) || !graphProviderAttached;
}

function isGraphRagQueryableState(state: GraphRagStatusSummary['state'] | ''): boolean {
  return state === 'ready' || state === 'partial';
}
