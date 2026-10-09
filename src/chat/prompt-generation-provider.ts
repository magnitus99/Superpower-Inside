import {
  resolveChatModelPlan,
  type ChatModelOption,
  type SuperpowerInsideSettings,
} from '../settings';
import { createChatProviderForModel } from '../llm/provider-resolution';
import type { LLMProvider } from '../llm/providers';

export interface PromptGenerationProvider {
  provider: LLMProvider;
  model: string;
}

export interface PromptGenerationModelState {
  options: ChatModelOption[];
  selectedModel: string;
}

export function buildPromptGenerationModelOptions(
  settings: SuperpowerInsideSettings,
): ChatModelOption[] {
  return resolvePromptGenerationModelState(settings, settings.chat.defaultModel).options;
}

export function resolvePromptGenerationModelState(
  settings: SuperpowerInsideSettings,
  configuredDefault: string,
): PromptGenerationModelState {
  const plan = resolveChatModelPlan(settings, configuredDefault);
  return { options: plan.options, selectedModel: plan.selectedModel };
}

export function createPromptGenerationProvider(
  settings: SuperpowerInsideSettings,
  value: string,
): PromptGenerationProvider | null {
  const resolved = createChatProviderForModel(settings, value);
  return resolved ? { provider: resolved.provider, model: resolved.model } : null;
}
