import {
  AutoTokenizer,
  env,
  LogLevel,
  Tensor,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { InferenceSession, Tensor as OnnxTensor } from 'onnxruntime-web';

interface Request {
  id: number;
  operation: 'initialize' | 'embed';
  assets?: Record<string, ArrayBuffer>;
  texts?: string[];
}
let tokenizer: PreTrainedTokenizer | undefined;
let model: InferenceSession | undefined;
let modelAssets: Record<string, ArrayBuffer> = {};
let queue = Promise.resolve();
let backend: 'webgpu' | 'wasm' = 'webgpu';
let fallbackReason: string | undefined;

self.onmessage = (event: MessageEvent<Request>): void => {
  queue = queue.then(async () => {
    const { id, operation, assets, texts } = event.data;
    try {
      if (operation === 'initialize') {
        if (!assets) throw new Error('EmbeddingGemma assets are missing.');
        modelAssets = assets;
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
        // ONNX가 지원 환경과 CPU 코어 수에 맞춰 스레드를 자동 선택합니다.
        wasm.numThreads = 0;
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
        try {
          model = await loadModel('webgpu');
        } catch (error) {
          fallbackReason = error instanceof Error ? error.message : String(error);
          backend = 'wasm';
          model = await loadModel('wasm');
        }
        self.postMessage({ id, backend, threads: wasm.numThreads, fallbackReason });
        return;
      }
      if (!model || !tokenizer || !texts)
        throw new Error('EmbeddingGemma worker is not initialized.');
      let values: Float32Array;
      try {
        values = await inferTexts(texts);
      } catch (error) {
        if (backend !== 'webgpu') throw error;
        fallbackReason = error instanceof Error ? error.message : String(error);
        const failedModel = model;
        model = undefined;
        await failedModel.release();
        backend = 'wasm';
        model = await loadModel('wasm');
        values = await inferTexts(texts);
      }
      self.postMessage(
        { id, dimensions: 768, rows: texts.length, values: values.buffer, backend, fallbackReason },
        { transfer: [values.buffer] },
      );
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};

function loadModel(device: 'webgpu' | 'wasm'): Promise<InferenceSession> {
  // 검증된 동일 FP32 모델을 사용하며 실패한 세션의 상태를 재사용하지 않습니다.
  return InferenceSession.create(modelAssets['onnx/model.onnx'], {
    executionProviders: [device],
    externalData: [{ path: 'model.onnx_data', data: modelAssets['onnx/model.onnx_data'] }],
    logSeverityLevel: 3,
  });
}

async function inferTexts(texts: string[]): Promise<Float32Array> {
  if (backend === 'webgpu') return inferBatch(texts);
  // CPU에서는 길이가 다른 청크의 패딩 연산을 피하고 ONNX의 다중 스레드를 활용합니다.
  const values = new Float32Array(texts.length * 768);
  for (let index = 0; index < texts.length; index++) {
    values.set(await inferBatch([texts[index]]), index * 768);
  }
  return values;
}

async function inferBatch(texts: string[]): Promise<Float32Array> {
  if (!model || !tokenizer) throw new Error('EmbeddingGemma worker is not initialized.');
  const tokens = tokenizer(texts, { padding: true, truncation: true, max_length: 2048 });
  const tokenInputs: Record<string, unknown> = {
    input_ids: tokens.input_ids,
    attention_mask: tokens.attention_mask,
  };
  const inputs: Record<string, OnnxTensor> = {};
  let output: InferenceSession.OnnxValueMapType | undefined;
  try {
    for (const name of model.inputNames) {
      const token = tokenInputs[name];
      if (!(token instanceof Tensor) || !(token.data instanceof BigInt64Array))
        throw new Error('EmbeddingGemma returned invalid input tensors.');
      inputs[name] = new OnnxTensor('int64', token.data, token.dims);
    }
    output = await model.run(inputs);
    if (!('sentence_embedding' in output))
      throw new Error('EmbeddingGemma returned no sentence embedding.');
    const embedding = output.sentence_embedding;
    if (
      !(embedding instanceof OnnxTensor) ||
      embedding.size !== texts.length * 768 ||
      !(embedding.data instanceof Float32Array)
    )
      throw new Error('EmbeddingGemma returned invalid dimensions.');
    // 결과 버퍼는 텐서를 해제하기 전에 복사하여 작업자 응답으로 넘깁니다.
    return embedding.data.slice();
  } finally {
    const inputTensors: unknown[] = Object.values(tokens);
    const outputTensors: unknown[] =
      typeof output === 'object' && output !== null ? Object.values(output) : [];
    const tensors = new Set([...inputTensors, ...Object.values(inputs), ...outputTensors]);
    for (const tensor of tensors)
      if (tensor instanceof Tensor || tensor instanceof OnnxTensor) tensor.dispose();
  }
}
