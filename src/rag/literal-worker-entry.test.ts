import { build } from 'esbuild';
import { Worker as NodeWorker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { createLiteralWorkerHandler, type LiteralWorkerResponse } from './literal-worker-entry';
import { createContentHashRust, planSourceBodyRust } from './rust-core';
import { getSourceWorkerModule } from './source-worker-runtime';

async function initial() {
  const text = 'ＣＡＢ ﬃ\r'; const plan = planSourceBodyRust(text);
  if (!plan) throw new Error('합성 bodyPlan 필요');
  const input = { version: 1, needles: ['cab', 'f', '\r'], maxChargeBytes: plan.scanChargeBytes + 16 * 1024 * 1024, source: { path: 'synthetic.txt', contentHash: createContentHashRust(text), sourceMetadataHash: 'aaaaaaaa', sourceMtime: 1.5, sourceSize: plan.byteLength, version: 1, byteLength: plan.byteLength, utf16Length: plan.utf16Length, blockCount: plan.blocks.length, scanChargeBytes: plan.scanChargeBytes, segments: [{ startLine: 0, endLine: 0 }] } };
  return { input, block: { index: 0, ...plan.blocks[0], text }, module: await getSourceWorkerModule() };
}
describe('literal source Worker wire', () => {
  it('실제 Node worker_threads: 기존 XLSX entry 자산 경로에서 init/append/seal/page/summary ACK를 실행한다', async () => {
    const bundled = await build({ entryPoints: ['src/rag/xlsx-worker-entry.ts'], bundle: true, write: false, platform: 'browser', format: 'iife' });
    // 메모리 번들은 공식 배포 자산 생성/브라우저 Worker 실행 검증이 아닙니다.
    expect(bundled.outputFiles[0].text).not.toContain('RAG_WASM_BASE64');
    const worker = new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: data => parentPort.postMessage(data) }; ${bundled.outputFiles[0].text}; parentPort.on('message', data => self.onmessage({data}));`, { eval: true });
    try {
      const value = await initial(); let id = 0;
      const send = (operation: string, extra = {}): Promise<LiteralWorkerResponse> => {
        const response = new Promise<LiteralWorkerResponse>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
        worker.postMessage({ protocol: 'literal-source-v1', id: ++id, operation, ...extra }); return response;
      };
      expect(await send('init', { input: value.input, module: value.module })).toMatchObject({ protocol: 'literal-source-v1', id: 1, operation: 'init', ok: true });
      expect(await send('append', { block: value.block })).toMatchObject({ id: 2, operation: 'append', ok: true });
      expect(await send('seal')).toMatchObject({ ok: true });
      const page = await send('page', { maxMatches: 256, maxBytes: 1024 * 1024 });
      expect(page.ok).toBe(true);
      const parsed: unknown = JSON.parse(page.json ?? 'null'); expect(parsed).toMatchObject({ references: Array.from({ length: 4 }, () => ({ line: 1, sourceSegments: [0] })) });
      const summary = await send('summary'); expect(summary.ok).toBe(true);
      const parsedSummary: unknown = JSON.parse(summary.json ?? 'null');
      expect(parsedSummary).toMatchObject({ needles: [{ occurrences: 1 }, { occurrences: 2 }, { occurrences: 1 }] });
      expect(await send('page', { maxMatches: 1, maxBytes: 4096 })).toMatchObject({ ok: false, reason: 'worker-failed' });
      const sourceReply = new Promise<{ ok: boolean; json: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      const bytes = new TextEncoder().encode('original source route');
      worker.postMessage({ operation: 'source-decode', module: value.module, bytes }, [bytes.buffer]);
      expect(bytes.byteLength).toBe(0);
      const sourceMessage = await sourceReply;
      expect(sourceMessage.ok).toBe(true); expect(JSON.parse(sourceMessage.json)).toMatchObject({ text: 'original source route' });
      expect(await getSourceWorkerModule()).toBe(value.module);
    } finally { await worker.terminate(); }
  });
  it.each(['protocol', 'id', 'operation', 'payload', 'reinit', 'fraction', 'before-init'] as const)('합성 handler: 잘못된 %s는 고정 오류로 scanner를 닫고 이후 작업도 거부한다', async (bad) => {
    const value = await initial(); const responses: LiteralWorkerResponse[] = [];
    const handle = createLiteralWorkerHandler((response) => responses.push(response));
    if (bad !== 'before-init') handle({ protocol: 'literal-source-v1', id: 1, operation: 'init', module: value.module, input: value.input });
    const request = { protocol: 'literal-source-v1', id: bad === 'before-init' ? 1 : 2, operation: 'append', block: value.block };
    handle(bad === 'protocol' ? { ...request, protocol: 'foreign' } : bad === 'id' ? { ...request, id: 1 } : bad === 'operation' ? { ...request, operation: 'source-read' } : bad === 'payload' ? { ...request, block: null } : bad === 'reinit' ? { ...request, operation: 'init', module: value.module, input: value.input } : bad === 'fraction' ? { ...request, operation: 'page', maxMatches: 1.5, maxBytes: 4096 } : request);
    expect(responses.at(-1)).toMatchObject({ ok: false });
    expect(['worker-failed', 'invalid-page', 'invalid-block']).toContain(responses.at(-1)?.reason);
    handle({ protocol: 'literal-source-v1', id: 3, operation: 'summary' });
    expect(responses.at(-1)).toMatchObject({ ok: false, reason: 'worker-failed' });
    expect(JSON.stringify(responses)).not.toContain('synthetic.txt');
  });
  it('합성 handler: native hash 실패 사유만 전달하고 원문 exception을 내보내지 않는다', async () => {
    const value = await initial(); const responses: LiteralWorkerResponse[] = []; const handle = createLiteralWorkerHandler((response) => responses.push(response));
    value.input.source.contentHash = '00000000';
    handle({ protocol: 'literal-source-v1', id: 1, operation: 'init', module: value.module, input: value.input });
    handle({ protocol: 'literal-source-v1', id: 2, operation: 'append', block: value.block });
    handle({ protocol: 'literal-source-v1', id: 3, operation: 'seal' });
    expect(responses.at(-1)).toMatchObject({ ok: false, reason: 'source-hash' });
  });
});
