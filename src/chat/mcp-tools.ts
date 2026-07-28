import {
  classifyMcpToolErrorRust,
  isMcpToolResultEmptyRust,
  normalizeMcpToolResultRust,
  parseMcpToolArgumentsRust,
  type RustMcpToolNormalizedResult,
} from '../rag/rust-core';
import type { ToolCallRecord, ToolExecutionPolicy } from './types';
import { t } from '../i18n';
import { truncateUtf8Text } from '../utils/text-budget';

const DEFAULT_DANGEROUS_TOOL_ACTIONS = [
  'create',
  'update',
  'insert',
  'upsert',
  'add',
  'set',
  'edit',
  'patch',
  'apply',
  'write',
  'modify',
  'replace',
  'delete',
  'remove',
  'move',
  'rename',
  'copy',
  'send',
  'publish',
  'upload',
  'submit',
  'import',
  'deploy',
  'commit',
  'merge',
  'approve',
  'reject',
  'assign',
  'invite',
  'grant',
  'revoke',
  'trigger',
  'exec',
  'execute',
  'shell',
  'command',
] as const;
const DEFAULT_DANGEROUS_TOOL_PATTERNS = DEFAULT_DANGEROUS_TOOL_ACTIONS.map(
  (action) => new RegExp(`(?:^|[^a-z0-9])${action}(?:$|[^a-z0-9])`, 'i'),
);
const DEFAULT_DANGEROUS_TOOL_PATTERN_SOURCES = new Set(
  DEFAULT_DANGEROUS_TOOL_PATTERNS.map((pattern) => pattern.source),
);
const MCP_DISPLAY_TEXT_MAX_BYTES = 32 * 1024;
const MCP_MODEL_TEXT_MAX_BYTES = 64 * 1024;

export interface NormalizedToolResult {
  displayText: string;
  modelText: string;
}

export function createToolExecutionPolicy(mode: ToolExecutionPolicy['mode']): ToolExecutionPolicy {
  return {
    mode,
    manualApproval: mode === 'always-manual',
    dangerousToolNamePatterns: DEFAULT_DANGEROUS_TOOL_PATTERNS.map((pattern) => pattern.source),
  };
}

export function parseToolArguments(argumentsText: string): Record<string, unknown> {
  const parsed = parseMcpToolArgumentsRust(argumentsText);
  if (parsed !== null) {
    return parsed;
  }

  const trimmed = argumentsText.trim();
  if (!trimmed) return {};

  try {
    const json = JSON.parse(trimmed) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    return { input: json };
  } catch {
    return { input: argumentsText };
  }
}

export function shouldAutoExecuteToolCall(
  toolCall: ToolCallRecord,
  policy: ToolExecutionPolicy,
  mentionedServerNames: string[],
): boolean {
  if (policy.mode === 'always-manual') {
    return false;
  }

  if (isDangerousToolName(toolCall.name, policy)) {
    return false;
  }

  if (policy.mode === 'always-auto') {
    return true;
  }

  if (!toolCall.serverName) {
    return false;
  }

  return mentionedServerNames.includes(toolCall.serverName);
}

export function normalizeToolResult(result: unknown): NormalizedToolResult {
  const normalized = normalizeMcpToolResultRust(result);
  if (normalized !== null) {
    return boundNormalizedToolResult(normalized);
  }

  const text = extractMcpTextContent(result);
  if (text) {
    return boundNormalizedToolResult({
      displayText: text,
      modelText: text,
    });
  }

  const fallback = stringifyUnknown(result);
  return boundNormalizedToolResult({
    displayText: fallback,
    modelText: fallback,
  });
}

export function isMcpToolResultEmpty(
  result: unknown,
  normalizedResult: RustMcpToolNormalizedResult,
): boolean {
  const isEmpty = isMcpToolResultEmptyRust(result, normalizedResult);
  if (isEmpty !== null) {
    return isEmpty;
  }

  if (normalizedResult.displayText.trim().length === 0) {
    return true;
  }

  if (!isRecord(result) || !Array.isArray(result.content)) return false;
  return !hasMeaningfulMcpContent(result.content);
}

export function classifyMcpToolError(
  rawMsg: string,
  mode: 'execution' | 'view' = 'execution',
): string {
  const parsed = classifyMcpToolErrorRust(rawMsg);
  if (!parsed) {
    return rawMsg;
  }

  switch (parsed.kind) {
    case 'validation-pattern':
      return t('mcpValidationPattern', { pattern: parsed.pattern ?? '' });
    case 'validation-field':
      return t('mcpValidationField', { field: parsed.field ?? '' });
    case 'validation-required':
      return t('mcpValidationRequiredMissing');
    case 'validation-schema-failed':
      return t('mcpValidationSchemaFailed');
    case 'validation-generic':
      return mode === 'view' ? t('mcpValidationSchemaFailed') : t('mcpValidationGeneric');
    case 'raw':
      return parsed.message ?? rawMsg;
    default:
      return rawMsg;
  }
}

function isDangerousToolName(toolName: string, policy: ToolExecutionPolicy): boolean {
  const patterns = policy.dangerousToolNamePatterns ?? [];
  return patterns.some((pattern) => {
    try {
      const matcher = new RegExp(pattern, 'i');
      if (matcher.test(toolName)) {
        return true;
      }
      if (!DEFAULT_DANGEROUS_TOOL_PATTERN_SOURCES.has(pattern)) {
        return false;
      }
      return matcher.test(segmentCamelCaseToolName(toolName));
    } catch {
      return false;
    }
  });
}

function segmentCamelCaseToolName(toolName: string): string {
  return toolName.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}

function boundNormalizedToolResult(result: NormalizedToolResult): NormalizedToolResult {
  return {
    displayText: truncateUtf8Text(result.displayText, MCP_DISPLAY_TEXT_MAX_BYTES).text,
    modelText: truncateUtf8Text(result.modelText, MCP_MODEL_TEXT_MAX_BYTES).text,
  };
}

function extractMcpTextContent(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return null;
  }

  const textParts = result.content
    .map((item) => {
      if (!isRecord(item)) return null;
      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text;
      }
      return stringifyUnknown(item);
    })
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);

  return textParts.length > 0 ? textParts.join('\n\n') : null;
}

function hasMeaningfulMcpContent(items: unknown[]): boolean {
  return items.some((item) => {
    if (!isRecord(item)) return false;
    if (item.type === 'text') {
      return typeof item.text === 'string' && item.text.trim().length > 0;
    }
    return Object.keys(item).length > 0;
  });
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    const json = JSON.stringify(value, null, 2);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
