import { describe, expect, it } from 'vitest';
import { resolveReasoningDisplay } from './reasoning-display-policy';

describe('Reasoning display policy', () => {
  it('reasoning이 없으면 card를 렌더링하지 않는다', () => {
    expect(
      resolveReasoningDisplay({
        hasReasoning: false,
        providerSupportsReasoning: true,
        source: 'provider',
        isStreaming: false,
      }),
    ).toMatchObject({ policy: 'hidden', shouldRender: false });
  });

  it('provider-emitted reasoning은 기본 collapsed raw 영역으로 표시한다', () => {
    expect(
      resolveReasoningDisplay({
        hasReasoning: true,
        providerSupportsReasoning: true,
        source: 'provider',
        isStreaming: false,
      }),
    ).toEqual({
      policy: 'provider-raw-collapsed',
      shouldRender: true,
      autoOpen: false,
      label: '모델이 제공한 thinking',
    });
  });

  it('content 내부 think leak은 최종 답변보다 낮은 우선순위의 summary-only로 표시한다', () => {
    expect(
      resolveReasoningDisplay({
        hasReasoning: true,
        providerSupportsReasoning: false,
        source: 'think-tag',
        isStreaming: false,
      }),
    ).toMatchObject({
      policy: 'summary-only',
      shouldRender: true,
      autoOpen: false,
    });
  });
});
