import { validateMcpJsonRust, type RustMcpJsonValidationResult } from '../rag/rust-core';
import { t } from '../i18n';

type LegacyMcpJsonValidationResult = {
  valid: boolean;
  data?: unknown;
  error?: string;
};

export function validateMcpJson(jsonString: string): LegacyMcpJsonValidationResult {
  const rustResult = validateMcpJsonRust(jsonString);
  if (rustResult !== null) {
    return rustResult.valid
      ? { valid: true, data: rustResult.data }
      : { valid: false, error: buildRustMcpError(rustResult) };
  }

  return { valid: false, error: t('mcpJsonInvalidObject') };
}

function buildRustMcpError(result: RustMcpJsonValidationResult): string {
  const serverPrefix =
    result.serverName === undefined || result.serverName === '' ? '' : ` (${result.serverName})`;

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
    case 'invalid-remote-server': {
      return `${t('mcpJsonInvalidRemote')}${serverPrefix}`;
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
