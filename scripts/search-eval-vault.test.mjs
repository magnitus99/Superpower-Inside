import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildEvaluationCode } from './search-eval/run-vault.mjs';

describe('실볼트 하네스의 독립 합성 호스트', () => {
  it.each([false, true])('제품 포트 계약과 원문 비노출을 검사한다(오래된 revision=%s)', async (staleRevision) => {
    const file = { path: 'private-synthetic/note.md', basename: 'sentinel private heading', extension: 'md', stat: { mtime: 10, size: 20 } };
    const text = '# sentinel private heading\nsynthetic phrase body';
    const evidence = { path: file.path, revision: staleRevision ? '9:20' : '10:20', startLine: 2, endLine: 2, quote: 'synthetic phrase body' };
    const calls = [];
    const outputs = new Map();
    let finish;
    const completed = new Promise((resolve) => { finish = resolve; });
    const port = async (request) => {
      calls.push(request);
      if (request.signal?.aborted) return null;
      return { evidence: request.query.startsWith('zzabsent') ? [] : [evidence], diagnostics: {}, coverage: {} };
    };
    runInNewContext(buildEvaluationCode({ queries: 1, statusPath: 'status', outputPath: 'report' }), {
      app: {
        plugins: { plugins: { 'superpower-inside': { getSearchPort: () => port, manifest: { version: 'synthetic' } } } },
        vault: { getMarkdownFiles: () => [file], cachedRead: async () => text, getAbstractFileByPath: () => file },
        metadataCache: { getFileCache: () => ({ tags: [{ tag: '#synthetic-tag' }] }) },
      },
      require: (name) => name === 'node:fs' ? { writeFileSync: (target, content) => {
        outputs.set(target, content);
        if (target === 'status' && !JSON.parse(content).running) finish();
      } } : { randomUUID: () => 'independent-absent-token' },
      AbortController, performance, process: { pid: 1, memoryUsage: () => ({ rss: 100 }) },
    });
    await completed;
    expect(JSON.parse(outputs.get('status')).completed).toBe(true);
    const report = JSON.parse(outputs.get('report'));
    expect(report.searchPath).toBe('search-port');
    expect(Object.keys(report.contracts).sort()).toEqual([
      'extensionFilter', 'modifiedFilter', 'noAnswer', 'pathFilter', 'preCancelled',
      'quotedPhrase', 'selectedQuoteAtAbsoluteLines', 'selectedRevisionCurrent', 'tagFilter', 'typoResponseContract',
    ].sort());
    expect(report.contractFailures).toBe(staleRevision ? 1 : 0);
    expect(report.uncoveredContracts).toEqual([]);
    for (const [name, result] of Object.entries(report.contracts))
      expect(result.passed).toBe(result.checked - Number(staleRevision && name === 'selectedRevisionCurrent'));
    expect(calls.some((request) => request.filters?.tags)).toBe(true);
    expect(calls.some((request) => request.signal?.aborted)).toBe(true);
    const persisted = [...outputs.values()].join('');
    for (const secret of [file.path, file.basename, evidence.quote, 'synthetic-tag']) expect(persisted).not.toContain(secret);
    expect(report.accuracyValidation).toContain('not full relevance accuracy');
  });

  it('제품 포트가 없으면 구형 ragEngine으로 조용히 대체하지 않는다', () => {
    const outputs = [];
    runInNewContext(buildEvaluationCode({ queries: 1, statusPath: 'status', outputPath: 'report' }), {
      app: { plugins: { plugins: { 'superpower-inside': { ragEngine: {} } } } },
      require: () => ({ writeFileSync: (_target, content) => outputs.push(JSON.parse(content)) }),
      process: { pid: 1 },
    });
    expect(outputs.at(-1)).toEqual({ completed: false, stage: 'new-search-port-required' });
  });
});
