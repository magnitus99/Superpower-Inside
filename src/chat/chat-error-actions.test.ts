import { describe, expect, it } from 'vitest';
import {
  classifyChatError,
  createChatRecoveryActions,
  redactDebugDetail,
} from './chat-error-actions';

describe('Chat error recovery actions', () => {
  it('주요 provider/tool/context 오류를 typed error로 분류한다', () => {
    expect(classifyChatError('401 invalid api key')).toBe('auth');
    expect(classifyChatError('429 rate limit exceeded')).toBe('rate-limit');
    expect(classifyChatError('fetch failed ECONNRESET')).toBe('network');
    expect(classifyChatError('tool not found: search_notes')).toBe('tool-not-found');
    expect(classifyChatError('context build failed while reading RAG')).toBe('context-build');
  });

  it('typed error별 recovery action을 같은 turn 맥락 기준으로 제안한다', () => {
    expect(createChatRecoveryActions('tool-failed').map((action) => action.id)).toEqual([
      'retry-same-context',
      'edit-tool-args',
      'skip-failed-tool',
      'copy-debug',
    ]);
    expect(createChatRecoveryActions('rate-limit').map((action) => action.id)).toEqual([
      'retry-same-context',
      'switch-provider',
      'copy-debug',
    ]);
  });

  it('debug detail은 secret을 제거한다', () => {
    expect(redactDebugDetail('Authorization: Bearer secret-token\napiKey=secret-value')).toBe(
      'Authorization: Bearer [REDACTED]\napiKey=[REDACTED]',
    );
  });
});
