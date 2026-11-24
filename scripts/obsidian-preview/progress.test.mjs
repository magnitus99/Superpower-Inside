import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIndexingPreviewSummary } from './progress.mjs';

describe('합성 pipeline 진행 fixture', () => {
  it.each([
    'opening',
    'legacy-restore',
    'snapshot-bytes',
    'model-init',
    'verifying',
    'publication-waiting',
    'stalled',
    'serving',
    'unknown',
    'settling',
    'partial',
    'failed',
    'user-paused',
    'performance-paused',
  ])('%s는 raw source 없이 상태만 전달한다', (name) => {
    const summary = createIndexingPreviewSummary(name);
    expect(summary).not.toBeNull();
    expect(summary.etaRemainingMs).toBeNull();
    expect(Object.keys(summary)).not.toContain('currentFile');
    expect(summary.completedFiles).toBeLessThanOrEqual(summary.totalFiles);
  });
  it('실제 entry의 snapshot 연결은 오류 화면용 null 전환과 복원을 허용한다', () => {
    const source = readFileSync(new URL('./entry.mjs', import.meta.url), 'utf8');
    const begin = source.indexOf('  if (progressSummary) plugin.getSearchStatusSnapshot');
    const end = source.indexOf('\n  const quotaPreview', begin);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(begin);
    let current = createIndexingPreviewSummary('serving');
    const plugin = {};
    const host = { getSearchStatusSnapshot: () => ({ readiness: current?.servingAvailable ? 'ready' : 'preparing', indexing: current }) };
    const readSnapshot = new Function('plugin', 'searchHost', 'readSummary', `let progressSummary = readSummary(); ${source.slice(begin, end)}; return () => { progressSummary = readSummary(); return plugin.getSearchStatusSnapshot(); };`)(plugin, host, () => current);
    expect(readSnapshot()).toMatchObject({ readiness: 'ready', indexing: current });
    current = null;
    expect(readSnapshot()).toMatchObject({ readiness: 'preparing', indexing: null });
    current = createIndexingPreviewSummary('serving');
    expect(readSnapshot()).toMatchObject({ readiness: 'ready', indexing: current });
  });

  it('unknown은 관측되지 않은 원장과 총량을 0으로 대체하지 않는다', () => {
    expect(createIndexingPreviewSummary('unknown')).toMatchObject({
      totalFilesKnown: false,
      servingAvailable: false,
      processedFiles: null,
      failedFiles: null,
      partialFiles: null,
      skippedFiles: null,
    });
  });
  it('사용자 중단과 성능 보호 대기를 별개로 준다', () => {
    expect(createIndexingPreviewSummary('user-paused')).toMatchObject({
      activity: 'paused',
      pauseReason: 'user',
    });
    expect(createIndexingPreviewSummary('performance-paused')).toMatchObject({
      activity: 'paused',
      pauseReason: 'performance',
    });
    expect(createIndexingPreviewSummary(null)).toBeNull();
  });
});
