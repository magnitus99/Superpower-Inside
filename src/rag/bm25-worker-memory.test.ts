import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { BM25_WORKER_SOURCE } from '../../.local/generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import type { BM25WorkerResponse } from './bm25-worker-runtime';

interface MemoryResult {
  bytes: number;
  totalDocs: number;
  scores: number[];
}

async function measurePostingMemory(idLength: number): Promise<MemoryResult> {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    let memory;
    const NativeInstance = WebAssembly.Instance;
    WebAssembly.Instance = new Proxy(NativeInstance, { construct(target, args) {
      const instance = Reflect.construct(target, args);
      memory = instance.exports.memory;
      return instance;
    }});
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    ${BM25_WORKER_SOURCE}
    parentPort.on('message', data => {
      if (data.probeMemory === true) parentPort.postMessage({ id: data.id, bytes: memory.buffer.byteLength });
      else globalThis.self.onmessage({ data });
    });
  `, { eval: true });
  const sessionId = crypto.randomUUID();
  const request = (id: number, input: Record<string, unknown>): Promise<BM25WorkerResponse & { bytes?: number }> =>
    new Promise((resolve, reject) => {
      const onMessage = (value: BM25WorkerResponse & { bytes?: number }): void => {
        if (value.id !== id || value.progress) return;
        worker.off('message', onMessage);
        worker.off('error', onError);
        if (value.error) reject(new Error(value.error));
        else resolve(value);
      };
      const onError = (error: Error): void => {
        worker.off('message', onMessage);
        reject(error);
      };
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.postMessage({ id, sessionId, revision: 0, part: 0, finalPart: true, ...input });
    });
  try {
    await request(1, { operation: 'initialize', wasmBase64: RAG_WASM_BASE64, snapshot: '' });
    const text = Array.from({ length: 64 }, (_, index) => `word${String(index).padStart(4, '0')}`).join(' ');
    const documents = Array.from({ length: 512 }, (_, index) => ({
      id: `synthetic-${String(index).padStart(4, '0')}-` + 'x'.repeat(idLength),
      text,
      sourcePath: 'synthetic.md',
    }));
    const rebuilt = await request(2, { operation: 'rebuild', revision: 1, documents });
    const searched = await request(3, { operation: 'search-top', query: 'word0051', limit: 5 });
    const measured = await request(4, { probeMemory: true });
    if (measured.bytes === undefined || rebuilt.totalDocs === undefined) throw new Error('Synthetic memory observation missing');
    return { bytes: measured.bytes, totalDocs: rebuilt.totalDocs, scores: searched.hits?.map(hit => hit.score) ?? [] };
  } finally {
    await worker.terminate();
  }
}

describe('BM25 실제 WASM posting 식별자 메모리', () => {
  it('긴 문서 식별자의 저장량이 posting 수만큼 중복되지 않으며 점수와 문서 수를 보존한다', async () => {
    const short = await measurePostingMemory(8);
    const long = await measurePostingMemory(320);
    expect(short.totalDocs).toBe(512);
    expect(long.totalDocs).toBe(short.totalDocs);
    expect(short.scores).toHaveLength(5);
    expect(long.scores).toEqual(short.scores);
    expect(long.bytes - short.bytes).toBeLessThan(16 * 1024 * 1024);
  }, 30000);
});
