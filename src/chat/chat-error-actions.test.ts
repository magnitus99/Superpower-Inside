import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  classifyChatError,
  classifyChatFailure,
  createChatErrorPresentation,
  createChatRecoveryActions,
  getChatHttpStatus,
  getChatRetryAfterMs,
  normalizeLoadedChatErrorContent,
  redactDebugDetail,
} from './chat-error-actions';

describe('Chat error recovery actions', () => {
  beforeEach(() => {
    setLanguage('en');
  });

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
      'copy-debug',
    ]);
    expect(createChatRecoveryActions('source-validation').map((action) => action.id)).toEqual([
      'retry-same-context',
      'copy-debug',
    ]);
    expect(createChatRecoveryActions('rate-limit').map((action) => action.id)).toEqual([
      'switch-provider',
      'retry-same-context',
      'copy-debug',
    ]);
  });

  it('구조화된 HTTP 상태와 retry-after를 사용자 메시지와 복구 시각으로 변환한다', () => {
    const error = Object.assign(new Error('upstream model/key/timeout detail'), {
      status: 429,
      retryAfterMs: 120_000,
    });

    expect(classifyChatFailure(error)).toBe('rate-limit');
    expect(getChatHttpStatus(error)).toBe(429);
    expect(getChatRetryAfterMs(error)).toBe(120_000);
    const presentation = createChatErrorPresentation('rate-limit', 120_000, 1_000);
    expect(presentation.content).toContain('This connection has reached its request limit.');
    expect(presentation.content).toContain('2 minutes');
    expect(presentation.content).not.toContain('upstream');
    expect(presentation.retryAvailableAt).toBe(new Date(121_000).toISOString());
  });

  it('debug detail은 secret을 제거한다', () => {
    expect(redactDebugDetail('Authorization: Bearer secret-token\napiKey=secret-value')).toBe(
      'Authorization: Bearer [REDACTED]\napiKey=[REDACTED]',
    );
  });

  it('기존 세션의 원본 API 오류 본문은 간결한 사용자 메시지로 복구한다', () => {
    expect(
      normalizeLoadedChatErrorContent(
        'LLM API 오류: 오류 코드: ???\n원본: LLM stream failed: 429 upstream detail',
        'rate-limit',
        'LLM stream failed: 429 upstream detail',
      ),
    ).toBe('This connection has reached its request limit.');
    expect(
      normalizeLoadedChatErrorContent(
        '사용자가 이해할 수 있는 기존 오류 안내',
        'rate-limit',
        '429 upstream detail',
      ),
    ).toBe('사용자가 이해할 수 있는 기존 오류 안내');
  });
});
