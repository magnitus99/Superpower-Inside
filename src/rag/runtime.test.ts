import { describe, expect, it } from 'vitest';
import { shouldRebuildRagRuntimeForGraphStatus } from './runtime';
import type { GraphRagStatusSummary } from '../graph/status';

describe('shouldRebuildRagRuntimeForGraphStatus', () => {
  it('GraphRAG가 query 가능 상태로 전환되면 runtime 재구성을 요구한다', () => {
    expect(
      shouldRebuildRagRuntimeForGraphStatus({
        graphRagEnabled: true,
        graphRagModel: 'openai:gpt-4.1-mini',
        previousStatus: createStatus('stale'),
        nextStatus: createStatus('ready'),
        graphProviderAttached: false,
      }),
    ).toBe(true);
  });

  it('GraphRAG provider가 이미 붙어 있거나 모델이 없으면 재구성을 요구하지 않는다', () => {
    expect(
      shouldRebuildRagRuntimeForGraphStatus({
        graphRagEnabled: true,
        graphRagModel: 'openai:gpt-4.1-mini',
        previousStatus: createStatus('ready'),
        nextStatus: createStatus('partial'),
        graphProviderAttached: true,
      }),
    ).toBe(false);
    expect(
      shouldRebuildRagRuntimeForGraphStatus({
        graphRagEnabled: true,
        graphRagModel: '',
        previousStatus: createStatus('stale'),
        nextStatus: createStatus('ready'),
        graphProviderAttached: false,
      }),
    ).toBe(false);
  });
});

function createStatus(state: GraphRagStatusSummary['state']): GraphRagStatusSummary {
  return {
    state,
    totalCandidateFiles: 1,
    graphEvidenceCount: state === 'ready' || state === 'partial' ? 1 : 0,
    rejectedFactCount: 0,
    failedFileCount: state === 'partial' ? 1 : 0,
    pendingMergeCount: 0,
    staleFileCount: state === 'stale' ? 1 : 0,
    staleFilePaths: state === 'stale' ? ['note.md'] : [],
    maxFilesPerRun: 50,
  };
}
