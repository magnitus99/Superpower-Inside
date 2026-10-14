import { describe, expect, it } from 'vitest';
import {
  MAX_PROVIDER_TOOL_ROUNDS,
  normalizeProviderCapabilityOverrides,
  resolveProviderCapability,
} from './provider-capabilities';

describe('provider 도구 라운드 안전 한도', () => {
  it.each([
    'openai',
    'openAIChatGPT',
    'claude',
    'ollama',
    'ollamaCloud',
    'openRouter',
    'customOpenAI:synthetic',
  ])('%s는 별도 옵션 없이 스트리밍을 표준으로 사용한다', (providerKey) => {
    expect(resolveProviderCapability({ providerKey, model: 'synthetic' })).toMatchObject({
      streaming: true,
      transport: 'desktop-stream',
      abort: 'native',
    });
  });
  it('알 수 없는 provider의 스트리밍과 취소 capability는 보수적으로 유지한다', () => {
    expect(resolveProviderCapability({ providerKey: 'unknown', model: 'synthetic' })).toMatchObject(
      { streaming: false, transport: 'request-url-buffered', abort: 'best-effort' },
    );
  });
  it('native function calling을 지원하지 않아도 compatibility 도구 라운드를 허용한다', () => {
    expect(
      resolveProviderCapability({
        providerKey: 'customOpenAI:custom-1',
        model: 'auto',
      }),
    ).toMatchObject({
      toolCalling: false,
      maxToolRounds: 10,
    });
    expect(
      resolveProviderCapability({
        providerKey: 'openai',
        model: 'gpt-test',
        overrides: { toolCalling: false },
      }),
    ).toMatchObject({
      toolCalling: false,
      maxToolRounds: 10,
    });
  });

  it('저장된 과도한 override를 안전 한도로 정규화한다', () => {
    expect(normalizeProviderCapabilityOverrides({ maxToolRounds: 999 })).toMatchObject({
      maxToolRounds: MAX_PROVIDER_TOOL_ROUNDS,
    });
  });

  it('런타임 capability도 안전 한도를 넘지 않는다', () => {
    expect(
      resolveProviderCapability({
        providerKey: 'customOpenAI:custom-1',
        model: 'auto',
        overrides: { toolCalling: true, maxToolRounds: 999 },
      }).maxToolRounds,
    ).toBe(MAX_PROVIDER_TOOL_ROUNDS);
  });
});
