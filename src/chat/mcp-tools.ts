import type { ToolCallRecord, ToolExecutionPolicy } from './types';

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
