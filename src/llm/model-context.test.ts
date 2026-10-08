import { describe, expect, it, vi } from 'vitest';
import { fetchModelContext, withModelContext } from './model-context';
import { planModelContextRust } from '../rag/rust-core';
import {
  fetchProviderModelsForStrategy,
  fetchAnthropicModelInfo,
  fetchOllamaModelInfo,
} from './validation';
import type { LLMProvider } from './providers';

vi.mock('./validation', () => ({
  fetchProviderModelsForStrategy: vi.fn(),
  fetchAnthropicModelInfo: vi.fn(),
  fetchOllamaModelInfo: vi.fn(),
}));

describe('모델 정보와 실제 전송 예산', () => {
  it('Claude와 Ollama는 목록 대신 선택 모델의 상세 정보를 사용한다', async () => {
    const config = { apiKey: '', models: [], enabled: true };
    vi.mocked(fetchAnthropicModelInfo).mockResolvedValue({
      id: 'selected',
      contextLength: 200000,
      maxOutputTokens: 8192,
    });
    expect((await fetchModelContext('claude', config, 'selected')).contextTokens).toBe(200000);
    expect(fetchAnthropicModelInfo).toHaveBeenLastCalledWith(config, 'selected');
    vi.mocked(fetchOllamaModelInfo).mockResolvedValue({ id: 'local', contextLength: 8192 });
    expect((await fetchModelContext('ollama', config, 'local')).contextTokens).toBe(8192);
    expect(fetchOllamaModelInfo).toHaveBeenLastCalledWith('ollama', config, 'local');
  });
  it('모델 조회가 응답하지 않으면 12초 뒤 기본 예산을 사용한다', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchProviderModelsForStrategy).mockImplementation(() => new Promise(() => {}));
      const pending = fetchModelContext(
        'openRouter',
        { apiKey: '', models: [], enabled: true },
        'a',
      );
      await vi.advanceTimersByTimeAsync(12000);
      expect(await pending).toMatchObject({ contextTokens: 50000, source: 'fallback' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('선택 모델의 정확한 ID만 사용하고 조회 실패와 누락은 50,000토큰으로 처리한다', async () => {
    const config = { apiKey: '', models: [], enabled: true };
    vi.mocked(fetchProviderModelsForStrategy).mockResolvedValue({
      valid: true,
      models: ['a', 'ab'],
      modelDetails: [
        { id: 'a', contextLength: 8192 },
        { id: 'ab', contextLength: 128000 },
      ],
    });
    expect((await fetchModelContext('openRouter', config, 'a')).contextTokens).toBe(8192);
    expect((await fetchModelContext('openRouter', config, 'missing')).contextTokens).toBe(50000);
    vi.mocked(fetchProviderModelsForStrategy).mockRejectedValue(new Error('offline'));
    expect((await fetchModelContext('openRouter', config, 'a')).source).toBe('fallback');
  });

  it('메타데이터가 커지면 입력도 늘고 출력·여유 공간은 입력과 분리한다', () => {
    const small = planModelContextRust({ contextLength: 8192, maxOutputTokens: 1024 });
    const large = planModelContextRust({ contextLength: 128000 });
    expect(small?.outputTokens).toBe(1024);
    expect(large!.inputBytes).toBeGreaterThan(small!.inputBytes);
    expect(small!.inputBytes + small!.outputTokens + small!.marginTokens).toBe(8192);
    for (const contextLength of [1, 2, 32, 1024]) {
      const budget = planModelContextRust({ contextLength })!;
      expect(budget.inputBytes + budget.outputTokens + budget.marginTokens).toBe(contextLength);
    }
    for (const value of [0, -1, 1.5, '128000', null]) {
      expect(planModelContextRust({ contextLength: value })?.contextTokens).toBe(50000);
    }
  });

  it('최종 모델 요청에 한도를 전달하고 필수 입력 초과를 네트워크 전에 막는다', async () => {
    const chat = vi.fn().mockResolvedValue('answer');
    const streamChat = vi.fn().mockResolvedValue(undefined);
    const underlying = { chat, streamChat, capability: {} } as unknown as LLMProvider;
    const budget = planModelContextRust({ contextLength: 8192 })!;
    const provider = withModelContext(underlying, budget);
    await provider.chat([{ role: 'user', content: '질문' }]);
    expect(chat.mock.calls[0]?.[3]).toMatchObject({
      inputBudgetBytes: budget.inputBytes,
      maxOutputTokens: budget.outputTokens,
      contextTokens: 8192,
    });
    await expect(provider.chat([{ role: 'user', content: 'a'.repeat(8192) }])).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(1);
    await provider.streamChat([{ role: 'user', content: '질문' }], vi.fn());
    expect(streamChat.mock.calls[0]?.[4]).toMatchObject({ inputBudgetBytes: budget.inputBytes });
  });
});
