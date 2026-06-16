import { t } from '../i18n';
import type { ChatErrorKind } from './types';

export interface ChatRecoveryAction {
  id:
    | 'retry-same-context'
    | 'switch-provider'
    | 'reconnect-mcp'
    | 'edit-tool-args'
    | 'skip-failed-tool'
    | 'send-without-rag'
    | 'copy-debug';
  label: string;
}

export function classifyChatError(detail: string): ChatErrorKind {
  const normalized = detail.toLowerCase();
  if (/\b(401|403|unauthorized|forbidden|api key|auth)\b/.test(normalized)) return 'auth';
  if (/\b(429|rate limit|too many requests)\b/.test(normalized)) return 'rate-limit';
  if (/\b(timeout|timed out|abort timeout)\b/.test(normalized)) return 'timeout';
  if (/\b(network|fetch failed|econnreset|enotfound|offline)\b/.test(normalized)) return 'network';
  if (/\b(tool not found|unknown tool)\b/.test(normalized)) return 'tool-not-found';
  if (/\b(tool|mcp).*\b(failed|error)\b/.test(normalized)) return 'tool-failed';
  if (/\b(context|rag).*\b(failed|error|unavailable)\b/.test(normalized)) return 'context-build';
  if (/\b(source|citation).*\b(failed|invalid|unverified)\b/.test(normalized)) {
    return 'source-validation';
  }
  if (/\b(provider|invalid response|malformed|parse)\b/.test(normalized)) {
    return 'provider-response';
  }
  return 'unknown';
}

export function createChatRecoveryActions(kind: ChatErrorKind): ChatRecoveryAction[] {
  switch (kind) {
    case 'auth':
      return [retry(), switchProvider(), copyDebug()];
    case 'rate-limit':
      return [retry(), switchProvider(), copyDebug()];
    case 'network':
    case 'timeout':
    case 'provider-response':
      return [retry(), switchProvider(), copyDebug()];
    case 'context-build':
      return [retry(), { id: 'send-without-rag', label: t('chatRecoverySendWithoutRag') }, copyDebug()];
    case 'tool-not-found':
      return [retry(), { id: 'reconnect-mcp', label: t('chatRecoveryReconnectMcp') }, copyDebug()];
    case 'tool-failed':
      return [
        retry(),
        { id: 'edit-tool-args', label: t('chatRecoveryEditToolArgs') },
        { id: 'skip-failed-tool', label: t('chatRecoverySkipFailedTool') },
        copyDebug(),
      ];
    case 'source-validation':
      return [
        retry(),
        { id: 'send-without-rag', label: t('chatRecoverySendWithoutSourceValidation') },
        copyDebug(),
      ];
    case 'unknown':
      return [retry(), copyDebug()];
  }
}

export function redactDebugDetail(detail: string): string {
  return detail
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*([^\s,;}]+)/gi, '$1=[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g, '[REDACTED]');
}

function retry(): ChatRecoveryAction {
  return { id: 'retry-same-context', label: t('chatRecoveryRetrySameContext') };
}

function switchProvider(): ChatRecoveryAction {
  return { id: 'switch-provider', label: t('chatRecoverySwitchProvider') };
}

function copyDebug(): ChatRecoveryAction {
  return { id: 'copy-debug', label: t('chatRecoveryCopyDebug') };
}
