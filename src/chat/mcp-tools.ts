import {
  classifyMcpToolErrorRust,
  isMcpToolResultEmptyRust,
  normalizeMcpToolResultRust,
  parseMcpToolArgumentsRust,
  type RustMcpToolNormalizedResult,
} from '../rag/rust-core';
import type { ToolCallRecord, ToolExecutionPolicy } from './types';
import { t } from '../i18n';

const DEFAULT_DANGEROUS_TOOL_PATTERNS = [
  /delete/i,
  /remove/i,
  /write/i,
  /modify/i,
  /move/i,
  /rename/i,
  /exec/i,
  /shell/i,
  /command/i,
];

export interface NormalizedToolResult {
  displayText: string;
  modelText: string;
}

export function createToolExecutionPolicy(
  mode: ToolExecutionPolicy['mode'],
): ToolExecutionPolicy {
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
    return normalized;
  }

  const text = extractMcpTextContent(result);
  if (text) {
    return {
      displayText: text,
      modelText: text,
    };
  }

  const fallback = stringifyUnknown(result);
  return {
    displayText: fallback,
    modelText: fallback,
  };
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
      return new RegExp(pattern, 'i').test(toolName);
    } catch {
      return false;
    }
  });
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
