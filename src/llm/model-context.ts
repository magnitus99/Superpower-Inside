import { t } from '../i18n';
import { planModelContextRust, type ModelContextBudget } from '../rag/rust-core';
import type { ProviderConfig, CustomOpenAIProviderConfig, ProviderStrategyKey } from '../settings';
import {
  fetchProviderModelsForStrategy,
  fetchOllamaModelInfo,
  fetchAnthropicModelInfo,
} from './validation';
import { prepareProviderRequest } from './request-budget';
import type { LLMProvider, ChatOptions } from './providers';

/** 조회 실패 시 과거 모델이나 이름이 비슷한 모델의 한도를 대신 쓰지 않는다. */
export async function fetchModelContext(
  strategy: ProviderStrategyKey,
  config: ProviderConfig | CustomOpenAIProviderConfig,
  model: string,
): Promise<ModelContextBudget> {
  let metadata: unknown = {};
  let timeout: number | undefined;
  try {
    const lookup = async (): Promise<unknown> => {
      if (strategy === 'ollama' || strategy === 'ollamaCloud')
        return (await fetchOllamaModelInfo(strategy, config, model)) ?? {};
      if (strategy === 'claude') return (await fetchAnthropicModelInfo(config, model)) ?? {};
      const result = await fetchProviderModelsForStrategy(strategy, config);
      return result.valid ? (result.modelDetails?.find((detail) => detail.id === model) ?? {}) : {};
    };
    metadata = await Promise.race([
      lookup(),
      new Promise<unknown>((resolve) => {
        timeout = window.setTimeout(() => resolve({}), 12_000);
      }),
    ]);
  } catch {
    metadata = {};
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
  const plan = planModelContextRust(metadata);
  if (!plan) throw new Error(t('chatInputBudgetExceeded'));
  return plan;
}

/** 모든 도구 라운드와 연구 호출에 같은 모델 예산을 전달한다. */
export function withModelContext(
  provider: LLMProvider,
  contextBudget: ModelContextBudget,
): LLMProvider {
  const optionsFor = (options?: ChatOptions): ChatOptions => ({
    ...options,
    inputBudgetBytes: contextBudget.inputBytes,
    maxOutputTokens: contextBudget.outputTokens,
    contextTokens: contextBudget.contextTokens,
  });
  return {
    capability: provider.capability,
    contextBudget,
    getObservedModel: () => provider.getObservedModel?.(),
    chat: async (messages, temperature, tools, options) =>
      provider.chat(
        prepareProviderRequest(messages, tools, contextBudget.inputBytes).messages,
        temperature,
        tools,
        optionsFor(options),
      ),
    streamChat: async (messages, onChunk, temperature, tools, options) =>
      provider.streamChat(
        prepareProviderRequest(messages, tools, contextBudget.inputBytes).messages,
        onChunk,
        temperature,
        tools,
        optionsFor(options),
      ),
  };
}
