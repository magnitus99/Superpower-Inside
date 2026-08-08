import {
  resolveChatModelPlan,
  type ChatModelOption,
  type SuperpowerInsideSettings,
} from '../settings';

export interface ChatModelState {
  options: ChatModelOption[];
  selectedModel: string;
  enabledProviderCount: number;
  availableModelCount: number;
}

export function resolveChatModelState(settings: SuperpowerInsideSettings): ChatModelState {
  return resolveChatModelPlan(settings);
}
