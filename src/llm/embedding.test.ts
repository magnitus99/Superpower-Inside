import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CachedEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingCacheNamespace,
  type EmbeddingProvider,
} from './embedding';
import { createLogger } from '../utils/logger';
import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
  type RequestUrlResponsePromise,
} from 'obsidian';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

/** Obsidian requestUrl이 반환하는 RequestUrlResponsePromise을 생성한다 */
function mockResponse(data: {
  status: number;
  json: Record<string, unknown>;
  text: string;
  headers?: Record<string, string>;
}): RequestUrlResponsePromise {
  const jsonPromise = Promise.resolve(data.json);
  const full: RequestUrlResponse = {
    status: data.status,
    headers: data.headers ?? {},
    arrayBuffer: new ArrayBuffer(0),
    json: data.json,
    text: data.text,
  };
  const promise = Promise.resolve(full);
  return Object.assign(promise, {
    arrayBuffer: promise.then((r) => r.arrayBuffer),
    json: jsonPromise,
    text: promise.then((r) => r.text),
  });
}

function parseRequestBody(request: string | RequestUrlParam): Record<string, unknown> {
  if (typeof request === 'string' || typeof request.body !== 'string') {
    throw new Error('테스트 요청 body가 문자열이 아닙니다.');
  }
  return JSON.parse(request.body) as Record<string, unknown>;
}

describe('OllamaEmbeddingProvider', () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it('컨텍스트 길이 초과 400 응답 시 개선된 에러 메시지를 던진다', async () => {
    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text-v2-moe:latest',
    );

    const mocked = vi.mocked(requestUrl);
    mocked.mockImplementation((request: string | RequestUrlParam) => {
      const url = typeof request === 'string' ? request : (request.url ?? '');
      if (url.endsWith('/api/embed')) {
        return mockResponse({ status: 400, json: {}, text: 'bad request' });
      }
      if (url.endsWith('/api/embeddings')) {
        return mockResponse({ status: 400, json: {}, text: 'bad request' });
      }
      if (url.endsWith('/v1/embeddings')) {
        return mockResponse({
          status: 400,
          json: {},
          text: '{"error":{"message":"the input length exceeds the context length","type":"invalid_request_error","param":null,"code":null}}',
        });
      }
      return mockResponse({ status: 500, json: {}, text: 'unknown' });
    });

    await expect(provider.embedBatch(['a'.repeat(5000)])).rejects.toThrow(
      /긴 단일 줄|로그 파일|재인덱싱/,
    );
  });

  it('여러 입력을 배열 한 번이 아니라 단일 요청들로 처리하고 결과 순서를 유지한다', async () => {
    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text-v2-moe:latest',
    );

    const mocked = vi.mocked(requestUrl);
    mocked.mockImplementation((request: string | RequestUrlParam) => {
      const url = typeof request === 'string' ? request : (request.url ?? '');
      if (!url.endsWith('/api/embed')) {
        return mockResponse({ status: 500, json: {}, text: 'unexpected fallback' });
      }

      const body = parseRequestBody(request);
      if (body.input === 'first') {
        return mockResponse({ status: 200, json: { embeddings: [[1, 0]] }, text: '' });
      }
      if (body.input === 'second') {
        return mockResponse({ status: 200, json: { embeddings: [[0, 1]] }, text: '' });
      }
      return mockResponse({ status: 400, json: {}, text: 'unexpected input' });
    });

    const vectors = await provider.embedBatch(['first', 'second']);
    const inputs = mocked.mock.calls.map(([request]) => parseRequestBody(request).input);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(inputs).toEqual(['first', 'second']);
    expect(inputs.every((input) => typeof input === 'string')).toBe(true);
  });

  it('일반 400 오류는 기존 형식의 에러 메시지를 유지한다', async () => {
    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text-v2-moe:latest',
    );

    const mocked = vi.mocked(requestUrl);
    mocked.mockImplementation((request: string | RequestUrlParam) => {
      const url = typeof request === 'string' ? request : (request.url ?? '');
      if (url.endsWith('/api/embed')) {
        return mockResponse({ status: 400, json: {}, text: 'some other error' });
      }
      if (url.endsWith('/api/embeddings')) {
        return mockResponse({ status: 400, json: {}, text: 'some other error' });
      }
      if (url.endsWith('/v1/embeddings')) {
        return mockResponse({ status: 400, json: {}, text: 'some other error' });
      }
      return mockResponse({ status: 500, json: {}, text: 'unknown' });
    });

    await expect(provider.embedBatch(['short'])).rejects.toThrow(/Ollama embedding failed/);
  });
});

