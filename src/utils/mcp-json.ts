import {
  formatMcpJsonRust,
  validateMcpJsonRust,
  type RustMcpJsonValidationResult,
} from '../rag/rust-core';
import { t } from '../i18n';

type LegacyMcpJsonValidationResult = {
  valid: boolean;
  data?: unknown;
  error?: string;
};

export function validateMcpJson(jsonString: string): LegacyMcpJsonValidationResult {
  const rustResult = validateMcpJsonRust(jsonString);
  if (rustResult !== null) {
    return rustResult.valid ? { valid: true, data: rustResult.data } : { valid: false, error: buildRustMcpError(rustResult) };
  }

  return validateMcpJsonFallback(jsonString);
}

export function formatMcpJson(jsonString: string): string | null {
  const formattedByRust = formatMcpJsonRust(jsonString);
  if (formattedByRust !== null) {
    return formattedByRust;
  }
  const result = validateMcpJsonFallback(jsonString);
  if (!result.valid) return null;
  return JSON.stringify(result.data, null, 2);
}

function validateMcpJsonFallback(jsonString: string): LegacyMcpJsonValidationResult {
  try {
    const parsed = JSON.parse(jsonString) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: t('mcpJsonInvalidObject') };
    }

    const obj = parsed as Record<string, unknown>;
    if (!('mcpServers' in obj)) {
      return { valid: false, error: t('mcpJsonMissingMcpServers') };
    }

    const mcpServers = obj.mcpServers;
    if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) {
      return { valid: false, error: t('mcpJsonInvalidMcpServers') };
    }

    for (const [name, cfg] of Object.entries(mcpServers)) {
      if (typeof cfg !== 'object' || cfg === null) {
        return { valid: false, error: `${t('mcpJsonInvalidServerValue')} (${name})` };
      }

      const server = cfg as Record<string, unknown>;

      if (server.command === undefined) {
        return { valid: false, error: `${t('mcpJsonServerNeedsCommand')} (${name})` };
      }

      if (server.args !== undefined && !Array.isArray(server.args)) {
        return { valid: false, error: `${t('mcpJsonInvalidArgs')} (${name})` };
      }

      if (
        server.env !== undefined &&
        (typeof server.env !== 'object' || server.env === null || Array.isArray(server.env))
      ) {
        return { valid: false, error: `${t('mcpJsonInvalidEnv')} (${name})` };
      }
    }

    return { valid: true, data: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes('json')) {
      return { valid: false, error: `Invalid JSON: ${msg}` };
    }
    return { valid: false, error: msg };
  }
}

function buildRustMcpError(result: RustMcpJsonValidationResult): string {
  const serverPrefix = result.serverName === undefined || result.serverName === ''
    ? ''
    : ` (${result.serverName})`;

  switch (result.errorCode) {
    case 'invalid-object': {
      return `${t('mcpJsonInvalidObject')}${serverPrefix}`;
    }
    case 'missing-mcp-servers': {
      return `${t('mcpJsonMissingMcpServers')}${serverPrefix}`;
    }
    case 'invalid-mcp-servers': {
      return `${t('mcpJsonInvalidMcpServers')}${serverPrefix}`;
    }
    case 'invalid-server-value': {
      return `${t('mcpJsonInvalidServerValue')}${serverPrefix}`;
    }
    case 'server-needs-command': {
      return `${t('mcpJsonServerNeedsCommand')}${serverPrefix}`;
    }
    case 'invalid-args': {
      return `${t('mcpJsonInvalidArgs')}${serverPrefix}`;
    }
    case 'invalid-env': {
      return `${t('mcpJsonInvalidEnv')}${serverPrefix}`;
    }
    case 'parse-error': {
      if (result.message) {
        return `Invalid JSON: ${result.message}${serverPrefix}`;
      }
      return `${t('mcpJsonInvalidObject')}${serverPrefix}`;
    }
    default: {
      if (result.message) {
        return result.message;
      }
      return `${t('mcpJsonInvalidObject')}${serverPrefix}`;
    }
  }
}
