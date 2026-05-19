import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddingProvider } from './embedding';
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
}): RequestUrlResponsePromise {
  const jsonPromise = Promise.resolve(data.json);
  const full: RequestUrlResponse = {
    status: data.status,
    headers: {},
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
      const url = typeof request === 'string' ? request : request.url ?? '';
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
      const url = typeof request === 'string' ? request : request.url ?? '';
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
      const url = typeof request === 'string' ? request : request.url ?? '';
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

    await expect(provider.embedBatch(['short'])).rejects.toThrow(
      /Ollama embedding failed/,
    );
  });
});
