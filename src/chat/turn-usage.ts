import type { ChatOptions, LLMProvider, TokenUsage } from '../llm/providers';
import { planTurnUsageRust } from '../rag/rust-core';
import type { TurnUsageSnapshot } from './types';

/** 연구·도구 라운드·재시도를 포함한 한 응답의 공급자 보고를 보존합니다. */
export function withTurnUsage(
  provider: LLMProvider,
  onUpdate: (snapshot: TurnUsageSnapshot) => void,
  initial?: TurnUsageSnapshot,
): LLMProvider {
  const requests: TokenUsage[][] = [];
  const publish = (): void => {
    const snapshot = planTurnUsageRust({ base: initial, requests });
    if (snapshot) onUpdate(snapshot);
  };
  const optionsFor = (options?: ChatOptions): ChatOptions => {
    const updates: TokenUsage[] = [];
    requests.push(updates);
    publish();
    return {
      ...options,
      onUsage: (usage) => {
        if (options?.signal?.aborted) return;
        updates.push({ ...usage });
        publish();
        options?.onUsage?.(usage);
      },
    };
  };
  return {
    capability: provider.capability,
    contextBudget: provider.contextBudget,
    getObservedModel: () => provider.getObservedModel?.(),
    chat: async (messages, temperature, tools, options) => {
      options?.signal?.throwIfAborted();
      const trackedOptions = optionsFor(options);
      try {
        return await provider.chat(messages, temperature, tools, trackedOptions);
      } finally {
        if (!options?.signal?.aborted) publish();
      }
    },
    streamChat: async (messages, onChunk, temperature, tools, options) => {
      options?.signal?.throwIfAborted();
      const trackedOptions = optionsFor(options);
      try {
        await provider.streamChat(messages, onChunk, temperature, tools, trackedOptions);
      } finally {
        if (!options?.signal?.aborted) publish();
      }
    },
  };
}
