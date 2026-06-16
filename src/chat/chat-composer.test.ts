import { describe, expect, it } from 'vitest';
import {
  createComposerDraftSnapshot,
  createComposerLoadingState,
  resolveComposerKeyAction,
} from './chat-composer';

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

  it('keyboard 계약을 send/newline/mention/cancel로 분리한다', () => {
    expect(resolveComposerKeyAction({ key: 'Enter' })).toBe('send');
    expect(resolveComposerKeyAction({ key: 'Enter', shiftKey: true })).toBe('newline');
    expect(resolveComposerKeyAction({ key: 'Enter', metaKey: true })).toBe('force-send');
    expect(resolveComposerKeyAction({ key: 'Escape', isStreaming: true })).toBe('cancel');
    expect(resolveComposerKeyAction({ key: 'ArrowDown', mentionOpen: true })).toBe('select-next');
    expect(resolveComposerKeyAction({ key: 'Tab', mentionOpen: true })).toBe('confirm-mention');
  });

  it('전송 실패/취소 복구용 draft snapshot을 만든다', () => {
    expect(
      createComposerDraftSnapshot({
        text: '@Notes/A.md 질문',
        attachmentIds: ['file:Notes/A.md'],
        now: '2026-05-16T00:00:00.000Z',
      }),
    ).toEqual({
      text: '@Notes/A.md 질문',
      attachmentIds: ['file:Notes/A.md'],
      updatedAt: '2026-05-16T00:00:00.000Z',
      hasContext: true,
    });
  });
});
