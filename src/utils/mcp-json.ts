import { t } from '../i18n';

export function validateMcpJson(jsonString: string): {
  valid: boolean;
  data?: unknown;
  error?: string;
} {
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
    return { valid: false, error: msg };
  }
}

export function formatMcpJson(jsonString: string): string | null {
  const result = validateMcpJson(jsonString);
  if (result.valid) {
    return JSON.stringify(result.data, null, 2);
  }
  return null;
}
