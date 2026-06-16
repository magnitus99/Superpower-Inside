export type ProviderTransport = 'fetch-sse' | 'fetch-ndjson' | 'request-url-buffered';

export type ProviderAbortCapability = 'native' | 'best-effort';

export interface ProviderCapabilitySnapshot {
  providerKey: string;
  model: string;
  streaming: boolean;
  transport: ProviderTransport;
  toolCalling: boolean;
  reasoning: boolean;
  abort: ProviderAbortCapability;
  fileReference: boolean;
  maxToolRounds: number;
  knownLimitations: string[];
}

export interface ProviderCapabilityOverrides {
  streaming?: boolean;
  toolCalling?: boolean;
  reasoning?: boolean;
  abort?: ProviderAbortCapability;
  maxToolRounds?: number;
  knownLimitations?: string[];
}

interface ResolveProviderCapabilityInput {
  providerKey: string;
  model: string;
  useRequestUrl?: boolean;
  overrides?: ProviderCapabilityOverrides;
}

export function resolveProviderCapability(
  input: ResolveProviderCapabilityInput,
): ProviderCapabilitySnapshot {
  const capability = getDefaultProviderCapability(input);
  return applyProviderCapabilityOverrides(capability, input.overrides);
}

export function normalizeProviderCapabilityOverrides(
  value: unknown,
): ProviderCapabilityOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const overrides: ProviderCapabilityOverrides = {};
  if (typeof source.streaming === 'boolean') overrides.streaming = source.streaming;
  if (typeof source.toolCalling === 'boolean') overrides.toolCalling = source.toolCalling;
  if (typeof source.reasoning === 'boolean') overrides.reasoning = source.reasoning;
  if (source.abort === 'native' || source.abort === 'best-effort') {
    overrides.abort = source.abort;
  }
  if (
    typeof source.maxToolRounds === 'number' &&
    Number.isInteger(source.maxToolRounds) &&
    source.maxToolRounds >= 0
  ) {
    overrides.maxToolRounds = source.maxToolRounds;
  }
  if (Array.isArray(source.knownLimitations)) {
    const knownLimitations = source.knownLimitations
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (knownLimitations.length > 0) {
      overrides.knownLimitations = knownLimitations;
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function getDefaultProviderCapability(
  input: ResolveProviderCapabilityInput,
): ProviderCapabilitySnapshot {
  const providerKey = input.providerKey;
  const model = input.model;
  if (providerKey.startsWith('customOpenAI:')) {
    const useRequestUrl = input.useRequestUrl ?? true;
    return {
      providerKey,
      model,
      streaming: !useRequestUrl,
      transport: useRequestUrl ? 'request-url-buffered' : 'fetch-sse',
      toolCalling: false,
      reasoning: false,
      abort: useRequestUrl ? 'best-effort' : 'native',
      fileReference: true,
      maxToolRounds: 0,
      knownLimitations: [
        'Custom OpenAI-compatible capabilities are conservative until explicitly enabled.',
      ],
    };
  }

  switch (providerKey) {
    case 'openai':
      return {
        providerKey,
        model,
        streaming: true,
        transport: 'fetch-sse',
        toolCalling: true,
        reasoning: true,
        abort: 'native',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: [],
      };
    case 'claude':
      return {
        providerKey,
        model,
        streaming: true,
        transport: 'fetch-sse',
        toolCalling: true,
        reasoning: true,
        abort: 'native',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: [],
      };
    case 'ollama':
      return {
        providerKey,
        model,
        streaming: true,
        transport: 'fetch-ndjson',
        toolCalling: true,
        reasoning: true,
        abort: 'native',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: [],
      };
    case 'ollamaCloud':
      return {
        providerKey,
        model,
        streaming: false,
        transport: 'request-url-buffered',
        toolCalling: true,
        reasoning: true,
        abort: 'best-effort',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: ['Ollama Cloud uses requestUrl, so live token streaming is buffered.'],
      };
    case 'openRouter':
      return {
        providerKey,
        model,
        streaming: true,
        transport: 'fetch-sse',
        toolCalling: true,
        reasoning: true,
        abort: 'native',
        fileReference: true,
        maxToolRounds: 10,
        knownLimitations: [],
      };
    default:
      return {
        providerKey,
        model,
        streaming: false,
        transport: 'request-url-buffered',
        toolCalling: false,
        reasoning: false,
        abort: 'best-effort',
        fileReference: true,
        maxToolRounds: 0,
        knownLimitations: ['Unknown provider capabilities are disabled until configured.'],
      };
  }
}

function applyProviderCapabilityOverrides(
  capability: ProviderCapabilitySnapshot,
  overrides: ProviderCapabilityOverrides | undefined,
): ProviderCapabilitySnapshot {
  if (!overrides) return capability;
  const maxToolRounds =
    overrides.maxToolRounds !== undefined
      ? Math.max(0, Math.trunc(overrides.maxToolRounds))
      : capability.maxToolRounds;
  const toolCalling = overrides.toolCalling ?? capability.toolCalling;
  return {
    ...capability,
    streaming: overrides.streaming ?? capability.streaming,
    toolCalling,
    reasoning: overrides.reasoning ?? capability.reasoning,
    abort: overrides.abort ?? capability.abort,
    maxToolRounds: toolCalling ? maxToolRounds : 0,
    knownLimitations: [
      ...capability.knownLimitations,
      ...(overrides.knownLimitations ?? []),
    ].filter((item, index, list) => item.trim().length > 0 && list.indexOf(item) === index),
  };
}
