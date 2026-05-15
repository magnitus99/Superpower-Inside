export interface ReasoningExtractor {
  name: string;
  extract(delta: Record<string, unknown>): string | undefined;
}

const openAIReasoning: ReasoningExtractor = {
  name: 'openai',
  extract: (delta) => delta?.reasoning_content as string | undefined,
};

const openRouterReasoning: ReasoningExtractor = {
  name: 'openrouter',
  extract: (delta) => (delta?.reasoning ?? delta?.reasoning_content) as string | undefined,
};

const defaultReasoning: ReasoningExtractor = {
  name: 'default',
  extract: (delta) => (delta?.reasoning ?? delta?.reasoning_content) as string | undefined,
};

export const REASONING_EXTRACTORS: Record<string, ReasoningExtractor> = {
  openai: openAIReasoning,
  openRouter: openRouterReasoning,
  default: defaultReasoning,
};
