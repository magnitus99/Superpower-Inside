import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  tokenize: vi.fn(),
  loadTokenizer: vi.fn(),
  wasm: { numThreads: 1, proxy: false, wasmBinary: new ArrayBuffer(0), wasmPaths: {} },
}));

class TestTensor {
  readonly dispose = vi.fn();
  constructor(
    readonly data: Float32Array | BigInt64Array,
    readonly dims: readonly number[] = [1],
  ) {}
  get size(): number {
    return this.data.length;
  }
}
class TestOnnxTensor extends TestTensor {
  constructor(type: string, data: Float32Array | BigInt64Array, dims?: readonly number[]) {
    super(data, dims);
    if (type !== 'float32' && type !== 'int64') throw new Error('잘못된 텐서 형식');
  }
}
vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: mocks.loadTokenizer },
  env: { backends: { onnx: { wasm: mocks.wasm } } },
  LogLevel: { NONE: 0 },
  Tensor: TestTensor,
}));
vi.mock('onnxruntime-web', () => ({
  InferenceSession: { create: mocks.load },
  Tensor: TestOnnxTensor,
}));
interface WorkerRequest {
  id: number;
  operation: 'initialize' | 'embed';
  assets?: Record<string, ArrayBuffer>;
  texts?: string[];
}
const worker = {
  onmessage: undefined as ((event: { data: WorkerRequest }) => void) | undefined,
  postMessage: vi.fn(),
};
async function request(data: WorkerRequest): Promise<Record<string, unknown>> {
  worker.onmessage?.({ data });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  const response: unknown = worker.postMessage.mock.lastCall?.[0];
  worker.postMessage.mockClear();
  if (typeof response !== 'object' || response === null) throw new Error('작업자 응답 누락');
  return response as Record<string, unknown>;
}
const assets = {
  'embeddinggemma-runtime.wasm': new ArrayBuffer(1),
  'embeddinggemma-runtime.mjs': new ArrayBuffer(1),
  'onnx/model.onnx': new ArrayBuffer(1),
  'onnx/model.onnx_data': new ArrayBuffer(1),
};
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal('self', worker);
  vi.stubGlobal('navigator', { gpu: { requestAdapter: () => Promise.resolve({}) } });
  mocks.tokenize.mockImplementation(() => ({ input_ids: new TestTensor(new BigInt64Array(1)) }));
  mocks.loadTokenizer.mockResolvedValue(mocks.tokenize);
  await import('./embeddinggemma-worker-entry');
});
afterEach(() => vi.unstubAllGlobals());

