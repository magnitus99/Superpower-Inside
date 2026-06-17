import { describe, expect, it, vi } from 'vitest';
import { retryRejectedGraphFact } from './view-retry';

describe('retryRejectedGraphFact', () => {
  it('rejected fact 버튼은 전체 실행 대신 해당 파일 재시도 API를 호출한다', async () => {
    const button = new FakeRetryButton();
    const setRetryControlsDisabled = vi.fn();
    const refreshGraphData = vi.fn();
    const plugin = {
      isGraphRagIndexing: vi.fn(() => false),
      retryGraphRagFile: vi.fn(() => Promise.resolve(createGraphResult(7))),
      runGraphRagIndexing: vi.fn(),
    };

    const result = await retryRejectedGraphFact({
      plugin,
      filePath: 'folder/rejected.md',
      button,
      labels: { retry: '다시 시도', processing: '처리 중...' },
      setRetryControlsDisabled,
      refreshGraphData,
    });

    expect(result).toEqual(createGraphResult(7));
    expect(plugin.retryGraphRagFile).toHaveBeenCalledWith('folder/rejected.md');
    expect(plugin.runGraphRagIndexing).not.toHaveBeenCalled();
    expect(setRetryControlsDisabled).toHaveBeenNthCalledWith(1, true);
    expect(setRetryControlsDisabled).toHaveBeenLastCalledWith(false);
    expect(button.texts).toEqual(['처리 중...', '다시 시도']);
    expect(refreshGraphData).toHaveBeenCalledWith({
      status: 'success',
      source: 'graph-run',
      runId: 7,
    });
  });

  it('이미 GraphRAG가 실행 중이면 버튼 상태를 처리 중으로 바꾸지 않고 재시도를 무시한다', async () => {
    const button = new FakeRetryButton();
    const onIgnored = vi.fn();
    const setRetryControlsDisabled = vi.fn();
    const plugin = {
      isGraphRagIndexing: vi.fn(() => true),
      retryGraphRagFile: vi.fn(),
    };

    const result = await retryRejectedGraphFact({
      plugin,
      filePath: 'folder/rejected.md',
      button,
      labels: { retry: '다시 시도', processing: '처리 중...' },
      setRetryControlsDisabled,
      onIgnored,
    });

    expect(result).toBeNull();
    expect(plugin.retryGraphRagFile).not.toHaveBeenCalled();
    expect(setRetryControlsDisabled).not.toHaveBeenCalled();
    expect(button.texts).toEqual([]);
    expect(onIgnored).toHaveBeenCalledOnce();
  });
});

class FakeRetryButton {
  readonly texts: string[] = [];

  setText(text: string): void {
    this.texts.push(text);
  }
}

function createGraphResult(runId: number) {
  return {
    totalCandidateFiles: 1,
    selectedFiles: 1,
    processedFiles: 1,
    skippedFiles: 0,
    failedFiles: 0,
    processedChunks: 1,
    skippedChunks: 0,
    failedChunks: 0,
    cancelled: false,
    startedAt: 1000,
    finishedAt: 1100,
    runId,
  };
}
