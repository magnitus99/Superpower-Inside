import { describe, expect, it } from 'vitest';
import { createProviderWaitStatus } from './provider-wait';

describe('Provider wait UX contract', () => {
  it('buffered/best-effort provider는 실시간 스트리밍처럼 보이지 않는 대기 문구를 만든다', () => {
    expect(
      createProviderWaitStatus({
        providerLabel: 'Custom',
        model: 'request-url',
        elapsedMs: 3_200,
        capability: {
          providerKey: 'customOpenAI',
          model: 'request-url',
          streaming: false,
          transport: 'request-url-buffered',
          toolCalling: false,
          reasoning: false,
          abort: 'best-effort',
          fileReference: true,
          maxToolRounds: 0,
          knownLimitations: [],
        },
      }),
    ).toEqual({
      headline: 'Custom / request-url 응답 대기 중',
      detail: '실시간 토큰 없이 완료된 응답을 한 번에 표시합니다. 취소는 provider에 따라 이미 진행 중인 요청을 즉시 멈추지 못할 수 있습니다.',
      elapsedLabel: '3.2초',
      mode: 'buffered',
      abortAccuracy: 'best-effort',
    });
  });
});
