import { describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddingProvider } from './embedding';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

import { requestUrl } from 'obsidian';

describe('OllamaEmbeddingProvider', () => {
  it('컨텍스트 길이 초과 400 응답 시 개선된 에러 메시지를 던진다', async () => {
    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text-v2-moe:latest',
    );

    const mocked = vi.mocked(requestUrl);
    mocked.mockImplementation(((request: string | { url?: string }) => {
      const url = typeof request === 'string' ? request : request.url ?? '';
      if (url.endsWith('/api/embed')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: 'bad request',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      if (url.endsWith('/api/embeddings')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: 'bad request',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      if (url.endsWith('/v1/embeddings')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: '{"error":{"message":"the input length exceeds the context length","type":"invalid_request_error","param":null,"code":null}}',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      return Promise.resolve({
        status: 500,
        json: {},
        text: 'unknown',
      } as unknown as ReturnType<typeof requestUrl>);
    }) as any);

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
    mocked.mockImplementation(((request: string | { url?: string }) => {
      const url = typeof request === 'string' ? request : request.url ?? '';
      if (url.endsWith('/api/embed')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: 'some other error',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      if (url.endsWith('/api/embeddings')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: 'some other error',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      if (url.endsWith('/v1/embeddings')) {
        return Promise.resolve({
          status: 400,
          json: {},
          text: 'some other error',
        }) as unknown as ReturnType<typeof requestUrl>;
      }
      return Promise.resolve({
        status: 500,
        json: {},
        text: 'unknown',
      } as unknown as ReturnType<typeof requestUrl>);
    }) as any);

    await expect(provider.embedBatch(['short'])).rejects.toThrow(
      /Ollama embedding failed/,
    );
  });
});
