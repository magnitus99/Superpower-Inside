import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_ACTION_ATTRIBUTE,
  createChatMessageActionId,
  createChatMessageActionRenderState,
  createRecoveryMessageActionId,
} from './chat-message-actions';

describe('Chat message action rerender contract', () => {
  it('assigns stable identities to standard and recovery actions', () => {
    expect(CHAT_MESSAGE_ACTION_ATTRIBUTE).toBe('data-chat-action-id');
    expect(createChatMessageActionId('copy')).toBe('message:copy');
    expect(createChatMessageActionId('regenerate')).toBe('message:regenerate');
    expect(createChatMessageActionId('more')).toBe('message:more');
    expect(createChatMessageActionId('edit-and-send')).toBe('message:edit-and-send');
    expect(createChatMessageActionId('error-diagnostics')).toBe('message:error-diagnostics');
    expect(createRecoveryMessageActionId('retry-same-context')).toBe('recovery:retry-same-context');
  });

  it('preserves focused action, expanded diagnostics, and controlled content identity', () => {
    expect(
      createChatMessageActionRenderState({
        messageId: 'assistant:1',
        focusedActionId: ' recovery:retry-same-context ',
        diagnosticsExpanded: 'true',
        diagnosticsContentId: 'diagnostics-existing',
      }),
    ).toEqual({
      focusedActionId: 'recovery:retry-same-context',
      diagnosticsExpanded: true,
      diagnosticsContentId: 'diagnostics-existing',
    });
  });

  it('preserves an explicit collapsed state and migrates legacy details state', () => {
    expect(
      createChatMessageActionRenderState({
        messageId: 'assistant 2',
        diagnosticsExpanded: 'false',
        legacyDiagnosticsOpen: true,
      }),
    ).toEqual({
      focusedActionId: undefined,
      diagnosticsExpanded: false,
      diagnosticsContentId: 'superpower-inside-chat-error-diagnostics-assistant%202',
    });

    expect(
      createChatMessageActionRenderState({
        messageId: 'assistant 2',
        legacyDiagnosticsOpen: true,
      }).diagnosticsExpanded,
    ).toBe(true);
  });
});
