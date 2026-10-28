import { describe, expect, it } from 'vitest';
import type { ProviderModelConfig } from '../settings';
import {
  buildOpenCodeEndpoint,
  buildOpenCodeModelsUrl,
  buildProviderApiEndpoint,
  normalizeOpenCodeBaseUrl,
  resolveOpenCodePlan,
  normalizeProviderApiRoot,
  providerStrategyUsesEditableBaseUrl,
  resolveProviderModelApiFormat,
} from './provider-api-format';

function model(overrides: Partial<ProviderModelConfig> = {}): ProviderModelConfig {
  return {
    id: 'model',
    kind: 'general',
    verification: { chatStatus: 'unknown', embeddingStatus: 'unknown' },
    ...overrides,
  };
}

describe('provider API 형식과 endpoint 정규화', () => {
  it('API 루트와 형식별 경로를 만든다', () => {
    expect(normalizeProviderApiRoot('https://api.commandcode.ai/provider/v1/messages')).toBe(
      'https://api.commandcode.ai/provider/v1',
    );
    expect(buildProviderApiEndpoint('https://example.com', 'chat')).toBe(
      'https://example.com/v1/chat/completions',
    );
    expect(buildProviderApiEndpoint('https://example.com/v1/', 'responses')).toBe(
      'https://example.com/v1/responses',
    );
    expect(buildProviderApiEndpoint('https://example.com/v1', 'messages')).toBe(
      'https://example.com/v1/messages',
    );
    expect(
      buildProviderApiEndpoint('https://example.com/v1beta', 'gemini', 'gemini-x', true),
    ).toBe('https://example.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse');
  });

  it('OpenCode Go와 일반 base URL을 형식별 endpoint로 바꾼다', () => {
    expect(normalizeOpenCodeBaseUrl('https://opencode.ai/zen/v1')).toBe(
      'https://opencode.ai/inference',
    );
    expect(buildOpenCodeEndpoint('https://opencode.ai/inference/go', 'chat')).toBe(
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
    );
    expect(buildOpenCodeEndpoint(undefined, 'responses')).toBe(
      'https://opencode.ai/inference/openai/v1/responses',
    );
    expect(buildOpenCodeModelsUrl('https://opencode.ai/inference')).toBe(
      'https://opencode.ai/inference/v1/models',
    );
    expect(buildOpenCodeEndpoint('https://opencode.ai/inference/go', 'gemini', 'gemini-x')).toBe(
      'https://opencode.ai/inference/go/google/v1beta/models/gemini-x:generateContent',
    );
    // Go/Go Plus keys also use the older Zen Go base from the OpenCode CLI.
    expect(normalizeOpenCodeBaseUrl('https://opencode.ai/zen/go/v1')).toBe(
      'https://opencode.ai/inference/go',
    );
    expect(normalizeOpenCodeBaseUrl('https://opencode.ai/inference/go/v1')).toBe(
      'https://opencode.ai/inference/go',
    );
    expect(buildOpenCodeModelsUrl('https://opencode.ai/zen/go/v1')).toBe(
      'https://opencode.ai/inference/go/v1/models',
    );
    expect(buildOpenCodeEndpoint('https://opencode.ai/zen/go/v1', 'chat')).toBe(
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
    );
  });

  it('OpenCode base URL을 Zen·Go·직접 입력 플랜으로 구분한다', () => {
    expect(resolveOpenCodePlan(undefined)).toBe('zen');
    expect(resolveOpenCodePlan('https://opencode.ai/inference')).toBe('zen');
    expect(resolveOpenCodePlan('https://opencode.ai/inference/go')).toBe('go');
    expect(resolveOpenCodePlan('https://opencode.ai/zen/go/v1')).toBe('go');
    expect(resolveOpenCodePlan('https://proxy.example/v1')).toBe('custom');
  });

  it('ChatGPT OAuth만 base URL을 고정하고 나머지는 편집할 수 있다', () => {
    for (const strategy of ['gemini', 'opencode', 'claude', 'ollama', 'openRouter', 'openai', 'openAICompatible'] as const) {
      expect(providerStrategyUsesEditableBaseUrl(strategy)).toBe(true);
    }
    expect(providerStrategyUsesEditableBaseUrl('openAIChatGPT')).toBe(false);
    expect(providerStrategyUsesEditableBaseUrl('ternlight')).toBe(false);
  });

  it('모델이 지원하는 형식 안에서 프로필 기본값을 유지한다', () => {
    expect(
      resolveProviderModelApiFormat('chat', model({ supportedApiFormats: ['messages', 'chat'] })),
    ).toBe('chat');
    expect(
      resolveProviderModelApiFormat('responses', model({ supportedApiFormats: ['messages'] })),
    ).toBe('messages');
    expect(resolveProviderModelApiFormat('responses', model({ apiFormat: 'messages' }))).toBe(
      'messages',
    );
    expect(resolveProviderModelApiFormat('gemini', model({ supportedApiFormats: ['gemini'] }))).toBe(
      'gemini',
    );
  });
});
