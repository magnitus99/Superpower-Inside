import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { buildQualityVaultCode } from './quality-vault.mjs';
import { publicReport } from './quality-loop.mjs';

describe('보고서 쓰기 이전의 허용 목록', () => {
  it.each(['unknown-key', 'unknown-string'])('vault 중간 출력도 %s를 디스크에 운반하지 않는다', async (kind) => {
    const outputs = [];
    let finish;
    const completed = new Promise((resolve) => { finish = resolve; });
    const secret = 'independent-synthetic-output-sentinel';
    const runtime = {
      createEngineOnlyVaultHost: () => ({}), readOracleDocuments: async () => [],
      runProductCase: async (_host, _case, ledger) => {
        if (kind === 'unknown-key') ledger.unapproved = secret;
        else ledger.suppressedOutput = secret;
        return { source: { discoveryCandidates: [] }, result: { dossier: { evidence: [], matchInventory: [{ query: 'absent', totalDocuments: 0, totalOccurrences: 0 }] } } };
      },
    };
    runInNewContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), {
      app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot: async () => ({ ragEngine: {}, documentCorpus: {}, release() {} }) } } } },
      superpowerQualityLoopCases: [{ question: 'absent', terms: ['absent'], information: [], expectNoAnswer: true }],
      __qualityRuntime: runtime, TextEncoder,
      require: (name) => name === 'node:fs' ? { writeFileSync: (target, value) => { outputs.push(JSON.parse(value)); if (target === 'status') finish(); } }
        : { createRequire: () => () => ({ build: async () => ({ outputFiles: [{ text: 'module.exports=globalThis.__qualityRuntime' }] }) }) },
    });
    await completed;
    expect(JSON.stringify(outputs).includes(secret)).toBe(false);
    expect(outputs).toEqual([{ status: 'failed', reason: 'quality-vault-blocked' }, { completed: true }]);
  });

  it('공유 공개 serializer는 원문 없이 허용된 유한 집계만 유지한다', () => {
    expect(publicReport({ status: 'passed', rows: [{ found: 1, missing: 0, cappedRecall: null }], ledger: { network: 0 } })).toEqual({ status: 'passed', rows: [{ found: 1, missing: 0, cappedRecall: null }], ledger: { network: 0 } });
    expect(() => publicReport({ rows: [{ found: Infinity }] })).toThrow('quality-output-blocked');
  });
});
