import * as ternlightGlue from '../../node_modules/@ternlight/base/pkg-bundler/tern_engine_bg.js';

interface TernlightWorkerRequest {
  id: number;
  operation: 'initialize' | 'embed';
  wasmBytes?: ArrayBuffer;
  texts?: string[];
}

interface TernlightWorkerResponse {
  id: number;
  dimensions?: number;
  rows?: number;
  values?: ArrayBuffer;
  error?: string;
}

let initialized = false;

self.onmessage = (event: MessageEvent<TernlightWorkerRequest>): void => {
  const { id, operation } = event.data;
  try {
    if (operation === 'initialize') {
      const wasmBytes = event.data.wasmBytes;
      if (!wasmBytes) throw new Error('Ternlight worker WASM payload is missing.');
      initialize(wasmBytes);
      self.postMessage({ id } satisfies TernlightWorkerResponse);
      return;
    }
    if (!initialized) throw new Error('Ternlight worker is not initialized.');
    const texts = event.data.texts;
    if (!texts) throw new Error('Ternlight worker input is missing.');
    const vectors = texts.map((text) => ternlightGlue.embed(text));
    const dimensions = vectors[0]?.length ?? 0;
    if (vectors.some((vector) => vector.length !== dimensions)) {
      throw new Error('Ternlight worker returned inconsistent vector dimensions.');
    }
    const values = new Float32Array(texts.length * dimensions);
    vectors.forEach((vector, index) => values.set(vector, index * dimensions));
    const response = {
      id,
      dimensions,
      rows: texts.length,
      values: values.buffer,
    } satisfies TernlightWorkerResponse;
    self.postMessage(response, { transfer: [values.buffer] });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies TernlightWorkerResponse);
  }
};

function initialize(wasmBytes: ArrayBuffer): void {
  if (initialized) return;
  const imports = {
    './tern_engine_bg.js': ternlightGlue as unknown as WebAssembly.ModuleImports,
  };
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, imports);
  ternlightGlue.__wbg_set_wasm(instance.exports);
  const start = instance.exports.__wbindgen_start as (() => void) | undefined;
  start?.();
  initialized = true;
}
