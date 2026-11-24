import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { buildQualityVaultCode } from './quality-vault.mjs';

const source = 'approved local source parser';
const pdfBytes = new TextEncoder().encode('approved local PDF parser').buffer;
const policy = { source, pdf: { size: pdfBytes.byteLength, sha256: createHash('sha256').update(new Uint8Array(pdfBytes)).digest('hex') } };

async function evaluate(operation, selectedPolicy = policy) {
  let finish, workerCalls = 0, hostNetworkCalls = 0;
  const completed = new Promise((resolve) => { finish = resolve; });
  const outputs = [];
  let nextUrl = 0;
  class LocalBlob { constructor(parts) { this.parts = parts; } }
  class LocalURL {}
  LocalURL.createObjectURL = () => `blob:local-${++nextUrl}`;
  LocalURL.revokeObjectURL = () => {};
  class LocalWorker {
    constructor() { workerCalls++; }
    postMessage() { queueMicrotask(() => this.onmessage({ data: [{ path: 'synthetic/current.md', text: 'Current parser source.', revision: '1:1', contentHash: 'current-hash' }] })); }
    terminate() {}
  }
  const body = `module.exports = {
    getQualityWorkerPolicy: () => globalThis.__workerPolicy,
    createEngineOnlyVaultHost: () => ({}),
    readOracleDocuments: async () => { ${operation} },
    runProductCase: async (_host,_case,_ledger,_signal,consume) => {
      const value = {source:{discoveryCandidates:[]},result:{readLiteralDiscoveryPage:async()=>null,dossier:{
        literalInventory:{status:'complete',summary:{matchMode:'nfkc-unicode-lower-line-substring-v1',sources:1,pageCount:0,needles:[{needle:'absent',normalizedNeedle:'absent',documents:0,matchingLines:0,occurrences:0}]}},
        evidence:[],matchInventory:[{query:'absent',totalDocuments:0,totalOccurrences:0}]
      }}};
      await consume?.(value); return value;
    }
  };`;
  runInNewContext(buildQualityVaultCode({ root: 'synthetic-root', outputPath: 'report', statusPath: 'status' }), {
    app: { plugins: { plugins: { 'superpower-inside': { acquireRagEngineOnlySnapshot: async () => ({ ragEngine: {}, documentCorpus: {}, release() {} }) } } } },
    superpowerQualityLoopCases: [{ question: 'absent', terms: ['absent'], information: [], expectNoAnswer: true }],
    __workerPolicy: selectedPolicy, __pdfBytes: pdfBytes, TextEncoder, Blob: LocalBlob, URL: LocalURL, Worker: LocalWorker,
    fetch: () => { hostNetworkCalls++; },
    require: (name) => name === 'node:fs' ? { writeFileSync: (target, value) => { outputs.push(JSON.parse(value)); if (target === 'status') finish(); } }
      : name === 'node:crypto' ? { createHash }
      : name === 'obsidian' ? { requestUrl: () => { hostNetworkCalls++; } }
      : { createRequire: () => () => ({ build: async () => ({ outputFiles: [{ text: body }] }) }) },
  });
  await completed;
  return { report: outputs[0], workerCalls, hostNetworkCalls };
}

const receive = 'return await new Promise(resolve => { worker.onmessage = event => { worker.terminate(); resolve(event.data); }; worker.postMessage({operation:"read-current-source"}); });';

describe('평가에서 승인된 로컬 원문 계산과 외부 실행의 경계', () => {
  it.each([
    `const url=URL.createObjectURL(new Blob([${JSON.stringify(source)}])); const worker=new Worker(url); URL.revokeObjectURL(url); ${receive}`,
    `const url=URL.createObjectURL(new Blob([globalThis.__pdfBytes])); const worker=new Worker(url); URL.revokeObjectURL(url); ${receive}`,
  ])('정확한 source 문자열 또는 설치 PDF digest의 fake ACK는 network 0으로 유지한다', async (operation) => {
    const result = await evaluate(operation);
    expect(result.report).toMatchObject({ status: 'passed', ledger: { network: 0, releases: 1 } });
    expect(result.workerCalls).toBe(1);
    expect(result.hostNetworkCalls).toBe(0);
  });

  it.each([
    'new Worker("https://example.invalid/worker.js"); return [];',
    'new Worker(URL.createObjectURL(new Blob(["unapproved script"]))); return [];',
    `const url=URL.createObjectURL(new Blob([${JSON.stringify(source)}])); URL.revokeObjectURL(url); new Worker(url); return [];`,
    'require("obsidian").requestUrl({url:"https://example.invalid/missing-asset"}); return [];',
  ])('원격·임의 blob·회수한 URL·누락 자산 통신은 계속 차단한다', async (operation) => {
    const result = await evaluate(operation);
    expect(result.report).toMatchObject({ status: 'failed', ledger: { network: 1, releases: 1 } });
    expect(result.workerCalls).toBe(0);
    expect(result.hostNetworkCalls).toBe(0);
  });

  it('다른 build의 PDF digest를 가진 blob은 실행하지 않는다', async () => {
    const result = await evaluate('new Worker(URL.createObjectURL(new Blob([globalThis.__pdfBytes]))); return [];', { ...policy, pdf: { ...policy.pdf, sha256: '0'.repeat(64) } });
    expect(result.report).toMatchObject({ status: 'failed', ledger: { network: 1 } });
    expect(result.workerCalls).toBe(0);
  });
});
