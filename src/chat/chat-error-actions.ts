import { t } from '../i18n';
import type { ChatErrorKind } from './types';

export interface ChatRecoveryAction {
  id:
    | 'retry-same-context'
    | 'switch-provider'
    | 'reconnect-mcp'
    | 'send-without-rag'
    | 'copy-debug';
  label: string;
}

export interface ChatErrorPresentation {
  content: string;
  retryAvailableAt?: string;
}

export function normalizeLoadedChatErrorContent(
  content: string,
  kind: ChatErrorKind | undefined,
  diagnostics?: string,
): string {
  if (!kind) return content;
  const normalized = content.trim();
  const exposesDiagnostics =
    normalized.length === 0 ||
    normalized === diagnostics?.trim() ||
    /\bLLM\s+(?:API\s+)?(?:stream\s+failed|error)\b|LLM API 오류|오류 코드\s*:|원본\s*:/iu.test(
      normalized,
    );
  return exposesDiagnostics ? createChatErrorPresentation(kind).content : content;
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

export function classifyChatFailure(error: unknown): ChatErrorKind {
  const status = getChatHttpStatus(error);
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status !== undefined && status >= 500) return 'provider-response';
  return classifyChatError(error instanceof Error ? error.message : String(error));
}

export function getChatHttpStatus(error: unknown): number | undefined {
  const structuredStatus = getNumericErrorField(error, 'status');
  if (structuredStatus !== undefined) return structuredStatus;
  const detail = error instanceof Error ? error.message : String(error);
  const match = detail.match(/\b(?:status\s*[:=]?\s*|http\s+|:\s*)(\d{3})\b/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function getChatRetryAfterMs(error: unknown): number | undefined {
  const retryAfterMs = getNumericErrorField(error, 'retryAfterMs');
  return retryAfterMs === undefined ? undefined : Math.max(0, retryAfterMs);
}

export function createChatErrorPresentation(
  kind: ChatErrorKind,
  retryAfterMs?: number,
  nowMs = Date.now(),
): ChatErrorPresentation {
  const headline = getChatErrorHeadline(kind);
  if (kind !== 'rate-limit' || retryAfterMs === undefined || retryAfterMs <= 0) {
    return { content: headline };
  }
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  const delay =
    seconds >= 60
      ? t('chatErrorMinutes', { count: Math.ceil(seconds / 60) })
      : t('chatErrorSeconds', { count: seconds });
  return {
    content: `${headline}\n\n${t('chatErrorRetryAfter', { delay })}`,
    retryAvailableAt: new Date(nowMs + retryAfterMs).toISOString(),
  };
}

export function createChatRecoveryActions(kind: ChatErrorKind): ChatRecoveryAction[] {
  switch (kind) {
    case 'auth':
      return [retry(), switchProvider(), copyDebug()];
    case 'rate-limit':
      return [switchProvider(), retry(), copyDebug()];
    case 'network':
    case 'timeout':
    case 'provider-response':
      return [retry(), switchProvider(), copyDebug()];
    case 'context-build':
      return [
        retry(),
        { id: 'send-without-rag', label: t('chatRecoverySendWithoutRag') },
        copyDebug(),
      ];
    case 'tool-not-found':
      return [retry(), { id: 'reconnect-mcp', label: t('chatRecoveryReconnectMcp') }, copyDebug()];
    case 'tool-failed':
      return [retry(), copyDebug()];
    case 'source-validation':
      return [retry(), copyDebug()];
    case 'unknown':
      return [retry(), copyDebug()];
  }
}

function getChatErrorHeadline(kind: ChatErrorKind): string {
  switch (kind) {
    case 'auth':
      return t('apiHintUnauthorized');
    case 'rate-limit':
      return t('apiHintRateLimited');
    case 'network':
      return t('apiHintFetchCors');
    case 'timeout':
      return t('apiHintServiceUnavailable');
    case 'provider-response':
      return t('apiHintServerError');
    case 'context-build':
    case 'tool-not-found':
    case 'tool-failed':
    case 'source-validation':
    case 'unknown':
      return t('chatErrorGeneric');
  }
}

function getNumericErrorField(
  error: unknown,
  field: 'status' | 'retryAfterMs',
): number | undefined {
  if (!(error instanceof Error) || !(field in error)) return undefined;
  const value = (error as Error & Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function redactDebugDetail(detail: string): string {
  return detail
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*([^\s,;}]+)/gi, '$1=[REDACTED]')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
      '[REDACTED]',
    );
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
