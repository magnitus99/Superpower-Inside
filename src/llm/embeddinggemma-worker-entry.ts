import {
  AutoModel,
  AutoTokenizer,
  env,
  LogLevel,
  Tensor,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';

interface Request {
  id: number;
  operation: 'initialize' | 'embed';
  assets?: Record<string, ArrayBuffer>;
  texts?: string[];
}
let tokenizer: PreTrainedTokenizer | undefined;
let model: PreTrainedModel | undefined;
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<Request>): void => {
  queue = queue.then(async () => {
    const { id, operation, assets, texts } = event.data;
    try {
      if (operation === 'initialize') {
        if (!assets) throw new Error('EmbeddingGemma assets are missing.');
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.useFS = false;
        env.useFSCache = false;
        env.useBrowserCache = false;
        env.useWasmCache = false;
        env.logLevel = LogLevel.NONE;
        env.localModelPath = '/models/';
        env.fetch = (input: string | URL): Promise<Response> => {
          const path = String(input);
          const file = Object.keys(assets).find((name) => path.endsWith(`/${name}`));
          if (!file) return Promise.resolve(new Response(null, { status: 404 }));
          const bytes = assets[file];
          const response = new Response(null, {
            status: 200,
            headers: { 'content-length': String(bytes.byteLength) },
          });
          response.arrayBuffer = () => Promise.resolve(bytes);
          return Promise.resolve(response);
        };
        const wasm = env.backends.onnx.wasm;
        if (!wasm) throw new Error('ONNX WebAssembly backend is unavailable.');
        wasm.numThreads = 1;
        wasm.proxy = false;
        wasm.wasmBinary = assets['embeddinggemma-runtime.wasm'];
        wasm.wasmPaths = {
          mjs: URL.createObjectURL(
            new Blob([assets['embeddinggemma-runtime.mjs']], { type: 'text/javascript' }),
          ),
        };
        tokenizer = await AutoTokenizer.from_pretrained('embeddinggemma', {
          local_files_only: true,
        });
        model = await AutoModel.from_pretrained('embeddinggemma', {
          local_files_only: true,
          device: 'wasm',
          dtype: 'fp32',
          use_external_data_format: true,
        });
        self.postMessage({ id });
        return;
      }
      if (!model || !tokenizer || !texts)
        throw new Error('EmbeddingGemma worker is not initialized.');
      const values = new Float32Array(texts.length * 768);
      for (let index = 0; index < texts.length; index++) {
        const inputs = tokenizer(texts[index], {
          padding: true,
          truncation: true,
          max_length: 2048,
        });
        const output: unknown = await model(inputs);
        if (typeof output !== 'object' || output === null || !('sentence_embedding' in output))
          throw new Error('EmbeddingGemma returned no sentence embedding.');
        const embedding = output.sentence_embedding;
        if (
          !(embedding instanceof Tensor) ||
          embedding.size !== 768 ||
          !(embedding.data instanceof Float32Array)
        )
          throw new Error('EmbeddingGemma returned invalid dimensions.');
        values.set(embedding.data, index * 768);
        for (const tensor of [...Object.values(output), ...Object.values(inputs)])
          if (tensor instanceof Tensor) tensor.dispose();
      }
      self.postMessage(
        { id, dimensions: 768, rows: texts.length, values: values.buffer },
        { transfer: [values.buffer] },
      );
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
