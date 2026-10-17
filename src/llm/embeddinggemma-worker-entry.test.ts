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
    mocks.tokenize.mockImplementation((texts: string[]) => ({
      input_ids: new TestTensor(new BigInt64Array(texts.length), [texts.length, 1]),
    }));
    const gpu = {
      run: vi.fn(() => Promise.reject(new Error('GPU inference failed'))),
      inputNames: ['input_ids'],
      release: vi.fn(() => Promise.resolve()),
    };
    const cpu = {
      run: vi.fn((inputs: Record<string, TestOnnxTensor>) =>
        Promise.resolve({
          sentence_embedding: new TestOnnxTensor(
            'float32',
            new Float32Array(inputs.input_ids.dims[0] * 768),
          ),
        }),
      ),
      inputNames: ['input_ids'],
      release: vi.fn(),
    };
    mocks.load.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
    await request({ id: 1, operation: 'initialize', assets });
    const texts = ['본문 하나', '본문 둘', '본문 셋', '본문 넷', '본문 다섯'];
    expect(await request({ id: 2, operation: 'embed', texts })).toMatchObject({
      backend: 'wasm',
      fallbackReason: 'GPU inference failed',
      rows: 5,
    });
    expect(gpu.release).toHaveBeenCalledOnce();
    expect(cpu.run).toHaveBeenCalledTimes(2);
    expect(mocks.tokenize.mock.calls.map((call): unknown => call[0])).toEqual([
      texts,
      texts.slice(0, 4),
      texts.slice(4),
    ]);
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

  it('CPU의 후속 배치 실패는 부분 결과를 반환하지 않고 정리한 뒤 다음 요청을 처리한다', async () => {
    const first = new TestOnnxTensor('float32', new Float32Array(4 * 768));
    const next = new TestOnnxTensor('float32', new Float32Array(768));
    const run = vi
      .fn()
      .mockResolvedValueOnce({ sentence_embedding: first })
      .mockRejectedValueOnce(new Error('CPU inference failed'))
      .mockResolvedValueOnce({ sentence_embedding: next });
    mocks.load.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce({
      run,
      inputNames: ['input_ids'],
      release: vi.fn(),
    });
    await request({ id: 1, operation: 'initialize', assets });
    const response = await request({ id: 2, operation: 'embed', texts: ['a', 'b', 'c', 'd', 'e'] });
    expect(response).toEqual({ id: 2, error: 'CPU inference failed' });
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(await request({ id: 3, operation: 'embed', texts: ['f'] })).toMatchObject({
      rows: 1,
      backend: 'wasm',
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(next.dispose).toHaveBeenCalledOnce();
    for (const { value } of mocks.tokenize.mock.results) {
      const tokens: unknown = value;
      if (
        typeof tokens !== 'object' ||
        tokens === null ||
        !('input_ids' in tokens) ||
        !(tokens.input_ids instanceof TestTensor)
      )
        throw new Error('입력 텐서 누락');
      expect(tokens.input_ids.dispose).toHaveBeenCalledOnce();
    }
  });

  it.each([512, 513, 2048, 4096])(
    'CPU 길이 혼합에서 최대 토큰 길이 %i의 추론 메모리를 제한한다',
    async (length) => {
      const allocated: TestTensor[] = [];
      mocks.tokenize.mockImplementation((texts: string[]) => {
        const width = Math.min(2048, Math.max(...texts.map((text) => text.length)));
        const tensor = new TestTensor(new BigInt64Array(texts.length * width), [
          texts.length,
          width,
        ]);
        allocated.push(tensor);
        return { input_ids: tensor };
      });
      const run = vi.fn((inputs: Record<string, TestOnnxTensor>) => {
        const [rows, width] = inputs.input_ids.dims;
        expect(rows * width).toBeLessThanOrEqual(2048);
        const embedding = new TestOnnxTensor('float32', new Float32Array(rows * 768));
        allocated.push(inputs.input_ids, embedding);
        return Promise.resolve({ sentence_embedding: embedding });
      });
      mocks.load.mockRejectedValueOnce(new Error('GPU unavailable')).mockResolvedValueOnce({
        run,
        inputNames: ['input_ids'],
        release: vi.fn(),
      });
      await request({ id: 1, operation: 'initialize', assets });
      expect(
        await request({ id: 2, operation: 'embed', texts: ['a', 'b'.repeat(length), 'c', 'd'] }),
      ).toMatchObject({
        rows: 4,
        backend: 'wasm',
      });
      expect(run).toHaveBeenCalledTimes(length <= 512 ? 1 : 4);
      for (const tensor of allocated) expect(tensor.dispose).toHaveBeenCalledOnce();
    },
  );

  it.each([0, 1, 3, 4, 5, 9])(
    'CPU 입력 %i개를 최대 4행의 실제 배치로 처리하고 순서를 보존한다',
    async (count) => {
      const texts = Array.from({ length: count }, (_, index) => `합성 문서 ${index}`);
      const outputs: TestOnnxTensor[] = [];
      const tokens: TestTensor[] = [];
      mocks.tokenize.mockImplementation((batch: string[]) => {
        const data = new BigInt64Array(batch.map((text) => BigInt(texts.indexOf(text) + 1)));
        const input = new TestTensor(data, [batch.length, 1]);
        tokens.push(input);
        return { input_ids: input };
      });
      const run = vi.fn(async (inputs: Record<string, TestOnnxTensor>) => {
        // 이전 배치가 해제된 뒤에만 다음 추론을 시작해야 합니다.
        for (const output of outputs) expect(output.dispose).toHaveBeenCalledOnce();
        await Promise.resolve();
        const data = Float32Array.from(inputs.input_ids.data, Number);
        const embedding = new TestOnnxTensor(
          'float32',
          Float32Array.from(
            { length: data.length * 768 },
            (_, index) => data[Math.floor(index / 768)],
          ),
          [data.length, 768],
        );
        outputs.push(embedding);
        return { sentence_embedding: embedding };
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
        texts,
      });
      expect(response).toMatchObject({ rows: count, dimensions: 768, backend: 'wasm' });
      expect(run).toHaveBeenCalledTimes(Math.ceil(count / 4));
      for (let index = 0; index < count; index += 4) {
        expect(mocks.tokenize).toHaveBeenNthCalledWith(
          index / 4 + 1,
          texts.slice(index, index + 4),
          {
            padding: true,
            truncation: true,
            max_length: 2048,
          },
        );
      }
      if (!(response.values instanceof ArrayBuffer)) throw new Error('임베딩 버퍼 누락');
      expect(Array.from(new Float32Array(response.values))).toEqual([
        ...texts.flatMap((_, index) => new Array<number>(768).fill(index + 1)),
      ]);
      for (const tensor of [...tokens, ...outputs]) expect(tensor.dispose).toHaveBeenCalledOnce();
      for (const [inputs] of run.mock.calls)
        expect(inputs.input_ids.dispose).toHaveBeenCalledOnce();
    },
  );
});
