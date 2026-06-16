import { describe, expect, it } from 'vitest';
import { createComposerLoadingState } from './chat-composer';

describe('ChatComposer state contract', () => {
  it('loading 상태에서는 중지 버튼과 입력 잠금을 계산한다', () => {
    expect(createComposerLoadingState(true)).toEqual({
      isStreaming: true,
      sendButton: { disabled: false, text: '중단' },
      inputDisabled: true,
      toolsDisabled: true,
      modelSelectDisabled: true,
    });
  });

  it('idle 상태에서는 전송 버튼과 입력 가능 상태를 계산한다', () => {
    expect(createComposerLoadingState(false)).toEqual({
      isStreaming: false,
      sendButton: { disabled: false, text: '전송' },
      inputDisabled: false,
      toolsDisabled: false,
      modelSelectDisabled: false,
    });
  });
});
