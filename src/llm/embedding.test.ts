import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CachedEmbeddingProvider,
  OpenAIEmbeddingProvider,
  type EmbeddingOptions,
  type EmbeddingProvider,
} from './embedding';

vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));

describe('OpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('embedding fetch에 AbortSignal을 전달한다', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: [1, 0] }] }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAIEmbeddingProvider('key');

    await provider.embedBatch(['hello'], { signal: controller.signal });

    const init = (fetchMock.mock.calls[0] as unknown[] | undefined)?.[1] as
      | RequestInit
      | undefined;
    expect(init?.signal).toBe(controller.signal);
  });
});

describe('CachedEmbeddingProvider', () => {
  it('inner provider에 취소 옵션을 전달한다', async () => {
    const controller = new AbortController();
    const embedBatch = vi.fn((texts: string[], _options?: EmbeddingOptions) => {
      void _options;
      return Promise.resolve(texts.map(() => [1, 0]));
    });
    const inner: EmbeddingProvider = {
      embed: () => Promise.resolve([1, 0]),
      embedBatch,
    };
    const provider = new CachedEmbeddingProvider(inner, `test-${Date.now()}`);

    await provider.embedBatch(['cache miss'], { signal: controller.signal });

    expect(embedBatch).toHaveBeenCalledWith(['cache miss'], { signal: controller.signal });
  });
});