describe('OpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it('requestUrl로 OpenAI-compatible embeddings endpoint를 호출한다', async () => {
    vi.mocked(requestUrl).mockImplementationOnce(() =>
      mockResponse({
        status: 200,
        json: { data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] },
        text: '',
      }),
    );
    const provider = new OpenAIEmbeddingProvider(
      'test-key',
      'http://localhost:1234/v1/embeddings',
      'custom-embedding',
    );

    const vectors = await provider.embedBatch(['first', 'second']);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:1234/v1/embeddings',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          input: ['first', 'second'],
          model: 'custom-embedding',
        }),
        throw: false,
      }),
    );
  });

  it('429 rate limit 응답은 retry-after/backoff 이후 재시도하고 통합 로거에 남긴다', async () => {
    const logger = createLogger({ minLevel: 'trace', maxEntries: 100, mirrorToConsole: false });
    const delays: number[] = [];
    vi.mocked(requestUrl)
      .mockImplementationOnce(() =>
        mockResponse({
          status: 429,
          json: {},
          text: 'rate limited',
          headers: { 'retry-after': '2' },
        }),
      )
      .mockImplementationOnce(() =>
        mockResponse({
          status: 200,
          json: { data: [{ embedding: [0.5, 0.6] }] },
          text: '',
        }),
      );

    const provider = new OpenAIEmbeddingProvider(
      'test-key',
      'http://localhost:1234/v1',
      'custom-embedding',
      {
        logger,
        retry: {
          maxRetries: 2,
          baseDelayMs: 10,
          maxDelayMs: 10_000,
          sleep: (ms) => {
            delays.push(ms);
            return Promise.resolve();
          },
        },
      },
    );

    await expect(provider.embedBatch(['first'])).resolves.toEqual([[0.5, 0.6]]);

    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        source: 'embedding.openai',
        message: 'Embedding API rate limited; retrying request.',
      }),
    );
  });
});

describe('CachedEmbeddingProvider', () => {
  it('provider와 model을 함께 cache namespace에 포함한다', () => {
    expect(createEmbeddingCacheNamespace('openai', 'shared-model')).toBe('openai::shared-model');
    expect(createEmbeddingCacheNamespace('ollama', 'shared-model')).toBe('ollama::shared-model');
  });

  it('같은 텍스트라도 cache namespace가 다르면 서로 다른 벡터를 저장한다', async () => {
    const first = new CachedEmbeddingProvider(
      createStaticEmbeddingProvider([1, 0]),
      'openai::model',
    );
    const second = new CachedEmbeddingProvider(
      createStaticEmbeddingProvider([0, 1]),
      'ollama::model',
    );
    await first.clearCache();

    await expect(first.embed('same text')).resolves.toEqual([1, 0]);
    await expect(second.embed('same text')).resolves.toEqual([0, 1]);

    await second.clearCache();
  });

  it('batch cache hit와 duplicate miss를 입력 순서대로 복원하고 missing unique text만 요청한다', async () => {
    const calls: string[][] = [];
    const provider = new CachedEmbeddingProvider(
      {
        embed: (text) => Promise.resolve(vectorForText(text)),
        embedBatch: (texts) => {
          calls.push([...texts]);
          return Promise.resolve(texts.map(vectorForText));
        },
      },
      'openai::dedupe-model',
    );
    await provider.clearCache();
    await provider.embedBatch(['cached']);
    calls.length = 0;

    await expect(provider.embedBatch(['cached', 'missing', 'cached', 'missing'])).resolves.toEqual([
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(calls).toEqual([['missing']]);

    await provider.clearCache();
  });
});

function createStaticEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: () => Promise.resolve(vector),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => vector)),
  };
}

function vectorForText(text: string): number[] {
  return text === 'cached' ? [1, 0] : [0, 1];
}
