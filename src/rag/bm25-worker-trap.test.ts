import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BM25_WORKER_SOURCE } from '../../.local/generated/bm25-worker-source';
import { RAG_WASM_BASE64 } from '../../.local/generated/rag-wasm-bytes';
import type { BM25WorkerRequest, BM25WorkerResponse } from './bm25-worker-runtime';

const calls = vi.hoisted(() => ({ init: vi.fn(), restore: vi.fn(), construct: vi.fn(), free: vi.fn() }));
vi.mock('../../.local/generated/rag-wasm/rag_wasm', () => ({
  initSync: calls.init,
  Bm25RuntimeIndex: class {
    constructor() { calls.construct(); }
    static from_json() { calls.restore(); return new this(); }
    position_index_status_json() { return '{"complete":true}'; }
    total_docs() { return 0; }
    is_ready() { return true; }
    is_tokenizer_current() { return true; }
    free() { calls.free(); }
  },
}));

interface Scope {
  onmessage: ((event: MessageEvent<BM25WorkerRequest>) => void) | null;
  postMessage(response: BM25WorkerResponse): void;
}
let scope: Scope;
let responses: BM25WorkerResponse[];
beforeEach(async () => {
  vi.resetModules();
  Object.values(calls).forEach(call => call.mockReset());
  responses = [];
  scope = { onmessage: null, postMessage: value => responses.push(value) };
  vi.stubGlobal('self', scope);
  await import('./bm25-worker-entry');
});
afterEach(() => vi.unstubAllGlobals());

async function initialize(id: number, snapshot: string): Promise<BM25WorkerResponse> {
  scope.onmessage?.({ data: { id, sessionId: 'b238c776-a0d9-4e69-855a-eb39bcd65c94', revision: 0, part: 0, finalPart: true,
    operation: 'initialize', wasmBase64: 'AGFzbQEAAAA=', snapshot, expectedDocs: 0,
  } } as MessageEvent<BM25WorkerRequest>);
  await vi.waitFor(() => expect(responses.some(value => value.id === id)).toBe(true));
  const response = responses.find(value => value.id === id);
  if (!response) throw new Error('Synthetic response missing');
  return response;
}

describe('BM25 치명적 WASM trap 격리', () => {
  it('배포용 worker 번들도 snapshot trap 후 fallback WASM 호출을 하지 않는다', async () => {
    const worker = new NodeWorker(`
      const { parentPort } = require('node:worker_threads');
      let constructorCalls=0;
      const NativeInstance=WebAssembly.Instance;
      WebAssembly.Instance=new Proxy(NativeInstance,{construct(target,args){
        const instance=Reflect.construct(target,args), exports={...instance.exports};
        const construct=exports.bm25runtimeindex_new;
        exports.bm25runtimeindex_new=(...values)=>{constructorCalls++;return construct(...values);};
        exports.bm25runtimeindex_from_json=()=>{throw new WebAssembly.RuntimeError('synthetic bundled snapshot trap');};
        return {exports};
      }});
      globalThis.self={postMessage:message=>parentPort.postMessage({...message,constructorCalls})};
      ${BM25_WORKER_SOURCE}
      parentPort.on('message',data=>globalThis.self.onmessage({data}));
    `, { eval: true });
    try {
      const response = await new Promise<BM25WorkerResponse & { constructorCalls: number }>((resolve, reject) => {
        worker.once('error', reject);
        worker.once('message', resolve);
        worker.postMessage({ id: 1, sessionId: crypto.randomUUID(), revision: 0, part: 0, finalPart: true,
          operation: 'initialize', wasmBase64: RAG_WASM_BASE64, snapshot: '{}', expectedDocs: 0 });
      });
      expect(response).toMatchObject({ error: 'synthetic bundled snapshot trap', appliedRevision: null, constructorCalls: 0 });
    } finally { await worker.terminate(); }
  });
  it('snapshot trap 뒤 같은 instance의 fallback 생성자나 재초기화를 호출하지 않는다', async () => {
    calls.restore.mockImplementationOnce(() => { throw new WebAssembly.RuntimeError('synthetic snapshot trap'); });
    expect(await initialize(1, '{}')).toMatchObject({ error: 'synthetic snapshot trap', appliedRevision: null });
    expect(calls.construct).not.toHaveBeenCalled();
    expect(calls.free).not.toHaveBeenCalled();
    expect(await initialize(2, '')).toMatchObject({ error: 'synthetic snapshot trap', appliedRevision: null });
    expect(calls.init).toHaveBeenCalledOnce();
    expect(calls.construct).not.toHaveBeenCalled();
  });
  it('초기 WASM trap 뒤 최초 원인을 유지하며 initSync를 다시 호출하지 않는다', async () => {
    calls.init.mockImplementationOnce(() => { throw new WebAssembly.RuntimeError('synthetic initialization trap'); });
    expect(await initialize(1, '')).toMatchObject({ error: 'synthetic initialization trap' });
    expect(await initialize(2, '')).toMatchObject({ error: 'synthetic initialization trap' });
    expect(calls.init).toHaveBeenCalledOnce();
    expect(calls.construct).not.toHaveBeenCalled();
  });
});
