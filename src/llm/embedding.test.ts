import { describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddingProvider } from './embedding';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse, type RequestUrlResponsePromise } from 'obsidian';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

/** Obsidian requestUrl이 반환하는 RequestUrlResponsePromise을 생성한다 */
function mockResponse(data: { status: number; json: Record<string, unknown>; text: string }): RequestUrlResponsePromise {
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
    arrayBuffer: promise.then(r => r.arrayBuffer),
    json: jsonPromise,
    text: promise.then(r => r.text),
  });
}

describe('OllamaEmbeddingProvider', () => {
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

    await expect(
      provider.embedBatch(['a'.repeat(5000)]),
    ).rejects.toThrow(/청크 크기.*chunkSize.*줄이/);
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