describe('EmbeddingGemma 자동 자원 활용', () => {
  it('GPU가 감지되지 않으면 CPU 상태에 GPU 가용성을 표시하지 않는다', async () => {
    vi.stubGlobal('navigator', {});
    mocks.load.mockRejectedValueOnce(new Error('No adapter')).mockResolvedValueOnce({});
    expect(await request({ id: 1, operation: 'initialize', assets })).toMatchObject({
      backend: 'wasm',
      gpuAvailable: false,
    });
  });
  it('GPU를 우선 사용하고 여러 입력을 실제 단일 추론으로 처리한다', async () => {
    const embedding = new TestOnnxTensor('float32', new Float32Array(2 * 768));
    const run = vi.fn(() => Promise.resolve({ sentence_embedding: embedding }));
    mocks.load.mockResolvedValue({ run, inputNames: ['input_ids'], release: vi.fn() });
    expect(await request({ id: 1, operation: 'initialize', assets })).toMatchObject({
      backend: 'webgpu',
    });
    expect(mocks.load).toHaveBeenCalledWith(
      assets['onnx/model.onnx'],
      expect.objectContaining({
        executionProviders: ['webgpu'],
        externalData: [{ path: 'model.onnx_data', data: assets['onnx/model.onnx_data'] }],
      }),
    );
    const response = await request({ id: 2, operation: 'embed', texts: ['짧은 문서', '긴 문서'] });
    expect(response).toMatchObject({ rows: 2, dimensions: 768 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.tokenize).toHaveBeenCalledWith(
      ['짧은 문서', '긴 문서'],
      expect.objectContaining({
        padding: true,
        truncation: true,
        max_length: 2048,
      }),
    );
    expect(embedding.dispose).toHaveBeenCalledOnce();
  });
  it('GPU 초기화 실패 시 동일 FP32 모델과 자동 CPU 스레드로 복구한다', async () => {
    mocks.load.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce({});
    expect(await request({ id: 1, operation: 'initialize', assets })).toMatchObject({
      backend: 'wasm',
      fallbackReason: 'GPU unavailable',
      gpuAvailable: true,
    });
    expect(mocks.load).toHaveBeenLastCalledWith(
      assets['onnx/model.onnx'],
      expect.objectContaining({
        executionProviders: ['wasm'],
      }),
    );
    expect(mocks.wasm.numThreads).toBe(0);
  });
  it('GPU 추론 실패 시 텐서를 정리하고 같은 입력을 CPU에서 재시도한다', async () => {
    const gpu = {
      run: vi.fn(() => Promise.reject(new Error('GPU inference failed'))),
      inputNames: ['input_ids'],
      release: vi.fn(() => Promise.resolve()),
    };
    const cpu = {
      run: vi.fn(() =>
        Promise.resolve({
          sentence_embedding: new TestOnnxTensor('float32', new Float32Array(768)),
        }),
      ),
      inputNames: ['input_ids'],
      release: vi.fn(),
    };
    mocks.load.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
    await request({ id: 1, operation: 'initialize', assets });
    expect(await request({ id: 2, operation: 'embed', texts: ['본문'] })).toMatchObject({
      backend: 'wasm',
      fallbackReason: 'GPU inference failed',
      rows: 1,
    });
    expect(gpu.release).toHaveBeenCalledOnce();
    expect(cpu.run).toHaveBeenCalledOnce();
    const inputs: unknown = mocks.tokenize.mock.results[0].value;
    if (typeof inputs !== 'object' || inputs === null || !('input_ids' in inputs))
      throw new Error('입력 텐서 누락');
    expect(inputs.input_ids).toBeInstanceOf(TestTensor);
    if (inputs.input_ids instanceof TestTensor) expect(inputs.input_ids.dispose).toHaveBeenCalled();
    await request({ id: 3, operation: 'embed', texts: ['다음 본문'] });
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('CPU에서도 배치 행 수가 틀리면 결과를 저장하지 않고 텐서를 정리한다', async () => {
    const invalid = new TestOnnxTensor('float32', new Float32Array(384));
    const cpu = {
      run: vi.fn(() => Promise.resolve({ sentence_embedding: invalid })),
      inputNames: ['input_ids'],
      release: vi.fn(),
    };
    mocks.load.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce(cpu);
    await request({ id: 1, operation: 'initialize', assets });
    expect(
      await request({ id: 2, operation: 'embed', texts: ['첫 문서', '둘째 문서'] }),
    ).toMatchObject({ error: 'EmbeddingGemma returned invalid dimensions.' });
    expect(invalid.dispose).toHaveBeenCalledOnce();
  });

  it('CPU 복구에서는 길이가 다른 청크를 개별 추론하고 입력 순서로 복원한다', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        sentence_embedding: new TestOnnxTensor('float32', new Float32Array(768).fill(1)),
      })
      .mockResolvedValueOnce({
        sentence_embedding: new TestOnnxTensor('float32', new Float32Array(768).fill(2)),
      });
    mocks.load.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce({
      run,
      inputNames: ['input_ids'],
      release: vi.fn(),
    });
    await request({ id: 1, operation: 'initialize', assets });
    const response = await request({
      id: 2,
      operation: 'embed',
      texts: ['짧음', '긴 문서'.repeat(100)],
    });
    expect(response).toMatchObject({ rows: 2, dimensions: 768, backend: 'wasm' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(mocks.tokenize).toHaveBeenNthCalledWith(1, ['짧음'], expect.any(Object));
    expect(mocks.tokenize).toHaveBeenNthCalledWith(2, ['긴 문서'.repeat(100)], expect.any(Object));
    if (!(response.values instanceof ArrayBuffer)) throw new Error('임베딩 버퍼 누락');
    expect(Array.from(new Float32Array(response.values))).toEqual([
      ...new Array<number>(768).fill(1),
      ...new Array<number>(768).fill(2),
    ]);
  });
});
