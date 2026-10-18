import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import { withTurnUsage } from './turn-usage';
import type { TurnUsageSnapshot } from './types';

function provider(): LLMProvider {
  return {
    capability: resolveProviderCapability({ providerKey: 'openai', model: 'synthetic' }),
    chat: vi
      .fn<LLMProvider['chat']>()
      .mockImplementation((_messages, _temperature, _tools, options) => {
        options?.onUsage?.({ inputTokens: 20, outputTokens: 4, totalTokens: 24 });
        return Promise.resolve('answer');
      }),
    streamChat: vi
      .fn<LLMProvider['streamChat']>()
      .mockImplementation((_messages, onChunk, _temperature, _tools, options) => {
        options?.onUsage?.({ inputTokens: 30, outputTokens: 0 });
        onChunk({ content: 'answer', done: false });
        options?.onUsage?.({ outputTokens: 8 });
        options?.onUsage?.({ outputTokens: 8 });
        onChunk({ content: '', done: true });
        return Promise.resolve();
      }),
  };
}

describe('응답 전체 모델 사용량', () => {
  it('연구 chat와 답변 streamChat을 함께 합산하고 누적 델타를 중복 계산하지 않는다', async () => {
    const updates: TurnUsageSnapshot[] = [];
    const underlying = provider();
    const tracked = withTurnUsage(underlying, (snapshot) => updates.push(snapshot));
    const onUsage = vi.fn();
    const onChunk = vi.fn();
    expect(await tracked.chat([], 0.2, undefined, { onUsage })).toBe('answer');
    await tracked.streamChat([], onChunk);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 4, totalTokens: 24 });
    expect(onChunk).toHaveBeenCalledWith({ content: 'answer', done: false });
    expect(updates.at(-1)).toEqual({
      requests: 2,
      reportedRequests: 2,
      inputTokens: 50,
      outputTokens: 12,
      totalTokens: 62,
    });
    expect(tracked.capability).toBe(underlying.capability);
  });

  it('실패하거나 사용량을 제공하지 않은 요청은 0토큰으로 꾸미지 않는다', async () => {
    const underlying = provider();
    underlying.chat = vi.fn().mockRejectedValue(new Error('failed'));
    const updates: TurnUsageSnapshot[] = [];
    const tracked = withTurnUsage(underlying, (snapshot) => updates.push(snapshot));
    await expect(tracked.chat([])).rejects.toThrow('failed');
    expect(updates.at(-1)).toEqual({ requests: 1, reportedRequests: 0, partial: true });
  });

  it('승인 재개는 이전 사용량을 보존한다', async () => {
    const updates: TurnUsageSnapshot[] = [];
    const tracked = withTurnUsage(provider(), (snapshot) => updates.push(snapshot), {
      requests: 3,
      reportedRequests: 2,
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
    });
    await tracked.chat([]);
    expect(updates.at(-1)).toEqual({
      requests: 4,
      reportedRequests: 3,
      partial: true,
      inputTokens: 60,
      outputTokens: 14,
      totalTokens: 74,
    });
  });
});
